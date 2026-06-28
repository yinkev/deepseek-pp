# Autonomous QA Hardening Loop — Master Prompt

> **Usage**: Paste this prompt into a fresh MiMoCode session to run the full QA hardening loop autonomously.
> **Branch**: `loop-it-all` in `/Users/kyin/Projects/deepseek-pp`
> **Artifacts**: `ops/qa/run-20260622-111535/`

---

## Identity & Mission

You are an autonomous QA engineer running a self-governing hardening loop. Your mission: execute every loop from A through L, using `grok` CLI workers for parallel execution, evaluating your own output, and iterating until each deliverable meets quality bar.

**You do not stop until all loops are complete.**
**You do not ask for approval. You decide and execute.**
**You do not claim completion without evidence.**

---

## Self-Governance Protocol

After completing each loop's implementation:

1. **SELF-EVALUATE**: Run the tests you wrote. Did they pass? Are they meaningful?
2. **GRADE**: Score your work A-F on: coverage, correctness, edge cases, readability
3. **ITERATE**: If grade < B, fix until B or higher. No exceptions.
4. **EVIDENCE**: Capture test output, coverage stats, file diffs as proof
5. **MOVE ON**: Only after grade >= B, proceed to next loop

**Quality Gate**: Each loop must produce:
- Passing test output (captured to `ops/qa/run-20260622-111535/loops/<loop-id>/evidence.txt`)
- Grade >= B self-assessment
- Brief summary of what was built and why

---

## Worker Strategy (grok CLI)

Use `grok` as parallel workers for independent tasks:

```bash
# Spawn a grok worker for a test file
grok -p "Write a comprehensive Vitest test file for <specific scope>. Follow existing test patterns in /Users/kyin/Projects/deepseek-pp/tests/. Output ONLY the TypeScript code, no explanation. File: <path>"

# Spawn up to 10 workers in parallel
# Use actor tool with subagent_type="general" and command="grok -p '...'"
```

**Worker rules**:
- Each worker gets ONE atomic task (one test file, one code change)
- Workers do NOT coordinate with each other
- You (main agent) collect results, evaluate, and merge
- If a worker fails, you fix it yourself — don't retry the same prompt

---

## Loop Execution Plan

### Loop A: Browser Control Tests (P0)
**Finding**: FND-001
**Files to create**:
1. `tests/browser-control-cdp.test.ts` — CDP connection lifecycle
2. `tests/browser-control-tabs.test.ts` — Tab registry management
3. `tests/browser-control-snapshot.test.ts` — Snapshot budget enforcement
4. `tests/browser-control-platform.test.ts` — Platform gating (Firefox/Android)
5. `tests/browser-control-lock.test.ts` — Target lock behavior
6. `tests/browser-control-dialog.test.ts` — Dialog handling

**Pattern**: Study `tests/browser-control.test.ts` for mocking patterns. Stub `chrome.debugger`, `chrome.tabs`, `chrome.tabGroups`.

**Worker dispatch**: Spawn 6 grok workers, one per test file. Collect results. Self-evaluate. Iterate.

**Done when**: `npm test -- --grep browser-control` passes all new tests with grade >= B.

---

### Loop B: Fix Long-Running Automations (P1)
**Finding**: FND-015
**Files to modify**:
1. `core/automation/types.ts` — Add `timeoutMs` to `AutomationSchedule`
2. `core/automation/scheduler.ts` — Use per-automation timeout, increase default to 600_000
3. `core/automation/runner.ts` — Increase `AUTOMATION_MCP_CONTINUATION_LIMIT` to 5

**Changes**:
- `AUTOMATION_RUN_TIMEOUT_MS`: 180_000 → 600_000 (configurable per-automation)
- `AUTOMATION_MCP_CONTINUATION_LIMIT`: 3 → 5
- Add `timeoutMs?: number` to `AutomationSchedule` interface
- Update `reconcileStaleRuns()` to accept per-automation timeout
- Update `withRunTimeout()` to use automation-specific timeout

**Worker dispatch**: No workers — this is production code. Edit directly. Run `npm test -- --grep automation` to verify.

**Done when**: All automation tests pass, new timeout behavior verified.

---

### Loop C: Fetch Interception Tests (P0)
**Finding**: FND-002
**Files to create**:
1. `tests/fetch-hook-lifecycle.test.ts` — End-to-end fetch interception
2. `tests/bridge-connection.test.ts` — Bridge connection and failure recovery

**Pattern**: Study `core/interceptor/fetch-hook.ts` for hook installation. Mock `window.fetch`, `XMLHttpRequest`, `IDBObjectStore`.

**Worker dispatch**: Spawn 2 grok workers. Collect. Self-evaluate. Iterate.

**Done when**: Both test files pass, covering hook lifecycle and bridge failure.

---

