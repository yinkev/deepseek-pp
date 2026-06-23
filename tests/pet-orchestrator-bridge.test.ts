import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  createPetHandoffCapsule,
  createPetControlSnapshotFromRunCockpit,
  mergePetReviewLanesIntoSnapshot,
  type PetControlSnapshot,
} from '../core/pet/control';
import {
  createPetOrchestratorReviewLaneOptions,
  mergeAutonomousOrchestratorCycleResultIntoSnapshot,
  mergeAutonomousReviewLanePlanIntoSnapshot,
} from '../core/pet/orchestrator-bridge';
import {
  createAutonomousRun,
  getAutonomousRunById,
} from '../core/run/store';
import {
  executeAutonomousOrchestratorCycle,
  type AutonomousRunCockpitSnapshot,
  type AutonomousRunOrchestratorCycleResult,
} from '../core/run/orchestrator';
import type { AutonomousRunCycleResult } from '../core/run/worker';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pet to orchestrator review lane bridge', () => {
  it('maps a default pet snapshot to clear review lane orchestrator options', () => {
    const snapshot = createBasePetSnapshot();
    const options = createPetOrchestratorReviewLaneOptions(snapshot);

    expect(options).toEqual({
      reviewLaneGate: {
        status: 'clear',
        reason: 'none',
        canProceed: true,
        blockingPriority: null,
        blockingLaneCount: 0,
      },
      reviewLaneScheduler: {
        lanes: [],
        maxParallel: null,
        workerAdvanced: false,
        workerApplied: false,
        risk: {
          shell: false,
          browser: false,
          memory: false,
          ui: false,
        },
        oracleRequested: false,
        grokRequested: false,
      },
    });
  });

  it('projects sanitized pet review lanes, worker pulse, risk, and advisor requests', () => {
    const snapshot = mergePetReviewLanesIntoSnapshot(createBasePetSnapshot({
      workerCycle: { advanced: true, applied: true },
      memoryPressure: { enabled: true, level: 'high', truncated: true },
      safety: { highRiskArmed: true },
    }), [
      { role: 'implementer', status: 'passed', recommendation: 'proceed', highestPriority: null, issueCount: 0 },
      { role: 'reviewer', status: 'running', recommendation: 'iterate', highestPriority: 'P2', issueCount: 2 },
    ]);

    const options = createPetOrchestratorReviewLaneOptions(snapshot, {
      maxParallel: 3,
      risk: { shell: true, ui: true },
      oracleRequested: true,
      grokRequested: true,
    });

    expect(options.reviewLaneGate).toEqual({
      status: 'blocked',
      reason: 'p2',
      canProceed: false,
      blockingPriority: 'P2',
      blockingLaneCount: 1,
    });
    expect(options.reviewLaneScheduler).toEqual({
      lanes: [
        { role: 'implementer', status: 'passed' },
        { role: 'reviewer', status: 'running' },
      ],
      maxParallel: 3,
      workerAdvanced: true,
      workerApplied: true,
      risk: {
        shell: true,
        browser: true,
        memory: true,
        ui: true,
      },
      oracleRequested: true,
      grokRequested: true,
    });
  });

  it('re-derives the gate from sanitized summaries instead of trusting forged snapshot gate fields', () => {
    const forged = {
      ...createBasePetSnapshot(),
      reviewLaneGate: {
        status: 'blocked',
        reason: 'p1',
        canProceed: false,
        blockingPriority: 'P1',
        blockingLaneCount: 99,
        rawSecret: 'SECRET_GATE',
      },
      reviewLanes: {
        ...createBasePetSnapshot().reviewLanes,
        lanes: [
          {
            role: 'reviewer',
            status: 'passed',
            recommendation: 'proceed',
            highestPriority: null,
            issueCount: 0,
            message: 'SECRET_LANE_MESSAGE',
          },
        ],
      },
    } as unknown as PetControlSnapshot & Record<string, unknown>;

    const options = createPetOrchestratorReviewLaneOptions(forged);

    expect(options.reviewLaneGate).toEqual({
      status: 'clear',
      reason: 'none',
      canProceed: true,
      blockingPriority: null,
      blockingLaneCount: 0,
    });
    expect(JSON.stringify(options)).not.toMatch(/SECRET_GATE|SECRET_LANE_MESSAGE/);
  });

  it('derives blocking gate from lanes beyond scheduler output cap', () => {
    const snapshot = {
      ...createBasePetSnapshot(),
      reviewLanes: {
        ...createBasePetSnapshot().reviewLanes,
        lanes: [
          { role: 'implementer', status: 'passed', recommendation: 'proceed', highestPriority: null, issueCount: 0 },
          { role: 'reviewer', status: 'passed', recommendation: 'proceed', highestPriority: null, issueCount: 0 },
          { role: 'safety', status: 'passed', recommendation: 'proceed', highestPriority: null, issueCount: 0 },
          { role: 'ux', status: 'passed', recommendation: 'proceed', highestPriority: null, issueCount: 0 },
          {
            role: 'grok',
            status: 'blocked',
            recommendation: 'iterate',
            highestPriority: 'P1',
            issueCount: 1,
            transcript: 'SECRET_FIFTH_LANE',
          },
        ],
      },
    } as unknown as PetControlSnapshot;

    const options = createPetOrchestratorReviewLaneOptions(snapshot);

    expect(options.reviewLaneGate).toEqual({
      status: 'blocked',
      reason: 'p1',
      canProceed: false,
      blockingPriority: 'P1',
      blockingLaneCount: 1,
    });
    expect(options.reviewLaneScheduler?.lanes).toEqual([
      { role: 'implementer', status: 'passed' },
      { role: 'reviewer', status: 'passed' },
      { role: 'safety', status: 'passed' },
      { role: 'ux', status: 'passed' },
    ]);
    expect(JSON.stringify(options)).not.toMatch(/SECRET_FIFTH_LANE/);
  });

  it('feeds pet-derived blocking gate into orchestrator and durable worker block', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'pet-bridge-block' });

    const run = await createAutonomousRun({
      id: 'pet-bridge-block',
      goal: 'Pet bridge block',
      proofContract: {
        doneCriteria: ['blocked by review'],
        requiredEvidence: [],
        antiProof: [],
      },
    }, 100);
    const snapshot = mergePetReviewLanesIntoSnapshot(createBasePetSnapshot(), [
      { role: 'safety', status: 'passed', recommendation: 'iterate', highestPriority: 'P2', issueCount: 1 },
    ]);

    const executor = vi.fn();
    const result = await executeAutonomousOrchestratorCycle(executor, {
      now: 120,
      ...createPetOrchestratorReviewLaneOptions(snapshot),
    });

    expect(result.selectedRunId).toBe(run.id);
    expect(result.reviewLanePlan).toMatchObject({
      action: 'halt',
      selectedRoles: [],
      canRunWorker: false,
      blockingPriority: 'P2',
      blockingLaneCount: 1,
    });
    expect(result.workerResult).toMatchObject({
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
  });

  it('keeps raw pet snapshot fields out of bridged orchestrator options', () => {
    const snapshot = {
      ...createBasePetSnapshot({
        memoryPressure: { enabled: true, level: 'medium', truncated: false },
      }),
      reviewLanes: {
        ...createBasePetSnapshot().reviewLanes,
        lanes: [
          {
            role: 'SECRET_ROLE',
            status: 'running',
            recommendation: 'block',
            highestPriority: 'P1',
            issueCount: 2,
            label: 'SECRET_LABEL',
            transcript: 'SECRET_TRANSCRIPT',
            url: 'https://secret.invalid/pet',
          },
        ],
      },
      rawMessage: 'SECRET_MESSAGE',
    } as unknown as PetControlSnapshot & Record<string, unknown>;

    expect(JSON.stringify(snapshot)).toMatch(/SECRET_ROLE|SECRET_LABEL|SECRET_TRANSCRIPT|secret\.invalid|SECRET_MESSAGE/);
    const options = createPetOrchestratorReviewLaneOptions(snapshot);

    expect(options.reviewLaneScheduler?.lanes).toEqual([{ role: 'other', status: 'running' }]);
    expect(options.reviewLaneScheduler?.risk?.memory).toBe(true);
    expect(options.reviewLaneGate).toMatchObject({
      status: 'blocked',
      reason: 'p1',
      blockingPriority: 'P1',
    });
    expect(JSON.stringify(options)).not.toMatch(
      /SECRET_ROLE|SECRET_LABEL|SECRET_TRANSCRIPT|secret\.invalid|SECRET_MESSAGE/,
    );
  });

  it('returns the original snapshot when orchestrator cycle result is unavailable', () => {
    const snapshot = createBasePetSnapshot();

    expect(mergeAutonomousOrchestratorCycleResultIntoSnapshot(snapshot, null)).toBe(snapshot);
    expect(mergeAutonomousOrchestratorCycleResultIntoSnapshot(snapshot, undefined)).toBe(snapshot);
  });

  it('projects blocking orchestrator review lane plans into pet snapshot and handoff fields', () => {
    const snapshot = createBasePetSnapshot();
    const result = createOrchestratorResult({
      selectedRunId: 'SECRET_SELECTED_RUN',
      reviewLanePlan: {
        action: 'halt',
        selectedRoles: [],
        canRunWorker: false,
        reason: 'review_gate_p2',
        blockingPriority: 'P2',
        blockingLaneCount: 2,
        maxParallel: 2,
      },
      workerResult: createWorkerResult({
        action: 'block',
        runId: 'SECRET_WORKER_RUN',
        started: false,
        advanced: false,
        applied: false,
        finalStatus: 'blocked',
        errorCode: 'autonomous_review_lane_gate_blocked',
      }),
    });

    const merged = mergeAutonomousOrchestratorCycleResultIntoSnapshot(snapshot, result);
    const capsule = createPetHandoffCapsule(merged);

    expect(merged.reviewLanes).toMatchObject({
      total: 2,
      blockedCount: 2,
      blockCount: 2,
      highestPriority: 'P2',
    });
    expect(merged.reviewLanes.lanes).toEqual([
      {
        role: 'other',
        status: 'blocked',
        grade: null,
        recommendation: 'block',
        highestPriority: 'P2',
        issueCount: 0,
        updatedAt: null,
      },
      {
        role: 'other',
        status: 'blocked',
        grade: null,
        recommendation: 'block',
        highestPriority: 'P2',
        issueCount: 0,
        updatedAt: null,
      },
    ]);
    expect(merged.reviewLaneGate).toEqual({
      status: 'blocked',
      reason: 'p2',
      canProceed: false,
      blockingPriority: 'P2',
      blockingLaneCount: 2,
    });
    expect(capsule.reviewLaneGateStatus).toBe(merged.reviewLaneGate.status);
    expect(capsule.reviewLaneGateReason).toBe(merged.reviewLaneGate.reason);
    expect(capsule.reviewLaneGateCanProceed).toBe(false);
    expect(capsule.reviewLaneGateBlockingPriority).toBe('P2');
    expect(capsule.reviewLaneGateBlockingLaneCount).toBe(2);
    expect(JSON.stringify(merged)).not.toMatch(/SECRET_SELECTED_RUN|SECRET_WORKER_RUN/);
    expect(JSON.stringify(capsule)).not.toMatch(/SECRET_SELECTED_RUN|SECRET_WORKER_RUN/);
  });

  it('projects dispatch review lane plans as safe planned lane summaries', () => {
    const snapshot = createBasePetSnapshot();
    const merged = mergeAutonomousReviewLanePlanIntoSnapshot(snapshot, {
      action: 'dispatch',
      selectedRoles: ['oracle', 'grok'],
      canRunWorker: true,
      reason: 'dispatch_lanes',
      blockingPriority: null,
      blockingLaneCount: 0,
      maxParallel: 2,
    });

    expect(merged.reviewLanes).toMatchObject({
      total: 2,
      activeCount: 0,
      unknownCount: 2,
      highestPriority: null,
    });
    expect(merged.reviewLanes.lanes).toEqual([
      {
        role: 'oracle',
        status: 'idle',
        grade: null,
        recommendation: 'unknown',
        highestPriority: null,
        issueCount: 0,
        updatedAt: null,
      },
      {
        role: 'grok',
        status: 'idle',
        grade: null,
        recommendation: 'unknown',
        highestPriority: null,
        issueCount: 0,
        updatedAt: null,
      },
    ]);
    expect(merged.reviewLaneGate).toEqual({
      status: 'clear',
      reason: 'none',
      canProceed: true,
      blockingPriority: null,
      blockingLaneCount: 0,
    });
  });

  it('keeps raw and malformed orchestrator review lane plan fields out of pet projection', () => {
    const snapshot = createBasePetSnapshot();
    const plan = {
      action: 'halt',
      selectedRoles: ['SECRET_ROLE'],
      canRunWorker: false,
      reason: 'SECRET_REASON',
      blockingPriority: 'PX',
      blockingLaneCount: Number.POSITIVE_INFINITY,
      maxParallel: 999,
      rawPrompt: 'SECRET_PROMPT',
      transcript: 'SECRET_TRANSCRIPT',
      url: 'https://secret.invalid/review?token=secret',
    } as any;
    expect(JSON.stringify(plan)).toMatch(/SECRET_ROLE|SECRET_REASON|SECRET_PROMPT|SECRET_TRANSCRIPT|secret\.invalid|token=secret/);

    const merged = mergeAutonomousReviewLanePlanIntoSnapshot(snapshot, plan);
    const capsule = createPetHandoffCapsule(merged);

    expect(merged.reviewLanes).toMatchObject({
      total: 1,
      blockedCount: 1,
      blockCount: 1,
      highestPriority: null,
    });
    expect(merged.reviewLaneGate).toEqual({
      status: 'blocked',
      reason: 'block_recommendation',
      canProceed: false,
      blockingPriority: null,
      blockingLaneCount: 1,
    });
    expect(JSON.stringify(merged)).not.toMatch(/SECRET_ROLE|SECRET_REASON|SECRET_PROMPT|SECRET_TRANSCRIPT|secret\.invalid|token=secret|PX/);
    expect(JSON.stringify(capsule)).not.toMatch(/SECRET_ROLE|SECRET_REASON|SECRET_PROMPT|SECRET_TRANSCRIPT|secret\.invalid|token=secret|PX/);
  });

  it('bounds and sanitizes malformed dispatch review lane plans', () => {
    const snapshot = createBasePetSnapshot();
    const selectedRoles = Array.from({ length: 650 }, (_, index) => index === 0 ? 'SECRET_ROLE' : 'grok');
    const merged = mergeAutonomousReviewLanePlanIntoSnapshot(snapshot, {
      action: 'dispatch',
      selectedRoles,
      canRunWorker: true,
      reason: 'dispatch_lanes',
      blockingPriority: null,
      blockingLaneCount: 0,
      maxParallel: 650,
      rawPrompt: 'SECRET_DISPATCH_PROMPT',
    } as any);

    expect(merged.reviewLanes.total).toBe(500);
    expect(merged.reviewLanes.activeCount).toBe(0);
    expect(merged.reviewLanes.unknownCount).toBe(500);
    expect(merged.reviewLanes.lanes[0]).toMatchObject({
      role: 'other',
      status: 'idle',
      recommendation: 'unknown',
    });
    expect(merged.reviewLanes.lanes[merged.reviewLanes.lanes.length - 1]).toMatchObject({
      role: 'grok',
      status: 'idle',
      recommendation: 'unknown',
    });
    expect(merged.reviewLaneGate).toEqual({
      status: 'clear',
      reason: 'none',
      canProceed: true,
      blockingPriority: null,
      blockingLaneCount: 0,
    });
    expect(JSON.stringify(merged)).not.toMatch(/SECRET_ROLE|SECRET_DISPATCH_PROMPT/);
  });

  it('caps high finite halt review lane counts at the projection bound', () => {
    const snapshot = createBasePetSnapshot();
    const merged = mergeAutonomousReviewLanePlanIntoSnapshot(snapshot, {
      action: 'halt',
      selectedRoles: [],
      canRunWorker: false,
      reason: 'review_gate_p1',
      blockingPriority: 'P1',
      blockingLaneCount: 800,
      maxParallel: 2,
    });

    expect(merged.reviewLanes.total).toBe(500);
    expect(merged.reviewLanes.blockedCount).toBe(500);
    expect(merged.reviewLaneGate).toEqual({
      status: 'blocked',
      reason: 'p1',
      canProceed: false,
      blockingPriority: 'P1',
      blockingLaneCount: 500,
    });
  });

  it('clears stale projected review lanes without clearing unrelated cycle projections', () => {
    const snapshot = mergePetReviewLanesIntoSnapshot(createBasePetSnapshot(), [
      { role: 'safety', status: 'blocked', recommendation: 'block', highestPriority: 'P1', issueCount: 1 },
    ]);

    const merged = mergeAutonomousOrchestratorCycleResultIntoSnapshot(snapshot, {
      ...createOrchestratorResult({
        workerResult: createWorkerResult({
          advanced: true,
          applied: true,
          finalStatus: 'running',
        }),
        telemetryResult: {
          status: 'skipped',
          runId: null,
          rootDir: null,
          fileCount: 0,
          contentLength: 0,
          paths: [],
          errorCode: 'no_selected_run',
        },
        qualityGateDecision: {
          blocked: false,
          reason: 'gate_warning',
          latestGateStatus: 'warning',
          seq: 8,
          coverageComplete: true,
          coveredCount: 5,
          gapCount: 0,
          conflictCount: 0,
          notTestableCount: 1,
          selfReviewGrade: 'B',
          verificationPassed: false,
        },
        reviewLanePlan: {
          action: 'idle',
          selectedRoles: [],
          canRunWorker: true,
          reason: 'no_pending_lanes',
          blockingPriority: null,
          blockingLaneCount: 0,
          maxParallel: 2,
        },
      }),
    });

    expect(merged.workerCycle).toMatchObject({
      advanced: true,
      applied: true,
      finalStatus: 'running',
    });
    expect(merged.telemetry).toMatchObject({
      status: 'skipped',
      errorCode: 'no_selected_run',
    });
    expect(merged.qualityGate).toMatchObject({
      status: 'warning',
      reason: 'gate_warning',
      seq: 8,
    });
    expect(merged.reviewLanes).toMatchObject({
      total: 0,
      activeCount: 0,
      blockedCount: 0,
      blockCount: 0,
      highestPriority: null,
      lanes: [],
    });
    expect(merged.reviewLaneGate).toEqual({
      status: 'clear',
      reason: 'none',
      canProceed: true,
      blockingPriority: null,
      blockingLaneCount: 0,
    });
  });

  it('projects worker, telemetry, and quality gate results from one orchestrator cycle', () => {
    const snapshot = createBasePetSnapshot();
    const result = createOrchestratorResult({
      workerResult: createWorkerResult({
        applied: true,
        advanced: true,
        iterationAction: 'iterate',
        reviewSummary: {
          action: 'iterate',
          completionDecision: 'iterate',
          grade: 'B',
          score: 82,
          issueCount: 1,
          proofDebtCount: 2,
          acceptedEvidenceCount: 3,
          progressReason: null,
          errorCode: 'completion_review_iterate',
        },
      }),
      telemetryResult: {
        status: 'written',
        runId: 'SECRET_TELEMETRY_RUN',
        rootDir: '.runs/SECRET_TELEMETRY_RUN',
        fileCount: 2,
        contentLength: 400,
        paths: [
          '.runs/SECRET_TELEMETRY_RUN/manifest.json',
          '.runs/SECRET_TELEMETRY_RUN/.complete.json',
        ],
        errorCode: null,
      },
      qualityGateDecision: {
        blocked: false,
        reason: 'gate_warning',
        latestGateStatus: 'warning',
        seq: 4,
        coverageComplete: true,
        coveredCount: 6,
        gapCount: 0,
        conflictCount: 0,
        notTestableCount: 1,
        selfReviewGrade: 'B',
        verificationPassed: false,
      },
    });

    const merged = mergeAutonomousOrchestratorCycleResultIntoSnapshot(snapshot, result);
    const capsule = createPetHandoffCapsule(merged);

    expect(merged.workerCycle).toMatchObject({
      lastAction: 'advance',
      applied: true,
      advanced: true,
      reviewGrade: 'B',
      reviewDecision: 'iterate',
      reviewIssueCount: 1,
      reviewProofDebtCount: 2,
      acceptedEvidenceCount: 3,
      reviewErrorCode: 'completion_review_iterate',
    });
    expect(merged.telemetry).toEqual({
      status: 'written',
      complete: true,
      fileCount: 2,
      contentLength: 400,
      errorCode: null,
    });
    expect(merged.qualityGate).toMatchObject({
      status: 'warning',
      reason: 'gate_warning',
      latestGateStatus: 'warning',
      seq: 4,
      selfReviewGrade: 'B',
      verificationPassed: false,
    });
    expect(capsule.workerCycleReviewGrade).toBe(merged.workerCycle.reviewGrade);
    expect(capsule.telemetryComplete).toBe(merged.telemetry.complete);
    expect(capsule.qualityGateStatus).toBe(merged.qualityGate.status);
    expect(JSON.stringify(merged)).not.toMatch(/SECRET_TELEMETRY_RUN/);
    expect(JSON.stringify(capsule)).not.toMatch(/SECRET_TELEMETRY_RUN/);
  });

  it('projects non-mutating quality-gate holds without inventing worker progress', () => {
    const snapshot = createBasePetSnapshot({
      workerCycle: {
        lastAction: null,
        advanced: false,
        applied: false,
      },
    });
    const result = createOrchestratorResult({
      selectedRunId: 'SECRET_SELECTED_RUN',
      workerResult: null,
      telemetryResult: null,
      qualityGateDecision: {
        blocked: true,
        reason: 'state_inconsistent',
        latestGateStatus: 'failed',
        seq: 5,
        coverageComplete: false,
        coveredCount: 4,
        gapCount: 1,
        conflictCount: 0,
        notTestableCount: 0,
        selfReviewGrade: 'D',
        verificationPassed: false,
      },
    });

    const merged = mergeAutonomousOrchestratorCycleResultIntoSnapshot(snapshot, result);
    const capsule = createPetHandoffCapsule(merged);

    expect(merged.workerCycle).toEqual(snapshot.workerCycle);
    expect(merged.qualityGate).toMatchObject({
      status: 'blocked',
      reason: 'state_inconsistent',
      latestGateStatus: 'failed',
      seq: 5,
    });
    expect(merged.blockerLens).toMatchObject({
      primary: 'review',
      counts: { review: 1 },
    });
    expect(capsule.nextAction).toBe('review_blocker');
    expect(JSON.stringify(merged)).not.toMatch(/SECRET_SELECTED_RUN/);
    expect(JSON.stringify(capsule)).not.toMatch(/SECRET_SELECTED_RUN/);
  });

  it('keeps raw orchestrator cycle fields out of pet projection', () => {
    const snapshot = createBasePetSnapshot();
    const result = {
      ...createOrchestratorResult({
        workerResult: createWorkerResult({
          runId: 'SECRET_WORKER_RUN',
          errorCode: 'SECRET_WORKER_ERROR',
        }),
        telemetryResult: {
          status: 'failed',
          runId: 'SECRET_TELEMETRY_RUN',
          rootDir: '.runs/SECRET_TELEMETRY_ROOT',
          fileCount: 0,
          contentLength: 0,
          paths: ['.runs/SECRET_TELEMETRY_ROOT/private?token=SECRET_TOKEN'],
          errorCode: 'SECRET_TELEMETRY_ERROR',
        } as any,
        qualityGateDecision: {
          blocked: true,
          reason: 'review_issues',
          latestGateStatus: 'blocked',
          seq: 1,
          coverageComplete: false,
          coveredCount: 1,
          gapCount: 1,
          conflictCount: 0,
          notTestableCount: 0,
          selfReviewGrade: 'F',
          verificationPassed: false,
          rawReviewerProse: 'SECRET_REVIEWER_PROSE',
        } as any,
      }),
      selectedRunId: 'SECRET_SELECTED_RUN',
      privateNote: 'SECRET_ORCHESTRATOR_NOTE',
    } as AutonomousRunOrchestratorCycleResult & Record<string, unknown>;

    expect(JSON.stringify(result)).toMatch(
      /SECRET_WORKER_RUN|SECRET_WORKER_ERROR|SECRET_TELEMETRY_RUN|SECRET_TELEMETRY_ROOT|SECRET_TOKEN|SECRET_TELEMETRY_ERROR|SECRET_REVIEWER_PROSE|SECRET_SELECTED_RUN|SECRET_ORCHESTRATOR_NOTE/,
    );

    const merged = mergeAutonomousOrchestratorCycleResultIntoSnapshot(snapshot, result);
    const capsule = createPetHandoffCapsule(merged);

    expect(merged.workerCycle.reviewErrorCode).toBeNull();
    expect(merged.telemetry.errorCode).toBe('unknown_telemetry_error');
    expect(merged.qualityGate.selfReviewGrade).toBe('F');
    expect(JSON.stringify(merged)).not.toMatch(
      /SECRET_WORKER_RUN|SECRET_WORKER_ERROR|SECRET_TELEMETRY_RUN|SECRET_TELEMETRY_ROOT|SECRET_TOKEN|SECRET_TELEMETRY_ERROR|SECRET_REVIEWER_PROSE|SECRET_SELECTED_RUN|SECRET_ORCHESTRATOR_NOTE|private\?token/,
    );
    expect(JSON.stringify(capsule)).not.toMatch(
      /SECRET_WORKER_RUN|SECRET_WORKER_ERROR|SECRET_TELEMETRY_RUN|SECRET_TELEMETRY_ROOT|SECRET_TOKEN|SECRET_TELEMETRY_ERROR|SECRET_REVIEWER_PROSE|SECRET_SELECTED_RUN|SECRET_ORCHESTRATOR_NOTE|private\?token/,
    );
  });
});

