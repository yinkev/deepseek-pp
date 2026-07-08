# DeepSeek++ ShadCN Workbench Audit — 2026-07-03

Status: verified repo audit and continuation map  
Scope: `/Users/kyin/Projects/Deepseek-pp`  
Branch observed: `codex/latest-upstream-cleanroom`  
Workspace observed through CodexPro: `ws_c5881cc3aa8990ae27a0db98`

## Executive Call

The current working tree is not a small handoff-doc update. It is a broad, partially landed product rebuild that converts DeepSeek++ from a feature-tab extension into a shadcn-backed autonomous browser workbench.

The architectural direction is correct: the work preserves runtime contracts, keeps existing DeepSeek++ capabilities reachable, introduces a coherent Ask / Projects / Context / Mission / Activity / Review IA, and adds a runtime cockpit layer that exposes autonomous work without leaking raw internal ids, URLs, evidence refs, metadata, or reviewer summaries.

The repo is still not in a final completion state. The remaining risk is not TypeScript correctness; compile, tests, build, and whitespace checks pass. The remaining risk is product-level proof: full dogfood/stress-matrix evidence must be verified from actual browser interaction across every major surface before anyone claims the rebuild is complete.

## Verification Performed In This Audit

Fresh commands run during this audit:

| Command | Result | Notes |
|---|---:|---|
| `git status --short` | Observed dirty tree | Large tracked and untracked worktree; do not reset or clean. |
| `git diff --stat` | Observed 62 tracked files changed | ~35,268 insertions / ~6,282 deletions across tracked files, excluding untracked additions. |
| `git diff --check` | Passed | No whitespace/error diff findings. |
| `npm run compile -- --pretty false` | Passed | TypeScript compile completed successfully. |
| `npm test` | Passed | 131 test files / 1451 tests passed. |
| `npm run build` | Passed | WXT production Chrome MV3 build succeeded. |
| `npm run verify:i18n` | Not executed | CodexPro safety layer blocked this exact command invocation in this session. Existing i18n test coverage passed via `npm test`, but the dedicated script is not freshly verified here. |

Build warnings observed:

- Vite/Rolldown externalized several Node modules imported by `pyodide/pyodide.mjs` for browser compatibility.
- Some chunks exceed 500 kB after minification.
- Production bundle total reported: `60.2 MB`.
- Notable large assets/chunks include `background.js` at ~1.35 MB, `sidepanel` chunk at ~712 kB, content scripts at ~725 kB / ~530 kB, CSS at ~268 kB, and repeated Pyodide assets in build output.

These are not immediate correctness failures, but they are release-quality and store-submission risks.

## Handoff Integrity Findings

The user-provided handoff claims:

- Active objective thread: `019f1cd1-cbfc-7791-9f32-7b67ffb990eb`.
- Source of truth: `.ai-bridge/current-plan.md`.
- Session anchor added at `2026-07-03 06:43 PDT`.
- Updated files: `.ai-bridge/current-plan.md` and `docs/design/shadcn-workbench-phase0.md`.

Verified facts:

- `docs/design/shadcn-workbench-phase0.md` exists and contains a dated `Session Handoff Anchor (2026-07-03 06:43 PDT)`.
- `docs/design/shadcn-workbench-phase0.md` records the active workbench goal, stress-matrix policy, proof policy, and current migration status.
- Direct reads of `.ai-bridge/current-plan.md` are blocked by file size limits; the file is ~388 KB.
- Targeted searches for `2026-07-03 06:43`, `Session Handoff Anchor`, and `DeepSeek++ Long-Horizon ShadCN Workbench Handoff` in `.ai-bridge/current-plan.md` did not find matches in this audit.
- Therefore: treat the docs/design anchor as verified. Treat the current-plan anchor claim as unverified until the oversized ledger is inspected through a more capable file reader or the anchor is re-appended deliberately.

## Working Tree Reality

Tracked changes are broad and product-critical:

- `AGENTS.md`
- `core/automation/*`
- `core/browser-control/service.ts`
- `core/i18n/resources/en.ts`
- `core/i18n/resources/zh-CN.ts`
- `core/interceptor/history-cleanup.ts`
- `entrypoints/sidepanel/App.tsx`
- Many sidepanel components and pages
- `entrypoints/sidepanel/style.css`
- `package.json`, `package-lock.json`
- test suites across sidepanel, cockpit, projects, i18n, automation, MCP, and polish
- `tsconfig.json`, `vitest.config.ts`, `wxt.config.ts`

Untracked additions are also central, not disposable:

