# DeepSeek++ Shadcn Workbench Phase 0 Map

Status: active rebuild baseline
Updated: 2026-07-03 06:43 PDT
Scope: `/Users/kyin/Projects/Deepseek-pp`

## Session Handoff Anchor (2026-07-03 06:43 PDT)

- Active goal text for this run: world-class, user-friendly autonomous browser workbench with simple Ask/Projects/Context, Mission/Activity/Review power, trust gates, preserved behavior, and full capability retention.
- This map remains the execution contract; continuation requires real interaction dogfood, 360/420 layout coverage, keyboard and accessibility checks, overflow/console/error/leak scans, and no capability loss.

## Purpose

This is the pre-coding contract for the shadcn workbench rebuild. It maps the current sidepanel routes, stores, runtime messages, tests, and replaceable UI zones so the rebuild can be brand-new visually without losing real capabilities.

This document supersedes the visual and IA direction in the older Sidebar v2 docs. Those older docs remain capability inventory only.

## Inspected Sources

- Repo guidance: `AGENTS.md`
- Active ledger: `.ai-bridge/current-plan.md`
- App shell and route state: `entrypoints/sidepanel/App.tsx`, `entrypoints/sidepanel/navigation.ts`, `entrypoints/sidepanel/sidebar-v2.ts`, `entrypoints/sidepanel/components/SidebarV2Shell.tsx`
- Shared operational context: `entrypoints/sidepanel/global-operational-context.tsx`, `core/operational-context.ts`
- Cockpit runtime: `entrypoints/sidepanel/use-runtime-cockpit.ts`, `core/cockpit/runtime-cockpit.ts`, `core/cockpit/actions.ts`, `core/cockpit/types.ts`
- Major pages: `entrypoints/sidepanel/pages/*.tsx`
- Settings primitives/state: `entrypoints/sidepanel/components/settings/primitives.tsx`, `entrypoints/sidepanel/components/settings/useSettingsState.ts`
- Background runtime contract: `entrypoints/background.ts`
- Test surface: `tests/*.test.ts`
- shadcn context: `npx shadcn@latest info --json`

## Current State Summary

The repo is already dirty and must stay preserved. The dirty tree includes sidepanel pages/components, cockpit files, run/cockpit tests, i18n resources, `AGENTS.md`, `.ai-bridge/`, `docs/design/`, and current trust/recovery work. Do not reset or clean this state.

Current top-level `SidepanelTab` values:

- `chat`
- `mission`
- `projects`
- `intelligence`
- `workingSet`
- `timeline`
- `review`
- `skills`
- `library`
- `capabilities`
- `settings`

Current nested route values:

- Library: `memory`, `saved`
- Capabilities/System: `automation`, `preset`, `browser`, `mcp`, `tools`, `doctor`
- Settings: `general`, `api`, `prompt`, `voice`, `appearance`, `usage`, `data`, `about`

Current primary nav is being moved to the rebuild IA: `Ask / Projects / Context / Mission / Activity / Review`. Working Set, Commands, Library, Automation, Presets, Browser, MCP/Connectors, Tools, Health, and Settings remain reachable through the menu.

## Shadcn Readiness

`npx shadcn@latest info --json` returned on 2026-07-01 21:13 PDT:

- CLI package resolved as `shadcn@4.12.0`
- Framework: `Manual`
- React server components: `false`
- TypeScript: `true`
- Tailwind: `v4`
- Tailwind CSS file: `entrypoints/sidepanel/style.css`
- Import alias: `@`
- Config style: `radix-nova`
- Base: `radix`
- Icon library: `lucide`
- Installed shadcn components: `alert-dialog`, `alert`, `badge`, `button`, `card`, `checkbox`, `command`, `dialog`, `dropdown-menu`, `empty`, `field`, `input-group`, `input`, `label`, `native-select`, `scroll-area`, `select`, `separator`, `skeleton`, `slider`, `switch`, `table`, `tabs`, `textarea`, `toggle-group`, `toggle`, `tooltip`

Implication: Phase 1 foundation has landed. Future slices must use the installed `components.json`, `@/components/ui/*`, and `@/lib/utils` paths, run `npx shadcn@latest docs <component>` before using or changing a shadcn primitive, and read generated files before composition. Do not reinitialize or overwrite components without a dry-run/diff review.

## Contract Boundaries

### Preserve

