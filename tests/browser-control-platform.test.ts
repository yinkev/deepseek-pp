import { describe, expect, it, vi, afterEach } from 'vitest';
import { BrowserControlService } from '../core/browser-control/service';
import { normalizeBrowserControlSettings, DEFAULT_BROWSER_CONTROL_SETTINGS } from '../core/browser-control/settings';
import { BROWSER_CONTROL_STORAGE_KEY } from '../core/browser-control/types';

function createTab(overrides: Partial<chrome.tabs.Tab> & { id: number }): chrome.tabs.Tab {
  return {
    id: overrides.id,
    windowId: overrides.windowId ?? 1,
    groupId: overrides.groupId ?? -1,
    active: overrides.active ?? false,
    title: overrides.title ?? '',
    url: overrides.url ?? 'about:blank',
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

function createMinimalChrome() {
  return {
    runtime: { id: 'ext-id', sendMessage: vi.fn(), getURL: vi.fn(), connectNative: vi.fn() },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: undefined })),
        set: vi.fn(async () => {}),
      },
    },
    debugger: {
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(),
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async () => []),
      get: vi.fn(async () => createTab({ id: 1 })),
      create: vi.fn(async () => createTab({ id: 100 })),
      update: vi.fn(async () => ({})),
      remove: vi.fn(async () => {}),
    },
    windows: { getAll: vi.fn(async () => []) },
    tabGroups: { query: vi.fn(async () => []) },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BrowserControlService platform support', () => {
  it('isSupported returns true when all Chrome APIs are available', () => {
    const chromeStub = createMinimalChrome();
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService();
    expect(service.isSupported()).toBe(true);
  });

  it('isSupported returns false when chrome.debugger.attach is missing', () => {
    const chromeStub = createMinimalChrome();
    (chromeStub.debugger as Record<string, unknown>).attach = undefined;
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService();
    expect(service.isSupported()).toBe(false);
  });

  it('isSupported returns false when chrome.debugger.sendCommand is missing', () => {
    const chromeStub = createMinimalChrome();
    (chromeStub.debugger as Record<string, unknown>).sendCommand = undefined;
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService();
    expect(service.isSupported()).toBe(false);
  });

  it('isSupported returns false when chrome.tabs.query is missing', () => {
    const chromeStub = createMinimalChrome();
    (chromeStub.tabs as Record<string, unknown>).query = undefined;
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService();
    expect(service.isSupported()).toBe(false);
  });

  it('isSupported returns false when chrome.tabs.get is missing', () => {
    const chromeStub = createMinimalChrome();
    (chromeStub.tabs as Record<string, unknown>).get = undefined;
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService();
    expect(service.isSupported()).toBe(false);
  });

  it('isSupported returns false when chrome is undefined (non-Chromium)', () => {
    vi.stubGlobal('chrome', undefined);
    const service = new BrowserControlService();
    expect(service.isSupported()).toBe(false);
  });

  it('getState returns supported:false when chromeApi is unavailable', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
        },
      },
    });

    const service = new BrowserControlService({ chromeApi: undefined as unknown as typeof chrome });
    const state = await service.getState();

    expect(state.supported).toBe(false);
    expect(state.targets).toHaveLength(0);
  });

  it('getState returns targets when tabs exist', async () => {
    const chromeStub = createMinimalChrome();
    (chromeStub.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      createTab({ id: 10, active: true, title: 'Tab', url: 'https://example.com/' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService();
    const state = await service.getState();

    expect(state.supported).toBe(true);
    expect(state.targets).toHaveLength(1);
  });

  it('execute returns browser_control_disabled when settings.enabled is false', async () => {
    const storage = new Map<string, unknown>([
      [BROWSER_CONTROL_STORAGE_KEY, { ...DEFAULT_BROWSER_CONTROL_SETTINGS, enabled: false }],
    ]);
    const chromeStub = createMinimalChrome();
    (chromeStub.storage.local.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string) => ({ [key]: storage.get(key) }),
    );
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService();
    const result = await service.execute('browser_snapshot', {});

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('browser_control_disabled');
  });
});

