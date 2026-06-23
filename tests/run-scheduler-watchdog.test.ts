import { describe, expect, it } from 'vitest';
import { evaluateAutonomousSchedulerWatchdog } from '../core/run/scheduler-watchdog';
import {
  DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
  DEFAULT_AUTONOMOUS_RUN_BUDGETS,
  DEFAULT_AUTONOMOUS_RUN_POLICY,
} from '../core/run/store';
import type {
  AutonomousEvidenceRecord,
  AutonomousRun,
  AutonomousRunBudgets,
  AutonomousRunProofContract,
  AutonomousRunStep,
  AutonomousTargetLease,
} from '../core/run/types';

const NOW = 1_000;

describe('autonomous scheduler watchdog', () => {
  it('returns idle for missing runs and noop decisions for terminal, paused, and blocked runs', () => {
    expect(evaluateAutonomousSchedulerWatchdog({ run: null, now: NOW })).toMatchObject({
      decision: 'idle',
      reason: 'no_runnable_run',
      blocksNextAction: true,
      recommendedStatus: null,
    });
    expect(evaluateAutonomousSchedulerWatchdog({ run: createRun({ status: 'succeeded' }), now: NOW })).toMatchObject({
      decision: 'terminalNoop',
      reason: 'terminal',
      blocksNextAction: true,
      recommendedStatus: null,
    });
    expect(evaluateAutonomousSchedulerWatchdog({ run: createRun({ status: 'paused' }), now: NOW })).toMatchObject({
      decision: 'paused',
      reason: 'paused',
      blocksNextAction: true,
      recommendedStatus: null,
    });
    expect(evaluateAutonomousSchedulerWatchdog({ run: createRun({ status: 'blocked' }), now: NOW })).toMatchObject({
      decision: 'blocked',
      reason: 'already_blocked',
      blocksNextAction: true,
      recommendedStatus: null,
    });
  });

  it('allows runnable state with valid lease and no blocking gates', () => {
    const run = createRun({ targetLeaseId: 'lease-1' });
    const verdict = evaluateAutonomousSchedulerWatchdog({
      run,
      targetLease: createLease(),
      now: NOW,
    });

    expect(verdict).toMatchObject({
      decision: 'canContinue',
      reason: 'ok',
      blocksNextAction: false,
      recommendedStatus: null,
      error: null,
      details: {
        targetLeaseExpiresInMs: 1_000,
      },
    });
  });

  it('blocks on missing, inactive, or expired target leases before dispatch', () => {
    const run = createRun({ targetLeaseId: 'lease-1' });

    expect(evaluateAutonomousSchedulerWatchdog({ run, targetLease: null, now: NOW })).toMatchObject({
      decision: 'mustBlock',
      reason: 'missing_target_lease',
      recommendedStatus: 'blocked',
      error: { code: 'autonomous_watchdog_missing_target_lease', phase: 'policy' },
    });
    expect(evaluateAutonomousSchedulerWatchdog({
      run,
      targetLease: createLease({ status: 'released' }),
      now: NOW,
    })).toMatchObject({
      decision: 'mustBlock',
      reason: 'inactive_target_lease',
      recommendedStatus: 'blocked',
      error: { code: 'autonomous_watchdog_inactive_target_lease' },
    });
    expect(evaluateAutonomousSchedulerWatchdog({
      run,
      targetLease: createLease({ expiresAt: NOW }),
      now: NOW,
    })).toMatchObject({
      decision: 'mustBlock',
      reason: 'expired_target_lease',
      details: { targetLeaseExpiresInMs: 0 },
      error: { code: 'autonomous_watchdog_expired_target_lease' },
    });
  });

  it('blocks stale or expired evidence when required evidence exists but no accepted fresh evidence remains', () => {
    const run = createRun({
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: ['shell_output'],
        antiProof: [],
      },
      targetLeaseId: 'lease-1',
    });
    const lease = createLease();

    expect(evaluateAutonomousSchedulerWatchdog({
      run,
      targetLease: lease,
      evidence: [createEvidence({ freshness: 'stale' })],
      now: NOW,
    })).toMatchObject({
      decision: 'mustBlock',
      reason: 'stale_evidence',
      recommendedStatus: 'blocked',
      details: { staleEvidenceCount: 1 },
      error: { code: 'autonomous_watchdog_stale_evidence', phase: 'verification' },
    });

    expect(evaluateAutonomousSchedulerWatchdog({
      run,
      targetLease: lease,
      evidence: [createEvidence({ expiresAt: NOW })],
      now: NOW,
    })).toMatchObject({
      decision: 'mustBlock',
      reason: 'expired_evidence',
      recommendedStatus: 'blocked',
      details: { expiredEvidenceCount: 1 },
      error: { code: 'autonomous_watchdog_expired_evidence' },
    });

    expect(evaluateAutonomousSchedulerWatchdog({
      run,
      targetLease: lease,
      evidence: [createEvidence()],
      now: NOW,
    })).toMatchObject({ decision: 'canContinue', reason: 'ok' });
  });

  it('blocks repeated no-progress and same-error states before another executor dispatch', () => {
    const noProgressRun = createRun({ budgets: { maxConsecutiveNoProgress: 2 } });
    expect(evaluateAutonomousSchedulerWatchdog({
      run: noProgressRun,
      steps: [
        createStep({ id: 'step-1', seq: 1 }),
        createStep({ id: 'step-2', seq: 2 }),
      ],
      now: NOW,
    })).toMatchObject({
      decision: 'mustBlock',
      reason: 'no_progress_exceeded',
      error: { code: 'run_no_progress' },
    });

    const sameErrorRun = createRun({ budgets: { maxSameErrorRepeats: 2 } });
    expect(evaluateAutonomousSchedulerWatchdog({
      run: sameErrorRun,
      steps: [
        createStep({ id: 'err-1', seq: 1, status: 'failed', errorCode: 'same_error' }),
        createStep({ id: 'err-2', seq: 2, status: 'failed', errorCode: 'same_error' }),
      ],
      now: NOW,
    })).toMatchObject({
      decision: 'mustBlock',
      reason: 'same_error_exceeded',
      error: { code: 'run_repeated_error' },
    });
  });

  it('fails closed on contradictory review-lane gates and persisted quality-gate blockers', () => {
    const run = createRun();
    expect(evaluateAutonomousSchedulerWatchdog({
      run,
      reviewLaneGate: {
        status: 'attention',
        reason: 'p1',
        canProceed: true,
        blockingPriority: null,
        blockingLaneCount: 2,
      },
      now: NOW,
    })).toMatchObject({
      decision: 'mustBlock',
      reason: 'review_lane_gate_blocked',
      recommendedStatus: 'blocked',
      error: { code: 'autonomous_review_lane_gate_blocked' },
      details: {
        reviewLaneReason: 'p1',
        blockingLaneCount: 2,
      },
    });

    expect(evaluateAutonomousSchedulerWatchdog({
      run,
      qualityGateDecision: {
        blocked: true,
        reason: 'contract_conflicts',
        seq: 3,
        conflictCount: 2,
      },
      now: NOW,
    })).toMatchObject({
      decision: 'mustBlock',
      reason: 'quality_gate_blocked',
      details: {
        qualityGateReason: 'contract_conflicts',
        qualityGateSeq: 3,
        qualityGateConflictCount: 2,
      },
    });
  });

  it('keeps watchdog details bounded and free of raw lease, evidence, prompt, URL, or secret text', () => {
    const run = createRun({
      id: 'run-raw-secret-123456',
      goal: 'Prompt includes Bearer secret and https://private.example/token',
      targetLeaseId: 'lease-secret-123456',
      proofContract: {
        doneCriteria: ['done'],
        requiredEvidence: ['shell_output'],
        antiProof: [],
      },
    });
    const verdict = evaluateAutonomousSchedulerWatchdog({
      run,
      targetLease: createLease({
        id: 'lease-secret-123456',
        runId: run.id,
        label: 'Authorization: Bearer abc',
        origin: 'https://private.example',
        title: 'token=secret',
        expiresAt: NOW,
      }),
      evidence: [createEvidence({ id: 'evidence-secret-123456', summary: 'TOPSECRET transcript' })],
      now: NOW,
    });

    const json = JSON.stringify(verdict);
    expect(json).not.toMatch(/Bearer|TOPSECRET|private\.example|token=secret|run-raw-secret|lease-secret|evidence-secret|transcript/);
    expect(json).toContain('expired_target_lease');
  });
});

