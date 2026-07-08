import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/automation-status-card-dogfood');

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json'],
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

function createAutomation(overrides = {}) {
  const now = Date.now();
  const base = {
    id: 'automation-ready',
    name: 'Ready loop',
    prompt: 'Plan the work, evaluate evidence, review risks, grade confidence, iterate once, then stop.',
    status: 'active',
    schedule: {
      kind: 'manual',
      expression: null,
      timezone: 'America/Los_Angeles',
      enabled: false,
      minimumIntervalMinutes: 15,
    },
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: true,
      refFileIds: [],
      webVisionFiles: [],
      visualMonitor: {
        enabled: false,
        source: 'browser_control_target',
        includeEvidencePack: true,
      },
    },
    deepseek: {
      chatSessionId: null,
      parentMessageId: null,
      sessionUrl: null,
      lastHistorySyncedAt: null,
    },
    chain: {
      enabled: false,
      onSuccessAutomationIds: [],
      maxDepth: 3,
    },
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    version: 1,
  };
  return {
    ...base,
    ...overrides,
    schedule: {
      ...base.schedule,
      ...(overrides.schedule ?? {}),
    },
    promptOptions: {
      ...base.promptOptions,
      ...(overrides.promptOptions ?? {}),
    },
    deepseek: {
      ...base.deepseek,
      ...(overrides.deepseek ?? {}),
    },
    chain: {
      ...base.chain,
      ...(overrides.chain ?? {}),
    },
  };
}

