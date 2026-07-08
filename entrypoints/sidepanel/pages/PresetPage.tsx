import { useEffect, useRef, useState } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { PlusIcon, UploadIcon } from 'lucide-react';
import type { SystemPromptPreset } from '../../../core/types';
import PageIntro from '../components/PageIntro';
import PresetCard from '../components/PresetCard';
import PresetForm from '../components/PresetForm';
import { EmptyState, SkeletonList, StatusMessage, useBanner, useConfirm } from '../components/settings/primitives';
import { useI18n } from '../i18n';
import { getSafeRuntimeIssueMessage, isRuntimeFailure, unwrapRuntimeResponse } from '../runtime-response';

type PresetStatusState = 'checking' | 'attention' | 'empty' | 'inactive' | 'ready';

function PresetStatusCard({
  loading,
  presets,
  activePreset,
  loadError,
  activeLoadError,
  onRetry,
  onCreate,
}: {
  loading: boolean;
  presets: SystemPromptPreset[];
  activePreset: SystemPromptPreset | undefined;
  loadError: string;
  activeLoadError: string;
  onRetry: () => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const isChecking = loading && presets.length === 0 && !loadError;
  const hasIssue = Boolean(loadError || activeLoadError);
  const state: PresetStatusState = isChecking
    ? 'checking'
    : hasIssue
      ? 'attention'
      : presets.length === 0
        ? 'empty'
        : activePreset
          ? 'ready'
          : 'inactive';
  const badgeVariant = state === 'attention'
    ? 'destructive'
    : state === 'empty' || state === 'inactive'
      ? 'outline'
      : 'secondary';
  const badgeLabel = state === 'checking'
    ? t('sidepanel.presetPage.statusChecking')
    : state === 'attention'
      ? t('sidepanel.presetPage.statusNeedsRefresh')
      : state === 'empty'
        ? t('sidepanel.presetPage.statusEmpty')
        : state === 'ready'
          ? t('sidepanel.presetPage.statusReady')
          : t('sidepanel.presetPage.statusInactive');
  const description = state === 'checking'
    ? t('sidepanel.presetPage.statusCheckingDescription')
    : state === 'attention'
      ? t('sidepanel.presetPage.statusNeedsRefreshDescription')
      : state === 'empty'
        ? t('sidepanel.presetPage.statusEmptyDescription')
        : state === 'ready'
          ? t('sidepanel.presetPage.statusReadyDescription')
          : t('sidepanel.presetPage.statusInactiveDescription');
  const presetState = isChecking
    ? t('sidepanel.presetPage.statusPresetsChecking')
    : loadError
      ? t('sidepanel.presetPage.statusPresetsUnavailable')
      : t('sidepanel.presetPage.statusPresetsCount', { count: presets.length });
  const selectionState = isChecking
    ? t('sidepanel.presetPage.statusSelectionChecking')
    : loadError
      ? t('sidepanel.presetPage.statusSelectionUnavailable')
      : activeLoadError
        ? t('sidepanel.presetPage.statusSelectionNeedsRefresh')
        : activePreset
          ? activePreset.name
          : t('sidepanel.presetPage.statusSelectionNone');
  const next = loadError
    ? t('sidepanel.presetPage.statusNextRetryLibrary')
    : activeLoadError
      ? t('sidepanel.presetPage.statusNextRetrySelection')
      : state === 'empty'
        ? t('sidepanel.presetPage.statusNextCreate')
        : state === 'inactive'
          ? t('sidepanel.presetPage.statusNextChoose')
          : t('sidepanel.presetPage.statusNextUseAsk');
  const canRetry = Boolean(loadError || activeLoadError);
  const canCreate = state === 'empty';

  return (
    <Card
      size="sm"
      className="ds-preset-status-card"
      data-state={state}
      aria-live="polite"
      aria-busy={isChecking ? true : undefined}
    >
      <CardHeader>
        <CardTitle>{t('sidepanel.presetPage.statusCardTitle')}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isChecking ? (
          <div className="ds-preset-status-skeleton" aria-hidden="true">
            <Skeleton className="ds-preset-status-skeleton-line" />
            <Skeleton className="ds-preset-status-skeleton-line" />
          </div>
        ) : (
          <div className="ds-preset-status-rows">
            <div className="ds-preset-status-row">
              <span>{t('sidepanel.presetPage.statusPresets')}</span>
              <strong>{presetState}</strong>
            </div>
            <div className="ds-preset-status-row">
              <span>{t('sidepanel.presetPage.statusSelection')}</span>
              <strong>{selectionState}</strong>
            </div>
            <div className="ds-preset-status-row">
              <span>{t('sidepanel.presetPage.statusNext')}</span>
              <strong>{next}</strong>
            </div>
          </div>
        )}
      </CardContent>
      {(canRetry || canCreate) && !isChecking && (
        <CardFooter className="ds-preset-status-footer">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ds-preset-status-action"
            onClick={canRetry ? onRetry : onCreate}
          >
            {canRetry ? t('common.retry') : t('sidepanel.presetPage.create')}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export default function PresetPage() {
  const { t } = useI18n();
  const [presets, setPresets] = useState<SystemPromptPreset[]>([]);
  const [activeId, setActiveId] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeLoadError, setActiveLoadError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SystemPromptPreset | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { confirm, node: confirmNode } = useConfirm();
  const banner = useBanner();
  const activeKnown = activeId !== undefined;
  const activePreset = activeKnown ? presets.find((preset) => preset.id === activeId) : undefined;
  const getPresetIssue = (error: unknown) => getSafeRuntimeIssueMessage(error, t('sidepanel.presetPage.backendUnavailable'));

  const load = async () => {
    setLoading(true);
    setLoadError('');
    setActiveLoadError('');
    try {
      const listResponse = await chrome.runtime.sendMessage({ type: 'GET_PRESETS' });
      const list = unwrapRuntimeResponse<SystemPromptPreset[]>(listResponse, t('sidepanel.presetPage.backendUnavailable'));
      if (!Array.isArray(list)) throw new Error(t('sidepanel.presetPage.backendUnavailable'));
      setPresets(list ?? []);
      try {
        const activeResponse = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PRESET' });
        if (isRuntimeFailure(activeResponse)) {
          throw new Error(activeResponse.error ? getPresetIssue(activeResponse.error) : t('sidepanel.presetPage.backendUnavailable'));
        }
        if (activeResponse === undefined) {
          throw new Error(t('sidepanel.presetPage.backendUnavailable'));
        }
        setActiveId((activeResponse as SystemPromptPreset | null)?.id ?? null);
      } catch (error) {
        setActiveId(undefined);
        setActiveLoadError(t('sidepanel.presetPage.activeLoadFailed', {
          error: getPresetIssue(error),
        }));
      }
    } catch (error) {
      setLoadError(t('sidepanel.presetPage.loadFailed', {
        error: getPresetIssue(error),
      }));
      setActiveId(undefined);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (preset: SystemPromptPreset) => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SAVE_PRESET', payload: preset });
      unwrapRuntimeResponse(response, t('sidepanel.presetPage.backendUnavailable'));
      setShowForm(false);
      setEditing(undefined);
      load();
    } catch (error) {
      banner.show('error', t('sidepanel.presetPage.operationFailed', { error: getPresetIssue(error) }));
    }
  };

  const handleImportFiles = async (files: FileList) => {
    try {
      const entries = await Promise.all(
        Array.from(files, async (file) => ({
          name: file.name.replace(/\.(txt|md)$/i, '').trim(),
          content: (await file.text()).trim(),
        })),
      );
      for (const { name, content } of entries) {
        if (!content) continue;
        const now = Date.now();
        await chrome.runtime.sendMessage({
          type: 'SAVE_PRESET',
          payload: {
            id: crypto.randomUUID(),
            name,
            content,
            createdAt: now,
            updatedAt: now,
          } satisfies SystemPromptPreset,
        }).then((response) => unwrapRuntimeResponse(response, t('sidepanel.presetPage.backendUnavailable')));
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
      load();
    } catch (error) {
      banner.show('error', t('sidepanel.presetPage.operationFailed', { error: getPresetIssue(error) }));
    }
  };

  const handleDelete = async (id: string) => {
    const preset = presets.find((item) => item.id === id);
    const ok = await confirm({
      title: t('sidepanel.presetPage.deleteConfirmTitle'),
      message: t('sidepanel.presetPage.deleteConfirmMessage', { name: preset?.name ?? t('sidepanel.presetPage.fallbackName') }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DELETE_PRESET', payload: { id } });
      unwrapRuntimeResponse(response, t('sidepanel.presetPage.backendUnavailable'));
      load();
    } catch (error) {
      banner.show('error', t('sidepanel.presetPage.operationFailed', { error: getPresetIssue(error) }));
    }
  };

  const handleActivate = async (id: string) => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PRESET', payload: { id } });
      unwrapRuntimeResponse(response, t('sidepanel.presetPage.backendUnavailable'));
      setActiveId(id);
      load();
    } catch (error) {
      banner.show('error', t('sidepanel.presetPage.operationFailed', { error: getPresetIssue(error) }));
    }
  };

  const handleDeactivate = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PRESET', payload: { id: null } });
      unwrapRuntimeResponse(response, t('sidepanel.presetPage.backendUnavailable'));
      setActiveId(null);
      load();
    } catch (error) {
      banner.show('error', t('sidepanel.presetPage.operationFailed', { error: getPresetIssue(error) }));
    }
  };

  const handleEdit = (preset: SystemPromptPreset) => {
    setEditing(preset);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditing(undefined);
  };

  const handleOpenCreate = () => {
    setEditing(undefined);
    setShowForm(true);
  };

  return (
    <div className="ds-page">
      <PageIntro
        title={t('sidepanel.presetPage.title')}
        description={t('sidepanel.presetPage.description')}
        meta={
          !activeKnown
            ? t('sidepanel.presetPage.selectionUnknownMeta')
            : activePreset ? t('sidepanel.presetPage.activeMeta', { name: activePreset.name }) : t('sidepanel.presetPage.inactiveMeta')
        }
        actions={(
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md"
              multiple
              className="hidden"
              onChange={(e) => e.target.files?.length && handleImportFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="ds-preset-header-action"
            >
              <UploadIcon data-icon="inline-start" aria-hidden="true" />
              {t('sidepanel.presetPage.import')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditing(undefined);
                setShowForm((current) => !current);
              }}
              className="ds-preset-header-action"
            >
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              {t('sidepanel.presetPage.create')}
            </Button>
          </>
        )}
      />

      <PresetStatusCard
        loading={loading}
        presets={presets}
        activePreset={activePreset}
        loadError={loadError}
        activeLoadError={activeLoadError}
        onRetry={() => { void load(); }}
        onCreate={handleOpenCreate}
      />

      {showForm && (
        <div className="ds-preset-form-shell">
          <PresetForm initial={editing} onSave={handleSave} onCancel={handleCancel} />
        </div>
      )}

      {confirmNode}
      {banner.node}

      {(loadError || activeLoadError) && (
        <StatusMessage tone="error">
          <div className="font-medium">
            {loadError ? t('sidepanel.presetPage.loadFailedTitle') : t('sidepanel.presetPage.activeLoadFailedTitle')}
          </div>
          <div>{loadError || activeLoadError}</div>
          <div className="mt-1.5">{t('sidepanel.presetPage.loadFailedHint')}</div>
        </StatusMessage>
      )}

      {loading && presets.length === 0 && !loadError ? (
        <SkeletonList rows={3} />
      ) : presets.length === 0 && !loadError ? (
        <EmptyState
          title={t('sidepanel.presetPage.empty')}
          description={t('sidepanel.presetPage.emptyHelp')}
        />
      ) : (
        <div className="ds-preset-list" aria-label={t('sidepanel.presetPage.listLabel')}>
          {presets.map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              activeKnown={activeKnown}
              isActive={activeKnown && p.id === activeId}
              onActivate={() => handleActivate(p.id)}
              onDeactivate={handleDeactivate}
              onEdit={() => handleEdit(p)}
              onDelete={() => handleDelete(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
