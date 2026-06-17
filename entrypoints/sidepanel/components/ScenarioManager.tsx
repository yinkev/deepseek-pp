import { useState, useEffect } from 'react';
import type { ScenarioConfig } from '../../../core/types';
import {
  localizeScenario,
  resolveBuiltInTemplateForSave,
} from '../../../core/scenario/localization';
import {
  getAllScenarios,
  saveScenario,
  deleteScenario,
  addCustomScenario,
} from '../../../core/scenario/store';
import { useI18n } from '../i18n';
import ToggleSwitch from './ToggleSwitch';

export default function ScenarioManager() {
  const { t, locale } = useI18n();
  const [scenarios, setScenarios] = useState<ScenarioConfig[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTemplate, setEditTemplate] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newTemplate, setNewTemplate] = useState('');

  useEffect(() => {
    getAllScenarios().then(setScenarios);
  }, [locale]);

  const refresh = async () => {
    const updated = await getAllScenarios();
    setScenarios(updated);
    chrome.runtime.sendMessage({ type: 'SCENARIOS_UPDATED' }).catch(() => {});
  };

  const toggleEnabled = async (scenario: ScenarioConfig) => {
    await saveScenario({ ...scenario, enabled: !scenario.enabled });
    await refresh();
  };

  const startEdit = (scenario: ScenarioConfig) => {
    const display = localizeScenario(scenario, locale);
    setEditingId(scenario.id);
    setEditTemplate(display.template);
  };

  const saveTemplate = async (scenario: ScenarioConfig) => {
    const template = scenario.builtIn
      ? resolveBuiltInTemplateForSave(scenario, editTemplate, locale)
      : editTemplate;
    await saveScenario({ ...scenario, template });
    setEditingId(null);
    await refresh();
  };

  const handleAdd = async () => {
    if (!newLabel.trim() || !newTemplate.trim()) return;
    await addCustomScenario(newLabel.trim(), newTemplate.trim());
    setNewLabel('');
    setNewTemplate('');
    await refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteScenario(id);
    await refresh();
  };

  const builtIn = scenarios.filter((scenario) => scenario.builtIn);
  const custom = scenarios.filter((scenario) => !scenario.builtIn);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.scenario.title')}
        </h3>
        <p className="text-xs mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.scenario.description')}
        </p>
      </div>

      <div className="ds-surface-panel rounded-xl divide-y" style={{ borderColor: 'var(--ds-border)' }}>
        {builtIn.map((scenario) => {
          const display = localizeScenario(scenario, locale);
          const editing = editingId === scenario.id;

          return (
            <div key={scenario.id} className="p-3 space-y-2">
              <div className="flex items-center gap-3">
                <ToggleSwitch
                  checked={scenario.enabled}
                  onChange={() => toggleEnabled(scenario)}
                  aria-label={display.label}
                />
                <span className="text-sm flex-1 min-w-0" style={{ color: 'var(--ds-text)' }}>
                  {display.label}
                </span>
                {!editing && (
                  <button
                    type="button"
                    onClick={() => startEdit(scenario)}
                    className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md shrink-0"
                  >
                    {t('common.edit')}
                  </button>
                )}
              </div>
              {editing && (
                <div className="space-y-2 pl-[52px]">
                  <textarea
                    value={editTemplate}
                    onChange={(event) => setEditTemplate(event.target.value)}
                    rows={3}
                    className="ds-input w-full rounded-lg px-3 py-2 text-xs resize-y min-h-[72px]"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="ds-btn-cancel px-2 py-1 text-[11px] rounded-md"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={() => saveTemplate(scenario)}
                      className="ds-btn-primary px-2 py-1 text-[11px] text-white rounded-md"
                    >
                      {t('common.save')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <span className="text-xs font-medium" style={{ color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.scenario.customTitle')}
        </span>

        {custom.length > 0 && (
          <div className="ds-surface-panel rounded-xl divide-y" style={{ borderColor: 'var(--ds-border)' }}>
            {custom.map((scenario) => (
              <div key={scenario.id} className="flex items-center gap-3 p-3">
                <ToggleSwitch
                  checked={scenario.enabled}
                  onChange={() => toggleEnabled(scenario)}
                  aria-label={scenario.label}
                />
                <span className="text-sm flex-1 min-w-0 truncate" style={{ color: 'var(--ds-text)' }}>
                  {scenario.label}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(scenario.id)}
                  className="ds-text-btn-delete px-2 py-1 text-[11px] rounded-md shrink-0"
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="ds-surface-panel rounded-xl p-3 space-y-2">
          <input
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder={t('sidepanel.scenario.namePlaceholder')}
            className="ds-input w-full rounded-lg px-3 py-2 text-xs"
          />
          <textarea
            value={newTemplate}
            onChange={(event) => setNewTemplate(event.target.value)}
            placeholder={t('sidepanel.scenario.templatePlaceholder')}
            rows={2}
            className="ds-input w-full rounded-lg px-3 py-2 text-xs resize-y min-h-[56px]"
          />
          <button
            type="button"
            onClick={handleAdd}
            className="ds-btn-primary px-3 py-1.5 text-xs text-white rounded-lg"
          >
            {t('common.add')}
          </button>
        </div>
      </div>
    </div>
  );
}