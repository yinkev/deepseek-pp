# DeepSeek++ UI/UX Cockpit Roadmap

## Phase 2.5 — Operational State Bus (Complete)

Phase 2.5 hardens `GlobalOperationalContext` into the operational state bus consumed by future cockpit surfaces. The current name remains to avoid gratuitous churn, but the architecture now separates state creation from selectors, attention derivation, activity summary, freshness metadata, and UI rendering.

Implemented contracts:

- `OperationalHealth` and `OperationalAvailability` define shared subsystem semantics instead of per-component status strings.
- `getOperationalHealth`, `getBrowserAttention`, `getRuntimeAttention`, `getToolAvailability`, `getExecutionLabel`, and `getContextBarItems` are pure selectors for cockpit consumers.
- `OperationalAttentionItem` plus `deriveOperationalAttentionItems(state)` define the future Attention Queue source contract without building the queue UI.
- `OperationalActivitySummary` plus `deriveOperationalActivitySummary()` define the future Activity Center source contract; without an event source it returns a clean idle summary.
- `generatedAt`, `updatedAt`, and `sourceVersions` expose freshness and source-version metadata.
- The sidepanel provider owns load/refresh/subscriptions; consumers render derived state only. No polling is introduced.

Future consumers should read the operational state bus and selectors instead of fetching Runtime Doctor, Browser Control, tool registry, or project context directly inside UI components.


## Purpose

This roadmap defines the long-term UI/UX evolution of DeepSeek++ from a feature-rich browser extension into an operational AI cockpit.

The goal is not superficial polish. The goal is **situational awareness, fast control, low cognitive load, and reliable execution visibility**.

DeepSeek++ already has strong subsystems:

- Sidepanel chat
- Browser Control
- Memory
- Skills
- MCP/tools
- Automation
- Runtime Doctor
- Projects
- Saved items
- Usage stats
- Pet/control surface
- Review lanes / autonomous run infrastructure

The current UX problem is that these systems are still presented as separate areas. The product needs to become a unified cockpit where the user can immediately answer:

1. What is running?
2. What is ready?
3. What is blocked?
4. What changed?
5. What needs my attention?
6. What should I do next?
7. What evidence supports that state?

---

## Design Doctrine

### 1. Operational clarity over decoration

Every UI element should answer at least one of:

- State
- Action
- Cause
- Evidence
- Risk
- Next step

Reject decorative UI that does not improve decision speed.

### 2. One cockpit, many lenses

The sidepanel should not feel like unrelated tabs. Chat, Browser Control, Tools, Automation, Memory, Projects, and Doctor should feel like different lenses over one system state.

### 3. Progressive disclosure

Default UI should be calm and compact. Advanced controls should be available but not constantly visible.

Target layers:

1. Basic
2. Advanced
3. Expert
4. Debug

### 4. Every empty state should become an action surface

Empty states should never only say “No items.” They should offer a start action, import action, learn action, diagnose action, or example action.

### 5. Every failure should explain next action

A blocked feature should answer:

- What failed?
- Why likely?
- Who can fix it: user or extension?
- What is the safest next action?
- Is retry safe?

### 6. Evidence-first UX

DeepSeek++ should not merely claim something happened. It should expose evidence:

- Test passed
- Runtime check result
- Tool call result
- Browser target captured
- Memory injected
- Automation run completed
- Review lane graded

### 7. Keyboard-first, mouse-friendly

The interface should support rapid power use:

- Command palette
- Search everywhere
- Keyboard shortcuts
- Focus states
- Quick actions
- No dead-end modals

---

## Roadmap Structure

Main roadmap:

```text
docs/plan/uiux-cockpit-roadmap.md
```

Future companion docs may be created only when a section becomes large enough to justify separation:

```text
docs/plan/uiux-activity-center.md
docs/plan/uiux-attention-queue.md
docs/plan/uiux-command-palette.md
docs/plan/uiux-context-bar.md
docs/plan/uiux-automation-cockpit.md
docs/plan/uiux-runtime-doctor.md
docs/plan/uiux-memory-projects.md
docs/plan/uiux-multi-agent-visualization.md
```

Do not create nested folders until there are enough separate UI/UX docs to justify it.

---

## Phase 0 — Documentation and UX Contract

### Goal

Create the canonical UX planning surface so future work does not become random UI tweaks.

### Problem

DeepSeek++ has many features and prior planning docs, but UI/UX work needs a single governing roadmap that defines the product direction.

Without this, future changes risk becoming fragmented:

- Pretty but not useful
- Useful but inconsistent
- Locally good but globally confusing
- Implemented without acceptance criteria
- Unclear whether a UX change belongs to Chat, Automation, Runtime Doctor, or global cockpit

### Build

Create this roadmap at:

```text
docs/plan/uiux-cockpit-roadmap.md
```

Add references from related planning docs only if needed.

### Acceptance Criteria