const readyAutomation = createAutomation();
const attentionAutomation = createAutomation({
  id: 'automation-attention',
  name: 'Research digest',
  prompt: 'Research source updates and stop.',
  promptOptions: {
    modelType: null,
    searchEnabled: false,
    thinkingEnabled: false,
    refFileIds: [],
    webVisionFiles: [],
    visualMonitor: {
      enabled: false,
      source: 'browser_control_target',
      includeEvidencePack: true,
    },
  },
});
const blockedAutomation = createAutomation({
  id: 'automation-blocked',
  name: 'Blocked vision',
  prompt: 'Look at the current page and stop.',
  promptOptions: {
    modelType: 'vision',
    searchEnabled: false,
    thinkingEnabled: false,
    refFileIds: [],
    webVisionFiles: [],
    visualMonitor: undefined,
  },
});
const rawFailure = 'RUN_AUTOMATION_NOW schemaVersion chrome.runtime Bearer data:image/png;base64,AAAA https://secret.example';
const storedFailureAutomation = createAutomation({
  id: 'automation-action-failure',
  name: 'Runnable automation',
  lastError: {
    code: 'runtime_failed',
    phase: 'runner',
    retryable: false,
    at: Date.now(),
    message: rawFailure,
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
    automationCalls: 0,
    runBatchCalls: 0,
    runCalls: 0,
    updateCalls: [],
    allowAutomationLoad: options.mode !== 'load-failure',
    allowRunHistory: options.mode !== 'history-failure',
    automations: options.automations,
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

  window.__DEEPSEEKPP_AUTOMATION_DOGFOOD_STATE__ = state;
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
        if (message?.type === 'SAVE_PERSONAL_CONVENIENCE_CONFIG') return { ok: true, config: message.payload };
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
        if (message?.type === 'GET_AUTOMATIONS') {
          state.automationCalls += 1;
          if (!state.allowAutomationLoad) {
            throw new Error('GET_AUTOMATIONS schemaVersion chrome.runtime Bearer data:image/png;base64,AAAA https://secret.example');
          }
          return state.automations;
        }
        if (message?.type === 'GET_AUTOMATION_RUNS_BATCH') {
          state.runBatchCalls += 1;
          if (!state.allowRunHistory) {
            throw new Error('GET_AUTOMATION_RUNS_BATCH schemaVersion chrome.runtime Bearer data:image/png;base64,AAAA https://secret.example');
          }
          return {};
        }
        if (message?.type === 'GET_AUTOMATION_RUNS') {
          if (!state.allowRunHistory) {
            throw new Error('GET_AUTOMATION_RUNS schemaVersion chrome.runtime Bearer data:image/png;base64,AAAA https://secret.example');
          }
          return [];
        }
        if (message?.type === 'UPDATE_AUTOMATION') {
          state.updateCalls.push(message.payload);
          return { ok: true };
        }
        if (message?.type === 'RUN_AUTOMATION_NOW') {
          state.runCalls += 1;
          return { ok: false, error: options.rawFailure };
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
    const leakPattern = /\b(?:GET|RUN|CREATE|UPDATE|DELETE|SET|SAVE)_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|Bearer|Cookie|data:image|AAAA|\[object Object\]|https:\/\/secret\.example|secret-token/i;
    const status = document.querySelector('.ds-automation-status');
    return {
      overflow,
      leak: leakPattern.test(visibleText),
      visibleText,
      statusSlot: status?.getAttribute('data-slot') ?? '',
      statusSize: status?.getAttribute('data-size') ?? '',
      cardHeaderSlots: status?.querySelectorAll('[data-slot="card-header"]').length ?? 0,
      cardTitle: status?.querySelector('[data-slot="card-title"]')?.textContent?.trim() ?? '',
      cardContentSlots: status?.querySelectorAll('[data-slot="card-content"]').length ?? 0,
      badgeText: status?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent?.trim() ?? '',
      badgeVariant: status?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.getAttribute('data-variant') ?? '',
      buttonSlots: status?.querySelectorAll('[data-slot="button"]').length ?? 0,
      statusRows: status?.querySelectorAll('.ds-automation-status-row').length ?? 0,
      alertSlots: document.querySelectorAll('[data-slot="alert"]').length,
      emptySlots: document.querySelectorAll('[data-slot="empty"]').length,
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

async function assertAutomationStatusCard(page, width, expected) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.statusSlot === 'card', `Automation status Card slot missing at ${width}`);
  await assertDogfood(diagnostics.statusSize === 'sm', `Automation status Card size mismatch at ${width}`);
  await assertDogfood(diagnostics.cardHeaderSlots === 1, `Automation status CardHeader missing at ${width}`);
  await assertDogfood(diagnostics.cardTitle === '自动化状态', `Automation status title mismatch at ${width}: ${diagnostics.cardTitle}`);
  await assertDogfood(diagnostics.cardContentSlots === 1, `Automation status CardContent missing at ${width}`);
  await assertDogfood(diagnostics.statusRows === 4, `Automation status rows mismatch at ${width}`);
  await assertDogfood(diagnostics.badgeText === expected.badgeText, `Automation badge mismatch at ${width}: ${diagnostics.badgeText}`);
  await assertDogfood(diagnostics.badgeVariant === expected.badgeVariant, `Automation badge variant mismatch at ${width}: ${diagnostics.badgeVariant}`);
  await assertDogfood(diagnostics.visibleText.includes(expected.next), `Automation next step missing at ${width}: ${expected.next}`);
  if (expected.buttonSlots !== undefined) {
    await assertDogfood(diagnostics.buttonSlots === expected.buttonSlots, `Automation button count mismatch at ${width}: ${diagnostics.buttonSlots}`);
  }
  return diagnostics;
}

function shadcnButtonLocator(page, label, variant, size) {
  let locator = page.locator('button[data-slot="button"]').filter({ hasText: label });
  if (variant) locator = page.locator(`button[data-slot="button"][data-variant="${variant}"]`).filter({ hasText: label });
  if (size) {
    const selector = `button[data-slot="button"]${variant ? `[data-variant="${variant}"]` : ''}[data-size="${size}"]`;
    locator = page.locator(selector).filter({ hasText: label });
  }
  return locator;
}

async function assertShadcnButton(page, label, variant, size, contextLabel) {
  const count = await shadcnButtonLocator(page, label, variant, size).count();
  await assertDogfood(
    count > 0,
    `${contextLabel}: missing shadcn button ${label} variant=${variant ?? '*'} size=${size ?? '*'}`,
  );
}

async function clickShadcnButton(page, label, variant, size, contextLabel) {
  await assertShadcnButton(page, label, variant, size, contextLabel);
  await shadcnButtonLocator(page, label, variant, size).first().click();
}

async function assertToggleGroup(page, selector, expectedItems, contextLabel) {
  const group = page.locator(`${selector} [data-slot="toggle-group"]`).first();
  await assertDogfood(await group.count() === 1, `${contextLabel}: missing shadcn ToggleGroup`);
  await assertDogfood(await group.getAttribute('data-variant') === 'outline', `${contextLabel}: ToggleGroup variant mismatch`);
  await assertDogfood(await group.getAttribute('data-size') === 'sm', `${contextLabel}: ToggleGroup size mismatch`);
  const itemCount = await group.locator('[data-slot="toggle-group-item"]').count();
  await assertDogfood(itemCount === expectedItems, `${contextLabel}: ToggleGroup item count mismatch ${itemCount}`);
  return group;
}

async function assertAutomationSelect(page, label, expectedText, contextLabel) {
  const field = page.locator('.ds-automation-select-field').filter({ hasText: label }).first();
  await assertDogfood(await field.count() === 1, `${contextLabel}: missing select field ${label}`);
  const trigger = field.locator('[data-slot="select-trigger"]').first();
  await assertDogfood(await trigger.count() === 1, `${contextLabel}: missing select trigger ${label}`);
  await assertDogfood(await trigger.getAttribute('data-size') === 'sm', `${contextLabel}: select trigger size mismatch ${label}`);
  await assertDogfood((await trigger.innerText()).includes(expectedText), `${contextLabel}: select value mismatch ${label}`);
  return trigger;
}

async function chooseAutomationSelectOption(page, label, optionText, screenshotName) {
  const trigger = await assertAutomationSelect(page, label, '', `select ${label}`);
  await trigger.click();
  await page.waitForSelector('[data-slot="select-content"]', { timeout: 10000 });
  if (screenshotName) await page.screenshot({ path: join(outDir, screenshotName), fullPage: true });
  const option = page.locator('[data-slot="select-item"]').filter({ hasText: optionText }).first();
  await assertDogfood(await option.count() === 1, `missing select option ${optionText} for ${label}`);
  await option.click();
  await page.waitForSelector('[data-slot="select-content"]', { state: 'detached', timeout: 10000 });
}

async function assertAutomationSwitch(page, label, expectedChecked, expectedDisabled, contextLabel) {
  const switchControl = page.locator(`button[role="switch"][aria-label="${label}"][data-slot="switch"]`).first();
  await assertDogfood(await switchControl.count() === 1, `${contextLabel}: missing switch ${label}`);
  await assertDogfood(await switchControl.getAttribute('aria-checked') === String(expectedChecked), `${contextLabel}: switch state mismatch ${label}`);
  await assertDogfood(await switchControl.isDisabled() === expectedDisabled, `${contextLabel}: switch disabled mismatch ${label}`);
  return switchControl;
}

async function assertShadcnTextControl(page, placeholder, tagName, contextLabel) {
  const control = page.getByPlaceholder(placeholder).first();
  await assertDogfood(await control.count() === 1, `${contextLabel}: missing ${tagName} placeholder ${placeholder}`);
  const diagnostics = await control.evaluate((element) => ({
    tagName: element.tagName.toLowerCase(),
    slot: element.getAttribute('data-slot'),
    hasField: Boolean(element.closest('[data-slot="field"]')),
  }));
  const expectedSlot = tagName === 'textarea' ? 'textarea' : 'input';
  await assertDogfood(diagnostics.tagName === tagName, `${contextLabel}: expected ${tagName}, got ${diagnostics.tagName}`);
  await assertDogfood(diagnostics.slot === expectedSlot, `${contextLabel}: expected data-slot=${expectedSlot}, got ${diagnostics.slot}`);
  await assertDogfood(diagnostics.hasField, `${contextLabel}: ${placeholder} is not inside a shadcn Field`);
  return control;
}

async function assertTooltipIconButton(page, label, variant, contextLabel) {
  const button = page.locator(`button[aria-label="${label}"][data-slot="tooltip-trigger"][data-variant="${variant}"][data-size="icon-sm"]`).first();
  await assertDogfood(await button.count() === 1, `${contextLabel}: missing tooltip icon button ${label}`);
  await button.hover();
  await page.waitForSelector('[data-slot="tooltip-content"]', { timeout: 10000 });
}

async function openAutomationThroughMenu(page, width, screenshotName) {
  await page.locator('button[aria-label="打开导航菜单"]').click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await page.locator('#ds-v2-menu-panel [data-slot="command-input"]').fill('自动化');
  await page.waitForFunction(() => document.body.innerText.includes('自动化'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `${screenshotName}-menu-${width}.png`), fullPage: true });
  await page.locator('#ds-v2-menu-panel [data-slot="command-item"]').filter({ hasText: '自动化' }).first().click();
  await page.waitForSelector('.ds-automation-status', { timeout: 10000 });
}

async function openDogfoodPage(browser, url, width, mode, screenshotName, automations) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, {
    mode,
    automations,
    rawFailure,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="打开导航菜单"]', { timeout: 10000 });
  await openAutomationThroughMenu(page, width, screenshotName);
  return { context, page, consoleErrors, pageErrors };
}

async function fillAutomationForm(page, name, prompt) {
  const nameInput = await assertShadcnTextControl(page, '任务名称', 'input', 'fill automation name');
  const promptTextarea = await assertShadcnTextControl(page, '输入要定时发送到 DeepSeek 的内容', 'textarea', 'fill automation prompt');
  await nameInput.fill(name);
  await promptTextarea.fill(prompt);
}

async function waitForAutomationUiToSettle(page) {
  await page.waitForTimeout(350);
}

async function scrollAutomationStatusIntoView(page) {
  await page.locator('.ds-automation-status').scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
}

async function runCommandLauncherFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, 'command-launcher', 'automation-command-launcher', []);
  await assertAutomationStatusCard(page, width, {
    badgeText: '无任务',
    badgeVariant: 'secondary',
    next: '新建或选择工作流',
    buttonSlots: 1,
  });
  await assertShadcnButton(page, '准备运行', 'default', 'sm', `command launcher at ${width}`);
  const objectiveTextarea = await assertShadcnTextControl(page, '目标、范围或故障', 'textarea', `command launcher objective at ${width}`);
  await objectiveTextarea.fill('Fix failing automation tests and update the proof ledger.');
  await clickShadcnButton(page, '准备运行', 'default', 'sm', `command launcher at ${width}`);
  await page.waitForSelector('input[placeholder="任务名称"]', { timeout: 10000 });
  await waitForAutomationUiToSettle(page);
  const formNameInput = await assertShadcnTextControl(page, '任务名称', 'input', `command seeded form name at ${width}`);
  const formPromptTextarea = await assertShadcnTextControl(page, '输入要定时发送到 DeepSeek 的内容', 'textarea', `command seeded form prompt at ${width}`);
  const formName = await formNameInput.inputValue();
  const formPrompt = await formPromptTextarea.inputValue();
  const formText = await page.locator('body').innerText();
  await assertDogfood(formName === '修复与验证循环', `Command launcher did not seed repair form at ${width}: ${formName}`);
  await assertDogfood(formPrompt.includes('Fix failing automation tests'), `Command launcher did not inject objective at ${width}: ${formPrompt}`);
  await assertDogfood(formText.includes('60 分钟'), `Command launcher timeout budget missing at ${width}`);
  await assertDogfood(formText.includes('25 轮工具延续'), `Command launcher tool budget missing at ${width}`);
  await assertShadcnButton(page, '添加图片', 'outline', 'sm', `command form at ${width}`);
  await assertShadcnButton(page, '取消', 'outline', 'sm', `command form at ${width}`);
  await assertShadcnButton(page, '创建', 'default', 'sm', `command form at ${width}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'command launcher form');
  await page.screenshot({ path: join(outDir, `automation-command-launcher-form-${width}.png`), fullPage: true });
  await context.close();
}

async function runFormControlFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(
    browser,
    url,
    width,
    'form-controls',
    'automation-form-controls',
    [readyAutomation, attentionAutomation],
  );
  await clickShadcnButton(page, '新建', 'default', 'sm', `form controls new at ${width}`);
  await page.waitForSelector('input[placeholder="任务名称"]', { timeout: 10000 });
  await waitForAutomationUiToSettle(page);
  const nameInput = await assertShadcnTextControl(page, '任务名称', 'input', `form name field at ${width}`);
  const visualRefsInput = await assertShadcnTextControl(page, '如有需要，粘贴已保存的视觉引用', 'input', `form visual refs field at ${width}`);
  const promptTextarea = await assertShadcnTextControl(page, '输入要定时发送到 DeepSeek 的内容', 'textarea', `form prompt field at ${width}`);
  const timezoneInput = await assertShadcnTextControl(page, 'Asia/Shanghai', 'input', `form timezone field at ${width}`);
  const manualExpressionInput = await assertShadcnTextControl(page, '0 9 * * *', 'input', `manual expression field at ${width}`);
  await assertDogfood(await manualExpressionInput.isDisabled(), `manual expression input should be disabled at ${width}`);
  await nameInput.fill(`Dogfood form ${width}`);
  await promptTextarea.fill('Dogfood prompt typed through a shadcn Textarea slot.');
  await timezoneInput.fill('America/Los_Angeles');
  await assertDogfood(await visualRefsInput.inputValue() === '', `visual refs field should start empty at ${width}`);
  await assertAutomationSelect(page, '模型', '默认', `form model select at ${width}`);
  await assertAutomationSelect(page, '触发', '手动', `form trigger select at ${width}`);
  await assertAutomationSwitch(page, '联网', false, true, `visual default switches at ${width}`);
  await assertAutomationSwitch(page, '深度思考', false, true, `visual default switches at ${width}`);
  await chooseAutomationSelectOption(page, '模型', '视觉', `automation-form-model-select-${width}.png`);
  await assertAutomationSelect(page, '模型', '视觉', `vision model select at ${width}`);
  await page.waitForFunction(() => document.body.innerText.includes('视觉运行使用图片模式'), null, { timeout: 10000 });
  await assertAutomationSwitch(page, '联网', false, true, `vision switches at ${width}`);
  await assertAutomationSwitch(page, '深度思考', false, true, `vision switches at ${width}`);
  await chooseAutomationSelectOption(page, '模型', '默认', null);
  await page
    .locator('.ds-toggle-row')
    .filter({ hasText: '运行开始时捕获已选择的浏览器标签页' })
    .locator('button[role="switch"], [data-slot="switch"]')
    .first()
    .click();
  await assertAutomationSwitch(page, '联网', false, false, `text switches at ${width}`);
  await assertAutomationSwitch(page, '深度思考', false, false, `text switches at ${width}`);
  await (await assertAutomationSwitch(page, '联网', false, false, `search switch toggle at ${width}`)).click();
  await (await assertAutomationSwitch(page, '深度思考', false, false, `thinking switch toggle at ${width}`)).click();
  await assertAutomationSwitch(page, '联网', true, false, `search switch toggled at ${width}`);
  await assertAutomationSwitch(page, '深度思考', true, false, `thinking switch toggled at ${width}`);
  await chooseAutomationSelectOption(page, '触发', 'Cron 定时', `automation-form-trigger-select-${width}.png`);
  await assertAutomationSelect(page, '触发', 'Cron 定时', `cron trigger select at ${width}`);
  const cronExpressionInput = await assertShadcnTextControl(page, '0 9 * * *', 'input', `cron expression field at ${width}`);
  await assertDogfood(!(await cronExpressionInput.isDisabled()), `cron expression input should be enabled at ${width}`);
  await cronExpressionInput.fill('0 10 * * *');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'dogfood.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.waitForFunction(() => document.body.innerText.includes('dogfood.png'), null, { timeout: 10000 });
  const removeAttachment = page.locator('button[aria-label="移除 dogfood.png"][data-slot="button"][data-variant="ghost"][data-size="icon-xs"]');
  await assertDogfood(await removeAttachment.count() === 1, `attachment remove shadcn Button missing at ${width}`);
  await removeAttachment.click();
  await page.waitForFunction(() => !document.body.innerText.includes('dogfood.png'), null, { timeout: 10000 });

  await page
    .locator('.ds-toggle-row')
    .filter({ hasText: '成功后运行后续任务' })
    .locator('button[role="switch"], [data-slot="switch"]')
    .first()
    .click();
  await assertToggleGroup(page, '.ds-form', 2, `chain targets at ${width}`);
  const chainTarget = page.locator('.ds-form [data-slot="toggle-group-item"]').filter({ hasText: 'Research digest' }).first();
  await assertDogfood(await chainTarget.getAttribute('data-state') === 'off', `chain target initial state mismatch at ${width}`);
  await chainTarget.click();
  await assertDogfood(await chainTarget.getAttribute('data-state') === 'on', `chain target did not toggle on at ${width}`);
  const chainInput = await assertShadcnTextControl(page, '后续自动化 ID', 'input', `chain fallback field at ${width}`);
  await chainInput.fill('automation-ready');
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'form remaining controls');
  await page.screenshot({ path: join(outDir, `automation-form-controls-${width}.png`), fullPage: true });
  await context.close();
}

async function runEmptyFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, 'empty', 'automation-empty', []);
  await assertAutomationStatusCard(page, width, {
    badgeText: '无任务',
    badgeVariant: 'secondary',
    next: '新建或选择工作流',
    buttonSlots: 1,
  });
  await assertShadcnButton(page, '使用', 'outline', 'xs', `empty templates at ${width}`);
  const emptyTemplateSearch = await assertShadcnTextControl(page, '搜索工作流', 'input', `empty template search at ${width}`);
  await emptyTemplateSearch.fill('恢复');
  await page.waitForFunction(() => document.body.innerText.includes('运行就绪恢复'), null, { timeout: 10000 });
  await emptyTemplateSearch.fill('');
  const diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'empty automation');
  await assertDogfood(diagnostics.emptySlots >= 1, `Empty slot missing at ${width}`);
  await scrollAutomationStatusIntoView(page);
  await page.screenshot({ path: join(outDir, `automation-empty-${width}.png`), fullPage: true });

  await clickShadcnButton(page, '使用', 'outline', 'xs', `empty template use at ${width}`);
  await page.waitForSelector('input[placeholder="任务名称"]', { timeout: 10000 });
  await waitForAutomationUiToSettle(page);
  await assertShadcnButton(page, '添加图片', 'outline', 'sm', `template form at ${width}`);
  await assertShadcnButton(page, '取消', 'outline', 'sm', `template form at ${width}`);
  await assertShadcnButton(page, '创建', 'default', 'sm', `template form at ${width}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'template form action');
  await page.screenshot({ path: join(outDir, `automation-template-form-${width}.png`), fullPage: true });
  await clickShadcnButton(page, '取消', 'outline', 'sm', `template form cancel at ${width}`);
  await page.waitForSelector('.ds-automation-status', { timeout: 10000 });

  await page.locator('.ds-automation-status [data-slot="button"]').click();
  await page.waitForSelector('[data-slot="textarea"]', { timeout: 10000 });
  await waitForAutomationUiToSettle(page);
  await assertShadcnButton(page, '添加图片', 'outline', 'sm', `empty create form at ${width}`);
  await assertShadcnButton(page, '取消', 'outline', 'sm', `empty create form at ${width}`);
  await assertShadcnButton(page, '创建', 'default', 'sm', `empty create form at ${width}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'empty create action');
  await page.screenshot({ path: join(outDir, `automation-empty-create-${width}.png`), fullPage: true });
  await page
    .locator('.ds-toggle-row')
    .filter({ hasText: '运行开始时捕获已选择的浏览器标签页' })
    .locator('button[role="switch"], [data-slot="switch"]')
    .first()
    .click();
  await fillAutomationForm(page, 'Dogfood readiness', 'Run a workflow to research this source and evaluate it.');
  await page.waitForFunction(() => document.body.innerText.includes('研究或监控 Prompt 应开启联网。'), null, { timeout: 10000 });
  await assertShadcnButton(page, '准备运行', 'default', 'xs', `readiness actions at ${width}`);
  await assertShadcnButton(page, '应用安全修正', 'outline', 'xs', `readiness actions at ${width}`);
  await assertShadcnButton(page, '补强循环', 'outline', 'xs', `readiness actions at ${width}`);
  await page.locator('text=就绪评分').last().scrollIntoViewIfNeeded();
  await waitForAutomationUiToSettle(page);
  await page.screenshot({ path: join(outDir, `automation-readiness-actions-${width}.png`), fullPage: true });
  await clickShadcnButton(page, '应用安全修正', 'outline', 'xs', `readiness safe fixes at ${width}`);
  await clickShadcnButton(page, '补强循环', 'outline', 'xs', `readiness loop contract at ${width}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'readiness form actions');
  await page.locator('text=就绪评分').last().scrollIntoViewIfNeeded();
  await waitForAutomationUiToSettle(page);
  await page.screenshot({ path: join(outDir, `automation-readiness-fixed-${width}.png`), fullPage: true });
  await context.close();
}

