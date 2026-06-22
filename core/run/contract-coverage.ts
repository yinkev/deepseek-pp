import type {
  AutonomousEvidenceRecord,
  AutonomousRun,
  AutonomousRunProofContract,
  AutonomousRunStep,
} from './types';

export type AutonomousContractCoverageKind = 'done_criterion' | 'required_evidence' | 'anti_proof';
export type AutonomousContractCoverageStatus = 'covered' | 'gap' | 'conflict' | 'not_testable';

export interface AutonomousContractCoverageRow {
  kind: AutonomousContractCoverageKind;
  requirement: string;
  status: AutonomousContractCoverageStatus;
  matchedBy: string[];
}

export interface AutonomousContractCoverageTable {
  rows: AutonomousContractCoverageRow[];
  coveredCount: number;
  gapCount: number;
  conflictCount: number;
  notTestableCount: number;
  complete: boolean;
}

export interface AutonomousContractCoverageInput {
  run: Pick<AutonomousRun, 'id' | 'proofContract'>;
  steps: readonly AutonomousRunStep[];
  evidence: readonly AutonomousEvidenceRecord[];
  acceptedEvidenceIds: readonly string[];
  notTestable?: Partial<Record<AutonomousContractCoverageKind, readonly string[]>>;
}

interface MatchableToken {
  value: string;
  ref: string;
}

export function createAutonomousContractCoverageTable(
  input: AutonomousContractCoverageInput,
): AutonomousContractCoverageTable {
  const runSteps = input.steps.filter((step) => step.runId === input.run.id);
  const acceptedEvidence = filterAcceptedEvidence(input.run.id, input.evidence, input.acceptedEvidenceIds);
  const stepHandles = createHandleMap(runSteps, 'step');
  const evidenceHandles = createHandleMap(acceptedEvidence, 'evidence');
  const proofTokens = collectProofTokens(runSteps, stepHandles);
  const evidenceTokens = collectEvidenceTokens(acceptedEvidence, evidenceHandles);
  const allTokens = [...proofTokens, ...evidenceTokens];
  const notTestable = input.notTestable ?? {};
  const rows: AutonomousContractCoverageRow[] = [
    ...createRequirementRows('done_criterion', input.run.proofContract.doneCriteria, proofTokens, notTestable.done_criterion),
    ...createRequirementRows('required_evidence', input.run.proofContract.requiredEvidence, evidenceTokens, notTestable.required_evidence),
    ...createAntiProofRows(input.run.proofContract, allTokens, notTestable.anti_proof),
  ];

  const coveredCount = rows.filter((row) => row.status === 'covered').length;
  const gapCount = rows.filter((row) => row.status === 'gap').length;
  const conflictCount = rows.filter((row) => row.status === 'conflict').length;
  const notTestableCount = rows.filter((row) => row.status === 'not_testable').length;
  return {
    rows,
    coveredCount,
    gapCount,
    conflictCount,
    notTestableCount,
    complete: gapCount === 0 && conflictCount === 0,
  };
}

function createRequirementRows(
  kind: 'done_criterion' | 'required_evidence',
  requirements: readonly string[],
  tokens: readonly MatchableToken[],
  notTestable: readonly string[] | undefined,
): AutonomousContractCoverageRow[] {
  const notTestableSet = new Set(normalizeList(notTestable ?? []));
  return uniqueRequirements(requirements).map((requirement) => {
    const normalized = normalizeComparable(requirement);
    const matchedBy = normalized.length > 0
      ? tokens.filter((token) => normalizeComparable(token.value).includes(normalized)).map((token) => token.ref)
      : [];
    const status: AutonomousContractCoverageStatus = notTestableSet.has(normalized)
      ? 'not_testable'
      : matchedBy.length > 0
        ? 'covered'
        : 'gap';
    return {
      kind,
      requirement: sanitizeCoverageText(requirement),
      status,
      matchedBy,
    };
  });
}

function createAntiProofRows(
  proofContract: AutonomousRunProofContract,
  tokens: readonly MatchableToken[],
  notTestable: readonly string[] | undefined,
): AutonomousContractCoverageRow[] {
  const notTestableSet = new Set(normalizeList(notTestable ?? []));
  return uniqueRequirements(proofContract.antiProof).map((requirement) => {
    const normalized = normalizeComparable(requirement);
    const matchedBy = normalized.length > 0
      ? tokens.filter((token) => normalizeComparable(token.value).includes(normalized)).map((token) => token.ref)
      : [];
    const status: AutonomousContractCoverageStatus = matchedBy.length > 0
      ? 'conflict'
      : notTestableSet.has(normalized)
        ? 'not_testable'
        : 'covered';
    return {
      kind: 'anti_proof',
      requirement: sanitizeCoverageText(requirement),
      status,
      matchedBy,
    };
  });
}

function filterAcceptedEvidence(
  runId: string,
  evidence: readonly AutonomousEvidenceRecord[],
  acceptedEvidenceIds: readonly string[] | null | undefined,
): AutonomousEvidenceRecord[] {
  const runEvidence = evidence.filter((record) => record.runId === runId);
  const accepted = new Set(acceptedEvidenceIds ?? []);
  return runEvidence.filter((record) => accepted.has(record.id));
}

function collectProofTokens(
  steps: readonly AutonomousRunStep[],
  stepHandles: ReadonlyMap<string, string>,
): MatchableToken[] {
  return steps
    .filter((step) => step.status === 'succeeded')
    .flatMap((step) => step.proofDelta.map((value) => ({ value, ref: stepHandles.get(step.id) ?? 'step-unknown' })));
}

function collectEvidenceTokens(
  evidence: readonly AutonomousEvidenceRecord[],
  evidenceHandles: ReadonlyMap<string, string>,
): MatchableToken[] {
  return evidence.flatMap((record) => [
    { value: record.kind, ref: `${evidenceHandles.get(record.id) ?? 'evidence-unknown'}:kind` },
    { value: record.summary, ref: `${evidenceHandles.get(record.id) ?? 'evidence-unknown'}:summary` },
    ...record.refs.map((ref) => ({ value: ref, ref: `${evidenceHandles.get(record.id) ?? 'evidence-unknown'}:ref` })),
  ]);
}

function createHandleMap<T extends { id: string }>(
  values: readonly T[],
  prefix: 'step' | 'evidence',
): Map<string, string> {
  const handles = new Map<string, string>();
  for (const value of values) {
    if (!handles.has(value.id)) {
      handles.set(value.id, `${prefix}-${handles.size + 1}`);
    }
  }
  return handles;
}

function uniqueRequirements(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalizeComparable(trimmed);
    if (!trimmed || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(trimmed);
  }
  return out;
}

function normalizeList(values: readonly string[]): string[] {
  return values.map(normalizeComparable).filter(Boolean);
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sanitizeCoverageText(value: string): string {
  return value
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[^\s]+/gi, '[REDACTED_INLINE_MEDIA]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(Authorization|Cookie|Set-Cookie)\s*[:=]\s*[^\n]+/gi, '$1: [REDACTED]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, 'sk-[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}/g, 'gh[REDACTED]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza[REDACTED]')
    .replace(/([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|AWSAccessKeyId|Signature|access_token|refresh_token|token|secret)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b((?:api[_-]?key|apiKey|token|secret|signed[_-]?path|signedPath)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]');
}
