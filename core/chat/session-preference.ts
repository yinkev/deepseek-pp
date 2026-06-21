export type DeepSeekWebSessionStrategy = 'current' | 'last' | 'new';

export interface DeepSeekWebLastSession {
  chatSessionId: string;
  parentMessageId: number | null;
  source: 'sidepanel' | 'automation';
  updatedAt: number;
}

export interface DeepSeekWebSessionPreference {
  lastSession: DeepSeekWebLastSession | null;
}

const STORAGE_KEY = 'deepseek_pp_deepseek_web_session_preference';

type LocalStorageArea = Pick<chrome.storage.LocalStorageArea, 'get' | 'set' | 'remove'>;

export async function getDeepSeekWebSessionPreference(): Promise<DeepSeekWebSessionPreference> {
  const storage = getLocalStorageArea();
  if (!storage) return { lastSession: null };
  const data = await storage.get(STORAGE_KEY) as Record<string, unknown>;
  const normalized = normalizeDeepSeekWebSessionPreference(data[STORAGE_KEY]);
  if (!normalized) {
    await storage.remove(STORAGE_KEY);
    return { lastSession: null };
  }
  return normalized;
}

export async function rememberDeepSeekWebSession(
  session: {
    chatSessionId: string | null;
    parentMessageId: number | null;
  },
  source: DeepSeekWebLastSession['source'],
  updatedAt = Date.now(),
): Promise<DeepSeekWebSessionPreference> {
  const chatSessionId = normalizeChatSessionId(session.chatSessionId);
  if (!chatSessionId) return getDeepSeekWebSessionPreference();
  const next: DeepSeekWebSessionPreference = {
    lastSession: {
      chatSessionId,
      parentMessageId: normalizeParentMessageId(session.parentMessageId),
      source,
      updatedAt,
    },
  };
  const storage = getLocalStorageArea();
  if (storage) await storage.set({ [STORAGE_KEY]: next });
  return next;
}

export async function clearDeepSeekWebLastSession(): Promise<void> {
  const storage = getLocalStorageArea();
  if (!storage) return;
  await storage.remove(STORAGE_KEY);
}

export function normalizeDeepSeekWebSessionPreference(value: unknown): DeepSeekWebSessionPreference | null {
  if (!value || typeof value !== 'object') return { lastSession: null };
  const record = value as Record<string, unknown>;
  return {
    lastSession: normalizeDeepSeekWebLastSession(record.lastSession),
  };
}

export function isDeepSeekWebSessionStrategy(value: unknown): value is DeepSeekWebSessionStrategy {
  return value === 'current' || value === 'last' || value === 'new';
}

function normalizeDeepSeekWebLastSession(value: unknown): DeepSeekWebLastSession | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const chatSessionId = normalizeChatSessionId(record.chatSessionId);
  if (!chatSessionId) return null;
  return {
    chatSessionId,
    parentMessageId: normalizeParentMessageId(record.parentMessageId),
    source: record.source === 'automation' ? 'automation' : 'sidepanel',
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : Date.now(),
  };
}

function normalizeChatSessionId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeParentMessageId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function getLocalStorageArea(): LocalStorageArea | null {
  if (typeof chrome === 'undefined') return null;
  return chrome.storage?.local ?? null;
}
