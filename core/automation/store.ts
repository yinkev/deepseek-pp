import type {
  Automation,
  AutomationCreateInput,
  AutomationErrorState,
  AutomationFlightEvent,
  AutomationFlightEventKind,
  AutomationFlightEventStatus,
  AutomationFlightRecorder,
  AutomationId,
  AutomationPromptOptions,
  AutomationRun,
  AutomationRunCreateInput,
  AutomationRunId,
  AutomationRunListOptions,
  AutomationRunnerRequest,
  AutomationRunnerResult,
  AutomationRunUpdateInput,
  AutomationRuntimeUpdate,
  AutomationStatus,
  AutomationUpdateInput,
} from './types';
import type { DeepSeekWebVisionEvidencePack } from '../deepseek/vision-evidence';
import type { DeepSeekWebVisionFileMetadata } from '../deepseek/web-vision';
import type { ToolError, ToolExecutionRecord } from '../types';
import { redactDurableToolString, redactDurableToolValue } from '../tool/redaction';

const STORAGE_KEY = 'deepseek_pp_automations';
const STORAGE_VERSION = 1;
const DEFAULT_RUN_HISTORY_LIMIT = 100;

interface AutomationStorageState {
  version: number;
  automations: Automation[];
  runs: AutomationRun[];
}

const EMPTY_STATE: AutomationStorageState = {
  version: STORAGE_VERSION,
  automations: [],
  runs: [],
};

