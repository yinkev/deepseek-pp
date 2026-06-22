import { describe, expect, it } from 'vitest';
import {
  isTerminalRunStatus,
  reviewAutonomousRunProgress,
  shouldTransitionAutonomousRun,
} from '../core/run/kernel';
import type { AutonomousRun, AutonomousRunStep } from '../core/run/types';
import { DEFAULT_AUTONOMOUS_RUN_BUDGETS, DEFAULT_AUTONOMOUS_RUN_POLICY, DEFAULT_AUTONOMOUS_PROOF_CONTRACT } from '../core/run/store';

const NOW = 1_000;

describe('autonomous run kernel', () => {
  it('enforces lifecycle transitions', () => {
    expect(shouldTransitionAutonomousRun('queued', 'running')).toBe(true);
    expect(shouldTransitionAutonomousRun('running', 'succeeded')).toBe(true);
    expect(shouldTransitionAutonomousRun('paused', 'running')).toBe(true);
    expect(shouldTransitionAutonomousRun('blocked', 'running')).toBe(true);
    expect(shouldTransitionAutonomousRun('succeeded', 'running')).toBe(false);
    expect(shouldTransitionAutonomousRun('failed', 'queued')).toBe(false);
  });

  it('detects terminal statuses', () => {
    expect(isTerminalRunStatus('succeeded')).toBe(true);
    expect(isTerminalRunStatus('failed')).toBe(true);
    expect(isTerminalRunStatus('cancelled')).toBe(true);
    expect(isTerminalRunStatus('blocked')).toBe(false);
  });

  it('blocks after repeated no-progress steps', () => {
    const run = createRun({ budgets: { ...DEFAULT_AUTONOMOUS_RUN_BUDGETS, maxConsecutiveNoProgress: 3 } });
    const review = reviewAutonomousRunProgress(run, [
      createStep(1, { progressScore: 0 }),
      createStep(2, { progressScore: 0 }),
      createStep(3, { progressScore: 0 }),
    ], NOW);

    expect(review).toMatchObject({
      blocked: true,
      reason: 'no_progress',
      error: { code: 'run_no_progress', retryable: true },
    });
  });

  it('does not block when recent step has proof delta or evidence', () => {
    const run = createRun({ budgets: { ...DEFAULT_AUTONOMOUS_RUN_BUDGETS, maxConsecutiveNoProgress: 3 } });
    const review = reviewAutonomousRunProgress(run, [
      createStep(1, { progressScore: 0 }),
      createStep(2, { progressScore: 0 }),
      createStep(3, { progressScore: 0, evidenceRefs: ['evidence-1'] }),
    ], NOW);

    expect(review.blocked).toBe(false);
  });

  it('blocks after same error repeats', () => {
    const run = createRun({ budgets: { ...DEFAULT_AUTONOMOUS_RUN_BUDGETS, maxSameErrorRepeats: 2 } });
    const review = reviewAutonomousRunProgress(run, [
      createStep(1, { errorCode: 'target_stale' }),
      createStep(2, { errorCode: 'target_stale' }),
    ], NOW);

    expect(review).toMatchObject({
      blocked: true,
      reason: 'same_error',
      error: { code: 'run_repeated_error' },
    });
  });

  it('does not treat separated failures as repeated same-error progress failure', () => {
    const run = createRun({ budgets: { ...DEFAULT_AUTONOMOUS_RUN_BUDGETS, maxSameErrorRepeats: 2 } });
    const review = reviewAutonomousRunProgress(run, [
      createStep(1, { errorCode: 'target_stale' }),
      createStep(2, { progressScore: 0.5 }),
      createStep(3, { errorCode: 'target_stale' }),
    ], NOW);

    expect(review.blocked).toBe(false);
  });
});

function createRun(overrides: Partial<AutonomousRun> = {}): AutonomousRun {
  return {
    id: 'run-1',
    goal: 'Implement autonomous worker',
    mode: 'unattended',
    status: 'running',
    modelAdapter: 'deepseek_web',
    targetLeaseId: null,
    budgets: DEFAULT_AUTONOMOUS_RUN_BUDGETS,
    policy: DEFAULT_AUTONOMOUS_RUN_POLICY,
    proofContract: DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
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

function createStep(seq: number, overrides: Partial<AutonomousRunStep> & { errorCode?: string } = {}): AutonomousRunStep {
  return {
    id: `step-${seq}`,
    runId: 'run-1',
    seq,
    phase: 'tool_execution',
    status: overrides.errorCode ? 'failed' : 'succeeded',
    modelTurnId: null,
    toolCallIds: [],
    observationRefs: [],
    evidenceRefs: [],
    progressScore: 0,
    proofDelta: [],
    error: overrides.errorCode
      ? {
        code: overrides.errorCode,
        message: 'failed',
        phase: 'tool_execution',
        retryable: true,
        at: NOW + seq,
      }
      : null,
    startedAt: NOW + seq,
    endedAt: NOW + seq,
    ...overrides,
  };
}
