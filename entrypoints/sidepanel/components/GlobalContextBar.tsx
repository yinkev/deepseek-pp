import { useEffect, useState } from 'react';
import { getChatEnabled } from '../../../core/chat/store';
import type { RuntimeDoctorReport } from '../../../core/chat/runtime-doctor';
import type { LocaleMessageKey } from '../../../core/i18n';
import { useI18n } from '../i18n';

type AppTab = 'chat' | 'library' | 'projects' | 'capabilities' | 'settings';

interface GlobalContextBarProps {
  activeTab: AppTab;
  onNavigate: (tab: AppTab) => void;
}

interface ContextState {
  chatEnabled: boolean | null;
  report: RuntimeDoctorReport | null;
}

export default function GlobalContextBar({ activeTab, onNavigate }: GlobalContextBarProps) {
  const { t } = useI18n();
  const [state, setState] = useState<ContextState>({ chatEnabled: null, report: null });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [chatEnabled, report] = await Promise.all([
        getStoredChatEnabled(),
        getRuntimeDoctorReport(),
      ]);

      if (!cancelled) {
        setState({ chatEnabled, report });
      }
    };

    void load();

    const storageHandler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (
        'deepseek_pp_chat_enabled' in changes ||
        'deepseek_pp_browser_control_settings' in changes ||
        'deepseek_pp_personal_convenience' in changes
      ) {
        void load();
      }
    };

    if (typeof chrome !== 'undefined') chrome.storage?.onChanged?.addListener(storageHandler);
    return () => {
      cancelled = true;
      if (typeof chrome !== 'undefined') chrome.storage?.onChanged?.removeListener(storageHandler);
    };
  }, []);

  const providerLabel = formatProvider(state.report?.provider, state.chatEnabled, t);
  const providerKnown = state.report?.provider === 'official-api' || state.report?.provider === 'deepseek-web';
  const providerTone = state.chatEnabled === false || !providerKnown ? 'unknown' : 'ready';
  const readiness = state.report?.readiness;
  const readinessStatus = readiness?.status;
  const runtimeTone = readinessStatus === 'ready' || readinessStatus === 'needs_attention' || readinessStatus === 'blocked'
    ? readinessStatus
    : 'unknown';
  const runtimeLabel = formatRuntime(state.report, t);
  const browserControl = state.report?.browserControl;
  const browserSelected = browserControl?.targetSelected === true;
  const browserReady = browserControl?.monitorReady === true;
  const browserTone = browserReady
    ? 'ready'
    : browserSelected
      ? 'attention'
      : 'unknown';
  const browserLabel = browserReady
    ? t('app.context.browserReady')
    : browserSelected
      ? t('app.context.browserSelected')
      : t('app.context.browserNone');

  return (
    <div className="ds-context-bar" aria-label={t('app.context.label')}>
      <ContextButton
        label={t('app.context.provider')}
        value={providerLabel}
        tone={providerTone}
        active={activeTab === 'chat'}
        onClick={() => onNavigate('chat')}
      />
      <ContextButton
        label={t('app.context.memory')}
        value={t('app.context.memoryOn')}
        tone="ready"
        active={activeTab === 'library'}
        onClick={() => onNavigate('library')}
      />
      <ContextButton
        label={t('app.context.browser')}
        value={browserLabel}
        tone={browserTone}
        active={activeTab === 'capabilities'}
        onClick={() => onNavigate('capabilities')}
      />
      <ContextButton
        label={t('app.context.runtime')}
        value={runtimeLabel}
        tone={runtimeTone === 'blocked' ? 'blocked' : runtimeTone === 'needs_attention' ? 'attention' : runtimeTone === 'ready' ? 'ready' : 'unknown'}
        active={activeTab === 'capabilities'}
        onClick={() => onNavigate('capabilities')}
      />
    </div>
  );
}

function ContextButton({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  tone: 'ready' | 'attention' | 'blocked' | 'unknown';
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`ds-context-item ds-context-item-${tone}${active ? ' ds-context-item-active' : ''}`}
      onClick={onClick}
      title={`${label}: ${value}`}
    >
      <span className="ds-context-dot" aria-hidden="true" />
      <span className="ds-context-label">{label}</span>
      <span className="ds-context-value">{value}</span>
    </button>
  );
}

function formatProvider(
  provider: RuntimeDoctorReport['provider'] | undefined,
  chatEnabled: boolean | null,
  t: (key: LocaleMessageKey) => string,
): string {
  if (chatEnabled === false) return t('app.context.chatOff');
  if (provider === 'official-api') return t('app.context.providerApi');
  if (provider === 'deepseek-web') return t('app.context.providerWeb');
  return t('app.context.providerUnknown');
}

function formatRuntime(report: RuntimeDoctorReport | null, t: (key: LocaleMessageKey) => string): string {
  const status = report?.readiness?.status;
  if (status === 'ready') return t('app.context.runtimeReady');
  if (status === 'blocked') return t('app.context.runtimeBlocked');
  if (status === 'needs_attention') return t('app.context.runtimeAttention');
  return t('app.context.runtimeUnknown');
}

async function getStoredChatEnabled(): Promise<boolean | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  try {
    return await getChatEnabled();
  } catch {
    return null;
  }
}

async function getRuntimeDoctorReport(): Promise<RuntimeDoctorReport | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
  try {
    const value = await chrome.runtime.sendMessage({ type: 'GET_RUNTIME_DOCTOR_REPORT' });
    return isRuntimeDoctorReport(value) ? value : null;
  } catch {
    return null;
  }
}

function isRuntimeDoctorReport(value: unknown): value is RuntimeDoctorReport {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RuntimeDoctorReport>;
  return record.ok === true && typeof record.generatedAt === 'number';
}
