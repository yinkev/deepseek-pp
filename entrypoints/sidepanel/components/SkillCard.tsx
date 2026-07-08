import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { LocaleMessageKey } from '../../../core/i18n';
import type { Skill } from '../../../core/types';
import { useI18n } from '../i18n';

interface Props {
  skill: Skill;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleEnabled?: () => void;
  showSourceBadge?: boolean;
}

const SOURCE_LABELS: Record<string, { labelKey: LocaleMessageKey }> = {
  builtin: { labelKey: 'sidepanel.skill.sources.builtin' },
  official: { labelKey: 'sidepanel.skill.sources.official' },
  'third-party': { labelKey: 'sidepanel.skill.sources.thirdParty' },
  custom: { labelKey: 'sidepanel.skill.sources.custom' },
  remote: { labelKey: 'sidepanel.skill.sources.remote' },
};

export default function SkillCard({
  skill,
  onEdit,
  onDelete,
  onToggleEnabled,
  showSourceBadge = true,
}: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [isVisuallyTruncated, setIsVisuallyTruncated] = useState(false);
  const descriptionId = useId();
  const descriptionPreviewRef = useRef<HTMLParagraphElement | null>(null);
  const badge = skill.remote?.provider === 'local'
    ? { labelKey: 'sidepanel.skill.sources.local' as LocaleMessageKey }
    : SOURCE_LABELS[skill.source];
  const enabled = skill.enabled !== false;
  const hasActions = Boolean(onEdit || onDelete || onToggleEnabled);
  const toggleLabel = enabled
    ? t('sidepanel.skill.actions.disableSkill', { name: skill.name })
    : t('sidepanel.skill.actions.enableSkill', { name: skill.name });
  const stateLabel = enabled ? t('common.on') : t('common.off');
  const toggleButtonText = enabled
    ? t('sidepanel.skillPage.turnOffCommand')
    : t('sidepanel.skillPage.turnOnCommand');
  const description = normalizeCommandDescription(typeof skill.description === 'string' ? skill.description.trim() : '');
  const descriptionPreview = compactDescription(description);
  const hasLongDescription = descriptionPreview !== description;
  const showDescriptionToggle = hasLongDescription || isVisuallyTruncated || expanded;

  useLayoutEffect(() => {
    if (expanded) return undefined;

    const element = descriptionPreviewRef.current;
    if (!element) {
      setIsVisuallyTruncated(false);
      return undefined;
    }

    const updateTruncation = () => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const contentWidth = typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect().width
        : 0;
      range.detach?.();
      setIsVisuallyTruncated(
        Math.max(element.scrollWidth, contentWidth) > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1,
      );
    };

    updateTruncation();

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateTruncation);
    resizeObserver?.observe(element);
    window.addEventListener('resize', updateTruncation);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateTruncation);
    };
  }, [descriptionPreview, expanded]);

  return (
    <article
      className={`ds-command-row ds-skill-card ${enabled ? 'ds-skill-card-enabled' : 'ds-skill-card-disabled'}`}
      data-state={enabled ? 'enabled' : 'disabled'}
    >
      <div className="ds-skill-row-main">
        <div className="ds-skill-row-identity">
          <code className="ds-trigger text-[12px] font-mono font-semibold px-1.5 py-0.5 rounded">
            /{skill.name}
          </code>
          {showSourceBadge && badge && (
            <Badge variant="outline" className="ds-skill-source-badge">
              {t(badge.labelKey)}
            </Badge>
          )}
          <Badge
            variant={enabled ? 'secondary' : 'destructive'}
            className={`ds-skill-status-badge ${enabled ? 'ds-skill-status-enabled' : 'ds-skill-status-disabled'}`}
          >
            {stateLabel}
          </Badge>
        </div>
        {hasActions && (
          <div className="ds-skill-card-actions">
            {onToggleEnabled && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                title={toggleLabel}
                aria-label={toggleLabel}
                onClick={onToggleEnabled}
                className={`ds-skill-toggle-button ${enabled ? 'ds-skill-toggle-disable' : 'ds-skill-toggle-enable'}`}
              >
                {toggleButtonText}
              </Button>
            )}
            {onEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                title={t('common.edit')}
                aria-label={t('sidepanel.skill.actions.editSkill', { name: skill.name })}
                onClick={onEdit}
                className="ds-command-row-action ds-command-row-edit"
              >
                {t('common.edit')}
              </Button>
            )}
            {onDelete && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                title={t('common.delete')}
                aria-label={t('sidepanel.skill.actions.deleteSkill', { name: skill.name })}
                onClick={onDelete}
                className="ds-command-row-action ds-command-row-delete"
              >
                {t('common.delete')}
              </Button>
            )}
          </div>
        )}
      </div>

      {description && (
        <div className="ds-skill-description-wrap">
          {expanded ? (
            <p id={descriptionId} className="ds-skill-description">
              {description}
            </p>
          ) : (
            <p ref={descriptionPreviewRef} id={descriptionId} className="ds-skill-description-preview">
              {descriptionPreview}
            </p>
          )}
          {showDescriptionToggle && (
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => setExpanded((value) => !value)}
              className="ds-skill-description-toggle"
              aria-expanded={expanded}
              aria-controls={descriptionId}
            >
              {expanded ? t('sidepanel.skillPage.hideDetails') : t('sidepanel.skillPage.showDetails')}
            </Button>
          )}
        </div>
      )}

      {((showSourceBadge && skill.remote && (skill.remote.repository || skill.remote.path)) || skill.memoryEnabled) && (
        <div className="ds-skill-meta">
          {showSourceBadge && skill.remote && skill.remote.repository && (
            <span className="font-mono">{skill.remote.repository}</span>
          )}
          {showSourceBadge && skill.remote && skill.remote.path && (
            <span>{skill.remote.path}</span>
          )}
          {showSourceBadge && skill.remote && skill.remote.provider === 'local' && skill.remote.localDirectory && (
            <span className="font-mono">{skill.remote.localDirectory ?? skill.remote.localRootPath}</span>
          )}
          {skill.memoryEnabled && (
            <span style={{ color: 'var(--ds-text-secondary)' }}>
              {t('sidepanel.skill.memoryEnabledBadge')}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

function compactDescription(description: string): string {
  const normalized = description.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 72) return normalized;
  return `${normalized.slice(0, 69).trimEnd()}...`;
}

function normalizeCommandDescription(description: string): string {
  return description
    .replace(/\bSkills\b/g, 'Commands')
    .replace(/\bskills\b/g, 'commands')
    .replace(/\bSkill\b/g, 'Command')
    .replace(/\bskill\b/g, 'command');
}
