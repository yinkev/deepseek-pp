import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PersonalIntelligencePage from '../entrypoints/sidepanel/pages/PersonalIntelligencePage';
import type { SidepanelNavigationTarget } from '../entrypoints/sidepanel/navigation';
import type { Memory, ProjectContextState, SavedItem, SystemPromptPreset } from '../core/types';

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

describe('PersonalIntelligencePage', () => {
  it('collapses empty context into one action-oriented empty state', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_SAVED_ITEMS') return [];
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return {
        schemaVersion: 2,
        projects: [],
        conversations: [],
        pendingProjectId: null,
      };
      if (message.type === 'GET_ACTIVE_PRESET') return null;
      return null;
    });
    const onNavigate = vi.fn();

    await renderPersonalIntelligencePage(sendMessage, onNavigate);

    expect(container.textContent).toContain('需要上下文');
    expect(container.textContent).toContain('创建项目或记忆');
    expect(container.textContent).toContain('还没有保存上下文');
    expect(container.textContent).not.toContain('暂无置顶记忆');
    expect(container.textContent).not.toContain('暂无保存项');
    expect(container.textContent).not.toContain('暂无项目');
    expect(container.querySelector('.ds-intel-empty-state')?.getAttribute('data-slot')).toBe('empty');
    expect(container.querySelector('.ds-intel-empty-state [data-slot="empty-title"]')?.textContent).toContain('还没有保存上下文');
    expect(container.querySelectorAll('.ds-intel-empty-state [data-slot="button"]')).toHaveLength(2);

    await clickButton('管理记忆');
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'library', librarySubTab: 'memory' });
  });

  it('renders real user memory, project, saved-item, and preset context without internal injection copy', async () => {
    const preset = createPreset();
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') return createMemories();
      if (message.type === 'GET_SAVED_ITEMS') return createSavedItems();
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return createProjectState();
      if (message.type === 'GET_PRESETS') return [preset];
      if (message.type === 'GET_ACTIVE_PRESET') return preset;
      if (message.type === 'GET_PROMPT_INJECTION_SETTINGS') {
        return {
          memoryEnabled: true,
          systemPromptEnabled: true,
          presetCadence: 'every_message',
          forceResponseLanguage: 'auto',
        };
      }
      if (message.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') {
        return {
          ok: true,
          config: {
            enabled: true,
            autoReadyCheckBeforeRun: true,
            autoRefreshWebAuth: true,
            sameSessionStrategy: 'current',
            visualMonitorDefault: true,
            reducedConfirmations: false,
            descriptionDensity: 'comfortable',
          },
        };
      }
      return null;
    });
    const onNavigate = vi.fn();

    await renderPersonalIntelligencePage(sendMessage, onNavigate);

    expect(container.textContent).toContain('DeepSeek++ 下一条对话可以带入的内容。');
    expect(container.textContent).toContain('上下文状态');
    expect(container.textContent).toContain('需要项目');
    expect(container.textContent).toContain('已有保存上下文，但下一次回答还没有选择项目。');
    expect(container.textContent).toContain('置顶记忆 · 保存项 · 项目 · 预设');
    expect(container.textContent).toContain('当前使用');
    expect(container.textContent).toContain('记忆');
    expect(container.textContent).toContain('已启用');
    expect(container.textContent).not.toContain('1 个项目 · 2 个保存项 · 2 条记忆');
    expect(container.textContent).not.toContain('保存在本地');
    expect(container.textContent).not.toContain('会话策略');
    expect(container.textContent).not.toContain('Prompt 注入');
    expect(container.textContent).not.toContain('每条消息');
    expect(container.textContent).toContain('Stable writing preference');
    expect(container.textContent).toContain('所有对话 · Keep answers direct.');
    expect(container.textContent).toContain('Reusable audit prompt');
    expect(container.textContent).toContain('片段 · Audit this change.');
    expect(container.textContent).toContain('DeepSeek++ Redesign');
    expect(container.textContent).toContain('Keep it real.');
    expect(container.textContent).toContain('Expert reviewer');
    expect(container.textContent).not.toMatch(/mock|placeholder|sample/i);
    expect(container.querySelectorAll('.ds-intel-section-header h3 span')).toHaveLength(0);
    expect(container.querySelectorAll('.ds-intel-action-row')).toHaveLength(1);
    expect(container.querySelectorAll('.ds-intel-record-group')).toHaveLength(3);
    expect(container.querySelector('.ds-intel-readiness-badge')?.getAttribute('data-slot')).toBe('badge');
    expect(container.querySelectorAll('.ds-intel-button[data-slot="button"]').length).toBeGreaterThanOrEqual(4);

    await clickButton('项目');
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'projects' });

    expect(container.textContent).not.toContain('管理预设');
    expect(Array.from(container.querySelectorAll('button')).filter((button) => button.textContent === '项目')).toHaveLength(1);
  });

  it('shows retryable source issues without hiding context that did load', async () => {
    let memoryFails = true;
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') {
        if (memoryFails) throw new Error('memory offline');
        return createMemories();
      }
      if (message.type === 'GET_SAVED_ITEMS') return createSavedItems();
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return createProjectState();
      if (message.type === 'GET_ACTIVE_PRESET') return null;
      if (message.type === 'GET_PROMPT_INJECTION_SETTINGS') return {
        memoryEnabled: true,
        systemPromptEnabled: true,
        presetCadence: 'every_message',
        forceResponseLanguage: 'auto',
      };
      return null;
    });
    const onNavigate = vi.fn();

    await renderPersonalIntelligencePage(sendMessage, onNavigate);

    expect(container.textContent).toContain('需要刷新');
    expect(container.textContent).toContain('上下文来源需要刷新');
    expect(container.textContent).toContain('记忆');
    expect(container.textContent).toContain('memory offline');
    expect(container.textContent).toContain('Reusable audit prompt');
    expect(container.textContent).toContain('DeepSeek++ Redesign');
    expect(container.textContent).not.toContain('还没有保存上下文');
    expect(container.querySelector('.ds-intel-source-issues')?.getAttribute('data-slot')).toBe('alert');
    expect(container.querySelector('.ds-intel-source-issues [data-slot="alert-title"]')?.textContent).toContain('上下文来源需要刷新');
    expect(container.querySelector('.ds-intel-source-issues [data-slot="alert-action"] [data-slot="button"]')?.textContent).toBe('重试');

    memoryFails = false;
    await clickButton('重试');
    await flushEffects();

    expect(container.textContent).toContain('Stable writing preference');
    expect(container.textContent).toContain('Reusable audit prompt');
    expect(container.textContent).not.toContain('memory offline');
    expect(container.textContent).not.toContain('上下文来源需要刷新');
  });

  it('routes Context status to prompt settings when memory is disabled', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') return createMemories();
      if (message.type === 'GET_SAVED_ITEMS') return [];
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return createProjectState();
      if (message.type === 'GET_ACTIVE_PRESET') return null;
      if (message.type === 'GET_PROMPT_INJECTION_SETTINGS') return {
        memoryEnabled: false,
        systemPromptEnabled: true,
        presetCadence: 'every_message',
        forceResponseLanguage: 'auto',
      };
      return null;
    });
    const onNavigate = vi.fn();

    await renderPersonalIntelligencePage(sendMessage, onNavigate);

    const statusPanel = container.querySelector('.ds-intel-readiness');
    expect(statusPanel?.textContent).toContain('记忆关闭');
    expect(statusPanel?.textContent).toContain('检查 Prompt 设置');
    await clickButton('Prompt 设置');
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'settings', settingsSubTab: 'prompt' });
  });

  it('asks the user to choose a project when saved context exists without an active project', async () => {
    const state = createProjectState();
    state.pendingProjectId = null;
    state.conversations = [];
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') return createMemories();
      if (message.type === 'GET_SAVED_ITEMS') return createSavedItems();
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_ACTIVE_PRESET') return null;
      if (message.type === 'GET_PROMPT_INJECTION_SETTINGS') return {
        memoryEnabled: true,
        systemPromptEnabled: true,
        presetCadence: 'every_message',
        forceResponseLanguage: 'auto',
      };
      return null;
    });
    const onNavigate = vi.fn();

    await renderPersonalIntelligencePage(sendMessage, onNavigate);

    const statusPanel = container.querySelector('.ds-intel-readiness');
    expect(statusPanel?.textContent).toContain('需要项目');
    expect(statusPanel?.textContent).toContain('选择项目');
    expect(statusPanel?.textContent).not.toContain('可使用');
    await clickButton('项目');
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'projects' });
  });
});

