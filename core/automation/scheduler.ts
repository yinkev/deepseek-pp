import {
  createAutomationRun,
  getAllAutomations,
  getAutomationById,
  reconcileStaleRuns,
  updateAutomation,
  updateAutomationRun,
  updateAutomationRuntime,
} from './store';
import { calculateNextRunAt } from './schedule';
import {
  applySafeAutomationReadinessFixes,
  evaluateAutomationReadiness,
  getSafeAutomationReadinessFixes,
  type AutomationReadinessIssueCode,
  type AutomationReadinessReport,
} from './readiness';
import type {
  Automation,
  AutomationErrorState,
  AutomationId,
  AutomationRun,
  AutomationRunPreflight,
  AutomationRunnerRequest,
  AutomationRunnerResult,
  AutomationTrigger,
} from './types';

export const AUTOMATION_WAKE_ALARM_NAME = 'deepseek_pp_automation_wake';
export const AUTOMATION_WAKE_INTERVAL_MINUTES = 1;
export const AUTOMATION_RUN_TIMEOUT_MS = 180_000;
export const AUTOMATION_MAX_ATTEMPTS = 2;
export const AUTOMATION_RETRY_DELAY_MS = 10_000;

type AutomationRunExecutor = (request: AutomationRunnerRequest) => Promise<AutomationRunnerResult>;

interface RunAutomationOptions {
  automationId: AutomationId;
  trigger: AutomationTrigger;
  scheduledFor: number | null;
  now?: number;
  executor: AutomationRunExecutor;
}

export interface ScanDueAutomationsResult {
  checkedAt: number;
  scanned: number;
  initialized: number;
  due: number;
  started: number;
  locked: number;
  failed: number;
}

const activeRunLocks = new Set<AutomationId>();

export async function scanDueAutomations(
  executor: AutomationRunExecutor,
  now: number = Date.now(),
): Promise<ScanDueAutomationsResult> {
  // Recover any `running` rows orphaned by a service-worker termination before
  // scanning, so the in-memory lock (which is lost on restart) doesn't allow a
  // duplicate run and so the orphaned row is finalized.
  await reconcileStaleRuns(AUTOMATION_RUN_TIMEOUT_MS, now);

  const automations = await getAllAutomations();
  const result: ScanDueAutomationsResult = {
    checkedAt: now,
    scanned: automations.length,
    initialized: 0,
    due: 0,
    started: 0,
    locked: 0,
    failed: 0,
  };

  for (const automation of automations) {
    if (!isSchedulableAutomation(automation)) continue;

    if (automation.nextRunAt == null) {
      await refreshAutomationNextRunAt(automation.id, now);
      result.initialized++;
      continue;
    }

    if (automation.nextRunAt > now) continue;

    result.due++;
    const run = await runAutomation({
      automationId: automation.id,
      trigger: 'schedule',
      scheduledFor: automation.nextRunAt,
      now,
      executor,
    });

    if (run == null) {
      result.locked++;
    } else if (run.status === 'failed' || run.status === 'timeout') {
      result.started++;
      result.failed++;
    } else {
      result.started++;
    }
  }

  return result;
}

export async function refreshAutomationNextRunAt(
  automationId: AutomationId,
  now: number = Date.now(),
): Promise<Automation | null> {
  const automation = await getAutomationById(automationId);
  if (!automation) return null;

  if (!isSchedulableAutomation(automation)) {
    return updateAutomationRuntime(automation.id, { nextRunAt: null });
  }

  const next = calculateNextRunAt(automation.schedule, now);
  if (!next.ok) {
    return updateAutomationRuntime(automation.id, {
      nextRunAt: null,
      lastError: toAutomationError(next.error.code, next.error.message, 'schedule', false, now),
    });
  }

  return updateAutomationRuntime(automation.id, {
    nextRunAt: next.value,
    lastError: null,
  });
}

