import {
  type AutonomousRunCockpitRun,
  type AutonomousRunCockpitSnapshot,
  getAutonomousRunCockpitSnapshot,
} from '../run/orchestrator';
import { transitionAutonomousRun } from '../run/store';
import type { RuntimeDoctorReport } from '../chat/runtime-doctor';
import type {
  AutonomousRunCompletionDecision,
  AutonomousRunCompletionGrade,
  AutonomousRunCompletionReview,
} from '../run/review';
import type { MemoryPressure } from '../prompt';
import type {
  AutonomousRunCycleResult,
  AutonomousRunCycleReviewSummary,
} from '../run/worker';

export type PetBlockerCategory =
  | 'auth'
  | 'target'
  | 'leak'
  | 'policy'
  | 'budget'
  | 'evidence'
  | 'review'
  | 'paused'
  | 'busy'
  | 'runtime'
  | 'unknown';

export type PetBlockerCategoryCounts = Record<PetBlockerCategory, number>;

export type PetReviewHeatLevel = 'none' | 'cool' | 'warm' | 'hot' | 'blocked';

export type PetReviewHeatReason =
  | 'no_review'
  | 'ready_to_finalize'
  | 'needs_iteration'
  | 'low_grade'
  | 'proof_debt'
  | 'review_issues'
  | 'review_failed';

export type PetStopLineAction = 'none' | 'pause' | 'cancel';

export type PetStopLineReason =
  | 'no_run'
  | 'can_pause'
  | 'can_cancel'
  | 'terminal';

export type PetStopLineErrorCode =
  | 'no_active_run'
  | 'action_unavailable'
  | 'transition_rejected';

const PET_WORKER_CYCLE_REVIEW_ERROR_CODES = new Set([
  'completion_review_iterate',
  'completion_review_fail',
  'autonomous_iteration_empty_proof_contract',
  'run_no_progress',
  'run_repeated_error',
]);

export interface PetWorkerCycle {
  lastAction: AutonomousRunCycleResult['action'] | null;
  policyDecision: AutonomousRunCycleResult['policyDecision'];
  iterationAction: AutonomousRunCycleResult['iterationAction'];
  finalStatus: AutonomousRunCycleResult['finalStatus'];
  applied: boolean;
  advanced: boolean;
  reviewGrade: AutonomousRunCycleReviewSummary['grade'] | null;
  reviewDecision: AutonomousRunCycleReviewSummary['completionDecision'] | null;
  reviewScore: number | null;
  reviewIssueCount: number;
  reviewProofDebtCount: number;
  acceptedEvidenceCount: number;
  reviewErrorCode: string | null;
}

export type PetReviewLaneRole = 'implementer' | 'reviewer' | 'safety' | 'ux' | 'oracle' | 'other';
export type PetReviewLaneStatus = 'idle' | 'running' | 'passed' | 'blocked' | 'failed';
export type PetReviewLaneRecommendation = 'proceed' | 'iterate' | 'block' | 'unknown';
export type PetReviewLanePriority = 'P1' | 'P2' | 'P3';

export interface PetReviewLaneSummary {
  role: PetReviewLaneRole;
  status: PetReviewLaneStatus;
  grade: AutonomousRunCompletionGrade | null;
  recommendation: PetReviewLaneRecommendation;
  highestPriority: PetReviewLanePriority | null;
  issueCount: number;
  updatedAt: number | null;
}

export interface PetReviewLaneInput {
  role?: unknown;
  status?: unknown;
  grade?: unknown;
  recommendation?: unknown;
  highestPriority?: unknown;
  issueCount?: unknown;
  updatedAt?: unknown;
}

export interface PetControlSnapshot {
  schemaVersion: 1;
  generatedAt: number;
  readiness: {
    status: 'ready' | 'needs_attention' | 'blocked';
    blockers: string[];
    preparing: boolean;
  };
  run: {
    active: boolean;
    label: string | null;
    phase: 'idle' | 'thinking' | 'speaking' | 'working' | 'reviewing' | 'blocked' | 'done';
    nextAction: string | null;
  };
  target: {
    locked: boolean;
    label: string | null;
    stale: boolean;
    leaseStatus: 'none' | 'active' | 'stale' | 'expired' | 'released';
    leaseAgeMs: number | null;
    leaseExpiresInMs: number | null;
  };
  safety: {
    leakIssueCount: number;
    highRiskArmed: boolean;
  };
  blockerLens: {
    primary: PetBlockerCategory | null;
    categories: PetBlockerCategory[];
    counts: PetBlockerCategoryCounts;
    total: number;
  };
  evidence: {
    status: 'none' | 'fresh' | 'stale' | 'expired';
    count: number;
    freshCount: number;
    staleCount: number;
    expiredCount: number;
    latestCapturedAt: number | null;
    latestAgeMs: number | null;
  };
  review: {
    grade: AutonomousRunCompletionGrade | null;
    decision: AutonomousRunCompletionDecision | null;
    proofDebtCount: number;
    issueCount: number;
    acceptedEvidenceCount: number;
    canFinalize: boolean;
  };
  reviewHeat: {
    level: PetReviewHeatLevel;
    reasons: PetReviewHeatReason[];
  };
  stopLine: {
    available: boolean;
    action: PetStopLineAction;
    reason: PetStopLineReason;
    runStatus: AutonomousRunCockpitRun['status'] | null;
  };
  memoryPressure: {
    enabled: boolean;
    level: 'none' | 'low' | 'medium' | 'high';
    truncated: boolean;
    selectedCount: number;
    availableCount: number;
    selectedTokenEstimate: number;
    budgetTokens: number;
  };
  workerCycle: PetWorkerCycle;
  reviewLanes: {
    total: number;
    activeCount: number;
    passedCount: number;
    blockedCount: number;
    failedCount: number;
    highestPriority: PetReviewLanePriority | null;
    worstGrade: AutonomousRunCompletionGrade | null;
    proceedCount: number;
    iterateCount: number;
    blockCount: number;
    unknownCount: number;
    lanes: PetReviewLaneSummary[];
  };
}

