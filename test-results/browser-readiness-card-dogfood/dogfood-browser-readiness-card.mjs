import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/browser-readiness-card-dogfood');

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

const controllableTarget = {
  id: 101,
  windowId: 1,
  windowHint: null,
  groupId: -1,
  active: true,
  currentWindow: true,
  title: 'Research plan',
  url: 'https://docs.example.test/research',
  controllable: true,
};

const secondTarget = {
  id: 102,
  windowId: 1,
  windowHint: null,
  groupId: -1,
  active: false,
  currentWindow: false,
  title: 'Evidence workspace',
  url: 'https://evidence.example.test',
  controllable: true,
};

const blockedTarget = {
  id: 103,
  windowId: 1,
  windowHint: null,
  groupId: -1,
  active: false,
  currentWindow: false,
  title: 'DeepSeek++',
  url: 'chrome-extension://internal/sidepanel.html',
  controllable: false,
  reason: 'Unsupported URL scheme for browser control: chrome-extension',
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
    deepseek_pp_chat_enabled: true,
  };
  const runtimeListeners = [];
  const storageListeners = [];
  const settings = {
    enabled: true,
    targetTabId: options.startTargetId ?? null,
    lastTargetHint: null,
    targetLock: null,
    includeSnapshotAfterActions: false,
    allowVisionCapture: true,
    verifyAfterActions: true,
    collectEvidencePacks: true,
    debugDistillerEnabled: true,
    maxSnapshotNodes: 400,
    maxSnapshotTextBytes: 24000,
  };
  const state = {
    calls: [],
    targetPayloads: [],
    savedPatches: [],
    lockPayloads: [],
    loadCount: 0,
    failLoadOnce: options.failLoadOnce === true,
    failTargetAction: options.failTargetAction === true,
    attached: false,
  };
  const targets = [
    options.controllableTarget,
    options.secondTarget,
    options.blockedTarget,
  ].map((target) => ({ ...target }));

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

  function browserState() {
    const target = targets.find((candidate) => candidate.id === settings.targetTabId) ?? null;
    return {
      supported: true,
      enabled: settings.enabled,
      attached: state.attached,
      targetTabId: settings.targetTabId,
      target,
      targets: targets.map((targetOption) => ({ ...targetOption })),
      error: null,
    };
  }

  window.__DEEPSEEKPP_BROWSER_DOGFOOD_STATE__ = state;
  window.chrome = {
    i18n: {
      getUILanguage: () => 'zh-CN',
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
        if (message?.type === 'GET_PROJECT_CONTEXT_STATE') return { schemaVersion: 2, projects: [], conversations: [], pendingProjectId: null };
        if (message?.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
        if (message?.type === 'GET_MEMORIES') return [];
        if (message?.type === 'GET_SAVED_ITEMS') return [];
        if (message?.type === 'GET_PRESETS') return [];
        if (message?.type === 'GET_ACTIVE_PRESET') return null;
        if (message?.type === 'GET_SKILL_LIBRARY') return [];
        if (message?.type === 'GET_SKILL_SOURCES') return [];
        if (message?.type === 'GET_BROWSER_CONTROL_SETTINGS') return { ...settings };
        if (message?.type === 'GET_BROWSER_CONTROL_STATE') {
          state.loadCount += 1;
          if (state.failLoadOnce) {
            state.failLoadOnce = false;
            throw new Error('tab query failed');
          }
          return browserState();
        }
        if (message?.type === 'SET_BROWSER_CONTROL_TARGET') {
          state.targetPayloads.push(message.payload);
          if (state.failTargetAction) {
            return { ok: false, error: { message: 'SET_BROWSER_CONTROL_TARGET permission denied' } };
          }
          settings.targetTabId = message.payload?.tabId ?? null;
          return { ok: true };
        }
        if (message?.type === 'SAVE_BROWSER_CONTROL_SETTINGS') {
          state.savedPatches.push(message.payload);
          Object.assign(settings, message.payload ?? {});
          return { ...settings };
        }
        if (message?.type === 'SET_BROWSER_CONTROL_ENABLED') {
          settings.enabled = Boolean(message.payload?.enabled);
          return { ...settings };
        }
        if (message?.type === 'LOCK_BROWSER_CONTROL_TARGET') {
          state.lockPayloads.push(message.payload);
          const activeTarget = targets.find((candidate) => candidate.id === settings.targetTabId);
          settings.targetLock = {
            enabled: true,
            label: message.payload?.label ?? activeTarget?.title ?? 'Browser target',
            targetTabId: settings.targetTabId,
            windowId: activeTarget?.windowId ?? 1,
            windowHint: null,
            groupId: null,
            origin: 'https://docs.example.test',
            updatedAt: Date.now(),
          };
          return { ok: true };
        }
        if (message?.type === 'CLEAR_BROWSER_CONTROL_TARGET_LOCK') {
          settings.targetLock = null;
          return { ok: true };
        }
        if (message?.type === 'DETACH_BROWSER_CONTROL') {
          state.attached = false;
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
    const overflow = Math.max(root.scrollWidth, body.scrollWidth) > currentWidth + 1;
    const leakPattern = /\bGET_[A-Z0-9_]+\b|\bSET_[A-Z0-9_]+\b|\bSAVE_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|Bearer|Cookie|data:image|\[object Object\]|#10[0-9]|Unsupported URL scheme|permission denied|sk-[A-Za-z0-9_-]{8,}/;
    const readiness = document.querySelector('.ds-browser-readiness');
    const targetList = document.querySelector('.ds-browser-target-list');
    return {
      overflow,
      leak: leakPattern.test(visibleText),
      visibleText,
      readinessSlot: readiness?.getAttribute('data-slot') ?? '',
      readinessSize: readiness?.getAttribute('data-size') ?? '',
      cardHeaderSlots: readiness?.querySelectorAll('[data-slot="card-header"]').length ?? 0,
      cardTitle: readiness?.querySelector('[data-slot="card-title"]')?.textContent?.trim() ?? '',
      cardDescription: readiness?.querySelector('[data-slot="card-description"]')?.textContent?.trim() ?? '',
      cardContentSlots: readiness?.querySelectorAll('[data-slot="card-content"]').length ?? 0,
      badgeText: readiness?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent?.trim() ?? '',
      badgeVariant: readiness?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.getAttribute('data-variant') ?? '',
      readinessButtonSlots: readiness?.querySelectorAll('[data-slot="button"]').length ?? 0,
      pageButtonSlots: document.querySelectorAll('[data-slot="button"]').length,
      statusRows: readiness?.querySelectorAll('.ds-browser-status-row').length ?? 0,
      targetRows: targetList?.querySelectorAll('.ds-browser-target-row').length ?? 0,
      selectedTargets: targetList?.querySelectorAll('.ds-browser-target-badge[data-selected="true"]').length ?? 0,
      advancedOpen: document.querySelector('.ds-browser-advanced')?.hasAttribute('open') ?? false,
    };
  }, width);
}

async function checkNoGlobalFailures(page, consoleErrors, pageErrors, width, label) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(!diagnostics.overflow, `${label}: horizontal overflow at ${width}`);
  await assertDogfood(!diagnostics.leak, `${label}: visible leak pattern at ${width}`);
  await assertDogfood(consoleErrors.length === 0, `${label}: console errors at ${width}: ${consoleErrors.join(' | ')}`);
  await assertDogfood(pageErrors.length === 0, `${label}: page errors at ${width}: ${pageErrors.join(' | ')}`);
  return diagnostics;
}

