import type { LocaleMessageKey } from '../../core/i18n';
import type { GlobalOperationalContext, OperationalTone } from '../../core/operational-context';
import type { CurrentDeepSeekConversation, ProjectContextState } from '../../core/project';
import type { CapabilitiesSubTab, SidepanelNavigationTarget, SidepanelTab } from './navigation';

export type SidebarV2SectionKey = 'primary' | 'recent' | 'workspace' | 'system';

export interface SidebarV2NavigationItem {
  key: string;
  labelKey?: LocaleMessageKey;
  labelText?: string;
  detailKey?: LocaleMessageKey;
  detailText?: string;
  groupKey?: LocaleMessageKey;
  target: SidepanelNavigationTarget;
  disabled?: boolean;
}

export interface SidebarV2NavigationSection {
  key: SidebarV2SectionKey;
  labelKey: LocaleMessageKey;
  emptyKey?: LocaleMessageKey;
  items: SidebarV2NavigationItem[];
}

export interface SidebarV2ProjectionInput {
  context: GlobalOperationalContext;
  projectState: ProjectContextState | null;
  currentConversation: CurrentDeepSeekConversation | null;
  chatEnabled: boolean | null;
}

export interface SidebarV2ActiveInput {
  tab: SidepanelTab;
  capabilitiesSubTab?: CapabilitiesSubTab;
  projectId?: string | null;
}

export const SYSTEM_CAPABILITY_ITEMS = [
  {
    key: 'system-automation',
    groupKey: 'app.sidebarV2.systemRunGroup',
    labelKey: 'app.sidebarV2.automation',
    detailKey: 'app.sidebarV2.automationDetail',
    capabilitiesSubTab: 'automation',
  },
  {
    key: 'system-presets',
    groupKey: 'app.sidebarV2.systemRunGroup',
    labelKey: 'app.sidebarV2.presets',
    detailKey: 'app.sidebarV2.presetsDetail',
    capabilitiesSubTab: 'preset',
  },
  {
    key: 'system-browser',
    groupKey: 'app.sidebarV2.systemToolGroup',
    labelKey: 'app.sidebarV2.browser',
    detailKey: 'app.sidebarV2.browserDetail',
    capabilitiesSubTab: 'browser',
  },
  {
    key: 'system-mcp',
    groupKey: 'app.sidebarV2.systemToolGroup',
    labelKey: 'app.sidebarV2.mcp',
    detailKey: 'app.sidebarV2.mcpDetail',
    capabilitiesSubTab: 'mcp',
  },
  {
    key: 'system-tools',
    groupKey: 'app.sidebarV2.systemToolGroup',
    labelKey: 'app.sidebarV2.tools',
    detailKey: 'app.sidebarV2.toolsDetail',
    capabilitiesSubTab: 'tools',
  },
  {
    key: 'system-doctor',
    groupKey: 'app.sidebarV2.systemHealthGroup',
    labelKey: 'app.sidebarV2.doctor',
    detailKey: 'app.sidebarV2.doctorDetail',
    capabilitiesSubTab: 'doctor',
  },
] as const satisfies readonly {
  key: string;
  groupKey: LocaleMessageKey;
  labelKey: LocaleMessageKey;
  detailKey: LocaleMessageKey;
  capabilitiesSubTab: CapabilitiesSubTab;
}[];

