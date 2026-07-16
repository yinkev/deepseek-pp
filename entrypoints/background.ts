import {
  getAllMemories,
  getMemoryById,
  importMemoriesAtomically,
  saveMemory,
  updateMemory,
  deleteMemory,
  touchMemories,
  archiveStaleMemories,
} from '../core/memory/store';
import { filterMemoriesByProjectScope } from '../core/memory/scope';
import {
  getAllSkillSources,
  getAllSkills,
  getSkillLibrary,
  saveSkill,
  setSkillEnabled,
  setSkillsEnabled,
  stageDeleteSkillAlreadyLocked,
  stageDeleteSkillSourceAlreadyLocked,
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
  getActivePreset,
  setActivePresetId,
  stageDeletePresetAlreadyLocked,
} from '../core/preset/store';
import { getModelType, setModelType } from '../core/model/store';
import { getDeepSeekTheme, saveDeepSeekTheme } from '../core/theme/store';
import { getBackgroundConfig, saveBackgroundConfig, clearBackgroundConfig } from '../core/background/store';
import { getPetConfig, savePetConfig, clearPetConfig } from '../core/pet/store';
import { clearUsageRecords, getUsageSummary, recordUsageTurn } from '../core/usage/store';
import { getExtensionVersion } from '../core/version';
import {
  createBrowserSyncConfigStoragePort,
  createSyncConfigStore,
} from '../core/sync/config';
import {
  createSyncOperationCoordinator,
  type SyncDownloadResult,
} from '../core/sync/operation-coordinator';
import {
  recoverPendingSyncLocalApply,
  runLocalStateMutationWithRecovery,
  stageAndApplySyncSnapshotLocally,
} from '../core/sync/local-apply-runtime';
import { createSyncRecoveryBarrier } from '../core/sync/recovery-barrier';
import { clearToolCallHistory, getToolCallHistory } from '../core/tool/history';
import {
  appendExternalizedToolPayloadChunk,
  clearExternalizedToolPayloadNamespace,
} from '../core/tool/externalized-payload';
import {
  createInvalidToolCallResult,
  createRuntimeToolRuntime,
  type RuntimeToolCallOptions,
} from '../core/tool/runtime';
import { createProductionToolProviderRegistry } from './background/tool-provider-composition';
import {
  authorizeExternalToolPayloadChunk,
  closeToolAuthorization,
  createToolAuthorization,
  createToolAuthorizationResult,
} from '../core/tool/authorization';
import { ExternalPayloadAuthorizationCache } from '../core/tool/external-payload-authorization-cache';
import {
  browserControlService,
  getBrowserControlSettings,
  getBrowserControlState,
  saveBrowserControlSettings,
  setBrowserControlEnabled,
} from '../core/browser-control';
import { composeSidepanelChatToolDescriptors } from '../core/tool/sidepanel';
import {
  addConversationToProject,
  bindPendingProjectConversation,
  createProjectContext,
  stageDeleteProjectContextAndMemoriesAlreadyLocked,
  formatProjectPromptContext,
  getProjectContextState,
  getProjectForConversation,
  getProjectPromptContextForConversation,
  refreshProjectConversation,
  removeConversationFromProject,
  setPendingProjectContext,
  updateProjectContext,
} from '../core/project';
import { getArtifact } from '../core/artifact';
import {
  deleteSavedItem,
  getAllSavedItems,
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
import {
  createSandboxToolDescriptors,
  executeSandboxToolCall,
  normalizeSandboxExecutionResult,
  parseSandboxEnvelope,
  readSandboxRequestId,
  SANDBOX_MESSAGE_TYPES,
  SANDBOX_OFFSCREEN_PORT,
  type SandboxExecutionResult,
  type SandboxRunRequest,
  type SandboxToolRuntime,
} from '../core/sandbox';
import { getCurrentPlatformEnvironment } from '../core/platform';
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
import {
  buildShellAllowlistUpgrade,
  createShellMcpPresetInput,
  isShellMcpServer,
} from '../core/shell';
import {
  createMultimodalMcpPresetInput,
  isMultimodalMcpServer,
} from '../core/multimodal';
import {
  clearMultimodalSettings,
  getMultimodalSettingsStatus,
  saveMultimodalSettings,
} from '../core/multimodal/settings';
import { getWebToolSettings, setWebToolEnabled } from '../core/tool/web-settings';
import {
  addCustomScenario,
  applyScenarioTemplate,
  deleteScenario,
  getAllScenarios,
  saveScenario,
} from '../core/scenario/store';
import { getChatEnabled } from '../core/chat/store';
import { pendingChatTextStore } from '../core/chat/pending-text';
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
} from '../core/automation/store';
import { runDeepSeekAutomation } from '../core/automation/runner';
import { createAutomationRunnerFailure } from '../core/automation/messages';
import {
  AUTOMATION_WAKE_ALARM_NAME,
  AUTOMATION_WAKE_INTERVAL_MINUTES,
  cancelActiveAutomationRun,
  refreshAutomationNextRunAt,
  runAutomation,
  scanDueAutomations,
} from '../core/automation/scheduler';
import {
  createChatSession,
  createPowHeadersForPath,
  createPowHeaders,
  DEEPSEEK_FILE_UPLOAD_PATH,
  submitPromptStreaming,
  loadClientHeadersFromStorage,
  uploadDeepSeekFile,
} from '../core/deepseek/adapter';
import {
  loadQwenCachedAuth,
  mergeAndSaveQwenAuth,
  qwenAuthCaptureFromHeaders,
  refreshQwenAuthFromBrowser,
  type QwenAuthCapture,
} from '../core/qwen/auth';
import { createQwenWebTransport } from '../core/qwen/transport';
import { createQwenWebProviderAdapter } from '../core/qwen/provider-adapter';
import { createQwenImageUploader } from '../core/qwen/upload';
import { createDeepSeekWebProviderAdapter } from '../core/deepseek/provider-adapter';
import { createDeepSeekOfficialProviderAdapter } from '../core/deepseek/official-provider-adapter';
import { createDeepSeekAutomationClient } from '../core/deepseek/active-client';
import { DEEPSEEK_IMAGE_UPLOAD_MAX_BYTES } from '../core/deepseek/upload-limits';
import { compileSharedAgentPrompt } from '../core/chat/agent-prompt';
import { runProviderToolLoop } from '../core/chat/provider-tool-loop';
import {
  prependConversationTransfer,
  shouldStartFreshProviderSession,
  type NormalizedConversationMessage,
} from '../core/chat/conversation-transfer';
import {
  CHAT_MODELS,
  getChatImageUploadMaxBytes,
  isSupportedChatModelRef,
} from '../core/chat/provider-registry';
import {
  getActiveChatModelRef,
  saveActiveChatModelRef,
} from '../core/chat/provider-model-store';
import type {
  ChatModelRef,
  ChatProviderAdapter,
  ProviderAttachment,
  ProviderSession,
} from '../core/chat/provider';
import {
  addEniBondLo,
  addEniBondUs,
  extractSoftBondFromAssistant,
  extractSoftBondLoFacts,
  touchEniBondLastBeat,
} from '../core/cursor-bridge/eni-bond';
// Thin hook: browser-origin Cursor API bridge (isolated package; survives upstream merges).
import { getBridgeStatusSnapshot, startCursorBridgeRuntime } from '../core/cursor-bridge';
import { submitOfficialDeepSeekStreaming } from '../core/deepseek/official-api';
import { createDeepSeekConversationExportTransport } from '../core/deepseek/conversation-export';
import {
  buildConversationExportArtifactsCancellable,
  runConversationExport,
} from '../core/export/service';
import { buildPromptAugmentation } from '../core/prompt';
import {
  broadcastRuntimeUpdate,
  isExpectedMissingRuntimeMessageReceiverError,
} from '../core/messaging/broadcast';
import { createBackgroundErrorResponse } from '../core/messaging/background-error';
import {
  authorizeRuntimeMessage,
  createRuntimeBoundaryErrorResponse,
  createRuntimeMessageContext,
  decodeRuntimeMessageEnvelope,
  type RuntimeMessageContext,
  type RuntimeMessageEnvelope,
} from '../core/messaging/runtime-boundary';
import { createRuntimeCommandRegistry } from '../core/messaging/runtime-command-registry';
import {
  materializeDeepSeekImageUpload,
  type EncodedDeepSeekImageUploadRequest,
} from '../core/messaging/deepseek-runtime-request-codec';
import {
  materializeProviderImageUpload,
} from '../core/messaging/provider-runtime-request-codec';
import type {
  EncodedProviderImageUploadRequest,
} from '../core/messaging/provider-runtime-contracts';
import { createBootstrapRuntimeHandlers } from './background/bootstrap-handlers';
import { createTrackedLocalStateMutationRunner } from './background/local-state-mutation-runner';
import { createPersistenceMutationBindings } from './background/persistence-mutation-bindings';
import { createPersistenceRuntimeHandlers } from './background/persistence-handlers';
import { createToolRuntimeHandlers } from './background/tool-runtime-handlers';
import { createTrustedToolExecutionContext } from './background/tool-execution-handlers';
import {
  createChatRuntimeService,
  type ChatPromptBuildRequest,
} from './background/chat-runtime-service';
import { createDeepSeekRuntimeHandlers } from './background/deepseek-runtime-handlers';
import { createProviderRuntimeHandlers } from './background/provider-runtime-handlers';
import {
  createProviderChatTurnCoordinator,
  createProviderImageUploadCoordinator,
  getProviderAttachmentTransportError,
  type ProviderChatTurnContext,
  type ProviderImageUploadContext,
  type ProviderTransportKind,
} from './background/provider-chat-turn-coordinator';
import { createChatAdmissionCoordinator } from './background/chat-admission-coordinator';
import { createBackgroundRuntimeHandlers } from './background/background-runtime-handlers';
import { refreshDeepSeekAuthFromTabs } from './background/deepseek-auth-refresh';
import { createSyncRuntimeService } from './background/sync-runtime-service';
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
import type {
  BackgroundConfig,
  CurrentDeepSeekConversation,
  DeepSeekTheme,
  PetConfig,
  ToolCall,
  ToolDescriptor,
  ToolExecutionTrigger,
  ToolResult,
} from '../core/types';
import type { McpServerConfig } from '../core/mcp/types';
import type { AutomationRunnerRequest, AutomationRunnerResult } from '../core/automation/types';
import type { AutomationExecutionContext } from '../core/automation/execution';
import type { ConversationExportProgress } from '../core/export/types';

