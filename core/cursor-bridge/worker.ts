import {
  createChatSession,
  createClientHeaders,
  createPowHeaders,
  DeepSeekAuthError,
  submitPromptStreaming,
} from '../deepseek/adapter';
import type { CursorBridgeError, CursorBridgeJobRequest, CursorBridgeReadiness } from './protocol';
import { messagesToPrompt } from './protocol';

const DEEPSEEK_TAB_URL_PATTERN = '*://chat.deepseek.com/*';

export interface CursorBridgeWorkerDeps {
  loadClientHeaders: () => Promise<Record<string, string> | null>;
  refreshClientHeadersFromTabs?: () => Promise<boolean>;
  queryDeepSeekTabs?: () => Promise<Array<{ id?: number }>>;
  createSession?: typeof createChatSession;
  createPow?: typeof createPowHeaders;
  submitStreaming?: typeof submitPromptStreaming;
}

export async function probeCursorBridgeReadiness(
  deps: CursorBridgeWorkerDeps,
  busy: boolean,
): Promise<CursorBridgeReadiness> {
  const queryTabs = deps.queryDeepSeekTabs ?? defaultQueryDeepSeekTabs;
  const tabs = await queryTabs();
  const hasDeepSeekTab = tabs.length > 0;

  let headers = await deps.loadClientHeaders();
  if (!headers && deps.refreshClientHeadersFromTabs) {
    await deps.refreshClientHeadersFromTabs();
    headers = await deps.loadClientHeaders();
  }
  const hasLogin = Boolean(headers?.Authorization);

  const ready = hasDeepSeekTab && hasLogin && !busy;
  let reason: string | undefined;
  if (!hasDeepSeekTab) reason = 'missing_tab';
  else if (!hasLogin) reason = 'missing_login';
  else if (busy) reason = 'busy';

  return {
    ready,
    extensionAlive: true,
    hasDeepSeekTab,
    hasLogin,
    busy,
    reason,
  };
}

export async function runCursorBridgeJob(
  job: CursorBridgeJobRequest,
  deps: CursorBridgeWorkerDeps,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string } | { error: CursorBridgeError }> {
  try {
    let headers = await deps.loadClientHeaders();
    if (!headers && deps.refreshClientHeadersFromTabs) {
      await deps.refreshClientHeadersFromTabs();
      headers = await deps.loadClientHeaders();
    }
    if (!headers?.Authorization) {
      return {
        error: {
          code: 'missing_login',
          message: 'DeepSeek login token is missing. Sign in at chat.deepseek.com and refresh the page.',
        },
      };
    }

    const queryTabs = deps.queryDeepSeekTabs ?? defaultQueryDeepSeekTabs;
    const tabs = await queryTabs();
    if (tabs.length === 0) {
      return {
        error: {
          code: 'missing_tab',
          message: 'Open a logged-in chat.deepseek.com tab with DeepSeek++ active, then retry.',
        },
      };
    }

    const createSession = deps.createSession ?? createChatSession;
    const createPow = deps.createPow ?? createPowHeaders;
    const submitStreaming = deps.submitStreaming ?? submitPromptStreaming;

    const prompt = messagesToPrompt(job.messages);
    if (!prompt) {
      return { error: { code: 'invalid_request', message: 'Prompt is empty.' } };
    }

    const chatSessionId = await createSession(headers);
    const powHeaders = await createPow(headers);
    let fullText = '';

    const turn = await submitStreaming(
      {
        chatSessionId,
        parentMessageId: null,
        modelType: 'default',
        prompt,
        refFileIds: [],
        thinkingEnabled: job.thinkingEnabled,
        searchEnabled: false,
        clientHeaders: headers,
        powHeaders,
      },
      {
        onTextChunk(newText, full) {
          fullText = full;
          if (newText) onChunk(newText);
        },
      },
      signal,
    );

    const text = fullText || turn.assistantText || '';
    return { text };
  } catch (err) {
    if (err instanceof DeepSeekAuthError) {
      return {
        error: {
          code: 'missing_login',
          message: err.message,
        },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (signal?.aborted) {
      return { error: { code: 'aborted', message: 'Request aborted.' } };
    }
    return { error: { code: 'upstream_error', message } };
  }
}

/** Used by tests / hosts that only need header construction without chrome. */
export function createClientHeadersSafe(): Record<string, string> | null {
  try {
    return createClientHeaders();
  } catch {
    return null;
  }
}

async function defaultQueryDeepSeekTabs(): Promise<Array<{ id?: number }>> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return [];
  return chrome.tabs.query({ url: DEEPSEEK_TAB_URL_PATTERN });
}
