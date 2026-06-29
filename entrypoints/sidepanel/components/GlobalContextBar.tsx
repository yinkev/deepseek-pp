import {
  getContextBarItems,
  type OperationalContextBarItem,
  type OperationalTone,
} from '../../../core/operational-context';
import type { LocaleMessageKey, MessageParams } from '../../../core/i18n';
import { useGlobalOperationalContext } from '../global-operational-context';
import type { SidepanelNavigationTarget, SidepanelTab } from '../navigation';
import { useI18n } from '../i18n';

interface GlobalContextBarProps {
  activeTab: SidepanelTab;
  onNavigate: (target: SidepanelNavigationTarget) => void;
}

interface RenderedContextItem {
  label: string;
  value: string;
  tone: OperationalTone;
  active: boolean;
  target: SidepanelNavigationTarget;
  title?: string;
}

export default function GlobalContextBar({ activeTab, onNavigate }: GlobalContextBarProps) {
  const { t } = useI18n();
  const { context } = useGlobalOperationalContext();
  const items = getContextBarItems(context).map((item) => renderContextItem(item, activeTab, t));

  return (
    <div className="ds-context-bar" aria-label={t('app.context.label')}>
      {items.map((item) => (
        <ContextButton
          key={item.label}
          label={item.label}
          value={item.value}
          tone={item.tone}
          active={item.active}
          title={item.title}
          onClick={() => onNavigate(item.target)}
        />
      ))}
    </div>
  );
}

function ContextButton({
  label,
  value,
  tone,
  active,
  title,
  onClick,
}: {
  label: string;
  value: string;
  tone: OperationalTone;
  active: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`ds-context-item ds-context-item-${tone}${active ? ' ds-context-item-active' : ''}`}
      onClick={onClick}
      title={title ?? `${label}: ${value}`}
    >
      <span className="ds-context-dot" aria-hidden="true" />
      <span className="ds-context-label">{label}</span>
      <span className="ds-context-value">{value}</span>
    </button>
  );
}

function renderContextItem(
  item: OperationalContextBarItem,
  activeTab: SidepanelTab,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): RenderedContextItem {
  const value = item.valueText ?? (item.valueKey ? t(item.valueKey, item.valueParams) : '');
  const titleParams = resolveTitleParams(item.titleParams, t);
  return {
    label: t(item.labelKey),
    value,
    tone: item.tone,
    active: activeTab === item.target.tab,
    target: item.target,
    title: t(item.titleKey, titleParams),
  };
}

function resolveTitleParams(
  params: MessageParams | undefined,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): MessageParams | undefined {
  if (!params) return undefined;
  const next: MessageParams = { ...params };
  if (typeof next.value === 'string' && isContextLocaleKey(next.value)) {
    next.value = t(next.value);
  }
  return next;
}

function isContextLocaleKey(value: string): value is LocaleMessageKey {
  return value.startsWith('app.context.');
}
