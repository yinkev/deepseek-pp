import { createAutonomousSafetyRedactionSummary } from './policy';

export interface AutonomousWorkerPromptInput {
  stepNumber: number;
  title: string;
  objective: string;
  worktree: string;
  branch?: string | null;
  scope?: readonly string[];
  likelyFiles?: readonly string[];
  forbiddenFiles?: readonly string[];
  verificationCommands?: readonly string[];
  reviewerGate?: string | null;
  stopCondition?: string | null;
  extraInstructions?: readonly string[];
}

export interface AutonomousWorkerPromptContractReview {
  ok: boolean;
  missingMarkers: string[];
}

const DEFAULT_FORBIDDEN_FILES = ['entrypoints/background.ts'];
const DEFAULT_VERIFICATION_COMMANDS = [
  'npm run compile',
  'git diff --check',
];

export const AUTONOMOUS_WORKER_QUALITY_GATE_XML = `<quality_gate>
  <item>Evaluate, Review, Grade, Iterate after implementation before committing.</item>
  <item>Contract coverage gate: before committing, build a contract coverage table where each required behavior maps to at least one test assertion or is explicitly marked not testable in this slice.</item>
  <item>Run one adversarial probe for false-positive success: prove the result object and durable stored state agree.</item>
  <item>Self-review after verification and assign grade A-F.</item>
  <item>If grade is below A, iterate once before committing.</item>
  <item>After commit, expect an independent adversarial review; do not start the next slice if a P1/P2 is found.</item>
</quality_gate>`;

export const AUTONOMOUS_WORKER_PROMPT_REQUIRED_MARKERS = [
  'Evaluate, Review, Grade, Iterate',
  '<quality_gate>',
  'Contract coverage gate',
  'contract coverage table',
  'false-positive success',
  'durable stored state',
  'grade A-F',
  'commit after implementation',
  'P1/P2',
  'entrypoints/background.ts',
  '<safety_redaction>',
  '<step_report>',
] as const;

