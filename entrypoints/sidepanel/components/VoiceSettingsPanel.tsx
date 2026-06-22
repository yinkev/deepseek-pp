import { useEffect, useState } from 'react';
import {
  DEFAULT_VOICE_SETTINGS,
  detectVoiceCapabilities,
  normalizeVoiceSettings,
  type VoiceCapabilityState,
  type VoiceSettings,
} from '../../../core/voice/settings';
import { useI18n } from '../i18n';

export default function VoiceSettingsPanel() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [capabilities, setCapabilities] = useState<VoiceCapabilityState>(detectVoiceCapabilities());

  useEffect(() => {
    const localCapabilities = detectVoiceCapabilities();
    Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_VOICE_SETTINGS' }),
      chrome.runtime.sendMessage({ type: 'GET_VOICE_CAPABILITIES' }),
    ]).then(([voiceSettings, voiceCapabilities]) => {
      setSettings(normalizeVoiceSettings(voiceSettings));
      setCapabilities({
        speechRecognition: localCapabilities.speechRecognition || voiceCapabilities?.speechRecognition === true,
        speechSynthesis: localCapabilities.speechSynthesis || voiceCapabilities?.speechSynthesis === true,
      });
    }).catch(() => undefined);
  }, []);

  const save = async (patch: Partial<VoiceSettings>) => {
    const next = normalizeVoiceSettings({ ...settings, ...patch });
    setSettings(next);
    const saved = await chrome.runtime.sendMessage({ type: 'SAVE_VOICE_SETTINGS', payload: next });
    setSettings(normalizeVoiceSettings(saved));
  };

  return (
    <section className="space-y-3">
      <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
        {t('sidepanel.voice.title')}
      </h2>
      <div className="ds-surface-panel rounded-xl p-4 space-y-3">
        <VoiceToggle
          title={t('sidepanel.voice.input')}
          description={capabilities.speechRecognition
            ? t('sidepanel.voice.inputDescription')
            : t('sidepanel.voice.inputUnsupported')}
          enabled={settings.inputEnabled}
          supported={capabilities.speechRecognition}
          onToggle={(enabled) => save({ inputEnabled: enabled })}
        />
        <VoiceToggle
          title={t('sidepanel.voice.readAloud')}
          description={capabilities.speechSynthesis
            ? t('sidepanel.voice.readAloudDescription')
            : t('sidepanel.voice.readAloudUnsupported')}
          enabled={settings.readAloudEnabled}
          supported={capabilities.speechSynthesis}
          onToggle={(enabled) => save({ readAloudEnabled: enabled })}
        />

        <Slider
          label={t('sidepanel.voice.rate')}
          value={settings.rate}
          min={0.5}
          max={2}
          step={0.1}
          onChange={(rate) => save({ rate })}
        />
        <Slider
          label={t('sidepanel.voice.pitch')}
          value={settings.pitch}
          min={0.5}
          max={2}
          step={0.1}
          onChange={(pitch) => save({ pitch })}
        />
      </div>
    </section>
  );
}

function VoiceToggle({
  title,
  description,
  enabled,
  supported,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  supported: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div className="flex justify-between items-center gap-3">
      <div>
        <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>{title}</div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
          {description}
        </div>
      </div>
      <button
        onClick={() => onToggle(!enabled)}
        disabled={!supported}
        className="relative shrink-0 w-10 h-8 rounded-lg transition-colors duration-200 disabled:opacity-40"
      >
        <span
          className="absolute left-1 top-1/2 h-[18px] w-8 -translate-y-1/2 rounded-full transition-colors duration-200"
          style={{ background: enabled && supported ? 'var(--ds-blue)' : 'var(--ds-border)' }}
        >
          <span
            className="ds-switch-thumb absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full transition-transform duration-200"
            style={{ transform: enabled && supported ? 'translateX(14px)' : 'translateX(0)' }}
          />
        </span>
      </button>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
          {label}
        </label>
        <span className="text-[11px] font-mono" style={{ color: 'var(--ds-text-tertiary)' }}>
          {value.toFixed(1)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--ds-blue) ${((value - min) / (max - min)) * 100}%, var(--ds-border) ${((value - min) / (max - min)) * 100}%)`,
        }}
      />
    </div>
  );
}
