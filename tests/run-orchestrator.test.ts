import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAutonomousEvidenceRecord,
  appendAutonomousQualityGateRecord,
  appendAutonomousReviewLaneRecord,
  appendAutonomousRunStep,
  createAutonomousRun,
  DEFAULT_AUTONOMOUS_RUN_POLICY,
  getAutonomousRunById,
  transitionAutonomousRun,
  upsertAutonomousTargetLease,
} from '../core/run/store';
import {
  deriveAutonomousRunReviewLaneGate,
  evaluateAutonomousQualityGateRecord,
  evaluateAutonomousRunQualityGate,
  executeAutonomousOrchestratorCycle,
  getAutonomousRunCockpitSnapshot,
  initializeAutonomousRunOrchestrator,
} from '../core/run/orchestrator';
import type { AutonomousQualityGateRecord, AutonomousReviewLaneRecord } from '../core/run/types';

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
    expect(result.telemetryResult).toBeNull();
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
    expect(result.reviewLanePlan).toMatchObject({
      action: 'dispatch',
      selectedRoles: ['implementer'],
      canRunWorker: true,
      reason: 'dispatch_lanes',
    });
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

  it('passes review lane gate to the selected worker and blocks before executor work', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'orchestrator-review-gate' });

    const run = await createAutonomousRun({
      id: 'orchestrator-review-gate',
      goal: 'Blocked by review gate',
      proofContract: createProofContract(),
    }, 100);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, {
      now: 120,
      reviewLaneGate: {
        status: 'blocked',
        reason: 'p1',
        canProceed: false,
        blockingPriority: 'P1',
        blockingLaneCount: 1,
      },
    });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.workerResult).toMatchObject({
      runId: run.id,
      action: 'block',
      started: false,
      advanced: false,
      finalStatus: 'blocked',
      errorCode: 'autonomous_review_lane_gate_blocked',
    });
    expect(executor).not.toHaveBeenCalled();
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: result.workerResult?.finalStatus,
      error: { code: result.workerResult?.errorCode },
    });
    expect(result.afterSnapshot.activeRun).toMatchObject({
      id: run.id,
      status: 'blocked',
      errorCode: 'autonomous_review_lane_gate_blocked',
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
    expect(result.reviewLanePlan).toEqual({
      action: 'idle',
      selectedRoles: [],
      canRunWorker: false,
      reason: 'no_runnable_run',
      blockingPriority: null,
      blockingLaneCount: 0,
      maxParallel: 2,
    });
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

    const writes: Array<{ path: string; content: string }> = [];
    const result = await executeAutonomousOrchestratorCycle(vi.fn(), {
      now: 140,
      telemetry: {
        target: {
          writeTextFile(path, content) {
            writes.push({ path, content });
          },
        },
      },
    });

    expect(result.selectedRunId).toBe(running.id);
    expect(JSON.stringify(result)).not.toMatch(/snapshot-private-ref|Bearer|secret-token|private\?token/);
    expect(result.telemetryResult).toMatchObject({ status: 'written', runId: 'run-1' });
    expect(JSON.stringify(writes)).not.toMatch(/private-running|private-lease|private-evidence|snapshot-private-ref|Bearer|secret-token|private\?token/);
  });

  it('writes selected run telemetry after the worker cycle using post-cycle durable state', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'telemetry-cycle' });

    const run = await createAutonomousRun({
      id: 'telemetry-cycle',
      goal: 'Write telemetry',
      proofContract: createProofContract(),
    }, 100);
    await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: {
        complete: true,
        coveredCount: 4,
        gapCount: 0,
        conflictCount: 0,
        notTestableCount: 1,
      },
      resultStateConsistency: {
        status: 'consistent',
        ok: true,
        issueCount: 0,
        blockingIssueCount: 0,
      },
      selfReview: { grade: 'A' },
      verification: {
        commands: [
          { name: 'npm test token=secret', result: 'passed', summary: 'Bearer secret rawOutput' },
        ],
      },
      commit: { hash: 'abcdef1', message: 'Telemetry gate token=secret' },
      independentReview: {
        status: 'passed',
        grade: 'A',
        blockingIssueCount: 0,
      },
    }, 120);
    await appendAutonomousReviewLaneRecord(run.id, {
      role: 'grok',
      status: 'passed',
      grade: 'A',
      recommendation: 'proceed',
      highestPriority: null,
      issueCount: 0,
      evidenceRefCount: 1,
      summary: 'Grok transcript Bearer secret token=secret',
    }, 130);
    const writes: Array<{ path: string; content: string }> = [];
    const executor = vi.fn(async ({ runId, now: execNow }) => {
      await appendAutonomousRunStep(runId, {
        phase: 'model_turn',
        progressScore: 0.5,
        proofDelta: ['intermediate progress'],
      }, execNow);
    });

    const result = await executeAutonomousOrchestratorCycle(executor, {
      now: 300,
      telemetry: {
        target: {
          writeTextFile(path, content) {
            writes.push({ path, content });
          },
        },
        verification: [{ command: 'npm test -- tests/run-orchestrator.test.ts', exitCode: 0 }],
        commits: [{ sha: 'abc123', message: 'Telemetry cycle', linkedStepId: 'telemetry-cycle' }],
      },
    });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.telemetryResult).toMatchObject({
      status: 'written',
      runId: 'run-1',
      rootDir: '.runs/run-1',
      fileCount: 11,
      errorCode: null,
    });
    expect(writes.map((write) => write.path)).toEqual(result.telemetryResult?.paths);
    expect(writes[writes.length - 1].path).toBe('.runs/run-1/.complete.json');
    const final = await getAutonomousRunById(run.id);
    const manifest = readTelemetryJson(writes, 'manifest.json');
    const verification = readTelemetryJson(writes, 'verification.json');
    const qualityGates = readTelemetryNdjson(writes, 'quality-gates.ndjson');
    const reviewLanes = readTelemetryNdjson(writes, 'review-lanes.ndjson');
    expect(manifest.run).toMatchObject({
      id: 'run-1',
      status: final?.status,
      updatedAt: final?.updatedAt,
    });
    expect(manifest.counts).toMatchObject({
      qualityGates: 1,
      reviewLanes: 1,
    });
    expect(qualityGates).toEqual([
      expect.objectContaining({
        id: 'quality-gate-1',
        runId: 'run-1',
        status: 'passed',
        selfReviewGrade: 'A',
        verification: {
          commandCount: 1,
          passedCommandCount: 1,
          failedCommandCount: 0,
          knownPreexistingFailureCount: 0,
        },
        commitPresent: true,
        independentReview: {
          status: 'passed',
          grade: 'A',
          blockingIssueCount: 0,
        },
      }),
    ]);
    expect(reviewLanes).toEqual([
      expect.objectContaining({
        id: 'review-lane-1',
        runId: 'run-1',
        role: 'grok',
        status: 'passed',
        grade: 'A',
        recommendation: 'proceed',
        evidenceRefCount: 1,
        summaryPresent: true,
      }),
    ]);
    expect(verification.summary).toMatchObject({
      commandStatus: 'passed',
      durableStatus: final?.status,
    });
    expect(JSON.stringify(writes)).not.toMatch(/Bearer secret|token=secret|rawOutput|transcript/i);
    expect(result.afterSnapshot.activeRun).toMatchObject({
      id: run.id,
      status: final?.status,
    });
  });

  it('skips telemetry when no runnable run is selected', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'telemetry-skip' });

    const writes: string[] = [];
    const result = await executeAutonomousOrchestratorCycle(vi.fn(), {
      now: 100,
      telemetry: {
        target: {
          writeTextFile(path) {
            writes.push(path);
          },
        },
      },
    });

    expect(result.selectedRunId).toBeNull();
    expect(result.workerResult).toBeNull();
    expect(result.telemetryResult).toEqual({
      status: 'skipped',
      runId: null,
      rootDir: null,
      fileCount: 0,
      contentLength: 0,
      paths: [],
      errorCode: 'no_selected_run',
    });
    expect(writes).toEqual([]);
  });

  it('returns safe telemetry failure metadata without leaking writer errors', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'telemetry-failure' });

    const run = await createAutonomousRun({
      id: 'telemetry-failure',
      goal: 'Write telemetry failure',
      proofContract: createProofContract(),
    }, 100);
    const writes: string[] = [];

    const result = await executeAutonomousOrchestratorCycle(vi.fn(), {
      now: 120,
      telemetry: {
        target: {
          writeTextFile(path) {
            writes.push(path);
            if (path.endsWith('/checkpoint.json')) {
              throw new Error('Authorization: Bearer secret-token from writer');
            }
          },
        },
      },
    });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.telemetryResult).toEqual({
      status: 'failed',
      runId: 'run-1',
      rootDir: '.runs/run-1',
      fileCount: 0,
      contentLength: 0,
      paths: [],
      errorCode: 'telemetry_write_failed',
    });
    expect(JSON.stringify(result.telemetryResult)).not.toMatch(/Authorization|Bearer|secret-token/);
    expect(writes).toContain('.runs/run-1/manifest.json');
    expect(writes).toContain('.runs/run-1/checkpoint.json');
    expect(writes).not.toContain('.runs/run-1/.complete.json');
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: result.workerResult?.finalStatus,
    });
  });

  it('returns review lane hold plan without preventing worker progress', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'scheduler-hold' });

    const run = await createAutonomousRun({
      id: 'scheduler-hold',
      goal: 'Hold review lanes',
      proofContract: createProofContract(),
    }, 100);

    const executor = vi.fn(async ({ runId, now: execNow }) => {
      await appendAutonomousRunStep(runId, {
        phase: 'model_turn',
        progressScore: 0.1,
      }, execNow);
    });

    const result = await executeAutonomousOrchestratorCycle(executor, {
      now: 120,
      reviewLaneScheduler: {
        maxParallel: 1,
        lanes: [{ role: 'unknown-active-role', status: 'running' }],
        workerAdvanced: true,
        risk: { shell: true },
      },
    });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.reviewLanePlan).toMatchObject({
      action: 'hold',
      selectedRoles: [],
      canRunWorker: true,
      reason: 'at_capacity',
      maxParallel: 1,
    });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.workerResult).toMatchObject({
      runId: run.id,
      started: true,
      advanced: true,
    });
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: result.workerResult?.finalStatus,
    });
  });

  it('returns halt review lane plan and durable worker block on blocking gate', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'scheduler-halt' });

    const run = await createAutonomousRun({
      id: 'scheduler-halt',
      goal: 'Halt review lanes',
      proofContract: createProofContract(),
    }, 100);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, {
      now: 120,
      reviewLaneGate: {
        status: 'attention',
        reason: 'p2',
        canProceed: true,
        blockingPriority: null,
        blockingLaneCount: 1,
      },
      reviewLaneScheduler: {
        workerAdvanced: true,
        risk: { shell: true, browser: true, memory: true, ui: true },
        oracleRequested: true,
      },
    });

    expect(result.reviewLanePlan).toMatchObject({
      action: 'halt',
      selectedRoles: [],
      canRunWorker: false,
      reason: 'review_gate_p2',
      blockingPriority: 'P2',
      blockingLaneCount: 1,
    });
    expect(result.workerResult).toMatchObject({
      action: 'block',
      runId: run.id,
      started: false,
      advanced: false,
      finalStatus: 'blocked',
      errorCode: 'autonomous_review_lane_gate_blocked',
    });
    expect(executor).not.toHaveBeenCalled();
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: result.workerResult?.finalStatus,
      error: { code: result.workerResult?.errorCode },
    });
  });

  it('pure review lane gate derivation covers block, failed, active, and clear states', () => {
    expect(deriveAutonomousRunReviewLaneGate([
      createReviewLaneRecord({ recommendation: 'block', status: 'passed' }),
    ])).toMatchObject({
      status: 'blocked',
      reason: 'block_recommendation',
      canProceed: false,
      blockingPriority: null,
      blockingLaneCount: 1,
    });
    expect(deriveAutonomousRunReviewLaneGate([
      createReviewLaneRecord({ recommendation: 'unknown', status: 'failed' }),
    ])).toMatchObject({
      status: 'blocked',
      reason: 'failed_lane',
      canProceed: false,
      blockingPriority: null,
      blockingLaneCount: 1,
    });
    expect(deriveAutonomousRunReviewLaneGate([
      createReviewLaneRecord({ status: 'running' }),
    ])).toMatchObject({
      status: 'attention',
      reason: 'active_review',
      canProceed: true,
      blockingLaneCount: 0,
    });
    expect(deriveAutonomousRunReviewLaneGate([])).toMatchObject({
      status: 'clear',
      reason: 'none',
      canProceed: true,
      blockingLaneCount: 0,
    });
  });

  it('derives a blocking review lane gate from persisted P2 records', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'persisted-lane-p2' });

    const run = await createAutonomousRun({
      id: 'persisted-lane-p2',
      goal: 'Persisted lane P2 blocks',
      proofContract: createProofContract(),
    }, 100);
    await appendAutonomousReviewLaneRecord(run.id, {
      role: 'grok',
      status: 'passed',
      grade: 'B',
      recommendation: 'proceed',
      highestPriority: 'P2',
      issueCount: 1,
      evidenceRefCount: 1,
      summary: 'P2 reviewer issue must block.',
    }, 110);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 120 });

    expect(result.reviewLanePlan).toMatchObject({
      action: 'halt',
      selectedRoles: [],
      canRunWorker: false,
      reason: 'review_gate_p2',
      blockingPriority: 'P2',
      blockingLaneCount: 1,
    });
    expect(result.workerResult).toMatchObject({
      action: 'block',
      runId: run.id,
      started: false,
      advanced: false,
      finalStatus: 'blocked',
      errorCode: 'autonomous_review_lane_gate_blocked',
    });
    expect(executor).not.toHaveBeenCalled();
    expect(JSON.stringify(result.reviewLanePlan)).not.toMatch(/persisted-lane-p2|Persisted lane P2 blocks|P2 reviewer issue/);
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: 'blocked',
      error: { code: 'autonomous_review_lane_gate_blocked' },
    });
  });

  it('allows worker execution when persisted review lane records are non-blocking', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'persisted-lane-pass' });

    const run = await createAutonomousRun({
      id: 'persisted-lane-pass',
      goal: 'Persisted lane pass allows',
      proofContract: createProofContract(),
    }, 100);
    await appendAutonomousReviewLaneRecord(run.id, {
      role: 'reviewer',
      status: 'passed',
      grade: 'A',
      recommendation: 'proceed',
      highestPriority: null,
      issueCount: 0,
      evidenceRefCount: 1,
      summary: 'Clear reviewer lane.',
    }, 110);

    const executor = vi.fn(async ({ runId, now: execNow }) => {
      await appendAutonomousRunStep(runId, {
        phase: 'verification',
        progressScore: 1,
        proofDelta: ['operator cycle continues'],
      }, execNow);
    });
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 120 });

    expect(result.reviewLanePlan.canRunWorker).toBe(true);
    expect(result.reviewLanePlan.reason).not.toMatch(/review_gate/);
    expect(result.workerResult).toMatchObject({
      runId: run.id,
      started: true,
      advanced: true,
    });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('lets persisted P1 records dominate an explicit clear review lane gate', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'persisted-lane-p1' });

    const run = await createAutonomousRun({
      id: 'persisted-lane-p1',
      goal: 'Persisted lane P1 dominates',
      proofContract: createProofContract(),
    }, 100);
    await appendAutonomousReviewLaneRecord(run.id, {
      role: 'oracle',
      status: 'passed',
      grade: 'C',
      recommendation: 'iterate',
      highestPriority: 'P1',
      issueCount: 2,
      evidenceRefCount: 1,
      summary: 'P1 oracle issue must dominate clear gate.',
    }, 110);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, {
      now: 120,
      reviewLaneGate: {
        status: 'clear',
        reason: 'none',
        canProceed: true,
        blockingPriority: null,
        blockingLaneCount: 0,
      },
    });

    expect(result.reviewLanePlan).toMatchObject({
      action: 'halt',
      reason: 'review_gate_p1',
      blockingPriority: 'P1',
      blockingLaneCount: 1,
    });
    expect(result.workerResult).toMatchObject({
      action: 'block',
      errorCode: 'autonomous_review_lane_gate_blocked',
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it('returns grok review lane dispatch when requested and earlier lanes are complete', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'scheduler-grok' });

    const run = await createAutonomousRun({
      id: 'scheduler-grok',
      goal: 'Dispatch Grok lane',
      proofContract: createProofContract(),
    }, 100);

    const executor = vi.fn(async ({ runId, now: execNow }) => {
      await appendAutonomousRunStep(runId, {
        phase: 'model_turn',
        progressScore: 0.1,
      }, execNow);
    });
    const result = await executeAutonomousOrchestratorCycle(executor, {
      now: 120,
      reviewLaneScheduler: {
        maxParallel: 1,
        lanes: [
          { role: 'implementer', status: 'passed' },
          { role: 'reviewer', status: 'passed' },
          { role: 'safety', status: 'passed' },
          { role: 'ux', status: 'passed' },
          { role: 'oracle', status: 'passed' },
        ],
        grokRequested: true,
      },
    });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.reviewLanePlan).toMatchObject({
      action: 'dispatch',
      selectedRoles: ['grok'],
      canRunWorker: true,
      reason: 'dispatch_lanes',
      maxParallel: 1,
    });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.reviewLanePlan)).not.toMatch(/scheduler-grok|Dispatch Grok lane/);
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({
      status: result.workerResult?.finalStatus,
    });
  });

  it('keeps orchestrator review lane plan private', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'scheduler-private' });

    await createAutonomousRun({
      id: 'scheduler-private',
      goal: 'Private scheduler',
      proofContract: createProofContract(),
    }, 100);

    const result = await executeAutonomousOrchestratorCycle(vi.fn(), {
      now: 120,
      reviewLaneScheduler: {
        maxParallel: 1,
        lanes: [
          {
            role: 'SECRET_ROLE',
            status: 'running',
            transcript: 'SECRET_TRANSCRIPT',
            prompt: 'SECRET_PROMPT',
            url: 'https://secret.invalid/review',
          } as any,
        ],
        risk: {
          shell: true,
          rawCommand: 'rm -rf SECRET_PATH',
        } as any,
        oracleRequested: true,
      },
    });

    expect(result.reviewLanePlan).toMatchObject({
      action: 'hold',
      selectedRoles: [],
      canRunWorker: true,
      maxParallel: 1,
    });
    expect(JSON.stringify(result.reviewLanePlan)).not.toMatch(
      /SECRET_ROLE|SECRET_TRANSCRIPT|SECRET_PROMPT|secret\.invalid|SECRET_PATH/,
    );
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET_ROLE|SECRET_TRANSCRIPT|SECRET_PROMPT|secret\.invalid|SECRET_PATH/,
    );
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

