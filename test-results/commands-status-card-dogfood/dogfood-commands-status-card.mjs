import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve('/Users/kyin/Projects/Deepseek-pp');
const distRoot = join(repoRoot, 'dist/chrome-mv3');
const outDir = join(repoRoot, 'test-results/commands-status-card-dogfood');

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

const builtinSummarize = {
  name: 'summarize',
  description: 'Summarize source material into concise notes.',
  instructions: 'Summarize: {input}',
  source: 'builtin',
  memoryEnabled: false,
  enabled: true,
};

const customReviewer = {
  name: 'risk-review',
  description: 'Review changes for blocking issues before style, with concise evidence and safe next steps for risky edits.',
  instructions: 'Find P1/P2 risks first.',
  source: 'custom',
  memoryEnabled: true,
  enabled: true,
};

const remoteResearch = {
  name: 'research',
  description: 'Search and summarize project references.',
  instructions: 'Use references.',
  source: 'remote',
  memoryEnabled: false,
  enabled: false,
  remote: {
    provider: 'github',
    sourceId: 'github-commands',
    repository: 'acme/commands',
    ref: 'main',
    commitSha: 'abcdef1234567890',
    path: 'research/SKILL.md',
    originalName: 'research',
    importedAt: 1,
    updatedAt: 2,
    includedFiles: [],
    omittedFiles: [],
    warnings: [],
  },
};

const githubSource = {
  id: 'github-commands',
  provider: 'github',
  url: 'https://github.com/acme/commands',
  owner: 'acme',
  repo: 'commands',
  repository: 'acme/commands',
  ref: 'main',
  rootPath: '',
  commitSha: 'abcdef1234567890',
  defaultBranch: 'main',
  repoUrl: 'https://github.com/acme/commands',
  skillPaths: ['research/SKILL.md'],
  importedSkillNames: ['research'],
  importedAt: 1,
  updatedAt: 2,
};

const githubImportPreview = {
  source: githubSource,
  skills: [
    {
      path: 'research/SKILL.md',
      name: 'research',
      importName: 'research',
      description: 'Search and summarize project references.',
      bytes: 1200,
      bodyBytes: 800,
      includedFiles: ['references/guide.md'],
      omittedFiles: ['archive/raw-export.zip'],
      warnings: ['Skill warning'],
      nameChanged: true,
      version: '1.2.3',
    },
  ],
  warnings: ['Repository warning'],
  truncated: false,
};

const githubImportResult = {
  ok: true,
  source: githubSource,
  imported: [
    {
      name: 'research',
      description: 'Search and summarize project references.',
      instructions: 'Use this command for project research.',
      source: 'github:github-commands',
      memoryEnabled: false,
      enabled: true,
    },
  ],
  replaced: 0,
  renamed: 1,
  warnings: [],
};

const localSource = {
  id: 'local-commands',
  provider: 'local',
  rootPath: '/Users/me/.codex/skills/research',
  displayName: 'research',
  directoryName: 'research',
  skillPaths: ['SKILL.md'],
  importedSkillNames: ['research'],
  importedAt: 1,
  updatedAt: 2,
  warnings: [],
};

const localImportPreview = {
  source: localSource,
  skills: [
    {
      path: 'SKILL.md',
      name: 'research',
      importName: 'research',
      description: 'Search and summarize local references.',
      bytes: 1000,
      bodyBytes: 720,
      includedFiles: ['references/local-guide.md'],
      omittedFiles: ['cache/blob.bin'],
      scriptFiles: ['scripts/prepare.sh'],
      warnings: ['Local skill warning'],
      nameChanged: true,
      version: '0.4.0',
    },
  ],
  warnings: ['Local folder warning'],
  truncated: false,
};

