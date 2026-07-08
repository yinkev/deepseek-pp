import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import {
  createSidebarV2Navigation,
  getSidebarV2ActiveKey,
  getSidebarV2ContextLine,
  getSidebarV2StatusKey,
  isSidebarV2TargetActive,
  type SidebarV2NavigationItem,
  type SidebarV2NavigationSection,
} from '../sidebar-v2';
import { useGlobalOperationalContext } from '../global-operational-context';
import type { CapabilitiesSubTab, SidepanelNavigationTarget, SidepanelTab } from '../navigation';
import { useI18n } from '../i18n';

interface SidebarV2ShellProps {
  activeTab: SidepanelTab;
  activeCapabilitiesSubTab: CapabilitiesSubTab;
  activeProjectId?: string | null;
  chatEnabled: boolean | null;
  onNavigate: (target: SidepanelNavigationTarget) => void;
}

export default function SidebarV2Shell({
  activeTab,
  activeCapabilitiesSubTab,
  activeProjectId = null,
  chatEnabled,
  onNavigate,
}: SidebarV2ShellProps) {
  const { t } = useI18n();
  const { context, projectState, currentConversation } = useGlobalOperationalContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasMenuOpenRef = useRef(false);
  const menuId = 'ds-v2-menu-panel';
  const activeKey = getSidebarV2ActiveKey({
    tab: activeTab,
    capabilitiesSubTab: activeCapabilitiesSubTab,
    projectId: activeProjectId,
  });
  const sections = useMemo(
    () => createSidebarV2Navigation({
      context,
      projectState,
      currentConversation,
      chatEnabled,
    }),
    [chatEnabled, context, currentConversation, projectState],
  );
  const primarySection = sections.find((section) => section.key === 'primary');
  const menuSections = sections.filter((section) => section.key !== 'primary');
  const contextLine = getSidebarV2ContextLine(context);
  const statusKey = getSidebarV2StatusKey(context);
  const showStatus = statusKey === 'app.sidebarV2.statusAttention' || statusKey === 'app.sidebarV2.statusBlocked';
  const statusTone = statusKey === 'app.sidebarV2.statusBlocked'
    ? 'blocked'
    : statusKey === 'app.sidebarV2.statusAttention'
      ? 'attention'
      : 'ready';

  const navigate = (target: SidepanelNavigationTarget) => {
    onNavigate(target);
    setMenuOpen(false);
  };

  const handleMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
  };

  useEffect(() => {
    if (menuOpen) {
      wasMenuOpenRef.current = true;
      return;
    }
    if (!wasMenuOpenRef.current) return;
    wasMenuOpenRef.current = false;
    const focusMenuButton = () => menuButtonRef.current?.focus();
    requestAnimationFrame(focusMenuButton);
    window.setTimeout(focusMenuButton, 0);
  }, [menuOpen]);

  return (
    <header className="ds-v2-shell">
      <div className="ds-v2-titlebar">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ds-v2-brand"
          onClick={() => {
            navigate({ tab: 'chat' });
          }}
          aria-label={t('app.sidebarV2.ask')}
        >
          <span className="ds-v2-brand-mark" aria-hidden="true">D</span>
        </Button>
        <div className="ds-v2-titlecopy">
          <div className="ds-v2-titleline">
            <span className="ds-v2-title">DeepSeek++</span>
            {showStatus && (
              <span className={`ds-v2-status ds-v2-status-${statusTone}`}>
                {t(statusKey)}
              </span>
            )}
          </div>
          {contextLine.length > 0 && (
            <div className="ds-v2-context-line">
              {contextLine.join(' / ')}
            </div>
          )}
        </div>
        <Button
          ref={menuButtonRef}
          type="button"
          variant="outline"
          size="sm"
          className="ds-v2-menu-button"
          aria-controls={menuId}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          aria-label={t('app.sidebarV2.menuButton')}
          onClick={() => setMenuOpen(true)}
        >
          {t('app.sidebarV2.menu')}
        </Button>
        <CommandDialog
          open={menuOpen}
          onOpenChange={handleMenuOpenChange}
          title={t('app.sidebarV2.menuTitle')}
          description={contextLine.length > 0 ? contextLine.join(' / ') : t('app.sidebarV2.menuSubtitle')}
          className="ds-v2-command-dialog"
          showCloseButton
        >
          <Command id={menuId} className="ds-v2-menu" aria-label={t('app.sidebarV2.menuLabel')}>
            <div className="ds-v2-menu-header">
              <span className="ds-v2-menu-title">{t('app.sidebarV2.menuTitle')}</span>
              <span className="ds-v2-menu-subtitle">
                {contextLine.length > 0 ? contextLine.join(' / ') : t('app.sidebarV2.menuSubtitle')}
              </span>
            </div>
            <CommandInput
              className="ds-v2-command-input"
              placeholder={t('app.sidebarV2.menuSearchPlaceholder')}
            />
            <CommandList
              className="ds-v2-menu-list"
              aria-label={t('app.sidebarV2.menuLabel')}
            >
              <CommandEmpty className="ds-v2-menu-empty">
                {t('app.sidebarV2.menuNoResults')}
              </CommandEmpty>
              {menuSections.map((section, index) => (
                <Fragment key={section.key}>
                  {index > 0 && <CommandSeparator className="ds-v2-menu-separator" />}
                  <SidebarV2MenuSection
                    section={section}
                    activeTab={activeTab}
                    activeCapabilitiesSubTab={activeCapabilitiesSubTab}
                    activeProjectId={activeProjectId}
                    onNavigate={navigate}
                  />
                </Fragment>
              ))}
            </CommandList>
          </Command>
        </CommandDialog>
      </div>

      {primarySection && (
        <nav className="ds-v2-primary-nav" aria-label={t(primarySection.labelKey)}>
          {primarySection.items.map((item) => (
            <SidebarV2NavButton
              key={item.key}
              item={item}
              active={item.key === activeKey || isSidebarV2TargetActive(item, {
                tab: activeTab,
                capabilitiesSubTab: activeCapabilitiesSubTab,
                projectId: activeProjectId,
              })}
              onNavigate={navigate}
            />
          ))}
        </nav>
      )}
    </header>
  );
}

