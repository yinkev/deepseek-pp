# QA Hardening Run Report

**Run ID:** run-20260622-111535
**Date:** 2026-06-22
**Branch:** loop-it-all

## Summary

| Metric | Value |
|--------|-------|
| Total Test Files | 96 |
| Total Tests | 780 |
| New Tests Created | 201 |
| Source Files Modified | 3 |
| All Tests Passing | Yes |

## Loop Results

| Loop | Description | Grade | Tests | Files |
|------|-------------|-------|-------|-------|
| A | Browser Control Tests (P0) | A | 145 | 6 |
| B | Fix Long-Running Automations (P1) | B | 0 (2 modified) | 3 |
| C | Fetch Interception Tests (P0) | B | 26 | 2 |
| D | Automation Runner E2E (P1) | B | 9 | 1 |
| E | MCP Connection Tests (P1) | B | 22 | 1 |
| F | Memory Injection Tests (P1) | B | 20 | 1 |
| G | Skill & Web Search Tests (P2) | B | 8 | 1 |
| H | Preset & Saved Items Tests (P2) | B | 9 | 1 |
| I | Platform & i18n Tests (P3) | B | 9 | 1 |
| J | Project Deletion Tests (P3) | B | 5 | 1 |
| K | Security Decision | B | 0 | 0 |
| L | Architecture Refactor | Skipped | - | - |

## Source Code Changes

### Loop B: Automation Timeout Fix
1. **core/automation/types.ts** — Added `timeoutMs?: number` to `AutomationSchedule`
2. **core/automation/scheduler.ts** — `AUTOMATION_RUN_TIMEOUT_MS`: 180,000 → 600,000 (3min → 10min)
   - `executeWithRetry()` now accepts optional `timeoutMs` parameter
   - Uses `automation.schedule.timeoutMs ?? AUTOMATION_RUN_TIMEOUT_MS`
3. **core/automation/runner.ts** — `AUTOMATION_MCP_CONTINUATION_LIMIT`: 3 → 5
4. **tests/automation-runner-pow.test.ts** — Updated 2 tests for new limit (5 instead of 3)

## Test Coverage by Area

### Browser Control (Loop A)
- CDP connection lifecycle: attach, detach, sendCommand
- Dialog state management: store, retrieve, clear
- Event callbacks: onInvalidated for detach/navigation
- Error handling: BrowserControlError, toBrowserControlError
- Snapshot formatting: AX tree parsing, budget truncation
- Tab management: getControllableState, listTargets, setTarget
- Platform detection: isSupported with API availability
- Settings normalization: clamping, defaults, target lock

### Automation System (Loops B, D)
- Timeout constant increased from 3min to 10min
- MCP continuation limit increased from 3 to 5
- Per-automation custom timeout support
- Request structure validation
- Continuation limit tests updated

### Fetch Interception (Loop C)
- XmlToolStreamFilter: tool block stripping, chunk splitting
- createBufferedSSEParser: SSE event parsing, buffering
- MessagePort protocol: bidirectional communication
- Bridge request polling and augment request handling

### MCP Integration (Loop E)
- McpProtocolError class behavior
- applyMcpToolPolicy: allow/deny/all modes
- McpServerConfig structure and transport types
- Tool cache expiration logic

### Memory System (Loop F)
- selectMemories: scoring, budget, type filtering
- formatMemoryLine/formatMemoriesBlock output
- Memory decay scoring (recency, frequency)
- Text segmentation and stop word filtering

### Other (Loops G-J)
- Skill template trigger parsing
- Preset CRUD operations
- Platform error handling and capability gating
- Project deletion cascade behavior

## Grade Distribution
- **A:** 1 loop (Loop A)
- **B:** 10 loops (Loops B-K)
- **Skipped:** 1 loop (Loop L — optional refactor)

## Verification
- `npm test` — 96 files, 780 tests — ALL PASS
- `npm run compile` — Typecheck passing (0 errors)