- Background message names, payload semantics, and failure behavior.
- Chrome storage keys and schemas.
- `SidepanelNavigationTarget` behavior unless a migration test proves every old target still resolves.
- `setPendingText` and `pendingChatText` routing into Ask.
- `deepseek_pp_chat_enabled` disabled-chat behavior.
- `GlobalOperationalContextProvider` as shared owner of runtime/project/conversation/prompt/tool context.
- `useRuntimeCockpit` and `core/cockpit` projection redaction.
- Project state schema `PROJECT_CONTEXT_SCHEMA_VERSION`.
- Autonomous run ledger storage key `deepseek_pp_autonomous_runs_v1`.
- `getSafeRuntimeIssueMessage` and equivalent privacy sanitizers.
- i18n verification coverage for English and zh-CN.

### Replace

- Custom visual shell in `SidebarV2Shell.tsx`.
- Custom route header/menu/button row styling in `style.css`.
- Custom settings primitives in `components/settings/primitives.tsx` where shadcn components can preserve behavior.
- Custom picker, segmented, dialog, confirmation, alert, skeleton, empty, and form markup.
- Page-specific card/list surfaces where the same runtime/store contracts can be kept.
- Legacy visual classes such as `ds-card`, `ds-surface-panel`, and one-off panel/card variants once their replacement is covered.

### Keep As Adapters During Migration

- `App.tsx` route state and lazy page boundaries.
- `navigation.ts` route types and subtab enums.
- `sidebar-v2.ts` projection functions until the new navigation model has equivalent tests.
- Existing page components as temporary route bodies while the new workbench shell lands.

## Runtime Contract Inventory

Ask and composer:

- `CHAT_SUBMIT_PROMPT`, `CHAT_STREAM_CHUNK`, `CHAT_NEW_SESSION`
- `GET_AUTH_STATUS`, `AUTH_STATUS_CHANGED`
- `GET_OFFICIAL_API_CHAT_CONFIG`, `SAVE_OFFICIAL_API_CHAT_CONFIG`
- `GET_PERSONAL_CONVENIENCE_CONFIG`, `SAVE_PERSONAL_CONVENIENCE_CONFIG`
- `GET_VOICE_SETTINGS`, `GET_VOICE_CAPABILITIES`, `SAVE_VOICE_SETTINGS`
- `CAPTURE_CURRENT_TAB_IMAGE`, `CAPTURE_BROWSER_CONTROL_TARGET_IMAGE`, `REQUEST_HOST_PERMISSION`
- `GET_SKILL_LIBRARY`, `GET_MEMORIES`, `GET_SAVED_ITEMS`, `GET_PROJECT_CONTEXT_STATE`, `GET_CURRENT_DEEPSEEK_CONVERSATION`
- `OPEN_CHAT_WITH_TEXT`, `CHAT_SET_INPUT_TEXT`, `pendingChatText`

Projects and Context:

- `GET_PROJECT_CONTEXT_STATE`, `CREATE_PROJECT_CONTEXT`, `UPDATE_PROJECT_CONTEXT`, `DELETE_PROJECT_CONTEXT`
- `ADD_CONVERSATION_TO_PROJECT`, `REMOVE_CONVERSATION_FROM_PROJECT`, `SET_PENDING_PROJECT_CONTEXT`
- `GET_CURRENT_DEEPSEEK_CONVERSATION`, `GET_PROJECT_CONTEXT_FOR_CONVERSATION`
- Project memory actions use `GET_MEMORIES`, `SAVE_MEMORY`, `UPDATE_MEMORY`, `DELETE_MEMORY`
- Context also depends on prompt settings, active preset, saved items, pinned memories, and operational context.

Mission, Activity, Working Set, Review:

- `core/run/store.ts` and `core/run/types.ts` own the durable autonomous run ledger.
- `core/cockpit/runtime-cockpit.ts` projects mission, working set, timeline, and review metadata.
- `core/cockpit/actions.ts` starts missions and applies pause/resume/stop.
- `useRuntimeCockpit` refreshes on `deepseek_pp_autonomous_runs_v1` storage changes.
- UI must keep target URLs/titles, raw evidence refs, ids, metadata, and raw reviewer summaries redacted.

Library and Commands:

