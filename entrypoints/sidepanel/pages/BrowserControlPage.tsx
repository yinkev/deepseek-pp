import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import type {
  BrowserControlSettings,
  BrowserControlState,
  BrowserControlTarget,
} from '../../../core/browser-control';
import PageIntro from '../components/PageIntro';
import type { LocaleMessageKey } from '../../../core/i18n';
import {
  EmptyState,
  SettingsSection,
  Slider,
  StatusMessage,
  ToggleRow,
  useBanner,
} from '../components/settings/primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useI18n } from '../i18n';
import { getRuntimeErrorMessage, isRuntimeFailure } from '../runtime-response';

type BusyState = 'idle' | 'loading' | 'saving' | 'targeting' | 'locking' | 'detaching';

const LEGACY_TARGET_LOCK_LABEL = 'Dev++';

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
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<BusyState>('loading');
  const targetListRef = useRef<HTMLDivElement | null>(null);
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
      const [nextSettings, nextState] = await Promise.allSettled([
        chrome.runtime.sendMessage({ type: 'GET_BROWSER_CONTROL_SETTINGS' }),
        chrome.runtime.sendMessage({ type: 'GET_BROWSER_CONTROL_STATE' }),
      ]);
      const errors: string[] = [];
      const settingsResult = readBrowserControlLoadResult<BrowserControlSettings>(
        nextSettings,
        t('sidepanel.browserControlPage.sourceInvalid'),
        errors,
      );
      if (settingsResult.available) {
        setSettings(settingsResult.value ?? DEFAULT_SETTINGS);
      }
      const stateResult = readBrowserControlLoadResult<BrowserControlState>(
        nextState,
        t('sidepanel.browserControlPage.sourceInvalid'),
        errors,
      );
      if (stateResult.available) {
        setState(stateResult.value ?? null);
      } else {
        setState(null);
      }
      setLoadError(errors.length > 0
        ? t('sidepanel.browserControlPage.loadFailed', { error: errors.join('; ') })
        : '');
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
      });
      if (isRuntimeFailure(next)) throw new Error(getBrowserControlIssueMessage(
        next.error,
        t('sidepanel.browserControlPage.messages.actionUnavailable'),
      ));
      setSettings(next ?? settings);
      await load();
    } catch (error) {
      banner.show('error', t('sidepanel.browserControlPage.messages.actionFailed', {
        error: getBrowserControlIssueMessage(error, t('sidepanel.browserControlPage.messages.actionUnavailable')),
      }));
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
      });
      if (isRuntimeFailure(next)) throw new Error(getBrowserControlIssueMessage(
        next.error,
        t('sidepanel.browserControlPage.messages.actionUnavailable'),
      ));
      setSettings(next ?? { ...settings, enabled });
      banner.show('success', enabled
        ? t('sidepanel.browserControlPage.messages.enabled')
        : t('sidepanel.browserControlPage.messages.disabled'));
      await load();
    } catch (error) {
      banner.show('error', t('sidepanel.browserControlPage.messages.actionFailed', {
        error: getBrowserControlIssueMessage(error, t('sidepanel.browserControlPage.messages.actionUnavailable')),
      }));
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
        banner.show('error', t('sidepanel.browserControlPage.messages.actionFailed', {
          error: getBrowserControlIssueMessage(result.error, t('sidepanel.browserControlPage.messages.targetFailed')),
        }));
      } else {
        banner.show('success', t('sidepanel.browserControlPage.messages.targetSelected'));
      }
      await load();
    } catch (error) {
      banner.show('error', t('sidepanel.browserControlPage.messages.actionFailed', { error: getRuntimeErrorMessage(error) }));
    } finally {
      setBusy('idle');
    }
  };

  const detach = async () => {
    setBusy('detaching');
    banner.clear();
    try {
      const result = await chrome.runtime.sendMessage({ type: 'DETACH_BROWSER_CONTROL' });
      if (isRuntimeFailure(result)) throw new Error(getBrowserControlIssueMessage(
        result.error,
        t('sidepanel.browserControlPage.messages.actionUnavailable'),
      ));
      banner.show('success', t('sidepanel.browserControlPage.messages.detached'));
      await load();
    } catch (error) {
      banner.show('error', t('sidepanel.browserControlPage.messages.actionFailed', {
        error: getBrowserControlIssueMessage(error, t('sidepanel.browserControlPage.messages.actionUnavailable')),
      }));
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
        payload: {
          label: activeTarget?.title || activeTarget?.url || t('sidepanel.browserControlPage.targetLockFallbackLabel'),
        },
      });
      if (result?.ok === false) {
        banner.show('error', t('sidepanel.browserControlPage.messages.actionFailed', {
          error: getBrowserControlIssueMessage(result.error, t('sidepanel.browserControlPage.messages.lockFailed')),
        }));
      } else {
        banner.show('success', t('sidepanel.browserControlPage.messages.locked'));
      }
      await load();
    } catch (error) {
      banner.show('error', t('sidepanel.browserControlPage.messages.actionFailed', { error: getRuntimeErrorMessage(error) }));
    } finally {
      setBusy('idle');
    }
  };

  const clearLock = async () => {
    setBusy('locking');
    banner.clear();
    try {
      const result = await chrome.runtime.sendMessage({ type: 'CLEAR_BROWSER_CONTROL_TARGET_LOCK' });
      if (isRuntimeFailure(result)) throw new Error(getBrowserControlIssueMessage(
        result.error,
        t('sidepanel.browserControlPage.messages.actionUnavailable'),
      ));
      banner.show('success', t('sidepanel.browserControlPage.messages.lockCleared'));
      await load();
    } catch (error) {
      banner.show('error', t('sidepanel.browserControlPage.messages.actionFailed', {
        error: getBrowserControlIssueMessage(error, t('sidepanel.browserControlPage.messages.actionUnavailable')),
      }));
    } finally {
      setBusy('idle');
    }
  };

  const statusNeedsRefresh = Boolean(loadError);
  const supported = !statusNeedsRefresh && state?.supported === true;
  const activeTarget = targets.find((target) => target.id === settings.targetTabId) ?? null;
  const targetLock = settings.targetLock;
  const disabledLabel = statusNeedsRefresh
    ? t('sidepanel.browserControlPage.status.needsRefresh')
    : !supported
      ? t('common.unavailable')
      : undefined;
  const targetLabel = activeTarget?.title || activeTarget?.url || t('common.none');
  const targetLockLabel = targetLock?.label && targetLock.label !== LEGACY_TARGET_LOCK_LABEL
    ? targetLock.label
    : t('sidepanel.browserControlPage.targetLockFallbackLabel');
  const readiness = createBrowserReadiness(settings, state, activeTarget, targetLabel, Boolean(loadError), t);

  const chooseTarget = () => {
    const list = targetListRef.current;
    list?.scrollIntoView?.({ block: 'start' });
    list?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  };

  const applyReadinessAction = () => {
    if (readiness.action === 'enable') {
      void setEnabled(true);
      return;
    }
    if (readiness.action === 'chooseTarget') {
      chooseTarget();
      return;
    }
    if (readiness.action === 'retry') {
      void load();
      return;
    }
    if (readiness.action === 'enableVisualCapture') {
      void savePatch({ allowVisionCapture: true });
      return;
    }
    if (readiness.action === 'enableVerify') {
      void savePatch({ verifyAfterActions: true });
    }
  };

  return (
    <div className="ds-page">
      <PageIntro
        title={t('sidepanel.browserControlPage.title')}
        description={t('sidepanel.browserControlPage.description')}
      />

      <Card size="sm" className={`ds-browser-readiness ds-browser-readiness-${readiness.tone}`}>
        <CardHeader className="ds-browser-readiness-head">
          <CardTitle>{t('sidepanel.browserControlPage.readinessTitle')}</CardTitle>
          <CardDescription>{t(readiness.descriptionKey)}</CardDescription>
          <CardAction>
            <Badge variant={getBrowserReadinessBadgeVariant(readiness.tone)} className={`ds-browser-readiness-badge ds-browser-readiness-badge-${readiness.tone}`}>
              {t(readiness.statusKey)}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="ds-browser-readiness-body">
          {loadError && (
            <StatusMessage tone="error">
              {loadError}
            </StatusMessage>
          )}
          <div className="ds-browser-status-list">
            <BrowserStatusRow
              label={t('sidepanel.browserControlPage.readinessTarget')}
              value={readiness.target}
              tone={readiness.targetTone}
            />
            <BrowserStatusRow
              label={t('sidepanel.browserControlPage.readinessVisual')}
              value={readiness.visual}
              tone={readiness.visualTone}
            />
            <BrowserStatusRow
              label={t('sidepanel.browserControlPage.readinessNext')}
              value={t(readiness.nextKey)}
              tone={readiness.tone === 'blocked' ? 'blocked' : readiness.tone === 'attention' ? 'attention' : 'normal'}
            />
          </div>
        </CardContent>
        {readiness.action && (
          <CardFooter className="ds-browser-actions ds-browser-readiness-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={applyReadinessAction}
              disabled={busy !== 'idle' || (readiness.action === 'chooseTarget' && targets.every((target) => !target.controllable))}
              className="ds-btn-secondary ds-browser-action-button disabled:opacity-50"
            >
              {t(readiness.actionLabelKey)}
            </Button>
          </CardFooter>
        )}
      </Card>

      <SettingsSection
        title={t('sidepanel.browserControlPage.connectionTitle')}
        description={t('sidepanel.browserControlPage.connectionDescription')}
      >
        <ToggleRow
          title={t('sidepanel.browserControlPage.enableTitle')}
          description={statusNeedsRefresh
            ? t('sidepanel.browserControlPage.enableNeedsRefreshDescription')
            : supported
            ? t('sidepanel.browserControlPage.enableDescription')
            : t('sidepanel.browserControlPage.unsupported')}
          enabled={settings.enabled && supported}
          disabled={!supported || busy !== 'idle'}
          disabledLabel={disabledLabel}
          onToggle={(next) => setEnabled(next)}
        />

        <div className="ds-browser-status-list">
          <BrowserStatusRow
            label={t('sidepanel.browserControlPage.status.tools')}
            value={statusNeedsRefresh
              ? t('sidepanel.browserControlPage.status.needsRefresh')
              : settings.enabled && supported ? t('common.enabled') : t('common.disabled')}
          />
          <BrowserStatusRow
            label={t('sidepanel.browserControlPage.status.connection')}
            value={statusNeedsRefresh
              ? t('sidepanel.browserControlPage.status.unknown')
              : state?.attached ? t('sidepanel.browserControlPage.status.attached') : t('sidepanel.browserControlPage.status.notAttached')}
          />
          <BrowserStatusRow
            label={t('sidepanel.browserControlPage.status.target')}
            value={statusNeedsRefresh ? t('sidepanel.browserControlPage.status.unknown') : targetLabel}
          />
        </div>

        <div className="ds-browser-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={load}
            disabled={busy !== 'idle'}
            className="ds-btn-secondary ds-browser-action-button disabled:opacity-50"
          >
            {busy === 'loading' ? t('common.loading') : t('common.refresh')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={detach}
            disabled={busy !== 'idle' || statusNeedsRefresh || !state?.attached}
            className="ds-btn-secondary ds-browser-action-button disabled:opacity-50"
          >
            {busy === 'detaching' ? t('sidepanel.browserControlPage.detaching') : t('sidepanel.browserControlPage.detach')}
          </Button>
        </div>

        {banner.node}
      </SettingsSection>

      <SettingsSection title={t('sidepanel.browserControlPage.targetsTitle')}>
        <div className="ds-browser-target-lock">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="ds-browser-target-lock-title">
                {t('sidepanel.browserControlPage.targetLockTitle')}
              </div>
              <div className="ds-browser-target-lock-copy">
                {targetLock?.enabled
                  ? t('sidepanel.browserControlPage.targetLockActive', { label: targetLockLabel, origin: targetLock.origin })
                  : t('sidepanel.browserControlPage.targetLockDescription')}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={lockTarget}
                disabled={busy !== 'idle' || statusNeedsRefresh || !settings.enabled || !activeTarget}
                className="ds-btn-secondary ds-browser-small-button disabled:opacity-50"
              >
                {busy === 'locking' ? t('sidepanel.browserControlPage.locking') : t('sidepanel.browserControlPage.lockTarget')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearLock}
                disabled={busy !== 'idle' || statusNeedsRefresh || !targetLock}
                className="ds-btn-secondary ds-browser-small-button disabled:opacity-50"
              >
                {t('sidepanel.browserControlPage.clearLock')}
              </Button>
            </div>
          </div>
        </div>

        <div ref={targetListRef} className="ds-browser-target-list">
          {targets.map((target) => (
            <TargetRow
              key={target.id}
              target={target}
              selected={target.id === settings.targetTabId}
              disabled={statusNeedsRefresh || !settings.enabled || busy !== 'idle'}
              onSelect={() => selectTarget(target)}
            />
          ))}
          {targets.length === 0 && (
            <EmptyState title={statusNeedsRefresh
              ? t('sidepanel.browserControlPage.targetsNeedRefresh')
              : t('sidepanel.browserControlPage.noTargets')} />
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('sidepanel.browserControlPage.visualReviewTitle')}
        description={t('sidepanel.browserControlPage.visualReviewDescription')}
      >
        <ToggleRow
          title={t('sidepanel.browserControlPage.allowVisionCapture')}
          description={t('sidepanel.browserControlPage.allowVisionCaptureDescription')}
          enabled={settings.allowVisionCapture}
          disabled={!settings.enabled || !supported || busy !== 'idle'}
          disabledLabel={disabledLabel}
          onToggle={(next) => savePatch({ allowVisionCapture: next })}
        />
        <ToggleRow
          title={t('sidepanel.browserControlPage.verifyAfterActions')}
          description={t('sidepanel.browserControlPage.verifyAfterActionsDescription')}
          enabled={settings.verifyAfterActions}
          disabled={!settings.enabled || !settings.allowVisionCapture || !supported || busy !== 'idle'}
          disabledLabel={!settings.allowVisionCapture ? t('sidepanel.browserControlPage.requiresVisualCapture') : disabledLabel}
          onToggle={(next) => savePatch({ verifyAfterActions: next })}
        />
        <ToggleRow
          title={t('sidepanel.browserControlPage.collectEvidencePacks')}
          description={t('sidepanel.browserControlPage.collectEvidencePacksDescription')}
          enabled={settings.collectEvidencePacks}
          disabled={statusNeedsRefresh || !settings.enabled || busy !== 'idle'}
          onToggle={(next) => savePatch({ collectEvidencePacks: next })}
        />
        <ToggleRow
          title={t('sidepanel.browserControlPage.debugDistiller')}
          description={t('sidepanel.browserControlPage.debugDistillerDescription')}
          enabled={settings.debugDistillerEnabled}
          disabled={statusNeedsRefresh || !settings.enabled || busy !== 'idle'}
          onToggle={(next) => savePatch({ debugDistillerEnabled: next })}
        />
      </SettingsSection>

      <details className="ds-browser-advanced ds-surface-panel">
        <summary>
          <span>{t('sidepanel.browserControlPage.snapshotTitle')}</span>
          <span>{t('sidepanel.browserControlPage.snapshotSummary')}</span>
        </summary>
        <div className="ds-browser-advanced-body">
          <ToggleRow
            title={t('sidepanel.browserControlPage.includeSnapshot')}
            description={t('sidepanel.browserControlPage.includeSnapshotDescription')}
            enabled={settings.includeSnapshotAfterActions}
            disabled={statusNeedsRefresh || busy !== 'idle'}
            onToggle={(next) => savePatch({ includeSnapshotAfterActions: next })}
          />
          <Slider
            label={t('sidepanel.browserControlPage.maxNodes')}
            value={settings.maxSnapshotNodes}
            min={50}
            max={1500}
            step={50}
            disabled={statusNeedsRefresh || busy !== 'idle'}
            onChange={(value) => savePatch({ maxSnapshotNodes: value })}
          />
          <Slider
            label={t('sidepanel.browserControlPage.maxBytes')}
            value={settings.maxSnapshotTextBytes}
            min={4000}
            max={80000}
            step={4000}
            disabled={statusNeedsRefresh || busy !== 'idle'}
            onChange={(value) => savePatch({ maxSnapshotTextBytes: value })}
          />
        </div>
      </details>
    </div>
  );
}

type BrowserReadinessTone = 'ready' | 'attention' | 'blocked';
type BrowserReadinessFactTone = 'normal' | 'muted' | 'attention' | 'blocked';
type BrowserReadinessAction = 'enable' | 'chooseTarget' | 'enableVisualCapture' | 'enableVerify' | 'retry';

interface BrowserReadinessModel {
  statusKey: LocaleMessageKey;
  descriptionKey: LocaleMessageKey;
  nextKey: LocaleMessageKey;
  actionLabelKey: LocaleMessageKey;
  tone: BrowserReadinessTone;
  target: string;
  targetTone: BrowserReadinessFactTone;
  visual: string;
  visualTone: BrowserReadinessFactTone;
  action: BrowserReadinessAction | null;
}

function getBrowserReadinessBadgeVariant(tone: BrowserReadinessTone): ComponentProps<typeof Badge>['variant'] {
  if (tone === 'blocked') return 'destructive';
  if (tone === 'attention') return 'secondary';
  return 'outline';
}

function createBrowserReadiness(
  settings: BrowserControlSettings,
  state: BrowserControlState | null,
  activeTarget: BrowserControlTarget | null,
  targetLabel: string,
  hasLoadError: boolean,
  t: (key: LocaleMessageKey) => string,
): BrowserReadinessModel {
  const visual = createBrowserVisualValue(settings, state, t);

  if (hasLoadError) {
    return {
      statusKey: 'sidepanel.browserControlPage.readinessLoadFailed',
      descriptionKey: 'sidepanel.browserControlPage.readinessLoadFailedDescription',
      nextKey: 'sidepanel.browserControlPage.readinessNextRetry',
      actionLabelKey: 'sidepanel.browserControlPage.readinessActionRetry',
      tone: 'blocked',
      target: t('common.unavailable'),
      targetTone: 'blocked',
      visual: t('common.unavailable'),
      visualTone: 'blocked',
      action: 'retry',
    };
  }

  if (state?.supported !== true) {
    return {
      statusKey: 'sidepanel.browserControlPage.readinessUnavailable',
      descriptionKey: 'sidepanel.browserControlPage.readinessUnavailableDescription',
      nextKey: 'sidepanel.browserControlPage.readinessNextUnavailable',
      actionLabelKey: 'sidepanel.browserControlPage.readinessActionChooseTarget',
      tone: 'blocked',
      target: t('common.unavailable'),
      targetTone: 'blocked',
      visual: t('common.unavailable'),
      visualTone: 'blocked',
      action: null,
    };
  }

  if (!settings.enabled || state.enabled === false) {
    return {
      statusKey: 'sidepanel.browserControlPage.readinessOff',
      descriptionKey: 'sidepanel.browserControlPage.readinessOffDescription',
      nextKey: 'sidepanel.browserControlPage.readinessNextEnable',
      actionLabelKey: 'sidepanel.browserControlPage.readinessActionEnable',
      tone: 'attention',
      target: activeTarget ? targetLabel : t('common.none'),
      targetTone: activeTarget ? 'normal' : 'muted',
      visual: visual.value,
      visualTone: 'muted',
      action: 'enable',
    };
  }

  if (!activeTarget) {
    return {
      statusKey: 'sidepanel.browserControlPage.readinessNeedsTarget',
      descriptionKey: 'sidepanel.browserControlPage.readinessNeedsTargetDescription',
      nextKey: 'sidepanel.browserControlPage.readinessNextChooseTarget',
      actionLabelKey: 'sidepanel.browserControlPage.readinessActionChooseTarget',
      tone: 'attention',
      target: t('common.none'),
      targetTone: 'attention',
      visual: visual.value,
      visualTone: visual.tone,
      action: 'chooseTarget',
    };
  }

  if (!settings.allowVisionCapture) {
    return {
      statusKey: 'sidepanel.browserControlPage.readinessVisualOff',
      descriptionKey: 'sidepanel.browserControlPage.readinessVisualOffDescription',
      nextKey: 'sidepanel.browserControlPage.readinessNextEnableVisual',
      actionLabelKey: 'sidepanel.browserControlPage.readinessActionEnableVisual',
      tone: 'attention',
      target: targetLabel,
      targetTone: 'normal',
      visual: visual.value,
      visualTone: 'attention',
      action: 'enableVisualCapture',
    };
  }

  if (!settings.verifyAfterActions) {
    return {
      statusKey: 'sidepanel.browserControlPage.readinessVerifyOff',
      descriptionKey: 'sidepanel.browserControlPage.readinessVerifyOffDescription',
      nextKey: 'sidepanel.browserControlPage.readinessNextEnableVerify',
      actionLabelKey: 'sidepanel.browserControlPage.readinessActionEnableVerify',
      tone: 'attention',
      target: targetLabel,
      targetTone: 'normal',
      visual: visual.value,
      visualTone: 'attention',
      action: 'enableVerify',
    };
  }

  return {
    statusKey: 'sidepanel.browserControlPage.readinessReady',
    descriptionKey: 'sidepanel.browserControlPage.readinessReadyDescription',
    nextKey: 'sidepanel.browserControlPage.readinessNextContinue',
    actionLabelKey: 'sidepanel.browserControlPage.readinessActionChooseTarget',
    tone: 'ready',
    target: targetLabel,
    targetTone: 'normal',
    visual: visual.value,
    visualTone: visual.tone,
    action: null,
  };
}

function createBrowserVisualValue(
  settings: BrowserControlSettings,
  state: BrowserControlState | null,
  t: (key: LocaleMessageKey) => string,
): { value: string; tone: BrowserReadinessFactTone } {
  if (state?.supported !== true) return { value: t('common.unavailable'), tone: 'blocked' };
  if (!settings.enabled || !settings.allowVisionCapture) return { value: t('common.off'), tone: 'muted' };
  if (!settings.verifyAfterActions) return { value: t('sidepanel.browserControlPage.readinessVisualCaptureOnly'), tone: 'attention' };
  return { value: t('sidepanel.browserControlPage.readinessVisualReady'), tone: 'normal' };
}

function BrowserStatusRow({ label, value, tone = 'normal' }: {
  label: string;
  value: string;
  tone?: BrowserReadinessFactTone;
}) {
  return (
    <div className={`ds-browser-status-row ds-browser-status-row-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function readBrowserControlLoadResult<T>(
  result: PromiseSettledResult<unknown>,
  fallback: string,
  errors: string[],
): { available: boolean; value: T | null } {
  if (result.status === 'rejected') {
    errors.push(getBrowserControlIssueMessage(result.reason, fallback));
    return { available: false, value: null };
  }
  if (isRuntimeFailure(result.value)) {
    errors.push(getBrowserControlIssueMessage(result.value.error, fallback));
    return { available: false, value: null };
  }
  return { available: true, value: (result.value as T | null) ?? null };
}

function getBrowserControlIssueMessage(error: unknown, fallback: string): string {
  if (error === null || error === undefined) return fallback;
  const raw = getRuntimeErrorMessage(error).trim();
  if (!raw || raw === 'undefined' || raw === 'null') return fallback;
  if (/\b(GET|SET|SAVE|LOCK|CLEAR|DETACH|CAPTURE)_BROWSER[A-Z0-9_]*\b|schemaVersion|chrome\.runtime|chrome\.storage|IndexedDB|Bearer|Cookie|data:image/i.test(raw)) {
    return fallback;
  }
  return raw;
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
  const subtitle = target.controllable
    ? (target.url || t('sidepanel.browserControlPage.noUrl'))
    : t('sidepanel.browserControlPage.unavailableTargetDescription');
  const badge = selected
    ? t('sidepanel.browserControlPage.selected')
    : target.controllable
      ? t('sidepanel.browserControlPage.available')
      : t('sidepanel.browserControlPage.unavailableTarget');
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || !target.controllable}
      className="ds-browser-target-row disabled:opacity-60"
      style={{
        borderColor: selected ? 'var(--ds-selected-border)' : 'var(--ds-border)',
        background: selected ? 'var(--ds-blue-light)' : 'var(--ds-card)',
      }}
    >
      <div className="ds-browser-target-row-inner">
        <div className="ds-browser-target-copy">
          <div className="ds-browser-target-title">
            {target.title || t('sidepanel.browserControlPage.untitled')}
          </div>
          <div className="ds-browser-target-url">
            {subtitle}
          </div>
          {target.groupName && (
            <div className="ds-browser-target-url">
              {t('sidepanel.browserControlPage.group', { name: target.groupName })}
            </div>
          )}
          {!target.controllable && (
            <div className="ds-browser-target-error">
              {t('sidepanel.browserControlPage.unavailableTargetReason')}
            </div>
          )}
        </div>
        <span className="ds-browser-target-badge" data-selected={selected ? 'true' : 'false'}>
          {badge}
        </span>
      </div>
    </button>
  );
}
