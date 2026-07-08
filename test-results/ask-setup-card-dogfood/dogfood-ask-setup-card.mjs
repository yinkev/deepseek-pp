import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/ask-setup-card-dogfood');

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.zip', 'application/zip'],
]);

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const safePath = requestUrl.pathname === '/' ? '/sidepanel.html' : requestUrl.pathname;
    const filePath = resolve(join(distRoot, safePath));
    if (!filePath.startsWith(distRoot)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': mimeTypes.get(extname(filePath)) ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

function listen() {
  return new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Unable to bind dogfood server');
      resolveListen(address.port);
    });
  });
}

function installChromeStub(options) {
  const storageData = {
    deepseek_pp_locale_preference: 'en',
    deepseek_pp_chat_enabled: options.chatEnabled === true,
  };
  const runtimeListeners = [];
  const storageListeners = [];
  const state = {
    runtimeCalls: [],
    storageSets: [],
    openedTabs: [],
    failSkillLibraryOnce: options.failSkillLibraryOnce === true,
    failMemoriesOnce: options.failMemoriesOnce === true,
  };

  function normalizeKeys(keys) {
    if (typeof keys === 'string') return [keys];
    if (Array.isArray(keys)) return keys;
    if (keys && typeof keys === 'object') return Object.keys(keys);
    return Object.keys(storageData);
  }

  function pickStorage(keys) {
    if (keys === null || keys === undefined) return { ...storageData };
    if (keys && typeof keys === 'object' && !Array.isArray(keys) && typeof keys !== 'string') {
      const result = { ...keys };
      for (const key of Object.keys(keys)) {
        if (Object.hasOwn(storageData, key)) result[key] = storageData[key];
      }
      return result;
    }
    const result = {};
    for (const key of normalizeKeys(keys)) {
      if (Object.hasOwn(storageData, key)) result[key] = storageData[key];
    }
    return result;
  }

  const storageArea = {
    async get(keys) {
      return pickStorage(keys);
    },
    async set(items) {
      const changes = {};
      for (const [key, value] of Object.entries(items ?? {})) {
        changes[key] = { oldValue: storageData[key], newValue: value };
        storageData[key] = value;
      }
      state.storageSets.push(items);
      for (const listener of storageListeners) listener(changes, 'local');
    },
    async remove(keys) {
      const changes = {};
      for (const key of normalizeKeys(keys)) {
        changes[key] = { oldValue: storageData[key], newValue: undefined };
        delete storageData[key];
      }
      for (const listener of storageListeners) listener(changes, 'local');
    },
  };

  const authResponse = options.authStatus ?? { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true };

  window.__DEEPSEEKPP_ASK_SETUP_DOGFOOD_STATE__ = state;
  window.chrome = {
    i18n: {
      getUILanguage: () => 'en',
      getMessage: () => '',
    },
    runtime: {
      getManifest: () => ({ version: '1.0.3' }),
      getURL: (path) => `${location.origin}/${path}`,
      onMessage: {
        addListener: (listener) => runtimeListeners.push(listener),
        removeListener: (listener) => {
          const index = runtimeListeners.indexOf(listener);
          if (index >= 0) runtimeListeners.splice(index, 1);
        },
      },
      async sendMessage(message) {
        state.runtimeCalls.push(message?.type);
        if (message?.type === 'GET_AUTH_STATUS') {
          if (options.authDelayMs) {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, options.authDelayMs));
          }
          return authResponse;
        }
        if (message?.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return undefined;
        if (message?.type === 'GET_VOICE_SETTINGS') return undefined;
        if (message?.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return { ok: true, config: {} };
        if (message?.type === 'GET_RUNTIME_DOCTOR_REPORT') return null;
        if (message?.type === 'GET_PROMPT_INJECTION_SETTINGS') return null;
        if (message?.type === 'GET_TOOL_DESCRIPTORS') return { providers: [], tools: [], refreshedAt: 1 };
        if (message?.type === 'GET_USAGE_SUMMARY') return { rangeDays: 30, generatedAt: Date.now(), totalTokens: 0, days: [] };
        if (message?.type === 'GET_SKILL_LIBRARY') {
          if (state.failSkillLibraryOnce) {
            state.failSkillLibraryOnce = false;
            throw new Error('commands offline');
          }
          return [
            {
              name: 'review',
              description: 'Review for risks.',
              instructions: 'Find risks.',
              source: 'custom',
              memoryEnabled: true,
              enabled: true,
            },
          ];
        }
        if (message?.type === 'GET_PROJECT_CONTEXT_STATE') {
          return {
            schemaVersion: 2,
            projects: [{
              id: 'project-1',
              name: 'Dogfood project',
              description: '',
              instructions: 'Keep Ask setup verified.',
              createdAt: 1,
              updatedAt: 2,
            }],
            conversations: [],
            pendingProjectId: 'project-1',
          };
        }
        if (message?.type === 'GET_MEMORIES') {
          if (state.failMemoriesOnce) {
            state.failMemoriesOnce = false;
            throw new Error('memory offline');
          }
          return [{
            id: 1,
            syncId: 'memory-1',
            scope: 'global',
            type: 'preference',
            name: 'Review preference',
            content: 'Surface risks first.',
            description: 'Review preference',
            tags: ['review'],
            pinned: true,
            createdAt: 1,
            updatedAt: 2,
            accessCount: 0,
            lastAccessedAt: 2,
          }];
        }
        if (message?.type === 'GET_SAVED_ITEMS') {
          return [{
            id: 'saved-1',
            syncId: 'saved-sync-1',
            kind: 'snippet',
            title: 'Review checklist',
            content: 'Check risks.',
            tags: ['review'],
            createdAt: 1,
            updatedAt: 2,
          }];
        }
        if (message?.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') {
          return {
            ok: true,
            conversation: {
              conversationId: 'chat-1',
              title: 'Current DeepSeek task',
              url: 'https://chat.deepseek.com/a/chat/s/chat-1',
            },
          };
        }
        if (message?.type === 'GET_DEEPSEEK_API_KEY_STATUS') return { configured: false };
        if (message?.type === 'GET_MULTIMODAL_SETTINGS_STATUS') return { ok: true };
        if (message?.type === 'GET_MEMORIES_FOR_SETTINGS') return [];
        if (message?.type === 'GET_CONFIG') return { version: '1.0.3' };
        if (message?.type === 'GET_SYNC_CONFIG') return null;
        if (message?.type === 'GET_MODEL_TYPE') return null;
        if (message?.type === 'GET_BACKGROUND') return null;
        if (message?.type === 'GET_PET') return null;
        return null;
      },
    },
    storage: {
      local: storageArea,
      session: storageArea,
      onChanged: {
        addListener: (listener) => storageListeners.push(listener),
        removeListener: (listener) => {
          const index = storageListeners.indexOf(listener);
          if (index >= 0) storageListeners.splice(index, 1);
        },
      },
    },
    tabs: {
      create: async (payload) => {
        state.openedTabs.push(payload);
        return { id: 99 };
      },
    },
    permissions: {
      contains: async () => true,
      request: async () => true,
    },
  };
}

