# DeepSeek Pet Context Brief

This file is a compact grounding brief for second-model review. It summarizes inspected source paths in `/Users/kyin/Projects/deepseek-pp-pet` without attaching the largest content/background entrypoints in full.

## Current Product Shape

- Stack: WXT + React + TypeScript MV3 browser extension for `chat.deepseek.com`.
- Core product: DeepSeek Web prompt interception, memory, Skills, MCP tools, browser control, sidepanel chat, automation, Runtime Doctor, personal convenience defaults, and a floating DeepSeek whale pet.
- Public docs describe the pet as state-aware feedback: thinking, streaming, tool execution, success/failure, speech bubbles, adjustable position, size, opacity, and motion.

## Existing Pet Implementation

- `core/pet/config.ts`
  - Owns `DEFAULT_PET_CONFIG`, size/opacity clamps, `PetPosition`, custom position normalization, and `normalizePetConfig`.
  - Default: disabled, bottom-right, size 132, opacity 0.96, motion enabled.
- `core/pet/store.ts`
  - Persists config under `chrome.storage.local` key `deepseek_pp_pet`.
- `core/pet/lines.ts`
  - Defines `PetState`: `idle`, `thinking`, `speaking`, `working`, `confused`, `success`, `error`, `sleepy`.
  - Uses localized line arrays and random non-recent speech selection.
- `core/types.ts`
  - Defines `PetConfig`, `PetCustomPosition`, `PetPosition`, runtime messages `GET_PET`, `SAVE_PET`, `CLEAR_PET`.
- `public/pet/deepseek-whale-pet-states.png`
  - Sprite sheet referenced by content script.

## Content Script Pet Surface

Large file not attached in full: `entrypoints/content.ts`.

Inspected regions:

- Constants near top:
  - `PET_HOST_ID = 'dpp-pet-host'`
  - `PET_STYLE_ID = 'dpp-pet-css'`
  - `PET_IDLE_DELAY_MS = 900`
  - `PET_FEEDBACK_DELAY_MS = 1400`
  - `PET_SLEEP_DELAY_MS = 12000`
  - `PET_SPRITE_PATH = 'pet/deepseek-whale-pet-states.png'`
  - bubble visible/repeat limits.
- Startup:
  - Loads `GET_PET`, applies config with `applyPetConfig`.
  - Listens for `PET_UPDATED`.
- State sources:
  - Main-world `TOOL_CALL` sets pet `working`.
  - `RESPONSE_TOKEN_SPEED` drives `thinking`/`speaking`.
  - `RESPONSE_COMPLETE` schedules idle.
  - Inline-agent loop events set `working`, `speaking`, `success`, `error`.
  - Tool card result sets `success` or `error`.
- Rendering:
  - `applyPetConfig`, `ensurePet`, `removePet`, `setPetState`, `applyPetState`, `schedulePetIdle`, `schedulePetSleep`.
  - Speech bubbles rotate for `idle`, `thinking`, `speaking`, `working`.
  - `updatePetFromTokenSpeed` maps active streaming to `speaking` if text exists, else `thinking`.
  - Dragging writes custom position via `SAVE_PET`.
  - CSS and markup are injected in `entrypoints/content.ts`; host is `aria-hidden="true"`, fixed, draggable, pointer-enabled.

Current limitation: the pet is reactive telemetry and decorative status feedback. It is not a command surface, queue, readiness dashboard, agent control panel, review gate, or handoff viewer.

## Background Runtime Surfaces

Large file not attached in full: `entrypoints/background.ts`.

Inspected regions:

- Pet storage messages:
  - `GET_PET` returns `getPetConfig()`.
  - `SAVE_PET` persists and calls `broadcastPetUpdate`.
  - `CLEAR_PET` clears and broadcasts default config.
  - `broadcastPetUpdate(config)` sends `{ type: 'PET_UPDATED', config }` to tabs.
- Runtime Doctor:
  - `GET_RUNTIME_DOCTOR_REPORT`
  - `RUN_PERSONAL_AUTOPILOT_REPAIR`
  - `RUN_PERSONAL_HUMAN_EVAL`
  - Readiness, blockers, leak sentry, human eval checks, autopilot run ledger, failure explanations.
