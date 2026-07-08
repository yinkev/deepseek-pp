import PageIntro from '../components/PageIntro';
import type { LocaleMessageKey } from '../../../core/i18n';
import type { RuntimeCockpitTimelineEvent } from '../../../core/cockpit';
import { Button } from '@/components/ui/button';
import { useI18n } from '../i18n';
import { useRuntimeCockpit } from '../use-runtime-cockpit';
import type { SidepanelNavigationTarget } from '../navigation';
import {
  CockpitEmpty,
  CockpitEventRow,
  CockpitFactRow,
  CockpitLoading,
  CockpitMissionStrip,
  CockpitPanel,
  CockpitToneBadge,
  getTimelineEventTitle,
} from './cockpit-components';

export default function TimelinePage({ onNavigate }: { onNavigate?: (target: SidepanelNavigationTarget) => void }) {
  const { t } = useI18n();
  const { snapshot, loading, error, refresh } = useRuntimeCockpit();
  const events = snapshot?.timeline ?? [];
  const evidenceCount = events.filter((event) => event.kind === 'evidence').length;
  const reviewCount = events.filter((event) => event.kind === 'quality_gate' || event.kind === 'review_lane').length;
  const attentionSummary = createActivityAttentionSummary(events, t);
  const activityStatus = createActivityStatus(events, attentionSummary.total, t);

  return (
    <div className="ds-page ds-cockpit-page">
      <PageIntro
        title={t('sidepanel.cockpit.timelineTitle')}
        description={t('sidepanel.cockpit.timelineDescription')}
        actions={(
          <Button type="button" variant="outline" className="ds-btn-secondary ds-cockpit-action" onClick={() => void refresh()}>
            {t('common.refresh')}
          </Button>
        )}
      />
      <CockpitLoading loading={loading} error={error} onRetry={() => void refresh()}>
        <CockpitEmpty snapshot={snapshot} onNavigate={onNavigate} />
        {snapshot?.mission.active && (
          <>
            <CockpitMissionStrip snapshot={snapshot} onNavigate={onNavigate} />
            {activityStatus && (
              <CockpitPanel
                className={`ds-cockpit-activity-status ds-cockpit-activity-status-${activityStatus.tone}`}
                title={t('sidepanel.cockpit.activityStatus')}
                description={t(activityStatus.descriptionKey)}
                action={(
                  <CockpitToneBadge tone={activityStatus.tone} className={`ds-cockpit-activity-status-badge-${activityStatus.tone}`}>
                    {t(activityStatus.statusKey)}
                  </CockpitToneBadge>
                )}
              >
                <div className="ds-cockpit-fact-grid">
                  <CockpitFactRow
                    label={t('sidepanel.cockpit.activityLatest')}
                    value={activityStatus.latest}
                    tone={activityStatus.latestTone}
                  />
                  <CockpitFactRow
                    label={t('sidepanel.cockpit.activityAttention')}
                    value={activityStatus.attention}
                    tone={attentionSummary.total > 0 ? 'attention' : 'muted'}
                  />
                  <CockpitFactRow
                    label={t('sidepanel.cockpit.activityNext')}
                    value={t(activityStatus.nextKey)}
                    tone={activityStatus.tone === 'blocked' ? 'blocked' : activityStatus.tone === 'attention' ? 'attention' : 'normal'}
                  />
                </div>
                {attentionSummary.items.length > 0 && (
                  <div className="ds-cockpit-activity-detail-list" aria-label={t('sidepanel.cockpit.activityAttentionDetails')}>
                    <div className="ds-cockpit-detail-list-title">{t('sidepanel.cockpit.activityAttentionDetails')}</div>
                    {attentionSummary.items.map((item) => (
                      <div key={item.key} className={`ds-cockpit-activity-detail ds-cockpit-activity-detail-${item.tone}`}>
                        <span>{t(item.labelKey)}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                )}
                {activityStatus.reviewAction && onNavigate && (
                  <div className="ds-cockpit-action-row">
                    <Button type="button" variant="outline" className="ds-btn-secondary ds-cockpit-action" onClick={() => onNavigate({ tab: 'review' })}>
                      {t('sidepanel.cockpit.activityOpenReview')}
                    </Button>
                  </div>
                )}
              </CockpitPanel>
            )}
            <CockpitPanel className="ds-cockpit-timeline-panel" title={t('sidepanel.cockpit.timelineSection')}>
              {events.length > 0 ? (
                <>
                  <div className="ds-cockpit-fact-grid ds-cockpit-timeline-summary">
                    <CockpitFactRow label={t('sidepanel.cockpit.timelineEvents')} value={String(events.length)} />
                    <CockpitFactRow label={t('sidepanel.cockpit.timelineEvidence')} value={String(evidenceCount)} />
                    <CockpitFactRow label={t('sidepanel.cockpit.timelineReview')} value={String(reviewCount)} />
                    <CockpitFactRow label={t('sidepanel.cockpit.timelineAttention')} value={String(attentionSummary.total)} tone={attentionSummary.total > 0 ? 'attention' : 'normal'} />
                  </div>
                  <div className="ds-cockpit-event-list">
                    {events.map((event, index) => (
                      <CockpitEventRow key={`${event.kind}-${event.at}-${index}`} event={event} />
                    ))}
                  </div>
                </>
              ) : (
                <div className="ds-cockpit-muted">{t('sidepanel.cockpit.noTimeline')}</div>
              )}
            </CockpitPanel>
          </>
        )}
      </CockpitLoading>
    </div>
  );
}

type ActivityStatusTone = 'normal' | 'running' | 'attention' | 'blocked';
type ActivityFactTone = 'normal' | 'muted' | 'attention' | 'blocked';
type ActivityAttentionKey = 'failed_work' | 'review_flags' | 'evidence_refresh' | 'other_flags';

interface ActivityStatusModel {
  statusKey: LocaleMessageKey;
  descriptionKey: LocaleMessageKey;
  nextKey: LocaleMessageKey;
  tone: ActivityStatusTone;
  latest: string;
  latestTone: ActivityFactTone;
  attention: string;
  reviewAction: boolean;
}

interface ActivityAttentionSummaryItem {
  key: ActivityAttentionKey;
  labelKey: LocaleMessageKey;
  value: string;
  tone: Exclude<ActivityFactTone, 'normal' | 'muted'>;
}

interface ActivityAttentionSummary {
  total: number;
  items: ActivityAttentionSummaryItem[];
}

export function createActivityStatus(
  events: RuntimeCockpitTimelineEvent[],
  attentionCount: number,
  t: (key: LocaleMessageKey, params?: Record<string, string | number>) => string,
): ActivityStatusModel | null {
  const latest = selectLatestEvent(events);
  if (!latest) return null;
  const latestTone = getActivityFactTone(latest.status);
  const attention = formatAttentionCount(attentionCount, t);

  if (latest.status === 'blocked' || latest.status === 'failed') {
    return {
      statusKey: 'sidepanel.cockpit.activityStatusAttention',
      descriptionKey: 'sidepanel.cockpit.activityStatusBlockedDescription',
      nextKey: 'sidepanel.cockpit.activityNextReview',
      tone: 'blocked',
      latest: getTimelineEventTitle(latest, t),
      latestTone,
      attention,
      reviewAction: true,
    };
  }

  if (attentionCount > 0) {
    return {
      statusKey: 'sidepanel.cockpit.activityStatusAttention',
      descriptionKey: 'sidepanel.cockpit.activityStatusAttentionDescription',
      nextKey: 'sidepanel.cockpit.activityNextReview',
      tone: 'attention',
      latest: getTimelineEventTitle(latest, t),
      latestTone,
      attention,
      reviewAction: true,
    };
  }

  if (latest.status === 'running') {
    return {
      statusKey: 'sidepanel.cockpit.activityStatusRunning',
      descriptionKey: 'sidepanel.cockpit.activityStatusRunningDescription',
      nextKey: 'sidepanel.cockpit.activityNextWatch',
      tone: 'running',
      latest: getTimelineEventTitle(latest, t),
      latestTone,
      attention,
      reviewAction: false,
    };
  }

  return {
    statusKey: 'sidepanel.cockpit.activityStatusClear',
    descriptionKey: 'sidepanel.cockpit.activityStatusClearDescription',
    nextKey: 'sidepanel.cockpit.activityNextContinue',
    tone: 'normal',
    latest: getTimelineEventTitle(latest, t),
    latestTone,
    attention,
    reviewAction: false,
  };
}

export function createActivityAttentionSummary(
  events: RuntimeCockpitTimelineEvent[],
  t: (key: LocaleMessageKey, params?: Record<string, string | number>) => string,
): ActivityAttentionSummary {
  const counts: Record<ActivityAttentionKey, number> = {
    failed_work: 0,
    review_flags: 0,
    evidence_refresh: 0,
    other_flags: 0,
  };
  const tones: Record<ActivityAttentionKey, ActivityAttentionSummaryItem['tone']> = {
    failed_work: 'blocked',
    review_flags: 'attention',
    evidence_refresh: 'attention',
    other_flags: 'attention',
  };

  for (const event of events) {
    if (!isAttentionEvent(event)) continue;
    const key = getActivityAttentionKey(event);
    counts[key] += 1;
    if (event.status === 'blocked' || event.status === 'failed') {
      tones[key] = 'blocked';
    }
  }

  const items = ([
    ['failed_work', 'sidepanel.cockpit.activityAttentionFailedWork'],
    ['review_flags', 'sidepanel.cockpit.activityAttentionReview'],
    ['evidence_refresh', 'sidepanel.cockpit.activityAttentionEvidence'],
    ['other_flags', 'sidepanel.cockpit.activityAttentionOther'],
  ] as const)
    .filter(([key]) => counts[key] > 0)
    .map(([key, labelKey]) => ({
      key,
      labelKey,
      value: formatAttentionCount(counts[key], t),
      tone: tones[key],
    }));

  return {
    total: items.reduce((sum, item) => sum + counts[item.key], 0),
    items,
  };
}

function getActivityFactTone(status: RuntimeCockpitTimelineEvent['status']): ActivityFactTone {
  if (status === 'blocked' || status === 'failed') return 'blocked';
  if (status === 'warning') return 'attention';
  if (status === 'info') return 'muted';
  return 'normal';
}

function selectLatestEvent(events: RuntimeCockpitTimelineEvent[]): RuntimeCockpitTimelineEvent | null {
  return events.reduce<RuntimeCockpitTimelineEvent | null>((latest, event) => {
    if (!latest) return event;
    return event.at > latest.at ? event : latest;
  }, null);
}

function formatAttentionCount(
  count: number,
  t: (key: LocaleMessageKey, params?: Record<string, string | number>) => string,
): string {
  if (count <= 0) return t('sidepanel.cockpit.activityAttentionNone');
  if (count === 1) return t('sidepanel.cockpit.activityAttentionOne');
  return t('sidepanel.cockpit.activityAttentionMany', { count });
}

function isAttentionEvent(event: RuntimeCockpitTimelineEvent): boolean {
  return event.status === 'warning' || event.status === 'blocked' || event.status === 'failed';
}

function getActivityAttentionKey(event: RuntimeCockpitTimelineEvent): ActivityAttentionKey {
  if (event.kind === 'step' && event.status === 'failed') return 'failed_work';
  if (event.kind === 'mission_completed' && event.status === 'failed') return 'failed_work';
  if (event.kind === 'quality_gate' || event.kind === 'review_lane') return 'review_flags';
  if (event.kind === 'evidence' && event.evidenceFreshness !== 'fresh') return 'evidence_refresh';
  return 'other_flags';
}
