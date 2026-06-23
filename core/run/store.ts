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
  AutonomousQualityGateCommitSummary,
  AutonomousQualityGateContractCoverageKind,
  AutonomousQualityGateContractCoverageRowSummary,
  AutonomousQualityGateContractCoverageStatus,
  AutonomousQualityGateCreateInput,
  AutonomousQualityGateFalsePositiveProbeSummary,
  AutonomousQualityGateGrade,
  AutonomousQualityGateIndependentReviewSummary,
  AutonomousQualityGateRecord,
  AutonomousQualityGateVerificationCommandSummary,
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
  AutonomousReviewLaneCreateInput,
  AutonomousReviewLaneRecord,
  AutonomousReviewLaneRecordRole,
  AutonomousReviewLaneRecommendation,
  AutonomousReviewLaneStatus,
  AutonomousTargetLease,
  AutonomousTargetLeaseCreateInput,
} from './types';

export const AUTONOMOUS_RUN_STORAGE_KEY = 'deepseek_pp_autonomous_runs_v1';

const STORAGE_VERSION = 1;
const MAX_RUNS = 100;
const MAX_STEPS = 1_000;
const MAX_TARGET_LEASES = 200;
const MAX_EVIDENCE_RECORDS = 500;
const MAX_QUALITY_GATE_RECORDS = 300;
const MAX_REVIEW_LANE_RECORDS = 500;
const MAX_QUALITY_GATE_COMMANDS = 16;
const MAX_QUALITY_GATE_COVERAGE_ROWS = 64;
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
  qualityGates: [],
  reviewLanes: [],
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
      qualityGates: state.qualityGates.filter((record) => record.runId !== run.id),
      reviewLanes: state.reviewLanes.filter((record) => record.runId !== run.id),
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

export async function appendAutonomousQualityGateRecord(
  runId: AutonomousRunId,
  input: AutonomousQualityGateCreateInput,
  now = Date.now(),
): Promise<AutonomousQualityGateRecord | null> {
  return mutateAutonomousRunState((state) => {
    const run = state.runs.find((item) => item.id === runId);
    if (!run || isTerminalRunStatus(run.status)) return { state, result: null, write: false };
    const gate = normalizeQualityGateRecord({
      id: createId('gate'),
      runId,
      seq: nextQualityGateSeq(state.qualityGates, runId),
      createdAt: now,
      status: input.status,
      contractCoverage: input.contractCoverage,
      falsePositiveProbe: input.falsePositiveProbe,
      resultStateConsistency: input.resultStateConsistency,
      selfReview: input.selfReview,
      verification: input.verification,
      commit: input.commit ?? null,
      independentReview: input.independentReview,
    });
    if (!gate) return { state, result: null, write: false };
    return {
      state: {
        ...state,
        runs: pruneRuns(state.runs.map((item) => item.id === runId ? { ...item, updatedAt: now } : item)),
        qualityGates: pruneQualityGateRecords([gate, ...state.qualityGates.filter((stored) => stored.id !== gate.id)]),
      },
      result: gate,
    };
  });
}

export async function getAutonomousRunQualityGates(runId: AutonomousRunId): Promise<AutonomousQualityGateRecord[]> {
  const state = await readAutonomousRunState();
  return state.qualityGates
    .filter((record) => record.runId === runId)
    .sort((a, b) => a.seq - b.seq);
}

export async function appendAutonomousReviewLaneRecord(
  runId: AutonomousRunId,
  input: AutonomousReviewLaneCreateInput,
  now = Date.now(),
): Promise<AutonomousReviewLaneRecord | null> {
  return mutateAutonomousRunState((state) => {
    const run = state.runs.find((item) => item.id === runId);
    if (!run || isTerminalRunStatus(run.status)) return { state, result: null, write: false };
    const record = normalizeReviewLaneRecord({
      id: createId('lane'),
      runId,
      seq: nextReviewLaneSeq(state.reviewLanes, runId),
      createdAt: now,
      role: input.role,
      status: input.status,
      grade: input.grade,
      recommendation: input.recommendation,
      highestPriority: input.highestPriority,
      issueCount: input.issueCount,
      evidenceRefCount: input.evidenceRefCount,
      summary: input.summary,
    });
    if (!record) return { state, result: null, write: false };
    const reviewLanes = pruneReviewLaneRecords([record, ...state.reviewLanes.filter((stored) => stored.id !== record.id)]);
    if (!reviewLanes.some((stored) => stored.id === record.id)) {
      return { state, result: null, write: false };
    }
    return {
      state: {
        ...state,
        runs: pruneRuns(state.runs.map((item) => item.id === runId ? { ...item, updatedAt: now } : item)),
        reviewLanes,
      },
      result: record,
    };
  });
}

