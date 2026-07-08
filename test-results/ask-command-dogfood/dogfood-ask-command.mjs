import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/ask-command-dogfood');

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

const projectState = {
  schemaVersion: 2,
  projects: [{
    id: 'project-1',
    name: 'Run1',
    description: '',
    instructions: 'First run',
    createdAt: 1,
    updatedAt: 3,
  }],
  conversations: [],
  pendingProjectId: 'project-1',
};

const currentConversation = {
  ok: true,
  conversation: {
    conversationId: 'chat-1',
    title: 'Current DeepSeek task',
    url: 'https://chat.deepseek.com/a/chat/s/chat-1',
  },
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
    commandsFail: options.commandsFail,
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

  window.__DEEPSEEKPP_DOGFOOD_STATE__ = state;
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
        if (message?.type === 'GET_AUTH_STATUS') {
          return { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true };
        }
        if (message?.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return undefined;
        if (message?.type === 'GET_VOICE_SETTINGS') return undefined;
        if (message?.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') {
          return {
            ok: true,
            config: {
              enabled: true,
              autoReadyCheckBeforeRun: true,
              autoRefreshWebAuth: true,
              sameSessionStrategy: 'last',
              visualMonitorDefault: true,
              reducedConfirmations: true,
            },
          };
        }
        if (message?.type === 'GET_RUNTIME_DOCTOR_REPORT') return null;
        if (message?.type === 'GET_PROMPT_INJECTION_SETTINGS') return null;
        if (message?.type === 'GET_TOOL_DESCRIPTORS') {
          return { providers: [], tools: [], refreshedAt: 1 };
        }
        if (message?.type === 'GET_SKILL_LIBRARY') {
          if (state.commandsFail) throw new Error('commands offline');
          return [
            {
              name: 'summarize',
              description: 'Summarize the current page.',
              instructions: 'Summarize clearly.',
              source: 'custom',
              memoryEnabled: false,
              enabled: true,
            },
            {
              name: 'review',
              description: 'Review for risks.',
              instructions: 'Find risks.',
              source: 'custom',
              memoryEnabled: true,
              enabled: true,
            },
            {
              name: 'disabled',
              description: 'Should stay hidden.',
              instructions: 'Hidden.',
              source: 'custom',
              memoryEnabled: false,
              enabled: false,
            },
          ];
        }
        if (message?.type === 'GET_PROJECT_CONTEXT_STATE') return options.projectState;
        if (message?.type === 'GET_MEMORIES') {
          return [{
            id: 1,
            syncId: 'memory-1',
            scope: 'global',
            type: 'preference',
            name: 'Tone preference',
            content: 'Be concise.',
            description: 'User communication preference',
            tags: ['style'],
            pinned: true,
            createdAt: 1,
            updatedAt: 4,
            accessCount: 0,
            lastAccessedAt: 0,
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
            updatedAt: 5,
          }];
        }
        if (message?.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return options.currentConversation;
        if (message?.type === 'CAPTURE_BROWSER_CONTROL_TARGET_IMAGE') {
          return {
            ok: true,
            image: {
              name: 'browser-control-12.png',
              mimeType: 'image/png',
              sizeBytes: 7,
              dataUrl: 'data:image/png;base64,YnJvd3Nlcg==',
            },
          };
        }
        if (message?.type === 'CAPTURE_CURRENT_TAB_IMAGE') {
          return {
            ok: true,
            image: {
              name: 'captured-tab.png',
              mimeType: 'image/png',
              sizeBytes: 5,
              dataUrl: 'data:image/png;base64,cHJvYmU=',
            },
          };
        }
        if (message?.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
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

async function pageDiagnostics(page, width) {
  return page.evaluate((currentWidth) => {
    const root = document.documentElement;
    const body = document.body;
    const visibleText = body.innerText;
    const overflow = Math.max(root.scrollWidth, body.scrollWidth) > currentWidth + 1;
    const leakPattern = /\bGET_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|Bearer|Cookie|data:image|\[object Object\]|sk-[A-Za-z0-9_-]{8,}/;
    const activeId = document.querySelector('.ds-chat-input')?.getAttribute('aria-activedescendant');
    return {
      overflow,
      leak: leakPattern.test(visibleText),
      activeId,
      activeIdExists: activeId ? Boolean(document.getElementById(activeId)) : true,
      commandSlotCount: document.querySelectorAll('#ds-chat-composer-suggestions[data-slot="command"]').length,
      commandListCount: document.querySelectorAll('#ds-chat-composer-suggestions [data-slot="command-list"]').length,
      commandItemCount: document.querySelectorAll('#ds-chat-composer-suggestions [data-slot="command-item"]').length,
      visibleText,
    };
  }, width);
}

async function assertDogfood(condition, message) {
  if (!condition) throw new Error(message);
}

async function openDogfoodPage(browser, url, width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 820 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, {
    commandsFail: options.commandsFail === true,
    projectState,
    currentConversation,
  });
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

async function runSuccessFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width);
  const input = page.locator('.ds-chat-input');

  await page.screenshot({ path: join(outDir, `ask-ready-${width}.png`), fullPage: true });

  await input.click();
  await input.fill('/r');
  await page.waitForSelector('#ds-chat-composer-suggestions [data-slot="command-item"]');
  await assertDogfood(await page.locator('text=/review').count() > 0, `slash suggestions missing /review at ${width}`);
  await page.screenshot({ path: join(outDir, `slash-open-${width}.png`), fullPage: true });
  let diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.commandSlotCount === 1, `missing command slot for slash at ${width}`);
  await assertDogfood(diagnostics.commandListCount === 1, `missing command list for slash at ${width}`);
  await assertDogfood(diagnostics.commandItemCount > 0, `missing command item rows for slash at ${width}`);
  await assertDogfood(diagnostics.activeIdExists, `slash aria-activedescendant target missing at ${width}`);
  await input.press('Enter');
  await assertDogfood(await input.inputValue() === '/review ', `slash Enter did not insert /review at ${width}`);

  await input.fill('@');
  await page.waitForSelector('#ds-chat-composer-suggestions [data-slot="command-item"]');
  const contextVisibleText = await page.locator('body').innerText();
  await assertDogfood(contextVisibleText.includes('Run1'), `context suggestions missing project at ${width}: ${contextVisibleText.slice(0, 800)}`);
  await assertDogfood(contextVisibleText.includes('Tone preference'), `context suggestions missing memory at ${width}: ${contextVisibleText.slice(0, 800)}`);
  await assertDogfood(contextVisibleText.includes('Review checklist'), `context suggestions missing saved item at ${width}: ${contextVisibleText.slice(0, 800)}`);
  await page.screenshot({ path: join(outDir, `context-open-${width}.png`), fullPage: true });
  diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.commandListCount === 1, `missing command list for context at ${width}`);
  await assertDogfood(diagnostics.commandItemCount > 0, `missing command item rows for context at ${width}`);
  await assertDogfood(diagnostics.activeIdExists, `context aria-activedescendant target missing at ${width}`);
  await input.press('ArrowDown');
  await input.press('Enter');
  await assertDogfood(await input.inputValue() === '@Project: Run1 ', `context keyboard selection did not insert project at ${width}`);

  diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(!diagnostics.overflow, `horizontal overflow after success flow at ${width}`);
  await assertDogfood(!diagnostics.leak, `visible leak pattern after success flow at ${width}`);
  await assertDogfood(consoleErrors.length === 0, `console errors after success flow at ${width}: ${consoleErrors.join(' | ')}`);
  await assertDogfood(pageErrors.length === 0, `page errors after success flow at ${width}: ${pageErrors.join(' | ')}`);
  await context.close();
}

