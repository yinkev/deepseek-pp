import {
  createDeepSeekWebVisionRoute,
  normalizeDeepSeekWebVisionRefFileIds,
} from '../deepseek/web-vision';
import type {
  AutomationCreateInput,
  AutomationPromptOptions,
  AutomationSchedule,
  AutomationScheduleKind,
} from './types';

export type AutomationWorkflowTemplateCategory =
  | 'readiness'
  | 'research'
  | 'project'
  | 'browser'
  | 'quality'
  | 'prompt'
  | 'memory';

export interface AutomationWorkflowTemplatePromptOptions {
  modelType: string | null;
  searchEnabled: boolean;
  thinkingEnabled: boolean;
  visualMonitorEnabled: boolean;
  maxToolContinuationTurns?: number;
  refFileIds?: readonly string[];
}

export interface AutomationWorkflowTemplateSchedule {
  kind: AutomationScheduleKind;
  expression: string | null;
  enabled: boolean;
  minimumIntervalMinutes?: number;
  timeoutMs?: number;
}

export interface AutomationWorkflowTemplate {
  id: string;
  copyKey: string;
  title: string;
  category: AutomationWorkflowTemplateCategory;
  summary: string;
  cadenceLabel: string;
  schedule: AutomationWorkflowTemplateSchedule;
  promptOptions: AutomationWorkflowTemplatePromptOptions;
  prompt: string;
}

export interface AutomationWorkflowTemplateInputOptions {
  timezone?: string;
}

const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_MINIMUM_INTERVAL_MINUTES = 15;
const REPAIR_LOOP_TIMEOUT_MS = 3_600_000;
const REPAIR_LOOP_CONTINUATION_BUDGET = 25;

