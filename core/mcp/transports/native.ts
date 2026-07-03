import type {
  McpJsonRpcNotification,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpProtocolTransport,
  McpServerConfig,
} from '../types';
import { McpTransportError, normalizeJsonRpcResponse } from './common';
import { MULTIMODAL_MCP_NATIVE_HOST } from '../../multimodal';
import { getMultimodalNativeEnv } from '../../multimodal/settings';
import { SHELL_MCP_NATIVE_HOST } from '../../shell';

interface McpNativeEnvelope {
  protocol: 'deepseek-pp-mcp-native';
  version: 1;
  server: {
    id: string;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
  message: McpJsonRpcRequest<any> | McpJsonRpcNotification;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface NativePortState {
  port: chrome.runtime.Port;
  pendingRequests: Map<number | string, PendingRequest>;
}

const MAX_NATIVE_MESSAGE_BYTES = 9 * 1024 * 1024;
const MAX_LOCAL_FILE_WRITE_BYTES = 2_000_000;

const nativePortStates = new Map<string, NativePortState>();

function getPortState(nativeHost: string): NativePortState {
  const existing = nativePortStates.get(nativeHost);
  if (existing) return existing;

  if (!chrome.runtime?.connectNative) {
    throw new McpTransportError('mcp_native_messaging_unavailable', 'Browser native messaging is unavailable.', {
      retryable: false,
    });
  }

  const port = chrome.runtime.connectNative(nativeHost);
  const state: NativePortState = {
    port,
    pendingRequests: new Map(),
  };
  nativePortStates.set(nativeHost, state);

  port.onMessage.addListener((response: any) => {
    const id = response?.id ?? response?.result?.id;
    const rpcId = response?.jsonrpc === '2.0' ? response.id : id;
    if (rpcId != null && state.pendingRequests.has(rpcId)) {
      const pending = state.pendingRequests.get(rpcId)!;
      state.pendingRequests.delete(rpcId);
      clearTimeout(pending.timer);
      pending.resolve(response);
    }
  });

  port.onDisconnect.addListener(() => {
    const err = new McpTransportError(
      'mcp_native_host_disconnected',
      chrome.runtime.lastError?.message || 'Native host disconnected.',
      { retryable: true },
    );
    for (const pending of state.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    state.pendingRequests.clear();
    nativePortStates.delete(nativeHost);
  });

  return state;
}

export function createMcpNativeMessagingTransport(server: McpServerConfig): McpProtocolTransport {
  return {
    request(request, options) {
      return sendNativeMessage(server, request, options?.timeoutMs);
    },
    async notify(notification, options) {
      await sendNativeMessage(server, notification, options?.timeoutMs);
    },
  };
}

async function sendNativeMessage<TParams extends Record<string, unknown> | undefined, TResult>(
  server: McpServerConfig,
  message: McpJsonRpcRequest<TParams> | McpJsonRpcNotification,
  timeoutMs: number = server.timeouts.requestMs,
): Promise<McpJsonRpcResponse<TResult>> {
  const nativeHost = server.transport.nativeHost;
  if (!nativeHost) {
    throw new McpTransportError('mcp_native_host_missing', 'Native messaging host is not configured.', {
      retryable: false,
    });
  }

  const expectedRequest = 'id' in message ? message as McpJsonRpcRequest<TParams> : undefined;
  const envelope = await createNativeEnvelope(server, message);
  if (expectedRequest) {
    assertNativePayloadSize(nativeHost, envelope);
  }

  let response: unknown;
  if (expectedRequest) {
    response = await sendAndWait(nativeHost, envelope, expectedRequest.id, timeoutMs);
  } else {
    const state = getPortState(nativeHost);
    state.port.postMessage(envelope);
    return undefined as any;
  }

  return normalizeJsonRpcResponse<TResult>(response, expectedRequest);
}

function sendAndWait(
  nativeHost: string,
  envelope: McpNativeEnvelope,
  requestId: number | string,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let state: NativePortState;
    try {
      state = getPortState(nativeHost);
    } catch (err) {
      reject(err);
      return;
    }

    const timer = setTimeout(() => {
      state.pendingRequests.delete(requestId);
      reject(new McpTransportError('mcp_native_timeout', `Native MCP request exceeded ${timeoutMs} ms.`));
    }, timeoutMs);

    state.pendingRequests.set(requestId, { resolve, reject, timer });
    try {
      state.port.postMessage(envelope);
    } catch (err) {
      clearTimeout(timer);
      state.pendingRequests.delete(requestId);
      reject(err);
    }
  });
}

async function createNativeEnvelope(
  server: McpServerConfig,
  message: McpJsonRpcRequest<any> | McpJsonRpcNotification,
): Promise<McpNativeEnvelope> {
  const env = await createNativeEnv(server);
  return {
    protocol: 'deepseek-pp-mcp-native',
    version: 1,
    server: {
      id: server.id,
      command: server.transport.command,
      args: server.transport.args,
      cwd: server.transport.cwd,
      env,
    },
    message,
  };
}

function assertNativePayloadSize(nativeHost: string, envelope: McpNativeEnvelope): void {
  if (nativeHost !== SHELL_MCP_NATIVE_HOST) return;
  const writeContent = getLocalFileWriteContent(envelope.message);
  if (writeContent !== null) {
    const contentBytes = new Blob([writeContent]).size;
    if (contentBytes > MAX_LOCAL_FILE_WRITE_BYTES) {
      throw new McpTransportError(
        'mcp_native_payload_too_large',
        `local_file_write content is too large (${contentBytes} bytes > ${MAX_LOCAL_FILE_WRITE_BYTES}). Split the file into smaller chunks or write a smaller section.`,
        { retryable: false },
      );
    }
    if (contentBytes <= MAX_LOCAL_FILE_WRITE_BYTES && contentBytes > MAX_NATIVE_MESSAGE_BYTES / 2) {
      return;
    }
  }

  const envelopeBytes = new Blob([JSON.stringify(envelope)]).size;
  if (envelopeBytes > MAX_NATIVE_MESSAGE_BYTES) {
    throw new McpTransportError(
      'mcp_native_payload_too_large',
      `Native MCP request is too large (${envelopeBytes} bytes > ${MAX_NATIVE_MESSAGE_BYTES}). Split the request into smaller tool calls.`,
      { retryable: false },
    );
  }
}

function getLocalFileWriteContent(message: McpJsonRpcRequest<any> | McpJsonRpcNotification): string | null {
  if (message.method !== 'tools/call') return null;
  const params = message.params as { name?: unknown; arguments?: { content?: unknown } } | undefined;
  if (params?.name !== 'local_file_write') return null;
  const content = params.arguments?.content;
  return typeof content === 'string' ? content : null;
}

async function createNativeEnv(server: McpServerConfig): Promise<Record<string, string> | undefined> {
  if (server.transport.nativeHost === MULTIMODAL_MCP_NATIVE_HOST) {
    const env = await getMultimodalNativeEnv();
    return Object.keys(env).length > 0 ? env : undefined;
  }

  const env: Record<string, string> = { ...(server.transport.env ?? {}) };
  return Object.keys(env).length > 0 ? env : undefined;
}
