import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAutonomousEvidenceRecord,
  appendAutonomousRunStep,
  applyAutonomousRunIterationReview,
  createAutonomousRun,
  getAutonomousRunById,
  getAutonomousRunSteps,
  transitionAutonomousRun,
} from '../core/run/store';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('autonomous run durable iteration controller', () => {
  it('records a review step and transitions passing runs to succeeded', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'pass' });

    const run = await createAutonomousRun({
      goal: 'Apply passing review',
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: ['shell_output'],
      },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    const evidence = await appendAutonomousEvidenceRecord(run.id, {
      id: 'evidence-pass',
      kind: 'shell_output',
      summary: 'shell_output tests pass',
      refs: ['test-output'],
    }, 120);
    await appendAutonomousRunStep(run.id, {
      id: 'step-proof',
      phase: 'verification',
      progressScore: 1,
      proofDelta: ['tests pass'],
      evidenceRefs: [evidence?.id ?? ''],
    }, 130);

    const result = await applyAutonomousRunIterationReview({
      runId: run.id,
      completionClaimed: true,
    }, 140);

    expect(result).toMatchObject({
      applied: true,
      review: {
        action: 'succeed',
        grade: 'A',
      },
      run: {
        status: 'succeeded',
        completedAt: 140,
        error: null,
      },
      step: {
        phase: 'review',
        status: 'succeeded',
        progressScore: 1,
        evidenceRefs: ['evidence-pass'],
      },
    });
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: 'succeeded',
      checkpoint: {
        latestStepId: result.step?.id,
      },
    });
  });

  it('records incomplete unclaimed reviews without failing the run', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'iterate' });

    const run = await createAutonomousRun({
      goal: 'Keep iterating',
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: ['shell_output'],
      },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    const result = await applyAutonomousRunIterationReview({
      runId: run.id,
      completionClaimed: false,
    }, 120);

    expect(result).toMatchObject({
      applied: true,
      review: {
        action: 'iterate',
        completionDecision: 'fail',
      },
      run: {
        status: 'running',
        completedAt: null,
        error: null,
      },
      step: {
        phase: 'review',
        status: 'succeeded',
      },
    });
    await expect(getAutonomousRunSteps(run.id)).resolves.toHaveLength(1);
  });

  it('records no-progress reviews and transitions runs to blocked', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'block' });

    const run = await createAutonomousRun({
      goal: 'Block stalled work',
      budgets: { maxConsecutiveNoProgress: 2 },
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: ['shell_output'],
      },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousRunStep(run.id, {
      id: 'step-bogus-1',
      phase: 'tool_execution',
      progressScore: 1,
      proofDelta: ['unrelated'],
      evidenceRefs: ['missing-1'],
    }, 120);
    await appendAutonomousRunStep(run.id, {
      id: 'step-bogus-2',
      phase: 'tool_execution',
      progressScore: 1,
      proofDelta: ['still unrelated'],
      evidenceRefs: ['missing-2'],
    }, 130);

    const result = await applyAutonomousRunIterationReview({ runId: run.id }, 140);

    expect(result).toMatchObject({
      applied: true,
      review: {
        action: 'block',
        progressReason: 'no_progress',
      },
      run: {
        status: 'blocked',
        error: {
          code: 'run_no_progress',
        },
      },
      step: {
        phase: 'review',
        status: 'failed',
        error: {
          code: 'run_no_progress',
        },
      },
    });
  });

  it('does not append review steps for terminal runs or missing runs', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'terminal' });

    const run = await createAutonomousRun({
      goal: 'Terminal run',
      proofContract: {
        doneCriteria: ['tests pass'],
        requiredEvidence: ['shell_output'],
      },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await transitionAutonomousRun(run.id, 'succeeded', null, 120);

    await expect(applyAutonomousRunIterationReview({ runId: run.id }, 130)).resolves.toMatchObject({
      applied: false,
      step: null,
      review: {
        action: 'noop',
      },
    });
    await expect(applyAutonomousRunIterationReview({ runId: 'missing-run' }, 140)).resolves.toEqual({
      run: null,
      step: null,
      review: null,
      applied: false,
    });
    await expect(getAutonomousRunSteps(run.id)).resolves.toEqual([]);
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
