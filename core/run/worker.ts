import {
  appendAutonomousRunStep,
  applyAutonomousRunIterationReview,
  getAutonomousRunById,
  getAutonomousRunEvidence,
  getAutonomousRunSteps,
  getAutonomousTargetLeaseById,
  transitionAutonomousRun,
} from './store';
import { reviewAutonomousRunAction } from './policy';
import { type AutonomousRunProgressReview } from './kernel';
import { evaluateAutonomousSchedulerWatchdog, type AutonomousSchedulerWatchdogVerdict } from './scheduler-watchdog';
import type {
  AutonomousRunId,
  AutonomousRunStatus,
} from './types';
import type { AutonomousRunGateDecision } from './policy';
import type {
  AutonomousRunIterationAction,
  AutonomousRunIterationReview,
} from './iteration';
import type {
  AutonomousRunCompletionDecision,
  AutonomousRunCompletionGrade,
} from './review';

export type AutonomousRunActionKind = 'model_turn' | 'tool_call';
export type AutonomousRunReviewLaneGateStatus = 'clear' | 'attention' | 'blocked';
export type AutonomousRunReviewLaneGatePriority = 'P1' | 'P2' | 'P3';
export type AutonomousRunReviewLaneGateReason =
  | 'none'
  | 'active_review'
  | 'p1'
  | 'p2'
  | 'block_recommendation'
  | 'failed_lane'
  | 'blocked_lane'
  | 'unknown';

export interface AutonomousRunExecutorInput {
  runId: AutonomousRunId;
  now?: number;
}

export type AutonomousRunExecutor = (input: AutonomousRunExecutorInput) => Promise<void> | void;

export interface AutonomousRunReviewLaneGateInput {
  status?: AutonomousRunReviewLaneGateStatus | null;
  reason?: AutonomousRunReviewLaneGateReason | string | null;
  canProceed?: boolean | null;
  blockingPriority?: AutonomousRunReviewLaneGatePriority | null;
  blockingLaneCount?: number | null;
}

export interface AutonomousRunCycleResult {
  action: 'noop' | 'start' | 'advance' | 'block' | 'fail';
  runId: AutonomousRunId;
  started: boolean;
  advanced: boolean;
  applied: boolean;
  policyDecision: AutonomousRunGateDecision | null;
  iterationAction: string | null;
  reviewSummary: AutonomousRunCycleReviewSummary | null;
  schedulerWatchdogVerdict?: AutonomousSchedulerWatchdogVerdict | null;
  finalStatus: AutonomousRunStatus | null;
  errorCode: string | null;
}

export interface AutonomousRunCycleReviewSummary {
  action: AutonomousRunIterationAction;
  completionDecision: AutonomousRunCompletionDecision;
  grade: AutonomousRunCompletionGrade;
  score: number;
  issueCount: number;
  proofDebtCount: number;
  acceptedEvidenceCount: number;
  progressReason: AutonomousRunProgressReview['reason'];
  errorCode: string | null;
}

export async function executeAutonomousRunCycle(
  runId: AutonomousRunId,
  executor: AutonomousRunExecutor,
  options: { now?: number; actionKind?: AutonomousRunActionKind; reviewLaneGate?: AutonomousRunReviewLaneGateInput | null } = {},
): Promise<AutonomousRunCycleResult> {
  const now = options.now ?? Date.now();
  const actionKind = options.actionKind ?? 'model_turn';

  let run = await getAutonomousRunById(runId);
  if (!run) {
    const schedulerWatchdogVerdict = evaluateAutonomousSchedulerWatchdog({ run: null, now });
    return makeResult('noop', runId, false, false, false, null, null, null, schedulerWatchdogVerdict, null, null);
  }

  const preflightSteps = await getAutonomousRunSteps(runId);
  const preflightEvidence = await getAutonomousRunEvidence(runId);
  const targetLease = run.targetLeaseId ? await getAutonomousTargetLeaseById(run.targetLeaseId) : null;
  const schedulerWatchdogVerdict = evaluateAutonomousSchedulerWatchdog({
    run,
    steps: preflightSteps,
    evidence: preflightEvidence,
    targetLease,
    reviewLaneGate: options.reviewLaneGate,
    now,
  });

  if (schedulerWatchdogVerdict.blocksNextAction) {
    if (schedulerWatchdogVerdict.recommendedStatus === 'blocked' && schedulerWatchdogVerdict.error) {
      return blockFromWatchdog(runId, schedulerWatchdogVerdict, now);
    }
    return makeResult(
      'noop',
      runId,
      false,
      false,
      false,
      null,
      null,
      null,
      schedulerWatchdogVerdict,
      run.status,
      schedulerWatchdogVerdict.error?.code ?? null,
    );
  }

  let started = false;
  if (run.status === 'queued') {
    await transitionAutonomousRun(runId, 'running', null, now);
    started = true;
    run = await getAutonomousRunById(runId) ?? run;
  }

  const steps = await getAutonomousRunSteps(runId);
  const policyReview = reviewAutonomousRunAction(run, steps, { kind: actionKind }, now);

  if (policyReview.decision !== 'allow') {
    await appendAutonomousRunStep(runId, {
      phase: 'review',
      status: 'failed',
      error: policyReview.error,
      progressScore: 0,
      proofDelta: [],
      evidenceRefs: [],
      toolCallIds: [],
      observationRefs: policyReview.reason ? [`policy:${policyReview.reason}`] : [],
    }, now);

    // Explicitly transition to blocked using the policy error so that
    // final durable status is 'blocked' even when proofContract has
    // valid non-empty doneCriteria (independent of iteration review path).
    await transitionAutonomousRun(runId, 'blocked', policyReview.error, now);

    const iter = await applyAutonomousRunIterationReview({ runId }, now);
    const final = await getAutonomousRunById(runId);
    return makeResult(
      'block',
      runId,
      started,
      false,
      iter.applied,  // will be false (apply sees non-running status)
      policyReview.decision,
      iter.review?.action ?? null,
      summarizeIterationReview(iter.review),
      schedulerWatchdogVerdict,
      final?.status ?? 'blocked',
      policyReview.error?.code ?? null,
    );
  }

  let advanced = false;
  let execErrorCode: string | null = null;
  try {
    await executor({ runId, now });
    advanced = true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await appendAutonomousRunStep(runId, {
      phase: 'model_turn',
      status: 'failed',
      error: {
        code: 'executor_error',
        message,
        phase: 'model_turn',
        retryable: true,
        at: now,
      },
      progressScore: 0,
      proofDelta: [],
      evidenceRefs: [],
      toolCallIds: [],
      observationRefs: [],
    }, now);
    execErrorCode = 'executor_error';
  }

  const iter = await applyAutonomousRunIterationReview({ runId }, now);
  const final = await getAutonomousRunById(runId);

  const action: AutonomousRunCycleResult['action'] = execErrorCode ? 'fail' : 'advance';

  return makeResult(
    action,
    runId,
    started,
    advanced,
    iter.applied,
    'allow',
    iter.review?.action ?? null,
    summarizeIterationReview(iter.review),
    schedulerWatchdogVerdict,
    final?.status ?? null,
    execErrorCode ?? iter.review?.error?.code ?? null,
  );
}

