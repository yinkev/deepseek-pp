export type AutonomousDocResumptionGateStatus = 'passed' | 'blocked';

export type AutonomousDocResumptionGateReason =
  | 'passed'
  | 'no_documents'
  | 'missing_required_markers';

export type AutonomousDocResumptionMarkerCode =
  | 'runtime_authorization_required'
  | 'background_file_frozen'
  | 'step_10_blocked'
  | 'contract_coverage_required'
  | 'false_positive_probe_required'
  | 'self_review_grade_required'
  | 'independent_p1p2_review_required'
  | 'verification_ladder_required';

export interface AutonomousDocResumptionDocument {
  text?: unknown;
}

export interface AutonomousDocResumptionGateInput {
  documents?: AutonomousDocResumptionDocument[] | null;
}

export interface AutonomousDocResumptionGateDecision {
  status: AutonomousDocResumptionGateStatus;
  canResumeFromDocs: boolean;
  reason: AutonomousDocResumptionGateReason;
  documentCount: number;
  checkedMarkerCodes: AutonomousDocResumptionMarkerCode[];
  presentMarkerCodes: AutonomousDocResumptionMarkerCode[];
  missingMarkerCodes: AutonomousDocResumptionMarkerCode[];
}

const REQUIRED_MARKERS: AutonomousDocResumptionMarkerCode[] = [
  'runtime_authorization_required',
  'background_file_frozen',
  'step_10_blocked',
  'contract_coverage_required',
  'false_positive_probe_required',
  'self_review_grade_required',
  'independent_p1p2_review_required',
  'verification_ladder_required',
];

const CURRENT_CONTRACT_PATTERN = /^\s*contract_status:\s*current\s*$/im;
const STALE_CONTRACT_PATTERN = /^\s*contract_status:\s*(stale|superseded|obsolete)\s*$/im;

export function evaluateAutonomousDocResumptionGate(
  input: AutonomousDocResumptionGateInput = {},
): AutonomousDocResumptionGateDecision {
  const documents = normalizeDocuments(input.documents);
  const text = documents.join('\n\n');
  const contractCurrent = CURRENT_CONTRACT_PATTERN.test(text) && !STALE_CONTRACT_PATTERN.test(text);
  const presentMarkerCodes = contractCurrent
    ? REQUIRED_MARKERS.filter((code) => hasStructuredMarker(text, code))
    : [];
  const missingMarkerCodes = REQUIRED_MARKERS.filter((code) => !presentMarkerCodes.includes(code));

  const reason = documents.length === 0
    ? 'no_documents'
    : missingMarkerCodes.length > 0
      ? 'missing_required_markers'
      : 'passed';
  const canResumeFromDocs = reason === 'passed';

  return {
    status: canResumeFromDocs ? 'passed' : 'blocked',
    canResumeFromDocs,
    reason,
    documentCount: documents.length,
    checkedMarkerCodes: REQUIRED_MARKERS,
    presentMarkerCodes,
    missingMarkerCodes,
  };
}

function hasStructuredMarker(text: string, code: AutonomousDocResumptionMarkerCode): boolean {
  return new RegExp(`^\\s*${code}:\\s*true\\s*$`, 'im').test(text);
}

function normalizeDocuments(
  documents: AutonomousDocResumptionDocument[] | null | undefined,
): string[] {
  if (!Array.isArray(documents)) return [];
  return documents
    .map((document) => typeof document?.text === 'string' ? document.text : '')
    .filter((text) => text.trim().length > 0);
}
