import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_PREFERENCE_STORAGE_KEY } from '../core/i18n/store';
import {
  appendAutonomousQualityGateRecord,
  appendAutonomousReviewLaneRecord,
  AUTONOMOUS_RUN_STORAGE_KEY,
  createAutonomousRun,
  transitionAutonomousRun,
} from '../core/run/store';
import { I18nProvider } from '../entrypoints/sidepanel/i18n';
import ReviewPage from '../entrypoints/sidepanel/pages/ReviewPage';

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

describe('ReviewPage', () => {
  it('summarizes blocking review state before detailed counts', async () => {
    stubEnglishChrome();
    vi.stubGlobal('crypto', { randomUUID: () => 'review-page-run' });

    const run = await createAutonomousRun({ goal: 'Review the autonomy evidence panel' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousQualityGateRecord(run.id, {
      status: 'warning',
      contractCoverage: {
        rows: [],
        complete: false,
        coveredCount: 2,
        gapCount: 0,
        conflictCount: 0,
        notTestableCount: 0,
      },
      resultStateConsistency: {
        status: 'consistent',
        ok: true,
        issueCount: 0,
        blockingIssueCount: 0,
      },
      selfReview: { grade: 'B' },
      verification: {
        commands: [{ name: 'compile', result: 'passed', summary: 'passed' }],
      },
      independentReview: {
        status: 'not_run',
        grade: null,
        blockingIssueCount: 0,
      },
    }, 120);
    await appendAutonomousReviewLaneRecord(run.id, {
      role: 'grok',
      status: 'blocked',
      grade: 'C',
      recommendation: 'iterate',
      highestPriority: 'P2',
      issueCount: 1,
      evidenceRefCount: 1,
      summary: 'raw reviewer summary should not render',
    }, 130);

    await renderReviewPage();

    const statusPanel = container.querySelector('.ds-cockpit-review-status');
    expect(statusPanel).toBeTruthy();
    expect(statusPanel?.getAttribute('data-workbench-panel')).toBe('true');
    expect(statusPanel?.children[0]?.getAttribute('data-slot')).toBe('card');
    expect(statusPanel?.textContent).toContain('Review status');
    expect(statusPanel?.textContent).toContain('Blocked');
    expect(statusPanel?.textContent).toContain('Clear blocker before continuing');
    expect(statusPanel?.textContent).toContain('Highest issue');
    expect(statusPanel?.textContent).toContain('P2');
    expect(statusPanel?.textContent).toContain('Evidence state');
    expect(statusPanel?.textContent).toContain('Coverage incomplete');
    expect(statusPanel?.querySelector('[data-slot="badge"]')?.textContent).toContain('Blocked');
    expect(container.textContent).toContain('Quality review');
    expect(container.querySelector('[data-slot="badge"].ds-cockpit-status')).toBeTruthy();
    const reviewerTable = container.querySelector('[aria-label="Reviewer details"]');
    expect(reviewerTable).toBeTruthy();
    expect(reviewerTable?.getAttribute('data-slot')).toBe('table');
    expect(reviewerTable?.classList.contains('ds-cockpit-review-lane-table')).toBe(true);
    expect(reviewerTable?.querySelector('[data-slot="table-header"]')).toBeTruthy();
    expect(reviewerTable?.querySelector('[data-slot="table-body"]')).toBeTruthy();
    expect(reviewerTable?.querySelectorAll('[data-slot="table-row"]')).toHaveLength(2);
    expect(Array.from(reviewerTable?.querySelectorAll('[data-slot="table-head"]') ?? []).map((cell) => cell.textContent)).toEqual([
      'Reviewer',
      'State',
      'Finding',
      'Evidence',
    ]);
    expect(container.textContent).toContain('Grok');
    expect(container.querySelector('[data-slot="badge"].ds-cockpit-review-lane-status')?.textContent).toContain('Blocked');
    expect(container.textContent).toContain('Grade C · P2 · Block');
    expect(container.textContent).toContain('1 issue');
    expect(container.textContent).toContain('1 evidence');
    expect(container.querySelector('.ds-cockpit-review-lane-main')).toBeNull();
    expect(container.querySelector('.ds-cockpit-review-lane-side')).toBeNull();
    expect(container.textContent).not.toContain('raw reviewer summary should not render');
    expect(container.textContent).not.toContain('review-page-run');
  });
});

async function renderReviewPage() {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(I18nProvider, null, React.createElement(ReviewPage)));
    await flush();
  });
  await flushAct();
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
