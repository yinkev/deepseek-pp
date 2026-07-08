import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/health-status-card-dogfood');

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

function createRuntimeDoctorReport(overrides = {}) {
  const base = {
    ok: true,
    generatedAt: Date.now(),
    chatEnabled: true,
    chatBusy: false,
    provider: 'deepseek-web',
    hasApiKey: false,
    hasWebAuth: true,
    webAuthRejected: false,
    deepSeekTabCount: 1,
    sidepanelSession: {
      active: true,
      source: 'session',
      parentMessageId: 42,
    },
    personalConvenience: {
      enabled: true,
      autoReadyCheckBeforeRun: true,
      autoRefreshWebAuth: true,
      sameSessionStrategy: 'current',
      visualMonitorDefault: true,
      reducedConfirmations: true,
      lastSessionRemembered: true,
      lastSessionSource: 'sidepanel',
      lastSessionUpdatedAt: 1,
    },
    vision: {
      maxImagesPerTurn: 4,
      rawImagesStoredDurably: false,
    },
    browserControl: {
      enabled: true,
      targetSelected: true,
      targetLock: {
        enabled: true,
        label: 'Planning doc',
        origin: 'https://docs.example.test',
        updatedAt: 1,
      },
      visualCaptureAllowed: true,
      actVerifyEnabled: true,
      evidencePacksEnabled: true,
      debugDistillerEnabled: true,
      monitorReady: true,
    },
    contentScripts: {
      checked: true,
      totalTabs: 1,
      healthyTabs: 1,
      staleTabs: 0,
      staleTabIds: [],
    },
    automation: {
      maxAttempts: 2,
      retryableFailure: null,
    },
    autopilot: {
      inFlightSource: null,
      latestRun: null,
      recentRuns: [],
    },
    humanEval: {
      grade: 'A',
      checks: [
        {
          id: 'ready_loop',
          label: 'Make everything ready',
          prompt: 'Get my DeepSeek++ setup ready, then tell me plainly what still needs attention.',
          status: 'pass',
          evidence: 'DeepSeek tabs answered the content health ping.',
        },
        {
          id: 'same_session',
          label: 'Same chat continuity',
          prompt: 'Continue from where we left off in this DeepSeek chat if that session is still usable.',
          status: 'pass',
          evidence: 'A sidepanel or remembered session pointer exists.',
        },
        {
          id: 'browser_vision',
          label: 'Browser view question',
          prompt: 'Take a look at my current browser view and help me figure out what to do next.',
          status: 'pass',
          evidence: 'Browser Control target and Vision capture are ready.',
        },
        {
          id: 'tool_loop',
          label: 'Tool loop',
          prompt: 'Use the available tools only if they help, then explain what actually changed.',
          status: 'pass',
          evidence: 'Runtime tools are available.',
        },
        {
          id: 'leak_sentry',
          label: 'Leak sentry',
          prompt: 'Review the last run for leaks and tell me whether anything sensitive was stored.',
          status: 'pass',
          evidence: 'Storage check found no forbidden durable items.',
        },
      ],
    },
    leakSentry: {
      ok: true,
      grade: 'A',
      issueCount: 0,
      checkedAreas: ['local', 'session'],
    },
    leakQuarantine: {
      issueCount: 0,
      cleanupEligibleCount: 0,
      groups: [],
    },
    debugDistiller: {
      enabled: true,
      suggestions: [],
    },
    readiness: {
      ready: true,
      status: 'ready',
      blockers: [],
      lastPreparedAt: 1,
      preparing: false,
      targetStatus: 'ready',
      noLeak: true,
    },
    failureExplanations: [],
    storage: {
      ok: true,
      issues: [],
    },
  };
  return {
    ...base,
    ...overrides,
    contentScripts: {
      ...base.contentScripts,
      ...(overrides.contentScripts ?? {}),
    },
    readiness: {
      ...base.readiness,
      ...(overrides.readiness ?? {}),
    },
  };
}

