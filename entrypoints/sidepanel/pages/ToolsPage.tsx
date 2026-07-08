import { useEffect, useState, type ReactNode } from 'react';
import { SHELL_MCP_NATIVE_HOST, SHELL_MCP_SERVER_NAME, createShellMcpPresetInput } from '../../../core/shell';
import { isShellNativeHostSupported } from '../../../core/platform';
import type { LocaleMessageKey } from '../../../core/i18n';
import type { McpServerConfig, McpToolAllowlist, McpToolCacheEntry, PlatformEnvironment, ToolDescriptor } from '../../../core/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import PageIntro from '../components/PageIntro';
import { SettingsSection, StatusMessage, TextField, ToggleRow } from '../components/settings/primitives';
import { useI18n } from '../i18n';
import { getSafeRuntimeIssueMessage } from '../runtime-response';

type PermissionState = 'idle' | 'granting' | 'granted' | 'denied' | 'error';
type DiagState = 'idle' | 'running' | 'done' | 'err';
type DiagResult = Record<string, { status: number; length: number; error?: string; preview?: string }>;
type PythonBusyState = 'idle' | 'creating' | 'refreshing' | 'toggling';
type ToolsStatusState = 'checking' | 'ready' | 'attention' | 'empty';

const DEFAULT_SHELL_SUPPORT_TOOL_NAMES = ['shell_status', 'python_status', 'local_skill_preview', 'local_folder_pick'] as const;
const PAGE_TOOLS_PYTHON_TOOL_NAMES = ['python_status', 'python_exec'] as const;