type PetEvidencePulse = PetControlSnapshot['evidence'];
type PetBlockerLens = PetControlSnapshot['blockerLens'];
type PetReviewHeat = PetControlSnapshot['reviewHeat'];
type PetStopLineState = PetControlSnapshot['stopLine'];

export interface PetStopLineResult {
  applied: boolean;
  action: PetStopLineAction;
  beforeStatus: AutonomousRunCockpitRun['status'] | null;
  afterStatus: AutonomousRunCockpitRun['status'] | null;
  errorCode: PetStopLineErrorCode | null;
}

const PET_BLOCKER_CATEGORY_PRIORITY: PetBlockerCategory[] = [
  'leak',
  'target',
  'auth',
  'policy',
  'budget',
  'evidence',
  'review',
  'paused',
  'busy',
  'runtime',
  'unknown',
];

export function createPetControlSnapshotFromRunCockpit(
  snapshot: AutonomousRunCockpitSnapshot,
): PetControlSnapshot {
  const activeRun = snapshot.activeRun;
  const cockpitStatus = snapshot.status;

  let readinessStatus: 'ready' | 'needs_attention' | 'blocked' = 'ready';
  const blockers: string[] = [];
  let preparing = false;

  let runActive = false;
  let runLabel: string | null = null;
  let runPhase: PetControlSnapshot['run']['phase'] = 'idle';
  let runNextAction: string | null = null;

  let targetLocked = false;
  let targetLabel: string | null = null;
  let targetStale = false;
  let targetLeaseStatus: PetControlSnapshot['target']['leaseStatus'] = 'none';
  let targetLeaseAgeMs: number | null = null;
  let targetLeaseExpiresInMs: number | null = null;

  const leakIssueCount = 0;
  let highRiskArmed = false;
  const evidence = createPetEvidencePulse(activeRun, snapshot.generatedAt);

  if (activeRun) {
    runLabel = activeRun.goal ?? null;
    targetLeaseStatus = activeRun.targetLeaseStatus ?? 'none';
    targetLeaseAgeMs = activeRun.targetLeaseAgeMs ?? null;
    targetLeaseExpiresInMs = activeRun.targetLeaseExpiresInMs ?? null;
    targetLocked = targetLeaseStatus === 'active';
    targetStale = targetLeaseStatus === 'stale' ||
      targetLeaseStatus === 'expired' ||
      targetLeaseStatus === 'released';
    targetLabel = targetLocked ? 'Target locked' : (targetStale ? 'Target stale' : null);
  }

  // Safety defaults conservative; no high risk signal exposed in cockpit snapshot
  highRiskArmed = false;

  switch (cockpitStatus) {
    case 'idle':
      readinessStatus = 'ready';
      runActive = false;
      runPhase = 'idle';
      runNextAction = null;
      break;

    case 'queued':
      readinessStatus = 'ready';
      runActive = true;
      runPhase = 'thinking';
      runNextAction = 'Start or continue worker cycle';
      preparing = true;
      break;

    case 'running': {
      readinessStatus = 'ready';
      runActive = true;
      const latestPhase = activeRun?.latestStep?.phase;
      if (latestPhase === 'review') {
        runPhase = 'reviewing';
      } else if (latestPhase === 'plan') {
        runPhase = 'thinking';
      } else if (latestPhase === 'finish') {
        runPhase = 'done';
      } else if (
        latestPhase === 'model_turn' ||
        latestPhase === 'tool_selection' ||
        latestPhase === 'tool_execution' ||
        latestPhase === 'observation' ||
        latestPhase === 'verification' ||
        latestPhase === 'checkpoint'
      ) {
        runPhase = 'working';
      } else {
        runPhase = 'working';
      }
      runNextAction = 'Continue autonomous cycle';
      break;
    }

    case 'blocked':
      readinessStatus = 'blocked';
      runActive = true;
      runPhase = 'blocked';
      if (activeRun?.errorCode) {
        blockers.push(activeRun.errorCode);
      } else {
        blockers.push('run_blocked');
      }
      runNextAction = 'Review blocker to resume';
      break;

    case 'paused':
      readinessStatus = 'needs_attention';
      runActive = true;
      runPhase = 'blocked';
      blockers.push('run_paused');
      runNextAction = 'Resume or inspect run';
      break;

    case 'complete':
      readinessStatus = 'ready';
      runActive = !!activeRun;
      runPhase = 'done';
      runNextAction = activeRun ? 'Review result' : null;
      break;

    default:
      readinessStatus = 'ready';
      runActive = false;
      runPhase = 'idle';
      runNextAction = null;
      break;
  }

  const review: PetControlSnapshot['review'] = {
    grade: null,
    decision: null,
    proofDebtCount: 0,
    issueCount: 0,
    acceptedEvidenceCount: 0,
    canFinalize: false,
  };

  const memoryPressure: PetControlSnapshot['memoryPressure'] = {
    enabled: false,
    level: 'none',
    truncated: false,
    selectedCount: 0,
    availableCount: 0,
    selectedTokenEstimate: 0,
    budgetTokens: 0,
  };

  const workerCycle: PetControlSnapshot['workerCycle'] = {
    lastAction: null,
    policyDecision: null,
    iterationAction: null,
    finalStatus: null,
    applied: false,
    advanced: false,
    reviewGrade: null,
    reviewDecision: null,
    reviewScore: null,
    reviewIssueCount: 0,
    reviewProofDebtCount: 0,
    acceptedEvidenceCount: 0,
    reviewErrorCode: null,
  };

  const reviewLanes: PetControlSnapshot['reviewLanes'] = {
    total: 0,
    activeCount: 0,
    passedCount: 0,
    blockedCount: 0,
    failedCount: 0,
    highestPriority: null,
    worstGrade: null,
    proceedCount: 0,
    iterateCount: 0,
    blockCount: 0,
    unknownCount: 0,
    lanes: [],
  };

  return {
    schemaVersion: 1,
    generatedAt: snapshot.generatedAt,
    readiness: {
      status: readinessStatus,
      blockers,
      preparing,
    },
    run: {
      active: runActive,
      label: runLabel,
      phase: runPhase,
      nextAction: runNextAction,
    },
    target: {
      locked: targetLocked,
      label: targetLabel,
      stale: targetStale,
      leaseStatus: targetLeaseStatus,
      leaseAgeMs: targetLeaseAgeMs,
      leaseExpiresInMs: targetLeaseExpiresInMs,
    },
    safety: {
      leakIssueCount,
      highRiskArmed,
    },
    blockerLens: createPetBlockerLens({
      readinessBlockers: blockers,
      targetStale,
      leakIssueCount,
      runPhase,
      proofDebtCount: 0,
      issueCount: 0,
    }),
    evidence,
    review,
    reviewHeat: createPetReviewHeat(review),
    stopLine: createPetStopLineState(activeRun),
    memoryPressure,
    workerCycle,
    reviewLanes,
  };
}

