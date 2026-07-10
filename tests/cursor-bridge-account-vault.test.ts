/**
 * Tests for multi-account vault.
 * Callers: vitest. User multi-account + auth safety.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();

beforeEach(() => {
  store.clear();
  vi.resetModules();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) {
            if (store.has(k)) out[k] = store.get(k);
          }
          return out;
        },
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
      },
    },
  });
});

describe('account vault', () => {
  it('stores multiple logins; default pick is freshest, rotate is opt-in', async () => {
    const vault = await import('../core/cursor-bridge/account-vault');
    const a = await vault.upsertAccountFromHeaders({
      Authorization: 'Bearer token-aaa-111',
      'X-App-Version': '2.0.0',
    }, { label: 'alpha' });
    // ensure time ordering
    await new Promise((r) => setTimeout(r, 5));
    const b = await vault.upsertAccountFromHeaders({
      Authorization: 'Bearer token-bbb-222',
      'X-App-Version': '2.0.0',
    }, { label: 'beta' });
    expect(a?.id).not.toBe(b?.id);

    const list = await vault.listBridgeAccounts();
    expect(list).toHaveLength(2);

    // Default: freshest (beta)
    const def = await vault.pickAccountForJob({ rotate: false });
    expect(def?.accountId).toBe(b?.id);

    // Opt-in rotate alternates
    const p1 = await vault.pickAccountForJob({ rotate: true });
    const p2 = await vault.pickAccountForJob({ rotate: true });
    expect(p1?.accountId).not.toBe(p2?.accountId);

    // Sticky preferred wins
    const sticky = await vault.pickAccountForJob({
      preferredAccountId: a!.id,
      rotate: true,
    });
    expect(sticky?.accountId).toBe(a?.id);
  });

  it('same token updates rather than duplicates', async () => {
    const vault = await import('../core/cursor-bridge/account-vault');
    const first = await vault.upsertAccountFromHeaders({
      Authorization: 'Bearer same-token',
    });
    const second = await vault.upsertAccountFromHeaders({
      Authorization: 'Bearer same-token',
      'X-App-Version': '2.1.0',
    });
    expect(first?.id).toBe(second?.id);
    expect(await vault.getBridgeAccountCount()).toBe(1);
  });

  it('markAccountUsed does not clobber legacy live headers', async () => {
    const vault = await import('../core/cursor-bridge/account-vault');
    const a = await vault.upsertAccountFromHeaders({
      Authorization: 'Bearer old-token',
    });
    // live capture overwrites legacy
    await vault.upsertAccountFromHeaders({
      Authorization: 'Bearer live-token',
    });
    const live = await vault.loadLegacyClientHeaders();
    expect(live?.Authorization).toContain('live-token');

    // using old account must not rewrite legacy back to old
    await vault.markAccountUsed(a!.id);
    const live2 = await vault.loadLegacyClientHeaders();
    expect(live2?.Authorization).toContain('live-token');
  });

  it('removeBridgeAccount drops dead slot', async () => {
    const vault = await import('../core/cursor-bridge/account-vault');
    const a = await vault.upsertAccountFromHeaders({ Authorization: 'Bearer dead' });
    await vault.upsertAccountFromHeaders({ Authorization: 'Bearer alive' });
    await vault.removeBridgeAccount(a!.id);
    expect(await vault.getBridgeAccountCount()).toBe(1);
    const pick = await vault.pickFreshestAccount();
    expect(pick?.headers.Authorization).toContain('alive');
  });

  it('clearVaultExceptAccount keeps only live slot (manual/emergency only)', async () => {
    const vault = await import('../core/cursor-bridge/account-vault');
    await vault.upsertAccountFromHeaders({ Authorization: 'Bearer dead-a' });
    const live = await vault.upsertAccountFromHeaders({ Authorization: 'Bearer live-account1' });
    await vault.clearVaultExceptAccount(live!.id);
    expect(await vault.getBridgeAccountCount()).toBe(1);
    const pick = await vault.pickFreshestAccount();
    expect(pick?.headers.Authorization).toContain('live-account1');
  });

  it('upsert keeps both accounts (no wipe on live capture)', async () => {
    const vault = await import('../core/cursor-bridge/account-vault');
    const a = await vault.upsertAccountFromHeaders({ Authorization: 'Bearer account-one-token' });
    const b = await vault.upsertAccountFromHeaders({ Authorization: 'Bearer account-two-token' });
    expect(await vault.getBridgeAccountCount()).toBe(2);
    expect(a?.id).not.toBe(b?.id);
    // re-upsert a does not drop b
    await vault.upsertAccountFromHeaders({ Authorization: 'Bearer account-one-token' });
    expect(await vault.getBridgeAccountCount()).toBe(2);
  });

  it('excludeAccountId skips dead slot on rotate', async () => {
    const vault = await import('../core/cursor-bridge/account-vault');
    const a = await vault.upsertAccountFromHeaders({ Authorization: 'Bearer dead-token' });
    const b = await vault.upsertAccountFromHeaders({ Authorization: 'Bearer alive-token' });
    const pick = await vault.pickAccountForJob({
      excludeAccountId: a!.id,
      rotate: true,
    });
    expect(pick?.accountId).toBe(b?.id);
  });
});

  it('soft-fail cooldown excludes account without deleting', async () => {
    const vault = await import('../core/cursor-bridge/account-vault');
    const a = await vault.upsertAccountFromHeaders({ Authorization: 'Bearer cool-dead' }, { label: 'dead' });
    const b = await vault.upsertAccountFromHeaders({ Authorization: 'Bearer cool-live' }, { label: 'live' });
    expect(await vault.getBridgeAccountCount()).toBe(2);
    await vault.markAccountAuthFailed(a!.id, 'auth_rejected', 60_000);
    const pick = await vault.pickAccountForJob({ rotate: true });
    expect(pick?.accountId).toBe(b?.id);
    expect(await vault.getBridgeAccountCount()).toBe(2);
    const list = await vault.listBridgeAccounts();
    const dead = list.find((x) => x.id === a!.id);
    expect(dead?.lastErrorCode).toBe('auth_rejected');
    expect(typeof dead?.cooldownUntil).toBe('number');
  });

  it('successful upsert clears cooldown', async () => {
    const vault = await import('../core/cursor-bridge/account-vault');
    const a = await vault.upsertAccountFromHeaders({ Authorization: 'Bearer cool-clear-token' }, { label: 'x' });
    await vault.markAccountAuthFailed(a!.id, 'auth_rejected', 60_000);
    await vault.upsertAccountFromHeaders({ Authorization: 'Bearer cool-clear-token' }, { label: 'x' });
    const list = await vault.listBridgeAccounts();
    const row = list.find((x) => x.id === a!.id);
    expect(row?.lastErrorCode).toBeNull();
    expect(row?.cooldownUntil).toBeNull();
  });

  it('setAccountLabel updates label only', async () => {
    const vault = await import('../core/cursor-bridge/account-vault');
    const a = await vault.upsertAccountFromHeaders({ Authorization: 'Bearer label-token' });
    const ok = await vault.setAccountLabel(a!.id, 'private');
    expect(ok).toBe(true);
    const list = await vault.listBridgeAccounts();
    expect(list.find((x) => x.id === a!.id)?.label).toBe('private');
  });