describe('normalizeBrowserControlSettings edge cases', () => {
  it('returns defaults for null input', () => {
    expect(normalizeBrowserControlSettings(null)).toEqual(DEFAULT_BROWSER_CONTROL_SETTINGS);
  });

  it('returns defaults for undefined input', () => {
    expect(normalizeBrowserControlSettings(undefined)).toEqual(DEFAULT_BROWSER_CONTROL_SETTINGS);
  });

  it('returns defaults for array input', () => {
    expect(normalizeBrowserControlSettings([])).toEqual(DEFAULT_BROWSER_CONTROL_SETTINGS);
  });

  it('returns defaults for string input', () => {
    expect(normalizeBrowserControlSettings('bad')).toEqual(DEFAULT_BROWSER_CONTROL_SETTINGS);
  });

  it('clamps maxSnapshotNodes to minimum 50', () => {
    const settings = normalizeBrowserControlSettings({ maxSnapshotNodes: 10 });
    expect(settings.maxSnapshotNodes).toBe(50);
  });

  it('clamps maxSnapshotNodes to maximum 1500', () => {
    const settings = normalizeBrowserControlSettings({ maxSnapshotNodes: 9999 });
    expect(settings.maxSnapshotNodes).toBe(1500);
  });

  it('clamps maxSnapshotTextBytes to minimum 4000', () => {
    const settings = normalizeBrowserControlSettings({ maxSnapshotTextBytes: 100 });
    expect(settings.maxSnapshotTextBytes).toBe(4000);
  });

  it('clamps maxSnapshotTextBytes to maximum 80000', () => {
    const settings = normalizeBrowserControlSettings({ maxSnapshotTextBytes: 999999 });
    expect(settings.maxSnapshotTextBytes).toBe(80000);
  });

  it('normalizes non-numeric maxSnapshotNodes to default', () => {
    const settings = normalizeBrowserControlSettings({ maxSnapshotNodes: 'abc' });
    expect(settings.maxSnapshotNodes).toBe(DEFAULT_BROWSER_CONTROL_SETTINGS.maxSnapshotNodes);
  });

  it('normalizes Infinity maxSnapshotNodes to default', () => {
    const settings = normalizeBrowserControlSettings({ maxSnapshotNodes: Infinity });
    expect(settings.maxSnapshotNodes).toBe(DEFAULT_BROWSER_CONTROL_SETTINGS.maxSnapshotNodes);
  });

  it('handles partial input gracefully', () => {
    const settings = normalizeBrowserControlSettings({ enabled: false });
    expect(settings.enabled).toBe(false);
    expect(settings.maxSnapshotNodes).toBe(DEFAULT_BROWSER_CONTROL_SETTINGS.maxSnapshotNodes);
    expect(settings.targetTabId).toBeNull();
  });

  it('targetTabId must be integer', () => {
    expect(normalizeBrowserControlSettings({ targetTabId: 12.5 }).targetTabId).toBeNull();
    expect(normalizeBrowserControlSettings({ targetTabId: 12 }).targetTabId).toBe(12);
  });

  it('targetTabId accepts negative integer values', () => {
    expect(normalizeBrowserControlSettings({ targetTabId: -1 }).targetTabId).toBe(-1);
  });

  it('boolean fields default correctly', () => {
    const settings = normalizeBrowserControlSettings({});
    expect(settings.enabled).toBe(true);
    expect(settings.includeSnapshotAfterActions).toBe(false);
    expect(settings.allowVisionCapture).toBe(true);
    expect(settings.verifyAfterActions).toBe(true);
    expect(settings.collectEvidencePacks).toBe(true);
    expect(settings.debugDistillerEnabled).toBe(true);
  });

  it('enabled:false is preserved', () => {
    expect(normalizeBrowserControlSettings({ enabled: false }).enabled).toBe(false);
  });

  it('includeSnapshotAfterActions:true is preserved', () => {
    expect(normalizeBrowserControlSettings({ includeSnapshotAfterActions: true }).includeSnapshotAfterActions).toBe(true);
  });
});