export async function runAutomation(options: RunAutomationOptions): Promise<AutomationRun | null> {
  const automation = await getAutomationById(options.automationId);
  if (!automation) return null;

  if (activeRunLocks.has(automation.id)) return null;

  activeRunLocks.add(automation.id);
  try {
    const now = options.now ?? Date.now();
    const runId = crypto.randomUUID();
    const preflight = await prepareAutomationRunPreflight(automation, now);
    const workingAutomation = preflight.automation;
    const request: AutomationRunnerRequest = {
      runId,
      automationId: workingAutomation.id,
      prompt: workingAutomation.prompt,
      trigger: options.trigger,
      chatSessionId: workingAutomation.deepseek.chatSessionId,
      parentMessageId: workingAutomation.deepseek.parentMessageId,
      promptOptions: workingAutomation.promptOptions,
      preflight: preflight.summary,
      requestedAt: now,
    };

    const run = await createAutomationRun({
      id: runId,
      automationId: workingAutomation.id,
      trigger: options.trigger,
      scheduledFor: options.scheduledFor,
      request,
    });

    if (preflight.blockingError) {
      const skippedRun = await updateAutomationRun(run.id, {
        status: 'skipped',
        error: preflight.blockingError,
        result: null,
        startedAt: now,
        completedAt: now,
      });
      await refreshAutomationAfterPreflightSkip(workingAutomation, preflight.blockingError, options.trigger, now);
      return skippedRun ?? {
        ...run,
        status: 'skipped',
        error: preflight.blockingError,
        startedAt: now,
        completedAt: now,
        updatedAt: Date.now(),
      };
    }

    await updateAutomationRun(run.id, {
      status: 'running',
      startedAt: Date.now(),
    });

    const runnerResult = await executeWithRetry(run, request, options.executor);
    const completedRun = await completeRun(workingAutomation, run, runnerResult);
    await refreshAutomationAfterRun(workingAutomation, runnerResult, options.trigger);
    return completedRun;
  } finally {
    activeRunLocks.delete(automation.id);
  }
}

export function hasActiveAutomationRun(automationId: AutomationId): boolean {
  return activeRunLocks.has(automationId);
}

async function completeRun(
  automation: Automation,
  run: AutomationRun,
  result: AutomationRunnerResult,
): Promise<AutomationRun> {
  const status = result.ok
    ? 'succeeded'
    : result.error.code === 'automation_run_timeout'
      ? 'timeout'
      : 'failed';
  const updated = await updateAutomationRun(run.id, {
    status,
    result,
    error: result.ok ? null : result.error,
    completedAt: result.completedAt,
  });

  return updated ?? {
    ...run,
    automationId: automation.id,
    status,
    result,
    error: result.ok ? null : result.error,
    completedAt: result.completedAt,
    updatedAt: Date.now(),
  };
}

async function executeWithRetry(
  run: AutomationRun,
  request: AutomationRunnerRequest,
  executor: AutomationRunExecutor,
): Promise<AutomationRunnerResult> {
  let lastResult: AutomationRunnerResult | null = null;
  const deadline = Date.now() + AUTOMATION_RUN_TIMEOUT_MS;

  for (let attempt = 1; attempt <= AUTOMATION_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await updateAutomationRun(run.id, {
        attempt,
        trigger: 'retry',
      });
      await delay(Math.min(AUTOMATION_RETRY_DELAY_MS, Math.max(0, deadline - Date.now())));
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return createRunTimeoutFailure(request, AUTOMATION_RUN_TIMEOUT_MS, false);

    const result = await withRunTimeout(executor(request), request, remainingMs);
    lastResult = result;

    if (result.ok || !result.error.retryable || attempt === AUTOMATION_MAX_ATTEMPTS) {
      return result;
    }

    await updateAutomationRun(run.id, {
      attempt,
      error: result.error,
      result,
    });
  }

  return lastResult ?? createRunTimeoutFailure(request, AUTOMATION_RUN_TIMEOUT_MS, false);
}

function withRunTimeout(
  task: Promise<AutomationRunnerResult>,
  request: AutomationRunnerRequest,
  timeoutMs: number,
): Promise<AutomationRunnerResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(createRunTimeoutFailure(request, timeoutMs, false));
    }, timeoutMs);

    task
      .then(resolve)
      .catch((err) => {
        resolve({
          ok: false,
          chatSessionId: request.chatSessionId,
          parentMessageId: request.parentMessageId,
          completedAt: Date.now(),
          error: toAutomationError(
            'automation_executor_failed',
            err instanceof Error ? err.message : String(err),
            'runner',
            true,
            Date.now(),
          ),
        });
      })
      .finally(() => clearTimeout(timeout));
  });
}

function createRunTimeoutFailure(
  request: AutomationRunnerRequest,
  timeoutMs: number,
  retryable: boolean,
): AutomationRunnerResult {
  const now = Date.now();
  return {
    ok: false,
    chatSessionId: request.chatSessionId,
    parentMessageId: request.parentMessageId,
    completedAt: now,
    error: toAutomationError(
      'automation_run_timeout',
      `Automation run exceeded ${Math.round(timeoutMs / 1000)} seconds.`,
      'runner',
      retryable,
      now,
      { timeoutMs },
    ),
  };
}