const localImportResult = {
  ok: true,
  source: localSource,
  imported: [
    {
      name: 'research',
      description: 'Search and summarize local references.',
      instructions: 'Use this command for local research.',
      source: 'local:local-commands',
      memoryEnabled: false,
      enabled: true,
    },
  ],
  replaced: 0,
  renamed: 1,
  warnings: [],
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
    deepseek_pp_locale_preference: 'en',
    deepseek_pp_chat_enabled: true,
  };
  const runtimeListeners = [];
  const storageListeners = [];
  const skills = options.skills.map((skill) => ({ ...skill }));
  const sources = options.sources.map((source) => ({ ...source }));
  const state = {
    calls: [],
    saveSkillPayloads: [],
    setSkillEnabledPayloads: [],
    githubPreviewPayloads: [],
    githubImportPayloads: [],
    localPreviewPayloads: [],
    localImportPayloads: [],
    failLibraryLoadOnce: options.failLibraryLoadOnce === true,
    failSourceLoadOnce: options.failSourceLoadOnce === true,
  };

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

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

  window.__DEEPSEEKPP_COMMANDS_STATUS_DOGFOOD_STATE__ = state;
  window.chrome = {
    i18n: {
      getUILanguage: () => 'en',
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
        if (message?.type === 'GET_PROJECT_CONTEXT_STATE') return { schemaVersion: 2, pendingProjectId: null, projects: [], conversations: [] };
        if (message?.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') return { ok: false, error: 'no_active_deepseek_conversation' };
        if (message?.type === 'GET_MEMORIES') return [];
        if (message?.type === 'GET_SAVED_ITEMS') return [];
        if (message?.type === 'GET_PRESETS') return [];
        if (message?.type === 'GET_ACTIVE_PRESET') return null;
        if (message?.type === 'GET_SKILL_LIBRARY') {
          if (state.failLibraryLoadOnce) {
            state.failLibraryLoadOnce = false;
            return {
              ok: false,
              error: { message: 'GET_SKILL_LIBRARY schemaVersion chrome.storage deepseek_pp_skills token secret [object Object]' },
            };
          }
          return skills.map((skill) => ({ ...skill }));
        }
        if (message?.type === 'GET_SKILL_SOURCES') {
          if (state.failSourceLoadOnce) {
            state.failSourceLoadOnce = false;
            return {
              ok: false,
              error: { message: 'GET_SKILL_SOURCES schemaVersion chrome.runtime deepseek_pp_skill_sources token secret [object Object]' },
            };
          }
          return sources.map((source) => ({ ...source }));
        }
        if (message?.type === 'SAVE_SKILL') {
          const savedSkill = message.payload?.skill ?? message.payload;
          state.saveSkillPayloads.push(savedSkill);
          const existingIndex = skills.findIndex((skill) => skill.name === message.payload?.previousName || skill.name === savedSkill?.name);
          const nextSkill = { ...savedSkill, source: savedSkill?.source ?? 'custom' };
          if (existingIndex >= 0) {
            skills[existingIndex] = { ...skills[existingIndex], ...nextSkill };
          } else {
            skills.unshift(nextSkill);
          }
          return { ok: true };
        }
        if (message?.type === 'SET_SKILL_ENABLED') {
          state.setSkillEnabledPayloads.push(message.payload);
          const match = skills.find((skill) => skill.name === message.payload?.name);
          if (match) match.enabled = message.payload?.enabled !== false;
          return { ok: true };
        }
        if (message?.type === 'DELETE_SKILL') {
          const index = skills.findIndex((skill) => skill.name === message.payload?.name);
          if (index >= 0) skills.splice(index, 1);
          return { ok: true };
        }
        if (message?.type === 'PREVIEW_GITHUB_SKILL_SOURCE') {
          state.githubPreviewPayloads.push(message.payload);
          return clone(options.githubImportPreview);
        }
        if (message?.type === 'IMPORT_GITHUB_SKILL_SOURCE') {
          state.githubImportPayloads.push(message.payload);
          return clone(options.githubImportResult);
        }
        if (message?.type === 'PREVIEW_LOCAL_SKILL_SOURCE') {
          state.localPreviewPayloads.push(message.payload);
          return clone(options.localImportPreview);
        }
        if (message?.type === 'IMPORT_LOCAL_SKILL_SOURCE') {
          state.localImportPayloads.push(message.payload);
          return clone(options.localImportResult);
        }
        if (message?.type === 'CHECK_GITHUB_SKILL_SOURCE_UPDATES') return { ok: true, changed: [], missing: [], added: [] };
        if (message?.type === 'UPDATE_GITHUB_SKILL_SOURCE') return { ok: true, imported: [] };
        if (message?.type === 'DELETE_GITHUB_SKILL_SOURCE') return { ok: true };
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
    const statusCard = document.querySelector('.ds-command-status-card');
    const overflow = Math.max(root.scrollWidth, body.scrollWidth) > currentWidth + 1;
    const leakPattern = /\bGET_[A-Z0-9_]+\b|\bSAVE_[A-Z0-9_]+\b|\bSET_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|deepseek_pp_|Bearer|Cookie|data:image|\[object Object\]|sk-[A-Za-z0-9_-]{8,}/;
    return {
      overflow,
      leak: leakPattern.test(visibleText),
      visibleText,
      statusState: statusCard?.getAttribute('data-state') ?? '',
      ariaLive: statusCard?.getAttribute('aria-live') ?? '',
      badgeText: statusCard?.querySelector('[data-slot="badge"]')?.textContent?.trim() ?? '',
      badgeVariant: statusCard?.querySelector('[data-slot="badge"]')?.getAttribute('data-variant') ?? '',
      titleText: statusCard?.querySelector('[data-slot="card-title"]')?.textContent?.trim() ?? '',
      descriptionText: statusCard?.querySelector('[data-slot="card-description"]')?.textContent?.trim() ?? '',
      contentText: statusCard?.querySelector('[data-slot="card-content"]')?.textContent?.trim() ?? '',
      footerButtons: statusCard?.querySelectorAll('[data-slot="card-footer"] [data-slot="button"]').length ?? 0,
      retryButtons: Array.from(document.querySelectorAll('button')).filter((button) => button.textContent?.trim() === 'Retry').length,
      menuOpen: Boolean(document.querySelector('#ds-v2-menu-panel')),
      commandRows: document.querySelectorAll('.ds-command-row').length,
      overviewSlots: {
        searchField: document.querySelector('.ds-skill-search')?.getAttribute('data-slot') === 'field',
        searchInput: document.querySelector('.ds-skill-search [data-slot="input"]')?.getAttribute('data-slot') === 'input',
        filterGroup: document.querySelector('.ds-skill-filter-row')?.getAttribute('data-slot') === 'toggle-group',
        filterItems: document.querySelectorAll('.ds-skill-filter-row [data-slot="toggle-group-item"]').length,
        actionButtons: Array.from(document.querySelectorAll('.ds-skill-action-row [data-slot="button"].ds-skill-add-button')).map((button) => ({
          text: button.textContent?.trim() ?? '',
          variant: button.getAttribute('data-variant') ?? '',
          size: button.getAttribute('data-size') ?? '',
          hasIcon: Boolean(button.querySelector('[data-icon="inline-start"]')),
        })),
      },
      cardSlots: {
        card: statusCard?.getAttribute('data-slot') === 'card',
        header: Boolean(statusCard?.querySelector('[data-slot="card-header"]')),
        action: Boolean(statusCard?.querySelector('[data-slot="card-action"]')),
        content: Boolean(statusCard?.querySelector('[data-slot="card-content"]')),
      },
    };
  }, width);
}

async function checkNoGlobalFailures(page, consoleErrors, pageErrors, width, step) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(!diagnostics.overflow, `${step}: horizontal overflow at ${width}`);
  await assertDogfood(!diagnostics.leak, `${step}: visible leak pattern at ${width}`);
  await assertDogfood(consoleErrors.length === 0, `${step}: console errors at ${width}: ${consoleErrors.join(' | ')}`);
  await assertDogfood(pageErrors.length === 0, `${step}: page errors at ${width}: ${pageErrors.join(' | ')}`);
  return diagnostics;
}