- Roadmap exists.
- Roadmap explains vision, principles, phases, acceptance criteria, and rejected paths.
- Future UI/UX tasks can reference a phase and module.
- Each phase includes build/reject/test/decide consequences.
- No implementation claims are made without verification.

### Verification

- File exists.
- Markdown renders cleanly.
- No dead links.
- No references to unrelated projects such as sim.ai.
- The document explicitly scopes itself to DeepSeek++.

---

## Phase 1 — Chat Cockpit Clarity

### Goal

Make the sidepanel chat immediately understandable.

The user should know:

- Current provider
- Current model/config
- Whether Vision is available
- Whether API or Web route is active
- Whether current session continuity is being reused
- What useful first action to take

### Current State

Initial patch added:

- Chat mode/status strip
- Starter prompt chips
- Composer mode label
- Keyboard hint
- English and Chinese i18n
- Passing test/build verification

### Remaining Improvements

#### 1.1 Mode Strip Refinement

Current mode strip should evolve into a compact chat status surface.

Suggested fields:

```text
Mode: Web / API
Session: Last / Current / New
Vision: Ready / Text only
Memory: On / Off
Tools: 17 enabled
Project: Active project / None
```

### Why

The chat screen is the highest-frequency surface. If users cannot understand the active route and capabilities there, every other feature feels unreliable.

### Build

- Expand existing mode strip without making it tall.
- Use compact chips.
- Show only high-signal state.
- Hide secondary detail behind hover/title or an expandable details affordance.
- Make state labels consistent with Runtime Doctor and Settings.

### Reject

- Large dashboard inside Chat.
- Decorative status cards.
- Long helper paragraphs.
- More badges without hierarchy.

### Acceptance Criteria

- User can identify API vs Web route in under 1 second.
- User can identify whether Vision is available in under 1 second.
- User can identify whether session reuse is active.
- Status text does not wrap awkwardly at sidepanel width.
- No new i18n gaps.

### Verification

- Unit tests pass.
- Build passes.
- Manual sidepanel check at narrow width.
- Manual check with API mode, Web mode, Vision available, Vision unavailable, attachments present, and streaming active.

---

## Phase 2 — Global Context Bar

### Goal

Create a persistent global context layer that appears across the sidepanel.

This answers:

```text
Where am I?
What context is active?
What systems are currently enabled?
```

### Problem

Today, each page owns its own context. The user has to remember global state.

Example hidden state:

- Active project
- Active provider
- Chat enabled/disabled
- Browser target selected
- Memory enabled
- Tools enabled
- Automation readiness
- Runtime health
- Current session strategy

This causes cognitive load and trust decay.

### Build

Add a compact context bar below top navigation or inside page headers.

Suggested first version:

```text
Exec: Web
Project: DeepSeek++
Session: Current
Memory: On
Browser: Locked
Runtime: Ready
Tools: 17 enabled
```

Each item should be clickable if useful.

### Module Boundaries

Potential file areas:

- `entrypoints/sidepanel/App.tsx`
- `entrypoints/sidepanel/style.css`
- Existing stores:
  - chat store
  - project store
  - memory/prompt settings
  - browser control settings
  - runtime doctor state if safely accessible

### UX Rules

- Must be compact.
- Must not dominate the UI.
- Must degrade gracefully if data is unavailable.
- Must not trigger expensive polling.
- Must not show unstable values that flicker.

### Build Sequence

#### Phase 2A — Static context shell

- Add context bar component.
- Use currently available state only.
- Show provider/chat status first.

#### Phase 2B — Real state integration

- Add shared global operational context model.
- Add one sidepanel provider that loads and subscribes to operational context.
- Add project state from current conversation membership or pending next-project state.
- Add session strategy from existing personal convenience configuration via Runtime Doctor summary.
- Add memory state from prompt injection settings.
- Add Browser Control target summary from Runtime Doctor browser state.
- Add Runtime Doctor readiness summary.
- Add tool availability summary from the existing runtime tool descriptor registry.

Architecture decision:

- The context bar must not own state fetching.
- `core/operational-context.ts` owns the normalized source-of-truth shape.
- `entrypoints/sidepanel/global-operational-context.tsx` owns sidepanel loading/subscription.
- The context bar is the first consumer, not the owner.
- Future consumers should use the same context snapshot before adding new direct Runtime Doctor/store reads.

Extension points:

- Dashboard can compose the same `execution`, `project`, `memory`, `browser`, `runtime`, and `tools` fields.
- Attention Queue can derive blockers from `runtime`, `browser`, and `tools`.
- Activity Center can attach activity state beside the existing `source` metadata.
- Context Inspector can expand `context.activeProjectName`, memory scope, and session strategy.
- Command Palette can route against the same operational categories.
- Browser Control, Runtime Doctor, Automation, and Chat can gradually consume this shared snapshot.

#### Phase 2C — Click-through actions

