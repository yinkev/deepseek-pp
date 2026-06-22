import { describe, expect, it } from 'vitest';
import { createAutonomousRunTelemetryPackage } from '../core/run/telemetry';
import type { AutonomousRunStorageState } from '../core/run/types';

describe('autonomous run telemetry package', () => {
  it('returns null for a missing run', () => {
    expect(createAutonomousRunTelemetryPackage(createState(), 'missing')).toBeNull();
  });

  it('creates stable repo-visible telemetry files for one run', () => {
    const pkg = createAutonomousRunTelemetryPackage(createState(), 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0, durationMs: 1234 }],
      commits: [{ sha: 'abc123', message: 'Add telemetry', filesChanged: 3, linkedStepId: 'step-1' }],
    });

    expect(pkg?.runId).toBe('run-1');
    expect(pkg?.rootDir).toBe('.runs/run-1');
    expect(pkg?.files.map((file) => file.path)).toEqual([
      '.runs/run-1/manifest.json',
      '.runs/run-1/checkpoint.json',
      '.runs/run-1/steps.ndjson',
      '.runs/run-1/evidence.ndjson',
      '.runs/run-1/target-leases.ndjson',
      '.runs/run-1/verification.json',
      '.runs/run-1/commits.ndjson',
      '.runs/run-1/report.md',
    ]);

    const manifest = readJson(pkg, 'manifest.json');
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      generatedAt: 500,
      run: {
        id: 'run-1',
        status: 'running',
        mode: 'unattended',
        modelAdapter: 'deepseek_web',
        targetLeasePresent: true,
      },
      counts: {
        steps: 2,
        evidence: 1,
        targetLeases: 1,
        verification: 1,
        commits: 1,
      },
      proofContract: {
        doneCriteriaCount: 1,
        requiredEvidenceCount: 1,
        antiProofCount: 1,
      },
      policy: {
        approvalMode: 'auto_low_risk',
        shellMode: 'allowlisted',
        persistMemory: 'propose',
        allowedToolCount: 1,
        deniedToolCount: 1,
      },
    });

    expect(readNdjson(pkg, 'steps.ndjson')).toEqual([
      expect.objectContaining({
        id: 'step-1',
        seq: 1,
        phase: 'plan',
        evidenceRefCount: 0,
        proofDeltaCount: 1,
      }),
      expect.objectContaining({
        id: 'step-2',
        seq: 2,
        phase: 'verification',
        evidenceRefCount: 1,
        proofDeltaCount: 1,
      }),
    ]);
    expect(readNdjson(pkg, 'evidence.ndjson')).toEqual([
      expect.objectContaining({
        id: 'evidence-1',
        kind: 'shell_output',
        summaryCharCount: 35,
        refCount: 1,
        metadataPresent: true,
      }),
    ]);
  });

  it('omits raw goals, checkpoint text, evidence summaries, refs, urls, metadata, and secrets', () => {
    const state = createState({
      secretGoal: 'Use Authorization: Bearer secret and https://example.com/private?token=secret',
      secretSummary: 'Resume with Cookie: sid=secret and file-sensitive123',
      secretEvidenceSummary: 'Fetched https://example.com/private?token=secret with data:image/png;base64,AAAA',
    });
    const pkg = createAutonomousRunTelemetryPackage(state, 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'curl https://example.com/private?token=secret -H "Authorization: Bearer secret"', exitCode: 1, passed: true }],
      commits: [{ sha: 'bad sha with spaces', message: 'Fix Token=secret Authorization: Bearer secret', filesChanged: -3 }],
    });

    const source = JSON.stringify(state);
    expect(source).toMatch(/Bearer secret|token=secret|Cookie|file-sensitive123|data:image/);

    const output = JSON.stringify(pkg);
    expect(output).not.toMatch(/Bearer secret|token=secret|Cookie|sid=secret|file-sensitive123|data:image|private\?token|Authorization/i);
    expect(output).not.toContain('Use [redacted:secret]');
    expect(output).not.toContain('Resume with');
    expect(output).not.toContain('Fetched');
    expect(readJson(pkg, 'verification.json').commands[0]).toMatchObject({
      exitCode: 1,
      passed: false,
    });

    const checkpoint = readJson(pkg, 'checkpoint.json');
    expect(checkpoint).toMatchObject({
      latestStepId: 'step-2',
      providerConversationPresent: true,
      parentMessagePresent: true,
      resumableSummaryCharCount: state.runs[0].checkpoint.resumableSummary.length,
      unresolvedQuestionCount: 1,
    });
    expect(readNdjson(pkg, 'evidence.ndjson')[0]).not.toHaveProperty('summary');
    expect(readNdjson(pkg, 'evidence.ndjson')[0]).not.toHaveProperty('refs');
    expect(readNdjson(pkg, 'evidence.ndjson')[0]).not.toHaveProperty('metadata');
  });

  it('normalizes root paths and keeps package paths inside .runs-style directories', () => {
    const pkg = createAutonomousRunTelemetryPackage(createState(), 'run-1', {
      rootDir: '../bad path//telemetry',
    });

    expect(pkg?.rootDir).toBe('bad_path/telemetry/run-1');
    expect(pkg?.files.every((file) => file.path.startsWith('bad_path/telemetry/run-1/'))).toBe(true);
  });
});