async function assertOverviewControls(page, width, step) {
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.overviewSlots.searchField, `${step}: shadcn Field search wrapper missing at ${width}`);
  await assertDogfood(diagnostics.overviewSlots.searchInput, `${step}: shadcn Input search slot missing at ${width}`);
  await assertDogfood(diagnostics.overviewSlots.filterGroup, `${step}: shadcn ToggleGroup filter missing at ${width}`);
  await assertDogfood(diagnostics.overviewSlots.filterItems === 3, `${step}: expected three ToggleGroup filter items at ${width}`);
  await assertDogfood(diagnostics.overviewSlots.actionButtons.length === 3, `${step}: expected three shadcn overview action buttons at ${width}`);
  await assertDogfood(
    diagnostics.overviewSlots.actionButtons.map((button) => button.variant).join(',') === 'outline,outline,default',
    `${step}: overview button variants mismatch at ${width}`,
  );
  await assertDogfood(
    diagnostics.overviewSlots.actionButtons.every((button) => button.size === 'sm' && button.hasIcon),
    `${step}: overview button size/icon contract mismatch at ${width}`,
  );
}

async function assertCommandFormSlots(page, width, step) {
  const slots = await page.evaluate(() => {
    const form = document.querySelector('.ds-command-form');
    return {
      textInputs: form?.querySelectorAll('[data-slot="input"]').length ?? 0,
      textareas: form?.querySelectorAll('[data-slot="textarea"]').length ?? 0,
      fieldWrappers: form?.querySelectorAll('[data-slot="field"]').length ?? 0,
      actionButtons: Array.from(form?.querySelectorAll('.ds-command-form-actions [data-slot="button"]') ?? []).map((button) => ({
        text: button.textContent?.trim() ?? '',
        variant: button.getAttribute('data-variant') ?? '',
        size: button.getAttribute('data-size') ?? '',
      })),
    };
  });
  await assertDogfood(slots.textInputs >= 2, `${step}: command form shadcn inputs missing at ${width}`);
  await assertDogfood(slots.textareas === 1, `${step}: command form shadcn textarea missing at ${width}`);
  await assertDogfood(slots.fieldWrappers >= 3, `${step}: command form field wrappers missing at ${width}`);
  await assertDogfood(slots.actionButtons.length === 2, `${step}: command form action buttons missing at ${width}`);
  await assertDogfood(
    slots.actionButtons.map((button) => button.variant).join(',') === 'outline,default',
    `${step}: command form button variants mismatch at ${width}`,
  );
  await assertDogfood(
    slots.actionButtons.every((button) => button.size === 'sm'),
    `${step}: command form button sizes mismatch at ${width}`,
  );
}

async function assertImportEntrySlots(page, width, step, mode) {
  const slots = await page.evaluate(() => {
    const panel = document.querySelector('.ds-command-import-panel');
    return {
      fieldWrappers: panel?.querySelectorAll('.ds-command-import-field[data-slot="field"]').length ?? 0,
      inputs: panel?.querySelectorAll('.ds-command-import-field [data-slot="input"]').length ?? 0,
      buttons: Array.from(panel?.querySelectorAll('[data-slot="button"]') ?? []).map((button) => ({
        text: button.textContent?.trim() ?? '',
        variant: button.getAttribute('data-variant') ?? '',
        size: button.getAttribute('data-size') ?? '',
        hasIcon: Boolean(button.querySelector('[data-icon="inline-start"]')),
      })),
    };
  });
  const expectedButtons = mode === 'local' ? 3 : 2;
  await assertDogfood(slots.fieldWrappers === 1, `${step}: import shadcn field wrapper missing at ${width}`);
  await assertDogfood(slots.inputs === 1, `${step}: import shadcn input missing at ${width}`);
  await assertDogfood(slots.buttons.length === expectedButtons, `${step}: import button count mismatch at ${width}`);
  await assertDogfood(
    slots.buttons.every((button) => button.variant === 'outline' && button.size === 'sm'),
    `${step}: import button variant/size mismatch at ${width}`,
  );
  if (mode === 'local') {
    await assertDogfood(slots.buttons.some((button) => button.hasIcon), `${step}: local import Choose icon missing at ${width}`);
  }
}

async function assertImportPreviewSlots(page, width, step, mode) {
  const slots = await page.evaluate(() => {
    const panel = document.querySelector('.ds-command-import-panel');
    const warning = panel?.querySelector('.ds-command-status-message[role="status"][data-tone="warning"]') ?? null;
    return {
      rows: panel?.querySelectorAll('.ds-command-preview-row').length ?? 0,
      checkboxSlots: panel?.querySelectorAll('.ds-command-preview-row [data-slot="checkbox"][role="checkbox"]').length ?? 0,
      nativeCheckboxes: panel?.querySelectorAll('input[type="checkbox"]').length ?? 0,
      badgeVariants: Array.from(panel?.querySelectorAll('.ds-command-preview-row [data-slot="badge"]') ?? []).map((badge) => badge.getAttribute('data-variant') ?? ''),
      warningSlot: warning?.getAttribute('data-slot') ?? '',
      warningLive: warning?.getAttribute('aria-live') ?? '',
      warningText: warning?.querySelector('[data-slot="alert-description"]')?.textContent ?? '',
      selectedText: Array.from(panel?.querySelectorAll('.ds-command-selection-row span') ?? []).map((node) => node.textContent?.trim() ?? '').join(' '),
      importDisabled: (Array.from(panel?.querySelectorAll('[data-slot="button"]') ?? []).find((button) => button.textContent?.trim() === 'Import selected commands'))?.disabled === true,
    };
  });
  const expectedWarning = mode === 'local' ? 'Local folder warning' : 'Repository warning';
  await assertDogfood(slots.rows === 1, `${step}: import preview row missing at ${width}`);
  await assertDogfood(slots.checkboxSlots === 1, `${step}: import preview shadcn checkbox missing at ${width}`);
  await assertDogfood(slots.nativeCheckboxes === 0, `${step}: native checkbox leaked in import preview at ${width}`);
  await assertDogfood(slots.badgeVariants.join(',') === 'secondary,outline', `${step}: preview badge variants mismatch at ${width}`);
  await assertDogfood(slots.warningSlot === 'alert', `${step}: warning should use shadcn Alert at ${width}`);
  await assertDogfood(slots.warningLive === 'polite', `${step}: warning live region mismatch at ${width}`);
  await assertDogfood(slots.warningText.includes(expectedWarning), `${step}: warning copy mismatch at ${width}`);
  await assertDogfood(slots.selectedText.includes('Selected 1 / 1'), `${step}: selected summary mismatch at ${width}`);
  await assertDogfood(!slots.importDisabled, `${step}: import button should be enabled with selected command at ${width}`);
}

