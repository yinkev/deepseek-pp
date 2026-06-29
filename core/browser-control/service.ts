import { getBrowserControlSettings, saveBrowserControlSettings } from './settings';
import { BrowserConnection, BrowserControlError } from './cdp';
import { formatAccessibilitySnapshot } from './snapshot';
import { readOptionalChromeApi } from '../platform/chrome-api';
import {
  DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES,
  DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN,
} from '../deepseek/web-vision';
import type {
  BrowserActionResult,
  BrowserControlDependencies,
  BrowserControlSettings,
  BrowserControlState,
  BrowserControlTarget,
  BrowserControlTargetPreparation,
  BrowserControlWindowHint,
  BrowserViewCaptureResult,
  BrowserScreenshotCaptureResult,
  BrowserControlToolName,
  BrowserSnapshotResult,
} from './types';

type RuntimeRemoteObject = {
  type?: string;
  subtype?: string;
  value?: unknown;
  unserializableValue?: string;
  objectId?: string;
  description?: string;
};

type ElementHandle = {
  objectId: string;
  label: string;
};

type SnapshotUidContext = {
  snapshotId: string;
  targetLeaseId: string;
  tabId: number;
  windowId: number | null;
  url: string;
  origin: string;
  capturedAt: number;
};

export type ElementPoint = {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
};

export interface BrowserControlExecuteOptions {
  requireExplicitTarget?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_WAIT_TIMEOUT_MS = 5_000;
const MAX_WAIT_TIMEOUT_MS = 60_000;
const SNAPSHOT_UID_MAX_AGE_MS = 30_000;
const BROWSER_VIEW_CAPTURE_MAX_IMAGES = DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN;
const BROWSER_VIEW_CAPTURE_MAX_NESTED_PANELS = BROWSER_VIEW_CAPTURE_MAX_IMAGES - 1;
const BROWSER_VIEW_CAPTURE_MAX_IMAGE_BYTES = DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES;
const BROWSER_VIEW_CAPTURE_MAX_LONG_EDGE = 12_000;
const BROWSER_VIEW_CAPTURE_MAX_AREA = 36_000_000;
const BROWSER_VIEW_PANEL_MAX_STITCH_SLICES = 8;
const BROWSER_VIEW_PANEL_SAMPLE_SLICES = 3;
const BROWSER_VIEW_PANEL_MIN_VISIBLE_AREA = 24_000;
const BROWSER_VIEW_PANEL_MIN_OVERFLOW_PX = 160;
const BROWSER_VIEW_PANEL_SCROLL_SETTLE_MS = 80;
const BROWSER_VIEW_CAPTURE_GLOBAL = '__deepseekPpBrowserViewCapture';

type BrowserViewCaptureSource = NonNullable<BrowserScreenshotCaptureResult['source']>;

type BrowserViewRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type BrowserViewCapturePlan = {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
  panels: BrowserViewPanelCandidate[];
};

type BrowserViewPanelCandidate = {
  id: string;
  label: string;
  rect: BrowserViewRect;
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
  score: number;
  sampled: boolean;
};

type BrowserViewPanelSlice = {
  dataBase64: string;
  scrollTop: number;
  label: string;
};

export class BrowserControlService {
  private readonly dependencies: BrowserControlDependencies;
  private readonly connection: BrowserConnection | null;
  private readonly uidToBackendNodeId = new Map<string, number>();
  private snapshotUidContext: SnapshotUidContext | null = null;
  private lastError: string | null = null;

  constructor(dependencies: BrowserControlDependencies = {}) {
    this.dependencies = dependencies;
    const chromeApi = this.getChromeApi();
    this.connection = chromeApi
      ? new BrowserConnection(chromeApi, {
        onInvalidated: (_reason, tabId) => {
          if (this.snapshotUidContext?.tabId === tabId) {
            this.clearSnapshotUidCache();
          }
        },
      })
      : null;
  }

  isSupported(): boolean {
    const chromeApi = this.getChromeApi();
    return Boolean(
      readOptionalChromeApi(() => chromeApi?.debugger?.attach) &&
      readOptionalChromeApi(() => chromeApi?.debugger?.sendCommand) &&
      readOptionalChromeApi(() => chromeApi?.tabs?.query) &&
      readOptionalChromeApi(() => chromeApi?.tabs?.get),
    );
  }

  async getState(): Promise<BrowserControlState> {
    const settings = await getBrowserControlSettings();
    const supported = this.isSupported();
    const targets = supported ? await this.listTargets() : [];
    const target = settings.targetTabId === null
      ? null
      : targets.find((item) => item.id === settings.targetTabId) ?? null;

    return {
      supported,
      enabled: settings.enabled,
      attached: this.connection?.attached ?? false,
      targetTabId: settings.targetTabId,
      target,
      targets,
      error: this.lastError,
    };
  }

  async listTargets(): Promise<BrowserControlTarget[]> {
    const chromeApi = this.requireChromeApi();
    const activeCurrent = await chromeApi.tabs.query({ active: true, currentWindow: true });
    const activeCurrentId = activeCurrent[0]?.id ?? null;
    const tabGroups = readOptionalChromeApi(() => chromeApi.tabGroups);
    const windowHints = await getChromeWindowHints(chromeApi);
    const groups = tabGroups?.query
      ? await tabGroups.query({}).catch(() => [])
      : [];
    const groupNames = new Map(
      (groups ?? []).map((group) => [group.id, group.title || group.color || `Group ${group.id}`]),
    );
    const tabs = await chromeApi.tabs.query({});
    return tabs
      .filter((tab) => typeof tab.id === 'number')
      .map((tab) => {
        const { controllable, reason } = getControllableState(tab.url ?? '');
        const groupId = typeof tab.groupId === 'number' ? tab.groupId : -1;
        return {
          id: tab.id!,
          windowId: tab.windowId,
          windowHint: windowHints.get(tab.windowId) ?? null,
          groupId,
          groupName: groupNames.get(groupId),
          active: tab.active,
          currentWindow: tab.id === activeCurrentId,
          title: tab.title ?? '',
          url: tab.url ?? '',
          controllable,
          reason,
        };
      });
  }

  async setTarget(tabId: number): Promise<BrowserControlTarget> {
    const target = await this.getTargetOrThrow(tabId);
    if (!target.controllable) {
      throw new BrowserControlError(
        'browser_target_not_controllable',
        target.reason ?? 'This tab cannot be controlled by chrome.debugger.',
      );
    }
    const current = await getBrowserControlSettings();
    if (current.targetTabId !== tabId) {
      await this.switchTargetLease();
    }
    await saveBrowserControlSettings({
      targetTabId: tabId,
      lastTargetHint: createTargetHint(target, this.now()),
    });
    return target;
  }

  invalidateSnapshotLease(): void {
    this.clearSnapshotUidCache();
  }

  async lockCurrentTarget(label = 'Dev++'): Promise<BrowserControlTarget> {
    const settings = await getBrowserControlSettings();
    const tabId = await this.requireSelectedTargetTabId(settings);
    const target = await this.getTargetOrThrow(tabId);
    if (!target.controllable) {
      throw new BrowserControlError(
        'browser_target_not_controllable',
        target.reason ?? 'The selected tab cannot be used as the personal browser target.',
      );
    }
    const targetLock = createTargetLock(target, label, this.now());
    if (!targetLock) {
      throw new BrowserControlError(
        'browser_target_lock_failed',
        'The selected tab does not have a safe origin to lock onto.',
      );
    }
    await saveBrowserControlSettings({
      targetTabId: tabId,
      lastTargetHint: createTargetHint(target, this.now()),
      targetLock,
    });
    return target;
  }

  async clearTargetLock(): Promise<void> {
    await saveBrowserControlSettings({ targetLock: null });
  }

  async preparePersonalTarget(options: {
    allowActiveFallback?: boolean;
  } = {}): Promise<BrowserControlTargetPreparation> {
    if (!this.isSupported()) {
      return { target: null, status: 'unsupported' };
    }

    const settings = await getBrowserControlSettings();
    if (settings.targetLock?.enabled) {
      if (typeof settings.targetLock.targetTabId === 'number') {
        try {
          const target = await this.getTargetOrThrow(settings.targetLock.targetTabId);
          if (matchesTargetLock(target, settings.targetLock)) {
            if (settings.targetTabId !== target.id) {
              await this.switchTargetLease();
              await saveBrowserControlSettings({
                targetTabId: target.id,
                lastTargetHint: createTargetHint(target, this.now()),
                targetLock: createTargetLock(target, settings.targetLock.label, this.now()),
              });
              return { target, status: 'reacquired' };
            }
            return { target, status: 'ready' };
          }
        } catch {
          // Stale locked tab ids are expected after browser reloads; fall through to origin matching.
        }
      }
      const targets = await this.listTargets();
      const locked = findLockedTarget(targets, settings.targetLock);
      if (!locked) return { target: null, status: 'missing' };
      if (settings.targetTabId !== locked.id) {
        await this.switchTargetLease();
        await saveBrowserControlSettings({
          targetTabId: locked.id,
          lastTargetHint: createTargetHint(locked, this.now()),
          targetLock: createTargetLock(locked, settings.targetLock.label, this.now()),
        });
        return { target: locked, status: 'reacquired' };
      }
      if (locked.controllable) {
        return { target: locked, status: 'ready' };
      }
      return { target: locked, status: 'not_controllable' };
    }

    if (typeof settings.targetTabId === 'number') {
      try {
        const target = await this.getTargetOrThrow(settings.targetTabId);
        if (target.controllable) {
          return { target, status: 'ready' };
        }
        return { target, status: 'not_controllable' };
      } catch {
        // A stale tab id is expected after browser reloads; try the saved hint.
      }
    }

    const targets = await this.listTargets();
    const hinted = findHintedTarget(targets, settings.lastTargetHint);
    if (hinted) {
      await this.setTarget(hinted.id);
      return { target: hinted, status: 'reacquired' };
    }

    if (options.allowActiveFallback) {
      const active = targets.find((target) =>
        target.currentWindow && target.controllable && !isDeepSeekChatTarget(target.url)
      );
      if (active) {
        await this.setTarget(active.id);
        return { target: active, status: 'selected_active' };
      }
    }

    return { target: null, status: 'missing' };
  }

