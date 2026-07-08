import { useEffect, useMemo, useState } from 'react';
import type { SavedItem, SavedItemInput, SavedItemKind } from '../../../core/saved-items';
import { createSavedItemsJsonArtifact, createSavedItemsMarkdownArtifact, type SecondaryExportArtifact } from '../../../core/export/secondary-artifacts';
import LibraryStatusCard, { type LibraryStatusState } from '../components/LibraryStatusCard';
import PageIntro from '../components/PageIntro';
import { EmptyState, SelectField, SkeletonList, TextAreaField, TextField, useBanner, useConfirm } from '../components/settings/primitives';
import { useI18n } from '../i18n';
import { getSafeRuntimeIssueMessage, unwrapRuntimeResponse } from '../runtime-response';

interface SavedPageProps {
  onInsertPrompt: (text: string) => void | Promise<void>;
}

export default function SavedPage({ onInsertPrompt }: SavedPageProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SavedItemKind>('snippet');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();

  const load = async () => {
    setLoading(true);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GET_SAVED_ITEMS' });
      setItems(readSavedItemsList(result, t('sidepanel.savedPage.backendUnavailable')));
      if (loadError) banner.clear();
      setLoadError(null);
    } catch (error) {
      const message = t('sidepanel.savedPage.operationFailed', {
        error: getSafeRuntimeIssueMessage(error, t('sidepanel.savedPage.backendUnavailable')),
      });
      setItems([]);
      setLoadError(message);
      banner.show('error', message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const handler = (message: { type?: string; savedItems?: SavedItem[] }) => {
      if (message.type === 'SAVED_ITEMS_UPDATED') {
        setItems(Array.isArray(message.savedItems) ? message.savedItems : []);
        banner.clear();
        setLoadError(null);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => [
      item.title,
      item.content,
      item.sourceUrl ?? '',
      item.tags.join(' '),
    ].join('\n').toLowerCase().includes(needle));
  }, [items, query]);
  const isChecking = loading && items.length === 0 && !loadError;
  const statusState: LibraryStatusState = isChecking
    ? 'checking'
    : loadError
      ? 'attention'
      : items.length === 0
        ? 'empty'
        : 'ready';
  const statusBadge = statusState === 'checking'
    ? t('sidepanel.savedPage.statusChecking')
    : statusState === 'attention'
      ? t('sidepanel.savedPage.statusNeedsRefresh')
      : statusState === 'empty'
        ? t('sidepanel.savedPage.statusEmpty')
        : t('sidepanel.savedPage.statusReady');
  const statusDescription = statusState === 'checking'
    ? t('sidepanel.savedPage.statusCheckingDescription')
    : statusState === 'attention'
      ? t('sidepanel.savedPage.statusNeedsRefreshDescription')
      : statusState === 'empty'
        ? t('sidepanel.savedPage.statusEmptyDescription')
        : t('sidepanel.savedPage.statusReadyDescription');
  const statusNext = loadError
    ? t('sidepanel.savedPage.statusNextRetry')
    : items.length === 0
      ? t('sidepanel.savedPage.statusNextCreate')
      : filtered.length === 0
        ? t('sidepanel.savedPage.statusNextSearch')
        : t('sidepanel.savedPage.statusNextUse');

  const save = async () => {
    if (!title.trim() || !content.trim()) return;
    const payload: SavedItemInput = {
      kind,
      title,
      content,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    };
    try {
      banner.clear();
      const saved = unwrapRuntimeResponse<SavedItem>(
        await chrome.runtime.sendMessage({ type: 'SAVE_SAVED_ITEM', payload }),
        t('sidepanel.savedPage.backendUnavailable'),
      );
      if (!saved.id) {
        throw new Error(t('sidepanel.savedPage.backendUnavailable'));
      }
      setTitle('');
      setContent('');
      setTags('');
      setShowForm(false);
      banner.show('success', t('sidepanel.savedPage.saved'));
      await load();
    } catch (error) {
      showSavedFailure(error);
    }
  };

  const remove = async (id: string) => {
    const ok = await confirm({
      title: t('sidepanel.savedPage.deleteConfirm'),
      message: t('sidepanel.savedPage.deleteConfirmMessage'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      banner.clear();
      unwrapRuntimeResponse(
        await chrome.runtime.sendMessage({ type: 'DELETE_SAVED_ITEM', payload: { id } }),
        t('sidepanel.savedPage.backendUnavailable'),
      );
      await load();
    } catch (error) {
      showSavedFailure(error);
    }
  };

  const insertPrompt = async (text: string) => {
    banner.clear();
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'INSERT_SAVED_PROMPT_IN_ACTIVE_DEEPSEEK_TAB',
        payload: { text },
      });
      if (result?.ok) {
        banner.show('success', t('sidepanel.savedPage.insertedIntoPage'));
        return;
      }
    } catch {}

    try {
      await onInsertPrompt(text);
      banner.show('success', t('sidepanel.savedPage.insertedIntoSidepanel'));
    } catch (error) {
      showSavedFailure(error);
    }
  };

  const exportItems = (format: 'markdown' | 'json') => {
    const artifact = format === 'json'
      ? createSavedItemsJsonArtifact(items)
      : createSavedItemsMarkdownArtifact(items);
    downloadSecondaryArtifact(artifact);
  };

  return (
    <div className="ds-page ds-library-saved-page">
      <PageIntro
        title={t('sidepanel.savedPage.title')}
        description={t('sidepanel.savedPage.description')}
        meta={t('sidepanel.savedPage.count', { count: items.length })}
        actions={(
          <>
            <button
              type="button"
              onClick={() => setShowForm((visible) => !visible)}
              className="ds-btn-secondary"
              aria-expanded={showForm}
            >
              {showForm ? t('common.close') : t('sidepanel.savedPage.newItem')}
            </button>
            <button
              type="button"
              onClick={() => exportItems('markdown')}
              disabled={items.length === 0}
              className="ds-btn-secondary"
            >
              {t('sidepanel.savedPage.exportMarkdown')}
            </button>
            <button
              type="button"
              onClick={() => exportItems('json')}
              disabled={items.length === 0}
              className="ds-btn-secondary"
            >
              {t('sidepanel.savedPage.exportJson')}
            </button>
          </>
        )}
      />

      <LibraryStatusCard
        title={t('sidepanel.savedPage.statusCardTitle')}
        description={statusDescription}
        state={statusState}
        badgeLabel={statusBadge}
        loading={isChecking}
        rows={[
          {
            label: t('sidepanel.savedPage.statusTotal'),
            value: isChecking
              ? t('sidepanel.savedPage.statusChecking')
              : loadError
                ? t('sidepanel.savedPage.statusUnavailable')
                : t('sidepanel.savedPage.statusTotalCount', { count: items.length }),
          },
          {
            label: t('sidepanel.savedPage.statusVisible'),
            value: isChecking
              ? t('sidepanel.savedPage.statusChecking')
              : loadError
                ? t('sidepanel.savedPage.statusUnavailable')
                : t('sidepanel.savedPage.statusVisibleCount', { count: filtered.length }),
          },
          {
            label: t('sidepanel.savedPage.statusNext'),
            value: statusNext,
          },
        ]}
        action={loadError
          ? { label: t('common.retry'), ariaLabel: t('common.retry'), onClick: () => void load() }
          : items.length === 0 && !loading
            ? {
              label: t('sidepanel.savedPage.newItem'),
              ariaLabel: t('sidepanel.savedPage.newItem'),
              onClick: () => setShowForm(true),
            }
            : undefined}
      />

      {showForm && (
        <section className="ds-library-form-wrap" aria-label={t('sidepanel.savedPage.formTitle')}>
          <div className="ds-library-form-title">{t('sidepanel.savedPage.formTitle')}</div>
          <div className="ds-library-form">
            <SelectField
              label={t('sidepanel.savedPage.kindLabel')}
              value={kind}
              onChange={setKind}
              options={[
                { value: 'snippet', label: t('sidepanel.savedPage.snippet') },
                { value: 'bookmark', label: t('sidepanel.savedPage.bookmark') },
              ]}
            />
            <TextField
              label={t('sidepanel.savedPage.titleLabel')}
              value={title}
              onChange={setTitle}
              placeholder={t('sidepanel.savedPage.titlePlaceholder')}
            />
            <TextAreaField
              label={t('sidepanel.savedPage.contentLabel')}
              value={content}
              onChange={setContent}
              placeholder={t('sidepanel.savedPage.contentPlaceholder')}
              rows={5}
            />
            <TextField
              label={t('sidepanel.savedPage.tagsLabel')}
              value={tags}
              onChange={setTags}
              placeholder={t('sidepanel.savedPage.tagsPlaceholder')}
            />
            <div className="ds-library-form-actions">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="ds-btn-cancel"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!title.trim() || !content.trim()}
                className="ds-btn-primary"
              >
                {t('sidepanel.savedPage.save')}
              </button>
            </div>
          </div>
        </section>
      )}

      {banner.node}
      {confirmNode}

      <div className="ds-library-toolbar">
        <TextField
          label={t('common.search')}
          value={query}
          onChange={setQuery}
          placeholder={t('sidepanel.savedPage.searchPlaceholder')}
        />
      </div>

      <div className="ds-library-list">
        {loading ? (
          <SkeletonList rows={3} />
        ) : loadError ? (
          <EmptyState
            title={t('sidepanel.savedPage.loadFailedTitle')}
            description={loadError}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={t('sidepanel.savedPage.empty')}
            description={t('sidepanel.savedPage.emptyHelp')}
          />
        ) : (
          filtered.map((item) => (
            <article key={item.id} className="ds-library-row ds-library-saved-row">
              <div className="ds-library-row-copy">
                <div className="ds-library-row-kicker">
                  <span>{item.kind === 'snippet' ? t('sidepanel.savedPage.snippet') : t('sidepanel.savedPage.bookmark')}</span>
                  {item.tags.length > 0 && <span>{item.tags.join(' · ')}</span>}
                </div>
                <h3>{item.title}</h3>
                <p>{item.content}</p>
              </div>

              <div className="ds-library-row-actions">
                <button
                  type="button"
                  onClick={() => insertPrompt(item.content)}
                  className="ds-library-row-action"
                >
                  {t('sidepanel.savedPage.insertPrompt')}
                </button>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="ds-library-row-action ds-library-row-action-danger"
                >
                  {t('common.delete')}
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );

  function showSavedFailure(error: unknown) {
    banner.show('error', t('sidepanel.savedPage.operationFailed', {
      error: getSafeRuntimeIssueMessage(error, t('sidepanel.savedPage.backendUnavailable')),
    }));
  }
}

function readSavedItemsList(result: unknown, fallback: string): SavedItem[] {
  if (Array.isArray(result)) return result;
  const list = unwrapRuntimeResponse<unknown>(result, fallback);
  if (!Array.isArray(list)) throw new Error(fallback);
  return list as SavedItem[];
}

function downloadSecondaryArtifact(artifact: SecondaryExportArtifact): void {
  const blob = new Blob([artifact.content], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
