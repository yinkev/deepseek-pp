import type { Memory, ToolDescriptor, ToolExecutionRecord } from '../types';
import type { SupportedLocale } from '../i18n';
import type { DeepSeekWebVisionFileMetadata } from '../deepseek/web-vision';
import type { DeepSeekWebVisionEvidencePack } from '../deepseek/vision-evidence';

export type AutomationId = string;
export type AutomationRunId = string;

export type AutomationStatus = 'active' | 'paused' | 'archived';

export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'skipped';

export type AutomationTrigger = 'manual' | 'schedule' | 'retry' | 'chain';

export type AutomationScheduleKind = 'manual' | 'cron' | 'rrule';

export type AutomationFailurePhase =
  | 'schedule'
  | 'storage'
  | 'tab'
  | 'bridge'
  | 'auth'
  | 'session'
  | 'runner'
  | 'pow'
  | 'completion'
  | 'history'
  | 'unknown';

export interface AutomationSchedule {
  kind: AutomationScheduleKind;
  expression: string | null;
  timezone: string;
  enabled: boolean;
  minimumIntervalMinutes: number;
  timeoutMs?: number;
}

export interface AutomationPromptOptions {
  modelType: string | null;
  searchEnabled: boolean;
  thinkingEnabled: boolean;
  refFileIds: string[];
  maxToolContinuationTurns?: number;
  webVisionFiles?: DeepSeekWebVisionFileMetadata[];
  visualMonitor?: AutomationVisualMonitorOptions;
  visualEvidencePacks?: DeepSeekWebVisionEvidencePack[];
}

export interface AutomationVisualMonitorOptions {
  enabled: boolean;
  source: 'browser_control_target';
  includeEvidencePack: boolean;
}

export interface AutomationDeepSeekSession {
  chatSessionId: string | null;
  parentMessageId: number | null;
  sessionUrl: string | null;
  lastHistorySyncedAt: number | null;
}

export interface AutomationChainPolicy {
  enabled: boolean;
  onSuccessAutomationIds: AutomationId[];
  maxDepth: number;
}

export interface AutomationRunChainContext {
  parentAutomationId: AutomationId | null;
  parentRunId: AutomationRunId | null;
  depth: number;
  visitedAutomationIds: AutomationId[];
}

export interface AutomationErrorState {
  code: string;
  message: string;
  phase: AutomationFailurePhase;
  retryable: boolean;
  at: number;
  details?: Record<string, unknown>;
}

export interface Automation {
  id: AutomationId;
  name: string;
  prompt: string;
  status: AutomationStatus;
  schedule: AutomationSchedule;
  promptOptions: AutomationPromptOptions;
  chain: AutomationChainPolicy;
  deepseek: AutomationDeepSeekSession;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastError: AutomationErrorState | null;
  version: number;
}

export type AutomationCreateInput = Pick<Automation, 'name' | 'prompt' | 'schedule' | 'promptOptions'> & {
  chain?: AutomationChainPolicy;
};

export type AutomationUpdateInput = Partial<
  Pick<Automation, 'name' | 'prompt' | 'status' | 'schedule' | 'promptOptions' | 'chain' | 'nextRunAt'>
>;

export type AutomationRuntimeUpdate = Partial<
  Pick<Automation, 'deepseek' | 'lastRunAt' | 'nextRunAt' | 'lastError' | 'status'>
>;

export interface AutomationRunnerRequest {
  runId: AutomationRunId;
  automationId: AutomationId;
  prompt: string;
  trigger: AutomationTrigger;
  chatSessionId: string | null;
  parentMessageId: number | null;
  promptOptions: AutomationPromptOptions;
  locale?: SupportedLocale;
  promptContext?: AutomationPromptContext;
  preflight?: AutomationRunPreflight;
  chain?: AutomationRunChainContext;
  requestedAt: number;
}

export interface AutomationRunPreflight {
  schemaVersion: 1;
  checkedAt: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number;
  status: 'ready' | 'needs_attention' | 'blocked';
  issueCodes: string[];
  blockingIssueCodes: string[];
  autoFixedIssueCodes: string[];
}