export async function getAutonomousRunReviewLanes(runId: AutonomousRunId): Promise<AutonomousReviewLaneRecord[]> {
  const state = await readAutonomousRunState();
  return state.reviewLanes
    .filter((record) => record.runId === runId)
    .sort((a, b) => a.seq - b.seq);
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
      const leaseError = createTargetLeaseReconcileError(run, state.targetLeases, now);
      if (leaseError) {
        count += 1;
        return normalizeRun({
          ...run,
          status: 'blocked',
          error: leaseError,
          updatedAt: now,
        }) ?? run;
      }
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

function createTargetLeaseReconcileError(
  run: AutonomousRun,
  targetLeases: readonly AutonomousTargetLease[],
  now: number,
): AutonomousRunError | null {
  if (!run.targetLeaseId) return null;
  const lease = targetLeases.find((item) => item.id === run.targetLeaseId && item.runId === run.id) ?? null;
  if (!lease) {
    return createReconcileError(
      'autonomous_reconcile_target_lease_missing',
      'Autonomous run target lease was missing during startup reconciliation.',
      now,
      null,
    );
  }
  if (lease.status !== 'active') {
    return createReconcileError(
      'autonomous_reconcile_target_lease_inactive',
      'Autonomous run target lease was inactive during startup reconciliation.',
      now,
      lease,
    );
  }
  if (lease.expiresAt <= now) {
    return createReconcileError(
      'autonomous_reconcile_target_lease_expired',
      'Autonomous run target lease expired before startup reconciliation.',
      now,
      lease,
    );
  }
  return null;
}

function createReconcileError(
  code: string,
  message: string,
  now: number,
  lease: AutonomousTargetLease | null,
): AutonomousRunError {
  return {
    code,
    message,
    phase: 'storage',
    retryable: true,
    at: now,
    details: lease
      ? {
        leaseStatus: lease.status,
        targetLeaseAgeMs: Math.max(0, now - lease.acquiredAt),
        targetLeaseExpiresInMs: Math.max(0, lease.expiresAt - now),
      }
      : {},
  };
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
      qualityGates: pruneQualityGateRecords(state.qualityGates),
      reviewLanes: pruneReviewLaneRecords(state.reviewLanes),
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
    qualityGates: Array.isArray(value.qualityGates)
      ? value.qualityGates.map(normalizeQualityGateRecord).filter((item): item is AutonomousQualityGateRecord => item !== null)
      : [],
    reviewLanes: Array.isArray(value.reviewLanes)
      ? value.reviewLanes.map(normalizeReviewLaneRecord).filter((item): item is AutonomousReviewLaneRecord => item !== null)
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

function normalizeQualityGateRecord(raw: unknown): AutonomousQualityGateRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Partial<AutonomousQualityGateRecord>;
  const id = normalizeId(record.id);
  const runId = normalizeId(record.runId);
  const createdAt = normalizeTimestamp(record.createdAt);
  if (!id || !runId || createdAt === null) return null;
  const contractCoverage = normalizeQualityGateContractCoverage(record.contractCoverage);
  const resultStateConsistency = normalizeQualityGateResultStateConsistency(record.resultStateConsistency);
  const falsePositiveProbe = normalizeQualityGateFalsePositiveProbe(record.falsePositiveProbe, resultStateConsistency);
  const selfReview = normalizeQualityGateSelfReview(record.selfReview);
  const verification = normalizeQualityGateVerification(record.verification);
  const commit = normalizeQualityGateCommit(record.commit);
  const independentReview = normalizeQualityGateIndependentReview(record.independentReview);
  return {
    id,
    runId,
    seq: normalizePositiveInteger(record.seq) ?? 1,
    createdAt,
    status: normalizeQualityGateStatus(record.status, {
      contractCoverage,
      falsePositiveProbe,
      resultStateConsistency,
      verification,
      independentReview,
    }),
    contractCoverage,
    falsePositiveProbe,
    resultStateConsistency,
    selfReview,
    verification,
    commit,
    independentReview,
  };
}

function normalizeReviewLaneRecord(raw: unknown): AutonomousReviewLaneRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Partial<AutonomousReviewLaneRecord>;
  const id = normalizeId(record.id);
  const runId = normalizeId(record.runId);
  const createdAt = normalizeTimestamp(record.createdAt);
  if (!id || !runId || createdAt === null) return null;
  const highestPriority = normalizeReviewLanePriority(record.highestPriority);
  const recommendation = normalizeReviewLaneRecommendation(record.recommendation, highestPriority);
  return {
    id,
    runId,
    seq: normalizePositiveInteger(record.seq) ?? 1,
    createdAt,
    role: normalizeReviewLaneRole(record.role),
    status: normalizeReviewLaneStatus(record.status, recommendation, highestPriority),
    grade: normalizeQualityGateGrade(record.grade),
    recommendation,
    highestPriority,
    issueCount: normalizeNonNegativeInteger(record.issueCount) ?? 0,
    evidenceRefCount: normalizeNonNegativeInteger(record.evidenceRefCount) ?? 0,
    summary: normalizeReviewLaneText(record.summary, 256),
  };
}

