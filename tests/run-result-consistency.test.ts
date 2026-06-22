import { describe, expect, it } from 'vitest';
import {
  reviewAutonomousOrchestratorResultStateConsistency,
  reviewAutonomousWorkerResultStateConsistency,
} from '../core/run/result-consistency';
import type { AutonomousRunOrchestratorCycleResult } from '../core/run/orchestrator';
import type { AutonomousRunCycleResult } from '../core/run/worker';
import type {
  AutonomousRun,
  AutonomousRunStatus,
  AutonomousRunStorageState,
} from '../core/run/types';

describe('autonomous result-state consistency', () => {
  it('accepts a missing-run noop as consistent with absent durable state', () => {
    const review = reviewAutonomousWorkerResultStateConsistency({
      result: createWorkerResult({
        action: 'noop',
        runId: 'missing-run',
        finalStatus: null,
      }),
      state: createState([]),
    });

    expect(review).toMatchObject({
      ok: true,
      scope: 'worker',
      status: 'consistent',
      issueCodes: [],
      checked: {
        resultPresent: true,
        durableRunPresent: false,
      },
      resultStatus: null,
      durableStatus: null,
    });
  });

  it('accepts worker block results only when durable state is blocked too', () => {
    const run = createRun({ status: 'blocked' });
    const review = reviewAutonomousWorkerResultStateConsistency({
      result: createWorkerResult({
        action: 'block',
        runId: run.id,
        finalStatus: 'blocked',
        errorCode: 'autonomous_review_lane_gate_blocked',
      }),
      state: createState([run]),
    });

    expect(review).toMatchObject({
      ok: true,
      status: 'consistent',
      issueCodes: [],
      resultStatus: 'blocked',
      durableStatus: 'blocked',
    });
  });

  it('adversarial probe: rejects false-positive success when durable state is still running', () => {
    const run = createRun({ status: 'running' });
    const review = reviewAutonomousWorkerResultStateConsistency({
      result: createWorkerResult({
        action: 'advance',
        runId: run.id,
        iterationAction: 'succeed',
        finalStatus: 'succeeded',
        reviewSummary: {
          action: 'succeed',
          completionDecision: 'pass',
          grade: 'A',
          score: 1,
          issueCount: 0,
          proofDebtCount: 0,
          acceptedEvidenceCount: 1,
          progressReason: null,
          errorCode: null,
        },
      }),
      state: createState([run]),
    });

    expect(review.ok).toBe(false);
    expect(review.status).toBe('inconsistent');
    expect(review.issueCodes).toEqual([
      'final_status_mismatch',
      'claimed_success_without_durable_success',
      'completion_pass_without_durable_success',
      'iteration_succeed_without_durable_success',
    ]);
    expect(review.issues.every((issue) => issue.severity === 'P1')).toBe(true);
    expect(review.resultStatus).toBe('succeeded');
    expect(review.durableStatus).toBe('running');
  });

  it('rejects block actions whose result status is not blocked', () => {
    const run = createRun({ status: 'running' });
    const review = reviewAutonomousWorkerResultStateConsistency({
      result: createWorkerResult({
        action: 'block',
        runId: run.id,
        finalStatus: 'running',
      }),
      state: createState([run]),
    });

    expect(review.ok).toBe(false);
    expect(review.issueCodes).toEqual(['block_action_without_blocked_status']);
    expect(review.issues[0]).toMatchObject({
      expectedStatus: 'blocked',
      actualStatus: 'running',
    });
  });

  it('does not require executor fail actions to produce durable failed status', () => {
    const run = createRun({ status: 'blocked' });
    const review = reviewAutonomousWorkerResultStateConsistency({
      result: createWorkerResult({
        action: 'fail',
        runId: run.id,
        finalStatus: 'blocked',
        errorCode: 'executor_error',
      }),
      state: createState([run]),
    });

    expect(review).toMatchObject({
      ok: true,
      status: 'consistent',
      issueCodes: [],
      resultStatus: 'blocked',
      durableStatus: 'blocked',
    });
  });

  it('rejects non-noop results when the durable run is missing', () => {
    const review = reviewAutonomousWorkerResultStateConsistency({
      result: createWorkerResult({
        action: 'advance',
        runId: 'missing-run',
        finalStatus: 'running',
      }),
      state: createState([]),
    });

    expect(review.ok).toBe(false);
    expect(review.issueCodes).toEqual(['durable_run_missing']);
    expect(review.durableStatus).toBeNull();
  });

  it('rejects malformed missing-run noop results that claim success', () => {
    const review = reviewAutonomousWorkerResultStateConsistency({
      result: createWorkerResult({
        action: 'noop',
        runId: 'missing-run',
        iterationAction: 'succeed',
        finalStatus: null,
        reviewSummary: {
          action: 'succeed',
          completionDecision: 'pass',
          grade: 'A',
          score: 1,
          issueCount: 0,
          proofDebtCount: 0,
          acceptedEvidenceCount: 1,
          progressReason: null,
          errorCode: null,
        },
      }),
      state: createState([]),
    });

    expect(review.ok).toBe(false);
    expect(review.issueCodes).toEqual([
      'durable_run_missing',
      'completion_pass_without_durable_success',
      'iteration_succeed_without_durable_success',
    ]);
    expect(review.durableStatus).toBeNull();
    expect(review.resultStatus).toBeNull();
  });

  it('keeps consistency reports free of raw run IDs and secret-bearing values', () => {
    const secretRunId = 'run-secret-sk-live-abc123';
    const review = reviewAutonomousWorkerResultStateConsistency({
      result: createWorkerResult({
        action: 'advance',
        runId: secretRunId,
        finalStatus: 'succeeded',
      }),
      state: createState([
        createRun({
          id: secretRunId,
          goal: 'Use Authorization: Bearer secret-token',
          status: 'running',
        }),
      ]),
    });

    const json = JSON.stringify(review);
    expect(json).not.toContain(secretRunId);
    expect(json).not.toContain('secret-token');
    expect(json).not.toContain('Authorization');
    expect(json).not.toContain('Bearer');
  });

  it('accepts orchestrator cycles with no selected run and no worker result as not applicable', () => {
    const review = reviewAutonomousOrchestratorResultStateConsistency({
      result: createOrchestratorResult({
        selectedRunId: null,
        workerResult: null,
      }),
      state: createState([]),
    });

    expect(review).toMatchObject({
      ok: true,
      scope: 'orchestrator',
      status: 'not_applicable',
      issueCodes: [],
      checked: {
        resultPresent: true,
        durableRunPresent: false,
        workerResultPresent: false,
        selectedRunPresent: false,
        afterSnapshotChecked: false,
      },
    });
  });

  it('still checks malformed no-selected orchestrator worker results against durable state', () => {
    const run = createRun({ id: 'worker-run', status: 'running' });
    const review = reviewAutonomousOrchestratorResultStateConsistency({
      result: createOrchestratorResult({
        selectedRunId: null,
        workerResult: createWorkerResult({
          action: 'advance',
          runId: run.id,
          iterationAction: 'succeed',
          finalStatus: 'succeeded',
          reviewSummary: {
            action: 'succeed',
            completionDecision: 'pass',
            grade: 'A',
            score: 1,
            issueCount: 0,
            proofDebtCount: 0,
            acceptedEvidenceCount: 1,
            progressReason: null,
            errorCode: null,
          },
        }),
      }),
      state: createState([run]),
    });

    expect(review.ok).toBe(false);
    expect(review.issueCodes).toEqual([
      'worker_result_present_without_selected_run',
      'final_status_mismatch',
      'claimed_success_without_durable_success',
      'completion_pass_without_durable_success',
      'iteration_succeed_without_durable_success',
    ]);
    expect(review.durableStatus).toBe('running');
    expect(review.resultStatus).toBe('succeeded');
    expect(review.checked).toMatchObject({
      durableRunPresent: true,
      workerResultPresent: true,
      selectedRunPresent: false,
    });
  });

  it('rejects orchestrator selected-run and worker-result mismatches', () => {
    const selected = createRun({ id: 'selected-run', status: 'running' });
    const review = reviewAutonomousOrchestratorResultStateConsistency({
      result: createOrchestratorResult({
        selectedRunId: selected.id,
        workerResult: createWorkerResult({
          runId: 'different-run',
          finalStatus: 'running',
        }),
      }),
      state: createState([selected, createRun({ id: 'different-run', status: 'running' })]),
    });

    expect(review.ok).toBe(false);
    expect(review.issueCodes).toEqual(['selected_worker_run_mismatch']);
    expect(JSON.stringify(review)).not.toContain('selected-run');
    expect(JSON.stringify(review)).not.toContain('different-run');
  });

  it('rejects orchestrator cycles that select a run but omit worker result', () => {
    const selected = createRun({ id: 'selected-run', status: 'running' });
    const review = reviewAutonomousOrchestratorResultStateConsistency({
      result: createOrchestratorResult({
        selectedRunId: selected.id,
        workerResult: null,
      }),
      state: createState([selected]),
    });

    expect(review.ok).toBe(false);
    expect(review.issueCodes).toEqual(['worker_result_missing_for_selected_run']);
  });

  it('does not require after-snapshot active run to be the selected run', () => {
    const selected = createRun({ id: 'selected-run', status: 'blocked' });
    const review = reviewAutonomousOrchestratorResultStateConsistency({
      result: createOrchestratorResult({
        selectedRunId: selected.id,
        workerResult: createWorkerResult({
          action: 'block',
          runId: selected.id,
          finalStatus: 'blocked',
        }),
        afterSnapshot: {
          ...createOrchestratorResult({ selectedRunId: selected.id }).afterSnapshot,
          activeRun: createCockpitRun({
            id: 'other-active-run',
            status: 'running',
          }),
        },
      }),
      state: createState([selected, createRun({ id: 'other-active-run', status: 'running' })]),
    });

    expect(review).toMatchObject({
      ok: true,
      status: 'consistent',
      issueCodes: [],
      checked: {
        afterSnapshotChecked: false,
      },
    });
  });

  it('rejects after-snapshot status disagreement for the selected run', () => {
    const selected = createRun({ id: 'selected-run', status: 'blocked' });
    const review = reviewAutonomousOrchestratorResultStateConsistency({
      result: createOrchestratorResult({
        selectedRunId: selected.id,
        workerResult: createWorkerResult({
          action: 'block',
          runId: selected.id,
          finalStatus: 'blocked',
        }),
        afterSnapshot: {
          ...createOrchestratorResult({ selectedRunId: selected.id }).afterSnapshot,
          activeRun: createCockpitRun({
            id: selected.id,
            status: 'running',
          }),
        },
      }),
      state: createState([selected]),
    });

    expect(review.ok).toBe(false);
    expect(review.issueCodes).toEqual(['after_snapshot_status_mismatch']);
    expect(review.issues[0]).toMatchObject({
      expectedStatus: 'blocked',
      actualStatus: 'running',
      severity: 'P2',
    });
  });
});

