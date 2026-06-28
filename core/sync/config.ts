import type { SyncConfig } from '../types';

const CONFIG_KEY = 'deepseek_pp_sync_config';
const PROVIDERS = new Set(['webdav', 'google_drive', 'onedrive']);

export async function getSyncConfig(): Promise<SyncConfig | null> {
  const data = await chrome.storage.local.get(CONFIG_KEY) as Record<string, unknown>;
  return normalizeSyncConfig(data[CONFIG_KEY]);
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: normalizeSyncConfig(config) ?? normalizeSyncConfig({}) });
}

export function normalizeSyncConfig(value: unknown): SyncConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const provider = typeof object.provider === 'string' && PROVIDERS.has(object.provider)
    ? object.provider as SyncConfig['provider']
    : 'webdav';

  return {
    provider,
    url: provider === 'webdav' ? optionalString(object.url) : '',
    username: provider === 'webdav' ? optionalString(object.username) : '',
    password: provider === 'webdav' ? optionalString(object.password) : '',
    remotePath: optionalString(object.remotePath) || 'DeepSeekPP',
    ...(provider === 'webdav' ? {} : { oauth: normalizeOAuthConfig(object.oauth) }),
    lastSyncAt: typeof object.lastSyncAt === 'number' && Number.isFinite(object.lastSyncAt)
      ? object.lastSyncAt
      : null,
  };
}

export function requireWebDavSyncConfig(config: SyncConfig): SyncConfig {
  const provider = config.provider ?? 'webdav';
  if (provider !== 'webdav') {
    throw new Error(`Sync provider ${provider} is not available in this build.`);
  }
  return config;
}

function normalizeOAuthConfig(value: unknown): NonNullable<SyncConfig['oauth']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { accountId: '', displayName: '', tokenRef: null };
  }
  const object = value as Record<string, unknown>;
  return {
    accountId: optionalString(object.accountId),
    displayName: optionalString(object.displayName),
    tokenRef: optionalNullableString(object.tokenRef),
    ...(object.driveId === undefined ? {} : { driveId: optionalNullableString(object.driveId) }),
    ...(object.folderId === undefined ? {} : { folderId: optionalNullableString(object.folderId) }),
  };
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return optionalString(value) || null;
}
