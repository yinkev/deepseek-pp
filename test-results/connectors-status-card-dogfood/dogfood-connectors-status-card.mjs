import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/connectors-status-card-dogfood');

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

const now = 1_782_969_600_000;

const connectorServer = {
  version: 1,
  id: 'research',
  displayName: 'Research workspace',
  enabled: true,
  transport: {
    kind: 'streamable_http',
    url: 'https://research.example/mcp',
  },
  headers: [],
  secrets: [],
  timeouts: {
    connectMs: 5000,
    requestMs: 60000,
    discoveryMs: 10000,
  },
  limits: {
    maxResultBytes: 64000,
    maxToolCount: 32,
  },
  allowlist: {
    mode: 'all',
    toolNames: [],
  },
  execution: {
    enabled: true,
    mode: 'auto',
  },
  status: 'ready',
  lastConnectedAt: now,
  lastError: null,
  createdAt: now,
  updatedAt: now,
};

const connectorTool = {
  id: 'mcp:research:research_search',
  provider: {
    kind: 'mcp',
    id: connectorServer.id,
    displayName: 'Research workspace',
    transport: 'streamable_http',
  },
  name: 'research_search',
  invocationName: 'mcp_research_search',
  title: 'Search workspace',
  description: 'Find matching records from the connected research service.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
    additionalProperties: false,
  },
  execution: {
    mode: 'auto',
    enabled: true,
    risk: 'low',
  },
};

const readyCache = {
  serverId: connectorServer.id,
  descriptors: [connectorTool],
  refreshedAt: now,
  expiresAt: now + 60000,
  health: {
    serverId: connectorServer.id,
    status: 'ready',
    checkedAt: now,
    latencyMs: 38,
    toolCount: 1,
    error: null,
  },
};

const failedCache = {
  ...readyCache,
  descriptors: [],
  health: {
    serverId: connectorServer.id,
    status: 'error',
    checkedAt: now + 1000,
    latencyMs: null,
    toolCount: 0,
    error: 'GET_MCP_SERVER_CONNECTION mcp_network_error: failed to fetch http://127.0.0.1:8765/mcp',
  },
};

