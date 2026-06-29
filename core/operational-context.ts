import type { RuntimeDoctorReport } from './chat/runtime-doctor';
import type { LocaleMessageKey, MessageParams } from './i18n';
import type { ProjectContext, ProjectContextState, CurrentDeepSeekConversation } from './project/types';
import type { PromptInjectionSettings } from './prompt/settings';
import type { ToolRegistrySnapshot } from './tool/types';

export type OperationalHealth = 'ready' | 'needs_attention' | 'blocked' | 'unknown';
export type OperationalAvailability = 'available' | 'unavailable' | 'disabled' | 'unknown';
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

export type OperationalAttentionSource = 'runtime' | 'browser' | 'tools' | 'memory' | 'project' | 'execution';
export type OperationalAttentionSeverity = 'blocked' | 'attention' | 'warning' | 'info';
export type OperationalActivityStatus = 'idle' | 'running' | 'waiting' | 'failed' | 'unknown';

export interface OperationalNavigationTarget {
  tab: 'chat' | 'library' | 'projects' | 'capabilities';
  capabilitiesSubTab?: 'doctor' | 'browser' | 'tools';
}

export interface OperationalAttentionItem {
  id: string;
  source: OperationalAttentionSource;
  severity: OperationalAttentionSeverity;
  titleKey: LocaleMessageKey;
  detailKey?: LocaleMessageKey;
  detailParams?: MessageParams;
  route?: OperationalNavigationTarget;
  dedupeKey: string;
}

export interface OperationalActivitySummary {
  runningCount: number;
  recentCount: number;
  status: OperationalActivityStatus;
  updatedAt: number | null;
}

export interface OperationalContextBarItem {
  id: 'execution' | 'project' | 'session' | 'memory' | 'browser' | 'runtime' | 'tools';
  labelKey: LocaleMessageKey;
  valueKey?: LocaleMessageKey;
  valueParams?: MessageParams;
  valueText?: string;
  tone: OperationalTone;
  target: OperationalNavigationTarget;
  titleKey: LocaleMessageKey;
  titleParams?: MessageParams;
}

