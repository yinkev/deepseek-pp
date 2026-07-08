import PageIntro from '../components/PageIntro';
import type { LocaleMessageKey } from '../../../core/i18n';
import type { RuntimeCockpitWorkingSet } from '../../../core/cockpit';
import { Button } from '@/components/ui/button';
import { useGlobalOperationalContext } from '../global-operational-context';
import { useI18n } from '../i18n';
import { useRuntimeCockpit } from '../use-runtime-cockpit';
import type { SidepanelNavigationTarget } from '../navigation';
import {
  CockpitEmpty,
  CockpitFactRow,
  CockpitLoading,
  CockpitMissionStrip,
  CockpitPanel,
  CockpitToneBadge,
  formatAge,
  formatTime,
  getBrowserStateLabel,
  getEvidencePostureLabel,
  getRuntimeStateLabel,
  getTargetStatusLabel,
} from './cockpit-components';

export default function WorkingSetPage({ onNavigate }: { onNavigate?: (target: SidepanelNavigationTarget) => void }) {
  const { t, locale } = useI18n();
  const { context } = useGlobalOperationalContext();
  const { snapshot, loading, error, refresh } = useRuntimeCockpit();
  const workingSet = snapshot?.workingSet ?? null;
  const workingSetStatus = workingSet ? createWorkingSetStatus(workingSet, t) : null;
  const snapshotGeneratedAt = snapshot?.generatedAt ?? Date.now();

  return (
    <div className="ds-page ds-cockpit-page">
      <PageIntro
        title={t('sidepanel.cockpit.workingSetTitle')}
        description={t('sidepanel.cockpit.workingSetDescription')}
        actions={(
          <Button type="button" variant="outline" className="ds-btn-secondary ds-cockpit-action" onClick={() => void refresh()}>
            {t('common.refresh')}
          </Button>
        )}
      />
      <CockpitLoading loading={loading} error={error} onRetry={() => void refresh()}>
        <CockpitEmpty snapshot={snapshot} onNavigate={onNavigate} />
        {workingSet && (
          <>
            <CockpitMissionStrip snapshot={snapshot} onNavigate={onNavigate} />
            {workingSetStatus && (
              <CockpitPanel
                className={`ds-cockpit-working-set-status ds-cockpit-working-set-status-${workingSetStatus.tone}`}
                title={t('sidepanel.cockpit.workingSetStatus')}
                description={t(workingSetStatus.descriptionKey)}
                action={(
                  <CockpitToneBadge tone={workingSetStatus.tone} className={`ds-cockpit-working-set-status-badge-${workingSetStatus.tone}`}>
                    {t(workingSetStatus.statusKey)}
                  </CockpitToneBadge>
                )}
              >
                <div className="ds-cockpit-fact-grid">
                  <CockpitFactRow
                    label={t('sidepanel.cockpit.workingSetStatusTarget')}
                    value={workingSetStatus.target}
                    tone={workingSetStatus.targetTone}
                  />
                  <CockpitFactRow
                    label={t('sidepanel.cockpit.workingSetStatusEvidence')}
                    value={workingSetStatus.evidence}
                    tone={workingSetStatus.evidenceTone}
                  />
                  <CockpitFactRow
                    label={t('sidepanel.cockpit.workingSetStatusNext')}
                    value={t(workingSetStatus.nextKey)}
                    tone={workingSetStatus.tone === 'attention' ? 'attention' : 'normal'}
                  />
                </div>
                {workingSetStatus.action && onNavigate && (
                  <div className="ds-cockpit-action-row">
                    <Button
                      type="button"
                      variant="outline"
                      className="ds-btn-secondary ds-cockpit-action"
                      onClick={() => onNavigate(workingSetStatus.action === 'browser'
                        ? { tab: 'capabilities', capabilitiesSubTab: 'browser' }
                        : { tab: 'chat' })}
                    >
                      {t(workingSetStatus.action === 'browser'
                        ? 'sidepanel.cockpit.workingSetOpenBrowser'
                        : 'sidepanel.cockpit.workingSetOpenAsk')}
                    </Button>
                  </div>
                )}
              </CockpitPanel>
            )}
            <CockpitPanel
              title={t('sidepanel.cockpit.target')}
              action={(
                <span className="ds-cockpit-subtle">{t('sidepanel.cockpit.metadataOnly')}</span>
              )}
            >
              <div className="ds-cockpit-fact-grid">
                <CockpitFactRow label={t('sidepanel.cockpit.lease')} value={getTargetStatusLabel(workingSet.target.status, t)} tone={workingSet.target.stale ? 'attention' : 'normal'} />
                <CockpitFactRow label={t('sidepanel.cockpit.locked')} value={workingSet.target.locked ? t('common.on') : t('common.off')} />
                <CockpitFactRow label={t('sidepanel.cockpit.age')} value={formatAge(workingSet.target.ageMs)} />
                <CockpitFactRow label={t('sidepanel.cockpit.expires')} value={formatAge(workingSet.target.expiresInMs)} />
              </div>
            </CockpitPanel>
            <CockpitPanel
              title={t('sidepanel.cockpit.evidence')}
              action={(
                <CockpitToneBadge tone={getEvidenceBadgeTone(workingSet.evidence.posture)} className={`ds-cockpit-evidence-${workingSet.evidence.posture}`}>
                  {getEvidencePostureLabel(workingSet.evidence.posture, t)}
                </CockpitToneBadge>
              )}
            >
              <div className="ds-cockpit-fact-grid">
                <CockpitFactRow label={t('sidepanel.cockpit.total')} value={String(workingSet.evidence.total)} />
                <CockpitFactRow label={t('sidepanel.cockpit.fresh')} value={String(workingSet.evidence.fresh)} />
                <CockpitFactRow label={t('sidepanel.cockpit.stale')} value={String(workingSet.evidence.stale)} />
                <CockpitFactRow label={t('sidepanel.cockpit.latest')} value={formatTime(workingSet.evidence.latestAt, locale)} />
              </div>
              {workingSet.evidence.details.length > 0 && (
                <div className="ds-cockpit-evidence-detail-list" aria-label={t('sidepanel.cockpit.evidenceDetails')}>
                  <div className="ds-cockpit-detail-list-title">{t('sidepanel.cockpit.evidenceDetails')}</div>
                  {workingSet.evidence.details.map((detail, index) => (
                    <div
                      key={`${detail.kind}-${detail.capturedAt}-${index}`}
                      className={`ds-cockpit-evidence-detail ds-cockpit-evidence-detail-${detail.freshness}`}
                    >
                      <div className="ds-cockpit-evidence-detail-main">
                        <span className="ds-cockpit-evidence-detail-kind">
                          {t(`sidepanel.cockpit.evidenceKind.${detail.kind}` as LocaleMessageKey)}
                        </span>
                        <span className="ds-cockpit-evidence-detail-meta">
                          {getEvidenceDetailMeta(detail, snapshotGeneratedAt, locale, t)}
                        </span>
                      </div>
                      <CockpitToneBadge tone={getEvidenceBadgeTone(detail.freshness)} className={`ds-cockpit-evidence-${detail.freshness}`}>
                        {t(`sidepanel.cockpit.evidenceFreshness.${detail.freshness}` as LocaleMessageKey)}
                      </CockpitToneBadge>
                    </div>
                  ))}
                </div>
              )}
            </CockpitPanel>
            <CockpitPanel title={t('sidepanel.cockpit.liveContext')}>
              <div className="ds-cockpit-fact-grid">
                <CockpitFactRow label={t('sidepanel.cockpit.project')} value={context.project.name ?? t('common.none')} />
                <CockpitFactRow label={t('sidepanel.cockpit.browser')} value={context.browser.targetLabel ?? getBrowserStateLabel(context.browser.state, t)} />
                <CockpitFactRow label={t('sidepanel.cockpit.runtime')} value={getRuntimeStateLabel(context.runtime.state, t)} />
                <CockpitFactRow label={t('sidepanel.cockpit.tools')} value={context.tools.enabledCount === null ? '—' : t('app.context.toolsEnabled', { count: context.tools.enabledCount })} />
              </div>
            </CockpitPanel>
          </>
        )}
      </CockpitLoading>
    </div>
  );
}

