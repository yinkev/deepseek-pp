import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutomation, getAutomationRuns, updateAutomation } from '../core/automation/store';
import { runAutomation } from '../core/automation/scheduler';
import type { AutomationRunnerRequest, AutomationRunnerResult } from '../core/automation/types';

function createChromeStub() {
  const storage = new Map<string, unknown>();
  return {
    storage,
    chromeStub: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
          set: vi.fn(async (value: Record<string, unknown>) => {
            for (const [key, storedValue] of Object.entries(value)) storage.set(key, storedValue);
          }),
        },
      },
    },
  };
}

function stubRuntime() {
  let id = 0;
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => {
      id += 1;
      return `id-${id}`;
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('automation chained run queue', () => {
  it('runs selected follow-up automations after a successful source run', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    stubRuntime();

    const followUp = await createAutomation({
      name: 'Review',
      prompt: 'Review the result, grade it, iterate once, then stop.',
      schedule: { kind: 'manual', expression: null, timezone: 'UTC', enabled: false, minimumIntervalMinutes: 15 },
      promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: true, refFileIds: [] },
    });
    const source = await createAutomation({
      name: 'Research',
      prompt: 'Research the topic, evaluate sources, review contradictions, grade confidence, iterate once, then stop.',
      schedule: { kind: 'manual', expression: null, timezone: 'UTC', enabled: false, minimumIntervalMinutes: 15 },
      promptOptions: { modelType: null, searchEnabled: true, thinkingEnabled: true, refFileIds: [] },
      chain: { enabled: true, onSuccessAutomationIds: [followUp.id], maxDepth: 3 },
    });
    const executor = vi.fn(async (request: AutomationRunnerRequest): Promise<AutomationRunnerResult> => ({
      ok: true,
      chatSessionId: `session-${request.automationId}`,
      sessionUrl: null,
      parentMessageId: 10,
      assistantMessageId: 10,
      assistantText: 'Done.',
      history: null,
      completedAt: request.automationId === source.id ? 100 : 200,
    }));

    const run = await runAutomation({
      automationId: source.id,
      trigger: 'manual',
      scheduledFor: null,
      now: 1,
      executor,
    });

    expect(run?.status).toBe('succeeded');
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor.mock.calls.map(([request]) => [request.automationId, request.trigger])).toEqual([
      [source.id, 'manual'],
      [followUp.id, 'chain'],
    ]);
    const followUpRuns = await getAutomationRuns({ automationId: followUp.id });
    expect(followUpRuns[0]).toMatchObject({
      trigger: 'chain',
      status: 'succeeded',
      request: {
        chain: {
          parentAutomationId: source.id,
          parentRunId: run?.id,
          depth: 1,
          visitedAutomationIds: [source.id, followUp.id],
        },
      },
    });
  });

  it('prevents chained cycles from re-running an already visited automation', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    stubRuntime();

    const first = await createAutomation({
      name: 'First',
      prompt: 'Plan, evaluate, review, grade, iterate, then stop.',
      schedule: { kind: 'manual', expression: null, timezone: 'UTC', enabled: false, minimumIntervalMinutes: 15 },
      promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: true, refFileIds: [] },
    });
    const second = await createAutomation({
      name: 'Second',
      prompt: 'Plan, evaluate, review, grade, iterate, then stop.',
      schedule: { kind: 'manual', expression: null, timezone: 'UTC', enabled: false, minimumIntervalMinutes: 15 },
      promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: true, refFileIds: [] },
      chain: { enabled: true, onSuccessAutomationIds: [first.id], maxDepth: 3 },
    });
    await updateAutomation(first.id, {
      chain: { enabled: true, onSuccessAutomationIds: [second.id], maxDepth: 3 },
    });
    const executor = vi.fn(async (request: AutomationRunnerRequest): Promise<AutomationRunnerResult> => ({
      ok: true,
      chatSessionId: `session-${request.automationId}`,
      sessionUrl: null,
      parentMessageId: 10,
      assistantMessageId: 10,
      assistantText: 'Done.',
      history: null,
      completedAt: 100,
    }));

    await runAutomation({
      automationId: first.id,
      trigger: 'manual',
      scheduledFor: null,
      now: 1,
      executor,
    });

    expect(executor.mock.calls.map(([request]) => request.automationId)).toEqual([first.id, second.id]);
  });

  it('does not run follow-ups after a failed source automation', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    stubRuntime();

    const followUp = await createAutomation({
      name: 'Review',
      prompt: 'Review, grade, iterate, then stop.',
      schedule: { kind: 'manual', expression: null, timezone: 'UTC', enabled: false, minimumIntervalMinutes: 15 },
      promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: true, refFileIds: [] },
    });
    const source = await createAutomation({
      name: 'Research',
      prompt: 'Research, evaluate, review, grade, iterate, then stop.',
      schedule: { kind: 'manual', expression: null, timezone: 'UTC', enabled: false, minimumIntervalMinutes: 15 },
      promptOptions: { modelType: null, searchEnabled: true, thinkingEnabled: true, refFileIds: [] },
      chain: { enabled: true, onSuccessAutomationIds: [followUp.id], maxDepth: 3 },
    });
    const executor = vi.fn(async (request: AutomationRunnerRequest): Promise<AutomationRunnerResult> => ({
      ok: false,
      chatSessionId: null,
      parentMessageId: null,
      completedAt: 100,
      error: {
        code: 'test_failure',
        message: 'Failed.',
        phase: 'runner',
        retryable: false,
        at: 100,
      },
    }));

    const run = await runAutomation({
      automationId: source.id,
      trigger: 'manual',
      scheduledFor: null,
      now: 1,
      executor,
    });

    expect(run?.status).toBe('failed');
    expect(executor).toHaveBeenCalledTimes(1);
    expect(await getAutomationRuns({ automationId: followUp.id })).toEqual([]);
  });
});
