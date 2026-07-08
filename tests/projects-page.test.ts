import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../components/ui/tooltip';
import ProjectsPage from '../entrypoints/sidepanel/pages/ProjectsPage';
import type { ProjectContext, ProjectContextState } from '../core/project';
import type { Memory } from '../core/types';

type ProjectsPageTestProps = {
  initialProjectId?: string | null;
  initialProjectNavigationKey?: number;
};

const ProjectsPageWithProps = ProjectsPage as React.ComponentType<ProjectsPageTestProps>;

const EMPTY_PROJECT_STATE: ProjectContextState = {
  schemaVersion: 2,
  projects: [],
  conversations: [],
  pendingProjectId: null,
};

const CURRENT_CONVERSATION = {
  conversationId: 'session-1',
  title: '查看项目进展',
  url: 'https://chat.deepseek.com/chat/s/session-1',
};

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

describe('ProjectsPage', () => {
  it('renders a newly created project after background storage confirms it', async () => {
    let state = { ...EMPTY_PROJECT_STATE };
    const project = createProject('project-1', 'Alpha');
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: true, conversation: CURRENT_CONVERSATION };
      if (message.type === 'CREATE_PROJECT_CONTEXT') {
        state = {
          ...state,
          projects: [project],
        };
        return project;
      }
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);
    expect(buttonsByText('创建项目')).toHaveLength(1);
    expect(buttonsByText('创建项目')[0].getAttribute('data-slot')).toBe('button');
    await clickButton('创建项目');
    await enterProjectName('Alpha');
    await clickButton('创建项目');

    expect(container.textContent).toContain('Alpha');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'CREATE_PROJECT_CONTEXT',
      payload: { name: 'Alpha', instructions: '' },
    });
  });

  it('creates a project with optional description and instructions', async () => {
    let state = { ...EMPTY_PROJECT_STATE };
    const sendMessage = vi.fn(async (message: { type: string; payload?: { name?: string; description?: string; instructions?: string } }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
      if (message.type === 'CREATE_PROJECT_CONTEXT') {
        const project = createProject('project-1', message.payload?.name ?? 'Alpha');
        project.description = message.payload?.description ?? '';
        project.instructions = message.payload?.instructions ?? '';
        state = {
          ...state,
          projects: [project],
        };
        return project;
      }
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);
    await clickButton('创建项目');
    const createPanel = container.querySelector('#ds-project-create-panel');
    expect(createPanel?.querySelectorAll('[data-slot="field"]')).toHaveLength(3);
    expect(inputByPlaceholder('项目名称').getAttribute('data-slot')).toBe('input');
    expect(inputByPlaceholder('项目说明（可选）').getAttribute('data-slot')).toBe('input');
    expect(textareaByPlaceholder('项目指令').getAttribute('data-slot')).toBe('textarea');
    expect(buttonsByText('创建项目')[0].getAttribute('data-slot')).toBe('button');
    await enterProjectName('Alpha');
    await enterInput('项目说明（可选）', 'High-value DA work');
    await enterTextarea('项目指令', 'Prioritize evidence and hourly rate.');
    await clickButton('创建项目');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'CREATE_PROJECT_CONTEXT',
      payload: {
        name: 'Alpha',
        description: 'High-value DA work',
        instructions: 'Prioritize evidence and hourly rate.',
      },
    });
    expect(container.textContent).toContain('High-value DA work');
    expect(container.textContent).toContain('Prioritize evidence and hourly rate.');
  });

  it('surfaces unavailable project backend instead of clearing the form silently', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return EMPTY_PROJECT_STATE;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
      if (message.type === 'CREATE_PROJECT_CONTEXT') return null;
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);
    await clickButton('创建项目');
    await enterProjectName('Alpha');
    await clickButton('创建项目');

    expect(projectNameInput().value).toBe('Alpha');
    expect(container.textContent).toContain('项目后端不可用');
  });

  it('shows a retryable project load error instead of a false empty state', async () => {
    let projectLoads = 0;
    const project = createProject('project-1', 'Alpha');
    const state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') {
        projectLoads += 1;
        if (projectLoads === 1) throw new Error('offline');
        return state;
      }
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);
    await flushEffects();

    expect(container.textContent).toContain('项目不可用');
    expect(container.textContent).toContain('项目加载失败：offline');
    expect(container.textContent).toContain('重试');
    expect(container.querySelector('[data-slot="empty"]')?.textContent).toContain('项目不可用');
    expect(buttonsByText('重试')[0].getAttribute('data-slot')).toBe('button');
    expect(container.textContent).not.toContain('暂无项目');

    await clickButton('重试');
    await flushEffects();

    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_PROJECT_CONTEXT_STATE')).toHaveLength(2);
    expect(container.textContent).toContain('Alpha');
    expect(container.textContent).not.toContain('项目不可用');
    expect(container.textContent).not.toContain('offline');
  });

  it('clears a project load error when the backend pushes recovered project state', async () => {
    const project = createProject('project-1', 'Recovered Project');
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') throw new Error('offline');
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);
    await flushEffects();
    expect(container.textContent).toContain('项目不可用');

    await act(async () => {
      runtimeListeners.forEach((listener) => listener({
        type: 'PROJECT_CONTEXT_UPDATED',
        state: {
          ...EMPTY_PROJECT_STATE,
          projects: [project],
        },
      }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(container.textContent).toContain('Recovered Project');
    expect(container.textContent).not.toContain('项目不可用');
    expect(container.textContent).not.toContain('offline');
  });

  it('keeps the project rail visible even when there is only one project', async () => {
    const project = createProject('project-1', 'Alpha');
    const state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: true, conversation: CURRENT_CONVERSATION };
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);

    const projectRail = container.querySelector('.ds-project-picker');
    expect(projectRail?.textContent).toContain('项目');
    expect(projectRail?.querySelectorAll('.ds-project-row')).toHaveLength(1);
    expect(projectRail?.querySelector('.ds-project-row-active')?.textContent).toContain('Alpha');
    expect(container.querySelector('.ds-project-detail')?.textContent).toContain('Alpha');
  });

  it('keeps a newly created second project selected after reload', async () => {
    const alpha = createProject('project-alpha', 'Alpha');
    const beta = createProject('project-beta', 'Beta');
    let state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [alpha],
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: true, conversation: CURRENT_CONVERSATION };
      if (message.type === 'CREATE_PROJECT_CONTEXT') {
        state = {
          ...state,
          projects: [alpha, beta],
        };
        return beta;
      }
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);
    await clickButton('创建项目');
    await enterProjectName('Beta');
    await clickButton('创建项目');
    await clickButton('编辑');

    expect(inputByPlaceholder('项目名称').getAttribute('data-slot')).toBe('input');
    expect(inputByPlaceholder('项目说明（可选）').getAttribute('data-slot')).toBe('input');
    expect(textareaByPlaceholder('项目指令').getAttribute('data-slot')).toBe('textarea');
    expect(buttonsByText('保存更改')[0].getAttribute('data-slot')).toBe('button');
    expect(projectNameInput().value).toBe('Beta');
  });

  it('adds the current DeepSeek conversation to the selected project', async () => {
    const project = createProject('project-1', 'Alpha');
    let state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: true, conversation: CURRENT_CONVERSATION };
      if (message.type === 'ADD_CONVERSATION_TO_PROJECT') {
        state = {
          ...state,
          conversations: [{
            ...CURRENT_CONVERSATION,
            projectId: project.id,
            addedAt: 1,
            lastSeenAt: 2,
          }],
        };
        return { ok: true, conversation: state.conversations[0] };
      }
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);
    await clickButton('关联对话');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ADD_CONVERSATION_TO_PROJECT',
      payload: {
        projectId: 'project-1',
        conversation: CURRENT_CONVERSATION,
      },
    });
    expect(container.textContent).toContain('查看项目进展');
  });

  it('leads Projects with a status action for linking the open chat', async () => {
    const project = createProject('project-1', 'Alpha');
    project.instructions = 'Always preserve evidence.';
    let state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: true, conversation: CURRENT_CONVERSATION };
      if (message.type === 'ADD_CONVERSATION_TO_PROJECT') {
        state = {
          ...state,
          conversations: [{
            ...CURRENT_CONVERSATION,
            projectId: project.id,
            addedAt: 1,
            lastSeenAt: 2,
          }],
        };
        return { ok: true };
      }
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);

    const statusPanel = container.querySelector('.ds-project-readiness');
    expect(statusPanel?.textContent).toContain('项目状态');
    expect(statusPanel?.textContent).toContain('关联打开的对话');
    expect(statusPanel?.textContent).toContain('可以关联。');
    await clickButton('关联打开的对话');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ADD_CONVERSATION_TO_PROJECT',
      payload: {
        projectId: 'project-1',
        conversation: CURRENT_CONVERSATION,
      },
    });
    expect(container.querySelector('.ds-project-readiness')?.textContent).toContain('可使用');
  });

  it('uses Project status to open instructions editing before claiming readiness', async () => {
    const project = createProject('project-1', 'Alpha');
    const state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
      conversations: [{
        ...CURRENT_CONVERSATION,
        projectId: project.id,
        addedAt: 1,
        lastSeenAt: 2,
      }],
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: true, conversation: CURRENT_CONVERSATION };
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);

    const statusPanel = container.querySelector('.ds-project-readiness');
    expect(statusPanel?.textContent).toContain('需要指令');
    expect(statusPanel?.textContent).not.toContain('可使用');
    await clickButton('添加指令');

    expect(buttonsByText('保存更改')).toHaveLength(1);
    expect(projectNameInput().value).toBe('Alpha');
  });

  it('uses Project status to set the selected project for the next chat', async () => {
    const project = createProject('project-1', 'Alpha');
    project.instructions = 'Always preserve evidence.';
    let state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: { projectId?: string | null } }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
      if (message.type === 'SET_PENDING_PROJECT_CONTEXT') {
        state = {
          ...state,
          pendingProjectId: message.payload?.projectId ?? null,
        };
        return { ok: true };
      }
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);

    const statusPanel = container.querySelector('.ds-project-readiness');
    expect(statusPanel?.textContent).toContain('设置下一次对话');
    expect(statusPanel?.textContent).toContain('新的 DeepSeek 对话未指定项目。');
    expect(statusPanel?.querySelector('[data-slot="badge"]')?.textContent).toContain('设置下一次对话');
    expect(statusPanel?.querySelector('[data-slot="button"]')?.textContent).toContain('设为下一次对话');
    await clickButton('设为下一次对话');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SET_PENDING_PROJECT_CONTEXT',
      payload: { projectId: 'project-1' },
    });
    expect(container.querySelector('.ds-project-readiness')?.textContent).toContain('可使用');
  });

  it('treats a pending selected project as ready even when the open chat belongs elsewhere', async () => {
    const alpha = createProject('project-alpha', 'Alpha');
    alpha.instructions = 'Always preserve evidence.';
    const beta = createProject('project-beta', 'Beta');
    beta.instructions = 'Different project.';
    const state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [alpha, beta],
      pendingProjectId: alpha.id,
      conversations: [{
        ...CURRENT_CONVERSATION,
        projectId: beta.id,
        addedAt: 1,
        lastSeenAt: 2,
      }],
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: true, conversation: CURRENT_CONVERSATION };
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);

    const statusPanel = container.querySelector('.ds-project-readiness');
    expect(statusPanel?.textContent).toContain('可使用');
    expect(statusPanel?.textContent).toContain('新的 DeepSeek 对话会进入这个项目。');
    expect(statusPanel?.textContent).toContain('已关联到其他项目。');
    expect(statusPanel?.textContent).not.toContain('移动打开的对话');
    expect(buttonsByText('移动打开的对话')).toHaveLength(0);
  });

  it('surfaces project mutation failures instead of reloading as success', async () => {
    const project = createProject('project-1', 'Alpha');
    const state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: true, conversation: CURRENT_CONVERSATION };
      if (message.type === 'UPDATE_PROJECT_CONTEXT') return { ok: false, error: 'update failed' };
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);
    await clickButton('编辑');
    await clickButton('保存更改');

    expect(container.textContent).toContain('update failed');
  });

  it('applies repeated initial project navigation events even for the same project id', async () => {
    const alpha = createProject('project-alpha', 'Alpha');
    const beta = createProject('project-beta', 'Beta');
    const state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [alpha, beta],
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: true, conversation: CURRENT_CONVERSATION };
      return { ok: true };
    });

    await renderProjectsPage(sendMessage, {
      initialProjectId: beta.id,
      initialProjectNavigationKey: 1,
    });
    await clickButton('编辑');
    expect(projectNameInput().value).toBe('Beta');

    await act(async () => {
      root?.render(React.createElement(ProjectsPageWithProps, {
        initialProjectId: alpha.id,
        initialProjectNavigationKey: 2,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await clickButton('编辑');
    expect(projectNameInput().value).toBe('Alpha');
  });

  it('lets the open chat link be refreshed when it is already in the selected project', async () => {
    const project = createProject('project-1', 'Alpha');
    const state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
      conversations: [{
        ...CURRENT_CONVERSATION,
        projectId: project.id,
        addedAt: 1,
        lastSeenAt: 2,
      }],
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: true, conversation: CURRENT_CONVERSATION };
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);

    expect(container.textContent).toContain('已关联');
    expect(buttonsByText('关联对话')).toHaveLength(0);
    expect(buttonsByText('移到这里')).toHaveLength(0);
    await clickButton('更新关联');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ADD_CONVERSATION_TO_PROJECT',
      payload: {
        projectId: 'project-1',
        conversation: CURRENT_CONVERSATION,
      },
    });
  });

  it('keeps an open project edit draft across a same-project background refresh', async () => {
    const project = createProject('project-1', 'Alpha');
    const state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);
    await clickButton('编辑');
    await enterProjectName('Draft Alpha');

    await act(async () => {
      runtimeListeners.forEach((listener) => listener({
        type: 'PROJECT_CONTEXT_UPDATED',
        state: {
          ...state,
          projects: [{ ...project, description: 'Background refresh' }],
        },
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(projectNameInput().value).toBe('Draft Alpha');
    expect(buttonsByText('保存更改')).toHaveLength(1);
  });

  it('sets and clears the selected project for the next new conversation', async () => {
    const project = createProject('project-1', 'Alpha');
    let state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: { projectId?: string | null } }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
      if (message.type === 'SET_PENDING_PROJECT_CONTEXT') {
        state = {
          ...state,
          pendingProjectId: message.payload?.projectId ?? null,
        };
        return { ok: true };
      }
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);
    await clickButton('设为下一次');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SET_PENDING_PROJECT_CONTEXT',
      payload: { projectId: 'project-1' },
    });
    expect(container.textContent).toContain('清除');

    await clickButton('清除');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SET_PENDING_PROJECT_CONTEXT',
      payload: { projectId: null },
    });
  });

  it('shows when the next new conversation is assigned to another project', async () => {
    const alpha = createProject('project-alpha', 'Alpha');
    const beta = createProject('project-beta', 'Beta');
    const state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [alpha, beta],
      pendingProjectId: beta.id,
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);

    expect(container.textContent).toContain('新的 DeepSeek 对话会进入「Beta」。');
    expect(container.textContent).not.toContain('新的 DeepSeek 对话未指定项目。');
  });

  it('removes a linked conversation without deleting the project', async () => {
    const project = createProject('project-1', 'Alpha');
    let state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
      conversations: [{
        ...CURRENT_CONVERSATION,
        projectId: project.id,
        addedAt: 1,
        lastSeenAt: 2,
      }],
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: { conversationId?: string } }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
      if (message.type === 'REMOVE_CONVERSATION_FROM_PROJECT') {
        state = {
          ...state,
          conversations: state.conversations.filter((item) => item.conversationId !== message.payload?.conversationId),
        };
        return { ok: true };
      }
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);
    await clickButton('移除');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'REMOVE_CONVERSATION_FROM_PROJECT',
      payload: { conversationId: 'session-1' },
    });
    expect(container.textContent).toContain('暂无关联对话');
    expect(container.textContent).toContain('Alpha');
  });

  it('deletes a project through the visible destructive action', async () => {
    const project = createProject('project-1', 'Alpha');
    let state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: { projectId?: string } }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
      if (message.type === 'DELETE_PROJECT_CONTEXT') {
        state = {
          ...state,
          projects: [],
        };
        return { ok: true };
      }
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);
    await clickButton('删除');
    await clickModalButton('删除');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'DELETE_PROJECT_CONTEXT',
      payload: { projectId: 'project-1' },
    });
    expect(container.textContent).toContain('暂无项目');
  });

  it('renders project memory as compact project rows', async () => {
    const project = createProject('project-1', 'Alpha');
    const memory = createMemory(project.id, {
      name: 'Evidence rule',
      content: 'Keep verified evidence separate from guesses.',
      tags: ['evidence'],
      pinned: true,
    });
    const state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [memory];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);

    expect(container.querySelector('.ds-project-memory-row')?.textContent).toContain('Evidence rule');
    expect(container.querySelector('.ds-project-memory-row')?.textContent).toContain('Keep verified evidence');
    expect(container.querySelector('.ds-project-memory-list .ds-card')).toBeNull();
    expect(container.textContent).not.toContain('暂无记忆');
  });

  it('keeps project controls visible when project memories fail to load', async () => {
    let memoryLoads = 0;
    const project = createProject('project-1', 'Alpha');
    const memory = createMemory(project.id, {
      name: 'Evidence rule',
      content: 'Keep verified evidence separate from guesses.',
    });
    const state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') {
        memoryLoads += 1;
        if (memoryLoads === 1) throw new Error('memory offline');
        return [memory];
      }
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);
    await flushEffects();

    expect(container.textContent).toContain('Alpha');
    expect(container.textContent).toContain('项目记忆加载失败：memory offline');
    expect(container.querySelector('.ds-project-source-alert[data-slot="alert"]')?.textContent).toContain('memory offline');
    expect(container.textContent).not.toContain('暂无记忆');
    expect(buttonsByText('编辑')).toHaveLength(1);
    expect(buttonsByText('添加')).toHaveLength(0);
    expect(buttonsByText('重试')).toHaveLength(1);
    expect(buttonsByText('重试')[0].getAttribute('data-slot')).toBe('button');

    await clickButton('重试');
    await flushEffects();

    expect(container.textContent).toContain('Evidence rule');
    expect(container.textContent).not.toContain('memory offline');
  });

  it('shows a disclosure control for dense single-paragraph project instructions', async () => {
    const project = createProject('project-1', 'Alpha');
    project.instructions = [
      'Prioritize tasks by hourly rate, payment confidence, and expected cognitive load.',
      'Separate verified project facts from guesses, and include the source page or chat for every recommendation.',
    ].join(' ');
    const state: ProjectContextState = {
      ...EMPTY_PROJECT_STATE,
      projects: [project],
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_PROJECT_CONTEXT_STATE') return state;
      if (message.type === 'GET_MEMORIES') return [];
      if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
      return { ok: true };
    });

    await renderProjectsPage(sendMessage);

    expect(buttonsByText('显示完整指令')).toHaveLength(1);
    await clickButton('显示完整指令');
    expect(buttonsByText('收起')).toHaveLength(1);
  });
});

