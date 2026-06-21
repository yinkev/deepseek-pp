import {
  getAllMemories,
  getMemoryById,
  saveMemory,
  updateMemory,
  deleteMemory,
  deleteMemoriesForProject,
  touchMemories,
  replaceAllMemories,
  archiveStaleMemories,
} from '../core/memory/store';
import { filterMemoriesByProjectScope } from '../core/memory/scope';
import {
  deleteGitHubSkillSource,
  getAllSkillSources,
  getAllSkills,
  getSkillLibrary,
  getUserSkills,
  replaceAllCustomSkills,
  replaceAllSkillSources,
  saveSkill,
  setSkillEnabled,
  deleteSkill,
} from '../core/skill/registry';
import {
  checkGitHubSkillSourceUpdates,
  importGitHubSkillSource,
  previewGitHubSkillSource,
  updateGitHubSkillSource,
} from '../core/skill/github-importer';
import {
  importLocalSkillSource,
  pickLocalSkillFolder,
  previewLocalSkillSource,
} from '../core/skill/local-importer';
import {
  getAllPresets,
  savePreset,
  deletePreset,
  getActivePreset,
  setActivePresetId,
  replaceAllPresets,
} from '../core/preset/store';
import { getModelType, setModelType } from '../core/model/store';
import { getDeepSeekTheme, saveDeepSeekTheme } from '../core/theme/store';
import { getBackgroundConfig, saveBackgroundConfig, clearBackgroundConfig } from '../core/background/store';
import { getPetConfig, savePetConfig, clearPetConfig } from '../core/pet/store';
import { clearUsageRecords, getUsageSummary, recordUsageTurn } from '../core/usage/store';
import { getExtensionVersion } from '../core/version';
import { getSyncConfig, saveSyncConfig } from '../core/sync/config';
import { mergeLocalSkillImportsIntoSyncSnapshot } from '../core/sync/local-skill-merge';
import { webdavTest, webdavMkcol, webdavGet, webdavPut } from '../core/sync/webdav-client';
import {
  parseValidatedArray,
  parseValidatedJson,
  validateImportedMemory,
  validatePreset,
  validateProjectContextState,
  validateSavedItemsState,
  validateSkillImportSource,
  validateSkill,
  validateStoredMemory,
} from '../core/sync/schema';
import { appendToolCallHistory, clearToolCallHistory, getToolCallHistory } from '../core/tool/history';
import { redactDurableToolString } from '../core/tool/redaction';
import {
  executeRuntimeToolCall,
  getRuntimeToolDescriptors,
  refreshRuntimeToolDescriptors,
  type RuntimeToolCallOptions,
} from '../core/tool/runtime';
import {
  browserControlService,
  createBrowserActVerifyPrompt,
  executeBrowserControlToolCall,
  getBrowserControlSettings,
  getBrowserControlState,
  isBrowserControlToolName,
  shouldVerifyAfterBrowserAction,
  saveBrowserControlSettings,
	  setBrowserControlEnabled,
	  type BrowserControlSettings,
	  type BrowserControlState,
	  type BrowserControlTargetPreparation,
	  type BrowserScreenshotCaptureResult,
	} from '../core/browser-control';
import { filterSidepanelChatToolDescriptors } from '../core/tool/sidepanel';
import {
  addConversationToProject,
  bindPendingProjectConversation,
  createProjectContext,
  deleteProjectContext,
  formatProjectPromptContext,
  getProjectContextState,
  getProjectForConversation,
  getProjectPromptContextForConversation,
  removeConversationFromProject,
  saveProjectContextState,
  setPendingProjectContext,
  updateProjectContext,
} from '../core/project';
import { getArtifact } from '../core/artifact';
import {
  deleteSavedItem,
  getAllSavedItems,
  getSavedItemsState,
  replaceAllSavedItems,
  saveSavedItem,
} from '../core/saved-items';
import {
  getPromptInjectionSettings,
  savePromptInjectionSettings,
  shouldInjectPresetForTurn,
} from '../core/prompt/settings';
import {
  detectVoiceCapabilities,
  getVoiceSettings,
  saveVoiceSettings,
} from '../core/voice/settings';
import type { SandboxExecutionResult, SandboxRunRequest, SandboxToolRuntime } from '../core/sandbox';
import { getCurrentBrowserExtensionEnvironment } from '../core/platform';
import { readOptionalChromeApi } from '../core/platform/chrome-api';
import {
  dismissWhatsNew,
  hasPendingWhatsNew,
  markWhatsNewPending,
} from '../core/whats-new';
import {
  createMcpServer,
  deleteMcpServer,
  getAllMcpServers,
  getMcpToolCache,
  getMcpServerById,
  updateMcpServer,
} from '../core/mcp/store';
import { refreshMcpServerDiscovery } from '../core/mcp/discovery';
import { getMcpOriginPattern, requestMcpServerOriginPermission } from '../core/mcp/transports';
import { SHELL_MCP_NATIVE_HOST, SHELL_MCP_SERVER_NAME, createShellMcpPresetInput } from '../core/shell';
import {
  LEGACY_MULTIMODAL_MCP_SERVER_NAME,
  MULTIMODAL_MCP_NATIVE_HOST,
  MULTIMODAL_MCP_SERVER_NAME,
  MULTIMODAL_MCP_REQUEST_TIMEOUT_MS,
  canUseMultimodalMediaInput,
  isMultimodalAnalysisToolAllowed,
  isMultimodalMcpServer,
} from '../core/multimodal';
import {
  assertSupportedMultimodalMedia,
  MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN,
  type MultimodalMediaAnalysisItem,
  type MultimodalMediaAnalyzeRequest,
  type MultimodalMediaAnalyzeResponse,
  type MultimodalMediaInput,
} from '../core/multimodal/media';
import {
  clearMultimodalSettings,
  getMultimodalSettingsStatus,
  saveMultimodalSettings,
  type MultimodalSettingsPatch,
} from '../core/multimodal/settings';
import { getWebToolSettings, setWebToolEnabled } from '../core/tool/web-settings';
import { localizeScenario } from '../core/scenario/localization';
import { getAllScenarios, applyScenarioTemplate } from '../core/scenario/store';
import { getChatEnabled } from '../core/chat/store';
import { selectSidepanelChatProvider } from '../core/chat/provider';
import {
  createRuntimeDoctorLeakQuarantine,
  scanRuntimeDoctorStorage,
  type RuntimeDoctorAutopilotRun,
  type RuntimeDoctorReport,
  type RuntimeDoctorReadiness,
} from '../core/chat/runtime-doctor';
import {
  clearSidepanelWebAuthRejected,
  isSidepanelWebAuthRejected,
  markSidepanelWebAuthRejected,
} from '../core/chat/web-auth-state';
import {
  clearSidepanelWebChatSessionState,
  getOrCreateSidepanelWebChatSession,
  loadSidepanelWebChatSessionState,
  saveSidepanelWebChatSessionState,
} from '../core/chat/web-session';
import {
  clearDeepSeekWebLastSession,
  getDeepSeekWebSessionPreference,
  rememberDeepSeekWebSession,
  type DeepSeekWebSessionStrategy,
} from '../core/chat/session-preference';
import {
  getPersonalConvenienceConfig,
  savePersonalConvenienceConfig,
  type PersonalConvenienceConfig,
} from '../core/personal-convenience/config';
import {
  appendAutopilotRun,
  getAutopilotRunLedger,
} from '../core/personal-convenience/autopilot-ledger';
import {
  markChatLoopFinished,
  markChatLoopStarted,
  reconcileInterruptedChatLoop,
  type ChatLoopProvider,
} from '../core/chat/active-loop';
import {
  clearDeepSeekApiKey,
  DEEPSEEK_API_KEY_STORAGE_KEY,
  getDeepSeekApiKey,
  hasDeepSeekApiKey,
  saveDeepSeekApiKey,
} from '../core/chat/api-key';
import {
  getOfficialApiChatConfig,
  normalizeOfficialApiChatConfig,
  saveOfficialApiChatConfig,
  type OfficialApiChatConfig,
} from '../core/chat/official-api-config';
import {
  createAutomation,
  deleteAutomation,
  getAllAutomations,
  getAutomationById,
  getAutomationRuns,
  setAutomationStatus,
  updateAutomation,
  updateAutomationRun,
} from '../core/automation/store';
import { resolveAutomationClientHeaders } from '../core/automation/auth';
import { runDeepSeekAutomation } from '../core/automation/runner';
import {
  AUTOMATION_WAKE_ALARM_NAME,
  AUTOMATION_WAKE_INTERVAL_MINUTES,
  AUTOMATION_MAX_ATTEMPTS,
  refreshAutomationNextRunAt,
  runAutomation,
  scanDueAutomations,
} from '../core/automation/scheduler';
import { validateAutomationSchedule } from '../core/automation/schedule';
import {
  DeepSeekAuthError,
  DeepSeekPayloadError,
  DeepSeekPowError,
  DeepSeekSessionError,
  createChatSession,
  createPowHeaders,
  submitPromptStreaming,
  rememberDeepSeekClientHeaders,
  saveClientHeadersToStorage,
  loadClientHeadersFromStorage,
  clearClientHeadersFromStorage,
  scrubStoredClientHeaders,
} from '../core/deepseek/adapter';
import {
  DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN,
  DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES,
  DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES,
  DeepSeekWebVisionUploadError,
  createDeepSeekWebVisionFileFromSerializedImage,
  createDeepSeekWebVisionContinuationRoute,
  createDeepSeekWebVisionRoute,
  createDeepSeekWebVisionToolContinuationRoute,
  normalizeDeepSeekWebVisionRefFileIds,
  normalizeDeepSeekWebVisionSerializedImages,
  uploadDeepSeekWebVisionImage,
  type DeepSeekWebVisionFileMetadata,
  type DeepSeekWebVisionSerializedImage,
} from '../core/deepseek/web-vision';
import { createDeepSeekWebVisionEvidencePack } from '../core/deepseek/vision-evidence';
import {
  submitOfficialDeepSeekStreaming,
  type OfficialDeepSeekMessage,
} from '../core/deepseek/official-api';
import { createDeepSeekConversationExportTransport } from '../core/deepseek/conversation-export';
import {
  buildConversationExportArtifactsCancellable,
  runConversationExport,
} from '../core/export/service';
import { normalizeConversationExportRequest } from '../core/export/schema';
import { buildPromptAugmentation } from '../core/prompt';
import { extractToolCalls } from '../core/interceptor/tool-parser';
import { broadcastRuntimeUpdate } from '../core/messaging/broadcast';
import {
  createTranslator,
  DEFAULT_LOCALE,
  type LocaleMessageKey,
  type MessageParams,
  type SupportedLocale,
} from '../core/i18n';
import {
  getResolvedLocaleState,
  watchLocalePreference,
} from '../core/i18n/store';
import type { WebSearchToolName } from '../core/tool/web-search';
import type { BackgroundConfig, CurrentDeepSeekConversation, DeepSeekTheme, GitHubSkillImportRequest, GitHubSkillSource, LocalSkillImportRequest, Memory, ModelType, NewMemory, PetConfig, ProjectContextState, SavedItemInput, Skill, SkillImportSource, SyncConfig, SyncCounts, SystemPromptPreset, ToolCall, ToolDescriptor, ToolExecutionRecord, ToolExecutionTrigger, ToolResult, UsageTurnInput } from '../core/types';
import type { McpServerCreateInput, McpServerUpdateInput } from '../core/mcp/types';
import type { AutomationCreateInput, AutomationFlightEvent, AutomationFlightRecorder, AutomationRunnerRequest, AutomationRunnerResult, AutomationStatus, AutomationUpdateInput } from '../core/automation/types';
import type { ConversationExportProgress, ConversationExportResult } from '../core/export/types';

const DEEPSEEK_HOME_URL = 'https://chat.deepseek.com/';
const DEEPSEEK_TAB_URL_PATTERN = '*://chat.deepseek.com/*';
const REFRESH_AUTH_MESSAGE = { type: 'REFRESH_DEEPSEEK_AUTH' } as const;
const CONTENT_HEALTH_MESSAGE = { type: 'DPP_CONTENT_HEALTH' } as const;
const BROWSER_CAPTURE_SCREENSHOT_TOOL_NAME = 'browser_capture_screenshot';
let chatSessionId: string | null = null;
let chatParentMessageId: number | null = null;
let officialApiChatMessages: OfficialDeepSeekMessage[] = [];
let sidepanelChatSubmitPromise: Promise<void> | null = null;
const conversationExportControllers = new Map<string, AbortController>();
let currentBackgroundLocale: SupportedLocale = DEFAULT_LOCALE;
let currentBackgroundTranslator = createTranslator(DEFAULT_LOCALE);
let sandboxOffscreenCreation: Promise<void> | null = null;
let personalRuntimeReadyPromise: Promise<EnsurePersonalRuntimeReadyResult> | null = null;
let personalRuntimeReadySource: EnsurePersonalRuntimeReadySource | null = null;
let personalAutopilotRepairPromise: Promise<PersonalAutopilotRepairResult> | null = null;
let lastPersonalRuntimeReadiness: RuntimeDoctorReadiness | null = null;
const SANDBOX_OFFSCREEN_URL = 'sandbox-offscreen.html';
const SANDBOX_OFFSCREEN_PORT = 'sandbox-offscreen';
const browserSandboxRuntime: SandboxToolRuntime = {
  runSandbox: (request) => runBrowserSandboxToolResult(request),
};

function backgroundT(key: LocaleMessageKey, params?: MessageParams): string {
  return currentBackgroundTranslator.t(key, params);
}

async function refreshBackgroundLocale(): Promise<void> {
  const resolved = await getResolvedLocaleState();
  currentBackgroundLocale = resolved.locale;
  currentBackgroundTranslator = createTranslator(resolved.locale);
}
type SidePanelApi = {
  setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>;
};

type ActionApi = {
  setBadgeText?: (details: { text: string }) => Promise<void> | void;
  setBadgeBackgroundColor?: (details: { color: string }) => Promise<void> | void;
};

type SyncDataSnapshot = {
  memories: Omit<Memory, 'id'>[];
  skills: Skill[];
  skillSources: SkillImportSource[];
  presets: SystemPromptPreset[];
  projectContext: ProjectContextState | null;
  savedItems: Awaited<ReturnType<typeof getSavedItemsState>> | null;
};

type CapturedTabInfo = {
  id: number;
  windowId: number;
  title: string;
  url: string;
};

type EnsurePersonalRuntimeReadySource = 'manual' | 'startup' | 'repair';

type EnsurePersonalRuntimeReadyResult = {
  ok: true;
  ready: boolean;
  source: EnsurePersonalRuntimeReadySource;
  changedSettings: boolean;
  refreshedAuth: boolean;
  targetStatus: RuntimeDoctorReadiness['targetStatus'];
  blockers: RuntimeDoctorReadiness['blockers'];
  report: RuntimeDoctorReport;
};

type PersonalAutopilotRepairResult = {
  ok: true;
  ready: boolean;
  repaired: string[];
  blockers: RuntimeDoctorReadiness['blockers'];
  report: RuntimeDoctorReport;
};

export default defineBackground(() => {
  enableSidePanelActionClick();
  registerWhatsNewInstallListener();
  registerDeepSeekHeaderScrubListeners();
  registerAutomationAlarmListener();
  refreshBackgroundLocale()
    .then(() => createContextMenus())
    .catch((error) => reportBackgroundStartupError('locale_init_failed', error));
  watchLocalePreference(() => {
    refreshBackgroundLocale()
      .then(async () => {
        await createContextMenus();
        await broadcastStateUpdate();
        await broadcastToolDescriptorsUpdate();
      })
      .catch((error) => reportBackgroundStartupError('locale_refresh_failed', error));
  });

  archiveStaleMemories().catch((error) => reportBackgroundStartupError('archive_stale_memories_failed', error));
  ensureBuiltInMcpPresets().catch((error) => reportBackgroundStartupError('builtin_mcp_presets_failed', error));
  refreshWhatsNewBadge().catch((error) => reportBackgroundStartupError('whats_new_badge_failed', error));
  ensureAutomationWakeAlarm().catch((error) => reportBackgroundStartupError('automation_alarm_create_failed', error));
  reconcileInterruptedChatLoopOnWake().catch((error) => reportBackgroundStartupError('chat_loop_reconcile_failed', error));
  scrubStoredClientHeaders().catch((error) => reportBackgroundStartupError('client_header_scrub_failed', error));
  ensurePersonalRuntimeReady(undefined, 'startup').catch((error) => reportBackgroundStartupError('personal_runtime_ready_failed', error));
  scanDueAutomationsFromWake().catch((error) => reportBackgroundStartupError('automation_startup_scan_failed', error));

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse(createBackgroundErrorResponse(message, error)));
    return true;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if ('deepseek_pp_chat_enabled' in changes || DEEPSEEK_API_KEY_STORAGE_KEY in changes) {
      createContextMenus().catch(() => {});
      broadcastChatAuthStatus().catch(() => {});
    }
  });
});

function registerDeepSeekHeaderScrubListeners() {
  chrome.runtime.onInstalled.addListener(() => {
    scrubStoredClientHeaders()
      .catch((error) => reportBackgroundStartupError('client_header_scrub_install_failed', error));
  });
  chrome.runtime.onStartup.addListener(() => {
    scrubStoredClientHeaders()
      .catch((error) => reportBackgroundStartupError('client_header_scrub_startup_failed', error));
  });
}

function registerAutomationAlarmListener() {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTOMATION_WAKE_ALARM_NAME) return;
    scanDueAutomationsFromWake().catch((error) => reportBackgroundStartupError('automation_alarm_scan_failed', error));
  });
}

async function ensureAutomationWakeAlarm() {
  await chrome.alarms.create(AUTOMATION_WAKE_ALARM_NAME, {
    periodInMinutes: AUTOMATION_WAKE_INTERVAL_MINUTES,
  });
}

function enableSidePanelActionClick() {
  if (import.meta.env.FIREFOX) return;

  const sidePanel = readOptionalChromeApi(
    () => (chrome as typeof chrome & { sidePanel?: SidePanelApi }).sidePanel,
  );
  sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })
    .catch((error) => reportBackgroundStartupError('sidepanel_behavior_failed', error));
}

function registerWhatsNewInstallListener() {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'update') return;

    markWhatsNewPending(details.previousVersion ?? null)
      .then(() => refreshWhatsNewBadge())
      .catch((error) => reportBackgroundStartupError('whats_new_update_failed', error));
  });
}

async function refreshWhatsNewBadge() {
  const action = readOptionalChromeApi(
    () => (chrome as typeof chrome & { action?: ActionApi }).action,
  );
  if (!action?.setBadgeText) return;

  const showBadge = await hasPendingWhatsNew();
  await action.setBadgeText({ text: showBadge ? 'NEW' : '' });
  if (showBadge && action.setBadgeBackgroundColor) {
    await action.setBadgeBackgroundColor({ color: '#4D6BFE' });
  }
}

