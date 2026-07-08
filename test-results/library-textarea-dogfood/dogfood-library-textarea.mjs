import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/library-textarea-dogfood');

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

const initialMemories = [
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
];

const initialSavedItems = [
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
  const memories = options.memories.map((memory) => ({ ...memory }));
  const savedItems = options.savedItems.map((item) => ({ ...item }));
  const state = {
    calls: [],
    saveMemoryPayloads: [],
    saveSavedItemPayloads: [],
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

  window.__DEEPSEEKPP_LIBRARY_TEXTAREA_DOGFOOD_STATE__ = state;
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
        if (message?.type === 'GET_MEMORIES') return memories.map((memory) => ({ ...memory }));
        if (message?.type === 'SAVE_MEMORY') {
          state.saveMemoryPayloads.push(message.payload);
          const saved = {
            id: memories.length + 1,
            syncId: `memory-${memories.length + 1}`,
            scope: 'global',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            accessCount: 0,
            lastAccessedAt: 0,
            ...message.payload,
          };
          memories.unshift(saved);
          return { id: saved.id };
        }
        if (message?.type === 'GET_SAVED_ITEMS') return savedItems.map((item) => ({ ...item }));
        if (message?.type === 'SAVE_SAVED_ITEM') {
          state.saveSavedItemPayloads.push(message.payload);
          const saved = {
            id: `saved-${savedItems.length + 1}`,
            syncId: `saved-sync-${savedItems.length + 1}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ...message.payload,
          };
          savedItems.unshift(saved);
          return { ...saved };
        }
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
    const leakPattern = /\bGET_[A-Z0-9_]+\b|\bSAVE_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|Bearer|Cookie|data:image|\[object Object\]|sk-[A-Za-z0-9_-]{8,}/;
    return {
      overflow,
      leak: leakPattern.test(visibleText),
      visibleText,
    };
  }, width);
}

async function textareaContract(page, placeholder, rows) {
  return page.evaluate(({ placeholder: targetPlaceholder, rows: targetRows }) => {
    const textarea = document.querySelector(`textarea[placeholder="${targetPlaceholder}"]`);
    if (!textarea) return { ok: false, reason: 'missing textarea' };
    const label = document.querySelector(`label[for="${textarea.id}"]`);
    const field = textarea.closest('[data-slot="field"]');
    return {
      ok: true,
      slot: textarea.getAttribute('data-slot'),
      rows: textarea.getAttribute('rows'),
      hasId: Boolean(textarea.id),
      hasLabel: Boolean(label),
      fieldSlot: field?.getAttribute('data-slot') ?? '',
      ariaDescribedBy: textarea.getAttribute('aria-describedby'),
      expectedRows: String(targetRows),
    };
  }, { placeholder, rows });
}

async function openLibrary(page) {
  await page.locator('button[aria-label="打开导航菜单"]').click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await page.locator('#ds-v2-menu-panel [data-slot="command-item"]').filter({ hasText: '资料库' }).first().click();
  await page.waitForSelector('[aria-label="资料子导航"] [data-slot="tabs-trigger"]', { timeout: 10000 });
  await page.waitForFunction(() => document.body.innerText.includes('Stable writing preference'), null, { timeout: 10000 });
}

async function verifyStablePage(page, width, step) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(!diagnostics.overflow, `${step}: horizontal overflow at ${width}`);
  await assertDogfood(!diagnostics.leak, `${step}: visible leak pattern at ${width}`);
}

async function runLibraryTextareaFlow(browser, url, width) {
  const context = await browser.newContext({ viewport: { width, height: 880 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, { memories: initialMemories, savedItems: initialSavedItems });
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

  await page.getByRole('button', { name: '新建记忆' }).click();
  await page.locator('input[placeholder="标题"]').first().fill(`Textarea memory ${width}`);
  await page.locator('textarea[placeholder="内容"]').fill(`Keep Library textarea behavior verified at ${width}px.`);
  await page.locator('input[placeholder="标签（逗号分隔）"]').first().fill('dogfood, textarea');
  const memoryContract = await textareaContract(page, '内容', 4);
  await assertDogfood(memoryContract.ok, `memory textarea missing at ${width}`);
  await assertDogfood(memoryContract.slot === 'textarea', `memory textarea missing shadcn slot at ${width}`);
  await assertDogfood(memoryContract.fieldSlot === 'field', `memory textarea missing Field wrapper at ${width}`);
  await assertDogfood(memoryContract.hasId && memoryContract.hasLabel, `memory textarea label wiring broken at ${width}`);
  await assertDogfood(memoryContract.rows === memoryContract.expectedRows, `memory textarea rows mismatch at ${width}`);
  await page.screenshot({ path: join(outDir, `memory-form-${width}.png`), fullPage: true });
  await verifyStablePage(page, width, 'memory form');
  await page.locator('.ds-library-form').getByRole('button', { name: '保存' }).click();
  await page.waitForFunction(
    (target) => document.body.innerText.includes(target),
    `Textarea memory ${width}`,
    { timeout: 10000 },
  );
  await page.screenshot({ path: join(outDir, `memory-saved-${width}.png`), fullPage: true });

  await page.locator('[aria-label="资料子导航"] [data-slot="tabs-trigger"]').filter({ hasText: '保存' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Review checklist'), null, { timeout: 10000 });
  await page.getByRole('button', { name: '新建保存项' }).click();
  await page.locator('input[placeholder="标题"]').first().fill(`Textarea saved ${width}`);
  await page.locator('textarea[placeholder="Prompt 片段、笔记或可复用文本"]').fill(`Reusable verified note at ${width}px.`);
  await page.locator('input[placeholder="标签（逗号分隔）"]').first().fill('dogfood, saved');
  const savedContract = await textareaContract(page, 'Prompt 片段、笔记或可复用文本', 5);
  await assertDogfood(savedContract.ok, `saved textarea missing at ${width}`);
  await assertDogfood(savedContract.slot === 'textarea', `saved textarea missing shadcn slot at ${width}`);
  await assertDogfood(savedContract.fieldSlot === 'field', `saved textarea missing Field wrapper at ${width}`);
  await assertDogfood(savedContract.hasId && savedContract.hasLabel, `saved textarea label wiring broken at ${width}`);
  await assertDogfood(savedContract.rows === savedContract.expectedRows, `saved textarea rows mismatch at ${width}`);
  await page.screenshot({ path: join(outDir, `saved-form-${width}.png`), fullPage: true });
  await verifyStablePage(page, width, 'saved form');
  await page.locator('.ds-library-form').getByRole('button', { name: '保存' }).click();
  await page.waitForFunction(
    (target) => document.body.innerText.includes(target),
    `Textarea saved ${width}`,
    { timeout: 10000 },
  );
  await page.screenshot({ path: join(outDir, `saved-saved-${width}.png`), fullPage: true });

  const dogfoodState = await page.evaluate(() => window.__DEEPSEEKPP_LIBRARY_TEXTAREA_DOGFOOD_STATE__);
  await assertDogfood(dogfoodState.saveMemoryPayloads.length === 1, `SAVE_MEMORY payload count mismatch at ${width}`);
  await assertDogfood(dogfoodState.saveSavedItemPayloads.length === 1, `SAVE_SAVED_ITEM payload count mismatch at ${width}`);
  await assertDogfood(dogfoodState.saveMemoryPayloads[0].content === `Keep Library textarea behavior verified at ${width}px.`, `memory payload content mismatch at ${width}`);
  await assertDogfood(dogfoodState.saveSavedItemPayloads[0].content === `Reusable verified note at ${width}px.`, `saved payload content mismatch at ${width}`);
  await assertDogfood(dogfoodState.saveMemoryPayloads[0].tags.join('|') === 'dogfood|textarea', `memory tags payload mismatch at ${width}`);
  await assertDogfood(dogfoodState.saveSavedItemPayloads[0].tags.join('|') === 'dogfood|saved', `saved tags payload mismatch at ${width}`);

  await verifyStablePage(page, width, 'saved result');
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
    await runLibraryTextareaFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real command menu navigation opened Library',
      'Memory form opened from the visible New memory action',
      'Memory textarea rendered through shadcn Textarea and Field slots',
      'Memory form typed and submitted through the visible Save action',
      'SAVE_MEMORY payload content and tags matched typed values',
      'Saved tab opened through the visible shadcn tab trigger',
      'Saved item form opened from the visible New saved item action',
      'Saved item textarea rendered through shadcn Textarea and Field slots',
      'Saved item form typed and submitted through the visible Save action',
      'SAVE_SAVED_ITEM payload content and tags matched typed values',
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