const readyReport = createRuntimeDoctorReport();
const staleBridgeReport = createRuntimeDoctorReport({
  contentScripts: {
    totalTabs: 2,
    healthyTabs: 0,
    staleTabs: 2,
    staleTabIds: [11, 12],
  },
  readiness: {
    ready: false,
    status: 'needs_attention',
    blockers: ['deepseek_content_script_stale'],
  },
  humanEval: {
    ...readyReport.humanEval,
    checks: readyReport.humanEval.checks.map((check) =>
      check.id === 'ready_loop'
        ? { ...check, status: 'fail', evidence: '2 DeepSeek tab(s) need a refresh.' }
        : check
    ),
  },
});

const retryableReport = createRuntimeDoctorReport({
  readiness: {
    ready: false,
    status: 'needs_attention',
    blockers: ['web_auth_missing'],
  },
  automation: {
    maxAttempts: 2,
    retryableFailure: {
      automationId: 'automation-1',
      automationName: 'Visual check',
      runId: 'run-1',
      code: 'automation_executor_failed',
      message: 'Authorization Bearer secret data:image/png;base64,AAAA',
      phase: 'runner',
      at: Date.now(),
    },
  },
});

const suggestionReport = createRuntimeDoctorReport({
  debugDistiller: {
    enabled: true,
    suggestions: [{
      id: 'automation-failure-automation-1',
      kind: 'memory',
      title: 'Remember automation recovery: Visual check',
      preview: 'When automation "Visual check" fails in phase "runner" with "automation_executor_failed", refresh DeepSeek Web auth and retry the run before changing the task.',
      reason: 'Latest retryable automation failure can become a personal recovery memory.',
    }],
  },
});