async function createContextMenus() {
  const chatEnabled = await getChatEnabled();
  if (!chatEnabled) {
    try { await chrome.contextMenus.removeAll(); } catch {}
    return;
  }
  try {
    await chrome.contextMenus.removeAll();
  } catch {}
  const apiKeyConfigured = await hasDeepSeekApiKey();
  const menuScope = apiKeyConfigured
    ? {}
    : { documentUrlPatterns: [DEEPSEEK_TAB_URL_PATTERN] };
  const scenarios = (await getAllScenarios()).map((scenario) => localizeScenario(scenario, currentBackgroundLocale));
  const enabledScenarios = scenarios.filter((s) => s.enabled);

  chrome.contextMenus.create({
    id: 'send-to-chat',
    title: backgroundT('background.contextMenus.sendToChat'),
    contexts: ['selection'],
    ...menuScope,
  });

  if (enabledScenarios.length > 0) {
    chrome.contextMenus.create({
      id: 'separator-1',
      type: 'separator',
      contexts: ['selection'],
      ...menuScope,
    });

    for (const scenario of enabledScenarios) {
      chrome.contextMenus.create({
        id: `scenario-${scenario.id}`,
        title: scenario.label,
        contexts: ['selection'],
        ...menuScope,
      });
    }
  }
}

try {
  chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
    if (!info.selectionText) return;
    const selectedText = info.selectionText.trim();
    if (!selectedText) return;

    // Open the sidepanel before async boundaries so the user gesture remains valid.
    const tabId = tab?.id;
    if (tabId && chrome.sidePanel?.open) {
      chrome.sidePanel.open({ tabId }).catch(() => {});
    }

    const chatEnabled = await getChatEnabled();
    if (!chatEnabled) return;

    if (info.menuItemId === 'send-to-chat') {
      openSidePanelAndSendText(selectedText, tab).catch(() => {});
      return;
    }

    if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith('scenario-')) {
      const scenarioId = info.menuItemId.slice('scenario-'.length);
      getAllScenarios()
        .then((scenarios) => {
          const scenario = scenarios.find((s) => s.id === scenarioId);
          if (!scenario) return;
          const localized = localizeScenario(scenario, currentBackgroundLocale);
          const processed = applyScenarioTemplate(localized.template, selectedText);
          openSidePanelAndSendText(processed, tab);
        })
        .catch(() => {});
      return;
    }
  });
} catch {}

async function openSidePanelAndSendText(text: string, tab?: chrome.tabs.Tab) {
  // Persist to storage as a fallback because the sidepanel may not be ready for messages yet.
  try {
    await chrome.storage.local.set({ pendingChatText: text });
  } catch {}

  chrome.runtime.sendMessage({ type: 'OPEN_CHAT_WITH_TEXT', text }).catch(() => {});
}

async function ensureBuiltInMcpPresets() {
  const servers = await getAllMcpServers();
  const shellExists = servers.some((s) =>
    s.displayName === SHELL_MCP_SERVER_NAME || s.transport.nativeHost === SHELL_MCP_NATIVE_HOST
  );
  if (!shellExists) {
    await createMcpServer(createShellMcpPresetInput({ enabled: false }));
  }
  const legacyMultimodal = servers.find((server) =>
    server.displayName === LEGACY_MULTIMODAL_MCP_SERVER_NAME ||
    server.transport.nativeHost === MULTIMODAL_MCP_NATIVE_HOST
  );
  if (legacyMultimodal && legacyMultimodal.displayName === LEGACY_MULTIMODAL_MCP_SERVER_NAME) {
    await updateMcpServer(legacyMultimodal.id, { displayName: MULTIMODAL_MCP_SERVER_NAME });
  }
}

