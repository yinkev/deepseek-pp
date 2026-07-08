import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  SHELL_MCP_NATIVE_HOST,
  SHELL_MCP_SERVER_NAME,
  createShellMcpPresetInput,
} from '../../../core/shell';
import {
  LEGACY_MULTIMODAL_MCP_SERVER_NAME,
  MULTIMODAL_MCP_NATIVE_HOST,
  MULTIMODAL_MCP_PACKAGE_NAME,
  MULTIMODAL_MCP_SERVER_NAME,
  createMultimodalMcpPresetInput,
} from '../../../core/multimodal';
import {
  getSupportedMcpTransportKinds,
  isShellNativeHostSupported,
} from '../../../core/platform';
import type { LocaleMessageKey, MessageParams, SupportedLocale } from '../../../core/i18n';
import type {
  McpHeaderValue,
  McpSecretValue,
  McpServerConfig,
  McpServerCreateInput,
  McpServerStatus,
  McpServerTransportConfig,
  McpToolAllowlist,
  McpToolCacheEntry,
  ToolCallHistoryRecord,
  ToolDescriptor,
  ToolExecutionMode,
  PlatformEnvironment,
} from '../../../core/types';
import PageIntro from '../components/PageIntro';
import ToggleSwitch from '../components/ToggleSwitch';
import { useI18n } from '../i18n';
import {
  SettingsSection,
  StatusMessage,
  ToggleRow,
  useConfirm,
} from '../components/settings/primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getRuntimeErrorMessage, isRuntimeFailure } from '../runtime-response';

type McpTransportKind = McpServerTransportConfig['kind'];
type CacheByServer = Record<string, McpToolCacheEntry | null>;
type BusyAction = 'refresh' | 'test' | 'permission';
type Translator = (key: LocaleMessageKey, params?: MessageParams) => string;
type MessageTone = 'success' | 'error' | 'info';
type Banner = { tone: MessageTone; text: string };
type McpLoadIssueId = 'connectors' | 'platform' | 'actions' | 'history';
type McpLoadIssue = { id: McpLoadIssueId; source?: string; message: string };

type FormState = {
  displayName: string;
  enabled: boolean;
  transportKind: McpTransportKind;
  url: string;
  nativeHost: string;
  command: string;
  args: string;
  cwd: string;
  env: string;
  headers: McpHeaderValue[];
  secrets: McpSecretValue[];
  connectMs: string;
  requestMs: string;
  discoveryMs: string;
  maxResultBytes: string;
  maxToolCount: string;
  executionEnabled: boolean;
  executionMode: ToolExecutionMode;
};

const TRANSPORT_OPTIONS: { kind: McpTransportKind; label: string; hintKey: LocaleMessageKey }[] = [
  { kind: 'streamable_http', label: 'Modern web', hintKey: 'sidepanel.mcpPage.transportHints.streamableHttp' },
  { kind: 'http', label: 'Web service', hintKey: 'sidepanel.mcpPage.transportHints.http' },
  { kind: 'sse', label: 'Event stream', hintKey: 'sidepanel.mcpPage.transportHints.sse' },
  { kind: 'stdio_bridge', label: 'Local bridge', hintKey: 'sidepanel.mcpPage.transportHints.stdioBridge' },
  { kind: 'native_messaging', label: 'Browser host', hintKey: 'sidepanel.mcpPage.transportHints.nativeMessaging' },
];

const MCP_LOAD_ISSUE_LABEL_KEYS: Record<McpLoadIssueId, LocaleMessageKey> = {
  connectors: 'sidepanel.mcpPage.loadIssues.connectors',
  platform: 'sidepanel.mcpPage.loadIssues.platform',
  actions: 'sidepanel.mcpPage.loadIssues.actions',
  history: 'sidepanel.mcpPage.loadIssues.history',
};

const DEFAULT_FORM: FormState = {
  displayName: '',
  enabled: true,
  transportKind: 'streamable_http',
  url: '',
  nativeHost: '',
  command: '',
  args: '',
  cwd: '',
  env: '',
  headers: [],
  secrets: [],
  connectMs: '10000',
  requestMs: '60000',
  discoveryMs: '20000',
  maxResultBytes: '64000',
  maxToolCount: '128',
  executionEnabled: true,
  executionMode: 'auto',
};

function readMcpLoadResult<T>(
  result: PromiseSettledResult<unknown>,
  id: McpLoadIssueId,
  issues: McpLoadIssue[],
  fallback: T,
  fallbackMessage: string,
): T {
  let reason: unknown;
  if (result.status === 'fulfilled') {
    const value: unknown = result.value;
    if (!isRuntimeFailure(value)) return value as T;
    reason = value.error;
  } else {
    reason = result.reason;
  }
  issues.push({ id, message: connectorLoadIssueMessage(reason, fallbackMessage) });
  return fallback;
}

function connectorLoadIssueMessage(error: unknown, fallbackMessage: string): string {
  const raw = getRuntimeErrorMessage(error).trim();
  if (!raw) return fallbackMessage;
  if (/\bGET_[A-Z0-9_]+\b|mcp[_:/-]|\/mcp|schemaVersion|Native Messaging|Streamable HTTP|SSE/i.test(raw)) {
    return fallbackMessage;
  }
  return raw;
}

