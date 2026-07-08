# Sidebar v2 Capability Preservation Map

Status: approval-gate preparation
Scope: `/Users/kyin/Projects/deepseek-pp`
Related spec: `docs/design/sidebar-v2-e2e-spec.md`
Related mockup: `docs/design/sidebar-v2-mockup.html`

## Purpose

This map ties the proposed Sidebar v2 UX to current source files and runtime message contracts.

It exists to prevent the next implementation loop from making the UI cleaner by accidentally dropping old capability access.

## Current Source Summary

Current primary sidepanel IA is:

```text
Chat / Library / Projects / Capabilities / Settings
```

Verified source:

- `entrypoints/sidepanel/navigation.ts`
- `entrypoints/sidepanel/App.tsx`

Current nested surfaces:

- Library: `MemoryPage`, `SavedPage`
- Capabilities: `SkillPage`, `McpPage`, `ToolsPage`, `BrowserControlPage`, `RuntimeDoctorPage`, `PresetPage`, `AutomationPage`
- Settings: `General`, `API`, `Prompt`, `Voice`, `Appearance`, `Usage`, `Data`, `About`

Verified source:

- `entrypoints/sidepanel/pages/LibraryPage.tsx`
- `entrypoints/sidepanel/pages/CapabilitiesPage.tsx`
- `entrypoints/sidepanel/pages/SettingsPage.tsx`

Current operational context already aggregates several sources useful for Sidebar v2:

- runtime doctor
- project state
- current DeepSeek conversation
- prompt injection settings
- tool descriptors

Verified source:

- `entrypoints/sidepanel/global-operational-context.tsx`
- `core/operational-context.ts`

## Required V2 Access Model

Sidebar v2 should not expose every admin surface as a top-level tab.

It should expose:

- Home for normal work
- global menu for recents, projects, skills, personal intelligence, settings, system
- composer controls for model, voice, attachments, slash skills, send
- settings/system list for all advanced surfaces

Old pages may remain as actual React pages. The implementation can route to them from the new shell instead of deleting or rewriting them in the first pass.

## Capability Map

