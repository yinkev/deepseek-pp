import { redactDurableToolString } from '../tool/redaction';
import type {
  AutonomousEvidenceRecord,
  AutonomousRun,
  AutonomousRunId,
  AutonomousRunStep,
  AutonomousRunStorageState,
  AutonomousTargetLease,
} from './types';

const GENERIC_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>)}\]]+/gi;
const SENSITIVE_ASSIGNMENT_PATTERN = /\b(?:authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|signed[_-]?path)\s*[:=]\s*[^"'\s,;}]+/gi;

export interface AutonomousRunTelemetryVerification {
  command: string;
  exitCode: number;
  durationMs?: number | null;
  passed?: boolean | null;
}

export interface AutonomousRunTelemetryCommit {
  sha: string;
  message?: string | null;
  filesChanged?: number | null;
  linkedStepId?: string | null;
}

export interface AutonomousRunTelemetryPackageOptions {
  generatedAt?: number;
  rootDir?: string;
  verification?: readonly AutonomousRunTelemetryVerification[] | null;
  commits?: readonly AutonomousRunTelemetryCommit[] | null;
}

export interface AutonomousRunTelemetryFile {
  path: string;
  content: string;
}

export interface AutonomousRunTelemetryPackage {
  runId: AutonomousRunId;
  rootDir: string;
  files: AutonomousRunTelemetryFile[];
}

interface RunTelemetryManifest {
  schemaVersion: 1;
  generatedAt: number;
  run: {
    id: string;
    status: AutonomousRun['status'];
    mode: AutonomousRun['mode'];
    modelAdapter: AutonomousRun['modelAdapter'];
    targetLeasePresent: boolean;
    createdAt: number;
    startedAt: number | null;
    completedAt: number | null;
    updatedAt: number;
    error: SafeError | null;
  };
  counts: {
    steps: number;
    evidence: number;
    targetLeases: number;
    verification: number;
    commits: number;
  };
  proofContract: {
    doneCriteriaCount: number;
    requiredEvidenceCount: number;
    antiProofCount: number;
  };
  policy: {
    approvalMode: AutonomousRun['policy']['approvalMode'];
    shellMode: AutonomousRun['policy']['shellMode'];
    persistMemory: AutonomousRun['policy']['persistMemory'];
    browserMutationRequiresTargetLock: true;
    allowedToolCount: number;
    deniedToolCount: number;
  };
  budgets: AutonomousRun['budgets'];
}

interface SafeError {
  code: string;
  phase: AutonomousRun['error'] extends infer E
    ? E extends { phase: infer P } ? P : string
    : string;
  retryable: boolean;
  at: number;
}

export function createAutonomousRunTelemetryPackage(
  state: AutonomousRunStorageState,
  runId: AutonomousRunId,
  options: AutonomousRunTelemetryPackageOptions = {},
): AutonomousRunTelemetryPackage | null {
  const run = state.runs.find((item) => item.id === runId);
  if (!run) return null;

  const generatedAt = normalizeTimestamp(options.generatedAt) ?? Date.now();
  const rootDir = normalizeRootDir(options.rootDir, run.id);
  const steps = state.steps
    .filter((step) => step.runId === run.id)
    .sort((a, b) => a.seq - b.seq);
  const evidence = state.evidence
    .filter((record) => record.runId === run.id)
    .sort((a, b) => a.capturedAt - b.capturedAt);
  const targetLeases = state.targetLeases
    .filter((lease) => lease.runId === run.id)
    .sort((a, b) => a.acquiredAt - b.acquiredAt);
  const verification = sanitizeVerification(options.verification);
  const commits = sanitizeCommits(options.commits);

  return {
    runId: run.id,
    rootDir,
    files: [
      jsonFile(rootDir, 'manifest.json', createManifest(run, steps, evidence, targetLeases, verification, commits, generatedAt)),
      jsonFile(rootDir, 'checkpoint.json', createCheckpointExport(run)),
      ndjsonFile(rootDir, 'steps.ndjson', steps.map(toStepExport)),
      ndjsonFile(rootDir, 'evidence.ndjson', evidence.map(toEvidenceExport)),
      ndjsonFile(rootDir, 'target-leases.ndjson', targetLeases.map(toTargetLeaseExport)),
      jsonFile(rootDir, 'verification.json', { schemaVersion: 1, generatedAt, commands: verification }),
      ndjsonFile(rootDir, 'commits.ndjson', commits),
      markdownFile(rootDir, 'report.md', createReport(run, steps, evidence, targetLeases, verification, commits, generatedAt)),
    ],
  };
}

function createManifest(
  run: AutonomousRun,
  steps: readonly AutonomousRunStep[],
  evidence: readonly AutonomousEvidenceRecord[],
  targetLeases: readonly AutonomousTargetLease[],
  verification: readonly ReturnType<typeof sanitizeVerification>[number][],
  commits: readonly ReturnType<typeof sanitizeCommits>[number][],
  generatedAt: number,
): RunTelemetryManifest {
  return {
    schemaVersion: 1,
    generatedAt,
    run: {
      id: run.id,
      status: run.status,
      mode: run.mode,
      modelAdapter: run.modelAdapter,
      targetLeasePresent: run.targetLeaseId !== null,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      updatedAt: run.updatedAt,
      error: run.error ? toSafeError(run.error) : null,
    },
    counts: {
      steps: steps.length,
      evidence: evidence.length,
      targetLeases: targetLeases.length,
      verification: verification.length,
      commits: commits.length,
    },
    proofContract: {
      doneCriteriaCount: run.proofContract.doneCriteria.length,
      requiredEvidenceCount: run.proofContract.requiredEvidence.length,
      antiProofCount: run.proofContract.antiProof.length,
    },
    policy: {
      approvalMode: run.policy.approvalMode,
      shellMode: run.policy.shellMode,
      persistMemory: run.policy.persistMemory,
      browserMutationRequiresTargetLock: run.policy.browserMutationRequiresTargetLock,
      allowedToolCount: run.policy.allowedTools.length,
      deniedToolCount: run.policy.deniedTools.length,
    },
    budgets: run.budgets,
  };
}

function createCheckpointExport(run: AutonomousRun) {
  return {
    schemaVersion: 1,
    runId: run.id,
    latestStepId: run.checkpoint.latestStepId,
    providerConversationPresent: run.checkpoint.providerConversationId !== null,
    parentMessagePresent: run.checkpoint.parentMessageId !== null,
    resumableSummaryCharCount: run.checkpoint.resumableSummary.length,
    unresolvedQuestionCount: run.checkpoint.unresolvedQuestions.length,
  };
}

function toStepExport(step: AutonomousRunStep) {
  return {
    id: step.id,
    runId: step.runId,
    seq: step.seq,
    phase: step.phase,
    status: step.status,
    modelTurnPresent: step.modelTurnId !== null,
    toolCallCount: step.toolCallIds.length,
    observationRefCount: step.observationRefs.length,
    evidenceRefCount: step.evidenceRefs.length,
    progressScore: step.progressScore,
    proofDeltaCount: step.proofDelta.length,
    error: step.error ? toSafeError(step.error) : null,
    startedAt: step.startedAt,
    endedAt: step.endedAt,
  };
}

function toEvidenceExport(record: AutonomousEvidenceRecord) {
  return {
    id: record.id,
    runId: record.runId,
    leasePresent: record.leaseId !== null,
    kind: record.kind,
    freshness: record.freshness,
    capturedAt: record.capturedAt,
    expiresAt: record.expiresAt,
    summaryCharCount: record.summary.length,
    refCount: record.refs.length,
    source: {
      hasTab: typeof record.source.tabId === 'number',
      hasWindow: typeof record.source.windowId === 'number',
      toolName: sanitizeOptionalString(record.source.toolName, 80),
      automationIdPresent: typeof record.source.automationId === 'string',
      automationRunIdPresent: typeof record.source.automationRunId === 'string',
    },
    metadataPresent: record.metadata !== null,
  };
}

function toTargetLeaseExport(lease: AutonomousTargetLease) {
  return {
    id: lease.id,
    runId: lease.runId,
    status: lease.status,
    labelPresent: lease.label.length > 0,
    tabPresent: Number.isFinite(lease.tabId),
    windowPresent: Number.isFinite(lease.windowId),
    originPresent: lease.origin.length > 0,
    titlePresent: lease.title.length > 0,
    acquiredAt: lease.acquiredAt,
    expiresAt: lease.expiresAt,
    lastVerifiedAt: lease.lastVerifiedAt,
    releasedAt: lease.releasedAt,
  };
}

function createReport(
  run: AutonomousRun,
  steps: readonly AutonomousRunStep[],
  evidence: readonly AutonomousEvidenceRecord[],
  targetLeases: readonly AutonomousTargetLease[],
  verification: readonly ReturnType<typeof sanitizeVerification>[number][],
  commits: readonly ReturnType<typeof sanitizeCommits>[number][],
  generatedAt: number,
): string {
  const verificationPassed = verification.length === 0
    ? 'not-recorded'
    : verification.every((item) => item.passed) ? 'passed' : 'failed';
  return [
    `# Autonomous Run ${run.id}`,
    '',
    `- generatedAt: ${generatedAt}`,
    `- status: ${run.status}`,
    `- steps: ${steps.length}`,
    `- evidence: ${evidence.length}`,
    `- targetLeases: ${targetLeases.length}`,
    `- verification: ${verificationPassed}`,
    `- commits: ${commits.length}`,
    '',
  ].join('\n');
}

function toSafeError(error: NonNullable<AutonomousRun['error']>): SafeError {
  return {
    code: sanitizeToken(error.code, 120),
    phase: error.phase,
    retryable: error.retryable,
    at: error.at,
  };
}

function sanitizeVerification(input: readonly AutonomousRunTelemetryVerification[] | null | undefined) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    const exitCode = normalizeInteger(item.exitCode) ?? 1;
    return {
      command: sanitizeOptionalString(item.command, 200) ?? '',
      exitCode,
      durationMs: normalizeNonNegativeInteger(item.durationMs),
      passed: item.passed === false ? false : exitCode === 0,
    };
  });
}

