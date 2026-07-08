import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_PREFERENCE_STORAGE_KEY } from '../core/i18n/store';
import { createTranslator } from '../core/i18n';
import {
  appendAutonomousEvidenceRecord,
  appendAutonomousReviewLaneRecord,
  appendAutonomousRunStep,
  AUTONOMOUS_RUN_STORAGE_KEY,
  createAutonomousRun,
  transitionAutonomousRun,
} from '../core/run/store';
import type { RuntimeCockpitTimelineEvent } from '../core/cockpit';
import { I18nProvider } from '../entrypoints/sidepanel/i18n';
import TimelinePage, { createActivityAttentionSummary, createActivityStatus } from '../entrypoints/sidepanel/pages/TimelinePage';
import { CockpitLoading } from '../entrypoints/sidepanel/pages/cockpit-components';
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
  vi.unstubAllGlobals();
});

describe('TimelinePage', () => {
  it('uses shadcn primitives for shared cockpit loading and error states', async () => {
    stubEnglishChrome();

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(I18nProvider, null, (
        React.createElement(CockpitLoading, {
          loading: true,
          error: null,
          children: React.createElement('div', null, 'Loaded'),
        })
      )));
      await flush();
    });

    expect(container.querySelectorAll('[data-slot="card"].ds-cockpit-loading-card')).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="skeleton"].ds-skeleton')).toHaveLength(6);
    expect(container.querySelector('.ds-cockpit-skeleton-list')?.getAttribute('aria-busy')).toBe('true');

    await act(async () => {
      root?.render(React.createElement(I18nProvider, null, (
        React.createElement(CockpitLoading, {
          loading: false,
          error: 'offline cockpit',
          onRetry: vi.fn(),
          children: React.createElement('div', null, 'Loaded'),
        })
      )));
      await flush();
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.getAttribute('data-slot')).toBe('empty');
    expect(alert?.querySelector('[data-slot="empty-title"]')?.textContent).toContain('Cockpit unavailable');
    expect(alert?.querySelector('[data-slot="empty-description"]')?.textContent).toContain('offline cockpit');
    expect(alert?.querySelector('[data-slot="button"]')?.textContent).toBe('Retry');
  });

  it('shows a retryable cockpit load error and recovers after retry', async () => {
    stubEnglishChrome({ failRunLedgerOnce: 'offline cockpit' });

    await renderTimelinePage();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Cockpit unavailable');
    expect(alert?.textContent).toContain('offline cockpit');
    expect(alert?.textContent).toContain('Retry');
    expect(alert?.getAttribute('data-slot')).toBe('empty');
    expect(alert?.querySelector('[data-slot="button"]')?.textContent).toBe('Retry');
    expect(container.textContent).not.toContain('No mission running');

    await clickButton('Retry');

    expect(container.textContent).toContain('No mission running');
    expect(container.textContent).not.toContain('offline cockpit');
  });

  it('summarizes attention activity and routes to Review', async () => {
    stubEnglishChrome();
    const onNavigate = vi.fn();
    vi.stubGlobal('crypto', { randomUUID: () => 'timeline-page-run' });

    const run = await createAutonomousRun({ goal: 'Audit evidence flow' }, 100);
    await transitionAutonomousRun(run.id, 'running', null, 110);
    await appendAutonomousRunStep(run.id, {
      phase: 'verification',
      status: 'succeeded',
      progressScore: 0.6,
      proofDelta: ['Focused test passed'],
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

    await renderTimelinePage(onNavigate);

    const statusPanel = container.querySelector('.ds-cockpit-activity-status');
    expect(statusPanel).toBeTruthy();
    expect(statusPanel?.getAttribute('data-workbench-panel')).toBe('true');
    expect(statusPanel?.children[0]?.getAttribute('data-slot')).toBe('card');
    expect(statusPanel?.textContent).toContain('Activity status');
    expect(statusPanel?.textContent).toContain('Needs review');
    expect(statusPanel?.textContent).toContain('The latest activity is blocked or failed.');
    expect(statusPanel?.textContent).toContain('Latest');
    expect(statusPanel?.textContent).toContain('Reviewer update');
    expect(statusPanel?.textContent).toContain('1 event');
    expect(statusPanel?.textContent).toContain('Attention details');
    expect(statusPanel?.textContent).toContain('Review gates');
    expect(statusPanel?.textContent).toContain('Open review');
    expect(statusPanel?.querySelector('[data-slot="badge"]')?.textContent).toContain('Needs review');
    expect(statusPanel?.querySelector('[data-slot="button"]')?.textContent).toBe('Open review');
    expect(container.textContent).toContain('Recent activity');
    expect(container.textContent).not.toContain('raw reviewer summary should not render');

    await clickButton('Open review');
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'review' });
  });

  it('surfaces expired evidence as an evidence-refresh attention detail without raw payloads', async () => {
    stubEnglishChrome();
    const now = Date.now();
    let uuidCounter = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `timeline-evidence-${uuidCounter += 1}` });

    const run = await createAutonomousRun({ goal: 'Inspect activity evidence freshness' }, now - 40_000);
    await transitionAutonomousRun(run.id, 'running', null, now - 35_000);
    await appendAutonomousEvidenceRecord(run.id, {
      id: 'evidence-secret-timeline-id',
      kind: 'browser_screenshot',
      capturedAt: now - 20_000,
      ttlMs: 5_000,
      summary: 'raw expired screenshot summary should not render',
      refs: ['secret-evidence-ref'],
      source: { toolName: 'secret-screenshot-tool' },
      metadata: { hidden: 'secret metadata' },
    }, now - 20_000);

    await renderTimelinePage();

    const statusPanel = container.querySelector('.ds-cockpit-activity-status');
    expect(statusPanel?.textContent).toContain('Needs review');
    expect(statusPanel?.textContent).toContain('Attention details');
    expect(statusPanel?.textContent).toContain('Evidence refresh');
    expect(statusPanel?.textContent).toContain('1 event');
    expect(container.textContent).toContain('Screenshot · Expired');
    expect(container.textContent).not.toContain('evidence-secret-timeline-id');
    expect(container.textContent).not.toContain('raw expired screenshot summary should not render');
    expect(container.textContent).not.toContain('secret-evidence-ref');
    expect(container.textContent).not.toContain('secret-screenshot-tool');
    expect(container.textContent).not.toContain('secret metadata');
  });

  it('uses neutral copy for clear activity with no review flags', () => {
    const status = createActivityStatus([
      createEvent({ kind: 'step', at: 120, status: 'passed', phase: 'verification' }),
      createEvent({ kind: 'mission_started', at: 100, status: 'running' }),
    ], 0, createTranslator('en').t);

    expect(status).toMatchObject({
      statusKey: 'sidepanel.cockpit.activityStatusClear',
      descriptionKey: 'sidepanel.cockpit.activityStatusClearDescription',
      nextKey: 'sidepanel.cockpit.activityNextContinue',
      tone: 'normal',
      latest: 'Verifying',
      attention: 'None',
      reviewAction: false,
    });
  });

  it('selects the latest event by timestamp even if events arrive unsorted', () => {
    const status = createActivityStatus([
      createEvent({ kind: 'step', at: 120, status: 'passed', phase: 'verification' }),
      createEvent({ kind: 'review_lane', at: 150, status: 'blocked', reviewLaneStatus: 'blocked' }),
      createEvent({ kind: 'mission_started', at: 100, status: 'running' }),
    ], 1, createTranslator('en').t);

    expect(status).toMatchObject({
      statusKey: 'sidepanel.cockpit.activityStatusAttention',
      descriptionKey: 'sidepanel.cockpit.activityStatusBlockedDescription',
      nextKey: 'sidepanel.cockpit.activityNextReview',
      tone: 'blocked',
      latest: 'Reviewer update',
      attention: '1 event',
      reviewAction: true,
    });
  });

  it('shows generic attention when older activity needs review but the latest event is not blocked', () => {
    const status = createActivityStatus([
      createEvent({ kind: 'quality_gate', at: 150, status: 'warning', qualityGateGrade: 'B' }),
      createEvent({ kind: 'step', at: 180, status: 'passed', phase: 'verification' }),
    ], 1, createTranslator('en').t);

    expect(status).toMatchObject({
      statusKey: 'sidepanel.cockpit.activityStatusAttention',
      descriptionKey: 'sidepanel.cockpit.activityStatusAttentionDescription',
      nextKey: 'sidepanel.cockpit.activityNextReview',
      tone: 'attention',
      latest: 'Verifying',
      attention: '1 event',
      reviewAction: true,
    });
  });

  it('breaks activity attention into sanitized categories', () => {
    const summary = createActivityAttentionSummary([
      createEvent({ kind: 'evidence', at: 180, status: 'warning', evidenceFreshness: 'expired', evidenceKind: 'browser_snapshot' }),
      createEvent({ kind: 'review_lane', at: 170, status: 'blocked', reviewLaneStatus: 'blocked' }),
      createEvent({ kind: 'step', at: 160, status: 'failed', phase: 'tool_execution', stepStatus: 'failed' }),
      createEvent({ kind: 'mission_started', at: 100, status: 'running' }),
    ], createTranslator('en').t);

    expect(summary).toEqual({
      total: 3,
      items: [
        {
          key: 'failed_work',
          labelKey: 'sidepanel.cockpit.activityAttentionFailedWork',
          value: '1 event',
          tone: 'blocked',
        },
        {
          key: 'review_flags',
          labelKey: 'sidepanel.cockpit.activityAttentionReview',
          value: '1 event',
          tone: 'blocked',
        },
        {
          key: 'evidence_refresh',
          labelKey: 'sidepanel.cockpit.activityAttentionEvidence',
          value: '1 event',
          tone: 'attention',
        },
      ],
    });
  });

  it('shows running status when the latest event is still in progress', () => {
    const status = createActivityStatus([
      createEvent({ kind: 'step', at: 180, status: 'running', phase: 'tool_execution', stepStatus: 'running' }),
      createEvent({ kind: 'mission_started', at: 100, status: 'running' }),
    ], 0, createTranslator('en').t);

    expect(status).toMatchObject({
      statusKey: 'sidepanel.cockpit.activityStatusRunning',
      descriptionKey: 'sidepanel.cockpit.activityStatusRunningDescription',
      nextKey: 'sidepanel.cockpit.activityNextWatch',
      tone: 'running',
      latest: 'Using tools',
      attention: 'None',
      reviewAction: false,
    });
  });
});

async function renderTimelinePage(onNavigate?: (target: SidepanelNavigationTarget) => void) {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(I18nProvider, null, React.createElement(TimelinePage, { onNavigate })));
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

function stubEnglishChrome(options: { failRunLedgerOnce?: string } = {}) {
  const storage = new Map<string, unknown>([[LOCALE_PREFERENCE_STORAGE_KEY, 'en']]);
  const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void>();
  let runLedgerFailure = options.failRunLedgerOnce ?? null;
  vi.stubGlobal('chrome', {
    i18n: {
      getUILanguage: vi.fn(() => 'en'),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string | string[] | Record<string, unknown> | null) => {
          const keys = resolveStorageKeys(key);
          if (runLedgerFailure && keys.includes(AUTONOMOUS_RUN_STORAGE_KEY)) {
            const message = runLedgerFailure;
            runLedgerFailure = null;
            throw new Error(message);
          }
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

function createEvent(
  patch: Partial<RuntimeCockpitTimelineEvent> & Pick<RuntimeCockpitTimelineEvent, 'kind' | 'at' | 'status'>,
): RuntimeCockpitTimelineEvent {
  return {
    title: '',
    detail: null,
    ...patch,
  };
}