export const AUTOMATION_WORKFLOW_TEMPLATES: readonly AutomationWorkflowTemplate[] = [
  {
    id: 'runtime-readiness-recovery',
    copyKey: 'runtimeReadinessRecovery',
    title: 'Runtime Readiness Recovery',
    category: 'readiness',
    summary: 'Checks the working setup, identifies blockers, and produces the next concrete recovery action.',
    cadenceLabel: 'Manual before important work',
    schedule: manualSchedule(),
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      visualMonitorEnabled: true,
    },
    prompt: loopPrompt([
      'I am about to use this DeepSeek++ setup. Check whether the selected browser target, Web auth, automation state, visual monitor, and leak sentry look ready.',
      'Plan the readiness checks first, then fan out across runtime, browser target, automation, Vision, and storage safety.',
      'Evaluate every blocker with evidence, review whether it is user-actionable or extension-actionable, grade the setup A through F, then iterate once with the smallest next fix.',
      'Stop when the setup is ready enough to use or when one exact user action is required. Do not delete data, change accounts, send external messages, or take irreversible actions without explicit confirmation.',
    ]),
  },
  {
    id: 'repo-repair-verify-loop',
    copyKey: 'repoRepairVerifyLoop',
    title: 'Repair & Verify Loop',
    category: 'project',
    summary: 'Long-running implementation loop that discovers gaps, patches the smallest safe slice, and verifies with evidence.',
    cadenceLabel: 'Manual long loop',
    schedule: manualSchedule(REPAIR_LOOP_TIMEOUT_MS),
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: true,
      visualMonitorEnabled: true,
      maxToolContinuationTurns: REPAIR_LOOP_CONTINUATION_BUDGET,
    },
    prompt: loopPrompt([
      'Run a bounded repair-and-verification loop for this objective: [replace with objective].',
      'Plan the objective, scope, autonomy boundary, and stop gates first, then fan out across feature inventory, user journeys, failing tests, high-risk defects, and verification commands.',
      'Evaluate findings against source truth and command evidence, review the strongest false-positive risks, grade confidence A through F, and iterate by patching only the smallest safe slice before rerunning the relevant gates.',
      'Stop only when no critical/high defects remain, no required verification checks are failing, no unresolved UX blockers remain, and incomplete journeys are either completed or explicitly listed as blocked.',
      'Required artifacts: run-state, proof-ledger, defect-log, verification-matrix, coverage-summary, and final handoff. Do not claim verification without actual command, browser, or tool evidence.',
    ]),
  },
  {
    id: 'deep-research-swarm',
    copyKey: 'deepResearchSwarm',
    title: 'Deep Research Swarm',
    category: 'research',
    summary: 'Source-grounded research loop with fan-out lanes, citations, confidence grading, and follow-up questions.',
    cadenceLabel: 'Manual per topic',
    schedule: manualSchedule(),
    promptOptions: {
      modelType: null,
      searchEnabled: true,
      thinkingEnabled: true,
      visualMonitorEnabled: false,
    },
    prompt: loopPrompt([
      'Research this topic: [replace with topic]. Write it like I asked a real analyst for a deep dive, not like a synthetic test.',
      'Plan the research question, fan out into primary sources, recent commentary, implementation details, and contradictions.',
      'Evaluate source quality, review conflicts, grade confidence for each important claim, and iterate with targeted follow-up searches until the answer is source-grounded.',
      'Stop with a concise brief, links, dated evidence, unknowns, and the next best action. Do not treat memories or private context as evidence unless I explicitly ask.',
    ]),
  },
  {
    id: 'project-status-council',
    copyKey: 'projectStatusCouncil',
    title: 'Project Status Council',
    category: 'project',
    summary: 'Weekly project digest that turns current context into blockers, decisions, and next actions.',
    cadenceLabel: 'Weekly Monday 9 AM',
    schedule: cronSchedule('0 9 * * 1'),
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: true,
      visualMonitorEnabled: false,
    },
    prompt: loopPrompt([
      'Prepare my project status council for the active DeepSeek++ work.',
      'Plan the review, fan out across recent progress, unresolved blockers, open risks, tests, docs, and next implementation moves.',
      'Evaluate what is actually verified, review what is stale or speculative, grade the project state A through F, and iterate into a prioritized action list.',
      'Stop with the top 5 next actions, exact evidence gaps, and what should not be touched yet. Do not commit, merge, delete, or publish without explicit confirmation.',
    ]),
  },
  {
    id: 'implementation-council',
    copyKey: 'implementationCouncil',
    title: 'Implementation Council',
    category: 'project',
    summary: 'Turns a rough build objective into a scoped implementation plan, tests, risks, and next patch slice.',
    cadenceLabel: 'Manual before implementation',
    schedule: manualSchedule(),
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: true,
      visualMonitorEnabled: false,
    },
    prompt: loopPrompt([
      'Run an implementation council for this objective: [replace with objective].',
      'Plan the concrete end state and success evidence, then fan out across architecture, code paths, tests, data safety, UX, and release risk.',
      'Evaluate tradeoffs, review the smallest useful implementation slice, grade confidence A through F, and iterate into a patch plan with exact files and verification commands.',
      'Stop with the ordered implementation steps, tests to run, rollback risk, and one blocking question only if progress would otherwise be unsafe. Do not edit, commit, merge, delete, or publish without explicit confirmation.',
    ]),
  },
  {
    id: 'browser-watchtower',
    copyKey: 'browserWatchtower',
    title: 'Browser Watchtower',
    category: 'browser',
    summary: 'Visual monitor for the selected Browser Control target with metadata-only evidence.',
    cadenceLabel: 'Manual or scheduled after target selection',
    schedule: manualSchedule(),
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      visualMonitorEnabled: true,
    },
    prompt: loopPrompt([
      'Inspect the selected Browser Control target visually and tell me whether anything looks broken, stale, blocked, or ready for the next step.',
      'Plan the visual check, fan out across page state, visible errors, auth/session state, controls, and task relevance.',
      'Evaluate the screenshot evidence, review likely causes, grade confidence, and iterate once with the safest next visible check.',
      'Stop with a plain human summary and one next action. Do not click, type, submit forms, purchase, delete, or change account settings without explicit confirmation.',
    ]),
  },
  {
    id: 'review-grade-iterate',
    copyKey: 'reviewGradeIterate',
    title: 'Review Grade Iterate',
    category: 'quality',
    summary: 'Evaluator loop for any draft, plan, prompt, or implementation result.',
    cadenceLabel: 'Manual after a draft',
    schedule: manualSchedule(),
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: true,
      visualMonitorEnabled: false,
    },
    prompt: loopPrompt([
      'Review this artifact: [replace with artifact or context].',
      'Plan the evaluation rubric, fan out across correctness, usefulness, missing pieces, safety, maintainability, and user fit.',
      'Evaluate against the rubric, review the strongest objections, grade it A through F with reasons, and iterate into a better version or concrete patch plan.',
      'Stop when the next version is materially better or when one missing input blocks a truthful grade. Do not claim verification without evidence.',
    ]),
  },
  {
    id: 'systematic-debug-loop',
    copyKey: 'systematicDebugLoop',
    title: 'Systematic Debug Loop',
    category: 'quality',
    summary: 'Reproduces a failure, forms hypotheses, tests them, grades confidence, and lands the smallest fix path.',
    cadenceLabel: 'Manual after a failure',
    schedule: manualSchedule(),
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      visualMonitorEnabled: true,
    },
    prompt: loopPrompt([
      'Debug this failure: [replace with symptom, screenshot, log, or failing command].',
      'Plan the reproduction path, then fan out across recent changes, logs, runtime state, configuration, data shape, browser state, and tests.',
      'Evaluate each hypothesis against evidence, review contradictions, grade root-cause confidence, and iterate by choosing the next cheapest discriminating check.',
      'Stop with the likely root cause, smallest fix path, exact verification command or manual check, and what evidence would change the diagnosis. Do not claim the bug is fixed without a passing check.',
    ]),
  },
  {
    id: 'prompt-workflow-refinery',
    copyKey: 'promptWorkflowRefinery',
    title: 'Prompt Workflow Refinery',
    category: 'prompt',
    summary: 'Turns rough instructions into a reusable workflow with gates, outputs, and stop conditions.',
    cadenceLabel: 'Manual when a workflow repeats',
    schedule: manualSchedule(),
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: true,
      visualMonitorEnabled: false,
    },
    prompt: loopPrompt([
      'Turn this rough instruction into a reusable workflow: [replace with rough workflow].',
      'Plan the workflow, fan out into inputs, execution steps, tools, evidence, review gates, failure modes, and final output shape.',
      'Evaluate ambiguity, review hidden assumptions, grade the workflow for repeatability, and iterate into a concise prompt or skill-ready checklist.',
      'Stop with the reusable workflow, exact acceptance criteria, and examples of when not to use it. Do not invent fake tool capabilities.',
    ]),
  },
  {
    id: 'memory-hygiene-council',
    copyKey: 'memoryHygieneCouncil',
    title: 'Memory Hygiene Council',
    category: 'memory',
    summary: 'Review-only memory hygiene loop that suggests keeps, edits, merges, and deletions without mutating data.',
    cadenceLabel: 'Manual with explicit consent',
    schedule: manualSchedule(),
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: true,
      visualMonitorEnabled: false,
    },
    prompt: loopPrompt([
      'Review my memory and saved-context hygiene. This is review-only unless I explicitly approve changes.',
      'Plan the audit, fan out across stale facts, duplicate memories, sensitive details, overbroad rules, and missing durable preferences.',
      'Evaluate each issue with evidence, review whether it should be kept, edited, merged, or deleted, grade the memory set, and iterate into a safe cleanup proposal.',
      'Stop with a proposed change list only. Do not delete, rewrite, export, sync, or reveal sensitive data without explicit confirmation.',
    ]),
  },
  {
    id: 'source-monitor',
    copyKey: 'sourceMonitor',
    title: 'Source Monitor',
    category: 'research',
    summary: 'Scheduled source scan that catches changes and separates evidence from speculation.',
    cadenceLabel: 'Daily 8 AM',
    schedule: cronSchedule('0 8 * * *'),
    promptOptions: {
      modelType: null,
      searchEnabled: true,
      thinkingEnabled: true,
      visualMonitorEnabled: false,
    },
    prompt: loopPrompt([
      'Monitor these sources or topics: [replace with sources/topics]. Tell me what changed since the last run.',
      'Plan the scan, fan out across official sources, changelogs, docs, issues, and credible secondary sources.',
      'Evaluate recency and reliability, review contradictions, grade impact and confidence, and iterate with follow-up searches only where the change matters.',
      'Stop with a compact changelog, links, dates, impact grade, and actions. Do not overstate weak evidence.',
    ]),
  },
] as const;

