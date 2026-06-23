import { BROWSER_CONTROL_TOOL_SET, type BrowserControlToolName } from '../browser-control/types';
import { SHELL_TOOL_NAMES } from '../shell/contracts';
import { MEMORY_TOOL_NAMES } from '../tool/memory';
import { redactDurableToolString } from '../tool/redaction';
import type { ToolDescriptor } from '../tool/types';
import type {
  AutonomousRun,
  AutonomousRunError,
  AutonomousRunStep,
} from './types';
import { isTerminalRunStatus } from './kernel';

export type AutonomousRunGateDecision = 'allow' | 'manual_review' | 'deny';
export type AutonomousSafetyRedactionSurface =
  | 'action_policy'
  | 'telemetry'
  | 'review_lane'
  | 'pet_handoff'
  | 'worker_prompt'
  | 'unknown';
export type AutonomousSafetyRedactionStatus = 'safe' | 'redacted' | 'blocked';
export type AutonomousSafetyRedactionIssueCode =
  | 'unsafe_export_surface'
  | 'raw_content_present'
  | 'redaction_applied'
  | 'policy_denied'
  | 'manual_review_required';
export type AutonomousSafetyRedactionIssueCategory = 'privacy' | 'policy' | 'metadata';

export interface AutonomousSafetyRedactionSummaryInput {
  surface?: AutonomousSafetyRedactionSurface | null;
  metadataOnly?: boolean | null;
  policyDecision?: AutonomousRunGateDecision | 'not_applicable' | null;
  redactionCandidates?: readonly unknown[] | null;
  rawContentPresent?: boolean | null;
  issueCodes?: readonly unknown[] | null;
}

export interface AutonomousSafetyRedactionSummary {
  status: AutonomousSafetyRedactionStatus;
  surface: AutonomousSafetyRedactionSurface;
  metadataOnly: boolean;
  redacted: boolean;
  issueCount: number;
  issueCodes: AutonomousSafetyRedactionIssueCode[];
  issueCategories: AutonomousSafetyRedactionIssueCategory[];
  policyGate: AutonomousRunGateDecision | 'not_applicable';
}

export interface AutonomousRunActionReviewInput {
  kind: 'model_turn' | 'tool_call' | 'finish';
  toolName?: string;
  descriptor?: Pick<ToolDescriptor, 'name' | 'execution'> | null;
  promptBytes?: number;
  observationBytes?: number;
  targetLeaseOk?: boolean;
  memoryPinned?: boolean;
}

export interface AutonomousRunActionReview {
  decision: AutonomousRunGateDecision;
  reason:
    | 'allowed'
    | 'manual_all'
    | 'descriptor_requires_manual'
    | 'risk_requires_review'
    | 'memory_requires_review'
    | 'shell_requires_review'
    | 'run_not_running'
    | 'run_terminal'
    | 'wall_budget_exhausted'
    | 'model_turn_budget_exhausted'
    | 'tool_call_budget_exhausted'
    | 'prompt_budget_exhausted'
    | 'observation_budget_exhausted'
    | 'tool_disabled'
    | 'tool_denied'
    | 'tool_not_allowlisted'
    | 'browser_target_lease_required'
    | 'shell_disabled'
    | 'shell_not_allowlisted'
    | 'memory_disabled';
  error: AutonomousRunError | null;
}

export function createAutonomousActionPolicySafetyRedactionSummary(
  review: Pick<AutonomousRunActionReview, 'decision' | 'error'>,
): AutonomousSafetyRedactionSummary {
  return createAutonomousSafetyRedactionSummary({
    surface: 'action_policy',
    metadataOnly: true,
    policyDecision: review.decision,
    redactionCandidates: [
      review.error?.code,
      review.error?.phase,
    ],
  });
}

const BROWSER_MUTATION_TOOLS = new Set<string>([
  'browser_navigate',
  'browser_go_back',
  'browser_go_forward',
  'browser_refresh',
  'browser_select_tab',
  'browser_close_tab',
  'browser_click',
  'browser_hover',
  'browser_fill',
  'browser_fill_form',
  'browser_key',
  'browser_type',
  'browser_attach_file',
  'browser_wait_for',
  'browser_handle_dialog',
  'browser_evaluate_script',
]);
const SAFETY_REDACTION_ISSUE_LIMIT = 8;
const GENERIC_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>)}\]]+/i;
const SECRET_ASSIGNMENT_PATTERN = /\b(?:authorization|cookie|set-cookie|api[_-]?key|apiKey|access[_-]?token|accessToken|refresh[_-]?token|refreshToken|token|secret|signed[_-]?path|signedPath)\s*["']?\s*[:=]\s*["']?[^\s"' ,;}]+/i;
const REDACTION_MARKER_PATTERN = /\[(?:REDACTED|redacted)[^\]]*\]|_redacted(?::|_)/i;

