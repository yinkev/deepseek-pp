# Live Browser Control XML Cleanup Handoff - 2026-06-22T09:28:05-0700

Scope: DeepSeek++ live Browser Control stabilization immediately before the next extension reload. This handoff covers the current live failure, the patch just made, verification already completed, and the exact next loop after the user reloads Chrome.

## Current Status

DeepSeek++ is at a reload gate.

Code has been patched, tested, compiled, and rebuilt into:

```sh
/Users/kyin/Projects/Deepseek-pp/dist/chrome-mv3
```

Do not run another live Chrome smoke until the user reloads that unpacked extension folder.

## User Operating Rules For The Next Agent

- Orchestrate when useful. Use reviewer/worker lanes for real independent checks, not for theater.
- Quietly evaluate, review, grade, and iterate before acting.
- Use natural human prompts when talking to DeepSeek, ChatGPT, or Oracle. No marker strings, no `reply exactly`, no robotic probes.
- Do not ask for small choices when local verification can answer the question.
- Do not touch Chrome unless the current step requires live runtime verification and the user has authorized it.
- Leave unrelated dirty worktree changes alone.

## Suggested Skills

- `handoff`: for continuation docs.
- `karpathy-guidelines`: for simple, inspectable, high-signal engineering judgment.
- `caveman`: for concise numbered status when reporting to the user.
- `oracle`: advisor only, not executor. Use it for judgment pressure-testing, then verify locally.
- `superpowers:systematic-debugging`: if the live smoke still fails after reload.
- `superpowers:requesting-code-review`: if another reviewer lane is useful before a risky patch.
- `chrome:control-chrome`: only after reload and only for the live smoke.

## Incoming Context From Earlier Handoff

Another agent had already patched and verified these items before the live smoke:

- `core/deepseek/adapter.ts`: history fallback returns assistant text, not only id; parses history fragments/content.
- `entrypoints/background.ts`: empty Vision stream fetches chat history and uses latest assistant id + text.
- `entrypoints/sidepanel/pages/ChatPage.tsx`: camera permission requests `<all_urls>`.
- `wxt.config.ts`: optional host permission is `<all_urls>`.
- Prior verification from that handoff:
  - `npm test -- tests/read-history-snapshot.test.ts tests/background-memory-bounds.test.ts tests/sidepanel-chat-attachments.test.ts tests/deepseek-adapter-stream.test.ts tests/deepseek-web-vision.test.ts`
  - `npm run compile`
  - `npm run build:chrome`
  - manifest had `optional_host_permissions: ["<all_urls>"]`

Existing related project docs:

- `docs/progress/chrome-hot-auth-loop-handoff-2026-06-22.md`
- `docs/progress/secondary-tertiary-handoff-2026-06-22.md`
- `docs/verification/chrome-runtime-smoke.md`

## Live Failure That Was Reproduced

After the user reloaded the extension, a live Chrome smoke was run with a natural prompt:

```text
Can you look at the current browser page and tell me its title?
```

Result:

- Browser Control executed successfully.
- DeepSeek++ showed a Browser Control tool block for `browser_evaluate_script`.
- Tool result included the real page title:
  - `Anthropic should release optional local models to offload compute for agent tasks inClaude Code : r/ClaudeAI`
- Failure: the assistant body visibly leaked raw direct XML:
  - `<browser_snapshot>{}</browser_snapshot>`
  - `<browser_evaluate_script>{"script": "document.title"}</browser_evaluate_script>`

Read-only DOM inspection found:

- Raw XML tags were rendered as ordinary `<span class="">` text nodes.
- They were inside `.ds-message`.
- They were not inside `.dpp-agent-container`.
- They were not inside `.dpp-tool-block`.
- They were not inside `pre` or `code`.

Conclusion:

The tool path worked. The remaining defect was visible rendered cleanup timing/coverage, not tool execution.

## Patch Made In This Pass

### Rendered cleanup

File:

- `entrypoints/content.ts`

Changed behavior:

