import { useState } from 'react';
import type { LocaleMessageKey } from '../../../core/i18n';
import AutomationPage from './AutomationPage';
import BrowserControlPage from './BrowserControlPage';
import McpPage from './McpPage';
import PresetPage from './PresetPage';
import RuntimeDoctorPage from './RuntimeDoctorPage';
import SkillPage from './SkillPage';
import ToolsPage from './ToolsPage';
import { useI18n } from '../i18n';
import type { CapabilitiesSubTab } from '../navigation';
import { useHorizontalScrollHints } from '../use-horizontal-scroll-hints';

const SUB_TABS: { key: CapabilitiesSubTab; labelKey: LocaleMessageKey; titleKey?: LocaleMessageKey }[] = [
  { key: 'skill', labelKey: 'sidepanel.capabilitiesPage.tabs.skill' },
  { key: 'mcp', labelKey: 'sidepanel.capabilitiesPage.tabs.mcp' },
  { key: 'tools', labelKey: 'sidepanel.capabilitiesPage.tabs.tools' },
  { key: 'browser', labelKey: 'sidepanel.capabilitiesPage.tabs.browser' },
  { key: 'doctor', labelKey: 'sidepanel.capabilitiesPage.tabs.doctor' },
  { key: 'preset', labelKey: 'sidepanel.capabilitiesPage.tabs.preset' },
  {
    key: 'automation',
    labelKey: 'sidepanel.capabilitiesPage.tabs.automation',
    titleKey: 'sidepanel.capabilitiesPage.tabs.automationFull',
  },
];

export default function CapabilitiesPage({
  activeSubTab,
  onSubTabChange,
}: {
  activeSubTab?: CapabilitiesSubTab;
  onSubTabChange?: (tab: CapabilitiesSubTab) => void;
}) {
  const [localSub, setLocalSub] = useState<CapabilitiesSubTab>('skill');
  const { t } = useI18n();
  const subTabs = useHorizontalScrollHints<HTMLElement>({ compact: false });
  const sub = activeSubTab ?? localSub;

  const setSub = (next: CapabilitiesSubTab) => {
    setLocalSub(next);
    onSubTabChange?.(next);
  };

  return (
    <div className="flex flex-col h-full">
      <nav
        ref={subTabs.ref}
        className={`sub-tabs${subTabs.className ? ` ${subTabs.className}` : ''}`}
        aria-label={t('sidepanel.capabilitiesPage.navLabel')}
      >
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setSub(tab.key)}
            className={`sub-tab${sub === tab.key ? ' sub-tab-active' : ''}`}
            title={t(tab.titleKey ?? tab.labelKey)}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </nav>

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