export async function getAllAutomations(): Promise<Automation[]> {
  const state = await readState();
  return [...state.automations].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getAutomationById(id: AutomationId): Promise<Automation | null> {
  const state = await readState();
  return state.automations.find((automation) => automation.id === id) ?? null;
}

export async function createAutomation(input: AutomationCreateInput): Promise<Automation> {
  const state = await readState();
  const now = Date.now();
  const safeInput = sanitizeAutomationCreateInput(input);
  const automation: Automation = {
    ...safeInput,
    id: crypto.randomUUID(),
    status: 'active',
    deepseek: {
      chatSessionId: null,
      parentMessageId: null,
      sessionUrl: null,
      lastHistorySyncedAt: null,
    },
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    version: 1,
  };

  await writeState({
    ...state,
    automations: [automation, ...state.automations],
  });
  return automation;
}

export async function updateAutomation(
  id: AutomationId,
  patch: AutomationUpdateInput,
): Promise<Automation | null> {
  return patchAutomation(id, patch);
}

export async function updateAutomationRuntime(
  id: AutomationId,
  patch: AutomationRuntimeUpdate,
): Promise<Automation | null> {
  return patchAutomation(id, patch);
}

export async function setAutomationStatus(
  id: AutomationId,
  status: AutomationStatus,
): Promise<Automation | null> {
  return patchAutomation(id, { status });
}

export async function deleteAutomation(id: AutomationId): Promise<void> {
  const state = await readState();
  await writeState({
    ...state,
    automations: state.automations.filter((automation) => automation.id !== id),
    runs: state.runs.filter((run) => run.automationId !== id),
  });
}

export async function createAutomationRun(input: AutomationRunCreateInput): Promise<AutomationRun> {
  const now = Date.now();
  const run: AutomationRun = {
    id: input.id ?? crypto.randomUUID(),
    automationId: input.automationId,
    trigger: input.trigger,
    status: 'queued',
    scheduledFor: input.scheduledFor,
    attempt: input.attempt ?? 1,
    request: normalizeAutomationRunRequest(input.request),
    result: null,
    error: null,
    flightRecorder: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  };

  await appendAutomationRun(run);
  return run;
}

export async function appendAutomationRun(run: AutomationRun): Promise<void> {
  const state = await readState();
  const safeRun = normalizeAutomationRun(run) ?? run;
  const runs = [safeRun, ...state.runs.filter((stored) => stored.id !== safeRun.id)];
  await writeState({
    ...state,
    runs: pruneRunHistory(runs),
  });
}

export async function updateAutomationRun(
  id: AutomationRunId,
  patch: AutomationRunUpdateInput,
): Promise<AutomationRun | null> {
  const state = await readState();
  const safePatch = sanitizeAutomationRunUpdate(patch);
  let updatedRun: AutomationRun | null = null;
  const runs = state.runs.map((run) => {
    if (run.id !== id) return run;
    updatedRun = {
      ...run,
      ...safePatch,
      updatedAt: Date.now(),
    };
    return updatedRun;
  });

  if (!updatedRun) return null;
  await writeState({ ...state, runs });
  return updatedRun;
}

export async function getAutomationRuns(
  options: AutomationRunListOptions,
): Promise<AutomationRun[]> {
  const state = await readState();
  const limit = options.limit ?? DEFAULT_RUN_HISTORY_LIMIT;
  return state.runs
    .filter((run) => run.automationId === options.automationId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function getAutomationRunById(id: AutomationRunId): Promise<AutomationRun | null> {
  const state = await readState();
  return state.runs.find((run) => run.id === id) ?? null;
}

/**
 * Marks `running` automation runs whose `startedAt` predates `thresholdMs` as
 * failed. This recovers from a service-worker termination mid-run, which would
 * otherwise leave orphaned `running` rows that never complete and would let the
 * next scan re-run the same automation. Returns the count of runs reconciled.
 *
 * Safe to call repeatedly — only stale `running` rows are touched.
 */
export async function reconcileStaleRuns(
  thresholdMs: number,
  now: number = Date.now(),
): Promise<number> {
  const state = await readState();
  let reconciled = 0;
  let changed = false;
  const runs = state.runs.map((run) => {
    if (run.status !== 'running' || run.startedAt == null) return run;
    if (now - run.startedAt < thresholdMs) return run;

    changed = true;
    reconciled += 1;
    const completedAt = run.startedAt + thresholdMs;
    return {
      ...run,
      status: 'failed' as const,
      completedAt,
      error: {
        code: 'automation_run_interrupted',
        message: 'Service worker was terminated while the run was in progress.',
        phase: 'runner' as const,
        retryable: true,
        at: now,
        details: { startedAt: run.startedAt, completedAt },
      },
      updatedAt: now,
    };
  });

  if (changed) {
    await writeState({ ...state, runs });
  }
  return reconciled;
}

async function patchAutomation(
  id: AutomationId,
  patch: AutomationUpdateInput | AutomationRuntimeUpdate,
): Promise<Automation | null> {
  const state = await readState();
  const safePatch = sanitizeAutomationPatch(patch);
  let updatedAutomation: Automation | null = null;
  const automations = state.automations.map((automation) => {
    if (automation.id !== id) return automation;
    updatedAutomation = {
      ...automation,
      ...safePatch,
      updatedAt: Date.now(),
    };
    return updatedAutomation;
  });

  if (!updatedAutomation) return null;
  await writeState({ ...state, automations });
  return updatedAutomation;
}

async function readState(): Promise<AutomationStorageState> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  return normalizeState(data[STORAGE_KEY]);
}

async function writeState(state: AutomationStorageState): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      version: STORAGE_VERSION,
      automations: state.automations,
      runs: state.runs,
    },
  });
}

function normalizeState(raw: unknown): AutomationStorageState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE };

  const value = raw as Partial<AutomationStorageState>;
  return {
    version: typeof value.version === 'number' ? value.version : STORAGE_VERSION,
    automations: Array.isArray(value.automations)
      ? value.automations.map(normalizeAutomation).filter((item): item is Automation => item !== null)
      : [],
    runs: Array.isArray(value.runs)
      ? value.runs.map(normalizeAutomationRun).filter((item): item is AutomationRun => item !== null)
      : [],
  };
}

function normalizeAutomation(raw: unknown): Automation | null {
  if (!raw || typeof raw !== 'object') return null;

  const automation = raw as Automation;
  const deepseek = automation.deepseek ?? {
    chatSessionId: null,
    parentMessageId: null,
    sessionUrl: null,
    lastHistorySyncedAt: null,
  };

  return {
    ...automation,
    promptOptions: normalizePromptOptions(automation.promptOptions),
    deepseek: {
      ...deepseek,
      parentMessageId: normalizeStoredMessageId(deepseek.parentMessageId),
    },
  };
}

function normalizeAutomationRun(raw: unknown): AutomationRun | null {
  if (!raw || typeof raw !== 'object') return null;

  const run = raw as AutomationRun;
  return {
    ...run,
    request: normalizeAutomationRunRequest(run.request),
    result: normalizeRunResult(run.result),
    error: normalizeAutomationError(run.error),
    flightRecorder: normalizeFlightRecorder(run.flightRecorder),
  };
}

