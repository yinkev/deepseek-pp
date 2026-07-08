import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/presets-status-card-dogfood');

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

const codeReviewerPreset = {
  id: 'preset-code-reviewer',
  name: 'Code reviewer',
  content: 'Be direct. Check risks before style.',
  createdAt: 1,
  updatedAt: 2,
};

const writingCoachPreset = {
  id: 'preset-writing-coach',
  name: 'Writing coach',
  content: 'Make the draft clearer and more concise.',
  createdAt: 3,
  updatedAt: 4,
};

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
    res.writeHead(200, {
      'content-type': mimeTypes.get(extname(filePath)) ?? 'application/octet-stream',
    });
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
    deepseek_pp_chat_enabled: true,
  };
  const runtimeListeners = [];
  const storageListeners = [];
  const presets = options.presets.map((preset) => ({ ...preset }));
  const state = {
    calls: [],
    savePresetPayloads: [],
    setActivePresetPayloads: [],
    activePresetId: options.activePresetId ?? null,
    failPresetLoadOnce: options.failPresetLoadOnce === true,
    failActiveLoadOnce: options.failActiveLoadOnce === true,
  };

  function normalizeKeys(keys) {
    if (typeof keys === 'string') return [keys];
    if (Array.isArray(keys)) return keys;
    if (keys && typeof keys === 'object') return Object.keys(keys);
    return Object.keys(storageData);
  }

  function pickStorage(keys) {
    if (keys === null || keys === undefined) return { ...storageData };
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

  function activePreset() {
    if (!state.activePresetId) return null;
    return presets.find((preset) => preset.id === state.activePresetId) ?? null;
  }

  window.__DEEPSEEKPP_PRESETS_STATUS_DOGFOOD_STATE__ = state;
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
        state.calls.push(message?.type);
        if (message?.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web', hasToken: true };
        if (message?.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return undefined;
        if (message?.type === 'GET_VOICE_SETTINGS') return undefined;
        if (message?.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return { ok: true, config: {} };
        if (message?.type === 'GET_RUNTIME_DOCTOR_REPORT') return null;
        if (message?.type === 'GET_PROMPT_INJECTION_SETTINGS') return null;
        if (message?.type === 'GET_TOOL_DESCRIPTORS') return { providers: [], tools: [], refreshedAt: 1 };
        if (message?.type === 'GET_SKILL_LIBRARY') return [];
        if (message?.type === 'GET_SKILL_SOURCES') return [];
        if (message?.type === 'GET_MEMORIES') return [];
        if (message?.type === 'GET_SAVED_ITEMS') return [];
        if (message?.type === 'GET_PROJECT_CONTEXT_STATE') return { schemaVersion: 2, pendingProjectId: null, projects: [], conversations: [] };
        if (message?.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
        if (message?.type === 'GET_PRESETS') {
          if (state.failPresetLoadOnce) {
            state.failPresetLoadOnce = false;
            return {
              ok: false,
              error: { message: 'GET_PRESETS schemaVersion chrome.storage deepseek_pp_presets token secret [object Object]' },
            };
          }
          return presets.map((preset) => ({ ...preset }));
        }
        if (message?.type === 'GET_ACTIVE_PRESET') {
          if (state.failActiveLoadOnce) {
            state.failActiveLoadOnce = false;
            return { ok: false, error: { message: 'active preset offline' } };
          }
          return activePreset();
        }
        if (message?.type === 'SAVE_PRESET') {
          state.savePresetPayloads.push(message.payload);
          const existingIndex = presets.findIndex((preset) => preset.id === message.payload?.id);
          if (existingIndex >= 0) {
            presets[existingIndex] = { ...presets[existingIndex], ...message.payload };
          } else {
            presets.unshift({ ...message.payload });
          }
          return { ok: true };
        }
        if (message?.type === 'SET_ACTIVE_PRESET') {
          state.setActivePresetPayloads.push(message.payload);
          state.activePresetId = message.payload?.id ?? null;
          return { ok: true };
        }
        if (message?.type === 'DELETE_PRESET') {
          const index = presets.findIndex((preset) => preset.id === message.payload?.id);
          if (index >= 0) presets.splice(index, 1);
          if (state.activePresetId === message.payload?.id) state.activePresetId = null;
          return { ok: true };
        }
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
      create: async () => ({}),
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

async function pageDiagnostics(page, width) {
  return page.evaluate((currentWidth) => {
    const root = document.documentElement;
    const body = document.body;
    const visibleText = body.innerText;
    const statusCard = document.querySelector('.ds-preset-status-card');
    const overflow = Math.max(root.scrollWidth, body.scrollWidth) > currentWidth + 1;
    const leakPattern = /\bGET_[A-Z0-9_]+\b|\bSAVE_[A-Z0-9_]+\b|\bSET_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|deepseek_pp_|Bearer|Cookie|data:image|\[object Object\]|sk-[A-Za-z0-9_-]{8,}/;
    return {
      overflow,
      leak: leakPattern.test(visibleText),
      visibleText,
      statusState: statusCard?.getAttribute('data-state') ?? '',
      ariaLive: statusCard?.getAttribute('aria-live') ?? '',
      badgeText: statusCard?.querySelector('[data-slot="badge"]')?.textContent?.trim() ?? '',
      badgeVariant: statusCard?.querySelector('[data-slot="badge"]')?.getAttribute('data-variant') ?? '',
      titleText: statusCard?.querySelector('[data-slot="card-title"]')?.textContent?.trim() ?? '',
      descriptionText: statusCard?.querySelector('[data-slot="card-description"]')?.textContent?.trim() ?? '',
      contentText: statusCard?.querySelector('[data-slot="card-content"]')?.textContent?.trim() ?? '',
      footerButtons: statusCard?.querySelectorAll('[data-slot="card-footer"] [data-slot="button"]').length ?? 0,
      retryButtons: Array.from(document.querySelectorAll('button')).filter((button) => button.textContent?.trim() === 'Retry').length,
      menuOpen: Boolean(document.querySelector('#ds-v2-menu-panel')),
      emptySlots: document.querySelectorAll('[data-slot="empty"]').length,
      headerActions: Array.from(document.querySelectorAll('.ds-page > header [data-slot="button"], .ds-page [data-slot="button"]')).slice(0, 2).map((button) => ({
        text: button.textContent?.trim() ?? '',
        variant: button.getAttribute('data-variant') ?? '',
        size: button.getAttribute('data-size') ?? '',
        hasIcon: Boolean(button.querySelector('[data-icon="inline-start"]')),
      })),
      rowBadgeVariants: Array.from(document.querySelectorAll('.ds-preset-row .ds-preset-status[data-slot="badge"]')).map((badge) => badge.getAttribute('data-variant') ?? ''),
    };
  }, width);
}

async function checkNoGlobalFailures(page, consoleErrors, pageErrors, width, step) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(!diagnostics.overflow, `${step}: horizontal overflow at ${width}`);
  await assertDogfood(!diagnostics.leak, `${step}: visible leak pattern at ${width}`);
  await assertDogfood(consoleErrors.length === 0, `${step}: console errors at ${width}: ${consoleErrors.join(' | ')}`);
  await assertDogfood(pageErrors.length === 0, `${step}: page errors at ${width}: ${pageErrors.join(' | ')}`);
  return diagnostics;
}

async function assertButtonSlot(page, label, step, width) {
  const hasSlot = await page.evaluate((buttonLabel) => {
    return Array.from(document.querySelectorAll('button'))
      .some((button) => button.textContent?.trim() === buttonLabel && button.getAttribute('data-slot') === 'button');
  }, label);
  await assertDogfood(hasSlot, `${step}: ${label} is not a shadcn Button at ${width}`);
}

async function assertPresetHeaderActions(page, width, step) {
  const slots = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.ds-page-intro-actions [data-slot="button"]'))
      .map((button) => ({
        text: button.textContent?.trim() ?? '',
        variant: button.getAttribute('data-variant') ?? '',
        size: button.getAttribute('data-size') ?? '',
        hasIcon: Boolean(button.querySelector('[data-icon="inline-start"]')),
      }));
  });
  await assertDogfood(slots.length === 2, `${step}: Preset header action count mismatch at ${width}`);
  await assertDogfood(slots.map((button) => button.text).join(',') === 'Import,New', `${step}: Preset header labels mismatch at ${width}`);
  await assertDogfood(slots.map((button) => button.variant).join(',') === 'outline,default', `${step}: Preset header variants mismatch at ${width}`);
  await assertDogfood(slots.every((button) => button.size === 'sm' && button.hasIcon), `${step}: Preset header size/icon mismatch at ${width}`);
}

async function assertPresetRowBadges(page, width, step, expectedVariants) {
  const variants = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.ds-preset-row .ds-preset-status[data-slot="badge"]'))
      .map((badge) => badge.getAttribute('data-variant') ?? '');
  });
  await assertDogfood(variants.join(',') === expectedVariants.join(','), `${step}: preset row badge variants mismatch at ${width}: ${variants.join(',')}`);
}

