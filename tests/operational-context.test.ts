import { describe, expect, it } from 'vitest';
import type { RuntimeDoctorReport } from '../core/chat/runtime-doctor';
import { createGlobalOperationalContext } from '../core/operational-context';
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

    expect(context.execution.route).toBe('official-web');
    expect(context.project.name).toBe('DeepSeek++');
    expect(context.project.source).toBe('current-conversation');
    expect(context.session.strategy).toBe('current');
    expect(context.memory.state).toBe('disabled');
    expect(context.tools.enabledCount).toBe(1);
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
    expect(context.browser.targetLabel).toBe('Dev++');
    expect(context.runtime.state).toBe('blocked');
    expect(context.runtime.blockerCount).toBe(1);
  });

  it('degrades to unknown or unavailable state without Chrome-backed inputs', () => {
    const context = createGlobalOperationalContext({
      chromeAvailable: false,
    });

    expect(context.source.chromeAvailable).toBe(false);
    expect(context.execution.route).toBe('unknown');
    expect(context.project.source).toBe('unknown');
    expect(context.memory.state).toBe('unavailable');
    expect(context.browser.state).toBe('unknown');
    expect(context.tools.enabledCount).toBeNull();
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
  return {
    ...base,
    ...patch,
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