export async function getPetControlSnapshot(
  now = Date.now(),
): Promise<PetControlSnapshot> {
  const cockpit = await getAutonomousRunCockpitSnapshot(now);
  return createPetControlSnapshotFromRunCockpit(cockpit);
}

export async function applyPetStopLine(now = Date.now()): Promise<PetStopLineResult> {
  const cockpit = await getAutonomousRunCockpitSnapshot(now);
  const activeRun = cockpit.activeRun;
  const stopLine = createPetStopLineState(activeRun);
  if (!activeRun) {
    return {
      applied: false,
      action: 'none',
      beforeStatus: null,
      afterStatus: null,
      errorCode: 'no_active_run',
    };
  }
  if (!stopLine.available || stopLine.action === 'none') {
    return {
      applied: false,
      action: stopLine.action,
      beforeStatus: activeRun.status,
      afterStatus: activeRun.status,
      errorCode: 'action_unavailable',
    };
  }

  const nextStatus = stopLine.action === 'pause' ? 'paused' : 'cancelled';
  const error = stopLine.action === 'cancel'
    ? {
      code: 'autonomous_run_cancelled_by_pet_stop_line',
      message: 'Autonomous run cancelled by Stop-the-Line control.',
      phase: 'policy' as const,
      retryable: false,
      at: now,
    }
    : null;
  const updated = await transitionAutonomousRun(activeRun.id, nextStatus, error, now);
  const afterStatus = updated?.status ?? activeRun.status;
  return {
    applied: afterStatus === nextStatus,
    action: stopLine.action,
    beforeStatus: activeRun.status,
    afterStatus,
    errorCode: afterStatus === nextStatus ? null : 'transition_rejected',
  };
}