export interface GlobalOperationalContext {
  generatedAt: number;
  updatedAt: number;
  source: {
    chromeAvailable: boolean;
    runtimeDoctorGeneratedAt: number | null;
    toolRegistryRefreshedAt: number | null;
  };
  sourceVersions: {
    runtimeDoctorGeneratedAt: number | null;
    toolRegistryRefreshedAt: number | null;
    projectSchemaVersion: number | null;
  };
  execution: {
    route: OperationalExecutionRoute;
    tone: OperationalTone;
    health: OperationalHealth;
    availability: OperationalAvailability;
    chatEnabled: boolean | null;
    provider: RuntimeDoctorReport['provider'];
  };
  project: {
    projectId: string | null;
    name: string | null;
    source: OperationalProjectSource;
    tone: OperationalTone;
    health: OperationalHealth;
  };
  session: {
    strategy: OperationalSessionStrategy | null;
    tone: OperationalTone;
    health: OperationalHealth;
  };
  memory: {
    state: OperationalMemoryState;
    scope: OperationalMemoryScope;
    tone: OperationalTone;
    health: OperationalHealth;
    availability: OperationalAvailability;
  };
  browser: {
    state: OperationalBrowserState;
    tone: OperationalTone;
    health: OperationalHealth;
    availability: OperationalAvailability;
    expected: boolean;
    targetLabel: string | null;
    targetOrigin: string | null;
    monitorReady: boolean | null;
  };
  runtime: {
    state: OperationalRuntimeState;
    tone: OperationalTone;
    health: OperationalHealth;
    availability: OperationalAvailability;
    blockerCount: number | null;
    preparing: boolean | null;
  };
  tools: {
    enabledCount: number | null;
    providerCount: number | null;
    tone: OperationalTone;
    health: OperationalHealth;
    availability: OperationalAvailability;
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
  activity: OperationalActivitySummary;
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
  const projectState = input.projectState ?? null;
  const project = resolveOperationalProject(projectState, input.currentConversation ?? null);
  const sessionStrategy = report?.personalConvenience.sameSessionStrategy ?? null;
  const memoryEnabled = input.promptSettings?.memoryEnabled ?? null;
  const browserControl = report?.browserControl ?? null;
  const toolRegistry = input.toolRegistry ?? null;
  const enabledToolCount = toolRegistry ? countOperationalTools(toolRegistry) : null;
  const tools = resolveTools(enabledToolCount, toolRegistry?.providers.length ?? null);

  return {
    generatedAt: now,
    updatedAt: now,
    source: {
      chromeAvailable: input.chromeAvailable !== false,
      runtimeDoctorGeneratedAt: report?.generatedAt ?? null,
      toolRegistryRefreshedAt: toolRegistry?.refreshedAt ?? null,
    },
    sourceVersions: {
      runtimeDoctorGeneratedAt: report?.generatedAt ?? null,
      toolRegistryRefreshedAt: toolRegistry?.refreshedAt ?? null,
      projectSchemaVersion: projectState?.schemaVersion ?? null,
    },
    execution: resolveExecution(report),
    project,
    session: {
      strategy: sessionStrategy,
      tone: sessionStrategy ? 'ready' : 'unknown',
      health: sessionStrategy ? 'ready' : 'unknown',
    },
    memory: resolveMemory(memoryEnabled),
    browser: resolveBrowser(browserControl),
    runtime: resolveRuntime(report),
    tools,
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
    activity: deriveOperationalActivitySummary(),
  };
}

export function getOperationalHealth(state: GlobalOperationalContext): OperationalHealth {
  const healths = [
    state.execution.health,
    state.runtime.health,
    state.browser.expected ? state.browser.health : 'ready',
    state.tools.health,
  ];
  if (healths.includes('blocked')) return 'blocked';
  if (healths.includes('needs_attention')) return 'needs_attention';
  if (healths.every((health) => health === 'ready')) return 'ready';
  return 'unknown';
}

export function getBrowserAttention(state: GlobalOperationalContext): OperationalAttentionItem[] {
  if (!state.browser.expected) return [];
  if (state.browser.availability === 'unavailable') {
    return [createAttentionItem({
      id: 'browser-unavailable',
      source: 'browser',
      severity: 'blocked',
      titleKey: 'app.context.browserUnavailable',
      detailKey: 'app.context.browserTitle',
      detailParams: { value: getBrowserLabelKey(state.browser.state) },
      route: { tab: 'capabilities', capabilitiesSubTab: 'browser' },
    })];
  }
  if (state.browser.state === 'no-target') {
    return [createAttentionItem({
      id: 'browser-no-target',
      source: 'browser',
      severity: 'attention',
      titleKey: 'app.context.browserNone',
      route: { tab: 'capabilities', capabilitiesSubTab: 'browser' },
    })];
  }
  return [];
}

export function getRuntimeAttention(state: GlobalOperationalContext): OperationalAttentionItem[] {
  if (state.runtime.state === 'blocked') {
    return [createAttentionItem({
      id: 'runtime-blocked',
      source: 'runtime',
      severity: 'blocked',
      titleKey: 'app.context.runtimeBlocked',
      detailKey: 'app.context.runtimeTitleWithBlockers',
      detailParams: { value: getRuntimeLabelKey(state.runtime.state), count: state.runtime.blockerCount ?? 0 },
      route: { tab: 'capabilities', capabilitiesSubTab: 'doctor' },
    })];
  }
  if (state.runtime.state === 'needs_attention') {
    return [createAttentionItem({
      id: 'runtime-needs-attention',
      source: 'runtime',
      severity: 'attention',
      titleKey: 'app.context.runtimeAttention',
      route: { tab: 'capabilities', capabilitiesSubTab: 'doctor' },
    })];
  }
  return [];
}

export function getToolAvailability(state: GlobalOperationalContext): OperationalAvailability {
  return state.tools.availability;
}

export function getExecutionLabel(state: GlobalOperationalContext): LocaleMessageKey {
  return getExecutionLabelKey(state.execution.route);
}

export function getContextBarItems(state: GlobalOperationalContext): OperationalContextBarItem[] {
  const executionValueKey = getExecutionLabelKey(state.execution.route);
  const projectValue = getProjectValue(state);
  const sessionValueKey = getSessionLabelKey(state.session.strategy);
  const memoryValueKey = getMemoryLabelKey(state.memory.state);
  const browserValueKey = getBrowserLabelKey(state.browser.state);
  const runtimeValueKey = getRuntimeLabelKey(state.runtime.state);
  const toolsValue = getToolsValue(state);

  return [
    {
      id: 'execution',
      labelKey: 'app.context.execution',
      valueKey: executionValueKey,
      tone: state.execution.tone,
      target: { tab: 'chat' },
      titleKey: 'app.context.executionTitle',
      titleParams: { value: executionValueKey },
    },
    {
      id: 'project',
      labelKey: 'app.context.project',
      ...projectValue,
      tone: state.project.tone,
      target: { tab: 'projects' },
      titleKey: 'app.context.projectTitle',
      titleParams: { value: projectValue.valueText ?? projectValue.valueKey ?? 'app.context.projectUnknown' },
    },
    {
      id: 'session',
      labelKey: 'app.context.session',
      valueKey: sessionValueKey,
      tone: state.session.tone,
      target: { tab: 'chat' },
      titleKey: 'app.context.sessionTitle',
      titleParams: { value: sessionValueKey },
    },
    {
      id: 'memory',
      labelKey: 'app.context.memory',
      valueKey: memoryValueKey,
      tone: state.memory.tone,
      target: { tab: 'library' },
      titleKey: 'app.context.memoryTitle',
      titleParams: { value: memoryValueKey },
    },
    {
      id: 'browser',
      labelKey: 'app.context.browser',
      valueKey: browserValueKey,
      tone: state.browser.tone,
      target: { tab: 'capabilities', capabilitiesSubTab: 'browser' },
      titleKey: state.browser.targetLabel || state.browser.targetOrigin
        ? 'app.context.browserTitleWithTarget'
        : 'app.context.browserTitle',
      titleParams: state.browser.targetLabel || state.browser.targetOrigin
        ? { value: browserValueKey, target: state.browser.targetLabel ?? state.browser.targetOrigin ?? '' }
        : { value: browserValueKey },
    },
    {
      id: 'runtime',
      labelKey: 'app.context.runtime',
      valueKey: runtimeValueKey,
      tone: state.runtime.tone,
      target: { tab: 'capabilities', capabilitiesSubTab: 'doctor' },
      titleKey: state.runtime.blockerCount === null
        ? 'app.context.runtimeTitle'
        : 'app.context.runtimeTitleWithBlockers',
      titleParams: state.runtime.blockerCount === null
        ? { value: runtimeValueKey }
        : { value: runtimeValueKey, count: state.runtime.blockerCount },
    },
    {
      id: 'tools',
      labelKey: 'app.context.tools',
      ...toolsValue,
      tone: state.tools.tone,
      target: { tab: 'capabilities', capabilitiesSubTab: 'tools' },
      titleKey: 'app.context.toolsTitle',
      titleParams: { value: toolsValue.valueKey ?? 'app.context.toolsEnabled', count: state.tools.enabledCount ?? 0 },
    },
  ];
}

export function deriveOperationalAttentionItems(state: GlobalOperationalContext): OperationalAttentionItem[] {
  const items: OperationalAttentionItem[] = [];
  items.push(...getRuntimeAttention(state));
  items.push(...getBrowserAttention(state));

  if (state.tools.availability === 'unavailable') {
    items.push(createAttentionItem({
      id: 'tools-unavailable',
      source: 'tools',
      severity: 'warning',
      titleKey: 'app.context.toolsUnavailable',
      route: { tab: 'capabilities', capabilitiesSubTab: 'tools' },
    }));
  } else if (state.tools.enabledCount === 0) {
    items.push(createAttentionItem({
      id: 'tools-zero-enabled',
      source: 'tools',
      severity: 'attention',
      titleKey: 'app.context.toolsEnabled',
      detailParams: { count: 0 },
      route: { tab: 'capabilities', capabilitiesSubTab: 'tools' },
    }));
  }

  if (state.execution.availability === 'unavailable') {
    items.push(createAttentionItem({
      id: 'execution-unavailable',
      source: 'execution',
      severity: state.execution.chatEnabled === false ? 'warning' : 'blocked',
      titleKey: 'app.context.executionUnavailable',
      route: { tab: 'chat' },
    }));
  }

  return dedupeAttentionItems(items);
}

export function deriveOperationalActivitySummary(input?: Partial<OperationalActivitySummary>): OperationalActivitySummary {
  const runningCount = input?.runningCount ?? 0;
  const recentCount = input?.recentCount ?? 0;
  const status = input?.status ?? (runningCount > 0 ? 'running' : 'idle');
  return {
    runningCount,
    recentCount,
    status,
    updatedAt: input?.updatedAt ?? null,
  };
}

function resolveExecution(report: RuntimeDoctorReport | null): GlobalOperationalContext['execution'] {
  if (!report) {
    return {
      route: 'unknown',
      tone: 'unknown',
      health: 'unknown',
      availability: 'unknown',
      chatEnabled: null,
      provider: null,
    };
  }

  if (!report.chatEnabled) {
    return {
      route: 'unavailable',
      tone: 'unknown',
      health: 'unknown',
      availability: 'unavailable',
      chatEnabled: false,
      provider: report.provider,
    };
  }

  if (report.provider === 'official-api') {
    return {
      route: 'official-api',
      tone: 'ready',
      health: 'ready',
      availability: 'available',
      chatEnabled: true,
      provider: report.provider,
    };
  }

  if (report.provider === 'deepseek-web') {
    return {
      route: 'official-web',
      tone: report.hasWebAuth ? 'ready' : 'attention',
      health: report.hasWebAuth ? 'ready' : 'needs_attention',
      availability: 'available',
      chatEnabled: true,
      provider: report.provider,
    };
  }

  if (report.browserControl.enabled && report.browserControl.monitorReady) {
    return {
      route: 'browser-control',
      tone: 'ready',
      health: 'ready',
      availability: 'available',
      chatEnabled: true,
      provider: report.provider,
    };
  }

  return {
    route: 'unavailable',
    tone: 'attention',
    health: 'needs_attention',
    availability: 'unavailable',
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
      health: 'unknown',
    };
  }