export function createSidebarV2Navigation(input: SidebarV2ProjectionInput): SidebarV2NavigationSection[] {
  const primaryItems: SidebarV2NavigationItem[] = [
    {
      key: 'ask',
      labelKey: 'app.sidebarV2.ask',
      detailKey: 'app.sidebarV2.homeDetail',
      target: { tab: 'chat' },
    },
    {
      key: 'projects',
      labelKey: 'app.sidebarV2.projects',
      detailKey: 'app.sidebarV2.projectsDetail',
      target: { tab: 'projects' },
    },
    {
      key: 'context',
      labelKey: 'app.sidebarV2.intelligence',
      detailKey: 'app.sidebarV2.intelligenceDetail',
      target: { tab: 'intelligence' },
    },
    {
      key: 'mission',
      labelKey: 'app.sidebarV2.mission',
      detailKey: 'app.sidebarV2.missionDetail',
      target: { tab: 'mission' },
    },
    {
      key: 'activity',
      labelKey: 'app.sidebarV2.activity',
      detailKey: 'app.sidebarV2.activityDetail',
      target: { tab: 'timeline' },
    },
    {
      key: 'review',
      labelKey: 'app.sidebarV2.review',
      detailKey: 'app.sidebarV2.reviewDetail',
      target: { tab: 'review' },
    },
  ];
  const systemCapabilityItems: SidebarV2NavigationItem[] = SYSTEM_CAPABILITY_ITEMS.map((item) => ({
    key: item.key,
    groupKey: item.groupKey,
    labelKey: item.labelKey,
    detailKey: item.detailKey,
    target: { tab: 'capabilities', capabilitiesSubTab: item.capabilitiesSubTab },
  }));

  return [
    {
      key: 'primary',
      labelKey: 'app.sidebarV2.primaryNavLabel',
      items: primaryItems,
    },
    {
      key: 'recent',
      labelKey: 'app.sidebarV2.recentSection',
      emptyKey: 'app.sidebarV2.noRecent',
      items: createRecentItems(input.projectState, input.currentConversation),
    },
    {
      key: 'workspace',
      labelKey: 'app.sidebarV2.workspaceSection',
      items: [
        {
          key: 'workspace-home',
          labelKey: 'app.sidebarV2.ask',
          detailKey: 'app.sidebarV2.homeDetail',
          target: { tab: 'chat' },
        },
        {
          key: 'workspace-projects',
          labelKey: 'app.sidebarV2.projects',
          detailKey: 'app.sidebarV2.projectsDetail',
          target: { tab: 'projects' },
        },
        {
          key: 'workspace-intelligence',
          labelKey: 'app.sidebarV2.intelligence',
          detailKey: 'app.sidebarV2.intelligenceDetail',
          target: { tab: 'intelligence' },
        },
        {
          key: 'workspace-working-set',
          labelKey: 'app.sidebarV2.workingSet',
          detailKey: 'app.sidebarV2.workingSetDetail',
          target: { tab: 'workingSet' },
        },
        {
          key: 'workspace-activity',
          labelKey: 'app.sidebarV2.activity',
          detailKey: 'app.sidebarV2.activityDetail',
          target: { tab: 'timeline' },
        },
        {
          key: 'workspace-review',
          labelKey: 'app.sidebarV2.review',
          detailKey: 'app.sidebarV2.reviewDetail',
          target: { tab: 'review' },
        },
        {
          key: 'workspace-skills',
          labelKey: 'app.sidebarV2.skills',
          detailKey: 'app.sidebarV2.skillsDetail',
          target: { tab: 'skills' },
        },
        {
          key: 'workspace-library',
          labelKey: 'app.sidebarV2.library',
          detailKey: 'app.sidebarV2.libraryDetail',
          target: { tab: 'library' },
        },
      ],
    },
    {
      key: 'system',
      labelKey: 'app.sidebarV2.systemSection',
      items: [
        ...systemCapabilityItems,
        {
          key: 'system-settings',
          groupKey: 'app.sidebarV2.systemConfigGroup',
          labelKey: 'app.sidebarV2.settings',
          detailKey: 'app.sidebarV2.settingsDetail',
          target: { tab: 'settings' },
        },
      ],
    },
  ];
}