async function assertImportSuccessSlots(page, width, step, expectedText) {
  const slots = await page.evaluate((text) => {
    const panel = document.querySelector('.ds-command-import-panel');
    const success = Array.from(panel?.querySelectorAll('.ds-command-status-message[role="status"]') ?? [])
      .find((node) => node.textContent?.includes(text)) ?? null;
    return {
      slot: success?.getAttribute('data-slot') ?? '',
      tone: success?.getAttribute('data-tone') ?? '',
      live: success?.getAttribute('aria-live') ?? '',
      text: success?.querySelector('[data-slot="alert-description"]')?.textContent ?? '',
      importDisabled: (Array.from(panel?.querySelectorAll('[data-slot="button"]') ?? []).find((button) => button.textContent?.trim() === 'Import selected commands'))?.disabled === true,
    };
  }, expectedText);
  await assertDogfood(slots.slot === 'alert', `${step}: success should use shadcn Alert at ${width}`);
  await assertDogfood(slots.tone === 'neutral', `${step}: success tone mismatch at ${width}`);
  await assertDogfood(slots.live === 'polite', `${step}: success live region mismatch at ${width}`);
  await assertDogfood(slots.text.includes(expectedText), `${step}: success message mismatch at ${width}`);
  await assertDogfood(slots.text.includes('1 commands were renamed automatically'), `${step}: renamed notice missing at ${width}`);
  await assertDogfood(slots.importDisabled, `${step}: import button should disable after success at ${width}`);
}

async function exerciseGitHubImportPreview(page, width) {
  await page.locator('#github-skill-import-url').fill('https://github.com/acme/commands');
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Repository warning') && document.body.innerText.includes('/research'), null, { timeout: 10000 });
  await assertImportPreviewSlots(page, width, 'GitHub import preview', 'github');
  await page.locator('.ds-command-preview-row').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.screenshot({ path: join(outDir, `commands-github-preview-${width}.png`), fullPage: true });

  const checkbox = page.locator('.ds-command-preview-row [data-slot="checkbox"][role="checkbox"]').first();
  await checkbox.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.body.innerText.includes('Selected 0 / 1'), null, { timeout: 10000 });
  await assertDogfood(await page.getByRole('button', { name: 'Import selected commands' }).isDisabled(), `GitHub import should disable after Space deselect at ${width}`);
  await page.locator('.ds-command-preview-row label').first().click();
  await page.waitForFunction(() => document.body.innerText.includes('Selected 1 / 1'), null, { timeout: 10000 });
  await page.getByRole('button', { name: 'Import selected commands' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Imported 1 commands'), null, { timeout: 10000 });
  await assertImportSuccessSlots(page, width, 'GitHub import success', 'Imported 1 commands');
  const dogfoodState = await page.evaluate(() => window.__DEEPSEEKPP_COMMANDS_STATUS_DOGFOOD_STATE__);
  await assertDogfood(dogfoodState.githubPreviewPayloads.at(-1)?.url === 'https://github.com/acme/commands', `GitHub preview payload mismatch at ${width}`);
  await assertDogfood(dogfoodState.githubImportPayloads.length === 1, `GitHub import payload count mismatch at ${width}`);
  await assertDogfood(dogfoodState.githubImportPayloads[0]?.selectedPaths?.join(',') === 'research/SKILL.md', `GitHub import selected path mismatch at ${width}`);
  await page.screenshot({ path: join(outDir, `commands-github-import-success-${width}.png`), fullPage: true });
}

async function exerciseLocalImportPreview(page, width) {
  await page.locator('#local-skill-import-path').fill('/Users/me/.codex/skills/research');
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Local folder warning') && document.body.innerText.includes('/research'), null, { timeout: 10000 });
  await assertImportPreviewSlots(page, width, 'local import preview', 'local');
  await page.locator('.ds-command-preview-row').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.screenshot({ path: join(outDir, `commands-local-preview-${width}.png`), fullPage: true });

  const checkbox = page.locator('.ds-command-preview-row [data-slot="checkbox"][role="checkbox"]').first();
  await checkbox.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.body.innerText.includes('Selected 0 / 1'), null, { timeout: 10000 });
  await assertDogfood(await page.getByRole('button', { name: 'Import selected commands' }).isDisabled(), `local import should disable after Space deselect at ${width}`);
  await page.locator('.ds-command-preview-row label').first().click();
  await page.waitForFunction(() => document.body.innerText.includes('Selected 1 / 1'), null, { timeout: 10000 });
  await page.getByRole('button', { name: 'Import selected commands' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Imported 1 local commands'), null, { timeout: 10000 });
  await assertImportSuccessSlots(page, width, 'local import success', 'Imported 1 local commands');
  const dogfoodState = await page.evaluate(() => window.__DEEPSEEKPP_COMMANDS_STATUS_DOGFOOD_STATE__);
  await assertDogfood(dogfoodState.localPreviewPayloads.at(-1)?.rootPath === '/Users/me/.codex/skills/research', `local preview payload mismatch at ${width}`);
  await assertDogfood(dogfoodState.localImportPayloads.length === 1, `local import payload count mismatch at ${width}`);
  await assertDogfood(dogfoodState.localImportPayloads[0]?.selectedPaths?.join(',') === 'SKILL.md', `local import selected path mismatch at ${width}`);
  await page.screenshot({ path: join(outDir, `commands-local-import-success-${width}.png`), fullPage: true });
}

async function assertCommandRowControlSlots(page, width, step) {
  const slots = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.ds-command-row.ds-skill-card'));
    const customRow = rows.find((row) => row.textContent?.includes('/risk-review')) ?? null;
    const rowButtons = Array.from(customRow?.querySelectorAll('.ds-skill-card-actions [data-slot="button"]') ?? []).map((button) => ({
      text: button.textContent?.trim() ?? '',
      variant: button.getAttribute('data-variant') ?? '',
      size: button.getAttribute('data-size') ?? '',
      ariaLabel: button.getAttribute('aria-label') ?? '',
    }));
    const groupToggles = Array.from(document.querySelectorAll('.ds-command-group-toggle')).map((button) => ({
      slot: button.getAttribute('data-slot') ?? '',
      variant: button.getAttribute('data-variant') ?? '',
      size: button.getAttribute('data-size') ?? '',
      hasIcon: Boolean(button.querySelector('[data-icon="inline-start"]')),
    }));
    const groupActions = Array.from(document.querySelectorAll('.ds-command-group-action')).map((button) => ({
      slot: button.getAttribute('data-slot') ?? '',
      variant: button.getAttribute('data-variant') ?? '',
      size: button.getAttribute('data-size') ?? '',
      action: button.getAttribute('data-action') ?? '',
    }));
    return {
      commandRows: rows.length,
      customRowFound: Boolean(customRow),
      badgeCount: customRow?.querySelectorAll('[data-slot="badge"]').length ?? 0,
      rowButtons,
      descriptionToggle: {
        slot: customRow?.querySelector('.ds-skill-description-toggle')?.getAttribute('data-slot') ?? '',
        variant: customRow?.querySelector('.ds-skill-description-toggle')?.getAttribute('data-variant') ?? '',
      },
      groupToggles,
      groupActions,
      rawGroupSvgCount: document.querySelectorAll('.ds-command-group-toggle svg:not([data-icon])').length,
    };
  });
  await assertDogfood(slots.commandRows >= 1, `${step}: command rows missing at ${width}`);
  await assertDogfood(slots.customRowFound, `${step}: custom command row missing at ${width}`);
  await assertDogfood(slots.badgeCount === 1, `${step}: command row status badge slot missing at ${width}`);
  await assertDogfood(slots.rowButtons.length === 3, `${step}: command row action buttons missing at ${width}`);
  await assertDogfood(
    slots.rowButtons.map((button) => button.variant).join(',') === 'outline,outline,destructive',
    `${step}: command row button variants mismatch at ${width}`,
  );
  await assertDogfood(slots.rowButtons.every((button) => button.size === 'sm'), `${step}: command row button sizes mismatch at ${width}`);
  await assertDogfood(slots.descriptionToggle.slot === 'button' && slots.descriptionToggle.variant === 'link', `${step}: description disclosure is not shadcn Button at ${width}`);
  await assertDogfood(slots.groupToggles.length >= 2, `${step}: group toggles missing at ${width}`);
  await assertDogfood(slots.groupToggles.every((button) => button.slot === 'button' && button.variant === 'ghost' && button.size === 'sm' && button.hasIcon), `${step}: group toggle shadcn/lucide contract mismatch at ${width}`);
  await assertDogfood(slots.groupActions.length >= 2, `${step}: group action buttons missing at ${width}`);
  await assertDogfood(slots.groupActions.every((button) => button.slot === 'button' && button.size === 'sm'), `${step}: group action shadcn size mismatch at ${width}`);
  await assertDogfood(slots.rawGroupSvgCount === 0, `${step}: raw group SVG chevron leaked at ${width}`);
}

