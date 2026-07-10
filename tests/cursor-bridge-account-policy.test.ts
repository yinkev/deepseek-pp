/**
 * Per-client account rotate policy (P14).
 */
import { describe, expect, it } from 'vitest';
import { shouldRotateAccountsForJob } from '../core/cursor-bridge/worker';

describe('shouldRotateAccountsForJob', () => {
  it('never rotates when sticky or explicit', () => {
    expect(shouldRotateAccountsForJob({
      stickyValid: true,
      accountCount: 5,
      clientProfile: 'generic',
    })).toBe(false);
    expect(shouldRotateAccountsForJob({
      explicitAccountId: 'ds-1',
      accountCount: 5,
    })).toBe(false);
  });

  it('hermes eni stays sticky body (no rotate)', () => {
    expect(shouldRotateAccountsForJob({
      clientProfile: 'hermes',
      model: 'ds/eni',
      accountCount: 5,
      stickyValid: false,
    })).toBe(false);
  });

  it('generic multi rotates when unpinned', () => {
    expect(shouldRotateAccountsForJob({
      clientProfile: 'generic',
      model: 'ds/octopus',
      accountCount: 3,
      stickyValid: false,
    })).toBe(true);
  });

  it('single account never rotates', () => {
    expect(shouldRotateAccountsForJob({
      accountCount: 1,
      clientProfile: 'generic',
    })).toBe(false);
  });
});
