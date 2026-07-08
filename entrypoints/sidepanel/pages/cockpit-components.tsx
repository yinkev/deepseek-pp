import type { ComponentProps, ReactNode } from 'react';
import type { LocaleMessageKey } from '../../../core/i18n';
import type {
  RuntimeCockpitNextAction,
  RuntimeCockpitEvidencePosture,
  RuntimeCockpitSnapshot,
  RuntimeCockpitStatus,
  RuntimeCockpitTimelineEvent,
} from '../../../core/cockpit';
import type {
  AutonomousQualityGateStatus,
  AutonomousReviewLaneRecommendation,
  AutonomousRunPhase,
  AutonomousTargetLeaseStatus,
} from '../../../core/run/types';
import type { SidepanelNavigationTarget } from '../navigation';
import { useI18n } from '../i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface CockpitPageProps {
  onNavigate?: (target: SidepanelNavigationTarget) => void;
}

interface CockpitPanelProps extends Omit<ComponentProps<'section'>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  contentClassName?: string;
}

export function CockpitPanel({
  title,
  description,
  action,
  className,
  contentClassName,
  children,
  ...props
}: CockpitPanelProps) {
  const hasHeader = Boolean(title || description || action);

  return (
    <section className={cn('ds-cockpit-panel', className)} data-workbench-panel="true" {...props}>
      <Card size="sm" className="ds-cockpit-card">
        {hasHeader && (
          <CardHeader className="ds-cockpit-card-header">
            {title && (
              <CardTitle className="ds-cockpit-card-title">
                <h3>{title}</h3>
              </CardTitle>
            )}
            {description && (
              <CardDescription className="ds-cockpit-card-description">
                {description}
              </CardDescription>
            )}
            {action && (
              <CardAction className="ds-cockpit-card-action">
                {action}
              </CardAction>
            )}
          </CardHeader>
        )}
        <CardContent className={cn('ds-cockpit-card-content', contentClassName)}>
          {children}
        </CardContent>
      </Card>
    </section>
  );
}

