import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BrowserConnection } from '../core/browser-control/cdp';

function createDebuggerMock() {
  const eventListeners: Array<
    (source: chrome.debugger.Debuggee, method: string, params?: unknown) => void
  > = [];
  const detachListeners: Array<
    (source: chrome.debugger.Debuggee, reason: string) => void
  > = [];
  let attachedTabId: number | null = null;

  return {
    _emitEvent(source: chrome.debugger.Debuggee, method: string, params?: unknown) {
      for (const fn of eventListeners) fn(source, method, params);
    },
    _emitDetach(source: chrome.debugger.Debuggee, reason: string) {
      if (source.tabId === attachedTabId) attachedTabId = null;
      for (const fn of detachListeners) fn(source, reason);
    },
    _attachedTabId: () => attachedTabId,
    attach: vi.fn(async (source: chrome.debugger.Debuggee) => {
      attachedTabId = source.tabId ?? null;
    }),
    detach: vi.fn(async (source: chrome.debugger.Debuggee) => {
      if (source.tabId === attachedTabId) attachedTabId = null;
    }),
    sendCommand: vi.fn(async () => ({})),
    onDetach: {
      addListener: vi.fn((fn: typeof detachListeners[0]) => detachListeners.push(fn)),
    },
    onEvent: {
      addListener: vi.fn((fn: typeof eventListeners[0]) => eventListeners.push(fn)),
    },
  };
}

describe('BrowserConnection dialog state', () => {
  let debuggerMock: ReturnType<typeof createDebuggerMock>;
  let conn: BrowserConnection;

  beforeEach(async () => {
    debuggerMock = createDebuggerMock();
    const chromeApi = { debugger: debuggerMock } as unknown as typeof chrome;
    conn = new BrowserConnection(chromeApi);
    await conn.attach(10);
  });

  it('getLatestDialog returns null when no dialog has occurred', () => {
    expect(conn.getLatestDialog(10)).toBeNull();
  });

  it('stores dialog after Page.javascriptDialogOpening event', () => {
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'alert',
      message: 'Are you sure?',
    });

    const dialog = conn.getLatestDialog(10);
    expect(dialog).not.toBeNull();
    expect(dialog!.type).toBe('alert');
    expect(dialog!.message).toBe('Are you sure?');
    expect(typeof dialog!.seenAt).toBe('number');
  });

  it('captures defaultPrompt when present in event', () => {
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'prompt',
      message: 'Enter value:',
      defaultPrompt: 'default text',
    });

    expect(conn.getLatestDialog(10)!.defaultPrompt).toBe('default text');
  });

  it('defaultPrompt is undefined when not in event', () => {
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'confirm',
      message: 'Proceed?',
    });

    expect(conn.getLatestDialog(10)!.defaultPrompt).toBeUndefined();
  });

  it('dialog type defaults to "dialog" when not provided', () => {
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      message: 'No type field',
    });

    expect(conn.getLatestDialog(10)!.type).toBe('dialog');
  });

  it('dialog message defaults to empty string when not provided', () => {
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'alert',
    });

    expect(conn.getLatestDialog(10)!.message).toBe('');
  });

  it('clearDialog removes dialog state', () => {
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'alert',
      message: 'Test',
    });
    expect(conn.getLatestDialog(10)).not.toBeNull();

    conn.clearDialog(10);
    expect(conn.getLatestDialog(10)).toBeNull();
  });

  it('clearDialog is idempotent for non-existent tabId', () => {
    expect(() => conn.clearDialog(999)).not.toThrow();
  });

  it('new dialog for same tab replaces previous', () => {
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'alert',
      message: 'First dialog',
    });
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'confirm',
      message: 'Second dialog',
    });

    const dialog = conn.getLatestDialog(10);
    expect(dialog!.type).toBe('confirm');
    expect(dialog!.message).toBe('Second dialog');
  });

  it('multiple dialogs for different tabs are independent', () => {
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'alert',
      message: 'Tab 10',
    });
    debuggerMock._emitEvent({ tabId: 20 }, 'Page.javascriptDialogOpening', {
      type: 'confirm',
      message: 'Tab 20',
    });

    expect(conn.getLatestDialog(10)!.message).toBe('Tab 10');
    expect(conn.getLatestDialog(20)!.message).toBe('Tab 20');
  });

  it('dialog seenAt timestamp is set to current time', () => {
    const before = Date.now();
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'alert',
      message: 'Timestamped',
    });
    const after = Date.now();

    const seenAt = conn.getLatestDialog(10)!.seenAt;
    expect(seenAt).toBeGreaterThanOrEqual(before);
    expect(seenAt).toBeLessThanOrEqual(after);
  });

  it('ignores non-dialog events', () => {
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.loadEventFired', {});
    debuggerMock._emitEvent({ tabId: 10 }, 'Runtime.consoleAPICalled', {});

    expect(conn.getLatestDialog(10)).toBeNull();
  });

  it('dialog event with null params stores defaults', () => {
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', null);

    const dialog = conn.getLatestDialog(10);
    expect(dialog).not.toBeNull();
    expect(dialog!.type).toBe('dialog');
    expect(dialog!.message).toBe('');
  });

  it('dialog event with partial params stores defaults', () => {
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'beforeunload',
    });

    const dialog = conn.getLatestDialog(10);
    expect(dialog!.type).toBe('beforeunload');
    expect(dialog!.message).toBe('');
  });

  it('clearing one tab does not affect other tabs', () => {
    debuggerMock._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'alert',
      message: 'Tab 10',
    });
    debuggerMock._emitEvent({ tabId: 20 }, 'Page.javascriptDialogOpening', {
      type: 'confirm',
      message: 'Tab 20',
    });

    conn.clearDialog(10);
    expect(conn.getLatestDialog(10)).toBeNull();
    expect(conn.getLatestDialog(20)).not.toBeNull();
  });
});
