import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserActVerifyPrompt,
  createBrowserControlToolDescriptors,
  getEnabledBrowserControlToolDescriptors,
  shouldVerifyAfterBrowserAction,
  shouldExposeBrowserControlTools,
} from '../core/browser-control/tool';
import {
  BrowserControlService,
  getBrowserControlElementPoint,
} from '../core/browser-control/service';
import {
  DEFAULT_BROWSER_CONTROL_SETTINGS,
  normalizeBrowserControlSettings,
} from '../core/browser-control/settings';
import { BROWSER_CONTROL_STORAGE_KEY } from '../core/browser-control/types';
import { formatAccessibilitySnapshot } from '../core/browser-control/snapshot';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser control settings and descriptors', () => {
  it('normalizes settings with personal convenience defaults', () => {
    const settings = normalizeBrowserControlSettings({
      enabled: true,
      targetTabId: 12,
      includeSnapshotAfterActions: false,
      allowVisionCapture: true,
      verifyAfterActions: true,
      collectEvidencePacks: false,
      debugDistillerEnabled: false,
      maxSnapshotNodes: 10_000,
      maxSnapshotTextBytes: 1,
    });

    expect(normalizeBrowserControlSettings(null)).toEqual(DEFAULT_BROWSER_CONTROL_SETTINGS);
    expect(normalizeBrowserControlSettings({})).toMatchObject({
      enabled: true,
      allowVisionCapture: true,
      verifyAfterActions: true,
      collectEvidencePacks: true,
      debugDistillerEnabled: true,
    });
    expect(settings).toMatchObject({
      enabled: true,
      targetTabId: 12,
      lastTargetHint: null,
      targetLock: null,
      includeSnapshotAfterActions: false,
      allowVisionCapture: true,
      verifyAfterActions: true,
      collectEvidencePacks: false,
      debugDistillerEnabled: false,
      maxSnapshotNodes: 1500,
      maxSnapshotTextBytes: 4000,
    });
  });

  it('exposes the full browser tool set by default for personal convenience', async () => {
    const storage = new Map<string, unknown>();
    vi.stubGlobal('chrome', createChromeStub(storage));

    expect(await shouldExposeBrowserControlTools()).toBe(true);
    expect((await getEnabledBrowserControlToolDescriptors('en')).map((tool) => tool.name)).toContain(
      'browser_capture_screenshot',
    );

    storage.set(BROWSER_CONTROL_STORAGE_KEY, {
      ...DEFAULT_BROWSER_CONTROL_SETTINGS,
      enabled: false,
    });

    expect(await shouldExposeBrowserControlTools()).toBe(false);

    storage.set(BROWSER_CONTROL_STORAGE_KEY, {
      ...DEFAULT_BROWSER_CONTROL_SETTINGS,
      allowVisionCapture: false,
    });

    expect((await getEnabledBrowserControlToolDescriptors('en')).map((tool) => tool.name)).not.toContain(
      'browser_capture_screenshot',
    );
    expect(createBrowserControlToolDescriptors('en').map((tool) => tool.name)).toEqual([
      'browser_navigate',
      'browser_go_back',
      'browser_go_forward',
      'browser_refresh',
      'browser_list_tabs',
      'browser_select_tab',
      'browser_close_tab',
      'browser_snapshot',
      'browser_capture_screenshot',
      'browser_click',
      'browser_hover',
      'browser_fill',
      'browser_fill_form',
      'browser_key',
      'browser_type',
      'browser_attach_file',
      'browser_wait_for',
      'browser_handle_dialog',
      'browser_evaluate_script',
    ]);
  });

  it('uses natural act-verify prompts for browser actions only', () => {
    expect(shouldVerifyAfterBrowserAction('browser_click')).toBe(true);
    expect(shouldVerifyAfterBrowserAction('browser_snapshot')).toBe(false);
    const prompt = createBrowserActVerifyPrompt({
      toolName: 'browser_click',
      summary: 'Clicked Save',
    });

    expect(prompt).toContain('I just ran browser_click: Clicked Save.');
    expect(prompt).toContain('Look at the updated page');
    expect(prompt).not.toMatch(/reply exactly|can you read this image|marker|probe/i);
  });

  it('requires an explicit target for automation-style browser actions', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({
        id: 12,
        active: true,
        url: 'https://example.com/',
        title: 'Example',
      }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService();

    const result = await service.execute('browser_click', { uid: 'e1' }, {
      requireExplicitTarget: true,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('browser_target_not_selected');
    expect(chromeStub.debugger.attach).not.toHaveBeenCalled();
  });

  it('allows automation-style browser navigation to open a fresh controlled tab', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
      },
    ]]);
    const chromeStub = createChromeStub(storage);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService();

    const result = await service.execute('browser_navigate', { url: 'https://example.com/' }, {
      requireExplicitTarget: true,
    });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      url: 'https://example.com/',
      newTab: true,
    });
    expect(storage.get(BROWSER_CONTROL_STORAGE_KEY)).toMatchObject({
      targetTabId: 100,
    });
  });

  it('reacquires a stale target from the last safe target hint', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        targetTabId: 12,
        lastTargetHint: {
          windowId: 1,
          origin: 'https://example.com',
          title: 'Example',
          updatedAt: 1,
        },
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 34, active: true, title: 'Example', url: 'https://example.com/path?token=secret' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const preparation = await service.preparePersonalTarget();

    expect(preparation.status).toBe('reacquired');
    expect(preparation.target?.id).toBe(34);
    await expect(chromeStub.storage.local.get(BROWSER_CONTROL_STORAGE_KEY)).resolves.toMatchObject({
      [BROWSER_CONTROL_STORAGE_KEY]: expect.objectContaining({
        targetTabId: 34,
        lastTargetHint: expect.objectContaining({
          origin: 'https://example.com',
          title: '',
        }),
      }),
    });
    expect(JSON.stringify(storage.get(BROWSER_CONTROL_STORAGE_KEY))).not.toContain('token=secret');
  });

  it('does not use the DeepSeek chat tab as the manual active fallback target', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        targetTabId: null,
        lastTargetHint: null,
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'DeepSeek', url: 'https://chat.deepseek.com/a/chat/s/current' }),
      createTab({ id: 34, active: false, title: 'Example', url: 'https://example.com/' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const preparation = await service.preparePersonalTarget({ allowActiveFallback: true });

    expect(preparation.status).toBe('missing');
    await expect(chromeStub.storage.local.get(BROWSER_CONTROL_STORAGE_KEY)).resolves.toMatchObject({
      [BROWSER_CONTROL_STORAGE_KEY]: expect.objectContaining({ targetTabId: null }),
    });
  });

  it('does not treat a selected DeepSeek chat tab as a ready visual target', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        targetTabId: 12,
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'DeepSeek', url: 'https://chat.deepseek.com/a/chat/s/current' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const preparation = await service.preparePersonalTarget();

    expect(preparation.status).toBe('not_controllable');
    expect(preparation.target?.id).toBe(12);
  });

  it('does not reacquire DeepSeek chat from a stale readiness hint', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        targetTabId: 99,
        lastTargetHint: {
          windowId: 1,
          origin: 'https://chat.deepseek.com',
          title: 'DeepSeek',
          updatedAt: 1,
        },
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'DeepSeek', url: 'https://chat.deepseek.com/a/chat/s/current' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const preparation = await service.preparePersonalTarget({ allowActiveFallback: true });

    expect(preparation.status).toBe('missing');
    await expect(chromeStub.storage.local.get(BROWSER_CONTROL_STORAGE_KEY)).resolves.toMatchObject({
      [BROWSER_CONTROL_STORAGE_KEY]: expect.objectContaining({ targetTabId: 99 }),
    });
  });

  it('normalizes target locks without persisting page titles or full URLs', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: {
        enabled: true,
        label: 'Dev++ personal browser target with extra text past the cap',
        targetTabId: 12,
        windowId: 1,
        groupId: 4,
        origin: 'https://example.com',
        title: 'Sensitive page title',
        url: 'https://example.com/private?token=secret',
        updatedAt: 123.9,
      },
    });

    expect(settings.targetLock).toEqual({
      enabled: true,
      label: 'Dev++ personal browser target with extra',
      targetTabId: 12,
      windowId: 1,
      windowHint: null,
      groupId: 4,
      origin: 'https://example.com',
      updatedAt: 123,
    });
    expect(JSON.stringify(settings.targetLock)).not.toMatch(/Sensitive|private|token=secret|url/);
  });

  it('locks the current target as safe origin metadata only', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        targetTabId: 12,
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({
        id: 12,
        active: true,
        title: 'Sensitive page title',
        url: 'https://example.com/private?token=secret#hash',
        groupId: 7,
      }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    await service.lockCurrentTarget('Dev++');

    const stored = storage.get(BROWSER_CONTROL_STORAGE_KEY);
    expect(stored).toMatchObject({
      targetLock: {
        enabled: true,
        label: 'Dev++',
        targetTabId: 12,
        windowId: 1,
        windowHint: null,
        groupId: 7,
        origin: 'https://example.com',
      },
    });
    expect(JSON.stringify(stored)).not.toMatch(/Sensitive page title|private|token=secret|#hash/);
  });

  it('reacquires a locked target by origin without falling back to the active tab', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        targetTabId: 99,
        targetLock: {
          enabled: true,
          label: 'Dev++',
          targetTabId: 99,
          windowId: 2,
          groupId: 7,
          origin: 'https://locked.example',
          updatedAt: 1,
        },
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'Active', url: 'https://active.example/', windowId: 1 }),
      createTab({ id: 34, active: false, title: 'Locked', url: 'https://locked.example/path?token=secret', windowId: 2, groupId: 7 }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const preparation = await service.preparePersonalTarget({ allowActiveFallback: true });

    expect(preparation.status).toBe('reacquired');
    expect(preparation.target?.id).toBe(34);
    expect(JSON.stringify(storage.get(BROWSER_CONTROL_STORAGE_KEY))).not.toMatch(/path|token=secret/);
  });

  it('does not silently choose among ambiguous locked-origin targets', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        targetTabId: 99,
        targetLock: {
          enabled: true,
          label: 'Dev++',
          targetTabId: 99,
          windowId: null,
          groupId: null,
          origin: 'https://locked.example',
          updatedAt: 1,
        },
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 34, active: false, title: 'Locked 1', url: 'https://locked.example/a' }),
      createTab({ id: 35, active: false, title: 'Locked 2', url: 'https://locked.example/b' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const preparation = await service.preparePersonalTarget({ allowActiveFallback: true });

    expect(preparation.status).toBe('missing');
    expect(preparation.target).toBeNull();
  });

  it('uses safe window geometry hints to reacquire locked targets on the same display', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        targetTabId: 99,
        targetLock: {
          enabled: true,
          label: 'Dev++',
          targetTabId: 99,
          windowId: null,
          windowHint: {
            left: 3055,
            top: -243,
            width: 1351,
            height: 971,
            state: 'normal',
          },
          groupId: null,
          origin: 'https://locked.example',
          updatedAt: 1,
        },
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 34, active: false, title: 'Locked main', url: 'https://locked.example/a', windowId: 1 }),
      createTab({ id: 35, active: false, title: 'Locked studio', url: 'https://locked.example/b', windowId: 2 }),
    ], [
      { id: 1, left: 192, top: 76, width: 1643, height: 1169, state: 'normal' },
      { id: 2, left: 3055, top: -243, width: 1351, height: 971, state: 'normal' },
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const preparation = await service.preparePersonalTarget({ allowActiveFallback: true });

    expect(preparation.status).toBe('reacquired');
    expect(preparation.target?.id).toBe(35);
    expect(JSON.stringify(storage.get(BROWSER_CONTROL_STORAGE_KEY))).not.toMatch(/locked.example\/b/);
  });
});

