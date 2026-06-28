# UI/UX QA Hardening Loop — Self-Contained Prompt

> Copy everything below this line into a fresh MiMoCode session.

---

## SETUP

```
cd /Users/kyin/Projects/deepseek-pp && git checkout loop-it-all
```

## IDENTITY

You are an autonomous UI/UX QA engineer. You execute loops A through N. You use `grok` CLI as workers (up to 10 parallel). You self-govern: evaluate, grade, iterate. You do not stop until all loops complete. You do not ask for approval.

## SELF-GOVERNANCE PROTOCOL

After completing each loop:
1. Run the tests you wrote. Did they pass?
2. Grade yourself A-F on: coverage, correctness, edge cases, readability
3. If grade < B, fix and re-run until B or higher
4. Save evidence to `ops/qa/run-20260622-uiux/loops/<loop-id>/evidence.txt`
5. Only then proceed to next loop

## WORKER STRATEGY

Use `grok` CLI for parallel work:
```bash
grok -p "Write a Vitest test file. Follow patterns from existing tests. Output ONLY TypeScript code."
```
Each worker = ONE file. Workers don't coordinate. You collect, evaluate, merge.

## COMMANDS

- Run all tests: `npm test`
- Run specific: `npm test -- --grep <pattern>`
- Typecheck: `npm run compile`

---

## FINDINGS SUMMARY (25 findings from 10 deep passes)

### PASS 1: Loading/Error/Empty States (14 pages)
- ChatPage: No skeleton loading, error retry exists, empty state exists
- BrowserControlPage: No skeleton, banner errors only, empty targets state
- AutomationPage: SkeletonList loading, banner errors, empty + filtered empty
- McpPage: Loading label, extensive banner errors, empty with actions
- MemoryPage: Skeleton loading, ZERO error handling (all failures silent)
- SkillPage: Skeleton loading, partial error handling, no top-level empty
- PresetPage: Skeleton loading, ZERO error handling (all failures silent)
- SavedPage: Skeleton loading, banner for save only, empty state
- ProjectsPage: Skeleton loading, banner errors, empty state

### PASS 2: Accessibility (26 components)
- ChatMessage: No aria-live for streaming, no role on messages, no SR announcements
- GitHubSkillImportPanel: URL input lacks label, no aria-live for status
- LocalSkillImportPanel: Path input lacks label, no aria-live
- ToggleSwitch: Has role="switch" + aria-checked (good)
- Settings primitives: Has role="switch", role="tablist", role="radiogroup" (good)
- WhatsNewPanel: Has aria-modal, aria-labelledby (good)
- Missing: Focus management in modals, aria-live for dynamic content

### PASS 3: ChatPage Interactions (12 interactions)
- All buttons give feedback (good)
- Send button: disabled when empty, dots during streaming
- Retry: restores text but NOT images (known limitation)
- Voice input: toggle with active state
- Image capture: from current tab or browser-control target
- Drag-and-drop: supported for images
- Paste: supported for images

### PASS 4: CSS/Visual (40+ issues)
- NO :focus-visible rules on ANY custom control (major a11y gap)
- NO :active states on most buttons
- Missing transitions on buttons, tags, badges
- Hardcoded pixels everywhere (320px min-width, 420px, 520px)
- Only 3 responsive breakpoints (420px, 520px, container 360px)
- Modal overlay: hardcoded rgba, no dark mode token
- Inconsistent spacing (ds-space-* vs literals)
- z-index: only 2 declarations, no scale
- overflow:hidden on panels clips focus rings
- Scroll chaining not prevented on main containers

### PASS 5: Settings (10 sub-pages)
- ApiSubPage: Clear API key WITHOUT confirmation
- AppearanceSubPage: Clear background WITHOUT confirmation
- DataSubPage: Import without confirmation (overwrite risk)
- GeneralSubPage: Good rollback on failure
- All settings: Local only, no sync conflicts
- No quota checks on any storage operations

