import type {
  AutonomousRunReviewLaneGateInput,
  AutonomousRunReviewLaneGatePriority,
  AutonomousRunReviewLaneGateReason,
} from './worker';

export interface ReviewLaneGateRecordLike {
  highestPriority: 'P1' | 'P2' | 'P3' | null;
  recommendation: 'proceed' | 'iterate' | 'block' | 'unknown';
  status: 'idle' | 'running' | 'passed' | 'blocked' | 'failed';
}

export function isBlockingReviewLaneRecord(record: ReviewLaneGateRecordLike): boolean {
  return record.highestPriority === 'P1' ||
    record.highestPriority === 'P2' ||
    record.recommendation === 'block' ||
    record.status === 'blocked' ||
    record.status === 'failed';
}

export function selectReviewLaneBlockingPriority(
  records: readonly ReviewLaneGateRecordLike[],
): AutonomousRunReviewLaneGatePriority | null {
  if (records.some((record) => record.highestPriority === 'P1')) return 'P1';
  if (records.some((record) => record.highestPriority === 'P2')) return 'P2';
  return null;
}

export function selectReviewLaneGateReason(
  records: readonly ReviewLaneGateRecordLike[],
  blockingPriority: AutonomousRunReviewLaneGatePriority | null,
): AutonomousRunReviewLaneGateReason {
  if (blockingPriority === 'P1') return 'p1';
  if (blockingPriority === 'P2') return 'p2';
  if (records.some((record) => record.recommendation === 'block')) return 'block_recommendation';
  if (records.some((record) => record.status === 'failed')) return 'failed_lane';
  if (records.some((record) => record.status === 'blocked')) return 'blocked_lane';
  return records.some((record) => record.status === 'running') ? 'active_review' : 'unknown';
}

/**
 * Pure boolean check: is this review-lane gate input blocking?
 * Operates directly on raw input fields — no normalization.
 */
export function isBlockingGateInput(
  gate: AutonomousRunReviewLaneGateInput | null | undefined,
): boolean {
  return gate?.canProceed === false ||
    gate?.status === 'blocked' ||
    gate?.blockingPriority === 'P1' ||
    gate?.blockingPriority === 'P2' ||
    gate?.reason === 'p1' ||
    gate?.reason === 'p2' ||
    gate?.reason === 'block_recommendation';
}

export interface NormalizedReviewLaneGateResult {
  blocked: boolean;
  reason: AutonomousRunReviewLaneGateReason;
  blockingPriority: AutonomousRunReviewLaneGatePriority | null;
  blockingLaneCount: number;
}

/**
 * Normalize a review-lane gate input into a consistent result with
 * blocked flag, canonical reason, priority, and lane count.
 *
 * Consolidates duplicated blocking logic from worker.ts and review-scheduler.ts.
 */
export function normalizeReviewLaneGate(
  gate: AutonomousRunReviewLaneGateInput | null | undefined,
): NormalizedReviewLaneGateResult {
  if (!gate) {
    return {
      blocked: false,
      reason: 'none',
      blockingPriority: null,
      blockingLaneCount: 0,
    };
  }

  return {
    blocked: isBlockingGateInput(gate),
    reason: normalizeGateReasonUnknown(gate.reason),
    blockingPriority: normalizeGateBlockingPriority(gate.blockingPriority),
    blockingLaneCount: normalizeNonNegativeCount(gate.blockingLaneCount),
  };
}

function normalizeGateReasonUnknown(reason: unknown): AutonomousRunReviewLaneGateReason {
  if (
    reason === 'none' ||
    reason === 'active_review' ||
    reason === 'p1' ||
    reason === 'p2' ||
    reason === 'block_recommendation' ||
    reason === 'failed_lane' ||
    reason === 'blocked_lane'
  ) {
    return reason;
  }
  return 'unknown';
}

function normalizeGateBlockingPriority(
  priority: unknown,
): AutonomousRunReviewLaneGatePriority | null {
  if (priority === 'P1' || priority === 'P2' || priority === 'P3') {
    return priority;
  }
  return null;
}

function normalizeNonNegativeCount(count: unknown): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}
