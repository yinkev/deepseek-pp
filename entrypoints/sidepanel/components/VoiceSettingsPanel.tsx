import { useEffect, useState } from 'react';
import {
  DEFAULT_VOICE_SETTINGS,
  detectVoiceCapabilities,
  normalizeVoiceSettings,
  type VoiceCapabilityState,
  type VoiceSettings,
} from '../../../core/voice/settings';
import { useI18n } from '../i18n';
import { getRuntimeErrorMessage, unwrapRuntimeResponse } from '../runtime-response';
import { SettingsSection, Slider, StatusMessage, ToggleRow } from './settings/primitives';

export default function VoiceSettingsPanel() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [capabilities, setCapabilities] = useState<VoiceCapabilityState>(detectVoiceCapabilities());
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    const localCapabilities = detectVoiceCapabilities();
    Promise.allSettled([
      chrome.runtime.sendMessage({ type: 'GET_VOICE_SETTINGS' }),
      chrome.runtime.sendMessage({ type: 'GET_VOICE_CAPABILITIES' }),
    ]).then(([voiceSettingsResult, voiceCapabilitiesResult]) => {
      if (voiceSettingsResult.status === 'rejected') {
        throw voiceSettingsResult.reason;
      }
      const loaded = unwrapRuntimeResponse<VoiceSettings>(
        voiceSettingsResult.value,
        t('sidepanel.voice.backendUnavailable'),
      );
      const remoteCapabilities = normalizeRemoteCapabilities(
        voiceCapabilitiesResult.status === 'fulfilled' ? voiceCapabilitiesResult.value : null,
      );
      setSettings(normalizeVoiceSettings(loaded));
      setCapabilities({
        speechRecognition: localCapabilities.speechRecognition || remoteCapabilities.speechRecognition,
        speechSynthesis: localCapabilities.speechSynthesis || remoteCapabilities.speechSynthesis,
      });
    }).catch((error) => {
      setSettings(DEFAULT_VOICE_SETTINGS);
      setStatusMessage(t('sidepanel.voice.loadFailed', {
        error: getVoiceIssueMessage(error, t('sidepanel.voice.backendUnavailable')),
      }));
    });
  }, [t]);

  const save = async (patch: Partial<VoiceSettings>) => {
    const previous = settings;
    const next = normalizeVoiceSettings({ ...settings, ...patch });
    setSettings(next);
    setStatusMessage('');
    try {
      const saved = unwrapRuntimeResponse<VoiceSettings>(
        await chrome.runtime.sendMessage({ type: 'SAVE_VOICE_SETTINGS', payload: next }),
        t('sidepanel.voice.backendUnavailable'),
      );
      setSettings(normalizeVoiceSettings(saved));
    } catch (error) {
      setSettings(previous);
      setStatusMessage(t('sidepanel.voice.saveFailed', {
        error: getVoiceIssueMessage(error, t('sidepanel.voice.backendUnavailable')),
      }));
    }
  };

  return (
    <SettingsSection title={t('sidepanel.voice.title')}>
      <VoiceToggle
        title={t('sidepanel.voice.input')}
        description={capabilities.speechRecognition
          ? t('sidepanel.voice.inputDescription')
          : t('sidepanel.voice.inputUnsupported')}
        enabled={settings.inputEnabled}
        supported={capabilities.speechRecognition}
        disabledLabel={capabilities.speechRecognition ? undefined : t('common.unavailable')}
        onToggle={(enabled) => save({ inputEnabled: enabled })}
      />
      <VoiceToggle
        title={t('sidepanel.voice.readAloud')}
        description={capabilities.speechSynthesis
          ? t('sidepanel.voice.readAloudDescription')
          : t('sidepanel.voice.readAloudUnsupported')}
        enabled={settings.readAloudEnabled}
        supported={capabilities.speechSynthesis}
        disabledLabel={capabilities.speechSynthesis ? undefined : t('common.unavailable')}
        onToggle={(enabled) => save({ readAloudEnabled: enabled })}
      />
      <Slider
        label={t('sidepanel.voice.rate')}
        value={settings.rate}
        min={0.5}
        max={2}
        step={0.1}
        format={(value) => value.toFixed(1)}
        onChange={(rate) => save({ rate })}
      />
      <Slider
        label={t('sidepanel.voice.pitch')}
        value={settings.pitch}
        min={0.5}
        max={2}
        step={0.1}
        format={(value) => value.toFixed(1)}
        onChange={(pitch) => save({ pitch })}
      />
      {statusMessage && (
        <StatusMessage tone="error">
          {statusMessage}
        </StatusMessage>
      )}
    </SettingsSection>
  );
}

function normalizeRemoteCapabilities(value: unknown): VoiceCapabilityState {
  const object = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<VoiceCapabilityState>
    : {};
  return {
    speechRecognition: object.speechRecognition === true,
    speechSynthesis: object.speechSynthesis === true,
  };
}

function getVoiceIssueMessage(error: unknown, fallback: string): string {
  const message = getRuntimeErrorMessage(error).trim();
  if (!message || message === 'undefined' || message === 'null') return fallback;
  if (
    /\b(GET|SAVE|CLEAR|SET|DELETE|WEBDAV)_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|IndexedDB|deepseek_pp_[a-z0-9_]+|Authorization|Bearer|Cookie|data:image|\[object Object\]|apiKey|openaiApiKey|geminiApiKey|OPENAI_API_KEY|GEMINI_API_KEY|DEEPSEEK_API_KEY|password|secret|token|sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+/i.test(message)
  ) {
    return fallback;
  }
  return message;
}

function VoiceToggle({
  title,
  description,
  enabled,
  supported,
  disabledLabel,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  supported: boolean;
  disabledLabel?: string;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <ToggleRow
      title={title}
      description={description}
      enabled={enabled}
      disabled={!supported}
      disabledLabel={disabledLabel}
      onToggle={onToggle}
    />
  );
}
