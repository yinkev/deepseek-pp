import type { LocaleMessageKey } from '../../../core/i18n';
import type { Skill } from '../../../core/types';
import { SVG_PATHS } from '../constants';
import { useI18n } from '../i18n';

interface Props {
  skill: Skill;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleEnabled?: () => void;
}

const SOURCE_LABELS: Record<string, { labelKey: LocaleMessageKey; className: string }> = {
  builtin: { labelKey: 'sidepanel.skill.sources.builtin', className: 'ds-tag' },
  official: { labelKey: 'sidepanel.skill.sources.official', className: 'ds-tag' },
  'third-party': { labelKey: 'sidepanel.skill.sources.thirdParty', className: 'ds-tag' },
  custom: { labelKey: 'sidepanel.skill.sources.custom', className: 'ds-tag' },
  remote: { labelKey: 'sidepanel.skill.sources.remote', className: 'ds-tag' },
};

export default function SkillCard({ skill, onEdit, onDelete, onToggleEnabled }: Props) {
  const { t } = useI18n();
  const badge = skill.remote?.provider === 'local'
    ? { labelKey: 'sidepanel.skill.sources.local' as LocaleMessageKey, className: 'ds-tag' }
    : SOURCE_LABELS[skill.source];
  const enabled = skill.enabled !== false;
  const hasActions = Boolean(onEdit || onDelete || onToggleEnabled);
  const toggleLabel = enabled
    ? t('sidepanel.skill.actions.disableSkill', { name: skill.name })
    : t('sidepanel.skill.actions.enableSkill', { name: skill.name });
  const statusBorder = enabled
    ? '1px solid color-mix(in srgb, var(--ds-success) 28%, var(--ds-border))'
    : '1px solid color-mix(in srgb, var(--ds-danger) 24%, var(--ds-border))';

  return (
    <div
      className="ds-card rounded-xl p-3 group"
      style={{
        border: statusBorder,
        opacity: enabled ? 1 : 0.82,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <code className="ds-trigger text-[12px] font-mono font-semibold px-1.5 py-0.5 rounded">
            /{skill.name}
          </code>
          {badge && (
            <span className={`${badge.className} inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0`}>
              {t(badge.labelKey)}
            </span>
          )}
          {!enabled && (
            <span
              className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
              style={{ color: 'var(--ds-text-tertiary)', background: 'var(--ds-surface)' }}
            >
              {t('sidepanel.skill.disabledBadge')}
            </span>
          )}
        </div>
        {hasActions && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
            {onToggleEnabled && (
              <button
                type="button"
                title={enabled ? t('common.deactivate') : t('common.enable')}
                aria-label={toggleLabel}
                onClick={onToggleEnabled}
                className="ds-action-btn w-7 h-7 flex items-center justify-center"
                style={{ borderRadius: 'var(--radius-ctrl)' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={enabled ? 'M18.364 18.364A9 9 0 015.636 5.636m12.728 12.728A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636' : 'M5 13l4 4L19 7'} />
                </svg>
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                title={t('common.edit')}
                aria-label={t('sidepanel.skill.actions.editSkill', { name: skill.name })}
                onClick={onEdit}
                className="ds-action-btn ds-action-btn-edit w-7 h-7 flex items-center justify-center"
                style={{ borderRadius: 'var(--radius-ctrl)' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.edit} />
                </svg>
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                title={t('common.delete')}
                aria-label={t('sidepanel.skill.actions.deleteSkill', { name: skill.name })}
                onClick={onDelete}
                className="ds-action-btn ds-action-btn-delete w-7 h-7 flex items-center justify-center"
                style={{ borderRadius: 'var(--radius-ctrl)' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.trash} />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Description — give it air */}
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ds-text-secondary)', marginTop: '8px' }}>
        {skill.description}
      </p>

      {/* Meta — a quiet rule-separated line, not a cluster of pills */}
      {((skill.remote && (skill.remote.repository || skill.remote.path)) || skill.memoryEnabled) && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]"
          style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--ds-border)', color: 'var(--ds-text-tertiary)' }}
        >
          {skill.remote && skill.remote.repository && (
            <span className="font-mono">{skill.remote.repository}</span>
          )}
          {skill.remote && skill.remote.path && (
            <span>{skill.remote.path}</span>
          )}
          {skill.remote && skill.remote.provider === 'local' && skill.remote.localDirectory && (
            <span className="font-mono">{skill.remote.localDirectory ?? skill.remote.localRootPath}</span>
          )}
          {skill.memoryEnabled && (
            <span className="inline-flex items-center gap-1" style={{ color: 'var(--ds-success)' }}>
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.chip} />
              </svg>
              {t('sidepanel.skill.memoryEnabledBadge')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
