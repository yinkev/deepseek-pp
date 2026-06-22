import { describe, expect, it } from 'vitest';
import { reviewAutonomousRunIteration } from '../core/run/iteration';
import type {
  AutonomousEvidenceRecord,
  AutonomousRun,
  AutonomousRunStep,
} from '../core/run/types';
import {
  DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
  DEFAULT_AUTONOMOUS_RUN_BUDGETS,
  DEFAULT_AUTONOMOUS_RUN_POLICY,
} from '../core/run/store';

const NOW = 10_000;

describe('autonomous run iteration gate', () => {
  it('succeeds only when completion review passes with accepted evidence', () => {
    const run = createRun();
    const review = reviewAutonomousRunIteration({
      run,
      steps: [
        createStep({
          phase: 'verification',
          progressScore: 1,
          proofDelta: ['tests pass'],
          evidenceRefs: ['evidence-1'],
        }),
      ],
      evidence: [createEvidence()],
      completionClaimed: true,
      now: NOW,
    });

    expect(review).toMatchObject({
      action: 'succeed',
      nextStatus: 'succeeded',
      completionDecision: 'pass',
      grade: 'A',
      error: null,
      acceptedEvidenceIds: ['evidence-1'],
    });
  });

  it('iterates partial work instead of failing when completion was not claimed', () => {
    const review = reviewAutonomousRunIteration({
      run: createRun(),
      steps: [],
      evidence: [],
      completionClaimed: false,
      now: NOW,
    });

    expect(review).toMatchObject({
      action: 'iterate',
      nextStatus: 'running',
      completionDecision: 'fail',
      grade: 'F',
      progressReason: null,
    });
    expect(review.issueCodes).toEqual(expect.arrayContaining([
      'done_criteria_missing',
      'required_evidence_missing',
      'accepted_evidence_missing',
    ]));
  });

  it('succeeds passing completion even after trailing bookkeeping steps with no progress', () => {
    const run = createRun({
      budgets: {
        ...DEFAULT_AUTONOMOUS_RUN_BUDGETS,
        maxConsecutiveNoProgress: 2,
      },
    });
    const review = reviewAutonomousRunIteration({
      run,
      steps: [
        createStep({
          id: 'step-proof',
          seq: 1,
          phase: 'verification',
          proofDelta: ['tests pass'],
          evidenceRefs: ['evidence-1'],
          progressScore: 1,
        }),
        createStep({ id: 'step-review', seq: 2, phase: 'review', progressScore: 0 }),
        createStep({ id: 'step-checkpoint', seq: 3, phase: 'checkpoint', progressScore: 0 }),
      ],
      evidence: [createEvidence()],
      completionClaimed: true,
      now: NOW,
    });

    expect(review).toMatchObject({
      action: 'succeed',
      nextStatus: 'succeeded',
      completionDecision: 'pass',
      progressReason: null,
    });
  });

  it('blocks no-progress loops with bogus proof deltas and unaccepted evidence refs', () => {
    const run = createRun({
      budgets: {
        ...DEFAULT_AUTONOMOUS_RUN_BUDGETS,
        maxConsecutiveNoProgress: 2,
      },
    });
    const review = reviewAutonomousRunIteration({
      run,
      steps: [
        createStep({
          id: 'step-1',
          seq: 1,
          progressScore: 1,
          proofDelta: ['unrelated marker'],
          evidenceRefs: ['missing-evidence'],
        }),
        createStep({
          id: 'step-2',
          seq: 2,
          progressScore: 1,
          proofDelta: ['still unrelated'],
          evidenceRefs: ['another-missing-evidence'],
        }),
      ],
      evidence: [],
      completionClaimed: false,
      now: NOW,
    });

    expect(review).toMatchObject({
      action: 'block',
      nextStatus: 'blocked',
      progressReason: 'no_progress',
      error: {
        code: 'run_no_progress',
      },
    });
  });

  it('does not count review bookkeeping steps as verified progress', () => {
    const run = createRun({
      budgets: {
        ...DEFAULT_AUTONOMOUS_RUN_BUDGETS,
        maxConsecutiveNoProgress: 2,
      },
    });
    const review = reviewAutonomousRunIteration({
      run,
      steps: [
        createStep({
          id: 'step-review-1',
          seq: 1,
          phase: 'review',
          progressScore: 1,
          evidenceRefs: ['evidence-1'],
        }),
        createStep({
          id: 'step-review-2',
          seq: 2,
          phase: 'review',
          progressScore: 1,
          evidenceRefs: ['evidence-1'],
        }),
      ],
      evidence: [createEvidence()],
      completionClaimed: false,
      now: NOW,
    });

    expect(review).toMatchObject({
      action: 'block',
      nextStatus: 'blocked',
      progressReason: 'no_progress',
    });
  });

  it('fails when completion was claimed but review fails', () => {
    const review = reviewAutonomousRunIteration({
      run: createRun(),
      steps: [],
      evidence: [],
      completionClaimed: true,
      now: NOW,
    });

    expect(review).toMatchObject({
      action: 'fail',
      nextStatus: 'failed',
      completionDecision: 'fail',
      error: {
        code: 'completion_review_fail',
        retryable: false,
      },
    });
  });

  it('blocks no-progress loops before another iteration', () => {
    const run = createRun({
      budgets: {
        ...DEFAULT_AUTONOMOUS_RUN_BUDGETS,
        maxConsecutiveNoProgress: 2,
      },
    });
    const review = reviewAutonomousRunIteration({
      run,
      steps: [
        createStep({ id: 'step-1', seq: 1, progressScore: 0 }),
        createStep({ id: 'step-2', seq: 2, progressScore: 0 }),
      ],
      evidence: [],
      now: NOW,
    });

    expect(review).toMatchObject({
      action: 'block',
      nextStatus: 'blocked',
      progressReason: 'no_progress',
      error: {
        code: 'run_no_progress',
      },
    });
  });

  it('blocks repeated same-error loops before completion review outcome', () => {
    const run = createRun({
      budgets: {
        ...DEFAULT_AUTONOMOUS_RUN_BUDGETS,
        maxSameErrorRepeats: 2,
      },
    });
    const review = reviewAutonomousRunIteration({
      run,
      steps: [
        createStep({
          id: 'step-1',
          seq: 1,
          status: 'failed',
          error: createError('same_error'),
        }),
        createStep({
          id: 'step-2',
          seq: 2,
          status: 'failed',
          error: createError('same_error'),
        }),
      ],
      evidence: [],
      completionClaimed: true,
      now: NOW,
    });

    expect(review).toMatchObject({
      action: 'block',
      nextStatus: 'blocked',
      progressReason: 'same_error',
      error: {
        code: 'run_repeated_error',
      },
    });
  });

  it('blocks empty proof contracts because unattended completion is ungoverned', () => {
    const review = reviewAutonomousRunIteration({
      run: createRun({ proofContract: DEFAULT_AUTONOMOUS_PROOF_CONTRACT }),
      steps: [],
      evidence: [],
      now: NOW,
    });

    expect(review).toMatchObject({
      action: 'block',
      nextStatus: 'blocked',
      completionDecision: 'fail',
      error: {
        code: 'autonomous_iteration_empty_proof_contract',
        retryable: false,
      },
    });
    expect(review.issueCodes).toContain('proof_contract_empty');
  });

  it('uses a non-retryable empty-proof block error even when evidence exists', () => {
    const review = reviewAutonomousRunIteration({
      run: createRun({ proofContract: DEFAULT_AUTONOMOUS_PROOF_CONTRACT }),
      steps: [],
      evidence: [createEvidence()],
      now: NOW,
    });

    expect(review).toMatchObject({
      action: 'block',
      nextStatus: 'blocked',
      completionDecision: 'iterate',
      error: {
        code: 'autonomous_iteration_empty_proof_contract',
        retryable: false,
      },
    });
  });

  it('does not mutate terminal run status', () => {
    const review = reviewAutonomousRunIteration({
      run: createRun({ status: 'succeeded', completedAt: NOW }),
      steps: [],
      evidence: [],
      completionClaimed: true,
      now: NOW,
    });

    expect(review).toMatchObject({
      action: 'noop',
      nextStatus: null,
    });
  });

  it('does not promote non-running runs into iteration', () => {
    const review = reviewAutonomousRunIteration({
      run: createRun({ status: 'paused' }),
      steps: [],
      evidence: [],
      now: NOW,
    });

    expect(review).toMatchObject({
      action: 'noop',
      nextStatus: null,
    });
  });
});

