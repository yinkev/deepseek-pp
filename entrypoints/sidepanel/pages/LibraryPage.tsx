import { useState } from 'react';
import type { LocaleMessageKey } from '../../../core/i18n';
import MemoryPage from './MemoryPage';
import SavedPage from './SavedPage';
import { useI18n } from '../i18n';
import { useHorizontalScrollHints } from '../use-horizontal-scroll-hints';

type LibrarySubTab = 'memory' | 'saved';

const SUB_TABS: { key: LibrarySubTab; labelKey: LocaleMessageKey }[] = [
  { key: 'memory', labelKey: 'sidepanel.libraryPage.tabs.memory' },
  { key: 'saved', labelKey: 'sidepanel.libraryPage.tabs.saved' },
];

interface LibraryPageProps {
  onInsertPrompt: (text: string) => void;
}

export default function LibraryPage({ onInsertPrompt }: LibraryPageProps) {
  const [sub, setSub] = useState<LibrarySubTab>('memory');
  const { t } = useI18n();
  const subTabs = useHorizontalScrollHints<HTMLElement>({ compact: false });

  return (
    <div className="flex flex-col h-full">
      <nav
        ref={subTabs.ref}
        className={`sub-tabs${subTabs.className ? ` ${subTabs.className}` : ''}`}
        aria-label={t('sidepanel.libraryPage.navLabel')}
      >
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setSub(tab.key)}
            className={`sub-tab${sub === tab.key ? ' sub-tab-active' : ''}`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {sub === 'memory' && <MemoryPage />}
        {sub === 'saved' && <SavedPage onInsertPrompt={onInsertPrompt} />}
      </div>
    </div>
  );
}
