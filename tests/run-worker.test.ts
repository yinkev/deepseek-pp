import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAutonomousRunStep,
  createAutonomousRun,
  getAutonomousRunById,
  getAutonomousRunSteps,
  transitionAutonomousRun,
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
