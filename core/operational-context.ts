import type { RuntimeDoctorReport } from './chat/runtime-doctor';
import type { ProjectContext, ProjectContextState, CurrentDeepSeekConversation } from './project/types';
import type { PromptInjectionSettings } from './prompt/settings';
import type { ToolRegistrySnapshot } from './tool/types';

export type OperationalTone = 'ready' | 'attention' | 'blocked' | 'unknown';

export type OperationalExecutionRoute =
  | 'official-web'
  | 'official-api'
  | 'browser-control'
  | 'unavailable'
  | 'unknown';

export type OperationalProjectSource = 'current-conversation' | 'pending-next-conversation' | 'none' | 'unknown';
export type OperationalMemoryState = 'enabled' | 'disabled' | 'unavailable';
export type OperationalMemoryScope = 'global' | 'project' | 'session';
export type OperationalBrowserState = 'target-locked' | 'target-selected' | 'no-target' | 'unavailable' | 'unknown';
export type OperationalRuntimeState = RuntimeDoctorReport['readiness']['status'] | 'unknown';
export type OperationalSessionStrategy = RuntimeDoctorReport['personalConvenience']['sameSessionStrategy'];

export interface GlobalOperationalContext {
  generatedAt: number;
  source: {
    chromeAvailable: boolean;
    runtimeDoctorGeneratedAt: number | null;
    toolRegistryRefreshedAt: number | null;
  };
  execution: {
    route: OperationalExecutionRoute;
    tone: OperationalTone;
    chatEnabled: boolean | null;
    provider: RuntimeDoctorReport['provider'];
  };
  project: {
    projectId: string | null;
    name: string | null;
    source: OperationalProjectSource;
    tone: OperationalTone;
  };
  session: {
    strategy: OperationalSessionStrategy | null;
    tone: OperationalTone;
  };
  memory: {
    state: OperationalMemoryState;
    scope: OperationalMemoryScope;
    tone: OperationalTone;
  };
  browser: {
    state: OperationalBrowserState;
    tone: OperationalTone;
    targetLabel: string | null;
    targetOrigin: string | null;
    monitorReady: boolean | null;
  };
  runtime: {
    state: OperationalRuntimeState;
    tone: OperationalTone;
    blockerCount: number | null;
    preparing: boolean | null;
  };
  tools: {
    enabledCount: number | null;
    providerCount: number | null;
    tone: OperationalTone;
  };
  capabilities: {
    vision: boolean | null;
    browserControl: boolean | null;
    tools: boolean | null;
  };
  context: {
    activeProjectName: string | null;
    memoryEnabled: boolean | null;
    sessionStrategy: OperationalSessionStrategy | null;
  };
}

export interface CreateGlobalOperationalContextInput {
  chromeAvailable?: boolean;
  now?: number;
  runtimeDoctorReport?: RuntimeDoctorReport | null;
  projectState?: ProjectContextState | null;
  currentConversation?: CurrentDeepSeekConversation | null;
  promptSettings?: PromptInjectionSettings | null;
  toolRegistry?: ToolRegistrySnapshot | null;
}

export function createGlobalOperationalContext(
  input: CreateGlobalOperationalContextInput = {},
): GlobalOperationalContext {
  const now = input.now ?? Date.now();
  const report = input.runtimeDoctorReport ?? null;
  const project = resolveOperationalProject(input.projectState ?? null, input.currentConversation ?? null);
  const sessionStrategy = report?.personalConvenience.sameSessionStrategy ?? null;
  const memoryEnabled = input.promptSettings?.memoryEnabled ?? null;
  const browserControl = report?.browserControl ?? null;
  const toolRegistry = input.toolRegistry ?? null;
  const enabledToolCount = toolRegistry ? countOperationalTools(toolRegistry) : null;

  return {
    generatedAt: now,
    source: {
      chromeAvailable: input.chromeAvailable !== false,
      runtimeDoctorGeneratedAt: report?.generatedAt ?? null,
      toolRegistryRefreshedAt: toolRegistry?.refreshedAt ?? null,
    },
    execution: resolveExecution(report),
    project,
    session: {
      strategy: sessionStrategy,
      tone: sessionStrategy ? 'ready' : 'unknown',
    },
    memory: {
      state: memoryEnabled === null ? 'unavailable' : memoryEnabled ? 'enabled' : 'disabled',
      scope: 'global',
      tone: memoryEnabled === null ? 'unknown' : memoryEnabled ? 'ready' : 'attention',
    },
    browser: resolveBrowser(browserControl),
    runtime: resolveRuntime(report),
    tools: {
      enabledCount: enabledToolCount,
      providerCount: toolRegistry?.providers.length ?? null,
      tone: enabledToolCount === null ? 'unknown' : enabledToolCount > 0 ? 'ready' : 'attention',
    },
    capabilities: {
      vision: report ? report.hasApiKey || report.hasWebAuth : null,
      browserControl: browserControl ? browserControl.enabled && browserControl.monitorReady : null,
      tools: enabledToolCount === null ? null : enabledToolCount > 0,
    },
    context: {
      activeProjectName: project.name,
      memoryEnabled,
      sessionStrategy,
    },
  };
}

