import { useEffect, useState } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChevronRightIcon, DownloadIcon, FolderDownIcon, PlusIcon } from 'lucide-react';
import type { LocaleMessageKey, MessageParams, SupportedLocale } from '../../../core/i18n';
import type { GitHubSkillSource, GitHubSkillUpdatePreview, Skill, SkillImportSource } from '../../../core/types';
import GitHubSkillImportPanel from '../components/GitHubSkillImportPanel';
import LocalSkillImportPanel from '../components/LocalSkillImportPanel';
import PageIntro from '../components/PageIntro';
import SkillCard from '../components/SkillCard';
import SkillForm from '../components/SkillForm';
import { StatusMessage, TextField, useBanner, useConfirm } from '../components/settings/primitives';
import { requestGitHubApiPermission } from '../github-permission';
import { useI18n } from '../i18n';
import { getSafeRuntimeIssueMessage, unwrapRuntimeResponse } from '../runtime-response';

type SourceActionStatus = 'checking' | 'updating' | 'success' | 'error';
type SkillStatusFilter = 'all' | 'enabled' | 'disabled';

interface SourceActionState {
  status: SourceActionStatus;
  message: string;
  update?: GitHubSkillUpdatePreview;
}

interface SkillGroup {
  id: string;
  title: string;
  subtitle: string;
  skills: Skill[];
  githubSource?: GitHubSkillSource;
}

interface SkillOverviewCounts {
  total: number;
  enabled: number;
  disabled: number;
  githubSources: number;
  localSources: number;
}

type CommandStatusState = 'checking' | 'attention' | 'empty' | 'off' | 'ready';

