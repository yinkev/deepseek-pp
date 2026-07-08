import { readFileSync } from 'node:fs';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localeResources } from '../core/i18n';
import App from '../entrypoints/sidepanel/App';
import LibraryPage from '../entrypoints/sidepanel/pages/LibraryPage';
import CapabilitiesPage from '../entrypoints/sidepanel/pages/CapabilitiesPage';
import SettingsPage from '../entrypoints/sidepanel/pages/SettingsPage';
import SkillPage from '../entrypoints/sidepanel/pages/SkillPage';

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;

  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: vi.fn(() => ({ version: '0.7.0' })),
      sendMessage: vi.fn(async (message: { type?: string }) => {
        if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web' };
        if (message.type === 'GET_VOICE_SETTINGS') return {};
        if (message.type === 'GET_USAGE_SUMMARY') return createUsageSummary();
        if (message.type === 'CLEAR_USAGE_STATS') return { ok: true };
        return null;
      }),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (
          key === 'deepseek_pp_chat_enabled'
            ? { deepseek_pp_chat_enabled: true }
            : {}
        )),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
});

describe('sidepanel navigation', () => {
  it('opens fresh sidepanel sessions on Ask while keeping Mission one click away', async () => {
    const sendMessage = chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessage.mockImplementation(async (message: { type?: string }) => {
      if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web', hasToken: true };
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return { config: {} };
      if (message.type === 'GET_USAGE_SUMMARY') return createUsageSummary();
      return null;
    });

    await renderApp();

    const activeNav = container.querySelector('.ds-v2-nav-button-active');
    expect(activeNav?.textContent).toBe('提问');
    expect(activeNav?.getAttribute('aria-current')).toBe('page');
    expect(navButtonLabels('主导航')).toEqual(['提问', '项目', '上下文', '任务', '活动', '复核']);
    expect(Array.from(container.querySelectorAll('nav[aria-label="主导航"] button')).every(
      (button) => button.getAttribute('data-slot') === 'button',
    )).toBe(true);
    expect(container.querySelector('button[aria-label="提问"]')?.getAttribute('data-slot')).toBe('button');
    expect(container.querySelector('button[aria-label="打开导航菜单"]')?.getAttribute('data-variant')).toBe('outline');
    await waitForText('询问 DeepSeek++');
    expect(container.textContent).toContain('询问 DeepSeek++');
    expect(container.querySelector('textarea[aria-label="给 DeepSeek++ 发送消息"]')).toBeTruthy();
    expect(container.querySelector('.ds-cockpit-mission-strip')).toBeNull();

    const missionNav = Array.from(container.querySelectorAll('nav[aria-label="主导航"] button'))
      .find((button) => button.textContent === '任务') as HTMLButtonElement | undefined;
    expect(missionNav).toBeTruthy();
    await act(async () => {
      missionNav!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flushApp();
    expect(container.textContent).toContain('任务');
    await waitForText('当前没有运行中的任务');
    expect(container.textContent).toContain('当前没有运行中的任务');
    expect(container.textContent).toContain('开始任务');

    const activityNav = Array.from(container.querySelectorAll('nav[aria-label="主导航"] button'))
      .find((button) => button.textContent === '活动') as HTMLButtonElement | undefined;
    expect(activityNav).toBeTruthy();
    await act(async () => {
      activityNav!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flushApp();
    await waitForText('活动');
    expect(activityNav?.getAttribute('aria-current')).toBe('page');

    const reviewNav = Array.from(container.querySelectorAll('nav[aria-label="主导航"] button'))
      .find((button) => button.textContent === '复核') as HTMLButtonElement | undefined;
    expect(reviewNav).toBeTruthy();
    await act(async () => {
      reviewNav!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flushApp();
    await waitForText('复核');
    expect(reviewNav?.getAttribute('aria-current')).toBe('page');
  });

  it('keeps memory/saved under Library and preset/automation under Capabilities', async () => {
    await renderApp();

    const topLabels = navButtonLabels('主导航');
    expect(topLabels).toEqual(['提问', '项目', '上下文', '任务', '活动', '复核']);
    expect(container.querySelector('.ds-v2-ask-button')).toBeNull();
    unmountRoot();
    await renderElement(React.createElement(SkillPage));
    await flushApp();
    expect(container.textContent).toContain('命令');
    expect(container.querySelector('nav[aria-label="能力子导航"]')).toBeNull();

    unmountRoot();
    await renderApp();
    const menuButton = container.querySelector('button[aria-label="打开导航菜单"]');
    expect(menuButton).toBeTruthy();
    await openNavigationMenu();
    expect(menuButton!.getAttribute('aria-controls')).toBe('ds-v2-menu-panel');
    const menu = getNavigationMenuPanel();
    expect(menu).toBeTruthy();
    expect(menu!.textContent).toContain('菜单');
    expect(menu!.textContent).toContain('最近');
    expect(menu!.textContent).toContain('工作区');
    expect(menu!.textContent).toContain('系统');
    expect(menu!.textContent).toContain('运行');
    expect(menu!.textContent).toContain('诊断');
    expect(menu!.textContent).toContain('配置');
    expect(menu!.textContent).toContain('提问');
    expect(menu!.textContent).toContain('上下文');
    expect(menu!.textContent).toContain('工作集');
    expect(menu!.textContent).toContain('活动');
    expect(menu!.textContent).toContain('复核');
    expect(menu!.textContent).toContain('命令');
    expect(menu!.textContent).toContain('项目');
    expect(menu!.textContent).toContain('资料库');
    expect(menu!.textContent).toContain('设置');
    expect(menu!.textContent).toContain('浏览器');
    expect(menu!.textContent).toContain('连接器');
    expect(menu!.textContent).toContain('页面工具');
    expect(menu!.textContent).toContain('健康');
    expect(menu!.textContent).toContain('预设');
    expect(menu!.textContent).toContain('自动化');
    expect(menu!.querySelector('[data-slot="command-input"]')).toBeTruthy();
    expect(menu!.querySelector('[data-slot="command-group"]')).toBeTruthy();
    expect(menu!.querySelector('[data-slot="command-item"]')).toBeTruthy();
    expect(localeResources['zh-CN'].app.sidebarV2.capabilitiesDetail).toBe('系统工具和运行控制');
    expect(localeResources['zh-CN'].app.sidebarV2.mcpDetail).toBe('已连接服务和动作');
    expect(container.textContent).not.toContain('命令、MCP');
    expect(container.textContent).not.toContain('MCP 服务');
    await pressFocusedKey('Escape');
    expect(getNavigationMenuPanel()).toBeNull();

    await openNavigationMenu();
    expect(getNavigationMenuPanel()?.textContent).toContain('页面工具');
    await pressFocusedKey('Escape');
    await flushAnimationFrame();
    expect(getNavigationMenuPanel()).toBeNull();
    expect(document.activeElement).toBe(menuButton);

    unmountRoot();
    await renderElement(React.createElement(LibraryPage, { onInsertPrompt: vi.fn() }));
    expect(navButtonLabels('资料子导航')).toEqual(['记忆', '保存']);
    const librarySubNav = container.querySelector('nav[aria-label="资料子导航"]');
    expect(librarySubNav?.querySelector('[data-slot="tabs"]')).toBeTruthy();
    expect(librarySubNav?.querySelector('[data-slot="tabs-list"]')?.getAttribute('aria-label')).toBe('资料子导航');
    const libraryTabs = Array.from(librarySubNav!.querySelectorAll<HTMLButtonElement>('[data-slot="tabs-trigger"]'));
    expect(libraryTabs.map((tab) => tab.textContent)).toEqual(['记忆', '保存']);
    expect(libraryTabs[0].getAttribute('data-state')).toBe('active');
    await act(async () => {
      libraryTabs[0].focus();
      libraryTabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await Promise.resolve();
    });
    await flushApp();
    expect(container.textContent).toContain('保存项');
    expect(libraryTabs[1].getAttribute('data-state')).toBe('active');

    unmountRoot();
    await renderElement(React.createElement(CapabilitiesPage));
    await expectWorkbenchSelectOptions('系统分区', ['自动化', '预设', '浏览器', '连接器', '页面工具', '健康']);
  });

  it('supports keyboard-only search and routing inside the command menu', async () => {
    await renderApp();

    const menuButton = container.querySelector('button[aria-label="打开导航菜单"]') as HTMLButtonElement | null;
    expect(menuButton).toBeTruthy();
    expect(menuButton?.getAttribute('aria-expanded')).toBe('false');

    await openNavigationMenu();
    await flushAnimationFrame();

    const menu = getNavigationMenuPanel();
    expect(menu).toBeTruthy();
    expect(menuButton?.getAttribute('aria-expanded')).toBe('true');
    const items = Array.from(menu!.querySelectorAll<HTMLElement>('.ds-v2-menu-item'));
    expect(items.map((item) => ({
      label: item.querySelector('.ds-v2-menu-item-label')?.textContent,
      detail: item.querySelector('.ds-v2-menu-item-detail')?.textContent,
    }))).toEqual([
      { label: '提问', detail: '输入框和当前会话' },
      { label: '项目', detail: '项目对话和记忆' },
      { label: '上下文', detail: 'DeepSeek++ 下一条对话可带入的内容' },
      { label: '工作集', detail: '目标、上下文和证据' },
      { label: '活动', detail: '任务证据和检查点' },
      { label: '复核', detail: '门禁、风险和复核状态' },
      { label: '命令', detail: '斜杠命令和来源' },
      { label: '资料库', detail: '记忆和保存 Prompt' },
      { label: '自动化', detail: '定时任务' },
      { label: '预设', detail: '可复用指令' },
      { label: '浏览器', detail: '目标标签页和视觉动作' },
      { label: '连接器', detail: '已连接服务和动作' },
      { label: '页面工具', detail: '网页搜索和页面工具' },
      { label: '健康', detail: '就绪检查' },
      { label: '设置', detail: '偏好和数据' },
    ]);

    const input = menu!.querySelector<HTMLInputElement>('[data-slot="command-input"]');
    expect(input).toBeTruthy();
    input!.focus();
    expect(document.activeElement).toBe(input);
    await setCommandSearch(input!, '健康');
    expect(getVisibleCommandItemLabels(menu!)).toEqual(['健康']);
    await pressFocusedKey('Enter');
    await flushApp();
    expect(getNavigationMenuPanel()).toBeNull();
    expect(container.textContent).toContain('健康');

    await openNavigationMenu();
    const reopened = getNavigationMenuPanel();
    const reopenedInput = reopened!.querySelector<HTMLInputElement>('[data-slot="command-input"]');
    expect(reopenedInput).toBeTruthy();
    reopenedInput!.focus();
    await setCommandSearch(reopenedInput!, 'zzzz-no-route');
    expect(reopened!.textContent).toContain('没有匹配的入口。');

    await pressFocusedKey('Escape');
    await flushAnimationFrame();
    expect(getNavigationMenuPanel()).toBeNull();
    expect(menuButton?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menuButton);
  });

  it('keeps Home reachable even when sidepanel chat execution is disabled', async () => {
    const storage = chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    storage.mockImplementation(async (key: string) => (
      key === 'deepseek_pp_chat_enabled'
        ? { deepseek_pp_chat_enabled: false }
        : {}
    ));
    const sendMessage = chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessage.mockImplementation(async (message: { type?: string }) => {
      if (message.type === 'GET_AUTH_STATUS') {
        return { available: false, provider: null, hasApiKey: false, hasToken: false };
      }
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return { config: {} };
      if (message.type === 'GET_USAGE_SUMMARY') return createUsageSummary();
      return null;
    });

    await renderApp();
    const brand = container.querySelector('button[aria-label="提问"]') as HTMLButtonElement | null;
    const askNav = Array.from(container.querySelectorAll('nav[aria-label="主导航"] button'))
      .find((button) => button.textContent === '提问') as HTMLButtonElement | undefined;
    expect(brand).toBeTruthy();
    expect(brand?.disabled).toBe(false);
    expect(askNav).toBeTruthy();

    await act(async () => {
      askNav!.click();
      await Promise.resolve();
    });
    await waitForText('侧边栏对话已关闭');
    expect(askNav?.classList.contains('ds-v2-nav-button-active')).toBe(true);
    expect(container.textContent).toContain('提问入口仍可打开');
    expect(container.textContent).not.toContain('Home 可以打开');
    expect(container.textContent).not.toContain('路线');
    expect(container.textContent).toContain('侧边栏对话');
    expect(container.textContent).toContain('关闭');
    expect(container.textContent).toContain('网页登录态');
    const setupCard = container.querySelector<HTMLElement>('.ds-chat-setup-card[data-state="disabled"]');
    expect(setupCard?.getAttribute('data-slot')).toBe('card');
    expect(setupCard?.querySelector('[data-slot="card-header"]')).toBeTruthy();
    expect(setupCard?.querySelector('[data-slot="card-title"]')?.textContent).toBe('侧边栏对话已关闭');
    expect(setupCard?.querySelector('[data-slot="card-description"]')?.textContent).toContain('提问入口仍可打开');
    expect(setupCard?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent).toBe('关闭');
    expect(setupCard?.querySelector('[data-slot="card-content"]')).toBeTruthy();
    expect(setupCard?.querySelectorAll('[data-slot="badge"]').length).toBeGreaterThanOrEqual(4);
    expect(setupCard?.querySelectorAll('[data-slot="button"]')).toHaveLength(2);

    unmountRoot();
    await renderApp();
    await openNavigationMenu();
    await clickButton('提问');
    await waitForText('侧边栏对话已关闭');

    expect(container.textContent).toContain('侧边栏对话已关闭');
    expect(container.textContent).toContain('网页登录态');
  });

  it('does not show the chat composer when sidepanel chat is disabled even if auth exists', async () => {
    const storage = chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    storage.mockImplementation(async (key: string) => (
      key === 'deepseek_pp_chat_enabled'
        ? { deepseek_pp_chat_enabled: false }
        : {}
    ));
    const sendMessage = chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessage.mockImplementation(async (message: { type?: string }) => {
      if (message.type === 'GET_AUTH_STATUS') {
        return { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true };
      }
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
      if (message.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return { config: {} };
      if (message.type === 'GET_USAGE_SUMMARY') return createUsageSummary();
      return null;
    });

    await renderApp();
    const brand = container.querySelector('button[aria-label="提问"]') as HTMLButtonElement | null;
    expect(brand).toBeTruthy();
    await act(async () => {
      brand!.click();
      await Promise.resolve();
    });
    await waitForText('侧边栏对话已关闭');

    expect(container.textContent).toContain('已登录');
    expect(container.textContent).toContain('开启侧边栏对话');
    expect(container.textContent).not.toContain('询问 DeepSeek++');
    expect(container.querySelector('textarea')).toBeNull();
    const setupCard = container.querySelector<HTMLElement>('.ds-chat-setup-card[data-state="disabled"]');
    expect(setupCard?.querySelector('[data-slot="button"]')?.textContent).toBe('开启侧边栏对话');

    await clickButton('开启侧边栏对话');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ deepseek_pp_chat_enabled: true });
  });

  it('keeps the voice settings surface reachable from Settings', async () => {
    await renderElement(React.createElement(SettingsPage));

    expect(getWorkbenchSelectTrigger('视图')).toBeTruthy();
    await expectWorkbenchSelectOptions('视图', [
      '通用',
      'API',
      '提示词',
      '语音',
      '外观',
      '用量',
      '数据',
      '关于',
    ]);
    const settingsOptions = await getWorkbenchSelectOptions('视图');
    expect(settingsOptions.findIndex((option) => option === '用量')).toBeLessThan(
      settingsOptions.findIndex((option) => option === '数据'),
    );

    await selectSettingsSubTab('voice');

    expect(container.textContent).toContain('语音');
    expect(container.textContent).toContain('语音输入');
    expect(container.textContent).toContain('朗读回复');
  });

  it('surfaces retryable Settings source failures instead of silently trusting defaults', async () => {
    const sendMessage = chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
    let recovered = false;
    sendMessage.mockImplementation(async (message: { type?: string }) => {
      if (message.type === 'GET_DEEPSEEK_API_KEY_STATUS') {
        if (!recovered) return { ok: false, error: 'api status offline' };
        return { configured: true };
      }
      if (message.type === 'GET_MEMORIES') {
        if (!recovered) throw new Error('memory storage offline');
        return [{ id: 'm1' }, { id: 'm2' }];
      }
      if (message.type === 'GET_MULTIMODAL_SETTINGS_STATUS') {
        return {
          ok: true,
          openaiConfigured: false,
          geminiConfigured: false,
          openaiImageModel: 'gpt-4.1-mini',
          geminiVideoModel: 'gemini-2.5-flash',
          openaiBaseUrl: 'https://api.openai.com/v1',
          geminiBaseUrl: 'https://generativelanguage.googleapis.com',
        };
      }
      if (message.type === 'GET_CONFIG') return { version: '0.7.0' };
      if (message.type === 'GET_SYNC_CONFIG') return null;
      if (message.type === 'GET_MODEL_TYPE') return null;
      if (message.type === 'GET_BACKGROUND') return null;
      if (message.type === 'GET_PET') return null;
      if (message.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return { config: {} };
      if (message.type === 'GET_VOICE_SETTINGS') return {};
      if (message.type === 'GET_USAGE_SUMMARY') return createUsageSummary();
      return null;
    });

    await renderElement(React.createElement(SettingsPage, { activeSubTab: 'api' }));
    await waitForText('设置需要刷新');

    expect(container.textContent).toContain('设置需要刷新');
    expect(container.textContent).toContain('DeepSeek API Key');
    expect(container.textContent).toContain('api status offline');
    expect(container.textContent).toContain('记忆');
    expect(container.textContent).toContain('memory storage offline');
    expect(container.textContent).toContain('未配置');

    recovered = true;
    await clickButton('重试');
    await waitForText('已配置');

    expect(container.textContent).not.toContain('设置需要刷新');
    expect(container.textContent).not.toContain('api status offline');
    expect(container.textContent).toContain('已配置');
  });

  it('routes workspace and system menu items to their real surfaces', async () => {
    await renderApp();

    await openNavigationMenu();
    await clickButton('资料库');
    await flushApp();
    expect(navButtonLabels('资料子导航')).toEqual(['记忆', '保存']);

    await openNavigationMenu();
    await clickButton('设置');
    await flushApp();
    expect(getWorkbenchSelectTrigger('视图')).toBeTruthy();

    await openNavigationMenu();
    await clickButton('浏览器');
    await flushApp();
    expect(getWorkbenchSelectTrigger('系统分区').textContent).toContain('浏览器');
    await expectWorkbenchSelectOptions('系统分区', ['自动化', '预设', '浏览器', '连接器', '页面工具', '健康']);
    expect(container.textContent).toContain('浏览器');
    await selectSystemCapabilitySubTab('automation');
    expect(container.textContent).toContain('自动化');
    await selectSystemCapabilitySubTab('preset');
    expect(container.textContent).toContain('给新的 DeepSeek 对话复用固定指令。');
    await selectSystemCapabilitySubTab('mcp');
    expect(container.textContent).toContain('连接器');
    await selectSystemCapabilitySubTab('tools');
    expect(container.textContent).toContain('页面工具');
    await selectSystemCapabilitySubTab('doctor');
    expect(container.textContent).toContain('健康');

    await openNavigationMenu();
    await clickButton('健康');
    await flushApp();
    expect(container.textContent).toContain('健康');
  });

  it('renders usage statistics from the Settings sub-navigation', async () => {
    await renderElement(React.createElement(SettingsPage));

    await selectSettingsSubTab('usage');

    expect(container.textContent).toContain('Tokens 用量');
    expect(container.textContent).toContain('DeepSeek Vision');
    expect(container.textContent).toContain('概览');
    expect(container.textContent).toContain('最近活动');
    expect(container.textContent).toContain('模型用量');
  });

  it('keeps the top navigation from shrinking behind long settings content', () => {
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const settingsPage = readFileSync('entrypoints/sidepanel/pages/SettingsPage.tsx', 'utf8');
    const shellBlock = getCssBlock(css, '.ds-v2-shell');
    const navBlock = getCssBlock(css, '.ds-v2-primary-nav');
    const mainBlock = getCssBlock(css, '.ds-app-main');
    const commandDialogBlock = getCssBlock(css, '.ds-v2-command-dialog');
    const menuBlock = getCssBlock(css, '.ds-v2-menu');
    const menuHeadingBlock = getCssBlock(css, ".ds-v2-menu [cmdk-group-heading]");
    const navActiveBlock = getCssBlock(css, `.ds-v2-nav-button-active,
.ds-v2-nav-button-active:hover`);
    const navActiveAfterBlock = getCssBlock(css, '.ds-v2-nav-button-active::after');

    expect(shellBlock).toContain('flex: 0 0 auto');
    expect(navBlock).toContain('min-height: 36px');
    expect(navBlock).toContain('display: flex');
    expect(navBlock).toContain('overflow-x: hidden');
    expect(navBlock).not.toContain('repeat(4');
    expect(getCssBlock(css, '.ds-v2-nav-button')).toContain('flex: 1 1 0');
    expect(commandDialogBlock).toContain('border: 1px solid');
    expect(menuBlock).toContain('overflow: hidden');
    expect(commandDialogBlock).not.toContain('border: 2px');
    expect(menuHeadingBlock).not.toContain('text-transform');
    expect(css).not.toContain('.ds-v2-ask-button');
    expect(navActiveBlock).toContain('var(--ds-surface)');
    expect(navActiveBlock).not.toContain('var(--ds-blue)');
    expect(navActiveAfterBlock).toContain('background: transparent');
    expect(mainBlock).toContain('flex: 1 1 0');
    expect(settingsPage).toContain('function SettingsCategoryPicker');
    expect(settingsPage).not.toContain('SubTabs');
    expect(css).toContain('.ds-settings-picker select');
    expect(getCssBlock(css, '.ds-cockpit-empty-action')).toContain('justify-self: start');
    expect(getCssBlock(css, '.ds-cockpit-fact-grid')).toContain('grid-template-columns: 1fr');
    expect(getCssBlock(css, '.ds-cockpit-fact-grid')).not.toContain('repeat(2');
    expect(css).toContain('.ds-cockpit-mission-strip');
    expect(localeResources.en.sidepanel.cockpit.emptyDescription).not.toContain('runtime ledger');
    expect(localeResources.en.sidepanel.cockpit.startMission).toBe('Start mission');
    expect(readFileSync('entrypoints/sidepanel/pages/cockpit-components.tsx', 'utf8')).not.toContain('openAutomation');
    expect(localeResources.en.sidepanel.cockpit.lease).toBe('Target state');
    expect(localeResources.en.sidepanel.cockpit.qualityGate).toBe('Quality review');
    expect(localeResources.en.sidepanel.cockpit.reviewLanes).toBe('Reviewers');
    expect(getCssBlock(css, '.ds-cockpit-strip-copy strong')).toContain('overflow-wrap: anywhere');
    expect(getCssBlock(css, '.ds-cockpit-strip-copy strong')).toContain('white-space: normal');
    expect(localeResources.en.sidepanel.cockpit.eventTitle.quality_gate).toBe('Quality review recorded');
    expect(localeResources.en.sidepanel.cockpit.eventTitle.review_lane).toBe('Reviewer update');
    expect(localeResources.en.sidepanel.cockpit.workingSetDescription).not.toMatch(/ledger|lease/i);
    expect(localeResources.en.sidepanel.cockpit.timelineDescription).not.toMatch(/gates|lanes/i);
    expect(localeResources.en.sidepanel.cockpit.reviewDescription).not.toMatch(/gates|lanes|transcripts/i);
    expect(localeResources.en.sidepanel.cockpit.noReviewDescription).not.toMatch(/gate|lane/i);
    expect(Object.values(localeResources.en.sidepanel.cockpit.eventTitle).join(' ')).not.toMatch(/gate|lane/i);
  });

  it('keeps sidebar attention visible without using the old loud copy', () => {
    const shell = readFileSync('entrypoints/sidepanel/components/SidebarV2Shell.tsx', 'utf8');
    const en = readFileSync('core/i18n/resources/en.ts', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const globalContext = readFileSync('entrypoints/sidepanel/global-operational-context.tsx', 'utf8');

    expect(shell).toContain("statusKey === 'app.sidebarV2.statusAttention'");
    expect(shell).toContain('CommandDialog');
    expect(shell).toContain('CommandInput');
    expect(shell).toContain('CommandItem');
    expect(shell).not.toContain('DropdownMenu');
    expect(shell).not.toContain('role="menu"');
    expect(shell).not.toContain('role="menuitem"');
    expect(shell).toContain("aria-current={active ? 'page' : undefined}");
    expect(en).toContain("statusAttention: 'Needs setup'");
    expect(en).not.toContain("statusAttention: 'Needs attention'");
    expect(getCssBlock(css, '.ds-v2-status-attention')).toContain('var(--ds-text-secondary)');
    expect(globalContext).toContain("'AUTH_STATUS_CHANGED'");
  });

  it('defines scroll-hint and MCP polish utility classes', () => {
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');

    expect(css).toContain('.ds-v2-command-dialog');
    expect(css).toContain('.ds-v2-menu');
    expect(css).toContain('.ds-v2-menu-header');
    expect(css).toContain('.ds-v2-menu-group-heading');
    expect(css).toContain('.ds-v2-menu-item-active');
    expect(css).toContain('.ds-v2-menu-separator');
    expect(css).toContain('.side-tabs.ds-scroll-compact .side-tab-label');
    expect(css).toContain('.ds-metric-strip');
    expect(css).toContain('.ds-shell-setup-steps');
    expect(css).toContain('.ds-command-block');
    expect(css).toContain('.ds-page');
    expect(css).toContain('.ds-section');
    expect(css).toContain('--ds-surface-2');
    expect(css).toContain('--ds-space-3');
  });

  it('uses role=switch toggles in settings scenarios instead of raw checkboxes', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ scenarioConfigs: [] })),
          set: vi.fn(async () => {}),
        },
      },
      runtime: {
        sendMessage: vi.fn(async () => {}),
      },
    });

    const ScenarioManager = (await import('../entrypoints/sidepanel/components/ScenarioManager')).default;
    await renderElement(React.createElement(ScenarioManager));

    expect(container.querySelectorAll('[role="switch"]').length).toBeGreaterThan(0);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    vi.unstubAllGlobals();
  });
});

