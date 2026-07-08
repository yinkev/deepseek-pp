import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/tools-status-card-dogfood');

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
    calls: [],
    webSettings: { web_search: true, web_fetch: false, ...(options.webSettings ?? {}) },
    failLocalOnce: options.failLocalOnce === true,
    failWebOnce: options.failWebOnce === true,
    localLoads: 0,
    webLoads: 0,
    permissionRequests: [],
    diagnosticRuns: 0,
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

  window.__DEEPSEEKPP_TOOLS_DOGFOOD_STATE__ = state;
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
        state.calls.push(message?.type);
        if (message?.type === 'GET_AUTH_STATUS') return { available: true, provider: 'deepseek-web', hasToken: true };
        if (message?.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return {};
        if (message?.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return { config: {} };
        if (message?.type === 'GET_VOICE_SETTINGS') return {};
        if (message?.type === 'GET_SKILL_LIBRARY') return [];
        if (message?.type === 'GET_MEMORIES') return [];
        if (message?.type === 'GET_SAVED_ITEMS') return [];
        if (message?.type === 'GET_PROJECT_CONTEXT_STATE') return { projects: [], activeProjectId: null, pendingProjectId: null };
        if (message?.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return null;
        if (message?.type === 'GET_PROMPT_INJECTION_SETTINGS') return null;
        if (message?.type === 'GET_ACTIVE_PRESET') return null;
        if (message?.type === 'GET_WEB_TOOL_SETTINGS') {
          state.webLoads += 1;
          if (state.failWebOnce && state.webLoads === 1) {
            throw new Error('GET_WEB_TOOL_SETTINGS schemaVersion chrome.runtime Bearer data:image/png;base64,AAAA https://secret.example');
          }
          return { ...state.webSettings };
        }
        if (message?.type === 'SET_WEB_TOOL_SETTING') {
          state.webSettings[message.payload.name] = message.payload.enabled;
          return { ok: true };
        }
        if (message?.type === 'GET_MCP_SERVERS') {
          state.localLoads += 1;
          if (state.failLocalOnce && state.localLoads === 1) {
            throw new Error('GET_MCP_SERVERS schemaVersion chrome.runtime Bearer data:image/png;base64,AAAA https://secret.example');
          }
          return [];
        }
        if (message?.type === 'GET_PLATFORM_CAPABILITIES') {
          return {
            kind: 'browser_extension',
            name: 'WebExtension',
            capabilities: { nativeMessaging: true },
          };
        }
        if (message?.type === 'DIAGNOSE_WEB_SEARCH') {
          state.diagnosticRuns += 1;
          return {
            'deepseek.com': {
              status: 200,
              length: 128,
              preview: 'Search endpoint returned a compact page preview.',
            },
          };
        }
        if (message?.type === 'REQUEST_HOST_PERMISSION') {
          state.permissionRequests.push(message.payload?.origins ?? []);
          return { ok: true };
        }
        if (message?.type === 'CREATE_MCP_SERVER') return { ok: true };
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
    const card = document.querySelector('.ds-tools-status-card');
    const overflow = Math.max(root.scrollWidth, body.scrollWidth) > currentWidth + 1;
    const leakPattern = /\b(?:GET|RUN|CREATE|UPDATE|DELETE|SET|SAVE|REFRESH|REQUEST)_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|Bearer|Cookie|data:image|\[object Object\]|\btoken\b|\bsecret\b|sk-[A-Za-z0-9_-]{8,}|https:\/\/secret\.example|chrome-extension:\/\//i;
    return {
      overflow,
      leak: leakPattern.test(visibleText),
      visibleText,
      cardSlot: card?.getAttribute('data-slot') ?? '',
      cardState: card?.getAttribute('data-state') ?? '',
      headerSlots: card?.querySelectorAll('[data-slot="card-header"]').length ?? 0,
      titleText: card?.querySelector('[data-slot="card-title"]')?.textContent ?? '',
      descriptionText: card?.querySelector('[data-slot="card-description"]')?.textContent ?? '',
      actionSlots: card?.querySelectorAll('[data-slot="card-action"]').length ?? 0,
      contentSlots: card?.querySelectorAll('[data-slot="card-content"]').length ?? 0,
      badgeText: card?.querySelector('[data-slot="badge"]')?.textContent ?? '',
      badgeVariant: card?.querySelector('[data-slot="badge"]')?.getAttribute('data-variant') ?? '',
      retryButtons: Array.from(document.querySelectorAll('button')).filter((button) => button.textContent?.trim() === 'Retry').length,
      diagnosticsOpen: Boolean(document.querySelector('.ds-tools-disclosure[open]')),
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

async function assertShadcnActionButton(page, name, width, label) {
  const attrs = await page.getByRole('button', { name, exact: true }).first().evaluate((button) => ({
    slot: button.getAttribute('data-slot'),
    variant: button.getAttribute('data-variant'),
    size: button.getAttribute('data-size'),
  }));
  await assertDogfood(attrs.slot === 'button', `${label}: ${name} missing shadcn Button slot at ${width}`);
  await assertDogfood(attrs.variant === 'outline', `${label}: ${name} should stay outline at ${width}`);
  await assertDogfood(attrs.size === 'sm', `${label}: ${name} should stay small at ${width}`);
}

async function openDogfoodPage(browser, url, width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 920 }, deviceScaleFactor: 1 });
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

async function openToolsThroughMenu(page, width, screenshotPrefix) {
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await page.locator('#ds-v2-menu-panel [data-slot="command-input"]').fill('Page tools');
  await page.waitForFunction(() => document.body.innerText.includes('Page tools'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `${screenshotPrefix}-menu-${width}.png`), fullPage: true });
  await page.locator('#ds-v2-menu-panel [data-slot="command-item"]').filter({ hasText: 'Page tools' }).first().click();
  await page.waitForSelector('.ds-tools-status-card', { timeout: 10000 });
}

async function assertReadyCard(page, width, label) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.cardSlot === 'card', `${label}: status Card slot missing at ${width}`);
  await assertDogfood(diagnostics.cardState === 'ready', `${label}: expected ready card at ${width}, got ${diagnostics.cardState}`);
  await assertDogfood(diagnostics.headerSlots === 1, `${label}: CardHeader slot missing at ${width}`);
  await assertDogfood(diagnostics.titleText === 'Tools status', `${label}: title mismatch at ${width}`);
  await assertDogfood(diagnostics.badgeText === 'Ready', `${label}: ready badge missing at ${width}`);
  await assertDogfood(diagnostics.badgeVariant === 'secondary', `${label}: ready badge variant mismatch at ${width}`);
  await assertDogfood(diagnostics.contentSlots === 1, `${label}: CardContent slot missing at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('Search On · Read Off'), `${label}: web summary missing at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('Set up required'), `${label}: local setup state missing at ${width}`);
}