- Memory: `GET_MEMORIES`, `SAVE_MEMORY`, `UPDATE_MEMORY`, `DELETE_MEMORY`, `IMPORT_MEMORY_DRAFTS`, `MEMORIES_UPDATED`, `STATE_UPDATED`
- Saved: `GET_SAVED_ITEMS`, `SAVE_SAVED_ITEM`, `DELETE_SAVED_ITEM`, `INSERT_SAVED_PROMPT_IN_ACTIVE_DEEPSEEK_TAB`, `SAVED_ITEMS_UPDATED`
- Commands/Skills: `GET_SKILL_LIBRARY`, `GET_SKILL_SOURCES`, `GET_GITHUB_SKILL_SOURCES`, `SAVE_SKILL`, `DELETE_SKILL`, `SET_SKILL_ENABLED`
- Skill source import/update: `PREVIEW_GITHUB_SKILL_SOURCE`, `IMPORT_GITHUB_SKILL_SOURCE`, `CHECK_GITHUB_SKILL_SOURCE_UPDATES`, `UPDATE_GITHUB_SKILL_SOURCE`, `DELETE_GITHUB_SKILL_SOURCE`, `PREVIEW_LOCAL_SKILL_SOURCE`, `PICK_LOCAL_SKILL_FOLDER`, `IMPORT_LOCAL_SKILL_SOURCE`

System, tools, browser, connectors:

- Automation: `GET_AUTOMATIONS`, `GET_AUTOMATION_RUNS`, `GET_AUTOMATION_RUNS_BATCH`, `CREATE_AUTOMATION`, `UPDATE_AUTOMATION`, `SET_AUTOMATION_STATUS`, `DELETE_AUTOMATION`, `RUN_AUTOMATION_NOW`
- Presets: `GET_PRESETS`, `SAVE_PRESET`, `DELETE_PRESET`, `SET_ACTIVE_PRESET`, `GET_ACTIVE_PRESET`
- Browser: `GET_BROWSER_CONTROL_SETTINGS`, `SAVE_BROWSER_CONTROL_SETTINGS`, `SET_BROWSER_CONTROL_ENABLED`, `GET_BROWSER_CONTROL_STATE`, `SET_BROWSER_CONTROL_TARGET`, `LOCK_BROWSER_CONTROL_TARGET`, `CLEAR_BROWSER_CONTROL_TARGET_LOCK`, `DETACH_BROWSER_CONTROL`
- Browser evidence: `CAPTURE_BROWSER_CONTROL_TARGET_IMAGE`
- MCP/connectors: `GET_MCP_SERVERS`, `GET_MCP_SERVER`, `CREATE_MCP_SERVER`, `UPDATE_MCP_SERVER`, `DELETE_MCP_SERVER`, `GET_MCP_TOOL_CACHE`, `REFRESH_MCP_SERVER_TOOLS`, `REQUEST_MCP_SERVER_PERMISSION`, `TEST_MCP_SERVER_CONNECTION`
- Tools: `GET_TOOL_DESCRIPTORS`, `REFRESH_TOOL_DESCRIPTORS`, `GET_WEB_TOOL_SETTINGS`, `SET_WEB_TOOL_SETTING`, `DIAGNOSE_WEB_SEARCH`, `EXECUTE_TOOL_CALL`, `GET_TOOL_CALL_HISTORY`, `CLEAR_TOOL_CALL_HISTORY`
- Health: `GET_RUNTIME_DOCTOR_REPORT`, `REFRESH_DEEPSEEK_WEB_AUTH`, `ENSURE_PERSONAL_RUNTIME_READY`, `RUN_PERSONAL_AUTOPILOT_REPAIR`, `RELOAD_STALE_DEEPSEEK_TABS`, `RUN_PERSONAL_HUMAN_EVAL`

Settings:

- General: `GET_MODEL_TYPE`, `SET_MODEL_TYPE`, `GET_PERSONAL_CONVENIENCE_CONFIG`, `SAVE_PERSONAL_CONVENIENCE_CONFIG`, `deepseek_pp_chat_enabled`
- API: `GET_DEEPSEEK_API_KEY_STATUS`, `SAVE_DEEPSEEK_API_KEY`, `CLEAR_DEEPSEEK_API_KEY`, `GET_MULTIMODAL_SETTINGS_STATUS`, `SAVE_MULTIMODAL_SETTINGS`, `CLEAR_MULTIMODAL_SETTINGS`
- Prompt: `GET_PROMPT_INJECTION_SETTINGS`, `SAVE_PROMPT_INJECTION_SETTINGS`
- Voice: `GET_VOICE_SETTINGS`, `GET_VOICE_CAPABILITIES`, `SAVE_VOICE_SETTINGS`
- Appearance: `GET_DEEPSEEK_THEME`, `SET_DEEPSEEK_THEME`, `GET_BACKGROUND`, `SAVE_BACKGROUND`, `CLEAR_BACKGROUND`, `GET_PET`, `SAVE_PET`, `CLEAR_PET`
- Usage: `GET_USAGE_SUMMARY`, `CLEAR_USAGE_STATS`
- Data: `GET_SYNC_CONFIG`, `SAVE_SYNC_CONFIG`, `WEBDAV_TEST`, `WEBDAV_UPLOAD_LOCAL`, `WEBDAV_DOWNLOAD_REMOTE`
- About: version/config state, repository link, no internal endpoint disclosure.

## Required Workbench IA

Primary workbench surfaces:

1. Ask
2. Projects
3. Context
4. Mission
5. Activity
6. Review

Secondary surfaces:

1. Working Set
2. Library: Memory, Saved
3. Commands/Skills
4. Presets
5. Automation
6. Browser
7. Connectors/MCP
8. Page tools/Tools
9. Health/Diagnostics
10. Settings: General, API, Prompt, Voice, Appearance, Usage, Data, About

This IA may be implemented through a command-center shell, route sections, or menu groups, but every listed surface must remain reachable at 360px and 420px.

## Migration Order

1. Keep shadcn foundation current.
   - Current installed foundation: `alert-dialog`, `alert`, `badge`, `button`, `card`, `checkbox`, `command`, `dialog`, `dropdown-menu`, `empty`, `field`, `input-group`, `input`, `label`, `native-select`, `scroll-area`, `select`, `separator`, `skeleton`, `slider`, `switch`, `table`, `tabs`, `textarea`, `toggle-group`, `toggle`, `tooltip`.
   - Before adding another primitive, run `npx shadcn@latest docs <component>` and `npx shadcn@latest add <component> --dry-run`, then read generated files after add.
   - Likely remaining primitives for the rebuild: sheet, popover, sonner, and maybe sidebar if compatible.
   - Tooltip status: root `TooltipProvider` is wired in the sidepanel app and `WorkbenchTooltip` backs real icon-only action hints in Projects memory rows and Automation cards.
   - ScrollArea status: `WorkbenchScrollRail` backs Automation filter and card metadata rails with labelled shadcn/Radix scroll areas for dense narrow-width rows.

2. Build local workbench substrate.
   - Add local wrappers/layout primitives that compose shadcn without hiding contracts: shell, route header, status row, evidence row, action bar, field row, empty/error/loading/retry.
   - Keep wrappers boring and thin. No speculative framework or theme engine.

3. Replace shell and navigation.
   - Keep `SidepanelNavigationTarget` behavior.
   - Replace custom menu/nav markup with shadcn-backed navigation and command/menu patterns.
   - Primary nav must expose the required workbench loop: Ask, Projects, Context, Mission, Activity, Review.
   - Prove all old routes still navigate: primary flows plus every Library, Commands, Capabilities/System, Settings subroute.

4. Rebuild Ask.
   - Preserve chat disabled state, web/API auth states, streaming, voice, images, browser evidence capture, `/` commands, `@` context, pending text, and recovery from source failures.
   - Dogfood slash and at-context with keyboard selection and failed source recovery.
   - Ask setup status: disabled, checking, and needs-setup first-run states now compose shadcn `Card`, `Badge`, `Button`, and `Skeleton` primitives before any composer is shown. Production dogfood verifies disabled setup, API Settings routing, keyboard Enable, Open DeepSeek, checking skeletons, enabled composer, menu Escape, slash suggestions, and `@` context suggestions at 420px and 360px in `test-results/ask-setup-card-dogfood/`.
   - Ask suggestion recovery: slash and `@` source-failure states now compose shadcn `Alert`, `AlertTitle`, `AlertDescription`, `AlertAction`, and `Button` primitives. Keyboard focus can move from the composer into the retry action without dismissing the suggestion panel, and production dogfood verifies keyboard retry recovery plus partial `@` context preservation in `test-results/ask-setup-card-dogfood/`.