async function assertSourceActionSlots(page, width, step) {
  const slots = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.ds-source-actions [data-slot="button"]')).map((button) => ({
      text: button.textContent?.trim() ?? '',
      variant: button.getAttribute('data-variant') ?? '',
      size: button.getAttribute('data-size') ?? '',
      ariaLabel: button.getAttribute('aria-label') ?? '',
    }));
    return {
      buttons,
      hasMeta: Boolean(document.querySelector('.ds-source-meta-line')),
    };
  });
  await assertDogfood(slots.hasMeta, `${step}: source metadata missing at ${width}`);
  await assertDogfood(slots.buttons.length === 3, `${step}: source action buttons missing at ${width}`);
  await assertDogfood(
    slots.buttons.map((button) => button.text).join(',') === 'Check,Sync,Remove',
    `${step}: source action labels mismatch at ${width}`,
  );
  await assertDogfood(
    slots.buttons.map((button) => button.variant).join(',') === 'outline,outline,destructive',
    `${step}: source action variants mismatch at ${width}`,
  );
  await assertDogfood(slots.buttons.every((button) => button.size === 'sm'), `${step}: source action sizes mismatch at ${width}`);
}

async function exerciseCommandRowControls(page, width) {
  await assertCommandRowControlSlots(page, width, 'ready command row controls');
  const riskRow = page.locator('.ds-command-row.ds-skill-card').filter({ hasText: '/risk-review' });
  await riskRow.locator('.ds-skill-description-toggle').click();
  await page.waitForFunction(() => document.body.innerText.includes('Hide details'), null, { timeout: 10000 });
  await riskRow.locator('.ds-skill-description-toggle').click();
  await page.waitForFunction(() => document.body.innerText.includes('Details'), null, { timeout: 10000 });
  await page.locator('button[aria-label="Disable risk-review"]').click();
  await page.waitForFunction(() => document.body.innerText.includes('/risk-review') && document.body.innerText.includes('Turn on'), null, { timeout: 10000 });
  let dogfoodState = await page.evaluate(() => window.__DEEPSEEKPP_COMMANDS_STATUS_DOGFOOD_STATE__);
  await assertDogfood(dogfoodState.setSkillEnabledPayloads.at(-1)?.name === 'risk-review', `row toggle payload name mismatch after disable at ${width}`);
  await assertDogfood(dogfoodState.setSkillEnabledPayloads.at(-1)?.enabled === false, `row toggle payload enabled mismatch after disable at ${width}`);
  await page.locator('button[aria-label="Enable risk-review"]').click();
  await page.waitForFunction(() => document.body.innerText.includes('/risk-review') && document.body.innerText.includes('Turn off'), null, { timeout: 10000 });
  dogfoodState = await page.evaluate(() => window.__DEEPSEEKPP_COMMANDS_STATUS_DOGFOOD_STATE__);
  await assertDogfood(dogfoodState.setSkillEnabledPayloads.at(-1)?.enabled === true, `row toggle payload enabled mismatch after re-enable at ${width}`);
  await page.locator('button[aria-label="Edit risk-review"]').click();
  await page.waitForSelector('.ds-command-form', { timeout: 10000 });
  await assertCommandFormSlots(page, width, 'row edit form controls');
  await page.screenshot({ path: join(outDir, `commands-row-edit-form-${width}.png`), fullPage: true });
  await page.locator('.ds-command-form').getByRole('button', { name: 'Cancel' }).click();
  await page.waitForFunction(() => !document.querySelector('.ds-command-form'), null, { timeout: 10000 });
}