function normalizeQualityGateContractCoverage(value: unknown): AutonomousQualityGateRecord['contractCoverage'] {
  const summary = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<AutonomousQualityGateRecord['contractCoverage']>
    : {};
  const rows = normalizeQualityGateContractCoverageRows(summary.rows);
  if (rows.length > 0) {
    const coveredCount = rows.filter((row) => row.status === 'covered').length;
    const gapCount = rows.filter((row) => row.status === 'gap').length;
    const conflictCount = rows.filter((row) => row.status === 'conflict').length;
    const notTestableCount = rows.filter((row) => row.status === 'not_testable').length;
    return {
      rows,
      complete: gapCount === 0 && conflictCount === 0,
      coveredCount,
      gapCount,
      conflictCount,
      notTestableCount,
    };
  }
  return {
    rows,
    complete: false,
    coveredCount: normalizeNonNegativeInteger(summary.coveredCount) ?? 0,
    gapCount: normalizeNonNegativeInteger(summary.gapCount) ?? 0,
    conflictCount: normalizeNonNegativeInteger(summary.conflictCount) ?? 0,
    notTestableCount: normalizeNonNegativeInteger(summary.notTestableCount) ?? 0,
  };
}

function normalizeQualityGateContractCoverageRows(value: unknown): AutonomousQualityGateContractCoverageRowSummary[] {
  if (!Array.isArray(value)) return [];
  const rows: AutonomousQualityGateContractCoverageRowSummary[] = [];
  for (const item of value) {
    const row = normalizeQualityGateContractCoverageRow(item);
    if (row) rows.push(row);
    if (rows.length >= MAX_QUALITY_GATE_COVERAGE_ROWS) break;
  }
  return rows;
}

function normalizeQualityGateContractCoverageRow(value: unknown): AutonomousQualityGateContractCoverageRowSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<AutonomousQualityGateContractCoverageRowSummary>;
  const kind = normalizeQualityGateContractCoverageKind(row.kind);
  const requirement = normalizeQualityGateText(row.requirement, 200);
  if (!requirement) return null;
  const matchedBy = normalizeQualityGateCoverageMatchedBy(row.matchedBy);
  let status = normalizeQualityGateContractCoverageStatus(row.status);
  if ((kind === 'done_criterion' || kind === 'required_evidence') && status === 'covered' && matchedBy.length === 0) {
    status = 'gap';
  }
  return {
    kind,
    requirement,
    status,
    matchedBy,
  };
}

function normalizeQualityGateContractCoverageKind(value: unknown): AutonomousQualityGateContractCoverageKind {
  if (value === 'required_evidence' || value === 'anti_proof') return value;
  return 'done_criterion';
}

function normalizeQualityGateContractCoverageStatus(value: unknown): AutonomousQualityGateContractCoverageStatus {
  if (value === 'covered' || value === 'conflict' || value === 'not_testable') return value;
  return 'gap';
}

