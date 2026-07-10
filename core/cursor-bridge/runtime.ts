import {
  CURSOR_BRIDGE_NATIVE_HOST,
  CURSOR_BRIDGE_PROTOCOL,
  CURSOR_BRIDGE_PROTOCOL_VERSION,
  type CursorBridgeExtensionToHost,
  type CursorBridgeHostToExtension,
  type CursorBridgeJobRequest,
  type CursorBridgeReadiness,
  isCursorBridgeEnvelope,
} from './protocol';
import { getBridgeStatusSnapshot } from './thread-store';
import { buildEniHomeView, buildEniNudgeSuggestion, runEniDream } from './eni-life';
import { probeCursorBridgeReadiness, runCursorBridgeJob, type CursorBridgeWorkerDeps } from './worker';
import { setHostVaultPost } from './host-vault-bridge';
import { applyHostVaultSnapshot, seedHostVaultFromLocal } from './account-vault';

const RECONNECT_MS = 2_000;
const RECONNECT_MISSING_HOST_MS = 15_000;

export interface CursorBridgeRuntimeOptions {
  deps: CursorBridgeWorkerDeps;
  connectNative?: (hostName: string) => ChromeNativePort | null;
  onLog?: (message: string) => void;
}

interface ChromeNativePort {
  postMessage: (message: unknown) => void;
  onMessage: { addListener: (cb: (message: unknown) => void) => void };
  onDisconnect: { addListener: (cb: () => void) => void };
  disconnect: () => void;
}

/**
 * Keeps a Native Messaging connection to the cursor-bridge host and executes
 * jobs with the existing DeepSeek++ web adapter (page-captured auth + PoW).
 */
