import { useState } from 'react';
import AutomationPage from './AutomationPage';
import BrowserControlPage from './BrowserControlPage';
import McpPage from './McpPage';
import PresetPage from './PresetPage';
import RuntimeDoctorPage from './RuntimeDoctorPage';
import SkillPage from './SkillPage';
import ToolsPage from './ToolsPage';
import { SubTabs } from '../components/settings/primitives';
import { useI18n } from '../i18n';

type CapabilitiesSubTab = 'skill' | 'mcp' | 'tools' | 'browser' | 'doctor' | 'preset' | 'automation';

const SUB_TABS: { key: CapabilitiesSubTab; labelKey: 'sidepanel.capabilitiesPage.tabs.skill' | 'sidepanel.capabilitiesPage.tabs.mcp' | 'sidepanel.capabilitiesPage.tabs.tools' | 'sidepanel.capabilitiesPage.tabs.browser' | 'sidepanel.capabilitiesPage.tabs.doctor' | 'sidepanel.capabilitiesPage.tabs.preset' | 'sidepanel.capabilitiesPage.tabs.automation' }[] = [
  { key: 'skill', labelKey: 'sidepanel.capabilitiesPage.tabs.skill' },
  { key: 'mcp', labelKey: 'sidepanel.capabilitiesPage.tabs.mcp' },
  { key: 'tools', labelKey: 'sidepanel.capabilitiesPage.tabs.tools' },
  { key: 'browser', labelKey: 'sidepanel.capabilitiesPage.tabs.browser' },
  { key: 'doctor', labelKey: 'sidepanel.capabilitiesPage.tabs.doctor' },
  { key: 'preset', labelKey: 'sidepanel.capabilitiesPage.tabs.preset' },
  { key: 'automation', labelKey: 'sidepanel.capabilitiesPage.tabs.automation' },
];

export default function CapabilitiesPage() {
  const [sub, setSub] = useState<CapabilitiesSubTab>('skill');
  const { t } = useI18n();

  return (
    <div className="flex flex-col h-full">
      <SubTabs
        tabs={SUB_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }))}
        value={sub}
        onChange={setSub}
        ariaLabel={t('sidepanel.capabilitiesPage.navLabel')}
      />

      <div className="flex-1 overflow-y-auto">
        {sub === 'skill' && <SkillPage />}
        {sub === 'mcp' && <McpPage />}
        {sub === 'tools' && <ToolsPage />}
        {sub === 'browser' && <BrowserControlPage />}
        {sub === 'doctor' && <RuntimeDoctorPage />}
        {sub === 'preset' && <PresetPage />}
        {sub === 'automation' && <AutomationPage />}
      </div>
    </div>
  );
}
