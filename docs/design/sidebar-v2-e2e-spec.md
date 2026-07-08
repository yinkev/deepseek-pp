# DeepSeek++ Sidebar v2 End-to-End Spec

Status: production implementation
Scope: `/Users/kyin/Projects/deepseek-pp`
Primary mockup: `docs/design/sidebar-v2-mockup.html`
Capability map: `docs/design/sidebar-v2-capability-map.md`
Goal thread: `019f15d2-5cdf-71a0-9505-bfc2a32cecd3`

## 0. Current Decision

The previous cockpit implementation direction is rejected for product UX.

Sidebar v2 must move toward a clean, organized, consumer-grade Chrome side panel inspired by the strongest structural patterns in Gemini, Claude, and ChatGPT sidebars:

- composer-first home
- recent chats and resumable work
- skills and slash commands as first-class actions
- simple model selector
- voice and attachment controls in the composer
- personalized suggestions only from real local context
- projects as clean list/detail flows, not exposed admin forms
- settings as an organized option surface
- system access preserved for existing capabilities

This spec supersedes the stale `Now / Attachments / Runs / System` spike for the next implementation loop. The older runtime/cockpit docs can remain as long-term architecture input, but they are not the UI direction to implement until the base sidebar UX is accepted and good.

## 1. Production Gate

Production UI implementation is active.

The static mockup is reference only:

```text
docs/design/sidebar-v2-mockup.html
```

Do not ship placeholder production UI. Do not copy mockup-only sample data into React. Production surfaces must use existing typed stores, runtime messages, projections, or honest empty states.

The mockup shows the intended shape:

1. Home
2. Recents/menu
3. Projects
4. Settings/System

## 2. Product North Star

DeepSeek++ is not a random extension dashboard and not a mascot-first toy.

The first screen should answer:

1. What can I do now?
2. What context is attached?
3. What did I recently work on?
4. What skills or projects can I apply?
5. Where are deeper system controls?

The surface should feel:

- light
- clean
- uniform
- calm
- powerful
- organized
- high-density but not cramped
- strongly anti-slop

It must not feel like:

- five unrelated admin tabs
- random pills and cards
- a fake analytics dashboard
- a rough settings dump
- a toy chatbot clone
- a half-built cognitive cockpit

## 3. Non-Negotiables

- Do not remove existing capabilities.
- Do not make the product dark theme.
- Do not build disconnected mock UI.
- Do not invent fake personalization.
- Do not present unevidenced agent claims as verified.
- Do not add browser consent spam. Browser permission is consent.
- Do not hide old pages. Library, Projects, Capabilities, Settings, Browser Control, MCP, Tools, Runtime Doctor, Presets, Automation, Memory, and Saved surfaces must remain reachable.
- Do not add dependencies unless clearly justified and approved by existing repo patterns.
- Do not block on additional approval for cosmetic uncertainty. Implement, visually inspect, grade, and iterate.

## 4. Target Information Architecture

### 4.1 Primary Surface

Home is the default.

Home contains:

- compact brand/status header
- current context row
- personalized suggestion chips
- recent work list
- skills entry list
- persistent composer

### 4.2 Global Menu

The top-right menu replaces the crowded horizontal tab strip as the main navigation escape hatch.

It contains:

- recent chats
- projects
- skills
- personal intelligence
- settings and system
- open full options page when available

### 4.3 Composer

One composer pattern is used across main surfaces.

Required controls:

- `+` attachment menu
- `/` skills menu
- voice input
- model dropdown
- send

The model selector should be a dropdown or compact menu, not a large segmented control occupying a whole panel.

### 4.4 Projects

Projects are list-first.

Default Projects view:

- project rows/cards with name and short context
- selected project summary
- primary action: use for next chat
- secondary action: open details/manage

Project creation/editing:

- behind `New` or `Manage`
- not exposed as the first visible block
- no giant form dump on sidebar open

### 4.5 Settings and System

Settings should feel like an option page, not a feature graveyard.

Top-level settings groups:

- Personal intelligence
- Permissions
- Voice
- Appearance
- Library
- Projects
- Capabilities
- Advanced system

Advanced system keeps:

