# /goal — DeepSeek++ Cognitive Runtime E2E Implementation Spec

Status: canonical long-horizon goal spec
Owner: DeepSeek++ product/architecture governor
Scope: `/Users/kyin/Projects/deepseek-pp`
Theme: light-first sidecar, mission cockpit, working set, evidence timeline, cognitive runtime

## 0. Prime Directive

DeepSeek++ must stop behaving like a feature-heavy extension sidebar and become a cognitive runtime for long-horizon work.

The product must let Kevin hand the system a serious objective, leave an agent working, interrupt/review/redirect when needed, and return later with high trust in what happened, why it happened, what evidence supports it, and what should happen next.

Do not optimize for novelty theater. Optimize for durable leverage, low cognitive load, inspectable autonomy, and excellent taste.

## 1. Non-Negotiable Operating Contract

Before doing substantial work, read:

1. `/Projects/AGENTS.md`
2. `/Projects/.agentsmd/**`
3. repo `AGENTS.md`
4. this document
5. current git status
6. relevant files before changing them

Rules:

- Do not assume project state when verification is possible.
- Do not take shortcuts.
- Codex is the sole orchestrator.
- Use Grok as worker/reviewer when delegation is useful.
- Use Oracle as advisor only.
- Do not use Claude CLI or Claude as a worker.
- Do not build duplicate systems.
- Do not hide complexity behind vague UI copy.
- Do not replace existing working capability with mock-only UI.
- Preserve old capability access while migrating IA.
- Prefer additive migrations before destructive rewrites.
- Every phase must pass compile/test/build unless explicitly blocked.
- Every major UI claim must be visually dogfooded or marked unverified.
- Every long-running agent surface must expose evidence, not just status.

## 2. Product North Star

DeepSeek++ is a cognitive sidecar for browser-mediated work.

The browser tab is one context source. The project repo is another. Files, notes, tools, memory, tests, screenshots, decisions, and agents are all resources inside a working context.

The long-term product should feel like:

```text
Mission Cockpit
+ Working Set
+ Evidence Timeline
+ Review Lane
+ Cognitive Runtime
```

Not:

```text
Chatbot sidebar
+ settings pages
+ tool catalog
+ random automation panel
```

## 3. Core Product Concepts

### 3.1 Mission

A Mission is a long-horizon objective with constraints, state, evidence, review, and stop criteria.

Example:

```text
Mission: Redesign DeepSeek++ UI/UX until it feels world-class.
Constraints: light theme, elegant, not cramped, no AI slop, preserve existing capability access.
Done: compile/test/build pass, visual dogfood complete, risks documented.
```

Mission fields:

```ts
interface Mission {
  id: string;
  title: string;
  objective: string;
  constraints: string[];
  forbiddenMoves: string[];
  doneCriteria: string[];
  status: 'draft' | 'running' | 'paused' | 'blocked' | 'reviewing' | 'complete' | 'failed';
  confidence: number;
  progress: number;
  currentHypothesis: string;
  nextAction: string;
  activeWorkerId: string | null;
  activeReviewerId: string | null;
  createdAt: number;
  updatedAt: number;
}
```

### 3.2 Working Set

A Working Set is the live context bundle for a mission.

It may contain:

- active tab
- locked tab
- tab group
- browser window
- repository/workspace
- files
- screenshots
- selected text
- memory scopes
- tools
- MCP servers
- command outputs
- relevant docs

Working set fields:

```ts
type WorkingSetResourceKind =
  | 'browser_tab'
  | 'tab_group'
  | 'browser_window'
  | 'repo'
  | 'file'
  | 'memory_scope'
  | 'tool'
  | 'mcp_server'
  | 'screenshot'
  | 'selection'
  | 'command_output'
  | 'decision';

interface WorkingSetResource {
  id: string;
  kind: WorkingSetResourceKind;
  label: string;
  uri?: string;
  origin?: string;
  freshness: 'live' | 'fresh' | 'stale' | 'missing';
  visibility: 'visible_to_model' | 'metadata_only' | 'blocked' | 'requires_action';
  evidenceIds: string[];
  updatedAt: number;
}
```

### 3.3 Evidence

Evidence is the trust primitive. The UI must distinguish observed fact, generated claim, inference, and speculation.