5. Rebuild Projects and Context.
   - Preserve project CRUD, chat assignment, pending next chat, project memory CRUD, active project context, prompt memory state, saved items, presets, and browser target facts.
   - Keep first-run and no-data states honest.
   - Projects status: create/edit project fields now compose shared shadcn-backed `TextField` and `TextAreaField`; no-project and load-failure states use shadcn-backed `EmptyState`; readiness uses shadcn `Badge`; memory partial-source failure uses shadcn `Alert`; visible project actions use shadcn `Button`; destructive project deletion uses the existing shadcn `AlertDialog`; production dogfood evidence lives in `test-results/projects-shadcn-dogfood/`.

6. Rebuild Mission, Working Set, Activity, Review.
   - Preserve mission start/pause/resume/stop, runtime cockpit projection, evidence freshness, review lane severity, quality gates, and redaction.
   - Keep evidence visible where trust decisions happen.
   - Mission status: the starter form now uses shared shadcn-backed `TextAreaField` controls for objective, done criteria, and required evidence; starter errors use shadcn `Alert`; production dogfood covers start, Activity routing, pause, resume, and stop at 420px and 360px in `test-results/mission-starter-dogfood/`.
   - Review status: reviewer lane details now compose the generated shadcn `Table` and installed `Badge` variants for reviewer, state, safe finding summary, and evidence counts. Production dogfood opens Review through the real command menu, filters the menu, verifies blocked/running/passed lanes, checks table/header/body/cell/badge slots, scrolls the table into view, captures focused screenshots at 420px and 360px, and confirms no raw reviewer summaries or ids leak in `test-results/review-lane-table-dogfood/`.

7. Rebuild Library, Commands, Presets.
   - Preserve Memory/Saved CRUD, insert saved prompt, export, command enablement, source imports, source update/check/delete, and action failure recovery.
   - Commands status, overview controls, command form, import entry controls, command rows, group controls, GitHub source action controls, and import preview/result status now compose installed shadcn primitives without changing command/source/import contracts: status card uses `Card`/`Badge`/`Button`/`Skeleton`; overview search uses shared `TextField` over shadcn `Field`/`Input`; status filter uses `ToggleGroup` / `ToggleGroupItem`; GitHub import, local import, and New actions use shadcn `Button` with lucide icons; the command form uses shared `TextField` / `TextAreaField` plus shadcn `Button`; GitHub/local import entry fields use shared `TextField`; local Choose uses a lucide `FolderOpenIcon`; command rows use shadcn `Badge` and `Button`; group expanders/actions use shadcn `Button` with lucide `ChevronRightIcon`; GitHub source Check/Sync/Remove controls use shadcn `Button`; import warnings and success/error results use shadcn `Alert` / `AlertDescription`; import renamed/version chips use shadcn `Badge`. Production dogfood opens Commands through the real command menu, verifies status card, overview control, form, import entry, row, group, source action, import warning/status/result, preview badge, checkbox, and selected-path payload slots, opens GitHub/local import panels, previews and imports from both, toggles preview selection by keyboard and row click, verifies duplicate-import disabled states, opens/cancels and fills the New form, opens/closes row details, toggles a command off/on, opens/cancels row edit, checks/syncs an imported source, opens/cancels source removal confirmation, types in overview search, expands imported sources, filters Off, creates a command through the status card, verifies saved payloads, recovers library/source failures with keyboard Enter, checks no horizontal overflow, scans console/page errors, and scans visible text for runtime/storage/schema/url/token/image/object leaks at 420px and 360px in `test-results/commands-status-card-dogfood/`. Remaining Commands work is broader route/layout polish, not status/overview/form/import-entry/row/group/source-action/import-preview/result migration.
   - Presets status, rows, visible import/create actions, create/edit form fields, and form actions now compose installed shadcn primitives without changing preset CRUD/import/active-selection contracts: status card uses `Card`/`Badge`/`Button`/`Skeleton`; row state uses shadcn `Badge`; row actions use shadcn `Button`; header Import/New actions use shadcn `Button` with lucide icons; form fields use shared shadcn-backed `TextField` / `TextAreaField`; form actions use shadcn `Button`; the hidden file input remains native because browser file selection requires it. Production dogfood opens Presets through the real command menu, verifies status-card slots, row badge variants, header icon buttons, markdown import through the hidden file input, imported `SAVE_PRESET` payloads, create/save/use flows, edit form, load failure, selection failure, keyboard retry, no horizontal overflow, console/page errors, and visible leak scans at 420px and 360px in `test-results/presets-status-card-dogfood/` and `test-results/preset-form-dogfood/`. Remaining Presets work is broader route/layout polish, not status/card/row/header/form/import-action migration.

