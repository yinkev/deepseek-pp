import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAutomationById, getAutomationRunById, createAutomation } from '../core/automation/store';
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

describe('automation runtime preflight', () => {
  it('safely fixes search/thinking prompt options before executing a research review automation', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    stubRuntime();

    const automation = await createAutomation({
      name: 'Research review',
      prompt: 'Research this source, evaluate the evidence, review contradictions, grade confidence, iterate once, then stop.',
      schedule: { kind: 'manual', expression: null, timezone: 'UTC', enabled: false, minimumIntervalMinutes: 15 },
      promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
    });
    const executor = vi.fn(async (request: AutomationRunnerRequest): Promise<AutomationRunnerResult> => {
      expect(request.promptOptions.searchEnabled).toBe(true);
      expect(request.promptOptions.thinkingEnabled).toBe(true);
      expect(request.preflight).toMatchObject({
        status: 'ready',
        autoFixedIssueCodes: ['research_without_search', 'evaluation_without_thinking'],
        blockingIssueCodes: [],
      });
      return {
        ok: true,
        chatSessionId: 'session-1',
        sessionUrl: null,
        parentMessageId: 10,
        assistantMessageId: 10,
        assistantText: 'Done.',
        history: null,
        completedAt: 123,
      };
    });

    const run = await runAutomation({
      automationId: automation.id,
      trigger: 'manual',
      scheduledFor: null,
      now: 1,
      executor,
    });

    expect(run?.status).toBe('succeeded');
    expect(executor).toHaveBeenCalledTimes(1);
    const updatedAutomation = await getAutomationById(automation.id);
    expect(updatedAutomation?.promptOptions.searchEnabled).toBe(true);
    expect(updatedAutomation?.promptOptions.thinkingEnabled).toBe(true);
    const storedRun = await getAutomationRunById(run!.id);
    expect(storedRun?.request?.preflight?.autoFixedIssueCodes).toEqual([
      'research_without_search',
      'evaluation_without_thinking',
    ]);
  });

  it('skips blocked automations without invoking the executor or storing sensitive run prompt content', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    stubRuntime();

    const automation = await createAutomation({
      name: 'Unsafe',
      prompt: 'Use sk-proj-1234567890abcdef1234567890abcdef to check the account.',
      schedule: { kind: 'manual', expression: null, timezone: 'UTC', enabled: false, minimumIntervalMinutes: 15 },
      promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
    });
    const executor = vi.fn(async (): Promise<AutomationRunnerResult> => {
      throw new Error('executor should not run');
    });

    const run = await runAutomation({
      automationId: automation.id,
      trigger: 'manual',
      scheduledFor: null,
      now: 1,
      executor,
    });

    expect(run?.status).toBe('skipped');
    expect(executor).not.toHaveBeenCalled();
    expect(run?.error).toMatchObject({
      code: 'automation_readiness_blocked',
      phase: 'runner',
      retryable: false,
      details: {
        issueCodes: ['sensitive_prompt_content'],
        blockingIssueCodes: ['sensitive_prompt_content'],
      },
    });
    const storedRun = await getAutomationRunById(run!.id);
    const storedRunJson = JSON.stringify(storedRun);
    expect(storedRun?.request?.preflight).toMatchObject({
      status: 'blocked',
      blockingIssueCodes: ['sensitive_prompt_content'],
      autoFixedIssueCodes: [],
    });
    expect(storedRunJson).not.toMatch(/sk-proj|1234567890abcdef/);
    expect(storedRunJson).toContain('[redacted:secret]');
    const updatedAutomation = await getAutomationById(automation.id);
    expect(updatedAutomation?.lastError?.code).toBe('automation_readiness_blocked');
  });

  it('normalizes inconsistent Vision flags even when missing visual input still blocks the run', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    stubRuntime();

    const automation = await createAutomation({
      name: 'Vision check',
      prompt: 'Look at the current page and stop.',
      schedule: { kind: 'manual', expression: null, timezone: 'UTC', enabled: false, minimumIntervalMinutes: 15 },
      promptOptions: { modelType: 'vision', searchEnabled: true, thinkingEnabled: true, refFileIds: [] },
    });

    const run = await runAutomation({
      automationId: automation.id,
      trigger: 'manual',
      scheduledFor: null,
      now: 1,
      executor: vi.fn(async () => {
        throw new Error('executor should not run');
      }),
    });

    expect(run?.status).toBe('skipped');
    expect(run?.request?.preflight?.autoFixedIssueCodes).toEqual(['vision_flags_inconsistent']);
    expect(run?.request?.preflight?.blockingIssueCodes).toEqual(['vision_without_visual_input']);
    const updatedAutomation = await getAutomationById(automation.id);
    expect(updatedAutomation?.promptOptions.searchEnabled).toBe(false);
    expect(updatedAutomation?.promptOptions.thinkingEnabled).toBe(false);
  });
});
