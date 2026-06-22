import { redactDurableToolString } from '../tool/redaction';
import type { BrowserControlTarget } from '../browser-control/types';
import {
  isTerminalRunStatus,
  shouldTransitionAutonomousRun,
} from './kernel';
import {
  reviewAutonomousRunIteration,
  type AutonomousRunIterationReview,
} from './iteration';
import {
  DEFAULT_AUTONOMOUS_EVIDENCE_TTL_MS,
  DEFAULT_AUTONOMOUS_TARGET_LEASE_TTL_MS,
} from './target';
import type {
  AutonomousEvidenceCreateInput,
  AutonomousEvidenceRecord,
  AutonomousRun,
  AutonomousRunBudgets,
  AutonomousRunCheckpoint,
  AutonomousRunCreateInput,
  AutonomousRunError,
  AutonomousRunId,
  AutonomousRunPolicy,
  AutonomousRunProofContract,
  AutonomousRunStep,
  AutonomousRunStepCreateInput,
  AutonomousRunStorageState,
  AutonomousRunUpdateInput,
  AutonomousTargetLease,
  AutonomousTargetLeaseCreateInput,
} from './types';

export const AUTONOMOUS_RUN_STORAGE_KEY = 'deepseek_pp_autonomous_runs_v1';

const STORAGE_VERSION = 1;
const MAX_RUNS = 100;
const MAX_STEPS = 1_000;
const MAX_TARGET_LEASES = 200;
const MAX_EVIDENCE_RECORDS = 500;
const MAX_TEXT_LENGTH = 2_000;
const MAX_LIST_ITEMS = 32;
const MAX_DETAILS_DEPTH = 3;
const MAX_DETAILS_KEYS = 16;
const MAX_DETAILS_ARRAY_ITEMS = 16;
const MAX_DETAILS_STRING_LENGTH = 512;
const MAX_DETAILS_JSON_LENGTH = 4_000;
const MUTATION_LOCK_NAME = `${AUTONOMOUS_RUN_STORAGE_KEY}:mutation`;
const GENERIC_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>)}\]]+/gi;

export const DEFAULT_AUTONOMOUS_RUN_BUDGETS: AutonomousRunBudgets = {
  maxWallMs: 2 * 60 * 60 * 1000,
  maxModelTurns: 80,
  maxToolCalls: 200,
  maxConsecutiveNoProgress: 4,
  maxSameErrorRepeats: 2,
  maxPromptBytesPerTurn: 48_000,
  maxObservationBytesPerTurn: 12_000,
};

export const DEFAULT_AUTONOMOUS_RUN_POLICY: AutonomousRunPolicy = {
  approvalMode: 'auto_low_risk',
  allowedTools: [],
  deniedTools: [],
  browserMutationRequiresTargetLock: true,
  persistMemory: 'propose',
  shellMode: 'allowlisted',
};

export const DEFAULT_AUTONOMOUS_PROOF_CONTRACT: AutonomousRunProofContract = {
  doneCriteria: [],
  requiredEvidence: [],
  antiProof: [
    'Do not claim completion from model text alone.',
    'Do not claim browser actions succeeded without post-action evidence.',
  ],
};

export interface AutonomousRunIterationApplyInput {
  runId: AutonomousRunId;
  completionClaimed?: boolean;
  liveTarget?: Pick<BrowserControlTarget, 'id' | 'windowId' | 'url' | 'controllable'> | null;
}

export interface AutonomousRunIterationApplyResult {
  run: AutonomousRun | null;
  step: AutonomousRunStep | null;
  review: AutonomousRunIterationReview | null;
  applied: boolean;
}

const EMPTY_STATE: AutonomousRunStorageState = {
  version: STORAGE_VERSION,
  runs: [],
  steps: [],
  targetLeases: [],
  evidence: [],
};

let storageMutationQueue: Promise<unknown> = Promise.resolve();

export async function createAutonomousRun(
  input: AutonomousRunCreateInput,
  now = Date.now(),
): Promise<AutonomousRun> {
  const id = normalizeId(input.id) ?? createId('run');
  const run: AutonomousRun = {
    id,
    goal: normalizeText(input.goal, MAX_TEXT_LENGTH) || 'Untitled autonomous run',
    mode: input.mode === 'interactive' ? 'interactive' : 'unattended',
    status: 'queued',
    modelAdapter: input.modelAdapter === 'deepseek_api' ? 'deepseek_api' : 'deepseek_web',
    targetLeaseId: normalizeId(input.targetLeaseId),
    budgets: normalizeBudgets(input.budgets),
    policy: normalizePolicy(input.policy),
    proofContract: normalizeProofContract(input.proofContract),
    checkpoint: normalizeCheckpoint(input.checkpoint),
    error: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  };
  return mutateAutonomousRunState((state) => ({
    state: {
      ...state,
      runs: pruneRuns([run, ...state.runs.filter((stored) => stored.id !== run.id)]),
      steps: state.steps.filter((step) => step.runId !== run.id),
      targetLeases: state.targetLeases.filter((lease) => lease.runId !== run.id),
      evidence: state.evidence.filter((record) => record.runId !== run.id),
    },
    result: run,
  }));
}

