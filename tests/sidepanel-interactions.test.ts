import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROMPT_INJECTION_SETTINGS,
  type PromptInjectionSettings,
} from '../core/prompt/settings';
import {
  ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
  ACTIVE_CHAT_CONVERSATION_STORAGE_KEY,
} from '../core/chat/conversation-store';
import PromptControlPanel from '../entrypoints/sidepanel/components/PromptControlPanel';
import LocalSkillImportPanel from '../entrypoints/sidepanel/components/LocalSkillImportPanel';
import ScenarioManager from '../entrypoints/sidepanel/components/ScenarioManager';
import ChatPage from '../entrypoints/sidepanel/pages/ChatPage';
import SavedPage from '../entrypoints/sidepanel/pages/SavedPage';

let container: HTMLDivElement;
let root: Root | null;
let runtimeListeners: Array<(message: unknown) => void>;
let chromeStorage: Record<string, unknown>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  runtimeListeners = [];
  chromeStorage = {};
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.useRealTimers();
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

    await renderElement(React.createElement(SavedPage));
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

  it('requests insertion into the active DeepSeek chat when a saved item is clicked', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_SAVED_ITEMS') {
        return [{
          id: 'saved-1',
          syncId: 'sync-1',
          kind: 'snippet',
          title: 'Review prompt',
          content: 'Summarize this thread.',
          tags: ['prompt'],
          createdAt: 1,
          updatedAt: 1,
        }];
      }
      if (message.type === 'INSERT_SAVED_PROMPT_INTO_CHAT') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage));
    await flushPromises();
    await clickButton('插入到对话');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'INSERT_SAVED_PROMPT_INTO_CHAT',
      payload: { text: 'Summarize this thread.' },
    });
    expect(container.textContent).toContain('已插入当前 DeepSeek 对话');
  });

  it('shows insertion failures from the active DeepSeek chat route', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_SAVED_ITEMS') {
        return [{
          id: 'saved-1',
          syncId: 'sync-1',
          kind: 'snippet',
          title: 'Review prompt',
          content: 'Summarize this thread.',
          tags: [],
          createdAt: 1,
          updatedAt: 1,
        }];
      }
      if (message.type === 'INSERT_SAVED_PROMPT_INTO_CHAT') {
        return { ok: false, error: '请先在 chat.deepseek.com 登录，或刷新 DeepSeek 页面后重试。' };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage));
    await flushPromises();
    await clickButton('插入到对话');

    expect(container.textContent).toContain('插入到对话失败：请先在 chat.deepseek.com 登录，或刷新 DeepSeek 页面后重试。');
  });

  it('shows saved-item repository failures instead of rendering a fake empty state', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_SAVED_ITEMS') {
        return { ok: false, error: 'savedItems.schemaVersion is not supported' };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage));
    await flushPromises();

    expect(container.textContent)
      .toContain('保存项操作失败：savedItems.schemaVersion is not supported');
    expect(container.textContent).not.toContain('暂无保存项');
  });

  it('retains the last valid saved item when an update payload is corrupt', async () => {
    const item = {
      id: 'saved-1',
      syncId: 'sync-1',
      kind: 'snippet',
      title: 'Keep confirmed item',
      content: 'Last confirmed content.',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = vi.fn(async (message: { type: string }) => (
      message.type === 'GET_SAVED_ITEMS' ? [item] : null
    ));
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage));
    await flushPromises();
    await act(async () => {
      runtimeListeners.forEach((listener) => listener({
        type: 'SAVED_ITEMS_UPDATED',
        savedItems: [{ id: 'corrupt' }],
      }));
    });

    expect(container.textContent).toContain('Keep confirmed item');
    expect(container.textContent).toContain('savedItemsUpdate[0]');
    expect(container.textContent).not.toContain('暂无保存项');
  });

  it('does not let an older saved-item read replace a newer update event', async () => {
    let resolveInitialRead!: (value: unknown) => void;
    const initialRead = new Promise<unknown>((resolve) => {
      resolveInitialRead = resolve;
    });
    const sendMessage = vi.fn((message: { type: string }) => (
      message.type === 'GET_SAVED_ITEMS' ? initialRead : Promise.resolve(null)
    ));
    stubChrome(sendMessage);
    await renderElement(React.createElement(SavedPage));

    await act(async () => {
      runtimeListeners.forEach((listener) => listener({
        type: 'SAVED_ITEMS_UPDATED',
        savedItems: [{
          id: 'saved-new',
          syncId: 'sync-new',
          kind: 'snippet',
          title: 'Newer saved item',
          content: 'Newer content.',
          tags: [],
          createdAt: 2,
          updatedAt: 2,
        }],
      }));
    });
    expect(container.textContent).toContain('Newer saved item');

    await act(async () => {
      resolveInitialRead([{
        id: 'saved-old',
        syncId: 'sync-old',
        kind: 'snippet',
        title: 'Older saved item',
        content: 'Older content.',
        tags: [],
        createdAt: 1,
        updatedAt: 1,
      }]);
      await initialRead;
    });
    expect(container.textContent).toContain('Newer saved item');
    expect(container.textContent).not.toContain('Older saved item');
  });

  it('keeps a saved item visible when repository deletion fails', async () => {
    const item = {
      id: 'saved-1',
      syncId: 'sync-1',
      kind: 'snippet',
      title: 'Keep me',
      content: 'Do not remove this item on failure.',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_SAVED_ITEMS') return [item];
      if (message.type === 'DELETE_SAVED_ITEM') {
        return { ok: false, error: 'delete blocked' };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage));
    await flushPromises();
    await clickButtonByLabel('删除');
    await clickButton('删除');
    await flushPromises();

    expect(container.textContent).toContain('保存项操作失败：delete blocked');
    expect(container.textContent).toContain('Keep me');
  });

  it('shows scenario repository failures instead of silently loading built-ins', async () => {
    const sendMessage = vi.fn(async () => ({
      ok: false,
      error: 'scenarios.schemaVersion is not supported',
    }));
    stubChrome(sendMessage);

    await renderElement(React.createElement(ScenarioManager));
    await flushPromises();

    expect(container.textContent)
      .toContain('场景操作失败：scenarios.schemaVersion is not supported');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SCENARIOS_UPDATED',
      payload: { operation: 'get' },
    });
  });

  it('reports a committed Scenario separately when background menu refresh fails', async () => {
    let scenarios = [{
      id: 'summarize',
      label: '总结',
      template: '总结 {text}',
      builtIn: true,
      enabled: true,
    }];
    const sendMessage = vi.fn(async (message: {
      type: string;
      payload?: { operation?: string; scenario?: typeof scenarios[number] };
    }) => {
      if (message.payload?.operation === 'get') return { ok: true, scenarios };
      if (message.payload?.operation === 'save' && message.payload.scenario) {
        scenarios = [message.payload.scenario];
        return { ok: false, error: 'menu offline' };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ScenarioManager));
    await flushPromises();
    const firstToggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(firstToggle).toBeTruthy();
    await act(async () => firstToggle?.click());
    await flushPromises();

    expect(scenarios[0])
      .toMatchObject({ id: 'summarize', enabled: false });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SCENARIOS_UPDATED',
      payload: {
        operation: 'save',
        scenario: expect.objectContaining({ id: 'summarize', enabled: false }),
      },
    });
    expect(container.textContent)
      .toContain('场景已保存，但后台右键菜单刷新失败：menu offline');
    expect(container.textContent).not.toContain('场景操作失败：menu offline');
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

  it('explains that non-bundled local Skill resources remain available on demand', async () => {
    const legacyWarning = '13 local supporting file(s) were omitted.';
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type !== 'PREVIEW_LOCAL_SKILL_SOURCE') return null;
      return {
        source: {
          id: 'local:demo',
          provider: 'local',
          rootPath: '/Users/me/.codex/skills/demo',
          displayName: 'demo',
          directoryName: 'demo',
          skillPaths: ['SKILL.md'],
          importedSkillNames: ['demo'],
          importedAt: 1,
          updatedAt: 1,
          warnings: [legacyWarning],
        },
        skills: [{
          path: 'SKILL.md',
          name: 'demo',
          importName: 'demo',
          description: 'Demo Skill',
          bytes: 64000,
          bodyBytes: 6000,
          includedFiles: Array.from({ length: 16 }, (_, index) => ({ path: `references/${index + 1}.md`, bytes: 100 })),
          omittedFiles: Array.from({ length: 13 }, (_, index) => ({ path: `references/${index + 17}.md`, bytes: 100 })),
          scriptFiles: [],
          warnings: [legacyWarning],
          nameChanged: false,
        }],
        warnings: [legacyWarning],
        truncated: false,
      };
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(LocalSkillImportPanel, {
      onImported: vi.fn(),
      onCancel: vi.fn(),
    }));
    await enterText('/Users/me/.codex/skills/my-skill', '/Users/me/.codex/skills/demo');
    await clickButton('预览');
    await flushPromises();

    expect(container.textContent).toContain('按需读取 13');
    expect(container.textContent).toContain('文件没有被删除');
    expect(container.textContent).not.toContain(legacyWarning);
  });

  it('keeps safe local Skills selectable when a sibling needs an unavailable reader', async () => {
    const source = {
      id: 'local:demo',
      provider: 'local' as const,
      rootPath: '/Users/me/.codex/skills/demo',
      displayName: 'demo',
      directoryName: 'demo',
      skillPaths: ['blocked/SKILL.md', 'safe/SKILL.md'],
      importedSkillNames: ['blocked', 'safe'],
      importedAt: 1,
      updatedAt: 1,
      warnings: [],
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'PREVIEW_LOCAL_SKILL_SOURCE') {
        return {
          source,
          skills: [
            {
              path: 'blocked/SKILL.md',
              name: 'blocked',
              importName: 'blocked',
              description: 'Needs an on-demand reader',
              bytes: 64000,
              bodyBytes: 6000,
              includedFiles: Array.from({ length: 16 }, (_, index) => ({ path: `blocked/references/${index + 1}.md`, bytes: 100 })),
              omittedFiles: [{ path: 'blocked/references/17.md', bytes: 100 }],
              scriptFiles: [],
              warnings: [],
              importBlock: {
                code: 'shell_reader_unavailable',
              },
              nameChanged: false,
            },
            {
              path: 'safe/SKILL.md',
              name: 'safe',
              importName: 'safe',
              description: 'Safe to import',
              bytes: 1000,
              bodyBytes: 1000,
              includedFiles: [],
              omittedFiles: [],
              scriptFiles: [],
              warnings: [],
              nameChanged: false,
            },
          ],
          warnings: [],
          truncated: false,
        };
      }
      if (message.type === 'IMPORT_LOCAL_SKILL_SOURCE') {
        return {
          ok: true,
          source,
          imported: [],
          replaced: 0,
          renamed: 0,
          warnings: [],
        };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(LocalSkillImportPanel, {
      onImported: vi.fn(),
      onCancel: vi.fn(),
    }));
    await enterText('/Users/me/.codex/skills/my-skill', '/Users/me/.codex/skills/demo');
    await clickButton('预览');
    await flushPromises();

    const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toMatchObject({ checked: false, disabled: true });
    expect(checkboxes[1]).toMatchObject({ checked: true, disabled: false });
    expect(container.textContent).toContain('按需读取器不可用');
    expect(container.textContent).toContain('当前无法按需读取');
    expect(container.textContent).toContain('请将 Shell Local 执行模式设为“自动”');
    expect(container.textContent).not.toContain('Shell MCP on-demand file reading is not available to chat.');
    expect(container.textContent).toContain('未内嵌 1');
    expect(container.textContent).not.toContain('按需读取 1');

    await clickButton('导入选中 Skill');
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'IMPORT_LOCAL_SKILL_SOURCE',
      payload: {
        rootPath: '/Users/me/.codex/skills/demo',
        selectedPaths: ['safe/SKILL.md'],
        selectedImportNames: {
          'safe/SKILL.md': 'safe',
        },
      },
    });
  });

  it('localizes reader failures detected again at import time', async () => {
    const source = {
      id: 'local:demo',
      provider: 'local' as const,
      rootPath: '/Users/me/.codex/skills/demo',
      displayName: 'demo',
      directoryName: 'demo',
      skillPaths: ['SKILL.md'],
      importedSkillNames: ['demo'],
      importedAt: 1,
      updatedAt: 1,
      warnings: [],
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'PREVIEW_LOCAL_SKILL_SOURCE') {
        return {
          source,
          skills: [{
            path: 'SKILL.md',
            name: 'demo',
            importName: 'demo',
            description: 'Reader was available during preview',
            bytes: 64000,
            bodyBytes: 6000,
            includedFiles: [],
            omittedFiles: [{ path: 'references/large.md', bytes: 58000 }],
            scriptFiles: [],
            warnings: [],
            nameChanged: false,
          }],
          warnings: [],
          truncated: false,
        };
      }
      if (message.type === 'IMPORT_LOCAL_SKILL_SOURCE') {
        return {
          ok: false,
          error: 'Shell MCP on-demand file reading is not available to chat.',
          importBlock: {
            code: 'shell_reader_unavailable',
          },
        };
      }
      return null;
    });
    const onImported = vi.fn();
    stubChrome(sendMessage);

    await renderElement(React.createElement(LocalSkillImportPanel, {
      onImported,
      onCancel: vi.fn(),
    }));
    await enterText('/Users/me/.codex/skills/my-skill', '/Users/me/.codex/skills/demo');
    await clickButton('预览');
    await flushPromises();
    await clickButton('导入选中 Skill');
    await flushPromises();

    expect(container.textContent).toContain('按需读取器不可用');
    expect(container.textContent).toContain('请将 Shell Local 执行模式设为“自动”');
    expect(container.textContent).not.toContain('Shell MCP on-demand file reading is not available to chat.');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('persists web model mode from sidepanel chat controls', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'SET_MODEL_TYPE') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    expect(buttonByText('默认').className).toContain('ds-chat-segment-active');

    await clickButton('识图');

    expect(sendMessage).toHaveBeenCalledWith({ type: 'SET_MODEL_TYPE', payload: 'vision' });
    expect(buttonByText('识图').className).toContain('ds-chat-segment-active');
  });

  it('switches providers in the existing chat panel and submits the selected model', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') {
        return {
          ok: true,
          models: [
            {
              ref: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
              label: 'DeepSeek',
              supportsImages: true,
            },
            {
              ref: { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
              label: 'Qwen 3.7 Plus',
              supportsImages: true,
            },
          ],
          activeModel: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
          statuses: [
            { providerId: 'deepseek-web', available: true },
            { providerId: 'qwen-web', available: true },
          ],
        };
      }
      if (message.type === 'SET_ACTIVE_CHAT_MODEL') return { ok: true, model: (message.payload as { model: unknown }).model };
      if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();

    const providerSelect = container.querySelector<HTMLSelectElement>('select[aria-label="提供商和模型"]');
    expect(providerSelect).toBeTruthy();
    await act(async () => {
      setSelectValue(providerSelect!, 'qwen-web/qwen3.7-plus');
      providerSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SET_ACTIVE_CHAT_MODEL',
      payload: { model: { providerId: 'qwen-web', modelId: 'qwen3.7-plus' } },
    });

    await enterText('给 DeepSeek++ 发送消息', '继续这个对话');
    await clickButtonByLabel('发送');

    const submit = sendMessage.mock.calls.find(([message]) => message.type === 'CHAT_SUBMIT_PROMPT')?.[0];
    expect(submit).toMatchObject({
      type: 'CHAT_SUBMIT_PROMPT',
      payload: {
        text: '继续这个对话',
        model: { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
        transcript: [],
      },
    });
    expect((submit?.payload as { logicalConversationId?: string }).logicalConversationId).toBeTruthy();
  });

  it('ignores provider chunks targeted at another sidepanel instance', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') return providerCatalog();
      if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    await enterText('给 DeepSeek++ 发送消息', 'route this turn');
    await clickButtonByLabel('发送');
    const submit = sendMessage.mock.calls.find(
      ([message]) => message.type === 'CHAT_SUBMIT_PROMPT',
    )?.[0];
    const payload = submit?.payload as {
      logicalConversationId: string;
      streamTargetId: string;
    };

    await act(async () => {
      runtimeListeners.forEach((listener) => listener({
        type: 'CHAT_STREAM_CHUNK',
        logicalConversationId: payload.logicalConversationId,
        streamTargetId: 'another-sidepanel',
        text: 'wrong panel text',
        done: false,
      }));
    });
    expect(container.textContent).not.toContain('wrong panel text');

    await act(async () => {
      runtimeListeners.forEach((listener) => listener({
        type: 'CHAT_STREAM_CHUNK',
        logicalConversationId: payload.logicalConversationId,
        streamTargetId: payload.streamTargetId,
        text: 'correct panel text',
        done: false,
      }));
    });
    expect(container.textContent).toContain('correct panel text');
  });

  it('ignores a stale provider-selection failure after the latest selection succeeds', async () => {
    const first = deferred<{ ok: true; model: { providerId: 'qwen-web'; modelId: 'qwen3.7-plus' } }>();
    const second = deferred<{ ok: true; model: { providerId: 'deepseek-web'; modelId: 'deepseek-web' } }>();
    let selectionRequest = 0;
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') return providerCatalog();
      if (message.type === 'SET_ACTIVE_CHAT_MODEL') {
        selectionRequest += 1;
        return selectionRequest === 1 ? first.promise : second.promise;
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    const providerSelect = container.querySelector<HTMLSelectElement>('select[aria-label="提供商和模型"]')!;
    await act(async () => {
      setSelectValue(providerSelect, 'qwen-web/qwen3.7-plus');
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      setSelectValue(providerSelect, 'deepseek-web/deepseek-web');
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    second.resolve({
      ok: true,
      model: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
    });
    await flushPromises();
    first.reject(new Error('stale provider failure'));
    await flushPromises();

    expect(providerSelect.value).toBe('deepseek-web/deepseek-web');
    expect(container.textContent).not.toContain('stale provider failure');
  });

  it('serializes stale success before rolling back the latest failed selection', async () => {
    const first = deferred<{ ok: true; model: { providerId: 'qwen-web'; modelId: 'qwen3.7-plus' } }>();
    const second = deferred<{ ok: true; model: { providerId: 'deepseek-web'; modelId: 'deepseek-web' } }>();
    let selectionRequest = 0;
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') return providerCatalog();
      if (message.type === 'SET_ACTIVE_CHAT_MODEL') {
        selectionRequest += 1;
        return selectionRequest === 1 ? first.promise : second.promise;
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    const providerSelect = container.querySelector<HTMLSelectElement>('select[aria-label="提供商和模型"]')!;
    await act(async () => {
      setSelectValue(providerSelect, 'qwen-web/qwen3.7-plus');
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      setSelectValue(providerSelect, 'deepseek-web/deepseek-web');
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    first.resolve({
      ok: true,
      model: { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
    });
    await flushPromises();
    second.reject(new Error('latest provider failure'));
    await flushPromises();

    expect(providerSelect.value).toBe('qwen-web/qwen3.7-plus');
    expect(container.textContent).toContain('latest provider failure');
  });

  it('serializes provider selection across unmount and remount', async () => {
    const first = deferred<{ ok: true; model: { providerId: 'qwen-web'; modelId: 'qwen3.7-plus' } }>();
    const second = deferred<{ ok: true; model: { providerId: 'deepseek-web'; modelId: 'deepseek-web' } }>();
    let selectionRequest = 0;
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') return providerCatalog();
      if (message.type === 'SET_ACTIVE_CHAT_MODEL') {
        selectionRequest += 1;
        return selectionRequest === 1 ? first.promise : second.promise;
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    let providerSelect = container.querySelector<HTMLSelectElement>('select[aria-label="提供商和模型"]')!;
    await act(async () => {
      setSelectValue(providerSelect, 'qwen-web/qwen3.7-plus');
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      root?.unmount();
      root = null;
    });

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    providerSelect = container.querySelector<HTMLSelectElement>('select[aria-label="提供商和模型"]')!;
    await act(async () => {
      setSelectValue(providerSelect, 'deepseek-web/deepseek-web');
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(selectionRequest).toBe(1);

    first.resolve({
      ok: true,
      model: { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
    });
    await flushPromises();
    expect(selectionRequest).toBe(2);
    second.resolve({
      ok: true,
      model: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
    });
    await flushPromises();

    expect(providerSelect.value).toBe('deepseek-web/deepseek-web');
  });

  it('restores the durable provider transcript and reuses its logical conversation id', async () => {
    chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] = {
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      logicalConversationId: 'conversation-restored',
      createdAt: 10,
      updatedAt: 20,
      messages: [
        {
          role: 'user',
          text: 'Describe the attached card.',
          providerId: 'qwen-web',
          modelId: 'qwen3.7-plus',
          attachments: [{ kind: 'image', name: 'card.png', mimeType: 'image/png' }],
        },
        {
          role: 'assistant',
          text: 'It is a Sanji card.',
          reasoningText: 'I inspected the card artwork.',
          providerId: 'qwen-web',
          modelId: 'qwen3.7-plus',
        },
      ],
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') {
        return {
          ok: true,
          models: [{
            ref: { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
            label: 'Qwen 3.7 Plus',
            supportsImages: true,
          }],
          activeModel: { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
          statuses: [{ providerId: 'qwen-web', available: true }],
        };
      }
      if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();

    expect(container.textContent).toContain('Describe the attached card.');
    expect(container.textContent).toContain('It is a Sanji card.');
    expect(container.textContent).toContain('I inspected the card artwork.');
    expect(container.textContent).toContain('card.png');
    expect(container.querySelector('.ds-chat-message-attachment img')).toBeNull();

    await enterText('给 DeepSeek++ 发送消息', 'Continue after reload.');
    await clickButtonByLabel('发送');

    const submit = sendMessage.mock.calls.find(([message]) => message.type === 'CHAT_SUBMIT_PROMPT')?.[0];
    expect(submit).toMatchObject({
      payload: {
        logicalConversationId: 'conversation-restored',
        transcript: [
          { role: 'user', content: 'Describe the attached card.' },
          { role: 'assistant', content: 'It is a Sanji card.' },
        ],
      },
    });
  });
  it('persists streamed provider messages after the debounce', async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') {
        return {
          ok: true,
          models: [{
            ref: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
            label: 'DeepSeek',
            supportsImages: true,
          }],
          activeModel: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
          statuses: [{ providerId: 'deepseek-web', available: true }],
        };
      }
      if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    await enterText('给 DeepSeek++ 发送消息', 'Persist this turn.');
    await clickButtonByLabel('发送');
    await act(async () => {
      runtimeListeners.forEach((listener) => listener({
        type: 'CHAT_STREAM_CHUNK',
        providerId: 'deepseek-web',
        modelId: 'deepseek-web',
        reasoningText: 'Checked durable state.',
        text: 'This turn is durable.',
        done: false,
      }));
      runtimeListeners.forEach((listener) => listener({
        type: 'CHAT_STREAM_CHUNK',
        providerId: 'deepseek-web',
        modelId: 'deepseek-web',
        done: true,
      }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]).toMatchObject({
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      messages: [
        { role: 'user', text: 'Persist this turn.', providerId: 'deepseek-web', modelId: 'deepseek-web' },
        {
          role: 'assistant',
          text: 'This turn is durable.',
          reasoningText: 'Checked durable state.',
          providerId: 'deepseek-web',
          modelId: 'deepseek-web',
        },
      ],
    });
  });
  it('replaces the durable transcript when a new session is confirmed', async () => {
    chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] = {
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      logicalConversationId: 'conversation-old',
      createdAt: 10,
      updatedAt: 20,
      messages: [{ role: 'user', text: 'Old durable message.' }],
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') return null;
      if (message.type === 'CHAT_NEW_SESSION') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    expect(container.textContent).toContain('Old durable message.');

    await clickButtonByLabel('新建会话');
    await clickButton('新建');
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'CHAT_NEW_SESSION' });
    expect(container.textContent).not.toContain('Old durable message.');
    expect(chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]).toMatchObject({
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      messages: [],
    });
    expect((chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] as { logicalConversationId: string }).logicalConversationId)
      .not.toBe('conversation-old');
  });
  it('replaces non-monotonic Qwen thinking summaries instead of duplicating them', async () => {
    const qwenModel = { providerId: 'qwen-web', modelId: 'qwen3.7-plus' } as const;
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') {
        return {
          ok: true,
          models: [{
            ref: qwenModel,
            label: 'Qwen 3.7 Plus',
            supportsImages: true,
          }],
          activeModel: qwenModel,
          statuses: [{ providerId: 'qwen-web', available: true }],
        };
      }
      return null;
    });
    stubChrome(sendMessage);
    await renderElement(React.createElement(ChatPage));
    await flushPromises();

    await act(async () => {
      runtimeListeners.forEach((listener) => listener({
        type: 'CHAT_STREAM_CHUNK',
        providerId: 'qwen-web',
        modelId: 'qwen3.7-plus',
        reasoningText: 'Checked',
        reasoningFullText: 'Checked',
        done: false,
      }));
      runtimeListeners.forEach((listener) => listener({
        type: 'CHAT_STREAM_CHUNK',
        providerId: 'qwen-web',
        modelId: 'qwen3.7-plus',
        reasoningText: 'Revised',
        reasoningFullText: 'Revised',
        done: false,
      }));
    });

    const thinking = container.querySelector('.ds-chat-thinking div');
    expect(thinking?.textContent).toBe('Revised');
  });

  it('scrolls to the updated message height after the lazy rich renderer commits', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();

    const messageList = container.querySelector('.ds-chat-messages') as HTMLDivElement;
    const scrollAssignments: number[] = [];
    let scrollTop = 0;
    Object.defineProperties(messageList, {
      scrollHeight: {
        configurable: true,
        get: () => messageList.querySelector('strong') ? 480 : 240,
      },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
          scrollAssignments.push(value);
        },
      },
    });

    await act(async () => {
      runtimeListeners.forEach((listener) => listener({
        type: 'CHAT_STREAM_CHUNK',
        text: 'Hello **world**',
      }));
    });

    await vi.waitFor(() => {
      expect(messageList.querySelector('strong')?.textContent).toBe('world');
    });
    expect(scrollAssignments).toContain(480);
    expect(scrollTop).toBe(480);
  });

  it('uploads a vision image attachment and submits its file reference', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return 'vision';
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'UPLOAD_DEEPSEEK_IMAGE') {
        return {
          ok: true,
          file: {
            id: 'file-image-1',
            fileName: 'shot.png',
            status: 'SUCCESS',
          },
        };
      }
      if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);
    stubObjectUrl();
    stubFileReader('data:image/png;base64,YWJj');

    await renderElement(React.createElement(ChatPage));
    await flushPromises();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    const image = new File(['abc'], 'shot.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [image], configurable: true });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPLOAD_DEEPSEEK_IMAGE',
      payload: {
        dataUrl: 'data:image/png;base64,YWJj',
        name: 'shot.png',
        mimeType: 'image/png',
        sizeBytes: 3,
      },
    });
    expect(container.textContent).toContain('已添加');

    await enterText('给 DeepSeek++ 发送消息', '描述这张图片');
    await clickButtonByLabel('发送');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'CHAT_SUBMIT_PROMPT',
      payload: {
        text: '描述这张图片',
        refFileIds: ['file-image-1'],
      },
    });
  });

  it('uploads a Qwen image through the provider-neutral composer and submits its Qwen file object', async () => {
    const qwenModel = { providerId: 'qwen-web', modelId: 'qwen3.7-plus' } as const;
    const providerAttachment = {
      id: 'file-qwen-1',
      name: 'eyes.png',
      mimeType: 'image/png',
      providerFileId: 'file-qwen-1',
      providerData: { id: 'file-qwen-1', type: 'image', file_class: 'vision' },
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') {
        return {
          ok: true,
          models: [
            {
              ref: qwenModel,
              label: 'Qwen 3.7 Plus',
              supportsImages: true,
              imageUploadMaxBytes: 20 * 1024 * 1024,
            },
            {
              ref: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
              label: 'DeepSeek',
              supportsImages: false,
            },
          ],
          activeModel: qwenModel,
          statuses: [
            { providerId: 'qwen-web', available: true },
            { providerId: 'deepseek-web', available: true },
          ],
        };
      }
      if (message.type === 'UPLOAD_CHAT_IMAGE') return { ok: true, attachment: providerAttachment };
      if (message.type === 'SET_ACTIVE_CHAT_MODEL') {
        return { ok: false, error: 'provider selection failed' };
      }
      if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);
    stubObjectUrl();
    stubFileReader('data:image/png;base64,YWJj');

    await renderElement(React.createElement(ChatPage));
    await flushPromises();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const image = new File(['abc'], 'eyes.png', { type: 'image/png' });
    Object.defineProperty(image, 'size', { value: 9 * 1024 * 1024, configurable: true });
    Object.defineProperty(fileInput, 'files', { value: [image], configurable: true });
    await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })));
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPLOAD_CHAT_IMAGE',
      payload: {
        model: qwenModel,
        dataUrl: 'data:image/png;base64,YWJj',
        name: 'eyes.png',
        mimeType: 'image/png',
        sizeBytes: 9 * 1024 * 1024,
      },
    });

    await act(async () => {
      runtimeListeners.forEach((listener) => listener({ type: 'STATE_UPDATED', modelType: null }));
      runtimeListeners.forEach((listener) => listener({
        type: 'AUTH_STATUS_CHANGED',
        available: true,
        provider: 'official-api',
      }));
    });
    expect(container.textContent).toContain('已添加');

    const providerSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="提供商和模型"]',
    )!;
    await act(async () => {
      setSelectValue(providerSelect, 'deepseek-web/deepseek-web');
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushPromises();
    expect(providerSelect.value).toBe('qwen-web/qwen3.7-plus');
    expect(container.textContent).toContain('provider selection failed');
    expect(container.textContent).toContain('已添加');

    await enterText('给 DeepSeek++ 发送消息', '描述这张图');
    await clickButtonByLabel('发送');

    const submit = sendMessage.mock.calls.find(([message]) => message.type === 'CHAT_SUBMIT_PROMPT')?.[0];
    expect(submit).toMatchObject({
      payload: {
        model: qwenModel,
        attachments: [providerAttachment],
      },
    });
    expect(container.querySelector('.ds-chat-attachment')).toBeNull();
    const sentImage = container.querySelector('.ds-chat-message-attachment img') as HTMLImageElement | null;
    expect(sentImage?.src).toBe('blob:preview');
    expect(sentImage?.alt).toBe('eyes.png');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:preview');

    await act(async () => root?.unmount());
    root = null;
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });
  it('fails closed when the durable conversation record is corrupt and does not overwrite storage', async () => {
    const corrupt = {
      schemaVersion: 99,
      logicalConversationId: 'conversation-corrupt',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    };
    chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] = corrupt;
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      return null;
    });
    stubChrome(sendMessage);
    const setCallsBefore = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length;

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(container.textContent).toContain('unsupported_schema_version');
    const send = container.querySelector('button[aria-label="发送"]') as HTMLButtonElement | null;
    expect(send?.disabled).toBe(true);
    const newSession = findNewSessionButton();
    expect(newSession?.disabled).toBe(true);
    expect(chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]).toEqual(corrupt);
    expect((chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length).toBe(setCallsBefore);
  });
  it('fails closed on nested-corrupt messages without normalizing or autosaving', async () => {
    const nestedCorrupt = {
      schemaVersion: 1,
      logicalConversationId: 'conversation-nested-corrupt',
      messages: [{ role: 'system', text: 'x' }],
      createdAt: 1,
      updatedAt: 2,
    };
    chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] = nestedCorrupt;
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      return null;
    });
    stubChrome(sendMessage);
    const setCallsBefore = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length;

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(container.textContent).toContain('nested_corrupt_message_role');
    const send = container.querySelector('button[aria-label="发送"]') as HTMLButtonElement | null;
    expect(send?.disabled).toBe(true);
    expect(findNewSessionButton()?.disabled).toBe(true);
    expect(chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]).toEqual(nestedCorrupt);
    expect((chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length).toBe(setCallsBefore);
  });
  it('fails closed on nested-corrupt attachments without autosaving', async () => {
    const nestedCorrupt = {
      schemaVersion: 1,
      logicalConversationId: 'conversation-bad-attachment',
      messages: [{
        role: 'user',
        text: 'hello',
        attachments: [{ kind: 'file', name: 'x', mimeType: 'text/plain' }],
      }],
      createdAt: 1,
      updatedAt: 2,
    };
    chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] = nestedCorrupt;
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      return null;
    });
    stubChrome(sendMessage);
    const setCallsBefore = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length;

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(container.textContent).toContain('nested_corrupt_attachment');
    expect(findNewSessionButton()?.disabled).toBe(true);
    expect(chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]).toEqual(nestedCorrupt);
    expect((chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length).toBe(setCallsBefore);
  });
  it('keeps New Session disabled while conversation load is still pending', async () => {
    const corrupt = {
      schemaVersion: 99,
      logicalConversationId: 'conversation-pending',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    };
    chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] = corrupt;
    let releaseLoad: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      return null;
    });
    stubChrome(sendMessage);
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
      await loadGate;
      return { [key]: chromeStorage[key] };
    });
    const setCallsBefore = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length;

    await renderElement(React.createElement(ChatPage));
    await act(async () => {
      await Promise.resolve();
    });

    expect(findNewSessionButton()?.disabled).toBe(true);
    expect(chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]).toEqual(corrupt);
    expect((chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length).toBe(setCallsBefore);

    releaseLoad?.();
    await flushPromises();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(findNewSessionButton()?.disabled).toBe(true);
    expect(chromeStorage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]).toEqual(corrupt);
    expect((chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length).toBe(setCallsBefore);
  });
  it('hides DeepSeek sign-in banner while auth is still loading', async () => {
    let resolveAuth: ((value: { available: boolean; provider: string }) => void) | undefined;
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTH_STATUS') {
        return await new Promise((resolve) => {
          resolveAuth = resolve;
        });
      }
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') {
        return {
          ok: true,
          models: [{
            ref: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
            label: 'DeepSeek',
            supportsImages: true,
          }],
          activeModel: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
          statuses: [{ providerId: 'deepseek-web', available: false }],
        };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    expect(container.textContent).not.toContain('先登录一次');
    expect(container.textContent).not.toContain('Sign in to');

    resolveAuth?.({ available: true, provider: 'deepseek-web' });
    await flushPromises();
    expect(container.textContent).not.toContain('先登录一次');
  });
  it('prefers DeepSeek authStatus over a stale unavailable catalog status', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') {
        return {
          ok: true,
          models: [{
            ref: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
            label: 'DeepSeek',
            supportsImages: true,
          }],
          activeModel: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
          statuses: [{ providerId: 'deepseek-web', available: false }],
        };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    expect(container.textContent).not.toContain('先登录一次 DeepSeek');
    expect(container.textContent).not.toContain('Sign in to DeepSeek');
    expect(container.querySelector('button[aria-label="发送"]')).toBeTruthy();
  });
  it('shows DeepSeek sign-in banner only when auth is explicitly unavailable', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: false, provider: null };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') {
        return {
          ok: true,
          models: [{
            ref: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
            label: 'DeepSeek',
            supportsImages: true,
          }],
          activeModel: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
          statuses: [{ providerId: 'deepseek-web', available: true }],
        };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    expect(
      container.textContent?.includes('先登录一次 DeepSeek')
      || container.textContent?.includes('Sign in to DeepSeek'),
    ).toBe(true);
  });
  it('keeps Qwen catalog availability authoritative', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_CHAT_CATALOG') {
        return {
          ok: true,
          models: [
            {
              ref: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
              label: 'DeepSeek',
              supportsImages: true,
            },
            {
              ref: { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
              label: 'Qwen 3.7 Plus',
              supportsImages: true,
            },
          ],
          activeModel: { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
          statuses: [
            { providerId: 'deepseek-web', available: true },
            { providerId: 'qwen-web', available: false },
          ],
        };
      }
      if (message.type === 'SET_ACTIVE_CHAT_MODEL') return { ok: true, model: (message.payload as { model: unknown }).model };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(ChatPage));
    await flushPromises();
    expect(
      container.textContent?.includes('先登录一次 Qwen')
      || container.textContent?.includes('Sign in to Qwen')
      || container.textContent?.includes('先登录一次'),
    ).toBe(true);
  });

  it('waits for new-session acknowledgement before clearing pending chat UI', async () => {
    let resolveReset!: (value: { ok: true }) => void;
    const resetAck = new Promise<{ ok: true }>((resolve) => {
      resolveReset = resolve;
    });
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_MODEL_TYPE') return 'vision';
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'UPLOAD_DEEPSEEK_IMAGE') {
        return { ok: true, file: { id: 'file-image-1', fileName: 'shot.png', status: 'SUCCESS' } };
      }
      if (message.type === 'CHAT_NEW_SESSION') return resetAck;
      return null;
    });
    stubChrome(sendMessage);
    stubObjectUrl();
    stubFileReader('data:image/png;base64,YWJj');
    await renderElement(React.createElement(ChatPage));
    await flushPromises();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const image = new File(['abc'], 'shot.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [image], configurable: true });
    await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })));
    await flushPromises();
    expect(container.textContent).toContain('已添加');

    await clickButtonByLabel('新建会话');
    expect(container.textContent).toContain('已添加');
    resolveReset({ ok: true });
    await flushPromises();
    expect(container.textContent).not.toContain('已添加');
  });

});