async function refreshAutomationAfterRun(
  automation: Automation,
  result: AutomationRunnerResult,
  trigger: AutomationTrigger,
): Promise<void> {
  const latestAutomation = await getAutomationById(automation.id);
  if (!latestAutomation) return;

  const completedAt = result.completedAt;
  const nextRunAt = trigger === 'schedule'
    ? nextRunAfterCompletion(latestAutomation, completedAt)
    : latestAutomation.nextRunAt;

  if (result.ok) {
    await updateAutomationRuntime(latestAutomation.id, {
      deepseek: {
        ...latestAutomation.deepseek,
        chatSessionId: result.chatSessionId,
        parentMessageId: result.parentMessageId,
        sessionUrl: result.sessionUrl,
        lastHistorySyncedAt: result.history?.verifiedAt ?? latestAutomation.deepseek.lastHistorySyncedAt,
      },
      lastRunAt: completedAt,
      nextRunAt,
      lastError: null,
    });
    return;
  }

  await updateAutomationRuntime(latestAutomation.id, {
    lastRunAt: completedAt,
    nextRunAt,
    lastError: result.error,
  });
}

async function refreshAutomationAfterPreflightSkip(
  automation: Automation,
  error: AutomationErrorState,
  trigger: AutomationTrigger,
  completedAt: number,
): Promise<void> {
  const latestAutomation = await getAutomationById(automation.id);
  if (!latestAutomation) return;
  await updateAutomationRuntime(latestAutomation.id, {
    lastRunAt: completedAt,
    nextRunAt: trigger === 'schedule'
      ? nextRunAfterCompletion(latestAutomation, completedAt)
      : latestAutomation.nextRunAt,
    lastError: error,
  });
}

async function prepareAutomationRunPreflight(
  automation: Automation,
  now: number,
): Promise<{
  automation: Automation;
  summary: AutomationRunPreflight;
  blockingError: AutomationErrorState | null;
}> {
  let workingAutomation = automation;
  let report = evaluateAutomationReadiness(workingAutomation);
  const autoFixedIssueCodes = getSafeAutomationReadinessFixes(report);

  if (autoFixedIssueCodes.length > 0) {
    const promptOptions = applySafeAutomationReadinessFixes(workingAutomation.promptOptions, autoFixedIssueCodes);
    const updated = await updateAutomation(workingAutomation.id, { promptOptions });
    workingAutomation = updated ?? { ...workingAutomation, promptOptions };
    report = evaluateAutomationReadiness(workingAutomation);
  }

  const blockingIssueCodes = getBlockingIssueCodes(report);
  const summary = createAutomationRunPreflight(report, autoFixedIssueCodes, blockingIssueCodes, now);
  const blockingError = blockingIssueCodes.length > 0
    ? toAutomationError(
      'automation_readiness_blocked',
      `Automation readiness preflight blocked this run: ${blockingIssueCodes.join(', ')}.`,
      'runner',
      false,
      now,
      {
        grade: summary.grade,
        score: summary.score,
        issueCodes: summary.issueCodes,
        blockingIssueCodes: summary.blockingIssueCodes,
        autoFixedIssueCodes: summary.autoFixedIssueCodes,
      },
    )
    : null;

  return { automation: workingAutomation, summary, blockingError };
}

function getBlockingIssueCodes(report: AutomationReadinessReport): AutomationReadinessIssueCode[] {
  return report.issues
    .filter((issue) => issue.severity === 'blocker')
    .map((issue) => issue.code);
}

function createAutomationRunPreflight(
  report: AutomationReadinessReport,
  autoFixedIssueCodes: readonly AutomationReadinessIssueCode[],
  blockingIssueCodes: readonly AutomationReadinessIssueCode[],
  checkedAt: number,
): AutomationRunPreflight {
  return {
    schemaVersion: 1,
    checkedAt,
    grade: report.grade,
    score: report.score,
    status: report.status,
    issueCodes: report.issues.map((issue) => issue.code),
    blockingIssueCodes: [...blockingIssueCodes],
    autoFixedIssueCodes: [...autoFixedIssueCodes],
  };
}

function nextRunAfterCompletion(automation: Automation, completedAt: number): number | null {
  if (!isSchedulableAutomation(automation)) return null;
  const next = calculateNextRunAt(automation.schedule, completedAt);
  return next.ok ? next.value : null;
}

function isSchedulableAutomation(automation: Automation): boolean {
  return (
    automation.status === 'active' &&
    automation.schedule.enabled &&
    automation.schedule.kind !== 'manual'
  );
}

function toAutomationError(
  code: string,
  message: string,
  phase: AutomationErrorState['phase'],
  retryable: boolean,
  at: number,
  details?: Record<string, unknown>,
): AutomationErrorState {
  return {
    code,
    message,
    phase,
    retryable,
    at,
    details,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