async function openPresetsThroughMenu(page, width, step) {
  await page.locator('button[aria-label="Open navigation menu"]').click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await waitForVisibleOpacity(page, '#ds-v2-menu-panel');
  await page.screenshot({ path: join(outDir, `${step}-menu-${width}.png`), fullPage: true });
  await page.locator('#ds-v2-menu-panel [data-slot="command-item"]').filter({ hasText: 'Presets' }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes('Reusable instructions for new DeepSeek chats'), null, { timeout: 10000 });
}

async function waitForVisibleOpacity(page, selector) {
  await page.waitForFunction((targetSelector) => {
    const node = document.querySelector(targetSelector);
    if (!node) return false;
    const style = window.getComputedStyle(node);
    return Number.parseFloat(style.opacity || '0') >= 0.99;
  }, selector, { timeout: 10000 });
  await page.waitForTimeout(150);
}

async function waitForPresetFormStable(page) {
  await page.waitForSelector('.ds-preset-form', { timeout: 10000 });
  await page.waitForFunction(() => {
    const form = document.querySelector('.ds-preset-form');
    const animated = form?.closest('.animate-slide-down');
    const node = animated ?? form;
    if (!node) return false;
    const style = window.getComputedStyle(node);
    return Number.parseFloat(style.opacity || '0') >= 0.99;
  }, null, { timeout: 10000 });
  await page.waitForTimeout(150);
}