async function renderElement(element: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(element);
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
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: chromeStorage[key] })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          Object.assign(chromeStorage, value);
        }),
      },
    },
  });
}

function findNewSessionButton(): HTMLButtonElement | undefined {
  return container.querySelector('button[aria-label="新建会话"], button[aria-label="New session"]') as HTMLButtonElement | null
    ?? Array.from(container.querySelectorAll('button')).find((button) => (
      button.getAttribute('title') === '新建会话' || button.getAttribute('title') === 'New session'
    )) as HTMLButtonElement | undefined;
}

async function enterText(placeholder: string, value: string) {
  const field = inputByPlaceholder(placeholder);
  await act(async () => {
    setTextControlValue(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function clickButton(label: string) {
  const button = buttonByText(label);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function clickButtonByLabel(label: string) {
  const button = container.querySelector(`button[aria-label="${label}"]`);
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

function inputByPlaceholder(placeholder: string): HTMLInputElement | HTMLTextAreaElement {
  const input = container.querySelector(`input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`);
  expect(input).toBeTruthy();
  return input as HTMLInputElement | HTMLTextAreaElement;
}

function buttonByText(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
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

function stubObjectUrl() {
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  }));
}

function providerCatalog() {
  return {
    ok: true as const,
    models: [
      {
        ref: { providerId: 'deepseek-web' as const, modelId: 'deepseek-web' },
        label: 'DeepSeek',
        supportsImages: true,
      },
      {
        ref: { providerId: 'qwen-web' as const, modelId: 'qwen3.7-plus' },
        label: 'Qwen 3.7 Plus',
        supportsImages: true,
      },
    ],
    activeModel: { providerId: 'deepseek-web' as const, modelId: 'deepseek-web' },
    statuses: [
      { providerId: 'deepseek-web' as const, available: true },
      { providerId: 'qwen-web' as const, available: true },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function stubFileReader(dataUrl: string) {
  class MockFileReader {
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL() {
      this.result = dataUrl;
      this.onload?.();
    }
  }

  vi.stubGlobal('FileReader', MockFileReader);
}