Evidence fields:

```ts
type EvidenceKind =
  | 'file_diff'
  | 'test_result'
  | 'build_result'
  | 'command_output'
  | 'browser_snapshot'
  | 'screenshot'
  | 'web_source'
  | 'user_instruction'
  | 'repo_file'
  | 'review_note';

interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  title: string;
  summary: string;
  sourceRef: string;
  confidence: number;
  createdAt: number;
}
```

### 3.4 Review Lane

Review Lane separates implementation from evaluation.

It must show:

- what the worker changed
- what the reviewer criticized
- what was fixed
- what remains risky
- final grade

Review fields:

```ts
interface ReviewLane {
  id: string;
  missionId: string;
  reviewer: 'self' | 'oracle' | 'design_governor' | 'test_runner' | 'red_team';
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number;
  findings: ReviewFinding[];
  requiredFixes: string[];
  waivedRisks: string[];
  createdAt: number;
}

interface ReviewFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  evidenceIds: string[];
  status: 'open' | 'fixed' | 'accepted_risk' | 'rejected';
}
```

### 3.5 Cognitive Runtime

The Cognitive Runtime is the phase-3 abstraction: a continuously updated, evidence-backed model of what the user is trying to do, what context matters, what agents are doing, what claims are known, what assumptions are unresolved, and what should happen next.

Do not implement the full runtime until Phase 1 and Phase 2 are coherent.

## 4. UI/UX Direction

### 4.1 Visual Language

Light-first instrument panel.

Traits:

- warm paper background
- near-black ink
- restrained blue accent
- thin borders over shadows
- compact but sectioned density
- editorial hierarchy
- tabular metadata
- no decorative AI neon
- no glassmorphism
- no oversized generic hero cards
- no fake analytics filler
- no purple gradient SaaS trope

### 4.2 Primary IA

Current shell should converge toward:

```text
Now
Working Set
Timeline
Review
System
```

Existing Phase 1 shell may currently use:

```text
Now
Attachments
Runs
System
```

Migration rule:

- `Attachments` should become `Working Set`.
- `Runs` should become `Timeline` or `Mission` depending on implementation clarity.
- `System` keeps old feature pages: Library, Projects, Capabilities, Settings.

### 4.3 Default Surface

Default must be mission/context-first, not settings-first.

Opening the sidepanel should answer:

1. What mission am I in?
2. What context is live?
3. What is the system doing?
4. What changed recently?
5. What should happen next?

### 4.4 Competitive Sidebar Baseline

Claude, ChatGPT, Gemini, Grok, and Qwen set the baseline for ordinary chat/sidebar UX. DeepSeek++ should not expose internal routing, session plumbing, or maintenance controls as primary UI unless the feature is clearly novel and valuable.

Take direct product inspiration from these tools for standard UX patterns. Do not reinvent basics that they already solved well.

Reference patterns to emulate:

- clean primary composer with one obvious input
- compact model/destination selector
- tools/skills behind a plus, slash, or menu affordance
- recent chats/projects as a simple list
- settings and personal intelligence behind predictable menus
- clear new-chat/new-task action
- calm spacing, consistent radii, consistent button styles
- menus over permanent control clutter
- progressive disclosure for advanced controls

Baseline chat expectations:

- simple composer first
- obvious new chat action
- model/tool/skill choice only when useful
- recents/history/project access without clutter
- settings behind a menu or System surface
- no permanent controls named after implementation concepts

Session routing is not a novel feature. Controls such as `Last / Current / New` leak implementation details and should not live as permanent Home UI. Prefer a sane default plus a compact destination/status line. Put advanced routing in a small menu or Settings.

Novelty belongs in the cognitive runtime:

- Mission
- Working Set
- Evidence Timeline
- Review Lane
- state, risks, evidence, and next action after long-running work

### 4.5 Projects Surface Standard

Projects must be clean and simple like the major AI sidebars. A project page should help Kevin find, open, and understand projects quickly. It should not look like a raw admin form.

Projects UX requirements:

- list-first layout with project name, concise metadata, and current selection
- search/filter if project count grows
- selected project detail reads like a clean summary, not a settings dump
- create/edit/delete are progressive-disclosure actions
- project instructions and project memories are secondary detail, not first-screen clutter
- current conversation assignment is an action row, not a large form block
- no nested cards inside cards
- no always-visible delete danger button competing with normal scanning
- preserve all existing project mutations and project memory capability
- use honest empty states only; no fake projects, fake recents, or fake personalization

### 4.6 Intelligence Surface Standard

Intelligence must not be a wall of text, settings, counters, and storage internals. It should explain the personal context DeepSeek++ can actually use, and make that context easy to inspect or correct.

The page purpose is:

```text
What does DeepSeek++ know about Kevin, what context is active, and what will affect the next answer?
```

Intelligence UX requirements:

- start with a concise personal context summary, not a metric grid
- do not lead with large inventory counts such as global memories, project memories, saved items, or projects
- treat counts as diagnostics only; they belong in Details/System, not as the page's main value proposition
- separate `Profile`, `Preferences`, `Active context`, and `Memory` into clean sections
- show only the highest-signal records by default
- hide injection/session/storage settings behind `Details`, `Manage`, or System links
- use short labels and scannable rows, not explanatory paragraphs on every block
- distinguish remembered preference, project context, saved item, and prompt/preset influence
- make correction actions obvious: edit memory, manage projects, manage prompt settings
- avoid raw implementation terms such as injection, cadence, same-session strategy, and prompt plumbing on the first screen
- preserve all existing memory, saved item, preset, project, and settings links
- use honest empty states only; no fake profile claims or fake personalization

### 4.7 Skills, Plugins, and Commands Standard

Skills should not be giant cards by default. The primary user need is to find or invoke a capability quickly, not inspect a catalog.

Separate the concepts:

- Skill: reusable instruction/workflow that can be invoked or suggested.
- Plugin: installed package/source that may provide Skills, tools, MCP servers, apps, or commands.
- Slash command: composer affordance for invoking a Skill or action quickly.
- `@` mention: composer affordance for attaching a project, file, tab, memory, source, or tool context.

Skills UX requirements:

- lead with a compact searchable command/skill picker, not large metric tiles
- show enabled/recommended Skills as concise rows with trigger, name, short purpose, and source
- use plugin/source grouping only in a manager view, not as the main launcher
- do not make every Skill a large card unless the user is editing details
- distinguish `Built-in`, `Custom`, `Plugin`, `GitHub`, and `Local` sources without implying every source is a Skill
- support slash-command mental model: `/skill` or `/command` should be discoverable from the composer
- support `@` mental model for context attachment separately from Skills
- plugin installation/update/sync belongs under System or a dedicated `Plugins` manager, with Skills showing what the plugin contributes
- keep create/import/edit/delete/enable-all controls behind `Manage` or source detail disclosure
- preserve existing Skill import, local Skill, GitHub Skill, enable/disable, edit, delete, and source update capabilities
- use honest empty states only; no fake plugin ecosystem, fake commands, or fake suggestions

## 5. Phase 1 — Mission Cockpit Foundation

Goal: make the extension usable for long-horizon work without inventing the full cognitive runtime yet.

### 5.1 Deliverables

Implement:

1. Mission Cockpit UI surface
2. Working Set UI surface
3. Evidence Timeline UI surface
4. Review Lane UI surface
5. System fallback surface preserving existing pages
6. local persisted stores for mission/evidence/review where appropriate
7. tests for navigation and store invariants
8. clean baseline chat UX that hides internal session routing from Home
9. clean list-first Projects UX that preserves all existing capability
10. docs updates

### 5.2 Mission Cockpit UI

Must show:

```text
Mission title
Status
Elapsed / last updated
Progress
Confidence
Current hypothesis
Current worker
Current reviewer
Next action
Pause / Resume / Redirect / Stop
```

Initial implementation may use local placeholder mission data if no live orchestrator exists, but it must be wired through a real typed store, not hardcoded directly into components.

### 5.3 Working Set UI

Must show:

```text
Current active tab
Locked tab state
Attached resources
Freshness
Visibility to model
Metadata-only vs content-visible distinction
```

Smart active-tab binding should remain:

- If browser control is enabled
- and no target is locked
- and no target exists
- bind to the active controllable tab automatically

Do not spam consent prompts. Browser permission is consent. The UI should show state and controls, not repeated confirmation.

