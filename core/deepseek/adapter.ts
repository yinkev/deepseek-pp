// Compatibility facade for callers that have not yet migrated to the active-client port.
import * as activeClient from './active-client';
import type { DeepSeekHistorySnapshot as ActiveDeepSeekHistorySnapshot } from './automation-client-port';

export * from './active-client';
export { getLastStreamParseDebug, lastStreamParseDebug } from './stream-codec';

export type DeepSeekHistorySnapshot = ActiveDeepSeekHistorySnapshot & {
  /** Best-effort full assistant text for stream repair. */
  assistantText?: string | null;
};

const DEFAULT_APP_VERSION = '2.0.0';
const DEEPSEEK_CLIENT_PLATFORM = 'web';
const USER_TOKEN_STORAGE_KEY = 'userToken';

/**
 * Prefer the live page token over remembered headers so an account switch cannot
 * accidentally reuse the previous account's authorization value.
 */
export function createClientHeaders(options?: { missingTokenMessage?: string }): Record<string, string> {
  const token = readDeepSeekUserToken();
  if (!token) return activeClient.createClientHeaders(options);

  let remembered: Record<string, string> = {};
  try {
    remembered = activeClient.createClientHeaders(options);
  } catch {
    // A live page token is sufficient to rebuild the released client headers.
  }

  const appVersion = remembered['X-App-Version'] || DEFAULT_APP_VERSION;
  const headers = {
    ...remembered,
    Authorization: `Bearer ${token}`,
    'X-App-Version': appVersion,
    'x-client-platform': remembered['x-client-platform'] || DEEPSEEK_CLIENT_PLATFORM,
    'x-client-version': remembered['x-client-version'] || appVersion,
    'x-client-locale': remembered['x-client-locale'] || getDeepSeekLocale(),
    'x-client-timezone-offset':
      remembered['x-client-timezone-offset'] || String(-new Date().getTimezoneOffset() * 60),
  };
  activeClient.rememberDeepSeekClientHeaders(headers);
  return headers;
}

export async function saveClientHeadersToStorage(): Promise<boolean> {
  const saved = await activeClient.saveClientHeadersToStorage();
  if (!saved) return false;

  try {
    const headers = createClientHeaders();
    const { upsertAccountFromHeaders } = await import('../cursor-bridge/account-vault');
    await upsertAccountFromHeaders(headers);
  } catch {
    // The multi-account vault is an optional compatibility enhancement.
  }
  return true;
}

/**
 * Preserve the compatibility facade's best-effort history text without moving
 * network ownership back out of the extracted active client.
 */
export async function readHistorySnapshot(
  chatSessionId: string,
  expectedAssistantMessageId: number,
  clientHeadersOverride?: Record<string, string>,
  signal?: AbortSignal,
): Promise<DeepSeekHistorySnapshot | null> {
  let historyPayload: Promise<unknown> | null = null;
  const baseFetch = globalThis.fetch.bind(globalThis);
  const client = activeClient.createDeepSeekAutomationClient({
    fetchImpl: async (input, init) => {
      const response = await baseFetch(input, init);
      historyPayload = response.clone().json().catch(() => null);
      return response;
    },
  });
  const clientHeaders = clientHeadersOverride ?? createClientHeaders();
  const snapshot = await client.readHistorySnapshot(
    chatSessionId,
    expectedAssistantMessageId,
    clientHeaders,
    { signal },
  );
  if (!snapshot) return null;

  const payload = historyPayload ? await historyPayload : null;
  return {
    ...snapshot,
    assistantText: extractHistoryAssistantText(payload, expectedAssistantMessageId),
  };
}

function extractHistoryAssistantText(payload: unknown, expectedAssistantMessageId: number): string | null {
  const root = payload && typeof payload === 'object' ? payload as Record<string, any> : {};
  const data = root.data?.biz_data ?? root.data ?? root.biz_data ?? root;
  const rawMessages: unknown[] = Array.isArray(data?.chat_messages) ? data.chat_messages : [];
  const messages = rawMessages
    .map((raw) => normalizeHistoryMessage(raw))
    .filter((message): message is { id: number; role: string | null; content: string | null } => message.id !== null);
  const expected = messages.find((message) => message.id === expectedAssistantMessageId);
  const latestAssistant = expected
    ?? [...messages].reverse().find((message) => message.role !== 'user')
    ?? messages.at(-1);
  return latestAssistant?.content ?? null;
}

function normalizeHistoryMessage(raw: unknown): {
  id: number | null;
  role: string | null;
  content: string | null;
} {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    id: firstMessageId(value.message_id, value.id, value.uuid),
    role: firstString(value.message_role, value.role)?.toLowerCase() ?? null,
    content: extractHistoryMessageContent(value),
  };
}

function extractHistoryMessageContent(value: Record<string, unknown>): string | null {
  const direct = firstString(value.content, value.text, value.markdown, value.answer, value.accumulated_content);
  if (direct) return direct;

  const response = value.response && typeof value.response === 'object'
    ? value.response as Record<string, unknown>
    : null;
  const fromResponse = response
    ? firstString(response.content, response.text, response.markdown)
    : null;
  if (fromResponse) return fromResponse;

  const fragments = value.fragments
    ?? value.response_fragments
    ?? response?.fragments
    ?? (value.biz_data && typeof value.biz_data === 'object'
      ? (value.biz_data as Record<string, unknown>).fragments
      : undefined);
  if (Array.isArray(fragments)) {
    const parts = fragments
      .map((fragment) => fragment && typeof fragment === 'object'
        ? firstString(
          (fragment as Record<string, unknown>).content,
          (fragment as Record<string, unknown>).text,
          (fragment as Record<string, unknown>).markdown,
        ) ?? ''
        : '')
      .filter(Boolean);
    if (parts.length > 0) return parts.join('');
  }

  if (Array.isArray(value.content)) {
    const parts = value.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const record = part as Record<string, unknown>;
        return firstString(record.text, record.content) ?? '';
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join('');
  }

  const nested = value.message;
  return nested && typeof nested === 'object'
    ? extractHistoryMessageContent(nested as Record<string, unknown>)
    : null;
}

function readDeepSeekUserToken(): string | null {
  try {
    const raw = localStorage.getItem(USER_TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = tryParseJson(raw);
    if (typeof parsed === 'string') return parsed.trim() || null;
    if (parsed && typeof parsed === 'object') {
      return firstString(
        (parsed as Record<string, unknown>).token,
        (parsed as Record<string, unknown>).value,
        (parsed as Record<string, unknown>).accessToken,
      );
    }
    if (raw.trim() === 'null') return null;
    return raw.trim() || null;
  } catch {
    return null;
  }
}

function getDeepSeekLocale(): string {
  return document.documentElement.lang || navigator.language || 'en-US';
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstMessageId(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF) {
      return value;
    }
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      const parsed = Number(value.trim());
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xFFFFFFFF) return parsed;
    }
  }
  return null;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