export async function getAutonomousRuns(limit = MAX_RUNS): Promise<AutonomousRun[]> {
  const state = await readAutonomousRunState();
  return [...state.runs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

export async function getAutonomousRunById(id: AutonomousRunId): Promise<AutonomousRun | null> {
  const state = await readAutonomousRunState();
  return state.runs.find((run) => run.id === id) ?? null;
}

export async function getAutonomousRunSteps(runId: AutonomousRunId): Promise<AutonomousRunStep[]> {
  const state = await readAutonomousRunState();
  return state.steps
    .filter((step) => step.runId === runId)
    .sort((a, b) => a.seq - b.seq);
}

export async function getAutonomousRunLedgerSnapshot(): Promise<AutonomousRunStorageState> {
  return readAutonomousRunState();
}

export async function updateAutonomousRun(
  id: AutonomousRunId,
  patch: AutonomousRunUpdateInput,
  now = Date.now(),
): Promise<AutonomousRun | null> {
  return mutateAutonomousRunState((state) => {
    let updated: AutonomousRun | null = null;
    const runs = state.runs.map((run) => {
      if (run.id !== id) return run;
      if (isTerminalRunStatus(run.status)) {
        updated = run;
        return run;
      }
      const status = patch.status && shouldTransitionAutonomousRun(run.status, patch.status)
        ? patch.status
        : run.status;
      const startedAt = status === 'running'
        ? normalizeTimestamp(patch.startedAt) ?? run.startedAt ?? now
        : ('startedAt' in patch ? normalizeTimestamp(patch.startedAt) : run.startedAt);
      updated = normalizeRun({
        ...run,
        ...patch,
        status,
        startedAt,
        budgets: normalizeBudgets({ ...run.budgets, ...patch.budgets }),
        policy: normalizePolicy({ ...run.policy, ...patch.policy }),
        proofContract: normalizeProofContract({ ...run.proofContract, ...patch.proofContract }),
        checkpoint: normalizeCheckpoint({ ...run.checkpoint, ...patch.checkpoint }),
        error: 'error' in patch ? normalizeError(patch.error) : run.error,
        updatedAt: now,
      });
      return updated ?? run;
    });
    return {
      state: updated ? { ...state, runs: pruneRuns(runs) } : state,
      result: updated,
      write: updated !== null,
    };
  });
}

export async function transitionAutonomousRun(
  id: AutonomousRunId,
  status: AutonomousRun['status'],
  error: AutonomousRunError | null = null,
  now = Date.now(),
): Promise<AutonomousRun | null> {
  return mutateAutonomousRunState((state) => {
    let updated: AutonomousRun | null = null;
    const runs = state.runs.map((run) => {
      if (run.id !== id) return run;
      if (isTerminalRunStatus(run.status)) {
        updated = run;
        return run;
      }
      if (!shouldTransitionAutonomousRun(run.status, status)) {
        updated = run;
        return run;
      }
      updated = normalizeRun({
        ...run,
        status,
        error,
        startedAt: run.startedAt ?? (status === 'running' ? now : null),
        completedAt: isTerminalRunStatus(status) ? now : run.completedAt,
        updatedAt: now,
      });
      return updated ?? run;
    });
    return {
      state: updated ? { ...state, runs: pruneRuns(runs) } : state,
      result: updated,
      write: updated !== null,
    };
  });
}

export async function appendAutonomousRunStep(
  runId: AutonomousRunId,
  input: AutonomousRunStepCreateInput,
  now = Date.now(),
): Promise<AutonomousRunStep | null> {
  return mutateAutonomousRunState((state) => {
    const run = state.runs.find((item) => item.id === runId);
    if (!run || isTerminalRunStatus(run.status)) {
      return { state, result: null, write: false };
    }
    const seq = state.steps.filter((stepItem) => stepItem.runId === runId).reduce((max, stepItem) => Math.max(max, stepItem.seq), 0) + 1;
    const step = normalizeStep({
      id: input.id ?? createId('step'),
      runId,
      seq,
      phase: input.phase,
      status: input.status ?? 'succeeded',
      modelTurnId: input.modelTurnId ?? null,
      toolCallIds: input.toolCallIds ?? [],
      observationRefs: input.observationRefs ?? [],
      evidenceRefs: input.evidenceRefs ?? [],
      progressScore: input.progressScore ?? 0,
      proofDelta: input.proofDelta ?? [],
      error: input.error ?? null,
      startedAt: input.startedAt ?? now,
      endedAt: input.endedAt ?? now,
    });
    if (!step) return { state, result: null, write: false };
    const runs = state.runs.map((item) => item.id === runId
      ? {
        ...item,
        checkpoint: {
          ...item.checkpoint,
          latestStepId: step.id,
        },
        updatedAt: now,
      }
      : item);
    return {
      state: {
        ...state,
        runs: pruneRuns(runs),
        steps: pruneSteps([step, ...state.steps.filter((stored) => stored.id !== step.id)]),
        version: STORAGE_VERSION,
      },
      result: step,
    };
  });
}

export async function updateAutonomousRunCheckpoint(
  id: AutonomousRunId,
  checkpoint: Partial<AutonomousRunCheckpoint>,
  now = Date.now(),
): Promise<AutonomousRun | null> {
  return mutateAutonomousRunState((state) => {
    let updated: AutonomousRun | null = null;
    const runs = state.runs.map((run) => {
      if (run.id !== id) return run;
      if (isTerminalRunStatus(run.status)) {
        updated = run;
        return run;
      }
      updated = normalizeRun({
        ...run,
        checkpoint: normalizeCheckpoint({
          ...run.checkpoint,
          ...checkpoint,
        }),
        updatedAt: now,
      });
      return updated ?? run;
    });
    return {
      state: updated ? { ...state, runs: pruneRuns(runs) } : state,
      result: updated,
      write: updated !== null,
    };
  });
}

export async function upsertAutonomousTargetLease(
  input: AutonomousTargetLeaseCreateInput,
  now = Date.now(),
): Promise<AutonomousTargetLease | null> {
  return mutateAutonomousRunState((state) => {
    const run = state.runs.find((item) => item.id === input.runId);
    if (!run || isTerminalRunStatus(run.status)) return { state, result: null, write: false };
    const lease = normalizeTargetLease({
      id: input.id ?? createId('lease'),
      runId: input.runId,
      status: 'active',
      label: input.label ?? 'Dev++',
      tabId: input.tabId,
      windowId: input.windowId,
      origin: input.origin,
      title: input.title ?? '',
      acquiredAt: input.acquiredAt ?? now,
      expiresAt: (input.acquiredAt ?? now) + normalizeLeaseTtlMs(input.ttlMs),
      lastVerifiedAt: now,
      releasedAt: null,
    });
    if (!lease) return { state, result: null, write: false };
    const runs = state.runs.map((item) => item.id === input.runId
      ? { ...item, targetLeaseId: lease.id, updatedAt: now }
      : item);
    const priorLeases = state.targetLeases.map((stored) => {
      if (stored.runId !== input.runId || stored.id === lease.id || stored.status !== 'active') return stored;
      return normalizeTargetLease({
        ...stored,
        status: 'stale',
        releasedAt: now,
        expiresAt: Math.min(stored.expiresAt, now),
      }) ?? stored;
    });
    return {
      state: {
        ...state,
        runs: pruneRuns(runs),
        targetLeases: pruneTargetLeases([lease, ...priorLeases.filter((stored) => stored.id !== lease.id)]),
      },
      result: lease,
    };
  });
}

export async function releaseAutonomousTargetLease(
  id: string,
  now = Date.now(),
): Promise<AutonomousTargetLease | null> {
  return mutateAutonomousRunState((state) => {
    let released: AutonomousTargetLease | null = null;
    const targetLeases = state.targetLeases.map((lease) => {
      if (lease.id !== id) return lease;
      released = normalizeTargetLease({
        ...lease,
        status: 'released',
        releasedAt: now,
        expiresAt: Math.min(lease.expiresAt, now),
      });
      return released ?? lease;
    });
    const runs = released
      ? state.runs.map((run) => run.targetLeaseId === released?.id ? { ...run, targetLeaseId: null, updatedAt: now } : run)
      : state.runs;
    return {
      state: released ? { ...state, runs: pruneRuns(runs), targetLeases: pruneTargetLeases(targetLeases) } : state,
      result: released,
      write: released !== null,
    };
  });
}

export async function getAutonomousTargetLeaseById(id: string): Promise<AutonomousTargetLease | null> {
  const state = await readAutonomousRunState();
  return state.targetLeases.find((lease) => lease.id === id) ?? null;
}

export async function getAutonomousRunTargetLeases(runId: AutonomousRunId): Promise<AutonomousTargetLease[]> {
  const state = await readAutonomousRunState();
  return state.targetLeases
    .filter((lease) => lease.runId === runId)
    .sort((a, b) => b.acquiredAt - a.acquiredAt);
}

export async function appendAutonomousEvidenceRecord(
  runId: AutonomousRunId,
  input: AutonomousEvidenceCreateInput,
  now = Date.now(),
): Promise<AutonomousEvidenceRecord | null> {
  return mutateAutonomousRunState((state) => {
    const run = state.runs.find((item) => item.id === runId);
    if (!run || isTerminalRunStatus(run.status)) return { state, result: null, write: false };
    const record = normalizeEvidenceRecord({
      id: input.id ?? createId('evidence'),
      runId,
      leaseId: 'leaseId' in input ? input.leaseId : run.targetLeaseId,
      kind: input.kind,
      freshness: 'fresh',
      capturedAt: input.capturedAt ?? now,
      expiresAt: (input.capturedAt ?? now) + normalizeEvidenceTtlMs(input.ttlMs),
      summary: input.summary ?? '',
      refs: input.refs ?? [],
      source: input.source ?? {},
      metadata: input.metadata ?? null,
    });
    if (!record) return { state, result: null, write: false };
    return {
      state: {
        ...state,
        runs: pruneRuns(state.runs.map((item) => item.id === runId ? { ...item, updatedAt: now } : item)),
        evidence: pruneEvidenceRecords([record, ...state.evidence.filter((stored) => stored.id !== record.id)]),
      },
      result: record,
    };
  });
}

export async function getAutonomousRunEvidence(runId: AutonomousRunId): Promise<AutonomousEvidenceRecord[]> {
  const state = await readAutonomousRunState();
  return state.evidence
    .filter((record) => record.runId === runId)
    .sort((a, b) => b.capturedAt - a.capturedAt);
}

export async function applyAutonomousRunIterationReview(
  input: AutonomousRunIterationApplyInput,
  now = Date.now(),
): Promise<AutonomousRunIterationApplyResult> {
  return mutateAutonomousRunState<AutonomousRunIterationApplyResult>((state) => {
    const run = state.runs.find((item) => item.id === input.runId) ?? null;
    if (!run) {
      return {
        state,
        result: { run: null, step: null, review: null, applied: false },
        write: false,
      };
    }

    const steps = state.steps.filter((step) => step.runId === run.id);
    const evidence = state.evidence.filter((record) => record.runId === run.id);
    const targetLease = run.targetLeaseId
      ? state.targetLeases.find((lease) => lease.id === run.targetLeaseId) ?? null
      : null;
    const review = reviewAutonomousRunIteration({
      run,
      steps,
      evidence,
      targetLease,
      liveTarget: input.liveTarget ?? null,
      completionClaimed: input.completionClaimed,
      now,
    });

    if (!review.nextStatus || review.action === 'noop') {
      return {
        state,
        result: { run, step: null, review, applied: false },
        write: false,
      };
    }

    const step = createAutonomousRunIterationStep(run.id, nextStepSeq(state.steps, run.id), review, now);
    if (!step) {
      return {
        state,
        result: { run, step: null, review, applied: false },
        write: false,
      };
    }

    const updatedRun = applyAutonomousRunIterationStatus(run, step.id, review, now);
    const nextState = {
      ...state,
      runs: pruneRuns(state.runs.map((item) => item.id === run.id ? updatedRun : item)),
      steps: pruneSteps([step, ...state.steps.filter((stored) => stored.id !== step.id)]),
    };
    return {
      state: nextState,
      result: { run: updatedRun, step, review, applied: true },
    };
  });
}

export async function reconcileInterruptedAutonomousRuns(
  thresholdMs: number,
  now = Date.now(),
): Promise<number> {
  return mutateAutonomousRunState((state) => {
    let count = 0;
    const runs = state.runs.map((run) => {
      if (run.status !== 'running') return run;
      if (now - run.updatedAt < thresholdMs) return run;
      count += 1;
      return normalizeRun({
        ...run,
        status: 'blocked',
        error: {
          code: 'autonomous_run_interrupted',
          message: 'Service worker stopped while the autonomous run was active.',
          phase: 'storage',
          retryable: true,
          at: now,
          details: { startedAt: run.startedAt, lastUpdatedAt: run.updatedAt },
        },
        updatedAt: now,
      }) ?? run;
    });
    return {
      state: count > 0 ? { ...state, runs } : state,
      result: count,
      write: count > 0,
    };
  });
}

function createAutonomousRunIterationStep(
  runId: AutonomousRunId,
  seq: number,
  review: AutonomousRunIterationReview,
  now: number,
): AutonomousRunStep | null {
  return normalizeStep({
    id: createId('step'),
    runId,
    seq,
    phase: 'review',
    status: review.action === 'block' || review.action === 'fail' ? 'failed' : 'succeeded',
    modelTurnId: null,
    toolCallIds: [],
    observationRefs: review.issueCodes.map((code) => `review:${code}`),
    evidenceRefs: review.acceptedEvidenceIds,
    progressScore: review.action === 'succeed' ? 1 : review.score / 100,
    proofDelta: [],
    error: review.action === 'block' || review.action === 'fail' ? review.error : null,
    startedAt: now,
    endedAt: now,
  });
}

function applyAutonomousRunIterationStatus(
  run: AutonomousRun,
  latestStepId: AutonomousRunStep['id'],
  review: AutonomousRunIterationReview,
  now: number,
): AutonomousRun {
  const requestedStatus = review.nextStatus ?? run.status;
  const status = shouldTransitionAutonomousRun(run.status, requestedStatus)
    ? requestedStatus
    : run.status;
  return normalizeRun({
    ...run,
    status,
    error: status === 'succeeded'
      ? null
      : (status !== run.status ? review.error : run.error),
    completedAt: isTerminalRunStatus(status) ? now : run.completedAt,
    checkpoint: {
      ...run.checkpoint,
      latestStepId,
    },
    updatedAt: now,
  }) ?? run;
}

function nextStepSeq(steps: readonly AutonomousRunStep[], runId: AutonomousRunId): number {
  return steps
    .filter((step) => step.runId === runId)
    .reduce((max, step) => Math.max(max, step.seq), 0) + 1;
}

async function readAutonomousRunState(): Promise<AutonomousRunStorageState> {
  const data = await chrome.storage.local.get(AUTONOMOUS_RUN_STORAGE_KEY) as Record<string, unknown>;
  return normalizeState(data[AUTONOMOUS_RUN_STORAGE_KEY]);
}

async function writeAutonomousRunState(state: AutonomousRunStorageState): Promise<void> {
  await chrome.storage.local.set({
    [AUTONOMOUS_RUN_STORAGE_KEY]: {
      version: STORAGE_VERSION,
      runs: pruneRuns(state.runs),
      steps: pruneSteps(state.steps),
      targetLeases: pruneTargetLeases(state.targetLeases),
      evidence: pruneEvidenceRecords(state.evidence),
    },
  });
}

interface AutonomousRunStateMutation<T> {
  state: AutonomousRunStorageState;
  result: T;
  write?: boolean;
}

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

interface NavigatorWithLocks {
  locks?: LockManagerLike;
}

async function mutateAutonomousRunState<T>(
  mutator: (state: AutonomousRunStorageState) => AutonomousRunStateMutation<T> | Promise<AutonomousRunStateMutation<T>>,
): Promise<T> {
  return withStorageMutationLock(async () => {
    const state = await readAutonomousRunState();
    const mutation = await mutator(state);
    if (mutation.write !== false) await writeAutonomousRunState(mutation.state);
    return mutation.result;
  });
}

async function withStorageMutationLock<T>(callback: () => Promise<T>): Promise<T> {
  const locks = getLockManager();
  if (locks) return locks.request(MUTATION_LOCK_NAME, callback);
  return enqueueStorageMutation(callback);
}

function enqueueStorageMutation<T>(callback: () => Promise<T>): Promise<T> {
  const operation = storageMutationQueue.catch(() => undefined).then(callback);
  storageMutationQueue = operation.catch(() => undefined);
  return operation;
}

function getLockManager(): LockManagerLike | null {
  const maybeNavigator = typeof globalThis.navigator === 'object'
    ? globalThis.navigator as NavigatorWithLocks
    : null;
  return maybeNavigator?.locks && typeof maybeNavigator.locks.request === 'function'
    ? maybeNavigator.locks
    : null;
}

function normalizeState(raw: unknown): AutonomousRunStorageState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_STATE };
  const value = raw as Partial<AutonomousRunStorageState>;
  return {
    version: STORAGE_VERSION,
    runs: Array.isArray(value.runs)
      ? value.runs.map(normalizeRun).filter((item): item is AutonomousRun => item !== null)
      : [],
    steps: Array.isArray(value.steps)
      ? value.steps.map(normalizeStep).filter((item): item is AutonomousRunStep => item !== null)
      : [],
    targetLeases: Array.isArray(value.targetLeases)
      ? value.targetLeases.map(normalizeTargetLease).filter((item): item is AutonomousTargetLease => item !== null)
      : [],
    evidence: Array.isArray(value.evidence)
      ? value.evidence.map(normalizeEvidenceRecord).filter((item): item is AutonomousEvidenceRecord => item !== null)
      : [],
  };
}