  async detach(): Promise<void> {
    this.clearSnapshotUidCache();
    await this.connection?.detach();
  }

  async captureScreenshotForVision(): Promise<BrowserScreenshotCaptureResult> {
    const settings = await getBrowserControlSettings();
    if (!settings.enabled) {
      throw new BrowserControlError(
        'browser_control_disabled',
        'Browser control is disabled. Enable it in the DeepSeek++ side panel before capturing the controlled tab.',
      );
    }
    if (!settings.allowVisionCapture) {
      throw new BrowserControlError(
        'browser_vision_capture_disabled',
        'Browser visual capture is disabled. Enable Visual capture on the Browser Control page before using this tool.',
      );
    }
    const tabId = await this.requireSelectedTargetTabId(settings);
    await this.ensureAttached(tabId);
    const tab = await this.requireChromeApi().tabs.get(tabId);
    const captured = await this.connection!.sendCommand<{ data?: unknown }>('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    if (typeof captured.data !== 'string' || captured.data.length === 0) {
      throw new BrowserControlError(
        'browser_capture_failed',
        'Chrome did not return screenshot data for the controlled tab.',
        { retryable: true },
      );
    }

    return {
      tabId,
      windowId: tab.windowId,
      mimeType: 'image/png',
      dataBase64: captured.data,
      sizeBytes: base64ByteLength(captured.data),
      capturedAt: this.now(),
    };
  }

  async captureBrowserViewForVision(): Promise<BrowserViewCaptureResult> {
    const settings = await getBrowserControlSettings();
    if (!settings.enabled) {
      throw new BrowserControlError(
        'browser_control_disabled',
        'Browser control is disabled. Enable it in the DeepSeek++ side panel before capturing the controlled tab.',
      );
    }
    if (!settings.allowVisionCapture) {
      throw new BrowserControlError(
        'browser_vision_capture_disabled',
        'Browser visual capture is disabled. Enable Visual capture on the Browser Control page before using this tool.',
      );
    }
    const tabId = await this.requireSelectedTargetTabId(settings);
    await this.ensureAttached(tabId);
    const tab = await this.requireChromeApi().tabs.get(tabId);
    const capturedAt = this.now();
    const warnings: string[] = [];
    const fullPage = await this.captureFullPageForBrowserView(tabId, tab.windowId, capturedAt)
      .catch(async () => {
        warnings.push('Full-page screenshot was too large or unavailable; attached sampled page evidence.');
        return this.captureFullPageSampleForBrowserView(tabId, tab.windowId, capturedAt)
          .catch(() => {
            warnings.push('Sampled full-page evidence failed; attached visible viewport fallback.');
            return this.captureViewportFallbackForBrowserView(tabId, tab.windowId, capturedAt);
          });
      });
    let skippedNestedScrolls = 0;
    const nestedCaptures: BrowserScreenshotCaptureResult[] = [];

    try {
      const plan = await this.planBrowserViewNestedScrollCaptures();
      skippedNestedScrolls = Math.max(0, plan.panels.length - BROWSER_VIEW_CAPTURE_MAX_NESTED_PANELS);
      for (const panel of plan.panels.slice(0, BROWSER_VIEW_CAPTURE_MAX_NESTED_PANELS)) {
        try {
          const capture = await this.captureNestedScrollPanelForBrowserView(tabId, tab.windowId, capturedAt, panel);
          if (capture) nestedCaptures.push(capture);
        } catch {
          skippedNestedScrolls += 1;
        }
      }
    } finally {
      await this.restoreBrowserViewNestedScrollState().catch(() => {});
    }

    const captures = [fullPage, ...nestedCaptures].slice(0, BROWSER_VIEW_CAPTURE_MAX_IMAGES);
    return {
      tabId,
      windowId: tab.windowId,
      capturedAt,
      captures,
      labels: captures.map((capture) => capture.label ?? 'Browser view'),
      warnings,
      skippedNestedScrolls,
    };
  }

  async execute(
    name: BrowserControlToolName,
    payload: Record<string, unknown>,
    options: BrowserControlExecuteOptions = {},
  ): Promise<BrowserActionResult> {
    const started = this.now();
    try {
      assertBrowserControlNotAborted(options.signal);
      const settings = await getBrowserControlSettings();
      assertBrowserControlNotAborted(options.signal);
      if (!settings.enabled && name !== 'browser_list_tabs') {
        throw new BrowserControlError(
          'browser_control_disabled',
          'Browser control is disabled. Enable it in the DeepSeek++ side panel before using browser tools.',
        );
      }

      const executionSettings = await this.prepareExecutionSettings(name, payload, settings, options);
      assertBrowserControlNotAborted(options.signal);
      const result = await this.executeEnabled(name, payload, executionSettings, options.signal);
      assertBrowserControlNotAborted(options.signal);
      this.lastError = null;
      return {
        ...result,
        output: {
          ...asObject(result.output),
          durationMs: this.now() - started,
        },
      };
    } catch (error) {
      if (shouldClearSnapshotUidCacheAfterFailedAction(name)) {
        this.clearSnapshotUidCache();
      }
      const normalized = normalizeError(error);
      this.lastError = normalized.message;
      return {
        ok: false,
        summary: normalized.message,
        detail: normalized.message,
        error: {
          code: normalized.code,
          message: normalized.message,
          retryable: normalized.retryable,
          details: normalized.details,
        },
      };
    }
  }

  private async executeEnabled(
    name: BrowserControlToolName,
    payload: Record<string, unknown>,
    settings: BrowserControlSettings,
    signal?: AbortSignal,
  ): Promise<BrowserActionResult> {
    assertBrowserControlNotAborted(signal);
    switch (name) {
      case 'browser_navigate':
        return this.navigate(payload, settings);
      case 'browser_go_back':
        return this.navigateHistory('back', settings);
      case 'browser_go_forward':
        return this.navigateHistory('forward', settings);
      case 'browser_refresh':
        return this.refresh(settings);
      case 'browser_list_tabs':
        return this.listTabs();
      case 'browser_select_tab':
        return this.selectTab(payload);
      case 'browser_close_tab':
        return this.closeTab(payload);
      case 'browser_snapshot':
        return this.snapshotAction(settings);
      case 'browser_click':
        return this.pointAction('click', payload, settings);
      case 'browser_hover':
        return this.pointAction('hover', payload, settings);
      case 'browser_fill':
        return this.fill(payload, settings);
      case 'browser_fill_form':
        return this.fillForm(payload, settings);
      case 'browser_key':
        return this.key(payload, settings);
      case 'browser_type':
        return this.typeText(payload, settings);
      case 'browser_attach_file':
        return this.attachFile(payload, settings);
      case 'browser_wait_for':
        return this.waitFor(payload, settings, signal);
      case 'browser_handle_dialog':
        return this.handleDialog(payload, settings);
      case 'browser_evaluate_script':
        return this.evaluateScript(payload, settings);
      default:
        throw new BrowserControlError('browser_tool_unsupported', `Unsupported browser tool: ${name}`);
    }
  }

  private async prepareExecutionSettings(
    name: BrowserControlToolName,
    payload: Record<string, unknown>,
    settings: BrowserControlSettings,
    options: BrowserControlExecuteOptions,
  ): Promise<BrowserControlSettings> {
    if (!options.requireExplicitTarget || !requiresSelectedTarget(name, payload)) {
      return settings;
    }
    const targetTabId = await this.requireSelectedTargetTabId(
      settings,
      'Select an explicit Browser Control target before running automation browser actions.',
    );
    return { ...settings, targetTabId };
  }

  private async navigate(
    payload: Record<string, unknown>,
    settings: BrowserControlSettings,
  ): Promise<BrowserActionResult> {
    const url = normalizeUrl(requireString(payload, 'url'));
    const newTab = readOptionalBoolean(payload, 'newTab', false);
    let tabId: number;
    if (newTab) {
      const tab = await this.requireChromeApi().tabs.create({ url, active: true });
      if (typeof tab.id !== 'number') {
        throw new BrowserControlError('browser_tab_create_failed', 'Chrome did not return a tab id for the new tab.');
      }
      tabId = tab.id;
      await this.switchTargetLease();
      await saveBrowserControlSettings({ targetTabId: tabId, lastTargetHint: createTabHint(tab, this.now()) });
    } else {
      tabId = await this.ensureTargetTabId(settings, { createIfMissing: true, navigateUrl: url });
      await this.rejectDeepSeekProviderTargetAction(tabId, 'navigate away from it');
      await this.ensureAttached(tabId);
      await this.connection!.sendCommand('Page.navigate', { url });
    }

    await this.waitForTabUrl(tabId, url, 3_000).catch(() => {});
    return this.withOptionalSnapshot({
      ok: true,
      summary: newTab ? `Opened ${url}` : `Navigated to ${url}`,
      detail: newTab
        ? `Opened new controlled tab ${tabId} at ${url}.`
        : `Navigated controlled tab ${tabId} to ${url}.`,
      output: { tabId, url, newTab },
    }, { ...settings, targetTabId: tabId });
  }

