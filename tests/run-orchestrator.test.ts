import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAutonomousEvidenceRecord,
  appendAutonomousRunStep,
  createAutonomousRun,
  DEFAULT_AUTONOMOUS_RUN_POLICY,
  getAutonomousRunById,
  transitionAutonomousRun,
  upsertAutonomousTargetLease,
} from '../core/run/store';
import {
  executeAutonomousOrchestratorCycle,
  getAutonomousRunCockpitSnapshot,
  initializeAutonomousRunOrchestrator,
} from '../core/run/orchestrator';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('autonomous run orchestrator startup bridge', () => {
  it('selects the newest queued run and advances it through the worker cycle', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'queued-cycle' });

    await createAutonomousRun({
      id: 'older-queued',
      goal: 'Older queued',
      proofContract: createProofContract(),
    }, 100);
    const newer = await createAutonomousRun({
      id: 'newer-queued',
      goal: 'Newer queued',
      proofContract: createProofContract(),
    }, 200);

    const executor = vi.fn(async ({ runId, now: execNow }) => {
      await appendAutonomousRunStep(runId, {
        phase: 'model_turn',
        progressScore: 0,
      }, execNow);
    });

    const result = await executeAutonomousOrchestratorCycle(executor, { now: 300 });

    expect(result.selectedRunId).toBe(newer.id);
    expect(result.workerResult).toMatchObject({
      runId: newer.id,
      started: true,
      finalStatus: 'running',
      reviewSummary: {
        action: 'iterate',
        completionDecision: 'fail',
        grade: 'F',
        acceptedEvidenceCount: 0,
        errorCode: 'completion_review_fail',
      },
    });
    expect(executor).toHaveBeenCalledWith({ runId: newer.id, now: 300 });
    expect(executor).toHaveBeenCalledTimes(1);

    const final = await getAutonomousRunById(newer.id);
    expect(final?.status).toBe(result.workerResult?.finalStatus);
    expect(final?.updatedAt).toBe(300);
    expect(result.afterSnapshot.activeRun).toMatchObject({
      id: newer.id,
      status: final?.status,
      updatedAt: 300,
    });
    expect(result.afterSnapshot.generatedAt).toBe(300);
  });

  it('prioritizes a running run over a newer queued run', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'running-priority' });

    const running = await createAutonomousRun({
      id: 'running-priority',
      goal: 'Running priority',
      proofContract: createProofContract(),
    }, 100);
    await transitionAutonomousRun(running.id, 'running', null, 110);
    await createAutonomousRun({
      id: 'newer-queued',
      goal: 'Newer queued',
      proofContract: createProofContract(),
    }, 500);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 600 });

    expect(result.selectedRunId).toBe(running.id);
    expect(result.workerResult).toMatchObject({
      runId: running.id,
      started: false,
    });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('selects the newest updatedAt running run among multiple running runs', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'multi-running-select' });

    const older = await createAutonomousRun({
      id: 'older-running',
      goal: 'Older running',
      proofContract: createProofContract(),
    }, 100);
    await transitionAutonomousRun(older.id, 'running', null, 110);

    const newer = await createAutonomousRun({
      id: 'newer-running',
      goal: 'Newer running',
      proofContract: createProofContract(),
    }, 200);
    await transitionAutonomousRun(newer.id, 'running', null, 250);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 300 });

    expect(result.selectedRunId).toBe(newer.id);
    expect(result.workerResult).toMatchObject({
      runId: newer.id,
      started: false,
    });
    expect(executor).toHaveBeenCalledTimes(1);

    // adversarial result/state probe: selected result and durable agree
    const final = await getAutonomousRunById(newer.id);
    expect(final?.status).toBe(result.workerResult?.finalStatus ?? 'running');
    expect(result.afterSnapshot.activeRun).toMatchObject({
      id: newer.id,
      status: final?.status,
      updatedAt: 300,
    });
    // confirm the older running was not selected
    const olderFinal = await getAutonomousRunById(older.id);
    expect(olderFinal?.status).toBe('running');
    expect(result.selectedRunId).not.toBe(older.id);
  });

  it('forwards actionKind to the selected worker cycle', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'action-kind' });

    const run = await createAutonomousRun({
      id: 'manual-tool-run',
      goal: 'Manual tool action',
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, approvalMode: 'manual_all' },
      proofContract: createProofContract(),
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, {
      now: 120,
      actionKind: 'tool_call',
    });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.workerResult).toMatchObject({
      runId: run.id,
      action: 'block',
      policyDecision: 'manual_review',
      finalStatus: 'blocked',
      applied: false,
    });
    expect(executor).not.toHaveBeenCalled();
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: result.workerResult?.finalStatus,
      error: { code: result.workerResult?.errorCode },
    });
  });

  it('reconciles stale running runs before falling back to queued work', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'stale-fallback' });

    const stale = await createAutonomousRun({
      id: 'stale-running',
      goal: 'Stale running',
      proofContract: createProofContract(),
    }, 100);
    await transitionAutonomousRun(stale.id, 'running', null, 110);
    const queued = await createAutonomousRun({
      id: 'queued-after-stale',
      goal: 'Queued after stale',
      proofContract: createProofContract(),
    }, 500);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, {
      interruptedThresholdMs: 100,
      now: 1_000,
    });

    expect(result.reconciledInterruptedRuns).toBe(1);
    expect(result.beforeSnapshot.totals).toMatchObject({ blocked: 1, queued: 1, running: 0 });
    expect(result.selectedRunId).toBe(queued.id);
    expect(executor).toHaveBeenCalledTimes(1);
    await expect(getAutonomousRunById(stale.id)).resolves.toMatchObject({
      status: 'blocked',
      error: { code: 'autonomous_run_interrupted' },
    });
  });

  it('returns noop when no runnable run exists and does not resume paused or blocked runs', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'noop-cycle' });

    const paused = await createAutonomousRun({ id: 'paused-run', goal: 'Paused run' }, 100);
    await transitionAutonomousRun(paused.id, 'running', null, 110);
    await transitionAutonomousRun(paused.id, 'paused', null, 120);
    const blocked = await createAutonomousRun({ id: 'blocked-run', goal: 'Blocked run' }, 200);
    await transitionAutonomousRun(blocked.id, 'running', null, 210);
    await transitionAutonomousRun(blocked.id, 'blocked', {
      code: 'needs_review',
      message: 'Needs review',
      phase: 'review',
      retryable: true,
      at: 220,
    }, 220);
    const succeeded = await createAutonomousRun({ id: 'succeeded-run', goal: 'Succeeded run' }, 300);
    await transitionAutonomousRun(succeeded.id, 'running', null, 310);
    await transitionAutonomousRun(succeeded.id, 'succeeded', null, 320);
    const failed = await createAutonomousRun({ id: 'failed-run', goal: 'Failed run' }, 330);
    await transitionAutonomousRun(failed.id, 'running', null, 340);
    await transitionAutonomousRun(failed.id, 'failed', {
      code: 'failed_terminal',
      message: 'Terminal failure',
      phase: 'finish',
      retryable: false,
      at: 350,
    }, 350);
    const cancelled = await createAutonomousRun({ id: 'cancelled-run', goal: 'Cancelled run' }, 360);
    await transitionAutonomousRun(cancelled.id, 'running', null, 370);
    await transitionAutonomousRun(cancelled.id, 'cancelled', null, 380);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 400 });

    expect(result.selectedRunId).toBeNull();
    expect(result.workerResult).toBeNull();
    expect(executor).not.toHaveBeenCalled();
    await expect(getAutonomousRunById(paused.id)).resolves.toMatchObject({ status: 'paused' });
    await expect(getAutonomousRunById(blocked.id)).resolves.toMatchObject({ status: 'blocked' });
    await expect(getAutonomousRunById(failed.id)).resolves.toMatchObject({ status: 'failed' });
    await expect(getAutonomousRunById(cancelled.id)).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('keeps orchestrator cycle snapshots private', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'cycle-private' });

    const running = await createAutonomousRun({
      id: 'private-running',
      goal: 'Private running',
      proofContract: createProofContract(),
    }, 100);
    await transitionAutonomousRun(running.id, 'running', null, 110);
    const lease = await upsertAutonomousTargetLease({
      id: 'private-lease',
      runId: running.id,
      tabId: 42,
      windowId: 7,
      origin: 'https://example.com',
    }, 120);
    await appendAutonomousEvidenceRecord(running.id, {
      id: 'private-evidence',
      leaseId: lease?.id,
      kind: 'browser_snapshot',
      refs: ['snapshot-private-ref'],
      summary: 'Authorization: Bearer secret-token',
      metadata: { url: 'https://example.com/private?token=secret' },
    }, 130);

    const result = await executeAutonomousOrchestratorCycle(vi.fn(), { now: 140 });

    expect(result.selectedRunId).toBe(running.id);
    expect(JSON.stringify(result)).not.toMatch(/snapshot-private-ref|Bearer|secret-token|private\?token/);
  });

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
      id: 'expired-evidence',
      leaseId: lease?.id,
      kind: 'browser_snapshot',
      capturedAt: 100,
      ttlMs: 5,
      refs: ['expired-private-ref'],
      summary: 'Expired summary with expired-secret-token',
      metadata: { url: 'https://example.com/expired?token=secret' },
    }, 180);
    await appendAutonomousEvidenceRecord(running.id, {
      id: 'evidence-1',
      leaseId: lease?.id,
      kind: 'browser_snapshot',
      capturedAt: 6_200,
      ttlMs: 10_000,
      refs: ['snapshot-private-ref'],
      summary: 'Authorization: Bearer secret-token',
      metadata: { url: 'https://example.com/private?token=secret' },
    }, 6_200);
    await appendAutonomousRunStep(running.id, {
      id: 'step-1',
      phase: 'verification',
      progressScore: 1,
      proofDelta: ['Verified'],
    }, 6_240);

    const snapshot = await getAutonomousRunCockpitSnapshot(6_250);

    expect(snapshot.status).toBe('running');
    expect(snapshot.totals).toMatchObject({ running: 1, blocked: 1 });
    expect(snapshot.activeRun).toMatchObject({
      id: running.id,
      status: 'running',
      targetLeaseStatus: 'active',
      targetLeaseAgeMs: 6_030,
      targetLeaseExpiresInMs: 593_970,
      stepCount: 1,
      evidenceCount: 2,
      freshEvidenceCount: 1,
      staleEvidenceCount: 0,
      expiredEvidenceCount: 1,
      latestEvidenceAt: 6_200,
      targetLeaseCount: 1,
      latestStep: {
        id: 'step-1',
        phase: 'verification',
        status: 'succeeded',
      },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/snapshot-private-ref|expired-private-ref|Bearer|secret-token|private\?token|expired\?token/);
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

function createProofContract() {
  return {
    doneCriteria: ['operator cycle continues'],
    requiredEvidence: [],
    antiProof: [],
  };
}

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
