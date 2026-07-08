import { useI18n } from '../../i18n';
import { SettingsSection, StatusMessage, TextField, useConfirm } from './primitives';
import type { SettingsState } from './useSettingsState';

export default function ApiSubPage({ state }: { state: SettingsState }) {
  const { t } = useI18n();
  const { confirm, node: confirmNode } = useConfirm();
  const apiStatusLabel = state.apiKeyConfigured
    ? t('sidepanel.settings.configured')
    : t('sidepanel.settings.notConfigured');
  const openaiStatusLabel = state.multimodalConfigured.openaiConfigured
    ? t('sidepanel.settings.configured')
    : t('sidepanel.settings.notConfigured');
  const geminiStatusLabel = state.multimodalConfigured.geminiConfigured
    ? t('sidepanel.settings.configured')
    : t('sidepanel.settings.notConfigured');

  const handleClearApiKey = async () => {
    const ok = await confirm({
      title: t('sidepanel.settings.clearApiKey'),
      message: t('sidepanel.settings.clearApiKeyConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    state.handleClearApiKey(
      t('sidepanel.settings.clearFailed'),
      t('sidepanel.settings.apiKeyCleared'),
    );
  };

  return (
    <div className="space-y-5">
      {confirmNode}
      <SettingsSection
        title="DeepSeek API Key"
        description={t('sidepanel.settings.apiKeyDescription')}
      >
        <TextField
          label="DeepSeek API Key"
          meta={
            <span
              className="ds-settings-field-state"
              data-state={state.apiKeyConfigured ? 'configured' : 'not-configured'}
            >
              {apiStatusLabel}
            </span>
          }
          type="password"
          value={state.apiKeyInput}
          placeholder={state.apiKeyConfigured ? t('sidepanel.settings.apiKeyReplacePlaceholder') : 'sk-...'}
          onChange={state.setApiKeyInput}
          onKeyDown={(e) => e.key === 'Enter' && state.handleSaveApiKey({
            apiKeyRequired: t('sidepanel.settings.apiKeyRequired'),
            saveFailed: t('sidepanel.settings.saveFailed'),
            apiKeySaved: t('sidepanel.settings.apiKeySaved'),
          })}
          trailing={
            <button
              onClick={() => state.handleSaveApiKey({
                apiKeyRequired: t('sidepanel.settings.apiKeyRequired'),
                saveFailed: t('sidepanel.settings.saveFailed'),
                apiKeySaved: t('sidepanel.settings.apiKeySaved'),
              })}
              disabled={!state.apiKeyInput.trim() || state.apiKeyStatus === 'saving'}
              className="ds-btn-secondary shrink-0 px-3 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
            >
              {state.apiKeyStatus === 'saving' ? t('sidepanel.settings.saving') : t('common.save')}
            </button>
          }
        />

        {state.apiKeyConfigured && (
          <button
            onClick={handleClearApiKey}
            disabled={state.apiKeyStatus === 'clearing'}
            className="ds-btn-secondary w-full py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
          >
            {state.apiKeyStatus === 'clearing' ? t('sidepanel.settings.clearing') : t('sidepanel.settings.clearApiKey')}
          </button>
        )}

        {state.apiKeyMessage && (
          <StatusMessage tone={state.apiKeyStatus === 'error' ? 'error' : 'success'}>
            {state.apiKeyMessage}
          </StatusMessage>
        )}
      </SettingsSection>

      <SettingsSection
        title={t('sidepanel.settings.multimodalApi')}
        description={t('sidepanel.settings.multimodalApiDescription')}
      >
        <div className="grid grid-cols-1 gap-2">
          <TextField
            label="OpenAI API Key"
            meta={
              <span
                className="ds-settings-field-state"
                data-state={state.multimodalConfigured.openaiConfigured ? 'configured' : 'not-configured'}
              >
                {openaiStatusLabel}
              </span>
            }
            type="password"
            value={state.openaiApiKeyInput}
            placeholder={state.multimodalConfigured.openaiConfigured ? t('sidepanel.settings.openaiKeyReplacePlaceholder') : 'sk-...'}
            onChange={state.setOpenaiApiKeyInput}
          />
          <TextField
            label="Gemini API Key"
            meta={
              <span
                className="ds-settings-field-state"
                data-state={state.multimodalConfigured.geminiConfigured ? 'configured' : 'not-configured'}
              >
                {geminiStatusLabel}
              </span>
            }
            type="password"
            value={state.geminiApiKeyInput}
            placeholder={state.multimodalConfigured.geminiConfigured ? t('sidepanel.settings.geminiKeyReplacePlaceholder') : 'AIza...'}
            onChange={state.setGeminiApiKeyInput}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <TextField
            label={t('sidepanel.settings.openaiImageModel')}
            value={state.openaiImageModel}
            placeholder="gpt-4.1-mini"
            onChange={state.setOpenaiImageModel}
          />
          <TextField
            label={t('sidepanel.settings.geminiVideoModel')}
            value={state.geminiVideoModel}
            placeholder="gemini-2.5-flash"
            onChange={state.setGeminiVideoModel}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <TextField
            label={t('sidepanel.settings.openaiBaseUrl')}
            type="url"
            value={state.openaiBaseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={state.setOpenaiBaseUrl}
          />
          <TextField
            label={t('sidepanel.settings.geminiBaseUrl')}
            type="url"
            value={state.geminiBaseUrl}
            placeholder="https://generativelanguage.googleapis.com"
            onChange={state.setGeminiBaseUrl}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => state.handleSaveMultimodal({
              baseUrlInvalid: t('sidepanel.settings.multimodalBaseUrlInvalid'),
              saveFailed: t('sidepanel.settings.saveFailed'),
              saved: t('sidepanel.settings.multimodalSaved'),
            })}
            disabled={state.multimodalStatus === 'saving'}
            className="ds-btn-secondary flex-1 px-3 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
          >
            {state.multimodalStatus === 'saving' ? t('sidepanel.settings.saving') : t('common.save')}
          </button>
          {(state.multimodalConfigured.openaiConfigured || state.multimodalConfigured.geminiConfigured) && (
            <button
              onClick={() => state.handleClearMultimodal({
                clearFailed: t('sidepanel.settings.clearFailed'),
                cleared: t('sidepanel.settings.multimodalCleared'),
              })}
              disabled={state.multimodalStatus === 'clearing'}
              className="ds-btn-secondary px-3 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
            >
              {state.multimodalStatus === 'clearing' ? t('sidepanel.settings.clearing') : t('sidepanel.settings.clearMultimodalApi')}
            </button>
          )}
        </div>

        {state.multimodalMessage && (
          <StatusMessage tone={state.multimodalStatus === 'error' ? 'error' : 'success'}>
            {state.multimodalMessage}
          </StatusMessage>
        )}
      </SettingsSection>
    </div>
  );
}
