import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
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

  it('does not leak observer TypeErrors from main-world reload timing', async () => {
    vi.useFakeTimers();
    const observe = vi.spyOn(MutationObserver.prototype, 'observe')
      .mockImplementationOnce(() => {
        throw new TypeError("Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.");
      });
    const { initSkillPopup } = await import('../core/ui/skill-popup');

    expect(() => initSkillPopup([{ name: 'review', description: 'Review the current chat.' }]))
      .not.toThrow();

    expect(observe).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50);

    expect(observe).toHaveBeenCalledTimes(2);
  });
});
