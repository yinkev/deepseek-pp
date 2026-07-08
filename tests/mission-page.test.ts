import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTONOMOUS_RUN_STORAGE_KEY,
  appendAutonomousEvidenceRecord,
  appendAutonomousReviewLaneRecord,
  createAutonomousRun,
  transitionAutonomousRun,
} from '../core/run/store';
import { LOCALE_PREFERENCE_STORAGE_KEY } from '../core/i18n/store';
import { I18nProvider } from '../entrypoints/sidepanel/i18n';
import MissionPage from '../entrypoints/sidepanel/pages/MissionPage';
import type { SidepanelNavigationTarget } from '../entrypoints/sidepanel/navigation';

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MissionPage', () => {
  it('starts a real mission from the Mission surface instead of routing to Automation', async () => {
    const { storage } = stubEnglishChrome();
    const onNavigate = vi.fn();
    vi.stubGlobal('crypto', { randomUUID: () => 'mission-page-run' });

    await renderMissionPage(onNavigate);
    expect(container.textContent).toContain('No mission running');
    expect(container.textContent).toContain('Start mission');
    expect(container.textContent).not.toContain('Open Automation');
    expect(container.querySelector('[data-slot="empty"].ds-cockpit-empty')).toBeTruthy();
    expect(container.querySelector('.ds-cockpit-empty-action[data-slot="button"]')?.textContent).toBe('Start mission');

    await clickButton('Start mission');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Define the goal, finish line, and proof you expect back.');
    expect(container.textContent).toContain('Objective');
    expect(container.textContent).toContain('Done when');
    expect(container.textContent).toContain('Evidence needed');
    expect(container.querySelectorAll('.ds-cockpit-starter [data-slot="field"]')).toHaveLength(3);
    expect(container.querySelectorAll('.ds-cockpit-starter [data-slot="field-label"]')).toHaveLength(3);
    expect(container.querySelectorAll('.ds-cockpit-starter [data-slot="textarea"]')).toHaveLength(3);
    expect(container.querySelector('textarea[name="mission-objective"]')?.getAttribute('data-slot')).toBe('textarea');
    expect(container.querySelector('textarea[name="mission-done-criteria"]')?.getAttribute('data-slot')).toBe('textarea');
    expect(container.querySelector('textarea[name="mission-required-evidence"]')?.getAttribute('data-slot')).toBe('textarea');
    expect(Array.from(container.querySelectorAll('.ds-cockpit-starter-actions [data-slot="button"]')).map((button) => button.textContent)).toEqual([
      'Cancel',
      'Create mission',
    ]);

    await setTextareaValue('mission-objective', 'Tighten the Projects page state labels');
    await setTextareaValue('mission-done-criteria', 'Every state is explicit\nNo internal routing terms remain');
    await setTextareaValue('mission-required-evidence', 'Focused test output\nSidepanel screenshot');
    await clickButton('Create mission');

    expect(container.textContent).toContain('Tighten the Projects page state labels');
    expect(container.textContent).toContain('Mission status');
    expect(container.textContent).toContain('Ready to begin');
    expect(container.textContent).toContain('Not recorded');
    expect(container.textContent).not.toContain('Restored from saved mission');
    expect(container.textContent).not.toContain('Define the goal, finish line');

    const state = storage.get(AUTONOMOUS_RUN_STORAGE_KEY) as { runs: Array<{
      id: string;
      goal: string;
      status: string;
      proofContract: { doneCriteria: string[]; requiredEvidence: string[] };
    }> };
    expect(state.runs[0]).toMatchObject({
      id: 'run-mission-page-run',
      goal: 'Tighten the Projects page state labels',
      status: 'queued',
      proofContract: {
        doneCriteria: ['Every state is explicit', 'No internal routing terms remain'],
        requiredEvidence: ['Focused test output', 'Sidepanel screenshot'],
      },
    });
  });

  it('keeps Start mission available after the previous mission is finished', async () => {
    stubEnglishChrome();
    vi.stubGlobal('crypto', { randomUUID: () => 'finished-run' });
    const finished = await createAutonomousRun({ goal: 'Finished evidence review' }, 100);
    await transitionAutonomousRun(finished.id, 'running', null, 110);
    await transitionAutonomousRun(finished.id, 'succeeded', null, 120);

    await renderMissionPage();
    expect(container.textContent).toContain('Finished evidence review');
    expect(container.textContent).toContain('Review result');
    expect(container.textContent).not.toContain('Restored from saved mission');

    await clickButton('Start mission');
    expect(container.textContent).toContain('Objective');
    expect(container.textContent).toContain('Create mission');
  });

  it('marks an existing mission as recovered after the sidepanel reopens', async () => {
    stubEnglishChrome();
    vi.stubGlobal('crypto', { randomUUID: () => 'recovered-run' });
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const run = await createAutonomousRun({ id: 'run-recovered', goal: 'Continue interrupted browser audit' }, 1_000);
    await transitionAutonomousRun(run.id, 'running', null, 2_000);

    await renderMissionPage();

    const statusPanel = container.querySelector('.ds-cockpit-mission-status');
    expect(statusPanel).toBeTruthy();
    expect(statusPanel?.getAttribute('data-workbench-panel')).toBe('true');
    expect(statusPanel?.children[0]?.getAttribute('data-slot')).toBe('card');
    expect(statusPanel?.textContent).toContain('Mission status');
    expect(statusPanel?.textContent).toContain('Recovered');
    expect(statusPanel?.textContent).toContain('Restored from saved mission');
    expect(statusPanel?.textContent).toContain('Needs evidence');
    expect(statusPanel?.querySelector('[data-slot="badge"]')?.textContent).toContain('Needs evidence');
    expect(container.textContent).toContain('Continue interrupted browser audit');
  });

  it('puts mission trust state before raw controls and routes blockers to Review', async () => {
    stubEnglishChrome();
    vi.stubGlobal('crypto', { randomUUID: () => 'mission-status-id' });
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const onNavigate = vi.fn();
    const run = await createAutonomousRun({ id: 'run-mission-status', goal: 'Stabilize mission evidence' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousEvidenceRecord(run.id, {
      id: 'evidence-mission-status',
      kind: 'browser_snapshot',
      capturedAt: 120,
      ttlMs: 20_000,
      summary: 'Rendered Mission panel after status pass',
      refs: ['screenshot:mission-status'],
      source: { toolName: 'playwright' },
    }, 120);
    await appendAutonomousEvidenceRecord(run.id, {
      id: 'evidence-mission-expired',
      kind: 'shell_output',
      capturedAt: 20,
      ttlMs: 5_000,
      summary: 'Expired raw shell output should stay internal.',
      refs: ['secret-expired-ref'],
      source: { toolName: 'secret-cli' },
    }, 20);
    await appendAutonomousReviewLaneRecord(run.id, {
      role: 'grok',
      status: 'blocked',
      grade: 'C',
      recommendation: 'iterate',
      highestPriority: 'P2',
      issueCount: 1,
      evidenceRefCount: 1,
      summary: 'Raw reviewer text should not be exposed.',
    }, 130);

    await renderMissionPage(onNavigate);

    const sections = Array.from(container.querySelectorAll('section'));
    const statusPanel = sections.find((section) => section.textContent?.includes('Mission status'));
    const missionPanel = sections.find((section) => section.textContent?.includes('Current mission'));
    expect(statusPanel).toBeTruthy();
    expect(missionPanel).toBeTruthy();
    expect(sections.indexOf(statusPanel!)).toBeLessThan(sections.indexOf(missionPanel!));
    expect(statusPanel?.textContent).toContain('Blocked');
    expect(statusPanel?.textContent).toContain('Review blocker');
    expect(statusPanel?.textContent).toContain('Review blocked');
    expect(statusPanel?.textContent).toContain('1/2 fresh');
    expect(statusPanel?.querySelector('[aria-label="Readiness details"]')).toBeTruthy();
    expect(statusPanel?.textContent).toContain('Evidence freshness');
    expect(statusPanel?.textContent).toContain('1 fresh · 1 expired');
    expect(statusPanel?.textContent).toContain('Review gate');
    expect(statusPanel?.textContent).toContain('No quality gate');
    expect(statusPanel?.textContent).toContain('Reviewers');
    expect(statusPanel?.textContent).toContain('P2 · 1 blocked · 1 issue');
    expect(statusPanel?.querySelector('[data-slot="badge"]')?.textContent).toContain('Blocked');
    expect(statusPanel?.querySelector('[data-slot="button"]')?.textContent).toBe('Open Review');
    expect(statusPanel?.textContent).not.toContain('Raw reviewer text should not be exposed.');
    expect(statusPanel?.textContent).not.toContain('Rendered Mission panel after status pass');
    expect(statusPanel?.textContent).not.toContain('screenshot:mission-status');
    expect(statusPanel?.textContent).not.toContain('Expired raw shell output should stay internal.');
    expect(statusPanel?.textContent).not.toContain('secret-expired-ref');
    expect(statusPanel?.textContent).not.toContain('secret-cli');

    await clickButton('Open Review');
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'review' });
  });
});

async function renderMissionPage(onNavigate?: (target: SidepanelNavigationTarget) => void) {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(I18nProvider, null, React.createElement(MissionPage, { onNavigate })));
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

async function setTextareaValue(name: string, value: string) {
  const textarea = container.querySelector(`textarea[name="${name}"]`) as HTMLTextAreaElement | null;
  expect(textarea).toBeTruthy();
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    valueSetter?.call(textarea, value);
    textarea?.dispatchEvent(new Event('input', { bubbles: true }));
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
  return { storage };
}

function resolveStorageKeys(key: string | string[] | Record<string, unknown> | null): string[] {
  if (key === null) return [];
  if (typeof key === 'string') return [key];
  if (Array.isArray(key)) return key;
  return Object.keys(key);
}
