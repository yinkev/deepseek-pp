import { SVG_PATHS } from '../../constants';
import { useI18n } from '../../i18n';
import { SettingsSection, Spinner, StatusMessage, TextField, useBanner, useConfirm } from './primitives';
import type { SettingsState } from './useSettingsState';
import type { SyncCounts } from '../../../../core/types';

const TEST_CONNECTION_ICON = 'M13 10V3L4 14h7v7l9-11h-7z';

export default function DataSubPage({ state }: { state: SettingsState }) {
  const { t, locale } = useI18n();
  const { confirm, node: confirmNode } = useConfirm();
  const banner = useBanner();
  const syncConfigured = state.syncConfig.url.trim().length > 0;
  const syncStateLabel = syncConfigured
    ? t('sidepanel.settings.configured')
    : t('sidepanel.settings.notConfigured');
  const syncState = syncConfigured ? 'configured' : 'not-configured';

  const formatTime = (ts: number | null) => {
    if (!ts) return t('sidepanel.settings.neverSynced');
    return new Date(ts).toLocaleString(locale, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatSyncCounts = (counts?: SyncCounts) => {
    if (!counts) return '';
    return t('sidepanel.settings.syncCounts', {
      memories: counts.memories,
      skills: counts.skills,
      presets: counts.presets,
      projects: counts.projects,
      projectConversations: counts.projectConversations,
      savedItems: counts.savedItems,
    });
  };

  const onTest = () =>
    state.handleTestSync({
      permissionDenied: t('sidepanel.settings.webDavPermissionDenied'),
      operationFailed: t('sidepanel.settings.operationFailed'),
      success: t('sidepanel.settings.connectionSuccess'),
      failed: t('sidepanel.settings.connectionFailed'),
    });

  const onUpload = async () => {
    const ok = await confirm({
      title: t('sidepanel.settings.uploadLocal'),
      message: t('sidepanel.settings.uploadConfirm'),
      confirmLabel: t('sidepanel.settings.uploadLocal'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    state.handleUploadSync({
      permissionDenied: t('sidepanel.settings.webDavPermissionDenied'),
      operationFailed: t('sidepanel.settings.operationFailed'),
      failed: t('sidepanel.settings.uploadFailed'),
      success: (counts) => t('sidepanel.settings.uploadSuccess', { counts: formatSyncCounts(counts) }),
    });
  };

  const onDownload = async () => {
    const ok = await confirm({
      title: t('sidepanel.settings.downloadRemote'),
      message: t('sidepanel.settings.downloadConfirm'),
      confirmLabel: t('sidepanel.settings.downloadRemote'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    state.handleDownloadSync({
      permissionDenied: t('sidepanel.settings.webDavPermissionDenied'),
      operationFailed: t('sidepanel.settings.operationFailed'),
      failed: t('sidepanel.settings.downloadFailed'),
      success: (counts) => t('sidepanel.settings.downloadSuccess', { counts: formatSyncCounts(counts) }),
    });
  };

  const onClearAll = async () => {
    const ok = await confirm({
      title: t('sidepanel.settings.clearAllMemories'),
      message: t('sidepanel.settings.clearAllConfirm'),
      confirmLabel: t('sidepanel.settings.clearAllMemories'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    await state.handleClearAllMemories();
  };

  return (
    <div className="space-y-5">
      {confirmNode}
      {banner.node}

      <SettingsSection title={t('sidepanel.settings.cloudSyncSection')}>
        <TextField
          label={t('sidepanel.settings.webDavUrl')}
          meta={<span className="ds-settings-field-state" data-state={syncState}>{syncStateLabel}</span>}
          type="url"
          value={state.syncConfig.url}
          placeholder="https://dav.example.com/dav/"
          onChange={(v) => state.updateSyncField('url', v)}
        />

        <div className="ds-data-sync-credentials">
          <TextField
            label={t('sidepanel.settings.username')}
            autoComplete="username"
            value={state.syncConfig.username}
            onChange={(v) => state.updateSyncField('username', v)}
          />
          <TextField
            label={t('sidepanel.settings.password')}
            type="password"
            autoComplete="current-password"
            value={state.syncConfig.password}
            onChange={(v) => state.updateSyncField('password', v)}
          />
        </div>

        <TextField
          label={t('sidepanel.settings.remotePath')}
          value={state.syncConfig.remotePath}
          onChange={(v) => state.updateSyncField('remotePath', v)}
        />

        <div className="ds-data-sync-actions">
          <DataActionButton
            label={t('sidepanel.settings.testConnection')}
            iconPath={TEST_CONNECTION_ICON}
            busy={state.syncStatus === 'testing'}
            disabled={!syncConfigured || state.syncBusy}
            onClick={onTest}
          />
          <DataActionButton
            label={t('sidepanel.settings.uploadLocal')}
            iconPath={SVG_PATHS.upload}
            busy={state.syncStatus === 'uploading'}
            disabled={!syncConfigured || state.syncBusy}
            onClick={onUpload}
          />
          <DataActionButton
            label={t('sidepanel.settings.downloadRemote')}
            iconPath={SVG_PATHS.download}
            busy={state.syncStatus === 'downloading'}
            disabled={!syncConfigured || state.syncBusy}
            onClick={onDownload}
          />
        </div>

        {state.syncMessage && (
          <StatusMessage tone={state.syncStatus === 'error' ? 'error' : 'success'}>
            {state.syncMessage}
          </StatusMessage>
        )}

        <div className="ds-data-sync-meta">
          {t('sidepanel.settings.lastSync', { time: formatTime(state.syncConfig.lastSyncAt) })}
        </div>
      </SettingsSection>

      <SettingsSection title={t('sidepanel.settings.dataSection')}>
        <div className="ds-data-summary-row">
          <span>{t('sidepanel.settings.memoryTotal')}</span>
          <span>{state.memoryCount}</span>
        </div>

        <div className="ds-data-local-actions">
          <button
            onClick={state.handleExport}
            className="ds-btn-secondary ds-data-action-button"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.download} />
            </svg>
            {t('sidepanel.settings.exportMemories')}
          </button>
          <button
            onClick={() => state.handleImport(
              {
                arrayError: t('sidepanel.settings.importMemoryArrayError'),
                jsonError: t('sidepanel.settings.jsonFormatError'),
              },
              (result) => {
                if (result.ok) {
                  banner.show('success', t('sidepanel.settings.importSuccess', { count: result.imported ?? 0 }));
                } else {
                  banner.show('error', result.error ?? t('sidepanel.settings.jsonFormatError'));
                }
              },
            )}
            className="ds-btn-secondary ds-data-action-button"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.upload} />
            </svg>
            {t('sidepanel.settings.importMemories')}
          </button>
        </div>

        <button
          onClick={onClearAll}
          className="ds-btn-danger ds-data-danger-button"
        >
          {t('sidepanel.settings.clearAllMemories')}
        </button>
      </SettingsSection>
    </div>
  );
}

function DataActionButton({
  label,
  iconPath,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  iconPath: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ds-btn-secondary ds-data-action-button"
    >
      {busy ? (
        <Spinner className="w-3 h-3" />
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
      )}
      <span>{label}</span>
    </button>
  );
}
