import { describe, expect, it } from 'vitest';
import {
  reviewAutonomousEvidenceFreshness,
  reviewAutonomousTargetLease,
} from '../core/run/target';
import type { AutonomousEvidenceRecord, AutonomousTargetLease } from '../core/run/types';

const NOW = 10_000;

describe('autonomous target lease and evidence review', () => {
  it('accepts an active lease when tab, window, origin, and controllability match', () => {
    const review = reviewAutonomousTargetLease(createLease(), {
      id: 42,
      windowId: 7,
      url: 'https://example.com/work?token=hidden',
      controllable: true,
    }, NOW);

    expect(review).toEqual({ ok: true, reason: null, error: null });
  });

  it('rejects expired, origin-mismatched, or uncontrollable leases', () => {
    expect(reviewAutonomousTargetLease(createLease({ expiresAt: NOW }), {
      id: 42,
      windowId: 7,
      url: 'https://example.com/work',
      controllable: true,
    }, NOW).reason).toBe('expired_lease');

    expect(reviewAutonomousTargetLease(createLease(), {
      id: 42,
      windowId: 7,
      url: 'https://other.example/work',
      controllable: true,
    }, NOW).reason).toBe('origin_mismatch');

    expect(reviewAutonomousTargetLease(createLease(), {
      id: 42,
      windowId: 7,
      url: 'https://example.com/work',
      controllable: false,
    }, NOW).reason).toBe('target_not_controllable');
  });

  it('accepts fresh evidence bound to the active target lease', () => {
    const lease = createLease();
    const evidence = createEvidence();

    expect(reviewAutonomousEvidenceFreshness(evidence, lease, NOW)).toEqual({
      ok: true,
      reason: null,
      error: null,
    });
  });

  it('rejects stale, expired, mismatched, or ref-less evidence', () => {
    const lease = createLease();

    expect(reviewAutonomousEvidenceFreshness(createEvidence({ freshness: 'stale' }), lease, NOW).reason).toBe('stale_evidence');
    expect(reviewAutonomousEvidenceFreshness(createEvidence({ expiresAt: NOW }), lease, NOW).reason).toBe('expired_evidence');
    expect(reviewAutonomousEvidenceFreshness(createEvidence({ leaseId: 'other-lease' }), lease, NOW).reason).toBe('lease_mismatch');
    expect(reviewAutonomousEvidenceFreshness(createEvidence({ source: { tabId: 43, windowId: 7 } }), lease, NOW).reason).toBe('source_tab_mismatch');
    expect(reviewAutonomousEvidenceFreshness(createEvidence({ refs: [] }), lease, NOW).reason).toBe('missing_refs');
  });

  it('rejects evidence bound to inactive or expired leases', () => {
    expect(reviewAutonomousEvidenceFreshness(createEvidence(), createLease({ status: 'released' }), NOW).reason).toBe('inactive_lease');
    expect(reviewAutonomousEvidenceFreshness(createEvidence(), createLease({ expiresAt: NOW }), NOW).reason).toBe('expired_lease');
  });
});

function createLease(overrides: Partial<AutonomousTargetLease> = {}): AutonomousTargetLease {
  return {
    id: 'lease-1',
    runId: 'run-1',
    status: 'active',
    label: 'Dev++',
    tabId: 42,
    windowId: 7,
    origin: 'https://example.com',
    title: 'Work',
    acquiredAt: NOW - 1_000,
    expiresAt: NOW + 1_000,
    lastVerifiedAt: NOW - 500,
    releasedAt: null,
    ...overrides,
  };
}

function createEvidence(overrides: Partial<AutonomousEvidenceRecord> = {}): AutonomousEvidenceRecord {
  return {
    id: 'evidence-1',
    runId: 'run-1',
    leaseId: 'lease-1',
    kind: 'browser_screenshot',
    freshness: 'fresh',
    capturedAt: NOW - 100,
    expiresAt: NOW + 1_000,
    summary: 'Verified screen',
    refs: ['vision-evidence-1'],
    source: { tabId: 42, windowId: 7 },
    metadata: null,
    ...overrides,
  };
}