function normalizeRun(raw: unknown): AutonomousRun | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const run = raw as Partial<AutonomousRun>;
  const id = normalizeId(run.id);
  const createdAt = normalizeTimestamp(run.createdAt);
  const updatedAt = normalizeTimestamp(run.updatedAt);
  if (!id || createdAt === null || updatedAt === null) return null;
  return {
    id,
    goal: normalizeText(run.goal, MAX_TEXT_LENGTH) || 'Untitled autonomous run',
    mode: run.mode === 'interactive' ? 'interactive' : 'unattended',
    status: normalizeStatus(run.status),
    modelAdapter: run.modelAdapter === 'deepseek_api' ? 'deepseek_api' : 'deepseek_web',
    targetLeaseId: normalizeId(run.targetLeaseId),
    budgets: normalizeBudgets(run.budgets),
    policy: normalizePolicy(run.policy),
    proofContract: normalizeProofContract(run.proofContract),
    checkpoint: normalizeCheckpoint(run.checkpoint),
    error: normalizeError(run.error),
    createdAt,
    startedAt: normalizeTimestamp(run.startedAt),
    completedAt: normalizeTimestamp(run.completedAt),
    updatedAt,
  };
}

function normalizeStep(raw: unknown): AutonomousRunStep | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const step = raw as Partial<AutonomousRunStep>;
  const id = normalizeId(step.id);
  const runId = normalizeId(step.runId);
  const startedAt = normalizeTimestamp(step.startedAt);
  if (!id || !runId || startedAt === null || !isPhase(step.phase)) return null;
  const status = isStepStatus(step.status) ? step.status : 'succeeded';
  return {
    id,
    runId,
    seq: normalizeNonNegativeInteger(step.seq) ?? 0,
    phase: step.phase,
    status,
    modelTurnId: normalizeId(step.modelTurnId),
    toolCallIds: normalizeStringList(step.toolCallIds, MAX_LIST_ITEMS, 128),
    observationRefs: normalizeStringList(step.observationRefs, MAX_LIST_ITEMS, 128),
    evidenceRefs: normalizeStringList(step.evidenceRefs, MAX_LIST_ITEMS, 128),
    progressScore: clampProgressScore(step.progressScore),
    proofDelta: normalizeStringList(step.proofDelta, MAX_LIST_ITEMS, 256),
    error: normalizeError(step.error),
    startedAt,
    endedAt: normalizeTimestamp(step.endedAt),
  };
}