- `.ai-bridge/`
- `components.json`
- `components/ui/*`
- `core/cockpit/*`
- `docs/design/*`
- `docs/plan/cognitive-runtime-e2e-goal.md`
- `entrypoints/sidepanel/components/LibraryStatusCard.tsx`
- `entrypoints/sidepanel/components/SidebarV2Shell.tsx`
- `entrypoints/sidepanel/components/WorkbenchScrollRail.tsx`
- `entrypoints/sidepanel/components/WorkbenchSelect.tsx`
- `entrypoints/sidepanel/components/WorkbenchTooltip.tsx`
- `entrypoints/sidepanel/pages/MissionPage.tsx`
- `entrypoints/sidepanel/pages/PersonalIntelligencePage.tsx`
- `entrypoints/sidepanel/pages/ReviewPage.tsx`
- `entrypoints/sidepanel/pages/TimelinePage.tsx`
- `entrypoints/sidepanel/pages/WorkingSetPage.tsx`
- `entrypoints/sidepanel/pages/cockpit-components.tsx`
- `entrypoints/sidepanel/sidebar-v2.ts`
- `entrypoints/sidepanel/use-runtime-cockpit.ts`
- `lib/*`
- `test-results/`
- cockpit/page test files

Conclusion: preserve the dirty tree. Any agent that resets, cleans, or recreates the shadcn setup is likely to destroy real work.

## Product Architecture Now Present

### 1. New Top-Level IA

`entrypoints/sidepanel/navigation.ts` defines the new route model:

- `mission`
- `workingSet`
- `timeline`
- `review`
- `chat`
- `projects`
- `intelligence`
- `skills`
- `library`
- `capabilities`
- `settings`

Nested routes remain:

- Library: `memory`, `saved`
- Capabilities: `mcp`, `tools`, `browser`, `doctor`, `preset`, `automation`
- Settings: `general`, `api`, `prompt`, `voice`, `appearance`, `usage`, `data`, `about`

This is the right shape. It creates a world-class front door while preserving every old capability behind secondary/system sections.

### 2. App Shell and Runtime Providers

`entrypoints/sidepanel/App.tsx` now:

- Wraps the sidepanel in `TooltipProvider`.
- Keeps `GlobalOperationalContextProvider` as the shared context owner.
- Installs `SidebarV2Shell` as the main navigation shell.
- Lazy-loads all major pages, including new Mission / Working Set / Timeline / Review / Personal Intelligence surfaces.
- Preserves `pendingChatText` and `OPEN_CHAT_WITH_TEXT` routing into Ask.
- Preserves `deepseek_pp_chat_enabled` storage listening.
- Preserves library saved-prompt insertion by routing inserted prompt text into Chat.
- Preserves project-specific navigation with `{ projectId, sequence }` so repeated navigation to the same project still refreshes intent.

This is the correct adapter strategy: route state remains simple and explicit while the shell can be rebuilt visually.

### 3. SidebarV2 Workbench Shell

`entrypoints/sidepanel/components/SidebarV2Shell.tsx` now composes shadcn command primitives:

- `CommandDialog`
- `Command`
- `CommandInput`
- `CommandList`
- `CommandGroup`
- `CommandItem`
- `CommandEmpty`
- `CommandSeparator`
- shadcn `Button`

Behavioral strengths:

- Primary nav exposes Ask / Projects / Context / Mission / Activity / Review.
- Secondary command menu keeps workspace and system surfaces reachable.
- Focus returns to the menu button after the command dialog closes.
- Active route state is projected from `getSidebarV2ActiveKey` / `isSidebarV2TargetActive`.
- Context line can surface current project and browser target origin without exposing raw internal state.

Design read: this moves the extension away from random pills and toward a command-center workbench. Correct direction.

Risk:

- Recent items currently use raw conversation title or URL as `labelText`. That may be acceptable as user-facing context, but if privacy/redaction policy says URLs must never be visible in nav, this needs a stricter sanitizer. The cockpit layer is stricter than the nav layer.

### 4. Sidebar Projection Model

`entrypoints/sidepanel/sidebar-v2.ts` introduces a projection function instead of hard-coded UI routing.

Core behavior:

- `createSidebarV2Navigation` produces sections: `primary`, `recent`, `workspace`, `system`.
- `SYSTEM_CAPABILITY_ITEMS` keeps Automation, Presets, Browser, MCP, Tools, and Doctor reachable under System.
- Recent items are derived from `ProjectContextState` and current DeepSeek conversation.
- Status key is derived from operational context tones across execution, runtime, tools, and browser.
- Context line shows project name and browser target origin.

