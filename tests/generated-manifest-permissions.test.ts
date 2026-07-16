import { describe, expect, it } from 'vitest';
import type { ConfigEnv, TargetBrowser } from 'wxt';
import { createManifest } from '../wxt.config';

const CHROMIUM_PERMISSIONS = [
  'storage',
  'alarms',
  'nativeMessaging',
  'contextMenus',
  'offscreen',
  'debugger',
  'tabs',
  'identity',
  'scripting',
  'cookies',
  'webRequest',
  'sidePanel',
];

const HOST_PERMISSIONS = [
  '*://chat.deepseek.com/*',
  'https://api.deepseek.com/*',
  'https://chat.qwen.ai/*',
  'https://*.aliyuncs.com/*',
  '*://cn.bing.com/*',
  '*://www.bing.com/*',
  'http://127.0.0.1:8787/*',
  'http://localhost:8787/*',
  'https://accounts.google.com/*',
  'https://oauth2.googleapis.com/*',
  'https://www.googleapis.com/*',
  'https://login.microsoftonline.com/*',
  'https://graph.microsoft.com/*',
];

const FIREFOX_PERMISSIONS = [
  'storage',
  'alarms',
  'nativeMessaging',
  'contextMenus',
  'identity',
];

describe('generated PC browser manifest permissions', () => {
  it('grants Chromium auth capture permissions and Firefox cloud-sync identity', () => {
    expect(manifestPermissions('chrome')).toEqual(CHROMIUM_PERMISSIONS);
    expect(manifestPermissions('edge')).toEqual(CHROMIUM_PERMISSIONS);
    expect(manifestPermissions('firefox')).toEqual(FIREFOX_PERMISSIONS);
  });

  it('declares the fixed provider and loopback hosts on every supported browser', () => {
    for (const browser of ['chrome', 'edge', 'firefox'] as const) {
      expect(manifestHostPermissions(browser)).toEqual(HOST_PERMISSIONS);
    }
  });

  it('does not infer or declare downloads for any supported browser', () => {
    for (const browser of ['chrome', 'edge', 'firefox'] as const) {
      expect(manifestPermissions(browser)).not.toContain('downloads');
    }
  });
});

function manifestPermissions(browser: TargetBrowser): string[] {
  return createManifest(createBuildEnvironment(browser)).permissions ?? [];
}

function manifestHostPermissions(browser: TargetBrowser): string[] {
  return createManifest(createBuildEnvironment(browser)).host_permissions ?? [];
}

function createBuildEnvironment(browser: TargetBrowser): ConfigEnv {
  return {
    mode: 'production',
    command: 'build',
    browser,
    manifestVersion: 3,
  };
}