function DiagSearch() {
  const { t } = useI18n();
  const [query, setQuery] = useState(t('sidepanel.toolsPage.diagnosticsDefaultQuery'));
  const [state, setState] = useState<DiagState>('idle');
  const [result, setResult] = useState<DiagResult | null>(null);

  const run = async () => {
    setState('running');
    setResult(null);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DIAGNOSE_WEB_SEARCH', payload: { query } });
      setResult(res as DiagResult);
      setState('done');
    } catch {
      setState('err');
    }
  };

  return (
    <div className="ds-tools-diagnostic">
      <TextField
        label={t('sidepanel.toolsPage.diagnosticsQuery')}
        value={query}
        onChange={(value) => setQuery(value)}
        onKeyDown={(e) => e.key === 'Enter' && run()}
        trailing={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={run}
            disabled={state === 'running' || !query.trim()}
            className="ds-btn-secondary"
          >
            {state === 'running' ? t('sidepanel.toolsPage.diagnosticsRunning') : t('sidepanel.toolsPage.diagnosticsRun')}
          </Button>
        )}
      />
      {result && (
        <div className="ds-tool-result-list">
          {Object.entries(result).map(([domain, info]) => {
            const reachable = info.status >= 200 && info.status < 400;
            return (
              <div key={domain} className="ds-tool-result-row" data-tone={reachable ? 'info' : 'error'}>
                <div className="ds-tool-result-head">
                  <span className="ds-tool-result-title">{domain}</span>
                  <span className="ds-tool-result-state">
                    {reachable ? t('sidepanel.toolsPage.diagnosticsReachable') : t('sidepanel.toolsPage.diagnosticsFailed')}
                  </span>
                </div>
                <div className="ds-tool-result-meta">
                  {t('sidepanel.toolsPage.diagnosticsResultMeta', {
                    status: info.status,
                    bytes: info.length,
                  })}
                  {info.error ? ` · ${t('sidepanel.toolsPage.errorPrefix', { error: info.error })}` : ''}
                </div>
                {info.preview && (
                  <details className="ds-tool-preview">
                    <summary>{t('sidepanel.toolsPage.diagnosticsPreview')}</summary>
                    <div>{info.preview.slice(0, 300)}</div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
      {state === 'err' && (
        <StatusMessage tone="error">{t('sidepanel.toolsPage.diagnosticsUnavailable')}</StatusMessage>
      )}
    </div>
  );
}

function ToolToggleRow({
  title,
  description,
  enabled,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div className="ds-tool-row">
      <ToggleRow
        title={title}
        description={description}
        enabled={enabled}
        onToggle={onToggle}
      />
    </div>
  );
}

function ToolsStatusCard({
  settings,
  webSettingsLoading,
  webSettingsError,
  pythonLoading,
  pythonServer,
  pythonCache,
  pythonBusy,
  pythonLoadError,
  nativeMessagingSupported,
  onRetry,
}: {
  settings: Record<ToolKey, boolean>;
  webSettingsLoading: boolean;
  webSettingsError: string;
  pythonLoading: boolean;
  pythonServer: McpServerConfig | null;
  pythonCache: McpToolCacheEntry | null;
  pythonBusy: PythonBusyState;
  pythonLoadError: string;
  nativeMessagingSupported: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const pythonExec = pythonCache?.descriptors.find((tool) => tool.name === 'python_exec') ?? null;
  const pythonEnabled = Boolean(pythonServer && pythonExec && isMcpToolEnabled(pythonServer, pythonExec));
  const webEnabledCount = TOOLS.filter((tool) => settings[tool.key]).length;
  const isChecking = webSettingsLoading || pythonLoading || pythonBusy !== 'idle';
  const hasIssue = Boolean(webSettingsError || pythonLoadError);
  const hasAnyToolEnabled = webEnabledCount > 0 || pythonEnabled;
  const state: ToolsStatusState = isChecking ? 'checking' : hasIssue ? 'attention' : hasAnyToolEnabled ? 'ready' : 'empty';
  const badgeVariant = state === 'attention' ? 'destructive' : state === 'empty' ? 'outline' : 'secondary';
  const badgeLabel = state === 'checking'
    ? t('sidepanel.toolsPage.statusChecking')
    : state === 'attention'
      ? t('sidepanel.toolsPage.statusNeedsAttention')
      : state === 'empty'
        ? t('sidepanel.toolsPage.statusNoTools')
        : t('sidepanel.toolsPage.statusReady');
  const description = state === 'checking'
    ? t('sidepanel.toolsPage.statusCheckingDescription')
    : state === 'attention'
      ? t('sidepanel.toolsPage.statusNeedsAttentionDescription')
      : state === 'empty'
        ? t('sidepanel.toolsPage.statusNoToolsDescription')
        : t('sidepanel.toolsPage.statusReadyDescription');
  const webState = webSettingsError
    ? webSettingsError
    : t('sidepanel.toolsPage.statusWebSummary', {
      search: settings.web_search ? t('common.on') : t('common.off'),
      read: settings.web_fetch ? t('common.on') : t('common.off'),
    });
  const localState = pythonLoadError
    ? pythonLoadError
    : !pythonServer
      ? nativeMessagingSupported
        ? t('sidepanel.toolsPage.pythonStatusNoShell')
        : t('sidepanel.toolsPage.pythonStatusUnsupported')
      : !pythonCache
        ? t('sidepanel.toolsPage.pythonStatusNoCache')
        : pythonExec
          ? pythonEnabled ? t('sidepanel.toolsPage.pythonStatusEnabled') : t('sidepanel.toolsPage.pythonStatusDiscovered')
          : t('sidepanel.toolsPage.pythonStatusMissing');
  const next = webSettingsError
    ? t('sidepanel.toolsPage.statusNextRetryWeb')
    : pythonLoadError
      ? t('sidepanel.toolsPage.statusNextRetryLocal')
      : state === 'empty'
        ? t('sidepanel.toolsPage.statusNextEnableTool')
        : t('sidepanel.toolsPage.statusNextUseTools');
  const canRetry = Boolean(webSettingsError || pythonLoadError);

  return (
    <Card
      size="sm"
      className="ds-tools-status-card"
      data-state={state}
      aria-live="polite"
      aria-busy={isChecking ? true : undefined}
    >
      <CardHeader>
        <CardTitle>{t('sidepanel.toolsPage.statusCardTitle')}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isChecking ? (
          <div className="ds-tools-status-skeleton" aria-hidden="true">
            <Skeleton className="ds-tools-status-skeleton-line" />
            <Skeleton className="ds-tools-status-skeleton-line" />
          </div>
        ) : (
          <div className="ds-tools-status-rows">
            <div className="ds-tools-status-row">
              <span>{t('sidepanel.toolsPage.statusWebTools')}</span>
              <strong>{webState}</strong>
            </div>
            <div className="ds-tools-status-row">
              <span>{t('sidepanel.toolsPage.statusLocalTools')}</span>
              <strong>{localState}</strong>
            </div>
            <div className="ds-tools-status-row">
              <span>{t('sidepanel.toolsPage.statusNext')}</span>
              <strong>{next}</strong>
            </div>
          </div>
        )}
        {canRetry && !isChecking && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ds-tools-status-retry"
            onClick={onRetry}
          >
            {t('common.retry')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ToolsDisclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="ds-tools-disclosure">
      <summary>{title}</summary>
      <div className="ds-tools-disclosure-body">
        {children}
      </div>
    </details>
  );
}

function SiteAccessPanel({
  url,
  state,
  allSitesState,
  onUrlChange,
  onGrant,
  onGrantAll,
}: {
  url: string;
  state: PermissionState;
  allSitesState: PermissionState;
  onUrlChange: (url: string) => void;
  onGrant: () => void;
  onGrantAll: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="ds-tools-site-access">
      <TextField
        label={t('sidepanel.toolsPage.permissionUrlLabel')}
        type="url"
        placeholder="https://example.com"
        value={url}
        onChange={onUrlChange}
        onKeyDown={(e) => e.key === 'Enter' && onGrant()}
        trailing={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onGrant}
            disabled={!url.trim() || state === 'granting'}
            className="ds-btn-secondary"
          >
            {state === 'granting' ? t('sidepanel.toolsPage.permissionRequesting') : t('sidepanel.toolsPage.grantPermission')}
          </Button>
        )}
      />
      {state === 'granted' && (
        <StatusMessage tone="success">{t('sidepanel.toolsPage.permissionGranted')}</StatusMessage>
      )}
      {state === 'denied' && (
        <StatusMessage tone="error">{t('sidepanel.toolsPage.permissionDenied')}</StatusMessage>
      )}
      {state === 'error' && (
        <StatusMessage tone="error">{t('sidepanel.toolsPage.permissionInvalidUrl')}</StatusMessage>
      )}
      <div className="ds-tools-all-sites-row">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onGrantAll}
          disabled={allSitesState === 'granting' || allSitesState === 'granted'}
          className="ds-btn-secondary"
        >
          {allSitesState === 'granting'
            ? t('sidepanel.toolsPage.allSitesRequesting')
            : allSitesState === 'granted'
              ? t('sidepanel.toolsPage.allSitesGranted')
              : t('sidepanel.toolsPage.allSitesGrant')}
        </Button>
        <div className="ds-tools-help">
          {t('sidepanel.toolsPage.allSitesHelp')}
        </div>
      </div>
      {allSitesState === 'denied' && (
        <StatusMessage tone="error">{t('sidepanel.toolsPage.permissionDenied')}</StatusMessage>
      )}
    </div>
  );
}

const TOOLS = [
  {
    key: 'web_search',
    nameKey: 'sidepanel.toolsPage.webSearchName',
    descriptionKey: 'sidepanel.toolsPage.webSearchDescription',
  },
  {
    key: 'web_fetch',
    nameKey: 'sidepanel.toolsPage.webFetchName',
    descriptionKey: 'sidepanel.toolsPage.webFetchDescription',
  },
] as const satisfies readonly {
  key: string;
  nameKey: LocaleMessageKey;
  descriptionKey: LocaleMessageKey;
}[];

type ToolKey = typeof TOOLS[number]['key'];

function PythonToolCard({
  server,
  cache,
  busy,
  message,
  messageTone,
  nativeMessagingSupported,
  loadError,
  onCreate,
  onRefresh,
  onToggle,
}: {
  server: McpServerConfig | null;
  cache: McpToolCacheEntry | null;
  busy: PythonBusyState;
  message: string;
  messageTone: 'success' | 'error' | 'warning' | 'info';
  nativeMessagingSupported: boolean;
  loadError: string;
  onCreate: () => void;
  onRefresh: () => void;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const pythonExec = cache?.descriptors.find((tool) => tool.name === 'python_exec') ?? null;
  const enabled = Boolean(server && pythonExec && isMcpToolEnabled(server, pythonExec));
  const hasShell = Boolean(server);
  const canToggle = Boolean(!loadError && server && pythonExec && busy === 'idle');
  const statusText = loadError
    ? t('sidepanel.toolsPage.pythonStatusMissing')
    : !server
      ? nativeMessagingSupported
        ? t('sidepanel.toolsPage.pythonStatusNoShell')
        : t('sidepanel.toolsPage.pythonStatusUnsupported')
      : !cache
        ? t('sidepanel.toolsPage.pythonStatusNoCache')
        : pythonExec
          ? enabled ? t('sidepanel.toolsPage.pythonStatusEnabled') : t('sidepanel.toolsPage.pythonStatusDiscovered')
          : t('sidepanel.toolsPage.pythonStatusMissing');
  const disabledLabel = canToggle ? undefined : statusText;
  const visibleMessage = loadError || message;
  const visibleMessageTone = loadError ? 'error' : messageTone;

  return (
    <div className="ds-tool-row">
      <ToggleRow
        title={t('sidepanel.toolsPage.pythonTitle')}
        description={t('sidepanel.toolsPage.pythonDescription')}
        enabled={enabled}
        disabled={!canToggle}
        disabledLabel={disabledLabel}
        onToggle={onToggle}
        trailing={(
          <div className="ds-tool-row-actions">
            {!hasShell && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCreate}
                disabled={Boolean(loadError) || busy !== 'idle' || !nativeMessagingSupported}
                className="ds-btn-secondary"
              >
                {busy === 'creating' ? t('sidepanel.toolsPage.pythonCreating') : t('sidepanel.toolsPage.pythonCreate')}
              </Button>
            )}
            {hasShell && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={busy !== 'idle'}
                className="ds-btn-secondary"
              >
                {busy === 'refreshing' ? t('sidepanel.toolsPage.pythonRefreshing') : t('sidepanel.toolsPage.pythonRefresh')}
              </Button>
            )}
          </div>
        )}
      />
      {visibleMessage && (
        <div className="ds-tool-row-message">
          <StatusMessage tone={visibleMessageTone}>{visibleMessage}</StatusMessage>
        </div>
      )}
      {server && cache && !pythonExec && (
        <div className="ds-tool-row-message">
          <StatusMessage tone="error">{t('sidepanel.toolsPage.pythonMissingDetail')}</StatusMessage>
        </div>
      )}
    </div>
  );
}

export default function ToolsPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Record<ToolKey, boolean>>({
    web_search: true,
    web_fetch: true,
  });
  const [webSettingsLoading, setWebSettingsLoading] = useState(true);
  const [webSettingsError, setWebSettingsError] = useState('');
  const [permState, setPermState] = useState<PermissionState>('idle');
  const [permUrl, setPermUrl] = useState('');
  const [allSitesState, setAllSitesState] = useState<PermissionState>('idle');
  const [pythonServer, setPythonServer] = useState<McpServerConfig | null>(null);
  const [pythonCache, setPythonCache] = useState<McpToolCacheEntry | null>(null);
  const [pythonLoading, setPythonLoading] = useState(true);
  const [pythonBusy, setPythonBusy] = useState<PythonBusyState>('idle');
  const [pythonMessage, setPythonMessage] = useState('');
  const [pythonMessageTone, setPythonMessageTone] = useState<'success' | 'error' | 'warning' | 'info'>('info');
  const [pythonLoadError, setPythonLoadError] = useState('');
  const [platform, setPlatform] = useState<PlatformEnvironment | null>(null);

  useEffect(() => {
    void loadWebToolSettings();
  }, []);

  useEffect(() => {
    void loadPythonTool();

    const handler = (msg: { type?: string }) => {
      if (msg.type === 'MCP_SERVERS_UPDATED' || msg.type === 'TOOL_DESCRIPTORS_UPDATED') {
        void loadPythonTool();
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const loadWebToolSettings = async () => {
    setWebSettingsLoading(true);
    try {
      const result: Record<string, boolean> | null = await chrome.runtime.sendMessage({ type: 'GET_WEB_TOOL_SETTINGS' });
      if (result) {
        setSettings((prev) => ({ ...prev, ...result }));
      }
      setWebSettingsError('');
    } catch (error) {
      setWebSettingsError(t('sidepanel.toolsPage.webSettingsLoadFailed', {
        error: getSafeRuntimeIssueMessage(error, t('sidepanel.toolsPage.webSettingsLoadFallback')),
      }));
    } finally {
      setWebSettingsLoading(false);
    }
  };

  const loadPythonTool = async () => {
    setPythonLoading(true);
    try {
      const [servers, environment]: [McpServerConfig[], PlatformEnvironment | null] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_MCP_SERVERS' }),
        chrome.runtime.sendMessage({ type: 'GET_PLATFORM_CAPABILITIES' }),
      ]);
      setPlatform(environment ?? null);
      const shell = (servers ?? []).find(isShellServer) ?? null;
      setPythonServer(shell);
      setPythonLoadError('');

      if (!shell) {
        setPythonCache(null);
        return;
      }

      const cache: McpToolCacheEntry | null = await chrome.runtime.sendMessage({
        type: 'GET_MCP_TOOL_CACHE',
        payload: { serverId: shell.id },
      });
      setPythonCache(cache ?? null);
    } catch (error) {
      setPlatform(null);
      setPythonServer(null);
      setPythonCache(null);
      setPythonLoadError(t('sidepanel.toolsPage.pythonLoadFailed', {
        error: getSafeRuntimeIssueMessage(error, t('sidepanel.toolsPage.pythonLoadFallback')),
      }));
    } finally {
      setPythonLoading(false);
    }
  };

  const handleCreatePythonShell = async () => {
    setPythonBusy('creating');
    setPythonMessage('');
    try {
      if (!isShellNativeHostSupported(platform)) {
        setPythonMessageTone('error');
        setPythonMessage(t('sidepanel.toolsPage.pythonStatusUnsupported'));
        return;
      }
      const existing = pythonServer;
      if (existing) {
        setPythonMessageTone('info');
        setPythonMessage(t('sidepanel.toolsPage.shellExists'));
        return;
      }
      await chrome.runtime.sendMessage({
        type: 'CREATE_MCP_SERVER',
        payload: createShellMcpPresetInput(),
      });
      setPythonMessageTone('success');
      setPythonMessage(t('sidepanel.toolsPage.shellCreated'));
      await loadPythonTool();
    } catch (error) {
      setPythonMessageTone('error');
      setPythonMessage(t('sidepanel.toolsPage.pythonActionFailed', {
        error: getSafeRuntimeIssueMessage(error, t('sidepanel.toolsPage.pythonActionFallback')),
      }));
    } finally {
      setPythonBusy('idle');
    }
  };

  const handleRefreshPythonTools = async () => {
    if (!pythonServer) return;
    setPythonBusy('refreshing');
    setPythonMessage('');
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'REFRESH_MCP_SERVER_TOOLS',
        payload: { serverId: pythonServer.id },
      });
      const cache: McpToolCacheEntry | null = result?.cache ?? result ?? null;
      setPythonCache(cache);
      if (cache?.descriptors.some((tool) => tool.name === 'python_exec')) {
        setPythonMessageTone('success');
        setPythonMessage(t('sidepanel.toolsPage.pythonFound'));
      } else {
        setPythonMessageTone('error');
        setPythonMessage(t('sidepanel.toolsPage.pythonMissingAfterRefresh'));
      }
      await loadPythonTool();
    } catch (error) {
      setPythonMessageTone('error');
      setPythonMessage(t('sidepanel.toolsPage.pythonActionFailed', {
        error: getSafeRuntimeIssueMessage(error, t('sidepanel.toolsPage.pythonActionFallback')),
      }));
    } finally {
      setPythonBusy('idle');
    }
  };

  const handleTogglePython = async () => {
    if (!pythonServer) return;
    const pythonExec = pythonCache?.descriptors.find((tool) => tool.name === 'python_exec');
    if (!pythonExec) {
      setPythonMessageTone('error');
      setPythonMessage(t('sidepanel.toolsPage.pythonMissingBeforeToggle'));
      return;
    }

    setPythonBusy('toggling');
    setPythonMessage('');
    try {
      const shouldEnable = !isMcpToolEnabled(pythonServer, pythonExec);
      const managedPythonDisable = !shouldEnable && isPageToolsManagedPythonAllowlist(pythonServer.allowlist);
      await chrome.runtime.sendMessage({
        type: 'UPDATE_MCP_SERVER',
        payload: {
          id: pythonServer.id,
          patch: {
            enabled: shouldEnable ? true : managedPythonDisable ? false : pythonServer.enabled,
            execution: {
              ...pythonServer.execution,
              enabled: shouldEnable ? true : managedPythonDisable ? false : pythonServer.execution.enabled,
              mode: shouldEnable ? 'auto' : managedPythonDisable ? 'manual' : pythonServer.execution.mode,
            },
            allowlist: nextAllowlistForTool(pythonServer.allowlist, pythonExec, shouldEnable),
          },
        },
      });
      setPythonMessageTone('success');
      setPythonMessage(shouldEnable ? t('sidepanel.toolsPage.pythonEnabled') : t('sidepanel.toolsPage.pythonDisabled'));
      await loadPythonTool();
    } catch (error) {
      setPythonMessageTone('error');
      setPythonMessage(t('sidepanel.toolsPage.pythonActionFailed', {
        error: getSafeRuntimeIssueMessage(error, t('sidepanel.toolsPage.pythonActionFallback')),
      }));
    } finally {
      setPythonBusy('idle');
    }
  };

  const handleToggle = async (key: ToolKey, enabled: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: enabled }));
    await chrome.runtime.sendMessage({
      type: 'SET_WEB_TOOL_SETTING',
      payload: { name: key, enabled },
    });
  };

  const handleGrantPermission = async () => {
    const trimmed = permUrl.trim();
    if (!trimmed) return;
    let origin: string;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setPermState('error');
        return;
      }
      origin = parsed.origin + '/*';
    } catch {
      setPermState('error');
      return;
    }
    setPermState('granting');
    const result = await chrome.runtime.sendMessage({
      type: 'REQUEST_HOST_PERMISSION',
      payload: { origins: [origin] },
    });
    if (result?.ok) {
      setPermState('granted');
    } else {
      setPermState('denied');
    }
  };

  const handleGrantAllSites = async () => {
    setAllSitesState('granting');
    const result = await chrome.runtime.sendMessage({
      type: 'REQUEST_HOST_PERMISSION',
      payload: { origins: ['http://*/*', 'https://*/*'] },
    });
    setAllSitesState(result?.ok ? 'granted' : 'denied');
  };

  return (
    <div className="ds-page">
      <PageIntro
        title={t('sidepanel.toolsPage.toolTitle')}
        description={t('sidepanel.toolsPage.toolDescription')}
      />

      <ToolsStatusCard
        settings={settings}
        webSettingsLoading={webSettingsLoading}
        webSettingsError={webSettingsError}
        pythonLoading={pythonLoading}
        pythonServer={pythonServer}
        pythonCache={pythonCache}
        pythonBusy={pythonBusy}
        pythonLoadError={pythonLoadError}
        nativeMessagingSupported={isShellNativeHostSupported(platform)}
        onRetry={() => {
          setPythonMessage('');
          void loadWebToolSettings();
          void loadPythonTool();
        }}
      />

      <SettingsSection
        title={t('sidepanel.toolsPage.availableSection')}
        description={t('sidepanel.toolsPage.availableDescription')}
      >
        <div className="ds-tool-list">
          {TOOLS.map((tool) => (
            <ToolToggleRow
              key={tool.key}
              title={t(tool.nameKey)}
              description={t(tool.descriptionKey)}
              enabled={settings[tool.key]}
              onToggle={(next) => handleToggle(tool.key, next)}
            />
          ))}
          <PythonToolCard
            server={pythonServer}
            cache={pythonCache}
            busy={pythonBusy}
            message={pythonMessage}
            messageTone={pythonMessageTone}
            nativeMessagingSupported={isShellNativeHostSupported(platform)}
            loadError={pythonLoadError}
            onCreate={handleCreatePythonShell}
            onRefresh={handleRefreshPythonTools}
            onToggle={handleTogglePython}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('sidepanel.toolsPage.permissionTitle')}
        description={t('sidepanel.toolsPage.permissionDescription')}
      >
        <SiteAccessPanel
          url={permUrl}
          state={permState}
          allSitesState={allSitesState}
          onUrlChange={(value) => {
            setPermUrl(value);
            setPermState('idle');
          }}
          onGrant={handleGrantPermission}
          onGrantAll={handleGrantAllSites}
        />
      </SettingsSection>

      <SettingsSection
        title={t('sidepanel.toolsPage.diagnosticTitle')}
        description={t('sidepanel.toolsPage.diagnosticDescription')}
      >
        <ToolsDisclosure title={t('sidepanel.toolsPage.diagnosticAction')}>
          <DiagSearch />
        </ToolsDisclosure>
      </SettingsSection>
    </div>
  );
}