function reportBackgroundStartupError(code: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[DeepSeek++] ${code}: ${detail}`, error);
}

function createBackgroundErrorResponse(
  message: { type?: string } | unknown,
  error: unknown,
): ToolResult | { ok: false; error: string } | null {
  const detail = error instanceof Error ? error.message : String(error);

  if (!message || typeof message !== 'object') {
    return null;
  }

  const type = (message as { type?: string }).type;

  if (type === 'EXECUTE_TOOL_CALL') {
    return {
      ok: false,
      summary: backgroundT('content.toolBlock.summaries.backgroundFailed'),
      detail,
      error: {
        code: 'background_tool_execution_failed',
        message: detail,
        retryable: true,
      },
    };
  }

  // Sidepanel sync handlers check result?.ok; content scripts use sendRuntimeMessage
  // which guards against error responses. Return structured error for both.
  return { ok: false, error: detail };
}

async function handleMessage(
  message: { type: string; payload?: unknown },
  sender: chrome.runtime.MessageSender,
) {
  switch (message.type) {
    case 'GET_MEMORIES':
      return getAllMemories();

    case 'GET_MEMORY_BY_ID': {
      const { id: memId } = message.payload as { id: number };
      return getMemoryById(memId) ?? null;
    }

    case 'SAVE_MEMORY': {
      const id = await saveMemory(message.payload as NewMemory);
      await broadcastStateUpdate(sender.tab?.id);
      return { id };
    }

    case 'IMPORT_MEMORY_DRAFTS': {
      const { memories } = message.payload as { memories?: NewMemory[] };
      if (!Array.isArray(memories)) return { ok: false, error: 'invalid_memories' };
      let validatedMemories: NewMemory[];
      try {
        validatedMemories = memories.map((memory, index) => validateImportedMemory(memory, `memories[${index}]`));
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'invalid_memories',
        };
      }
      const ids: number[] = [];
      for (const memory of validatedMemories) {
        ids.push(await saveMemory(memory));
      }
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true, ids, count: ids.length };
    }

    case 'UPDATE_MEMORY': {
      await updateMemory(message.payload as Memory);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DELETE_MEMORY': {
      const { id } = message.payload as { id: number };
      await deleteMemory(id);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'TOUCH_MEMORIES': {
      const { ids } = message.payload as { ids: number[] };
      await touchMemories(ids);
      return { ok: true };
    }

    case 'GET_SKILLS':
      return getAllSkills({ locale: currentBackgroundLocale });

    case 'GET_SKILL_LIBRARY':
      return getSkillLibrary(currentBackgroundLocale);

    case 'GET_SKILL_SOURCES':
      return getAllSkillSources();

    case 'GET_GITHUB_SKILL_SOURCES':
      return (await getAllSkillSources()).filter((source) => source.provider === 'github');

    case 'SAVE_SKILL': {
      const payload = message.payload as Skill | { skill: Skill; previousName?: string };
      const { skill, previousName } = 'skill' in payload ? payload : { skill: payload, previousName: undefined };
      await saveSkill(skill, previousName);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DELETE_SKILL': {
      const { name } = message.payload as { name: string };
      await deleteSkill(name);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'SET_SKILL_ENABLED': {
      const { name, enabled } = message.payload as { name: string; enabled: boolean };
      await setSkillEnabled(name, enabled);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'PREVIEW_GITHUB_SKILL_SOURCE': {
      const { url } = message.payload as { url: string };
      return previewGitHubSkillSource(url);
    }

    case 'IMPORT_GITHUB_SKILL_SOURCE': {
      const result = await importGitHubSkillSource(message.payload as GitHubSkillImportRequest);
      await broadcastStateUpdate(sender.tab?.id);
      return result;
    }

    case 'PREVIEW_LOCAL_SKILL_SOURCE': {
      const { rootPath } = message.payload as { rootPath: string };
      return previewLocalSkillSource(rootPath);
    }

    case 'PICK_LOCAL_SKILL_FOLDER': {
      const { defaultPath } = (message.payload ?? {}) as { defaultPath?: string };
      return { path: await pickLocalSkillFolder(defaultPath) };
    }

    case 'IMPORT_LOCAL_SKILL_SOURCE': {
      const result = await importLocalSkillSource(message.payload as LocalSkillImportRequest);
      await broadcastStateUpdate(sender.tab?.id);
      return result;
    }

    case 'CHECK_GITHUB_SKILL_SOURCE_UPDATES': {
      const { sourceId } = message.payload as { sourceId: string };
      return checkGitHubSkillSourceUpdates(sourceId);
    }

    case 'UPDATE_GITHUB_SKILL_SOURCE': {
      const { sourceId } = message.payload as { sourceId: string };
      const result = await updateGitHubSkillSource(sourceId);
      await broadcastStateUpdate(sender.tab?.id);
      return result;
    }

    case 'DELETE_GITHUB_SKILL_SOURCE': {
      const { sourceId } = message.payload as { sourceId: string };
      await deleteGitHubSkillSource(sourceId);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_PRESETS':
      return getAllPresets();

    case 'SAVE_PRESET': {
      await savePreset(message.payload as SystemPromptPreset);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DELETE_PRESET': {
      const { id: presetId } = message.payload as { id: string };
      await deletePreset(presetId);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'SET_ACTIVE_PRESET': {
      const { id: activeId } = message.payload as { id: string | null };
      await setActivePresetId(activeId);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_ACTIVE_PRESET':
      return getActivePreset();

    case 'GET_PROMPT_INJECTION_SETTINGS':
      return getPromptInjectionSettings();

    case 'SAVE_PROMPT_INJECTION_SETTINGS': {
      const settings = await savePromptInjectionSettings(message.payload as Parameters<typeof savePromptInjectionSettings>[0]);
      await broadcastStateUpdate(sender.tab?.id);
      return settings;
    }

    case 'GET_SAVED_ITEMS':
      return getAllSavedItems();

    case 'SAVE_SAVED_ITEM': {
      const item = await saveSavedItem(message.payload as SavedItemInput);
      await broadcastSavedItemsUpdate(sender.tab?.id);
      return item;
    }

    case 'DELETE_SAVED_ITEM': {
      const { id } = message.payload as { id: string };
      await deleteSavedItem(id);
      await broadcastSavedItemsUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_VOICE_SETTINGS':
      return getVoiceSettings();

    case 'SAVE_VOICE_SETTINGS': {
      const settings = await saveVoiceSettings(message.payload as Parameters<typeof saveVoiceSettings>[0]);
      await broadcastVoiceSettingsUpdate(sender.tab?.id);
      return settings;
    }

    case 'GET_VOICE_CAPABILITIES':
      return detectVoiceCapabilities();

    case 'GET_MCP_SERVERS':
      return getAllMcpServers();

    case 'GET_MCP_SERVER': {
      const { id } = message.payload as { id: string };
      return getMcpServerById(id);
    }

    case 'CREATE_MCP_SERVER': {
      const server = await createMcpServer(message.payload as McpServerCreateInput);
      await broadcastMcpServersUpdate(sender.tab?.id);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      return server;
    }

    case 'UPDATE_MCP_SERVER': {
      const { id, patch } = message.payload as { id: string; patch: McpServerUpdateInput };
      const server = await updateMcpServer(id, patch);
      await broadcastMcpServersUpdate(sender.tab?.id);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      return server;
    }

    case 'DELETE_MCP_SERVER': {
      const { id } = message.payload as { id: string };
      await deleteMcpServer(id);
      await broadcastMcpServersUpdate(sender.tab?.id);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_MCP_TOOL_CACHE': {
      const { serverId } = message.payload as { serverId: string };
      return getMcpToolCache(serverId);
    }

    case 'REFRESH_MCP_SERVER_TOOLS': {
      const { serverId } = message.payload as { serverId: string };
      const cache = await refreshMcpServerDiscovery(serverId);
      await broadcastMcpServersUpdate(sender.tab?.id);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      return cache;
    }

    case 'REQUEST_MCP_SERVER_PERMISSION': {
      const { serverId } = message.payload as { serverId: string };
      const server = await getMcpServerById(serverId);
      if (!server) return { ok: false, error: 'mcp_server_not_found' };
      if (server.transport.kind === 'native_messaging') return { ok: true, origin: null };
      try {
        const origin = getMcpOriginPattern(server);
        const ok = await requestMcpServerOriginPermission(server);
        return { ok, origin };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'TEST_MCP_SERVER_CONNECTION': {
      const { serverId } = message.payload as { serverId: string };
      const cache = await refreshMcpServerDiscovery(serverId);
      await broadcastMcpServersUpdate(sender.tab?.id);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      return {
        ok: cache.health.status === 'ready',
        cache,
        health: cache.health,
      };
    }

    case 'GET_WEB_TOOL_SETTINGS':
      return getWebToolSettings();

    case 'SET_WEB_TOOL_SETTING': {
      const { name, enabled } = message.payload as { name: WebSearchToolName; enabled: boolean };
      await setWebToolEnabled(name, enabled);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_BROWSER_CONTROL_SETTINGS':
      return getBrowserControlSettings();

    case 'SAVE_BROWSER_CONTROL_SETTINGS': {
      const settings = await saveBrowserControlSettings(message.payload as Partial<BrowserControlSettings>);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      await broadcastBrowserControlUpdate(sender.tab?.id);
      return settings;
    }

    case 'SET_BROWSER_CONTROL_ENABLED': {
      const { enabled } = message.payload as { enabled: boolean };
      const settings = await setBrowserControlEnabled(enabled);
      if (!enabled) await browserControlService.detach();
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      await broadcastBrowserControlUpdate(sender.tab?.id);
      return settings;
    }

    case 'GET_BROWSER_CONTROL_STATE':
      return getBrowserControlState();

    case 'SET_BROWSER_CONTROL_TARGET': {
      const { tabId } = message.payload as { tabId: number };
      const target = await browserControlService.setTarget(tabId);
      await broadcastBrowserControlUpdate(sender.tab?.id);
      return { ok: true, target };
    }

    case 'LOCK_BROWSER_CONTROL_TARGET': {
      const label = typeof (message.payload as { label?: unknown } | undefined)?.label === 'string'
        ? (message.payload as { label: string }).label
        : 'Dev++';
      const target = await browserControlService.lockCurrentTarget(label);
      await broadcastBrowserControlUpdate(sender.tab?.id);
      return { ok: true, target };
    }

    case 'CLEAR_BROWSER_CONTROL_TARGET_LOCK': {
      await browserControlService.clearTargetLock();
      await broadcastBrowserControlUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DETACH_BROWSER_CONTROL': {
      await browserControlService.detach();
      await broadcastBrowserControlUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DIAGNOSE_WEB_SEARCH': {
      const q = typeof (message.payload as { query?: string })?.query === 'string'
        ? (message.payload as { query: string }).query : 'test';
      const diags: Record<string, { status: number; length: number; error?: string; preview?: string }> = {};
      for (const domain of ['cn.bing.com', 'www.bing.com']) {
        const url = `https://${domain}/search?q=${encodeURIComponent(q)}`;
        try {
          const resp = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept-Language': 'zh-CN,zh;q=0.9',
            },
            signal: AbortSignal.timeout(10_000),
          });
          const text = await resp.text();
          diags[domain] = {
            status: resp.status,
            length: text.length,
            preview: text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200),
          };
        } catch (e) {
          diags[domain] = {
            status: 0,
            length: 0,
            error: e instanceof Error ? e.message.slice(0, 150) : String(e).slice(0, 150),
          };
        }
      }
      return diags;
    }

    case 'REQUEST_HOST_PERMISSION': {
      const { origins } = message.payload as { origins: string[] };
      if (!origins?.length) return { ok: false, error: 'no_origins' };
      try {
        const granted = await chrome.permissions.request({ origins }).catch(() => false);
        return { ok: granted, origins };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'GET_TOOL_DESCRIPTORS':
      return getRuntimeToolDescriptors(currentBackgroundLocale);

    case 'REFRESH_TOOL_DESCRIPTORS': {
      const tools = await refreshRuntimeToolDescriptors(currentBackgroundLocale);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      await broadcastMcpServersUpdate(sender.tab?.id);
      return tools;
    }

    case 'EXECUTE_TOOL_CALL': {
      const call = message.payload as ToolCall;
      const result = await executeBackgroundRuntimeToolCall(call, call.source?.trigger ?? 'manual_chat');
      await broadcastToolCallHistoryUpdate(sender.tab?.id);
      return result;
    }

    case 'RUN_ARTIFACT_CODE':
      return runBrowserSandboxToolResult(message.payload as SandboxRunRequest);

    case 'GET_TOOL_CALL_HISTORY': {
      const { limit } = (message.payload as { limit?: number } | undefined) ?? {};
      return getToolCallHistory(limit);
    }

    case 'CLEAR_TOOL_CALL_HISTORY': {
      await clearToolCallHistory();
      await broadcastToolCallHistoryUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_PLATFORM_CAPABILITIES':
      return getCurrentBrowserExtensionEnvironment();

    case 'GET_PROJECT_CONTEXT_STATE':
      return getProjectContextState();

    case 'CREATE_PROJECT_CONTEXT': {
      const project = await createProjectContext(message.payload as Parameters<typeof createProjectContext>[0]);
      await broadcastProjectContextUpdate(sender.tab?.id);
      return project;
    }

    case 'UPDATE_PROJECT_CONTEXT': {
      const { projectId, patch } = message.payload as { projectId: string; patch: Parameters<typeof updateProjectContext>[1] };
      const project = await updateProjectContext(projectId, patch);
      await broadcastProjectContextUpdate(sender.tab?.id);
      return project;
    }

    case 'DELETE_PROJECT_CONTEXT': {
      const { projectId } = message.payload as { projectId: string };
      await deleteProjectContext(projectId);
      const deletedMemories = await deleteMemoriesForProject(projectId);
      await broadcastProjectContextUpdate(sender.tab?.id);
      if (deletedMemories > 0) await broadcastStateUpdate(sender.tab?.id);
      return { ok: true, deletedMemories };
    }

    case 'ADD_CONVERSATION_TO_PROJECT': {
      const { projectId, conversation } = message.payload as { projectId: string; conversation: Parameters<typeof addConversationToProject>[1] };
      const added = await addConversationToProject(projectId, conversation);
      await broadcastProjectContextUpdate(sender.tab?.id);
      return { ok: true, conversation: added };
    }

    case 'REMOVE_CONVERSATION_FROM_PROJECT': {
      const { conversationId } = message.payload as { conversationId: string };
      await removeConversationFromProject(conversationId);
      await broadcastProjectContextUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'SET_PENDING_PROJECT_CONTEXT': {
      const { projectId } = message.payload as { projectId: string | null };
      await setPendingProjectContext(projectId);
      await broadcastProjectContextUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_CURRENT_DEEPSEEK_CONVERSATION':
      return getCurrentDeepSeekConversation();

    case 'GET_PROJECT_CONTEXT_FOR_CONVERSATION': {
      const { conversation, bindPendingProject } = message.payload as {
        conversation: Parameters<typeof bindPendingProjectConversation>[0];
        bindPendingProject?: boolean;
      };
      const bound = bindPendingProject === true
        ? await bindPendingProjectConversation(conversation)
        : null;
      if (bound) await broadcastProjectContextUpdate(sender.tab?.id);
      const project = await getProjectForConversation(conversation.conversationId);
      if (!project) return null;
      const context = await getProjectPromptContextForConversation(conversation.conversationId);
      return {
        projectId: project.id,
        context: context ? formatProjectPromptContext(context) : null,
      };
    }

    case 'GET_ARTIFACT': {
      const { id } = message.payload as { id: string };
      const artifact = await getArtifact(id);
      return artifact ? { ok: true, artifact } : { ok: false, error: 'artifact_not_found' };
    }

    case 'GET_CONFIG':
      return { version: getExtensionVersion() };

    case 'WHATS_NEW_DISMISSED': {
      await dismissWhatsNew();
      await refreshWhatsNewBadge();
      return { ok: true };
    }

    case 'GET_DEEPSEEK_API_KEY_STATUS':
      return { ok: true, configured: await hasDeepSeekApiKey() };

    case 'SAVE_DEEPSEEK_API_KEY': {
      const { apiKey } = message.payload as { apiKey?: string };
      await saveDeepSeekApiKey(apiKey ?? '');
      officialApiChatMessages = [];
      await createContextMenus();
      await broadcastChatAuthStatus(sender.tab?.id);
      return { ok: true, configured: true };
    }

    case 'CLEAR_DEEPSEEK_API_KEY':
      await clearDeepSeekApiKey();
      officialApiChatMessages = [];
      await createContextMenus();
      await broadcastChatAuthStatus(sender.tab?.id);
      return { ok: true, configured: false };

    case 'GET_MULTIMODAL_SETTINGS_STATUS':
      return { ok: true, ...(await getMultimodalSettingsStatus()) };

    case 'SAVE_MULTIMODAL_SETTINGS':
      return { ok: true, ...(await saveMultimodalSettings(message.payload as MultimodalSettingsPatch)) };

    case 'CLEAR_MULTIMODAL_SETTINGS':
      return { ok: true, ...(await clearMultimodalSettings()) };

    case 'ANALYZE_MULTIMODAL_MEDIA': {
      const response = await analyzeMultimodalMedia(message.payload as MultimodalMediaAnalyzeRequest);
      await broadcastToolCallHistoryUpdate(sender.tab?.id);
      if (!response.ok) {
        return {
          ok: false,
          error: response.error ?? 'multimodal_analysis_failed',
          analyses: response.analyses,
        };
      }
      return response;
    }

    case 'GET_DEEPSEEK_THEME':
      return getDeepSeekTheme();

    case 'SET_DEEPSEEK_THEME': {
      const { theme } = message.payload as { theme?: DeepSeekTheme };
      if (theme !== 'light' && theme !== 'dark') return { ok: false, error: 'invalid_theme' };
      const current = await getDeepSeekTheme();
      if (current === theme) return { ok: true };
      await saveDeepSeekTheme(theme);
      await broadcastThemeUpdate(theme, sender.tab?.id);
      return { ok: true };
    }

    case 'GET_MODEL_TYPE':
      return getModelType();

    case 'SET_MODEL_TYPE': {
      const newModelType = message.payload as ModelType;
      const current = await getModelType();
      if (newModelType === current) return { ok: true };
      await setModelType(newModelType);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'RECORD_USAGE_TURN':
      return recordUsageTurn(message.payload as UsageTurnInput);

    case 'GET_USAGE_SUMMARY': {
      const { rangeDays } = (message.payload ?? {}) as { rangeDays?: unknown };
      return getUsageSummary(rangeDays);
    }

    case 'CLEAR_USAGE_STATS':
      await clearUsageRecords();
      return { ok: true };

    case 'GET_BACKGROUND':
      return getBackgroundConfig();

    case 'SAVE_BACKGROUND': {
      const bgConfig = message.payload as BackgroundConfig;
      await saveBackgroundConfig(bgConfig);
      await broadcastBackgroundUpdate(bgConfig);
      return { ok: true };
    }

    case 'CLEAR_BACKGROUND': {
      await clearBackgroundConfig();
      await broadcastBackgroundUpdate(null);
      return { ok: true };
    }

    case 'GET_PET':
      return getPetConfig();

    case 'SAVE_PET': {
      const petConfig = message.payload as PetConfig;
      await savePetConfig(petConfig);
      await broadcastPetUpdate(petConfig);
      return { ok: true };
    }

    case 'CLEAR_PET': {
      await clearPetConfig();
      await broadcastPetUpdate(await getPetConfig());
      return { ok: true };
    }

    case 'GET_SYNC_CONFIG':
      return getSyncConfig();

    case 'SAVE_SYNC_CONFIG': {
      await saveSyncConfig(message.payload as SyncConfig);
      return { ok: true };
    }

    case 'WEBDAV_TEST': {
      await webdavTest(message.payload as SyncConfig);
      return { ok: true };
    }

    case 'WEBDAV_UPLOAD_LOCAL': {
      const config = await getSyncConfig();
      if (!config) throw new Error(backgroundT('background.sync.missingWebDav'));

      const [, snapshot] = await Promise.all([
        webdavMkcol(config),
        getLocalSyncDataSnapshot(),
      ]);

      await uploadSyncDataSnapshot(config, snapshot);

      const now = Date.now();
      await saveSyncConfig({ ...config, lastSyncAt: now });
      return { ok: true, lastSyncAt: now, counts: getSyncCounts(snapshot) };
    }

    case 'WEBDAV_DOWNLOAD_REMOTE': {
      const config = await getSyncConfig();
      if (!config) throw new Error(backgroundT('background.sync.missingWebDav'));

      const snapshot = await mergeSyncSnapshotWithLocalImports(await getRemoteSyncDataSnapshot(config));

      const replacements: Promise<unknown>[] = [
        replaceAllMemories(snapshot.memories),
        replaceAllCustomSkills(snapshot.skills),
        replaceAllSkillSources(snapshot.skillSources),
        replaceAllPresets(snapshot.presets),
      ];
      if (snapshot.projectContext) {
        replacements.push(saveProjectContextState(snapshot.projectContext));
      }
      if (snapshot.savedItems) {
        replacements.push(replaceAllSavedItems(snapshot.savedItems.items));
      }
      await Promise.all(replacements);

      const now = Date.now();
      await saveSyncConfig({ ...config, lastSyncAt: now });
      await broadcastStateUpdate(sender.tab?.id);
      if (snapshot.projectContext) await broadcastProjectContextUpdate(sender.tab?.id);
      if (snapshot.savedItems) await broadcastSavedItemsUpdate(sender.tab?.id);
      return { ok: true, lastSyncAt: now, counts: getSyncCounts(snapshot) };
    }

    case 'CAPTURE_CURRENT_TAB_IMAGE': {
      try {
        return { ok: true, ...await captureCurrentTabImage() };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'CAPTURE_BROWSER_CONTROL_TARGET_IMAGE': {
      try {
        return { ok: true, ...await captureBrowserControlTargetImage() };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'GET_PERSONAL_CONVENIENCE_CONFIG':
      return { ok: true, config: await getPersonalConvenienceConfig() };

    case 'SAVE_PERSONAL_CONVENIENCE_CONFIG':
      return {
        ok: true,
        config: await savePersonalConvenienceConfig(message.payload as Partial<PersonalConvenienceConfig>),
      };

    case 'GET_DEEPSEEK_WEB_SESSION_PREFERENCE':
      return { ok: true, preference: await getDeepSeekWebSessionPreference() };

    case 'CHAT_SUBMIT_PROMPT': {
      const { text, config, images } = message.payload as {
        text: string;
        config?: Partial<OfficialApiChatConfig>;
        images?: unknown;
      };
      if (!(await getChatEnabled())) {
        return { ok: false, error: 'chat_disabled' };
      }
      let imagePayloads: DeepSeekWebVisionSerializedImage[];
      try {
        imagePayloads = normalizeDeepSeekWebVisionSerializedImages(images);
      } catch (err) {
        return { ok: false, error: formatSidepanelChatError(err, true) };
      }
      if (!text?.trim() && imagePayloads.length === 0) return { ok: false, error: 'empty_prompt' };
      if (sidepanelChatSubmitPromise) return { ok: false, error: 'chat_busy' };
      // Fire and forget — the streaming response is broadcast
      sidepanelChatSubmitPromise = handleChatSubmitPrompt(
        text?.trim() || 'Describe the attached image.',
        config,
        sender.tab?.id,
        imagePayloads,
      )
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          broadcastChatChunk({ text: '', done: true, error: msg }, sender.tab?.id);
        })
        .finally(() => {
          sidepanelChatSubmitPromise = null;
        });
      return { ok: true };
    }

    case 'CHAT_NEW_SESSION':
      await Promise.all([
        clearSidepanelChatSession(),
        clearSidepanelWebAuthRejected(),
        clearDeepSeekWebLastSession(),
      ]);
      officialApiChatMessages = [];
      return { ok: true };

    case 'GET_AUTH_STATUS': {
      return getChatAuthStatus(sender.tab?.id);
    }

    case 'GET_RUNTIME_DOCTOR_REPORT':
      return getRuntimeDoctorReport(sender.tab?.id);

    case 'REFRESH_DEEPSEEK_WEB_AUTH':
      return refreshDeepSeekWebAuth(sender.tab?.id);

    case 'ENSURE_PERSONAL_RUNTIME_READY':
      return ensurePersonalRuntimeReady(sender.tab?.id, 'manual');

    case 'RUN_PERSONAL_AUTOPILOT_REPAIR':
      return runPersonalAutopilotRepair(sender.tab?.id);

    case 'RELOAD_STALE_DEEPSEEK_TABS':
      return reloadStaleDeepSeekTabs(sender.tab?.id);

    case 'RUN_PERSONAL_HUMAN_EVAL': {
      const report = await getRuntimeDoctorReport(sender.tab?.id);
      return { ok: true, humanEval: report.humanEval, leakSentry: report.leakSentry, report };
    }

    case 'GET_OFFICIAL_API_CHAT_CONFIG':
      return getOfficialApiChatConfig();

    case 'SAVE_OFFICIAL_API_CHAT_CONFIG':
      return saveOfficialApiChatConfig(message.payload);

    case 'EXPORT_DEEPSEEK_CONVERSATIONS':
      return handleConversationExport(message.payload, sender.tab?.id);

    case 'CANCEL_DEEPSEEK_EXPORT': {
      const { exportId } = message.payload as { exportId?: string };
      if (!exportId) return { ok: false, error: 'missing_export_id' };
      const controller = conversationExportControllers.get(exportId);
      if (!controller) return { ok: false, error: 'export_not_running' };
      controller.abort();
      conversationExportControllers.delete(exportId);
      await broadcastConversationExportProgress({
        exportId,
        phase: 'cancelled',
        status: 'cancelled',
        current: 0,
        total: 0,
        message: backgroundT('background.export.cancelled'),
      }, sender.tab?.id);
      return { ok: true };
    }

    case 'AUTH_STATUS_CHANGED': {
      await broadcastChatAuthStatus(sender.tab?.id);
      return { ok: true };
    }

    case 'STORE_DEEPSEEK_CLIENT_HEADERS': {
      const payload = message.payload as { headers?: unknown };
      const headers = normalizeStoredClientHeaders(payload.headers);
      if (!headers) return { ok: false, error: 'invalid_client_headers' };
      rememberDeepSeekClientHeaders(headers);
      const ok = await saveClientHeadersToStorage();
      if (ok) await clearSidepanelWebAuthRejected();
      await broadcastChatAuthStatus(sender.tab?.id);
      return { ok };
    }

    case 'GET_AUTOMATIONS':
      return getAllAutomations();

    case 'GET_AUTOMATION_RUNS': {
      const { automationId, limit } = message.payload as { automationId: string; limit?: number };
      return getAutomationRuns({ automationId, limit });
    }

    case 'CREATE_AUTOMATION': {
      const payload = message.payload as AutomationCreateInput & { images?: unknown };
      const hasImages = Array.isArray(payload.images) && payload.images.length > 0;
      try {
        const { images, ...automationInput } = payload;
        const input = await prepareAutomationVisionInput(automationInput, images);
        validateAutomationInput(input);
        const automation = await createAutomation(input);
        const refreshed = await refreshAutomationNextRunAt(automation.id);
        await broadcastAutomationUpdate(sender.tab?.id);
        return refreshed ?? automation;
      } catch (err) {
        return { ok: false, error: formatSidepanelChatError(err, hasImages) };
      }
    }

    case 'UPDATE_AUTOMATION': {
      const payload = message.payload as { id: string; patch: AutomationUpdateInput; images?: unknown };
      const hasImages = Array.isArray(payload.images) && payload.images.length > 0;
      try {
        const { id, patch, images } = payload;
        const preparedPatch = await prepareAutomationVisionPatch(patch, images);
        validateAutomationPatch(preparedPatch);
        const automation = await updateAutomation(id, preparedPatch);
        if (!automation) return { ok: false, error: 'automation_not_found' };
        const refreshed = await refreshAutomationNextRunAt(id);
        await broadcastAutomationUpdate(sender.tab?.id);
        return refreshed ?? automation;
      } catch (err) {
        return { ok: false, error: formatSidepanelChatError(err, hasImages) };
      }
    }

    case 'SET_AUTOMATION_STATUS': {
      const { id, status } = message.payload as { id: string; status: AutomationStatus };
      if (!isAutomationStatus(status)) return { ok: false, error: 'invalid_automation_status' };
      const automation = await setAutomationStatus(id, status);
      if (!automation) return { ok: false, error: 'automation_not_found' };
      const refreshed = await refreshAutomationNextRunAt(id);
      await broadcastAutomationUpdate(sender.tab?.id);
      return refreshed ?? automation;
    }

    case 'DELETE_AUTOMATION': {
      const { id } = message.payload as { id: string };
      await deleteAutomation(id);
      await broadcastAutomationUpdate(sender.tab?.id);
      await broadcastAutomationRunsUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'RUN_AUTOMATION_NOW': {
      const { id } = message.payload as { id: string };
      return runAutomationNow(id, sender.tab?.id);
    }

    case 'SCENARIOS_UPDATED':
      await createContextMenus();
      return { ok: true };

    default:
      return null;
  }
}

async function broadcastToTabs(payload: Record<string, unknown>, excludeTabId?: number) {
  await broadcastRuntimeUpdate(payload, excludeTabId, {
    tabUrlPattern: DEEPSEEK_TAB_URL_PATTERN,
    sendRuntimeMessage: (message) => chrome.runtime.sendMessage(message),
    queryTabsByUrl: (urlPattern) => chrome.tabs.query({ url: urlPattern }),
    sendTabMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    reportError: reportBackgroundStartupError,
  });
}

async function loadOrRefreshClientHeaders(preferredTabId?: number): Promise<Record<string, string> | null> {
  if (await isSidepanelWebAuthRejected()) return null;

  // When the caller knows the active DeepSeek tab, refresh from it first so manual
  // flows do not reuse a stale cached token without hitting the live page context.
  if (preferredTabId !== undefined) {
    await refreshClientHeadersFromDeepSeekTabs(preferredTabId);
    const refreshed = await loadClientHeadersFromStorage();
    if (refreshed) return refreshed;
  }

  const cached = await loadClientHeadersFromStorage();
  if (cached) return cached;

  await refreshClientHeadersFromDeepSeekTabs(preferredTabId);
  return loadClientHeadersFromStorage();
}

function normalizeStoredClientHeaders(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object') return null;
  const headers = value as Record<string, unknown>;
  const authorization = headers.Authorization;
  if (typeof authorization !== 'string' || !authorization) return null;

  const normalized: Record<string, string> = { Authorization: authorization };
  for (const [key, entry] of Object.entries(headers)) {
    if (key === 'Authorization') continue;
    if (typeof entry === 'string' && entry) normalized[key] = entry;
  }
  return normalized;
}

async function refreshClientHeadersFromDeepSeekTabs(preferredTabId?: number): Promise<boolean> {
  const tabs = await getDeepSeekTabsForAuthRefresh(preferredTabId);
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, REFRESH_AUTH_MESSAGE);
      if (response?.hasToken === true) return true;
    } catch {
      // Content scripts may be absent on stale or restricted tabs; try the next live DeepSeek tab.
    }
  }
  return false;
}

async function forgetClientHeadersInDeepSeekTabs(preferredTabId?: number): Promise<void> {
  const tabs = await getDeepSeekTabsForAuthRefresh(preferredTabId);
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_DEEPSEEK_CLIENT_HEADERS' });
    } catch {
      // Content scripts may be absent on stale or restricted tabs.
    }
  }));
}

async function getDeepSeekTabsForAuthRefresh(preferredTabId?: number): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({ url: DEEPSEEK_TAB_URL_PATTERN });
  if (!preferredTabId) {
    return tabs.sort((a, b) => Number(b.active) - Number(a.active));
  }

  const preferred = tabs.find((tab) => tab.id === preferredTabId);
  if (!preferred) return tabs;
  return [preferred, ...tabs.filter((tab) => tab.id !== preferredTabId)];
}

async function getDeepSeekContentScriptHealth(
  tabs: chrome.tabs.Tab[],
): Promise<RuntimeDoctorReport['contentScripts']> {
  const tabIds = tabs
    .map((tab) => tab.id)
    .filter((id): id is number => typeof id === 'number');
  const staleTabIds: number[] = [];
  let healthyTabs = 0;
  for (const tabId of tabIds) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, CONTENT_HEALTH_MESSAGE);
      if (response?.ok === true && response.hasLiveExtensionContext !== false) {
        healthyTabs += 1;
      } else {
        staleTabIds.push(tabId);
      }
    } catch {
      staleTabIds.push(tabId);
    }
  }
  return {
    checked: true,
    totalTabs: tabIds.length,
    healthyTabs,
    staleTabs: staleTabIds.length,
    staleTabIds,
  };
}

async function reloadStaleDeepSeekTabs(preferredTabId?: number) {
  const tabs = await getDeepSeekTabsForAuthRefresh(preferredTabId);
  const health = await getDeepSeekContentScriptHealth(tabs);
  await Promise.all(health.staleTabIds.map((tabId) => chrome.tabs.reload(tabId).catch(() => undefined)));
  return {
    ok: true,
    reloaded: health.staleTabIds.length,
    contentScripts: health,
    report: await getRuntimeDoctorReport(preferredTabId),
  };
}