async function renderApp() {
  await renderElement(React.createElement(App));
  await flushApp();
}

function getVisibleCommandItemLabels(menu: HTMLElement): string[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('.ds-v2-menu-item'))
    .filter((item) => !item.hidden)
    .map((item) => item.querySelector('.ds-v2-menu-item-label')?.textContent ?? '');
}

async function renderElement(element: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
}

function navButtonLabels(label: string): string[] {
  const nav = container.querySelector(`nav[aria-label="${label}"]`);
  expect(nav).toBeTruthy();
  return Array.from(nav!.querySelectorAll('button')).map((button) => button.textContent ?? '');
}

async function flushApp() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function flushAnimationFrame() {
  await act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  });
}

async function pressFocusedKey(key: string) {
  const active = document.activeElement;
  expect(active).toBeTruthy();
  await act(async () => {
    active!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await Promise.resolve();
  });
  await flushApp();
}

async function waitForText(text: string) {
  for (let i = 0; i < 30; i += 1) {
    if (container.textContent?.includes(text)) return;
    await flushApp();
  }
}

async function openNavigationMenu() {
  const menuButton = container.querySelector('button[aria-label="打开导航菜单"]') as HTMLButtonElement | null;
  expect(menuButton).toBeTruthy();
  await act(async () => {
    menuButton!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    menuButton!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    menuButton!.click();
    await Promise.resolve();
  });
  await flushApp();
  for (let i = 0; i < 10 && !getNavigationMenuPanel(); i += 1) {
    await flushAnimationFrame();
  }
  expect(getNavigationMenuPanel()).toBeTruthy();
}