function normalizeQualityGateCoverageMatchedBy(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    const normalized = normalizeQualityGateText(item, 120);
    if (normalized && !output.includes(normalized)) output.push(normalized);
    if (output.length >= MAX_LIST_ITEMS) break;
  }
  return output;
}

function normalizeQualityGateResultStateConsistency(value: unknown): AutonomousQualityGateRecord['resultStateConsistency'] {
  const summary = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<AutonomousQualityGateRecord['resultStateConsistency']>
    : {};
  return {
    status: normalizeQualityGateConsistencyStatus(summary.status),
    ok: summary.ok === true,
    issueCount: normalizeNonNegativeInteger(summary.issueCount) ?? 0,
    blockingIssueCount: normalizeNonNegativeInteger(summary.blockingIssueCount) ?? 0,
  };
}

function normalizeQualityGateFalsePositiveProbe(
  value: unknown,
  consistency: AutonomousQualityGateRecord['resultStateConsistency'],
): AutonomousQualityGateFalsePositiveProbeSummary {
  const summary = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<AutonomousQualityGateFalsePositiveProbeSummary>
    : {};
  const derivedStatus = consistency.status === 'consistent'
    ? 'passed'
    : consistency.status === 'inconsistent'
      ? 'failed'
      : 'not_run';
  const status = normalizeQualityGateFalsePositiveProbeStatus(summary.status, derivedStatus);
  return {
    status,
    issueCount: normalizeNonNegativeInteger(summary.issueCount) ?? consistency.issueCount,
    blockingIssueCount: normalizeNonNegativeInteger(summary.blockingIssueCount) ?? consistency.blockingIssueCount,
  };
}

function normalizeQualityGateSelfReview(value: unknown): AutonomousQualityGateRecord['selfReview'] {
  const summary = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<AutonomousQualityGateRecord['selfReview']>
    : {};
  return { grade: normalizeQualityGateGrade(summary.grade) };
}

function normalizeQualityGateVerification(value: unknown): AutonomousQualityGateRecord['verification'] {
  const summary = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<AutonomousQualityGateRecord['verification']>
    : {};
  return {
    commands: Array.isArray(summary.commands)
      ? summary.commands.map(normalizeQualityGateVerificationCommand)
        .filter((item): item is AutonomousQualityGateVerificationCommandSummary => item !== null)
        .slice(0, MAX_QUALITY_GATE_COMMANDS)
      : [],
  };
}

function normalizeQualityGateVerificationCommand(value: unknown): AutonomousQualityGateVerificationCommandSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const command = value as Partial<AutonomousQualityGateVerificationCommandSummary>;
  return {
    name: normalizeQualityGateText(command.name, 120) ?? 'unnamed verification',
    result: normalizeQualityGateVerificationResult(command.result),
    summary: normalizeQualityGateText(command.summary, 256) ?? '',
  };
}

function normalizeQualityGateCommit(value: unknown): AutonomousQualityGateCommitSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const commit = value as Partial<AutonomousQualityGateCommitSummary>;
  const hash = typeof commit.hash === 'string' && /^[a-f0-9]{7,40}$/i.test(commit.hash.trim())
    ? commit.hash.trim().slice(0, 40)
    : null;
  return {
    hash,
    message: normalizeQualityGateText(commit.message, 160),
  };
}

function normalizeQualityGateIndependentReview(value: unknown): AutonomousQualityGateIndependentReviewSummary {
  const summary = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<AutonomousQualityGateIndependentReviewSummary>
    : {};
  return {
    status: normalizeQualityGateIndependentReviewStatus(summary.status),
    grade: normalizeQualityGateGrade(summary.grade),
    blockingIssueCount: normalizeNonNegativeInteger(summary.blockingIssueCount) ?? 0,
  };
}

function nextQualityGateSeq(records: readonly AutonomousQualityGateRecord[], runId: AutonomousRunId): number {
  return records
    .filter((record) => record.runId === runId)
    .reduce((max, record) => Math.max(max, record.seq), 0) + 1;
}

