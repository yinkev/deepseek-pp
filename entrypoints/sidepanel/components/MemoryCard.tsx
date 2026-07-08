import type { LocaleMessageKey, MessageParams } from '../../../core/i18n';
import type { Memory } from '../../../core/types';
import { MEMORY_TYPE_MAP } from '../constants';
import { useI18n } from '../i18n';

interface Props {
  memory: Memory;
  onDelete: () => void;
  onEdit: () => void;
  onTogglePin: () => void;
}

export default function MemoryCard({ memory, onDelete, onEdit, onTogglePin }: Props) {
  const { t } = useI18n();
  const typeInfo = MEMORY_TYPE_MAP[memory.type] ?? MEMORY_TYPE_MAP.topic;
  const age = formatAge(memory.createdAt, t);
  const pinTitle = memory.pinned ? t('sidepanel.memory.actions.unpin') : t('sidepanel.memory.actions.pin');

  return (
    <article className="ds-library-row ds-library-memory-row" data-pinned={memory.pinned ? 'true' : 'false'}>
      <div className="ds-library-row-copy">
        <div className="ds-library-row-kicker">
          <span
            className="ds-library-type"
            style={{
              background: typeInfo.bg,
              color: typeInfo.color,
              borderColor: typeInfo.border,
            }}
          >
            {t(typeInfo.labelKey)}
          </span>
          {memory.pinned && <span>{t('sidepanel.memoryPage.pinned')}</span>}
          <span>{age}</span>
        </div>

        <h3>{memory.name}</h3>

        <p>{memory.content}</p>

        {memory.tags.length > 0 && (
          <div className="ds-library-row-tags">
            {memory.tags.join(' · ')}
          </div>
        )}
      </div>

      <div className="ds-library-row-actions">
        <button type="button" onClick={onTogglePin} className="ds-library-row-action">
          {pinTitle}
        </button>
        <button type="button" onClick={onEdit} className="ds-library-row-action">
          {t('common.edit')}
        </button>
        <button type="button" onClick={onDelete} className="ds-library-row-action ds-library-row-action-danger">
          {t('common.delete')}
        </button>
      </div>
    </article>
  );
}

function formatAge(
  ts: number,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('sidepanel.memory.age.justNow');
  if (mins < 60) return t('sidepanel.memory.age.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('sidepanel.memory.age.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('sidepanel.memory.age.daysAgo', { count: days });
}
