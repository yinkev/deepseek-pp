import { useEffect, useState } from 'react';
import type { Memory, MemoryType, NewMemory } from '../../../core/types';
import LibraryStatusCard, { type LibraryStatusState } from '../components/LibraryStatusCard';
import MemoryCard from '../components/MemoryCard';
import MemoryForm from '../components/MemoryForm';
import PageIntro from '../components/PageIntro';
import { EmptyState, SegmentedControl, SkeletonList, useBanner, useConfirm } from '../components/settings/primitives';
import { MEMORY_TYPE_CONFIG } from '../constants';
import { useI18n } from '../i18n';
import { getSafeRuntimeIssueMessage, unwrapRuntimeResponse } from '../runtime-response';

export default function MemoryPage() {
  const { t } = useI18n();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MemoryType | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { confirm, node: confirmNode } = useConfirm();
  const banner = useBanner();

  const load = async () => {
    setLoading(true);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
      const list = readMemoryList(result, t('sidepanel.memoryPage.backendUnavailable'));
      setMemories((list ?? []).filter((memory) => memory.scope !== 'project'));
      banner.clear();
      setLoadError(null);
    } catch (error) {
      const message = t('sidepanel.memoryPage.operationFailed', {
        error: getSafeRuntimeIssueMessage(error, t('sidepanel.memoryPage.backendUnavailable')),
      });
      setMemories([]);
      setLoadError(message);
      banner.show('error', message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();

    const handleStateUpdate = (message: { type?: string; memories?: Memory[] }) => {
      if (message.type === 'STATE_UPDATED' && Array.isArray(message.memories)) {
        setMemories(message.memories.filter((memory) => memory.scope !== 'project'));
        banner.clear();
        setLoadError(null);
      }
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) void load();
    };

    chrome.runtime.onMessage.addListener(handleStateUpdate);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);

    return () => {
      chrome.runtime.onMessage.removeListener(handleStateUpdate);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, []);

  const filtered = filter === 'all' ? memories : memories.filter((m) => m.type === filter);
  const isChecking = loading && memories.length === 0 && !loadError;
  const statusState: LibraryStatusState = isChecking
    ? 'checking'
    : loadError
      ? 'attention'
      : memories.length === 0
        ? 'empty'
        : 'ready';
  const statusBadge = statusState === 'checking'
    ? t('sidepanel.memoryPage.statusChecking')
    : statusState === 'attention'
      ? t('sidepanel.memoryPage.statusNeedsRefresh')
      : statusState === 'empty'
        ? t('sidepanel.memoryPage.statusEmpty')
        : t('sidepanel.memoryPage.statusReady');
  const statusDescription = statusState === 'checking'
    ? t('sidepanel.memoryPage.statusCheckingDescription')
    : statusState === 'attention'
      ? t('sidepanel.memoryPage.statusNeedsRefreshDescription')
      : statusState === 'empty'
        ? t('sidepanel.memoryPage.statusEmptyDescription')
        : t('sidepanel.memoryPage.statusReadyDescription');
  const statusNext = loadError
    ? t('sidepanel.memoryPage.statusNextRetry')
    : memories.length === 0
      ? t('sidepanel.memoryPage.statusNextCreate')
      : filtered.length === 0
        ? t('sidepanel.memoryPage.statusNextFilter')
        : t('sidepanel.memoryPage.statusNextUse');
  const filterTypes = [
    { key: 'all' as const, label: t('common.all') },
    ...MEMORY_TYPE_CONFIG.map((typeConfig) => ({
      key: typeConfig.key,
      label: t(typeConfig.labelKey),
    })),
  ];

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: t('sidepanel.memoryPage.deleteConfirm'),
      message: t('sidepanel.memoryPage.deleteConfirmMessage'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      unwrapRuntimeResponse(
        await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id } }),
        t('sidepanel.memoryPage.backendUnavailable'),
      );
      load();
    } catch (error) {
      showMemoryFailure(error);
    }
  };

  const handleSave = async (mem: NewMemory) => {
    try {
      if (editingMemory?.id) {
        unwrapRuntimeResponse(
          await chrome.runtime.sendMessage({
            type: 'UPDATE_MEMORY',
            payload: { ...editingMemory, ...mem, updatedAt: Date.now() },
          }),
          t('sidepanel.memoryPage.backendUnavailable'),
        );
      } else {
        unwrapRuntimeResponse<{ id: number }>(
          await chrome.runtime.sendMessage({ type: 'SAVE_MEMORY', payload: mem }),
          t('sidepanel.memoryPage.backendUnavailable'),
        );
      }
      setShowForm(false);
      setEditingMemory(null);
      load();
    } catch (error) {
      showMemoryFailure(error);
    }
  };

  const handleEdit = (mem: Memory) => {
    setEditingMemory(mem);
    setShowForm(true);
  };

  const handleTogglePin = async (mem: Memory) => {
    try {
      unwrapRuntimeResponse(
        await chrome.runtime.sendMessage({
          type: 'UPDATE_MEMORY',
          payload: { ...mem, pinned: !mem.pinned },
        }),
        t('sidepanel.memoryPage.backendUnavailable'),
      );
      load();
    } catch (error) {
      showMemoryFailure(error);
    }
  };

  return (
    <div className="ds-page">
      <PageIntro
        title={t('sidepanel.memoryPage.title')}
        description={t('sidepanel.memoryPage.description')}
        meta={t('sidepanel.memoryPage.count', { count: memories.length })}
        actions={(
          <button
            type="button"
            onClick={() => {
              setEditingMemory(null);
              setShowForm((visible) => !visible);
            }}
            className="ds-btn-secondary"
            aria-expanded={showForm}
          >
            {showForm ? t('common.close') : t('sidepanel.memoryPage.newMemory')}
          </button>
        )}
      />

      <LibraryStatusCard
        title={t('sidepanel.memoryPage.statusCardTitle')}
        description={statusDescription}
        state={statusState}
        badgeLabel={statusBadge}
        loading={isChecking}
        rows={[
          {
            label: t('sidepanel.memoryPage.statusTotal'),
            value: isChecking
              ? t('sidepanel.memoryPage.statusChecking')
              : loadError
                ? t('sidepanel.memoryPage.statusUnavailable')
                : t('sidepanel.memoryPage.statusTotalCount', { count: memories.length }),
          },
          {
            label: t('sidepanel.memoryPage.statusVisible'),
            value: isChecking
              ? t('sidepanel.memoryPage.statusChecking')
              : loadError
                ? t('sidepanel.memoryPage.statusUnavailable')
                : t('sidepanel.memoryPage.statusVisibleCount', { count: filtered.length }),
          },
          {
            label: t('sidepanel.memoryPage.statusNext'),
            value: statusNext,
          },
        ]}
        action={loadError
          ? { label: t('common.retry'), ariaLabel: t('common.retry'), onClick: () => void load() }
          : memories.length === 0 && !loading
            ? {
              label: t('sidepanel.memoryPage.newMemory'),
              ariaLabel: t('sidepanel.memoryPage.newMemory'),
              onClick: () => {
                setEditingMemory(null);
                setShowForm(true);
              },
            }
            : undefined}
      />

      {showForm && (
        <div className="ds-library-form-wrap">
          <div className="ds-library-form-title">
            {editingMemory ? t('sidepanel.memoryPage.editMemory') : t('sidepanel.memoryPage.newMemory')}
          </div>
          <MemoryForm
            initial={editingMemory}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingMemory(null); }}
          />
        </div>
      )}

      <div className="ds-library-toolbar">
        <span className="ds-library-toolbar-label">{t('sidepanel.memoryPage.filterLabel')}</span>
        <SegmentedControl
          options={filterTypes}
          value={filter}
          onChange={(key) => setFilter(key)}
          ariaLabel={t('sidepanel.memoryPage.title')}
          size="sm"
        />
      </div>

      {confirmNode}
      {banner.node}

      <div className="ds-library-list">
        {loading ? (
          <SkeletonList rows={3} />
        ) : loadError ? (
          <EmptyState
            title={t('sidepanel.memoryPage.loadFailedTitle')}
            description={loadError}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={memories.length === 0 ? t('sidepanel.memoryPage.emptyAll') : t('sidepanel.memoryPage.emptyFiltered')}
            description={memories.length === 0 ? t('sidepanel.memoryPage.emptyHelp') : undefined}
          />
        ) : (
          filtered.map((m) => (
            <MemoryCard
              key={m.id}
              memory={m}
              onDelete={() => handleDelete(m.id!)}
              onEdit={() => handleEdit(m)}
              onTogglePin={() => handleTogglePin(m)}
            />
          ))
        )}
      </div>

    </div>
  );

  function showMemoryFailure(error: unknown) {
    banner.show('error', t('sidepanel.memoryPage.operationFailed', {
      error: getSafeRuntimeIssueMessage(error, t('sidepanel.memoryPage.backendUnavailable')),
    }));
  }
}

function readMemoryList(result: unknown, fallback: string): Memory[] {
  if (Array.isArray(result)) return result;
  const list = unwrapRuntimeResponse<unknown>(result, fallback);
  if (!Array.isArray(list)) throw new Error(fallback);
  return list as Memory[];
}