function sanitizeAutomationCreateInput(input: AutomationCreateInput): AutomationCreateInput {
  return {
    ...input,
    promptOptions: normalizePromptOptions(input.promptOptions),
  };
}

function sanitizeAutomationPatch<T extends AutomationUpdateInput | AutomationRuntimeUpdate>(patch: T): T {
  const next = { ...patch } as T & {
    promptOptions?: AutomationPromptOptions;
    lastError?: AutomationErrorState | null;
  };
  if ('promptOptions' in next) {
    next.promptOptions = normalizePromptOptions(next.promptOptions);
  }
  if ('lastError' in next) {
    next.lastError = normalizeAutomationError(next.lastError);
  }
  return next as T;
}

function sanitizeAutomationRunUpdate(patch: AutomationRunUpdateInput): AutomationRunUpdateInput {
  const next = { ...patch };
  if ('request' in next) next.request = normalizeAutomationRunRequest(next.request ?? null);
  if ('result' in next) next.result = normalizeRunResult(next.result ?? null);
  if ('error' in next) next.error = normalizeAutomationError(next.error ?? null);
  if ('flightRecorder' in next) next.flightRecorder = normalizeFlightRecorder(next.flightRecorder ?? null);
  return next;
}

function normalizePromptOptions(value: AutomationPromptOptions | undefined): AutomationPromptOptions {
  const refFileIds = Array.isArray(value?.refFileIds)
    ? value.refFileIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const refSet = new Set(refFileIds);
  return {
    modelType: typeof value?.modelType === 'string' ? value.modelType : null,
    searchEnabled: value?.searchEnabled === true,
    thinkingEnabled: value?.thinkingEnabled === true,
    refFileIds,
    webVisionFiles: Array.isArray(value?.webVisionFiles)
      ? value.webVisionFiles
        .map(normalizeWebVisionFileMetadata)
        .filter((item): item is DeepSeekWebVisionFileMetadata => item !== null && refSet.has(item.id))
      : [],
    visualMonitor: value?.visualMonitor?.enabled === true
      ? {
        enabled: true,
        source: 'browser_control_target',
        includeEvidencePack: value.visualMonitor.includeEvidencePack !== false,
      }
      : undefined,
    visualEvidencePacks: Array.isArray(value?.visualEvidencePacks)
      ? value.visualEvidencePacks
        .map(normalizeVisualEvidencePack)
        .filter((pack): pack is DeepSeekWebVisionEvidencePack => pack !== null)
      : [],
  };
}

function normalizeWebVisionFileMetadata(value: unknown): DeepSeekWebVisionFileMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const file = value as Partial<DeepSeekWebVisionFileMetadata>;
  if (typeof file.id !== 'string' || !file.id.trim()) return null;
  return {
    id: file.id.trim(),
    name: redactDurableToolString(typeof file.name === 'string' ? file.name : '') ?? '',
    size: typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : 0,
    mimeType: redactDurableToolString(typeof file.mimeType === 'string' ? file.mimeType : '') ?? '',
    status: typeof file.status === 'string' ? file.status as DeepSeekWebVisionFileMetadata['status'] : 'SUCCESS',
    modelKind: typeof file.modelKind === 'string' ? file.modelKind as DeepSeekWebVisionFileMetadata['modelKind'] : 'VISION',
    isImage: file.isImage === true,
    auditResult: typeof file.auditResult === 'string'
      ? file.auditResult as DeepSeekWebVisionFileMetadata['auditResult']
      : 'unknown',
    width: typeof file.width === 'number' && Number.isFinite(file.width) ? file.width : null,
    height: typeof file.height === 'number' && Number.isFinite(file.height) ? file.height : null,
  };
}

