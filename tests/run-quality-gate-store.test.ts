import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAutonomousQualityGateRecord,
  AUTONOMOUS_RUN_STORAGE_KEY,
  createAutonomousRun,
  getAutonomousRunQualityGates,
  transitionAutonomousRun,
} from '../core/run/store';

const NOW = 10_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('autonomous quality gate store', () => {
  it('appends compact durable gate records in sequence and returns stored state exactly', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `gate-${id += 1}` });

    const run = await createAutonomousRun({ goal: 'Persist quality gate' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);

    const first = await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: {
        complete: true,
        coveredCount: 6,
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
          { name: 'vitest run tests/run-quality-gate-store.test.ts', result: 'passed', summary: 'new focused tests passed' },
          { name: 'npm run prompt:freeze', result: 'known_preexisting_failure', summary: 'known prompt hash drift unchanged' },
        ],
      },
      commit: { hash: '077d0af', message: 'Document autonomous worker roadmap' },
      independentReview: {
        status: 'not_run',
        grade: null,
        blockingIssueCount: 0,
      },
    }, NOW + 2);
    const second = await appendAutonomousQualityGateRecord(run.id, {
      status: 'failed',
      contractCoverage: {
        complete: false,
        coveredCount: 5,
        gapCount: 1,
        conflictCount: 0,
        notTestableCount: 0,
      },
      resultStateConsistency: {
        status: 'inconsistent',
        ok: false,
        issueCount: 2,
        blockingIssueCount: 1,
      },
      selfReview: { grade: 'B' },
      verification: { commands: [] },
      independentReview: {
        status: 'failed',
        grade: 'C',
        blockingIssueCount: 1,
      },
    }, NOW + 3);

    const stored = await getAutonomousRunQualityGates(run.id);

    expect(first).toMatchObject({ id: 'gate-gate-2', seq: 1, createdAt: NOW + 2, status: 'passed' });
    expect(second).toMatchObject({ id: 'gate-gate-3', seq: 2, createdAt: NOW + 3, status: 'failed' });
    expect(stored).toEqual([first, second]);
  });

  it('privacy probe: sanitizes secret-bearing source input from returned and durable gate JSON', async () => {
    const { chromeStub, storage } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'privacy' });

    const run = await createAutonomousRun({ id: 'safe-run', goal: 'Private quality gate' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);

    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: {
        complete: true,
        coveredCount: 1,
        gapCount: 0,
        conflictCount: 0,
        notTestableCount: 0,
        sourceRunId: 'RAW_RUN_ID_SECRET',
        sourceEvidenceIds: ['RAW_EVIDENCE_ID_SECRET'],
      } as any,
      resultStateConsistency: {
        status: 'consistent',
        ok: true,
        issueCount: 0,
        blockingIssueCount: 0,
        issues: ['Authorization: Bearer sk-live-secret1234567890'],
      } as any,
      selfReview: {
        grade: 'A',
        prose: 'raw reviewer prose with TOPSECRET_REVIEW_TEXT',
      } as any,
      verification: {
        commands: [
          {
            name: 'curl https://private.example.com?token=secret-token',
            result: 'passed',
            summary: 'Authorization: Bearer sk-live-secret1234567890 transcript TOPSECRET_TRANSCRIPT_TEXT',
            rawOutput: 'TOPSECRET_RAW_OUTPUT',
          } as any,
        ],
      },
      commit: {
        hash: 'abcdef1234567890abcdef1234567890abcdef12',
        message: 'Commit message with https://signed.example/file?token=secret-token and Cookie: sid=secret-session',
      },
      independentReview: {
        status: 'passed',
        grade: 'A',
        blockingIssueCount: 0,
        rawReviewerProse: 'TOPSECRET_REVIEW_TEXT',
      } as any,
    }, NOW + 2);

    const returnedJson = JSON.stringify(gate);
    const durableJson = JSON.stringify(storage.get(AUTONOMOUS_RUN_STORAGE_KEY));

    expect(gate).not.toBeNull();
    expect(gate).toEqual((await getAutonomousRunQualityGates(run.id))[0]);
    expect(returnedJson).not.toMatch(/RAW_RUN_ID_SECRET|RAW_EVIDENCE_ID_SECRET|TOPSECRET|sk-live-secret|secret-token|secret-session|private\.example|signed\.example|raw reviewer prose|RAW_OUTPUT/);
    expect(durableJson).not.toMatch(/RAW_RUN_ID_SECRET|RAW_EVIDENCE_ID_SECRET|TOPSECRET|sk-live-secret|secret-token|secret-session|private\.example|signed\.example|raw reviewer prose|RAW_OUTPUT/);
    expect(returnedJson).toContain('[redacted:secret]');
    expect(durableJson).toContain('[redacted:secret]');
  });

  it('returns null and writes no gate for missing or terminal runs', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'terminal' });

    const run = await createAutonomousRun({ goal: 'Terminal quality gate' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);
    await transitionAutonomousRun(run.id, 'succeeded', null, NOW + 2);

    await expect(appendAutonomousQualityGateRecord('missing-run', createGateInput(), NOW + 3)).resolves.toBeNull();
    await expect(appendAutonomousQualityGateRecord(run.id, createGateInput(), NOW + 4)).resolves.toBeNull();
    await expect(getAutonomousRunQualityGates(run.id)).resolves.toEqual([]);
  });
});

function createGateInput() {
  return {
    status: 'passed' as const,
    contractCoverage: {
      complete: true,
      coveredCount: 1,
      gapCount: 0,
      conflictCount: 0,
      notTestableCount: 0,
    },
    resultStateConsistency: {
      status: 'consistent' as const,
      ok: true,
      issueCount: 0,
      blockingIssueCount: 0,
    },
    selfReview: { grade: 'A' as const },
    verification: { commands: [] },
    independentReview: {
      status: 'not_run' as const,
      grade: null,
      blockingIssueCount: 0,
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