  private async navigateHistory(
    direction: 'back' | 'forward',
    settings: BrowserControlSettings,
  ): Promise<BrowserActionResult> {
    const tabId = await this.ensureTargetTabId(settings);
    await this.rejectDeepSeekProviderTargetAction(tabId, `go ${direction}`);
    await this.ensureAttached(tabId);
    const history = await this.connection!.sendCommand<{
      currentIndex?: number;
      entries?: Array<{ id?: number; url?: string }>;
    }>('Page.getNavigationHistory');
    const currentIndex = history.currentIndex ?? 0;
    const nextIndex = direction === 'back' ? currentIndex - 1 : currentIndex + 1;
    const entry = history.entries?.[nextIndex];
    if (!entry || typeof entry.id !== 'number') {
      throw new BrowserControlError(
        `browser_cannot_go_${direction}`,
        direction === 'back' ? 'No previous history entry.' : 'No forward history entry.',
      );
    }
    await this.connection!.sendCommand('Page.navigateToHistoryEntry', { entryId: entry.id });
    return this.withOptionalSnapshot({
      ok: true,
      summary: direction === 'back' ? 'Went back' : 'Went forward',
      detail: `Navigated ${direction} to ${entry.url ?? '(unknown URL)'}.`,
      output: { tabId, direction, url: entry.url ?? '' },
    }, settings);
  }

  private async refresh(settings: BrowserControlSettings): Promise<BrowserActionResult> {
    const tabId = await this.ensureTargetTabId(settings);
    await this.ensureAttached(tabId);
    await this.connection!.sendCommand('Page.reload', { ignoreCache: false });
    return this.withOptionalSnapshot({
      ok: true,
      summary: 'Reloaded controlled tab',
      detail: `Reloaded tab ${tabId}.`,
      output: { tabId },
    }, settings);
  }

  private async listTabs(): Promise<BrowserActionResult> {
    const targets = await this.listTargets();
    const lines = targets.map((target) => {
      const marker = target.currentWindow ? '*' : ' ';
      const status = target.controllable ? 'controllable' : `blocked: ${target.reason}`;
      return `${marker} ${target.id} ${target.title || '(untitled)'} - ${target.url || '(no url)'} [${status}]`;
    });
    return {
      ok: true,
      summary: `Found ${targets.length} browser tabs`,
      detail: lines.join('\n'),
      output: { targets: targets.map(targetToJson) },
    };
  }

  private async selectTab(payload: Record<string, unknown>): Promise<BrowserActionResult> {
    const tabId = requireInteger(payload, 'tabId');
    const target = await this.setTarget(tabId);
    await this.requireChromeApi().tabs.update(tabId, { active: true }).catch(() => undefined);
    return {
      ok: true,
      summary: `Selected tab ${tabId}`,
      detail: `Selected tab ${tabId}: ${target.title || target.url || '(untitled)'}.`,
      output: { target: targetToJson(target) },
    };
  }

  private async closeTab(payload: Record<string, unknown>): Promise<BrowserActionResult> {
    const settings = await getBrowserControlSettings();
    const tabId = typeof payload.tabId === 'number'
      ? requireInteger(payload, 'tabId')
      : await this.ensureTargetTabId(settings);
    await this.rejectDeepSeekProviderTargetAction(tabId, 'close it');
    if (this.connection?.tabId === tabId) await this.switchTargetLease();
    await this.requireChromeApi().tabs.remove(tabId);
    if (settings.targetTabId === tabId) {
      await saveBrowserControlSettings({ targetTabId: null });
    }
    return {
      ok: true,
      summary: `Closed tab ${tabId}`,
      detail: `Closed browser tab ${tabId}.`,
      output: { tabId },
    };
  }

  private async snapshotAction(settings: BrowserControlSettings): Promise<BrowserActionResult> {
    const snapshot = await this.createSnapshot(settings);
    return {
      ok: true,
      summary: `Captured ${snapshot.nodes.length} accessibility nodes`,
      detail: snapshot.text,
      output: snapshotToJson(snapshot),
      snapshot,
    };
  }

