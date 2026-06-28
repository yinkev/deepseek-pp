# Secondary/Tertiary Handoff - 2026-06-22

Scope: current DeepSeek++ repo work only. This handoff is based on the dirty git diff, changed docs, and changed tests. It does not include Chrome, DevTools, browser automation, or live runtime inspection.

## Current State

- Browser-control parity is still repo-implemented but not live-smoke-complete.
- Phase 6 remains incomplete: passive Chrome preflight exists; live Chrome sidepanel/browser-control smoke is pending.
- Do not infer live Chrome correctness from repo tests, mocked Chrome API tests, docs, or preflight output.

## Implemented Repo-Only Changes Since The Chrome Pause

1. Passive Chrome smoke gate:
   - Added `npm run smoke:chrome-preflight`.
   - Added `scripts/chrome-runtime-preflight.mjs` plus declaration file and tests.
   - The script reads `ps` output, classifies Chrome browser/page-renderer/extension-renderer processes, and returns `GO` or `NO-GO`.
   - CPU blockers: browser `>=80%`, page renderer `>=50%`, extension renderer `>=25%`.
   - RSS thresholds are warnings only: browser `>=8192 MB`, page renderer `>=2048 MB`, extension renderer `>=1024 MB`.
   - Operator docs say no DevTools, Chrome automation, or live sidepanel smoke while preflight is `NO-GO`.

2. Browser snapshot lease hardening:
   - `browser_snapshot` output now includes `snapshotId`, `targetLeaseId`, and `capturedAt`.
   - UID-based actions now require matching `snapshotId` and `targetLeaseId`.
   - Snapshot UIDs expire after 30 seconds and are invalidated on debugger detach, page lifecycle navigation, target switch, settings target change, direct snapshot refresh, action completion, and mutating-action failure.
   - Stale UID behavior now fails with retryable `browser_uid_not_found` and tells the caller to run `browser_snapshot` again.
   - `includeSnapshotAfterActions` now defaults to `false`.

3. Sidepanel chat timeout/abort cleanup:
   - Added `core/chat/sidepanel-job-runner.ts`.
   - Sidepanel chat submissions now use an `AbortController`.
   - Per-web-turn timeout remains 90 seconds; outer sidepanel job timeout is 95 seconds.
   - Timeout/error paths emit terminal errors, mark active tool events as error, clear the busy lock, and avoid late terminal errors from timed-out jobs.
   - Active loop markers now carry loop id and stream id, so late cleanup from an old loop cannot clear a newer loop.
   - `ChatPage` now has a 110 second stream watchdog and finalizes running tool disclosures when the stream stalls.

4. Tool-loop and automation result contracts:
   - `runToolContinuationLoop` now returns `stopReason`, `depth`, and `pendingToolCallCount`.
   - Automation now fails instead of claiming success when continuation budget is exhausted or DeepSeek returns more tool calls without a parent message id.
   - Late executor patches cannot mutate terminal automation runs.

5. DeepSeek Web Vision and screenshot capture cancellation:
   - Vision uploads now propagate abort signals through PoW, upload fetches, status fetches, and poll delays.
   - Abort errors are preserved instead of being wrapped as PoW/Vision failures.
   - Browser screenshot tools route captures through DeepSeek Web Vision upload metadata and do not return raw base64/data URLs in generic tool text.

6. Content-script tool text cleanup:
   - Rendered tool-call cleanup is now bounded to likely assistant message roots.
   - The cleaner no longer observes `characterData` mutations globally.
   - The bootstrap observer stops after 5 seconds and is stopped on extension invalidation / response completion.

7. Runtime Doctor/personal readiness load reduction:
   - Startup no longer runs personal runtime readiness on every service-worker bootstrap.
   - Runtime Doctor storage scanning is consolidated into a single audit pass during readiness checks.

8. Docs updated:
   - `docs/progress/MASTER.md` now marks T6.1 as passive preflight added, live Chrome smoke pending.
   - `docs/verification/chrome-runtime-smoke.md` documents the preflight gate and the exact natural live-smoke prompt to use only after `GO`.
   - `docs/analysis/chrome-hot-bundle-size-hypothesis.md` records the bundle-size hypothesis, passive process evidence, and why live Chrome attachment should stay paused while Chrome is hot.
   - `docs/analysis/project-overview.md` and `docs/plan/milestones.md` were updated from proposed/missing browser-control parity to local implementation plus pending live smoke.

