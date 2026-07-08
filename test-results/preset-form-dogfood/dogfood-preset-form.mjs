import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/preset-form-dogfood');

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

const recoveredPreset = {
  id: 'preset-recovered',
  name: '恢复预设',
  content: '保持简洁并说明证据。',
  createdAt: 1,
  updatedAt: 2,
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
  const presets = options.presets.map((preset) => ({ ...preset }));
  const state = {
    calls: [],
    failPresetLoadOnce: options.failPresetLoadOnce === true,
    savePresetPayloads: [],
    setActivePresetPayloads: [],
    activePresetId: options.activePresetId ?? null,
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

  window.__DEEPSEEKPP_PRESET_DOGFOOD_STATE__ = state;
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
        if (message?.type === 'GET_PRESETS') {
          if (state.failPresetLoadOnce) {
            state.failPresetLoadOnce = false;
            throw new Error('preset store offline');
          }
          return presets.map((preset) => ({ ...preset }));
        }
        if (message?.type === 'GET_ACTIVE_PRESET') return activePreset();
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
        if (message?.type === 'GET_SKILL_LIBRARY') return [];
        if (message?.type === 'GET_SKILL_SOURCES') return [];
        if (message?.type === 'GET_MEMORIES') return [];
        if (message?.type === 'GET_SAVED_ITEMS') return [];
        if (message?.type === 'GET_PROJECT_CONTEXT_STATE') return { schemaVersion: 2, pendingProjectId: null, projects: [], conversations: [] };
        if (message?.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
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
    const leakPattern = /\bGET_[A-Z0-9_]+\b|\bSAVE_[A-Z0-9_]+\b|\bSET_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|Bearer|Cookie|data:image|\[object Object\]|sk-[A-Za-z0-9_-]{8,}/;
    return {
      overflow,
      leak: leakPattern.test(visibleText),
      visibleText,
    };
  }, width);
}

async function verifyStablePage(page, width, step) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(!diagnostics.overflow, `${step}: horizontal overflow at ${width}`);
  await assertDogfood(!diagnostics.leak, `${step}: visible leak pattern at ${width}`);
}

async function assertButtonSlot(page, label, step, width) {
  const hasSlot = await page.evaluate((buttonLabel) => {
    return Array.from(document.querySelectorAll('button'))
      .some((button) => button.textContent?.trim() === buttonLabel && button.getAttribute('data-slot') === 'button');
  }, label);
  await assertDogfood(hasSlot, `${step}: ${label} is not a shadcn Button at ${width}`);
}

async function presetFormContract(page) {
  return page.evaluate(() => {
    const nameInput = document.querySelector('input[placeholder="代码助手"]');
    const contentTextarea = document.querySelector('textarea[placeholder="写下这个预设要应用到新对话的指令。"]');
    if (!nameInput || !contentTextarea) return { ok: false, reason: 'missing controls' };
    const nameLabel = document.querySelector(`label[for="${nameInput.id}"]`);
    const contentLabel = document.querySelector(`label[for="${contentTextarea.id}"]`);
    return {
      ok: true,
      inputSlot: nameInput.getAttribute('data-slot'),
      textareaSlot: contentTextarea.getAttribute('data-slot'),
      inputFieldSlot: nameInput.closest('[data-slot="field"]')?.getAttribute('data-slot') ?? '',
      textareaFieldSlot: contentTextarea.closest('[data-slot="field"]')?.getAttribute('data-slot') ?? '',
      hasNameLabel: Boolean(nameLabel),
      hasContentLabel: Boolean(contentLabel),
      textareaRows: contentTextarea.getAttribute('rows'),
    };
  });
}

async function waitForPresetFormStable(page) {
  await page.waitForSelector('.ds-preset-form', { timeout: 10000 });
  await page.waitForFunction(() => {
    const form = document.querySelector('.ds-preset-form');
    const animated = form?.closest('.animate-slide-down');
    const node = animated ?? form;
    if (!node) return false;
    const opacity = Number.parseFloat(window.getComputedStyle(node).opacity || '0');
    return opacity >= 0.99;
  }, null, { timeout: 10000 });
  await page.waitForTimeout(300);
}

async function openPresets(page) {
  await page.locator('button[aria-label="打开导航菜单"]').click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await page.locator('#ds-v2-menu-panel [data-slot="command-item"]').filter({ hasText: '预设' }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes('给新的 DeepSeek 对话复用固定指令'), null, { timeout: 10000 });
}