function installChromeStub(options) {
  const storageData = {
    deepseek_pp_chat_enabled: true,
  };
  const runtimeListeners = [];
  const storageListeners = [];
  const state = {
    calls: [],
    reportCalls: 0,
    reloadCalls: 0,
    saveMemoryCalls: 0,
    humanEvalCalls: 0,
    recoverAuthCalls: 0,
    ensureReadyCalls: 0,
    automationRetryCalls: 0,
    allowReport: options.mode !== 'load-failure',
    report: options.mode === 'stale-bridge'
      ? options.staleBridgeReport
      : options.mode === 'retryable-failure'
        ? options.retryableReport
        : options.mode === 'suggestion'
          ? options.suggestionReport
          : options.readyReport,
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

  window.__DEEPSEEKPP_HEALTH_DOGFOOD_STATE__ = state;
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
        if (message?.type === 'GET_RUNTIME_DOCTOR_REPORT') {
          state.reportCalls += 1;
          if (options.mode === 'load-failure' && state.allowReport !== true) {
            return {
              ok: false,
              error: 'GET_RUNTIME_DOCTOR_REPORT schemaVersion chrome.runtime Bearer data:image/png;base64,AAAA https://secret.example',
            };
          }
          return { ...state.report };
        }
        if (message?.type === 'RELOAD_STALE_DEEPSEEK_TABS') {
          state.reloadCalls += 1;
          if (options.mode === 'stale-bridge' && state.reloadCalls === 1) {
            return {
              ok: false,
              error: 'RELOAD_STALE_DEEPSEEK_TABS schemaVersion chrome.runtime Bearer data:image/png;base64,AAAA https://secret.example',
            };
          }
          state.report = { ...options.readyReport };
          return { ok: true, reloaded: 2, report: { ...state.report } };
        }
        if (message?.type === 'RUN_PERSONAL_AUTOPILOT_REPAIR') {
          state.ensureReadyCalls += 1;
          state.report = { ...options.readyReport };
          return { ok: true, ready: true, report: { ...state.report } };
        }
        if (message?.type === 'REFRESH_DEEPSEEK_WEB_AUTH') {
          state.recoverAuthCalls += 1;
          state.report = { ...options.readyReport, hasWebAuth: true, webAuthRejected: false };
          return { ok: true, refreshed: true, report: { ...state.report } };
        }
        if (message?.type === 'RUN_PERSONAL_HUMAN_EVAL') {
          state.humanEvalCalls += 1;
          return { ok: true, humanEval: state.report.humanEval, leakSentry: state.report.leakSentry, report: { ...state.report } };
        }
        if (message?.type === 'RUN_AUTOMATION_NOW') {
          state.automationRetryCalls += 1;
          return { id: 'run-2', status: 'succeeded' };
        }
        if (message?.type === 'SAVE_MEMORY') {
          state.saveMemoryCalls += 1;
          return { id: 99 };
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
    const leakPattern = /\b(?:GET|RUN|REFRESH|RELOAD|SAVE|SET)_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|Bearer|Cookie|data:image|AAAA|\[object Object\]|https:\/\/secret\.example|invalid_report/i;
    const summary = document.querySelector('.ds-health-summary');
    return {
      overflow,
      leak: leakPattern.test(visibleText),
      visibleText,
      summarySlot: summary?.getAttribute('data-slot') ?? '',
      summarySize: summary?.getAttribute('data-size') ?? '',
      cardHeaderSlots: summary?.querySelectorAll('[data-slot="card-header"]').length ?? 0,
      cardTitle: summary?.querySelector('[data-slot="card-title"]')?.textContent?.trim() ?? '',
      cardDescription: summary?.querySelector('[data-slot="card-description"]')?.textContent?.trim() ?? '',
      cardContentSlots: summary?.querySelectorAll('[data-slot="card-content"]').length ?? 0,
      badgeText: summary?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent?.trim() ?? '',
      badgeVariant: summary?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.getAttribute('data-variant') ?? '',
      buttonSlots: summary?.querySelectorAll('[data-slot="button"]').length ?? 0,
      pageButtonSlots: document.querySelectorAll('[data-slot="button"]').length,
      statusRows: summary?.querySelectorAll('.ds-health-summary-row').length ?? 0,
      advancedOpen: document.querySelector('.ds-health-details')?.hasAttribute('open') ?? false,
      activeText: document.activeElement?.textContent?.trim() ?? '',
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

async function assertHealthStatusCard(page, width, expected) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.summarySlot === 'card', `Health status Card slot missing at ${width}`);
  await assertDogfood(diagnostics.summarySize === 'sm', `Health status Card size mismatch at ${width}`);
  await assertDogfood(diagnostics.cardHeaderSlots === 1, `Health status CardHeader missing at ${width}`);
  await assertDogfood(diagnostics.cardTitle === '健康状态', `Health status title mismatch at ${width}: ${diagnostics.cardTitle}`);
  await assertDogfood(diagnostics.cardContentSlots === 1, `Health status CardContent missing at ${width}`);
  await assertDogfood(diagnostics.statusRows === 3, `Health status rows mismatch at ${width}`);
  await assertDogfood(diagnostics.badgeText === expected.badgeText, `Health badge mismatch at ${width}: ${diagnostics.badgeText}`);
  await assertDogfood(diagnostics.badgeVariant === expected.badgeVariant, `Health badge variant mismatch at ${width}: ${diagnostics.badgeVariant}`);
  await assertDogfood(diagnostics.cardDescription.includes(expected.description), `Health description mismatch at ${width}: ${diagnostics.cardDescription}`);
  await assertDogfood(diagnostics.visibleText.includes(expected.next), `Health next step missing at ${width}: ${expected.next}`);
  if (expected.buttonSlots !== undefined) {
    await assertDogfood(diagnostics.buttonSlots === expected.buttonSlots, `Health status button count mismatch at ${width}: ${diagnostics.buttonSlots}`);
  }
  return diagnostics;
}

async function assertShadcnButton(page, name, width, label, expectedVariant, expectedSize) {
  const locator = page.getByRole('button', { name, exact: true }).first();
  const count = await locator.count();
  await assertDogfood(count > 0, `${label}: missing button "${name}" at ${width}`);
  const attrs = await locator.evaluate((button) => ({
    slot: button.getAttribute('data-slot'),
    variant: button.getAttribute('data-variant'),
    size: button.getAttribute('data-size'),
    disabled: button.hasAttribute('disabled'),
  }));
  await assertDogfood(attrs.slot === 'button', `${label}: "${name}" missing shadcn Button slot at ${width}`);
  await assertDogfood(attrs.variant === expectedVariant, `${label}: "${name}" variant mismatch at ${width}: ${attrs.variant}`);
  await assertDogfood(attrs.size === expectedSize, `${label}: "${name}" size mismatch at ${width}: ${attrs.size}`);
  return attrs;
}

async function openHealthThroughMenu(page, width, screenshotName) {
  await page.locator('button[aria-label="打开导航菜单"]').click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await page.locator('#ds-v2-menu-panel [data-slot="command-input"]').fill('健康');
  await page.waitForFunction(() => document.body.innerText.includes('健康'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `${screenshotName}-menu-${width}.png`), fullPage: true });
  await page.locator('#ds-v2-menu-panel [data-slot="command-item"]').filter({ hasText: '健康' }).first().click();
  await page.waitForSelector('.ds-health-summary', { timeout: 10000 });
}

async function openDogfoodPage(browser, url, width, mode, screenshotName) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, {
    mode,
    readyReport,
    staleBridgeReport,
    retryableReport,
    suggestionReport,
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
    await page.screenshot({ path: join(outDir, `${screenshotName}-shell-boot-failed-${width}.png`), fullPage: true });
    const bootText = await page.locator('body').innerText().catch(() => '');
    await writeFile(join(outDir, `${screenshotName}-shell-boot-failed-${width}.txt`), [
      `body=${bootText}`,
      `console=${consoleErrors.join(' | ')}`,
      `pageErrors=${pageErrors.join(' | ')}`,
    ].join('\n'));
    throw new Error(`sidepanel shell did not boot at ${width}`);
  }
  await openHealthThroughMenu(page, width, screenshotName);
  return { context, page, consoleErrors, pageErrors };
}