async function exerciseSourceControls(page, width) {
  await assertSourceActionSlots(page, width, 'expanded source controls');
  await page.locator('button[aria-label="Check acme/commands"]').click();
  await page.waitForFunction(() => document.body.innerText.includes('No upstream updates found'), null, { timeout: 10000 });
  await page.locator('button[aria-label="Sync acme/commands"]').click();
  await page.waitForFunction(() => document.body.innerText.includes('Synced 0 commands'), null, { timeout: 10000 });
  await page.locator('button[aria-label="Remove acme/commands"]').click();
  await page.waitForSelector('.ds-modal-card [data-slot="alert-dialog-title"]', { timeout: 10000 });
  await assertDogfood(await page.locator('.ds-modal-title').textContent() === 'Remove import from acme/commands?', `remove source dialog title mismatch at ${width}`);
  await page.locator('.ds-modal-actions [data-slot="alert-dialog-cancel"]').click();
  await page.waitForFunction(() => !document.querySelector('.ds-modal-card'), null, { timeout: 10000 });
}

async function waitForVisibleOpacity(page, selector) {
  await page.waitForFunction((targetSelector) => {
    const node = document.querySelector(targetSelector);
    if (!node) return false;
    const style = window.getComputedStyle(node);
    return Number.parseFloat(style.opacity || '0') >= 0.99;
  }, selector, { timeout: 10000 });
  await page.waitForTimeout(150);
}

async function openCommandsThroughMenu(page, width, step) {
  await page.locator('button[aria-label="Open navigation menu"]').click();
  await page.waitForSelector('#ds-v2-menu-panel [data-slot="command-input"]', { timeout: 10000 });
  await waitForVisibleOpacity(page, '#ds-v2-menu-panel');
  await page.locator('#ds-v2-menu-panel [data-slot="command-input"]').fill('Commands');
  await page.screenshot({ path: join(outDir, `${step}-menu-${width}.png`), fullPage: true });
  await page.locator('#ds-v2-menu-panel [data-slot="command-item"]').filter({ hasText: 'Commands' }).first().click();
  await page.waitForSelector('.ds-command-status-card', { timeout: 10000 });
  await page.waitForFunction(() => document.body.innerText.includes('Slash commands available in chat'), null, { timeout: 10000 });
}

async function openDogfoodPage(browser, url, width, stubOptions) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(installChromeStub, stubOptions);
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

