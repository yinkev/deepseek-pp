import type {
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