- Personal convenience:
  - Startup calls `ensurePersonalRuntimeReady`.
  - Automation runner uses personal convenience settings for readiness and session strategy.

## Existing Personal/Autopilot Infrastructure

- `core/personal-convenience/config.ts`
  - Default enabled.
  - Defaults: auto readiness before runs, auto refresh Web auth, reuse last session, visual monitor default on, reduced confirmations, comfortable descriptions.
- `core/personal-convenience/autopilot-ledger.ts`
  - Stores up to 30 metadata-only autopilot runs under `deepseek_pp_autopilot_run_ledger_v1`.
  - Normalizes source/status/grade/blockers/target status/repaired/leak issue count.
- `core/chat/runtime-doctor.ts`
  - Defines report shape: readiness, browser control, content health, automation retryable failure, autopilot, human eval, leak sentry, leak quarantine, debug distiller suggestions.
  - Scans storage for forbidden durable auth headers, session state in local storage, raw image data, Vision refs, and auth tokens.

## Existing Automation/Loop Infrastructure

- `core/automation/readiness.ts`
  - Grades automations A-F with blockers/warnings/info.
  - Detects weak loop contracts, missing stop condition, scheduled memory delete risk, research without search, evaluation without thinking, vision inconsistency, sensitive prompt content.
  - Defines reusable loop and review-gate contracts:
    - Workflow contract: plan, evaluate evidence, review risks, grade confidence, iterate once if useful, stop with next action.
    - Review gate: self-review correctness/evidence/safety/usefulness, grade A-F, iterate once if below A or gap remains.
- `core/automation/workflow-templates.ts`
  - Contains templates for runtime readiness recovery, deep research swarm, project status council, implementation council, browser watchtower, review-grade-iterate, systematic debug loop, prompt workflow refinery, memory hygiene council, source monitor.
- `core/automation/runner.ts`
  - Runs DeepSeek automation, resolves personal session strategy, handles preflight, visual monitor/evidence packs, browser tool calls, tool continuation route.
- `core/inline-agent/*`
  - Owns in-chat continuation loop after manual MCP tool calls.
- `core/tool-loop/engine.ts`
  - Shared utility for tool loop records and continuation mechanics.

## Sidepanel Surfaces

- `entrypoints/sidepanel/components/settings/AppearanceSubPage.tsx`
  - Exposes floating pet controls.
- `entrypoints/sidepanel/components/settings/GeneralSubPage.tsx`
  - Exposes personal convenience controls.
- `entrypoints/sidepanel/components/settings/useSettingsState.ts`
  - Loads/saves pet config and personal config.
- `entrypoints/sidepanel/pages/RuntimeDoctorPage.tsx`
  - Shows readiness, blockers, autopilot ledger, human eval, leak/quarantine, debug suggestions.
- `entrypoints/sidepanel/pages/AutomationPage.tsx`
  - Shows automation templates, readiness grading, safe prompt/option fixes, visual monitor controls.
- `entrypoints/sidepanel/pages/ChatPage.tsx`
  - Sidepanel chat with personal same-session strategy and reduced confirmations.

## Constraints From Repo Docs

- `docs/refactor-current-architecture.md` says prompt output is frozen byte-for-byte for system templates, tool schema rendering, tool reminders, and inline-agent continuation/nudge/finalization prompts.
- It also says current product surface/compatibility must remain: automation UI, inline agent, MCP, memory, Skill, preset, settings, `deepseek_pp_automations`, and `DPP_AUTOMATION_*`.
- `AGENTS.md` says README/public docs should be user-facing feature docs and avoid exposing internal API paths/protocol details.
- Storage safety matters: no durable secrets, auth headers, raw screenshots, or durable Vision refs.

## Working Default For This Feature

The pet should probably become a thin control surface over existing runtime readiness, automation, personal convenience, browser target, and review-gate infrastructure. It should not become a parallel runtime, hidden autonomous actor, or second sidepanel.