function normalizeTargetLease(raw: unknown): AutonomousTargetLease | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const lease = raw as Partial<AutonomousTargetLease>;
  const id = normalizeId(lease.id);
  const runId = normalizeId(lease.runId);
  const tabId = normalizeNonNegativeInteger(lease.tabId);
  const windowId = normalizeNonNegativeInteger(lease.windowId);
  const origin = normalizeOrigin(lease.origin);
  const acquiredAt = normalizeTimestamp(lease.acquiredAt);
  const expiresAt = normalizeTimestamp(lease.expiresAt);
  if (!id || !runId || tabId === null || windowId === null || !origin || acquiredAt === null || expiresAt === null) {
    return null;
  }
  return {
    id,
    runId,
    status: normalizeTargetLeaseStatus(lease.status),
    label: normalizeText(lease.label, 80) ?? 'Dev++',
    tabId,
    windowId,
    origin,
    title: normalizeText(lease.title, 160) ?? '',
    acquiredAt,
    expiresAt,
    lastVerifiedAt: normalizeTimestamp(lease.lastVerifiedAt),
    releasedAt: normalizeTimestamp(lease.releasedAt),
  };
}

function normalizeEvidenceRecord(raw: unknown): AutonomousEvidenceRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Partial<AutonomousEvidenceRecord>;
  const id = normalizeId(record.id);
  const runId = normalizeId(record.runId);
  const capturedAt = normalizeTimestamp(record.capturedAt);
  const expiresAt = normalizeTimestamp(record.expiresAt);
  if (!id || !runId || capturedAt === null || expiresAt === null || !isObservationKind(record.kind)) return null;
  return {
    id,
    runId,
    leaseId: normalizeId(record.leaseId),
    kind: record.kind,
    freshness: normalizeEvidenceFreshness(record.freshness),
    capturedAt,
    expiresAt,
    summary: normalizeText(record.summary, 512) ?? '',
    refs: normalizeStringList(record.refs, MAX_LIST_ITEMS, 128),
    source: normalizeEvidenceSource(record.source),
    metadata: normalizeDetails(record.metadata) ?? null,
  };
}

