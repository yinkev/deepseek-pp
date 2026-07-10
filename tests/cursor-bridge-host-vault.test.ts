/**
 * Host-disk multi-account vault pure logic.
 * Callers: vitest. No Chrome, no DeepSeek network.
 */
import { describe, expect, it } from 'vitest';
import {
  defaultVaultSnapshot,
  upsertAccount,
  removeAccount,
  markUsed,
  listAccountsPublic,
  mergeReadinessAccounts,
  tokenFingerprint,
} from '../packages/cursor-bridge-host/native/account-vault.mjs';

describe('host account vault', () => {
  it('fingerprints tokens stably', () => {
    const a = tokenFingerprint('Bearer abc');
    const b = tokenFingerprint('abc');
    expect(a).toBe(b);
    expect(a.startsWith('ds-')).toBe(true);
  });

  it('upsert keeps multiple accounts; no wipe', () => {
    let snap = defaultVaultSnapshot();
    const r1 = upsertAccount(snap, { Authorization: 'Bearer token-one' }, { label: 'a1' });
    snap = r1.snapshot;
    const r2 = upsertAccount(snap, { Authorization: 'Bearer token-two' }, { label: 'a2' });
    snap = r2.snapshot;
    expect(listAccountsPublic(snap)).toHaveLength(2);
    expect(r1.account?.id).not.toBe(r2.account?.id);
  });

  it('remove drops only one slot', () => {
    let snap = defaultVaultSnapshot();
    const a = upsertAccount(snap, { Authorization: 'Bearer dead' }, { label: 'dead' });
    snap = a.snapshot;
    const b = upsertAccount(snap, { Authorization: 'Bearer live' }, { label: 'live' });
    snap = b.snapshot;
    const rm = removeAccount(snap, a.account!.id);
    snap = rm.snapshot;
    expect(rm.removed).toBe(true);
    const list = listAccountsPublic(snap);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(b.account!.id);
  });

  it('markUsed bumps counters without rewriting headers', () => {
    let snap = defaultVaultSnapshot();
    const up = upsertAccount(snap, { Authorization: 'Bearer x', 'X-App-Version': '2.0.0' });
    snap = up.snapshot;
    const used = markUsed(snap, up.account!.id);
    snap = used.snapshot;
    expect(used.account?.useCount).toBe(1);
    expect(snap.accounts[up.account!.id].headers['X-App-Version']).toBe('2.0.0');
  });

  it('mergeReadinessAccounts unions host + extension lists', () => {
    let snap = defaultVaultSnapshot();
    const up = upsertAccount(snap, { Authorization: 'Bearer host-only' }, { label: 'host' });
    snap = up.snapshot;
    const merged = mergeReadinessAccounts(
      {
        ready: true,
        extensionAlive: true,
        hasDeepSeekTab: false,
        hasLogin: true,
        busy: false,
        accountCount: 1,
        accounts: [{ id: 'ds-ext', label: 'ext', useCount: 3 }],
      },
      snap,
    );
    expect(merged.accountCount).toBeGreaterThanOrEqual(2);
    expect(merged.accounts?.some((a: { id: string }) => a.id === up.account!.id)).toBe(true);
    expect(merged.accounts?.some((a: { id: string }) => a.id === 'ds-ext')).toBe(true);
  });
});
