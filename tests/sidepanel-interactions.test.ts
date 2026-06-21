import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROMPT_INJECTION_SETTINGS,
  type PromptInjectionSettings,
} from '../core/prompt/settings';
import PromptControlPanel from '../entrypoints/sidepanel/components/PromptControlPanel';
import AutomationPage from '../entrypoints/sidepanel/pages/AutomationPage';
import RuntimeDoctorPage from '../entrypoints/sidepanel/pages/RuntimeDoctorPage';
import SavedPage from '../entrypoints/sidepanel/pages/SavedPage';

let container: HTMLDivElement;
let root: Root | null;
let runtimeListeners: Array<(message: unknown) => void>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  runtimeListeners = [];
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
});

describe('sidepanel interactions', () => {
  it('sends a saved snippet payload when the save button is clicked', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_SAVED_ITEMS') return [];
      if (message.type === 'SAVE_SAVED_ITEM') {
        return {
          id: 'saved-1',
          syncId: 'sync-1',
          kind: 'snippet',
          title: 'Review prompt',
          content: 'Summarize this thread.',
          tags: ['prompt'],
          createdAt: 1,
          updatedAt: 1,
        };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage, { onInsertPrompt: vi.fn() }));
    await enterText('标题', 'Review prompt');
    await enterText('Prompt 片段、笔记或可复用文本', 'Summarize this thread.');
    await enterText('标签（逗号分隔）', 'prompt');
    await clickButton('保存');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SAVE_SAVED_ITEM',
      payload: {
        kind: 'snippet',
        title: 'Review prompt',
        content: 'Summarize this thread.',
        tags: ['prompt'],
      },
    });
    expect(inputByPlaceholder('标题').value).toBe('');
  });

  it('persists prompt control select changes instead of reverting to defaults', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: PromptInjectionSettings }) => {
      if (message.type === 'GET_PROMPT_INJECTION_SETTINGS') return DEFAULT_PROMPT_INJECTION_SETTINGS;
      if (message.type === 'SAVE_PROMPT_INJECTION_SETTINGS') return message.payload;
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(PromptControlPanel));
    const cadenceSelect = container.querySelector('select');
    expect(cadenceSelect).toBeInstanceOf(HTMLSelectElement);

    await act(async () => {
      setSelectValue(cadenceSelect as HTMLSelectElement, 'every_message');
      cadenceSelect?.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SAVE_PROMPT_INJECTION_SETTINGS',
      payload: {
        ...DEFAULT_PROMPT_INJECTION_SETTINGS,
        presetCadence: 'every_message',
      },
    });
    expect((cadenceSelect as HTMLSelectElement).value).toBe('every_message');
  });

  it('shows prompt control save failures and restores the previous confirmed state', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROMPT_INJECTION_SETTINGS') return DEFAULT_PROMPT_INJECTION_SETTINGS;
      if (message.type === 'SAVE_PROMPT_INJECTION_SETTINGS') {
        return { ok: false, error: 'tabs permission unavailable' };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(PromptControlPanel));
    const memoryToggle = container.querySelector('button');
    expect(memoryToggle).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      memoryToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('保存提示词设置失败：tabs permission unavailable');
    expect((memoryToggle as HTMLButtonElement).getAttribute('style')).toContain('var(--ds-blue)');
  });

  it('loads Runtime Doctor and runs explicit Web auth recovery', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_RUNTIME_DOCTOR_REPORT') return createRuntimeDoctorReport({
        hasWebAuth: false,
        webAuthRejected: true,
      });
      if (message.type === 'REFRESH_DEEPSEEK_WEB_AUTH') {
        return {
          ok: true,
          refreshed: true,
          report: createRuntimeDoctorReport({
            hasWebAuth: true,
            webAuthRejected: false,
            provider: 'deepseek-web',
          }),
        };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(RuntimeDoctorPage));
    await flushEffects();
    expect(container.textContent).toContain('运行诊断');
    expect(container.textContent).toContain('被拒绝');

    await clickButton('恢复 Web 登录');
    await flushEffects();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'REFRESH_DEEPSEEK_WEB_AUTH' });
    expect(container.textContent).toContain('已从当前 DeepSeek 标签页刷新 Web 登录状态。');
    expect(container.textContent).toContain('可用');
    expect(container.textContent).not.toMatch(/Bearer|secret|data:image/);
  });

  it('disables Runtime Doctor auth recovery while sidepanel chat is busy', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_RUNTIME_DOCTOR_REPORT') return createRuntimeDoctorReport({ chatBusy: true });
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(RuntimeDoctorPage));
    await flushEffects();

    const recoverButton = buttonByText('恢复 Web 登录');
    expect(recoverButton.disabled).toBe(true);
  });

  it('runs the personal ready check and disables duplicate clicks while pending', async () => {
    let resolveEnsure!: (value: unknown) => void;
    const ensurePromise = new Promise<unknown>((resolve) => {
      resolveEnsure = resolve;
    });
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_RUNTIME_DOCTOR_REPORT') return createRuntimeDoctorReport({
        readiness: {
          ready: false,
          status: 'needs_attention',
          blockers: ['web_auth_missing', 'browser_target_missing'],
          lastPreparedAt: null,
          preparing: false,
          targetStatus: 'missing',
          noLeak: true,
        },
      });
      if (message.type === 'RUN_PERSONAL_AUTOPILOT_REPAIR') return ensurePromise;
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(RuntimeDoctorPage));
    await flushEffects();
    expect(container.textContent).toContain('需处理');
    expect(container.textContent).toContain('Web 登录缺失');
    expect(container.textContent).toContain('目标缺失');

    await clickButton('确保就绪');
    await flushEffects();
    const ensuringButton = buttonByText('检查中...');
    expect(ensuringButton.disabled).toBe(true);
    await act(async () => {
      ensuringButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'RUN_PERSONAL_AUTOPILOT_REPAIR')).toHaveLength(1);

    resolveEnsure({
      ok: true,
      ready: true,
      report: createRuntimeDoctorReport({
        provider: 'deepseek-web',
        hasWebAuth: true,
        readiness: {
          ready: true,
          status: 'ready',
          blockers: [],
          lastPreparedAt: 123,
          preparing: false,
          targetStatus: 'ready',
          noLeak: true,
        },
      }),
    });
    await flushEffects();

    expect(container.textContent).toContain('视觉会话已就绪。');
    expect(container.textContent).toContain('就绪');
    expect(container.textContent).toContain('无泄漏');
    expect(container.textContent).not.toMatch(/Bearer|secret|data:image/);
  });

  it('repairs Web auth and retries the latest retryable automation failure', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: { id?: string } }) => {
      if (message.type === 'GET_RUNTIME_DOCTOR_REPORT') return createRuntimeDoctorReport({
        provider: 'deepseek-web',
        retryableFailure: {
          automationId: 'automation-1',
          automationName: 'Visual check',
          runId: 'run-1',
          code: 'automation_executor_failed',
          message: 'Authorization Bearer secret data:image/png;base64,AAAA',
          phase: 'runner',
          at: 123,
        },
      });
      if (message.type === 'REFRESH_DEEPSEEK_WEB_AUTH') {
        return {
          ok: true,
          refreshed: true,
          report: createRuntimeDoctorReport({ provider: 'deepseek-web' }),
        };
      }
      if (message.type === 'RUN_AUTOMATION_NOW') {
        expect(message.payload?.id).toBe('automation-1');
        return { id: 'run-2', status: 'succeeded' };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(RuntimeDoctorPage));
    await flushEffects();
    expect(container.textContent).toContain('Visual check');
    expect(container.textContent).not.toMatch(/Bearer|data:image|AAAA/);

    await clickButton('修复并重试');
    await flushEffects();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'REFRESH_DEEPSEEK_WEB_AUTH' });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'RUN_AUTOMATION_NOW',
      payload: { id: 'automation-1' },
    });
    expect(container.textContent).toContain('已刷新 Web 登录并启动自动化重试。');
  });

  it('persists the automation visual monitor option without screenshot bytes', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTOMATIONS') return [];
      if (message.type === 'CREATE_AUTOMATION') return {
        id: 'automation-1',
        name: 'Visual check',
        prompt: 'Check whether the selected page still looks healthy.',
        status: 'active',
        schedule: { kind: 'manual', expression: null, timezone: 'America/Los_Angeles', enabled: false, minimumIntervalMinutes: 15 },
        promptOptions: {},
        deepseek: { chatSessionId: null, parentMessageId: null, sessionUrl: null, lastHistorySyncedAt: null },
        createdAt: 1,
        updatedAt: 1,
        lastRunAt: null,
        nextRunAt: null,
        lastError: null,
        version: 1,
      };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();
    await clickButton('新建');
    await enterText('任务名称', 'Visual check');
    await enterText('输入要定时发送到 DeepSeek 的内容', 'Check whether the selected page still looks healthy.');
    await clickButton('创建');
    await flushEffects();

    const createCall = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is { type: 'CREATE_AUTOMATION'; payload: { promptOptions: Record<string, unknown> } } =>
        message.type === 'CREATE_AUTOMATION'
      );
    expect(createCall?.payload.promptOptions.visualMonitor).toEqual({
      enabled: true,
      source: 'browser_control_target',
      includeEvidencePack: true,
    });
    expect(JSON.stringify(createCall?.payload)).not.toMatch(/data:image|dataBase64|blob:/);
  });
});