function CommandsStatusCard({
  loading,
  counts,
  loadError,
  sourceLoadError,
  onRetry,
  onCreate,
}: {
  loading: boolean;
  counts: SkillOverviewCounts;
  loadError: string;
  sourceLoadError: string;
  onRetry: () => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const sourceCount = counts.githubSources + counts.localSources;
  const isChecking = loading && counts.total === 0 && !loadError;
  const hasIssue = Boolean(loadError || sourceLoadError);
  const state: CommandStatusState = isChecking
    ? 'checking'
    : hasIssue
      ? 'attention'
      : counts.total === 0
        ? 'empty'
        : counts.enabled > 0
          ? 'ready'
          : 'off';
  const badgeVariant = state === 'attention'
    ? 'destructive'
    : state === 'empty' || state === 'off'
      ? 'outline'
      : 'secondary';
  const badgeLabel = state === 'checking'
    ? t('sidepanel.skillPage.statusChecking')
    : state === 'attention'
      ? t('sidepanel.skillPage.statusNeedsRefresh')
      : state === 'empty'
        ? t('sidepanel.skillPage.statusEmpty')
        : state === 'ready'
          ? t('sidepanel.skillPage.statusReady')
          : t('sidepanel.skillPage.statusAllOff');
  const description = state === 'checking'
    ? t('sidepanel.skillPage.statusCheckingDescription')
    : state === 'attention'
      ? loadError
        ? t('sidepanel.skillPage.statusLibraryNeedsRefreshDescription')
        : t('sidepanel.skillPage.statusNeedsRefreshDescription')
      : state === 'empty'
        ? t('sidepanel.skillPage.statusEmptyDescription')
        : state === 'ready'
          ? t('sidepanel.skillPage.statusReadyDescription')
          : t('sidepanel.skillPage.statusAllOffDescription');
  const commandState = isChecking
    ? t('sidepanel.skillPage.statusCommandsChecking')
    : loadError
      ? t('sidepanel.skillPage.statusCommandsUnavailable')
      : t('sidepanel.skillPage.statusCommandsCount', { enabled: counts.enabled, total: counts.total });
  const sourceState = isChecking
    ? t('sidepanel.skillPage.statusSourcesChecking')
    : loadError
      ? t('sidepanel.skillPage.statusSourcesUnavailable')
      : sourceLoadError
        ? t('sidepanel.skillPage.statusSourcesNeedsRefresh')
        : sourceCount > 0
          ? t('sidepanel.skillPage.statusSourcesCount', { sources: sourceCount })
          : t('sidepanel.skillPage.statusSourcesNone');
  const next = loadError
    ? t('sidepanel.skillPage.statusNextRetryLibrary')
    : sourceLoadError
      ? t('sidepanel.skillPage.statusNextRetrySources')
      : state === 'empty'
        ? t('sidepanel.skillPage.statusNextCreate')
        : state === 'off'
          ? t('sidepanel.skillPage.statusNextTurnOn')
          : t('sidepanel.skillPage.statusNextUseAsk');
  const canRetry = Boolean(loadError || sourceLoadError);
  const canCreate = state === 'empty';

  return (
    <Card
      size="sm"
      className="ds-command-status-card"
      data-state={state}
      aria-live="polite"
      aria-busy={isChecking ? true : undefined}
    >
      <CardHeader>
        <CardTitle>{t('sidepanel.skillPage.statusCardTitle')}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isChecking ? (
          <div className="ds-command-status-skeleton" aria-hidden="true">
            <Skeleton className="ds-command-status-skeleton-line" />
            <Skeleton className="ds-command-status-skeleton-line" />
          </div>
        ) : (
          <div className="ds-command-status-rows">
            <div className="ds-command-status-row">
              <span>{t('sidepanel.skillPage.statusCommands')}</span>
              <strong>{commandState}</strong>
            </div>
            <div className="ds-command-status-row">
              <span>{t('sidepanel.skillPage.statusSources')}</span>
              <strong>{sourceState}</strong>
            </div>
            <div className="ds-command-status-row">
              <span>{t('sidepanel.skillPage.statusNext')}</span>
              <strong>{next}</strong>
            </div>
          </div>
        )}
      </CardContent>
      {(canRetry || canCreate) && !isChecking && (
        <CardFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ds-command-status-action"
            aria-label={canRetry ? t('common.retry') : t('sidepanel.skillPage.createCustomAction')}
            onClick={canRetry ? onRetry : onCreate}
          >
            {canRetry ? t('common.retry') : t('sidepanel.skillPage.createCustom')}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export default function SkillPage() {
  const { t, locale } = useI18n();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillSources, setSkillSources] = useState<SkillImportSource[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [importMode, setImportMode] = useState<'github' | 'local' | null>(null);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [sourceActions, setSourceActions] = useState<Record<string, SourceActionState>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<SkillStatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sourceLoadError, setSourceLoadError] = useState('');
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();
  const getCommandIssue = (
    error: unknown,
    fallback = t('sidepanel.skillPage.backendUnavailable'),
  ) => getSafeRuntimeIssueMessage(error, fallback);

  const load = async () => {
    const hadSourceLoadError = Boolean(sourceLoadError);
    setLoading(true);
    setLoadError('');
    setSourceLoadError('');
    try {
      const listResponse = await chrome.runtime.sendMessage({ type: 'GET_SKILL_LIBRARY' });
      const list = unwrapRuntimeResponse<Skill[]>(listResponse, t('sidepanel.skillPage.backendUnavailable'));
      if (!Array.isArray(list)) throw new Error(t('sidepanel.skillPage.backendUnavailable'));
      setSkills(list ?? []);

      try {
        const sourcesResponse = await chrome.runtime.sendMessage({ type: 'GET_SKILL_SOURCES' });
        const sources = unwrapRuntimeResponse<SkillImportSource[]>(sourcesResponse, t('sidepanel.skillPage.backendUnavailable'));
        if (!Array.isArray(sources)) throw new Error(t('sidepanel.skillPage.backendUnavailable'));
        const resolvedSources = sources ?? [];
        setSkillSources(resolvedSources);
        if (hadSourceLoadError) {
          const recoveredGroups = createThirdPartySkillGroups(
            list.filter((skill) => isThirdPartySkillSource(skill.source)),
            resolvedSources,
            t,
          );
          if (recoveredGroups.length > 0) {
            setExpandedGroups((current) => ({
              ...current,
              ...Object.fromEntries(recoveredGroups.map((group) => [group.id, true])),
            }));
          }
        }
      } catch (error) {
        setSkillSources([]);
        setSourceLoadError(t('sidepanel.skillPage.sourcesLoadFailed', {
          error: getCommandIssue(error),
        }));
      }
    } catch (error) {
      setLoadError(t('sidepanel.skillPage.loadFailed', {
        error: getCommandIssue(error),
      }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [locale]);

  const closeForm = () => {
    setShowForm(false);
    setEditingSkill(null);
  };

  const handleCreate = () => {
    banner.clear();
    setImportMode(null);
    setEditingSkill(null);
    setShowForm((current) => (editingSkill ? true : !current));
  };

  const handleImport = (mode: 'github' | 'local') => {
    banner.clear();
    closeForm();
    setImportMode((current) => (current === mode ? null : mode));
  };

  const handleEdit = (skill: Skill) => {
    banner.clear();
    setImportMode(null);
    setEditingSkill(skill);
    setShowForm(true);
  };

  const handleDelete = async (name: string) => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DELETE_SKILL', payload: { name } });
      unwrapRuntimeResponse(response, t('sidepanel.skillPage.backendUnavailable'));
      if (editingSkill?.name === name) closeForm();
      await load();
    } catch (error) {
      banner.show('error', t('sidepanel.skillPage.operationFailed', { error: getCommandIssue(error) }));
    }
  };

  const handleToggleEnabled = async (skill: Skill) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_SKILL_ENABLED',
        payload: { name: skill.name, enabled: skill.enabled === false },
      });
      unwrapRuntimeResponse(response, t('sidepanel.skillPage.backendUnavailable'));
      await load();
    } catch (error) {
      banner.show('error', t('sidepanel.skillPage.operationFailed', { error: getCommandIssue(error) }));
    }
  };

  const handleToggleGroupEnabled = async (group: SkillGroup) => {
    const toggleableSkills = group.skills.filter(isSkillToggleable);
    if (toggleableSkills.length === 0) return;
    const shouldEnable = !toggleableSkills.every((skill) => skill.enabled !== false);
    try {
      await Promise.all(toggleableSkills.map(async (skill) => {
        const response = await chrome.runtime.sendMessage({
          type: 'SET_SKILL_ENABLED',
          payload: { name: skill.name, enabled: shouldEnable },
        });
        unwrapRuntimeResponse(response, t('sidepanel.skillPage.backendUnavailable'));
      }));
      await load();
    } catch (error) {
      banner.show('error', t('sidepanel.skillPage.operationFailed', { error: getCommandIssue(error) }));
    }
  };

  const handleToggleGroup = (groupId: string) => {
    setExpandedGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  };

  const handleSave = async (skill: Skill) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_SKILL',
        payload: editingSkill ? { skill, previousName: editingSkill.name } : skill,
      });
      unwrapRuntimeResponse(response, t('sidepanel.skillPage.backendUnavailable'));
      closeForm();
      await load();
    } catch (error) {
      banner.show('error', t('sidepanel.skillPage.operationFailed', { error: getCommandIssue(error) }));
    }
  };

  const handleCheckSource = async (source: GitHubSkillSource) => {
    setSourceActions((current) => ({
      ...current,
      [source.id]: { status: 'checking', message: t('sidepanel.skillPage.checking') },
    }));
    try {
      const granted = await requestGitHubApiPermission();
      if (!granted) throw new Error(t('sidepanel.skillPage.checkPermissionError'));
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_GITHUB_SKILL_SOURCE_UPDATES',
        payload: { sourceId: source.id },
      });
      if (response?.ok === false) throw new Error(
        response.error === undefined ? t('sidepanel.skillPage.checkFailed') : getCommandIssue(response.error, t('sidepanel.skillPage.checkFailed')),
      );
      const update = response as GitHubSkillUpdatePreview;
      setSourceActions((current) => ({
        ...current,
        [source.id]: {
          status: 'success',
          message: formatUpdateMessage(update, t, locale),
          update,
        },
      }));
      await load();
    } catch (error) {
      setSourceActions((current) => ({
        ...current,
        [source.id]: {
          status: 'error',
          message: getCommandIssue(error, t('sidepanel.skillPage.checkFailed')),
        },
      }));
    }
  };

  const handleUpdateSource = async (source: GitHubSkillSource) => {
    setSourceActions((current) => ({
      ...current,
      [source.id]: { status: 'updating', message: t('sidepanel.skillPage.syncing') },
    }));
    try {
      const granted = await requestGitHubApiPermission();
      if (!granted) throw new Error(t('sidepanel.skillPage.syncPermissionError'));
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_GITHUB_SKILL_SOURCE',
        payload: { sourceId: source.id },
      });
      if (response?.ok === false) throw new Error(
        response.error === undefined ? t('sidepanel.skillPage.syncFailed') : getCommandIssue(response.error, t('sidepanel.skillPage.syncFailed')),
      );
      setSourceActions((current) => ({
        ...current,
        [source.id]: {
          status: 'success',
          message: t('sidepanel.skillPage.syncedSkills', {
            count: (response?.imported as Skill[] | undefined)?.length ?? source.skillPaths.length,
          }),
        },
      }));
      await load();
    } catch (error) {
      setSourceActions((current) => ({
        ...current,
        [source.id]: {
          status: 'error',
          message: getCommandIssue(error, t('sidepanel.skillPage.syncFailed')),
        },
      }));
    }
  };

  const handleDeleteSource = async (source: GitHubSkillSource) => {
    const title = t('sidepanel.skillPage.deleteSourceConfirm', {
      repository: source.repository,
      count: source.importedSkillNames.length,
    });
    const ok = await confirm({
      title,
      message: t('sidepanel.skillPage.deleteSourceConfirmMessage', {
        repository: source.repository,
        count: source.importedSkillNames.length,
      }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_GITHUB_SKILL_SOURCE',
        payload: { sourceId: source.id },
      });
      unwrapRuntimeResponse(response, t('sidepanel.skillPage.backendUnavailable'));
      setSourceActions((current) => {
        const next = { ...current };
        delete next[source.id];
        return next;
      });
      await load();
    } catch (error) {
      setSourceActions((current) => ({
        ...current,
        [source.id]: {
          status: 'error',
          message: getCommandIssue(error),
        },
      }));
    }
  };

  const visibleSkills = filterSkills(skills, searchQuery, statusFilter);
  const builtin = visibleSkills.filter((s) => s.source === 'builtin');
  const githubSources = skillSources.filter((source): source is GitHubSkillSource => source.provider === 'github');
  const localSources = skillSources.filter((source) => source.provider === 'local');
  const thirdPartyGroups = createThirdPartySkillGroups(
    visibleSkills.filter((s) => isThirdPartySkillSource(s.source)),
    skillSources,
    t,
  );
  const visibleGroupedGitHubSourceIds = new Set(thirdPartyGroups
    .map((group) => group.githubSource?.id)
    .filter((id): id is string => Boolean(id)));
  const ungroupedGitHubSources = githubSources.filter((source) => !visibleGroupedGitHubSourceIds.has(source.id));
  const custom = visibleSkills.filter((s) => s.source === 'custom');
  const builtinGroup: SkillGroup | null = builtin.length > 0
    ? {
      id: 'builtin',
      title: t('sidepanel.skillPage.sectionBuiltin'),
      subtitle: t('sidepanel.skillPage.enabledSkillCount', {
        enabled: builtin.filter((skill) => skill.enabled !== false).length,
        total: builtin.length,
      }),
      skills: builtin,
    }
    : null;
  const customGroup: SkillGroup | null = custom.length > 0
    ? {
      id: 'custom',
      title: t('sidepanel.skillPage.sectionCustom'),
      subtitle: t('sidepanel.skillPage.enabledSkillCount', {
        enabled: custom.filter((skill) => skill.enabled !== false).length,
        total: custom.length,
      }),
      skills: custom,
    }
    : null;
  const enabledCount = skills.filter((s) => s.enabled !== false).length;
  const overviewCounts: SkillOverviewCounts = {
    total: skills.length,
    enabled: enabledCount,
    disabled: skills.length - enabledCount,
    githubSources: githubSources.length,
    localSources: localSources.length,
  };
  const hasVisibleSkills = Boolean(builtinGroup || customGroup || thirdPartyGroups.length > 0);
  const isFilteredView = searchQuery.trim().length > 0 || statusFilter !== 'all';
  const isInitialLoading = loading && skills.length === 0 && !loadError;

  return (
    <div className="ds-page ds-skill-page">
      <PageIntro
        title={t('sidepanel.skillPage.title')}
        description={t('sidepanel.skillPage.description')}
      />

      <CommandsStatusCard
        loading={loading}
        counts={overviewCounts}
        loadError={loadError}
        sourceLoadError={sourceLoadError}
        onRetry={() => { void load(); }}
        onCreate={handleCreate}
      />

      {confirmNode}
      {banner.node}

      {isInitialLoading ? (
        <div className="ds-skill-loading" role="status">
          {t('sidepanel.skillPage.loading')}
        </div>
      ) : (
        <>
          {loadError && (
            <StatusMessage tone="error">
              <div className="font-medium">{t('sidepanel.skillPage.loadFailedTitle')}</div>
              <div>{loadError}</div>
              <div className="mt-1.5">{t('sidepanel.skillPage.loadFailedHint')}</div>
            </StatusMessage>
          )}

          {sourceLoadError && !loadError && (
            <StatusMessage tone="error">
              <div className="font-medium">{t('sidepanel.skillPage.sourcesLoadFailedTitle')}</div>
              <div>{sourceLoadError}</div>
              <div className="mt-1.5">{t('sidepanel.skillPage.sourcesLoadFailedHint')}</div>
            </StatusMessage>
          )}

          {!loadError && (
            <>
              <SkillOverviewPanel
                counts={overviewCounts}
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                onSearchChange={setSearchQuery}
                onStatusFilterChange={setStatusFilter}
                onImportGitHub={() => handleImport('github')}
                onImportLocal={() => handleImport('local')}
                onCreateCustom={handleCreate}
              />

              {importMode === 'github' && (
                <GitHubSkillImportPanel onImported={load} onCancel={() => setImportMode(null)} />
              )}

              {importMode === 'local' && (
                <LocalSkillImportPanel onImported={load} onCancel={() => setImportMode(null)} />
              )}

              {showForm && (
                <SkillForm initialSkill={editingSkill} onSave={handleSave} onCancel={closeForm} />
              )}

              {customGroup && (
                <SkillGroupsPanel
                  groups={[customGroup]}
                  filtered={isFilteredView}
                  defaultExpanded
                  expandedGroups={expandedGroups}
                  onToggleGroup={handleToggleGroup}
                  onToggleGroupEnabled={handleToggleGroupEnabled}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onToggleEnabled={handleToggleEnabled}
                />
              )}
              <SkillGroupsPanel
                sectionLabel={t('sidepanel.skillPage.sectionThirdParty')}
                groups={thirdPartyGroups}
                filtered={isFilteredView}
                defaultExpanded={Boolean(sourceLoadError)}
                expandedGroups={expandedGroups}
                sourceActions={sourceActions}
                onToggleGroup={handleToggleGroup}
                onToggleGroupEnabled={handleToggleGroupEnabled}
                onCheckSource={handleCheckSource}
                onUpdateSource={handleUpdateSource}
                onDeleteSource={handleDeleteSource}
                onDelete={handleDelete}
                onToggleEnabled={handleToggleEnabled}
              />
              {builtinGroup && (
                <SkillGroupsPanel
                  groups={[builtinGroup]}
                  filtered={isFilteredView}
                  expandedGroups={expandedGroups}
                  onToggleGroup={handleToggleGroup}
                  onToggleGroupEnabled={handleToggleGroupEnabled}
                  onToggleEnabled={handleToggleEnabled}
                />
              )}

              {!hasVisibleSkills && (
                <div className="ds-skill-empty-state">
                  <strong>
                    {t(isFilteredView ? 'sidepanel.skillPage.emptyFiltered' : 'sidepanel.skillPage.emptyLibrary')}
                  </strong>
                </div>
              )}

              {ungroupedGitHubSources.length > 0 && (
                <UngroupedGitHubSourceSection
                  sources={ungroupedGitHubSources}
                  actions={sourceActions}
                  onCheck={handleCheckSource}
                  onUpdate={handleUpdateSource}
                  onDelete={handleDeleteSource}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SkillOverviewPanel({
  counts,
  searchQuery,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onImportGitHub,
  onImportLocal,
  onCreateCustom,
}: {
  counts: SkillOverviewCounts;
  searchQuery: string;
  statusFilter: SkillStatusFilter;
  onSearchChange: (query: string) => void;
  onStatusFilterChange: (filter: SkillStatusFilter) => void;
  onImportGitHub: () => void;
  onImportLocal: () => void;
  onCreateCustom: () => void;
}) {
  const { t } = useI18n();
  const hasExternalSources = counts.githubSources + counts.localSources > 0;
  const sourceSummary = hasExternalSources
    ? t('sidepanel.skillPage.sourceSummary', {
      disabled: counts.disabled,
      sources: counts.githubSources + counts.localSources,
    })
    : t('sidepanel.skillPage.sourceEmptySummary', { disabled: counts.disabled });
  const filters: { id: SkillStatusFilter; label: string }[] = [
    { id: 'all', label: t('sidepanel.skillPage.filterAll') },
    { id: 'enabled', label: t('sidepanel.skillPage.filterEnabled') },
    { id: 'disabled', label: t('sidepanel.skillPage.filterDisabled') },
  ];

  return (
    <section className="ds-skill-overview" aria-label={t('sidepanel.skillPage.libraryOverview')}>
      <div className="ds-skill-controls">
        <TextField
          value={searchQuery}
          onChange={onSearchChange}
          placeholder={t('sidepanel.skillPage.searchPlaceholder')}
          ariaLabel={t('common.search')}
          fieldClassName="ds-skill-search"
          inputClassName="ds-skill-search-input"
        />
        <ToggleGroup
          type="single"
          value={statusFilter}
          onValueChange={(value) => {
            if (value) onStatusFilterChange(value as SkillStatusFilter);
          }}
          className="ds-skill-filter-row"
          aria-label={t('sidepanel.skillPage.filterLabel')}
          variant="outline"
          size="sm"
          spacing={0}
        >
          {filters.map((filter) => (
            <ToggleGroupItem
              key={filter.id}
              value={filter.id}
              data-active={statusFilter === filter.id}
              aria-pressed={statusFilter === filter.id}
              aria-label={filter.label}
            >
              {filter.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="ds-skill-overview-head">
        <div className="ds-skill-overview-copy" aria-live="polite">
          <span>{t('sidepanel.skillPage.summary', { total: counts.total, enabled: counts.enabled })}</span>
          <span aria-hidden="true">·</span>
          <span>{sourceSummary}</span>
        </div>
        <div className="ds-skill-action-row" aria-label={t('sidepanel.skillPage.addSkills')}>
          <Button
            type="button"
            onClick={onImportGitHub}
            aria-label={t('sidepanel.skillPage.importGithubAction')}
            variant="outline"
            size="sm"
            className="ds-skill-add-button"
          >
            <DownloadIcon data-icon="inline-start" aria-hidden="true" />
            {t('sidepanel.skillPage.importGithub')}
          </Button>
          <Button
            type="button"
            onClick={onImportLocal}
            aria-label={t('sidepanel.skillPage.importLocalAction')}
            variant="outline"
            size="sm"
            className="ds-skill-add-button"
          >
            <FolderDownIcon data-icon="inline-start" aria-hidden="true" />
            {t('sidepanel.skillPage.importLocal')}
          </Button>
          <Button
            type="button"
            onClick={onCreateCustom}
            aria-label={t('sidepanel.skillPage.createCustomAction')}
            variant="default"
            size="sm"
            className="ds-skill-add-button"
          >
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            {t('sidepanel.skillPage.createCustom')}
          </Button>
        </div>
      </div>
    </section>
  );
}

function SkillGroupsPanel({
  sectionLabel,
  groups,
  filtered,
  defaultExpanded = false,
  expandedGroups,
  sourceActions = {},
  onToggleGroup,
  onToggleGroupEnabled,
  onCheckSource,
  onUpdateSource,
  onDeleteSource,
  onEdit,
  onDelete,
  onToggleEnabled,
}: {
  sectionLabel?: string;
  groups: SkillGroup[];
  filtered: boolean;
  defaultExpanded?: boolean;
  expandedGroups: Record<string, boolean>;
  sourceActions?: Record<string, SourceActionState>;
  onToggleGroup: (groupId: string) => void;
  onToggleGroupEnabled: (group: SkillGroup) => void;
  onCheckSource?: (source: GitHubSkillSource) => void;
  onUpdateSource?: (source: GitHubSkillSource) => void;
  onDeleteSource?: (source: GitHubSkillSource) => void;
  onEdit?: (skill: Skill) => void;
  onDelete?: (name: string) => void;
  onToggleEnabled: (skill: Skill) => void;
}) {
  const { t } = useI18n();
  if (groups.length === 0) return null;

  return (
    <section className="ds-section">
      {sectionLabel && (
        <h3 className="ds-skill-section-label">
          {sectionLabel}
        </h3>
      )}
      {groups.map((group) => {
        const expanded = filtered || expandedGroups[group.id] === true || (expandedGroups[group.id] === undefined && defaultExpanded);
        const toggleableSkills = group.skills.filter(isSkillToggleable);
        const canToggleGroup = toggleableSkills.length > 0;
        const allEnabled = canToggleGroup && toggleableSkills.every((skill) => skill.enabled !== false);
        const groupState = formatGroupState(group, t);
        const githubSource = group.githubSource;
        const groupSubtitle = group.id === 'builtin' || group.id === 'custom'
          ? groupState
          : `${groupState} · ${group.subtitle}`;
        const toggleAllLabel = allEnabled
          ? t(filtered ? 'sidepanel.skillPage.disableVisibleSkills' : 'sidepanel.skillPage.disableSourceSkills')
          : t(filtered ? 'sidepanel.skillPage.enableVisibleSkills' : 'sidepanel.skillPage.enableSourceSkills');
        const toggleAllAriaLabel = allEnabled
          ? t(filtered ? 'sidepanel.skillPage.disableVisibleSkillsFor' : 'sidepanel.skillPage.disableSourceSkillsFor', {
            source: group.title,
          })
          : t(filtered ? 'sidepanel.skillPage.enableVisibleSkillsFor' : 'sidepanel.skillPage.enableSourceSkillsFor', {
            source: group.title,
          });

        return (
          <div key={group.id} className="ds-command-group">
            <div className="ds-command-group-header">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                aria-label={expanded
                  ? t('sidepanel.skillPage.collapseSource', { source: group.title })
                  : t('sidepanel.skillPage.expandSource', { source: group.title })}
                onClick={() => onToggleGroup(group.id)}
                className="ds-command-group-toggle"
              >
                <ChevronRightIcon
                  className={`ds-command-group-chevron ${expanded ? 'ds-command-group-chevron-open' : ''}`}
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                <span className="ds-command-group-copy">
                  <span className="ds-command-group-title">
                    {group.title}
                  </span>
                  <span className="ds-command-group-state">
                    {groupSubtitle}
                  </span>
                </span>
              </Button>
              {canToggleGroup && (
                <Button
                  type="button"
                  variant={allEnabled ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={() => onToggleGroupEnabled(group)}
                  aria-label={toggleAllAriaLabel}
                  title={filtered ? t('sidepanel.skillPage.visibleOnlyHint') : undefined}
                  data-action={allEnabled ? 'off' : 'on'}
                  className="ds-btn-secondary ds-command-group-action"
                >
                  {toggleAllLabel}
                </Button>
              )}
            </div>
            {expanded && (
              <div
                className="ds-skill-list"
              >
                {githubSource && onCheckSource && onUpdateSource && onDeleteSource && (
                  <GitHubSourceControls
                    source={githubSource}
                    action={sourceActions[githubSource.id]}
                    onCheck={() => onCheckSource(githubSource)}
                    onUpdate={() => onUpdateSource(githubSource)}
                    onDelete={() => onDeleteSource(githubSource)}
                  />
                )}
                {group.skills.map((skill) => (
                  <SkillCard
                    key={skill.name}
                    skill={skill}
                    showSourceBadge={false}
                    onEdit={onEdit && skill.source === 'custom' ? () => onEdit(skill) : undefined}
                    onDelete={
                      onDelete && (skill.source === 'custom' || skill.source === 'remote')
                        ? () => onDelete(skill.name)
                        : undefined
                    }
                    onToggleEnabled={isSkillToggleable(skill) ? () => onToggleEnabled(skill) : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function UngroupedGitHubSourceSection({ sources, actions, onCheck, onUpdate, onDelete }: {
  sources: GitHubSkillSource[];
  actions: Record<string, SourceActionState>;
  onCheck: (source: GitHubSkillSource) => void;
  onUpdate: (source: GitHubSkillSource) => void;
  onDelete: (source: GitHubSkillSource) => void;
}) {
  const { t } = useI18n();

  return (
    <section className="ds-section">
      <h3 className="ds-skill-section-label">
        {t('sidepanel.skillPage.githubSourceTitle')}
      </h3>
      {sources.map((source) => (
        <div key={source.id} className="ds-command-group ds-source-orphan">
          <GitHubSourceControls
            source={source}
            action={actions[source.id]}
            onCheck={() => onCheck(source)}
            onUpdate={() => onUpdate(source)}
            onDelete={() => onDelete(source)}
          />
        </div>
      ))}
    </section>
  );
}

function GitHubSourceControls({ source, action, onCheck, onUpdate, onDelete }: {
  source: GitHubSkillSource;
  action?: SourceActionState;
  onCheck: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();
  const busy = action?.status === 'checking' || action?.status === 'updating';
  const sourceLabel = source.repository;
  const metadata = [
    t('sidepanel.skillPage.skillCount', { count: source.importedSkillNames.length }),
    source.licenseSpdxId ?? source.licenseName ?? t('sidepanel.skillPage.unknownLicense'),
    source.packageVersion ? `v${source.packageVersion}` : null,
    t('sidepanel.skillPage.syncedAt', { time: formatTime(source.updatedAt, locale) }),
    source.lastCheckedAt ? t('sidepanel.skillPage.checkedAt', { time: formatTime(source.lastCheckedAt, locale) }) : null,
  ].filter((item): item is string => Boolean(item));
  const actionTone = getSourceActionTone(action);

  return (
    <div className="ds-source-inline">
      <div className="ds-source-header">
        <div className="min-w-0">
          <div className="text-xs font-semibold truncate" style={{ color: 'var(--ds-text)' }}>
            {source.repository}
          </div>
          <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
            {source.rootPath || t('sidepanel.skillPage.repoRoot')} · {source.ref} · {shortSha(source.commitSha)}
          </div>
        </div>
        <div className="ds-source-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCheck}
            disabled={busy}
            aria-label={t('sidepanel.skillPage.checkSource', { source: sourceLabel })}
            className="ds-source-action"
          >
            {t('sidepanel.skillPage.check')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onUpdate}
            disabled={busy}
            aria-label={t('sidepanel.skillPage.syncSource', { source: sourceLabel })}
            className="ds-source-action"
          >
            {t('sidepanel.skillPage.sync')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={busy}
            aria-label={t('sidepanel.skillPage.removeSource', { source: sourceLabel })}
            className="ds-source-action ds-source-action-delete"
          >
            {t('sidepanel.skillPage.remove')}
          </Button>
        </div>
      </div>

      <div className="ds-source-meta-line" aria-label={t('sidepanel.skillPage.sourceMetadata')}>
        {metadata.join(' · ')}
      </div>

      {action && (
        <div
          className="ds-source-action-message"
          data-tone={actionTone}
          role={actionTone === 'danger' ? 'alert' : 'status'}
        >
          {busy && <span className="inline-block w-3 h-3 mr-1.5 border-2 border-current border-t-transparent rounded-full animate-spin align-[-2px]" />}
          {action.message}
        </div>
      )}
    </div>
  );
}

function formatGroupState(
  group: SkillGroup,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  const enabled = group.skills.filter((skill) => skill.enabled !== false).length;
  if (enabled === group.skills.length) return t('sidepanel.skillPage.groupAllEnabled');
  if (enabled === 0) return t('sidepanel.skillPage.groupAllDisabled');
  return t('sidepanel.skillPage.enabledSkillCount', { enabled, total: group.skills.length });
}

function getSourceActionTone(action?: SourceActionState): 'neutral' | 'attention' | 'danger' {
  if (!action) return 'neutral';
  if (action.status === 'error') return 'danger';
  if (action.update?.hasUpdates) return 'attention';
  return 'neutral';
}

function createThirdPartySkillGroups(
  skills: Skill[],
  sources: SkillImportSource[],
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): SkillGroup[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const groups = new Map<string, SkillGroup>();

  for (const skill of skills) {
    const descriptor = getThirdPartyGroupDescriptor(skill, sourceById, t);
    const group = groups.get(descriptor.id);
    if (group) {
      group.skills.push(skill);
    } else {
      groups.set(descriptor.id, {
        ...descriptor,
        skills: [skill],
      });
    }
  }

  return [...groups.values()];
}

function getThirdPartyGroupDescriptor(
  skill: Skill,
  sourceById: Map<string, SkillImportSource>,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): Omit<SkillGroup, 'skills'> {
  if (skill.source === 'remote') {
    const source = skill.remote?.sourceId ? sourceById.get(skill.remote.sourceId) : undefined;
    if (skill.remote?.provider === 'local') {
      const localSource = source?.provider === 'local' ? source : undefined;
      const title = localSource?.displayName ?? skill.remote.localDisplayName ?? t('sidepanel.skill.sources.local');
      const localPath = localSource?.rootPath ?? skill.remote.localRootPath ?? skill.remote.localDirectory;
      return {
        id: `local:${localSource?.id ?? skill.remote.sourceId ?? title}`,
        title,
        subtitle: localPath ?? t('sidepanel.skillPage.localReferencedSource'),
      };
    }

    const githubSource = source?.provider === 'github' ? source : undefined;
    const title = githubSource?.repository ?? skill.remote?.repository ?? 'GitHub';
    const rootPath = githubSource?.rootPath ?? '';
    const ref = githubSource?.ref ?? skill.remote?.ref;
    return {
      id: `github:${githubSource?.id ?? skill.remote?.sourceId ?? title}`,
      title,
      subtitle: [
        rootPath || t('sidepanel.skillPage.repoRoot'),
        ref,
      ].filter(Boolean).join(' · '),
      githubSource,
    };
  }

  const provider = skill.metadata?.provider ?? t('sidepanel.skillPage.unknownThirdPartySource');
  return {
    id: `bundled:${provider}`,
    title: provider,
    subtitle: t('sidepanel.skillPage.bundledThirdPartySource'),
  };
}

function isThirdPartySkillSource(source: Skill['source']): boolean {
  return source === 'third-party' || source === 'official' || source === 'remote';
}

function isSkillToggleable(skill: Skill): boolean {
  return skill.source !== 'builtin';
}

function filterSkills(skills: Skill[], query: string, status: SkillStatusFilter): Skill[] {
  const normalizedQuery = query.trim().toLowerCase();
  return skills.filter((skill) => {
    const enabled = skill.enabled !== false;
    if (status === 'enabled' && !enabled) return false;
    if (status === 'disabled' && enabled) return false;
    if (!normalizedQuery) return true;

    const haystack = [
      skill.name,
      typeof skill.description === 'string' ? skill.description : '',
      skill.source,
      skill.remote?.repository,
      skill.remote?.path,
      skill.remote?.localDisplayName,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function formatUpdateMessage(
  update: GitHubSkillUpdatePreview,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
  locale: SupportedLocale,
): string {
  if (!update.hasUpdates) return t('sidepanel.skillPage.noUpdates');
  const parts: string[] = [];
  if (update.changedPaths.length > 0) {
    parts.push(t('sidepanel.skillPage.changedUpdates', { count: update.changedPaths.length }));
  }
  if (update.newPaths.length > 0) {
    parts.push(t('sidepanel.skillPage.newSkills', { count: update.newPaths.length }));
  }
  if (update.missingPaths.length > 0) {
    parts.push(t('sidepanel.skillPage.missingSkills', { count: update.missingPaths.length }));
  }
  const separator = locale === 'zh-CN' ? '，' : ', ';
  return parts.join(separator) || t('sidepanel.skillPage.updatesFound');
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function formatTime(timestamp: number, locale: SupportedLocale): string {
  return new Date(timestamp).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
