import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAutonomousEvidenceRecord,
  appendAutonomousRunStep,
  createAutonomousRun,
  getAutonomousRunLedgerSnapshot,
  transitionAutonomousRun,
  upsertAutonomousTargetLease,
} from '../core/run/store';
import {
  applyPetStopLine,
  createPetControlSnapshotFromRunCockpit,
  getPetControlSnapshot,
  mergeAutonomousCompletionReviewIntoSnapshot,
  mergeAutonomousQualityGateDecisionIntoSnapshot,
  mergeRuntimeDoctorReportIntoSnapshot,
  mergePromptMemoryPressureIntoSnapshot,
  createPetHandoffCapsule,
  mergeAutonomousWorkerCycleResultIntoSnapshot,
  mergeOrchestratorTelemetryResultIntoSnapshot,
  createPetReviewLaneGate,
  createPetRunQueue,
  mergePetReviewLanesIntoSnapshot,
  createUncheckedPetProjectionFidelity,
  attachPetProjectionFidelity,
  type PetControlSnapshot,
  type PetReviewLaneInput,
} from '../core/pet/control';
import { getAutonomousRunCockpitSnapshot } from '../core/run/orchestrator';
import { createAutonomousSafetyRedactionSummary } from '../core/run/policy';
import type { RuntimeDoctorReport } from '../core/chat/runtime-doctor';
import type { AutonomousRunCompletionReview } from '../core/run/review';
import type { AutonomousRunCycleResult } from '../core/run/worker';
import type {
  AutonomousRunOrchestratorTelemetryResult,
  AutonomousRunQualityGateDecision,
} from '../core/run/orchestrator';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pet control snapshot', () => {
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

  function createProofContract() {
    return {
      doneCriteria: ['test done'],
      requiredEvidence: [],
      antiProof: [],
    };
  }

  function createBasePetSnapshot(overrides: {
    generatedAt?: number;
    readiness?: Partial<PetControlSnapshot['readiness']>;
    run?: Partial<PetControlSnapshot['run']>;
    target?: Partial<PetControlSnapshot['target']>;
    safety?: Partial<PetControlSnapshot['safety']>;
    runQueue?: Partial<PetControlSnapshot['runQueue']>;
    blockerLens?: Partial<PetControlSnapshot['blockerLens']>;
    evidence?: Partial<PetControlSnapshot['evidence']>;
    review?: Partial<PetControlSnapshot['review']>;
    reviewHeat?: Partial<PetControlSnapshot['reviewHeat']>;
    stopLine?: Partial<PetControlSnapshot['stopLine']>;
    memoryPressure?: Partial<PetControlSnapshot['memoryPressure']>;
    workerCycle?: Partial<PetControlSnapshot['workerCycle']>;
    schedulerWatchdog?: Partial<PetControlSnapshot['schedulerWatchdog']>;
    telemetry?: Partial<PetControlSnapshot['telemetry']>;
    qualityGate?: Partial<PetControlSnapshot['qualityGate']>;
    reviewLanes?: Partial<PetControlSnapshot['reviewLanes']>;
    reviewLaneGate?: Partial<PetControlSnapshot['reviewLaneGate']>;
    projectionFidelity?: Partial<PetControlSnapshot['projectionFidelity']>;
  } = {}): PetControlSnapshot {
    return {
      schemaVersion: 1,
      generatedAt: overrides.generatedAt ?? 100,
      readiness: {
        status: 'ready',
        blockers: [],
        preparing: false,
        ...overrides.readiness,
      },
      run: {
        active: false,
        label: null,
        phase: 'idle',
        nextAction: null,
        ...overrides.run,
      },
      target: {
        locked: false,
        label: null,
        stale: false,
        leaseStatus: 'none',
        leaseAgeMs: null,
        leaseExpiresInMs: null,
        ...overrides.target,
      },
      safety: {
        leakIssueCount: 0,
        highRiskArmed: false,
        ...overrides.safety,
      },
      runQueue: {
        queuedDepth: 0,
        runningCount: 0,
        pausedCount: 0,
        blockedCount: 0,
        backlog: false,
        contention: false,
        posture: 'idle',
        ...overrides.runQueue,
      },
      blockerLens: {
        primary: null,
        categories: [],
        counts: {
          auth: 0,
          target: 0,
          leak: 0,
          policy: 0,
          budget: 0,
          evidence: 0,
          review: 0,
          paused: 0,
          busy: 0,
          runtime: 0,
          unknown: 0,
        },
        total: 0,
        ...overrides.blockerLens,
      },
      evidence: {
        status: 'none',
        count: 0,
        freshCount: 0,
        staleCount: 0,
        expiredCount: 0,
        latestCapturedAt: null,
        latestAgeMs: null,
        ...overrides.evidence,
      },
      review: {
        grade: null,
        decision: null,
        proofDebtCount: 0,
        issueCount: 0,
        acceptedEvidenceCount: 0,
        canFinalize: false,
        ...overrides.review,
      },
      reviewHeat: {
        level: 'none',
        reasons: ['no_review'],
        ...overrides.reviewHeat,
      },
      stopLine: {
        available: false,
        action: 'none',
        reason: 'no_run',
        runStatus: null,
        ...overrides.stopLine,
      },
      memoryPressure: {
        enabled: false,
        level: 'none',
        truncated: false,
        selectedCount: 0,
        availableCount: 0,
        selectedTokenEstimate: 0,
        budgetTokens: 0,
        ...overrides.memoryPressure,
      },
      workerCycle: {
        lastAction: null,
        policyDecision: null,
        iterationAction: null,
        finalStatus: null,
        applied: false,
        advanced: false,
        reviewGrade: null,
        reviewDecision: null,
        reviewScore: null,
        reviewIssueCount: 0,
        reviewProofDebtCount: 0,
        acceptedEvidenceCount: 0,
        reviewErrorCode: null,
        ...overrides.workerCycle,
      },
      schedulerWatchdog: {
        status: 'none',
        decision: null,
        reason: null,
        retryable: false,
        blocksNextAction: false,
        recommendedStatus: null,
        errorCode: null,
        stepCount: 0,
        evidenceCount: 0,
        staleEvidenceCount: 0,
        expiredEvidenceCount: 0,
        blockingLaneCount: 0,
        qualityGateConflictCount: null,
        ...overrides.schedulerWatchdog,
      },
      telemetry: {
        status: 'none',
        complete: false,
        fileCount: 0,
        contentLength: 0,
        errorCode: null,
        qualityGatePackagePresent: false,
        reviewLanePackagePresent: false,
        ...overrides.telemetry,
      },
      qualityGate: {
        status: 'none',
        reason: null,
        latestGateStatus: null,
        seq: null,
        coverageComplete: null,
        coverageRowCount: null,
        coveredCount: null,
        gapCount: null,
        conflictCount: null,
        notTestableCount: null,
        selfReviewGrade: null,
        falsePositiveProbeStatus: null,
        verificationPassed: null,
        ...overrides.qualityGate,
      },
      reviewLanes: {
        total: 0,
        activeCount: 0,
        passedCount: 0,
        blockedCount: 0,
        failedCount: 0,
        highestPriority: null,
        worstGrade: null,
        proceedCount: 0,
        iterateCount: 0,
        blockCount: 0,
        unknownCount: 0,
        lanes: [],
        ...overrides.reviewLanes,
      },
      reviewLaneGate: {
        status: 'clear',
        reason: 'none',
        canProceed: true,
        blockingPriority: null,
        blockingLaneCount: 0,
        ...overrides.reviewLaneGate,
      },
      projectionFidelity: {
        ...createUncheckedPetProjectionFidelity(),
        ...overrides.projectionFidelity,
      },
    };
  }

  function createBaseForHandoff(overrides: Parameters<typeof createBasePetSnapshot>[0] = {}): PetControlSnapshot {
    return createBasePetSnapshot({
      generatedAt: 123,
      readiness: { status: 'ready', blockers: [], preparing: false },
      run: { active: false, label: null, phase: 'idle', nextAction: null },
      target: {
        locked: false,
        label: null,
        stale: false,
        leaseStatus: 'none',
        leaseAgeMs: null,
        leaseExpiresInMs: null,
      },
      safety: { leakIssueCount: 0, highRiskArmed: false },
      evidence: {
        status: 'none',
        count: 0,
        freshCount: 0,
        staleCount: 0,
        expiredCount: 0,
        latestCapturedAt: null,
        latestAgeMs: null,
      },
      review: {
        grade: null,
        decision: null,
        proofDebtCount: 0,
        issueCount: 0,
        acceptedEvidenceCount: 0,
        canFinalize: false,
      },
      ...overrides,
    });
  }

  function createRuntimeDoctorReport(overrides: {
    generatedAt?: number;
    readiness?: Partial<RuntimeDoctorReport['readiness']>;
    targetLock?: Partial<RuntimeDoctorReport['browserControl']['targetLock']>;
    leakSentryIssueCount?: number;
    leakQuarantineIssueCount?: number;
    leakQuarantineGroups?: RuntimeDoctorReport['leakQuarantine']['groups'];
    storageIssues?: RuntimeDoctorReport['storage']['issues'];
    failureExplanations?: RuntimeDoctorReport['failureExplanations'];
    debugSuggestions?: RuntimeDoctorReport['debugDistiller']['suggestions'];
    retryableFailure?: RuntimeDoctorReport['automation']['retryableFailure'];
  } = {}): RuntimeDoctorReport {
    const leakSentryIssueCount = overrides.leakSentryIssueCount ?? 0;
    const leakQuarantineIssueCount = overrides.leakQuarantineIssueCount ?? 0;
    const storageIssues = overrides.storageIssues ?? [];

    return {
      ok: true,
      generatedAt: overrides.generatedAt ?? 200,
      chatEnabled: true,
      chatBusy: false,
      provider: 'deepseek-web',
      hasApiKey: false,
      hasWebAuth: true,
      webAuthRejected: false,
      deepSeekTabCount: 1,
      sidepanelSession: {
        active: false,
        source: 'none',
        parentMessageId: null,
      },
      personalConvenience: {
        enabled: true,
        autoReadyCheckBeforeRun: true,
        autoRefreshWebAuth: true,
        sameSessionStrategy: 'current',
        visualMonitorDefault: false,
        reducedConfirmations: false,
        lastSessionRemembered: false,
        lastSessionSource: null,
        lastSessionUpdatedAt: null,
      },
      vision: {
        maxImagesPerTurn: 0,
        rawImagesStoredDurably: false,
      },
      browserControl: {
        enabled: true,
        targetSelected: false,
        targetLock: {
          enabled: false,
          label: null,
          origin: null,
          updatedAt: null,
          ...overrides.targetLock,
        },
        visualCaptureAllowed: true,
        actVerifyEnabled: true,
        evidencePacksEnabled: true,
        debugDistillerEnabled: false,
        monitorReady: true,
      },
      contentScripts: {
        checked: true,
        totalTabs: 1,
        healthyTabs: 1,
        staleTabs: 0,
        staleTabIds: [],
      },
      automation: {
        maxAttempts: 3,
        retryableFailure: overrides.retryableFailure ?? null,
      },
      autopilot: {
        inFlightSource: null,
        latestRun: null,
        recentRuns: [],
      },
      humanEval: {
        grade: 'A',
        checks: [],
      },
      leakSentry: {
        ok: leakSentryIssueCount === 0,
        grade: leakSentryIssueCount === 0 ? 'A' : 'F',
        issueCount: leakSentryIssueCount,
        checkedAreas: ['local'],
      },
      leakQuarantine: {
        issueCount: leakQuarantineIssueCount,
        cleanupEligibleCount: 0,
        groups: overrides.leakQuarantineGroups ?? [],
      },
      debugDistiller: {
        enabled: false,
        suggestions: overrides.debugSuggestions ?? [],
      },
      readiness: {
        ready: true,
        status: 'ready',
        blockers: [],
        lastPreparedAt: null,
        preparing: false,
        targetStatus: null,
        noLeak: true,
        ...overrides.readiness,
      },
      failureExplanations: overrides.failureExplanations ?? [],
      storage: {
        ok: storageIssues.length === 0,
        issues: storageIssues,
      },
    };
  }

  it('pure reducer maps idle cockpit snapshot to ready/idle/no active target/safety defaults', () => {
    const idleCockpit = {
      schemaVersion: 1 as const,
      generatedAt: 123,
      status: 'idle' as const,
      totals: {
        queued: 0,
        running: 0,
        paused: 0,
        blocked: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      },
      activeRun: null,
    };

    const pet = createPetControlSnapshotFromRunCockpit(idleCockpit);

    expect(pet).toMatchObject({
      schemaVersion: 1,
      generatedAt: 123,
      readiness: { status: 'ready', blockers: [], preparing: false },
      run: { active: false, phase: 'idle', nextAction: null },
      target: { locked: false, label: null, stale: false, leaseStatus: 'none', leaseAgeMs: null, leaseExpiresInMs: null },
      safety: { leakIssueCount: 0, highRiskArmed: false },
      blockerLens: {
        primary: null,
        categories: [],
        counts: {
          auth: 0,
          target: 0,
          leak: 0,
          policy: 0,
          budget: 0,
          evidence: 0,
          review: 0,
          paused: 0,
          busy: 0,
          runtime: 0,
          unknown: 0,
        },
        total: 0,
      },
      evidence: {
        status: 'none',
        count: 0,
        freshCount: 0,
        staleCount: 0,
        expiredCount: 0,
        latestCapturedAt: null,
        latestAgeMs: null,
      },
      review: {
        grade: null,
        decision: null,
        proofDebtCount: 0,
        issueCount: 0,
        acceptedEvidenceCount: 0,
        canFinalize: false,
      },
      reviewHeat: { level: 'none', reasons: ['no_review'] },
      stopLine: { available: false, action: 'none', reason: 'no_run', runStatus: null },
    });
    expect(pet.run.label).toBeNull();
    expect(pet.target.label).toBeNull();
  });

  it('marks clean cockpit-derived pet projection as fidelity passed and mirrors it in handoff', () => {
    const cockpit = {
      schemaVersion: 1 as const,
      generatedAt: 200,
      status: 'running' as const,
      totals: {
        queued: 1,
        running: 1,
        paused: 0,
        blocked: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      },
      activeRun: {
        id: 'SECRET_RUN_ID',
        goal: 'Allowed run label SECRET_GOAL_TEXT',
        mode: 'unattended' as const,
        status: 'running' as const,
        targetLeaseId: 'SECRET_LEASE_ID',
        targetLeaseStatus: 'active' as const,
        targetLeaseAgeMs: 50,
        targetLeaseExpiresInMs: 550,
        createdAt: 100,
        startedAt: 120,
        updatedAt: 180,
        latestStep: { id: 'SECRET_STEP_ID', phase: 'tool_execution' as const, status: 'succeeded' as const, progressScore: 1, endedAt: 170 },
        stepCount: 2,
        evidenceCount: 1,
        freshEvidenceCount: 1,
        staleEvidenceCount: 0,
        expiredEvidenceCount: 0,
        latestEvidenceAt: 190,
        targetLeaseCount: 1,
        errorCode: null,
      },
    };

    const pet = createPetControlSnapshotFromRunCockpit(cockpit);
    const capsule = createPetHandoffCapsule(pet);

    expect(pet.projectionFidelity).toEqual({
      status: 'passed',
      score: 1,
      driftCount: 0,
      gateImpact: false,
      source: 'cockpit',
      checkedAt: 200,
      driftKeys: [],
    });
    expect(capsule).toMatchObject({
      projectionFidelityStatus: 'passed',
      projectionFidelityScore: 1,
      projectionFidelityDriftCount: 0,
      projectionFidelityGateImpact: false,
      projectionFidelitySource: 'cockpit',
      projectionFidelityDriftKeys: [],
    });
    expect(JSON.stringify(pet.projectionFidelity)).not.toMatch(/SECRET_RUN_ID|SECRET_GOAL_TEXT|SECRET_LEASE_ID|SECRET_STEP_ID/);
    expect(JSON.stringify(capsule)).not.toMatch(/SECRET_RUN_ID|SECRET_GOAL_TEXT|SECRET_LEASE_ID|SECRET_STEP_ID/);
  });

  it('fails forged projection fidelity and prevents fake pass from reaching handoff', () => {
    const cockpit = {
      schemaVersion: 1 as const,
      generatedAt: 300,
      status: 'running' as const,
      totals: {
        queued: 0,
        running: 1,
        paused: 0,
        blocked: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      },
      activeRun: {
        id: 'SECRET_FORGED_RUN',
        goal: 'Forged drift run',
        mode: 'unattended' as const,
        status: 'running' as const,
        targetLeaseId: 'SECRET_FORGED_LEASE',
        targetLeaseStatus: 'active' as const,
        targetLeaseAgeMs: 10,
        targetLeaseExpiresInMs: 590,
        createdAt: 100,
        startedAt: 120,
        updatedAt: 290,
        latestStep: { id: 'SECRET_FORGED_STEP', phase: 'verification' as const, status: 'succeeded' as const, progressScore: 1, endedAt: 280 },
        stepCount: 3,
        evidenceCount: 2,
        freshEvidenceCount: 2,
        staleEvidenceCount: 0,
        expiredEvidenceCount: 0,
        latestEvidenceAt: 295,
        targetLeaseCount: 1,
        errorCode: null,
      },
    };
    const source = createPetControlSnapshotFromRunCockpit(cockpit);
    const forged = {
      ...source,
      run: { ...source.run, active: false, phase: 'idle', nextAction: null },
      runQueue: { ...source.runQueue, runningCount: 0, posture: 'idle' },
      target: { ...source.target, locked: false, stale: true, leaseStatus: 'expired', leaseAgeMs: 999, leaseExpiresInMs: 0 },
      evidence: { ...source.evidence, status: 'none', count: 0, freshCount: 0, latestAgeMs: null },
      stopLine: { available: false, action: 'none', reason: 'no_run', runStatus: null },
      projectionFidelity: {
        status: 'passed',
        score: 1,
        driftCount: 0,
        gateImpact: false,
        source: 'cockpit',
        checkedAt: 300,
        driftKeys: ['SECRET_DRIFT_KEY'],
        rawPrompt: 'SECRET_FORGED_PROMPT',
      },
      rawTargetUrl: 'https://secret.invalid/target?token=SECRET_TOKEN',
    } as unknown as PetControlSnapshot & Record<string, unknown>;

    expect(JSON.stringify(forged)).toMatch(/SECRET_FORGED_PROMPT|secret\.invalid|SECRET_TOKEN|SECRET_DRIFT_KEY/);

    const audited = attachPetProjectionFidelity(forged, cockpit, 'cockpit');
    const capsule = createPetHandoffCapsule(audited);

    expect(audited.projectionFidelity.status).toBe('drifted');
    expect(audited.projectionFidelity.score).toBeLessThan(1);
    expect(audited.projectionFidelity.driftCount).toBeGreaterThan(0);
    expect(audited.projectionFidelity.gateImpact).toBe(true);
    expect(audited.projectionFidelity.driftKeys).toEqual(expect.arrayContaining([
      'run_active',
      'run_phase',
      'run_next_action',
      'run_queue',
      'target',
      'evidence',
      'stop_line',
      'handoff_next_action',
    ]));
    expect(capsule).toMatchObject({
      projectionFidelityStatus: 'drifted',
      projectionFidelityDriftCount: audited.projectionFidelity.driftCount,
      projectionFidelityGateImpact: true,
      projectionFidelitySource: 'cockpit',
    });
    expect(capsule.projectionFidelityScore).toBe(audited.projectionFidelity.score);
    expect(capsule.projectionFidelityDriftKeys).toEqual(audited.projectionFidelity.driftKeys);
    expect(JSON.stringify(audited.projectionFidelity)).not.toMatch(/SECRET_FORGED_PROMPT|secret\.invalid|SECRET_TOKEN|SECRET_DRIFT_KEY|SECRET_FORGED_RUN|SECRET_FORGED_LEASE|SECRET_FORGED_STEP/);
    expect(JSON.stringify(capsule)).not.toMatch(/SECRET_FORGED_PROMPT|secret\.invalid|SECRET_TOKEN|SECRET_DRIFT_KEY|SECRET_FORGED_RUN|SECRET_FORGED_LEASE|SECRET_FORGED_STEP/);
  });

  it('maps queued cockpit to ready/thinking with preparing, active run', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'queued-pet' });

    const run = await createAutonomousRun({ goal: 'Queued goal', proofContract: createProofContract() }, 100);

    const cockpit = await getAutonomousRunCockpitSnapshot(150);
    const pet = createPetControlSnapshotFromRunCockpit(cockpit);

    expect(cockpit.status).toBe('queued');
    expect(pet.readiness).toMatchObject({ status: 'ready', preparing: true });
    expect(pet.run).toMatchObject({ active: true, phase: 'thinking', nextAction: 'Start or continue worker cycle' });
    expect(pet.run.label).toBe('Queued goal');
    expect(pet.target).toMatchObject({ locked: false, stale: false, leaseStatus: 'none' });
    expect(pet.safety).toMatchObject({ leakIssueCount: 0, highRiskArmed: false });
    expect(pet.stopLine).toEqual({ available: true, action: 'pause', reason: 'can_pause', runStatus: 'queued' });
  });

  it('maps running with latest step review to reviewing phase', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'running-review' });

    const run = await createAutonomousRun({ goal: 'Review run', proofContract: createProofContract() }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousRunStep(run.id, { id: 'step-review', phase: 'review', progressScore: 0 }, 120);

    const pet = await getPetControlSnapshot(130);

    expect(pet.readiness.status).toBe('ready');
    expect(pet.run).toMatchObject({ active: true, phase: 'reviewing', nextAction: 'Continue autonomous cycle' });
    expect(pet.run.label).toBe('Review run');
    expect(pet.stopLine).toEqual({ available: true, action: 'pause', reason: 'can_pause', runStatus: 'running' });
  });

  it('maps running with working phases (model_turn etc) to working', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'running-working' });

    const run = await createAutonomousRun({ goal: 'Working run', proofContract: createProofContract() }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousRunStep(run.id, { id: 'step-model', phase: 'model_turn' }, 120);

    const pet = createPetControlSnapshotFromRunCockpit(await getAutonomousRunCockpitSnapshot(130));
    expect(pet.run.phase).toBe('working');

    // also test other phases via reducer directly
    const cockpitWorking = { ...(await getAutonomousRunCockpitSnapshot(130)), activeRun: { ...(await getAutonomousRunCockpitSnapshot(130)).activeRun!, latestStep: { id: 's', phase: 'tool_execution' as const, status: 'succeeded' as const, progressScore: 0, endedAt: 125 } } } as any;
    const pet2 = createPetControlSnapshotFromRunCockpit(cockpitWorking);
    expect(pet2.run.phase).toBe('working');
  });

  it('maps running plan to thinking, finish to done', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'run-plan-finish' });

    const run = await createAutonomousRun({ goal: 'Plan run', proofContract: createProofContract() }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousRunStep(run.id, { id: 'step-plan', phase: 'plan' }, 120);

    let pet = await getPetControlSnapshot(130);
    expect(pet.run.phase).toBe('thinking');

    await appendAutonomousRunStep(run.id, { id: 'step-finish', phase: 'finish' }, 140);
    pet = await getPetControlSnapshot(150);
    expect(pet.run.phase).toBe('done');
  });

  it('maps blocked with errorCode to blocked readiness, phase blocked, blocker includes error', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'blocked-pet' });

    const run = await createAutonomousRun({ goal: 'Blocked', proofContract: createProofContract() }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await transitionAutonomousRun(run.id, 'blocked', { code: 'policy_deny', message: 'denied', phase: 'policy', retryable: false, at: 120 }, 120);

    const pet = await getPetControlSnapshot(130);

    expect(pet.readiness).toMatchObject({ status: 'blocked' });
    expect(pet.readiness.blockers).toContain('policy_deny');
    expect(pet.run).toMatchObject({ active: true, phase: 'blocked', nextAction: 'Review blocker to resume' });
    expect(pet.stopLine).toEqual({ available: true, action: 'cancel', reason: 'can_cancel', runStatus: 'blocked' });
  });

  it('maps blocked without errorCode uses generic run_blocked', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'blocked-generic' });

    const run = await createAutonomousRun({ goal: 'Blocked generic', proofContract: createProofContract() }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await transitionAutonomousRun(run.id, 'blocked', null, 120);

    const cockpit = await getAutonomousRunCockpitSnapshot(130);
    // force errorCode null in activeRun for test
    const forced = { ...cockpit, activeRun: cockpit.activeRun ? { ...cockpit.activeRun, errorCode: null } : null };
    const pet = createPetControlSnapshotFromRunCockpit(forced as any);

    expect(pet.readiness.status).toBe('blocked');
    expect(pet.readiness.blockers).toContain('run_blocked');
  });

  it('maps paused to needs_attention, phase blocked, run_paused blocker', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'paused-pet' });

    const run = await createAutonomousRun({ goal: 'Paused', proofContract: createProofContract() }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await transitionAutonomousRun(run.id, 'paused', null, 120);

    const pet = await getPetControlSnapshot(130);

    expect(pet.readiness).toMatchObject({ status: 'needs_attention', blockers: ['run_paused'] });
    expect(pet.run).toMatchObject({ active: true, phase: 'blocked', nextAction: 'Resume or inspect run' });
    expect(pet.stopLine).toEqual({ available: true, action: 'cancel', reason: 'can_cancel', runStatus: 'paused' });
  });

  it('maps complete/terminal to ready/done, nextAction review result when active terminal run', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'terminal-pet' });

    const run = await createAutonomousRun({ goal: 'Terminal run', proofContract: createProofContract() }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await transitionAutonomousRun(run.id, 'succeeded', null, 120);

    const pet = await getPetControlSnapshot(130);

    expect(pet.readiness.status).toBe('ready');
    expect(pet.run).toMatchObject({ active: true, phase: 'done', nextAction: 'Review result' });
    expect(pet.stopLine).toEqual({ available: false, action: 'none', reason: 'terminal', runStatus: 'succeeded' });
  });

  it('applyPetStopLine pauses the selected queued/running run and result agrees with durable state', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'stop-running' });

    const run = await createAutonomousRun({
      goal: 'Stop running without leaking SECRET_STOP_GOAL',
      proofContract: createProofContract(),
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    const result = await applyPetStopLine(130);
    const stored = await getAutonomousRunLedgerSnapshot();
    const storedRun = stored.runs.find((item) => item.id === run.id);

    expect(result).toEqual({
      applied: true,
      action: 'pause',
      beforeStatus: 'running',
      afterStatus: 'paused',
      errorCode: null,
    });
    expect(storedRun).toMatchObject({ status: 'paused', updatedAt: 130 });
    expect(JSON.stringify(result)).not.toMatch(/SECRET_STOP_GOAL|Stop running/);
  });

  it('applyPetStopLine cancels paused or blocked runs with a safe stop-line error', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'stop-paused' });

    const run = await createAutonomousRun({
      goal: 'Cancel paused without leaking SECRET_CANCEL_GOAL',
      proofContract: createProofContract(),
    }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await transitionAutonomousRun(run.id, 'paused', null, 120);

    const result = await applyPetStopLine(140);
    const stored = await getAutonomousRunLedgerSnapshot();
    const storedRun = stored.runs.find((item) => item.id === run.id);

    expect(result).toEqual({
      applied: true,
      action: 'cancel',
      beforeStatus: 'paused',
      afterStatus: 'cancelled',
      errorCode: null,
    });
    expect(storedRun).toMatchObject({
      status: 'cancelled',
      error: {
        code: 'autonomous_run_cancelled_by_pet_stop_line',
        phase: 'policy',
        retryable: false,
      },
      completedAt: 140,
    });
    expect(JSON.stringify(result)).not.toMatch(/SECRET_CANCEL_GOAL|Cancel paused/);
    expect(JSON.stringify(storedRun?.error)).not.toMatch(/SECRET_CANCEL_GOAL|Cancel paused/);
  });

  it('applyPetStopLine is a safe noop with no active stoppable run', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'stop-none' });

    await expect(applyPetStopLine(100)).resolves.toEqual({
      applied: false,
      action: 'none',
      beforeStatus: null,
      afterStatus: null,
      errorCode: 'no_active_run',
    });
  });

  it('target metadata is locked/generic label/stale=false; no raw URL/title/origin exposed', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'target-meta' });

    const run = await createAutonomousRun({ goal: 'Target meta', proofContract: createProofContract() }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await upsertAutonomousTargetLease({
      runId: run.id,
      tabId: 42,
      windowId: 1,
      origin: 'https://secret-target.example.com/path?token=secret-target-token',
      title: 'secret-target-title with pass=ultra-secret',
    }, 115);

    // prove durable storage contains the injected secret-looking data (positive half of probe)
    const stored = await getAutonomousRunLedgerSnapshot();
    const storedJson = JSON.stringify(stored);
    expect(storedJson).toMatch(/secret-target-title|secret-target-token|ultra-secret/);

    const pet = await getPetControlSnapshot(130);

    expect(pet.target).toMatchObject({
      locked: true,
      label: 'Target locked',
      stale: false,
      leaseStatus: 'active',
      leaseAgeMs: 15,
      leaseExpiresInMs: 599_985,
    });
    const json = JSON.stringify(pet);
    expect(json).not.toMatch(/secret-target-title|secret-target-token|ultra-secret|secret-target.example.com/);
  });

  it('maps expired target lease into stale target metadata without exposing lease origin/title', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'expired-target-pet' });

    const run = await createAutonomousRun({ goal: 'Expired target', proofContract: createProofContract() }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await upsertAutonomousTargetLease({
      id: 'expired-target-lease',
      runId: run.id,
      tabId: 42,
      windowId: 1,
      origin: 'https://expired-target.example.com/path?token=TARGET_SECRET',
      title: 'expired-target-title with password=ultra-secret',
      acquiredAt: 100,
      ttlMs: 5,
    }, 120);

    const storedJson = JSON.stringify(await getAutonomousRunLedgerSnapshot());
    expect(storedJson).toMatch(/expired-target-title|TARGET_SECRET|ultra-secret/);

    const pet = await getPetControlSnapshot(10_200);
    expect(pet.target).toMatchObject({
      locked: false,
      label: 'Target stale',
      stale: true,
      leaseStatus: 'expired',
      leaseAgeMs: 10_100,
      leaseExpiresInMs: 0,
    });

    const capsule = createPetHandoffCapsule(pet);
    expect(capsule).toMatchObject({
      targetState: 'stale',
      targetLeaseStatus: 'expired',
      targetLeaseAgeMs: 10_100,
      targetLeaseExpiresInMs: 0,
      nextAction: 'open_target',
    });
    expect(JSON.stringify(pet)).not.toMatch(/expired-target-title|TARGET_SECRET|ultra-secret|expired-target\.example/);
    expect(JSON.stringify(capsule)).not.toMatch(/expired-target-title|TARGET_SECRET|ultra-secret|expired-target\.example|expired-target-lease/);
  });

  it('privacy probe: secrets in evidence refs/summary/metadata and target lease origin/title do not appear in pet snapshot JSON', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'privacy-pet' });

    const run = await createAutonomousRun({ goal: 'Privacy probe run', proofContract: createProofContract() }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await upsertAutonomousTargetLease({
      runId: run.id,
      tabId: 99,
      windowId: 1,
      origin: 'https://leak.example.com?auth=LEAK_SECRET_TOKEN',
      title: 'Leaky Title secret-target-title with password=ultra-secret',
    }, 115);
    await appendAutonomousEvidenceRecord(run.id, {
      kind: 'web',
      summary: 'Evidence summary contains LEAK_SECRET_TOKEN and more',
      refs: ['ref:leak-LEAK_SECRET_TOKEN', 'private-ref'],
      metadata: { secret: 'ultra-secret', url: 'https://leak?token=LEAK_SECRET_TOKEN' },
    }, 120);

    // prove durable ledger/storage contains the injected secret-looking strings from evidence and target lease (positive half inside same test)
    const stored = await getAutonomousRunLedgerSnapshot();
    const storedJson = JSON.stringify(stored);
    expect(storedJson).toMatch(/LEAK_SECRET_TOKEN/);
    expect(storedJson).toMatch(/ultra-secret/);
    expect(storedJson).toMatch(/secret-target-title/);
    expect(storedJson).toMatch(/private-ref/);
    expect(storedJson).toMatch(/leak.example.com/);

    const pet = await getPetControlSnapshot(130);
    const json = JSON.stringify(pet);

    expect(json).not.toMatch(/LEAK_SECRET_TOKEN/);
    expect(json).not.toMatch(/ultra-secret/);
    expect(json).not.toMatch(/secret-target-title/);
    expect(json).not.toMatch(/private-ref/);
    expect(json).not.toMatch(/leak.example.com/);
    expect(json).not.toMatch(/password=/);
    // goal itself is allowed as it is public run label; probe targets the forbidden fields
    expect(json).toContain('Privacy probe run');
  });

  it('maps active run evidence into a safe pet evidence pulse and handoff capsule fields', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'evidence-pulse' });

    const run = await createAutonomousRun({ goal: 'Evidence pulse run', proofContract: createProofContract() }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousEvidenceRecord(run.id, {
      id: 'expired-evidence',
      kind: 'browser_snapshot',
      capturedAt: 100,
      ttlMs: 5,
      summary: 'Expired summary with SECRET_EXPIRED_EVIDENCE',
      refs: ['expired-ref-SECRET'],
      metadata: { url: 'https://expired.example.com?token=SECRET' },
    }, 120);
    await appendAutonomousEvidenceRecord(run.id, {
      id: 'fresh-evidence',
      kind: 'browser_snapshot',
      capturedAt: 5_900,
      ttlMs: 10_000,
      summary: 'Fresh summary with SECRET_FRESH_EVIDENCE',
      refs: ['fresh-ref-SECRET'],
      metadata: { url: 'https://fresh.example.com?token=SECRET' },
    }, 5_900);

    const storedJson = JSON.stringify(await getAutonomousRunLedgerSnapshot());
    expect(storedJson).toMatch(/SECRET_EXPIRED_EVIDENCE|SECRET_FRESH_EVIDENCE|fresh-ref-SECRET|expired-ref-SECRET/);

    const pet = await getPetControlSnapshot(6_000);
    expect(pet.evidence).toEqual({
      status: 'fresh',
      count: 2,
      freshCount: 1,
      staleCount: 0,
      expiredCount: 1,
      latestCapturedAt: 5_900,
      latestAgeMs: 100,
    });

    const capsule = createPetHandoffCapsule(pet);
    expect(capsule).toMatchObject({
      evidenceStatus: 'fresh',
      evidenceCount: 2,
      latestEvidenceAgeMs: 100,
    });
    expect(JSON.stringify(pet)).not.toMatch(/SECRET_EXPIRED_EVIDENCE|SECRET_FRESH_EVIDENCE|fresh-ref-SECRET|expired-ref-SECRET|expired\.example|fresh\.example/);
    expect(JSON.stringify(capsule)).not.toMatch(/SECRET_EXPIRED_EVIDENCE|SECRET_FRESH_EVIDENCE|fresh-ref-SECRET|expired-ref-SECRET|expired\.example|fresh\.example/);
  });

  it('maps stale and expired cockpit evidence pulses without raw evidence data', () => {
    const baseRun = {
      id: 'synthetic-run',
      goal: 'Synthetic run',
      mode: 'unattended',
      status: 'running',
      targetLeaseId: null,
      createdAt: 1,
      startedAt: 1,
      updatedAt: 1,
      latestStep: null,
      stepCount: 0,
      targetLeaseCount: 0,
      errorCode: null,
    };
    const stalePet = createPetControlSnapshotFromRunCockpit({
      schemaVersion: 1,
      generatedAt: 100,
      status: 'running',
      totals: { queued: 0, running: 1, paused: 0, blocked: 0, succeeded: 0, failed: 0, cancelled: 0 },
      activeRun: {
        ...baseRun,
        evidenceCount: 1,
        freshEvidenceCount: 0,
        staleEvidenceCount: 1,
        expiredEvidenceCount: 0,
        latestEvidenceAt: 120,
      },
    } as any);
    expect(stalePet.evidence).toEqual({
      status: 'stale',
      count: 1,
      freshCount: 0,
      staleCount: 1,
      expiredCount: 0,
      latestCapturedAt: 120,
      latestAgeMs: 0,
    });

    const expiredPet = createPetControlSnapshotFromRunCockpit({
      schemaVersion: 1,
      generatedAt: 200,
      status: 'running',
      totals: { queued: 0, running: 1, paused: 0, blocked: 0, succeeded: 0, failed: 0, cancelled: 0 },
      activeRun: {
        ...baseRun,
        evidenceCount: 1,
        freshEvidenceCount: 0,
        staleEvidenceCount: 0,
        expiredEvidenceCount: 1,
        latestEvidenceAt: 100,
      },
    } as any);
    expect(expiredPet.evidence).toMatchObject({
      status: 'expired',
      count: 1,
      expiredCount: 1,
      latestCapturedAt: 100,
      latestAgeMs: 100,
    });
  });

  it('async convenience uses provided now: generatedAt equals now and reducer agrees with cockpit state', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'now-pet' });

    const run = await createAutonomousRun({ goal: 'Now test', proofContract: createProofContract() }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);

    const pet = await getPetControlSnapshot(999);
    const cockpit = await getAutonomousRunCockpitSnapshot(999);

    expect(pet.generatedAt).toBe(999);
    expect(pet.readiness.status).toBe('ready');
    expect(pet.run.active).toBe(true);
    // reducer output agrees structurally with what cockpit would reduce to
    const reduced = createPetControlSnapshotFromRunCockpit(cockpit);
    expect(reduced).toEqual(pet);
  });

  it('covers terminal without active terminal nextAction null edge (empty after complete)', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    // no runs
    const pet = await getPetControlSnapshot(1000);
    expect(pet.run.phase).toBe('idle');
    expect(pet.run.nextAction).toBeNull();
  });

  it('merges ready Runtime Doctor status into safe pet fields while preserving run and timestamp', () => {
    const base = createBasePetSnapshot({
      generatedAt: 123,
      run: {
        active: true,
        label: 'Continue autonomous run',
        phase: 'working',
        nextAction: 'Continue autonomous cycle',
      },
      readiness: { status: 'blocked', blockers: ['run_blocked'] },
    });
    const report = createRuntimeDoctorReport({
      generatedAt: 999,
      readiness: { status: 'ready', targetStatus: 'ready' },
      targetLock: {
        enabled: true,
        label: 'secret target title',
        origin: 'https://secret-target.example.com?token=TARGET_SECRET',
      },
      leakSentryIssueCount: 1,
      leakQuarantineIssueCount: 4,
      storageIssues: [{
        area: 'local',
        path: 'deepseekCachedClientHeaders',
        reason: 'deepseek_web_headers',
      }],
    });

    const pet = mergeRuntimeDoctorReportIntoSnapshot(base, report);

    expect(pet.generatedAt).toBe(123);
    expect(pet.run).toBe(base.run);
    expect(pet.readiness).toEqual({ status: 'ready', blockers: [], preparing: false });
    expect(pet.target).toEqual({
      locked: true,
      label: 'Target locked',
      stale: false,
      leaseStatus: 'none',
      leaseAgeMs: null,
      leaseExpiresInMs: null,
    });
    expect(pet.safety).toEqual({ leakIssueCount: 4, highRiskArmed: false });
    expect(pet.blockerLens.primary).toBe('leak');
    expect(pet.blockerLens.categories).toEqual(['leak']);
    expect(pet.blockerLens.counts.leak).toBe(4);
    expect(pet.blockerLens.total).toBe(4);
  });

  it('merges blocked Runtime Doctor status and preparing flag into readiness', () => {
    const base = createBasePetSnapshot();
    const report = createRuntimeDoctorReport({
      readiness: {
        ready: false,
        status: 'needs_attention',
        blockers: ['browser_control_disabled', 'browser_target_not_controllable'],
        preparing: true,
        targetStatus: 'not_controllable',
      },
    });

    const pet = mergeRuntimeDoctorReportIntoSnapshot(base, report);

    expect(pet.readiness).toEqual({
      status: 'needs_attention',
      blockers: ['browser_control_disabled', 'browser_target_not_controllable'],
      preparing: true,
    });
    expect(pet.target).toEqual({
      locked: false,
      label: 'Target stale',
      stale: true,
      leaseStatus: 'none',
      leaseAgeMs: null,
      leaseExpiresInMs: null,
    });
  });

  it('maps raw readiness blockers into a safe blocker lens and handoff categories', () => {
    const base = createBasePetSnapshot({
      readiness: {
        status: 'blocked',
        blockers: [
          'web_auth_rejected with PRIVATE_AUTH_TOKEN',
          'browser_target_not_controllable at https://private-target.example.com',
          'storage_leak SECRET_STORAGE_VALUE',
          'policy_deny token=PRIVATE_POLICY',
        ],
        preparing: false,
      },
      safety: { leakIssueCount: 3 },
    });

    const sourceJson = JSON.stringify(base);
    expect(sourceJson).toMatch(/PRIVATE_AUTH_TOKEN|private-target\.example|SECRET_STORAGE_VALUE|PRIVATE_POLICY/);

    const pet = mergeAutonomousCompletionReviewIntoSnapshot(base, {
      decision: 'pass',
      grade: 'A',
      score: 100,
      issueCodes: [],
      requiredEvidenceMissing: [],
      doneCriteriaMissing: [],
      acceptedEvidenceIds: ['safe-evidence'],
      error: null,
    });
    expect(pet.blockerLens.primary).toBe('leak');
    expect(pet.blockerLens.categories).toEqual(['leak', 'target', 'auth', 'policy']);
    expect(pet.blockerLens.counts).toMatchObject({
      leak: 1,
      target: 1,
      auth: 1,
      policy: 1,
    });
    expect(pet.blockerLens.total).toBe(4);

    const capsule = createPetHandoffCapsule(pet);
    expect(capsule.blockerPrimaryCategory).toBe('leak');
    expect(capsule.blockerCategories).toEqual(['leak', 'target', 'auth', 'policy']);
    expect(capsule.blockerCategoryCounts).toMatchObject({
      leak: 1,
      target: 1,
      auth: 1,
      policy: 1,
    });
    expect(JSON.stringify(capsule)).not.toMatch(/PRIVATE_AUTH_TOKEN|private-target\.example|SECRET_STORAGE_VALUE|PRIVATE_POLICY|token=/);
  });

  it('maps Runtime Doctor target status to generic missing/stale labels only', () => {
    const base = createBasePetSnapshot();
    const targetCases: Array<[
      RuntimeDoctorReport['readiness']['targetStatus'],
      PetControlSnapshot['target'],
      PetControlSnapshot['blockerLens']['categories'],
    ]> = [
      ['missing', { locked: false, label: 'Target missing', stale: true, leaseStatus: 'none', leaseAgeMs: null, leaseExpiresInMs: null }, ['target']],
      ['unsupported', { locked: false, label: 'Target stale', stale: true, leaseStatus: 'none', leaseAgeMs: null, leaseExpiresInMs: null }, ['target']],
      ['not_controllable', { locked: false, label: 'Target stale', stale: true, leaseStatus: 'none', leaseAgeMs: null, leaseExpiresInMs: null }, ['target']],
      ['selected_active', { locked: false, label: null, stale: false, leaseStatus: 'none', leaseAgeMs: null, leaseExpiresInMs: null }, []],
    ];

    for (const [targetStatus, expected, expectedCategories] of targetCases) {
      const report = createRuntimeDoctorReport({
        readiness: { targetStatus },
        targetLock: {
          enabled: false,
          label: 'raw target title',
          origin: 'https://raw-target.example.com',
        },
      });
      const pet = mergeRuntimeDoctorReportIntoSnapshot(base, report);
      expect(pet.target).toEqual(expected);
      expect(pet.blockerLens.categories).toEqual(expectedCategories);
      expect(pet.blockerLens.primary).toBe(expectedCategories[0] ?? null);
      expect(pet.blockerLens.counts.target).toBe(expectedCategories.includes('target') ? 1 : 0);
    }
  });

  it('does not fabricate run state from Runtime Doctor report', () => {
    const base = createBasePetSnapshot({
      run: {
        active: true,
        label: 'Base run label',
        phase: 'reviewing',
        nextAction: 'Continue review',
      },
    });
    const report = createRuntimeDoctorReport({
      readiness: {
        ready: false,
        status: 'blocked',
        blockers: ['storage_leak'],
        targetStatus: 'unsupported',
      },
    });

    const pet = mergeRuntimeDoctorReportIntoSnapshot(base, report);

    expect(pet.run).toBe(base.run);
    expect(pet.run).toEqual({
      active: true,
      label: 'Base run label',
      phase: 'reviewing',
      nextAction: 'Continue review',
    });
  });

  it('privacy probe: source Runtime Doctor report secrets never appear in merged pet snapshot', () => {
    const base = createBasePetSnapshot({
      run: {
        active: true,
        label: 'Allowed base run label',
        phase: 'working',
        nextAction: 'Continue autonomous cycle',
      },
    });
    const targetSecret = 'https://doctor-target.example.com?token=TARGET_SECRET_123';
    const failureSecret = 'DOCTOR_FAILURE_SECRET_456';
    const suggestionSecret = 'DOCTOR_SUGGESTION_SECRET_789';
    const storageSecret = 'doctor.storage.path.SECRET_abc';
    const automationSecret = 'AUTOMATION_FAILURE_SECRET_xyz';
    const sampleSecret = 'doctor.sample.SECRET_path';
    const report = createRuntimeDoctorReport({
      readiness: {
        ready: false,
        status: 'blocked',
        blockers: ['storage_leak'],
        targetStatus: 'unsupported',
      },
      targetLock: {
        enabled: true,
        label: `raw label ${targetSecret}`,
        origin: targetSecret,
      },
      leakSentryIssueCount: 1,
      leakQuarantineIssueCount: 2,
      storageIssues: [{
        area: 'local',
        path: storageSecret,
        reason: 'storage_read_failed',
      }],
      leakQuarantineGroups: [{
        area: 'local',
        reason: 'storage_read_failed',
        count: 1,
        samplePaths: [sampleSecret],
        cleanupEligible: false,
      }],
      failureExplanations: [{
        blocker: 'storage_leak',
        severity: 'blocked',
        cause: failureSecret,
        action: `Open doctor ${failureSecret}`,
      }],
      debugSuggestions: [{
        id: 'secret-suggestion',
        kind: 'memory',
        title: `Suggestion ${suggestionSecret}`,
        preview: suggestionSecret,
        reason: `Because ${suggestionSecret}`,
      }],
      retryableFailure: {
        automationId: 'auto-secret',
        automationName: `Automation ${automationSecret}`,
        runId: null,
        code: automationSecret,
        message: `Message ${automationSecret}`,
        phase: 'runtime-doctor',
        at: 123,
      },
    });

    const reportJson = JSON.stringify(report);
    expect(reportJson).toContain('TARGET_SECRET_123');
    expect(reportJson).toContain(failureSecret);
    expect(reportJson).toContain(suggestionSecret);
    expect(reportJson).toContain(storageSecret);
    expect(reportJson).toContain(automationSecret);
    expect(reportJson).toContain(sampleSecret);

    const pet = mergeRuntimeDoctorReportIntoSnapshot(base, report);
    const petJson = JSON.stringify(pet);

    expect(pet).toMatchObject({
      readiness: { status: 'blocked', blockers: ['storage_leak'], preparing: false },
      target: { locked: true, label: 'Target stale', stale: true },
      safety: { leakIssueCount: 2, highRiskArmed: false },
      review: {
        grade: null,
        decision: null,
        proofDebtCount: 0,
        issueCount: 0,
        acceptedEvidenceCount: 0,
        canFinalize: false,
      },
    });
    expect(pet.run).toBe(base.run);
    expect(petJson).not.toContain('TARGET_SECRET_123');
    expect(petJson).not.toContain(failureSecret);
    expect(petJson).not.toContain(suggestionSecret);
    expect(petJson).not.toContain(storageSecret);
    expect(petJson).not.toContain(automationSecret);
    expect(petJson).not.toContain(sampleSecret);
    expect(petJson).toContain('Allowed base run label');
  });

  it('base pet snapshots include review defaults', () => {
    const pet = createBasePetSnapshot();
    expect(pet.review).toEqual({
      grade: null,
      decision: null,
      proofDebtCount: 0,
      issueCount: 0,
      acceptedEvidenceCount: 0,
      canFinalize: false,
    });
    expect(pet.reviewHeat).toEqual({ level: 'none', reasons: ['no_review'] });
    expect(pet.stopLine).toEqual({ available: false, action: 'none', reason: 'no_run', runStatus: null });
    const idleCockpit = {
      schemaVersion: 1 as const,
      generatedAt: 123,
      status: 'idle' as const,
      totals: { queued: 0, running: 0, paused: 0, blocked: 0, succeeded: 0, failed: 0, cancelled: 0 },
      activeRun: null,
    };
    const fromCockpit = createPetControlSnapshotFromRunCockpit(idleCockpit);
    expect(fromCockpit.review.grade).toBeNull();
    expect(fromCockpit.review.decision).toBeNull();
    expect(fromCockpit.review.proofDebtCount).toBe(0);
    expect(fromCockpit.review.canFinalize).toBe(false);
    expect(fromCockpit.reviewHeat).toEqual({ level: 'none', reasons: ['no_review'] });
    expect(fromCockpit.stopLine).toEqual({ available: false, action: 'none', reason: 'no_run', runStatus: null });
  });

  it('Runtime Doctor merge preserves review values already present in the base snapshot', () => {
    const base = createBasePetSnapshot({
      review: {
        grade: 'B',
        decision: 'pass',
        proofDebtCount: 0,
        issueCount: 1,
        acceptedEvidenceCount: 3,
        canFinalize: true,
      },
    });
    const report = createRuntimeDoctorReport();
    const pet = mergeRuntimeDoctorReportIntoSnapshot(base, report);
    expect(pet.review).toEqual(base.review);
    expect(pet.review.grade).toBe('B');
    expect(pet.review.canFinalize).toBe(true);
    expect(pet.reviewHeat).toEqual({ level: 'hot', reasons: ['review_issues'] });
  });

  it('completion review pass produces grade A/B, decision pass, proofDebtCount 0, issueCount 0, acceptedEvidenceCount > 0, canFinalize true', () => {
    const passReview: AutonomousRunCompletionReview = {
      decision: 'pass',
      grade: 'A',
      score: 95,
      issueCodes: [],
      requiredEvidenceMissing: [],
      doneCriteriaMissing: [],
      acceptedEvidenceIds: ['e1', 'e2'],
      error: null,
    };
    const base = createBasePetSnapshot();
    const pet = mergeAutonomousCompletionReviewIntoSnapshot(base, passReview);
    expect(pet.review.grade).toBe('A');
    expect(pet.review.decision).toBe('pass');
    expect(pet.review.proofDebtCount).toBe(0);
    expect(pet.review.issueCount).toBe(0);
    expect(pet.review.acceptedEvidenceCount).toBe(2);
    expect(pet.review.canFinalize).toBe(true);
    expect(pet.reviewHeat).toEqual({ level: 'cool', reasons: ['ready_to_finalize'] });

    // B grade pass
    const passB: AutonomousRunCompletionReview = { ...passReview, grade: 'B' };
    const petB = mergeAutonomousCompletionReviewIntoSnapshot(base, passB);
    expect(petB.review.grade).toBe('B');
    expect(petB.review.canFinalize).toBe(true);
    expect(petB.reviewHeat).toEqual({ level: 'cool', reasons: ['ready_to_finalize'] });
  });

  it('iterate/fail review produces correct counts and canFinalize false', () => {
    const iterateReview: AutonomousRunCompletionReview = {
      decision: 'iterate',
      grade: 'C',
      score: 65,
      issueCodes: ['done_criteria_missing', 'failed_steps_present'],
      requiredEvidenceMissing: ['req1'],
      doneCriteriaMissing: ['crit1'],
      acceptedEvidenceIds: ['e1'],
      error: { code: 'x', message: 'y', phase: 'review', retryable: true, at: 1, details: {} },
    };
    const base = createBasePetSnapshot();
    const pet = mergeAutonomousCompletionReviewIntoSnapshot(base, iterateReview);
    expect(pet.review.decision).toBe('iterate');
    expect(pet.review.grade).toBe('C');
    expect(pet.review.proofDebtCount).toBe(2); // 1+1
    expect(pet.review.issueCount).toBe(2);
    expect(pet.review.acceptedEvidenceCount).toBe(1);
    expect(pet.review.canFinalize).toBe(false);
    expect(pet.reviewHeat).toEqual({
      level: 'hot',
      reasons: ['proof_debt', 'review_issues', 'needs_iteration', 'low_grade'],
    });
    expect(pet.blockerLens.primary).toBe('evidence');
    expect(pet.blockerLens.categories).toEqual(['evidence', 'review']);
    expect(pet.blockerLens.counts).toMatchObject({ evidence: 2, review: 2 });

    const failReview: AutonomousRunCompletionReview = {
      ...iterateReview,
      decision: 'fail',
      grade: 'F',
      issueCodes: ['required_evidence_missing'],
      requiredEvidenceMissing: ['r1', 'r2'],
      doneCriteriaMissing: [],
      acceptedEvidenceIds: [],
    };
    const petF = mergeAutonomousCompletionReviewIntoSnapshot(base, failReview);
    expect(petF.review.decision).toBe('fail');
    expect(petF.review.proofDebtCount).toBe(2);
    expect(petF.review.issueCount).toBe(1);
    expect(petF.review.acceptedEvidenceCount).toBe(0);
    expect(petF.review.canFinalize).toBe(false);
    expect(petF.reviewHeat).toEqual({
      level: 'blocked',
      reasons: ['proof_debt', 'review_issues', 'review_failed', 'low_grade'],
    });
  });

  it('if review is null/undefined, return the original snapshot object unchanged', () => {
    const base = createBasePetSnapshot();
    expect(mergeAutonomousCompletionReviewIntoSnapshot(base, null)).toBe(base);
    expect(mergeAutonomousCompletionReviewIntoSnapshot(base, undefined)).toBe(base);
  });

  it('privacy false-positive probe: source review contains secret-looking strings in issueCodes, requiredEvidenceMissing, doneCriteriaMissing, acceptedEvidenceIds, and error details/message; merged pet snapshot JSON omits all of them while still reflecting safe counts/grade/decision', () => {
    const secretReview: AutonomousRunCompletionReview = {
      decision: 'iterate',
      grade: 'D',
      score: 50,
      issueCodes: ['done_criteria_missing', 'issue_with_SECRET_TOKEN_999'],
      requiredEvidenceMissing: ['evidence_SECRET_PASS_abc'],
      doneCriteriaMissing: ['crit_with_ultra_secret'],
      acceptedEvidenceIds: ['ev-id-SECRET_123'],
      error: {
        code: 'completion_review_iterate',
        message: 'iterate needed due to SECRET data',
        phase: 'review' as const,
        retryable: true,
        at: 200,
        details: { grade: 'D', issueCodes: ['secret'] },
      },
    };
    const reviewJson = JSON.stringify(secretReview);
    expect(reviewJson).toMatch(/SECRET_TOKEN|SECRET_PASS|ultra_secret|SECRET_123|SECRET data/);

    const base = createBasePetSnapshot();
    const pet = mergeAutonomousCompletionReviewIntoSnapshot(base, secretReview);
    const petJson = JSON.stringify(pet);
    const capsule = createPetHandoffCapsule(pet);
    const capsuleJson = JSON.stringify(capsule);
    expect(pet.review.grade).toBe('D');
    expect(pet.review.decision).toBe('iterate');
    expect(pet.review.proofDebtCount).toBe(2);
    expect(pet.review.issueCount).toBe(2);
    expect(pet.review.acceptedEvidenceCount).toBe(1);
    expect(pet.review.canFinalize).toBe(false);
    expect(pet.reviewHeat).toEqual({
      level: 'hot',
      reasons: ['proof_debt', 'review_issues', 'needs_iteration', 'low_grade'],
    });
    // prove no leak of raw
    expect(petJson).not.toMatch(/SECRET_TOKEN|SECRET_PASS|ultra_secret|SECRET_123|SECRET data/);
    expect(capsule.reviewHeatLevel).toBe('hot');
    expect(capsule.reviewHeatReasons).toEqual(['proof_debt', 'review_issues', 'needs_iteration', 'low_grade']);
    expect(capsuleJson).not.toMatch(/SECRET_TOKEN|SECRET_PASS|ultra_secret|SECRET_123|SECRET data/);
    expect(petJson).toContain('D'); // grade
  });

  it('returns the original pet snapshot when Runtime Doctor report is unavailable', () => {
    const base = createBasePetSnapshot({
      target: { locked: true, label: 'Target locked', stale: false },
    });

    expect(mergeRuntimeDoctorReportIntoSnapshot(base, null)).toBe(base);
    expect(mergeRuntimeDoctorReportIntoSnapshot(base, undefined)).toBe(base);
  });

  describe('createPetHandoffCapsule', () => {
    it('idle/ready snapshot creates a safe idle capsule with defaults', () => {
      const snap = createBaseForHandoff();
      const capsule = createPetHandoffCapsule(snap);

      expect(capsule).toMatchObject({
        schemaVersion: 1,
        generatedAt: 123,
        readinessStatus: 'ready',
        runPhase: 'idle',
        runQueueQueuedDepth: 0,
        runQueueRunningCount: 0,
        runQueuePausedCount: 0,
        runQueueBlockedCount: 0,
        runQueueBacklog: false,
        runQueueContention: false,
        runQueuePosture: 'idle',
        targetState: 'none',
        targetLeaseStatus: 'none',
        targetLeaseAgeMs: null,
        targetLeaseExpiresInMs: null,
        reviewState: 'none',
        blockerCount: 0,
        blockerPrimaryCategory: null,
        blockerCategories: [],
        blockerCategoryCounts: {
          auth: 0,
          target: 0,
          leak: 0,
          policy: 0,
          budget: 0,
          evidence: 0,
          review: 0,
          paused: 0,
          busy: 0,
          runtime: 0,
          unknown: 0,
        },
        proofDebtCount: 0,
        issueCount: 0,
        acceptedEvidenceCount: 0,
        reviewHeatLevel: 'none',
        reviewHeatReasons: ['no_review'],
        stopLineAvailable: false,
        stopLineAction: 'none',
        stopLineReason: 'no_run',
        evidenceStatus: 'none',
        evidenceCount: 0,
        latestEvidenceAgeMs: null,
        grade: null,
        canFinalize: false,
        memoryPressureEnabled: false,
        memoryPressureLevel: 'none',
        memoryPressureTruncated: false,
        memorySelectedCount: 0,
        memoryAvailableCount: 0,
        memorySelectedTokenEstimate: 0,
        memoryBudgetTokens: 0,
        workerCycleLastAction: null,
        workerCyclePolicyDecision: null,
        workerCycleIterationAction: null,
        workerCycleFinalStatus: null,
        workerCycleApplied: false,
        workerCycleAdvanced: false,
        workerCycleReviewGrade: null,
        workerCycleReviewDecision: null,
        workerCycleReviewScore: null,
        workerCycleReviewIssueCount: 0,
        workerCycleReviewProofDebtCount: 0,
        workerCycleAcceptedEvidenceCount: 0,
        workerCycleReviewErrorCode: null,
        schedulerWatchdogStatus: 'none',
        schedulerWatchdogDecision: null,
        schedulerWatchdogReason: null,
        schedulerWatchdogRetryable: false,
        schedulerWatchdogBlocksNextAction: false,
        schedulerWatchdogRecommendedStatus: null,
        schedulerWatchdogErrorCode: null,
        schedulerWatchdogStepCount: 0,
        schedulerWatchdogEvidenceCount: 0,
        schedulerWatchdogStaleEvidenceCount: 0,
        schedulerWatchdogExpiredEvidenceCount: 0,
        schedulerWatchdogBlockingLaneCount: 0,
        schedulerWatchdogQualityGateConflictCount: null,
        telemetryStatus: 'none',
        telemetryComplete: false,
        telemetryFileCount: 0,
        telemetryContentLength: 0,
        telemetryErrorCode: null,
        qualityGateStatus: 'none',
        qualityGateReason: null,
        qualityGateLatestStatus: null,
        qualityGateSeq: null,
        qualityGateCoverageComplete: null,
        qualityGateCoverageRowCount: null,
        qualityGateCoveredCount: null,
        qualityGateGapCount: null,
        qualityGateConflictCount: null,
        qualityGateNotTestableCount: null,
        qualityGateSelfReviewGrade: null,
        qualityGateFalsePositiveProbeStatus: null,
        qualityGateVerificationPassed: null,
        reviewLaneCount: 0,
        reviewLaneActiveCount: 0,
        reviewLanePassedCount: 0,
        reviewLaneBlockedCount: 0,
        reviewLaneFailedCount: 0,
        reviewLaneHighestPriority: null,
        reviewLaneWorstGrade: null,
        reviewLaneProceedCount: 0,
        reviewLaneIterateCount: 0,
        reviewLaneBlockCount: 0,
        reviewLaneUnknownCount: 0,
        reviewLaneSummaries: [],
        reviewLaneGateStatus: 'clear',
        reviewLaneGateReason: 'none',
        reviewLaneGateCanProceed: true,
        reviewLaneGateBlockingPriority: null,
        reviewLaneGateBlockingLaneCount: 0,
        safetyRedactionStatus: 'safe',
        safetyRedactionRedacted: false,
        safetyRedactionIssueCount: 0,
        safetyRedactionIssueCodes: [],
        safetyRedactionIssueCategories: [],
        safetyRedactionPolicyGate: 'not_applicable',
        nextAction: 'idle',
      });
      const json = JSON.stringify(capsule);
      expect(json).not.toContain('secret');
    });

    it('locked target + active run creates targetState locked and nextAction continue_run', () => {
      const snap = createBaseForHandoff({
        run: { active: true, label: 'secret goal label here', phase: 'working', nextAction: 'foo' },
        target: { locked: true, label: 'Target locked', stale: false },
        readiness: { status: 'ready', blockers: [], preparing: false },
      });
      const capsule = createPetHandoffCapsule(snap);

      expect(capsule.targetState).toBe('locked');
      expect(capsule.runPhase).toBe('working');
      expect(capsule.nextAction).toBe('continue_run');
      // must not leak raw label
      const json = JSON.stringify(capsule);
      expect(json).not.toContain('secret goal label here');
    });

    it('stale/missing target takes priority and nextAction open_target', () => {
      const stale = createBaseForHandoff({
        target: { locked: true, label: 'Target locked', stale: true },
        readiness: { status: 'ready', blockers: [], preparing: false },
        run: { active: true, phase: 'working' },
      });
      expect(createPetHandoffCapsule(stale).targetState).toBe('stale');
      expect(createPetHandoffCapsule(stale).nextAction).toBe('open_target');

      const missing = createBaseForHandoff({
        readiness: { status: 'needs_attention', blockers: ['x'], preparing: true },
        target: { locked: false, label: 'Target missing', stale: false },
      });
      expect(createPetHandoffCapsule(missing).targetState).toBe('missing');
      expect(createPetHandoffCapsule(missing).nextAction).toBe('open_target');
    });

    it('leak issue takes priority and nextAction open_runtime_doctor', () => {
      const snap = createBaseForHandoff({
        safety: { leakIssueCount: 2, highRiskArmed: false },
        target: { locked: false, label: null, stale: false },
        readiness: { status: 'ready', preparing: false },
        run: { active: false, phase: 'idle' },
      });
      const capsule = createPetHandoffCapsule(snap);
      expect(capsule.nextAction).toBe('open_runtime_doctor');
    });

    it('review pass canFinalize produces nextAction finalize', () => {
      const snap = createBaseForHandoff({
        readiness: { status: 'ready', preparing: false },
        target: { locked: true, stale: false },
        run: { active: true, phase: 'done' },
        review: { grade: 'A', decision: 'pass', proofDebtCount: 0, issueCount: 0, acceptedEvidenceCount: 5, canFinalize: true },
        reviewHeat: { level: 'cool', reasons: ['ready_to_finalize'] },
      });
      const capsule = createPetHandoffCapsule(snap);
      expect(capsule.reviewState).toBe('pass');
      expect(capsule.canFinalize).toBe(true);
      expect(capsule.reviewHeatLevel).toBe('cool');
      expect(capsule.reviewHeatReasons).toEqual(['ready_to_finalize']);
      expect(capsule.nextAction).toBe('finalize');
    });

    it('review iterate/proof debt produces nextAction iterate', () => {
      const iterateSnap = createBaseForHandoff({
        readiness: { status: 'ready', preparing: false },
        target: { locked: true, stale: false },
        run: { active: true, phase: 'reviewing' },
        review: { grade: 'C', decision: 'iterate', proofDebtCount: 1, issueCount: 1, acceptedEvidenceCount: 1, canFinalize: false },
        reviewHeat: { level: 'hot', reasons: ['proof_debt', 'review_issues', 'needs_iteration', 'low_grade'] },
      });
      const iterateCapsule = createPetHandoffCapsule(iterateSnap);
      expect(iterateCapsule.reviewHeatLevel).toBe('hot');
      expect(iterateCapsule.reviewHeatReasons).toEqual(['proof_debt', 'review_issues', 'needs_iteration', 'low_grade']);
      expect(iterateCapsule.nextAction).toBe('iterate');

      const debtSnap = createBaseForHandoff({
        readiness: { status: 'ready', preparing: false },
        target: { locked: true, stale: false },
        run: { active: true, phase: 'working' },
        review: { grade: 'B', decision: null, proofDebtCount: 3, issueCount: 0, acceptedEvidenceCount: 2, canFinalize: false },
        reviewHeat: { level: 'hot', reasons: ['proof_debt'] },
      });
      const debtCapsule = createPetHandoffCapsule(debtSnap);
      expect(debtCapsule.reviewHeatLevel).toBe('hot');
      expect(debtCapsule.reviewHeatReasons).toEqual(['proof_debt']);
      expect(debtCapsule.nextAction).toBe('iterate');
    });

    it('review fail produces reviewState fail while preserving safe issue count', () => {
      const snap = createBaseForHandoff({
        readiness: { status: 'ready', preparing: false },
        target: { locked: true, stale: false },
        run: { active: true, phase: 'reviewing' },
        review: { grade: 'F', decision: 'fail', proofDebtCount: 0, issueCount: 1, acceptedEvidenceCount: 0, canFinalize: false },
        reviewHeat: { level: 'blocked', reasons: ['review_issues', 'review_failed', 'low_grade'] },
      });
      const capsule = createPetHandoffCapsule(snap);

      expect(capsule.reviewState).toBe('fail');
      expect(capsule.issueCount).toBe(1);
      expect(capsule.reviewHeatLevel).toBe('blocked');
      expect(capsule.reviewHeatReasons).toEqual(['review_issues', 'review_failed', 'low_grade']);
      expect(capsule.nextAction).toBe('iterate');
    });

    it('blocked run produces nextAction review_blocker when readiness/target/leak do not override', () => {
      const snap = createBaseForHandoff({
        readiness: { status: 'blocked', blockers: ['policy'], preparing: false },
        target: { locked: true, stale: false },
        run: { active: true, phase: 'blocked' },
        review: { grade: null, decision: null, proofDebtCount: 0, issueCount: 0, acceptedEvidenceCount: 0, canFinalize: false },
      });
      const capsule = createPetHandoffCapsule(snap);
      expect(capsule.runPhase).toBe('blocked');
      expect(capsule.blockerCount).toBe(1);
      expect(capsule.nextAction).toBe('review_blocker');
    });

    it('privacy false-positive probe: source PetControlSnapshot contains secret-looking strings in run.label, readiness.blockers, target.label, and other string fields; capsule JSON omits them while still reflecting safe counts/enums', () => {
      const snap = createBaseForHandoff({
        readiness: {
          status: 'blocked',
          blockers: ['policy_deny with SECRET_LEAK_TOKEN_777', 'run_blocked_SECRET'],
          preparing: false,
        },
        run: {
          active: true,
          label: 'ultra secret run goal with password=supersecret and url https://leak.com',
          phase: 'blocked',
          nextAction: 'Review with token=SECRET_999',
        },
        target: {
          locked: true,
          label: 'Target locked but contains secret-target-title ultra-secret',
          stale: false,
        },
        safety: { leakIssueCount: 0, highRiskArmed: false },
        blockerLens: {
          primary: 'leak',
          categories: ['leak', 'target', 'policy'],
          counts: {
            auth: 0,
            target: 1,
            leak: 1,
            policy: 1,
            budget: 0,
            evidence: 0,
            review: 0,
            paused: 0,
            busy: 0,
            runtime: 0,
            unknown: 0,
          },
          total: 3,
        },
        review: {
          grade: 'D',
          decision: 'iterate',
          proofDebtCount: 2,
          issueCount: 2,
          acceptedEvidenceCount: 1,
          canFinalize: false,
        },
        reviewHeat: {
          level: 'hot',
          reasons: ['proof_debt', 'review_issues', 'needs_iteration', 'low_grade'],
        },
        stopLine: {
          available: true,
          action: 'cancel',
          reason: 'can_cancel',
          runStatus: 'blocked',
        },
        evidence: {
          status: 'stale',
          count: 3,
          freshCount: 0,
          staleCount: 2,
          expiredCount: 1,
          latestCapturedAt: 111,
          latestAgeMs: 12,
        },
      });
      const sourceJson = JSON.stringify(snap);
      expect(sourceJson).toMatch(/SECRET_LEAK_TOKEN_777|ultra secret|supersecret|SECRET_999|secret-target-title|ultra-secret/);

      const capsule = createPetHandoffCapsule(snap);
      const capsuleJson = JSON.stringify(capsule);

      // safe fields present
      expect(capsule.readinessStatus).toBe('blocked');
      expect(capsule.targetState).toBe('locked');
      expect(capsule.reviewState).toBe('iterate');
      expect(capsule.blockerCount).toBe(2);
      expect(capsule.blockerPrimaryCategory).toBe('leak');
      expect(capsule.blockerCategories).toEqual(['leak', 'target', 'policy']);
      expect(capsule.blockerCategoryCounts).toMatchObject({ leak: 1, target: 1, policy: 1 });
      expect(capsule.proofDebtCount).toBe(2);
      expect(capsule.reviewHeatLevel).toBe('hot');
      expect(capsule.reviewHeatReasons).toEqual(['proof_debt', 'review_issues', 'needs_iteration', 'low_grade']);
      expect(capsule.stopLineAvailable).toBe(true);
      expect(capsule.stopLineAction).toBe('cancel');
      expect(capsule.stopLineReason).toBe('can_cancel');
      expect(capsule.evidenceStatus).toBe('stale');
      expect(capsule.evidenceCount).toBe(3);
      expect(capsule.latestEvidenceAgeMs).toBe(12);
      expect(capsule.nextAction).toBe('review_blocker');
      expect(capsule.safetyRedactionStatus).toBe('redacted');
      expect(capsule.safetyRedactionRedacted).toBe(true);
      expect(capsule.safetyRedactionIssueCodes).toEqual(['redaction_applied']);
      expect(capsule.safetyRedactionIssueCategories).toEqual(['privacy']);
      expect(capsule.safetyRedactionPolicyGate).toBe('not_applicable');
      expect(extractCapsuleSafetyRedaction(capsule)).toEqual(
        createAutonomousSafetyRedactionSummary({
          surface: 'pet_handoff',
          metadataOnly: true,
          policyDecision: snap.workerCycle.policyDecision,
          redactionCandidates: [snap],
        }),
      );
      // no secrets leaked
      expect(capsuleJson).not.toMatch(/SECRET_LEAK_TOKEN_777|ultra secret|supersecret|SECRET_999|secret-target-title|ultra-secret|password=|https:\/\/leak/);
      // but does reflect the safe structure
      expect(capsuleJson).toContain('"reviewState":"iterate"');
      expect(capsuleJson).toContain('"blockerCount":2');
    });
  });

  describe('run queue telemetry', () => {
    const defaultRunQueue: PetControlSnapshot['runQueue'] = {
      queuedDepth: 0,
      runningCount: 0,
      pausedCount: 0,
      blockedCount: 0,
      backlog: false,
      contention: false,
      posture: 'idle',
    };
    const emptyTotals = {
      queued: 0,
      running: 0,
      paused: 0,
      blocked: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };

    it('createPetControlSnapshotFromRunCockpit and createBase default to no queued work observed', () => {
      const pet = createBasePetSnapshot();
      expect(pet.runQueue).toEqual(defaultRunQueue);
      const idleCockpit = {
        schemaVersion: 1 as const,
        generatedAt: 123,
        status: 'idle' as const,
        totals: emptyTotals,
        activeRun: null,
      };
      expect(createPetControlSnapshotFromRunCockpit(idleCockpit).runQueue).toEqual(defaultRunQueue);
      expect(createPetRunQueue(null)).toEqual(defaultRunQueue);
      expect(createPetRunQueue(undefined)).toEqual(defaultRunQueue);
    });

    it('createPetRunQueue derives waiting, draining, contention, and blocked-ahead posture from totals', () => {
      expect(createPetRunQueue({ ...emptyTotals, queued: 3 })).toEqual({
        ...defaultRunQueue,
        queuedDepth: 3,
        backlog: true,
        posture: 'waiting',
      });
      expect(createPetRunQueue({ ...emptyTotals, running: 1, queued: 2 })).toEqual({
        ...defaultRunQueue,
        queuedDepth: 2,
        runningCount: 1,
        backlog: true,
        contention: true,
        posture: 'draining',
      });
      expect(createPetRunQueue({ ...emptyTotals, blocked: 1, queued: 2 })).toEqual({
        ...defaultRunQueue,
        queuedDepth: 2,
        blockedCount: 1,
        backlog: true,
        posture: 'blocked_ahead',
      });
      expect(createPetRunQueue({ ...emptyTotals, paused: 1 })).toEqual({
        ...defaultRunQueue,
        pausedCount: 1,
        posture: 'held',
      });
      expect(createPetRunQueue({ ...emptyTotals, blocked: 1 })).toEqual({
        ...defaultRunQueue,
        blockedCount: 1,
        posture: 'held',
      });
      expect(createPetRunQueue({
        ...emptyTotals,
        queued: 2.8,
        running: Number.NaN,
        paused: -1,
        blocked: Number.POSITIVE_INFINITY,
      })).toEqual({
        ...defaultRunQueue,
        queuedDepth: 2,
        backlog: true,
        posture: 'waiting',
      });
    });

    it('createPetControlSnapshotFromRunCockpit wires non-idle totals into run queue projection', () => {
      const drainingPet = createPetControlSnapshotFromRunCockpit({
        schemaVersion: 1,
        generatedAt: 456,
        status: 'running',
        totals: { ...emptyTotals, running: 1, queued: 2 },
        activeRun: null,
      });

      expect(drainingPet.runQueue).toEqual({
        ...defaultRunQueue,
        queuedDepth: 2,
        runningCount: 1,
        backlog: true,
        contention: true,
        posture: 'draining',
      });

      const heldPet = createPetControlSnapshotFromRunCockpit({
        schemaVersion: 1,
        generatedAt: 457,
        status: 'paused',
        totals: { ...emptyTotals, paused: 1 },
        activeRun: null,
      });

      expect(heldPet.runQueue).toEqual({
        ...defaultRunQueue,
        pausedCount: 1,
        posture: 'held',
      });

      const blockedHeldPet = createPetControlSnapshotFromRunCockpit({
        schemaVersion: 1,
        generatedAt: 458,
        status: 'blocked',
        totals: { ...emptyTotals, blocked: 1 },
        activeRun: null,
      });

      expect(blockedHeldPet.runQueue).toEqual({
        ...defaultRunQueue,
        blockedCount: 1,
        posture: 'held',
      });
    });

    it('getPetControlSnapshot projects held posture from a durable blocked run', async () => {
      const { chromeStub } = createChromeStub();
      vi.stubGlobal('chrome', chromeStub);
      vi.stubGlobal('crypto', { randomUUID: () => 'queue-held-run' });

      const run = await createAutonomousRun({ id: 'queue-held-run', goal: 'Queue held run' }, 100);
      await transitionAutonomousRun(run.id, 'running', null, 110);
      await transitionAutonomousRun(run.id, 'blocked', {
        code: 'needs_review',
        message: 'Needs review',
        phase: 'review',
        retryable: true,
        at: 120,
      }, 120);

      const pet = await getPetControlSnapshot(130);
      const capsule = createPetHandoffCapsule(pet);

      expect(pet.runQueue).toEqual({
        ...defaultRunQueue,
        blockedCount: 1,
        posture: 'held',
      });
      expect(capsule.runQueueBlockedCount).toBe(1);
      expect(capsule.runQueuePosture).toBe('held');

      const pausedEnv = createChromeStub();
      vi.stubGlobal('chrome', pausedEnv.chromeStub);
      vi.stubGlobal('crypto', { randomUUID: () => 'queue-paused-run' });

      const paused = await createAutonomousRun({ id: 'queue-paused-run', goal: 'Queue paused run' }, 200);
      await transitionAutonomousRun(paused.id, 'running', null, 210);
      await transitionAutonomousRun(paused.id, 'paused', null, 220);

      const pausedPet = await getPetControlSnapshot(230);
      const pausedCapsule = createPetHandoffCapsule(pausedPet);

      expect(pausedPet.runQueue).toEqual({
        ...defaultRunQueue,
        pausedCount: 1,
        posture: 'held',
      });
      expect(pausedCapsule.runQueuePausedCount).toBe(1);
      expect(pausedCapsule.runQueuePosture).toBe('held');
    });


    it('createPetHandoffCapsule projects run queue fields and does not alter nextAction or adjacent lenses', () => {
      const base = createBaseForHandoff({
        run: { active: true, phase: 'working' },
        review: { grade: 'A', decision: 'pass', proofDebtCount: 0, issueCount: 0, acceptedEvidenceCount: 4, canFinalize: true },
      });
      const baseCapsule = createPetHandoffCapsule(base);
      const withQueue = createBaseForHandoff({
        run: base.run,
        review: base.review,
        runQueue: {
          queuedDepth: 2,
          runningCount: 1,
          pausedCount: 0,
          blockedCount: 0,
          backlog: true,
          contention: true,
          posture: 'draining',
        },
      });
      const capsule = createPetHandoffCapsule(withQueue);

      expect(capsule.nextAction).toBe(baseCapsule.nextAction);
      expect(capsule.nextAction).toBe('finalize');
      expect(capsule.runQueueQueuedDepth).toBe(withQueue.runQueue.queuedDepth);
      expect(capsule.runQueueRunningCount).toBe(withQueue.runQueue.runningCount);
      expect(capsule.runQueuePausedCount).toBe(withQueue.runQueue.pausedCount);
      expect(capsule.runQueueBlockedCount).toBe(withQueue.runQueue.blockedCount);
      expect(capsule.runQueueBacklog).toBe(withQueue.runQueue.backlog);
      expect(capsule.runQueueContention).toBe(withQueue.runQueue.contention);
      expect(capsule.runQueuePosture).toBe(withQueue.runQueue.posture);
      expect(withQueue.review).toEqual(base.review);
      expect(withQueue.reviewLaneGate).toEqual(base.reviewLaneGate);
      expect(withQueue.stopLine).toEqual(base.stopLine);
      expect(withQueue.workerCycle).toEqual(base.workerCycle);

      for (const queue of [
        {
          queuedDepth: 1,
          runningCount: 0,
          pausedCount: 0,
          blockedCount: 0,
          backlog: true,
          contention: false,
          posture: 'waiting' as const,
        },
        {
          queuedDepth: 0,
          runningCount: 0,
          pausedCount: 1,
          blockedCount: 0,
          backlog: false,
          contention: false,
          posture: 'held' as const,
        },
        {
          queuedDepth: 1,
          runningCount: 0,
          pausedCount: 0,
          blockedCount: 1,
          backlog: true,
          contention: false,
          posture: 'blocked_ahead' as const,
        },
      ]) {
        const projected = createPetHandoffCapsule(createBaseForHandoff({ runQueue: queue }));
        expect(projected).toMatchObject({
          runQueueQueuedDepth: queue.queuedDepth,
          runQueueRunningCount: queue.runningCount,
          runQueuePausedCount: queue.pausedCount,
          runQueueBlockedCount: queue.blockedCount,
          runQueueBacklog: queue.backlog,
          runQueueContention: queue.contention,
          runQueuePosture: queue.posture,
        });
      }
    });

    it('run queue projection carries counts only and does not leak run ids, goals, blockers, or labels', () => {
      const pet = createBaseForHandoff({
        readiness: { blockers: ['SECRET_BLOCKER'] },
        run: { active: true, label: 'SECRET_GOAL_LABEL run-id-SECRET', phase: 'working' },
        runQueue: {
          queuedDepth: 7,
          runningCount: 1,
          pausedCount: 1,
          blockedCount: 1,
          backlog: true,
          contention: true,
          posture: 'blocked_ahead',
        },
      });
      const capsule = createPetHandoffCapsule(pet);
      const capsuleRunQueue = {
        runQueueQueuedDepth: capsule.runQueueQueuedDepth,
        runQueueRunningCount: capsule.runQueueRunningCount,
        runQueuePausedCount: capsule.runQueuePausedCount,
        runQueueBlockedCount: capsule.runQueueBlockedCount,
        runQueueBacklog: capsule.runQueueBacklog,
        runQueueContention: capsule.runQueueContention,
        runQueuePosture: capsule.runQueuePosture,
      };

      expect(JSON.stringify(pet.runQueue)).not.toMatch(/SECRET_BLOCKER|SECRET_GOAL_LABEL|run-id|goal/i);
      expect(JSON.stringify(capsuleRunQueue)).not.toMatch(/SECRET_BLOCKER|SECRET_GOAL_LABEL|run-id-SECRET|goal/i);
      expect(JSON.stringify(capsule)).not.toMatch(/SECRET_BLOCKER|SECRET_GOAL_LABEL|run-id-SECRET/);
      expect(capsule.runQueueQueuedDepth).toBe(7);
    });
  });

  describe('memory pressure consumption', () => {
    it('createPetControlSnapshotFromRunCockpit and createBase default to no prompt pressure observed', () => {
      const pet = createBasePetSnapshot();
      expect(pet.memoryPressure).toEqual({
        enabled: false,
        level: 'none',
        truncated: false,
        selectedCount: 0,
        availableCount: 0,
        selectedTokenEstimate: 0,
        budgetTokens: 0,
      });
      const idleCockpit = {
        schemaVersion: 1 as const,
        generatedAt: 123,
        status: 'idle' as const,
        totals: { queued: 0, running: 0, paused: 0, blocked: 0, succeeded: 0, failed: 0, cancelled: 0 },
        activeRun: null,
      };
      expect(createPetControlSnapshotFromRunCockpit(idleCockpit).memoryPressure).toEqual(pet.memoryPressure);
    });

    it('mergePromptMemoryPressureIntoSnapshot returns original snapshot object unchanged if pressure null or undefined', () => {
      const snap = createBasePetSnapshot();
      const same1 = mergePromptMemoryPressureIntoSnapshot(snap, null);
      const same2 = mergePromptMemoryPressureIntoSnapshot(snap, undefined);
      expect(same1).toBe(snap);
      expect(same2).toBe(snap);
    });

    it('mergePromptMemoryPressureIntoSnapshot merges safe aggregate fields', () => {
      const snap = createBasePetSnapshot();
      const pressure = {
        enabled: true,
        promptTokens: 100,
        budgetTokens: 200,
        selectedCount: 2,
        selectedTokenEstimate: 150,
        availableCount: 5,
        pressure: 'medium' as const,
        truncated: true,
      };
      const merged = mergePromptMemoryPressureIntoSnapshot(snap, pressure);
      expect(merged).not.toBe(snap);
      expect(merged.memoryPressure).toEqual({
        enabled: true,
        level: 'medium',
        truncated: true,
        selectedCount: 2,
        availableCount: 5,
        selectedTokenEstimate: 150,
        budgetTokens: 200,
      });
      // original other fields preserved
      expect(merged.readiness.status).toBe('ready');
    });

    it('createPetHandoffCapsule projects compact safe memory pressure fields only', () => {
      const snap = createBaseForHandoff({
        memoryPressure: {
          enabled: true,
          level: 'high',
          truncated: true,
          selectedCount: 3,
          availableCount: 10,
          selectedTokenEstimate: 1200,
          budgetTokens: 1500,
        },
      });
      const capsule = createPetHandoffCapsule(snap);
      expect(capsule.memoryPressureEnabled).toBe(true);
      expect(capsule.memoryPressureLevel).toBe('high');
      expect(capsule.memoryPressureTruncated).toBe(true);
      expect(capsule.memorySelectedCount).toBe(3);
      expect(capsule.memoryAvailableCount).toBe(10);
      expect(capsule.memorySelectedTokenEstimate).toBe(1200);
      expect(capsule.memoryBudgetTokens).toBe(1500);
      // no raw ids or content in capsule (already in structure)
      const capJson = JSON.stringify(capsule);
      expect(capJson).not.toMatch(/memory ids|content|name|tag/);
    });

    it('memory pressure as metadata does not alter nextAction priority', () => {
      const base = createBaseForHandoff({ run: { active: true, phase: 'working' } });
      const baseCapsule = createPetHandoffCapsule(base);
      const withPressure = createBaseForHandoff({
        run: { active: true, phase: 'working' },
        memoryPressure: { enabled: true, level: 'high', truncated: false, selectedCount: 5, availableCount: 5, selectedTokenEstimate: 800, budgetTokens: 1000 },
      });
      const pressureCapsule = createPetHandoffCapsule(withPressure);
      expect(pressureCapsule.nextAction).toBe(baseCapsule.nextAction);
      expect(pressureCapsule.nextAction).toBe('continue_run');
    });

    it('privacy false-positive source probe: secrets in names/content/tags/prompt not present in pressure or handoff projection', () => {
      const snap = createBaseForHandoff({
        memoryPressure: {
          enabled: true,
          level: 'low',
          truncated: false,
          selectedCount: 1,
          availableCount: 1,
          selectedTokenEstimate: 10,
          budgetTokens: 100,
        },
      });
      // simulate source with secrets (though pressure itself is aggregate)
      const sourceWithSecret = { ...snap, _secretSource: 'memory name: TOPSECRET_MEM_NAME content: very secret prompt text tag: confidential' };
      const sourceJson = JSON.stringify(sourceWithSecret);
      expect(sourceJson).toMatch(/TOPSECRET_MEM_NAME|very secret|confidential/);

      const capsule = createPetHandoffCapsule(snap);
      const capJson = JSON.stringify(capsule);
      expect(capJson).not.toMatch(/TOPSECRET_MEM_NAME|very secret prompt|confidential/);
      // pressure fields are numbers/enums only
      expect(typeof capsule.memorySelectedCount).toBe('number');
    });
  });

  describe('worker cycle review consumption', () => {
    function createCycleResult(
      overrides: Partial<AutonomousRunCycleResult> = {},
    ): AutonomousRunCycleResult {
      return {
        action: 'advance',
        runId: 'run-secret-source-id',
        started: false,
        advanced: true,
        applied: true,
        policyDecision: 'allow',
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
        finalStatus: 'running',
        errorCode: null,
        ...overrides,
      };
    }

    it('createPetControlSnapshotFromRunCockpit and createBase default to no worker cycle observed', () => {
      const pet = createBasePetSnapshot();
      expect(pet.workerCycle).toEqual({
        lastAction: null,
        policyDecision: null,
        iterationAction: null,
        finalStatus: null,
        applied: false,
        advanced: false,
        reviewGrade: null,
        reviewDecision: null,
        reviewScore: null,
        reviewIssueCount: 0,
        reviewProofDebtCount: 0,
        acceptedEvidenceCount: 0,
        reviewErrorCode: null,
      });
      expect(pet.schedulerWatchdog).toEqual({
        status: 'none',
        decision: null,
        reason: null,
        retryable: false,
        blocksNextAction: false,
        recommendedStatus: null,
        errorCode: null,
        stepCount: 0,
        evidenceCount: 0,
        staleEvidenceCount: 0,
        expiredEvidenceCount: 0,
        blockingLaneCount: 0,
        qualityGateConflictCount: null,
      });
      const idleCockpit = {
        schemaVersion: 1 as const,
        generatedAt: 123,
        status: 'idle' as const,
        totals: { queued: 0, running: 0, paused: 0, blocked: 0, succeeded: 0, failed: 0, cancelled: 0 },
        activeRun: null,
      };
      expect(createPetControlSnapshotFromRunCockpit(idleCockpit).workerCycle).toEqual(pet.workerCycle);
      expect(createPetControlSnapshotFromRunCockpit(idleCockpit).schedulerWatchdog).toEqual(pet.schedulerWatchdog);
    });

    it('mergeAutonomousWorkerCycleResultIntoSnapshot returns original snapshot object unchanged if result null or undefined', () => {
      const snap = createBasePetSnapshot();
      expect(mergeAutonomousWorkerCycleResultIntoSnapshot(snap, null)).toBe(snap);
      expect(mergeAutonomousWorkerCycleResultIntoSnapshot(snap, undefined)).toBe(snap);
    });

    it('mergeAutonomousWorkerCycleResultIntoSnapshot projects safe review fields without changing review heat or next action inputs', () => {
      const snap = createBasePetSnapshot({
        run: { active: true, phase: 'working', nextAction: 'continue' },
        reviewHeat: { level: 'none', reasons: ['no_review'] },
      });
      const result = createCycleResult();

      const merged = mergeAutonomousWorkerCycleResultIntoSnapshot(snap, result);

      expect(merged).not.toBe(snap);
      expect(merged.workerCycle).toEqual({
        lastAction: 'advance',
        policyDecision: 'allow',
        iterationAction: 'iterate',
        finalStatus: 'running',
        applied: true,
        advanced: true,
        reviewGrade: 'B',
        reviewDecision: 'iterate',
        reviewScore: 82,
        reviewIssueCount: 1,
        reviewProofDebtCount: 2,
        acceptedEvidenceCount: 3,
        reviewErrorCode: 'completion_review_iterate',
      });
      expect(merged.review).toEqual(snap.review);
      expect(merged.reviewHeat).toEqual(snap.reviewHeat);
      expect(merged.run.nextAction).toBe('continue');
    });

    it('projects scheduler watchdog verdicts into safe pet and handoff metadata', () => {
      const snap = createBaseForHandoff({ run: { active: true, phase: 'working' } });
      const result = createCycleResult({
        schedulerWatchdogVerdict: {
          decision: 'mustBlock',
          reason: 'stale_evidence',
          retryable: true,
          blocksNextAction: true,
          recommendedStatus: 'blocked',
          error: {
            code: 'autonomous_watchdog_stale_evidence',
            message: 'raw message should not project',
            phase: 'verification',
            retryable: true,
            at: 200,
          },
          details: {
            stepCount: 2,
            evidenceCount: 3,
            staleEvidenceCount: 2,
            expiredEvidenceCount: 1,
            blockingLaneCount: 0,
            qualityGateConflictCount: 1,
          },
        },
      });

      const merged = mergeAutonomousWorkerCycleResultIntoSnapshot(snap, result);
      const capsule = createPetHandoffCapsule(merged);

      expect(merged.schedulerWatchdog).toEqual({
        status: 'blocked',
        decision: 'mustBlock',
        reason: 'stale_evidence',
        retryable: true,
        blocksNextAction: true,
        recommendedStatus: 'blocked',
        errorCode: 'autonomous_watchdog_stale_evidence',
        stepCount: 2,
        evidenceCount: 3,
        staleEvidenceCount: 2,
        expiredEvidenceCount: 1,
        blockingLaneCount: 0,
        qualityGateConflictCount: 1,
      });
      expect(capsule).toMatchObject({
        schedulerWatchdogStatus: 'blocked',
        schedulerWatchdogDecision: 'mustBlock',
        schedulerWatchdogReason: 'stale_evidence',
        schedulerWatchdogRetryable: true,
        schedulerWatchdogBlocksNextAction: true,
        schedulerWatchdogRecommendedStatus: 'blocked',
        schedulerWatchdogErrorCode: 'autonomous_watchdog_stale_evidence',
        schedulerWatchdogStepCount: 2,
        schedulerWatchdogEvidenceCount: 3,
        schedulerWatchdogStaleEvidenceCount: 2,
        schedulerWatchdogExpiredEvidenceCount: 1,
        schedulerWatchdogBlockingLaneCount: 0,
        schedulerWatchdogQualityGateConflictCount: 1,
      });
      expect(JSON.stringify(merged)).not.toContain('raw message should not project');
    });

    it('null reviewSummary still records cycle action/status metadata with zero review counters', () => {
      const snap = createBasePetSnapshot();
      const result = createCycleResult({
        action: 'block',
        advanced: false,
        applied: false,
        policyDecision: 'deny',
        iterationAction: null,
        reviewSummary: null,
        finalStatus: 'blocked',
        errorCode: 'policy_denied',
      });

      const merged = mergeAutonomousWorkerCycleResultIntoSnapshot(snap, result);

      expect(merged.workerCycle).toEqual({
        lastAction: 'block',
        policyDecision: 'deny',
        iterationAction: null,
        finalStatus: 'blocked',
        applied: false,
        advanced: false,
        reviewGrade: null,
        reviewDecision: null,
        reviewScore: null,
        reviewIssueCount: 0,
        reviewProofDebtCount: 0,
        acceptedEvidenceCount: 0,
        reviewErrorCode: null,
      });

      const capsule = createPetHandoffCapsule(merged);
      expect(capsule.safetyRedactionStatus).toBe('blocked');
      expect(capsule.safetyRedactionRedacted).toBe(false);
      expect(capsule.safetyRedactionIssueCodes).toEqual(['policy_denied']);
      expect(capsule.safetyRedactionIssueCategories).toEqual(['policy']);
      expect(capsule.safetyRedactionPolicyGate).toBe('deny');
    });

    it('createPetHandoffCapsule projects worker cycle fields that agree with the merged snapshot', () => {
      const snap = createBaseForHandoff({ run: { active: true, phase: 'working' } });
      const result = createCycleResult({
        reviewSummary: {
          action: 'succeed',
          completionDecision: 'pass',
          grade: 'A',
          score: 99,
          issueCount: 0,
          proofDebtCount: 0,
          acceptedEvidenceCount: 5,
          progressReason: null,
          errorCode: null,
        },
        iterationAction: 'succeed',
        finalStatus: 'succeeded',
      });

      const merged = mergeAutonomousWorkerCycleResultIntoSnapshot(snap, result);
      const capsule = createPetHandoffCapsule(merged);

      expect(capsule.workerCycleLastAction).toBe(merged.workerCycle.lastAction);
      expect(capsule.workerCyclePolicyDecision).toBe(merged.workerCycle.policyDecision);
      expect(capsule.workerCycleIterationAction).toBe(merged.workerCycle.iterationAction);
      expect(capsule.workerCycleFinalStatus).toBe(merged.workerCycle.finalStatus);
      expect(capsule.workerCycleApplied).toBe(merged.workerCycle.applied);
      expect(capsule.workerCycleAdvanced).toBe(merged.workerCycle.advanced);
      expect(capsule.workerCycleReviewGrade).toBe(merged.workerCycle.reviewGrade);
      expect(capsule.workerCycleReviewDecision).toBe(merged.workerCycle.reviewDecision);
      expect(capsule.workerCycleReviewScore).toBe(merged.workerCycle.reviewScore);
      expect(capsule.workerCycleReviewIssueCount).toBe(merged.workerCycle.reviewIssueCount);
      expect(capsule.workerCycleReviewProofDebtCount).toBe(merged.workerCycle.reviewProofDebtCount);
      expect(capsule.workerCycleAcceptedEvidenceCount).toBe(merged.workerCycle.acceptedEvidenceCount);
      expect(capsule.workerCycleReviewErrorCode).toBe(merged.workerCycle.reviewErrorCode);
      expect(capsule.safetyRedactionStatus).toBe('safe');
      expect(capsule.safetyRedactionPolicyGate).toBe('allow');
    });

    it('worker cycle metadata does not alter nextAction priority', () => {
      const base = createBaseForHandoff({
        run: { active: true, phase: 'working' },
        review: { grade: 'A', decision: 'pass', proofDebtCount: 0, issueCount: 0, acceptedEvidenceCount: 4, canFinalize: true },
      });
      const baseCapsule = createPetHandoffCapsule(base);
      const merged = mergeAutonomousWorkerCycleResultIntoSnapshot(base, createCycleResult());
      const cycleCapsule = createPetHandoffCapsule(merged);

      expect(baseCapsule.nextAction).toBe('finalize');
      expect(cycleCapsule.nextAction).toBe(baseCapsule.nextAction);
    });

    it('privacy false-positive probe: raw result IDs and extra summary strings stay out of pet snapshot and handoff projection', () => {
      const snap = createBaseForHandoff();
      const resultWithSecrets = createCycleResult({
        runId: 'run_SECRET_WORKER_ID_123',
        errorCode: 'top_SECRET_WORKER_ERROR',
        reviewSummary: {
          action: 'iterate',
          completionDecision: 'iterate',
          grade: 'C',
          score: 70,
          issueCount: 2,
          proofDebtCount: 1,
          acceptedEvidenceCount: 1,
          progressReason: 'no_progress',
          errorCode: 'SECRET_WORKER_REVIEW_ERROR',
          rawEvidenceIds: ['ev_SECRET_EVIDENCE_456'],
          rawMessage: 'password=worker-secret',
        } as AutonomousRunCycleResult['reviewSummary'] & Record<string, unknown>,
        schedulerWatchdogVerdict: {
          decision: 'mustBlock',
          reason: 'quality_gate_blocked',
          retryable: true,
          blocksNextAction: true,
          recommendedStatus: 'blocked',
          error: {
            code: 'SECRET_WATCHDOG_ERROR',
            message: 'watchdog password=secret',
            phase: 'verification',
            retryable: true,
            at: 100,
          },
          details: {
            stepCount: 1,
            evidenceCount: 1,
            staleEvidenceCount: 0,
            expiredEvidenceCount: 0,
            blockingLaneCount: 0,
            qualityGateConflictCount: 0,
          },
        } as any,
        rawTranscript: 'model said TOPSECRET_WORKER_TRANSCRIPT',
      } as Partial<AutonomousRunCycleResult> & Record<string, unknown>);
      const sourceJson = JSON.stringify(resultWithSecrets);
      expect(sourceJson).toMatch(/SECRET_WORKER_ID_123|SECRET_EVIDENCE_456|worker-secret|TOPSECRET_WORKER_TRANSCRIPT|SECRET_WORKER_ERROR/);

      const merged = mergeAutonomousWorkerCycleResultIntoSnapshot(snap, resultWithSecrets);
      const capsule = createPetHandoffCapsule(merged);
      const petJson = JSON.stringify(merged);
      const capsuleJson = JSON.stringify(capsule);

      expect(merged.workerCycle.reviewGrade).toBe('C');
      expect(merged.workerCycle.reviewIssueCount).toBe(2);
      expect(merged.workerCycle.reviewProofDebtCount).toBe(1);
      expect(merged.workerCycle.reviewErrorCode).toBe('unknown_worker_cycle_error');
      expect(merged.schedulerWatchdog.errorCode).toBe('unknown_watchdog_error');
      expect(capsule.workerCycleReviewGrade).toBe('C');
      expect(capsule.workerCycleReviewIssueCount).toBe(2);
      expect(capsule.workerCycleReviewErrorCode).toBe('unknown_worker_cycle_error');
      expect(capsule.schedulerWatchdogErrorCode).toBe('unknown_watchdog_error');
      expect(petJson).not.toMatch(/SECRET_WORKER_ID_123|SECRET_EVIDENCE_456|worker-secret|TOPSECRET_WORKER_TRANSCRIPT|SECRET_WORKER_ERROR|SECRET_WATCHDOG_ERROR|password=/);
      expect(capsuleJson).not.toMatch(/SECRET_WORKER_ID_123|SECRET_EVIDENCE_456|worker-secret|TOPSECRET_WORKER_TRANSCRIPT|SECRET_WORKER_ERROR|SECRET_WATCHDOG_ERROR|password=/);
    });
  });

  describe('telemetry handoff consumption', () => {
    function createTelemetryResult(
      overrides: Partial<Extract<AutonomousRunOrchestratorTelemetryResult, { status: 'written' }>> = {},
    ): AutonomousRunOrchestratorTelemetryResult {
      return {
        status: 'written',
        runId: 'run-secret-raw-id',
        rootDir: '.runs/run-secret-raw-id',
        fileCount: 12,
        contentLength: 1234,
        paths: [
          '.runs/run-secret-raw-id/manifest.json',
          '.runs/run-secret-raw-id/handoff.json',
          '.runs/run-secret-raw-id/quality-gates.ndjson',
          '.runs/run-secret-raw-id/review-lanes.ndjson',
          '.runs/run-secret-raw-id/.complete.json',
        ],
        errorCode: null,
        ...overrides,
      };
    }

    it('createPetControlSnapshotFromRunCockpit and createBase default to no telemetry observed', () => {
      const pet = createBasePetSnapshot();
      expect(pet.telemetry).toEqual({
        status: 'none',
        complete: false,
        fileCount: 0,
        contentLength: 0,
        errorCode: null,
        qualityGatePackagePresent: false,
        reviewLanePackagePresent: false,
      });
      const idleCockpit = {
        schemaVersion: 1 as const,
        generatedAt: 123,
        status: 'idle' as const,
        totals: { queued: 0, running: 0, paused: 0, blocked: 0, succeeded: 0, failed: 0, cancelled: 0 },
        activeRun: null,
      };
      expect(createPetControlSnapshotFromRunCockpit(idleCockpit).telemetry).toEqual(pet.telemetry);
    });

    it('mergeOrchestratorTelemetryResultIntoSnapshot returns original snapshot object unchanged if result null or undefined', () => {
      const snap = createBasePetSnapshot();
      expect(mergeOrchestratorTelemetryResultIntoSnapshot(snap, null)).toBe(snap);
      expect(mergeOrchestratorTelemetryResultIntoSnapshot(snap, undefined)).toBe(snap);
    });

    it('mergeOrchestratorTelemetryResultIntoSnapshot projects completion marker and safe counts only', () => {
      const snap = createBasePetSnapshot();
      const merged = mergeOrchestratorTelemetryResultIntoSnapshot(snap, createTelemetryResult());

      expect(merged).not.toBe(snap);
      expect(merged.telemetry).toEqual({
        status: 'written',
        complete: true,
        fileCount: 12,
        contentLength: 1234,
        errorCode: null,
        qualityGatePackagePresent: true,
        reviewLanePackagePresent: true,
      });
    });

    it('mergeOrchestratorTelemetryResultIntoSnapshot requires completion marker and normalizes counts', () => {
      const snap = createBasePetSnapshot();
      const merged = mergeOrchestratorTelemetryResultIntoSnapshot(snap, createTelemetryResult({
        fileCount: -9.8,
        contentLength: Number.NaN,
        paths: [
          '.runs/run-secret-raw-id/manifest.json',
          '.runs/run-secret-raw-id/quality-gates.ndjson',
          '.runs/run-secret-raw-id/review-lanes.ndjson',
        ],
      }));

      expect(merged.telemetry).toEqual({
        status: 'written',
        complete: false,
        fileCount: 0,
        contentLength: 0,
        errorCode: null,
        qualityGatePackagePresent: false,
        reviewLanePackagePresent: false,
      });
    });

    it('mergeOrchestratorTelemetryResultIntoSnapshot never trusts a completion marker on non-written telemetry', () => {
      const snap = createBasePetSnapshot();
      const malformedSkippedResult = {
        status: 'skipped',
        runId: null,
        rootDir: null,
        fileCount: 3,
        contentLength: 500,
        paths: [
          '.runs/run-secret-raw-id/quality-gates.ndjson',
          '.runs/run-secret-raw-id/review-lanes.ndjson',
          '.runs/run-secret-raw-id/.complete.json',
        ],
        errorCode: 'target_unavailable',
      } as unknown as AutonomousRunOrchestratorTelemetryResult;

      const merged = mergeOrchestratorTelemetryResultIntoSnapshot(snap, malformedSkippedResult);

      expect(merged.telemetry).toEqual({
        status: 'skipped',
        complete: false,
        fileCount: 3,
        contentLength: 500,
        errorCode: 'target_unavailable',
        qualityGatePackagePresent: false,
        reviewLanePackagePresent: false,
      });
    });

    it('mergeOrchestratorTelemetryResultIntoSnapshot projects failed and skipped telemetry as safe metadata only', () => {
      const snap = createBasePetSnapshot();
      const failed: AutonomousRunOrchestratorTelemetryResult = {
        status: 'failed',
        runId: 'SECRET_FAILED_RUN',
        rootDir: '.runs/SECRET_FAILED_RUN',
        fileCount: 0,
        contentLength: 0,
        paths: [],
        errorCode: 'telemetry_write_failed',
      };
      const skipped: AutonomousRunOrchestratorTelemetryResult = {
        status: 'skipped',
        runId: null,
        rootDir: null,
        fileCount: 0,
        contentLength: 0,
        paths: [],
        errorCode: 'no_selected_run',
      };

      const failedPet = mergeOrchestratorTelemetryResultIntoSnapshot(snap, failed);
      const skippedPet = mergeOrchestratorTelemetryResultIntoSnapshot(snap, skipped);

      expect(failedPet.telemetry).toEqual({
        status: 'failed',
        complete: false,
        fileCount: 0,
        contentLength: 0,
        errorCode: 'telemetry_write_failed',
        qualityGatePackagePresent: false,
        reviewLanePackagePresent: false,
      });
      expect(skippedPet.telemetry).toEqual({
        status: 'skipped',
        complete: false,
        fileCount: 0,
        contentLength: 0,
        errorCode: 'no_selected_run',
        qualityGatePackagePresent: false,
        reviewLanePackagePresent: false,
      });
      expect(JSON.stringify(failedPet)).not.toMatch(/SECRET_FAILED_RUN/);
    });

    it('createPetHandoffCapsule projects telemetry fields that agree with the merged snapshot', () => {
      const snap = createBaseForHandoff();
      const merged = mergeOrchestratorTelemetryResultIntoSnapshot(snap, createTelemetryResult());
      const capsule = createPetHandoffCapsule(merged);

      expect(capsule.telemetryStatus).toBe(merged.telemetry.status);
      expect(capsule.telemetryComplete).toBe(merged.telemetry.complete);
      expect(capsule.telemetryFileCount).toBe(merged.telemetry.fileCount);
      expect(capsule.telemetryContentLength).toBe(merged.telemetry.contentLength);
      expect(capsule.telemetryErrorCode).toBe(merged.telemetry.errorCode);
      expect(capsule.telemetryQualityGatePackagePresent).toBe(merged.telemetry.qualityGatePackagePresent);
      expect(capsule.telemetryReviewLanePackagePresent).toBe(merged.telemetry.reviewLanePackagePresent);
    });

    it('telemetry metadata does not alter nextAction priority', () => {
      const base = createBaseForHandoff({
        run: { active: true, phase: 'working' },
        review: { grade: 'A', decision: 'pass', proofDebtCount: 0, issueCount: 0, acceptedEvidenceCount: 4, canFinalize: true },
      });
      const baseCapsule = createPetHandoffCapsule(base);
      const merged = mergeOrchestratorTelemetryResultIntoSnapshot(base, createTelemetryResult());
      const telemetryCapsule = createPetHandoffCapsule(merged);

      expect(baseCapsule.nextAction).toBe('finalize');
      expect(telemetryCapsule.nextAction).toBe(baseCapsule.nextAction);
    });

    it('privacy false-positive probe: raw telemetry paths, roots, run ids, and unknown errors stay out of pet and handoff projection', () => {
      const snap = createBaseForHandoff();
      const resultWithSecrets = createTelemetryResult({
        runId: 'SECRET_TELEMETRY_RUN_ID',
        rootDir: '.runs/SECRET_TELEMETRY_ROOT',
        paths: [
          '.runs/SECRET_TELEMETRY_ROOT/manifest.json',
          '.runs/SECRET_TELEMETRY_ROOT/private?token=secret',
          '.runs/SECRET_TELEMETRY_ROOT/.complete.json',
        ],
        errorCode: 'SECRET_TELEMETRY_ERROR' as any,
      });
      const sourceJson = JSON.stringify(resultWithSecrets);
      expect(sourceJson).toMatch(/SECRET_TELEMETRY_RUN_ID|SECRET_TELEMETRY_ROOT|SECRET_TELEMETRY_ERROR|token=secret/);

      const merged = mergeOrchestratorTelemetryResultIntoSnapshot(snap, resultWithSecrets);
      const capsule = createPetHandoffCapsule(merged);
      const petJson = JSON.stringify(merged);
      const capsuleJson = JSON.stringify(capsule);

      expect(merged.telemetry).toEqual({
        status: 'written',
        complete: true,
        fileCount: 12,
        contentLength: 1234,
        errorCode: 'unknown_telemetry_error',
        qualityGatePackagePresent: false,
        reviewLanePackagePresent: false,
      });
      expect(capsule.telemetryErrorCode).toBe('unknown_telemetry_error');
      expect(petJson).not.toMatch(/SECRET_TELEMETRY_RUN_ID|SECRET_TELEMETRY_ROOT|SECRET_TELEMETRY_ERROR|token=secret|private\?/);
      expect(capsuleJson).not.toMatch(/SECRET_TELEMETRY_RUN_ID|SECRET_TELEMETRY_ROOT|SECRET_TELEMETRY_ERROR|token=secret|private\?/);
    });
  });

  describe('quality gate handoff consumption', () => {
    function createQualityGateDecision(
      overrides: Partial<AutonomousRunQualityGateDecision> = {},
    ): AutonomousRunQualityGateDecision {
      return {
        blocked: false,
        reason: 'gate_passed',
        latestGateStatus: 'passed',
        seq: 1,
        coverageComplete: true,
        coverageRowCount: 5,
        coveredCount: 5,
        gapCount: 0,
        conflictCount: 0,
        notTestableCount: 0,
        selfReviewGrade: 'A',
        falsePositiveProbeStatus: 'passed',
        verificationPassed: true,
        ...overrides,
      };
    }

    it('createPetControlSnapshotFromRunCockpit and createBase default to no quality gate observed', () => {
      const pet = createBasePetSnapshot();
      expect(pet.qualityGate).toEqual({
        status: 'none',
        reason: null,
        latestGateStatus: null,
        seq: null,
        coverageComplete: null,
        coverageRowCount: null,
        coveredCount: null,
        gapCount: null,
        conflictCount: null,
        notTestableCount: null,
        selfReviewGrade: null,
        falsePositiveProbeStatus: null,
        verificationPassed: null,
      });
      const idleCockpit = {
        schemaVersion: 1 as const,
        generatedAt: 123,
        status: 'idle' as const,
        totals: { queued: 0, running: 0, paused: 0, blocked: 0, succeeded: 0, failed: 0, cancelled: 0 },
        activeRun: null,
      };
      expect(createPetControlSnapshotFromRunCockpit(idleCockpit).qualityGate).toEqual(pet.qualityGate);
    });

    it('mergeAutonomousQualityGateDecisionIntoSnapshot returns original snapshot object unchanged if decision null or undefined', () => {
      const snap = createBasePetSnapshot();
      expect(mergeAutonomousQualityGateDecisionIntoSnapshot(snap, null)).toBe(snap);
      expect(mergeAutonomousQualityGateDecisionIntoSnapshot(snap, undefined)).toBe(snap);
    });

    it('projects blocked quality gates into safe pet and handoff metadata', () => {
      const snap = createBaseForHandoff({
        run: { active: true, phase: 'working' },
        target: { locked: true, stale: false },
      });
      const decision = createQualityGateDecision({
        blocked: true,
        reason: 'state_inconsistent',
        latestGateStatus: 'failed',
        seq: 2.7,
        coverageComplete: false,
        coverageRowCount: 6,
        coveredCount: 4,
        gapCount: 1,
        conflictCount: 0,
        notTestableCount: 1,
        selfReviewGrade: 'D',
        falsePositiveProbeStatus: 'failed',
        verificationPassed: false,
      });

      const merged = mergeAutonomousQualityGateDecisionIntoSnapshot(snap, decision);
      const capsule = createPetHandoffCapsule(merged);

      expect(merged.qualityGate).toEqual({
        status: 'blocked',
        reason: 'state_inconsistent',
        latestGateStatus: 'failed',
        seq: 2,
        coverageComplete: false,
        coverageRowCount: 6,
        coveredCount: 4,
        gapCount: 1,
        conflictCount: 0,
        notTestableCount: 1,
        selfReviewGrade: 'D',
        falsePositiveProbeStatus: 'failed',
        verificationPassed: false,
      });
      expect(merged.blockerLens).toMatchObject({
        primary: 'review',
        categories: ['review'],
        counts: { review: 1 },
        total: 1,
      });
      expect(capsule).toMatchObject({
        qualityGateStatus: 'blocked',
        qualityGateReason: 'state_inconsistent',
        qualityGateLatestStatus: 'failed',
        qualityGateSeq: 2,
        qualityGateCoverageComplete: false,
        qualityGateCoverageRowCount: 6,
        qualityGateCoveredCount: 4,
        qualityGateGapCount: 1,
        qualityGateConflictCount: 0,
        qualityGateNotTestableCount: 1,
        qualityGateSelfReviewGrade: 'D',
        qualityGateFalsePositiveProbeStatus: 'failed',
        qualityGateVerificationPassed: false,
        nextAction: 'review_blocker',
      });
    });

    it('blocked quality gates respect higher-priority leak and target actions and override finalize', () => {
      const blockedDecision = createQualityGateDecision({
        blocked: true,
        reason: 'gate_blocked',
        latestGateStatus: 'blocked',
      });

      const leak = mergeAutonomousQualityGateDecisionIntoSnapshot(createBaseForHandoff({
        safety: { leakIssueCount: 1, highRiskArmed: false },
        target: { locked: true, stale: false },
        run: { active: true, phase: 'working' },
        review: { grade: 'A', decision: 'pass', proofDebtCount: 0, issueCount: 0, acceptedEvidenceCount: 3, canFinalize: true },
      }), blockedDecision);
      expect(createPetHandoffCapsule(leak).nextAction).toBe('open_runtime_doctor');

      const staleTarget = mergeAutonomousQualityGateDecisionIntoSnapshot(createBaseForHandoff({
        target: { locked: true, stale: true },
        run: { active: true, phase: 'working' },
        review: { grade: 'A', decision: 'pass', proofDebtCount: 0, issueCount: 0, acceptedEvidenceCount: 3, canFinalize: true },
      }), blockedDecision);
      expect(createPetHandoffCapsule(staleTarget).nextAction).toBe('open_target');

      const finalizable = mergeAutonomousQualityGateDecisionIntoSnapshot(createBaseForHandoff({
        target: { locked: true, stale: false },
        run: { active: true, phase: 'done' },
        review: { grade: 'A', decision: 'pass', proofDebtCount: 0, issueCount: 0, acceptedEvidenceCount: 3, canFinalize: true },
      }), blockedDecision);
      expect(createPetHandoffCapsule(finalizable).nextAction).toBe('review_blocker');
    });

    it('warning and clear quality gates are informational and do not alter nextAction priority', () => {
      const base = createBaseForHandoff({
        run: { active: true, phase: 'working' },
        target: { locked: true, stale: false },
      });
      const baseCapsule = createPetHandoffCapsule(base);
      const warning = mergeAutonomousQualityGateDecisionIntoSnapshot(base, createQualityGateDecision({
        blocked: false,
        reason: 'gate_warning',
        latestGateStatus: 'warning',
        verificationPassed: false,
      }));
      const clear = mergeAutonomousQualityGateDecisionIntoSnapshot(base, createQualityGateDecision());

      expect(baseCapsule.nextAction).toBe('continue_run');
      expect(warning.qualityGate.status).toBe('warning');
      expect(createPetHandoffCapsule(warning).nextAction).toBe('continue_run');
      expect(clear.qualityGate.status).toBe('clear');
      expect(createPetHandoffCapsule(clear).nextAction).toBe('continue_run');
    });

    it('normalizes no-gate decisions and malformed numeric fields to safe metadata', () => {
      const snap = createBaseForHandoff();
      const decision = createQualityGateDecision({
        blocked: false,
        reason: 'no_quality_gate',
        latestGateStatus: null,
        seq: Number.NaN,
        coverageComplete: null,
        coverageRowCount: Number.POSITIVE_INFINITY,
        coveredCount: -10,
        gapCount: Number.POSITIVE_INFINITY,
        conflictCount: null,
        notTestableCount: 2.9,
        selfReviewGrade: null,
        falsePositiveProbeStatus: null,
        verificationPassed: null,
      });

      const merged = mergeAutonomousQualityGateDecisionIntoSnapshot(snap, decision);
      const capsule = createPetHandoffCapsule(merged);

      expect(merged.qualityGate).toMatchObject({
        status: 'none',
        reason: 'no_quality_gate',
        latestGateStatus: null,
        seq: null,
        coverageRowCount: null,
        coveredCount: 0,
        gapCount: null,
        conflictCount: null,
        notTestableCount: 2,
      });
      expect(capsule.qualityGateStatus).toBe('none');
      expect(capsule.qualityGateSeq).toBeNull();
      expect(capsule.qualityGateCoveredCount).toBe(0);
      expect(capsule.qualityGateGapCount).toBeNull();
      expect(capsule.qualityGateNotTestableCount).toBe(2);
    });

    it('privacy false-positive probe: raw gate ids, commands, reviewer prose, urls, and secrets stay out of pet and handoff projection', () => {
      const snap = createBaseForHandoff();
      const decisionWithSecrets = {
        ...createQualityGateDecision({
          blocked: true,
          reason: 'review_issues',
          latestGateStatus: 'blocked',
          selfReviewGrade: 'F',
          verificationPassed: false,
        }),
        rawGateId: 'SECRET_GATE_ID_123',
        commandName: 'SECRET_COMMAND',
        commandSummary: 'SECRET_SUMMARY',
        reviewerProse: 'reviewer says password=SECRET_PASSWORD',
        privateUrl: 'https://example.com/private?token=SECRET_TOKEN',
        publicUrlWithoutSecret: 'https://example.com/public-gate-report',
      } as AutonomousRunQualityGateDecision & Record<string, unknown>;
      const sourceJson = JSON.stringify(decisionWithSecrets);
      expect(sourceJson).toMatch(/SECRET_GATE_ID_123|SECRET_COMMAND|SECRET_SUMMARY|SECRET_PASSWORD|SECRET_TOKEN|example\.com\/private|example\.com\/public-gate-report/);

      const merged = mergeAutonomousQualityGateDecisionIntoSnapshot(snap, decisionWithSecrets);
      const capsule = createPetHandoffCapsule(merged);
      const petJson = JSON.stringify(merged);
      const capsuleJson = JSON.stringify(capsule);

      expect(merged.qualityGate.status).toBe('blocked');
      expect(capsule.qualityGateSelfReviewGrade).toBe('F');
      expect(petJson).not.toMatch(/SECRET_GATE_ID_123|SECRET_COMMAND|SECRET_SUMMARY|SECRET_PASSWORD|SECRET_TOKEN|example\.com|private\?token|public-gate-report/);
      expect(capsuleJson).not.toMatch(/SECRET_GATE_ID_123|SECRET_COMMAND|SECRET_SUMMARY|SECRET_PASSWORD|SECRET_TOKEN|example\.com|private\?token|public-gate-report/);
    });
  });

  describe('review lane telemetry', () => {
    const defaultReviewLanes: PetControlSnapshot['reviewLanes'] = {
      total: 0,
      activeCount: 0,
      passedCount: 0,
      blockedCount: 0,
      failedCount: 0,
      highestPriority: null,
      worstGrade: null,
      proceedCount: 0,
      iterateCount: 0,
      blockCount: 0,
      unknownCount: 0,
      lanes: [],
    };
    const defaultReviewLaneGate: PetControlSnapshot['reviewLaneGate'] = {
      status: 'clear',
      reason: 'none',
      canProceed: true,
      blockingPriority: null,
      blockingLaneCount: 0,
    };

    it('createPetControlSnapshotFromRunCockpit and createBase default to no review lanes observed', () => {
      const pet = createBasePetSnapshot();
      expect(pet.reviewLanes).toEqual(defaultReviewLanes);
      expect(pet.reviewLaneGate).toEqual(defaultReviewLaneGate);
      const idleCockpit = {
        schemaVersion: 1 as const,
        generatedAt: 123,
        status: 'idle' as const,
        totals: { queued: 0, running: 0, paused: 0, blocked: 0, succeeded: 0, failed: 0, cancelled: 0 },
        activeRun: null,
      };
      const cockpitPet = createPetControlSnapshotFromRunCockpit(idleCockpit);
      expect(cockpitPet.reviewLanes).toEqual(defaultReviewLanes);
      expect(cockpitPet.reviewLaneGate).toEqual(defaultReviewLaneGate);
    });

    it('mergePetReviewLanesIntoSnapshot returns original snapshot object unchanged if lanes null or undefined', () => {
      const snap = createBasePetSnapshot();
      expect(mergePetReviewLanesIntoSnapshot(snap, null)).toBe(snap);
      expect(mergePetReviewLanesIntoSnapshot(snap, undefined)).toBe(snap);
    });

    it('mergePetReviewLanesIntoSnapshot normalizes valid lanes and aggregates counts', () => {
      const snap = createBasePetSnapshot();
      const merged = mergePetReviewLanesIntoSnapshot(snap, [
        {
          role: 'implementer',
          status: 'running',
          grade: 'B',
          recommendation: 'iterate',
          highestPriority: 'P2',
          issueCount: 2.8,
          updatedAt: 200,
        },
        {
          role: 'reviewer',
          status: 'passed',
          grade: 'A',
          recommendation: 'proceed',
          highestPriority: null,
          issueCount: 0,
          updatedAt: 210,
        },
        {
          role: 'safety',
          status: 'blocked',
          grade: 'F',
          recommendation: 'block',
          highestPriority: 'P1',
          issueCount: 3,
          updatedAt: 220,
        },
      ]);

      expect(merged).not.toBe(snap);
      expect(merged.reviewLanes).toEqual({
        total: 3,
        activeCount: 1,
        passedCount: 1,
        blockedCount: 1,
        failedCount: 0,
        highestPriority: 'P1',
        worstGrade: 'F',
        proceedCount: 1,
        iterateCount: 1,
        blockCount: 1,
        unknownCount: 0,
        lanes: [
          {
            role: 'implementer',
            status: 'running',
            grade: 'B',
            recommendation: 'iterate',
            highestPriority: 'P2',
            issueCount: 2,
            updatedAt: 200,
          },
          {
            role: 'reviewer',
            status: 'passed',
            grade: 'A',
            recommendation: 'proceed',
            highestPriority: null,
            issueCount: 0,
            updatedAt: 210,
          },
          {
            role: 'safety',
            status: 'blocked',
            grade: 'F',
            recommendation: 'block',
            highestPriority: 'P1',
            issueCount: 3,
            updatedAt: 220,
          },
        ],
      });
      expect(merged.reviewLaneGate).toEqual({
        status: 'blocked',
        reason: 'p1',
        canProceed: false,
        blockingPriority: 'P1',
        blockingLaneCount: 2,
      });
    });

    it('mergePetReviewLanesIntoSnapshot preserves grok advisor lanes as safe metadata only', () => {
      const lanesWithSecrets = [
        {
          role: 'grok',
          status: 'passed',
          grade: 'A',
          recommendation: 'proceed',
          highestPriority: null,
          issueCount: 0,
          updatedAt: 230,
          prompt: 'SECRET_GROK_PROMPT',
          sessionId: 'SECRET_GROK_SESSION',
          transcript: 'SECRET_GROK_TRANSCRIPT',
        },
      ];
      expect(JSON.stringify(lanesWithSecrets)).toMatch(/SECRET_GROK_PROMPT|SECRET_GROK_SESSION|SECRET_GROK_TRANSCRIPT/);

      const merged = mergePetReviewLanesIntoSnapshot(createBasePetSnapshot(), lanesWithSecrets);
      const capsule = createPetHandoffCapsule(merged);

      expect(merged.reviewLanes).toMatchObject({
        total: 1,
        passedCount: 1,
        proceedCount: 1,
        lanes: [
          {
            role: 'grok',
            status: 'passed',
            grade: 'A',
            recommendation: 'proceed',
            highestPriority: null,
            issueCount: 0,
            updatedAt: 230,
          },
        ],
      });
      expect(merged.reviewLaneGate).toEqual(defaultReviewLaneGate);
      expect(capsule.reviewLaneSummaries).toEqual(merged.reviewLanes.lanes);
      expect(JSON.stringify(merged)).not.toMatch(/SECRET_GROK_PROMPT|SECRET_GROK_SESSION|SECRET_GROK_TRANSCRIPT/);
      expect(JSON.stringify(capsule)).not.toMatch(/SECRET_GROK_PROMPT|SECRET_GROK_SESSION|SECRET_GROK_TRANSCRIPT/);
    });

    it('mergePetReviewLanesIntoSnapshot keeps all sanitized lanes for gate derivation and clamps invalid values', () => {
      const snap = createBasePetSnapshot();
      const merged = mergePetReviewLanesIntoSnapshot(snap, [
        {
          role: 'oracle',
          status: 'failed',
          grade: 'D',
          recommendation: 'unknown',
          highestPriority: 'P3',
          issueCount: -4,
          updatedAt: Number.POSITIVE_INFINITY,
        },
        {
          role: 'bad role',
          status: 'bad status',
          grade: 'Z',
          recommendation: 'bad rec',
          highestPriority: 'PX',
          issueCount: Number.NaN,
          updatedAt: Number.NaN,
        },
        { role: 'ux', status: 'idle', grade: 'C', recommendation: 'iterate', highestPriority: 'P2', issueCount: 1 },
        { role: 'reviewer', status: 'running', grade: 'B', recommendation: 'proceed', highestPriority: 'P1', issueCount: 2 },
        { role: 'safety', status: 'blocked', grade: 'F', recommendation: 'block', highestPriority: 'P1', issueCount: 9 },
      ]);

      expect(merged.reviewLanes.total).toBe(5);
      expect(merged.reviewLanes.failedCount).toBe(1);
      expect(merged.reviewLanes.activeCount).toBe(1);
      expect(merged.reviewLanes.blockedCount).toBe(1);
      expect(merged.reviewLanes.highestPriority).toBe('P1');
      expect(merged.reviewLanes.worstGrade).toBe('F');
      expect(merged.reviewLanes.unknownCount).toBe(2);
      expect(merged.reviewLanes.lanes).toEqual([
        {
          role: 'oracle',
          status: 'failed',
          grade: 'D',
          recommendation: 'unknown',
          highestPriority: 'P3',
          issueCount: 0,
          updatedAt: null,
        },
        {
          role: 'other',
          status: 'idle',
          grade: null,
          recommendation: 'unknown',
          highestPriority: null,
          issueCount: 0,
          updatedAt: null,
        },
        {
          role: 'ux',
          status: 'idle',
          grade: 'C',
          recommendation: 'iterate',
          highestPriority: 'P2',
          issueCount: 1,
          updatedAt: null,
        },
        {
          role: 'reviewer',
          status: 'running',
          grade: 'B',
          recommendation: 'proceed',
          highestPriority: 'P1',
          issueCount: 2,
          updatedAt: null,
        },
        {
          role: 'safety',
          status: 'blocked',
          grade: 'F',
          recommendation: 'block',
          highestPriority: 'P1',
          issueCount: 9,
          updatedAt: null,
        },
      ]);
      expect(merged.reviewLaneGate).toEqual({
        status: 'blocked',
        reason: 'p1',
        canProceed: false,
        blockingPriority: 'P1',
        blockingLaneCount: 4,
      });
    });

    it('mergePetReviewLanesIntoSnapshot blocks on lanes beyond handoff summary cap', () => {
      const merged = mergePetReviewLanesIntoSnapshot(createBasePetSnapshot(), [
        { role: 'implementer', status: 'passed', grade: 'A', recommendation: 'proceed', highestPriority: null, issueCount: 0 },
        { role: 'reviewer', status: 'passed', grade: 'A', recommendation: 'proceed', highestPriority: null, issueCount: 0 },
        { role: 'safety', status: 'passed', grade: 'A', recommendation: 'proceed', highestPriority: null, issueCount: 0 },
        { role: 'ux', status: 'passed', grade: 'A', recommendation: 'proceed', highestPriority: null, issueCount: 0 },
        {
          role: 'oracle',
          status: 'blocked',
          grade: 'F',
          recommendation: 'iterate',
          highestPriority: 'P1',
          issueCount: 1,
          transcript: 'SECRET_HIDDEN_LANE',
        } as PetReviewLaneInput & Record<string, unknown>,
      ]);
      const capsule = createPetHandoffCapsule(merged);

      expect(merged.reviewLanes.total).toBe(5);
      expect(merged.reviewLaneGate).toEqual({
        status: 'blocked',
        reason: 'p1',
        canProceed: false,
        blockingPriority: 'P1',
        blockingLaneCount: 1,
      });
      expect(capsule.reviewLaneCount).toBe(5);
      expect(capsule.reviewLaneSummaries).toHaveLength(4);
      expect(capsule.reviewLaneGateStatus).toBe('blocked');
      expect(capsule.reviewLaneGateReason).toBe('p1');
      expect(capsule.reviewLaneGateCanProceed).toBe(false);
      expect(capsule.reviewLaneGateBlockingPriority).toBe('P1');
      expect(capsule.reviewLaneGateBlockingLaneCount).toBe(1);
      expect(JSON.stringify(capsule)).not.toMatch(/SECRET_HIDDEN_LANE/);
    });

    it('createPetReviewLaneGate blocks on P2 and counts blocking lanes without requiring a block recommendation', () => {
      const merged = mergePetReviewLanesIntoSnapshot(createBasePetSnapshot(), [
        { role: 'reviewer', status: 'passed', grade: 'B', recommendation: 'iterate', highestPriority: 'P2', issueCount: 1 },
        { role: 'safety', status: 'passed', grade: 'A', recommendation: 'proceed', highestPriority: null, issueCount: 0 },
      ]);

      expect(createPetReviewLaneGate(merged.reviewLanes)).toEqual({
        status: 'blocked',
        reason: 'p2',
        canProceed: false,
        blockingPriority: 'P2',
        blockingLaneCount: 1,
      });
      expect(merged.reviewLaneGate).toEqual(createPetReviewLaneGate(merged.reviewLanes));
    });

    it('createPetReviewLaneGate blocks on block recommendation when priority is not P1/P2', () => {
      const merged = mergePetReviewLanesIntoSnapshot(createBasePetSnapshot(), [
        { role: 'reviewer', status: 'passed', grade: 'A', recommendation: 'block', highestPriority: null, issueCount: 0 },
        { role: 'safety', status: 'passed', grade: 'B', recommendation: 'block', highestPriority: 'P3', issueCount: 1 },
      ]);

      expect(merged.reviewLaneGate).toEqual({
        status: 'blocked',
        reason: 'block_recommendation',
        canProceed: false,
        blockingPriority: null,
        blockingLaneCount: 2,
      });
    });

    it('createPetReviewLaneGate blocks failed and blocked lanes while running lanes remain attention', () => {
      const failed = mergePetReviewLanesIntoSnapshot(createBasePetSnapshot(), [
        { role: 'reviewer', status: 'failed', grade: 'F', recommendation: 'unknown', highestPriority: null, issueCount: 1 },
      ]);
      expect(failed.reviewLaneGate).toEqual({
        status: 'blocked',
        reason: 'failed_lane',
        canProceed: false,
        blockingPriority: null,
        blockingLaneCount: 1,
      });

      const blocked = mergePetReviewLanesIntoSnapshot(createBasePetSnapshot(), [
        { role: 'reviewer', status: 'blocked', grade: 'C', recommendation: 'iterate', highestPriority: null, issueCount: 1 },
      ]);
      expect(blocked.reviewLaneGate).toEqual({
        status: 'blocked',
        reason: 'blocked_lane',
        canProceed: false,
        blockingPriority: null,
        blockingLaneCount: 1,
      });

      const running = mergePetReviewLanesIntoSnapshot(createBasePetSnapshot(), [
        { role: 'reviewer', status: 'running', grade: null, recommendation: 'unknown', highestPriority: null, issueCount: 0 },
      ]);
      expect(running.reviewLaneGate).toEqual({
        status: 'attention',
        reason: 'active_review',
        canProceed: true,
        blockingPriority: null,
        blockingLaneCount: 0,
      });
    });

    it('createPetReviewLaneGate stays clear for no lanes or clean passed lanes', () => {
      expect(createPetReviewLaneGate(null)).toEqual(defaultReviewLaneGate);
      expect(createPetReviewLaneGate(undefined)).toEqual(defaultReviewLaneGate);

      const passed = mergePetReviewLanesIntoSnapshot(createBasePetSnapshot(), [
        { role: 'reviewer', status: 'passed', grade: 'A', recommendation: 'proceed', highestPriority: null, issueCount: 0 },
      ]);
      expect(passed.reviewLaneGate).toEqual(defaultReviewLaneGate);
    });

    it('createPetHandoffCapsule projects review lane fields that agree with the merged snapshot', () => {
      const snap = createBaseForHandoff({ run: { active: true, phase: 'working' } });
      const merged = mergePetReviewLanesIntoSnapshot(snap, [
        { role: 'reviewer', status: 'passed', grade: 'A', recommendation: 'proceed', highestPriority: null, issueCount: 0, updatedAt: 300 },
        { role: 'safety', status: 'blocked', grade: 'D', recommendation: 'block', highestPriority: 'P2', issueCount: 2, updatedAt: 310 },
      ]);

      const capsule = createPetHandoffCapsule(merged);

      expect(capsule.reviewLaneCount).toBe(merged.reviewLanes.total);
      expect(capsule.reviewLaneActiveCount).toBe(merged.reviewLanes.activeCount);
      expect(capsule.reviewLanePassedCount).toBe(merged.reviewLanes.passedCount);
      expect(capsule.reviewLaneBlockedCount).toBe(merged.reviewLanes.blockedCount);
      expect(capsule.reviewLaneFailedCount).toBe(merged.reviewLanes.failedCount);
      expect(capsule.reviewLaneHighestPriority).toBe(merged.reviewLanes.highestPriority);
      expect(capsule.reviewLaneWorstGrade).toBe(merged.reviewLanes.worstGrade);
      expect(capsule.reviewLaneProceedCount).toBe(merged.reviewLanes.proceedCount);
      expect(capsule.reviewLaneIterateCount).toBe(merged.reviewLanes.iterateCount);
      expect(capsule.reviewLaneBlockCount).toBe(merged.reviewLanes.blockCount);
      expect(capsule.reviewLaneUnknownCount).toBe(merged.reviewLanes.unknownCount);
      expect(capsule.reviewLaneSummaries).toEqual(merged.reviewLanes.lanes);
      expect(capsule.reviewLaneGateStatus).toBe(merged.reviewLaneGate.status);
      expect(capsule.reviewLaneGateReason).toBe(merged.reviewLaneGate.reason);
      expect(capsule.reviewLaneGateCanProceed).toBe(merged.reviewLaneGate.canProceed);
      expect(capsule.reviewLaneGateBlockingPriority).toBe(merged.reviewLaneGate.blockingPriority);
      expect(capsule.reviewLaneGateBlockingLaneCount).toBe(merged.reviewLaneGate.blockingLaneCount);
    });

    it('review lane metadata does not alter nextAction priority or adjacent pet lenses', () => {
      const base = createBaseForHandoff({
        run: { active: true, phase: 'working' },
        review: { grade: 'A', decision: 'pass', proofDebtCount: 0, issueCount: 0, acceptedEvidenceCount: 4, canFinalize: true },
      });
      const baseCapsule = createPetHandoffCapsule(base);

      const merged = mergePetReviewLanesIntoSnapshot(base, [
        { role: 'safety', status: 'blocked', grade: 'F', recommendation: 'block', highestPriority: 'P1', issueCount: 5, updatedAt: 400 },
      ]);
      const capsule = createPetHandoffCapsule(merged);

      expect(capsule.nextAction).toBe(baseCapsule.nextAction);
      expect(capsule.nextAction).toBe('finalize');
      expect(capsule.reviewLaneGateStatus).toBe('blocked');
      expect(capsule.reviewLaneGateReason).toBe('p1');
      expect(capsule.reviewLaneGateCanProceed).toBe(false);
      expect(merged.review).toEqual(base.review);
      expect(merged.reviewHeat).toEqual(base.reviewHeat);
      expect(merged.blockerLens).toEqual(base.blockerLens);
      expect(merged.stopLine).toEqual(base.stopLine);
      expect(merged.memoryPressure).toEqual(base.memoryPressure);
      expect(merged.workerCycle).toEqual(base.workerCycle);
    });

    it('privacy false-positive probe: raw lane labels, ids, messages, details, transcripts, and raw fields stay out of pet snapshot and handoff projection', () => {
      const snap = createBaseForHandoff();
      const lanesWithSecrets = [
        {
          role: 'reviewer',
          status: 'blocked',
          grade: 'C',
          recommendation: 'iterate',
          highestPriority: 'P2',
          issueCount: 2,
          updatedAt: 500,
          laneId: 'lane_SECRET_ID_123',
          name: 'Hermes SECRET_NAME',
          label: 'label password=lane-secret',
          message: 'message SECRET_MESSAGE',
          details: { token: 'SECRET_DETAILS' },
          transcript: 'TOPSECRET_TRANSCRIPT',
          raw: 'RAW_SECRET_FIELD',
        },
      ] as Array<Parameters<typeof mergePetReviewLanesIntoSnapshot>[1] extends Array<infer Lane> ? Lane & Record<string, unknown> : never>;
      const sourceJson = JSON.stringify(lanesWithSecrets);
      expect(sourceJson).toMatch(/SECRET_ID_123|SECRET_NAME|lane-secret|SECRET_MESSAGE|SECRET_DETAILS|TOPSECRET_TRANSCRIPT|RAW_SECRET_FIELD/);

      const merged = mergePetReviewLanesIntoSnapshot(snap, lanesWithSecrets);
      const capsule = createPetHandoffCapsule(merged);
      const petJson = JSON.stringify(merged);
      const capsuleJson = JSON.stringify(capsule);

      expect(merged.reviewLanes.total).toBe(1);
      expect(merged.reviewLanes.lanes[0]).toEqual({
        role: 'reviewer',
        status: 'blocked',
        grade: 'C',
        recommendation: 'iterate',
        highestPriority: 'P2',
        issueCount: 2,
        updatedAt: 500,
      });
      expect(merged.reviewLaneGate).toEqual({
        status: 'blocked',
        reason: 'p2',
        canProceed: false,
        blockingPriority: 'P2',
        blockingLaneCount: 1,
      });
      expect(capsule.reviewLaneSummaries).toEqual(merged.reviewLanes.lanes);
      expect(capsule.reviewLaneGateStatus).toBe(merged.reviewLaneGate.status);
      expect(capsule.reviewLaneGateReason).toBe(merged.reviewLaneGate.reason);
      expect(capsule.reviewLaneGateCanProceed).toBe(merged.reviewLaneGate.canProceed);
      expect(capsule.reviewLaneGateBlockingPriority).toBe(merged.reviewLaneGate.blockingPriority);
      expect(capsule.reviewLaneGateBlockingLaneCount).toBe(merged.reviewLaneGate.blockingLaneCount);
      expect(capsule.nextAction).toBe('idle');
      expect(petJson).not.toMatch(/SECRET_ID_123|SECRET_NAME|lane-secret|SECRET_MESSAGE|SECRET_DETAILS|TOPSECRET_TRANSCRIPT|RAW_SECRET_FIELD|password=/);
      expect(capsuleJson).not.toMatch(/SECRET_ID_123|SECRET_NAME|lane-secret|SECRET_MESSAGE|SECRET_DETAILS|TOPSECRET_TRANSCRIPT|RAW_SECRET_FIELD|password=/);
    });

    it('createPetHandoffCapsule sanitizes hand-built review lane summaries before projection', () => {
      const snap = createBaseForHandoff({
        reviewLanes: {
          total: 99,
          activeCount: 99,
          passedCount: 99,
          blockedCount: 99,
          failedCount: 99,
          highestPriority: 'PX' as any,
          worstGrade: 'Z' as any,
          proceedCount: 99,
          iterateCount: 99,
          blockCount: 99,
          unknownCount: 99,
          lanes: [
            {
              role: 'reviewer',
              status: 'blocked',
              grade: 'C',
              recommendation: 'iterate',
              highestPriority: 'P2',
              issueCount: 1,
              updatedAt: 600,
              message: 'SECRET_HAND_BUILT_LANE',
              transcript: 'SECRET_HAND_BUILT_TRANSCRIPT',
            } as PetControlSnapshot['reviewLanes']['lanes'][number] & Record<string, unknown>,
          ],
        },
        reviewLaneGate: {
          status: 'clear',
          reason: 'none',
          canProceed: true,
          blockingPriority: null,
          blockingLaneCount: 0,
        },
      });

      const capsule = createPetHandoffCapsule(snap);
      const capsuleJson = JSON.stringify(capsule);

      expect(capsule.reviewLaneSummaries).toEqual([
        {
          role: 'reviewer',
          status: 'blocked',
          grade: 'C',
          recommendation: 'iterate',
          highestPriority: 'P2',
          issueCount: 1,
          updatedAt: 600,
        },
      ]);
      expect(capsule.reviewLaneCount).toBe(1);
      expect(capsule.reviewLaneActiveCount).toBe(0);
      expect(capsule.reviewLanePassedCount).toBe(0);
      expect(capsule.reviewLaneBlockedCount).toBe(1);
      expect(capsule.reviewLaneFailedCount).toBe(0);
      expect(capsule.reviewLaneHighestPriority).toBe('P2');
      expect(capsule.reviewLaneWorstGrade).toBe('C');
      expect(capsule.reviewLaneProceedCount).toBe(0);
      expect(capsule.reviewLaneIterateCount).toBe(1);
      expect(capsule.reviewLaneBlockCount).toBe(0);
      expect(capsule.reviewLaneUnknownCount).toBe(0);
      expect(capsule.reviewLaneGateStatus).toBe('blocked');
      expect(capsule.reviewLaneGateReason).toBe('p2');
      expect(capsule.reviewLaneGateCanProceed).toBe(false);
      expect(capsule.reviewLaneGateBlockingPriority).toBe('P2');
      expect(capsule.reviewLaneGateBlockingLaneCount).toBe(1);
      expect(capsuleJson).not.toMatch(/SECRET_HAND_BUILT_LANE|SECRET_HAND_BUILT_TRANSCRIPT/);
    });
  });
});

function extractCapsuleSafetyRedaction(capsule: ReturnType<typeof createPetHandoffCapsule>) {
  return {
    status: capsule.safetyRedactionStatus,
    surface: 'pet_handoff' as const,
    metadataOnly: true,
    redacted: capsule.safetyRedactionRedacted,
    issueCount: capsule.safetyRedactionIssueCount,
    issueCodes: capsule.safetyRedactionIssueCodes,
    issueCategories: capsule.safetyRedactionIssueCategories,
    policyGate: capsule.safetyRedactionPolicyGate,
  };
}
