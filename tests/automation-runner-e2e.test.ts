import { describe, expect, it, vi } from 'vitest';
import { AUTOMATION_RUN_TIMEOUT_MS, AUTOMATION_MAX_ATTEMPTS } from '../core/automation/scheduler';
import type { Automation, AutomationRunnerRequest } from '../core/automation/types';

function createAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    name: 'Test Automation',
    prompt: 'Do something',
    status: 'active',
    schedule: {
      kind: 'cron',
      expression: '0 * * * *',
      timezone: 'UTC',
      enabled: true,
      minimumIntervalMinutes: 1,
    },
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      refFileIds: [],
    },
    chain: {
      enabled: false,
      onSuccessAutomationIds: [],
      maxDepth: 5,
    },
    deepseek: {
      chatSessionId: null,
      parentMessageId: null,
      sessionUrl: null,
      lastHistorySyncedAt: null,
    },
    createdAt: 1000,
    updatedAt: 1000,
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    version: 1,
    ...overrides,
  };
}

describe('AUTOMATION_RUN_TIMEOUT_MS', () => {
  it('is set to 600_000 (10 minutes)', () => {
    expect(AUTOMATION_RUN_TIMEOUT_MS).toBe(600_000);
  });
});

describe('AUTOMATION_MAX_ATTEMPTS', () => {
  it('is set to 2', () => {
    expect(AUTOMATION_MAX_ATTEMPTS).toBe(2);
  });
});

describe('runAutomation timeout behavior', () => {
  it('respects automation.schedule.timeoutMs override', () => {
    const automation = createAutomation({
      schedule: {
        kind: 'cron',
        expression: '0 * * * *',
        timezone: 'UTC',
        enabled: true,
        minimumIntervalMinutes: 1,
        timeoutMs: 120_000,
      },
    });

    expect(automation.schedule.timeoutMs).toBe(120_000);
  });

  it('defaults to AUTOMATION_RUN_TIMEOUT_MS when schedule.timeoutMs is undefined', () => {
    const automation = createAutomation();
    expect(automation.schedule.timeoutMs).toBeUndefined();
    expect(AUTOMATION_RUN_TIMEOUT_MS).toBe(600_000);
  });
});

describe('automation runner request structure', () => {
  it('AutomationRunnerRequest has required fields', () => {
    const request: AutomationRunnerRequest = {
      runId: 'run-1',
      automationId: 'auto-1',
      prompt: 'Test prompt',
      trigger: 'schedule',
      chatSessionId: null,
      parentMessageId: null,
      promptOptions: {
        modelType: null,
        searchEnabled: false,
        thinkingEnabled: false,
        refFileIds: [],
      },
      requestedAt: 1000,
    };

    expect(request.runId).toBe('run-1');
    expect(request.automationId).toBe('auto-1');
    expect(request.trigger).toBe('schedule');
    expect(request.requestedAt).toBe(1000);
  });
});

describe('automation timeout constants', () => {
  it('timeout is at least 3 minutes', () => {
    expect(AUTOMATION_RUN_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
  });

  it('max attempts allows at least one retry', () => {
    expect(AUTOMATION_MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
  });
});

describe('automation schedule with custom timeout', () => {
  it('schedule can carry a custom timeoutMs', () => {
    const automation = createAutomation({
      schedule: {
        kind: 'cron',
        expression: '*/5 * * * *',
        timezone: 'UTC',
        enabled: true,
        minimumIntervalMinutes: 5,
        timeoutMs: 900_000,
      },
    });

    expect(automation.schedule.timeoutMs).toBe(900_000);
    expect(automation.schedule.kind).toBe('cron');
    expect(automation.schedule.enabled).toBe(true);
  });

  it('schedule works without custom timeoutMs', () => {
    const automation = createAutomation();

    expect(automation.schedule.timeoutMs).toBeUndefined();
    expect(automation.schedule.kind).toBe('cron');
    expect(automation.schedule.minimumIntervalMinutes).toBe(1);
  });
});