describe('autonomous run orchestrator quality gate enforcement', () => {
  it('allows worker execution when no quality gate exists (first cycle compatibility)', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'no-gate-allow' });

    const run = await createAutonomousRun({
      id: 'no-gate-allow',
      goal: 'No quality gate',
      proofContract: { doneCriteria: ['test'], requiredEvidence: [], antiProof: [] },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 200 });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.qualityGateDecision).toEqual({
      blocked: false,
      reason: 'no_quality_gate',
      latestGateStatus: null,
      seq: null,
      coverageComplete: null,
      coveredCount: null,
      gapCount: null,
      conflictCount: null,
      notTestableCount: null,
      selfReviewGrade: null,
      verificationPassed: null,
    });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('allows worker execution when latest gate status is passed', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `gate-passed-${id += 1}` });

    const run = await createAutonomousRun({
      id: 'gate-passed-run',
      goal: 'Gate passed',
      proofContract: { doneCriteria: ['test'], requiredEvidence: [], antiProof: [] },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: { complete: true, coveredCount: 5, gapCount: 0, conflictCount: 0, notTestableCount: 0 },
      resultStateConsistency: { status: 'consistent', ok: true, issueCount: 0, blockingIssueCount: 0 },
      selfReview: { grade: 'A' },
      verification: { commands: [{ name: 'npm test', result: 'passed', summary: 'ok' }] },
      independentReview: { status: 'not_run', grade: null, blockingIssueCount: 0 },
    }, 120);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 200 });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.qualityGateDecision).toMatchObject({
      blocked: false,
      reason: 'gate_passed',
      latestGateStatus: 'passed',
      seq: 1,
    });
    expect(result.qualityGateDecision?.coverageComplete).toBe(true);
    expect(result.qualityGateDecision?.selfReviewGrade).toBe('A');
    expect(result.qualityGateDecision?.verificationPassed).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('allows worker execution with warning metadata when latest gate status is warning', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `gate-warn-${id += 1}` });

    const run = await createAutonomousRun({
      id: 'gate-warning-run',
      goal: 'Gate warning',
      proofContract: { doneCriteria: ['test'], requiredEvidence: [], antiProof: [] },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 105);
    await appendAutonomousQualityGateRecord(run.id, {
      status: 'warning',
      contractCoverage: { complete: true, coveredCount: 4, gapCount: 0, conflictCount: 0, notTestableCount: 0 },
      resultStateConsistency: { status: 'consistent', ok: true, issueCount: 0, blockingIssueCount: 0 },
      selfReview: { grade: 'B' },
      verification: { commands: [{ name: 'npm test', result: 'passed', summary: 'ok' }] },
      independentReview: { status: 'not_run', grade: null, blockingIssueCount: 0 },
    }, 120);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 200 });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.qualityGateDecision).toMatchObject({
      blocked: false,
      reason: 'gate_warning',
      latestGateStatus: 'warning',
      seq: 1,
      selfReviewGrade: 'B',
    });
    expect(result.workerResult).toBeTruthy();
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('blocks worker execution when latest gate status is failed', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `gate-fail-${id += 1}` });

    const run = await createAutonomousRun({
      id: 'gate-failed-run',
      goal: 'Gate failed',
      proofContract: { doneCriteria: ['test'], requiredEvidence: [], antiProof: [] },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousQualityGateRecord(run.id, {
      status: 'failed',
      contractCoverage: { complete: true, coveredCount: 3, gapCount: 0, conflictCount: 0, notTestableCount: 0 },
      resultStateConsistency: { status: 'consistent', ok: true, issueCount: 0, blockingIssueCount: 0 },
      selfReview: { grade: 'C' },
      verification: { commands: [] },
      independentReview: { status: 'not_run', grade: null, blockingIssueCount: 0 },
    }, 120);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 200 });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.qualityGateDecision).toMatchObject({
      blocked: true,
      reason: 'gate_failed',
      latestGateStatus: 'failed',
      seq: 1,
    });
    expect(result.workerResult).toBeNull();
    expect(executor).not.toHaveBeenCalled();

    // Non-mutating hold: durable status unchanged
    const durable = await getAutonomousRunById(run.id);
    expect(durable?.status).toBe('running');
  });

  it('blocks worker execution when latest gate status is blocked', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `gate-blocked-${id += 1}` });

    const run = await createAutonomousRun({
      id: 'gate-blocked-run',
      goal: 'Gate blocked',
      proofContract: { doneCriteria: ['test'], requiredEvidence: [], antiProof: [] },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousQualityGateRecord(run.id, {
      status: 'blocked',
      contractCoverage: { complete: false, coveredCount: 0, gapCount: 1, conflictCount: 0, notTestableCount: 0 },
      resultStateConsistency: { status: 'consistent', ok: true, issueCount: 0, blockingIssueCount: 0 },
      selfReview: { grade: 'D' },
      verification: { commands: [] },
      independentReview: { status: 'not_run', grade: null, blockingIssueCount: 0 },
    }, 120);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 200 });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.qualityGateDecision).toMatchObject({
      blocked: true,
      reason: 'gate_blocked',
      latestGateStatus: 'blocked',
      seq: 1,
    });
    expect(result.workerResult).toBeNull();
    expect(executor).not.toHaveBeenCalled();
  });

  it('blocks on deep check: independentReview status failed even when top-level is passed', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `deep-irev-${id += 1}` });

    const run = await createAutonomousRun({
      id: 'deep-irev-run',
      goal: 'Deep independent review',
      proofContract: { doneCriteria: ['test'], requiredEvidence: [], antiProof: [] },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: { complete: true, coveredCount: 5, gapCount: 0, conflictCount: 0, notTestableCount: 0 },
      resultStateConsistency: { status: 'consistent', ok: true, issueCount: 0, blockingIssueCount: 0 },
      selfReview: { grade: 'A' },
      verification: { commands: [] },
      independentReview: { status: 'failed', grade: 'D', blockingIssueCount: 0 },
    }, 120);

    // Store normalizes: independentReview.status='failed' → status becomes 'failed'
    // (blockingIssueCount=0 so it does not escalate to 'blocked')
    expect(gate?.status).toBe('failed');

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 200 });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.qualityGateDecision).toMatchObject({
      blocked: true,
      latestGateStatus: 'failed',
    });
    expect(result.workerResult).toBeNull();
    expect(executor).not.toHaveBeenCalled();
  });

  it('blocks on deep check: independentReview status blocked even when top-level is warning', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `deep-irev-blocked-${id += 1}` });

    const run = await createAutonomousRun({
      id: 'deep-irev-blocked',
      goal: 'Deep independent review blocked',
      proofContract: { doneCriteria: ['test'], requiredEvidence: [], antiProof: [] },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'warning',
      contractCoverage: { complete: true, coveredCount: 4, gapCount: 0, conflictCount: 0, notTestableCount: 0 },
      resultStateConsistency: { status: 'consistent', ok: true, issueCount: 0, blockingIssueCount: 0 },
      selfReview: { grade: 'B' },
      verification: { commands: [] },
      independentReview: { status: 'blocked', grade: 'F', blockingIssueCount: 1 },
    }, 120);

    // Store normalizes: independentReview.status='blocked' → status becomes 'blocked'
    expect(gate?.status).toBe('blocked');

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 200 });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.qualityGateDecision?.blocked).toBe(true);
    expect(result.qualityGateDecision?.latestGateStatus).toBe('blocked');
    expect(result.workerResult).toBeNull();
    expect(executor).not.toHaveBeenCalled();
  });

  it('blocks on deep check: independentReview blockingIssueCount > 0', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `deep-block-ct-${id += 1}` });

    const run = await createAutonomousRun({
      id: 'deep-block-ct',
      goal: 'Deep blocking issue count',
      proofContract: { doneCriteria: ['test'], requiredEvidence: [], antiProof: [] },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: { complete: true, coveredCount: 3, gapCount: 0, conflictCount: 0, notTestableCount: 0 },
      resultStateConsistency: { status: 'consistent', ok: true, issueCount: 0, blockingIssueCount: 0 },
      selfReview: { grade: 'A' },
      verification: { commands: [] },
      independentReview: { status: 'passed', grade: 'A', blockingIssueCount: 2 },
    }, 120);

    // Store normalizes: independentReview.blockingIssueCount > 0 → status becomes 'blocked'
    expect(gate?.status).toBe('blocked');

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 200 });

    expect(result.qualityGateDecision?.blocked).toBe(true);
    expect(result.qualityGateDecision?.latestGateStatus).toBe('blocked');
    expect(result.workerResult).toBeNull();
    expect(executor).not.toHaveBeenCalled();
  });

  it('blocks on deep check: resultStateConsistency status inconsistent', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `deep-inconsistent-${id += 1}` });

    const run = await createAutonomousRun({
      id: 'deep-inconsistent',
      goal: 'Deep inconsistent state',
      proofContract: { doneCriteria: ['test'], requiredEvidence: [], antiProof: [] },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: { complete: true, coveredCount: 3, gapCount: 0, conflictCount: 0, notTestableCount: 0 },
      resultStateConsistency: { status: 'inconsistent', ok: false, issueCount: 2, blockingIssueCount: 1 },
      selfReview: { grade: 'A' },
      verification: { commands: [] },
      independentReview: { status: 'not_run', grade: null, blockingIssueCount: 0 },
    }, 120);

    // Store normalizes: resultStateConsistency.status='inconsistent' → status becomes 'failed'
    expect(gate?.status).toBe('failed');

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 200 });

    expect(result.qualityGateDecision?.blocked).toBe(true);
    expect(result.qualityGateDecision?.latestGateStatus).toBe('failed');
    expect(result.qualityGateDecision?.reason).toBe('gate_failed');
    expect(result.workerResult).toBeNull();
    expect(executor).not.toHaveBeenCalled();
  });

  it('blocks on deep check: resultStateConsistency blockingIssueCount > 0', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `deep-block-iss-${id += 1}` });

    const run = await createAutonomousRun({
      id: 'deep-block-iss',
      goal: 'Deep blocking issues state',
      proofContract: { doneCriteria: ['test'], requiredEvidence: [], antiProof: [] },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'warning',
      contractCoverage: { complete: true, coveredCount: 4, gapCount: 0, conflictCount: 0, notTestableCount: 0 },
      resultStateConsistency: { status: 'consistent', ok: true, issueCount: 3, blockingIssueCount: 1 },
      selfReview: { grade: 'B' },
      verification: { commands: [] },
      independentReview: { status: 'not_run', grade: null, blockingIssueCount: 0 },
    }, 120);

    // Store normalizes: resultStateConsistency.blockingIssueCount > 0 → status becomes 'failed'
    expect(gate?.status).toBe('failed');

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 200 });

    expect(result.qualityGateDecision?.blocked).toBe(true);
    expect(result.qualityGateDecision?.latestGateStatus).toBe('failed');
    expect(result.qualityGateDecision?.reason).toBe('gate_failed');
    expect(result.workerResult).toBeNull();
    expect(executor).not.toHaveBeenCalled();
  });

  it('blocks on deep check: contractCoverage conflictCount > 0', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `deep-conflict-${id += 1}` });

    const run = await createAutonomousRun({
      id: 'deep-conflict',
      goal: 'Deep contract conflicts',
      proofContract: { doneCriteria: ['test'], requiredEvidence: [], antiProof: [] },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: { complete: false, coveredCount: 3, gapCount: 0, conflictCount: 2, notTestableCount: 0 },
      resultStateConsistency: { status: 'consistent', ok: true, issueCount: 0, blockingIssueCount: 0 },
      selfReview: { grade: 'A' },
      verification: { commands: [] },
      independentReview: { status: 'passed', grade: 'A', blockingIssueCount: 0 },
    }, 120);

    // Store normalizes: contractCoverage.conflictCount > 0 → status becomes 'failed'
    expect(gate?.status).toBe('failed');

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 200 });

    expect(result.qualityGateDecision?.blocked).toBe(true);
    expect(result.qualityGateDecision?.latestGateStatus).toBe('failed');
    expect(result.qualityGateDecision?.reason).toBe('gate_failed');
    expect(result.qualityGateDecision?.conflictCount).toBe(2);
    expect(result.workerResult).toBeNull();
    expect(executor).not.toHaveBeenCalled();
  });

  it('pure evaluator blocks permissive top-level gates with deep blocking conditions', () => {
    const cases: Array<{
      name: string;
      gate: AutonomousQualityGateRecord;
      reason: NonNullable<ReturnType<typeof evaluateAutonomousQualityGateRecord>['reason']>;
    }> = [
      {
        name: 'failed independent review',
        gate: createQualityGateRecord({
          status: 'passed',
          independentReview: { status: 'failed', grade: 'D', blockingIssueCount: 0 },
        }),
        reason: 'review_issues',
      },
      {
        name: 'blocked independent review',
        gate: createQualityGateRecord({
          status: 'warning',
          independentReview: { status: 'blocked', grade: 'F', blockingIssueCount: 0 },
        }),
        reason: 'review_issues',
      },
      {
        name: 'independent review blocking issue count',
        gate: createQualityGateRecord({
          status: 'passed',
          independentReview: { status: 'passed', grade: 'A', blockingIssueCount: 1 },
        }),
        reason: 'review_issues',
      },
      {
        name: 'inconsistent result state',
        gate: createQualityGateRecord({
          status: 'passed',
          resultStateConsistency: { status: 'inconsistent', ok: false, issueCount: 1, blockingIssueCount: 0 },
        }),
        reason: 'state_inconsistent',
      },
      {
        name: 'result state blocking issue count',
        gate: createQualityGateRecord({
          status: 'warning',
          resultStateConsistency: { status: 'consistent', ok: true, issueCount: 1, blockingIssueCount: 1 },
        }),
        reason: 'state_inconsistent',
      },
      {
        name: 'contract conflict count',
        gate: createQualityGateRecord({
          status: 'passed',
          contractCoverage: { complete: true, coveredCount: 4, gapCount: 0, conflictCount: 1, notTestableCount: 0 },
        }),
        reason: 'contract_conflicts',
      },
    ];

    for (const item of cases) {
      const decision = evaluateAutonomousQualityGateRecord(item.gate);

      expect(decision, item.name).toMatchObject({
        blocked: true,
        reason: item.reason,
        latestGateStatus: item.gate.status,
      });
    }
  });

  it('returns null qualityGateDecision when no selected run exists', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 100 });

    expect(result.selectedRunId).toBeNull();
    expect(result.qualityGateDecision).toBeNull();
    expect(result.workerResult).toBeNull();
    expect(executor).not.toHaveBeenCalled();
  });

  it('adversarial probe: result object and durable state agree when gate blocks (non-mutating hold)', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `adversarial-${id += 1}` });

    const run = await createAutonomousRun({
      id: 'adversarial-blocked',
      goal: 'Adversarial quality gate',
      proofContract: { doneCriteria: ['test'], requiredEvidence: [], antiProof: [] },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousQualityGateRecord(run.id, {
      status: 'failed',
      contractCoverage: { complete: true, coveredCount: 3, gapCount: 0, conflictCount: 0, notTestableCount: 0 },
      resultStateConsistency: { status: 'consistent', ok: true, issueCount: 0, blockingIssueCount: 0 },
      selfReview: { grade: 'D' },
      verification: { commands: [] },
      independentReview: { status: 'not_run', grade: null, blockingIssueCount: 0 },
    }, 120);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 200 });

    // Decision says blocked
    expect(result.qualityGateDecision).not.toBeNull();
    expect(result.qualityGateDecision!.blocked).toBe(true);
    expect(result.qualityGateDecision!.reason).toBe('gate_failed');

    // Worker not called, result null
    expect(result.workerResult).toBeNull();
    expect(executor).not.toHaveBeenCalled();

    // Durable state remains unadvanced (non-mutating hold)
    const durable = await getAutonomousRunById(run.id);
    expect(durable?.status).toBe('running');
    // updatedAt was bumped to 120 by the quality-gate append, not by the cycle (200)
    expect(durable?.updatedAt).toBe(120);

    // afterSnapshot does not show status change from the block
    expect(result.afterSnapshot.activeRun).toMatchObject({
      id: run.id,
      status: 'running',
    });
  });

  it('privacy probe: quality gate decision exposes only safe aggregate metadata', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `privacy-${id += 1}` });

    const run = await createAutonomousRun({
      id: 'privacy-gate-run',
      goal: 'Privacy gate',
      proofContract: { doneCriteria: ['test'], requiredEvidence: [], antiProof: [] },
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    // Inject a gate with fields that could leak sensitive data
    await appendAutonomousQualityGateRecord(run.id, {
      status: 'failed',
      contractCoverage: { complete: false, coveredCount: 2, gapCount: 1, conflictCount: 0, notTestableCount: 0 },
      resultStateConsistency: { status: 'consistent', ok: true, issueCount: 0, blockingIssueCount: 0 },
      selfReview: { grade: 'F' },
      verification: {
        commands: [
          { name: 'SECRET_COMMAND', result: 'failed', summary: 'SECRET_SUMMARY' },
        ],
      },
      independentReview: { status: 'failed', grade: 'F', blockingIssueCount: 1 },
    }, 120);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, { now: 200 });

    // The decision must not leak raw command names, summaries, commit data, gate ids, or reviewer prose
    const json = JSON.stringify(result.qualityGateDecision);
    expect(json).not.toMatch(/SECRET_COMMAND|SECRET_SUMMARY/);
    expect(json).not.toMatch(/privacy-gate-/); // run id
    expect(json).not.toMatch(/raw-phrase|secret-token|Bearer/);
  });
});