### PASS 6: Edge Cases/Automation (8 scenarios)
- Automation runs while user edits: last-write-wins, no edit lock
- Two automations simultaneously: allowed, no global concurrency cap
- Tab switching during automation: no effect on execution
- Storage quota exceeded: no defensive handling, can corrupt state
- Sidepanel closed mid-operation: zero impact (background execution)
- Service worker restart: run killed, reconciled on next wake
- Auth expires mid-automation: error classified, retryable flag
- Target tab closed: CDP detached, next capture re-attaches

### PASS 7: Navigation/IA (30 issues)
- ZERO back navigation anywhere
- No breadcrumbs or location indicator
- Tab state resets on every visit (no persistence)
- 3-4 levels deep with no way to see path or go up
- Projects: no close-detail button
- Library: insert-to-chat is one-way teleport
- Sub-tab state lost on top-tab switch
- Inline forms as pages (showForm boolean) - no modal/route

### PASS 8: Data Persistence (20 issues)
- ALL create/edit forms lose draft on navigation (no auto-save, no dirty check, no confirm)
- SavedPage has NO edit flow (read-only items)
- No undo for ANY destructive action
- Delete confirm exists on Memory, Saved, Skill, Preset (good)
- No bulk delete anywhere
- Chrome.storage cleared: memories in IndexedDB survive, others wiped
- Sync conflicts: WebDAV download overwrites wholesale, no merge UI

### PASS 9: i18n (60+ hardcoded strings)
- ChatMessage: "Running", "Failed", "Done" hardcoded
- ApiSubPage: "DeepSeek API Key", "API Keys" hardcoded
- McpPage: "Headers", "Secrets", "Bearer", "Basic", "Header" hardcoded
- AutomationPage: "Expert", "Vision", "Cron", "RRULE" hardcoded
- 40+ more hardcoded English strings across components
- Locale formatting: toLocaleTimeString() without locale argument
- No RTL support (assumes LTR)
- Text expansion: Chinese translations get clipped by truncate classes

### PASS 10: User Flows (7 flows traced)
- Chat: Rich entry points, live streaming, good recovery, delight via voice/image/capture
- Automation: Template library, readiness analyzer, visual monitor, chaining
- Browser Control: Live tab list, one-click lock, deep integration
- Memory: Beautiful type system, auto-injection, project scoping
- Skills: Native / popup, github sync, group bulk enable
- MCP: Multiple transports, health monitoring, execution history
- Settings: Comprehensive but some destructive actions lack confirmation

---

## LOOP PLAN

### Loop A: Accessibility — Focus Visible (P0)
**Finding**: ZERO :focus-visible rules on ANY custom control
**Source**: `entrypoints/sidepanel/style.css`
**Change**: Add `:focus-visible` rules for ALL interactive elements
**Files**: `entrypoints/sidepanel/style.css`
**Scope**:
1. Add `*:focus-visible` global rule with `outline: 2px solid var(--ds-blue); outline-offset: 2px;`
2. Override for elements that already have focus styles (inputs, textareas)
3. Test with keyboard navigation (Tab key)

**Done when**: All interactive elements show visible focus ring. Grade >= B.

---

### Loop B: Accessibility — ARIA Labels (P0)
**Finding**: Chat input, send button, mic button lack aria-labels
**Source**: `entrypoints/sidepanel/pages/ChatPage.tsx`
**Change**: Add aria-labels to all interactive elements
**Files**: `entrypoints/sidepanel/pages/ChatPage.tsx`
**Scope**:
1. Chat textarea: `aria-label={t('sidepanel.chatPage.inputLabel')}`
2. Send button: `aria-label={t('sidepanel.chatPage.send')}`
3. Mic button: `aria-label={t('sidepanel.chatPage.voiceInput')}`
4. New session button: verify aria-label present
5. Model/thinking segments: verify aria-label present

**Done when**: All buttons have aria-labels. Grade >= B.

---

### Loop C: Accessibility — Live Regions (P0)
**Finding**: No aria-live for streaming content, tool events, status changes
**Source**: `entrypoints/sidepanel/components/ChatMessage.tsx`
**Change**: Add aria-live regions for dynamic content
**Files**: `entrypoints/sidepanel/components/ChatMessage.tsx`
**Scope**:
1. Add `aria-live="polite"` to assistant message container
2. Add `role="status"` to streaming indicator
3. Add `aria-live="assertive"` to error messages
4. Announce tool event status changes

