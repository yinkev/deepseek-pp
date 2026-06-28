import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BrowserConnection, BrowserControlError, toBrowserControlError } from '../core/browser-control/cdp';

function createMockChrome() {
  let attachedTabId: number | null = null;
  const detachListeners: Array<(source: chrome.debugger.Debuggee, reason: string) => void> = [];
  const eventListeners: Array<(source: chrome.debugger.Debuggee, method: string, params?: unknown) => void> = [];

  return {
    _attachedTabId: () => attachedTabId,
    _emitDetach(source: chrome.debugger.Debuggee, reason: string) {
      if (source.tabId === attachedTabId) attachedTabId = null;
      for (const fn of detachListeners) fn(source, reason);
    },
    _emitEvent(source: chrome.debugger.Debuggee, method: string, params?: unknown) {
      for (const fn of eventListeners) fn(source, method, params);
    },
    debugger: {
      attach: vi.fn(async (source: chrome.debugger.Debuggee) => {
        attachedTabId = source.tabId ?? null;
      }),
      detach: vi.fn(async (source: chrome.debugger.Debuggee) => {
        if (source.tabId === attachedTabId) attachedTabId = null;
      }),
      sendCommand: vi.fn(async () => ({})),
      onDetach: {
        addListener: vi.fn((fn: (source: chrome.debugger.Debuggee, reason: string) => void) => {
          detachListeners.push(fn);
        }),
      },
      onEvent: {
        addListener: vi.fn((fn: (source: chrome.debugger.Debuggee, method: string, params?: unknown) => void) => {
          eventListeners.push(fn);
        }),
      },
    },
    tabs: {
      query: vi.fn(async () => []),
      get: vi.fn(async () => ({})),
    },
  } as unknown as typeof chrome & {
    _emitDetach: (source: chrome.debugger.Debuggee, reason: string) => void;
    _emitEvent: (source: chrome.debugger.Debuggee, method: string, params?: unknown) => void;
    _attachedTabId: () => number | null;
  };
}

describe('BrowserConnection attach/detach lifecycle', () => {
  let chromeStub: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    chromeStub = createMockChrome();
  });

  it('sets tabId and attached after attach', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    expect(conn.attached).toBe(false);
    expect(conn.tabId).toBeNull();

    await conn.attach(42);

    expect(conn.attached).toBe(true);
    expect(conn.tabId).toBe(42);
  });

  it('enables Runtime, Page, DOM, Accessibility, and Target on attach', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);

    const calls = (chromeStub.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls;
    const methods = calls.map((c: unknown[]) => c[1]);
    expect(methods).toContain('Runtime.enable');
    expect(methods).toContain('Page.enable');
    expect(methods).toContain('DOM.enable');
    expect(methods).toContain('Accessibility.enable');
    expect(methods).toContain('Target.setAutoAttach');
  });

  it('clears tabId and attached after detach', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);
    expect(conn.attached).toBe(true);

    await conn.detach();
    expect(conn.attached).toBe(false);
    expect(conn.tabId).toBeNull();
  });

  it('detach is idempotent when not attached', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.detach();
    expect(conn.attached).toBe(false);
    expect(chromeStub.debugger.detach).not.toHaveBeenCalled();
  });

  it('detach ignores "not attached" errors', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);
    (chromeStub.debugger.detach as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('No tab with id 10. Maybe it was closed?'),
    );
    await expect(conn.detach()).resolves.toBeUndefined();
  });

  it('detach rethrows unexpected errors', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);
    (chromeStub.debugger.detach as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Unexpected failure'),
    );
    await expect(conn.detach()).rejects.toThrow('Unexpected failure');
  });

  it('attach detaches previous tab before attaching new one', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);
    await conn.attach(20);

    expect(conn.tabId).toBe(20);
    expect(chromeStub.debugger.detach).toHaveBeenCalled();
  });

  it('attach is idempotent for same tabId', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);
    (chromeStub.debugger.attach as ReturnType<typeof vi.fn>).mockClear();

    await conn.attach(10);
    expect(chromeStub.debugger.attach).not.toHaveBeenCalled();
    expect(conn.tabId).toBe(10);
  });
});

