import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../components/ui/tooltip';
import {
  DEFAULT_PROMPT_INJECTION_SETTINGS,
  type PromptInjectionSettings,
} from '../core/prompt/settings';
import { DEFAULT_VOICE_SETTINGS } from '../core/voice/settings';
import PromptControlPanel from '../entrypoints/sidepanel/components/PromptControlPanel';
import VoiceSettingsPanel from '../entrypoints/sidepanel/components/VoiceSettingsPanel';
import AutomationPage from '../entrypoints/sidepanel/pages/AutomationPage';
import MemoryPage from '../entrypoints/sidepanel/pages/MemoryPage';
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
    await clickButton('新建保存项');
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
    expect(container.textContent).toContain('已保存');
    expect(inputByPlaceholder('搜索保存项').value).toBe('');
  });

  it('inserts a saved prompt into the active DeepSeek page before falling back to sidepanel chat', async () => {
    const savedItem = {
      id: 'saved-1',
      syncId: 'sync-1',
      kind: 'snippet',
      title: 'Review prompt',
      content: 'Summarize this thread.',
      tags: ['prompt'],
      createdAt: 1,
      updatedAt: 1,
    };
    const onInsertPrompt = vi.fn();
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_SAVED_ITEMS') return [savedItem];
      if (message.type === 'INSERT_SAVED_PROMPT_IN_ACTIVE_DEEPSEEK_TAB') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage, { onInsertPrompt }));
    await flushEffects();
    await clickButton('插入到对话');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'INSERT_SAVED_PROMPT_IN_ACTIVE_DEEPSEEK_TAB',
      payload: { text: 'Summarize this thread.' },
    });
    expect(onInsertPrompt).not.toHaveBeenCalled();
    expect(container.textContent).toContain('已插入到 DeepSeek 输入框。');
  });

  it('keeps the sidepanel pending-text fallback when no DeepSeek page input is available', async () => {
    const savedItem = {
      id: 'saved-1',
      syncId: 'sync-1',
      kind: 'snippet',
      title: 'Review prompt',
      content: 'Summarize this thread.',
      tags: ['prompt'],
      createdAt: 1,
      updatedAt: 1,
    };
    const onInsertPrompt = vi.fn();
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_SAVED_ITEMS') return [savedItem];
      if (message.type === 'INSERT_SAVED_PROMPT_IN_ACTIVE_DEEPSEEK_TAB') {
        return { ok: false, error: 'no_active_deepseek_tab' };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage, { onInsertPrompt }));
    await flushEffects();
    await clickButton('插入到对话');

    expect(onInsertPrompt).toHaveBeenCalledWith('Summarize this thread.');
    expect(container.textContent).toContain('已在侧边栏对话中打开。');
  });

  it('shows a retryable saved-items load error instead of a false empty list', async () => {
    let attempts = 0;
    const savedItem = {
      id: 'saved-1',
      syncId: 'sync-1',
      kind: 'snippet',
      title: 'Recovery prompt',
      content: 'Continue from the latest verified checkpoint.',
      tags: ['recovery'],
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_SAVED_ITEMS') {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
        return [savedItem];
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage, { onInsertPrompt: vi.fn() }));
    await flushEffects();

    expect(container.textContent).toContain('保存项不可用');
    expect(container.textContent).toContain('保存项操作失败：offline');
    expect(container.textContent).toContain('重试');
    expect(container.textContent).not.toContain('暂无保存项');
    const statusCard = container.querySelector<HTMLElement>('.ds-library-status-card[data-state="attention"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.querySelector('[data-slot="badge"]')?.textContent).toBe('需要刷新');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('不可用');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('先重试保存项');
    expect(statusCard?.querySelectorAll('[data-slot="button"]')).toHaveLength(1);

    await clickButton('重试');
    await flushEffects();

    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_SAVED_ITEMS')).toHaveLength(2);
    expect(container.textContent).toContain('Recovery prompt');
    expect(container.textContent).not.toContain('保存项不可用');
    expect(container.textContent).not.toContain('offline');
    expect(container.querySelector('.ds-library-status-card')?.getAttribute('data-state')).toBe('ready');
  });

  it('sanitizes saved-items load failures without showing a false empty list', async () => {
    let attempts = 0;
    const savedItem = {
      id: 'saved-1',
      syncId: 'sync-1',
      kind: 'snippet',
      title: 'Recovered saved item',
      content: 'Continue from verified evidence.',
      tags: ['recovery'],
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_SAVED_ITEMS') {
        attempts += 1;
        if (attempts === 1) {
          return {
            ok: false,
            error: {
              message: 'GET_SAVED_ITEMS schemaVersion chrome.storage deepseek_pp_saved_items token secret [object Object]',
            },
          };
        }
        return [savedItem];
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage, { onInsertPrompt: vi.fn() }));
    await flushEffects();

    const failedText = container.textContent ?? '';
    expect(failedText).toContain('保存项不可用');
    expect(failedText).toContain('保存项后端不可用，请重新加载扩展后再试。');
    expect(failedText).toContain('重试');
    expect(failedText).not.toContain('暂无保存项');
    expect(failedText).not.toContain('GET_SAVED_ITEMS');
    expect(failedText).not.toContain('schemaVersion');
    expect(failedText).not.toContain('chrome.storage');
    expect(failedText).not.toContain('deepseek_pp_saved_items');
    expect(failedText).not.toContain('token');
    expect(failedText).not.toContain('secret');
    expect(failedText).not.toContain('[object Object]');
    expect(container.querySelector('.ds-library-status-card')?.getAttribute('data-state')).toBe('attention');

    await clickButton('重试');
    await flushEffects();

    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_SAVED_ITEMS')).toHaveLength(2);
    expect(container.textContent).toContain('Recovered saved item');
    expect(container.textContent).not.toContain('保存项不可用');
    expect(container.querySelector('.ds-library-status-card')?.getAttribute('data-state')).toBe('ready');
  });

  it('clears a saved-items load error when the backend pushes recovered items', async () => {
    const savedItem = {
      id: 'saved-1',
      syncId: 'sync-1',
      kind: 'snippet',
      title: 'Recovered pushed item',
      content: 'Recovered from runtime update.',
      tags: ['recovery'],
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_SAVED_ITEMS') throw new Error('offline');
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage, { onInsertPrompt: vi.fn() }));
    await flushEffects();
    expect(container.textContent).toContain('保存项不可用');

    await act(async () => {
      runtimeListeners.forEach((listener) => listener({
        type: 'SAVED_ITEMS_UPDATED',
        savedItems: [savedItem],
      }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Recovered pushed item');
    expect(container.textContent).not.toContain('保存项不可用');
    expect(container.textContent).not.toContain('offline');
  });

  it('keeps a saved item visible when delete fails', async () => {
    const savedItem = {
      id: 'saved-1',
      syncId: 'sync-1',
      kind: 'snippet',
      title: 'Review prompt',
      content: 'Summarize this thread.',
      tags: ['prompt'],
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_SAVED_ITEMS') return [savedItem];
      if (message.type === 'DELETE_SAVED_ITEM') throw new Error('permission denied');
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage, { onInsertPrompt: vi.fn() }));
    await flushEffects();
    await clickButton('删除');
    await clickConfirmDelete();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'DELETE_SAVED_ITEM', payload: { id: 'saved-1' } });
    expect(container.textContent).toContain('保存项操作失败：permission denied');
    expect(container.textContent).toContain('Review prompt');
  });

  it('sanitizes saved item delete failures and keeps the item visible', async () => {
    const savedItem = {
      id: 'saved-1',
      syncId: 'sync-1',
      kind: 'snippet',
      title: 'Review prompt',
      content: 'Summarize this thread.',
      tags: ['prompt'],
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_SAVED_ITEMS') return [savedItem];
      if (message.type === 'DELETE_SAVED_ITEM') {
        return {
          ok: false,
          error: {
            message: 'DELETE_SAVED_ITEM schemaVersion chrome.runtime deepseek_pp_saved_items token secret [object Object]',
          },
        };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(SavedPage, { onInsertPrompt: vi.fn() }));
    await flushEffects();
    await clickButton('删除');
    await clickConfirmDelete();

    const bodyText = container.textContent ?? '';
    expect(sendMessage).toHaveBeenCalledWith({ type: 'DELETE_SAVED_ITEM', payload: { id: 'saved-1' } });
    expect(bodyText).toContain('保存项操作失败');
    expect(bodyText).toContain('保存项后端不可用，请重新加载扩展后再试。');
    expect(bodyText).toContain('Review prompt');
    expect(bodyText).not.toContain('DELETE_SAVED_ITEM');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.runtime');
    expect(bodyText).not.toContain('deepseek_pp_saved_items');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');
  });

  it('shows a retryable memory load error instead of a false empty list', async () => {
    let attempts = 0;
    const memory = createMemoryForPage({
      id: 1,
      name: 'Recovery preference',
      content: 'Continue from the latest verified checkpoint.',
      tags: ['recovery'],
    });
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
        return [memory];
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(MemoryPage));
    await flushEffects();

    expect(container.textContent).toContain('记忆不可用');
    expect(container.textContent).toContain('记忆操作失败：offline');
    expect(container.textContent).toContain('重试');
    expect(container.textContent).not.toContain('暂无记忆');
    const statusCard = container.querySelector<HTMLElement>('.ds-library-status-card[data-state="attention"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.querySelector('[data-slot="badge"]')?.textContent).toBe('需要刷新');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('不可用');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('先重试记忆');
    expect(statusCard?.querySelectorAll('[data-slot="button"]')).toHaveLength(1);

    await clickButton('重试');
    await flushEffects();

    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_MEMORIES')).toHaveLength(2);
    expect(container.textContent).toContain('Recovery preference');
    expect(container.textContent).not.toContain('记忆不可用');
    expect(container.textContent).not.toContain('offline');
    expect(container.querySelector('.ds-library-status-card')?.getAttribute('data-state')).toBe('ready');
  });

  it('sanitizes memory load failures without showing a false empty list', async () => {
    let attempts = 0;
    const memory = createMemoryForPage({
      id: 1,
      name: 'Recovered memory',
      content: 'Continue from verified evidence.',
      tags: ['recovery'],
    });
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') {
        attempts += 1;
        if (attempts === 1) {
          return {
            ok: false,
            error: {
              message: 'GET_MEMORIES schemaVersion chrome.storage deepseek_pp_memories token secret [object Object]',
            },
          };
        }
        return [memory];
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(MemoryPage));
    await flushEffects();

    const failedText = container.textContent ?? '';
    expect(failedText).toContain('记忆不可用');
    expect(failedText).toContain('记忆后端不可用，请重新加载扩展后再试。');
    expect(failedText).toContain('重试');
    expect(failedText).not.toContain('暂无记忆');
    expect(failedText).not.toContain('GET_MEMORIES');
    expect(failedText).not.toContain('schemaVersion');
    expect(failedText).not.toContain('chrome.storage');
    expect(failedText).not.toContain('deepseek_pp_memories');
    expect(failedText).not.toContain('token');
    expect(failedText).not.toContain('secret');
    expect(failedText).not.toContain('[object Object]');
    expect(container.querySelector('.ds-library-status-card')?.getAttribute('data-state')).toBe('attention');

    await clickButton('重试');
    await flushEffects();

    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_MEMORIES')).toHaveLength(2);
    expect(container.textContent).toContain('Recovered memory');
    expect(container.textContent).not.toContain('记忆不可用');
    expect(container.querySelector('.ds-library-status-card')?.getAttribute('data-state')).toBe('ready');
  });

  it('clears a memory load error when focus refresh recovers', async () => {
    let attempts = 0;
    const memory = createMemoryForPage({
      id: 6,
      name: 'Focus recovery',
      content: 'A successful refresh clears stale load errors.',
    });
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
        return [memory];
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(MemoryPage));
    await flushEffects();
    expect(container.textContent).toContain('记忆操作失败：offline');

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    await flushEffects();

    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_MEMORIES')).toHaveLength(2);
    expect(container.textContent).toContain('Focus recovery');
    expect(container.textContent).not.toContain('记忆不可用');
    expect(container.textContent).not.toContain('offline');
  });

  it('clears a memory load error when the backend pushes recovered memories', async () => {
    const memory = createMemoryForPage({
      id: 2,
      name: 'Recovered memory',
      content: 'Recovered from runtime update.',
      tags: ['recovery'],
    });
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') throw new Error('offline');
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(MemoryPage));
    await flushEffects();
    expect(container.textContent).toContain('记忆不可用');

    await act(async () => {
      runtimeListeners.forEach((listener) => listener({
        type: 'STATE_UPDATED',
        memories: [
          memory,
          createMemoryForPage({
            id: 3,
            name: 'Project-only memory',
            content: 'Project memories stay in Projects.',
            scope: 'project',
          }),
        ],
      }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Recovered memory');
    expect(container.textContent).not.toContain('Project-only memory');
    expect(container.textContent).not.toContain('记忆不可用');
    expect(container.textContent).not.toContain('offline');
  });

  it('keeps a memory visible when delete fails', async () => {
    const memory = createMemoryForPage({
      id: 4,
      name: 'Review preference',
      content: 'Surface risks before summaries.',
      tags: ['review'],
    });
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') return [memory];
      if (message.type === 'DELETE_MEMORY') throw new Error('permission denied');
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(MemoryPage));
    await flushEffects();
    await clickButton('删除');
    await clickConfirmDelete();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'DELETE_MEMORY', payload: { id: 4 } });
    expect(container.textContent).toContain('记忆操作失败：permission denied');
    expect(container.textContent).toContain('Review preference');
  });

  it('keeps a memory visible when pinning fails', async () => {
    const memory = createMemoryForPage({
      id: 5,
      name: 'Tone preference',
      content: 'Be direct.',
      pinned: false,
    });
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') return [memory];
      if (message.type === 'UPDATE_MEMORY') throw new Error('storage locked');
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(MemoryPage));
    await flushEffects();
    await clickButton('置顶');

    expect(container.textContent).toContain('记忆操作失败：storage locked');
    expect(container.textContent).toContain('Tone preference');
    expect(container.textContent).toContain('置顶');
    expect(container.textContent).not.toContain('取消置顶');
  });

  it('sanitizes memory pin failures and keeps the previous visible state', async () => {
    const memory = createMemoryForPage({
      id: 5,
      name: 'Tone preference',
      content: 'Be direct.',
      pinned: false,
    });
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') return [memory];
      if (message.type === 'UPDATE_MEMORY') {
        return {
          ok: false,
          error: {
            message: 'UPDATE_MEMORY schemaVersion chrome.runtime deepseek_pp_memories token secret [object Object]',
          },
        };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(MemoryPage));
    await flushEffects();
    await clickButton('置顶');

    const bodyText = container.textContent ?? '';
    expect(bodyText).toContain('记忆操作失败');
    expect(bodyText).toContain('记忆后端不可用，请重新加载扩展后再试。');
    expect(bodyText).toContain('Tone preference');
    expect(bodyText).toContain('置顶');
    expect(bodyText).not.toContain('取消置顶');
    expect(bodyText).not.toContain('UPDATE_MEMORY');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.runtime');
    expect(bodyText).not.toContain('deepseek_pp_memories');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');
  });

  it('keeps the memory form open when save fails', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'SAVE_MEMORY') throw new Error('quota exceeded');
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(MemoryPage));
    await flushEffects();
    await clickButton('新建记忆');
    await enterText('标题', 'Recovery rule');
    await enterText('内容', 'Never claim verification without evidence.');
    await clickButton('保存');

    expect(container.textContent).toContain('记忆操作失败：quota exceeded');
    expect(container.textContent).toContain('新建记忆');
    expect(inputByPlaceholder('标题').value).toBe('Recovery rule');
    expect(inputByPlaceholder('内容').value).toBe('Never claim verification without evidence.');
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

  it('sanitizes prompt control load failures without leaking runtime details', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROMPT_INJECTION_SETTINGS') {
        return {
          ok: false,
          error: { message: 'GET_PROMPT_INJECTION_SETTINGS schemaVersion chrome.storage deepseek_pp_prompt token secret [object Object]' },
        };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(PromptControlPanel));
    await flushEffects();

    const bodyText = container.textContent ?? '';
    expect(bodyText).toContain('读取提示词设置失败');
    expect(bodyText).toContain('提示词设置后端不可用，请重新加载扩展后再试。');
    expect(bodyText).not.toContain('GET_PROMPT_INJECTION_SETTINGS');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('deepseek_pp_prompt');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');
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
    expect((memoryToggle as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    expect((memoryToggle as HTMLButtonElement).getAttribute('aria-label')).toBe('记忆注入: 开启');
  });

  it('sanitizes prompt control save failures and restores the previous confirmed state', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROMPT_INJECTION_SETTINGS') return DEFAULT_PROMPT_INJECTION_SETTINGS;
      if (message.type === 'SAVE_PROMPT_INJECTION_SETTINGS') {
        return {
          ok: false,
          error: { message: 'SAVE_PROMPT_INJECTION_SETTINGS schemaVersion chrome.runtime deepseek_pp_prompt token secret [object Object]' },
        };
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

    const bodyText = container.textContent ?? '';
    expect(bodyText).toContain('保存提示词设置失败');
    expect(bodyText).toContain('提示词设置后端不可用，请重新加载扩展后再试。');
    expect((memoryToggle as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    expect((memoryToggle as HTMLButtonElement).getAttribute('aria-label')).toBe('记忆注入: 开启');
    expect(bodyText).not.toContain('SAVE_PROMPT_INJECTION_SETTINGS');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.runtime');
    expect(bodyText).not.toContain('deepseek_pp_prompt');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');
  });

  it('sanitizes voice setting load failures without leaking runtime details', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_VOICE_SETTINGS') {
        return {
          ok: false,
          error: {
            message: 'GET_VOICE_SETTINGS schemaVersion chrome.storage deepseek_pp_voice_settings token secret [object Object]',
          },
        };
      }
      if (message.type === 'GET_VOICE_CAPABILITIES') {
        return { speechRecognition: true, speechSynthesis: true };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(VoiceSettingsPanel));
    await flushEffects();

    const bodyText = container.textContent ?? '';
    expect(bodyText).toContain('读取语音设置失败');
    expect(bodyText).toContain('语音设置后端不可用，请重新加载扩展后再试。');
    expect(bodyText).not.toContain('GET_VOICE_SETTINGS');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('deepseek_pp_voice_settings');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');
  });

  it('sanitizes voice setting save failures and restores the previous confirmed state', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_VOICE_SETTINGS') return DEFAULT_VOICE_SETTINGS;
      if (message.type === 'GET_VOICE_CAPABILITIES') {
        return { speechRecognition: true, speechSynthesis: true };
      }
      if (message.type === 'SAVE_VOICE_SETTINGS') {
        return {
          ok: false,
          error: {
            message: 'SAVE_VOICE_SETTINGS schemaVersion chrome.runtime deepseek_pp_voice_settings token secret [object Object]',
          },
        };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(VoiceSettingsPanel));
    await flushEffects();
    const voiceToggle = container.querySelector('button[role="switch"]');
    expect(voiceToggle).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      voiceToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const bodyText = container.textContent ?? '';
    expect(bodyText).toContain('保存语音设置失败');
    expect(bodyText).toContain('语音设置后端不可用，请重新加载扩展后再试。');
    expect((voiceToggle as HTMLButtonElement).getAttribute('aria-checked')).toBe('false');
    expect((voiceToggle as HTMLButtonElement).getAttribute('aria-label')).toBe('语音输入: 关闭');
    expect(bodyText).not.toContain('SAVE_VOICE_SETTINGS');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.runtime');
    expect(bodyText).not.toContain('deepseek_pp_voice_settings');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');
  });

  it('shows voice setting save failures and restores the previous confirmed state', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_VOICE_SETTINGS') return DEFAULT_VOICE_SETTINGS;
      if (message.type === 'GET_VOICE_CAPABILITIES') {
        return { speechRecognition: true, speechSynthesis: true };
      }
      if (message.type === 'SAVE_VOICE_SETTINGS') {
        return { ok: false, error: 'speech synthesis denied' };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(VoiceSettingsPanel));
    await flushEffects();
    const voiceToggle = container.querySelector('button[role="switch"]');
    expect(voiceToggle).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      voiceToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('保存语音设置失败：speech synthesis denied');
    expect((voiceToggle as HTMLButtonElement).getAttribute('aria-checked')).toBe('false');
    expect((voiceToggle as HTMLButtonElement).getAttribute('aria-label')).toBe('语音输入: 关闭');
  });

  it('keeps loaded voice settings when capability detection fails', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_VOICE_SETTINGS') return {
        ...DEFAULT_VOICE_SETTINGS,
        readAloudEnabled: true,
      };
      if (message.type === 'GET_VOICE_CAPABILITIES') {
        throw new Error('capabilities unavailable');
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(VoiceSettingsPanel));
    await flushEffects();
    const toggles = Array.from(container.querySelectorAll('button[role="switch"]'));

    expect(toggles[1]?.getAttribute('aria-checked')).toBe('true');
    expect(toggles[1]?.getAttribute('aria-label')).toBe('朗读回复: 开启, 不可用');
    expect(container.textContent).not.toContain('读取语音设置失败');
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
    expect(container.textContent).toContain('健康');
    expect(container.textContent).toContain('被拒绝');

    await clickButton('刷新登录');
    await flushEffects();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'REFRESH_DEEPSEEK_WEB_AUTH' });
    expect(container.textContent).toContain('已从当前标签页刷新 DeepSeek 登录状态。');
    expect(container.textContent).toContain('已登录');
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

    const recoverButton = buttonByText('刷新登录');
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
    expect(container.textContent).toContain('DeepSeek 登录缺失');
    expect(container.textContent).toContain('目标缺失');

    await clickButton('检查就绪');
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

    expect(container.textContent).toContain('DeepSeek++ 已准备好运行。');
    expect(container.textContent).toContain('就绪');
    expect(container.textContent).toContain('存储正常');
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
    expect(container.textContent).toContain('已刷新 DeepSeek 登录并启动自动化重试。');
  });

  it('saves Runtime Doctor recovery suggestions as sanitized memories', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: Record<string, unknown> }) => {
      if (message.type === 'GET_RUNTIME_DOCTOR_REPORT') return {
        ...createRuntimeDoctorReport({
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
        }),
        debugDistiller: {
          enabled: true,
          suggestions: [{
            id: 'automation-failure-automation-1',
            kind: 'memory',
            title: 'Remember automation recovery: Visual check',
            preview: 'When automation "Visual check" fails in phase "runner" with "automation_executor_failed", refresh DeepSeek Web auth and retry the run before changing the task.',
            reason: 'Latest retryable automation failure can become a personal recovery memory.',
          }],
        },
      };
      if (message.type === 'SAVE_MEMORY') return { id: 7 };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(RuntimeDoctorPage));
    await flushEffects();
    expect(container.textContent).toContain('Remember automation recovery: Visual check');
    expect(container.textContent).not.toMatch(/Bearer|secret|data:image|AAAA/);
    const saveButton = buttonByText('保存记忆');
    expect(saveButton.getAttribute('data-slot')).toBe('button');
    expect(saveButton.getAttribute('data-variant')).toBe('outline');
    expect(saveButton.getAttribute('data-size')).toBe('xs');

    await clickButton('保存记忆');
    await flushEffects();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SAVE_MEMORY',
      payload: {
        type: 'feedback',
        name: 'Remember automation recovery: Visual check',
        content: 'When automation "Visual check" fails in phase "runner" with "automation_executor_failed", refresh DeepSeek Web auth and retry the run before changing the task.',
        description: 'Latest retryable automation failure can become a personal recovery memory.',
        tags: ['automation', 'runtime-doctor', 'recovery'],
        pinned: false,
      },
    });
    expect(JSON.stringify(sendMessage.mock.calls)).not.toMatch(/Bearer|secret|data:image|AAAA/);
    expect(container.textContent).toContain('恢复记忆已保存。');
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
    expect(container.textContent).toContain('视觉运行使用图片模式');
    expect(container.textContent).toContain('文本类搜索或推理任务请关闭视觉捕获');
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
    expectShadcnButton('应用安全修正', 'outline', 'xs');
    expectShadcnButton('创建', 'default', 'sm');

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

  it('saves successful follow-up automation chains from the form', async () => {
    const followUp = createAutomationForPage({
      id: 'automation-review',
      name: 'Review queue',
      prompt: 'Review the result, grade it, iterate once, then stop.',
    });
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTOMATIONS') return [followUp];
      if (message.type === 'CREATE_AUTOMATION') return {
        id: 'automation-chain-source',
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
    await enterText('任务名称', 'Research queue');
    await enterText(
      '输入要定时发送到 DeepSeek 的内容',
      'Research the source, evaluate evidence, review contradictions, grade confidence, iterate once, then stop.',
    );
    await toggleRow('成功后运行后续任务');
    const chainGroup = container.querySelector<HTMLElement>('[data-slot="toggle-group"][data-variant="outline"]');
    expect(chainGroup).toBeTruthy();
    const chainTarget = buttonByText('Review queue');
    expect(chainTarget.getAttribute('data-slot')).toBe('toggle-group-item');
    expect(chainTarget.getAttribute('data-state')).toBe('off');
    await clickButton('Review queue');
    expect(buttonByText('Review queue').getAttribute('data-state')).toBe('on');
    await clickButton('创建');
    await flushEffects();

    const createCall = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is {
        type: 'CREATE_AUTOMATION';
        payload: {
          chain: {
            enabled: boolean;
            onSuccessAutomationIds: string[];
            maxDepth: number;
          };
        };
      } => message.type === 'CREATE_AUTOMATION');

    expect(createCall?.payload.chain).toEqual({
      enabled: true,
      onSuccessAutomationIds: ['automation-review'],
      maxDepth: 3,
    });
    expect(JSON.stringify(createCall?.payload)).not.toMatch(/data:image|dataBase64|blob:|Authorization|Bearer|Cookie|secret-token/);
  });

  it('adds a visible self-review gate when enabled', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTOMATIONS') return [];
      if (message.type === 'CREATE_AUTOMATION') return {
        id: 'automation-review-gate',
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
    await enterText('任务名称', 'Self reviewer');
    await enterText(
      '输入要定时发送到 DeepSeek 的内容',
      'Plan the work, evaluate evidence, review risks, grade confidence, iterate once, then stop.',
    );
    await toggleRow('自评 / 评分 / 迭代');
    await clickButton('创建');
    await flushEffects();

    const createCall = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is {
        type: 'CREATE_AUTOMATION';
        payload: { prompt: string };
      } => message.type === 'CREATE_AUTOMATION');

    expect(createCall?.payload.prompt).toContain('Review gate: After the first draft');
    expect(createCall?.payload.prompt).toContain('grade confidence A-F');
    expect(createCall?.payload.prompt).toContain('iterate once when the grade is below A');
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
    expectShadcnButton('补强循环', 'outline', 'xs');
    expectShadcnButton('创建', 'default', 'sm');

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
    expectShadcnButton('准备运行', 'default', 'xs');
    expectShadcnButton('创建', 'default', 'sm');

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
    await toggleAutomationSwitch('联网');
    await toggleAutomationSwitch('深度思考');
    await selectAutomationOption('模型', '视觉');

    expect(container.textContent).toContain('视觉运行使用图片模式');
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
    expectShadcnButton('使用', 'outline', 'xs');

    await clickButton('使用');
    expect(Array.from(container.querySelectorAll('button')).filter((button) => button.textContent === '使用')).toHaveLength(0);
    expect(inputByPlaceholder('任务名称').value).toBe('运行就绪恢复');
    expect(inputByPlaceholder('输入要定时发送到 DeepSeek 的内容').value).toContain('规划就绪检查');
    expect(container.textContent).toContain('就绪评分');
    expect(container.textContent).toContain('A · 100');
    expect(container.textContent).toContain('可以运行。');
    expectShadcnButton('添加图片', 'outline', 'sm');
    expectShadcnButton('取消', 'outline', 'sm');
    expectShadcnButton('创建', 'default', 'sm');

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

  it('promotes the repair-and-verify launcher while preserving long-loop budgets', async () => {
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_AUTOMATIONS') return [];
      if (message.type === 'CREATE_AUTOMATION') return {
        id: 'automation-repair-loop',
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

    const pageText = container.textContent ?? '';
    expect(pageText).toContain('启动一次专注运行');
    expect(pageText).toContain('模板');
    expect(pageText.indexOf('启动一次专注运行')).toBeLessThan(pageText.indexOf('模板'));
    expectShadcnButton('准备运行', 'default', 'sm');

    await enterText('目标、范围或故障', 'Fix failing automation tests and update the proof ledger.');
    await clickButton('准备运行');

    expect(inputByPlaceholder('任务名称').value).toBe('修复与验证循环');
    expect(inputByPlaceholder('输入要定时发送到 DeepSeek 的内容').value)
      .toContain('Fix failing automation tests and update the proof ledger.');
    expect(container.textContent).toContain('60 分钟');
    expect(container.textContent).toContain('25 轮工具延续');

    await clickButton('创建');
    await flushEffects();

    const createCall = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is {
        type: 'CREATE_AUTOMATION';
        payload: {
          prompt: string;
          schedule: { timeoutMs?: number };
          promptOptions: { maxToolContinuationTurns?: number };
        };
      } => message.type === 'CREATE_AUTOMATION');

    expect(createCall?.payload.prompt).toContain('Fix failing automation tests and update the proof ledger.');
    expect(createCall?.payload.schedule.timeoutMs).toBe(3_600_000);
    expect(createCall?.payload.promptOptions.maxToolContinuationTurns).toBe(25);
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
    expect(container.textContent).toContain('手动');
    expect(container.textContent).toContain('联网');
    expect(container.textContent).toContain('深度思考');
    expect(container.textContent).toContain('视觉');

    await selectAutomationTemplateCategory('project');
    expect(container.textContent).toContain('实现委员会');
    expect(container.textContent).toContain('项目状态委员会');
    expect(container.textContent).not.toContain('来源监控');

    await selectAutomationTemplateCategory('quality');
    expect(container.textContent).toContain('系统调试循环');
    expect(container.textContent).toContain('评审评分迭代');
    expect(container.textContent).not.toContain('实现委员会');

    await selectAutomationTemplateCategory('all');
    expect(container.textContent).toContain('实现委员会');
    expect(container.textContent).toContain('来源监控');

    await enterText('搜索工作流', '调试');
    expect(container.textContent).toContain('系统调试循环');
    expect(container.textContent).not.toContain('来源监控');

    await enterText('搜索工作流', 'zzzz');
    expect(container.textContent).toContain('没有匹配的工作流。');
  });

  it('cycles the automation session strategy from the page header', async () => {
    let config = {
      enabled: true,
      autoReadyCheckBeforeRun: true,
      autoRefreshWebAuth: true,
      sameSessionStrategy: 'last',
      visualMonitorDefault: true,
      reducedConfirmations: true,
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: Partial<typeof config> }) => {
      if (message.type === 'GET_AUTOMATIONS') return [];
      if (message.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return { ok: true, config };
      if (message.type === 'SAVE_PERSONAL_CONVENIENCE_CONFIG') {
        config = { ...config, ...message.payload };
        return { ok: true, config };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();

    expect(container.textContent).toContain('对话目标: 继续上次对话');
    expectShadcnButton('对话目标: 继续上次对话', 'outline', 'sm');
    expectShadcnButton('新建', 'default', 'sm');
    await clickButton('对话目标: 继续上次对话');
    expect(container.textContent).toContain('对话目标: 使用当前对话');
    await clickButton('对话目标: 使用当前对话');
    expect(container.textContent).toContain('对话目标: 新建对话');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SAVE_PERSONAL_CONVENIENCE_CONFIG',
      payload: { sameSessionStrategy: 'current' },
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SAVE_PERSONAL_CONVENIENCE_CONFIG',
      payload: { sameSessionStrategy: 'new' },
    });
    expect(JSON.stringify(sendMessage.mock.calls)).not.toMatch(/chatSessionId|parentMessageId|session-[a-z0-9_-]+/i);
  });

  it('filters saved automations by name and prompt', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTOMATIONS') return [
        createAutomationForPage({
          id: 'automation-research',
          name: 'Research digest',
          prompt: 'Research source updates and stop.',
        }),
        createAutomationForPage({
          id: 'automation-visual',
          name: 'Visual page check',
          status: 'paused',
          prompt: 'Inspect browser target visually and stop.',
        }),
        createAutomationForPage({
          id: 'automation-blocked',
          name: 'Blocked vision',
          prompt: 'Look at the current page and stop.',
          promptOptions: { modelType: 'vision', searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
        }),
      ];
      if (message.type === 'GET_AUTOMATION_RUNS') return [];
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();
    expect(container.textContent).toContain('Research digest');
    expect(container.textContent).toContain('Visual page check');
    expect(container.textContent).toContain('Blocked vision');
    expect(container.textContent).toContain('全部3');
    expect(container.textContent).toContain('启用2');
    expect(container.textContent).toContain('暂停1');
    expect(container.textContent).toContain('阻塞1');
    expect(container.textContent).toContain('可运行1');
    expect(container.textContent).toContain('需处理1');
    expect(container.textContent).toContain('运行中0');
    expect(container.textContent).toContain('模板');
    expect(container.textContent).not.toContain('启动一次专注运行');
    const filterGroup = container.querySelector<HTMLElement>('.ds-automation-filter-rail [data-slot="toggle-group"]');
    expect(filterGroup).toBeTruthy();
    expect(filterGroup?.getAttribute('data-variant')).toBe('outline');
    expect(filterGroup?.getAttribute('data-size')).toBe('sm');
    expect(container.querySelectorAll('.ds-automation-filter-rail [data-slot="toggle-group-item"]')).toHaveLength(4);
    const pausedFilterItem = Array.from(container.querySelectorAll<HTMLButtonElement>('.ds-automation-filter-rail [data-slot="toggle-group-item"]'))
      .find((button) => button.getAttribute('aria-label') === '暂停');
    expect(pausedFilterItem?.textContent).toContain('暂停');
    expect(pausedFilterItem?.textContent).toContain('1');
    const firstCard = Array.from(container.querySelectorAll<HTMLElement>('.ds-card'))
      .find((card) => card.textContent?.includes('Research digest'));
    expect(firstCard?.querySelector<HTMLButtonElement>('button[aria-label="暂停"]')?.getAttribute('data-slot')).toBe('tooltip-trigger');
    expect(firstCard?.querySelector<HTMLButtonElement>('button[aria-label="暂停"]')?.getAttribute('data-size')).toBe('icon-sm');
    expect(firstCard?.querySelector<HTMLButtonElement>('button[aria-label="暂停"]')?.getAttribute('data-variant')).toBe('ghost');
    expect(firstCard?.querySelector<HTMLButtonElement>('button[aria-label="编辑"]')?.getAttribute('data-variant')).toBe('ghost');
    expect(firstCard?.querySelector<HTMLButtonElement>('button[aria-label="删除"]')?.getAttribute('data-variant')).toBe('destructive');

    await enterText('搜索自动化', 'visual');
    expect(container.textContent).not.toContain('Research digest');
    expect(container.textContent).toContain('Visual page check');
    expect(container.textContent).not.toContain('Blocked vision');

    await enterText('搜索自动化', 'updates');
    expect(container.textContent).toContain('Research digest');
    expect(container.textContent).not.toContain('Visual page check');
    expect(container.textContent).not.toContain('Blocked vision');

    await enterText('搜索自动化', 'missing');
    expect(container.textContent).toContain('没有匹配的自动化');
    expect(container.textContent).toContain('显示 0 / 3');

    await clickButton('清除筛选');
    expect(container.textContent).toContain('Research digest');
    expect(container.textContent).toContain('Visual page check');
    expect(container.textContent).toContain('Blocked vision');

    await enterText('搜索自动化', '');
    await clickAutomationListFilter('暂停');
    expect(container.textContent).not.toContain('Research digest');
    expect(container.textContent).toContain('Visual page check');
    expect(container.textContent).not.toContain('Blocked vision');

    await clickAutomationListFilter('阻塞');
    expect(container.textContent).not.toContain('Research digest');
    expect(container.textContent).not.toContain('Visual page check');
    expect(container.textContent).toContain('Blocked vision');

    await clickAutomationListFilter('全部');
    expect(container.textContent).toContain('Research digest');
    expect(container.textContent).toContain('Visual page check');
    expect(container.textContent).toContain('Blocked vision');
  });

  it('uses a shadcn Automation status card to route blocked tasks', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTOMATIONS') return [
        createAutomationForPage({
          id: 'automation-research',
          name: 'Research digest',
          prompt: 'Research source updates and stop.',
        }),
        createAutomationForPage({
          id: 'automation-visual',
          name: 'Visual page check',
          status: 'paused',
          prompt: 'Inspect browser target visually and stop.',
        }),
        createAutomationForPage({
          id: 'automation-blocked',
          name: 'Blocked vision',
          prompt: 'Look at the current page and stop.',
          promptOptions: { modelType: 'vision', searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
        }),
      ];
      if (message.type === 'GET_AUTOMATION_RUNS_BATCH') return {};
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();

    const statusCard = container.querySelector('.ds-automation-status');
    expect(statusCard?.getAttribute('data-slot')).toBe('card');
    expect(statusCard?.querySelector('[data-slot="card-title"]')?.textContent).toContain('自动化状态');
    expect(statusCard?.querySelector('[data-slot="badge"]')?.textContent).toContain('已阻塞');
    expect(statusCard?.textContent).toContain('3 个任务，2 个启用');
    expect(statusCard?.textContent).toContain('可运行1');
    expect(statusCard?.textContent).toContain('需处理1');
    expect(statusCard?.textContent).toContain('阻塞1');
    expect(statusCard?.textContent).toContain('运行中0');
    expect(statusCard?.querySelector('[data-slot="button"]')?.textContent).toContain('查看阻塞');

    await clickButton('查看阻塞');

    expect(container.textContent).not.toContain('Research digest');
    expect(container.textContent).not.toContain('Visual page check');
    expect(container.textContent).toContain('Blocked vision');
    expect(container.textContent).toContain('显示 1 / 3');
  });

  it('keeps automation load failures sanitized and recoverable from the status card', async () => {
    let attempts = 0;
    const automation = createAutomationForPage({
      id: 'automation-recovered',
      name: 'Recovered automation',
      prompt: 'Continue the verified loop.',
    });
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTOMATIONS') {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('GET_AUTOMATIONS schemaVersion chrome.runtime Bearer data:image/png;base64,AAAA https://secret.example');
        }
        return [automation];
      }
      if (message.type === 'GET_AUTOMATION_RUNS_BATCH') return {};
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();

    expect(container.textContent).toContain('自动化状态');
    expect(container.textContent).toContain('需要刷新');
    expect(container.textContent).toContain('自动化加载失败：自动化后端不可用，请重新加载扩展后再试。');
    expect(container.querySelector('.ds-automation-status')?.querySelector('[data-slot="button"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="alert"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/GET_AUTOMATIONS|schemaVersion|chrome\.runtime|Bearer|data:image|AAAA|https:\/\/secret\.example/);

    const retryButton = container.querySelector<HTMLButtonElement>('.ds-automation-status [data-slot="button"]');
    await act(async () => {
      retryButton?.click();
      await Promise.resolve();
    });
    await flushEffects();

    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_AUTOMATIONS')).toHaveLength(2);
    expect(container.textContent).toContain('Recovered automation');
    expect(container.textContent).not.toContain('需要刷新');
  });

  it('keeps automation action and stored failures sanitized', async () => {
    const automation = createAutomationForPage({
      id: 'automation-run-failure',
      name: 'Runnable automation',
      prompt: 'Plan, evaluate, review, grade, iterate, then stop.',
      lastError: {
        code: 'runtime_failed',
        phase: 'runner',
        retryable: false,
        at: 1,
        message: 'RUN_AUTOMATION_NOW schemaVersion chrome.runtime Bearer data:image/png;base64,AAAA https://secret.example',
      },
    });
    const sendMessage = vi.fn(async (message: { type: string; payload?: { id?: string } }) => {
      if (message.type === 'GET_AUTOMATIONS') return [automation];
      if (message.type === 'GET_AUTOMATION_RUNS_BATCH') return {};
      if (message.type === 'RUN_AUTOMATION_NOW') {
        expect(message.payload?.id).toBe('automation-run-failure');
        return {
          ok: false,
          error: 'RUN_AUTOMATION_NOW schemaVersion chrome.runtime Bearer data:image/png;base64,AAAA https://secret.example',
        };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();

    expect(container.textContent).toContain('自动化操作未能完成。');
    expect(container.textContent).not.toMatch(/RUN_AUTOMATION_NOW|schemaVersion|chrome\.runtime|Bearer|data:image|AAAA|https:\/\/secret\.example/);

    await clickButton('立即运行');
    await flushEffects();

    expect(container.textContent).toContain('自动化操作失败：自动化操作未能完成。');
    expect(container.textContent).toContain('Runnable automation');
    expect(container.textContent).not.toMatch(/RUN_AUTOMATION_NOW|schemaVersion|chrome\.runtime|Bearer|data:image|AAAA|https:\/\/secret\.example/);
  });

  it('loads recent automation runs with one batch request', async () => {
    const automations = [
      createAutomationForPage({ id: 'automation-one', name: 'One' }),
      createAutomationForPage({ id: 'automation-two', name: 'Two' }),
      createAutomationForPage({ id: 'automation-three', name: 'Three' }),
    ];
    const sendMessage = vi.fn(async (message: { type: string; payload?: { automationIds?: string[] } }) => {
      if (message.type === 'GET_AUTOMATIONS') return automations;
      if (message.type === 'GET_AUTOMATION_RUNS_BATCH') {
        expect(message.payload?.automationIds).toEqual(['automation-one', 'automation-two', 'automation-three']);
        return {
          'automation-one': [createAutomationRunForPage({ id: 'run-one', automationId: 'automation-one' })],
          'automation-two': [],
          'automation-three': [],
        };
      }
      if (message.type === 'GET_AUTOMATION_RUNS') return [];
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();

    expect(container.textContent).toContain('One');
    expect(container.textContent).toContain('Two');
    expect(container.textContent).toContain('Three');
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_AUTOMATION_RUNS_BATCH')).toHaveLength(1);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_AUTOMATION_RUNS')).toHaveLength(0);
  });

  it('shows a retryable automation load error instead of a false empty state', async () => {
    let attempts = 0;
    const automation = createAutomationForPage({
      id: 'automation-recovered',
      name: 'Recovered automation',
      prompt: 'Continue the verified loop.',
    });
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_AUTOMATIONS') {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
        return [automation];
      }
      if (message.type === 'GET_AUTOMATION_RUNS_BATCH') return {};
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();

    expect(container.textContent).toContain('自动化不可用');
    expect(container.textContent).toContain('自动化加载失败：offline');
    expect(container.textContent).toContain('重试');
    expect(container.textContent).not.toContain('暂无自动化');
    expect(container.textContent).not.toContain('启动一次专注运行');

    await clickButton('重试');
    await flushEffects();

    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_AUTOMATIONS')).toHaveLength(2);
    expect(container.textContent).toContain('Recovered automation');
    expect(container.textContent).not.toContain('自动化不可用');
    expect(container.textContent).not.toContain('offline');
  });

  it('keeps automations visible when recent run history needs refresh', async () => {
    let runAttempts = 0;
    const automation = createAutomationForPage({
      id: 'automation-run-history',
      name: 'History preserved',
      prompt: 'Check status and preserve the visible task.',
    });
    const sendMessage = vi.fn(async (message: { type: string; payload?: { automationId?: string } }) => {
      if (message.type === 'GET_AUTOMATIONS') return [automation];
      if (message.type === 'GET_AUTOMATION_RUNS_BATCH') throw new Error('batch unavailable');
      if (message.type === 'GET_AUTOMATION_RUNS') {
        expect(message.payload?.automationId).toBe('automation-run-history');
        runAttempts += 1;
        if (runAttempts === 1) throw new Error('runs offline');
        return [createAutomationRunForPage({ id: 'run-recovered', automationId: 'automation-run-history' })];
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();

    expect(container.textContent).toContain('History preserved');
    expect(container.textContent).toContain('最近运行加载失败：runs offline');
    expect(container.textContent).toContain('重试');
    expect(container.textContent).not.toContain('暂无自动化');

    await clickButton('重试');
    await flushEffects();

    expect(container.textContent).toContain('History preserved');
    expect(container.textContent).toContain('成功');
    expect(container.textContent).not.toContain('runs offline');
  });

  it('prepares an existing automation from its card', async () => {
    let automation = createAutomationForPage({
      id: 'automation-needs-prep',
      name: 'Needs prep',
      prompt: 'Run a workflow to research this source and evaluate it.',
      promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
    });
    const sendMessage = vi.fn(async (message: { type: string; payload?: { automationId?: string; id?: string; patch?: Record<string, unknown> } }) => {
      if (message.type === 'GET_AUTOMATIONS') return [automation];
      if (message.type === 'GET_AUTOMATION_RUNS') return [];
      if (message.type === 'UPDATE_AUTOMATION') {
        expect(message.payload?.id).toBe('automation-needs-prep');
        automation = { ...automation, ...(message.payload?.patch ?? {}) };
        return automation;
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();
    expectShadcnButton('准备运行', 'outline', 'sm');
    expect(container.textContent).toContain('Needs prep');
    expect(container.textContent).toContain('准备运行');

    await clickButton('准备运行');
    await flushEffects();

    const updateCall = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is {
        type: 'UPDATE_AUTOMATION';
        payload: {
          patch: {
            prompt: string;
            promptOptions: {
              searchEnabled: boolean;
              thinkingEnabled: boolean;
            };
          };
        };
      } => message.type === 'UPDATE_AUTOMATION');

    expect(updateCall?.payload.patch.prompt).toContain('Workflow contract: Plan the work, evaluate evidence, review risks, grade confidence, iterate once if useful, then stop');
    expect(updateCall?.payload.patch.promptOptions.searchEnabled).toBe(true);
    expect(updateCall?.payload.patch.promptOptions.thinkingEnabled).toBe(true);
    expect(JSON.stringify(updateCall?.payload)).not.toMatch(/data:image|dataBase64|blob:|Authorization|Bearer|Cookie|secret-token/);
  });

  it('prepares all eligible automations from the header action', async () => {
    const needsPrep = createAutomationForPage({
      id: 'automation-needs-prep',
      name: 'Needs prep',
      prompt: 'Run a workflow to research this source and evaluate it.',
      promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
    });
    const blocked = createAutomationForPage({
      id: 'automation-blocked-secret',
      name: 'Blocked secret',
      prompt: 'Use Authorization: Bearer secret-token, then stop.',
    });
    const ready = createAutomationForPage({
      id: 'automation-ready',
      name: 'Ready',
      prompt: 'Plan, evaluate, review, grade, iterate, then stop.',
      promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: true, refFileIds: [] },
    });
    const sendMessage = vi.fn(async (message: { type: string; payload?: { id?: string; patch?: Record<string, unknown> } }) => {
      if (message.type === 'GET_AUTOMATIONS') return [needsPrep, blocked, ready];
      if (message.type === 'GET_AUTOMATION_RUNS') return [];
      if (message.type === 'UPDATE_AUTOMATION') return { ok: true };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();
    expectShadcnButton('全部准备', 'outline', 'sm');
    expectShadcnButton('模板', 'outline', 'sm');
    expectShadcnButton('新建', 'default', 'sm');
    await clickButton('全部准备');
    await flushEffects();

    const updateCalls = sendMessage.mock.calls
      .map(([message]) => message)
      .filter((message): message is {
        type: 'UPDATE_AUTOMATION';
        payload: {
          id: string;
          patch: {
            prompt?: string;
            promptOptions?: {
              searchEnabled?: boolean;
              thinkingEnabled?: boolean;
            };
          };
        };
      } => message.type === 'UPDATE_AUTOMATION');

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload.id).toBe('automation-needs-prep');
    expect(updateCalls[0].payload.patch.prompt).toContain('Workflow contract: Plan the work');
    expect(updateCalls[0].payload.patch.promptOptions).toMatchObject({ searchEnabled: true, thinkingEnabled: true });
    expect(JSON.stringify(updateCalls)).not.toMatch(/secret-token|Authorization|Bearer|Cookie|data:image/);
    expect(container.textContent).toContain('已准备 1 个自动化。');
  });

  it('disables run now for readiness-blocked automation cards', async () => {
    const automation = createAutomationForPage({
      id: 'automation-blocked',
      name: 'Blocked vision',
      prompt: 'Look at the current page and stop.',
      promptOptions: { modelType: 'vision', searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
    });
    const sendMessage = vi.fn(async (message: { type: string; payload?: { automationId?: string } }) => {
      if (message.type === 'GET_AUTOMATIONS') return [automation];
      if (message.type === 'GET_AUTOMATION_RUNS') return [];
      if (message.type === 'RUN_AUTOMATION_NOW') return { ok: false, error: 'should_not_run' };
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();

    const blockedButton = buttonByText('已阻塞');
    expect(blockedButton.getAttribute('data-slot')).toBe('button');
    expect(blockedButton.getAttribute('data-variant')).toBe('default');
    expect(blockedButton.getAttribute('data-size')).toBe('sm');
    expect(blockedButton.disabled).toBe(true);
    await act(async () => {
      blockedButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(sendMessage.mock.calls.some(([message]) => message.type === 'RUN_AUTOMATION_NOW')).toBe(false);
  });

  it('surfaces automation run failures while preserving the task row', async () => {
    const automation = createAutomationForPage({
      id: 'automation-run-failure',
      name: 'Runnable automation',
      prompt: 'Plan, evaluate, review, grade, iterate, then stop.',
    });
    const sendMessage = vi.fn(async (message: { type: string; payload?: { id?: string } }) => {
      if (message.type === 'GET_AUTOMATIONS') return [automation];
      if (message.type === 'GET_AUTOMATION_RUNS_BATCH') return {};
      if (message.type === 'RUN_AUTOMATION_NOW') {
        expect(message.payload?.id).toBe('automation-run-failure');
        return { ok: false, error: { message: 'executor offline' } };
      }
      return null;
    });
    stubChrome(sendMessage);

    await renderElement(React.createElement(AutomationPage));
    await flushEffects();
    expectShadcnButton('立即运行', 'default', 'sm');
    await clickButton('立即运行');
    await flushEffects();

    expect(container.textContent).toContain('自动化操作失败：executor offline');
    expect(container.textContent).toContain('Runnable automation');
    expect(container.textContent).not.toMatch(/Authorization|Bearer|Cookie|data:image/);
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
    expect(container.textContent).toContain('复盘简报');
    expect(container.textContent).toContain('Automation run replay brief');
    expect(container.textContent).not.toMatch(/sk-proj|secret-token|Authorization|Bearer|Cookie:|data:image/);
  });
});

async function renderElement(element: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(TooltipProvider, null, element));
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

async function clickConfirmDelete() {
  const button = document.body.querySelector<HTMLButtonElement>('.ds-modal-card .ds-btn-danger');
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

async function clickAutomationListFilter(label: string) {
  inputByPlaceholder('搜索自动化');
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.ds-automation-filter-rail button'))
    .find((candidate) => candidate.getAttribute('aria-label') === label);
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function selectAutomationTemplateCategory(value: string) {
  const labels: Record<string, string> = {
    all: '全部',
    project: '项目',
    quality: '质量',
  };
  await selectAutomationOption('分类', labels[value] ?? value);
}

async function selectAutomationOption(label: string, optionLabel: string) {
  const trigger = getAutomationSelectTrigger(label);
  await act(async () => {
    trigger.dispatchEvent(createMousePointerEvent('pointerdown'));
    await Promise.resolve();
  });
  const content = document.body.querySelector<HTMLElement>('[data-slot="select-content"]');
  expect(content).toBeTruthy();
  const option = Array.from(content!.querySelectorAll<HTMLElement>('[data-slot="select-item"]'))
    .find((item) => item.textContent === optionLabel);
  expect(option).toBeTruthy();
  await act(async () => {
    option!.dispatchEvent(createMousePointerEvent('pointermove'));
    option!.dispatchEvent(createMousePointerEvent('pointerup'));
    await Promise.resolve();
  });
}

function getAutomationSelectTrigger(label: string): HTMLButtonElement {
  const labelNode = Array.from(container.querySelectorAll<HTMLElement>('.ds-automation-select-field [data-slot="field-label"]'))
    .find((candidate) => candidate.textContent === label);
  expect(labelNode).toBeTruthy();
  const trigger = labelNode
    ?.closest('.ds-automation-select-field')
    ?.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]');
  expect(trigger).toBeTruthy();
  return trigger!;
}

async function toggleAutomationSwitch(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`);
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function toggleRow(label: string) {
  const labelNode = Array.from(container.querySelectorAll('label, [data-slot="field-label"], div'))
    .find((candidate) => candidate.textContent === label);
  const row = labelNode?.closest('.ds-toggle-row') ?? labelNode?.closest('.flex.justify-between');
  const button = row?.querySelector<HTMLButtonElement>('button[role="switch"], [data-slot="switch"]');
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function toggleVisualMonitor() {
  const labelNode = Array.from(container.querySelectorAll('label, [data-slot="field-label"], div'))
    .find((candidate) => candidate.textContent === '运行开始时捕获已选择的浏览器标签页');
  const row = labelNode?.closest('.ds-toggle-row');
  const button = row?.querySelector<HTMLButtonElement>('button[role="switch"], [data-slot="switch"]');
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

function createMousePointerEvent(type: string): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    ctrlKey: false,
    clientX: 1,
    clientY: 1,
  });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

function buttonByText(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function expectShadcnButton(label: string, variant?: string, size?: string): HTMLButtonElement {
  const button = buttonByText(label);
  expect(button.getAttribute('data-slot')).toBe('button');
  if (variant) expect(button.getAttribute('data-variant')).toBe(variant);
  if (size) expect(button.getAttribute('data-size')).toBe(size);
  return button;
}

function createAutomationForPage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'automation-1',
    name: 'Automation',
    prompt: 'Check status.',
    status: 'active',
    schedule: { kind: 'manual', expression: null, timezone: 'UTC', enabled: false, minimumIntervalMinutes: 15 },
    promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
    chain: { enabled: false, onSuccessAutomationIds: [], maxDepth: 3 },
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

function createMemoryForPage(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    type: 'user',
    name: 'Memory',
    content: 'Remember this.',
    description: 'Memory',
    tags: [],
    pinned: false,
    scope: 'global',
    createdAt: Date.now(),
    updatedAt: Date.now(),
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
  const row = title?.closest('.ds-toggle-row') ?? title?.closest('.flex');
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
