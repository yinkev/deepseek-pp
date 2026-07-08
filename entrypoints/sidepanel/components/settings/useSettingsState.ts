import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_BACKGROUND_OPACITY,
  clampBackgroundOpacity,
  normalizeBackgroundConfig,
} from '../../../../core/background/config';
import { getChatEnabled, setChatEnabled } from '../../../../core/chat/store';
import {
  DEFAULT_PET_CONFIG,
  clampPetOpacity,
  clampPetSize,
  normalizePetConfig,
} from '../../../../core/pet/config';
import {
  DEFAULT_PERSONAL_CONVENIENCE_CONFIG,
  normalizePersonalConvenienceConfig,
  type PersonalConvenienceConfig,
} from '../../../../core/personal-convenience/config';
import type {
  BackgroundConfig,
  Memory,
  MultimodalSettingsStatus,
  PetConfig,
  PetPosition,
  SyncConfig,
  SyncCounts,
} from '../../../../core/types';
import { validateImportedMemory } from '../../../../core/sync/schema';
import { getRuntimeErrorMessage, isRuntimeFailure } from '../../runtime-response';

/**
 * Central settings state + handlers.
 *
 * Previously SettingsPage.tsx held ~30 useState hooks and every handler inline.
 * Lifting them here lets each sub-page (General / API / Appearance / Data ...)
 * consume only the slice it needs, while keeping the chrome.runtime message
 * contract byte-for-byte identical to the legacy implementation.
 */

const DEFAULT_SYNC_CONFIG: SyncConfig = {
  url: '',
  username: '',
  password: '',
  remotePath: 'DeepSeekPP',
  lastSyncAt: null,
};

const DEFAULT_BACKGROUND_CONFIG: BackgroundConfig = {
  enabled: false,
  type: 'upload',
  url: '',
  imageData: '',
  opacity: DEFAULT_BACKGROUND_OPACITY,
};

export type ApiKeyStatus = 'idle' | 'saving' | 'clearing' | 'success' | 'error';
export type MultimodalStatus = 'idle' | 'saving' | 'clearing' | 'success' | 'error';
export type SyncStatus = 'idle' | 'testing' | 'uploading' | 'downloading' | 'success' | 'error';
export type SettingsLoadIssueId =
  | 'sidepanel-chat'
  | 'api-key'
  | 'multimodal'
  | 'memory'
  | 'version'
  | 'sync'
  | 'model'
  | 'background'
  | 'pet'
  | 'personal-defaults';

export interface SettingsLoadIssue {
  id: SettingsLoadIssueId;
  message: string;
}

const DEFAULT_MULTIMODAL: MultimodalSettingsStatus = {
  openaiConfigured: false,
  geminiConfigured: false,
  openaiImageModel: 'gpt-4.1-mini',
  geminiVideoModel: 'gemini-2.5-flash',
  openaiBaseUrl: 'https://api.openai.com/v1',
  geminiBaseUrl: 'https://generativelanguage.googleapis.com',
};

function readSettingsLoadResult<T>(
  result: PromiseSettledResult<T>,
  id: SettingsLoadIssueId,
  issues: SettingsLoadIssue[],
  fallback: T,
): T {
  let reason: unknown;
  if (result.status === 'fulfilled') {
    const value: unknown = result.value;
    if (!isRuntimeFailure(value)) return result.value;
    reason = value.error;
  } else {
    reason = result.reason;
  }
  issues.push({ id, message: getSettingsActionIssueMessage(reason, 'Load failed') });
  return fallback;
}

function getSettingsActionIssueMessage(error: unknown, fallback: string): string {
  const message = getRuntimeErrorMessage(error).trim();
  if (!message || message === 'undefined' || message === 'null') return fallback;
  if (
    /\b(GET|SAVE|CLEAR|SET|DELETE|WEBDAV)_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|IndexedDB|deepseek_pp_[a-z0-9_]+|Authorization|Bearer|Cookie|data:image|\[object Object\]|apiKey|openaiApiKey|geminiApiKey|OPENAI_API_KEY|GEMINI_API_KEY|DEEPSEEK_API_KEY|password|secret|token|sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+/i.test(message)
  ) {
    return fallback;
  }
  return message;
}