async function renderElement(element: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function stubChrome(sendMessage: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          runtimeListeners.push(listener);
        }),
        removeListener: vi.fn((listener: (message: unknown) => void) => {
          runtimeListeners = runtimeListeners.filter((item) => item !== listener);
        }),
      },
    },
  });
}

async function enterText(placeholder: string, value: string) {
  const field = inputByPlaceholder(placeholder);
  await act(async () => {
    setTextControlValue(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function inputByPlaceholder(placeholder: string): HTMLInputElement | HTMLTextAreaElement {
  const input = container.querySelector(`input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`);
  expect(input).toBeTruthy();
  return input as HTMLInputElement | HTMLTextAreaElement;
}

function setTextControlValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(input, value);
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
}

function buttonByText(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

async function clickToggleByTitle(label: string) {
  const title = Array.from(container.querySelectorAll('div'))
    .find((candidate) => candidate.textContent === label);
  expect(title).toBeTruthy();
  const row = title?.closest('.flex');
  const button = row?.querySelector('button');
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function createRuntimeDoctorReport(overrides: Partial<{
  hasWebAuth: boolean;
  webAuthRejected: boolean;
  provider: 'deepseek-web' | 'official-api' | null;
  chatBusy: boolean;
  readiness: {
    ready: boolean;
    status: 'ready' | 'needs_attention' | 'blocked';
    blockers: Array<
      | 'chat_busy'
      | 'web_auth_missing'
      | 'web_auth_rejected'
      | 'deepseek_content_script_stale'
      | 'browser_control_disabled'
      | 'browser_target_missing'
      | 'browser_target_not_controllable'
      | 'browser_vision_capture_disabled'
      | 'act_verify_disabled'
      | 'evidence_packs_disabled'
      | 'storage_leak'
      | 'storage_scan_failed'
    >;
    lastPreparedAt: number | null;
    preparing: boolean;
    targetStatus: 'ready' | 'reacquired' | 'selected_active' | 'missing' | 'unsupported' | 'not_controllable' | null;
    noLeak: boolean;
  };
  retryableFailure: {
    automationId: string;
    automationName: string;
    runId: string | null;
    code: string;
    message: string;
    phase: string;
    at: number;
  } | null;
}> = {}) {
  return {
    ok: true,
    generatedAt: Date.now(),
    chatEnabled: true,
    chatBusy: overrides.chatBusy ?? false,
    provider: overrides.provider ?? null,
    hasApiKey: false,
    hasWebAuth: overrides.hasWebAuth ?? false,
    webAuthRejected: overrides.webAuthRejected ?? false,
    deepSeekTabCount: 1,
    sidepanelSession: {
      active: false,
      source: 'none',
      parentMessageId: null,
    },
    vision: {
      maxImagesPerTurn: 4,
      rawImagesStoredDurably: false,
    },
    browserControl: {
      enabled: true,
      targetSelected: true,
      targetLock: {
        enabled: false,
        label: null,
        origin: null,
        updatedAt: null,
      },
      visualCaptureAllowed: true,
      actVerifyEnabled: false,
      evidencePacksEnabled: true,
      debugDistillerEnabled: true,
      monitorReady: true,
    },
    contentScripts: {
      checked: true,
      totalTabs: 1,
      healthyTabs: 1,
      staleTabs: 0,
      staleTabIds: [],
    },
    automation: {
      maxAttempts: 2,
      retryableFailure: overrides.retryableFailure ?? null,
    },
    humanEval: {
      grade: 'A',
      checks: [{
        id: 'ready_loop',
        label: 'Make everything ready',
        prompt: 'Get my DeepSeek++ setup ready, then tell me plainly what still needs attention.',
        status: 'pass',
        evidence: 'DeepSeek tabs answered the content health ping.',
      }],
    },
    leakSentry: {
      ok: true,
      grade: 'A',
      issueCount: 0,
      checkedAreas: ['local', 'session'],
    },
    debugDistiller: {
      enabled: true,
      suggestions: [],
    },
    readiness: overrides.readiness ?? {
      ready: true,
      status: 'ready',
      blockers: [],
      lastPreparedAt: null,
      preparing: false,
      targetStatus: 'ready',
      noLeak: true,
    },
    failureExplanations: [],
    storage: {
      ok: true,
      issues: [],
    },
  };
}
