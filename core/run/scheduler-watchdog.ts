import { isTerminalRunStatus, reviewAutonomousRunProgress } from './kernel';
import { normalizeReviewLaneGate } from './review-lane-gate';
import { reviewAutonomousEvidenceFreshness } from './target';
import type { AutonomousRunReviewLaneGateInput } from './worker';
import type {
  AutonomousEvidenceRecord,
  AutonomousRun,
  AutonomousRunError,
  AutonomousRunStatus,
  AutonomousRunStep,
  AutonomousTargetLease,
} from './types';

export type AutonomousSchedulerWatchdogDecision =
  | 'canContinue'
  | 'mustBlock'
  | 'mustRetry'
  | 'terminalNoop'
  | 'paused'
  | 'blocked'
  | 'idle';

export type AutonomousSchedulerWatchdogReason =
  | 'ok'
  | 'no_runnable_run'
  | 'terminal'
  | 'paused'
  | 'already_blocked'
  | 'missing_target_lease'
  | 'inactive_target_lease'
  | 'expired_target_lease'
  | 'stale_evidence'
  | 'expired_evidence'
  | 'no_progress_exceeded'
  | 'same_error_exceeded'
  | 'review_lane_gate_blocked'
  | 'quality_gate_blocked';

export interface AutonomousSchedulerQualityGateLike {
  blocked: boolean;
  reason?: string | null;
  latestGateStatus?: string | null;
  seq?: number | null;
  conflictCount?: number | null;
}

export interface AutonomousSchedulerWatchdogInput {
  run: AutonomousRun | null;
  steps?: readonly AutonomousRunStep[];
  evidence?: readonly AutonomousEvidenceRecord[];
  targetLease?: AutonomousTargetLease | null;
  reviewLaneGate?: AutonomousRunReviewLaneGateInput | null;
  qualityGateDecision?: AutonomousSchedulerQualityGateLike | null;
  now?: number;
}

export interface AutonomousSchedulerWatchdogDetails {
  stepCount?: number;
  evidenceCount?: number;
  freshEvidenceCount?: number;
  staleEvidenceCount?: number;
  expiredEvidenceCount?: number;
  targetLeaseAgeMs?: number | null;
  targetLeaseExpiresInMs?: number | null;
  reviewLaneReason?: string;
  blockingPriority?: string | null;
  blockingLaneCount?: number;
  qualityGateReason?: string | null;
  qualityGateSeq?: number | null;
  qualityGateConflictCount?: number | null;
}

export interface AutonomousSchedulerWatchdogVerdict {
  decision: AutonomousSchedulerWatchdogDecision;
  reason: AutonomousSchedulerWatchdogReason;
  retryable: boolean;
  blocksNextAction: boolean;
  recommendedStatus: AutonomousRunStatus | null;
  error: AutonomousRunError | null;
  details: AutonomousSchedulerWatchdogDetails;
}

