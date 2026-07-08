export type SidepanelTab =
  | 'mission'
  | 'workingSet'
  | 'timeline'
  | 'review'
  | 'chat'
  | 'projects'
  | 'intelligence'
  | 'skills'
  | 'library'
  | 'capabilities'
  | 'settings';

export type LibrarySubTab = 'memory' | 'saved';

export type CapabilitiesSubTab = 'mcp' | 'tools' | 'browser' | 'doctor' | 'preset' | 'automation';

export type SettingsSubTab = 'general' | 'api' | 'prompt' | 'voice' | 'appearance' | 'usage' | 'data' | 'about';

export interface SidepanelNavigationTarget {
  tab: SidepanelTab;
  librarySubTab?: LibrarySubTab;
  capabilitiesSubTab?: CapabilitiesSubTab;
  projectId?: string;
  settingsSubTab?: SettingsSubTab;
}