async function broadcastStateUpdate(excludeTabId?: number) {
  const [memories, skills, activePreset, modelType, promptSettings] = await Promise.all([
    getAllMemories(),
    getAllSkills({ locale: currentBackgroundLocale }),
    getActivePreset(),
    getModelType(),
    getPromptInjectionSettings(),
  ]);
  await broadcastToTabs({ type: 'STATE_UPDATED', memories, skills, activePreset, modelType, promptSettings }, excludeTabId);
}

async function broadcastBackgroundUpdate(config: BackgroundConfig | null) {
  await broadcastToTabs({ type: 'BACKGROUND_UPDATED', config });
}

async function broadcastPetUpdate(config: PetConfig) {
  await broadcastToTabs({ type: 'PET_UPDATED', config });
}

async function broadcastThemeUpdate(theme: DeepSeekTheme, excludeTabId?: number) {
  await broadcastToTabs({ type: 'THEME_UPDATED', theme }, excludeTabId);
}

async function broadcastMcpServersUpdate(excludeTabId?: number) {
  const servers = await getAllMcpServers();
  await broadcastToTabs({ type: 'MCP_SERVERS_UPDATED', servers }, excludeTabId);
}

async function broadcastToolDescriptorsUpdate(excludeTabId?: number) {
  const toolDescriptors = await getRuntimeToolDescriptors(currentBackgroundLocale);
  await broadcastToTabs({ type: 'TOOL_DESCRIPTORS_UPDATED', toolDescriptors }, excludeTabId);
}

async function broadcastBrowserControlUpdate(excludeTabId?: number) {
  await broadcastToTabs({ type: 'BROWSER_CONTROL_UPDATED' }, excludeTabId);
}

async function broadcastToolCallHistoryUpdate(excludeTabId?: number) {
  await broadcastToTabs({ type: 'TOOL_CALL_HISTORY_UPDATED' }, excludeTabId);
}

async function broadcastProjectContextUpdate(excludeTabId?: number) {
  const state = await getProjectContextState();
  await broadcastToTabs({ type: 'PROJECT_CONTEXT_UPDATED', state }, excludeTabId);
}

async function getCurrentDeepSeekConversation(): Promise<
  { ok: true; conversation: CurrentDeepSeekConversation } | { ok: false; error: string }
> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs.find((item) => item.id != null && isDeepSeekChatUrl(item.url));
  if (!tab?.id) return { ok: false, error: 'no_active_deepseek_conversation' };

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CURRENT_DEEPSEEK_CONVERSATION' });
    if (response?.ok && response.conversation) {
      return { ok: true, conversation: response.conversation as CurrentDeepSeekConversation };
    }
    return { ok: false, error: response?.error ?? 'no_current_conversation' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function isDeepSeekChatUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'chat.deepseek.com' && /\/(?:a\/)?chat\/s\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function broadcastSavedItemsUpdate(excludeTabId?: number) {
  const savedItems = await getAllSavedItems();
  await broadcastToTabs({ type: 'SAVED_ITEMS_UPDATED', savedItems }, excludeTabId);
}

async function broadcastVoiceSettingsUpdate(excludeTabId?: number) {
  const voiceSettings = await getVoiceSettings();
  await broadcastToTabs({ type: 'VOICE_SETTINGS_UPDATED', voiceSettings }, excludeTabId);
}

async function broadcastAutomationUpdate(excludeTabId?: number) {
  const automations = await getAllAutomations();
  await broadcastToTabs({ type: 'AUTOMATIONS_UPDATED', automations }, excludeTabId);
}

async function broadcastAutomationRunsUpdate(excludeTabId?: number) {
  await broadcastToTabs({ type: 'AUTOMATION_RUNS_UPDATED' }, excludeTabId);
}

async function getChatAuthStatus(preferredTabId?: number) {
  const [hasApiKey, headers] = await Promise.all([
    hasDeepSeekApiKey(),
    loadOrRefreshClientHeaders(preferredTabId),
  ]);
  const provider = selectSidepanelChatProvider({
    hasApiKey,
    hasWebHeaders: !!headers,
  });
  return {
    ok: true,
    available: provider !== null,
    provider,
    hasApiKey,
    hasToken: !!headers,
  };
}

async function getRuntimeDoctorReport(
  preferredTabId?: number,
  readinessOverride?: RuntimeDoctorReadiness,
): Promise<RuntimeDoctorReport> {
  const storageSnapshot = await getRuntimeDoctorStorageSnapshot();
  const storage = scanRuntimeDoctorStorage(storageSnapshot);
  const [
    chatEnabled,
    hasApiKey,
    webAuthRejected,
    storedSession,
    deepSeekTabs,
    browserSettings,
    browserState,
    retryableFailure,
    personal,
    sessionPreference,
    autopilotRuns,
  ] = await Promise.all([
    getChatEnabled(),
    hasDeepSeekApiKey(),
    isSidepanelWebAuthRejected(),
    loadSidepanelWebChatSessionState(),
    getDeepSeekTabsForAuthRefresh(preferredTabId),
    getBrowserControlSettings(),
    getBrowserControlState().catch(() => null),
    findLatestRetryableAutomationFailure(),
    getPersonalConvenienceConfig(),
    getDeepSeekWebSessionPreference(),
    getAutopilotRunLedger().catch(() => []),
  ]);
  const contentScripts = await getDeepSeekContentScriptHealth(deepSeekTabs);
  let headers = await loadClientHeadersFromStorage();
  if (!headers && !webAuthRejected) {
    await refreshClientHeadersFromDeepSeekTabs(preferredTabId);
    headers = await loadClientHeadersFromStorage();
  }
  const hasUsableWebAuth = !!headers && !webAuthRejected;
  const provider = selectSidepanelChatProvider({
    hasApiKey,
    hasWebHeaders: hasUsableWebAuth,
  });
  const sessionSource = chatSessionId
    ? 'memory'
    : storedSession?.chatSessionId
      ? 'session'
      : 'none';
  const parentMessageId = sessionSource === 'memory'
    ? chatParentMessageId
    : storedSession?.parentMessageId ?? null;

  const readiness = readinessOverride ?? createRuntimeReadiness({
    blockers: createRuntimeReadinessBlockers({
      chatBusy: sidepanelChatSubmitPromise !== null,
      hasWebAuth: hasUsableWebAuth,
      webAuthRejected,
      browserSettings,
      browserState,
      contentScripts,
      storage,
    }),
    lastPreparedAt: lastPersonalRuntimeReadiness?.lastPreparedAt ?? null,
    preparing: personalRuntimeReadyPromise !== null,
    targetStatus: getRuntimeReadinessTargetStatus(browserSettings, browserState),
    noLeak: storage.ok,
  });

  return {
    ok: true,
    generatedAt: Date.now(),
    chatEnabled,
    chatBusy: sidepanelChatSubmitPromise !== null,
    provider,
    hasApiKey,
    hasWebAuth: hasUsableWebAuth,
    webAuthRejected,
    deepSeekTabCount: deepSeekTabs.length,
    sidepanelSession: {
      active: sessionSource !== 'none',
      source: sessionSource,
      parentMessageId,
    },
    personalConvenience: {
      enabled: personal.enabled,
      autoReadyCheckBeforeRun: personal.autoReadyCheckBeforeRun,
      autoRefreshWebAuth: personal.autoRefreshWebAuth,
      sameSessionStrategy: personal.sameSessionStrategy,
      visualMonitorDefault: personal.visualMonitorDefault,
      reducedConfirmations: personal.reducedConfirmations,
      lastSessionRemembered: !!sessionPreference.lastSession,
      lastSessionSource: sessionPreference.lastSession?.source ?? null,
      lastSessionUpdatedAt: sessionPreference.lastSession?.updatedAt ?? null,
    },
    vision: {
      maxImagesPerTurn: DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN,
      rawImagesStoredDurably: storage.issues.some((issue) => issue.reason === 'raw_image_data'),
    },
    browserControl: {
      enabled: browserSettings.enabled,
      targetSelected: typeof browserSettings.targetTabId === 'number',
      targetLock: {
        enabled: browserSettings.targetLock?.enabled === true,
        label: browserSettings.targetLock?.label ?? null,
        origin: browserSettings.targetLock?.origin ?? null,
        updatedAt: browserSettings.targetLock?.updatedAt ?? null,
      },
      visualCaptureAllowed: browserSettings.allowVisionCapture,
      actVerifyEnabled: browserSettings.verifyAfterActions,
      evidencePacksEnabled: browserSettings.collectEvidencePacks,
      debugDistillerEnabled: browserSettings.debugDistillerEnabled,
      monitorReady: browserSettings.enabled &&
        browserSettings.allowVisionCapture &&
        typeof browserSettings.targetTabId === 'number' &&
        browserState?.target?.controllable === true &&
        !isDeepSeekWebTargetUrl(browserState.target.url),
    },
    contentScripts,
    automation: {
      maxAttempts: AUTOMATION_MAX_ATTEMPTS,
      retryableFailure,
    },
    autopilot: {
      inFlightSource: personalAutopilotRepairPromise ? 'repair' : personalRuntimeReadySource,
      latestRun: autopilotRuns[0] ?? null,
      recentRuns: autopilotRuns.slice(0, 5),
    },
    humanEval: createRuntimeDoctorHumanEval({
      hasUsableWebAuth,
      sessionActive: sessionSource !== 'none' || !!sessionPreference.lastSession,
      browserMonitorReady: browserSettings.enabled &&
        browserSettings.allowVisionCapture &&
        typeof browserSettings.targetTabId === 'number' &&
        browserState?.target?.controllable === true &&
        !isDeepSeekWebTargetUrl(browserState.target.url),
      contentScripts,
      storage,
      toolDescriptorsReady: true,
    }),
    leakSentry: createRuntimeDoctorLeakSentry(storage, storageSnapshot.failedAreas),
    leakQuarantine: createRuntimeDoctorLeakQuarantine(storage),
    debugDistiller: {
      enabled: browserSettings.debugDistillerEnabled,
      suggestions: browserSettings.debugDistillerEnabled
        ? createRuntimeDoctorDebugSuggestions(retryableFailure)
        : [],
    },
    readiness,
    failureExplanations: createRuntimeDoctorFailureExplanations(readiness.blockers),
    storage,
  };
}

function createRuntimeReadinessBlockers(input: {
  chatBusy: boolean;
  hasWebAuth: boolean;
  webAuthRejected: boolean;
  browserSettings: BrowserControlSettings;
  browserState: BrowserControlState | null;
  contentScripts: RuntimeDoctorReport['contentScripts'];
  storage: ReturnType<typeof scanRuntimeDoctorStorage>;
}): RuntimeDoctorReadiness['blockers'] {
  const blockers = new Set<RuntimeDoctorReadiness['blockers'][number]>();
  if (input.chatBusy) blockers.add('chat_busy');
  if (input.webAuthRejected) blockers.add('web_auth_rejected');
  if (!input.hasWebAuth) blockers.add('web_auth_missing');
  if (input.contentScripts.staleTabs > 0) blockers.add('deepseek_content_script_stale');
  if (!input.browserSettings.enabled) blockers.add('browser_control_disabled');
  if (!input.browserSettings.allowVisionCapture) blockers.add('browser_vision_capture_disabled');
  if (!input.browserSettings.verifyAfterActions) blockers.add('act_verify_disabled');
  if (!input.browserSettings.collectEvidencePacks) blockers.add('evidence_packs_disabled');
  if (typeof input.browserSettings.targetTabId !== 'number' || !input.browserState?.target) {
    blockers.add('browser_target_missing');
  } else if (
    input.browserState.target.controllable !== true ||
    isDeepSeekWebTargetUrl(input.browserState.target.url)
  ) {
    blockers.add('browser_target_not_controllable');
  }
  if (!input.storage.ok) {
    blockers.add(input.storage.issues.some((issue) => issue.reason === 'storage_read_failed')
      ? 'storage_scan_failed'
      : 'storage_leak');
  }
  return Array.from(blockers);
}

function createRuntimeDoctorFailureExplanations(
  blockers: RuntimeDoctorReadiness['blockers'],
): RuntimeDoctorReport['failureExplanations'] {
  return blockers.map((blocker) => {
    const severity = blocker === 'storage_leak' || blocker === 'storage_scan_failed'
      ? 'blocked' as const
      : 'attention' as const;
    switch (blocker) {
      case 'chat_busy':
        return {
          blocker,
          severity,
          cause: 'The sidepanel chat loop is still running.',
          action: 'Wait for the current response to finish, then run Make Ready again.',
        };
      case 'web_auth_missing':
        return {
          blocker,
          severity,
          cause: 'No usable logged-in DeepSeek Web headers were found.',
          action: 'Open or reload chat.deepseek.com, then run Make Ready.',
        };
      case 'web_auth_rejected':
        return {
          blocker,
          severity,
          cause: 'The last DeepSeek Web request rejected the captured auth state.',
          action: 'Run Make Ready so the extension clears stale auth and refreshes from a live DeepSeek tab.',
        };
      case 'deepseek_content_script_stale':
        return {
          blocker,
          severity,
          cause: 'At least one DeepSeek tab did not answer the current content-script health ping.',
          action: 'Use Reload stale tabs, or run Make Ready again after the tabs finish refreshing.',
        };
      case 'browser_control_disabled':
        return {
          blocker,
          severity,
          cause: 'Browser Control is disabled or unavailable.',
          action: 'Enable Browser Control in the sidepanel, then select or lock your Dev++ target.',
        };
      case 'browser_target_missing':
        return {
          blocker,
          severity,
          cause: 'No usable browser target is selected or locked.',
          action: 'Select your Studio Display browser tab on Browser Control, then lock it as Dev++.',
        };
      case 'browser_target_not_controllable':
        return {
          blocker,
          severity,
          cause: 'The selected target cannot be controlled or is the DeepSeek chat tab itself.',
          action: 'Pick the actual page you want the model to inspect, not chat.deepseek.com.',
        };
      case 'browser_vision_capture_disabled':
        return {
          blocker,
          severity,
          cause: 'Browser visual capture is off.',
          action: 'Enable visual capture so browser-view questions can attach transient Vision images.',
        };
      case 'act_verify_disabled':
        return {
          blocker,
          severity,
          cause: 'Browser action verification is off.',
          action: 'Enable act-verify so browser actions can be checked with visual evidence.',
        };
      case 'evidence_packs_disabled':
        return {
          blocker,
          severity,
          cause: 'Metadata-only evidence packs are off.',
          action: 'Enable evidence packs so automation can record what it verified without storing raw screenshots.',
        };
      case 'storage_leak':
        return {
          blocker,
          severity,
          cause: 'Leak Sentry found forbidden durable auth, image, or Vision reference data.',
          action: 'Inspect the Leak Sentry rows before running more automation.',
        };
      case 'storage_scan_failed':
        return {
          blocker,
          severity,
          cause: 'Runtime Doctor could not read one of the extension storage areas.',
          action: 'Reload the extension and rerun Runtime Doctor.',
        };
    }
  });
}

function createRuntimeDoctorLeakSentry(
  storage: ReturnType<typeof scanRuntimeDoctorStorage>,
  failedAreas: Array<'local' | 'session'>,
): RuntimeDoctorReport['leakSentry'] {
  const allAreas: Array<'local' | 'session'> = ['local', 'session'];
  const checkedAreas = allAreas.filter((area) => !failedAreas.includes(area));
  return {
    ok: storage.ok,
    grade: storage.ok ? 'A' : 'F',
    issueCount: storage.issues.length,
    checkedAreas,
  };
}

function createRuntimeDoctorHumanEval(input: {
  hasUsableWebAuth: boolean;
  sessionActive: boolean;
  browserMonitorReady: boolean;
  contentScripts: RuntimeDoctorReport['contentScripts'];
  storage: ReturnType<typeof scanRuntimeDoctorStorage>;
  toolDescriptorsReady: boolean;
}): RuntimeDoctorReport['humanEval'] {
  const checks: RuntimeDoctorReport['humanEval']['checks'] = [
    {
      id: 'ready_loop',
      label: 'Make everything ready',
      prompt: 'Get my DeepSeek++ setup ready, then tell me plainly what still needs attention.',
      status: input.hasUsableWebAuth && input.contentScripts.staleTabs === 0 ? 'pass' : 'fail',
      evidence: input.contentScripts.staleTabs === 0
        ? 'DeepSeek tabs answered the content health ping.'
        : `${input.contentScripts.staleTabs} DeepSeek tab(s) need a refresh.`,
    },
    {
      id: 'same_session',
      label: 'Same chat continuity',
      prompt: 'Continue from where we left off in this DeepSeek chat if that session is still usable.',
      status: input.sessionActive ? 'pass' : 'warn',
      evidence: input.sessionActive ? 'A sidepanel or remembered session pointer exists.' : 'No sidepanel session pointer is currently available.',
    },
    {
      id: 'browser_vision',
      label: 'Browser view question',
      prompt: 'Take a look at my current browser view and help me figure out what to do next.',
      status: input.browserMonitorReady ? 'pass' : 'fail',
      evidence: input.browserMonitorReady ? 'Browser Control target and Vision capture are ready.' : 'Browser target or Vision capture is not ready.',
    },
    {
      id: 'tool_loop',
      label: 'Tool loop',
      prompt: 'Use the available tools only if they help, then explain what actually changed.',
      status: input.toolDescriptorsReady ? 'pass' : 'warn',
      evidence: input.toolDescriptorsReady ? 'Runtime tool descriptors are available.' : 'Tool descriptors were not confirmed.',
    },
    {
      id: 'leak_sentry',
      label: 'Leak sentry',
      prompt: 'Review the last run for leaks and tell me whether anything sensitive was stored.',
      status: input.storage.ok ? 'pass' : 'fail',
      evidence: input.storage.ok ? 'Storage scan found no forbidden durable auth/image refs.' : `${input.storage.issues.length} forbidden storage issue(s) found.`,
    },
  ];
  const failCount = checks.filter((check) => check.status === 'fail').length;
  const warnCount = checks.filter((check) => check.status === 'warn').length;
  return {
    grade: failCount === 0 && warnCount === 0
      ? 'A'
      : failCount === 0
        ? 'B'
        : failCount === 1
          ? 'C'
          : failCount === 2
            ? 'D'
            : 'F',
    checks,
  };
}

function getRuntimeReadinessTargetStatus(
  browserSettings: BrowserControlSettings,
  browserState: BrowserControlState | null,
): RuntimeDoctorReadiness['targetStatus'] {
  if (!browserState?.supported) return 'unsupported';
  if (typeof browserSettings.targetTabId !== 'number' || !browserState.target) return 'missing';
  return browserState.target.controllable && !isDeepSeekWebTargetUrl(browserState.target.url)
    ? 'ready'
    : 'not_controllable';
}

function isDeepSeekWebTargetUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === 'chat.deepseek.com';
  } catch {
    return false;
  }
}