async function renderPersonalIntelligencePage(
  sendMessage: ReturnType<typeof vi.fn>,
  onNavigate: (target: SidepanelNavigationTarget) => void,
) {
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

  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(PersonalIntelligencePage, { onNavigate }));
  });
  await flushEffects();
}

async function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function createMemories(): Memory[] {
  return [
    {
      id: 1,
      syncId: 'memory-1',
      scope: 'global',
      type: 'user',
      name: 'Stable writing preference',
      content: 'Keep answers direct.',
      description: '',
      tags: [],
      pinned: true,
      createdAt: 1,
      updatedAt: 10,
      accessCount: 1,
      lastAccessedAt: 10,
    },
    {
      id: 2,
      syncId: 'memory-2',
      scope: 'project',
      projectId: 'project-1',
      type: 'reference',
      name: 'Project rubric',
      content: 'Use real data only.',
      description: '',
      tags: [],
      pinned: false,
      createdAt: 2,
      updatedAt: 9,
      accessCount: 0,
      lastAccessedAt: 9,
    },
  ];
}

function createSavedItems(): SavedItem[] {
  return [
    {
      id: 'saved-1',
      syncId: 'saved-sync-1',
      kind: 'snippet',
      title: 'Reusable audit prompt',
      content: 'Audit this change.',
      tags: [],
      createdAt: 1,
      updatedAt: 20,
    },
    {
      id: 'saved-2',
      syncId: 'saved-sync-2',
      kind: 'bookmark',
      title: 'Design notes',
      content: 'https://example.com',
      tags: [],
      createdAt: 1,
      updatedAt: 15,
    },
  ];
}

function createProjectState(): ProjectContextState {
  return {
    schemaVersion: 2,
    pendingProjectId: null,
    projects: [{
      id: 'project-1',
      name: 'DeepSeek++ Redesign',
      description: '',
      instructions: 'Keep it real.',
      createdAt: 1,
      updatedAt: 30,
    }],
    conversations: [{
      conversationId: 'conversation-1',
      projectId: 'project-1',
      title: 'Sidebar review',
      url: 'https://chat.deepseek.com/a',
      addedAt: 2,
      lastSeenAt: 25,
    }],
  };
}

function createPreset(): SystemPromptPreset {
  return {
    id: 'preset-1',
    name: 'Expert reviewer',
    content: 'Review strictly.',
    createdAt: 1,
    updatedAt: 2,
  };
}