export function evaluateAutonomousSchedulerWatchdog(
  input: AutonomousSchedulerWatchdogInput,
): AutonomousSchedulerWatchdogVerdict {
  const now = input.now ?? Date.now();
  const run = input.run;
  if (!run) {
    return createVerdict('idle', 'no_runnable_run', {
      retryable: false,
      blocksNextAction: true,
      recommendedStatus: null,
      error: null,
    });
  }

  const steps = input.steps?.filter((step) => step.runId === run.id) ?? [];
  const evidence = input.evidence?.filter((record) => record.runId === run.id) ?? [];
  const baseDetails = createBaseDetails(run, steps, evidence, input.targetLease ?? null, now);

  if (isTerminalRunStatus(run.status)) {
    return createVerdict('terminalNoop', 'terminal', {
      retryable: false,
      blocksNextAction: true,
      recommendedStatus: null,
      error: null,
      details: baseDetails,
    });
  }

  if (run.status === 'paused') {
    return createVerdict('paused', 'paused', {
      retryable: true,
      blocksNextAction: true,
      recommendedStatus: null,
      error: null,
      details: baseDetails,
    });
  }

  if (run.status === 'blocked') {
    return createVerdict('blocked', 'already_blocked', {
      retryable: true,
      blocksNextAction: true,
      recommendedStatus: null,
      error: null,
      details: baseDetails,
    });
  }

  const reviewLaneGate = normalizeReviewLaneGate(input.reviewLaneGate);
  if (reviewLaneGate.blocked) {
    return createVerdict('mustBlock', 'review_lane_gate_blocked', {
      retryable: true,
      blocksNextAction: true,
      recommendedStatus: 'blocked',
      error: createWatchdogError(
        'autonomous_review_lane_gate_blocked',
        `Autonomous run is blocked by review lane gate (${reviewLaneGate.reason}).`,
        'review',
        true,
        now,
      ),
      details: {
        ...baseDetails,
        reviewLaneReason: reviewLaneGate.reason,
        blockingPriority: reviewLaneGate.blockingPriority,
        blockingLaneCount: reviewLaneGate.blockingLaneCount,
      },
    });
  }

  if (input.qualityGateDecision?.blocked === true) {
    return createVerdict('mustBlock', 'quality_gate_blocked', {
      retryable: true,
      blocksNextAction: true,
      recommendedStatus: 'blocked',
      error: createWatchdogError(
        'autonomous_quality_gate_blocked',
        'Autonomous run is blocked by the latest quality gate.',
        'review',
        true,
        now,
      ),
      details: {
        ...baseDetails,
        qualityGateReason: input.qualityGateDecision.reason ?? null,
        qualityGateSeq: input.qualityGateDecision.seq ?? null,
        qualityGateConflictCount: input.qualityGateDecision.conflictCount ?? null,
      },
    });
  }

  if (run.targetLeaseId) {
    const leaseVerdict = evaluateTargetLease(run, input.targetLease ?? null, now, baseDetails);
    if (leaseVerdict) return leaseVerdict;
  }

  const evidenceVerdict = evaluateEvidenceFreshness(run, evidence, input.targetLease ?? null, now, baseDetails);
  if (evidenceVerdict) return evidenceVerdict;

  const progress = reviewAutonomousRunProgress(run, steps, now);
  if (progress.blocked && progress.reason === 'no_progress') {
    return createVerdict('mustBlock', 'no_progress_exceeded', {
      retryable: true,
      blocksNextAction: true,
      recommendedStatus: 'blocked',
      error: progress.error,
      details: baseDetails,
    });
  }
  if (progress.blocked && progress.reason === 'same_error') {
    return createVerdict('mustBlock', 'same_error_exceeded', {
      retryable: true,
      blocksNextAction: true,
      recommendedStatus: 'blocked',
      error: progress.error,
      details: baseDetails,
    });
  }

  return createVerdict('canContinue', 'ok', {
    retryable: true,
    blocksNextAction: false,
    recommendedStatus: null,
    error: null,
    details: baseDetails,
  });
}

function evaluateTargetLease(
  run: AutonomousRun,
  targetLease: AutonomousTargetLease | null,
  now: number,
  baseDetails: AutonomousSchedulerWatchdogDetails,
): AutonomousSchedulerWatchdogVerdict | null {
  if (!targetLease || targetLease.id !== run.targetLeaseId || targetLease.runId !== run.id) {
    return createTargetLeaseVerdict('missing_target_lease', 'Target lease is missing from durable state.', now, baseDetails);
  }
  if (targetLease.status !== 'active') {
    return createTargetLeaseVerdict('inactive_target_lease', 'Target lease is not active.', now, baseDetails);
  }
  if (targetLease.expiresAt <= now) {
    return createTargetLeaseVerdict('expired_target_lease', 'Target lease has expired.', now, baseDetails);
  }
  return null;
}

