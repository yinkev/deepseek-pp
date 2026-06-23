import {
  getAutonomousRunLedgerSnapshot,
  getAutonomousRunQualityGates,
  reconcileInterruptedAutonomousRuns,
} from './store';
import {
  planAutonomousReviewLanes,
  type AutonomousReviewLanePlan,
  type AutonomousReviewLaneRiskFlags,
  type AutonomousReviewLaneSchedulerLaneInput,
} from './review-scheduler';
import {
  isBlockingReviewLaneRecord,
  selectReviewLaneBlockingPriority,
  selectReviewLaneGateReason,
  isBlockingGateInput,
} from './review-lane-gate';
import {
  createAutonomousRunTelemetryPackage,
  type AutonomousRunTelemetryCommit,
  type AutonomousRunTelemetryVerification,
} from './telemetry';
import {
  writeAutonomousRunTelemetryPackage,
  type AutonomousRunTelemetryWriteResult,
  type AutonomousRunTelemetryWriteTarget,
} from './telemetry-writer';
import {
  executeAutonomousRunCycle,
  type AutonomousRunActionKind,
  type AutonomousRunCycleResult,
  type AutonomousRunExecutor,
  type AutonomousRunReviewLaneGateInput,
} from './worker';
import type {
  AutonomousQualityGateGrade,
  AutonomousQualityGateRecord,
  AutonomousQualityGateStatus,
  AutonomousReviewLaneRecord,
  AutonomousRun,
  AutonomousRunId,
  AutonomousRunStatus,
  AutonomousRunStep,
  AutonomousRunStorageState,
  AutonomousTargetLease,
} from './types';

export const AUTONOMOUS_RUN_STARTUP_RECONCILE_THRESHOLD_MS = 5 * 60 * 1000;

export interface AutonomousRunCockpitSnapshot {
  schemaVersion: 1;
  generatedAt: number;
  status: 'idle' | 'queued' | 'running' | 'paused' | 'blocked' | 'complete';
  totals: Record<AutonomousRunStatus, number>;
  activeRun: AutonomousRunCockpitRun | null;
}

export interface AutonomousRunCockpitRun {
  id: string;
  goal: string;
  mode: AutonomousRun['mode'];
  status: AutonomousRunStatus;
  targetLeaseId: string | null;
  targetLeaseStatus: 'none' | AutonomousTargetLease['status'];
  targetLeaseAgeMs: number | null;
  targetLeaseExpiresInMs: number | null;
  createdAt: number;
  startedAt: number | null;
  updatedAt: number;
  latestStep: Pick<AutonomousRunStep, 'id' | 'phase' | 'status' | 'progressScore' | 'endedAt'> | null;
  stepCount: number;
  evidenceCount: number;
  freshEvidenceCount: number;
  staleEvidenceCount: number;
  expiredEvidenceCount: number;
  latestEvidenceAt: number | null;
  targetLeaseCount: number;
  errorCode: string | null;
}

export interface AutonomousRunStartupResult {
  reconciledInterruptedRuns: number;
  snapshot: AutonomousRunCockpitSnapshot;
}

export interface AutonomousRunOrchestratorCycleOptions {
  interruptedThresholdMs?: number;
  now?: number;
  actionKind?: AutonomousRunActionKind;
  reviewLaneGate?: AutonomousRunReviewLaneGateInput | null;
  reviewLaneScheduler?: AutonomousRunOrchestratorReviewLaneSchedulerInput | null;
  telemetry?: AutonomousRunOrchestratorTelemetryInput | null;
}

export interface AutonomousRunOrchestratorReviewLaneSchedulerInput {
  lanes?: readonly AutonomousReviewLaneSchedulerLaneInput[] | null;
  maxParallel?: number | null;
  workerAdvanced?: boolean | null;
  workerApplied?: boolean | null;
  risk?: AutonomousReviewLaneRiskFlags | null;
  oracleRequested?: boolean | null;
  grokRequested?: boolean | null;
}

export interface AutonomousRunOrchestratorCycleResult {
  selectedRunId: AutonomousRunId | null;
  reconciledInterruptedRuns: number;
  beforeSnapshot: AutonomousRunCockpitSnapshot;
  reviewLanePlan: AutonomousReviewLanePlan;
  qualityGateDecision: AutonomousRunQualityGateDecision | null;
  workerResult: AutonomousRunCycleResult | null;
  telemetryResult: AutonomousRunOrchestratorTelemetryResult | null;
  afterSnapshot: AutonomousRunCockpitSnapshot;
}