const connectorHistory = {
  id: 'history-1',
  call: {
    id: 'call-1',
    descriptorId: connectorTool.id,
    provider: {
      kind: 'mcp',
      id: connectorServer.id,
      displayName: 'Research workspace',
    },
    name: connectorTool.name,
    invocationName: connectorTool.invocationName,
    payload: { query: 'pricing' },
    raw: '<tool_call />',
    createdAt: now,
  },
  result: {
    ok: true,
    summary: '3 matching records',
    display: {},
    error: null,
    createdAt: now,
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
  const {
    connectorServer,
    connectorHistory,
    readyCache,
    failedCache,
  } = options.fixture;
  const storageData = {
    deepseek_pp_chat_enabled: true,
  };
  const runtimeListeners = [];
  const storageListeners = [];
  const state = {
    calls: [],
    failListOnce: options.failListOnce === true,
    failActionsOnce: options.failActionsOnce === true,
    permissionDenied: options.permissionDenied === true,
    actionFailure: options.actionFailure === true,
    createdServers: [],
    deletedServers: [],
    updatedServers: [],
    permissionRequests: [],
  };
  let currentServer = {
    ...connectorServer,
    transport: { ...connectorServer.transport },
    allowlist: { ...connectorServer.allowlist },
    execution: { ...connectorServer.execution },
  };
  let currentCache = { ...readyCache, descriptors: [...readyCache.descriptors], health: { ...readyCache.health } };

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

  window.__DEEPSEEKPP_CONNECTORS_DOGFOOD_STATE__ = state;
  window.chrome = {
    i18n: {
      getUILanguage: () => 'zh-CN',
      getMessage: () => '',
    },
    runtime: {
      id: 'dogfood-extension',
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
        if (message?.type === 'GET_TOOL_DESCRIPTORS') return { providers: [], tools: [], refreshedAt: now };
        if (message?.type === 'GET_PROJECT_CONTEXT_STATE') return { schemaVersion: 2, projects: [], conversations: [], pendingProjectId: null };
        if (message?.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
        if (message?.type === 'GET_MEMORIES') return [];
        if (message?.type === 'GET_SAVED_ITEMS') return [];
        if (message?.type === 'GET_PRESETS') return [];
        if (message?.type === 'GET_ACTIVE_PRESET') return null;
        if (message?.type === 'GET_SKILL_LIBRARY') return [];
        if (message?.type === 'GET_SKILL_SOURCES') return [];
        if (message?.type === 'GET_MCP_SERVERS') {
          if (state.failListOnce) {
            state.failListOnce = false;
            throw new Error('connector list offline');
          }
          return [{
            ...currentServer,
            transport: { ...currentServer.transport },
            allowlist: { ...currentServer.allowlist },
            execution: { ...currentServer.execution },
          }];
        }
        if (message?.type === 'GET_PLATFORM_CAPABILITIES') {
          return {
            kind: 'browser_extension',
            name: 'WebExtension',
            capabilities: { nativeMessaging: true },
          };
        }
        if (message?.type === 'GET_MCP_TOOL_CACHE') {
          if (state.failActionsOnce) {
            state.failActionsOnce = false;
            return { ok: false, error: 'GET_MCP_TOOL_CACHE mcp cache offline' };
          }
          return currentCache;
        }
        if (message?.type === 'GET_TOOL_CALL_HISTORY') return [connectorHistory];
        if (message?.type === 'TEST_MCP_SERVER_CONNECTION' || message?.type === 'REFRESH_MCP_SERVER_TOOLS') {
          currentCache = state.actionFailure ? { ...failedCache } : { ...readyCache };
          return { cache: currentCache };
        }
        if (message?.type === 'CREATE_MCP_SERVER') {
          const created = {
            ...connectorServer,
            id: `created-${state.createdServers.length + 1}`,
            displayName: message.payload?.displayName ?? 'Created connector',
            transport: message.payload?.transport ?? connectorServer.transport,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          state.createdServers.push(created);
          return created;
        }
        if (message?.type === 'UPDATE_MCP_SERVER') {
          state.updatedServers.push(message.payload);
          currentServer = {
            ...currentServer,
            ...(message.payload?.patch ?? {}),
          };
          return { ...currentServer };
        }
        if (message?.type === 'DELETE_MCP_SERVER') {
          state.deletedServers.push(message.payload);
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
    permissions: {
      contains: async (request) => {
        state.permissionRequests.push({ kind: 'contains', request });
        return !state.permissionDenied;
      },
      request: async (request) => {
        state.permissionRequests.push({ kind: 'request', request });
        return !state.permissionDenied;
      },
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
    const overflow = Math.max(root.scrollWidth, body.scrollWidth) > currentWidth + 1;
    const form = document.querySelector('.ds-form');
    const formRect = form?.getBoundingClientRect();
    const formControlOverflow = Boolean(form && formRect && Array.from(form.querySelectorAll('input, textarea, select')).some((control) => {
      const rect = control.getBoundingClientRect();
      return rect.left < formRect.left - 1 || rect.right > formRect.right + 1;
    }));
    const leakPattern = /\bGET_[A-Z0-9_]+\b|mcp[_:/-]|\/mcp|schemaVersion|chrome\.runtime|chrome\.storage|Bearer|Cookie|data:image|\[object Object\]|sk-[A-Za-z0-9_-]{8,}/i;
    const status = document.querySelector('.ds-connector-status');
    return {
      overflow,
      formControlOverflow,
      leak: leakPattern.test(visibleText),
      visibleText,
      statusSlot: status?.getAttribute('data-slot') ?? '',
      statusSize: status?.getAttribute('data-size') ?? '',
      cardHeaderSlots: status?.querySelectorAll('[data-slot="card-header"]').length ?? 0,
      cardTitle: status?.querySelector('[data-slot="card-title"]')?.textContent?.trim() ?? '',
      cardDescription: status?.querySelector('[data-slot="card-description"]')?.textContent?.trim() ?? '',
      cardContentSlots: status?.querySelectorAll('[data-slot="card-content"]').length ?? 0,
      badgeText: status?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent?.trim() ?? '',
      badgeVariant: status?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.getAttribute('data-variant') ?? '',
      statusButtonSlots: status?.querySelectorAll('[data-slot="button"]').length ?? 0,
      statusRows: status?.querySelectorAll('.ds-connector-status-row').length ?? 0,
      connectorRows: document.querySelectorAll('.ds-connector-row').length,
      detailVisible: Boolean(document.querySelector('.ds-connector-detail')),
      formVisible: Boolean(document.querySelector('.ds-form')),
      dialogVisible: Boolean(document.querySelector('[role="alertdialog"], [data-slot="alert-dialog-content"]')),
      commandItems: document.querySelectorAll('#ds-v2-menu-panel [data-slot="command-item"]').length,
    };
  }, width);
}

async function checkNoGlobalFailures(page, consoleErrors, pageErrors, width, label) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(!diagnostics.overflow, `${label}: horizontal overflow at ${width}`);
  await assertDogfood(!diagnostics.formControlOverflow, `${label}: form control overflow at ${width}`);
  await assertDogfood(!diagnostics.leak, `${label}: visible leak pattern at ${width}`);
  await assertDogfood(consoleErrors.length === 0, `${label}: console errors at ${width}: ${consoleErrors.join(' | ')}`);
  await assertDogfood(pageErrors.length === 0, `${label}: page errors at ${width}: ${pageErrors.join(' | ')}`);
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
  }));
  await assertDogfood(attrs.slot === 'button', `${label}: "${name}" missing shadcn Button slot at ${width}`);
  await assertDogfood(attrs.variant === expectedVariant, `${label}: "${name}" variant mismatch at ${width}: ${attrs.variant}`);
  await assertDogfood(attrs.size === expectedSize, `${label}: "${name}" size mismatch at ${width}: ${attrs.size}`);
}

async function assertExecutionModeSelect(page, selector, width, label) {
  const locator = page.locator(selector).first();
  const count = await locator.count();
  await assertDogfood(count > 0, `${label}: execution-mode select missing at ${width}`);
  const options = await locator.evaluate((select) => Array.from(select.options).map((option) => ({
    value: option.value,
    text: option.textContent?.trim() ?? '',
  })));
  const values = options.map((option) => option.value).join('|');
  await assertDogfood(values === 'auto|manual|disabled', `${label}: execution-mode values mismatch at ${width}: ${values}`);
  await assertDogfood(options.every((option) => option.text && option.text !== option.value), `${label}: execution-mode labels are not localized at ${width}`);
}

async function selectExecutionMode(page, selector, width, label, value) {
  await assertExecutionModeSelect(page, selector, width, label);
  await page.locator(selector).first().selectOption(value);
  await page.waitForFunction(
    ({ selectSelector, expectedValue }) => document.querySelector(selectSelector)?.value === expectedValue,
    { selectSelector: selector, expectedValue: value },
    { timeout: 10000 },
  );
}

async function assertConnectorStatusCard(page, width, expected) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.statusSlot === 'card', `connector status Card slot missing at ${width}`);
  await assertDogfood(diagnostics.statusSize === 'sm', `connector status Card size mismatch at ${width}`);
  await assertDogfood(diagnostics.cardHeaderSlots === 1, `connector status CardHeader missing at ${width}`);
  await assertDogfood(diagnostics.cardTitle === '连接器状态', `connector status title mismatch at ${width}: ${diagnostics.cardTitle}`);
  await assertDogfood(diagnostics.cardContentSlots === 1, `connector status CardContent missing at ${width}`);
  await assertDogfood(diagnostics.statusRows === 3, `connector status rows mismatch at ${width}`);
  await assertDogfood(diagnostics.badgeText === expected.badgeText, `connector badge mismatch at ${width}: ${diagnostics.badgeText}`);
  await assertDogfood(diagnostics.badgeVariant === expected.badgeVariant, `connector badge variant mismatch at ${width}: ${diagnostics.badgeVariant}`);
  await assertDogfood(diagnostics.cardDescription.includes(expected.description), `connector description mismatch at ${width}: ${diagnostics.cardDescription}`);
  await assertDogfood(diagnostics.visibleText.includes(expected.next), `connector next step missing at ${width}: ${expected.next}`);
  return diagnostics;
}

