import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/settings-status-card-dogfood');

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

const usageSummary = {
  rangeDays: 30,
  generatedAt: Date.now(),
  totalTokens: 1200,
  sessionCount: 2,
  messageCount: 6,
  turnCount: 3,
  activeDays: 2,
  currentStreak: 1,
  serverTokenRecordCount: 2,
  mostUsedModel: {
    modelKey: 'deepseek-chat',
    modelLabel: 'DeepSeek Chat',
    totalTokens: 900,
    turnCount: 2,
    messageCount: 4,
    sessionCount: 1,
    share: 0.75,
  },
  days: [],
  heatmap: [],
  modelUsage: [],
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
  const state = {
    failApiOnce: options.failApiOnce === true,
    apiStatusCalls: 0,
    runtimeCalls: [],
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

  window.__DEEPSEEKPP_SETTINGS_DOGFOOD_STATE__ = state;
  window.chrome = {
    i18n: {
      getUILanguage: () => 'en',
      getMessage: () => '',
    },
    runtime: {
      getManifest: () => ({ version: '9.9.9' }),
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
        if (message?.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web', hasToken: true };
        if (message?.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
        if (message?.type === 'GET_VOICE_SETTINGS') return {};
        if (message?.type === 'GET_USAGE_SUMMARY') return usageSummary;
        if (message?.type === 'GET_DEEPSEEK_API_KEY_STATUS') {
          state.apiStatusCalls += 1;
          if (state.failApiOnce && state.apiStatusCalls === 1) {
            return {
              ok: false,
              error: {
                message: 'GET_DEEPSEEK_API_KEY_STATUS schemaVersion chrome.storage Bearer token secret [object Object]',
              },
            };
          }
          return { configured: true };
        }
        if (message?.type === 'GET_MULTIMODAL_SETTINGS_STATUS') {
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
        if (message?.type === 'GET_MEMORIES') return [];
        if (message?.type === 'GET_CONFIG') return { version: '9.9.9' };
        if (message?.type === 'GET_SYNC_CONFIG') {
          return {
            url: 'https://dav.example.test/remote.php/dav/files/deepseek',
            username: 'deepseek-user',
            password: 'stored-password',
            remotePath: 'DeepSeekPP',
            lastSyncAt: null,
          };
        }
        if (message?.type === 'GET_MODEL_TYPE') return null;
        if (message?.type === 'GET_BACKGROUND') return null;
        if (message?.type === 'GET_PET') return null;
        if (message?.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return { config: {} };
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
    permissions: {
      contains: async () => true,
      request: async () => true,
    },
    tabs: {
      create: async () => ({}),
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
    const card = document.querySelector('.ds-settings-status-card');
    const overflow = Math.max(root.scrollWidth, body.scrollWidth) > currentWidth + 1;
    const leakPattern = /\bGET_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|Bearer|Cookie|data:image|\[object Object\]|\btoken\b|\bsecret\b|sk-[A-Za-z0-9_-]{8,}/i;
    return {
      overflow,
      leak: leakPattern.test(visibleText),
      visibleText,
      cardSlot: card?.getAttribute('data-slot') ?? '',
      cardSize: card?.getAttribute('data-size') ?? '',
      cardState: card?.getAttribute('data-state') ?? '',
      headerSlots: card?.querySelectorAll('[data-slot="card-header"]').length ?? 0,
      titleText: card?.querySelector('[data-slot="card-title"]')?.textContent ?? '',
      descriptionText: card?.querySelector('[data-slot="card-description"]')?.textContent ?? '',
      actionSlots: card?.querySelectorAll('[data-slot="card-action"]').length ?? 0,
      contentSlots: card?.querySelectorAll('[data-slot="card-content"]').length ?? 0,
      badgeText: card?.querySelector('[data-slot="badge"]')?.textContent ?? '',
      badgeVariant: card?.querySelector('[data-slot="badge"]')?.getAttribute('data-variant') ?? '',
      buttonSlots: card?.querySelectorAll('[data-slot="button"]').length ?? 0,
      warningButtons: document.querySelectorAll('.ds-settings-load-issue button').length,
      selectOpen: Boolean(document.querySelector('[data-slot="select-content"]')),
    };
  }, width);
}

async function checkNoGlobalFailures(page, consoleErrors, pageErrors, width, label) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(!diagnostics.overflow, `${label}: horizontal overflow at ${width}`);
  await assertDogfood(!diagnostics.leak, `${label}: visible leak pattern at ${width}: ${diagnostics.visibleText.slice(0, 1200)}`);
  await assertDogfood(consoleErrors.length === 0, `${label}: console errors at ${width}: ${consoleErrors.join(' | ')}`);
  await assertDogfood(pageErrors.length === 0, `${label}: page errors at ${width}: ${pageErrors.join(' | ')}`);
  return diagnostics;
}

async function openSettingsThroughMenu(page, width, screenshotPrefix) {
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await page.locator('#ds-v2-menu-panel [data-slot="command-input"]').fill('Settings');
  await page.waitForFunction(() => document.body.innerText.includes('Settings'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `${screenshotPrefix}-menu-${width}.png`), fullPage: true });
  await page.locator('#ds-v2-menu-panel [data-slot="command-item"]').filter({ hasText: 'Settings' }).first().click();
  await page.waitForSelector('.ds-settings-status-card', { timeout: 10000 });
}

async function openDogfoodPage(browser, url, width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, options);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="Open navigation menu"]', { timeout: 10000 });
  return { context, page, consoleErrors, pageErrors };
}

async function assertReadyStatus(page, width, label) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.cardSlot === 'card', `${label}: Settings status Card slot missing at ${width}`);
  await assertDogfood(diagnostics.cardSize === 'sm', `${label}: Settings status Card size mismatch at ${width}`);
  await assertDogfood(diagnostics.cardState === 'ready', `${label}: Settings status is not ready at ${width}: ${diagnostics.cardState}`);
  await assertDogfood(diagnostics.headerSlots === 1, `${label}: CardHeader missing at ${width}`);
  await assertDogfood(diagnostics.actionSlots === 1, `${label}: CardAction missing at ${width}`);
  await assertDogfood(diagnostics.contentSlots === 1, `${label}: CardContent missing at ${width}`);
  await assertDogfood(diagnostics.titleText === 'Settings status', `${label}: title mismatch at ${width}: ${diagnostics.titleText}`);
  await assertDogfood(diagnostics.descriptionText.includes('Saved settings loaded'), `${label}: ready description missing at ${width}`);
  await assertDogfood(diagnostics.badgeText === 'Ready', `${label}: ready badge mismatch at ${width}: ${diagnostics.badgeText}`);
  await assertDogfood(diagnostics.badgeVariant === 'secondary', `${label}: ready badge variant mismatch at ${width}: ${diagnostics.badgeVariant}`);
  await assertDogfood(diagnostics.visibleText.includes('Current view'), `${label}: current-view row missing at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('Sources'), `${label}: source row missing at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('Loaded'), `${label}: loaded source state missing at ${width}`);
  await assertDogfood(diagnostics.buttonSlots === 0, `${label}: ready card should not show retry at ${width}`);
  return diagnostics;
}

