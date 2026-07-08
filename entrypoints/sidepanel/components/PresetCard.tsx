import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SystemPromptPreset } from '../../../core/types';
import { useI18n } from '../i18n';

interface Props {
  preset: SystemPromptPreset;
  isActive: boolean;
  activeKnown?: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function PresetCard({
  preset,
  isActive,
  activeKnown = true,
  onActivate,
  onDeactivate,
  onEdit,
  onDelete,
}: Props) {
  const { t } = useI18n();
  const preview = preset.content.replace(/\s+/g, ' ').trim();
  const state = !activeKnown ? 'unknown' : isActive ? 'active' : 'available';
  const stateLabel = !activeKnown
    ? t('sidepanel.preset.selectionUnknown')
    : isActive ? t('sidepanel.preset.inUse') : t('sidepanel.preset.available');
  const badgeVariant = !activeKnown ? 'destructive' : isActive ? 'secondary' : 'outline';

  return (
    <article className={`ds-preset-row${isActive ? ' ds-preset-row-active' : ''}`} aria-current={isActive ? 'true' : undefined}>
      <div className="ds-preset-row-head">
        <div className="ds-preset-row-main">
          <div className="ds-preset-titleline">
            <span className="ds-preset-title">{preset.name}</span>
            <Badge variant={badgeVariant} className="ds-preset-status" data-state={state}>
              {stateLabel}
            </Badge>
          </div>
          <p className="ds-preset-preview">
            {preview || t('sidepanel.preset.emptyPreview')}
          </p>
        </div>
        <div className="ds-preset-actions">
          <Button
            type="button"
            variant={isActive ? 'outline' : 'default'}
            size="sm"
            onClick={isActive ? onDeactivate : onActivate}
            className="ds-preset-action"
          >
            {isActive ? t('sidepanel.preset.stopUsing') : t('sidepanel.preset.use')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onEdit}
            aria-label={t('common.edit')}
            className="ds-preset-action"
          >
            {t('common.edit')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onDelete}
            aria-label={t('common.delete')}
            className="ds-preset-action"
          >
            {t('common.delete')}
          </Button>
        </div>
      </div>
    </article>
  );
}
