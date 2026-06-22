import type { AutonomousRunTelemetryFile, AutonomousRunTelemetryPackage } from './telemetry';

export interface AutonomousRunTelemetryWriteTarget {
  writeTextFile(path: string, content: string): void | Promise<void>;
}

export interface AutonomousRunTelemetryWriteResult {
  runId: string;
  rootDir: string;
  fileCount: number;
  contentLength: number;
  paths: string[];
}

export async function writeAutonomousRunTelemetryPackage(
  pkg: AutonomousRunTelemetryPackage,
  target: AutonomousRunTelemetryWriteTarget,
): Promise<AutonomousRunTelemetryWriteResult> {
  const packageFiles = validateTelemetryPackage(pkg);
  const runId = pkg.runId;
  const rootDir = pkg.rootDir;
  const completionMarker = createCompletionMarker(runId, rootDir, packageFiles);
  const files = [...packageFiles, completionMarker];
  for (const file of files) {
    await target.writeTextFile(file.path, file.content);
  }
  return {
    runId,
    rootDir,
    fileCount: files.length,
    contentLength: files.reduce((total, file) => total + file.content.length, 0),
    paths: files.map((file) => file.path),
  };
}

function validateTelemetryPackage(pkg: AutonomousRunTelemetryPackage): readonly AutonomousRunTelemetryFile[] {
  if (!isSafeRelativePath(pkg.rootDir)) {
    throw new Error(`Unsafe telemetry root: ${pkg.rootDir}`);
  }
  if (!pkg.rootDir.startsWith('.runs/')) {
    throw new Error(`Telemetry root must stay under .runs: ${pkg.rootDir}`);
  }

  const expectedPrefix = `${pkg.rootDir}/`;
  const completionPath = `${pkg.rootDir}/.complete.json`;
  const seen = new Set<string>([completionPath.toLowerCase()]);
  const validated: AutonomousRunTelemetryFile[] = [];
  for (const file of pkg.files) {
    if (!file.path.startsWith(expectedPrefix)) {
      throw new Error(`Telemetry file escapes package root: ${file.path}`);
    }
    if (!isSafeRelativePath(file.path)) {
      throw new Error(`Unsafe telemetry file path: ${file.path}`);
    }
    const normalizedPath = file.path.toLowerCase();
    if (seen.has(normalizedPath)) {
      throw new Error(`Duplicate telemetry file path: ${file.path}`);
    }
    seen.add(normalizedPath);
    validated.push({ path: file.path, content: file.content });
  }
  return validated;
}

function createCompletionMarker(
  runId: string,
  rootDir: string,
  files: readonly AutonomousRunTelemetryFile[],
): AutonomousRunTelemetryFile {
  const marker = {
    schemaVersion: 1,
    runId,
    rootDir,
    packageFileCount: files.length,
    packageContentLength: files.reduce((total, file) => total + file.content.length, 0),
    packagePaths: files.map((file) => file.path),
  };
  return {
    path: `${rootDir}/.complete.json`,
    content: `${JSON.stringify(marker, null, 2)}\n`,
  };
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}
