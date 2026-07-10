/** Durable bridge-thread bindings (sticky DeepSeek main sessions). */

export type BridgeThreadModelFamily = 'octopus' | 'octopus-eyes' | 'squid';

export interface BridgeThreadRecord {
  id: string;
  modelFamily: BridgeThreadModelFamily;
  chatSessionId: string;
  parentMessageId: number | null;
  modelType: string;
  sessionUrl: string | null;
  createdAt: number;
  updatedAt: number;
  turnCount: number;
}

export interface BridgeThreadStoreSnapshot {
  version: 1;
  threads: Record<string, BridgeThreadRecord>;
  /** imageHash → eyes notes (P4 cache) */
  eyesCache: Record<string, { notes: string; updatedAt: number }>;
  lastError: string | null;
  lastModel: string | null;
  lastThreadId: string | null;
}

const STORAGE_KEY = 'cursorBridgeThreadStore';
const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EYES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_THREADS = 40;
const MAX_EYES_CACHE = 30;

const memory: BridgeThreadStoreSnapshot = {
  version: 1,
  threads: {},
  eyesCache: {},
  lastError: null,
  lastModel: null,
  lastThreadId: null,
};

let loaded = false;

export function modelFamilyFromBridgeModel(model: string | undefined): BridgeThreadModelFamily {
  const lower = (model ?? '').toLowerCase();
  if (lower.includes('octopus-eyes') || lower.endsWith('-eyes') || lower.endsWith('/eyes') || lower.includes('vision')) {
    return 'octopus-eyes';
  }
  if (lower.includes('squid') || lower.includes('flash') || lower.includes('instant')) {
    return 'squid';
  }
  return 'octopus';
}

export async function loadBridgeThreadStore(): Promise<BridgeThreadStoreSnapshot> {
  if (loaded) return memory;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const raw = data[STORAGE_KEY];
      if (raw && typeof raw === 'object') {
        const record = raw as Partial<BridgeThreadStoreSnapshot>;
        memory.threads = record.threads && typeof record.threads === 'object' ? record.threads : {};
        memory.eyesCache = record.eyesCache && typeof record.eyesCache === 'object' ? record.eyesCache : {};
        memory.lastError = typeof record.lastError === 'string' ? record.lastError : null;
        memory.lastModel = typeof record.lastModel === 'string' ? record.lastModel : null;
        memory.lastThreadId = typeof record.lastThreadId === 'string' ? record.lastThreadId : null;
      }
    } catch {
      // keep memory defaults
    }
  }
  pruneExpired(memory);
  loaded = true;
  return memory;
}

async function persist(): Promise<void> {
  pruneExpired(memory);
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: { ...memory, version: 1 as const } });
    } catch {
      // ignore
    }
  }
}

function pruneExpired(store: BridgeThreadStoreSnapshot): void {
  const now = Date.now();
  for (const [id, thread] of Object.entries(store.threads)) {
    if (now - thread.updatedAt > THREAD_TTL_MS) delete store.threads[id];
  }
  for (const [hash, entry] of Object.entries(store.eyesCache)) {
    if (now - entry.updatedAt > EYES_CACHE_TTL_MS) delete store.eyesCache[hash];
  }
  const threadIds = Object.keys(store.threads);
  if (threadIds.length > MAX_THREADS) {
    threadIds
      .sort((a, b) => store.threads[a].updatedAt - store.threads[b].updatedAt)
      .slice(0, threadIds.length - MAX_THREADS)
      .forEach((id) => delete store.threads[id]);
  }
  const eyeKeys = Object.keys(store.eyesCache);
  if (eyeKeys.length > MAX_EYES_CACHE) {
    eyeKeys
      .sort((a, b) => store.eyesCache[a].updatedAt - store.eyesCache[b].updatedAt)
      .slice(0, eyeKeys.length - MAX_EYES_CACHE)
      .forEach((k) => delete store.eyesCache[k]);
  }
}

/** Resolve thread id: explicit header/body > fingerprint. */
export function resolveThreadId(input: {
  explicitThreadId?: string | null;
  model: string;
  messages: Array<{ role: string; content: string }>;
  reset?: boolean;
}): string {
  const explicit = (input.explicitThreadId ?? '').trim();
  if (explicit && !input.reset) return explicit.slice(0, 128);

  const family = modelFamilyFromBridgeModel(input.model);
  const firstUser = input.messages.find((m) => m.role === 'user')?.content ?? '';
  const seed = firstUser.slice(0, 240);
  const hash = simpleHash(`${family}\n${seed}`);
  return `fp-${family}-${hash}`;
}

export async function getThread(threadId: string): Promise<BridgeThreadRecord | null> {
  const store = await loadBridgeThreadStore();
  return store.threads[threadId] ?? null;
}

export async function putThread(record: BridgeThreadRecord): Promise<void> {
  const store = await loadBridgeThreadStore();
  store.threads[record.id] = record;
  store.lastThreadId = record.id;
  store.lastModel = record.modelType;
  await persist();
}

export async function deleteThread(threadId: string): Promise<void> {
  const store = await loadBridgeThreadStore();
  delete store.threads[threadId];
  if (store.lastThreadId === threadId) store.lastThreadId = null;
  await persist();
}

export async function setBridgeLastError(message: string | null): Promise<void> {
  const store = await loadBridgeThreadStore();
  store.lastError = message;
  await persist();
}

export async function getEyesCache(imageHash: string): Promise<string | null> {
  const store = await loadBridgeThreadStore();
  const entry = store.eyesCache[imageHash];
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > EYES_CACHE_TTL_MS) {
    delete store.eyesCache[imageHash];
    await persist();
    return null;
  }
  return entry.notes;
}

export async function setEyesCache(imageHash: string, notes: string): Promise<void> {
  const store = await loadBridgeThreadStore();
  store.eyesCache[imageHash] = { notes, updatedAt: Date.now() };
  await persist();
}

export async function getBridgeStatusSnapshot(): Promise<{
  threadCount: number;
  eyesCacheCount: number;
  lastError: string | null;
  lastModel: string | null;
  lastThreadId: string | null;
  lastSessionUrl: string | null;
}> {
  const store = await loadBridgeThreadStore();
  const last = store.lastThreadId ? store.threads[store.lastThreadId] : null;
  return {
    threadCount: Object.keys(store.threads).length,
    eyesCacheCount: Object.keys(store.eyesCache).length,
    lastError: store.lastError,
    lastModel: store.lastModel,
    lastThreadId: store.lastThreadId,
    lastSessionUrl: last?.sessionUrl ?? null,
  };
}

/** Stable short hash for fingerprints / image cache keys. */
export function simpleHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Test helper: reset in-memory store without chrome.storage. */
export function __resetBridgeThreadStoreForTests(): void {
  memory.threads = {};
  memory.eyesCache = {};
  memory.lastError = null;
  memory.lastModel = null;
  memory.lastThreadId = null;
  loaded = true;
}