**Done when**: Screen readers announce streaming content and status changes. Grade >= B.

---

### Loop D: Error Handling — MemoryPage & PresetPage (P1)
**Finding**: MemoryPage and PresetPage have ZERO error handling
**Source**: `entrypoints/sidepanel/pages/MemoryPage.tsx`, `entrypoints/sidepanel/pages/PresetPage.tsx`
**Change**: Add try/catch + banner errors to all operations
**Files**: `entrypoints/sidepanel/pages/MemoryPage.tsx`, `entrypoints/sidepanel/pages/PresetPage.tsx`
**Scope**:
1. Wrap load() in try/catch
2. Wrap delete operations in try/catch
3. Wrap save/update operations in try/catch
4. Show banner errors on failure
5. Add retry mechanism where appropriate

**Done when**: All operations show errors on failure. Grade >= B.

---

### Loop E: Navigation — Back Button (P1)
**Finding**: ZERO back navigation anywhere
**Source**: `entrypoints/sidepanel/App.tsx`
**Change**: Add browser history integration or in-UI back button
**Files**: `entrypoints/sidepanel/App.tsx`, `entrypoints/sidepanel/pages/*.tsx`
**Scope**:
1. Add `history.pushState` on tab switch
2. Listen for `popstate` to handle browser back
3. Add in-UI back button for sub-pages (when depth > 1)
4. Show current location indicator

**Done when**: Browser back button works. Grade >= B.

---

### Loop F: Navigation — State Persistence (P1)
**Finding**: Tab state resets on every visit
**Source**: `entrypoints/sidepanel/App.tsx`
**Change**: Persist last active tab to chrome.storage
**Files**: `entrypoints/sidepanel/App.tsx`
**Scope**:
1. Save active tab to `chrome.storage.local` on switch
2. Restore on mount
3. Persist sub-tab state for Library, Capabilities, Settings
4. Persist selected project in ProjectsPage

**Done when**: Last active tab is restored on reopen. Grade >= B.

---

### Loop G: Data Persistence — Unsaved Changes (P1)
**Finding**: ALL forms lose draft on navigation without confirmation
**Source**: `entrypoints/sidepanel/pages/MemoryPage.tsx`, `SkillPage.tsx`, `PresetPage.tsx`, `McpPage.tsx`
**Change**: Add dirty state tracking + confirmation before navigation
**Files**: Multiple page files
**Scope**:
1. Add `isDirty` state to each form
2. Track field changes
3. Show confirmation dialog when navigating away with dirty state
4. Offer "Save" / "Discard" / "Cancel" options

**Done when**: Users are warned before losing unsaved changes. Grade >= B.

---

### Loop H: i18n — Hardcoded Strings (P1)
**Finding**: 60+ hardcoded English strings across components
**Source**: Multiple files (see findings)
**Change**: Replace all hardcoded strings with t() calls
**Files**: `ChatMessage.tsx`, `ApiSubPage.tsx`, `McpPage.tsx`, `AutomationPage.tsx`, etc.
**Scope**:
1. ChatMessage: "Running", "Failed", "Done" → t() keys
2. ApiSubPage: "DeepSeek API Key", "API Keys" → t() keys
3. McpPage: "Headers", "Secrets", transport labels → t() keys
4. AutomationPage: "Expert", "Vision", "Cron", "RRULE" → t() keys
5. Add missing keys to `core/i18n/resources/en.ts` and `zh-CN.ts`

**Done when**: Zero hardcoded user-visible strings. Grade >= B.

---

### Loop I: CSS — Transitions & Active States (P2)
**Finding**: Missing transitions and active states on buttons
**Source**: `entrypoints/sidepanel/style.css`
**Change**: Add transition and :active rules
**Files**: `entrypoints/sidepanel/style.css`
**Scope**:
1. Add `transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease` to all buttons
2. Add `:active` rules with `transform: translateY(0.5px)` or similar
3. Add transitions to tags, badges, cards
4. Use design tokens for transition durations

