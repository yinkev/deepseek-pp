import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UsageRangeDays, UsageSummary } from '../../../../core/types';
import { useI18n } from '../../i18n';
import {
  EmptyState,
  SegmentedControl,
  SettingsSection,
  SkeletonList,
  StatusMessage,
  useBanner,
  useConfirm,
} from './primitives';
import { getRuntimeErrorMessage, isRuntimeFailure } from '../../runtime-response';

type RangeKey = '7' | '30';

export default function UsageSubPage() {
  const { t, locale } = useI18n();
  const [rangeKey, setRangeKey] = useState<RangeKey>('30');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { confirm, node: confirmNode } = useConfirm();
  const banner = useBanner();

  const rangeDays = Number(rangeKey) as UsageRangeDays;
  const rangeOptions = useMemo(() => [
    { key: '7' as const, label: t('sidepanel.settings.usage.last7Days') },
    { key: '30' as const, label: t('sidepanel.settings.usage.last30Days') },
  ], [t]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'GET_USAGE_SUMMARY',
        payload: { rangeDays },
      }) as UsageSummary | undefined;
      if (isRuntimeFailure(result)) {
        throw new Error(getUsageIssueMessage(result.error, t('sidepanel.settings.usage.loadFailed')));
      }
      if (!result) throw new Error(t('sidepanel.settings.usage.loadFailed'));
      setSummary(result);
    } catch (err) {
      setError(getUsageIssueMessage(err, t('sidepanel.settings.usage.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [rangeDays, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearStats = async () => {
    const ok = await confirm({
      title: t('sidepanel.settings.usage.clearStats'),
      message: t('sidepanel.settings.usage.clearConfirm'),
      confirmLabel: t('sidepanel.settings.usage.clearStats'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;

    try {
      const result = await chrome.runtime.sendMessage({ type: 'CLEAR_USAGE_STATS' });
      if (isRuntimeFailure(result)) {
        throw new Error(getUsageIssueMessage(result.error, t('sidepanel.settings.usage.clearFailed')));
      }
      banner.show('success', t('sidepanel.settings.usage.clearSuccess'));
      await load();
    } catch (err) {
      banner.show('error', getUsageIssueMessage(err, t('sidepanel.settings.usage.clearFailed')));
    }
  };

  const hasUsage = Boolean(summary && summary.turnCount > 0);

  return (
    <div className="usage-settings space-y-4">
      {confirmNode}
      {banner.node}

      <div className="usage-toolbar">
        <div className="min-w-0">
          <div className="usage-toolbar-label">{t('sidepanel.settings.usage.rangeLabel')}</div>
          <SegmentedControl
            options={rangeOptions}
            value={rangeKey}
            onChange={setRangeKey}
            ariaLabel={t('sidepanel.settings.usage.rangeLabel')}
            size="sm"
          />
        </div>
        {hasUsage && (
          <button
            type="button"
            className="ds-btn-danger usage-clear-button"
            onClick={clearStats}
          >
            {t('sidepanel.settings.usage.clearStats')}
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonList rows={4} />
      ) : error ? (
        <div className="usage-recovery">
          <StatusMessage tone="error">{error}</StatusMessage>
          <button
            type="button"
            className="ds-btn-secondary usage-retry-button"
            onClick={load}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : !summary || !hasUsage ? (
        <EmptyState
          title={t('sidepanel.settings.usage.emptyTitle')}
          description={t('sidepanel.settings.usage.emptyDescription')}
        />
      ) : (
        <>
          <UsageOverview summary={summary} locale={locale} />
          <UsageActivity summary={summary} locale={locale} />
          <UsageModels summary={summary} locale={locale} />
        </>
      )}
    </div>
  );
}

function getUsageIssueMessage(error: unknown, fallback: string): string {
  if (error === null || error === undefined) return fallback;
  const raw = getRuntimeErrorMessage(error).trim();
  if (!raw || raw === 'undefined' || raw === 'null') return fallback;
  if (/\b(GET|CLEAR)_USAGE[A-Z0-9_]*\b|schemaVersion|chrome\.runtime|chrome\.storage|IndexedDB|Bearer|Cookie|data:image/i.test(raw)) {
    return fallback;
  }
  return raw;
}

function UsageOverview({ summary, locale }: { summary: UsageSummary; locale: string }) {
  const { t } = useI18n();
  const mostUsedModel = summary.mostUsedModel;
  return (
    <SettingsSection title={t('sidepanel.settings.usage.overviewTitle')}>
      <div className="usage-summary-list">
        <UsageFactRow
        label={t('sidepanel.settings.usage.totalTokens')}
        value={formatCompactTokens(summary.totalTokens, locale)}
        detail={t('sidepanel.settings.usage.serverSamples', {
          server: summary.serverTokenRecordCount,
          total: summary.turnCount,
        })}
      />
        <UsageFactRow
        label={t('sidepanel.settings.usage.sessions')}
        value={formatInteger(summary.sessionCount, locale)}
        detail={t('sidepanel.settings.usage.turns', { count: summary.turnCount })}
      />
        <UsageFactRow
        label={t('sidepanel.settings.usage.messages')}
        value={formatInteger(summary.messageCount, locale)}
        detail={t('sidepanel.settings.usage.activeDays', { count: summary.activeDays })}
      />
        <UsageFactRow
        label={t('sidepanel.settings.usage.currentStreak')}
        value={formatInteger(summary.currentStreak, locale)}
        detail={t('sidepanel.settings.usage.daysUnit')}
      />
        <UsageFactRow
        label={t('sidepanel.settings.usage.mostUsedModel')}
        value={mostUsedModel?.modelLabel ?? t('sidepanel.settings.usage.noModel')}
        detail={mostUsedModel
          ? t('sidepanel.settings.usage.share', { percent: formatPercent(mostUsedModel.share, locale) })
          : t('sidepanel.settings.usage.noModel')}
      />
      </div>
    </SettingsSection>
  );
}

function UsageFactRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="usage-fact-row">
      <div className="usage-fact-copy">
        <div className="usage-fact-label">{label}</div>
        <div className="usage-fact-detail">{detail}</div>
      </div>
      <div className="usage-fact-value">{value}</div>
    </div>
  );
}

function UsageActivity({ summary, locale }: { summary: UsageSummary; locale: string }) {
  const { t } = useI18n();
  const activeDays = summary.days
    .filter((day) => day.turnCount > 0 || day.messageCount > 0 || day.tokens > 0)
    .slice(-7)
    .reverse();

  return (
    <SettingsSection title={t('sidepanel.settings.usage.activityTitle')}>
      {activeDays.length === 0 ? (
        <div className="usage-empty-row">{t('sidepanel.settings.usage.noActiveDays')}</div>
      ) : (
        <div className="usage-row-list">
          {activeDays.map((day) => (
            <UsageFactRow
              key={day.day}
              label={formatDate(day.timestamp, locale)}
              value={formatCompactTokens(day.tokens, locale)}
              detail={t('sidepanel.settings.usage.daySummary', {
                turns: day.turnCount,
                messages: day.messageCount,
                sessions: day.sessionCount,
              })}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function UsageModels({ summary, locale }: { summary: UsageSummary; locale: string }) {
  const { t } = useI18n();

  return (
    <SettingsSection title={t('sidepanel.settings.usage.modelUsageTitle')}>
      {summary.modelUsage.length === 0 ? (
        <div className="usage-empty-row">{t('sidepanel.settings.usage.noModel')}</div>
      ) : (
        <div className="usage-model-list">
          {summary.modelUsage.map((model) => (
            <div key={model.modelKey} className="usage-model-row">
              <div className="min-w-0 flex-1">
                <div className="usage-model-name">{model.modelLabel}</div>
                <div className="usage-model-tokens">
                  {t('sidepanel.settings.usage.modelDetail', {
                    turns: model.turnCount,
                    messages: model.messageCount,
                    sessions: model.sessionCount,
                  })}
                </div>
              </div>
              <div className="usage-model-value">
                <span>{formatCompactTokens(model.totalTokens, locale)}</span>
                <span>{formatPercent(model.share, locale)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function formatInteger(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(Number.isFinite(value) ? Math.round(value) : 0);
}

function formatCompactTokens(value: number, locale: string): string {
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  return new Intl.NumberFormat(locale, {
    notation: safeValue >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(safeValue);
}

function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}