export function getSidebarV2ActiveKey(input: SidebarV2ActiveInput): string {
  if (input.tab === 'chat') return 'ask';
  if (input.tab === 'mission') return 'mission';
  if (input.tab === 'projects') return 'projects';
  if (input.tab === 'intelligence') return 'context';
  if (input.tab === 'workingSet') return 'workspace-working-set';
  if (input.tab === 'timeline') return 'activity';
  if (input.tab === 'review') return 'review';
  if (input.tab === 'skills') return 'workspace-skills';
  if (input.tab === 'library') return 'workspace-library';
  if (input.tab === 'settings') return 'system-settings';
  if (input.tab === 'capabilities') {
    const activeCapability = SYSTEM_CAPABILITY_ITEMS.find(
      (item) => item.capabilitiesSubTab === (input.capabilitiesSubTab ?? 'mcp'),
    );
    return activeCapability?.key ?? 'system-mcp';
  }
  return 'mission';
}

export function isSidebarV2TargetActive(
  item: SidebarV2NavigationItem,
  active: SidebarV2ActiveInput,
): boolean {
  if (item.target.tab !== active.tab) return false;
  if (item.target.tab === 'projects') {
    if (!item.target.projectId) return !active.projectId;
    return item.target.projectId === active.projectId;
  }
  if (item.target.tab !== 'capabilities') return true;
  return (item.target.capabilitiesSubTab ?? 'mcp') === (active.capabilitiesSubTab ?? 'mcp');
}

export function getSidebarV2StatusKey(context: GlobalOperationalContext): LocaleMessageKey {
  const tones: OperationalTone[] = [
    context.execution.tone,
    context.runtime.tone,
    context.tools.tone,
    context.browser.expected ? context.browser.tone : 'ready',
  ];
  if (tones.includes('blocked')) return 'app.sidebarV2.statusBlocked';
  if (tones.includes('attention')) return 'app.sidebarV2.statusAttention';
  if (tones.every((tone) => tone === 'ready')) return 'app.sidebarV2.statusReady';
  return 'app.sidebarV2.statusUnknown';
}

export function getSidebarV2ContextLine(context: GlobalOperationalContext): string[] {
  const items: string[] = [];
  if (context.project.name) items.push(context.project.name);
  if (context.browser.targetOrigin) items.push(context.browser.targetOrigin);
  return items;
}

function createRecentItems(
  projectState: ProjectContextState | null,
  currentConversation: CurrentDeepSeekConversation | null,
): SidebarV2NavigationItem[] {
  const items: SidebarV2NavigationItem[] = [];
  const seen = new Set<string>();

  if (!projectState) return items;

  if (currentConversation) {
    const currentMembership = projectState.conversations.find(
      (conversation) => conversation.conversationId === currentConversation.conversationId,
    );
    if (currentMembership) {
      seen.add(`conversation:${currentConversation.conversationId}`);
      seen.add(`project:${currentMembership.projectId}`);
      items.push({
        key: `recent-current-${currentConversation.conversationId}`,
        labelText: currentConversation.title || currentConversation.url,
        detailKey: 'app.sidebarV2.currentConversation',
        target: { tab: 'projects', projectId: currentMembership.projectId },
      });
    }
  }

  const projectNameById = new Map(projectState.projects.map((project) => [project.id, project.name]));
  const recentConversations = [...projectState.conversations]
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .filter((conversation) => {
      const key = `conversation:${conversation.conversationId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      seen.add(`project:${conversation.projectId}`);
      return true;
    })
    .slice(0, 4)
    .map<SidebarV2NavigationItem>((conversation) => ({
      key: `recent-conversation-${conversation.conversationId}`,
      labelText: conversation.title || conversation.url,
      detailText: projectNameById.get(conversation.projectId) ?? '',
      target: { tab: 'projects', projectId: conversation.projectId },
    }));

  items.push(...recentConversations);

  const recentProjects = [...projectState.projects]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((project) => {
      const key = `project:${project.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(0, 5 - items.length))
    .map<SidebarV2NavigationItem>((project) => ({
      key: `recent-project-${project.id}`,
      labelText: project.name,
      detailKey: 'app.sidebarV2.recentProject',
      target: { tab: 'projects', projectId: project.id },
    }));

  items.push(...recentProjects);
  return items.slice(0, 5);
}