8. Rebuild System tools.
   - Preserve Automation, Browser, MCP/Connectors, Page tools, and Health behaviors before changing visuals.
   - Browser and connectors need permission/offline/action-failure states verified.
   - Automation status: readiness/trust panel composes shadcn `Card`, `Badge`, `Button`, `Alert`, and `Empty` primitives for checking, ready, needs-attention, blocked, empty, load-failure, and recent-run partial-failure states. Automation command/action controls now compose shadcn `Button` too: header Prepare all/Templates/session strategy/New, command-center Prepare run, workflow-template Use, form Attach image/Cancel/Create/Save, card Open session/Prepare run/Run now/Blocked, and readiness Prepare run/Apply safe fixes/Loop contract. Remaining button-like Automation controls now compose shadcn primitives as well: filter chips and successful-follow-up chain targets use `ToggleGroup` / `ToggleGroupItem`, attachment remove uses an icon `Button`, card pause/resume/edit/delete use `Button` composition under tooltip triggers, and New uses a lucide icon. Automation select/switch controls now compose shadcn primitives: template category, model, and schedule trigger use shadcn/Radix `Select`; search and deep-thinking prompt flags use shadcn `Switch` inside `Field`; visual monitor, chain, and review gate continue through shared shadcn `ToggleRow`. Automation visible text controls now compose shared shadcn-backed `TextField` / `TextAreaField` wrappers: automation list search, command-launcher objective, workflow-template search, form name, saved visual refs, prompt, schedule expression, timezone, and chain fallback. The hidden image file input intentionally remains native. Production dogfood opens Automation through the real command menu, exercises command launcher, template use, text-field typing, disabled/enabled expression behavior, model/trigger/category dropdowns, search/deep-thinking switch lockout/unlock/toggle behavior, form actions, readiness actions, header actions, card actions, filter and chain toggles, attachment upload/removal, tooltip icon controls, empty create, blocked filtering, load-failure recovery, run-history recovery, stored/action failure redaction, shadcn slots, no horizontal overflow, and no raw runtime/storage/action id leaks at 420px and 360px in `test-results/automation-status-card-dogfood/`. Remaining Automation work is broader route/layout polish and stress-matrix coverage, not raw text/select/switch/button migration.
   - Browser status: readiness/trust panel now composes shadcn `Card`, `Badge`, and `Button` primitives for ready, needs-target, load-failure, and action-failure states. Production dogfood opens Browser through the real command menu, verifies target focus and keyboard selection, lock/clear actions, retry recovery, advanced snapshot details, sanitized target-action failure copy, shadcn slots, no horizontal overflow, and no raw runtime/storage/id leaks at 420px and 360px in `test-results/browser-readiness-card-dogfood/`.
   - Connectors status: readiness/trust panel now composes shadcn `Card`, `Badge`, and `Button` primitives for ready, empty, all-off, no-action, list-failure, partial-action-failure, and retry states. Connector action controls now compose shadcn `Button` too: Local computer preset, Media analysis preset, Add connector, Retry, Edit, Delete, Allow site, Test, Refresh actions, Copy command, Header/Secret Add, Header/Secret remove, Cancel, and Save. Production dogfood opens Connectors through the real command menu, expands connector details and recent activity, option-checks/changes/resets the detail and form execution dropdowns, opens the add-connector form, changes connection type, opens advanced controls, opens/cancels delete confirmation, verifies list failure/recovery, action-cache failure/recovery, permission denial, sanitized test-action failure copy, shadcn slots, no horizontal overflow, form-control containment, and no raw runtime/storage/action id leaks at 420px and 360px in `test-results/connectors-status-card-dogfood/`. A 360px visual collision in advanced timeout fields was found and fixed by making `NumberField` min-width-safe.
   - Page tools status: readiness/trust panel composes shadcn `Card`, `Badge`, `Button`, and `Skeleton` primitives for ready, source-failure, and no-tools states. Remaining first-layer actions now compose shadcn `Button` too: Local Python setup/refresh, site Grant, all-sites permission, and diagnostics Diagnose. Production dogfood opens Page tools through the real command menu, toggles Read page, opens Diagnostics, runs Diagnose, verifies invalid URL and all-sites permission flows, simulates Local Python source failure/recovery, verifies small outline Button slots for those actions, checks no horizontal overflow, and scans for runtime/storage/schema/url/token/image/object leaks at 420px and 360px in `test-results/tools-status-card-dogfood/`.
   - Health status: readiness/trust panel composes shadcn `Card`, `Badge`, and `Button` primitives for checking, ready, needs-attention, blocked/load-failure, stale page bridge, auth refresh, repair retry, readiness refresh, and review states. Remaining visible Health action controls now compose shadcn `Button` too: Refresh, Refresh login, Repair and retry, Refresh page bridge, Run review, Check readiness, and recovery-suggestion Save memory. Production dogfood opens Health through the real command menu, clicks action-row runtime paths, opens diagnostics details, verifies load-failure keyboard recovery, page-bridge failure/recovery, Repair and retry, recovery-memory save, shadcn slots, no horizontal overflow, and no raw runtime/storage/action id leaks at 420px and 360px in `test-results/health-status-card-dogfood/`.