export interface AutonomousRunOrchestratorTelemetryInput {
  target?: AutonomousRunTelemetryWriteTarget | null;
  rootDir?: string;
  verification?: readonly AutonomousRunTelemetryVerification[] | null;
  commits?: readonly AutonomousRunTelemetryCommit[] | null;
}

export type AutonomousRunOrchestratorTelemetryResult =
  | {
    status: 'written';
    runId: string;
    rootDir: string;
    fileCount: number;
    contentLength: number;
    paths: string[];
    errorCode: null;
  }
  | {
    status: 'skipped';
    runId: null;
    rootDir: null;
    fileCount: 0;
    contentLength: 0;
    paths: [];
    errorCode: 'no_selected_run' | 'package_unavailable' | 'target_unavailable';
  }
  | {
    status: 'failed';
    runId: string | null;
    rootDir: string | null;
    fileCount: 0;
    contentLength: 0;
    paths: [];
    errorCode: 'telemetry_write_failed';
  };

/**
 * Compact quality-gate decision for orchestrator cycle results.
 * Contains only safe aggregate metadata — no raw gate ids,
 * reviewer prose, commit messages, command summaries, evidence ids,
 * URLs, tokens, or secrets.
 */
export interface AutonomousRunQualityGateDecision {
  /** Whether the gate blocks worker execution. */
  blocked: boolean;
  /** Machine-readable reason for the decision. */
  reason:
    | 'no_quality_gate'
    | 'gate_passed'
    | 'gate_warning'
    | 'gate_failed'
    | 'gate_blocked'
    | 'contract_rows_missing'
    | 'contract_conflicts'
    | 'false_positive_probe_failed'
    | 'state_inconsistent'
    | 'review_issues';
  /** Top-level status of the latest quality gate, or null if none exist. */
  latestGateStatus: AutonomousQualityGateStatus | null;
  /** Sequence number of the latest gate, or null. */
  seq: number | null;
  /** Whether contract coverage was complete in the latest gate. */
  coverageComplete: boolean | null;
  /** Count of first-class contract coverage rows in the latest gate. */
  coverageRowCount: number | null;
  /** Count of covered requirements. */
  coveredCount: number | null;
  /** Count of uncovered/gap requirements. */
  gapCount: number | null;
  /** Count of conflicting requirements. */
  conflictCount: number | null;
  /** Count of explicitly not-testable items. */
  notTestableCount: number | null;
  /** Self-review grade from the latest gate. */
  selfReviewGrade: AutonomousQualityGateGrade | null;
  /** False-positive success probe status from the latest gate. */
  falsePositiveProbeStatus: AutonomousQualityGateRecord['falsePositiveProbe']['status'] | null;
  /** Whether all verification commands passed. null when no commands exist. */
  verificationPassed: boolean | null;
}

export function deriveAutonomousRunReviewLaneGate(
  records: readonly AutonomousReviewLaneRecord[],
): AutonomousRunReviewLaneGateInput {
  const blockingRecords = records.filter(isBlockingReviewLaneRecord);
  if (blockingRecords.length === 0) {
    return records.some((record) => record.status === 'running')
      ? {
        status: 'attention',
        reason: 'active_review',
        canProceed: true,
        blockingPriority: null,
        blockingLaneCount: 0,
      }
      : {
        status: 'clear',
        reason: 'none',
        canProceed: true,
        blockingPriority: null,
        blockingLaneCount: 0,
      };
  }

  const blockingPriority = selectReviewLaneBlockingPriority(blockingRecords);

  return {
    status: 'blocked',
    reason: selectReviewLaneGateReason(blockingRecords, blockingPriority),
    canProceed: false,
    blockingPriority,
    blockingLaneCount: blockingRecords.length,
  };
}

export async function initializeAutonomousRunOrchestrator(
  options: {
    interruptedThresholdMs?: number;
    now?: number;
  } = {},
): Promise<AutonomousRunStartupResult> {
  const now = options.now ?? Date.now();
  const reconciledInterruptedRuns = await reconcileInterruptedAutonomousRuns(
    options.interruptedThresholdMs ?? AUTONOMOUS_RUN_STARTUP_RECONCILE_THRESHOLD_MS,
    now,
  );
  return {
    reconciledInterruptedRuns,
    snapshot: await getAutonomousRunCockpitSnapshot(now),
  };
}