type WorkingSetStatusTone = 'normal' | 'attention';
type WorkingSetFactTone = 'normal' | 'muted' | 'attention';
type WorkingSetStatusAction = 'browser' | 'ask' | null;

interface WorkingSetStatusModel {
  statusKey: LocaleMessageKey;
  descriptionKey: LocaleMessageKey;
  nextKey: LocaleMessageKey;
  tone: WorkingSetStatusTone;
  target: string;
  targetTone: WorkingSetFactTone;
  evidence: string;
  evidenceTone: WorkingSetFactTone;
  action: WorkingSetStatusAction;
}

export function createWorkingSetStatus(
  workingSet: RuntimeCockpitWorkingSet,
  t: (key: LocaleMessageKey) => string,
): WorkingSetStatusModel {
  const target = getTargetStatusLabel(workingSet.target.status, t);
  const evidence = getEvidencePostureLabel(workingSet.evidence.posture, t);
  const targetTone = workingSet.target.status === 'none' || workingSet.target.stale ? 'attention' : 'normal';
  const evidenceTone = getWorkingSetEvidenceTone(workingSet.evidence.posture);

  if (workingSet.target.status === 'none') {
    return {
      statusKey: 'sidepanel.cockpit.workingSetStatusNoTarget',
      descriptionKey: 'sidepanel.cockpit.workingSetStatusNoTargetDescription',
      nextKey: 'sidepanel.cockpit.workingSetNextSelectTarget',
      tone: 'attention',
      target,
      targetTone,
      evidence,
      evidenceTone,
      action: 'browser',
    };
  }

  if (workingSet.target.stale) {
    return {
      statusKey: 'sidepanel.cockpit.workingSetStatusRefreshTarget',
      descriptionKey: 'sidepanel.cockpit.workingSetStatusRefreshTargetDescription',
      nextKey: 'sidepanel.cockpit.workingSetNextRefreshTarget',
      tone: 'attention',
      target,
      targetTone,
      evidence,
      evidenceTone,
      action: 'browser',
    };
  }

  if (workingSet.evidence.posture === 'none') {
    return {
      statusKey: 'sidepanel.cockpit.workingSetStatusNeedsEvidence',
      descriptionKey: 'sidepanel.cockpit.workingSetStatusNeedsEvidenceDescription',
      nextKey: 'sidepanel.cockpit.workingSetNextAskWithContext',
      tone: 'attention',
      target,
      targetTone,
      evidence,
      evidenceTone,
      action: 'ask',
    };
  }

  if (workingSet.evidence.posture !== 'fresh') {
    return {
      statusKey: 'sidepanel.cockpit.workingSetStatusRefreshEvidence',
      descriptionKey: 'sidepanel.cockpit.workingSetStatusRefreshEvidenceDescription',
      nextKey: 'sidepanel.cockpit.workingSetNextRefreshEvidence',
      tone: 'attention',
      target,
      targetTone,
      evidence,
      evidenceTone,
      action: 'ask',
    };
  }

  return {
    statusKey: 'sidepanel.cockpit.workingSetStatusReady',
    descriptionKey: 'sidepanel.cockpit.workingSetStatusReadyDescription',
    nextKey: 'sidepanel.cockpit.workingSetNextContinue',
    tone: 'normal',
    target,
    targetTone,
    evidence,
    evidenceTone,
    action: null,
  };
}