  private async pointAction(
    action: 'click' | 'hover',
    payload: Record<string, unknown>,
    settings: BrowserControlSettings,
  ): Promise<BrowserActionResult> {
    const tabId = await this.ensureTargetTabId(settings);
    await this.ensureAttached(tabId);
    const element = await this.resolveElement(payload);
    const point = await this.getElementPoint(element.objectId);
    if (!point.visible) {
      throw new BrowserControlError('browser_element_not_visible', `${element.label} is not visible.`);
    }

    await this.connection!.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none',
    });
    if (action === 'click') {
      const button = readString(payload.button, 'left');
      const clickCount = clampInteger(payload.clickCount, 1, 1, 3);
      await this.connection!.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button,
        clickCount,
      });
      await this.connection!.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button,
        clickCount,
      });
    }

    return this.withOptionalSnapshot({
      ok: true,
      summary: action === 'click' ? `Clicked ${element.label}` : `Hovered ${element.label}`,
      detail: `${action === 'click' ? 'Clicked' : 'Hovered'} ${element.label} at (${Math.round(point.x)}, ${Math.round(point.y)}).`,
      output: { tabId, action, target: element.label, point },
    }, settings);
  }

  private async fill(
    payload: Record<string, unknown>,
    settings: BrowserControlSettings,
  ): Promise<BrowserActionResult> {
    const tabId = await this.ensureTargetTabId(settings);
    await this.ensureAttached(tabId);
    const value = requireString(payload, 'value');
    const element = await this.resolveElement(payload);
    await this.fillElement(element, value);
    return this.withOptionalSnapshot({
      ok: true,
      summary: `Filled ${element.label}`,
      detail: `Filled ${element.label} using DOM value assignment and input/change events.`,
      output: { tabId, target: element.label, valueLength: value.length },
    }, settings);
  }

  private async fillForm(
    payload: Record<string, unknown>,
    settings: BrowserControlSettings,
  ): Promise<BrowserActionResult> {
    const tabId = await this.ensureTargetTabId(settings);
    await this.ensureAttached(tabId);
    const fields = payload.fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      throw new BrowserControlError('browser_invalid_fields', 'fields must be a non-empty array.');
    }

    const filled: Array<{ target: string; valueLength: number }> = [];
    for (const field of fields) {
      if (!field || typeof field !== 'object' || Array.isArray(field)) {
        throw new BrowserControlError('browser_invalid_field', 'Each field must be an object.');
      }
      const record = field as Record<string, unknown>;
      const value = requireString(record, 'value');
      const element = await this.resolveElement(record);
      await this.fillElement(element, value);
      filled.push({ target: element.label, valueLength: value.length });
    }

    return this.withOptionalSnapshot({
      ok: true,
      summary: `Filled ${filled.length} form fields`,
      detail: `Filled ${filled.length} fields using DOM value assignment and input/change events.`,
      output: { tabId, filled },
    }, settings);
  }

  private async key(
    payload: Record<string, unknown>,
    settings: BrowserControlSettings,
  ): Promise<BrowserActionResult> {
    const tabId = await this.ensureTargetTabId(settings);
    await this.ensureAttached(tabId);
    if (payload.uid || payload.selector) {
      const element = await this.resolveElement(payload);
      await this.focusElement(element);
    }
    const key = requireString(payload, 'key');
    const keyParams = keyEventParams(key);
    await this.connection!.sendCommand('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      ...keyParams,
    });
    await this.connection!.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...keyParams,
    });

    return this.withOptionalSnapshot({
      ok: true,
      summary: `Pressed ${key}`,
      detail: `Pressed key ${key}.`,
      output: { tabId, key },
    }, settings);
  }

  private async typeText(
    payload: Record<string, unknown>,
    settings: BrowserControlSettings,
  ): Promise<BrowserActionResult> {
    const tabId = await this.ensureTargetTabId(settings);
    await this.ensureAttached(tabId);
    if (payload.uid || payload.selector) {
      const element = await this.resolveElement(payload);
      await this.focusElement(element);
    }
    const text = requireString(payload, 'text');
    await this.connection!.sendCommand('Input.insertText', { text });
    return this.withOptionalSnapshot({
      ok: true,
      summary: `Typed ${text.length} characters`,
      detail: `Inserted ${text.length} characters into the focused element.`,
      output: { tabId, textLength: text.length },
    }, settings);
  }

  private async attachFile(
    payload: Record<string, unknown>,
    settings: BrowserControlSettings,
  ): Promise<BrowserActionResult> {
    const tabId = await this.ensureTargetTabId(settings);
    await this.ensureAttached(tabId);
    const files = payload.files;
    if (!Array.isArray(files) || !files.every((item) => typeof item === 'string' && item.trim())) {
      throw new BrowserControlError('browser_invalid_files', 'files must be a non-empty string array of absolute file paths.');
    }
    const element = await this.resolveElement(payload);
    await this.connection!.sendCommand('DOM.setFileInputFiles', {
      objectId: element.objectId,
      files,
    });
    return this.withOptionalSnapshot({
      ok: true,
      summary: `Attached ${files.length} file(s)`,
      detail: `Attached ${files.length} file(s) to ${element.label}.`,
      output: { tabId, target: element.label, fileCount: files.length },
    }, settings);
  }

  private async waitFor(
    payload: Record<string, unknown>,
    settings: BrowserControlSettings,
    signal?: AbortSignal,
  ): Promise<BrowserActionResult> {
    const tabId = await this.ensureTargetTabId(settings);
    await this.ensureAttached(tabId);
    const timeoutMs = clampInteger(payload.timeoutMs, DEFAULT_WAIT_TIMEOUT_MS, 250, MAX_WAIT_TIMEOUT_MS);
    const started = this.now();
    const expression = waitExpression(payload);

    while (this.now() - started <= timeoutMs) {
      assertBrowserControlNotAborted(signal);
      const matched = await this.evaluateBoolean(expression);
      assertBrowserControlNotAborted(signal);
      if (matched) {
        return this.withOptionalSnapshot({
          ok: true,
          summary: 'Wait condition matched',
          detail: `Condition matched after ${this.now() - started}ms.`,
          output: { tabId, waitedMs: this.now() - started },
        }, settings);
      }
      await delay(250, signal);
    }

    throw new BrowserControlError('browser_wait_timeout', `Condition did not match within ${timeoutMs}ms.`, {
      retryable: true,
    });
  }

  private async handleDialog(
    payload: Record<string, unknown>,
    settings: BrowserControlSettings,
  ): Promise<BrowserActionResult> {
    const tabId = await this.ensureTargetTabId(settings);
    await this.ensureAttached(tabId);
    const dialog = this.connection!.getLatestDialog(tabId);
    if (!dialog) {
      throw new BrowserControlError('browser_dialog_not_open', 'No JavaScript dialog is currently open.');
    }
    const accept = payload.accept !== false;
    const promptText = typeof payload.promptText === 'string' ? payload.promptText : undefined;
    await this.connection!.sendCommand('Page.handleJavaScriptDialog', {
      accept,
      ...(promptText !== undefined ? { promptText } : {}),
    });
    this.connection!.clearDialog(tabId);
    return this.withOptionalSnapshot({
      ok: true,
      summary: accept ? 'Accepted JavaScript dialog' : 'Dismissed JavaScript dialog',
      detail: `${accept ? 'Accepted' : 'Dismissed'} ${dialog.type} dialog: ${dialog.message}`,
      output: {
        tabId,
        accepted: accept,
        dialog: {
          type: dialog.type,
          message: dialog.message,
          defaultPrompt: dialog.defaultPrompt ?? null,
        },
      },
    }, settings);
  }

  private async evaluateScript(
    payload: Record<string, unknown>,
    settings: BrowserControlSettings,
  ): Promise<BrowserActionResult> {
    const tabId = await this.ensureTargetTabId(settings);
    await this.rejectDeepSeekProviderTargetAction(tabId, 'run arbitrary script on it');
    await this.ensureAttached(tabId);
    const expression = typeof payload.expression === 'string'
      ? payload.expression
      : requireString(payload, 'script');
    const result = await this.evaluate(expression, { awaitPromise: payload.awaitPromise !== false });
    return this.withOptionalSnapshot({
      ok: true,
      summary: 'Evaluated script',
      detail: `Result: ${JSON.stringify(result).slice(0, 4_000)}`,
      output: { tabId, result: toJsonSafe(result) },
    }, settings);
  }

  private async ensureTargetTabId(
    settings: BrowserControlSettings,
    options: { createIfMissing?: boolean; navigateUrl?: string } = {},
  ): Promise<number> {
    if (typeof settings.targetTabId === 'number') {
      const target = await this.getTargetOrThrow(settings.targetTabId);
      if (target.controllable) return settings.targetTabId;
    }

    const targets = await this.listTargets();
    const active = targets.find((target) => target.currentWindow && target.controllable && !isDeepSeekChatTarget(target.url))
      ?? targets.find((target) => target.controllable && !isDeepSeekChatTarget(target.url));
    if (active) {
      await this.switchTargetLease();
      await saveBrowserControlSettings({ targetTabId: active.id, lastTargetHint: createTargetHint(active, this.now()) });
      return active.id;
    }

    if (options.createIfMissing && options.navigateUrl) {
      const tab = await this.requireChromeApi().tabs.create({ url: options.navigateUrl, active: true });
      if (typeof tab.id === 'number') {
        await this.switchTargetLease();
        await saveBrowserControlSettings({ targetTabId: tab.id, lastTargetHint: createTabHint(tab, this.now()) });
        return tab.id;
      }
    }

    throw new BrowserControlError('browser_target_missing', 'No controllable browser tab is available.', {
      retryable: true,
    });
  }

  private async requireSelectedTargetTabId(
    settings: BrowserControlSettings,
    message = 'Select an explicit Browser Control target before capturing visual evidence.',
  ): Promise<number> {
    if (typeof settings.targetTabId !== 'number') {
      throw new BrowserControlError(
        'browser_target_not_selected',
        message,
        { retryable: true },
      );
    }
    const target = await this.getTargetOrThrow(settings.targetTabId);
    if (!target.controllable) {
      throw new BrowserControlError(
        'browser_target_not_controllable',
        target.reason ?? 'The selected Browser Control target cannot be used. Select the page you want me to operate on.',
        { retryable: true },
      );
    }
    return settings.targetTabId;
  }

  private async rejectDeepSeekProviderTargetAction(tabId: number, action: string): Promise<void> {
    const target = await this.getTargetOrThrow(tabId);
    if (!isDeepSeekChatTarget(target.url)) return;
    throw new BrowserControlError(
      'browser_provider_target_action_blocked',
      `DeepSeek chat is the selected browser target. Use snapshot, click, fill, type, key, wait, or screenshot on it; do not ${action}.`,
      { retryable: false },
    );
  }

  private async ensureAttached(tabId: number): Promise<void> {
    if (!this.connection) {
      throw new BrowserControlError('browser_control_unsupported', 'Browser control is not supported in this context.');
    }
    await this.connection.attach(tabId);
  }

  private async createSnapshot(settings: BrowserControlSettings): Promise<BrowserSnapshotResult> {
    const tabId = await this.ensureTargetTabId(settings);
    await this.ensureAttached(tabId);
    const tab = await this.requireChromeApi().tabs.get(tabId);
    const capturedAt = this.now();
    const snapshotId = this.createSnapshotId();
    const targetLeaseId = this.createTargetLeaseId();
    const url = tab.url ?? '';
    this.clearSnapshotUidCache();
    const ax = await this.connection!.sendCommand<{ nodes?: unknown[] }>('Accessibility.getFullAXTree');
    const formatted = formatAccessibilitySnapshot({
      axNodes: Array.isArray(ax.nodes) ? ax.nodes as never[] : [],
      snapshotId,
      targetLeaseId,
      capturedAt,
      url,
      title: tab.title ?? '',
      maxNodes: settings.maxSnapshotNodes,
      maxTextBytes: settings.maxSnapshotTextBytes,
    });
    this.uidToBackendNodeId.clear();
    for (const [uid, backendNodeId] of formatted.uidToBackendNodeId) {
      this.uidToBackendNodeId.set(uid, backendNodeId);
    }
    this.snapshotUidContext = {
      snapshotId,
      targetLeaseId,
      tabId,
      windowId: typeof tab.windowId === 'number' ? tab.windowId : null,
      url,
      origin: safeUrlOrigin(url),
      capturedAt,
    };
    return formatted.result;
  }

  private async withOptionalSnapshot(
    result: BrowserActionResult,
    settings: BrowserControlSettings,
  ): Promise<BrowserActionResult> {
    this.clearSnapshotUidCache();
    if (!settings.includeSnapshotAfterActions) {
      return result;
    }
    const snapshot = await this.createSnapshot(settings);
    return {
      ...result,
      detail: `${result.detail ?? result.summary}\n\n${snapshot.text}`,
      output: {
        ...asObject(result.output),
        snapshot: snapshotToJson(snapshot),
      },
      snapshot,
    };
  }

  private async captureFullPageForBrowserView(
    tabId: number,
    windowId: number,
    capturedAt: number,
  ): Promise<BrowserScreenshotCaptureResult> {
    const metrics = await this.connection!.sendCommand<{
      cssContentSize?: { width?: unknown; height?: unknown };
      contentSize?: { width?: unknown; height?: unknown };
    }>('Page.getLayoutMetrics');
    const contentSize = normalizeBrowserViewContentSize(metrics);
    if (!contentSize) {
      throw new BrowserControlError('browser_capture_metrics_missing', 'Chrome did not return page size metrics.', {
        retryable: true,
      });
    }
    const clip = {
      x: 0,
      y: 0,
      width: contentSize.width,
      height: contentSize.height,
      scale: getBrowserViewCaptureScale(contentSize.width, contentSize.height),
    };
    const captured = await this.captureBrowserViewClip(clip);
    return createBrowserScreenshotCaptureResult({
      tabId,
      windowId,
      capturedAt,
      dataBase64: captured,
      label: 'Full page',
      source: 'full_page',
      sampled: clip.scale < 1,
    });
  }

  private async captureViewportFallbackForBrowserView(
    tabId: number,
    windowId: number,
    capturedAt: number,
  ): Promise<BrowserScreenshotCaptureResult> {
    const captured = await this.connection!.sendCommand<{ data?: unknown }>('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    return createBrowserScreenshotCaptureResult({
      tabId,
      windowId,
      capturedAt,
      dataBase64: captured.data,
      label: 'Visible viewport (full page unavailable)',
      source: 'viewport',
      sampled: true,
    });
  }

  private async captureFullPageSampleForBrowserView(
    tabId: number,
    windowId: number,
    capturedAt: number,
  ): Promise<BrowserScreenshotCaptureResult> {
    const metrics = await this.connection!.sendCommand<{
      cssContentSize?: { width?: unknown; height?: unknown };
      contentSize?: { width?: unknown; height?: unknown };
      cssLayoutViewport?: { clientWidth?: unknown; clientHeight?: unknown };
      layoutViewport?: { clientWidth?: unknown; clientHeight?: unknown };
    }>('Page.getLayoutMetrics');
    const contentSize = normalizeBrowserViewContentSize(metrics);
    if (!contentSize) {
      throw new BrowserControlError('browser_capture_metrics_missing', 'Chrome did not return page size metrics.', {
        retryable: true,
      });
    }
    const viewport = normalizeBrowserViewViewportSize(metrics, contentSize);
    const maxY = Math.max(0, contentSize.height - viewport.height);
    const positions = Array.from(new Set([
      0,
      Math.round(maxY / 2),
      maxY,
    ])).sort((a, b) => a - b);
    const scale = getBrowserViewCaptureScale(contentSize.width, viewport.height);
    const slices: BrowserViewPanelSlice[] = [];
    for (const position of positions) {
      const dataBase64 = await this.captureBrowserViewClip({
        x: 0,
        y: position,
        width: contentSize.width,
        height: viewport.height,
        scale,
      });
      slices.push({
        dataBase64,
        scrollTop: position,
        label: `Full page sample @ ${Math.round(position)}px`,
      });
    }
    const panel: BrowserViewPanelCandidate = {
      id: 'full-page-sample',
      label: 'Full page',
      rect: { x: 0, y: 0, width: contentSize.width, height: viewport.height },
      clientHeight: viewport.height,
      scrollHeight: contentSize.height,
      scrollTop: 0,
      score: 0,
      sampled: true,
    };
    const composite = await createBrowserViewPanelComposite(panel, slices).catch(() => null);
    const dataBase64 = composite?.dataBase64 ?? slices[Math.floor(slices.length / 2)]!.dataBase64;
    return createBrowserScreenshotCaptureResult({
      tabId,
      windowId,
      capturedAt,
      dataBase64,
      label: composite?.composited ? 'Full page (sampled contact sheet)' : 'Full page (sampled slice)',
      source: 'full_page',
      sampled: true,
    });
  }

  private async planBrowserViewNestedScrollCaptures(): Promise<BrowserViewCapturePlan> {
    const plan = await this.evaluate(createBrowserViewCapturePlannerExpression(), { awaitPromise: true });
    return normalizeBrowserViewCapturePlan(plan);
  }

  private async captureNestedScrollPanelForBrowserView(
    tabId: number,
    windowId: number,
    capturedAt: number,
    panel: BrowserViewPanelCandidate,
  ): Promise<BrowserScreenshotCaptureResult | null> {
    const positions = selectBrowserViewPanelScrollPositions(panel);
    if (positions.length === 0) return null;
    const slices: BrowserViewPanelSlice[] = [];
    const scale = getBrowserViewCaptureScale(panel.rect.width, panel.rect.height);
    for (const position of positions) {
      await this.setBrowserViewNestedPanelScroll(panel.id, position);
      const dataBase64 = await this.captureBrowserViewClip({
        x: panel.rect.x,
        y: panel.rect.y,
        width: panel.rect.width,
        height: panel.rect.height,
        scale,
      }).catch(() => '');
      if (!dataBase64) continue;
      slices.push({
        dataBase64,
        scrollTop: position,
        label: `${panel.label} @ ${Math.round(position)}px`,
      });
    }
    if (slices.length === 0) return null;

    const composite = await createBrowserViewPanelComposite(panel, slices).catch(() => null);
    const dataBase64 = composite?.dataBase64 ?? slices[Math.floor(slices.length / 2)]!.dataBase64;
    const labelSuffix = composite?.composited
      ? panel.sampled ? 'sampled nested scroll' : 'stitched nested scroll'
      : 'nested scroll sample';
    return createBrowserScreenshotCaptureResult({
      tabId,
      windowId,
      capturedAt,
      dataBase64,
      label: `${panel.label} (${labelSuffix})`,
      source: 'nested_scroll',
      sampled: panel.sampled || !composite?.composited,
    });
  }

  private async captureBrowserViewClip(clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
  }): Promise<string> {
    let currentClip = clip;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const captured = await this.connection!.sendCommand<{ data?: unknown }>('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        ...(currentClip ? { clip: currentClip } : {}),
      });
      if (typeof captured.data !== 'string' || captured.data.length === 0) {
        throw new BrowserControlError(
          'browser_capture_failed',
          'Chrome did not return screenshot data for the controlled tab.',
          { retryable: true },
        );
      }
      if (base64ByteLength(captured.data) <= BROWSER_VIEW_CAPTURE_MAX_IMAGE_BYTES) {
        return captured.data;
      }
      if (!currentClip) break;
      currentClip = {
        ...currentClip,
        scale: Math.max(0.2, currentClip.scale * 0.72),
      };
    }
    throw new BrowserControlError(
      'browser_capture_too_large',
      'Browser view screenshot exceeded the DeepSeek Web Vision image size limit.',
      { retryable: true },
    );
  }

  private async setBrowserViewNestedPanelScroll(id: string, scrollTop: number): Promise<void> {
    await this.evaluate(
      `(() => {
        const state = window[${JSON.stringify(BROWSER_VIEW_CAPTURE_GLOBAL)}];
        if (state && typeof state.setScroll === 'function') {
          return state.setScroll(${JSON.stringify(id)}, ${JSON.stringify(scrollTop)});
        }
        return false;
      })()`,
      { awaitPromise: true },
    );
    await new Promise((resolve) => setTimeout(resolve, BROWSER_VIEW_PANEL_SCROLL_SETTLE_MS));
  }

  private async restoreBrowserViewNestedScrollState(): Promise<void> {
    await this.evaluate(
      `(() => {
        const state = window[${JSON.stringify(BROWSER_VIEW_CAPTURE_GLOBAL)}];
        if (state && typeof state.restore === 'function') state.restore();
        try { delete window[${JSON.stringify(BROWSER_VIEW_CAPTURE_GLOBAL)}]; } catch {}
        return true;
      })()`,
      { awaitPromise: true },
    );
  }

  private async resolveElement(payload: Record<string, unknown>): Promise<ElementHandle> {
    const uid = typeof payload.uid === 'string' ? payload.uid.trim() : '';
    const selector = typeof payload.selector === 'string' ? payload.selector.trim() : '';
    if (!uid && !selector) {
      throw new BrowserControlError('browser_target_required', 'Either uid or selector is required.');
    }

    if (uid) {
      const snapshotId = typeof payload.snapshotId === 'string' ? payload.snapshotId.trim() : '';
      const targetLeaseId = typeof payload.targetLeaseId === 'string' ? payload.targetLeaseId.trim() : '';
      const backendNodeId = await this.resolveSnapshotUid(uid, snapshotId, targetLeaseId);
      const resolved = await this.connection!.sendCommand<{
        object?: RuntimeRemoteObject;
      }>('DOM.resolveNode', { backendNodeId });
      if (!resolved.object?.objectId) {
        throw new BrowserControlError('browser_node_resolve_failed', `Could not resolve snapshot uid: ${uid}`);
      }
      return { objectId: resolved.object.objectId, label: uid };
    }

    const result = await this.connection!.sendCommand<{
      result?: RuntimeRemoteObject;
      exceptionDetails?: unknown;
    }>('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
      objectGroup: 'deepseek-pp-browser-control',
    });
    if (result.exceptionDetails) {
      throw new BrowserControlError('browser_selector_failed', `Selector failed: ${selector}`);
    }
    if (!result.result?.objectId || result.result.subtype === 'null') {
      throw new BrowserControlError('browser_selector_not_found', `Selector not found: ${selector}`, {
        retryable: true,
      });
    }
    return { objectId: result.result.objectId, label: selector };
  }

  private async resolveSnapshotUid(uid: string, snapshotId: string, targetLeaseId: string): Promise<number> {
    if (!snapshotId) {
      throw new BrowserControlError(
        'browser_snapshot_id_required',
        `snapshotId from browser_snapshot is required when using uid ${uid}.`,
        { retryable: true },
      );
    }
    if (!targetLeaseId) {
      throw new BrowserControlError(
        'browser_target_lease_required',
        `targetLeaseId from browser_snapshot is required when using uid ${uid}.`,
        { retryable: true },
      );
    }
    const backendNodeId = this.uidToBackendNodeId.get(uid);
    const context = this.snapshotUidContext;
    const tabId = this.connection?.tabId ?? null;
    if (
      !context ||
      context.snapshotId !== snapshotId ||
      context.targetLeaseId !== targetLeaseId ||
      backendNodeId === undefined ||
      tabId !== context.tabId
    ) {
      this.clearSnapshotUidCache();
      throw this.staleSnapshotUidError(uid);
    }
    if (this.now() - context.capturedAt > SNAPSHOT_UID_MAX_AGE_MS) {
      this.clearSnapshotUidCache();
      throw this.staleSnapshotUidError(uid);
    }
    const tab = await this.requireChromeApi().tabs.get(context.tabId);
    if (
      (tab.url ?? '') !== context.url ||
      (typeof tab.windowId === 'number' ? tab.windowId : null) !== context.windowId ||
      safeUrlOrigin(tab.url ?? '') !== context.origin
    ) {
      this.clearSnapshotUidCache();
      throw this.staleSnapshotUidError(uid);
    }
    return backendNodeId;
  }

  private staleSnapshotUidError(uid: string): BrowserControlError {
    return new BrowserControlError(
      'browser_uid_not_found',
      `Snapshot uid is stale or not found: ${uid}. Run browser_snapshot again before using this uid.`,
      { retryable: true },
    );
  }

  private clearSnapshotUidCache(): void {
    this.uidToBackendNodeId.clear();
    this.snapshotUidContext = null;
  }

  private createSnapshotId(): string {
    return createOpaqueId('snapshot');
  }

  private createTargetLeaseId(): string {
    return createOpaqueId('target-lease');
  }

  private async switchTargetLease(): Promise<void> {
    this.clearSnapshotUidCache();
    if (this.connection?.attached) {
      await this.connection.detach();
    }
  }

  private async getElementPoint(objectId: string): Promise<ElementPoint> {
    const value = await this.callFunctionOn(objectId, String(getBrowserControlElementPoint));
    if (!value || typeof value !== 'object') {
      throw new BrowserControlError('browser_element_point_failed', 'Could not compute the element point.');
    }
    const point = value as Partial<ElementPoint>;
    if (
      typeof point.x !== 'number' ||
      typeof point.y !== 'number' ||
      typeof point.width !== 'number' ||
      typeof point.height !== 'number'
    ) {
      throw new BrowserControlError('browser_element_point_failed', 'Element point result was invalid.');
    }
    return {
      x: point.x,
      y: point.y,
      width: point.width,
      height: point.height,
      visible: point.visible === true,
    };
  }

  private async fillElement(element: ElementHandle, value: string): Promise<void> {
    await this.callFunctionOn(element.objectId, String(function fillElement(
      this: HTMLElement & { value?: string },
      nextValue: string,
    ) {
      this.focus();
      if ('value' in this) {
        this.value = nextValue;
      } else {
        this.textContent = nextValue;
      }
      this.dispatchEvent(new InputEvent('input', { bubbles: true, data: nextValue }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }), [{ value }]);
  }

  private async focusElement(element: ElementHandle): Promise<void> {
    await this.callFunctionOn(element.objectId, String(function focusElement(this: HTMLElement) {
      this.focus();
      return document.activeElement === this;
    }));
  }

  private async callFunctionOn(
    objectId: string,
    functionDeclaration: string,
    args: Array<{ value: unknown }> = [],
  ): Promise<unknown> {
    const result = await this.connection!.sendCommand<{
      result?: RuntimeRemoteObject;
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      arguments: args,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new BrowserControlError(
        'browser_dom_call_failed',
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'DOM call failed.',
      );
    }
    return remoteObjectValue(result.result);
  }

  private async evaluate(expression: string, options: { awaitPromise: boolean }): Promise<unknown> {
    const result = await this.connection!.sendCommand<{
      result?: RuntimeRemoteObject;
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: options.awaitPromise,
    });
    if (result.exceptionDetails) {
      throw new BrowserControlError(
        'browser_script_failed',
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Script evaluation failed.',
      );
    }
    return remoteObjectValue(result.result);
  }

  private async evaluateBoolean(expression: string): Promise<boolean> {
    return await this.evaluate(expression, { awaitPromise: true }) === true;
  }

  private async getTargetOrThrow(tabId: number): Promise<BrowserControlTarget> {
    const chromeApi = this.requireChromeApi();
    const tab = await chromeApi.tabs.get(tabId);
    const current = await chromeApi.tabs.query({ active: true, currentWindow: true });
    const windowHints = await getChromeWindowHints(chromeApi);
    const { controllable, reason } = getControllableState(tab.url ?? '');
    return {
      id: tabId,
      windowId: tab.windowId,
      windowHint: windowHints.get(tab.windowId) ?? null,
      groupId: typeof tab.groupId === 'number' ? tab.groupId : -1,
      groupName: undefined,
      active: tab.active,
      currentWindow: current[0]?.id === tabId,
      title: tab.title ?? '',
      url: tab.url ?? '',
      controllable,
      reason,
    };
  }

  private async waitForTabUrl(tabId: number, url: string, timeoutMs: number): Promise<void> {
    const started = this.now();
    while (this.now() - started <= timeoutMs) {
      const tab = await this.requireChromeApi().tabs.get(tabId);
      if (tab.url === url || tab.pendingUrl === url) return;
      await delay(100);
    }
  }

  private requireChromeApi(): typeof chrome {
    const chromeApi = this.getChromeApi();
    if (!chromeApi) {
      throw new BrowserControlError(
        'chrome_api_unavailable',
        'Chrome extension APIs are unavailable in this context.',
      );
    }
    return chromeApi;
  }

  private getChromeApi(): typeof chrome | null {
    if (this.dependencies.chromeApi) return this.dependencies.chromeApi;
    try {
      return typeof chrome !== 'undefined' ? chrome : null;
    } catch {
      return null;
    }
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }
}