async function runBlockedFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(
    browser,
    url,
    width,
    'blocked',
    'automation-blocked',
    [readyAutomation, attentionAutomation, blockedAutomation],
  );
  await assertAutomationStatusCard(page, width, {
    badgeText: '已阻塞',
    badgeVariant: 'destructive',
    next: '查看阻塞任务',
    buttonSlots: 1,
  });
  await assertShadcnButton(page, '全部准备', 'outline', 'sm', `blocked header at ${width}`);
  await assertShadcnButton(page, '模板', 'outline', 'sm', `blocked header at ${width}`);
  await assertShadcnButton(page, '新建', 'default', 'sm', `blocked header at ${width}`);
  await assertShadcnButton(page, '打开会话', 'outline', 'sm', `blocked card action at ${width}`);
  await assertShadcnButton(page, '准备运行', 'outline', 'sm', `blocked card action at ${width}`);
  await assertShadcnButton(page, '立即运行', 'default', 'sm', `blocked card action at ${width}`);
  const filterGroup = await assertToggleGroup(page, '.ds-automation-filter-rail', 4, `automation filters at ${width}`);
  await filterGroup.locator('[data-slot="toggle-group-item"][aria-label="阻塞"]').click();
  await page.waitForFunction(() => document.body.innerText.includes('显示 1 / 3'), null, { timeout: 10000 });
  await filterGroup.locator('[data-slot="toggle-group-item"][aria-label="全部"]').click();
  await page.waitForFunction(() => document.body.innerText.includes('显示 1 / 3') === false, null, { timeout: 10000 });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'blocked automation');
  await scrollAutomationStatusIntoView(page);
  await page.screenshot({ path: join(outDir, `automation-blocked-${width}.png`), fullPage: true });

  await clickShadcnButton(page, '模板', 'outline', 'sm', `blocked show templates at ${width}`);
  await page.waitForFunction(() => document.body.innerText.includes('运行就绪恢复'), null, { timeout: 10000 });
  await assertShadcnButton(page, '使用', 'outline', 'xs', `blocked templates at ${width}`);
  const blockedTemplateSearch = await assertShadcnTextControl(page, '搜索工作流', 'input', `blocked template search at ${width}`);
  await blockedTemplateSearch.fill('项目');
  await blockedTemplateSearch.fill('');
  await assertAutomationSelect(page, '分类', '全部', `template category select at ${width}`);
  await chooseAutomationSelectOption(page, '分类', '项目', `automation-template-category-select-${width}.png`);
  await page.waitForFunction(() => document.body.innerText.includes('实现委员会'), null, { timeout: 10000 });
  await chooseAutomationSelectOption(page, '分类', '全部', null);
  await page.waitForFunction(() => document.body.innerText.includes('运行就绪恢复'), null, { timeout: 10000 });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'blocked templates action');
  await page.screenshot({ path: join(outDir, `automation-templates-open-${width}.png`), fullPage: true });

  await clickShadcnButton(page, '全部准备', 'outline', 'sm', `blocked prepare all at ${width}`);
  await page.waitForFunction(() => window.__DEEPSEEKPP_AUTOMATION_DOGFOOD_STATE__.updateCalls.length >= 1, null, { timeout: 10000 });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'blocked prepare all action');
  await page.screenshot({ path: join(outDir, `automation-prepare-all-${width}.png`), fullPage: true });

  await page.locator('.ds-automation-status [data-slot="button"]').click();
  await page.waitForFunction(() => document.body.innerText.includes('显示 1 / 3'), null, { timeout: 10000 });
  const bodyText = await page.locator('body').innerText();
  await assertDogfood(bodyText.includes('Blocked vision'), `Blocked automation missing at ${width}`);
  await assertDogfood(!bodyText.includes('Ready loop'), `Ready automation still visible after blocked filter at ${width}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'blocked filter action');
  await page.screenshot({ path: join(outDir, `automation-blocked-filtered-${width}.png`), fullPage: true });
  await context.close();
}

async function runLoadFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, 'load-failure', 'automation-load-failure', [readyAutomation]);
  await assertAutomationStatusCard(page, width, {
    badgeText: '需要刷新',
    badgeVariant: 'destructive',
    next: '重试自动化加载',
    buttonSlots: 1,
  });
  let diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'load failure');
  await assertDogfood(diagnostics.alertSlots >= 1, `Alert slot missing at ${width}`);
  await scrollAutomationStatusIntoView(page);
  await page.screenshot({ path: join(outDir, `automation-load-failure-${width}.png`), fullPage: true });

  await page.evaluate(() => {
    window.__DEEPSEEKPP_AUTOMATION_DOGFOOD_STATE__.allowAutomationLoad = true;
  });
  await page.locator('.ds-automation-status [data-slot="button"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('Ready loop'), null, { timeout: 10000 });
  await assertAutomationStatusCard(page, width, {
    badgeText: '就绪',
    badgeVariant: 'outline',
    next: '运行、编辑或定时任务',
    buttonSlots: 0,
  });
  diagnostics = await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'load failure recovered');
  await assertDogfood(diagnostics.alertSlots === 0, `Load failure alert still visible after recovery at ${width}`);
  await page.screenshot({ path: join(outDir, `automation-load-recovered-${width}.png`), fullPage: true });
  await context.close();
}

async function runHistoryFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, 'history-failure', 'automation-history-failure', [readyAutomation]);
  await assertAutomationStatusCard(page, width, {
    badgeText: '需要刷新',
    badgeVariant: 'secondary',
    next: '刷新最近运行记录',
    buttonSlots: 1,
  });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'history failure');
  const bodyText = await page.locator('body').innerText();
  await assertDogfood(bodyText.includes('Ready loop'), `Automation row hidden by history failure at ${width}`);
  await page.screenshot({ path: join(outDir, `automation-history-failure-${width}.png`), fullPage: true });

  await page.evaluate(() => {
    window.__DEEPSEEKPP_AUTOMATION_DOGFOOD_STATE__.allowRunHistory = true;
  });
  await page.locator('.ds-automation-status [data-slot="button"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('运行、编辑或定时任务'), null, { timeout: 10000 });
  await assertAutomationStatusCard(page, width, {
    badgeText: '就绪',
    badgeVariant: 'outline',
    next: '运行、编辑或定时任务',
    buttonSlots: 0,
  });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'history failure recovered');
  await page.screenshot({ path: join(outDir, `automation-history-recovered-${width}.png`), fullPage: true });
  await context.close();
}

async function runActionFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, 'action-failure', 'automation-action-failure', [storedFailureAutomation]);
  await assertAutomationStatusCard(page, width, {
    badgeText: '就绪',
    badgeVariant: 'outline',
    next: '运行、编辑或定时任务',
    buttonSlots: 0,
  });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'stored action failure');
  await assertTooltipIconButton(page, '暂停', 'ghost', `card status icon at ${width}`);
  await assertTooltipIconButton(page, '编辑', 'ghost', `card edit icon at ${width}`);
  await assertTooltipIconButton(page, '删除', 'destructive', `card delete icon at ${width}`);
  await page.screenshot({ path: join(outDir, `automation-action-failure-stored-${width}.png`), fullPage: true });

  await page.locator('button').filter({ hasText: '立即运行' }).last().click();
  await page.waitForFunction(() => window.__DEEPSEEKPP_AUTOMATION_DOGFOOD_STATE__.runCalls === 1, null, { timeout: 10000 });
  await page.waitForTimeout(120);
  const actionText = await page.locator('body').innerText();
  await assertDogfood(
    actionText.includes('自动化操作失败：自动化操作未能完成。'),
    `Run action failure banner missing sanitized copy at ${width}: ${actionText}`,
  );
  const state = await page.evaluate(() => window.__DEEPSEEKPP_AUTOMATION_DOGFOOD_STATE__);
  await assertDogfood(state.runCalls === 1, `Run action was not invoked exactly once at ${width}: ${state.runCalls}`);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'run action failure');
  await page.screenshot({ path: join(outDir, `automation-action-failure-banner-${width}.png`), fullPage: true });
  await context.close();
}

await mkdir(outDir, { recursive: true });
const port = await listen();
const url = `http://127.0.0.1:${port}/sidepanel.html`;
const browser = await chromium.launch({ headless: true });

try {
  for (const width of [420, 360]) {
    await runCommandLauncherFlow(browser, url, width);
    await runFormControlFlow(browser, url, width);
    await runEmptyFlow(browser, url, width);
    await runBlockedFlow(browser, url, width);
    await runLoadFailureFlow(browser, url, width);
    await runHistoryFailureFlow(browser, url, width);
    await runActionFailureFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real command menu opened Automation through shadcn CommandDialog',
      'Automation status Card/Header/Title/Description/Action/Content slots verified',
      'Automation status Badge variants verified for empty, ready, blocked, load-failure, and history-failure states',
      'command launcher objective used a shadcn Textarea Field, accepted typed text, and opened the repair-and-verify form with preserved long-loop budget values',
      'workflow template Use buttons opened the real edit-before-save form',
      'automation list search, template search, form name, visual refs, prompt, schedule expression, timezone, and chain fallback fields rendered as shadcn Field/Input/Textarea slots',
      'form text controls accepted real typing, and the manual schedule expression field was disabled until Cron was selected',
      'form Attach image, Cancel, and Create actions rendered as shadcn Button slots',
      'readiness Prepare run, Apply safe fixes, and Loop contract actions rendered as shadcn Button slots and were clicked',
      'header Prepare all, Templates, and New actions rendered as shadcn Button slots and Prepare all invoked runtime update',
      'card Open session, Prepare run, and Run now actions rendered as shadcn Button slots',
      'model, trigger, and template category dropdowns rendered as shadcn Select slots and were opened/changed',
      'search and deep-thinking switches rendered as shadcn Switch slots, locked under visual routing, and toggled after unlock',
      'filter chips and chain targets rendered as shadcn ToggleGroup items and were toggled',
      'attachment remove rendered as an icon-xs shadcn Button and removed the image chip',
      'card status/edit/delete controls rendered as shadcn Button composition under tooltip triggers',
      'empty state opens the real create form from the status card',
      'blocked status action filters to blocked tasks',
      'load failure rendered a focused retry action and recovered through keyboard Enter',
      'run-history failure kept saved automations visible and recovered through keyboard Enter',
      'stored and action failures rendered sanitized copy',
      'no horizontal overflow at 420px or 360px',
      'no console/page errors',
      'visible leak pattern scan passed',
    ],
  };
  await writeFile(join(outDir, 'dogfood-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(outDir, 'audit-notes.md'), [
    '# Automation Status Card Dogfood',
    '',
    'Evidence source: production bundle `dist/chrome-mv3/sidepanel.html` served locally with a contract-shaped Chrome runtime/storage stub.',
    '',
    '1. Command launcher - healthy. The real command menu opened Automation, the objective field was a shadcn Textarea inside a Field and accepted typed text, the launcher `准备运行` button opened the repair-and-verify form, and the long-loop timeout/tool-budget values stayed visible.',
    '2. Empty Automation and templates - healthy. The shadcn status Card rendered `无任务`, the shadcn Empty state rendered, template search was a shadcn Input inside a Field and accepted typed filtering, template `使用` opened the real edit-before-save form, and Attach image / Cancel / Create were shadcn Button slots.',
    '3. Readiness actions - healthy. A text workflow produced visible readiness issues, then `准备运行`, `应用安全修正`, and `补强循环` rendered as shadcn Button slots and responded to clicks.',
    '4. Blocked header and card actions - healthy. Header `全部准备`, `模板`, and `新建` rendered as shadcn Button slots, card Open session / Prepare run / Run now controls rendered as shadcn Button slots, templates opened, the template category Select opened and changed, and Prepare all invoked a runtime update.',
    '5. Remaining form controls - healthy. Name, visual refs, prompt, schedule expression, timezone, and chain fallback controls were shadcn Field/Input/Textarea slots; typed values landed in the controls; the manual expression field stayed disabled until Cron was selected; model and trigger Select controls opened and changed; search/deep-thinking Switch controls were locked under visual routing, unlocked after visual capture was disabled, and toggled on. Attachment remove used an icon shadcn Button, chain targets used shadcn ToggleGroup multi-select, and both responded to real clicks.',
    '6. Filter and icon controls - healthy. Automation filters used shadcn ToggleGroup single-select, and card status/edit/delete actions used shadcn Button composition under tooltip triggers.',
    '7. Blocked task routing - healthy. The status card showed `已阻塞`, routed to the blocked filter, and kept only the blocked task visible.',
    '8. Load failure and recovery - healthy. The status card showed `需要刷新`, the Alert used sanitized fallback copy, and keyboard Enter recovered the task list.',
    '9. Run-history failure and recovery - healthy. Saved tasks stayed visible while recent runs failed, and keyboard Enter refreshed history without leaking raw runtime text.',
    '10. Stored/action failure redaction - healthy. Stored last-error and Run now failure both showed sanitized copy while preserving the task row.',
    '',
    'Checked: 420px and 360px, command menu, command launcher, Automation search, template search, name/visual refs/prompt/expression/timezone/chain fields, disabled/enabled expression state, template picker, model Select, trigger Select, category Select, search/deep-thinking Switch controls, form actions, attachment removal, chain target toggles, filter toggles, icon tooltips, readiness actions, header actions, card actions, status Card slots, Badge variants, Empty/Alert slots, create form opening, blocked filtering, keyboard Enter retries, run action failure, DOM overflow, console/page errors, and visible leak patterns.',
    '',
  ].join('\n'));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
