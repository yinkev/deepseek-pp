import type { ComponentProps } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Field,
  FieldContent,
  FieldLabel,
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PauseIcon, PencilIcon, PlayIcon, PlusIcon, Trash2Icon, XIcon, type LucideIcon } from 'lucide-react';
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
import { createAutomationRunReplayBrief } from '../../../core/automation/replay';
import {
  AUTOMATION_WORKFLOW_TEMPLATES,
  createAutomationInputFromWorkflowTemplate,
  type AutomationWorkflowTemplateCategory,
  type AutomationWorkflowTemplate,
} from '../../../core/automation/workflow-templates';
import {
  applyPromptAutomationReadinessFixes,
  applyAutomationReviewGate,
  applySafeAutomationReadinessFixes,
  evaluateAutomationReadiness,
  getPromptAutomationReadinessFixes,
  getSafeAutomationReadinessFixes,
  hasAutomationReviewGate,
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
import { SkeletonList, TextAreaField, TextField, ToggleRow, useBanner, useConfirm } from '../components/settings/primitives';
import WorkbenchScrollRail from '../components/WorkbenchScrollRail';
import WorkbenchTooltip from '../components/WorkbenchTooltip';
import { useI18n } from '../i18n';
import { getRuntimeErrorMessage, isRuntimeFailure, unwrapRuntimeResponse } from '../runtime-response';

type Translate = ReturnType<typeof useI18n>['t'];

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
const AUTOMATION_RELOAD_DEBOUNCE_MS = 350;
const AUTOMATION_FOCUS_RELOAD_MIN_INTERVAL_MS = 3000;
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
const REPAIR_VERIFY_TEMPLATE_ID = 'repo-repair-verify-loop';
const SESSION_STRATEGY_SEQUENCE: Array<PersonalConvenienceConfig['sameSessionStrategy']> = ['last', 'current', 'new'];
const AUTOMATION_LIST_FILTERS = ['all', 'active', 'paused', 'blocked'] as const;
type AutomationListFilter = typeof AUTOMATION_LIST_FILTERS[number];

type AutomationCommandCenterCounts = {
  ready: number;
  needsAttention: number;
  blocked: number;
  running: number;
};

type AutomationStatusTone = 'ready' | 'attention' | 'blocked';
type AutomationStatusAction = 'retry' | 'create' | 'prepareAll' | 'showBlocked';

type AutomationStatusModel = {
  statusKey: LocaleMessageKey;
  descriptionKey: LocaleMessageKey;
  nextKey: LocaleMessageKey;
  actionLabelKey: LocaleMessageKey;
  tone: AutomationStatusTone;
  tasksValue: string;
  readinessValue: string;
  runningValue: string;
  action: AutomationStatusAction | null;
  actionDisabled: boolean;
};

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
  chainEnabled: boolean;
  chainSuccessIdsText: string;
  reviewGateEnabled: boolean;
  timeoutMs: number | null;
  maxToolContinuationTurns: number | null;
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
  chainEnabled: false,
  chainSuccessIdsText: '',
  reviewGateEnabled: false,
  timeoutMs: null,
  maxToolContinuationTurns: null,
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
  const [showStarters, setShowStarters] = useState(false);
  const [automationQuery, setAutomationQuery] = useState('');
  const [automationListFilter, setAutomationListFilter] = useState<AutomationListFilter>('all');
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoadAtRef = useRef(0);
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();

  const readinessById = useMemo(() => {
    const map = new Map<string, AutomationReadinessReport>();
    for (const automation of automations) {
      map.set(automation.id, evaluateAutomationReadiness(automation));
    }
    return map;
  }, [automations]);
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
      if (readinessById.get(automation.id)?.status === 'blocked') counts.blocked += 1;
    }
    return counts;
  }, [automations, readinessById]);
  const commandCenterCounts = useMemo<AutomationCommandCenterCounts>(() => {
    const counts: AutomationCommandCenterCounts = {
      ready: 0,
      needsAttention: 0,
      blocked: 0,
      running: runningIds.size,
    };
    for (const automation of automations) {
      const report = readinessById.get(automation.id);
      if (!report) continue;
      if (report.status === 'ready') counts.ready += 1;
      if (report.status === 'needs_attention') counts.needsAttention += 1;
      if (report.status === 'blocked') counts.blocked += 1;
    }
    return counts;
  }, [automations, readinessById, runningIds]);
  const automationStatus = useMemo(() => createAutomationStatusModel({
    automations,
    counts: commandCenterCounts,
    loading,
    loadError,
    t,
  }), [automations, commandCenterCounts, loadError, loading, t]);
  const filteredAutomations = useMemo(() => {
    const query = automationQuery.trim().toLowerCase();
    return automations.filter((automation) => {
      if (automationListFilter === 'active' && automation.status !== 'active') return false;
      if (automationListFilter === 'paused' && automation.status !== 'paused') return false;
      if (automationListFilter === 'blocked' && readinessById.get(automation.id)?.status !== 'blocked') return false;
      if (!query) return true;
      return automation.name.toLowerCase().includes(query) ||
        automation.prompt.toLowerCase().includes(query);
    });
  }, [automations, automationListFilter, automationQuery, readinessById]);
  const automationFiltersActive = automationQuery.trim().length > 0 || automationListFilter !== 'all';

  const load = async () => {
    if (loadTimerRef.current) {
      clearTimeout(loadTimerRef.current);
      loadTimerRef.current = null;
    }
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_AUTOMATIONS' });
      const items = Array.isArray(response)
        ? response
        : unwrapRuntimeResponse<Automation[]>(response, t('sidepanel.automationPage.backendUnavailable'));
      if (seq !== loadSeqRef.current) return;
      setAutomations(items);
      try {
        const runEntries = await loadRecentRunsForAutomations(items);
        if (seq !== loadSeqRef.current) return;
        setRuns(Object.fromEntries(runEntries));
        setLoadError(null);
      } catch (error) {
        if (seq !== loadSeqRef.current) return;
        setRuns({});
        setLoadError(t('sidepanel.automationPage.runHistoryLoadFailed', {
          error: formatAutomationError(error, t('sidepanel.automationPage.runHistoryUnavailable')),
        }));
      }
      lastLoadAtRef.current = Date.now();
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      setLoadError(t('sidepanel.automationPage.loadFailed', {
        error: formatAutomationError(error, t('sidepanel.automationPage.backendUnavailable')),
      }));
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  };

  const scheduleLoad = (delayMs = AUTOMATION_RELOAD_DEBOUNCE_MS) => {
    if (Date.now() - lastLoadAtRef.current < AUTOMATION_RELOAD_DEBOUNCE_MS) return;
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => {
      loadTimerRef.current = null;
      void load();
    }, delayMs);
  };

  useEffect(() => {
    void load();
    chrome.runtime.sendMessage({ type: 'GET_PERSONAL_CONVENIENCE_CONFIG' })
      .then((result) => setPersonalConfig(normalizePersonalConvenienceConfig(result?.config)))
      .catch(() => setPersonalConfig(DEFAULT_PERSONAL_CONVENIENCE_CONFIG));

    const handleUpdate = (msg: { type?: string; automations?: Automation[] }) => {
      if (msg.type === 'AUTOMATIONS_UPDATED' && Array.isArray(msg.automations)) {
        setAutomations(msg.automations);
        setLoadError(null);
      }
      if (msg.type === 'AUTOMATIONS_UPDATED' || msg.type === 'AUTOMATION_RUNS_UPDATED') {
        scheduleLoad();
      }
    };
    const refreshWhenVisible = () => {
      if (!document.hidden && Date.now() - lastLoadAtRef.current > AUTOMATION_FOCUS_RELOAD_MIN_INTERVAL_MS) {
        scheduleLoad(0);
      }
    };

    chrome.runtime.onMessage.addListener(handleUpdate);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);

    return () => {
      chrome.runtime.onMessage.removeListener(handleUpdate);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
  }, []);

  const startCreate = () => {
    setEditing(null);
    setForm(createEmptyForm(personalConfig));
    setImageAttachments([]);
    setShowStarters(false);
    banner.clear();
    setShowForm((prev) => !prev);
  };

  const startEdit = (automation: Automation) => {
    setEditing(automation);
    setForm(fromAutomation(automation));
    setImageAttachments([]);
    setShowStarters(false);
    banner.clear();
    setShowForm(true);
  };

  const applyWorkflowTemplate = (template: AutomationWorkflowTemplate, objective?: string) => {
    const input = createLocalizedAutomationInputFromWorkflowTemplate(template, DEFAULT_TIMEZONE, t);
    const prompt = materializeWorkflowObjective(input.prompt, objective);
    setEditing(null);
    setForm(fromAutomationInput({ ...input, prompt }));
    setImageAttachments([]);
    setShowStarters(false);
    banner.clear();
    setShowForm(true);
  };

  const startRepairVerifyLoop = (objective: string) => {
    const template = AUTOMATION_WORKFLOW_TEMPLATES.find((item) => item.id === REPAIR_VERIFY_TEMPLATE_ID);
    if (!template) return;
    applyWorkflowTemplate(template, objective);
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

    let response: unknown;
    try {
      response = editing
        ? await chrome.runtime.sendMessage({
          type: 'UPDATE_AUTOMATION',
          payload: { id: editing.id, patch: payload, ...(images.length > 0 ? { images } : {}) },
        })
        : await chrome.runtime.sendMessage({
          type: 'CREATE_AUTOMATION',
          payload: { ...payload, ...(images.length > 0 ? { images } : {}) },
        });
    } catch (error) {
      banner.show('error', t('sidepanel.automationPage.operationFailed', {
        error: formatAutomationError(error, t('sidepanel.automationPage.operationUnavailable')),
      }));
      return;
    }

    if (response && typeof response === 'object' && 'lastError' in response) {
      banner.show('error', t('sidepanel.automationPage.operationFailed', {
        error: formatAutomationError(
          (response as { lastError?: { message?: string } }).lastError?.message ?? 'last_error',
          t('sidepanel.automationPage.operationUnavailable'),
        ),
      }));
      return;
    }
    try {
      unwrapRuntimeResponse<unknown>(response, t('sidepanel.automationPage.backendUnavailable'));
    } catch (error) {
      banner.show('error', t('sidepanel.automationPage.operationFailed', {
        error: formatAutomationError(error, t('sidepanel.automationPage.operationUnavailable')),
      }));
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
      const run: AutomationRun | { ok: false; error?: unknown } | null = await chrome.runtime.sendMessage({
        type: 'RUN_AUTOMATION_NOW',
        payload: { id },
      });
      if (isRuntimeFailure(run)) {
        banner.show('error', t('sidepanel.automationPage.operationFailed', {
          error: formatAutomationError(run.error, t('sidepanel.automationPage.operationUnavailable')),
        }));
      } else if (run && 'status' in run && (run.status === 'failed' || run.status === 'timeout')) {
        banner.show('error', t('sidepanel.automationPage.operationFailed', {
          error: formatAutomationError(run.error?.message, t('sidepanel.automationPage.runFailed')),
        }));
      }
    } catch (error) {
      banner.show('error', t('sidepanel.automationPage.operationFailed', {
        error: formatAutomationError(error, t('sidepanel.automationPage.operationUnavailable')),
      }));
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
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_AUTOMATION_STATUS',
        payload: { id: automation.id, status: automation.status === 'active' ? 'paused' : 'active' },
      });
      if (isRuntimeFailure(response)) throw new Error(getRuntimeErrorMessage(response.error));
      scheduleLoad(0);
    } catch (error) {
      banner.show('error', t('sidepanel.automationPage.operationFailed', {
        error: formatAutomationError(error, t('sidepanel.automationPage.operationUnavailable')),
      }));
    }
  };

  const remove = async (automation: Automation) => {
    const ok = await confirm({
      title: t('sidepanel.automationPage.deleteConfirmTitle'),
      message: t('sidepanel.automationPage.deleteConfirm', { name: automation.name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DELETE_AUTOMATION', payload: { id: automation.id } });
      if (isRuntimeFailure(response)) throw new Error(getRuntimeErrorMessage(response.error));
      scheduleLoad(0);
    } catch (error) {
      banner.show('error', t('sidepanel.automationPage.operationFailed', {
        error: formatAutomationError(error, t('sidepanel.automationPage.operationUnavailable')),
      }));
    }
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
      if (isRuntimeFailure(result)) throw new Error(getRuntimeErrorMessage(result.error));
      setPersonalConfig(normalizePersonalConvenienceConfig(result?.config ?? optimistic));
    } catch (error) {
      setPersonalConfig(personalConfig);
      banner.show('error', t('sidepanel.automationPage.operationFailed', {
        error: formatAutomationError(error, t('sidepanel.automationPage.operationUnavailable')),
      }));
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

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_AUTOMATION',
        payload: { id: automation.id, patch },
      });
      if (isRuntimeFailure(response)) throw new Error(getRuntimeErrorMessage(response.error));
    } catch (error) {
      banner.show('error', t('sidepanel.automationPage.operationFailed', {
        error: formatAutomationError(error, t('sidepanel.automationPage.operationUnavailable')),
      }));
      return;
    }
    banner.show('success', t('sidepanel.automationPage.readiness.noIssues'));
    scheduleLoad(0);
  };

  const prepareAllAutomations = async () => {
    let prepared = 0;
    for (const automation of automations) {
      const report = evaluateAutomationReadiness(automation);
      if (report.status === 'blocked') continue;
      const safeFixCodes = getSafeAutomationReadinessFixes(report);
      const promptFixCodes = getPromptAutomationReadinessFixes(report);
      if (safeFixCodes.length === 0 && promptFixCodes.length === 0) continue;

      const patch: Partial<Pick<Automation, 'prompt' | 'promptOptions'>> = {};
      if (safeFixCodes.length > 0) {
        patch.promptOptions = applySafeAutomationReadinessFixes(automation.promptOptions, safeFixCodes);
      }
      if (promptFixCodes.length > 0) {
        patch.prompt = applyPromptAutomationReadinessFixes(automation.prompt, promptFixCodes);
      }

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'UPDATE_AUTOMATION',
          payload: { id: automation.id, patch },
        });
        if (isRuntimeFailure(response)) throw new Error(getRuntimeErrorMessage(response.error));
      } catch (error) {
        banner.show('error', t('sidepanel.automationPage.operationFailed', {
          error: formatAutomationError(error, t('sidepanel.automationPage.operationUnavailable')),
        }));
        return;
      }
      prepared += 1;
    }

    banner.show('success', prepared > 0
      ? t('sidepanel.automationPage.readiness.preparedAll', { count: prepared })
      : t('sidepanel.automationPage.readiness.noPreparedAll'));
    scheduleLoad(0);
  };

  const openSession = async (url: string | null) => {
    if (!url) return;
    try {
      await chrome.tabs.create({ url, active: true });
    } catch (error) {
      banner.show('error', t('sidepanel.automationPage.operationFailed', {
        error: formatAutomationError(error, t('sidepanel.automationPage.operationUnavailable')),
      }));
    }
  };

  const handleAutomationStatusAction = () => {
    if (automationStatus.action === 'retry') {
      void load();
      return;
    }
    if (automationStatus.action === 'create') {
      startCreate();
      return;
    }
    if (automationStatus.action === 'prepareAll') {
      void prepareAllAutomations();
      return;
    }
    if (automationStatus.action === 'showBlocked') {
      setAutomationQuery('');
      setAutomationListFilter('blocked');
      setShowStarters(false);
    }
  };

  return (
    <div className="ds-page">
      <PageIntro
        title={t('sidepanel.automationPage.title')}
        description={t('sidepanel.automationPage.description')}
        meta={t('sidepanel.automationPage.summary', { total: automations.length, active: automationListCounts.active })}
        actions={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          {automations.length > 0 && (
            <Button
              type="button"
              onClick={() => void prepareAllAutomations()}
              variant="outline"
              size="sm"
              className="ds-btn-secondary px-2.5 py-1.5 text-[11px] rounded-lg"
            >
              {t('sidepanel.automationPage.readiness.prepareAll')}
            </Button>
          )}
          {automations.length > 0 && !showForm && (
            <Button
              type="button"
              onClick={() => setShowStarters((prev) => !prev)}
              variant="outline"
              size="sm"
              className="ds-btn-secondary px-2.5 py-1.5 text-[11px] rounded-lg"
              aria-pressed={showStarters}
            >
              {showStarters
                ? t('sidepanel.automationPage.templates.hide')
                : t('sidepanel.automationPage.templates.show')}
            </Button>
          )}
          <Button
            type="button"
            onClick={() => void cycleSessionStrategy()}
            variant="outline"
            size="sm"
            className="ds-btn-secondary px-2.5 py-1.5 text-[11px] rounded-lg"
            title={t('sidepanel.automationPage.changeSessionStrategy')}
            aria-label={t('sidepanel.automationPage.changeSessionStrategy')}
          >
            {t('sidepanel.automationPage.meta.strategy')}: {formatSessionStrategy(personalConfig.sameSessionStrategy, t)}
          </Button>
          <Button
            type="button"
            onClick={startCreate}
            size="sm"
            className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
          >
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            {t('sidepanel.automationPage.create')}
          </Button>
        </div>
        )}
      />

      {banner.node}
      {confirmNode}

      <AutomationStatusCard
        status={automationStatus}
        busy={loading}
        onAction={handleAutomationStatusAction}
      />

      {loadError && !showForm && (
        <Alert variant="destructive" className="ds-automation-alert">
          <AlertTitle>{t('sidepanel.automationPage.loadFailedTitle')}</AlertTitle>
          <AlertDescription>
            <div>{loadError}</div>
            <div>{t('sidepanel.automationPage.loadFailedHint')}</div>
          </AlertDescription>
          <AlertAction>
            <Button
              type="button"
              size="xs"
              variant="destructive"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? t('sidepanel.automationPage.loading') : t('common.retry')}
            </Button>
          </AlertAction>
        </Alert>
      )}

      {!loadError && !editing && !showForm && (automations.length === 0 || showStarters) && (
        <div className="ds-automation-starter-stack">
          <AutomationRunLauncher onStart={startRepairVerifyLoop} />
          <AutomationTemplatePicker onUse={applyWorkflowTemplate} />
        </div>
      )}

      {showForm && (
        <div className="animate-slide-down">
          <AutomationForm
            form={form}
            editing={editing}
            availableAutomations={automations}
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
          <TextField
            ariaLabel={t('sidepanel.automationPage.filterPlaceholder')}
            value={automationQuery}
            onChange={setAutomationQuery}
            fieldClassName="ds-automation-search-field"
            inputClassName="px-3 py-2 text-xs rounded-lg"
            placeholder={t('sidepanel.automationPage.filterPlaceholder')}
          />
          <WorkbenchScrollRail
            label={t('sidepanel.automationPage.filterRailLabel')}
            rowClassName="ds-automation-filter-rail"
          >
            <ToggleGroup
              type="single"
              value={automationListFilter}
              onValueChange={(value) => {
                if (value) setAutomationListFilter(value as AutomationListFilter);
              }}
              variant="outline"
              size="sm"
              spacing={1}
              aria-label={t('sidepanel.automationPage.filterRailLabel')}
              className="flex-wrap"
            >
              {AUTOMATION_LIST_FILTERS.map((filter) => {
                const label = t(`sidepanel.automationPage.filters.${filter}` as LocaleMessageKey);
                return (
                  <ToggleGroupItem
                    key={filter}
                    value={filter}
                    aria-label={label}
                    className="text-[11px] data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    <span>{label}</span>
                    <span className="font-mono text-[10px] opacity-80">{automationListCounts[filter]}</span>
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            {automationFiltersActive && (
              <Button
                type="button"
                onClick={() => { setAutomationQuery(''); setAutomationListFilter('all'); }}
                variant="outline"
                size="xs"
                className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md shrink-0"
              >
                {t('sidepanel.automationPage.clearFilters')}
              </Button>
            )}
          </WorkbenchScrollRail>
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

      {loading && automations.length === 0 && !loadError ? (
        <SkeletonList rows={3} />
      ) : loadError && automations.length === 0 && !showForm ? null : automations.length === 0 && !showForm ? (
        <Empty className="ds-automation-empty">
          <EmptyHeader>
            <EmptyTitle>{t('sidepanel.automationPage.empty')}</EmptyTitle>
            <EmptyDescription>{t('sidepanel.automationPage.emptyHelp')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" size="sm" onClick={startCreate}>
              {t('sidepanel.automationPage.create')}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-2">
          {filteredAutomations.length === 0 ? (
            <Empty className="ds-automation-empty ds-automation-empty-compact">
              <EmptyHeader>
                <EmptyTitle>{t('sidepanel.automationPage.filterNoResults')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : filteredAutomations.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              runs={runs[automation.id] ?? []}
              running={runningIds.has(automation.id)}
              readiness={readinessById.get(automation.id) ?? evaluateAutomationReadiness(automation)}
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

function AutomationStatusCard({
  status,
  busy,
  onAction,
}: {
  status: AutomationStatusModel;
  busy: boolean;
  onAction: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card
      size="sm"
      className={`ds-automation-status ds-automation-status-${status.tone}`}
      aria-label={t('sidepanel.automationPage.statusCard.label')}
    >
      <CardHeader className="ds-automation-status-head">
        <CardTitle>{t('sidepanel.automationPage.statusCard.title')}</CardTitle>
        <CardDescription>{t(status.descriptionKey)}</CardDescription>
        <CardAction>
          <Badge
            variant={getAutomationStatusBadgeVariant(status.tone)}
            className={`ds-automation-status-badge ds-automation-status-badge-${status.tone}`}
          >
            {t(status.statusKey)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="ds-automation-status-body">
        <div className="ds-automation-status-list">
          <AutomationStatusRow
            label={t('sidepanel.automationPage.statusCard.tasks')}
            value={status.tasksValue}
          />
          <AutomationStatusRow
            label={t('sidepanel.automationPage.statusCard.readiness')}
            value={status.readinessValue}
            tone={status.tone}
          />
          <AutomationStatusRow
            label={t('sidepanel.automationPage.statusCard.running')}
            value={status.runningValue}
          />
          <AutomationStatusRow
            label={t('sidepanel.automationPage.statusCard.next')}
            value={t(status.nextKey)}
            tone={status.tone}
          />
        </div>
      </CardContent>
      {status.action && (
        <CardFooter className="ds-automation-status-actions">
          <Button
            type="button"
            size="sm"
            variant={status.tone === 'blocked' ? 'default' : 'outline'}
            onClick={onAction}
            disabled={busy || status.actionDisabled}
            className="ds-automation-status-button"
          >
            {t(status.actionLabelKey)}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function AutomationStatusRow({
  label,
  value,
  tone = 'ready',
}: {
  label: string;
  value: string;
  tone?: AutomationStatusTone;
}) {
  return (
    <div className={`ds-automation-status-row ds-automation-status-row-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getAutomationStatusBadgeVariant(tone: AutomationStatusTone): ComponentProps<typeof Badge>['variant'] {
  if (tone === 'blocked') return 'destructive';
  if (tone === 'attention') return 'secondary';
  return 'outline';
}

function createAutomationStatusModel({
  automations,
  counts,
  loading,
  loadError,
  t,
}: {
  automations: Automation[];
  counts: AutomationCommandCenterCounts;
  loading: boolean;
  loadError: string | null;
  t: Translate;
}): AutomationStatusModel {
  const activeCount = automations.filter((automation) => automation.status === 'active').length;
  const tasksValue = automations.length > 0
    ? t('sidepanel.automationPage.statusCard.tasksValue', { total: automations.length, active: activeCount })
    : t('sidepanel.automationPage.statusCard.tasksEmpty');
  const readinessValue = t('sidepanel.automationPage.statusCard.readinessValue', {
    ready: counts.ready,
    attention: counts.needsAttention,
    blocked: counts.blocked,
  });
  const runningValue = t('sidepanel.automationPage.statusCard.runningValue', { count: counts.running });

  if (loadError && automations.length === 0) {
    return {
      statusKey: 'sidepanel.automationPage.statusCard.statusLoadFailed',
      descriptionKey: 'sidepanel.automationPage.statusCard.descriptionLoadFailed',
      nextKey: 'sidepanel.automationPage.statusCard.nextRetry',
      actionLabelKey: 'common.retry',
      tone: 'blocked',
      tasksValue,
      readinessValue,
      runningValue,
      action: 'retry',
      actionDisabled: false,
    };
  }

  if (loadError) {
    return {
      statusKey: 'sidepanel.automationPage.statusCard.statusNeedsRefresh',
      descriptionKey: 'sidepanel.automationPage.statusCard.descriptionPartial',
      nextKey: 'sidepanel.automationPage.statusCard.nextRetryHistory',
      actionLabelKey: 'common.retry',
      tone: 'attention',
      tasksValue,
      readinessValue,
      runningValue,
      action: 'retry',
      actionDisabled: false,
    };
  }

  if (loading && automations.length === 0) {
    return {
      statusKey: 'sidepanel.automationPage.statusCard.statusChecking',
      descriptionKey: 'sidepanel.automationPage.statusCard.descriptionChecking',
      nextKey: 'sidepanel.automationPage.statusCard.nextChecking',
      actionLabelKey: 'common.retry',
      tone: 'attention',
      tasksValue,
      readinessValue,
      runningValue,
      action: null,
      actionDisabled: false,
    };
  }

  if (automations.length === 0) {
    return {
      statusKey: 'sidepanel.automationPage.statusCard.statusEmpty',
      descriptionKey: 'sidepanel.automationPage.statusCard.descriptionEmpty',
      nextKey: 'sidepanel.automationPage.statusCard.nextCreate',
      actionLabelKey: 'sidepanel.automationPage.create',
      tone: 'attention',
      tasksValue,
      readinessValue,
      runningValue,
      action: 'create',
      actionDisabled: false,
    };
  }

  if (counts.blocked > 0) {
    return {
      statusKey: 'sidepanel.automationPage.statusCard.statusBlocked',
      descriptionKey: 'sidepanel.automationPage.statusCard.descriptionBlocked',
      nextKey: 'sidepanel.automationPage.statusCard.nextShowBlocked',
      actionLabelKey: 'sidepanel.automationPage.statusCard.actionShowBlocked',
      tone: 'blocked',
      tasksValue,
      readinessValue,
      runningValue,
      action: 'showBlocked',
      actionDisabled: false,
    };
  }

  if (counts.running > 0) {
    return {
      statusKey: 'sidepanel.automationPage.statusCard.statusRunning',
      descriptionKey: 'sidepanel.automationPage.statusCard.descriptionRunning',
      nextKey: 'sidepanel.automationPage.statusCard.nextWatch',
      actionLabelKey: 'sidepanel.automationPage.readiness.prepareAll',
      tone: 'attention',
      tasksValue,
      readinessValue,
      runningValue,
      action: null,
      actionDisabled: false,
    };
  }

  if (counts.needsAttention > 0) {
    return {
      statusKey: 'sidepanel.automationPage.statusCard.statusNeedsAttention',
      descriptionKey: 'sidepanel.automationPage.statusCard.descriptionNeedsAttention',
      nextKey: 'sidepanel.automationPage.statusCard.nextPrepareAll',
      actionLabelKey: 'sidepanel.automationPage.readiness.prepareAll',
      tone: 'attention',
      tasksValue,
      readinessValue,
      runningValue,
      action: 'prepareAll',
      actionDisabled: false,
    };
  }

  return {
    statusKey: 'sidepanel.automationPage.statusCard.statusReady',
    descriptionKey: 'sidepanel.automationPage.statusCard.descriptionReady',
    nextKey: 'sidepanel.automationPage.statusCard.nextContinue',
    actionLabelKey: 'sidepanel.automationPage.readiness.prepareAll',
    tone: 'ready',
    tasksValue,
    readinessValue,
    runningValue,
    action: null,
    actionDisabled: false,
  };
}

function AutomationRunLauncher({ onStart }: { onStart: (objective: string) => void }) {
  const { t } = useI18n();
  const [objective, setObjective] = useState('');

  return (
    <section className="ds-surface-panel rounded-xl p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold" style={{ color: 'var(--ds-text)' }}>
            {t('sidepanel.automationPage.commandCenter.launcherTitle')}
          </div>
          <div className="text-[11px] mt-0.5 leading-4" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.automationPage.commandCenter.launcherDescription')}
          </div>
        </div>
      </div>

      <TextAreaField
        label={t('sidepanel.automationPage.commandCenter.objectiveLabel')}
        value={objective}
        onChange={setObjective}
        rows={3}
        fieldClassName="ds-automation-textarea-field"
        textareaClassName="ds-input text-xs rounded-lg min-h-20 resize-y"
        placeholder={t('sidepanel.automationPage.commandCenter.objectivePlaceholder')}
      />

      <div className="ds-automation-guardrails">
        <MetaChip label={t('sidepanel.automationPage.commandCenter.timeout')} value={t('sidepanel.automationPage.commandCenter.timeoutValue')} />
        <MetaChip label={t('sidepanel.automationPage.commandCenter.toolBudget')} value={t('sidepanel.automationPage.commandCenter.toolBudgetValue')} />
      </div>
      <div className="text-[11px] leading-4" style={{ color: 'var(--ds-text-secondary)' }}>
        {t('sidepanel.automationPage.commandCenter.proofSummary')}
      </div>

      <Button
        type="button"
        onClick={() => onStart(objective)}
        size="sm"
        className="ds-btn-primary w-full px-3 py-2 text-xs font-medium text-white rounded-lg"
      >
        {t('sidepanel.automationPage.commandCenter.startLongLoop')}
      </Button>
    </section>
  );
}

async function loadRecentRunsForAutomations(
  automations: Automation[],
): Promise<Array<readonly [string, AutomationRun[]]>> {
  if (automations.length === 0) return [];
  const ids = automations.map((automation) => automation.id);
  try {
    const batch = await chrome.runtime.sendMessage({
      type: 'GET_AUTOMATION_RUNS_BATCH',
      payload: { automationIds: ids, limit: 5 },
    }) as Record<string, AutomationRun[]> | null;
    if (isRuntimeFailure(batch)) throw new Error(getRuntimeErrorMessage(batch.error));
    if (batch && typeof batch === 'object') {
      return ids.map((id) => [id, Array.isArray(batch[id]) ? batch[id] : []] as const);
    }
  } catch {
    // Older test doubles and stale extension builds may not know the batch endpoint yet.
  }

  return Promise.all(
    automations.map(async (automation) => {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_AUTOMATION_RUNS',
        payload: { automationId: automation.id, limit: 5 },
      });
      const recent = Array.isArray(response)
        ? response
        : unwrapRuntimeResponse<AutomationRun[]>(response, 'automation_runs_unavailable');
      return [automation.id, recent ?? []] as const;
    }),
  );
}

type AutomationSelectOption<T extends string> = {
  value: T;
  label: string;
};

const AUTOMATION_DEFAULT_MODEL_SELECT_VALUE = 'default';
type AutomationModelSelectValue = typeof AUTOMATION_DEFAULT_MODEL_SELECT_VALUE | 'expert' | 'vision';

function AutomationSelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: Array<AutomationSelectOption<T>>;
  onChange: (value: T) => void;
  className?: string;
}) {
  const labelId = useId();
  const triggerId = useId();

  return (
    <Field className={['ds-automation-select-field', className].filter(Boolean).join(' ')}>
      <FieldLabel id={labelId} htmlFor={triggerId} className="ds-field-label-text">
        {label}
      </FieldLabel>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger
          id={triggerId}
          aria-labelledby={labelId}
          className="ds-settings-select-trigger ds-automation-select-trigger w-full"
          size="sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="ds-settings-select-content">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

function AutomationSwitchField({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const switchId = useId();

  return (
    <Field
      orientation="horizontal"
      data-disabled={disabled ? true : undefined}
      className="ds-automation-inline-switch"
    >
      <Switch
        id={switchId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => {
          if (!disabled) onChange(next);
        }}
        aria-label={label}
        size="sm"
      />
      <FieldContent className="ds-automation-inline-switch-copy">
        <FieldLabel htmlFor={switchId} className="ds-automation-inline-switch-label">
          {label}
        </FieldLabel>
      </FieldContent>
    </Field>
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
      <TextField
        ariaLabel={t('sidepanel.automationPage.templates.searchPlaceholder')}
        value={query}
        onChange={setQuery}
        fieldClassName="ds-automation-search-field"
        inputClassName="px-3 py-2 text-xs rounded-lg"
        placeholder={t('sidepanel.automationPage.templates.searchPlaceholder')}
      />
      <AutomationSelectField
        label={t('sidepanel.automationPage.templates.categoryLabel')}
        value={category}
        onChange={(next) => setCategory(next)}
        className="ds-automation-template-filter"
        options={TEMPLATE_CATEGORY_FILTERS.map((item) => ({
          value: item,
          label: item === 'all'
            ? t('sidepanel.automationPage.templates.all')
            : t(`sidepanel.automationPage.templates.categories.${item}` as LocaleMessageKey),
        }))}
      />
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
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
                  {workflowTemplateCategory(template, t)} · {workflowTemplateCopy(template, 'cadence', t)}
                </div>
              </div>
              <Button
                type="button"
                onClick={() => onUse(template)}
                variant="outline"
                size="xs"
                className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md shrink-0"
              >
                {t('sidepanel.automationPage.templates.use')}
              </Button>
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
  availableAutomations,
  imageAttachments,
  onChange,
  onAddImages,
  onRemoveImage,
  onSave,
  onCancel,
}: {
  form: FormState;
  editing: Automation | null;
  availableAutomations: Automation[];
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
  const selectedChainIds = useMemo(() => parseAutomationChainIds(form.chainSuccessIdsText), [form.chainSuccessIdsText]);
  const chainTargets = availableAutomations.filter((automation) => automation.id !== editing?.id);
  const modelSelectValue: AutomationModelSelectValue = form.modelType === 'expert' || form.modelType === 'vision'
    ? form.modelType
    : AUTOMATION_DEFAULT_MODEL_SELECT_VALUE;
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
        <TextField
          label={t('sidepanel.automationPage.form.name')}
          value={form.name}
          onChange={(value) => update('name', value)}
          inputClassName="px-3 py-2 text-xs rounded-lg"
          placeholder={t('sidepanel.automationPage.form.namePlaceholder')}
        />
        <AutomationSelectField
          label={t('sidepanel.automationPage.form.model')}
          value={modelSelectValue}
          onChange={(next) => {
            update('modelType', next === AUTOMATION_DEFAULT_MODEL_SELECT_VALUE ? '' : next);
          }}
          options={[
            {
              value: AUTOMATION_DEFAULT_MODEL_SELECT_VALUE,
              label: t('sidepanel.automationPage.form.defaultModel'),
            },
            {
              value: 'expert',
              label: t('sidepanel.automationPage.form.expertModel'),
            },
            {
              value: 'vision',
              label: t('sidepanel.automationPage.form.visionModel'),
            },
          ]}
        />
      </div>

      <TextField
        label={t('sidepanel.automationPage.form.visualRefs')}
        value={form.refFileIdsText}
        onChange={(value) => update('refFileIdsText', value)}
        inputClassName="px-3 py-2 text-xs rounded-lg"
        placeholder={t('sidepanel.automationPage.form.visualRefsPlaceholder')}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(event) => handleFiles(event.currentTarget.files)}
      />
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          variant="outline"
          size="sm"
          className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg"
        >
          {t('sidepanel.automationPage.form.attachImage')}
        </Button>
        {imageAttachments.length > 0 && (
          <div className="ds-chat-attachment-tray flex-1 justify-end">
            {imageAttachments.map((attachment) => (
              <span key={attachment.id} className="ds-chat-attachment-chip">
                {attachment.name}
                <Button
                  type="button"
                  onClick={() => onRemoveImage(attachment.id)}
                  aria-label={t('sidepanel.automationPage.form.removeImage', { name: attachment.name })}
                  variant="ghost"
                  size="icon-xs"
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </span>
            ))}
          </div>
        )}
      </div>

      <TextAreaField
        label={t('sidepanel.automationPage.form.prompt')}
        value={form.prompt}
        onChange={(value) => update('prompt', value)}
        fieldClassName="ds-automation-textarea-field"
        textareaClassName="ds-input text-xs rounded-lg min-h-28 resize-y"
        placeholder={t('sidepanel.automationPage.form.promptPlaceholder')}
      />

      {(form.timeoutMs !== null || form.maxToolContinuationTurns !== null) && (
        <div className="grid grid-cols-2 gap-2">
          {form.timeoutMs !== null && (
            <MetaChip
              label={t('sidepanel.automationPage.commandCenter.timeout')}
              value={formatTimeoutBudget(form.timeoutMs, t)}
            />
          )}
          {form.maxToolContinuationTurns !== null && (
            <MetaChip
              label={t('sidepanel.automationPage.commandCenter.toolBudget')}
              value={formatToolContinuationBudget(form.maxToolContinuationTurns, t)}
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <AutomationSelectField
          label={t('sidepanel.automationPage.form.trigger')}
          value={form.scheduleKind}
          onChange={(next) => update('scheduleKind', next as AutomationScheduleKind)}
          options={[
            {
              value: 'manual',
              label: t('sidepanel.automationPage.form.manual'),
            },
            {
              value: 'cron',
              label: t('sidepanel.automationPage.form.cron'),
            },
            {
              value: 'rrule',
              label: t('sidepanel.automationPage.form.repeatRule'),
            },
          ]}
        />
        <TextField
          label={t('sidepanel.automationPage.form.expression')}
          value={isScheduled ? form.expression : ''}
          onChange={(value) => update('expression', value)}
          disabled={!isScheduled}
          fieldClassName="col-span-2"
          inputClassName="px-3 py-2 text-xs rounded-lg"
          placeholder={form.scheduleKind === 'rrule' ? 'FREQ=HOURLY;INTERVAL=1' : '0 9 * * *'}
        />
      </div>

      <TextField
        label={t('sidepanel.automationPage.form.timezone')}
        value={form.timezone}
        onChange={(value) => update('timezone', value)}
        inputClassName="px-3 py-2 text-xs rounded-lg"
        placeholder="Asia/Shanghai"
      />

      <div className="ds-automation-inline-switches">
        <AutomationSwitchField
          checked={visionRouteLocksFlags ? false : form.searchEnabled}
          onChange={(searchEnabled) => update('searchEnabled', searchEnabled)}
          disabled={visionRouteLocksFlags}
          label={t('sidepanel.automationPage.form.search')}
        />
        <AutomationSwitchField
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

      <ToggleRow
        title={t('sidepanel.automationPage.form.chain')}
        description={t('sidepanel.automationPage.form.chainDescription')}
        enabled={form.chainEnabled}
        onToggle={(next) => update('chainEnabled', next)}
      />
      {form.chainEnabled && (
        <div className="space-y-2">
          {chainTargets.length > 0 && (
            <ToggleGroup
              type="multiple"
              value={selectedChainIds}
              onValueChange={(next) => {
                onChange({
                  ...form,
                  chainEnabled: next.length > 0 ? true : form.chainEnabled,
                  chainSuccessIdsText: next.join(', '),
                });
              }}
              variant="outline"
              size="sm"
              spacing={1}
              className="flex-wrap"
            >
              {chainTargets.map((automation) => {
                return (
                  <ToggleGroupItem
                    key={automation.id}
                    value={automation.id}
                    aria-label={automation.name}
                    className="text-[11px] data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {automation.name}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          )}
          <TextField
            ariaLabel={t('sidepanel.automationPage.form.chainPlaceholder')}
            value={form.chainSuccessIdsText}
            onChange={(value) => update('chainSuccessIdsText', value)}
            inputClassName="px-3 py-2 text-xs rounded-lg"
            placeholder={t('sidepanel.automationPage.form.chainPlaceholder')}
          />
        </div>
      )}

      <ToggleRow
        title={t('sidepanel.automationPage.form.reviewGate')}
        description={t('sidepanel.automationPage.form.reviewGateDescription')}
        enabled={form.reviewGateEnabled}
        onToggle={(next) => update('reviewGateEnabled', next)}
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
        <Button type="button" onClick={onCancel} variant="outline" size="sm" className="ds-btn-cancel px-3 py-1.5 text-xs rounded-lg">
          {t('common.cancel')}
        </Button>
        <Button type="button" onClick={onSave} size="sm" className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg">
          {editing ? t('common.save') : t('sidepanel.automationPage.form.create')}
        </Button>
      </div>
    </div>
  );
}

function AutomationCard({
  automation,
  runs,
  running,
  readiness,
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
  readiness: AutomationReadinessReport;
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
  const canPrepare = readiness.status !== 'blocked' && (
    getSafeAutomationReadinessFixes(readiness).length > 0 ||
    getPromptAutomationReadinessFixes(readiness).length > 0
  );
  const runBlocked = readiness.status === 'blocked';
  const statusColor = automation.status === 'active' ? 'var(--ds-text-secondary)' : 'var(--ds-text-tertiary)';
  const statusBg = 'var(--ds-surface)';

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
          <IconButton
            title={automation.status === 'active' ? t('sidepanel.automationPage.status.paused') : t('sidepanel.automationPage.status.active')}
            icon={automation.status === 'active' ? PauseIcon : PlayIcon}
            onClick={onToggleStatus}
          />
          <IconButton title={t('common.edit')} icon={PencilIcon} onClick={onEdit} />
          <IconButton title={t('common.delete')} icon={Trash2Icon} onClick={onDelete} danger />
        </div>
      </div>

      <WorkbenchScrollRail
        label={t('sidepanel.automationPage.cardMetaRailLabel')}
        rowClassName="ds-metric-strip ds-automation-card-meta-strip"
      >
        <MetaChip label={t('sidepanel.automationPage.meta.next')} value={formatTime(automation.nextRunAt, locale, t('sidepanel.automationPage.meta.none'))} />
        <MetaChip label={t('sidepanel.automationPage.meta.previous')} value={formatTime(automation.lastRunAt, locale, t('sidepanel.automationPage.meta.none'))} />
        <MetaChip label={t('sidepanel.automationPage.meta.session')} value={automation.deepseek.chatSessionId ? t('sidepanel.automationPage.meta.chatReady') : t('sidepanel.automationPage.meta.notCreated')} />
        <MetaChip label={t('sidepanel.automationPage.meta.recent')} value={latestRun ? formatRun(latestRun, t) : t('sidepanel.automationPage.meta.none')} />
        <MetaChip label={t('sidepanel.automationPage.meta.visual')} value={automation.promptOptions.visualMonitor?.enabled ? t('sidepanel.automationPage.meta.monitorOn') : t('sidepanel.automationPage.meta.monitorOff')} />
        <MetaChip label={t('sidepanel.automationPage.meta.chain')} value={automation.chain.enabled ? t('sidepanel.automationPage.meta.chainOn', { count: automation.chain.onSuccessAutomationIds.length }) : t('sidepanel.automationPage.meta.chainOff')} />
        <MetaChip label={t('sidepanel.automationPage.meta.strategy')} value={formatSessionStrategy(sessionStrategy, t)} />
        <MetaChip label={t('sidepanel.automationPage.readiness.title')} value={`${readiness.grade} · ${t(`sidepanel.automationPage.readiness.status.${readiness.status}` as LocaleMessageKey)}`} />
      </WorkbenchScrollRail>

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
          {formatAutomationError(automation.lastError.message, t('sidepanel.automationPage.operationUnavailable'))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          onClick={onOpenSession}
          disabled={!automation.deepseek.sessionUrl}
          variant="outline"
          size="sm"
          className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg disabled:opacity-50"
        >
          {t('sidepanel.automationPage.actions.openSession')}
        </Button>
        <div className="flex items-center gap-2">
          {canPrepare && (
            <Button
              type="button"
              onClick={onPrepare}
              variant="outline"
              size="sm"
              className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg"
            >
              {t('sidepanel.automationPage.readiness.prepareRun')}
            </Button>
          )}
          <Button
            type="button"
            onClick={onRun}
            disabled={running || runBlocked}
            size="sm"
            className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg disabled:opacity-60"
          >
            {runBlocked
              ? t('sidepanel.automationPage.readiness.status.blocked')
              : running
                ? t('sidepanel.automationPage.status.running')
                : t('sidepanel.automationPage.actions.runNow')}
          </Button>
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
  const toneColor = blocked ? 'var(--ds-danger)' : 'var(--ds-text-secondary)';
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
            <Button
              type="button"
              onClick={onPrepareRun}
              size="xs"
              className="ds-btn-primary px-2.5 py-1 text-[11px] rounded-md text-white"
            >
              {t('sidepanel.automationPage.readiness.prepareRun')}
            </Button>
          )}
          {canApplySafeFixes && (
            <Button
              type="button"
              onClick={onApplySafeFixes}
              variant="outline"
              size="xs"
              className="ds-btn-secondary px-2.5 py-1 text-[11px] rounded-md"
            >
              {t('sidepanel.automationPage.readiness.applySafeFixes')}
            </Button>
          )}
          {canApplyPromptFixes && (
            <Button
              type="button"
              onClick={onApplyPromptFixes}
              variant="outline"
              size="xs"
              className="ds-btn-secondary px-2.5 py-1 text-[11px] rounded-md"
            >
              {t('sidepanel.automationPage.readiness.addLoopContract')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function RunFlightRecorder({ run }: { run: AutomationRun }) {
  const { t, locale } = useI18n();
  const recorder = run.flightRecorder;
  const replayBrief = createAutomationRunReplayBrief(run);
  if (!recorder) {
    return (
      <details className="rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--ds-border)' }}>
        <summary className="cursor-pointer text-[11px] font-medium" style={{ color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.automationPage.flightRecorder.title')}
        </summary>
        <div className="mt-2 text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.automationPage.flightRecorder.noRecorder')}
        </div>
        <RunReplayBrief brief={replayBrief} />
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
      <RunReplayBrief brief={replayBrief} />
    </details>
  );
}

function RunReplayBrief({ brief }: { brief: string }) {
  const { t } = useI18n();
  return (
    <details className="mt-2 rounded-md border px-2 py-1.5" style={{ borderColor: 'var(--ds-border)' }}>
      <summary className="cursor-pointer text-[11px] font-medium" style={{ color: 'var(--ds-text-secondary)' }}>
        {t('sidepanel.automationPage.flightRecorder.replayBrief')}
      </summary>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-4" style={{ color: 'var(--ds-text-tertiary)' }}>
        {brief}
      </pre>
    </details>
  );
}

function IconButton({
  title,
  icon: Icon,
  onClick,
  danger,
}: {
  title: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <WorkbenchTooltip label={title}>
      <Button
        type="button"
        aria-label={title}
        onClick={onClick}
        variant={danger ? 'destructive' : 'ghost'}
        size="icon-sm"
        className={`ds-action-btn ${danger ? 'ds-action-btn-delete' : 'ds-action-btn-edit'}`}
      >
        <Icon aria-hidden="true" />
      </Button>
    </WorkbenchTooltip>
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
    chainEnabled: automation.chain.enabled,
    chainSuccessIdsText: automation.chain.onSuccessAutomationIds.join(', '),
    reviewGateEnabled: hasAutomationReviewGate(automation.prompt),
    timeoutMs: automation.schedule.timeoutMs ?? null,
    maxToolContinuationTurns: automation.promptOptions.maxToolContinuationTurns ?? null,
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
    chainEnabled: input.chain?.enabled === true,
    chainSuccessIdsText: input.chain?.onSuccessAutomationIds.join(', ') ?? '',
    reviewGateEnabled: hasAutomationReviewGate(input.prompt),
    timeoutMs: input.schedule.timeoutMs ?? null,
    maxToolContinuationTurns: input.promptOptions.maxToolContinuationTurns ?? null,
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
    form.chainSuccessIdsText.trim() ||
    form.chainEnabled ||
    form.reviewGateEnabled ||
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
    prompt: form.reviewGateEnabled ? applyAutomationReviewGate(form.prompt) : form.prompt.trim(),
    schedule,
    chain: {
      enabled: form.chainEnabled,
      onSuccessAutomationIds: parseAutomationChainIds(form.chainSuccessIdsText),
      maxDepth: 3,
    },
    promptOptions: {
      ...DEFAULT_PROMPT_OPTIONS,
      modelType: route.modelType,
      searchEnabled: route.searchEnabled,
      thinkingEnabled: route.thinkingEnabled,
      refFileIds: route.refFileIds,
      ...(form.maxToolContinuationTurns === null ? {} : { maxToolContinuationTurns: form.maxToolContinuationTurns }),
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
    ...(form.timeoutMs === null ? {} : { timeoutMs: form.timeoutMs }),
  };
}

function materializeWorkflowObjective(prompt: string, objective: string | undefined): string {
  const trimmed = objective?.trim();
  if (!trimmed) return prompt;
  return prompt
    .replace('[replace with objective]', trimmed)
    .replace('[\u66ff\u6362\u4e3a\u76ee\u6807]', trimmed);
}

const AUTOMATION_ERROR_LEAK_PATTERN = /\b(?:GET|RUN|CREATE|UPDATE|DELETE|SET|SAVE)_[A-Z0-9_]+\b|\b(?:Authorization|Bearer|Cookie|secret|token|api[_-]?key)\b|data:image|blob:|base64|schemaVersion|chrome\.runtime|chrome\.storage|IndexedDB|localStorage|sessionStorage|\[object Object\]|https?:\/\/|chrome-extension:\/\//i;

function formatAutomationError(error: unknown, fallback: string): string {
  const message = getRuntimeErrorMessage(error).trim();
  if (!message) return fallback;
  if (AUTOMATION_ERROR_LEAK_PATTERN.test(message)) return fallback;
  return message;
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

function formatTimeoutBudget(timeoutMs: number, t: ReturnType<typeof useI18n>['t']): string {
  return t('sidepanel.automationPage.commandCenter.timeoutMinutes', {
    count: Math.max(1, Math.round(timeoutMs / 60_000)),
  });
}

function formatToolContinuationBudget(turns: number, t: ReturnType<typeof useI18n>['t']): string {
  return t('sidepanel.automationPage.commandCenter.toolBudgetTurns', {
    count: Math.max(1, Math.floor(turns)),
  });
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
  if (status === 'success') return 'var(--ds-text-tertiary)';
  if (status === 'error') return 'var(--ds-danger)';
  if (status === 'warning') return 'var(--ds-warning, var(--ds-text-secondary))';
  return 'var(--ds-text-tertiary)';
}

function readinessToneColor(status: AutomationReadinessReport['status']): string {
  if (status === 'ready') return 'var(--ds-text-secondary)';
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

function parseAutomationChainIds(value: string): string[] {
  const ids: string[] = [];
  for (const item of value.split(/[\s,]+/)) {
    const normalized = item.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    if (normalized && !ids.includes(normalized)) ids.push(normalized);
  }
  return ids;
}