export async function evaluateAutonomousRunQualityGate(
  runId: AutonomousRunId,
): Promise<AutonomousRunQualityGateDecision> {
  const gates = await getAutonomousRunQualityGates(runId);
  return evaluateAutonomousQualityGateRecord(gates[gates.length - 1] ?? null);
}

export function evaluateAutonomousQualityGateRecord(
  latest: AutonomousQualityGateRecord | null,
): AutonomousRunQualityGateDecision {
  if (!latest) {
    return {
      blocked: false,
      reason: 'no_quality_gate',
      latestGateStatus: null,
      seq: null,
      coverageComplete: null,
      coverageRowCount: null,
      coveredCount: null,
      gapCount: null,
      conflictCount: null,
      notTestableCount: null,
      selfReviewGrade: null,
      falsePositiveProbeStatus: null,
      verificationPassed: null,
    };
  }

  // Deep block conditions — independent of top-level status
  const deepBlocked =
    latest.independentReview.status === 'failed' ||
    latest.independentReview.status === 'blocked' ||
    latest.independentReview.blockingIssueCount > 0 ||
    latest.contractCoverage.rows.length === 0 ||
    latest.resultStateConsistency.status === 'inconsistent' ||
    latest.resultStateConsistency.blockingIssueCount > 0 ||
    latest.falsePositiveProbe.status === 'failed' ||
    latest.falsePositiveProbe.blockingIssueCount > 0 ||
    latest.contractCoverage.conflictCount > 0;

  // Top-level block conditions
  const gateBlocked = latest.status === 'failed' || latest.status === 'blocked';

  const blocked = deepBlocked || gateBlocked;

  const reason = blocked
    ? gateBlocked
      ? latest.status === 'failed' ? 'gate_failed' : 'gate_blocked'
      : latest.contractCoverage.conflictCount > 0
        ? 'contract_conflicts'
        : latest.contractCoverage.rows.length === 0
          ? 'contract_rows_missing'
          : latest.falsePositiveProbe.status === 'failed' ||
              latest.falsePositiveProbe.blockingIssueCount > 0
            ? 'false_positive_probe_failed'
            : latest.resultStateConsistency.status === 'inconsistent' ||
            latest.resultStateConsistency.blockingIssueCount > 0
              ? 'state_inconsistent'
              : 'review_issues'
    : latest.status === 'warning'
      ? 'gate_warning'
      : 'gate_passed';

  const verificationPassed = latest.verification.commands.length > 0
    ? latest.verification.commands.every((cmd) => cmd.result === 'passed')
    : null;

  return {
    blocked,
    reason,
    latestGateStatus: latest.status,
    seq: latest.seq,
    coverageComplete: latest.contractCoverage.complete,
    coverageRowCount: latest.contractCoverage.rows.length,
    coveredCount: latest.contractCoverage.coveredCount,
    gapCount: latest.contractCoverage.gapCount,
    conflictCount: latest.contractCoverage.conflictCount,
    notTestableCount: latest.contractCoverage.notTestableCount,
    selfReviewGrade: latest.selfReview.grade,
    falsePositiveProbeStatus: latest.falsePositiveProbe.status,
    verificationPassed,
  };
}

