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
    expect(container.textContent).not.toContain('就绪评分');
    const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="switch"]'));
    expect(switches[0].disabled).toBe(true);
    expect(switches[0].getAttribute('aria-checked')).toBe('false');
    expect(switches[1].disabled).toBe(true);
    expect(switches[1].getAttribute('aria-checked')).toBe('false');
    expect(container.textContent).toContain('DeepSeek Web Vision 使用图片路由');
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

  it('applies safe automation readiness fixes before saving', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTOMATIONS') return [];
      if (message.type === 'CREATE_AUTOMATION') return {
        id: 'automation-safe-fix',
        ...(message.payload as Record<string, unknown>),
        status: 'active',
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
    await toggleVisualMonitor();
    await enterText('任务名称', 'Research review');
    await enterText(
      '输入要定时发送到 DeepSeek 的内容',
      'Research this source, evaluate evidence, review contradictions, grade confidence, iterate once, then stop.',
    );

    expect(container.textContent).toContain('研究或监控 Prompt 应开启联网。');
    expect(container.textContent).toContain('评估循环应开启深度思考。');

    await clickButton('应用安全修正');
    await clickButton('创建');
    await flushEffects();

    const createCall = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is {
        type: 'CREATE_AUTOMATION';
        payload: {
          promptOptions: {
            searchEnabled: boolean;
            thinkingEnabled: boolean;
          };
        };
      } => message.type === 'CREATE_AUTOMATION');

    expect(createCall?.payload.promptOptions.searchEnabled).toBe(true);
    expect(createCall?.payload.promptOptions.thinkingEnabled).toBe(true);
    expect(JSON.stringify(createCall?.payload)).not.toMatch(/data:image|dataBase64|blob:|Authorization|Bearer|Cookie|secret-token/);
  });

  it('auto-applies safe automation readiness fixes on save', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTOMATIONS') return [];
      if (message.type === 'CREATE_AUTOMATION') return {
        id: 'automation-auto-safe-fix',
        ...(message.payload as Record<string, unknown>),
        status: 'active',
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
    await toggleVisualMonitor();
    await enterText('任务名称', 'Auto fixed research');
    await enterText(
      '输入要定时发送到 DeepSeek 的内容',
      'Research this source, evaluate evidence, review contradictions, grade confidence, iterate once, then stop.',
    );

    await clickButton('创建');
    await flushEffects();

    const createCall = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is {
        type: 'CREATE_AUTOMATION';
        payload: {
          promptOptions: {
            searchEnabled: boolean;
            thinkingEnabled: boolean;
          };
        };
      } => message.type === 'CREATE_AUTOMATION');

    expect(createCall?.payload.promptOptions.searchEnabled).toBe(true);
    expect(createCall?.payload.promptOptions.thinkingEnabled).toBe(true);
    expect(JSON.stringify(createCall?.payload)).not.toMatch(/data:image|dataBase64|blob:|Authorization|Bearer|Cookie|secret-token/);
  });

  it('blocks unsafe automation prompts before saving', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTOMATIONS') return [];
      if (message.type === 'CREATE_AUTOMATION') return {
        id: 'should-not-create',
        ...(message.payload as Record<string, unknown>),
      };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();
    await clickButton('新建');
    await enterText('任务名称', 'Unsafe automation');
    await enterText(
      '输入要定时发送到 DeepSeek 的内容',
      'Use Authorization: Bearer secret-token and data:image/png;base64,AAAA, then stop.',
    );

    await clickButton('创建');
    await flushEffects();

    expect(sendMessage.mock.calls.some(([message]) => message.type === 'CREATE_AUTOMATION')).toBe(false);
    expect(container.textContent).toContain('移除内联密钥、Cookie、Token、签名链接或原始媒体。');
    expect(JSON.stringify(sendMessage.mock.calls)).not.toMatch(/Bearer|secret-token|data:image|AAAA/);
  });

  it('adds an automation loop contract before saving weak workflow prompts', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTOMATIONS') return [];
      if (message.type === 'CREATE_AUTOMATION') return {
        id: 'automation-loop-contract',
        ...(message.payload as Record<string, unknown>),
        status: 'active',
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
    await enterText('任务名称', 'Weak workflow');
    await enterText('输入要定时发送到 DeepSeek 的内容', 'Run a workflow that evaluates the source.');

    expect(container.textContent).toContain('补强规划、评估、复查、评分、迭代和停止循环。');

    await clickButton('补强循环');
    await clickButton('创建');
    await flushEffects();

    const createCall = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is {
        type: 'CREATE_AUTOMATION';
        payload: { prompt: string };
      } => message.type === 'CREATE_AUTOMATION');

    expect(createCall?.payload.prompt).toContain('Workflow contract: Plan the work, evaluate evidence, review risks, grade confidence, iterate once if useful, then stop');
    expect(createCall?.payload.prompt).toContain('Do not take irreversible actions without explicit confirmation.');
    expect(JSON.stringify(createCall?.payload)).not.toMatch(/data:image|dataBase64|blob:|Authorization|Bearer|Cookie|secret-token|[0-9]{6,}:[A-Za-z0-9_-]{24,}/);
  });

  it('prepares weak research automations with one readiness action', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTOMATIONS') return [];
      if (message.type === 'CREATE_AUTOMATION') return {
        id: 'automation-prepare-run',
        ...(message.payload as Record<string, unknown>),
        status: 'active',
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
    await toggleVisualMonitor();
    await enterText('任务名称', 'Prepared workflow');
    await enterText('输入要定时发送到 DeepSeek 的内容', 'Run a workflow to research this source and evaluate it.');

    expect(container.textContent).toContain('研究或监控 Prompt 应开启联网。');
    expect(container.textContent).toContain('评估循环应开启深度思考。');
    expect(container.textContent).toContain('补强规划、评估、复查、评分、迭代和停止循环。');

    await clickButton('准备运行');
    await clickButton('创建');
    await flushEffects();

    const createCall = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is {
        type: 'CREATE_AUTOMATION';
        payload: {
          prompt: string;
          promptOptions: {
            searchEnabled: boolean;
            thinkingEnabled: boolean;
          };
        };
      } => message.type === 'CREATE_AUTOMATION');

    expect(createCall?.payload.prompt).toContain('Workflow contract: Plan the work, evaluate evidence, review risks, grade confidence, iterate once if useful, then stop');
    expect(createCall?.payload.promptOptions.searchEnabled).toBe(true);
    expect(createCall?.payload.promptOptions.thinkingEnabled).toBe(true);
    expect(JSON.stringify(createCall?.payload)).not.toMatch(/data:image|dataBase64|blob:|Authorization|Bearer|Cookie|secret-token|[0-9]{6,}:[A-Za-z0-9_-]{24,}/);
  });

  it('explains and enforces Vision mode search and thinking limits before saving', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTOMATIONS') return [];
      if (message.type === 'CREATE_AUTOMATION') return {
        id: 'automation-vision',
        ...(message.payload as Record<string, unknown>),
        status: 'active',
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
    await enterText('任务名称', 'Vision check');
    await enterText('输入要定时发送到 DeepSeek 的内容', 'Look at the attached visual context and stop.');
    await clickButton('联网');
    await clickButton('深度思考');

    const modelSelect = container.querySelector('select');
    expect(modelSelect).toBeTruthy();
    await act(async () => {
      setSelectValue(modelSelect as HTMLSelectElement, 'vision');
      modelSelect?.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.textContent).toContain('DeepSeek Web Vision 使用图片路由');
    const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="switch"]'));
    expect(switches[0].disabled).toBe(true);
    expect(switches[0].getAttribute('aria-checked')).toBe('false');
    expect(switches[1].disabled).toBe(true);
    expect(switches[1].getAttribute('aria-checked')).toBe('false');

    await clickButton('创建');
    await flushEffects();

    const createCall = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is {
        type: 'CREATE_AUTOMATION';
        payload: {
          promptOptions: {
            modelType: string | null;
            searchEnabled: boolean;
            thinkingEnabled: boolean;
          };
        };
      } => message.type === 'CREATE_AUTOMATION');

    expect(createCall?.payload.promptOptions.modelType).toBe('vision');
    expect(createCall?.payload.promptOptions.searchEnabled).toBe(false);
    expect(createCall?.payload.promptOptions.thinkingEnabled).toBe(false);
    expect(JSON.stringify(createCall?.payload)).not.toMatch(/data:image|dataBase64|blob:|Authorization|Bearer|Cookie|secret-token/);
  });

  it('creates an automation from a workflow template while preserving user edits', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTOMATIONS') return [];
      if (message.type === 'CREATE_AUTOMATION') return {
        id: 'automation-template-1',
        ...(message.payload as Record<string, unknown>),
        status: 'active',
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
    expect(container.textContent).toContain('运行就绪恢复');
    expect(container.textContent).not.toContain('Runtime Readiness Recovery');

    await clickButton('使用');
    expect(Array.from(container.querySelectorAll('button')).filter((button) => button.textContent === '使用')).toHaveLength(0);
    expect(inputByPlaceholder('任务名称').value).toBe('运行就绪恢复');
    expect(inputByPlaceholder('输入要定时发送到 DeepSeek 的内容').value).toContain('规划就绪检查');
    expect(container.textContent).toContain('就绪评分');
    expect(container.textContent).toContain('A · 100');
    expect(container.textContent).toContain('可以运行。');

    await enterText('任务名称', 'My readiness check');
    await enterText('输入要定时发送到 DeepSeek 的内容', 'Check my active setup and tell me exactly what needs attention.');
    await clickButton('创建');
    await flushEffects();

    const createCall = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is {
        type: 'CREATE_AUTOMATION';
        payload: {
          name: string;
          prompt: string;
          schedule: Record<string, unknown>;
          promptOptions: Record<string, unknown>;
        };
      } => message.type === 'CREATE_AUTOMATION');

    expect(createCall?.payload.name).toBe('My readiness check');
    expect(createCall?.payload.prompt).toBe('Check my active setup and tell me exactly what needs attention.');
    expect(createCall?.payload.schedule).toMatchObject({
      kind: 'manual',
      expression: null,
      enabled: false,
    });
    expect(createCall?.payload.promptOptions).toMatchObject({
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      refFileIds: [],
      visualMonitor: {
        enabled: true,
        source: 'browser_control_target',
        includeEvidencePack: true,
      },
    });
    expect(JSON.stringify(createCall?.payload)).not.toMatch(/data:image|dataBase64|blob:|Authorization|Bearer|Cookie/);
  });

  it('filters automation workflow templates by category', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTOMATIONS') return [];
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();

    expect(container.textContent).toContain('实现委员会');
    expect(container.textContent).toContain('来源监控');

    await clickButton('项目');
    expect(container.textContent).toContain('实现委员会');
    expect(container.textContent).toContain('项目状态委员会');
    expect(container.textContent).not.toContain('来源监控');

    await clickButton('质量');
    expect(container.textContent).toContain('系统调试循环');
    expect(container.textContent).toContain('评审评分迭代');
    expect(container.textContent).not.toContain('实现委员会');

    await clickButton('全部');
    expect(container.textContent).toContain('实现委员会');
    expect(container.textContent).toContain('来源监控');
  });

  it('shows preflight fixed and skipped run explanations without sensitive values', async () => {
    const fixedAutomation = createAutomationForPage({
      id: 'automation-fixed',
      name: 'Research review',
      prompt: 'Research this source and grade confidence.',
    });
    const skippedAutomation = createAutomationForPage({
      id: 'automation-skipped',
      name: 'Blocked check',
      prompt: 'Blocked preflight check.',
      lastError: {
        code: 'automation_readiness_blocked',
        message: 'Automation readiness preflight blocked this run: sensitive_prompt_content.',
        phase: 'runner',
        retryable: false,
        at: 2,
      },
    });
    const runsByAutomationId = {
      'automation-fixed': [createAutomationRunForPage({
        id: 'run-fixed',
        automationId: 'automation-fixed',
        status: 'succeeded',
        preflight: {
          schemaVersion: 1,
          checkedAt: 1,
          grade: 'A',
          score: 100,
          status: 'ready',
          issueCodes: [],
          blockingIssueCodes: [],
          autoFixedIssueCodes: ['research_without_search', 'evaluation_without_thinking'],
        },
      })],
      'automation-skipped': [createAutomationRunForPage({
        id: 'run-skipped',
        automationId: 'automation-skipped',
        status: 'skipped',
        error: {
          code: 'automation_readiness_blocked',
          message: 'Automation readiness preflight blocked this run: sensitive_prompt_content.',
          phase: 'runner',
          retryable: false,
          at: 2,
        },
        preflight: {
          schemaVersion: 1,
          checkedAt: 1,
          grade: 'F',
          score: 65,
          status: 'blocked',
          issueCodes: ['sensitive_prompt_content'],
          blockingIssueCodes: ['sensitive_prompt_content'],
          autoFixedIssueCodes: [],
        },
      })],
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: { automationId?: string } }) => {
      if (message.type === 'GET_AUTOMATIONS') return [fixedAutomation, skippedAutomation];
      if (message.type === 'GET_AUTOMATION_RUNS') {
        return runsByAutomationId[message.payload?.automationId as keyof typeof runsByAutomationId] ?? [];
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();

    expect(container.textContent).toContain('预检已修正选项');
    expect(container.textContent).toContain('已开启联网。');
    expect(container.textContent).toContain('已开启深度思考。');
    expect(container.textContent).toContain('预检已跳过运行');
    expect(container.textContent).toContain('移除内联密钥、Cookie、Token、签名链接或原始媒体。');
    expect(container.textContent).not.toMatch(/sk-proj|secret-token|Authorization|Bearer|Cookie:|data:image/);
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

async function toggleVisualMonitor() {
  const button = container.querySelector<HTMLButtonElement>('button.ds-switch');
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

function createAutomationForPage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'automation-1',
    name: 'Automation',
    prompt: 'Check status.',
    status: 'active',
    schedule: { kind: 'manual', expression: null, timezone: 'UTC', enabled: false, minimumIntervalMinutes: 15 },
    promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
    deepseek: { chatSessionId: null, parentMessageId: null, sessionUrl: null, lastHistorySyncedAt: null },
    createdAt: 1,
    updatedAt: 1,
    lastRunAt: 1,
    nextRunAt: null,
    lastError: null,
    version: 1,
    ...overrides,
  };
}

function createAutomationRunForPage(overrides: Record<string, unknown> = {}) {
  const { preflight: requestPreflight, ...runOverrides } = overrides;
  const runId = typeof runOverrides.id === 'string' ? runOverrides.id : 'run-1';
  const automationId = typeof runOverrides.automationId === 'string' ? runOverrides.automationId : 'automation-1';
  return {
    id: runId,
    automationId,
    trigger: 'manual',
    status: 'succeeded',
    scheduledFor: null,
    attempt: 1,
    request: {
      runId,
      automationId,
      prompt: 'Check status.',
      trigger: 'manual',
      chatSessionId: null,
      parentMessageId: null,
      promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
      preflight: requestPreflight,
      requestedAt: 1,
    },
    result: null,
    error: null,
    flightRecorder: null,
    createdAt: 1,
    startedAt: 1,
    completedAt: 2,
    updatedAt: 2,
    ...runOverrides,
  };
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
    autopilot: {
      inFlightSource: null,
      latestRun: null,
      recentRuns: [],
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
    leakQuarantine: {
      issueCount: 0,
      cleanupEligibleCount: 0,
      groups: [],
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
