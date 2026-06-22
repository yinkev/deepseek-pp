import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAutonomousEvidenceRecord,
  appendAutonomousRunStep,
  createAutonomousRun,
  transitionAutonomousRun,
  upsertAutonomousTargetLease,
} from '../core/run/store';
import {
  getAutonomousRunCockpitSnapshot,
  initializeAutonomousRunOrchestrator,
} from '../core/run/orchestrator';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('autonomous run orchestrator startup bridge', () => {
  it('reconciles stale running runs on startup and returns a blocked cockpit snapshot', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'stale' });

    const run = await createAutonomousRun({ goal: 'Long autonomous run' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    const result = await initializeAutonomousRunOrchestrator({
      interruptedThresholdMs: 1_000,
      now: 2_000,
    });

    expect(result.reconciledInterruptedRuns).toBe(1);
    expect(result.snapshot).toMatchObject({
      status: 'blocked',
      totals: {
        blocked: 1,
        running: 0,
      },
      activeRun: {
        id: run.id,
        status: 'blocked',
        errorCode: 'autonomous_run_interrupted',
      },
    });
  });

  it('summarizes active run latest step, evidence, and target lease counts', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'active' });

    const blocked = await createAutonomousRun({ id: 'blocked-run', goal: 'Blocked run' }, 100);
    await transitionAutonomousRun(blocked.id, 'running', null, 110);
    await transitionAutonomousRun(blocked.id, 'blocked', {
      code: 'needs_review',
      message: 'Needs review',
      phase: 'review',
      retryable: true,
      at: 120,
    }, 120);

    const running = await createAutonomousRun({ id: 'running-run', goal: 'Running run' }, 200);
    await transitionAutonomousRun(running.id, 'running', null, 210);
    const lease = await upsertAutonomousTargetLease({
      id: 'lease-1',
      runId: running.id,
      tabId: 42,
      windowId: 7,
      origin: 'https://example.com',
    }, 220);
    await appendAutonomousEvidenceRecord(running.id, {
      id: 'evidence-1',
      leaseId: lease?.id,
      kind: 'browser_snapshot',
      refs: ['snapshot-private-ref'],
      summary: 'Authorization: Bearer secret-token',
      metadata: { url: 'https://example.com/private?token=secret' },
    }, 230);
    await appendAutonomousRunStep(running.id, {
      id: 'step-1',
      phase: 'verification',
      progressScore: 1,
      proofDelta: ['Verified'],
    }, 240);

    const snapshot = await getAutonomousRunCockpitSnapshot(250);

    expect(snapshot.status).toBe('running');
    expect(snapshot.totals).toMatchObject({ running: 1, blocked: 1 });
    expect(snapshot.activeRun).toMatchObject({
      id: running.id,
      status: 'running',
      stepCount: 1,
      evidenceCount: 1,
      targetLeaseCount: 1,
      latestStep: {
        id: 'step-1',
        phase: 'verification',
        status: 'succeeded',
      },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/snapshot-private-ref|Bearer|secret-token|private\?token/);
  });

  it('selects the newest terminal run when no active run exists', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'terminal' });

    const older = await createAutonomousRun({ id: 'older-run', goal: 'Older terminal' }, 100);
    await transitionAutonomousRun(older.id, 'running', null, 110);
    await transitionAutonomousRun(older.id, 'failed', {
      code: 'older_failed',
      message: 'Older run failed',
      phase: 'finish',
      retryable: false,
      at: 120,
    }, 120);

    const newer = await createAutonomousRun({ id: 'newer-run', goal: 'Newer terminal' }, 200);
    await transitionAutonomousRun(newer.id, 'running', null, 210);
    await transitionAutonomousRun(newer.id, 'succeeded', null, 220);

    const snapshot = await getAutonomousRunCockpitSnapshot(230);

    expect(snapshot.status).toBe('complete');
    expect(snapshot.activeRun).toMatchObject({
      id: newer.id,
      status: 'succeeded',
    });
  });

  it('builds cockpit snapshots from one ledger read', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'single-read' });

    const run = await createAutonomousRun({ id: 'single-read-run', goal: 'Single read' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousRunStep(run.id, { id: 'step-1', phase: 'plan' }, 120);
    await appendAutonomousEvidenceRecord(run.id, {
      id: 'evidence-1',
      kind: 'model_text',
      refs: ['evidence-1'],
    }, 130);

    chromeStub.storage.local.get.mockClear();

    const snapshot = await getAutonomousRunCockpitSnapshot(140);

    expect(chromeStub.storage.local.get).toHaveBeenCalledTimes(1);
    expect(snapshot.activeRun).toMatchObject({
      id: run.id,
      stepCount: 1,
      evidenceCount: 1,
    });
  });

  it('returns idle snapshot when no runs exist', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);

    await expect(getAutonomousRunCockpitSnapshot(100)).resolves.toMatchObject({
      schemaVersion: 1,
      generatedAt: 100,
      status: 'idle',
      activeRun: null,
      totals: {
        queued: 0,
        running: 0,
        paused: 0,
        blocked: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      },
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