export async function executeAutonomousOrchestratorCycle(
  executor: AutonomousRunExecutor,
  options: AutonomousRunOrchestratorCycleOptions = {},
): Promise<AutonomousRunOrchestratorCycleResult> {
  const now = options.now ?? Date.now();
  const reconciledInterruptedRuns = await reconcileInterruptedAutonomousRuns(
    options.interruptedThresholdMs ?? AUTONOMOUS_RUN_STARTUP_RECONCILE_THRESHOLD_MS,
    now,
  );
  const beforeSnapshot = await getAutonomousRunCockpitSnapshot(now);
  const ledger = await getAutonomousRunLedgerSnapshot();
  const selectedRun = selectRunnableRun(ledger.runs);
  const selectedRunId = selectedRun?.id ?? null;
  const persistedReviewLaneGate = selectedRunId
    ? deriveAutonomousRunReviewLaneGate(ledger.reviewLanes.filter((record) => record.runId === selectedRunId))
    : null;
  const effectiveReviewLaneGate = mergeReviewLaneGates(options.reviewLaneGate, persistedReviewLaneGate);
  const reviewLanePlan = planAutonomousReviewLanes({
    runStatus: selectedRun?.status ?? null,
    reviewLaneGate: effectiveReviewLaneGate,
    lanes: options.reviewLaneScheduler?.lanes,
    maxParallel: options.reviewLaneScheduler?.maxParallel,
    workerAdvanced: options.reviewLaneScheduler?.workerAdvanced,
    workerApplied: options.reviewLaneScheduler?.workerApplied,
    risk: options.reviewLaneScheduler?.risk,
    oracleRequested: options.reviewLaneScheduler?.oracleRequested,
    grokRequested: options.reviewLaneScheduler?.grokRequested,
  });

  // Quality gate check — consulted before executor is called
  const qualityGateDecision = selectedRunId
    ? await evaluateAutonomousRunQualityGate(selectedRunId)
    : null;
  const gateBlocks = qualityGateDecision?.blocked === true;

  const workerResult = selectedRunId && !gateBlocks
    ? await executeAutonomousRunCycle(selectedRunId, executor, {
      now,
      actionKind: options.actionKind,
      reviewLaneGate: effectiveReviewLaneGate,
    })
    : null;
  const afterSnapshot = await getAutonomousRunCockpitSnapshot(now);
  const telemetryResult = await writeOrchestratorTelemetry(selectedRunId, options.telemetry, now);
  return {
    selectedRunId,
    reconciledInterruptedRuns,
    beforeSnapshot,
    reviewLanePlan,
    qualityGateDecision,
    workerResult,
    telemetryResult,
    afterSnapshot,
  };
}

function mergeReviewLaneGates(
  explicitGate: AutonomousRunReviewLaneGateInput | null | undefined,
  persistedGate: AutonomousRunReviewLaneGateInput | null | undefined,
): AutonomousRunReviewLaneGateInput | null {
  if (isBlockingGateInput(persistedGate)) return persistedGate ?? null;
  if (isBlockingGateInput(explicitGate)) return explicitGate ?? null;
  return explicitGate ?? persistedGate ?? null;
}

export async function getAutonomousRunCockpitSnapshot(
  now = Date.now(),
): Promise<AutonomousRunCockpitSnapshot> {
  const state = await getAutonomousRunLedgerSnapshot();
  const runs = sortRunsByUpdatedAt(state.runs);
  const totals = createStatusTotals(runs);
  const activeRun = selectCockpitRun(runs);
  return {
    schemaVersion: 1,
    generatedAt: now,
    status: getCockpitStatus(totals),
    totals,
    activeRun: activeRun ? toCockpitRun(activeRun, state, now) : null,
  };
}

function sortRunsByUpdatedAt(runs: readonly AutonomousRun[]): AutonomousRun[] {
  return [...runs].sort((a, b) => b.updatedAt - a.updatedAt);
}

function createStatusTotals(runs: readonly AutonomousRun[]): Record<AutonomousRunStatus, number> {
  return {
    queued: countRuns(runs, 'queued'),
    running: countRuns(runs, 'running'),
    paused: countRuns(runs, 'paused'),
    blocked: countRuns(runs, 'blocked'),
    succeeded: countRuns(runs, 'succeeded'),
    failed: countRuns(runs, 'failed'),
    cancelled: countRuns(runs, 'cancelled'),
  };
}

function countRuns(runs: readonly AutonomousRun[], status: AutonomousRunStatus): number {
  return runs.filter((run) => run.status === status).length;
}

function selectRunnableRun(runs: readonly AutonomousRun[]): AutonomousRun | null {
  const sorted = sortRunsByUpdatedAt(runs);
  return sorted.find((run) => run.status === 'running') ??
    sorted.find((run) => run.status === 'queued') ??
    null;
}

function getCockpitStatus(totals: Record<AutonomousRunStatus, number>): AutonomousRunCockpitSnapshot['status'] {
  if (totals.running > 0) return 'running';
  if (totals.blocked > 0) return 'blocked';
  if (totals.paused > 0) return 'paused';
  if (totals.queued > 0) return 'queued';
  if (totals.succeeded + totals.failed + totals.cancelled > 0) return 'complete';
  return 'idle';
}

function selectCockpitRun(runs: readonly AutonomousRun[]): AutonomousRun | null {
  return runs.find((run) => run.status === 'running') ??
    runs.find((run) => run.status === 'blocked') ??
    runs.find((run) => run.status === 'paused') ??
    runs.find((run) => run.status === 'queued') ??
    runs[0] ??
    null;
}

