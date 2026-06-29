import type {
  GlobalOperationalContext,
  OperationalBrowserState,
  OperationalExecutionRoute,
  OperationalMemoryState,
  OperationalRuntimeState,
  OperationalSessionStrategy,
  OperationalTone,
} from '../../../core/operational-context';
import type { LocaleMessageKey, MessageParams } from '../../../core/i18n';
import { useGlobalOperationalContext } from '../global-operational-context';
import type { SidepanelNavigationTarget, SidepanelTab } from '../navigation';
import { useI18n } from '../i18n';

interface GlobalContextBarProps {
  activeTab: SidepanelTab;
  onNavigate: (target: SidepanelNavigationTarget) => void;
}

interface ContextItem {
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
  const items = createContextItems(context, activeTab, t);

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

function createContextItems(
  context: GlobalOperationalContext,
  activeTab: SidepanelTab,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): ContextItem[] {
  const executionValue = formatExecutionRoute(context.execution.route, t);
  const projectValue = formatProject(context, t);
  const sessionValue = formatSessionStrategy(context.session.strategy, t);
  const memoryValue = formatMemory(context.memory.state, t);
  const browserValue = formatBrowser(context.browser.state, t);
  const runtimeValue = formatRuntime(context.runtime.state, t);
  const toolsValue = context.tools.enabledCount === null
    ? t('app.context.toolsUnavailable')
    : t('app.context.toolsEnabled', { count: context.tools.enabledCount });

  return [
    {
      label: t('app.context.execution'),
      value: executionValue,
      tone: context.execution.tone,
      active: activeTab === 'chat',
      target: { tab: 'chat' },
      title: t('app.context.executionTitle', { value: executionValue }),
    },
    {
      label: t('app.context.project'),
      value: projectValue,
      tone: context.project.tone,
      active: activeTab === 'projects',
      target: { tab: 'projects' },
      title: t('app.context.projectTitle', { value: projectValue }),
    },
    {
      label: t('app.context.session'),
      value: sessionValue,
      tone: context.session.tone,
      active: activeTab === 'chat',
      target: { tab: 'chat' },
      title: t('app.context.sessionTitle', { value: sessionValue }),
    },
    {
      label: t('app.context.memory'),
      value: memoryValue,
      tone: context.memory.tone,
      active: activeTab === 'library',
      target: { tab: 'library' },
      title: t('app.context.memoryTitle', { value: memoryValue }),
    },
    {
      label: t('app.context.browser'),
      value: browserValue,
      tone: context.browser.tone,
      active: activeTab === 'capabilities',
      target: { tab: 'capabilities', capabilitiesSubTab: 'browser' },
      title: formatBrowserTitle(context, browserValue, t),
    },
    {
      label: t('app.context.runtime'),
      value: runtimeValue,
      tone: context.runtime.tone,
      active: activeTab === 'capabilities',
      target: { tab: 'capabilities', capabilitiesSubTab: 'doctor' },
      title: formatRuntimeTitle(context, runtimeValue, t),
    },
    {
      label: t('app.context.tools'),
      value: toolsValue,
      tone: context.tools.tone,
      active: activeTab === 'capabilities',
      target: { tab: 'capabilities', capabilitiesSubTab: 'tools' },
      title: t('app.context.toolsTitle', { value: toolsValue }),
    },
  ];
}

function formatExecutionRoute(
  route: OperationalExecutionRoute,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  if (route === 'official-web') return t('app.context.executionWeb');
  if (route === 'official-api') return t('app.context.executionApi');
  if (route === 'browser-control') return t('app.context.executionBrowser');
  if (route === 'unavailable') return t('app.context.executionUnavailable');
  return t('app.context.executionUnknown');
}

function formatProject(
  context: GlobalOperationalContext,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  if (context.project.name) return context.project.name;
  if (context.project.source === 'unknown') return t('app.context.projectUnknown');
  return t('app.context.projectNone');
}

function formatSessionStrategy(
  strategy: OperationalSessionStrategy | null,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  if (strategy === 'current') return t('app.context.sessionCurrent');
  if (strategy === 'last') return t('app.context.sessionLast');
  if (strategy === 'new') return t('app.context.sessionNew');
  return t('app.context.sessionUnknown');
}

function formatMemory(
  state: OperationalMemoryState,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  if (state === 'enabled') return t('app.context.memoryOn');
  if (state === 'disabled') return t('app.context.memoryOff');
  return t('app.context.memoryUnavailable');
}

function formatBrowser(
  state: OperationalBrowserState,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  if (state === 'target-locked') return t('app.context.browserLocked');
  if (state === 'target-selected') return t('app.context.browserSelected');
  if (state === 'no-target') return t('app.context.browserNone');
  if (state === 'unavailable') return t('app.context.browserUnavailable');
  return t('app.context.browserUnknown');
}

function formatRuntime(
  state: OperationalRuntimeState,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  if (state === 'ready') return t('app.context.runtimeReady');
  if (state === 'blocked') return t('app.context.runtimeBlocked');
  if (state === 'needs_attention') return t('app.context.runtimeAttention');
  return t('app.context.runtimeUnknown');
}

function formatBrowserTitle(
  context: GlobalOperationalContext,
  value: string,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  const target = context.browser.targetLabel ?? context.browser.targetOrigin;
  if (target) return t('app.context.browserTitleWithTarget', { value, target });
  return t('app.context.browserTitle', { value });
}

function formatRuntimeTitle(
  context: GlobalOperationalContext,
  value: string,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  const blockerCount = context.runtime.blockerCount;
  if (blockerCount === null) return t('app.context.runtimeTitle', { value });
  return t('app.context.runtimeTitleWithBlockers', { value, count: blockerCount });
}
