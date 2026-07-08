import { useEffect, useState } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import type { LocaleMessageKey } from '../../../core/i18n';
import { useI18n } from '../i18n';
import WorkbenchSelect from '../components/WorkbenchSelect';
import PageIntro from '../components/PageIntro';
import AboutSubPage from '../components/settings/AboutSubPage';
import ApiSubPage from '../components/settings/ApiSubPage';
import AppearanceSubPage from '../components/settings/AppearanceSubPage';
import DataSubPage from '../components/settings/DataSubPage';
import GeneralSubPage from '../components/settings/GeneralSubPage';
import PromptSubPage from '../components/settings/PromptSubPage';
import UsageSubPage from '../components/settings/UsageSubPage';
import VoiceSubPage from '../components/settings/VoiceSubPage';
import { SkeletonList, StatusMessage } from '../components/settings/primitives';
import { useSettingsState, type SettingsLoadIssueId } from '../components/settings/useSettingsState';
import type { SettingsSubTab } from '../navigation';

const SUB_TABS: { key: SettingsSubTab; labelKey: LocaleMessageKey }[] = [
  { key: 'general', labelKey: 'sidepanel.settings.tabs.general' },
  { key: 'api', labelKey: 'sidepanel.settings.tabs.api' },
  { key: 'prompt', labelKey: 'sidepanel.settings.tabs.prompt' },
  { key: 'voice', labelKey: 'sidepanel.settings.tabs.voice' },
  { key: 'appearance', labelKey: 'sidepanel.settings.tabs.appearance' },
  { key: 'usage', labelKey: 'sidepanel.settings.tabs.usage' },
  { key: 'data', labelKey: 'sidepanel.settings.tabs.data' },
  { key: 'about', labelKey: 'sidepanel.settings.tabs.about' },
];

const SUB_DESCRIPTION_KEY: Record<SettingsSubTab, LocaleMessageKey> = {
  general: 'sidepanel.settings.generalDescription',
  api: 'sidepanel.settings.apiDescription',
  prompt: 'sidepanel.settings.promptDescription',
  voice: 'sidepanel.settings.voiceDescription',
  appearance: 'sidepanel.settings.appearanceDescription',
  usage: 'sidepanel.settings.usageDescription',
  data: 'sidepanel.settings.dataDescription',
  about: 'sidepanel.settings.aboutTagline',
};

const LOAD_ISSUE_LABEL_KEYS: Record<SettingsLoadIssueId, LocaleMessageKey> = {
  'sidepanel-chat': 'sidepanel.settings.loadIssueSidepanelChat',
  'api-key': 'sidepanel.settings.loadIssueApiKey',
  multimodal: 'sidepanel.settings.loadIssueMultimodal',
  memory: 'sidepanel.settings.loadIssueMemory',
  version: 'sidepanel.settings.loadIssueVersion',
  sync: 'sidepanel.settings.loadIssueSync',
  model: 'sidepanel.settings.loadIssueModel',
  background: 'sidepanel.settings.loadIssueBackground',
  pet: 'sidepanel.settings.loadIssuePet',
  'personal-defaults': 'sidepanel.settings.loadIssuePersonalDefaults',
};

interface SettingsPageProps {
  activeSubTab?: SettingsSubTab;
  onSubTabChange?: (subTab: SettingsSubTab) => void;
}