export function createAutonomousSafetyRedactionSummary(
  input: AutonomousSafetyRedactionSummaryInput = {},
): AutonomousSafetyRedactionSummary {
  const surface = normalizeSafetySurface(input.surface);
  const metadataOnly = input.metadataOnly === true;
  const policyGate = normalizePolicyGate(input.policyDecision);
  const issues: AutonomousSafetyRedactionIssueCode[] = [];
  if (!metadataOnly) {
    issues.push('unsafe_export_surface');
  }
  if (input.rawContentPresent === true) {
    issues.push('raw_content_present');
  }
  if (redactionRequired(input.redactionCandidates)) {
    issues.push('redaction_applied');
  }
  if (policyGate === 'deny') {
    issues.push('policy_denied');
  } else if (policyGate === 'manual_review') {
    issues.push('manual_review_required');
  }
  for (const code of input.issueCodes ?? []) {
    const normalized = normalizeSafetyIssueCode(code);
    if (normalized) issues.push(normalized);
  }
  const issueCodes = uniqueIssueCodes(issues);
  const redacted = issueCodes.includes('redaction_applied') || issueCodes.includes('raw_content_present');
  const blocked = !metadataOnly ||
    issueCodes.includes('policy_denied') ||
    issueCodes.includes('manual_review_required') ||
    issueCodes.includes('unsafe_export_surface') ||
    issueCodes.includes('raw_content_present');
  return {
    status: blocked ? 'blocked' : redacted ? 'redacted' : 'safe',
    surface,
    metadataOnly,
    redacted,
    issueCount: issueCodes.length,
    issueCodes,
    issueCategories: categoriesForIssueCodes(issueCodes),
    policyGate,
  };
}

export function reviewAutonomousRunAction(
  run: AutonomousRun,
  steps: readonly AutonomousRunStep[],
  action: AutonomousRunActionReviewInput,
  now = Date.now(),
): AutonomousRunActionReview {
  if (isTerminalRunStatus(run.status)) {
    return deny('run_terminal', 'Terminal autonomous runs cannot accept more actions.', 'policy', now, false);
  }
  if (action.kind !== 'finish' && run.status !== 'running') {
    return deny('run_not_running', 'Autonomous run must be running before executing the next action.', 'policy', now, true);
  }
  if (run.startedAt !== null && now - run.startedAt > run.budgets.maxWallMs) {
    return deny('wall_budget_exhausted', 'Autonomous run wall-clock budget is exhausted.', 'policy', now, false);
  }
  if (action.kind === 'model_turn' && countModelTurns(run, steps) >= run.budgets.maxModelTurns) {
    return deny('model_turn_budget_exhausted', 'Autonomous run model-turn budget is exhausted.', 'model_turn', now, false);
  }
  if (action.kind === 'tool_call' && countToolCalls(run, steps) >= run.budgets.maxToolCalls) {
    return deny('tool_call_budget_exhausted', 'Autonomous run tool-call budget is exhausted.', 'tool_execution', now, false);
  }
  if ((action.promptBytes ?? 0) > run.budgets.maxPromptBytesPerTurn) {
    return deny('prompt_budget_exhausted', 'Prompt byte budget for this turn is exhausted.', 'model_turn', now, false);
  }
  if ((action.observationBytes ?? 0) > run.budgets.maxObservationBytesPerTurn) {
    return deny('observation_budget_exhausted', 'Observation byte budget for this turn is exhausted.', 'observation', now, false);
  }
  if (action.kind !== 'tool_call') return allow();

  const toolName = action.toolName ?? action.descriptor?.name ?? '';
  const descriptor = action.descriptor ?? null;
  if (descriptor?.execution.enabled === false || descriptor?.execution.mode === 'disabled') {
    return deny('tool_disabled', `Tool ${toolName || '(unknown)'} is disabled.`, 'tool_selection', now, false);
  }
  if (run.policy.deniedTools.includes(toolName)) {
    return deny('tool_denied', `Tool ${toolName} is denied by autonomous run policy.`, 'tool_selection', now, false);
  }
  if (run.policy.allowedTools.length > 0 && !run.policy.allowedTools.includes(toolName)) {
    return deny('tool_not_allowlisted', `Tool ${toolName} is not allowlisted for this autonomous run.`, 'tool_selection', now, false);
  }
  if (
    isBrowserMutationTool(toolName) &&
    run.policy.browserMutationRequiresTargetLock &&
    (!run.targetLeaseId || action.targetLeaseOk !== true)
  ) {
    return deny('browser_target_lease_required', `Browser mutation tool ${toolName} requires a verified target lease.`, 'policy', now, true);
  }
  if (isShellTool(toolName, descriptor)) {
    const shellDecision = reviewShellPolicy(run, toolName, now);
    if (shellDecision) return shellDecision;
  }
  if (isMemoryMutationTool(toolName)) {
    const memoryDecision = reviewMemoryPolicy(run, action.memoryPinned === true, now);
    if (memoryDecision) return memoryDecision;
  }
  if (descriptor?.execution.mode === 'manual') {
    return manual('descriptor_requires_manual', `Tool ${toolName || '(unknown)'} is configured for manual execution.`, 'tool_selection', now);
  }
  if (run.policy.approvalMode === 'manual_all') {
    return manual('manual_all', 'Autonomous run policy requires manual review for every tool call.', 'tool_selection', now);
  }
  const risk = descriptor?.execution.risk ?? 'medium';
  if (run.policy.approvalMode === 'confirm_high_risk' && risk === 'high') {
    return manual('risk_requires_review', `High-risk tool ${toolName} requires manual review.`, 'tool_selection', now);
  }
  if (run.policy.approvalMode === 'auto_low_risk' && risk !== 'low') {
    return manual('risk_requires_review', `Non-low-risk tool ${toolName} requires manual review.`, 'tool_selection', now);
  }
  return allow();
}

