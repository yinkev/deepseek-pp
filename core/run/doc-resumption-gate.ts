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

interface MarkerSpec {
  code: AutonomousDocResumptionMarkerCode;
  patterns: RegExp[];
  rejectPatterns?: RegExp[];
}

const REQUIRED_MARKERS: MarkerSpec[] = [
  {
    code: 'runtime_authorization_required',
    patterns: [
      /explicit durable [`']?chrome_runtime[`']? authorization|durable, explicit user authorization exists for [`']?chrome_runtime[`']?/i,
    ],
    rejectPatterns: [
      /does not require[^.]{0,120}chrome_runtime[^.]{0,80}authorization/i,
      /chrome_runtime[^.]{0,80}authorization[^.]{0,80}(not required|not needed|optional)/i,
    ],
  },
  {
    code: 'background_file_frozen',
    patterns: [
      /entrypoints\/background\.ts[^.]{0,120}(frozen|freeze|forbidden|do not touch)|frozen[^.]{0,120}entrypoints\/background\.ts/i,
    ],
    rejectPatterns: [
      /entrypoints\/background\.ts[^.]{0,120}(not frozen|unfrozen|eligible now)/i,
    ],
  },
  {
    code: 'step_10_blocked',
    patterns: [
      /step 10[^.]{0,120}blocked|runtime wiring remains blocked|blocked[^.]{0,120}step 10/i,
    ],
    rejectPatterns: [
      /step 10[^.]{0,120}(not blocked|unblocked|can proceed)/i,
      /runtime wiring[^.]{0,120}(not blocked|unblocked|can proceed)/i,
    ],
  },
  {
    code: 'contract_coverage_required',
    patterns: [/contract coverage/i, /test assertion|not testable/i],
  },
  {
    code: 'false_positive_probe_required',
    patterns: [/false-positive|false positive/i, /durable stored state|result\/durable|result object/i],
  },
  {
    code: 'self_review_grade_required',
    patterns: [/self-review|self review/i, /grade/i],
  },
  {
    code: 'independent_p1p2_review_required',
    patterns: [/independent/i, /P1\/P2|P1|P2/i],
  },
  {
    code: 'verification_ladder_required',
    patterns: [/npm test/i, /npm run compile/i, /git diff --check/i, /git diff --name-only HEAD -- entrypoints\/background\.ts/i],
  },
];

export function evaluateAutonomousDocResumptionGate(
  input: AutonomousDocResumptionGateInput = {},
): AutonomousDocResumptionGateDecision {
  const documents = normalizeDocuments(input.documents);
  const text = documents.join('\n\n');
  const presentMarkerCodes = REQUIRED_MARKERS
    .filter((marker) => marker.patterns.every((pattern) => pattern.test(text)))
    .filter((marker) => !(marker.rejectPatterns ?? []).some((pattern) => pattern.test(text)))
    .map((marker) => marker.code);
  const missingMarkerCodes = REQUIRED_MARKERS
    .map((marker) => marker.code)
    .filter((code) => !presentMarkerCodes.includes(code));

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
    checkedMarkerCodes: REQUIRED_MARKERS.map((marker) => marker.code),
    presentMarkerCodes,
    missingMarkerCodes,
  };
}

function normalizeDocuments(
  documents: AutonomousDocResumptionDocument[] | null | undefined,
): string[] {
  if (!Array.isArray(documents)) return [];
  return documents
    .map((document) => typeof document?.text === 'string' ? document.text : '')
    .filter((text) => text.trim().length > 0);
}
