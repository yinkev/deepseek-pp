import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/context-state-dogfood');

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

const currentConversation = {
  ok: true,
  conversation: {
    conversationId: 'conversation-1',
    title: 'Sidebar review',
    url: 'https://chat.deepseek.com/a/chat/s/conversation-1',
  },
};

const readyProjectState = {
  schemaVersion: 2,
  pendingProjectId: 'project-1',
  projects: [{
    id: 'project-1',
    name: 'DeepSeek++ Redesign',
    description: '',
    instructions: 'Keep it real.',
    createdAt: 1,
    updatedAt: 30,
  }],
  conversations: [{
    conversationId: 'conversation-1',
    projectId: 'project-1',
    title: 'Sidebar review',
    url: 'https://chat.deepseek.com/a/chat/s/conversation-1',
    addedAt: 2,
    lastSeenAt: 25,
  }],
};

const emptyProjectState = {
  schemaVersion: 2,
  pendingProjectId: null,
  projects: [],
  conversations: [],
};

const preset = {
  id: 'preset-1',
  name: 'Expert reviewer',
  content: 'Review strictly.',
  createdAt: 1,
  updatedAt: 2,
};

const promptSettings = {
  memoryEnabled: true,
  systemPromptEnabled: true,
  presetCadence: 'every_message',
  forceResponseLanguage: 'auto',
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
  const state = {
    mode: options.mode,
    memoryFails: options.memoryFails === true,
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

  function projectState() {
    return state.mode === 'empty' ? options.emptyProjectState : options.readyProjectState;
  }

  function conversation() {
    return state.mode === 'empty'
      ? { ok: false, error: 'no_active_deepseek_conversation' }
      : options.currentConversation;
  }

  window.__DEEPSEEKPP_CONTEXT_DOGFOOD_STATE__ = state;
  window.chrome = {
    i18n: {
      getUILanguage: () => 'zh-CN',
      getMessage: () => '',
    },
    runtime: {
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
        if (message?.type === 'GET_RUNTIME_DOCTOR_REPORT') return null;
        if (message?.type === 'GET_PROJECT_CONTEXT_STATE') return projectState();
        if (message?.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return conversation();
        if (message?.type === 'GET_PROMPT_INJECTION_SETTINGS') return options.promptSettings;
        if (message?.type === 'GET_TOOL_DESCRIPTORS') return { providers: [], tools: [], refreshedAt: 1 };
        if (message?.type === 'GET_MEMORIES') {
          if (state.memoryFails) throw new Error('memory offline');
          if (state.mode === 'empty') return [];
          return [{
            id: 1,
            syncId: 'memory-1',
            scope: 'global',
            type: 'user',
            name: 'Stable writing preference',
            content: 'Keep answers direct.',
            description: '',
            tags: [],
            pinned: true,
            createdAt: 1,
            updatedAt: 10,
            accessCount: 1,
            lastAccessedAt: 10,
          }];
        }
        if (message?.type === 'GET_SAVED_ITEMS') {
          if (state.mode === 'empty') return [];
          return [{
            id: 'saved-1',
            syncId: 'saved-sync-1',
            kind: 'snippet',
            title: 'Reusable audit prompt',
            content: 'Audit this change.',
            tags: [],
            createdAt: 1,
            updatedAt: 20,
          }];
        }
        if (message?.type === 'GET_ACTIVE_PRESET') {
          return state.mode === 'empty' ? null : options.preset;
        }
        if (message?.type === 'GET_AUTH_STATUS') {
          return { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true };
        }
        if (message?.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return undefined;
        if (message?.type === 'GET_VOICE_SETTINGS') return undefined;
        if (message?.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return undefined;
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
    return {
      overflow,
      leak: leakPattern.test(visibleText),
      visibleText,
      alertSlots: document.querySelectorAll('.ds-intel-source-issues[data-slot="alert"]').length,
      alertTitleSlots: document.querySelectorAll('.ds-intel-source-issues [data-slot="alert-title"]').length,
      alertActionButtonSlots: document.querySelectorAll('.ds-intel-source-issues [data-slot="alert-action"] [data-slot="button"]').length,
      badgeSlots: document.querySelectorAll('.ds-intel-readiness-badge[data-slot="badge"]').length,
      buttonSlots: document.querySelectorAll('.ds-intel-button[data-slot="button"]').length,
      emptySlots: document.querySelectorAll('.ds-intel-empty-state[data-slot="empty"]').length,
      emptyButtonSlots: document.querySelectorAll('.ds-intel-empty-state [data-slot="button"]').length,
    };
  }, width);
}

async function openDogfoodPage(browser, url, width, mode, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 820 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, {
    mode,
    memoryFails: options.memoryFails === true,
    readyProjectState,
    emptyProjectState,
    currentConversation,
    promptSettings,
    preset,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '上下文' }).click();
  await page.waitForSelector('.ds-intel-page', { timeout: 10000 });
  await page.waitForSelector('.ds-intel-readiness', { timeout: 10000 });
  return { context, page, consoleErrors, pageErrors };
}

async function checkNoGlobalFailures(page, consoleErrors, pageErrors, width, label) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(!diagnostics.overflow, `${label}: horizontal overflow at ${width}`);
  await assertDogfood(!diagnostics.leak, `${label}: visible leak pattern at ${width}`);
  await assertDogfood(consoleErrors.length === 0, `${label}: console errors at ${width}: ${consoleErrors.join(' | ')}`);
  await assertDogfood(pageErrors.length === 0, `${label}: page errors at ${width}: ${pageErrors.join(' | ')}`);
  return diagnostics;
}

async function runReadyFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, 'ready');
  await assertDogfood(await page.locator('text=可使用').count() > 0, `ready status missing at ${width}`);
  await assertDogfood(await page.locator('text=DeepSeek++ Redesign').count() > 0, `project missing at ${width}`);
  await assertDogfood(await page.locator('text=Stable writing preference').count() > 0, `memory missing at ${width}`);
  await assertDogfood(await page.locator('text=Reusable audit prompt').count() > 0, `saved item missing at ${width}`);
  await assertDogfood(await page.locator('text=Expert reviewer').count() > 0, `preset missing at ${width}`);
  await page.screenshot({ path: join(outDir, `context-ready-${width}.png`), fullPage: true });
  const diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'ready');
  await assertDogfood(diagnostics.badgeSlots === 1, `ready badge slot missing at ${width}`);
  await assertDogfood(diagnostics.buttonSlots >= 3, `ready shadcn buttons missing at ${width}`);
  await page.locator('.ds-intel-readiness-actions [data-slot="button"]').click();
  await page.waitForSelector('.ds-chat-page', { timeout: 10000 });
  await assertDogfood(await page.locator('text=询问 DeepSeek++').count() > 0, `ready action did not navigate to Ask at ${width}`);
  await context.close();
}