## Files Touched In Current Dirty Tree

Core/runtime:
- `core/automation/runner.ts`
- `core/automation/store.ts`
- `core/browser-control/cdp.ts`
- `core/browser-control/service.ts`
- `core/browser-control/settings.ts`
- `core/browser-control/snapshot.ts`
- `core/browser-control/tool.ts`
- `core/browser-control/types.ts`
- `core/chat/active-loop.ts`
- `core/chat/sidepanel-job-runner.ts`
- `core/deepseek/adapter.ts`
- `core/deepseek/web-vision.ts`
- `core/tool-loop/engine.ts`

Entrypoints/UI:
- `entrypoints/background.ts`
- `entrypoints/content.ts`
- `entrypoints/sidepanel/pages/BrowserControlPage.tsx`
- `entrypoints/sidepanel/pages/ChatPage.tsx`

Scripts/package/docs:
- `package.json`
- `scripts/chrome-runtime-preflight.mjs`
- `scripts/chrome-runtime-preflight.d.mts`
- `docs/analysis/chrome-hot-bundle-size-hypothesis.md`
- `docs/analysis/project-overview.md`
- `docs/plan/milestones.md`
- `docs/progress/MASTER.md`
- `docs/verification/chrome-runtime-smoke.md`

Tests:
- `tests/automation-runner-pow.test.ts`
- `tests/automation-store-reconcile.test.ts`
- `tests/background-memory-bounds.test.ts`
- `tests/browser-control.test.ts`
- `tests/chat-active-loop.test.ts`
- `tests/chrome-runtime-preflight.test.ts`
- `tests/deepseek-adapter-pow.test.ts`
- `tests/deepseek-web-vision.test.ts`
- `tests/sidepanel-chat-attachments.test.ts`
- `tests/sidepanel-chat-job-runner.test.ts`
- `tests/tool-block-style.test.ts`

## Behavior Contracts To Preserve

- Live Chrome smoke must be gated by `npm run smoke:chrome-preflight`; `NO-GO` means stop and record evidence.
- The preflight is passive and is not a substitute for the real Chrome sidepanel smoke.
- Browser-control UID actions must include `snapshotId` and `targetLeaseId` from the same `browser_snapshot`.
- Stale browser snapshot UIDs must fail closed; do not auto-refresh and click a guessed element.
- Browser-control defaults favor personal convenience but avoid automatic post-action snapshots unless explicitly enabled.
- Sidepanel chat must not remain stuck busy after timeout, stream interruption, or service-worker wake reconciliation.
- Running sidepanel tool disclosures must become terminal on timeout/error; raw XML/JSON tool payloads should not appear in visible chat.
- Automation must fail on continuation-limit exhaustion or missing continuation parent message rather than treating partial tool work as success.
- Vision/screenshot flows must avoid durable/raw base64 leakage and preserve abort semantics.

## Verification Visible From Repo/Context

Visible from changed docs:
- `docs/progress/MASTER.md` says automated validation is locally done, passive preflight was added, and live Chrome smoke is pending.
- `docs/analysis/chrome-hot-bundle-size-hypothesis.md` records passive evidence from `du`, `find`, `rg`, `ps`, and `sample`; it identifies a hot Chrome page renderer and says Chrome attachment/automation should be avoided while hot.
- `docs/verification/chrome-runtime-smoke.md` documents the preflight expected exits: `0` for `GO`, `2` for `NO-GO`, `1` for script/argument failure.

Visible from changed tests:
- New/updated tests cover chrome preflight parsing/evaluation/reporting, snapshot leases and invalidation, sidepanel job timeout cleanup, active-loop ids/stream ids, sidepanel stream watchdog/error disclosure behavior, automation continuation failures, terminal automation-run immutability, Vision abort propagation, and bounded content cleanup.

Not run in this handoff pass:
- No `npm test`, `npm run compile`, build, preflight, smoke, Chrome, DevTools, or browser automation commands were run.

## Known Caveats

- Live Chrome sidepanel/browser-control smoke is still pending and must not be inferred from repo tests.
- Passive preflight can only say whether it is acceptable to start live smoke; it does not prove extension behavior.
- Edge live smoke is still separate; the Chrome preflight does not inspect Edge.
- Current worktree is dirty and shared. Do not revert unrelated edits.
