import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSyncConfig, requireWebDavSyncConfig, saveSyncConfig } from '../core/sync/config';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sync config provider shape', () => {
  it('normalizes legacy WebDAV config without requiring a provider field', async () => {
    await saveSyncConfig({
      url: ' https://dav.example/root/ ',
      username: ' user ',
      password: ' pass ',
      remotePath: ' DeepSeekPP ',
      lastSyncAt: null,
    });

    await expect(getSyncConfig()).resolves.toEqual({
      provider: 'webdav',
      url: 'https://dav.example/root/',
      username: 'user',
      password: 'pass',
      remotePath: 'DeepSeekPP',
      lastSyncAt: null,
    });
  });

  it('accepts Google Drive and OneDrive-style OAuth config without storing token material inline', async () => {
    await saveSyncConfig({
      provider: 'google_drive',
      url: '',
      username: '',
      password: 'should-not-be-used',
      remotePath: 'DeepSeekPP',
      oauth: {
        accountId: 'user@example.com',
        displayName: 'User Drive',
        tokenRef: 'chrome-storage-token-id',
        driveId: 'drive-1',
        folderId: 'folder-1',
      },
      lastSyncAt: 123,
    });

    await expect(getSyncConfig()).resolves.toEqual({
      provider: 'google_drive',
      url: '',
      username: '',
      password: '',
      remotePath: 'DeepSeekPP',
      oauth: {
        accountId: 'user@example.com',
        displayName: 'User Drive',
        tokenRef: 'chrome-storage-token-id',
        driveId: 'drive-1',
        folderId: 'folder-1',
      },
      lastSyncAt: 123,
    });
  });

  it('keeps WebDAV operations behind the WebDAV provider', () => {
    expect(() => requireWebDavSyncConfig({
      provider: 'onedrive',
      url: '',
      username: '',
      password: '',
      remotePath: 'DeepSeekPP',
      oauth: { accountId: 'user', displayName: 'OneDrive', tokenRef: 'token-ref' },
      lastSyncAt: null,
    })).toThrow('Sync provider onedrive is not available in this build.');
  });
});