export function startCursorBridgeRuntime(options: CursorBridgeRuntimeOptions): { stop: () => void } {
  let stopped = false;
  let port: ChromeNativePort | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  let activeAbort: AbortController | null = null;

  const log = (message: string) => options.onLog?.(message);

  const connect = () => {
    if (stopped) return;
    if (port) return;

    const connectNative =
      options.connectNative
      ?? ((hostName: string) => {
        if (typeof chrome === 'undefined' || !chrome.runtime?.connectNative) return null;
        try {
          return chrome.runtime.connectNative(hostName) as unknown as ChromeNativePort;
        } catch {
          return null;
        }
      });

    const nextPort = connectNative(CURSOR_BRIDGE_NATIVE_HOST);
    if (!nextPort) {
      scheduleReconnect();
      return;
    }

    port = nextPort;
    log('cursor-bridge native port connected');

    post({
      type: 'hello',
      protocol: CURSOR_BRIDGE_PROTOCOL,
      version: CURSOR_BRIDGE_PROTOCOL_VERSION,
    });

    nextPort.onMessage.addListener((raw) => {
      void handleHostMessage(raw).catch((err) => {
        log(`cursor-bridge host message failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    nextPort.onDisconnect.addListener(() => {
      // Read lastError so Chrome does not surface "Unchecked runtime.lastError".
      const lastError =
        typeof chrome !== 'undefined' && chrome.runtime?.lastError
          ? chrome.runtime.lastError.message
          : null;
      const missingHost = Boolean(
        lastError
        && /native messaging host|not found|specified native messaging host/i.test(lastError),
      );
      if (missingHost) {
        log(`cursor-bridge host not installed yet (${lastError})`);
      } else if (lastError) {
        log(`cursor-bridge native port disconnected: ${lastError}`);
      } else {
        log('cursor-bridge native port disconnected');
      }
      port = null;
      setHostVaultPost(null);
      if (activeAbort) {
        activeAbort.abort();
        activeAbort = null;
        busy = false;
      }
      scheduleReconnect(missingHost ? RECONNECT_MISSING_HOST_MS : RECONNECT_MS);
    });
  };

  const scheduleReconnect = (delayMs = RECONNECT_MS) => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  };

  const post = (message: CursorBridgeExtensionToHost) => {
    try {
      port?.postMessage(message);
    } catch (err) {
      log(`cursor-bridge post failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Register fire-and-forget vault push channel for account-vault module.
  setHostVaultPost((message) => {
    try {
      port?.postMessage(message);
    } catch {
      // ignore
    }
  });

  const handleHostMessage = async (raw: unknown) => {
    if (!isCursorBridgeEnvelope(raw)) return;
    const message = raw as CursorBridgeHostToExtension;

    if (message.type === 'reload_extension') {
      post({ type: 'pong', requestId: message.requestId });
      setTimeout(() => {
        try {
          chrome.runtime.reload();
        } catch (err) {
          options.onLog?.(`reload failed: ${String(err)}`);
        }
      }, 100);
      return;
    }

    if (message.type === 'ping' || message.type === 'get_readiness') {
      const readiness = await probeCursorBridgeReadiness(options.deps, busy);
      post({
        type: message.type === 'ping' ? 'pong' : 'readiness',
        requestId: message.requestId,
        readiness,
      });
      return;
    }

    if (message.type === 'abort_job') {
      if (activeAbort) activeAbort.abort();
      return;
    }

    if (message.type === 'get_bridge_status') {
      const status = await getBridgeStatusSnapshot();
      post({ type: 'job_done', requestId: message.requestId, status } as CursorBridgeExtensionToHost);
      return;
    }

    if (message.type === 'get_eni_home') {
      const home = await buildEniHomeView();
      post({ type: 'eni_home', requestId: message.requestId, home });
      return;
    }

    if (message.type === 'get_eni_nudge') {
      const nudge = await buildEniNudgeSuggestion();
      post({ type: 'eni_nudge', requestId: message.requestId, nudge });
      return;
    }

    if (message.type === 'run_eni_dream') {
      const dream = await runEniDream({ force: true });
      post({ type: 'eni_dream', requestId: message.requestId, dream });
      return;
    }

    if (message.type === 'vault_snapshot') {
      try {
        const n = await applyHostVaultSnapshot(message.vault);
        const seeded = await seedHostVaultFromLocal();
        log(`cursor-bridge host vault snapshot applied (${n}); local→host seed ${seeded}`);
      } catch (err) {
        log(`cursor-bridge vault snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (message.type === 'vault_ack') {
      // optional ack from host upsert/remove — no-op for now
      return;
    }

    if (message.type === 'run_job') {
      await handleRunJob(message.requestId, message.job);
    }
  };

  const handleRunJob = async (requestId: string, job: CursorBridgeJobRequest) => {
    if (busy) {
      post({
        type: 'job_error',
        requestId,
        jobId: job.id,
        error: { code: 'busy', message: 'DeepSeek++ cursor bridge is busy with another request.' },
      });
      return;
    }

    busy = true;
    activeAbort = new AbortController();
    try {
      const readiness = await probeCursorBridgeReadiness(options.deps, false);
      if (!readiness.ready) {
        const code = readiness.reason === 'missing_login' ? 'missing_login' : 'not_ready';
        const messageText =
          readiness.reason === 'missing_login'
            ? 'DeepSeek login token is missing. Sign in at chat.deepseek.com once so the extension can cache your login, then retry.'
            : 'Cursor bridge is not ready.';
        post({
          type: 'job_error',
          requestId,
          jobId: job.id,
          error: { code, message: messageText },
        });
        return;
      }

      const result = await runCursorBridgeJob(
        job,
        options.deps,
        (text) => {
          post({ type: 'job_chunk', requestId, jobId: job.id, text });
        },
        activeAbort.signal,
      );

      if ('error' in result) {
        post({ type: 'job_error', requestId, jobId: job.id, error: result.error });
        return;
      }

      // User: "I want to give her tools in hermes and discord"
      // Forward OpenAI tool_calls so Hermes can execute terminal/web/etc.
      post({
        type: 'job_done',
        requestId,
        jobId: job.id,
        text: result.text,
        threadId: result.threadId,
        sticky: result.sticky,
        accountId: (result as { accountId?: string | null }).accountId ?? null,
        streamDebug: (result as { streamDebug?: unknown }).streamDebug,
        tool_calls: (result as { tool_calls?: unknown }).tool_calls,
        finish_reason: (result as { finish_reason?: 'stop' | 'tool_calls' }).finish_reason,
        tools: (result as { tools?: unknown }).tools,
      });
    } finally {
      busy = false;
      activeAbort = null;
    }
  };

  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        port?.disconnect();
      } catch {
        // ignore
      }
      port = null;
      setHostVaultPost(null);
      if (activeAbort) activeAbort.abort();
    },
  };
}
