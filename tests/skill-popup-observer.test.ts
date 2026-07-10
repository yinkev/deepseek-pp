import { afterEach, describe, expect, it, vi } from 'vitest';

describe('skill-popup MutationObserver target', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('does not call observe with a non-Node when body is missing', async () => {
    const observe = vi.fn();
    class FakeMutationObserver {
      callback: MutationCallback;
      constructor(cb: MutationCallback) {
        this.callback = cb;
      }
      observe = observe;
      disconnect() {}
      takeRecords(): MutationRecord[] { return []; }
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver);

    // Simulate document without body by temporarily removing body reference via spy
    const bodyDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'body')
      ?? Object.getOwnPropertyDescriptor(document, 'body');
    Object.defineProperty(document, 'body', {
      configurable: true,
      get: () => null,
    });

    try {
      const { initSkillPopup } = await import('../core/ui/skill-popup');
      expect(() => initSkillPopup([{ name: 'demo', description: 'd' }])).not.toThrow();
      // Should observe documentElement instead of throwing
      expect(observe).toHaveBeenCalled();
      const target = observe.mock.calls[0]?.[0];
      expect(target).toBeTruthy();
      expect(target).not.toBeNull();
      expect(target.nodeType).toBeDefined();
    } finally {
      if (bodyDesc) {
        Object.defineProperty(document, 'body', bodyDesc);
      } else {
        // restore default
        Object.defineProperty(document, 'body', {
          configurable: true,
          get: () => document.getElementsByTagName('body')[0] ?? null,
        });
      }
    }
  });
});
