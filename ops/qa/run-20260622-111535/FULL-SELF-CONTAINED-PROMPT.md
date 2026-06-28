# AUTONOMOUS QA HARDENING LOOP — SELF-CONTAINED PROMPT

> Copy everything below this line into a fresh MiMoCode session. Do not reference external files.

---

## SETUP

```
cd /Users/kyin/Projects/deepseek-pp && git checkout loop-it-all
```

## IDENTITY

You are an autonomous QA engineer. You execute loops A through L. You use `grok` CLI as workers (up to 10 parallel). You self-govern: evaluate, grade, iterate. You do not stop until all loops complete. You do not ask for approval.

## SELF-GOVERNANCE PROTOCOL

After completing each loop:
1. Run the tests you wrote. Did they pass?
2. Grade yourself A-F on: coverage, correctness, edge cases, readability
3. If grade < B, fix and re-run until B or higher
4. Save evidence to `ops/qa/run-20260622-111535/loops/<loop-id>/evidence.txt`
5. Only then proceed to next loop

## WORKER STRATEGY

Use `grok` CLI for parallel test creation:
```bash
grok -p "Write a Vitest test file. Follow patterns from the existing tests shown below. Output ONLY TypeScript code. File: tests/<name>.test.ts"
```
Each worker = ONE file. Workers don't coordinate. You collect, evaluate, merge. If worker fails, fix yourself.