function isShellServer(server: McpServerConfig): boolean {
  return server.displayName === SHELL_MCP_SERVER_NAME || server.transport.nativeHost === SHELL_MCP_NATIVE_HOST;
}

function isMcpToolEnabled(server: McpServerConfig, tool: ToolDescriptor): boolean {
  if (!server.enabled || !server.execution.enabled || server.execution.mode !== 'auto') return false;
  const selected = server.allowlist.toolNames.includes(tool.name) || server.allowlist.toolNames.includes(tool.invocationName);
  if (server.allowlist.mode === 'allow') return selected;
  if (server.allowlist.mode === 'deny') return !selected;
  return true;
}

function nextAllowlistForTool(
  allowlist: McpToolAllowlist,
  tool: ToolDescriptor,
  shouldEnable: boolean,
): McpToolAllowlist {
  const names = new Set(allowlist.toolNames);
  const removeTool = () => {
    names.delete(tool.name);
    names.delete(tool.invocationName);
  };

  if (allowlist.mode === 'allow') {
    if (tool.name === 'python_exec' && shouldEnable && isDefaultShellSupportAllowlist(allowlist)) {
      return { mode: 'allow', toolNames: [...PAGE_TOOLS_PYTHON_TOOL_NAMES] };
    }
    if (tool.name === 'python_exec' && !shouldEnable && isPageToolsManagedPythonAllowlist(allowlist)) {
      return { mode: 'allow', toolNames: [...DEFAULT_SHELL_SUPPORT_TOOL_NAMES] };
    }
    if (shouldEnable) names.add(tool.name);
    else removeTool();
    return { mode: 'allow', toolNames: [...names] };
  }

  if (allowlist.mode === 'deny') {
    if (shouldEnable) removeTool();
    else names.add(tool.name);
    return { mode: names.size === 0 ? 'all' : 'deny', toolNames: [...names] };
  }

  if (!shouldEnable) {
    return { mode: 'deny', toolNames: [tool.name] };
  }
  return allowlist;
}

function isDefaultShellSupportAllowlist(allowlist: McpToolAllowlist): boolean {
  if (allowlist.mode !== 'allow') return false;
  const supported = new Set<string>(DEFAULT_SHELL_SUPPORT_TOOL_NAMES);
  return allowlist.toolNames.length > 0 && allowlist.toolNames.every((name) => supported.has(name));
}

function isPageToolsManagedPythonAllowlist(allowlist: McpToolAllowlist): boolean {
  if (allowlist.mode !== 'allow') return false;
  const managed = new Set<string>([...DEFAULT_SHELL_SUPPORT_TOOL_NAMES, ...PAGE_TOOLS_PYTHON_TOOL_NAMES]);
  return allowlist.toolNames.includes('python_exec') && allowlist.toolNames.every((name) => managed.has(name));
}
