import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/projects-shadcn-dogfood');

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
    title: 'Project planning',
    url: 'https://chat.deepseek.com/a/chat/s/conversation-1',
  },
};

const seededProject = {
  id: 'project-seeded',
  name: 'Seeded project',
  description: 'Existing workspace context.',
  instructions: 'Keep project work verified.',
  createdAt: 1,
  updatedAt: 2,
};

const seededMemory = {
  id: 1,
  syncId: 'memory-1',
  scope: 'project',
  projectId: seededProject.id,
  type: 'reference',
  name: 'Evidence rule',
  content: 'Separate verified evidence from guesses.',
  description: '',
  tags: ['evidence'],
  pinned: true,
  createdAt: 1,
  updatedAt: 2,
  accessCount: 0,
  lastAccessedAt: 1,
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
  const projects = options.projects.map((project) => ({ ...project }));
  const conversations = options.conversations.map((conversation) => ({ ...conversation }));
  const memories = options.memories.map((memory) => ({ ...memory }));
  const state = {
    calls: [],
    createProjectPayloads: [],
    updateProjectPayloads: [],
    pendingPayloads: [],
    linkedConversationPayloads: [],
    deleteProjectPayloads: [],
    pendingProjectId: options.pendingProjectId ?? null,
    failMemoryLoadOnce: options.failMemoryLoadOnce === true,
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
    return {
      schemaVersion: 2,
      pendingProjectId: state.pendingProjectId,
      projects: projects.map((project) => ({ ...project })),
      conversations: conversations.map((conversation) => ({ ...conversation })),
    };
  }

  window.__DEEPSEEKPP_PROJECTS_DOGFOOD_STATE__ = state;
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
        if (message?.type === 'GET_PROJECT_CONTEXT_STATE') return projectState();
        if (message?.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return options.currentConversation;
        if (message?.type === 'GET_MEMORIES') {
          if (state.failMemoryLoadOnce) {
            state.failMemoryLoadOnce = false;
            throw new Error('project memory offline');
          }
          return memories.map((memory) => ({ ...memory }));
        }
        if (message?.type === 'GET_SAVED_ITEMS') return [];
        if (message?.type === 'GET_PRESETS') return [];
        if (message?.type === 'GET_ACTIVE_PRESET') return null;
        if (message?.type === 'GET_SKILL_LIBRARY') return [];
        if (message?.type === 'GET_SKILL_SOURCES') return [];
        if (message?.type === 'CREATE_PROJECT_CONTEXT') {
          state.createProjectPayloads.push(message.payload);
          const project = {
            id: `project-${projects.length + 1}`,
            name: message.payload?.name ?? '',
            description: message.payload?.description ?? '',
            instructions: message.payload?.instructions ?? '',
            createdAt: 10,
            updatedAt: 10,
          };
          projects.unshift(project);
          return { ...project };
        }
        if (message?.type === 'UPDATE_PROJECT_CONTEXT') {
          state.updateProjectPayloads.push(message.payload);
          const index = projects.findIndex((project) => project.id === message.payload?.projectId);
          if (index >= 0) {
            projects[index] = {
              ...projects[index],
              ...message.payload?.patch,
              updatedAt: 20,
            };
          }
          return { ok: true };
        }
        if (message?.type === 'SET_PENDING_PROJECT_CONTEXT') {
          state.pendingPayloads.push(message.payload);
          state.pendingProjectId = message.payload?.projectId ?? null;
          return { ok: true };
        }
        if (message?.type === 'ADD_CONVERSATION_TO_PROJECT') {
          state.linkedConversationPayloads.push(message.payload);
          const next = {
            ...message.payload?.conversation,
            projectId: message.payload?.projectId,
            addedAt: 30,
            lastSeenAt: 30,
          };
          const index = conversations.findIndex((conversation) => conversation.conversationId === next.conversationId);
          if (index >= 0) conversations[index] = next;
          else conversations.unshift(next);
          return { ok: true };
        }
        if (message?.type === 'DELETE_PROJECT_CONTEXT') {
          state.deleteProjectPayloads.push(message.payload);
          const index = projects.findIndex((project) => project.id === message.payload?.projectId);
          if (index >= 0) projects.splice(index, 1);
          state.pendingProjectId = state.pendingProjectId === message.payload?.projectId ? null : state.pendingProjectId;
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

async function assertButtonSlot(page, label, step, width) {
  const hasSlot = await page.evaluate((buttonLabel) => {
    return Array.from(document.querySelectorAll('button'))
      .some((button) => button.textContent?.trim() === buttonLabel && button.getAttribute('data-slot') === 'button');
  }, label);
  await assertDogfood(hasSlot, `${step}: ${label} is not a shadcn Button at ${width}`);
}

async function assertProjectFormContract(page, rootSelector, step, width, expectedRows) {
  const contract = await page.evaluate(({ selector, rows }) => {
    const root = document.querySelector(selector);
    if (!root) return { ok: false, reason: 'missing form root' };
    const nameInput = root.querySelector('input[placeholder="项目名称"]');
    const descriptionInput = root.querySelector('input[placeholder="项目说明（可选）"]');
    const instructions = root.querySelector('textarea[placeholder="项目指令"]');
    const fields = root.querySelectorAll('[data-slot="field"]').length;
    return {
      ok: Boolean(nameInput && descriptionInput && instructions),
      fields,
      nameSlot: nameInput?.getAttribute('data-slot') ?? '',
      descriptionSlot: descriptionInput?.getAttribute('data-slot') ?? '',
      textareaSlot: instructions?.getAttribute('data-slot') ?? '',
      textareaRows: instructions?.getAttribute('rows') ?? '',
      hasNameLabel: Boolean(nameInput && root.querySelector(`label[for="${nameInput.id}"]`)),
      hasDescriptionLabel: Boolean(descriptionInput && root.querySelector(`label[for="${descriptionInput.id}"]`)),
      hasInstructionsLabel: Boolean(instructions && root.querySelector(`label[for="${instructions.id}"]`)),
      expectedRows: String(rows),
    };
  }, { selector: rootSelector, rows: expectedRows });
  await assertDogfood(contract.ok, `${step}: missing project form controls at ${width}`);
  await assertDogfood(contract.fields >= 3, `${step}: missing shadcn Field slots at ${width}`);
  await assertDogfood(contract.nameSlot === 'input', `${step}: project name missing Input slot at ${width}`);
  await assertDogfood(contract.descriptionSlot === 'input', `${step}: project description missing Input slot at ${width}`);
  await assertDogfood(contract.textareaSlot === 'textarea', `${step}: project instructions missing Textarea slot at ${width}`);
  await assertDogfood(contract.textareaRows === contract.expectedRows, `${step}: textarea rows mismatch at ${width}`);
  await assertDogfood(contract.hasNameLabel && contract.hasDescriptionLabel && contract.hasInstructionsLabel, `${step}: label wiring broken at ${width}`);
}

async function waitForProjectSubmitReady(page, rootSelector, label, width) {
  const ready = await page.waitForFunction(({ selector, buttonLabel }) => {
    const button = Array.from(document.querySelectorAll(`${selector} button`))
      .find((candidate) => candidate.textContent?.trim() === buttonLabel);
    if (!button || button.disabled) return false;
    const style = window.getComputedStyle(button);
    const match = style.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    const rgb = match ? match.slice(1, 4).map(Number) : null;
    const isStrongPrimary = rgb ? rgb[0] < 130 && rgb[1] < 170 && rgb[2] > 200 : style.backgroundColor.includes('oklch');
    return isStrongPrimary && style.color !== 'rgb(136, 141, 150)' && style.color !== 'rgb(152, 156, 164)';
  }, { selector: rootSelector, buttonLabel: label }, { timeout: 10000 }).catch(() => null);
  if (!ready) {
    const state = await page.evaluate(({ selector, buttonLabel }) => {
      const button = Array.from(document.querySelectorAll(`${selector} button`))
        .find((candidate) => candidate.textContent?.trim() === buttonLabel);
      if (!button) return { found: false };
      const style = window.getComputedStyle(button);
      return {
        found: true,
        disabled: button.disabled,
        backgroundColor: style.backgroundColor,
        color: style.color,
        className: button.className,
      };
    }, { selector: rootSelector, buttonLabel: label });
    throw new Error(`project submit not visually ready at ${width}: ${JSON.stringify(state)}`);
  }
}

async function openProjects(page) {
  await page.locator('button[aria-label="打开导航菜单"]').click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await page.locator('#ds-v2-menu-panel [data-slot="command-item"]').filter({ hasText: '项目' }).first().click();
  await page.waitForSelector('.ds-project-page', { timeout: 10000 });
}

async function waitForAlertDialogStable(page) {
  await page.waitForSelector('[data-slot="alert-dialog-content"]', { timeout: 10000 });
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[data-slot="alert-dialog-content"]');
    if (!dialog) return false;
    const style = window.getComputedStyle(dialog);
    const rect = dialog.getBoundingClientRect();
    return style.opacity === '1' && rect.width > 240 && rect.height > 80;
  }, null, { timeout: 10000 });
  await page.waitForTimeout(150);
}

async function runHealthyProjectsFlow(browser, url, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, {
    projects: [],
    conversations: [],
    memories: [],
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
  await openProjects(page);
  await page.waitForFunction(() => document.body.innerText.includes('暂无项目'), null, { timeout: 10000 });
  await assertDogfood(await page.locator('[data-slot="empty"]').count() > 0, `empty state missing shadcn Empty at ${width}`);
  await assertButtonSlot(page, '创建项目', 'header create', width);
  await page.screenshot({ path: join(outDir, `projects-empty-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: '创建项目' }).click();
  await page.locator('input[placeholder="项目名称"]').fill(`UX Project ${width}`);
  await page.locator('input[placeholder="项目说明（可选）"]').fill(`Width ${width} project context.`);
  await page.locator('textarea[placeholder="项目指令"]').fill(`Keep the ${width}px project flow verified and direct.`);
  await waitForProjectSubmitReady(page, '#ds-project-create-panel', '创建项目', width);
  await assertProjectFormContract(page, '#ds-project-create-panel', 'create form', width, 4);
  await assertButtonSlot(page, '创建项目', 'create submit', width);
  await page.screenshot({ path: join(outDir, `projects-create-form-${width}.png`), fullPage: true });
  await verifyStablePage(page, width, 'create form');
  await page.locator('#ds-project-create-panel').getByRole('button', { name: '创建项目' }).click();
  await page.waitForFunction(
    (name) => document.body.innerText.includes(name),
    `UX Project ${width}`,
    { timeout: 10000 },
  );
  await page.screenshot({ path: join(outDir, `projects-created-${width}.png`), fullPage: true });

  await assertDogfood(await page.locator('.ds-project-readiness [data-slot="badge"]').count() > 0, `readiness badge missing at ${width}`);
  await page.getByRole('button', { name: '编辑' }).first().click();
  await assertProjectFormContract(page, '#ds-project-settings-panel', 'edit form', width, 6);
  await page.locator('#ds-project-settings-panel input[placeholder="项目说明（可选）"]').fill(`Edited at ${width}px.`);
  await page.locator('#ds-project-settings-panel textarea[placeholder="项目指令"]').fill(`Edited project instructions at ${width}px.`);
  await waitForProjectSubmitReady(page, '#ds-project-settings-panel', '保存更改', width);
  await assertButtonSlot(page, '保存更改', 'edit save', width);
  await page.screenshot({ path: join(outDir, `projects-edit-form-${width}.png`), fullPage: true });
  await page.locator('#ds-project-settings-panel').getByRole('button', { name: '保存更改' }).click();
  await page.waitForFunction(
    (text) => document.body.innerText.includes(text),
    `Edited at ${width}px.`,
    { timeout: 10000 },
  );

  await page.getByRole('button', { name: /设为下一次/ }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes('新的 DeepSeek 对话会进入这个项目。'), null, { timeout: 10000 });
  await assertButtonSlot(page, '清除', 'clear next project', width);
  await page.screenshot({ path: join(outDir, `projects-pending-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: /关联对话|移到这里|更新关联/ }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes('已关联'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `projects-linked-${width}.png`), fullPage: true });

  await page.getByRole('button', { name: '删除' }).first().click();
  await waitForAlertDialogStable(page);
  await assertDogfood(await page.locator('[data-slot="alert-dialog-title"]').count() > 0, `delete dialog title missing at ${width}`);
  await assertDogfood(await page.locator('[data-slot="alert-dialog-cancel"]').count() > 0, `delete dialog cancel missing at ${width}`);
  await assertDogfood(await page.locator('[data-slot="alert-dialog-action"]').count() > 0, `delete dialog action missing at ${width}`);
  await page.screenshot({ path: join(outDir, `projects-delete-dialog-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: '取消' }).click();
  await page.waitForSelector('[data-slot="alert-dialog-content"]', { state: 'detached', timeout: 10000 });

  const dogfoodState = await page.evaluate(() => window.__DEEPSEEKPP_PROJECTS_DOGFOOD_STATE__);
  await assertDogfood(dogfoodState.createProjectPayloads.length === 1, `create payload count mismatch at ${width}`);
  await assertDogfood(dogfoodState.createProjectPayloads[0].name === `UX Project ${width}`, `create payload name mismatch at ${width}`);
  await assertDogfood(dogfoodState.createProjectPayloads[0].description === `Width ${width} project context.`, `create payload description mismatch at ${width}`);
  await assertDogfood(dogfoodState.createProjectPayloads[0].instructions === `Keep the ${width}px project flow verified and direct.`, `create payload instructions mismatch at ${width}`);
  await assertDogfood(dogfoodState.updateProjectPayloads.length === 1, `update payload count mismatch at ${width}`);
  await assertDogfood(dogfoodState.pendingPayloads.at(-1)?.projectId === 'project-1', `pending payload mismatch at ${width}`);
  await assertDogfood(dogfoodState.linkedConversationPayloads.length === 1, `linked conversation payload missing at ${width}`);

  await verifyStablePage(page, width, 'healthy projects result');
  await assertDogfood(consoleErrors.length === 0, `console errors at ${width}: ${consoleErrors.join(' | ')}`);
  await assertDogfood(pageErrors.length === 0, `page errors at ${width}: ${pageErrors.join(' | ')}`);
  await context.close();
}

async function runMemoryFailureFlow(browser, url, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, {
    projects: [seededProject],
    conversations: [],
    memories: [seededMemory],
    currentConversation,
    failMemoryLoadOnce: true,
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
  await openProjects(page);
  await page.waitForSelector('.ds-project-source-alert[data-slot="alert"]', { timeout: 10000 });
  await assertDogfood(await page.locator('.ds-project-source-alert[data-slot="alert"]').filter({ hasText: 'project memory offline' }).count() === 1, `memory failure alert missing at ${width}`);
  await assertButtonSlot(page, '重试', 'memory retry', width);
  await page.screenshot({ path: join(outDir, `projects-memory-failure-${width}.png`), fullPage: true });
  await verifyStablePage(page, width, 'memory failure');

  await page.getByRole('button', { name: '重试' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Evidence rule'), null, { timeout: 10000 });
  await assertDogfood(
    await page.locator('.ds-project-memory-actions [data-slot="tooltip-trigger"][data-variant="ghost"][data-size="icon-xs"]').count() >= 3,
    `memory row actions missing shadcn Button/Tooltip trigger contract at ${width}`,
  );
  await assertDogfood(await page.locator('.ds-project-source-alert').count() === 0, `memory failure alert did not clear at ${width}`);
  await page.screenshot({ path: join(outDir, `projects-memory-recovered-${width}.png`), fullPage: true });

  await verifyStablePage(page, width, 'memory recovered');
  await assertDogfood(consoleErrors.length === 0, `console errors in failure flow at ${width}: ${consoleErrors.join(' | ')}`);
  await assertDogfood(pageErrors.length === 0, `page errors in failure flow at ${width}: ${pageErrors.join(' | ')}`);
  await context.close();
}

await mkdir(outDir, { recursive: true });
const port = await listen();
const url = `http://127.0.0.1:${port}/sidepanel.html`;
const browser = await chromium.launch({ headless: true });

try {
  for (const width of [420, 360]) {
    await runHealthyProjectsFlow(browser, url, width);
    await runMemoryFailureFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real command menu navigation opened Projects',
      'no-project state rendered through shadcn Empty',
      'create and edit project forms used shadcn Field/Input/Textarea slots with labels',
      'create, edit, assignment, link, retry, and destructive actions rendered through shadcn Button slots',
      'memory row icon actions preserved shadcn Button variant/size through TooltipTrigger asChild',
      'readiness state used shadcn Badge',
      'project creation payload matched typed name, description, and instructions',
      'project edit payload was recorded and visible state recovered',
      'next-chat assignment payload matched selected project',
      'current conversation link payload was recorded and visible state recovered',
      'delete confirmation opened as shadcn AlertDialog and was cancelled',
      'memory-source failure showed shadcn Alert instead of a false empty state',
      'Retry recovered project memory rows',
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
