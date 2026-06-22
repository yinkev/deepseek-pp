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
  createPetControlSnapshotFromRunCockpit,
  getPetControlSnapshot,
  mergeAutonomousCompletionReviewIntoSnapshot,
  mergeRuntimeDoctorReportIntoSnapshot,
  createPetHandoffCapsule,
  type PetControlSnapshot,
} from '../core/pet/control';
import { getAutonomousRunCockpitSnapshot } from '../core/run/orchestrator';
import type { RuntimeDoctorReport } from '../core/chat/runtime-doctor';
import type { AutonomousRunCompletionReview } from '../core/run/review';

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
    blockerLens?: Partial<PetControlSnapshot['blockerLens']>;
    evidence?: Partial<PetControlSnapshot['evidence']>;
    review?: Partial<PetControlSnapshot['review']>;
    reviewHeat?: Partial<PetControlSnapshot['reviewHeat']>;
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
    };
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
    });
    expect(pet.run.label).toBeNull();
    expect(pet.target.label).toBeNull();
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
    function createBaseForHandoff(overrides: Parameters<typeof createBasePetSnapshot>[0] = {}): PetControlSnapshot {
      return createBasePetSnapshot({
        generatedAt: 123,
        readiness: { status: 'ready', blockers: [], preparing: false },
        run: { active: false, label: null, phase: 'idle', nextAction: null },
        target: { locked: false, label: null, stale: false, leaseStatus: 'none', leaseAgeMs: null, leaseExpiresInMs: null },
        safety: { leakIssueCount: 0, highRiskArmed: false },
        evidence: { status: 'none', count: 0, freshCount: 0, staleCount: 0, expiredCount: 0, latestCapturedAt: null, latestAgeMs: null },
        review: { grade: null, decision: null, proofDebtCount: 0, issueCount: 0, acceptedEvidenceCount: 0, canFinalize: false },
        ...overrides,
      });
    }

    it('idle/ready snapshot creates a safe idle capsule with defaults', () => {
      const snap = createBaseForHandoff();
      const capsule = createPetHandoffCapsule(snap);

      expect(capsule).toMatchObject({
        schemaVersion: 1,
        generatedAt: 123,
        readinessStatus: 'ready',
        runPhase: 'idle',
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
        evidenceStatus: 'none',
        evidenceCount: 0,
        latestEvidenceAgeMs: null,
        grade: null,
        canFinalize: false,
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
      expect(capsule.evidenceStatus).toBe('stale');
      expect(capsule.evidenceCount).toBe(3);
      expect(capsule.latestEvidenceAgeMs).toBe(12);
      expect(capsule.nextAction).toBe('review_blocker');
      // no secrets leaked
      expect(capsuleJson).not.toMatch(/SECRET_LEAK_TOKEN_777|ultra secret|supersecret|SECRET_999|secret-target-title|ultra-secret|password=|https:\/\/leak/);
      // but does reflect the safe structure
      expect(capsuleJson).toContain('"reviewState":"iterate"');
      expect(capsuleJson).toContain('"blockerCount":2');
    });
  });
});
