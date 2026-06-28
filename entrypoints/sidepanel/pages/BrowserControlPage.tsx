import { useEffect, useMemo, useState } from 'react';
import type {
  BrowserControlSettings,
  BrowserControlState,
  BrowserControlTarget,
} from '../../../core/browser-control';
import PageIntro from '../components/PageIntro';
import {
  EmptyState,
  Meta,
  SettingsSection,
  Slider,
  ToggleRow,
  useBanner,
} from '../components/settings/primitives';
import { useI18n } from '../i18n';

type BusyState = 'idle' | 'loading' | 'saving' | 'targeting' | 'locking' | 'detaching';

const DEFAULT_SETTINGS: BrowserControlSettings = {
  enabled: true,
  targetTabId: null,
  lastTargetHint: null,
  targetLock: null,
  includeSnapshotAfterActions: false,
  allowVisionCapture: true,
  verifyAfterActions: true,
  collectEvidencePacks: true,
  debugDistillerEnabled: true,
  maxSnapshotNodes: 400,
  maxSnapshotTextBytes: 24_000,
};

export default function BrowserControlPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<BrowserControlSettings>(DEFAULT_SETTINGS);
  const [state, setState] = useState<BrowserControlState | null>(null);
  const [busy, setBusy] = useState<BusyState>('loading');
  const banner = useBanner();

  const targets = useMemo(
    () => state?.targets ?? [],
    [state?.targets],
  );

  useEffect(() => {
    void load();

    const handler = (msg: { type?: string }) => {
      if (msg.type === 'BROWSER_CONTROL_UPDATED' || msg.type === 'TOOL_DESCRIPTORS_UPDATED') {
        void load();
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const load = async () => {
    setBusy((current) => current === 'idle' ? 'loading' : current);
    try {
      const [nextSettings, nextState] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_BROWSER_CONTROL_SETTINGS' }),
        chrome.runtime.sendMessage({ type: 'GET_BROWSER_CONTROL_STATE' }),
      ]) as [BrowserControlSettings | null, BrowserControlState | null];
      setSettings(nextSettings ?? DEFAULT_SETTINGS);
      setState(nextState);
    } finally {
      setBusy('idle');
    }
  };

  const savePatch = async (patch: Partial<BrowserControlSettings>) => {
    setBusy('saving');
    banner.clear();
    try {
      const next = await chrome.runtime.sendMessage({
        type: 'SAVE_BROWSER_CONTROL_SETTINGS',
        payload: patch,
      }) as BrowserControlSettings;
      setSettings(next ?? settings);
      await load();
    } catch (error) {
      banner.show('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('idle');
    }
  };

  const setEnabled = async (enabled: boolean) => {
    setBusy('saving');
    banner.clear();
    try {
      const next = await chrome.runtime.sendMessage({
        type: 'SET_BROWSER_CONTROL_ENABLED',
        payload: { enabled },
      }) as BrowserControlSettings;
      setSettings(next ?? { ...settings, enabled });
      banner.show('success', enabled
        ? t('sidepanel.browserControlPage.messages.enabled')
        : t('sidepanel.browserControlPage.messages.disabled'));
      await load();
    } catch (error) {
      banner.show('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('idle');
    }
  };

  const selectTarget = async (target: BrowserControlTarget) => {
    if (!target.controllable) return;
    setBusy('targeting');
    banner.clear();
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'SET_BROWSER_CONTROL_TARGET',
        payload: { tabId: target.id },
      });
      if (result?.ok === false) {
        banner.show('error', String(result.error ?? t('sidepanel.browserControlPage.messages.targetFailed')));
      } else {
        banner.show('success', t('sidepanel.browserControlPage.messages.targetSelected', { id: target.id }));
      }
      await load();
    } finally {
      setBusy('idle');
    }
  };

  const detach = async () => {
    setBusy('detaching');
    banner.clear();
    try {
      await chrome.runtime.sendMessage({ type: 'DETACH_BROWSER_CONTROL' });
      banner.show('success', t('sidepanel.browserControlPage.messages.detached'));
      await load();
    } finally {
      setBusy('idle');
    }
  };

  const lockTarget = async () => {
    setBusy('locking');
    banner.clear();
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'LOCK_BROWSER_CONTROL_TARGET',
        payload: { label: 'Dev++' },
      });
      if (result?.ok === false) {
        banner.show('error', String(result.error ?? t('sidepanel.browserControlPage.messages.lockFailed')));
      } else {
        banner.show('success', t('sidepanel.browserControlPage.messages.locked'));
      }
      await load();
    } finally {
      setBusy('idle');
    }
  };

  const clearLock = async () => {
    setBusy('locking');
    banner.clear();
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_BROWSER_CONTROL_TARGET_LOCK' });
      banner.show('success', t('sidepanel.browserControlPage.messages.lockCleared'));
      await load();
    } finally {
      setBusy('idle');
    }
  };

  const supported = state?.supported === true;
  const activeTarget = targets.find((target) => target.id === settings.targetTabId) ?? null;
  const targetLock = settings.targetLock;

  return (
    <div className="ds-page">
      <PageIntro
        title={t('sidepanel.browserControlPage.title')}
        description={t('sidepanel.browserControlPage.description')}
      />

      <div className="ds-surface-panel rounded-xl p-4 space-y-3">
        <ToggleRow
          title={t('sidepanel.browserControlPage.enableTitle')}
          description={supported
            ? t('sidepanel.browserControlPage.enableDescription')
            : t('sidepanel.browserControlPage.unsupported')}
          enabled={settings.enabled && supported}
          disabled={!supported || busy !== 'idle'}
          onToggle={(next) => setEnabled(next)}
        />

        <div className="grid grid-cols-3 gap-2">
          <Meta label={t('sidepanel.browserControlPage.status.enabled')} value={settings.enabled ? t('common.enabled') : t('common.disabled')} />
          <Meta label={t('sidepanel.browserControlPage.status.attached')} value={state?.attached ? t('common.enabled') : t('common.disabled')} />
          <Meta label={t('sidepanel.browserControlPage.status.target')} value={activeTarget ? String(activeTarget.id) : t('common.none')} />
        </div>

        <div className="space-y-2 border px-3 py-2" style={{ borderColor: 'var(--ds-border)', borderRadius: 'var(--radius-ctrl)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
                {t('sidepanel.browserControlPage.targetLockTitle')}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-secondary)' }}>
                {targetLock?.enabled
                  ? t('sidepanel.browserControlPage.targetLockActive', { label: targetLock.label, origin: targetLock.origin })
                  : t('sidepanel.browserControlPage.targetLockDescription')}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={lockTarget}
                disabled={busy !== 'idle' || !settings.enabled || !activeTarget}
                className="ds-btn-secondary px-2.5 py-1.5 text-[11px] rounded-lg disabled:opacity-50"
              >
                {busy === 'locking' ? t('sidepanel.browserControlPage.locking') : t('sidepanel.browserControlPage.lockTarget')}
              </button>
              <button
                type="button"
                onClick={clearLock}
                disabled={busy !== 'idle' || !targetLock}
                className="ds-btn-secondary px-2.5 py-1.5 text-[11px] rounded-lg disabled:opacity-50"
              >
                {t('sidepanel.browserControlPage.clearLock')}
              </button>
            </div>
          </div>
        </div>

        <ToggleRow
          title={t('sidepanel.browserControlPage.allowVisionCapture')}
          description={t('sidepanel.browserControlPage.allowVisionCaptureDescription')}
          enabled={settings.allowVisionCapture}
          disabled={!settings.enabled || !supported || busy !== 'idle'}
          onToggle={(next) => savePatch({ allowVisionCapture: next })}
        />
        <ToggleRow
          title={t('sidepanel.browserControlPage.verifyAfterActions')}
          description={t('sidepanel.browserControlPage.verifyAfterActionsDescription')}
          enabled={settings.verifyAfterActions}
          disabled={!settings.enabled || !settings.allowVisionCapture || !supported || busy !== 'idle'}
          onToggle={(next) => savePatch({ verifyAfterActions: next })}
        />
        <ToggleRow
          title={t('sidepanel.browserControlPage.collectEvidencePacks')}
          description={t('sidepanel.browserControlPage.collectEvidencePacksDescription')}
          enabled={settings.collectEvidencePacks}
          disabled={!settings.enabled || busy !== 'idle'}
          onToggle={(next) => savePatch({ collectEvidencePacks: next })}
        />
        <ToggleRow
          title={t('sidepanel.browserControlPage.debugDistiller')}
          description={t('sidepanel.browserControlPage.debugDistillerDescription')}
          enabled={settings.debugDistillerEnabled}
          disabled={!settings.enabled || busy !== 'idle'}
          onToggle={(next) => savePatch({ debugDistillerEnabled: next })}
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={load}
            disabled={busy !== 'idle'}
            className="ds-btn-secondary px-3 py-1.5 text-[11px] rounded-lg disabled:opacity-50"
          >
            {busy === 'loading' ? t('common.loading') : t('common.refresh')}
          </button>
          <button
            type="button"
            onClick={detach}
            disabled={busy !== 'idle' || !state?.attached}
            className="ds-btn-secondary px-3 py-1.5 text-[11px] rounded-lg disabled:opacity-50"
          >
            {busy === 'detaching' ? t('sidepanel.browserControlPage.detaching') : t('sidepanel.browserControlPage.detach')}
          </button>
        </div>

        {banner.node}
      </div>

      <SettingsSection title={t('sidepanel.browserControlPage.targetsTitle')}>
        <div className="space-y-2">
          {targets.map((target) => (
            <TargetRow
              key={target.id}
              target={target}
              selected={target.id === settings.targetTabId}
              disabled={!settings.enabled || busy !== 'idle'}
              onSelect={() => selectTarget(target)}
            />
          ))}
          {targets.length === 0 && (
            <EmptyState title={t('sidepanel.browserControlPage.noTargets')} />
          )}
        </div>
      </SettingsSection>

      <SettingsSection title={t('sidepanel.browserControlPage.snapshotTitle')}>
        <ToggleRow
          title={t('sidepanel.browserControlPage.includeSnapshot')}
          description={t('sidepanel.browserControlPage.includeSnapshotDescription')}
          enabled={settings.includeSnapshotAfterActions}
          disabled={busy !== 'idle'}
          onToggle={(next) => savePatch({ includeSnapshotAfterActions: next })}
        />
        <Slider
          label={t('sidepanel.browserControlPage.maxNodes')}
          value={settings.maxSnapshotNodes}
          min={50}
          max={1500}
          step={50}
          disabled={busy !== 'idle'}
          onChange={(value) => savePatch({ maxSnapshotNodes: value })}
        />
        <Slider
          label={t('sidepanel.browserControlPage.maxBytes')}
          value={settings.maxSnapshotTextBytes}
          min={4000}
          max={80000}
          step={4000}
          disabled={busy !== 'idle'}
          onChange={(value) => savePatch({ maxSnapshotTextBytes: value })}
        />
      </SettingsSection>
    </div>
  );
}

