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
} from '../core/pet/control';
import { getAutonomousRunCockpitSnapshot } from '../core/run/orchestrator';

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
});
