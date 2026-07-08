import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatPage, { createChatHomeContextItems } from '../entrypoints/sidepanel/pages/ChatPage';
import type { ChatToolEvent } from '../core/types';
import { PROJECT_CONTEXT_SCHEMA_VERSION } from '../core/project';

type RuntimeMessage = {
  type: string;
  streamId?: string;
  text?: string;
  reasoningText?: string;
  toolEvents?: ChatToolEvent[];
  payload?: unknown;
  done?: boolean;
  error?: string;
};

type SubmittedImage = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
};

type ChatSubmitMessage = {
  type: 'CHAT_SUBMIT_PROMPT';
  payload: {
    text: string;
    streamId?: string;
    images?: SubmittedImage[];
    config?: unknown;
  };
};

let container: HTMLDivElement;
let root: Root | null;
let sendMessage: ReturnType<typeof vi.fn>;
let permissionsContains: ReturnType<typeof vi.fn>;
let permissionsRequest: ReturnType<typeof vi.fn>;
let objectUrlSeq = 0;
let createdObjectUrls: string[];
let revokedObjectUrls: string[];
let runtimeListeners: Array<(message: RuntimeMessage) => void>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  createdObjectUrls = [];
  revokedObjectUrls = [];
  runtimeListeners = [];
  objectUrlSeq = 0;
  permissionsContains = vi.fn(async () => true);
  permissionsRequest = vi.fn(async () => true);
  sendMessage = vi.fn(async (message: RuntimeMessage) => {
    if (message.type === 'GET_AUTH_STATUS') {
      return { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true };
    }
    if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return undefined;
    if (message.type === 'GET_VOICE_SETTINGS') return undefined;
    if (message.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') {
      return {
        ok: true,
        config: {
          enabled: true,
          autoReadyCheckBeforeRun: true,
          autoRefreshWebAuth: true,
          sameSessionStrategy: 'last',
          visualMonitorDefault: true,
          reducedConfirmations: true,
        },
      };
    }
    if (message.type === 'GET_SKILL_LIBRARY') {
      return [
        {
          name: 'summarize',
          description: 'Summarize the current page.',
          instructions: 'Summarize clearly.',
          source: 'custom',
          memoryEnabled: false,
          enabled: true,
        },
        {
          name: 'review',
          description: 'Review for risks.',
          instructions: 'Find risks.',
          source: 'custom',
          memoryEnabled: true,
          enabled: true,
        },
        {
          name: 'disabled',
          description: 'Should stay hidden.',
          instructions: 'Hidden.',
          source: 'custom',
          memoryEnabled: false,
          enabled: false,
        },
      ];
    }
    if (message.type === 'GET_PROJECT_CONTEXT_STATE') {
      return {
        schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
        projects: [{
          id: 'project-1',
          name: 'Run1',
          description: '',
          instructions: 'First run',
          createdAt: 1,
          updatedAt: 3,
        }],
        conversations: [],
        pendingProjectId: 'project-1',
      };
    }
    if (message.type === 'GET_MEMORIES') {
      return [{
        id: 1,
        syncId: 'memory-1',
        scope: 'global',
        type: 'preference',
        name: 'Tone preference',
        content: 'Be concise.',
        description: 'User communication preference',
        tags: ['style'],
        pinned: true,
        createdAt: 1,
        updatedAt: 4,
        accessCount: 0,
        lastAccessedAt: 0,
      }];
    }
    if (message.type === 'GET_SAVED_ITEMS') {
      return [{
        id: 'saved-1',
        syncId: 'saved-sync-1',
        kind: 'snippet',
        title: 'Review checklist',
        content: 'Check risks.',
        tags: ['review'],
        createdAt: 1,
        updatedAt: 5,
      }];
    }
    if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') {
      return {
        ok: true,
        conversation: {
          conversationId: 'chat-1',
          title: 'Current DeepSeek task',
          url: 'https://chat.deepseek.com/a/chat/s/chat-1',
        },
      };
    }
    if (message.type === 'CAPTURE_CURRENT_TAB_IMAGE') {
      return {
        ok: true,
        image: {
          name: 'captured-tab.png',
          mimeType: 'image/png',
          sizeBytes: 5,
          dataUrl: `data:image/png;base64,${btoa('probe')}`,
        },
        tab: {
          id: 12,
          windowId: 1,
          title: 'Example',
          url: 'https://example.com/',
        },
      };
    }
    if (message.type === 'CAPTURE_BROWSER_CONTROL_TARGET_IMAGE') {
      return {
        ok: true,
        image: {
          name: 'browser-control-12.png',
          mimeType: 'image/png',
          sizeBytes: 7,
          dataUrl: `data:image/png;base64,${btoa('browser')}`,
        },
        tab: {
          id: 12,
          windowId: 1,
        },
      };
    }
    if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
    return null;
  });
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener: (message: RuntimeMessage) => void) => {
          runtimeListeners.push(listener);
        }),
        removeListener: vi.fn((listener: (message: RuntimeMessage) => void) => {
          runtimeListeners = runtimeListeners.filter((item) => item !== listener);
        }),
      },
    },
    permissions: {
      contains: permissionsContains,
      request: permissionsRequest,
    },
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:deepseek-pp-test-${objectUrlSeq += 1}`;
    createdObjectUrls.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revokedObjectUrls.push(url);
  });
});

afterEach(() => {
  vi.useRealTimers();
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sidepanel chat image attachments', () => {
  it('builds Home recent context from real project and conversation state only', () => {
    const items = createChatHomeContextItems({
      schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
      projects: [
        {
          id: 'project-1',
          name: 'Run1',
          description: '',
          instructions: 'Use verified project context.',
          createdAt: 10,
          updatedAt: 30,
        },
        {
          id: 'project-2',
          name: 'Research',
          description: '',
          instructions: '',
          createdAt: 12,
          updatedAt: 40,
        },
        {
          id: 'project-3',
          name: 'Homework',
          description: '',
          instructions: '',
          createdAt: 14,
          updatedAt: 35,
        },
      ],
      conversations: [
        {
          conversationId: 'current-1',
          projectId: 'project-1',
          title: 'Current DeepSeek task',
          url: 'https://chat.deepseek.com/a/chat/s/current-1',
          addedAt: 18,
          lastSeenAt: 60,
        },
        {
          conversationId: 'conversation-1',
          projectId: 'project-2',
          title: 'DeepSeek - Into the Unknown',
          url: 'https://chat.deepseek.com/a/chat/s/conversation-1',
          addedAt: 20,
          lastSeenAt: 50,
        },
      ],
      pendingProjectId: null,
    }, {
      conversationId: 'current-1',
      title: 'Current DeepSeek task',
      url: 'https://chat.deepseek.com/a/chat/s/current-1',
    });

    expect(items).toEqual([
      {
        key: 'current-current-1',
        title: 'Current DeepSeek task',
        detailText: 'Run1',
        detailKey: 'sidepanel.chatPage.currentDeepSeekConversation',
        projectId: 'project-1',
      },
      {
        key: 'conversation-conversation-1',
        title: 'DeepSeek - Into the Unknown',
        detailText: 'Research',
        detailKey: 'sidepanel.chatPage.projectConversation',
        projectId: 'project-2',
      },
      {
        key: 'project-project-3',
        title: 'Homework',
        detailKey: 'sidepanel.chatPage.recentProject',
        projectId: 'project-3',
      },
    ]);
    expect(JSON.stringify(items)).not.toMatch(/mock|placeholder|sample/i);
  });

  it('queues a pasted screenshot, previews it, and sends it through CHAT_SUBMIT_PROMPT', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');
    const pasted = new File(['probe'], 'clipboard.png', { type: 'image/png' });

    await act(async () => {
      textarea.dispatchEvent(createClipboardPasteEvent([pasted]));
    });

    expect(container.querySelector('img[alt="clipboard.png"]')).toBeTruthy();
    expect(container.textContent).toContain('clipboard.png');
    expect(createdObjectUrls).toEqual(['blob:deepseek-pp-test-1']);

    await enterText(textarea, 'I am checking this UI crop. What looks wrong or risky in this panel?');
    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    expect(submit.payload.text).toBe('I am checking this UI crop. What looks wrong or risky in this panel?');
    expect(submit.payload.images).toHaveLength(1);
    expect(submit.payload.images?.[0]).toMatchObject({
      name: 'clipboard.png',
      mimeType: 'image/png',
      sizeBytes: 5,
    });
    expect(submit.payload.images?.[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);

    await emitRuntimeMessage({ type: 'CHAT_STREAM_CHUNK', streamId: submit.payload.streamId, done: true });

    expect(revokedObjectUrls).toEqual(['blob:deepseek-pp-test-1']);
    expect(sendMessage.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            type: expect.stringMatching(/^(SAVE|SET|STORE|SYNC)_/i),
          }),
        ]),
      ]),
    );
  });

  it('uses a natural screenshot prompt when sending images without typed text', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await act(async () => {
      textarea.dispatchEvent(createClipboardPasteEvent([
        new File(['shot'], 'screenshot.png', { type: 'image/png' }),
      ]));
    });

    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    expect(submit.payload.text).toBe('I am checking this screenshot. What looks wrong or risky, and what should I do next?');
    expect(submit.payload.images).toHaveLength(1);
  });

  it('keeps DeepSeek Web session routing out of the primary Home surface', async () => {
    await renderChatPage();

    expect(container.textContent).toContain('DeepSeek Web');
    expect(container.querySelector('.ds-chat-session-control')).toBeNull();
    expect(container.querySelector('.ds-chat-mode-value')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'SAVE_PERSONAL_CONVENIENCE_CONFIG',
    }));
    expect(container.textContent).not.toMatch(/session-[a-z0-9_-]+/i);
  });

  it('keeps implementation status out of the empty Home surface', async () => {
    await renderChatPage();

    const homePanel = container.querySelector('.ds-chat-home-context');
    expect(homePanel).toBeTruthy();
    expect(homePanel?.textContent).toContain('从这里开始');
    expect(homePanel?.textContent).not.toContain('DeepSeek Web');
    expect(homePanel?.textContent).not.toContain('浏览器');
    expect(homePanel?.textContent).not.toContain('路线');
    expect(homePanel?.textContent).not.toContain('上下文');
    expect(homePanel?.textContent).not.toMatch(/route|browser|context/i);
    expect(container.textContent).toContain('DeepSeek Web');
    expect(container.textContent).not.toContain('Enter');
    expect(container.textContent).not.toContain('Shift Enter');
    expect(container.textContent).not.toMatch(/mock|placeholder|sample/i);
    expect(container.querySelector('.ds-chat-composer-status')?.textContent).toBe('DeepSeek Web');
    expect(container.querySelector('.ds-chat-input')?.getAttribute('data-slot')).toBe('textarea');
    expect(container.querySelector('button[aria-label="发送"]')?.getAttribute('data-slot')).toBe('button');
    expect(container.querySelector('button[aria-label="使用已选择的浏览器视图"]')?.getAttribute('data-slot')).toBe('button');
  });

  it('selects official API chat config from persisted model settings', async () => {
    sendMessage.mockImplementation(async (message: RuntimeMessage) => {
      if (message.type === 'GET_AUTH_STATUS') {
        return { available: true, provider: 'official-api', hasApiKey: true, hasToken: false };
      }
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') {
        return { model: 'deepseek-v4-pro', thinking: 'enabled', reasoningEffort: 'max' };
      }
      if (message.type === 'GET_VOICE_SETTINGS') return undefined;
      if (message.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return undefined;
      if (message.type === 'SAVE_OFFICIAL_API_CHAT_CONFIG') return message.payload;
      if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
      return null;
    });
    await renderChatPage();

    const header = container.querySelector('[data-workbench-header="true"].ds-page-intro');
    const title = container.querySelector('.ds-page-intro-title');
    expect(header).toBeTruthy();
    expect(header?.getAttribute('aria-labelledby')).toBe(title?.id);
    expect(container.querySelector('[data-slot="badge"].ds-page-intro-meta')?.textContent).toBe('Pro · 深度思考 · 最强');
    expect(container.querySelector('[data-slot="separator"].ds-page-intro-separator')).toBeTruthy();

    const responseSelect = selectByLabel('回复方式');
    expect(responseSelect.value).toBe('deepseek-v4-pro:enabled:max');
    expect(container.querySelectorAll('.ds-chat-mode-select')).toHaveLength(1);
    expect(container.querySelector('.ds-chat-mode-select')?.getAttribute('data-slot')).toBe('native-select-wrapper');
    expect(responseSelect.getAttribute('data-slot')).toBe('native-select');
    expect(responseSelect.querySelector('option')?.getAttribute('data-slot')).toBe('native-select-option');
    expect(container.querySelector('.ds-chat-mode-value')).toBeNull();

    await changeSelect(responseSelect, 'deepseek-v4-flash:enabled:high');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SAVE_OFFICIAL_API_CHAT_CONFIG',
      payload: {
        model: 'deepseek-v4-flash',
        thinking: 'enabled',
        reasoningEffort: 'high',
      },
    });
  });

  it('opens slash commands from the real command library and inserts with keyboard', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await focusInput(textarea);
    await enterText(textarea, '/r');
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_SKILL_LIBRARY' });
    expect(container.textContent).toContain('/review');
    expect(container.textContent).not.toContain('/disabled');
    expect(textarea.getAttribute('aria-controls')).toBe('ds-chat-composer-suggestions');
    expect(textarea.getAttribute('aria-activedescendant')).toBe('ds-chat-composer-suggestions-0');
    expect(container.querySelector('#ds-chat-composer-suggestions')?.getAttribute('data-slot')).toBe('command');
    expect(container.querySelector('#ds-chat-composer-suggestions [data-slot="command-list"]')).toBeTruthy();
    expect(container.querySelector('#ds-chat-composer-suggestions [data-slot="command-group"]')).toBeTruthy();
    expect(container.querySelector('#ds-chat-composer-suggestions-0')?.getAttribute('data-slot')).toBe('command-item');
    expect(container.querySelector('#ds-chat-composer-suggestions-0')?.textContent).toContain('/review');

    await pressKey(textarea, 'Enter');

    expect(textarea.value).toBe('/review ');
    expect(sendMessage.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({ type: 'CHAT_SUBMIT_PROMPT' }),
        ]),
      ]),
    );
  });

  it('shows retryable slash command source failures instead of false empty commands', async () => {
    const defaultSendMessage = sendMessage.getMockImplementation() as ((message: RuntimeMessage) => Promise<unknown>) | undefined;
    expect(defaultSendMessage).toBeTruthy();
    let commandsFail = true;
    sendMessage.mockImplementation(async (message: RuntimeMessage) => {
      if (message.type === 'GET_SKILL_LIBRARY') {
        if (commandsFail) throw new Error('commands offline');
        return defaultSendMessage!(message);
      }
      return defaultSendMessage!(message);
    });
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await focusInput(textarea);
    await enterText(textarea, '/');
    await flushPromises();

    expect(container.textContent).toContain('建议需要刷新');
    expect(container.textContent).toContain('命令');
    expect(container.textContent).toContain('commands offline');
    expect(container.textContent).not.toContain('没有匹配的命令。');
    expect(container.querySelector('.ds-chat-suggestion-option')).toBeNull();
    const issue = container.querySelector('.ds-chat-suggestion-source-issue');
    expect(issue?.getAttribute('data-slot')).toBe('alert');
    expect(issue?.querySelector('[data-slot="alert-title"]')?.textContent).toBe('建议需要刷新');
    expect(issue?.querySelector('[data-slot="alert-description"]')?.textContent).toContain('部分结果未能加载');
    const retryButton = issue?.querySelector<HTMLButtonElement>('[data-slot="alert-action"] [data-slot="button"]');
    expect(retryButton?.textContent).toBe('重试');
    await act(async () => {
      retryButton?.focus();
      await flushPromises();
    });
    expect(container.querySelector('#ds-chat-composer-suggestions')).toBeTruthy();

    commandsFail = false;
    await act(async () => {
      retryButton!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flushPromises();
    });

    expect(container.textContent).toContain('/review');
    expect(container.textContent).toContain('/summarize');
    expect(container.textContent).not.toContain('commands offline');
  });

  it('classifies ok-false slash source responses without leaking backend names', async () => {
    const defaultSendMessage = sendMessage.getMockImplementation() as ((message: RuntimeMessage) => Promise<unknown>) | undefined;
    expect(defaultSendMessage).toBeTruthy();
    sendMessage.mockImplementation(async (message: RuntimeMessage) => {
      if (message.type === 'GET_SKILL_LIBRARY') {
        return { ok: false, error: { message: 'GET_SKILL_LIBRARY cache unavailable' } };
      }
      return defaultSendMessage!(message);
    });
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await focusInput(textarea);
    await enterText(textarea, '/');
    await flushPromises();

    expect(container.textContent).toContain('建议需要刷新');
    expect(container.textContent).toContain('命令');
    expect(container.textContent).toContain('来源没有返回可用数据。');
    expect(container.textContent).not.toContain('GET_SKILL_LIBRARY');
    expect(container.textContent).not.toContain('没有匹配的命令。');
    expect(container.querySelector('.ds-chat-suggestion-option')).toBeNull();
    expect(container.querySelector('.ds-chat-suggestion-source-issue')?.getAttribute('data-slot')).toBe('alert');
    expect(container.querySelector('.ds-chat-suggestion-source-issue [data-slot="button"]')?.textContent).toBe('重试');
  });

  it('supports arrow navigation and Escape dismissal for composer suggestions', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await focusInput(textarea);
    await enterText(textarea, '/');
    await flushPromises();

    expect(container.querySelector('#ds-chat-composer-suggestions-0')?.textContent).toContain('/review');
    expect(container.querySelector('#ds-chat-composer-suggestions-1')?.textContent).toContain('/summarize');

    await pressKey(textarea, 'ArrowDown');
    expect(textarea.getAttribute('aria-activedescendant')).toBe('ds-chat-composer-suggestions-1');

    await pressKey(textarea, 'ArrowUp');
    expect(textarea.getAttribute('aria-activedescendant')).toBe('ds-chat-composer-suggestions-0');

    await pressKey(textarea, 'ArrowUp');
    expect(textarea.getAttribute('aria-activedescendant')).toBe('ds-chat-composer-suggestions-1');

    await pressKey(textarea, 'Escape');
    expect(container.querySelector('#ds-chat-composer-suggestions')).toBeNull();
    expect(textarea.getAttribute('aria-expanded')).toBe('false');
    expect(textarea.value).toBe('/');

    await enterText(textarea, '/sum');
    await flushPromises();
    expect(container.querySelector('#ds-chat-composer-suggestions-0')?.textContent).toContain('/summarize');

    await pressKey(textarea, 'Enter');
    expect(textarea.value).toBe('/summarize ');
  });

  it('shows honest empty composer suggestion states without fake rows', async () => {
    sendMessage.mockImplementation(async (message: RuntimeMessage) => {
      if (message.type === 'GET_AUTH_STATUS') {
        return { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: false };
      }
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return undefined;
      if (message.type === 'GET_VOICE_SETTINGS') return undefined;
      if (message.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return undefined;
      if (message.type === 'GET_SKILL_LIBRARY') return [];
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') {
        return {
          schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
          projects: [],
          conversations: [],
          pendingProjectId: null,
        };
      }
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_SAVED_ITEMS') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') {
        return { ok: false, error: 'no_active_deepseek_conversation' };
      }
      if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
      return null;
    });
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await focusInput(textarea);
    await enterText(textarea, '/');
    await flushPromises();

    expect(container.textContent).toContain('没有匹配的命令。');
    expect(container.querySelector('.ds-chat-suggestion-option')).toBeNull();
    expect(container.textContent).not.toContain('/review');
    expect(container.textContent).not.toContain('/summarize');

    await enterText(textarea, '@');
    await flushPromises();

    expect(container.textContent).toContain('没有匹配的上下文。');
    expect(container.querySelector('.ds-chat-suggestion-option')).toBeNull();
    expect(container.textContent).not.toContain('Run1');
    expect(container.textContent).not.toContain('Tone preference');
    expect(container.textContent).not.toContain('使用已选择的浏览器视图');
  });

  it('opens at-context from real project, memory, saved, chat, and browser actions', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await focusInput(textarea);
    await enterText(textarea, '@');
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_PROJECT_CONTEXT_STATE' });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_MEMORIES' });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_SAVED_ITEMS' });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_CURRENT_DEEPSEEK_CONVERSATION' });
    expect(container.textContent).toContain('Run1');
    expect(container.textContent).toContain('Tone preference');
    expect(container.textContent).toContain('Review checklist');
    expect(container.textContent).toContain('Current DeepSeek task');
    expect(container.textContent).toContain('使用已选择的浏览器视图');
    expect(container.querySelector('#ds-chat-composer-suggestions')?.getAttribute('data-slot')).toBe('command');
    expect(container.querySelector('#ds-chat-composer-suggestions [data-slot="command-list"]')).toBeTruthy();
    expect(container.querySelector('#ds-chat-composer-suggestions [data-slot="command-group"]')).toBeTruthy();
    expect(container.querySelector('#ds-chat-composer-suggestions-0')?.getAttribute('data-slot')).toBe('command-item');

    await clickSuggestionContaining('Run1');

    expect(textarea.value).toBe('@Project: Run1 ');
  });

  it('shows partial at-context source failures while keeping loaded suggestions reachable', async () => {
    const defaultSendMessage = sendMessage.getMockImplementation() as ((message: RuntimeMessage) => Promise<unknown>) | undefined;
    expect(defaultSendMessage).toBeTruthy();
    let memoryFails = true;
    sendMessage.mockImplementation(async (message: RuntimeMessage) => {
      if (message.type === 'GET_MEMORIES') {
        if (memoryFails) throw new Error('memory offline');
        return defaultSendMessage!(message);
      }
      return defaultSendMessage!(message);
    });
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await focusInput(textarea);
    await enterText(textarea, '@');
    await flushPromises();

    expect(container.textContent).toContain('建议需要刷新');
    expect(container.textContent).toContain('记忆');
    expect(container.textContent).toContain('memory offline');
    expect(container.textContent).toContain('Run1');
    expect(container.textContent).toContain('Review checklist');
    expect(container.textContent).toContain('Current DeepSeek task');
    expect(container.textContent).not.toContain('没有匹配的上下文。');
    expect(container.textContent).not.toContain('Tone preference');
    const issue = container.querySelector('.ds-chat-suggestion-source-issue');
    expect(issue?.getAttribute('data-slot')).toBe('alert');
    expect(issue?.querySelector('[data-slot="alert-title"]')?.textContent).toBe('建议需要刷新');
    const retryButton = issue?.querySelector<HTMLButtonElement>('[data-slot="alert-action"] [data-slot="button"]');
    expect(retryButton?.textContent).toBe('重试');
    await act(async () => {
      retryButton?.focus();
      await flushPromises();
    });
    expect(container.querySelector('#ds-chat-composer-suggestions')).toBeTruthy();

    await clickSuggestionContaining('Run1');
    expect(textarea.value).toBe('@Project: Run1 ');

    await enterText(textarea, '@');
    memoryFails = false;
    await clickButtonText('重试');

    expect(container.textContent).toContain('Tone preference');
    expect(container.textContent).not.toContain('memory offline');
  });

  it('reports current-chat source failure while preserving loaded at-context suggestions', async () => {
    const defaultSendMessage = sendMessage.getMockImplementation() as ((message: RuntimeMessage) => Promise<unknown>) | undefined;
    expect(defaultSendMessage).toBeTruthy();
    sendMessage.mockImplementation(async (message: RuntimeMessage) => {
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') {
        return { ok: false, error: { message: 'current chat bridge offline' } };
      }
      return defaultSendMessage!(message);
    });
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await focusInput(textarea);
    await enterText(textarea, '@');
    await flushPromises();

    expect(container.textContent).toContain('建议需要刷新');
    expect(container.textContent).toContain('当前对话');
    expect(container.textContent).toContain('current chat bridge offline');
    expect(container.textContent).toContain('Run1');
    expect(container.textContent).toContain('Tone preference');
    expect(container.textContent).toContain('Review checklist');
    expect(container.textContent).toContain('使用已选择的浏览器视图');
    expect(container.textContent).not.toContain('Current DeepSeek task');
    expect(container.textContent).not.toContain('没有匹配的上下文。');
  });

  it('runs at-context browser actions instead of inserting fake browser rows', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await focusInput(textarea);
    await enterText(textarea, '@浏览器');
    await flushPromises();
    await clickSuggestionContaining('使用已选择的浏览器视图');

    expect(sendMessage).toHaveBeenCalledWith({ type: 'CAPTURE_BROWSER_CONTROL_TARGET_IMAGE' });
    expect(inputByPlaceholder('给 DeepSeek++ 发送消息').value).toBe('看一下我当前的浏览器画面，帮我判断下一步该怎么做。');
    expect(container.querySelector('img[alt="browser-control-12.png"]')).toBeTruthy();
  });

  it('renders tool activity as a compact disclosure instead of raw tool markup', async () => {
    await renderChatPage();

    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      text: 'I am checking the existing chat.',
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      toolEvents: [{
        id: 'browser_snapshot:1',
        name: 'browser_snapshot',
        status: 'running',
        title: 'Read page snapshot',
        summary: 'Running',
      }],
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      toolEvents: [{
        id: 'browser_snapshot:1',
        name: 'browser_snapshot',
        status: 'success',
        title: 'Read page snapshot',
        summary: 'Done',
        detail: 'Loaded the visible chat structure.',
      }],
    });

    const toolEvent = container.querySelector('.ds-chat-tool-event');
    expect(toolEvent).toBeTruthy();
    expect(toolEvent?.textContent).toContain('Read page snapshot');
    expect(toolEvent?.textContent).toContain('Loaded the visible chat structure.');
    expect(container.textContent).toContain('I am checking the existing chat.');
    expect(container.textContent).not.toContain('<browser_snapshot');
    expect(container.textContent).not.toContain('</browser_snapshot>');
  });

  it('does not duplicate assistant text from the final done chunk', async () => {
    await renderChatPage();

    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      text: 'I found the right chat.',
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      text: 'I found the right chat.',
      done: true,
    });

    expect(container.textContent?.match(/I found the right chat\./g)).toHaveLength(1);
  });

  it('renders assistant text that arrives only on the terminal done chunk', async () => {
    await renderChatPage();

    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      text: 'The first visible word is present.',
      done: true,
    });

    expect(container.textContent).toContain('The first visible word is present.');
  });

  it('shows assistant working state immediately after sending', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await enterText(textarea, 'Use the current browser tab and read the visible answer.');
    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    expect(container.querySelector('button[aria-label="发送"]')?.getAttribute('data-slot')).toBe('button');
    expect(container.textContent).toContain('Use the current browser tab and read the visible answer.');
    expect(container.querySelector('.ds-chat-message-row-assistant .ds-chat-caret')).toBeTruthy();

    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: submit.payload.streamId,
      text: 'The visible answer says to keep it simple.',
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: submit.payload.streamId,
      done: true,
    });

    expect(container.textContent).toContain('The visible answer says to keep it simple.');
    expect(container.querySelector('.ds-chat-message-row-assistant .ds-chat-caret')).toBeNull();
  });

  it('unlocks the composer if an accepted stream never sends a terminal chunk', async () => {
    vi.useFakeTimers();
    try {
      await renderChatPage();
      const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

      await enterText(textarea, 'Use my current browser tab and tell me the main point.');
      await clickButtonByLabel('发送');
      const submit = await waitForSubmit();

      expect(clickableButtonByLabel('发送').disabled).toBe(true);
      expect(clickableButtonByLabel('使用已选择的浏览器视图').disabled).toBe(true);

      await emitRuntimeMessage({
        type: 'CHAT_STREAM_CHUNK',
        streamId: submit.payload.streamId,
        toolEvents: [{
          id: 'browser_snapshot:1',
          name: 'browser_snapshot',
          status: 'running',
          title: 'Read page snapshot',
          summary: 'Reading',
        }],
      });

      await act(async () => {
        vi.advanceTimersByTime(110_001);
      });

      expect(container.textContent).toContain('DeepSeek 网页没有完成这次侧边栏请求。输入框已解锁，可以重试。');
      expect(container.textContent).toContain('Read page snapshot - 已超时');
      expect(container.textContent).not.toContain('Using');
      expect(inputByPlaceholder('给 DeepSeek++ 发送消息').value).toBe('');
      expect(clickableButtonByLabel('使用已选择的浏览器视图').disabled).toBe(false);

      await enterText(inputByPlaceholder('给 DeepSeek++ 发送消息'), 'retry');
      expect(clickableButtonByLabel('发送').disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts pre-terminal tool error events before a terminal stream error', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await enterText(textarea, 'Use my current browser tab and tell me the main point.');
    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: submit.payload.streamId,
      toolEvents: [{
        id: 'browser_snapshot:1',
        name: 'browser_snapshot',
        status: 'running',
        title: 'Read page snapshot',
        summary: 'Reading',
      }],
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: submit.payload.streamId,
      toolEvents: [{
        id: 'browser_snapshot:1',
        name: 'browser_snapshot',
        status: 'error',
        title: 'Read page snapshot',
        summary: 'Timed out',
      }],
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: submit.payload.streamId,
      error: 'DeepSeek Web did not respond.',
      done: true,
    });

    expect(container.textContent).toContain('Read page snapshot - Timed out');
    expect(container.textContent).toContain('DeepSeek Web did not respond.');
    expect(container.textContent).not.toContain('Using');
    expect(clickableButtonByLabel('使用已选择的浏览器视图').disabled).toBe(false);
  });

  it('accepts tool error events on the terminal stream error chunk', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await enterText(textarea, 'Use my current browser tab and tell me the main point.');
    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: submit.payload.streamId,
      toolEvents: [{
        id: 'browser_snapshot:1',
        name: 'browser_snapshot',
        status: 'running',
        title: 'Read page snapshot',
        summary: 'Reading',
      }],
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: submit.payload.streamId,
      error: 'DeepSeek Web did not respond.',
      done: true,
      toolEvents: [{
        id: 'browser_snapshot:1',
        name: 'browser_snapshot',
        status: 'error',
        title: 'Read page snapshot',
        summary: 'Timed out',
      }],
    });

    expect(container.textContent).toContain('Read page snapshot - Timed out');
    expect(container.textContent).toContain('DeepSeek Web did not respond.');
    expect(container.textContent).not.toContain('Using');
    expect(clickableButtonByLabel('使用已选择的浏览器视图').disabled).toBe(false);
  });

  it('terminalizes rendered running tool events when a stream error has no tool event payload', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await enterText(textarea, 'Use my current browser tab and tell me the main point.');
    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: submit.payload.streamId,
      toolEvents: [{
        id: 'browser_snapshot:1',
        name: 'browser_snapshot',
        status: 'running',
        title: 'Read page snapshot',
        summary: 'Reading',
      }],
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: submit.payload.streamId,
      error: 'The previous chat run was interrupted. Please retry.',
      done: true,
    });

    expect(container.textContent).toContain('Read page snapshot - The previous chat run was interrupted. Please retry.');
    expect(container.textContent).not.toContain('Using');
    expect(clickableButtonByLabel('使用已选择的浏览器视图').disabled).toBe(false);
  });

  it('accepts pre-terminal DeepSeek Web status errors before a terminal stream error', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await enterText(textarea, 'Use my current browser tab and tell me the main point.');
    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: submit.payload.streamId,
      toolEvents: [{
        id: 'deepseek-web-turn-status',
        name: 'deepseek_web_turn',
        status: 'running',
        title: 'DeepSeek Web',
        summary: 'Using browser tools',
      }],
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: submit.payload.streamId,
      toolEvents: [{
        id: 'deepseek-web-turn-status',
        name: 'deepseek_web_turn',
        status: 'error',
        title: 'DeepSeek Web',
        summary: 'Timed out',
      }],
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: submit.payload.streamId,
      error: 'DeepSeek Web did not respond.',
      done: true,
    });

    expect(container.textContent).toContain('DeepSeek Web - Timed out');
    expect(container.textContent).toContain('DeepSeek Web did not respond.');
    expect(container.textContent).not.toContain('Using');
    expect(clickableButtonByLabel('使用已选择的浏览器视图').disabled).toBe(false);
  });

  it('ignores stale stream chunks from an older chat run', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await enterText(textarea, 'Use my current browser tab and tell me what happened.');
    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();
    const streamId = submit.payload.streamId;

    expect(streamId).toEqual(expect.any(String));

    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: `${streamId}-old`,
      text: 'This stale answer should not appear.',
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      text: 'This unscoped stale answer should not appear.',
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      error: 'This unscoped stale error should not appear.',
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId,
      text: 'This is the current answer.',
    });
    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId,
      done: true,
    });

    expect(container.textContent).not.toContain('This stale answer should not appear.');
    expect(container.textContent).not.toContain('This unscoped stale answer should not appear.');
    expect(container.textContent).not.toContain('This unscoped stale error should not appear.');
    expect(container.textContent).toContain('This is the current answer.');
  });

  it('resets message auto-scroll when sending a new turn', async () => {
    await renderChatPage();
    const list = container.querySelector('.ds-chat-messages') as HTMLDivElement | null;
    expect(list).toBeTruthy();
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 0, writable: true, configurable: true });

    await act(async () => {
      list?.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');
    await enterText(textarea, 'Use my current browser tab and continue from here.');
    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    expect(list?.scrollTop).toBe(1000);
  });

  it('captures the current tab into a transient attachment', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await clickButtonByLabel('捕获当前标签页');

    expect(container.querySelector('img[alt="captured-tab.png"]')).toBeTruthy();
    expect(createdObjectUrls).toEqual(['blob:deepseek-pp-test-1']);

    await enterText(textarea, 'What is visually wrong here?');
    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    expect(submit.payload.text).toBe('What is visually wrong here?');
    expect(submit.payload.images).toHaveLength(1);
    expect(submit.payload.images?.[0]).toMatchObject({
      name: 'captured-tab.png',
      mimeType: 'image/png',
      sizeBytes: 5,
    });
    expect(submit.payload.images?.[0]?.dataUrl).toBe(`data:image/png;base64,${btoa('probe')}`);
    expect(sendMessage.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            type: expect.stringMatching(/^(SAVE|SET|STORE|SYNC)_/i),
          }),
        ]),
      ]),
    );
  });

  it('requests optional host permission before current-tab capture when needed', async () => {
    permissionsContains.mockResolvedValueOnce(false);
    permissionsRequest.mockResolvedValueOnce(true);
    await renderChatPage();

    await clickButtonByLabel('捕获当前标签页');

    expect(permissionsContains).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
    expect(permissionsRequest).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
    expect(container.querySelector('img[alt="captured-tab.png"]')).toBeTruthy();
  });

  it('does not call background capture when optional host permission is denied', async () => {
    permissionsContains.mockResolvedValueOnce(false);
    permissionsRequest.mockResolvedValueOnce(false);
    await renderChatPage();

    await clickButtonByLabel('捕获当前标签页');

    expect(container.querySelectorAll('.ds-chat-attachment-card')).toHaveLength(0);
    expect(sendMessage.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({ type: 'CAPTURE_CURRENT_TAB_IMAGE' }),
        ]),
      ]),
    );
    expect(container.textContent).toContain('无法捕获当前标签页。请先在该标签页点击扩展图标，然后重试。');
  });

  it('captures the Browser Control target with a natural handoff prompt', async () => {
    sendMessage.mockImplementation(async (message: RuntimeMessage) => {
      if (message.type === 'GET_AUTH_STATUS') {
        return { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true };
      }
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return undefined;
      if (message.type === 'GET_VOICE_SETTINGS') return undefined;
      if (message.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return undefined;
      if (message.type === 'CAPTURE_BROWSER_CONTROL_TARGET_IMAGE') {
        return {
          ok: true,
          image: {
            name: 'browser-view-1-full-page.png',
            mimeType: 'image/png',
            sizeBytes: 4,
            dataUrl: `data:image/png;base64,${btoa('full')}`,
          },
          images: [{
            label: 'Full page',
            image: {
              name: 'browser-view-1-full-page.png',
              mimeType: 'image/png',
              sizeBytes: 4,
              dataUrl: `data:image/png;base64,${btoa('full')}`,
            },
          }, {
            label: 'Nested scroll 1: form panel (stitched nested scroll)',
            image: {
              name: 'browser-view-2-nested-scroll.png',
              mimeType: 'image/png',
              sizeBytes: 6,
              dataUrl: `data:image/png;base64,${btoa('nested')}`,
            },
          }],
          skippedNestedScrolls: 0,
          tab: { id: 12, windowId: 1 },
        };
      }
      if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
      return null;
    });
    await renderChatPage();

    await clickButtonByLabel('使用已选择的浏览器视图');

    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');
    expect(textarea.value).toBe('看一下我当前的浏览器画面，帮我判断下一步该怎么做。');
    expect(container.querySelector('img[alt="browser-view-1-full-page.png"]')).toBeTruthy();
    expect(container.querySelector('img[alt="browser-view-2-nested-scroll.png"]')).toBeTruthy();

    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    expect(container.textContent).not.toContain('Browser view evidence attached:');
    expect(container.textContent).toContain('看一下我当前的浏览器画面，帮我判断下一步该怎么做。');
    expect(submit.payload.text).toBe([
      'Browser view evidence attached:',
      '1. Full page',
      '2. Nested scroll 1: form panel (stitched nested scroll)',
      '',
      '看一下我当前的浏览器画面，帮我判断下一步该怎么做。',
    ].join('\n'));
    expect(submit.payload.images).toHaveLength(2);
    expect(submit.payload.images?.[0]).toMatchObject({
      name: 'browser-view-1-full-page.png',
      mimeType: 'image/png',
      sizeBytes: 4,
    });
    expect(submit.payload.images?.[1]).toMatchObject({
      name: 'browser-view-2-nested-scroll.png',
      mimeType: 'image/png',
      sizeBytes: 6,
    });
    expect(sendMessage.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            type: expect.stringMatching(/^(SAVE|SET|STORE|SYNC)_/i),
          }),
        ]),
      ]),
    );
  });

  it('shows capture failures without adding an attachment', async () => {
    sendMessage.mockImplementation(async (message: RuntimeMessage) => {
      if (message.type === 'GET_AUTH_STATUS') {
        return { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true };
      }
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return undefined;
      if (message.type === 'GET_VOICE_SETTINGS') return undefined;
      if (message.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return undefined;
      if (message.type === 'CAPTURE_CURRENT_TAB_IMAGE') return { ok: false, error: 'capture denied' };
      if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
      return null;
    });
    await renderChatPage();

    await clickButtonByLabel('捕获当前标签页');

    expect(container.querySelectorAll('.ds-chat-attachment-card')).toHaveLength(0);
    expect(container.textContent).toContain('capture denied');
  });

  it('does not capture Browser View when the image tray is already full', async () => {
    await renderChatPage();
    const composer = container.querySelector('.ds-chat-composer');

    await act(async () => {
      composer?.dispatchEvent(createDropEvent([
        new File(['a'], 'one.png', { type: 'image/png' }),
        new File(['b'], 'two.png', { type: 'image/png' }),
        new File(['c'], 'three.png', { type: 'image/png' }),
        new File(['d'], 'four.png', { type: 'image/png' }),
      ]));
    });

    await clickButtonByLabel('使用已选择的浏览器视图');

    expect(container.querySelectorAll('.ds-chat-attachment-card')).toHaveLength(4);
    expect(container.textContent).toContain('最多只能附加 4 张图片');
    expect(sendMessage.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({ type: 'CAPTURE_BROWSER_CONTROL_TARGET_IMAGE' }),
        ]),
      ]),
    );
  });

  it('restores pasted attachments when the accepted stream later fails', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');
    const pasted = new File(['probe'], 'retry.png', { type: 'image/png' });

    await act(async () => {
      textarea.dispatchEvent(createClipboardPasteEvent([pasted]));
    });
    await enterText(textarea, 'I am checking this crop. What should I fix?');
    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    expect(container.querySelector('img[alt="retry.png"]')).toBeNull();

    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      streamId: submit.payload.streamId,
      error: 'DeepSeek Web Vision upload failed.',
    });

    expect(inputByPlaceholder('给 DeepSeek++ 发送消息').value).toBe('I am checking this crop. What should I fix?');
    expect(container.querySelector('img[alt="retry.png"]')).toBeTruthy();
    expect(container.textContent).toContain('DeepSeek Web Vision upload failed.');
    expect(revokedObjectUrls).toEqual([]);
  });

  it('queues dropped images and blocks attachments above the per-turn limit', async () => {
    await renderChatPage();
    const composer = container.querySelector('.ds-chat-composer');
    expect(composer).toBeTruthy();

    await act(async () => {
      composer?.dispatchEvent(createDropEvent([
        new File(['a'], 'one.png', { type: 'image/png' }),
        new File(['b'], 'two.jpg', { type: 'image/jpeg' }),
        new File(['c'], 'three.webp', { type: 'image/webp' }),
        new File(['d'], 'four.gif', { type: 'image/gif' }),
        new File(['e'], 'five.png', { type: 'image/png' }),
      ]));
    });

    expect(container.querySelectorAll('.ds-chat-attachment-card')).toHaveLength(4);
    expect(container.textContent).toContain('最多只能附加 4 张图片');
    expect(createdObjectUrls).toHaveLength(4);
  });

  it('revokes preview object URLs when an attachment is removed and when the page unmounts', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await act(async () => {
      textarea.dispatchEvent(createClipboardPasteEvent([
        new File(['a'], 'remove.png', { type: 'image/png' }),
        new File(['b'], 'unmount.png', { type: 'image/png' }),
      ]));
    });

    await clickButtonByLabel('移除 remove.png');
    expect(revokedObjectUrls).toEqual(['blob:deepseek-pp-test-1']);

    await act(async () => {
      root?.unmount();
      root = null;
    });

    expect(revokedObjectUrls).toEqual(['blob:deepseek-pp-test-1', 'blob:deepseek-pp-test-2']);
  });
});

async function renderChatPage() {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(ChatPage));
  });
  await flushPromises();
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function inputByPlaceholder(placeholder: string): HTMLTextAreaElement {
  const input = container.querySelector(`textarea[placeholder="${placeholder}"]`);
  expect(input).toBeTruthy();
  return input as HTMLTextAreaElement;
}

async function enterText(input: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function focusInput(input: HTMLTextAreaElement) {
  await act(async () => {
    input.focus();
    input.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
  });
}

async function pressKey(input: HTMLTextAreaElement, key: string) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
  await flushPromises();
}

async function clickSuggestionContaining(text: string) {
  const option = Array.from(container.querySelectorAll<HTMLElement>('.ds-chat-suggestion-option'))
    .find((item) => item.textContent?.includes(text));
  expect(option).toBeTruthy();
  await act(async () => {
    option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    option?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flushPromises();
}

async function clickButtonText(text: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((item) => item.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flushPromises();
}

async function clickButtonByLabel(label: string) {
  const button = clickableButtonByLabel(label);
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function clickableButtonByLabel(label: string): HTMLButtonElement {
  const button = container.querySelector(`button[aria-label="${label}"]`);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

async function clickButtonByTitle(title: string) {
  const button = buttonByTitle(title);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flushPromises();
}

function buttonByTitle(title: string): HTMLButtonElement {
  const button = container.querySelector(`button[title="${title}"]`);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function selectByLabel(label: string): HTMLSelectElement {
  const select = container.querySelector(`select[aria-label="${label}"]`);
  expect(select).toBeTruthy();
  return select as HTMLSelectElement;
}

async function changeSelect(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flushPromises();
}

async function waitForSubmit(): Promise<ChatSubmitMessage> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const submit = sendMessage.mock.calls
      .map(([message]) => message as RuntimeMessage)
      .find((message): message is ChatSubmitMessage => message.type === 'CHAT_SUBMIT_PROMPT');
    if (submit) return submit;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error('CHAT_SUBMIT_PROMPT was not sent.');
}

async function emitRuntimeMessage(message: RuntimeMessage) {
  await act(async () => {
    for (const listener of runtimeListeners) {
      listener(message);
    }
  });
}

function createClipboardPasteEvent(files: File[]): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files,
      items: files.map((file) => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      })),
    },
  });
  return event;
}

function createDropEvent(files: File[]): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      files,
      items: files.map((file) => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      })),
    },
  });
  return event;
}