- Clicking Project opens Projects.
- Clicking Runtime opens Runtime Doctor.
- Clicking Browser opens Browser Control.
- Clicking Memory opens Library/Memory or Prompt settings.
- Clicking Tools opens Tools page.

### Reject

- Full dashboard in the context bar.
- Live logs in the context bar.
- Polling-heavy implementation.
- Unclear icons without labels.

### Acceptance Criteria

- Context bar appears consistently across major pages.
- Context bar does not exceed one compact row at common sidepanel widths.
- State is accurate or explicitly unknown.
- Clicking a context item routes to the relevant page.
- Does not introduce render loops or CPU burn.

### Verification

- Tests pass.
- Build passes.
- Manual route checks.
- Manual browser target state checks.
- CPU sanity check after sidepanel idle.

---

## Phase 3 — Attention Queue

### Goal

Create one global place for items that need user attention.

This is the most important product-level improvement after context visibility.

### Problem

DeepSeek++ currently has many possible attention events:

- Runtime not ready
- Browser target lost
- MCP server disconnected
- Tool unavailable
- Automation failed
- Web auth missing
- Vision capture failed
- Memory import issue
- Sync conflict
- Review lane failed
- Extension reload required
- Permissions missing

These are scattered across pages. The user must hunt.

### Build

Add a global Attention Queue.

Suggested surface:

```text
Attention 3

1. Browser target lost
   Open Browser Control

2. Web auth missing
   Open Runtime Doctor

3. Automation failed
   Retry / Inspect
```

### Severity Model

Use simple severity:

```text
Blocked
Needs attention
Warning
Info
Done
```

Do not overbuild.

### Data Contract

```ts
type AttentionItem = {
  id: string;
  source: 'runtime' | 'browser' | 'automation' | 'mcp' | 'memory' | 'sync' | 'chat' | 'tools';
  severity: 'blocked' | 'attention' | 'warning' | 'info' | 'done';
  title: string;
  detail?: string;
  primaryAction?: {
    label: string;
    route?: string;
    command?: string;
  };
  secondaryAction?: {
    label: string;
    route?: string;
    command?: string;
  };
  createdAt: number;
  dedupeKey?: string;
};
```

### Build Sequence

#### Phase 3A — UI shell

- Add attention button/count to top nav or context bar.
- Add popover or page.
- Show mock/static attention items from local component state for layout only.

#### Phase 3B — Runtime Doctor integration

- Feed Runtime Doctor blockers into queue.
- Deduplicate repeated blockers.
- Link to repair actions.

#### Phase 3C — Browser Control integration

- Target missing
- Target stale
- Permission missing
- Screenshot capture failed

#### Phase 3D — Automation integration

- Failed run
- Blocked readiness
- Retryable failure
- Scheduled visual target invalid

#### Phase 3E — Persistence and dismissal

- Store dismissed item IDs.
- Allow snooze only if useful.
- Auto-clear resolved items.

### Reject

- Toast spam.
- Modal interruptions.
- Non-actionable warnings.
- Permanent red badges that never clear.
- Duplicate errors from multiple sources.

### Acceptance Criteria

- User can find all blockers from one place.
- Each item has a clear action.
- Resolved blockers disappear or downgrade.
- Duplicate blockers collapse.
- No item appears without source and action.

### Verification

- Tests for attention item normalization.
- Tests for deduplication.
- Tests for dismissal.
- Manual Runtime Doctor blocker scenario.
- Manual Browser Control missing target scenario.
- Manual Automation failure scenario.

---

## Phase 4 — Activity Center

### Goal

Make execution visible.

The user should know what DeepSeek++ is doing right now.

### Problem

The product performs many background or semi-background operations:

- Streaming chat
- Tool execution
- Browser capture
- MCP calls
- Automation runs
- Review lane work
- Runtime checks
- Memory injection
- Export generation
- Sync

Currently, activity is fragmented and often invisible.

### Build

Create an Activity Center with live and recent events.

Suggested UI:

```text
Activity

Running
- Automation: Repair & Verify Loop
- Browser: Capturing target
- Chat: Waiting for Web response

Recent
- Tool call completed
- Memory injected
- Runtime ready check passed
```

### Activity Event Contract

```ts
type ActivityEvent = {
  id: string;
  source: 'chat' | 'automation' | 'browser' | 'mcp' | 'tool' | 'runtime' | 'memory' | 'sync' | 'export';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'waiting';
  title: string;
  detail?: string;
  startedAt?: number;
  completedAt?: number;
  evidenceRef?: string;
  action?: {
    label: string;
    route?: string;
  };
};
```

### Build Sequence

#### Phase 4A — Local chat activity

Start with Chat because it is visible and high-frequency:

- Streaming
- Tool running
- Waiting for response
- Vision upload preparing
- Capture current tab
- Capture browser target

#### Phase 4B — Automation activity

Show:

- Queued
- Running
- Waiting
- Failed
- Succeeded
- Retry available

