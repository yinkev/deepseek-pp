import { describe, expect, it } from 'vitest';
import { createAutonomousRunTelemetryPackage } from '../core/run/telemetry';
import { writeAutonomousRunTelemetryPackage } from '../core/run/telemetry-writer';
import type { AutonomousRunTelemetryPackage } from '../core/run/telemetry';
import type { AutonomousRunStorageState } from '../core/run/types';

describe('autonomous run telemetry writer', () => {
  it('validates then writes package files in package order', async () => {
    const writes: Array<{ path: string; content: string }> = [];

    const result = await writeAutonomousRunTelemetryPackage(createPackage(), {
      writeTextFile(path, content) {
        writes.push({ path, content });
      },
    });

    expect(writes).toEqual([
      { path: '.runs/run-1/manifest.json', content: '{}\n' },
      { path: '.runs/run-1/report.md', content: '# Report\n' },
      { path: '.runs/run-1/.complete.json', content: expect.stringContaining('"packageFileCount": 2') },
    ]);
    expect(result).toEqual({
      runId: 'run-1',
      rootDir: '.runs/run-1',
      fileCount: 3,
      contentLength: writes.reduce((total, write) => total + write.content.length, 0),
      paths: ['.runs/run-1/manifest.json', '.runs/run-1/report.md', '.runs/run-1/.complete.json'],
    });
    expect(JSON.parse(writes[2].content)).toMatchObject({
      schemaVersion: 1,
      runId: 'run-1',
      rootDir: '.runs/run-1',
      packageFileCount: 2,
      packageContentLength: 12,
      packagePaths: ['.runs/run-1/manifest.json', '.runs/run-1/report.md'],
    });
  });

  it('rejects unsafe paths before writing any file', async () => {
    const writes: string[] = [];
    const unsafePackages: AutonomousRunTelemetryPackage[] = [
      createPackage({ rootDir: '../runs/run-1' }),
      createPackage({ rootDir: '/tmp/run-1' }),
      createPackage({ rootDir: 'C:/tmp/run-1' }),
      createPackage({ rootDir: '.runs\\run-1' }),
      createPackage({ rootDir: 'core/run-1', files: [{ path: 'core/run-1/manifest.json', content: '{}\n' }] }),
      createPackage({ files: [{ path: '.runs/run-2/manifest.json', content: '{}\n' }] }),
      createPackage({ files: [{ path: '.runs/run-1/../manifest.json', content: '{}\n' }] }),
      createPackage({
        files: [
          { path: '.runs/run-1/manifest.json', content: '{}\n' },
          { path: '.runs/run-1/manifest.json', content: '{}\n' },
        ],
      }),
      createPackage({
        files: [
          { path: '.runs/run-1/report.md', content: '# Report\n' },
          { path: '.runs/run-1/REPORT.md', content: '# Report\n' },
        ],
      }),
      createPackage({ files: [{ path: '.runs/run-1/.complete.json', content: '{}\n' }] }),
    ];

    for (const pkg of unsafePackages) {
      await expect(writeAutonomousRunTelemetryPackage(pkg, {
        writeTextFile(path) {
          writes.push(path);
        },
      })).rejects.toThrow(/Unsafe telemetry|escapes package root|Duplicate telemetry|must stay under \.runs/);
    }
    expect(writes).toEqual([]);
  });

  it('writes a validated snapshot even if caller mutates package during write', async () => {
    const pkg = createPackage();
    const originalSecondFile = pkg.files[1];
    const writes: Array<{ path: string; content: string }> = [];

    const result = await writeAutonomousRunTelemetryPackage(pkg, {
      async writeTextFile(path, content) {
        writes.push({ path, content });
        pkg.runId = 'mutated-run';
        pkg.rootDir = '/tmp/mutated-root';
        originalSecondFile.path = '/tmp/object-mutated';
        originalSecondFile.content = 'object-mutated';
        pkg.files[1] = { path: '/tmp/evil', content: 'evil' };
        pkg.files.push({ path: '/tmp/appended', content: 'evil' });
      },
    });

    expect(writes).toEqual([
      { path: '.runs/run-1/manifest.json', content: '{}\n' },
      { path: '.runs/run-1/report.md', content: '# Report\n' },
      { path: '.runs/run-1/.complete.json', content: expect.stringContaining('"packageFileCount": 2') },
    ]);
    expect(result).toMatchObject({
      runId: 'run-1',
      rootDir: '.runs/run-1',
      paths: ['.runs/run-1/manifest.json', '.runs/run-1/report.md', '.runs/run-1/.complete.json'],
    });
  });

  it('does not write a completion marker when a package file write fails', async () => {
    const writes: string[] = [];

    await expect(writeAutonomousRunTelemetryPackage(createPackage(), {
      writeTextFile(path) {
        writes.push(path);
        if (path.endsWith('/report.md')) throw new Error('disk failed');
      },
    })).rejects.toThrow(/disk failed/);

    expect(writes).toEqual(['.runs/run-1/manifest.json', '.runs/run-1/report.md']);
    expect(writes).not.toContain('.runs/run-1/.complete.json');
  });

  it('does not write a completion marker when real handoff file write fails', async () => {
    const pkg = createAutonomousRunTelemetryPackage(createState(), 'run-1', { generatedAt: 500 });
    expect(pkg?.files.map((file) => file.path)).toContain('.runs/run-1/handoff.json');
    const writes: string[] = [];

    await expect(writeAutonomousRunTelemetryPackage(pkg!, {
      writeTextFile(path) {
        writes.push(path);
        if (path.endsWith('/handoff.json')) throw new Error('handoff write failed');
      },
    })).rejects.toThrow(/handoff write failed/);

    expect(writes).toEqual([
      '.runs/run-1/manifest.json',
      '.runs/run-1/handoff.json',
    ]);
    expect(writes).not.toContain('.runs/run-1/.complete.json');
  });
});

function createPackage(overrides: Partial<AutonomousRunTelemetryPackage> = {}): AutonomousRunTelemetryPackage {
  return {
    runId: overrides.runId ?? 'run-1',
    rootDir: overrides.rootDir ?? '.runs/run-1',
    files: overrides.files ?? [
      { path: '.runs/run-1/manifest.json', content: '{}\n' },
      { path: '.runs/run-1/report.md', content: '# Report\n' },
    ],
  };
}

function createState(): AutonomousRunStorageState {
  return {
    version: 1,
    runs: [
      {
        id: 'run-1',
        goal: 'Write restart telemetry',
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
          deniedTools: [],
          browserMutationRequiresTargetLock: true,
          persistMemory: 'propose',
          shellMode: 'allowlisted',
        },
        proofContract: {
          doneCriteria: ['tests pass'],
          requiredEvidence: [],
          antiProof: [],
        },
        checkpoint: {
          providerConversationId: null,
          parentMessageId: null,
          latestStepId: null,
          resumableSummary: '',
          unresolvedQuestions: [],
        },
        error: null,
        createdAt: 100,
        startedAt: 110,
        completedAt: null,
        updatedAt: 200,
      },
    ],
    steps: [],
    targetLeases: [
      {
        id: 'lease-1',
        runId: 'run-1',
        status: 'active',
        label: 'target',
        tabId: 1,
        windowId: 1,
        origin: 'https://example.com',
        title: 'target',
        acquiredAt: 100,
        expiresAt: 1000,
        lastVerifiedAt: 150,
        releasedAt: null,
      },
    ],
    evidence: [],
    qualityGates: [],
    reviewLanes: [],
  };
}
