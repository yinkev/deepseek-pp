import {
  type AutonomousRunCockpitSnapshot,
  getAutonomousRunCockpitSnapshot,
} from '../run/orchestrator';
import type { RuntimeDoctorReport } from '../chat/runtime-doctor';
import type {
  AutonomousRunCompletionDecision,
  AutonomousRunCompletionGrade,
  AutonomousRunCompletionReview,
} from '../run/review';

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
}

type PetEvidencePulse = PetControlSnapshot['evidence'];
type PetBlockerLens = PetControlSnapshot['blockerLens'];
type PetReviewHeat = PetControlSnapshot['reviewHeat'];

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
  };
}

export async function getPetControlSnapshot(
  now = Date.now(),
): Promise<PetControlSnapshot> {
  const cockpit = await getAutonomousRunCockpitSnapshot(now);
  return createPetControlSnapshotFromRunCockpit(cockpit);
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
  evidenceStatus: PetControlSnapshot['evidence']['status'];
  evidenceCount: number;
  latestEvidenceAgeMs: number | null;
  grade: PetControlSnapshot['review']['grade'];
  canFinalize: boolean;
  nextAction: PetHandoffNextAction;
}

export function createPetHandoffCapsule(snapshot: PetControlSnapshot): PetHandoffCapsule {
  const { readiness, run, target, safety, review, evidence, generatedAt } = snapshot;

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
    evidenceStatus,
    evidenceCount,
    latestEvidenceAgeMs,
    grade,
    canFinalize,
    nextAction,
  };
}
