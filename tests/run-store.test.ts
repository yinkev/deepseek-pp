import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAutonomousRunStep,
  AUTONOMOUS_RUN_STORAGE_KEY,
  createAutonomousRun,
  getAutonomousRunById,
  getAutonomousRuns,
  getAutonomousRunSteps,
  reconcileInterruptedAutonomousRuns,
  transitionAutonomousRun,
  updateAutonomousRun,
  updateAutonomousRunCheckpoint,
} from '../core/run/store';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('autonomous run store', () => {
  it('creates, persists, and resumes runs from durable storage', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'run-id' });

    const created = await createAutonomousRun({
      goal: 'Build run kernel',
      proofContract: {
        doneCriteria: ['Tests pass'],
        requiredEvidence: ['command_output'],
      },
    }, 100);
    await transitionAutonomousRun(created.id, 'running', null, 110);
    await appendAutonomousRunStep(created.id, {
      id: 'step-1',
      phase: 'plan',
      progressScore: 0.5,
      proofDelta: ['Plan written'],
    }, 120);
    await updateAutonomousRunCheckpoint(created.id, {
      resumableSummary: 'Planned run kernel.',
      unresolvedQuestions: ['Need target lease next'],
    }, 130);

    const resumed = await getAutonomousRunById(created.id);
    const steps = await getAutonomousRunSteps(created.id);

    expect(resumed).toMatchObject({
      id: 'run-run-id',
      goal: 'Build run kernel',
      status: 'running',
      checkpoint: {
        latestStepId: 'step-1',
        resumableSummary: 'Planned run kernel.',
        unresolvedQuestions: ['Need target lease next'],
      },
      proofContract: {
        doneCriteria: ['Tests pass'],
        requiredEvidence: ['command_output'],
      },
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ seq: 1, phase: 'plan', proofDelta: ['Plan written'] });
  });

  it('redacts durable secrets, media, urls, and vision refs', async () => {
    const { chromeStub, storage } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'secret' });

    const run = await createAutonomousRun({
      id: 'file-sensitive0',
      goal: 'Use Authorization: Bearer abc and screenshot data:image/png;base64,AAAA',
      checkpoint: {
        resumableSummary: 'Open https://example.com/private?token=secret file-sensitive1',
      },
    }, 100);
    await appendAutonomousRunStep(run.id, {
      id: 'step-secret',
      phase: 'tool_execution',
      observationRefs: ['file-sensitive2'],
      evidenceRefs: ['evidence-safe'],
      proofDelta: ['Cookie: sid=secret data:image/png;base64,BBBB'],
      error: {
        code: 'browser_error',
        message: 'Authorization: Bearer abc',
        phase: 'tool_execution',
        retryable: true,
        at: 110,
        details: {
          url: 'https://signed.example/file?token=secret',
          dataUrl: 'data:image/png;base64,CCCC',
          refFileIds: ['file-sensitive3'],
        },
      },
    }, 110);

    const json = JSON.stringify(storage.get(AUTONOMOUS_RUN_STORAGE_KEY));
    expect(json).not.toMatch(/Bearer|sid=secret|data:image|AAAA|BBBB|CCCC|signed\.example|token=secret|file-sensitive/);
    expect(json).toContain('[redacted:secret]');
    expect(json).toContain('[redacted:media]');
    expect(json).toContain('[redacted:vision-ref]');
  });

  it('bounds error details before durable storage', async () => {
    const { chromeStub, storage } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'details' });

    const run = await createAutonomousRun({ goal: 'Bound details' }, 100);
    await appendAutonomousRunStep(run.id, {
      phase: 'tool_execution',
      error: {
        code: 'oversized_details',
        message: 'Tool failed',
        phase: 'tool_execution',
        retryable: true,
        at: 110,
        details: {
          transcript: 'x'.repeat(20_000),
          nested: {
            a: {
              b: {
                c: {
                  d: 'too deep',
                },
              },
            },
          },
          hugeArray: Array.from({ length: 100 }, (_, index) => `item-${index}`),
        },
      },
    }, 110);

    const json = JSON.stringify(storage.get(AUTONOMOUS_RUN_STORAGE_KEY));
    expect(json.length).toBeLessThan(8_000);
    expect(json).not.toMatch(/x{1000}/);
    expect(json).toContain('[truncated]');
  });

  it('reconciles stale running runs to blocked without globals', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'stale' });

    const run = await createAutonomousRun({ goal: 'Long run' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    await expect(reconcileInterruptedAutonomousRuns(1_000, 2_000)).resolves.toBe(1);
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: 'blocked',
      error: {
        code: 'autonomous_run_interrupted',
        retryable: true,
      },
    });
  });

  it('sets startedAt when updateAutonomousRun moves a queued run to running', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'updated-running' });

    const run = await createAutonomousRun({ goal: 'Update to running' }, 100);
    await updateAutonomousRun(run.id, { status: 'running' }, 150);

    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: 'running',
      startedAt: 150,
    });
  });

  it('reconciles stale malformed running rows with missing startedAt', async () => {
    const { chromeStub, storage } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'malformed-running' });

    const run = await createAutonomousRun({ goal: 'Malformed running' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    const state = storage.get(AUTONOMOUS_RUN_STORAGE_KEY) as {
      runs: Array<Record<string, unknown>>;
    };
    state.runs = state.runs.map((stored) => stored.id === run.id
      ? { ...stored, startedAt: null, updatedAt: 110 }
      : stored);
    storage.set(AUTONOMOUS_RUN_STORAGE_KEY, state);

    await expect(reconcileInterruptedAutonomousRuns(1_000, 2_000)).resolves.toBe(1);
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: 'blocked',
      error: {
        code: 'autonomous_run_interrupted',
        details: {
          startedAt: null,
          lastUpdatedAt: 110,
        },
      },
    });
  });

  it('prevents terminal runs from resuming', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'terminal' });

    const run = await createAutonomousRun({ goal: 'Finish' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await transitionAutonomousRun(run.id, 'succeeded', null, 120);
    await transitionAutonomousRun(run.id, 'running', null, 130);

    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: 'succeeded',
      completedAt: 120,
    });
  });

  it('prevents terminal runs from accepting late steps or checkpoint edits', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'closed' });

    const run = await createAutonomousRun({ goal: 'Close ledger' }, 100);
    await updateAutonomousRunCheckpoint(run.id, { resumableSummary: 'Before close' }, 105);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await transitionAutonomousRun(run.id, 'succeeded', null, 120);

    await expect(appendAutonomousRunStep(run.id, { id: 'late-step', phase: 'review' }, 130)).resolves.toBeNull();
    await updateAutonomousRunCheckpoint(run.id, { resumableSummary: 'After close' }, 140);
    await transitionAutonomousRun(run.id, 'succeeded', null, 150);

    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: 'succeeded',
      completedAt: 120,
      updatedAt: 120,
      checkpoint: {
        resumableSummary: 'Before close',
      },
    });
    await expect(getAutonomousRunSteps(run.id)).resolves.toEqual([]);
  });

  it('does not attach replaced-run steps to a new run with the same id', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'unused' });

    const first = await createAutonomousRun({ id: 'same-run', goal: 'First' }, 100);
    await appendAutonomousRunStep(first.id, { id: 'old-step', phase: 'plan' }, 110);
    const second = await createAutonomousRun({ id: 'same-run', goal: 'Second' }, 200);

    await expect(getAutonomousRunById(second.id)).resolves.toMatchObject({ goal: 'Second' });
    await expect(getAutonomousRunSteps(second.id)).resolves.toEqual([]);
  });

  it('serializes concurrent appends so ledger entries are not lost', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'concurrent' });

    const run = await createAutonomousRun({ goal: 'Concurrent ledger' }, 100);
    await Promise.all([
      appendAutonomousRunStep(run.id, { id: 'step-a', phase: 'plan' }, 110),
      appendAutonomousRunStep(run.id, { id: 'step-b', phase: 'review' }, 111),
    ]);

    await expect(getAutonomousRunSteps(run.id)).resolves.toMatchObject([
      { id: 'step-a', seq: 1 },
      { id: 'step-b', seq: 2 },
    ]);
  });

  it('merges concurrent checkpoint updates against latest stored state', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'checkpoint' });

    const run = await createAutonomousRun({ goal: 'Concurrent checkpoint' }, 100);
    await Promise.all([
      updateAutonomousRunCheckpoint(run.id, { resumableSummary: 'Summary' }, 110),
      updateAutonomousRunCheckpoint(run.id, { unresolvedQuestions: ['Question'] }, 111),
    ]);

    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      checkpoint: {
        resumableSummary: 'Summary',
        unresolvedQuestions: ['Question'],
      },
    });
  });

  it('preserves checkpoint latestStepId when step append races checkpoint text update', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'mixed' });

    const run = await createAutonomousRun({ goal: 'Mixed checkpoint' }, 100);
    await Promise.all([
      appendAutonomousRunStep(run.id, { id: 'step-1', phase: 'plan' }, 110),
      updateAutonomousRunCheckpoint(run.id, { resumableSummary: 'Summary' }, 111),
    ]);

    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      checkpoint: {
        latestStepId: 'step-1',
        resumableSummary: 'Summary',
      },
    });
    await expect(getAutonomousRunSteps(run.id)).resolves.toHaveLength(1);
  });

  it('keeps runs newest-first and steps sorted by sequence when read', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `${id += 1}` });

    const first = await createAutonomousRun({ goal: 'First' }, 100);
    const second = await createAutonomousRun({ goal: 'Second' }, 200);
    await appendAutonomousRunStep(first.id, { id: 'step-b', phase: 'model_turn' }, 120);
    await appendAutonomousRunStep(first.id, { id: 'step-a', phase: 'plan' }, 110);

    await expect(getAutonomousRuns()).resolves.toMatchObject([
      { id: second.id },
      { id: first.id },
    ]);
    await expect(getAutonomousRunSteps(first.id)).resolves.toMatchObject([
      { id: 'step-b', seq: 1 },
      { id: 'step-a', seq: 2 },
    ]);
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
