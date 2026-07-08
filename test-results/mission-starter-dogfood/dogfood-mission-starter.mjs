import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/mission-starter-dogfood');
const runStorageKey = 'deepseek_pp_autonomous_runs_v1';

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

function installChromeStub() {
  const storageData = {
    deepseek_pp_chat_enabled: true,
  };
  const runtimeListeners = [];
  const storageListeners = [];
  const state = {
    calls: [],
    storageData,
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

  window.__DEEPSEEKPP_MISSION_DOGFOOD_STATE__ = state;
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
    const leakPattern = /\bGET_[A-Z0-9_]+\b|\bSAVE_[A-Z0-9_]+\b|\bSET_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|https?:\/\/|Bearer|Cookie|data:image|\[object Object\]|sk-[A-Za-z0-9_-]{8,}/;
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

async function waitForRunStatus(page, status, width) {
  const matched = await page.waitForFunction(({ key, expectedStatus }) => {
    const ledger = window.__DEEPSEEKPP_MISSION_DOGFOOD_STATE__?.storageData?.[key];
    return ledger?.runs?.[0]?.status === expectedStatus;
  }, { key: runStorageKey, expectedStatus: status }, { timeout: 10000 }).catch(() => null);
  if (!matched) {
    const actual = await getLedger(page);
    throw new Error(`mission status did not reach ${status} at ${width}: ${JSON.stringify(actual)}`);
  }
}

async function getLedger(page) {
  return page.evaluate((key) => window.__DEEPSEEKPP_MISSION_DOGFOOD_STATE__?.storageData?.[key], runStorageKey);
}

async function assertMissionStarterContract(page, width) {
  const contract = await page.evaluate(() => {
    const root = document.querySelector('.ds-cockpit-starter');
    const objective = document.querySelector('textarea[name="mission-objective"]');
    const done = document.querySelector('textarea[name="mission-done-criteria"]');
    const evidence = document.querySelector('textarea[name="mission-required-evidence"]');
    const textareas = [objective, done, evidence];
    return {
      hasRoot: Boolean(root),
      fieldCount: root?.querySelectorAll('[data-slot="field"]').length ?? 0,
      labelCount: root?.querySelectorAll('[data-slot="field-label"]').length ?? 0,
      textareaCount: root?.querySelectorAll('[data-slot="textarea"]').length ?? 0,
      rows: textareas.map((textarea) => textarea?.getAttribute('rows') ?? ''),
      slots: textareas.map((textarea) => textarea?.getAttribute('data-slot') ?? ''),
      labels: textareas.map((textarea) => Boolean(textarea && root?.querySelector(`label[for="${textarea.id}"]`))),
      actions: Array.from(root?.querySelectorAll('.ds-cockpit-starter-actions [data-slot="button"]') ?? []).map((button) => button.textContent?.trim()),
    };
  });
  await assertDogfood(contract.hasRoot, `mission starter root missing at ${width}`);
  await assertDogfood(contract.fieldCount === 3, `mission starter field count mismatch at ${width}`);
  await assertDogfood(contract.labelCount === 3, `mission starter label count mismatch at ${width}`);
  await assertDogfood(contract.textareaCount === 3, `mission starter textarea count mismatch at ${width}`);
  await assertDogfood(contract.rows.every((row) => row === '3'), `mission starter textarea rows mismatch at ${width}`);
  await assertDogfood(contract.slots.every((slot) => slot === 'textarea'), `mission starter textarea slots missing at ${width}`);
  await assertDogfood(contract.labels.every(Boolean), `mission starter label wiring broken at ${width}`);
  await assertDogfood(contract.actions.join('|') === '取消|创建任务', `mission starter action buttons mismatch at ${width}`);
}

async function openMission(page) {
  await page.locator('.ds-v2-primary-nav').getByRole('button', { name: '任务' }).click();
  await page.waitForSelector('.ds-cockpit-page', { timeout: 10000 });
  await page.waitForFunction(() => document.body.innerText.includes('当前没有运行中的任务') || document.body.innerText.includes('当前任务'), null, { timeout: 10000 });
}

async function runMissionFlow(browser, url, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ds-chat-input', { timeout: 10000 });
  await openMission(page);
  await assertDogfood(await page.locator('[data-slot="empty"].ds-cockpit-empty').count() === 1, `mission empty state missing shadcn Empty at ${width}`);
  await page.screenshot({ path: join(outDir, `mission-empty-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: '开始任务' }).last().click();
  await assertMissionStarterContract(page, width);
  await page.locator('textarea[name="mission-objective"]').fill(`Verify mission starter at ${width}px`);
  await page.locator('textarea[name="mission-done-criteria"]').fill('Fields are labelled\nLedger stores proof contract');
  await page.locator('textarea[name="mission-required-evidence"]').fill('Production screenshot\nStorage ledger status');
  await assertMissionStarterContract(page, width);
  await verifyStablePage(page, width, 'mission starter filled');
  await page.screenshot({ path: join(outDir, `mission-starter-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: '创建任务' }).click();
  await waitForRunStatus(page, 'queued', width);
  await page.waitForFunction((objective) => document.body.innerText.includes(objective), `Verify mission starter at ${width}px`, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `mission-created-${width}.png`), fullPage: true });

  let ledger = await getLedger(page);
  await assertDogfood(ledger?.version === 1, `ledger version mismatch at ${width}`);
  await assertDogfood(ledger?.runs?.[0]?.goal === `Verify mission starter at ${width}px`, `ledger goal mismatch at ${width}`);
  await assertDogfood(ledger?.runs?.[0]?.proofContract?.doneCriteria?.join('|') === 'Fields are labelled|Ledger stores proof contract', `done criteria mismatch at ${width}`);
  await assertDogfood(ledger?.runs?.[0]?.proofContract?.requiredEvidence?.join('|') === 'Production screenshot|Storage ledger status', `required evidence mismatch at ${width}`);
  await assertDogfood(await page.locator('.ds-cockpit-mission-status [data-slot="badge"]').count() > 0, `mission status badge missing at ${width}`);
  await assertDogfood(await page.locator('.ds-cockpit-mission-panel [data-slot="button"]').filter({ hasText: '暂停' }).count() === 1, `pause button missing at ${width}`);
  await assertDogfood(await page.locator('.ds-cockpit-mission-panel [data-slot="button"]').filter({ hasText: '停止' }).count() === 1, `stop button missing at ${width}`);

  await page.locator('main').getByRole('button', { name: '活动' }).click();
  await page.waitForSelector('.ds-cockpit-timeline-panel', { timeout: 10000 });
  await verifyStablePage(page, width, 'mission opened activity');
  await page.screenshot({ path: join(outDir, `mission-open-activity-${width}.png`), fullPage: true });
  await openMission(page);

  await page.getByRole('button', { name: '暂停' }).click();
  await waitForRunStatus(page, 'paused', width);
  await page.waitForFunction(() => document.body.innerText.includes('暂停') && document.body.innerText.includes('继续'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `mission-paused-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: '继续' }).click();
  await waitForRunStatus(page, 'running', width);
  await page.waitForFunction(() => document.body.innerText.includes('运行中') && document.body.innerText.includes('暂停'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `mission-resumed-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: '停止' }).click();
  await waitForRunStatus(page, 'cancelled', width);
  await page.waitForFunction(() => document.body.innerText.includes('已停止') && document.body.innerText.includes('开始任务'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `mission-stopped-${width}.png`), fullPage: true });

  ledger = await getLedger(page);
  await assertDogfood(ledger?.runs?.[0]?.status === 'cancelled', `final mission status mismatch at ${width}`);
  await verifyStablePage(page, width, 'mission stopped');
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
    await runMissionFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real primary navigation opened Mission',
      'first-run Mission empty state rendered through shadcn Empty',
      'Start mission opened the visible starter form',
      'Mission starter fields rendered through shared shadcn Field/Textarea slots with label wiring',
      'Cancel/Create actions rendered through shadcn Button slots',
      'typed objective, done criteria, and required evidence saved to the autonomous run ledger',
      'Mission status rendered through shadcn Badge/Card substrate after creation',
      'Mission action route opened Activity and returned to Mission',
      'Pause changed ledger status to paused',
      'Resume changed ledger status to running',
      'Stop changed ledger status to cancelled and exposed Start mission again',
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