function normalizeVisualEvidencePack(value: unknown): DeepSeekWebVisionEvidencePack | null {
  if (!value || typeof value !== 'object') return null;
  const pack = value as Partial<DeepSeekWebVisionEvidencePack>;
  if (pack.storage !== 'metadata_only' || pack.rawImageStored !== false) return null;
  const refFileIds = Array.isArray(pack.refFileIds)
    ? pack.refFileIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];
  if (refFileIds.length === 0) return null;
  const refSet = new Set(refFileIds);
  return {
    schemaVersion: 1,
    id: redactDurableToolString(typeof pack.id === 'string' ? pack.id : '') || `stored-evidence-${Date.now()}`,
    kind: isEvidenceKind(pack.kind) ? pack.kind : 'automation_monitor',
    createdAt: typeof pack.createdAt === 'number' && Number.isFinite(pack.createdAt) ? pack.createdAt : Date.now(),
    storage: 'metadata_only',
    rawImageStored: false,
    refFileIds,
    webVisionFiles: Array.isArray(pack.webVisionFiles)
      ? pack.webVisionFiles
        .map(normalizeWebVisionFileMetadata)
        .filter((item): item is DeepSeekWebVisionFileMetadata => item !== null && refSet.has(item.id))
      : [],
    source: {
      ...(typeof pack.source?.toolName === 'string' ? { toolName: redactDurableToolString(pack.source.toolName) ?? '' } : {}),
      ...(typeof pack.source?.automationId === 'string' ? { automationId: pack.source.automationId } : {}),
      ...(typeof pack.source?.automationRunId === 'string' ? { automationRunId: pack.source.automationRunId } : {}),
      ...(typeof pack.source?.tabId === 'number' ? { tabId: pack.source.tabId } : {}),
      ...(typeof pack.source?.windowId === 'number' ? { windowId: pack.source.windowId } : {}),
    },
    image: {
      name: redactDurableToolString(typeof pack.image?.name === 'string' ? pack.image.name : '') ?? '',
      mimeType: redactDurableToolString(typeof pack.image?.mimeType === 'string' ? pack.image.mimeType : '') ?? '',
      sizeBytes: typeof pack.image?.sizeBytes === 'number' && Number.isFinite(pack.image.sizeBytes)
        ? pack.image.sizeBytes
        : 0,
    },
    ...(typeof pack.prompt === 'string' ? { prompt: redactDurableToolString(pack.prompt) ?? '' } : {}),
  };
}

function isEvidenceKind(value: unknown): value is DeepSeekWebVisionEvidencePack['kind'] {
  return value === 'browser_capture' || value === 'browser_act_verify' || value === 'automation_monitor';
}

function normalizeRunResult(result: AutomationRun['result']): AutomationRun['result'] {
  if (!result) return null;
  if (result.ok) {
    return {
      ...result,
      assistantText: redactDurableToolString(result.assistantText) ?? '',
      sessionUrl: result.sessionUrl === null ? null : redactDurableToolString(result.sessionUrl) ?? null,
      parentMessageId: normalizeStoredMessageId(result.parentMessageId) ?? 0,
      assistantMessageId: normalizeStoredMessageId(result.assistantMessageId),
      toolExecutions: Array.isArray(result.toolExecutions)
        ? result.toolExecutions.map(normalizeToolExecutionRecord)
        : undefined,
      history: result.history
        ? {
          ...result.history,
          parentMessageId: normalizeStoredMessageId(result.history.parentMessageId),
          assistantMessageId: normalizeStoredMessageId(result.history.assistantMessageId),
        }
        : null,
    };
  }

  return {
    ...result,
    parentMessageId: normalizeStoredMessageId(result.parentMessageId),
    error: normalizeAutomationError(result.error) ?? result.error,
  };
}

function normalizeAutomationRunRequest(request: AutomationRunnerRequest | null): AutomationRunnerRequest | null {
  if (!request) return null;
  return {
    ...request,
    prompt: redactDurableToolString(request.prompt) ?? '',
    parentMessageId: normalizeStoredMessageId(request.parentMessageId),
    promptOptions: normalizePromptOptions(request.promptOptions),
    preflight: normalizeAutomationRunPreflight(request.preflight),
  };
}

