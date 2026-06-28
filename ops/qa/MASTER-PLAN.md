# MASTER QA HARDENING PLAN — Complete Execution Blueprint

> **Long-Horizon Goal**: Execute ALL loops until every task is completed, evaluated, reviewed, graded, and iterated. No loop exits with grade < B. No task is abandoned without explicit justification. Work continues until zero remaining tasks.

---

## EXECUTION PROTOCOL

### Self-Governance (Every Loop)

```
1. IMPLEMENT → Write the code/test/change
2. VERIFY → Run tests, typecheck, lint
3. SELF-EVALUATE → Grade A-F on: correctness, coverage, edge cases, readability
4. IF GRADE < B → Fix. Re-verify. Re-grade. Repeat until B+.
5. EVIDENCE → Save to ops/qa/<run-id>/loops/<loop-id>/evidence.txt
6. MOVE ON → Only after grade >= B
```

### Parallelization Rules

- **Wave 1** (no dependencies): Loops A, B, C, D, E can run simultaneously
- **Wave 2** (depends on Wave 1): Loops F, G, H, I, J
- **Wave 3** (depends on Wave 2): Loops K, L, M, N
- **Within each wave**: Use `grok` CLI workers (up to 10 parallel)
- **Worker contract**: Each grok worker gets ONE atomic task, ONE file, NO coordination

### grok Worker Pattern

```bash
# Spawn worker for a single file
grok -p "Read <source-file>. <specific-task>. Output ONLY the code changes needed. File: <target-file>"

# Spawn worker for a test file
grok -p "Write a Vitest test file for <scope>. Follow patterns in <reference-test>. Output ONLY TypeScript. File: tests/<name>.test.ts"

# Spawn worker for CSS changes
grok -p "Read <css-file>. Add <specific-rule>. Output ONLY the CSS to add. File: <target-css>"
```

---

## BACKEND QA LOOPS (run-20260622-111535)

### Loop A: Browser Control Tests (P0) ✅ GRADE: A
**Status**: Complete (from prior session)
**Files created**: 6 test files
**Grade**: A — All tests pass, comprehensive coverage
**Parallelizable**: No (already done)

### Loop B: Fix Long-Running Automations (P1) ✅ GRADE: B
**Status**: Complete (from prior session)
**Files modified**: 3 (types.ts, scheduler.ts, runner.ts)
**Grade**: B — Timeout increased, configurable per-automation, continuation limit raised
**Parallelizable**: No (already done)

### Loop C: Fetch Interception Tests (P0) 🔄 GRADE: TBD
**Status**: Not started
**Files to create**: 2
- `tests/fetch-hook-lifecycle.test.ts`
- `tests/bridge-connection.test.ts`
**grok parallelizable**: YES — 2 workers, one per file
**Source**: `core/interceptor/fetch-hook.ts` (1427 lines)
**Pattern**: Study `tests/request-augmentation.test.ts`
**Done when**: Both test files pass. Grade >= B.

### Loop D: Automation Runner E2E (P1) 🔄 GRADE: TBD
**Status**: Not started
**Depends on**: Loop B (already done)
**Files to create**: 1
- `tests/automation-runner-e2e.test.ts`
**grok parallelizable**: NO — single file, complex dependencies
**Source**: `core/automation/runner.ts`, `core/automation/scheduler.ts`
**Pattern**: Study `tests/automation-runner-pow.test.ts`
**Done when**: E2E test passes. Grade >= B.

### Loop E: MCP Connection Tests (P1) 🔄 GRADE: TBD
**Status**: Not started
**Files to create**: 1
- `tests/mcp-connection-lifecycle.test.ts`
**grok parallelizable**: NO — single file
**Source**: `core/mcp/discovery.ts`, `core/mcp/client.ts`
**Pattern**: Study `tests/mcp-transport-common.test.ts`
**Done when**: MCP lifecycle test passes. Grade >= B.

### Loop F: Memory Injection Tests (P1) 🔄 GRADE: TBD
**Status**: Not started
**Files to create**: 1
- `tests/memory-injection.test.ts`
**grok parallelizable**: NO — single file
**Source**: `core/memory/injector.ts`, `core/memory/selector.ts`
**Pattern**: Study `tests/memory-tool.test.ts`
**Done when**: Memory injection test passes. Grade >= B.

### Loop G: Skill & Web Search Tests (P2) 🔄 GRADE: TBD
**Status**: Not started
**Files to create**: 2
- `tests/skill-template-injection.test.ts`
- `tests/web-search-execution.test.ts`
**grok parallelizable**: YES — 2 workers, one per file
**Source**: `core/skill/registry.ts`, `core/tool/web-search.ts`
**Done when**: Both test files pass. Grade >= B.

### Loop H: Preset & Saved Items Tests (P2) 🔄 GRADE: TBD
**Status**: Not started
**Files to create**: 2
- `tests/preset-crud.test.ts`
- `tests/saved-items-crud.test.ts`
**grok parallelizable**: YES — 2 workers, one per file
**Source**: Preset/Saved storage logic
**Done when**: Both test files pass. Grade >= B.

