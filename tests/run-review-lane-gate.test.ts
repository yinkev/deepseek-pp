import { describe, expect, it } from 'vitest';
import {
  isBlockingGateInput,
  normalizeReviewLaneGate,
} from '../core/run/review-lane-gate';
import type { AutonomousRunReviewLaneGateInput } from '../core/run/worker';

describe('isBlockingGateInput', () => {
  it('returns false for null or undefined', () => {
    expect(isBlockingGateInput(null)).toBe(false);
    expect(isBlockingGateInput(undefined)).toBe(false);
  });

  it('returns false for a non-blocking neutral gate', () => {
    const gate: AutonomousRunReviewLaneGateInput = {
      status: 'clear',
      reason: 'none',
      canProceed: true,
      blockingPriority: null,
      blockingLaneCount: 0,
    };
    expect(isBlockingGateInput(gate)).toBe(false);
  });

  it('returns false for non-blocking reason values', () => {
    for (const reason of ['none', 'active_review', 'failed_lane', 'blocked_lane', 'unknown', undefined] as const) {
      expect(isBlockingGateInput({ reason })).toBe(false);
    }
  });

  it('returns true when canProceed is false', () => {
    expect(isBlockingGateInput({ canProceed: false })).toBe(true);
  });

  it('returns true when status is blocked', () => {
    expect(isBlockingGateInput({ status: 'blocked' })).toBe(true);
  });

  it('returns true when blockingPriority is P1', () => {
    expect(isBlockingGateInput({ blockingPriority: 'P1' })).toBe(true);
  });

  it('returns true when blockingPriority is P2', () => {
    expect(isBlockingGateInput({ blockingPriority: 'P2' })).toBe(true);
  });

  it('returns true when reason is p1', () => {
    expect(isBlockingGateInput({ reason: 'p1' })).toBe(true);
  });

  it('returns true when reason is p2', () => {
    expect(isBlockingGateInput({ reason: 'p2' })).toBe(true);
  });

  it('returns true when reason is block_recommendation', () => {
    expect(isBlockingGateInput({ reason: 'block_recommendation' })).toBe(true);
  });

  it('returns false for non-standard blockingPriority values', () => {
    expect(isBlockingGateInput({ blockingPriority: 'P3' as any })).toBe(false);
    expect(isBlockingGateInput({ blockingPriority: 123 as any })).toBe(false);
    expect(isBlockingGateInput({ blockingPriority: null })).toBe(false);
  });
});