async function runHealthyFlow(browser, url, width) {
  const context = await browser.newContext({ viewport: { width, height: 880 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, { presets: [], activePresetId: null, failPresetLoadOnce: false });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ds-chat-input', { timeout: 10000 });
  await openPresets(page);

  await page.waitForFunction(() => document.body.innerText.includes('暂无预设'), null, { timeout: 10000 });
  await assertDogfood(await page.locator('[data-slot="empty"]').count() === 1, `missing shadcn empty state at ${width}`);
  await assertButtonSlot(page, '导入', 'preset header', width);
  await assertButtonSlot(page, '新建', 'preset header', width);
  await page.screenshot({ path: join(outDir, `preset-empty-${width}.png`), fullPage: true });
  await verifyStablePage(page, width, 'preset empty');

  await page.locator('.ds-page-intro-actions').getByRole('button', { name: '新建' }).click();
  await waitForPresetFormStable(page);
  await page.locator('input[placeholder="代码助手"]').fill(`预设 ${width}`);
  await page.locator('textarea[placeholder="写下这个预设要应用到新对话的指令。"]').fill(`在 ${width}px 下保持直接、可验证。`);
  const contract = await presetFormContract(page);
  await assertDogfood(contract.ok, `preset form fields missing at ${width}`);
  await assertDogfood(contract.inputSlot === 'input', `preset name input missing shadcn slot at ${width}`);
  await assertDogfood(contract.textareaSlot === 'textarea', `preset textarea missing shadcn slot at ${width}`);
  await assertDogfood(contract.inputFieldSlot === 'field', `preset name input missing Field wrapper at ${width}`);
  await assertDogfood(contract.textareaFieldSlot === 'field', `preset textarea missing Field wrapper at ${width}`);
  await assertDogfood(contract.hasNameLabel && contract.hasContentLabel, `preset labels broken at ${width}`);
  await assertDogfood(contract.textareaRows === '6', `preset textarea row count mismatch at ${width}`);
  await assertButtonSlot(page, '取消', 'preset form', width);
  await assertButtonSlot(page, '保存', 'preset form', width);
  await page.screenshot({ path: join(outDir, `preset-form-${width}.png`), fullPage: true });
  await verifyStablePage(page, width, 'preset form');

  await page.locator('.ds-preset-form').getByRole('button', { name: '保存' }).click();
  await page.waitForFunction((target) => document.body.innerText.includes(target), `预设 ${width}`, { timeout: 10000 });
  await assertButtonSlot(page, '使用', 'preset row', width);
  await assertButtonSlot(page, '编辑', 'preset row', width);
  await assertButtonSlot(page, '删除', 'preset row', width);
  await page.screenshot({ path: join(outDir, `preset-saved-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: '使用' }).first().click();
  await page.waitForFunction((target) => document.body.innerText.includes(`正在使用 ${target}`), `预设 ${width}`, { timeout: 10000 });
  await assertButtonSlot(page, '停止使用', 'preset active row', width);
  await page.screenshot({ path: join(outDir, `preset-active-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: '编辑' }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes('编辑预设'), null, { timeout: 10000 });
  await waitForPresetFormStable(page);
  await assertButtonSlot(page, '更新', 'preset edit form', width);
  await page.screenshot({ path: join(outDir, `preset-edit-${width}.png`), fullPage: true });
  await verifyStablePage(page, width, 'preset edit');

  const dogfoodState = await page.evaluate(() => window.__DEEPSEEKPP_PRESET_DOGFOOD_STATE__);
  await assertDogfood(dogfoodState.savePresetPayloads.length === 1, `SAVE_PRESET payload count mismatch at ${width}`);
  await assertDogfood(dogfoodState.savePresetPayloads[0].name === `预设 ${width}`, `preset save payload name mismatch at ${width}`);
  await assertDogfood(dogfoodState.savePresetPayloads[0].content === `在 ${width}px 下保持直接、可验证。`, `preset save payload content mismatch at ${width}`);
  await assertDogfood(dogfoodState.setActivePresetPayloads.length === 1, `SET_ACTIVE_PRESET payload count mismatch at ${width}`);
  await assertDogfood(dogfoodState.setActivePresetPayloads[0].id === dogfoodState.savePresetPayloads[0].id, `active preset id mismatch at ${width}`);

  await assertDogfood(consoleErrors.length === 0, `console errors at ${width}: ${consoleErrors.join(' | ')}`);
  await assertDogfood(pageErrors.length === 0, `page errors at ${width}: ${pageErrors.join(' | ')}`);
  await context.close();
}

async function runFailureRecoveryFlow(browser, url, width) {
  const context = await browser.newContext({ viewport: { width, height: 880 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, { presets: [recoveredPreset], activePresetId: recoveredPreset.id, failPresetLoadOnce: true });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ds-chat-input', { timeout: 10000 });
  await openPresets(page);

  await page.waitForFunction(() => document.body.innerText.includes('预设不可用'), null, { timeout: 10000 });
  await assertButtonSlot(page, '重试', 'preset failure', width);
  await page.screenshot({ path: join(outDir, `preset-failure-${width}.png`), fullPage: true });
  await verifyStablePage(page, width, 'preset failure');
  await page.getByRole('button', { name: '重试' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('恢复预设'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `preset-recovered-${width}.png`), fullPage: true });
  await verifyStablePage(page, width, 'preset recovered');

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
    await runHealthyFlow(browser, url, width);
    await runFailureRecoveryFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real command menu navigation opened Presets',
      'header, form, row, active, edit, and retry actions rendered through shadcn Button slots',
      'empty state rendered through shadcn Empty slots',
      'New preset form opened from visible New action',
      'Preset name and instruction fields rendered through shadcn Input/Textarea and Field slots',
      'form typed and submitted through visible Save action',
      'SAVE_PRESET payload matched typed values',
      'Use action updated active preset payload and visible active state',
      'Edit action reopened the shadcn-backed form',
      'load failure showed retryable error instead of false empty state',
      'Retry recovered to the seeded preset',
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
