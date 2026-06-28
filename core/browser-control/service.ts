import { getBrowserControlSettings, saveBrowserControlSettings } from './settings';
import { BrowserConnection, BrowserControlError } from './cdp';
import { formatAccessibilitySnapshot } from './snapshot';
import { readOptionalChromeApi } from '../platform/chrome-api';
import type {
  BrowserActionResult,
  BrowserControlDependencies,
  BrowserControlSettings,
  BrowserControlState,
  BrowserControlTarget,
  BrowserControlTargetPreparation,
  BrowserControlWindowHint,
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