async function findLatestRetryableAutomationFailure(): Promise<RuntimeDoctorReport['automation']['retryableFailure']> {
  const automations = await getAllAutomations();
  const candidates = automations
    .filter((automation) => automation.lastError?.retryable === true)
    .sort((a, b) => (b.lastError?.at ?? 0) - (a.lastError?.at ?? 0));
  const automation = candidates[0];
  if (!automation?.lastError) return null;
  const runs = await getAutomationRuns({ automationId: automation.id, limit: 1 }).catch(() => []);
  return {
    automationId: automation.id,
    automationName: redactDurableToolString(automation.name) ?? 'Automation',
    runId: runs[0]?.id ?? null,
    code: automation.lastError.code,
    message: redactDurableToolString(automation.lastError.message) ?? '',
    phase: automation.lastError.phase,
    at: automation.lastError.at,
  };
}

function createRuntimeDoctorDebugSuggestions(
  failure: RuntimeDoctorReport['automation']['retryableFailure'],
): RuntimeDoctorReport['debugDistiller']['suggestions'] {
  if (!failure) return [];
  return [{
    id: `automation-failure-${failure.automationId}`,
    kind: 'memory',
    title: `Remember automation recovery: ${failure.automationName}`,
    preview: `When automation "${failure.automationName}" fails in phase "${failure.phase}" with "${failure.code}", refresh DeepSeek Web auth and retry the run before changing the task.`,
    reason: 'Latest retryable automation failure can become a personal recovery memory.',
  }];
}

async function refreshDeepSeekWebAuth(preferredTabId?: number) {
  if (sidepanelChatSubmitPromise) {
    return {
      ok: false,
      error: 'chat_busy',
      report: await getRuntimeDoctorReport(preferredTabId),
    };
  }
  await clearSidepanelWebAuthRejected();
  await clearSidepanelChatSession();
  await clearClientHeadersFromStorage();
  await forgetClientHeadersInDeepSeekTabs(preferredTabId);
  const refreshed = await refreshClientHeadersFromDeepSeekTabs(preferredTabId);
  await broadcastChatAuthStatus(preferredTabId);
  return {
    ok: true,
    refreshed,
    report: await getRuntimeDoctorReport(preferredTabId),
  };
}

async function ensurePersonalRuntimeReady(
  preferredTabId: number | undefined,
  source: EnsurePersonalRuntimeReadySource,
): Promise<EnsurePersonalRuntimeReadyResult> {
  if (source === 'startup') {
    const personal = await getPersonalConvenienceConfig();
    if (!personal.enabled) {
      const report = await getRuntimeDoctorReport(preferredTabId);
      return {
        ok: true,
        ready: report.readiness.ready,
        source,
        changedSettings: false,
        refreshedAuth: false,
        targetStatus: report.readiness.targetStatus,
        blockers: report.readiness.blockers,
        report,
      };
    }
  }
  if (personalRuntimeReadyPromise) {
    if (source !== 'startup' && personalRuntimeReadySource === 'startup') {
      await personalRuntimeReadyPromise.catch(() => null);
      return ensurePersonalRuntimeReady(preferredTabId, source);
    }
    return personalRuntimeReadyPromise;
  }
  personalRuntimeReadySource = source;
  personalRuntimeReadyPromise = runEnsurePersonalRuntimeReady(preferredTabId, source)
    .finally(() => {
      personalRuntimeReadyPromise = null;
      personalRuntimeReadySource = null;
    });
  return personalRuntimeReadyPromise;
}

async function runPersonalAutopilotRepair(preferredTabId?: number): Promise<PersonalAutopilotRepairResult> {
  if (personalAutopilotRepairPromise) return personalAutopilotRepairPromise;
  personalAutopilotRepairPromise = runPersonalAutopilotRepairOnce(preferredTabId)
    .finally(() => {
      personalAutopilotRepairPromise = null;
    });
  return personalAutopilotRepairPromise;
}

async function runPersonalAutopilotRepairOnce(preferredTabId?: number): Promise<PersonalAutopilotRepairResult> {
  const startedAt = Date.now();
  const repaired: string[] = [];
  const first = await ensurePersonalRuntimeReady(preferredTabId, 'repair');
  let report = first.report;
  if (first.changedSettings) repaired.push('browser_control_defaults');
  if (first.refreshedAuth) repaired.push('web_auth_refreshed');
  if (first.targetStatus === 'reacquired' || first.targetStatus === 'selected_active') {
    repaired.push('browser_target_reacquired');
  }
  if (report.contentScripts.staleTabs > 0) {
    const reload = await reloadStaleDeepSeekTabs(preferredTabId);
    if (reload.reloaded > 0) repaired.push('stale_deepseek_tabs_reloaded');
    report = reload.report;
  }
  const run = await recordAutopilotRunFromReport('repair', startedAt, Date.now(), report, repaired);
  report = attachAutopilotRunToReport(report, run);
  return {
    ok: true,
    ready: report.readiness.ready,
    repaired,
    blockers: report.readiness.blockers,
    report,
  };
}

async function runEnsurePersonalRuntimeReady(
  preferredTabId: number | undefined,
  source: EnsurePersonalRuntimeReadySource,
): Promise<EnsurePersonalRuntimeReadyResult> {
  const preparedAt = Date.now();
  const blockers = new Set<RuntimeDoctorReadiness['blockers'][number]>();
  const changedSettings = await ensurePersonalBrowserControlDefaults();
  if (changedSettings) {
    await broadcastToolDescriptorsUpdate(preferredTabId);
    await broadcastBrowserControlUpdate(preferredTabId);
  }

  let refreshedAuth = false;
  let hasWebAuth = false;
  let webAuthRejected = await isSidepanelWebAuthRejected();
  if (sidepanelChatSubmitPromise) {
    blockers.add('chat_busy');
    hasWebAuth = !!(await loadClientHeadersFromStorage());
  } else if (source === 'startup') {
    hasWebAuth = !!(await loadClientHeadersFromStorage());
    if (!hasWebAuth) blockers.add('web_auth_missing');
  } else {
    if (webAuthRejected) {
      await clearSidepanelWebAuthRejected();
      webAuthRejected = false;
    }
    let headers = await loadClientHeadersFromStorage();
    if (!headers) {
      refreshedAuth = await refreshClientHeadersFromDeepSeekTabs(preferredTabId);
      headers = await loadClientHeadersFromStorage();
    }
    hasWebAuth = !!headers;
    if (!hasWebAuth) blockers.add('web_auth_missing');
  }
  if (webAuthRejected) blockers.add('web_auth_rejected');

  const targetPreparation = await browserControlService.preparePersonalTarget({
    allowActiveFallback: source === 'manual',
  });
  addTargetPreparationBlocker(blockers, targetPreparation);
  if (targetPreparation.status === 'reacquired' || targetPreparation.status === 'selected_active') {
    await broadcastBrowserControlUpdate(preferredTabId);
  }

  const deepSeekTabs = await getDeepSeekTabsForAuthRefresh(preferredTabId);
  const contentScripts = await getDeepSeekContentScriptHealth(deepSeekTabs);
  if (contentScripts.staleTabs > 0) blockers.add('deepseek_content_script_stale');

  const storageSnapshot = await getRuntimeDoctorStorageSnapshot();
  const storage = scanRuntimeDoctorStorage(storageSnapshot);
  if (!storage.ok) {
    blockers.add(storage.issues.some((issue) => issue.reason === 'storage_read_failed')
      ? 'storage_scan_failed'
      : 'storage_leak');
  }

  const settings = await getBrowserControlSettings();
  if (!settings.enabled) blockers.add('browser_control_disabled');
  if (!settings.allowVisionCapture) blockers.add('browser_vision_capture_disabled');
  if (!settings.verifyAfterActions) blockers.add('act_verify_disabled');
  if (!settings.collectEvidencePacks) blockers.add('evidence_packs_disabled');

  const readiness = createRuntimeReadiness({
    blockers: Array.from(blockers),
    lastPreparedAt: preparedAt,
    preparing: false,
    targetStatus: targetPreparation.status,
    noLeak: storage.ok,
  });
  lastPersonalRuntimeReadiness = readiness;
  let report = await getRuntimeDoctorReport(preferredTabId, readiness);
  if (source !== 'repair') {
    const run = await recordAutopilotRunFromReport(source, preparedAt, Date.now(), report, []);
    report = attachAutopilotRunToReport(report, run);
  }

  return {
    ok: true,
    ready: report.readiness.ready,
    source,
    changedSettings,
    refreshedAuth,
    targetStatus: targetPreparation.status,
    blockers: report.readiness.blockers,
    report,
  };
}

async function recordAutopilotRunFromReport(
  source: RuntimeDoctorAutopilotRun['source'],
  startedAt: number,
  finishedAt: number,
  report: RuntimeDoctorReport,
  repaired: string[],
): Promise<RuntimeDoctorAutopilotRun> {
  return appendAutopilotRun({
    source,
    startedAt,
    finishedAt,
    ready: report.readiness.ready,
    status: report.readiness.status,
    grade: report.humanEval.grade,
    blockers: report.readiness.blockers,
    targetStatus: report.readiness.targetStatus,
    repaired,
    leakIssueCount: report.leakSentry.issueCount,
  });
}

function attachAutopilotRunToReport(
  report: RuntimeDoctorReport,
  run: RuntimeDoctorAutopilotRun,
): RuntimeDoctorReport {
  const recentRuns = [run, ...report.autopilot.recentRuns.filter((item) => item.id !== run.id)].slice(0, 5);
  return {
    ...report,
    autopilot: {
      inFlightSource: null,
      latestRun: run,
      recentRuns,
    },
  };
}

async function ensurePersonalBrowserControlDefaults(): Promise<boolean> {
  const current = await getBrowserControlSettings();
  const patch: Partial<BrowserControlSettings> = {
    enabled: true,
    allowVisionCapture: true,
    verifyAfterActions: true,
    collectEvidencePacks: true,
    debugDistillerEnabled: true,
  };
  const changed = current.enabled !== true ||
    current.allowVisionCapture !== true ||
    current.verifyAfterActions !== true ||
    current.collectEvidencePacks !== true ||
    current.debugDistillerEnabled !== true;
  if (!changed) return false;
  await saveBrowserControlSettings(patch);
  return true;
}

function addTargetPreparationBlocker(
  blockers: Set<RuntimeDoctorReadiness['blockers'][number]>,
  preparation: BrowserControlTargetPreparation,
): void {
  if (preparation.status === 'missing') blockers.add('browser_target_missing');
  if (preparation.status === 'unsupported') blockers.add('browser_control_disabled');
  if (preparation.status === 'not_controllable') blockers.add('browser_target_not_controllable');
}

function createRuntimeReadiness(input: {
  blockers: RuntimeDoctorReadiness['blockers'];
  lastPreparedAt: number | null;
  preparing: boolean;
  targetStatus: RuntimeDoctorReadiness['targetStatus'];
  noLeak: boolean;
}): RuntimeDoctorReadiness {
  const blockers = Array.from(new Set(input.blockers));
  return {
    ready: blockers.length === 0,
    status: blockers.length === 0
      ? 'ready'
      : blockers.some((blocker) => blocker === 'storage_leak' || blocker === 'storage_scan_failed')
        ? 'blocked'
        : 'needs_attention',
    blockers,
    lastPreparedAt: input.lastPreparedAt,
    preparing: input.preparing,
    targetStatus: input.targetStatus,
    noLeak: input.noLeak,
  };
}

async function getRuntimeDoctorStorageSnapshot(): Promise<{
  local: Record<string, unknown>;
  session: Record<string, unknown>;
  failedAreas: Array<'local' | 'session'>;
}> {
  const [localSnapshot, sessionSnapshot] = await Promise.all([
    readStorageAreaSnapshot(chrome.storage.local),
    chrome.storage.session
      ? readStorageAreaSnapshot(chrome.storage.session)
      : Promise.resolve({ data: {}, failed: false }),
  ]);
  const failedAreas: Array<'local' | 'session'> = [];
  if (localSnapshot.failed) failedAreas.push('local');
  if (sessionSnapshot.failed) failedAreas.push('session');
  return {
    local: localSnapshot.data,
    session: sessionSnapshot.data,
    failedAreas,
  };
}

async function readStorageAreaSnapshot(
  storage: Pick<chrome.storage.StorageArea, 'get'>,
): Promise<{ data: Record<string, unknown>; failed: boolean }> {
  try {
    return {
      data: await storage.get(null) as Record<string, unknown>,
      failed: false,
    };
  } catch {
    return {
      data: {},
      failed: true,
    };
  }
}

async function broadcastChatAuthStatus(preferredTabId?: number) {
  const status = await getChatAuthStatus(preferredTabId);
  chrome.runtime.sendMessage({ type: 'AUTH_STATUS_CHANGED', ...status }).catch(() => {});
}

async function broadcastConversationExportProgress(
  progress: ConversationExportProgress,
  excludeTabId?: number,
) {
  await broadcastToTabs({ type: 'DEEPSEEK_EXPORT_PROGRESS', progress }, excludeTabId);
}

async function executeBackgroundRuntimeToolCall(
  call: ToolCall,
  source: ToolExecutionTrigger,
  options?: RuntimeToolCallOptions,
): Promise<ToolResult> {
  if (call.name === BROWSER_CAPTURE_SCREENSHOT_TOOL_NAME) {
    const result = await executeBrowserScreenshotVisionTool(call);
    await appendToolCallHistory(call, result, source);
    return result;
  }
  if (isBrowserControlToolName(call.name)) {
    const result = await executeBrowserControlToolCall(call, currentBackgroundLocale, {
      requireExplicitTarget: source === 'automation',
    });
    const wrapped = await maybeAttachActVerifyCapture(call, result);
    await appendToolCallHistory(call, wrapped, source);
    return wrapped;
  }
  return executeRuntimeToolCall(call, source, currentBackgroundLocale, options);
}

async function maybeAttachActVerifyCapture(call: ToolCall, result: ToolResult): Promise<ToolResult> {
  if (!result.ok || !shouldVerifyAfterBrowserAction(call.name)) return result;
  const settings = await getBrowserControlSettings();
  if (!settings.allowVisionCapture || !settings.verifyAfterActions) return result;

  const prompt = createBrowserActVerifyPrompt({
    toolName: call.name,
    summary: result.summary,
  });
  const startedAt = Date.now();
  try {
    const capture = await browserControlService.captureScreenshotForVision();
    const uploaded = await uploadBrowserScreenshotCapture(capture);
    const evidencePack = settings.collectEvidencePacks
      ? createDeepSeekWebVisionEvidencePack({
        kind: 'browser_act_verify',
        createdAt: capture.capturedAt,
        refFileIds: [uploaded.upload.refFileId],
        webVisionFiles: [uploaded.upload.metadata],
        source: {
          toolName: call.name,
          tabId: capture.tabId,
          windowId: capture.windowId,
        },
        image: uploaded.image,
        prompt,
      })
      : undefined;

    return {
      ...result,
      detail: [
        result.detail ?? result.summary,
        'A visual verification capture was attached for the next DeepSeek Web Vision continuation.',
      ].join('\n\n'),
      output: toToolOutput({
        ...toOutputObject(result.output),
        refFileIds: [uploaded.upload.refFileId],
        webVisionFiles: [toToolVisionMetadata(uploaded.upload.metadata)],
        actVerify: {
          ok: true,
          prompt,
          capturedAt: capture.capturedAt,
          image: uploaded.image,
          ...(evidencePack ? { evidencePack } : {}),
        },
      }),
    };
  } catch (err) {
    const error = normalizeVisionCaptureToolError(err);
    return {
      ...result,
      output: toToolOutput({
        ...toOutputObject(result.output),
        actVerify: {
          ok: false,
          prompt,
          attemptedAt: startedAt,
          error,
        },
      }),
    };
  }
}

