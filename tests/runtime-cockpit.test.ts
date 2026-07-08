import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyRuntimeCockpitMissionAction,
  createRuntimeCockpitSnapshot,
  startRuntimeCockpitMission,
} from '../core/cockpit';
import {
  createAutonomousRun,
  getAutonomousRunById,
  getAutonomousRuns,
  transitionAutonomousRun,
} from '../core/run/store';
import type {
  AutonomousEvidenceRecord,
  AutonomousQualityGateRecord,
  AutonomousReviewLaneRecord,
  AutonomousRun,
  AutonomousRunStorageState,
  AutonomousRunStep,
  AutonomousTargetLease,
} from '../core/run/types';

const NOW = 1_800_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runtime cockpit projection', () => {
  it('returns an honest idle snapshot when the run ledger is empty', () => {
    const snapshot = createRuntimeCockpitSnapshot(emptyState(), NOW);

    expect(snapshot.status).toBe('idle');
    expect(snapshot.mission.active).toBe(false);
    expect(snapshot.mission.availableActions).toEqual([]);
    expect(snapshot.workingSet.evidence.total).toBe(0);
    expect(snapshot.timeline).toEqual([]);
    expect(snapshot.review.recorded).toBe(false);
  });

  it('projects mission, working set, timeline, and review from the active run ledger', () => {
    const snapshot = createRuntimeCockpitSnapshot(createState(), NOW, { timelineLimit: 5 });

    expect(snapshot.status).toBe('running');
    expect(snapshot.mission).toMatchObject({
      active: true,
      title: 'Refine DeepSeek++ cockpit',
      phase: 'verification',
      progress: 0.82,
      availableActions: ['pause', 'stop'],
    });
    expect(snapshot.workingSet.target).toMatchObject({
      status: 'active',
      locked: true,
      stale: false,
      ageMs: 40_000,
      expiresInMs: 80_000,
    });
    expect(snapshot.workingSet.evidence).toMatchObject({
      posture: 'mixed',
      total: 2,
      fresh: 1,
      stale: 1,
      expired: 0,
      latestAt: NOW - 4_000,
      details: [
        {
          kind: 'browser_snapshot',
          freshness: 'fresh',
          capturedAt: NOW - 4_000,
          expiresAt: NOW + 60_000,
        },
        {
          kind: 'shell_output',
          freshness: 'stale',
          capturedAt: NOW - 12_000,
          expiresAt: NOW + 60_000,
        },
      ],
    });
    expect(snapshot.timeline.map((event) => event.kind)).toEqual([
      'quality_gate',
      'review_lane',
      'review_lane',
      'evidence',
      'step',
    ]);
    expect(snapshot.timeline.find((event) => event.kind === 'step')).toMatchObject({
      phase: 'verification',
      stepStatus: 'running',
      proofUpdateCount: 1,
    });
    expect(snapshot.timeline.find((event) => event.kind === 'evidence')).toMatchObject({
      evidenceKind: 'browser_snapshot',
      evidenceFreshness: 'fresh',
    });
    expect(snapshot.timeline.find((event) => event.kind === 'quality_gate')).toMatchObject({
      qualityGateGrade: 'B',
    });
    expect(snapshot.timeline.find((event) => event.kind === 'review_lane')).toMatchObject({
      reviewLaneRole: 'grok',
      reviewLaneStatus: 'passed',
    });
    expect(snapshot.review).toMatchObject({
      recorded: true,
      qualityGate: {
        recorded: true,
        status: 'warning',
        grade: 'B',
        verificationPassed: true,
        coverageComplete: false,
        coverageRows: 0,
        gapCount: 1,
        conflictCount: 0,
      },
      lanes: {
        total: 2,
        running: 0,
        passed: 1,
        blocked: 1,
        failed: 0,
        highestPriority: 'P2',
        worstGrade: 'C',
        recommendation: 'iterate',
        details: [
          {
            role: 'grok',
            status: 'passed',
            grade: 'A',
            recommendation: 'proceed',
            highestPriority: null,
            issueCount: 0,
            evidenceRefCount: 1,
          },
          {
            role: 'grok',
            status: 'blocked',
            grade: 'C',
            recommendation: 'iterate',
            highestPriority: 'P2',
            issueCount: 1,
            evidenceRefCount: 1,
          },
        ],
      },
    });
  });

  it('does not expose durable ids, target URLs, evidence refs, metadata, or raw reviewer summaries', () => {
    const snapshotJson = JSON.stringify(createRuntimeCockpitSnapshot(createState(), NOW));

    expect(snapshotJson).not.toContain('run-secret-id');
    expect(snapshotJson).not.toContain('lease-secret-id');
    expect(snapshotJson).not.toContain('evidence-secret-id');
    expect(snapshotJson).not.toContain('step-secret-id');
    expect(snapshotJson).not.toContain('https://secret.example.com');
    expect(snapshotJson).not.toContain('Secret Browser Title');
    expect(snapshotJson).not.toContain('raw evidence summary that should stay internal');
    expect(snapshotJson).not.toContain('secret-ref');
    expect(snapshotJson).not.toContain('secret-tool');
    expect(snapshotJson).not.toContain('secret metadata');
    expect(snapshotJson).not.toContain('raw reviewer summary should stay internal');
  });

  it('marks expired-by-time evidence as expired in the activity timeline', () => {
    const state = {
      ...emptyState(),
      runs: [createRun()],
      evidence: [{
        ...createEvidence('fresh'),
        id: 'evidence-expired-by-time',
        capturedAt: NOW - 30_000,
        expiresAt: NOW - 1_000,
      }],
    };

    const snapshot = createRuntimeCockpitSnapshot(state, NOW);

    expect(snapshot.timeline.find((event) => event.kind === 'evidence')).toMatchObject({
      status: 'warning',
      evidenceKind: 'browser_snapshot',
      evidenceFreshness: 'expired',
    });
  });

  it('applies mission controls through durable run transitions without exposing the run id in the snapshot', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'action-run' });

    const run = await createAutonomousRun({ goal: 'Control a mission' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    await expect(applyRuntimeCockpitMissionAction('pause', 120)).resolves.toMatchObject({
      ok: true,
      status: 'paused',
      reason: 'applied',
    });
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({ status: 'paused' });

    await expect(applyRuntimeCockpitMissionAction('resume', 130)).resolves.toMatchObject({
      ok: true,
      status: 'running',
      reason: 'applied',
    });
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({ status: 'running' });

    await expect(applyRuntimeCockpitMissionAction('stop', 140)).resolves.toMatchObject({
      ok: true,
      status: 'cancelled',
      reason: 'applied',
    });
    await expect(getAutonomousRunById(run.id)).resolves.toMatchObject({ status: 'cancelled', completedAt: 140 });
  });

  it('starts a mission by creating a real queued autonomous run with proof expectations', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'mission-start-run' });

    await expect(startRuntimeCockpitMission({
      objective: '  Review the project surface for confusing state labels  ',
      doneCriteria: [' Navigation labels are clear ', 'No internal routing terms remain', ''],
      requiredEvidence: ['Focused test output', 'Visual smoke screenshot'],
    }, 200)).resolves.toEqual({
      ok: true,
      status: 'queued',
      reason: 'created',
    });

    const runs = await getAutonomousRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: 'run-mission-start-run',
      goal: 'Review the project surface for confusing state labels',
      mode: 'unattended',
      status: 'queued',
      proofContract: {
        doneCriteria: ['Navigation labels are clear', 'No internal routing terms remain'],
        requiredEvidence: ['Focused test output', 'Visual smoke screenshot'],
      },
    });
    expect(runs[0].proofContract.antiProof).toContain('Do not claim completion from model text alone.');

    const snapshot = createRuntimeCockpitSnapshot({
      version: 1,
      runs,
      steps: [],
      targetLeases: [],
      evidence: [],
      qualityGates: [],
      reviewLanes: [],
    }, 210);
    expect(snapshot.mission).toMatchObject({
      active: true,
      title: 'Review the project surface for confusing state labels',
      status: 'queued',
      nextAction: { key: 'ready_to_begin', target: 'none' },
    });
  });

  it('rejects empty mission objectives without writing a run', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);

    await expect(startRuntimeCockpitMission({ objective: '   ' }, 200)).resolves.toEqual({
      ok: false,
      status: null,
      reason: 'objective_required',
    });
    await expect(getAutonomousRuns()).resolves.toEqual([]);
  });
});

