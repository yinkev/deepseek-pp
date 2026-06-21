import { useEffect, useState, type ReactNode } from 'react';
import type {
  RuntimeDoctorReadinessBlocker,
  RuntimeDoctorReport,
  RuntimeDoctorStorageIssue,
} from '../../../core/chat/runtime-doctor';
import type { LocaleMessageKey } from '../../../core/i18n';
import PageIntro from '../components/PageIntro';
import { SettingsSection, StatusMessage } from '../components/settings/primitives';
import { useI18n } from '../i18n';

type StatusTone = 'success' | 'error' | 'warning' | 'info';

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
      if (!isRuntimeDoctorReport(next)) throw new Error('invalid_report');
      setReport(next);
    } catch (error) {
      setMessage({
        tone: 'error',
        text: t('sidepanel.runtimeDoctorPage.loadFailed', { error: formatError(error) }),
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
        throw new Error(response?.error || 'refresh_failed');
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
        text: t('sidepanel.runtimeDoctorPage.recoverFailed', { error: formatError(error) }),
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
        throw new Error(response?.error || 'ensure_ready_failed');
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
        text: t('sidepanel.runtimeDoctorPage.ensureReadyFailed', { error: formatError(error) }),
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
        throw new Error(auth?.error || 'refresh_failed');
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
        throw new Error(typeof run.error === 'string' ? run.error : run.error?.message || 'retry_failed');
      }
      await loadReport();
      setMessage({
        tone: 'success',
        text: t('sidepanel.runtimeDoctorPage.repairRetrySuccess'),
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: t('sidepanel.runtimeDoctorPage.recoverFailed', { error: formatError(error) }),
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
      if (!response || response.ok !== true) throw new Error(response?.error || 'reload_stale_tabs_failed');
      setMessage({
        tone: 'success',
        text: t('sidepanel.runtimeDoctorPage.reloadStaleTabsSuccess', { count: response.reloaded ?? 0 }),
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: t('sidepanel.runtimeDoctorPage.ensureReadyFailed', { error: formatError(error) }),
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
      if (!response || response.ok !== true) throw new Error(response?.error || 'human_eval_failed');
      setMessage({
        tone: response.leakSentry?.ok === false ? 'error' : 'success',
        text: `${t('sidepanel.runtimeDoctorPage.humanEvalGrade')}: ${response.humanEval?.grade ?? '?'}`,
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: t('sidepanel.runtimeDoctorPage.ensureReadyFailed', { error: formatError(error) }),
      });
    } finally {
      setEvaluating(false);
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

  return (
    <div className="space-y-4 p-4">
      <PageIntro
        title={t('sidepanel.runtimeDoctorPage.title')}
        description={t('sidepanel.runtimeDoctorPage.description')}
        meta={report ? new Date(report.generatedAt).toLocaleTimeString() : undefined}
      />

      {report && (
        <ReadyCheckPanel
          report={report}
          busy={loading || ensuring || recovering || repairing}
          ensuring={ensuring}
          onEnsureReady={ensureReady}
        />
      )}

      {report && <ReadinessBanner report={report} />}

      {report && report.failureExplanations.length > 0 && (
        <SettingsSection
          title={t('sidepanel.runtimeDoctorPage.failureExplainer')}
          description={t('sidepanel.runtimeDoctorPage.failureExplainerDescription')}
        >
          <div className="space-y-1.5">
            {report.failureExplanations.map((item) => (
              <div
                key={item.blocker}
                className="px-3 py-2 text-[11px] border"
                style={{ borderColor: 'var(--ds-border)', borderRadius: 'var(--radius-ctrl)', color: 'var(--ds-text-secondary)' }}
              >
                <div className="font-medium" style={{ color: item.severity === 'blocked' ? 'var(--ds-danger)' : 'var(--ds-text)' }}>
                  {formatReadinessBlocker(item.blocker, t)}
                </div>
                <div>{item.cause}</div>
                <div>{item.action}</div>
              </div>
            ))}
          </div>
        </SettingsSection>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={loadReport}
          disabled={loading || ensuring || recovering || repairing}
          className="ds-btn-secondary px-3 py-2 text-[11px] rounded-lg disabled:opacity-50"
        >
          {loading ? t('sidepanel.runtimeDoctorPage.loading') : t('sidepanel.runtimeDoctorPage.refreshReport')}
        </button>
        <button
          type="button"
          onClick={recoverAuth}
          disabled={loading || ensuring || recovering || repairing || report?.chatBusy === true}
          className="ds-btn-secondary px-3 py-2 text-[11px] rounded-lg disabled:opacity-50"
        >
          {recovering ? t('sidepanel.runtimeDoctorPage.recoveringAuth') : t('sidepanel.runtimeDoctorPage.recoverAuth')}
        </button>
        <button
          type="button"
          onClick={repairAndRetry}
          disabled={loading || ensuring || recovering || repairing || report?.chatBusy === true || !report?.automation.retryableFailure}
          className="ds-btn-secondary px-3 py-2 text-[11px] rounded-lg disabled:opacity-50"
        >
          {repairing ? t('sidepanel.runtimeDoctorPage.repairingAndRetrying') : t('sidepanel.runtimeDoctorPage.repairAndRetry')}
        </button>
        <button
          type="button"
          onClick={reloadStaleTabs}
          disabled={loading || ensuring || recovering || repairing || reloadingTabs || !report?.contentScripts.staleTabs}
          className="ds-btn-secondary px-3 py-2 text-[11px] rounded-lg disabled:opacity-50"
        >
          {reloadingTabs ? t('sidepanel.runtimeDoctorPage.reloadingStaleTabs') : t('sidepanel.runtimeDoctorPage.reloadStaleTabs')}
        </button>
        <button
          type="button"
          onClick={runHumanEval}
          disabled={loading || ensuring || recovering || repairing || reloadingTabs || evaluating}
          className="ds-btn-secondary px-3 py-2 text-[11px] rounded-lg disabled:opacity-50"
        >
          {evaluating ? t('sidepanel.runtimeDoctorPage.evaluating') : t('sidepanel.runtimeDoctorPage.runHumanEval')}
        </button>
      </div>

      {message && (
        <StatusMessage tone={message.tone} onDismiss={() => setMessage(null)}>
          {message.text}
        </StatusMessage>
      )}

      {report && (
        <>
          <SettingsSection
            title={t('sidepanel.runtimeDoctorPage.webSection')}
            description={t('sidepanel.runtimeDoctorPage.webSectionDescription')}
          >
            <StatusGrid>
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.webAuth')}
                value={webAuthLabel}
                tone={webAuthTone}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.provider')}
                value={formatProvider(report.provider, t)}
                tone={report.provider === 'deepseek-web' ? 'success' : report.provider ? 'warning' : 'error'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.deepSeekTabs')}
                value={String(report.deepSeekTabCount)}
                tone={report.deepSeekTabCount > 0 ? 'success' : 'warning'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.contentScripts')}
                value={`${report.contentScripts.healthyTabs}/${report.contentScripts.totalTabs}`}
                tone={report.contentScripts.staleTabs === 0 ? 'success' : 'warning'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.apiFallback')}
                value={report.hasApiKey ? t('common.enabled') : t('common.disabled')}
                tone={report.hasApiKey ? 'info' : 'warning'}
              />
            </StatusGrid>
          </SettingsSection>

          <SettingsSection
            title={t('sidepanel.runtimeDoctorPage.sessionSection')}
            description={t('sidepanel.runtimeDoctorPage.sessionSectionDescription')}
          >
            <StatusGrid>
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.sidepanelChat')}
                value={report.chatEnabled ? t('common.enabled') : t('common.disabled')}
                tone={report.chatEnabled ? 'success' : 'warning'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.chatBusy')}
                value={report.chatBusy ? t('sidepanel.runtimeDoctorPage.busy') : t('sidepanel.runtimeDoctorPage.idle')}
                tone={report.chatBusy ? 'warning' : 'success'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.sessionSource')}
                value={t(`sidepanel.runtimeDoctorPage.sessionSources.${report.sidepanelSession.source}` as LocaleMessageKey)}
                tone={report.sidepanelSession.active ? 'success' : 'info'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.parentMessageId')}
                value={report.sidepanelSession.parentMessageId === null ? t('common.none') : String(report.sidepanelSession.parentMessageId)}
                tone={report.sidepanelSession.parentMessageId === null ? 'info' : 'success'}
              />
            </StatusGrid>
          </SettingsSection>

          <SettingsSection
            title={t('sidepanel.runtimeDoctorPage.visionSection')}
            description={t('sidepanel.runtimeDoctorPage.visionSectionDescription')}
          >
            <StatusGrid>
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.maxImages')}
                value={String(report.vision.maxImagesPerTurn)}
                tone="info"
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.rawImages')}
                value={report.vision.rawImagesStoredDurably
                  ? t('sidepanel.runtimeDoctorPage.rawImagesFound')
                  : t('sidepanel.runtimeDoctorPage.rawImagesClean')}
                tone={report.vision.rawImagesStoredDurably ? 'error' : 'success'}
              />
            </StatusGrid>
          </SettingsSection>

          <SettingsSection
            title={t('sidepanel.runtimeDoctorPage.browserVisionLoops')}
            description={t('sidepanel.runtimeDoctorPage.browserVisionLoopsDescription')}
          >
            <StatusGrid>
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.readinessTarget')}
                value={formatTargetStatus(report.readiness.targetStatus, t)}
                tone={report.readiness.targetStatus === 'ready' ||
                  report.readiness.targetStatus === 'reacquired' ||
                  report.readiness.targetStatus === 'selected_active'
                  ? 'success'
                  : 'warning'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.monitorReady')}
                value={report.browserControl.monitorReady ? t('common.enabled') : t('common.disabled')}
                tone={report.browserControl.monitorReady ? 'success' : 'warning'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.targetLock')}
                value={report.browserControl.targetLock.enabled
                  ? report.browserControl.targetLock.label ?? 'Dev++'
                  : t('common.disabled')}
                tone={report.browserControl.targetLock.enabled ? 'success' : 'info'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.staleTabs')}
                value={String(report.contentScripts.staleTabs)}
                tone={report.contentScripts.staleTabs === 0 ? 'success' : 'warning'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.actVerify')}
                value={report.browserControl.actVerifyEnabled ? t('common.enabled') : t('common.disabled')}
                tone={report.browserControl.actVerifyEnabled ? 'success' : 'info'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.evidencePacks')}
                value={report.browserControl.evidencePacksEnabled ? t('common.enabled') : t('common.disabled')}
                tone={report.browserControl.evidencePacksEnabled ? 'success' : 'info'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.distiller')}
                value={report.debugDistiller.enabled ? t('common.enabled') : t('common.disabled')}
                tone={report.debugDistiller.enabled ? 'success' : 'info'}
              />
            </StatusGrid>
          </SettingsSection>

          <SettingsSection
            title={t('sidepanel.runtimeDoctorPage.humanEval')}
            description={t('sidepanel.runtimeDoctorPage.humanEvalDescription')}
          >
            <StatusGrid>
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.humanEvalGrade')}
                value={report.humanEval.grade}
                tone={report.humanEval.grade === 'A' ? 'success' : report.humanEval.grade === 'F' ? 'error' : 'warning'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.leakSentry')}
                value={report.leakSentry.grade}
                tone={report.leakSentry.ok ? 'success' : 'error'}
              />
            </StatusGrid>
            <div className="space-y-1.5">
              {report.humanEval.checks.map((check) => (
                <div
                  key={check.id}
                  className="px-3 py-2 text-[11px] border"
                  style={{ borderColor: 'var(--ds-border)', borderRadius: 'var(--radius-ctrl)', color: 'var(--ds-text-secondary)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium" style={{ color: 'var(--ds-text)' }}>{check.label}</span>
                    <span>{check.status.toUpperCase()}</span>
                  </div>
                  <div>{check.evidence}</div>
                </div>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection
            title={t('sidepanel.runtimeDoctorPage.automationSection')}
            description={t('sidepanel.runtimeDoctorPage.automationSectionDescription')}
          >
            <StatusGrid>
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.retryableFailure')}
                value={report.automation.retryableFailure
                  ? report.automation.retryableFailure.automationName
                  : t('sidepanel.runtimeDoctorPage.noRetryableFailure')}
                tone={report.automation.retryableFailure ? 'warning' : 'success'}
              />
              <StatusTile
                label={t('sidepanel.runtimeDoctorPage.maxAttempts')}
                value={String(report.automation.maxAttempts)}
                tone="info"
              />
            </StatusGrid>
            {report.debugDistiller.suggestions.length > 0 && (
              <div className="space-y-1.5">
                {report.debugDistiller.suggestions.map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className="px-3 py-2 text-[11px] border"
                    style={{ borderColor: 'var(--ds-border)', borderRadius: 'var(--radius-ctrl)', color: 'var(--ds-text-secondary)' }}
                  >
                    <div className="font-medium" style={{ color: 'var(--ds-text)' }}>{suggestion.title}</div>
                    <div>{suggestion.preview}</div>
                  </div>
                ))}
              </div>
            )}
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
                <div className="space-y-1.5">
                  {report.storage.issues.map((issue) => (
                    <StorageIssueRow key={`${issue.area}:${issue.path}:${issue.reason}`} issue={issue} />
                  ))}
                </div>
              </div>
            )}
          </SettingsSection>
        </>
      )}
    </div>
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
    <div className="ds-card rounded-xl p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--ds-text)' }}>
            {t('sidepanel.runtimeDoctorPage.readyCheckTitle')}
          </div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.runtimeDoctorPage.readyCheckDescription')}
          </div>
        </div>
        <button
          type="button"
          onClick={onEnsureReady}
          disabled={busy}
          className="ds-btn-primary px-3 py-2 text-[11px] rounded-lg disabled:opacity-50 shrink-0"
        >
          {ensuring ? t('sidepanel.runtimeDoctorPage.ensuringReady') : t('sidepanel.runtimeDoctorPage.ensureReady')}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {checks.map((check) => (
          <div
            key={check.key}
            className="flex items-center gap-2 min-w-0 px-2.5 py-2 border"
            style={{ borderColor: 'var(--ds-border)', borderRadius: 'var(--radius-ctrl)' }}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: check.ok ? 'var(--ds-success)' : 'var(--ds-warning, var(--ds-text-secondary))' }}
              aria-hidden="true"
            />
            <span className="text-[11px] truncate" style={{ color: check.ok ? 'var(--ds-text)' : 'var(--ds-text-secondary)' }}>
              {check.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getReadyChecks(
  report: RuntimeDoctorReport,
  t: (key: LocaleMessageKey) => string,
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
          {' · '}
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

function StatusGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {children}
    </div>
  );
}

function StatusTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: StatusTone;
}) {
  const palette = {
    success: { color: 'var(--ds-success)', bg: 'var(--ds-success-bg)' },
    error: { color: 'var(--ds-danger)', bg: 'var(--ds-danger-bg)' },
    warning: { color: 'var(--ds-warning, var(--ds-text-secondary))', bg: 'var(--ds-warning-bg, var(--ds-surface))' },
    info: { color: 'var(--ds-text-secondary)', bg: 'var(--ds-surface)' },
  }[tone];

  return (
    <div
      className="min-w-0 px-3 py-2 border"
      style={{ borderColor: 'var(--ds-border)', borderRadius: 'var(--radius-ctrl)', background: palette.bg }}
    >
      <div className="text-[10px] truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
        {label}
      </div>
      <div className="text-xs font-medium truncate" style={{ color: palette.color }}>
        {value}
      </div>
    </div>
  );
}

function StorageIssueRow({ issue }: { issue: RuntimeDoctorStorageIssue }) {
  const { t } = useI18n();
  return (
    <div
      className="px-3 py-2 text-[11px] border"
      style={{ borderColor: 'var(--ds-border)', borderRadius: 'var(--radius-ctrl)', color: 'var(--ds-text-secondary)' }}
    >
      <span className="font-mono">{issue.area}:{issue.path}</span>
      <span> · {t(`sidepanel.runtimeDoctorPage.issueReasons.${issue.reason}` as LocaleMessageKey)}</span>
    </div>
  );
}

function isRuntimeDoctorReport(value: unknown): value is RuntimeDoctorReport {
  return !!value && typeof value === 'object' && (value as RuntimeDoctorReport).ok === true && !!(value as RuntimeDoctorReport).storage;
}

function formatProvider(
  provider: RuntimeDoctorReport['provider'],
  t: (key: LocaleMessageKey) => string,
): string {
  if (provider === 'deepseek-web') return t('sidepanel.runtimeDoctorPage.providers.deepseekWeb');
  if (provider === 'official-api') return t('sidepanel.runtimeDoctorPage.providers.officialApi');
  return t('sidepanel.runtimeDoctorPage.providers.unavailable');
}

function formatTargetStatus(
  status: RuntimeDoctorReport['readiness']['targetStatus'],
  t: (key: LocaleMessageKey) => string,
): string {
  const key = status ?? 'missing';
  return t(`sidepanel.runtimeDoctorPage.targetStatuses.${key}` as LocaleMessageKey);
}

function formatReadinessBlocker(
  blocker: RuntimeDoctorReadinessBlocker,
  t: (key: LocaleMessageKey) => string,
): string {
  return t(`sidepanel.runtimeDoctorPage.readiness.blockers.${blocker}` as LocaleMessageKey);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
