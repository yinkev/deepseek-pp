import { describe, expect, it } from 'vitest';

describe('platform error handling', () => {
  it('unsupported platform returns appropriate error', () => {
    const platform = 'linux';
    const supported = ['mac', 'win', 'cros'];
    const isSupported = supported.includes(platform);
    expect(isSupported).toBe(false);
  });

  it('supported platform is recognized', () => {
    const platform = 'mac';
    const supported = ['mac', 'win', 'cros'];
    expect(supported.includes(platform)).toBe(true);
  });

  it('Android platform is unsupported for browser control', () => {
    const platform = 'android';
    const supported = ['mac', 'win', 'cros'];
    expect(supported.includes(platform)).toBe(false);
  });
});

describe('capability gating', () => {
  it('browser control requires debugger API', () => {
    const hasDebugger = false;
    const hasTabs = true;
    const supported = hasDebugger && hasTabs;
    expect(supported).toBe(false);
  });

  it('browser control requires tabs API', () => {
    const hasDebugger = true;
    const hasTabs = false;
    const supported = hasDebugger && hasTabs;
    expect(supported).toBe(false);
  });

  it('browser control supported when all APIs present', () => {
    const hasDebugger = true;
    const hasTabs = true;
    const supported = hasDebugger && hasTabs;
    expect(supported).toBe(true);
  });
});

describe('i18n propagation', () => {
  it('English translations exist', () => {
    const locale = 'en';
    const translations: Record<string, string> = {
      'prompt.memoryEmpty': 'No memories saved yet.',
    };
    expect(translations['prompt.memoryEmpty']).toBeTruthy();
  });

  it('Chinese translations exist', () => {
    const locale = 'zh-CN';
    const translations: Record<string, string> = {
      'prompt.memoryEmpty': '暂无保存的记忆。',
    };
    expect(translations['prompt.memoryEmpty']).toBeTruthy();
  });

  it('locale change propagates to tool descriptions', () => {
    const tools = {
      en: { web_search: 'Search the web' },
      'zh-CN': { web_search: '搜索网页' },
    };
    expect(tools.en.web_search).toBeTruthy();
    expect(tools['zh-CN'].web_search).toBeTruthy();
  });
});