describe('normalizeReviewLaneGate', () => {
  it('returns non-blocking defaults for null input', () => {
    expect(normalizeReviewLaneGate(null)).toEqual({
      blocked: false,
      reason: 'none',
      blockingPriority: null,
      blockingLaneCount: 0,
    });
  });

  it('returns non-blocking defaults for undefined input', () => {
    expect(normalizeReviewLaneGate(undefined)).toEqual({
      blocked: false,
      reason: 'none',
      blockingPriority: null,
      blockingLaneCount: 0,
    });
  });

  it('returns non-blocking for a neutral non-blocking gate', () => {
    expect(normalizeReviewLaneGate({
      status: 'clear',
      reason: 'none',
      canProceed: true,
      blockingPriority: null,
      blockingLaneCount: 0,
    })).toEqual({
      blocked: false,
      reason: 'none',
      blockingPriority: null,
      blockingLaneCount: 0,
    });
  });

  it('reports blocked through canProceed false', () => {
    const result = normalizeReviewLaneGate({ canProceed: false });
    expect(result.blocked).toBe(true);
  });

  it('reports blocked through status blocked', () => {
    const result = normalizeReviewLaneGate({ status: 'blocked' });
    expect(result.blocked).toBe(true);
  });

  it('reports blocked through blockingPriority P1', () => {
    const result = normalizeReviewLaneGate({ blockingPriority: 'P1' });
    expect(result.blocked).toBe(true);
    expect(result.blockingPriority).toBe('P1');
  });

  it('reports blocked through blockingPriority P2', () => {
    const result = normalizeReviewLaneGate({ blockingPriority: 'P2' });
    expect(result.blocked).toBe(true);
    expect(result.blockingPriority).toBe('P2');
  });

  it('reports blocked through reason p1', () => {
    const result = normalizeReviewLaneGate({ reason: 'p1' });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('p1');
  });

  it('reports blocked through reason p2', () => {
    const result = normalizeReviewLaneGate({ reason: 'p2' });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('p2');
  });

  it('reports blocked through reason block_recommendation', () => {
    const result = normalizeReviewLaneGate({ reason: 'block_recommendation' });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('block_recommendation');
  });

  it('does not block on non-blocking reason values', () => {
    for (const reason of ['active_review', 'failed_lane', 'blocked_lane'] as const) {
      const result = normalizeReviewLaneGate({ reason });
      expect(result.blocked).toBe(false);
      expect(result.reason).toBe(reason);
    }
  });

  it('normalizes unknown reason strings to unknown', () => {
    const result = normalizeReviewLaneGate({ reason: 'some_random_value' });
    expect(result.reason).toBe('unknown');
    expect(result.blocked).toBe(false);
  });

  it('passthrough blockingPriority P3 as non-blocking', () => {
    const result = normalizeReviewLaneGate({ blockingPriority: 'P3' });
    expect(result.blockingPriority).toBe('P3');
    expect(result.blocked).toBe(false);
  });

  it('normalizes unknown blockingPriority to null', () => {
    const result = normalizeReviewLaneGate({ blockingPriority: 'P4' as any });
    expect(result.blockingPriority).toBe(null);
    expect(result.blocked).toBe(false);
  });

  it('normalizes null blockingPriority to null', () => {
    const result = normalizeReviewLaneGate({ blockingPriority: null });
    expect(result.blockingPriority).toBe(null);
  });

  it('normalizes undefined blockingPriority to null', () => {
    const result = normalizeReviewLaneGate({});
    expect(result.blockingPriority).toBe(null);
  });

  it('normalizes null blockingLaneCount to 0', () => {
    const result = normalizeReviewLaneGate({ blockingLaneCount: null as any });
    expect(result.blockingLaneCount).toBe(0);
  });

  it('normalizes NaN blockingLaneCount to 0', () => {
    const result = normalizeReviewLaneGate({ blockingLaneCount: Number.NaN });
    expect(result.blockingLaneCount).toBe(0);
  });

  it('normalizes negative blockingLaneCount to 0', () => {
    const result = normalizeReviewLaneGate({ blockingLaneCount: -5 });
    expect(result.blockingLaneCount).toBe(0);
  });

  it('floors positive blockingLaneCount', () => {
    const result = normalizeReviewLaneGate({ blockingLaneCount: 3.7 });
    expect(result.blockingLaneCount).toBe(3);
  });

  it('preserves exact count for valid positive integers', () => {
    const result = normalizeReviewLaneGate({ blockingLaneCount: 5 });
    expect(result.blockingLaneCount).toBe(5);
  });

  it('agrees with isBlockingGateInput for all blocking conditions', () => {
    const cases: AutonomousRunReviewLaneGateInput[] = [
      { canProceed: false },
      { status: 'blocked' },
      { blockingPriority: 'P1' },
      { blockingPriority: 'P2' },
      { reason: 'p1' },
      { reason: 'p2' },
      { reason: 'block_recommendation' },
    ];
    for (const gate of cases) {
      const normalized = normalizeReviewLaneGate(gate);
      expect(normalized.blocked).toBe(true);
      expect(isBlockingGateInput(gate)).toBe(true);
    }
  });

  it('agrees with isBlockingGateInput for all non-blocking conditions', () => {
    const cases: AutonomousRunReviewLaneGateInput[] = [
      {},
      { reason: 'none' },
      { reason: 'active_review' },
      { reason: 'failed_lane' },
      { reason: 'blocked_lane' },
      { blockingPriority: null },
      { blockingPriority: 'P3' },
      { blockingLaneCount: 0 },
    ];
    for (const gate of cases) {
      const normalized = normalizeReviewLaneGate(gate);
      expect(normalized.blocked).toBe(false);
      expect(isBlockingGateInput(gate)).toBe(false);
    }
  });
});
