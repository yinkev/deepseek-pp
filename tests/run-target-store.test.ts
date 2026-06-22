import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAutonomousEvidenceRecord,
  appendAutonomousRunStep,
  AUTONOMOUS_RUN_STORAGE_KEY,
  createAutonomousRun,
  getAutonomousRunEvidence,
  getAutonomousRunTargetLeases,
  getAutonomousRunSteps,
  getAutonomousTargetLeaseById,
  releaseAutonomousTargetLease,
  transitionAutonomousRun,
  upsertAutonomousTargetLease,
} from '../core/run/store';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('autonomous run target lease and evidence store', () => {
  it('persists an active target lease and metadata-only evidence', async () => {
    const { chromeStub, storage } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'generated' });

    const run = await createAutonomousRun({ goal: 'Use target' }, 100);
    const lease = await upsertAutonomousTargetLease({
      id: 'lease-1',
      runId: run.id,
      label: 'Dev target',
      tabId: 42,
      windowId: 7,
      origin: 'https://example.com/private?token=secret',
      title: 'Authorization: Bearer abc',
      ttlMs: 30_000,
    }, 110);
    const evidence = await appendAutonomousEvidenceRecord(run.id, {
      id: 'evidence-1',
      kind: 'browser_screenshot',
      leaseId: lease?.id,
      capturedAt: 120,
      ttlMs: 10_000,
      summary: 'Cookie: sid=secret data:image/png;base64,AAAA',
      refs: ['vision-pack-1', 'file-sensitive1'],
      source: { tabId: 42, windowId: 7, toolName: 'browser_capture_screenshot' },
      metadata: {
        url: 'https://signed.example/file?token=secret',
        'https://example.net/key-path': 'key should redact',
        pageUrl: 'https://example.com/plain/path',
        href: 'https://example.org/linked',
        dataUrl: 'data:image/png;base64,BBBB',
      },
    }, 120);

    await expect(getAutonomousTargetLeaseById('lease-1')).resolves.toMatchObject({
      id: 'lease-1',
      runId: run.id,
      status: 'active',
      tabId: 42,
      windowId: 7,
      origin: 'https://example.com',
      expiresAt: 30_110,
    });
    await expect(getAutonomousRunEvidence(run.id)).resolves.toMatchObject([
      {
        id: evidence?.id,
        leaseId: 'lease-1',
        freshness: 'fresh',
        refs: ['vision-pack-1', '[redacted:vision-ref]'],
      },
    ]);

    const json = JSON.stringify(storage.get(AUTONOMOUS_RUN_STORAGE_KEY));
    expect(json).not.toMatch(/Bearer|sid=secret|data:image|signed\.example|example\.net|key-path|example\.com\/plain|example\.org\/linked|token=secret|file-sensitive/);
    expect(json).toContain('[redacted:secret]');
    expect(json).toContain('[redacted:media]');
    expect(json).toContain('[redacted:vision-ref]');
    expect(json).toContain('[redacted:url]');
  });

  it('releases leases and clears the run target pointer', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'release' });

    const run = await createAutonomousRun({ goal: 'Release target' }, 100);
    const lease = await upsertAutonomousTargetLease({
      id: 'lease-release',
      runId: run.id,
      tabId: 42,
      windowId: 7,
      origin: 'https://example.com',
    }, 110);

    await expect(releaseAutonomousTargetLease(lease?.id ?? '', 120)).resolves.toMatchObject({
      status: 'released',
      releasedAt: 120,
      expiresAt: 120,
    });
    await expect(getAutonomousRunTargetLeases(run.id)).resolves.toMatchObject([
      { id: 'lease-release', status: 'released' },
    ]);
  });

  it('preserves explicit null lease id for target-independent evidence', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'independent' });

    const run = await createAutonomousRun({ goal: 'Independent evidence' }, 100);
    await upsertAutonomousTargetLease({
      id: 'lease-active',
      runId: run.id,
      tabId: 42,
      windowId: 7,
      origin: 'https://example.com',
    }, 110);
    await appendAutonomousEvidenceRecord(run.id, {
      id: 'evidence-independent',
      leaseId: null,
      kind: 'web',
      summary: 'Fetched https://example.com/public',
      refs: ['web-evidence-1'],
    }, 120);

    await expect(getAutonomousRunEvidence(run.id)).resolves.toMatchObject([
      {
        id: 'evidence-independent',
        leaseId: null,
        summary: 'Fetched [redacted:url]',
      },
    ]);
  });

  it('marks the prior active lease stale when a run acquires a new lease', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'reacquire' });

    const run = await createAutonomousRun({ goal: 'Reacquire target' }, 100);
    await upsertAutonomousTargetLease({
      id: 'lease-old',
      runId: run.id,
      tabId: 42,
      windowId: 7,
      origin: 'https://example.com',
    }, 110);
    await upsertAutonomousTargetLease({
      id: 'lease-new',
      runId: run.id,
      tabId: 43,
      windowId: 8,
      origin: 'https://example.org',
    }, 120);

    await expect(getAutonomousRunTargetLeases(run.id)).resolves.toMatchObject([
      { id: 'lease-new', status: 'active' },
      { id: 'lease-old', status: 'stale', releasedAt: 120, expiresAt: 120 },
    ]);
  });

  it('rejects terminal-run lease, evidence, and step writes', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'terminal-target' });

    const run = await createAutonomousRun({ goal: 'Closed target' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await transitionAutonomousRun(run.id, 'succeeded', null, 120);

    await expect(upsertAutonomousTargetLease({
      runId: run.id,
      tabId: 42,
      windowId: 7,
      origin: 'https://example.com',
    }, 130)).resolves.toBeNull();
    await expect(appendAutonomousEvidenceRecord(run.id, {
      kind: 'browser_snapshot',
      refs: ['evidence-1'],
    }, 140)).resolves.toBeNull();
    await expect(appendAutonomousRunStep(run.id, { phase: 'review' }, 150)).resolves.toBeNull();
  });

  it('removes stale lease and evidence rows when a run id is replaced', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'replace-target' });

    const first = await createAutonomousRun({ id: 'same-run', goal: 'First' }, 100);
    const lease = await upsertAutonomousTargetLease({
      id: 'lease-old',
      runId: first.id,
      tabId: 42,
      windowId: 7,
      origin: 'https://example.com',
    }, 110);
    await appendAutonomousEvidenceRecord(first.id, {
      id: 'evidence-old',
      leaseId: lease?.id,
      kind: 'browser_snapshot',
      refs: ['evidence-1'],
    }, 120);

    const second = await createAutonomousRun({ id: 'same-run', goal: 'Second' }, 200);

    await expect(getAutonomousRunTargetLeases(second.id)).resolves.toEqual([]);
    await expect(getAutonomousRunEvidence(second.id)).resolves.toEqual([]);
    await expect(getAutonomousRunSteps(second.id)).resolves.toEqual([]);
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