export function createAutomationInputFromWorkflowTemplate(
  template: AutomationWorkflowTemplate,
  options: AutomationWorkflowTemplateInputOptions = {},
): AutomationCreateInput {
  const route = createDeepSeekWebVisionRoute({
    modelType: template.promptOptions.modelType,
    refFileIds: normalizeDeepSeekWebVisionRefFileIds(template.promptOptions.refFileIds ?? []),
    thinkingEnabled: template.promptOptions.thinkingEnabled,
    searchEnabled: template.promptOptions.searchEnabled,
  });

  return {
    name: template.title,
    prompt: template.prompt,
    schedule: createScheduleFromTemplate(template.schedule, options.timezone),
    promptOptions: createPromptOptions(
      route,
      template.promptOptions.visualMonitorEnabled,
      template.promptOptions.maxToolContinuationTurns,
    ),
  };
}

function createScheduleFromTemplate(
  schedule: AutomationWorkflowTemplateSchedule,
  timezone = DEFAULT_TIMEZONE,
): AutomationSchedule {
  return {
    kind: schedule.kind,
    expression: schedule.enabled ? schedule.expression : null,
    timezone,
    enabled: schedule.enabled,
    minimumIntervalMinutes: schedule.minimumIntervalMinutes ?? DEFAULT_MINIMUM_INTERVAL_MINUTES,
    ...(typeof schedule.timeoutMs === 'number' && Number.isFinite(schedule.timeoutMs)
      ? { timeoutMs: Math.max(1_000, Math.floor(schedule.timeoutMs)) }
      : {}),
  };
}

