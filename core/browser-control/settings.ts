import {
  BROWSER_CONTROL_STORAGE_KEY,
  type BrowserControlSettings,
  type BrowserControlWindowHint,
} from './types';

export const DEFAULT_BROWSER_CONTROL_SETTINGS: BrowserControlSettings = {
  enabled: true,
  targetTabId: null,
  lastTargetHint: null,
  targetLock: null,
  includeSnapshotAfterActions: false,
  allowVisionCapture: true,
  verifyAfterActions: true,
  collectEvidencePacks: true,
  debugDistillerEnabled: true,
  maxSnapshotNodes: 400,
  maxSnapshotTextBytes: 24_000,
};

const MIN_SNAPSHOT_NODES = 50;
const MAX_SNAPSHOT_NODES = 1_500;
const MIN_SNAPSHOT_TEXT_BYTES = 4_000;
const MAX_SNAPSHOT_TEXT_BYTES = 80_000;

export function normalizeBrowserControlSettings(input: unknown): BrowserControlSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ...DEFAULT_BROWSER_CONTROL_SETTINGS };
  }

  const partial = input as Partial<BrowserControlSettings>;
  return {
    enabled: partial.enabled !== false,
    targetTabId: typeof partial.targetTabId === 'number' && Number.isInteger(partial.targetTabId)
      ? partial.targetTabId
      : null,
    lastTargetHint: normalizeTargetHint(partial.lastTargetHint),
    targetLock: normalizeTargetLock(partial.targetLock),
    includeSnapshotAfterActions: partial.includeSnapshotAfterActions === true,
    allowVisionCapture: partial.allowVisionCapture !== false,
    verifyAfterActions: partial.verifyAfterActions !== false,
    collectEvidencePacks: partial.collectEvidencePacks !== false,
    debugDistillerEnabled: partial.debugDistillerEnabled !== false,
    maxSnapshotNodes: clampInteger(
      partial.maxSnapshotNodes,
      DEFAULT_BROWSER_CONTROL_SETTINGS.maxSnapshotNodes,
      MIN_SNAPSHOT_NODES,
      MAX_SNAPSHOT_NODES,
    ),
    maxSnapshotTextBytes: clampInteger(
      partial.maxSnapshotTextBytes,
      DEFAULT_BROWSER_CONTROL_SETTINGS.maxSnapshotTextBytes,
      MIN_SNAPSHOT_TEXT_BYTES,
      MAX_SNAPSHOT_TEXT_BYTES,
    ),
  };
}

export async function getBrowserControlSettings(): Promise<BrowserControlSettings> {
  const data = await chrome.storage.local.get(BROWSER_CONTROL_STORAGE_KEY) as Record<string, unknown>;
  return normalizeBrowserControlSettings(data[BROWSER_CONTROL_STORAGE_KEY]);
}

export async function saveBrowserControlSettings(
  patch: Partial<BrowserControlSettings>,
): Promise<BrowserControlSettings> {
  const current = await getBrowserControlSettings();
  const next = normalizeBrowserControlSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [BROWSER_CONTROL_STORAGE_KEY]: next });
  return next;
}

export async function setBrowserControlEnabled(enabled: boolean): Promise<BrowserControlSettings> {
  return saveBrowserControlSettings({ enabled });
}

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeTargetHint(value: unknown): BrowserControlSettings['lastTargetHint'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const hint = value as Record<string, unknown>;
  const origin = typeof hint.origin === 'string' ? hint.origin.trim() : '';
  if (!origin || origin.length > 240) return null;
  const title = typeof hint.title === 'string' ? hint.title.trim().slice(0, 160) : '';
  const updatedAt = typeof hint.updatedAt === 'number' && Number.isFinite(hint.updatedAt)
    ? Math.max(0, Math.floor(hint.updatedAt))
    : 0;
  return {
    windowId: typeof hint.windowId === 'number' && Number.isInteger(hint.windowId) ? hint.windowId : null,
    windowHint: normalizeWindowHint(hint.windowHint),
    origin,
    title,
    updatedAt,
  };
}

function normalizeTargetLock(value: unknown): BrowserControlSettings['targetLock'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const lock = value as Record<string, unknown>;
  const origin = typeof lock.origin === 'string' ? lock.origin.trim() : '';
  if (!origin || origin.length > 240) return null;
  const updatedAt = typeof lock.updatedAt === 'number' && Number.isFinite(lock.updatedAt)
    ? Math.max(0, Math.floor(lock.updatedAt))
    : 0;
  const rawLabel = typeof lock.label === 'string' ? lock.label.trim() : '';
  return {
    enabled: lock.enabled !== false,
    label: rawLabel ? rawLabel.slice(0, 40) : 'Dev++',
    targetTabId: typeof lock.targetTabId === 'number' && Number.isInteger(lock.targetTabId)
      ? lock.targetTabId
      : null,
    windowId: typeof lock.windowId === 'number' && Number.isInteger(lock.windowId) ? lock.windowId : null,
    windowHint: normalizeWindowHint(lock.windowHint),
    groupId: typeof lock.groupId === 'number' && Number.isInteger(lock.groupId) ? lock.groupId : null,
    origin,
    updatedAt,
  };
}

function normalizeWindowHint(value: unknown): BrowserControlWindowHint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const hint = value as Record<string, unknown>;
  return {
    left: normalizeOptionalWindowInteger(hint.left),
    top: normalizeOptionalWindowInteger(hint.top),
    width: normalizeOptionalWindowInteger(hint.width),
    height: normalizeOptionalWindowInteger(hint.height),
    state: typeof hint.state === 'string' && /^[a-z_ -]{1,32}$/i.test(hint.state)
      ? hint.state.slice(0, 32)
      : null,
  };
}

function normalizeOptionalWindowInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : null;
}
