import { lazy, Suspense, useEffect, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getChatEnabled } from '../../core/chat/store';
import SidebarV2Shell from './components/SidebarV2Shell';
import { GlobalOperationalContextProvider } from './global-operational-context';
import type {
  CapabilitiesSubTab,
  LibrarySubTab,
  SettingsSubTab,
  SidepanelNavigationTarget,
  SidepanelTab,
} from './navigation';
import { SkeletonList } from './components/settings/primitives';
import { setPendingText } from './pending-text';

const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const PersonalIntelligencePage = lazy(() => import('./pages/PersonalIntelligencePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const CapabilitiesPage = lazy(() => import('./pages/CapabilitiesPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const SkillPage = lazy(() => import('./pages/SkillPage'));
const MissionPage = lazy(() => import('./pages/MissionPage'));
const WorkingSetPage = lazy(() => import('./pages/WorkingSetPage'));
const TimelinePage = lazy(() => import('./pages/TimelinePage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));

export default function App() {
  const [tab, setTab] = useState<SidepanelTab>('chat');
  const [librarySubTab, setLibrarySubTab] = useState<LibrarySubTab>('memory');
  const [capabilitiesSubTab, setCapabilitiesSubTab] = useState<CapabilitiesSubTab>('mcp');
  const [projectNavigation, setProjectNavigation] = useState<{ projectId: string | null; sequence: number }>({
    projectId: null,
    sequence: 0,
  });
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>('general');
  const [chatEnabled, setChatEnabledState] = useState<boolean | null>(null);

  const navigate = (target: SidepanelNavigationTarget) => {
    if (target.librarySubTab) setLibrarySubTab(target.librarySubTab);
    if (target.capabilitiesSubTab) setCapabilitiesSubTab(target.capabilitiesSubTab);
    if (target.tab === 'projects') {
      setProjectNavigation((prev) => ({
        projectId: target.projectId ?? null,
        sequence: prev.sequence + 1,
      }));
    }
    if (target.settingsSubTab) setSettingsSubTab(target.settingsSubTab);
    setTab(target.tab);
  };

  useEffect(() => {
    getChatEnabled().then(setChatEnabledState);
    const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('deepseek_pp_chat_enabled' in changes) {
        setChatEnabledState(changes.deepseek_pp_chat_enabled.newValue === true);
      }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, []);

  // Read pending text on mount in case the sidepanel opened after the message was sent.
  useEffect(() => {
    chrome.storage.local.get('pendingChatText').then((data) => {
      const text = data.pendingChatText as string | undefined;
      if (text) {
        chrome.storage.local.remove('pendingChatText').catch(() => {});
        setPendingText(text);
        setTab('chat');
      }
    });
  }, []);

  useEffect(() => {
    const handler = (msg: { type: string; text?: string }) => {
      if (msg.type === 'OPEN_CHAT_WITH_TEXT' && typeof msg.text === 'string') {
        chrome.storage.local.remove('pendingChatText').catch(() => {});
        setPendingText(msg.text);
        setTab('chat');
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  return (
    <div className="ds-app-shell">
      <TooltipProvider>
        <GlobalOperationalContextProvider>
          <SidebarV2Shell
            activeTab={tab}
            activeCapabilitiesSubTab={capabilitiesSubTab}
            activeProjectId={tab === 'projects' ? projectNavigation.projectId : null}
            chatEnabled={chatEnabled}
            onNavigate={navigate}
          />

          <main className="ds-app-main">
            <Suspense fallback={<div className="p-4"><SkeletonList rows={3} /></div>}>
              {tab === 'mission' && <MissionPage onNavigate={navigate} />}
              {tab === 'workingSet' && <WorkingSetPage onNavigate={navigate} />}
              {tab === 'timeline' && <TimelinePage onNavigate={navigate} />}
              {tab === 'review' && <ReviewPage onNavigate={navigate} />}
              {tab === 'chat' && <ChatPage onNavigate={navigate} chatEnabled={chatEnabled} />}
              {tab === 'library' && (
                <LibraryPage
                  activeSubTab={librarySubTab}
                  onSubTabChange={setLibrarySubTab}
                  onInsertPrompt={(text) => {
                    setPendingText(text);
                    setTab('chat');
                  }}
                />
              )}
              {tab === 'projects' && (
                <ProjectsPage
                  initialProjectId={projectNavigation.projectId}
                  initialProjectNavigationKey={projectNavigation.sequence}
                />
              )}
              {tab === 'intelligence' && <PersonalIntelligencePage onNavigate={navigate} />}
              {tab === 'skills' && <SkillPage />}
              {tab === 'capabilities' && (
                <CapabilitiesPage
                  activeSubTab={capabilitiesSubTab}
                  onSubTabChange={setCapabilitiesSubTab}
                />
              )}
              {tab === 'settings' && (
                <SettingsPage
                  activeSubTab={settingsSubTab}
                  onSubTabChange={setSettingsSubTab}
                />
              )}
            </Suspense>
          </main>
        </GlobalOperationalContextProvider>
      </TooltipProvider>
    </div>
  );
}