export const browserControlService = new BrowserControlService();

export async function getBrowserControlElementPoint(this: Element): Promise<ElementPoint> {
  function readPoint(target: Element): ElementPoint {
    const rect = target.getBoundingClientRect();
    const style = window.getComputedStyle(target);
    const rendered = rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none';
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(window.innerWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    const visible = rendered && right > left && bottom > top;
    return {
      x: visible ? (left + right) / 2 : rect.left + rect.width / 2,
      y: visible ? (top + bottom) / 2 : rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
      visible,
    };
  }

  let point = readPoint(this);
  if (point.visible) return point;

  this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
  if (typeof requestAnimationFrame === 'function') {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  point = readPoint(this);
  return point;
}

export function getControllableState(url: string): { controllable: boolean; reason?: string } {
  if (!url) return { controllable: true };
  if (url === 'about:blank') return { controllable: true };
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')) {
    return { controllable: true };
  }
  return {
    controllable: false,
    reason: `Unsupported URL scheme for browser control: ${url.split(':')[0] || 'unknown'}`,
  };
}

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new BrowserControlError('browser_invalid_payload', `${key} is required.`);
  }
  return value;
}

function requireInteger(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BrowserControlError('browser_invalid_payload', `${key} must be an integer.`);
  }
  return value;
}