### Loop I: Platform & i18n Tests (P3) 🔄 GRADE: TBD
**Status**: Not started
**Files to create**: 2
- `tests/platform-error-handling.test.ts`
- `tests/i18n-propagation.test.ts`
**grok parallelizable**: YES — 2 workers, one per file
**Source**: `core/platform/`, `core/i18n/`
**Done when**: Both test files pass. Grade >= B.

### Loop J: Project Deletion Tests (P3) 🔄 GRADE: TBD
**Status**: Not started
**Files to create**: 1
- `tests/project-deletion-cascade.test.ts`
**grok parallelizable**: NO — single file
**Source**: `core/project/`
**Done when**: Project deletion test passes. Grade >= B.

### Loop K: Security Decision (P0) 🔄 GRADE: TBD
**Status**: Not started
**Action**: Decide `<all_urls>` permission
**grok parallelizable**: NO — decision requires human judgment
**Done when**: Decision documented. Grade >= B.

### Loop L: Architecture Refactor (Optional) ⏸️ GRADE: N/A
**Status**: Deferred — only if all others grade >= A
**Scope**: Split `fetch-hook.ts` into modules
**Done when**: Refactored with all tests passing.

---

## UI/UX QA LOOPS (run-20260622-uiux)

### Loop A: Focus Visible (P0) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: ZERO :focus-visible rules on ANY custom control
**Files to modify**: `entrypoints/sidepanel/style.css`
**grok parallelizable**: NO — single CSS file, needs careful coordination
**Change**: Add `:focus-visible` rules for ALL interactive elements
**Specific rules to add**:
```css
*:focus-visible {
  outline: 2px solid var(--ds-blue);
  outline-offset: 2px;
}
/* Override for inputs that already have focus styles */
input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline: none;
  /* Already handled by existing input:focus rule */
}
```
**Done when**: All interactive elements show visible focus ring. Grade >= B.

### Loop B: ARIA Labels (P0) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: Chat input, send button, mic button lack aria-labels
**Files to modify**: `entrypoints/sidepanel/pages/ChatPage.tsx`
**grok parallelizable**: NO — single file
**Change**: Add aria-labels to all interactive elements
**Specific changes**:
1. Line ~1441: Add `aria-label={t('sidepanel.chatPage.inputLabel')}` to textarea
2. Line ~1538: Add `aria-label={t('sidepanel.chatPage.send')}` to send button
3. Line ~1568: Add `aria-label={t('sidepanel.chatPage.voiceInput')}` to mic button
4. Add missing i18n keys to `en.ts` and `zh-CN.ts`
**Done when**: All buttons have aria-labels. Grade >= B.

### Loop C: Live Regions (P0) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: No aria-live for streaming content, tool events, status changes
**Files to modify**: `entrypoints/sidepanel/components/ChatMessage.tsx`
**grok parallelizable**: NO — single file
**Change**: Add aria-live regions for dynamic content
**Specific changes**:
1. Add `aria-live="polite"` to assistant message container
2. Add `role="status"` to streaming indicator (ds-chat-caret)
3. Add `aria-live="assertive"` to error messages
**Done when**: Screen readers announce streaming content. Grade >= B.

### Loop D: Error Handling — MemoryPage & PresetPage (P1) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: MemoryPage and PresetPage have ZERO error handling
**Files to modify**: 2 files
- `entrypoints/sidepanel/pages/MemoryPage.tsx`
- `entrypoints/sidepanel/pages/PresetPage.tsx`
**grok parallelizable**: YES — 2 workers, one per file
**Change**: Add try/catch + banner errors to all operations
**Done when**: All operations show errors on failure. Grade >= B.

### Loop E: Navigation — Back Button (P1) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: ZERO back navigation anywhere
**Files to modify**: `entrypoints/sidepanel/App.tsx` + page files
**grok parallelizable**: NO — requires coordination across files
**Change**: Add browser history integration
**Done when**: Browser back button works. Grade >= B.

### Loop F: Navigation — State Persistence (P1) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: Tab state resets on every visit
**Files to modify**: `entrypoints/sidepanel/App.tsx`
**grok parallelizable**: NO — single file
**Change**: Persist last active tab to chrome.storage
**Done when**: Last active tab is restored on reopen. Grade >= B.

### Loop G: Data Persistence — Unsaved Changes (P1) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: ALL forms lose draft on navigation without confirmation
**Files to modify**: 4 page files
- `MemoryPage.tsx`, `SkillPage.tsx`, `PresetPage.tsx`, `McpPage.tsx`
**grok parallelizable**: YES — 4 workers, one per file
**Change**: Add dirty state tracking + confirmation
**Done when**: Users are warned before losing unsaved changes. Grade >= B.