function resolveExecution(report: RuntimeDoctorReport | null): GlobalOperationalContext['execution'] {
  if (!report) {
    return {
      route: 'unknown',
      tone: 'unknown',
      chatEnabled: null,
      provider: null,
    };
  }

  if (!report.chatEnabled) {
    return {
      route: 'unavailable',
      tone: 'unknown',
      chatEnabled: false,
      provider: report.provider,
    };
  }

  if (report.provider === 'official-api') {
    return {
      route: 'official-api',
      tone: 'ready',
      chatEnabled: true,
      provider: report.provider,
    };
  }

  if (report.provider === 'deepseek-web') {
    return {
      route: 'official-web',
      tone: report.hasWebAuth ? 'ready' : 'attention',
      chatEnabled: true,
      provider: report.provider,
    };
  }

  if (report.browserControl.enabled && report.browserControl.monitorReady) {
    return {
      route: 'browser-control',
      tone: 'ready',
      chatEnabled: true,
      provider: report.provider,
    };
  }

  return {
    route: 'unavailable',
    tone: 'attention',
    chatEnabled: true,
    provider: report.provider,
  };
}

function resolveOperationalProject(
  state: ProjectContextState | null,
  currentConversation: CurrentDeepSeekConversation | null,
): GlobalOperationalContext['project'] {
  if (!state) {
    return {
      projectId: null,
      name: null,
      source: 'unknown',
      tone: 'unknown',
    };
  }

  const currentProject = findCurrentConversationProject(state, currentConversation);
  if (currentProject) {
    return {
      projectId: currentProject.id,
      name: currentProject.name,
      source: 'current-conversation',
      tone: 'ready',
    };
  }

  const pendingProject = state.pendingProjectId
    ? state.projects.find((project) => project.id === state.pendingProjectId) ?? null
    : null;
  if (pendingProject) {
    return {
      projectId: pendingProject.id,
      name: pendingProject.name,
      source: 'pending-next-conversation',
      tone: 'attention',
    };
  }

  return {
    projectId: null,
    name: null,
    source: 'none',
    tone: 'unknown',
  };
}

function findCurrentConversationProject(
  state: ProjectContextState,
  currentConversation: CurrentDeepSeekConversation | null,
): ProjectContext | null {
  if (!currentConversation) return null;
  const membership = state.conversations.find((item) => item.conversationId === currentConversation.conversationId);
  if (!membership) return null;
  return state.projects.find((project) => project.id === membership.projectId) ?? null;
}

function resolveBrowser(
  browserControl: RuntimeDoctorReport['browserControl'] | null,
): GlobalOperationalContext['browser'] {
  if (!browserControl) {
    return {
      state: 'unknown',
      tone: 'unknown',
      targetLabel: null,
      targetOrigin: null,
      monitorReady: null,
    };
  }

  const targetLock = browserControl.targetLock;
  const targetLocked = targetLock.enabled === true;
  const targetSelected = browserControl.targetSelected === true;
  const monitorReady = browserControl.monitorReady === true;
  const state: OperationalBrowserState = browserControl.enabled === false
    ? 'unavailable'
    : targetLocked
      ? 'target-locked'
      : targetSelected
        ? 'target-selected'
        : 'no-target';

  return {
    state,
    tone: monitorReady || targetLocked
      ? 'ready'
      : state === 'unavailable'
        ? 'blocked'
        : targetSelected
          ? 'attention'
          : 'unknown',
    targetLabel: targetLock.label,
    targetOrigin: targetLock.origin,
    monitorReady,
  };
}

function resolveRuntime(report: RuntimeDoctorReport | null): GlobalOperationalContext['runtime'] {
  if (!report) {
    return {
      state: 'unknown',
      tone: 'unknown',
      blockerCount: null,
      preparing: null,
    };
  }

  const readiness = report.readiness;
  return {
    state: readiness.status,
    tone: readiness.status === 'ready'
      ? 'ready'
      : readiness.status === 'blocked'
        ? 'blocked'
        : 'attention',
    blockerCount: readiness.blockers.length,
    preparing: readiness.preparing,
  };
}

function countOperationalTools(registry: ToolRegistrySnapshot): number {
  return registry.tools.filter((tool) => (
    tool.execution.enabled &&
    tool.execution.mode === 'auto'
  )).length;
}