const DEEPSEEK_HOME_URL = 'https://chat.deepseek.com/';
const DEEPSEEK_TAB_URL_PATTERN = '*://chat.deepseek.com/*';
const QWEN_TAB_URL_PATTERN = '*://chat.qwen.ai/*';
const REFRESH_AUTH_MESSAGE = { type: 'REFRESH_DEEPSEEK_AUTH' } as const;
const AUTOMATION_AUTH_TOKEN_MISSING_MESSAGE =
  'DeepSeek login token is missing. Refresh chat.deepseek.com or sign in again, then retry the automation.';
const deepSeekAutomationClient = createDeepSeekAutomationClient();
const qwenWebTransport = createQwenWebTransport({ loadAuth: loadQwenCachedAuth });
const uploadQwenImage = createQwenImageUploader({ loadAuth: loadQwenCachedAuth });
const deepSeekWebProviderAdapter = createDeepSeekWebProviderAdapter({
  loadClientHeaders: () => loadOrRefreshClientHeaders(),
  loadModelType: () => getModelType(),
});
const deepSeekOfficialProviderAdapter = createDeepSeekOfficialProviderAdapter({
  loadApiKey: getDeepSeekApiKey,
  loadConfig: getOfficialApiChatConfig,
});
const qwenWebProviderAdapter = createQwenWebProviderAdapter({
  transport: qwenWebTransport,
  getStatus: async () => ({ available: Boolean((await loadQwenCachedAuth())?.authorization) }),
});

async function resolveChatProviderTransport(model: ChatModelRef): Promise<{
  adapter: ChatProviderAdapter;
  kind: ProviderTransportKind;
  loopProvider: ChatLoopProvider;
}> {
  if (model.providerId === 'qwen-web') {
    return { adapter: qwenWebProviderAdapter, kind: 'qwen-web', loopProvider: 'qwen-web' };
  }
  if (await getDeepSeekApiKey()) {
    return { adapter: deepSeekOfficialProviderAdapter, kind: 'deepseek-official', loopProvider: 'official-api' };
  }
  return { adapter: deepSeekWebProviderAdapter, kind: 'deepseek-web', loopProvider: 'web' };
}

async function getChatProviderStatus(providerId: ChatModelRef['providerId']) {
  if (providerId === 'qwen-web') return qwenWebProviderAdapter.getStatus();
  const official = await deepSeekOfficialProviderAdapter.getStatus();
  return official.available ? official : deepSeekWebProviderAdapter.getStatus();
}

async function getChatCatalogModels() {
  const usesOfficialDeepSeek = Boolean(await getDeepSeekApiKey());
  return CHAT_MODELS.map((model) => (
    model.ref.providerId === 'deepseek-web' && usesOfficialDeepSeek
      ? {
          ...model,
          supportsImages: false,
          imageUploadMaxBytes: undefined,
        }
      : model
  ));
}

interface SidepanelProviderConversationState {
  logicalConversationId: string;
  model: ChatModelRef;
  session: ProviderSession;
  messageCount: number;
  transportKind: ProviderTransportKind;
}