#### Phase 4C — Runtime and Browser activity

Show:

- Readiness check
- Auth recovery
- Target selection
- Screenshot capture
- Stale tab reload

#### Phase 4D — Evidence links

Each completed activity should optionally link to:

- Tool result
- Runtime Doctor report
- Automation run
- Browser target
- Chat message

### Reject

- Raw logs as the primary UI.
- Developer-only stack traces in user-facing Activity Center.
- Overly granular event spam.
- Fake progress bars.

### Acceptance Criteria

- User can tell whether anything is currently running.
- User can inspect recent activity.
- Failed activity links to attention or repair.
- Activity center remains readable with many events.
- Events auto-collapse or group by source.

### Verification

- Tests for event reducer/store.
- Tests for grouping.
- Manual streaming chat.
- Manual tool execution.
- Manual failed automation.
- Manual Browser Control capture.

---

## Phase 5 — Command Palette

### Goal

Allow fast control without hunting through tabs.

### Problem

DeepSeek++ has too many powerful actions spread across too many places.

The user should be able to hit one shortcut and run:

- Open Runtime Doctor
- Capture browser view
- Start new session
- Switch provider
- Open project
- Search memory
- Run automation
- Create saved item
- Import skill
- Toggle tool
- Export conversation
- Open settings
- Search docs

### Build

Add command palette.

Suggested shortcut:

```text
Cmd/Ctrl + K
```

### Command Contract

```ts
type CommandItem = {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  group: 'Navigation' | 'Chat' | 'Browser' | 'Automation' | 'Memory' | 'Tools' | 'Settings' | 'Diagnostics';
  disabled?: boolean;
  disabledReason?: string;
  run: () => void | Promise<void>;
};
```

### Build Sequence

#### Phase 5A — Navigation-only palette

- Open Chat
- Open Library
- Open Projects
- Open Capabilities
- Open Settings
- Open Runtime Doctor
- Open Browser Control
- Open Automation

#### Phase 5B — Safe actions

- New chat
- Capture current tab
- Capture browser target
- Run Runtime Doctor
- Refresh tools
- Search saved items

#### Phase 5C — Contextual commands

Commands change depending on active state:

- If Browser Control target selected: Capture target
- If automation failed: Retry failed automation
- If Web auth missing: Recover auth
- If memory disabled: Enable memory injection

#### Phase 5D — Command history/favorites

- Recent commands
- Pinned commands
- Frequent commands

### Reject

- Command palette that only duplicates tabs.
- Commands without disabled reasons.
- Commands that perform destructive actions without confirmation.
- Hardcoded command list that cannot grow.

### Acceptance Criteria

- Opens with keyboard shortcut.
- Search is fuzzy enough to be useful.
- Disabled commands explain why.
- Commands route or act reliably.
- Palette does not break sidepanel focus/input behavior.

### Verification

- Keyboard tests.
- Search ranking tests.
- Route action tests.
- Disabled reason tests.
- Manual focus trap / escape behavior check.

---

## Phase 6 — Universal Search

### Goal

Search across the user’s DeepSeek++ world.

### Problem

Current objects are separated:

- Memories
- Saved items
- Skills
- Projects
- Automations
- Tools
- Settings
- Conversations
- Runtime reports

User intent often starts as “find the thing,” not “go to the right page first.”

### Build

Create universal search integrated with command palette or a separate search mode.

Search targets:

```text
Memory
Saved item
Skill
Project
Automation
Tool
Setting
Conversation
Runtime event
```

### Result Contract

```ts
type UniversalSearchResult = {
  id: string;
  type: 'memory' | 'saved' | 'skill' | 'project' | 'automation' | 'tool' | 'setting' | 'conversation' | 'runtime';
  title: string;
  subtitle?: string;
  matchedText?: string;
  route?: string;
  actions?: Array<{
    label: string;
    commandId?: string;
  }>;
};
```

### Build Sequence

#### Phase 6A — Local indexed resources

Start with:

- Saved items
- Skills
- Projects
- Automations
- Settings pages

#### Phase 6B — Memory search

Add memory search once result display supports sensitive/private context safely.

#### Phase 6C — Conversation/search integration

Add conversation history only if data source is reliable.

#### Phase 6D — Actionable search

Results should support actions:

- Insert prompt
- Open project
- Enable skill
- Run automation
- Open setting

### Reject

- Search that exposes sensitive memory content too aggressively.
- Search results without actions.
- Slow global search.
- Search requiring exact terms only.

### Acceptance Criteria

- Search returns useful results in under 100 ms for local data.
- Results are grouped by type.
- User can keyboard-navigate results.
- Sensitive memory content is previewed conservatively.
- Every result has a clear action.

### Verification

- Result ranking tests.
- Keyboard navigation tests.
- Memory privacy checks.
- Large local dataset performance check.

---

## Phase 7 — Runtime Doctor as Repair Console

### Goal

