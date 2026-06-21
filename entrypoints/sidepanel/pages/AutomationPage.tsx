import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Automation,
  AutomationCreateInput,
  AutomationFlightEventStatus,
  AutomationPromptOptions,
  AutomationRun,
  AutomationSchedule,
  AutomationScheduleKind,
} from '../../../core/automation/types';
import {
  DEFAULT_PERSONAL_CONVENIENCE_CONFIG,
  normalizePersonalConvenienceConfig,
  type PersonalConvenienceConfig,
} from '../../../core/personal-convenience/config';
import { validateAutomationSchedule } from '../../../core/automation/schedule';
import {
  DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES,
  DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES,
  DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN,
  createDeepSeekWebVisionRoute,
  normalizeDeepSeekWebVisionRefFileIds,
  serializeDeepSeekWebVisionFile,
} from '../../../core/deepseek/web-vision';
import type { LocaleMessageKey, SupportedLocale } from '../../../core/i18n';
import PageIntro from '../components/PageIntro';
import { SkeletonList, ToggleRow, useBanner, useConfirm } from '../components/settings/primitives';
import ToggleSwitch from '../components/ToggleSwitch';
import { useI18n } from '../i18n';

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';

const DEFAULT_PROMPT_OPTIONS: AutomationPromptOptions = {
  modelType: null,
  searchEnabled: false,
  thinkingEnabled: false,
  refFileIds: [],
  webVisionFiles: [],
  visualMonitor: {
    enabled: true,
    source: 'browser_control_target',
    includeEvidencePack: true,
  },
};

const FLIGHT_RECORDER_VISIBLE_EVENTS = 6;

type FormState = {
  name: string;
  prompt: string;
  scheduleKind: AutomationScheduleKind;
  expression: string;
  timezone: string;
  modelType: string;
  searchEnabled: boolean;
  thinkingEnabled: boolean;
  refFileIdsText: string;
  visualMonitorEnabled: boolean;
};