async function clickButton(label: string) {
  const button = Array.from(document.body.querySelectorAll('button, [role="menuitem"], [role="option"], [data-slot="command-item"]')).find(
    (candidate) => (candidate.textContent ?? '').trim().startsWith(label),
  ) as HTMLElement | undefined;
  expect(button).toBeTruthy();
  await act(async () => {
    button!.click();
    await Promise.resolve();
  });
  await flushApp();
}

async function setCommandSearch(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
  await flushApp();
}

async function selectSettingsSubTab(value: string) {
  const labels: Record<string, string> = {
    general: '通用',
    api: 'API',
    prompt: '提示词',
    voice: '语音',
    appearance: '外观',
    usage: '用量',
    data: '数据',
    about: '关于',
  };
  await selectWorkbenchOption('视图', labels[value]);
}

async function selectSystemCapabilitySubTab(value: string) {
  const labels: Record<string, string> = {
    automation: '自动化',
    preset: '预设',
    browser: '浏览器',
    mcp: '连接器',
    tools: '页面工具',
    doctor: '健康',
  };
  await selectWorkbenchOption('系统分区', labels[value]);
  await flushApp();
  expect(getWorkbenchSelectTrigger('系统分区').textContent).toContain(labels[value]);
}

function getWorkbenchSelectTrigger(label: string): HTMLButtonElement {
  const labelNode = Array.from(container.querySelectorAll<HTMLElement>('.ds-settings-picker-label'))
    .find((candidate) => candidate.textContent === label);
  expect(labelNode).toBeTruthy();
  const trigger = labelNode
    ?.closest('.ds-settings-picker')
    ?.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]');
  expect(trigger).toBeTruthy();
  return trigger!;
}

