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
    });
    expect(executor).toHaveBeenCalledTimes(1);
    const finalRun = await getAutonomousRunById(run.id);
    expect(finalRun?.status).toBe('running');
    const steps = await getAutonomousRunSteps(run.id);
    expect(steps.length).toBeGreaterThan(0);
  });

  it('does not auto-resume paused or blocked runs', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'paused' });

    const run = await createAutonomousRun({ goal: 'Paused' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await transitionAutonomousRun(run.id, 'paused', null, 120);

    const executor = vi.fn();
    const result = await executeAutonomousRunCycle(run.id, executor, { now: 130 });

    expect(result).toMatchObject({ action: 'noop', finalStatus: 'paused' });
    expect(executor).not.toHaveBeenCalled();
  });

  it('records review step and does not call executor on policy deny/manual', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'policy-block' });

    const run = await createAutonomousRun({
      goal: 'Policy block',
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, approvalMode: 'manual_all' },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    const executor = vi.fn();
    const result = await executeAutonomousRunCycle(run.id, executor, { now: 120, actionKind: 'tool_call' });

    expect(result).toMatchObject({
      action: 'block',
      policyDecision: 'manual_review',
      applied: true,
    });
    expect(executor).not.toHaveBeenCalled();
    const steps = await getAutonomousRunSteps(run.id);
    expect(steps.some(s => s.phase === 'review')).toBe(true);
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
    });
    expect(executor).toHaveBeenCalledTimes(1);
    const steps = await getAutonomousRunSteps(run.id);
    expect(steps.length).toBeGreaterThan(0);
    expect(result.errorCode).toBe('executor_error');
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