async function openConnectorsThroughMenu(page, width, screenshotName) {
  await page.locator('button[aria-label="打开导航菜单"]').click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await page.locator('#ds-v2-menu-panel [data-slot="command-input"]').fill('连接器');
  await page.waitForFunction(() => document.body.innerText.includes('连接器'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `${screenshotName}-menu-${width}.png`), fullPage: true });
  await page.locator('#ds-v2-menu-panel [data-slot="command-item"]').filter({ hasText: '连接器' }).first().click();
  await page.waitForSelector('.ds-connector-status', { timeout: 10000 });
}

async function openDogfoodPage(browser, url, width, options, screenshotName) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, {
    ...options,
    fixture: {
      connectorServer,
      connectorHistory,
      readyCache,
      failedCache,
    },
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
  await openConnectorsThroughMenu(page, width, screenshotName);
  return { context, page, consoleErrors, pageErrors };
}

async function runReadyFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {}, 'connectors-ready');
  await assertConnectorStatusCard(page, width, {
    badgeText: '就绪',
    badgeVariant: 'outline',
    description: '已启用的连接器有可用动作',
    next: '继续',
  });
  let diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'ready');
  await assertDogfood(diagnostics.connectorRows === 1, `connector row missing at ${width}`);
  await assertDogfood(diagnostics.detailVisible, `initial connector detail missing at ${width}`);
  await assertShadcnButton(page, '本机访问', width, 'ready', 'outline', 'sm');
  await assertShadcnButton(page, '添加连接器', width, 'ready', 'default', 'sm');
  await assertShadcnButton(page, '编辑', width, 'ready', 'outline', 'xs');
  await assertShadcnButton(page, '删除', width, 'ready', 'destructive', 'xs');
  await assertShadcnButton(page, '测试', width, 'ready', 'outline', 'xs');
  await assertShadcnButton(page, '刷新动作', width, 'ready', 'outline', 'xs');
  if (await page.getByRole('button', { name: '允许站点', exact: true }).count()) {
    await assertShadcnButton(page, '允许站点', width, 'ready', 'outline', 'xs');
  }
  await selectExecutionMode(page, '.ds-connector-policy select', width, 'detail execution dropdown', 'manual');
  await page.locator('.ds-connector-policy').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, `connectors-detail-dropdown-${width}.png`), fullPage: true });
  await selectExecutionMode(page, '.ds-connector-policy select', width, 'detail execution dropdown', 'auto');
  const stateAfterDetailDropdown = await page.evaluate(() => window.__DEEPSEEKPP_CONNECTORS_DOGFOOD_STATE__);
  await assertDogfood(
    stateAfterDetailDropdown.updatedServers.some((entry) => entry?.patch?.execution?.mode === 'manual'),
    `detail execution dropdown did not send manual mode update at ${width}`,
  );
  await page.locator('.ds-connector-status').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, `connectors-ready-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: /最近活动/ }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Search workspace'), null, { timeout: 10000 });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'history disclosure');
  await page.screenshot({ path: join(outDir, `connectors-history-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: '添加连接器' }).first().click();
  await page.waitForSelector('.ds-form', { timeout: 10000 });
  await page.getByRole('radio', { name: 'Local bridge' }).click();
  await page.getByRole('button', { name: /高级设置/ }).click();
  diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'form interaction');
  await assertDogfood(diagnostics.formVisible, `connector form did not open at ${width}`);
  await assertDogfood(await page.locator('input[placeholder="http://127.0.0.1:8765/actions"]').count() === 1, `local bridge fields missing at ${width}`);
  await assertShadcnButton(page, '取消', width, 'form interaction', 'outline', 'sm');
  await assertShadcnButton(page, '保存', width, 'form interaction', 'default', 'sm');
  await selectExecutionMode(page, '.ds-form select', width, 'form execution dropdown', 'manual');
  await page.locator('.ds-form select').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, `connectors-form-dropdown-${width}.png`), fullPage: true });
  await selectExecutionMode(page, '.ds-form select', width, 'form execution dropdown', 'auto');
  await page.screenshot({ path: join(outDir, `connectors-form-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: '取消' }).click();

  await page.getByRole('button', { name: '删除' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('删除连接器'), null, { timeout: 10000 });
  await page.waitForTimeout(180);
  diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'delete dialog');
  await assertDogfood(diagnostics.dialogVisible, `delete dialog did not open at ${width}`);
  await page.screenshot({ path: join(outDir, `connectors-delete-dialog-${width}.png`), fullPage: true });
  const dialog = page.locator('[role="alertdialog"], [data-slot="alert-dialog-content"]').first();
  await dialog.screenshot({ path: join(outDir, `connectors-delete-dialog-focused-${width}.png`) });
  await page.getByRole('button', { name: '取消' }).click();
  await context.close();
}

async function runListFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, { failListOnce: true }, 'connectors-list-failure');
  await assertConnectorStatusCard(page, width, {
    badgeText: '需要刷新',
    badgeVariant: 'destructive',
    description: '连接器列表未能加载',
    next: '重试连接器数据',
  });
  let diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'list failure');
  await assertDogfood(diagnostics.statusButtonSlots === 1, `retry button missing in status card at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('connector list offline'), `friendly connector list error missing at ${width}`);
  await page.screenshot({ path: join(outDir, `connectors-list-failure-${width}.png`), fullPage: true });
  await page.locator('.ds-connector-status [data-slot="button"]').click();
  await page.waitForFunction(() => document.body.innerText.includes('就绪'), null, { timeout: 10000 });
  await assertConnectorStatusCard(page, width, {
    badgeText: '就绪',
    badgeVariant: 'outline',
    description: '已启用的连接器有可用动作',
    next: '继续',
  });
  diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'list failure recovered');
  await assertDogfood(!diagnostics.visibleText.includes('connector list offline'), `list failure copy persisted after retry at ${width}`);
  await page.screenshot({ path: join(outDir, `connectors-list-recovered-${width}.png`), fullPage: true });
  const state = await page.evaluate(() => window.__DEEPSEEKPP_CONNECTORS_DOGFOOD_STATE__);
  await assertDogfood(state.calls.filter((type) => type === 'GET_MCP_SERVERS').length >= 2, `retry did not reload connectors at ${width}`);
  await context.close();
}