type AutomationImageAttachment = {
  id: string;
  file: File;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

const EMPTY_FORM: FormState = {
  name: '',
  prompt: '',
  scheduleKind: 'manual',
  expression: '',
  timezone: DEFAULT_TIMEZONE,
  modelType: '',
  searchEnabled: false,
  thinkingEnabled: false,
  refFileIdsText: '',
  visualMonitorEnabled: true,
};

export default function AutomationPage() {
  const { t } = useI18n();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<Record<string, AutomationRun[]>>({});
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [personalConfig, setPersonalConfig] = useState<PersonalConvenienceConfig>(DEFAULT_PERSONAL_CONVENIENCE_CONFIG);
  const [imageAttachments, setImageAttachments] = useState<AutomationImageAttachment[]>([]);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();

  const activeCount = useMemo(
    () => automations.filter((item) => item.status === 'active').length,
    [automations],
  );

  const load = async () => {
    const list: Automation[] = await chrome.runtime.sendMessage({ type: 'GET_AUTOMATIONS' });
    const items = list ?? [];
    setAutomations(items);
    const runEntries = await Promise.all(
      items.map(async (automation) => {
        const recent: AutomationRun[] = await chrome.runtime.sendMessage({
          type: 'GET_AUTOMATION_RUNS',
          payload: { automationId: automation.id, limit: 5 },
        });
        return [automation.id, recent ?? []] as const;
      }),
    );
    setRuns(Object.fromEntries(runEntries));
    setLoading(false);
  };

  useEffect(() => {
    void load();
    chrome.runtime.sendMessage({ type: 'GET_PERSONAL_CONVENIENCE_CONFIG' })
      .then((result) => setPersonalConfig(normalizePersonalConvenienceConfig(result?.config)))
      .catch(() => setPersonalConfig(DEFAULT_PERSONAL_CONVENIENCE_CONFIG));

    const handleUpdate = (msg: { type?: string; automations?: Automation[] }) => {
      if (msg.type === 'AUTOMATIONS_UPDATED' || msg.type === 'AUTOMATION_RUNS_UPDATED') {
        void load();
      }
      if (msg.type === 'AUTOMATIONS_UPDATED' && Array.isArray(msg.automations)) {
        setAutomations(msg.automations);
      }
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) void load();
    };

    chrome.runtime.onMessage.addListener(handleUpdate);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);

    return () => {
      chrome.runtime.onMessage.removeListener(handleUpdate);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, []);

  const startCreate = () => {
    setEditing(null);
    setForm(createEmptyForm(personalConfig));
    setImageAttachments([]);
    banner.clear();
    setShowForm((prev) => !prev);
  };

  const startEdit = (automation: Automation) => {
    setEditing(automation);
    setForm(fromAutomation(automation));
    setImageAttachments([]);
    banner.clear();
    setShowForm(true);
  };

  const save = async () => {
    const payload = toAutomationInput(form);
    if (editing?.promptOptions.webVisionFiles?.length) {
      payload.promptOptions.webVisionFiles = editing.promptOptions.webVisionFiles;
    }
    if (!payload.name || !payload.prompt) {
      banner.show('error', t('sidepanel.automationPage.namePromptRequired'));
      return;
    }
    if (payload.schedule.enabled && !payload.schedule.expression) {
      banner.show('error', t('sidepanel.automationPage.expressionRequired'));
      return;
    }
    const scheduleValidation = validateAutomationSchedule(payload.schedule);
    if (!scheduleValidation.ok) {
      banner.show('error', scheduleValidation.error.message);
      return;
    }

    const images = [];
    try {
      for (const attachment of imageAttachments) {
        images.push(await serializeDeepSeekWebVisionFile(attachment.file));
      }
    } catch (err) {
      banner.show('error', err instanceof Error ? err.message : String(err));
      return;
    }

    const response = editing
      ? await chrome.runtime.sendMessage({
        type: 'UPDATE_AUTOMATION',
        payload: { id: editing.id, patch: payload, ...(images.length > 0 ? { images } : {}) },
      })
      : await chrome.runtime.sendMessage({
        type: 'CREATE_AUTOMATION',
        payload: { ...payload, ...(images.length > 0 ? { images } : {}) },
      });

    if (response?.ok === false && response.error) {
      banner.show('error', typeof response.error === 'string' ? response.error : response.error.message);
      return;
    }

    if (response?.lastError) {
      banner.show('error', response.lastError.message);
      return;
    }
    banner.show('success', editing ? t('common.saveChanges') : t('sidepanel.automationPage.created'));
    setShowForm(false);
    setEditing(null);
    setImageAttachments([]);
    await load();
  };

  const addImageFiles = (files: FileList | null) => {
    if (!files) return;
    const images = Array.from(files).filter((file) =>
      DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase()) &&
      file.size > 0 &&
      file.size <= DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES
    );
    if (images.length === 0) return;
    const remaining = DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN - imageAttachments.length;
    if (remaining <= 0) {
      banner.show('error', `Attach at most ${DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN} images per automation.`);
      return;
    }
    const selected = images.slice(0, remaining);
    if (images.length > remaining) {
      banner.show('error', `Attach at most ${DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN} images per automation.`);
    }
    setImageAttachments((prev) => [
      ...prev,
      ...selected.map((file) => ({
        id: crypto.randomUUID(),
        file,
        name: file.name || 'image',
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      })),
    ]);
  };

  const removeImageAttachment = (id: string) => {
    setImageAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  };

  const runNow = async (id: string) => {
    setRunningIds((prev) => new Set(prev).add(id));
    banner.clear();
    try {
      const run: AutomationRun | { ok: false; error: string } | null = await chrome.runtime.sendMessage({
        type: 'RUN_AUTOMATION_NOW',
        payload: { id },
      });
      if (run && 'error' in run && typeof run.error === 'string') {
        banner.show('error', run.error);
      } else if (run && 'status' in run && (run.status === 'failed' || run.status === 'timeout')) {
        banner.show('error', run.error?.message ?? t('sidepanel.automationPage.runFailed'));
      }
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await load();
    }
  };

  const toggleStatus = async (automation: Automation) => {
    await chrome.runtime.sendMessage({
      type: 'SET_AUTOMATION_STATUS',
      payload: { id: automation.id, status: automation.status === 'active' ? 'paused' : 'active' },
    });
    await load();
  };

  const remove = async (automation: Automation) => {
    const ok = await confirm({
      title: t('sidepanel.automationPage.deleteConfirm', { name: automation.name }),
      message: t('sidepanel.automationPage.deleteConfirm', { name: automation.name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    await chrome.runtime.sendMessage({ type: 'DELETE_AUTOMATION', payload: { id: automation.id } });
    await load();
  };

  const openSession = async (url: string | null) => {
    if (!url) return;
    await chrome.tabs.create({ url, active: true });
  };

  return (
    <div className="ds-page">
      <PageIntro
        title={t('sidepanel.automationPage.title')}
        description={t('sidepanel.automationPage.description')}
        meta={t('sidepanel.automationPage.summary', { total: automations.length, active: activeCount })}
        actions={(
        <button
          onClick={startCreate}
          className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t('sidepanel.automationPage.create')}
        </button>
        )}
      />

      {banner.node}
      {confirmNode}

      {showForm && (
        <div className="animate-slide-down">
          <AutomationForm
            form={form}
            editing={editing}
            imageAttachments={imageAttachments}
            onChange={setForm}
            onAddImages={addImageFiles}
            onRemoveImage={removeImageAttachment}
            onSave={save}
            onCancel={() => { setShowForm(false); setEditing(null); setImageAttachments([]); banner.clear(); }}
          />
        </div>
      )}

      {loading ? (
        <SkeletonList rows={3} />
      ) : automations.length === 0 && !showForm ? (
        <div className="ds-empty-state">
          <div className="ds-empty-state-icon">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="ds-empty-state-title">{t('sidepanel.automationPage.empty')}</div>
          <div className="ds-empty-state-description">{t('sidepanel.automationPage.emptyHelp')}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {automations.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              runs={runs[automation.id] ?? []}
              running={runningIds.has(automation.id)}
              sessionStrategy={personalConfig.sameSessionStrategy}
              onRun={() => runNow(automation.id)}
              onToggleStatus={() => toggleStatus(automation)}
              onEdit={() => startEdit(automation)}
              onDelete={() => remove(automation)}
              onOpenSession={() => openSession(automation.deepseek.sessionUrl)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AutomationForm({
  form,
  editing,
  imageAttachments,
  onChange,
  onAddImages,
  onRemoveImage,
  onSave,
  onCancel,
}: {
  form: FormState;
  editing: Automation | null;
  imageAttachments: AutomationImageAttachment[];
  onChange: (form: FormState) => void;
  onAddImages: (files: FileList | null) => void;
  onRemoveImage: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    onChange({ ...form, [key]: value });
  };
  const isScheduled = form.scheduleKind !== 'manual';
  const handleFiles = (files: FileList | null) => {
    onAddImages(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="ds-form rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-1 gap-2">
        <label className="space-y-1">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>{t('sidepanel.automationPage.form.name')}</span>
          <input
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="ds-input w-full px-3 py-2 text-xs rounded-lg"
            placeholder={t('sidepanel.automationPage.form.namePlaceholder')}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>{t('sidepanel.automationPage.form.model')}</span>
          <select
            value={form.modelType}
            onChange={(e) => update('modelType', e.target.value)}
            className="ds-input w-full px-3 py-2 text-xs rounded-lg"
          >
            <option value="">{t('sidepanel.automationPage.form.defaultModel')}</option>
            <option value="expert">Expert</option>
            <option value="vision">Vision</option>
          </select>
        </label>
      </div>

      <label className="space-y-1 block">
        <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>Vision file refs</span>
        <input
          value={form.refFileIdsText}
          onChange={(e) => update('refFileIdsText', e.target.value)}
          className="ds-input w-full px-3 py-2 text-xs rounded-lg"
          placeholder="file-..."
        />
      </label>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(event) => handleFiles(event.currentTarget.files)}
      />
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg"
        >
          Attach image
        </button>
        {imageAttachments.length > 0 && (
          <div className="ds-chat-attachment-tray flex-1 justify-end">
            {imageAttachments.map((attachment) => (
              <span key={attachment.id} className="ds-chat-attachment-chip">
                {attachment.name}
                <button
                  type="button"
                  onClick={() => onRemoveImage(attachment.id)}
                  aria-label={`Remove ${attachment.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <label className="space-y-1 block">
        <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>{t('sidepanel.automationPage.form.prompt')}</span>
        <textarea
          value={form.prompt}
          onChange={(e) => update('prompt', e.target.value)}
          className="ds-input w-full px-3 py-2 text-xs rounded-lg min-h-28 resize-y"
          placeholder={t('sidepanel.automationPage.form.promptPlaceholder')}
        />
      </label>

      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-1">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>{t('sidepanel.automationPage.form.trigger')}</span>
          <select
            value={form.scheduleKind}
            onChange={(e) => update('scheduleKind', e.target.value as AutomationScheduleKind)}
            className="ds-input w-full px-3 py-2 text-xs rounded-lg"
          >
            <option value="manual">{t('sidepanel.automationPage.form.manual')}</option>
            <option value="cron">Cron</option>
            <option value="rrule">RRULE</option>
          </select>
        </label>
        <label className="space-y-1 col-span-2">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>{t('sidepanel.automationPage.form.expression')}</span>
          <input
            value={isScheduled ? form.expression : ''}
            onChange={(e) => update('expression', e.target.value)}
            disabled={!isScheduled}
            className="ds-input w-full px-3 py-2 text-xs rounded-lg disabled:opacity-50"
            placeholder={form.scheduleKind === 'rrule' ? 'FREQ=HOURLY;INTERVAL=1' : '0 9 * * *'}
          />
        </label>
      </div>

      <label className="space-y-1 block">
        <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>{t('sidepanel.automationPage.form.timezone')}</span>
        <input
          value={form.timezone}
          onChange={(e) => update('timezone', e.target.value)}
          className="ds-input w-full px-3 py-2 text-xs rounded-lg"
          placeholder="Asia/Shanghai"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <ToggleSwitch
          checked={form.searchEnabled}
          onChange={(searchEnabled) => update('searchEnabled', searchEnabled)}
          label={t('sidepanel.automationPage.form.search')}
        />
        <ToggleSwitch
          checked={form.thinkingEnabled}
          onChange={(thinkingEnabled) => update('thinkingEnabled', thinkingEnabled)}
          label={t('sidepanel.automationPage.form.thinking')}
        />
      </div>

      <ToggleRow
        title={t('sidepanel.automationPage.form.visualMonitor')}
        description={t('sidepanel.automationPage.form.visualMonitorDescription')}
        enabled={form.visualMonitorEnabled}
        onToggle={(next) => update('visualMonitorEnabled', next)}
      />

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="ds-btn-cancel px-3 py-1.5 text-xs rounded-lg">
          {t('common.cancel')}
        </button>
        <button onClick={onSave} className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg">
          {editing ? t('common.save') : t('sidepanel.automationPage.form.create')}
        </button>
      </div>
    </div>
  );
}

function AutomationCard({
  automation,
  runs,
  running,
  sessionStrategy,
  onRun,
  onToggleStatus,
  onEdit,
  onDelete,
  onOpenSession,
}: {
  automation: Automation;
  runs: AutomationRun[];
  running: boolean;
  sessionStrategy: PersonalConvenienceConfig['sameSessionStrategy'];
  onRun: () => void;
  onToggleStatus: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenSession: () => void;
}) {
  const { t, locale } = useI18n();
  const latestRun = runs[0];
  const statusColor = automation.status === 'active' ? 'var(--ds-success)' : 'var(--ds-text-tertiary)';
  const statusBg = automation.status === 'active' ? 'var(--ds-success-bg)' : 'var(--ds-surface)';

  return (
    <div className="ds-card rounded-xl p-3 space-y-2 animate-fade-in">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-[13px] font-medium truncate" style={{ color: 'var(--ds-text)' }}>
              {automation.name}
            </h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ color: statusColor, background: statusBg }}>
              {automation.status === 'active' ? t('sidepanel.automationPage.status.active') : t('sidepanel.automationPage.status.paused')}
            </span>
          </div>
          <p className="text-[11px] mt-1 line-clamp-2" style={{ color: 'var(--ds-text-secondary)' }}>
            {automation.prompt}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconButton title={automation.status === 'active' ? t('sidepanel.automationPage.status.paused') : t('sidepanel.automationPage.status.active')} path={automation.status === 'active' ? 'M10 9v6m4-6v6' : 'M5 3l14 9-14 9V3z'} onClick={onToggleStatus} />
          <IconButton title={t('common.edit')} path="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7 M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" onClick={onEdit} />
          <IconButton title={t('common.delete')} path="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-9 0h12" onClick={onDelete} danger />
        </div>
      </div>

      <div className="ds-metric-strip">
        <MetaChip label={t('sidepanel.automationPage.meta.next')} value={formatTime(automation.nextRunAt, locale, t('sidepanel.automationPage.meta.none'))} />
        <MetaChip label={t('sidepanel.automationPage.meta.previous')} value={formatTime(automation.lastRunAt, locale, t('sidepanel.automationPage.meta.none'))} />
        <MetaChip label={t('sidepanel.automationPage.meta.session')} value={automation.deepseek.chatSessionId ? shortId(automation.deepseek.chatSessionId) : t('sidepanel.automationPage.meta.notCreated')} />
        <MetaChip label={t('sidepanel.automationPage.meta.recent')} value={latestRun ? formatRun(latestRun, t) : t('sidepanel.automationPage.meta.none')} />
        <MetaChip label={t('sidepanel.automationPage.meta.visual')} value={automation.promptOptions.visualMonitor?.enabled ? t('sidepanel.automationPage.meta.monitorOn') : t('sidepanel.automationPage.meta.monitorOff')} />
        <MetaChip label={t('sidepanel.automationPage.meta.strategy')} value={formatSessionStrategy(sessionStrategy, t)} />
      </div>

      {latestRun && (
        <RunFlightRecorder run={latestRun} />
      )}

      {automation.lastError && (
        <div className="rounded-lg px-2.5 py-2 text-[11px]" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)' }}>
          {automation.lastError.message}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onOpenSession}
          disabled={!automation.deepseek.sessionUrl}
          className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg disabled:opacity-50"
        >
          {t('sidepanel.automationPage.actions.openSession')}
        </button>
        <button
          onClick={onRun}
          disabled={running}
          className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg disabled:opacity-60"
        >
          {running ? t('sidepanel.automationPage.status.running') : t('sidepanel.automationPage.actions.runNow')}
        </button>
      </div>
    </div>
  );
}

function RunFlightRecorder({ run }: { run: AutomationRun }) {
  const { t, locale } = useI18n();
  const recorder = run.flightRecorder;
  if (!recorder) {
    return (
      <details className="rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--ds-border)' }}>
        <summary className="cursor-pointer text-[11px] font-medium" style={{ color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.automationPage.flightRecorder.title')}
        </summary>
        <div className="mt-2 text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.automationPage.flightRecorder.noRecorder')}
        </div>
      </details>
    );
  }
  const events = recorder.events.slice(-FLIGHT_RECORDER_VISIBLE_EVENTS);
  return (
    <details className="rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--ds-border)' }}>
      <summary className="cursor-pointer text-[11px] font-medium" style={{ color: 'var(--ds-text-secondary)' }}>
        {t('sidepanel.automationPage.flightRecorder.title')}
        {' · '}
        {formatRecorderSession(recorder.session.source, t)}
        {' · '}
        {recorder.visual.attachedRefCount > 0
          ? t('sidepanel.automationPage.flightRecorder.visualAttached', { count: recorder.visual.attachedRefCount })
          : t('sidepanel.automationPage.flightRecorder.visualNone')}
      </summary>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <MetaChip label={t('sidepanel.automationPage.flightRecorder.auth')} value={recorder.auth.hasWebAuth ? t('common.enabled') : t('common.disabled')} />
        <MetaChip label={t('sidepanel.automationPage.flightRecorder.evidence')} value={String(recorder.visual.evidencePackCount)} />
        <MetaChip label={t('sidepanel.automationPage.flightRecorder.updated')} value={formatTime(recorder.updatedAt, locale, t('sidepanel.automationPage.meta.none'))} />
      </div>
      <div className="mt-2 space-y-1.5">
        {events.map((event) => (
          <div
            key={event.id}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-[11px]"
            style={{ color: 'var(--ds-text-secondary)' }}
          >
            <span
              className="mt-1 h-2 w-2 rounded-full"
              style={{ background: flightStatusColor(event.status) }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="font-medium truncate" style={{ color: 'var(--ds-text)' }}>
                {event.label}
              </div>
              <div className="line-clamp-2">{event.summary}</div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function IconButton({
  title,
  path,
  onClick,
  danger,
}: {
  title: string;
  path: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`ds-action-btn w-7 h-7 rounded-lg flex items-center justify-center ${danger ? 'ds-action-btn-delete' : 'ds-action-btn-edit'}`}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      </svg>
    </button>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="ds-metric-chip min-w-[calc(50%-4px)] flex-1">
      <span className="ds-metric-chip-label">{label}</span>
      <span className="ds-metric-chip-value truncate">{value}</span>
    </div>
  );
}

function createEmptyForm(personalConfig: PersonalConvenienceConfig): FormState {
  return {
    ...EMPTY_FORM,
    visualMonitorEnabled: personalConfig.visualMonitorDefault,
  };
}

function fromAutomation(automation: Automation): FormState {
  return {
    name: automation.name,
    prompt: automation.prompt,
    scheduleKind: automation.schedule.kind,
    expression: automation.schedule.expression ?? '',
    timezone: automation.schedule.timezone || DEFAULT_TIMEZONE,
    modelType: normalizeFormModelType(automation.promptOptions.modelType),
    searchEnabled: automation.promptOptions.searchEnabled,
    thinkingEnabled: automation.promptOptions.thinkingEnabled,
    refFileIdsText: automation.promptOptions.refFileIds.join(', '),
    visualMonitorEnabled: automation.promptOptions.visualMonitor?.enabled === true,
  };
}

function toAutomationInput(form: FormState): AutomationCreateInput {
  const schedule = buildSchedule(form);
  const refFileIds = parseVisionRefFileIds(form.refFileIdsText);
  const route = createDeepSeekWebVisionRoute({
    modelType: form.modelType.trim() || null,
    refFileIds,
    thinkingEnabled: form.thinkingEnabled,
    searchEnabled: form.searchEnabled,
  });
  return {
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    schedule,
    promptOptions: {
      ...DEFAULT_PROMPT_OPTIONS,
      modelType: route.modelType,
      searchEnabled: route.searchEnabled,
      thinkingEnabled: route.thinkingEnabled,
      refFileIds: route.refFileIds,
      visualMonitor: form.visualMonitorEnabled
        ? {
          enabled: true,
          source: 'browser_control_target',
          includeEvidencePack: true,
        }
        : undefined,
    },
  };
}

function buildSchedule(form: FormState): AutomationSchedule {
  const enabled = form.scheduleKind !== 'manual';
  return {
    kind: form.scheduleKind,
    expression: enabled ? form.expression.trim() : null,
    timezone: form.timezone.trim() || DEFAULT_TIMEZONE,
    enabled,
    minimumIntervalMinutes: 15,
  };
}

function formatTime(value: number | null, locale: SupportedLocale, emptyText: string): string {
  if (!value) return emptyText;
  return new Date(value).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRun(run: AutomationRun, t: ReturnType<typeof useI18n>['t']): string {
  const label: Record<AutomationRun['status'], string> = {
    queued: t('sidepanel.automationPage.status.queued'),
    running: t('sidepanel.automationPage.status.running'),
    succeeded: t('sidepanel.automationPage.status.succeeded'),
    failed: t('sidepanel.automationPage.status.failed'),
    timeout: t('sidepanel.automationPage.status.timeout'),
    cancelled: t('sidepanel.automationPage.status.cancelled'),
    skipped: t('sidepanel.automationPage.status.skipped'),
  };
  return `${label[run.status]}${run.attempt > 1 ? ` · ${t('sidepanel.automationPage.attempt', { count: run.attempt })}` : ''}`;
}

function formatSessionStrategy(
  strategy: PersonalConvenienceConfig['sameSessionStrategy'],
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (strategy === 'last') return t('sidepanel.automationPage.sessionStrategy.last');
  if (strategy === 'new') return t('sidepanel.automationPage.sessionStrategy.new');
  return t('sidepanel.automationPage.sessionStrategy.current');
}

function formatRecorderSession(
  source: NonNullable<AutomationRun['flightRecorder']>['session']['source'],
  t: ReturnType<typeof useI18n>['t'],
): string {
  return t(`sidepanel.automationPage.flightRecorder.sessionSources.${source}` as LocaleMessageKey);
}

function flightStatusColor(status: AutomationFlightEventStatus): string {
  if (status === 'success') return 'var(--ds-success)';
  if (status === 'error') return 'var(--ds-danger)';
  if (status === 'warning') return 'var(--ds-warning, var(--ds-text-secondary))';
  return 'var(--ds-text-tertiary)';
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function normalizeFormModelType(modelType: string | null): string {
  if (!modelType || modelType === 'default' || modelType === 'DEFAULT' || modelType === 'chat' || modelType === 'deepseek_chat') {
    return '';
  }
  if (modelType === 'reasoner' || modelType === 'deepseek_reasoner') return 'expert';
  if (modelType === 'expert' || modelType === 'vision') return modelType;
  return '';
}

function parseVisionRefFileIds(value: string): string[] {
  return normalizeDeepSeekWebVisionRefFileIds(value.split(/[\s,]+/));
}