Upgrade Runtime Doctor from diagnostics page into repair console.

### Problem

Runtime Doctor already checks many important things, but user experience should shift from:

```text
Here is diagnostic information.
```

to:

```text
Here is what is wrong, why, and the safest repair.
```

### Build

Improve Runtime Doctor around three layers.

#### Layer 1 — Summary

```text
Runtime: Ready / Needs Attention / Blocked
Primary blocker: Web auth missing
Next action: Recover Web auth
```

#### Layer 2 — Checks

Each check should show:

- Status
- Evidence
- Last checked time
- Repair action
- Why it matters

#### Layer 3 — Advanced details

Only for debugging:

- Raw metadata
- Storage keys
- Target IDs
- Session source
- Leak scan details

### Build Sequence

#### Phase 7A — Summary redesign

- Show top-level runtime grade.
- Show single next best action.
- Show last check time.

#### Phase 7B — Repair action standardization

Every repairable issue should expose a common action shape:

```ts
type RepairAction = {
  label: string;
  safe: boolean;
  requiresConfirmation: boolean;
  run: () => Promise<RepairResult>;
};
```

#### Phase 7C — Link to Attention Queue

Runtime blockers should appear globally.

#### Phase 7D — Link to Activity Center

Repair attempts should create activity events.

### Reject

- Dumping raw diagnostics first.
- Multiple equal-priority repair buttons.
- Scary error text without next action.
- Silent repair attempts.

### Acceptance Criteria

- Runtime Doctor always gives one recommended next action.
- User can distinguish user-actionable vs extension-actionable problems.
- Repair attempts visibly run and finish.
- Blockers appear in Attention Queue.
- Activity Center records repair attempts.

### Verification

- Runtime Doctor tests.
- Manual auth missing scenario.
- Manual stale tab scenario.
- Manual Browser target missing scenario.
- Manual repair success/failure.

---

## Phase 8 — Automation Cockpit

### Goal

Make automation feel controllable, not mysterious.

### Problem

Automation is powerful but inherently trust-sensitive.

The user needs:

- What will run?
- When?
- With what context?
- What tools?
- What risk?
- What happened last time?
- Why did it fail?
- Can I safely retry?

### Build

Create a more cockpit-like Automation page.

### Core Surfaces

#### 8.1 Automation Summary

```text
12 tasks
8 active
1 running
2 blocked
1 failed
```

#### 8.2 Readiness Column

Each task should show:

- Ready
- Needs attention
- Blocked
- Missing prompt
- Schedule invalid
- Visual target invalid
- Search/thinking conflict
- Unsafe prompt content

#### 8.3 Run Detail Drawer

For each run:

- Prompt
- Config
- Tool settings
- Visual monitor state
- Session strategy
- Events
- Result
- Failure
- Retry action
- Evidence

#### 8.4 Workflow Templates

Templates should be presented as serious workflows, not generic presets.

Each template should show:

- Goal
- Best use case
- Required inputs
- Risk level
- Default tools
- Stop condition

### Build Sequence

#### Phase 8A — Summary + readiness

- Improve automation list density.
- Add status counts.
- Surface readiness blockers.

#### Phase 8B — Run detail drawer

- Add inspectable run detail.
- Link activity events.
- Link attention blockers.

#### Phase 8C — Safer run controls

- Dry-run/preflight preview.
- Explain what will be sent.
- Show visual monitor implications.
- Show search/thinking/vision conflicts.

#### Phase 8D — Template UX upgrade

- Better template categories.
- Use-this-when copy.
- Better default prompts.
- Template preview before insertion.

### Reject

- Automation as a generic CRUD form.
- Hidden scheduled behavior.
- Running without visible preflight.
- Vague failed states.

### Acceptance Criteria

- User can see blocked automations without opening each one.
- User can inspect the last run.
- User can retry safely when appropriate.
- User can preview run configuration before execution.
- Scheduled visual dependencies are obvious.

### Verification

- Automation readiness tests.
- Run detail rendering tests.
- Preflight preview tests.
- Manual failed automation scenario.
- Manual scheduled visual monitor scenario.

---

## Phase 9 — Memory, Saved Items, and Projects Coherence

### Goal

Unify context management.

### Problem

Memory, Saved Items, Projects, Presets, and Skills are all forms of reusable context, but they currently feel separate.

The user needs to know:

- What context is active?
- Why was it used?
- Where did it come from?
- Can I edit/disable it?
- Is it stale?
- Is it project-specific or global?

### Build

Create a context management layer.

### UX Improvements

#### 9.1 Context Inspector

For current chat/session:

```text
Context used

Project instructions: 1
Memories: 8
Preset: Pro Architect
Skills: frontend-design
Tools: browser, memory, web
```

#### 9.2 Memory Explainability

Each injected memory should answer:

- Why included?
- Scope: global/project/session?
- Last updated
- Source
- Disable/edit action

#### 9.3 Project Context Overview