  const currentProject = findCurrentConversationProject(state, currentConversation);
  if (currentProject) {
    return {
      projectId: currentProject.id,
      name: currentProject.name,
      source: 'current-conversation',
      tone: 'ready',
      health: 'ready',
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
      health: 'needs_attention',
    };
  }

  return {
    projectId: null,
    name: null,
    source: 'none',
    tone: 'unknown',
    health: 'unknown',
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

function resolveMemory(memoryEnabled: boolean | null): GlobalOperationalContext['memory'] {
  if (memoryEnabled === null) {
    return {
      state: 'unavailable',
      scope: 'global',
      tone: 'unknown',
      health: 'unknown',
      availability: 'unknown',
    };
  }
  if (!memoryEnabled) {
    return {
      state: 'disabled',
      scope: 'global',
      tone: 'attention',
      health: 'needs_attention',
      availability: 'disabled',
    };
  }
  return {
    state: 'enabled',
    scope: 'global',
    tone: 'ready',
    health: 'ready',
    availability: 'available',
  };
}

function resolveBrowser(
  browserControl: RuntimeDoctorReport['browserControl'] | null,
): GlobalOperationalContext['browser'] {
  if (!browserControl) {
    return {
      state: 'unknown',
      tone: 'unknown',
      health: 'unknown',
      availability: 'unknown',
      expected: false,
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
  const tone: OperationalTone = monitorReady || targetLocked
    ? 'ready'
    : state === 'unavailable'
      ? 'blocked'
      : targetSelected
        ? 'attention'
        : 'unknown';

  return {
    state,
    tone,
    health: toneToHealth(tone),
    availability: browserControl.enabled === false ? 'unavailable' : 'available',
    expected: browserControl.enabled === true,
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
      health: 'unknown',
      availability: 'unknown',
      blockerCount: null,
      preparing: null,
    };
  }

  const readiness = report.readiness;
  const health: OperationalHealth = readiness.status === 'ready'
    ? 'ready'
    : readiness.status === 'blocked'
      ? 'blocked'
      : 'needs_attention';
  return {
    state: readiness.status,
    tone: healthToTone(health),
    health,
    availability: readiness.status === 'blocked' ? 'unavailable' : 'available',
    blockerCount: readiness.blockers.length,
    preparing: readiness.preparing,
  };
}

function resolveTools(
  enabledCount: number | null,
  providerCount: number | null,
): GlobalOperationalContext['tools'] {
  if (enabledCount === null) {
    return {
      enabledCount,
      providerCount,
      tone: 'unknown',
      health: 'unknown',
      availability: 'unknown',
    };
  }
  const health: OperationalHealth = enabledCount > 0 ? 'ready' : 'needs_attention';
  return {
    enabledCount,
    providerCount,
    tone: healthToTone(health),
    health,
    availability: enabledCount > 0 ? 'available' : 'unavailable',
  };
}

function countOperationalTools(registry: ToolRegistrySnapshot): number {
  return registry.tools.filter((tool) => (
    tool.execution.enabled &&
    tool.execution.mode === 'auto'
  )).length;
}

function getExecutionLabelKey(route: OperationalExecutionRoute): LocaleMessageKey {
  if (route === 'official-web') return 'app.context.executionWeb';
  if (route === 'official-api') return 'app.context.executionApi';
  if (route === 'browser-control') return 'app.context.executionBrowser';
  if (route === 'unavailable') return 'app.context.executionUnavailable';
  return 'app.context.executionUnknown';
}

function getProjectValue(state: GlobalOperationalContext): Pick<OperationalContextBarItem, 'valueKey' | 'valueText'> {
  if (state.project.name) return { valueText: state.project.name };
  if (state.project.source === 'unknown') return { valueKey: 'app.context.projectUnknown' };
  return { valueKey: 'app.context.projectNone' };
}

function getSessionLabelKey(strategy: OperationalSessionStrategy | null): LocaleMessageKey {
  if (strategy === 'current') return 'app.context.sessionCurrent';
  if (strategy === 'last') return 'app.context.sessionLast';
  if (strategy === 'new') return 'app.context.sessionNew';
  return 'app.context.sessionUnknown';
}

function getMemoryLabelKey(state: OperationalMemoryState): LocaleMessageKey {
  if (state === 'enabled') return 'app.context.memoryOn';
  if (state === 'disabled') return 'app.context.memoryOff';
  return 'app.context.memoryUnavailable';
}

function getBrowserLabelKey(state: OperationalBrowserState): LocaleMessageKey {
  if (state === 'target-locked') return 'app.context.browserLocked';
  if (state === 'target-selected') return 'app.context.browserSelected';
  if (state === 'no-target') return 'app.context.browserNone';
  if (state === 'unavailable') return 'app.context.browserUnavailable';
  return 'app.context.browserUnknown';
}

function getRuntimeLabelKey(state: OperationalRuntimeState): LocaleMessageKey {
  if (state === 'ready') return 'app.context.runtimeReady';
  if (state === 'blocked') return 'app.context.runtimeBlocked';
  if (state === 'needs_attention') return 'app.context.runtimeAttention';
  return 'app.context.runtimeUnknown';
}

function getToolsValue(state: GlobalOperationalContext): Pick<OperationalContextBarItem, 'valueKey' | 'valueParams'> {
  if (state.tools.enabledCount === null) return { valueKey: 'app.context.toolsUnavailable' };
  return { valueKey: 'app.context.toolsEnabled', valueParams: { count: state.tools.enabledCount } };
}

function createAttentionItem(item: Omit<OperationalAttentionItem, 'dedupeKey'>): OperationalAttentionItem {
  return {
    ...item,
    dedupeKey: `${item.source}:${item.id}`,
  };
}

function dedupeAttentionItems(items: OperationalAttentionItem[]): OperationalAttentionItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.dedupeKey)) return false;
    seen.add(item.dedupeKey);
    return true;
  });
}

function healthToTone(health: OperationalHealth): OperationalTone {
  if (health === 'needs_attention') return 'attention';
  return health;
}

function toneToHealth(tone: OperationalTone): OperationalHealth {
  if (tone === 'attention') return 'needs_attention';
  return tone;
}