function createBasePetSnapshot(overrides: {
  workerCycle?: Partial<PetControlSnapshot['workerCycle']>;
  memoryPressure?: Partial<PetControlSnapshot['memoryPressure']>;
  safety?: Partial<PetControlSnapshot['safety']>;
} = {}): PetControlSnapshot {
  const snapshot = createPetControlSnapshotFromRunCockpit(createIdleCockpit());
  return {
    ...snapshot,
    workerCycle: {
      ...snapshot.workerCycle,
      ...overrides.workerCycle,
    },
    memoryPressure: {
      ...snapshot.memoryPressure,
      ...overrides.memoryPressure,
    },
    safety: {
      ...snapshot.safety,
      ...overrides.safety,
    },
  };
}

function createIdleCockpit(): AutonomousRunCockpitSnapshot {
  return {
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
  };
}

function createWorkerResult(overrides: Partial<AutonomousRunCycleResult> = {}): AutonomousRunCycleResult {
  return {
    action: 'advance',
    runId: 'run-1',
    started: false,
    advanced: false,
    applied: false,
    policyDecision: 'allow',
    iterationAction: 'iterate',
    reviewSummary: null,
    finalStatus: 'running',
    errorCode: null,
    ...overrides,
  };
}

function createOrchestratorResult(
  overrides: Partial<AutonomousRunOrchestratorCycleResult> = {},
): AutonomousRunOrchestratorCycleResult {
  return {
    selectedRunId: 'run-1',
    reconciledInterruptedRuns: 0,
    beforeSnapshot: createIdleCockpit(),
    reviewLanePlan: {
      action: 'idle',
      selectedRoles: [],
      canRunWorker: true,
      reason: 'no_pending_lanes',
      blockingPriority: null,
      blockingLaneCount: 0,
      maxParallel: 0,
    },
    qualityGateDecision: null,
    workerResult: null,
    telemetryResult: null,
    afterSnapshot: createIdleCockpit(),
    ...overrides,
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
