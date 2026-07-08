import { readFileSync } from 'node:fs';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../components/ui/tooltip';
import { LOCALE_PREFERENCE_STORAGE_KEY } from '../core/i18n/store';
import { localeResources } from '../core/i18n';
import { DEFAULT_PROMPT_INJECTION_SETTINGS } from '../core/prompt/settings';
import { DEFAULT_VOICE_SETTINGS } from '../core/voice/settings';
import { I18nProvider } from '../entrypoints/sidepanel/i18n';
import CapabilitiesPage from '../entrypoints/sidepanel/pages/CapabilitiesPage';
import BrowserControlPage from '../entrypoints/sidepanel/pages/BrowserControlPage';
import RuntimeDoctorPage from '../entrypoints/sidepanel/pages/RuntimeDoctorPage';
import ToolsPage from '../entrypoints/sidepanel/pages/ToolsPage';
import McpPage from '../entrypoints/sidepanel/pages/McpPage';
import ProjectsPage from '../entrypoints/sidepanel/pages/ProjectsPage';
import MissionPage from '../entrypoints/sidepanel/pages/MissionPage';
import ReviewPage from '../entrypoints/sidepanel/pages/ReviewPage';
import SkillPage from '../entrypoints/sidepanel/pages/SkillPage';
import MemoryPage from '../entrypoints/sidepanel/pages/MemoryPage';
import SavedPage from '../entrypoints/sidepanel/pages/SavedPage';
import PresetPage from '../entrypoints/sidepanel/pages/PresetPage';
import SettingsPage from '../entrypoints/sidepanel/pages/SettingsPage';
import ScenarioManager from '../entrypoints/sidepanel/components/ScenarioManager';
import PromptControlPanel from '../entrypoints/sidepanel/components/PromptControlPanel';
import VoiceSettingsPanel from '../entrypoints/sidepanel/components/VoiceSettingsPanel';
import PageIntro from '../entrypoints/sidepanel/components/PageIntro';
import WorkbenchScrollRail from '../entrypoints/sidepanel/components/WorkbenchScrollRail';
import WorkbenchTooltip from '../entrypoints/sidepanel/components/WorkbenchTooltip';
import ApiSubPage from '../entrypoints/sidepanel/components/settings/ApiSubPage';
import AboutSubPage from '../entrypoints/sidepanel/components/settings/AboutSubPage';
import AppearanceSubPage from '../entrypoints/sidepanel/components/settings/AppearanceSubPage';
import DataSubPage from '../entrypoints/sidepanel/components/settings/DataSubPage';
import GeneralSubPage from '../entrypoints/sidepanel/components/settings/GeneralSubPage';
import UsageSubPage from '../entrypoints/sidepanel/components/settings/UsageSubPage';
import {
  SegmentedControl,
  SelectField,
  SettingsSection,
  SettingsSegmentedGroup,
  Slider,
  TextAreaField,
  TextField,
  ToggleRow,
} from '../entrypoints/sidepanel/components/settings/primitives';

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
  it('renders the shared page intro as a shadcn-backed workbench header', () => {
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(PageIntro, {
        title: 'Mission',
        description: 'Start, pause, resume, and review autonomous work from one place.',
        meta: 'Ready',
        actions: React.createElement('button', { type: 'button' }, 'Refresh'),
      }));
    });

    const header = container.querySelector('[data-workbench-header="true"].ds-page-intro');
    const title = container.querySelector('.ds-page-intro-title');
    expect(header).toBeTruthy();
    expect(header?.getAttribute('aria-labelledby')).toBe(title?.id);
    expect(container.querySelector('[data-slot="badge"].ds-page-intro-meta')?.textContent).toBe('Ready');
    expect(container.querySelector('[data-slot="separator"].ds-page-intro-separator')).toBeTruthy();
    expect(container.querySelector('.ds-page-intro-actions button')?.textContent).toBe('Refresh');
  });

  it('uses shadcn Card as the cockpit panel substrate without fixed-height mission strip clipping', () => {
    const cockpitComponents = readFileSync('entrypoints/sidepanel/pages/cockpit-components.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const missionStripBlock = getCssBlock(css, '.ds-cockpit-mission-strip');
    const cardBlock = getCssBlock(css, '.ds-cockpit-card');

    expect(cockpitComponents).toContain("from '@/components/ui/card'");
    expect(cockpitComponents).toContain('data-workbench-panel="true"');
    expect(cockpitComponents).toContain('<Card size="sm" className="ds-cockpit-card">');
    expect(cardBlock).toContain('border: 1px solid');
    expect(cardBlock).toContain('background: var(--ds-card);');
    expect(missionStripBlock).toContain('height: auto;');
    expect(missionStripBlock).toContain('min-height: 58px;');
  });

  it('uses shared shadcn-backed fields and alerts for the Mission starter form', async () => {
    stubEnglishChrome();
    await renderWithI18n(React.createElement(MissionPage));
    await flushPolishApp();

    const startButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Start mission');
    expect(startButton).toBeTruthy();

    await act(async () => {
      startButton!.click();
      await flushPolishApp();
    });

    expect(container.querySelectorAll('.ds-cockpit-starter [data-slot="field"]')).toHaveLength(3);
    expect(container.querySelectorAll('.ds-cockpit-starter [data-slot="textarea"]')).toHaveLength(3);
    expect(container.querySelector('textarea[name="mission-objective"]')?.getAttribute('data-slot')).toBe('textarea');

    const missionPage = readFileSync('entrypoints/sidepanel/pages/MissionPage.tsx', 'utf8');
    expect(missionPage).toContain("from '@/components/ui/alert'");
    expect(missionPage).toContain('TextAreaField');
    expect(missionPage).toContain('<Alert variant="destructive" className="ds-cockpit-inline-error">');
    expect(missionPage).not.toContain('<label className="ds-cockpit-field">');
    expect(missionPage).not.toContain('<textarea');
  });

  it('uses shadcn Table and Badge as the Review lane substrate', () => {
    const reviewPage = readFileSync('entrypoints/sidepanel/pages/ReviewPage.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const table = readFileSync('components/ui/table.tsx', 'utf8');

    expect(table).toContain('data-slot="table-container"');
    expect(table).toContain('data-slot="table"');
    expect(reviewPage).toContain("from '@/components/ui/table'");
    expect(reviewPage).toContain("from '@/components/ui/badge'");
    expect(reviewPage).toContain('<Table className="ds-cockpit-review-lane-table"');
    expect(reviewPage).toContain('<TableCaption className="sr-only">');
    expect(reviewPage).toContain('<TableHead className="ds-cockpit-review-lane-reviewer">');
    expect(reviewPage).toContain('<Badge variant={getReviewLaneBadgeVariant(tone)} className="ds-cockpit-review-lane-status">');
    expect(reviewPage).not.toContain('ds-cockpit-review-lane-main');
    expect(reviewPage).not.toContain('ds-cockpit-review-lane-side');
    expect(css).toContain('.ds-cockpit-review-lane-table');
    expect(css).toContain('[data-slot="table-head"]');
    expect(css).toContain('[data-slot="table-cell"]');
    expect(ReviewPage).toBeTruthy();
  });

  it('uses shadcn Tooltip as the workbench icon-action hint substrate', async () => {
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(TooltipProvider, null,
          React.createElement(WorkbenchTooltip, {
            label: 'Pin memory',
            children: React.createElement('button', { type: 'button', 'aria-label': 'Pin memory' }, '★'),
          }),
        ),
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('button');
    expect(trigger?.getAttribute('data-slot')).toBe('tooltip-trigger');
    expect(trigger?.getAttribute('aria-label')).toBe('Pin memory');
    expect(trigger?.getAttribute('title')).toBeNull();

    await act(async () => {
      trigger!.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const tooltip = document.body.querySelector<HTMLElement>('[data-slot="tooltip-content"]');
    expect(tooltip?.textContent).toContain('Pin memory');
    expect(tooltip?.className).toContain('ds-workbench-tooltip');
  });

  it('replaces native title hints on Projects and Automation icon-only actions', () => {
    const app = readFileSync('entrypoints/sidepanel/App.tsx', 'utf8');
    const tooltip = readFileSync('entrypoints/sidepanel/components/WorkbenchTooltip.tsx', 'utf8');
    const projects = readFileSync('entrypoints/sidepanel/pages/ProjectsPage.tsx', 'utf8');
    const automation = readFileSync('entrypoints/sidepanel/pages/AutomationPage.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const projectMemoryRow = projects.slice(projects.indexOf('function ProjectMemoryRow'), projects.indexOf('function FolderIcon'));
    const automationIconButton = automation.slice(automation.indexOf('function IconButton'), automation.indexOf('function MetaChip'));

    expect(app).toContain("import { TooltipProvider } from '@/components/ui/tooltip'");
    expect(app).toContain('<TooltipProvider>');
    expect(tooltip).toContain("from '@/components/ui/tooltip'");
    expect(tooltip).toContain('<TooltipTrigger asChild>');
    expect(tooltip).toContain('className="ds-workbench-tooltip"');

    expect(projectMemoryRow).toContain('<WorkbenchTooltip label={pinTitle}>');
    expect(projectMemoryRow).toContain('<WorkbenchTooltip label={t(\'common.edit\')}>');
    expect(projectMemoryRow).toContain('<WorkbenchTooltip label={t(\'common.delete\')}>');
    expect(projectMemoryRow).not.toContain(' title=');
    expect(projectMemoryRow).toContain('aria-label={pinTitle}');
    expect(projectMemoryRow).toContain('aria-label={t(\'common.edit\')}');
    expect(projectMemoryRow).toContain('aria-label={t(\'common.delete\')}');

    expect(automationIconButton).toContain('<WorkbenchTooltip label={title}>');
    expect(automationIconButton).toContain('type="button"');
    expect(automationIconButton).toContain('aria-label={title}');
    expect(automationIconButton).not.toContain('title={title}');
    expect(css).toContain('.ds-workbench-tooltip');
    expect(css).toContain('max-width: min(240px, calc(100vw - 24px));');
  });

  it('uses shadcn ScrollArea as the workbench horizontal rail substrate', () => {
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(WorkbenchScrollRail, {
        label: 'Automation filters',
        rowClassName: 'test-scroll-row',
        children: [
          React.createElement('button', { key: 'all', type: 'button' }, 'All'),
          React.createElement('button', { key: 'active', type: 'button' }, 'Active'),
        ],
      }));
    });

    const rail = container.querySelector<HTMLElement>('[data-slot="scroll-area"]');
    const viewport = container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const horizontal = container.querySelector<HTMLElement>('[data-slot="scroll-area-scrollbar"][data-orientation="horizontal"]');

    expect(rail?.getAttribute('aria-label')).toBe('Automation filters');
    expect(viewport).toBeTruthy();
    expect(horizontal).toBeTruthy();
    expect(container.querySelector('.ds-workbench-scroll-row.test-scroll-row')?.textContent).toContain('All');
  });

  it('uses shadcn Tabs as the shared Library sub-navigation substrate', () => {
    const primitives = readFileSync('entrypoints/sidepanel/components/settings/primitives.tsx', 'utf8');
    const libraryPage = readFileSync('entrypoints/sidepanel/pages/LibraryPage.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');

    expect(readFileSync('components/ui/tabs.tsx', 'utf8')).toContain('data-slot="tabs-trigger"');
    expect(primitives).toContain("from '@/components/ui/tabs'");
    expect(primitives).toContain('<Tabs');
    expect(primitives).toContain('<TabsList');
    expect(primitives).toContain('<TabsTrigger');
    expect(primitives).toContain('className="sub-tabs-tabs"');
    expect(libraryPage).toContain('<SubTabs');
    expect(getCssBlock(css, '.sub-tabs-list')).toContain('background: transparent;');
    expect(getCssBlock(css, '.sub-tab-active::after')).toContain('opacity: 1;');
  });

  it('keeps Automation dense rows in shadcn horizontal scroll rails at narrow widths', () => {
    const automationPage = readFileSync('entrypoints/sidepanel/pages/AutomationPage.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const en = readFileSync('core/i18n/resources/en.ts', 'utf8');
    const zh = readFileSync('core/i18n/resources/zh-CN.ts', 'utf8');

    expect(automationPage).toContain("from '@/components/ui/card'");
    expect(automationPage).toContain("from '@/components/ui/badge'");
    expect(automationPage).toContain("from '@/components/ui/button'");
    expect(automationPage).toContain("from '@/components/ui/alert'");
    expect(automationPage).toContain("from '@/components/ui/empty'");
    expect(automationPage).toContain("from '@/components/ui/field'");
    expect(automationPage).toContain("from '@/components/ui/select'");
    expect(automationPage).toContain("from '@/components/ui/switch'");
    expect(automationPage).toContain("from '@/components/ui/toggle-group'");
    expect(automationPage).toContain("from 'lucide-react'");
    expect(automationPage).toContain('function AutomationStatusCard');
    expect(automationPage).toContain('function AutomationSelectField');
    expect(automationPage).toContain('function AutomationSwitchField');
    expect(automationPage).toContain('createAutomationStatusModel');
    expect(automationPage).toContain('AUTOMATION_ERROR_LEAK_PATTERN');
    expect(automationPage).toContain('formatAutomationError');
    expect(automationPage).toContain('<Card');
    expect(automationPage).toContain('<CardHeader');
    expect(automationPage).toContain('<CardContent');
    expect(automationPage).toContain('<Badge');
    expect(automationPage).toContain('<Button');
    expect(automationPage).toContain('<Alert');
    expect(automationPage).toContain('<Empty');
    expect(automationPage).toContain('<Field');
    expect(automationPage).toContain('<Select');
    expect(automationPage).toContain('<Switch');
    expect(automationPage).toContain('<ToggleGroup');
    expect(automationPage).toContain('<ToggleGroupItem');
    expect(automationPage).toContain('TextField');
    expect(automationPage).toContain('TextAreaField');
    expect(automationPage).toContain('<XIcon');
    expect(automationPage).toContain('<PlusIcon');
    expect(automationPage).toContain('<Icon aria-hidden="true" />');
    expect(automationPage).not.toContain('<button');
    expect(automationPage).not.toContain('<svg');
    expect(automationPage).not.toContain('<select');
    expect(automationPage).not.toContain('<option');
    expect(automationPage).not.toContain('<textarea');
    expect(automationPage).not.toContain('ToggleSwitch');
    expect(automationPage.match(/<input\b/g) ?? []).toHaveLength(1);
    expect(automationPage).toContain('type="file"');
    const automationRunLauncher = automationPage.slice(
      automationPage.indexOf('function AutomationRunLauncher'),
      automationPage.indexOf('async function loadRecentRunsForAutomations'),
    );
    const automationTemplatePicker = automationPage.slice(
      automationPage.indexOf('function AutomationTemplatePicker'),
      automationPage.indexOf('function AutomationForm'),
    );
    const automationForm = automationPage.slice(
      automationPage.indexOf('function AutomationForm'),
      automationPage.indexOf('function AutomationCard'),
    );
    const automationCard = automationPage.slice(
      automationPage.indexOf('function AutomationCard'),
      automationPage.indexOf('function RunPreflightSummary'),
    );
    const automationReadinessPanel = automationPage.slice(
      automationPage.indexOf('function AutomationReadinessPanel'),
      automationPage.indexOf('function RunFlightRecorder'),
    );
    expect(automationRunLauncher).toContain('<Button');
    expect(automationRunLauncher).toContain('<TextAreaField');
    expect(automationRunLauncher).not.toContain('<button');
    expect(automationTemplatePicker).toContain('<Button');
    expect(automationTemplatePicker).toContain('<TextField');
    expect(automationTemplatePicker).not.toContain('<button');
    expect(automationForm).toContain('<TextField');
    expect(automationForm).toContain('<TextAreaField');
    expect(automationForm).not.toContain('<textarea');
    expect(automationCard).toContain('<Button');
    expect(automationCard).not.toContain('<button');
    expect(automationReadinessPanel).toContain('<Button');
    expect(automationReadinessPanel).not.toContain('<button');
    expect(automationPage).toContain("import WorkbenchScrollRail from '../components/WorkbenchScrollRail'");
    expect(automationPage).toContain("label={t('sidepanel.automationPage.filterRailLabel')}");
    expect(automationPage).toContain('rowClassName="ds-automation-filter-rail"');
    expect(automationPage).toContain("label={t('sidepanel.automationPage.cardMetaRailLabel')}");
    expect(automationPage).toContain('rowClassName="ds-metric-strip ds-automation-card-meta-strip"');
    expect(readFileSync('entrypoints/sidepanel/components/WorkbenchScrollRail.tsx', 'utf8'))
      .toContain('type="always"');

    expect(en).toContain("filterRailLabel: 'Automation filters'");
    expect(en).toContain("cardMetaRailLabel: 'Automation card details'");
    expect(en).toContain("title: 'Automation status'");
    expect(en).toContain("operationUnavailable: 'The automation action could not finish.'");
    expect(zh).toContain("filterRailLabel: '自动化筛选'");
    expect(zh).toContain("cardMetaRailLabel: '自动化卡片详情'");
    expect(zh).toContain("title: '自动化状态'");
    expect(zh).toContain("operationUnavailable: '自动化操作未能完成。'");

    expect(css).toContain('.ds-workbench-scroll-rail');
    expect(css).toContain('[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]');
    expect(css).toContain('.ds-automation-status');
    expect(css).toContain('.ds-automation-status-list');
    expect(css).toContain('.ds-automation-alert');
    expect(css).toContain('.ds-automation-empty');
    expect(css).toContain('.ds-automation-card-meta-strip');
    expect(getCssBlock(css, '.ds-automation-card-meta-strip')).toContain('flex-wrap: nowrap;');
    expect(getCssBlock(css, '.ds-automation-card-meta-strip .ds-metric-chip')).toContain('min-width: 118px;');
  });

  it('uses System labels on the Capabilities section picker', async () => {
    stubEnglishChrome();
    await renderWithI18n(React.createElement(CapabilitiesPage));

    const trigger = getWorkbenchSelectTrigger('System section');
    expect(trigger.getAttribute('data-slot')).toBe('select-trigger');
    const options = await getWorkbenchSelectOptions('System section');
    expect(options).toEqual([
      'Automation',
      'Presets',
      'Browser',
      'Connectors',
      'Page tools',
      'Health',
    ]);
    expect(container.querySelector('nav[aria-label="Capabilities navigation"]')).toBeNull();
    expect(options).not.toContain('Auto');
    expect(options).not.toContain('Doctor');

    const capabilitiesPage = readFileSync('entrypoints/sidepanel/pages/CapabilitiesPage.tsx', 'utf8');
    expect(capabilitiesPage).toContain('SYSTEM_CAPABILITY_ITEMS');
    expect(capabilitiesPage).toContain('WorkbenchSelect');
    expect(capabilitiesPage).not.toContain('NativeSelect');
    expect(capabilitiesPage).not.toContain('useHorizontalScrollHints');
  });

  it('presents Presets as a compact instruction library with explicit state', async () => {
    const activePreset = {
      id: 'preset-active',
      name: 'Code reviewer',
      content: 'Be direct. Check risks before style.',
      createdAt: 1,
      updatedAt: 1,
    };
    const availablePreset = {
      id: 'preset-available',
      name: 'Writing coach',
      content: 'Make the draft clearer and more concise.',
      createdAt: 2,
      updatedAt: 2,
    };
    const setActiveMessages: unknown[] = [];

    stubEnglishChrome({
      runtimeMessages: {
        GET_PRESETS: [activePreset, availablePreset],
        GET_ACTIVE_PRESET: activePreset,
        SET_ACTIVE_PRESET: (message: { type?: string; payload?: unknown }) => {
          setActiveMessages.push(message);
          return { ok: true };
        },
      },
    });
    await renderWithI18n(React.createElement(PresetPage));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Presets');
    expect(bodyText).toContain('Reusable instructions for new DeepSeek chats. One preset can be active at a time.');
    expect(bodyText).toContain('Using Code reviewer');
    expect(bodyText).toContain('Preset status');
    expect(bodyText).toContain('Ready');
    expect(bodyText).toContain('2 saved');
    expect(bodyText).toContain('Use Ask; this preset applies to new chats.');
    expect(bodyText).toContain('In use');
    expect(bodyText).toContain('Available');
    expect(bodyText).toContain('Stop using');
    expect(bodyText).toContain('Use');
    expect(bodyText).not.toMatch(/System prompt presets|System prompt content|injected|Active/);
    expect(Array.from(container.querySelectorAll('[data-slot="button"]')).map((button) => button.textContent)).toEqual(
      expect.arrayContaining(['Import', 'New', 'Stop using', 'Edit', 'Delete', 'Use']),
    );
    const statusCard = container.querySelector<HTMLElement>('.ds-preset-status-card[data-slot="card"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.getAttribute('data-state')).toBe('ready');
    expect(statusCard?.getAttribute('aria-live')).toBe('polite');
    expect(statusCard?.querySelector('[data-slot="card-header"]')).toBeTruthy();
    expect(statusCard?.querySelector('[data-slot="card-title"]')?.textContent).toBe('Preset status');
    expect(statusCard?.querySelector('[data-slot="card-description"]')?.textContent).toBe('One preset is ready for new chats.');
    expect(statusCard?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent).toBe('Ready');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Selection');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Code reviewer');
    expect(statusCard?.querySelector('[data-slot="card-footer"]')).toBeNull();
    const rowBadges = Array.from(container.querySelectorAll('.ds-preset-row .ds-preset-status[data-slot="badge"]'));
    expect(rowBadges).toHaveLength(2);
    expect(rowBadges.map((badge) => badge.getAttribute('data-variant')).sort()).toEqual(['outline', 'secondary']);
    const headerIcons = Array.from(container.querySelectorAll('[data-icon="inline-start"]'));
    expect(headerIcons.length).toBeGreaterThanOrEqual(2);

    const useButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Use');
    expect(useButton).toBeTruthy();
    await act(async () => {
      useButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(setActiveMessages).toContainEqual({
      type: 'SET_ACTIVE_PRESET',
      payload: { id: 'preset-available' },
    });

    const stopUsingButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Stop using');
    expect(stopUsingButton).toBeTruthy();
    await act(async () => {
      stopUsingButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(setActiveMessages).toContainEqual({
      type: 'SET_ACTIVE_PRESET',
      payload: { id: null },
    });

    const newButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'New');
    expect(newButton).toBeTruthy();
    await act(async () => {
      newButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('New preset');
    expect(container.textContent).toContain('Name');
    expect(container.textContent).toContain('Instructions');
    expect(container.querySelector('input[placeholder="Code assistant"]')).toBeTruthy();
    expect(container.querySelector('input[placeholder="Code assistant"]')?.getAttribute('data-slot')).toBe('input');
    expect(container.querySelector('textarea[placeholder="Write the instructions this preset should apply to new chats."]')?.getAttribute('data-slot')).toBe('textarea');

    const presetCard = readFileSync('entrypoints/sidepanel/components/PresetCard.tsx', 'utf8');
    const presetForm = readFileSync('entrypoints/sidepanel/components/PresetForm.tsx', 'utf8');
    const presetPage = readFileSync('entrypoints/sidepanel/pages/PresetPage.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const activeRowBlock = getCssBlock(css, '.ds-preset-row-active');
    const rowBadgeBlock = getCssBlock(css, ".ds-preset-status[data-slot='badge']");
    expect(presetCard).toContain("from '@/components/ui/button'");
    expect(presetCard).toContain("from '@/components/ui/badge'");
    expect(presetCard).toContain('ds-preset-row');
    expect(presetCard).toContain('<Button');
    expect(presetCard).toContain('<Badge variant={badgeVariant}');
    expect(presetCard).not.toContain('ds-card');
    expect(presetCard).not.toContain('ds-badge-success');
    expect(presetCard).not.toContain('ds-btn');
    expect(presetCard).not.toContain('ds-text-btn-delete');
    expect(presetCard).not.toContain('opacity-0');
    expect(presetForm).toContain("from '@/components/ui/button'");
    expect(presetForm).toContain('<Button');
    expect(presetForm).toContain('TextField');
    expect(presetForm).toContain('TextAreaField');
    expect(presetForm).not.toContain('<input');
    expect(presetForm).not.toContain('<textarea');
    expect(presetForm).not.toContain('ds-btn');
    expect(presetPage).toContain("from '@/components/ui/button'");
    expect(presetPage).toContain("from '@/components/ui/card'");
    expect(presetPage).toContain("from '@/components/ui/badge'");
    expect(presetPage).toContain("from '@/components/ui/skeleton'");
    expect(presetPage).toContain("from 'lucide-react'");
    expect(presetPage).toContain('data-icon="inline-start"');
    expect(presetPage).toContain('ds-preset-form-shell');
    expect(presetPage).not.toContain('animate-slide-down');
    expect(presetPage).not.toContain('ds-btn');
    expect(presetPage).not.toContain('<svg');
    expect(presetPage).toContain('function PresetStatusCard');
    expect(presetPage).toContain('<CardHeader>');
    expect(presetPage).toContain('<CardContent>');
    expect(presetPage).toContain('<CardFooter');
    expect(presetPage).toContain('<CardAction>');
    expect(presetPage).toContain('<Badge variant={badgeVariant}>');
    expect(presetPage).toContain('<Skeleton');
    expect(presetPage).toContain('<Button');
    expect(css).toContain('.ds-preset-status-card');
    expect(css).toContain(".ds-preset-status-card [data-slot='card-header']");
    expect(css).toContain(".ds-preset-status-card [data-slot='badge']");
    expect(activeRowBlock).not.toContain('inset 2px 0');
    expect(rowBadgeBlock).toContain('min-height: 18px');
  });

  it('creates Presets through shared shadcn form fields and empty state', async () => {
    const saveMessages: Array<{ type?: string; payload?: unknown }> = [];
    stubEnglishChrome({
      runtimeMessages: {
        GET_PRESETS: [],
        GET_ACTIVE_PRESET: null,
        SAVE_PRESET: (message: { type?: string; payload?: unknown }) => {
          saveMessages.push(message);
          return { ok: true };
        },
      },
    });
    await renderWithI18n(React.createElement(PresetPage));
    await flushPolishApp();

    expect(container.textContent).toContain('No presets');
    const statusCard = container.querySelector<HTMLElement>('.ds-preset-status-card[data-slot="card"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.getAttribute('data-state')).toBe('empty');
    expect(statusCard?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent).toBe('No presets');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('0 saved');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Create reusable instructions, then choose one to apply.');
    expect(statusCard?.querySelector('[data-slot="card-footer"] button')?.textContent).toBe('New');
    expect(container.querySelector('[data-slot="empty"]')).toBeTruthy();

    const newButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'New');
    expect(newButton).toBeTruthy();
    await act(async () => {
      newButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const nameInput = container.querySelector('input[placeholder="Code assistant"]') as HTMLInputElement | null;
    const contentInput = container.querySelector('textarea[placeholder="Write the instructions this preset should apply to new chats."]') as HTMLTextAreaElement | null;
    expect(nameInput).toBeTruthy();
    expect(contentInput).toBeTruthy();
    expect(nameInput?.getAttribute('data-slot')).toBe('input');
    expect(contentInput?.getAttribute('data-slot')).toBe('textarea');
    expect(container.querySelector('.ds-preset-form [data-slot="button"]')).toBeTruthy();
    expect(nameInput?.closest('[data-slot="field"]')).toBeTruthy();
    expect(contentInput?.closest('[data-slot="field"]')).toBeTruthy();
    expect(container.querySelector(`label[for="${nameInput?.id}"]`)?.textContent).toBe('Name');
    expect(container.querySelector(`label[for="${contentInput?.id}"]`)?.textContent).toBe('Instructions');

    await setInputValue(nameInput!, 'Risk reviewer');
    await setInputValue(contentInput!, 'Find P1/P2 issues first.');

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save');
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    expect(saveMessages).toHaveLength(1);
    expect(saveMessages[0].type).toBe('SAVE_PRESET');
    expect(saveMessages[0].payload).toMatchObject({
      name: 'Risk reviewer',
      content: 'Find P1/P2 issues first.',
    });
    expect(typeof (saveMessages[0].payload as { id?: unknown }).id).toBe('string');

    const presetPage = readFileSync('entrypoints/sidepanel/pages/PresetPage.tsx', 'utf8');
    expect(presetPage).toContain('EmptyState');
    expect(presetPage).not.toContain('<svg');
  });

  it('surfaces retryable Presets load failure instead of a false empty state', async () => {
    const recoveredPreset = {
      id: 'preset-recovered',
      name: 'Code reviewer',
      content: 'Check risks before style.',
      createdAt: 1,
      updatedAt: 1,
    };
    let presetLoads = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_PRESETS: () => {
          presetLoads += 1;
          if (presetLoads === 1) throw new Error('preset store offline');
          return [recoveredPreset];
        },
        GET_ACTIVE_PRESET: recoveredPreset,
      },
    });

    await renderWithI18n(React.createElement(PresetPage));
    await flushPolishApp();

    let bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Presets unavailable');
    expect(bodyText).toContain('Presets could not load: preset store offline');
    expect(bodyText).toContain('Retry before assuming no presets are configured.');
    expect(bodyText).toContain('Retry preset library before assuming it is empty.');
    expect(bodyText).not.toContain('No presets');
    expect(bodyText).not.toContain('Create reusable instructions, then choose one to apply to new chats.');
    const statusCard = container.querySelector<HTMLElement>('.ds-preset-status-card[data-slot="card"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.getAttribute('data-state')).toBe('attention');
    expect(statusCard?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent).toBe('Needs refresh');
    const retryButtons = Array.from(container.querySelectorAll('button')).filter((button) => button.textContent === 'Retry');
    expect(retryButtons).toHaveLength(1);

    const retryButton = retryButtons[0];
    expect(retryButton).toBeTruthy();
    await act(async () => {
      retryButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(presetLoads).toBe(2);
    expect(bodyText).toContain('Using Code reviewer');
    expect(bodyText).toContain('Code reviewer');
    expect(bodyText).not.toContain('Presets unavailable');
    expect(bodyText).not.toContain('preset store offline');
  });

  it('sanitizes raw Presets load failures without showing a false empty state', async () => {
    const recoveredPreset = {
      id: 'preset-recovered-raw',
      name: 'Risk reviewer',
      content: 'Find P1/P2 issues first.',
      createdAt: 1,
      updatedAt: 1,
    };
    let presetLoads = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_PRESETS: () => {
          presetLoads += 1;
          if (presetLoads === 1) {
            return {
              ok: false,
              error: { message: 'GET_PRESETS schemaVersion chrome.storage deepseek_pp_presets token secret [object Object]' },
            };
          }
          return [recoveredPreset];
        },
        GET_ACTIVE_PRESET: recoveredPreset,
      },
    });

    await renderWithI18n(React.createElement(PresetPage));
    await flushPolishApp();

    let bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Presets unavailable');
    expect(bodyText).toContain('Presets could not load: Preset backend is unavailable. Reload the extension and try again.');
    expect(bodyText).toContain('Retry before assuming no presets are configured.');
    expect(bodyText).toContain('Retry preset library before assuming it is empty.');
    expect(bodyText).not.toContain('No presets');
    expect(bodyText).not.toContain('GET_PRESETS');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('deepseek_pp_presets');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');
    expect(container.querySelector<HTMLElement>('.ds-preset-status-card')?.getAttribute('data-state')).toBe('attention');

    const retryButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Retry');
    expect(retryButton).toBeTruthy();
    await act(async () => {
      retryButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(presetLoads).toBe(2);
    expect(bodyText).toContain('Using Risk reviewer');
    expect(bodyText).toContain('Risk reviewer');
    expect(bodyText).not.toContain('Presets unavailable');
  });

  it('keeps Preset rows visible when active selection cannot load', async () => {
    const preset = {
      id: 'preset-known-row',
      name: 'Research voice',
      content: 'Be concise and cite evidence.',
      createdAt: 1,
      updatedAt: 1,
    };
    let activeLoads = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_PRESETS: [preset],
        GET_ACTIVE_PRESET: () => {
          activeLoads += 1;
          if (activeLoads === 1) return { ok: false, error: { message: 'active preset offline' } };
          return preset;
        },
      },
    });

    await renderWithI18n(React.createElement(PresetPage));
    await flushPolishApp();

    let bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Preset selection needs refresh');
    expect(bodyText).toContain('Preset selection unavailable');
    expect(bodyText).toContain('Preset selection could not load: active preset offline');
    expect(bodyText).toContain('Research voice');
    expect(bodyText).toContain('Needs refresh');
    expect(bodyText).toContain('Retry selection before trusting the current state.');
    expect(bodyText).not.toContain('No presets');
    const statusCard = container.querySelector<HTMLElement>('.ds-preset-status-card[data-slot="card"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.getAttribute('data-state')).toBe('attention');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('1 saved');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Needs refresh');
    const retryButtons = Array.from(container.querySelectorAll('button')).filter((button) => button.textContent === 'Retry');
    expect(retryButtons).toHaveLength(1);

    const retryButton = retryButtons[0];
    expect(retryButton).toBeTruthy();
    await act(async () => {
      retryButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(activeLoads).toBe(2);
    expect(bodyText).toContain('Using Research voice');
    expect(bodyText).not.toContain('Preset selection unavailable');
    expect(bodyText).not.toContain('Needs refresh');
  });

  it('preserves Preset rows and forms when runtime actions fail', async () => {
    const preset = {
      id: 'preset-action',
      name: 'Writing coach',
      content: 'Tighten structure and remove filler.',
      createdAt: 1,
      updatedAt: 1,
    };
    stubEnglishChrome({
      runtimeMessages: {
        GET_PRESETS: [preset],
        GET_ACTIVE_PRESET: null,
        SET_ACTIVE_PRESET: () => ({ ok: false, error: { message: 'write offline' } }),
        SAVE_PRESET: () => ({ ok: false, error: { message: 'save offline' } }),
      },
    });

    await renderWithI18n(React.createElement(PresetPage));
    await flushPolishApp();

    const useButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Use');
    expect(useButton).toBeTruthy();
    await act(async () => {
      useButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    let bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Preset action failed: write offline');
    expect(bodyText).toContain('Writing coach');
    expect(bodyText).toContain('Available');
    expect(bodyText).not.toContain('Using Writing coach');

    const newButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'New');
    expect(newButton).toBeTruthy();
    await act(async () => {
      newButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const nameInput = container.querySelector('input[placeholder="Code assistant"]') as HTMLInputElement | null;
    const contentInput = container.querySelector('textarea[placeholder="Write the instructions this preset should apply to new chats."]') as HTMLTextAreaElement | null;
    expect(nameInput).toBeTruthy();
    expect(contentInput).toBeTruthy();
    await setInputValue(nameInput!, 'Risk reviewer');
    await setInputValue(contentInput!, 'Find P1/P2 issues first.');

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save');
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Preset action failed: save offline');
    expect(container.textContent).toContain('New preset');
    expect(nameInput!.value).toBe('Risk reviewer');
    expect(contentInput!.value).toBe('Find P1/P2 issues first.');
  });

  it('sanitizes raw Preset action failures while preserving rows and forms', async () => {
    const preset = {
      id: 'preset-action-raw',
      name: 'Privacy reviewer',
      content: 'Check for leaks before polish.',
      createdAt: 1,
      updatedAt: 1,
    };
    stubEnglishChrome({
      runtimeMessages: {
        GET_PRESETS: [preset],
        GET_ACTIVE_PRESET: null,
        SET_ACTIVE_PRESET: () => ({
          ok: false,
          error: { message: 'SET_ACTIVE_PRESET schemaVersion chrome.storage deepseek_pp_presets token secret [object Object]' },
        }),
        SAVE_PRESET: () => ({
          ok: false,
          error: { message: 'SAVE_PRESET Authorization Bearer sk-preset-secret apiKey token' },
        }),
      },
    });

    await renderWithI18n(React.createElement(PresetPage));
    await flushPolishApp();

    const useButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Use');
    expect(useButton).toBeTruthy();
    await act(async () => {
      useButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    let bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Preset action failed: Preset backend is unavailable. Reload the extension and try again.');
    expect(bodyText).toContain('Privacy reviewer');
    expect(bodyText).toContain('Available');
    expect(bodyText).not.toContain('Using Privacy reviewer');
    expect(bodyText).not.toContain('SET_ACTIVE_PRESET');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('deepseek_pp_presets');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');

    const newButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'New');
    expect(newButton).toBeTruthy();
    await act(async () => {
      newButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const nameInput = container.querySelector('input[placeholder="Code assistant"]') as HTMLInputElement | null;
    const contentInput = container.querySelector('textarea[placeholder="Write the instructions this preset should apply to new chats."]') as HTMLTextAreaElement | null;
    expect(nameInput).toBeTruthy();
    expect(contentInput).toBeTruthy();
    await setInputValue(nameInput!, 'Raw reviewer');
    await setInputValue(contentInput!, 'Keep user-facing copy clean.');

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save');
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Preset action failed: Preset backend is unavailable. Reload the extension and try again.');
    expect(container.textContent).toContain('New preset');
    expect(nameInput!.value).toBe('Raw reviewer');
    expect(contentInput!.value).toBe('Keep user-facing copy clean.');
    expect(bodyText).not.toContain('SAVE_PRESET');
    expect(bodyText).not.toContain('Authorization');
    expect(bodyText).not.toContain('Bearer');
    expect(bodyText).not.toContain('sk-preset-secret');
    expect(bodyText).not.toContain('apiKey');
    expect(bodyText).not.toContain('token');
  });

  it('presents Memory as thin rows with explicit text actions', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        GET_MEMORIES: [
          {
            id: 1,
            type: 'user',
            name: 'Tone preference',
            content: 'Be direct, avoid filler, and show evidence before claims.',
            description: 'Tone preference',
            tags: ['style', 'review'],
            pinned: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      },
    });
    await renderWithI18n(React.createElement(MemoryPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Memory');
    const statusCard = container.querySelector<HTMLElement>('.ds-library-status-card[data-slot="card"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.getAttribute('data-state')).toBe('ready');
    expect(statusCard?.querySelector('[data-slot="card-title"]')?.textContent).toBe('Memory status');
    expect(statusCard?.querySelector('[data-slot="card-description"]')?.textContent).toBe('Memory is available for Ask, Projects, and Context.');
    expect(statusCard?.querySelector('[data-slot="badge"]')?.textContent).toBe('Ready');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('1 saved');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('1 visible');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Review, pin, edit, or delete memory entries.');
    expect(bodyText).toContain('Filter');
    expect(bodyText).toContain('Tone preference');
    expect(bodyText).toContain('Pinned');
    expect(bodyText).toContain('Unpin');
    expect(bodyText).toContain('Edit');
    expect(bodyText).toContain('Delete');
    expect(container.querySelector('.ds-library-row')).toBeTruthy();

    const newMemoryButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'New memory');
    expect(newMemoryButton).toBeTruthy();
    await act(async () => {
      newMemoryButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('Memory type');

    const memoryCard = readFileSync('entrypoints/sidepanel/components/MemoryCard.tsx', 'utf8');
    expect(memoryCard).toContain('ds-library-row');
    expect(memoryCard).not.toContain('opacity-0');
    expect(memoryCard).not.toContain('ds-card');
    expect(memoryCard).not.toContain('<svg');
    expect(memoryCard).not.toContain('animate-fade-in');
  });

  it('renders shared Memory loading and empty states through shadcn primitives', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        GET_MEMORIES: () => new Promise(() => {}),
      },
    });
    await renderWithI18n(React.createElement(MemoryPage));

    const loadingStatusCard = container.querySelector<HTMLElement>('.ds-library-status-card[data-state="checking"]');
    expect(loadingStatusCard).toBeTruthy();
    expect(loadingStatusCard?.querySelector('[data-slot="badge"]')?.textContent).toBe('Checking');
    expect(loadingStatusCard?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="skeleton"].ds-skeleton')).toHaveLength(6);
    expect(container.querySelector('.ds-empty-state')).toBeNull();

    await act(async () => {
      root?.unmount();
    });
    root = null;
    container.innerHTML = '';

    stubEnglishChrome({
      runtimeMessages: {
        GET_MEMORIES: [],
      },
    });
    await renderWithI18n(React.createElement(MemoryPage));
    await flushPolishApp();

    const empty = container.querySelector('[data-slot="empty"].ds-empty-state');
    const emptyStatusCard = container.querySelector<HTMLElement>('.ds-library-status-card[data-state="empty"]');
    expect(emptyStatusCard).toBeTruthy();
    expect(emptyStatusCard?.querySelector('[data-slot="badge"]')?.textContent).toBe('No memory');
    expect(emptyStatusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('0 saved');
    expect(emptyStatusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Add a memory or keep chatting until preferences accumulate.');
    expect(emptyStatusCard?.querySelector('[data-slot="button"]')?.textContent).toBe('New memory');
    expect(empty).toBeTruthy();
    expect(empty?.querySelector('[data-slot="empty-title"]')?.textContent).toContain('No memories yet');
    expect(empty?.querySelector('[data-slot="empty-description"]')?.textContent).toContain('durable preferences');
    expect(empty?.querySelector('[data-slot="empty-icon"]')).toBeTruthy();
    expect(container.querySelector('.ds-skeleton')).toBeNull();
  });

  it('keeps Saved items list-first and hides the create form until requested', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        GET_SAVED_ITEMS: [
          {
            id: 'saved-1',
            syncId: 'sync-1',
            kind: 'snippet',
            title: 'Review prompt',
            content: 'Summarize this thread and list risks.',
            tags: ['prompt'],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    });
    await renderWithI18n(React.createElement(SavedPage, { onInsertPrompt: vi.fn() }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Review prompt');
    const statusCard = container.querySelector<HTMLElement>('.ds-library-status-card[data-slot="card"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.getAttribute('data-state')).toBe('ready');
    expect(statusCard?.querySelector('[data-slot="card-title"]')?.textContent).toBe('Saved status');
    expect(statusCard?.querySelector('[data-slot="card-description"]')?.textContent).toBe('Saved items are available for search, insert, and export.');
    expect(statusCard?.querySelector('[data-slot="badge"]')?.textContent).toBe('Ready');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('1 saved');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('1 visible');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Search, insert into chat, or export a backup.');
    expect(container.querySelector('.ds-library-row')).toBeTruthy();
    expect(container.textContent).not.toContain('ContentPrompt snippet');
    expect(container.querySelector('textarea[placeholder="Prompt snippet, note, or reusable text"]')).toBeNull();

    const newButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'New saved item');
    expect(newButton).toBeTruthy();
    await act(async () => {
      newButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('textarea[placeholder="Prompt snippet, note, or reusable text"]')).toBeTruthy();
    expect(container.textContent).toContain('Kind');
    expect(container.textContent).toContain('Title');
    expect(container.textContent).toContain('Content');

    const savedPage = readFileSync('entrypoints/sidepanel/pages/SavedPage.tsx', 'utf8');
    const libraryStatusCard = readFileSync('entrypoints/sidepanel/components/LibraryStatusCard.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const libraryStatusBlock = getCssBlock(css, '.ds-library-status-card');
    const libraryStatusFooterBlock = getCssBlock(css, ".ds-library-status-card [data-slot='card-footer']");
    const libraryStatusRowBlock = getCssBlock(css, '.ds-library-status-row {');
    expect(savedPage).toContain('ds-library-row');
    expect(savedPage).toContain('LibraryStatusCard');
    expect(libraryStatusCard).toContain("from '@/components/ui/card'");
    expect(libraryStatusCard).toContain("from '@/components/ui/badge'");
    expect(libraryStatusCard).toContain("from '@/components/ui/button'");
    expect(libraryStatusCard).toContain("from '@/components/ui/skeleton'");
    expect(libraryStatusCard).toContain('<CardHeader>');
    expect(libraryStatusCard).toContain('<CardFooter>');
    expect(libraryStatusBlock).toContain('border-radius: var(--radius-card)');
    expect(libraryStatusFooterBlock).toContain('border-top-color: var(--ds-border)');
    expect(libraryStatusRowBlock).toContain('grid-template-columns: minmax(74px, auto) minmax(0, 1fr)');
    expect(savedPage).not.toContain('SVG_PATHS');
    expect(savedPage).not.toContain('rounded-xl');
    expect(savedPage).not.toContain('animate-slide-down');
  });

  it('presents Connectors as a user-facing surface without raw protocol or tool ids', async () => {
    const server = createConnectorServerForPolish();
    const tool = createConnectorToolForPolish(server.id);
    stubEnglishChrome({
      runtimeMessages: {
        GET_MCP_SERVERS: [server],
        GET_PLATFORM_CAPABILITIES: {
          kind: 'browser_extension',
          name: 'WebExtension',
          capabilities: { nativeMessaging: true },
        },
        GET_MCP_TOOL_CACHE: {
          serverId: server.id,
          descriptors: [tool],
          refreshedAt: 1,
          expiresAt: 2,
          health: { serverId: server.id, status: 'ready', checkedAt: 1, latencyMs: 38, toolCount: 1, error: null },
        },
        GET_TOOL_CALL_HISTORY: [createConnectorHistoryForPolish(server.id, tool.id)],
      },
    });
    await renderWithI18n(React.createElement(McpPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Connectors');
    expect(bodyText).toContain('1/1 connected · 1 actions available');
    expect(bodyText).toContain('Connector status');
    expect(bodyText).toContain('Enabled connectors have available actions and can be offered to DeepSeek.');
    expect(bodyText).toContain('1/1 enabled');
    expect(bodyText).toContain('1 available');
    expect(bodyText).toContain('Continue');
    expect(bodyText).toContain('Add connector');
    expect(bodyText).toContain('Local computer');
    expect(bodyText).toContain('Media analysis');
    expect(bodyText).toContain('Research workspace');
    expect(bodyText).toContain('Connected');
    expect(bodyText).toContain('Web service · 1/1 available');
    expect(bodyText).toContain('Connection');
    expect(bodyText).toContain('https://research.example');
    expect(bodyText).toContain('Use in DeepSeek');
    expect(bodyText).toContain('Available actions');
    expect(bodyText).toContain('Search workspace');
    expect(bodyText).not.toContain('MCP');
    expect(bodyText).not.toContain('Streamable HTTP');
    expect(bodyText).not.toContain('SSE');
    expect(bodyText).not.toContain('Native Messaging');
    expect(bodyText).not.toContain('research_search');
    expect(bodyText).not.toContain('mcp_research_search');
    expect(bodyText).not.toContain('Params:');
    expect(bodyText).not.toContain('Inputs:');

    const connectorStatus = container.querySelector('.ds-connector-status');
    expect(connectorStatus?.getAttribute('data-slot')).toBe('card');
    expect(connectorStatus?.getAttribute('data-size')).toBe('sm');
    expect(connectorStatus?.querySelector('[data-slot="card-header"]')).toBeTruthy();
    expect(connectorStatus?.querySelector('[data-slot="card-title"]')?.textContent).toContain('Connector status');
    expect(connectorStatus?.querySelector('[data-slot="card-description"]')?.textContent).toContain('Enabled connectors have available actions');
    expect(connectorStatus?.querySelector('[data-slot="card-content"] .ds-connector-status-list')).toBeTruthy();
    expect(connectorStatus?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent).toContain('Ready');
    expectShadcnButton('Local computer', 'outline');
    expectShadcnButton('Add connector', 'default');
    expectShadcnButton('Edit', 'outline');
    expectShadcnButton('Delete', 'destructive');
    expectShadcnButton('Test', 'outline');
    expectShadcnButton('Refresh actions', 'outline');
    if (getButtonByText('Allow site')) {
      expectShadcnButton('Allow site', 'outline');
    }

    const recentActivityButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Recent activity')
    );
    expect(recentActivityButton).toBeTruthy();
    await act(async () => {
      recentActivityButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const historyRow = container.querySelector('.ds-connector-history-row');
    expect(historyRow?.textContent).toContain('Search workspace');
    expect(historyRow?.textContent).not.toContain('research_search');
    expect(historyRow?.textContent).not.toContain('mcp_research_search');

    const addConnectorButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Add connector');
    expect(addConnectorButton).toBeTruthy();
    await act(async () => {
      addConnectorButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(Array.from(container.querySelectorAll('input')).map((input) => input.placeholder).join(' ')).not.toMatch(/MCP|mcp/);
    expect(container.querySelector('input[placeholder="Research service"]')).toBeTruthy();
    expect(container.querySelector('input[placeholder="https://example.com/actions"]')).toBeTruthy();
    expectShadcnButton('Cancel', 'outline');
    expectShadcnButton('Save', 'default');

    const bridgeOption = Array.from(container.querySelectorAll('button[role="radio"]')).find((button) => button.textContent === 'Local bridge');
    expect(bridgeOption).toBeTruthy();
    await act(async () => {
      (bridgeOption as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('input[placeholder="http://127.0.0.1:8765/actions"]')).toBeTruthy();

    const browserHostOption = Array.from(container.querySelectorAll('button[role="radio"]')).find((button) => button.textContent === 'Browser host');
    expect(browserHostOption).toBeTruthy();
    await act(async () => {
      (browserHostOption as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('input[placeholder="com.example.connector"]')).toBeTruthy();

    const connectorPage = readFileSync('entrypoints/sidepanel/pages/McpPage.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    expect(connectorPage).toContain("from '@/components/ui/badge'");
    expect(connectorPage).toContain("from '@/components/ui/button'");
    expect(connectorPage).toContain("from '@/components/ui/card'");
    expect(connectorPage).toContain('<Card size="sm"');
    expect(connectorPage).toContain('createConnectorStatusModel');
    expect(connectorPage).toContain('getConnectorStatusBadgeVariant');
    expect(connectorPage).toContain('ds-connector-row');
    expect(connectorPage).toContain('connectionSummary');
    expect(css).toContain('.ds-connector-status');
    expect(css).toContain('.ds-connector-status-head [data-slot="card-title"]');
    expect(css).toContain('.ds-connector-status-body');
    expect(css).toContain('.ds-connector-row');
    expect(css).toContain('.ds-connector-tool-row');
    expect(JSON.stringify(localeResources.en.sidepanel.mcpPage)).not.toMatch(/MCP server|MCP config|Shell MCP|Legacy Multimodal MCP|Native Messaging/);
    expect(localeResources.en.app.sidebarV2.mcpDetail).toBe('Connected services and actions');
    expect(localeResources.en.app.sidebarV2.mcpDetail).not.toMatch(/MCP|server/i);
    expect(JSON.stringify(localeResources.en.sidepanel.localSkillImport)).not.toContain('Shell MCP');
    expect(JSON.stringify(localeResources['zh-CN'].sidepanel.localSkillImport)).not.toContain('Shell MCP');
    expect(readFileSync('entrypoints/sidepanel/components/LocalSkillImportPanel.tsx', 'utf8')).not.toContain('Shell MCP');
  });

  it('sanitizes connector errors before rendering them in the primary UI', async () => {
    const server = { ...createConnectorServerForPolish(), status: 'error', lastError: 'mcp_network_error: failed to fetch /mcp' };
    stubEnglishChrome({
      runtimeMessages: {
        GET_MCP_SERVERS: [server],
        GET_PLATFORM_CAPABILITIES: {
          kind: 'browser_extension',
          name: 'WebExtension',
          capabilities: { nativeMessaging: true },
        },
        GET_MCP_TOOL_CACHE: {
          serverId: server.id,
          descriptors: [],
          refreshedAt: 1,
          expiresAt: 2,
          health: {
            serverId: server.id,
            status: 'error',
            checkedAt: 1,
            latencyMs: null,
            toolCount: 0,
            error: 'mcp_network_error: failed to fetch http://127.0.0.1:8765/mcp',
          },
        },
        GET_TOOL_CALL_HISTORY: [],
      },
    });
    await renderWithI18n(React.createElement(McpPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Connection failed');
    expect(container.textContent).not.toContain('mcp_network_error');
    expect(container.textContent).not.toContain('/mcp');
  });

  it('sanitizes connector action failures after test actions', async () => {
    const server = createConnectorServerForPolish();
    const tool = createConnectorToolForPolish(server.id);
    let tested = false;
    const readyCache = {
      serverId: server.id,
      descriptors: [tool],
      refreshedAt: 1,
      expiresAt: 2,
      health: { serverId: server.id, status: 'ready', checkedAt: 1, latencyMs: 38, toolCount: 1, error: null },
    };
    const failedCache = {
      ...readyCache,
      health: {
        serverId: server.id,
        status: 'error',
        checkedAt: 3,
        latencyMs: null,
        toolCount: 0,
        error: 'GET_MCP_SERVER_CONNECTION mcp_network_error: failed to fetch http://127.0.0.1:8765/mcp',
      },
    };
    stubEnglishChrome({
      runtimeMessages: {
        GET_MCP_SERVERS: [server],
        GET_PLATFORM_CAPABILITIES: {
          kind: 'browser_extension',
          name: 'WebExtension',
          capabilities: { nativeMessaging: true },
        },
        GET_MCP_TOOL_CACHE: () => tested ? failedCache : readyCache,
        TEST_MCP_SERVER_CONNECTION: () => {
          tested = true;
          return { cache: failedCache };
        },
        GET_TOOL_CALL_HISTORY: [],
      },
    });
    await renderWithI18n(React.createElement(McpPage));
    await flushPolishApp();

    const testButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Test') as HTMLButtonElement | undefined;
    expect(testButton).toBeTruthy();
    await act(async () => {
      testButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    expect(tested).toBe(true);
    expect(container.textContent).toContain('Connection failed');
    expect(container.textContent).not.toContain('GET_MCP_SERVER_CONNECTION');
    expect(container.textContent).not.toContain('mcp_network_error');
    expect(container.textContent).not.toContain('/mcp');
    expect(container.textContent).not.toContain('http://127.0.0.1:8765');
  });

  it('shows retryable connector list failures instead of a false empty state', async () => {
    const server = createConnectorServerForPolish();
    const tool = createConnectorToolForPolish(server.id);
    let recovered = false;
    stubEnglishChrome({
      runtimeMessages: {
        GET_MCP_SERVERS: () => {
          if (!recovered) throw new Error('connector list offline');
          return [server];
        },
        GET_PLATFORM_CAPABILITIES: {
          kind: 'browser_extension',
          name: 'WebExtension',
          capabilities: { nativeMessaging: true },
        },
        GET_MCP_TOOL_CACHE: {
          serverId: server.id,
          descriptors: [tool],
          refreshedAt: 1,
          expiresAt: 2,
          health: { serverId: server.id, status: 'ready', checkedAt: 1, latencyMs: 38, toolCount: 1, error: null },
        },
        GET_TOOL_CALL_HISTORY: [],
      },
    });

    await renderWithI18n(React.createElement(McpPage));
    await flushPolishApp();

    expect(container.textContent).toContain('Connectors need refresh');
    expect(container.textContent).toContain('Connector status');
    expect(container.textContent).toContain('Connector list could not load. Retry before adding or assuming none are configured.');
    expect(container.textContent).toContain('Retry connector data');
    expect(container.textContent).toContain('Connector list');
    expect(container.textContent).toContain('connector list offline');
    expect(container.textContent).not.toContain('No connectors yet');
    expect(container.querySelector('.ds-connector-status-blocked')).toBeTruthy();
    expect(container.querySelector('.ds-connector-status [data-slot="button"]')?.textContent).toBe('Retry');

    recovered = true;
    const retry = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Retry') as HTMLButtonElement | undefined;
    expect(retry).toBeTruthy();
    await act(async () => {
      retry!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    expect(container.textContent).toContain('Research workspace');
    expect(container.textContent).toContain('Ready');
    expect(container.textContent).toContain('Connected');
    expect(container.textContent).not.toContain('Connectors need refresh');
    expect(container.textContent).not.toContain('connector list offline');
  });

  it('keeps connector rows visible when action details need refresh', async () => {
    const server = createConnectorServerForPolish();
    const tool = createConnectorToolForPolish(server.id);
    let recovered = false;
    stubEnglishChrome({
      runtimeMessages: {
        GET_MCP_SERVERS: [server],
        GET_PLATFORM_CAPABILITIES: {
          kind: 'browser_extension',
          name: 'WebExtension',
          capabilities: { nativeMessaging: true },
        },
        GET_MCP_TOOL_CACHE: () => {
          if (!recovered) return { ok: false, error: 'GET_MCP_TOOL_CACHE mcp cache offline' };
          return {
            serverId: server.id,
            descriptors: [tool],
            refreshedAt: 1,
            expiresAt: 2,
            health: { serverId: server.id, status: 'ready', checkedAt: 1, latencyMs: 38, toolCount: 1, error: null },
          };
        },
        GET_TOOL_CALL_HISTORY: [],
      },
    });

    await renderWithI18n(React.createElement(McpPage));
    await flushPolishApp();

    let bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Connectors need refresh');
    expect(bodyText).toContain('Connector status');
    expect(bodyText).toContain('Some connector data did not load. Retry before trusting available actions.');
    expect(bodyText).toContain('Retry connector data');
    expect(bodyText).toContain('Research workspace actions');
    expect(bodyText).toContain('Actions could not load');
    expect(bodyText).toContain('Research workspace');
    expect(bodyText).not.toContain('No connectors yet');
    expect(bodyText).not.toContain('GET_MCP_TOOL_CACHE');
    expect(bodyText).not.toContain('mcp cache offline');
    expect(bodyText).not.toContain('MCP');
    expect(bodyText).not.toContain('/mcp');
    expect(container.querySelector('.ds-connector-status-attention')).toBeTruthy();
    expect(container.querySelector('.ds-connector-status [data-slot="button"]')?.textContent).toBe('Retry');

    recovered = true;
    const retry = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Retry') as HTMLButtonElement | undefined;
    expect(retry).toBeTruthy();
    await act(async () => {
      retry!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Ready');
    expect(bodyText).toContain('Connected');
    expect(bodyText).toContain('Search workspace');
    expect(bodyText).not.toContain('Connectors need refresh');
    expect(bodyText).not.toContain('Actions could not load');
  });

  it('uses friendly built-in connector names in edit and delete flows', async () => {
    const server = createLegacyMediaConnectorForPolish();
    stubEnglishChrome({
      runtimeMessages: {
        GET_MCP_SERVERS: [server],
        GET_PLATFORM_CAPABILITIES: {
          kind: 'browser_extension',
          name: 'WebExtension',
          capabilities: { nativeMessaging: true },
        },
        GET_MCP_TOOL_CACHE: {
          serverId: server.id,
          descriptors: [],
          refreshedAt: 1,
          expiresAt: 2,
          health: { serverId: server.id, status: 'ready', checkedAt: 1, latencyMs: 12, toolCount: 0, error: null },
        },
        GET_TOOL_CALL_HISTORY: [],
      },
    });
    await renderWithI18n(React.createElement(McpPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Media analysis');
    expect(container.textContent).toContain('Needs actions');
    expect(container.textContent).toContain('Refresh or test a connector so actions can be discovered.');
    expect(container.textContent).not.toContain('Legacy Multimodal MCP');

    const editButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Edit') as HTMLButtonElement | undefined;
    expect(editButton).toBeTruthy();
    expect(editButton?.getAttribute('data-slot')).toBe('button');
    expect(editButton?.getAttribute('data-variant')).toBe('outline');
    await act(async () => {
      editButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const nameInput = container.querySelector('input') as HTMLInputElement | null;
    expect(nameInput?.value).toBe('Media analysis');
    expect(nameInput?.value).not.toBe('Legacy Multimodal MCP');

    const deleteButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Delete') as HTMLButtonElement | undefined;
    expect(deleteButton).toBeTruthy();
    expect(deleteButton?.getAttribute('data-slot')).toBe('button');
    expect(deleteButton?.getAttribute('data-variant')).toBe('destructive');
    await act(async () => {
      deleteButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain('Delete connector "Media analysis"?');
    expect(container.textContent).not.toContain('Legacy Multimodal MCP');
  });

  it('keeps Browser system controls organized and free of primary implementation jargon', async () => {
    const target = {
      id: 42,
      windowId: 1,
      windowHint: null,
      groupId: -1,
      active: true,
      currentWindow: true,
      title: 'Planning doc',
      url: 'https://docs.google.com/document/d/abc',
      controllable: true,
    };
    const blockedTarget = {
      id: 43,
      windowId: 1,
      windowHint: null,
      groupId: -1,
      active: false,
      currentWindow: false,
      title: 'DeepSeek++',
      url: 'chrome-extension://abc/sidepanel.html',
      controllable: false,
      reason: 'Unsupported URL scheme for browser control: chrome-extension',
    };
    const availableTarget = {
      id: 44,
      windowId: 1,
      windowHint: null,
      groupId: -1,
      active: false,
      currentWindow: false,
      title: 'Example',
      url: 'https://example.com',
      controllable: true,
    };
    stubEnglishChrome({
      runtimeMessages: {
        GET_BROWSER_CONTROL_SETTINGS: {
          enabled: true,
          targetTabId: 42,
          lastTargetHint: null,
          targetLock: {
            enabled: true,
            label: 'Planning doc',
            targetTabId: 42,
            windowId: 1,
            windowHint: null,
            groupId: null,
            origin: 'https://docs.google.com',
            updatedAt: 1,
          },
          includeSnapshotAfterActions: false,
          allowVisionCapture: true,
          verifyAfterActions: true,
          collectEvidencePacks: true,
          debugDistillerEnabled: true,
          maxSnapshotNodes: 400,
          maxSnapshotTextBytes: 24000,
        },
        GET_BROWSER_CONTROL_STATE: {
          supported: true,
          enabled: true,
          attached: false,
          targetTabId: 42,
          target,
          targets: [target, availableTarget, blockedTarget],
          error: null,
        },
      },
    });
    await renderWithI18n(React.createElement(BrowserControlPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Connection');
    expect(container.textContent).toContain('Browser status');
    expect(container.textContent).toContain('Ready');
    expect(container.textContent).toContain('Capture and checks on');
    expect(container.textContent).toContain('Continue');
    expect(container.textContent).toContain('Target tab');
    expect(container.textContent).toContain('Visual review');
    expect(container.textContent).toContain('Snapshot budget');
    expect(container.textContent).toContain('Enabled');
    expect(container.textContent).toContain('Not attached');
    expect(container.textContent).toContain('Target memory');
    expect(container.textContent).toContain('Planning doc');
    expect(container.textContent).toContain('https://docs.google.com');
    expect(container.textContent).toContain('Selected');
    expect(container.textContent).toContain('Available');
    expect(container.textContent).toContain('Unavailable');
    expect(container.textContent).toContain('Browser-internal page');
    expect(container.textContent).toContain('Max page items');
    expect(container.querySelector('.ds-browser-status-list')).toBeTruthy();
    const readinessPanel = container.querySelector('.ds-browser-readiness');
    expect(readinessPanel?.getAttribute('data-slot')).toBe('card');
    expect(readinessPanel?.getAttribute('data-size')).toBe('sm');
    expect(readinessPanel?.querySelector('[data-slot="card-header"]')).toBeTruthy();
    expect(readinessPanel?.querySelector('[data-slot="card-title"]')?.textContent).toContain('Browser status');
    expect(readinessPanel?.querySelector('[data-slot="card-description"]')?.textContent).toContain('A target is selected and visual checks are ready for browser work.');
    expect(readinessPanel?.querySelector('[data-slot="card-content"] .ds-browser-status-list')).toBeTruthy();
    expect(readinessPanel?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent).toContain('Ready');
    const browserActionButtons = Array.from(container.querySelectorAll('[data-slot="button"]'))
      .map((button) => button.textContent?.trim());
    expect(browserActionButtons).toContain('Refresh');
    expect(browserActionButtons).toContain('Detach');
    expect(browserActionButtons).toContain('Lock target');
    expect(browserActionButtons).toContain('Clear lock');
    const advanced = container.querySelector('.ds-browser-advanced') as HTMLDetailsElement | null;
    expect(advanced).toBeTruthy();
    expect(advanced?.open).toBe(false);
    const advancedSummary = advanced?.querySelector('summary') as HTMLElement | null;
    await act(async () => {
      advancedSummary?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(advanced?.open).toBe(true);
    expect(container.textContent).not.toContain('browser_*');
    expect(container.textContent).not.toContain('Accessibility Tree');
    expect(container.textContent).not.toContain('AX nodes');
    expect(container.textContent).not.toContain('Dev++');
    expect(container.textContent).not.toContain('Unsupported URL scheme');
    expect(container.textContent).not.toContain('#43');
    expect(container.textContent).not.toContain('#44');

    const browserPage = readFileSync('entrypoints/sidepanel/pages/BrowserControlPage.tsx', 'utf8');
    expect(browserPage).toContain("from '@/components/ui/badge'");
    expect(browserPage).toContain("from '@/components/ui/button'");
    expect(browserPage).toContain("from '@/components/ui/card'");
    expect(browserPage).toContain('<Card size="sm"');
    expect(browserPage).toContain('CardAction');
    expect(browserPage).toContain('getBrowserReadinessBadgeVariant');
    expect(browserPage).not.toContain('React.ComponentProps');
    expect(browserPage).toContain('SettingsSection');
    expect(browserPage).toContain('ds-browser-status-list');
    expect(browserPage).toContain('ds-browser-advanced');
    expect(browserPage).not.toContain('Meta');
    expect(browserPage).not.toContain('grid grid-cols-3 gap-2');
    expect(browserPage).not.toContain('targetSelected\', { id: target.id }');

    const browserCss = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    expect(browserCss).toContain('.ds-browser-readiness');
    expect(browserCss).toContain('.ds-browser-readiness-head [data-slot="card-title"]');
    expect(browserCss).toContain('.ds-browser-readiness-body');
    expect(browserCss).toContain('border-top: 0');
    expect(browserCss).toContain('.ds-browser-target-row:not(:disabled):focus-visible');
    expect(browserCss).toContain('.ds-btn-secondary:focus-visible');
    expect(browserCss).toContain('0 0 0 3px var(--ds-blue-glow)');
    expect(browserCss).toContain('.ds-browser-advanced summary::after');
  });

  it('uses Browser readiness to guide missing target setup without fake evidence', async () => {
    const blockedTarget = {
      id: 43,
      windowId: 1,
      windowHint: null,
      groupId: -1,
      active: false,
      currentWindow: false,
      title: 'DeepSeek++',
      url: 'chrome-extension://internal',
      controllable: false,
      reason: 'Browser-internal page',
    };
    const availableTarget = {
      id: 44,
      windowId: 1,
      windowHint: null,
      groupId: -1,
      active: false,
      currentWindow: false,
      title: 'Example',
      url: 'https://example.com',
      controllable: true,
    };
    stubEnglishChrome({
      runtimeMessages: {
        GET_BROWSER_CONTROL_SETTINGS: {
          enabled: true,
          targetTabId: null,
          lastTargetHint: null,
          targetLock: null,
          includeSnapshotAfterActions: false,
          allowVisionCapture: true,
          verifyAfterActions: true,
          collectEvidencePacks: true,
          debugDistillerEnabled: true,
          maxSnapshotNodes: 400,
          maxSnapshotTextBytes: 24000,
        },
        GET_BROWSER_CONTROL_STATE: {
          supported: true,
          enabled: true,
          attached: false,
          targetTabId: null,
          target: null,
          targets: [blockedTarget, availableTarget],
          error: null,
        },
      },
    });
    await renderWithI18n(React.createElement(BrowserControlPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Browser status');
    expect(container.textContent).toContain('Needs target');
    expect(container.textContent).toContain('Choose a regular web page before relying on browser context.');
    expect(container.textContent).toContain('Capture and checks on');
    expect(container.textContent).not.toContain('Ready');

    const chooseButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Choose target') as HTMLButtonElement | undefined;
    expect(chooseButton).toBeTruthy();
    expect(chooseButton?.getAttribute('data-slot')).toBe('button');
    await act(async () => {
      chooseButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.activeElement?.textContent).toContain('Example');
  });

  it('shows a retryable Browser status load error instead of pretending the browser is unsupported', async () => {
    const target = {
      id: 44,
      windowId: 1,
      windowHint: null,
      groupId: -1,
      active: true,
      currentWindow: true,
      title: 'Example',
      url: 'https://example.com',
      controllable: true,
    };
    let stateLoads = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_BROWSER_CONTROL_SETTINGS: {
          enabled: true,
          targetTabId: 44,
          lastTargetHint: null,
          targetLock: null,
          includeSnapshotAfterActions: false,
          allowVisionCapture: true,
          verifyAfterActions: true,
          collectEvidencePacks: true,
          debugDistillerEnabled: true,
          maxSnapshotNodes: 400,
          maxSnapshotTextBytes: 24000,
        },
        GET_BROWSER_CONTROL_STATE: () => {
          stateLoads += 1;
          if (stateLoads === 1) throw new Error('tab query failed');
          return {
            supported: true,
            enabled: true,
            attached: false,
            targetTabId: 44,
            target,
            targets: [target],
            error: null,
          };
        },
      },
    });
    await renderWithI18n(React.createElement(BrowserControlPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Needs refresh');
    expect(container.textContent).toContain('Browser target status could not load.');
    expect(container.textContent).toContain('Browser status could not load: tab query failed');
    expect(container.textContent).toContain('Retry browser status');
    expect(container.textContent).toContain('Refresh browser status before changing browser tools.');
    expect(container.textContent).toContain('Refresh browser status to list target tabs.');
    expect(container.textContent).not.toContain('Use a supported browser context');
    expect(container.textContent).not.toContain('Browser actions are unavailable in this browser context.');
    expect(container.textContent).not.toContain('No browser tabs found.');
    expect(container.textContent).not.toContain('GET_BROWSER_CONTROL_STATE');

    const retryButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Retry') as HTMLButtonElement | undefined;
    expect(retryButton).toBeTruthy();
    expect(retryButton?.getAttribute('data-slot')).toBe('button');
    await act(async () => {
      retryButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(stateLoads).toBe(2);
    expect(container.textContent).toContain('Ready');
    expect(container.textContent).toContain('Example');
    expect(container.textContent).not.toContain('tab query failed');
    expect(container.textContent).not.toContain('Needs refresh');
  });

  it('classifies ok-false Browser status responses as retryable without leaking runtime names', async () => {
    const target = {
      id: 44,
      windowId: 1,
      windowHint: null,
      groupId: -1,
      active: true,
      currentWindow: true,
      title: 'Example',
      url: 'https://example.com',
      controllable: true,
    };
    let stateLoads = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_BROWSER_CONTROL_SETTINGS: {
          enabled: true,
          targetTabId: 44,
          lastTargetHint: null,
          targetLock: null,
          includeSnapshotAfterActions: false,
          allowVisionCapture: true,
          verifyAfterActions: true,
          collectEvidencePacks: true,
          debugDistillerEnabled: true,
          maxSnapshotNodes: 400,
          maxSnapshotTextBytes: 24000,
        },
        GET_BROWSER_CONTROL_STATE: () => {
          stateLoads += 1;
          if (stateLoads === 1) {
            return { ok: false, error: { message: 'GET_BROWSER_CONTROL_STATE cache unavailable' } };
          }
          return {
            supported: true,
            enabled: true,
            attached: false,
            targetTabId: 44,
            target,
            targets: [target],
            error: null,
          };
        },
      },
    });
    await renderWithI18n(React.createElement(BrowserControlPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Needs refresh');
    expect(container.textContent).toContain('Browser status could not load: Browser source did not return usable data.');
    expect(container.textContent).toContain('Retry browser status');
    expect(container.textContent).toContain('Refresh browser status to list target tabs.');
    expect(container.textContent).not.toContain('GET_BROWSER_CONTROL_STATE');
    expect(container.textContent).not.toContain('cache unavailable');
    expect(container.textContent).not.toContain('Browser actions are unavailable in this browser context.');
    expect(container.textContent).not.toContain('No browser tabs found.');

    const retryButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Retry') as HTMLButtonElement | undefined;
    expect(retryButton).toBeTruthy();
    expect(retryButton?.getAttribute('data-slot')).toBe('button');
    await act(async () => {
      retryButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(stateLoads).toBe(2);
    expect(container.textContent).toContain('Ready');
    expect(container.textContent).toContain('Example');
    expect(container.textContent).not.toContain('Browser source did not return usable data.');
    expect(container.textContent).not.toContain('Needs refresh');
  });

  it('keeps Browser target controls disabled until partial load failures are refreshed', async () => {
    const target = {
      id: 44,
      windowId: 1,
      windowHint: null,
      groupId: -1,
      active: true,
      currentWindow: true,
      title: 'Example',
      url: 'https://example.com',
      controllable: true,
    };
    let settingsLoads = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_BROWSER_CONTROL_SETTINGS: () => {
          settingsLoads += 1;
          if (settingsLoads === 1) throw new Error('settings unavailable');
          return {
            enabled: true,
            targetTabId: null,
            lastTargetHint: null,
            targetLock: null,
            includeSnapshotAfterActions: false,
            allowVisionCapture: true,
            verifyAfterActions: true,
            collectEvidencePacks: true,
            debugDistillerEnabled: true,
            maxSnapshotNodes: 400,
            maxSnapshotTextBytes: 24000,
          };
        },
        GET_BROWSER_CONTROL_STATE: {
          supported: true,
          enabled: true,
          attached: true,
          targetTabId: null,
          target: null,
          targets: [target],
          error: null,
        },
      },
    });
    await renderWithI18n(React.createElement(BrowserControlPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Browser status could not load: settings unavailable');
    const targetButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Example')) as HTMLButtonElement | undefined;
    expect(targetButton).toBeTruthy();
    expect(targetButton?.disabled).toBe(true);
    const detachButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Detach') as HTMLButtonElement | undefined;
    expect(detachButton?.disabled).toBe(true);

    const retryButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Retry') as HTMLButtonElement | undefined;
    expect(retryButton).toBeTruthy();
    expect(retryButton?.getAttribute('data-slot')).toBe('button');
    await act(async () => {
      retryButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(settingsLoads).toBe(2);
    expect(container.textContent).not.toContain('settings unavailable');
    expect(targetButton?.disabled).toBe(false);
  });

  it('surfaces failed Browser target actions without removing reachable targets', async () => {
    const target = {
      id: 44,
      windowId: 1,
      windowHint: null,
      groupId: -1,
      active: true,
      currentWindow: true,
      title: 'Example',
      url: 'https://example.com',
      controllable: true,
    };
    stubEnglishChrome({
      runtimeMessages: {
        GET_BROWSER_CONTROL_SETTINGS: {
          enabled: true,
          targetTabId: null,
          lastTargetHint: null,
          targetLock: null,
          includeSnapshotAfterActions: false,
          allowVisionCapture: true,
          verifyAfterActions: true,
          collectEvidencePacks: true,
          debugDistillerEnabled: true,
          maxSnapshotNodes: 400,
          maxSnapshotTextBytes: 24000,
        },
        GET_BROWSER_CONTROL_STATE: {
          supported: true,
          enabled: true,
          attached: false,
          targetTabId: null,
          target: null,
          targets: [target],
          error: null,
        },
        SET_BROWSER_CONTROL_TARGET: () => {
          throw new Error('permission denied');
        },
      },
    });
    await renderWithI18n(React.createElement(BrowserControlPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const targetButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Example')) as HTMLButtonElement | undefined;
    expect(targetButton).toBeTruthy();
    await act(async () => {
      targetButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Browser action failed: permission denied');
    expect(container.textContent).toContain('Example');
    expect(container.textContent).toContain('Available');
    expect(container.textContent).not.toContain('SET_BROWSER_CONTROL_TARGET');
  });

  it('sanitizes ok-false Browser target action failures without removing reachable targets', async () => {
    const target = {
      id: 44,
      windowId: 1,
      windowHint: null,
      groupId: -1,
      active: true,
      currentWindow: true,
      title: 'Example',
      url: 'https://example.com',
      controllable: true,
    };
    stubEnglishChrome({
      runtimeMessages: {
        GET_BROWSER_CONTROL_SETTINGS: {
          enabled: true,
          targetTabId: null,
          lastTargetHint: null,
          targetLock: null,
          includeSnapshotAfterActions: false,
          allowVisionCapture: true,
          verifyAfterActions: true,
          collectEvidencePacks: true,
          debugDistillerEnabled: true,
          maxSnapshotNodes: 400,
          maxSnapshotTextBytes: 24000,
        },
        GET_BROWSER_CONTROL_STATE: {
          supported: true,
          enabled: true,
          attached: false,
          targetTabId: null,
          target: null,
          targets: [target],
          error: null,
        },
        SET_BROWSER_CONTROL_TARGET: () => ({
          ok: false,
          error: { message: 'SET_BROWSER_CONTROL_TARGET permission denied' },
        }),
      },
    });
    await renderWithI18n(React.createElement(BrowserControlPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const targetButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Example')) as HTMLButtonElement | undefined;
    expect(targetButton).toBeTruthy();
    await act(async () => {
      targetButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Browser action failed: Failed to select target tab.');
    expect(container.textContent).toContain('Example');
    expect(container.textContent).toContain('Available');
    expect(container.textContent).not.toContain('SET_BROWSER_CONTROL_TARGET');
    expect(container.textContent).not.toContain('[object Object]');
  });

  it('uses Browser readiness actions for visual capture and action checks', async () => {
    const target = {
      id: 42,
      windowId: 1,
      windowHint: null,
      groupId: -1,
      active: true,
      currentWindow: true,
      title: 'Planning doc',
      url: 'https://docs.google.com/document/d/abc',
      controllable: true,
    };
    let settings = {
      enabled: true,
      targetTabId: 42,
      lastTargetHint: null,
      targetLock: null,
      includeSnapshotAfterActions: false,
      allowVisionCapture: false,
      verifyAfterActions: false,
      collectEvidencePacks: true,
      debugDistillerEnabled: true,
      maxSnapshotNodes: 400,
      maxSnapshotTextBytes: 24000,
    };
    const savedPatches: unknown[] = [];
    stubEnglishChrome({
      runtimeMessages: {
        GET_BROWSER_CONTROL_SETTINGS: () => settings,
        SAVE_BROWSER_CONTROL_SETTINGS: (message: { payload?: unknown }) => {
          savedPatches.push(message.payload);
          settings = { ...settings, ...(message.payload as Partial<typeof settings>) };
          return settings;
        },
        GET_BROWSER_CONTROL_STATE: {
          supported: true,
          enabled: true,
          attached: false,
          targetTabId: 42,
          target,
          targets: [target],
          error: null,
        },
      },
    });
    await renderWithI18n(React.createElement(BrowserControlPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Visual off');
    expect(container.textContent).toContain('Browser work can run, but visual evidence will not be attached.');
    const enableVisualButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Enable visual capture') as HTMLButtonElement | undefined;
    expect(enableVisualButton).toBeTruthy();
    expect(enableVisualButton?.getAttribute('data-slot')).toBe('button');
    await act(async () => {
      enableVisualButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(savedPatches).toContainEqual({ allowVisionCapture: true });
    expect(container.textContent).toContain('Checks off');
    expect(container.textContent).toContain('Capture on, checks off');

    const enableVerifyButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Enable action checks') as HTMLButtonElement | undefined;
    expect(enableVerifyButton).toBeTruthy();
    expect(enableVerifyButton?.getAttribute('data-slot')).toBe('button');
    await act(async () => {
      enableVerifyButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(savedPatches).toContainEqual({ verifyAfterActions: true });
    expect(container.textContent).toContain('Ready');
    expect(container.textContent).toContain('Capture and checks on');
  });

  it('keeps Browser readiness blocked when browser control is unsupported', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        GET_BROWSER_CONTROL_SETTINGS: {
          enabled: true,
          targetTabId: 42,
          lastTargetHint: null,
          targetLock: null,
          includeSnapshotAfterActions: false,
          allowVisionCapture: true,
          verifyAfterActions: true,
          collectEvidencePacks: true,
          debugDistillerEnabled: true,
          maxSnapshotNodes: 400,
          maxSnapshotTextBytes: 24000,
        },
        GET_BROWSER_CONTROL_STATE: {
          supported: false,
          enabled: false,
          attached: false,
          targetTabId: null,
          target: null,
          targets: [],
          error: null,
        },
      },
    });
    await renderWithI18n(React.createElement(BrowserControlPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Unavailable');
    expect(container.textContent).toContain('Browser actions are not available in this browser context.');
    expect(container.textContent).toContain('Use a supported browser context');
    expect(container.querySelector('.ds-browser-readiness-blocked')).toBeTruthy();
    expect(Array.from(container.querySelectorAll('.ds-browser-readiness button'))).toHaveLength(0);
  });

  it('keeps Health organized and free of primary implementation jargon', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        GET_RUNTIME_DOCTOR_REPORT: createRuntimeDoctorReportForPolish(),
      },
    });
    await renderWithI18n(React.createElement(RuntimeDoctorPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Health');
    expect(container.textContent).toContain('Health status');
    expect(container.textContent).toContain('Readiness');
    expect(container.textContent).toContain('Actions');
    expect(container.textContent).toContain('Connection');
    expect(container.textContent).toContain('Conversation');
    expect(container.textContent).toContain('Browser target');
    expect(container.textContent).toContain('Safety review');
    expect(container.textContent).toContain('Recovery');
    expect(container.textContent).toContain('Diagnostic details');
    expect(container.textContent).toContain('DeepSeek login');
    expect(container.textContent).toContain('Page bridge');
    expect(container.textContent).toContain('Conversation anchor');
    expect(container.textContent).toContain('Recovery hints');
    expect(container.textContent).toContain('Storage check');
    expect(container.textContent).toContain('2 DeepSeek page(s) need refresh.');
    expect(container.textContent).toContain('Storage check found 3 item(s) that need review.');
    const healthSummary = container.querySelector('.ds-health-summary');
    expect(healthSummary).toBeTruthy();
    expect(healthSummary?.querySelector('[data-slot="card-title"]')?.textContent).toContain('Health status');
    expect(healthSummary?.querySelector('[data-slot="badge"]')?.textContent).toContain('Ready');
    expect(healthSummary?.textContent).toContain('Continue');
    expect(healthSummary?.textContent).toContain('Clean');
    expect(healthSummary?.querySelector('[data-slot="button"]')).toBeFalsy();
    expectShadcnButton('Refresh', 'outline', 'sm');
    expectShadcnButton('Refresh login', 'outline', 'sm');
    expectShadcnButton('Repair and retry', 'outline', 'sm');
    expectShadcnButton('Refresh page bridge', 'outline', 'sm');
    expectShadcnButton('Run review', 'outline', 'sm');
    expectShadcnButton('Check readiness', 'default', 'sm');
    expect(container.textContent).not.toContain('Runtime Doctor');
    expect(container.textContent).not.toContain('Web auth');
    expect(container.textContent).not.toContain('Sidepanel session');
    expect(container.textContent).not.toContain('Browser vision loops');
    expect(container.textContent).not.toContain('Vision boundary');
    expect(container.textContent).not.toContain('Leak sentry');
    expect(container.textContent).not.toContain('Distiller');
    expect(container.textContent).not.toContain('Content scripts');
    expect(container.textContent).not.toContain('Parent message');
    expect(container.textContent).not.toContain('Same session');
    expect(container.textContent).not.toContain('Raw images');
    expect(container.textContent).not.toContain('Runtime tool descriptors');
    expect(container.textContent).not.toContain('2 DeepSeek tab(s) need a refresh.');
    expect(container.textContent).not.toContain('3 forbidden storage issue(s) found.');

    const healthPage = readFileSync('entrypoints/sidepanel/pages/RuntimeDoctorPage.tsx', 'utf8');
    const healthCss = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    expect(healthPage).toContain('createHealthStatusModel');
    expect(healthPage).toContain('CardHeader');
    expect(healthPage).toContain('ds-health-status-list');
    expect(healthPage).toContain('formatEvalCheckLabel');
    expect(healthPage).not.toContain('<button');
    expect(healthPage).not.toContain('StatusTile');
    expect(healthPage).not.toContain('StatusGrid');
    expect(healthCss).toContain('.ds-health-summary');
    expect(healthCss).toContain('.ds-health-status-row');
    expect(healthCss).toContain('border: 1px solid var(--ds-border)');
    expect(healthCss).toContain('.ds-health-actions-single');
    expect(healthCss).toContain('.ds-health-details summary:focus-visible');
    expect(healthCss).not.toContain("content: 'Show'");
    expect(healthCss).not.toContain("content: 'Hide'");
  });

  it('keeps a refresh path visible when Health cannot load a report', async () => {
    let reportCalls = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_RUNTIME_DOCTOR_REPORT: () => {
          reportCalls += 1;
          return reportCalls === 1 ? { ok: false } : createRuntimeDoctorReportForPolish();
        },
      },
    });
    await renderWithI18n(React.createElement(RuntimeDoctorPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Health could not load: The extension backend did not return a health report.');
    expect(container.textContent).toContain('Health status');
    expect(container.textContent).toContain('Needs refresh');
    expect(container.textContent).toContain('Retry health check');
    expect(container.textContent).toContain('Refresh');
    expect(container.querySelector('.ds-health-summary-blocked')).toBeTruthy();
    expect(container.querySelector('.ds-health-summary [data-slot="button"]')).toBeTruthy();
    expect(container.textContent).not.toContain('Connection');
    expect(container.textContent).not.toContain('invalid_report');

    const refreshButton = container.querySelector<HTMLButtonElement>('.ds-health-summary [data-slot="button"]');
    expect(refreshButton).toBeTruthy();
    await act(async () => {
      refreshButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Readiness');
    expect(container.textContent).toContain('Connection');
    expect(container.textContent).not.toContain('Health could not load');
  });

  it('keeps Health status action failures sanitized', async () => {
    const staleReport = {
      ...createRuntimeDoctorReportForPolish(),
      contentScripts: {
        checked: true,
        totalTabs: 2,
        healthyTabs: 0,
        staleTabs: 2,
        staleTabIds: [11, 12],
      },
      readiness: {
        ready: false,
        status: 'needs_attention',
        blockers: ['deepseek_content_script_stale'],
        lastPreparedAt: 1,
        preparing: false,
        targetStatus: 'ready',
        noLeak: true,
      },
    };
    stubEnglishChrome({
      runtimeMessages: {
        GET_RUNTIME_DOCTOR_REPORT: staleReport,
        RELOAD_STALE_DEEPSEEK_TABS: {
          ok: false,
          error: 'RELOAD_STALE_DEEPSEEK_TABS schemaVersion chrome.runtime Bearer data:image/png;base64,AAAA https://secret.example',
        },
      },
    });
    await renderWithI18n(React.createElement(RuntimeDoctorPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const statusAction = container.querySelector<HTMLButtonElement>('.ds-health-summary [data-slot="button"]');
    expect(statusAction?.textContent).toContain('Refresh page bridge');
    await act(async () => {
      statusAction?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Page bridge refresh failed: Page bridge refresh could not finish.');
    expect(container.textContent).not.toMatch(/RELOAD_STALE_DEEPSEEK_TABS|schemaVersion|chrome\.runtime|Bearer|data:image|AAAA|https:\/\/secret\.example/);
  });

  it('keeps Page tools compact and free of visible tool ids', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        GET_WEB_TOOL_SETTINGS: { web_search: true, web_fetch: false },
        GET_MCP_SERVERS: [],
        GET_PLATFORM_CAPABILITIES: {
          kind: 'browser_extension',
          name: 'WebExtension',
          capabilities: { nativeMessaging: true },
        },
      },
    });
    await renderWithI18n(React.createElement(ToolsPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Page tools');
    expect(bodyText).toContain('Tools status');
    expect(bodyText).toContain('Ready');
    expect(bodyText).toContain('Search On · Read Off');
    expect(bodyText).toContain('Use Ask; enabled tools can be attached when needed.');
    expect(bodyText).toContain('Available tools');
    expect(bodyText).toContain('Web search');
    expect(bodyText).toContain('Read page');
    expect(bodyText).toContain('Local Python');
    expect(bodyText).toContain('Set up required');
    expect(bodyText).toContain('Site access');
    expect(bodyText).toContain('Diagnostics');
    expect(bodyText).toContain('Run search test');
    expect(bodyText).toContain('On');
    expect(bodyText).toContain('Off');
    expect(bodyText).not.toContain('Tool switches');
    expect(bodyText).not.toContain('web_search');
    expect(bodyText).not.toContain('web_fetch');
    expect(bodyText).not.toContain('python_exec');
    expect(bodyText).not.toContain('Shell MCP');

    const switches = Array.from(container.querySelectorAll('[role="switch"]'));
    expect(switches.map((switchEl) => switchEl.getAttribute('aria-label'))).toEqual([
      'Web search: On',
      'Read page: Off',
      'Local Python: Off, Set up required',
    ]);
    const diagnostics = container.querySelector('.ds-tools-disclosure') as HTMLDetailsElement | null;
    expect(diagnostics).toBeTruthy();
    expect(diagnostics?.open).toBe(false);
    const statusCard = container.querySelector<HTMLElement>('.ds-tools-status-card[data-slot="card"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.getAttribute('data-state')).toBe('ready');
    expect(statusCard?.querySelector('[data-slot="card-header"]')).toBeTruthy();
    expect(statusCard?.querySelector('[data-slot="card-title"]')?.textContent).toBe('Tools status');
    expect(statusCard?.querySelector('[data-slot="card-description"]')?.textContent)
      .toContain('At least one real page tool');
    expect(statusCard?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent).toBe('Ready');
    expect(statusCard?.querySelector('[data-slot="card-content"]')).toBeTruthy();
    expect(container.querySelector('.ds-tool-list')).toBeTruthy();
    for (const label of ['Set up', 'Grant', 'Allow all sites', 'Diagnose']) {
      const action = Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === label);
      expect(action?.getAttribute('data-slot')).toBe('button');
      expect(action?.getAttribute('data-variant')).toBe('outline');
      expect(action?.getAttribute('data-size')).toBe('sm');
    }

    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const toolsPage = readFileSync('entrypoints/sidepanel/pages/ToolsPage.tsx', 'utf8');
    expect(toolsPage).toContain("from '@/components/ui/card'");
    expect(toolsPage).toContain("from '@/components/ui/badge'");
    expect(toolsPage).toContain("from '@/components/ui/button'");
    expect(toolsPage).toContain("from '@/components/ui/skeleton'");
    expect(toolsPage).toContain('<CardHeader>');
    expect(toolsPage).toContain('<CardContent>');
    expect(toolsPage).toContain('<CardAction>');
    expect(toolsPage).not.toContain('<button');
    expect(toolsPage).toContain('getSafeRuntimeIssueMessage');
    const toolListBlock = getCssBlock(css, '.ds-tool-list');
    const toolRowBlock = getCssBlock(css, '.ds-tool-row');
    expect(toolListBlock).toContain('border: 1px solid var(--ds-border)');
    expect(toolListBlock).toContain('border-radius: var(--radius-ctrl)');
    expect(toolRowBlock).toContain('border-top: 1px solid var(--ds-border)');
    expect(css).toContain('.ds-tools-status-card');
    expect(css).toContain(".ds-tools-status-card [data-slot='card-header']");
    expect(css).toContain(".ds-tools-status-card [data-slot='badge']");
    expect(css).toContain('.ds-tools-disclosure summary:focus-visible');
    expect(JSON.stringify(localeResources.en.sidepanel.toolsPage)).not.toMatch(/Tool switches|web_search|web_fetch|python_exec|Shell MCP/);
    expect(JSON.stringify(localeResources['zh-CN'].sidepanel.toolsPage)).not.toMatch(/工具开关|web_search|web_fetch|python_exec|Shell MCP/);
  });

  it('shows a retryable local-tools load error without disabling page tools', async () => {
    let serverLoads = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_WEB_TOOL_SETTINGS: { web_search: true, web_fetch: true },
        GET_MCP_SERVERS: () => {
          serverLoads += 1;
          if (serverLoads === 1) throw new Error('connector offline');
          return [];
        },
        GET_PLATFORM_CAPABILITIES: {
          kind: 'browser_extension',
          name: 'WebExtension',
          capabilities: { nativeMessaging: true },
        },
      },
    });
    await renderWithI18n(React.createElement(ToolsPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Web search');
    expect(container.textContent).toContain('Read page');
    expect(container.textContent).toContain('Local tools could not load: connector offline');
    expect(container.querySelector<HTMLElement>('.ds-tools-status-card')?.getAttribute('data-state')).toBe('attention');
    expect(container.querySelector<HTMLElement>('.ds-tools-status-card [data-slot="badge"]')?.textContent).toBe('Needs attention');
    expect(container.textContent).toContain('Retry local connector status.');
    expect(container.querySelector('button[aria-label="Local Python: Off, Unavailable"]')).toBeTruthy();
    const setUpButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Set up') as HTMLButtonElement | undefined;
    expect(setUpButton?.disabled).toBe(true);

    const retryButtons = Array.from(container.querySelectorAll('button'))
      .filter((button) => button.textContent === 'Retry') as HTMLButtonElement[];
    expect(retryButtons).toHaveLength(1);
    const retryButton = retryButtons
      .find((button) => button.textContent === 'Retry') as HTMLButtonElement | undefined;
    expect(retryButton).toBeTruthy();
    await act(async () => {
      retryButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).not.toContain('connector offline');
    expect(container.querySelector<HTMLElement>('.ds-tools-status-card')?.getAttribute('data-state')).toBe('ready');
    expect(container.querySelector('button[aria-label="Local Python: Off, Set up required"]')).toBeTruthy();
    const recoveredSetUpButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Set up') as HTMLButtonElement | undefined;
    expect(recoveredSetUpButton?.disabled).toBe(false);
  });

  it('keeps Page tools status honest when every tool is off', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        GET_WEB_TOOL_SETTINGS: { web_search: false, web_fetch: false },
        GET_MCP_SERVERS: [],
        GET_PLATFORM_CAPABILITIES: {
          kind: 'browser_extension',
          name: 'WebExtension',
          capabilities: { nativeMessaging: true },
        },
      },
    });
    await renderWithI18n(React.createElement(ToolsPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector<HTMLElement>('.ds-tools-status-card')?.getAttribute('data-state')).toBe('empty');
    expect(container.textContent).toContain('No tools on');
    expect(container.textContent).toContain('Enable Web search, Read page, or Local Python.');
  });

  it('keeps Page tools setting load failures sanitized and recoverable from the status card', async () => {
    let webLoads = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_WEB_TOOL_SETTINGS: () => {
          webLoads += 1;
          if (webLoads === 1) {
            throw new Error('GET_WEB_TOOL_SETTINGS schemaVersion chrome.runtime Bearer data:image/png;base64,AAAA https://secret.example');
          }
          return { web_search: true, web_fetch: true };
        },
        GET_MCP_SERVERS: [],
        GET_PLATFORM_CAPABILITIES: {
          kind: 'browser_extension',
          name: 'WebExtension',
          capabilities: { nativeMessaging: true },
        },
      },
    });
    await renderWithI18n(React.createElement(ToolsPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector<HTMLElement>('.ds-tools-status-card')?.getAttribute('data-state')).toBe('attention');
    expect(container.textContent).toContain('Tool settings could not load: Reload the extension and try again.');
    expect(container.textContent).not.toMatch(/GET_WEB_TOOL_SETTINGS|schemaVersion|chrome\.runtime|Bearer|data:image|AAAA|https:\/\/secret\.example/);

    const retryButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Retry') as HTMLButtonElement | undefined;
    await act(async () => {
      retryButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector<HTMLElement>('.ds-tools-status-card')?.getAttribute('data-state')).toBe('ready');
    expect(container.textContent).toContain('Search On · Read On');
  });

  it('scopes the Local Python switch to Python tools only', async () => {
    const shellServer = createShellServerForToolsPage();
    const pythonDescriptor = createMcpDescriptorForToolsPage(shellServer.id, 'python_exec');
    stubEnglishChrome({
      runtimeMessages: {
        GET_WEB_TOOL_SETTINGS: { web_search: true, web_fetch: true },
        GET_MCP_SERVERS: [shellServer],
        GET_PLATFORM_CAPABILITIES: {
          kind: 'browser_extension',
          name: 'WebExtension',
          capabilities: { nativeMessaging: true },
        },
        GET_MCP_TOOL_CACHE: {
          serverId: shellServer.id,
          descriptors: [
            createMcpDescriptorForToolsPage(shellServer.id, 'python_status'),
            pythonDescriptor,
            createMcpDescriptorForToolsPage(shellServer.id, 'local_skill_preview'),
            createMcpDescriptorForToolsPage(shellServer.id, 'local_folder_pick'),
          ],
          refreshedAt: 1,
          expiresAt: 2,
          health: { serverId: shellServer.id, status: 'ready', checkedAt: 1, latencyMs: 1, toolCount: 4, error: null },
        },
        UPDATE_MCP_SERVER: { ...shellServer, enabled: true },
      },
    });
    await renderWithI18n(React.createElement(ToolsPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const localPythonSwitch = container.querySelector('button[aria-label="Local Python: Off"]') as HTMLButtonElement | null;
    expect(localPythonSwitch).toBeTruthy();
    await act(async () => {
      localPythonSwitch?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const sendMessage = globalThis.chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    const updateCall = sendMessage.mock.calls
      .map(([message]) => message as { type?: string; payload?: { patch?: Record<string, unknown> } })
      .find((message) => message.type === 'UPDATE_MCP_SERVER');
    expect(updateCall?.payload?.patch).toMatchObject({
      enabled: true,
      execution: { enabled: true, mode: 'auto' },
      allowlist: { mode: 'allow', toolNames: ['python_status', 'python_exec'] },
    });
    expect(JSON.stringify(updateCall?.payload?.patch)).not.toContain('local_skill_preview');
    expect(JSON.stringify(updateCall?.payload?.patch)).not.toContain('local_folder_pick');
  });

  it('rejects non-web site access and renders diagnostic failures', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        GET_WEB_TOOL_SETTINGS: { web_search: true, web_fetch: true },
        GET_MCP_SERVERS: [],
        GET_PLATFORM_CAPABILITIES: {
          kind: 'browser_extension',
          name: 'WebExtension',
          capabilities: { nativeMessaging: true },
        },
        DIAGNOSE_WEB_SEARCH: () => {
          throw new Error('diagnostic unavailable');
        },
      },
    });
    await renderWithI18n(React.createElement(ToolsPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const urlInput = container.querySelector('input[type="url"]') as HTMLInputElement | null;
    expect(urlInput).toBeTruthy();
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(urlInput, 'chrome://extensions');
      urlInput!.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const grantButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Grant') as HTMLButtonElement | undefined;
    await act(async () => {
      grantButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('Invalid URL. Enter a full URL such as https://example.com.');
    const sendMessage = globalThis.chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    expect(sendMessage.mock.calls.some(([message]) => (message as { type?: string }).type === 'REQUEST_HOST_PERMISSION')).toBe(false);

    const diagnostics = container.querySelector('.ds-tools-disclosure') as HTMLDetailsElement | null;
    const diagnosticsSummary = diagnostics?.querySelector('summary') as HTMLElement | null;
    await act(async () => {
      diagnosticsSummary?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const diagnoseButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Diagnose') as HTMLButtonElement | undefined;
    await act(async () => {
      diagnoseButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('Diagnostic failed. Reload the extension and try again.');
  });

  it('shows explicit state text for settings toggles', async () => {
    stubEnglishChrome();
    await renderWithI18n(React.createElement('div', null,
      React.createElement(ToggleRow, {
        title: 'Memory injection',
        description: 'Adds saved memory to new prompts.',
        enabled: false,
        onToggle: vi.fn(),
      }),
      React.createElement(ToggleRow, {
        title: 'Browser vision',
        description: 'Requires Browser Control to be on.',
        enabled: true,
        disabled: true,
        disabledLabel: 'Unavailable',
        onToggle: vi.fn(),
      }),
    ));

    expect(container.textContent).toContain('On');
    expect(container.textContent).toContain('Off');
    expect(container.textContent).toContain('Unavailable');
    expect(container.querySelectorAll('[data-slot="field"][role="group"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="field-content"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="field-label"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="field-description"]')).toHaveLength(2);
    const switches = Array.from(container.querySelectorAll('[role="switch"]'));
    expect(switches[0]?.getAttribute('aria-label')).toBe('Memory injection: Off');
    expect(switches[0]?.getAttribute('aria-checked')).toBe('false');
    expect(switches[0]?.getAttribute('data-slot')).toBe('switch');
    expect(switches[1]?.getAttribute('aria-label')).toBe('Browser vision: On, Unavailable');
    expect(switches[1]?.getAttribute('aria-checked')).toBe('true');
    expect(switches[1]?.getAttribute('data-disabled')).toBe('');
    const firstLabel = container.querySelector('[data-slot="field-label"]') as HTMLLabelElement | null;
    expect(firstLabel?.htmlFor).toBe((switches[0] as HTMLElement | undefined)?.id);
  });

  it('keeps shared settings primitives compact and non-shouty', async () => {
    stubEnglishChrome();
    await renderWithI18n(React.createElement(SettingsSection, {
      title: 'Interface',
      description: 'Choose the visible controls for this sidebar.',
      children: React.createElement(ToggleRow, {
        title: 'Sidepanel chat',
        description: 'Use DeepSeek++ chat in the sidepanel.',
        enabled: true,
        onToggle: vi.fn(),
      }),
    }));

    expect(container.querySelector('.ds-settings-section-panel')).toBeTruthy();
    expect(container.querySelector('.ds-toggle-row-copy')).toBeTruthy();

    const primitives = readFileSync('entrypoints/sidepanel/components/settings/primitives.tsx', 'utf8');
    const generalSubPage = readFileSync('entrypoints/sidepanel/components/settings/GeneralSubPage.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const titleBlock = getCssBlock(css, '.ds-settings-section-title');
    const panelBlock = getCssBlock(css, '.ds-settings-section-panel');
    const toggleBlock = getCssBlock(css, '.ds-toggle-row');
    const pickerBlock = getCssBlock(css, '.ds-settings-picker');
    const pickerLabelBlock = getCssBlock(css, '.ds-settings-picker > span');
    const segmentedBlock = getCssBlock(css, '.ds-settings-segmented');
    const segmentOptionBlock = getCssBlock(css, '.ds-settings-segmented-option');
    const activeSegmentBlock = getCssBlock(css, ".ds-settings-segmented-option[data-active='true']");

    expect(primitives).toContain('ds-settings-section-panel');
    expect(primitives).not.toContain('ds-surface-panel p-4 space-y-3');
    expect(primitives).toContain("from '@/components/ui/field'");
    expect(primitives).toContain("from '@/components/ui/input'");
    expect(primitives).toContain("from '@/components/ui/native-select'");
    expect(primitives).toContain("from '@/components/ui/slider'");
    expect(primitives).toContain("from '@/components/ui/switch'");
    expect(primitives).toContain('orientation="horizontal"');
    expect(primitives).toContain('data-disabled={disabled ? true : undefined}');
    expect(primitives).toContain('ds-settings-segmented');
    expect(primitives).toContain("from '@/components/ui/toggle-group'");
    expect(primitives).not.toContain('className="ds-switch relative shrink-0');
    expect(generalSubPage).toContain('SettingsSegmentedGroup');
    expect(generalSubPage).toContain('SelectField');
    expect(generalSubPage).not.toContain('<select');
    expect(generalSubPage).not.toContain('grid grid-cols-3 gap-2');
    expect(generalSubPage).not.toContain('grid grid-cols-2 gap-2');
    expect(titleBlock).not.toContain('text-transform');
    expect(titleBlock).not.toContain('letter-spacing: 0.04em');
    expect(panelBlock).toContain('padding: 12px');
    expect(toggleBlock).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(pickerBlock).toContain('grid-template-columns: auto minmax(0, 1fr)');
    expect(pickerLabelBlock).not.toContain('text-transform');
    expect(css).toContain('.ds-settings-select-trigger');
    expect(segmentedBlock).toContain('border: 1px solid var(--ds-border)');
    expect(segmentOptionBlock).toContain('flex: 1 1 0');
    expect(segmentOptionBlock).toContain('white-space: normal');
    expect(activeSegmentBlock).toContain('var(--ds-blue-light)');
    expect(css).toContain(".ds-settings-segmented-option[data-state='on']");
    expect(css).toContain(".ds-segmented-option[data-state='on']");
    expect(primitives).toContain('value={[value]}');
    expect(primitives).toContain('onValueChange={(next) =>');
    expect(primitives).toContain('className="ds-settings-slider"');
    expect(primitives).not.toContain('type="range"');
    expect(primitives).not.toContain('appearance-none cursor-pointer');
  });

  it('shows a shadcn-backed Settings status card without fake source confidence', async () => {
    stubEnglishChrome({
      runtimeMessages: createApiSettingsRuntimeMessages(),
    });
    await renderWithI18n(React.createElement(SettingsPage, { activeSubTab: 'api' }));
    await flushPolishApp();

    const card = container.querySelector<HTMLElement>('.ds-settings-status-card[data-slot="card"]');
    const bodyText = container.textContent ?? '';
    expect(card).toBeTruthy();
    expect(card?.getAttribute('data-state')).toBe('ready');
    expect(card?.getAttribute('aria-live')).toBe('polite');
    expect(card?.querySelector('[data-slot="card-header"]')).toBeTruthy();
    expect(card?.querySelector('[data-slot="card-title"]')?.textContent).toBe('Settings status');
    expect(card?.querySelector('[data-slot="card-description"]')?.textContent).toBe('Saved settings loaded for the current view.');
    expect(card?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent).toBe('Ready');
    expect(card?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Current view');
    expect(card?.querySelector('[data-slot="card-content"]')?.textContent).toContain('API');
    expect(card?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Sources');
    expect(card?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Loaded');
    expect(card?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Version');
    expect(card?.querySelector('button')).toBeNull();
    expect(bodyText).not.toContain('GET_DEEPSEEK_API_KEY_STATUS');
    expect(bodyText).not.toContain('schemaVersion');

    const settingsPage = readFileSync('entrypoints/sidepanel/pages/SettingsPage.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    expect(settingsPage).toContain("from '@/components/ui/card'");
    expect(settingsPage).toContain("from '@/components/ui/badge'");
    expect(settingsPage).toContain("from '@/components/ui/button'");
    expect(settingsPage).toContain("from '@/components/ui/skeleton'");
    expect(settingsPage).toContain('function SettingsStatusCard');
    expect(settingsPage).toContain('<CardHeader>');
    expect(settingsPage).toContain('<CardContent>');
    expect(settingsPage).toContain('<CardAction>');
    expect(settingsPage).toContain('<Badge variant={badgeVariant}>');
    expect(settingsPage).toContain('<Button');
    expect(settingsPage).toContain('<Skeleton');
    expect(css).toContain('.ds-settings-status-card');
    expect(css).toContain(".ds-settings-status-card [data-slot='card-header']");
    expect(css).toContain(".ds-settings-status-card [data-slot='badge']");
    expect(css).toContain('@media (max-width: 380px)');
  });

  it('routes Settings source refresh through one status-card retry action', async () => {
    let apiLoads = 0;
    stubEnglishChrome({
      runtimeMessages: createApiSettingsRuntimeMessages({
        GET_DEEPSEEK_API_KEY_STATUS: () => {
          apiLoads += 1;
          return apiLoads === 1
            ? {
                ok: false,
                error: { message: 'GET_DEEPSEEK_API_KEY_STATUS schemaVersion chrome.storage token secret [object Object]' },
              }
            : { configured: true };
        },
      }),
    });
    await renderWithI18n(React.createElement(SettingsPage, { activeSubTab: 'api' }));
    await flushPolishApp();

    const card = container.querySelector<HTMLElement>('.ds-settings-status-card[data-slot="card"]');
    expect(card?.getAttribute('data-state')).toBe('issue');
    expect(card?.textContent).toContain('Needs refresh');
    expect(card?.textContent).toContain('Sources needing refresh: 1');
    expect(card?.textContent).toContain('Need refresh: 1');
    expect(container.textContent).toContain('Settings need refresh');
    expect(container.textContent).toContain('Load failed');
    expect(container.textContent).not.toContain('GET_DEEPSEEK_API_KEY_STATUS');
    expect(container.textContent).not.toContain('schemaVersion');
    expect(container.textContent).not.toContain('token');
    expect(container.querySelector('.ds-settings-load-issue button')).toBeNull();

    const retryButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .filter((button) => button.textContent === 'Retry');
    expect(retryButtons).toHaveLength(1);

    await act(async () => {
      retryButtons[0]?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    expect(apiLoads).toBe(2);
    expect(container.querySelector<HTMLElement>('.ds-settings-status-card')?.getAttribute('data-state')).toBe('ready');
    expect(container.textContent).toContain('Ready');
    expect(container.textContent).toContain('Configured');
    expect(container.textContent).not.toContain('Settings need refresh');
  });

  it('composes shared numeric sliders with shadcn slider controls', async () => {
    stubEnglishChrome();
    const onChange = vi.fn();

    await renderWithI18n(React.createElement(Slider, {
      label: 'Opacity',
      value: 0.65,
      min: 0.05,
      max: 1,
      step: 0.05,
      format: (value: number) => value.toFixed(2),
      onChange,
    }));

    expect(container.textContent).toContain('Opacity');
    expect(container.textContent).toContain('0.65');
    expect(container.querySelectorAll('[data-slot="field"][role="group"]')).toHaveLength(1);
    expect(container.querySelector('[data-slot="field-label"]')?.textContent).toBe('Opacity');
    expect(container.querySelector('[data-slot="slider"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="slider-track"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="slider-range"]')).toBeTruthy();
    const thumb = container.querySelector('[data-slot="slider-thumb"][role="slider"]') as HTMLElement | null;
    expect(thumb).toBeTruthy();
    expect(thumb?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(thumb?.getAttribute('aria-describedby')).toBeTruthy();
    expect(thumb?.getAttribute('aria-valuenow')).toBe('0.65');
    expect(thumb?.getAttribute('aria-valuetext')).toBe('0.65');
    expect(thumb?.getAttribute('aria-valuemin')).toBe('0.05');
    expect(thumb?.getAttribute('aria-valuemax')).toBe('1');
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });

  it('composes shared text, textarea, and select fields with shadcn field controls', async () => {
    stubEnglishChrome();
    const onTextChange = vi.fn();
    const onTextareaChange = vi.fn();
    const onSelectChange = vi.fn();

    await renderWithI18n(React.createElement('div', null,
      React.createElement(TextField, {
        label: 'Base URL',
        hint: 'Use a full HTTPS URL.',
        meta: React.createElement('span', null, 'Required'),
        value: '',
        placeholder: 'https://api.example.com',
        onChange: onTextChange,
      }),
      React.createElement(TextAreaField, {
        label: 'Instructions',
        hint: 'Use concrete behavior.',
        value: '',
        placeholder: 'Write instructions',
        rows: 5,
        onChange: onTextareaChange,
      }),
      React.createElement(SelectField, {
        label: 'Preset cadence',
        hint: 'Choose when presets are included.',
        value: 'default',
        options: [
          { value: 'default', label: 'Default cadence' },
          { value: 'off', label: 'Off' },
        ],
        onChange: onSelectChange,
      }),
    ));

    const fields = Array.from(container.querySelectorAll('[data-slot="field"][role="group"]'));
    const input = container.querySelector('[data-slot="input"]') as HTMLInputElement | null;
    const textarea = container.querySelector('[data-slot="textarea"]') as HTMLTextAreaElement | null;
    const nativeSelect = container.querySelector('[data-slot="native-select"]') as HTMLSelectElement | null;
    const nativeSelectWrapper = container.querySelector('[data-slot="native-select-wrapper"]');
    const labels = Array.from(container.querySelectorAll('[data-slot="field-label"]')) as HTMLLabelElement[];
    const descriptions = Array.from(container.querySelectorAll('[data-slot="field-description"]'));

    expect(fields).toHaveLength(3);
    expect(input).toBeTruthy();
    expect(textarea).toBeTruthy();
    expect(nativeSelect).toBeTruthy();
    expect(nativeSelectWrapper).toBeTruthy();
    expect(container.querySelectorAll('[data-slot="native-select-option"]')).toHaveLength(2);
    expect(labels[0]?.htmlFor).toBe(input?.id);
    expect(labels[1]?.htmlFor).toBe(textarea?.id);
    expect(labels[2]?.htmlFor).toBe(nativeSelect?.id);
    expect(descriptions).toHaveLength(3);
    expect(input?.getAttribute('aria-describedby')).toBe(descriptions[0]?.id);
    expect(textarea?.getAttribute('aria-describedby')).toBe(descriptions[1]?.id);
    expect(textarea?.rows).toBe(5);
    expect(nativeSelect?.getAttribute('aria-describedby')).toBe(descriptions[2]?.id);

    await setInputValue(input!, 'https://api.example.com');
    expect(onTextChange).toHaveBeenCalledWith('https://api.example.com');
    await setInputValue(textarea!, 'Be exact.');
    expect(onTextareaChange).toHaveBeenCalledWith('Be exact.');

    await act(async () => {
      nativeSelect!.value = 'off';
      nativeSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onSelectChange).toHaveBeenCalledWith('off');

    const primitives = readFileSync('entrypoints/sidepanel/components/settings/primitives.tsx', 'utf8');
    const memoryForm = readFileSync('entrypoints/sidepanel/components/MemoryForm.tsx', 'utf8');
    const savedPage = readFileSync('entrypoints/sidepanel/pages/SavedPage.tsx', 'utf8');

    expect(primitives).toContain("from '@/components/ui/textarea'");
    expect(primitives).toContain('export function TextAreaField');
    expect(primitives).toContain('<Textarea');
    expect(memoryForm).toContain('TextAreaField');
    expect(savedPage).toContain('TextAreaField');
    expect(memoryForm).not.toContain('<textarea');
    expect(savedPage).not.toContain('<textarea');
  });

  it('renders General same-session strategy through the shared native select field', async () => {
    stubEnglishChrome();
    const state = createGeneralStateStub();

    await renderWithI18n(React.createElement(GeneralSubPage, { state }));

    const select = Array.from(container.querySelectorAll('[data-slot="native-select"]'))
      .find((candidate) => candidate.getAttribute('aria-describedby') === null) as HTMLSelectElement | undefined;
    expect(select).toBeTruthy();
    expect(select?.value).toBe('last');
    expect(container.textContent).toContain('Where Web tasks continue');
    expect(container.querySelectorAll('[data-slot="native-select-option"]')).toHaveLength(3);

    await act(async () => {
      select!.value = 'current';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(state.handlePersonalConveniencePatch).toHaveBeenCalledWith(
      { sameSessionStrategy: 'current' },
      'Save failed',
    );
  });

  it('composes shared segmented controls with shadcn ToggleGroup', async () => {
    stubEnglishChrome();
    const onSettingsChange = vi.fn();
    const onSegmentedChange = vi.fn();

    await renderWithI18n(React.createElement('div', null,
      React.createElement(SettingsSegmentedGroup, {
        ariaLabel: 'Position',
        value: 'right',
        onChange: onSettingsChange,
        options: [
          { value: 'right', label: 'Bottom right' },
          { value: 'left', label: 'Bottom left' },
        ],
      }),
      React.createElement(SegmentedControl, {
        ariaLabel: 'Library filter',
        value: 'all',
        onChange: onSegmentedChange,
        options: [
          { key: 'all', label: 'All' },
          { key: 'saved', label: 'Saved' },
          { key: 'memory', label: 'Memory' },
        ],
      }),
    ));

    const settingsGroup = container.querySelector('.ds-settings-segmented[data-slot="toggle-group"]');
    expect(settingsGroup).toBeTruthy();
    expect(settingsGroup?.getAttribute('data-spacing')).toBe('0');
    expect(settingsGroup?.getAttribute('aria-label')).toBe('Position');
    const settingsItems = Array.from(container.querySelectorAll('.ds-settings-segmented-option[data-slot="toggle-group-item"]')) as HTMLButtonElement[];
    expect(settingsItems).toHaveLength(2);
    expect(settingsItems[0]?.getAttribute('data-state')).toBe('on');
    expect(settingsItems[0]?.getAttribute('data-active')).toBe('true');
    expect(settingsItems[1]?.getAttribute('data-state')).toBe('off');

    await act(async () => {
      settingsItems[1]?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onSettingsChange).toHaveBeenCalledWith('left');

    const segmentedGroup = container.querySelector('.ds-segmented[data-slot="toggle-group"]');
    expect(segmentedGroup).toBeTruthy();
    expect(segmentedGroup?.getAttribute('data-spacing')).toBe('2');
    expect(segmentedGroup?.getAttribute('aria-label')).toBe('Library filter');
    const segmentedItems = Array.from(container.querySelectorAll('.ds-segmented-option[data-slot="toggle-group-item"]')) as HTMLButtonElement[];
    expect(segmentedItems).toHaveLength(3);
    expect(segmentedItems[0]?.getAttribute('data-state')).toBe('on');

    await act(async () => {
      segmentedItems[1]?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onSegmentedChange).toHaveBeenCalledWith('saved');
  });

  it('keeps Prompt and Voice settings on shared crisp primitives', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        GET_PROMPT_INJECTION_SETTINGS: DEFAULT_PROMPT_INJECTION_SETTINGS,
        GET_VOICE_SETTINGS: DEFAULT_VOICE_SETTINGS,
        GET_VOICE_CAPABILITIES: {
          speechRecognition: false,
          speechSynthesis: true,
        },
      },
    });
    await renderWithI18n(React.createElement('div', null,
      React.createElement(PromptControlPanel),
      React.createElement(VoiceSettingsPanel),
    ));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Prompt controls');
    expect(container.textContent).toContain('Preset cadence');
    expect(container.textContent).toContain('Force response language');
    expect(container.textContent).toContain('Voice');
    expect(container.textContent).toContain('Rate');
    expect(container.textContent).toContain('Pitch');
    expect(container.querySelectorAll('.ds-settings-section-panel')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="slider"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="slider-thumb"][role="slider"]')).toHaveLength(2);
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(0);
    expect(container.querySelectorAll('select[id]')).toHaveLength(2);
    expect(container.querySelectorAll('select')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="native-select-wrapper"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="native-select"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="native-select-option"]')).toHaveLength(7);
    expect(container.querySelectorAll('[data-slot="input"]')).toHaveLength(0);

    const promptPanel = readFileSync('entrypoints/sidepanel/components/PromptControlPanel.tsx', 'utf8');
    const voicePanel = readFileSync('entrypoints/sidepanel/components/VoiceSettingsPanel.tsx', 'utf8');
    const primitives = readFileSync('entrypoints/sidepanel/components/settings/primitives.tsx', 'utf8');

    expect(promptPanel).toContain('SettingsSection');
    expect(promptPanel).toContain('SelectField');
    expect(promptPanel).toContain('StatusMessage');
    expect(promptPanel).not.toContain('rounded-xl p-4');
    expect(promptPanel).not.toContain('className="w-full px-3 py-2 text-xs rounded-lg border outline-none"');
    expect(voicePanel).toContain('SettingsSection');
    expect(voicePanel).toContain('Slider');
    expect(voicePanel).not.toContain('function Slider');
    expect(voicePanel).not.toContain('appearance-none');
    expect(primitives).toContain('export function SelectField');
    expect(primitives).toContain('useId');
    expect(primitives).toContain('htmlFor={inputId}');
    expect(primitives).toContain('id={inputId}');
    expect(primitives).toContain('htmlFor={selectId}');
    expect(primitives).toContain('id={selectId}');
    expect(primitives).toContain('<Input');
    expect(primitives).toContain('<NativeSelect');
    expect(primitives).toContain('<NativeSelectOption');
    expect(primitives).toContain("role={tone === 'error' ? 'alert' : 'status'}");
    expect(primitives).toContain('aria-live={tone ===');
  });

  it('uses action copy instead of raw Web session enum labels', () => {
    const chatPage = localeResources.en.sidepanel.chatPage;
    const automationPage = localeResources.en.sidepanel.automationPage;
    const settings = localeResources.en.sidepanel.settings;

    expect(chatPage.sessionStrategyLast).toBe('Resume last DeepSeek chat');
    expect(chatPage.sessionStrategyCurrent).toBe('Use current sidepanel chat');
    expect(chatPage.sessionStrategyNew).toBe('Start a new DeepSeek chat');
    expect(automationPage.sessionStrategy.last).toBe('Resume last chat');
    expect(automationPage.sessionStrategy.current).toBe('Use current chat');
    expect(automationPage.sessionStrategy.new).toBe('Start new chat');
    expect(settings.modelSection).toBe('DeepSeek chat');
    expect(settings.personalConvenience).toBe('Personal defaults');
    expect(settings.personalConvenienceMode).toBe('Use my defaults');
    expect(JSON.stringify({
      chat: [
        chatPage.sessionStrategyLast,
        chatPage.sessionStrategyCurrent,
        chatPage.sessionStrategyNew,
      ],
      automation: automationPage.sessionStrategy,
      settings: {
        modelSection: settings.modelSection,
        personalConvenience: settings.personalConvenience,
        personalConvenienceMode: settings.personalConvenienceMode,
      },
    })).not.toMatch(/Session: (Last|Current|New)|"Last"|"Current"|"New"|Personal Convenience Mode|Chat settings/);
  });

  it('keeps API settings compact without duplicate helper copy', async () => {
    stubEnglishChrome();
    await renderWithI18n(React.createElement(ApiSubPage, { state: createSettingsStateStub() }));

    expect(container.querySelector('.ds-settings-status-row')).toBeNull();
    expect(container.querySelector('.ds-settings-status-list')).toBeNull();
    expect(container.querySelector('.ds-settings-field-group-label')).toBeNull();
    expect(container.querySelector('.ds-status-badge')).toBeNull();
    expect(container.textContent).toContain('OpenAI');
    expect(container.textContent).toContain('Gemini');
    expect(container.textContent).toContain('Not configured');
    expect(container.querySelectorAll('.ds-settings-field-state[data-state="not-configured"]')).toHaveLength(3);
    expect(container.querySelector('.ds-settings-section-panel')?.textContent).not.toContain(
      'After configuration, context menu scenarios can run on regular webpages',
    );

    const apiSubPage = readFileSync('entrypoints/sidepanel/components/settings/ApiSubPage.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const fieldStateBlock = getCssBlock(css, '.ds-settings-field-state');
    const notConfiguredBlock = getCssBlock(css, ".ds-settings-field-state[data-state='not-configured']");

    expect(apiSubPage).toContain('ds-settings-field-state');
    expect(apiSubPage).not.toContain('ds-settings-status-row');
    expect(apiSubPage).not.toContain('ds-settings-status-list');
    expect(apiSubPage).not.toContain('StatusBadge');
    expect(apiSubPage).not.toContain('uppercase tracking-wide');
    expect(apiSubPage).not.toContain('API Keys');
    expect(apiSubPage).not.toContain('Keys');
    expect(apiSubPage).not.toContain('border-t');
    expect(css).not.toContain('.ds-status-badge');
    expect(css).not.toContain('.ds-settings-field-group-label');
    expect(fieldStateBlock).not.toContain('text-transform');
    expect(notConfiguredBlock).toContain('font-weight: 650');
  });

  it('sanitizes API and multimodal save failures without exposing key material', async () => {
    stubEnglishChrome({
      runtimeMessages: createApiSettingsRuntimeMessages({
        SAVE_DEEPSEEK_API_KEY: () => ({
          ok: false,
          error: { message: 'SAVE_DEEPSEEK_API_KEY apiKey sk-test-secret schemaVersion chrome.storage [object Object]' },
        }),
        SAVE_MULTIMODAL_SETTINGS: () => ({
          ok: false,
          error: { message: 'SAVE_MULTIMODAL_SETTINGS openaiApiKey sk-openai-secret geminiApiKey AIzaFakeSecret Authorization Bearer token' },
        }),
      }),
    });
    await renderWithI18n(React.createElement(SettingsPage, { activeSubTab: 'api' }));
    await flushPolishApp();

    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];
    const deepSeekInput = inputs.find((input) => input.placeholder === 'sk-...');
    const openaiInput = inputs.filter((input) => input.placeholder === 'sk-...')[1];
    const geminiInput = inputs.find((input) => input.placeholder === 'AIza...');
    expect(deepSeekInput).toBeTruthy();
    expect(openaiInput).toBeTruthy();
    expect(geminiInput).toBeTruthy();

    await setInputValue(deepSeekInput!, 'sk-test-secret');
    const saveButtons = () => Array.from(container.querySelectorAll('button'))
      .filter((button) => button.textContent === 'Save') as HTMLButtonElement[];
    await act(async () => {
      saveButtons()[0]?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    await setInputValue(openaiInput!, 'sk-openai-secret');
    await setInputValue(geminiInput!, 'AIzaFakeSecret');
    await act(async () => {
      saveButtons().at(-1)?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    const bodyText = container.textContent ?? '';
    expect(bodyText.match(/Save failed/g)).toHaveLength(2);
    expect(bodyText).not.toContain('Saved. Context menu scenarios can now run on regular webpages.');
    expect(bodyText).not.toContain('Legacy Multimodal API settings saved');
    expect(bodyText).not.toContain('SAVE_DEEPSEEK_API_KEY');
    expect(bodyText).not.toContain('SAVE_MULTIMODAL_SETTINGS');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('apiKey');
    expect(bodyText).not.toContain('openaiApiKey');
    expect(bodyText).not.toContain('geminiApiKey');
    expect(bodyText).not.toContain('Authorization');
    expect(bodyText).not.toContain('Bearer');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('[object Object]');
  });

  it('sanitizes API and multimodal clear failures without false cleared states', async () => {
    stubEnglishChrome({
      runtimeMessages: createApiSettingsRuntimeMessages({
        GET_DEEPSEEK_API_KEY_STATUS: { configured: true },
        GET_MULTIMODAL_SETTINGS_STATUS: {
          ok: true,
          openaiConfigured: true,
          geminiConfigured: true,
          openaiImageModel: 'gpt-4.1-mini',
          geminiVideoModel: 'gemini-2.5-flash',
          openaiBaseUrl: 'https://api.openai.com/v1',
          geminiBaseUrl: 'https://generativelanguage.googleapis.com',
        },
        CLEAR_DEEPSEEK_API_KEY: () => ({
          ok: false,
          error: { message: 'CLEAR_DEEPSEEK_API_KEY DEEPSEEK_API_KEY token chrome.storage denied' },
        }),
        CLEAR_MULTIMODAL_SETTINGS: () => ({
          ok: false,
          error: { message: 'CLEAR_MULTIMODAL_SETTINGS OPENAI_API_KEY GEMINI_API_KEY secret schemaVersion' },
        }),
      }),
    });
    await renderWithI18n(React.createElement(SettingsPage, { activeSubTab: 'api' }));
    await flushPolishApp();

    await act(async () => {
      getButtonByText('Clear API Key')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const confirmButton = document.body.querySelector('.ds-modal-actions .ds-btn-danger') as HTMLButtonElement | null;
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    await act(async () => {
      getButtonByText('Clear legacy multimodal settings')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    const bodyText = container.textContent ?? '';
    expect(bodyText.match(/Clear failed/g)).toHaveLength(2);
    expect(bodyText).toContain('Configured');
    expect(bodyText).not.toContain('API Key cleared');
    expect(bodyText).not.toContain('Legacy Multimodal API settings cleared');
    expect(bodyText).not.toContain('CLEAR_DEEPSEEK_API_KEY');
    expect(bodyText).not.toContain('CLEAR_MULTIMODAL_SETTINGS');
    expect(bodyText).not.toContain('DEEPSEEK_API_KEY');
    expect(bodyText).not.toContain('OPENAI_API_KEY');
    expect(bodyText).not.toContain('GEMINI_API_KEY');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
  });

  it('sanitizes Settings load failures without hiding friendly source errors', async () => {
    stubEnglishChrome({
      runtimeMessages: createApiSettingsRuntimeMessages({
        GET_DEEPSEEK_API_KEY_STATUS: {
          ok: false,
          error: { message: 'GET_DEEPSEEK_API_KEY_STATUS schemaVersion chrome.storage Bearer sk-load-secret [object Object]' },
        },
        GET_MEMORIES: () => {
          throw new Error('memory service offline');
        },
        GET_SYNC_CONFIG: {
          ok: false,
          error: { message: 'GET_SYNC_CONFIG schemaVersion Authorization token Cookie secret' },
        },
      }),
    });
    await renderWithI18n(React.createElement(SettingsPage, { activeSubTab: 'api' }));
    await flushPolishApp();

    const bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Settings need refresh');
    expect(bodyText).toContain('DeepSeek API Key');
    expect(bodyText).toContain('Memories');
    expect(bodyText).toContain('WebDAV sync');
    expect(bodyText.match(/Load failed/g)).toHaveLength(2);
    expect(bodyText).toContain('memory service offline');
    expect(bodyText).not.toContain('GET_DEEPSEEK_API_KEY_STATUS');
    expect(bodyText).not.toContain('GET_SYNC_CONFIG');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('Authorization');
    expect(bodyText).not.toContain('Bearer');
    expect(bodyText).not.toContain('Cookie');
    expect(bodyText).not.toContain('sk-load-secret');
    expect(bodyText).not.toContain('[object Object]');
  });

  it('rolls back General expert and personal defaults when persistence is rejected', async () => {
    stubEnglishChrome({
      runtimeMessages: createApiSettingsRuntimeMessages({
        GET_PERSONAL_CONVENIENCE_CONFIG: { config: { enabled: true } },
        SET_MODEL_TYPE: () => ({
          ok: false,
          error: { message: 'SET_MODEL_TYPE schemaVersion chrome.storage token secret [object Object]' },
        }),
        SAVE_PERSONAL_CONVENIENCE_CONFIG: () => ({
          ok: false,
          error: { message: 'SAVE_PERSONAL_CONVENIENCE_CONFIG deepseek_pp_personal_convenience schemaVersion secret' },
        }),
      }),
    });
    await renderWithI18n(React.createElement(SettingsPage, { activeSubTab: 'general' }));
    await flushPolishApp();

    const getExpertSwitch = () => Array.from(container.querySelectorAll('[role="switch"]'))
      .find((switchEl) => switchEl.getAttribute('aria-label')?.startsWith('Use Web Expert on chat.deepseek.com:')) as HTMLButtonElement | undefined;
    const getDefaultsSwitch = () => Array.from(container.querySelectorAll('[role="switch"]'))
      .find((switchEl) => switchEl.getAttribute('aria-label')?.startsWith('Use my defaults:')) as HTMLButtonElement | undefined;
    expect(getExpertSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(getDefaultsSwitch()?.getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      getExpertSwitch()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();
    await act(async () => {
      getDefaultsSwitch()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    const bodyText = container.textContent ?? '';
    expect(getExpertSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(getDefaultsSwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(bodyText).toContain('Save failed');
    expect(bodyText).not.toContain('SET_MODEL_TYPE');
    expect(bodyText).not.toContain('SAVE_PERSONAL_CONVENIENCE_CONFIG');
    expect(bodyText).not.toContain('deepseek_pp_personal_convenience');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');
  });

  it('rolls back sidepanel chat when local persistence fails without leaking storage keys', async () => {
    stubEnglishChrome({
      storageSet: () => {
        throw new Error('deepseek_pp_chat_enabled chrome.storage token secret');
      },
      runtimeMessages: createApiSettingsRuntimeMessages(),
    });
    await renderWithI18n(React.createElement(SettingsPage, { activeSubTab: 'general' }));
    await flushPolishApp();

    const getChatSwitch = () => Array.from(container.querySelectorAll('[role="switch"]'))
      .find((switchEl) => switchEl.getAttribute('aria-label')?.startsWith('Sidepanel chat:')) as HTMLButtonElement | undefined;
    expect(getChatSwitch()?.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      getChatSwitch()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    const bodyText = container.textContent ?? '';
    expect(getChatSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(bodyText).toContain('Save failed');
    expect(bodyText).not.toContain('deepseek_pp_chat_enabled');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
  });

  it('rolls back background settings when persistence is rejected without leaking runtime details', async () => {
    stubEnglishChrome({
      runtimeMessages: createAppearanceSettingsRuntimeMessages({
        GET_BACKGROUND: {
          enabled: false,
          type: 'url',
          url: 'https://images.example/background.jpg',
          imageData: '',
          opacity: 0.45,
        },
        SAVE_BACKGROUND: () => ({
          ok: false,
          error: { message: 'SAVE_BACKGROUND schemaVersion chrome.storage data:image secret [object Object]' },
        }),
      }),
    });
    await renderWithI18n(React.createElement(SettingsPage, { activeSubTab: 'appearance' }));
    await flushPolishApp();

    const getBackgroundSwitch = () => Array.from(container.querySelectorAll('[role="switch"]'))
      .find((switchEl) => switchEl.getAttribute('aria-label')?.startsWith('Custom background:')) as HTMLButtonElement | undefined;
    expect(getBackgroundSwitch()?.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      getBackgroundSwitch()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    const bodyText = container.textContent ?? '';
    expect(getBackgroundSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(bodyText).toContain('Save failed');
    expect(bodyText).not.toContain('SAVE_BACKGROUND');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('data:image');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');
  });

  it('rolls back pet settings when persistence is rejected without leaking runtime details', async () => {
    stubEnglishChrome({
      runtimeMessages: createAppearanceSettingsRuntimeMessages({
        GET_PET: {
          enabled: true,
          position: 'bottom-right',
          size: 132,
          opacity: 0.96,
          motion: true,
        },
        SAVE_PET: () => ({
          ok: false,
          error: { message: 'SAVE_PET schemaVersion chrome.runtime token secret [object Object]' },
        }),
      }),
    });
    await renderWithI18n(React.createElement(SettingsPage, { activeSubTab: 'appearance' }));
    await flushPolishApp();

    const getPetSwitch = () => Array.from(container.querySelectorAll('[role="switch"]'))
      .find((switchEl) => switchEl.getAttribute('aria-label')?.startsWith('DeepSeek whale:')) as HTMLButtonElement | undefined;
    expect(getPetSwitch()?.getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      getPetSwitch()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    const bodyText = container.textContent ?? '';
    expect(getPetSwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(bodyText).toContain('Save failed');
    expect(bodyText).not.toContain('SAVE_PET');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.runtime');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');
  });

  it('keeps Appearance settings consistent and non-redundant', async () => {
    stubEnglishChrome();
    await renderWithI18n(React.createElement(AppearanceSubPage, { state: createAppearanceStateStub() }));

    const bodyText = container.textContent ?? '';
    const backgroundDescription = localeResources.en.sidepanel.settings.customBackgroundDescription;
    const petDescription = localeResources.en.sidepanel.settings.petWhaleDescription;
    expect(bodyText.match(new RegExp(escapeRegExp(backgroundDescription), 'g'))).toHaveLength(1);
    expect(bodyText.match(new RegExp(escapeRegExp(petDescription), 'g'))).toHaveLength(1);
    expect(bodyText).toContain('Background source');
    expect(bodyText).toContain('Image URL');
    expect(bodyText).toContain('Position');
    expect(container.querySelector('.ds-background-source-row')).toBeTruthy();
    expect(container.querySelectorAll('.ds-settings-segmented')).toHaveLength(1);
    expect(container.querySelectorAll('.ds-settings-segmented-option')).toHaveLength(2);
    expect(container.querySelector('.ds-settings-segmented')?.getAttribute('data-slot')).toBe('toggle-group');
    expect(container.querySelector('.ds-settings-segmented')?.getAttribute('aria-label')).toBe('Position');
    expect(container.querySelectorAll('.ds-settings-segmented-option[data-slot="toggle-group-item"]')).toHaveLength(2);
    expect(container.querySelector('.ds-settings-segmented-option[data-state="on"]')?.textContent).toBe('Bottom right');
    expect(container.querySelectorAll('[data-slot="slider"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="slider-thumb"][role="slider"]')).toHaveLength(3);
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(0);

    const appearanceSubPage = readFileSync('entrypoints/sidepanel/components/settings/AppearanceSubPage.tsx', 'utf8');
    expect(appearanceSubPage).toContain('SettingsSegmentedGroup');
    expect(appearanceSubPage).toContain('ds-background-source-row');
    expect(appearanceSubPage).toContain('backgroundSource');
    expect(appearanceSubPage).not.toContain('grid-cols-2');
    expect(appearanceSubPage).not.toContain('grid-cols-3');
    expect(appearanceSubPage).not.toContain('customBackgroundDescription)}\\n          enabled');
    expect(appearanceSubPage).not.toContain('petWhaleDescription)}\\n          enabled');
  });

  it('shows custom pet placement as state text instead of a dead segment', async () => {
    stubEnglishChrome();
    await renderWithI18n(React.createElement(AppearanceSubPage, {
      state: createAppearanceStateStub({ petPosition: 'custom' }),
    }));

    expect(container.querySelector('.ds-settings-field-state[data-state="custom"]')?.textContent).toBe('Custom');
    expect(container.querySelectorAll('.ds-settings-segmented-option')).toHaveLength(2);
    expect(Array.from(container.querySelectorAll('.ds-settings-segmented-option[data-slot="toggle-group-item"]')).map((button) => button.textContent)).toEqual([
      'Bottom right',
      'Bottom left',
    ]);
    expect(container.querySelector('.ds-settings-segmented-option[data-state="on"]')).toBeNull();
  });

  it('does not special-case custom pet position as a selectable option in code', () => {
    const appearanceSubPage = readFileSync('entrypoints/sidepanel/components/settings/AppearanceSubPage.tsx', 'utf8');

    expect(appearanceSubPage).toContain('isCustomPetPosition');
    expect(appearanceSubPage).not.toContain("position !== 'custom'");
    expect(appearanceSubPage).not.toContain("petPositionItems.push({ key: 'custom'");
  });

  it('keeps Data settings compact and explicit without metric-heavy styling', async () => {
    stubEnglishChrome();
    await renderWithI18n(React.createElement(DataSubPage, { state: createDataStateStub() }));

    expect(container.textContent).toContain('Cloud sync');
    expect(container.textContent).toContain('Not configured');
    expect(container.textContent).toContain('Last sync: Never synced');
    expect(container.textContent).toContain('Local memory');
    expect(container.textContent).toContain('Memory records');
    expect(container.querySelector('.ds-data-sync-actions')).toBeTruthy();
    expect(container.querySelector('.ds-data-summary-row')).toBeTruthy();
    expect(container.querySelector('.ds-data-summary-row')?.textContent).toContain('12');

    const syncButtons = Array.from(container.querySelectorAll('.ds-data-sync-actions button')) as HTMLButtonElement[];
    expect(syncButtons).toHaveLength(3);
    expect(syncButtons.every((button) => button.disabled)).toBe(true);

    const dataSubPage = readFileSync('entrypoints/sidepanel/components/settings/DataSubPage.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const credentialsBlock = getCssBlock(css, '.ds-data-sync-credentials');
    const summaryBlock = getCssBlock(css, '.ds-data-summary-row');
    const actionButtonBlock = getCssBlock(css, '.ds-data-action-button');

    expect(dataSubPage).toContain('ds-settings-field-state');
    expect(dataSubPage).toContain('ds-data-sync-actions');
    expect(dataSubPage).not.toContain('grid grid-cols-2 gap-2');
    expect(dataSubPage).not.toContain("background: 'var(--ds-blue)'");
    expect(dataSubPage).not.toContain('text-lg font-semibold');
    expect(credentialsBlock).not.toContain('repeat(2');
    expect(summaryBlock).toContain('border-bottom: 1px solid var(--ds-border)');
    expect(summaryBlock).not.toContain('var(--ds-blue)');
    expect(actionButtonBlock).toContain('font-size: 11px');
  });

  it('enables neutral Data sync actions only after WebDAV is configured', async () => {
    stubEnglishChrome();
    await renderWithI18n(React.createElement(DataSubPage, {
      state: createDataStateStub({
        syncConfig: {
          url: 'https://dav.example.com/dav/',
          username: 'kevin',
          password: '',
          remotePath: '/deepseek-pp.json',
          lastSyncAt: Date.UTC(2026, 5, 30, 12, 0),
        },
      }),
    }));

    expect(container.textContent).toContain('Configured');
    const syncButtons = Array.from(container.querySelectorAll('.ds-data-sync-actions button')) as HTMLButtonElement[];
    expect(syncButtons).toHaveLength(3);
    expect(syncButtons.every((button) => button.disabled)).toBe(false);
    expect(syncButtons.every((button) => button.classList.contains('ds-btn-secondary'))).toBe(true);
    expect(syncButtons.every((button) => !button.getAttribute('style'))).toBe(true);
  });

  it('does not report Data sync success when saving sync config is rejected', async () => {
    stubEnglishChrome({
      runtimeMessages: createDataSettingsRuntimeMessages({
        SAVE_SYNC_CONFIG: () => ({
          ok: false,
          error: { message: 'SAVE_SYNC_CONFIG schemaVersion chrome.storage denied Bearer secret [object Object]' },
        }),
        WEBDAV_TEST: { ok: true },
      }),
    });
    await renderWithI18n(React.createElement(SettingsPage, { activeSubTab: 'data' }));
    await flushPolishApp();

    const testButton = getButtonByText('Test connection');
    expect(testButton).toBeTruthy();
    expect(testButton!.disabled).toBe(false);
    await act(async () => {
      testButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    const bodyText = container.textContent ?? '';
    const messageTypes = (chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(([message]) => (message as { type?: string }).type);
    expect(bodyText).toContain('Operation failed');
    expect(bodyText).not.toContain('Connection succeeded');
    expect(bodyText).not.toContain('SAVE_SYNC_CONFIG');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('Bearer');
    expect(bodyText).not.toContain('[object Object]');
    expect(messageTypes).toContain('SAVE_SYNC_CONFIG');
    expect(messageTypes).not.toContain('WEBDAV_TEST');
  });

  it('sanitizes rejected WebDAV test errors without disabling Data sync controls', async () => {
    stubEnglishChrome({
      runtimeMessages: createDataSettingsRuntimeMessages({
        SAVE_SYNC_CONFIG: { ok: true },
        WEBDAV_TEST: () => ({
          ok: false,
          error: { message: 'WEBDAV_TEST schemaVersion chrome.runtime denied Cookie secret' },
        }),
      }),
    });
    await renderWithI18n(React.createElement(SettingsPage, { activeSubTab: 'data' }));
    await flushPolishApp();

    const testButton = getButtonByText('Test connection');
    expect(testButton).toBeTruthy();
    await act(async () => {
      testButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    const bodyText = container.textContent ?? '';
    const syncButtons = Array.from(container.querySelectorAll('.ds-data-sync-actions button')) as HTMLButtonElement[];
    expect(bodyText).toContain('Connection failed');
    expect(bodyText).not.toContain('Connection succeeded');
    expect(bodyText).not.toContain('WEBDAV_TEST');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.runtime');
    expect(bodyText).not.toContain('Cookie');
    expect(syncButtons).toHaveLength(3);
    expect(syncButtons.every((button) => button.disabled)).toBe(false);
  });

  it('keeps Usage settings factual instead of dashboard-heavy', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        GET_USAGE_SUMMARY: createUsageSummaryStub(),
      },
    });
    await renderWithI18n(React.createElement(UsageSubPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Overview');
    expect(container.textContent).toContain('Recent activity');
    expect(container.textContent).toContain('Model usage');
    expect(container.textContent).toContain('Server samples 2/3');
    expect(container.querySelector('.usage-fact-row')).toBeTruthy();
    expect(container.querySelector('.usage-model-value')).toBeTruthy();
    expect(container.querySelector('.usage-metric-cell')).toBeNull();
    expect(container.querySelector('.usage-heatmap-grid')).toBeNull();
    expect(container.querySelector('.usage-bars')).toBeNull();
    expect(container.querySelector('.usage-donut')).toBeNull();

    const usageSubPage = readFileSync('entrypoints/sidepanel/components/settings/UsageSubPage.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const toolbarLabelBlock = getCssBlock(css, '.usage-toolbar-label');
    const factValueBlock = getCssBlock(css, '.usage-fact-value');

    expect(usageSubPage).toContain('UsageOverview');
    expect(usageSubPage).toContain('UsageActivity');
    expect(usageSubPage).toContain('UsageModels');
    expect(usageSubPage).toContain('ds-btn-danger usage-clear-button');
    expect(usageSubPage).not.toContain('usage-dashboard');
    expect(usageSubPage).not.toContain('MODEL_COLORS');
    expect(usageSubPage).not.toContain('UsageHeatmap');
    expect(usageSubPage).not.toContain('UsageDailyTrend');
    expect(usageSubPage).not.toContain('UsageModelSplit');
    expect(usageSubPage).not.toContain('toFixed(2)');
    expect(JSON.stringify(localeResources.en.sidepanel.settings.usage)).not.toMatch(/heatmap|Daily token trend|Less|More/);
    expect(css).not.toContain('.usage-metric-value');
    expect(css).not.toContain('.usage-heat-cell');
    expect(css).not.toContain('.usage-bars');
    expect(css).not.toContain('.usage-donut');
    expect(toolbarLabelBlock).not.toContain('text-transform');
    expect(toolbarLabelBlock).not.toContain('letter-spacing: 0.08em');
    expect(factValueBlock).toContain('font-size: 13px');
  });

  it('keeps Usage load failures retryable without showing a false empty state', async () => {
    let summaryCalls = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_USAGE_SUMMARY: () => {
          summaryCalls += 1;
          return summaryCalls === 1
            ? { ok: false, error: { message: 'GET_USAGE_SUMMARY schemaVersion storage unavailable' } }
            : createUsageSummaryStub();
        },
      },
    });
    await renderWithI18n(React.createElement(UsageSubPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Failed to load usage statistics');
    expect(container.textContent).toContain('Retry');
    expect(container.textContent).not.toContain('No usage statistics yet');
    expect(container.textContent).not.toContain('GET_USAGE_SUMMARY');
    expect(container.textContent).not.toContain('schemaVersion');

    await act(async () => {
      getButtonByText('Retry')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(summaryCalls).toBe(2);
    expect(container.textContent).toContain('Overview');
    expect(container.textContent).toContain('Server samples 2/3');
    expect(container.textContent).not.toContain('Failed to load usage statistics');
  });

  it('does not report Usage stats cleared when the runtime rejects the clear action', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        GET_USAGE_SUMMARY: createUsageSummaryStub(),
        CLEAR_USAGE_STATS: () => ({
          ok: false,
          error: { message: 'CLEAR_USAGE_STATS chrome.storage denied [object Object]' },
        }),
      },
    });
    await renderWithI18n(React.createElement(UsageSubPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Overview');
    expect(container.textContent).toContain('Clear stats');

    await act(async () => {
      getButtonByText('Clear stats')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const confirmButton = document.body.querySelector('.ds-modal-actions .ds-btn-danger') as HTMLButtonElement | null;
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Failed to clear usage statistics');
    expect(container.textContent).toContain('Overview');
    expect(container.textContent).toContain('Server samples 2/3');
    expect(container.textContent).not.toContain('Usage statistics cleared');
    expect(container.textContent).not.toContain('CLEAR_USAGE_STATS');
    expect(container.textContent).not.toContain('[object Object]');
  });

  it('keeps About settings as quiet product information', async () => {
    stubEnglishChrome();
    await renderWithI18n(React.createElement(AboutSubPage, {
      state: createAboutStateStub({ version: '1.0.5' }),
    }));

    expect(container.textContent).toContain('DeepSeek++');
    expect(container.textContent).toContain('Memory, commands, browser context, and long-running missions.');
    expect(container.textContent).toContain('Version');
    expect(container.textContent).toContain('v1.0.5');
    expect(container.textContent).toContain('GitHub repository');
    expect(container.querySelector('.ds-about-mark')).toBeTruthy();
    expect(container.querySelector('.ds-about-row')).toBeTruthy();
    expect(container.querySelector('.ds-about-link')?.getAttribute('href')).toBe('https://github.com/zhu1090093659/deepseek-pp');

    const aboutSubPage = readFileSync('entrypoints/sidepanel/components/settings/AboutSubPage.tsx', 'utf8');
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const markBlock = getCssBlock(css, '.ds-about-mark');

    expect(aboutSubPage).not.toContain("description={t('sidepanel.settings.aboutTagline')}");
    expect(aboutSubPage).not.toContain("background: 'var(--ds-blue)'");
    expect(aboutSubPage).not.toContain('text-white');
    expect(markBlock).toContain('border: 1px solid var(--ds-border-hover)');
    expect(markBlock).toContain('background: var(--ds-bg)');
    expect(markBlock).not.toContain('var(--ds-blue)');
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
          description: 'Summarize long source material into a concise brief with evidence notes and follow-up questions for review.',
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
    const groupToggle = container.querySelector('button[aria-label="Expand Built-in commands"]') as HTMLButtonElement | null;
    expect(groupToggle).toBeTruthy();

    await act(async () => {
      groupToggle?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('/summarize');
    expect(container.textContent).toContain('On');
    expect(container.querySelector('button[aria-label="Disable summarize"]')).toBeNull();
    expect(container.textContent).not.toContain('Turn off');
    expect(container.textContent).toContain('Summarize long source material');
    expect(container.textContent).not.toContain('follow-up questions for review.');

    const descriptionToggle = Array.from(container.querySelectorAll('.ds-skill-description-toggle')).find(
      (button) => button.textContent === 'Details',
    ) as HTMLButtonElement | undefined;
    expect(descriptionToggle).toBeTruthy();
    expect(descriptionToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(descriptionToggle?.getAttribute('aria-controls')).toBeTruthy();

    await act(async () => {
      descriptionToggle?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('follow-up questions for review.');
    const descriptionId = descriptionToggle?.getAttribute('aria-controls');
    expect(descriptionId ? document.getElementById(descriptionId) : null).toBeTruthy();
  });

  it('shows an honest command loading state without skeleton rows', async () => {
    stubEnglishChromePendingSkills();
    await renderWithI18n(React.createElement(SkillPage));

    const statusCard = container.querySelector<HTMLElement>('.ds-command-status-card[data-slot="card"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.getAttribute('data-state')).toBe('checking');
    expect(statusCard?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent).toBe('Checking');
    expect(statusCard?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    expect(container.querySelector('.ds-skill-loading')).toBeTruthy();
    expect(container.textContent).toContain('Loading commands...');
    expect(container.querySelector('.ds-skeleton')).toBeNull();
    expect(container.querySelector('.ds-card.ds-skill-card')).toBeNull();
  });

  it('surfaces retryable command library load failure instead of a false empty state', async () => {
    let loads = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_SKILL_LIBRARY: () => {
          loads += 1;
          if (loads === 1) throw new Error('command store offline');
          return [{
            name: 'review-command',
            description: 'Review changes for blocking issues.',
            instructions: 'Review first.',
            source: 'custom',
            memoryEnabled: false,
            enabled: true,
          }];
        },
        GET_SKILL_SOURCES: [],
      },
    });
    await renderWithI18n(React.createElement(SkillPage));
    await flushPolishApp();

    let bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Commands unavailable');
    expect(bodyText).toContain('Command library could not load: command store offline');
    expect(bodyText).toContain('Retry before assuming no commands are installed.');
    expect(bodyText).toContain('Retry command library before assuming it is empty.');
    expect(bodyText).not.toContain('No commands installed yet.');
    expect(bodyText).not.toContain('0/0 on');
    const statusCard = container.querySelector<HTMLElement>('.ds-command-status-card[data-slot="card"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.getAttribute('data-state')).toBe('attention');
    expect(statusCard?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent).toBe('Needs refresh');
    expect(statusCard?.querySelector('[data-slot="card-description"]')?.textContent).toBe('Command library needs a refresh before commands can be trusted.');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Unavailable');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Retry command library before assuming it is empty.');

    const retryButtons = Array.from(container.querySelectorAll('button')).filter((button) => button.textContent === 'Retry');
    expect(retryButtons).toHaveLength(1);
    const retryButton = retryButtons[0];
    expect(retryButton).toBeTruthy();
    await act(async () => {
      retryButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(loads).toBe(2);
    expect(bodyText).toContain('/review-command');
    expect(bodyText).toContain('1/1 on');
    expect(bodyText).not.toContain('Commands unavailable');
    expect(bodyText).not.toContain('command store offline');
  });

  it('sanitizes raw command library load failures without showing a false empty state', async () => {
    let loads = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_SKILL_LIBRARY: () => {
          loads += 1;
          if (loads === 1) {
            return {
              ok: false,
              error: { message: 'GET_SKILL_LIBRARY schemaVersion chrome.storage deepseek_pp_skills token secret [object Object]' },
            };
          }
          return [{
            name: 'raw-review',
            description: 'Review changes for leaks.',
            instructions: 'Review first.',
            source: 'custom',
            memoryEnabled: false,
            enabled: true,
          }];
        },
        GET_SKILL_SOURCES: [],
      },
    });
    await renderWithI18n(React.createElement(SkillPage));
    await flushPolishApp();

    let bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Commands unavailable');
    expect(bodyText).toContain('Command library could not load: Command backend is unavailable. Reload the extension and try again.');
    expect(bodyText).toContain('Retry before assuming no commands are installed.');
    expect(bodyText).toContain('Retry command library before assuming it is empty.');
    expect(bodyText).not.toContain('No commands installed yet.');
    expect(bodyText).not.toContain('0/0 on');
    expect(bodyText).not.toContain('GET_SKILL_LIBRARY');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('deepseek_pp_skills');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');
    expect(container.querySelector<HTMLElement>('.ds-command-status-card')?.getAttribute('data-state')).toBe('attention');
    expect(container.querySelector<HTMLElement>('.ds-command-status-card [data-slot="card-description"]')?.textContent).toBe('Command library needs a refresh before commands can be trusted.');

    const retryButtons = Array.from(container.querySelectorAll('button')).filter((button) => button.textContent === 'Retry');
    expect(retryButtons).toHaveLength(1);
    const retryButton = retryButtons[0];
    expect(retryButton).toBeTruthy();
    await act(async () => {
      retryButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(loads).toBe(2);
    expect(bodyText).toContain('/raw-review');
    expect(bodyText).toContain('1/1 on');
    expect(bodyText).not.toContain('Commands unavailable');
  });

  it('keeps loaded commands visible when command sources cannot load', async () => {
    let sourceLoads = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_SKILL_LIBRARY: [{
          name: 'research',
          description: 'Search and summarize project references.',
          instructions: 'Use references.',
          source: 'remote',
          remote: {
            provider: 'github',
            sourceId: 'github-research',
            repository: 'acme/commands',
            ref: 'main',
            path: 'research/SKILL.md',
          },
          memoryEnabled: false,
          enabled: true,
        }],
        GET_SKILL_SOURCES: () => {
          sourceLoads += 1;
          if (sourceLoads === 1) return { ok: false, error: { message: 'source registry offline' } };
          return [{
            id: 'github-research',
            provider: 'github',
            url: 'https://github.com/acme/commands',
            owner: 'acme',
            repo: 'commands',
            repository: 'acme/commands',
            ref: 'main',
            rootPath: '',
            commitSha: 'abcdef123456',
            defaultBranch: 'main',
            repoUrl: 'https://github.com/acme/commands',
            skillPaths: ['research/SKILL.md'],
            importedSkillNames: ['research'],
            importedAt: 1,
            updatedAt: 2,
          }];
        },
      },
    });
    await renderWithI18n(React.createElement(SkillPage));
    await flushPolishApp();

    let bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Command sources unavailable');
    expect(bodyText).toContain('Command sources could not load: source registry offline');
    expect(bodyText).toContain('Loaded commands remain usable. Retry before managing imported sources.');
    expect(bodyText).toContain('Retry imported sources before managing them.');
    expect(bodyText).toContain('/research');
    expect(bodyText).not.toContain('No commands installed yet.');
    const statusCard = container.querySelector<HTMLElement>('.ds-command-status-card[data-slot="card"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.getAttribute('data-state')).toBe('attention');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('1/1 on');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Needs refresh');

    const retryButtons = Array.from(container.querySelectorAll('button')).filter((button) => button.textContent === 'Retry');
    expect(retryButtons).toHaveLength(1);
    const retryButton = retryButtons[0];
    expect(retryButton).toBeTruthy();
    await act(async () => {
      retryButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(sourceLoads).toBe(2);
    expect(bodyText).toContain('/research');
    expect(bodyText).toContain('Check');
    expect(bodyText).not.toContain('Command sources unavailable');
    expect(bodyText).not.toContain('source registry offline');
  });

  it('sanitizes raw command source load failures while keeping commands visible', async () => {
    let sourceLoads = 0;
    stubEnglishChrome({
      runtimeMessages: {
        GET_SKILL_LIBRARY: [{
          name: 'research',
          description: 'Search and summarize project references.',
          instructions: 'Use references.',
          source: 'remote',
          remote: {
            provider: 'github',
            sourceId: 'github-research',
            repository: 'acme/commands',
            ref: 'main',
            path: 'research/SKILL.md',
          },
          memoryEnabled: false,
          enabled: true,
        }],
        GET_SKILL_SOURCES: () => {
          sourceLoads += 1;
          if (sourceLoads === 1) {
            return {
              ok: false,
              error: { message: 'GET_SKILL_SOURCES schemaVersion chrome.runtime deepseek_pp_skill_sources token secret [object Object]' },
            };
          }
          return [createGitHubSkillSourceForPolish()];
        },
      },
    });
    await renderWithI18n(React.createElement(SkillPage));
    await flushPolishApp();

    let bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Command sources unavailable');
    expect(bodyText).toContain('Command sources could not load: Command backend is unavailable. Reload the extension and try again.');
    expect(bodyText).toContain('Loaded commands remain usable. Retry before managing imported sources.');
    expect(bodyText).toContain('Retry imported sources before managing them.');
    expect(bodyText).toContain('/research');
    expect(bodyText).not.toContain('No commands installed yet.');
    expect(bodyText).not.toContain('GET_SKILL_SOURCES');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.runtime');
    expect(bodyText).not.toContain('deepseek_pp_skill_sources');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');
    expect(container.querySelector<HTMLElement>('.ds-command-status-card')?.getAttribute('data-state')).toBe('attention');

    const retryButtons = Array.from(container.querySelectorAll('button')).filter((button) => button.textContent === 'Retry');
    expect(retryButtons).toHaveLength(1);
    const retryButton = retryButtons[0];
    expect(retryButton).toBeTruthy();
    await act(async () => {
      retryButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(sourceLoads).toBe(2);
    expect(bodyText).toContain('/research');
    expect(bodyText).toContain('Check');
    expect(bodyText).not.toContain('Command sources unavailable');
  });

  it('preserves command rows and forms when command actions fail', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        GET_SKILL_LIBRARY: [{
          name: 'review-command',
          description: 'Review changes for blocking issues.',
          instructions: 'Review first.',
          source: 'custom',
          memoryEnabled: false,
          enabled: true,
        }],
        GET_SKILL_SOURCES: [],
        SET_SKILL_ENABLED: () => ({ ok: false, error: { message: 'toggle offline' } }),
        DELETE_SKILL: () => ({ ok: false, error: { message: 'delete offline' } }),
        SAVE_SKILL: () => ({ ok: false, error: { message: 'save offline' } }),
      },
    });
    await renderWithI18n(React.createElement(SkillPage));
    await flushPolishApp();

    const toggleButton = container.querySelector('button[aria-label="Disable review-command"]') as HTMLButtonElement | null;
    expect(toggleButton).toBeTruthy();
    await act(async () => {
      toggleButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    let bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Command action failed: toggle offline');
    expect(bodyText).toContain('/review-command');
    expect(bodyText).toContain('On');

    const deleteButton = container.querySelector('button[aria-label="Delete review-command"]') as HTMLButtonElement | null;
    expect(deleteButton).toBeTruthy();
    await act(async () => {
      deleteButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Command action failed: delete offline');
    expect(bodyText).toContain('/review-command');

    const newButton = getButtonByText('New');
    expect(newButton).toBeTruthy();
    await act(async () => {
      newButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).not.toContain('delete offline');

    const nameInput = container.querySelector('input[placeholder="Name, e.g. research-note"]') as HTMLInputElement | null;
    const descriptionInput = container.querySelector('input[placeholder="What this command should help with"]') as HTMLInputElement | null;
    const instructionsInput = container.querySelector('.ds-command-form textarea') as HTMLTextAreaElement | null;
    expect(nameInput).toBeTruthy();
    expect(descriptionInput).toBeTruthy();
    expect(instructionsInput).toBeTruthy();
    expect(nameInput?.getAttribute('data-slot')).toBe('input');
    expect(descriptionInput?.getAttribute('data-slot')).toBe('input');
    expect(instructionsInput?.getAttribute('data-slot')).toBe('textarea');
    const formButtons = Array.from(container.querySelectorAll('.ds-command-form-actions [data-slot="button"]'));
    expect(formButtons.map((button) => button.getAttribute('data-variant'))).toEqual(['outline', 'default']);
    await setInputValue(nameInput!, 'risk-reviewer');
    await setInputValue(descriptionInput!, 'Find blocking issues first.');
    await setInputValue(instructionsInput!, 'Review P1/P2 risks before style.');

    const saveButton = getButtonByText('Save');
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Command action failed: save offline');
    expect(container.querySelector('.ds-command-form')).toBeTruthy();
    expect(nameInput!.value).toBe('risk-reviewer');
    expect(descriptionInput!.value).toBe('Find blocking issues first.');
    expect(instructionsInput!.value).toBe('Review P1/P2 risks before style.');
  });

  it('sanitizes raw command action failures while preserving rows and forms', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        GET_SKILL_LIBRARY: [{
          name: 'privacy-command',
          description: 'Review changes for privacy leaks.',
          instructions: 'Review leaks first.',
          source: 'custom',
          memoryEnabled: false,
          enabled: true,
        }],
        GET_SKILL_SOURCES: [],
        SET_SKILL_ENABLED: () => ({
          ok: false,
          error: { message: 'SET_SKILL_ENABLED schemaVersion chrome.storage deepseek_pp_skills token secret [object Object]' },
        }),
        DELETE_SKILL: () => ({
          ok: false,
          error: { message: 'DELETE_SKILL schemaVersion chrome.storage deepseek_pp_skills secret' },
        }),
        SAVE_SKILL: () => ({
          ok: false,
          error: { message: 'SAVE_SKILL Authorization Bearer sk-command-secret apiKey token' },
        }),
      },
    });
    await renderWithI18n(React.createElement(SkillPage));
    await flushPolishApp();

    const toggleButton = container.querySelector('button[aria-label="Disable privacy-command"]') as HTMLButtonElement | null;
    expect(toggleButton).toBeTruthy();
    await act(async () => {
      toggleButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    let bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Command action failed: Command backend is unavailable. Reload the extension and try again.');
    expect(bodyText).toContain('/privacy-command');
    expect(bodyText).toContain('On');
    expect(bodyText).not.toContain('SET_SKILL_ENABLED');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('deepseek_pp_skills');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');

    const deleteButton = container.querySelector('button[aria-label="Delete privacy-command"]') as HTMLButtonElement | null;
    expect(deleteButton).toBeTruthy();
    await act(async () => {
      deleteButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Command action failed: Command backend is unavailable. Reload the extension and try again.');
    expect(bodyText).toContain('/privacy-command');
    expect(bodyText).not.toContain('DELETE_SKILL');

    const newButton = getButtonByText('New');
    expect(newButton).toBeTruthy();
    await act(async () => {
      newButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const nameInput = container.querySelector('input[placeholder="Name, e.g. research-note"]') as HTMLInputElement | null;
    const descriptionInput = container.querySelector('input[placeholder="What this command should help with"]') as HTMLInputElement | null;
    const instructionsInput = container.querySelector('.ds-command-form textarea') as HTMLTextAreaElement | null;
    expect(nameInput).toBeTruthy();
    expect(descriptionInput).toBeTruthy();
    expect(instructionsInput).toBeTruthy();
    expect(instructionsInput?.getAttribute('data-slot')).toBe('textarea');
    await setInputValue(nameInput!, 'raw-reviewer');
    await setInputValue(descriptionInput!, 'Find backend leaks first.');
    await setInputValue(instructionsInput!, 'Keep command errors safe.');

    const saveButton = getButtonByText('Save');
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Command action failed: Command backend is unavailable. Reload the extension and try again.');
    expect(container.querySelector('.ds-command-form')).toBeTruthy();
    expect(nameInput!.value).toBe('raw-reviewer');
    expect(descriptionInput!.value).toBe('Find backend leaks first.');
    expect(instructionsInput!.value).toBe('Keep command errors safe.');
    expect(bodyText).not.toContain('SAVE_SKILL');
    expect(bodyText).not.toContain('Authorization');
    expect(bodyText).not.toContain('Bearer');
    expect(bodyText).not.toContain('sk-command-secret');
    expect(bodyText).not.toContain('apiKey');
    expect(bodyText).not.toContain('token');
  });

  it('keeps medium command descriptions recoverable when they can overflow a sidepanel row', async () => {
    const description = 'Use this command when a task needs careful setup, source checks, and concise review notes.';
    expect(description.length).toBeLessThanOrEqual(96);
    stubEnglishChrome({
      skills: [
        {
          name: 'review-brief',
          description,
          instructions: 'Review briefly',
          source: 'builtin',
          memoryEnabled: false,
          enabled: true,
        },
      ],
    });
    await renderWithI18n(React.createElement(SkillPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const groupToggle = container.querySelector('button[aria-label="Expand Built-in commands"]') as HTMLButtonElement | null;
    expect(groupToggle).toBeTruthy();
    await act(async () => {
      groupToggle?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Use this command when a task needs careful setup');
    expect(container.textContent).not.toContain('concise review notes.');
    const descriptionToggle = Array.from(container.querySelectorAll('.ds-skill-description-toggle')).find(
      (button) => button.textContent === 'Details',
    ) as HTMLButtonElement | undefined;
    expect(descriptionToggle).toBeTruthy();

    await act(async () => {
      descriptionToggle?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('concise review notes.');
  });

  it('shows description disclosure when rendered width clips a short command description', async () => {
    const description = 'Short command description that still clips in a narrow panel.';
    expect(description.length).toBeLessThanOrEqual(72);
    const scrollWidthSpy = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function getScrollWidth(this: HTMLElement) {
      return this.classList.contains('ds-skill-description-preview') ? 220 : 0;
    });
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function getClientWidth(this: HTMLElement) {
      return this.classList.contains('ds-skill-description-preview') ? 120 : 0;
    });

    try {
      stubEnglishChrome({
        skills: [
          {
            name: 'narrow-panel',
            description,
            instructions: 'Handle narrow panels',
            source: 'builtin',
            memoryEnabled: false,
            enabled: true,
          },
        ],
      });
      await renderWithI18n(React.createElement(SkillPage));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const groupToggle = container.querySelector('button[aria-label="Expand Built-in commands"]') as HTMLButtonElement | null;
      expect(groupToggle).toBeTruthy();
      await act(async () => {
        groupToggle?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const descriptionToggle = Array.from(container.querySelectorAll('.ds-skill-description-toggle')).find(
        (button) => button.textContent === 'Details',
      ) as HTMLButtonElement | undefined;
      expect(descriptionToggle).toBeTruthy();
      expect(descriptionToggle?.getAttribute('aria-expanded')).toBe('false');

      await act(async () => {
        descriptionToggle?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(descriptionToggle?.textContent).toBe('Hide details');
      expect(descriptionToggle?.getAttribute('aria-expanded')).toBe('true');
    } finally {
      scrollWidthSpy.mockRestore();
      clientWidthSpy.mockRestore();
    }
  });

  it('renders the skill overview from the real library and source registry', async () => {
    stubEnglishChrome({
      skills: [
        {
          name: 'summarize',
          description: 'Summarize content',
          instructions: 'Summarize: {input}',
          source: 'builtin',
          memoryEnabled: false,
          enabled: true,
        },
        {
          name: 'research',
          description: 'Research with evidence',
          instructions: 'Research with evidence',
          source: 'remote',
          memoryEnabled: false,
          enabled: false,
          remote: {
            provider: 'github',
            sourceId: 'github-acme',
            repository: 'acme/skills',
            ref: 'main',
            commitSha: 'abcdef123456',
            path: 'research/SKILL.md',
            originalName: 'research',
            importedAt: 1,
            updatedAt: 2,
            includedFiles: [],
            omittedFiles: [],
            warnings: [],
          },
        },
        {
          name: 'kevin-style',
          description: 'Use saved project rules',
          instructions: 'Use saved project rules',
          source: 'custom',
          memoryEnabled: true,
          enabled: true,
        },
      ],
      sources: [
        {
          id: 'github-acme',
          provider: 'github',
          url: 'https://github.com/acme/skills',
          owner: 'acme',
          repo: 'skills',
          repository: 'acme/skills',
          ref: 'main',
          rootPath: '',
          commitSha: 'abcdef123456',
          defaultBranch: 'main',
          repoUrl: 'https://github.com/acme/skills',
          skillPaths: ['research/SKILL.md'],
          importedSkillNames: ['research'],
          importedAt: 1,
          updatedAt: 2,
        },
        {
          id: 'local-user',
          provider: 'local',
          rootPath: '/Users/kyin/skills',
          displayName: 'Local Skills',
          directoryName: 'skills',
          skillPaths: ['kevin-style/SKILL.md'],
          importedSkillNames: ['kevin-style'],
          importedAt: 1,
          updatedAt: 2,
          warnings: [],
        },
      ],
    });
    await renderWithI18n(React.createElement(SkillPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[aria-label="Command library controls"]')).toBeTruthy();
    const overview = container.querySelector<HTMLElement>('.ds-skill-overview');
    expect(overview).toBeTruthy();
    const searchInput = overview?.querySelector<HTMLInputElement>('.ds-skill-search [data-slot="input"]');
    expect(searchInput).toBeTruthy();
    expect(searchInput?.closest('[data-slot="field"]')).toBeTruthy();
    const filterRow = overview?.querySelector<HTMLElement>('.ds-skill-filter-row[data-slot="toggle-group"]');
    expect(filterRow).toBeTruthy();
    expect(filterRow?.querySelectorAll('[data-slot="toggle-group-item"]')).toHaveLength(3);
    const addButtons = Array.from(overview?.querySelectorAll<HTMLButtonElement>('.ds-skill-action-row [data-slot="button"].ds-skill-add-button') ?? []);
    expect(addButtons.map((button) => button.getAttribute('data-variant'))).toEqual(['outline', 'outline', 'default']);
    expect(addButtons.map((button) => button.getAttribute('data-size'))).toEqual(['sm', 'sm', 'sm']);
    expect(addButtons.every((button) => Boolean(button.querySelector('[data-icon="inline-start"]')))).toBe(true);
    const statusCard = container.querySelector<HTMLElement>('.ds-command-status-card[data-slot="card"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.getAttribute('data-state')).toBe('ready');
    expect(statusCard?.querySelector('[data-slot="card-title"]')?.textContent).toBe('Command status');
    expect(statusCard?.querySelector('[data-slot="card-description"]')?.textContent).toBe('Enabled commands are available from Ask.');
    expect(statusCard?.querySelector('[data-slot="card-action"] [data-slot="badge"]')?.textContent).toBe('Ready');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Commands');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('2/3 on');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('2 sources');
    expect(statusCard?.querySelector('[data-slot="card-content"]')?.textContent).toContain('Type / in Ask to insert an enabled command.');
    expect(container.textContent).toContain('2/3 on');
    expect(container.textContent).toContain('1 off · 2 sources');
    expect(localeResources.en.sidepanel.skillPage.sourceEmptySummary).toBe('{disabled} off · no imported sources');
    expect(localeResources.en.sidepanel.skillPage.sectionThirdParty).toBe('Command sources');
    expect(container.textContent).toContain('Command sources');
    expect(container.textContent).not.toContain('Plugins');
    expect(container.textContent).not.toContain('0 imports');
    expect(container.textContent).toContain('All on');
    expect(container.textContent).toContain('All off');
    expect(container.textContent).not.toContain('Source management');
    expect(container.querySelector('.focus\\:ring-2')).toBeNull();
    expect(container.querySelector('.ds-command-group-toggle')).toBeTruthy();
    expect(container.querySelector('.ds-source-meta-line')).toBeNull();
    const commandGroupsBeforeExpansion = Array.from(container.querySelectorAll('.ds-command-group'));
    expect(commandGroupsBeforeExpansion[0]?.textContent).toContain('Custom commands');
    expect(commandGroupsBeforeExpansion[0]?.textContent).toContain('/kevin-style');
    expect(commandGroupsBeforeExpansion[0]?.textContent).toContain('Uses memory');
    expect(commandGroupsBeforeExpansion[0]?.textContent).toContain('Edit');
    expect(commandGroupsBeforeExpansion[0]?.textContent).toContain('Delete');
    expect(container.querySelector('button[aria-label="Turn off all commands in Custom commands"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Turn on all commands in acme/skills"]')).toBeTruthy();
    const customGroupAction = container.querySelector<HTMLElement>('button[aria-label="Turn off all commands in Custom commands"]');
    const githubGroupAction = container.querySelector<HTMLElement>('button[aria-label="Turn on all commands in acme/skills"]');
    const customCommandRow = commandGroupsBeforeExpansion[0]?.querySelector<HTMLElement>('.ds-command-row.ds-skill-card');
    expect(customGroupAction?.getAttribute('data-slot')).toBe('button');
    expect(customGroupAction?.getAttribute('data-variant')).toBe('destructive');
    expect(customGroupAction?.getAttribute('data-size')).toBe('sm');
    expect(githubGroupAction?.getAttribute('data-slot')).toBe('button');
    expect(githubGroupAction?.getAttribute('data-variant')).toBe('outline');
    expect(customCommandRow?.querySelectorAll('[data-slot="badge"]')).toHaveLength(1);
    const customRowButtons = Array.from(customCommandRow?.querySelectorAll<HTMLElement>('.ds-skill-card-actions [data-slot="button"]') ?? []);
    expect(customRowButtons.map((button) => button.getAttribute('data-variant'))).toEqual(['outline', 'outline', 'destructive']);
    expect(customRowButtons.map((button) => button.getAttribute('data-size'))).toEqual(['sm', 'sm', 'sm']);
    expect(container.querySelector('.ds-command-row.ds-skill-card')).toBeTruthy();
    expect(container.querySelector('.ds-card.ds-skill-card')).toBeNull();
    expect(container.querySelector('.ds-skill-overview.ds-surface-panel')).toBeNull();
    expect(container.querySelector('button[aria-label="Collapse Custom commands"]')).toBeTruthy();
    const githubToggle = container.querySelector('button[aria-label="Expand acme/skills"]') as HTMLButtonElement | null;
    expect(githubToggle).toBeTruthy();
    expect(githubToggle?.getAttribute('data-slot')).toBe('button');
    expect(githubToggle?.getAttribute('data-variant')).toBe('ghost');
    expect(githubToggle?.querySelector('[data-icon="inline-start"]')).toBeTruthy();

    await act(async () => {
      githubToggle?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('.ds-source-meta-line')).toBeTruthy();
    const githubGroup = Array.from(container.querySelectorAll('.ds-command-group')).find((panel) => {
      const text = panel.textContent ?? '';
      return text.includes('acme/skills') && text.includes('/research');
    });
    expect(githubGroup).toBeTruthy();
    expect(githubGroup?.querySelector('.ds-source-inline')).toBeTruthy();
    expect(githubGroup?.textContent).toContain('Check');
    expect(githubGroup?.textContent).toContain('Sync');
    expect(githubGroup?.textContent).toContain('Remove');
    const checkAction = githubGroup?.querySelector<HTMLElement>('button[aria-label="Check acme/skills"]');
    const syncAction = githubGroup?.querySelector<HTMLElement>('button[aria-label="Sync acme/skills"]');
    const removeAction = githubGroup?.querySelector<HTMLElement>('button[aria-label="Remove acme/skills"]');
    expect(checkAction).toBeTruthy();
    expect(syncAction).toBeTruthy();
    expect(removeAction).toBeTruthy();
    expect([checkAction, syncAction, removeAction].map((button) => button?.getAttribute('data-slot'))).toEqual(['button', 'button', 'button']);
    expect([checkAction, syncAction, removeAction].map((button) => button?.getAttribute('data-size'))).toEqual(['sm', 'sm', 'sm']);
    expect([checkAction, syncAction, removeAction].map((button) => button?.getAttribute('data-variant'))).toEqual(['outline', 'outline', 'destructive']);
    expect(container.querySelector('.ds-source-inline .ds-tag')).toBeNull();
    expect(container.querySelector('.ds-skill-metric')).toBeNull();
    expect(container.textContent).toContain('/research');
    expect(githubGroup?.textContent).not.toContain('research/SKILL.md');
    expect(container.textContent).not.toMatch(/mock|placeholder|sample/i);

    const input = container.querySelector('.ds-skill-search input') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'summarize');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).not.toContain('/research');
    expect(container.textContent).toContain('Imported sources');
    expect(container.querySelector('.ds-source-orphan .ds-source-inline')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Check acme/skills"]')).toBeTruthy();
    expect(container.textContent).not.toContain('Source management');
  });

  it('keeps source controls reachable when a GitHub source has no visible group', async () => {
    stubEnglishChrome({
      skills: [
        {
          name: 'summarize',
          description: 'Summarize content',
          instructions: 'Summarize: {input}',
          source: 'builtin',
          memoryEnabled: false,
          enabled: true,
        },
      ],
      sources: [
        {
          id: 'github-orphan',
          provider: 'github',
          url: 'https://github.com/acme/skills',
          owner: 'acme',
          repo: 'skills',
          repository: 'acme/skills',
          ref: 'main',
          rootPath: '',
          commitSha: 'abcdef123456',
          defaultBranch: 'main',
          repoUrl: 'https://github.com/acme/skills',
          skillPaths: ['research/SKILL.md'],
          importedSkillNames: ['research'],
          importedAt: 1,
          updatedAt: 2,
        },
      ],
    });
    await renderWithI18n(React.createElement(SkillPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Imported sources');
    expect(container.querySelector('.ds-source-orphan .ds-source-inline')).toBeTruthy();
    expect(container.textContent).toContain('acme/skills');
    expect(container.textContent).toContain('Check');
    expect(container.textContent).toContain('Sync');
    expect(container.textContent).toContain('Remove');

    const removeButton = container.querySelector('button[aria-label="Remove acme/skills"]') as HTMLButtonElement | null;
    expect(removeButton).toBeTruthy();
    await act(async () => {
      removeButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.querySelector('.ds-modal-title')?.textContent).toBe('Remove import from acme/skills?');
    expect(document.body.querySelector('.ds-modal-message')?.textContent).toBe(
      'This removes imported commands from the library (1). Custom commands are not affected.',
    );
    expect(Array.from(document.body.querySelectorAll('.ds-modal-actions [data-slot^="alert-dialog-"]')).map((button) => button.textContent)).toEqual([
      'Cancel',
      'Delete',
    ]);
    const cancelButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Cancel');
    await act(async () => {
      cancelButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it('sanitizes raw GitHub command source action failures', async () => {
    const source = createGitHubSkillSourceForPolish();
    stubEnglishChrome({
      skills: [
        {
          name: 'research',
          description: 'Research references.',
          instructions: 'Use references.',
          source: 'remote',
          remote: {
            provider: 'github',
            sourceId: source.id,
            repository: source.repository,
            ref: source.ref,
            path: 'research/SKILL.md',
          },
          memoryEnabled: false,
          enabled: true,
        },
      ],
      sources: [source],
      runtimeMessages: {
        CHECK_GITHUB_SKILL_SOURCE_UPDATES: () => ({
          ok: false,
          error: { message: 'CHECK_GITHUB_SKILL_SOURCE_UPDATES schemaVersion Authorization token secret [object Object]' },
        }),
        UPDATE_GITHUB_SKILL_SOURCE: () => ({
          ok: false,
          error: { message: 'UPDATE_GITHUB_SKILL_SOURCE chrome.storage Bearer sk-command-secret token' },
        }),
        DELETE_GITHUB_SKILL_SOURCE: () => ({
          ok: false,
          error: { message: 'DELETE_GITHUB_SKILL_SOURCE deepseek_pp_skill_sources schemaVersion secret' },
        }),
      },
    });
    await renderWithI18n(React.createElement(SkillPage));
    await flushPolishApp();

    const githubToggle = container.querySelector('button[aria-label="Expand acme/commands"]') as HTMLButtonElement | null;
    expect(githubToggle).toBeTruthy();
    await act(async () => {
      githubToggle?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    const checkButton = container.querySelector('button[aria-label="Check acme/commands"]') as HTMLButtonElement | null;
    const syncButton = container.querySelector('button[aria-label="Sync acme/commands"]') as HTMLButtonElement | null;
    const removeButton = container.querySelector('button[aria-label="Remove acme/commands"]') as HTMLButtonElement | null;
    expect(checkButton).toBeTruthy();
    expect(syncButton).toBeTruthy();
    expect(removeButton).toBeTruthy();

    await act(async () => {
      checkButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    let bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Update check failed');
    expect(bodyText).toContain('/research');
    expect(bodyText).not.toContain('CHECK_GITHUB_SKILL_SOURCE_UPDATES');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('Authorization');
    expect(bodyText).not.toContain('token');
    expect(bodyText).not.toContain('secret');
    expect(bodyText).not.toContain('[object Object]');

    await act(async () => {
      syncButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Sync failed');
    expect(bodyText).toContain('/research');
    expect(bodyText).not.toContain('UPDATE_GITHUB_SKILL_SOURCE');
    expect(bodyText).not.toContain('chrome.storage');
    expect(bodyText).not.toContain('Bearer');
    expect(bodyText).not.toContain('sk-command-secret');
    expect(bodyText).not.toContain('token');

    await act(async () => {
      removeButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const confirmButton = document.body.querySelector('.ds-modal-actions .ds-btn-danger') as HTMLButtonElement | null;
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushPolishApp();

    bodyText = container.textContent ?? '';
    expect(bodyText).toContain('Command backend is unavailable. Reload the extension and try again.');
    expect(bodyText).toContain('/research');
    expect(bodyText).toContain('acme/commands');
    expect(bodyText).not.toContain('DELETE_GITHUB_SKILL_SOURCE');
    expect(bodyText).not.toContain('deepseek_pp_skill_sources');
    expect(bodyText).not.toContain('schemaVersion');
    expect(bodyText).not.toContain('secret');
  });

  it('keeps command create and import flows compact and labeled', async () => {
    stubEnglishChrome();
    await renderWithI18n(React.createElement(SkillPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const buttons = () => Array.from(container.querySelectorAll('button'));
    const githubButton = buttons().find((button) => button.textContent === 'GitHub');
    expect(githubButton).toBeTruthy();
    expect(githubButton?.getAttribute('aria-label')).toBe('Import commands from GitHub');
    await act(async () => {
      githubButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('.ds-command-import-panel')).toBeTruthy();
    expect(container.querySelector('.ds-command-import-panel .ds-command-import-field[data-slot="field"]')).toBeTruthy();
    expect(container.querySelector('.ds-command-import-panel [data-slot="input"]')).toBeTruthy();
    expect(container.querySelectorAll('.ds-command-import-panel [data-slot="button"]')).toHaveLength(2);
    expect(container.textContent).toContain('Import commands from GitHub');
    expect(container.textContent).toContain('GitHub URL');
    expect(container.textContent).toContain('repository');
    expect(container.textContent).toContain('command file');
    expect(container.textContent).not.toContain('raw.githubusercontent.com');
    expect(container.textContent).not.toContain('SKILL.md');
    expect(container.querySelector('.ds-command-import-panel .ds-tag')).toBeNull();

    const localButton = buttons().find((button) => button.textContent === 'Local');
    expect(localButton).toBeTruthy();
    expect(localButton?.getAttribute('aria-label')).toBe('Import local commands');
    await act(async () => {
      localButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('.ds-command-import-panel')).toBeTruthy();
    expect(container.querySelector('.ds-command-import-panel .ds-command-import-field[data-slot="field"]')).toBeTruthy();
    expect(container.querySelector('.ds-command-import-panel [data-slot="input"]')).toBeTruthy();
    expect(container.querySelectorAll('.ds-command-import-panel [data-slot="button"]')).toHaveLength(3);
    expect(container.querySelector('.ds-command-import-panel [data-icon="inline-start"]')).toBeTruthy();
    expect(container.textContent).toContain('Import local commands');
    expect(container.textContent).toContain('Folder path');
    expect(container.textContent).toContain('command file');
    expect(container.textContent).toContain('supporting files');
    expect(container.textContent).toContain('Local access');
    expect(container.querySelector('.ds-command-import-panel .ds-tag')).toBeNull();

    const customButton = buttons().find((button) => button.textContent === 'New');
    expect(customButton).toBeTruthy();
    expect(customButton?.getAttribute('aria-label')).toBe('New custom command');
    await act(async () => {
      customButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('.ds-command-form')).toBeTruthy();
    expect(container.querySelector('.ds-command-form [data-slot="textarea"]')).toBeTruthy();
    expect(container.querySelectorAll('.ds-command-form-actions [data-slot="button"]')).toHaveLength(2);
    expect(container.textContent).toContain('Name');
    expect(container.textContent).toContain('Description');
    expect(container.textContent).toContain('Instructions');
    expect(container.textContent).toContain('Use saved memory');
    expect(container.textContent).toContain('Off');

    const skillPage = readFileSync('entrypoints/sidepanel/pages/SkillPage.tsx', 'utf8');
    const skillForm = readFileSync('entrypoints/sidepanel/components/SkillForm.tsx', 'utf8');
    const githubImport = readFileSync('entrypoints/sidepanel/components/GitHubSkillImportPanel.tsx', 'utf8');
    const localImport = readFileSync('entrypoints/sidepanel/components/LocalSkillImportPanel.tsx', 'utf8');
    expect(skillPage).toContain("from '@/components/ui/badge'");
    expect(skillPage).toContain("from '@/components/ui/button'");
    expect(skillPage).toContain("from '@/components/ui/card'");
    expect(skillPage).toContain("from '@/components/ui/skeleton'");
    expect(skillPage).toContain("from '@/components/ui/toggle-group'");
    expect(skillPage).toContain("from 'lucide-react'");
    expect(skillPage).toContain('TextField');
    expect(skillPage).toContain('<ToggleGroup');
    expect(skillPage).toContain('<ToggleGroupItem');
    const overviewSource = skillPage.slice(skillPage.indexOf('function SkillOverviewPanel'), skillPage.indexOf('function SkillGroupsPanel'));
    expect(overviewSource).not.toContain('<input');
    expect(overviewSource).not.toContain('<button');
    expect(overviewSource).not.toContain('<svg');
    expect(skillPage).toContain('function CommandsStatusCard');
    expect(skillPage).toContain('<CardHeader>');
    expect(skillPage).toContain('<CardFooter>');
    expect(skillPage).not.toContain('animate-slide-down');
    expect(skillPage).not.toContain('ds-surface-panel');
    const groupSource = skillPage.slice(skillPage.indexOf('function SkillGroupsPanel'), skillPage.indexOf('function UngroupedGitHubSourceSection'));
    const sourceControlsSource = skillPage.slice(skillPage.indexOf('function GitHubSourceControls'), skillPage.indexOf('function formatGroupState'));
    expect(groupSource).toContain('<Button');
    expect(groupSource).toContain('<ChevronRightIcon');
    expect(groupSource).not.toContain('<button');
    expect(groupSource).not.toContain('<svg');
    expect(sourceControlsSource).toContain('<Button');
    expect(sourceControlsSource).not.toContain('<button');
    const skillCardSource = readFileSync('entrypoints/sidepanel/components/SkillCard.tsx', 'utf8');
    expect(skillCardSource).toContain("from '@/components/ui/badge'");
    expect(skillCardSource).toContain("from '@/components/ui/button'");
    expect(skillCardSource).toContain('<Badge');
    expect(skillCardSource).toContain('<Button');
    expect(skillCardSource).not.toContain('<button');
    expect(skillForm).toContain('ds-command-form');
    expect(skillForm).toContain("from '@/components/ui/button'");
    expect(skillForm).toContain('TextAreaField');
    expect(skillForm).not.toContain('<textarea');
    expect(skillForm).not.toContain('<button');
    expect(skillForm).not.toContain('ds-form');
    expect(skillForm).not.toContain('rounded-xl');
    expect(skillForm).not.toContain('ToggleSwitch');
    expect(githubImport).toContain('ds-command-import-panel');
    expect(githubImport).toContain('ds-command-preview-row');
    expect(githubImport).toContain("from '@/components/ui/alert'");
    expect(githubImport).toContain("from '@/components/ui/badge'");
    expect(githubImport).toContain("from '@/components/ui/button'");
    expect(githubImport).toContain("from '@/components/ui/checkbox'");
    expect(githubImport).toContain('TextField');
    expect(githubImport).toContain('<Alert');
    expect(githubImport).toContain('<AlertDescription>');
    expect(githubImport).toContain('<Badge');
    expect(githubImport).toContain('onCheckedChange={() => onToggle()}');
    expect(githubImport).not.toContain('<input');
    expect(githubImport).not.toContain('<button');
    expect(githubImport).not.toContain('type="checkbox"');
    expect(githubImport).not.toContain('ds-card');
    expect(githubImport).not.toContain('ds-form');
    expect(githubImport).not.toContain('ds-tag');
    expect(localImport).toContain('ds-command-import-panel');
    expect(localImport).toContain('ds-command-preview-row');
    expect(localImport).toContain("from '@/components/ui/alert'");
    expect(localImport).toContain("from '@/components/ui/badge'");
    expect(localImport).toContain("from '@/components/ui/button'");
    expect(localImport).toContain("from '@/components/ui/checkbox'");
    expect(localImport).toContain("from 'lucide-react'");
    expect(localImport).toContain('TextField');
    expect(localImport).toContain('<Alert');
    expect(localImport).toContain('<AlertDescription>');
    expect(localImport).toContain('<Badge');
    expect(localImport).toContain('onCheckedChange={() => onToggle()}');
    expect(localImport).not.toContain('<input');
    expect(localImport).not.toContain('<button');
    expect(localImport).not.toContain('<svg');
    expect(localImport).not.toContain('FolderPickerIcon');
    expect(localImport).not.toContain('type="checkbox"');
    expect(localImport).not.toContain('ds-card');
    expect(localImport).not.toContain('ds-form');
    expect(localImport).not.toContain('ds-tag');
  });

  it('announces GitHub import results and prevents duplicate imports', async () => {
    const importedPayloads: unknown[] = [];
    stubEnglishChrome({
      runtimeMessages: {
        PREVIEW_GITHUB_SKILL_SOURCE: createGitHubSkillPreviewForPolish(),
        IMPORT_GITHUB_SKILL_SOURCE: (message: { payload?: unknown }) => {
          importedPayloads.push(message.payload);
          return createGitHubSkillImportResultForPolish();
        },
      },
    });
    await renderWithI18n(React.createElement(SkillPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      getButtonByText('GitHub')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const input = container.querySelector('#github-skill-import-url') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    await setInputValue(input!, 'https://github.com/acme/commands');

    await act(async () => {
      getButtonByText('Preview')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('/research');
    expect(container.textContent).toContain('Selected 1 / 1');
    expect(container.textContent).not.toContain('NaN');
    const warningStatus = container.querySelector('.ds-command-import-panel .ds-command-status-message[role="status"]');
    expect(warningStatus?.getAttribute('data-slot')).toBe('alert');
    expect(warningStatus?.getAttribute('data-tone')).toBe('warning');
    expect(warningStatus?.getAttribute('aria-live')).toBe('polite');
    expect(warningStatus?.querySelector('[data-slot="alert-description"]')?.textContent).toContain('Repository warning');
    const previewBadges = Array.from(container.querySelectorAll('.ds-command-preview-row [data-slot="badge"]'));
    expect(previewBadges).toHaveLength(2);
    expect(previewBadges.map((badge) => badge.getAttribute('data-variant')).join(',')).toBe('secondary,outline');
    expect(container.querySelector('[data-slot="checkbox"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="checkbox-indicator"]')).toBeTruthy();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    const checkbox = container.querySelector('[data-slot="checkbox"][role="checkbox"]') as HTMLButtonElement | null;
    expect(checkbox).toBeTruthy();
    expect(checkbox?.getAttribute('aria-checked')).toBe('true');
    const importButton = getButtonByText('Import selected commands') as HTMLButtonElement | null;
    expect(importButton).toBeTruthy();
    expect(importButton?.disabled).toBe(false);

    await act(async () => {
      checkbox?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(checkbox?.getAttribute('aria-checked')).toBe('false');
    expect(container.textContent).toContain('Selected 0 / 1');
    expect(importButton?.disabled).toBe(true);

    await act(async () => {
      const rowLabel = container.querySelector(`label[for="${checkbox?.id}"]`) as HTMLLabelElement | null;
      rowLabel?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(checkbox?.getAttribute('aria-checked')).toBe('true');
    expect(container.textContent).toContain('Selected 1 / 1');
    expect(importButton?.disabled).toBe(false);

    await act(async () => {
      importButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const status = Array.from(container.querySelectorAll('.ds-command-import-panel .ds-command-status-message[role="status"]'))
      .find((node) => node.textContent?.includes('Imported 1 commands'));
    expect(status?.getAttribute('data-slot')).toBe('alert');
    expect(status?.querySelector('[data-slot="alert-description"]')?.textContent).toContain('1 commands were renamed automatically');
    expect(status?.textContent).toContain('Imported 1 commands');
    const importButtonAfterSuccess = getButtonByText('Import selected commands') as HTMLButtonElement | null;
    expect(importButtonAfterSuccess?.disabled).toBe(true);

    await act(async () => {
      importButtonAfterSuccess?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(importedPayloads).toHaveLength(1);
  });

  it('announces local import errors and disables import after success', async () => {
    const importedPayloads: unknown[] = [];
    stubEnglishChrome({
      runtimeMessages: {
        PREVIEW_LOCAL_SKILL_SOURCE: createLocalSkillPreviewForPolish(),
        IMPORT_LOCAL_SKILL_SOURCE: (message: { payload?: unknown }) => {
          importedPayloads.push(message.payload);
          return createLocalSkillImportResultForPolish();
        },
      },
    });
    await renderWithI18n(React.createElement(SkillPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      getButtonByText('Local')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const input = container.querySelector('#local-skill-import-path') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    await setInputValue(input!, '/Users/me/.codex/skills/research');

    await act(async () => {
      getButtonByText('Preview')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('/research');
    expect(container.textContent).toContain('Selected 1 / 1');
    expect(container.textContent).not.toContain('NaN');
    const warningStatus = container.querySelector('.ds-command-import-panel .ds-command-status-message[role="status"]');
    expect(warningStatus?.getAttribute('data-slot')).toBe('alert');
    expect(warningStatus?.getAttribute('data-tone')).toBe('warning');
    expect(warningStatus?.getAttribute('aria-live')).toBe('polite');
    expect(warningStatus?.querySelector('[data-slot="alert-description"]')?.textContent).toContain('Local folder warning');
    const previewBadges = Array.from(container.querySelectorAll('.ds-command-preview-row [data-slot="badge"]'));
    expect(previewBadges).toHaveLength(2);
    expect(previewBadges.map((badge) => badge.getAttribute('data-variant')).join(',')).toBe('secondary,outline');
    expect(container.querySelector('[data-slot="checkbox"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="checkbox-indicator"]')).toBeTruthy();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    const checkbox = container.querySelector('[data-slot="checkbox"][role="checkbox"]') as HTMLButtonElement | null;
    expect(checkbox).toBeTruthy();
    expect(checkbox?.getAttribute('aria-checked')).toBe('true');
    const importButton = getButtonByText('Import selected commands') as HTMLButtonElement | null;
    expect(importButton).toBeTruthy();
    expect(importButton?.disabled).toBe(false);

    await act(async () => {
      checkbox?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(checkbox?.getAttribute('aria-checked')).toBe('false');
    expect(container.textContent).toContain('Selected 0 / 1');
    expect(importButton?.disabled).toBe(true);

    await act(async () => {
      const rowLabel = container.querySelector(`label[for="${checkbox?.id}"]`) as HTMLLabelElement | null;
      rowLabel?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(checkbox?.getAttribute('aria-checked')).toBe('true');
    expect(container.textContent).toContain('Selected 1 / 1');
    expect(importButton?.disabled).toBe(false);

    await act(async () => {
      importButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const status = Array.from(container.querySelectorAll('.ds-command-import-panel .ds-command-status-message[role="status"]'))
      .find((node) => node.textContent?.includes('Imported 1 local commands'));
    expect(status?.getAttribute('data-slot')).toBe('alert');
    expect(status?.querySelector('[data-slot="alert-description"]')?.textContent).toContain('1 commands were renamed automatically');
    expect(status?.textContent).toContain('Imported 1 local commands');
    const importButtonAfterSuccess = getButtonByText('Import selected commands') as HTMLButtonElement | null;
    expect(importButtonAfterSuccess?.disabled).toBe(true);

    await act(async () => {
      importButtonAfterSuccess?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(importedPayloads).toHaveLength(1);
  });

  it('announces command import preview failures as alerts', async () => {
    stubEnglishChrome({
      runtimeMessages: {
        PREVIEW_LOCAL_SKILL_SOURCE: { ok: false, error: 'Folder is not readable' },
      },
    });
    await renderWithI18n(React.createElement(SkillPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      getButtonByText('Local')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const input = container.querySelector('#local-skill-import-path') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    await setInputValue(input!, '/Users/me/missing');

    await act(async () => {
      getButtonByText('Preview')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.getAttribute('data-slot')).toBe('alert');
    expect(alert?.getAttribute('data-tone')).toBe('danger');
    expect(alert?.getAttribute('aria-live')).toBe('assertive');
    expect(alert?.querySelector('[data-slot="alert-description"]')?.textContent).toContain('Folder is not readable');
    expect(alert?.textContent).toContain('Folder is not readable');
  });

  it('keeps disabled skills readable and usage help compact', async () => {
    stubEnglishChrome({
      skills: [
        {
          name: 'ultra-think',
          description: 'Use this skill for maximum-depth reasoning mode',
          instructions: 'Think deeply',
          source: 'third-party',
          metadata: { provider: 'Focused commands' },
          memoryEnabled: false,
          enabled: false,
        },
      ],
    });
    await renderWithI18n(React.createElement(SkillPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const builtinToggle = container.querySelector('button[aria-label="Expand Focused commands"]') as HTMLButtonElement | null;
    expect(builtinToggle).toBeTruthy();
    await act(async () => {
      builtinToggle?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const disabledCard = container.querySelector('.ds-skill-card-disabled') as HTMLElement | null;
    const statusCard = container.querySelector<HTMLElement>('.ds-command-status-card[data-slot="card"]');
    expect(statusCard).toBeTruthy();
    expect(statusCard?.getAttribute('data-state')).toBe('off');
    expect(statusCard?.textContent).toContain('All off');
    expect(statusCard?.textContent).toContain('Turn on a command before using / in Ask.');
    expect(disabledCard).toBeTruthy();
    expect(disabledCard?.textContent).toContain('Off');
    expect(disabledCard?.textContent).toContain('Turn on');
    expect(disabledCard?.textContent).toContain('Use this command');
    expect(disabledCard?.textContent).not.toContain('Use this skill');
    expect(getComputedStyle(disabledCard!).opacity).toBe('1');
    expect(container.querySelector('.ds-skill-usage-panel')).toBeNull();
    expect(container.querySelector('.ds-skill-search')).toBeTruthy();
    expect(container.textContent).toContain('Off');
  });

  it('keeps skill rows compact and contrast-safe', () => {
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const cardBlock = getCssBlock(css, '.ds-skill-card');
    const commandStatusCardBlock = getCssBlock(css, '.ds-command-status-card');
    const commandStatusFooterBlock = getCssBlock(css, ".ds-command-status-card [data-slot='card-footer']");
    const commandStatusRowBlock = getCssBlock(css, '.ds-command-status-row {');
    const commandStatusSkeletonBlock = getCssBlock(css, '.ds-command-status-skeleton-line');
    const overviewBlock = getCssBlock(css, '.ds-skill-overview');
    const controlsBlock = getCssBlock(css, '.ds-skill-controls');
    const commandGroupBlock = getCssBlock(css, '.ds-command-group');
    const commandGroupHeaderBlock = getCssBlock(css, '.ds-command-group-header');
    const commandGroupToggleBlock = getCssBlock(css, '.ds-command-group-toggle');
    const commandGroupActionBlock = getCssBlock(css, '.ds-command-group-action');
    const commandFormButtonBlock = getCssBlock(css, '.ds-command-form-button');
    const commandImportFieldInlineBlock = getCssBlock(css, '.ds-command-import-field .ds-settings-control-inline');
    const commandImportActionRowBlock = getCssBlock(css, '.ds-command-import-action-row');
    const sourceActionBlock = getCssBlock(css, '.ds-source-action {');
    const rowMainBlock = getCssBlock(css, '.ds-skill-row-main');
    const triggerBlock = getCssBlock(css, '.ds-skill-row-identity .ds-trigger');
    const activeFilterBlock = getCssBlock(css, ".ds-skill-filter-row button[data-active='true']");
    const activeToggleFilterBlock = getCssBlock(css, ".ds-skill-filter-row [data-slot='toggle-group-item'][data-active='true']");
    const statusEnabledBlock = getCssBlock(css, '.ds-skill-status-enabled');
    const statusDisabledBlock = getCssBlock(css, '.ds-skill-status-disabled');
    const disabledTriggerBlock = getCssBlock(css, '.ds-skill-card-disabled .ds-trigger');
    const enableToggleBlock = getCssBlock(css, '.ds-skill-toggle-enable');
    const commandActionBlock = getCssBlock(css, '.ds-command-row-action');
    const commandEditBlock = getCssBlock(css, '.ds-command-row-edit');
    const commandDeleteBlock = getCssBlock(css, '.ds-command-row-delete');
    const descriptionPreviewBlock = getLastCssBlock(css, '.ds-skill-description-preview');
    const descriptionToggleHoverBlock = getCssBlock(css, '.ds-skill-description-toggle:hover');
    const sourceInlineBlock = getCssBlock(css, '.ds-source-inline');
    const sourceNeutralBlock = getCssBlock(css, ".ds-source-action-message[data-tone='neutral']");

    expect(cardBlock).toContain('padding: 6px 0');
    expect(commandStatusCardBlock).toContain('border-radius: var(--radius-card)');
    expect(commandStatusCardBlock).toContain('--card-spacing: 10px');
    expect(commandStatusFooterBlock).toContain('border-top-color: var(--ds-border)');
    expect(commandStatusRowBlock).toContain('grid-template-columns: minmax(74px, auto) minmax(0, 1fr)');
    expect(commandStatusSkeletonBlock).toContain('height: 12px');
    expect(overviewBlock).toContain('background: transparent');
    expect(overviewBlock).toContain('box-shadow: none');
    expect(overviewBlock).toContain('border-bottom: 1px solid var(--ds-border)');
    expect(controlsBlock).toContain('grid-template-columns: 1fr');
    expect(commandGroupBlock).toContain('border: 1px solid var(--ds-border-hover)');
    expect(commandGroupBlock).toContain('background: color-mix(in srgb, var(--ds-card) 76%, transparent)');
    expect(commandGroupHeaderBlock).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(commandGroupToggleBlock).toContain('background: transparent');
    expect(commandGroupToggleBlock).toContain('border: 0');
    expect(commandGroupActionBlock).toContain('min-height: 26px');
    expect(commandFormButtonBlock).toContain('min-height: 30px');
    expect(commandImportFieldInlineBlock).toContain('gap: 6px');
    expect(commandImportActionRowBlock).toContain('display: flex');
    expect(sourceActionBlock).toContain('min-height: 26px');
    expect(sourceActionBlock).toContain('font-size: 11px');
    expect(descriptionPreviewBlock).toContain('display: -webkit-box');
    expect(descriptionPreviewBlock).toContain('overflow: hidden');
    expect(descriptionPreviewBlock).toContain('color: var(--ds-text-secondary)');
    expect(descriptionPreviewBlock).toContain('overflow-wrap: anywhere');
    expect(descriptionPreviewBlock).toContain('-webkit-box-orient: vertical');
    expect(descriptionPreviewBlock).toContain('-webkit-line-clamp: 1');
    expect(rowMainBlock).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(triggerBlock).toContain('border: 1px solid');
    expect(triggerBlock).toContain('color: var(--ds-text)');
    expect(triggerBlock).toContain('max-width: min(100%, 172px)');
    expect(triggerBlock).toContain('text-overflow: ellipsis');
    expect(triggerBlock).toContain('white-space: nowrap');
    expect(triggerBlock).not.toContain('var(--ds-blue)');
    expect(activeFilterBlock).not.toContain('var(--ds-blue)');
    expect(activeToggleFilterBlock).not.toContain('var(--ds-blue)');
    expect(statusEnabledBlock).toContain('var(--ds-text-secondary)');
    expect(statusDisabledBlock).toContain('var(--ds-danger)');
    expect(statusDisabledBlock).toContain('var(--ds-danger-bg)');
    expect(disabledTriggerBlock).toContain('var(--ds-text-tertiary)');
    expect(enableToggleBlock).not.toContain('var(--ds-blue)');
    expect(commandActionBlock).toContain('min-height: 26px');
    expect(commandEditBlock).toContain('border: 1px solid var(--ds-border)');
    expect(commandDeleteBlock).toContain('border: 1px solid var(--ds-danger-border)');
    expect(commandDeleteBlock).toContain('color: var(--ds-danger)');
    expect(descriptionToggleHoverBlock).not.toContain('var(--ds-blue)');
    expect(sourceInlineBlock).toContain('padding: 9px 0 10px');
    expect(sourceInlineBlock).toContain('border-bottom: 1px solid');
    expect(sourceNeutralBlock).toContain('var(--ds-text-secondary)');
    expect(sourceNeutralBlock).not.toContain('var(--ds-success)');
    expect(css).toContain('.ds-command-row-delete:hover');
    expect(css).not.toContain('.ds-card.ds-skill-card:hover');
    expect(css).not.toContain('.ds-skill-status-badge::before');
    expect(css).toContain('.ds-skill-source-badge');
    const skillCard = readFileSync('entrypoints/sidepanel/components/SkillCard.tsx', 'utf8');
    expect(skillCard).toContain('ds-command-row');
    expect(skillCard).toContain('document.createRange()');
    expect(skillCard).toContain('normalizeCommandDescription');
    expect(skillCard).toContain("from '@/components/ui/badge'");
    expect(skillCard).toContain("from '@/components/ui/button'");
    expect(skillCard).not.toContain('<button');
    expect(skillCard).not.toContain('ds-card');
    expect(skillCard).not.toContain('SVG_PATHS');
  });

  it('keeps Home chat controls compact and state colors disciplined', () => {
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const homeContextBlock = getCssBlock(css, '.ds-chat-home-context');
    const activeVoiceBlock = getCssBlock(css, '.ds-chat-mic-button-active');
    const setupCardBlock = getCssBlock(css, '.ds-chat-setup-card');
    const setupActionsBlock = getCssBlock(css, '.ds-chat-setup-actions');
    const chatPageSource = readFileSync('entrypoints/sidepanel/pages/ChatPage.tsx', 'utf8');
    const chatPage = localeResources.en.sidepanel.chatPage;

    expect(chatPageSource).toContain("from '@/components/ui/card'");
    expect(chatPageSource).toContain("from '@/components/ui/alert'");
    expect(chatPageSource).toContain("from '@/components/ui/badge'");
    expect(chatPageSource).toContain("from '@/components/ui/skeleton'");
    expect(chatPageSource).toContain('<Alert className="ds-chat-suggestion-source-issue">');
    expect(chatPageSource).toContain('composerSuggestionSourcesNeedRefresh');
    expect(chatPageSource).toContain('<AlertDescription>');
    expect(chatPageSource).toContain('<AlertAction>');
    expect(chatPageSource).toContain('<Card');
    expect(chatPageSource).toContain('<CardHeader');
    expect(chatPageSource).toContain('<CardContent');
    expect(chatPageSource).toContain('<CardFooter');
    expect(chatPageSource).toContain('<Badge');
    expect(chatPageSource).toContain('<Skeleton');
    expect(chatPageSource).not.toContain('ds-chat-setup-panel');
    expect(chatPageSource).not.toContain('ds-btn-primary ds-chat-setup-button');
    expect(chatPageSource).not.toContain('ds-btn-secondary ds-chat-setup-button');
    expect(chatPageSource).not.toContain('<div className="ds-chat-suggestion-source-issue" role="alert">');
    expect(css).not.toContain('.ds-chat-setup-panel');
    expect(setupCardBlock).toContain('border: 1px solid');
    expect(setupCardBlock).toContain('background: var(--ds-card)');
    expect(setupActionsBlock).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(css).toContain('.ds-chat-mode-field');
    expect(homeContextBlock).not.toContain('border:');
    expect(homeContextBlock).not.toContain('background:');
    expect(activeVoiceBlock).toContain('var(--ds-blue)');
    expect(activeVoiceBlock).not.toContain('var(--ds-danger)');
    expect(chatPage.responseModeLabel).toBe('Response');
    expect(chatPage.responseProMax).toBe('Pro · Max');
    expect(chatPage.setupNeedsSetup).toBe('Needs setup');
  });

  it('keeps Context status compact and free of inventory-dashboard chrome', () => {
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const readinessBlock = getCssBlock(css, '.ds-intel-readiness');
    const statusRowBlock = getCssBlock(css, '.ds-intel-status-row');
    const statusValueBlock = getCssBlock(css, '.ds-intel-status-row strong');
    const actionBlock = getCssBlock(css, '.ds-intel-readiness-actions');

    expect(css).toContain('.ds-intel-readiness');
    expect(readinessBlock).toContain('display: grid');
    expect(readinessBlock).toContain('border: 1px solid');
    expect(statusRowBlock).toContain('grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.35fr)');
    expect(statusValueBlock).toContain('overflow-wrap: anywhere');
    expect(statusValueBlock).toContain('white-space: normal');
    expect(statusValueBlock).not.toContain('text-overflow: ellipsis');
    expect(actionBlock).toContain('max-content');
    expect(css).not.toContain('.ds-intel-metric');
    expect(css).not.toContain('.ds-intel-dashboard');
    const contextPage = readFileSync('entrypoints/sidepanel/pages/PersonalIntelligencePage.tsx', 'utf8');
    expect(contextPage).toContain("from '@/components/ui/alert'");
    expect(contextPage).toContain("from '@/components/ui/badge'");
    expect(contextPage).toContain("from '@/components/ui/button'");
    expect(contextPage).toContain("from '@/components/ui/empty'");
    expect(contextPage).toContain('<Alert className="ds-intel-section ds-intel-source-issues"');
    expect(contextPage).toContain('<Empty className="ds-intel-section ds-intel-empty-state">');
  });

  it('renders Projects status in English without fake readiness', async () => {
    const project = {
      id: 'project-alpha',
      name: 'Alpha',
      description: '',
      instructions: '',
      createdAt: 1,
      updatedAt: 1,
    };
    stubEnglishChrome({
      runtimeMessages: {
        GET_PROJECT_CONTEXT_STATE: {
          schemaVersion: 2,
          projects: [project],
          conversations: [{
            conversationId: 'session-1',
            title: 'Planning notes',
            url: 'https://chat.deepseek.com/chat/s/session-1',
            projectId: project.id,
            addedAt: 1,
            lastSeenAt: 2,
          }],
          pendingProjectId: null,
        },
        GET_MEMORIES: [],
        GET_CURRENT_DEEPSEEK_CONVERSATION: {
          ok: true,
          conversation: {
            conversationId: 'session-1',
            title: 'Planning notes',
            url: 'https://chat.deepseek.com/chat/s/session-1',
          },
        },
      },
    });
    await renderWithI18n(React.createElement(ProjectsPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const statusPanel = container.querySelector('.ds-project-readiness');
    expect(statusPanel?.textContent).toContain('Project status');
    expect(statusPanel?.textContent).toContain('Needs instructions');
    expect(statusPanel?.textContent).toContain('Add instructions');
    expect(statusPanel?.textContent).toContain('Linked here');
    expect(statusPanel?.textContent).not.toContain('Ready');
  });

  it('keeps Projects switcher compact and visually quiet', () => {
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const projectsPage = readFileSync('entrypoints/sidepanel/pages/ProjectsPage.tsx', 'utf8');
    const pickerHeadBlock = getCssBlock(css, '.ds-project-picker-head');
    const pickerBlock = getCssBlock(css, '.ds-project-picker');
    const detailBlock = getCssBlock(css, '.ds-project-detail');
    const rowBlock = getCssBlock(css, '.ds-project-row');
    const activeRowBlock = getCssBlock(css, '.ds-project-row-active');
    const rowIconBlock = getCssBlock(css, '.ds-project-row-icon');
    const projectSubmitBlock = getCssBlock(css, '.ds-project-page .ds-project-submit:not(:disabled)');
    const projectDangerBlock = getCssBlock(css, '.ds-project-page .ds-btn-danger');
    const projectDangerHoverBlock = getCssBlock(css, '.ds-project-page .ds-btn-danger:hover');
    const memoryRowBlock = getCssBlock(css, '.ds-project-memory-row');

    expect(projectsPage).toContain("from '@/components/ui/alert'");
    expect(projectsPage).toContain("from '@/components/ui/badge'");
    expect(projectsPage).toContain("from '@/components/ui/button'");
    expect(projectsPage).toContain('TextField');
    expect(projectsPage).toContain('TextAreaField');
    expect(projectsPage).toContain('EmptyState');
    expect(projectsPage).not.toContain('<input');
    expect(projectsPage).not.toContain('<textarea');
    expect(css).toContain('.ds-project-readiness');
    expect(pickerHeadBlock).toContain('position: absolute');
    expect(pickerHeadBlock).toContain('width: 1px');
    expect(pickerBlock).toContain('border: 1px solid var(--ds-border-hover)');
    expect(detailBlock).toContain('border: 0');
    expect(detailBlock).toContain('background: transparent');
    expect(rowBlock).toContain('grid-template-columns: 18px minmax(0, 1fr)');
    expect(rowBlock).toContain('min-height: 34px');
    expect(rowBlock).toContain('padding: 6px 9px');
    expect(activeRowBlock).not.toContain('inset 2px 0 0 var(--ds-blue)');
    expect(activeRowBlock).not.toContain('box-shadow');
    expect(rowIconBlock).toContain('display: inline-flex');
    expect(css).not.toContain('.ds-project-row-status');
    expect(projectSubmitBlock).toContain('background: var(--ds-blue) !important');
    expect(projectSubmitBlock).toContain('color: var(--ds-text-on-primary) !important');
    expect(projectDangerBlock).toContain('color: var(--ds-text-tertiary)');
    expect(projectDangerBlock).not.toContain('var(--ds-danger)');
    expect(projectDangerHoverBlock).toContain('var(--ds-danger)');
    expect(memoryRowBlock).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(css).not.toContain('.ds-project-memory-list .ds-card');
  });

  it('renders legacy stored skills without descriptions', async () => {
    stubEnglishChrome({
      skills: [
        {
          name: 'legacy-command',
          instructions: 'Legacy command',
          source: 'custom',
          memoryEnabled: false,
          enabled: true,
        },
      ],
    });
    await renderWithI18n(React.createElement(SkillPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const customToggle = container.querySelector('button[aria-label="Collapse Custom commands"]') as HTMLButtonElement | null;
    expect(customToggle).toBeTruthy();

    expect(container.textContent).toContain('/legacy-command');
    expect(container.textContent).not.toContain('undefined');
  });

  it('filters the skill library without fake rows', async () => {
    stubEnglishChrome({
      skills: [
        {
          name: 'shell',
          description: 'Run local shell commands',
          instructions: 'Use shell',
          source: 'builtin',
          memoryEnabled: false,
          enabled: true,
        },
        {
          name: 'ultra-think',
          description: 'Reason more deeply',
          instructions: 'Think deeply',
          source: 'builtin',
          memoryEnabled: false,
          enabled: false,
        },
      ],
    });
    await renderWithI18n(React.createElement(SkillPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const input = container.querySelector('.ds-skill-search input') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    const filterButtons = Array.from(container.querySelectorAll('.ds-skill-filter-row button'));
    expect(container.querySelector('.ds-skill-filter-row[data-slot="toggle-group"]')).toBeTruthy();
    expect(container.querySelectorAll('.ds-skill-filter-row [data-slot="toggle-group-item"]')).toHaveLength(3);
    expect(filterButtons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'shell');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('/shell');
    expect(container.textContent).not.toContain('/ultra-think');
    expect(container.textContent).not.toContain('Turn visible off');
    expect(container.textContent).not.toContain('Turn all off');
    expect(container.textContent).not.toMatch(/mock|placeholder|sample/i);
  });

  it('keeps filtered empty states compact', async () => {
    stubEnglishChrome({
      skills: [
        {
          name: 'shell',
          description: 'Run local shell commands',
          instructions: 'Use shell',
          source: 'builtin',
          memoryEnabled: false,
          enabled: true,
        },
      ],
    });
    await renderWithI18n(React.createElement(SkillPage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const input = container.querySelector('.ds-skill-search input') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'missing');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const emptyState = container.querySelector('.ds-skill-empty-state');
    expect(emptyState).toBeTruthy();
    expect(emptyState?.classList.contains('ds-empty-state')).toBe(false);
  });
});

function createConnectorServerForPolish() {
  return {
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
    lastConnectedAt: 1,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createConnectorToolForPolish(serverId: string) {
  return {
    id: `mcp:${serverId}:research_search`,
    provider: {
      kind: 'mcp',
      id: serverId,
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
}

function createLegacyMediaConnectorForPolish() {
  return {
    ...createConnectorServerForPolish(),
    id: 'media',
    displayName: 'Legacy Multimodal MCP',
    transport: {
      kind: 'native_messaging',
      nativeHost: 'com.deepseek_pp.multimodal',
    },
  };
}

function createConnectorHistoryForPolish(serverId: string, descriptorId: string) {
  return {
    id: 'history-1',
    call: {
      id: 'call-1',
      descriptorId,
      provider: {
        kind: 'mcp',
        id: serverId,
        displayName: 'Research workspace',
      },
      name: 'research_search',
      invocationName: 'mcp_research_search',
      payload: { query: 'pricing' },
      raw: '<tool_call />',
      createdAt: 1,
    },
    result: {
      ok: true,
      summary: '3 matching records',
      descriptorId,
      provider: {
        kind: 'mcp',
        id: serverId,
        displayName: 'Research workspace',
      },
      name: 'research_search',
      completedAt: 2,
    },
    createdAt: 2,
    source: 'test',
  };
}

function createShellServerForToolsPage() {
  return {
    version: 1,
    id: 'shell-local',
    displayName: 'Shell Local',
    enabled: false,
    transport: {
      kind: 'native_messaging',
      nativeHost: 'com.deepseek_pp.shell',
    },
    headers: [],
    secrets: [],
    timeouts: {
      connectMs: 5000,
      requestMs: 120000,
      discoveryMs: 10000,
    },
    limits: {
      maxResultBytes: 128000,
      maxToolCount: 8,
    },
    allowlist: {
      mode: 'allow',
      toolNames: ['shell_status', 'python_status', 'local_skill_preview', 'local_folder_pick'],
    },
    execution: {
      enabled: false,
      mode: 'manual',
    },
    status: 'disabled',
    lastConnectedAt: null,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createMcpDescriptorForToolsPage(serverId: string, name: string) {
  return {
    id: `mcp:${serverId}:${name}`,
    provider: {
      kind: 'mcp',
      id: serverId,
      displayName: 'Shell Local',
      transport: 'native_messaging',
    },
    name,
    invocationName: `mcp_shell_local_${name}`,
    title: name,
    description: `${name} descriptor`,
    inputSchema: { type: 'object' },
    execution: {
      mode: 'manual',
      enabled: false,
      risk: name === 'python_exec' ? 'high' : 'low',
    },
  };
}

function createGitHubSkillPreviewForPolish() {
  const source = createGitHubSkillSourceForPolish();
  return {
    source,
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
}

function createGitHubSkillImportResultForPolish() {
  return {
    ok: true,
    source: createGitHubSkillSourceForPolish(),
    imported: [
      {
        name: 'research',
        description: 'Search and summarize project references.',
        instructions: 'Use this command for project research.',
        source: 'github:github-polish',
        memoryEnabled: false,
        enabled: true,
      },
    ],
    replaced: 0,
    renamed: 1,
    warnings: [],
  };
}

function createGitHubSkillSourceForPolish() {
  return {
    id: 'github-polish',
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
}

function createLocalSkillPreviewForPolish() {
  const source = createLocalSkillSourceForPolish();
  return {
    source,
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
}

function createLocalSkillImportResultForPolish() {
  return {
    ok: true,
    source: createLocalSkillSourceForPolish(),
    imported: [
      {
        name: 'research',
        description: 'Search and summarize local references.',
        instructions: 'Use this command for local research.',
        source: 'local:local-polish',
        memoryEnabled: false,
        enabled: true,
      },
    ],
    replaced: 0,
    renamed: 1,
    warnings: [],
  };
}

function createLocalSkillSourceForPolish() {
  return {
    id: 'local-polish',
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
}

function getButtonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button'))
    .find((button) => button.textContent === text) as HTMLButtonElement | undefined;
}

function expectShadcnButton(text: string, variant?: string, size?: string): HTMLButtonElement {
  const button = getButtonByText(text);
  expect(button).toBeTruthy();
  expect(button?.getAttribute('data-slot')).toBe('button');
  if (variant) expect(button?.getAttribute('data-variant')).toBe(variant);
  if (size) expect(button?.getAttribute('data-size')).toBe(size);
  return button!;
}

async function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderWithI18n(element: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(I18nProvider, null, element));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function flushPolishApp() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function stubEnglishChrome(options: {
  skills?: unknown[];
  sources?: unknown[];
  runtimeMessages?: Record<string, unknown | ((message: { type?: string; payload?: unknown }) => unknown)>;
  storageSet?: (values: Record<string, unknown>) => unknown;
} = {}) {
  const skills = options.skills ?? [];
  const sources = options.sources ?? [];
  const runtimeMessages = options.runtimeMessages ?? {};
  const storageSet = options.storageSet ?? (async () => {});

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
        set: vi.fn(async (values: Record<string, unknown>) => storageSet(values)),
        remove: vi.fn(async () => {}),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    permissions: {
      request: vi.fn(async () => true),
    },
    runtime: {
      getManifest: vi.fn(() => ({})),
      sendMessage: vi.fn(async (message: { type?: string; payload?: unknown }) => {
        if (message.type && Object.prototype.hasOwnProperty.call(runtimeMessages, message.type)) {
          const handler = runtimeMessages[message.type];
          return typeof handler === 'function' ? handler(message) : handler;
        }
        if (message.type === 'GET_SKILL_LIBRARY') return skills;
        if (message.type === 'GET_SKILL_SOURCES') return sources;
        return null;
      }),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
}

function stubEnglishChromePendingSkills() {
  vi.stubGlobal('chrome', {
    i18n: {
      getUILanguage: vi.fn(() => 'en'),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({ [LOCALE_PREFERENCE_STORAGE_KEY]: 'en' })),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      sendMessage: vi.fn(() => new Promise(() => {})),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
}

function createRuntimeDoctorReportForPolish() {
  return {
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
        origin: 'https://docs.google.com',
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
          status: 'fail',
          evidence: '2 DeepSeek tab(s) need a refresh.',
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
          status: 'warn',
          evidence: 'Runtime tool descriptors were not confirmed.',
        },
        {
          id: 'leak_sentry',
          label: 'Leak sentry',
          prompt: 'Review the last run for leaks and tell me whether anything sensitive was stored.',
          status: 'fail',
          evidence: '3 forbidden storage issue(s) found.',
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
}

function resolveStorageKeys(key: string | string[] | Record<string, unknown> | null): string[] {
  if (key === null) return [LOCALE_PREFERENCE_STORAGE_KEY, 'scenarioConfigs'];
  if (typeof key === 'string') return [key];
  if (Array.isArray(key)) return key;
  return Object.keys(key);
}

function createSettingsStateStub() {
  return {
    apiKeyConfigured: false,
    apiKeyInput: '',
    apiKeyStatus: 'idle',
    apiKeyMessage: '',
    setApiKeyInput: vi.fn(),
    handleSaveApiKey: vi.fn(),
    handleClearApiKey: vi.fn(),
    multimodalConfigured: {
      openaiConfigured: false,
      geminiConfigured: false,
      openaiImageModel: 'gpt-4.1-mini',
      geminiVideoModel: 'gemini-2.5-flash',
      openaiBaseUrl: 'https://api.openai.com/v1',
      geminiBaseUrl: 'https://generativelanguage.googleapis.com',
    },
    openaiApiKeyInput: '',
    geminiApiKeyInput: '',
    openaiImageModel: 'gpt-4.1-mini',
    geminiVideoModel: 'gemini-2.5-flash',
    openaiBaseUrl: 'https://api.openai.com/v1',
    geminiBaseUrl: 'https://generativelanguage.googleapis.com',
    setOpenaiApiKeyInput: vi.fn(),
    setGeminiApiKeyInput: vi.fn(),
    setOpenaiImageModel: vi.fn(),
    setGeminiVideoModel: vi.fn(),
    setOpenaiBaseUrl: vi.fn(),
    setGeminiBaseUrl: vi.fn(),
    multimodalStatus: 'idle',
    multimodalMessage: '',
    handleSaveMultimodal: vi.fn(),
    handleClearMultimodal: vi.fn(),
  } as any;
}

function createGeneralStateStub(overrides: Record<string, unknown> = {}) {
  return {
    generalMessage: '',
    expertMode: false,
    chatEnabled: false,
    personalConfig: {
      enabled: true,
      sameSessionStrategy: 'last',
      autoReadyCheckBeforeRun: true,
      autoRefreshWebAuth: false,
      visualMonitorDefault: true,
      reducedConfirmations: false,
      descriptionDensity: 'comfortable',
    },
    handleExpertToggle: vi.fn(),
    handleChatToggle: vi.fn(),
    handlePersonalConveniencePatch: vi.fn(),
    ...overrides,
  } as any;
}

function createAppearanceStateStub(overrides: Record<string, unknown> = {}) {
  return {
    bgEnabled: false,
    bgUrl: '',
    setBgUrl: vi.fn(),
    bgPreview: '',
    bgOpacity: 0.3,
    appearanceMessage: '',
    fileInputRef: React.createRef<HTMLInputElement>(),
    handleBgToggle: vi.fn(),
    handleFileSelect: vi.fn(),
    handleUrlConfirm: vi.fn(),
    handleOpacityChange: vi.fn(),
    handleClearBg: vi.fn(),
    petEnabled: true,
    petPosition: 'bottom-right',
    petSize: 132,
    petOpacity: 0.96,
    petMotion: true,
    handlePetToggle: vi.fn(),
    handlePetPositionChange: vi.fn(),
    handlePetSizeChange: vi.fn(),
    handlePetOpacityChange: vi.fn(),
    handlePetMotionToggle: vi.fn(),
    ...overrides,
  } as any;
}

function createAppearanceSettingsRuntimeMessages(
  overrides: Record<string, unknown | ((message: { type?: string; payload?: unknown }) => unknown)> = {},
) {
  return createApiSettingsRuntimeMessages(overrides);
}

function createDataStateStub(overrides: Record<string, unknown> = {}) {
  const overrideSyncConfig = overrides.syncConfig as Record<string, unknown> | undefined;
  return {
    syncBusy: false,
    syncStatus: 'idle',
    syncMessage: '',
    memoryCount: 12,
    updateSyncField: vi.fn(),
    handleTestSync: vi.fn(),
    handleUploadSync: vi.fn(),
    handleDownloadSync: vi.fn(),
    handleExport: vi.fn(),
    handleImport: vi.fn(),
    handleClearAllMemories: vi.fn(),
    ...overrides,
    syncConfig: {
      url: '',
      username: '',
      password: '',
      remotePath: '/deepseek-pp.json',
      lastSyncAt: null,
      ...overrideSyncConfig,
    },
  } as any;
}

function createDataSettingsRuntimeMessages(
  overrides: Record<string, unknown | ((message: { type?: string; payload?: unknown }) => unknown)> = {},
) {
  return {
    GET_DEEPSEEK_API_KEY_STATUS: { configured: false },
    GET_MULTIMODAL_SETTINGS_STATUS: {
      ok: true,
      openaiConfigured: false,
      geminiConfigured: false,
      openaiImageModel: 'gpt-4.1-mini',
      geminiVideoModel: 'gemini-2.5-flash',
      openaiBaseUrl: 'https://api.openai.com/v1',
      geminiBaseUrl: 'https://generativelanguage.googleapis.com',
    },
    GET_MEMORIES: [],
    GET_CONFIG: { version: '1.0.0' },
    GET_SYNC_CONFIG: {
      url: 'https://dav.example.com/dav/',
      username: 'kevin',
      password: 'secret',
      remotePath: '/deepseek-pp.json',
      lastSyncAt: null,
    },
    GET_MODEL_TYPE: null,
    GET_BACKGROUND: null,
    GET_PET: null,
    GET_PERSONAL_CONVENIENCE_CONFIG: { config: {} },
    ...overrides,
  };
}

function createApiSettingsRuntimeMessages(
  overrides: Record<string, unknown | ((message: { type?: string; payload?: unknown }) => unknown)> = {},
) {
  return {
    GET_DEEPSEEK_API_KEY_STATUS: { configured: false },
    GET_MULTIMODAL_SETTINGS_STATUS: {
      ok: true,
      openaiConfigured: false,
      geminiConfigured: false,
      openaiImageModel: 'gpt-4.1-mini',
      geminiVideoModel: 'gemini-2.5-flash',
      openaiBaseUrl: 'https://api.openai.com/v1',
      geminiBaseUrl: 'https://generativelanguage.googleapis.com',
    },
    GET_MEMORIES: [],
    GET_CONFIG: { version: '1.0.0' },
    GET_SYNC_CONFIG: null,
    GET_MODEL_TYPE: null,
    GET_BACKGROUND: null,
    GET_PET: null,
    GET_PERSONAL_CONVENIENCE_CONFIG: { config: {} },
    ...overrides,
  };
}

function createAboutStateStub(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0.0',
    ...overrides,
  } as any;
}

function createUsageSummaryStub() {
  return {
    rangeDays: 30,
    generatedAt: Date.UTC(2026, 5, 30, 12, 0),
    totalTokens: 1234,
    sessionCount: 2,
    messageCount: 8,
    turnCount: 3,
    activeDays: 2,
    currentStreak: 1,
    serverTokenRecordCount: 2,
    mostUsedModel: {
      modelKey: 'deepseek-chat',
      modelLabel: 'DeepSeek Chat',
      totalTokens: 900,
      turnCount: 2,
      messageCount: 6,
      sessionCount: 1,
      share: 0.73,
    },
    days: [
      {
        day: '2026-06-28',
        timestamp: Date.UTC(2026, 5, 28, 12, 0),
        tokens: 0,
        messageCount: 0,
        sessionCount: 0,
        turnCount: 0,
        models: [],
      },
      {
        day: '2026-06-29',
        timestamp: Date.UTC(2026, 5, 29, 12, 0),
        tokens: 334,
        messageCount: 2,
        sessionCount: 1,
        turnCount: 1,
        models: [{ modelKey: 'deepseek-reasoner', modelLabel: 'DeepSeek Reasoner', tokens: 334 }],
      },
      {
        day: '2026-06-30',
        timestamp: Date.UTC(2026, 5, 30, 12, 0),
        tokens: 900,
        messageCount: 6,
        sessionCount: 1,
        turnCount: 2,
        models: [{ modelKey: 'deepseek-chat', modelLabel: 'DeepSeek Chat', tokens: 900 }],
      },
    ],
    heatmap: [],
    modelUsage: [
      {
        modelKey: 'deepseek-chat',
        modelLabel: 'DeepSeek Chat',
        totalTokens: 900,
        turnCount: 2,
        messageCount: 6,
        sessionCount: 1,
        share: 0.73,
      },
      {
        modelKey: 'deepseek-reasoner',
        modelLabel: 'DeepSeek Reasoner',
        totalTokens: 334,
        turnCount: 1,
        messageCount: 2,
        sessionCount: 1,
        share: 0.27,
      },
    ],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCssBlock(css: string, selector: string): string {
  const index = css.indexOf(selector);
  expect(index).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', index);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function getLastCssBlock(css: string, selector: string): string {
  const index = css.lastIndexOf(selector);
  expect(index).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', index);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function getWorkbenchSelectTrigger(label: string): HTMLButtonElement {
  const labelNode = Array.from(container.querySelectorAll<HTMLElement>('.ds-settings-picker-label'))
    .find((candidate) => candidate.textContent === label);
  expect(labelNode).toBeTruthy();
  const trigger = labelNode
    ?.closest('.ds-settings-picker')
    ?.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]');
  expect(trigger).toBeTruthy();
  return trigger!;
}

async function getWorkbenchSelectOptions(label: string): Promise<string[]> {
  const trigger = getWorkbenchSelectTrigger(label);
  await act(async () => {
    trigger.dispatchEvent(createMousePointerEvent('pointerdown'));
    await Promise.resolve();
  });
  const content = document.body.querySelector<HTMLElement>('[data-slot="select-content"]');
  expect(content).toBeTruthy();
  const options = Array.from(content!.querySelectorAll<HTMLElement>('[data-slot="select-item"]'))
    .map((option) => option.textContent?.trim() ?? '');
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();
  });
  return options;
}

function createMousePointerEvent(type: string): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    ctrlKey: false,
    clientX: 1,
    clientY: 1,
  });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}