export function buildAutonomousWorkerPrompt(input: AutonomousWorkerPromptInput): string {
  const safetyRedaction = createAutonomousSafetyRedactionSummary({
    surface: 'worker_prompt',
    metadataOnly: true,
    redactionCandidates: [input],
  });
  const forbiddenFiles = uniqueNonEmpty([
    ...DEFAULT_FORBIDDEN_FILES,
    ...(input.forbiddenFiles ?? []),
  ]);
  const verificationCommands = uniqueNonEmpty(input.verificationCommands?.length
    ? input.verificationCommands
    : DEFAULT_VERIFICATION_COMMANDS);
  const scope = uniqueNonEmpty(input.scope ?? []);
  const likelyFiles = uniqueNonEmpty(input.likelyFiles ?? []);
  const extraInstructions = uniqueNonEmpty(input.extraInstructions ?? []);

  const lines = [
    `You are the autonomous DeepSeek++ worker for step ${formatNumber(input.stepNumber)}.`,
    '',
    '<slice>',
    `  <title>${sanitizePromptText(input.title)}</title>`,
    `  <objective>${sanitizePromptText(input.objective)}</objective>`,
    `  <worktree>${sanitizePromptText(input.worktree)}</worktree>`,
    `  <branch>${sanitizePromptText(input.branch ?? 'current')}</branch>`,
    '</slice>',
    '',
    '<safety_redaction>',
    `  <status>${safetyRedaction.status}</status>`,
    `  <surface>${safetyRedaction.surface}</surface>`,
    `  <metadata_only>${formatBoolean(safetyRedaction.metadataOnly)}</metadata_only>`,
    `  <redacted>${formatBoolean(safetyRedaction.redacted)}</redacted>`,
    `  <issue_count>${formatNumber(safetyRedaction.issueCount)}</issue_count>`,
    '  <issue_codes>',
    ...listSafetyValues(safetyRedaction.issueCodes, 'code'),
    '  </issue_codes>',
    '  <issue_categories>',
    ...listSafetyValues(safetyRedaction.issueCategories, 'category'),
    '  </issue_categories>',
    `  <policy_gate>${safetyRedaction.policyGate}</policy_gate>`,
    '</safety_redaction>',
    '',
    '<operating_contract>',
    '  <item>Evaluate, Review, Grade, Iterate after implementation.</item>',
    '  <item>Implement the smallest coherent slice that satisfies this prompt.</item>',
    '  <item>commit after implementation once verification and self-review pass.</item>',
    '  <item>Do not touch Chrome/runtime work unless explicitly resumed.</item>',
    ...forbiddenFiles.map((file) => `  <item>Do not touch ${sanitizePromptText(file)}.</item>`),
    '  <item>You are not alone in the codebase; do not revert unrelated changes.</item>',
    '</operating_contract>',
    '',
    AUTONOMOUS_WORKER_QUALITY_GATE_XML,
    '',
    '<scope>',
    ...listOrNone(scope, 'item'),
    '</scope>',
    '',
    '<likely_files>',
    ...listOrNone(likelyFiles, 'file'),
    '</likely_files>',
    '',
    '<verification_commands>',
    ...verificationCommands.map((command) => `  <command>${sanitizePromptText(command)}</command>`),
    '</verification_commands>',
    '',
    '<reviewer_gate>',
    `  <item>${sanitizePromptText(input.reviewerGate ?? 'Independent adversarial review must find no P1/P2 before the next slice starts.')}</item>`,
    '</reviewer_gate>',
    '',
    '<stop_condition>',
    `  <item>${sanitizePromptText(input.stopCondition ?? 'Stop after commit and report XML; do not start the next slice until Codex reviews.')}</item>`,
    '</stop_condition>',
    '',
    '<extra_instructions>',
    ...listOrNone(extraInstructions, 'item'),
    '</extra_instructions>',
    '',
    '<report_contract>',
    '  <item>Return exactly one XML report in a step_report root.</item>',
    '  <item>Include status, changed_files, contract_coverage_table, adversarial_probe, verification, self_review, grade, commit, blockers, and next_step_recommendation.</item>',
    '  <item>If a required behavior is not testable in this slice, mark it explicitly in contract_coverage_table.</item>',
    '</report_contract>',
    '',
    '<step_report>',
    '  <status>completed|blocked</status>',
    '  <changed_files></changed_files>',
    '  <contract_coverage_table></contract_coverage_table>',
    '  <adversarial_probe></adversarial_probe>',
    '  <verification></verification>',
    '  <self_review></self_review>',
    '  <grade>A|B|C|D|F</grade>',
    '  <commit></commit>',
    '  <blockers></blockers>',
    '  <next_step_recommendation></next_step_recommendation>',
    '</step_report>',
  ];

  return lines.join('\n');
}

export function reviewAutonomousWorkerPromptContract(prompt: string): AutonomousWorkerPromptContractReview {
  const missingMarkers = AUTONOMOUS_WORKER_PROMPT_REQUIRED_MARKERS
    .filter((marker) => !prompt.includes(marker));
  return {
    ok: missingMarkers.length === 0,
    missingMarkers,
  };
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const sanitized = sanitizePromptText(value);
    if (!sanitized || seen.has(sanitized)) continue;
    seen.add(sanitized);
    out.push(sanitized);
  }
  return out;
}

function listOrNone(values: readonly string[], tag: 'item' | 'file'): string[] {
  if (values.length === 0) {
    return [`  <${tag}>none</${tag}>`];
  }
  return values.map((value) => `  <${tag}>${value}</${tag}>`);
}

function listSafetyValues(values: readonly string[], tag: 'code' | 'category'): string[] {
  return values.map((value) => `    <${tag}>${value}</${tag}>`);
}

function formatBoolean(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false';
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(Math.max(0, Math.floor(value))) : '0';
}

function sanitizePromptText(value: string): string {
  return value
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[^\s<]+/gi, '[REDACTED_INLINE_MEDIA]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(Authorization|Cookie|Set-Cookie)\s*[:=]\s*[^\n<]+/gi, '$1: [REDACTED]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, 'sk-[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza[REDACTED]')
    .replace(/([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|AWSAccessKeyId|Signature|access_token|refresh_token|token|secret)=)[^&\s<]+/gi, '$1[REDACTED]')
    .replace(/\b((?:api[_-]?key|apiKey|token|secret|signed[_-]?path|signedPath)=)[^&\s<]+/gi, '$1[REDACTED]')
    .replace(/[<>&]/g, (ch) => {
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      return '&amp;';
    })
    .trim();
}
