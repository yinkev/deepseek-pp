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
  AUTOMATION_WORKFLOW_TEMPLATES,
  createAutomationInputFromWorkflowTemplate,
  type AutomationWorkflowTemplateCategory,
  type AutomationWorkflowTemplate,
} from '../../../core/automation/workflow-templates';
import {
  applyPromptAutomationReadinessFixes,
  applySafeAutomationReadinessFixes,
  evaluateAutomationReadiness,
  getPromptAutomationReadinessFixes,
  getSafeAutomationReadinessFixes,
  type AutomationReadinessIssueCode,
  type AutomationReadinessReport,
} from '../../../core/automation/readiness';
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
const TEMPLATE_CATEGORY_FILTERS: Array<'all' | AutomationWorkflowTemplateCategory> = [
  'all',
  'readiness',
  'research',
  'project',
  'browser',
  'quality',
  'prompt',
  'memory',
];
const SESSION_STRATEGY_SEQUENCE: Array<PersonalConvenienceConfig['sameSessionStrategy']> = ['last', 'current', 'new'];
const AUTOMATION_LIST_FILTERS = ['all', 'active', 'paused', 'blocked'] as const;
type AutomationListFilter = typeof AUTOMATION_LIST_FILTERS[number];

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
  const [automationQuery, setAutomationQuery] = useState('');
  const [automationListFilter, setAutomationListFilter] = useState<AutomationListFilter>('all');
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();

  const automationListCounts = useMemo(() => {
    const counts: Record<AutomationListFilter, number> = {
      all: automations.length,
      active: 0,
      paused: 0,
      blocked: 0,
    };
    for (const automation of automations) {
      if (automation.status === 'active') counts.active += 1;
      if (automation.status === 'paused') counts.paused += 1;
      if (evaluateAutomationReadiness(automation).status === 'blocked') counts.blocked += 1;
    }
    return counts;
  }, [automations]);
  const filteredAutomations = useMemo(() => {
    const query = automationQuery.trim().toLowerCase();
    return automations.filter((automation) => {
      if (automationListFilter === 'active' && automation.status !== 'active') return false;
      if (automationListFilter === 'paused' && automation.status !== 'paused') return false;
      if (automationListFilter === 'blocked' && evaluateAutomationReadiness(automation).status !== 'blocked') return false;
      if (!query) return true;
      return automation.name.toLowerCase().includes(query) ||
        automation.prompt.toLowerCase().includes(query);
    });
  }, [automations, automationListFilter, automationQuery]);
  const automationFiltersActive = automationQuery.trim().length > 0 || automationListFilter !== 'all';

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

  const applyWorkflowTemplate = (template: AutomationWorkflowTemplate) => {
    const input = createLocalizedAutomationInputFromWorkflowTemplate(template, DEFAULT_TIMEZONE, t);
    setEditing(null);
    setForm(fromAutomationInput(input));
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
    const readiness = evaluateAutomationReadiness(payload, { transientImageCount: imageAttachments.length });
    const safeFixCodes = getSafeAutomationReadinessFixes(readiness);
    if (safeFixCodes.length > 0) {
      payload.promptOptions = applySafeAutomationReadinessFixes(payload.promptOptions, safeFixCodes);
    }
    const finalReadiness = safeFixCodes.length > 0
      ? evaluateAutomationReadiness(payload, { transientImageCount: imageAttachments.length })
      : readiness;
    const blocker = finalReadiness.issues.find((issue) => issue.severity === 'blocker');
    if (blocker) {
      banner.show('error', formatReadinessIssue(blocker.code, t));
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

  const cycleSessionStrategy = async () => {
    const index = SESSION_STRATEGY_SEQUENCE.indexOf(personalConfig.sameSessionStrategy);
    const sameSessionStrategy = SESSION_STRATEGY_SEQUENCE[(index + 1) % SESSION_STRATEGY_SEQUENCE.length];
    const optimistic = normalizePersonalConvenienceConfig({ ...personalConfig, sameSessionStrategy });
    setPersonalConfig(optimistic);
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'SAVE_PERSONAL_CONVENIENCE_CONFIG',
        payload: { sameSessionStrategy },
      });
      setPersonalConfig(normalizePersonalConvenienceConfig(result?.config ?? optimistic));
    } catch {
      setPersonalConfig(personalConfig);
    }
  };

  const prepareAutomation = async (automation: Automation) => {
    const report = evaluateAutomationReadiness(automation);
    if (report.status === 'blocked') return;
    const safeFixCodes = getSafeAutomationReadinessFixes(report);
    const promptFixCodes = getPromptAutomationReadinessFixes(report);
    if (safeFixCodes.length === 0 && promptFixCodes.length === 0) return;

    const patch: Partial<Pick<Automation, 'prompt' | 'promptOptions'>> = {};
    if (safeFixCodes.length > 0) {
      patch.promptOptions = applySafeAutomationReadinessFixes(automation.promptOptions, safeFixCodes);
    }
    if (promptFixCodes.length > 0) {
      patch.prompt = applyPromptAutomationReadinessFixes(automation.prompt, promptFixCodes);
    }

    const response = await chrome.runtime.sendMessage({
      type: 'UPDATE_AUTOMATION',
      payload: { id: automation.id, patch },
    });
    if (response?.ok === false && response.error) {
      banner.show('error', typeof response.error === 'string' ? response.error : response.error.message);
      return;
    }
    banner.show('success', t('sidepanel.automationPage.readiness.noIssues'));
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
        meta={t('sidepanel.automationPage.summary', { total: automations.length, active: automationListCounts.active })}
        actions={(
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void cycleSessionStrategy()}
            className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg"
            title={t('sidepanel.automationPage.changeSessionStrategy')}
            aria-label={t('sidepanel.automationPage.changeSessionStrategy')}
          >
            {t('sidepanel.automationPage.meta.strategy')}: {formatSessionStrategy(personalConfig.sameSessionStrategy, t)}
          </button>
          <button
            onClick={startCreate}
            className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t('sidepanel.automationPage.create')}
          </button>
        </div>
        )}
      />

      {banner.node}
      {confirmNode}

      {!editing && !showForm && (
        <AutomationTemplatePicker onUse={applyWorkflowTemplate} />
      )}

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

      {!showForm && automations.length > 0 && (
        <div className="space-y-2">
          <input
            value={automationQuery}
            onChange={(event) => setAutomationQuery(event.target.value)}
            className="ds-input w-full px-3 py-2 text-xs rounded-lg"
            placeholder={t('sidepanel.automationPage.filterPlaceholder')}
          />
          <div className="flex flex-wrap gap-1.5">
            {AUTOMATION_LIST_FILTERS.map((filter) => {
              const selected = automationListFilter === filter;
              const label = t(`sidepanel.automationPage.filters.${filter}` as LocaleMessageKey);
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setAutomationListFilter(filter)}
                  aria-label={label}
                  aria-pressed={selected}
                  className={`px-2 py-1 text-[11px] rounded-md inline-flex items-center gap-1.5 ${selected ? 'ds-btn-primary text-white' : 'ds-btn-secondary'}`}
                >
                  <span>{label}</span>
                  <span className="font-mono text-[10px] opacity-80">{automationListCounts[filter]}</span>
                </button>
              );
            })}
            {automationFiltersActive && (
              <button
                type="button"
                onClick={() => { setAutomationQuery(''); setAutomationListFilter('all'); }}
                className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md"
              >
                {t('sidepanel.automationPage.clearFilters')}
              </button>
            )}
          </div>
          {automationFiltersActive && (
            <div className="text-[11px] text-[var(--ds-text-muted)]">
              {t('sidepanel.automationPage.filterResultCount', {
                visible: filteredAutomations.length,
                total: automations.length,
              })}
            </div>
          )}
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
          {filteredAutomations.length === 0 ? (
            <div className="ds-empty-state">
              <div className="ds-empty-state-title">{t('sidepanel.automationPage.filterNoResults')}</div>
            </div>
          ) : filteredAutomations.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              runs={runs[automation.id] ?? []}
              running={runningIds.has(automation.id)}
              sessionStrategy={personalConfig.sameSessionStrategy}
              onRun={() => runNow(automation.id)}
              onToggleStatus={() => toggleStatus(automation)}
              onPrepare={() => prepareAutomation(automation)}
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

function AutomationTemplatePicker({
  onUse,
}: {
  onUse: (template: AutomationWorkflowTemplate) => void;
}) {
  const { t } = useI18n();
  const [category, setCategory] = useState<'all' | AutomationWorkflowTemplateCategory>('all');
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTemplates = useMemo(() => {
    const categorized = category === 'all'
      ? AUTOMATION_WORKFLOW_TEMPLATES
      : AUTOMATION_WORKFLOW_TEMPLATES.filter((template) => template.category === category);
    if (!normalizedQuery) return categorized;
    return categorized.filter((template) => workflowTemplateSearchText(template, t).includes(normalizedQuery));
  }, [category, normalizedQuery, t]);
  return (
    <section className="ds-surface-panel rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
            {t('sidepanel.automationPage.templates.title')}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.automationPage.templates.description')}
          </div>
        </div>
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="ds-input w-full px-3 py-2 text-xs rounded-lg"
        placeholder={t('sidepanel.automationPage.templates.searchPlaceholder')}
      />
      <div className="flex flex-wrap gap-1.5">
        {TEMPLATE_CATEGORY_FILTERS.map((item) => {
          const selected = item === category;
          return (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={`px-2 py-1 text-[11px] rounded-md ${selected ? 'ds-btn-primary text-white' : 'ds-btn-secondary'}`}
            >
              {item === 'all'
                ? t('sidepanel.automationPage.templates.all')
                : t(`sidepanel.automationPage.templates.categories.${item}` as LocaleMessageKey)}
            </button>
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {visibleTemplates.length === 0 ? (
          <div className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.automationPage.templates.noResults')}
          </div>
        ) : visibleTemplates.map((template) => (
          <article key={template.id} className="ds-card rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--ds-text)' }}>
                  {workflowTemplateCopy(template, 'title', t)}
                </div>
                <div className="text-[10px] uppercase mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
                  {workflowTemplateCategory(template, t)} · {workflowTemplateCopy(template, 'cadence', t)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onUse(template)}
                className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md shrink-0"
              >
                {t('sidepanel.automationPage.templates.use')}
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {workflowTemplateChips(template, t).map((label) => (
                <span
                  key={label}
                  className="px-1.5 py-0.5 rounded-full text-[10px]"
                  style={{ color: 'var(--ds-text-tertiary)', background: 'var(--ds-surface)' }}
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="text-[11px] leading-4" style={{ color: 'var(--ds-text-secondary)' }}>
              {workflowTemplateCopy(template, 'summary', t)}
            </div>
          </article>
        ))}
      </div>
    </section>
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
  const readiness = useMemo(
    () => evaluateAutomationReadiness(toAutomationInput(form), { transientImageCount: imageAttachments.length }),
    [form, imageAttachments.length],
  );
  const safeFixCodes = useMemo(() => getSafeAutomationReadinessFixes(readiness), [readiness]);
  const promptFixCodes = useMemo(() => getPromptAutomationReadinessFixes(readiness), [readiness]);
  const showReadiness = editing !== null || hasAutomationDraftContent(form, imageAttachments.length);
  const visionRouteLocksFlags = form.modelType === 'vision' ||
    parseVisionRefFileIds(form.refFileIdsText).length > 0 ||
    imageAttachments.length > 0 ||
    form.visualMonitorEnabled;
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    onChange({ ...form, [key]: value });
  };
  const isScheduled = form.scheduleKind !== 'manual';
  const handleFiles = (files: FileList | null) => {
    onAddImages(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const applySafeFixes = () => {
    if (safeFixCodes.length === 0) return;
    const promptOptions = applySafeAutomationReadinessFixes(toAutomationInput(form).promptOptions, safeFixCodes);
    onChange({
      ...form,
      modelType: normalizeFormModelType(promptOptions.modelType),
      searchEnabled: promptOptions.searchEnabled,
      thinkingEnabled: promptOptions.thinkingEnabled,
      refFileIdsText: promptOptions.refFileIds.join(', '),
      visualMonitorEnabled: promptOptions.visualMonitor?.enabled === true,
    });
  };
  const applyPromptFixes = () => {
    if (promptFixCodes.length === 0) return;
    onChange({
      ...form,
      prompt: applyPromptAutomationReadinessFixes(form.prompt, promptFixCodes),
    });
  };
  const prepareRun = () => {
    if (safeFixCodes.length === 0 && promptFixCodes.length === 0) return;
    const promptOptions = applySafeAutomationReadinessFixes(toAutomationInput(form).promptOptions, safeFixCodes);
    onChange({
      ...form,
      prompt: applyPromptAutomationReadinessFixes(form.prompt, promptFixCodes),
      modelType: normalizeFormModelType(promptOptions.modelType),
      searchEnabled: promptOptions.searchEnabled,
      thinkingEnabled: promptOptions.thinkingEnabled,
      refFileIdsText: promptOptions.refFileIds.join(', '),
      visualMonitorEnabled: promptOptions.visualMonitor?.enabled === true,
    });
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
          checked={visionRouteLocksFlags ? false : form.searchEnabled}
          onChange={(searchEnabled) => update('searchEnabled', searchEnabled)}
          disabled={visionRouteLocksFlags}
          label={t('sidepanel.automationPage.form.search')}
        />
        <ToggleSwitch
          checked={visionRouteLocksFlags ? false : form.thinkingEnabled}
          onChange={(thinkingEnabled) => update('thinkingEnabled', thinkingEnabled)}
          disabled={visionRouteLocksFlags}
          label={t('sidepanel.automationPage.form.thinking')}
        />
      </div>
      {visionRouteLocksFlags && (
        <div className="rounded-lg px-2.5 py-2 text-[11px]" style={{ color: 'var(--ds-text-secondary)', background: 'var(--ds-surface)' }}>
          {t('sidepanel.automationPage.form.visionRouteNote')}
        </div>
      )}

      <ToggleRow
        title={t('sidepanel.automationPage.form.visualMonitor')}
        description={t('sidepanel.automationPage.form.visualMonitorDescription')}
        enabled={form.visualMonitorEnabled}
        onToggle={(next) => update('visualMonitorEnabled', next)}
      />

      {showReadiness && (
        <AutomationReadinessPanel
          report={readiness}
          safeFixCodes={safeFixCodes}
          promptFixCodes={promptFixCodes}
          onPrepareRun={prepareRun}
          onApplySafeFixes={applySafeFixes}
          onApplyPromptFixes={applyPromptFixes}
        />
      )}

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
  onPrepare,
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
  onPrepare: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenSession: () => void;
}) {
  const { t, locale } = useI18n();
  const latestRun = runs[0];
  const readiness = useMemo(() => evaluateAutomationReadiness(automation), [automation]);
  const canPrepare = readiness.status !== 'blocked' && (
    getSafeAutomationReadinessFixes(readiness).length > 0 ||
    getPromptAutomationReadinessFixes(readiness).length > 0
  );
  const runBlocked = readiness.status === 'blocked';
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
        <MetaChip label={t('sidepanel.automationPage.readiness.title')} value={`${readiness.grade} · ${t(`sidepanel.automationPage.readiness.status.${readiness.status}` as LocaleMessageKey)}`} />
      </div>

      {readiness.issues.length > 0 && (
        <AutomationReadinessPanel report={readiness} compact />
      )}

      {latestRun && (
        <RunPreflightSummary run={latestRun} />
      )}

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
        <div className="flex items-center gap-2">
          {canPrepare && (
            <button
              onClick={onPrepare}
              className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg"
            >
              {t('sidepanel.automationPage.readiness.prepareRun')}
            </button>
          )}
          <button
            onClick={onRun}
            disabled={running || runBlocked}
            className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg disabled:opacity-60"
          >
            {runBlocked
              ? t('sidepanel.automationPage.readiness.status.blocked')
              : running
                ? t('sidepanel.automationPage.status.running')
                : t('sidepanel.automationPage.actions.runNow')}
          </button>
        </div>
      </div>
    </div>
  );
}

function RunPreflightSummary({ run }: { run: AutomationRun }) {
  const { t } = useI18n();
  const preflight = run.request?.preflight;
  if (!preflight) return null;
  const fixedCodes = preflight.autoFixedIssueCodes;
  const blockingCodes = preflight.blockingIssueCodes;
  if (fixedCodes.length === 0 && blockingCodes.length === 0) return null;

  const blocked = blockingCodes.length > 0 || run.status === 'skipped';
  const toneColor = blocked ? 'var(--ds-danger)' : 'var(--ds-warning, var(--ds-text-secondary))';
  const visibleFixedCodes = fixedCodes.slice(0, 3);
  const visibleBlockingCodes = blockingCodes.slice(0, 3);

  return (
    <div
      className="rounded-lg border px-2.5 py-2 space-y-1.5"
      style={{ borderColor: toneColor, background: 'var(--ds-surface)' }}
    >
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <div className="font-medium" style={{ color: 'var(--ds-text)' }}>
          {blocked
            ? t('sidepanel.automationPage.preflight.skippedTitle')
            : t('sidepanel.automationPage.preflight.fixedTitle')}
        </div>
        <div className="font-semibold" style={{ color: toneColor }}>
          {t('sidepanel.automationPage.preflight.grade', { grade: preflight.grade, score: preflight.score })}
        </div>
      </div>
      <div className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
        {blocked
          ? t('sidepanel.automationPage.preflight.skippedSummary')
          : t('sidepanel.automationPage.preflight.fixedSummary')}
      </div>
      {visibleFixedCodes.length > 0 && (
        <ul className="space-y-1">
          {visibleFixedCodes.map((code) => (
            <li key={`fixed-${code}`} className="text-[11px] leading-4" style={{ color: 'var(--ds-text-secondary)' }}>
              {formatPreflightAutoFix(code, t)}
            </li>
          ))}
        </ul>
      )}
      {visibleBlockingCodes.length > 0 && (
        <ul className="space-y-1">
          {visibleBlockingCodes.map((code) => (
            <li key={`blocked-${code}`} className="text-[11px] leading-4" style={{ color: 'var(--ds-danger)' }}>
              {formatReadinessIssue(code, t)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AutomationReadinessPanel({
  report,
  compact = false,
  safeFixCodes = [],
  promptFixCodes = [],
  onPrepareRun,
  onApplySafeFixes,
  onApplyPromptFixes,
}: {
  report: AutomationReadinessReport;
  compact?: boolean;
  safeFixCodes?: readonly AutomationReadinessIssueCode[];
  promptFixCodes?: readonly AutomationReadinessIssueCode[];
  onPrepareRun?: () => void;
  onApplySafeFixes?: () => void;
  onApplyPromptFixes?: () => void;
}) {
  const { t } = useI18n();
  const visibleIssues = report.issues.slice(0, compact ? 2 : 4);
  const hiddenIssueCount = Math.max(0, report.issues.length - visibleIssues.length);
  const toneColor = readinessToneColor(report.status);
  const canApplySafeFixes = !compact && safeFixCodes.length > 0 && Boolean(onApplySafeFixes);
  const canApplyPromptFixes = !compact && promptFixCodes.length > 0 && Boolean(onApplyPromptFixes);
  const canPrepareRun = !compact && (safeFixCodes.length > 0 || promptFixCodes.length > 0) && Boolean(onPrepareRun);

  return (
    <div
      className={`rounded-lg border px-2.5 py-2 ${compact ? 'space-y-1.5' : 'space-y-2'}`}
      style={{ borderColor: toneColor, background: 'var(--ds-surface)' }}
    >
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <div className="font-medium" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.automationPage.readiness.title')}
        </div>
        <div className="font-semibold" style={{ color: toneColor }}>
          {report.grade} · {report.score}
        </div>
      </div>
      <div className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
        {t(`sidepanel.automationPage.readiness.status.${report.status}` as LocaleMessageKey)}
      </div>
      {visibleIssues.length > 0 ? (
        <ul className="space-y-1">
          {visibleIssues.map((issue) => (
            <li
              key={issue.code}
              className="text-[11px] leading-4"
              style={{ color: issue.severity === 'blocker' ? 'var(--ds-danger)' : 'var(--ds-text-secondary)' }}
            >
              {formatReadinessIssue(issue.code, t)}
            </li>
          ))}
          {hiddenIssueCount > 0 && (
            <li className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.automationPage.readiness.moreIssues', { count: hiddenIssueCount })}
            </li>
          )}
        </ul>
      ) : (
        <div className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.automationPage.readiness.noIssues')}
        </div>
      )}
      {(canPrepareRun || canApplySafeFixes || canApplyPromptFixes) && (
        <div className="flex flex-wrap gap-1.5">
          {canPrepareRun && (
            <button
              type="button"
              onClick={onPrepareRun}
              className="ds-btn-primary px-2.5 py-1 text-[11px] rounded-md text-white"
            >
              {t('sidepanel.automationPage.readiness.prepareRun')}
            </button>
          )}
          {canApplySafeFixes && (
            <button
              type="button"
              onClick={onApplySafeFixes}
              className="ds-btn-secondary px-2.5 py-1 text-[11px] rounded-md"
            >
              {t('sidepanel.automationPage.readiness.applySafeFixes')}
            </button>
          )}
          {canApplyPromptFixes && (
            <button
              type="button"
              onClick={onApplyPromptFixes}
              className="ds-btn-secondary px-2.5 py-1 text-[11px] rounded-md"
            >
              {t('sidepanel.automationPage.readiness.addLoopContract')}
            </button>
          )}
        </div>
      )}
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

function fromAutomationInput(input: AutomationCreateInput): FormState {
  return {
    name: input.name,
    prompt: input.prompt,
    scheduleKind: input.schedule.kind,
    expression: input.schedule.expression ?? '',
    timezone: input.schedule.timezone || DEFAULT_TIMEZONE,
    modelType: normalizeFormModelType(input.promptOptions.modelType),
    searchEnabled: input.promptOptions.searchEnabled,
    thinkingEnabled: input.promptOptions.thinkingEnabled,
    refFileIdsText: input.promptOptions.refFileIds.join(', '),
    visualMonitorEnabled: input.promptOptions.visualMonitor?.enabled === true,
  };
}

function createLocalizedAutomationInputFromWorkflowTemplate(
  template: AutomationWorkflowTemplate,
  timezone: string,
  t: (key: LocaleMessageKey) => string,
): AutomationCreateInput {
  const input = createAutomationInputFromWorkflowTemplate(template, { timezone });
  return {
    ...input,
    name: workflowTemplateCopy(template, 'title', t),
    prompt: workflowTemplateCopy(template, 'prompt', t),
  };
}

function hasAutomationDraftContent(form: FormState, imageAttachmentCount: number): boolean {
  return Boolean(
    form.name.trim() ||
    form.prompt.trim() ||
    form.refFileIdsText.trim() ||
    form.modelType ||
    form.scheduleKind !== 'manual' ||
    imageAttachmentCount > 0,
  );
}

function workflowTemplateCopy(
  template: AutomationWorkflowTemplate,
  field: 'title' | 'summary' | 'cadence' | 'prompt',
  t: (key: LocaleMessageKey) => string,
): string {
  return t(`sidepanel.automationPage.templateItems.${template.copyKey}.${field}` as LocaleMessageKey);
}

function workflowTemplateCategory(
  template: AutomationWorkflowTemplate,
  t: (key: LocaleMessageKey) => string,
): string {
  return t(`sidepanel.automationPage.templates.categories.${template.category}` as LocaleMessageKey);
}

function workflowTemplateChips(
  template: AutomationWorkflowTemplate,
  t: (key: LocaleMessageKey) => string,
): string[] {
  return [
    template.schedule.enabled
      ? t('sidepanel.automationPage.templates.chips.scheduled')
      : t('sidepanel.automationPage.templates.chips.manual'),
    template.promptOptions.searchEnabled ? t('sidepanel.automationPage.templates.chips.search') : null,
    template.promptOptions.thinkingEnabled ? t('sidepanel.automationPage.templates.chips.thinking') : null,
    template.promptOptions.visualMonitorEnabled ? t('sidepanel.automationPage.templates.chips.visual') : null,
  ].filter((item): item is string => Boolean(item));
}

function workflowTemplateSearchText(
  template: AutomationWorkflowTemplate,
  t: (key: LocaleMessageKey) => string,
): string {
  return [
    workflowTemplateCopy(template, 'title', t),
    workflowTemplateCopy(template, 'summary', t),
    workflowTemplateCopy(template, 'cadence', t),
    workflowTemplateCategory(template, t),
  ].join(' ').toLowerCase();
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

function readinessToneColor(status: AutomationReadinessReport['status']): string {
  if (status === 'ready') return 'var(--ds-success)';
  if (status === 'blocked') return 'var(--ds-danger)';
  return 'var(--ds-warning, var(--ds-text-secondary))';
}

function readinessIssueKey(code: AutomationReadinessIssueCode | string): LocaleMessageKey {
  return `sidepanel.automationPage.readiness.issues.${code}` as LocaleMessageKey;
}

function preflightAutoFixKey(code: string): LocaleMessageKey {
  return `sidepanel.automationPage.preflight.autoFixes.${code}` as LocaleMessageKey;
}

const READINESS_ISSUE_CODES = new Set<string>([
  'name_missing',
  'prompt_missing',
  'schedule_invalid',
  'sensitive_prompt_content',
  'placeholder_unreplaced',
  'loop_contract_weak',
  'scheduled_without_stop_condition',
  'scheduled_memory_review',
  'research_without_search',
  'evaluation_without_thinking',
  'vision_without_visual_input',
  'vision_flags_inconsistent',
  'scheduled_visual_monitor',
]);

const PREFLIGHT_AUTO_FIX_CODES = new Set<string>([
  'research_without_search',
  'evaluation_without_thinking',
  'vision_flags_inconsistent',
]);

function formatReadinessIssue(code: string, t: ReturnType<typeof useI18n>['t']): string {
  return READINESS_ISSUE_CODES.has(code) ? t(readinessIssueKey(code)) : code;
}

function formatPreflightAutoFix(code: string, t: ReturnType<typeof useI18n>['t']): string {
  return PREFLIGHT_AUTO_FIX_CODES.has(code) ? t(preflightAutoFixKey(code)) : code;
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