## EXISTING TEST PATTERNS (copy this style)

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
// Use vi.mock() for chrome APIs
// Use vi.hoisted() for mock declarations
// Pattern: describe('feature', () => { it('case', () => { ... }); });
// Assert with expect().toBe(), expect().toEqual(), expect().toThrow()
```

## COMMANDS

- Run all tests: `npm test`
- Run specific: `npm test -- --grep <pattern>`
- Typecheck: `npm run compile`
- Build all: `npm run build:all`
- Manifest check: `npm run verify:manifest-policy`

## KEY SOURCE FILES

```
core/browser-control/types.ts     — Browser control types, BROWSER_CONTROL_TOOL_NAMES
core/browser-control/service.ts   — Browser control service, CDP management
core/browser-control/cdp.ts       — CDP connection adapter
core/browser-control/tool.ts      — Browser control tool descriptors and execution
core/browser-control/snapshot.ts  — Accessibility Tree snapshot manager
core/browser-control/settings.ts  — Browser control settings storage
core/browser-control/act-verify.ts — Act-verify capture after actions
core/automation/types.ts          — Automation types, AutomationSchedule, AutomationRun
core/automation/scheduler.ts      — AUTOMATION_RUN_TIMEOUT_MS=180_000, AUTOMATION_WAKE_INTERVAL_MINUTES=1, scanDueAutomations, runAutomation, executeWithRetry, withRunTimeout, reconcileStaleRuns
core/automation/runner.ts         — AUTOMATION_MCP_CONTINUATION_LIMIT=3, runDeepSeekAutomation, runAutomationToolLoop
core/automation/store.ts          — Automation CRUD, reconcileStaleRuns, pruneRunHistory
core/interceptor/fetch-hook.ts    — installFetchHook, hookFetch, hookXHR, hookIndexedDB, XmlToolStreamFilter (1427 lines)
core/interceptor/request-augmentation.ts — augmentRequestBody
core/prompt/augmentation.ts       — buildPromptAugmentation
core/mcp/types.ts                 — MCP types, McpServerConfig, McpProtocolClient
core/mcp/discovery.ts             — MCP tool discovery, executeMcpToolCall
core/mcp/client.ts                — MCP protocol client
core/mcp/store.ts                 — MCP server storage
core/memory/store.ts              — Memory CRUD (IndexedDB via Dexie)
core/memory/injector.ts           — Memory injection into prompt
core/memory/selector.ts           — Memory selection by budget
core/memory/scope.ts              — Memory scope (global vs project)
core/skill/registry.ts            — Skill registry
core/skill/parser.ts              — Skill template parsing
core/skill/builtin.ts             — Built-in skills
core/tool/runtime.ts              — executeRuntimeToolCall, getRuntimeToolDescriptors (routes to all providers)
core/tool/types.ts                — ToolDescriptor, ToolCall, ToolResult, ToolProvider
core/tool/memory.ts               — Memory tool descriptors
core/tool/web-search.ts           — Web search tool descriptors
core/project/                     — Project context system
core/i18n/resources/en.ts         — English translations
core/i18n/resources/zh-CN.ts      — Chinese translations
core/platform/                    — Platform detection and capabilities
entrypoints/background.ts         — MV3 background, handleMessage (~80 message types), tool execution
entrypoints/content.ts             — Content script, bridge, tool UI rendering
entrypoints/main-world.content.ts — Main world fetch hook installation
entrypoints/sidepanel/pages/      — React UI pages (ChatPage, BrowserControlPage, AutomationPage, etc.)
entrypoints/sidepanel/components/ — React UI components
wxt.config.ts                     — Manifest, permissions, build config
tests/browser-control.test.ts     — Existing browser control tests (minimal)
tests/automation-runner-pow.test.ts — Existing automation test pattern
tests/request-augmentation.test.ts — Existing augmentation test pattern
tests/mcp-transport-common.test.ts — Existing MCP test pattern
tests/memory-tool.test.ts         — Existing memory test pattern
```

## EXISTING TESTS (80 files)

```
tests/artifact.test.ts                    tests/automation-auth.test.ts
tests/automation-chain.test.ts            tests/automation-preflight.test.ts
tests/automation-readiness.test.ts        tests/automation-replay.test.ts
tests/automation-runner-auth.test.ts      tests/automation-runner-pow.test.ts
tests/automation-store-reconcile.test.ts  tests/automation-workflow-templates.test.ts
tests/autopilot-ledger.test.ts            tests/background-memory-bounds.test.ts
tests/bridge-schema.test.ts              tests/browser-control.test.ts
tests/chat-active-loop.test.ts            tests/chat-provider.test.ts
tests/chrome-runtime-preflight.test.ts    tests/content-vision-media-validation.test.ts
tests/conversation-export.test.ts         tests/deepseek-adapter-pow.test.ts
tests/deepseek-adapter-stream.test.ts     tests/deepseek-official-api.test.ts
tests/deepseek-web-origin.test.ts         tests/deepseek-web-vision.test.ts
tests/history-cleanup.test.ts             tests/i18n.test.ts
tests/injected-theme.test.ts              tests/inline-agent-loop.test.ts
tests/inline-agent-prompt.test.ts         tests/inline-agent-renderer.test.ts
tests/inline-markdown.test.ts             tests/local-skill-importer.test.ts
tests/mcp-execution-policy.test.ts        tests/mcp-native-multimodal-env.test.ts
tests/mcp-page-collapse.test.ts           tests/mcp-transport-common.test.ts
tests/memory-scope.test.ts                tests/memory-tool.test.ts
tests/multimodal-media.test.ts            tests/multimodal-policy.test.ts
tests/multimodal-settings.test.ts         tests/p1-interactive-tools.test.ts
tests/persisted-data-i18n.test.ts         tests/phase5-product-surfaces.test.ts
tests/platform-capabilities.test.ts       tests/project-context.test.ts
tests/project-sidebar-organizer.test.ts   tests/projects-page.test.ts
tests/read-history-snapshot.test.ts       tests/request-augmentation.test.ts
tests/runtime-broadcast.test.ts           tests/runtime-doctor.test.ts
tests/scenario-localization.test.ts       tests/shell-host-local-skill-preview.test.ts
tests/shell-policy.test.ts                tests/sidepanel-chat-attachments.test.ts
tests/sidepanel-chat-job-runner.test.ts   tests/sidepanel-interactions.test.ts
tests/sidepanel-navigation.test.ts        tests/sidepanel-polish.test.ts
tests/sidepanel-tool-sanitize.test.ts     tests/skill-localization.test.ts
tests/skill-popup.test.ts                 tests/streaming-tool-call-parser.test.ts
tests/streaming-tool-text.test.ts         tests/sync-local-skill-merge.test.ts
tests/sync-schema.test.ts                 tests/token-speed.test.ts
tests/tool-block-style.test.ts            tests/tool-execution-restore.test.ts
tests/tool-history.test.ts                tests/tool-parser.test.ts
tests/tool-restore-block.test.ts          tests/tool-result-renderer.test.ts
tests/tool-scan-gate.test.ts              tests/usage-stats.test.ts
tests/vision-evidence.test.ts             tests/web-chat-session.test.ts
tests/whats-new-panel.test.ts             tests/whats-new.test.ts
tests/xml-tool-stream-filter.test.ts
```

---

## LOOP A: Browser Control Tests (P0)

**Finding**: FND-001 — Browser control has minimal test coverage for critical CDP/tab/snapshot functionality
**Source**: `core/browser-control/types.ts`, `core/browser-control/service.ts`, `core/browser-control/cdp.ts`, `core/browser-control/tool.ts`, `core/browser-control/snapshot.ts`, `core/browser-control/settings.ts`, `core/browser-control/act-verify.ts`
**Existing test**: `tests/browser-control.test.ts` (covers only tool definitions)

**Create 6 files**:

1. `tests/browser-control-cdp.test.ts`
   - Test CDP connection attach/detach lifecycle
   - Test CDP connection failure handling
   - Test CDP disconnect detection
   - Mock: `chrome.debugger.attach`, `chrome.debugger.detach`, `chrome.debugger.sendCommand`
   - Stub pattern: `vi.stubGlobal('chrome', { debugger: { attach: vi.fn(), detach: vi.fn(), sendCommand: vi.fn() } })`

2. `tests/browser-control-tabs.test.ts`
   - Test controlled tab registry (add/remove/query)
   - Test tab targeting resolution
   - Test tab group metadata
   - Mock: `chrome.tabs.query`, `chrome.tabs.get`, `chrome.tabs.update`
   - Stub pattern: `vi.stubGlobal('chrome', { tabs: { query: vi.fn(), get: vi.fn(), update: vi.fn() } })`

3. `tests/browser-control-snapshot.test.ts`
   - Test AX snapshot capture
   - Test snapshot node budget enforcement (maxSnapshotNodes)
   - Test snapshot text byte budget (maxSnapshotTextBytes)
   - Test truncated flag when budget exceeded
   - Mock: `chrome.debugger.sendCommand` returning AX tree

4. `tests/browser-control-platform.test.ts`
   - Test Chromium: browser control supported
   - Test Firefox: browser control unsupported, descriptors empty
   - Test Android: browser control unsupported
   - Mock: `chrome.runtime.getPlatformInfo`, capability checks

5. `tests/browser-control-lock.test.ts`
   - Test target lock enable/disable
   - Test target lock persists across actions
   - Test stale lock detection
   - Mock: `chrome.storage.local.get/set`

6. `tests/browser-control-dialog.test.ts`
   - Test dialog detection
   - Test dialog accept/dismiss
   - Test dialog prompt input
   - Mock: `chrome.debugger.sendCommand` for JS dialog events

**Done when**: `npm test -- --grep browser-control` passes all new tests. Grade >= B.

---

## LOOP B: Fix Long-Running Automations (P1)

**Finding**: FND-015 — Long-running automations killed by hardcoded 3-minute timeout
**Source**: `core/automation/scheduler.ts:32` AUTOMATION_RUN_TIMEOUT_MS=180_000, `core/automation/runner.ts:34` AUTOMATION_MCP_CONTINUATION_LIMIT=3

**Modify 3 files**:

1. `core/automation/types.ts`
   - Add `timeoutMs?: number` to `AutomationSchedule` interface (line ~37)
   - After `minimumIntervalMinutes: number;`

2. `core/automation/scheduler.ts`
   - Line 32: Change `AUTOMATION_RUN_TIMEOUT_MS = 180_000` to `AUTOMATION_RUN_TIMEOUT_MS = 600_000`
   - In `runAutomation()` (~line 144): Read `automation.schedule.timeoutMs` and pass to `executeWithRetry`
   - In `executeWithRetry()` (~line 245): Accept optional `timeoutMs` param, use `automation.schedule.timeoutMs ?? AUTOMATION_RUN_TIMEOUT_MS` as deadline
   - In `reconcileStaleRuns()` (~line 73): Already uses `AUTOMATION_RUN_TIMEOUT_MS` — no change needed, it uses the updated constant

3. `core/automation/runner.ts`
   - Line 34: Change `AUTOMATION_MCP_CONTINUATION_LIMIT = 3` to `AUTOMATION_MCP_CONTINUATION_LIMIT = 5`

**Verify**: `npm test -- --grep automation` passes. Grade >= B.

---

## LOOP C: Fetch Interception Tests (P0)

**Finding**: FND-002 — No end-to-end test for fetch interception lifecycle
**Source**: `core/interceptor/fetch-hook.ts` (1427 lines), `entrypoints/main-world.content.ts`, `entrypoints/content.ts:675-750`

**Create 2 files**:

1. `tests/fetch-hook-lifecycle.test.ts`
   - Test `installFetchHook()` replaces window.fetch
   - Test hooked fetch detects chat stream URL
   - Test hooked fetch passes through non-chat URLs
   - Test `XmlToolStreamFilter` strips XML tool blocks from visible text
   - Test `X-DPP-Bypass-Hook` header bypass
   - Test `INITIAL_HOOK_STATE_WAIT_MS` timeout behavior
   - Mock: `window.fetch = vi.fn()`, create mock Request/Response objects
   - Pattern: Study `tests/request-augmentation.test.ts` for augmentation mocking

2. `tests/bridge-connection.test.ts`
   - Test bridge request polling (DPP_BRIDGE_REQUEST)
   - Test bridge initialization (DPP_BRIDGE_INIT)
   - Test bridge ready confirmation (BRIDGE_READY)
   - Test pending message queue flush
   - Test queue cap (100 entries, FIFO eviction)
   - Mock: `window.postMessage`, `MessageChannel`, `MessagePort`

**Done when**: Both test files pass. Grade >= B.

---

## LOOP D: Automation Runner E2E (P1)

**Finding**: FND-005 — Automation system lacks runner end-to-end testing
**Depends on**: Loop B (timeout fix)
**Source**: `core/automation/runner.ts`, `core/automation/scheduler.ts`, `core/automation/store.ts`

**Create 1 file**:

1. `tests/automation-runner-e2e.test.ts`
   - Test complete automation execution lifecycle
   - Test scheduling accuracy (cron expression → nextRunAt)
   - Test retry on failure (AUTOMATION_MAX_ATTEMPTS=2)
   - Test chain follow-up execution
   - Test flight recorder event capture
   - Test stale run reconciliation
   - Mock: Full automation store, adapter, tool execution
   - Pattern: Study `tests/automation-runner-pow.test.ts` for mock patterns

**Done when**: E2E test passes. Grade >= B.

---

## LOOP E: MCP Connection Tests (P1)

**Finding**: FND-003 — MCP integration lacks lifecycle and failure mode testing
**Source**: `core/mcp/discovery.ts`, `core/mcp/client.ts`, `core/mcp/store.ts`, `core/mcp/types.ts`

**Create 1 file**:

1. `tests/mcp-connection-lifecycle.test.ts`
   - Test MCP server connection initialization
   - Test tool discovery caching (expiresAt)
   - Test transport failure recovery
   - Test health monitoring (latency, status)
   - Test tool allowlist/denylist policy
   - Mock: `chrome.runtime.connectNative`, fetch for HTTP/SSE transports
   - Pattern: Study `tests/mcp-transport-common.test.ts`

**Done when**: MCP lifecycle test passes. Grade >= B.

---

## LOOP F: Memory Injection Tests (P1)

**Finding**: FND-004 — Memory injection into prompt is untested
**Source**: `core/memory/injector.ts`, `core/memory/selector.ts`, `core/memory/store.ts`, `core/memory/scope.ts`

**Create 1 file**:

1. `tests/memory-injection.test.ts`
   - Test memory selection by budget
   - Test memory injection into prompt augmentation
   - Test global vs project-scoped memory
   - Test memory archival (90+ day untouched)
   - Test memory access count update
   - Mock: IndexedDB via Dexie mock
   - Pattern: Study `tests/memory-tool.test.ts`, `tests/memory-scope.test.ts`

**Done when**: Memory injection test passes. Grade >= B.

---

## LOOP G: Skill & Web Search Tests (P2)

**Findings**: FND-006, FND-007
**Source**: `core/skill/registry.ts`, `core/skill/parser.ts`, `core/skill/builtin.ts`, `core/tool/web-search.ts`, `core/tool/web-settings.ts`

**Create 2 files**:

1. `tests/skill-template-injection.test.ts`
   - Test skill template parsing
   - Test skill name matching
   - Test skill injection into prompt
   - Test skill creator tool execution
   - Mock: chrome.storage for skill data

2. `tests/web-search-execution.test.ts`
   - Test web search via Bing
   - Test web page content extraction
   - Test search result formatting
   - Test search settings persistence
   - Mock: fetch for Bing API, web page responses

**Done when**: Both test files pass. Grade >= B.

---

## LOOP H: Preset & Saved Items Tests (P2)

**Findings**: FND-008, FND-009
**Source**: `entrypoints/sidepanel/pages/PresetPage.tsx`, `entrypoints/sidepanel/pages/SavedPage.tsx`

**Create 2 files**:

1. `tests/preset-crud.test.ts`
   - Test preset create/read/update/delete
   - Test preset name uniqueness
   - Test preset injection into prompt
   - Mock: chrome.storage

2. `tests/saved-items-crud.test.ts`
   - Test saved items create/read/update/delete
   - Test search functionality
   - Test export as Markdown/JSON
   - Mock: chrome.storage

**Done when**: Both test files pass. Grade >= B.

---

## LOOP I: Platform & i18n Tests (P3)

**Findings**: FND-012, FND-013
**Source**: `core/platform/`, `core/i18n/resources/en.ts`, `core/i18n/resources/zh-CN.ts`

**Create 2 files**:

1. `tests/platform-error-handling.test.ts`
   - Test unsupported platform error messages
   - Test capability gating behavior
   - Mock: chrome.runtime.getPlatformInfo

2. `tests/i18n-propagation.test.ts`
   - Test locale change propagation
   - Test tool description localization coverage
   - Mock: chrome.storage for locale preference

**Done when**: Both test files pass. Grade >= B.

---

## LOOP J: Project Deletion Tests (P3)

**Finding**: FND-014
**Source**: `core/project/`, `entrypoints/sidepanel/pages/ProjectsPage.tsx`

**Create 1 file**:

1. `tests/project-deletion-cascade.test.ts`
   - Test project deletion cascades to conversations
   - Test orphaned conversation handling
   - Mock: chrome.storage

**Done when**: Project deletion test passes. Grade >= B.

---

## LOOP K: Security Decision

**Finding**: FND-010 — `<all_urls>` optional host permission
**Source**: `wxt.config.ts:56`, `scripts/manifest-policy-check.mjs:34`

**Action**:
1. Search codebase for `<all_urls>` usage: `grep -r "all_urls" --include="*.ts" --include="*.mjs"`
2. If used at runtime: add justification to `docs/chrome-web-store/privacy-policy.md` and `docs/chrome-web-store/submission.md`
3. If NOT used: remove from `wxt.config.ts` line 56, update `scripts/manifest-policy-check.mjs` line 34

---

## LOOP L: Architecture Refactor (Optional)

**Finding**: FND-011 — `fetch-hook.ts` is 1427 lines
**Only if**: All loops A-K complete with grade >= A
**Scope**: Split into:
- `core/interceptor/fetch-hook.ts` — fetch interception only
- `core/interceptor/xhr-hook.ts` — XHR interception
- `core/interceptor/idb-hook.ts` — IndexedDB interception
- `core/interceptor/stream-filter.ts` — XmlToolStreamFilter class

---

## COMPLETION

After all loops:
1. `npm test` — full suite passes
2. `npm run compile` — typecheck passes
3. Update `ops/qa/run-20260622-111535/run_report.md` with final status
4. Write `ops/qa/run-20260622-111535/FINAL-REPORT.md` with grades, evidence, totals

**Done when**: All loops grade >= B, tests pass, FINAL-REPORT.md exists.

## ANTI-PATTERNS

- Do NOT ask "should I proceed?"
- Do NOT claim tests pass without running them
- Do NOT write tests that assert nothing
- Do NOT skip loops
- Do NOT stop at 80%
- Do NOT refactor unless Loop L

## START

```
cd /Users/kyin/Projects/deepseek-pp && git checkout loop-it-all
```

Begin Loop A. Work A→L sequentially. Use grok workers for parallel test creation. Self-evaluate after each loop. Iterate until grade >= B. Continue until no more work.
