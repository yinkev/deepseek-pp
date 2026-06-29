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
  vi.useRealTimers();
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
      includeSnapshotAfterActions: false,
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
    expect(normalizeBrowserControlSettings({ includeSnapshotAfterActions: true })).toMatchObject({
      includeSnapshotAfterActions: true,
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

	  it('describes per-field snapshot leases for browser_fill_form', () => {
	    const descriptor = createBrowserControlToolDescriptors('en').find((tool) => tool.name === 'browser_fill_form');
	    const fields = descriptor?.inputSchema.properties?.fields as {
	      items?: { properties?: Record<string, unknown>; required?: string[] };
	    } | undefined;

	    expect(fields?.items?.properties).toMatchObject({
	      snapshotId: expect.objectContaining({ type: 'string' }),
	      targetLeaseId: expect.objectContaining({ type: 'string' }),
	      uid: expect.objectContaining({ type: 'string' }),
	      selector: expect.objectContaining({ type: 'string' }),
	      value: expect.objectContaining({ type: 'string' }),
	    });
	    expect(fields?.items?.required).toEqual(['value']);
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

  it('allows automation-style browser navigation to open a fresh controlled tab when explicit', async () => {
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

    const result = await service.execute('browser_navigate', { url: 'https://example.com/', newTab: true }, {
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

  it('does not create a target implicitly when explicit-target navigation omits newTab', async () => {
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

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('browser_target_not_selected');
    expect(chromeStub.tabs.create).not.toHaveBeenCalled();
    expect(storage.get(BROWSER_CONTROL_STORAGE_KEY)).toMatchObject({
      targetTabId: null,
    });
  });

  it('cancels browser wait actions without waiting for the full timeout', async () => {
    vi.useFakeTimers();
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
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
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });
    const controller = new AbortController();

    const promise = service.execute('browser_wait_for', { expression: 'false', timeoutMs: 5_000 }, {
      signal: controller.signal,
    });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    controller.abort();

    await expect(promise).resolves.toMatchObject({
      ok: false,
      error: { code: 'browser_control_aborted', retryable: false },
    });
  });

  it('rejects snapshot uids after the target navigates instead of refreshing automatically', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
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
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const lease = await captureSnapshotLease(service);
    await chromeStub.tabs.update(12, { url: 'https://example.com/next' });
    const result = await service.execute('browser_click', { ...lease, uid: 'e2' });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('browser_uid_not_found');
    expect(result.error?.message).toContain('Run browser_snapshot again');
    expect(chromeStub.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 12 },
      'DOM.resolveNode',
      expect.anything(),
    );
    expect(chromeStub.debugger.sendCommand.mock.calls.filter((call) => call[1] === 'Accessibility.getFullAXTree')).toHaveLength(1);
  });

  it('requires snapshotId when using a snapshot uid', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
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
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const lease = await captureSnapshotLease(service);
    const result = await service.execute('browser_click', { targetLeaseId: lease.targetLeaseId, uid: 'e2' });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('browser_snapshot_id_required');
    expect(chromeStub.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 12 },
      'DOM.resolveNode',
      expect.anything(),
    );
  });

  it('requires targetLeaseId when using a snapshot uid', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
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
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const lease = await captureSnapshotLease(service);
    const result = await service.execute('browser_click', { snapshotId: lease.snapshotId, uid: 'e2' });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('browser_target_lease_required');
    expect(chromeStub.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 12 },
      'DOM.resolveNode',
      expect.anything(),
    );
  });

  it('rejects snapshot uids with the wrong targetLeaseId before resolving nodes', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
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
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const lease = await captureSnapshotLease(service);
    const result = await service.execute('browser_click', {
      snapshotId: lease.snapshotId,
      targetLeaseId: 'target-lease-other',
      uid: 'e2',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('browser_uid_not_found');
    expect(chromeStub.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 12 },
      'DOM.resolveNode',
      expect.anything(),
    );
  });

  it('expires snapshot uids after the freshness window', async () => {
    let now = 1_000;
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
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
    const service = new BrowserControlService({
      chromeApi: chromeStub as unknown as typeof chrome,
      now: () => now,
    });

    const lease = await captureSnapshotLease(service);
    now += 30_001;
    const result = await service.execute('browser_click', { ...lease, uid: 'e2' });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('browser_uid_not_found');
    expect(chromeStub.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 12 },
      'DOM.resolveNode',
      expect.anything(),
    );
  });

  it('clears snapshot uids after actions when post-action snapshots are disabled', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
        includeSnapshotAfterActions: false,
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
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const lease = await captureSnapshotLease(service);
    await expect(service.execute('browser_click', { ...lease, uid: 'e2' })).resolves.toMatchObject({ ok: true });
    const secondClick = await service.execute('browser_click', { ...lease, uid: 'e2' });

    expect(secondClick.ok).toBe(false);
    expect(secondClick.error?.code).toBe('browser_uid_not_found');
    expect(chromeStub.debugger.sendCommand.mock.calls.filter((call) => call[1] === 'Accessibility.getFullAXTree')).toHaveLength(1);
  });

  it('clears snapshot uids after handling dialogs when post-action snapshots are disabled', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
        includeSnapshotAfterActions: false,
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
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const lease = await captureSnapshotLease(service);
    chromeStub.emitDebuggerEvent(
      { tabId: 12 },
      'Page.javascriptDialogOpening',
      { type: 'alert', message: 'Confirm action' },
    );
    await expect(service.execute('browser_handle_dialog', { accept: true })).resolves.toMatchObject({ ok: true });
    const click = await service.execute('browser_click', { ...lease, uid: 'e2' });

    expect(click.ok).toBe(false);
    expect(click.error?.code).toBe('browser_uid_not_found');
    expect(chromeStub.debugger.sendCommand.mock.calls.filter((call) => call[1] === 'Accessibility.getFullAXTree')).toHaveLength(1);
  });

  it('clears old snapshot uids if a post-action snapshot fails', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
        includeSnapshotAfterActions: true,
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
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const lease = await captureSnapshotLease(service);
    chromeStub.failNextAccessibilitySnapshot();
    const firstClick = await service.execute('browser_click', { ...lease, uid: 'e2' });
    expect(firstClick.ok).toBe(false);

    const secondClick = await service.execute('browser_click', { ...lease, uid: 'e2' });
    expect(secondClick.ok).toBe(false);
    expect(secondClick.error?.code).toBe('browser_uid_not_found');
    expect(chromeStub.debugger.sendCommand.mock.calls.filter((call) => call[1] === 'DOM.resolveNode')).toHaveLength(1);
  });

	  it('clears old snapshot uids before a new direct snapshot attempt can fail', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
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
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const lease = await captureSnapshotLease(service);
    chromeStub.failNextAccessibilitySnapshot();
    const failedSnapshot = await service.execute('browser_snapshot', {});
    expect(failedSnapshot.ok).toBe(false);

    const click = await service.execute('browser_click', { ...lease, uid: 'e2' });
    expect(click.ok).toBe(false);
    expect(click.error?.code).toBe('browser_uid_not_found');
	    expect(chromeStub.debugger.sendCommand.mock.calls.filter((call) => call[1] === 'DOM.resolveNode')).toHaveLength(0);
	  });

	  it('clears snapshot uids after a mutating uid action fails', async () => {
	    const storage = new Map<string, unknown>([[
	      BROWSER_CONTROL_STORAGE_KEY,
	      {
	        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
	        enabled: true,
	        targetTabId: 12,
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
	    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

	    const lease = await captureSnapshotLease(service);
	    chromeStub.failNextRuntimeCallFunctionOn();
	    const failedFill = await service.execute('browser_fill', { ...lease, uid: 'e2', value: 'probe' });
	    const resolveCountAfterFailedFill = chromeStub.debugger.sendCommand.mock.calls
	      .filter((call) => call[1] === 'DOM.resolveNode')
	      .length;

	    expect(failedFill.ok).toBe(false);
	    expect(failedFill.error?.code).toBe('browser_dom_call_failed');

	    const click = await service.execute('browser_click', { ...lease, uid: 'e2' });
	    expect(click.ok).toBe(false);
	    expect(click.error?.code).toBe('browser_uid_not_found');
	    expect(chromeStub.debugger.sendCommand.mock.calls.filter((call) => call[1] === 'DOM.resolveNode')).toHaveLength(
	      resolveCountAfterFailedFill,
	    );
	  });

	  it('rejects snapshot uids after debugger detach invalidates the lease', async () => {
	    const storage = new Map<string, unknown>([[
	      BROWSER_CONTROL_STORAGE_KEY,
	      {
	        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
	        enabled: true,
	        targetTabId: 12,
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
	    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

	    const lease = await captureSnapshotLease(service);
	    chromeStub.emitDebuggerDetach({ tabId: 12 }, 'target_closed');
	    const result = await service.execute('browser_click', { ...lease, uid: 'e2' });

	    expect(result.ok).toBe(false);
	    expect(result.error?.code).toBe('browser_uid_not_found');
	    expect(chromeStub.debugger.sendCommand).not.toHaveBeenCalledWith(
	      { tabId: 12 },
	      'DOM.resolveNode',
	      expect.anything(),
	    );
	  });

	  it('rejects snapshot uids after same-url page lifecycle invalidates the lease', async () => {
	    const storage = new Map<string, unknown>([[
	      BROWSER_CONTROL_STORAGE_KEY,
	      {
	        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
	        enabled: true,
	        targetTabId: 12,
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
	    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

	    const lease = await captureSnapshotLease(service);
	    chromeStub.emitDebuggerEvent({ tabId: 12 }, 'Page.frameNavigated', {});
	    const result = await service.execute('browser_click', { ...lease, uid: 'e2' });

	    expect(result.ok).toBe(false);
	    expect(result.error?.code).toBe('browser_uid_not_found');
	    expect(chromeStub.debugger.sendCommand).not.toHaveBeenCalledWith(
	      { tabId: 12 },
	      'DOM.resolveNode',
	      expect.anything(),
	    );
	  });

	  it('rejects old snapshot uids after switching to another same-origin target', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, url: 'https://example.com/a', title: 'Example A' }),
      createTab({ id: 34, active: false, url: 'https://example.com/b', title: 'Example B' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const lease = await captureSnapshotLease(service);
    await service.setTarget(34);
    const result = await service.execute('browser_click', { ...lease, uid: 'e2' });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('browser_uid_not_found');
    expect(chromeStub.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 34 },
      'DOM.resolveNode',
      expect.anything(),
    );
  });

  it('rejects old snapshot uids after switching away and back to the same tab', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, url: 'https://example.com/a', title: 'Example A' }),
      createTab({ id: 34, active: false, url: 'https://other.example/', title: 'Other' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const lease = await captureSnapshotLease(service);
    await service.setTarget(34);
    await service.setTarget(12);
    const result = await service.execute('browser_click', { ...lease, uid: 'e2' });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('browser_uid_not_found');
    expect(chromeStub.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 12 },
      'DOM.resolveNode',
      expect.anything(),
    );
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

  it('treats an explicitly selected DeepSeek chat tab as a ready target', async () => {
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

    expect(preparation.status).toBe('ready');
    expect(preparation.target?.id).toBe(12);
  });

  it('does not rewrite settings for an already ready selected target', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        targetTabId: 12,
        lastTargetHint: {
          windowId: 1,
          origin: 'https://example.com',
          title: 'Example',
          updatedAt: 123,
        },
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'Example', url: 'https://example.com/' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });
    chromeStub.storage.local.set.mockClear();

    const preparation = await service.preparePersonalTarget();

    expect(preparation.status).toBe('ready');
    expect(chromeStub.storage.local.set).not.toHaveBeenCalled();
    expect(storage.get(BROWSER_CONTROL_STORAGE_KEY)).toMatchObject({
      lastTargetHint: expect.objectContaining({ updatedAt: 123 }),
    });
  });

  it('types into an explicitly selected DeepSeek chat tab', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'DeepSeek', url: 'https://chat.deepseek.com/a/chat/s/current' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const result = await service.execute('browser_type', { text: 'hello DeepSeek' }, {
      requireExplicitTarget: true,
    });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      tabId: 12,
      textLength: 14,
    });
    expect(chromeStub.debugger.attach).toHaveBeenCalledWith({ tabId: 12 }, '1.3');
    expect(chromeStub.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 12 },
      'Input.insertText',
      { text: 'hello DeepSeek' },
    );
  });

  it('does not run arbitrary script in an explicitly selected DeepSeek chat tab', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        enabled: true,
        targetTabId: 12,
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'DeepSeek', url: 'https://chat.deepseek.com/a/chat/s/current' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });

    const result = await service.execute('browser_evaluate_script', { script: 'localStorage.userToken' }, {
      requireExplicitTarget: true,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('browser_provider_target_action_blocked');
    expect(chromeStub.debugger.attach).not.toHaveBeenCalled();
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

  it('does not rewrite settings for an already ready locked target', async () => {
    const storage = new Map<string, unknown>([[
      BROWSER_CONTROL_STORAGE_KEY,
      {
        ...DEFAULT_BROWSER_CONTROL_SETTINGS,
        targetTabId: 34,
        targetLock: {
          enabled: true,
          label: 'Dev++',
          targetTabId: 34,
          windowId: 2,
          groupId: 7,
          origin: 'https://locked.example',
          updatedAt: 456,
        },
        lastTargetHint: {
          windowId: 2,
          origin: 'https://locked.example',
          title: '',
          updatedAt: 456,
        },
      },
    ]]);
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 34, active: false, title: 'Locked', url: 'https://locked.example/path?token=secret', windowId: 2, groupId: 7 }),
    ]);
    vi.stubGlobal('chrome', chromeStub);
    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });
    chromeStub.storage.local.set.mockClear();

    const preparation = await service.preparePersonalTarget({ allowActiveFallback: true });

    expect(preparation.status).toBe('ready');
    expect(chromeStub.storage.local.set).not.toHaveBeenCalled();
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
      snapshotId: 'snapshot-1',
      targetLeaseId: 'target-lease-1',
      capturedAt: 123,
      url: 'https://example.com/',
      title: 'Example',
      maxNodes: 20,
      maxTextBytes: 4000,
      axNodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Example' }, childIds: ['2'] },
        { nodeId: '2', role: { value: 'button' }, name: { value: 'Submit' }, backendDOMNodeId: 42 },
      ],
    });

    expect(snapshot.result.snapshotId).toBe('snapshot-1');
    expect(snapshot.result.targetLeaseId).toBe('target-lease-1');
    expect(snapshot.result.capturedAt).toBe(123);
    expect(snapshot.result.text).toContain('Snapshot ID: snapshot-1');
    expect(snapshot.result.text).toContain('Target Lease ID: target-lease-1');
    expect(snapshot.result.text).toContain('URL: https://example.com/');
    expect(snapshot.result.text).toContain('[e2] button "Submit"');
    expect(snapshot.uidToBackendNodeId.get('e2')).toBe(42);
  });

  it('truncates snapshots by node and text budgets', () => {
    const snapshot = formatAccessibilitySnapshot({
      snapshotId: 'snapshot-2',
      targetLeaseId: 'target-lease-2',
      capturedAt: 456,
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
  it('does not navigate a selected DeepSeek chat tab away from the provider session', async () => {
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

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('browser_provider_target_action_blocked');
    expect(chromeStub.tabs.create).not.toHaveBeenCalled();
    expect(chromeStub.debugger.attach).not.toHaveBeenCalled();
    await expect(chromeStub.tabs.get(12)).resolves.toMatchObject({
      url: 'https://chat.deepseek.com/a/chat/s/current',
    });
  });

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

  it('navigates the selected tab by default instead of opening a new chat tab', async () => {
    const storage = new Map<string, unknown>();
    storage.set(BROWSER_CONTROL_STORAGE_KEY, {
      ...DEFAULT_BROWSER_CONTROL_SETTINGS,
      enabled: true,
      targetTabId: 12,
      allowVisionCapture: true,
      includeSnapshotAfterActions: false,
    });
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'Existing task', url: 'https://example.org/current' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });
    const result = await service.execute('browser_navigate', { url: 'https://example.com/' });

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
    await expect(chromeStub.storage.local.get(BROWSER_CONTROL_STORAGE_KEY)).resolves.toMatchObject({
      [BROWSER_CONTROL_STORAGE_KEY]: expect.objectContaining({ targetTabId: 12 }),
    });
  });

  it('opens a new tab only when newTab is explicitly true', async () => {
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
      newTab: true,
    });

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

  it('captures adaptive Browser View evidence with full-page and nested scroll labels', async () => {
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
    const capture = await service.captureBrowserViewForVision();

    expect(capture).toMatchObject({
      tabId: 12,
      windowId: 1,
      labels: ['Full page', 'Nested scroll 1: form panel (nested scroll sample)'],
      skippedNestedScrolls: 0,
    });
    expect(capture.captures).toHaveLength(2);
    expect(capture.captures[0]).toMatchObject({
      source: 'full_page',
      label: 'Full page',
      mimeType: 'image/png',
    });
    expect(capture.captures[1]).toMatchObject({
      source: 'nested_scroll',
      label: 'Nested scroll 1: form panel (nested scroll sample)',
      mimeType: 'image/png',
    });
    expect(chromeStub.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 12 },
      'Page.captureScreenshot',
      expect.objectContaining({
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: expect.objectContaining({ x: 0, y: 0, width: 900, height: 2400 }),
      }),
    );
    expect(chromeStub.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 12 },
      'Page.captureScreenshot',
      expect.objectContaining({
        captureBeyondViewport: true,
        clip: expect.objectContaining({ x: 450, y: 120, width: 360, height: 560 }),
      }),
    );
    const runtimeExpressions = chromeStub.debugger.sendCommand.mock.calls
      .filter(([, method]) => method === 'Runtime.evaluate')
      .map(([, , params]) => String((params as { expression?: string } | undefined)?.expression ?? ''));
    expect(runtimeExpressions.some((expression) => expression.includes('setScroll'))).toBe(true);
    expect(runtimeExpressions.some((expression) => expression.includes('restore'))).toBe(true);
    expect(runtimeExpressions.some((expression) => expression.includes('requestAnimationFrame'))).toBe(false);
  });

  it('falls back to sampled full-page evidence when a full-page image is too large', async () => {
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
    const baseSendCommand = chromeStub.debugger.sendCommand.getMockImplementation();
    chromeStub.debugger.sendCommand.mockImplementation(async (
      source: chrome.debugger.Debuggee,
      method: string,
      params?: Record<string, unknown>,
    ) => {
      if (method === 'Page.captureScreenshot') {
        const clip = params?.clip as { height?: number } | undefined;
        if ((clip?.height ?? 0) > 2000) {
          return { data: 'A'.repeat(12 * 1024 * 1024) };
        }
      }
      return baseSendCommand!(source, method, params);
    });
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });
    const capture = await service.captureBrowserViewForVision();

    expect(capture.warnings).toContain('Full-page screenshot was too large or unavailable; attached sampled page evidence.');
    expect(capture.captures[0]).toMatchObject({
      source: 'full_page',
      label: 'Full page (sampled slice)',
      sampled: true,
    });
    expect(capture.captures[0]?.sizeBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
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

async function captureSnapshotLease(service: BrowserControlService): Promise<{
  snapshotId: string;
  targetLeaseId: string;
}> {
  const snapshot = await service.execute('browser_snapshot', {});
  expect(snapshot).toMatchObject({ ok: true });
  const snapshotId = snapshot.output?.snapshotId;
  const targetLeaseId = snapshot.output?.targetLeaseId;
  expect(typeof snapshotId).toBe('string');
  expect(typeof targetLeaseId).toBe('string');
  return {
    snapshotId: snapshotId as string,
    targetLeaseId: targetLeaseId as string,
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
  let failAccessibilitySnapshot = false;
  let failRuntimeCallFunctionOn = false;
  let debuggerDetachListener: ((
    source: chrome.debugger.Debuggee,
    reason: string,
  ) => void) | null = null;
  let debuggerEventListener: ((
    source: chrome.debugger.Debuggee,
    method: string,
    params?: unknown,
  ) => void) | null = null;
  const tabs = new Map<number, chrome.tabs.Tab>(
    initialTabs.map((tab) => [tab.id!, { ...tab }]),
  );

  return {
    emitDebuggerEvent(
      source: chrome.debugger.Debuggee,
      method: string,
      params?: unknown,
    ) {
      debuggerEventListener?.(source, method, params);
    },
    emitDebuggerDetach(
      source: chrome.debugger.Debuggee,
      reason: string,
    ) {
      if (source.tabId === attachedTabId) attachedTabId = null;
      debuggerDetachListener?.(source, reason);
    },
    failNextAccessibilitySnapshot() {
      failAccessibilitySnapshot = true;
    },
    failNextRuntimeCallFunctionOn() {
      failRuntimeCallFunctionOn = true;
    },
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
        if (method === 'Page.getLayoutMetrics') {
          return {
            cssContentSize: { width: 900, height: 2400 },
          };
        }
        if (method === 'Page.captureScreenshot') {
          return { data: btoa('probe') };
        }
        if (method === 'Accessibility.getFullAXTree') {
          if (failAccessibilitySnapshot) {
            failAccessibilitySnapshot = false;
            throw new Error('AX tree unavailable.');
          }
          return {
            nodes: [
              { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Example' }, childIds: ['2'] },
              { nodeId: '2', role: { value: 'button' }, name: { value: 'Submit' }, backendDOMNodeId: 42 },
            ],
          };
        }
        if (method === 'DOM.resolveNode') {
          return { object: { objectId: `node-${params?.backendNodeId ?? 'unknown'}` } };
        }
        if (method === 'Runtime.callFunctionOn') {
          if (failRuntimeCallFunctionOn) {
            failRuntimeCallFunctionOn = false;
            return {
              exceptionDetails: {
                text: 'DOM call failed.',
                exception: { description: 'Synthetic DOM mutation failure.' },
              },
            };
          }
          return {
            result: {
              type: 'object',
              value: { x: 60, y: 120, width: 80, height: 40, visible: true },
            },
          };
        }
        if (method === 'Runtime.evaluate') {
          const expression = typeof params?.expression === 'string' ? params.expression : '';
          if (expression.includes('__deepseekPpBrowserViewCapture') && expression.includes('querySelectorAll')) {
            return {
              result: {
                type: 'object',
                value: {
                  viewportWidth: 900,
                  viewportHeight: 700,
                  contentWidth: 900,
                  contentHeight: 2400,
                  panels: [{
                    id: 'panel-0',
                    label: 'Nested scroll 1: form panel',
                    rect: { x: 450, y: 120, width: 360, height: 560 },
                    clientHeight: 560,
                    scrollHeight: 1400,
                    scrollTop: 0,
                    score: 5000,
                    sampled: false,
                  }],
                },
              },
            };
          }
          return { result: { type: 'boolean', value: true } };
        }
        return {};
      }),
      onDetach: {
        addListener: vi.fn((listener: typeof debuggerDetachListener) => {
          debuggerDetachListener = listener;
        }),
      },
      onEvent: {
        addListener: vi.fn((listener: typeof debuggerEventListener) => {
          debuggerEventListener = listener;
        }),
      },
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
