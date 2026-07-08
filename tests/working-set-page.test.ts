import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from '../core/i18n';
import { LOCALE_PREFERENCE_STORAGE_KEY } from '../core/i18n/store';
import {
  appendAutonomousEvidenceRecord,
  createAutonomousRun,
  transitionAutonomousRun,
  upsertAutonomousTargetLease,
} from '../core/run/store';
import type { RuntimeCockpitWorkingSet } from '../core/cockpit';
import { I18nProvider } from '../entrypoints/sidepanel/i18n';
import type { SidepanelNavigationTarget } from '../entrypoints/sidepanel/navigation';
import WorkingSetPage, { createWorkingSetStatus } from '../entrypoints/sidepanel/pages/WorkingSetPage';

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
});

describe('WorkingSetPage', () => {
  it('summarizes missing evidence and routes to Ask', async () => {
    stubEnglishChrome();
    const onNavigate = vi.fn();
    vi.stubGlobal('crypto', { randomUUID: () => 'working-set-page-run' });
    const now = Date.now();

    const run = await createAutonomousRun({ goal: 'Check live context readiness' }, now - 20_000);
    await transitionAutonomousRun(run.id, 'running', null, now - 10_000);
    await upsertAutonomousTargetLease({
      runId: run.id,
      tabId: 42,
      windowId: 7,
      origin: 'https://chat.deepseek.com',
      title: 'DeepSeek chat',
      ttlMs: 120_000,
    }, now);

    await renderWorkingSetPage(onNavigate);

    const statusPanel = container.querySelector('.ds-cockpit-working-set-status');
    expect(statusPanel).toBeTruthy();
    expect(statusPanel?.getAttribute('data-workbench-panel')).toBe('true');
    expect(statusPanel?.children[0]?.getAttribute('data-slot')).toBe('card');
    expect(statusPanel?.textContent).toContain('Context status');
    expect(statusPanel?.textContent).toContain('Needs evidence');
    expect(statusPanel?.textContent).toContain('Ask with browser context before relying on this mission state.');
    expect(statusPanel?.textContent).toContain('Target');
    expect(statusPanel?.textContent).toContain('Locked');
    expect(statusPanel?.textContent).toContain('Evidence');
    expect(statusPanel?.textContent).toContain('No evidence');
    expect(statusPanel?.textContent).toContain('Open Ask');
    expect(statusPanel?.querySelector('[data-slot="badge"]')?.textContent).toContain('Needs evidence');
    expect(statusPanel?.querySelector('[data-slot="button"]')?.textContent).toBe('Open Ask');
    expect(container.textContent).toContain('Target state');
    expect(container.textContent).not.toContain('DeepSeek chat');

    await clickButton('Open Ask');
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'chat' });
  });

  it('shows sanitized recent evidence details without raw evidence payloads', async () => {
    stubEnglishChrome();
    const onNavigate = vi.fn();
    let uuidCounter = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `working-set-evidence-${uuidCounter += 1}` });
    const now = Date.now();

    const run = await createAutonomousRun({ goal: 'Check evidence detail trust' }, now - 30_000);
    await transitionAutonomousRun(run.id, 'running', null, now - 25_000);
    const lease = await upsertAutonomousTargetLease({
      runId: run.id,
      tabId: 42,
      windowId: 7,
      origin: 'https://secret.example.com',
      title: 'Secret Browser Title',
      ttlMs: 120_000,
    }, now - 20_000);
    await appendAutonomousEvidenceRecord(run.id, {
      id: 'evidence-secret-ui-id',
      leaseId: lease?.id ?? null,
      kind: 'browser_snapshot',
      capturedAt: now - 5_000,
      ttlMs: 120_000,
      summary: 'raw evidence summary that should stay internal',
      refs: ['secret-ref'],
      source: { tabId: 42, toolName: 'secret-tool' },
      metadata: { hidden: 'secret metadata' },
    }, now - 5_000);

    await renderWorkingSetPage(onNavigate);

    expect(container.textContent).toContain('Recent evidence');
    expect(container.textContent).toContain('Browser snapshot');
    expect(container.textContent).toContain('Fresh');
    expect(container.querySelector('.ds-cockpit-evidence-fresh[data-slot="badge"]')?.textContent).toContain('Fresh');
    expect(container.textContent).toContain('Captured');
    expect(container.textContent).toContain('Valid for');
    expect(container.textContent).not.toContain('evidence-secret-ui-id');
    expect(container.textContent).not.toContain('raw evidence summary that should stay internal');
    expect(container.textContent).not.toContain('secret-ref');
    expect(container.textContent).not.toContain('secret-tool');
    expect(container.textContent).not.toContain('secret metadata');
    expect(container.textContent).not.toContain('https://secret.example.com');
    expect(container.textContent).not.toContain('Secret Browser Title');
  });

  it('marks context ready only when target is active and evidence is fresh', () => {
    const status = createWorkingSetStatus(createWorkingSet({
      target: { status: 'active', locked: true, stale: false },
      evidence: { posture: 'fresh', total: 1, fresh: 1 },
    }), createTranslator('en').t);

    expect(status).toMatchObject({
      statusKey: 'sidepanel.cockpit.workingSetStatusReady',
      descriptionKey: 'sidepanel.cockpit.workingSetStatusReadyDescription',
      nextKey: 'sidepanel.cockpit.workingSetNextContinue',
      tone: 'normal',
      target: 'Locked',
      targetTone: 'normal',
      evidence: 'Fresh',
      evidenceTone: 'normal',
      action: null,
    });
  });

  it('routes missing or stale targets to Browser setup', () => {
    const missing = createWorkingSetStatus(createWorkingSet({
      target: { status: 'none', locked: false, stale: false },
      evidence: { posture: 'none', total: 0, fresh: 0 },
    }), createTranslator('en').t);
    const stale = createWorkingSetStatus(createWorkingSet({
      target: { status: 'stale', locked: false, stale: true },
      evidence: { posture: 'fresh', total: 1, fresh: 1 },
    }), createTranslator('en').t);

    expect(missing).toMatchObject({
      statusKey: 'sidepanel.cockpit.workingSetStatusNoTarget',
      nextKey: 'sidepanel.cockpit.workingSetNextSelectTarget',
      action: 'browser',
    });
    expect(stale).toMatchObject({
      statusKey: 'sidepanel.cockpit.workingSetStatusRefreshTarget',
      nextKey: 'sidepanel.cockpit.workingSetNextRefreshTarget',
      action: 'browser',
    });
  });

  it('routes stale, expired, or mixed evidence to Ask without claiming readiness', () => {
    for (const posture of ['stale', 'expired', 'mixed'] as const) {
      const status = createWorkingSetStatus(createWorkingSet({
        target: { status: 'active', locked: true, stale: false },
        evidence: { posture, total: 2, fresh: posture === 'mixed' ? 1 : 0 },
      }), createTranslator('en').t);

      expect(status).toMatchObject({
        statusKey: 'sidepanel.cockpit.workingSetStatusRefreshEvidence',
        nextKey: 'sidepanel.cockpit.workingSetNextRefreshEvidence',
        tone: 'attention',
        evidenceTone: 'attention',
        action: 'ask',
      });
    }
  });
});

