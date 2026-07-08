import { useEffect, useState } from 'react';
import {
  DEFAULT_PROMPT_INJECTION_SETTINGS,
  normalizePromptInjectionSettings,
  type ForcedResponseLanguage,
  type PromptInjectionSettings,
  type PromptPresetCadence,
} from '../../../core/prompt/settings';
import { useI18n } from '../i18n';
import { getRuntimeErrorMessage, unwrapRuntimeResponse } from '../runtime-response';
import { SelectField, SettingsSection, StatusMessage, ToggleRow } from './settings/primitives';

export default function PromptControlPanel() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<PromptInjectionSettings>(DEFAULT_PROMPT_INJECTION_SETTINGS);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_PROMPT_INJECTION_SETTINGS' })
      .then((result) => {
        const loaded = unwrapRuntimeResponse<PromptInjectionSettings>(
          result,
          t('sidepanel.promptControls.backendUnavailable'),
        );
        setSettings(normalizePromptInjectionSettings(loaded));
      })
      .catch((error) => {
        setSettings(DEFAULT_PROMPT_INJECTION_SETTINGS);
        setStatusMessage(t('sidepanel.promptControls.loadFailed', {
          error: getPromptControlIssueMessage(error, t('sidepanel.promptControls.backendUnavailable')),
        }));
      });
  }, [t]);

  const save = async (patch: Partial<PromptInjectionSettings>) => {
    const previous = settings;
    const next = normalizePromptInjectionSettings({ ...settings, ...patch });
    setSettings(next);
    setStatusMessage('');
    try {
      const saved = unwrapRuntimeResponse<PromptInjectionSettings>(
        await chrome.runtime.sendMessage({
          type: 'SAVE_PROMPT_INJECTION_SETTINGS',
          payload: next,
        }),
        t('sidepanel.promptControls.backendUnavailable'),
      );
      setSettings(normalizePromptInjectionSettings(saved));
    } catch (error) {
      setSettings(previous);
      setStatusMessage(t('sidepanel.promptControls.saveFailed', {
        error: getPromptControlIssueMessage(error, t('sidepanel.promptControls.backendUnavailable')),
      }));
    }
  };

  const cadenceOptions: Array<{ value: PromptPresetCadence; label: string }> = [
    { value: 'default', label: t('sidepanel.promptControls.cadenceDefault') },
    { value: 'first_message', label: t('sidepanel.promptControls.cadenceFirst') },
    { value: 'every_message', label: t('sidepanel.promptControls.cadenceEvery') },
    { value: 'off', label: t('sidepanel.promptControls.cadenceOff') },
  ];
  const languageOptions: Array<{ value: ForcedResponseLanguage; label: string }> = [
    { value: 'auto', label: t('sidepanel.promptControls.languageAuto') },
    { value: 'zh-CN', label: t('sidepanel.promptControls.languageZh') },
    { value: 'en', label: t('sidepanel.promptControls.languageEn') },
  ];

  return (
    <SettingsSection title={t('sidepanel.promptControls.title')}>
      <ToggleRow
        title={t('sidepanel.promptControls.memory')}
        description={t('sidepanel.promptControls.memoryDescription')}
        enabled={settings.memoryEnabled}
        onToggle={(enabled) => save({ memoryEnabled: enabled })}
      />
      <ToggleRow
        title={t('sidepanel.promptControls.systemPrompt')}
        description={t('sidepanel.promptControls.systemPromptDescription')}
        enabled={settings.systemPromptEnabled}
        onToggle={(enabled) => save({ systemPromptEnabled: enabled })}
      />
      <SelectField
        label={t('sidepanel.promptControls.presetCadence')}
        value={settings.presetCadence}
        options={cadenceOptions}
        onChange={(presetCadence) => save({ presetCadence })}
      />
      <SelectField
        label={t('sidepanel.promptControls.forceLanguage')}
        value={settings.forceResponseLanguage}
        options={languageOptions}
        onChange={(forceResponseLanguage) => save({ forceResponseLanguage })}
      />
      {statusMessage && (
        <StatusMessage tone="error">
          {statusMessage}
        </StatusMessage>
      )}
    </SettingsSection>
  );
}

function getPromptControlIssueMessage(error: unknown, fallback: string): string {
  const message = getRuntimeErrorMessage(error).trim();
  if (!message || message === 'undefined' || message === 'null') return fallback;
  if (
    /\b(GET|SAVE|CLEAR|SET|DELETE|WEBDAV)_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|IndexedDB|deepseek_pp_[a-z0-9_]+|Authorization|Bearer|Cookie|data:image|\[object Object\]|apiKey|openaiApiKey|geminiApiKey|OPENAI_API_KEY|GEMINI_API_KEY|DEEPSEEK_API_KEY|password|secret|token|sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+/i.test(message)
  ) {
    return fallback;
  }
  return message;
}