async function openDogfoodPage(browser, url, width, stubOptions) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, stubOptions);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ds-chat-input', { timeout: 10000 });
  return { context, page, consoleErrors, pageErrors };
}

async function assertReadyStatus(page, width, step, expectedPresetCountText = '2 saved') {
  await page.waitForFunction(() => document.querySelector('.ds-preset-status-card')?.getAttribute('data-state') === 'ready', null, { timeout: 10000 });
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.statusState === 'ready', `${step}: ready state mismatch at ${width}`);
  await assertDogfood(diagnostics.ariaLive === 'polite', `${step}: aria-live mismatch at ${width}`);
  await assertDogfood(diagnostics.badgeText === 'Ready', `${step}: badge text mismatch at ${width}: ${diagnostics.badgeText}`);
  await assertDogfood(diagnostics.badgeVariant === 'secondary', `${step}: badge variant mismatch at ${width}: ${diagnostics.badgeVariant}`);
  await assertDogfood(diagnostics.titleText === 'Preset status', `${step}: title mismatch at ${width}`);
  await assertDogfood(diagnostics.descriptionText === 'One preset is ready for new chats.', `${step}: description mismatch at ${width}`);
  await assertDogfood(diagnostics.contentText.includes(expectedPresetCountText), `${step}: preset count missing at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('Code reviewer'), `${step}: selected preset missing at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('Use Ask; this preset applies to new chats.'), `${step}: next action missing at ${width}`);
  await assertDogfood(diagnostics.footerButtons === 0, `${step}: ready card should not show footer action at ${width}`);
  return diagnostics;
}

