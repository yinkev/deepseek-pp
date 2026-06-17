import { useState } from 'react';
import type { LocaleMessageKey } from '../../../core/i18n';
import SkillPage from './SkillPage';
import McpPage from './McpPage';
import ToolsPage from './ToolsPage';
import PresetPage from './PresetPage';
import AutomationPage from './AutomationPage';
import BrowserControlPage from './BrowserControlPage';
import { useI18n } from '../i18n';
import { useHorizontalScrollHints } from '../use-horizontal-scroll-hints';

type SubTab = 'skill' | 'mcp' | 'tools' | 'browser' | 'preset' | 'automation';

const SUB_TABS: { key: SubTab; labelKey: LocaleMessageKey; titleKey?: LocaleMessageKey }[] = [
  { key: 'skill', labelKey: 'sidepanel.capabilitiesPage.tabs.skill' },
  { key: 'mcp', labelKey: 'sidepanel.capabilitiesPage.tabs.mcp' },
  { key: 'tools', labelKey: 'sidepanel.capabilitiesPage.tabs.tools' },
  { key: 'browser', labelKey: 'sidepanel.capabilitiesPage.tabs.browser' },
  { key: 'preset', labelKey: 'sidepanel.capabilitiesPage.tabs.preset' },
  {
    key: 'automation',
    labelKey: 'sidepanel.capabilitiesPage.tabs.automation',
    titleKey: 'sidepanel.capabilitiesPage.tabs.automationFull',
  },
];

export default function CapabilitiesPage() {
  const [sub, setSub] = useState<SubTab>('skill');
  const { t } = useI18n();
  const subTabs = useHorizontalScrollHints<HTMLElement>();

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
        {sub === 'preset' && <PresetPage />}
        {sub === 'automation' && <AutomationPage />}
      </div>
    </div>
  );
}
