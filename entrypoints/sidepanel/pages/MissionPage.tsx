import { useRef, useState } from 'react';
import {
  applyRuntimeCockpitMissionAction,
  startRuntimeCockpitMission,
  type RuntimeCockpitMission,
  type RuntimeCockpitMissionAction,
  type RuntimeCockpitReview,
  type RuntimeCockpitWorkingSet,
} from '../../../core/cockpit';
import type { LocaleMessageKey, MessageParams } from '../../../core/i18n';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import PageIntro from '../components/PageIntro';
import { TextAreaField } from '../components/settings/primitives';
import { useI18n } from '../i18n';
import { useRuntimeCockpit } from '../use-runtime-cockpit';
import type { SidepanelNavigationTarget } from '../navigation';
import {
  CockpitEmpty,
  CockpitFactRow,
  CockpitLoading,
  CockpitPanel,
  CockpitStatusBadge,
  CockpitToneBadge,
  formatAge,
  formatTime,
  getEvidencePostureLabel,
  getNextActionLabel,
  getPhaseLabel,
} from './cockpit-components';

export default function MissionPage({ onNavigate }: { onNavigate?: (target: SidepanelNavigationTarget) => void }) {
  const { t, locale } = useI18n();
  const openedAtRef = useRef(Date.now());
  const { snapshot, loading, error, refresh } = useRuntimeCockpit();
  const mission = snapshot?.mission ?? null;
  const missionStatus = mission?.active && snapshot
    ? createMissionStatus(mission, snapshot.workingSet, snapshot.review, t)
    : null;
  const canStartMission = !mission?.active || isTerminalMissionStatus(mission.runStatus);
  const [busyAction, setBusyAction] = useState<RuntimeCockpitMissionAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starterOpen, setStarterOpen] = useState(false);
  const [starterBusy, setStarterBusy] = useState(false);
  const [starterError, setStarterError] = useState<string | null>(null);
  const [starterForm, setStarterForm] = useState({
    objective: '',
    doneCriteriaText: '',
    requiredEvidenceText: '',
  });

  async function handleMissionAction(action: RuntimeCockpitMissionAction) {
    setBusyAction(action);
    setActionError(null);
    try {
      const result = await applyRuntimeCockpitMissionAction(action);
      if (!result.ok) setActionError(t('sidepanel.cockpit.actionFailed'));
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t('sidepanel.cockpit.actionFailed'));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleStartMission() {
    if (!starterForm.objective.trim()) {
      setStarterError(t('sidepanel.cockpit.starterObjectiveRequired'));
      return;
    }
    setStarterBusy(true);
    setStarterError(null);
    try {
      const result = await startRuntimeCockpitMission({
        objective: starterForm.objective,
        doneCriteria: splitMissionLines(starterForm.doneCriteriaText),
        requiredEvidence: splitMissionLines(starterForm.requiredEvidenceText),
      });
      if (!result.ok) {
        setStarterError(t('sidepanel.cockpit.starterObjectiveRequired'));
        return;
      }
      setStarterOpen(false);
      setStarterForm({ objective: '', doneCriteriaText: '', requiredEvidenceText: '' });
      await refresh();
    } catch (caught) {
      setStarterError(caught instanceof Error ? caught.message : t('sidepanel.cockpit.starterFailed'));
    } finally {
      setStarterBusy(false);
    }
  }

  return (
    <div className="ds-page ds-cockpit-page">
      <PageIntro
        title={t('sidepanel.cockpit.missionTitle')}
        description={t('sidepanel.cockpit.missionDescription')}
        actions={(
          <Button type="button" variant="outline" className="ds-btn-secondary ds-cockpit-action" onClick={() => void refresh()}>
            {t('common.refresh')}
          </Button>
        )}
      />
      <CockpitLoading loading={loading} error={error} onRetry={() => void refresh()}>
        {canStartMission && starterOpen && (
          <MissionStarter
            objective={starterForm.objective}
            doneCriteriaText={starterForm.doneCriteriaText}
            requiredEvidenceText={starterForm.requiredEvidenceText}
            busy={starterBusy}
            error={starterError}
            onObjectiveChange={(objective) => setStarterForm((current) => ({ ...current, objective }))}
            onDoneCriteriaChange={(doneCriteriaText) => setStarterForm((current) => ({ ...current, doneCriteriaText }))}
            onRequiredEvidenceChange={(requiredEvidenceText) => setStarterForm((current) => ({ ...current, requiredEvidenceText }))}
            onCancel={() => {
              setStarterOpen(false);
              setStarterError(null);
            }}
            onSubmit={() => void handleStartMission()}
          />
        )}
        {canStartMission && !starterOpen && !mission?.active && (
          <CockpitEmpty
            snapshot={snapshot}
            onNavigate={onNavigate}
            onStartMission={() => {
              setStarterOpen(true);
              setStarterError(null);
            }}
          />
        )}
        {mission?.active && !starterOpen && (
          <>
            {missionStatus && (
              <CockpitPanel
                className={`ds-cockpit-mission-status ds-cockpit-mission-status-${missionStatus.tone}`}
                title={t('sidepanel.cockpit.missionStatus')}
                description={t(missionStatus.descriptionKey)}
                action={(
                  <CockpitToneBadge tone={missionStatus.tone} className={`ds-cockpit-mission-status-badge-${missionStatus.tone}`}>
                    {t(missionStatus.statusKey)}
                  </CockpitToneBadge>
                )}
              >
                <div className="ds-cockpit-fact-grid">
                  <CockpitFactRow
                    label={t('sidepanel.cockpit.missionStatusNext')}
                    value={missionStatus.next}
                    tone={missionStatus.tone === 'blocked' ? 'blocked' : missionStatus.tone === 'attention' ? 'attention' : 'normal'}
                  />
                  <CockpitFactRow
                    label={t('sidepanel.cockpit.missionStatusEvidence')}
                    value={missionStatus.evidence}
                    tone={missionStatus.evidenceTone}
                  />
                  <CockpitFactRow
                    label={t('sidepanel.cockpit.missionStatusReview')}
                    value={missionStatus.review}
                    tone={missionStatus.reviewTone}
                  />
                  {isRecoveredMission(mission, openedAtRef.current) && (
                    <CockpitFactRow
                      label={t('sidepanel.cockpit.missionStatusRecovered')}
                      value={t('sidepanel.cockpit.missionStatusRecoveredValue')}
                    />
                  )}
                </div>
                <div className="ds-cockpit-mission-detail-list" aria-label={t('sidepanel.cockpit.missionReadinessDetails')}>
                  <div className="ds-cockpit-detail-list-title">{t('sidepanel.cockpit.missionReadinessDetails')}</div>
                  {missionStatus.details.map((detail) => (
                    <div key={detail.labelKey} className={`ds-cockpit-mission-detail ds-cockpit-mission-detail-${detail.tone}`}>
                      <span>{t(detail.labelKey)}</span>
                      <strong>{detail.value}</strong>
                    </div>
                  ))}
                </div>
                {missionStatus.action && onNavigate && (
                  <MissionStatusActionButton action={missionStatus.action} onNavigate={onNavigate} />
                )}
              </CockpitPanel>
            )}
            <CockpitPanel
              className="ds-cockpit-mission-panel"
              title={<span className="ds-cockpit-kicker">{t('sidepanel.cockpit.currentMission')}</span>}
              action={(
                <CockpitStatusBadge
                  status={mission.status}
                  label={mission.runStatus ? t(`sidepanel.cockpit.runStatus.${mission.runStatus}` as LocaleMessageKey) : undefined}
                />
              )}
            >
              <h3 className="ds-cockpit-mission-title">{mission.title}</h3>
              <div className="ds-cockpit-next-action">
                <span>{t('sidepanel.cockpit.nextAction')}</span>
                <strong>{getNextActionLabel(mission.nextAction, t)}</strong>
              </div>
              <div className="ds-cockpit-fact-grid">
                <CockpitFactRow label={t('sidepanel.cockpit.phase')} value={getPhaseLabel(mission.phase, t)} />
                <CockpitFactRow label={t('sidepanel.cockpit.progress')} value={mission.progress === null ? '—' : `${Math.round(mission.progress * 100)}%`} />
                <CockpitFactRow label={t('sidepanel.cockpit.updated')} value={formatTime(mission.updatedAt, locale)} />
                <CockpitFactRow label={t('sidepanel.cockpit.elapsed')} value={formatAge(mission.startedAt ? Date.now() - mission.startedAt : null)} />
              </div>
              {mission.availableActions.length > 0 && (
                <div className="ds-cockpit-controls">
                  <span>{t('sidepanel.cockpit.controls')}</span>
                  <div className="ds-cockpit-control-row">
                    {mission.availableActions.map((action) => (
                      <Button
                        key={action}
                        type="button"
                        variant={action === 'stop' ? 'destructive' : 'outline'}
                        className={`${action === 'stop' ? 'ds-btn-danger' : 'ds-btn-secondary'} ds-cockpit-action`}
                        disabled={busyAction !== null}
                        onClick={() => void handleMissionAction(action)}
                      >
                        {busyAction === action ? t('common.loading') : t(`sidepanel.cockpit.actions.${action}`)}
                      </Button>
                    ))}
                  </div>
                  {actionError && <div className="ds-cockpit-inline-error">{actionError}</div>}
                </div>
              )}
              <div className="ds-cockpit-action-row">
                {isTerminalMissionStatus(mission.runStatus) && (
                  <Button
                    type="button"
                    className="ds-btn-primary ds-cockpit-action"
                    onClick={() => {
                      setStarterOpen(true);
                      setStarterError(null);
                    }}
                  >
                    {t('sidepanel.cockpit.startMission')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant={isTerminalMissionStatus(mission.runStatus) ? 'outline' : 'default'}
                  className={`${isTerminalMissionStatus(mission.runStatus) ? 'ds-btn-secondary' : 'ds-btn-primary'} ds-cockpit-action`}
                  onClick={() => onNavigate?.({ tab: 'timeline' })}
                >
                  {t('sidepanel.cockpit.openTimeline')}
                </Button>
                <Button type="button" variant="outline" className="ds-btn-secondary ds-cockpit-action" onClick={() => onNavigate?.({ tab: 'workingSet' })}>
                  {t('sidepanel.cockpit.openWorkingSet')}
                </Button>
                <Button type="button" variant="outline" className="ds-btn-secondary ds-cockpit-action" onClick={() => onNavigate?.({ tab: 'review' })}>
                  {t('sidepanel.cockpit.openReview')}
                </Button>
              </div>
            </CockpitPanel>
          </>
        )}
      </CockpitLoading>
    </div>
  );
}

function MissionStatusActionButton({ action, onNavigate }: {
  action: MissionStatusAction;
  onNavigate: (target: SidepanelNavigationTarget) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="ds-cockpit-action-row">
      <Button type="button" variant="outline" className="ds-btn-secondary ds-cockpit-action" onClick={() => onNavigate(getMissionStatusActionTarget(action))}>
        {t(getMissionStatusActionLabel(action))}
      </Button>
    </div>
  );
}

type MissionStatusTone = 'normal' | 'running' | 'attention' | 'blocked';
type MissionFactTone = 'normal' | 'muted' | 'attention' | 'blocked';
type MissionStatusAction = 'ask' | 'activity' | 'review';

interface MissionStatusModel {
  statusKey: LocaleMessageKey;
  descriptionKey: LocaleMessageKey;
  tone: MissionStatusTone;
  next: string;
  evidence: string;
  evidenceTone: MissionFactTone;
  review: string;
  reviewTone: MissionFactTone;
  details: MissionStatusDetail[];
  action: MissionStatusAction | null;
}

interface MissionStatusDetail {
  labelKey: LocaleMessageKey;
  value: string;
  tone: MissionFactTone;
}

export function createMissionStatus(
  mission: RuntimeCockpitMission,
  workingSet: RuntimeCockpitWorkingSet,
  review: RuntimeCockpitReview,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): MissionStatusModel {
  const evidence = createMissionEvidenceValue(workingSet, t);
  const reviewStatus = createMissionReviewValue(review, t);
  const base = {
    evidence: evidence.value,
    evidenceTone: evidence.tone,
    review: reviewStatus.value,
    reviewTone: reviewStatus.tone,
    details: createMissionStatusDetails(workingSet, review, t),
  };

  if (mission.runStatus === 'blocked' || mission.runStatus === 'failed' || reviewStatus.blocked) {
    return {
      ...base,
      statusKey: mission.runStatus === 'failed' ? 'sidepanel.cockpit.missionStatusFailed' : 'sidepanel.cockpit.missionStatusBlocked',
      descriptionKey: mission.runStatus === 'failed' ? 'sidepanel.cockpit.missionStatusFailedDescription' : 'sidepanel.cockpit.missionStatusBlockedDescription',
      tone: 'blocked',
      next: t('sidepanel.cockpit.nextActionLabel.review_blocker'),
      action: 'review',
    };
  }

  if (mission.runStatus === 'paused') {
    return {
      ...base,
      statusKey: 'sidepanel.cockpit.missionStatusPaused',
      descriptionKey: 'sidepanel.cockpit.missionStatusPausedDescription',
      tone: 'attention',
      next: t('sidepanel.cockpit.nextActionLabel.resume_mission'),
      action: null,
    };
  }

  if (mission.runStatus === 'cancelled') {
    return {
      ...base,
      statusKey: 'sidepanel.cockpit.missionStatusStopped',
      descriptionKey: 'sidepanel.cockpit.missionStatusStoppedDescription',
      tone: 'attention',
      next: t('sidepanel.cockpit.nextActionLabel.review_result'),
      action: 'review',
    };
  }

  if (mission.runStatus === 'succeeded') {
    if (!review.recorded || reviewStatus.attention) {
      return {
        ...base,
        statusKey: 'sidepanel.cockpit.missionStatusReviewNeeded',
        descriptionKey: 'sidepanel.cockpit.missionStatusReviewNeededDescription',
        tone: 'attention',
        next: t('sidepanel.cockpit.nextActionLabel.review_result'),
        action: 'review',
      };
    }
    return {
      ...base,
      statusKey: 'sidepanel.cockpit.missionStatusFinished',
      descriptionKey: 'sidepanel.cockpit.missionStatusFinishedDescription',
      tone: 'normal',
      next: t('sidepanel.cockpit.nextActionLabel.review_result'),
      action: 'review',
    };
  }

  if (mission.runStatus === 'queued') {
    return {
      ...base,
      statusKey: 'sidepanel.cockpit.missionStatusQueued',
      descriptionKey: 'sidepanel.cockpit.missionStatusQueuedDescription',
      tone: 'normal',
      next: t('sidepanel.cockpit.nextActionLabel.ready_to_begin'),
      action: null,
    };
  }

  if (mission.runStatus === 'running' && workingSet.evidence.posture === 'none') {
    return {
      ...base,
      statusKey: 'sidepanel.cockpit.missionStatusNeedsEvidence',
      descriptionKey: 'sidepanel.cockpit.missionStatusNeedsEvidenceDescription',
      tone: 'attention',
      next: t('sidepanel.cockpit.missionOpenAsk'),
      action: 'ask',
    };
  }

  if (mission.runStatus === 'running' && workingSet.evidence.posture !== 'fresh') {
    return {
      ...base,
      statusKey: 'sidepanel.cockpit.missionStatusRefreshEvidence',
      descriptionKey: 'sidepanel.cockpit.missionStatusRefreshEvidenceDescription',
      tone: 'attention',
      next: t('sidepanel.cockpit.missionOpenAsk'),
      action: 'ask',
    };
  }

  return {
    ...base,
    statusKey: 'sidepanel.cockpit.missionStatusRunning',
    descriptionKey: 'sidepanel.cockpit.missionStatusRunningDescription',
    tone: 'running',
    next: getNextActionLabel(mission.nextAction, t),
    action: 'activity',
  };
}

function createMissionEvidenceValue(
  workingSet: RuntimeCockpitWorkingSet,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): { value: string; tone: MissionFactTone } {
  if (workingSet.evidence.total === 0) {
    return { value: t('common.none'), tone: 'muted' };
  }
  const count = t('sidepanel.cockpit.missionEvidenceCount', {
    fresh: workingSet.evidence.fresh,
    total: workingSet.evidence.total,
  });
  if (workingSet.evidence.posture === 'fresh') return { value: count, tone: 'normal' };
  return {
    value: `${getEvidencePostureLabel(workingSet.evidence.posture, t)} · ${count}`,
    tone: 'attention',
  };
}

function createMissionStatusDetails(
  workingSet: RuntimeCockpitWorkingSet,
  review: RuntimeCockpitReview,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): MissionStatusDetail[] {
  return [
    {
      labelKey: 'sidepanel.cockpit.missionReadinessEvidence',
      value: createMissionEvidenceDetailValue(workingSet, t),
      tone: getMissionEvidenceTone(workingSet.evidence.posture),
    },
    createMissionReviewGateDetail(review, t),
    createMissionReviewLaneDetail(review, t),
  ];
}

function createMissionEvidenceDetailValue(
  workingSet: RuntimeCockpitWorkingSet,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  if (workingSet.evidence.total === 0) return t('sidepanel.cockpit.missionEvidenceNone');
  const buckets: string[] = [];
  if (workingSet.evidence.fresh > 0) {
    buckets.push(t('sidepanel.cockpit.missionEvidenceBucketFresh', { count: workingSet.evidence.fresh }));
  }
  if (workingSet.evidence.stale > 0) {
    buckets.push(t('sidepanel.cockpit.missionEvidenceBucketStale', { count: workingSet.evidence.stale }));
  }
  if (workingSet.evidence.expired > 0) {
    buckets.push(t('sidepanel.cockpit.missionEvidenceBucketExpired', { count: workingSet.evidence.expired }));
  }
  return buckets.join(' · ');
}

function getMissionEvidenceTone(posture: RuntimeCockpitWorkingSet['evidence']['posture']): MissionFactTone {
  if (posture === 'none') return 'muted';
  if (posture === 'fresh') return 'normal';
  return 'attention';
}

function createMissionReviewGateDetail(
  review: RuntimeCockpitReview,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): MissionStatusDetail {
  const gate = review.qualityGate;
  if (!review.recorded || !gate.recorded) {
    return {
      labelKey: 'sidepanel.cockpit.missionReadinessReviewGate',
      value: t('sidepanel.cockpit.reviewEvidenceNoGate'),
      tone: 'attention',
    };
  }
  if (gate.verificationPassed === false) {
    return {
      labelKey: 'sidepanel.cockpit.missionReadinessReviewGate',
      value: t('sidepanel.cockpit.reviewEvidenceVerificationFailed'),
      tone: 'blocked',
    };
  }
  if (gate.conflictCount > 0) {
    return {
      labelKey: 'sidepanel.cockpit.missionReadinessReviewGate',
      value: t('sidepanel.cockpit.reviewEvidenceConflicts', { count: gate.conflictCount }),
      tone: 'blocked',
    };
  }
  if (gate.gapCount > 0) {
    return {
      labelKey: 'sidepanel.cockpit.missionReadinessReviewGate',
      value: t('sidepanel.cockpit.reviewEvidenceGaps', { count: gate.gapCount }),
      tone: 'attention',
    };
  }
  if (gate.coverageComplete === false) {
    return {
      labelKey: 'sidepanel.cockpit.missionReadinessReviewGate',
      value: t('sidepanel.cockpit.reviewEvidenceCoverageIncomplete'),
      tone: 'attention',
    };
  }
  if (gate.warningCount > 0) {
    return {
      labelKey: 'sidepanel.cockpit.missionReadinessReviewGate',
      value: t('sidepanel.cockpit.reviewEvidenceWarnings', { count: gate.warningCount }),
      tone: 'attention',
    };
  }
  return {
    labelKey: 'sidepanel.cockpit.missionReadinessReviewGate',
    value: gate.verificationPassed === true && gate.coverageComplete === true
      ? t('sidepanel.cockpit.reviewEvidenceClear')
      : t('sidepanel.cockpit.reviewEvidenceRecorded'),
    tone: 'normal',
  };
}

function createMissionReviewLaneDetail(
  review: RuntimeCockpitReview,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): MissionStatusDetail {
  if (review.lanes.total === 0) {
    return {
      labelKey: 'sidepanel.cockpit.missionReadinessReviewers',
      value: t('sidepanel.cockpit.missionReviewersNone'),
      tone: 'muted',
    };
  }
  const issueCount = review.lanes.details.reduce((total, lane) => total + lane.issueCount, 0);
  const issueText = issueCount === 1
    ? t('sidepanel.cockpit.reviewLaneIssueOne')
    : t('sidepanel.cockpit.reviewLaneIssueMany', { count: issueCount });
  const blockedCount = review.lanes.blocked + review.lanes.failed;
  return {
    labelKey: 'sidepanel.cockpit.missionReadinessReviewers',
    value: t('sidepanel.cockpit.missionReviewersSummary', {
      priority: review.lanes.highestPriority ?? t('sidepanel.cockpit.reviewLaneNoPriority'),
      state: createMissionReviewLaneState(review, blockedCount, t),
      issueText,
    }),
    tone: blockedCount > 0 || review.lanes.highestPriority === 'P1' || review.lanes.highestPriority === 'P2'
      ? 'blocked'
      : review.lanes.running > 0 || review.lanes.highestPriority === 'P3' || review.lanes.recommendation === 'iterate'
        ? 'attention'
        : 'normal',
  };
}

function createMissionReviewLaneState(
  review: RuntimeCockpitReview,
  blockedCount: number,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  if (blockedCount > 0 && review.lanes.running > 0) {
    return t('sidepanel.cockpit.missionReviewersBlockedRunning', {
      blocked: blockedCount,
      running: review.lanes.running,
    });
  }
  if (blockedCount > 0) return t('sidepanel.cockpit.missionReviewersBlocked', { count: blockedCount });
  if (review.lanes.running > 0) return t('sidepanel.cockpit.missionReviewersRunning', { count: review.lanes.running });
  return t('sidepanel.cockpit.missionReviewersPassed', {
    passed: review.lanes.passed,
    total: review.lanes.total,
  });
}

function createMissionReviewValue(
  review: RuntimeCockpitReview,
  t: (key: LocaleMessageKey) => string,
): { value: string; tone: MissionFactTone; attention: boolean; blocked: boolean } {
  if (!review.recorded) {
    return { value: t('sidepanel.cockpit.missionReviewMissing'), tone: 'attention', attention: true, blocked: false };
  }
  if (isMissionReviewBlocked(review)) {
    return { value: t('sidepanel.cockpit.missionReviewBlocked'), tone: 'blocked', attention: true, blocked: true };
  }
  if (review.lanes.running > 0) {
    return { value: t('sidepanel.cockpit.missionReviewRunning'), tone: 'attention', attention: true, blocked: false };
  }
  if (isMissionReviewAttention(review)) {
    return { value: t('sidepanel.cockpit.missionReviewIterate'), tone: 'attention', attention: true, blocked: false };
  }
  if (review.qualityGate.verificationPassed === true && review.qualityGate.coverageComplete === true) {
    return { value: t('sidepanel.cockpit.missionReviewReady'), tone: 'normal', attention: false, blocked: false };
  }
  return { value: t('sidepanel.cockpit.missionReviewRecorded'), tone: 'normal', attention: false, blocked: false };
}

function isMissionReviewBlocked(review: RuntimeCockpitReview): boolean {
  const gate = review.qualityGate;
  const lanes = review.lanes;
  return gate.status === 'blocked' ||
    gate.status === 'failed' ||
    gate.verificationPassed === false ||
    gate.conflictCount > 0 ||
    lanes.highestPriority === 'P1' ||
    lanes.highestPriority === 'P2' ||
    lanes.recommendation === 'block' ||
    lanes.blocked > 0 ||
    lanes.failed > 0;
}

function isMissionReviewAttention(review: RuntimeCockpitReview): boolean {
  const gate = review.qualityGate;
  const lanes = review.lanes;
  return gate.status === 'warning' ||
    gate.coverageComplete === false ||
    gate.gapCount > 0 ||
    gate.warningCount > 0 ||
    lanes.highestPriority === 'P3' ||
    lanes.recommendation === 'iterate' ||
    lanes.worstGrade === 'C' ||
    lanes.worstGrade === 'D' ||
    lanes.worstGrade === 'F';
}

function getMissionStatusActionTarget(action: MissionStatusAction): SidepanelNavigationTarget {
  if (action === 'ask') return { tab: 'chat' };
  if (action === 'activity') return { tab: 'timeline' };
  return { tab: 'review' };
}

function getMissionStatusActionLabel(action: MissionStatusAction): LocaleMessageKey {
  if (action === 'ask') return 'sidepanel.cockpit.missionOpenAsk';
  if (action === 'activity') return 'sidepanel.cockpit.missionOpenActivity';
  return 'sidepanel.cockpit.missionOpenReview';
}

function isRecoveredMission(mission: RuntimeCockpitMission | null, openedAt: number): boolean {
  if (!mission?.active) return false;
  if (!mission.runStatus || isTerminalMissionStatus(mission.runStatus)) return false;
  const missionAnchor = mission.startedAt ?? mission.updatedAt;
  return missionAnchor !== null && missionAnchor < openedAt;
}

function MissionStarter({
  objective,
  doneCriteriaText,
  requiredEvidenceText,
  busy,
  error,
  onObjectiveChange,
  onDoneCriteriaChange,
  onRequiredEvidenceChange,
  onCancel,
  onSubmit,
}: {
  objective: string;
  doneCriteriaText: string;
  requiredEvidenceText: string;
  busy: boolean;
  error: string | null;
  onObjectiveChange: (value: string) => void;
  onDoneCriteriaChange: (value: string) => void;
  onRequiredEvidenceChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  return (
    <CockpitPanel
      className="ds-cockpit-starter"
      title={t('sidepanel.cockpit.starterTitle')}
      description={t('sidepanel.cockpit.starterDescription')}
    >
      <TextAreaField
        name="mission-objective"
        label={t('sidepanel.cockpit.objectiveLabel')}
        value={objective}
        placeholder={t('sidepanel.cockpit.objectivePlaceholder')}
        rows={3}
        fieldClassName="ds-cockpit-field"
        textareaClassName="ds-input ds-cockpit-textarea"
        onChange={onObjectiveChange}
      />
      <TextAreaField
        name="mission-done-criteria"
        label={t('sidepanel.cockpit.doneCriteriaLabel')}
        value={doneCriteriaText}
        placeholder={t('sidepanel.cockpit.doneCriteriaPlaceholder')}
        rows={3}
        fieldClassName="ds-cockpit-field"
        textareaClassName="ds-input ds-cockpit-textarea"
        onChange={onDoneCriteriaChange}
      />
      <TextAreaField
        name="mission-required-evidence"
        label={t('sidepanel.cockpit.requiredEvidenceLabel')}
        value={requiredEvidenceText}
        placeholder={t('sidepanel.cockpit.requiredEvidencePlaceholder')}
        rows={3}
        fieldClassName="ds-cockpit-field"
        textareaClassName="ds-input ds-cockpit-textarea"
        onChange={onRequiredEvidenceChange}
      />
      {error && (
        <Alert variant="destructive" className="ds-cockpit-inline-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="ds-cockpit-starter-actions">
        <Button type="button" variant="outline" className="ds-btn-secondary ds-cockpit-action" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="button" className="ds-btn-primary ds-cockpit-action" disabled={busy || !objective.trim()} onClick={onSubmit}>
          {busy ? t('common.loading') : t('sidepanel.cockpit.createMission')}
        </Button>
      </div>
    </CockpitPanel>
  );
}

function splitMissionLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isTerminalMissionStatus(status: string | null): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}