describe('browser accessibility snapshot formatter', () => {
  it('formats AX nodes with stable element ids and backend node mapping', () => {
    const snapshot = formatAccessibilitySnapshot({
      url: 'https://example.com/',
      title: 'Example',
      maxNodes: 20,
      maxTextBytes: 4000,
      axNodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Example' }, childIds: ['2'] },
        { nodeId: '2', role: { value: 'button' }, name: { value: 'Submit' }, backendDOMNodeId: 42 },
      ],
    });

    expect(snapshot.result.text).toContain('URL: https://example.com/');
    expect(snapshot.result.text).toContain('[e2] button "Submit"');
    expect(snapshot.uidToBackendNodeId.get('e2')).toBe(42);
  });

  it('truncates snapshots by node and text budgets', () => {
    const snapshot = formatAccessibilitySnapshot({
      url: 'https://example.com/',
      title: 'Example',
      maxNodes: 1,
      maxTextBytes: 200,
      axNodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Example' }, childIds: ['2'] },
        { nodeId: '2', role: { value: 'button' }, name: { value: 'Second' }, backendDOMNodeId: 43 },
      ],
    });

    expect(snapshot.result.nodes).toHaveLength(1);
    expect(snapshot.result.truncated).toBe(true);
    expect(snapshot.result.text).toContain('...[snapshot truncated]');
  });
});