async function assertReadinessCard(page, width, expected) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.readinessSlot === 'card', `readiness Card slot missing at ${width}`);
  await assertDogfood(diagnostics.readinessSize === 'sm', `readiness Card size mismatch at ${width}`);
  await assertDogfood(diagnostics.cardHeaderSlots === 1, `readiness CardHeader missing at ${width}`);
  await assertDogfood(diagnostics.cardTitle === '浏览器状态', `readiness title mismatch at ${width}: ${diagnostics.cardTitle}`);
  await assertDogfood(diagnostics.cardContentSlots === 1, `readiness CardContent missing at ${width}`);
  await assertDogfood(diagnostics.statusRows === 3, `readiness status rows mismatch at ${width}`);
  await assertDogfood(diagnostics.badgeText === expected.badgeText, `readiness badge mismatch at ${width}: ${diagnostics.badgeText}`);
  await assertDogfood(diagnostics.badgeVariant === expected.badgeVariant, `readiness badge variant mismatch at ${width}: ${diagnostics.badgeVariant}`);
  await assertDogfood(diagnostics.cardDescription.includes(expected.description), `readiness description mismatch at ${width}: ${diagnostics.cardDescription}`);
  await assertDogfood(diagnostics.visibleText.includes(expected.next), `readiness next step missing at ${width}: ${expected.next}`);
  await assertDogfood(diagnostics.pageButtonSlots >= 2, `shadcn Button slots missing at ${width}`);
  return diagnostics;
}