| Existing capability | Current source | Current runtime contract | Required Sidebar v2 path |
| --- | --- | --- | --- |
| Chat submit | `ChatPage.tsx` | `CHAT_SUBMIT_PROMPT` | Home composer |
| New chat/session | `ChatPage.tsx` | `CHAT_NEW_SESSION` | Header `New` and composer/session menu |
| Auth/provider state | `ChatPage.tsx` | `GET_AUTH_STATUS`, `AUTH_STATUS_CHANGED` | Home status/header and model/session menu |
| Official API chat config | `ChatPage.tsx`, `core/chat/official-api-config.ts` | `GET_OFFICIAL_API_CHAT_CONFIG`, `SAVE_OFFICIAL_API_CHAT_CONFIG` | Composer model dropdown |
| DeepSeek web session strategy | `ChatPage.tsx`, settings state | `GET_PERSONAL_CONVENIENCE_CONFIG`, `SAVE_PERSONAL_CONVENIENCE_CONFIG` | Composer/session menu and Settings |
| Voice settings | `ChatPage.tsx`, `VoiceSettingsPanel.tsx`, `VoiceSubPage.tsx` | `GET_VOICE_SETTINGS`, `SAVE_VOICE_SETTINGS`, `VOICE_SETTINGS_UPDATED` | Composer mic and Settings > Voice |
| Voice capability detection | `ChatPage.tsx`, `VoiceSettingsPanel.tsx` | `GET_VOICE_CAPABILITIES` | Composer mic disabled/available state |
| Image attach | `ChatPage.tsx` | local file picker and DeepSeek web vision serialization | Composer plus menu |
| Current tab image capture | `ChatPage.tsx` | `CAPTURE_CURRENT_TAB_IMAGE`, `REQUEST_HOST_PERMISSION` | Composer plus menu or context row |
| Browser control target capture | `ChatPage.tsx` | `CAPTURE_BROWSER_CONTROL_TARGET_IMAGE` | Composer plus menu or context row |
| Browser control enable/settings | `BrowserControlPage.tsx` | `GET_BROWSER_CONTROL_SETTINGS`, `SAVE_BROWSER_CONTROL_SETTINGS`, `SET_BROWSER_CONTROL_ENABLED` | Settings/System > Browser Control |
| Browser control target/lock/detach | `BrowserControlPage.tsx` | `GET_BROWSER_CONTROL_STATE`, `SET_BROWSER_CONTROL_TARGET`, `LOCK_BROWSER_CONTROL_TARGET`, `CLEAR_BROWSER_CONTROL_TARGET_LOCK`, `DETACH_BROWSER_CONTROL` | Home context row and Settings/System > Browser Control |
| Pending text insertion | `App.tsx`, `pending-text.ts`, `SavedPage.tsx` | `OPEN_CHAT_WITH_TEXT`, `pendingChatText` storage | Home composer |
| Global memory list | `MemoryPage.tsx` | `GET_MEMORIES` | Personal Intelligence and System > Library > Memory |
| Memory save/update/delete | `MemoryPage.tsx`, `ProjectsPage.tsx` | `SAVE_MEMORY`, `UPDATE_MEMORY`, `DELETE_MEMORY`, `STATE_UPDATED` | Personal Intelligence details and Project details |
| Saved prompts/items | `SavedPage.tsx` | `GET_SAVED_ITEMS`, `SAVE_SAVED_ITEM`, `DELETE_SAVED_ITEM`, `SAVED_ITEMS_UPDATED` | Global menu > Library, slash/plus menu, System > Library |
| Insert saved prompt into DeepSeek page | `SavedPage.tsx` | `INSERT_SAVED_PROMPT_IN_ACTIVE_DEEPSEEK_TAB` | Saved prompt action and fallback to Home composer |
| Saved item export | `SavedPage.tsx`, export helpers | local markdown/json artifact creation | System > Library > Saved |
| Project state | `ProjectsPage.tsx`, `core/project` | `GET_PROJECT_CONTEXT_STATE`, `PROJECT_CONTEXT_UPDATED` | Projects list and Home context |
| Project create/update/delete | `ProjectsPage.tsx` | `CREATE_PROJECT_CONTEXT`, `UPDATE_PROJECT_CONTEXT`, `DELETE_PROJECT_CONTEXT` | Projects `New` and `Manage` flows |
| Current conversation binding | `ProjectsPage.tsx` | `GET_CURRENT_DEEPSEEK_CONVERSATION`, `ADD_CONVERSATION_TO_PROJECT`, `REMOVE_CONVERSATION_FROM_PROJECT` | Projects detail and context row |
| Pending project for next conversation | `ProjectsPage.tsx` | `SET_PENDING_PROJECT_CONTEXT` | Project card primary action |
| Project memories | `ProjectsPage.tsx`, `MemoryCard`, `MemoryForm` | memory contracts with `scope: project` | Project details |
| Skill library | `SkillPage.tsx` | `GET_SKILL_LIBRARY` | Home skills preview, slash menu, System > Skills |
| Skill enable/delete/save | `SkillPage.tsx` | `SAVE_SKILL`, `DELETE_SKILL`, `SET_SKILL_ENABLED` | System > Skills manage |
| GitHub skill sources | `SkillPage.tsx`, `GitHubSkillImportPanel.tsx` | `GET_GITHUB_SKILL_SOURCES`, `PREVIEW_GITHUB_SKILL_SOURCE`, `IMPORT_GITHUB_SKILL_SOURCE`, `CHECK_GITHUB_SKILL_SOURCE_UPDATES`, `UPDATE_GITHUB_SKILL_SOURCE`, `DELETE_GITHUB_SKILL_SOURCE` | System > Skills > Add/Manage |
| Local skill import | `LocalSkillImportPanel.tsx` | `PREVIEW_LOCAL_SKILL_SOURCE`, `PICK_LOCAL_SKILL_FOLDER`, `IMPORT_LOCAL_SKILL_SOURCE` | System > Skills > Add |
| MCP servers | `McpPage.tsx` | `GET_MCP_SERVERS`, `GET_MCP_SERVER`, `CREATE_MCP_SERVER`, `UPDATE_MCP_SERVER`, `DELETE_MCP_SERVER`, `MCP_SERVERS_UPDATED` | Settings/System > MCP |
| MCP tool cache/discovery | `McpPage.tsx`, `ToolsPage.tsx` | `GET_MCP_TOOL_CACHE`, `REFRESH_MCP_SERVER_TOOLS`, `TEST_MCP_SERVER_CONNECTION` | Settings/System > MCP and Tools |
| MCP permissions | `McpPage.tsx` | `REQUEST_MCP_SERVER_PERMISSION` | Settings/System > MCP |
| Tool descriptors | `ToolsPage.tsx`, `GlobalOperationalContext` | `GET_TOOL_DESCRIPTORS`, `REFRESH_TOOL_DESCRIPTORS`, `TOOL_DESCRIPTORS_UPDATED` | Home skills/tools preview and System > Tools |
| Web tools | `ToolsPage.tsx` | `GET_WEB_TOOL_SETTINGS`, `SET_WEB_TOOL_SETTING`, `DIAGNOSE_WEB_SEARCH` | Settings/System > Tools |
| Tool call history | `McpPage.tsx` | `GET_TOOL_CALL_HISTORY`, `CLEAR_TOOL_CALL_HISTORY`, `TOOL_CALL_HISTORY_UPDATED` | Settings/System > MCP or Tools |
| Presets | `PresetPage.tsx` | `GET_PRESETS`, `SAVE_PRESET`, `DELETE_PRESET`, `SET_ACTIVE_PRESET`, `GET_ACTIVE_PRESET` | Settings/System > Presets |
| Runtime doctor | `RuntimeDoctorPage.tsx` | `GET_RUNTIME_DOCTOR_REPORT`, `REFRESH_DEEPSEEK_WEB_AUTH`, `RUN_PERSONAL_AUTOPILOT_REPAIR`, `RELOAD_STALE_DEEPSEEK_TABS`, `RUN_PERSONAL_HUMAN_EVAL` | Settings/System > Runtime Doctor |
| Automation list/runs | `AutomationPage.tsx` | `GET_AUTOMATIONS`, `GET_AUTOMATION_RUNS`, `GET_AUTOMATION_RUNS_BATCH` | Settings/System > Automation |
| Automation create/update/status/delete/run | `AutomationPage.tsx` | `CREATE_AUTOMATION`, `UPDATE_AUTOMATION`, `SET_AUTOMATION_STATUS`, `DELETE_AUTOMATION`, `RUN_AUTOMATION_NOW` | Settings/System > Automation |
| Prompt injection settings | `PromptControlPanel.tsx`, `PromptSubPage.tsx`, `GlobalOperationalContext` | `GET_PROMPT_INJECTION_SETTINGS`, `SAVE_PROMPT_INJECTION_SETTINGS` | Settings > Personal Intelligence/Prompt and System |
| API key settings | `ApiSubPage.tsx`, `useSettingsState.ts` | `GET_DEEPSEEK_API_KEY_STATUS`, `SAVE_DEEPSEEK_API_KEY`, `CLEAR_DEEPSEEK_API_KEY` | Settings > API |
| Multimodal settings | `ApiSubPage.tsx`, `useSettingsState.ts` | `GET_MULTIMODAL_SETTINGS_STATUS`, `SAVE_MULTIMODAL_SETTINGS`, `CLEAR_MULTIMODAL_SETTINGS` | Settings > API |
| General settings | `GeneralSubPage.tsx`, `useSettingsState.ts` | `GET_MODEL_TYPE`, `SET_MODEL_TYPE`, personal convenience contracts | Settings > General |
| Usage stats | `UsageSubPage.tsx` | `GET_USAGE_SUMMARY`, `CLEAR_USAGE_STATS` | Settings > Usage |
| Data/sync | `DataSubPage.tsx`, `useSettingsState.ts` | `GET_SYNC_CONFIG`, `SAVE_SYNC_CONFIG`, `WEBDAV_TEST`, `WEBDAV_UPLOAD_LOCAL`, `WEBDAV_DOWNLOAD_REMOTE` | Settings > Data |
| Appearance background/pet | `AppearanceSubPage.tsx`, `useSettingsState.ts` | `GET_BACKGROUND`, `SAVE_BACKGROUND`, `CLEAR_BACKGROUND`, `GET_PET`, `SAVE_PET`, `CLEAR_PET` | Settings > Appearance |
| Whats New dismissal | `WhatsNewPanel.tsx` | `WHATS_NEW_DISMISSED` | System/About or lightweight announcement, not dominant Home card |
| Platform capability detection | `McpPage.tsx`, `ToolsPage.tsx` | `GET_PLATFORM_CAPABILITIES` | System pages |