9. Rebuild Settings.
   - Convert settings primitives last so all form/field/dialog patterns are already proven.
   - Current substrate status: shared toggle rows, text fields, native form select fields, numeric sliders, command import checkbox rows, settings segmented groups, Settings route picker, and System section picker are shadcn-backed where their native semantics can be preserved.
   - Verify no false saved state across every settings section.

10. Full milestone audit.
   - Production bundle at 360px and 420px.
   - Open menus, dropdowns, dialogs, confirmations.
   - Type in forms, trigger failures/retries, use keyboard-only paths.
   - Check no horizontal overflow, console/page errors, fake states, or privacy leaks.

## Verification Matrix

Per slice:

- Focused tests for changed behavior.
- `npm run compile -- --pretty false`
- `npm run verify:i18n`
- `npm test`
- `npm run build`
- `git diff --check`

Milestone dogfood:

- Ask, `/`, `@`, Projects, Context, Mission, Working Set, Activity, Review.
- Library Memory/Saved, Commands/Skills import flows, Presets, Automation.
- Browser target/control, MCP/Connectors, Page tools, Health.
- Settings General/API/Prompt/Voice/Appearance/Usage/Data/About.
- Dropdowns, dialogs, destructive confirmations, error/retry/recovered states.
- 360px and 420px screenshots inspected directly.
- DOM horizontal overflow check and browser console/page error check.
- Visible text scan for `schemaVersion`, runtime message names, raw ids, URLs, tokens, `Bearer`, `Cookie`, `data:image`, `[object Object]`, and secret-shaped strings.

## Initial Test Targets

- `tests/sidepanel-navigation.test.ts`: route reachability and keyboard/menu navigation.
- `tests/sidepanel-chat-attachments.test.ts`: Ask, image capture, `/`, `@`.
- `tests/projects-page.test.ts`: project CRUD, assignment, project memory.
- `tests/personal-intelligence-page.test.ts`: Context source loading, empty/error routing.
- `tests/mission-page.test.ts`, `tests/working-set-page.test.ts`, `tests/timeline-page.test.ts`, `tests/review-page.test.ts`, `tests/runtime-cockpit.test.ts`: autonomous loop and redaction.
- `tests/sidepanel-polish.test.ts`: narrow layout and visual-regression guards.
- `tests/sidepanel-interactions.test.ts`: settings/library/action interactions.
- MCP/browser/automation tests for system pages after their visual rebuild slices.

## Open Risks

- shadcn updates can modify CSS/component paths. Must dry-run and inspect generated files before accepting changes.
- Existing `.ai-bridge/` and `docs/design/` are untracked. Treat them as intentional work, not cleanup candidates.
- Some current pages are very large (`ChatPage`, `AutomationPage`, `McpPage`). Rebuild slices should first introduce shared patterns around them, then replace interiors in bounded passes.
- Browser/Computer tooling has been intermittently unavailable in prior slices. If unavailable, use production-bundle Playwright dogfood and record the blocker exactly.
- The older Sidebar v2 docs contain stale external-product inspiration. Do not copy that framing into implementation.

## Phase 0 Exit Criteria

Phase 0 is complete when:

- This map exists and is referenced from the active ledger.
- shadcn readiness is recorded from current CLI output.
- Current route/capability/runtime contracts are inventoried.
- Replace/preserve boundaries are explicit.
- Migration order is written.
- Production UI code changed after the original map must be reconciled here before the next slice starts.