export interface AutomationPromptContext {
  memories?: Memory[];
  presetContent?: string | null;
  projectContext?: string | null;
  toolDescriptors?: ToolDescriptor[];
}

export interface AutomationHistorySnapshot {
  chatSessionId: string;
  parentMessageId: number | null;
  assistantMessageId: number | null;
  assistantText: string;
  messageCount: number;
  verifiedAt: number;
}

export interface AutomationRunnerSuccess {
  ok: true;
  chatSessionId: string;
  sessionUrl: string | null;
  parentMessageId: number;
  assistantMessageId: number | null;
  assistantText: string;
  toolExecutions?: ToolExecutionRecord[];
  history: AutomationHistorySnapshot | null;
  completedAt: number;
}

export interface AutomationRunnerFailure {
  ok: false;
  chatSessionId: string | null;
  parentMessageId: number | null;
  error: AutomationErrorState;
  completedAt: number;
}

export type AutomationRunnerResult = AutomationRunnerSuccess | AutomationRunnerFailure;

export type AutomationFlightEventKind =
  | 'readiness_preflight'
  | 'request_prepared'
  | 'session_resolved'
  | 'auth_resolved'
  | 'visual_monitor_attached'
  | 'runner_started'
  | 'runner_completed'
  | 'retry_scheduled';

export type AutomationFlightEventStatus = 'info' | 'success' | 'warning' | 'error';

export interface AutomationFlightEvent {
  id: string;
  at: number;
  kind: AutomationFlightEventKind;
  status: AutomationFlightEventStatus;
  label: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface AutomationFlightRecorder {
  schemaVersion: 1;
  startedAt: number;
  updatedAt: number;
  session: {
    strategy: 'current' | 'last' | 'new';
    source: 'automation' | 'sidepanel_session' | 'last_session' | 'new_session';
    chatSessionIdPresent: boolean;
    parentMessageIdPresent: boolean;
  };
  auth: {
    source: 'web_headers' | 'missing' | 'not_checked';
    hasWebAuth: boolean;
  };
  visual: {
    requested: boolean;
    attachedRefCount: number;
    evidencePackCount: number;
    rawImageStored: false;
  };
  failure: AutomationErrorState | null;
  retryable: boolean | null;
  events: AutomationFlightEvent[];
}

export interface AutomationRun {
  id: AutomationRunId;
  automationId: AutomationId;
  trigger: AutomationTrigger;
  status: AutomationRunStatus;
  scheduledFor: number | null;
  attempt: number;
  request: AutomationRunnerRequest | null;
  result: AutomationRunnerResult | null;
  error: AutomationErrorState | null;
  flightRecorder: AutomationFlightRecorder | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export type AutomationRunCreateInput = Pick<
  AutomationRun,
  'automationId' | 'trigger' | 'scheduledFor' | 'request'
> &
  Partial<Pick<AutomationRun, 'id' | 'attempt'>>;

export type AutomationRunUpdateInput = Partial<
  Pick<
    AutomationRun,
    | 'trigger'
    | 'status'
    | 'scheduledFor'
    | 'attempt'
    | 'request'
    | 'result'
    | 'error'
    | 'flightRecorder'
    | 'startedAt'
    | 'completedAt'
  >
>;

export interface AutomationRunListOptions {
  automationId: AutomationId;
  limit?: number;
}

export interface AutomationBridgeRunMessage {
  type: 'DPP_AUTOMATION_CONTENT_RUN';
  payload: AutomationRunnerRequest;
}

export interface AutomationBridgeResultMessage {
  type: 'DPP_AUTOMATION_WINDOW_RUN_RESULT';
  payload: {
    runId: AutomationRunId;
    automationId: AutomationId;
    result: AutomationRunnerResult;
  };
}

export type AutomationBridgeMessage = AutomationBridgeRunMessage | AutomationBridgeResultMessage;
