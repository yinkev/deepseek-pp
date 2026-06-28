import { describe, expect, it } from 'vitest';
import { normalizeBrowserControlSettings } from '../core/browser-control/settings';

describe('normalizeBrowserControlSettings target lock', () => {
  it('returns null targetLock for null input', () => {
    expect(normalizeBrowserControlSettings({ targetLock: null }).targetLock).toBeNull();
  });

  it('returns null targetLock for non-object input', () => {
    expect(normalizeBrowserControlSettings({ targetLock: 'bad' }).targetLock).toBeNull();
    expect(normalizeBrowserControlSettings({ targetLock: 123 }).targetLock).toBeNull();
    expect(normalizeBrowserControlSettings({ targetLock: [] }).targetLock).toBeNull();
  });

  it('returns null targetLock when origin is empty', () => {
    expect(
      normalizeBrowserControlSettings({
        targetLock: { enabled: true, origin: '', label: 'Test' },
      }).targetLock,
    ).toBeNull();
  });

  it('returns null targetLock when origin exceeds 240 chars', () => {
    const longOrigin = 'https://example.com/' + 'a'.repeat(240);
    expect(
      normalizeBrowserControlSettings({
        targetLock: { enabled: true, origin: longOrigin },
      }).targetLock,
    ).toBeNull();
  });

  it('truncates label to 40 characters', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: {
        enabled: true,
        label: 'This is a very long label that exceeds forty characters limit',
        origin: 'https://example.com',
      },
    });
    expect(settings.targetLock?.label).toHaveLength(40);
    expect(settings.targetLock?.label).toBe('This is a very long label that exceeds f');
  });

  it('defaults label to Dev++ when empty', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: { enabled: true, origin: 'https://example.com', label: '' },
    });
    expect(settings.targetLock?.label).toBe('Dev++');
  });

  it('defaults label to Dev++ when not provided', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: { enabled: true, origin: 'https://example.com' },
    });
    expect(settings.targetLock?.label).toBe('Dev++');
  });

  it('normalizes updatedAt to integer', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: { enabled: true, origin: 'https://example.com', updatedAt: 123.9 },
    });
    expect(settings.targetLock?.updatedAt).toBe(123);
  });

  it('updatedAt defaults to 0 for non-numeric', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: { enabled: true, origin: 'https://example.com', updatedAt: 'bad' },
    });
    expect(settings.targetLock?.updatedAt).toBe(0);
  });

  it('updatedAt defaults to 0 for negative values', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: { enabled: true, origin: 'https://example.com', updatedAt: -5 },
    });
    expect(settings.targetLock?.updatedAt).toBe(0);
  });

  it('preserves valid targetLock fields', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: {
        enabled: true,
        label: 'My Lock',
        targetTabId: 42,
        windowId: 7,
        groupId: 3,
        origin: 'https://example.com',
        updatedAt: 1000,
      },
    });
    expect(settings.targetLock).toEqual({
      enabled: true,
      label: 'My Lock',
      targetTabId: 42,
      windowId: 7,
      windowHint: null,
      groupId: 3,
      origin: 'https://example.com',
      updatedAt: 1000,
    });
  });

  it('handles disabled lock (enabled:false)', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: { enabled: false, origin: 'https://example.com' },
    });
    expect(settings.targetLock?.enabled).toBe(false);
  });

  it('enabled defaults to true when not provided', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: { origin: 'https://example.com' },
    });
    expect(settings.targetLock?.enabled).toBe(true);
  });

  it('normalizes windowHint within lock', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: {
        enabled: true,
        origin: 'https://example.com',
        windowHint: { left: 100.5, top: 200.9, width: 800, height: 600, state: 'normal' },
      },
    });
    expect(settings.targetLock?.windowHint).toEqual({
      left: 101,
      top: 201,
      width: 800,
      height: 600,
      state: 'normal',
    });
  });

  it('nullifies invalid windowHint', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: {
        enabled: true,
        origin: 'https://example.com',
        windowHint: 'bad',
      },
    });
    expect(settings.targetLock?.windowHint).toBeNull();
  });

  it('normalizes targetTabId to integer or null', () => {
    expect(
      normalizeBrowserControlSettings({
        targetLock: { enabled: true, origin: 'https://example.com', targetTabId: 12.5 },
      }).targetLock?.targetTabId,
    ).toBeNull();

    expect(
      normalizeBrowserControlSettings({
        targetLock: { enabled: true, origin: 'https://example.com', targetTabId: 12 },
      }).targetLock?.targetTabId,
    ).toBe(12);
  });

  it('normalizes groupId to integer or null', () => {
    expect(
      normalizeBrowserControlSettings({
        targetLock: { enabled: true, origin: 'https://example.com', groupId: 'bad' },
      }).targetLock?.groupId,
    ).toBeNull();

    expect(
      normalizeBrowserControlSettings({
        targetLock: { enabled: true, origin: 'https://example.com', groupId: 5 },
      }).targetLock?.groupId,
    ).toBe(5);
  });

  it('normalizes windowId to integer or null', () => {
    expect(
      normalizeBrowserControlSettings({
        targetLock: { enabled: true, origin: 'https://example.com', windowId: NaN },
      }).targetLock?.windowId,
    ).toBeNull();

    expect(
      normalizeBrowserControlSettings({
        targetLock: { enabled: true, origin: 'https://example.com', windowId: 3 },
      }).targetLock?.windowId,
    ).toBe(3);
  });

  it('handles extra unknown fields gracefully', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: {
        enabled: true,
        origin: 'https://example.com',
        unknownField: 'should be ignored',
        anotherField: 42,
      },
    });
    expect(settings.targetLock).toBeDefined();
    expect(settings.targetLock?.origin).toBe('https://example.com');
  });

  it('strips whitespace from origin', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: { enabled: true, origin: '  https://example.com  ' },
    });
    expect(settings.targetLock?.origin).toBe('https://example.com');
  });

  it('origin with exactly 240 chars is valid', () => {
    const origin = 'https://example.com/' + 'a'.repeat(220);
    expect(origin).toHaveLength(240);
    const settings = normalizeBrowserControlSettings({
      targetLock: { enabled: true, origin },
    });
    expect(settings.targetLock?.origin).toBe(origin);
  });

  it('windowHint state must match pattern', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: {
        enabled: true,
        origin: 'https://example.com',
        windowHint: { left: 0, top: 0, width: 100, height: 100, state: 'INVALID STATE!' },
      },
    });
    expect(settings.targetLock?.windowHint?.state).toBeNull();
  });

  it('windowHint state with valid pattern is preserved', () => {
    const settings = normalizeBrowserControlSettings({
      targetLock: {
        enabled: true,
        origin: 'https://example.com',
        windowHint: { left: 0, top: 0, width: 100, height: 100, state: 'maximized' },
      },
    });
    expect(settings.targetLock?.windowHint?.state).toBe('maximized');
  });
});
