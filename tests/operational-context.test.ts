import { describe, expect, it } from 'vitest';
import type { RuntimeDoctorReport } from '../core/chat/runtime-doctor';
import {
  createGlobalOperationalContext,
  deriveOperationalActivitySummary,
  deriveOperationalAttentionItems,
  getContextBarItems,
  getExecutionLabel,
  getOperationalHealth,
  getToolAvailability,
} from '../core/operational-context';
import { PROJECT_CONTEXT_SCHEMA_VERSION, type ProjectContextState } from '../core/project';
import type { ToolDescriptor, ToolRegistrySnapshot } from '../core/tool/types';

describe('createGlobalOperationalContext', () => {
  it('summarizes the current operational route, project, memory, session, and tools', () => {
    const context = createGlobalOperationalContext({
      now: 10,
      runtimeDoctorReport: createRuntimeReport(),
      projectState: createProjectState(),
      currentConversation: {
        conversationId: 'conversation-1',
        title: 'DeepSeek++ planning',
        url: 'https://chat.deepseek.com/a',
      },
      promptSettings: {
        memoryEnabled: false,
        systemPromptEnabled: true,
        presetCadence: 'default',
        forceResponseLanguage: 'auto',
      },
      toolRegistry: createToolRegistry([
        createTool('web_search'),
        createTool('manual_tool', 'manual'),
        createTool('disabled_tool', 'auto', false),
      ]),
    });

    expect(context.generatedAt).toBe(10);
    expect(context.updatedAt).toBe(10);
    expect(context.sourceVersions.runtimeDoctorGeneratedAt).toBe(1);
    expect(context.execution.route).toBe('official-web');
    expect(context.execution.health).toBe('ready');
    expect(context.execution.availability).toBe('available');
    expect(context.project.name).toBe('DeepSeek++');
    expect(context.project.source).toBe('current-conversation');
    expect(context.session.strategy).toBe('current');
    expect(context.memory.state).toBe('disabled');
    expect(context.memory.availability).toBe('disabled');
    expect(context.tools.enabledCount).toBe(1);
    expect(getExecutionLabel(context)).toBe('app.context.executionWeb');
    expect(getToolAvailability(context)).toBe('available');
  });

  it('uses pending project context when the current conversation has no project', () => {
    const context = createGlobalOperationalContext({
      runtimeDoctorReport: createRuntimeReport(),
      projectState: {
        ...createProjectState(),
        conversations: [],
        pendingProjectId: 'project-2',
      },
      promptSettings: {
        memoryEnabled: true,
        systemPromptEnabled: true,
        presetCadence: 'default',
        forceResponseLanguage: 'auto',
      },
      toolRegistry: createToolRegistry([]),
    });

    expect(context.project.name).toBe('Scheduler');
    expect(context.project.source).toBe('pending-next-conversation');
    expect(context.project.tone).toBe('attention');
    expect(context.project.health).toBe('needs_attention');
    expect(context.memory.state).toBe('enabled');
  });

  it('surfaces Browser Control lock and Runtime Doctor blockers as cockpit summary state', () => {
    const context = createGlobalOperationalContext({
      runtimeDoctorReport: createRuntimeReport({
        readiness: {
          ready: false,
          status: 'blocked',
          blockers: ['browser_target_missing'],
          lastPreparedAt: null,
          preparing: false,
          targetStatus: 'missing',
          noLeak: true,
        },
        browserControl: {
          enabled: true,
          targetSelected: true,
          targetLock: {
            enabled: true,
            label: 'Dev++',
            origin: 'https://chat.deepseek.com',
            updatedAt: 1,
          },
          visualCaptureAllowed: true,
          actVerifyEnabled: true,
          evidencePacksEnabled: true,
          debugDistillerEnabled: true,
          monitorReady: false,
        },
      }),
    });

    expect(context.browser.state).toBe('target-locked');
    expect(context.browser.tone).toBe('ready');
    expect(context.browser.health).toBe('ready');
    expect(context.browser.targetLabel).toBe('Dev++');
    expect(context.runtime.state).toBe('blocked');
    expect(context.runtime.health).toBe('blocked');
    expect(context.runtime.blockerCount).toBe(1);
    expect(getOperationalHealth(context)).toBe('blocked');
  });

  it('degrades to unknown or unavailable state without Chrome-backed inputs', () => {
    const context = createGlobalOperationalContext({
      chromeAvailable: false,
    });

    expect(context.source.chromeAvailable).toBe(false);
    expect(context.execution.route).toBe('unknown');
    expect(context.execution.health).toBe('unknown');
    expect(context.project.source).toBe('unknown');
    expect(context.memory.state).toBe('unavailable');
    expect(context.browser.state).toBe('unknown');
    expect(context.tools.enabledCount).toBeNull();
    expect(context.activity.status).toBe('idle');
    expect(deriveOperationalAttentionItems(context)).toEqual([]);
  });

  it('derives blocked runtime attention without UI-owned Runtime Doctor logic', () => {
    const context = createGlobalOperationalContext({
      runtimeDoctorReport: createRuntimeReport({
        readiness: {
          ready: false,
          status: 'blocked',
          blockers: ['web_auth_missing', 'browser_target_missing'],
          lastPreparedAt: null,
          preparing: false,
          targetStatus: 'missing',
          noLeak: true,
        },
      }),
      toolRegistry: createToolRegistry([createTool('web_search')]),
    });

    expect(deriveOperationalAttentionItems(context)).toContainEqual(expect.objectContaining({
      id: 'runtime-blocked',
      source: 'runtime',
      severity: 'blocked',
      titleKey: 'app.context.runtimeBlocked',
      route: { tab: 'capabilities', capabilitiesSubTab: 'doctor' },
      dedupeKey: 'runtime:runtime-blocked',
    }));
  });

  it('derives Browser Control no-target attention only when Browser Control is expected', () => {
    const enabledContext = createGlobalOperationalContext({
      runtimeDoctorReport: createRuntimeReport(),
      toolRegistry: createToolRegistry([createTool('web_search')]),
    });
    const disabledContext = createGlobalOperationalContext({
      runtimeDoctorReport: createRuntimeReport({
        browserControl: {
          ...createRuntimeReport().browserControl,
          enabled: false,
        },
      }),
      toolRegistry: createToolRegistry([createTool('web_search')]),
    });

    expect(deriveOperationalAttentionItems(enabledContext)).toContainEqual(expect.objectContaining({
      id: 'browser-no-target',
      source: 'browser',
      severity: 'attention',
    }));
    expect(deriveOperationalAttentionItems(disabledContext).some((item) => item.id === 'browser-no-target')).toBe(false);
  });

  it('derives tools unavailable attention for zero enabled tools', () => {
    const context = createGlobalOperationalContext({
      runtimeDoctorReport: createRuntimeReport(),
      toolRegistry: createToolRegistry([createTool('manual_tool', 'manual')]),
    });

    expect(context.tools.enabledCount).toBe(0);
    expect(context.tools.health).toBe('needs_attention');
    expect(context.tools.availability).toBe('unavailable');
    expect(deriveOperationalAttentionItems(context)).toContainEqual(expect.objectContaining({
      id: 'tools-unavailable',
      source: 'tools',
      titleKey: 'app.context.toolsUnavailable',
    }));
  });

  it('keeps context bar item IDs, routes, and i18n keys stable', () => {
    const context = createGlobalOperationalContext({
      runtimeDoctorReport: createRuntimeReport(),
      projectState: createProjectState(),
      currentConversation: {
        conversationId: 'conversation-1',
        title: 'DeepSeek++ planning',
        url: 'https://chat.deepseek.com/a',
      },
      toolRegistry: createToolRegistry([createTool('web_search')]),
    });

    const items = getContextBarItems(context);
    expect(items.map((item) => item.id)).toEqual([
      'execution',
      'project',
      'session',
      'memory',
      'browser',
      'runtime',
      'tools',
    ]);
    expect(items.find((item) => item.id === 'browser')).toMatchObject({
      labelKey: 'app.context.browser',
      valueKey: 'app.context.browserNone',
      target: { tab: 'capabilities', capabilitiesSubTab: 'browser' },
    });
    expect(items.find((item) => item.id === 'runtime')).toMatchObject({
      labelKey: 'app.context.runtime',
      valueKey: 'app.context.runtimeReady',
      target: { tab: 'capabilities', capabilitiesSubTab: 'doctor' },
    });
    expect(items.find((item) => item.id === 'tools')).toMatchObject({
      labelKey: 'app.context.tools',
      valueKey: 'app.context.toolsEnabled',
      valueParams: { count: 1 },
      target: { tab: 'capabilities', capabilitiesSubTab: 'tools' },
    });
  });

  it('summarizes activity as idle without an event source and running when counts exist', () => {
    expect(deriveOperationalActivitySummary()).toEqual({
      runningCount: 0,
      recentCount: 0,
      status: 'idle',
      updatedAt: null,
    });
    expect(deriveOperationalActivitySummary({ runningCount: 2, recentCount: 5, updatedAt: 20 })).toEqual({
      runningCount: 2,
      recentCount: 5,
      status: 'running',
      updatedAt: 20,
    });
  });
});