- Skills
- MCP
- Tools
- Browser control internals
- Runtime doctor
- Presets
- Automation
- raw settings pages

## 5. Data and Source-of-Truth Rules

No UI section may be backed by unowned hard-coded product claims.

Production placeholder policy:

- Static mockup may contain illustrative text.
- Production UI may show empty states.
- Production UI may show starter suggestions from a typed local catalog.
- Production UI may show real suggestions derived from current tab metadata, project state, saved prompts, skills, memory, or recent chat state.
- Production UI may not imply a real user history, preference, score, or verified claim unless it comes from a store or runtime event.

Implementation must inspect existing stores before adding new ones.

Likely existing source areas:

- chat/session state
- project context state
- memory state
- saved prompts/library
- skills/capabilities
- voice settings
- personal convenience config
- browser control target state

Add a typed Sidebar v2 projection layer only if it reduces coupling and prevents disconnected UI.

## 6. Visual System

### 6.1 Theme

Light-first only for this phase.

Tokens:

- background: cool off-white
- surfaces: white and very light blue-gray
- text: near-black
- secondary text: graphite gray
- accent: restrained DeepSeek blue
- lines: thin blue-gray borders
- shadows: minimal and only for menus/modals

### 6.2 Shape

Use one shape system:

- panels: 8px radius
- controls: 8px radius
- suggestion chips: pill radius only
- composer: 12px radius as the main input object

Avoid random mixed radii.

### 6.3 Density

The side panel is narrow. Use:

- rows for lists
- menus for secondary navigation
- compact section headers
- detail panels only after selection

Avoid:

- stacked cards inside cards
- giant hero blocks
- raw forms above primary content
- large segmented control panels
- long horizontal tab strips that clip

### 6.4 Copy

Copy must be functional.

Avoid:

- vague AI marketing phrases
- fake precision
- decorative labels
- claims of verification without evidence

## 7. Implementation Phases

### Phase A: Production Source Mapping

Goal:

Map existing runtime sources to Sidebar v2 and prevent fake data.

Tasks:

1. Maintain `docs/design/sidebar-v2-capability-map.md`.
2. Inspect sidepanel pages, stores, and background message contracts before edits.
3. Identify real sources for Home, Recents, Skills, Projects, Personal Intelligence, Settings, and System.

Verification:

- map covers all current pages and contracts
- no planned production surface depends on mock data

Stop condition:

- stop only for unsafe, destructive, secret, account, public-publish, or impossible-runtime blockers

### Phase B: Repo Mapping

Goal:

Map existing capabilities to Sidebar v2 without deleting anything.

Tasks:

1. Inspect sidepanel pages and navigation.
2. Inspect stores and message contracts.
3. Use `docs/design/sidebar-v2-capability-map.md` as the source-backed mapping table from existing pages to new access points.
4. Identify any missing typed projection needed for recents, skills, project summaries, or personal intelligence.

Verification:

- mapping covers every existing page and capability
- no orphaned old feature surface

### Phase C: Shell and Navigation

Goal:

Replace the visible horizontal tab-first shell with the approved shell.

Tasks:

1. Build compact header.
2. Build global menu.
3. Preserve System/Advanced access.
4. Preserve pending-text and chat enabled behavior.
5. Preserve old pages behind settings/system navigation.

Verification:

- navigation tests updated
- every old page reachable
- keyboard/focus paths work

### Phase D: Home and Composer

Goal:

Build the main Home surface and unified composer.

Tasks:

1. Refactor ChatPage layout around composer-first UX.
2. Add current context row from existing browser/control state.
3. Add suggestion chips from typed source.
4. Add recents and skills previews.
5. Move model selection into compact dropdown/menu.
6. Keep voice and image/browser capture actions.

Verification:

- chat still sends
- voice still works where supported
- image/browser captures still attach
- model config persists
- no fake personalization

### Phase E: Recents and Skills

Goal:

Make continuation and skills easy to access.

Tasks:

1. Add recents menu from real available sources.
2. Add skill entry points.
3. Keep skill management reachable.
4. Keep saved prompts/library reachable.

Verification:

- recents empty state is honest when no data exists
- skill actions route to existing capability
- saved prompt insertion still works