async function renderWorkingSetPage(onNavigate?: (target: SidepanelNavigationTarget) => void) {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(I18nProvider, null, React.createElement(WorkingSetPage, { onNavigate })));
    await flush();
  });
  await flushAct();
}

async function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
  });
}

async function flushAct() {
  await act(async () => {
    await flush();
  });
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function stubEnglishChrome() {
  const storage = new Map<string, unknown>([[LOCALE_PREFERENCE_STORAGE_KEY, 'en']]);
  const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void>();
  vi.stubGlobal('chrome', {
    i18n: {
      getUILanguage: vi.fn(() => 'en'),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string | string[] | Record<string, unknown> | null) => {
          const keys = resolveStorageKeys(key);
          const result: Record<string, unknown> = {};
          for (const storageKey of keys) {
            if (storage.has(storageKey)) result[storageKey] = storage.get(storageKey);
          }
          return result;
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          const changes: Record<string, chrome.storage.StorageChange> = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: storage.get(key), newValue: value };
            storage.set(key, value);
          }
          for (const listener of listeners) listener(changes, 'local');
        }),
        remove: vi.fn(async (key: string) => {
          const oldValue = storage.get(key);
          storage.delete(key);
          for (const listener of listeners) listener({ [key]: { oldValue, newValue: undefined } }, 'local');
        }),
      },
      onChanged: {
        addListener: vi.fn((listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) => {
          listeners.add(listener);
        }),
        removeListener: vi.fn((listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) => {
          listeners.delete(listener);
        }),
      },
    },
    runtime: {
      getManifest: vi.fn(() => ({})),
      sendMessage: vi.fn(async () => null),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
}

function resolveStorageKeys(key: string | string[] | Record<string, unknown> | null): string[] {
  if (key === null) return [];
  if (typeof key === 'string') return [key];
  if (Array.isArray(key)) return key;
  return Object.keys(key);
}

function createWorkingSet(patch: {
  target: Partial<RuntimeCockpitWorkingSet['target']> & Pick<RuntimeCockpitWorkingSet['target'], 'status' | 'locked' | 'stale'>;
  evidence: Partial<RuntimeCockpitWorkingSet['evidence']> & Pick<RuntimeCockpitWorkingSet['evidence'], 'posture' | 'total' | 'fresh'>;
}): RuntimeCockpitWorkingSet {
  return {
    target: {
      ageMs: null,
      expiresInMs: null,
      ...patch.target,
    },
    evidence: {
      stale: 0,
      expired: 0,
      latestAt: null,
      details: [],
      ...patch.evidence,
    },
    visibility: 'metadata_only',
  };
}