function normalizeBudgets(value: Partial<AutonomousRunBudgets> | undefined): AutonomousRunBudgets {
  return {
    maxWallMs: normalizePositiveInteger(value?.maxWallMs) ?? DEFAULT_AUTONOMOUS_RUN_BUDGETS.maxWallMs,
    maxModelTurns: normalizePositiveInteger(value?.maxModelTurns) ?? DEFAULT_AUTONOMOUS_RUN_BUDGETS.maxModelTurns,
    maxToolCalls: normalizePositiveInteger(value?.maxToolCalls) ?? DEFAULT_AUTONOMOUS_RUN_BUDGETS.maxToolCalls,
    maxConsecutiveNoProgress: normalizePositiveInteger(value?.maxConsecutiveNoProgress) ?? DEFAULT_AUTONOMOUS_RUN_BUDGETS.maxConsecutiveNoProgress,
    maxSameErrorRepeats: normalizePositiveInteger(value?.maxSameErrorRepeats) ?? DEFAULT_AUTONOMOUS_RUN_BUDGETS.maxSameErrorRepeats,
    maxPromptBytesPerTurn: normalizePositiveInteger(value?.maxPromptBytesPerTurn) ?? DEFAULT_AUTONOMOUS_RUN_BUDGETS.maxPromptBytesPerTurn,
    maxObservationBytesPerTurn: normalizePositiveInteger(value?.maxObservationBytesPerTurn) ?? DEFAULT_AUTONOMOUS_RUN_BUDGETS.maxObservationBytesPerTurn,
  };
}

