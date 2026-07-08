import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/review-lane-table-dogfood');
const runStorageKey = 'deepseek_pp_autonomous_runs_v1';
const now = 1782969000000;

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

function createReviewLedger(width) {
  return {
    version: 1,
    runs: [
      {
        id: `review-secret-run-${width}`,
        goal: `Review shadcn table at ${width}px`,
        mode: 'unattended',
        status: 'running',
        modelAdapter: 'deepseek_web',
        targetLeaseId: null,
        budgets: {
          maxWallMs: 600000,
          maxModelTurns: 12,
          maxToolCalls: 24,
          maxConsecutiveNoProgress: 2,
          maxSameErrorRepeats: 2,
          maxPromptBytesPerTurn: 12000,
          maxObservationBytesPerTurn: 16000,
        },
        policy: {
          approvalMode: 'auto_low_risk',
          allowedTools: [],
          deniedTools: [],
          browserMutationRequiresTargetLock: true,
          persistMemory: 'off',
          shellMode: 'manual',
        },
        proofContract: {
          doneCriteria: ['Review lanes render as a compact table'],
          requiredEvidence: ['Production bundle table screenshot'],
          antiProof: ['No raw reviewer summaries or ids are visible'],
        },
        checkpoint: {
          providerConversationId: null,
          parentMessageId: null,
          latestStepId: 'review-secret-step',
          resumableSummary: '',
          unresolvedQuestions: [],
        },
        error: null,
        createdAt: now - 90000,
        startedAt: now - 80000,
        completedAt: null,
        updatedAt: now - 1000,
      },
    ],
    steps: [],
    targetLeases: [],
    evidence: [],
    qualityGates: [
      {
        id: `gate-secret-${width}`,
        runId: `review-secret-run-${width}`,
        seq: 1,
        createdAt: now - 2000,
        status: 'warning',
        contractCoverage: {
          rows: [],
          complete: false,
          coveredCount: 2,
          gapCount: 1,
          conflictCount: 0,
          notTestableCount: 0,
        },
        falsePositiveProbe: {
          status: 'not_run',
          issueCount: 0,
          blockingIssueCount: 0,
        },
        resultStateConsistency: {
          status: 'consistent',
          ok: true,
          issueCount: 0,
          blockingIssueCount: 0,
        },
        selfReview: { grade: 'B' },
        verification: {
          commands: [
            { name: 'compile', result: 'passed', summary: 'passed' },
            { name: 'dogfood', result: 'passed', summary: 'passed' },
          ],
        },
        commit: null,
        independentReview: {
          status: 'not_run',
          grade: null,
          blockingIssueCount: 0,
        },
      },
    ],
    reviewLanes: [
      createReviewLane(width, 1, 'grok', 'blocked', 'C', 'block', 'P2', 1, 1),
      createReviewLane(width, 2, 'oracle', 'running', 'B', 'iterate', 'P3', 0, 1),
      createReviewLane(width, 3, 'ux', 'passed', 'A', 'proceed', null, 0, 2),
    ],
  };
}

function createReviewLane(width, seq, role, status, grade, recommendation, highestPriority, issueCount, evidenceRefCount) {
  return {
    id: `lane-secret-${width}-${seq}`,
    runId: `review-secret-run-${width}`,
    seq,
    createdAt: now - 1500 + seq,
    role,
    status,
    grade,
    recommendation,
    highestPriority,
    issueCount,
    evidenceRefCount,
    summary: 'raw reviewer summary should not render',
  };
}