function createRuntimeReport(
  patch: Partial<RuntimeDoctorReport> = {},
): RuntimeDoctorReport {
  const base: RuntimeDoctorReport = {
    ok: true,
    generatedAt: 1,
    chatEnabled: true,
    chatBusy: false,
    provider: 'deepseek-web',
    hasApiKey: false,
    hasWebAuth: true,
    webAuthRejected: false,
    deepSeekTabCount: 1,
    sidepanelSession: {
      active: true,
      source: 'session',
      parentMessageId: null,
    },
    personalConvenience: {
      enabled: true,
      autoReadyCheckBeforeRun: true,
      autoRefreshWebAuth: true,
      sameSessionStrategy: 'current',
      visualMonitorDefault: true,
      reducedConfirmations: true,
      lastSessionRemembered: false,
      lastSessionSource: null,
      lastSessionUpdatedAt: null,
    },
    vision: {
      maxImagesPerTurn: 5,
      rawImagesStoredDurably: false,
    },
    browserControl: {
      enabled: true,
      targetSelected: false,
      targetLock: {
        enabled: false,
        label: null,
        origin: null,
        updatedAt: null,
      },
      visualCaptureAllowed: true,
      actVerifyEnabled: true,
      evidencePacksEnabled: true,
      debugDistillerEnabled: true,
      monitorReady: false,
    },
    contentScripts: {
      checked: true,
      totalTabs: 1,
      healthyTabs: 1,
      staleTabs: 0,
      staleTabIds: [],
    },
    automation: {
      maxAttempts: 3,
      retryableFailure: null,
    },
    autopilot: {
      inFlightSource: null,
      latestRun: null,
      recentRuns: [],
    },
    humanEval: {
      grade: 'A',
      checks: [],
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
    readiness: {
      ready: true,
      status: 'ready',
      blockers: [],
      lastPreparedAt: 1,
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
  return deepMergeRuntimeReport(base, patch);
}

function deepMergeRuntimeReport(
  base: RuntimeDoctorReport,
  patch: Partial<RuntimeDoctorReport>,
): RuntimeDoctorReport {
  return {
    ...base,
    ...patch,
    readiness: {
      ...base.readiness,
      ...patch.readiness,
    },
    browserControl: {
      ...base.browserControl,
      ...patch.browserControl,
      targetLock: {
        ...base.browserControl.targetLock,
        ...patch.browserControl?.targetLock,
      },
    },
  };
}

function createProjectState(): ProjectContextState {
  return {
    schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
    projects: [
      {
        id: 'project-1',
        name: 'DeepSeek++',
        description: '',
        instructions: '',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'project-2',
        name: 'Scheduler',
        description: '',
        instructions: '',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    conversations: [
      {
        conversationId: 'conversation-1',
        projectId: 'project-1',
        title: 'DeepSeek++ planning',
        url: 'https://chat.deepseek.com/a',
        addedAt: 1,
        lastSeenAt: 1,
      },
    ],
    pendingProjectId: null,
  };
}

function createToolRegistry(tools: ToolDescriptor[]): ToolRegistrySnapshot {
  return {
    providers: [],
    tools,
    refreshedAt: 1,
  };
}

function createTool(
  name: string,
  mode: ToolDescriptor['execution']['mode'] = 'auto',
  enabled = true,
): ToolDescriptor {
  return {
    id: name,
    provider: {
      kind: 'local',
      id: 'test',
      displayName: 'Test',
      transport: 'in_process',
    },
    name,
    invocationName: name,
    title: name,
    description: name,
    inputSchema: {
      type: 'object',
    },
    execution: {
      mode,
      enabled,
      risk: 'low',
    },
  };
}