let sidepanelProviderConversation: SidepanelProviderConversationState | null = null;
const externalPayloadAuthorizationCache = new ExternalPayloadAuthorizationCache();
const {
  executeToolCall: executeRuntimeToolCall,
  getAuthorizationDescriptors: getRuntimeAuthorizationDescriptors,
  getToolDescriptors: getRuntimeToolDescriptors,
  refreshToolDescriptors: refreshRuntimeToolDescriptors,
} = createRuntimeToolRuntime(createProductionToolProviderRegistry());
let currentBackgroundLocale: SupportedLocale = DEFAULT_LOCALE;
let currentBackgroundTranslator = createTranslator(DEFAULT_LOCALE);
let sandboxOffscreenCreation: Promise<void> | null = null;
const chatAdmissionCoordinator = createChatAdmissionCoordinator();
const chatRuntimeService = createChatRuntimeService({
  admissionCoordinator: chatAdmissionCoordinator,
  getChatEnabled,
  getDeepSeekApiKey,
  getOfficialApiChatConfig,
  loadClientHeaders: loadOrRefreshClientHeaders,
  getModelType,
  buildPrompt: buildSidepanelPrompt,
  executeToolCall: (call, options) => executeBackgroundRuntimeToolCall(
    call,
    'sidepanel_chat',
    options,
  ),
  createChatSession: (headers, signal) => createChatSession(headers, signal),
  createPowHeaders: (headers, signal) => createPowHeaders(headers, undefined, signal),
  createUploadPowHeaders: (headers, signal) => createPowHeadersForPath(
    headers,
    DEEPSEEK_FILE_UPLOAD_PATH,
    undefined,
    signal,
  ),
  submitWebPrompt: submitPromptStreaming,
  submitOfficialPrompt: submitOfficialDeepSeekStreaming,
  uploadFile: uploadDeepSeekFile,
  markChatLoopStarted,
  markChatLoopFinished,
  reconcileInterruptedChatLoop,
  broadcastChunk: broadcastChatChunk,
  continueWithToolResults: (toolResults) => backgroundT(
    'background.chat.continueWithToolResults',
    { toolResults },
  ),
  maxToolStepsMessage: () => backgroundT('background.chat.maxToolSteps'),
  missingAuthMessage: () => backgroundT('background.auth.missingDeepSeek'),
  interruptedMessage: () => backgroundT('background.chat.interrupted'),
  reportError: reportBackgroundStartupError,
});
const providerChatTurnCoordinator = createProviderChatTurnCoordinator<ProviderChatSubmitRequest>({
  admissionCoordinator: chatAdmissionCoordinator,
  beforeSubmit: () => chatRuntimeService.reconcileInterruptedOnWake(),
  getChatEnabled,
  runTurn: handleProviderChatSubmitPrompt,
  handleTurnError(request, error, excludeTabId) {
    sidepanelProviderConversation = null;
    broadcastChatChunk({
      text: '',
      done: true,
      error: error instanceof Error ? error.message : String(error),
      providerId: request.model.providerId,
      modelId: request.model.modelId,
      logicalConversationId: request.logicalConversationId,
      streamTargetId: request.streamTargetId,
    }, excludeTabId);
  },
  reportError: reportBackgroundStartupError,
  resetState() {
    sidepanelProviderConversation = null;
  },
});
const providerImageUploadCoordinator = createProviderImageUploadCoordinator({
  isResetting: () => chatAdmissionCoordinator.isResetting(),
  getChatEnabled,
  runUpload: handleProviderImageUpload,
});
const providerAwareChatRuntimeService = {
  ...chatRuntimeService,
  async resetSession(): Promise<void> {
    const resetLease = chatAdmissionCoordinator.beginReset();
    try {
      await Promise.all([
        providerChatTurnCoordinator.resetSession(),
        providerImageUploadCoordinator.resetSession(),
        chatRuntimeService.resetSession(),
      ]);
    } finally {
      chatAdmissionCoordinator.endReset(resetLease);
    }
  },
};
const syncLocalRecoveryBarrier = createSyncRecoveryBarrier({
  recover: recoverPendingSyncLocalApply,
  async notifyReady() {
    await Promise.all([
      broadcastStateUpdate(),
      broadcastProjectContextUpdate(),
      broadcastSavedItemsUpdate(),
    ]);
  },
  onRecoveryFailure(error) {
    reportBackgroundStartupError('sync_local_recovery_failed', error);
  },
  onNotificationFailure(error) {
    reportBackgroundStartupError('sync_local_recovery_broadcast_failed', error);
  },
});
const beginLocalStateMutation = createTrackedLocalStateMutationRunner({
  runWithRecovery: runLocalStateMutationWithRecovery,
  trackApply: (operation) => syncLocalRecoveryBarrier.trackApply(operation),
});
const persistenceMutations = createPersistenceMutationBindings({
  runLocalStateMutation: beginLocalStateMutation,
  stageDeleteSkillAlreadyLocked,
  stageDeleteSkillSourceAlreadyLocked,
  stageDeletePresetAlreadyLocked,
  stageDeleteProjectContextAndMemoriesAlreadyLocked,
  importGitHubSkillSource,
  importLocalSkillSource,
  updateGitHubSkillSource,
  executeLocalSkillImporterToolCall,
});
const syncConfigStore = createSyncConfigStore(
  createBrowserSyncConfigStoragePort(),
  {
    conflictMessage: () => backgroundT('background.sync.configChanged'),
    commitIndeterminateMessage: () => backgroundT('background.sync.configCommitIndeterminate'),
  },
);
const syncRuntimeService = createSyncRuntimeService({
  translate: (key, params) => backgroundT(key, params),
  beginLocalApply(stage) {
    return syncLocalRecoveryBarrier.trackApply(stageAndApplySyncSnapshotLocally(stage));
  },
});
const syncOperationCoordinator = createSyncOperationCoordinator(syncConfigStore, {
  test: syncRuntimeService.test,
  authorize: syncRuntimeService.authorize,
  upload: syncRuntimeService.upload,
  download: syncRuntimeService.download,
  authorizationNotRequiredMessage: () => backgroundT('background.sync.authorizationNotRequired'),
});
const SANDBOX_OFFSCREEN_URL = 'sandbox-offscreen.html';
const browserSandboxRuntime: SandboxToolRuntime = {
  runSandbox: (request) => runBrowserSandboxToolResult(request),
};
const providerRuntimeHandlers = createProviderRuntimeHandlers({
  getModels: getChatCatalogModels,
  getCursorBridgeStatus: getBridgeStatusSnapshot,
  refreshProviderAuth(providerId, preferredTabId) {
    return providerId === 'qwen-web'
      ? refreshQwenAuthFromChrome(preferredTabId)
      : Promise.resolve();
  },
  getProviderStatus: getChatProviderStatus,
  getActiveModel: getActiveChatModelRef,
  saveActiveModel: saveActiveChatModelRef,
  uploadImage: providerImageUploadCoordinator.upload,
});
const runtimeCommandRegistry = createRuntimeCommandRegistry({
  typedHandlers: [
    ...createBootstrapRuntimeHandlers({
      getVersion: getExtensionVersion,
      dismissWhatsNew,
      refreshWhatsNewBadge,
    }),
    ...createPersistenceRuntimeHandlers({
      memory: {
        getAllMemories,
        getMemoryById,
        saveMemory,
        importMemoriesAtomically,
        updateMemory,
        deleteMemory,
        touchMemories,
        notifyCommittedStateUpdate,
      },
      skill: {
        getLocale: () => currentBackgroundLocale,
        getAllSkills: (locale) => getAllSkills({ locale }),
        getSkillLibrary,
        getAllSkillSources,
        saveSkill,
        deleteSkill: persistenceMutations.deleteSkill,
        setSkillEnabled,
        setSkillsEnabled,
        previewGitHubSkillSource,
        importGitHubSkillSource: persistenceMutations.importGitHubSkillSource,
        previewLocalSkillSource: (rootPath) => previewLocalSkillSource(
          rootPath,
          { executeToolCall: executeLocalSkillImporterToolCall },
        ),
        pickLocalSkillFolder: (defaultPath) => pickLocalSkillFolder(
          defaultPath,
          { executeToolCall: executeLocalSkillImporterToolCall },
        ),
        importLocalSkillSource: persistenceMutations.importLocalSkillSource,
        checkGitHubSkillSourceUpdates,
        updateGitHubSkillSource: persistenceMutations.updateGitHubSkillSource,
        deleteGitHubSkillSource: persistenceMutations.deleteGitHubSkillSource,
        broadcastStateUpdate,
      },
      library: {
        getAllPresets,
        savePreset,
        deletePreset: persistenceMutations.deletePreset,
        setActivePresetId,
        getActivePreset,
        getPromptInjectionSettings,
        savePromptInjectionSettings,
        getAllSavedItems,
        saveSavedItem,
        deleteSavedItem,
        insertPromptIntoActiveDeepSeekTab,
        getVoiceSettings,
        saveVoiceSettings,
        detectVoiceCapabilities,
        broadcastStateUpdate,
        broadcastSavedItemsUpdate,
        broadcastVoiceSettingsUpdate,
      },
      project: {
        getProjectContextState,
        createProjectContext,
        updateProjectContext,
        deleteProjectContext: persistenceMutations.deleteProjectContext,
        addConversationToProject,
        removeConversationFromProject,
        setPendingProjectContext,
        getCurrentDeepSeekConversation,
        bindPendingProjectConversation,
        refreshProjectConversation,
        getProjectForConversation,
        getProjectPromptContextForConversation,
        formatProjectPromptContext,
        getArtifact,
        notifyCommittedProjectContextUpdate,
        notifyCommittedStateUpdate,
      },
      localPreference: {
        getDeepSeekTheme,
        saveDeepSeekTheme,
        broadcastThemeUpdate,
        getModelType,
        setModelType,
        broadcastStateUpdate,
        getBackgroundConfig,
        saveBackgroundConfig,
        clearBackgroundConfig,
        broadcastBackgroundUpdate,
        getPetConfig,
        savePetConfig,
        clearPetConfig,
        broadcastPetUpdate,
      },
    }),
    ...createToolRuntimeHandlers({
      mcp: {
        getAllMcpServers,
        getMcpServerById,
        createMcpServer,
        updateMcpServer,
        deleteMcpServer,
        getMcpToolCache,
        refreshMcpServerDiscovery,
        getMcpOriginPattern,
        requestMcpServerOriginPermission,
        broadcastMcpServersUpdate,
        broadcastToolDescriptorsUpdate,
      },
      browser: {
        getWebToolSettings,
        setWebToolEnabled,
        getBrowserControlSettings,
        saveBrowserControlSettings,
        setBrowserControlEnabled,
        getBrowserControlState,
        setBrowserControlTarget: (tabId) => browserControlService.setTarget(tabId),
        detachBrowserControl: () => browserControlService.detach(),
        requestHostPermission: (origins) => chrome.permissions.request({ origins }),
        fetch: (input, init) => fetch(input, init),
        broadcastToolDescriptorsUpdate,
        broadcastBrowserControlUpdate,
      },
      execution: {
        getLocale: () => currentBackgroundLocale,
        getToolDescriptors: getRuntimeToolDescriptors,
        getAuthorizationDescriptors: getRuntimeAuthorizationDescriptors,
        refreshToolDescriptors: refreshRuntimeToolDescriptors,
        createToolAuthorization,
        closeToolAuthorization,
        authorizeExternalToolPayloadChunk,
        createToolAuthorizationResult,
        createInvalidToolCallResult,
        externalPayloadAuthorizationCache,
        appendExternalizedToolPayloadChunk,
        clearExternalizedToolPayloadNamespace,
        executeToolCall: executeRuntimeToolCall,
        runSandbox: runBrowserSandboxToolResult,
        getToolCallHistory,
        clearToolCallHistory,
        getPlatformEnvironment: getCurrentPlatformEnvironment,
        createRequestId: () => crypto.randomUUID(),
        now: () => Date.now(),
        sandboxInvalidRequestSummary: () => backgroundT('tool.sandbox.invalidRequest'),
        broadcastToolDescriptorsUpdate,
        broadcastMcpServersUpdate,
        broadcastToolCallHistoryUpdate,
      },
    }),
    ...providerRuntimeHandlers,
    ...createDeepSeekRuntimeHandlers({
      auth: {
        hasDeepSeekApiKey,
        saveDeepSeekApiKey,
        clearDeepSeekApiKey,
        resetChatSession: () => providerAwareChatRuntimeService.resetSession(),
        refreshContextMenus: createContextMenus,
        getChatAuthStatus,
        broadcastChatAuthStatus,
      },
      multimodal: {
        getSettingsStatus: getMultimodalSettingsStatus,
        saveSettings: saveMultimodalSettings,
        clearSettings: clearMultimodalSettings,
        getMcpServers: () => getAllMcpServers({ includeSecrets: false }),
        executeToolCall: (call, options) => executeBackgroundRuntimeToolCall(
          call,
          'manual_chat',
          options,
        ),
        broadcastToolCallHistoryUpdate,
      },
      chat: {
        service: providerAwareChatRuntimeService,
        submitProvider: providerChatTurnCoordinator.submit,
        getOfficialApiChatConfig,
        saveOfficialApiChatConfig,
      },
      conversationExport: {
        baseUrl: new URL(DEEPSEEK_HOME_URL).origin,
        getExtensionVersion,
        createExportId: () => crypto.randomUUID(),
        loadClientHeaders: loadOrRefreshClientHeaders,
        createTransport: ({ baseUrl, clientHeaders }) => (
          createDeepSeekConversationExportTransport({
            baseUrl,
            clientHeaders,
            fetchImpl: fetch,
          })
        ),
        runExport: runConversationExport,
        buildArtifacts: buildConversationExportArtifactsCancellable,
        broadcastProgress: broadcastConversationExportProgress,
        missingAuthMessage: () => backgroundT('background.auth.missingDeepSeek'),
        generatingMessage: () => backgroundT('background.export.generating'),
        cancelledMessage: () => backgroundT('background.export.cancelled'),
      },
    }),
    ...createBackgroundRuntimeHandlers({
      usage: {
        recordUsageTurn,
        getUsageSummary,
        clearUsageRecords,
      },
      sync: {
        coordinator: syncOperationCoordinator,
        notifyDownloadedState: notifyDownloadedSyncState,
      },
      automation: {
        getAllAutomations,
        getAutomationRuns,
        createAutomation,
        updateAutomation,
        setAutomationStatus,
        deleteAutomation,
        refreshAutomationNextRunAt,
        cancelActiveAutomationRun,
        runAutomationNow,
        broadcastAutomationUpdate,
        broadcastAutomationRunsUpdate,
      },
      scenario: {
        getAllScenarios,
        saveScenario,
        addCustomScenario,
        deleteScenario,
        refreshScenarioMenus: createContextMenus,
      },
    }),
  ],
});

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