function nextReviewLaneSeq(records: readonly AutonomousReviewLaneRecord[], runId: AutonomousRunId): number {
  return records
    .filter((record) => record.runId === runId)
    .reduce((max, record) => Math.max(max, record.seq), 0) + 1;
}

function normalizeQualityGateStatus(
  value: unknown,
  summary: Pick<AutonomousQualityGateRecord, 'contractCoverage' | 'falsePositiveProbe' | 'resultStateConsistency' | 'verification' | 'independentReview'>,
): AutonomousQualityGateRecord['status'] {
  if (summary.independentReview.status === 'blocked' || summary.independentReview.blockingIssueCount > 0) return 'blocked';
  if (
    summary.contractCoverage.rows.length === 0 ||
    summary.contractCoverage.conflictCount > 0 ||
    summary.falsePositiveProbe.status === 'failed' ||
    summary.falsePositiveProbe.blockingIssueCount > 0 ||
    summary.resultStateConsistency.status === 'inconsistent' ||
    summary.resultStateConsistency.blockingIssueCount > 0 ||
    summary.verification.commands.some((command) => command.result === 'failed') ||
    summary.independentReview.status === 'failed'
  ) {
    return 'failed';
  }
  if (!summary.contractCoverage.complete || summary.contractCoverage.gapCount > 0 || summary.resultStateConsistency.ok === false) {
    return value === 'blocked' ? 'blocked' : 'warning';
  }
  if (value === 'failed' || value === 'blocked' || value === 'warning') return value;
  return value === 'passed' ? 'passed' : 'failed';
}

function normalizeQualityGateConsistencyStatus(value: unknown): AutonomousQualityGateRecord['resultStateConsistency']['status'] {
  if (value === 'consistent' || value === 'not_applicable') return value;
  return 'inconsistent';
}

function normalizeQualityGateFalsePositiveProbeStatus(
  value: unknown,
  derivedStatus: AutonomousQualityGateFalsePositiveProbeSummary['status'],
): AutonomousQualityGateFalsePositiveProbeSummary['status'] {
  if (value === 'passed' || value === 'failed' || value === 'not_run') return value;
  return derivedStatus;
}

function normalizeQualityGateVerificationResult(value: unknown): AutonomousQualityGateVerificationCommandSummary['result'] {
  if (value === 'failed' || value === 'known_preexisting_failure') return value;
  return value === 'passed' ? 'passed' : 'failed';
}

function normalizeQualityGateIndependentReviewStatus(value: unknown): AutonomousQualityGateIndependentReviewSummary['status'] {
  if (value === 'passed' || value === 'failed' || value === 'blocked') return value;
  return 'not_run';
}

function normalizeQualityGateGrade(value: unknown): AutonomousQualityGateGrade | null {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D' || value === 'F' ? value : null;
}

function normalizeReviewLaneRole(value: unknown): AutonomousReviewLaneRecordRole {
  return value === 'implementer' ||
    value === 'reviewer' ||
    value === 'safety' ||
    value === 'ux' ||
    value === 'oracle' ||
    value === 'grok'
    ? value
    : 'other';
}

function normalizeReviewLaneStatus(
  value: unknown,
  recommendation: AutonomousReviewLaneRecommendation,
  highestPriority: AutonomousReviewLaneRecord['highestPriority'],
): AutonomousReviewLaneStatus {
  if (highestPriority === 'P1' || highestPriority === 'P2' || recommendation === 'block') return 'blocked';
  if (value === 'idle' || value === 'running' || value === 'passed' || value === 'blocked' || value === 'failed') return value;
  return 'failed';
}

function normalizeReviewLaneRecommendation(
  value: unknown,
  highestPriority: AutonomousReviewLaneRecord['highestPriority'],
): AutonomousReviewLaneRecommendation {
  if (highestPriority === 'P1' || highestPriority === 'P2') return 'block';
  return value === 'proceed' || value === 'iterate' || value === 'block' ? value : 'unknown';
}

function normalizeReviewLanePriority(value: unknown): AutonomousReviewLaneRecord['highestPriority'] {
  return value === 'P1' || value === 'P2' || value === 'P3' ? value : null;
}

function normalizeReviewLaneText(value: unknown, maxLength: number): string | null {
  const text = normalizeQualityGateText(value, maxLength);
  if (!text) return null;
  return text.replace(/\b(?:prompt|session|transcript|rawOutput|rawReviewerProse)\b/gi, '[redacted:raw]');
}