export default function SettingsPage({ activeSubTab, onSubTabChange }: SettingsPageProps) {
  const { t } = useI18n();
  const [sub, setSub] = useState<SettingsSubTab>(activeSubTab ?? 'general');
  const state = useSettingsState();

  useEffect(() => {
    if (activeSubTab) setSub(activeSubTab);
  }, [activeSubTab]);

  const changeSubTab = (next: SettingsSubTab) => {
    setSub(next);
    onSubTabChange?.(next);
  };
  const currentLabelKey = SUB_TABS.find((tab) => tab.key === sub)?.labelKey ?? 'sidepanel.settings.tabs.general';

  return (
    <div className="ds-settings-shell">
      <div className="ds-settings-content">
        <PageIntro
          title={t('sidepanel.settings.title')}
          description={t(SUB_DESCRIPTION_KEY[sub])}
          meta={state.version ? `v${state.version}` : undefined}
        />
        <SettingsStatusCard
          currentLabel={t(currentLabelKey)}
          loading={state.loading}
          issueCount={state.loadIssues.length}
          version={state.version}
          onRetry={() => void state.retryLoad()}
        />
        <SettingsCategoryPicker
          tabs={SUB_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }))}
          value={sub}
          label={t('sidepanel.settings.navLabel')}
          onChange={changeSubTab}
        />
        {state.loadIssues.length > 0 && (
          <StatusMessage tone="warning">
            <div className="ds-settings-load-issue">
              <div className="ds-settings-load-issue-copy">
                <div className="ds-settings-load-issue-title">
                  {t('sidepanel.settings.loadIssuesTitle')}
                </div>
                <div className="ds-settings-load-issue-description">
                  {t('sidepanel.settings.loadIssuesDescription')}
                </div>
                <div className="ds-settings-load-issue-list">
                  {state.loadIssues.slice(0, 4).map((issue) => (
                    <div key={issue.id} className="ds-settings-load-issue-row">
                      <span>{t(LOAD_ISSUE_LABEL_KEYS[issue.id])}</span>
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </StatusMessage>
        )}
        {state.loading ? (
          <SkeletonList rows={3} />
        ) : (
          <>
            {sub === 'general' && <GeneralSubPage state={state} />}
            {sub === 'api' && <ApiSubPage state={state} />}
            {sub === 'prompt' && <PromptSubPage />}
            {sub === 'voice' && <VoiceSubPage />}
            {sub === 'appearance' && <AppearanceSubPage state={state} />}
            {sub === 'usage' && <UsageSubPage />}
            {sub === 'data' && <DataSubPage state={state} />}
            {sub === 'about' && <AboutSubPage state={state} />}
          </>
        )}
      </div>
    </div>
  );
}

function SettingsStatusCard({
  currentLabel,
  loading,
  issueCount,
  version,
  onRetry,
}: {
  currentLabel: string;
  loading: boolean;
  issueCount: number;
  version: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const state = loading ? 'loading' : issueCount > 0 ? 'issue' : 'ready';
  const badgeLabel = state === 'loading'
    ? t('sidepanel.settings.statusLoading')
    : state === 'issue'
      ? t('sidepanel.settings.statusNeedsRefresh')
      : t('sidepanel.settings.statusReady');
  const description = state === 'loading'
    ? t('sidepanel.settings.statusLoadingDescription')
    : state === 'issue'
      ? t('sidepanel.settings.statusNeedsRefreshDescription', { count: issueCount })
      : t('sidepanel.settings.statusReadyDescription');
  const sourceState = state === 'loading'
    ? t('sidepanel.settings.statusSourcesChecking')
    : state === 'issue'
      ? t('sidepanel.settings.statusSourcesIssues', { count: issueCount })
      : t('sidepanel.settings.statusSourcesLoaded');
  const badgeVariant = state === 'issue' ? 'destructive' : 'secondary';

  return (
    <Card
      size="sm"
      className="ds-settings-status-card"
      data-state={state}
      aria-live="polite"
      aria-busy={loading ? true : undefined}
    >
      <CardHeader>
        <CardTitle>{t('sidepanel.settings.statusCardTitle')}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="ds-settings-status-skeleton" aria-hidden="true">
            <Skeleton className="ds-settings-status-skeleton-line" />
            <Skeleton className="ds-settings-status-skeleton-line" />
          </div>
        ) : (
          <div className="ds-settings-status-rows">
            <div className="ds-settings-status-row">
              <span>{t('sidepanel.settings.statusCurrentView')}</span>
              <strong>{currentLabel}</strong>
            </div>
            <div className="ds-settings-status-row">
              <span>{t('sidepanel.settings.statusSources')}</span>
              <strong>{sourceState}</strong>
            </div>
            {version && (
              <div className="ds-settings-status-row">
                <span>{t('sidepanel.settings.statusVersion')}</span>
                <strong>v{version}</strong>
              </div>
            )}
          </div>
        )}
        {state === 'issue' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ds-settings-status-retry"
            onClick={onRetry}
          >
            {t('common.retry')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsCategoryPicker({
  tabs,
  value,
  label,
  onChange,
}: {
  tabs: Array<{ key: SettingsSubTab; label: string }>;
  value: SettingsSubTab;
  label: string;
  onChange: (subTab: SettingsSubTab) => void;
}) {
  return (
    <WorkbenchSelect
      label={label}
      value={value}
      onChange={onChange}
      groups={[{
        key: 'settings',
        items: tabs.map((tab) => ({ value: tab.key, label: tab.label })),
      }]}
    />
  );
}
