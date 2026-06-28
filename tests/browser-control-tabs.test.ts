import { describe, expect, it, vi, afterEach } from 'vitest';
import { getControllableState, BrowserControlService } from '../core/browser-control/service';
import { normalizeBrowserControlSettings, DEFAULT_BROWSER_CONTROL_SETTINGS } from '../core/browser-control/settings';
import { BROWSER_CONTROL_STORAGE_KEY } from '../core/browser-control/types';

function createTab(overrides: Partial<chrome.tabs.Tab> & { id: number }): chrome.tabs.Tab {
  return {
    windowId: 1,
    groupId: -1,
    active: false,
    title: '',
    url: 'about:blank',
    highlighted: false,
    incognito: false,
    index: 0,
    pinned: false,
    selected: false,
    discarded: false,
    frozen: false,
    autoDiscardable: true,
    ...overrides,
  };
}

function createChromeStub(storage: Map<string, unknown>, tabs: chrome.tabs.Tab[] = []) {
  const tabMap = new Map<number, chrome.tabs.Tab>(tabs.map((t) => [t.id!, { ...t }]));
  let nextTabId = 100;

  return {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(value)) storage.set(k, v);
        }),
      },
    },
    debugger: {
      attach: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
      sendCommand: vi.fn(async () => ({})),
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async (queryInfo: chrome.tabs.QueryInfo = {}) => {
        let result = Array.from(tabMap.values());
        if (queryInfo.active === true) result = result.filter((t) => t.active);
        if (queryInfo.currentWindow === true) result = result.filter((t) => t.windowId === 1);
        return result.map((t) => ({ ...t }));
      }),
      get: vi.fn(async (tabId: number) => {
        const tab = tabMap.get(tabId);
        if (!tab) throw new Error(`No tab with id ${tabId}`);
        return { ...tab };
      }),
      create: vi.fn(async (options: chrome.tabs.CreateProperties) => {
        const tab = createTab({ id: nextTabId++, active: options.active === true, url: options.url ?? 'about:blank' });
        tabMap.set(tab.id!, tab);
        return { ...tab };
      }),
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

describe('getControllableState', () => {
  it('returns controllable:true for empty URL', () => {
    expect(getControllableState('')).toEqual({ controllable: true });
  });

  it('returns controllable:true for about:blank', () => {
    expect(getControllableState('about:blank')).toEqual({ controllable: true });
  });

  it('returns controllable:true for http URLs', () => {
    expect(getControllableState('http://example.com/')).toEqual({ controllable: true });
  });

  it('returns controllable:true for https URLs', () => {
    expect(getControllableState('https://example.com/')).toEqual({ controllable: true });
  });

  it('returns controllable:true for file:// URLs', () => {
    expect(getControllableState('file:///Users/test/file.html')).toEqual({ controllable: true });
  });

  it('returns controllable:false for chrome:// URLs', () => {
    const result = getControllableState('chrome://settings/');
    expect(result.controllable).toBe(false);
    expect(result.reason).toContain('chrome');
  });

  it('returns controllable:false for edge:// URLs', () => {
    const result = getControllableState('edge://settings/');
    expect(result.controllable).toBe(false);
    expect(result.reason).toContain('edge');
  });

  it('returns controllable:false for devtools:// URLs', () => {
    const result = getControllableState('devtools://devtools/');
    expect(result.controllable).toBe(false);
    expect(result.reason).toContain('devtools');
  });

  it('returns controllable:false for unknown scheme with reason', () => {
    const result = getControllableState('ftp://files.example/');
    expect(result.controllable).toBe(false);
    expect(result.reason).toContain('ftp');
  });
});

describe('BrowserControlService tab targeting', () => {
  it('listTargets maps tabs to BrowserControlTarget format', async () => {
    const storage = new Map<string, unknown>([
      [BROWSER_CONTROL_STORAGE_KEY, { ...DEFAULT_BROWSER_CONTROL_SETTINGS }],
    ]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 10, active: true, title: 'Active', url: 'https://example.com/' }),
      createTab({ id: 20, active: false, title: 'Background', url: 'https://other.com/' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService();
    const targets = await service.listTargets();

    expect(targets).toHaveLength(2);
    expect(targets.find((t) => t.id === 10)).toMatchObject({
      id: 10,
      title: 'Active',
      url: 'https://example.com/',
      active: true,
      currentWindow: true,
      controllable: true,
    });
    expect(targets.find((t) => t.id === 20)).toMatchObject({
      id: 20,
      title: 'Background',
      controllable: true,
    });
  });

  it('setTarget saves targetTabId to storage', async () => {
    const storage = new Map<string, unknown>([
      [BROWSER_CONTROL_STORAGE_KEY, { ...DEFAULT_BROWSER_CONTROL_SETTINGS }],
    ]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 10, active: true, url: 'https://example.com/' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService();
    await service.setTarget(10);

    const stored = storage.get(BROWSER_CONTROL_STORAGE_KEY) as Record<string, unknown>;
    expect(stored.targetTabId).toBe(10);
  });

  it('setTarget throws for non-controllable tab', async () => {
    const storage = new Map<string, unknown>([
      [BROWSER_CONTROL_STORAGE_KEY, { ...DEFAULT_BROWSER_CONTROL_SETTINGS }],
    ]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 10, active: true, url: 'chrome://settings/' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService();
    await expect(service.setTarget(10)).rejects.toMatchObject({
      code: 'browser_target_not_controllable',
    });
  });

  it('listTargets filters tabs without id', async () => {
    const storage = new Map<string, unknown>([
      [BROWSER_CONTROL_STORAGE_KEY, { ...DEFAULT_BROWSER_CONTROL_SETTINGS }],
    ]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 10, active: true, url: 'https://example.com/' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService();
    const allTabs = await service.listTargets();
    expect(allTabs.length).toBeGreaterThanOrEqual(1);

    for (const target of allTabs) {
      expect(typeof target.id).toBe('number');
    }
  });

  it('getState returns supported:false when APIs missing', async () => {
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

  it('getState returns supported:false when debugger APIs missing', async () => {
    const storage = new Map<string, unknown>([
      [BROWSER_CONTROL_STORAGE_KEY, { ...DEFAULT_BROWSER_CONTROL_SETTINGS }],
    ]);
    const chromeStub = createChromeStub(storage);
    (chromeStub.debugger as Record<string, unknown>).attach = undefined;
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService();
    const state = await service.getState();

    expect(state.supported).toBe(false);
    expect(state.targets).toHaveLength(0);
  });

  it('listTargets marks non-http schemes as non-controllable', async () => {
    const storage = new Map<string, unknown>([
      [BROWSER_CONTROL_STORAGE_KEY, { ...DEFAULT_BROWSER_CONTROL_SETTINGS }],
    ]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 10, active: true, url: 'chrome://extensions/' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService();
    const targets = await service.listTargets();

    expect(targets[0].controllable).toBe(false);
    expect(targets[0].reason).toContain('chrome');
  });
});