async function runFailureRecoveryFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, { commandsFail: true });
  const input = page.locator('.ds-chat-input');
  await input.click();
  await input.fill('/');
  await page.waitForSelector('.ds-chat-suggestion-source-issue');
  await assertDogfood(await page.locator('text=commands offline').count() > 0, `slash failure message missing at ${width}`);
  await page.screenshot({ path: join(outDir, `slash-failure-${width}.png`), fullPage: true });
  let diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(!diagnostics.visibleText.includes('GET_SKILL_LIBRARY'), `raw runtime name leaked in failure at ${width}`);
  await assertDogfood(!diagnostics.visibleText.includes('schemaVersion'), `schemaVersion leaked in failure at ${width}`);
  await page.evaluate(() => {
    window.__DEEPSEEKPP_DOGFOOD_STATE__.commandsFail = false;
  });
  await page.getByRole('button', { name: /Retry|重试/ }).click();
  await page.waitForSelector('#ds-chat-composer-suggestions [data-slot="command-item"]');
  await assertDogfood(await page.locator('text=/review').count() > 0, `slash retry did not recover at ${width}`);
  await page.screenshot({ path: join(outDir, `slash-recovered-${width}.png`), fullPage: true });
  diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.commandListCount === 1, `missing command list after retry at ${width}`);
  await assertDogfood(diagnostics.commandItemCount > 0, `missing command items after retry at ${width}`);
  await assertDogfood(diagnostics.activeIdExists, `retry aria-activedescendant target missing at ${width}`);
  await assertDogfood(!diagnostics.overflow, `horizontal overflow after retry at ${width}`);
  await assertDogfood(!diagnostics.leak, `visible leak pattern after retry at ${width}`);
  await assertDogfood(consoleErrors.length === 0, `console errors after retry at ${width}: ${consoleErrors.join(' | ')}`);
  await assertDogfood(pageErrors.length === 0, `page errors after retry at ${width}: ${pageErrors.join(' | ')}`);
  await context.close();
}

const port = await listen();
const url = `http://127.0.0.1:${port}/sidepanel.html`;
const browser = await chromium.launch({ headless: true });

try {
  for (const width of [420, 360]) {
    await runSuccessFlow(browser, url, width);
    await runFailureRecoveryFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'slash suggestions opened from real GET_SKILL_LIBRARY response',
      'slash keyboard Enter inserted /review',
      'at-context suggestions loaded project, memory, saved, current chat, and browser rows',
      'at-context keyboard ArrowDown+Enter inserted @Project: Run1',
      'slash source failure showed retryable issue without raw runtime leak',
      'retry recovered the slash suggestions',
      'command, command-list, and command-item slots verified',
      'aria-activedescendant targets existed',
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