describe('BrowserConnection sendCommand', () => {
  let chromeStub: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    chromeStub = createMockChrome();
  });

  it('throws when not attached', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await expect(conn.sendCommand('Runtime.evaluate')).rejects.toMatchObject({
      code: 'browser_control_not_attached',
      retryable: true,
    });
  });

  it('returns result from debugger', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);
    (chromeStub.debugger.sendCommand as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      result: { type: 'string', value: 'hello' },
    });

    const result = await conn.sendCommand<{ result: { value: string } }>('Runtime.evaluate');
    expect(result.result.value).toBe('hello');
  });

  it('returns empty object when debugger returns null', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);
    (chromeStub.debugger.sendCommand as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const result = await conn.sendCommand('Page.enable');
    expect(result).toEqual({});
  });
});

describe('BrowserConnection dialog handling', () => {
  let chromeStub: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    chromeStub = createMockChrome();
  });

  it('getLatestDialog returns null initially', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    expect(conn.getLatestDialog(10)).toBeNull();
  });

  it('stores dialog after Page.javascriptDialogOpening event', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);

    chromeStub._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'alert',
      message: 'Hello',
    });

    const dialog = conn.getLatestDialog(10);
    expect(dialog).toMatchObject({
      type: 'alert',
      message: 'Hello',
    });
    expect(typeof dialog?.seenAt).toBe('number');
  });

  it('stores defaultPrompt when present', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);

    chromeStub._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'prompt',
      message: 'Enter value',
      defaultPrompt: 'default',
    });

    expect(conn.getLatestDialog(10)).toMatchObject({
      type: 'prompt',
      message: 'Enter value',
      defaultPrompt: 'default',
    });
  });

  it('defaultPrompt is undefined when not in event', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);

    chromeStub._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'confirm',
      message: 'Proceed?',
    });

    expect(conn.getLatestDialog(10)?.defaultPrompt).toBeUndefined();
  });

  it('clearDialog removes dialog state', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);
    chromeStub._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'alert',
      message: 'Test',
    });

    conn.clearDialog(10);
    expect(conn.getLatestDialog(10)).toBeNull();
  });

  it('clearDialog is idempotent for missing tabId', () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    expect(() => conn.clearDialog(999)).not.toThrow();
  });

  it('new dialog for same tab replaces previous', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);

    chromeStub._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'alert',
      message: 'First',
    });
    chromeStub._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'confirm',
      message: 'Second',
    });

    const dialog = conn.getLatestDialog(10);
    expect(dialog?.type).toBe('confirm');
    expect(dialog?.message).toBe('Second');
  });

  it('multiple dialogs for different tabs are independent', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);

    chromeStub._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'alert',
      message: 'Tab 10',
    });
    chromeStub._emitEvent({ tabId: 20 }, 'Page.javascriptDialogOpening', {
      type: 'confirm',
      message: 'Tab 20',
    });

    expect(conn.getLatestDialog(10)?.message).toBe('Tab 10');
    expect(conn.getLatestDialog(20)?.message).toBe('Tab 20');
  });

  it('dialog type defaults to "dialog" when not provided', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);

    chromeStub._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      message: 'No type',
    });

    expect(conn.getLatestDialog(10)?.type).toBe('dialog');
  });

  it('dialog message defaults to empty string when not provided', async () => {
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome);
    await conn.attach(10);

    chromeStub._emitEvent({ tabId: 10 }, 'Page.javascriptDialogOpening', {
      type: 'alert',
    });

    expect(conn.getLatestDialog(10)?.message).toBe('');
  });
});

