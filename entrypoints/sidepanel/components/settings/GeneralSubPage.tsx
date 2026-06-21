import type { LocalePreference } from '../../../../core/i18n';
import { useI18n } from '../../i18n';
import { SettingsSection, ToggleRow } from './primitives';
import type { SettingsState } from './useSettingsState';

export default function GeneralSubPage({ state }: { state: SettingsState }) {
  const { t, locale, preference: localePreference, setPreference: setLocalePreference } = useI18n();

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
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('sidepanel.settings.interfaceLanguage')}>
          {languageOptions.map((option) => {
            const active = localePreference === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => void setLocalePreference(option.value)}
                className="min-w-0 px-2 py-2.5 text-[11px] leading-tight font-medium rounded-lg border transition-all duration-150"
                style={{
                  background: active ? 'var(--ds-blue-light)' : 'var(--ds-bg)',
                  color: active ? 'var(--ds-blue)' : 'var(--ds-text-secondary)',
                  borderColor: active ? 'var(--ds-selected-border)' : 'var(--ds-border)',
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('sidepanel.settings.modelSection')}
        description={t('sidepanel.settings.expertModeDescription')}
      >
        <ToggleRow
          title={t('sidepanel.settings.expertMode')}
          description={t('sidepanel.settings.expertModeDescription')}
          enabled={state.expertMode}
          onToggle={state.handleExpertToggle}
        />
        <div className="pt-3 border-t" style={{ borderColor: 'var(--ds-border)' }}>
          <ToggleRow
            title={t('sidepanel.settings.sidepanelChat')}
            description={t('sidepanel.settings.sidepanelChatDescription')}
            enabled={state.chatEnabled}
            onToggle={state.handleChatToggle}
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
          onToggle={(enabled) => state.handlePersonalConveniencePatch({ enabled })}
        />
        <div className="pt-3 border-t space-y-3" style={{ borderColor: 'var(--ds-border)' }}>
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
              {t('sidepanel.settings.sameSessionStrategy')}
            </span>
            <select
              value={state.personalConfig.sameSessionStrategy}
              onChange={(event) => state.handlePersonalConveniencePatch({
                sameSessionStrategy: event.target.value as typeof state.personalConfig.sameSessionStrategy,
              })}
              className="ds-input w-full px-3 py-2 text-xs rounded-lg"
              disabled={!state.personalConfig.enabled}
            >
              <option value="last">{t('sidepanel.settings.sameSessionLast')}</option>
              <option value="current">{t('sidepanel.settings.sameSessionCurrent')}</option>
              <option value="new">{t('sidepanel.settings.sameSessionNew')}</option>
            </select>
          </label>
          <ToggleRow
            title={t('sidepanel.settings.autoReadyCheck')}
            description={t('sidepanel.settings.autoReadyCheckDescription')}
            enabled={state.personalConfig.autoReadyCheckBeforeRun}
            onToggle={(autoReadyCheckBeforeRun) => state.handlePersonalConveniencePatch({ autoReadyCheckBeforeRun })}
          />
          <ToggleRow
            title={t('sidepanel.settings.autoRefreshWebAuth')}
            description={t('sidepanel.settings.autoRefreshWebAuthDescription')}
            enabled={state.personalConfig.autoRefreshWebAuth}
            onToggle={(autoRefreshWebAuth) => state.handlePersonalConveniencePatch({ autoRefreshWebAuth })}
          />
          <ToggleRow
            title={t('sidepanel.settings.visualMonitorDefault')}
            description={t('sidepanel.settings.visualMonitorDefaultDescription')}
            enabled={state.personalConfig.visualMonitorDefault}
            onToggle={(visualMonitorDefault) => state.handlePersonalConveniencePatch({ visualMonitorDefault })}
          />
          <ToggleRow
            title={t('sidepanel.settings.reducedConfirmations')}
            description={t('sidepanel.settings.reducedConfirmationsDescription')}
            enabled={state.personalConfig.reducedConfirmations}
            onToggle={(reducedConfirmations) => state.handlePersonalConveniencePatch({ reducedConfirmations })}
          />
        </div>
      </SettingsSection>
    </div>
  );
}