async function assertDogfood(condition, message) {
  if (!condition) throw new Error(message);
}

async function pageDiagnostics(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const text = body.innerText;
    const card = document.querySelector('.ds-chat-setup-card');
    const leakPattern = /\b(?:GET|SAVE|SET|DELETE|CREATE|UPDATE)_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|deepseek_pp_|Bearer|Cookie|data:image|\[object Object\]|sk-[A-Za-z0-9_-]{8,}|token|secret/i;
    return {
      overflow: Math.ceil(Math.max(root.scrollWidth, body.scrollWidth)) > Math.ceil(root.clientWidth) + 1,
      leak: leakPattern.test(text),
      text,
      cardSlot: card?.getAttribute('data-slot') ?? null,
      cardSize: card?.getAttribute('data-size') ?? null,
      cardState: card?.getAttribute('data-state') ?? null,
      cardHeaderSlots: card?.querySelectorAll('[data-slot="card-header"]').length ?? 0,
      cardContentSlots: card?.querySelectorAll('[data-slot="card-content"]').length ?? 0,
      cardFooterSlots: card?.querySelectorAll('[data-slot="card-footer"]').length ?? 0,
      title: card?.querySelector('[data-slot="card-title"]')?.textContent?.trim() ?? '',
      description: card?.querySelector('[data-slot="card-description"]')?.textContent?.trim() ?? '',
      badgeTexts: Array.from(card?.querySelectorAll('[data-slot="badge"]') ?? []).map((node) => node.textContent?.trim() ?? ''),
      buttonTexts: Array.from(card?.querySelectorAll('[data-slot="button"]') ?? []).map((node) => node.textContent?.trim() ?? ''),
      skeletonSlots: card?.querySelectorAll('[data-slot="skeleton"]').length ?? 0,
      textareaCount: document.querySelectorAll('textarea').length,
      menuOpen: Boolean(document.querySelector('[data-slot="command-dialog"]') ?? document.querySelector('#ds-v2-menu-panel')),
      suggestionTitle: document.querySelector('.ds-chat-suggestion-header')?.textContent?.trim() ?? '',
      suggestionAlertSlots: document.querySelectorAll('.ds-chat-suggestion-source-issue[data-slot="alert"]').length,
      suggestionAlertTitle: document.querySelector('.ds-chat-suggestion-source-issue [data-slot="alert-title"]')?.textContent?.trim() ?? '',
      suggestionAlertDescription: document.querySelector('.ds-chat-suggestion-source-issue [data-slot="alert-description"]')?.textContent?.trim() ?? '',
      suggestionAlertButtonSlots: document.querySelectorAll('.ds-chat-suggestion-source-issue [data-slot="button"]').length,
    };
  });
}