async function captureCurrentTabImage(): Promise<{
  image: DeepSeekWebVisionSerializedImage;
  tab: CapturedTabInfo;
}> {
  const captureVisibleTab = readOptionalChromeApi(() => chrome.tabs.captureVisibleTab);
  if (!captureVisibleTab) {
    throw new Error('Current-tab capture is not available in this browser.');
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.find((item) => typeof item.id === 'number' && typeof item.windowId === 'number');
  if (!tab) {
    throw new Error('No active tab is available to capture.');
  }

  const dataUrl = await captureVisibleTab(tab.windowId, { format: 'png' });
  return {
    image: createCapturedTabSerializedImage(dataUrl, `current-tab-${Date.now()}.png`),
    tab: sanitizeCapturedTab(tab),
  };
}

async function captureBrowserControlTargetImage(): Promise<{
  image: DeepSeekWebVisionSerializedImage;
  tab: { id: number; windowId: number };
}> {
  const capture = await browserControlService.captureScreenshotForVision();
  return {
    image: createCapturedTabSerializedImage(
      `data:${capture.mimeType};base64,${capture.dataBase64}`,
      `browser-control-${capture.tabId}-${capture.capturedAt}.png`,
    ),
    tab: {
      id: capture.tabId,
      windowId: capture.windowId,
    },
  };
}

async function executeBrowserScreenshotVisionTool(call: ToolCall): Promise<ToolResult> {
  const startedAt = Date.now();
  try {
    const capture = await browserControlService.captureScreenshotForVision();
    const uploaded = await uploadBrowserScreenshotCapture(capture);
    const settings = await getBrowserControlSettings();
    const evidencePack = settings.collectEvidencePacks
      ? createDeepSeekWebVisionEvidencePack({
        kind: 'browser_capture',
        createdAt: capture.capturedAt,
        refFileIds: [uploaded.upload.refFileId],
        webVisionFiles: [uploaded.upload.metadata],
        source: {
          toolName: call.name,
          tabId: capture.tabId,
          windowId: capture.windowId,
        },
        image: uploaded.image,
      })
      : undefined;
    const completedAt = Date.now();
    return {
      ok: true,
      name: call.name,
      provider: call.provider,
      descriptorId: call.descriptorId,
      summary: 'Captured the controlled tab for DeepSeek Web Vision',
      detail: `Captured tab ${capture.tabId} and uploaded it as a transient DeepSeek Web Vision file ref.`,
      output: toToolOutput({
        kind: 'deepseek_web_vision_capture',
        refFileIds: [uploaded.upload.refFileId],
        webVisionFiles: [toToolVisionMetadata(uploaded.upload.metadata)],
        tab: {
          id: capture.tabId,
          windowId: capture.windowId,
        },
        image: uploaded.image,
        capturedAt: capture.capturedAt,
        ...(evidencePack ? { evidencePack } : {}),
      }),
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
    };
  } catch (err) {
    const completedAt = Date.now();
    const error = normalizeVisionCaptureToolError(err);
    return {
      ok: false,
      name: call.name,
      provider: call.provider,
      descriptorId: call.descriptorId,
      summary: error.message,
      detail: error.message,
      error,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
    };
  }
}

async function uploadBrowserScreenshotCapture(
  capture: BrowserScreenshotCaptureResult,
): Promise<{
  image: { name: string; mimeType: string; sizeBytes: number };
  upload: { refFileId: string; metadata: DeepSeekWebVisionFileMetadata };
}> {
  const headers = await loadOrRefreshClientHeaders();
  if (!headers) throw new DeepSeekAuthError(backgroundT('background.auth.missingDeepSeek'));
  return uploadBrowserScreenshotCaptureWithHeaders(capture, headers);
}

async function uploadBrowserScreenshotCaptureWithHeaders(
  capture: BrowserScreenshotCaptureResult,
  headers: Record<string, string>,
): Promise<{
  image: { name: string; mimeType: string; sizeBytes: number };
  upload: { refFileId: string; metadata: DeepSeekWebVisionFileMetadata };
}> {
  const image = createCapturedTabSerializedImage(
    `data:${capture.mimeType};base64,${capture.dataBase64}`,
    `browser-capture-${capture.tabId}-${capture.capturedAt}.png`,
  );
  const file = createDeepSeekWebVisionFileFromSerializedImage(image);
  const upload = await uploadDeepSeekWebVisionImage({
    file,
    clientHeaders: headers,
    createPowHeaders: (targetPath) => createPowHeaders(headers, { targetPath }),
  });
  return {
    image: {
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
    },
    upload,
  };
}

function createCapturedTabSerializedImage(
  dataUrl: string,
  name: string,
): DeepSeekWebVisionSerializedImage {
  const marker = ';base64,';
  const markerIndex = dataUrl.indexOf(marker);
  if (!dataUrl.startsWith('data:') || markerIndex <= 5) {
    throw new Error('Captured tab image is not a base64 data URL.');
  }
  const mimeType = dataUrl.slice('data:'.length, markerIndex).toLowerCase();
  if (!DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES.has(mimeType)) {
    throw new Error('Captured tab image type is not supported by DeepSeek Web Vision.');
  }
  const base64 = dataUrl.slice(markerIndex + marker.length);
  if (!base64) {
    throw new Error('Captured tab image is empty.');
  }
  const sizeBytes = base64ByteLength(base64);
  if (sizeBytes > DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES) {
    throw new Error('Captured tab image is larger than the DeepSeek Web Vision 8 MiB limit.');
  }
  return {
    name,
    mimeType,
    sizeBytes,
    dataUrl,
  };
}

function sanitizeCapturedTab(tab: chrome.tabs.Tab): CapturedTabInfo {
  return {
    id: tab.id ?? -1,
    windowId: tab.windowId,
    title: tab.title ?? '',
    url: tab.url ?? '',
  };
}

function normalizeVisionCaptureToolError(err: unknown): NonNullable<ToolResult['error']> {
  if (err && typeof err === 'object') {
    const code = typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : 'browser_vision_capture_failed';
    const message = err instanceof Error ? err.message : String(err);
    const retryable = typeof (err as { retryable?: unknown }).retryable === 'boolean'
      ? (err as { retryable: boolean }).retryable
      : true;
    return { code, message, retryable };
  }
  return {
    code: 'browser_vision_capture_failed',
    message: String(err),
    retryable: true,
  };
}

function toToolVisionMetadata(
  metadata: DeepSeekWebVisionFileMetadata,
): Record<string, string | number | boolean | null> {
  return {
    id: metadata.id,
    name: metadata.name,
    size: metadata.size,
    mimeType: metadata.mimeType,
    status: metadata.status,
    modelKind: metadata.modelKind,
    isImage: metadata.isImage,
    auditResult: metadata.auditResult,
    width: metadata.width,
    height: metadata.height,
  };
}

function toOutputObject(value: ToolResult['output']): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toToolOutput(value: Record<string, unknown>): ToolResult['output'] {
  return JSON.parse(JSON.stringify(value)) as ToolResult['output'];
}

function base64ByteLength(value: string): number {
  const normalized = value.replace(/\s+/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

async function analyzeMultimodalMedia(
  request: MultimodalMediaAnalyzeRequest,
): Promise<MultimodalMediaAnalyzeResponse> {
  try {
    const prompt = typeof request.prompt === 'string' && request.prompt.trim()
      ? request.prompt.trim()
      : 'Analyze the attached media.';
    const media = normalizeMultimodalMediaInputs(request.media);
    const server = await getMultimodalMcpServerForAnalysis();
    const analyses: MultimodalMediaAnalysisItem[] = [];

    const images = media.filter((item) => item.kind === 'image');
    if (images.length > 0) {
      const result = await executeBackgroundRuntimeToolCall(
        createMultimodalMcpToolCall(server, 'analyze_images', {
          prompt,
          images: images.map((item, index) => {
            if (!item.dataUrl) throw new Error(`${item.name} is missing image data.`);
            return {
              type: 'input_image',
              image_url: item.dataUrl,
              detail: 'auto',
              label: item.name || `image-${index + 1}`,
            };
          }),
          output_schema: 'general',
        }, request),
        'manual_chat',
        { timeoutMs: MULTIMODAL_MCP_REQUEST_TIMEOUT_MS },
      );
      const analysis = createMultimodalAnalysisItem(
        `images:${images.map((item) => item.id).join(',')}`,
        'image',
        images,
        result,
      );
      if (!result.ok) {
        return {
          ok: false,
          analyses: [analysis],
          error: result.detail || result.summary,
        };
      }
      analyses.push(analysis);
    }

    for (const video of media.filter((item) => item.kind === 'video')) {
      if (!video.base64Data) throw new Error(`${video.name} is missing video data.`);
      const result = await executeBackgroundRuntimeToolCall(
        createMultimodalMcpToolCall(server, 'analyze_video', {
          prompt,
          video: {
            inlineData: {
              data: video.base64Data,
              mimeType: video.mimeType,
            },
            mimeType: video.mimeType,
          },
          output_schema: 'summary',
        }, request),
        'manual_chat',
        { timeoutMs: MULTIMODAL_MCP_REQUEST_TIMEOUT_MS },
      );
      const analysis = createMultimodalAnalysisItem(video.id, 'video', [video], result);
      if (!result.ok) {
        return {
          ok: false,
          analyses: [...analyses, analysis],
          error: result.detail || result.summary,
        };
      }
      analyses.push(analysis);
    }

    return { ok: true, analyses };
  } catch (error) {
    return {
      ok: false,
      analyses: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeMultimodalMediaInputs(value: unknown): MultimodalMediaInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('No multimodal media was provided.');
  }
  if (value.length > MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN) {
    throw new Error(`Attach at most ${MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN} media files per turn.`);
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`media[${index}] must be an object.`);
    const media = item as Partial<MultimodalMediaInput>;
    const normalized: MultimodalMediaInput = {
      id: nonEmptyString(media.id, `media[${index}].id`),
      kind: media.kind === 'image' || media.kind === 'video' ? media.kind : invalidMediaKind(index),
      name: nonEmptyString(media.name, `media[${index}].name`),
      mimeType: nonEmptyString(media.mimeType, `media[${index}].mimeType`),
      sizeBytes: finiteNonNegativeNumber(media.sizeBytes, `media[${index}].sizeBytes`),
      dataUrl: typeof media.dataUrl === 'string' && media.dataUrl ? media.dataUrl : undefined,
      base64Data: typeof media.base64Data === 'string' && media.base64Data ? media.base64Data : undefined,
    };
    assertSupportedMultimodalMedia(normalized);
    return normalized;
  });
}

async function getMultimodalMcpServerForAnalysis() {
  const servers = await getAllMcpServers({ includeSecrets: false });
  const server = servers.find(isMultimodalMcpServer);
  if (!server) {
    throw new Error('Multimodal MCP preset is missing. Create it on the MCP page first.');
  }
  if (!server.enabled) {
    throw new Error('Multimodal MCP server is disabled. Enable it on the MCP page first.');
  }
  if (!server.execution.enabled || server.execution.mode === 'disabled') {
    throw new Error('Multimodal MCP execution is disabled. Enable execution on the MCP page first.');
  }
  if (!isMultimodalAnalysisToolAllowed(server.allowlist)) {
    throw new Error('Multimodal MCP analysis tools are disabled. Enable analyze_images or analyze_video on the MCP page first.');
  }
  if (!canUseMultimodalMediaInput(server)) {
    throw new Error('Multimodal MCP is not available for media analysis.');
  }
  return server;
}

function createMultimodalMcpToolCall(
  server: Awaited<ReturnType<typeof getMultimodalMcpServerForAnalysis>>,
  name: 'analyze_images' | 'analyze_video',
  payload: Record<string, unknown>,
  request: MultimodalMediaAnalyzeRequest,
): ToolCall {
  return {
    name,
    payload,
    raw: '',
    provider: {
      kind: 'mcp',
      id: server.id,
      displayName: server.displayName,
      transport: server.transport.kind,
    },
    source: {
      trigger: 'manual_chat',
      chatSessionId: request.chatSessionId ?? null,
      parentMessageId: request.parentMessageId ?? null,
    },
  };
}

function createMultimodalAnalysisItem(
  id: string,
  kind: 'image' | 'video',
  media: readonly MultimodalMediaInput[],
  result: ToolResult,
): MultimodalMediaAnalysisItem {
  return {
    id,
    kind,
    media: media.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
    })),
    result,
  };
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function finiteNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}

function invalidMediaKind(index: number): never {
  throw new Error(`media[${index}].kind must be image or video.`);
}

async function runBrowserSandboxToolResult(request: SandboxRunRequest): Promise<ToolResult> {
  const startedAt = Date.now();
  const result = await requestOffscreenSandboxRun(request);
  const completedAt = Date.now();
  const detail = result.ok
    ? result.result || result.stdout || ''
    : result.stderr || result.error || backgroundT('tool.sandbox.failed');

  return {
    ok: result.ok,
    summary: result.ok ? backgroundT('tool.sandbox.executed') : backgroundT('tool.sandbox.failed'),
    detail,
    output: sandboxExecutionResultToJson(result),
    error: result.ok ? undefined : {
      code: result.error || 'sandbox_execution_failed',
      message: detail,
      retryable: result.error === 'sandbox_timeout' || result.error === 'sandbox_frame_timeout',
    },
    startedAt,
    completedAt,
    durationMs: result.durationMs,
    truncated: result.truncated,
  };
}

async function requestOffscreenSandboxRun(request: SandboxRunRequest): Promise<SandboxExecutionResult> {
  if (!chrome.offscreen?.createDocument || !chrome.offscreen?.hasDocument) {
    return createSandboxFailure(
      backgroundT('tool.sandbox.offscreenUnavailableDetail'),
      'sandbox_offscreen_unavailable',
    );
  }

  try {
    await ensureSandboxOffscreenDocument();
  } catch (error) {
    return createSandboxFailure(
      error instanceof Error ? error.message : String(error),
      'sandbox_offscreen_create_failed',
    );
  }

  return sendSandboxRunToOffscreen(request);
}

async function ensureSandboxOffscreenDocument(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;

  if (!sandboxOffscreenCreation) {
    sandboxOffscreenCreation = chrome.offscreen.createDocument({
      url: SANDBOX_OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.IFRAME_SCRIPTING, chrome.offscreen.Reason.WORKERS],
      justification: 'Run DeepSeek-requested JavaScript, TypeScript, Python, and HTML in an isolated extension sandbox instead of the DeepSeek page.',
    }).finally(() => {
      sandboxOffscreenCreation = null;
    });
  }

  await sandboxOffscreenCreation;
}

function sendSandboxRunToOffscreen(request: SandboxRunRequest): Promise<SandboxExecutionResult> {
  const requestId = crypto.randomUUID();
  const timeoutMs = Math.max(2_000, request.timeoutMs + 2_000);

  return new Promise((resolve) => {
    let settled = false;
    const port = chrome.runtime.connect({ name: SANDBOX_OFFSCREEN_PORT });
    const settle = (result: SandboxExecutionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { port.disconnect(); } catch {}
      resolve(result);
    };
    const timeout = setTimeout(() => {
      settle(createSandboxFailure('Sandbox offscreen document timed out.', 'sandbox_offscreen_timeout', timeoutMs));
    }, timeoutMs);

    port.onMessage.addListener((message: unknown) => {
      const value = message && typeof message === 'object'
        ? message as { type?: unknown; requestId?: unknown; result?: unknown }
        : {};
      if (value.type !== 'OFFSCREEN_SANDBOX_RESULT' || value.requestId !== requestId) return;
      settle(normalizeSandboxExecutionResult(value.result));
    });

    port.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError?.message;
      if (settled) return;
      settle(createSandboxFailure(lastError || 'Sandbox offscreen document disconnected.', 'sandbox_offscreen_disconnected'));
    });

    port.postMessage({
      type: 'OFFSCREEN_SANDBOX_RUN',
      requestId,
      payload: request,
    });
  });
}

function normalizeSandboxExecutionResult(value: unknown): SandboxExecutionResult {
  const result = value && typeof value === 'object' ? value as Partial<SandboxExecutionResult> : {};
  return {
    ok: result.ok === true,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    result: typeof result.result === 'string' ? result.result : undefined,
    html: typeof result.html === 'string' ? result.html : undefined,
    previewText: typeof result.previewText === 'string' ? result.previewText : undefined,
    durationMs: typeof result.durationMs === 'number' && Number.isFinite(result.durationMs) ? result.durationMs : 0,
    truncated: result.truncated === true,
    error: typeof result.error === 'string' ? result.error : undefined,
  };
}

function createSandboxFailure(message: string, code: string, durationMs = 0): SandboxExecutionResult {
  return {
    ok: false,
    stdout: '',
    stderr: message,
    durationMs,
    truncated: false,
    error: code,
  };
}

function sandboxExecutionResultToJson(result: SandboxExecutionResult): Record<string, string | number | boolean> {
  return {
    ok: result.ok,
    stdout: result.stdout,
    stderr: result.stderr,
    result: result.result ?? '',
    html: result.html ?? '',
    previewText: result.previewText ?? '',
    durationMs: result.durationMs,
    truncated: result.truncated,
    error: result.error ?? '',
  };
}

async function handleConversationExport(
  payload: unknown,
  excludeTabId?: number,
): Promise<ConversationExportResult | { ok: false; exportId?: string; error: string }> {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const exportId = typeof value.exportId === 'string' && value.exportId.trim()
    ? value.exportId.trim()
    : crypto.randomUUID();
  const request = normalizeConversationExportRequest(value.request);
  const headers = await loadOrRefreshClientHeaders(excludeTabId);
  if (!headers) {
    return {
      ok: false,
      exportId,
      error: backgroundT('background.auth.missingDeepSeek'),
    };
  }

  const controller = new AbortController();
  conversationExportControllers.set(exportId, controller);

  try {
    const baseUrl = new URL(DEEPSEEK_HOME_URL).origin;
    const exportData = await runConversationExport({
      exportId,
      request,
      baseUrl,
      extensionVersion: getExtensionVersion(),
      signal: controller.signal,
      transport: createDeepSeekConversationExportTransport({
        baseUrl,
        clientHeaders: headers,
        fetchImpl: fetch,
      }),
      onProgress: (progress) => broadcastConversationExportProgress(progress, excludeTabId),
    });

    await broadcastConversationExportProgress({
      exportId,
      phase: 'formatting',
      status: 'running',
      current: 0,
      total: request.formats.length,
      message: backgroundT('background.export.generating'),
    }, excludeTabId);

    assertConversationExportNotCancelled(controller.signal);
    const artifacts = await buildConversationExportArtifactsCancellable(exportData, controller.signal);
    assertConversationExportNotCancelled(controller.signal);
    return {
      ok: true,
      exportId,
      summary: exportData.stats,
      artifacts,
    };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    await broadcastConversationExportProgress({
      exportId,
      phase: aborted ? 'cancelled' : 'failed',
      status: aborted ? 'cancelled' : 'failed',
      current: 0,
      total: 0,
      message: aborted ? backgroundT('background.export.cancelled') : error instanceof Error ? error.message : String(error),
    }, excludeTabId);
    return {
      ok: false,
      exportId,
      error: aborted ? backgroundT('background.export.cancelled') : error instanceof Error ? error.message : String(error),
    };
  } finally {
    conversationExportControllers.delete(exportId);
  }
}

function assertConversationExportNotCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Conversation export was cancelled.', 'AbortError');
}

async function scanDueAutomationsFromWake() {
  const result = await scanDueAutomations(executeAutomationWithContext);
  if (result.initialized > 0 || result.started > 0 || result.failed > 0) {
    await broadcastAutomationUpdate();
  }
  if (result.started > 0 || result.failed > 0) {
    await broadcastAutomationRunsUpdate();
    await broadcastToolCallHistoryUpdate();
  }
  return result;
}

async function runAutomationNow(id: string, excludeTabId?: number) {
  const automation = await getAutomationById(id);
  if (!automation) return { ok: false, error: 'automation_not_found' };

  const run = await runAutomation({
    automationId: id,
    trigger: 'manual',
    scheduledFor: null,
    executor: (request) => executeAutomationWithContext(request, excludeTabId),
  });

  await broadcastAutomationUpdate(excludeTabId);
  await broadcastAutomationRunsUpdate(excludeTabId);
  await broadcastToolCallHistoryUpdate(excludeTabId);

  return run ?? { ok: false, error: 'automation_already_running' };
}

