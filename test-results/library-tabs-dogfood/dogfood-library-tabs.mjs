import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/library-tabs-dogfood');

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

const memories = [
  {
    id: 1,
    syncId: 'memory-1',
    scope: 'global',
    type: 'preference',
    name: 'Stable writing preference',
    content: 'Keep answers direct.',
    description: 'Communication style',
    tags: ['style'],
    pinned: true,
    createdAt: 1,
    updatedAt: 10,
    accessCount: 1,
    lastAccessedAt: 10,
  },
  {
    id: 2,
    syncId: 'memory-2',
    scope: 'global',
    type: 'fact',
    name: 'Workbench scope',
    content: 'DeepSeek++ should stay truthful about context.',
    description: '',
    tags: [],
    pinned: false,
    createdAt: 2,
    updatedAt: 20,
    accessCount: 0,
    lastAccessedAt: 0,
  },
];

const savedItems = [
  {
    id: 'saved-1',
    syncId: 'saved-sync-1',
    kind: 'snippet',
    title: 'Review checklist',
    content: 'Check risk, evidence, accessibility, and recovery.',
    tags: ['review'],
    createdAt: 1,
    updatedAt: 5,
  },
];

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
  const state = {
    calls: [],
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

  window.__DEEPSEEKPP_LIBRARY_TABS_DOGFOOD_STATE__ = state;
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
        if (message?.type === 'GET_MEMORIES') return options.memories;
        if (message?.type === 'GET_SAVED_ITEMS') return options.savedItems;
        if (message?.type === 'GET_SKILL_LIBRARY') return [];
        if (message?.type === 'GET_SKILL_SOURCES') return [];
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
    const leakPattern = /\bGET_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|Bearer|Cookie|data:image|\[object Object\]|sk-[A-Za-z0-9_-]{8,}/;
    const tabs = document.querySelector('[aria-label="资料子导航"] [data-slot="tabs"]');
    const list = document.querySelector('[aria-label="资料子导航"] [data-slot="tabs-list"]');
    const triggers = Array.from(document.querySelectorAll('[aria-label="资料子导航"] [data-slot="tabs-trigger"]'))
      .map((trigger) => ({
        text: trigger.textContent?.trim() ?? '',
        state: trigger.getAttribute('data-state'),
        ariaSelected: trigger.getAttribute('aria-selected'),
      }));
    return {
      overflow,
      leak: leakPattern.test(visibleText),
      visibleText,
      hasTabs: Boolean(tabs),
      hasList: Boolean(list),
      listLabel: list?.getAttribute('aria-label') ?? '',
      triggers,
    };
  }, width);
}

async function openLibrary(page) {
  await page.locator('button[aria-label="打开导航菜单"]').click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await page.locator('#ds-v2-menu-panel [data-slot="command-item"]').filter({ hasText: '资料库' }).first().click();
  await page.waitForSelector('[aria-label="资料子导航"] [data-slot="tabs-trigger"]', { timeout: 10000 });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await page.locator('body').innerText()).includes('Stable writing preference')) return;
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: join(outDir, 'library-open-debug.png'), fullPage: true });
  throw new Error(`Library opened without expected memory row: ${(await page.locator('body').innerText()).slice(0, 1200)}`);
}

async function runLibraryTabsFlow(browser, url, width) {
  const context = await browser.newContext({ viewport: { width, height: 820 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, { memories, savedItems });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ds-chat-input', { timeout: 10000 });
  await openLibrary(page);

  await page.screenshot({ path: join(outDir, `library-memory-${width}.png`), fullPage: true });
  let diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.hasTabs, `missing shadcn tabs root at ${width}`);
  await assertDogfood(diagnostics.hasList, `missing shadcn tabs list at ${width}`);
  await assertDogfood(diagnostics.listLabel === '资料子导航', `wrong tabs list label at ${width}`);
  await assertDogfood(diagnostics.triggers.map((trigger) => trigger.text).join('|') === '记忆|保存', `wrong tab labels at ${width}`);
  await assertDogfood(diagnostics.triggers[0]?.state === 'active', `Memory tab not active initially at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('Stable writing preference'), `memory row missing at ${width}`);

  await page.locator('[aria-label="资料子导航"] [data-slot="tabs-trigger"]').filter({ hasText: '保存' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Review checklist'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `library-saved-click-${width}.png`), fullPage: true });
  diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.triggers[1]?.state === 'active', `Saved tab did not activate by click at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('保存项'), `Saved page title missing after click at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('Review checklist'), `saved item missing at ${width}`);

  await page.locator('[aria-label="资料子导航"] [data-slot="tabs-trigger"]').filter({ hasText: '保存' }).focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.body.innerText.includes('Stable writing preference'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `library-memory-keyboard-${width}.png`), fullPage: true });
  diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.triggers[0]?.state === 'active', `Memory tab did not reactivate by keyboard at ${width}`);
  await assertDogfood(!diagnostics.overflow, `horizontal overflow at ${width}`);
  await assertDogfood(!diagnostics.leak, `visible leak pattern at ${width}`);
  await assertDogfood(consoleErrors.length === 0, `console errors at ${width}: ${consoleErrors.join(' | ')}`);
  await assertDogfood(pageErrors.length === 0, `page errors at ${width}: ${pageErrors.join(' | ')}`);

  await context.close();
}

await mkdir(outDir, { recursive: true });
const port = await listen();
const url = `http://127.0.0.1:${port}/sidepanel.html`;
const browser = await chromium.launch({ headless: true });

try {
  for (const width of [420, 360]) {
    await runLibraryTabsFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real command menu navigation opened Library',
      'Memory and Saved route tabs rendered through shadcn Tabs slots',
      'Memory tab showed real memory rows',
      'Saved tab click showed real saved item rows',
      'ArrowLeft keyboard navigation returned from Saved to Memory',
      'tab list labels and active states verified',
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