function readJson(pkg: ReturnType<typeof createAutonomousRunTelemetryPackage>, name: string): any {
  const file = pkg?.files.find((item) => item.path.endsWith(`/${name}`));
  expect(file).toBeDefined();
  return JSON.parse(file?.content ?? '{}');
}

function readNdjson(pkg: ReturnType<typeof createAutonomousRunTelemetryPackage>, name: string): any[] {
  const file = pkg?.files.find((item) => item.path.endsWith(`/${name}`));
  expect(file).toBeDefined();
  const content = file?.content.trim() ?? '';
  return content ? content.split('\n').map((line) => JSON.parse(line)) : [];
}

function createState(overrides: {
  secretGoal?: string;
  secretSummary?: string;
  secretEvidenceSummary?: string;
} = {}): AutonomousRunStorageState {
  return {
    version: 1,
    runs: [
      {
        id: 'run-1',
        goal: overrides.secretGoal ?? 'Build telemetry',
        mode: 'unattended',
        status: 'running',
        modelAdapter: 'deepseek_web',
        targetLeaseId: 'lease-1',
        budgets: {
          maxWallMs: 1000,
          maxModelTurns: 10,
          maxToolCalls: 20,
          maxConsecutiveNoProgress: 2,
          maxSameErrorRepeats: 1,
          maxPromptBytesPerTurn: 100,
          maxObservationBytesPerTurn: 50,
        },
        policy: {
          approvalMode: 'auto_low_risk',
          allowedTools: ['shell_exec'],
          deniedTools: ['dangerous_tool'],
          browserMutationRequiresTargetLock: true,
          persistMemory: 'propose',
          shellMode: 'allowlisted',
        },
        proofContract: {
          doneCriteria: ['tests pass'],
          requiredEvidence: ['shell_output'],
          antiProof: ['no model text completion'],
        },
        checkpoint: {
          providerConversationId: 'provider-secret-id',
          parentMessageId: 'parent-secret-id',
          latestStepId: 'step-2',
          resumableSummary: overrides.secretSummary ?? 'Resume after tests.',
          unresolvedQuestions: ['Need final review'],
        },
        error: null,
        createdAt: 100,
        startedAt: 110,
        completedAt: null,
        updatedAt: 200,
      },
    ],
    steps: [
      {
        id: 'step-2',
        runId: 'run-1',
        seq: 2,
        phase: 'verification',
        status: 'succeeded',
        modelTurnId: 'model-turn-secret',
        toolCallIds: ['tool-call-secret'],
        observationRefs: ['observation-secret'],
        evidenceRefs: ['evidence-1'],
        progressScore: 1,
        proofDelta: ['tests pass with secret token'],
        error: null,
        startedAt: 180,
        endedAt: 190,
      },
      {
        id: 'step-1',
        runId: 'run-1',
        seq: 1,
        phase: 'plan',
        status: 'succeeded',
        modelTurnId: null,
        toolCallIds: [],
        observationRefs: [],
        evidenceRefs: [],
        progressScore: 0.2,
        proofDelta: ['plan written'],
        error: null,
        startedAt: 120,
        endedAt: 130,
      },
    ],
    targetLeases: [
      {
        id: 'lease-1',
        runId: 'run-1',
        status: 'active',
        label: 'Target secret title',
        tabId: 123,
        windowId: 456,
        origin: 'https://example.com/private?token=secret',
        title: 'Private page',
        acquiredAt: 111,
        expiresAt: 999,
        lastVerifiedAt: 150,
        releasedAt: null,
      },
    ],
    evidence: [
      {
        id: 'evidence-1',
        runId: 'run-1',
        leaseId: 'lease-1',
        kind: 'shell_output',
        freshness: 'fresh',
        capturedAt: 170,
        expiresAt: 970,
        summary: overrides.secretEvidenceSummary ?? 'shell_output tests pass evidence ok',
        refs: ['ref-secret-url'],
        source: {
          tabId: 123,
          windowId: 456,
          toolName: 'shell_exec',
          automationId: 'automation-secret',
          automationRunId: 'automation-run-secret',
        },
        metadata: {
          url: 'https://example.com/private?token=secret',
          authorization: 'Bearer secret',
        },
      },
    ],
  };
}