function createQualityGateRecord(
  overrides: Partial<AutonomousQualityGateRecord> = {},
): AutonomousQualityGateRecord {
  return {
    id: 'gate-1',
    runId: 'run-1',
    seq: 1,
    createdAt: 100,
    status: 'passed',
    contractCoverage: {
      complete: true,
      coveredCount: 3,
      gapCount: 0,
      conflictCount: 0,
      notTestableCount: 0,
    },
    resultStateConsistency: {
      status: 'consistent',
      ok: true,
      issueCount: 0,
      blockingIssueCount: 0,
    },
    selfReview: { grade: 'A' },
    verification: { commands: [] },
    commit: null,
    independentReview: {
      status: 'passed',
      grade: 'A',
      blockingIssueCount: 0,
    },
    ...overrides,
  };
}

function createProofContract() {
  return {
    doneCriteria: ['operator cycle continues'],
    requiredEvidence: [],
    antiProof: [],
  };
}

function createReviewLaneRecord(
  overrides: Partial<AutonomousReviewLaneRecord> = {},
): AutonomousReviewLaneRecord {
  return {
    id: 'lane-test',
    runId: 'run-test',
    seq: 1,
    createdAt: 100,
    role: 'reviewer',
    status: 'passed',
    grade: 'A',
    recommendation: 'proceed',
    highestPriority: null,
    issueCount: 0,
    evidenceRefCount: 0,
    summary: null,
    ...overrides,
  };
}

function readTelemetryJson(writes: Array<{ path: string; content: string }>, name: string): any {
  const write = writes.find((item) => item.path.endsWith(`/${name}`));
  expect(write).toBeDefined();
  return JSON.parse(write?.content ?? '{}');
}

function readTelemetryNdjson(writes: Array<{ path: string; content: string }>, name: string): any[] {
  const write = writes.find((item) => item.path.endsWith(`/${name}`));
  expect(write).toBeDefined();
  const content = write?.content.trim() ?? '';
  return content ? content.split('\n').map((line) => JSON.parse(line)) : [];
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