function emptyState(): AutonomousRunStorageState {
  return {
    version: 1,
    runs: [],
    steps: [],
    targetLeases: [],
    evidence: [],
    qualityGates: [],
    reviewLanes: [],
  };
}

function createState(): AutonomousRunStorageState {
  return {
    version: 1,
    runs: [createRun()],
    steps: [createStep()],
    targetLeases: [createLease()],
    evidence: [createEvidence('stale'), createEvidence('fresh')],
    qualityGates: [createGate()],
    reviewLanes: [
      createReviewLane({ id: 'lane-a', seq: 1, status: 'passed', grade: 'A', recommendation: 'proceed', highestPriority: null }),
      createReviewLane({ id: 'lane-b', seq: 2, status: 'blocked', grade: 'C', recommendation: 'iterate', highestPriority: 'P2' }),
    ],
  };
}

function createRun(): AutonomousRun {
  return {
    id: 'run-secret-id',
    goal: 'Refine DeepSeek++ cockpit',
    mode: 'unattended',
    status: 'running',
    modelAdapter: 'deepseek_web',
    targetLeaseId: 'lease-secret-id',
    budgets: {
      maxWallMs: 1000,
      maxModelTurns: 10,
      maxToolCalls: 20,
      maxConsecutiveNoProgress: 2,
      maxSameErrorRepeats: 2,
      maxPromptBytesPerTurn: 1000,
      maxObservationBytesPerTurn: 1000,
    },
    policy: {
      approvalMode: 'auto_low_risk',
      allowedTools: [],
      deniedTools: [],
      browserMutationRequiresTargetLock: true,
      persistMemory: 'off',
      shellMode: 'manual',
    },
    proofContract: {
      doneCriteria: [],
      requiredEvidence: [],
      antiProof: [],
    },
    checkpoint: {
      providerConversationId: null,
      parentMessageId: null,
      latestStepId: 'step-secret-id',
      resumableSummary: '',
      unresolvedQuestions: [],
    },
    error: null,
    createdAt: NOW - 90_000,
    startedAt: NOW - 80_000,
    completedAt: null,
    updatedAt: NOW - 2_000,
  };
}