function getWorkingSetEvidenceTone(posture: RuntimeCockpitWorkingSet['evidence']['posture']): WorkingSetFactTone {
  if (posture === 'fresh') return 'normal';
  if (posture === 'none') return 'muted';
  return 'attention';
}

function getEvidenceBadgeTone(
  freshness: RuntimeCockpitWorkingSet['evidence']['posture'] | RuntimeCockpitWorkingSet['evidence']['details'][number]['freshness'],
): 'normal' | 'muted' | 'attention' {
  if (freshness === 'fresh') return 'normal';
  if (freshness === 'none') return 'muted';
  return 'attention';
}

function getEvidenceDetailMeta(
  detail: RuntimeCockpitWorkingSet['evidence']['details'][number],
  generatedAt: number,
  locale: string,
  t: (key: LocaleMessageKey, params?: Record<string, string | number>) => string,
): string {
  const captured = formatTime(detail.capturedAt, locale);
  if (detail.expiresAt === null) return t('sidepanel.cockpit.evidenceCaptured', { captured });
  if (detail.freshness === 'expired') {
    return t('sidepanel.cockpit.evidenceExpiredAt', { captured, expires: formatTime(detail.expiresAt, locale) });
  }
  return t('sidepanel.cockpit.evidenceValidFor', {
    captured,
    age: formatAge(Math.max(0, detail.expiresAt - generatedAt)),
  });
}