## Implementation Constraints

### Shell

`App.tsx` currently owns:

- top-level tab state
- capability subtab state
- chat enabled fallback to Library
- pending text routing into Chat
- lazy-loaded old pages

Sidebar v2 should preserve those behaviors while changing visible IA.

Recommended implementation approach:

1. Expand navigation types to include v2 surfaces and an advanced/system route.
2. Keep old pages mounted through a `System` or `Advanced` route.
3. Keep `setPendingText` behavior routed to Home composer.
4. Keep `chatEnabled === false` fallback, but make the destination a non-chat system/library surface.

### Operational Context

Do not duplicate runtime status aggregation before checking:

- `GlobalOperationalContextProvider`
- `createGlobalOperationalContext`
- `getContextBarItems`

Sidebar v2 Home context row should reuse this projection where possible.

If the current projection is too context-bar-specific, add a small typed adapter rather than querying every background message again from Home.

### Projects

`ProjectsPage.tsx` already contains the full mutation set. The redesign should change layout and progressive disclosure, not delete logic.

Required preservation checks:

- create project
- select project
- update project
- delete project
- add current conversation
- remove conversation
- use for next conversation
- add/update/delete/toggle project memory

### Skills

`SkillPage.tsx` owns management; Home should preview/run/navigate, not reimplement all management.

Required preservation checks:

- custom skill save
- enable/disable
- delete
- GitHub import/update/delete
- local import
- library grouping

### Settings

`SettingsPage.tsx` currently exposes eight subtabs. V2 may replace the top visual list, but each subpage must remain reachable.

Required preservation checks:

- general
- API
- prompt
- voice
- appearance
- usage
- data
- about

## Test Targets After Approval

Add or update tests for:

1. Sidebar navigation routes all old capabilities through the new System/Advanced access.
2. Pending text opens Home composer.
3. Chat disabled state does not route to a missing surface.
4. Projects page preserves mutation handlers and hides forms behind `New`/`Manage` initially.
5. Model selector config persists via `SAVE_OFFICIAL_API_CHAT_CONFIG`.
6. Composer attachment controls still call current tab and browser target capture contracts.
7. Personal Intelligence empty state is honest when memory/project data is absent.

Existing likely test areas:

- `tests/sidepanel-navigation.test.ts`
- store and projection tests under `tests/`

## Approval-Gate Notes

This document is allowed before Kevin approves the mockup because it does not mutate production UI.

Do not implement the shell until the approval gate is crossed.