function normalizeAutomationRunPreflight(
  preflight: AutomationRunnerRequest['preflight'] | undefined,
): AutomationRunnerRequest['preflight'] | undefined {
  if (!preflight || typeof preflight !== 'object') return undefined;
  return {
    schemaVersion: 1,
    checkedAt: finiteNumber(preflight.checkedAt) ?? Date.now(),
    grade: isReadinessGrade(preflight.grade) ? preflight.grade : 'F',
    score: Math.max(0, Math.min(100, finiteNumber(preflight.score) ?? 0)),
    status: isReadinessStatus(preflight.status) ? preflight.status : 'blocked',
    issueCodes: normalizePreflightCodeList(preflight.issueCodes),
    blockingIssueCodes: normalizePreflightCodeList(preflight.blockingIssueCodes),
    autoFixedIssueCodes: normalizePreflightCodeList(preflight.autoFixedIssueCodes),
  };
}

function normalizeFlightRecorder(recorder: AutomationFlightRecorder | null | undefined): AutomationFlightRecorder | null {
  if (!recorder || typeof recorder !== 'object') return null;
  const startedAt = finiteNumber(recorder.startedAt) ?? Date.now();
  const updatedAt = finiteNumber(recorder.updatedAt) ?? startedAt;
  const session = recorder.session && typeof recorder.session === 'object' ? recorder.session : null;
  const auth = recorder.auth && typeof recorder.auth === 'object' ? recorder.auth : null;
  const visual = recorder.visual && typeof recorder.visual === 'object' ? recorder.visual : null;
  return {
    schemaVersion: 1,
    startedAt,
    updatedAt,
    session: {
      strategy: isFlightSessionStrategy(session?.strategy) ? session.strategy : 'current',
      source: isFlightSessionSource(session?.source) ? session.source : 'automation',
      chatSessionIdPresent: session?.chatSessionIdPresent === true,
      parentMessageIdPresent: session?.parentMessageIdPresent === true,
    },
    auth: {
      source: isFlightAuthSource(auth?.source) ? auth.source : 'not_checked',
      hasWebAuth: auth?.hasWebAuth === true,
    },
    visual: {
      requested: visual?.requested === true,
      attachedRefCount: finiteNumber(visual?.attachedRefCount) ?? 0,
      evidencePackCount: finiteNumber(visual?.evidencePackCount) ?? 0,
      rawImageStored: false,
    },
    failure: normalizeFlightRecorderError(recorder.failure),
    retryable: typeof recorder.retryable === 'boolean' ? recorder.retryable : null,
    events: Array.isArray(recorder.events)
      ? recorder.events.map(normalizeFlightEvent).filter((event): event is AutomationFlightEvent => event !== null)
      : [],
  };
}

function normalizeFlightEvent(event: unknown): AutomationFlightEvent | null {
  if (!event || typeof event !== 'object') return null;
  const value = event as Partial<AutomationFlightEvent>;
  if (!isFlightEventKind(value.kind)) return null;
  return {
    id: redactDurableToolString(typeof value.id === 'string' && value.id ? value.id : `event-${Date.now()}`) ?? 'event',
    at: finiteNumber(value.at) ?? Date.now(),
    kind: value.kind,
    status: isFlightEventStatus(value.status) ? value.status : 'info',
    label: redactDurableToolString(typeof value.label === 'string' ? value.label : value.kind) ?? value.kind,
    summary: redactDurableToolString(typeof value.summary === 'string' ? value.summary : '') ?? '',
    details: normalizeFlightRecorderDetails(value.details),
  };
}

function isFlightEventKind(value: unknown): value is AutomationFlightEventKind {
  return value === 'readiness_preflight' ||
    value === 'request_prepared' ||
    value === 'session_resolved' ||
    value === 'auth_resolved' ||
    value === 'visual_monitor_attached' ||
    value === 'runner_started' ||
    value === 'runner_completed' ||
    value === 'retry_scheduled';
}

function isFlightEventStatus(value: unknown): value is AutomationFlightEventStatus {
  return value === 'info' || value === 'success' || value === 'warning' || value === 'error';
}

function isFlightSessionStrategy(value: unknown): value is AutomationFlightRecorder['session']['strategy'] {
  return value === 'current' || value === 'last' || value === 'new';
}

function isFlightSessionSource(value: unknown): value is AutomationFlightRecorder['session']['source'] {
  return value === 'automation' ||
    value === 'sidepanel_session' ||
    value === 'last_session' ||
    value === 'new_session';
}

function isFlightAuthSource(value: unknown): value is AutomationFlightRecorder['auth']['source'] {
  return value === 'web_headers' || value === 'missing' || value === 'not_checked';
}