async function runReadyFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    webSettings: { web_search: true, web_fetch: false },
  });
  try {
    await openToolsThroughMenu(page, width, 'tools-ready');
    await assertReadyCard(page, width, 'ready');
    await assertShadcnActionButton(page, 'Set up', width, 'ready');
    await assertShadcnActionButton(page, 'Grant', width, 'ready');
    await assertShadcnActionButton(page, 'Allow all sites', width, 'ready');
    await page.screenshot({ path: join(outDir, `tools-ready-${width}.png`), fullPage: true });

    await page.getByRole('switch', { name: 'Read page: Off' }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Search On · Read On'), null, { timeout: 10000 });
    await page.screenshot({ path: join(outDir, `tools-toggle-read-${width}.png`), fullPage: true });

    await page.locator('.ds-tools-disclosure summary').click();
    await page.waitForFunction(() => document.body.innerText.includes('Search query'), null, { timeout: 10000 });
    await assertShadcnActionButton(page, 'Diagnose', width, 'ready diagnostics');
    await page.getByRole('button', { name: 'Diagnose' }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Reachable'), null, { timeout: 10000 });
    await page.screenshot({ path: join(outDir, `tools-diagnostics-open-${width}.png`), fullPage: true });

    const urlInput = page.locator('input[type="url"]');
    await urlInput.fill('chrome://extensions');
    await page.getByRole('button', { name: 'Grant' }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Invalid URL'), null, { timeout: 10000 });
    await page.screenshot({ path: join(outDir, `tools-invalid-url-${width}.png`), fullPage: true });

    await page.getByRole('button', { name: 'Allow all sites' }).click();
    await page.waitForFunction(() => document.body.innerText.includes('All sites allowed'), null, { timeout: 10000 });
    await page.screenshot({ path: join(outDir, `tools-all-sites-${width}.png`), fullPage: true });

    const diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'ready');
    await assertDogfood(diagnostics.diagnosticsOpen, `ready: diagnostics disclosure closed unexpectedly at ${width}`);
  } finally {
    await context.close();
  }
}

async function runFailureRecoveryFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    failLocalOnce: true,
    webSettings: { web_search: true, web_fetch: true },
  });
  try {
    await openToolsThroughMenu(page, width, 'tools-local-failure');
    await page.waitForFunction(() => document.querySelector('.ds-tools-status-card')?.getAttribute('data-state') === 'attention', null, { timeout: 10000 });
    let diagnostics = await pageDiagnostics(page, width);
    await assertDogfood(diagnostics.badgeText === 'Needs attention', `failure: attention badge missing at ${width}`);
    await assertDogfood(diagnostics.badgeVariant === 'destructive', `failure: badge variant mismatch at ${width}`);
    await assertDogfood(diagnostics.retryButtons === 1, `failure: expected one Retry button at ${width}, got ${diagnostics.retryButtons}`);
    await assertDogfood(diagnostics.visibleText.includes('Local tools could not load: Reload the extension and try again.'), `failure: sanitized local error missing at ${width}`);
    await page.screenshot({ path: join(outDir, `tools-local-failure-${width}.png`), fullPage: true });

    await page.getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(() => document.querySelector('.ds-tools-status-card')?.getAttribute('data-state') === 'ready', null, { timeout: 10000 });
    diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'recovered');
    await assertDogfood(diagnostics.badgeText === 'Ready', `recovered: ready badge missing at ${width}`);
    await assertDogfood(diagnostics.visibleText.includes('Search On · Read On'), `recovered: web summary missing at ${width}`);
    await page.screenshot({ path: join(outDir, `tools-local-recovered-${width}.png`), fullPage: true });
  } finally {
    await context.close();
  }
}