function createLease(): AutonomousTargetLease {
  return {
    id: 'lease-secret-id',
    runId: 'run-secret-id',
    status: 'active',
    label: 'Secret lease label',
    tabId: 123,
    windowId: 456,
    origin: 'https://secret.example.com',
    title: 'Secret Browser Title',
    acquiredAt: NOW - 40_000,
    expiresAt: NOW + 80_000,
    lastVerifiedAt: NOW - 3_000,
    releasedAt: null,
  };
}

function createEvidence(freshness: 'fresh' | 'stale'): AutonomousEvidenceRecord {
  const isFresh = freshness === 'fresh';
  return {
    id: isFresh ? 'evidence-secret-id' : 'evidence-stale-id',
    runId: 'run-secret-id',
    leaseId: 'lease-secret-id',
    kind: isFresh ? 'browser_snapshot' : 'shell_output',
    freshness,
    capturedAt: isFresh ? NOW - 4_000 : NOW - 12_000,
    expiresAt: NOW + 60_000,
    summary: 'raw evidence summary that should stay internal',
    refs: ['secret-ref'],
    source: { tabId: 123, toolName: 'secret-tool' },
    metadata: { hidden: 'secret metadata' },
  };
}

function createStep(): AutonomousRunStep {
  return {
    id: 'step-secret-id',
    runId: 'run-secret-id',
    seq: 2,
    phase: 'verification',
    status: 'running',
    modelTurnId: 'secret-model-turn',
    toolCallIds: ['secret-tool-call'],
    observationRefs: ['secret-observation'],
    evidenceRefs: ['evidence-secret-id'],
    progressScore: 0.82,
    proofDelta: ['checked projection'],
    error: null,
    startedAt: NOW - 10_000,
    endedAt: null,
  };
}

function createGate(): AutonomousQualityGateRecord {
  return {
    id: 'gate-secret-id',
    runId: 'run-secret-id',
    seq: 1,
    createdAt: NOW - 1_000,
    status: 'warning',
    contractCoverage: {
      rows: [],
      complete: false,
      coveredCount: 3,
      gapCount: 1,
      conflictCount: 0,
      notTestableCount: 0,
    },
    falsePositiveProbe: {
      status: 'not_run',
      issueCount: 0,
      blockingIssueCount: 0,
    },
    resultStateConsistency: {
      status: 'consistent',
      ok: true,
      issueCount: 0,
      blockingIssueCount: 0,
    },
    selfReview: { grade: 'B' },
    verification: {
      commands: [{ name: 'compile', result: 'passed', summary: 'passed' }],
    },
    commit: null,
    independentReview: {
      status: 'not_run',
      grade: null,
      blockingIssueCount: 0,
    },
  };
}

function createReviewLane(input: Pick<AutonomousReviewLaneRecord, 'id' | 'seq' | 'status' | 'grade' | 'recommendation' | 'highestPriority'>): AutonomousReviewLaneRecord {
  return {
    ...input,
    runId: 'run-secret-id',
    createdAt: NOW - 2_000,
    role: 'grok',
    issueCount: input.status === 'blocked' ? 1 : 0,
    evidenceRefCount: 1,
    summary: 'raw reviewer summary should stay internal',
  };
}

function createChromeStub() {
  const storage = new Map<string, unknown>();
  return {
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