function makeResult(
  action: AutonomousRunCycleResult['action'],
  runId: AutonomousRunId,
  started: boolean,
  advanced: boolean,
  applied: boolean,
  policyDecision: AutonomousRunGateDecision | null,
  iterationAction: string | null,
  reviewSummary: AutonomousRunCycleReviewSummary | null,
  schedulerWatchdogVerdict: AutonomousSchedulerWatchdogVerdict | null,
  finalStatus: AutonomousRunStatus | null,
  errorCode: string | null,
): AutonomousRunCycleResult {
  return {
    action,
    runId,
    started,
    advanced,
    applied,
    policyDecision,
    iterationAction,
    reviewSummary,
    schedulerWatchdogVerdict,
    finalStatus,
    errorCode,
  };
}

async function blockFromWatchdog(
  runId: AutonomousRunId,
  verdict: AutonomousSchedulerWatchdogVerdict,
  now: number,
): Promise<AutonomousRunCycleResult> {
  const error = verdict.error;
  if (!error) {
    return makeResult('noop', runId, false, false, false, null, null, null, verdict, null, null);
  }
  await appendAutonomousRunStep(runId, {
    phase: 'review',
    status: 'failed',
    error,
    progressScore: 0,
    proofDelta: [],
    evidenceRefs: [],
    toolCallIds: [],
    observationRefs: createWatchdogObservationRefs(verdict),
  }, now);
  await transitionAutonomousRun(runId, 'blocked', error, now);
  const iter = await applyAutonomousRunIterationReview({ runId }, now);
  const final = await getAutonomousRunById(runId);
  return makeResult(
    'block',
    runId,
    false,
    false,
    iter.applied,
    null,
    iter.review?.action ?? null,
    summarizeIterationReview(iter.review),
    verdict,
    final?.status ?? 'blocked',
    error.code,
  );
}

function createWatchdogObservationRefs(verdict: AutonomousSchedulerWatchdogVerdict): string[] {
  if (verdict.reason === 'review_lane_gate_blocked') {
    const refs = [`review_lane_gate:${verdict.details.reviewLaneReason ?? 'unknown'}`];
    if (verdict.details.blockingPriority) refs.push(`review_lane_gate_priority:${verdict.details.blockingPriority}`);
    if ((verdict.details.blockingLaneCount ?? 0) > 0) refs.push(`review_lane_gate_blocking_lanes:${verdict.details.blockingLaneCount}`);
    return refs;
  }
  const refs = [`scheduler_watchdog:${verdict.reason}`];
  if (verdict.details.targetLeaseExpiresInMs === 0) refs.push('scheduler_watchdog:target_lease_expired');
  if ((verdict.details.expiredEvidenceCount ?? 0) > 0) refs.push(`scheduler_watchdog_expired_evidence:${verdict.details.expiredEvidenceCount}`);
  if ((verdict.details.staleEvidenceCount ?? 0) > 0) refs.push(`scheduler_watchdog_stale_evidence:${verdict.details.staleEvidenceCount}`);
  return refs;
}

function summarizeIterationReview(
  review: AutonomousRunIterationReview | null | undefined,
): AutonomousRunCycleReviewSummary | null {
  if (!review) return null;
  return {
    action: review.action,
    completionDecision: review.completionDecision,
    grade: review.grade,
    score: review.score,
    issueCount: review.issueCodes.length,
    proofDebtCount: review.doneCriteriaMissing.length + review.requiredEvidenceMissing.length,
    acceptedEvidenceCount: review.acceptedEvidenceIds.length,
    progressReason: review.progressReason,
    errorCode: review.error?.code ?? null,
  };
}
