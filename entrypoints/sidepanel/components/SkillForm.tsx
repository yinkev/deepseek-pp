import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Skill } from '../../../core/types';
import { useI18n } from '../i18n';
import { TextAreaField, TextField, ToggleRow } from './settings/primitives';

interface Props {
  initialSkill?: Skill | null;
  onSave: (skill: Skill) => void;
  onCancel: () => void;
}

export default function SkillForm({ initialSkill, onSave, onCancel }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(initialSkill?.name ?? '');
  const [description, setDescription] = useState(initialSkill?.description ?? '');
  const [instructions, setInstructions] = useState(initialSkill?.instructions ?? '');
  const [memoryEnabled, setMemoryEnabled] = useState(initialSkill?.memoryEnabled ?? false);

  const normalizedName = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const isEditing = Boolean(initialSkill);

  useEffect(() => {
    setName(initialSkill?.name ?? '');
    setDescription(initialSkill?.description ?? '');
    setInstructions(initialSkill?.instructions ?? '');
    setMemoryEnabled(initialSkill?.memoryEnabled ?? false);
  }, [initialSkill]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizedName || !instructions.trim()) return;
    onSave({
      name: normalizedName,
      description: description.trim(),
      instructions: instructions.trim(),
      source: 'custom',
      memoryEnabled,
      enabled: initialSkill?.enabled !== false,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="ds-command-form">
      <div className="ds-command-field">
        <TextField
          label={t('sidepanel.skill.form.nameLabel')}
          placeholder={t('sidepanel.skill.form.namePlaceholder')}
          value={name}
          onChange={setName}
        />
        {normalizedName && (
          <div className="ds-command-trigger-preview">
            <span>{t('sidepanel.skill.form.triggerCommand')}</span>
            <code>/{normalizedName}</code>
          </div>
        )}
      </div>

      <TextField
        label={t('sidepanel.skill.form.descriptionLabel')}
        placeholder={t('sidepanel.skill.form.descriptionPlaceholder')}
        value={description}
        onChange={setDescription}
      />

      <TextAreaField
        label={t('sidepanel.skill.form.instructionsLabel')}
        placeholder={t('sidepanel.skill.form.instructionsPlaceholder')}
        value={instructions}
        rows={6}
        fieldClassName="ds-command-field"
        textareaClassName="ds-command-textarea"
        onChange={setInstructions}
      />

      <ToggleRow
        title={t('sidepanel.skill.form.memoryInjectionLabel')}
        enabled={memoryEnabled}
        onToggle={setMemoryEnabled}
      />

      <div className="ds-command-form-actions">
        <Button
          type="button"
          onClick={onCancel}
          variant="outline"
          size="sm"
          className="ds-command-form-button"
        >
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          disabled={!normalizedName || !instructions.trim()}
          variant="default"
          size="sm"
          className="ds-command-form-button"
        >
          {isEditing ? t('common.saveChanges') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}
