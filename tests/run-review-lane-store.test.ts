import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAutonomousReviewLaneRecord,
  AUTONOMOUS_RUN_STORAGE_KEY,
  createAutonomousRun,
  getAutonomousRunReviewLanes,
  transitionAutonomousRun,
} from '../core/run/store';

const NOW = 20_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('autonomous review lane store', () => {
  it('appends compact durable review lane records in sequence and returns stored state exactly', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `review-${id += 1}` });

    const run = await createAutonomousRun({ goal: 'Persist review lanes' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);

    const first = await appendAutonomousReviewLaneRecord(run.id, {
      role: 'reviewer',
      status: 'passed',
      grade: 'A',
      recommendation: 'proceed',
      highestPriority: null,
      issueCount: 0,
      evidenceRefCount: 3,
      summary: 'Reviewer accepted three evidence points.',
    }, NOW + 2);
    const second = await appendAutonomousReviewLaneRecord(run.id, {
      role: 'grok',
      status: 'passed',
      grade: 'C',
      recommendation: 'iterate',
      highestPriority: 'P2',
      issueCount: 2,
      evidenceRefCount: 1,
      summary: 'Grok found a blocking consistency issue.',
    }, NOW + 3);

    const stored = await getAutonomousRunReviewLanes(run.id);

    expect(first).toMatchObject({
      id: 'lane-review-2',
      seq: 1,
      createdAt: NOW + 2,
      role: 'reviewer',
      status: 'passed',
      recommendation: 'proceed',
    });
    expect(second).toMatchObject({
      id: 'lane-review-3',
      seq: 2,
      createdAt: NOW + 3,
      role: 'grok',
      status: 'blocked',
      highestPriority: 'P2',
    });
    expect(stored).toEqual([first, second]);
  });

  it('privacy probe: sanitizes raw advisor fields from returned and durable lane JSON', async () => {
    const { chromeStub, storage } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'privacy' });

    const run = await createAutonomousRun({ id: 'review-lane-safe-run', goal: 'Private review lane' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);

    const source = {
      role: 'SECRET_ROLE',
      status: 'passed',
      grade: 'A',
      recommendation: 'proceed',
      highestPriority: null,
      issueCount: 1,
      evidenceRefCount: 2,
      summary: 'run-review98765 prompt transcript rawOutput TOPSECRET_REVIEW https://private.example.com?token=secret Authorization: Bearer sk-live-secret1234567890',
      prompt: 'SECRET_PROMPT',
      sessionId: 'SECRET_SESSION',
      transcript: 'SECRET_TRANSCRIPT',
      rawReviewerProse: 'SECRET_PROSE',
      url: 'https://secret.invalid/review?token=secret',
    };
    expect(JSON.stringify(source)).toMatch(/SECRET_ROLE|SECRET_PROMPT|SECRET_SESSION|SECRET_TRANSCRIPT|SECRET_PROSE|private\.example|secret\.invalid|TOPSECRET_REVIEW|sk-live-secret|run-review98765|token=secret|Authorization/);

    const lane = await appendAutonomousReviewLaneRecord(run.id, source, NOW + 2);
    const returnedJson = JSON.stringify(lane);
    const durableJson = JSON.stringify(storage.get(AUTONOMOUS_RUN_STORAGE_KEY));

    expect(lane).not.toBeNull();
    expect(lane).toEqual((await getAutonomousRunReviewLanes(run.id))[0]);
    expect(lane).toMatchObject({
      role: 'other',
      status: 'passed',
      grade: 'A',
      recommendation: 'proceed',
      issueCount: 1,
      evidenceRefCount: 2,
    });
    expect(returnedJson).not.toMatch(/SECRET_ROLE|SECRET_PROMPT|SECRET_SESSION|SECRET_TRANSCRIPT|SECRET_PROSE|private\.example|secret\.invalid|TOPSECRET_REVIEW|sk-live-secret|run-review98765|token=secret|Authorization|Bearer|prompt transcript rawOutput/);
    expect(durableJson).not.toMatch(/SECRET_ROLE|SECRET_PROMPT|SECRET_SESSION|SECRET_TRANSCRIPT|SECRET_PROSE|private\.example|secret\.invalid|TOPSECRET_REVIEW|sk-live-secret|run-review98765|token=secret|Authorization|Bearer|prompt transcript rawOutput/);
    expect(returnedJson).toContain('[redacted:secret]');
    expect(durableJson).toContain('[redacted:secret]');
    expect(returnedJson).toContain('[redacted:id]');
    expect(durableJson).toContain('[redacted:id]');
    expect(returnedJson).toContain('[redacted:raw]');
    expect(durableJson).toContain('[redacted:raw]');
  });

  it('normalizes malformed lane records and fails contradictory passing data closed', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `malformed-${id += 1}` });

    const run = await createAutonomousRun({ id: 'malformed-review-lane', goal: 'Malformed review lane' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);

    const blocked = await appendAutonomousReviewLaneRecord(run.id, {
      role: 'oracle',
      status: 'passed',
      grade: 'B',
      recommendation: 'block',
      highestPriority: 'P1',
      issueCount: 2.7,
      evidenceRefCount: 1.9,
      summary: 'Contradictory pass must block.',
    }, NOW + 2);
    const failed = await appendAutonomousReviewLaneRecord(run.id, {
      role: 'unknown-role',
      status: 'not-a-status',
      grade: 'Z',
      recommendation: 'not-a-recommendation',
      highestPriority: 'PX',
      issueCount: Number.NaN,
      evidenceRefCount: Number.POSITIVE_INFINITY,
      summary: 123,
    }, NOW + 3);

    expect(blocked).toMatchObject({
      role: 'oracle',
      status: 'blocked',
      grade: 'B',
      recommendation: 'block',
      highestPriority: 'P1',
      issueCount: 2,
      evidenceRefCount: 1,
    });
    expect(failed).toMatchObject({
      role: 'other',
      status: 'failed',
      grade: null,
      recommendation: 'unknown',
      highestPriority: null,
      issueCount: 0,
      evidenceRefCount: 0,
      summary: null,
    });
    expect(await getAutonomousRunReviewLanes(run.id)).toEqual([blocked, failed]);
  });

  it('returns null for missing or terminal runs and clears lane records when replacing a run id', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'terminal' });

    const run = await createAutonomousRun({ id: 'replace-review-lane', goal: 'First lane run' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);
    await appendAutonomousReviewLaneRecord(run.id, createLaneInput(), NOW + 2);
    expect(await getAutonomousRunReviewLanes(run.id)).toHaveLength(1);

    await createAutonomousRun({ id: 'replace-review-lane', goal: 'Second lane run' }, NOW + 3);
    expect(await getAutonomousRunReviewLanes(run.id)).toEqual([]);

    await expect(appendAutonomousReviewLaneRecord('missing-run', createLaneInput(), NOW + 4)).resolves.toBeNull();
    await transitionAutonomousRun(run.id, 'running', null, NOW + 5);
    await transitionAutonomousRun(run.id, 'succeeded', null, NOW + 6);
    await expect(appendAutonomousReviewLaneRecord(run.id, createLaneInput(), NOW + 7)).resolves.toBeNull();
    await expect(getAutonomousRunReviewLanes(run.id)).resolves.toEqual([]);
  });
});

function createLaneInput() {
  return {
    role: 'reviewer',
    status: 'passed',
    grade: 'A',
    recommendation: 'proceed',
    highestPriority: null,
    issueCount: 0,
    evidenceRefCount: 1,
    summary: 'Review lane passed.',
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