### Phase F: Projects

Goal:

Make Projects readable and calm.

Tasks:

1. Convert Projects to list-first.
2. Move create/edit forms behind New/Manage.
3. Show selected project summary first.
4. Preserve project creation, update, delete, pending next conversation, add current conversation, memories, and project conversations.

Verification:

- all existing project mutations still work
- disabled states are clear
- no first-screen form dump

### Phase G: Settings, Personal Intelligence, System

Goal:

Organize advanced features without hiding them.

Tasks:

1. Build settings group list.
2. Add Personal Intelligence entry point backed by memory/project/suggestion sources available today.
3. Keep old Library, Projects, Capabilities, Settings reachable.
4. Keep Browser Control, MCP, Tools, Runtime Doctor, Presets, Automation reachable through advanced system.

Verification:

- no old capability unreachable
- labels are clear
- permissions state shown without consent spam

### Phase H: Visual Dogfood and Iteration

Goal:

Reach Kevin's visual standard, not just passing tests.

Tasks:

1. Build extension.
2. Reload the installed Chrome extension.
3. Inspect Home, menu, Projects, Settings/System, composer, and key old pages.
4. Capture screenshots.
5. Grade with rubric.
6. Iterate until every critical category scores at least 9/10.

Verification:

- `npm run compile`
- `npm test`
- `npm run build`
- Chrome extension reload
- screenshot review

## 8. Capability Preservation Matrix

Before completion, each item must have a reachable path in Sidebar v2:

| Existing capability | Required v2 access |
| --- | --- |
| Chat submit | Home composer |
| Official API model config | Composer model dropdown |
| Reasoning/thinking config | Model dropdown details or settings |
| DeepSeek web session strategy | Composer/session menu |
| Voice input/read aloud | Composer and Voice settings |
| Image attach | Composer plus menu |
| Current tab capture | Composer plus menu |
| Browser target capture | Composer plus menu or context row |
| Pending text insertion | Home composer |
| Library/saved prompts | Global menu and System |
| Projects | Global menu, Settings/System, composer project context |
| Project memories | Project details |
| Skills | Slash menu, skills preview, Capabilities/System |
| GitHub/local skill import | Skills manage/System |
| Capabilities | Settings/System |
| MCP | Advanced system |
| Tools | Advanced system |
| Browser control internals | Advanced system and context row |
| Runtime doctor | Advanced system |
| Presets | Advanced system or Settings |
| Automation | Advanced system |
| Memory | Personal intelligence and System |
| Appearance/settings | Settings |

## 9. Review Rubric

Every critical category must score at least 9/10 before completion.

Critical categories:

1. Visual cohesion: one shape system, one color system, no random pills/cards.
2. IA clarity: a user can find chat, recents, skills, projects, settings, and system paths quickly.
3. Composer quality: model, voice, attachments, slash skills, send are compact and consistent.
4. Projects quality: list-first, readable, no form dump, all mutations preserved.
5. Capability preservation: every old capability has a reachable path and still works.
6. Source-of-truth integrity: no disconnected mock UI, no fake user claims.
7. Evidence honesty: verified vs unverified claims are not blurred.
8. Accessibility: focus, contrast, labels, keyboard basics.
9. Narrow-panel fit: no clipped nav, no text overflow, no incoherent overlap.
10. Runtime verification: compile, tests, build, extension reload, screenshot review.
11. Anti-slop: no generic AI dashboard tropes, no gratuitous decoration, no fake precision.
12. User-standard fit: screenshots look closer to Gemini/Claude/ChatGPT organization than the current sidebar.

If any category is below 9:

- fix it and rerun relevant verification, or
- explicitly document why it cannot be improved without a user decision.

## 10. Final Completion Evidence

The goal is complete only when current evidence proves:

- Production sidepanel implements approved Sidebar v2.
- Existing capabilities remain reachable.
- No disconnected mock production UI exists.
- `npm run compile` passes.
- `npm test` passes.
- `npm run build` passes.
- Installed Chrome extension was reloaded.
- Visual screenshots were inspected after reload.
- Rubric scores are all at least 9/10 or justified by explicit user decision.

Do not mark the goal complete before every item is proven.