### 5.4 Evidence Timeline UI

Timeline events:

```text
Instruction received
Repo read
Hypothesis formed
File changed
Test failed
Fix applied
Test passed
Build passed
Review completed
```

Each item should have:

- time
- action
- actor
- status
- evidence link/reference
- expandable detail

### 5.5 Review Lane UI

Must show:

```text
Worker score
Reviewer score
Open findings
Fixed findings
Accepted risks
Final grade
```

Initial review can be self-review/manual/generated summary. Later versions can integrate orchestrated reviewers.

### 5.6 Persistence

Use existing storage conventions when possible.

Avoid introducing a second database unless necessary.

Likely stores:

```text
core/mission/store.ts
core/mission/types.ts
core/evidence/store.ts
core/evidence/types.ts
core/review/store.ts
core/review/types.ts
```

Or combine under:

```text
core/cockpit/
```

Choose the structure that best matches repo conventions after inspection.

### 5.7 Tests

Add or update tests for:

- navigation exposes the new cockpit surfaces
- old pages remain reachable through System
- mission store normalizes corrupt data
- evidence timeline sorts by time
- review lane preserves severity ordering
- smart active-tab binding does not override locked targets
- build remains green

Required gates:

```bash
npm run compile
npm test
npm run build
```

## 6. Phase 2 — World-Class Innovative Layer

Goal: make DeepSeek++ feel meaningfully ahead of normal AI extensions.

### 6.1 Cognitive Heatmap

Show where project effort is concentrated.

Example:

```text
UI           ██████████
Architecture ███████░░░
Tests        █████░░░░░
Docs         ███░░░░░░░
Risk         ██░░░░░░░░
```

Use real evidence counts where possible:

- changed files
- test failures
- review findings
- timeline events
- touched modules

Do not fake precision.

### 6.2 Reasoning Graph

Represent mission reasoning as clickable nodes:

```text
Goal
├── Hypothesis
├── Evidence
├── Implementation
├── Review
└── Next move
```

Nodes must link to evidence/timeline items.

### 6.3 Hypothesis Engine

Expose current belief and counterevidence:

```text
Hypothesis: Navigation causes perceived clutter.
Confidence: 73%
Evidence: 6 items
Counterevidence: 2 items
```

The agent should be allowed to change its mind visibly.

### 6.4 Trust Layer

Every major claim/action gets confidence and evidence class:

```text
Observed: 99%
Verified: 95%
Inferred: 70%
Speculative: 35%
```

UI must not make inferred claims look like verified facts.

### 6.5 Interruptible Autonomy

Controls:

- pause after current step
- stop now
- redirect mission
- spawn reviewer
- deepen research
- rollback last patch
- continue until green build
- continue until review grade >= target

### 6.6 Project Pulse

A one-glance signal:

```text
Momentum
Confidence
Architecture stability
Risk
Knowledge gained
Entropy
```

Ground it in available metrics. If a metric is not grounded, label it as estimated.

## 7. Phase 3 — Cognitive Runtime

Goal: make DeepSeek++ anticipate and compress cognition across sessions.

### 7.1 State Graph

Everything becomes a node:

- missions
- tabs
- files
- repos
- agents
- tests
- screenshots
- decisions
- assumptions
- memories
- people
- goals

Edges describe relationships:

- supports
- contradicts
- depends_on
- supersedes
- generated
- verified_by
- blocked_by
- belongs_to

### 7.2 Intent Engine

Infer current mode:

- research
- debugging
- implementation
- architecture review
- design review
- writing
- planning
- studying

The UI should adapt based on intent without requiring manual mode switching.

### 7.3 Forgetting Engine

Surface unresolved cognition:

- repeated tabs never cited
- assumptions never verified
- TODOs never converted into work
- decisions lacking evidence
- stale context still influencing plans

### 7.4 Contradiction Engine

Detect contradictions between:

- current plan and prior decision
- claimed status and git/test evidence
- user preference and generated design
- accepted architecture and new implementation

### 7.5 Cognitive Debt

Track:

- unverified assumptions
- unresolved review findings
- missing tests
- abandoned branches
- stale docs
- conflicting decisions
- unclear ownership

### 7.6 Cognitive Compression

At mission end, compress everything into durable knowledge:

```text
New decisions
Rejected hypotheses
Accepted risks
Changed architecture
Tests added
Knowledge gained
Next agent handoff
```

Future agents should load compressed state instead of replaying raw chat history.

## 8. Implementation Architecture

### 8.1 Suggested Directory Structure

Do not blindly create this if repo conventions suggest better names. Inspect first.

```text
core/cockpit/
  mission-types.ts
  mission-store.ts
  evidence-types.ts
  evidence-store.ts
  review-types.ts
  review-store.ts
  working-set.ts
  normalize.ts

entrypoints/sidepanel/pages/
  MissionPage.tsx
  WorkingSetPage.tsx
  TimelinePage.tsx
  ReviewPage.tsx

entrypoints/sidepanel/components/cockpit/
  MissionCard.tsx
  WorkingSetCard.tsx
  EvidenceTimeline.tsx
  ReviewLane.tsx
  ConfidenceBadge.tsx
  FreshnessBadge.tsx
```

### 8.2 State Rules

- Stores must tolerate corrupt storage.
- Stores must have deterministic normalization.
- No UI should crash on missing Chrome APIs.
- No persisted state should depend on localized display labels.
- Use stable IDs.
- Keep human-readable summaries alongside machine fields.

### 8.3 Evidence Rules

Every timeline item should either:

- link to evidence, or
- be marked as unevidenced/manual.

Never present unevidenced events as verified.

### 8.4 Browser Context Rules

- Smart-bind active controllable tab by default.
- Locked tab overrides smart binding.
- Detach removes target state for the current session.
- Metadata-only context is different from content-visible context.
- Visual evidence is explicit and visible.
- Tab group attachment is a working-set feature, not a browser-control setting page.

## 9. Anti-Slop UI Rules

Reject:

- purple-blue AI gradients
- fake charts without data
- giant greeting cards
- generic chatbot copy
- cramped cards with equal visual weight
- nested settings inside settings inside settings
- icons as decoration without meaning
- opaque agent progress
- “thinking...” as a long-run status
- success messages without evidence

Prefer:

- fewer surfaces
- clearer object model
- strong hierarchy
- quiet light theme
- single accent
- explicit freshness
- visible evidence
- compact metadata
- commandable controls
- progressive disclosure

## 10. Acceptance Criteria

Phase 1 is acceptable when:

- sidepanel IA supports Mission / Working Set / Timeline / Review / System or an equivalent clear mapping
- smart active-tab binding exists and does not override locked targets
- long-horizon mission state is visible
- evidence timeline exists with at least real local event support
- review lane exists
- old pages remain reachable
- compile/test/build pass
- docs explain the architecture
- self-review identifies remaining weaknesses

Phase 2 is acceptable when:

- heatmap/trust/hypothesis/pulse features are grounded in real evidence
- claims are classified as observed/verified/inferred/speculative
- user can interrupt autonomy at meaningful boundaries
- UI feels less like a dashboard and more like an operating cockpit

Phase 3 is acceptable when:

- cognitive compression produces durable mission summaries
- state graph exists with typed nodes/edges
- contradiction/forgetting/cognitive debt engines surface real issues
- future agents can resume from compressed state with less context replay

## 11. Review Rubric

Before final response, grade the work:

```text
Architecture coherence: /10
UX clarity: /10
Visual taste: /10
Evidence integrity: /10
Test coverage: /10
Regression risk: /10
Long-horizon usefulness: /10
```

Anything below 8 requires either iteration or explicit explanation.

## 12. Default Next Move

If no further instruction is given, implement Phase 1 in this order:

1. Inspect current sidepanel shell and stores.
2. Create typed cockpit domain model.
3. Add normalized local stores.
4. Add Mission surface.
5. Rename/reshape Attachments into Working Set.
6. Add Evidence Timeline surface.
7. Add Review Lane surface.
8. Keep System fallback to old pages.
9. Add tests.
10. Run compile/test/build.
11. Self-review and iterate.
12. Report changed files, verification, risks, next move.

## 13. Final Principle

The user should be able to give DeepSeek++ a hard objective, walk away, come back, and understand the entire state of work in under 30 seconds.

If the UI cannot answer what happened, why it happened, what evidence supports it, what remains risky, and what should happen next, it is not done.