async function runReadyFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    presets: [codeReviewerPreset, writingCoachPreset],
    activePresetId: codeReviewerPreset.id,
  });
  await openPresetsThroughMenu(page, width, 'ready');
  await assertReadyStatus(page, width, 'ready');
  await assertPresetHeaderActions(page, width, 'ready header');
  await assertPresetRowBadges(page, width, 'ready row badges', ['secondary', 'outline']);
  await assertButtonSlot(page, 'Import', 'ready header', width);
  await assertButtonSlot(page, 'New', 'ready header', width);
  await assertButtonSlot(page, 'Stop using', 'ready row', width);
  await assertButtonSlot(page, 'Use', 'ready row', width);
  await page.screenshot({ path: join(outDir, `preset-ready-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'ready');

  await page.setInputFiles('input[type="file"][accept=".txt,.md"]', {
    name: 'Imported reviewer.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('Review imported instructions before they are used.'),
  });
  await page.waitForFunction(() => document.body.innerText.includes('Imported reviewer'), null, { timeout: 10000 });
  await assertReadyStatus(page, width, 'imported ready', '3 saved');
  await assertPresetRowBadges(page, width, 'imported row badges', ['outline', 'secondary', 'outline']);
  const importedState = await page.evaluate(() => window.__DEEPSEEKPP_PRESETS_STATUS_DOGFOOD_STATE__);
  await assertDogfood(importedState.savePresetPayloads.length === 1, `import SAVE_PRESET payload count mismatch at ${width}`);
  await assertDogfood(importedState.savePresetPayloads[0].name === 'Imported reviewer', `import preset name mismatch at ${width}`);
  await assertDogfood(importedState.savePresetPayloads[0].content === 'Review imported instructions before they are used.', `import preset content mismatch at ${width}`);
  await page.locator('.ds-preset-row').filter({ hasText: 'Imported reviewer' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, `preset-imported-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'imported preset');

  await page.locator('button[aria-label="Open navigation menu"]').click();
  await page.waitForSelector('#ds-v2-menu-panel', { timeout: 10000 });
  await waitForVisibleOpacity(page, '#ds-v2-menu-panel');
  let diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.menuOpen, `menu did not open from Presets at ${width}`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#ds-v2-menu-panel'), null, { timeout: 10000 });
  diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(!diagnostics.menuOpen, `menu did not close on Escape at ${width}`);
  await page.screenshot({ path: join(outDir, `preset-menu-escape-${width}.png`), fullPage: true });
  await context.close();
}

async function runEmptyCreateFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    presets: [],
    activePresetId: null,
  });
  await openPresetsThroughMenu(page, width, 'empty');
  await assertPresetHeaderActions(page, width, 'empty header');
  await page.waitForFunction(() => document.querySelector('.ds-preset-status-card')?.getAttribute('data-state') === 'empty', null, { timeout: 10000 });
  let diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.statusState === 'empty', `empty state mismatch at ${width}`);
  await assertDogfood(diagnostics.badgeText === 'No presets', `empty badge mismatch at ${width}: ${diagnostics.badgeText}`);
  await assertDogfood(diagnostics.badgeVariant === 'outline', `empty badge variant mismatch at ${width}: ${diagnostics.badgeVariant}`);
  await assertDogfood(diagnostics.contentText.includes('0 saved'), `empty preset count missing at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('Create reusable instructions, then choose one to apply.'), `empty next missing at ${width}`);
  await assertDogfood(diagnostics.emptySlots === 1, `empty shadcn slot count mismatch at ${width}`);
  await assertDogfood(diagnostics.footerButtons === 1, `empty card should show one footer New action at ${width}`);
  await page.screenshot({ path: join(outDir, `preset-empty-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'empty');

  await page.locator('.ds-preset-status-card [data-slot="card-footer"] [data-slot="button"]').click();
  await waitForPresetFormStable(page);
  await page.locator('input[placeholder="Code assistant"]').fill(`Status preset ${width}`);
  await page.locator('textarea[placeholder="Write the instructions this preset should apply to new chats."]').fill(`Keep Presets status verified at ${width}px.`);
  await assertButtonSlot(page, 'Cancel', 'create form', width);
  await assertButtonSlot(page, 'Save', 'create form', width);
  await page.screenshot({ path: join(outDir, `preset-create-form-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'create form');

  await page.locator('.ds-preset-form').getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction((target) => document.body.innerText.includes(target), `Status preset ${width}`, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.ds-preset-status-card')?.getAttribute('data-state') === 'inactive', null, { timeout: 10000 });
  await assertPresetRowBadges(page, width, 'created inactive row badge', ['outline']);
  diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.badgeText === 'Not selected', `inactive badge mismatch at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('1 saved'), `inactive preset count missing at ${width}`);
  await page.getByRole('button', { name: 'Use' }).first().click();
  await page.waitForFunction((target) => document.body.innerText.includes(`Using ${target}`), `Status preset ${width}`, { timeout: 10000 });
  await assertPresetRowBadges(page, width, 'created active row badge', ['secondary']);
  await page.screenshot({ path: join(outDir, `preset-created-active-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'created active');

  const dogfoodState = await page.evaluate(() => window.__DEEPSEEKPP_PRESETS_STATUS_DOGFOOD_STATE__);
  await assertDogfood(dogfoodState.savePresetPayloads.length === 1, `SAVE_PRESET payload count mismatch at ${width}`);
  await assertDogfood(dogfoodState.savePresetPayloads[0].name === `Status preset ${width}`, `preset save name mismatch at ${width}`);
  await assertDogfood(dogfoodState.savePresetPayloads[0].content === `Keep Presets status verified at ${width}px.`, `preset save content mismatch at ${width}`);
  await assertDogfood(dogfoodState.setActivePresetPayloads.length === 1, `SET_ACTIVE_PRESET payload count mismatch at ${width}`);
  await assertDogfood(dogfoodState.setActivePresetPayloads[0].id === dogfoodState.savePresetPayloads[0].id, `active preset id mismatch at ${width}`);
  await context.close();
}

async function runPresetLoadFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    presets: [codeReviewerPreset],
    activePresetId: codeReviewerPreset.id,
    failPresetLoadOnce: true,
  });
  await openPresetsThroughMenu(page, width, 'load-failure');
  await page.waitForFunction(() => document.querySelector('.ds-preset-status-card')?.getAttribute('data-state') === 'attention', null, { timeout: 10000 });
  let diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.statusState === 'attention', `load failure state mismatch at ${width}`);
  await assertDogfood(diagnostics.badgeText === 'Needs refresh', `load failure badge mismatch at ${width}`);
  await assertDogfood(diagnostics.badgeVariant === 'destructive', `load failure badge variant mismatch at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('Unavailable'), `load failure unavailable state missing at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('Retry preset library before assuming it is empty.'), `load failure next action missing at ${width}`);
  await assertDogfood(diagnostics.retryButtons === 1, `load failure should expose one retry button at ${width}`);
  await page.screenshot({ path: join(outDir, `preset-load-failure-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'load failure');

  await page.locator('.ds-preset-status-card [data-slot="button"]').focus();
  await page.keyboard.press('Enter');
  await assertReadyStatus(page, width, 'load recovered', '1 saved');
  await page.screenshot({ path: join(outDir, `preset-load-recovered-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'load recovered');
  await context.close();
}

async function runSelectionFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    presets: [codeReviewerPreset],
    activePresetId: codeReviewerPreset.id,
    failActiveLoadOnce: true,
  });
  await openPresetsThroughMenu(page, width, 'selection-failure');
  await page.waitForFunction(() => document.querySelector('.ds-preset-status-card')?.getAttribute('data-state') === 'attention', null, { timeout: 10000 });
  let diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.statusState === 'attention', `selection failure state mismatch at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('1 saved'), `selection failure should keep rows/count visible at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('Needs refresh'), `selection failure refresh state missing at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('Retry selection before trusting the current state.'), `selection failure next action missing at ${width}`);
  await assertDogfood(diagnostics.retryButtons === 1, `selection failure should expose one retry button at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('Code reviewer'), `selection failure should keep preset row visible at ${width}`);
  await page.screenshot({ path: join(outDir, `preset-selection-failure-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'selection failure');

  await page.locator('.ds-preset-status-card [data-slot="button"]').focus();
  await page.keyboard.press('Enter');
  await assertReadyStatus(page, width, 'selection recovered', '1 saved');
  await page.screenshot({ path: join(outDir, `preset-selection-recovered-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'selection recovered');
  await context.close();
}

await mkdir(outDir, { recursive: true });
const port = await listen();
const url = `http://127.0.0.1:${port}/sidepanel.html`;
const browser = await chromium.launch({ headless: true });

try {
  for (const width of [420, 360]) {
    await runReadyFlow(browser, url, width);
    await runEmptyCreateFlow(browser, url, width);
    await runPresetLoadFailureFlow(browser, url, width);
    await runSelectionFailureFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real command menu navigation opened Presets and Escape closed the menu',
      'Preset status Card/Header/Title/Description/Action/Content/Footer slots verified',
      'Preset status Badge variants verified for ready, empty, inactive, and source-failure states',
      'Preset row Badge variants and header Button icon slots verified',
      'Import action exercised the hidden file input and SAVE_PRESET payload matched imported markdown',
      'status-card New action opened the real create form',
      'form typed and submitted through visible Save action',
      'SAVE_PRESET payload matched typed values',
      'Use action updated active preset payload and visible ready state',
      'library-load failure showed one status-card Retry with sanitized visible text',
      'selection-load failure preserved visible preset rows and recovered through keyboard Enter on Retry',
      'no horizontal overflow at 420px or 360px',
      'no console/page errors',
      'visible leak pattern scan passed',
    ],
  };
  await writeFile(join(outDir, 'dogfood-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(outDir, 'audit-notes.md'), [
    '# Presets Status Card Dogfood',
    '',
    'Evidence source: production bundle `dist/chrome-mv3/sidepanel.html` served locally with a contract-shaped Chrome runtime/storage stub.',
    '',
    '1. Ready Presets through Menu - healthy. The command menu opened Presets, the status card showed Ready, the selected preset row used shadcn Badge state, header Import/New buttons carried lucide icons, imported markdown saved through the hidden file input, the imported row appeared, and Escape closed the menu.',
    '2. Empty and create - healthy. The status card showed No presets, its footer New action opened the real form, typed values saved through Save, and Use made the new preset active.',
    '3. Preset library failure - healthy. A raw failing source rendered sanitized unavailable copy, a single Retry action, and recovered by keyboard Enter.',
    '4. Selection failure - healthy. Existing rows stayed visible while selection needed refresh, Retry recovered to Ready, and no false empty state appeared.',
    '',
    'Checked: 420px and 360px, command menu, Presets status card slots, row Badge slots, header icon Button slots, file import payload, card New action, form typing/save, Use action, load failure, selection failure, keyboard retry, DOM overflow, console/page errors, and visible leak patterns.',
    '',
  ].join('\n'));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
