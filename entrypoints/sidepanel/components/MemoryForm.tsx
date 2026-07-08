import { useState } from 'react';
import type { Memory, MemoryType, NewMemory } from '../../../core/types';
import { MEMORY_TYPE_CONFIG } from '../constants';
import { useI18n } from '../i18n';
import { SegmentedControl, TextAreaField, TextField } from './settings/primitives';

interface Props {
  initial?: Memory | null;
  onSave: (mem: NewMemory) => void;
  onCancel: () => void;
}

export default function MemoryForm({ initial, onSave, onCancel }: Props) {
  const { t } = useI18n();
  const [type, setType] = useState<MemoryType>(initial?.type ?? 'topic');
  const [name, setName] = useState(initial?.name ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [tags, setTags] = useState(initial?.tags?.join(', ') ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    onSave({
      type,
      name: name.trim(),
      content: content.trim(),
      description: name.trim(),
      tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      pinned: initial?.pinned ?? false,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="ds-library-form">
      <div className="ds-library-field">
        <span>{t('sidepanel.memory.form.typeLabel')}</span>
        <SegmentedControl
          options={MEMORY_TYPE_CONFIG.map((typeConfig) => ({
            key: typeConfig.key,
            label: t(typeConfig.labelKey),
          }))}
          value={type}
          onChange={setType}
          ariaLabel={t('sidepanel.memory.form.typeLabel')}
          size="sm"
        />
      </div>

      <TextField
        label={t('sidepanel.memory.form.nameLabel')}
        value={name}
        placeholder={t('sidepanel.memory.form.namePlaceholder')}
        onChange={setName}
      />

      <TextAreaField
        label={t('sidepanel.memory.form.contentLabel')}
        value={content}
        placeholder={t('sidepanel.memory.form.contentPlaceholder')}
        rows={4}
        onChange={setContent}
      />

      <TextField
        label={t('sidepanel.memory.form.tagsLabel')}
        value={tags}
        placeholder={t('sidepanel.memory.form.tagsPlaceholder')}
        onChange={setTags}
      />

      <div className="ds-library-form-actions">
        <button
          type="button"
          onClick={onCancel}
          className="ds-btn-cancel"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="ds-btn-primary"
          disabled={!name.trim() || !content.trim()}
        >
          {initial ? t('common.update') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