function createWorkerResult(overrides: Partial<AutonomousRunCycleResult> = {}): AutonomousRunCycleResult {
  return {
    action: 'advance',
    runId: 'run-1',
    started: false,
    advanced: false,
    applied: false,
    policyDecision: null,
    iterationAction: null,
    reviewSummary: null,
    finalStatus: 'running',
    errorCode: null,
    ...overrides,
  };
}

function createOrchestratorResult(
  overrides: Partial<AutonomousRunOrchestratorCycleResult> = {},
): AutonomousRunOrchestratorCycleResult {
  return {
    selectedRunId: 'run-1',
    reconciledInterruptedRuns: 0,
    beforeSnapshot: createSnapshot(),
    reviewLanePlan: {
      action: 'idle',
      selectedRoles: [],
      canRunWorker: true,
      reason: 'no_pending_lanes',
      blockingPriority: null,
      blockingLaneCount: 0,
      maxParallel: 0,
    },
    workerResult: createWorkerResult(),
    qualityGateDecision: null,
    telemetryResult: null,
    afterSnapshot: createSnapshot(),
    ...overrides,
  };
}

function createState(runs: AutonomousRun[]): Pick<AutonomousRunStorageState, 'runs'> {
  return { runs };
}

function createRun(overrides: Partial<AutonomousRun> = {}): AutonomousRun {
  return {
    id: 'run-1',
    goal: 'Goal',
    mode: 'unattended',
    status: 'running',
    modelAdapter: 'deepseek_web',
    targetLeaseId: null,
    budgets: {
      maxWallMs: 1_000,
      maxModelTurns: 10,
      maxToolCalls: 10,
      maxConsecutiveNoProgress: 3,
      maxSameErrorRepeats: 2,
      maxPromptBytesPerTurn: 10_000,
      maxObservationBytesPerTurn: 10_000,
    },
    policy: {
      approvalMode: 'auto_low_risk',
      allowedTools: [],
      deniedTools: [],
      browserMutationRequiresTargetLock: true,
      persistMemory: 'off',
      shellMode: 'disabled',
    },
    proofContract: {
      doneCriteria: [],
      requiredEvidence: [],
      antiProof: [],
    },
    checkpoint: {
      providerConversationId: null,
      parentMessageId: null,
      latestStepId: null,
      resumableSummary: '',
      unresolvedQuestions: [],
    },
    error: null,
    createdAt: 100,
    startedAt: 110,
    completedAt: null,
    updatedAt: 120,
    ...overrides,
  };
}

function createSnapshot() {
  return {
    schemaVersion: 1 as const,
    generatedAt: 200,
    status: 'running' as const,
    totals: {
      queued: 0,
      running: 1,
      paused: 0,
      blocked: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    },
    activeRun: createCockpitRun(),
  };
}

function createCockpitRun(overrides: { id?: string; status?: AutonomousRunStatus } = {}) {
  return {
    id: 'run-1',
    goal: 'Goal',
    mode: 'unattended' as const,
    status: 'running' as AutonomousRunStatus,
    targetLeaseId: null,
    targetLeaseStatus: 'none' as const,
    targetLeaseAgeMs: null,
    targetLeaseExpiresInMs: null,
    createdAt: 100,
    startedAt: 110,
    updatedAt: 120,
    latestStep: null,
    stepCount: 0,
    evidenceCount: 0,
    freshEvidenceCount: 0,
    staleEvidenceCount: 0,
    expiredEvidenceCount: 0,
    latestEvidenceAt: null,
    targetLeaseCount: 0,
    errorCode: null,
    ...overrides,
  };
}