function readOptionalBoolean(
  payload: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return fallback;
  const value = payload[key];
  if (typeof value !== 'boolean') {
    throw new BrowserControlError('browser_invalid_payload', `${key} must be a boolean.`);
  }
  return value;
}

function requiresSelectedTarget(
  name: BrowserControlToolName,
  payload: Record<string, unknown>,
): boolean {
  switch (name) {
    case 'browser_list_tabs':
    case 'browser_select_tab':
      return false;
    case 'browser_navigate':
      return readOptionalBoolean(payload, 'newTab', false) === false;
    case 'browser_close_tab':
      return !Object.prototype.hasOwnProperty.call(payload, 'tabId');
    default:
      return true;
  }
}

function shouldClearSnapshotUidCacheAfterFailedAction(name: BrowserControlToolName): boolean {
  return name !== 'browser_list_tabs';
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeUrl(input: string): string {
  try {
    const url = new URL(input);
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) {
      throw new Error(`Unsupported URL protocol: ${url.protocol}`);
    }
    return url.toString();
  } catch (error) {
    throw new BrowserControlError(
      'browser_invalid_url',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function keyEventParams(key: string): Record<string, unknown> {
  const special: Record<string, { code: string; windowsVirtualKeyCode: number }> = {
    Enter: { code: 'Enter', windowsVirtualKeyCode: 13 },
    Escape: { code: 'Escape', windowsVirtualKeyCode: 27 },
    Tab: { code: 'Tab', windowsVirtualKeyCode: 9 },
    Backspace: { code: 'Backspace', windowsVirtualKeyCode: 8 },
    Delete: { code: 'Delete', windowsVirtualKeyCode: 46 },
    ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
    ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  };
  const known = special[key];
  if (known) return { key, ...known };
  if (key.length === 1) {
    return {
      key,
      text: key,
      code: `Key${key.toUpperCase()}`,
      windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
    };
  }
  return { key };
}

function waitExpression(payload: Record<string, unknown>): string {
  if (typeof payload.selector === 'string' && payload.selector.trim()) {
    return `Boolean(document.querySelector(${JSON.stringify(payload.selector.trim())}))`;
  }
  if (typeof payload.text === 'string' && payload.text.trim()) {
    return `Boolean(document.body && document.body.innerText.includes(${JSON.stringify(payload.text)}))`;
  }
  if (typeof payload.expression === 'string' && payload.expression.trim()) {
    return `Boolean((${payload.expression}))`;
  }
  throw new BrowserControlError(
    'browser_wait_condition_required',
    'Provide selector, text, or expression for browser_wait_for.',
  );
}

function remoteObjectValue(object: RuntimeRemoteObject | undefined): unknown {
  if (!object) return null;
  if (Object.prototype.hasOwnProperty.call(object, 'value')) return object.value;
  if (typeof object.unserializableValue === 'string') return object.unserializableValue;
  if (object.subtype === 'null') return null;
  return object.description ?? object.type ?? null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function snapshotToJson(snapshot: BrowserSnapshotResult): Record<string, unknown> {
  return {
    snapshotId: snapshot.snapshotId,
    targetLeaseId: snapshot.targetLeaseId,
    capturedAt: snapshot.capturedAt,
    url: snapshot.url,
    title: snapshot.title,
    text: snapshot.text,
    nodeCount: snapshot.nodes.length,
    truncated: snapshot.truncated,
  };
}

function targetToJson(target: BrowserControlTarget): Record<string, unknown> {
  return {
    id: target.id,
    windowId: target.windowId,
    windowHint: target.windowHint,
    groupId: target.groupId,
    groupName: target.groupName ?? null,
    active: target.active,
    currentWindow: target.currentWindow,
    title: target.title,
    url: target.url,
    controllable: target.controllable,
    reason: target.reason ?? null,
  };
}

async function getChromeWindowHints(chromeApi: typeof chrome): Promise<Map<number, BrowserControlWindowHint>> {
  const windowsApi = readOptionalChromeApi(() => chromeApi.windows);
  if (!windowsApi?.getAll) return new Map();
  const windows = await windowsApi.getAll({ windowTypes: ['normal'] }).catch(() => []);
  return new Map(
    windows
      .filter((window) => typeof window.id === 'number')
      .map((window) => [window.id!, createWindowHint(window)]),
  );
}

function createWindowHint(window: chrome.windows.Window): BrowserControlWindowHint {
  return {
    left: normalizeWindowNumber(window.left),
    top: normalizeWindowNumber(window.top),
    width: normalizeWindowNumber(window.width),
    height: normalizeWindowNumber(window.height),
    state: typeof window.state === 'string' ? window.state : null,
  };
}

function createTargetHint(target: BrowserControlTarget, updatedAt: number): BrowserControlSettings['lastTargetHint'] {
  const origin = safeUrlOrigin(target.url);
  if (!origin) return null;
  return {
    windowId: target.windowId,
    windowHint: target.windowHint,
    origin,
    title: '',
    updatedAt,
  };
}

function createTabHint(tab: chrome.tabs.Tab, updatedAt: number): BrowserControlSettings['lastTargetHint'] {
  const origin = safeUrlOrigin(tab.url ?? tab.pendingUrl ?? '');
  if (!origin) return null;
  return {
    windowId: typeof tab.windowId === 'number' ? tab.windowId : null,
    windowHint: null,
    origin,
    title: '',
    updatedAt,
  };
}

function createTargetLock(
  target: BrowserControlTarget,
  label: string,
  updatedAt: number,
): BrowserControlSettings['targetLock'] {
  const origin = safeUrlOrigin(target.url);
  if (!origin) return null;
  const safeLabel = label.trim().slice(0, 40);
  return {
    enabled: true,
    label: safeLabel || 'Dev++',
    targetTabId: target.id,
    windowId: target.windowId,
    windowHint: target.windowHint,
    groupId: target.groupId >= 0 ? target.groupId : null,
    origin,
    updatedAt,
  };
}

function findHintedTarget(
  targets: BrowserControlTarget[],
  hint: BrowserControlSettings['lastTargetHint'],
): BrowserControlTarget | null {
  if (!hint) return null;
  const candidates = targets.filter((target) =>
    target.controllable && !isDeepSeekChatTarget(target.url) && safeUrlOrigin(target.url) === hint.origin
  );
  if (candidates.length === 0) return null;

  const sameWindow = candidates.filter((target) => hint.windowId !== null && target.windowId === hint.windowId);
  const sameTitle = candidates.filter((target) => hint.title && target.title === hint.title);
  const sameWindowHint = findClosestWindowHintTarget(candidates, hint.windowHint);
  const preferred = sameWindow.length === 1
    ? sameWindow[0]
    : sameTitle.length === 1
      ? sameTitle[0]
      : sameWindowHint
        ? sameWindowHint
      : candidates.length === 1
        ? candidates[0]
        : null;
  return preferred ?? null;
}

function findLockedTarget(
  targets: BrowserControlTarget[],
  lock: NonNullable<BrowserControlSettings['targetLock']>,
): BrowserControlTarget | null {
  const candidates = targets.filter((target) => matchesTargetLock(target, lock));
  if (candidates.length === 0) return null;
  const sameWindow = candidates.filter((target) => lock.windowId !== null && target.windowId === lock.windowId);
  if (sameWindow.length === 1) return sameWindow[0];
  const sameGroup = candidates.filter((target) => lock.groupId !== null && target.groupId === lock.groupId);
  if (sameGroup.length === 1) return sameGroup[0];
  const sameWindowHint = findClosestWindowHintTarget(candidates, lock.windowHint);
  if (sameWindowHint) return sameWindowHint;
  return candidates.length === 1 ? candidates[0] : null;
}

function findClosestWindowHintTarget(
  candidates: BrowserControlTarget[],
  hint: BrowserControlWindowHint | null,
): BrowserControlTarget | null {
  if (!hint) return null;
  const scored = candidates
    .map((target) => ({ target, score: scoreWindowHint(target.windowHint, hint) }))
    .filter((item) => item.score !== null)
    .sort((a, b) => a.score! - b.score!);
  const best = scored[0];
  if (!best || best.score === null || best.score > 80) return null;
  const tied = scored.filter((item) => item.score === best.score);
  return tied.length === 1 ? best.target : null;
}

function scoreWindowHint(
  current: BrowserControlWindowHint | null,
  locked: BrowserControlWindowHint,
): number | null {
  if (!current) return null;
  const values: Array<[number | null, number | null]> = [
    [current.left, locked.left],
    [current.top, locked.top],
    [current.width, locked.width],
    [current.height, locked.height],
  ];
  let score = 0;
  let compared = 0;
  for (const [left, right] of values) {
    if (left === null || right === null) continue;
    score += Math.abs(left - right);
    compared += 1;
  }
  if (compared === 0) return null;
  if (current.state && locked.state && current.state !== locked.state) score += 20;
  return score;
}

function normalizeWindowNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function matchesTargetLock(
  target: BrowserControlTarget,
  lock: NonNullable<BrowserControlSettings['targetLock']>,
): boolean {
  return target.controllable &&
    safeUrlOrigin(target.url) === lock.origin;
}

function safeUrlOrigin(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
    if (parsed.protocol === 'file:') return 'file://';
  } catch {
    return '';
  }
  return '';
}

function createOpaqueId(prefix: string): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return `${prefix}-${randomUUID.call(globalThis.crypto)}`;
  }
  const getRandomValues = globalThis.crypto?.getRandomValues;
  if (typeof getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    getRandomValues.call(globalThis.crypto, bytes);
    return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function isDeepSeekChatTarget(url: string): boolean {
  try {
    return new URL(url).hostname === 'chat.deepseek.com';
  } catch {
    return false;
  }
}

function normalizeError(error: unknown): BrowserControlError {
  if (error instanceof BrowserControlError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new BrowserControlError('browser_control_failed', message, { retryable: true });
}

function assertBrowserControlNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new BrowserControlError('browser_control_aborted', 'Browser control action was cancelled.', {
    retryable: false,
  });
}

function base64ByteLength(value: string): number {
  const normalized = value.replace(/\s+/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function createBrowserScreenshotCaptureResult(input: {
  tabId: number;
  windowId: number;
  capturedAt: number;
  dataBase64: unknown;
  label?: string;
  source?: BrowserViewCaptureSource;
  sampled?: boolean;
}): BrowserScreenshotCaptureResult {
  if (typeof input.dataBase64 !== 'string' || input.dataBase64.length === 0) {
    throw new BrowserControlError(
      'browser_capture_failed',
      'Chrome did not return screenshot data for the controlled tab.',
      { retryable: true },
    );
  }
  return {
    tabId: input.tabId,
    windowId: input.windowId,
    mimeType: 'image/png',
    dataBase64: input.dataBase64,
    sizeBytes: base64ByteLength(input.dataBase64),
    capturedAt: input.capturedAt,
    ...(input.label ? { label: input.label } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(typeof input.sampled === 'boolean' ? { sampled: input.sampled } : {}),
  };
}

function normalizeBrowserViewContentSize(value: unknown): { width: number; height: number } | null {
  const input = value as {
    cssContentSize?: { width?: unknown; height?: unknown };
    contentSize?: { width?: unknown; height?: unknown };
  } | null;
  const size = input?.cssContentSize ?? input?.contentSize;
  const width = normalizePositiveNumber(size?.width);
  const height = normalizePositiveNumber(size?.height);
  if (!width || !height) return null;
  return { width, height };
}

function normalizeBrowserViewViewportSize(
  value: unknown,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  const input = value as {
    cssLayoutViewport?: { clientWidth?: unknown; clientHeight?: unknown };
    layoutViewport?: { clientWidth?: unknown; clientHeight?: unknown };
    cssVisualViewport?: { clientWidth?: unknown; clientHeight?: unknown };
  } | null;
  const viewport = input?.cssLayoutViewport ?? input?.cssVisualViewport ?? input?.layoutViewport;
  const width = normalizePositiveNumber(viewport?.clientWidth) ?? Math.min(fallback.width, 1440);
  const height = normalizePositiveNumber(viewport?.clientHeight) ?? Math.min(fallback.height, 1200);
  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

function normalizePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : null;
}

function getBrowserViewCaptureScale(width: number, height: number): number {
  const longEdgeScale = Math.min(1, BROWSER_VIEW_CAPTURE_MAX_LONG_EDGE / Math.max(width, height));
  const areaScale = Math.min(1, Math.sqrt(BROWSER_VIEW_CAPTURE_MAX_AREA / Math.max(1, width * height)));
  return Math.max(0.2, Math.min(longEdgeScale, areaScale));
}

function normalizeBrowserViewCapturePlan(value: unknown): BrowserViewCapturePlan {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const viewportWidth = normalizePositiveNumber(input.viewportWidth) ?? 0;
  const viewportHeight = normalizePositiveNumber(input.viewportHeight) ?? 0;
  const contentWidth = normalizePositiveNumber(input.contentWidth) ?? viewportWidth;
  const contentHeight = normalizePositiveNumber(input.contentHeight) ?? viewportHeight;
  const rawPanels = Array.isArray(input.panels) ? input.panels : [];
  const panels = rawPanels.map(normalizeBrowserViewPanelCandidate).filter((item): item is BrowserViewPanelCandidate => Boolean(item));
  panels.sort((a, b) => b.score - a.score);
  return {
    viewportWidth,
    viewportHeight,
    contentWidth,
    contentHeight,
    panels: dedupeBrowserViewPanelCandidates(panels),
  };
}

function normalizeBrowserViewPanelCandidate(value: unknown): BrowserViewPanelCandidate | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<BrowserViewPanelCandidate>;
  const rect = normalizeBrowserViewRect(input.rect);
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : '';
  if (!id || !rect) return null;
  const clientHeight = normalizePositiveNumber(input.clientHeight) ?? Math.ceil(rect.height);
  const scrollHeight = normalizePositiveNumber(input.scrollHeight) ?? clientHeight;
  if (scrollHeight <= clientHeight + BROWSER_VIEW_PANEL_MIN_OVERFLOW_PX) return null;
  return {
    id,
    label: typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 80) : 'Nested scroll panel',
    rect,
    clientHeight,
    scrollHeight,
    scrollTop: typeof input.scrollTop === 'number' && Number.isFinite(input.scrollTop) ? Math.max(0, input.scrollTop) : 0,
    score: typeof input.score === 'number' && Number.isFinite(input.score) ? input.score : 0,
    sampled: Boolean(input.sampled),
  };
}

function normalizeBrowserViewRect(value: unknown): BrowserViewRect | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<BrowserViewRect>;
  const x = typeof input.x === 'number' && Number.isFinite(input.x) ? input.x : null;
  const y = typeof input.y === 'number' && Number.isFinite(input.y) ? input.y : null;
  const width = normalizePositiveNumber(input.width);
  const height = normalizePositiveNumber(input.height);
  if (x === null || y === null || !width || !height) return null;
  if (width * height < BROWSER_VIEW_PANEL_MIN_VISIBLE_AREA) return null;
  return { x, y, width, height };
}

function dedupeBrowserViewPanelCandidates(panels: BrowserViewPanelCandidate[]): BrowserViewPanelCandidate[] {
  const selected: BrowserViewPanelCandidate[] = [];
  for (const panel of panels) {
    const duplicate = selected.some((existing) => browserViewRectContainmentRatio(panel.rect, existing.rect) > 0.86);
    if (!duplicate) selected.push(panel);
  }
  return selected;
}

function browserViewRectContainmentRatio(rect: BrowserViewRect, other: BrowserViewRect): number {
  const left = Math.max(rect.x, other.x);
  const top = Math.max(rect.y, other.y);
  const right = Math.min(rect.x + rect.width, other.x + other.width);
  const bottom = Math.min(rect.y + rect.height, other.y + other.height);
  const area = Math.max(0, right - left) * Math.max(0, bottom - top);
  return area / Math.max(1, rect.width * rect.height);
}

function selectBrowserViewPanelScrollPositions(panel: BrowserViewPanelCandidate): number[] {
  const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight);
  if (maxScroll <= 0) return [0];
  const estimatedSlices = Math.ceil(panel.scrollHeight / Math.max(1, panel.clientHeight * 0.82));
  const count = panel.sampled || estimatedSlices > BROWSER_VIEW_PANEL_MAX_STITCH_SLICES
    ? Math.min(BROWSER_VIEW_PANEL_SAMPLE_SLICES, BROWSER_VIEW_PANEL_MAX_STITCH_SLICES)
    : Math.min(BROWSER_VIEW_PANEL_MAX_STITCH_SLICES, estimatedSlices);
  const positions = new Set<number>();
  if (count <= 1) {
    positions.add(Math.min(panel.scrollTop, maxScroll));
  } else {
    for (let index = 0; index < count; index += 1) {
      positions.add(Math.round((maxScroll * index) / (count - 1)));
    }
  }
  positions.add(0);
  positions.add(maxScroll);
  return Array.from(positions).sort((a, b) => a - b).slice(0, BROWSER_VIEW_PANEL_MAX_STITCH_SLICES);
}

async function createBrowserViewPanelComposite(
  panel: BrowserViewPanelCandidate,
  slices: BrowserViewPanelSlice[],
): Promise<{ dataBase64: string; composited: boolean }> {
  if (slices.length === 1) return { dataBase64: slices[0]!.dataBase64, composited: false };
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return { dataBase64: slices[Math.floor(slices.length / 2)]!.dataBase64, composited: false };
  }
  const bitmaps = await Promise.all(slices.map((slice) => createImageBitmap(base64ToBlob(slice.dataBase64, 'image/png'))));
  try {
    const first = bitmaps[0]!;
    const sliceScale = first.height / Math.max(1, panel.clientHeight);
    const width = first.width;
    const rawHeight = panel.sampled
      ? bitmaps.reduce((total, bitmap) => total + bitmap.height + 34, 0)
      : Math.ceil(panel.scrollHeight * sliceScale);
    const outputScale = getBrowserViewCaptureScale(width, rawHeight);
    const canvas = new OffscreenCanvas(Math.max(1, Math.floor(width * outputScale)), Math.max(1, Math.floor(rawHeight * outputScale)));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (panel.sampled) {
      let y = 0;
      bitmaps.forEach((bitmap, index) => {
        drawBrowserViewLabel(ctx, `${index + 1}. ${slices[index]!.label}`, 0, y, canvas.width, outputScale);
        y += 34 * outputScale;
        ctx.drawImage(bitmap, 0, y, bitmap.width * outputScale, bitmap.height * outputScale);
        y += bitmap.height * outputScale;
      });
    } else {
      bitmaps.forEach((bitmap, index) => {
        ctx.drawImage(bitmap, 0, Math.round(slices[index]!.scrollTop * sliceScale * outputScale), bitmap.width * outputScale, bitmap.height * outputScale);
      });
    }
    return { dataBase64: await offscreenCanvasToBase64(canvas), composited: true };
  } finally {
    for (const bitmap of bitmaps) bitmap.close();
  }
}

function drawBrowserViewLabel(
  ctx: OffscreenCanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  width: number,
  scale: number,
): void {
  ctx.fillStyle = '#111827';
  ctx.fillRect(x, y, width, Math.max(1, 34 * scale));
  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.max(10, Math.round(13 * scale))}px sans-serif`;
  ctx.fillText(label, x + 10 * scale, y + 22 * scale);
}

async function offscreenCanvasToBase64(canvas: OffscreenCanvas): Promise<string> {
  let quality = 1;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const blob = await canvas.convertToBlob({ type: 'image/png', quality });
    const dataBase64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    if (base64ByteLength(dataBase64) <= BROWSER_VIEW_CAPTURE_MAX_IMAGE_BYTES) {
      return dataBase64;
    }
    quality *= 0.82;
  }
  throw new Error('Could not encode browser view composite.');
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function createBrowserViewCapturePlannerExpression(): string {
  return `(() => {
    const minArea = ${BROWSER_VIEW_PANEL_MIN_VISIBLE_AREA};
    const minOverflow = ${BROWSER_VIEW_PANEL_MIN_OVERFLOW_PX};
    const globalName = ${JSON.stringify(BROWSER_VIEW_CAPTURE_GLOBAL)};
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const scrollingElement = document.scrollingElement || document.documentElement;
    const originalWindow = { x: window.scrollX || 0, y: window.scrollY || 0 };
    const records = [];
    const panels = [];
    const elements = Array.from(document.querySelectorAll('*'));
    const visibleIntersection = (rect) => {
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(viewportWidth, rect.right);
      const bottom = Math.min(viewportHeight, rect.bottom);
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      return { width, height, area: width * height };
    };
    const kindFor = (element, controls, tableLike, codeLike) => {
      const role = (element.getAttribute('role') || '').toLowerCase();
      const tag = element.tagName.toLowerCase();
      if (tableLike || role === 'grid' || role === 'table') return 'table panel';
      if (codeLike) return 'code panel';
      if (role === 'log' || role === 'feed') return 'message panel';
      if (controls >= 3 || tag === 'form') return 'form panel';
      if (tag === 'aside' || role === 'complementary') return 'side panel';
      if (tag === 'main' || role === 'main' || tag === 'article') return 'content panel';
      if (role === 'dialog' || element.getAttribute('aria-modal') === 'true') return 'dialog panel';
      return 'nested panel';
    };
    const originalBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      if (element === document.documentElement || element === document.body || element === scrollingElement) continue;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const overflowY = style.overflowY;
      const canScroll = element.scrollHeight - element.clientHeight > minOverflow &&
        (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay' || element.scrollTop > 0);
      if (!canScroll) continue;
      const rect = element.getBoundingClientRect();
      const rectArea = Math.max(0, rect.width) * Math.max(0, rect.height);
      if (rectArea < minArea) continue;
      const visible = visibleIntersection(rect);
      const evidenceArea = visible.area >= minArea ? visible.area : rectArea * 0.35;
      const tag = element.tagName.toLowerCase();
      if ((tag === 'textarea' || tag === 'select') && evidenceArea < minArea * 3) continue;
      const controls = element.querySelectorAll('input, textarea, select, button, [role="button"], [contenteditable="true"]').length;
      const tableLike = Boolean(element.querySelector('table, [role="grid"], [role="table"]'));
      const codeLike = Boolean(element.querySelector('pre, code'));
      const hidden = element.scrollHeight - element.clientHeight;
      const coverage = Math.min(evidenceArea, viewportWidth * viewportHeight) / Math.max(1, viewportWidth * viewportHeight);
      const fixedBonus = style.position === 'fixed' || style.position === 'sticky' ? 350 : 0;
      const visibleBonus = visible.area >= minArea ? 240 : 0;
      const semanticBonus = controls * 55 + (tableLike ? 260 : 0) + (codeLike ? 180 : 0);
      const score = evidenceArea / 700 + hidden / 8 + coverage * 900 + semanticBonus + fixedBonus + visibleBonus;
      const id = 'panel-' + records.length;
      records.push({
        id,
        element,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
      });
      panels.push({
        id,
        label: 'Nested scroll ' + (panels.length + 1) + ': ' + kindFor(element, controls, tableLike, codeLike),
        rect: {
          x: rect.left + (window.scrollX || 0),
          y: rect.top + (window.scrollY || 0),
          width: rect.width,
          height: rect.height,
        },
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        score,
        sampled: Math.ceil(element.scrollHeight / Math.max(1, element.clientHeight * 0.82)) > ${BROWSER_VIEW_PANEL_MAX_STITCH_SLICES},
      });
    }
    window[globalName] = {
      setScroll(id, scrollTop) {
        const record = records.find((item) => item.id === id);
        if (!record) return false;
        record.element.scrollTop = Math.max(0, Math.min(scrollTop, record.element.scrollHeight - record.element.clientHeight));
        record.element.scrollLeft = 0;
        return true;
      },
      restore() {
        for (const record of records) {
          record.element.scrollTop = record.scrollTop;
          record.element.scrollLeft = record.scrollLeft;
        }
        window.scrollTo(originalWindow.x, originalWindow.y);
        document.documentElement.style.scrollBehavior = originalBehavior;
        return true;
      },
    };
    return {
      viewportWidth,
      viewportHeight,
      contentWidth: Math.max(scrollingElement.scrollWidth || 0, document.documentElement.scrollWidth || 0, viewportWidth),
      contentHeight: Math.max(scrollingElement.scrollHeight || 0, document.documentElement.scrollHeight || 0, viewportHeight),
      panels: panels.sort((a, b) => b.score - a.score).slice(0, 12),
    };
  })()`;
}

function toJsonSafe(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  assertBrowserControlNotAborted(signal);
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const abortHandler = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abortHandler);
      reject(new BrowserControlError('browser_control_aborted', 'Browser control action was cancelled.', {
        retryable: false,
      }));
    };
    signal?.addEventListener('abort', abortHandler, { once: true });
    if (signal?.aborted) {
      abortHandler();
      return;
    }
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abortHandler);
      resolve();
    }, ms);
  });
}