export function mergeRuntimeDoctorReportIntoSnapshot(
  snapshot: PetControlSnapshot,
  report: RuntimeDoctorReport | null | undefined,
): PetControlSnapshot {
  if (!report) {
    return snapshot;
  }

  const targetStatus = report.readiness.targetStatus;
  const targetLocked = report.browserControl.targetLock.enabled;
  const targetStale = targetStatus
    ? isRuntimeDoctorTargetStale(targetStatus)
    : snapshot.target.stale;

  const next = {
    ...snapshot,
    readiness: {
      status: report.readiness.status,
      blockers: report.readiness.blockers,
      preparing: report.readiness.preparing,
    },
    target: {
      locked: targetLocked,
      label: getRuntimeDoctorTargetLabel(targetStatus, targetLocked, targetStale),
      stale: targetStale,
      leaseStatus: snapshot.target.leaseStatus,
      leaseAgeMs: snapshot.target.leaseAgeMs,
      leaseExpiresInMs: snapshot.target.leaseExpiresInMs,
    },
    safety: {
      leakIssueCount: Math.max(
        report.leakSentry.issueCount,
        report.leakQuarantine.issueCount,
        report.storage.issues.length,
      ),
      highRiskArmed: false,
    },
    evidence: snapshot.evidence,
    review: snapshot.review,
    memoryPressure: snapshot.memoryPressure,
  };
  return {
    ...next,
    blockerLens: createPetBlockerLens({
      readinessBlockers: next.readiness.blockers,
      targetStale: next.target.stale,
      leakIssueCount: next.safety.leakIssueCount,
      runPhase: next.run.phase,
      proofDebtCount: next.review.proofDebtCount,
      issueCount: next.review.issueCount,
    }),
    reviewHeat: createPetReviewHeat(next.review),
    stopLine: snapshot.stopLine,
  };
}

function createPetEvidencePulse(
  activeRun: AutonomousRunCockpitSnapshot['activeRun'],
  generatedAt: number,
): PetEvidencePulse {
  const count = activeRun?.evidenceCount ?? 0;
  const freshCount = activeRun?.freshEvidenceCount ?? 0;
  const staleCount = activeRun?.staleEvidenceCount ?? 0;
  const expiredCount = activeRun?.expiredEvidenceCount ?? 0;
  const latestCapturedAt = activeRun?.latestEvidenceAt ?? null;

  let status: PetEvidencePulse['status'] = 'none';
  if (count === 0) {
    status = 'none';
  } else if (freshCount > 0) {
    status = 'fresh';
  } else if (staleCount > 0) {
    status = 'stale';
  } else {
    status = 'expired';
  }

  return {
    status,
    count,
    freshCount,
    staleCount,
    expiredCount,
    latestCapturedAt,
    latestAgeMs: latestCapturedAt === null ? null : Math.max(0, generatedAt - latestCapturedAt),
  };
}

function isRuntimeDoctorTargetStale(
  targetStatus: NonNullable<RuntimeDoctorReport['readiness']['targetStatus']>,
): boolean {
  return targetStatus === 'missing' ||
    targetStatus === 'unsupported' ||
    targetStatus === 'not_controllable';
}

function getRuntimeDoctorTargetLabel(
  targetStatus: RuntimeDoctorReport['readiness']['targetStatus'],
  locked: boolean,
  stale: boolean,
): string | null {
  if (targetStatus === 'missing') return 'Target missing';
  if (stale) return 'Target stale';
  if (locked) return 'Target locked';
  return null;
}

export function mergeAutonomousCompletionReviewIntoSnapshot(
  snapshot: PetControlSnapshot,
  review: AutonomousRunCompletionReview | null | undefined,
): PetControlSnapshot {
  if (!review) {
    return snapshot;
  }

  const proofDebtCount = review.doneCriteriaMissing.length + review.requiredEvidenceMissing.length;
  const issueCount = review.issueCodes.length;
  const acceptedEvidenceCount = review.acceptedEvidenceIds.length;
  const canFinalize = review.decision === 'pass';

  const next = {
    ...snapshot,
    review: {
      grade: review.grade,
      decision: review.decision,
      proofDebtCount,
      issueCount,
      acceptedEvidenceCount,
      canFinalize,
    },
    memoryPressure: snapshot.memoryPressure,
  };
  return {
    ...next,
    blockerLens: createPetBlockerLens({
      readinessBlockers: next.readiness.blockers,
      targetStale: next.target.stale,
      leakIssueCount: next.safety.leakIssueCount,
      runPhase: next.run.phase,
      proofDebtCount: next.review.proofDebtCount,
      issueCount: next.review.issueCount,
    }),
    reviewHeat: createPetReviewHeat(next.review),
    stopLine: snapshot.stopLine,
  };
}

function createPetBlockerLens(input: {
  readinessBlockers: readonly string[];
  targetStale: boolean;
  leakIssueCount: number;
  runPhase: PetControlSnapshot['run']['phase'];
  proofDebtCount: number;
  issueCount: number;
}): PetBlockerLens {
  const counts = createEmptyBlockerCounts();
  for (const blocker of input.readinessBlockers) {
    counts[classifyPetBlocker(blocker)] += 1;
  }
  if (input.targetStale && counts.target === 0) counts.target = 1;
  if (input.leakIssueCount > 0 && counts.leak === 0) counts.leak = input.leakIssueCount;
  if (input.runPhase === 'blocked' && counts.review === 0 && counts.paused === 0) counts.review = 1;
  if (input.proofDebtCount > 0 && counts.evidence === 0) counts.evidence = input.proofDebtCount;
  if (input.issueCount > 0 && counts.review === 0) counts.review = input.issueCount;

  const categories = PET_BLOCKER_CATEGORY_PRIORITY.filter((category) => counts[category] > 0);
  return {
    primary: categories[0] ?? null,
    categories,
    counts,
    total: categories.reduce((sum, category) => sum + counts[category], 0),
  };
}

