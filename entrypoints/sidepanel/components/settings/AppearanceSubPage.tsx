import type { PetPosition } from '../../../../core/types';
import { SVG_PATHS } from '../../constants';
import { useI18n } from '../../i18n';
import { SettingsSection, SettingsSegmentedGroup, Slider, StatusMessage, TextField, ToggleRow } from './primitives';
import type { SettingsState } from './useSettingsState';

type SelectablePetPosition = Exclude<PetPosition, 'custom'>;

export default function AppearanceSubPage({ state }: { state: SettingsState }) {
  const { t } = useI18n();

  const petPositionItems: Array<{ key: SelectablePetPosition; label: string }> = [
    { key: 'bottom-right', label: t('sidepanel.settings.positionBottomRight') },
    { key: 'bottom-left', label: t('sidepanel.settings.positionBottomLeft') },
  ];
  const isCustomPetPosition = state.petPosition === 'custom';
  const selectedPetPosition: SelectablePetPosition | null =
    state.petPosition === 'custom' ? null : state.petPosition;
  const saveFailed = t('sidepanel.settings.saveFailed');
  const clearFailed = t('sidepanel.settings.clearFailed');

  return (
    <div className="space-y-5">
      {state.appearanceMessage && (
        <StatusMessage tone="error">{state.appearanceMessage}</StatusMessage>
      )}

      <SettingsSection
        title={t('sidepanel.settings.backgroundSection')}
        description={t('sidepanel.settings.customBackgroundDescription')}
      >
        <ToggleRow
          title={t('sidepanel.settings.customBackground')}
          enabled={state.bgEnabled}
          disabled={!state.bgPreview}
          onToggle={(enabled) => void state.handleBgToggle(enabled, saveFailed)}
        />

        <div className="ds-settings-control-group">
          <div className="ds-field-label-row">
            <span className="ds-field-label-text">
              {t('sidepanel.settings.backgroundSource')}
            </span>
          </div>
          <input
            ref={state.fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void state.handleFileSelect(event, saveFailed)}
          />
          <div className="ds-background-source-row">
            <button
              onClick={() => state.fileInputRef.current?.click()}
              className="ds-btn-secondary ds-background-upload-button"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.upload} />
              </svg>
              {t('sidepanel.settings.uploadImage')}
            </button>
            <TextField
              label={t('sidepanel.settings.imageUrl')}
              type="url"
              placeholder={t('sidepanel.settings.imageUrlPlaceholder')}
              value={state.bgUrl}
              onChange={state.setBgUrl}
              onKeyDown={(e) => e.key === 'Enter' && void state.handleUrlConfirm(saveFailed)}
              trailing={
                <button
                  onClick={() => void state.handleUrlConfirm(saveFailed)}
                  disabled={!state.bgUrl.trim()}
                  className="ds-btn-secondary shrink-0 px-3 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
                >
                  {t('common.confirm')}
                </button>
              }
            />
          </div>
        </div>

        {state.bgPreview && (
          <div
            className="relative rounded-lg overflow-hidden border"
            style={{ borderColor: 'var(--ds-border)', height: '120px' }}
          >
            <img
              src={state.bgPreview}
              alt={t('sidepanel.settings.backgroundPreviewAlt')}
              className="w-full h-full object-cover"
              onError={() => { state.setBgUrl(''); }}
            />
            <div
              className="absolute inset-0 flex items-center justify-center text-[10px]"
              style={{
                background: `rgba(var(--ds-bg-rgb), ${(1 - state.bgOpacity).toFixed(3)})`,
                backdropFilter: `blur(${((1 - state.bgOpacity) * 8).toFixed(1)}px)`,
                WebkitBackdropFilter: `blur(${((1 - state.bgOpacity) * 8).toFixed(1)}px)`,
                color: 'var(--ds-text-secondary)',
                pointerEvents: 'none',
              }}
            >
              {t('sidepanel.settings.backgroundPreviewOverlay')}
            </div>
          </div>
        )}

        <Slider
          label={t('sidepanel.settings.backgroundOpacity')}
          value={state.bgOpacity}
          min={0.05}
          max={1}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(value) => state.handleOpacityChange(value, saveFailed)}
        />

        {state.bgPreview && (
          <button
            onClick={() => void state.handleClearBg(clearFailed)}
            className="ds-btn-danger w-full py-2 text-[11px] font-medium rounded-lg transition-all duration-150"
          >
            {t('sidepanel.settings.clearBackground')}
          </button>
        )}
      </SettingsSection>

      <SettingsSection
        title={t('sidepanel.settings.floatingPetSection')}
        description={t('sidepanel.settings.petWhaleDescription')}
      >
        <ToggleRow
          title={t('sidepanel.settings.petWhale')}
          enabled={state.petEnabled}
          onToggle={(enabled) => void state.handlePetToggle(enabled, saveFailed)}
        />

        <div className="ds-settings-control-group">
          <div className="ds-field-label-row">
            <span className="ds-field-label-text">
              {t('sidepanel.settings.petPosition')}
            </span>
            {isCustomPetPosition && (
              <span className="ds-settings-field-state" data-state="custom">
                {t('sidepanel.settings.positionCustom')}
              </span>
            )}
          </div>
          <SettingsSegmentedGroup<SelectablePetPosition>
            ariaLabel={t('sidepanel.settings.petPosition')}
            options={petPositionItems.map((item) => ({ value: item.key, label: item.label }))}
            value={selectedPetPosition}
            onChange={(position) => void state.handlePetPositionChange(position, saveFailed)}
          />
        </div>

        <Slider
          label={t('sidepanel.settings.size')}
          value={state.petSize}
          min={84}
          max={220}
          step={4}
          format={(v) => `${v}px`}
          onChange={(value) => state.handlePetSizeChange(value, saveFailed)}
        />

        <Slider
          label={t('sidepanel.settings.opacity')}
          value={state.petOpacity}
          min={0.45}
          max={1}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(value) => state.handlePetOpacityChange(value, saveFailed)}
        />

        <ToggleRow
          title={t('sidepanel.settings.petMotion')}
          description={t('sidepanel.settings.petMotionDescription')}
          enabled={state.petMotion}
          onToggle={(motion) => void state.handlePetMotionToggle(motion, saveFailed)}
        />
      </SettingsSection>
    </div>
  );
}
