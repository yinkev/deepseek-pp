import { useEffect, useState } from 'react';
import type { Memory, MemoryType, NewMemory } from '../../../core/types';
import MemoryCard from '../components/MemoryCard';
import MemoryForm from '../components/MemoryForm';
import PageIntro from '../components/PageIntro';
import { SegmentedControl, SkeletonList, useBanner, useConfirm } from '../components/settings/primitives';
import { MEMORY_TYPE_CONFIG } from '../constants';
import { useI18n } from '../i18n';

export default function MemoryPage() {
  const { t } = useI18n();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MemoryType | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const { confirm, node: confirmNode } = useConfirm();
  const banner = useBanner();

  const load = async () => {
    try {
      const list: Memory[] = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
      setMemories((list ?? []).filter((memory) => memory.scope !== 'project'));
    } catch (error) {
      banner.show('error', error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();

    const handleStateUpdate = (message: { type?: string; memories?: Memory[] }) => {
      if (message.type === 'STATE_UPDATED' && Array.isArray(message.memories)) {
        setMemories(message.memories.filter((memory) => memory.scope !== 'project'));
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
      message: t('sidepanel.memoryPage.deleteConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id } });
      load();
    } catch (error) {
      banner.show('error', error instanceof Error ? error.message : String(error));
    }
  };

  const handleSave = async (mem: NewMemory) => {
    try {
      if (editingMemory?.id) {
        await chrome.runtime.sendMessage({
          type: 'UPDATE_MEMORY',
          payload: { ...editingMemory, ...mem, updatedAt: Date.now() },
        });
      } else {
        await chrome.runtime.sendMessage({ type: 'SAVE_MEMORY', payload: mem });
      }
      setShowForm(false);
      setEditingMemory(null);
      load();
    } catch (error) {
      banner.show('error', error instanceof Error ? error.message : String(error));
    }
  };

  const handleEdit = (mem: Memory) => {
    setEditingMemory(mem);
    setShowForm(true);
  };

  const handleTogglePin = async (mem: Memory) => {
    try {
      await chrome.runtime.sendMessage({
        type: 'UPDATE_MEMORY',
        payload: { ...mem, pinned: !mem.pinned },
      });
      load();
    } catch (error) {
      banner.show('error', error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="ds-page">
      <PageIntro
        title={t('sidepanel.memoryPage.title')}
        description={t('sidepanel.memoryPage.description')}
        meta={t('sidepanel.memoryPage.count', { count: memories.length })}
      />

      <div className="flex items-center justify-between gap-2">
        <SegmentedControl
          options={filterTypes}
          value={filter}
          onChange={(key) => setFilter(key)}
          ariaLabel={t('sidepanel.memoryPage.title')}
          size="sm"
        />
        <button
          onClick={() => { setEditingMemory(null); setShowForm(!showForm); }}
          className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t('common.add')}
        </button>
      </div>

      {confirmNode}
      {banner.node}

      {showForm && (
        <div className="animate-slide-down">
          <MemoryForm
            initial={editingMemory}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingMemory(null); }}
          />
        </div>
      )}

      {loading ? (
        <SkeletonList rows={3} />
      ) : filtered.length === 0 ? (
        <div className="ds-empty-state">
          <div className="ds-empty-state-icon">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <div className="ds-empty-state-title">
            {memories.length === 0 ? t('sidepanel.memoryPage.emptyAll') : t('sidepanel.memoryPage.emptyFiltered')}
          </div>
          {memories.length === 0 && (
            <div className="ds-empty-state-description">
              {t('sidepanel.memoryPage.emptyHelp')}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <MemoryCard
              key={m.id}
              memory={m}
              onDelete={() => handleDelete(m.id!)}
              onEdit={() => handleEdit(m)}
              onTogglePin={() => handleTogglePin(m)}
            />
          ))}
        </div>
      )}

    </div>
  );
}
