import { useEffect, useState } from 'react';
import MemoryPage from './MemoryPage';
import SavedPage from './SavedPage';
import { SubTabs } from '../components/settings/primitives';
import { useI18n } from '../i18n';
import type { LibrarySubTab } from '../navigation';

const SUB_TABS: { key: LibrarySubTab; labelKey: 'sidepanel.libraryPage.tabs.memory' | 'sidepanel.libraryPage.tabs.saved' }[] = [
  { key: 'memory', labelKey: 'sidepanel.libraryPage.tabs.memory' },
  { key: 'saved', labelKey: 'sidepanel.libraryPage.tabs.saved' },
];

interface LibraryPageProps {
  activeSubTab?: LibrarySubTab;
  onSubTabChange?: (subTab: LibrarySubTab) => void;
  onInsertPrompt: (text: string) => void;
}

export default function LibraryPage({ activeSubTab, onSubTabChange, onInsertPrompt }: LibraryPageProps) {
  const [sub, setSub] = useState<LibrarySubTab>(activeSubTab ?? 'memory');
  const { t } = useI18n();

  useEffect(() => {
    if (activeSubTab) setSub(activeSubTab);
  }, [activeSubTab]);

  const changeSubTab = (next: LibrarySubTab) => {
    setSub(next);
    onSubTabChange?.(next);
  };

  return (
    <div className="flex flex-col h-full">
      <SubTabs
        tabs={SUB_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }))}
        value={sub}
        onChange={changeSubTab}
        ariaLabel={t('sidepanel.libraryPage.navLabel')}
      />

      <div className="flex-1 overflow-y-auto">
        {sub === 'memory' && <MemoryPage />}
        {sub === 'saved' && <SavedPage onInsertPrompt={onInsertPrompt} />}
      </div>
    </div>
  );
}