function createEmptyBlockerCounts(): PetBlockerCategoryCounts {
  return {
    auth: 0,
    target: 0,
    leak: 0,
    policy: 0,
    budget: 0,
    evidence: 0,
    review: 0,
    paused: 0,
    busy: 0,
    runtime: 0,
    unknown: 0,
  };
}

function classifyPetBlocker(blocker: string): PetBlockerCategory {
  const normalized = blocker.toLowerCase();
  if (/(leak|secret|quarantine|storage_leak)/.test(normalized)) return 'leak';
  if (/(target|lease|browser_control|browser_target|tab|origin|controllable)/.test(normalized)) return 'target';
  if (/(auth|login|session|credential|api_key|web_auth|rejected)/.test(normalized)) return 'auth';
  if (/(policy|approval|manual|deny|denied|permission)/.test(normalized)) return 'policy';
  if (/(budget|wall|model_turn|tool_call|prompt_bytes|observation_bytes|no_progress|same_error)/.test(normalized)) return 'budget';
  if (/(evidence|proof|screenshot|freshness|stale_evidence|required_evidence)/.test(normalized)) return 'evidence';
  if (/(review|grade|completion|iterate|iteration)/.test(normalized)) return 'review';
  if (/(pause|paused|interrupted|stop|cancel)/.test(normalized)) return 'paused';
  if (/(busy|preparing|rate|cooldown|retry)/.test(normalized)) return 'busy';
  if (/(runtime|content_script|storage|doctor|mcp|native|provider)/.test(normalized)) return 'runtime';
  return 'unknown';
}

function createPetReviewHeat(review: PetControlSnapshot['review']): PetReviewHeat {
  if (!review.grade && !review.decision) {
    return {
      level: 'none',
      reasons: ['no_review'],
    };
  }

  const reasons: PetReviewHeatReason[] = [];
  if (review.proofDebtCount > 0) reasons.push('proof_debt');
  if (review.issueCount > 0) reasons.push('review_issues');
  if (review.decision === 'fail') reasons.push('review_failed');
  if (review.decision === 'iterate') reasons.push('needs_iteration');
  if (review.grade === 'C' || review.grade === 'D' || review.grade === 'F') reasons.push('low_grade');

  if (review.decision === 'fail' || review.grade === 'F') {
    return {
      level: 'blocked',
      reasons: reasons.length > 0 ? reasons : ['review_failed'],
    };
  }

  if (review.proofDebtCount > 0 || review.issueCount > 0) {
    return {
      level: 'hot',
      reasons,
    };
  }

  if (review.decision === 'iterate' || review.grade === 'C' || review.grade === 'D') {
    return {
      level: 'warm',
      reasons: reasons.length > 0 ? reasons : ['needs_iteration'],
    };
  }

  return {
    level: 'cool',
    reasons: ['ready_to_finalize'],
  };
}

function createPetStopLineState(activeRun: AutonomousRunCockpitRun | null): PetStopLineState {
  if (!activeRun) {
    return {
      available: false,
      action: 'none',
      reason: 'no_run',
      runStatus: null,
    };
  }
  if (activeRun.status === 'queued' || activeRun.status === 'running') {
    return {
      available: true,
      action: 'pause',
      reason: 'can_pause',
      runStatus: activeRun.status,
    };
  }
  if (activeRun.status === 'paused' || activeRun.status === 'blocked') {
    return {
      available: true,
      action: 'cancel',
      reason: 'can_cancel',
      runStatus: activeRun.status,
    };
  }
  return {
    available: false,
    action: 'none',
    reason: 'terminal',
    runStatus: activeRun.status,
  };
}

export type PetHandoffNextAction =
  | 'idle'
  | 'make_ready'
  | 'open_target'
  | 'continue_run'
  | 'review_blocker'
  | 'iterate'
  | 'finalize'
  | 'open_runtime_doctor';

