import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  createPetControlSnapshotFromRunCockpit,
  mergePetReviewLanesIntoSnapshot,
  type PetControlSnapshot,
} from '../core/pet/control';
import { createPetOrchestratorReviewLaneOptions } from '../core/pet/orchestrator-bridge';
import {
  createAutonomousRun,
  getAutonomousRunById,
} from '../core/run/store';
import {
  executeAutonomousOrchestratorCycle,
  type AutonomousRunCockpitSnapshot,
} from '../core/run/orchestrator';

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
      },
    });
  });

  it('projects sanitized pet review lanes, worker pulse, risk, and oracle request', () => {
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
            role: 'oracle',
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
