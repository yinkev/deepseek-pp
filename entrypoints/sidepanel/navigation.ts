export type SidepanelTab = 'chat' | 'library' | 'projects' | 'capabilities' | 'settings';

export type CapabilitiesSubTab = 'skill' | 'mcp' | 'tools' | 'browser' | 'doctor' | 'preset' | 'automation';

export interface SidepanelNavigationTarget {
  tab: SidepanelTab;
  capabilitiesSubTab?: CapabilitiesSubTab;
}
