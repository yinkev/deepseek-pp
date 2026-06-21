import { validateAutomationSchedule } from './schedule';
import { createDeepSeekWebVisionRoute } from '../deepseek/web-vision';
import type { AutomationCreateInput, AutomationPromptOptions } from './types';

export type AutomationReadinessGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type AutomationReadinessStatus = 'ready' | 'needs_attention' | 'blocked';
export type AutomationReadinessIssueSeverity = 'blocker' | 'warning' | 'info';

export type AutomationReadinessIssueCode =
  | 'name_missing'
  | 'prompt_missing'
  | 'schedule_invalid'
  | 'sensitive_prompt_content'
  | 'placeholder_unreplaced'
  | 'loop_contract_weak'
  | 'scheduled_without_stop_condition'
  | 'scheduled_memory_review'
  | 'research_without_search'
  | 'evaluation_without_thinking'
  | 'vision_without_visual_input'
  | 'vision_flags_inconsistent'
  | 'scheduled_visual_monitor';

export interface AutomationReadinessIssue {
  code: AutomationReadinessIssueCode;
  severity: AutomationReadinessIssueSeverity;
}

export interface AutomationReadinessReport {
  grade: AutomationReadinessGrade;
  score: number;
  status: AutomationReadinessStatus;
  issues: AutomationReadinessIssue[];
  strengths: string[];
}

export interface AutomationReadinessOptions {
  transientImageCount?: number;
}

const LOOP_TERMS = ['plan', 'evaluate', 'review', 'grade', 'iterate', 'stop'];
const LOOP_TERM_ALIASES: Record<string, readonly string[]> = {
  plan: ['plan', '\u89c4\u5212'],
  evaluate: ['evaluate', '\u8bc4\u4f30'],
  review: ['review', '\u590d\u67e5', '\u8bc4\u5ba1'],
  grade: ['grade', '\u8bc4\u5206', '\u8bc4\u7ea7', '\u8bc4 '],
  iterate: ['iterate', '\u8fed\u4ee3'],
  stop: ['stop', '\u505c\u6b62'],
};

const PLACEHOLDER_PATTERN = /\[(?:replace|\u66ff\u6362|insert|topic|artifact|context|source)[^\]]*\]|<[^>\n]*(?:replace|topic|artifact|context|source)[^>\n]*>/i;
const SENSITIVE_PROMPT_PATTERN =
  /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,|data:image|blob:|filesystem:|\bBearer\s+|\bAuthorization\s*[:=]|\bCookie\s*[:=]|\bSet-Cookie\s*[:=]|\b(?:api[_-]?key|apiKey|token|secret|signed[_-]?path|signedPath|x-ds-pow-response)\s*[:=]|(?:[?&]|\b)(?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|AWSAccessKeyId|Signature|access_token|refresh_token)=|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|\bAIza[0-9A-Za-z_-]{20,}/i;

export const SAFE_AUTOMATION_READINESS_FIXES = new Set<AutomationReadinessIssueCode>([
  'research_without_search',
  'evaluation_without_thinking',
  'vision_flags_inconsistent',
]);

export function evaluateAutomationReadiness(
  input: Pick<AutomationCreateInput, 'name' | 'prompt' | 'schedule' | 'promptOptions'>,
  options: AutomationReadinessOptions = {},
): AutomationReadinessReport {
  const issues: AutomationReadinessIssue[] = [];
  const strengths: string[] = [];
  const prompt = input.prompt.trim();
  const promptLower = prompt.toLowerCase();
  const scheduleValidation = validateAutomationSchedule(input.schedule);
  const scheduled = input.schedule.enabled && input.schedule.kind !== 'manual';
  const hasVisualMonitor = input.promptOptions.visualMonitor?.enabled === true;
  const refCount = input.promptOptions.refFileIds.length;
  const fileCount = (input.promptOptions.webVisionFiles?.length ?? 0) + Math.max(0, options.transientImageCount ?? 0);

  addIssueIf(!input.name.trim(), issues, 'name_missing', 'blocker');
  addIssueIf(!prompt, issues, 'prompt_missing', 'blocker');
  addIssueIf(!scheduleValidation.ok, issues, 'schedule_invalid', 'blocker');
  addIssueIf(SENSITIVE_PROMPT_PATTERN.test(prompt), issues, 'sensitive_prompt_content', 'blocker');
  addIssueIf(PLACEHOLDER_PATTERN.test(prompt), issues, 'placeholder_unreplaced', 'warning');

  const loopCoverage = countLoopCoverage(promptLower);
  addIssueIf(shouldCheckLoopContract(promptLower, loopCoverage) && loopCoverage < 4, issues, 'loop_contract_weak', 'warning');
  addIssueIf(scheduled && !mentionsAny(promptLower, ['stop', '\u505c\u6b62', 'explicit confirmation', '\u660e\u786e\u786e\u8ba4']), issues, 'scheduled_without_stop_condition', 'warning');
  addIssueIf(scheduled && mentionsAny(promptLower, ['memory', '\u8bb0\u5fc6']) && mentionsAny(promptLower, ['delete', '\u5220\u9664', 'hygiene', '\u536b\u751f']), issues, 'scheduled_memory_review', 'warning');
  addIssueIf(looksLikeResearch(promptLower) && !input.promptOptions.searchEnabled, issues, 'research_without_search', 'warning');
  addIssueIf(looksLikeEvaluationLoop(promptLower) && !input.promptOptions.thinkingEnabled, issues, 'evaluation_without_thinking', 'warning');
  addIssueIf(input.promptOptions.modelType === 'vision' && refCount === 0 && fileCount === 0 && !hasVisualMonitor, issues, 'vision_without_visual_input', 'blocker');
  addIssueIf(input.promptOptions.modelType === 'vision' && (input.promptOptions.searchEnabled || input.promptOptions.thinkingEnabled), issues, 'vision_flags_inconsistent', 'warning');
  addIssueIf(scheduled && hasVisualMonitor, issues, 'scheduled_visual_monitor', 'info');

  if (loopCoverage >= LOOP_TERMS.length) strengths.push('loop_contract');
  if (input.promptOptions.thinkingEnabled) strengths.push('deep_thinking');
  if (input.promptOptions.searchEnabled) strengths.push('web_search');
  if (hasVisualMonitor) strengths.push('visual_monitor');
  if (!scheduled) strengths.push('manual_control');
  if (!SENSITIVE_PROMPT_PATTERN.test(prompt)) strengths.push('no_inline_sensitive_content');

  const score = Math.max(0, 100 - issues.reduce((total, issue) => total + severityPenalty(issue.severity), 0));
  const status = issues.some((issue) => issue.severity === 'blocker')
    ? 'blocked'
    : issues.some((issue) => issue.severity === 'warning')
      ? 'needs_attention'
      : 'ready';

  return {
    grade: gradeScore(score),
    score,
    status,
    issues,
    strengths,
  };
}