async function openWorkbenchSelect(label: string): Promise<HTMLElement> {
  const trigger = getWorkbenchSelectTrigger(label);
  await act(async () => {
    trigger.dispatchEvent(createMousePointerEvent('pointerdown'));
    await Promise.resolve();
  });
  await flushApp();
  const content = document.body.querySelector<HTMLElement>('[data-slot="select-content"]');
  expect(content).toBeTruthy();
  return content!;
}

async function getWorkbenchSelectOptions(label: string): Promise<string[]> {
  const content = await openWorkbenchSelect(label);
  const options = Array.from(content.querySelectorAll<HTMLElement>('[data-slot="select-item"]'))
    .map((option) => option.textContent?.trim() ?? '');
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();
  });
  await flushApp();
  return options;
}

async function expectWorkbenchSelectOptions(label: string, expected: string[]) {
  expect(await getWorkbenchSelectOptions(label)).toEqual(expected);
}

async function selectWorkbenchOption(label: string, optionLabel: string) {
  const content = await openWorkbenchSelect(label);
  const option = Array.from(content.querySelectorAll<HTMLElement>('[data-slot="select-item"]'))
    .find((candidate) => candidate.textContent?.trim() === optionLabel);
  expect(option).toBeTruthy();
  await act(async () => {
    option!.dispatchEvent(createMousePointerEvent('pointermove'));
    option!.dispatchEvent(createMousePointerEvent('pointerup'));
    option!.click();
    await Promise.resolve();
  });
  await flushApp();
}