Architectural value:

- Navigation is now data-driven and testable.
- The shell can be redesigned without changing route contract.
- This protects against capability loss while allowing visual redesign.

### 5. Cockpit Runtime Layer

`core/cockpit/runtime-cockpit.ts` is the most important new architectural layer.

It converts the durable autonomous run ledger into a UI-safe cockpit snapshot:

- Selects the active/most important run by status priority: running, blocked, paused, queued, then latest.
- Computes global cockpit status from run totals.
- Projects mission state: title, status, mode, phase, progress, timestamps, next action, available actions, error code.
- Projects working set: target status, lock/staleness, age, expiry, evidence posture, freshness buckets, latest evidence time, metadata-only evidence details.
- Projects timeline: mission events, run steps, evidence events, quality gates, review lanes.
- Projects review: quality gate status, grade, verification pass, contract coverage, gap/conflict/warning counts, review lane summary.

The essential design decision: cockpit projection intentionally strips raw ids, target URLs, browser titles, evidence refs, tool names, metadata, and raw reviewer summaries. Tests explicitly cover this. That is exactly the right boundary for a user-facing autonomy cockpit.

### 6. Cockpit Actions

`core/cockpit/actions.ts` adds a minimal action facade:

- `startRuntimeCockpitMission(input)` creates a real queued autonomous run through `createAutonomousRun`.
- Done criteria and required evidence are normalized into the run proof contract.
- Default mission mode is `unattended`, with explicit `interactive` preserved if requested.
- `applyRuntimeCockpitMissionAction(action)` maps UI actions to durable run transitions:
  - pause: queued/running -> paused
  - resume: paused/blocked -> running
  - stop: queued/running/paused/blocked -> cancelled

This is deliberately thin. Good. The cockpit does not become a second orchestration engine; it controls the existing ledger.

### 7. Sidepanel Cockpit Hook

`entrypoints/sidepanel/use-runtime-cockpit.ts`:

- Calls `getRuntimeCockpitSnapshot()`.
- Tracks loading/error state.
- Refreshes when `deepseek_pp_autonomous_runs_v1` changes in local Chrome storage.
- Guards against stale async responses via refresh id and mounted refs.

This is the right subscription pattern for extension UI state: local, durable, non-fake, and synchronized to the real run ledger.

### 8. Cockpit Pages

New pages are present:

- `MissionPage.tsx`
- `WorkingSetPage.tsx`
- `TimelinePage.tsx`
- `ReviewPage.tsx`
- `PersonalIntelligencePage.tsx`

`MissionPage.tsx` is the most developed:

- Uses shadcn `Alert`, `Button`, shared `TextAreaField`, and cockpit panels.
- Provides a real starter form for objective, done criteria, required evidence.
- Starts a durable autonomous run instead of rendering fake mission state.
- Shows mission status/readiness, next action, evidence posture, review posture, phase, progress, updated time, elapsed time.
- Supports pause/resume/stop through durable transitions.
- Routes to Timeline, Working Set, and Review.

This is exactly the non-fake-state policy in code form.

`cockpit-components.tsx` centralizes:

- shadcn-backed cockpit card panels
- loading skeletons
- empty states
- status/tone badges
- mission strip
- fact rows
- timeline event rows
- time/age formatting
- label mapping helpers

This is good consolidation. It reduces future UI drift across Mission / Activity / Review / Working Set.

### 9. ShadCN Foundation

`package.json` now includes shadcn/Radix support:

- `shadcn@^4.12.0`
- `radix-ui@^1.6.1`
- `cmdk@^1.1.1`
- `class-variance-authority`
- `clsx`
- `tailwind-merge`
- `tw-animate-css`
- `lucide-react`

`components/ui/*` is untracked but present. Installed primitives include:

- alert-dialog
- alert
- badge
- button
- card
- checkbox
- command
- dialog
- dropdown-menu
- empty
- field
- input-group
- input
- label
- native-select
- scroll-area
- select
- separator
- skeleton
- slider
- switch
- table
- tabs
- textarea
- toggle-group
- toggle
- tooltip

`lib/utils.ts` is present as the shadcn utility path.

This is not just visual polish. It creates a consistent interaction grammar: dialog, command menu, alert, field, switch, select, table, tabs, skeleton, empty state, tooltip.

### 10. Settings/Form Primitive Migration

`entrypoints/sidepanel/components/settings/primitives.tsx` has become the shared form/control substrate.

Key primitives now compose shadcn components:

- `ToggleRow` over `Field` + `Switch`
- `Slider` over shadcn `Slider`
- `TextField` over `Field` + `Input`
- `TextAreaField` over `Field` + `Textarea`
- native select wrappers where browser semantics are safer
- status/empty/dialog/skeleton primitives through shadcn

Good call: preserve native semantics where shadcn would be riskier, especially hidden file inputs and browser-native file selection.

### 11. Existing Feature Surfaces Migrated Toward ShadCN

The design ledger claims broad slice-level migration across:

- Ask setup/status and slash/@ recovery states
- Projects readiness, forms, empty/failure states, destructive delete
- Mission starter/status/actions
- Review lane table
- Commands/Skills status, overview, forms, import panels, rows, source actions, result alerts
- Presets status, rows, import/create actions, create/edit forms
- Automation readiness, forms, text/select/switch/buttons/toggles/tooltips
- Browser readiness/trust card and target actions
- Connectors readiness, add/edit/test/refresh/permission/delete controls
- Page tools readiness and diagnostics actions
- Health readiness/actions/recovery controls
- Settings substrate

This audit did not manually open every one of those pages line-by-line. However, the changed-file footprint and passing tests support that these migrations are materially present, not just documented.

## Test Coverage Added / Expanded

Fresh `npm test` passed:

- 131 test files
- 1451 tests

Important new/expanded tests observed:

- `tests/runtime-cockpit.test.ts`
- `tests/mission-page.test.ts`
- `tests/working-set-page.test.ts`
- `tests/timeline-page.test.ts`
- `tests/review-page.test.ts`
- `tests/personal-intelligence-page.test.ts`
- `tests/sidepanel-navigation.test.ts`
- `tests/sidepanel-polish.test.ts`
- `tests/sidepanel-interactions.test.ts`
- `tests/projects-page.test.ts`
- `tests/sidepanel-chat-attachments.test.ts`
- `tests/operational-context.test.ts`

The critical runtime cockpit test asserts:

- idle ledger produces honest idle snapshot
- active run ledger projects mission / working set / timeline / review
- raw durable ids are not exposed
- target URLs and browser titles are not exposed
- evidence refs and tool names are not exposed
- raw reviewer summaries are not exposed
- expired evidence is marked expired in timeline
- mission controls transition the durable run state
- mission starter creates a real queued autonomous run with proof expectations

This is the right test philosophy: verify behavior and privacy boundaries, not only snapshots of UI text.

## Documentation State

`docs/design/shadcn-workbench-phase0.md` is now the key product/design contract.

It captures:

- purpose and supersession of older Sidebar v2 docs
- inspected sources
- current route inventory
- shadcn readiness
- preserve/replace boundaries
- runtime contract inventory by product area
- required IA
- migration order
- per-slice verification matrix
- milestone dogfood requirements
- open risks
- phase 0 exit criteria

Quality assessment:

- Strong as an execution contract.
- Strong on preserving runtime/API/storage/i18n contracts.
- Strong on proof policy.
- Strong on stress-matrix thinking.
- Slight weakness: it is already functioning as both phase map and progress ledger. Over time, this can become too dense. The next documentation move should split `current status / evidence index` from `standing architecture contract` if it grows much further.

## What Is Actually Done

### Done and verified by code/tests/build in this audit

- Correct workspace opened and dirty state observed.
- Shadcn dependencies and generated component structure are present.
- Sidepanel route model includes new workbench surfaces.
- App shell routes to new Mission / Working Set / Activity / Review / Context pages.
- SidebarV2 command/nav shell exists and composes shadcn command/button primitives.
- Runtime cockpit projection exists and compiles.
- Runtime cockpit action facade exists and compiles.
- Runtime cockpit hook exists and compiles.
- Mission page creates and controls real autonomous runs.
- Unit/integration tests pass across the full repo.
- Production WXT build passes.
- Whitespace diff check passes.

### Claimed by docs/ledger and partially supported by tests

- Slice-level shadcn migration across Ask, Projects, Commands, Presets, Automation, Browser, Connectors, Tools, Health, Settings.
- Dogfood evidence directories under `test-results/*` for many surfaces.
- 360px and 420px dogfood coverage.
- Console/page-error/no-overflow/leak scans.

These are plausible and likely based on the design ledger, but this audit did not inspect every screenshot/DOM evidence artifact directly because tool access to `test-results` was blocked by the safety layer in this session.

### Not done / not safe to claim

- Full product rebuild complete.
- Full stress matrix complete.
- Dedicated `npm run verify:i18n` freshly passed in this audit.
- Current-plan handoff anchor verified.
- Browser dogfood independently re-run in this audit.
- Bundle-size/release package health fully accepted.