async function scrollHealthSummaryIntoView(page) {
  await page.locator('.ds-health-summary').scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
}

async function runReadyFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, 'ready', 'health-ready');
  await assertHealthStatusCard(page, width, {
    badgeText: '就绪',
    badgeVariant: 'outline',
    description: '运行、存储和复查状态',
    next: '继续',
    buttonSlots: 0,
  });
  await assertShadcnButton(page, '刷新', width, 'ready actions', 'outline', 'sm');
  await assertShadcnButton(page, '刷新登录', width, 'ready actions', 'outline', 'sm');
  await assertShadcnButton(page, '修复并重试', width, 'ready actions', 'outline', 'sm');
  await assertShadcnButton(page, '刷新页面桥接', width, 'ready actions', 'outline', 'sm');
  await assertShadcnButton(page, '运行复查', width, 'ready actions', 'outline', 'sm');
  await assertShadcnButton(page, '检查就绪', width, 'ready actions', 'default', 'sm');
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'ready');
  const callsBeforeRefresh = await page.evaluate(() => window.__DEEPSEEKPP_HEALTH_DOGFOOD_STATE__.reportCalls);
  await page.getByRole('button', { name: '运行复查', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('复查结果: A'), null, { timeout: 10000 });
  await page.getByRole('button', { name: '刷新登录', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('已从当前标签页刷新 DeepSeek 登录状态。'), null, { timeout: 10000 });
  await page.getByRole('button', { name: '检查就绪', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('DeepSeek++ 已准备好运行。'), null, { timeout: 10000 });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForFunction((previousCalls) => {
    return window.__DEEPSEEKPP_HEALTH_DOGFOOD_STATE__.reportCalls > previousCalls;
  }, callsBeforeRefresh, { timeout: 10000 });
  const readyState = await page.evaluate(() => window.__DEEPSEEKPP_HEALTH_DOGFOOD_STATE__);
  await assertDogfood(readyState.humanEvalCalls === 1, `Run review action did not call runtime at ${width}`);
  await assertDogfood(readyState.recoverAuthCalls === 1, `Refresh login action did not call runtime at ${width}`);
  await assertDogfood(readyState.ensureReadyCalls === 1, `Check readiness action did not call runtime at ${width}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'ready actions');
  await page.screenshot({ path: join(outDir, `health-ready-actions-${width}.png`), fullPage: true });
  await scrollHealthSummaryIntoView(page);
  await page.screenshot({ path: join(outDir, `health-ready-${width}.png`), fullPage: true });

  await page.locator('.ds-health-details summary').click();
  await page.waitForFunction(() => document.querySelector('.ds-health-details')?.hasAttribute('open') === true, null, { timeout: 10000 });
  const diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'diagnostic details');
  await assertDogfood(diagnostics.advancedOpen, `Diagnostic details did not open at ${width}`);
  await page.screenshot({ path: join(outDir, `health-diagnostics-open-${width}.png`), fullPage: true });
  await context.close();
}

async function runLoadFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, 'load-failure', 'health-load-failure');
  await assertHealthStatusCard(page, width, {
    badgeText: '需要刷新',
    badgeVariant: 'destructive',
    description: '健康数据未能加载',
    next: '重试健康检查',
    buttonSlots: 1,
  });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'load failure');
  await scrollHealthSummaryIntoView(page);
  await page.screenshot({ path: join(outDir, `health-load-failure-${width}.png`), fullPage: true });

  await page.evaluate(() => {
    window.__DEEPSEEKPP_HEALTH_DOGFOOD_STATE__.allowReport = true;
  });
  await page.locator('.ds-health-summary [data-slot="button"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('就绪') && document.body.innerText.includes('继续'), null, { timeout: 10000 });
  await assertHealthStatusCard(page, width, {
    badgeText: '就绪',
    badgeVariant: 'outline',
    description: '运行、存储和复查状态',
    next: '继续',
    buttonSlots: 0,
  });
  const state = await page.evaluate(() => window.__DEEPSEEKPP_HEALTH_DOGFOOD_STATE__);
  await assertDogfood(state.reportCalls >= 2, `Health refresh did not reload report at ${width}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'load failure recovered');
  await page.screenshot({ path: join(outDir, `health-load-recovered-${width}.png`), fullPage: true });
  await context.close();
}

async function runBridgeActionFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, 'stale-bridge', 'health-bridge-action');
  await assertHealthStatusCard(page, width, {
    badgeText: '需处理',
    badgeVariant: 'secondary',
    description: '有一个健康来源需要刷新',
    next: '刷新页面桥接',
    buttonSlots: 1,
  });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'stale bridge');
  await page.screenshot({ path: join(outDir, `health-bridge-attention-${width}.png`), fullPage: true });

  await page.locator('.ds-health-summary [data-slot="button"]').click();
  await page.waitForFunction(() => document.body.innerText.includes('页面桥接刷新失败：页面桥接刷新未完成。'), null, { timeout: 10000 });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'bridge action failure');
  await page.screenshot({ path: join(outDir, `health-bridge-action-failure-${width}.png`), fullPage: true });

  await page.locator('.ds-health-summary [data-slot="button"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('已刷新 2 个失效 DeepSeek 标签页。'), null, { timeout: 10000 });
  await assertHealthStatusCard(page, width, {
    badgeText: '就绪',
    badgeVariant: 'outline',
    description: '运行、存储和复查状态',
    next: '继续',
    buttonSlots: 0,
  });
  const state = await page.evaluate(() => window.__DEEPSEEKPP_HEALTH_DOGFOOD_STATE__);
  await assertDogfood(state.reloadCalls === 2, `Page bridge retry count mismatch at ${width}: ${state.reloadCalls}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'bridge action recovered');
  await page.screenshot({ path: join(outDir, `health-bridge-recovered-${width}.png`), fullPage: true });
  await context.close();
}

async function runRepairRetryFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, 'retryable-failure', 'health-repair-retry');
  await assertHealthStatusCard(page, width, {
    badgeText: '需处理',
    badgeVariant: 'secondary',
    description: '有一个健康来源需要刷新',
    next: '修复并重试自动化',
    buttonSlots: 1,
  });
  await assertShadcnButton(page, '修复并重试', width, 'repair retry', 'outline', 'sm');
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'repair retry');
  await page.screenshot({ path: join(outDir, `health-repair-retry-${width}.png`), fullPage: true });

  await page.locator('.ds-health-actions').getByRole('button', { name: '修复并重试', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('已刷新 DeepSeek 登录并启动自动化重试。'), null, { timeout: 10000 });
  await assertHealthStatusCard(page, width, {
    badgeText: '就绪',
    badgeVariant: 'outline',
    description: '运行、存储和复查状态',
    next: '继续',
    buttonSlots: 0,
  });
  const state = await page.evaluate(() => window.__DEEPSEEKPP_HEALTH_DOGFOOD_STATE__);
  await assertDogfood(state.recoverAuthCalls === 1, `Repair retry did not refresh auth at ${width}`);
  await assertDogfood(state.automationRetryCalls === 1, `Repair retry did not run automation at ${width}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'repair retry recovered');
  await page.screenshot({ path: join(outDir, `health-repair-retry-recovered-${width}.png`), fullPage: true });
  await context.close();
}