function toCockpitRun(run: AutonomousRun, state: AutonomousRunStorageState, now: number): AutonomousRunCockpitRun {
  const steps = state.steps
    .filter((step) => step.runId === run.id)
    .sort((a, b) => a.seq - b.seq);
  const evidence = state.evidence.filter((record) => record.runId === run.id);
  const targetLeases = state.targetLeases
    .filter((lease) => lease.runId === run.id)
    .sort((a, b) => b.acquiredAt - a.acquiredAt);
  const latestStep = steps[steps.length - 1] ?? null;
  const selectedLease = run.targetLeaseId
    ? targetLeases.find((lease) => lease.id === run.targetLeaseId) ?? null
    : targetLeases[0] ?? null;
  const targetLeaseStatus = getCockpitTargetLeaseStatus(selectedLease, now);
  const targetLeaseAgeMs = selectedLease ? Math.max(0, now - selectedLease.acquiredAt) : null;
  const targetLeaseExpiresInMs = selectedLease ? Math.max(0, selectedLease.expiresAt - now) : null;
  const freshEvidenceCount = evidence.filter((record) => record.freshness === 'fresh' && record.expiresAt > now).length;
  const expiredEvidenceCount = evidence.filter((record) => record.freshness === 'expired' || record.expiresAt <= now).length;
  const staleEvidenceCount = evidence.filter((record) => record.freshness === 'stale' && record.expiresAt > now).length;
  const latestEvidenceAt = evidence.reduce<number | null>(
    (latest, record) => latest === null ? record.capturedAt : Math.max(latest, record.capturedAt),
    null,
  );
  return {
    id: run.id,
    goal: run.goal,
    mode: run.mode,
    status: run.status,
    targetLeaseId: run.targetLeaseId,
    targetLeaseStatus,
    targetLeaseAgeMs,
    targetLeaseExpiresInMs,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    latestStep: latestStep
      ? {
        id: latestStep.id,
        phase: latestStep.phase,
        status: latestStep.status,
        progressScore: latestStep.progressScore,
        endedAt: latestStep.endedAt,
      }
      : null,
    stepCount: steps.length,
    evidenceCount: evidence.length,
    freshEvidenceCount,
    staleEvidenceCount,
    expiredEvidenceCount,
    latestEvidenceAt,
    targetLeaseCount: targetLeases.length,
    errorCode: run.error?.code ?? null,
  };
}

function getCockpitTargetLeaseStatus(
  lease: AutonomousTargetLease | null,
  now: number,
): AutonomousRunCockpitRun['targetLeaseStatus'] {
  if (!lease) return 'none';
  if (lease.status === 'active' && lease.expiresAt <= now) return 'expired';
  return lease.status;
}

async function writeOrchestratorTelemetry(
  selectedRunId: AutonomousRunId | null,
  input: AutonomousRunOrchestratorTelemetryInput | null | undefined,
  now: number,
): Promise<AutonomousRunOrchestratorTelemetryResult | null> {
  if (!input) return null;
  if (!selectedRunId) return createSkippedTelemetryResult('no_selected_run');
  if (!input.target) return createSkippedTelemetryResult('target_unavailable');

  const pkg = createAutonomousRunTelemetryPackage(await getAutonomousRunLedgerSnapshot(), selectedRunId, {
    generatedAt: now,
    rootDir: input.rootDir,
    verification: input.verification,
    commits: input.commits,
  });
  if (!pkg) return createSkippedTelemetryResult('package_unavailable');

  try {
    return toTelemetryResult(await writeAutonomousRunTelemetryPackage(pkg, input.target));
  } catch {
    return {
      status: 'failed',
      runId: pkg.runId,
      rootDir: pkg.rootDir,
      fileCount: 0,
      contentLength: 0,
      paths: [],
      errorCode: 'telemetry_write_failed',
    };
  }
}

function toTelemetryResult(result: AutonomousRunTelemetryWriteResult): AutonomousRunOrchestratorTelemetryResult {
  return {
    status: 'written',
    runId: result.runId,
    rootDir: result.rootDir,
    fileCount: result.fileCount,
    contentLength: result.contentLength,
    paths: result.paths,
    errorCode: null,
  };
}

function createSkippedTelemetryResult(
  errorCode: Extract<AutonomousRunOrchestratorTelemetryResult, { status: 'skipped' }>['errorCode'],
): AutonomousRunOrchestratorTelemetryResult {
  return {
    status: 'skipped',
    runId: null,
    rootDir: null,
    fileCount: 0,
    contentLength: 0,
    paths: [],
    errorCode,
  };
}