Each project should show:

- Instructions
- Conversations
- Project memories
- Saved items
- Active automations
- Relevant skills/tools

#### 9.4 Saved Item Upgrade

Saved items should become reusable building blocks:

- Prompt snippets
- Reference notes
- Workflow starters
- Reusable instructions
- Project assets

### Build Sequence

#### Phase 9A — Current Context Inspector

Add read-only view of active context.

#### Phase 9B — Memory trace

Show memory injection evidence after a response or in chat metadata.

#### Phase 9C — Project dashboard

Projects become real workspaces, not just grouping.

#### Phase 9D — Saved item typing

Allow saved items to be categorized by function.

### Reject

- Memory black box.
- Showing too much sensitive content by default.
- Project pages that only list conversations.
- Saved items as generic notes only.

### Acceptance Criteria

- User can inspect what context affected a chat.
- User can distinguish global vs project memory.
- User can disable/edit context from the inspector.
- Project page summarizes actual workspace state.
- Sensitive memory previews are controlled.

### Verification

- Memory injection tests.
- Project context tests.
- UI tests for inspector.
- Manual project switching.
- Manual memory disable/edit flow.

---

## Phase 10 — Browser Control UX Upgrade

### Goal

Make Browser Control feel safe, observable, and controllable.

### Problem

Browser Control is powerful but high-risk UX.

The user needs:

- What tab is controlled?
- What can the AI see?
- What can the AI do?
- Is screenshot capture enabled?
- Is verify-after-action enabled?
- What was the last action?
- What evidence exists?

### Build

Improve Browser Control around target, permissions, actions, and evidence.

### Core UX

#### 10.1 Target Card

```text
Target
ChatGPT tab
https://chat.openai.com
Locked: yes
Last snapshot: 12s ago
Vision: enabled
```

#### 10.2 Capability Matrix

```text
Read snapshot: On
Click/type: On
Screenshot: On
Verify after action: On
Evidence packs: On
```

#### 10.3 Last Actions

```text
Clicked button
Typed text
Captured screenshot
Verified result
```

#### 10.4 Safety Boundary

Always make clear:

- Selected target
- Whether actions are allowed
- Whether screenshots are stored
- Whether raw image bytes persist

### Build Sequence

#### Phase 10A — Target clarity

Improve selected tab card and lock state.

#### Phase 10B — Action/evidence timeline

Add recent browser actions.

#### Phase 10C — Attention integration

Missing target and stale target become global attention items.

#### Phase 10D — Safer action explanation

Explain browser action permissions in plain operational language.

### Reject

- Browser Control as a settings-only page.
- Hidden target state.
- Raw technical metadata first.
- Unclear screenshot storage boundaries.

### Acceptance Criteria

- User can identify controlled tab instantly.
- User can see whether screenshot/vision is enabled.
- User can see last action.
- Missing target creates attention item.
- Target lock state is obvious.

### Verification

- Browser Control tests.
- Manual target select/lock/clear.
- Manual screenshot capture.
- Manual stale target scenario.
- Manual permission denied scenario.

---

## Phase 11 — Multi-Agent / Review Lane Visualization

### Goal

Make autonomous and review workflows visually understandable.

### Problem

The repo has serious autonomous/review infrastructure, but the UI should show the lifecycle:

```text
Plan → Worker → Review → Grade → Iterate → Verify → Handoff
```

Users should not read logs to understand the system.

### Build

Create visual run lanes.

### Core Display

```text
Run: UIUX Cockpit Patch

Planner     Done
Worker      Done
Reviewer    Running
Verifier    Waiting
Handoff     Pending
```

Each lane should show:

- Status
- Evidence
- Last update
- Blocker
- Output artifact

### Build Sequence

#### Phase 11A — Static lane renderer

Render a run from existing telemetry.

#### Phase 11B — Live updates

Connect to active run state.

#### Phase 11C — Review grade display

Show:

- Grade
- Confidence
- Findings
- Required fixes
- Verification evidence

#### Phase 11D — Handoff artifact

End every long run with a structured handoff:

- Summary
- Changed files
- Tests run
- Risks
- Next recommended phase

### Reject

- Raw JSON as primary view.
- Fake agent avatars.
- Animation-heavy AI-working theater.
- Unverifiable progress.

### Acceptance Criteria

- User can understand run state visually.
- Each lane links to evidence.
- Failed lane explains why.
- Review grades are visible.
- Final handoff is structured.

### Verification

- Run telemetry tests.
- Lane rendering tests.
- Manual autonomous run replay.
- Manual failed review lane scenario.

---

## Phase 12 — Evidence Ledger

### Goal

Create a durable evidence trail for important actions.

### Problem

Trust requires proof.

DeepSeek++ should make it easy to answer:

- What changed?
- Who/what did it?
- What check verified it?
- What remains unverified?
- What should not be trusted yet?

### Build

Evidence ledger for:

- UI changes
- Runtime checks
- Automation runs
- Browser actions
- Memory mutations
- Tool execution
- Exports
- Sync operations

### Evidence Record

```ts
type EvidenceRecord = {
  id: string;
  source: string;
  action: string;
  result: 'passed' | 'failed' | 'partial' | 'unknown';
  summary: string;
  command?: string;
  artifactRef?: string;
  createdAt: number;
  relatedRoute?: string;
};
```

### UX

Evidence should appear:

- In Activity Center
- In run detail
- In Runtime Doctor
- In Automation runs
- In final handoffs

### Reject

- Claiming verification without evidence.
- Evidence hidden in logs only.
- Storing sensitive raw data.
- Making evidence too verbose for normal use.

### Acceptance Criteria

- Major actions can attach evidence.
- Evidence can be inspected.
- Sensitive data policy is respected.
- Failed evidence is visible.
- Handoffs cite evidence.

### Verification

- Evidence record tests.
- Sensitive data tests.
- Activity integration tests.
- Manual build/test evidence record.

---

## Phase 13 — Cockpit Dashboard

### Goal

Make the default landing surface a cockpit, not just Chat.

### Problem

Chat is high-frequency, but not always the best default. Once the system matures, opening DeepSeek++ should show operational state first.

### Build

Dashboard with sections:

```text
Mission
Current active work

Attention
Blockers and next actions

Activity
Running/recent events

Context
Project/provider/memory/tools/browser

Quick Actions
Chat, capture, doctor, automation, search

Recent
Projects, saved prompts, automations
```

### Build Sequence

#### Phase 13A — Dashboard as optional tab

Add dashboard without replacing Chat.

#### Phase 13B — Dashboard default preference

Allow user to choose default landing:

- Chat
- Dashboard
- Last opened

#### Phase 13C — Mission mode

Allow user to pin a current mission/project/objective.

#### Phase 13D — Unified cockpit

Dashboard becomes the primary command surface.

### Reject

- Dashboard as decorative analytics.
- Too many charts.
- Replacing Chat before dashboard is useful.
- Dashboard without actions.

### Acceptance Criteria

- Dashboard gives system state in under 3 seconds.
- Every card has an action.
- Dashboard does not duplicate entire pages.
- Dashboard summarizes, then routes.
- User can choose default landing.

### Verification

- Navigation tests.
- Dashboard render tests.
- Manual empty state.
- Manual active automation.
- Manual runtime blocked state.

---

## Phase 14 — Interaction Polish and Accessibility Pass

### Goal

Make the product feel professional under real use.

### Focus Areas

#### Keyboard

- Tab order
- Escape behavior
- Enter behavior
- Command palette
- Focus restoration
- Shortcut hints

#### Accessibility

- ARIA labels
- Visible focus states
- Contrast
- Reduced motion
- Screen reader sanity
- Button names
- Form labels

#### Motion

Use motion only for:

- State transition
- Spatial continuity
- Progress feedback

Reject decorative motion.

#### Density

Support:

- Comfortable
- Compact

Maybe later:

- Expert dense mode

#### Empty States

All empty states should include:

- What this area is
- Why it matters
- First action
- Example if useful

#### Error States

All errors should include:

- Human explanation
- Retry if safe
- Open diagnostics if relevant
- Copy details if technical

### Build Sequence

#### Phase 14A — Audit

Create a UI/UX audit checklist.

#### Phase 14B — High-frequency path polish

- Chat
- Runtime Doctor
- Browser Control
- Automation

#### Phase 14C — Secondary page polish

- Skills
- Memory
- Projects
- Saved
- Settings

#### Phase 14D — Regression tests

Add tests for key interactions.

### Acceptance Criteria

- Keyboard-only user can operate core flows.
- Major buttons have accessible names.
- Reduced motion respected.
- Empty states are actionable.
- Errors are recoverable.

### Verification

- Accessibility test pass where possible.
- Manual keyboard navigation.
- Manual reduced motion.
- Manual narrow width.
- Manual dark/light theme.

---

## Phase 15 — Release Readiness and UX Regression Gates

### Goal

Prevent future UI/UX regression.

### Problem

Once UI/UX improves, future agent patches may degrade it unless quality gates exist.

### Build

Add UX regression gates.

### Gates

#### Static Gates

- i18n coverage
- Type/build
- Component tests
- No dead routes
- No missing aria labels on critical controls

#### Manual Gates

For each release:

- Chat flow
- Browser capture flow
- Runtime repair flow
- Automation run flow
- Project context flow
- Settings save flow

#### Visual Gates

If practical later:

- Screenshot baseline for sidepanel states
- Dark/light theme snapshots
- Narrow/wide sidepanel snapshots

### Acceptance Criteria

- Every UIUX patch declares affected flows.
- Every patch includes verification.
- Release notes mention UX changes.
- Known UX debt is documented.

### Verification

