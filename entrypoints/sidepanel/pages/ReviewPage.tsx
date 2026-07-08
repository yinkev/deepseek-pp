import type { ComponentProps } from 'react';
import PageIntro from '../components/PageIntro';
import type { LocaleMessageKey, MessageParams } from '../../../core/i18n';
import type { RuntimeCockpitReview } from '../../../core/cockpit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  getQualityGateStatusLabel,
  getRecommendationLabel,
} from './cockpit-components';

export default function ReviewPage({ onNavigate }: { onNavigate?: (target: SidepanelNavigationTarget) => void }) {
  const { t } = useI18n();
  const { snapshot, loading, error, refresh } = useRuntimeCockpit();
  const review = snapshot?.review ?? null;
  const reviewStatus = review ? createReviewStatus(review, t) : null;

  return (
    <div className="ds-page ds-cockpit-page">
      <PageIntro
        title={t('sidepanel.cockpit.reviewTitle')}
        description={t('sidepanel.cockpit.reviewDescription')}
        actions={(
          <Button type="button" variant="outline" className="ds-btn-secondary ds-cockpit-action" onClick={() => void refresh()}>
            {t('common.refresh')}
          </Button>
        )}
      />
      <CockpitLoading loading={loading} error={error} onRetry={() => void refresh()}>
        <CockpitEmpty snapshot={snapshot} onNavigate={onNavigate} />
        {snapshot?.mission.active && review && (
          <>
            <CockpitMissionStrip snapshot={snapshot} onNavigate={onNavigate} />
            {reviewStatus && (
              <CockpitPanel
                className={`ds-cockpit-review-status ds-cockpit-review-status-${reviewStatus.tone}`}
                title={t('sidepanel.cockpit.reviewStatus')}
                description={t(reviewStatus.descriptionKey)}
                action={(
                  <CockpitToneBadge tone={reviewStatus.tone} className={`ds-cockpit-review-status-badge-${reviewStatus.tone}`}>
                    {t(reviewStatus.statusKey)}
                  </CockpitToneBadge>
                )}
              >
                <div className="ds-cockpit-fact-grid">
                  <CockpitFactRow
                    label={t('sidepanel.cockpit.reviewStatusNext')}
                    value={t(reviewStatus.nextKey)}
                    tone={reviewStatus.tone === 'blocked' ? 'blocked' : reviewStatus.tone === 'attention' ? 'attention' : 'normal'}
                  />
                  <CockpitFactRow
                    label={t('sidepanel.cockpit.reviewStatusRisk')}
                    value={reviewStatus.risk}
                    tone={reviewStatus.riskTone}
                  />
                  <CockpitFactRow
                    label={t('sidepanel.cockpit.reviewStatusEvidence')}
                    value={t(reviewStatus.evidence.key, reviewStatus.evidence.params)}
                    tone={reviewStatus.evidenceTone}
                  />
                </div>
              </CockpitPanel>
            )}
            {!review.recorded && (
              <Empty className="ds-cockpit-empty">
                <EmptyHeader className="items-start text-left">
                  <EmptyTitle className="ds-cockpit-empty-title">{t('sidepanel.cockpit.noReviewTitle')}</EmptyTitle>
                  <EmptyDescription className="ds-cockpit-empty-copy">{t('sidepanel.cockpit.noReviewDescription')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            <CockpitPanel
              title={t('sidepanel.cockpit.qualityGate')}
              action={(
                <CockpitToneBadge tone={getQualityGateTone(review.qualityGate.status)} className={`ds-cockpit-gate-${review.qualityGate.status}`}>
                  {getQualityGateStatusLabel(review.qualityGate.status, t)}
                </CockpitToneBadge>
              )}
            >
              <div className="ds-cockpit-fact-grid">
                <CockpitFactRow label={t('sidepanel.cockpit.grade')} value={review.qualityGate.grade ?? '—'} />
                <CockpitFactRow label={t('sidepanel.cockpit.verification')} value={review.qualityGate.verificationPassed === null ? '—' : review.qualityGate.verificationPassed ? t('sidepanel.cockpit.passed') : t('sidepanel.cockpit.failed')} />
                <CockpitFactRow label={t('sidepanel.cockpit.coverage')} value={review.qualityGate.coverageComplete === null ? '—' : review.qualityGate.coverageComplete ? t('sidepanel.cockpit.complete') : t('sidepanel.cockpit.incomplete')} tone={review.qualityGate.coverageComplete === false ? 'attention' : 'normal'} />
                <CockpitFactRow label={t('sidepanel.cockpit.gaps')} value={String(review.qualityGate.gapCount)} />
                <CockpitFactRow label={t('sidepanel.cockpit.conflicts')} value={String(review.qualityGate.conflictCount)} />
                <CockpitFactRow label={t('sidepanel.cockpit.warnings')} value={String(review.qualityGate.warningCount)} tone={review.qualityGate.warningCount > 0 ? 'attention' : 'normal'} />
              </div>
            </CockpitPanel>
            <CockpitPanel
              title={t('sidepanel.cockpit.reviewLanes')}
              action={(
                <span className="ds-cockpit-subtle">{getRecommendationLabel(review.lanes.recommendation, t)}</span>
              )}
            >
              <div className="ds-cockpit-fact-grid">
                <CockpitFactRow label={t('sidepanel.cockpit.total')} value={String(review.lanes.total)} />
                <CockpitFactRow label={t('sidepanel.cockpit.running')} value={String(review.lanes.running)} />
                <CockpitFactRow label={t('sidepanel.cockpit.blocked')} value={String(review.lanes.blocked)} tone={review.lanes.blocked > 0 ? 'blocked' : 'normal'} />
                <CockpitFactRow label={t('sidepanel.cockpit.worstGrade')} value={review.lanes.worstGrade ?? '—'} />
              </div>
              {review.lanes.details.length > 0 && (
                <ReviewLaneTable lanes={review.lanes.details} />
              )}
            </CockpitPanel>
          </>
        )}
      </CockpitLoading>
    </div>
  );
}

type ReviewStatusTone = 'normal' | 'attention' | 'blocked';
type ReviewLaneDetail = RuntimeCockpitReview['lanes']['details'][number];

interface ReviewMessage {
  key: LocaleMessageKey;
  params?: MessageParams;
}

interface ReviewStatusModel {
  statusKey: LocaleMessageKey;
  descriptionKey: LocaleMessageKey;
  nextKey: LocaleMessageKey;
  tone: ReviewStatusTone;
  risk: string;
  riskTone: 'normal' | 'muted' | 'attention' | 'blocked';
  evidence: ReviewMessage;
  evidenceTone: 'normal' | 'muted' | 'attention' | 'blocked';
}

function createReviewStatus(
  review: RuntimeCockpitReview,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): ReviewStatusModel {
  const gate = review.qualityGate;
  const lanes = review.lanes;
  const risk = createRiskValue(review, t);
  const evidence = createEvidenceMessage(review);
  const evidenceTone = getEvidenceTone(evidence.key);

  if (!review.recorded) {
    return {
      statusKey: 'sidepanel.cockpit.reviewStatusMissing',
      descriptionKey: 'sidepanel.cockpit.reviewStatusMissingDescription',
      nextKey: 'sidepanel.cockpit.reviewNextRecord',
      tone: 'attention',
      risk,
      riskTone: 'muted',
      evidence,
      evidenceTone,
    };
  }

  if (
    gate.status === 'blocked' ||
    gate.status === 'failed' ||
    gate.verificationPassed === false ||
    gate.conflictCount > 0 ||
    lanes.highestPriority === 'P1' ||
    lanes.highestPriority === 'P2' ||
    lanes.recommendation === 'block' ||
    lanes.blocked > 0 ||
    lanes.failed > 0
  ) {
    return {
      statusKey: 'sidepanel.cockpit.reviewStatusBlocked',
      descriptionKey: 'sidepanel.cockpit.reviewStatusBlockedDescription',
      nextKey: 'sidepanel.cockpit.reviewNextUnblock',
      tone: 'blocked',
      risk,
      riskTone: risk === t('sidepanel.cockpit.reviewRiskNone') ? 'muted' : 'blocked',
      evidence,
      evidenceTone,
    };
  }

  if (lanes.running > 0) {
    return {
      statusKey: 'sidepanel.cockpit.reviewStatusRunning',
      descriptionKey: 'sidepanel.cockpit.reviewStatusRunningDescription',
      nextKey: 'sidepanel.cockpit.reviewNextWait',
      tone: 'attention',
      risk,
      riskTone: 'attention',
      evidence,
      evidenceTone,
    };
  }

  if (
    gate.status === 'warning' ||
    gate.coverageComplete === false ||
    gate.gapCount > 0 ||
    gate.warningCount > 0 ||
    lanes.highestPriority === 'P3' ||
    lanes.recommendation === 'iterate' ||
    lanes.worstGrade === 'C' ||
    lanes.worstGrade === 'D' ||
    lanes.worstGrade === 'F'
  ) {
    return {
      statusKey: 'sidepanel.cockpit.reviewStatusIterate',
      descriptionKey: 'sidepanel.cockpit.reviewStatusIterateDescription',
      nextKey: 'sidepanel.cockpit.reviewNextIterate',
      tone: 'attention',
      risk,
      riskTone: risk === t('sidepanel.cockpit.reviewRiskNone') ? 'muted' : 'attention',
      evidence,
      evidenceTone,
    };
  }

  return {
    statusKey: 'sidepanel.cockpit.reviewStatusReady',
    descriptionKey: 'sidepanel.cockpit.reviewStatusReadyDescription',
    nextKey: 'sidepanel.cockpit.reviewNextProceed',
    tone: 'normal',
    risk,
    riskTone: 'muted',
    evidence,
    evidenceTone,
  };
}

function createRiskValue(
  review: RuntimeCockpitReview,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  if (review.lanes.highestPriority) return review.lanes.highestPriority;
  if (review.lanes.failed > 0) return t('sidepanel.cockpit.reviewRiskFailedLane', { count: review.lanes.failed });
  if (review.lanes.blocked > 0) return t('sidepanel.cockpit.reviewRiskBlockedLane', { count: review.lanes.blocked });
  if (review.qualityGate.conflictCount > 0) return t('sidepanel.cockpit.reviewEvidenceConflicts', { count: review.qualityGate.conflictCount });
  if (review.qualityGate.gapCount > 0) return t('sidepanel.cockpit.reviewEvidenceGaps', { count: review.qualityGate.gapCount });
  return t('sidepanel.cockpit.reviewRiskNone');
}

function createEvidenceMessage(review: RuntimeCockpitReview): ReviewMessage {
  const gate = review.qualityGate;
  if (!gate.recorded) return { key: 'sidepanel.cockpit.reviewEvidenceNoGate' };
  if (gate.verificationPassed === false) return { key: 'sidepanel.cockpit.reviewEvidenceVerificationFailed' };
  if (gate.conflictCount > 0) return { key: 'sidepanel.cockpit.reviewEvidenceConflicts', params: { count: gate.conflictCount } };
  if (gate.gapCount > 0) return { key: 'sidepanel.cockpit.reviewEvidenceGaps', params: { count: gate.gapCount } };
  if (gate.coverageComplete === false) return { key: 'sidepanel.cockpit.reviewEvidenceCoverageIncomplete' };
  if (gate.warningCount > 0) return { key: 'sidepanel.cockpit.reviewEvidenceWarnings', params: { count: gate.warningCount } };
  if (gate.verificationPassed === true && gate.coverageComplete === true) return { key: 'sidepanel.cockpit.reviewEvidenceClear' };
  return { key: 'sidepanel.cockpit.reviewEvidenceRecorded' };
}

function getEvidenceTone(key: LocaleMessageKey): 'normal' | 'muted' | 'attention' | 'blocked' {
  if (key === 'sidepanel.cockpit.reviewEvidenceVerificationFailed' || key === 'sidepanel.cockpit.reviewEvidenceConflicts') {
    return 'blocked';
  }
  if (
    key === 'sidepanel.cockpit.reviewEvidenceGaps' ||
    key === 'sidepanel.cockpit.reviewEvidenceCoverageIncomplete' ||
    key === 'sidepanel.cockpit.reviewEvidenceWarnings' ||
    key === 'sidepanel.cockpit.reviewEvidenceNoGate'
  ) {
    return 'attention';
  }
  return 'normal';
}

function getQualityGateTone(status: RuntimeCockpitReview['qualityGate']['status']): 'normal' | 'attention' | 'blocked' {
  if (status === 'blocked' || status === 'failed') return 'blocked';
  if (status === 'warning' || status === 'none') return 'attention';
  return 'normal';
}

function ReviewLaneTable({ lanes }: { lanes: ReviewLaneDetail[] }) {
  const { t } = useI18n();
  return (
    <div className="ds-cockpit-review-lane-list">
      <Table className="ds-cockpit-review-lane-table" aria-label={t('sidepanel.cockpit.reviewLaneDetails')}>
        <TableCaption className="sr-only">{t('sidepanel.cockpit.reviewLaneDetails')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="ds-cockpit-review-lane-reviewer">{t('sidepanel.cockpit.reviewLaneReviewer')}</TableHead>
            <TableHead className="ds-cockpit-review-lane-state">{t('sidepanel.cockpit.reviewLaneState')}</TableHead>
            <TableHead>{t('sidepanel.cockpit.reviewLaneFinding')}</TableHead>
            <TableHead className="ds-cockpit-review-lane-evidence">{t('sidepanel.cockpit.reviewLaneEvidenceColumn')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lanes.map((lane, index) => (
            <ReviewLaneRow key={`${lane.role}-${lane.status}-${index}`} lane={lane} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ReviewLaneRow({ lane }: { lane: ReviewLaneDetail }) {
  const { t } = useI18n();
  const status = t(`sidepanel.cockpit.reviewLaneStatus.${lane.status}` as LocaleMessageKey);
  const recommendation = getRecommendationLabel(lane.recommendation, t);
  const priority = lane.highestPriority ?? t('sidepanel.cockpit.reviewLaneNoPriority');
  const grade = lane.grade ?? '—';
  const issueCount = lane.issueCount === 1
    ? t('sidepanel.cockpit.reviewLaneIssueOne')
    : t('sidepanel.cockpit.reviewLaneIssueMany', { count: lane.issueCount });
  const evidenceCount = lane.evidenceRefCount === 1
    ? t('sidepanel.cockpit.reviewLaneEvidenceOne')
    : t('sidepanel.cockpit.reviewLaneEvidenceMany', { count: lane.evidenceRefCount });
  const tone = getReviewLaneTone(lane);

  return (
    <TableRow className={`ds-cockpit-review-lane ds-cockpit-review-lane-${tone}`}>
      <TableCell className="ds-cockpit-review-lane-role">{formatRole(lane.role)}</TableCell>
      <TableCell className="ds-cockpit-review-lane-state">
        <Badge variant={getReviewLaneBadgeVariant(tone)} className="ds-cockpit-review-lane-status">
          {status}
        </Badge>
      </TableCell>
      <TableCell className="ds-cockpit-review-lane-finding">
        {t('sidepanel.cockpit.reviewLaneSummary', {
          grade,
          priority,
          recommendation,
        })}
      </TableCell>
      <TableCell className="ds-cockpit-review-lane-counts">
        {issueCount} · {evidenceCount}
      </TableCell>
    </TableRow>
  );
}

function getReviewLaneBadgeVariant(tone: 'normal' | 'attention' | 'blocked'): ComponentProps<typeof Badge>['variant'] {
  if (tone === 'blocked') return 'destructive';
  if (tone === 'attention') return 'secondary';
  return 'outline';
}

function getReviewLaneTone(lane: ReviewLaneDetail): 'normal' | 'attention' | 'blocked' {
  if (lane.status === 'blocked' || lane.status === 'failed' || lane.highestPriority === 'P1' || lane.highestPriority === 'P2') {
    return 'blocked';
  }
  if (lane.status === 'running' || lane.highestPriority === 'P3' || lane.recommendation === 'iterate') return 'attention';
  return 'normal';
}

function formatRole(role: string): string {
  return role.slice(0, 1).toUpperCase() + role.slice(1).replaceAll('_', ' ');
}
