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
    review?: Partial<PetControlSnapshot['review']>;
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
        ...overrides.target,
      },
      safety: {
        leakIssueCount: 0,
        highRiskArmed: false,
        ...overrides.safety,
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
      target: { locked: false, label: null, stale: false },
      safety: { leakIssueCount: 0, highRiskArmed: false },
      review: {
        grade: null,
        decision: null,
        proofDebtCount: 0,
        issueCount: 0,
        acceptedEvidenceCount: 0,
        canFinalize: false,
      },
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
    expect(pet.target).toMatchObject({ locked: false, stale: false });
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

    expect(pet.target).toMatchObject({ locked: true, label: 'Target locked', stale: false });
    const json = JSON.stringify(pet);
    expect(json).not.toMatch(/secret-target-title|secret-target-token|ultra-secret|secret-target.example.com/);
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
    expect(pet.target).toEqual({ locked: true, label: 'Target locked', stale: false });
    expect(pet.safety).toEqual({ leakIssueCount: 4, highRiskArmed: false });
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
    expect(pet.target).toEqual({ locked: false, label: 'Target stale', stale: true });
  });

  it('maps Runtime Doctor target status to generic missing/stale labels only', () => {
    const base = createBasePetSnapshot();
    const targetCases: Array<[
      RuntimeDoctorReport['readiness']['targetStatus'],
      PetControlSnapshot['target'],
    ]> = [
      ['missing', { locked: false, label: 'Target missing', stale: true }],
      ['unsupported', { locked: false, label: 'Target stale', stale: true }],
      ['not_controllable', { locked: false, label: 'Target stale', stale: true }],
      ['selected_active', { locked: false, label: null, stale: false }],
    ];

    for (const [targetStatus, expected] of targetCases) {
      const report = createRuntimeDoctorReport({
        readiness: { targetStatus },
        targetLock: {
          enabled: false,
          label: 'raw target title',
          origin: 'https://raw-target.example.com',
        },
      });
      expect(mergeRuntimeDoctorReportIntoSnapshot(base, report).target).toEqual(expected);
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

    // B grade pass
    const passB: AutonomousRunCompletionReview = { ...passReview, grade: 'B' };
    const petB = mergeAutonomousCompletionReviewIntoSnapshot(base, passB);
    expect(petB.review.grade).toBe('B');
    expect(petB.review.canFinalize).toBe(true);
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
    expect(pet.review.grade).toBe('D');
    expect(pet.review.decision).toBe('iterate');
    expect(pet.review.proofDebtCount).toBe(2);
    expect(pet.review.issueCount).toBe(2);
    expect(pet.review.acceptedEvidenceCount).toBe(1);
    expect(pet.review.canFinalize).toBe(false);
    // prove no leak of raw
    expect(petJson).not.toMatch(/SECRET_TOKEN|SECRET_PASS|ultra_secret|SECRET_123|SECRET data/);
    expect(petJson).toContain('D'); // grade
  });

  it('returns the original pet snapshot when Runtime Doctor report is unavailable', () => {
    const base = createBasePetSnapshot({
      target: { locked: true, label: 'Target locked', stale: false },
    });

    expect(mergeRuntimeDoctorReportIntoSnapshot(base, null)).toBe(base);
    expect(mergeRuntimeDoctorReportIntoSnapshot(base, undefined)).toBe(base);
  });
});
