/**
 * Host-disk multi-account vault for cursor-bridge.
 * Callers: cursor-bridge-host.mjs (native host). Never talks to DeepSeek.
 * User: multi-account SoT shared across Chrome profiles / reloads.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MAX_ACCOUNTS = 8;
const VAULT_FILE_NAME = 'account-vault.json';

export function defaultVaultSnapshot() {
  return {
    version: 1,
    accounts: {},
    order: [],
    rrIndex: 0,
    defaultAccountId: null,
  };
}

export function tokenFingerprint(authorization) {
  const raw = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `ds-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export function resolveVaultPath(installDir) {
  const dir = installDir
    || process.env.CURSOR_BRIDGE_HOST_DIR
    || path.join(os.homedir(), 'Library', 'Application Support', 'DeepSeek++', 'CursorBridgeHost');
  return path.join(dir, VAULT_FILE_NAME);
}

export function loadVault(vaultPath) {
  try {
    if (!fs.existsSync(vaultPath)) return defaultVaultSnapshot();
    const raw = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
    if (!raw || typeof raw !== 'object') return defaultVaultSnapshot();
    const accounts = raw.accounts && typeof raw.accounts === 'object' ? { ...raw.accounts } : {};
    const order = Array.isArray(raw.order) ? [...raw.order] : Object.keys(accounts);
    return {
      version: 1,
      accounts,
      order,
      rrIndex: typeof raw.rrIndex === 'number' ? raw.rrIndex : 0,
      defaultAccountId: typeof raw.defaultAccountId === 'string' ? raw.defaultAccountId : null,
    };
  } catch {
    return defaultVaultSnapshot();
  }
}

export function saveVault(vaultPath, snapshot) {
  const dir = path.dirname(vaultPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${vaultPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
  fs.renameSync(tmp, vaultPath);
}

export function upsertAccount(snapshot, headers, options = {}) {
  const auth = headers?.Authorization;
  if (!auth) return { snapshot, account: null };
  const now = Date.now();
  const id = tokenFingerprint(auth);
  const existing = snapshot.accounts[id];
  const label = String(options.label ?? existing?.label ?? `account-${snapshot.order.length + 1}`).slice(0, 48);
  const next = {
    id,
    label,
    headers: { ...headers },
    createdAt: existing?.createdAt ?? now,
    updatedAt: options.touchUpdatedAt === false ? (existing?.updatedAt ?? now) : now,
    lastUsedAt: existing?.lastUsedAt ?? 0,
    useCount: existing?.useCount ?? 0,
  };
  const accounts = { ...snapshot.accounts, [id]: next };
  let order = snapshot.order.includes(id) ? [...snapshot.order] : [...snapshot.order, id];
  while (order.length > MAX_ACCOUNTS) {
    const drop = order.shift();
    if (drop && drop !== id) delete accounts[drop];
  }
  let defaultAccountId = snapshot.defaultAccountId;
  if (options.makeDefault || !defaultAccountId) defaultAccountId = id;
  return {
    snapshot: {
      version: 1,
      accounts,
      order,
      rrIndex: snapshot.rrIndex ?? 0,
      defaultAccountId,
    },
    account: next,
  };
}

export function removeAccount(snapshot, accountId) {
  const id = String(accountId || '').trim();
  if (!id || !snapshot.accounts[id]) return { snapshot, removed: false };
  const accounts = { ...snapshot.accounts };
  delete accounts[id];
  const order = snapshot.order.filter((x) => x !== id);
  let defaultAccountId = snapshot.defaultAccountId;
  if (defaultAccountId === id) defaultAccountId = order[0] ?? null;
  let rrIndex = snapshot.rrIndex ?? 0;
  if (rrIndex >= order.length) rrIndex = 0;
  return {
    snapshot: {
      version: 1,
      accounts,
      order,
      rrIndex,
      defaultAccountId,
    },
    removed: true,
  };
}

export function markUsed(snapshot, accountId) {
  const id = String(accountId || '').trim();
  const acc = snapshot.accounts[id];
  if (!acc) return { snapshot, account: null };
  const next = {
    ...acc,
    lastUsedAt: Date.now(),
    useCount: (acc.useCount ?? 0) + 1,
  };
  return {
    snapshot: {
      ...snapshot,
      accounts: { ...snapshot.accounts, [id]: next },
    },
    account: next,
  };
}

export function listAccountsPublic(snapshot) {
  return (snapshot.order || [])
    .map((id) => snapshot.accounts[id])
    .filter(Boolean)
    .map((a) => ({
      id: a.id,
      label: a.label,
      useCount: a.useCount ?? 0,
      lastUsedAt: a.lastUsedAt ?? 0,
      updatedAt: a.updatedAt ?? 0,
      lastErrorCode: a.lastErrorCode ?? null,
      cooldownUntil: a.cooldownUntil ?? null,
    }));
}

export function mergeReadinessAccounts(readiness, snapshot) {
  const hostList = listAccountsPublic(snapshot);
  const extList = Array.isArray(readiness?.accounts) ? readiness.accounts : [];
  const byId = new Map();
  for (const a of hostList) byId.set(a.id, a);
  for (const a of extList) {
    if (!a?.id) continue;
    const prev = byId.get(a.id);
    byId.set(a.id, prev
      ? {
        ...prev,
        label: a.label || prev.label,
        useCount: Math.max(prev.useCount ?? 0, a.useCount ?? 0),
      }
      : a);
  }
  const accounts = [...byId.values()];
  return {
    ...readiness,
    accountCount: Math.max(
      typeof readiness?.accountCount === 'number' ? readiness.accountCount : 0,
      accounts.length,
      snapshot.order?.length ?? 0,
    ),
    accounts,
    hostVaultPath: undefined,
  };
}