async function runEmptyFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, 'empty');
  await assertDogfood(await page.locator('text=需要上下文').count() > 0, `empty status missing at ${width}`);
  await assertDogfood(await page.locator('text=还没有保存上下文').count() > 0, `empty title missing at ${width}`);
  await assertDogfood(await page.locator('text=管理记忆').count() > 0, `empty memory action missing at ${width}`);
  await page.screenshot({ path: join(outDir, `context-empty-${width}.png`), fullPage: true });
  const diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'empty');
  await assertDogfood(diagnostics.emptySlots === 1, `empty shadcn slot missing at ${width}`);
  await assertDogfood(diagnostics.emptyButtonSlots === 2, `empty shadcn action buttons missing at ${width}`);
  await page.getByRole('button', { name: '管理记忆' }).click();
  await page.waitForSelector('.ds-library-toolbar', { timeout: 10000 });
  await assertDogfood(await page.locator('text=记忆').count() > 0, `empty memory action did not navigate to Library Memory at ${width}`);
  await context.close();
}

async function runFailureRecoveryFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, 'ready', { memoryFails: true });
  await assertDogfood(await page.locator('text=需要刷新').count() > 0, `failure status missing at ${width}`);
  await assertDogfood(await page.locator('text=上下文来源需要刷新').count() > 0, `failure alert title missing at ${width}`);
  await assertDogfood(await page.locator('text=memory offline').count() > 0, `failure message missing at ${width}`);
  await assertDogfood(await page.locator('text=Reusable audit prompt').count() > 0, `loaded saved context hidden during failure at ${width}`);
  await page.screenshot({ path: join(outDir, `context-source-failure-${width}.png`), fullPage: true });
  let diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'failure');
  await assertDogfood(diagnostics.alertSlots === 1, `failure alert slot missing at ${width}`);
  await assertDogfood(diagnostics.alertTitleSlots === 1, `failure alert title slot missing at ${width}`);
  await assertDogfood(diagnostics.alertActionButtonSlots === 1, `failure alert action button missing at ${width}`);
  await page.evaluate(() => {
    window.__DEEPSEEKPP_CONTEXT_DOGFOOD_STATE__.memoryFails = false;
  });
  await page.getByRole('button', { name: '重试' }).first().click();
  await page.waitForSelector('.ds-intel-source-issues', { state: 'detached', timeout: 10000 });
  await assertDogfood(await page.locator('text=Stable writing preference').count() > 0, `retry memory missing at ${width}`);
  await assertDogfood(await page.locator('text=memory offline').count() === 0, `failure text persisted after retry at ${width}`);
  await page.screenshot({ path: join(outDir, `context-recovered-${width}.png`), fullPage: true });
  diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'recovered');
  await assertDogfood(diagnostics.badgeSlots === 1, `recovered badge slot missing at ${width}`);
  await context.close();
}

const port = await listen();
const url = `http://127.0.0.1:${port}/sidepanel.html`;
const browser = await chromium.launch({ headless: true });

try {
  for (const width of [420, 360]) {
    await runReadyFlow(browser, url, width);
    await runEmptyFlow(browser, url, width);
    await runFailureRecoveryFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real shell navigation opened Context',
      'ready Context rendered project, memory, saved item, and preset',
      'empty Context rendered shadcn Empty with two real navigation actions',
      'source failure rendered shadcn Alert without hiding loaded context',
      'retry recovered the memory source and removed the failure alert',
      'ready state Ask action and empty state Memory action were clicked and verified',
      'badge, alert, empty, and button slots verified',
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