async function assertReadyStatus(page, width, step) {
  await page.waitForFunction(() => document.querySelector('.ds-command-status-card')?.getAttribute('data-state') === 'ready', null, { timeout: 10000 });
  const diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.statusState === 'ready', `${step}: ready state mismatch at ${width}`);
  await assertDogfood(diagnostics.ariaLive === 'polite', `${step}: aria-live mismatch at ${width}`);
  await assertDogfood(diagnostics.badgeText === 'Ready', `${step}: badge text mismatch at ${width}: ${diagnostics.badgeText}`);
  await assertDogfood(diagnostics.badgeVariant === 'secondary', `${step}: badge variant mismatch at ${width}: ${diagnostics.badgeVariant}`);
  await assertDogfood(diagnostics.titleText === 'Command status', `${step}: title mismatch at ${width}`);
  await assertDogfood(diagnostics.descriptionText === 'Enabled commands are available from Ask.', `${step}: description mismatch at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('2/3 on'), `${step}: command count missing at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('1 sources'), `${step}: source count missing at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('Type / in Ask to insert an enabled command.'), `${step}: next action missing at ${width}`);
  await assertDogfood(diagnostics.footerButtons === 0, `${step}: ready card should not show footer action at ${width}`);
  await assertDogfood(Object.values(diagnostics.cardSlots).every(Boolean), `${step}: shadcn card slots missing at ${width}`);
  return diagnostics;
}

async function runReadyFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    skills: [builtinSummarize, customReviewer, remoteResearch],
    sources: [githubSource],
    githubImportPreview,
    githubImportResult,
    localImportPreview,
    localImportResult,
  });
  await openCommandsThroughMenu(page, width, 'ready');
  await assertReadyStatus(page, width, 'ready');
  await assertOverviewControls(page, width, 'ready overview controls');
  await exerciseCommandRowControls(page, width);
  await page.screenshot({ path: join(outDir, `commands-row-controls-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'row controls');
  await page.getByRole('button', { name: 'Import commands from GitHub' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('GitHub URL'), null, { timeout: 10000 });
  await assertImportEntrySlots(page, width, 'overview GitHub import controls', 'github');
  await page.screenshot({ path: join(outDir, `commands-overview-github-import-${width}.png`), fullPage: true });
  await exerciseGitHubImportPreview(page, width);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'overview GitHub import');
  await page.getByRole('button', { name: 'Import local commands' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Folder path'), null, { timeout: 10000 });
  await assertImportEntrySlots(page, width, 'overview local import controls', 'local');
  await page.screenshot({ path: join(outDir, `commands-overview-local-import-${width}.png`), fullPage: true });
  await exerciseLocalImportPreview(page, width);
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'overview local import');
  await page.getByRole('button', { name: 'New custom command' }).click();
  await page.waitForSelector('.ds-command-form', { timeout: 10000 });
  await assertCommandFormSlots(page, width, 'overview new form controls');
  await page.screenshot({ path: join(outDir, `commands-overview-new-form-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'overview new form');
  await page.locator('.ds-command-form').getByRole('button', { name: 'Cancel' }).click();
  await page.waitForFunction(() => !document.querySelector('.ds-command-form'), null, { timeout: 10000 });
  await page.locator('.ds-skill-search [data-slot="input"]').fill('risk');
  await page.waitForFunction(() => document.body.innerText.includes('/risk-review') && !document.body.innerText.includes('/summarize'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `commands-overview-search-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'overview search');
  await page.locator('.ds-skill-search [data-slot="input"]').fill('');
  await page.waitForFunction(() => document.querySelector('.ds-skill-search input')?.value === '', null, { timeout: 10000 });
  await page.waitForSelector('button[aria-label="Expand acme/commands"]', { timeout: 10000 });
  await page.locator('button[aria-label="Expand acme/commands"]').click();
  await page.waitForFunction(() => document.body.innerText.includes('/research'), null, { timeout: 10000 });
  await exerciseSourceControls(page, width);
  await page.screenshot({ path: join(outDir, `commands-source-controls-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'source controls');
  await page.locator('.ds-skill-filter-row button').filter({ hasText: 'Off' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('/research') && !document.body.innerText.includes('/summarize'), null, { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `commands-ready-off-filter-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'ready off filter');

  await page.locator('button[aria-label="Open navigation menu"]').click();
  await page.waitForSelector('#ds-v2-menu-panel', { timeout: 10000 });
  await waitForVisibleOpacity(page, '#ds-v2-menu-panel');
  let diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.menuOpen, `menu did not open from Commands at ${width}`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#ds-v2-menu-panel'), null, { timeout: 10000 });
  diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(!diagnostics.menuOpen, `menu did not close on Escape at ${width}`);
  await page.screenshot({ path: join(outDir, `commands-menu-escape-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'menu escape');
  await context.close();
}

async function runEmptyCreateFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    skills: [],
    sources: [],
  });
  await openCommandsThroughMenu(page, width, 'empty');
  await page.waitForFunction(() => document.querySelector('.ds-command-status-card')?.getAttribute('data-state') === 'empty', null, { timeout: 10000 });
  let diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.badgeText === 'No commands', `empty badge mismatch at ${width}: ${diagnostics.badgeText}`);
  await assertDogfood(diagnostics.badgeVariant === 'outline', `empty badge variant mismatch at ${width}: ${diagnostics.badgeVariant}`);
  await assertDogfood(diagnostics.contentText.includes('0/0 on'), `empty command count missing at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('No imported sources'), `empty source state missing at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('Create or import a command, then type / in Ask.'), `empty next missing at ${width}`);
  await assertDogfood(diagnostics.footerButtons === 1, `empty card should show one footer New action at ${width}`);
  await page.screenshot({ path: join(outDir, `commands-empty-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'empty');

  await page.locator('.ds-command-status-card [data-slot="card-footer"] [data-slot="button"]').click();
  await page.waitForSelector('.ds-command-form', { timeout: 10000 });
  await assertCommandFormSlots(page, width, 'empty create form controls');
  await page.locator('input[placeholder="Name, e.g. research-note"]').fill(`status-command-${width}`);
  await page.locator('input[placeholder="What this command should help with"]').fill(`Verify Commands status at ${width}px.`);
  await page.locator('.ds-command-form [data-slot="textarea"]').fill(`Use the Commands status card evidence at ${width}px.`);
  await page.screenshot({ path: join(outDir, `commands-create-form-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'create form');

  await page.locator('.ds-command-form').getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction((target) => document.body.innerText.includes(`/${target}`), `status-command-${width}`, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.ds-command-status-card')?.getAttribute('data-state') === 'ready', null, { timeout: 10000 });
  diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.contentText.includes('1/1 on'), `created command count missing at ${width}`);
  await page.screenshot({ path: join(outDir, `commands-created-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'created command');

  const dogfoodState = await page.evaluate(() => window.__DEEPSEEKPP_COMMANDS_STATUS_DOGFOOD_STATE__);
  await assertDogfood(dogfoodState.saveSkillPayloads.length === 1, `SAVE_SKILL payload count mismatch at ${width}`);
  await assertDogfood(dogfoodState.saveSkillPayloads[0].name === `status-command-${width}`, `command save name mismatch at ${width}`);
  await assertDogfood(dogfoodState.saveSkillPayloads[0].description === `Verify Commands status at ${width}px.`, `command save description mismatch at ${width}`);
  await context.close();
}

async function runLibraryLoadFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    skills: [customReviewer],
    sources: [],
    failLibraryLoadOnce: true,
  });
  await openCommandsThroughMenu(page, width, 'library-failure');
  await page.waitForFunction(() => document.querySelector('.ds-command-status-card')?.getAttribute('data-state') === 'attention', null, { timeout: 10000 });
  let diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.badgeText === 'Needs refresh', `library failure badge mismatch at ${width}`);
  await assertDogfood(diagnostics.badgeVariant === 'destructive', `library failure badge variant mismatch at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('Unavailable'), `library failure unavailable state missing at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('Retry command library before assuming it is empty.'), `library failure next missing at ${width}`);
  await assertDogfood(diagnostics.retryButtons === 1, `library failure should show one Retry at ${width}`);
  await page.screenshot({ path: join(outDir, `commands-library-failure-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'library failure');

  await page.locator('.ds-command-status-card [data-slot="button"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('/risk-review'), null, { timeout: 10000 });
  diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.statusState === 'ready', `library recovery state mismatch at ${width}`);
  await assertDogfood(diagnostics.retryButtons === 0, `library recovery should remove Retry at ${width}`);
  await page.screenshot({ path: join(outDir, `commands-library-recovered-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'library recovered');
  await context.close();
}

async function runSourceLoadFailureFlow(browser, url, width) {
  const { context, page, consoleErrors, pageErrors } = await openDogfoodPage(browser, url, width, {
    skills: [{ ...remoteResearch, enabled: true }],
    sources: [githubSource],
    failSourceLoadOnce: true,
  });
  await openCommandsThroughMenu(page, width, 'source-failure');
  await page.waitForFunction(() => document.querySelector('.ds-command-status-card')?.getAttribute('data-state') === 'attention', null, { timeout: 10000 });
  let diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.contentText.includes('1/1 on'), `source failure should keep command count at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('Needs refresh'), `source failure refresh state missing at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('Retry imported sources before managing them.'), `source failure next missing at ${width}`);
  await assertDogfood(diagnostics.visibleText.includes('/research'), `source failure should keep command row visible at ${width}`);
  await assertDogfood(diagnostics.retryButtons === 1, `source failure should show one Retry at ${width}`);
  await page.screenshot({ path: join(outDir, `commands-source-failure-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'source failure');

  await page.locator('.ds-command-status-card [data-slot="button"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('Check'), null, { timeout: 10000 });
  diagnostics = await pageDiagnostics(page, width);
  await assertDogfood(diagnostics.statusState === 'ready', `source recovery state mismatch at ${width}`);
  await assertDogfood(diagnostics.contentText.includes('1 sources'), `source recovery source count missing at ${width}`);
  await page.screenshot({ path: join(outDir, `commands-source-recovered-${width}.png`), fullPage: true });
  await checkNoGlobalFailures(page, consoleErrors, pageErrors, width, 'source recovered');
  await context.close();
}

await mkdir(outDir, { recursive: true });
const port = await listen();
const url = `http://127.0.0.1:${port}/sidepanel.html`;
const browser = await chromium.launch({ headless: true });

try {
  for (const width of [420, 360]) {
    await runReadyFlow(browser, url, width);
    await runEmptyCreateFlow(browser, url, width);
    await runLibraryLoadFailureFlow(browser, url, width);
    await runSourceLoadFailureFlow(browser, url, width);
  }
  const summary = {
    url,
    screenshots: outDir,
    widths: [420, 360],
    checks: [
      'production sidepanel loaded with Chrome runtime/storage stub',
      'real command menu navigation opened Commands and Escape closed the menu',
      'Commands status Card/Header/Title/Description/Action/Content/Footer slots verified',
      'Commands overview search Field/Input, filter ToggleGroup, and action Button slots verified',
      'Commands form Textarea/Button slots and import entry Field/Input/Button slots verified',
      'Commands row Badge/Button slots, group Button/lucide controls, and source action Button slots verified',
      'overview GitHub import, local import, New form, and search typing exercised',
      'GitHub/local import previews exercised warning Alert slots, preview Badge slots, keyboard and row checkbox toggles, selected-path import payloads, success Alert slots, renamed notices, and duplicate-import disabled states',
      'command row Turn off/Turn on and Edit/Cancel controls exercised',
      'imported source Check, Sync, and Remove/Cancel confirmation exercised',
      'Commands status Badge variants verified for ready, empty, and failure states',
      'ready flow expanded an imported source group and used the Off filter',
      'status-card New action opened the real command form',
      'form typed and submitted through visible Save action',
      'SAVE_SKILL payload matched typed values',
      'library-load failure showed one status-card Retry with sanitized visible text',
      'source-load failure preserved visible commands and recovered through keyboard Enter on Retry',
      'no horizontal overflow at 420px or 360px',
      'no console/page errors',
      'visible leak pattern scan passed',
    ],
  };
  await writeFile(join(outDir, 'dogfood-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(outDir, 'audit-notes.md'), [
    '# Commands Status Card Dogfood',
    '',
    'Evidence source: production bundle `dist/chrome-mv3/sidepanel.html` served locally with a contract-shaped Chrome runtime/storage stub.',
    '',
    '1. Ready Commands through Menu - healthy. The command menu opened Commands, the status card showed Ready, overview search/filter/action controls used shadcn slots, row Badge/Button slots were verified, row Turn off/Turn on and Edit/Cancel worked, GitHub/local/New overview actions opened real panels/forms, import entry Field/Input/Button slots were verified, GitHub/local previews rendered shadcn Alert warning and Badge chips, Space and row label toggled preview selection, selected-path import payloads were recorded, success Alert messages showed renamed notices and disabled duplicate import, command form Textarea/Button slots were verified, search typing filtered rows, the imported source group expanded, source Check/Sync/Remove-Cancel worked, the Off filter isolated the disabled command, and Escape closed the menu.',
    '2. Empty and create - healthy. The status card showed No commands, its footer New action opened the real shadcn-backed command form, typed values saved through Save, and the created command appeared as an enabled row.',
    '3. Command library failure - healthy. A raw failing source rendered sanitized unavailable copy, a single Retry action, and recovered by keyboard Enter.',
    '4. Command source failure - healthy. Existing command rows stayed visible while sources needed refresh, Retry recovered source controls, and no false empty state appeared.',
    '',
    'Checked: 420px and 360px, command menu, Commands status card slots, overview control slots, command row slots/actions, group toggle/action slots, command form slots, import entry slots, GitHub/local preview warning/status/result slots, preview badges, keyboard and row-click preview selection, import payloads, duplicate-import disabled states, source action slots/actions, GitHub/local/New overview actions, search typing, imported source group toggle, Off filter, card New action, form typing/save, load failure, source failure, keyboard retry, DOM overflow, console/page errors, and visible leak patterns.',
    '',
  ].join('\n'));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