export default defineBackground(() => {
  void syncLocalRecoveryBarrier.ensureReady().catch(acknowledgeReportedSyncRecoveryFailure);
  enableSidePanelActionClick();
  registerContextMenuClickListener();
  registerWhatsNewInstallListener();
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

  syncLocalRecoveryBarrier.ensureReady()
    .then(() => archiveStaleMemories()
      .catch((error) => reportBackgroundStartupError('archive_stale_memories_failed', error)))
    .catch(acknowledgeReportedSyncRecoveryFailure);
  ensureBuiltInMcpPresets().catch((error) => reportBackgroundStartupError('builtin_mcp_presets_failed', error));
  refreshWhatsNewBadge().catch((error) => reportBackgroundStartupError('whats_new_badge_failed', error));
  ensureAutomationWakeAlarm().catch((error) => reportBackgroundStartupError('automation_alarm_create_failed', error));
  providerAwareChatRuntimeService.reconcileInterruptedOnWake()
    .catch((error) => reportBackgroundStartupError('chat_loop_reconcile_failed', error));
  // Qwen capture can register immediately; automations + Cursor bridge wait for sync recovery.
  registerQwenRequestAuthCapture();
  refreshQwenAuthFromChrome().catch(() => {});
  syncLocalRecoveryBarrier.ensureReady()
    .then(() => {
      scanDueAutomationsFromWake()
        .catch((error) => reportBackgroundStartupError('automation_startup_scan_failed', error));
      // Local Cursor bridge: native host OpenAI surface → extension → DeepSeek web path.
      startCursorBridgeRuntime({
        deps: {
          loadClientHeaders: async () => {
            // Content script write to legacy cache is the freshest after a page message.
            const legacy = await loadClientHeadersFromStorage();
            if (legacy?.Authorization) return legacy;
            const { loadAnyAccountHeaders } = await import('../core/cursor-bridge/account-vault');
            return await loadAnyAccountHeaders();
          },
          refreshClientHeadersFromTabs: () => refreshClientHeadersFromDeepSeekTabs(),
          // Same DeepSeek++ tool runtime as web chat / automation / sidepanel.
          executeTool: (call) => executeBackgroundRuntimeToolCall(call, call.source?.trigger ?? 'agent_run'),
          loadToolDescriptors: () => getRuntimeToolDescriptors(currentBackgroundLocale),
          loadMemories: () => getAllMemories(),
          toolsEnabled: true,
        },
        // Lifecycle noise only — never console.error (shows up as Chrome extension Errors).
        onLog: (message) => console.debug(`[DeepSeek++] cursor_bridge: ${message}`),
      });
    })
    .catch(acknowledgeReportedSyncRecoveryFailure);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let envelope: RuntimeMessageEnvelope | undefined;
    let context: RuntimeMessageContext;
    try {
      envelope = decodeRuntimeMessageEnvelope(message);
      context = createRuntimeMessageContext(sender, {
        runtimeId: chrome.runtime.id,
        extensionOrigin: chrome.runtime.getURL('/'),
        deepSeekOrigin: new URL(DEEPSEEK_HOME_URL).origin,
      });
      authorizeRuntimeMessage(envelope, context);
    } catch (error) {
      sendResponse(createRuntimeBoundaryErrorResponse(error, envelope));
      return false;
    }

    syncLocalRecoveryBarrier.ensureReady()
      .then(() => handleMessage(envelope, context))
      .then(sendResponse)
      .catch((error) => sendResponse(createBackgroundErrorResponse(
        envelope,
        error,
        backgroundT('content.toolBlock.summaries.backgroundFailed'),
      )));
    return true;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if ('deepseek_pp_chat_enabled' in changes || DEEPSEEK_API_KEY_STORAGE_KEY in changes) {
      createContextMenus()
        .catch((error) => reportBackgroundStartupError('context_menu_refresh_failed', error));
      broadcastChatAuthStatus()
        .catch((error) => reportBackgroundStartupError('chat_auth_broadcast_failed', error));
    }
  });
});

