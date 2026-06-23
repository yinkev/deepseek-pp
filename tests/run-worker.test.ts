import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAutonomousRunStep,
  createAutonomousRun,
  getAutonomousRunById,
  getAutonomousRunSteps,
  releaseAutonomousTargetLease,
  transitionAutonomousRun,
  updateAutonomousRun,
  upsertAutonomousTargetLease,
} from '../core/run/store';
import { executeAutonomousRunCycle } from '../core/run/worker';
import {
  DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
  DEFAULT_AUTONOMOUS_RUN_BUDGETS,
  DEFAULT_AUTONOMOUS_RUN_POLICY,
} from '../core/run/store';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('autonomous run worker cycle (non-Chrome)', () => {
  it('returns noop and writes nothing for missing run', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'noop-missing' });

    const result = await executeAutonomousRunCycle('missing-run', vi.fn(), { now: 100 });

    expect(result).toMatchObject({
      action: 'noop',
      runId: 'missing-run',
      started: false,
      advanced: false,
      applied: false,
      policyDecision: null,
      reviewSummary: null,
      finalStatus: null,
    });
  });

  it('returns noop for terminal run', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'terminal' });

    const run = await createAutonomousRun({ goal: 'Terminal' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await transitionAutonomousRun(run.id, 'succeeded', null, 120);

    const executor = vi.fn();
    const result = await executeAutonomousRunCycle(run.id, executor, { now: 130 });

    expect(result).toMatchObject({ action: 'noop', finalStatus: 'succeeded' });
    expect(executor).not.toHaveBeenCalled();
  });

  it('transitions queued to running, calls executor, applies iteration, returns advance', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'start-advance' });

    const run = await createAutonomousRun({
      goal: 'Queued to running',
      proofContract: { ...DEFAULT_AUTONOMOUS_PROOF_CONTRACT, doneCriteria: ['done'] },
    }, 100);

    const executor = vi.fn(async ({ runId }) => {
      await appendAutonomousRunStep(runId, {
        phase: 'verification',
        progressScore: 1,
        proofDelta: ['done'],
      }, 130);
    });

    const result = await executeAutonomousRunCycle(run.id, executor, { now: 120 });

    expect(result).toMatchObject({
      action: 'advance',
      started: true,
      advanced: true,
      applied: true,
      policyDecision: 'allow',
      reviewSummary: {
        action: 'iterate',
        completionDecision: 'iterate',
        grade: 'A',
        issueCount: 1,
        proofDebtCount: 0,
        acceptedEvidenceCount: 0,
        progressReason: null,
        errorCode: 'completion_review_iterate',
      },
    });
    expect(result.reviewSummary?.score).toBeGreaterThan(0);
    expect(executor).toHaveBeenCalledTimes(1);
    const finalRun = await getAutonomousRunById(run.id);
    expect(finalRun?.status).toBe('running');
    const steps = await getAutonomousRunSteps(run.id);
    expect(steps.length).toBeGreaterThan(0);
  });

  it('does not auto-resume paused or blocked runs (including policy-blocked)', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'paused' });

    const run = await createAutonomousRun({ goal: 'Paused' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await transitionAutonomousRun(run.id, 'paused', null, 120);

    const executor = vi.fn();
    const result = await executeAutonomousRunCycle(run.id, executor, { now: 130 });

    expect(result).toMatchObject({ action: 'noop', finalStatus: 'paused' });
    expect(result.reviewSummary).toBeNull();
    expect(executor).not.toHaveBeenCalled();
  });

  it('records review step and does not call executor on policy manual_review (even with valid non-empty proof contract)', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'policy-block' });

    const run = await createAutonomousRun({
      goal: 'Policy block',
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, approvalMode: 'manual_all' },
      // non-empty valid proof contract: must still durably block from policy, not via empty-proof path
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: ['shell_output'],
        antiProof: [],
      },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    const executor = vi.fn();
    const result = await executeAutonomousRunCycle(run.id, executor, { now: 120, actionKind: 'tool_call' });

    expect(result).toMatchObject({
      action: 'block',
      policyDecision: 'manual_review',
      finalStatus: 'blocked',
      applied: false,
      reviewSummary: {
        action: 'noop',
        completionDecision: 'fail',
        proofDebtCount: 2,
        acceptedEvidenceCount: 0,
        progressReason: null,
      },
    });
    expect(result.reviewSummary?.issueCount).toBeGreaterThan(0);
    expect(executor).not.toHaveBeenCalled();

    const final = await getAutonomousRunById(run.id);
    expect(final?.status).toBe('blocked');
    expect(final?.error?.code).toContain('manual');

    const steps = await getAutonomousRunSteps(run.id);
    expect(steps.some(s => s.phase === 'review')).toBe(true);
  });

  it('records review step and does not call executor on policy deny (tool not allowlisted, non-empty valid proof contract)', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'policy-deny' });

    const run = await createAutonomousRun({
      goal: 'Tool not allowlisted',
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, allowedTools: ['only_safe'] },
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: ['shell_output'],
        antiProof: [],
      },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    const executor = vi.fn();
    const result = await executeAutonomousRunCycle(run.id, executor, { now: 120, actionKind: 'tool_call' });

    expect(result).toMatchObject({
      action: 'block',
      policyDecision: 'deny',
      finalStatus: 'blocked',
      applied: false,
      errorCode: 'autonomous_gate_tool_not_allowlisted',
      reviewSummary: {
        action: 'noop',
        completionDecision: 'fail',
        proofDebtCount: 2,
        acceptedEvidenceCount: 0,
      },
    });
    expect(executor).not.toHaveBeenCalled();

    const final = await getAutonomousRunById(run.id);
    expect(final?.status).toBe(result.finalStatus);
    expect(final?.error?.code).toBe(result.errorCode);

    // Assert review bookkeeping was appended (would fail if appendAutonomousRunStep skipped for deny)
    const steps = await getAutonomousRunSteps(run.id);
    const reviewStep = steps.find((s) => s.phase === 'review');
    expect(reviewStep).toBeDefined();
    expect(reviewStep?.status).toBe('failed');
    expect(reviewStep?.error?.code).toBe(result.errorCode);
    expect(reviewStep?.observationRefs).toContain('policy:tool_not_allowlisted');
    expect(reviewStep?.proofDelta).toEqual([]);
    expect(reviewStep?.evidenceRefs).toEqual([]);
    expect(reviewStep?.toolCallIds).toEqual([]);

    // Subsequent call after policy-block must noop, not auto-resume, no executor, no extra step
    const executor2 = vi.fn();
    const result2 = await executeAutonomousRunCycle(run.id, executor2, { now: 130 });
    expect(result2).toMatchObject({ action: 'noop', finalStatus: 'blocked' });
    expect(executor2).not.toHaveBeenCalled();
    const steps2 = await getAutonomousRunSteps(run.id);
    expect(steps2.length).toBe(steps.length);
  });

  it('calls executor when policy allows, records progress, applies iteration', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'policy-allow' });

    const run = await createAutonomousRun({ goal: 'Policy allow' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    const executor = vi.fn(async ({ runId }) => {
      await appendAutonomousRunStep(runId, {
        phase: 'verification',
        progressScore: 0,
      }, 130);
    });

    const result = await executeAutonomousRunCycle(run.id, executor, { now: 120 });

    expect(result.policyDecision).toBe('allow');
    expect(result.reviewSummary).toMatchObject({
      action: 'block',
      completionDecision: 'fail',
      grade: 'A',
      acceptedEvidenceCount: 0,
      errorCode: 'autonomous_iteration_empty_proof_contract',
    });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.advanced).toBe(true);
    expect(result.applied).toBe(true);
  });

  it('records failed step on executor error and still applies iteration', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'executor-error' });

    const run = await createAutonomousRun({ goal: 'Error case' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    const executor = vi.fn(async () => {
      throw new Error('executor failed hard');
    });

    const result = await executeAutonomousRunCycle(run.id, executor, { now: 120 });

    expect(result).toMatchObject({
      action: 'fail',
      errorCode: 'executor_error',
      applied: true,
      reviewSummary: {
        action: 'block',
        completionDecision: 'fail',
        grade: 'B',
        acceptedEvidenceCount: 0,
        errorCode: 'autonomous_iteration_empty_proof_contract',
      },
    });
    expect(JSON.stringify(result.reviewSummary)).not.toContain('executor failed hard');
    expect(executor).toHaveBeenCalledTimes(1);
    const steps = await getAutonomousRunSteps(run.id);
    expect(steps.length).toBeGreaterThan(0);
    expect(result.errorCode).toBe('executor_error');
  });

  it('blocks on review lane gate before starting queued work or calling executor', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'review-lane-gate' });

    const run = await createAutonomousRun({
      goal: 'Blocked by review lane',
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: ['review clear'],
        antiProof: [],
      },
    }, 100);

    const executor = vi.fn();
    const result = await executeAutonomousRunCycle(run.id, executor, {
      now: 120,
      reviewLaneGate: {
        status: 'blocked',
        reason: 'p2',
        canProceed: false,
        blockingPriority: 'P2',
        blockingLaneCount: 1,
      },
    });

    expect(result).toMatchObject({
      action: 'block',
      started: false,
      advanced: false,
      applied: false,
      policyDecision: null,
      finalStatus: 'blocked',
      errorCode: 'autonomous_review_lane_gate_blocked',
    });
    expect(executor).not.toHaveBeenCalled();

    const final = await getAutonomousRunById(run.id);
    expect(final).toMatchObject({
      status: 'blocked',
      error: { code: 'autonomous_review_lane_gate_blocked' },
    });

    const steps = await getAutonomousRunSteps(run.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      phase: 'review',
      status: 'failed',
      error: { code: 'autonomous_review_lane_gate_blocked' },
      observationRefs: [
        'review_lane_gate:p2',
        'review_lane_gate_priority:P2',
        'review_lane_gate_blocking_lanes:1',
      ],
      proofDelta: [],
      evidenceRefs: [],
      toolCallIds: [],
    });
  });

  it('does not block on non-blocking review lane attention', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'review-lane-attention' });

    const run = await createAutonomousRun({
      goal: 'Attention but can proceed',
      proofContract: {
        doneCriteria: ['done'],
        requiredEvidence: [],
        antiProof: [],
      },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    const executor = vi.fn(async ({ runId }) => {
      await appendAutonomousRunStep(runId, {
        phase: 'verification',
        progressScore: 1,
        proofDelta: ['done'],
      }, 130);
    });
    const result = await executeAutonomousRunCycle(run.id, executor, {
      now: 120,
      reviewLaneGate: {
        status: 'attention',
        reason: 'active_review',
        canProceed: true,
        blockingPriority: null,
        blockingLaneCount: 0,
      },
    });

    expect(result.action).toBe('advance');
    expect(result.advanced).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.errorCode).not.toBe('autonomous_review_lane_gate_blocked');
  });

  it('adversarial probe: contradictory gate cannot allow worker progress', async () => {
    // Gate has mixed signals: attention status + canProceed: true are permissive,
    // but reason: 'p1' is blocking. The system must fail closed.
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'contradictory-gate' });

    const run = await createAutonomousRun({
      goal: 'Contradictory gate probe',
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: [],
        antiProof: [],
      },
    }, 100);

    const executor = vi.fn();
    const result = await executeAutonomousRunCycle(run.id, executor, {
      now: 120,
      reviewLaneGate: {
        status: 'attention',
        reason: 'p1',
        canProceed: true,
        blockingPriority: null,
        blockingLaneCount: 2,
      },
    });

    expect(result).toMatchObject({
      action: 'block',
      started: false,
      advanced: false,
      applied: false,
      finalStatus: 'blocked',
      errorCode: 'autonomous_review_lane_gate_blocked',
    });
    expect(executor).not.toHaveBeenCalled();

    const final = await getAutonomousRunById(run.id);
    expect(final).toMatchObject({
      status: 'blocked',
      error: { code: 'autonomous_review_lane_gate_blocked' },
    });
  });

  it('adversarial probe: expired target lease blocks before executor and durable state agrees', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'expired-lease' });

    const run = await createAutonomousRun({
      goal: 'Expired lease watchdog probe',
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: [],
        antiProof: [],
      },
    }, 100);
    await upsertAutonomousTargetLease({
      id: 'lease-expired',
      runId: run.id,
      tabId: 42,
      windowId: 7,
      origin: 'https://example.com',
      acquiredAt: 0,
      ttlMs: 10_000,
    }, 110);
    await transitionAutonomousRun(run.id, 'running', null, 120);

    const executor = vi.fn();
    const result = await executeAutonomousRunCycle(run.id, executor, { now: 20_000 });

    expect(result).toMatchObject({
      action: 'block',
      started: false,
      advanced: false,
      applied: false,
      finalStatus: 'blocked',
      errorCode: 'autonomous_watchdog_expired_target_lease',
      schedulerWatchdogVerdict: {
        decision: 'mustBlock',
        reason: 'expired_target_lease',
        recommendedStatus: 'blocked',
      },
    });
    expect(executor).not.toHaveBeenCalled();
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: result.finalStatus,
      error: { code: result.errorCode },
    });
  });

  it('adversarial probe: missing target lease blocks before executor and durable state agrees', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'missing-lease' });

    const run = await createAutonomousRun({
      goal: 'Missing lease watchdog probe',
      targetLeaseId: 'lease-missing',
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: [],
        antiProof: [],
      },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 120);

    const executor = vi.fn();
    const result = await executeAutonomousRunCycle(run.id, executor, { now: 200 });

    expect(result).toMatchObject({
      action: 'block',
      advanced: false,
      finalStatus: 'blocked',
      errorCode: 'autonomous_watchdog_missing_target_lease',
      schedulerWatchdogVerdict: {
        decision: 'mustBlock',
        reason: 'missing_target_lease',
      },
    });
    expect(executor).not.toHaveBeenCalled();
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: result.finalStatus,
      error: { code: result.errorCode },
    });
  });

  it('adversarial probe: inactive target lease blocks before executor and durable state agrees', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'inactive-lease' });

    const run = await createAutonomousRun({
      goal: 'Inactive lease watchdog probe',
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: [],
        antiProof: [],
      },
    }, 100);
    const lease = await upsertAutonomousTargetLease({
      id: 'lease-inactive',
      runId: run.id,
      tabId: 42,
      windowId: 7,
      origin: 'https://example.com',
    }, 110);
    await releaseAutonomousTargetLease(lease?.id ?? '', 120);
    await updateAutonomousRun(run.id, { targetLeaseId: lease?.id ?? null }, 130);
    await transitionAutonomousRun(run.id, 'running', null, 140);

    const executor = vi.fn();
    const result = await executeAutonomousRunCycle(run.id, executor, { now: 200 });

    expect(result).toMatchObject({
      action: 'block',
      advanced: false,
      finalStatus: 'blocked',
      errorCode: 'autonomous_watchdog_inactive_target_lease',
      schedulerWatchdogVerdict: {
        decision: 'mustBlock',
        reason: 'inactive_target_lease',
      },
    });
    expect(executor).not.toHaveBeenCalled();
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: result.finalStatus,
      error: { code: result.errorCode },
    });
  });

  it('adversarial probe: exhausted no-progress budget blocks before executor and durable state agrees', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'watchdog-no-progress' });

    const run = await createAutonomousRun({
      goal: 'No progress watchdog probe',
      budgets: { maxConsecutiveNoProgress: 2 },
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: [],
        antiProof: [],
      },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousRunStep(run.id, { id: 'no-progress-1', phase: 'verification', progressScore: 0 }, 120);
    await appendAutonomousRunStep(run.id, { id: 'no-progress-2', phase: 'verification', progressScore: 0 }, 130);

    const executor = vi.fn();
    const result = await executeAutonomousRunCycle(run.id, executor, { now: 140 });

    expect(result).toMatchObject({
      action: 'block',
      advanced: false,
      finalStatus: 'blocked',
      errorCode: 'run_no_progress',
      schedulerWatchdogVerdict: {
        decision: 'mustBlock',
        reason: 'no_progress_exceeded',
      },
    });
    expect(executor).not.toHaveBeenCalled();
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: result.finalStatus,
      error: { code: result.errorCode },
    });
  });

  it('adversarial probe: exhausted same-error budget blocks before executor and durable state agrees', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'watchdog-same-error' });

    const run = await createAutonomousRun({
      goal: 'Same error watchdog probe',
      budgets: { maxSameErrorRepeats: 2 },
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: [],
        antiProof: [],
      },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    const error = {
      code: 'same_error',
      message: 'same error',
      phase: 'model_turn' as const,
      retryable: true,
      at: 120,
    };
    await appendAutonomousRunStep(run.id, { id: 'same-error-1', phase: 'model_turn', status: 'failed', error }, 120);
    await appendAutonomousRunStep(run.id, { id: 'same-error-2', phase: 'model_turn', status: 'failed', error }, 130);

    const executor = vi.fn();
    const result = await executeAutonomousRunCycle(run.id, executor, { now: 140 });

    expect(result).toMatchObject({
      action: 'block',
      advanced: false,
      finalStatus: 'blocked',
      errorCode: 'run_repeated_error',
      schedulerWatchdogVerdict: {
        decision: 'mustBlock',
        reason: 'same_error_exceeded',
      },
    });
    expect(executor).not.toHaveBeenCalled();
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: result.finalStatus,
      error: { code: result.errorCode },
    });
  });
});

function createChromeStub() {
  const storage = new Map<string, unknown>();
  return {
    storage,
    chromeStub: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) storage.set(key, value);
          }),
        },
      },
    },
  };
}