function normalizePolicy(value: Partial<AutonomousRunPolicy> | undefined): AutonomousRunPolicy {
  return {
    approvalMode: value?.approvalMode === 'manual_all' || value?.approvalMode === 'confirm_high_risk'
      ? value.approvalMode
      : 'auto_low_risk',
    allowedTools: normalizeStringList(value?.allowedTools, MAX_LIST_ITEMS, 128),
    deniedTools: normalizeStringList(value?.deniedTools, MAX_LIST_ITEMS, 128),
    browserMutationRequiresTargetLock: true,
    persistMemory: value?.persistMemory === 'off' || value?.persistMemory === 'auto_pinned_only'
      ? value.persistMemory
      : 'propose',
    shellMode: value?.shellMode === 'disabled' || value?.shellMode === 'manual' || value?.shellMode === 'unrestricted_local'
      ? value.shellMode
      : 'allowlisted',
  };
}

function normalizeProofContract(value: Partial<AutonomousRunProofContract> | undefined): AutonomousRunProofContract {
  return {
    doneCriteria: normalizeStringList(value?.doneCriteria, MAX_LIST_ITEMS, 256),
    requiredEvidence: normalizeStringList(value?.requiredEvidence, MAX_LIST_ITEMS, 128),
    antiProof: normalizeStringList(value?.antiProof, MAX_LIST_ITEMS, 256)
      .concat(DEFAULT_AUTONOMOUS_PROOF_CONTRACT.antiProof)
      .filter((item, index, array) => array.indexOf(item) === index)
      .slice(0, MAX_LIST_ITEMS),
  };
}