export function getSafeAutomationReadinessFixes(report: AutomationReadinessReport): AutomationReadinessIssueCode[] {
  return report.issues
    .map((issue) => issue.code)
    .filter((code): code is AutomationReadinessIssueCode => SAFE_AUTOMATION_READINESS_FIXES.has(code));
}

export function applySafeAutomationReadinessFixes(
  promptOptions: AutomationPromptOptions,
  issueCodes: readonly AutomationReadinessIssueCode[],
): AutomationPromptOptions {
  let next: AutomationPromptOptions = {
    ...promptOptions,
    refFileIds: [...promptOptions.refFileIds],
    webVisionFiles: promptOptions.webVisionFiles ? [...promptOptions.webVisionFiles] : [],
    visualEvidencePacks: promptOptions.visualEvidencePacks ? [...promptOptions.visualEvidencePacks] : undefined,
  };

  if (issueCodes.includes('research_without_search')) {
    next = { ...next, searchEnabled: true };
  }
  if (issueCodes.includes('evaluation_without_thinking')) {
    next = { ...next, thinkingEnabled: true };
  }
  if (issueCodes.includes('vision_flags_inconsistent')) {
    const shouldDisableVisionFlags = next.modelType === 'vision' || next.refFileIds.length > 0;
    const route = createDeepSeekWebVisionRoute({
      modelType: next.modelType,
      refFileIds: next.refFileIds,
      thinkingEnabled: next.thinkingEnabled,
      searchEnabled: next.searchEnabled,
    });
    next = {
      ...next,
      ...route,
      searchEnabled: shouldDisableVisionFlags ? false : route.searchEnabled,
      thinkingEnabled: shouldDisableVisionFlags ? false : route.thinkingEnabled,
    };
  }

  return next;
}

function addIssueIf(
  condition: boolean,
  issues: AutomationReadinessIssue[],
  code: AutomationReadinessIssueCode,
  severity: AutomationReadinessIssueSeverity,
): void {
  if (condition && !issues.some((issue) => issue.code === code)) {
    issues.push({ code, severity });
  }
}

function countLoopCoverage(promptLower: string): number {
  return LOOP_TERMS.filter((term) => mentionsAny(promptLower, LOOP_TERM_ALIASES[term])).length;
}

function shouldCheckLoopContract(promptLower: string, loopCoverage: number): boolean {
  return loopCoverage >= 2 || mentionsAny(promptLower, [
    'workflow',
    'loop',
    'long horizon',
    'long-horizon',
    'orchestration',
    'council',
    '\u5de5\u4f5c\u6d41',
    '\u5faa\u73af',
    '\u957f\u7ebf',
    '\u7f16\u6392',
    '\u59d4\u5458\u4f1a',
  ]);
}

function mentionsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle.toLowerCase()));
}

function looksLikeResearch(promptLower: string): boolean {
  return mentionsAny(promptLower, [
    'research',
    'source',
    'citation',
    'changelog',
    'recent',
    '\u7814\u7a76',
    '\u6765\u6e90',
    '\u5f15\u7528',
    '\u66f4\u65b0\u65e5\u5fd7',
    '\u6700\u8fd1',
  ]);
}

function looksLikeEvaluationLoop(promptLower: string): boolean {
  return mentionsAny(promptLower, [
    'evaluate',
    'review',
    'grade',
    'iterate',
    'council',
    '\u8bc4\u4f30',
    '\u590d\u67e5',
    '\u8bc4\u5ba1',
    '\u8bc4\u5206',
    '\u8fed\u4ee3',
    '\u59d4\u5458\u4f1a',
  ]);
}

function severityPenalty(severity: AutomationReadinessIssueSeverity): number {
  if (severity === 'blocker') return 35;
  if (severity === 'warning') return 12;
  return 3;
}

function gradeScore(score: number): AutomationReadinessGrade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}