async function renderProjectsPage(
  sendMessage: ReturnType<typeof vi.fn>,
  props: ProjectsPageTestProps = {},
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
    root.render(
      React.createElement(TooltipProvider, null,
        React.createElement(ProjectsPageWithProps, props),
      ),
    );
  });
}

async function enterProjectName(value: string) {
  await enterInput('项目名称', value);
}

async function enterInput(placeholder: string, value: string) {
  const input = inputByPlaceholder(placeholder);
  await act(async () => {
    setInputValue(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function enterTextarea(placeholder: string, value: string) {
  const textarea = container.querySelector(`textarea[placeholder="${placeholder}"]`);
  expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
  await act(async () => {
    setTextareaValue(textarea as HTMLTextAreaElement, value);
    textarea?.dispatchEvent(new Event('input', { bubbles: true }));
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

async function clickModalButton(label: string) {
  const button = Array.from(document.body.querySelectorAll('.ds-modal-card button'))
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function projectNameInput(): HTMLInputElement {
  return inputByPlaceholder('项目名称');
}

function inputByPlaceholder(placeholder: string): HTMLInputElement {
  const input = container.querySelector(`input[placeholder="${placeholder}"]`);
  expect(input).toBeInstanceOf(HTMLInputElement);
  return input as HTMLInputElement;
}

function textareaByPlaceholder(placeholder: string): HTMLTextAreaElement {
  const textarea = container.querySelector(`textarea[placeholder="${placeholder}"]`);
  expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
  return textarea as HTMLTextAreaElement;
}

function buttonsByText(label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
    .filter((candidate): candidate is HTMLButtonElement => candidate.textContent === label);
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
}

function createProject(id: string, name: string): ProjectContext {
  return {
    id,
    name,
    description: '',
    instructions: '',
    createdAt: 1,
    updatedAt: 1,
  };
}

function createMemory(projectId: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id: 1,
    syncId: 'memory-1',
    scope: 'project',
    projectId,
    type: 'reference',
    name: 'Project memory',
    content: 'Memory content',
    description: '',
    tags: [],
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
    accessCount: 0,
    lastAccessedAt: 1,
    ...overrides,
  };
}