export interface PetHandoffCapsule {
  schemaVersion: 1;
  generatedAt: number;
  readinessStatus: PetControlSnapshot['readiness']['status'];
  runPhase: PetControlSnapshot['run']['phase'];
  targetState: 'locked' | 'missing' | 'stale' | 'none';
  targetLeaseStatus: PetControlSnapshot['target']['leaseStatus'];
  targetLeaseAgeMs: number | null;
  targetLeaseExpiresInMs: number | null;
  reviewState: 'none' | 'pass' | 'iterate' | 'fail';
  blockerCount: number;
  blockerPrimaryCategory: PetBlockerCategory | null;
  blockerCategories: PetBlockerCategory[];
  blockerCategoryCounts: PetBlockerCategoryCounts;
  proofDebtCount: number;
  issueCount: number;
  acceptedEvidenceCount: number;
  reviewHeatLevel: PetReviewHeatLevel;
  reviewHeatReasons: PetReviewHeatReason[];
  stopLineAvailable: boolean;
  stopLineAction: PetStopLineAction;
  stopLineReason: PetStopLineReason;
  evidenceStatus: PetControlSnapshot['evidence']['status'];
  evidenceCount: number;
  latestEvidenceAgeMs: number | null;
  grade: PetControlSnapshot['review']['grade'];
  canFinalize: boolean;
  nextAction: PetHandoffNextAction;
  memoryPressureEnabled: boolean;
  memoryPressureLevel: 'none' | 'low' | 'medium' | 'high';
  memoryPressureTruncated: boolean;
  memorySelectedCount: number;
  memoryAvailableCount: number;
  memorySelectedTokenEstimate: number;
  memoryBudgetTokens: number;
  workerCycleLastAction: PetControlSnapshot['workerCycle']['lastAction'];
  workerCyclePolicyDecision: PetControlSnapshot['workerCycle']['policyDecision'];
  workerCycleIterationAction: PetControlSnapshot['workerCycle']['iterationAction'];
  workerCycleFinalStatus: PetControlSnapshot['workerCycle']['finalStatus'];
  workerCycleApplied: boolean;
  workerCycleAdvanced: boolean;
  workerCycleReviewGrade: PetControlSnapshot['workerCycle']['reviewGrade'];
  workerCycleReviewDecision: PetControlSnapshot['workerCycle']['reviewDecision'];
  workerCycleReviewScore: number | null;
  workerCycleReviewIssueCount: number;
  workerCycleReviewProofDebtCount: number;
  workerCycleAcceptedEvidenceCount: number;
  workerCycleReviewErrorCode: string | null;
  reviewLaneCount: number;
  reviewLaneActiveCount: number;
  reviewLanePassedCount: number;
  reviewLaneBlockedCount: number;
  reviewLaneFailedCount: number;
  reviewLaneHighestPriority: PetReviewLanePriority | null;
  reviewLaneWorstGrade: AutonomousRunCompletionGrade | null;
  reviewLaneProceedCount: number;
  reviewLaneIterateCount: number;
  reviewLaneBlockCount: number;
  reviewLaneUnknownCount: number;
  reviewLaneSummaries: PetReviewLaneSummary[];
}

export function createPetHandoffCapsule(snapshot: PetControlSnapshot): PetHandoffCapsule {
  const { readiness, run, target, safety, review, evidence, generatedAt, memoryPressure: mp, workerCycle: wc, reviewLanes: rl } = snapshot;

  let targetState: PetHandoffCapsule['targetState'] = 'none';
  if (target.stale) {
    targetState = 'stale';
  } else if (target.locked) {
    targetState = 'locked';
  } else if (readiness.status !== 'ready' || target.label === 'Target missing') {
    targetState = 'missing';
  }

  let reviewState: PetHandoffCapsule['reviewState'] = 'none';
  if (review.decision === 'pass') {
    reviewState = 'pass';
  } else if (review.decision === 'iterate') {
    reviewState = 'iterate';
  } else if (review.decision === 'fail') {
    reviewState = 'fail';
  }

  const blockerCount = readiness.blockers.length;
  const blockerLens = snapshot.blockerLens;
  const proofDebtCount = review.proofDebtCount;
  const issueCount = review.issueCount;
  const acceptedEvidenceCount = review.acceptedEvidenceCount;
  const reviewHeat = snapshot.reviewHeat;
  const stopLine = snapshot.stopLine;
  const evidenceStatus = evidence.status;
  const evidenceCount = evidence.count;
  const latestEvidenceAgeMs = evidence.latestAgeMs;
  const grade = review.grade;
  const canFinalize = review.canFinalize;

  let nextAction: PetHandoffNextAction = 'idle';
  if (safety.leakIssueCount > 0) {
    nextAction = 'open_runtime_doctor';
  } else if (targetState === 'missing' || targetState === 'stale') {
    nextAction = 'open_target';
  } else if (run.phase === 'blocked') {
    nextAction = 'review_blocker';
  } else if (readiness.preparing || readiness.status !== 'ready') {
    nextAction = 'make_ready';
  } else if (canFinalize) {
    nextAction = 'finalize';
  } else if (review.decision === 'iterate' || proofDebtCount > 0 || issueCount > 0) {
    nextAction = 'iterate';
  } else if (run.active) {
    nextAction = 'continue_run';
  } else {
    nextAction = 'idle';
  }

  const memoryPressureEnabled = mp ? mp.enabled : false;
  const memoryPressureLevel = mp ? mp.level : 'none';
  const memoryPressureTruncated = mp ? mp.truncated : false;
  const memorySelectedCount = mp ? mp.selectedCount : 0;
  const memoryAvailableCount = mp ? mp.availableCount : 0;
  const memorySelectedTokenEstimate = mp ? mp.selectedTokenEstimate : 0;
  const memoryBudgetTokens = mp ? mp.budgetTokens : 0;

  const workerCycleLastAction = wc ? wc.lastAction : null;
  const workerCyclePolicyDecision = wc ? wc.policyDecision : null;
  const workerCycleIterationAction = wc ? wc.iterationAction : null;
  const workerCycleFinalStatus = wc ? wc.finalStatus : null;
  const workerCycleApplied = wc ? wc.applied : false;
  const workerCycleAdvanced = wc ? wc.advanced : false;
  const workerCycleReviewGrade = wc ? wc.reviewGrade : null;
  const workerCycleReviewDecision = wc ? wc.reviewDecision : null;
  const workerCycleReviewScore = wc ? wc.reviewScore : null;
  const workerCycleReviewIssueCount = wc ? wc.reviewIssueCount : 0;
  const workerCycleReviewProofDebtCount = wc ? wc.reviewProofDebtCount : 0;
  const workerCycleAcceptedEvidenceCount = wc ? wc.acceptedEvidenceCount : 0;
  const workerCycleReviewErrorCode = wc ? wc.reviewErrorCode : null;

  const reviewLaneCount = rl ? rl.total : 0;
  const reviewLaneActiveCount = rl ? rl.activeCount : 0;
  const reviewLanePassedCount = rl ? rl.passedCount : 0;
  const reviewLaneBlockedCount = rl ? rl.blockedCount : 0;
  const reviewLaneFailedCount = rl ? rl.failedCount : 0;
  const reviewLaneHighestPriority = rl ? rl.highestPriority : null;
  const reviewLaneWorstGrade = rl ? rl.worstGrade : null;
  const reviewLaneProceedCount = rl ? rl.proceedCount : 0;
  const reviewLaneIterateCount = rl ? rl.iterateCount : 0;
  const reviewLaneBlockCount = rl ? rl.blockCount : 0;
  const reviewLaneUnknownCount = rl ? rl.unknownCount : 0;
  const reviewLaneSummaries = rl ? rl.lanes : [];

  return {
    schemaVersion: 1,
    generatedAt,
    readinessStatus: readiness.status,
    runPhase: run.phase,
    targetState,
    targetLeaseStatus: target.leaseStatus,
    targetLeaseAgeMs: target.leaseAgeMs,
    targetLeaseExpiresInMs: target.leaseExpiresInMs,
    reviewState,
    blockerCount,
    blockerPrimaryCategory: blockerLens.primary,
    blockerCategories: blockerLens.categories,
    blockerCategoryCounts: blockerLens.counts,
    proofDebtCount,
    issueCount,
    acceptedEvidenceCount,
    reviewHeatLevel: reviewHeat.level,
    reviewHeatReasons: reviewHeat.reasons,
    stopLineAvailable: stopLine.available,
    stopLineAction: stopLine.action,
    stopLineReason: stopLine.reason,
    evidenceStatus,
    evidenceCount,
    latestEvidenceAgeMs,
    grade,
    canFinalize,
    nextAction,
    memoryPressureEnabled,
    memoryPressureLevel,
    memoryPressureTruncated,
    memorySelectedCount,
    memoryAvailableCount,
    memorySelectedTokenEstimate,
    memoryBudgetTokens,
    workerCycleLastAction,
    workerCyclePolicyDecision,
    workerCycleIterationAction,
    workerCycleFinalStatus,
    workerCycleApplied,
    workerCycleAdvanced,
    workerCycleReviewGrade,
    workerCycleReviewDecision,
    workerCycleReviewScore,
    workerCycleReviewIssueCount,
    workerCycleReviewProofDebtCount,
    workerCycleAcceptedEvidenceCount,
    workerCycleReviewErrorCode,
    reviewLaneCount,
    reviewLaneActiveCount,
    reviewLanePassedCount,
    reviewLaneBlockedCount,
    reviewLaneFailedCount,
    reviewLaneHighestPriority,
    reviewLaneWorstGrade,
    reviewLaneProceedCount,
    reviewLaneIterateCount,
    reviewLaneBlockCount,
    reviewLaneUnknownCount,
    reviewLaneSummaries,
  };
}