function registerAutomationAlarmListener() {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTOMATION_WAKE_ALARM_NAME) return;
    syncLocalRecoveryBarrier.ensureReady()
      .then(() => scanDueAutomationsFromWake()
        .catch((error) => reportBackgroundStartupError('automation_alarm_scan_failed', error)))
      .catch(acknowledgeReportedSyncRecoveryFailure);
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
    await chrome.contextMenus.removeAll();
    return;
  }
  const apiKeyConfigured = await hasDeepSeekApiKey();
  const menuScope = apiKeyConfigured
    ? {}
    : { documentUrlPatterns: [DEEPSEEK_TAB_URL_PATTERN] };
  const scenarios = await getAllScenarios();
  const enabledScenarios = scenarios.filter((s) => s.enabled);

  await chrome.contextMenus.removeAll();

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

function registerContextMenuClickListener(): void {
  chrome.contextMenus.onClicked.addListener(async (
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab,
  ) => {
    if (!info.selectionText) return;
    const selectedText = info.selectionText.trim();
    if (!selectedText) return;

    // Open the sidepanel before async boundaries so the user gesture remains valid.
    const tabId = tab?.id;
    if (tabId && chrome.sidePanel?.open) {
      chrome.sidePanel.open({ tabId })
        .catch((error) => reportBackgroundStartupError('context_menu_sidepanel_open_failed', error));
    }

    const chatEnabled = await getChatEnabled();
    if (!chatEnabled) return;

    if (info.menuItemId === 'send-to-chat') {
      openSidePanelAndSendText(selectedText)
        .catch((error) => reportBackgroundStartupError('pending_chat_text_write_failed', error));
      return;
    }

    if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith('scenario-')) {
      const scenarioId = info.menuItemId.slice('scenario-'.length);
      getAllScenarios()
        .then((scenarios) => {
          const scenario = scenarios.find((s) => s.id === scenarioId);
          if (!scenario) return;
          const processed = applyScenarioTemplate(scenario.template, selectedText);
          return openSidePanelAndSendText(processed);
        })
        .catch((error) => reportBackgroundStartupError('scenario_context_menu_failed', error));
      return;
    }
  });
}

async function openSidePanelAndSendText(text: string) {
  await pendingChatTextStore.write(text);
  void chrome.runtime.sendMessage({ type: 'OPEN_CHAT_WITH_TEXT', text }).catch((error) => {
    if (isExpectedMissingRuntimeMessageReceiverError(error)) return;
    reportBackgroundStartupError('pending_chat_text_notification_failed', error);
  });
}

async function ensureBuiltInMcpPresets() {
  const servers = await getAllMcpServers();
  const shellServer = servers.find(isShellMcpServer);
  if (!shellServer) {
    await createMcpServer(createShellMcpPresetInput({ enabled: false }));
  } else {
    await ensureShellMcpCompatibility(shellServer);
  }
  const multimodalExists = servers.some(isMultimodalMcpServer);
  if (!multimodalExists) {
    await createMcpServer(createMultimodalMcpPresetInput({ enabled: false }));
  }
}

async function ensureShellMcpCompatibility(server: McpServerConfig) {
  let nextServer = server;
  const upgradedAllowlist = buildShellAllowlistUpgrade(server.allowlist);
  if (upgradedAllowlist) {
    nextServer = await updateMcpServer(server.id, {
      allowlist: upgradedAllowlist,
    }) ?? server;
  }

  if (!nextServer.enabled || !nextServer.execution.enabled || nextServer.execution.mode === 'disabled') {
    return;
  }

  const hasCache = Boolean(await getMcpToolCache(nextServer.id));
  if (!hasCache && !upgradedAllowlist) return;

  try {
    await refreshMcpServerDiscovery(nextServer.id);
  } catch (error) {
    reportBackgroundStartupError('shell_mcp_discovery_refresh_failed', error);
  }
}

