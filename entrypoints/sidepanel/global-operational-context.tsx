import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createGlobalOperationalContext,
  type GlobalOperationalContext,
} from '../../core/operational-context';
import { PROJECT_CONTEXT_SCHEMA_VERSION, type CurrentDeepSeekConversation, type ProjectContextState } from '../../core/project';
import type { RuntimeDoctorReport } from '../../core/chat/runtime-doctor';
import { normalizePromptInjectionSettings, type PromptInjectionSettings } from '../../core/prompt/settings';
import type { ToolRegistrySnapshot } from '../../core/tool/types';

interface GlobalOperationalContextValue {
  context: GlobalOperationalContext;
  projectState: ProjectContextState | null;
  currentConversation: CurrentDeepSeekConversation | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const DEFAULT_CONTEXT = createGlobalOperationalContext({
  chromeAvailable: false,
  now: 0,
});

const GlobalOperationalContextContext = createContext<GlobalOperationalContextValue>({
  context: DEFAULT_CONTEXT,
  projectState: null,
  currentConversation: null,
  loading: false,
  async refresh() {},
});

const STORAGE_REFRESH_KEYS = new Set([
  'deepseek_pp_chat_enabled',
  'deepseek_pp_personal_convenience',
  'deepseek_pp_prompt_injection_settings',
  'deepseek_pp_project_context',
  'deepseek_pp_browser_control_settings',
  'deepseek_pp_web_tool_settings',
  'deepseek_pp_mcp_servers',
]);

const MESSAGE_REFRESH_TYPES = new Set([
  'STATE_UPDATED',
  'PROJECT_CONTEXT_UPDATED',
  'AUTH_STATUS_CHANGED',
  'BROWSER_CONTROL_UPDATED',
  'TOOL_DESCRIPTORS_UPDATED',
  'MCP_SERVERS_UPDATED',
]);

export function GlobalOperationalContextProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<GlobalOperationalContext>(DEFAULT_CONTEXT);
  const [projectState, setProjectState] = useState<ProjectContextState | null>(null);
  const [currentConversation, setCurrentConversation] = useState<CurrentDeepSeekConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const refreshId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRefresh = refreshId.current + 1;
    refreshId.current = currentRefresh;
    setLoading(true);
    const next = await loadGlobalOperationalContext();
    if (mounted.current && refreshId.current === currentRefresh) {
      setContext(next.context);
      setProjectState(next.projectState);
      setCurrentConversation(next.currentConversation);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();

    const runtime = getChromeRuntime();
    const storage = getChromeStorage();
    const messageHandler = (message: { type?: string }) => {
      if (message.type && MESSAGE_REFRESH_TYPES.has(message.type)) {
        void refresh();
      }
    };
    const storageHandler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return;
      if (Object.keys(changes).some((key) => STORAGE_REFRESH_KEYS.has(key))) {
        void refresh();
      }
    };

    runtime?.onMessage?.addListener(messageHandler);
    storage?.onChanged?.addListener(storageHandler);

    return () => {
      mounted.current = false;
      runtime?.onMessage?.removeListener(messageHandler);
      storage?.onChanged?.removeListener(storageHandler);
    };
  }, [refresh]);

  return (
    <GlobalOperationalContextContext.Provider value={{
      context,
      projectState,
      currentConversation,
      loading,
      refresh,
    }}>
      {children}
    </GlobalOperationalContextContext.Provider>
  );
}

export function useGlobalOperationalContext(): GlobalOperationalContextValue {
  return useContext(GlobalOperationalContextContext);
}

interface LoadedGlobalOperationalContext {
  context: GlobalOperationalContext;
  projectState: ProjectContextState | null;
  currentConversation: CurrentDeepSeekConversation | null;
}

async function loadGlobalOperationalContext(): Promise<LoadedGlobalOperationalContext> {
  const runtime = getChromeRuntime();
  if (!runtime?.sendMessage) {
    return {
      context: createGlobalOperationalContext({
        chromeAvailable: false,
      }),
      projectState: null,
      currentConversation: null,
    };
  }

  const [
    runtimeDoctorReport,
    projectState,
    currentConversation,
    promptSettings,
    toolRegistry,
  ] = await Promise.all([
    sendChromeMessage<RuntimeDoctorReport>({ type: 'GET_RUNTIME_DOCTOR_REPORT' }).then((value) =>
      isRuntimeDoctorReport(value) ? value : null,
    ),
    sendChromeMessage<ProjectContextState>({ type: 'GET_PROJECT_CONTEXT_STATE' }).then((value) =>
      isProjectContextState(value) ? value : null,
    ),
    sendChromeMessage<{ ok?: boolean; conversation?: CurrentDeepSeekConversation }>({ type: 'GET_CURRENT_DEEPSEEK_CONVERSATION' })
      .then((value) => value?.ok === true && isCurrentConversation(value.conversation) ? value.conversation : null),
    sendChromeMessage<PromptInjectionSettings>({ type: 'GET_PROMPT_INJECTION_SETTINGS' }).then((value) =>
      value ? normalizePromptInjectionSettings(value) : null,
    ),
    sendChromeMessage<ToolRegistrySnapshot>({ type: 'GET_TOOL_DESCRIPTORS' }).then((value) =>
      isToolRegistrySnapshot(value) ? value : null,
    ),
  ]);

  return {
    context: createGlobalOperationalContext({
      chromeAvailable: true,
      runtimeDoctorReport,
      projectState,
      currentConversation,
      promptSettings,
      toolRegistry,
    }),
    projectState,
    currentConversation,
  };
}

async function sendChromeMessage<T>(message: Record<string, unknown>): Promise<T | null> {
  const runtime = getChromeRuntime();
  if (!runtime?.sendMessage) return null;
  try {
    return await runtime.sendMessage(message) as T;
  } catch {
    return null;
  }
}

function getChromeRuntime(): typeof chrome.runtime | null {
  try {
    if (typeof chrome === 'undefined') return null;
    return chrome.runtime ?? null;
  } catch {
    return null;
  }
}

function getChromeStorage(): typeof chrome.storage | null {
  try {
    if (typeof chrome === 'undefined') return null;
    return chrome.storage ?? null;
  } catch {
    return null;
  }
}

function isRuntimeDoctorReport(value: unknown): value is RuntimeDoctorReport {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RuntimeDoctorReport>;
  return record.ok === true && typeof record.generatedAt === 'number' && !!record.readiness;
}

function isProjectContextState(value: unknown): value is ProjectContextState {
  if (!value || typeof value !== 'object') return false;
  const state = value as ProjectContextState;
  return state.schemaVersion === PROJECT_CONTEXT_SCHEMA_VERSION &&
    Array.isArray(state.projects) &&
    Array.isArray(state.conversations) &&
    (state.pendingProjectId === null || typeof state.pendingProjectId === 'string');
}

function isCurrentConversation(value: unknown): value is CurrentDeepSeekConversation {
  if (!value || typeof value !== 'object') return false;
  const conversation = value as CurrentDeepSeekConversation;
  return typeof conversation.conversationId === 'string' &&
    typeof conversation.title === 'string' &&
    typeof conversation.url === 'string';
}

function isToolRegistrySnapshot(value: unknown): value is ToolRegistrySnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as ToolRegistrySnapshot;
  return Array.isArray(snapshot.providers) &&
    Array.isArray(snapshot.tools) &&
    typeof snapshot.refreshedAt === 'number';
}