export function mergePromptMemoryPressureIntoSnapshot(
  snapshot: PetControlSnapshot,
  pressure: MemoryPressure | null | undefined,
): PetControlSnapshot {
  if (!pressure) {
    return snapshot;
  }
  return {
    ...snapshot,
    memoryPressure: {
      enabled: pressure.enabled,
      level: pressure.pressure,
      truncated: pressure.truncated,
      selectedCount: pressure.selectedCount,
      availableCount: pressure.availableCount,
      selectedTokenEstimate: pressure.selectedTokenEstimate,
      budgetTokens: pressure.budgetTokens,
    },
  };
}

export function mergeAutonomousWorkerCycleResultIntoSnapshot(
  snapshot: PetControlSnapshot,
  result: AutonomousRunCycleResult | null | undefined,
): PetControlSnapshot {
  if (!result) {
    return snapshot;
  }
  const summary = result.reviewSummary;
  const workerCycle: PetControlSnapshot['workerCycle'] = {
    lastAction: result.action,
    policyDecision: result.policyDecision,
    iterationAction: result.iterationAction,
    finalStatus: result.finalStatus,
    applied: result.applied,
    advanced: result.advanced,
    reviewGrade: summary ? summary.grade : null,
    reviewDecision: summary ? summary.completionDecision : null,
    reviewScore: summary ? summary.score : null,
    reviewIssueCount: summary ? summary.issueCount : 0,
    reviewProofDebtCount: summary ? summary.proofDebtCount : 0,
    acceptedEvidenceCount: summary ? summary.acceptedEvidenceCount : 0,
    reviewErrorCode: toPetWorkerCycleReviewErrorCode(summary ? summary.errorCode : null),
  };
  return {
    ...snapshot,
    workerCycle,
  };
}

function toPetWorkerCycleReviewErrorCode(errorCode: string | null): string | null {
  if (!errorCode) return null;
  return PET_WORKER_CYCLE_REVIEW_ERROR_CODES.has(errorCode)
    ? errorCode
    : 'unknown_worker_cycle_error';
}