**Done when**: All interactive elements have smooth transitions. Grade >= B.

---

### Loop J: CSS — Responsive Improvements (P2)
**Finding**: Only 3 responsive breakpoints, hardcoded pixels everywhere
**Source**: `entrypoints/sidepanel/style.css`
**Change**: Add fluid sizing and more breakpoints
**Files**: `entrypoints/sidepanel/style.css`
**Scope**:
1. Replace hardcoded `min-width: 320px` with `clamp()`
2. Add breakpoint at 360px for very narrow panels
3. Make usage dashboard responsive
4. Make empty states responsive
5. Add `overscroll-behavior: contain` to scroll containers

**Done when**: UI works well at 320px-600px width. Grade >= B.

---

### Loop K: Settings — Confirmation Dialogs (P2)
**Finding**: Clear API Key and Clear Background lack confirmation
**Source**: `entrypoints/sidepanel/components/settings/ApiSubPage.tsx`, `AppearanceSubPage.tsx`
**Change**: Add useConfirm() before destructive actions
**Files**: `ApiSubPage.tsx`, `AppearanceSubPage.tsx`
**Scope**:
1. ApiSubPage: Add confirm before Clear API Key
2. AppearanceSubPage: Add confirm before Clear Background
3. Verify all destructive actions have confirmation

**Done when**: All destructive actions require confirmation. Grade >= B.

---

### Loop L: Focus Management — Modal Trap (P2)
**Finding**: Modal dialogs don't trap focus
**Source**: `entrypoints/sidepanel/components/settings/primitives.tsx`
**Change**: Implement focus trap in useConfirm modal
**Files**: `primitives.tsx`
**Scope**:
1. Trap focus inside modal when open
2. Return focus to trigger element on close
3. Handle Escape key to close
4. Prevent background scroll when modal open

**Done when**: Focus is trapped in modals. Grade >= B.

---

### Loop M: Performance — Chat Virtualization (P3)
**Finding**: Large chat histories render all messages in DOM
**Source**: `entrypoints/sidepanel/pages/ChatPage.tsx`
**Change**: Add virtual scrolling for messages
**Files**: `ChatPage.tsx`
**Scope**:
1. Add virtual list for messages (react-window or similar)
2. Keep auto-scroll behavior
3. Maintain streaming support
4. Test with 100+ messages

**Done when**: Chat handles 1000+ messages without lag. Grade >= B.

---

### Loop N: UX Polish — Empty State CTAs (P3)
**Finding**: Some empty states lack clear call-to-action
**Source**: Multiple pages
**Change**: Add primary action buttons to all empty states
**Files**: `MemoryPage.tsx`, `PresetPage.tsx`, `SavedPage.tsx`, etc.
**Scope**:
1. MemoryPage empty: Add "Add Memory" button
2. PresetPage empty: Add "Create Preset" button
3. SkillPage: Add empty state when zero custom skills
4. ProjectsPage: Add "Create Project" button in empty state

**Done when**: All empty states have clear CTAs. Grade >= B.

---

## COMPLETION

After all loops:
1. `npm test` — full suite passes
2. `npm run compile` — typecheck passes
3. Update `ops/qa/run-20260622-uiux/run_report.md` with final status
4. Write `ops/qa/run-20260622-uiux/FINAL-REPORT.md` with grades, evidence, totals

**Done when**: All loops grade >= B, tests pass, FINAL-REPORT.md exists.

## ANTI-PATTERNS

- Do NOT ask "should I proceed?"
- Do NOT claim tests pass without running them
- Do NOT skip loops
- Do NOT stop at 80%
- Do NOT refactor unless explicitly asked

## START

```
cd /Users/kyin/Projects/deepseek-pp && git checkout loop-it-all
```

Begin Loop A. Work A→N sequentially. Use grok workers for parallel work. Self-evaluate after each loop. Iterate until grade >= B. Continue until no more work.