export default function McpPage() {
  const { t, locale } = useI18n();
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [caches, setCaches] = useState<CacheByServer>({});
  const [history, setHistory] = useState<ToolCallHistoryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [busy, setBusy] = useState<Record<string, BusyAction | null>>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [loadIssues, setLoadIssues] = useState<McpLoadIssue[]>([]);
  const [platform, setPlatform] = useState<PlatformEnvironment | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionInitialized = useRef(false);

  const { confirm, node: confirmNode } = useConfirm();

  const showBanner = (tone: MessageTone, text: string) => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setBanner({ tone, text });
    // Success banners auto-dismiss after 4s; errors/info stay until replaced.
    if (tone === 'success') {
      dismissTimer.current = setTimeout(() => setBanner(null), 4000);
    }
  };
  const clearBanner = () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setBanner(null);
  };

  const selected = selectedId ? servers.find((server) => server.id === selectedId) ?? null : null;
  const enabledCount = servers.filter((server) => server.enabled).length;
  const toolCount = useMemo(
    () => servers.reduce((sum, server) => sum + enabledToolCount(server, caches[server.id]?.descriptors ?? []), 0),
    [servers, caches],
  );
  const mcpHistory = history.filter((record) => record.call.provider?.kind === 'mcp');
  const nativeMessagingSupported = isShellNativeHostSupported(platform);
  const hasConnectorListIssue = loadIssues.some((issue) => issue.id === 'connectors');
  const connectorStatus = createConnectorStatusModel({
    loading,
    servers,
    enabledCount,
    toolCount,
    loadIssues,
    hasConnectorListIssue,
    t,
  });

  const load = async () => {
    setLoading(true);
    const issues: McpLoadIssue[] = [];
    const [listResult, environmentResult] = await Promise.allSettled([
      chrome.runtime.sendMessage({ type: 'GET_MCP_SERVERS' }),
      chrome.runtime.sendMessage({ type: 'GET_PLATFORM_CAPABILITIES' }),
    ]);
    const nextServers = readMcpLoadResult<McpServerConfig[]>(
      listResult,
      'connectors',
      issues,
      servers,
      t('sidepanel.mcpPage.messages.loadFailed'),
    ) ?? [];
    const environment = readMcpLoadResult<PlatformEnvironment | null>(
      environmentResult,
      'platform',
      issues,
      platform,
      t('sidepanel.mcpPage.messages.platformLoadFailed'),
    );
    setPlatform(environment ?? null);
    setServers(nextServers);
    const shouldSelectInitialServer = !selectionInitialized.current && nextServers.length > 0;
    if (shouldSelectInitialServer) selectionInitialized.current = true;
    setSelectedId((current) => {
      if (current && nextServers.some((server) => server.id === current)) return current;
      return shouldSelectInitialServer ? nextServers[0]?.id ?? null : null;
    });

    const cacheResults = await Promise.allSettled(
      nextServers.map(async (server) => {
        const response: unknown = await chrome.runtime.sendMessage({
          type: 'GET_MCP_TOOL_CACHE',
          payload: { serverId: server.id },
        });
        if (isRuntimeFailure(response)) throw new Error(response.error ? String(response.error) : t('sidepanel.mcpPage.messages.actionsLoadFailed'));
        const cache = response as McpToolCacheEntry | null;
        return [server.id, cache] as const;
      }),
    );
    const cacheEntries = cacheResults.map((result, index) => {
      const server = nextServers[index];
      let reason: unknown;
      if (result.status === 'fulfilled') {
        const value: unknown = result.value;
        if (!isRuntimeFailure(value)) return result.value;
        reason = value.error;
      } else {
        reason = result.reason;
      }
      issues.push({
        id: 'actions',
        source: connectorDisplayName(server, t),
        message: connectorLoadIssueMessage(reason, t('sidepanel.mcpPage.messages.actionsLoadFailed')),
      });
      return [server.id, caches[server.id] ?? null] as const;
    });
    setCaches(Object.fromEntries(cacheEntries));

    const recentResult = await Promise.allSettled([
      chrome.runtime.sendMessage({
        type: 'GET_TOOL_CALL_HISTORY',
        payload: { limit: 12 },
      }),
    ]);
    const recent = readMcpLoadResult<ToolCallHistoryRecord[]>(
      recentResult[0],
      'history',
      issues,
      history,
      t('sidepanel.mcpPage.messages.historyLoadFailed'),
    );
    setHistory(recent ?? []);
    setLoadIssues(issues);
    if (issues.length === 0) clearBanner();
    setLoading(false);
  };

  const retryLoad = () => {
    clearBanner();
    void load();
  };

  const loadIssueLabel = (issue: McpLoadIssue): string => {
    if (issue.id === 'actions' && issue.source) {
      return t('sidepanel.mcpPage.loadIssueActionsFor', { source: issue.source });
    }
    return t(MCP_LOAD_ISSUE_LABEL_KEYS[issue.id]);
  };

  useEffect(() => {
    void load();

    const handleUpdate = (msg: { type?: string; servers?: McpServerConfig[] }) => {
      if (msg.type === 'MCP_SERVERS_UPDATED' && Array.isArray(msg.servers)) {
        setServers(msg.servers);
      }
      if (
        msg.type === 'MCP_SERVERS_UPDATED' ||
        msg.type === 'TOOL_DESCRIPTORS_UPDATED' ||
        msg.type === 'TOOL_CALL_HISTORY_UPDATED'
      ) {
        void load();
      }
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) void load();
    };

    chrome.runtime.onMessage.addListener(handleUpdate);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);

    return () => {
      chrome.runtime.onMessage.removeListener(handleUpdate);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, []);

  const startCreate = () => {
    setEditing(null);
    clearBanner();
    setShowForm((prev) => !prev);
  };

  const createShellPreset = async () => {
    clearBanner();
    if (!nativeMessagingSupported) {
      showBanner('error', t('sidepanel.mcpPage.messages.nativeMessagingUnsupported'));
      return;
    }
    const existing = servers.find((server) =>
      server.displayName === SHELL_MCP_SERVER_NAME ||
      server.transport.nativeHost === SHELL_MCP_NATIVE_HOST
    );
    if (existing) {
      setSelectedId(existing.id);
      showBanner('info', t('sidepanel.mcpPage.messages.shellExistsSelected'));
      return;
    }

    const server: McpServerConfig | null = await chrome.runtime.sendMessage({
      type: 'CREATE_MCP_SERVER',
      payload: createShellMcpPresetInput(),
    });
    if (!server) {
      showBanner('error', t('sidepanel.mcpPage.messages.shellCreateFailed'));
      return;
    }
    setSelectedId(server.id);
    showBanner('success', t('sidepanel.mcpPage.messages.shellCreated'));
    await load();
  };

  const createMultimodalPreset = async () => {
    clearBanner();
    if (!nativeMessagingSupported) {
      showBanner('error', t('sidepanel.mcpPage.messages.nativeMessagingUnsupported'));
      return;
    }
    const existing = servers.find((server) =>
      server.displayName === MULTIMODAL_MCP_SERVER_NAME ||
      server.displayName === LEGACY_MULTIMODAL_MCP_SERVER_NAME ||
      server.transport.nativeHost === MULTIMODAL_MCP_NATIVE_HOST
    );
    if (existing) {
      setSelectedId(existing.id);
      showBanner('info', t('sidepanel.mcpPage.messages.multimodalExistsSelected'));
      return;
    }

    const server: McpServerConfig | null = await chrome.runtime.sendMessage({
      type: 'CREATE_MCP_SERVER',
      payload: createMultimodalMcpPresetInput(),
    });
    if (!server) {
      showBanner('error', t('sidepanel.mcpPage.messages.multimodalCreateFailed'));
      return;
    }
    setSelectedId(server.id);
    showBanner('success', t('sidepanel.mcpPage.messages.multimodalCreated'));
    await load();
  };

  const startEdit = (server: McpServerConfig) => {
    setEditing(server);
    clearBanner();
    setShowForm(true);
  };

  const saveServer = async (payload: McpServerCreateInput) => {
    const editingServer = editing ? servers.find((server) => server.id === editing.id) ?? editing : null;
    const requestPayload = editingServer
      ? { ...payload, allowlist: editingServer.allowlist }
      : payload;
    const response = editing
      ? await chrome.runtime.sendMessage({
        type: 'UPDATE_MCP_SERVER',
        payload: { id: editing.id, patch: requestPayload },
      })
      : await chrome.runtime.sendMessage({ type: 'CREATE_MCP_SERVER', payload: requestPayload });

    if (!response) {
      showBanner('error', t('sidepanel.mcpPage.messages.saveFailed'));
      return;
    }

    setShowForm(false);
    setEditing(null);
    clearBanner();
    await load();
  };

  const removeServer = async (server: McpServerConfig) => {
    const name = connectorDisplayName(server, t);
    const ok = await confirm({
      title: t('sidepanel.mcpPage.messages.deleteConfirm', { name }),
      message: t('sidepanel.mcpPage.messages.deleteConfirm', { name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    await chrome.runtime.sendMessage({ type: 'DELETE_MCP_SERVER', payload: { id: server.id } });
    if (selectedId === server.id) setSelectedId(null);
    await load();
  };

  const patchServer = async (server: McpServerConfig, patch: Partial<McpServerConfig>) => {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_MCP_SERVER',
      payload: { id: server.id, patch },
    });
    await load();
  };

  const requestPermission = async (server: McpServerConfig) => {
    setBusyState(server.id, 'permission');
    clearBanner();
    try {
      const result = await requestMcpOriginPermission(server);
      if (result?.ok) {
        showBanner('success', t('sidepanel.mcpPage.messages.permissionGranted', { origin: result.origin ?? t('sidepanel.mcpPage.localHost') }));
      } else {
        showBanner('error', result?.error ?? t('sidepanel.mcpPage.messages.permissionDenied'));
      }
    } finally {
      setBusyState(server.id, null);
    }
  };

  const refreshServer = async (server: McpServerConfig, action: 'refresh' | 'test') => {
    setBusyState(server.id, action);
    clearBanner();
    try {
      if (requiresOriginPermission(server)) {
        const permission = await requestMcpOriginPermission(server);
        if (!permission?.ok) {
          showBanner('error', permission?.error ?? t('sidepanel.mcpPage.messages.permissionRequired', {
            origin: permission?.origin ?? t('sidepanel.mcpPage.localHost'),
          }));
          return;
        }
      }
      const result = await chrome.runtime.sendMessage({
        type: action === 'test' ? 'TEST_MCP_SERVER_CONNECTION' : 'REFRESH_MCP_SERVER_TOOLS',
        payload: { serverId: server.id },
      });
      const cache: McpToolCacheEntry | null = result?.cache ?? result ?? null;
      if (cache) {
        setCaches((prev) => ({ ...prev, [server.id]: cache }));
        if (cache.health.status === 'ready') {
          showBanner('success', t('sidepanel.mcpPage.messages.connectionSuccess', {
            tools: cache.health.toolCount,
            latency: formatMs(cache.health.latencyMs),
          }));
        } else {
          showBanner('error', connectorLoadIssueMessage(
            cache.health.error,
            t('sidepanel.mcpPage.messages.connectionFailed'),
          ));
        }
      }
      await load();
    } finally {
      setBusyState(server.id, null);
    }
  };

  const toggleTool = async (server: McpServerConfig, tool: ToolDescriptor) => {
    const enabled = isToolEnabled(server, tool);
    const allowlist = nextAllowlistForTool(server.allowlist, tool, !enabled);
    await patchServer(server, { allowlist });
  };

  const setBusyState = (serverId: string, action: BusyAction | null) => {
    setBusy((prev) => ({ ...prev, [serverId]: action }));
  };

  const applyConnectorStatusAction = () => {
    if (connectorStatus.action === 'retry') {
      retryLoad();
      return;
    }
    if (connectorStatus.action === 'add') {
      startCreate();
    }
  };

  return (
    <div className="ds-page">
      <PageIntro
        title={t('sidepanel.mcpPage.title')}
        description={t('sidepanel.mcpPage.description')}
        meta={t('sidepanel.mcpPage.summary', {
          servers: servers.length,
          enabled: enabledCount,
          tools: toolCount,
        })}
        actions={(
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={createShellPreset}
              disabled={!nativeMessagingSupported}
              title={!nativeMessagingSupported ? t('sidepanel.mcpPage.messages.nativeMessagingUnsupported') : undefined}
              className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg transition-all duration-150 disabled:opacity-50"
            >
              {t('sidepanel.mcpPage.shell')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={createMultimodalPreset}
              disabled={!nativeMessagingSupported}
              title={!nativeMessagingSupported ? t('sidepanel.mcpPage.messages.nativeMessagingUnsupported') : undefined}
              className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg transition-all duration-150 disabled:opacity-50"
            >
              {t('sidepanel.mcpPage.multimodal')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={startCreate}
              className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {t('sidepanel.mcpPage.addServer')}
            </Button>
          </>
        )}
      />

      <Card size="sm" className={`ds-connector-status ds-connector-status-${connectorStatus.tone}`}>
        <CardHeader className="ds-connector-status-head">
          <CardTitle>{t('sidepanel.mcpPage.readinessTitle')}</CardTitle>
          <CardDescription>{t(connectorStatus.descriptionKey)}</CardDescription>
          <CardAction>
            <Badge variant={getConnectorStatusBadgeVariant(connectorStatus.tone)} className={`ds-connector-status-badge ds-connector-status-badge-${connectorStatus.tone}`}>
              {t(connectorStatus.statusKey)}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="ds-connector-status-body">
          <div className="ds-connector-status-list">
            <ConnectorStatusRow
              label={t('sidepanel.mcpPage.readinessConnectorsLabel')}
              value={connectorStatus.connectors}
              tone={connectorStatus.connectorsTone}
            />
            <ConnectorStatusRow
              label={t('sidepanel.mcpPage.readinessActionsLabel')}
              value={connectorStatus.actions}
              tone={connectorStatus.actionsTone}
            />
            <ConnectorStatusRow
              label={t('sidepanel.mcpPage.readinessNextLabel')}
              value={t(connectorStatus.nextKey)}
              tone={connectorStatus.tone === 'blocked' ? 'blocked' : connectorStatus.tone === 'attention' ? 'attention' : 'normal'}
            />
          </div>
        </CardContent>
        {connectorStatus.action && (
          <CardFooter className="ds-connector-status-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={applyConnectorStatusAction}
              disabled={loading}
              className="ds-btn-secondary ds-connector-status-button disabled:opacity-50"
            >
              {t(connectorStatus.actionLabelKey)}
            </Button>
          </CardFooter>
        )}
      </Card>

      {banner && (
        <StatusMessage tone={banner.tone}>
          {banner.text}
        </StatusMessage>
      )}

      {loadIssues.length > 0 && (
        <StatusMessage tone="error">
          <div className="ds-connector-load-issue">
            <div className="ds-connector-load-issue-copy">
              <div className="ds-connector-load-issue-title">
                {t('sidepanel.mcpPage.loadIssuesTitle')}
              </div>
              <div className="ds-connector-load-issue-description">
                {t('sidepanel.mcpPage.loadIssuesDescription')}
              </div>
              <div className="ds-connector-load-issue-list">
                {loadIssues.slice(0, 4).map((issue) => (
                  <div key={`${issue.id}:${issue.source ?? ''}`} className="ds-connector-load-issue-row">
                    <span>{loadIssueLabel(issue)}</span>
                    <span>{issue.message}</span>
                  </div>
                ))}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ds-btn-secondary ds-connector-load-retry"
              onClick={retryLoad}
              disabled={loading}
            >
              {t('common.retry')}
            </Button>
          </div>
        </StatusMessage>
      )}

      {showForm && (
        <div className="animate-slide-down">
          <McpServerForm
            key={editing?.id ?? 'create'}
            initial={editing}
            platform={platform}
            onSave={saveServer}
            onCancel={() => { setShowForm(false); setEditing(null); clearBanner(); }}
          />
        </div>
      )}

      {confirmNode}

      {loading && servers.length === 0 ? (
        <EmptyState label={t('sidepanel.mcpPage.loading')} />
      ) : hasConnectorListIssue && servers.length === 0 && !showForm ? (
        <EmptyState
          label={t('sidepanel.mcpPage.loadIssuesTitle')}
          hint={t('sidepanel.mcpPage.loadIssueEmptyHint')}
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={retryLoad}
              className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg transition-all duration-150"
            >
              {t('common.retry')}
            </Button>
          }
        />
      ) : servers.length === 0 && !showForm ? (
        <EmptyState
          label={t('sidepanel.mcpPage.empty')}
          hint={t('sidepanel.mcpPage.emptyHint')}
          actions={
            <>
              <Button
                type="button"
                size="sm"
                onClick={startCreate}
                className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                {t('sidepanel.mcpPage.emptyCreateAction')}
              </Button>
              {nativeMessagingSupported && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={createShellPreset}
                  className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg transition-all duration-150"
                >
                  {t('sidepanel.mcpPage.emptyInstallShell')}
                </Button>
              )}
            </>
          }
        />
      ) : (
        <div className="space-y-2">
          {servers.map((server) => {
            const isSelected = selected?.id === server.id;
            return (
              <div key={server.id} className="space-y-2">
                <ServerRow
                  server={server}
                  cache={caches[server.id] ?? null}
                  selected={isSelected}
                  expanded={isSelected}
                  onSelect={() => setSelectedId(isSelected ? null : server.id)}
                  onToggle={() => patchServer(server, { enabled: !server.enabled })}
                  onEdit={() => startEdit(server)}
                  onDelete={() => removeServer(server)}
                  t={t}
                />
                {isSelected && (
                  <ServerDetail
                    server={server}
                    cache={caches[server.id] ?? null}
                    history={mcpHistory}
                    busy={busy[server.id] ?? null}
                    onPatch={(patch) => patchServer(server, patch)}
                    onRequestPermission={() => requestPermission(server)}
                    onRefresh={() => refreshServer(server, 'refresh')}
                    onTest={() => refreshServer(server, 'test')}
                    onToggleTool={(tool) => toggleTool(server, tool)}
                    t={t}
                    locale={locale}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function McpServerForm({
  initial,
  platform,
  onSave,
  onCancel,
}: {
  initial: McpServerConfig | null;
  platform: PlatformEnvironment | null;
  onSave: (payload: McpServerCreateInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(() => initial ? formFromServer(initial, t) : DEFAULT_FORM);
  const [error, setError] = useState('');
  const supportedTransportKinds = getSupportedMcpTransportKinds(
    TRANSPORT_OPTIONS.map((item) => item.kind),
    platform,
  );
  const transportOptions = TRANSPORT_OPTIONS.filter((item) => supportedTransportKinds.includes(item.kind));
  const selectedTransport = transportOptions.find((item) => item.kind === form.transportKind) ?? transportOptions[0] ?? TRANSPORT_OPTIONS[0];

  useEffect(() => {
    if (supportedTransportKinds.includes(form.transportKind)) return;
    setForm((prev) => ({
      ...prev,
      transportKind: 'streamable_http',
      nativeHost: '',
    }));
  }, [form.transportKind, supportedTransportKinds.join('|')]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setTransportKind = (kind: McpTransportKind) => {
    setForm((prev) => ({ ...prev, transportKind: kind }));
  };

  const save = async () => {
    const result = payloadFromForm(form, t, platform);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError('');
    await onSave(result.payload);
  };

  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="ds-form rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          {initial ? t('sidepanel.mcpPage.form.editTitle') : t('sidepanel.mcpPage.form.createTitle')}
        </div>
        <ToggleSwitch
          checked={form.enabled}
          onChange={(enabled) => update('enabled', enabled)}
          label={t('sidepanel.mcpPage.enabled')}
        />
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', border: '1px solid var(--ds-danger-border)' }}>
          {error}
        </div>
      )}

      <SettingsSection title={t('sidepanel.mcpPage.form.basic')}>
        <Field label={t('sidepanel.mcpPage.form.name')}>
          <input
            value={form.displayName}
            onChange={(event) => update('displayName', event.target.value)}
            className="ds-input w-full rounded-lg px-3 py-2 text-sm"
            placeholder={t('sidepanel.mcpPage.form.namePlaceholder')}
          />
        </Field>

        <div>
          <span className="block text-xs mb-1" style={{ color: 'var(--ds-text-secondary)' }}>{t('sidepanel.mcpPage.form.transport')}</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('sidepanel.mcpPage.form.transport')}>
            {transportOptions.map((item) => {
              const active = item.kind === form.transportKind;
              return (
                <button
                  key={item.kind}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTransportKind(item.kind)}
                  className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-all duration-150"
                  style={{
                    background: active ? 'var(--ds-blue-light)' : 'var(--ds-bg)',
                    color: active ? 'var(--ds-blue)' : 'var(--ds-text-secondary)',
                    borderColor: active ? 'var(--ds-selected-border)' : 'var(--ds-border)',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] mt-1.5" style={{ color: 'var(--ds-text-tertiary)' }}>{t(selectedTransport.hintKey)}</div>
        </div>

        {form.transportKind !== 'native_messaging' && (
          <Field label={form.transportKind === 'stdio_bridge' ? t('sidepanel.mcpPage.form.bridgeUrl') : t('sidepanel.mcpPage.form.serviceUrl')}>
            <input
              value={form.url}
              onChange={(event) => update('url', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder={form.transportKind === 'stdio_bridge' ? t('sidepanel.mcpPage.form.bridgeUrlPlaceholder') : t('sidepanel.mcpPage.form.serviceUrlPlaceholder')}
            />
          </Field>
        )}

        {form.transportKind === 'native_messaging' && (
          <Field label={t('sidepanel.mcpPage.form.nativeHost')}>
            <input
              value={form.nativeHost}
              onChange={(event) => update('nativeHost', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder={t('sidepanel.mcpPage.form.nativeHostPlaceholder')}
            />
          </Field>
        )}
      </SettingsSection>

      {form.transportKind === 'stdio_bridge' && (
        <SettingsSection title={t('sidepanel.mcpPage.form.stdioSection')}>
          <Field label={t('sidepanel.mcpPage.form.command')}>
            <input
              value={form.command}
              onChange={(event) => update('command', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder="npx"
            />
          </Field>
          <Field label={t('sidepanel.mcpPage.form.args')}>
            <input
              value={form.args}
              onChange={(event) => update('args', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
            />
          </Field>
          <Field label={t('sidepanel.mcpPage.form.cwd')}>
            <input
              value={form.cwd}
              onChange={(event) => update('cwd', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder="/Users/me/project"
            />
          </Field>
          <Field label={t('sidepanel.mcpPage.form.env')}>
            <textarea
              value={form.env}
              onChange={(event) => update('env', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm min-h-18 resize-y"
              placeholder={'KEY=value\nTOKEN=...'}
            />
          </Field>
        </SettingsSection>
      )}

      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((prev) => !prev)}
          className="flex items-center gap-1.5 text-xs font-medium w-full"
          style={{ color: 'var(--ds-text-secondary)' }}
        >
          <svg
            className="w-3 h-3 transition-transform duration-200"
            style={{ transform: advancedOpen ? 'rotate(90deg)' : 'rotate(0)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {t('sidepanel.mcpPage.form.advanced')}
          <span className="text-[10px] font-normal" style={{ color: 'var(--ds-text-tertiary)' }}>
            · {t('sidepanel.mcpPage.form.advancedHint')}
          </span>
        </button>
        {advancedOpen && (
          <div className="mt-2 space-y-3">
            {form.transportKind !== 'native_messaging' && (
              <HeaderEditor
                headers={form.headers}
                secrets={form.secrets}
                onHeadersChange={(headers) => update('headers', headers)}
                onSecretsChange={(secrets) => update('secrets', secrets)}
              />
            )}

            <div className="grid grid-cols-3 gap-2">
              <NumberField label={t('sidepanel.mcpPage.form.connectMs')} value={form.connectMs} onChange={(value) => update('connectMs', value)} />
              <NumberField label={t('sidepanel.mcpPage.form.requestMs')} value={form.requestMs} onChange={(value) => update('requestMs', value)} />
              <NumberField label={t('sidepanel.mcpPage.form.discoveryMs')} value={form.discoveryMs} onChange={(value) => update('discoveryMs', value)} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <NumberField label={t('sidepanel.mcpPage.form.resultBytes')} value={form.maxResultBytes} onChange={(value) => update('maxResultBytes', value)} />
              <NumberField label={t('sidepanel.mcpPage.form.toolLimit')} value={form.maxToolCount} onChange={(value) => update('maxToolCount', value)} />
            </div>

            <div className="ds-surface-panel rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
                  {t('sidepanel.mcpPage.form.defaultExecution')}
                </span>
                <ToggleSwitch
                  checked={form.executionEnabled}
                  onChange={(executionEnabled) => update('executionEnabled', executionEnabled)}
                  label={t('sidepanel.mcpPage.form.allowInject')}
                />
              </div>
              <select
                value={form.executionMode}
                onChange={(event) => update('executionMode', event.target.value as ToolExecutionMode)}
                className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              >
                <option value="auto">{t('sidepanel.mcpPage.form.modeAuto')}</option>
                <option value="manual">{t('sidepanel.mcpPage.form.modeManual')}</option>
                <option value="disabled">{t('sidepanel.mcpPage.form.modeDisabled')}</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} className="ds-btn-cancel px-3 py-1.5 text-xs rounded-lg transition-colors">
          {t('common.cancel')}
        </Button>
        <Button type="button" size="sm" onClick={save} className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors">
          {t('sidepanel.mcpPage.form.save')}
        </Button>
      </div>
    </div>
  );
}

function HeaderEditor({
  headers,
  secrets,
  onHeadersChange,
  onSecretsChange,
}: {
  headers: McpHeaderValue[];
  secrets: McpSecretValue[];
  onHeadersChange: (headers: McpHeaderValue[]) => void;
  onSecretsChange: (secrets: McpSecretValue[]) => void;
}) {
  const { t } = useI18n();
  const updateHeader = (index: number, patch: Partial<McpHeaderValue>) => {
    onHeadersChange(headers.map((header, itemIndex) => itemIndex === index ? { ...header, ...patch } : header));
  };
  const updateSecret = (index: number, patch: Partial<McpSecretValue>) => {
    onSecretsChange(secrets.map((secret, itemIndex) => itemIndex === index ? { ...secret, ...patch } : secret));
  };

  return (
    <div className="ds-surface-panel rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>Headers</span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onHeadersChange([...headers, { name: '', value: '' }])}
          className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md"
        >
          {t('common.add')}
        </Button>
      </div>
      {headers.map((header, index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
          <input
            value={header.name}
            onChange={(event) => updateHeader(index, { name: event.target.value })}
            className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
            placeholder={t('sidepanel.mcpPage.headers.headerName')}
          />
          <input
            value={header.value}
            onChange={(event) => updateHeader(index, { value: event.target.value })}
            className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
            placeholder={t('sidepanel.mcpPage.headers.headerValue')}
          />
          <Button
            type="button"
            variant="destructive"
            size="xs"
            onClick={() => onHeadersChange(headers.filter((_, itemIndex) => itemIndex !== index))}
            className="ds-action-btn ds-action-btn-delete w-8 rounded-lg text-xs"
          >
            ×
          </Button>
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>Secrets</span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onSecretsChange([...secrets, { id: crypto.randomUUID(), kind: 'bearer', value: '' }])}
          className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md"
        >
          {t('common.add')}
        </Button>
      </div>
      {secrets.map((secret, index) => (
        <div key={index} className="space-y-1.5">
          <div className="grid grid-cols-[90px_1fr_auto] gap-1.5">
            <select
              value={secret.kind}
              onChange={(event) => updateSecret(index, { kind: event.target.value as McpSecretValue['kind'] })}
              className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
            >
              <option value="bearer">Bearer</option>
              <option value="basic">Basic</option>
              <option value="header">Header</option>
            </select>
            <input
              value={secret.value}
              onChange={(event) => updateSecret(index, { value: event.target.value })}
              className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
              placeholder={t('sidepanel.mcpPage.headers.secretValue')}
              type="password"
            />
            <Button
              type="button"
              variant="destructive"
              size="xs"
              onClick={() => onSecretsChange(secrets.filter((_, itemIndex) => itemIndex !== index))}
              className="ds-action-btn ds-action-btn-delete w-8 rounded-lg text-xs"
            >
              ×
            </Button>
          </div>
          {secret.kind === 'header' && (
            <input
              value={secret.headerName ?? ''}
              onChange={(event) => updateSecret(index, { headerName: event.target.value })}
              className="ds-input w-full rounded-lg px-2 py-1.5 text-xs"
              placeholder={t('sidepanel.mcpPage.headers.secretHeaderName')}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ServerRow({
  server,
  cache,
  selected,
  expanded,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
  t,
}: {
  server: McpServerConfig;
  cache: McpToolCacheEntry | null;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  t: Translator;
}) {
  const status = statusMeta(cache?.health.status ?? server.status, t);
  const activeTools = enabledToolCount(server, cache?.descriptors ?? []);
  const totalTools = cache?.descriptors.length ?? 0;
  const displayName = connectorDisplayName(server, t);

  return (
    <div
      className="ds-connector-row"
      data-selected={selected ? 'true' : 'false'}
      onClick={onSelect}
    >
      <div className="ds-connector-row-main">
        <div className="ds-connector-row-titleline">
          <svg
            className="ds-connector-chevron"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="ds-connector-row-title">{displayName}</span>
          <span className="ds-connector-state" data-tone={status.tone}>
            {status.label}
          </span>
        </div>
        <div className="ds-connector-row-meta">
          {connectorKindLabel(server, t)} · {t('sidepanel.mcpPage.row.autoTools', {
            active: activeTools,
            total: totalTools,
          })}
        </div>
      </div>
      <div className="ds-connector-row-actions" onClick={(event) => event.stopPropagation()}>
        <span className="ds-connector-enabled-state">{server.enabled ? t('common.on') : t('common.off')}</span>
        <ToggleSwitch
          checked={server.enabled}
          onChange={() => onToggle()}
          label={t('sidepanel.mcpPage.enabled')}
        />
        <Button type="button" variant="outline" size="xs" onClick={onEdit} className="ds-action-btn ds-action-btn-edit px-2 py-1 text-[11px] rounded-md">
          {t('common.edit')}
        </Button>
        <Button type="button" variant="destructive" size="xs" onClick={onDelete} className="ds-action-btn ds-action-btn-delete px-2 py-1 text-[11px] rounded-md">
          {t('common.delete')}
        </Button>
      </div>
    </div>
  );
}

function ServerDetail({
  server,
  cache,
  history,
  busy,
  onPatch,
  onRequestPermission,
  onRefresh,
  onTest,
  onToggleTool,
  t,
  locale,
}: {
  server: McpServerConfig;
  cache: McpToolCacheEntry | null;
  history: ToolCallHistoryRecord[];
  busy: BusyAction | null;
  onPatch: (patch: Partial<McpServerConfig>) => Promise<void>;
  onRequestPermission: () => void;
  onRefresh: () => void;
  onTest: () => void;
  onToggleTool: (tool: ToolDescriptor) => void;
  t: Translator;
  locale: SupportedLocale;
}) {
  const tools = cache?.descriptors ?? [];
  const serverHistory = history.filter((record) => record.call.provider?.id === server.id).slice(0, 5);
  const [historyOpen, setHistoryOpen] = useState(false);
  const status = statusMeta(cache?.health.status ?? server.status, t);
  const errorMessage = connectorErrorMessage(server, cache, t);

  return (
    <div className="ds-connector-detail animate-slide-down">
      <div className="ds-connector-detail-head">
        <div className="ds-connector-detail-copy">
          <div className="ds-connector-section-title">{t('sidepanel.mcpPage.detail.connection')}</div>
          <div className="ds-connector-endpoint">{connectionSummary(server, t)}</div>
        </div>
        <div className="ds-connector-detail-actions">
          {requiresOriginPermission(server) && (
            <Button type="button" variant="outline" size="xs" onClick={onRequestPermission} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
              {t('sidepanel.mcpPage.detail.grant')}
            </Button>
          )}
          <Button type="button" variant="outline" size="xs" onClick={onTest} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
            {busy === 'test' ? t('sidepanel.mcpPage.row.testing') : t('common.test')}
          </Button>
          <Button type="button" variant="outline" size="xs" onClick={onRefresh} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
            {busy === 'refresh' ? t('sidepanel.toolsPage.pythonRefreshing') : t('sidepanel.mcpPage.row.refreshTools')}
          </Button>
        </div>
      </div>

      <div className="ds-connector-facts">
        <ConnectorFact label={t('sidepanel.mcpPage.detail.status')} value={status.label} tone={status.tone} />
        <ConnectorFact label={t('sidepanel.mcpPage.detail.latency')} value={formatMs(cache?.health.latencyMs ?? null)} />
        <ConnectorFact label={t('sidepanel.mcpPage.detail.lastConnected')} value={formatTime(server.lastConnectedAt ?? cache?.health.checkedAt ?? null, locale)} />
        <ConnectorFact label={t('sidepanel.mcpPage.detail.transport')} value={connectorKindLabel(server, t)} />
      </div>

      {errorMessage && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', border: '1px solid var(--ds-danger-border)' }}>
          {errorMessage}
        </div>
      )}

      {isShellServer(server) && (
        <ShellSetupHint server={server} cache={cache} t={t} />
      )}

      {isMultimodalServer(server) && (
        <MultimodalSetupHint server={server} cache={cache} t={t} />
      )}

      <div className="ds-connector-policy">
        <ToggleRow
          title={t('sidepanel.mcpPage.detail.executionPolicy')}
          description={t('sidepanel.mcpPage.detail.injectionSummary', { count: enabledToolCount(server, tools) })}
          enabled={server.execution.enabled}
          onToggle={(enabled) => onPatch({ execution: { ...server.execution, enabled } })}
        />
        <select
          value={server.execution.mode}
          onChange={(event) => onPatch({ execution: { ...server.execution, mode: event.target.value as ToolExecutionMode } })}
          className="ds-input w-full rounded-lg px-3 py-2 text-sm"
        >
          <option value="auto">{t('sidepanel.mcpPage.form.modeAuto')}</option>
          <option value="manual">{t('sidepanel.mcpPage.form.modeManual')}</option>
          <option value="disabled">{t('sidepanel.mcpPage.form.modeDisabled')}</option>
        </select>
      </div>

      <CollapsibleSection
        label={t('sidepanel.mcpPage.detail.discoveredTools')}
        count={tools.length}
        defaultOpen
      >
        {tools.length === 0 ? (
          <div className="text-xs py-6 text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.mcpPage.detail.noTools')}
          </div>
        ) : (
          <div className="ds-connector-tool-list">
            {tools.map((tool) => (
              <ToolRow key={tool.id} server={server} tool={tool} onToggle={() => onToggleTool(tool)} t={t} />
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        label={t('sidepanel.mcpPage.detail.recentCalls')}
        count={serverHistory.length}
        defaultOpen={false}
        open={historyOpen}
        onToggle={() => setHistoryOpen((prev) => !prev)}
      >
        {serverHistory.length === 0 ? (
          <div className="text-xs py-3 text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.mcpPage.detail.noHistory')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {serverHistory.map((record) => (
              <div key={record.id} className="ds-connector-history-row">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--ds-text)' }}>
                    {historyActionLabel(record, tools, t)}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color: record.result.ok ? 'var(--ds-success)' : 'var(--ds-danger)', background: record.result.ok ? 'var(--ds-success-bg)' : 'var(--ds-danger-bg)' }}>
                    {record.result.ok ? t('sidepanel.mcpPage.success') : t('sidepanel.mcpPage.failure')}
                  </span>
                </div>
                <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
                  {formatTime(record.createdAt, locale)} · {record.result.summary}
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}

function CollapsibleSection({
  label,
  count,
  defaultOpen,
  open: openProp,
  onToggle: onToggleProp,
  children,
}: {
  label: string;
  count: number;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const toggle = () => (isControlled ? onToggleProp?.() : setInternalOpen((prev) => !prev));
  return (
    <div className="ds-connector-disclosure">
      <button
        type="button"
        onClick={toggle}
        className="ds-connector-disclosure-trigger"
      >
        <span className="ds-connector-disclosure-label">
          <svg
            className="ds-connector-chevron"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {label}
        </span>
        <span className="ds-connector-disclosure-count">{count}</span>
      </button>
      {open && children}
    </div>
  );
}

function ToolRow({
  server,
  tool,
  onToggle,
  t,
}: {
  server: McpServerConfig;
  tool: ToolDescriptor;
  onToggle: () => void;
  t: Translator;
}) {
  const enabled = isToolEnabled(server, tool);
  const label = toolDisplayName(tool, t);
  return (
    <div className="ds-connector-tool-row">
      <div className="ds-connector-tool-copy">
        <div className="ds-connector-tool-title">{label}</div>
        {tool.description && (
          <div className="ds-connector-tool-description">{tool.description}</div>
        )}
      </div>
      <div className="ds-connector-tool-action">
        <span className="ds-connector-enabled-state">{enabled ? t('common.on') : t('common.off')}</span>
        <ToggleSwitch
          checked={enabled}
          onChange={() => onToggle()}
          label={label}
        />
      </div>
    </div>
  );
}

function EmptyState({ label, hint, actions }: { label: string; hint?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--ds-surface)' }}>
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ color: 'var(--ds-text-tertiary)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5h3a3 3 0 110 6h-3m-3-6h-3a3 3 0 100 6h3m-1.5-3h6" />
        </svg>
      </div>
      <p className="text-sm" style={{ color: 'var(--ds-text-tertiary)' }}>{label}</p>
      {hint && <p className="text-[11px] -mt-1 max-w-[240px]" style={{ color: 'var(--ds-text-tertiary)' }}>{hint}</p>}
      {actions && <div className="flex flex-wrap gap-2 justify-center mt-1">{actions}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs mb-1" style={{ color: 'var(--ds-text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="min-w-0 flex-1">
      <Field label={label}>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="ds-input min-w-0 w-full rounded-lg px-2 py-1.5 text-xs"
          inputMode="numeric"
        />
      </Field>
    </div>
  );
}

type ConnectorStatusTone = 'ready' | 'attention' | 'blocked';
type ConnectorStatusFactTone = 'normal' | 'muted' | 'attention' | 'blocked';
type ConnectorStatusAction = 'retry' | 'add';

interface ConnectorStatusModel {
  statusKey: LocaleMessageKey;
  descriptionKey: LocaleMessageKey;
  nextKey: LocaleMessageKey;
  actionLabelKey: LocaleMessageKey;
  tone: ConnectorStatusTone;
  connectors: string;
  connectorsTone: ConnectorStatusFactTone;
  actions: string;
  actionsTone: ConnectorStatusFactTone;
  action: ConnectorStatusAction | null;
}

function getConnectorStatusBadgeVariant(tone: ConnectorStatusTone): ComponentProps<typeof Badge>['variant'] {
  if (tone === 'blocked') return 'destructive';
  if (tone === 'attention') return 'secondary';
  return 'outline';
}

function createConnectorStatusModel({
  loading,
  servers,
  enabledCount,
  toolCount,
  loadIssues,
  hasConnectorListIssue,
  t,
}: {
  loading: boolean;
  servers: McpServerConfig[];
  enabledCount: number;
  toolCount: number;
  loadIssues: McpLoadIssue[];
  hasConnectorListIssue: boolean;
  t: Translator;
}): ConnectorStatusModel {
  if (loading && servers.length === 0) {
    return {
      statusKey: 'sidepanel.mcpPage.readinessChecking',
      descriptionKey: 'sidepanel.mcpPage.readinessCheckingDescription',
      nextKey: 'sidepanel.mcpPage.readinessNextChecking',
      actionLabelKey: 'sidepanel.mcpPage.readinessActionRetry',
      tone: 'attention',
      connectors: t('sidepanel.mcpPage.readinessValueChecking'),
      connectorsTone: 'muted',
      actions: t('sidepanel.mcpPage.readinessValueChecking'),
      actionsTone: 'muted',
      action: null,
    };
  }

  if (hasConnectorListIssue && servers.length === 0) {
    return {
      statusKey: 'sidepanel.mcpPage.readinessNeedsRefresh',
      descriptionKey: 'sidepanel.mcpPage.readinessBlockedDescription',
      nextKey: 'sidepanel.mcpPage.readinessNextRetry',
      actionLabelKey: 'sidepanel.mcpPage.readinessActionRetry',
      tone: 'blocked',
      connectors: t('common.unavailable'),
      connectorsTone: 'blocked',
      actions: t('common.unavailable'),
      actionsTone: 'blocked',
      action: 'retry',
    };
  }

  if (loadIssues.length > 0) {
    return {
      statusKey: 'sidepanel.mcpPage.readinessNeedsRefresh',
      descriptionKey: 'sidepanel.mcpPage.readinessPartialDescription',
      nextKey: 'sidepanel.mcpPage.readinessNextRetry',
      actionLabelKey: 'sidepanel.mcpPage.readinessActionRetry',
      tone: 'attention',
      connectors: formatConnectorStatusCount(enabledCount, servers.length, t),
      connectorsTone: servers.length > 0 ? 'normal' : 'attention',
      actions: formatConnectorActionCount(toolCount, t),
      actionsTone: toolCount > 0 ? 'normal' : 'attention',
      action: 'retry',
    };
  }

  if (servers.length === 0) {
    return {
      statusKey: 'sidepanel.mcpPage.readinessEmpty',
      descriptionKey: 'sidepanel.mcpPage.readinessEmptyDescription',
      nextKey: 'sidepanel.mcpPage.readinessNextAdd',
      actionLabelKey: 'sidepanel.mcpPage.readinessActionAdd',
      tone: 'attention',
      connectors: t('common.none'),
      connectorsTone: 'muted',
      actions: t('common.none'),
      actionsTone: 'muted',
      action: 'add',
    };
  }

  if (enabledCount === 0) {
    return {
      statusKey: 'sidepanel.mcpPage.readinessAllOff',
      descriptionKey: 'sidepanel.mcpPage.readinessAllOffDescription',
      nextKey: 'sidepanel.mcpPage.readinessNextEnable',
      actionLabelKey: 'sidepanel.mcpPage.readinessActionAdd',
      tone: 'attention',
      connectors: formatConnectorStatusCount(enabledCount, servers.length, t),
      connectorsTone: 'attention',
      actions: t('common.none'),
      actionsTone: 'muted',
      action: null,
    };
  }

  if (toolCount === 0) {
    return {
      statusKey: 'sidepanel.mcpPage.readinessNeedsActions',
      descriptionKey: 'sidepanel.mcpPage.readinessNeedsActionsDescription',
      nextKey: 'sidepanel.mcpPage.readinessNextRefreshActions',
      actionLabelKey: 'sidepanel.mcpPage.readinessActionRetry',
      tone: 'attention',
      connectors: formatConnectorStatusCount(enabledCount, servers.length, t),
      connectorsTone: 'normal',
      actions: t('common.none'),
      actionsTone: 'attention',
      action: null,
    };
  }

  return {
    statusKey: 'sidepanel.mcpPage.readinessReady',
    descriptionKey: 'sidepanel.mcpPage.readinessReadyDescription',
    nextKey: 'sidepanel.mcpPage.readinessNextContinue',
    actionLabelKey: 'sidepanel.mcpPage.readinessActionRetry',
    tone: 'ready',
    connectors: formatConnectorStatusCount(enabledCount, servers.length, t),
    connectorsTone: 'normal',
    actions: formatConnectorActionCount(toolCount, t),
    actionsTone: 'normal',
    action: null,
  };
}

function formatConnectorStatusCount(enabled: number, total: number, t: Translator): string {
  return t('sidepanel.mcpPage.readinessConnectorsEnabled', { enabled, total });
}

function formatConnectorActionCount(count: number, t: Translator): string {
  return count > 0
    ? t('sidepanel.mcpPage.readinessActionsAvailable', { count })
    : t('common.none');
}

function ConnectorStatusRow({ label, value, tone = 'normal' }: {
  label: string;
  value: string;
  tone?: ConnectorStatusFactTone;
}) {
  return (
    <div className={`ds-connector-status-row ds-connector-status-row-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ConnectorFact({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'ready' | 'error' | 'muted';
}) {
  return (
    <div className="ds-connector-fact">
      <span className="ds-connector-fact-label">{label}</span>
      <span className="ds-connector-fact-value" data-tone={tone}>{value}</span>
    </div>
  );
}

function CopyableCommand({ command, copyLabel, copiedLabel }: {
  command: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="ds-command-block">
      <code className="ds-command-block-text">{command}</code>
      <Button type="button" variant="outline" size="xs" onClick={handleCopy} className="ds-btn-secondary px-2 py-1 text-[10px] rounded-md shrink-0">
        {copied ? copiedLabel : copyLabel}
      </Button>
    </div>
  );
}

function formFromServer(server: McpServerConfig, t: Translator): FormState {
  return {
    displayName: connectorDisplayName(server, t),
    enabled: server.enabled,
    transportKind: server.transport.kind,
    url: server.transport.url ?? '',
    nativeHost: server.transport.nativeHost ?? '',
    command: server.transport.command ?? '',
    args: server.transport.args?.join(' ') ?? '',
    cwd: server.transport.cwd ?? '',
    env: Object.entries(server.transport.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
    headers: server.headers.length > 0 ? server.headers : [],
    secrets: server.secrets.length > 0 ? server.secrets : [],
    connectMs: String(server.timeouts.connectMs),
    requestMs: String(server.timeouts.requestMs),
    discoveryMs: String(server.timeouts.discoveryMs),
    maxResultBytes: String(server.limits.maxResultBytes),
    maxToolCount: String(server.limits.maxToolCount),
    executionEnabled: server.execution.enabled,
    executionMode: server.execution.mode,
  };
}

function payloadFromForm(
  form: FormState,
  t: Translator,
  platform: PlatformEnvironment | null,
): { payload: McpServerCreateInput } | { error: string } {
  const displayName = form.displayName.trim();
  if (!displayName) return { error: t('sidepanel.mcpPage.validation.nameRequired') };

  const timeouts = {
    connectMs: positiveInt(form.connectMs, t('sidepanel.mcpPage.form.connectMs'), t),
    requestMs: positiveInt(form.requestMs, t('sidepanel.mcpPage.form.requestMs'), t),
    discoveryMs: positiveInt(form.discoveryMs, t('sidepanel.mcpPage.form.discoveryMs'), t),
  };
  const limits = {
    maxResultBytes: positiveInt(form.maxResultBytes, t('sidepanel.mcpPage.form.resultBytes'), t),
    maxToolCount: positiveInt(form.maxToolCount, t('sidepanel.mcpPage.form.toolLimit'), t),
  };
  const invalidNumber = Object.values(timeouts).find((value) => typeof value === 'string') ||
    Object.values(limits).find((value) => typeof value === 'string');
  if (typeof invalidNumber === 'string') return { error: invalidNumber };

  const transportResult = transportFromForm(form, t, platform);
  if ('error' in transportResult) return transportResult;

  const headersResult = normalizeHeaders(form.headers, t);
  if ('error' in headersResult) return headersResult;

  const secretsResult = normalizeSecrets(form.secrets, t);
  if ('error' in secretsResult) return secretsResult;

  return {
    payload: {
      displayName,
      enabled: form.enabled,
      transport: transportResult.transport,
      headers: headersResult.headers,
      secrets: secretsResult.secrets,
      timeouts: timeouts as { connectMs: number; requestMs: number; discoveryMs: number },
      limits: limits as { maxResultBytes: number; maxToolCount: number },
      allowlist: {
        mode: 'all',
        toolNames: [],
      },
      execution: {
        enabled: form.executionEnabled,
        mode: form.executionMode,
      },
    },
  };
}

function transportFromForm(
  form: FormState,
  t: Translator,
  platform: PlatformEnvironment | null,
): { transport: McpServerTransportConfig } | { error: string } {
  if (form.transportKind === 'native_messaging') {
    if (!isShellNativeHostSupported(platform)) {
      return { error: t('sidepanel.mcpPage.messages.nativeMessagingUnsupported') };
    }
    const nativeHost = form.nativeHost.trim();
    if (!nativeHost) return { error: t('sidepanel.mcpPage.validation.nativeHostRequired') };
    if (!/^[A-Za-z0-9_.-]+$/.test(nativeHost)) return { error: t('sidepanel.mcpPage.validation.nativeHostInvalid') };
    return { transport: { kind: 'native_messaging', nativeHost } };
  }

  const url = form.url.trim();
  if (!url) return { error: t('sidepanel.mcpPage.validation.serviceUrlRequired') };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: t('sidepanel.mcpPage.validation.serviceUrlUnsupported') };
  } catch {
    return { error: t('sidepanel.mcpPage.validation.serviceUrlInvalid') };
  }

  if (form.transportKind !== 'stdio_bridge') {
    return { transport: { kind: form.transportKind, url } };
  }

  const env = parseEnv(form.env, t);
  if ('error' in env) return env;
  const command = form.command.trim();
  if (!command) return { error: t('sidepanel.mcpPage.validation.stdioCommandRequired') };
  return {
    transport: {
      kind: 'stdio_bridge',
      url,
      command,
      args: form.args.split(/\s+/).map((item) => item.trim()).filter(Boolean),
      cwd: form.cwd.trim(),
      env: env.env,
    },
  };
}

function normalizeHeaders(headers: McpHeaderValue[], t: Translator): { headers: McpHeaderValue[] } | { error: string } {
  const normalized: McpHeaderValue[] = [];
  for (const header of headers) {
    const name = header.name.trim();
    const value = header.value;
    if (!name && !value) continue;
    if (!isHeaderName(name)) {
      return {
        error: t('sidepanel.mcpPage.validation.headerInvalidName', {
          name: name || t('sidepanel.mcpPage.validation.emptyValue'),
        }),
      };
    }
    if (value.includes('\n') || value.includes('\r')) {
      return { error: t('sidepanel.mcpPage.validation.headerInvalidValue', { name }) };
    }
    normalized.push({ name, value });
  }
  return { headers: normalized };
}

function normalizeSecrets(secrets: McpSecretValue[], t: Translator): { secrets: McpSecretValue[] } | { error: string } {
  const normalized: McpSecretValue[] = [];
  for (const secret of secrets) {
    const value = secret.value.trim();
    const headerName = secret.headerName?.trim();
    if (!value && !headerName && !secret.username) continue;
    if (secret.kind === 'header' && !isHeaderName(headerName ?? '')) {
      return { error: t('sidepanel.mcpPage.validation.headerSecretRequired') };
    }
    normalized.push({
      id: secret.id || crypto.randomUUID(),
      kind: secret.kind,
      value,
      headerName,
      username: secret.username?.trim(),
    });
  }
  return { secrets: normalized };
}

function parseEnv(value: string, t: Translator): { env: Record<string, string> } | { error: string } {
  const env: Record<string, string> = {};
  for (const rawLine of value.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const index = line.indexOf('=');
    if (index <= 0) return { error: t('sidepanel.mcpPage.validation.envInvalid', { line }) };
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return { env };
}

function positiveInt(value: string, label: string, t: Translator): number | string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return t('sidepanel.mcpPage.validation.positiveInteger', { label });
  }
  return parsed;
}

function isHeaderName(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}

function requiresOriginPermission(server: McpServerConfig): boolean {
  return server.transport.kind !== 'native_messaging' && Boolean(server.transport.url);
}

async function requestMcpOriginPermission(server: McpServerConfig): Promise<{
  ok: boolean;
  origin: string | null;
  error?: string;
}> {
  if (!requiresOriginPermission(server)) return { ok: true, origin: null };
  try {
    const origin = getOriginPattern(server.transport.url ?? '');
    if (!chrome.permissions?.contains || !chrome.permissions?.request) return { ok: true, origin };
    const granted = await chrome.permissions.contains({ origins: [origin] }).catch(() => false);
    if (granted) return { ok: true, origin };
    const ok = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    return { ok, origin };
  } catch (err) {
    return { ok: false, origin: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function getOriginPattern(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Service URL only supports http/https');
  }
  return `${parsed.protocol}//${parsed.host}/*`;
}

function enabledToolCount(server: McpServerConfig, tools: ToolDescriptor[]): number {
  return tools.filter((tool) => isToolEnabled(server, tool)).length;
}

function isToolEnabled(server: McpServerConfig, tool: ToolDescriptor): boolean {
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
  const preferredName = tool.name;
  const removeTool = () => {
    names.delete(tool.name);
    names.delete(tool.invocationName);
  };

  if (allowlist.mode === 'allow') {
    if (shouldEnable) names.add(preferredName);
    else removeTool();
    return { mode: 'allow', toolNames: [...names] };
  }

  if (allowlist.mode === 'deny') {
    if (shouldEnable) removeTool();
    else names.add(preferredName);
    return { mode: names.size === 0 ? 'all' : 'deny', toolNames: [...names] };
  }

  if (!shouldEnable) {
    return { mode: 'deny', toolNames: [preferredName] };
  }
  return allowlist;
}

function statusMeta(status: McpServerStatus, t: Translator) {
  if (status === 'ready') return { label: t('sidepanel.mcpPage.status.ready'), tone: 'ready' as const };
  if (status === 'error') return { label: t('sidepanel.mcpPage.status.error'), tone: 'error' as const };
  if (status === 'disabled') return { label: t('sidepanel.mcpPage.status.disabled'), tone: 'muted' as const };
  return { label: t('sidepanel.mcpPage.status.unknown'), tone: 'neutral' as const };
}

function connectorKindLabel(server: McpServerConfig, t: Translator): string {
  if (isShellServer(server)) return t('sidepanel.mcpPage.kind.localComputer');
  if (isMultimodalServer(server)) return t('sidepanel.mcpPage.kind.mediaAnalysis');
  if (server.transport.kind === 'native_messaging') return t('sidepanel.mcpPage.kind.browserHost');
  if (server.transport.kind === 'stdio_bridge') return t('sidepanel.mcpPage.kind.localBridge');
  return t('sidepanel.mcpPage.kind.webService');
}

function connectorDisplayName(server: McpServerConfig, t: Translator): string {
  if (isShellServer(server) || isMultimodalServer(server)) return connectorKindLabel(server, t);
  return server.displayName;
}

function connectionSummary(server: McpServerConfig, t: Translator): string {
  if (server.transport.kind === 'native_messaging') return connectorKindLabel(server, t);
  if (server.transport.kind === 'stdio_bridge') {
    const origin = safeOrigin(server.transport.url);
    const command = server.transport.command?.trim();
    if (origin && command) return `${origin} · ${command}`;
    return origin || command || connectorKindLabel(server, t);
  }
  return safeOrigin(server.transport.url) || connectorKindLabel(server, t);
}

function safeOrigin(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function toolDisplayName(tool: ToolDescriptor, t: Translator): string {
  const title = tool.title.trim();
  if (title) return title;
  return t('sidepanel.mcpPage.detail.connectorAction');
}

function historyActionLabel(record: ToolCallHistoryRecord, tools: ToolDescriptor[], t: Translator): string {
  const descriptor = tools.find((tool) =>
    tool.id === record.call.descriptorId ||
    tool.name === record.call.name ||
    tool.invocationName === record.call.invocationName ||
    tool.invocationName === record.call.name
  );
  if (descriptor) return toolDisplayName(descriptor, t);
  return t('sidepanel.mcpPage.detail.connectorAction');
}

function connectorErrorMessage(
  server: McpServerConfig,
  cache: McpToolCacheEntry | null,
  t: Translator,
): string {
  const raw = cache?.health.error ?? server.lastError;
  if (!raw) return '';
  if (server.transport.kind === 'native_messaging') {
    return nativeSetupMessage(server, cache, t, isMultimodalServer(server) ? 'multimodal' : 'shell').message;
  }
  return t('sidepanel.mcpPage.messages.connectionFailed');
}

function isShellServer(server: McpServerConfig): boolean {
  return server.displayName === SHELL_MCP_SERVER_NAME || server.transport.nativeHost === SHELL_MCP_NATIVE_HOST;
}

function isMultimodalServer(server: McpServerConfig): boolean {
  return server.displayName === MULTIMODAL_MCP_SERVER_NAME ||
    server.displayName === LEGACY_MULTIMODAL_MCP_SERVER_NAME ||
    server.transport.nativeHost === MULTIMODAL_MCP_NATIVE_HOST;
}

function ShellSetupHint({
  server,
  cache,
  t,
}: {
  server: McpServerConfig;
  cache: McpToolCacheEntry | null;
  t: Translator;
}) {
  const { message, isError } = shellSetupMessage(server, cache, t);
  const setup = shellInstallCommand();
  return (
    <NativeHostHint
      title={t('sidepanel.mcpPage.shellSetup.title')}
      message={message}
      isError={isError}
      ready={cache?.health.status === 'ready'}
      setup={setup}
      installSteps={(<>
        <div style={{ color: 'var(--ds-text-tertiary)' }}>
          {setup.mode === 'local'
            ? t('sidepanel.mcpPage.shellSetup.localIntro')
            : t('sidepanel.mcpPage.shellSetup.publishedIntro')}
        </div>
        <div className="mt-1 font-mono break-all select-all rounded px-2 py-1" style={{ color: 'var(--ds-text)', background: 'var(--ds-surface)' }}>
          {setup.command}
        </div>
        {setup.fallbackCommand && (
          <>
            <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.mcpPage.shellSetup.fallbackIntro')}
            </div>
            <div className="mt-1 font-mono break-all select-all rounded px-2 py-1" style={{ color: 'var(--ds-text)', background: 'var(--ds-surface)' }}>
              {setup.fallbackCommand}
            </div>
          </>
        )}
        <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
          {setup.usesExtensionId
            ? t('sidepanel.mcpPage.shellSetup.detectedExtensionId', { browser: browserLabel(setup.browser) })
            : t('sidepanel.mcpPage.shellSetup.firefoxFixedId')}
        </div>
        <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.mcpPage.shellSetup.installNote')}
        </div>
        <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
          {!server.enabled
            ? t('sidepanel.mcpPage.shellSetup.enableAndTest')
            : t('sidepanel.mcpPage.shellSetup.restartAndTest')}
        </div>
      </>)}
      t={t}
    />
  );
}

function MultimodalSetupHint({
  server,
  cache,
  t,
}: {
  server: McpServerConfig;
  cache: McpToolCacheEntry | null;
  t: Translator;
}) {
  const { message, isError } = nativeSetupMessage(server, cache, t, 'multimodal');
  const setup = multimodalInstallCommand();
  return (
    <NativeHostHint
      title={t('sidepanel.mcpPage.multimodalSetup.title')}
      message={message}
      isError={isError}
      ready={cache?.health.status === 'ready'}
      setup={setup}
      installSteps={(<>
        <div style={{ color: 'var(--ds-text-tertiary)' }}>
          {setup.mode === 'local'
            ? t('sidepanel.mcpPage.multimodalSetup.localIntro')
            : t('sidepanel.mcpPage.multimodalSetup.publishedIntro')}
        </div>
        <div className="mt-1 font-mono break-all select-all rounded px-2 py-1" style={{ color: 'var(--ds-text)', background: 'var(--ds-surface)' }}>
          {setup.command}
        </div>
        {setup.fallbackCommand && (
          <>
            <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.mcpPage.multimodalSetup.fallbackIntro')}
            </div>
            <div className="mt-1 font-mono break-all select-all rounded px-2 py-1" style={{ color: 'var(--ds-text)', background: 'var(--ds-surface)' }}>
              {setup.fallbackCommand}
            </div>
          </>
        )}
        <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
          {setup.usesExtensionId
            ? t('sidepanel.mcpPage.shellSetup.detectedExtensionId', { browser: browserLabel(setup.browser) })
            : t('sidepanel.mcpPage.shellSetup.firefoxFixedId')}
        </div>
        <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.mcpPage.multimodalSetup.settingsNote')}
        </div>
        <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
          {!server.enabled
            ? t('sidepanel.mcpPage.multimodalSetup.enableAndTest')
            : t('sidepanel.mcpPage.shellSetup.restartAndTest')}
        </div>
      </>)}
      t={t}
    />
  );
}

function NativeHostHint({
  title,
  message,
  isError,
  ready,
  installSteps,
  t,
}: {
  title: string;
  message: string;
  isError: boolean;
  ready: boolean;
  setup: { mode: string };
  installSteps: ReactNode;
  t: Translator;
}) {
  // Expanded by default on error / not-installed; collapsed when already connected.
  // The toggle is fully user-controlled — initial state is derived from `ready`
  // via a lazy initializer so subsequent re-renders (frequent load() refreshes)
  // never reset the user's choice.
  const [open, setOpen] = useState(() => !ready);
  return (
    <div className="ds-connector-setup">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="ds-connector-setup-trigger"
      >
        <svg
          className="ds-connector-chevron"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)' }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span>{title}</span>
      </button>
      {open ? (
        <>
          {isError ? (
            <div className="ds-connector-error">
              {message}
            </div>
          ) : (
            <div className="ds-connector-setup-message">{message}</div>
          )}
          <div className="ds-connector-setup-steps">{installSteps}</div>
        </>
      ) : (
        <div className="ds-connector-setup-collapsed">
          {t('sidepanel.mcpPage.detail.hintExpand')}
        </div>
      )}
    </div>
  );
}

type NativeHostBrowser = 'chrome' | 'chromium' | 'edge' | 'firefox';

function shellInstallCommand(): {
  browser: NativeHostBrowser;
  command: string;
  fallbackCommand?: string;
  usesExtensionId: boolean;
  mode: 'local' | 'published';
} {
  const browser = currentNativeHostBrowser();
  const usesExtensionId = browser !== 'firefox';
  const extensionArg = usesExtensionId ? ` --extension-id ${chrome.runtime.id || '<extension-id>'}` : '';
  const installArgs = `install --browser ${browser}${extensionArg} --skip-officecli`;
  const localCommand = `npm run shell:install -- ${installArgs}`;
  const publishedCommand = `npx deepseek-pp-shell-host ${installArgs}`;

  if (isUnpackedExtension()) {
    return { browser, command: localCommand, fallbackCommand: publishedCommand, usesExtensionId, mode: 'local' };
  }

  return { browser, command: publishedCommand, usesExtensionId, mode: 'published' };
}

function multimodalInstallCommand(): {
  browser: NativeHostBrowser;
  command: string;
  fallbackCommand?: string;
  usesExtensionId: boolean;
  mode: 'local' | 'published';
} {
  const browser = currentNativeHostBrowser();
  const usesExtensionId = browser !== 'firefox';
  const extensionArg = usesExtensionId ? ` --extension-id ${chrome.runtime.id || '<extension-id>'}` : '';
  const installArgs = `install --browser ${browser}${extensionArg}`;
  const localCommand = `npm run multimodal:install -- ${installArgs}`;
  const publishedCommand = `npx ${MULTIMODAL_MCP_PACKAGE_NAME} ${installArgs}`;

  if (isUnpackedExtension()) {
    return { browser, command: localCommand, fallbackCommand: publishedCommand, usesExtensionId, mode: 'local' };
  }

  return { browser, command: publishedCommand, usesExtensionId, mode: 'published' };
}

function isUnpackedExtension(): boolean {
  return !chrome.runtime.getManifest().update_url;
}

function currentNativeHostBrowser(): NativeHostBrowser {
  const ua = navigator.userAgent;
  if (/\bFirefox\//.test(ua)) return 'firefox';
  if (/\bEdg\//.test(ua)) return 'edge';
  if (/\bChromium\//.test(ua) && !/\bChrome\//.test(ua)) return 'chromium';
  return 'chrome';
}

function browserLabel(browser: NativeHostBrowser): string {
  if (browser === 'edge') return 'Edge';
  if (browser === 'firefox') return 'Firefox';
  if (browser === 'chromium') return 'Chromium';
  return 'Chrome';
}

function shellSetupMessage(
  server: McpServerConfig,
  cache: McpToolCacheEntry | null,
  t: Translator,
): { message: string; isError: boolean } {
  return nativeSetupMessage(server, cache, t, 'shell');
}

function nativeSetupMessage(
  server: McpServerConfig,
  cache: McpToolCacheEntry | null,
  t: Translator,
  kind: 'shell' | 'multimodal',
): { message: string; isError: boolean } {
  const setupKey = kind === 'shell' ? 'sidepanel.mcpPage.shellSetup' : 'sidepanel.mcpPage.multimodalSetup';
  const error = `${cache?.health.error ?? ''} ${server.lastError ?? ''}`.toLowerCase();
  if (error.includes('forbidden')) {
    return { message: t(`${setupKey}.forbidden` as LocaleMessageKey), isError: true };
  }
  if (error.includes('native_host_unavailable') || error.includes('native messaging host not found') || error.includes('not found') || error.includes('specified native messaging host')) {
    return { message: t(`${setupKey}.notFound` as LocaleMessageKey), isError: true };
  }
  if (error.includes('native_messaging_unavailable')) {
    return { message: t('sidepanel.mcpPage.shellSetup.unavailable'), isError: true };
  }
  if (
    error.includes('failed to fetch') ||
    error.includes('mcp_network_error') ||
    error.includes('cannot reach') ||
    error.includes('connection refused')
  ) {
    return { message: t(`${setupKey}.cannotConnect` as LocaleMessageKey), isError: true };
  }
  if (cache?.health.status === 'ready') {
    return { message: t(`${setupKey}.ready` as LocaleMessageKey, { count: cache.health.toolCount }), isError: false };
  }
  if (!server.enabled) {
    return { message: t(`${setupKey}.disabled` as LocaleMessageKey), isError: false };
  }
  return { message: t(`${setupKey}.installFirst` as LocaleMessageKey), isError: false };
}

function formatMs(value: number | null | undefined): string {
  return typeof value === 'number' ? `${value} ms` : '-';
}

function formatTime(value: number | null | undefined, locale?: SupportedLocale): string {
  if (!value) return '-';
  return new Date(value).toLocaleString(locale);
}