- Adds Browser Control tool names as fallback cleanable tags via `BROWSER_CONTROL_TOOL_NAMES`.
- Adds `task_complete` fallback cleanup.
- Recognizes legacy plain `<tool_calls>...</tool_calls>` wrappers.
- Cleans visible legacy XML wrapper text.
- Bounds cleanup to likely assistant message roots.
- Drops global `characterData` observation.
- Starts a temporary rendered cleaner during active tool rendering.
- Stops the cleaner on response completion and extension invalidation.
- Runs targeted final cleanup on response completion with `cleanRenderedToolCalls(getResponseToolCleanupRoots(complete))`.
- Preserves candidate cleanup roots while `activeStreamingToolCount > 0`.
- Does not run a `setTimeout(..., 250)` retry loop while tools are active.

Important reviewer note:

A reviewer flagged the earlier 250ms retry path as a residual CPU risk because a detached retry could survive stop/invalidation. That retry path was removed before final verification.

### Parser and stream cleanup already in the dirty tree

Files:

- `core/interceptor/tool-parser.ts`
- `core/interceptor/streaming-tool-text.ts`
- `core/interceptor/fetch-hook.ts`
- `core/interceptor/history-cleanup.ts`

Relevant behavior now present:

- Parses legacy `<tool_calls><invoke ...>` wrapper shape.
- Suppresses `tool_calls` wrapper text during streaming.
- Detects legacy wrapper fallback in fetch-hook paths.
- Cleans legacy wrapper text from history.

### Manifest policy

File:

- `scripts/manifest-policy-check.mjs`

Expected optional host permission is now:

```json
["<all_urls>"]
```

## Regression Tests Added Or Updated

Relevant test files:

- `tests/tool-parser.test.ts`
- `tests/streaming-tool-text.test.ts`
- `tests/xml-tool-stream-filter.test.ts`
- `tests/history-cleanup.test.ts`
- `tests/tool-block-style.test.ts`

The cleanup source assertion now explicitly checks:

- candidate roots are retained before active-tool cleanup returns;
- cleanup uses `requestAnimationFrame`;
- no `setTimeout(run, 250)` retry loop remains;
- the observer does not use `characterData: true`;
- Browser Control tags are included in rendered cleanup fallback coverage.

## Verification Already Completed

Focused regression suite:

```sh
npm test -- tests/tool-block-style.test.ts tests/xml-tool-stream-filter.test.ts tests/history-cleanup.test.ts tests/tool-parser.test.ts tests/streaming-tool-text.test.ts
```

Result:

- 5 files passed.
- 51 tests passed.

Full test suite:

```sh
npm test
```

Result:

- 81 files passed.
- 538 tests passed.

Compile:

```sh
npm run compile
```

Result:

- Passed.

Build:

```sh
npm run build:all
```

Result:

- Passed.
- Rebuilt `dist/chrome-mv3`, `dist/edge-mv3`, and `dist/firefox-mv3`.
- Existing Pyodide browser-compat externalization warnings appeared during build.

Manifest policy:

```sh
npm run verify:manifest-policy
```

Result:

- Passed.

Extension asset encoding/loadability:

```sh
npm run verify:extension-utf8
```

Result:

- Passed.
- 84 files scanned.

Passive Chrome preflight:

```sh
npm run smoke:chrome-preflight
```

Result:

- `Chrome runtime preflight: GO`
- Top process at the time was a page renderer at 6.2% CPU.
- Browser process was 0.3% CPU.

Generated dist audit:

```sh
node - <<'NODE'
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync('dist/chrome-mv3/manifest.json', 'utf8'));
const content = fs.readFileSync('dist/chrome-mv3/content-scripts/content.js', 'utf8');
console.log(JSON.stringify({
  manifestVersion: manifest.manifest_version,
  optionalHostPermissions: manifest.optional_host_permissions,
  browserSnapshotMarker: content.includes('browser_snapshot'),
  browserEvaluateMarker: content.includes('browser_evaluate_script'),
  taskCompleteMarker: content.includes('task_complete'),
  toolCallsMarker: content.includes('tool_calls'),
  no250msRenderedToolRetry: !content.includes('setTimeout(run,250)') && !content.includes('setTimeout(run, 250)'),
  noCharacterDataObserver: !content.includes('characterData:!0') && !content.includes('characterData: true'),
}, null, 2));
NODE
```