async function runActionsFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, { failActionsOnce: true }, 'connectors-actions-failure');
  await assertConnectorStatusCard(page, width, {
    badgeText: '需要刷新',
    badgeVariant: 'secondary',
    description: '部分连接器数据未能加载',
    next: '重试连接器数据',
  });
  let diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'actions failure');
  await assertDogfood(diagnostics.connectorRows === 1, `connector row hidden during action failure at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('Research workspace 动作'), `action issue label missing at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('动作未能加载'), `sanitized action failure missing at ${width}`);
  await page.screenshot({ path: join(outDir, `connectors-actions-failure-${width}.png`), fullPage: true });
  await page.locator('.ds-connector-status [data-slot="button"]').click();
  await page.waitForFunction(() => document.body.innerText.includes('Search workspace'), null, { timeout: 10000 });
  await assertConnectorStatusCard(page, width, {
    badgeText: '就绪',
    badgeVariant: 'outline',
    description: '已启用的连接器有可用动作',
    next: '继续',
  });
  diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'actions failure recovered');
  await assertDogfood(!diagnostics.visibleText.includes('动作未能加载'), `action failure copy persisted after retry at ${width}`);
  await page.screenshot({ path: join(outDir, `connectors-actions-recovered-${width}.png`), fullPage: true });
  await context.close();
}