type RunOverrides = Omit<Partial<AutonomousRun>, 'budgets' | 'proofContract'> & {
  budgets?: Partial<AutonomousRunBudgets>;
  proofContract?: Partial<AutonomousRunProofContract>;
};

function createRun(overrides: RunOverrides = {}): AutonomousRun {
  const { budgets, proofContract, ...runOverrides } = overrides;
  return {
    id: 'run-1',
    goal: 'Run goal',
    mode: 'unattended',
    status: 'running',
    modelAdapter: 'deepseek_web',
    targetLeaseId: null,
    budgets: { ...DEFAULT_AUTONOMOUS_RUN_BUDGETS, ...budgets },
    policy: DEFAULT_AUTONOMOUS_RUN_POLICY,
    proofContract: {
      ...DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
      doneCriteria: ['done'],
      requiredEvidence: [],
      ...proofContract,
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
    ...runOverrides,
  };
}

function createLease(overrides: Partial<AutonomousTargetLease> = {}): AutonomousTargetLease {
  return {
    id: 'lease-1',
    runId: 'run-1',
    status: 'active',
    label: 'Target',
    tabId: 1,
    windowId: 1,
    origin: 'https://example.com',
    title: 'Example',
    acquiredAt: NOW - 500,
    expiresAt: NOW + 1_000,
    lastVerifiedAt: NOW - 10,
    releasedAt: null,
    ...overrides,
  };
}

function createEvidence(overrides: Partial<AutonomousEvidenceRecord> = {}): AutonomousEvidenceRecord {
  return {
    id: 'evidence-1',
    runId: 'run-1',
    leaseId: 'lease-1',
    kind: 'shell_output',
    freshness: 'fresh',
    capturedAt: NOW - 100,
    expiresAt: NOW + 100,
    summary: 'shell_output tests pass',
    refs: ['evidence-ref'],
    source: { tabId: 1, windowId: 1 },
    metadata: null,
    ...overrides,
  };
}

function createStep(overrides: Partial<AutonomousRunStep> & { errorCode?: string } = {}): AutonomousRunStep {
  const { errorCode, ...stepOverrides } = overrides;
  return {
    id: 'step-1',
    runId: 'run-1',
    seq: 1,
    phase: 'verification',
    status: 'succeeded',
    modelTurnId: null,
    toolCallIds: [],
    observationRefs: [],
    evidenceRefs: [],
    progressScore: 0,
    proofDelta: [],
    error: errorCode
      ? {
        code: errorCode,
        message: 'Repeated failure',
        phase: 'model_turn',
        retryable: true,
        at: NOW,
      }
      : null,
    startedAt: NOW - 50,
    endedAt: NOW - 40,
    ...stepOverrides,
  };
}