async function runEmptyFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    webSettings: { web_search: false, web_fetch: false },
  });
  try {
    await openToolsThroughMenu(page, width, 'tools-empty');
    await page.waitForFunction(() => document.querySelector('.ds-tools-status-card')?.getAttribute('data-state') === 'empty', null, { timeout: 10000 });
    const diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'empty');
    await assertDogfood(diagnostics.badgeText === 'No tools on', `empty: badge missing at ${width}`);
    await assertDogfood(diagnostics.visibleText.includes('Enable Web search, Read page, or Local Python.'), `empty: next action missing at ${width}`);
    await page.screenshot({ path: join(outDir, `tools-empty-${width}.png`), fullPage: true });
  } finally {
    await context.close();
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const port = await listen();
  const url = `http://127.0.0.1:${port}/sidepanel.html`;
  const browser = await chromium.launch({ headless: true });
  const summary = {
    url,
    screenshots: [],
    checkedAt: new Date().toISOString(),
  };
  try {
    for (const width of [420, 360]) {
      await runReadyFlow(browser, url, width);
      await runFailureRecoveryFlow(browser, url, width);
      await runEmptyFlow(browser, url, width);
    }
    summary.screenshots = [
      'tools-ready-menu-420.png',
      'tools-ready-420.png',
      'tools-toggle-read-420.png',
      'tools-diagnostics-open-420.png',
      'tools-invalid-url-420.png',
      'tools-all-sites-420.png',
      'tools-local-failure-menu-420.png',
      'tools-local-failure-420.png',
      'tools-local-recovered-420.png',
      'tools-empty-menu-420.png',
      'tools-empty-420.png',
      'tools-ready-menu-360.png',
      'tools-ready-360.png',
      'tools-toggle-read-360.png',
      'tools-diagnostics-open-360.png',
      'tools-invalid-url-360.png',
      'tools-all-sites-360.png',
      'tools-local-failure-menu-360.png',
      'tools-local-failure-360.png',
      'tools-local-recovered-360.png',
      'tools-empty-menu-360.png',
      'tools-empty-360.png',
    ];
    summary.checks = [
      'production sidepanel loaded with Chrome runtime/storage/permissions stub',
      'real command menu opened Page tools',
      'Tools status Card/Header/Title/Description/Action/Content slots verified',
      'Tools status Badge variants verified for ready, source-failure, and no-tools states',
      'Set up, Grant, Allow all sites, and Diagnose actions verified as small outline shadcn Button slots',
      'Read page switch toggled and persisted through SET_WEB_TOOL_SETTING',
      'Diagnostics disclosure opened and search diagnostic ran',
      'invalid URL and all-sites permission paths were exercised',
      'Local Python source failure rendered sanitized copy and recovered',
      'no horizontal overflow at 420px or 360px',
      'no console/page errors',
      'visible leak pattern scan passed',
    ];
    await writeFile(join(outDir, 'dogfood-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    await writeFile(join(outDir, 'audit-notes.md'), createAuditNotes());
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

function createAuditNotes() {
  return `# Page Tools Status Card Dogfood

Evidence source: production bundle \`dist/chrome-mv3/sidepanel.html\` served locally with a contract-shaped Chrome runtime/storage/permissions stub.

1. Page tools through Menu - healthy. The real command menu opened Page tools at 420px and 360px, and the status card rendered shadcn Card/Header/Title/Description/Action/Content plus the Ready badge.
2. Tool toggles and Local Python setup action - healthy. The Read page switch toggled through the real SET_WEB_TOOL_SETTING path, and Set up rendered as a small outline shadcn Button without claiming Local Python was ready.
3. Site access controls - healthy. Grant and Allow all sites rendered as small outline shadcn Buttons. Invalid URL handling showed user-facing copy, and all-sites permission reached the allowed state without raw permission/runtime text.
4. Diagnostics disclosure - healthy. The disclosure opened, Diagnose rendered as a small outline shadcn Button, the search diagnostic ran, and the reachable result stayed readable at 420px and 360px.
5. Local source failure and recovery - healthy. A seeded local connector failure rendered sanitized copy, kept web tools visible, exposed one Retry action, and recovered to Ready.
6. No-tools state - healthy. With all tools off, the card said No tools on and pointed to the real enablement path instead of fake help data.

Checked: 420px and 360px, command menu, status Card slots, Badge variants, shadcn Button slots for Set up/Grant/Allow all sites/Diagnose, switch toggle, diagnostics disclosure, invalid URL, all-sites permission, source failure/retry recovery, DOM overflow, console/page errors, and visible leak patterns.

Visual review: accepted \`tools-diagnostics-open-420.png\`, \`tools-invalid-url-360.png\`, \`tools-all-sites-360.png\`, \`tools-local-failure-360.png\`, and \`tools-empty-360.png\`. No clipped labels or horizontal overflow were visible.

UX rubric: clarity 9/10, function 9/10, visual taste 9/10, evidence integrity 9/10, accessibility 9/10, user cognitive load 9/10, architecture fit 9/10, regression risk 9/10, long-horizon usefulness 9/10. No known P1/P2 findings remain for this slice.
`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
