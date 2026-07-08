import { useState, type ReactNode } from 'react';
import WorkbenchSelect from '../components/WorkbenchSelect';
import AutomationPage from './AutomationPage';
import BrowserControlPage from './BrowserControlPage';
import McpPage from './McpPage';
import PresetPage from './PresetPage';
import RuntimeDoctorPage from './RuntimeDoctorPage';
import ToolsPage from './ToolsPage';
import { useI18n } from '../i18n';
import type { CapabilitiesSubTab } from '../navigation';
import { SYSTEM_CAPABILITY_ITEMS } from '../sidebar-v2';

const CAPABILITY_PAGE_RENDERERS: Record<CapabilitiesSubTab, () => ReactNode> = {
  automation: () => <AutomationPage />,
  preset: () => <PresetPage />,
  browser: () => <BrowserControlPage />,
  mcp: () => <McpPage />,
  tools: () => <ToolsPage />,
  doctor: () => <RuntimeDoctorPage />,
};

export default function CapabilitiesPage({
  activeSubTab,
  onSubTabChange,
}: {
  activeSubTab?: CapabilitiesSubTab;
  onSubTabChange?: (tab: CapabilitiesSubTab) => void;
}) {
  const [localSub, setLocalSub] = useState<CapabilitiesSubTab>('mcp');
  const { t } = useI18n();
  const sub = activeSubTab ?? localSub;

  const setSub = (next: CapabilitiesSubTab) => {
    setLocalSub(next);
    onSubTabChange?.(next);
  };

  return (
    <div className="ds-capabilities-shell">
      <div className="ds-capabilities-toolbar">
        <CapabilitiesSectionPicker
          value={sub}
          label={t('sidepanel.capabilitiesPage.navLabel')}
          onChange={setSub}
        />
      </div>

      <div className="ds-capabilities-content">
        {CAPABILITY_PAGE_RENDERERS[sub]()}
      </div>
    </div>
  );
}

function CapabilitiesSectionPicker({
  value,
  label,
  onChange,
}: {
  value: CapabilitiesSubTab;
  label: string;
  onChange: (tab: CapabilitiesSubTab) => void;
}) {
  const { t } = useI18n();
  const groups = SYSTEM_CAPABILITY_ITEMS.reduce<Array<{
    key: string;
    label: string;
    items: typeof SYSTEM_CAPABILITY_ITEMS[number][];
  }>>((acc, item) => {
    const group = acc.find((entry) => entry.key === item.groupKey);
    if (group) {
      group.items.push(item);
    } else {
      acc.push({
        key: item.groupKey,
        label: t(item.groupKey),
        items: [item],
      });
    }
    return acc;
  }, []);

  return (
    <WorkbenchSelect
      className="ds-capabilities-picker"
      label={label}
      value={value}
      onChange={onChange}
      groups={groups.map((group) => ({
        key: group.key,
        label: group.label,
        items: group.items.map((item) => ({
          value: item.capabilitiesSubTab,
          label: t(item.labelKey),
        })),
      }))}
    />
  );
}
