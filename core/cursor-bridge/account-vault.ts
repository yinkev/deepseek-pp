/**
 * Multi-account vault for bridge DeepSeek web logins.
 *
 * Callers: worker (pick headers), content/adapter (upsert on capture), health.
 * User: multi-account without breaking ENI (stale token 40003).
 *
 * Rules:
 * - Live capture upserts only — never wipe other vault slots.
 * - Sticky may pin accountId only while that slot still exists.
 * - markAccountUsed never rewrites the live legacy cache.
 * - Default pick is freshest; rotate is opt-in for multi-account spread.
 * - Auth failure NEVER deletes vault slots — soft-fail cooldown + exclude only.
 * - Host disk vault is multi-account SoT when native host is connected.
 */

import {
  pushVaultMarkUsedToHost,
  pushVaultRemoveToHost,
  pushVaultUpsertToHost,
} from './host-vault-bridge';

export interface BridgeAccount {
  id: string;
  label: string;
  headers: Record<string, string>;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  useCount: number;
  /** Soft-fail: last auth error code/message (no secrets). */
  lastErrorCode?: string | null;
  lastErrorAt?: number | null;
  /** Soft-fail: skip in pick until this timestamp (ms). */
  cooldownUntil?: number | null;
}

export interface BridgeAccountVaultSnapshot {
  version: 1;
  accounts: Record<string, BridgeAccount>;
  order: string[];
  rrIndex: number;
  defaultAccountId: string | null;
}

const STORAGE_KEY = 'cursorBridgeAccountVault';
const LEGACY_HEADERS_KEY = 'deepseekCachedClientHeaders';
const MAX_ACCOUNTS = 8;

const memory: BridgeAccountVaultSnapshot = {
  version: 1,
  accounts: {},
  order: [],
  rrIndex: 0,
  defaultAccountId: null,
};

let rehydrating = false;

/** Test-only: clear the module-global vault so cases cannot leak tokens. */
export function __resetBridgeAccountVaultForTests(): void {
  memory.accounts = {};
  memory.order = [];
  memory.rrIndex = 0;
  memory.defaultAccountId = null;
  rehydrating = false;
}

