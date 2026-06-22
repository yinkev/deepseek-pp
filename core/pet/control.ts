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
  };
  safety: {
    leakIssueCount: number;
    highRiskArmed: boolean;
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
}

type PetEvidencePulse = PetControlSnapshot['evidence'];

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
  const targetStale = false;

  const leakIssueCount = 0;
  let highRiskArmed = false;
  const evidence = createPetEvidencePulse(activeRun, snapshot.generatedAt);

  if (activeRun) {
    runLabel = activeRun.goal ?? null;
    targetLocked = !!activeRun.targetLeaseId || (activeRun.targetLeaseCount > 0);
    targetLabel = targetLocked ? 'Target locked' : null;
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
    },
    safety: {
      leakIssueCount,
      highRiskArmed,
    },
    evidence,
    review: {
      grade: null,
      decision: null,
      proofDebtCount: 0,
      issueCount: 0,
      acceptedEvidenceCount: 0,
      canFinalize: false,
    },
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

  return {
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

  return {
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
  reviewState: 'none' | 'pass' | 'iterate' | 'fail';
  blockerCount: number;
  proofDebtCount: number;
  issueCount: number;
  acceptedEvidenceCount: number;
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
  const proofDebtCount = review.proofDebtCount;
  const issueCount = review.issueCount;
  const acceptedEvidenceCount = review.acceptedEvidenceCount;
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
    reviewState,
    blockerCount,
    proofDebtCount,
    issueCount,
    acceptedEvidenceCount,
    evidenceStatus,
    evidenceCount,
    latestEvidenceAgeMs,
    grade,
    canFinalize,
    nextAction,
  };
}
