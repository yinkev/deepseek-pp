import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import type {
  RuntimeDoctorReadinessBlocker,
  RuntimeDoctorReport,
  RuntimeDoctorStorageIssue,
} from '../../../core/chat/runtime-doctor';
import type { LocaleMessageKey } from '../../../core/i18n';
import PageIntro from '../components/PageIntro';
import { SettingsSection, StatusMessage } from '../components/settings/primitives';
import { useI18n } from '../i18n';
import { getRuntimeErrorMessage, isRuntimeFailure } from '../runtime-response';
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

type StatusTone = 'success' | 'error' | 'warning' | 'info';
type Translate = (key: LocaleMessageKey, params?: Record<string, string | number | boolean>) => string;

export default function RuntimeDoctorPage() {
  const { t } = useI18n();
  const [report, setReport] = useState<RuntimeDoctorReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [ensuring, setEnsuring] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [reloadingTabs, setReloadingTabs] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [message, setMessage] = useState<{ tone: StatusTone; text: string } | null>(null);

  const loadReport = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const next = await chrome.runtime.sendMessage({ type: 'GET_RUNTIME_DOCTOR_REPORT' });
      if (isRuntimeDoctorReport(next)) {
        setReport(next);
        return;
      }
      if (isRuntimeFailure(next)) {
        throw new Error(runtimeFailureMessage(next, t('sidepanel.runtimeDoctorPage.backendUnavailable')));
      }
      throw new Error(t('sidepanel.runtimeDoctorPage.backendUnavailable'));
    } catch (error) {
      setMessage({
        tone: 'error',
        text: t('sidepanel.runtimeDoctorPage.loadFailed', {
          error: formatError(error, t('sidepanel.runtimeDoctorPage.backendUnavailable')),
        }),
      });
    } finally {
      setLoading(false);
    }
  };

  const recoverAuth = async () => {
    setRecovering(true);
    setMessage(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'REFRESH_DEEPSEEK_WEB_AUTH' });
      if (isRuntimeDoctorReport(response?.report)) {
        setReport(response.report);
      }
      if (!response || response.ok !== true || !isRuntimeDoctorReport(response.report)) {
        throw new Error(runtimeFailureMessage(response, t('sidepanel.runtimeDoctorPage.recoverUnavailable')));
      }
      setMessage({
        tone: response.refreshed ? 'success' : 'warning',
        text: response.refreshed
          ? t('sidepanel.runtimeDoctorPage.recoverSuccess')
          : t('sidepanel.runtimeDoctorPage.recoverNoTab'),
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: t('sidepanel.runtimeDoctorPage.recoverFailed', {
          error: formatError(error, t('sidepanel.runtimeDoctorPage.recoverUnavailable')),
        }),
      });
    } finally {
      setRecovering(false);
    }
  };

  const ensureReady = async () => {
    setEnsuring(true);
    setMessage(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'RUN_PERSONAL_AUTOPILOT_REPAIR' });
      if (isRuntimeDoctorReport(response?.report)) {
        setReport(response.report);
      }
      if (!response || response.ok !== true || !isRuntimeDoctorReport(response.report)) {
        throw new Error(runtimeFailureMessage(response, t('sidepanel.runtimeDoctorPage.ensureReadyUnavailable')));
      }
      setMessage({
        tone: response.ready ? 'success' : 'warning',
        text: response.ready
          ? t('sidepanel.runtimeDoctorPage.ensureReadySuccess')
          : t('sidepanel.runtimeDoctorPage.ensureReadyNeedsAttention'),
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: t('sidepanel.runtimeDoctorPage.ensureReadyFailed', {
          error: formatError(error, t('sidepanel.runtimeDoctorPage.ensureReadyUnavailable')),
        }),
      });
    } finally {
      setEnsuring(false);
    }
  };

  const repairAndRetry = async () => {
    const failure = report?.automation.retryableFailure;
    if (!failure) {
      setMessage({ tone: 'warning', text: t('sidepanel.runtimeDoctorPage.repairRetryNoFailure') });
      return;
    }
    setRepairing(true);
    setMessage(null);
    try {
      const auth = await chrome.runtime.sendMessage({ type: 'REFRESH_DEEPSEEK_WEB_AUTH' });
      if (!auth || auth.ok !== true) {
        throw new Error(runtimeFailureMessage(auth, t('sidepanel.runtimeDoctorPage.recoverUnavailable')));
      }
      if (isRuntimeDoctorReport(auth.report)) setReport(auth.report);
      if (auth.refreshed !== true && auth.report?.hasWebAuth !== true) {
        setMessage({
          tone: 'warning',
          text: t('sidepanel.runtimeDoctorPage.recoverNoTab'),
        });
        return;
      }
      const run = await chrome.runtime.sendMessage({
        type: 'RUN_AUTOMATION_NOW',
        payload: { id: failure.automationId },
      });
      if (run?.ok === false || run?.error) {
        throw new Error(run.error === undefined
          ? t('sidepanel.runtimeDoctorPage.retryUnavailable')
          : formatError(run.error, t('sidepanel.runtimeDoctorPage.retryUnavailable')));
      }
      await loadReport();
      setMessage({
        tone: 'success',
        text: t('sidepanel.runtimeDoctorPage.repairRetrySuccess'),
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: t('sidepanel.runtimeDoctorPage.repairRetryFailed', {
          error: formatError(error, t('sidepanel.runtimeDoctorPage.retryUnavailable')),
        }),
      });
    } finally {
      setRepairing(false);
    }
  };

  const reloadStaleTabs = async () => {
    setReloadingTabs(true);
    setMessage(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'RELOAD_STALE_DEEPSEEK_TABS' });
      if (isRuntimeDoctorReport(response?.report)) setReport(response.report);
      if (!response || response.ok !== true) {
        throw new Error(runtimeFailureMessage(response, t('sidepanel.runtimeDoctorPage.reloadTabsUnavailable')));
      }
      setMessage({
        tone: 'success',
        text: t('sidepanel.runtimeDoctorPage.reloadStaleTabsSuccess', { count: response.reloaded ?? 0 }),
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: t('sidepanel.runtimeDoctorPage.reloadTabsFailed', {
          error: formatError(error, t('sidepanel.runtimeDoctorPage.reloadTabsUnavailable')),
        }),
      });
    } finally {
      setReloadingTabs(false);
    }
  };

  const runHumanEval = async () => {
    setEvaluating(true);
    setMessage(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'RUN_PERSONAL_HUMAN_EVAL' });
      if (isRuntimeDoctorReport(response?.report)) setReport(response.report);
      if (!response || response.ok !== true) {
        throw new Error(runtimeFailureMessage(response, t('sidepanel.runtimeDoctorPage.humanEvalUnavailable')));
      }
      setMessage({
        tone: response.leakSentry?.ok === false ? 'error' : 'success',
        text: `${t('sidepanel.runtimeDoctorPage.humanEvalGrade')}: ${response.humanEval?.grade ?? '?'}`,
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: t('sidepanel.runtimeDoctorPage.humanEvalFailed', {
          error: formatError(error, t('sidepanel.runtimeDoctorPage.humanEvalUnavailable')),
        }),
      });
    } finally {
      setEvaluating(false);
    }
  };

  const saveRecoveryMemory = async (
    suggestion: RuntimeDoctorReport['debugDistiller']['suggestions'][number],
  ) => {
    setMessage(null);
    try {
      await chrome.runtime.sendMessage({
        type: 'SAVE_MEMORY',
        payload: {
          type: 'feedback',
          name: suggestion.title,
          content: suggestion.preview,
          description: suggestion.reason,
          tags: ['automation', 'runtime-doctor', 'recovery'],
          pinned: false,
        },
      });
      setMessage({ tone: 'success', text: t('sidepanel.runtimeDoctorPage.recoveryMemorySaved') });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: t('sidepanel.runtimeDoctorPage.recoveryMemorySaveFailed', {
          error: formatError(error, t('sidepanel.runtimeDoctorPage.recoveryMemorySaveUnavailable')),
        }),
      });
    }
  };

  useEffect(() => {
    loadReport();
  }, []);

  const webAuthTone: StatusTone = report?.webAuthRejected
    ? 'error'
    : report?.hasWebAuth
      ? 'success'
      : 'warning';
  const webAuthLabel = report?.webAuthRejected
    ? t('sidepanel.runtimeDoctorPage.webAuthRejected')
    : report?.hasWebAuth
      ? t('sidepanel.runtimeDoctorPage.webAuthReady')
      : t('sidepanel.runtimeDoctorPage.webAuthMissing');
  const actionBusy = loading || ensuring || recovering || repairing || reloadingTabs || evaluating;
  const healthStatus = createHealthStatusModel({
    report,
    loading,
    hasLoadIssue: !report && !!message,
    t,
  });

  const runHealthStatusAction = () => {
    if (healthStatus.action === 'refresh') {
      void loadReport();
    } else if (healthStatus.action === 'ensure') {
      void ensureReady();
    } else if (healthStatus.action === 'recoverAuth') {
      void recoverAuth();
    } else if (healthStatus.action === 'repairRetry') {
      void repairAndRetry();
    } else if (healthStatus.action === 'reloadTabs') {
      void reloadStaleTabs();
    } else if (healthStatus.action === 'review') {
      void runHumanEval();
    }
  };

  return (
    <div className="ds-health-page space-y-4 p-4">
      <PageIntro
        title={t('sidepanel.runtimeDoctorPage.title')}
        description={t('sidepanel.runtimeDoctorPage.description')}
        meta={report ? new Date(report.generatedAt).toLocaleTimeString() : undefined}
      />

      <HealthStatusCard
        status={healthStatus}
        busy={actionBusy}
        onAction={runHealthStatusAction}
      />

      {!report && message && (
        <StatusMessage tone={message.tone} onDismiss={() => setMessage(null)}>
          {message.text}
        </StatusMessage>
      )}

      {report && (
        <>
          <ReadyCheckPanel
            report={report}
            busy={actionBusy}
            ensuring={ensuring}
            onEnsureReady={ensureReady}
          />

          <ReadinessBanner report={report} />

          <SettingsSection
            title={t('sidepanel.runtimeDoctorPage.actionsSection')}
            description={t('sidepanel.runtimeDoctorPage.actionsSectionDescription')}
          >
            <div className="ds-health-actions">
              <Button
                type="button"
                onClick={loadReport}
                disabled={actionBusy}
                variant="outline"
                size="sm"
                className="ds-btn-secondary"
              >
                {loading ? t('sidepanel.runtimeDoctorPage.loading') : t('sidepanel.runtimeDoctorPage.refreshReport')}
              </Button>
              <Button
                type="button"
                onClick={recoverAuth}
                disabled={actionBusy || report.chatBusy === true}
                variant="outline"
                size="sm"
                className="ds-btn-secondary"
              >
                {recovering ? t('sidepanel.runtimeDoctorPage.recoveringAuth') : t('sidepanel.runtimeDoctorPage.recoverAuth')}
              </Button>
              <Button
                type="button"
                onClick={repairAndRetry}
                disabled={actionBusy || report.chatBusy === true || !report.automation.retryableFailure}
                variant="outline"
                size="sm"
                className="ds-btn-secondary"
              >
                {repairing ? t('sidepanel.runtimeDoctorPage.repairingAndRetrying') : t('sidepanel.runtimeDoctorPage.repairAndRetry')}
              </Button>
              <Button
                type="button"
                onClick={reloadStaleTabs}
                disabled={actionBusy || !report.contentScripts.staleTabs}
                variant="outline"
                size="sm"
                className="ds-btn-secondary"
              >
                {reloadingTabs ? t('sidepanel.runtimeDoctorPage.reloadingStaleTabs') : t('sidepanel.runtimeDoctorPage.reloadStaleTabs')}
              </Button>
              <Button
                type="button"
                onClick={runHumanEval}
                disabled={actionBusy}
                variant="outline"
                size="sm"
                className="ds-btn-secondary"
              >
                {evaluating ? t('sidepanel.runtimeDoctorPage.evaluating') : t('sidepanel.runtimeDoctorPage.runHumanEval')}
              </Button>
            </div>
            {message && (
              <StatusMessage tone={message.tone} onDismiss={() => setMessage(null)}>
                {message.text}
              </StatusMessage>
            )}
          </SettingsSection>

          <SettingsSection
            title={t('sidepanel.runtimeDoctorPage.webSection')}
            description={t('sidepanel.runtimeDoctorPage.webSectionDescription')}
          >
            <StatusList>
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.webAuth')}
                value={webAuthLabel}
                tone={webAuthTone}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.provider')}
                value={formatProvider(report.provider, t)}
                tone={report.provider === 'deepseek-web' ? 'success' : report.provider ? 'warning' : 'error'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.deepSeekTabs')}
                value={String(report.deepSeekTabCount)}
                tone={report.deepSeekTabCount > 0 ? 'success' : 'warning'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.contentScripts')}
                value={t('sidepanel.runtimeDoctorPage.readyCount', {
                  ready: report.contentScripts.healthyTabs,
                  total: report.contentScripts.totalTabs,
                })}
                tone={report.contentScripts.staleTabs === 0 ? 'success' : 'warning'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.apiFallback')}
                value={report.hasApiKey ? t('common.enabled') : t('common.disabled')}
                tone={report.hasApiKey ? 'info' : 'warning'}
              />
            </StatusList>
          </SettingsSection>

          <SettingsSection
            title={t('sidepanel.runtimeDoctorPage.sessionSection')}
            description={t('sidepanel.runtimeDoctorPage.sessionSectionDescription')}
          >
            <StatusList>
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.sidepanelChat')}
                value={report.chatEnabled ? t('common.enabled') : t('common.disabled')}
                tone={report.chatEnabled ? 'success' : 'warning'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.chatBusy')}
                value={report.chatBusy ? t('sidepanel.runtimeDoctorPage.busy') : t('sidepanel.runtimeDoctorPage.idle')}
                tone={report.chatBusy ? 'warning' : 'success'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.sessionSource')}
                value={t(`sidepanel.runtimeDoctorPage.sessionSources.${report.sidepanelSession.source}` as LocaleMessageKey)}
                tone={report.sidepanelSession.active ? 'success' : 'info'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.parentMessageId')}
                value={report.sidepanelSession.parentMessageId === null ? t('common.none') : t('sidepanel.runtimeDoctorPage.anchorAvailable')}
                tone={report.sidepanelSession.parentMessageId === null ? 'info' : 'success'}
              />
            </StatusList>
          </SettingsSection>

          <SettingsSection
            title={t('sidepanel.runtimeDoctorPage.browserVisionLoops')}
            description={t('sidepanel.runtimeDoctorPage.browserVisionLoopsDescription')}
          >
            <StatusList>
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.readinessTarget')}
                value={formatTargetStatus(report.readiness.targetStatus, t)}
                tone={report.readiness.targetStatus === 'ready' ||
                  report.readiness.targetStatus === 'reacquired' ||
                  report.readiness.targetStatus === 'selected_active'
                  ? 'success'
                  : 'warning'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.monitorReady')}
                value={report.browserControl.monitorReady ? t('common.enabled') : t('common.disabled')}
                tone={report.browserControl.monitorReady ? 'success' : 'warning'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.targetLock')}
                value={report.browserControl.targetLock.enabled
                  ? report.browserControl.targetLock.label ?? t('sidepanel.runtimeDoctorPage.targetFallback')
                  : t('common.disabled')}
                tone={report.browserControl.targetLock.enabled ? 'success' : 'info'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.staleTabs')}
                value={String(report.contentScripts.staleTabs)}
                tone={report.contentScripts.staleTabs === 0 ? 'success' : 'warning'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.actVerify')}
                value={report.browserControl.actVerifyEnabled ? t('common.enabled') : t('common.disabled')}
                tone={report.browserControl.actVerifyEnabled ? 'success' : 'info'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.evidencePacks')}
                value={report.browserControl.evidencePacksEnabled ? t('common.enabled') : t('common.disabled')}
                tone={report.browserControl.evidencePacksEnabled ? 'success' : 'info'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.distiller')}
                value={report.debugDistiller.enabled ? t('common.enabled') : t('common.disabled')}
                tone={report.debugDistiller.enabled ? 'success' : 'info'}
              />
            </StatusList>
          </SettingsSection>

          <SettingsSection
            title={t('sidepanel.runtimeDoctorPage.humanEval')}
            description={t('sidepanel.runtimeDoctorPage.humanEvalDescription')}
          >
            <StatusList>
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.humanEvalGrade')}
                value={report.humanEval.grade}
                tone={report.humanEval.grade === 'A' ? 'success' : report.humanEval.grade === 'F' ? 'error' : 'warning'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.leakSentry')}
                value={report.leakSentry.ok
                  ? t('sidepanel.runtimeDoctorPage.leakSentryCleanShort')
                  : t('sidepanel.runtimeDoctorPage.leakSentryIssuesShort', { count: report.leakSentry.issueCount })}
                tone={report.leakSentry.ok ? 'success' : 'error'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.maxImages')}
                value={String(report.vision.maxImagesPerTurn)}
                tone="info"
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.rawImages')}
                value={report.vision.rawImagesStoredDurably
                  ? t('sidepanel.runtimeDoctorPage.rawImagesFound')
                  : t('sidepanel.runtimeDoctorPage.rawImagesClean')}
                tone={report.vision.rawImagesStoredDurably ? 'error' : 'success'}
              />
            </StatusList>
          </SettingsSection>

          <SettingsSection
            title={t('sidepanel.runtimeDoctorPage.automationSection')}
            description={t('sidepanel.runtimeDoctorPage.automationSectionDescription')}
          >
            <StatusList>
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.retryableFailure')}
                value={report.automation.retryableFailure
                  ? report.automation.retryableFailure.automationName
                  : t('sidepanel.runtimeDoctorPage.noRetryableFailure')}
                tone={report.automation.retryableFailure ? 'warning' : 'success'}
              />
              <StatusRow
                label={t('sidepanel.runtimeDoctorPage.maxAttempts')}
                value={String(report.automation.maxAttempts)}
                tone="info"
              />
            </StatusList>
            {report.debugDistiller.suggestions.length > 0 && (
              <div className="space-y-1.5">
                {report.debugDistiller.suggestions.map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className="px-3 py-2 text-[11px] border"
                    style={{ borderColor: 'var(--ds-border)', borderRadius: 'var(--radius-ctrl)', color: 'var(--ds-text-secondary)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium" style={{ color: 'var(--ds-text)' }}>{suggestion.title}</div>
                      {suggestion.kind === 'memory' && (
                        <Button
                          type="button"
                          onClick={() => void saveRecoveryMemory(suggestion)}
                          variant="outline"
                          size="xs"
                          className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md shrink-0"
                        >
                          {t('sidepanel.runtimeDoctorPage.saveRecoveryMemory')}
                        </Button>
                      )}
                    </div>
                    <div>{suggestion.preview}</div>
                  </div>
                ))}
              </div>
            )}
          </SettingsSection>

          <HealthDetailsSection report={report} />
        </>
      )}
    </div>
  );
}

type HealthStatusTone = 'ready' | 'attention' | 'blocked';
type HealthStatusFactTone = 'normal' | 'muted' | 'attention' | 'blocked';
type HealthStatusAction = 'refresh' | 'ensure' | 'recoverAuth' | 'repairRetry' | 'reloadTabs' | 'review';

interface HealthStatusModel {
  statusKey: LocaleMessageKey;
  descriptionKey: LocaleMessageKey;
  nextKey: LocaleMessageKey;
  actionLabelKey: LocaleMessageKey;
  tone: HealthStatusTone;
  readiness: string;
  readinessTone: HealthStatusFactTone;
  storage: string;
  storageTone: HealthStatusFactTone;
  action: HealthStatusAction | null;
  actionDisabled: boolean;
}

function HealthStatusCard({
  status,
  busy,
  onAction,
}: {
  status: HealthStatusModel;
  busy: boolean;
  onAction: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card size="sm" className={`ds-health-summary ds-health-summary-${status.tone}`}>
      <CardHeader className="ds-health-summary-head">
        <CardTitle>{t('sidepanel.runtimeDoctorPage.statusTitle')}</CardTitle>
        <CardDescription>{t(status.descriptionKey)}</CardDescription>
        <CardAction>
          <Badge
            variant={getHealthStatusBadgeVariant(status.tone)}
            className={`ds-health-summary-badge ds-health-summary-badge-${status.tone}`}
          >
            {t(status.statusKey)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="ds-health-summary-body">
        <div className="ds-health-summary-list">
          <HealthStatusSummaryRow
            label={t('sidepanel.runtimeDoctorPage.statusReadinessLabel')}
            value={status.readiness}
            tone={status.readinessTone}
          />
          <HealthStatusSummaryRow
            label={t('sidepanel.runtimeDoctorPage.statusStorageLabel')}
            value={status.storage}
            tone={status.storageTone}
          />
          <HealthStatusSummaryRow
            label={t('sidepanel.runtimeDoctorPage.statusNextLabel')}
            value={t(status.nextKey)}
            tone={status.tone === 'blocked' ? 'blocked' : status.tone === 'attention' ? 'attention' : 'normal'}
          />
        </div>
      </CardContent>
      {status.action && (
        <CardFooter className="ds-health-summary-actions">
          <Button
            type="button"
            size="sm"
            variant={status.tone === 'blocked' ? 'default' : 'outline'}
            className="ds-btn-secondary ds-health-summary-button disabled:opacity-50"
            onClick={onAction}
            disabled={busy || status.actionDisabled}
          >
            {t(status.actionLabelKey)}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function getHealthStatusBadgeVariant(tone: HealthStatusTone): ComponentProps<typeof Badge>['variant'] {
  if (tone === 'blocked') return 'destructive';
  if (tone === 'attention') return 'secondary';
  return 'outline';
}

function HealthStatusSummaryRow({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: string;
  tone?: HealthStatusFactTone;
}) {
  return (
    <div className={`ds-health-summary-row ds-health-summary-row-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function createHealthStatusModel({
  report,
  loading,
  hasLoadIssue,
  t,
}: {
  report: RuntimeDoctorReport | null;
  loading: boolean;
  hasLoadIssue: boolean;
  t: Translate;
}): HealthStatusModel {
  if (!report) {
    if (loading && !hasLoadIssue) {
      return {
        statusKey: 'sidepanel.runtimeDoctorPage.statusChecking',
        descriptionKey: 'sidepanel.runtimeDoctorPage.statusCheckingDescription',
        nextKey: 'sidepanel.runtimeDoctorPage.statusNextChecking',
        actionLabelKey: 'sidepanel.runtimeDoctorPage.statusActionRefresh',
        tone: 'attention',
        readiness: t('sidepanel.runtimeDoctorPage.statusValueChecking'),
        readinessTone: 'muted',
        storage: t('sidepanel.runtimeDoctorPage.statusValueChecking'),
        storageTone: 'muted',
        action: null,
        actionDisabled: false,
      };
    }
    return {
      statusKey: 'sidepanel.runtimeDoctorPage.statusLoadFailed',
      descriptionKey: 'sidepanel.runtimeDoctorPage.statusLoadFailedDescription',
      nextKey: 'sidepanel.runtimeDoctorPage.statusNextRefresh',
      actionLabelKey: 'sidepanel.runtimeDoctorPage.statusActionRefresh',
      tone: 'blocked',
      readiness: t('common.unavailable'),
      readinessTone: 'blocked',
      storage: t('common.unavailable'),
      storageTone: 'blocked',
      action: 'refresh',
      actionDisabled: false,
    };
  }

  const storageIssues = countHealthStorageIssues(report);
  const storageClean = storageIssues === 0;
  const action = getHealthStatusAction(report, storageClean);
  const blocked = report.readiness.status === 'blocked' || !storageClean;
  const attention = !blocked && (report.readiness.status !== 'ready' || action !== null);
  const tone: HealthStatusTone = blocked ? 'blocked' : attention ? 'attention' : 'ready';

  return {
    statusKey: tone === 'ready'
      ? 'sidepanel.runtimeDoctorPage.statusReady'
      : tone === 'blocked'
        ? 'sidepanel.runtimeDoctorPage.statusBlocked'
        : 'sidepanel.runtimeDoctorPage.statusNeedsAttention',
    descriptionKey: tone === 'ready'
      ? 'sidepanel.runtimeDoctorPage.statusReadyDescription'
      : tone === 'blocked'
        ? 'sidepanel.runtimeDoctorPage.statusBlockedDescription'
        : 'sidepanel.runtimeDoctorPage.statusNeedsAttentionDescription',
    nextKey: getHealthStatusNextKey(action, tone),
    actionLabelKey: getHealthStatusActionLabelKey(action),
    tone,
    readiness: t(`sidepanel.runtimeDoctorPage.readiness.status.${report.readiness.status}` as LocaleMessageKey),
    readinessTone: report.readiness.status === 'ready'
      ? 'normal'
      : report.readiness.status === 'blocked'
        ? 'blocked'
        : 'attention',
    storage: storageClean
      ? t('sidepanel.runtimeDoctorPage.statusStorageClean')
      : t('sidepanel.runtimeDoctorPage.statusStorageIssues', { count: storageIssues }),
    storageTone: storageClean ? 'normal' : 'blocked',
    action,
    actionDisabled: action === 'recoverAuth' && report.chatBusy === true,
  };
}

function countHealthStorageIssues(report: RuntimeDoctorReport): number {
  return report.storage.issues.length +
    (report.leakSentry.ok ? 0 : Math.max(1, report.leakSentry.issueCount)) +
    (report.vision.rawImagesStoredDurably ? 1 : 0);
}

function getHealthStatusAction(
  report: RuntimeDoctorReport,
  storageClean: boolean,
): HealthStatusAction | null {
  if (!storageClean) return 'review';
  if (report.automation.retryableFailure) return 'repairRetry';
  if (!report.hasWebAuth || report.webAuthRejected) return 'recoverAuth';
  if (report.contentScripts.staleTabs > 0) return 'reloadTabs';
  if (report.readiness.status !== 'ready') return 'ensure';
  return null;
}

function getHealthStatusNextKey(
  action: HealthStatusAction | null,
  tone: HealthStatusTone,
): LocaleMessageKey {
  if (action === 'refresh') return 'sidepanel.runtimeDoctorPage.statusNextRefresh';
  if (action === 'ensure') return 'sidepanel.runtimeDoctorPage.statusNextEnsure';
  if (action === 'recoverAuth') return 'sidepanel.runtimeDoctorPage.statusNextRecoverAuth';
  if (action === 'repairRetry') return 'sidepanel.runtimeDoctorPage.statusNextRepairRetry';
  if (action === 'reloadTabs') return 'sidepanel.runtimeDoctorPage.statusNextReloadTabs';
  if (action === 'review') return 'sidepanel.runtimeDoctorPage.statusNextReviewStorage';
  return tone === 'ready'
    ? 'sidepanel.runtimeDoctorPage.statusNextContinue'
    : 'sidepanel.runtimeDoctorPage.statusNextEnsure';
}

function getHealthStatusActionLabelKey(action: HealthStatusAction | null): LocaleMessageKey {
  if (action === 'ensure') return 'sidepanel.runtimeDoctorPage.statusActionEnsure';
  if (action === 'recoverAuth') return 'sidepanel.runtimeDoctorPage.statusActionRecoverAuth';
  if (action === 'repairRetry') return 'sidepanel.runtimeDoctorPage.statusActionRepairRetry';
  if (action === 'reloadTabs') return 'sidepanel.runtimeDoctorPage.statusActionReloadTabs';
  if (action === 'review') return 'sidepanel.runtimeDoctorPage.statusActionReviewStorage';
  return 'sidepanel.runtimeDoctorPage.statusActionRefresh';
}

function HealthDetailsSection({ report }: { report: RuntimeDoctorReport }) {
  const { t } = useI18n();
  return (
    <details className="ds-health-details">
      <summary>
        <span>{t('sidepanel.runtimeDoctorPage.advancedSection')}</span>
        <span className="ds-health-details-hint">{t('sidepanel.runtimeDoctorPage.advancedHint')}</span>
      </summary>
      <div className="ds-health-details-body">
        <AutopilotLedgerSection report={report} />
        {report.failureExplanations.length > 0 && (
          <SettingsSection
            title={t('sidepanel.runtimeDoctorPage.failureExplainer')}
            description={t('sidepanel.runtimeDoctorPage.failureExplainerDescription')}
          >
            <div className="ds-health-note-list">
              {report.failureExplanations.map((item) => (
                <div
                  key={item.blocker}
                  className="ds-health-note"
                  data-tone={item.severity === 'blocked' ? 'error' : 'warning'}
                >
                  <div className="ds-health-note-title">
                    {formatReadinessBlocker(item.blocker, t)}
                  </div>
                  <div>{item.cause}</div>
                  <div>{item.action}</div>
                </div>
              ))}
            </div>
          </SettingsSection>
        )}
        <SettingsSection
          title={t('sidepanel.runtimeDoctorPage.humanEvalDetails')}
          description={t('sidepanel.runtimeDoctorPage.humanEvalDetailsDescription')}
        >
          <div className="ds-health-note-list">
            {report.humanEval.checks.map((check) => (
              <div key={check.id} className="ds-health-note" data-tone={check.status === 'fail' ? 'error' : check.status === 'warn' ? 'warning' : 'success'}>
                <div className="ds-health-note-head">
                  <span className="ds-health-note-title">{formatEvalCheckLabel(check, t)}</span>
                  <span className="ds-health-note-state">{formatEvalStatus(check.status, t)}</span>
                </div>
                <div>{formatEvalEvidence(check, t)}</div>
              </div>
            ))}
          </div>
        </SettingsSection>
        <SettingsSection
          title={t('sidepanel.runtimeDoctorPage.storageSection')}
          description={t('sidepanel.runtimeDoctorPage.storageSectionDescription')}
        >
          {report.storage.ok ? (
            <StatusMessage tone="success">
              {t('sidepanel.runtimeDoctorPage.leakSentryClean')}
            </StatusMessage>
          ) : (
            <div className="space-y-2">
              <StatusMessage tone="error">
                {t('sidepanel.runtimeDoctorPage.leakSentryIssues', { count: report.storage.issues.length })}
              </StatusMessage>
              <LeakQuarantinePreview report={report} />
              <div className="ds-health-note-list">
                {report.storage.issues.map((issue) => (
                  <StorageIssueRow key={`${issue.area}:${issue.path}:${issue.reason}`} issue={issue} />
                ))}
              </div>
            </div>
          )}
        </SettingsSection>
      </div>
    </details>
  );
}

function AutopilotLedgerSection({ report }: { report: RuntimeDoctorReport }) {
  const { t } = useI18n();
  const latest = report.autopilot.latestRun;
  return (
    <SettingsSection
      title={t('sidepanel.runtimeDoctorPage.autopilotSection')}
      description={t('sidepanel.runtimeDoctorPage.autopilotSectionDescription')}
    >
      <StatusList>
        <StatusRow
          label={t('sidepanel.runtimeDoctorPage.autopilotInFlight')}
          value={report.autopilot.inFlightSource
            ? formatAutopilotSource(report.autopilot.inFlightSource, t)
            : t('common.none')}
          tone={report.autopilot.inFlightSource ? 'warning' : 'success'}
        />
        <StatusRow
          label={t('sidepanel.runtimeDoctorPage.autopilotLatest')}
          value={latest
            ? `${formatAutopilotSource(latest.source, t)} · ${latest.grade}`
            : t('sidepanel.runtimeDoctorPage.autopilotNoRuns')}
          tone={!latest ? 'info' : latest.ready ? 'success' : latest.status === 'blocked' ? 'error' : 'warning'}
        />
        <StatusRow
          label={t('sidepanel.runtimeDoctorPage.autopilotBlockers')}
          value={latest ? String(latest.blockers.length) : t('common.none')}
          tone={!latest || latest.blockers.length === 0 ? 'success' : 'warning'}
        />
        <StatusRow
          label={t('sidepanel.runtimeDoctorPage.autopilotLeaks')}
          value={latest ? String(latest.leakIssueCount) : '0'}
          tone={!latest || latest.leakIssueCount === 0 ? 'success' : 'error'}
        />
      </StatusList>
      {latest && (
        <div className="ds-health-note-list">
          {report.autopilot.recentRuns.slice(0, 3).map((run) => (
            <div
              key={run.id}
              className="ds-health-note"
              data-tone={run.ready ? 'success' : run.status === 'blocked' ? 'error' : 'warning'}
            >
              <div className="ds-health-note-head">
                <span className="ds-health-note-title">
                  {formatAutopilotSource(run.source, t)} · {new Date(run.finishedAt).toLocaleTimeString()}
                </span>
                <span className="ds-health-note-state">{run.grade}</span>
              </div>
              <div>
                {run.ready
                  ? t('sidepanel.runtimeDoctorPage.autopilotRunReady')
                  : t('sidepanel.runtimeDoctorPage.autopilotRunBlocked', { count: run.blockers.length })}
              </div>
              {run.repaired.length > 0 && (
                <div>
                  {t('sidepanel.runtimeDoctorPage.autopilotRepaired')}: {run.repaired.join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function ReadyCheckPanel({
  report,
  busy,
  ensuring,
  onEnsureReady,
}: {
  report: RuntimeDoctorReport;
  busy: boolean;
  ensuring: boolean;
  onEnsureReady: () => void;
}) {
  const { t } = useI18n();
  const checks = getReadyChecks(report, t);
  return (
    <div className="ds-health-ready-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="ds-health-ready-title">
            {t('sidepanel.runtimeDoctorPage.readyCheckTitle')}
          </div>
          <div className="ds-health-ready-description">
            {t('sidepanel.runtimeDoctorPage.readyCheckDescription')}
          </div>
        </div>
        <Button
          type="button"
          onClick={onEnsureReady}
          disabled={busy}
          size="sm"
          className="ds-btn-primary px-3 py-2 text-[11px] rounded-lg disabled:opacity-50 shrink-0"
        >
          {ensuring ? t('sidepanel.runtimeDoctorPage.ensuringReady') : t('sidepanel.runtimeDoctorPage.ensureReady')}
        </Button>
      </div>
      <div className="ds-health-check-grid">
        {checks.map((check) => (
          <div
            key={check.key}
            className="ds-health-check"
            data-ok={check.ok ? 'true' : 'false'}
          >
            <span
              className="ds-health-check-dot"
              aria-hidden="true"
            />
            <span className="ds-health-check-label">
              {check.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeakQuarantinePreview({ report }: { report: RuntimeDoctorReport }) {
  const { t } = useI18n();
  if (report.leakQuarantine.groups.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
        {t('sidepanel.runtimeDoctorPage.leakQuarantineSummary', {
          count: report.leakQuarantine.cleanupEligibleCount,
        })}
      </div>
      {report.leakQuarantine.groups.map((group) => (
        <div
          key={`${group.area}:${group.reason}`}
          className="ds-health-note"
          data-tone={group.cleanupEligible ? 'warning' : 'info'}
        >
          <div className="ds-health-note-head">
            <span className="ds-health-note-title">
              {group.area} · {t(`sidepanel.runtimeDoctorPage.issueReasons.${group.reason}` as LocaleMessageKey)}
            </span>
            <span className="ds-health-note-state">{group.count}</span>
          </div>
          <div>
            {group.cleanupEligible
              ? t('sidepanel.runtimeDoctorPage.leakQuarantineEligible')
              : t('sidepanel.runtimeDoctorPage.leakQuarantineManual')}
          </div>
          <div className="font-mono truncate">{group.samplePaths.join(', ')}</div>
        </div>
      ))}
    </div>
  );
}

function getReadyChecks(
  report: RuntimeDoctorReport,
  t: Translate,
): Array<{ key: string; label: string; ok: boolean }> {
  return [
    {
      key: 'web-auth',
      label: t('sidepanel.runtimeDoctorPage.readyChecks.webAuth'),
      ok: report.hasWebAuth && !report.webAuthRejected,
    },
    {
      key: 'session',
      label: t('sidepanel.runtimeDoctorPage.readyChecks.session'),
      ok: report.sidepanelSession.active || report.personalConvenience?.lastSessionRemembered === true,
    },
    {
      key: 'content-scripts',
      label: t('sidepanel.runtimeDoctorPage.readyChecks.contentScripts'),
      ok: report.contentScripts.staleTabs === 0,
    },
    {
      key: 'browser',
      label: t('sidepanel.runtimeDoctorPage.readyChecks.browserTarget'),
      ok: report.browserControl.monitorReady,
    },
    {
      key: 'vision',
      label: t('sidepanel.runtimeDoctorPage.readyChecks.vision'),
      ok: report.browserControl.visualCaptureAllowed && !report.vision.rawImagesStoredDurably,
    },
    {
      key: 'automation',
      label: t('sidepanel.runtimeDoctorPage.readyChecks.automation'),
      ok: report.automation.maxAttempts > 0,
    },
    {
      key: 'storage',
      label: t('sidepanel.runtimeDoctorPage.readyChecks.storage'),
      ok: report.storage.ok,
    },
  ];
}

function ReadinessBanner({ report }: { report: RuntimeDoctorReport }) {
  const { t } = useI18n();
  const tone = report.readiness.status === 'ready'
    ? 'success'
    : report.readiness.status === 'blocked'
      ? 'error'
      : 'warning';
  return (
    <StatusMessage tone={tone}>
      <div className="space-y-1">
        <div className="font-medium">
          {t(`sidepanel.runtimeDoctorPage.readiness.status.${report.readiness.status}` as LocaleMessageKey)}
        </div>
        <div>
          {report.readiness.noLeak
            ? t('sidepanel.runtimeDoctorPage.noLeakClean')
            : t('sidepanel.runtimeDoctorPage.noLeakIssue')}
        </div>
        {report.readiness.blockers.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {report.readiness.blockers.map((blocker) => (
              <span
                key={blocker}
                className="px-1.5 py-0.5 border"
                style={{ borderColor: 'var(--ds-border)', borderRadius: 'var(--radius-ctrl)' }}
              >
                {formatReadinessBlocker(blocker, t)}
              </span>
            ))}
          </div>
        )}
      </div>
    </StatusMessage>
  );
}

function StatusList({ children }: { children: ReactNode }) {
  return (
    <div className="ds-health-status-list">
      {children}
    </div>
  );
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: StatusTone;
}) {
  return (
    <div className="ds-health-status-row" data-tone={tone}>
      <div className="ds-health-status-label">
        {label}
      </div>
      <div className="ds-health-status-value">
        {value}
      </div>
    </div>
  );
}

function StorageIssueRow({ issue }: { issue: RuntimeDoctorStorageIssue }) {
  const { t } = useI18n();
  return (
    <div className="ds-health-note" data-tone="error">
      <div className="ds-health-note-title">
        {t(`sidepanel.runtimeDoctorPage.issueReasons.${issue.reason}` as LocaleMessageKey)}
      </div>
      <div className="font-mono truncate">
        {issue.area}:{issue.path}
      </div>
    </div>
  );
}

function isRuntimeDoctorReport(value: unknown): value is RuntimeDoctorReport {
  return !!value && typeof value === 'object' && (value as RuntimeDoctorReport).ok === true && !!(value as RuntimeDoctorReport).storage;
}

function formatProvider(
  provider: RuntimeDoctorReport['provider'],
  t: Translate,
): string {
  if (provider === 'deepseek-web') return t('sidepanel.runtimeDoctorPage.providers.deepseekWeb');
  if (provider === 'official-api') return t('sidepanel.runtimeDoctorPage.providers.officialApi');
  return t('sidepanel.runtimeDoctorPage.providers.unavailable');
}

function formatTargetStatus(
  status: RuntimeDoctorReport['readiness']['targetStatus'],
  t: Translate,
): string {
  const key = status ?? 'missing';
  return t(`sidepanel.runtimeDoctorPage.targetStatuses.${key}` as LocaleMessageKey);
}

function formatReadinessBlocker(
  blocker: RuntimeDoctorReadinessBlocker,
  t: Translate,
): string {
  return t(`sidepanel.runtimeDoctorPage.readiness.blockers.${blocker}` as LocaleMessageKey);
}

function formatAutopilotSource(
  source: RuntimeDoctorReport['autopilot']['inFlightSource'] | NonNullable<RuntimeDoctorReport['autopilot']['latestRun']>['source'],
  t: Translate,
): string {
  const key = source ?? 'manual';
  return t(`sidepanel.runtimeDoctorPage.autopilotSources.${key}` as LocaleMessageKey);
}

function formatEvalStatus(
  status: RuntimeDoctorReport['humanEval']['checks'][number]['status'],
  t: Translate,
): string {
  return t(`sidepanel.runtimeDoctorPage.evalStatuses.${status}` as LocaleMessageKey);
}

function formatEvalCheckLabel(
  check: RuntimeDoctorReport['humanEval']['checks'][number],
  t: Translate,
): string {
  return t(`sidepanel.runtimeDoctorPage.evalChecks.${check.id}.label` as LocaleMessageKey);
}

function formatEvalEvidence(
  check: RuntimeDoctorReport['humanEval']['checks'][number],
  t: Translate,
): string {
  const count = extractLeadingCount(check.evidence);
  if (count !== null && check.status === 'fail' && (check.id === 'ready_loop' || check.id === 'leak_sentry')) {
    return t(`sidepanel.runtimeDoctorPage.evalChecks.${check.id}.failWithCount` as LocaleMessageKey, { count });
  }
  return t(`sidepanel.runtimeDoctorPage.evalChecks.${check.id}.${check.status}` as LocaleMessageKey);
}

function extractLeadingCount(value: string): number | null {
  const match = value.match(/^(\d+)\b/);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) ? count : null;
}

const HEALTH_ERROR_LEAK_PATTERN = /\b(?:GET|RUN|REFRESH|RELOAD|SAVE|SET|CREATE|UPDATE|DELETE)_[A-Z0-9_]+\b|\b(?:Authorization|Bearer|Cookie|secret|token|api[_-]?key)\b|data:image|blob:|base64|schemaVersion|chrome\.runtime|chrome\.storage|IndexedDB|localStorage|sessionStorage|\[object Object\]|https?:\/\/|chrome-extension:\/\//i;

function formatError(error: unknown, fallback: string): string {
  const message = getRuntimeErrorMessage(error).trim();
  if (!message) return fallback;
  if (HEALTH_ERROR_LEAK_PATTERN.test(message)) return fallback;
  return message;
}

function runtimeFailureMessage(response: unknown, fallback: string): string {
  if (isRuntimeFailure(response) && response.error !== undefined) {
    return formatError(response.error, fallback);
  }
  return fallback;
}