async function openBrowserThroughMenu(page) {
  await page.locator('button[aria-label="打开导航菜单"]').click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await page.locator('#ds-v2-menu-panel [data-slot="command-input"]').fill('浏览器');
  await page.waitForFunction(() => document.body.innerText.includes('浏览器'), null, { timeout: 10000 });
  await page.locator('#ds-v2-menu-panel [data-slot="command-item"]').filter({ hasText: '浏览器' }).first().click();
  await page.waitForSelector('.ds-browser-readiness', { timeout: 10000 });
}

async function scrollReadinessIntoView(page) {
  await page.locator('.ds-browser-readiness').scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
}

async function scrollAdvancedIntoView(page) {
  await page.evaluate(() => {
    document.querySelector('.ds-browser-advanced')?.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(80);
}

async function openDogfoodPage(browser, url, width, options) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, {
    ...options,
    controllableTarget,
    secondTarget,
    blockedTarget,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  const shellReady = await page.waitForSelector('button[aria-label="打开导航菜单"]', { timeout: 10000 }).catch(() => null);
  if (!shellReady) {
    await page.screenshot({ path: join(outDir, `browser-shell-boot-failed-${width}.png`), fullPage: true });
    const bootText = await page.locator('body').innerText().catch(() => '');
    await writeFile(join(outDir, `browser-shell-boot-failed-${width}.txt`), [
      `body=${bootText}`,
      `console=${consoleErrors.join(' | ')}`,
      `pageErrors=${pageErrors.join(' | ')}`,
    ].join('\n'));
    throw new Error(`sidepanel shell did not boot at ${width}`);
  }
  await openBrowserThroughMenu(page);
  return { context, page, consoleErrors, pageErrors };
}

async function runTargetSelectionFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    startTargetId: null,
  });
  await assertReadinessCard(page, width, {
    badgeText: '需要目标',
    badgeVariant: 'secondary',
    description: '依赖浏览器上下文前',
    next: '选择目标',
  });
  let diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'needs target');
  await assertDogfood(diagnostics.readinessButtonSlots === 1, `choose target Button slot missing at ${width}`);
  await assertDogfood(diagnostics.targetRows === 3, `target rows missing at ${width}`);
  await scrollReadinessIntoView(page);
  await page.screenshot({ path: join(outDir, `browser-needs-target-${width}.png`), fullPage: true });

  await page.locator('.ds-browser-readiness [data-slot="button"]').click();
  const focusedText = await page.evaluate(() => document.activeElement?.textContent ?? '');
  await assertDogfood(focusedText.includes('Research plan'), `choose target did not focus first controllable target at ${width}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('可使用'), null, { timeout: 10000 });
  await assertReadinessCard(page, width, {
    badgeText: '可使用',
    badgeVariant: 'outline',
    description: '已选择目标',
    next: '继续',
  });
  diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'ready after target selection');
  await assertDogfood(diagnostics.selectedTargets === 1, `selected target row missing at ${width}`);
  await scrollReadinessIntoView(page);
  await page.screenshot({ path: join(outDir, `browser-ready-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: '锁定目标' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('已保存目标记忆。'), null, { timeout: 10000 });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'target locked');
  await scrollReadinessIntoView(page);
  await page.screenshot({ path: join(outDir, `browser-target-locked-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: '清除锁定' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('已清除目标记忆。'), null, { timeout: 10000 });

  await page.locator('.ds-browser-advanced summary').click();
  await scrollAdvancedIntoView(page);
  diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'advanced opened');
  await assertDogfood(diagnostics.advancedOpen, `advanced details did not open at ${width}`);
  await page.screenshot({ path: join(outDir, `browser-advanced-${width}.png`), fullPage: true });

  const state = await page.evaluate(() => window.__DEEPSEEKPP_BROWSER_DOGFOOD_STATE__);
  await assertDogfood(state.targetPayloads.some((payload) => payload?.tabId === 101), `target payload missing at ${width}`);
  await assertDogfood(state.lockPayloads.length === 1, `target lock payload missing at ${width}`);
  await context.close();
}

async function runLoadFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    startTargetId: 101,
    failLoadOnce: true,
  });
  await assertReadinessCard(page, width, {
    badgeText: '需要刷新',
    badgeVariant: 'destructive',
    description: '浏览器目标状态无法加载',
    next: '重试浏览器状态',
  });
  await assertDogfood(await page.getByRole('button', { name: '重试' }).count() === 1, `retry action missing at ${width}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'load failure');
  await scrollReadinessIntoView(page);
  await page.screenshot({ path: join(outDir, `browser-load-failure-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: '重试' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('可使用'), null, { timeout: 10000 });
  await assertReadinessCard(page, width, {
    badgeText: '可使用',
    badgeVariant: 'outline',
    description: '已选择目标',
    next: '继续',
  });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'load failure recovered');
  const state = await page.evaluate(() => window.__DEEPSEEKPP_BROWSER_DOGFOOD_STATE__);
  await assertDogfood(state.loadCount >= 2, `retry did not reload browser state at ${width}`);
  await scrollReadinessIntoView(page);
  await page.screenshot({ path: join(outDir, `browser-recovered-ready-${width}.png`), fullPage: true });
  await context.close();
}

async function runTargetActionFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    startTargetId: null,
    failTargetAction: true,
  });
  await page.locator('.ds-browser-target-row').filter({ hasText: 'Research plan' }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes('浏览器操作失败：选择目标标签页失败。'), null, { timeout: 10000 });
  await assertReadinessCard(page, width, {
    badgeText: '需要目标',
    badgeVariant: 'secondary',
    description: '依赖浏览器上下文前',
    next: '选择目标',
  });
  const diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'target action failure');
  await assertDogfood(diagnostics.visibleText.includes('Research plan'), `reachable target disappeared after failure at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('可用'), `available state disappeared after failure at ${width}`);
  await page.screenshot({ path: join(outDir, `browser-target-action-failure-${width}.png`), fullPage: true });
  await context.close();
}

await mkdir(outDir, { recursive: true });
const port = await listen();
const url = `http://127.0.0.1:${port}/sidepanel.html`;
const browser = await chromium.launch({ headless: true });

try {
  for (const width of [420, 360]) {
    await runTargetSelectionFlow(browser, url, width);
    await runLoadFailureFlow(browser, url, width);
    await runTargetActionFailureFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real command menu opened Browser through shadcn CommandDialog',
      'Browser readiness Card/Header/Title/Description/Action/Content slots verified',
      'Browser readiness Badge variants verified for needs-target, ready, and load-failure states',
      'Browser readiness Button action focused the first controllable target',
      'keyboard Enter selected the focused target',
      'target lock and clear-lock actions were clicked and verified',
      'advanced snapshot details were opened and verified',
      'load failure rendered a retry action and recovered after click',
      'target action failure surfaced sanitized copy without removing reachable targets',
      'no horizontal overflow at 420px or 360px',
      'no console/page errors',
      'visible leak pattern scan passed',
    ],
  };
  await writeFile(join(outDir, 'dogfood-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