async function runRecoverySuggestionFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, 'suggestion', 'health-recovery-suggestion');
  await assertHealthStatusCard(page, width, {
    badgeText: '就绪',
    badgeVariant: 'outline',
    description: '运行、存储和复查状态',
    next: '继续',
    buttonSlots: 0,
  });
  await assertShadcnButton(page, '保存记忆', width, 'recovery suggestion', 'outline', 'xs');
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'recovery suggestion');
  await page.getByRole('button', { name: '保存记忆', exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  await page.screenshot({ path: join(outDir, `health-recovery-suggestion-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: '保存记忆', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('恢复记忆已保存。'), null, { timeout: 10000 });
  const state = await page.evaluate(() => window.__DEEPSEEKPP_HEALTH_DOGFOOD_STATE__);
  await assertDogfood(state.saveMemoryCalls === 1, `Recovery suggestion did not save memory at ${width}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'recovery suggestion saved');
  await page.getByRole('button', { name: '保存记忆', exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  await page.screenshot({ path: join(outDir, `health-recovery-suggestion-saved-${width}.png`), fullPage: true });
  await context.close();
}

await mkdir(outDir, { recursive: true });
const port = await listen();
const url = `http://127.0.0.1:${port}/sidepanel.html`;
const browser = await chromium.launch({ headless: true });

try {
  for (const width of [420, 360]) {
    await runReadyFlow(browser, url, width);
    await runLoadFailureFlow(browser, url, width);
    await runBridgeActionFailureFlow(browser, url, width);
    await runRepairRetryFlow(browser, url, width);
    await runRecoverySuggestionFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real command menu opened Health through shadcn CommandDialog',
      'Health status Card/Header/Title/Description/Action/Content slots verified',
      'Health status Badge variants verified for ready, load-failure, and attention states',
      'Health action row and ready-check actions verified as shadcn Button slots and clicked through runtime stubs',
      'diagnostic details disclosure was opened',
      'load failure rendered a focused retry action and recovered through keyboard Enter',
      'page bridge action failure rendered sanitized copy and recovered through keyboard Enter',
      'repair-and-retry action refreshed auth, retried automation, and recovered',
      'recovery suggestion Save memory action persisted a sanitized memory',
      'no horizontal overflow at 420px or 360px',
      'no console/page errors',
      'visible leak pattern scan passed',
    ],
  };
  await writeFile(join(outDir, 'dogfood-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(outDir, 'audit-notes.md'), [
    '# Health Status Card Dogfood',
    '',
    'Evidence source: production bundle `dist/chrome-mv3/sidepanel.html` served locally with a contract-shaped Chrome runtime/storage stub.',
    '',
    '1. Ready Health through Menu - healthy. The real command menu opened Health, the shadcn Card/Badge rows rendered, the Health action row and readiness action rendered as shadcn Button slots, and the Refresh, Refresh login, Check readiness, and Run review controls called their runtime paths.',
    '2. Load failure and recovery - healthy. The status card showed `需要刷新`, a single focused refresh action recovered the report through keyboard Enter, and raw runtime text stayed hidden.',
    '3. Page bridge action failure and recovery - healthy. The status card guided `刷新页面桥接`, the first action failure used sanitized copy, and the second keyboard retry returned to ready.',
    '4. Repair retry and recovery memory - healthy. The Repair and retry action refreshed auth and retried automation, while Save memory persisted a sanitized recovery memory from the debug suggestion.',
    '',
    'Checked: 420px and 360px, command menu, status Card slots, Badge variants, shadcn Button slots for Health actions, details disclosure, keyboard Enter on retry actions, repair/retry flow, recovery memory save, DOM overflow, console/page errors, and visible leak patterns.',
    '',
  ].join('\n'));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