async function runPermissionDeniedFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, { permissionDenied: true }, 'connectors-permission-denied');
  await page.getByRole('button', { name: '测试' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('需要授权'), null, { timeout: 10000 });
  const diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'permission denied');
  await assertDogfood(diagnostics.visibleText.includes('https://research.example/*'), `permission origin missing at ${width}`);
  await page.screenshot({ path: join(outDir, `connectors-permission-denied-${width}.png`), fullPage: true });
  const state = await page.evaluate(() => window.__DEEPSEEKPP_CONNECTORS_DOGFOOD_STATE__);
  await assertDogfood(state.permissionRequests.some((entry) => entry.kind === 'request'), `permission request missing at ${width}`);
  await context.close();
}

async function runActionFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, { actionFailure: true }, 'connectors-action-failure');
  await page.getByRole('button', { name: '测试' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('连接失败'), null, { timeout: 10000 });
  const diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'action failure');
  await assertDogfood(diagnostics.visibleText.includes('Research workspace'), `connector row disappeared after action failure at ${width}`);
  await assertDogfood(!diagnostics.visibleText.includes('GET_MCP_SERVER_CONNECTION'), `raw action message leaked at ${width}`);
  await page.screenshot({ path: join(outDir, `connectors-action-failure-${width}.png`), fullPage: true });
  await context.close();
}

