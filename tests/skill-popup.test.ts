import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('skill popup startup', () => {
  it('does not observe a null body when initialized at document_start', async () => {
    document.body.remove();
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const { initSkillPopup } = await import('../core/ui/skill-popup');

    expect(() => initSkillPopup([{ name: 'review', description: 'Review the current chat.' }]))
      .not.toThrow();

    expect(observe).toHaveBeenCalledWith(document.documentElement, { childList: true, subtree: true });
  });
});
