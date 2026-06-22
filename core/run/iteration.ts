import {
  isTerminalRunStatus,
  reviewAutonomousRunProgress,
  type AutonomousRunProgressReview,
} from './kernel';
import {
  reviewAutonomousRunCompletion,
  type AutonomousRunCompletionDecision,
  type AutonomousRunCompletionGrade,
} from './review';
import type {
  AutonomousEvidenceRecord,
  AutonomousRun,
  AutonomousRunError,
  AutonomousRunStatus,
  AutonomousRunStep,
  AutonomousTargetLease,
} from './types';
import type { BrowserControlTarget } from '../browser-control/types';

export type AutonomousRunIterationAction =
  | 'iterate'
  | 'succeed'
  | 'fail'
  | 'block'
  | 'noop';

export interface AutonomousRunIterationReviewInput {
  run: AutonomousRun;
  steps: readonly AutonomousRunStep[];
  evidence: readonly AutonomousEvidenceRecord[];
  targetLease?: AutonomousTargetLease | null;
  liveTarget?: Pick<BrowserControlTarget, 'id' | 'windowId' | 'url' | 'controllable'> | null;
  completionClaimed?: boolean;
  now?: number;
}

export interface AutonomousRunIterationReview {
  action: AutonomousRunIterationAction;
  nextStatus: AutonomousRunStatus | null;
  completionDecision: AutonomousRunCompletionDecision;
  grade: AutonomousRunCompletionGrade;
  score: number;
  issueCodes: string[];
  progressReason: AutonomousRunProgressReview['reason'];
  acceptedEvidenceIds: string[];
  doneCriteriaMissing: string[];
  requiredEvidenceMissing: string[];
  error: AutonomousRunError | null;
}

export function reviewAutonomousRunIteration(
  input: AutonomousRunIterationReviewInput,
): AutonomousRunIterationReview {
  const now = input.now ?? Date.now();
  const completion = reviewAutonomousRunCompletion({
    run: input.run,
    steps: input.steps,
    evidence: input.evidence,
    targetLease: input.targetLease,
    liveTarget: input.liveTarget,
    now,
  });

  if (isTerminalRunStatus(input.run.status)) {
    return createIterationReview('noop', null, completion, null, null);
  }
  if (input.run.status !== 'running') {
    return createIterationReview('noop', null, completion, null, null);
  }

  if (completion.issueCodes.includes('proof_contract_empty')) {
    return createIterationReview('block', 'blocked', completion, null, createEmptyProofContractError(now));
  }

  if (completion.decision === 'pass') {
    return createIterationReview('succeed', 'succeeded', completion, null, null);
  }

  const progress = reviewAutonomousRunProgress(input.run, filterVerifiedProgressSteps(input.run, input.steps, completion), now);
  if (progress.blocked) {
    return createIterationReview('block', 'blocked', completion, progress.reason, progress.error);
  }

  if (completion.decision === 'fail' && input.completionClaimed === true) {
    return createIterationReview('fail', 'failed', completion, null, completion.error);
  }

  return createIterationReview('iterate', 'running', completion, null, completion.error);
}

function createIterationReview(
  action: AutonomousRunIterationAction,
  nextStatus: AutonomousRunStatus | null,
  completion: ReturnType<typeof reviewAutonomousRunCompletion>,
  progressReason: AutonomousRunProgressReview['reason'],
  error: AutonomousRunError | null,
): AutonomousRunIterationReview {
  return {
    action,
    nextStatus,
    completionDecision: completion.decision,
    grade: completion.grade,
    score: completion.score,
    issueCodes: completion.issueCodes,
    progressReason,
    acceptedEvidenceIds: completion.acceptedEvidenceIds,
    doneCriteriaMissing: completion.doneCriteriaMissing,
    requiredEvidenceMissing: completion.requiredEvidenceMissing,
    error,
  };
}

function filterVerifiedProgressSteps(
  run: AutonomousRun,
  steps: readonly AutonomousRunStep[],
  completion: ReturnType<typeof reviewAutonomousRunCompletion>,
): AutonomousRunStep[] {
  const acceptedEvidence = new Set(completion.acceptedEvidenceIds);
  const doneCriteria = run.proofContract.doneCriteria.map(normalizeComparable);
  return steps.map((step) => {
    if (step.phase === 'review' || step.phase === 'checkpoint') {
      return {
        ...step,
        progressScore: 0,
        proofDelta: [],
        evidenceRefs: [],
      };
    }
    const proofDelta = step.proofDelta.filter((item) => matchesDoneCriteria(item, doneCriteria));
    const evidenceRefs = step.evidenceRefs.filter((item) => acceptedEvidence.has(item));
    const verifiedProgress = proofDelta.length > 0 || evidenceRefs.length > 0;
    return {
      ...step,
      progressScore: verifiedProgress ? step.progressScore : 0,
      proofDelta,
      evidenceRefs,
    };
  });
}

function createEmptyProofContractError(now: number): AutonomousRunError {
  return {
    code: 'autonomous_iteration_empty_proof_contract',
    message: 'Autonomous run is blocked because its proof contract has no done criteria or required evidence.',
    phase: 'review',
    retryable: false,
    at: now,
  };
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function matchesDoneCriteria(value: string, doneCriteria: readonly string[]): boolean {
  const normalized = normalizeComparable(value);
  return normalized.length > 0 && doneCriteria.some((criteria) => normalized.includes(criteria));
}
