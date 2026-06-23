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
        rows: createCoverageRows('covered', 'covered', 'covered', 'covered', 'covered', 'covered', 'not_testable'),
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
        rows: createCoverageRows('covered', 'covered', 'covered', 'covered', 'covered', 'gap'),
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
    expect(second).toMatchObject({ id: 'gate-gate-3', seq: 2, createdAt: NOW + 3, status: 'blocked' });
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
        rows: [
          {
            kind: 'done_criterion',
            requirement: 'private https://signed.example/file?token=secret-token Authorization: Bearer sk-live-secret1234567890',
            status: 'covered',
            matchedBy: ['test assertion run-durable12345 token=plain-token-456'],
          },
        ],
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
            name: 'github_pat_1234567890abcdefghijklmnopqrstuvwxyz token=early-token api_key=early-key curl https://private.example.com?token=secret-token run-durable12345 evidence-proof98765 ghp_abcdefghijklmnopqrstuvwxyz model-turn-abc12345 tool-call-def67890 observation-ref-ghi12345',
            result: 'passed',
            summary: 'Authorization: Bearer sk-live-secret1234567890 api_key=plain-key-123 token=plain-token-456 Cookie: sid=secret-session transcript TOPSECRET_TRANSCRIPT_TEXT ev-evidence123456 observation-raw98765',
            rawOutput: 'TOPSECRET_RAW_OUTPUT',
          } as any,
        ],
      },
      commit: {
        hash: 'abcdef1234567890abcdef1234567890abcdef12',
        message: 'Commit message with https://signed.example/file?token=secret-token and Cookie: sid=secret-session for run-durable12345',
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
    expect(returnedJson).not.toMatch(/RAW_RUN_ID_SECRET|RAW_EVIDENCE_ID_SECRET|TOPSECRET|sk-live-secret|secret-token|secret-session|private\.example|signed\.example|raw reviewer prose|RAW_OUTPUT|run-durable12345|evidence-proof98765|ev-evidence123456|observation-raw98765|model-turn-abc12345|tool-call-def67890|observation-ref-ghi12345|ghp_|github_pat_|token=|api_key=|plain-key-123|plain-token-456|early-token|early-key|Authorization|Bearer|Cookie/);
    expect(durableJson).not.toMatch(/RAW_RUN_ID_SECRET|RAW_EVIDENCE_ID_SECRET|TOPSECRET|sk-live-secret|secret-token|secret-session|private\.example|signed\.example|raw reviewer prose|RAW_OUTPUT|run-durable12345|evidence-proof98765|ev-evidence123456|observation-raw98765|model-turn-abc12345|tool-call-def67890|observation-ref-ghi12345|ghp_|github_pat_|token=|api_key=|plain-key-123|plain-token-456|early-token|early-key|Authorization|Bearer|Cookie/);
    expect(returnedJson).toContain('[redacted:secret]');
    expect(durableJson).toContain('[redacted:secret]');
    expect(returnedJson).toContain('[redacted:id]');
    expect(durableJson).toContain('[redacted:id]');
  });

  it('derives durable coverage counts from first-class rows instead of caller aggregates', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'coverage-rows' });

    const run = await createAutonomousRun({ id: 'coverage-row-run', goal: 'Coverage rows' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);

    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: {
        rows: createCoverageRows('covered', 'gap', 'conflict', 'not_testable'),
        complete: true,
        coveredCount: 999,
        gapCount: 0,
        conflictCount: 0,
        notTestableCount: 0,
      },
      resultStateConsistency: {
        status: 'consistent',
        ok: true,
        issueCount: 0,
        blockingIssueCount: 0,
      },
      selfReview: { grade: 'A' },
      verification: { commands: [{ name: 'focused tests', result: 'passed', summary: 'ok' }] },
      independentReview: {
        status: 'passed',
        grade: 'A',
        blockingIssueCount: 0,
      },
    }, NOW + 2);

    expect(gate).toMatchObject({
      status: 'failed',
      contractCoverage: {
        complete: false,
        coveredCount: 1,
        gapCount: 1,
        conflictCount: 1,
        notTestableCount: 1,
      },
    });
    expect(gate?.contractCoverage.rows).toHaveLength(4);
    expect(gate).toEqual((await getAutonomousRunQualityGates(run.id))[0]);
  });

  it('fails overall passed gates when coverage rows are missing', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'missing-rows' });

    const run = await createAutonomousRun({ id: 'missing-row-run', goal: 'Missing coverage rows' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);

    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: {
        complete: true,
        coveredCount: 3,
        gapCount: 0,
        conflictCount: 0,
        notTestableCount: 0,
      },
      resultStateConsistency: {
        status: 'consistent',
        ok: true,
        issueCount: 0,
        blockingIssueCount: 0,
      },
      selfReview: { grade: 'A' },
      verification: { commands: [{ name: 'focused tests', result: 'passed', summary: 'ok' }] },
      independentReview: {
        status: 'passed',
        grade: 'A',
        blockingIssueCount: 0,
      },
    }, NOW + 2);

    expect(gate).toMatchObject({
      status: 'failed',
      contractCoverage: {
        rows: [],
        complete: false,
        coveredCount: 3,
      },
    });
    expect(gate).toEqual((await getAutonomousRunQualityGates(run.id))[0]);
  });

  it('defaults malformed gate status and verification results to failed', async () => {
    const { chromeStub, storage } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'malformed' });

    const run = await createAutonomousRun({ id: 'malformed-run', goal: 'Malformed quality gate' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);

    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'definitely_not_passed',
      contractCoverage: { complete: true },
      resultStateConsistency: { status: 'unknown', ok: true },
      verification: {
        commands: [
          { name: 'unknown result command', result: 'unknown', summary: 'unknown must fail closed' },
          { name: 'missing result command', summary: 'missing result must fail closed' },
        ],
      },
    } as any, NOW + 2);

    expect(gate).toMatchObject({
      status: 'failed',
      resultStateConsistency: {
        status: 'inconsistent',
        ok: true,
      },
      verification: {
        commands: [
          { name: 'unknown result command', result: 'failed' },
          { name: 'missing result command', result: 'failed' },
        ],
      },
    });
    expect(gate).toEqual((await getAutonomousRunQualityGates(run.id))[0]);
    expect(JSON.stringify(storage.get(AUTONOMOUS_RUN_STORAGE_KEY))).not.toContain('"status":"passed"');
  });

  it('fails overall passed gates when normalized verification commands fail', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'verification-fail' });

    const run = await createAutonomousRun({ id: 'verification-fail-run', goal: 'Verification failure gate' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);

    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: {
        rows: createCoverageRows('covered'),
        complete: true,
        coveredCount: 1,
        gapCount: 0,
        conflictCount: 0,
        notTestableCount: 0,
      },
      resultStateConsistency: {
        status: 'consistent',
        ok: true,
        issueCount: 0,
        blockingIssueCount: 0,
      },
      verification: {
        commands: [
          { name: 'missing result command', summary: 'missing command result must fail the gate' },
        ],
      },
      independentReview: {
        status: 'passed',
        grade: 'A',
        blockingIssueCount: 0,
      },
    } as any, NOW + 2);

    expect(gate).toMatchObject({
      status: 'failed',
      verification: {
        commands: [
          { name: 'missing result command', result: 'failed' },
        ],
      },
    });
    expect(gate).toEqual((await getAutonomousRunQualityGates(run.id))[0]);
  });

  it('fails overall passed gates when consistency status is inconsistent', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'consistency-fail' });

    const run = await createAutonomousRun({ id: 'consistency-fail-run', goal: 'Consistency failure gate' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);

    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: {
        rows: createCoverageRows('covered'),
        complete: true,
        coveredCount: 1,
        gapCount: 0,
        conflictCount: 0,
        notTestableCount: 0,
      },
      resultStateConsistency: {
        status: 'inconsistent',
        ok: true,
        issueCount: 0,
        blockingIssueCount: 0,
      },
      verification: {
        commands: [
          { name: 'clean verification', result: 'passed', summary: 'verification passed' },
        ],
      },
      independentReview: {
        status: 'passed',
        grade: 'A',
        blockingIssueCount: 0,
      },
    } as any, NOW + 2);

    expect(gate).toMatchObject({
      status: 'failed',
      resultStateConsistency: {
        status: 'inconsistent',
        ok: true,
        issueCount: 0,
        blockingIssueCount: 0,
      },
    });
    expect(gate).toEqual((await getAutonomousRunQualityGates(run.id))[0]);
  });

  it('fails overall passed gates when the false-positive probe fails', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'false-positive-fail' });

    const run = await createAutonomousRun({ id: 'false-positive-run', goal: 'False positive probe failure' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);

    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: {
        rows: createCoverageRows('covered'),
        complete: true,
        coveredCount: 1,
        gapCount: 0,
        conflictCount: 0,
        notTestableCount: 0,
      },
      falsePositiveProbe: {
        status: 'failed',
        issueCount: 1,
        blockingIssueCount: 1,
      },
      resultStateConsistency: {
        status: 'consistent',
        ok: true,
        issueCount: 0,
        blockingIssueCount: 0,
      },
      verification: {
        commands: [
          { name: 'clean verification', result: 'passed', summary: 'verification passed' },
        ],
      },
      independentReview: {
        status: 'passed',
        grade: 'A',
        blockingIssueCount: 0,
      },
    }, NOW + 2);

    expect(gate).toMatchObject({
      status: 'failed',
      falsePositiveProbe: {
        status: 'failed',
        issueCount: 1,
        blockingIssueCount: 1,
      },
    });
    expect(gate).toEqual((await getAutonomousRunQualityGates(run.id))[0]);
  });

  it('redacts quality-gate secrets before truncating text', async () => {
    const { chromeStub, storage } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'truncate' });

    const run = await createAutonomousRun({ id: 'truncate-run', goal: 'Truncation privacy gate' }, NOW);
    await transitionAutonomousRun(run.id, 'running', null, NOW + 1);
    const longPrefix = 'x'.repeat(115);

    const gate = await appendAutonomousQualityGateRecord(run.id, {
      status: 'passed',
      contractCoverage: {
        rows: createCoverageRows('covered'),
        complete: true,
        coveredCount: 1,
        gapCount: 0,
        conflictCount: 0,
        notTestableCount: 0,
      },
      resultStateConsistency: {
        status: 'consistent',
        ok: true,
        issueCount: 0,
        blockingIssueCount: 0,
      },
      verification: {
        commands: [
          {
            name: `${longPrefix} ghp_abcdefghijklmnopqrstuvwxyz1234567890 run-boundary12345`,
            result: 'passed',
            summary: `${'y'.repeat(250)} token=boundary-token-123 api_key=boundary-key-456 github_pat_1234567890abcdefghijklmnopqrstuvwxyz`,
          },
        ],
      },
      commit: {
        hash: 'abcdef1',
        message: `${'z'.repeat(155)} run-boundary12345 token=boundary-token-123`,
      },
      independentReview: {
        status: 'passed',
        grade: 'A',
        blockingIssueCount: 0,
      },
    }, NOW + 2);

    const returnedJson = JSON.stringify(gate);
    const durableJson = JSON.stringify(storage.get(AUTONOMOUS_RUN_STORAGE_KEY));

    expect(returnedJson).not.toMatch(/ghp_|github_pat_|abcdefghijklmnopqrstuvwxyz1234567890|run-boundary12345|boundary-token-123|boundary-key-456/);
    expect(durableJson).not.toMatch(/ghp_|github_pat_|abcdefghijklmnopqrstuvwxyz1234567890|run-boundary12345|boundary-token-123|boundary-key-456/);
    expect(returnedJson).toContain('[redacted:secret]');
    expect(durableJson).toContain('[redacted:secret]');
    expect(returnedJson).toContain('[redacted:id]');
    expect(durableJson).toContain('[redacted:id]');
    expect(gate).toEqual((await getAutonomousRunQualityGates(run.id))[0]);
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
      rows: createCoverageRows('covered'),
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

function createCoverageRows(...statuses: Array<'covered' | 'gap' | 'conflict' | 'not_testable'>) {
  return statuses.map((status, index) => ({
    kind: 'done_criterion' as const,
    requirement: `requirement ${index + 1}`,
    status,
    matchedBy: status === 'covered' ? [`test-${index + 1}`] : [],
  }));
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