describe('browser element point calculation', () => {
  it('scrolls offscreen elements into view before returning a click point', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    let scrolled = false;
    button.scrollIntoView = vi.fn(() => {
      scrolled = true;
    });
    button.getBoundingClientRect = vi.fn(() => scrolled
      ? createRect({ left: 20, top: 100, width: 80, height: 40 })
      : createRect({ left: 20, top: 1200, width: 80, height: 40 }));

    const point = await getBrowserControlElementPoint.call(button);

    expect(button.scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      inline: 'center',
      behavior: 'auto',
    });
    expect(point).toMatchObject({
      x: 60,
      y: 120,
      width: 80,
      height: 40,
      visible: true,
    });
  });
});

describe('browser navigation tool', () => {
  it('lists tabs when tabGroups is blocked by the browser', async () => {
    const storage = new Map<string, unknown>();
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'Example', url: 'https://example.com/' }),
    ]);
    Object.defineProperty(chromeStub, 'tabGroups', {
      get() {
        throw new Error("'tabGroups' is not allowed for specified extension ID.");
      },
    });
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });
    const state = await service.getState();

    expect(state.supported).toBe(true);
    expect(state.targets).toHaveLength(1);
    expect(state.targets[0]).toMatchObject({
      id: 12,
      title: 'Example',
      groupName: undefined,
    });
  });

  it('opens a new tab by default so the chat tab is not replaced', async () => {
    const storage = new Map<string, unknown>();
    storage.set(BROWSER_CONTROL_STORAGE_KEY, {
      ...DEFAULT_BROWSER_CONTROL_SETTINGS,
      enabled: true,
      targetTabId: 12,
      allowVisionCapture: true,
      includeSnapshotAfterActions: false,
    });
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'DeepSeek', url: 'https://chat.deepseek.com/a/chat/s/current' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });
    const result = await service.execute('browser_navigate', { url: 'https://example.com/' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      tabId: 100,
      url: 'https://example.com/',
      newTab: true,
    });
    expect(chromeStub.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com/', active: true });
    expect(chromeStub.debugger.attach).not.toHaveBeenCalled();
    expect(chromeStub.debugger.sendCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      'Page.navigate',
      expect.anything(),
    );
    await expect(chromeStub.tabs.get(12)).resolves.toMatchObject({
      url: 'https://chat.deepseek.com/a/chat/s/current',
    });
    await expect(chromeStub.storage.local.get(BROWSER_CONTROL_STORAGE_KEY)).resolves.toMatchObject({
      [BROWSER_CONTROL_STORAGE_KEY]: expect.objectContaining({ targetTabId: 100 }),
    });
  });

  it('can still replace the selected tab when newTab is explicitly false', async () => {
    const storage = new Map<string, unknown>();
    storage.set(BROWSER_CONTROL_STORAGE_KEY, {
      ...DEFAULT_BROWSER_CONTROL_SETTINGS,
      enabled: true,
      targetTabId: 12,
      allowVisionCapture: true,
      includeSnapshotAfterActions: false,
    });
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'DeepSeek', url: 'https://chat.deepseek.com/a/chat/s/current' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });
    const result = await service.execute('browser_navigate', {
      url: 'https://example.com/',
      newTab: false,
    });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      tabId: 12,
      url: 'https://example.com/',
      newTab: false,
    });
    expect(chromeStub.tabs.create).not.toHaveBeenCalled();
    expect(chromeStub.debugger.attach).toHaveBeenCalledWith({ tabId: 12 }, '1.3');
    expect(chromeStub.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 12 },
      'Page.navigate',
      { url: 'https://example.com/' },
    );
    await expect(chromeStub.tabs.get(12)).resolves.toMatchObject({
      url: 'https://example.com/',
    });
  });

  it('captures the controlled tab screenshot for Vision without returning through generic tool text', async () => {
    const storage = new Map<string, unknown>();
    storage.set(BROWSER_CONTROL_STORAGE_KEY, {
      ...DEFAULT_BROWSER_CONTROL_SETTINGS,
      enabled: true,
      targetTabId: 12,
      allowVisionCapture: true,
      includeSnapshotAfterActions: false,
    });
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'Example', url: 'https://example.com/' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });
    const capture = await service.captureScreenshotForVision();

    expect(capture).toMatchObject({
      tabId: 12,
      mimeType: 'image/png',
      sizeBytes: 5,
    });
    expect(capture).not.toHaveProperty('title');
    expect(capture).not.toHaveProperty('url');
    expect(capture.dataBase64).toBe(btoa('probe'));
    expect(chromeStub.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 12 },
      'Page.captureScreenshot',
      {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      },
    );
  });

  it('does not auto-select the active tab for visual capture', async () => {
    const storage = new Map<string, unknown>();
    storage.set(BROWSER_CONTROL_STORAGE_KEY, {
      ...DEFAULT_BROWSER_CONTROL_SETTINGS,
      enabled: true,
      targetTabId: null,
      allowVisionCapture: true,
      includeSnapshotAfterActions: false,
    });
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'Active page', url: 'https://example.com/' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    await expect(service.captureScreenshotForVision()).rejects.toMatchObject({
      code: 'browser_target_not_selected',
    });
    expect(chromeStub.debugger.attach).not.toHaveBeenCalled();
    await expect(chromeStub.storage.local.get(BROWSER_CONTROL_STORAGE_KEY)).resolves.toMatchObject({
      [BROWSER_CONTROL_STORAGE_KEY]: expect.objectContaining({ targetTabId: null }),
    });
  });
});