async function runReadyFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width);
  await openSettingsThroughMenu(page, width, 'settings-ready');
  await assertReadyStatus(page, width, 'ready');
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'ready');
  await page.screenshot({ path: join(outDir, `settings-ready-${width}.png`), fullPage: true });

  const viewTrigger = page.locator('.ds-settings-picker').filter({ hasText: 'View' }).locator('[data-slot="select-trigger"]');
  await viewTrigger.click();
  await page.waitForSelector('[data-slot="select-content"]', { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `settings-picker-open-${width}.png`), fullPage: true });
  let diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.selectOpen, `Settings picker did not open at ${width}`);
  await page.getByRole('option', { name: 'Data' }).click();
  await page.waitForFunction(() => document.querySelector('.ds-settings-status-card')?.textContent?.includes('Data'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `settings-data-${width}.png`), fullPage: true });
  diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'data view');
  await assertDogfood(diagnostics.visibleText.includes('Current view') && diagnostics.visibleText.includes('Data'), `Settings status did not update current view to Data at ${width}`);
  await context.close();
}

async function runFailureRecoveryFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, { failApiOnce: true });
  await openSettingsThroughMenu(page, width, 'settings-failure');
  await page.waitForFunction(() => document.querySelector('.ds-settings-status-card')?.getAttribute('data-state') === 'issue', null, { timeout: 10000 });
  let diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.cardState === 'issue', `failure card state mismatch at ${width}: ${diagnostics.cardState}`);
  await assertDogfood(diagnostics.badgeText === 'Needs refresh', `failure badge mismatch at ${width}: ${diagnostics.badgeText}`);
  await assertDogfood(diagnostics.badgeVariant === 'destructive', `failure badge variant mismatch at ${width}: ${diagnostics.badgeVariant}`);
  await assertDogfood(diagnostics.descriptionText.includes('Sources needing refresh: 1'), `failure description mismatch at ${width}: ${diagnostics.descriptionText}`);
  await assertDogfood(diagnostics.buttonSlots === 1, `failure card should show one retry button at ${width}`);
  await assertDogfood(diagnostics.warningButtons === 0, `detailed warning should not duplicate retry at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('Settings need refresh'), `detailed warning missing at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('Load failed'), `sanitized load failure missing at ${width}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'failure');
  await page.screenshot({ path: join(outDir, `settings-load-failure-${width}.png`), fullPage: true });

  await page.locator('.ds-settings-status-card [data-slot="button"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.ds-settings-status-card')?.getAttribute('data-state') === 'ready', null, { timeout: 10000 });
  diagnostics = await assertReadyStatus(page, width, 'recovered');
  const state = await page.evaluate(() => window.__DEEPSEEKPP_SETTINGS_DOGFOOD_STATE__);
  await assertDogfood(state.apiStatusCalls >= 2, `Settings retry did not reload API status at ${width}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'recovered');

  const viewTrigger = page.locator('.ds-settings-picker').filter({ hasText: 'View' }).locator('[data-slot="select-trigger"]');
  await viewTrigger.click();
  await page.waitForSelector('[data-slot="select-content"]', { timeout: 10000 });
  await page.getByRole('option', { name: 'API' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Configured'), null, { timeout: 10000 });
  diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'recovered api view');
  await assertDogfood(diagnostics.visibleText.includes('Configured'), `recovered API state missing at ${width}`);
  await page.screenshot({ path: join(outDir, `settings-recovered-${width}.png`), fullPage: true });
  await context.close();
}