Result:

```json
{
  "manifestVersion": 3,
  "optionalHostPermissions": [
    "<all_urls>"
  ],
  "browserSnapshotMarker": true,
  "browserEvaluateMarker": true,
  "taskCompleteMarker": true,
  "toolCallsMarker": true,
  "no250msRenderedToolRetry": true,
  "noCharacterDataObserver": true
}
```

Diff hygiene:

```sh
git diff --check -- entrypoints/content.ts tests/tool-block-style.test.ts core/interceptor/tool-parser.ts core/interceptor/streaming-tool-text.ts core/interceptor/fetch-hook.ts core/interceptor/history-cleanup.ts scripts/manifest-policy-check.mjs docs/verification/chrome-runtime-smoke.md tests/tool-parser.test.ts tests/streaming-tool-text.test.ts tests/xml-tool-stream-filter.test.ts tests/history-cleanup.test.ts
```

Result:

- Passed.

## Current Dirty-Tree Warning

The worktree is shared and heavily dirty. Do not revert unrelated changes.

At handoff time, `git status --short` showed modifications across automation, browser-control, chat, DeepSeek adapter, interceptor, inline-agent, usage, docs, entrypoints, tests, `wxt.config.ts`, and new docs/scripts/tests.

Treat the current diff as collaborative work. Make surgical patches only.

## Next Required Loop After User Reload

1. User reloads:

```sh
/Users/kyin/Projects/Deepseek-pp/dist/chrome-mv3
```

2. Run passive preflight first:

```sh
npm run smoke:chrome-preflight
```

If it returns `NO-GO`, stop and record the process evidence. Do not attach live Chrome control.

3. If preflight is `GO`, run one live Chrome smoke using the Chrome control skill.

Use a natural prompt only. Good prompt:

```text
Can you look at the current browser page and tell me its title?
```

4. Verify live success criteria:

- Browser Control tool executes.
- Final answer is correct for the page.
- Visible final answer does not contain raw:
  - `<browser_snapshot>`
  - `<browser_evaluate_script>`
  - `<tool_calls>`
  - `<task_complete>`
- DeepSeek++ tool block is visible for tool execution.
- No raw XML remains in `.ds-message` outside code/pre blocks.

5. Run passive Chrome preflight again:

```sh
npm run smoke:chrome-preflight
```

6. If clean:

- Update `docs/verification/chrome-runtime-smoke.md` with the live-smoke result.
- Mark the live Browser Control XML-cleanup loop complete.

7. If raw XML still leaks:

- Do not guess.
- Inspect the rendered DOM around the newest `.ds-message`.
- Confirm whether leaked text is in spans, markdown text, reasoning content, final answer content, or code/pre.
- Patch only the confirmed cleanup boundary.
- Re-run focused tests, full tests, compile, build, manifest/UTF-8 checks, dist audit, then ask for reload again.

## Failure Triage Defaults

If Browser Control does not execute:

- Start with parser/suppression/fetch-hook paths.
- Re-check direct XML wrapper and legacy `<tool_calls>` parsing.

If Browser Control executes but raw XML appears:

- Start with `entrypoints/content.ts` rendered cleanup and DOM placement.
- Preserve low-CPU behavior. Do not add polling loops.

If the answer is empty or uses the wrong assistant id:

- Start with `core/deepseek/adapter.ts` history fallback and `entrypoints/background.ts` Vision/history fallback.

If Chrome runs hot:

- Run `npm run smoke:chrome-preflight`.
- Attribute process type before patching.
- Do not assume bundle size or Pyodide unless process evidence points there.

## End Vision For This Slice

DeepSeek++ should let the logged-in DeepSeek web session operate as a private browser-side agent control plane:

- tools execute through the extension;
- users see polished tool cards/results;
- raw control XML never leaks into the visible conversation;
- browser-control and vision flows work without API-key rerouting;
- Chrome stays cool at idle and after tool completion;
- the project has repeatable passive and live verification gates before future changes are trusted.

