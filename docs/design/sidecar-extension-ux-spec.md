# DeepSeek++ Sidecar Extension UX Spec

Status: exploratory implementation spike
Theme: light-first
Surface: Chrome/WXT side panel extension

## Decision

DeepSeek++ should become a tab-attached cognitive sidecar, not a module dashboard.

The primary object is the current browser tab. Chat, memory, tools, automation, and MCP are operations around that object.

## Product shape

Replace the visible information architecture:

```text
Chat / Library / Projects / Capabilities / Settings
```

with:

```text
Now / Attachments / Runs / System
```

### Now

The default surface. It answers:

- What tab am I attached to?
- What can DeepSeek++ do with this tab right now?
- What is the current conversation or command?
- What context is fresh versus stale?

### Attachments

Trust and context boundary surface. It shows:

- attached tab
- target lock
- page snapshot budget
- visual evidence setting
- selected tab candidates
- what is visible to the model
- what is blocked from the model

### Runs

Agent execution surface. It shows:

- active automation
- run status
- evidence / review lanes
- stop / resume / retry controls

### System

Everything administrative:

- Library
- Projects
- Skills
- MCP
- Tools
- Browser control internals
- Runtime doctor
- Presets
- Automation configuration
- Settings

## Light theme direction

The UI should feel like a precise instrument panel, not a SaaS dashboard.

Rules:

- light-first, warm paper background
- near-black text, muted graphite secondary text
- one restrained blue accent for action/focus only
- thin borders over shadows
- compact but sectioned density
- no purple AI gradients
- no glassmorphism
- no fake analytics cards
- no oversized greeting hero
- no bubbly chatbot shell

## Interaction model

The attach-tab model should be seamless, with visible state instead of repeated consent prompts:

```text
Ambient active tab -> Smart bound -> Locked -> Acting -> Stale -> Detached
```

Browser permission is consent. The product should not keep asking. It should show what is bound, what is visible, and how to lock or detach.

Visible controls:

- Smart-bind the active readable tab by default
- Lock target when the user wants a stable tab
- Detach when the user wants no browser context
- Refresh evidence without re-choosing a tab
- Attach selected text as a narrower context lane
- Attach viewport evidence as an explicit visual lane
- Promote tab groups into working sets later

## Architecture implication

The repo already has side panel, tab, activeTab, debugger, content script, and browser-control primitives. The missing product layer is a first-class `AttachedTabContext` abstraction and a UI shell that centers it.

Target model:

```ts
type AttachmentMode =
  | 'none'
  | 'page'
  | 'selection'
  | 'viewport'
  | 'dom_snapshot'
  | 'tab_group';

interface AttachedTabContext {
  tabId: number;
  windowId: number;
  url: string;
  origin: string;
  title: string;
  favIconUrl?: string;
  mode: AttachmentMode;
  locked: boolean;
  permissionState: 'none' | 'activeTab' | 'host' | 'debugger';
  snapshotFreshness: 'fresh' | 'stale' | 'missing';
  visibleToModel: string[];
  blockedFromModel: string[];
  updatedAt: number;
}
```

## Implementation spike

This spike intentionally changes the sidepanel shell before replacing internals. Existing pages remain reachable through System while the primary navigation is reorganized around user intent.

Acceptance criteria:

- sidepanel opens to Now
- top rail uses Now / Attachments / Runs / System
- light theme reads as intentional and premium
- tab attachment is visible before settings
- old feature sprawl is demoted, not deleted
- TypeScript compile passes
- extension build passes
