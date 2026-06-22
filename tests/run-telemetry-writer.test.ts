import { describe, expect, it } from 'vitest';
import { writeAutonomousRunTelemetryPackage } from '../core/run/telemetry-writer';
import type { AutonomousRunTelemetryPackage } from '../core/run/telemetry';

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
    ]);
    expect(result).toEqual({
      runId: 'run-1',
      rootDir: '.runs/run-1',
      fileCount: 2,
      contentLength: 12,
      paths: ['.runs/run-1/manifest.json', '.runs/run-1/report.md'],
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
        originalSecondFile.path = '/tmp/object-mutated';
        originalSecondFile.content = 'object-mutated';
        pkg.files[1] = { path: '/tmp/evil', content: 'evil' };
        pkg.files.push({ path: '/tmp/appended', content: 'evil' });
      },
    });

    expect(writes).toEqual([
      { path: '.runs/run-1/manifest.json', content: '{}\n' },
      { path: '.runs/run-1/report.md', content: '# Report\n' },
    ]);
    expect(result.paths).toEqual(['.runs/run-1/manifest.json', '.runs/run-1/report.md']);
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
