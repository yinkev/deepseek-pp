import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { SystemPromptPreset } from '../../../core/types';
import { useI18n } from '../i18n';
import { TextAreaField, TextField } from './settings/primitives';

interface Props {
  initial?: SystemPromptPreset;
  onSave: (preset: SystemPromptPreset) => void;
  onCancel: () => void;
}

export default function PresetForm({ initial, onSave, onCancel }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? '');
  const [content, setContent] = useState(initial?.content ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    const now = Date.now();
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      content: content.trim(),
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="ds-form ds-preset-form">
      <div className="ds-preset-form-head">
        <h3>{initial ? t('sidepanel.preset.form.editTitle') : t('sidepanel.preset.form.createTitle')}</h3>
      </div>

      <TextField
        label={t('sidepanel.preset.form.nameLabel')}
        value={name}
        placeholder={t('sidepanel.preset.form.namePlaceholder')}
        onChange={setName}
      />

      <TextAreaField
        label={t('sidepanel.preset.form.contentLabel')}
        value={content}
        placeholder={t('sidepanel.preset.form.contentPlaceholder')}
        rows={6}
        onChange={setContent}
      />

      <div className="ds-preset-form-actions">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="ds-preset-form-action"
        >
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!name.trim() || !content.trim()}
          className="ds-preset-form-action"
        >
          {initial ? t('common.update') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}