function reportBackgroundStartupError(code: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[DeepSeek++] ${code}: ${detail}`, error);
}

function acknowledgeReportedSyncRecoveryFailure(error: unknown): void {
  // The recovery barrier invokes onRecoveryFailure before rejecting. Startup
  // observers consume that already-reported rejection to prevent an unhandled promise.
  void error;
}

async function handleMessage(
  message: RuntimeMessageEnvelope,
  context: RuntimeMessageContext,
) {
  return runtimeCommandRegistry.dispatch(message, context);
}

async function executeLocalSkillImporterToolCall(call: ToolCall): Promise<ToolResult> {
  const hasDescriptor = (
    await getRuntimeAuthorizationDescriptors(currentBackgroundLocale)
  ).some((descriptor) => descriptor.id === call.descriptorId);
  if (!hasDescriptor && call.provider?.kind === 'mcp') {
    await refreshMcpServerDiscovery(call.provider.id);
  }
  return executeBackgroundRuntimeToolCall(call, 'manual_chat');
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
  const cached = await loadClientHeadersFromStorage();
  if (cached) return cached;

  await refreshClientHeadersFromDeepSeekTabs(preferredTabId);
  return loadClientHeadersFromStorage();
}

function registerQwenRequestAuthCapture(): void {
  if (!chrome.webRequest?.onBeforeSendHeaders) return;
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const capture = qwenAuthCaptureFromHeaders(details.requestHeaders ?? []);
      if (capture.authorization) {
        mergeAndSaveQwenAuth(capture)
          .then((auth) => {
            if (auth) chrome.runtime.sendMessage({ type: 'QWEN_AUTH_STATUS_CHANGED', available: true }).catch(() => {});
          })
          .catch(() => {});
      }
      return undefined;
    },
    { urls: ['https://chat.qwen.ai/api/*'] },
    ['requestHeaders', 'extraHeaders'],
  );
}

async function refreshQwenAuthFromChrome(preferredTabId?: number) {
  const tabs = await getQwenTabsForAuthRefresh(preferredTabId);
  return refreshQwenAuthFromBrowser({
    readPageCapture: async () => {
      for (const tab of tabs) {
        if (!tab.id) continue;
        try {
          const capture = await captureQwenAuthFromTabMainWorld(tab.id);
          if (capture?.authorization) return capture;
        } catch {
          // Try the next Qwen tab; cached auth and cookies remain available tablessly.
        }
      }
      return null;
    },
    readCookies: async () => {
      if (!chrome.cookies?.getAll) return [];
      const cookies = await chrome.cookies.getAll({ url: 'https://chat.qwen.ai/' });
      return cookies
        .filter((cookie) => typeof cookie.name === 'string' && typeof cookie.value === 'string')
        .map((cookie) => ({ name: cookie.name, value: cookie.value }));
    },
  });
}

async function captureQwenAuthFromTabMainWorld(tabId: number): Promise<QwenAuthCapture | null> {
  if (!chrome.scripting?.executeScript) return null;
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const read = (keys: string[]): string | undefined => {
        for (const key of keys) {
          for (const storage of [localStorage, sessionStorage]) {
            try {
              const value = storage.getItem(key)?.trim();
              if (value) return value;
            } catch {
              // Storage can be unavailable during navigation.
            }
          }
        }
        return undefined;
      };
      const parseToken = (raw: string | undefined): string | undefined => {
        if (!raw || raw === 'null') return undefined;
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (typeof parsed === 'string') return parsed.trim() || undefined;
          if (parsed && typeof parsed === 'object') {
            const record = parsed as Record<string, unknown>;
            for (const key of ['token', 'value', 'accessToken']) {
              const value = record[key];
              if (typeof value === 'string' && value.trim()) return value.trim();
            }
          }
        } catch {
          return raw;
        }
        return raw;
      };
      return {
        authorization: parseToken(read(['token', 'accessToken', 'userToken'])),
        version: read(['version', 'appVersion', 'qwenVersion', 'qwen-version']),
        bxUmidToken: read(['bx-umidtoken', 'bxUmidToken', 'umidToken']),
        bxUa: read(['bx-ua', 'bxUa']),
      };
    },
  });
  const capture = results?.[0]?.result;
  if (!capture || typeof capture !== 'object') return null;
  return capture as QwenAuthCapture;
}

async function getQwenTabsForAuthRefresh(preferredTabId?: number): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({ url: QWEN_TAB_URL_PATTERN });
  if (!preferredTabId) return tabs.sort((a, b) => Number(b.active) - Number(a.active));
  const preferred = tabs.find((tab) => tab.id === preferredTabId);
  return preferred ? [preferred, ...tabs.filter((tab) => tab.id !== preferredTabId)] : tabs;
}

async function refreshClientHeadersFromDeepSeekTabs(preferredTabId?: number): Promise<boolean> {
  const tabs = await getDeepSeekTabsForAuthRefresh(preferredTabId);

  // Prefer MAIN-world page userToken (same web login the SPA uses). Isolated content
  // world cannot read page localStorage; after reload content scripts are often dead
  // while chat still works — vault then keeps stale tokens (40003).
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const fromPage = await captureDeepSeekTokenFromTabMainWorld(tab.id);
      if (fromPage?.Authorization) {
        await chrome.storage.local.set({ deepseekCachedClientHeaders: fromPage });
        try {
          const { upsertAccountFromHeaders } = await import('../core/cursor-bridge/account-vault');
          // Upsert only — never wipe other vault slots (multi-account).
          await upsertAccountFromHeaders(fromPage, { makeDefault: true });
        } catch {
          // vault optional
        }
        return true;
      }
    } catch {
      // scripting may be unavailable or tab restricted
    }
  }

  return refreshDeepSeekAuthFromTabs(tabs, {
    sendMessage: (tabId) => chrome.tabs.sendMessage(tabId, REFRESH_AUTH_MESSAGE),
    reportError: reportBackgroundStartupError,
  });
}

/**
 * Read chat.deepseek.com page localStorage userToken in MAIN world.
 * Same Bearer the website uses — not official API keys.
 */
async function captureDeepSeekTokenFromTabMainWorld(tabId: number): Promise<Record<string, string> | null> {
  if (!chrome.scripting?.executeScript) return null;
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const USER_TOKEN_KEY = 'userToken';
      const DEFAULT_APP_VERSION = '2.0.0';
      const DEEPSEEK_CLIENT_PLATFORM = 'web';
      try {
        const raw = localStorage.getItem(USER_TOKEN_KEY);
        if (!raw || raw.trim() === 'null') return null;
        let token: string | null = null;
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (typeof parsed === 'string') token = parsed.trim() || null;
          else if (parsed && typeof parsed === 'object') {
            const o = parsed as Record<string, unknown>;
            for (const k of ['token', 'value', 'accessToken']) {
              if (typeof o[k] === 'string' && (o[k] as string).trim()) {
                token = (o[k] as string).trim();
                break;
              }
            }
          }
        } catch {
          token = raw.trim() || null;
        }
        if (!token) return null;
        const auth = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
        return {
          Authorization: auth,
          'X-App-Version': DEFAULT_APP_VERSION,
          'x-client-platform': DEEPSEEK_CLIENT_PLATFORM,
          'x-client-version': DEFAULT_APP_VERSION,
          'x-client-locale': document.documentElement.lang || navigator.language || 'en-US',
          'x-client-timezone-offset': String(-new Date().getTimezoneOffset() * 60),
        };
      } catch {
        return null;
      }
    },
  });
  const first = results?.[0]?.result;
  if (!first || typeof first !== 'object') return null;
  const headers = first as Record<string, string>;
  if (typeof headers.Authorization !== 'string' || !headers.Authorization) return null;
  return headers;
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

async function notifyCommittedStateUpdate(excludeTabId?: number): Promise<void> {
  try {
    await broadcastStateUpdate(excludeTabId);
  } catch (error) {
    reportBackgroundStartupError('committed_state_broadcast_failed', error);
  }
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

async function notifyCommittedProjectContextUpdate(excludeTabId?: number): Promise<void> {
  try {
    await broadcastProjectContextUpdate(excludeTabId);
  } catch (error) {
    reportBackgroundStartupError('committed_project_broadcast_failed', error);
  }
}

async function getCurrentDeepSeekConversation(): Promise<
  { ok: true; conversation: CurrentDeepSeekConversation } | { ok: false; error: string }
> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
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

async function insertPromptIntoActiveDeepSeekTab(
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (text.length === 0) {
    return { ok: false, error: 'empty_prompt_text' };
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.find((item) => item.id != null && isDeepSeekPageUrl(item.url));
  if (!tab?.id) {
    return { ok: false, error: backgroundT('background.auth.missingDeepSeek') };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'INSERT_PROMPT_TEXT', text });
    if (response?.ok) return { ok: true };
    return {
      ok: false,
      error: getPromptInsertionErrorMessage(response?.error),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getPromptInsertionErrorMessage(error: unknown): string {
  if (error === 'empty_prompt_text') return 'empty_prompt_text';
  if (error === 'prompt_input_not_found') return backgroundT('background.auth.missingDeepSeek');
  return typeof error === 'string' && error.length > 0
    ? error
    : backgroundT('background.auth.missingDeepSeek');
}

function isDeepSeekPageUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === 'chat.deepseek.com';
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
  const hasApiKey = await hasDeepSeekApiKey();
  if (hasApiKey) {
    return {
      ok: true as const,
      available: true,
      provider: 'official-api' as const,
      hasApiKey: true,
      hasToken: false,
    };
  }

  const headers = await loadOrRefreshClientHeaders(preferredTabId);
  return {
    ok: true as const,
    available: !!headers,
    provider: headers ? 'deepseek-web' as const : null,
    hasApiKey: false,
    hasToken: !!headers,
  };
}

async function broadcastChatAuthStatus(preferredTabId?: number) {
  const status = await getChatAuthStatus(preferredTabId);
  chrome.runtime.sendMessage({ type: 'AUTH_STATUS_CHANGED', ...status })
    .catch((error) => reportBackgroundStartupError('chat_auth_notification_failed', error));
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
  return executeRuntimeToolCall(
    call,
    createTrustedToolExecutionContext(call, source),
    currentBackgroundLocale,
    {
      ...options,
      injectedProvider: options?.injectedProvider ?? {
        descriptors: createSandboxToolDescriptors(currentBackgroundLocale),
        execute: (sandboxCall, _descriptor, { locale }) => executeSandboxToolCall(
          browserSandboxRuntime,
          sandboxCall,
          locale,
        ),
      },
    },
  );
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
      try {
        port.disconnect();
      } catch (error) {
        reportBackgroundStartupError('offscreen_port_disconnect_cleanup_failed', error);
      }
      resolve(result);
    };
    const timeout = setTimeout(() => {
      settle(createSandboxFailure('Sandbox offscreen document timed out.', 'sandbox_offscreen_timeout', timeoutMs));
    }, timeoutMs);

    port.onMessage.addListener((message: unknown) => {
      const envelope = parseSandboxEnvelope(message, SANDBOX_MESSAGE_TYPES.offscreenResult, requestId);
      if (!envelope) {
        if (readSandboxRequestId(message, SANDBOX_MESSAGE_TYPES.offscreenResult) === requestId) {
          settle(createSandboxFailure('Invalid sandbox offscreen result.', 'sandbox_invalid_result'));
        }
        return;
      }
      settle(normalizeSandboxExecutionResult(envelope.result));
    });

    port.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError?.message;
      if (settled) return;
      settle(createSandboxFailure(lastError || 'Sandbox offscreen document disconnected.', 'sandbox_offscreen_disconnected'));
    });

    port.postMessage({
      type: SANDBOX_MESSAGE_TYPES.offscreenRun,
      requestId,
      payload: request,
    });
  });
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
  if (!automation) return { ok: false as const, error: 'automation_not_found' };

  const run = await runAutomation({
    automationId: id,
    trigger: 'manual',
    scheduledFor: null,
    executor: executeAutomationWithContext,
  });

  await broadcastAutomationUpdate(excludeTabId);
  await broadcastAutomationRunsUpdate(excludeTabId);
  await broadcastToolCallHistoryUpdate(excludeTabId);

  return run ?? { ok: false as const, error: 'automation_already_running' };
}

async function executeAutomationWithContext(
  request: AutomationRunnerRequest,
  execution: AutomationExecutionContext,
): Promise<AutomationRunnerResult> {
  execution.assertActive();
  const [memories, activePreset, toolDescriptors] = await Promise.all([
    getAllMemories(),
    getActivePreset(),
    getRuntimeToolDescriptors(currentBackgroundLocale),
  ]);
  const enabledDescriptors = toolDescriptors.filter((descriptor) => descriptor.execution.enabled);
  const [project, projectPromptContext] = request.chatSessionId
    ? await Promise.all([
      getProjectForConversation(request.chatSessionId),
      getProjectPromptContextForConversation(request.chatSessionId),
    ])
    : [null, null];
  execution.assertActive();

  const clientHeaders = await loadOrRefreshClientHeaders();
  execution.assertActive();
  if (!clientHeaders) {
    return createAutomationRunnerFailure(
      { ...request },
      'deepseek_auth_token_missing',
      AUTOMATION_AUTH_TOKEN_MISSING_MESSAGE,
      'auth',
      true,
      Date.now(),
      { externalOutcome: 'not_started', retrySafe: true },
    );
  }

  return runDeepSeekAutomation({
    ...request,
    locale: currentBackgroundLocale,
    promptContext: {
      memories: filterMemoriesByProjectScope(memories, project?.id ?? null),
      presetContent: activePreset?.content ?? null,
      projectContext: projectPromptContext ? formatProjectPromptContext(projectPromptContext) : null,
      toolDescriptors: enabledDescriptors,
    },
  }, {
    deepSeekClient: deepSeekAutomationClient,
    executeToolCall: (call, toolExecution) => executeBackgroundRuntimeToolCall(
      call,
      'automation',
      {
        signal: toolExecution.signal,
        idempotencyKey: toolExecution.idempotencyKey,
        assertActive: () => execution.assertActive(),
      },
    ),
    clientHeaders,
    execution,
  });
}

async function notifyDownloadedSyncState(
  result: SyncDownloadResult,
  context: RuntimeMessageContext,
): Promise<void> {
  await broadcastStateUpdate(context.tabId);
  if (result.projectContextChanged) await broadcastProjectContextUpdate(context.tabId);
  if (result.savedItemsChanged) await broadcastSavedItemsUpdate(context.tabId);
}

interface DeepSeekImageUploadRequest {
  dataUrl: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

async function handleDeepSeekImageUpload(payload: unknown, excludeTabId?: number) {
  if (!(await getChatEnabled())) {
    return { ok: false, error: 'chat_disabled' };
  }

  const request = normalizeDeepSeekImageUploadRequest(payload);
  const headers = await loadOrRefreshClientHeaders(excludeTabId);
  if (!headers) {
    return { ok: false, error: backgroundT('background.auth.missingDeepSeek') };
  }

  const file = dataUrlToBlob(request.dataUrl, request.mimeType);
  if (file.size !== request.sizeBytes) {
    throw new Error('Image upload payload size changed during transfer.');
  }

  const uploaded = await uploadDeepSeekFile({
    file,
    filename: request.name,
    modelType: 'vision',
    clientHeaders: headers,
    powHeaders: await createPowHeadersForPath(headers, DEEPSEEK_FILE_UPLOAD_PATH),
  });

  return { ok: true, file: uploaded };
}

async function handleProviderImageUpload(
  request: { model: unknown; image: EncodedProviderImageUploadRequest },
  upload: ProviderImageUploadContext,
  excludeTabId?: number,
) {
  upload.assertActive();
  if (!isSupportedChatModelRef(request.model)) {
    return { ok: false as const, error: 'unsupported_chat_model' };
  }
  const image = materializeProviderImageUpload(
    request.image,
    getChatImageUploadMaxBytes(request.model),
  );
  upload.assertActive();

  if (request.model.providerId === 'deepseek-web') {
    const transport = await resolveChatProviderTransport(request.model);
    upload.assertActive();
    const transportError = getProviderAttachmentTransportError(transport.kind, true);
    if (transportError) return { ok: false as const, error: transportError };

    const headers = await loadOrRefreshClientHeaders(excludeTabId);
    upload.assertActive();
    if (!headers) {
      return { ok: false as const, error: backgroundT('background.auth.missingDeepSeek') };
    }
    const powHeaders = await createPowHeadersForPath(
      headers,
      DEEPSEEK_FILE_UPLOAD_PATH,
      undefined,
      upload.signal,
    );
    upload.assertActive();
    const uploaded = await uploadDeepSeekFile({
      file: image.file,
      filename: image.name,
      modelType: 'vision',
      clientHeaders: headers,
      powHeaders,
    }, upload.signal);
    upload.assertActive();
    return {
      ok: true as const,
      attachment: {
        id: uploaded.id,
        name: image.name,
        mimeType: image.mimeType,
        providerFileId: uploaded.id,
      } satisfies ProviderAttachment,
    };
  }

  await refreshQwenAuthFromChrome(excludeTabId);
  upload.assertActive();
  const data = new Uint8Array(await image.file.arrayBuffer());
  upload.assertActive();
  const providerData = await uploadQwenImage({
    data,
    filename: image.name,
    contentType: image.mimeType,
    signal: upload.signal,
  });
  upload.assertActive();
  return {
    ok: true as const,
    attachment: {
      id: providerData.id,
      name: image.name,
      mimeType: image.mimeType,
      providerFileId: providerData.id,
      providerData: { ...providerData },
    } satisfies ProviderAttachment,
  };
}

function normalizeDeepSeekImageUploadRequest(
  payload: unknown,
  maxBytes = DEEPSEEK_IMAGE_UPLOAD_MAX_BYTES,
): DeepSeekImageUploadRequest {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const dataUrl = typeof value.dataUrl === 'string' ? value.dataUrl : '';
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'image';
  const mimeType = typeof value.mimeType === 'string' && value.mimeType.trim()
    ? value.mimeType.trim()
    : typeof value.type === 'string' && value.type.trim()
      ? value.type.trim()
      : '';
  const sizeBytes = typeof value.sizeBytes === 'number' && Number.isFinite(value.sizeBytes)
    ? value.sizeBytes
    : typeof value.size === 'number' && Number.isFinite(value.size)
      ? value.size
      : 0;

  if (!dataUrl.startsWith('data:')) {
    throw new Error('Image upload payload must include a data URL.');
  }
  if (!mimeType.startsWith('image/')) {
    throw new Error(`${name} is not an image file.`);
  }
  if (sizeBytes <= 0) {
    throw new Error(`${name} is empty.`);
  }
  if (sizeBytes > maxBytes) {
    throw new Error(`${name} exceeds the ${formatUploadBytes(maxBytes)} image upload limit.`);
  }

  return { dataUrl, name, mimeType, sizeBytes };
}

function dataUrlToBlob(dataUrl: string, expectedMimeType: string): Blob {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('Image upload payload must be base64 encoded.');
  }

  const mimeType = match[1] || expectedMimeType;
  if (mimeType !== expectedMimeType) {
    throw new Error(`Image MIME type changed from ${expectedMimeType} to ${mimeType}.`);
  }

  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function formatUploadBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

interface ProviderChatSubmitRequest {
  text: string;
  model: ChatModelRef;
  logicalConversationId: string;
  streamTargetId?: string;
  transcript: NormalizedConversationMessage[];
  refFileIds: string[];
  attachments: ProviderAttachment[];
  officialApiConfig?: OfficialApiChatConfig;
}

async function handleProviderChatSubmitPrompt(
  request: ProviderChatSubmitRequest,
  turn: ProviderChatTurnContext,
  excludeTabId?: number,
): Promise<void> {
  let markerStarted = false;
  try {
    if (request.model.providerId === 'qwen-web') {
      await refreshQwenAuthFromChrome(excludeTabId);
      turn.assertActive();
    }
    const transport = await resolveChatProviderTransport(request.model);
    turn.assertActive();
    const transportError = getProviderAttachmentTransportError(
      transport.kind,
      request.attachments.length > 0 || request.refFileIds.length > 0,
    );
    if (transportError) throw new Error(transportError);
    await markChatLoopStarted(transport.loopProvider);
    markerStarted = true;
    turn.assertActive();

    const adapter = transport.adapter;
    const freshSession = !sidepanelProviderConversation
      || sidepanelProviderConversation.logicalConversationId !== request.logicalConversationId
      || shouldStartFreshProviderSession(sidepanelProviderConversation.model, request.model)
      || sidepanelProviderConversation.transportKind !== transport.kind;
    const session = freshSession
      ? await adapter.createSession(request.model, turn.signal)
      : sidepanelProviderConversation!.session;
    turn.assertActive();
    const messageCount = (freshSession ? request.transcript.length : sidepanelProviderConversation!.messageCount) + 1;
    const [memories, skills, activePreset, runtimeDescriptors, promptSettings] = await Promise.all([
      getAllMemories(),
      getAllSkills({ locale: currentBackgroundLocale }),
      getActivePreset(),
      getRuntimeToolDescriptors(currentBackgroundLocale),
      getPromptInjectionSettings(),
    ]);
    turn.assertActive();
    const toolDescriptors = composeSidepanelChatToolDescriptors(
      runtimeDescriptors,
      currentBackgroundLocale,
    );
    const toolProtocol = request.model.providerId === 'qwen-web'
      ? 'json-envelope' as const
      : 'direct-xml' as const;
    const compiled = await compileSharedAgentPrompt({
      userPrompt: request.text,
      isFirstProviderTurn: freshSession,
      messageCount,
      memories: memories.filter((memory) => memory.scope !== 'project'),
      skills,
      activePreset,
      toolDescriptors,
      toolProtocol,
      locale: currentBackgroundLocale,
      promptSettings,
    });
    turn.assertActive();
    if (compiled.usedMemoryIds.length > 0) {
      await touchMemories(compiled.usedMemoryIds);
      turn.assertActive();
    }
    const prompt = freshSession && request.transcript.length > 0
      ? prependConversationTransfer(compiled.prompt, request.transcript)
      : compiled.prompt;
    const result = await runProviderToolLoop({
      adapter,
      model: request.model,
      session,
      prompt,
      originalTask: request.text,
      thinkingEnabled: request.model.providerId === 'qwen-web',
      toolProtocol,
      attachments: request.attachments.length > 0
        ? request.attachments
        : request.refFileIds.map((id) => ({ id, name: id, mimeType: 'application/octet-stream', providerFileId: id })),
      officialApiConfig: request.officialApiConfig,
      toolDescriptors,
      signal: turn.signal,
      executeTool: (call) => executeBackgroundRuntimeToolCall(call, 'sidepanel_chat', {
        signal: turn.signal,
        assertActive: turn.assertActive,
      }),
      onVisibleText(text) {
        turn.assertActive();
        broadcastChatChunk({
          text,
          done: false,
          phase: 'answer',
          providerId: request.model.providerId,
          modelId: request.model.modelId,
          logicalConversationId: request.logicalConversationId,
          streamTargetId: request.streamTargetId,
        }, excludeTabId);
      },
      onThinkingText(text, fullText) {
        turn.assertActive();
        broadcastChatChunk({
          text: '',
          reasoningText: text,
          reasoningFullText: fullText,
          done: false,
          phase: 'reasoning',
          providerId: request.model.providerId,
          modelId: request.model.modelId,
          logicalConversationId: request.logicalConversationId,
          streamTargetId: request.streamTargetId,
        }, excludeTabId);
      },
    });
    turn.assertActive();
    for (const fact of extractSoftBondLoFacts(request.text)) {
      await addEniBondLo(fact);
      turn.assertActive();
    }
    for (const fact of extractSoftBondFromAssistant(result.finalVisibleText)) {
      await addEniBondUs(fact);
      turn.assertActive();
    }
    await touchEniBondLastBeat(request.text);
    turn.assertActive();
    sidepanelProviderConversation = {
      logicalConversationId: request.logicalConversationId,
      model: request.model,
      session: result.session,
      messageCount: messageCount + 1,
      transportKind: transport.kind,
    };
    broadcastChatChunk({
      text: '',
      done: true,
      providerId: request.model.providerId,
      modelId: request.model.modelId,
      logicalConversationId: request.logicalConversationId,
      streamTargetId: request.streamTargetId,
    }, excludeTabId);
  } finally {
    if (markerStarted) {
      try {
        await markChatLoopFinished();
      } catch (error) {
        reportBackgroundStartupError('provider_chat_loop_finish_failed', error);
      }
    }
  }
}

async function buildSidepanelPrompt(request: ChatPromptBuildRequest): Promise<{
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
    isFirstMessage: request.isFirstMessage,
    messageCount: request.messageCount,
    cadence: promptSettings.presetCadence,
  });

  const enabledDescriptors = composeSidepanelChatToolDescriptors(
    toolDescriptors,
    currentBackgroundLocale,
  );
  const { augmented } = buildPromptAugmentation(request.prompt, {
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


function broadcastChatChunk(
  chunk: {
    text: string;
    done: boolean;
    error?: string;
    reasoningText?: string;
    reasoningFullText?: string;
    phase?: 'reasoning' | 'answer';
    providerId?: ChatModelRef['providerId'];
    modelId?: string;
    logicalConversationId?: string;
    streamTargetId?: string;
  },
  _excludeTabId?: number,
) {
  chrome.runtime.sendMessage({ type: 'CHAT_STREAM_CHUNK', ...chunk })
    .catch((error) => reportBackgroundStartupError('chat_stream_notification_failed', error));
}
