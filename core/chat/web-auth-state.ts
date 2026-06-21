const STORAGE_KEY = 'deepseek_pp_sidepanel_web_auth_rejected';

type SessionStorageArea = Pick<chrome.storage.SessionStorageArea, 'get' | 'set' | 'remove'>;

export async function markSidepanelWebAuthRejected(): Promise<void> {
  const storage = getSessionStorageArea();
  if (!storage) return;
  await storage.set({ [STORAGE_KEY]: true });
}

export async function clearSidepanelWebAuthRejected(): Promise<void> {
  const storage = getSessionStorageArea();
  if (!storage) return;
  await storage.remove(STORAGE_KEY);
}

export async function isSidepanelWebAuthRejected(): Promise<boolean> {
  const storage = getSessionStorageArea();
  if (!storage) return false;
  const data = await storage.get(STORAGE_KEY) as Record<string, unknown>;
  return data[STORAGE_KEY] === true;
}

function getSessionStorageArea(): SessionStorageArea | null {
  if (typeof chrome === 'undefined') return null;
  return chrome.storage?.session ?? null;
}
