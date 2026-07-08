import { useEffect, useMemo, useState } from 'react';
import type {
  Memory,
  ProjectContextState,
  SavedItem,
  SystemPromptPreset,
} from '../../../core/types';
import type { OperationalProjectSource } from '../../../core/operational-context';
import { PROJECT_CONTEXT_SCHEMA_VERSION } from '../../../core/project';
import { normalizePromptInjectionSettings, type PromptInjectionSettings } from '../../../core/prompt/settings';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import PageIntro from '../components/PageIntro';
import { SkeletonList, useBanner } from '../components/settings/primitives';
import { MEMORY_TYPE_CONFIG } from '../constants';
import { useGlobalOperationalContext } from '../global-operational-context';
import { useI18n } from '../i18n';
import type { SidepanelNavigationTarget } from '../navigation';
import { getRuntimeErrorMessage } from '../runtime-response';

interface PersonalIntelligencePageProps {
  onNavigate: (target: SidepanelNavigationTarget) => void;
}

interface IntelligenceState {
  memories: Memory[];
  savedItems: SavedItem[];
  projectState: ProjectContextState | null;
  activePreset: SystemPromptPreset | null;
  promptSettings: PromptInjectionSettings | null;
}

interface SourceIssue {
  id: string;
  label: string;
  message: string;
}

const EMPTY_STATE: IntelligenceState = {
  memories: [],
  savedItems: [],
  projectState: null,
  activePreset: null,
  promptSettings: null,
};

type Translate = ReturnType<typeof useI18n>['t'];

interface IntelligenceAction {
  label: string;
  target: SidepanelNavigationTarget;
}

interface UsingNowRow {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone?: 'normal' | 'disabled' | 'attention';
}

interface RecordGroupData {
  id: string;
  title: string;
  action?: IntelligenceAction;
  items: { id: string; title: string; detail: string }[];
}

type ContextStatusTone = 'ready' | 'attention';
type ContextFactTone = 'normal' | 'muted' | 'attention';