function normalizeQualityGateText(value: unknown, maxLength: number): string | null {
  const text = normalizeQualityGateRawText(value, maxLength);
  if (!text) return null;
  return redactQualityGateDurableIds(
    redactQualityGateOpaqueTokens(
      redactQualityGateCommonSecrets(
        redactQualityGateLooseSecrets(text),
      ),
    ),
  )
    .replace(/\b(?:rawOutput|rawTranscript|transcriptText|reviewProse)\b/gi, '[redacted:raw]');
}

function normalizeQualityGateRawText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const redacted = redactRunStoreText(
    redactQualityGateDurableIds(
      redactQualityGateOpaqueTokens(
        redactQualityGateCommonSecrets(
          redactQualityGateLooseSecrets(value.trim()),
        ),
      ),
    ),
  ) ?? '';
  const truncated = truncateQualityGateText(redacted, maxLength);
  return truncated || null;
}

function truncateQualityGateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const truncated = value.slice(0, maxLength);
  const lastBracket = truncated.lastIndexOf('[');
  if (lastBracket >= 0) {
    const suffix = truncated.slice(lastBracket);
    const sourceSuffix = value.slice(lastBracket);
    for (const marker of QUALITY_GATE_REDACTION_MARKERS) {
      if (marker.startsWith(suffix) && sourceSuffix.startsWith(marker)) {
        return `${truncated.slice(0, lastBracket)}${marker}`;
      }
    }
  }
  return truncated;
}

const QUALITY_GATE_REDACTION_MARKERS = [
  '[redacted:secret]',
  '[redacted:id]',
  '[redacted:url]',
  '[redacted:raw]',
  '[redacted:media]',
  '[redacted:vision-ref]',
] as const;

function redactQualityGateLooseSecrets(value: string): string {
  return value.replace(/\b[A-Z0-9_]*SECRET[A-Z0-9_]*\b/gi, (match, offset: number, full: string) => {
    return full.slice(Math.max(0, offset - '[redacted:'.length), offset) === '[redacted:'
      ? match
      : '[redacted:secret]';
  });
}

function redactQualityGateOpaqueTokens(value: string): string {
  return value.replace(/\b(?=[A-Za-z0-9_-]{16,}\b)(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g, '[redacted:secret]');
}

function redactQualityGateCommonSecrets(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted:secret]')
    .replace(/\b(?:Authorization|Cookie|Set-Cookie)\s*[:=]\s*[^\n]+/gi, '[redacted:secret]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, '[redacted:secret]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}/g, '[redacted:secret]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted:secret]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[redacted:secret]')
    .replace(/[?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|AWSAccessKeyId|Signature|access_token|refresh_token|token|secret)=[^&\s]+/gi, '[redacted:secret]')
    .replace(/\b(?:x[-_])?(?:api[_-]?key|apiKey|token|secret|signed[_-]?path|signedPath)\s*:\s*[^\s,;]+/gi, '[redacted:secret]')
    .replace(/\b(?:api[_-]?key|apiKey|token|secret|signed[_-]?path|signedPath)=[^&\s]+/gi, '[redacted:secret]');
}

function redactQualityGateDurableIds(value: string): string {
  return value.replace(
    /\b(?:run|step|evidence|target-lease|lease|gate|ev|model-turn|modelTurn|tool-call|toolCall|observation|observation-ref|observationRef|obs)-(?=[A-Za-z0-9_.:-]{8,}\b)(?=[A-Za-z0-9_.:-]*\d)[A-Za-z0-9_.:-]+\b/g,
    '[redacted:id]',
  );
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

function pruneQualityGateRecords(records: AutonomousQualityGateRecord[]): AutonomousQualityGateRecord[] {
  return [...records]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_QUALITY_GATE_RECORDS);
}

function pruneReviewLaneRecords(records: AutonomousReviewLaneRecord[]): AutonomousReviewLaneRecord[] {
  return [...records]
    .sort((a, b) => (b.createdAt - a.createdAt) || (b.seq - a.seq) || a.id.localeCompare(b.id))
    .slice(0, MAX_REVIEW_LANE_RECORDS);
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
