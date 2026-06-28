# Secondary/Tertiary Next Steps - 2026-06-22

Scope: DeepSeek++ repo work only. This note does not require Chrome, DevTools, browser automation, or live runtime access.

## Current Read

- Browser-control infrastructure is locally implemented: background-owned CDP/debugger service, controlled targets, AX snapshots, `browser_*` tools, sidepanel controls, and automated validation are present in the current diff.
- Phase 6 remains open because live Chrome sidepanel/browser-control smoke is blocked until Chrome is cool enough to inspect without perturbing the user's session.
- The new passive preflight (`scripts/chrome-runtime-preflight.mjs`) gates Chrome smoke on CPU blockers and reports RSS warnings; it does not attach to Chrome.
- Relevant test deltas cover snapshot lease invalidation, sidepanel stream timeouts and terminal tool events, abort propagation through PoW/Vision/Web turns, and memory/result bounds.

## Priorities

1. Keep doing repo-only hardening around the current diff.
   - Preserve the background-owned browser-control boundary.
   - Keep snapshot UID usage tied to `snapshotId` and `targetLeaseId`; stale or missing leases should fail before DOM resolution.
   - Keep sidepanel Web turns bounded: timeout must abort the job, terminalize running tool/status events, clear the busy lock, and unlock the composer.
   - Keep Vision/PoW/Web paths abortable; cancellation should surface as abort, not as generic tool or upload failure.
   - Keep tool-result and screenshot/Vision payloads bounded and non-leaky.

2. Do not resume Chrome work until explicitly unblocked.
   - [CHROME REQUIRED] Run the passive gate first:
     ```bash
     npm run smoke:chrome-preflight
     ```
   - [CHROME REQUIRED] Only if it returns `GO`, load/reload `dist/chrome-mv3`, enable Browser Control, select a normal web tab, and run a real sidepanel/browser-control smoke.
   - [CHROME REQUIRED] Expected live evidence: compact DeepSeek Web status disclosure, no raw XML/JSON tool payloads, final disclosure not stuck on `Using ... tools`, send button unlocked after completion, and `browser_snapshot` working on the selected tab.
   - [CHROME REQUIRED] If heat remains, collect Chrome Task Manager and service-worker lifetime evidence before blaming bundle size.

3. Continue without Chrome where possible.
   - Review the dirty diff without reverting unrelated edits.
   - Run focused unit/contract checks for changed behavior.
   - Refresh build/package artifacts only as needed for size accounting; building is repo-only, but do not load the result into Chrome from this track.
   - Add lightweight counters before optimizing bundle size: runtime message count/type/bytes, `syncToMainWorld` count/payload summary, prompt augmentation count/duration/size, observer callback count, tool-loop stop reasons/depth, and `STATE_UPDATED`/`GET_SKILLS`/`TOOL_DESCRIPTORS_UPDATED` sources.

## Safe Repo-Only Verification Commands

Focused tests for the current diff:

```bash
npm test -- tests/chrome-runtime-preflight.test.ts tests/browser-control.test.ts tests/sidepanel-chat-job-runner.test.ts tests/sidepanel-chat-attachments.test.ts tests/background-memory-bounds.test.ts tests/deepseek-web-vision.test.ts tests/deepseek-adapter-pow.test.ts tests/automation-runner-pow.test.ts tests/automation-store-reconcile.test.ts tests/chat-active-loop.test.ts tests/tool-block-style.test.ts
```

Static checks:

```bash
npm run compile
npm run verify:manifest-policy
```

Build/package-size accounting without opening Chrome:

```bash
npm run build:chrome
du -sh dist/chrome-mv3
find dist/chrome-mv3 -maxdepth 5 -type f -exec du -h {} + | sort -hr | head -30
find dist/chrome-mv3 -maxdepth 6 -type f -name '*.map' -print | wc -l
rg -n "pyodide|loadPyodide|python_stdlib|pyodide\\.asm" dist/chrome-mv3/background.js dist/chrome-mv3/content-scripts dist/chrome-mv3/chunks dist/chrome-mv3/*.html
```

Release-package accounting after build output is refreshed:

```bash
npm run zip:chrome
npm run verify:release-assets
ls -lh dist/deepseek-plus-plus-*-chrome.zip
```

## Verify Next

1. Repo-only: run the focused Vitest command above, then `npm run compile` and `npm run verify:manifest-policy`.
2. Repo-only: inspect any failing test against the active diff; do not normalize unrelated formatting churn unless it blocks the check.
3. Repo-only: refresh Chrome build output and record actual package-size numbers if bundle/package concerns remain active.
4. Repo-only: decide whether to add a package-size budget script. Current release checks assert required files and zip presence, not bundle-size budgets.
5. [CHROME REQUIRED] When Chrome resumes and preflight returns `GO`, run the live smoke and visual disclosure audit.

## Open Risks

- Chrome heat: current evidence points to sustained page-renderer CPU, not a one-time bundle parse spike. Content scripts still execute in page renderers, so extension-side loops are not ruled out.
- Bundle size: `dist/chrome-mv3` was observed at about `18M`; this can affect install size, parse time, memory pressure, and startup spikes even if it is not the leading heat explanation.
- Pyodide: bundled Pyodide assets dominate package size (`pyodide.asm.wasm`, `python_stdlib.zip`, runtime module). Current evidence says they are sandbox/offscreen assets, not normal idle page entrypoint loads, but fetch/load behavior should be rechecked after build changes.
- Main-world/content weight: broad i18n strings and prompt-related imports appear in document-start scripts; this is a real secondary cleanup candidate.
- OfficeCLI bundled docs: eager raw Skill docs add background bundle weight. Lazy loading is a candidate after loop/message evidence is understood.
- Package-size accounting: there is no explicit size budget gate yet for `dist/chrome-mv3` or zipped Chrome assets.
- Live UX: sidepanel timeout/disclosure behavior is covered by tests, but final confidence still depends on the real Chrome sidepanel smoke.