function normalizeFlightRecorderError(error: AutomationErrorState | null | undefined): AutomationErrorState | null {
  const normalized = normalizeAutomationError(error);
  if (!normalized) return null;
  return {
    ...normalized,
    details: normalizeFlightRecorderDetails(normalized.details),
  };
}

function normalizeFlightRecorderDetails(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const redacted = redactDurableToolValue(value);
  const stripped = stripForbiddenFlightRecorderKeys(redacted);
  return stripped && typeof stripped === 'object' && !Array.isArray(stripped)
    ? stripped as Record<string, unknown>
    : undefined;
}

function stripForbiddenFlightRecorderKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(stripForbiddenFlightRecorderKeys);
  }
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenFlightRecorderDetailKey(key)) continue;
    next[key] = stripForbiddenFlightRecorderKeys(entry);
  }
  return next;
}

function isForbiddenFlightRecorderDetailKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === 'authorization' ||
    lower === 'cookie' ||
    lower === 'set-cookie' ||
    lower === 'x-ds-pow-response' ||
    lower === 'apikey' ||
    lower === 'api_key' ||
    lower === 'token' ||
    lower === 'secret' ||
    lower === 'signedpath' ||
    lower === 'signed_path' ||
    lower === 'ref_file_id' ||
    lower === 'ref_file_ids' ||
    key === 'refFileId' ||
    key === 'refFileIds' ||
    key === 'webVisionFiles' ||
    lower === 'dataurl' ||
    lower === 'database64' ||
    lower === 'base64data' ||
    lower === 'imageurl' ||
    lower === 'image_url';
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isReadinessGrade(value: unknown): value is NonNullable<AutomationRunnerRequest['preflight']>['grade'] {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D' || value === 'F';
}

function isReadinessStatus(value: unknown): value is NonNullable<AutomationRunnerRequest['preflight']>['status'] {
  return value === 'ready' || value === 'needs_attention' || value === 'blocked';
}

function normalizePreflightCodeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
    if (normalized && !codes.includes(normalized)) codes.push(normalized);
    if (codes.length >= 16) break;
  }
  return codes;
}

function normalizeAutomationError(error: AutomationErrorState | null | undefined): AutomationErrorState | null {
  if (!error) return null;
  return {
    ...error,
    message: redactDurableToolString(error.message) ?? '',
    details: error.details
      ? redactDurableToolValue(error.details) as Record<string, unknown>
      : undefined,
  };
}

function normalizeToolExecutionRecord(execution: ToolExecutionRecord): ToolExecutionRecord {
  return {
    ...execution,
    result: {
      ...execution.result,
      summary: redactDurableToolString(execution.result.summary) ?? '',
      detail: redactDurableToolString(execution.result.detail),
      output: normalizeToolExecutionOutput(execution.result.output),
      error: normalizeToolError(execution.result.error),
    },
  };
}

function normalizeToolExecutionOutput(output: ToolExecutionRecord['result']['output']): ToolExecutionRecord['result']['output'] {
  if (typeof output === 'string') {
    const parsed = parseJsonValue(output);
    if (parsed !== null) return JSON.stringify(redactDurableToolValue(parsed));
    return redactDurableToolString(output);
  }
  if (output === undefined) return undefined;
  return redactDurableToolValue(output) as ToolExecutionRecord['result']['output'];
}

function normalizeToolError(error: ToolError | undefined): ToolError | undefined {
  if (!error) return undefined;
  return {
    ...error,
    message: redactDurableToolString(error.message) ?? '',
    details: error.details
      ? redactDurableToolValue(error.details) as Record<string, unknown>
      : undefined,
  };
}

function parseJsonValue(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeStoredMessageId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xFFFFFFFF) return parsed;
  }
  return null;
}

function pruneRunHistory(runs: AutomationRun[]): AutomationRun[] {
  const grouped = new Map<AutomationId, AutomationRun[]>();
  for (const run of runs) {
    const group = grouped.get(run.automationId) ?? [];
    group.push(run);
    grouped.set(run.automationId, group);
  }

  return [...grouped.values()].flatMap((group) =>
    group
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, DEFAULT_RUN_HISTORY_LIMIT),
  );
}