function normalizeCheckpoint(value: Partial<AutonomousRunCheckpoint> | undefined): AutonomousRunCheckpoint {
  return {
    providerConversationId: normalizeId(value?.providerConversationId),
    parentMessageId: normalizeId(value?.parentMessageId),
    latestStepId: normalizeId(value?.latestStepId),
    resumableSummary: normalizeText(value?.resumableSummary, MAX_TEXT_LENGTH) ?? '',
    unresolvedQuestions: normalizeStringList(value?.unresolvedQuestions, MAX_LIST_ITEMS, 256),
  };
}

function normalizeError(value: AutonomousRunError | null | undefined): AutonomousRunError | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const code = normalizeId(value.code);
  const at = normalizeTimestamp(value.at);
  if (!code || at === null) return null;
  return {
    code,
    message: normalizeText(value.message, 512) ?? 'Autonomous run error.',
    phase: isPhase(value.phase) || value.phase === 'storage' || value.phase === 'policy' ? value.phase : 'unknown',
    retryable: value.retryable === true,
    at,
    details: normalizeDetails(value.details),
  };
}

function normalizeDetails(value: unknown): Record<string, unknown> | undefined {
  const bounded = normalizeDetailValue(value, 0);
  if (!bounded || typeof bounded !== 'object' || Array.isArray(bounded)) return undefined;
  const details = bounded as Record<string, unknown>;
  if (JSON.stringify(details).length <= MAX_DETAILS_JSON_LENGTH) return details;
  return {
    truncated: true,
    keys: Object.keys(details).slice(0, MAX_DETAILS_KEYS),
  };
}

function normalizeDetailValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return normalizeText(value, MAX_DETAILS_STRING_LENGTH) ?? '';
  if (!value || typeof value !== 'object') return undefined;
  if (depth >= MAX_DETAILS_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_DETAILS_ARRAY_ITEMS)
      .map((item) => normalizeDetailValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  const output: Record<string, unknown> = {};
  let count = 0;
  for (const [rawKey, item] of Object.entries(value)) {
    if (count >= MAX_DETAILS_KEYS) {
      output.truncated = true;
      break;
    }
    const key = normalizeDetailKey(rawKey, count);
    const normalized = normalizeDetailValue(redactDetailValueByKey(rawKey, item), depth + 1);
    if (normalized !== undefined) {
      output[key] = normalized;
      count += 1;
    }
  }
  return output;
}

function normalizeDetailKey(key: string, index: number): string {
  const lower = key.toLowerCase();
  if (GENERIC_URL_PATTERN.test(key)) {
    GENERIC_URL_PATTERN.lastIndex = 0;
    return `redactedPage${index}`;
  }
  GENERIC_URL_PATTERN.lastIndex = 0;
  if (isDetailSecretKey(lower)) return `redactedCred${index}`;
  if (isDetailMediaKey(lower)) return `redactedMedia${index}`;
  if (isDetailVisionKey(lower)) return `redactedVisionRef${index}`;
  if (lower === 'url' || lower === 'title') return `redactedPage${index}`;
  return normalizeId(key) ?? `key_${index}`;
}

function redactDetailValueByKey(key: string, value: unknown): unknown {
  const lower = key.toLowerCase();
  if (isDetailSecretKey(lower)) return value === undefined || value === null || value === '' ? value : '[redacted:secret]';
  if (isDetailMediaKey(lower)) return value === undefined || value === null || value === '' ? value : '[redacted:media]';
  if (isDetailVisionKey(lower)) return '[redacted:vision-ref]';
  if ((lower === 'url' || lower === 'title') && typeof value === 'string' && value) return '[redacted:url]';
  return value;
}