function createPromptOptions(
  route: ReturnType<typeof createDeepSeekWebVisionRoute>,
  visualMonitorEnabled: boolean,
  maxToolContinuationTurns?: number,
): AutomationPromptOptions {
  return {
    modelType: route.modelType,
    searchEnabled: route.searchEnabled,
    thinkingEnabled: route.thinkingEnabled,
    refFileIds: route.refFileIds,
    ...(typeof maxToolContinuationTurns === 'number' && Number.isFinite(maxToolContinuationTurns)
      ? { maxToolContinuationTurns: Math.max(1, Math.min(50, Math.floor(maxToolContinuationTurns))) }
      : {}),
    webVisionFiles: [],
    visualMonitor: visualMonitorEnabled
      ? {
        enabled: true,
        source: 'browser_control_target',
        includeEvidencePack: true,
      }
      : undefined,
  };
}

function manualSchedule(timeoutMs?: number): AutomationWorkflowTemplateSchedule {
  return {
    kind: 'manual',
    expression: null,
    enabled: false,
    ...(typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
  };
}

function cronSchedule(expression: string): AutomationWorkflowTemplateSchedule {
  return {
    kind: 'cron',
    expression,
    enabled: true,
  };
}

function loopPrompt(lines: readonly string[]): string {
  return [
    ...lines,
    'Safety: do not take irreversible actions without explicit confirmation.',
  ].join('\n\n');
}