async function executeAutomationWithContext(
  request: AutomationRunnerRequest,
  preferredTabId?: number,
): Promise<AutomationRunnerResult> {
  const personal = await getPersonalConvenienceConfig();
  if (personal.enabled && personal.autoReadyCheckBeforeRun) {
    await ensurePersonalRuntimeReady(preferredTabId, preferredTabId === undefined ? 'startup' : 'manual');
  }
  const sessionResolution = await resolveAutomationSessionPreference(request, personal);
  let workingRequest = sessionResolution.request;
  let recorder = createAutomationFlightRecorder(workingRequest, personal.sameSessionStrategy, sessionResolution.source);
  recorder = appendAutomationFlightEvent(recorder, {
    kind: 'request_prepared',
    status: 'info',
    label: 'Request prepared',
    summary: 'Automation request prepared with sanitized prompt metadata.',
    details: {
      trigger: workingRequest.trigger,
      promptLength: workingRequest.prompt.length,
      modelType: workingRequest.promptOptions.modelType,
      searchEnabled: workingRequest.promptOptions.searchEnabled,
      thinkingEnabled: workingRequest.promptOptions.thinkingEnabled,
      refFileCount: workingRequest.promptOptions.refFileIds.length,
      visualMonitorEnabled: workingRequest.promptOptions.visualMonitor?.enabled === true,
    },
  });
  recorder = appendAutomationFlightEvent(recorder, {
    kind: 'session_resolved',
    status: workingRequest.chatSessionId ? 'success' : 'info',
    label: 'Session resolved',
    summary: workingRequest.chatSessionId ? 'Using an existing DeepSeek Web session pointer.' : 'No reusable session pointer was available; DeepSeek Web will create one.',
    details: {
      strategy: personal.sameSessionStrategy,
      source: sessionResolution.source,
      hasParentMessageId: workingRequest.parentMessageId !== null,
    },
  });
  await updateAutomationRun(workingRequest.runId, {
    request: workingRequest,
    flightRecorder: recorder,
  });

  try {
    const clientHeaders = personal.enabled && !personal.autoRefreshWebAuth
      ? await loadClientHeadersFromStorage()
      : await loadOrRefreshClientHeaders(preferredTabId);
    const resolvedHeaders = resolveAutomationClientHeaders(
      clientHeaders,
      workingRequest,
      backgroundT('background.auth.missingDeepSeek'),
    );
    recorder = {
      ...recorder,
      auth: {
        source: resolvedHeaders.kind === 'ok' ? 'web_headers' : 'missing',
        hasWebAuth: resolvedHeaders.kind === 'ok',
      },
    };
    recorder = appendAutomationFlightEvent(recorder, {
      kind: 'auth_resolved',
      status: resolvedHeaders.kind === 'ok' ? 'success' : 'error',
      label: 'Web auth resolved',
      summary: resolvedHeaders.kind === 'ok'
        ? 'DeepSeek Web headers are available for this run.'
        : 'DeepSeek Web headers were not available.',
    });
    await updateAutomationRun(workingRequest.runId, { flightRecorder: recorder });
    if (resolvedHeaders.kind === 'failure') {
      recorder = finalizeAutomationFlightRecorder(recorder, resolvedHeaders.result);
      await updateAutomationRun(workingRequest.runId, { flightRecorder: recorder });
      return resolvedHeaders.result;
    }

    const beforeRefCount = workingRequest.promptOptions.refFileIds.length;
    const beforeEvidenceCount = workingRequest.promptOptions.visualEvidencePacks?.length ?? 0;
    workingRequest = await prepareAutomationRuntimeMonitorRequest(workingRequest, resolvedHeaders.headers);
    const attachedRefCount = Math.max(0, workingRequest.promptOptions.refFileIds.length - beforeRefCount);
    const evidencePackCount = Math.max(0, (workingRequest.promptOptions.visualEvidencePacks?.length ?? 0) - beforeEvidenceCount);
    recorder = {
      ...recorder,
      visual: {
        requested: workingRequest.promptOptions.visualMonitor?.enabled === true,
        attachedRefCount,
        evidencePackCount,
        rawImageStored: false,
      },
    };
    if (workingRequest.promptOptions.visualMonitor?.enabled === true) {
      recorder = appendAutomationFlightEvent(recorder, {
        kind: 'visual_monitor_attached',
        status: attachedRefCount > 0 ? 'success' : 'warning',
        label: 'Visual monitor attached',
        summary: attachedRefCount > 0
          ? 'Browser Control target screenshot was attached through DeepSeek Web Vision metadata.'
          : 'Visual monitor was enabled, but no new Vision ref was attached.',
        details: {
          attachedRefCount,
          evidencePackCount,
          rawImageStored: false,
        },
      });
      await updateAutomationRun(workingRequest.runId, { flightRecorder: recorder });
    }

    const [memories, activePreset, toolDescriptors] = await Promise.all([
      getAllMemories(),
      getActivePreset(),
      getRuntimeToolDescriptors(currentBackgroundLocale),
    ]);
    const enabledDescriptors = toolDescriptors.filter((descriptor) =>
      descriptor.execution.enabled &&
      descriptor.name !== BROWSER_CAPTURE_SCREENSHOT_TOOL_NAME
    );
    const [project, projectPromptContext] = workingRequest.chatSessionId
      ? await Promise.all([
        getProjectForConversation(workingRequest.chatSessionId),
        getProjectPromptContextForConversation(workingRequest.chatSessionId),
      ])
      : [null, null];

    recorder = appendAutomationFlightEvent(recorder, {
      kind: 'runner_started',
      status: 'info',
      label: 'Runner started',
      summary: 'DeepSeek automation runner started.',
      details: {
        enabledToolCount: enabledDescriptors.length,
        memoryCount: filterMemoriesByProjectScope(memories, project?.id ?? null).length,
      },
    });
    await updateAutomationRun(workingRequest.runId, { flightRecorder: recorder });

    const result = await runDeepSeekAutomation({
      ...workingRequest,
      locale: currentBackgroundLocale,
      promptContext: {
        memories: filterMemoriesByProjectScope(memories, project?.id ?? null),
        presetContent: activePreset?.content ?? null,
        projectContext: projectPromptContext ? formatProjectPromptContext(projectPromptContext) : null,
        toolDescriptors: enabledDescriptors,
      },
    }, {
      clientHeaders: resolvedHeaders.headers,
      executeToolCall: (call) => executeBackgroundRuntimeToolCall(call, 'automation'),
    });
    recorder = finalizeAutomationFlightRecorder(recorder, result);
    await updateAutomationRun(workingRequest.runId, { flightRecorder: recorder });
    if (result.ok) {
      await rememberDeepSeekWebSession({
        chatSessionId: result.chatSessionId,
        parentMessageId: result.parentMessageId,
      }, 'automation');
    }
    return result;
  } catch (error) {
    recorder = appendAutomationFlightEvent(recorder, {
      kind: 'runner_completed',
      status: 'error',
      label: 'Runner failed',
      summary: redactDurableToolString(error instanceof Error ? error.message : String(error)) ?? 'Automation runner failed.',
    });
    await updateAutomationRun(workingRequest.runId, { flightRecorder: recorder });
    throw error;
  }
}

async function resolveAutomationSessionPreference(
  request: AutomationRunnerRequest,
  personal: PersonalConvenienceConfig,
): Promise<{
  request: AutomationRunnerRequest;
  source: AutomationFlightRecorder['session']['source'];
}> {
  if (request.chatSessionId) {
    return { request, source: 'automation' };
  }
  if (!personal.enabled || personal.sameSessionStrategy === 'new') {
    return {
      request: { ...request, chatSessionId: null, parentMessageId: null },
      source: 'new_session',
    };
  }

  if (personal.sameSessionStrategy === 'last') {
    const preference = await getDeepSeekWebSessionPreference();
    if (preference.lastSession?.chatSessionId) {
      return {
        request: {
          ...request,
          chatSessionId: preference.lastSession.chatSessionId,
          parentMessageId: preference.lastSession.parentMessageId,
        },
        source: 'last_session',
      };
    }
  }

  const current = chatSessionId
    ? { chatSessionId, parentMessageId: chatParentMessageId }
    : await loadSidepanelWebChatSessionState();
  if (current?.chatSessionId) {
    return {
      request: {
        ...request,
        chatSessionId: current.chatSessionId,
        parentMessageId: current.parentMessageId,
      },
      source: 'sidepanel_session',
    };
  }

  return {
    request: { ...request, chatSessionId: null, parentMessageId: null },
    source: 'new_session',
  };
}

function createAutomationFlightRecorder(
  request: AutomationRunnerRequest,
  strategy: DeepSeekWebSessionStrategy,
  source: AutomationFlightRecorder['session']['source'],
): AutomationFlightRecorder {
  const now = Date.now();
  return {
    schemaVersion: 1,
    startedAt: now,
    updatedAt: now,
    session: {
      strategy,
      source,
      chatSessionIdPresent: request.chatSessionId !== null,
      parentMessageIdPresent: request.parentMessageId !== null,
    },
    auth: {
      source: 'not_checked',
      hasWebAuth: false,
    },
    visual: {
      requested: request.promptOptions.visualMonitor?.enabled === true,
      attachedRefCount: 0,
      evidencePackCount: 0,
      rawImageStored: false,
    },
    failure: null,
    retryable: null,
    events: [],
  };
}

function appendAutomationFlightEvent(
  recorder: AutomationFlightRecorder,
  event: Omit<AutomationFlightEvent, 'id' | 'at'>,
): AutomationFlightRecorder {
  const now = Date.now();
  return {
    ...recorder,
    updatedAt: now,
    events: [
      ...recorder.events,
      {
        id: `${event.kind}-${recorder.events.length + 1}`,
        at: now,
        ...event,
      },
    ],
  };
}

function finalizeAutomationFlightRecorder(
  recorder: AutomationFlightRecorder,
  result: AutomationRunnerResult,
): AutomationFlightRecorder {
  const next: AutomationFlightRecorder = {
    ...recorder,
    failure: result.ok ? null : result.error,
    retryable: result.ok ? null : result.error.retryable,
  };
  return appendAutomationFlightEvent(next, {
    kind: 'runner_completed',
    status: result.ok ? 'success' : 'error',
    label: result.ok ? 'Runner completed' : 'Runner failed',
    summary: result.ok
      ? 'Automation completed successfully.'
      : result.error.message,
    details: result.ok
      ? {
        toolExecutionCount: result.toolExecutions?.length ?? 0,
        historyVerified: result.history !== null,
      }
      : {
        code: result.error.code,
        phase: result.error.phase,
        retryable: result.error.retryable,
      },
  });
}

async function prepareAutomationRuntimeMonitorRequest(
  request: AutomationRunnerRequest,
  clientHeaders: Record<string, string> | null,
): Promise<AutomationRunnerRequest> {
  const monitor = request.promptOptions.visualMonitor;
  if (!monitor?.enabled) return request;
  if (!clientHeaders) throw new DeepSeekAuthError(backgroundT('background.auth.missingDeepSeek'));

  const capture = await browserControlService.captureScreenshotForVision();
  const uploaded = await uploadBrowserScreenshotCaptureWithHeaders(capture, clientHeaders);
  const existingRefFileIds = normalizeDeepSeekWebVisionRefFileIds(request.promptOptions.refFileIds ?? []);
  const refFileIds = normalizeDeepSeekWebVisionRefFileIds([
    ...existingRefFileIds,
    uploaded.upload.refFileId,
  ]);
  const existingMetadata = Array.isArray(request.promptOptions.webVisionFiles)
    ? request.promptOptions.webVisionFiles.filter((metadata) => refFileIds.includes(metadata.id))
    : [];
  const route = createDeepSeekWebVisionRoute({
    modelType: request.promptOptions.modelType ?? null,
    refFileIds,
    thinkingEnabled: request.promptOptions.thinkingEnabled,
    searchEnabled: request.promptOptions.searchEnabled,
  });
  const evidencePack = monitor.includeEvidencePack
    ? createDeepSeekWebVisionEvidencePack({
      kind: 'automation_monitor',
      createdAt: capture.capturedAt,
      refFileIds: [uploaded.upload.refFileId],
      webVisionFiles: [uploaded.upload.metadata],
      source: {
        automationId: request.automationId,
        automationRunId: request.runId,
        tabId: capture.tabId,
        windowId: capture.windowId,
      },
      image: uploaded.image,
      prompt: 'Look at the current browser state and use it as the visual input for this scheduled check.',
    })
    : undefined;
  const visualEvidencePacks = evidencePack
    ? [...(request.promptOptions.visualEvidencePacks ?? []), evidencePack]
    : request.promptOptions.visualEvidencePacks;

  const preparedRequest: AutomationRunnerRequest = {
    ...request,
    promptOptions: {
      ...request.promptOptions,
      ...route,
      webVisionFiles: [
        ...existingMetadata,
        uploaded.upload.metadata,
      ],
      visualMonitor: monitor,
      visualEvidencePacks,
    },
  };
  await updateAutomationRun(request.runId, { request: preparedRequest });
  return preparedRequest;
}

async function prepareAutomationVisionInput(
  input: AutomationCreateInput,
  images: unknown,
): Promise<AutomationCreateInput> {
  return {
    ...input,
    promptOptions: await prepareAutomationVisionPromptOptions(input.promptOptions, images),
  };
}

async function prepareAutomationVisionPatch(
  patch: AutomationUpdateInput,
  images: unknown,
): Promise<AutomationUpdateInput> {
  const imagePayloads = normalizeDeepSeekWebVisionSerializedImages(images);
  if (!patch.promptOptions && imagePayloads.length === 0) return patch;

  return {
    ...patch,
    promptOptions: await prepareAutomationVisionPromptOptions(
      patch.promptOptions ?? {
        modelType: null,
        searchEnabled: false,
        thinkingEnabled: false,
        refFileIds: [],
      },
      imagePayloads,
    ),
  };
}

async function prepareAutomationVisionPromptOptions(
  promptOptions: AutomationCreateInput['promptOptions'],
  images: unknown,
): Promise<AutomationCreateInput['promptOptions']> {
  const imagePayloads = Array.isArray(images)
    ? normalizeDeepSeekWebVisionSerializedImages(images)
    : images;
  const serializedImages = normalizeDeepSeekWebVisionSerializedImages(imagePayloads);
  const existingRefFileIds = normalizeDeepSeekWebVisionRefFileIds(promptOptions.refFileIds ?? []);
  const existingMetadata = normalizeAutomationVisionMetadata(promptOptions.webVisionFiles, existingRefFileIds);

  if (serializedImages.length === 0) {
    return applyAutomationVisionRoute(promptOptions, existingRefFileIds, existingMetadata);
  }

  const headers = await loadOrRefreshClientHeaders();
  if (!headers) throw new DeepSeekAuthError(backgroundT('background.auth.missingDeepSeek'));

  const uploadResults = [];
  for (const image of serializedImages) {
    const file = createDeepSeekWebVisionFileFromSerializedImage(image);
    uploadResults.push(await uploadDeepSeekWebVisionImage({
      file,
      clientHeaders: headers,
      createPowHeaders: (targetPath) => createPowHeaders(headers, { targetPath }),
    }));
  }

  const refFileIds = normalizeDeepSeekWebVisionRefFileIds([
    ...existingRefFileIds,
    ...uploadResults.map((result) => result.refFileId),
  ]);
  return applyAutomationVisionRoute(promptOptions, refFileIds, mergeVisionMetadata(
    existingMetadata,
    uploadResults.map((result) => result.metadata),
  ));
}

function applyAutomationVisionRoute(
  promptOptions: AutomationCreateInput['promptOptions'],
  refFileIds: string[],
  webVisionFiles: DeepSeekWebVisionFileMetadata[],
): AutomationCreateInput['promptOptions'] {
  const route = createDeepSeekWebVisionRoute({
    modelType: promptOptions.modelType ?? null,
    refFileIds,
    thinkingEnabled: promptOptions.thinkingEnabled === true,
    searchEnabled: promptOptions.searchEnabled === true,
  });
  return {
    ...promptOptions,
    modelType: route.modelType,
    refFileIds: route.refFileIds,
    thinkingEnabled: route.thinkingEnabled,
    searchEnabled: route.searchEnabled,
    webVisionFiles,
  };
}

function normalizeAutomationVisionMetadata(
  value: unknown,
  refFileIds: readonly string[],
): DeepSeekWebVisionFileMetadata[] {
  if (!Array.isArray(value)) return [];
  const refSet = new Set(refFileIds);
  return value
    .filter((item): item is DeepSeekWebVisionFileMetadata => (
      !!item &&
      typeof item === 'object' &&
      typeof (item as DeepSeekWebVisionFileMetadata).id === 'string' &&
      refSet.has((item as DeepSeekWebVisionFileMetadata).id)
    ))
    .map((item) => ({
      id: item.id,
      name: typeof item.name === 'string' ? item.name : null,
      size: typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : null,
      mimeType: typeof item.mimeType === 'string' ? item.mimeType : null,
      status: typeof item.status === 'string' ? item.status : null,
      modelKind: typeof item.modelKind === 'string' ? item.modelKind : null,
      isImage: typeof item.isImage === 'boolean' ? item.isImage : null,
      auditResult: typeof item.auditResult === 'string' ? item.auditResult : null,
      width: typeof item.width === 'number' && Number.isFinite(item.width) ? item.width : null,
      height: typeof item.height === 'number' && Number.isFinite(item.height) ? item.height : null,
    }));
}

function mergeVisionMetadata(
  existing: DeepSeekWebVisionFileMetadata[],
  next: DeepSeekWebVisionFileMetadata[],
): DeepSeekWebVisionFileMetadata[] {
  const byId = new Map<string, DeepSeekWebVisionFileMetadata>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of next) byId.set(item.id, item);
  return [...byId.values()];
}

function validateAutomationInput(input: AutomationCreateInput) {
  if (!input || typeof input !== 'object') throw new Error('Invalid automation input');
  validateNonEmptyString(input.name, 'Automation name');
  validateNonEmptyString(input.prompt, 'Automation prompt');
  validateAutomationScheduleInput(input.schedule);
}

function validateAutomationPatch(patch: AutomationUpdateInput) {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid automation patch');
  if (patch.name !== undefined) validateNonEmptyString(patch.name, 'Automation name');
  if (patch.prompt !== undefined) validateNonEmptyString(patch.prompt, 'Automation prompt');
  if (patch.status !== undefined && !isAutomationStatus(patch.status)) {
    throw new Error('Invalid automation status');
  }
  if (patch.schedule !== undefined) validateAutomationScheduleInput(patch.schedule);
}

function validateAutomationScheduleInput(schedule: AutomationCreateInput['schedule']) {
  if (!schedule || typeof schedule !== 'object') throw new Error('Invalid automation schedule');
  const result = validateAutomationSchedule(schedule);
  if (!result.ok) throw new Error(result.error.message);
}

function validateNonEmptyString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
}

function isAutomationStatus(status: unknown): status is AutomationStatus {
  return status === 'active' || status === 'paused' || status === 'archived';
}

async function getLocalSyncDataSnapshot(): Promise<SyncDataSnapshot> {
  const [memories, userSkills, skillSources, presets, projectContext, savedItems] = await Promise.all([
    getAllMemories(),
    getUserSkills(),
    getAllSkillSources(),
    getAllPresets(),
    getProjectContextState(),
    getSavedItemsState(),
  ]);

  return {
    memories: memories.map(({ id, ...memory }) => memory),
    skills: userSkills.filter(isSyncableSkill),
    skillSources: skillSources.filter(isSyncableSkillSource),
    presets,
    projectContext,
    savedItems,
  };
}

async function uploadSyncDataSnapshot(config: SyncConfig, snapshot: SyncDataSnapshot): Promise<void> {
  await Promise.all([
    webdavPut(config, 'memories.json', JSON.stringify(snapshot.memories)),
    webdavPut(config, 'skills.json', JSON.stringify(snapshot.skills)),
    webdavPut(config, 'skill-sources.json', JSON.stringify(snapshot.skillSources)),
    webdavPut(config, 'presets.json', JSON.stringify(snapshot.presets)),
    snapshot.projectContext
      ? webdavPut(config, 'project-context.json', JSON.stringify(snapshot.projectContext))
      : Promise.resolve(),
    snapshot.savedItems
      ? webdavPut(config, 'saved-items.json', JSON.stringify(snapshot.savedItems))
      : Promise.resolve(),
  ]);
}