function TargetRow({
  target,
  selected,
  disabled,
  onSelect,
}: {
  target: BrowserControlTarget;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || !target.controllable}
      className="ds-surface-panel w-full rounded-xl p-3 text-left disabled:opacity-60"
      style={{
        borderColor: selected ? 'var(--ds-blue)' : 'var(--ds-border)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium truncate" style={{ color: 'var(--ds-text)' }}>
            {target.title || t('sidepanel.browserControlPage.untitled')}
          </div>
          <div className="text-[10px] mt-1 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
            {target.url || t('sidepanel.browserControlPage.noUrl')}
          </div>
          {target.groupName && (
            <div className="text-[10px] mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.browserControlPage.group', { name: target.groupName })}
            </div>
          )}
          {!target.controllable && (
            <div className="text-[10px] mt-1" style={{ color: 'var(--ds-danger)' }}>
              {target.reason}
            </div>
          )}
        </div>
        <span className="text-[10px] shrink-0 px-2 py-1 rounded-md" style={{
          color: selected ? 'var(--ds-blue)' : 'var(--ds-text-tertiary)',
          background: selected ? 'var(--ds-blue-soft)' : 'var(--ds-surface)',
        }}>
          {selected ? t('sidepanel.browserControlPage.selected') : `#${target.id}`}
        </span>
      </div>
    </button>
  );
}