function tokenFingerprint(authorization: string): string {
  const raw = authorization.replace(/^Bearer\s+/i, '').trim();
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `ds-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

async function rehydrateFromStorage(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  if (rehydrating) return;
  rehydrating = true;
  try {
    const data = await chrome.storage.local.get([STORAGE_KEY, LEGACY_HEADERS_KEY]);
    const raw = data[STORAGE_KEY];
    if (raw && typeof raw === 'object') {
      const snap = raw as Partial<BridgeAccountVaultSnapshot>;
      memory.accounts = snap.accounts && typeof snap.accounts === 'object' ? { ...snap.accounts } : {};
      memory.order = Array.isArray(snap.order) ? [...snap.order] : Object.keys(memory.accounts);
      memory.rrIndex = typeof snap.rrIndex === 'number' ? snap.rrIndex : 0;
      memory.defaultAccountId = typeof snap.defaultAccountId === 'string' ? snap.defaultAccountId : null;
    }
    const legacy = data[LEGACY_HEADERS_KEY] as Record<string, string> | undefined;
    if (legacy?.Authorization) {
      upsertInMemory(legacy, { skipLegacySync: true, touchUpdatedAt: true });
      await persist();
    }
  } catch {
    // keep defaults
  } finally {
    rehydrating = false;
  }
}

function upsertInMemory(
  headers: Record<string, string>,
  options?: { label?: string; makeDefault?: boolean; skipLegacySync?: boolean; touchUpdatedAt?: boolean },
): BridgeAccount | null {
  const auth = headers?.Authorization;
  if (!auth) return null;
  const now = Date.now();
  const id = tokenFingerprint(auth);
  const existing = memory.accounts[id];
  const label = (options?.label ?? existing?.label ?? `account-${memory.order.length + 1}`).slice(0, 48);
  const next: BridgeAccount = {
    id,
    label,
    headers: { ...headers },
    createdAt: existing?.createdAt ?? now,
    updatedAt: options?.touchUpdatedAt === false ? (existing?.updatedAt ?? now) : now,
    lastUsedAt: existing?.lastUsedAt ?? 0,
    useCount: existing?.useCount ?? 0,
    // Successful recapture clears soft-fail state.
    lastErrorCode: null,
    lastErrorAt: null,
    cooldownUntil: null,
  };
  memory.accounts[id] = next;
  if (!memory.order.includes(id)) {
    memory.order.push(id);
    while (memory.order.length > MAX_ACCOUNTS) {
      const drop = memory.order.shift();
      if (drop) delete memory.accounts[drop];
    }
  }
  if (options?.makeDefault || !memory.defaultAccountId) {
    memory.defaultAccountId = id;
  }
  return next;
}

async function persist(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        version: 1 as const,
        accounts: memory.accounts,
        order: memory.order,
        rrIndex: memory.rrIndex,
        defaultAccountId: memory.defaultAccountId,
      },
    });
  } catch {
    // ignore
  }
}

async function writeLegacyHeaders(headers: Record<string, string>): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    if (headers?.Authorization) {
      await chrome.storage.local.set({ [LEGACY_HEADERS_KEY]: headers });
    }
  } catch {
    // ignore
  }
}

export async function listBridgeAccounts(): Promise<Array<{
  id: string;
  label: string;
  useCount: number;
  lastUsedAt: number;
  updatedAt: number;
  lastErrorCode?: string | null;
  cooldownUntil?: number | null;
}>> {
  await rehydrateFromStorage();
  return memory.order
    .map((id) => memory.accounts[id])
    .filter(Boolean)
    .map((a) => ({
      id: a.id,
      label: a.label,
      useCount: a.useCount,
      lastUsedAt: a.lastUsedAt,
      updatedAt: a.updatedAt,
      lastErrorCode: a.lastErrorCode ?? null,
      cooldownUntil: a.cooldownUntil ?? null,
    }));
}

export async function getBridgeAccountCount(): Promise<number> {
  await rehydrateFromStorage();
  return memory.order.length;
}

export async function upsertAccountFromHeaders(
  headers: Record<string, string>,
  options?: { label?: string; makeDefault?: boolean; skipLegacySync?: boolean; skipHostPush?: boolean },
): Promise<BridgeAccount | null> {
  await rehydrateFromStorage();
  const next = upsertInMemory(headers, { ...options, touchUpdatedAt: true });
  if (!next) return null;
  await persist();
  if (!options?.skipLegacySync) {
    await writeLegacyHeaders(headers);
  }
  // Host disk vault is multi-account SoT (optional if native host down).
  if (!options?.skipHostPush) {
    pushVaultUpsertToHost(headers, { label: options?.label, makeDefault: options?.makeDefault });
  }
  return next;
}

/**
 * Merge host-disk vault into local chrome.storage cache.
 * Upsert only — never wipe local slots missing from host.
 * Callers: runtime on vault_snapshot. Tabs not required.
 */
export async function applyHostVaultSnapshot(vault: {
  accounts?: Record<string, BridgeAccount | {
    id: string;
    label: string;
    headers: Record<string, string>;
    createdAt?: number;
    updatedAt?: number;
    lastUsedAt?: number;
    useCount?: number;
  }>;
  order?: string[];
  rrIndex?: number;
  defaultAccountId?: string | null;
} | null | undefined): Promise<number> {
  if (!vault || typeof vault !== 'object') return 0;
  await rehydrateFromStorage();
  const accounts = vault.accounts && typeof vault.accounts === 'object' ? vault.accounts : {};
  let applied = 0;
  for (const raw of Object.values(accounts)) {
    if (!raw || typeof raw !== 'object') continue;
    const headers = (raw as BridgeAccount).headers;
    if (!headers?.Authorization) continue;
    const next = upsertInMemory(headers, {
      label: (raw as BridgeAccount).label,
      skipLegacySync: true,
      touchUpdatedAt: true,
    });
    if (next) {
      // Preserve host usage counters when fresher.
      const hostUsed = typeof (raw as BridgeAccount).useCount === 'number' ? (raw as BridgeAccount).useCount : 0;
      const hostLast = typeof (raw as BridgeAccount).lastUsedAt === 'number' ? (raw as BridgeAccount).lastUsedAt : 0;
      if (hostUsed > (next.useCount ?? 0)) next.useCount = hostUsed;
      if (hostLast > (next.lastUsedAt ?? 0)) next.lastUsedAt = hostLast;
      memory.accounts[next.id] = next;
      applied += 1;
    }
  }
  if (typeof vault.rrIndex === 'number') memory.rrIndex = vault.rrIndex;
  if (typeof vault.defaultAccountId === 'string' && memory.accounts[vault.defaultAccountId]) {
    memory.defaultAccountId = vault.defaultAccountId;
  }
  if (applied > 0) await persist();
  return applied;
}

export async function getAccountHeaders(accountId: string): Promise<Record<string, string> | null> {
  await rehydrateFromStorage();
  const acc = memory.accounts[accountId];
  return acc?.headers?.Authorization ? { ...acc.headers } : null;
}

export async function markAccountUsed(accountId: string): Promise<void> {
  await rehydrateFromStorage();
  const acc = memory.accounts[accountId];
  if (!acc) return;
  acc.lastUsedAt = Date.now();
  acc.useCount += 1;
  memory.accounts[accountId] = acc;
  await persist();
  // Never rewrite legacy cache here — that poisoned live tokens.
  pushVaultMarkUsedToHost(accountId);
}

export async function removeBridgeAccount(accountId: string): Promise<boolean> {
  await rehydrateFromStorage();
  const id = (accountId ?? '').trim();
  if (!id || !memory.accounts[id]) return false;
  delete memory.accounts[id];
  memory.order = memory.order.filter((x) => x !== id);
  if (memory.defaultAccountId === id) {
    memory.defaultAccountId = memory.order[0] ?? null;
  }
  if (memory.rrIndex >= memory.order.length) memory.rrIndex = 0;
  await persist();
  // Do NOT push vault_remove to host — host is multi-account SoT and must not shrink on auth noise.
  return true;
}

/**
 * Emergency/manual: keep only one slot. Not used on live capture or job pick
 * (wiping other real accounts broke multi-account). Prefer markAccountAuthFailed
 * + exclude on auth failure — never auto-delete.
 */
export async function clearVaultExceptAccount(accountId: string): Promise<void> {
  await rehydrateFromStorage();
  const keep = (accountId ?? '').trim();
  if (!keep || !memory.accounts[keep]) return;
  for (const id of [...memory.order]) {
    if (id !== keep) {
      delete memory.accounts[id];
    }
  }
  memory.order = [keep];
  memory.defaultAccountId = keep;
  memory.rrIndex = 0;
  await persist();
}

export async function pickFreshestAccount(): Promise<{ accountId: string; headers: Record<string, string> } | null> {
  await rehydrateFromStorage();
  let best: BridgeAccount | null = null;
  for (const id of memory.order) {
    const a = memory.accounts[id];
    if (!a?.headers?.Authorization) continue;
    if (!best || (a.updatedAt ?? 0) > (best.updatedAt ?? 0)) best = a;
  }
  if (!best) return null;
  return { accountId: best.id, headers: { ...best.headers } };
}

/**
 * Priority: explicit → sticky preferred → freshest.
 * rotate:true opt-in only (default false — round-robin was selecting dead tokens).
 */
export async function pickAccountForJob(input: {
  explicitAccountId?: string | null;
  preferredAccountId?: string | null;
  excludeAccountId?: string | null;
  rotate?: boolean;
}): Promise<{ accountId: string; headers: Record<string, string> } | null> {
  await rehydrateFromStorage();
  if (memory.order.length === 0) return null;

  const exclude = (input.excludeAccountId ?? '').trim();
  const now = Date.now();
  const eligible = memory.order.filter((id) => {
    if (exclude && id === exclude) return false;
    const acc = memory.accounts[id];
    if (!acc?.headers?.Authorization) return false;
    const cool = typeof acc.cooldownUntil === 'number' ? acc.cooldownUntil : 0;
    if (cool > now) return false;
    return true;
  });
  if (eligible.length === 0) return null;

  const explicit = (input.explicitAccountId ?? '').trim();
  if (explicit && eligible.includes(explicit) && memory.accounts[explicit]?.headers?.Authorization) {
    const acc = memory.accounts[explicit];
    return { accountId: acc.id, headers: { ...acc.headers } };
  }

  const preferred = (input.preferredAccountId ?? '').trim();
  if (preferred && eligible.includes(preferred) && memory.accounts[preferred]?.headers?.Authorization) {
    const acc = memory.accounts[preferred];
    return { accountId: acc.id, headers: { ...acc.headers } };
  }

  if (input.rotate === true && eligible.length > 1) {
    const idx = memory.rrIndex % eligible.length;
    memory.rrIndex = (memory.rrIndex + 1) % eligible.length;
    await persist();
    const id = eligible[idx];
    const acc = memory.accounts[id];
    if (acc?.headers?.Authorization) {
      return { accountId: acc.id, headers: { ...acc.headers } };
    }
  }

  // Freshest among eligible
  let best: BridgeAccount | null = null;
  for (const id of eligible) {
    const a = memory.accounts[id];
    if (!a?.headers?.Authorization) continue;
    if (!best || (a.updatedAt ?? 0) > (best.updatedAt ?? 0)) best = a;
  }
  if (!best) return null;
  return { accountId: best.id, headers: { ...best.headers } };
}


/** Push every local vault slot to host disk (upsert only). Tabs not required. */
export async function seedHostVaultFromLocal(): Promise<number> {
  await rehydrateFromStorage();
  let n = 0;
  for (const id of memory.order) {
    const acc = memory.accounts[id];
    if (!acc?.headers?.Authorization) continue;
    pushVaultUpsertToHost(acc.headers, { label: acc.label });
    n += 1;
  }
  return n;
}

/** Soft-fail an account after auth rejection. Does NOT delete the slot. */
export const DEFAULT_AUTH_COOLDOWN_MS = 5 * 60 * 1000;

export async function markAccountAuthFailed(
  accountId: string,
  errorCode = 'auth_rejected',
  cooldownMs = DEFAULT_AUTH_COOLDOWN_MS,
): Promise<void> {
  await rehydrateFromStorage();
  const id = (accountId ?? '').trim();
  const acc = memory.accounts[id];
  if (!acc) return;
  const now = Date.now();
  acc.lastErrorCode = String(errorCode || 'auth_rejected').slice(0, 64);
  acc.lastErrorAt = now;
  acc.cooldownUntil = now + Math.max(0, cooldownMs);
  memory.accounts[id] = acc;
  await persist();
}

/** Operator label hygiene — does not touch tokens. */
export async function setAccountLabel(accountId: string, label: string): Promise<boolean> {
  await rehydrateFromStorage();
  const id = (accountId ?? '').trim();
  const acc = memory.accounts[id];
  if (!acc) return false;
  const next = (label ?? '').trim().slice(0, 48);
  if (!next) return false;
  acc.label = next;
  memory.accounts[id] = acc;
  await persist();
  return true;
}

export async function loadAnyAccountHeaders(): Promise<Record<string, string> | null> {
  const fresh = await pickFreshestAccount();
  if (fresh?.headers?.Authorization) return fresh.headers;
  return loadLegacyClientHeaders();
}

export async function loadLegacyClientHeaders(): Promise<Record<string, string> | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  try {
    const data = await chrome.storage.local.get(LEGACY_HEADERS_KEY);
    const headers = data[LEGACY_HEADERS_KEY] as Record<string, string> | undefined;
    if (headers?.Authorization) return { ...headers };
  } catch {
    // ignore
  }
  return null;
}
