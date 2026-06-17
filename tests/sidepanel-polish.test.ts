import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_PREFERENCE_STORAGE_KEY } from '../core/i18n/store';
import { I18nProvider } from '../entrypoints/sidepanel/i18n';
import CapabilitiesPage from '../entrypoints/sidepanel/pages/CapabilitiesPage';
import SkillPage from '../entrypoints/sidepanel/pages/SkillPage';
import ScenarioManager from '../entrypoints/sidepanel/components/ScenarioManager';

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

describe('sidepanel polish (English locale)', () => {
  it('shows the compact Auto label on Capabilities automation tab', async () => {
    stubEnglishChrome();
    await renderWithI18n(React.createElement(CapabilitiesPage));

    const nav = container.querySelector('nav[aria-label="Capabilities navigation"]');
    expect(nav).toBeTruthy();

    const automationTab = Array.from(nav!.querySelectorAll('button')).find((button) => button.textContent === 'Auto');
    expect(automationTab).toBeTruthy();
    expect(automationTab?.getAttribute('title')).toBe('Automation');
  });

  it('localizes built-in scenario labels in ScenarioManager', async () => {
    stubEnglishChrome();
    await renderWithI18n(React.createElement(ScenarioManager));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Summarize');
    expect(container.textContent).not.toContain('总结');
    expect(container.querySelectorAll('[role="switch"]').length).toBeGreaterThan(0);
  });

  it('renders the built-in skill group with English labels and group toggle', async () => {
    stubEnglishChrome({
      skills: [
        {
          name: 'summarize',
          description: 'Summarize content',
          content: 'Summarize: {input}',
          source: 'builtin',
          enabled: true,
        },
      ],
    });
    await renderWithI18n(React.createElement(SkillPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Built-in');
    const groupToggle = container.querySelector('button[aria-label*="Built-in"]');
    expect(groupToggle).toBeTruthy();
    expect(container.querySelector('button[aria-label*="summarize"]')).toBeTruthy();
  });
});

async function renderWithI18n(element: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(I18nProvider, null, element));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function stubEnglishChrome(options: { skills?: unknown[] } = {}) {
  const skills = options.skills ?? [];

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
            if (storageKey === LOCALE_PREFERENCE_STORAGE_KEY) {
              result[storageKey] = 'en';
            }
            if (storageKey === 'scenarioConfigs') {
              result[storageKey] = [];
            }
          }
          return result;
        }),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      sendMessage: vi.fn(async (message: { type?: string }) => {
        if (message.type === 'GET_SKILL_LIBRARY') return skills;
        if (message.type === 'GET_SKILL_SOURCES') return [];
        return null;
      }),
    },
  });
}

function resolveStorageKeys(key: string | string[] | Record<string, unknown> | null): string[] {
  if (key === null) return [LOCALE_PREFERENCE_STORAGE_KEY, 'scenarioConfigs'];
  if (typeof key === 'string') return [key];
  if (Array.isArray(key)) return key;
  return Object.keys(key);
}