async function getRemoteSyncDataSnapshot(config: SyncConfig): Promise<SyncDataSnapshot> {
  const [remoteMemJson, remoteSkillJson, remotePresetJson, remoteSkillSourceJson, remoteProjectContextJson, remoteSavedItemsJson] = await Promise.all([
    webdavGetRequired(config, 'memories.json'),
    webdavGetRequired(config, 'skills.json'),
    webdavGetRequired(config, 'presets.json'),
    webdavGet(config, 'skill-sources.json'),
    webdavGet(config, 'project-context.json'),
    webdavGet(config, 'saved-items.json'),
  ]);

  const memories = parseValidatedArray('memories.json', remoteMemJson, (item, path) => {
    if (!item || typeof item !== 'object') throw new Error(`${path} must be an object`);
    const { id: _id, ...memory } = item as Memory;
    return validateStoredMemory(memory, path);
  });

  const skills = parseValidatedArray('skills.json', remoteSkillJson, validateSkill)
    .filter(isSyncableSkill);
  const skillSources = remoteSkillSourceJson === null
    ? []
    : parseValidatedArray('skill-sources.json', remoteSkillSourceJson, validateSkillImportSource)
      .filter(isSyncableSkillSource);

  return {
    memories,
    skills,
    skillSources,
    presets: parseValidatedArray('presets.json', remotePresetJson, validatePreset),
    projectContext: remoteProjectContextJson === null
      ? null
      : parseValidatedJson('project-context.json', remoteProjectContextJson, validateProjectContextState),
    savedItems: remoteSavedItemsJson === null
      ? null
      : parseValidatedJson('saved-items.json', remoteSavedItemsJson, validateSavedItemsState),
  };
}

function isSyncableSkill(skill: Skill): boolean {
  return !(skill.source === 'remote' && skill.remote?.provider === 'local');
}

function isSyncableSkillSource(source: SkillImportSource): boolean {
  return source.provider !== 'local';
}

async function mergeSyncSnapshotWithLocalImports(snapshot: SyncDataSnapshot): Promise<SyncDataSnapshot> {
  const [userSkills, skillSources] = await Promise.all([
    getUserSkills(),
    getAllSkillSources(),
  ]);
  const merged = mergeLocalSkillImportsIntoSyncSnapshot(
    {
      skills: snapshot.skills,
      skillSources: snapshot.skillSources,
    },
    {
      skills: userSkills,
      skillSources,
    },
  );
  return {
    ...snapshot,
    skills: merged.skills,
    skillSources: merged.skillSources,
  };
}

async function webdavGetRequired(config: SyncConfig, file: string): Promise<string> {
  const content = await webdavGet(config, file);
  if (content === null) {
    throw new Error(backgroundT('background.sync.missingRemoteFile', { file }));
  }
  return content;
}

function getSyncCounts(snapshot: SyncDataSnapshot): SyncCounts {
  return {
    memories: snapshot.memories.length,
    skills: snapshot.skills.length,
    presets: snapshot.presets.length,
    projects: snapshot.projectContext?.projects.length ?? 0,
    projectConversations: snapshot.projectContext?.conversations.length ?? 0,
    savedItems: snapshot.savedItems?.items.length ?? 0,
  };
}

async function handleChatSubmitPrompt(
  prompt: string,
  configInput?: Partial<OfficialApiChatConfig>,
  excludeTabId?: number,
  images: DeepSeekWebVisionSerializedImage[] = [],
) {
  const [apiKey, webHeaders] = await Promise.all([
    getDeepSeekApiKey(),
    loadOrRefreshClientHeaders(excludeTabId),
  ]);
  const provider = selectSidepanelChatProvider({
    hasApiKey: !!apiKey,
    hasWebHeaders: !!webHeaders,
    hasImages: images.length > 0,
  });
  const loopProvider: ChatLoopProvider = provider === 'official-api' ? 'official-api' : 'web';
  await markChatLoopStarted(loopProvider);
  try {
    if (provider === 'official-api' && apiKey) {
      const config = configInput
        ? normalizeOfficialApiChatConfig(configInput)
        : await getOfficialApiChatConfig();
      await handleOfficialApiChatSubmitPrompt(prompt, apiKey, config, excludeTabId);
      return;
    }

    await handleWebChatSubmitPrompt(prompt, excludeTabId, images, webHeaders);
  } finally {
    await markChatLoopFinished();
  }
}

async function handleWebChatSubmitPrompt(
  prompt: string,
  excludeTabId?: number,
  images: DeepSeekWebVisionSerializedImage[] = [],
  clientHeaders?: Record<string, string> | null,
) {
  const headers = clientHeaders ?? await loadOrRefreshClientHeaders(excludeTabId);
  if (!headers) {
    await clearSidepanelChatSession();
    broadcastChatChunk({ text: '', done: true, error: backgroundT('background.auth.missingDeepSeek') }, excludeTabId);
    return;
  }

  try {
    const preferredSession = await resolveSidepanelChatSessionPreference({
      chatSessionId,
      parentMessageId: chatParentMessageId,
    });
    const sessionState = await getOrCreateSidepanelWebChatSession({
      chatSessionId: preferredSession.chatSessionId,
      parentMessageId: preferredSession.parentMessageId,
    }, () => createChatSession(headers));
    chatSessionId = sessionState.chatSessionId;
    chatParentMessageId = sessionState.parentMessageId;

    const { augmented, enabledDescriptors } = await buildSidepanelPrompt(prompt);
    const uploadResults = [];
    for (const image of images) {
      const file = createDeepSeekWebVisionFileFromSerializedImage(image);
      uploadResults.push(await uploadDeepSeekWebVisionImage({
        file,
        clientHeaders: headers,
        createPowHeaders: (targetPath) => createPowHeaders(headers, { targetPath }),
      }));
    }
    const route = createDeepSeekWebVisionRoute({
      modelType: null,
      refFileIds: normalizeDeepSeekWebVisionRefFileIds(uploadResults.map((upload) => upload.refFileId)),
      thinkingEnabled: false,
      searchEnabled: false,
    });

    const initialInput = {
      chatSessionId,
      parentMessageId: chatParentMessageId,
      modelType: route.modelType,
      prompt: augmented,
      refFileIds: route.refFileIds,
      thinkingEnabled: route.thinkingEnabled,
      searchEnabled: route.searchEnabled,
      clientHeaders: headers,
    };

    await runSidepanelToolLoop(initialInput, enabledDescriptors, excludeTabId);
  } catch (err) {
    const msg = formatSidepanelChatError(err, images.length > 0);
    broadcastChatChunk({ text: '', done: true, error: msg }, excludeTabId);
    if (shouldResetSidepanelChatSession(err, msg)) {
      await clearSidepanelWebAuthState(excludeTabId);
    }
  }
}

async function resolveSidepanelChatSessionPreference(
  current: { chatSessionId: string | null; parentMessageId: number | null },
): Promise<{ chatSessionId: string | null; parentMessageId: number | null }> {
  if (current.chatSessionId) return current;
  const personal = await getPersonalConvenienceConfig();
  if (!personal.enabled || personal.sameSessionStrategy !== 'last') return current;
  const preference = await getDeepSeekWebSessionPreference();
  if (!preference.lastSession?.chatSessionId) return current;
  return {
    chatSessionId: preference.lastSession.chatSessionId,
    parentMessageId: preference.lastSession.parentMessageId,
  };
}

function formatSidepanelChatError(err: unknown, hasImages = false): string {
  if (hasImages) {
    if (err instanceof DeepSeekWebVisionUploadError) {
      if (err.code === 'invalid_image') {
        return 'DeepSeek Web Vision only supports PNG, JPEG, WebP, or GIF images up to 8 MiB.';
      }
      if (err.code === 'file_not_ready') {
        return 'DeepSeek Web Vision could not finish preparing the image. Try again with a smaller image or refresh chat.deepseek.com.';
      }
      return 'DeepSeek Web Vision image upload failed. Refresh chat.deepseek.com and try again.';
    }
    if (err instanceof DeepSeekAuthError) {
      return backgroundT('background.auth.missingDeepSeek');
    }
    if (err instanceof DeepSeekSessionError) {
      return 'DeepSeek Web Vision session could not be created. Refresh chat.deepseek.com and try again.';
    }
    if (err instanceof DeepSeekPowError) {
      return 'DeepSeek Web Vision verification failed. Refresh chat.deepseek.com and try again.';
    }
    if (err instanceof DeepSeekPayloadError) {
      return 'DeepSeek Web Vision request failed. Refresh chat.deepseek.com and try again.';
    }
    return 'DeepSeek Web Vision request failed. Refresh chat.deepseek.com and try again.';
  }
  return err instanceof Error ? err.message : String(err);
}

function shouldResetSidepanelChatSession(err: unknown, message: string): boolean {
  if (err instanceof DeepSeekAuthError || err instanceof DeepSeekSessionError) return true;
  if (
    err instanceof DeepSeekWebVisionUploadError &&
    (err.httpStatus === 401 || err.httpStatus === 403)
  ) {
    return true;
  }
  const raw = err instanceof Error ? err.message : String(err);
  return /auth|token|401|403/i.test(raw) || /auth|token|401|403/i.test(message);
}

async function handleOfficialApiChatSubmitPrompt(
  prompt: string,
  apiKey: string,
  config: OfficialApiChatConfig,
  excludeTabId?: number,
) {
  try {
    const promptContext = await buildSidepanelPrompt(prompt);

    const initialMessages: OfficialDeepSeekMessage[] = [
      ...officialApiChatMessages,
      { role: 'user', content: promptContext.augmented },
    ];

    officialApiChatMessages = await runOfficialApiToolLoop(
      {
        apiKey,
        config,
        messages: initialMessages,
      },
      promptContext.enabledDescriptors,
      excludeTabId,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    broadcastChatChunk({ text: '', done: true, error: msg }, excludeTabId);
  }
}

async function buildSidepanelPrompt(prompt: string): Promise<{
  augmented: string;
  enabledDescriptors: ToolDescriptor[];
}> {
  const [memories, activePreset, toolDescriptors] = await Promise.all([
    getAllMemories(),
    getActivePreset(),
    getRuntimeToolDescriptors(currentBackgroundLocale),
  ]);
  const promptSettings = await getPromptInjectionSettings();
  const shouldInjectPreset = shouldInjectPresetForTurn({
    hasActivePreset: Boolean(activePreset),
    isFirstMessage: chatSessionId === null && officialApiChatMessages.length === 0,
    messageCount: officialApiChatMessages.length + 1,
    cadence: promptSettings.presetCadence,
  });

  const enabledDescriptors = filterSidepanelChatToolDescriptors(toolDescriptors);
  const { augmented } = buildPromptAugmentation(prompt, {
    memories: memories.filter((memory) => memory.scope !== 'project'),
    presetContent: shouldInjectPreset ? activePreset?.content ?? null : null,
    toolDescriptors: enabledDescriptors,
    thinkingEnabled: false,
    locale: currentBackgroundLocale,
    memoryEnabled: promptSettings.memoryEnabled,
    systemPromptEnabled: promptSettings.systemPromptEnabled,
    forceResponseLanguage: promptSettings.forceResponseLanguage === 'auto' ? null : promptSettings.forceResponseLanguage,
  });

  return { augmented, enabledDescriptors };
}

async function runOfficialApiToolLoop(
  input: {
    apiKey: string;
    config: OfficialApiChatConfig;
    messages: OfficialDeepSeekMessage[];
  },
  toolDescriptors: ToolDescriptor[],
  excludeTabId?: number,
): Promise<OfficialDeepSeekMessage[]> {
  const MAX_STEPS = 20;
  let currentMessages = [...input.messages];

  for (let step = 0; step < MAX_STEPS; step++) {
    let accumulated = '';
    let reasoningAccumulated = '';
    const turn = await submitOfficialDeepSeekStreaming({
      apiKey: input.apiKey,
      config: input.config,
      messages: currentMessages,
    }, {
      onTextChunk(newText: string, fullText: string) {
        accumulated = fullText;
        broadcastChatChunk({ text: newText, done: false, phase: 'answer' }, excludeTabId);
      },
      onReasoningChunk(newText: string, fullText: string) {
        reasoningAccumulated = fullText;
        broadcastChatChunk({ text: '', reasoningText: newText, done: false, phase: 'reasoning' }, excludeTabId);
      },
    });

    const fullText = accumulated || turn.assistantText;

    if (!fullText) {
      broadcastChatChunk({ text: '', done: true }, excludeTabId);
      return currentMessages;
    }

    currentMessages = [
      ...currentMessages,
      {
        role: 'assistant',
        content: fullText,
        reasoningContent: reasoningAccumulated || turn.reasoningText || undefined,
      },
    ];
    const toolCalls = extractToolCalls(fullText, { descriptors: toolDescriptors });

    if (toolCalls.length === 0) {
      broadcastChatChunk({ text: '', done: true }, excludeTabId);
      return currentMessages;
    }

    const execs: ToolExecutionRecord[] = [];
    for (const call of toolCalls) {
      const result = await executeBackgroundRuntimeToolCall(call, 'sidepanel_chat');
      execs.push({
        name: call.name,
        result: {
          ok: result.ok,
          summary: result.summary,
          detail: result.detail,
          output: result.output,
          truncated: result.truncated,
          error: result.error,
        },
      });
    }

    const toolResultsText = execs.map((e) =>
      `<${e.name}_result>\n${JSON.stringify(e.result)}\n</${e.name}_result>`
    ).join('\n');

    currentMessages = [
      ...currentMessages,
      {
        role: 'user',
        content: backgroundT('background.chat.continueWithToolResults', { toolResults: toolResultsText }),
      },
    ];
  }

  broadcastChatChunk({ text: backgroundT('background.chat.maxToolSteps'), done: true }, excludeTabId);
  return currentMessages;
}

async function runSidepanelToolLoop(
  input: {
    chatSessionId: string;
    parentMessageId: number | null;
    modelType: string | null;
    prompt: string;
    refFileIds: string[];
    thinkingEnabled: boolean;
    searchEnabled: boolean;
    clientHeaders: Record<string, string>;
  },
  toolDescriptors: ToolDescriptor[],
  excludeTabId?: number,
) {
  const MAX_STEPS = 20;
  const allExecutions: ToolExecutionRecord[] = [];
  let currentInput = input;

  for (let step = 0; step < MAX_STEPS; step++) {
    let accumulated = '';
    const turn = await submitPromptStreaming({
      ...currentInput,
      powHeaders: await createPowHeaders(currentInput.clientHeaders),
    }, {
      onTextChunk(newText: string, fullText: string) {
        accumulated = fullText;
        broadcastChatChunk({ text: newText, done: false }, excludeTabId);
      },
    });

    if (turn.responseMessageId === null) {
      await clearSidepanelChatSession();
      throw new DeepSeekPayloadError('DeepSeek Web response did not include a response message id.');
    }
    chatParentMessageId = turn.responseMessageId;
    await persistSidepanelChatSession();
    const fullText = accumulated || turn.assistantText;

    if (!fullText) {
      broadcastChatChunk({ text: '', done: true }, excludeTabId);
      return;
    }

    const toolCalls = extractToolCalls(fullText, { descriptors: toolDescriptors });

    if (toolCalls.length === 0) {
      broadcastChatChunk({ text: fullText, done: true }, excludeTabId);
      return;
    }

    const execs: ToolExecutionRecord[] = [];
    for (const call of toolCalls) {
      const result = await executeBackgroundRuntimeToolCall(call, 'sidepanel_chat');
      execs.push({
        name: call.name,
        result: {
          ok: result.ok,
          summary: result.summary,
          detail: result.detail,
          output: result.output,
          truncated: result.truncated,
          error: result.error,
        },
      });
    }
    allExecutions.push(...execs);

    const toolResultsText = execs.map((e) =>
      `<${e.name}_result>\n${JSON.stringify(e.result)}\n</${e.name}_result>`
    ).join('\n');

    const continuationPrompt = backgroundT('background.chat.continueWithToolResults', {
      toolResults: toolResultsText,
    });
    const continuationRoute = createDeepSeekWebVisionToolContinuationRoute({
      executions: execs,
      modelType: currentInput.modelType,
      thinkingEnabled: currentInput.thinkingEnabled,
      searchEnabled: currentInput.searchEnabled,
    });

    currentInput = {
      ...currentInput,
      prompt: continuationPrompt,
      parentMessageId: chatParentMessageId,
      ...continuationRoute,
    };
  }

  broadcastChatChunk({ text: backgroundT('background.chat.maxToolSteps'), done: true }, excludeTabId);
}

function broadcastChatChunk(
  chunk: {
    text: string;
    done: boolean;
    error?: string;
    reasoningText?: string;
    phase?: 'reasoning' | 'answer';
  },
  excludeTabId?: number,
) {
  chrome.runtime.sendMessage({ type: 'CHAT_STREAM_CHUNK', ...chunk }).catch(() => {});
}

// Called on every service-worker wake. If a chat tool loop was running when
// the previous SW instance was terminated, the sidepanel never received its
// final `done:true` chunk. Emit one so the UI unblocks, then reset in-memory
// chat state so the next turn starts clean.
async function reconcileInterruptedChatLoopOnWake() {
  const interrupted = await reconcileInterruptedChatLoop();
  if (!interrupted) return;
  await clearSidepanelChatSession();
  officialApiChatMessages = [];
  broadcastChatChunk({ text: '', done: true, error: backgroundT('background.chat.interrupted') });
}

async function persistSidepanelChatSession(): Promise<void> {
  if (!chatSessionId) return;
  const state = {
    chatSessionId,
    parentMessageId: chatParentMessageId,
  };
  await Promise.all([
    saveSidepanelWebChatSessionState(state),
    rememberDeepSeekWebSession(state, 'sidepanel'),
  ]);
}

async function clearSidepanelChatSession(): Promise<void> {
  chatSessionId = null;
  chatParentMessageId = null;
  await clearSidepanelWebChatSessionState();
}

async function clearSidepanelWebAuthState(preferredTabId?: number): Promise<void> {
  chatSessionId = null;
  chatParentMessageId = null;
  await Promise.all([
    clearSidepanelWebChatSessionState(),
    clearDeepSeekWebLastSession(),
    clearClientHeadersFromStorage(),
    markSidepanelWebAuthRejected(),
    forgetClientHeadersInDeepSeekTabs(preferredTabId),
  ]);
}