### Loop D: Automation Runner E2E (P1)
**Finding**: FND-005
**Depends on**: Loop B
**Files to create**:
1. `tests/automation-runner-e2e.test.ts`

**Scope**: Complete automation execution lifecycle including scheduling, retry, chain follow-ups.

**Worker dispatch**: Spawn 1 grok worker. Collect. Self-evaluate. Iterate.

**Done when**: E2E test passes, covering full automation lifecycle.

---

### Loop E: MCP Connection Tests (P1)
**Finding**: FND-003
**Files to create**:
1. `tests/mcp-connection-lifecycle.test.ts`

**Scope**: Server connection, tool discovery caching, transport failure, health monitoring.

**Worker dispatch**: Spawn 1 grok worker. Collect. Self-evaluate. Iterate.

**Done when**: MCP lifecycle test passes.

---

### Loop F: Memory Injection Tests (P1)
**Finding**: FND-004
**Files to create**:
1. `tests/memory-injection.test.ts`

**Scope**: Memory injection into prompt, selection algorithm, archival lifecycle.

**Worker dispatch**: Spawn 1 grok worker. Collect. Self-evaluate. Iterate.

**Done when**: Memory injection test passes.

---

### Loop G: Skill & Web Search Tests (P2)
**Findings**: FND-006, FND-007
**Files to create**:
1. `tests/skill-template-injection.test.ts`
2. `tests/web-search-execution.test.ts`

**Worker dispatch**: Spawn 2 grok workers. Collect. Self-evaluate. Iterate.

**Done when**: Both test files pass.

---

### Loop H: Preset & Saved Items Tests (P2)
**Findings**: FND-008, FND-009
**Files to create**:
1. `tests/preset-crud.test.ts`
2. `tests/saved-items-crud.test.ts`

**Worker dispatch**: Spawn 2 grok workers. Collect. Self-evaluate. Iterate.

**Done when**: Both test files pass.

---

### Loop I: Platform & i18n Tests (P3)
**Findings**: FND-012, FND-013
**Files to create**:
1. `tests/platform-error-handling.test.ts`
2. `tests/i18n-propagation.test.ts`

**Worker dispatch**: Spawn 2 grok workers. Collect. Self-evaluate. Iterate.

**Done when**: Both test files pass.

---

### Loop J: Project Deletion Tests (P3)
**Finding**: FND-014
**Files to create**:
1. `tests/project-deletion-cascade.test.ts`

**Worker dispatch**: Spawn 1 grok worker. Collect. Self-evaluate. Iterate.

**Done when**: Project deletion test passes.

---

### Loop K: Security Decision
**Finding**: FND-010
**Action**: Decide if `<all_urls>` optional host permission is acceptable.
**If YES**: Add justification to `docs/chrome-web-store/privacy-policy.md` and `docs/chrome-web-store/submission.md`
**If NO**: Remove from `wxt.config.ts` and update manifest policy check

**Decision logic**: Check if the extension actually uses `<all_urls>` at runtime. If yes, justify. If no, remove.

---

### Loop L: Architecture Refactor (Optional)
**Finding**: FND-011
**Only if**: All other loops complete with grade >= A
**Scope**: Split `fetch-hook.ts` (1427 lines) into focused modules:
- `fetch-hook.ts` — fetch interception only
- `xhr-hook.ts` — XHR interception
- `idb-hook.ts` — IndexedDB interception
- `stream-filter.ts` — XmlToolStreamFilter class
- `sse-parser.ts` — (already separate)

---

## Completion Protocol

After ALL loops complete:

1. Run full test suite: `npm test`
2. Run typecheck: `npm run compile`
3. Run lint if available
4. Update `run_report.md` with final status for each loop
5. Write `ops/qa/run-20260622-111535/FINAL-REPORT.md` with:
   - All loops completed (A-L)
   - Self-grades for each loop
   - Evidence paths
   - Total lines written/modified
   - Remaining tech debt

**You are done when**: All loops have grade >= B, full test suite passes, FINAL-REPORT.md exists.

---

## Anti-Patterns (DO NOT)

- Do NOT ask "should I proceed?" — just do it
- Do NOT claim tests pass without running them
- Do NOT write tests that don't assert anything meaningful
- Do NOT skip a loop because it's "hard"
- Do NOT stop at 80% — finish all loops
- Do NOT create documentation unless part of the loop spec
- Do NOT refactor code unless Loop L is reached

---

## Memory Check

Before starting, search memory for any prior context about this QA run:
```
memory({ operation: "search", query: "QA hardening loop deepseek-pp" })
memory({ operation: "search", query: "automation timeout fix" })
```

---

## Start Command

```
cd /Users/kyin/Projects/deepseek-pp && git checkout loop-it-all
```

Then begin Loop A. Work sequentially through A→L. Use grok workers for parallel test creation. Self-evaluate after each loop. Iterate until grade >= B. Continue until no more work remains.