function redactionRequired(candidates: readonly unknown[] | null | undefined): boolean {
  if (!Array.isArray(candidates) || candidates.length === 0) return false;
  for (const candidate of candidates) {
    const text = stringifySafetyCandidate(candidate);
    if (!text) continue;
    const redacted = redactDurableToolString(text) ?? text;
    if (
      redacted !== text ||
      REDACTION_MARKER_PATTERN.test(text) ||
      GENERIC_URL_PATTERN.test(text) ||
      SECRET_ASSIGNMENT_PATTERN.test(text)
    ) {
      return true;
    }
  }
  return false;
}

function stringifySafetyCandidate(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function normalizeSafetySurface(surface: unknown): AutonomousSafetyRedactionSurface {
  if (
    surface === 'action_policy' ||
    surface === 'telemetry' ||
    surface === 'review_lane' ||
    surface === 'pet_handoff' ||
    surface === 'worker_prompt'
  ) {
    return surface;
  }
  return 'unknown';
}

function normalizePolicyGate(
  decision: AutonomousSafetyRedactionSummaryInput['policyDecision'],
): AutonomousSafetyRedactionSummary['policyGate'] {
  if (decision === 'allow' || decision === 'manual_review' || decision === 'deny') {
    return decision;
  }
  return 'not_applicable';
}

function normalizeSafetyIssueCode(code: unknown): AutonomousSafetyRedactionIssueCode | null {
  if (
    code === 'unsafe_export_surface' ||
    code === 'raw_content_present' ||
    code === 'redaction_applied' ||
    code === 'policy_denied' ||
    code === 'manual_review_required'
  ) {
    return code;
  }
  return null;
}

function uniqueIssueCodes(
  codes: readonly AutonomousSafetyRedactionIssueCode[],
): AutonomousSafetyRedactionIssueCode[] {
  const out: AutonomousSafetyRedactionIssueCode[] = [];
  for (const code of codes) {
    if (!out.includes(code)) out.push(code);
    if (out.length >= SAFETY_REDACTION_ISSUE_LIMIT) break;
  }
  return out;
}

function categoriesForIssueCodes(
  codes: readonly AutonomousSafetyRedactionIssueCode[],
): AutonomousSafetyRedactionIssueCategory[] {
  const categories: AutonomousSafetyRedactionIssueCategory[] = [];
  for (const code of codes) {
    const category = categoryForIssueCode(code);
    if (!categories.includes(category)) categories.push(category);
  }
  return categories;
}

function categoryForIssueCode(
  code: AutonomousSafetyRedactionIssueCode,
): AutonomousSafetyRedactionIssueCategory {
  if (code === 'policy_denied' || code === 'manual_review_required') return 'policy';
  if (code === 'unsafe_export_surface') return 'metadata';
  return 'privacy';
}

function reviewShellPolicy(
  run: AutonomousRun,
  toolName: string,
  now: number,
): AutonomousRunActionReview | null {
  if (run.policy.shellMode === 'disabled') {
    return deny('shell_disabled', `Shell tool ${toolName} is disabled for this autonomous run.`, 'policy', now, false);
  }
  if (run.policy.shellMode === 'manual') {
    return manual('shell_requires_review', `Shell tool ${toolName} requires manual review.`, 'tool_selection', now);
  }
  if (run.policy.shellMode === 'allowlisted' && !run.policy.allowedTools.includes(toolName)) {
    return deny('shell_not_allowlisted', `Shell tool ${toolName} is not allowlisted for this autonomous run.`, 'tool_selection', now, false);
  }
  return null;
}

function reviewMemoryPolicy(
  run: AutonomousRun,
  memoryPinned: boolean,
  now: number,
): AutonomousRunActionReview | null {
  if (run.policy.persistMemory === 'off') {
    return deny('memory_disabled', 'Memory persistence is disabled for this autonomous run.', 'policy', now, false);
  }
  if (run.policy.persistMemory === 'propose') {
    return manual('memory_requires_review', 'Memory writes must be proposed for review.', 'tool_selection', now);
  }
  if (run.policy.persistMemory === 'auto_pinned_only' && !memoryPinned) {
    return manual('memory_requires_review', 'Only pinned memory writes may proceed automatically.', 'tool_selection', now);
  }
  return null;
}

function countModelTurns(run: AutonomousRun, steps: readonly AutonomousRunStep[]): number {
  return steps.filter((step) => step.runId === run.id && step.phase === 'model_turn' && step.status !== 'skipped').length;
}

function countToolCalls(run: AutonomousRun, steps: readonly AutonomousRunStep[]): number {
  return steps
    .filter((step) => step.runId === run.id && step.status !== 'skipped')
    .reduce((count, step) => count + step.toolCallIds.length, 0);
}

function isBrowserMutationTool(toolName: string): toolName is BrowserControlToolName {
  return BROWSER_CONTROL_TOOL_SET.has(toolName) && BROWSER_MUTATION_TOOLS.has(toolName);
}

function isShellTool(
  toolName: string,
  descriptor: Pick<ToolDescriptor, 'name' | 'execution'> | null,
): boolean {
  return (SHELL_TOOL_NAMES as readonly string[]).includes(toolName) ||
    toolName.startsWith('shell_') ||
    toolName.startsWith('python_') ||
    (descriptor?.name ? (SHELL_TOOL_NAMES as readonly string[]).includes(descriptor.name) : false) ||
    descriptor?.name.startsWith('shell_') === true ||
    descriptor?.name.startsWith('python_') === true;
}

function isMemoryMutationTool(toolName: string): boolean {
  return (MEMORY_TOOL_NAMES as readonly string[]).includes(toolName);
}

function allow(): AutonomousRunActionReview {
  return { decision: 'allow', reason: 'allowed', error: null };
}

function manual(
  reason: Extract<AutonomousRunActionReview['reason'], 'manual_all' | 'descriptor_requires_manual' | 'risk_requires_review' | 'memory_requires_review' | 'shell_requires_review'>,
  message: string,
  phase: AutonomousRunError['phase'],
  now: number,
): AutonomousRunActionReview {
  return {
    decision: 'manual_review',
    reason,
    error: createGateError(`autonomous_gate_${reason}`, message, phase, true, now),
  };
}

function deny(
  reason: Exclude<AutonomousRunActionReview['reason'], 'allowed' | 'manual_all' | 'risk_requires_review' | 'memory_requires_review' | 'shell_requires_review'>,
  message: string,
  phase: AutonomousRunError['phase'],
  now: number,
  retryable: boolean,
): AutonomousRunActionReview {
  return {
    decision: 'deny',
    reason,
    error: createGateError(`autonomous_gate_${reason}`, message, phase, retryable, now),
  };
}

function createGateError(
  code: string,
  message: string,
  phase: AutonomousRunError['phase'],
  retryable: boolean,
  now: number,
): AutonomousRunError {
  return {
    code,
    message,
    phase,
    retryable,
    at: now,
  };
}