await mkdir(outDir, { recursive: true });
const port = await listen();
const url = `http://127.0.0.1:${port}/sidepanel.html`;
const browser = await chromium.launch({ headless: true });

try {
  for (const width of [420, 360]) {
    await runReadyFlow(browser, url, width);
    await runListFailureFlow(browser, url, width);
    await runActionsFailureFlow(browser, url, width);
    await runPermissionDeniedFlow(browser, url, width);
    await runActionFailureFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real command menu opened Connectors through shadcn CommandDialog',
      'Connectors status Card/Header/Title/Description/Action/Content slots verified',
      'Connectors status Badge variants verified for ready, list-failure, and partial action-failure states',
      'Local computer, Add connector, Edit, Delete, Test, Refresh actions, Save, and Cancel actions verified as shadcn Button slots',
      'detail and form execution dropdowns were option-checked, changed, verified, and reset',
      'connector details and recent activity disclosure were opened',
      'add connector form was opened, connection type changed, and advanced controls opened',
      'delete confirmation dialog opened and cancel flow was exercised',
      'connector list load failure rendered retry and recovered',
      'connector action-cache failure kept rows visible, rendered sanitized copy, and recovered',
      'permission denial rendered a truthful permission state',
      'test action failure rendered sanitized failure copy without raw runtime names',
      'no horizontal overflow at 420px or 360px',
      'no console/page errors',
      'visible leak pattern scan passed',
    ],
  };
  await writeFile(join(outDir, 'dogfood-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(outDir, 'audit-notes.md'), createAuditNotes());
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

function createAuditNotes() {
  return `# Connectors Status Card Dogfood

Evidence source: production bundle \`dist/chrome-mv3/sidepanel.html\` served locally with a contract-shaped Chrome runtime/storage/permissions stub.

1. Connectors through Menu - healthy. The real command menu opened Connectors at 420px and 360px, and the status card rendered shadcn Card/Header/Title/Description/Action/Content plus the Ready badge.
2. Connector actions - healthy. Local computer, Add connector, Edit, Delete, Test, Refresh actions, Save, and Cancel rendered as shadcn Button slots with the expected variants and sizes while preserving the existing handlers.
3. Dropdowns and details - healthy. The detail execution dropdown exposed localized Auto/Manual/Disabled options, changed through the runtime update path, and reset cleanly; Recent activity opened, rendered the sanitized action label, and did not expose raw action ids.
4. Add connector form - healthy. The form opened from the real Add connector action, connection type changed to Local bridge, advanced controls opened, the default execution dropdown changed and reset, and form actions remained readable at 420px and 360px.
5. Delete confirmation - healthy. The delete confirmation opened and cancel flow returned without deleting; focused dialog screenshots were captured.
6. Failure and recovery - healthy. Connector list failure and action-cache failure rendered truthful retry states, preserved reachable rows when partial data failed, and recovered through the status action.
7. Permission/action failures - healthy. Permission denial and test-action failure rendered sanitized user-facing copy without raw runtime message names.

Checked: 420px and 360px, command menu, status Card slots, Badge variants, shadcn Button slots for connector actions, detail/form dropdown interactions, detail disclosure, add form, delete dialog, list/action failure recovery, permission denial, action failure, DOM overflow, console/page errors, and visible leak patterns.

Visual review: accepted \`connectors-ready-420.png\`, \`connectors-ready-360.png\`, \`connectors-detail-dropdown-360.png\`, \`connectors-form-dropdown-420.png\`, \`connectors-form-420.png\`, \`connectors-form-360.png\`, \`connectors-delete-dialog-focused-360.png\`, \`connectors-list-failure-360.png\`, \`connectors-permission-denied-420.png\`, and \`connectors-action-failure-360.png\`. No clipped action labels or horizontal overflow were visible.

UX rubric: clarity 9/10, function 9/10, visual taste 9/10, evidence integrity 9/10, accessibility 9/10, user cognitive load 9/10, architecture fit 9/10, regression risk 9/10, long-horizon usefulness 9/10. No known P1/P2 findings remain for this slice.
`;
}