function isDetailSecretKey(lower: string): boolean {
  return lower.includes('authorization') ||
    lower.includes('cookie') ||
    lower.includes('api-key') ||
    lower.includes('api_key') ||
    lower.includes('apikey') ||
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('signed');
}

function isDetailMediaKey(lower: string): boolean {
  return lower.includes('base64') ||
    lower.includes('dataurl') ||
    lower.includes('imageurl') ||
    lower === 'image_url';
}

function isDetailVisionKey(lower: string): boolean {
  return lower.includes('reffile') || lower.includes('vision');
}

function normalizeStatus(value: unknown): AutonomousRun['status'] {
  if (
    value === 'queued' ||
    value === 'running' ||
    value === 'paused' ||
    value === 'blocked' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'cancelled'
  ) return value;
  return 'queued';
}

function normalizeTargetLeaseStatus(value: unknown): AutonomousTargetLease['status'] {
  if (value === 'released' || value === 'expired' || value === 'stale') return value;
  return 'active';
}

function normalizeEvidenceFreshness(value: unknown): AutonomousEvidenceRecord['freshness'] {
  if (value === 'expired') return 'expired';
  if (value === 'stale') return 'stale';
  return 'fresh';
}

function normalizeEvidenceSource(value: unknown): AutonomousEvidenceRecord['source'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Partial<AutonomousEvidenceRecord['source']>;
  return {
    ...(typeof source.tabId === 'number' && Number.isInteger(source.tabId) ? { tabId: source.tabId } : {}),
    ...(typeof source.windowId === 'number' && Number.isInteger(source.windowId) ? { windowId: source.windowId } : {}),
    ...(typeof source.toolName === 'string' ? { toolName: normalizeText(source.toolName, 80) ?? '' } : {}),
    ...(typeof source.automationId === 'string' ? { automationId: normalizeId(source.automationId) ?? '' } : {}),
    ...(typeof source.automationRunId === 'string' ? { automationRunId: normalizeId(source.automationRunId) ?? '' } : {}),
  };
}

function isPhase(value: unknown): value is AutonomousRunStep['phase'] {
  return value === 'plan' ||
    value === 'model_turn' ||
    value === 'tool_selection' ||
    value === 'tool_execution' ||
    value === 'observation' ||
    value === 'verification' ||
    value === 'review' ||
    value === 'checkpoint' ||
    value === 'finish';
}

function isStepStatus(value: unknown): value is AutonomousRunStep['status'] {
  return value === 'running' || value === 'succeeded' || value === 'failed' || value === 'skipped';
}

function isObservationKind(value: unknown): value is AutonomousEvidenceRecord['kind'] {
  return value === 'tool_result' ||
    value === 'browser_snapshot' ||
    value === 'browser_screenshot' ||
    value === 'file' ||
    value === 'shell_output' ||
    value === 'web' ||
    value === 'memory' ||
    value === 'model_text';
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const redacted = redactDurableToolString(value.trim()) ?? '';
  const normalized = redacted.replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 128);
  return normalized || null;
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const redacted = redactRunStoreText(value.trim())?.slice(0, maxLength) ?? '';
  return redacted || null;
}

function redactRunStoreText(value: string): string | undefined {
  return redactDurableToolString(value)?.replace(GENERIC_URL_PATTERN, '[redacted:url]');
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    const normalized = normalizeText(item, maxLength);
    if (normalized && !output.includes(normalized)) output.push(normalized);
    if (output.length >= maxItems) break;
  }
  return output;
}

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const origin = new URL(value.trim()).origin;
    return origin.length <= 240 ? origin : null;
  } catch {
    return null;
  }
}

function normalizeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function normalizeLeaseTtlMs(value: unknown): number {
  const ttl = normalizePositiveInteger(value);
  if (ttl === null) return DEFAULT_AUTONOMOUS_TARGET_LEASE_TTL_MS;
  return Math.min(60 * 60 * 1000, Math.max(10_000, ttl));
}

function normalizeEvidenceTtlMs(value: unknown): number {
  const ttl = normalizePositiveInteger(value);
  if (ttl === null) return DEFAULT_AUTONOMOUS_EVIDENCE_TTL_MS;
  return Math.min(10 * 60 * 1000, Math.max(5_000, ttl));
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function clampProgressScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function pruneRuns(runs: AutonomousRun[]): AutonomousRun[] {
  return [...runs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_RUNS);
}

function pruneSteps(steps: AutonomousRunStep[]): AutonomousRunStep[] {
  return [...steps]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_STEPS);
}

function pruneTargetLeases(leases: AutonomousTargetLease[]): AutonomousTargetLease[] {
  return [...leases]
    .sort((a, b) => b.acquiredAt - a.acquiredAt)
    .slice(0, MAX_TARGET_LEASES);
}

function pruneEvidenceRecords(records: AutonomousEvidenceRecord[]): AutonomousEvidenceRecord[] {
  return [...records]
    .sort((a, b) => b.capturedAt - a.capturedAt)
    .slice(0, MAX_EVIDENCE_RECORDS);
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