function sanitizeCommits(input: readonly AutonomousRunTelemetryCommit[] | null | undefined) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => ({
    sha: sanitizeToken(item.sha, 80),
    message: sanitizeOptionalString(item.message ?? '', 200) ?? '',
    filesChanged: normalizeNonNegativeInteger(item.filesChanged),
    linkedStepId: sanitizeOptionalString(item.linkedStepId ?? '', 120) || null,
  }));
}

function jsonFile(rootDir: string, name: string, value: unknown): AutonomousRunTelemetryFile {
  return {
    path: `${rootDir}/${name}`,
    content: `${JSON.stringify(value, null, 2)}\n`,
  };
}

function ndjsonFile(rootDir: string, name: string, values: readonly unknown[]): AutonomousRunTelemetryFile {
  return {
    path: `${rootDir}/${name}`,
    content: values.map((value) => JSON.stringify(value)).join('\n') + (values.length > 0 ? '\n' : ''),
  };
}

function markdownFile(rootDir: string, name: string, content: string): AutonomousRunTelemetryFile {
  return {
    path: `${rootDir}/${name}`,
    content,
  };
}

function normalizeRootDir(input: string | null | undefined, runId: string): string {
  const base = sanitizePathSegment(input || '.runs');
  return `${base}/${sanitizePathSegment(runId)}`;
}

function sanitizePathSegment(value: string): string {
  const cleaned = value
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, '_'))
    .filter((segment) => segment !== '.' && segment !== '..')
    .join('/');
  return cleaned || '.runs';
}

function sanitizeOptionalString(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const redacted = (redactDurableToolString(value) ?? '')
    .replace(GENERIC_URL_PATTERN, '[redacted:url]')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '[redacted:secret]');
  return redacted.slice(0, maxLength);
}

function sanitizeToken(value: string, maxLength: number): string {
  return (sanitizeOptionalString(value, maxLength) ?? '').replace(/[^A-Za-z0-9._:-]/g, '_');
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.floor(value);
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  const int = normalizeInteger(value);
  return int === null ? null : Math.max(0, int);
}