- `npm test`
- `npm run build`
- i18n check if allowed
- Manual smoke checklist

---

## Cross-Phase Architecture Modules

These modules can be developed independently but should converge.

### Module A — UI State Registry

Central source for UI-level state:

- Provider
- Runtime readiness
- Browser target
- Active project
- Memory state
- Tool count
- Running activity
- Attention items

Purpose: prevent every page from reinventing global state.

### Module B — Attention Store

Stores normalized attention items.

Must support:

- Add
- Update
- Dedupe
- Resolve
- Dismiss
- Route action

### Module C — Activity Store

Stores live/recent activity.

Must support:

- Start event
- Update event
- Complete event
- Fail event
- Group by source
- Link evidence

### Module D — Command Registry

Central command registry.

Must support:

- Static commands
- Dynamic commands
- Disabled reasons
- Search keywords
- Execution
- Navigation

### Module E — Evidence Ledger

Metadata-only record of proof.

Must support:

- Command/test evidence
- Runtime evidence
- Browser action evidence
- Automation evidence
- No sensitive raw storage

### Module F — Context Inspector

Shows current context used by chat/workflows:

- Project
- Memories
- Preset
- Skills
- Tools
- Provider
- Route

---

## Recommended Build Order

### Immediate Next Patch

Build **Phase 2A: Global Context Bar Shell**.

Reason:

- Highest product coherence gain.
- Low risk.
- Reuses existing state.
- Makes every page feel connected.
- Sets up Attention Queue and Activity Center.

### Then

1. Phase 3A — Attention Queue UI shell
2. Phase 4A — Chat Activity Center events
3. Phase 5A — Navigation command palette
4. Phase 7A — Runtime Doctor summary redesign
5. Phase 8A — Automation readiness dashboard
6. Phase 9A — Current Context Inspector

---

## Rejected Directions

### Reject: More visual effects

The product does not need more gradients, glass, blur, or animation as a primary strategy.

### Reject: More tabs

Adding more top-level tabs will worsen fragmentation.

Prefer:

- Command palette
- Dashboard
- Contextual drawers
- Search
- Attention queue

### Reject: Raw logs as UX

Logs are useful for debugging but bad as primary UX.

Translate logs into:

- Status
- Cause
- Evidence
- Action

### Reject: AI theater

Do not add animated agents, fake progress, or cute AI-working visuals unless they map to real state.

### Reject: Single giant rewrite

This should be evolved through verified slices.

Each slice must improve real use immediately.

---

## Open Questions

### 1. Default landing

Should DeepSeek++ open to Chat or Dashboard?

Default for now: Chat. Future: user preference.

### 2. Attention Queue placement

Options:

- Top nav badge
- Context bar item
- Dedicated tab
- Popover

Default recommendation: context bar badge + popover.

### 3. Activity Center placement

Options:

- Right drawer
- Bottom drawer
- Dedicated page
- Popover

Default recommendation: drawer/popover first, page later.

### 4. Context Inspector placement

Options:

- Chat header
- Message metadata
- Dedicated drawer
- Project page

Default recommendation: drawer launched from Chat context chip.

### 5. Dashboard timing

Do not build dashboard first. Build context, attention, activity, and command palette first. Dashboard should compose them.

---

## Definition of Done for UIUX Roadmap Items

A UIUX item is not done unless:

1. It is implemented.
2. It is localized.
3. It works at sidepanel width.
4. It works in dark/light theme.
5. It has keyboard behavior.
6. It has accessible labels where applicable.
7. It has test/build verification.
8. It has a clear failure state.
9. It does not create new dead ends.
10. It updates docs if it changes product direction.

---

## Current Status

### Implemented

- Phase 1 initial chat clarity patch:
  - Chat mode strip
  - Starter prompts
  - Composer mode label
  - Keyboard hint
  - i18n updates
  - Tests passed
  - Build passed

- Phase 2A global context bar shell:
  - Persistent provider / memory / browser / runtime context strip
  - Runtime Doctor report integration without polling
  - Click-through navigation to relevant top-level surfaces
  - English and Chinese i18n
  - Tests/build verification passed before commit

- Phase 2B operational context integration:
  - Shared `GlobalOperationalContext` model added in core.
  - Single sidepanel provider added for operational context loading and subscriptions.
  - Context bar now consumes shared execution, project, session, memory, browser, runtime, and tools state.
  - Browser, Runtime, and Tools chips route to exact Capabilities subtabs.
  - Project chip uses real current-conversation project first, then pending next-project state, then none/unknown.
  - Memory chip uses real prompt injection settings.
  - Tools chip uses existing runtime tool descriptors.
  - Runtime Doctor remains the cockpit summary source for runtime and Browser Control readiness.
  - No polling added.

### Next Recommended Work

Phase 3A:

```text
Attention Queue UI Shell
```

Use the shared operational context to derive the first attention items for Runtime Doctor blockers, Browser Control target issues, and unavailable tools.