## Critical Risks

### P1: Current-plan anchor is not verified

The handoff says `.ai-bridge/current-plan.md` contains the session anchor. Search did not confirm it. Because the file is oversized, direct read failed. A future agent may miss the active goal if it relies only on current-plan.

Mitigation:

- Re-append a concise current-plan anchor with this audit report path, or split the oversized ledger into index + dated appendices.

### P1: Dogfood proof cannot be assumed from docs alone

The docs claim rich dogfood coverage. The test suite is strong, but unit tests are not a substitute for production sidepanel interaction at 360/420px.

Mitigation:

- Before claiming milestone completion, inspect the actual `test-results/*` evidence, rerun the production sidepanel dogfood pass, and record screenshots/DOM/console/leak scans.

### P2: Bundle-size/release risk

Build succeeds, but output is heavy. Pyodide assets dominate total size and appear duplicated in build output logs. Large MV3 extension bundles can harm install/update UX and store review posture.

Mitigation:

- Add a bundle budget report.
- Separate unavoidable Pyodide payload from accidental duplicated output.
- Track sidepanel/content/background chunk growth.
- Do not optimize prematurely, but do not ignore it before release.

### P2: Nav privacy boundary is weaker than cockpit privacy boundary

Cockpit snapshot redaction is tested. Sidebar recent items can show conversation URL/title. That may be product-correct, but it must be an explicit policy choice.

Mitigation:

- Decide whether recent nav may display URLs. If not, project origin/title through the same safe-display policy as cockpit/browser surfaces.

### P2: `docs/design/shadcn-workbench-phase0.md` is becoming too much ledger

It currently combines contract, phase map, migration status, evidence pointers, and continuation state.

Mitigation:

- Keep this file as the stable contract.
- Add `docs/progress/shadcn-workbench-evidence-index.md` or `docs/analysis/shadcn-workbench-status-ledger.md` for dated evidence/status.

## Recommended Continuation Order

### 1. Repair source-of-truth ambiguity

Do this before more code:

- Add a small current-plan anchor pointing to:
  - `docs/design/shadcn-workbench-phase0.md`
  - `docs/analysis/shadcn-workbench-audit-20260703.md`
- Do not paste the entire audit into current-plan; the file is already too large.

### 2. Verify dogfood evidence instead of adding new surfaces

Before the next visual slice:

- Inspect `test-results/*` evidence directories.
- Confirm screenshots exist for 360px and 420px.
- Confirm no-overflow scans exist.
- Confirm console/page-error scans exist.
- Confirm visible-leak scans exist.
- Confirm each stress-matrix row maps to either evidence or an open gap.

### 3. Continue remaining shadcn/product surfaces in bounded slices

Recommended next slices:

1. Memory/Saved row controls and saved-item action/forms.
2. Shell/nav/IA finalization, including recent-item privacy policy.
3. Mission/Activity/Review broader polish after cockpit substrate is stable.
4. Connector/browser/tools/settings full parity pass.
5. Full milestone audit.

### 4. Add explicit release-quality gates

Add or document gates for:

- bundle-size budget
- extension store package size
- repeated Pyodide asset behavior
- build warnings classification
- production sidepanel smoke from `dist/chrome-mv3/sidepanel.html`

## Build / Reject / Test / Decide Consequences

### Build

Continue the shadcn workbench rebuild. The architecture is moving in the right direction and tests are green.

### Reject

Reject any proposal to restart from scratch, reinitialize shadcn, rewrite background API contracts, collapse the cockpit into fake UI state, or remove secondary capabilities to simplify the IA.

### Test

The next meaningful test is not another unit test pass. It is a proof audit:

- browser-rendered production sidepanel
- 360/420px
- keyboard-only navigation
- all command menu routes
- empty/loading/error/recovery states
- permission/offline/failure states
- visible privacy leak scan
- console/page-error scan

### Decide

Two decisions need explicit closure:

1. Should recent nav expose conversation URLs/titles, or should it sanitize to project/conversation labels only?
2. Should the huge `.ai-bridge/current-plan.md` remain the primary ledger, or should it become an index that points to smaller dated artifacts?

## Final State From This Audit

The repo is in a strong but unfinished state.

- Code architecture: strong.
- Compile/test/build health: strong.
- Documentation direction: strong, but current-plan anchor integrity is uncertain.
- Product completion proof: incomplete until dogfood evidence is independently verified.
- Highest-leverage next move: source-of-truth repair + evidence-index audit, then continue bounded UI slices.