const VALID_ROLES = ['implementer', 'reviewer', 'safety', 'ux', 'oracle', 'other'] as const;
const VALID_STATUSES = ['idle', 'running', 'passed', 'blocked', 'failed'] as const;
const VALID_RECS = ['proceed', 'iterate', 'block', 'unknown'] as const;
const VALID_PRIOS = ['P1', 'P2', 'P3'] as const;

function normalizeRole(v: unknown): PetReviewLaneRole {
  if (typeof v === 'string' && (VALID_ROLES as readonly string[]).includes(v)) {
    return v as PetReviewLaneRole;
  }
  return 'other';
}

function normalizeStatus(v: unknown): PetReviewLaneStatus {
  if (typeof v === 'string' && (VALID_STATUSES as readonly string[]).includes(v)) {
    return v as PetReviewLaneStatus;
  }
  return 'idle';
}

function normalizeRecommendation(v: unknown): PetReviewLaneRecommendation {
  if (typeof v === 'string' && (VALID_RECS as readonly string[]).includes(v)) {
    return v as PetReviewLaneRecommendation;
  }
  return 'unknown';
}

function normalizePriority(v: unknown): PetReviewLanePriority | null {
  if (typeof v === 'string' && (VALID_PRIOS as readonly string[]).includes(v)) {
    return v as PetReviewLanePriority;
  }
  return null;
}

function normalizeGrade(v: unknown): AutonomousRunCompletionGrade | null {
  if (typeof v === 'string' && ['A', 'B', 'C', 'D', 'F'].includes(v)) {
    return v as AutonomousRunCompletionGrade;
  }
  return null;
}

function normalizeLane(input: unknown): PetReviewLaneSummary {
  const i = (input || {}) as Record<string, unknown>;
  const role = normalizeRole(i.role);
  const status = normalizeStatus(i.status);
  const grade = normalizeGrade(i.grade);
  const recommendation = normalizeRecommendation(i.recommendation);
  const highestPriority = normalizePriority(i.highestPriority);
  let issueCount = 0;
  const ic = i.issueCount;
  if (typeof ic === 'number' && Number.isFinite(ic)) {
    issueCount = Math.max(0, Math.floor(ic));
  }
  let updatedAt: number | null = null;
  const ua = i.updatedAt;
  if (typeof ua === 'number' && Number.isFinite(ua)) {
    updatedAt = ua;
  }
  return {
    role,
    status,
    grade,
    recommendation,
    highestPriority,
    issueCount,
    updatedAt,
  };
}

function pickHighestPriority(lanes: PetReviewLaneSummary[]): PetReviewLanePriority | null {
  if (lanes.some((l) => l.highestPriority === 'P1')) return 'P1';
  if (lanes.some((l) => l.highestPriority === 'P2')) return 'P2';
  if (lanes.some((l) => l.highestPriority === 'P3')) return 'P3';
  return null;
}

function pickWorstGrade(lanes: PetReviewLaneSummary[]): AutonomousRunCompletionGrade | null {
  const valid = lanes.map((l) => l.grade).filter((g): g is AutonomousRunCompletionGrade => g != null);
  if (valid.length === 0) return null;
  const rank: Record<AutonomousRunCompletionGrade, number> = { A: 1, B: 2, C: 3, D: 4, F: 5 };
  let worst: AutonomousRunCompletionGrade | null = null;
  let maxR = -1;
  for (const g of valid) {
    const r = rank[g] ?? 0;
    if (r > maxR) {
      maxR = r;
      worst = g;
    }
  }
  return worst;
}

export function mergePetReviewLanesIntoSnapshot(
  snapshot: PetControlSnapshot,
  lanes: PetReviewLaneInput[] | null | undefined,
): PetControlSnapshot {
  if (lanes === null || lanes === undefined) {
    return snapshot;
  }
  const inputArr = Array.isArray(lanes) ? lanes : [];
  const normalized = inputArr.slice(0, 4).map((l) => normalizeLane(l));
  const total = normalized.length;
  let activeCount = 0;
  let passedCount = 0;
  let blockedCount = 0;
  let failedCount = 0;
  let proceedCount = 0;
  let iterateCount = 0;
  let blockCount = 0;
  let unknownCount = 0;
  for (const l of normalized) {
    if (l.status === 'running') activeCount++;
    if (l.status === 'passed') passedCount++;
    if (l.status === 'blocked') blockedCount++;
    if (l.status === 'failed') failedCount++;
    if (l.recommendation === 'proceed') proceedCount++;
    else if (l.recommendation === 'iterate') iterateCount++;
    else if (l.recommendation === 'block') blockCount++;
    else unknownCount++;
  }
  const highestPriority = pickHighestPriority(normalized);
  const worstGrade = pickWorstGrade(normalized);
  const reviewLanes = {
    total,
    activeCount,
    passedCount,
    blockedCount,
    failedCount,
    highestPriority,
    worstGrade,
    proceedCount,
    iterateCount,
    blockCount,
    unknownCount,
    lanes: normalized,
  };
  return {
    ...snapshot,
    reviewLanes,
  };
}