function SidebarV2MenuSection({
  section,
  activeTab,
  activeCapabilitiesSubTab,
  activeProjectId,
  onNavigate,
}: {
  section: SidebarV2NavigationSection;
  activeTab: SidepanelTab;
  activeCapabilitiesSubTab: CapabilitiesSubTab;
  activeProjectId: string | null;
  onNavigate: (target: SidepanelNavigationTarget) => void;
}) {
  const { t } = useI18n();

  return (
    <CommandGroup className="ds-v2-menu-section" heading={t(section.labelKey)}>
      {section.items.length > 0 ? (
        <div className="ds-v2-menu-section-list">
          {renderMenuItems({
            items: section.items,
            activeTab,
            activeCapabilitiesSubTab,
            activeProjectId,
            onNavigate,
            t,
          })}
        </div>
      ) : (
        <div className="ds-v2-menu-empty" role="note">
          {section.emptyKey ? t(section.emptyKey) : t('common.none')}
        </div>
      )}
    </CommandGroup>
  );
}

function renderMenuItems({
  items,
  activeTab,
  activeCapabilitiesSubTab,
  activeProjectId,
  onNavigate,
  t,
}: {
  items: SidebarV2NavigationItem[];
  activeTab: SidepanelTab;
  activeCapabilitiesSubTab: CapabilitiesSubTab;
  activeProjectId: string | null;
  onNavigate: (target: SidepanelNavigationTarget) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  let previousGroupKey: string | undefined;

  return items.map((item) => {
    const showGroup = item.groupKey && item.groupKey !== previousGroupKey;
    previousGroupKey = item.groupKey;

    return (
      <Fragment key={item.key}>
        {showGroup && (
          <div className="ds-v2-menu-group-heading" role="presentation">
            {item.groupKey ? t(item.groupKey) : null}
          </div>
        )}
        <SidebarV2MenuItem
          item={item}
          active={isSidebarV2TargetActive(item, {
            tab: activeTab,
            capabilitiesSubTab: activeCapabilitiesSubTab,
            projectId: activeProjectId,
          })}
          onNavigate={onNavigate}
        />
      </Fragment>
    );
  });
}

function SidebarV2NavButton({
  item,
  active,
  onNavigate,
}: {
  item: SidebarV2NavigationItem;
  active: boolean;
  onNavigate: (target: SidepanelNavigationTarget) => void;
}) {
  const { t } = useI18n();
  const label = renderItemLabel(item, t);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={`ds-v2-nav-button${active ? ' ds-v2-nav-button-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      title={label}
      disabled={item.disabled}
      onClick={() => onNavigate(item.target)}
    >
      {label}
    </Button>
  );
}

function SidebarV2MenuItem({
  item,
  active,
  onNavigate,
}: {
  item: SidebarV2NavigationItem;
  active: boolean;
  onNavigate: (target: SidepanelNavigationTarget) => void;
}) {
  const { t } = useI18n();
  const label = renderItemLabel(item, t);
  const detail = renderItemDetail(item, t);
  const commandValue = [label, detail, item.groupKey ? t(item.groupKey) : '']
    .filter(Boolean)
    .join(' ');

  return (
    <CommandItem
      className={`ds-v2-menu-item${active ? ' ds-v2-menu-item-active' : ''}`}
      value={commandValue}
      aria-current={active ? 'page' : undefined}
      disabled={item.disabled}
      onSelect={() => {
        if (!item.disabled) onNavigate(item.target);
      }}
    >
      <span className="ds-v2-menu-item-label">{label}</span>
      {detail && <span className="ds-v2-menu-item-detail">{detail}</span>}
    </CommandItem>
  );
}

function renderItemLabel(
  item: SidebarV2NavigationItem,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (item.labelText) return item.labelText;
  return item.labelKey ? t(item.labelKey) : '';
}

function renderItemDetail(
  item: SidebarV2NavigationItem,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (item.detailText) return item.detailText;
  return item.detailKey ? t(item.detailKey) : '';
}
