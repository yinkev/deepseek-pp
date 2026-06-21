const STORAGE_KEY = 'deepseek_pp_sidepanel_web_chat_session';

export interface SidepanelWebChatSessionState {
  chatSessionId: string | null;
  parentMessageId: number | null;
}

export interface ActiveSidepanelWebChatSessionState {
  chatSessionId: string;
  parentMessageId: number | null;
}

type SessionStorageArea = Pick<chrome.storage.SessionStorageArea, 'get' | 'set' | 'remove'>;

export async function getOrCreateSidepanelWebChatSession(
  current: SidepanelWebChatSessionState,
  createSession: () => Promise<string>,
): Promise<ActiveSidepanelWebChatSessionState> {
  if (current.chatSessionId) {
    return {
      chatSessionId: current.chatSessionId,
      parentMessageId: current.parentMessageId,
    };
  }

  const stored = await loadSidepanelWebChatSessionState();
  if (stored?.chatSessionId) {
    return {
      chatSessionId: stored.chatSessionId,
      parentMessageId: stored.parentMessageId,
    };
  }

  const chatSessionId = await createSession();
  const next = { chatSessionId, parentMessageId: null };
  await saveSidepanelWebChatSessionState(next);
  return next;
}

export async function saveSidepanelWebChatSessionState(
  state: ActiveSidepanelWebChatSessionState,
): Promise<void> {
  const storage = getSessionStorageArea();
  if (!storage) return;
  await storage.set({ [STORAGE_KEY]: state });
}

export async function loadSidepanelWebChatSessionState(): Promise<SidepanelWebChatSessionState | null> {
  const storage = getSessionStorageArea();
  if (!storage) return null;
  const data = await storage.get(STORAGE_KEY) as Record<string, unknown>;
  const normalized = normalizeSidepanelWebChatSessionState(data[STORAGE_KEY]);
  if (!normalized) {
    await storage.remove(STORAGE_KEY);
    return null;
  }
  return normalized;
}

export async function clearSidepanelWebChatSessionState(): Promise<void> {
  const storage = getSessionStorageArea();
  if (!storage) return;
  await storage.remove(STORAGE_KEY);
}

export function normalizeSidepanelWebChatSessionState(
  value: unknown,
): SidepanelWebChatSessionState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const chatSessionId = normalizeChatSessionId(record.chatSessionId);
  if (!chatSessionId) return null;
  return {
    chatSessionId,
    parentMessageId: normalizeParentMessageId(record.parentMessageId),
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

function getSessionStorageArea(): SessionStorageArea | null {
  if (typeof chrome === 'undefined') return null;
  return chrome.storage?.session ?? null;
}
