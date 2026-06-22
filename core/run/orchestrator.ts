import {
  getAutonomousRunLedgerSnapshot,
  reconcileInterruptedAutonomousRuns,
} from './store';
import {
  executeAutonomousRunCycle,
  type AutonomousRunActionKind,
  type AutonomousRunCycleResult,
  type AutonomousRunExecutor,
} from './worker';
import type {
  AutonomousRun,
  AutonomousRunId,
  AutonomousRunStatus,
  AutonomousRunStep,
  AutonomousRunStorageState,
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
  createdAt: number;
  startedAt: number | null;
  updatedAt: number;
  latestStep: Pick<AutonomousRunStep, 'id' | 'phase' | 'status' | 'progressScore' | 'endedAt'> | null;
  stepCount: number;
  evidenceCount: number;
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
}

export interface AutonomousRunOrchestratorCycleResult {
  selectedRunId: AutonomousRunId | null;
  reconciledInterruptedRuns: number;
  beforeSnapshot: AutonomousRunCockpitSnapshot;
  workerResult: AutonomousRunCycleResult | null;
  afterSnapshot: AutonomousRunCockpitSnapshot;
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
  const selectedRunId = selectRunnableRun((await getAutonomousRunLedgerSnapshot()).runs)?.id ?? null;
  const workerResult = selectedRunId
    ? await executeAutonomousRunCycle(selectedRunId, executor, {
      now,
      actionKind: options.actionKind,
    })
    : null;
  return {
    selectedRunId,
    reconciledInterruptedRuns,
    beforeSnapshot,
    workerResult,
    afterSnapshot: await getAutonomousRunCockpitSnapshot(now),
  };
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
    activeRun: activeRun ? toCockpitRun(activeRun, state) : null,
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

function toCockpitRun(run: AutonomousRun, state: AutonomousRunStorageState): AutonomousRunCockpitRun {
  const steps = state.steps
    .filter((step) => step.runId === run.id)
    .sort((a, b) => a.seq - b.seq);
  const evidence = state.evidence.filter((record) => record.runId === run.id);
  const targetLeases = state.targetLeases.filter((lease) => lease.runId === run.id);
  const latestStep = steps[steps.length - 1] ?? null;
  return {
    id: run.id,
    goal: run.goal,
    mode: run.mode,
    status: run.status,
    targetLeaseId: run.targetLeaseId,
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
    targetLeaseCount: targetLeases.length,
    errorCode: run.error?.code ?? null,
  };
}