describe('BrowserConnection event callbacks', () => {
  let chromeStub: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    chromeStub = createMockChrome();
  });

  it('onInvalidated fires on debugger detach', async () => {
    const onInvalidated = vi.fn();
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome, { onInvalidated });
    await conn.attach(10);

    chromeStub._emitDetach({ tabId: 10 }, 'target_closed');

    expect(onInvalidated).toHaveBeenCalledWith('debugger_detached', 10);
    expect(conn.attached).toBe(false);
  });

  it('onInvalidated fires on Page.frameNavigated event', async () => {
    const onInvalidated = vi.fn();
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome, { onInvalidated });
    await conn.attach(10);

    chromeStub._emitEvent({ tabId: 10 }, 'Page.frameNavigated', {});

    expect(onInvalidated).toHaveBeenCalledWith('Page.frameNavigated', 10);
  });

  it('onInvalidated fires on Page.navigatedWithinDocument', async () => {
    const onInvalidated = vi.fn();
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome, { onInvalidated });
    await conn.attach(10);

    chromeStub._emitEvent({ tabId: 10 }, 'Page.navigatedWithinDocument', {});

    expect(onInvalidated).toHaveBeenCalledWith('Page.navigatedWithinDocument', 10);
  });

  it('onInvalidated does not fire for non-matching tab', async () => {
    const onInvalidated = vi.fn();
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome, { onInvalidated });
    await conn.attach(10);

    chromeStub._emitDetach({ tabId: 20 }, 'target_closed');

    expect(onInvalidated).not.toHaveBeenCalled();
  });

  it('onInvalidated does not fire for non-page events', async () => {
    const onInvalidated = vi.fn();
    const conn = new BrowserConnection(chromeStub as unknown as typeof chrome, { onInvalidated });
    await conn.attach(10);

    chromeStub._emitEvent({ tabId: 10 }, 'Runtime.consoleAPICalled', {});

    expect(onInvalidated).not.toHaveBeenCalled();
  });
});

describe('BrowserControlError', () => {
  it('stores code, message, retryable, and details', () => {
    const error = new BrowserControlError('test_code', 'test message', {
      retryable: true,
      details: { key: 'value' },
    });

    expect(error.code).toBe('test_code');
    expect(error.message).toBe('test message');
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ key: 'value' });
    expect(error.name).toBe('BrowserControlError');
  });

  it('defaults retryable to false', () => {
    const error = new BrowserControlError('code', 'msg');
    expect(error.retryable).toBe(false);
  });
});

describe('toBrowserControlError', () => {
  it('passes through BrowserControlError instances', () => {
    const original = new BrowserControlError('code', 'msg', { retryable: true });
    expect(toBrowserControlError(original)).toBe(original);
  });

  it('wraps non-BrowserControlError errors', () => {
    const wrapped = toBrowserControlError(new Error('something broke'));
    expect(wrapped).toBeInstanceOf(BrowserControlError);
    expect(wrapped.code).toBe('browser_control_failed');
    expect(wrapped.message).toBe('something broke');
  });

  it('detects retryable messages: Cannot access', () => {
    expect(toBrowserControlError(new Error('Cannot access chrome tab')).retryable).toBe(true);
  });

  it('detects retryable messages: No tab with id', () => {
    expect(toBrowserControlError(new Error('No tab with id 123')).retryable).toBe(true);
  });

  it('detects retryable messages: not attached', () => {
    expect(toBrowserControlError(new Error('Debugger is not attached')).retryable).toBe(true);
  });

  it('detects retryable messages: detached', () => {
    expect(toBrowserControlError(new Error('Target was detached')).retryable).toBe(true);
  });

  it('detects retryable messages: target closed', () => {
    expect(toBrowserControlError(new Error('target closed')).retryable).toBe(true);
  });

  it('non-retryable messages default to retryable:false', () => {
    expect(toBrowserControlError(new Error('Random error')).retryable).toBe(false);
  });

  it('handles string errors', () => {
    const wrapped = toBrowserControlError('string error');
    expect(wrapped.message).toBe('string error');
  });
});
