import { redactDurableToolString } from '../tool/redaction';
import type {
  AutonomousEvidenceRecord,
  AutonomousQualityGateRecord,
  AutonomousReviewLaneRecord,
  AutonomousRun,
  AutonomousRunId,
  AutonomousRunStep,
  AutonomousRunStorageState,
  AutonomousTargetLease,
} from './types';

const GENERIC_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>)}\]]+/gi;
const SENSITIVE_ASSIGNMENT_PATTERN = /\b(?:authorization|cookie|set-cookie|api[_-]?key|apiKey|access[_-]?token|accessToken|refresh[_-]?token|refreshToken|token|secret|signed[_-]?path|signedPath)\s*[:=]\s*[^"'\s,;}]+/gi;

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

type TelemetryVerificationStatus = 'not-recorded' | 'passed' | 'failed' | 'conflicted';

interface TelemetryHandles {
  runId: string;
  stepIds: Map<string, string>;
  evidenceIds: Map<string, string>;
  targetLeaseIds: Map<string, string>;
  qualityGateIds: Map<string, string>;
  reviewLaneIds: Map<string, string>;
  rawIds: string[];
}

interface SafeVerificationCommand {
  command: string;
  exitCode: number;
  durationMs: number | null;
  passed: boolean;
}

interface VerificationSummary {
  status: TelemetryVerificationStatus;
  commandStatus: Exclude<TelemetryVerificationStatus, 'conflicted'>;
  durableStatus: AutonomousRun['status'];
  durableSucceeded: boolean;
  durableFailurePresent: boolean;
  failedStepCount: number;
  runErrorPresent: boolean;
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
    qualityGates: number;
    reviewLanes: number;
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
  verification: VerificationSummary;
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

  const generatedAt = normalizeTimestamp(options.generatedAt) ??
    normalizeTimestamp(run.updatedAt) ??
    normalizeTimestamp(run.createdAt) ??
    0;
  const steps = state.steps
    .filter((step) => step.runId === run.id)
    .sort(compareSteps);
  const evidence = state.evidence
    .filter((record) => record.runId === run.id)
    .sort(compareEvidence);
  const targetLeases = state.targetLeases
    .filter((lease) => lease.runId === run.id)
    .sort(compareTargetLeases);
  const qualityGates = state.qualityGates
    .filter((record) => record.runId === run.id)
    .sort(compareQualityGates);
  const reviewLanes = state.reviewLanes
    .filter((record) => record.runId === run.id)
    .sort(compareReviewLanes);
  const handles = createTelemetryHandles(run, steps, evidence, targetLeases, qualityGates, reviewLanes);
  const verification = sanitizeVerification(options.verification, handles);
  const verificationSummary = createVerificationSummary(run, steps, verification);
  const commits = sanitizeCommits(options.commits, handles);
  const safeRootDir = normalizeRootDir(options.rootDir, handles.runId, handles);

  return {
    runId: handles.runId,
    rootDir: safeRootDir,
    files: [
      jsonFile(safeRootDir, 'manifest.json', createManifest(run, steps, evidence, targetLeases, qualityGates, reviewLanes, verification, commits, generatedAt, handles, verificationSummary)),
      jsonFile(safeRootDir, 'checkpoint.json', createCheckpointExport(run, handles)),
      ndjsonFile(safeRootDir, 'steps.ndjson', steps.map((step) => toStepExport(step, handles))),
      ndjsonFile(safeRootDir, 'evidence.ndjson', evidence.map((record) => toEvidenceExport(record, handles))),
      ndjsonFile(safeRootDir, 'target-leases.ndjson', targetLeases.map((lease) => toTargetLeaseExport(lease, handles))),
      ndjsonFile(safeRootDir, 'quality-gates.ndjson', qualityGates.map((record) => toQualityGateExport(record, handles))),
      ndjsonFile(safeRootDir, 'review-lanes.ndjson', reviewLanes.map((record) => toReviewLaneExport(record, handles))),
      jsonFile(safeRootDir, 'verification.json', { schemaVersion: 1, generatedAt, summary: verificationSummary, commands: verification }),
      ndjsonFile(safeRootDir, 'commits.ndjson', commits),
      markdownFile(safeRootDir, 'report.md', createReport(run, steps, evidence, targetLeases, qualityGates, reviewLanes, commits, generatedAt, handles, verificationSummary)),
    ],
  };
}

function createManifest(
  run: AutonomousRun,
  steps: readonly AutonomousRunStep[],
  evidence: readonly AutonomousEvidenceRecord[],
  targetLeases: readonly AutonomousTargetLease[],
  qualityGates: readonly AutonomousQualityGateRecord[],
  reviewLanes: readonly AutonomousReviewLaneRecord[],
  verification: readonly SafeVerificationCommand[],
  commits: readonly ReturnType<typeof sanitizeCommits>[number][],
  generatedAt: number,
  handles: TelemetryHandles,
  verificationSummary: VerificationSummary,
): RunTelemetryManifest {
  return {
    schemaVersion: 1,
    generatedAt,
    run: {
      id: handles.runId,
      status: run.status,
      mode: run.mode,
      modelAdapter: run.modelAdapter,
      targetLeasePresent: run.targetLeaseId !== null,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      updatedAt: run.updatedAt,
      error: run.error ? toSafeError(run.error, handles) : null,
    },
    counts: {
      steps: steps.length,
      evidence: evidence.length,
      targetLeases: targetLeases.length,
      qualityGates: qualityGates.length,
      reviewLanes: reviewLanes.length,
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
    verification: verificationSummary,
  };
}

function createCheckpointExport(run: AutonomousRun, handles: TelemetryHandles) {
  return {
    schemaVersion: 1,
    runId: handles.runId,
    latestStepId: run.checkpoint.latestStepId ? handles.stepIds.get(run.checkpoint.latestStepId) ?? null : null,
    providerConversationPresent: run.checkpoint.providerConversationId !== null,
    parentMessagePresent: run.checkpoint.parentMessageId !== null,
    resumableSummaryCharCount: run.checkpoint.resumableSummary.length,
    unresolvedQuestionCount: run.checkpoint.unresolvedQuestions.length,
  };
}

function toStepExport(step: AutonomousRunStep, handles: TelemetryHandles) {
  return {
    id: handles.stepIds.get(step.id) ?? 'step-unknown',
    runId: handles.runId,
    seq: step.seq,
    phase: step.phase,
    status: step.status,
    modelTurnPresent: step.modelTurnId !== null,
    toolCallCount: step.toolCallIds.length,
    observationRefCount: step.observationRefs.length,
    evidenceRefCount: step.evidenceRefs.length,
    progressScore: step.progressScore,
    proofDeltaCount: step.proofDelta.length,
    error: step.error ? toSafeError(step.error, handles) : null,
    startedAt: step.startedAt,
    endedAt: step.endedAt,
  };
}

function toEvidenceExport(record: AutonomousEvidenceRecord, handles: TelemetryHandles) {
  return {
    id: handles.evidenceIds.get(record.id) ?? 'evidence-unknown',
    runId: handles.runId,
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
      toolName: sanitizeOptionalString(record.source.toolName, 80, handles),
      automationIdPresent: typeof record.source.automationId === 'string',
      automationRunIdPresent: typeof record.source.automationRunId === 'string',
    },
    metadataPresent: record.metadata !== null,
  };
}

function toTargetLeaseExport(lease: AutonomousTargetLease, handles: TelemetryHandles) {
  return {
    id: handles.targetLeaseIds.get(lease.id) ?? 'target-lease-unknown',
    runId: handles.runId,
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

function toQualityGateExport(record: AutonomousQualityGateRecord, handles: TelemetryHandles) {
  const commands = record.verification.commands;
  return {
    id: handles.qualityGateIds.get(record.id) ?? 'quality-gate-unknown',
    runId: handles.runId,
    seq: record.seq,
    createdAt: record.createdAt,
    status: record.status,
    contractCoverage: record.contractCoverage,
    resultStateConsistency: record.resultStateConsistency,
    selfReviewGrade: record.selfReview.grade,
    verification: {
      commandCount: commands.length,
      passedCommandCount: commands.filter((command) => command.result === 'passed').length,
      failedCommandCount: commands.filter((command) => command.result === 'failed').length,
      knownPreexistingFailureCount: commands.filter((command) => command.result === 'known_preexisting_failure').length,
    },
    commitPresent: record.commit !== null,
    independentReview: record.independentReview,
  };
}

function toReviewLaneExport(record: AutonomousReviewLaneRecord, handles: TelemetryHandles) {
  return {
    id: handles.reviewLaneIds.get(record.id) ?? 'review-lane-unknown',
    runId: handles.runId,
    seq: record.seq,
    createdAt: record.createdAt,
    role: record.role,
    status: record.status,
    grade: record.grade,
    recommendation: record.recommendation,
    highestPriority: record.highestPriority,
    issueCount: record.issueCount,
    evidenceRefCount: record.evidenceRefCount,
    summaryPresent: record.summary !== null,
    summaryCharCount: record.summary?.length ?? 0,
  };
}

function createReport(
  run: AutonomousRun,
  steps: readonly AutonomousRunStep[],
  evidence: readonly AutonomousEvidenceRecord[],
  targetLeases: readonly AutonomousTargetLease[],
  qualityGates: readonly AutonomousQualityGateRecord[],
  reviewLanes: readonly AutonomousReviewLaneRecord[],
  commits: readonly ReturnType<typeof sanitizeCommits>[number][],
  generatedAt: number,
  handles: TelemetryHandles,
  verificationSummary: VerificationSummary,
): string {
  return [
    `# Autonomous Run ${handles.runId}`,
    '',
    `- generatedAt: ${generatedAt}`,
    `- status: ${run.status}`,
    `- steps: ${steps.length}`,
    `- evidence: ${evidence.length}`,
    `- targetLeases: ${targetLeases.length}`,
    `- qualityGates: ${qualityGates.length}`,
    `- reviewLanes: ${reviewLanes.length}`,
    `- verification: ${verificationSummary.status}`,
    `- commits: ${commits.length}`,
    '',
  ].join('\n');
}

function toSafeError(error: NonNullable<AutonomousRun['error']>, handles: TelemetryHandles): SafeError {
  return {
    code: sanitizeToken(error.code, 120, handles),
    phase: error.phase,
    retryable: error.retryable,
    at: error.at,
  };
}

function sanitizeVerification(input: readonly AutonomousRunTelemetryVerification[] | null | undefined, handles: TelemetryHandles): SafeVerificationCommand[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    const exitCode = normalizeInteger(item.exitCode) ?? 1;
    return {
      command: sanitizeOptionalString(item.command, 200, handles) ?? '',
      exitCode,
      durationMs: normalizeNonNegativeInteger(item.durationMs),
      passed: item.passed === false ? false : exitCode === 0,
    };
  });
}

function createVerificationSummary(
  run: AutonomousRun,
  steps: readonly AutonomousRunStep[],
  commands: readonly SafeVerificationCommand[],
): VerificationSummary {
  const failedStepCount = steps.filter((step) => step.status === 'failed' || step.error !== null).length;
  const runErrorPresent = run.error !== null;
  const durableFailurePresent = runErrorPresent ||
    failedStepCount > 0 ||
    run.status === 'failed' ||
    run.status === 'blocked' ||
    run.status === 'cancelled';
  const durableSucceeded = run.status === 'succeeded' && !durableFailurePresent;
  const commandStatus = commands.length === 0
    ? 'not-recorded'
    : commands.every((item) => item.passed) ? 'passed' : 'failed';
  const status = commandStatus === 'not-recorded'
    ? 'not-recorded'
    : commandStatus === 'failed' || durableFailurePresent
      ? 'failed'
      : durableSucceeded ? 'passed' : 'conflicted';

  return {
    status,
    commandStatus,
    durableStatus: run.status,
    durableSucceeded,
    durableFailurePresent,
    failedStepCount,
    runErrorPresent,
  };
}

function sanitizeCommits(input: readonly AutonomousRunTelemetryCommit[] | null | undefined, handles: TelemetryHandles) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => ({
    sha: sanitizeToken(item.sha, 80, handles),
    message: sanitizeOptionalString(item.message ?? '', 200, handles) ?? '',
    filesChanged: normalizeNonNegativeInteger(item.filesChanged),
    linkedStepId: typeof item.linkedStepId === 'string' ? handles.stepIds.get(item.linkedStepId) ?? null : null,
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

function createTelemetryHandles(
  run: AutonomousRun,
  steps: readonly AutonomousRunStep[],
  evidence: readonly AutonomousEvidenceRecord[],
  targetLeases: readonly AutonomousTargetLease[],
  qualityGates: readonly AutonomousQualityGateRecord[],
  reviewLanes: readonly AutonomousReviewLaneRecord[],
): TelemetryHandles {
  const rawIds = collectDurableIds(run, steps, evidence, targetLeases, qualityGates, reviewLanes);
  return {
    runId: 'run-1',
    stepIds: createHandleMap(steps.map((step) => step.id), 'step'),
    evidenceIds: createHandleMap(evidence.map((record) => record.id), 'evidence'),
    targetLeaseIds: createHandleMap(targetLeases.map((lease) => lease.id), 'target-lease'),
    qualityGateIds: createHandleMap(qualityGates.map((record) => record.id), 'quality-gate'),
    reviewLaneIds: createHandleMap(reviewLanes.map((record) => record.id), 'review-lane'),
    rawIds,
  };
}

function collectDurableIds(
  run: AutonomousRun,
  steps: readonly AutonomousRunStep[],
  evidence: readonly AutonomousEvidenceRecord[],
  targetLeases: readonly AutonomousTargetLease[],
  qualityGates: readonly AutonomousQualityGateRecord[],
  reviewLanes: readonly AutonomousReviewLaneRecord[],
): string[] {
  const ids = new Set<string>([run.id]);
  if (run.targetLeaseId) ids.add(run.targetLeaseId);
  if (run.checkpoint.latestStepId) ids.add(run.checkpoint.latestStepId);
  for (const step of steps) {
    ids.add(step.id);
    for (const id of step.toolCallIds) ids.add(id);
    for (const id of step.observationRefs) ids.add(id);
    for (const id of step.evidenceRefs) ids.add(id);
    if (step.modelTurnId) ids.add(step.modelTurnId);
  }
  for (const record of evidence) {
    ids.add(record.id);
    if (record.leaseId) ids.add(record.leaseId);
    if (record.source.automationId) ids.add(record.source.automationId);
    if (record.source.automationRunId) ids.add(record.source.automationRunId);
    for (const id of record.refs) ids.add(id);
  }
  for (const lease of targetLeases) ids.add(lease.id);
  for (const record of qualityGates) ids.add(record.id);
  for (const record of reviewLanes) ids.add(record.id);
  return [...ids].filter((id) => id.length > 0).sort((a, b) => b.length - a.length);
}

function createHandleMap(ids: readonly string[], prefix: string): Map<string, string> {
  const output = new Map<string, string>();
  ids.forEach((id, index) => output.set(id, `${prefix}-${index + 1}`));
  return output;
}

function normalizeRootDir(input: string | null | undefined, runHandle: string, handles?: TelemetryHandles): string {
  const safeBase = sanitizeOptionalString(input || '.runs', 240, handles) ?? '.runs';
  const base = sanitizePathSegment(safeBase);
  return `${base}/${sanitizePathSegment(runHandle)}`;
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

function sanitizeOptionalString(value: string | null | undefined, maxLength: number, handles?: TelemetryHandles): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const redacted = (redactDurableToolString(value) ?? '')
    .replace(GENERIC_URL_PATTERN, '[redacted:url]')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '[redacted:secret]');
  const safe = redactDurableIds(redacted, handles);
  return safe.slice(0, maxLength);
}

function redactDurableIds(value: string, handles?: TelemetryHandles): string {
  if (!handles) return value;
  let output = value;
  for (const id of handles.rawIds) {
    output = output.split(id).join('[redacted:id]');
  }
  return output;
}

function sanitizeToken(value: string, maxLength: number, handles?: TelemetryHandles): string {
  return (sanitizeOptionalString(value, maxLength, handles) ?? '').replace(/[^A-Za-z0-9._:-]/g, '_');
}

function compareSteps(a: AutonomousRunStep, b: AutonomousRunStep): number {
  return compareNumber(a.seq, b.seq) || compareNumber(a.startedAt, b.startedAt) || a.id.localeCompare(b.id);
}

function compareEvidence(a: AutonomousEvidenceRecord, b: AutonomousEvidenceRecord): number {
  return compareNumber(a.capturedAt, b.capturedAt) || a.id.localeCompare(b.id);
}

function compareTargetLeases(a: AutonomousTargetLease, b: AutonomousTargetLease): number {
  return compareNumber(a.acquiredAt, b.acquiredAt) || a.id.localeCompare(b.id);
}

function compareQualityGates(a: AutonomousQualityGateRecord, b: AutonomousQualityGateRecord): number {
  return compareNumber(a.seq, b.seq) || compareNumber(a.createdAt, b.createdAt) || a.id.localeCompare(b.id);
}

function compareReviewLanes(a: AutonomousReviewLaneRecord, b: AutonomousReviewLaneRecord): number {
  return compareNumber(a.seq, b.seq) || compareNumber(a.createdAt, b.createdAt) || a.id.localeCompare(b.id);
}

function compareNumber(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
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