function installChromeStub({ ledger }) {
  const storageKey = 'deepseek_pp_autonomous_runs_v1';
  const storageData = {
    deepseek_pp_chat_enabled: true,
    [storageKey]: ledger,
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

  window.__DEEPSEEKPP_REVIEW_DOGFOOD_STATE__ = state;
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

async function openReviewThroughMenu(page) {
  await page.locator('button[aria-label="打开导航菜单"]').click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await page.locator('#ds-v2-menu-panel [data-slot="command-input"]').fill('复核');
  await page.waitForFunction(() => document.body.innerText.includes('复核'), null, { timeout: 10000 });
  await page.locator('#ds-v2-menu-panel [data-slot="command-item"]').filter({ hasText: '复核' }).first().click();
  await page.waitForSelector('.ds-cockpit-review-status', { timeout: 10000 });
  await page.waitForSelector('[data-slot="table"].ds-cockpit-review-lane-table', { timeout: 10000 });
}

async function assertReviewTableContract(page, width) {
  const contract = await page.evaluate((currentWidth) => {
    const root = document.documentElement;
    const body = document.body;
    const table = document.querySelector('[data-slot="table"].ds-cockpit-review-lane-table');
    const tableContainer = table?.closest('[data-slot="table-container"]');
    const headers = Array.from(table?.querySelectorAll('[data-slot="table-head"]') ?? []).map((cell) => cell.textContent?.trim() ?? '');
    const rows = Array.from(table?.querySelectorAll('tbody [data-slot="table-row"]') ?? []).map((row) => ({
      text: row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      cells: Array.from(row.querySelectorAll('[data-slot="table-cell"]')).map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
      badges: Array.from(row.querySelectorAll('[data-slot="badge"]')).map((badge) => ({
        text: badge.textContent?.trim() ?? '',
        variant: badge.getAttribute('data-variant') ?? '',
      })),
    }));
    const visibleText = body.innerText;
    return {
      hasTable: Boolean(table),
      hasContainer: Boolean(tableContainer),
      hasCaption: table?.querySelector('[data-slot="table-caption"]')?.classList.contains('sr-only') ?? false,
      headers,
      rows,
      tableScrolls: tableContainer ? tableContainer.scrollWidth > tableContainer.clientWidth + 1 : false,
      pageOverflow: Math.max(root.scrollWidth, body.scrollWidth) > currentWidth + 1,
      visibleText,
      legacyMainRows: document.querySelectorAll('.ds-cockpit-review-lane-main').length,
      legacySideRows: document.querySelectorAll('.ds-cockpit-review-lane-side').length,
    };
  }, width);

  await assertDogfood(contract.hasTable, `review table missing at ${width}`);
  await assertDogfood(contract.hasContainer, `review table container missing at ${width}`);
  await assertDogfood(contract.hasCaption, `review table caption missing or not screen-reader-only at ${width}`);
  await assertDogfood(contract.headers.join('|') === '复核者|状态|发现|证据', `review table headers mismatch at ${width}: ${contract.headers.join('|')}`);
  await assertDogfood(contract.rows.length === 3, `review lane row count mismatch at ${width}`);
  await assertDogfood(contract.rows.every((row) => row.cells.length === 4), `review lane cell count mismatch at ${width}`);
  await assertDogfood(contract.rows.some((row) => row.text.includes('Grok') && row.text.includes('阻塞') && row.text.includes('P2') && row.text.includes('阻止')), `blocked Grok lane missing safe summary at ${width}`);
  await assertDogfood(contract.rows.some((row) => row.text.includes('Oracle') && row.text.includes('运行中') && row.text.includes('P3') && row.text.includes('迭代')), `running Oracle lane missing safe summary at ${width}`);
  await assertDogfood(contract.rows.some((row) => row.text.includes('Ux') && row.text.includes('通过') && row.text.includes('无优先级') && row.text.includes('继续')), `passed UX lane missing safe summary at ${width}`);
  await assertDogfood(contract.rows.flatMap((row) => row.badges).some((badge) => badge.text === '阻塞' && badge.variant === 'destructive'), `blocked badge variant mismatch at ${width}`);
  await assertDogfood(contract.rows.flatMap((row) => row.badges).some((badge) => badge.text === '运行中' && badge.variant === 'secondary'), `running badge variant mismatch at ${width}`);
  await assertDogfood(contract.rows.flatMap((row) => row.badges).some((badge) => badge.text === '通过' && badge.variant === 'outline'), `passed badge variant mismatch at ${width}`);
  await assertDogfood(!contract.tableScrolls, `review table has internal horizontal scroll at ${width}`);
  await assertDogfood(!contract.pageOverflow, `review page has horizontal overflow at ${width}`);
  await assertDogfood(contract.legacyMainRows === 0 && contract.legacySideRows === 0, `legacy review lane div layout still rendered at ${width}`);
  await assertDogfood(contract.visibleText.includes('复核状态'), `review status missing at ${width}`);
  await assertDogfood(contract.visibleText.includes('已阻塞'), `blocked review status missing at ${width}`);
  await assertDogfood(contract.visibleText.includes('质量复核'), `quality gate panel missing at ${width}`);
  await assertDogfood(contract.visibleText.includes('不完整'), `coverage incomplete fact missing at ${width}`);
  await assertDogfood(contract.visibleText.includes('1 个缺口'), `quality gate gap evidence missing at ${width}`);
  await assertDogfood(!contract.visibleText.includes('raw reviewer summary should not render'), `raw reviewer summary leaked at ${width}`);
  await assertDogfood(!contract.visibleText.includes(`review-secret-run-${width}`), `run id leaked at ${width}`);
  await assertDogfood(!contract.visibleText.includes(`lane-secret-${width}`), `lane id leaked at ${width}`);
  await assertDogfood(!contract.visibleText.includes(`gate-secret-${width}`), `gate id leaked at ${width}`);
}

async function runReviewFlow(browser, url, width) {
  const ledger = createReviewLedger(width);
  const context = await browser.newContext({ viewport: { width, height: 860 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, { ledger });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
  const shellReady = await page.waitForSelector('button[aria-label="打开导航菜单"]', { timeout: 10000 }).catch(() => null);
  if (!shellReady) {
    await page.screenshot({ path: join(outDir, `review-shell-boot-failed-${width}.png`), fullPage: true });
    const bootText = await page.locator('body').innerText().catch(() => '');
    await writeFile(join(outDir, `review-shell-boot-failed-${width}.txt`), [
      `body=${bootText}`,
      `console=${consoleErrors.join(' | ')}`,
      `pageErrors=${pageErrors.join(' | ')}`,
    ].join('\n'));
    throw new Error(`sidepanel shell did not boot at ${width}`);
  }
  await openReviewThroughMenu(page);
  await verifyStablePage(page, width, 'review opened through menu');
  await assertReviewTableContract(page, width);
  await page.screenshot({ path: join(outDir, `review-table-${width}.png`), fullPage: true });
  const tableLocator = page.locator('[data-slot="table"].ds-cockpit-review-lane-table');
  await tableLocator.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, `review-table-detail-${width}.png`), fullPage: false });
  await tableLocator.screenshot({ path: join(outDir, `review-table-element-${width}.png`) });

  await page.locator('button[aria-label="打开导航菜单"]').click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#ds-v2-menu-panel', { state: 'detached', timeout: 10000 });
  await verifyStablePage(page, width, 'review after menu escape');
  await page.screenshot({ path: join(outDir, `review-menu-escape-${width}.png`), fullPage: true });

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
    await runReviewFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real command menu opened and filtered to Review',
      'Review route rendered an active mission with quality gate and reviewer lanes',
      'reviewer lane details rendered through shadcn Table slots',
      'lane state rendered through shadcn Badge variants',
      'table headers, caption, rows, and cells were verified at 420px and 360px',
      'focused table screenshots were captured after scrolling the Review lane table into view',
      'blocked/running/passed reviewer states were visible without raw reviewer summaries',
      'legacy review lane div layout was absent',
      'menu Escape interaction was dogfooded after Review opened',
      'no page or table horizontal overflow at 420px or 360px',
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