await mkdir(outDir, { recursive: true });
const port = await listen();
const url = `http://127.0.0.1:${port}/sidepanel.html`;
const browser = await chromium.launch({ headless: true });

try {
  for (const width of [420, 360]) {
    await runReadyFlow(browser, url, width);
    await runFailureRecoveryFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real command menu opened Settings through shadcn CommandDialog',
      'Settings status Card/Header/Title/Description/Action/Content slots verified',
      'Settings status Badge variants verified for ready and source-failure states',
      'Settings View dropdown opened and changed current view to Data',
      'source failure rendered sanitized Settings need refresh details with no duplicate warning retry',
      'status-card Retry recovered through keyboard Enter and reloaded API status',
      'no horizontal overflow at 420px or 360px',
      'no console/page errors',
      'visible leak pattern scan passed',
    ],
  };
  await writeFile(join(outDir, 'dogfood-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(outDir, 'audit-notes.md'), [
    '# Settings Status Card Dogfood',
    '',
    'Evidence source: production bundle `dist/chrome-mv3/sidepanel.html` served locally with a contract-shaped Chrome runtime/storage stub.',
    '',
    '1. Ready Settings through Menu - healthy. The real command menu opened Settings, the status card rendered with shadcn Card/Badge slots, and no retry action was shown.',
    '2. Settings View dropdown - healthy. The real View dropdown opened, Data was selected, and the status card updated its current-view row without overflow.',
    '3. Source failure and keyboard recovery - healthy. The status card showed `Needs refresh`, the detailed warning listed sanitized source evidence without a second Retry button, and keyboard Enter on the card Retry recovered to ready/configured state.',
    '',
    'Checked: 420px and 360px, command menu, Settings status card slots, View dropdown, source failure, keyboard retry recovery, DOM overflow, console/page errors, and visible leak patterns.',
    '',
  ].join('\n'));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