function getRuntimeActionFailureMessage(result: unknown, fallback: string): string {
  if (isRuntimeFailure(result)) {
    return getSettingsActionIssueMessage(result.error, fallback);
  }
  return fallback;
}

export function useSettingsState() {
  // --- shared / general ---
  const [memoryCount, setMemoryCount] = useState(0);
  const [version, setVersion] = useState('');
  const [expertMode, setExpertMode] = useState(false);
  const [chatEnabled, setChatEnabledState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadIssues, setLoadIssues] = useState<SettingsLoadIssue[]>([]);
  const [personalConfig, setPersonalConfig] = useState<PersonalConvenienceConfig>(DEFAULT_PERSONAL_CONVENIENCE_CONFIG);
  const [generalMessage, setGeneralMessage] = useState('');

  // --- deepseek api key ---
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>('idle');
  const [apiKeyMessage, setApiKeyMessage] = useState('');

  // --- multimodal ---
  const [multimodalConfigured, setMultimodalConfigured] = useState<MultimodalSettingsStatus>(DEFAULT_MULTIMODAL);
  const [openaiApiKeyInput, setOpenaiApiKeyInput] = useState('');
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState('');
  const [openaiImageModel, setOpenaiImageModel] = useState('gpt-4.1-mini');
  const [geminiVideoModel, setGeminiVideoModel] = useState('gemini-2.5-flash');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('https://api.openai.com/v1');
  const [geminiBaseUrl, setGeminiBaseUrl] = useState('https://generativelanguage.googleapis.com');
  const [multimodalStatus, setMultimodalStatus] = useState<MultimodalStatus>('idle');
  const [multimodalMessage, setMultimodalMessage] = useState('');

  // --- background ---
  const [bgEnabled, setBgEnabled] = useState(false);
  const [bgType, setBgType] = useState<'upload' | 'url'>('upload');
  const [bgUrl, setBgUrl] = useState('');
  const [bgImageData, setBgImageData] = useState('');
  const [bgOpacity, setBgOpacity] = useState(DEFAULT_BACKGROUND_OPACITY);
  const [appearanceMessage, setAppearanceMessage] = useState('');

  // --- pet ---
  const [petEnabled, setPetEnabled] = useState(DEFAULT_PET_CONFIG.enabled);
  const [petPosition, setPetPosition] = useState<PetPosition>(DEFAULT_PET_CONFIG.position);
  const [petSize, setPetSize] = useState(DEFAULT_PET_CONFIG.size);
  const [petOpacity, setPetOpacity] = useState(DEFAULT_PET_CONFIG.opacity);
  const [petMotion, setPetMotion] = useState(DEFAULT_PET_CONFIG.motion);

  // --- sync ---
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(DEFAULT_SYNC_CONFIG);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncMessage, setSyncMessage] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgConfigRef = useRef<BackgroundConfig>(DEFAULT_BACKGROUND_CONFIG);
  const petConfigRef = useRef<PetConfig>(DEFAULT_PET_CONFIG);
  const loadGenerationRef = useRef(0);

  const bgPreview = bgType === 'url' ? bgUrl : bgImageData;
  const syncBusy = syncStatus === 'testing' || syncStatus === 'uploading' || syncStatus === 'downloading';

  const syncBgState = useCallback((config: BackgroundConfig) => {
    bgConfigRef.current = config;
    setBgEnabled(config.enabled);
    setBgType(config.type);
    setBgUrl(config.url ?? '');
    setBgImageData(config.imageData ?? '');
    setBgOpacity(config.opacity);
  }, []);

  const syncPetState = useCallback((config: PetConfig) => {
    petConfigRef.current = config;
    setPetEnabled(config.enabled);
    setPetPosition(config.position);
    setPetSize(config.size);
    setPetOpacity(config.opacity);
    setPetMotion(config.motion);
  }, []);

  const syncMultimodalStatus = useCallback((status: MultimodalSettingsStatus) => {
    setMultimodalConfigured(status);
    setOpenaiImageModel(status.openaiImageModel);
    setGeminiVideoModel(status.geminiVideoModel);
    setOpenaiBaseUrl(status.openaiBaseUrl);
    setGeminiBaseUrl(status.geminiBaseUrl);
  }, []);

  const loadSettingsState = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setLoading(true);

    const [
      chatOnResult,
      keyStatusResult,
      mmStatusResult,
      memoriesResult,
      cfgResult,
      syncCfgResult,
      modelTypeResult,
      bgCfgResult,
      petCfgResult,
      personalResult,
    ] = await Promise.allSettled([
      Promise.resolve().then(() => getChatEnabled()),
      Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'GET_DEEPSEEK_API_KEY_STATUS' })),
      Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'GET_MULTIMODAL_SETTINGS_STATUS' })),
      Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'GET_MEMORIES' })),
      Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'GET_CONFIG' })),
      Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'GET_SYNC_CONFIG' })),
      Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'GET_MODEL_TYPE' })),
      Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'GET_BACKGROUND' })),
      Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'GET_PET' })),
      Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'GET_PERSONAL_CONVENIENCE_CONFIG' })),
    ]);

    if (loadGenerationRef.current !== generation) return;

    const issues: SettingsLoadIssue[] = [];
    const chatOn = readSettingsLoadResult(chatOnResult, 'sidepanel-chat', issues, false);
    const keyStatus = readSettingsLoadResult(keyStatusResult, 'api-key', issues, undefined);
    const mmStatus = readSettingsLoadResult(mmStatusResult, 'multimodal', issues, undefined);
    const memories = readSettingsLoadResult(memoriesResult, 'memory', issues, [] as Memory[]);
    const cfg = readSettingsLoadResult(cfgResult, 'version', issues, undefined);
    const syncCfg = readSettingsLoadResult(syncCfgResult, 'sync', issues, null);
    const modelType = readSettingsLoadResult(modelTypeResult, 'model', issues, null);
    const bgCfg = readSettingsLoadResult(bgCfgResult, 'background', issues, null);
    const petCfg = readSettingsLoadResult(petCfgResult, 'pet', issues, null);
    const personal = readSettingsLoadResult(personalResult, 'personal-defaults', issues, null);

    setChatEnabledState(chatOn);
    setApiKeyConfigured((keyStatus as { configured?: boolean } | undefined)?.configured === true);
    const mm = mmStatus as ({ ok?: boolean } & MultimodalSettingsStatus) | undefined;
    if (mm?.ok) syncMultimodalStatus(mm);
    setMemoryCount((memories as Memory[] | null)?.length ?? 0);
    setVersion((cfg as { version?: string } | undefined)?.version ?? '');
    if (syncCfg) setSyncConfig(syncCfg as SyncConfig);
    setExpertMode(modelType === 'expert');
    const normalizedBg = normalizeBackgroundConfig(bgCfg as BackgroundConfig | null);
    if (normalizedBg) syncBgState(normalizedBg);
    syncPetState(normalizePetConfig(petCfg as PetConfig | null));
    setPersonalConfig(normalizePersonalConvenienceConfig((personal as { config?: unknown } | null)?.config));
    setLoadIssues(issues);
    setLoading(false);
  }, [syncBgState, syncPetState, syncMultimodalStatus]);

  // --- initial load ---
  useEffect(() => {
    void loadSettingsState();

    const handlePetUpdate = (message: { type?: string; config?: PetConfig | null }) => {
      if (message.type === 'PET_UPDATED') {
        syncPetState(normalizePetConfig(message.config));
      }
    };
    chrome.runtime.onMessage.addListener(handlePetUpdate);
    return () => {
      loadGenerationRef.current += 1;
      chrome.runtime.onMessage.removeListener(handlePetUpdate);
    };
  }, [syncPetState, loadSettingsState]);

  // --- expert mode ---
  const handleExpertToggle = useCallback(async (enabled: boolean, saveFailed: string) => {
    const previous = expertMode;
    setExpertMode(enabled);
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'SET_MODEL_TYPE',
        payload: enabled ? 'expert' : null,
      });
      if (isRuntimeFailure(result)) throw new Error(getRuntimeActionFailureMessage(result, saveFailed));
      setGeneralMessage('');
    } catch (error) {
      setExpertMode(previous);
      setGeneralMessage(getSettingsActionIssueMessage(error, saveFailed));
    }
  }, [expertMode]);

  // --- sidepanel chat ---
  const handleChatToggle = useCallback(async (next: boolean, saveFailed: string) => {
    const previous = chatEnabled;
    setChatEnabledState(next);
    try {
      await setChatEnabled(next);
      setGeneralMessage('');
    } catch (error) {
      setChatEnabledState(previous);
      setGeneralMessage(getSettingsActionIssueMessage(error, saveFailed));
    }
  }, [chatEnabled]);

  const handlePersonalConveniencePatch = useCallback(async (patch: Partial<PersonalConvenienceConfig>, saveFailed: string) => {
    const previous = personalConfig;
    const optimistic = normalizePersonalConvenienceConfig({ ...personalConfig, ...patch });
    setPersonalConfig(optimistic);
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'SAVE_PERSONAL_CONVENIENCE_CONFIG',
        payload: patch,
      });
      if (isRuntimeFailure(result)) throw new Error(getRuntimeActionFailureMessage(result, saveFailed));
      setPersonalConfig(normalizePersonalConvenienceConfig(result?.config ?? optimistic));
      setGeneralMessage('');
    } catch (error) {
      setPersonalConfig(previous);
      setGeneralMessage(getSettingsActionIssueMessage(error, saveFailed));
    }
  }, [personalConfig]);

  // --- deepseek api key ---
  const handleSaveApiKey = useCallback(
    async (labels: {
      apiKeyRequired: string;
      saveFailed: string;
      apiKeySaved: string;
    }) => {
      const apiKey = apiKeyInput.trim();
      if (!apiKey) {
        setApiKeyStatus('error');
        setApiKeyMessage(labels.apiKeyRequired);
        return;
      }
      setApiKeyStatus('saving');
      setApiKeyMessage('');
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'SAVE_DEEPSEEK_API_KEY',
          payload: { apiKey },
        });
        if (!result?.ok) throw new Error(getRuntimeActionFailureMessage(result, labels.saveFailed));
        if (!chatEnabled) {
          await setChatEnabled(true);
          setChatEnabledState(true);
        }
        setApiKeyConfigured(true);
        setApiKeyInput('');
        setApiKeyStatus('success');
        setApiKeyMessage(labels.apiKeySaved);
      } catch (error) {
        setApiKeyStatus('error');
        setApiKeyMessage(getSettingsActionIssueMessage(error, labels.saveFailed));
      }
    },
    [apiKeyInput, chatEnabled],
  );

  const handleClearApiKey = useCallback(
    async (clearFailed: string, apiKeyCleared: string) => {
      setApiKeyStatus('clearing');
      setApiKeyMessage('');
      try {
        const result = await chrome.runtime.sendMessage({ type: 'CLEAR_DEEPSEEK_API_KEY' });
        if (!result?.ok) throw new Error(getRuntimeActionFailureMessage(result, clearFailed));
        setApiKeyConfigured(false);
        setApiKeyInput('');
        setApiKeyStatus('success');
        setApiKeyMessage(apiKeyCleared);
      } catch (error) {
        setApiKeyStatus('error');
        setApiKeyMessage(getSettingsActionIssueMessage(error, clearFailed));
      }
    },
    [],
  );

  // --- multimodal ---
  const isHttpBaseUrl = useCallback((value: string) => {
    try {
      const url = new URL(value.trim());
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, []);

  const handleSaveMultimodal = useCallback(
    async (labels: { baseUrlInvalid: string; saveFailed: string; saved: string }) => {
      setMultimodalStatus('saving');
      setMultimodalMessage('');
      try {
        if (!isHttpBaseUrl(openaiBaseUrl) || !isHttpBaseUrl(geminiBaseUrl)) {
          throw new Error(labels.baseUrlInvalid);
        }
        const payload: Record<string, string> = {
          openaiImageModel,
          geminiVideoModel,
          openaiBaseUrl,
          geminiBaseUrl,
        };
        if (openaiApiKeyInput.trim()) payload.openaiApiKey = openaiApiKeyInput.trim();
        if (geminiApiKeyInput.trim()) payload.geminiApiKey = geminiApiKeyInput.trim();
        const result = await chrome.runtime.sendMessage({
          type: 'SAVE_MULTIMODAL_SETTINGS',
          payload,
        });
        if (!result?.ok) throw new Error(getRuntimeActionFailureMessage(result, labels.saveFailed));
        syncMultimodalStatus(result as MultimodalSettingsStatus);
        setOpenaiApiKeyInput('');
        setGeminiApiKeyInput('');
        setMultimodalStatus('success');
        setMultimodalMessage(labels.saved);
      } catch (error) {
        setMultimodalStatus('error');
        setMultimodalMessage(getSettingsActionIssueMessage(error, labels.saveFailed));
      }
    },
    [openaiBaseUrl, geminiBaseUrl, openaiImageModel, geminiVideoModel, openaiApiKeyInput, geminiApiKeyInput, isHttpBaseUrl, syncMultimodalStatus],
  );

  const handleClearMultimodal = useCallback(
    async (labels: { clearFailed: string; cleared: string }) => {
      setMultimodalStatus('clearing');
      setMultimodalMessage('');
      try {
        const result = await chrome.runtime.sendMessage({ type: 'CLEAR_MULTIMODAL_SETTINGS' });
        if (!result?.ok) throw new Error(getRuntimeActionFailureMessage(result, labels.clearFailed));
        syncMultimodalStatus(result as MultimodalSettingsStatus);
        setOpenaiApiKeyInput('');
        setGeminiApiKeyInput('');
        setMultimodalStatus('success');
        setMultimodalMessage(labels.cleared);
      } catch (error) {
        setMultimodalStatus('error');
        setMultimodalMessage(getSettingsActionIssueMessage(error, labels.clearFailed));
      }
    },
    [syncMultimodalStatus],
  );

  // --- background ---
  const saveBgConfig = useCallback(async (patch: Partial<BackgroundConfig>, saveFailed: string) => {
    const previous = bgConfigRef.current;
    const config = normalizeBackgroundConfig({
      ...bgConfigRef.current,
      ...patch,
    });
    if (!config) return;
    bgConfigRef.current = config;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'SAVE_BACKGROUND', payload: config });
      if (isRuntimeFailure(result)) throw new Error(getRuntimeActionFailureMessage(result, saveFailed));
      setAppearanceMessage('');
    } catch (error) {
      syncBgState(previous);
      setAppearanceMessage(getSettingsActionIssueMessage(error, saveFailed));
    }
  }, [syncBgState]);

  const handleBgToggle = useCallback(
    async (enabled: boolean, saveFailed: string) => {
      setBgEnabled(enabled);
      await saveBgConfig({ enabled }, saveFailed);
    },
    [saveBgConfig],
  );

  const resizeImage = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const MAX = 1920;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const scale = Math.min(MAX / width, MAX / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image'));
      };
      img.src = objectUrl;
    });
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, saveFailed: string) => {
      const file = e.target.files?.[0];
      if (!file) return;
      let data: string;
      try {
        data = await resizeImage(file);
      } catch {
        return;
      }
      setBgType('upload');
      setBgImageData(data);
      setBgEnabled(true);
      await saveBgConfig({ enabled: true, type: 'upload', imageData: data, url: '' }, saveFailed);
      e.target.value = '';
    },
    [resizeImage, saveBgConfig],
  );

  const handleUrlConfirm = useCallback(async (saveFailed: string) => {
    if (!bgUrl.trim()) return;
    setBgType('url');
    setBgImageData('');
    setBgEnabled(true);
    await saveBgConfig({ enabled: true, type: 'url', url: bgUrl, imageData: '' }, saveFailed);
  }, [bgUrl, saveBgConfig]);

  const handleOpacityChange = useCallback(
    (val: number, saveFailed: string) => {
      const opacity = clampBackgroundOpacity(val);
      setBgOpacity(opacity);
      void saveBgConfig({ opacity }, saveFailed);
    },
    [saveBgConfig],
  );

  const handleClearBg = useCallback(async (clearFailed: string) => {
    const previous = bgConfigRef.current;
    setBgEnabled(false);
    setBgType('upload');
    setBgUrl('');
    setBgImageData('');
    setBgOpacity(DEFAULT_BACKGROUND_OPACITY);
    bgConfigRef.current = DEFAULT_BACKGROUND_CONFIG;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'CLEAR_BACKGROUND' });
      if (isRuntimeFailure(result)) throw new Error(getRuntimeActionFailureMessage(result, clearFailed));
      setAppearanceMessage('');
    } catch (error) {
      syncBgState(previous);
      setAppearanceMessage(getSettingsActionIssueMessage(error, clearFailed));
    }
  }, [syncBgState]);

  // --- pet ---
  const savePetConfig = useCallback(async (patch: Partial<PetConfig>, saveFailed: string) => {
    const previous = petConfigRef.current;
    const config = normalizePetConfig({
      ...petConfigRef.current,
      ...patch,
    });
    petConfigRef.current = config;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'SAVE_PET', payload: config });
      if (isRuntimeFailure(result)) throw new Error(getRuntimeActionFailureMessage(result, saveFailed));
      setAppearanceMessage('');
    } catch (error) {
      syncPetState(previous);
      setAppearanceMessage(getSettingsActionIssueMessage(error, saveFailed));
    }
  }, [syncPetState]);

  const handlePetToggle = useCallback(
    async (enabled: boolean, saveFailed: string) => {
      setPetEnabled(enabled);
      await savePetConfig({ enabled }, saveFailed);
    },
    [savePetConfig],
  );

  const handlePetPositionChange = useCallback(
    async (position: Exclude<PetPosition, 'custom'>, saveFailed: string) => {
      setPetPosition(position);
      await savePetConfig({ position }, saveFailed);
    },
    [savePetConfig],
  );

  const handlePetSizeChange = useCallback(
    (value: number, saveFailed: string) => {
      const size = clampPetSize(value);
      setPetSize(size);
      void savePetConfig({ size }, saveFailed);
    },
    [savePetConfig],
  );

  const handlePetOpacityChange = useCallback(
    (value: number, saveFailed: string) => {
      const opacity = clampPetOpacity(value);
      setPetOpacity(opacity);
      void savePetConfig({ opacity }, saveFailed);
    },
    [savePetConfig],
  );

  const handlePetMotionToggle = useCallback(
    async (motion: boolean, saveFailed: string) => {
      setPetMotion(motion);
      await savePetConfig({ motion }, saveFailed);
    },
    [savePetConfig],
  );

  // --- sync ---
  const updateSyncField = useCallback((field: keyof SyncConfig, value: string) => {
    setSyncConfig((prev) => ({ ...prev, [field]: value }));
  }, []);

  const requestPermission = useCallback(async (url: string): Promise<boolean> => {
    try {
      const origin = new URL(url).origin + '/*';
      return await chrome.permissions.request({ origins: [origin] });
    } catch {
      return false;
    }
  }, []);

  const runSyncAction = useCallback(
    async (
      status: 'testing' | 'uploading' | 'downloading',
      action: () => Promise<void>,
      labels: { permissionDenied: string; operationFailed: string },
    ) => {
      if (!syncConfig.url) return;
      setSyncStatus(status);
      setSyncMessage('');
      const granted = await requestPermission(syncConfig.url);
      if (!granted) {
        setSyncStatus('error');
        setSyncMessage(labels.permissionDenied);
        return;
      }
      try {
        const saveResult = await chrome.runtime.sendMessage({ type: 'SAVE_SYNC_CONFIG', payload: syncConfig });
        if (isRuntimeFailure(saveResult)) {
          throw new Error(getRuntimeActionFailureMessage(saveResult, labels.operationFailed));
        }
        await action();
      } catch (e) {
        setSyncStatus('error');
        setSyncMessage(getSettingsActionIssueMessage(e, labels.operationFailed));
      }
    },
    [syncConfig, requestPermission],
  );

  const handleTestSync = useCallback(
    (labels: {
      permissionDenied: string;
      operationFailed: string;
      success: string;
      failed: string;
    }) => {
      void runSyncAction('testing', async () => {
        const result = await chrome.runtime.sendMessage({ type: 'WEBDAV_TEST', payload: syncConfig });
        if (result?.ok) {
          setSyncStatus('success');
          setSyncMessage(labels.success);
        } else {
          throw new Error(getRuntimeActionFailureMessage(result, labels.failed));
        }
      }, labels);
    },
    [runSyncAction, syncConfig],
  );

  const handleUploadSync = useCallback(
    (labels: {
      permissionDenied: string;
      operationFailed: string;
      failed: string;
      success: (counts?: SyncCounts) => string;
    }) => {
      void runSyncAction('uploading', async () => {
        const result = await chrome.runtime.sendMessage({ type: 'WEBDAV_UPLOAD_LOCAL' });
        if (result?.ok) {
          setSyncConfig((prev) => ({ ...prev, lastSyncAt: result.lastSyncAt }));
          setSyncStatus('success');
          setSyncMessage(labels.success(result.counts));
        } else {
          throw new Error(getRuntimeActionFailureMessage(result, labels.failed));
        }
      }, labels);
    },
    [runSyncAction],
  );

  const handleDownloadSync = useCallback(
    (labels: {
      permissionDenied: string;
      operationFailed: string;
      failed: string;
      success: (counts?: SyncCounts) => string;
    }) => {
      void runSyncAction('downloading', async () => {
        const result = await chrome.runtime.sendMessage({ type: 'WEBDAV_DOWNLOAD_REMOTE' });
        if (result?.ok) {
          setSyncConfig((prev) => ({ ...prev, lastSyncAt: result.lastSyncAt }));
          setSyncStatus('success');
          setSyncMessage(labels.success(result.counts));
          setMemoryCount(result.counts?.memories ?? 0);
        } else {
          throw new Error(getRuntimeActionFailureMessage(result, labels.failed));
        }
      }, labels);
    },
    [runSyncAction],
  );

  // --- data ---
  const handleExport = useCallback(async () => {
    const memories: Memory[] = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
    const blob = new Blob([JSON.stringify(memories, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deepseek-pp-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = useCallback(
    async (
      labels: { arrayError: string; jsonError: string },
      onResult?: (result: { ok: boolean; imported?: number; error?: string }) => void,
    ) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const text = await file.text();
        try {
          const parsed: unknown = JSON.parse(text);
          if (!Array.isArray(parsed)) {
            throw new Error(labels.arrayError);
          }
          const memories = parsed.map((mem, index) => validateImportedMemory(mem, `memories[${index}]`));
          for (const memory of memories) {
            await chrome.runtime.sendMessage({ type: 'SAVE_MEMORY', payload: memory });
          }
          setMemoryCount((c) => c + memories.length);
          onResult?.({ ok: true, imported: memories.length });
        } catch (error) {
          onResult?.({ ok: false, error: error instanceof Error ? error.message : labels.jsonError });
        }
      };
      input.click();
    },
    [],
  );

  const handleClearAllMemories = useCallback(async () => {
    const memories: Memory[] = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
    for (const mem of memories) {
      await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id: mem.id } });
    }
    setMemoryCount(0);
  }, []);

  return {
    // shared
    loading,
    loadIssues,
    retryLoad: loadSettingsState,
    memoryCount,
    version,
    expertMode,
    chatEnabled,
    personalConfig,
    generalMessage,
    handleExpertToggle,
    handleChatToggle,
    handlePersonalConveniencePatch,
    // deepseek api key
    apiKeyConfigured,
    apiKeyInput,
    setApiKeyInput,
    apiKeyStatus,
    apiKeyMessage,
    handleSaveApiKey,
    handleClearApiKey,
    // multimodal
    multimodalConfigured,
    openaiApiKeyInput,
    setOpenaiApiKeyInput,
    geminiApiKeyInput,
    setGeminiApiKeyInput,
    openaiImageModel,
    setOpenaiImageModel,
    geminiVideoModel,
    setGeminiVideoModel,
    openaiBaseUrl,
    setOpenaiBaseUrl,
    geminiBaseUrl,
    setGeminiBaseUrl,
    multimodalStatus,
    multimodalMessage,
    handleSaveMultimodal,
    handleClearMultimodal,
    // background
    bgEnabled,
    bgType,
    bgUrl,
    setBgUrl,
    bgImageData,
    bgOpacity,
    bgPreview,
    appearanceMessage,
    fileInputRef,
    handleBgToggle,
    handleFileSelect,
    handleUrlConfirm,
    handleOpacityChange,
    handleClearBg,
    // pet
    petEnabled,
    petPosition,
    petSize,
    petOpacity,
    petMotion,
    handlePetToggle,
    handlePetPositionChange,
    handlePetSizeChange,
    handlePetOpacityChange,
    handlePetMotionToggle,
    // sync
    syncConfig,
    updateSyncField,
    syncStatus,
    syncBusy,
    syncMessage,
    handleTestSync,
    handleUploadSync,
    handleDownloadSync,
    // data
    handleExport,
    handleImport,
    handleClearAllMemories,
  };
}

export type SettingsState = ReturnType<typeof useSettingsState>;
