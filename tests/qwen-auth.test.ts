import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QWEN_AUTH_STORAGE_KEY,
  loadQwenCachedAuth,
  mergeQwenAuthCapture,
  qwenAuthCaptureFromHeaders,
  refreshQwenAuthFromBrowser,
  saveQwenCachedAuth,
} from '../core/qwen/auth';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          storage = { ...storage, ...value };
        }),
      },
    },
  });
});

describe('Qwen cached browser authentication', () => {
  it('captures the real Qwen request headers case-insensitively', () => {
    expect(qwenAuthCaptureFromHeaders([
      { name: 'authorization', value: 'Bearer jwt-value' },
      { name: 'version', value: '0.2.63' },
      { name: 'BX-UMIDTOKEN', value: 'umid-value' },
      { name: 'bx-ua', value: 'ua-value' },
      { name: 'cookie', value: 'token=cookie-value' },
    ])).toEqual({
      authorization: 'Bearer jwt-value',
      version: '0.2.63',
      bxUmidToken: 'umid-value',
      bxUa: 'ua-value',
    });
  });

  it('merges fresh page login state with previously captured Baxia state', () => {
    expect(mergeQwenAuthCapture(
      {
        authorization: 'Bearer old-token',
        version: '0.2.63',
        bxUmidToken: 'saved-umid',
        bxUa: 'saved-ua',
      },
      { authorization: 'new-token' },
    )).toEqual({
      authorization: 'Bearer new-token',
      version: '0.2.63',
      bxUmidToken: 'saved-umid',
      bxUa: 'saved-ua',
    });
  });

  it('persists and reloads auth from chrome.storage.local', async () => {
    await saveQwenCachedAuth({
      authorization: 'Bearer jwt-value',
      version: '0.2.63',
      bxUmidToken: 'umid-value',
    });

    expect(storage[QWEN_AUTH_STORAGE_KEY]).toMatchObject({
      authorization: 'Bearer jwt-value',
      version: '0.2.63',
      bxUmidToken: 'umid-value',
    });
    await expect(loadQwenCachedAuth()).resolves.toEqual({
      authorization: 'Bearer jwt-value',
      version: '0.2.63',
      bxUmidToken: 'umid-value',
    });
  });

  it('refreshes from page login state while reading the real Qwen cookie jar', async () => {
    const result = await refreshQwenAuthFromBrowser({
      readPageCapture: async () => ({ authorization: 'page-jwt', version: '0.2.64' }),
      readCookies: async () => [
        { name: 'token', value: 'cookie-jwt' },
        { name: 'ssxmod_itna', value: 'session-cookie' },
      ],
    });

    expect(result).toEqual({
      auth: { authorization: 'Bearer page-jwt', version: '0.2.64' },
      cookieCount: 2,
      hasBaxiaCookies: true,
    });
    await expect(loadQwenCachedAuth()).resolves.toEqual(result.auth);
  });

  it('uses the Qwen token cookie when page localStorage is unavailable', async () => {
    const result = await refreshQwenAuthFromBrowser({
      readPageCapture: async () => null,
      readCookies: async () => [{ name: 'token', value: 'cookie-jwt' }],
    });

    expect(result.auth).toMatchObject({ authorization: 'Bearer cookie-jwt' });
  });
});