function createRun(overrides: Partial<AutonomousRun> = {}): AutonomousRun {
  return {
    id: 'run-1',
    goal: 'Autonomous worker',
    mode: 'unattended',
    status: 'running',
    modelAdapter: 'deepseek_web',
    targetLeaseId: null,
    budgets: DEFAULT_AUTONOMOUS_RUN_BUDGETS,
    policy: DEFAULT_AUTONOMOUS_RUN_POLICY,
    proofContract: {
      doneCriteria: ['tests pass'],
      requiredEvidence: ['shell_output'],
      antiProof: DEFAULT_AUTONOMOUS_PROOF_CONTRACT.antiProof,
    },
    checkpoint: {
      providerConversationId: null,
      parentMessageId: null,
      latestStepId: null,
      resumableSummary: '',
      unresolvedQuestions: [],
    },
    error: null,
    createdAt: NOW,
    startedAt: NOW,
    completedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function createStep(overrides: Partial<AutonomousRunStep> = {}): AutonomousRunStep {
  return {
    id: 'step-1',
    runId: 'run-1',
    seq: 1,
    phase: 'tool_execution',
    status: 'succeeded',
    modelTurnId: null,
    toolCallIds: [],
    observationRefs: [],
    evidenceRefs: [],
    progressScore: 0,
    proofDelta: [],
    error: null,
    startedAt: NOW,
    endedAt: NOW,
    ...overrides,
  };
}

function createEvidence(overrides: Partial<AutonomousEvidenceRecord> = {}): AutonomousEvidenceRecord {
  return {
    id: 'evidence-1',
    runId: 'run-1',
    leaseId: null,
    kind: 'shell_output',
    freshness: 'fresh',
    capturedAt: NOW - 100,
    expiresAt: NOW + 10_000,
    summary: 'shell_output tests pass',
    refs: ['test-output'],
    source: { toolName: 'npm test' },
    metadata: null,
    ...overrides,
  };
}

function createError(code: string) {
  return {
    code,
    message: code,
    phase: 'tool_execution' as const,
    retryable: true,
    at: NOW,
  };
}