export function CockpitLoading({ loading, error, onRetry, children }: {
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  if (loading) {
    return (
      <div className="ds-cockpit-skeleton-list" aria-busy="true">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} size="sm" className="ds-cockpit-card ds-cockpit-loading-card">
            <CardContent className="ds-cockpit-card-content">
              <Skeleton className="ds-skeleton h-3 rounded" style={{ width: '60%' }} />
              <Skeleton className="ds-skeleton h-2.5 rounded" style={{ width: '85%' }} />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <Empty className="ds-empty-state" role="alert">
        <EmptyHeader>
          <EmptyTitle className="ds-empty-state-title">{t('sidepanel.cockpit.errorTitle')}</EmptyTitle>
          <EmptyDescription className="ds-empty-state-description">{error}</EmptyDescription>
        </EmptyHeader>
        {onRetry && (
          <EmptyContent className="flex flex-wrap gap-2 justify-center mt-1">
            <Button type="button" variant="outline" className="ds-btn-secondary ds-cockpit-action" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }
  return <>{children}</>;
}

export function CockpitEmpty({ snapshot, onNavigate, onStartMission }: {
  snapshot: RuntimeCockpitSnapshot | null;
  onNavigate?: (target: SidepanelNavigationTarget) => void;
  onStartMission?: () => void;
}) {
  const { t } = useI18n();
  if (snapshot?.mission.active) return null;
  return (
    <Empty className="ds-cockpit-empty">
      <EmptyHeader className="items-start text-left">
        <EmptyTitle className="ds-cockpit-empty-title">{t('sidepanel.cockpit.emptyTitle')}</EmptyTitle>
        <EmptyDescription className="ds-cockpit-empty-copy">{t('sidepanel.cockpit.emptyDescription')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="items-start">
        <Button
          type="button"
          className="ds-btn-primary ds-cockpit-action ds-cockpit-empty-action"
          onClick={() => onStartMission ? onStartMission() : onNavigate?.({ tab: 'mission' })}
        >
          {t('sidepanel.cockpit.startMission')}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function CockpitMissionStrip({ snapshot, onNavigate }: {
  snapshot: RuntimeCockpitSnapshot | null;
  onNavigate?: (target: SidepanelNavigationTarget) => void;
}) {
  const { t } = useI18n();
  const mission = snapshot?.mission ?? null;
  if (!mission?.active) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      className="ds-cockpit-mission-strip"
      onClick={() => onNavigate?.({ tab: 'mission' })}
      aria-label={t('sidepanel.cockpit.openMission')}
    >
      <span className="ds-cockpit-strip-copy">
        <span>{t('sidepanel.cockpit.missionStripLabel')}</span>
        <strong>{mission.title}</strong>
        <small>{t('sidepanel.cockpit.nextActionInline', { value: getNextActionLabel(mission.nextAction, t) })}</small>
      </span>
      <CockpitStatusBadge
        status={mission.status}
        label={mission.runStatus ? t(`sidepanel.cockpit.runStatus.${mission.runStatus}` as LocaleMessageKey) : undefined}
      />
    </Button>
  );
}

export function CockpitStatusBadge({ status, label }: { status: RuntimeCockpitStatus; label?: string }) {
  const { t } = useI18n();
  return (
    <Badge variant={getCockpitStatusBadgeVariant(status)} className={`ds-cockpit-status ds-cockpit-status-${status}`}>
      {label ?? t(`sidepanel.cockpit.status.${status}` as LocaleMessageKey)}
    </Badge>
  );
}

export function CockpitToneBadge({ tone = 'normal', className, children }: {
  tone?: 'normal' | 'muted' | 'attention' | 'blocked' | 'running';
  className?: string;
  children: ReactNode;
}) {
  return (
    <Badge variant={getCockpitToneBadgeVariant(tone)} className={`ds-cockpit-status ${className ?? ''}`}>
      {children}
    </Badge>
  );
}

export function getNextActionLabel(
  nextAction: RuntimeCockpitNextAction,
  t: (key: LocaleMessageKey) => string,
): string {
  return t(`sidepanel.cockpit.nextActionLabel.${nextAction.key}` as LocaleMessageKey);
}

export function CockpitFactRow({ label, value, tone = 'normal' }: {
  label: string;
  value: string;
  tone?: 'normal' | 'muted' | 'attention' | 'blocked';
}) {
  return (
    <div className={`ds-cockpit-fact ds-cockpit-fact-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function CockpitEventRow({ event }: { event: RuntimeCockpitTimelineEvent }) {
  const { locale, t } = useI18n();
  return (
    <div className={`ds-cockpit-event ds-cockpit-event-${event.status}`}>
      <div className="ds-cockpit-event-time">{formatTime(event.at, locale)}</div>
      <div className="ds-cockpit-event-marker" aria-hidden="true" />
      <div className="ds-cockpit-event-main">
        <div className="ds-cockpit-event-title">{getTimelineEventTitle(event, t)}</div>
        <div className="ds-cockpit-event-detail">{getTimelineEventDetail(event, t)}</div>
      </div>
      <Badge variant={getTimelineStatusBadgeVariant(event.status)} className="ds-cockpit-event-state">
        {getTimelineStatusLabel(event.status, t)}
      </Badge>
    </div>
  );
}

function getCockpitStatusBadgeVariant(status: RuntimeCockpitStatus): ComponentProps<typeof Badge>['variant'] {
  if (status === 'blocked') return 'destructive';
  if (status === 'running') return 'default';
  if (status === 'queued' || status === 'paused') return 'secondary';
  return 'outline';
}

function getTimelineStatusBadgeVariant(status: RuntimeCockpitTimelineEvent['status']): ComponentProps<typeof Badge>['variant'] {
  if (status === 'blocked' || status === 'failed') return 'destructive';
  if (status === 'running') return 'default';
  if (status === 'warning') return 'secondary';
  return 'outline';
}

function getCockpitToneBadgeVariant(tone: 'normal' | 'muted' | 'attention' | 'blocked' | 'running'): ComponentProps<typeof Badge>['variant'] {
  if (tone === 'blocked') return 'destructive';
  if (tone === 'running') return 'default';
  if (tone === 'attention') return 'secondary';
  return 'outline';
}

export function formatTime(value: number | null, locale: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

export function formatAge(ms: number | null): string {
  if (ms === null) return '—';
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function getPhaseLabel(phase: AutonomousRunPhase | 'idle', t: (key: LocaleMessageKey) => string): string {
  return t(`sidepanel.cockpit.phaseLabel.${phase}` as LocaleMessageKey);
}

export function getTargetStatusLabel(
  status: AutonomousTargetLeaseStatus | 'none',
  t: (key: LocaleMessageKey) => string,
): string {
  return t(`sidepanel.cockpit.targetStatus.${status}` as LocaleMessageKey);
}

export function getEvidencePostureLabel(
  posture: RuntimeCockpitEvidencePosture,
  t: (key: LocaleMessageKey) => string,
): string {
  return t(`sidepanel.cockpit.evidencePosture.${posture}` as LocaleMessageKey);
}

export function getTimelineStatusLabel(
  status: RuntimeCockpitTimelineEvent['status'],
  t: (key: LocaleMessageKey) => string,
): string {
  return t(`sidepanel.cockpit.timelineStatus.${status}` as LocaleMessageKey);
}

export function getTimelineEventTitle(
  event: RuntimeCockpitTimelineEvent,
  t: (key: LocaleMessageKey) => string,
): string {
  if (event.kind === 'step' && event.phase) return getPhaseLabel(event.phase, t);
  return t(`sidepanel.cockpit.eventTitle.${event.kind}` as LocaleMessageKey);
}

export function getTimelineEventDetail(
  event: RuntimeCockpitTimelineEvent,
  t: (key: LocaleMessageKey, params?: Record<string, string | number>) => string,
): string {
  if ((event.kind === 'mission_created' || event.kind === 'mission_started') && event.missionMode) {
    return t(`sidepanel.cockpit.runMode.${event.missionMode}` as LocaleMessageKey);
  }
  if (event.kind === 'mission_completed' && event.runStatus) {
    return t(`sidepanel.cockpit.runStatus.${event.runStatus}` as LocaleMessageKey);
  }
  if (event.kind === 'step') {
    const proofCount = event.proofUpdateCount ?? 0;
    if (proofCount <= 0) return event.stepStatus ? getTimelineStatusLabel(event.status, t) : event.detail ?? '';
    return proofCount === 1
      ? t('sidepanel.cockpit.proofUpdates.one')
      : t('sidepanel.cockpit.proofUpdates.many', { count: proofCount });
  }
  if (event.kind === 'evidence' && event.evidenceKind && event.evidenceFreshness) {
    return `${t(`sidepanel.cockpit.evidenceKind.${event.evidenceKind}` as LocaleMessageKey)} · ${t(`sidepanel.cockpit.evidenceFreshness.${event.evidenceFreshness}` as LocaleMessageKey)}`;
  }
  if (event.kind === 'quality_gate') {
    return event.qualityGateGrade ? `${t('sidepanel.cockpit.grade')} ${event.qualityGateGrade}` : getTimelineStatusLabel(event.status, t);
  }
  if (event.kind === 'review_lane') {
    const role = event.reviewLaneRole ?? 'other';
    const status = event.reviewLaneStatus ? t(`sidepanel.cockpit.reviewLaneStatus.${event.reviewLaneStatus}` as LocaleMessageKey) : getTimelineStatusLabel(event.status, t);
    return `${formatRole(role)} · ${status}`;
  }
  return event.detail ?? getTimelineStatusLabel(event.status, t);
}

export function getQualityGateStatusLabel(
  status: AutonomousQualityGateStatus | 'none',
  t: (key: LocaleMessageKey) => string,
): string {
  return t(`sidepanel.cockpit.qualityGateStatus.${status}` as LocaleMessageKey);
}

export function getRecommendationLabel(
  recommendation: AutonomousReviewLaneRecommendation | 'none',
  t: (key: LocaleMessageKey) => string,
): string {
  return t(`sidepanel.cockpit.recommendation.${recommendation}` as LocaleMessageKey);
}

export function getBrowserStateLabel(state: string, t: (key: LocaleMessageKey) => string): string {
  return t(`sidepanel.cockpit.browserState.${state}` as LocaleMessageKey);
}

export function getRuntimeStateLabel(state: string, t: (key: LocaleMessageKey) => string): string {
  return t(`sidepanel.cockpit.runtimeState.${state}` as LocaleMessageKey);
}

function formatRole(role: string): string {
  return role.slice(0, 1).toUpperCase() + role.slice(1).replaceAll('_', ' ');
}
