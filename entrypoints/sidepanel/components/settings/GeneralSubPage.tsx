import type { LocalePreference } from '../../../../core/i18n';
import { useI18n } from '../../i18n';
import { SelectField, SettingsSection, SettingsSegmentedGroup, StatusMessage, ToggleRow } from './primitives';
import type { SettingsState } from './useSettingsState';

export default function GeneralSubPage({ state }: { state: SettingsState }) {
  const { t, locale, preference: localePreference, setPreference: setLocalePreference } = useI18n();
  const saveFailed = t('sidepanel.settings.saveFailed');

  const currentLanguageLabel =
    locale === 'en'
      ? t('sidepanel.settings.languageEnglish')
      : t('sidepanel.settings.languageChinese');
  const languageOptions: Array<{ value: LocalePreference; label: string }> = [
    { value: 'auto', label: t('sidepanel.settings.languageAuto') },
    { value: 'zh-CN', label: t('sidepanel.settings.languageChinese') },
    { value: 'en', label: t('sidepanel.settings.languageEnglish') },
  ];

  return (
    <div className="space-y-5">
      {state.generalMessage && (
        <StatusMessage tone="error">{state.generalMessage}</StatusMessage>
      )}

      <SettingsSection
        title={t('sidepanel.settings.interfaceSection')}
        description={t('sidepanel.settings.interfaceLanguageDescription')}
      >
        <div>
          <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
            {t('sidepanel.settings.interfaceLanguage')}
          </div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.settings.languageCurrent', { language: currentLanguageLabel })}
          </div>
        </div>
        <SettingsSegmentedGroup
          ariaLabel={t('sidepanel.settings.interfaceLanguage')}
          options={languageOptions}
          value={localePreference}
          onChange={(value) => void setLocalePreference(value)}
        />
        <div className="pt-3 border-t space-y-2" style={{ borderColor: 'var(--ds-border)' }}>
          <div>
            <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
              {t('sidepanel.settings.descriptionDensity')}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.settings.descriptionDensityDescription')}
            </div>
          </div>
          <SettingsSegmentedGroup
            ariaLabel={t('sidepanel.settings.descriptionDensity')}
            options={(['comfortable', 'compact'] as const).map((density) => ({
              value: density,
              label: density === 'compact'
                ? t('sidepanel.settings.descriptionDensityCompact')
                : t('sidepanel.settings.descriptionDensityComfortable'),
            }))}
            value={state.personalConfig.descriptionDensity}
            onChange={(descriptionDensity) => void state.handlePersonalConveniencePatch({ descriptionDensity }, saveFailed)}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('sidepanel.settings.modelSection')}
      >
        <ToggleRow
          title={t('sidepanel.settings.expertMode')}
          description={t('sidepanel.settings.expertModeDescription')}
          enabled={state.expertMode}
          onToggle={(enabled) => void state.handleExpertToggle(enabled, saveFailed)}
        />
        <div className="pt-3 border-t" style={{ borderColor: 'var(--ds-border)' }}>
          <ToggleRow
            title={t('sidepanel.settings.sidepanelChat')}
            description={t('sidepanel.settings.sidepanelChatDescription')}
            enabled={state.chatEnabled}
            onToggle={(enabled) => void state.handleChatToggle(enabled, saveFailed)}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('sidepanel.settings.personalConvenience')}
        description={t('sidepanel.settings.personalConvenienceDescription')}
      >
        <ToggleRow
          title={t('sidepanel.settings.personalConvenienceMode')}
          description={t('sidepanel.settings.personalConvenienceModeDescription')}
          enabled={state.personalConfig.enabled}
          onToggle={(enabled) => void state.handlePersonalConveniencePatch({ enabled }, saveFailed)}
        />
        <div className="pt-3 border-t space-y-3" style={{ borderColor: 'var(--ds-border)' }}>
          <SelectField
            label={t('sidepanel.settings.sameSessionStrategy')}
            value={state.personalConfig.sameSessionStrategy}
            disabled={!state.personalConfig.enabled}
            options={[
              { value: 'last', label: t('sidepanel.settings.sameSessionLast') },
              { value: 'current', label: t('sidepanel.settings.sameSessionCurrent') },
              { value: 'new', label: t('sidepanel.settings.sameSessionNew') },
            ]}
            onChange={(sameSessionStrategy) => void state.handlePersonalConveniencePatch({ sameSessionStrategy }, saveFailed)}
          />
          <ToggleRow
            title={t('sidepanel.settings.autoReadyCheck')}
            description={t('sidepanel.settings.autoReadyCheckDescription')}
            enabled={state.personalConfig.autoReadyCheckBeforeRun}
            onToggle={(autoReadyCheckBeforeRun) => void state.handlePersonalConveniencePatch({ autoReadyCheckBeforeRun }, saveFailed)}
          />
          <ToggleRow
            title={t('sidepanel.settings.autoRefreshWebAuth')}
            description={t('sidepanel.settings.autoRefreshWebAuthDescription')}
            enabled={state.personalConfig.autoRefreshWebAuth}
            onToggle={(autoRefreshWebAuth) => void state.handlePersonalConveniencePatch({ autoRefreshWebAuth }, saveFailed)}
          />
          <ToggleRow
            title={t('sidepanel.settings.visualMonitorDefault')}
            description={t('sidepanel.settings.visualMonitorDefaultDescription')}
            enabled={state.personalConfig.visualMonitorDefault}
            onToggle={(visualMonitorDefault) => void state.handlePersonalConveniencePatch({ visualMonitorDefault }, saveFailed)}
          />
          <ToggleRow
            title={t('sidepanel.settings.reducedConfirmations')}
            description={t('sidepanel.settings.reducedConfirmationsDescription')}
            enabled={state.personalConfig.reducedConfirmations}
            onToggle={(reducedConfirmations) => void state.handlePersonalConveniencePatch({ reducedConfirmations }, saveFailed)}
          />
        </div>
      </SettingsSection>
    </div>
  );
}