### Loop H: i18n — Hardcoded Strings (P1) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: 60+ hardcoded English strings across components
**Files to modify**: 10+ files
**grok parallelizable**: YES — up to 10 workers, one per file
**Change**: Replace all hardcoded strings with t() calls
**Files and specific strings**:
1. `ChatMessage.tsx`: "Running", "Failed", "Done" (lines 102-111)
2. `ApiSubPage.tsx`: "DeepSeek API Key", "API Keys" (lines 11, 17, 99)
3. `McpPage.tsx`: "Headers", "Secrets", "Bearer", "Basic", "Header" (lines 780-830)
4. `AutomationPage.tsx`: "Expert", "Vision", "Cron", "RRULE" (lines 902-972)
5. Add missing keys to `core/i18n/resources/en.ts` and `zh-CN.ts`
**Done when**: Zero hardcoded user-visible strings. Grade >= B.

### Loop I: CSS — Transitions & Active States (P2) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: Missing transitions and active states on buttons
**Files to modify**: `entrypoints/sidepanel/style.css`
**grok parallelizable**: NO — single CSS file
**Change**: Add transition and :active rules
**Done when**: All interactive elements have smooth transitions. Grade >= B.

### Loop J: CSS — Responsive Improvements (P2) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: Only 3 responsive breakpoints, hardcoded pixels
**Files to modify**: `entrypoints/sidepanel/style.css`
**grok parallelizable**: NO — single CSS file
**Change**: Add fluid sizing and more breakpoints
**Done when**: UI works well at 320px-600px width. Grade >= B.

### Loop K: Settings — Confirmation Dialogs (P2) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: Clear API Key and Clear Background lack confirmation
**Files to modify**: 2 files
- `ApiSubPage.tsx`, `AppearanceSubPage.tsx`
**grok parallelizable**: YES — 2 workers, one per file
**Change**: Add useConfirm() before destructive actions
**Done when**: All destructive actions require confirmation. Grade >= B.

### Loop L: Focus Management — Modal Trap (P2) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: Modal dialogs don't trap focus
**Files to modify**: `primitives.tsx`
**grok parallelizable**: NO — single file
**Change**: Implement focus trap in useConfirm modal
**Done when**: Focus is trapped in modals. Grade >= B.

### Loop M: Performance — Chat Virtualization (P3) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: Large chat histories render all messages in DOM
**Files to modify**: `ChatPage.tsx`
**grok parallelizable**: NO — complex integration
**Change**: Add virtual scrolling for messages
**Done when**: Chat handles 1000+ messages without lag. Grade >= B.

### Loop N: UX Polish — Empty State CTAs (P3) 🔄 GRADE: TBD
**Status**: Not started
**Finding**: Some empty states lack clear call-to-action
**Files to modify**: 4 page files
- `MemoryPage.tsx`, `PresetPage.tsx`, `SavedPage.tsx`, `ProjectsPage.tsx`
**grok parallelizable**: YES — 4 workers, one per file
**Change**: Add primary action buttons to all empty states
**Done when**: All empty states have clear CTAs. Grade >= B.

---

## EXECUTION WAVES

### Wave 1 — Parallel (Start Immediately)
**Backend**: C (Fetch Tests), G (Skill/Web Tests), H (Preset/Saved Tests), I (Platform/i18n Tests)
**UI/UX**: D (Error Handling), G (Unsaved Changes), H (i18n Strings), K (Confirmations), N (Empty CTAs)
**Total parallel workers**: 9 (within 10 limit)

### Wave 2 — After Wave 1
**Backend**: D (Automation E2E), E (MCP Tests), F (Memory Tests), J (Project Tests)
**UI/UX**: A (Focus Visible), B (ARIA Labels), C (Live Regions), F (State Persistence)
**Total parallel workers**: 8

### Wave 3 — After Wave 2
**Backend**: K (Security Decision)
**UI/UX**: E (Back Button), I (CSS Transitions), J (CSS Responsive), L (Focus Trap)
**Total parallel workers**: 5

### Wave 4 — After Wave 3
**UI/UX**: M (Chat Virtualization)
**Total parallel workers**: 1

---

## GRADING RUBRIC

| Grade | Criteria |
|-------|----------|
| **A** | All tests pass, zero hardcoded values, full accessibility, no regressions, clean code |
| **B** | Tests pass, most accessibility covered, minor gaps documented, no critical issues |
| **C** | Tests pass but incomplete coverage, some accessibility gaps, needs iteration |
| **D** | Tests fail or incomplete, significant accessibility issues, needs rework |
| **F** | Broken, no tests, major regressions, unacceptable |

---

## COMPLETION CRITERIA

The plan is complete when:
1. ALL 26 loops (12 backend + 14 UI/UX) have grade >= B
2. Full test suite passes: `npm test`
3. Typecheck passes: `npm run compile`
4. `ops/qa/run-20260622-111535/FINAL-REPORT.md` exists
5. `ops/qa/run-20260622-uiux/FINAL-REPORT.md` exists
6. Zero remaining tasks in task tracker

---

## START COMMAND

```bash
cd /Users/kyin/Projects/deepseek-pp && git checkout loop-it-all
```

Begin Wave 1. Execute all parallel loops. Self-evaluate after each. Iterate until grade >= B. Continue through all waves until no more work remains.