function createTab(overrides: Partial<chrome.tabs.Tab> & { id: number }): chrome.tabs.Tab {
  return {
    id: overrides.id,
    windowId: overrides.windowId ?? 1,
    groupId: overrides.groupId ?? -1,
    active: overrides.active ?? false,
    title: overrides.title ?? '',
    url: overrides.url ?? 'about:blank',
    pendingUrl: overrides.pendingUrl,
    highlighted: false,
    incognito: false,
    index: 0,
    pinned: false,
    selected: false,
    discarded: false,
    frozen: false,
    autoDiscardable: true,
  };
}

function createRect(input: {
  left: number;
  top: number;
  width: number;
  height: number;
}): DOMRect {
  const { left, top, width, height } = input;
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => input,
  } as DOMRect;
}

function createChromeStub(
  storage: Map<string, unknown>,
  initialTabs: chrome.tabs.Tab[] = [],
  initialWindows: Array<Partial<chrome.windows.Window> & { id: number }> = [],
) {
  let nextTabId = 100;
  let attachedTabId: number | null = null;
  const tabs = new Map<number, chrome.tabs.Tab>(
    initialTabs.map((tab) => [tab.id!, { ...tab }]),
  );

  return {
    runtime: {
      id: 'extension-id',
      sendMessage: vi.fn(),
      getURL: vi.fn(),
      connectNative: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          for (const [key, storedValue] of Object.entries(value)) storage.set(key, storedValue);
        }),
      },
    },
    debugger: {
      attach: vi.fn(async (source: chrome.debugger.Debuggee) => {
        attachedTabId = source.tabId ?? null;
      }),
      detach: vi.fn(async (source: chrome.debugger.Debuggee) => {
        if (source.tabId === attachedTabId) attachedTabId = null;
      }),
      sendCommand: vi.fn(async (
        source: chrome.debugger.Debuggee,
        method: string,
        params?: Record<string, unknown>,
      ) => {
        if (source.tabId !== attachedTabId) throw new Error('No tab is attached.');
        if (method === 'Page.navigate' && typeof params?.url === 'string') {
          const tab = tabs.get(source.tabId);
          if (tab) tab.url = params.url;
        }
        if (method === 'Page.captureScreenshot') {
          return { data: btoa('probe') };
        }
        return {};
      }),
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async (queryInfo: chrome.tabs.QueryInfo = {}) => {
        let result = Array.from(tabs.values());
        if (queryInfo.active === true) {
          result = result.filter((tab) => tab.active);
        }
        if (queryInfo.currentWindow === true) {
          result = result.filter((tab) => tab.windowId === 1);
        }
        return result.map((tab) => ({ ...tab }));
      }),
      get: vi.fn(async (tabId: number) => {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id ${tabId}`);
        return { ...tab };
      }),
      create: vi.fn(async (options: chrome.tabs.CreateProperties) => {
        const tab = createTab({
          id: nextTabId++,
          active: options.active === true,
          url: options.url ?? 'about:blank',
        });
        if (tab.active) {
          for (const existing of tabs.values()) {
            existing.active = false;
          }
        }
        tabs.set(tab.id!, tab);
        return { ...tab };
      }),
      update: vi.fn(async (tabId: number, properties: chrome.tabs.UpdateProperties) => {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id ${tabId}`);
        if (properties.active === true) {
          for (const existing of tabs.values()) {
            existing.active = false;
          }
          tab.active = true;
        }
        if (typeof properties.url === 'string') {
          tab.url = properties.url;
        }
        return { ...tab };
      }),
      remove: vi.fn(async (tabId: number) => {
        tabs.delete(tabId);
      }),
    },
    windows: {
      getAll: vi.fn(async () => initialWindows.map((window) => ({ ...window }))),
    },
    tabGroups: {
      query: vi.fn(async () => []),
    },
  };
}