export default function PersonalIntelligencePage({ onNavigate }: PersonalIntelligencePageProps) {
  const { t } = useI18n();
  const { context } = useGlobalOperationalContext();
  const [state, setState] = useState<IntelligenceState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [sourceIssues, setSourceIssues] = useState<SourceIssue[]>([]);
  const banner = useBanner();

  const load = async () => {
    const [
      memoriesResult,
      savedItemsResult,
      projectStateResult,
      activePresetResult,
      promptSettingsResult,
    ] = await Promise.allSettled([
      chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }),
      chrome.runtime.sendMessage({ type: 'GET_SAVED_ITEMS' }),
      chrome.runtime.sendMessage({ type: 'GET_PROJECT_CONTEXT_STATE' }),
      chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PRESET' }),
      chrome.runtime.sendMessage({ type: 'GET_PROMPT_INJECTION_SETTINGS' }),
    ]);
    const issues: SourceIssue[] = [];

    try {
      const memories = readArraySource<Memory>(
        memoriesResult,
        'memory',
        t('sidepanel.personalIntelligencePage.sourceMemory'),
        issues,
        t,
      );
      const savedItems = readArraySource<SavedItem>(
        savedItemsResult,
        'saved',
        t('sidepanel.personalIntelligencePage.sourceSaved'),
        issues,
        t,
      );
      const projectState = readObjectSource<ProjectContextState>(
        projectStateResult,
        'projects',
        t('sidepanel.personalIntelligencePage.sourceProjects'),
        isProjectContextState,
        issues,
        t,
      );
      const activePreset = readOptionalObjectSource<SystemPromptPreset>(
        activePresetResult,
        'preset',
        t('sidepanel.personalIntelligencePage.sourcePreset'),
        isSystemPromptPreset,
        issues,
        t,
      );
      const promptSettings = readOptionalObjectSource<PromptInjectionSettings>(
        promptSettingsResult,
        'prompt',
        t('sidepanel.personalIntelligencePage.sourcePromptSettings'),
        isPromptInjectionSettingsSource,
        issues,
        t,
      );
      setState({
        memories,
        savedItems,
        projectState,
        activePreset,
        promptSettings: promptSettings ? normalizePromptInjectionSettings(promptSettings) : null,
      });
      setSourceIssues(issues);
      if (issues.length > 0) {
        banner.show('error', t('sidepanel.personalIntelligencePage.sourcesLoadFailed', { count: issues.length }));
      } else {
        banner.clear();
      }
    } catch (error) {
      banner.show('error', error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const refresh = (message?: { type?: string }) => {
      if (!message?.type || [
        'STATE_UPDATED',
        'SAVED_ITEMS_UPDATED',
        'PROJECT_CONTEXT_UPDATED',
      ].includes(message.type)) {
        void load();
      }
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) void load();
    };

    chrome.runtime.onMessage.addListener(refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      chrome.runtime.onMessage.removeListener(refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, []);

  const pinnedMemories = useMemo(
    () => [...state.memories]
      .filter((memory) => memory.pinned)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 4),
    [state.memories],
  );
  const recentSavedItems = useMemo(
    () => [...state.savedItems].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4),
    [state.savedItems],
  );
  const recentProjects = useMemo(
    () => [...(state.projectState?.projects ?? [])]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 4),
    [state.projectState],
  );

  const activeProject = context.project.name;
  const hasPinnedMemories = pinnedMemories.length > 0;
  const hasSavedItems = recentSavedItems.length > 0;
  const hasProjects = recentProjects.length > 0;
  const hasContextRecords = hasPinnedMemories || hasSavedItems || hasProjects;
  const hasSourceIssues = sourceIssues.length > 0;
  const memoryStatus = getMemoryStatus(state.promptSettings, t);
  const usingNowRows: UsingNowRow[] = [
    {
      id: 'project',
      label: t('sidepanel.personalIntelligencePage.currentProject'),
      value: activeProject ?? t('sidepanel.personalIntelligencePage.noCurrentProject'),
      detail: activeProject
        ? getProjectSourceDetail(context.project.source, t)
        : t('sidepanel.personalIntelligencePage.noCurrentProjectDetail'),
    },
    {
      id: 'preset',
      label: t('sidepanel.personalIntelligencePage.activePreset'),
      value: state.activePreset?.name ?? t('sidepanel.personalIntelligencePage.noActivePreset'),
      detail: state.activePreset
        ? t('sidepanel.personalIntelligencePage.activePresetDetail')
        : t('sidepanel.personalIntelligencePage.noActivePresetDetail'),
    },
    {
      id: 'memory',
      label: t('sidepanel.personalIntelligencePage.memoryInjection'),
      value: memoryStatus.label,
      detail: memoryStatus.detail,
      tone: memoryStatus.tone,
    },
  ];
  const usingActions: IntelligenceAction[] = [
    {
      label: t('sidepanel.personalIntelligencePage.manageProjects'),
      target: { tab: 'projects' },
    },
    {
      label: t('app.sidebarV2.presets'),
      target: { tab: 'capabilities', capabilitiesSubTab: 'preset' },
    },
    {
      label: memoryStatus.actionLabel,
      target: memoryStatus.actionTarget,
    },
  ];

  const rememberedGroups: RecordGroupData[] = [];
  if (hasPinnedMemories) {
    rememberedGroups.push({
      id: 'memory',
      title: t('sidepanel.personalIntelligencePage.pinnedMemoryTitle'),
      action: {
        label: t('sidepanel.personalIntelligencePage.manageMemory'),
        target: { tab: 'library', librarySubTab: 'memory' },
      },
      items: pinnedMemories.map((memory) => ({
        id: String(memory.id ?? memory.syncId),
        title: memory.name,
        detail: formatMemoryDetail(memory, t),
      })),
    });
  }
  if (hasSavedItems) {
    rememberedGroups.push({
      id: 'saved',
      title: t('sidepanel.personalIntelligencePage.savedItemsTitle'),
      action: {
        label: t('sidepanel.personalIntelligencePage.manageSavedItems'),
        target: { tab: 'library', librarySubTab: 'saved' },
      },
      items: recentSavedItems.map((item) => ({
        id: item.id,
        title: item.title,
        detail: formatSavedItemDetail(item, t),
      })),
    });
  }
  if (hasProjects) {
    rememberedGroups.push({
      id: 'projects',
      title: t('sidepanel.personalIntelligencePage.recentProjectsTitle'),
      items: recentProjects.map((project) => ({
        id: project.id,
        title: project.name,
        detail: formatProjectDetail(project, t),
      })),
    });
  }
  const contextStatus = createContextStatus({
    activeProject,
    hasPreset: Boolean(state.activePreset),
    memoryStatus,
    hasContextRecords,
    hasPinnedMemories,
    hasSavedItems,
    hasProjects,
    hasSourceIssues,
    usingActions,
    t,
  });
  const secondaryUsingActions = contextStatus.action
    ? usingActions.filter((action) => !isSameIntelligenceAction(action, contextStatus.action!))
    : usingActions;

  return (
    <div className="ds-page ds-intel-page">
      <PageIntro
        title={t('sidepanel.personalIntelligencePage.title')}
        description={t('sidepanel.personalIntelligencePage.description')}
        actions={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="ds-btn-secondary ds-intel-button"
          >
            {t('common.refresh')}
          </Button>
        )}
      />

      {banner.node}

      {loading ? (
        <SkeletonList rows={5} />
      ) : (
        <>
          <section className={`ds-intel-readiness ds-intel-readiness-${contextStatus.tone}`}>
            <div className="ds-intel-readiness-head">
              <h3>{t('sidepanel.personalIntelligencePage.contextStatusTitle')}</h3>
              <Badge
                variant={contextStatus.tone === 'ready' ? 'secondary' : 'outline'}
                className={`ds-intel-readiness-badge ds-intel-readiness-badge-${contextStatus.tone}`}
              >
                {contextStatus.status}
              </Badge>
            </div>
            <p>{contextStatus.description}</p>
            <div className="ds-intel-status-list">
              <ContextStatusRow
                label={t('sidepanel.personalIntelligencePage.contextStatusProject')}
                value={contextStatus.project}
                tone={contextStatus.projectTone}
              />
              <ContextStatusRow
                label={t('sidepanel.personalIntelligencePage.contextStatusMemory')}
                value={contextStatus.memory}
                tone={contextStatus.memoryTone}
              />
              <ContextStatusRow
                label={t('sidepanel.personalIntelligencePage.contextStatusSaved')}
                value={contextStatus.saved}
                tone={contextStatus.savedTone}
              />
              <ContextStatusRow
                label={t('sidepanel.personalIntelligencePage.contextStatusNext')}
                value={contextStatus.next}
                tone={contextStatus.nextTone}
              />
            </div>
            <div className="ds-intel-readiness-actions">
              {hasSourceIssues ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ds-btn-secondary ds-intel-button"
                  onClick={() => void load()}
                >
                  {t('common.retry')}
                </Button>
              ) : contextStatus.action && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ds-btn-secondary ds-intel-button"
                  onClick={() => onNavigate(contextStatus.action!.target)}
                >
                  {contextStatus.action.label}
                </Button>
              )}
            </div>
          </section>

          {hasSourceIssues && (
            <Alert className="ds-intel-section ds-intel-source-issues" aria-label={t('sidepanel.personalIntelligencePage.sourcesNeedRefreshTitle')}>
              <AlertTitle className="ds-intel-source-title">
                {t('sidepanel.personalIntelligencePage.sourcesNeedRefreshTitle')}
              </AlertTitle>
              <AlertDescription className="ds-intel-source-description">
                <p>{t('sidepanel.personalIntelligencePage.sourcesNeedRefreshDescription')}</p>
                <div className="ds-intel-source-list">
                  {sourceIssues.map((issue) => (
                    <div key={issue.id} className="ds-intel-source-issue-row">
                      <strong>{issue.label}</strong>
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              </AlertDescription>
              <AlertAction className="ds-intel-source-action">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ds-btn-secondary ds-intel-button"
                  onClick={() => void load()}
                >
                  {t('common.retry')}
                </Button>
              </AlertAction>
            </Alert>
          )}

          <section className="ds-intel-section ds-intel-current">
            <div className="ds-intel-section-header">
              <div>
                <h3>{t('sidepanel.personalIntelligencePage.currentContext')}</h3>
                <p>{t('sidepanel.personalIntelligencePage.currentContextDescription')}</p>
              </div>
            </div>
            {usingNowRows.map((row) => (
              <ContextRow
                key={row.id}
                label={row.label}
                value={row.value}
                detail={row.detail}
                tone={row.tone}
              />
            ))}
            <div className="ds-intel-action-row">
              {secondaryUsingActions.map((action) => (
                <Button
                  key={`${action.target.tab}-${action.label}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ds-btn-secondary ds-intel-button"
                  onClick={() => onNavigate(action.target)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </section>

          {!hasContextRecords && !hasSourceIssues && (
            <Empty className="ds-intel-section ds-intel-empty-state">
              <EmptyHeader className="ds-intel-empty-header">
                <EmptyTitle>{t('sidepanel.personalIntelligencePage.emptyContextTitle')}</EmptyTitle>
                <EmptyDescription>{t('sidepanel.personalIntelligencePage.emptyContextDescription')}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="ds-intel-actions">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ds-btn-secondary ds-intel-button"
                  onClick={() => onNavigate({ tab: 'library', librarySubTab: 'memory' })}
                >
                  {t('sidepanel.personalIntelligencePage.manageMemory')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ds-btn-secondary ds-intel-button"
                  onClick={() => onNavigate({ tab: 'library', librarySubTab: 'saved' })}
                >
                  {t('sidepanel.personalIntelligencePage.manageSavedItems')}
                </Button>
              </EmptyContent>
            </Empty>
          )}

          {hasContextRecords && rememberedGroups.map((group) => (
            <RecordGroup
              key={group.id}
              title={group.title}
              action={group.action}
              items={group.items}
              onNavigate={onNavigate}
            />
          ))}
        </>
      )}
    </div>
  );
}

function ContextRow({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'normal' | 'disabled' | 'attention';
}) {
  return (
    <div className="ds-intel-row ds-intel-context-row">
      <span className="ds-intel-row-label">{label}</span>
      <div className="ds-intel-row-main">
        <strong data-tone={tone ?? 'normal'}>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

interface ContextStatusModel {
  tone: ContextStatusTone;
  status: string;
  description: string;
  project: string;
  projectTone: ContextFactTone;
  memory: string;
  memoryTone: ContextFactTone;
  saved: string;
  savedTone: ContextFactTone;
  next: string;
  nextTone: ContextFactTone;
  action: IntelligenceAction | null;
}

function createContextStatus({
  activeProject,
  hasPreset,
  memoryStatus,
  hasContextRecords,
  hasPinnedMemories,
  hasSavedItems,
  hasProjects,
  hasSourceIssues,
  usingActions,
  t,
}: {
  activeProject: string | null;
  hasPreset: boolean;
  memoryStatus: ReturnType<typeof getMemoryStatus>;
  hasContextRecords: boolean;
  hasPinnedMemories: boolean;
  hasSavedItems: boolean;
  hasProjects: boolean;
  hasSourceIssues: boolean;
  usingActions: IntelligenceAction[];
  t: Translate;
}): ContextStatusModel {
  const hasActiveProject = Boolean(activeProject);
  const project = activeProject ?? t('sidepanel.personalIntelligencePage.noCurrentProject');
  const savedParts = [
    hasPinnedMemories ? t('sidepanel.personalIntelligencePage.contextStatusHasMemory') : null,
    hasSavedItems ? t('sidepanel.personalIntelligencePage.contextStatusHasSaved') : null,
    hasProjects ? t('sidepanel.personalIntelligencePage.contextStatusHasProjects') : null,
    hasPreset ? t('sidepanel.personalIntelligencePage.contextStatusHasPreset') : null,
  ].filter(Boolean);
  const saved = savedParts.length > 0
    ? savedParts.join(' · ')
    : hasSourceIssues
      ? t('sidepanel.personalIntelligencePage.contextStatusSourcesUnknown')
    : t('sidepanel.personalIntelligencePage.contextStatusNoSavedContext');
  const memoryTone: ContextFactTone = memoryStatus.tone === 'normal'
    ? 'normal'
    : memoryStatus.tone === 'disabled'
      ? 'muted'
      : 'attention';
  const base = {
    project,
    projectTone: hasActiveProject ? 'normal' : 'muted',
    memory: memoryStatus.label,
    memoryTone,
    saved,
    savedTone: hasSourceIssues ? 'attention' : hasContextRecords || hasPreset ? 'normal' : 'muted',
  } satisfies Pick<ContextStatusModel,
    'project' | 'projectTone' | 'memory' | 'memoryTone' | 'saved' | 'savedTone'
  >;
  const projectsAction = usingActions[0] ?? {
    label: t('sidepanel.personalIntelligencePage.manageProjects'),
    target: { tab: 'projects' },
  };
  const memoryAction = usingActions[2] ?? {
    label: t('sidepanel.personalIntelligencePage.openPromptSettings'),
    target: { tab: 'settings', settingsSubTab: 'prompt' },
  };

  if (hasSourceIssues) {
    return {
      ...base,
      tone: 'attention',
      status: t('sidepanel.personalIntelligencePage.contextStatusNeedsRefresh'),
      description: t('sidepanel.personalIntelligencePage.contextStatusNeedsRefreshDescription'),
      next: t('sidepanel.personalIntelligencePage.contextStatusNextRefresh'),
      nextTone: 'attention',
      action: null,
    };
  }

  if (!hasContextRecords && !hasPreset) {
    return {
      ...base,
      tone: 'attention',
      status: t('sidepanel.personalIntelligencePage.contextStatusEmpty'),
      description: t('sidepanel.personalIntelligencePage.contextStatusEmptyDescription'),
      next: t('sidepanel.personalIntelligencePage.contextStatusNextCreateContext'),
      nextTone: 'attention',
      action: projectsAction,
    };
  }

  if (memoryStatus.tone === 'attention' || memoryStatus.tone === 'disabled') {
    return {
      ...base,
      tone: 'attention',
      status: t('sidepanel.personalIntelligencePage.contextStatusMemoryOff'),
      description: t('sidepanel.personalIntelligencePage.contextStatusMemoryOffDescription'),
      next: t('sidepanel.personalIntelligencePage.contextStatusNextMemory'),
      nextTone: 'attention',
      action: memoryAction,
    };
  }

  if (!hasActiveProject) {
    return {
      ...base,
      tone: 'attention',
      status: t('sidepanel.personalIntelligencePage.contextStatusNoProject'),
      description: t('sidepanel.personalIntelligencePage.contextStatusNoProjectDescription'),
      next: t('sidepanel.personalIntelligencePage.contextStatusNextChooseProject'),
      nextTone: 'attention',
      action: projectsAction,
    };
  }

  return {
    ...base,
    tone: 'ready',
    status: t('sidepanel.personalIntelligencePage.contextStatusReady'),
    description: t('sidepanel.personalIntelligencePage.contextStatusReadyDescription'),
    next: t('sidepanel.personalIntelligencePage.contextStatusNextContinue'),
    nextTone: 'normal',
    action: {
      label: t('app.sidebarV2.ask'),
      target: { tab: 'chat' },
    },
  };
}

function ContextStatusRow({ label, value, tone = 'normal' }: {
  label: string;
  value: string;
  tone?: ContextFactTone;
}) {
  return (
    <div className={`ds-intel-status-row ds-intel-status-row-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function isSameIntelligenceAction(left: IntelligenceAction, right: IntelligenceAction) {
  return left.label === right.label &&
    left.target.tab === right.target.tab &&
    left.target.librarySubTab === right.target.librarySubTab &&
    left.target.capabilitiesSubTab === right.target.capabilitiesSubTab &&
    left.target.settingsSubTab === right.target.settingsSubTab &&
    left.target.projectId === right.target.projectId;
}

function readArraySource<T>(
  result: PromiseSettledResult<unknown>,
  id: string,
  label: string,
  issues: SourceIssue[],
  t: Translate,
): T[] {
  if (result.status === 'rejected') {
    issues.push({ id, label, message: getRuntimeErrorMessage(result.reason) });
    return [];
  }
  if (!Array.isArray(result.value)) {
    issues.push({ id, label, message: t('sidepanel.personalIntelligencePage.sourceInvalid') });
    return [];
  }
  return result.value as T[];
}

function readObjectSource<T>(
  result: PromiseSettledResult<unknown>,
  id: string,
  label: string,
  isValid: (value: unknown) => value is T,
  issues: SourceIssue[],
  t: Translate,
): T | null {
  if (result.status === 'rejected') {
    issues.push({ id, label, message: getRuntimeErrorMessage(result.reason) });
    return null;
  }
  if (!isValid(result.value)) {
    issues.push({ id, label, message: t('sidepanel.personalIntelligencePage.sourceInvalid') });
    return null;
  }
  return result.value;
}

function readOptionalObjectSource<T>(
  result: PromiseSettledResult<unknown>,
  id: string,
  label: string,
  isValid: (value: unknown) => value is T,
  issues: SourceIssue[],
  t: Translate,
): T | null {
  if (result.status === 'fulfilled' && result.value === null) return null;
  return readObjectSource(result, id, label, isValid, issues, t);
}

function RecordGroup({
  title,
  action,
  items,
  onNavigate,
}: {
  title: string;
  action?: IntelligenceAction;
  items: { id: string; title: string; detail: string }[];
  onNavigate: (target: SidepanelNavigationTarget) => void;
}) {
  return (
    <section className="ds-intel-record-group">
      <div className="ds-intel-group-header">
        <h4>{title}</h4>
        {action && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ds-btn-secondary ds-intel-button ds-intel-group-action"
            onClick={() => onNavigate(action.target)}
          >
            {action.label}
          </Button>
        )}
      </div>
      <div className="ds-intel-list">
        {items.map((item) => (
          <div key={item.id} className="ds-intel-list-row">
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function isProjectContextState(value: unknown): value is ProjectContextState {
  if (!value || typeof value !== 'object') return false;
  const state = value as ProjectContextState;
  return state.schemaVersion === PROJECT_CONTEXT_SCHEMA_VERSION &&
    Array.isArray(state.projects) &&
    Array.isArray(state.conversations) &&
    (state.pendingProjectId === null || typeof state.pendingProjectId === 'string');
}

function isSystemPromptPreset(value: unknown): value is SystemPromptPreset {
  if (!value || typeof value !== 'object') return false;
  const preset = value as SystemPromptPreset;
  return typeof preset.id === 'string' &&
    typeof preset.name === 'string' &&
    typeof preset.content === 'string';
}

function isPromptInjectionSettingsSource(value: unknown): value is PromptInjectionSettings {
  return Boolean(value && typeof value === 'object');
}

function getMemoryTypeLabelKey(type: Memory['type']) {
  return MEMORY_TYPE_CONFIG.find((item) => item.key === type)?.labelKey ?? 'sidepanel.memory.types.reference';
}

function getProjectSourceDetail(source: OperationalProjectSource, t: Translate) {
  if (source === 'current-conversation') {
    return t('sidepanel.personalIntelligencePage.sourceCurrentConversation');
  }
  if (source === 'pending-next-conversation') {
    return t('sidepanel.personalIntelligencePage.sourceNextConversation');
  }
  return t('sidepanel.personalIntelligencePage.projectSourceUnknown');
}

function getMemoryStatus(settings: PromptInjectionSettings | null, t: Translate) {
  if (settings?.memoryEnabled === true) {
    return {
      label: t('common.enabled'),
      detail: t('sidepanel.personalIntelligencePage.memoryEnabledDetail'),
      tone: 'normal' as const,
      actionLabel: t('sidepanel.personalIntelligencePage.memorySources'),
      actionTarget: { tab: 'library', librarySubTab: 'memory' } as SidepanelNavigationTarget,
    };
  }
  if (settings?.memoryEnabled === false) {
    return {
      label: t('common.disabled'),
      detail: t('sidepanel.personalIntelligencePage.memoryDisabledDetail'),
      tone: 'disabled' as const,
      actionLabel: t('sidepanel.personalIntelligencePage.openPromptSettings'),
      actionTarget: { tab: 'settings', settingsSubTab: 'prompt' } as SidepanelNavigationTarget,
    };
  }
  return {
    label: t('common.unavailable'),
    detail: t('sidepanel.personalIntelligencePage.memoryUnavailableDetail'),
    tone: 'attention' as const,
    actionLabel: t('sidepanel.personalIntelligencePage.openPromptSettings'),
    actionTarget: { tab: 'settings', settingsSubTab: 'prompt' } as SidepanelNavigationTarget,
  };
}

function formatMemoryDetail(memory: Memory, t: Translate) {
  const scope = memory.scope === 'project'
    ? t('sidepanel.personalIntelligencePage.projectScope')
    : t('sidepanel.personalIntelligencePage.globalScope');
  const preview = compactText(memory.content);
  return preview
    ? `${scope} · ${preview}`
    : `${t(getMemoryTypeLabelKey(memory.type))} · ${scope}`;
}

function formatSavedItemDetail(item: SavedItem, t: Translate) {
  const kind = item.kind === 'snippet'
    ? t('sidepanel.savedPage.snippet')
    : t('sidepanel.savedPage.bookmark');
  const preview = compactText(item.content);
  return preview ? `${kind} · ${preview}` : kind;
}

function formatProjectDetail(
  project: ProjectContextState['projects'][number],
  t: Translate,
) {
  const preview = compactText(project.instructions || project.description);
  if (preview) return preview;
  return project.instructions
    ? t('sidepanel.personalIntelligencePage.hasInstructions')
    : t('sidepanel.personalIntelligencePage.noInstructions');
}

function compactText(value: string, limit = 92) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1).trimEnd()}...`;
}