async function assertClean(page, consoleErrors, pageErrors, label, width) {
  const diagnostics = await pageDiagnostics(page);
  await assertDogfood(!diagnostics.overflow, `${label}: horizontal overflow at ${width}`);
  await assertDogfood(!diagnostics.leak, `${label}: visible leak pattern at ${width}`);
  await assertDogfood(consoleErrors.length === 0, `${label}: console errors at ${width}: ${consoleErrors.join(' | ')}`);
  await assertDogfood(pageErrors.length === 0, `${label}: page errors at ${width}: ${pageErrors.join(' | ')}`);
  return diagnostics;
}

async function loadScenario(browser, url, width, options) {
  const page = await browser.newPage({ viewport: { width, height: 760 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(installChromeStub, options);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { page, consoleErrors, pageErrors };
}

async function verifySetupCard(page, consoleErrors, pageErrors, width, expected) {
  await page.waitForSelector(`.ds-chat-setup-card[data-state="${expected.state}"]`, { timeout: 10000 });
  const diagnostics = await assertClean(page, consoleErrors, pageErrors, expected.state, width);
  await assertDogfood(diagnostics.cardSlot === 'card', `${expected.state}: Card slot missing at ${width}`);
  await assertDogfood(diagnostics.cardSize === 'sm', `${expected.state}: Card size mismatch at ${width}`);
  await assertDogfood(diagnostics.cardHeaderSlots === 1, `${expected.state}: CardHeader missing at ${width}`);
  await assertDogfood(diagnostics.cardContentSlots === 1, `${expected.state}: CardContent missing at ${width}`);
  await assertDogfood(diagnostics.title === expected.title, `${expected.state}: title mismatch at ${width}: ${diagnostics.title}`);
  await assertDogfood(diagnostics.description.includes(expected.description), `${expected.state}: description mismatch at ${width}`);
  await assertDogfood(diagnostics.badgeTexts.includes(expected.badge), `${expected.state}: badge missing at ${width}: ${diagnostics.badgeTexts.join('|')}`);
  await assertDogfood(diagnostics.textareaCount === 0, `${expected.state}: composer should not be visible at ${width}`);
  if (expected.buttons !== undefined) {
    await assertDogfood(diagnostics.buttonTexts.length === expected.buttons, `${expected.state}: button count mismatch at ${width}`);
  }
  if (expected.skeletons !== undefined) {
    await assertDogfood(diagnostics.skeletonSlots === expected.skeletons, `${expected.state}: skeleton count mismatch at ${width}`);
  }
  return diagnostics;
}

async function runWidth(browser, url, width) {
  const screenshots = [];

  {
    const { page, consoleErrors, pageErrors } = await loadScenario(browser, url, width, {
      chatEnabled: false,
      authStatus: { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true },
    });
    await verifySetupCard(page, consoleErrors, pageErrors, width, {
      state: 'disabled',
      title: 'Sidepanel chat is off',
      description: 'Ask is reachable',
      badge: 'Off',
      buttons: 2,
    });
    await page.screenshot({ path: join(outDir, `ask-disabled-${width}.png`), fullPage: true });
    screenshots.push(`ask-disabled-${width}.png`);
    await page.getByRole('button', { name: 'API settings' }).click();
    await page.waitForSelector('.ds-settings-status-card, [data-workbench-header="true"]', { timeout: 10000 });
    await assertClean(page, consoleErrors, pageErrors, 'api-settings-navigation', width);
    await page.screenshot({ path: join(outDir, `ask-disabled-api-settings-${width}.png`), fullPage: true });
    screenshots.push(`ask-disabled-api-settings-${width}.png`);
    await page.close();
  }

  {
    const { page, consoleErrors, pageErrors } = await loadScenario(browser, url, width, {
      chatEnabled: false,
      authStatus: { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true },
    });
    await verifySetupCard(page, consoleErrors, pageErrors, width, {
      state: 'disabled',
      title: 'Sidepanel chat is off',
      description: 'Ask is reachable',
      badge: 'Off',
      buttons: 2,
    });
    await page.getByRole('button', { name: 'Enable sidepanel chat' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('textarea[aria-label="Message DeepSeek++"]', { timeout: 10000 });
    const state = await page.evaluate(() => window.__DEEPSEEKPP_ASK_SETUP_DOGFOOD_STATE__);
    await assertDogfood(state.storageSets.some((item) => item.deepseek_pp_chat_enabled === true), `enable write missing at ${width}`);
    await assertClean(page, consoleErrors, pageErrors, 'enabled-after-keyboard', width);
    await page.screenshot({ path: join(outDir, `ask-enabled-after-keyboard-${width}.png`), fullPage: true });
    screenshots.push(`ask-enabled-after-keyboard-${width}.png`);
    await page.close();
  }

  {
    const { page, consoleErrors, pageErrors } = await loadScenario(browser, url, width, {
      chatEnabled: true,
      authStatus: { available: false, provider: null, hasApiKey: false, hasToken: false },
    });
    await verifySetupCard(page, consoleErrors, pageErrors, width, {
      state: 'needs-setup',
      title: 'Connect chat',
      description: 'Use your signed-in DeepSeek tab',
      badge: 'Needs setup',
      buttons: 2,
    });
    await page.getByRole('button', { name: 'Open DeepSeek' }).click();
    const state = await page.evaluate(() => window.__DEEPSEEKPP_ASK_SETUP_DOGFOOD_STATE__);
    await assertDogfood(state.openedTabs.some((entry) => entry.url === 'https://chat.deepseek.com/' && entry.active === true), `Open DeepSeek did not request tab at ${width}`);
    await page.screenshot({ path: join(outDir, `ask-needs-setup-${width}.png`), fullPage: true });
    screenshots.push(`ask-needs-setup-${width}.png`);
    await page.close();
  }

  {
    const { page, consoleErrors, pageErrors } = await loadScenario(browser, url, width, {
      chatEnabled: true,
      authDelayMs: 1800,
      authStatus: { available: false, provider: null, hasApiKey: false, hasToken: false },
    });
    await verifySetupCard(page, consoleErrors, pageErrors, width, {
      state: 'checking',
      title: 'Checking chat access',
      description: 'checking the web session',
      badge: 'Checking',
      skeletons: 2,
    });
    await page.screenshot({ path: join(outDir, `ask-checking-${width}.png`), fullPage: true });
    screenshots.push(`ask-checking-${width}.png`);
    await page.close();
  }

  {
    const { page, consoleErrors, pageErrors } = await loadScenario(browser, url, width, {
      chatEnabled: true,
      authStatus: { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true },
    });
    await page.waitForSelector('textarea[aria-label="Message DeepSeek++"]', { timeout: 10000 });
    await assertClean(page, consoleErrors, pageErrors, 'enabled-composer', width);
    await page.locator('button[aria-label="Open navigation menu"]').click();
    await page.waitForSelector('[data-slot="command-input"]', { timeout: 10000 });
    await page.screenshot({ path: join(outDir, `ask-menu-open-${width}.png`), fullPage: true });
    screenshots.push(`ask-menu-open-${width}.png`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-slot="command-input"]'));
    const input = page.locator('textarea[aria-label="Message DeepSeek++"]');
    await input.fill('/r');
    await page.waitForSelector('#ds-chat-composer-suggestions [data-slot="command-item"]', { timeout: 10000 });
    let diagnostics = await assertClean(page, consoleErrors, pageErrors, 'slash-suggestions', width);
    await assertDogfood(diagnostics.suggestionTitle.includes('Commands'), `slash title missing at ${width}`);
    await assertDogfood(diagnostics.text.includes('/review'), `slash command missing at ${width}`);
    await page.screenshot({ path: join(outDir, `ask-slash-${width}.png`), fullPage: true });
    screenshots.push(`ask-slash-${width}.png`);
    await input.fill('@');
    await page.waitForSelector('#ds-chat-composer-suggestions [data-slot="command-item"]', { timeout: 10000 });
    diagnostics = await assertClean(page, consoleErrors, pageErrors, 'context-suggestions', width);
    await assertDogfood(diagnostics.suggestionTitle.includes('Context'), `context title missing at ${width}`);
    await assertDogfood(diagnostics.text.includes('Dogfood project'), `context project missing at ${width}`);
    await page.screenshot({ path: join(outDir, `ask-context-${width}.png`), fullPage: true });
    screenshots.push(`ask-context-${width}.png`);
    await page.close();
  }

  {
    const { page, consoleErrors, pageErrors } = await loadScenario(browser, url, width, {
      chatEnabled: true,
      failSkillLibraryOnce: true,
      authStatus: { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true },
    });
    await page.waitForSelector('textarea[aria-label="Message DeepSeek++"]', { timeout: 10000 });
    const input = page.locator('textarea[aria-label="Message DeepSeek++"]');
    await input.fill('/');
    await page.waitForSelector('.ds-chat-suggestion-source-issue[data-slot="alert"]', { timeout: 10000 });
    let diagnostics = await assertClean(page, consoleErrors, pageErrors, 'slash-source-failure', width);
    await assertDogfood(diagnostics.suggestionAlertSlots === 1, `slash alert slot missing at ${width}`);
    await assertDogfood(diagnostics.suggestionAlertTitle === 'Suggestions need refresh', `slash alert title mismatch at ${width}: ${diagnostics.suggestionAlertTitle}`);
    await assertDogfood(diagnostics.suggestionAlertDescription.includes('Some results could not load'), `slash alert description mismatch at ${width}`);
    await assertDogfood(diagnostics.suggestionAlertButtonSlots === 1, `slash retry Button slot missing at ${width}`);
    await assertDogfood(diagnostics.text.includes('commands offline'), `friendly slash failure missing at ${width}`);
    await assertDogfood(!diagnostics.text.includes('No matching commands.'), `false empty slash state visible at ${width}`);
    await page.screenshot({ path: join(outDir, `ask-slash-failure-${width}.png`), fullPage: true });
    screenshots.push(`ask-slash-failure-${width}.png`);
    await page.locator('.ds-chat-suggestion-source-issue [data-slot="button"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#ds-chat-composer-suggestions [data-slot="command-item"]', { timeout: 10000 });
    diagnostics = await assertClean(page, consoleErrors, pageErrors, 'slash-source-recovered', width);
    await assertDogfood(diagnostics.text.includes('/review'), `slash command missing after retry at ${width}`);
    await assertDogfood(!diagnostics.text.includes('commands offline'), `slash failure persisted after retry at ${width}`);
    await page.screenshot({ path: join(outDir, `ask-slash-recovered-${width}.png`), fullPage: true });
    screenshots.push(`ask-slash-recovered-${width}.png`);
    await page.close();
  }

  {
    const { page, consoleErrors, pageErrors } = await loadScenario(browser, url, width, {
      chatEnabled: true,
      failMemoriesOnce: true,
      authStatus: { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true },
    });
    await page.waitForSelector('textarea[aria-label="Message DeepSeek++"]', { timeout: 10000 });
    const input = page.locator('textarea[aria-label="Message DeepSeek++"]');
    await input.fill('@');
    await page.waitForSelector('.ds-chat-suggestion-source-issue[data-slot="alert"]', { timeout: 10000 });
    let diagnostics = await assertClean(page, consoleErrors, pageErrors, 'context-source-failure', width);
    await assertDogfood(diagnostics.suggestionAlertSlots === 1, `context alert slot missing at ${width}`);
    await assertDogfood(diagnostics.suggestionAlertTitle === 'Suggestions need refresh', `context alert title mismatch at ${width}: ${diagnostics.suggestionAlertTitle}`);
    await assertDogfood(diagnostics.suggestionAlertButtonSlots === 1, `context retry Button slot missing at ${width}`);
    await assertDogfood(diagnostics.text.includes('memory offline'), `friendly context failure missing at ${width}`);
    await assertDogfood(diagnostics.text.includes('Dogfood project'), `project context hidden during memory failure at ${width}`);
    await assertDogfood(diagnostics.text.includes('Review checklist'), `saved context hidden during memory failure at ${width}`);
    await assertDogfood(!diagnostics.text.includes('Review preference'), `failed memory source still visible at ${width}`);
    await page.screenshot({ path: join(outDir, `ask-context-failure-${width}.png`), fullPage: true });
    screenshots.push(`ask-context-failure-${width}.png`);
    await page.locator('.ds-chat-suggestion-source-issue [data-slot="button"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#ds-chat-composer-suggestions [data-slot="command-item"]', { timeout: 10000 });
    diagnostics = await assertClean(page, consoleErrors, pageErrors, 'context-source-recovered', width);
    await assertDogfood(diagnostics.text.includes('Review preference'), `memory context missing after retry at ${width}`);
    await assertDogfood(!diagnostics.text.includes('memory offline'), `context failure persisted after retry at ${width}`);
    await page.screenshot({ path: join(outDir, `ask-context-recovered-${width}.png`), fullPage: true });
    screenshots.push(`ask-context-recovered-${width}.png`);
    await page.close();
  }

  return screenshots;
}

await mkdir(outDir, { recursive: true });
const port = await listen();
const url = `http://127.0.0.1:${port}/sidepanel.html`;
const browser = await chromium.launch();

try {
  const allScreenshots = [];
  for (const width of [420, 360]) {
    allScreenshots.push(...await runWidth(browser, url, width));
  }
  const summary = {
    ok: true,
    url,
    widths: [420, 360],
    screenshots: allScreenshots,
    checks: [
      'production bundle served from dist/chrome-mv3/sidepanel.html',
      'disabled Ask setup shadcn Card/Badge/Button slots',
      'API Settings navigation from disabled setup',
      'keyboard Enter enable flow and persisted storage write',
      'needs-setup Open DeepSeek action',
      'checking state Skeleton rows',
      'enabled composer, menu Escape, slash suggestions, context suggestions',
      'slash and context source-failure Alert/Button states with keyboard retry recovery',
      'DOM overflow, console/page errors, and visible leak scans',
    ],
  };
  await writeFile(join(outDir, 'dogfood-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(outDir, 'audit-notes.md'), [
    '# Ask Setup Card Dogfood',
    '',
    'Result: pass.',
    '',
    'Evidence source: production bundle `dist/chrome-mv3/sidepanel.html` served locally with a contract-shaped Chrome runtime/storage stub.',
    '',
    '- Disabled Ask renders a shadcn Card setup state, no composer, real Enable/API Settings actions, and keyboard Enter enables chat.',
    '- Needs-setup Ask renders truthful DeepSeek/API status and the Open DeepSeek action requests the real target URL.',
    '- Checking Ask renders Skeleton rows while auth is pending.',
    '- Enabled Ask still exposes the composer, real navigation menu, slash suggestions, context suggestions, and retryable slash/context source-failure alerts.',
    '- Checked 420px and 360px, horizontal overflow, console/page errors, and visible leak patterns.',
    '',
  ].join('\n'));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  server.close();
}