function createMousePointerEvent(type: string): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    ctrlKey: false,
    clientX: 1,
    clientY: 1,
  });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

function unmountRoot() {
  if (root) {
    act(() => root?.unmount());
    root = null;
    container.innerHTML = '';
  }
}

function getCssBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`));
  expect(match?.groups?.body).toBeTruthy();
  return match!.groups!.body;
}

function getNavigationMenuPanel(): HTMLElement | null {
  return document.querySelector('#ds-v2-menu-panel');
}

function createUsageSummary() {
  const now = new Date(2026, 5, 18).getTime();
  const days = Array.from({ length: 30 }, (_, index) => {
    const timestamp = now - (29 - index) * 24 * 60 * 60 * 1000;
    const active = index >= 27;
    return {
      day: new Date(timestamp).toISOString().slice(0, 10),
      timestamp,
      tokens: active ? 1100 + index * 10 : 0,
      messageCount: active ? 2 : 0,
      sessionCount: active ? 1 : 0,
      turnCount: active ? 1 : 0,
      models: active
        ? [{ modelKey: 'vision', modelLabel: 'DeepSeek Vision', tokens: 1100 + index * 10 }]
        : [],
    };
  });

  return {
    rangeDays: 30,
    generatedAt: now,
    totalTokens: 3302,
    sessionCount: 2,
    messageCount: 6,
    turnCount: 3,
    activeDays: 3,
    currentStreak: 3,
    serverTokenRecordCount: 3,
    mostUsedModel: {
      modelKey: 'vision',
      modelLabel: 'DeepSeek Vision',
      totalTokens: 3302,
      turnCount: 3,
      messageCount: 6,
      sessionCount: 2,
      share: 1,
    },
    days,
    heatmap: days.map((day) => ({
      day: day.day,
      timestamp: day.timestamp,
      tokens: day.tokens,
      level: day.tokens > 0 ? 5 : 0,
    })),
    modelUsage: [{
      modelKey: 'vision',
      modelLabel: 'DeepSeek Vision',
      totalTokens: 3302,
      turnCount: 3,
      messageCount: 6,
      sessionCount: 2,
      share: 1,
    }],
  };
}