function evaluateEvidenceFreshness(
  run: AutonomousRun,
  evidence: readonly AutonomousEvidenceRecord[],
  targetLease: AutonomousTargetLease | null,
  now: number,
  baseDetails: AutonomousSchedulerWatchdogDetails,
): AutonomousSchedulerWatchdogVerdict | null {
  if (run.proofContract.requiredEvidence.length === 0 || evidence.length === 0) return null;
  const reviews = evidence.map((record) => reviewAutonomousEvidenceFreshness(record, targetLease, now));
  if (reviews.some((review) => review.ok)) return null;
  if (reviews.some((review) => review.reason === 'expired_evidence')) {
    return createEvidenceVerdict('expired_evidence', 'All available required evidence is expired.', now, baseDetails);
  }
  if (reviews.some((review) => review.reason === 'stale_evidence')) {
    return createEvidenceVerdict('stale_evidence', 'All available required evidence is stale.', now, baseDetails);
  }
  return null;
}

function createTargetLeaseVerdict(
  reason: 'missing_target_lease' | 'inactive_target_lease' | 'expired_target_lease',
  message: string,
  now: number,
  details: AutonomousSchedulerWatchdogDetails,
): AutonomousSchedulerWatchdogVerdict {
  return createVerdict('mustBlock', reason, {
    retryable: true,
    blocksNextAction: true,
    recommendedStatus: 'blocked',
    error: createWatchdogError(`autonomous_watchdog_${reason}`, message, 'policy', true, now),
    details,
  });
}

function createEvidenceVerdict(
  reason: 'stale_evidence' | 'expired_evidence',
  message: string,
  now: number,
  details: AutonomousSchedulerWatchdogDetails,
): AutonomousSchedulerWatchdogVerdict {
  return createVerdict('mustBlock', reason, {
    retryable: true,
    blocksNextAction: true,
    recommendedStatus: 'blocked',
    error: createWatchdogError(`autonomous_watchdog_${reason}`, message, 'verification', true, now),
    details,
  });
}

function createBaseDetails(
  run: AutonomousRun,
  steps: readonly AutonomousRunStep[],
  evidence: readonly AutonomousEvidenceRecord[],
  targetLease: AutonomousTargetLease | null,
  now: number,
): AutonomousSchedulerWatchdogDetails {
  const freshEvidenceCount = evidence.filter((record) => record.freshness === 'fresh' && record.expiresAt > now).length;
  const staleEvidenceCount = evidence.filter((record) => record.freshness === 'stale' && record.expiresAt > now).length;
  const expiredEvidenceCount = evidence.filter((record) => record.freshness === 'expired' || record.expiresAt <= now).length;
  return {
    stepCount: steps.filter((step) => step.runId === run.id).length,
    evidenceCount: evidence.length,
    freshEvidenceCount,
    staleEvidenceCount,
    expiredEvidenceCount,
    targetLeaseAgeMs: targetLease ? Math.max(0, now - targetLease.acquiredAt) : null,
    targetLeaseExpiresInMs: targetLease ? Math.max(0, targetLease.expiresAt - now) : null,
  };
}

function createVerdict(
  decision: AutonomousSchedulerWatchdogDecision,
  reason: AutonomousSchedulerWatchdogReason,
  input: Omit<AutonomousSchedulerWatchdogVerdict, 'decision' | 'reason' | 'details'> & {
    details?: AutonomousSchedulerWatchdogDetails;
  },
): AutonomousSchedulerWatchdogVerdict {
  return {
    decision,
    reason,
    retryable: input.retryable,
    blocksNextAction: input.blocksNextAction,
    recommendedStatus: input.recommendedStatus,
    error: input.error,
    details: input.details ?? {},
  };
}

function createWatchdogError(
  code: string,
  message: string,
  phase: AutonomousRunError['phase'],
  retryable: boolean,
  now: number,
): AutonomousRunError {
  return {
    code,
    message,
    phase,
    retryable,
    at: now,
  };
}
