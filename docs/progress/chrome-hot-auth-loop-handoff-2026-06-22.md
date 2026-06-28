# Chrome Hot Auth Loop Handoff - 2026-06-22

Scope: DeepSeek++ Chrome-hot investigation and final attach-time auth-loop fix. This is a future-reference document for what was tried, what was rejected, what proved the root cause, and what remains worth testing.

> **Document note:** This is a delegated documentation pass. The investigation, instrumentation, and patch were done by the primary session. This doc was produced by a documentation subagent consolidating that work into future-reference form. No new facts were introduced.

## Outcome

Confirmed and patched a self-sustaining auth-header refresh loop between the DeepSeek++ background service worker and the `chat.deepseek.com` content script.

The loop was active on page attach, before any prompt, and could keep both the extension service worker and the DeepSeek tab renderer hot after network activity reached zero.

Final patch files:
- `entrypoints/background.ts`
- `entrypoints/content.ts`
- `tests/background-memory-bounds.test.ts`

## Evidence Timeline

### 1. Hot process attribution changed the priority

Fact:
- Chrome Task Manager mapped hot PID `8917` to `Tab: DeepSeek answer summary - DeepSeek`.
- CPU was about 100%.
- Network was 0.
- macOS sample identified `Google Chrome Helper (Renderer) [8917]`.
- Physical footprint was about 2.4 GB, peak about 2.7 GB.
- Stack shape was renderer main-thread / Chrome V8 / JIT-style work.
- The sample did not show an obvious Pyodide, wasm, AXTree, or extension bundle-size signature.

Inference:
- The DeepSeek tab renderer was hot, not only an extension renderer.
- The first target had to be page-side code and background-to-page interaction on `chat.deepseek.com`.

Rejected:
- Treating extension bundle size or Pyodide load as the primary lead. It remained possible but no longer matched the strongest evidence.

### 2. Service worker sample proved the extension background was also hot

Fact:
- Hot service worker PID: `54368`.
- Chrome Task Manager showed `Service Worker: chrome-extension://chhlagfdfeanaefgbdbgmdlpgaoahhbi/background.js`.
- CPU was about 80%.
- Physical footprint was about 1.0 GB.
- Hot thread was `ServiceWorker thread`.
- Stack was Chrome / V8 / JIT-style work.
- The sample did not contain useful JS function names.

Inference:
- Background JS was actively doing work.
- Source attribution had to come from code inspection and runtime instrumentation, not the native sample alone.

Rejected:
- Waiting for macOS `sample` to reveal function names. It only confirmed the process and thread shape.

### 3. Fresh page with no prompt narrowed the trigger

Fact:
- A fresh logged-in `chat.deepseek.com` page with no prompt still heated both the DeepSeek tab and the DeepSeek++ service worker.
- Network was 0.
- Extension LevelDB growth was observed during earlier idle windows.

Inference:
- The issue was attach-time / page-load behavior, not only `browser_snapshot`, browser-control actions, prompt injection, response parsing, or post-response tool continuation.
- Opening `chat.deepseek.com` should do a passive attach/hello and then idle.

Rejected:
- Any hypothesis that required a user prompt, browser-control snapshot, or streaming response to reproduce.

### 4. Runtime instrumentation identified the first repeating edge

Fact:
- In an in-memory DevTools instrumentation window before the patch, over 40.8 seconds:
  - `STORE_DEEPSEEK_CLIENT_HEADERS`: 2,561 messages received by background.
  - `REFRESH_DEEPSEEK_AUTH`: 2,561 messages sent from background to tabs.
  - `storageSet`: 0 writes.

Inference:
- The hot loop was not primarily a storage-write loop.
- It was a background/content message loop running at roughly 63 cycles per second.

Accepted root-cause proof:
- The same event counts on both sides of the edge, with zero storage writes, proved the active oscillator:
  `STORE_DEEPSEEK_CLIENT_HEADERS -> REFRESH_DEEPSEEK_AUTH -> STORE_DEEPSEEK_CLIENT_HEADERS`.

## Confirmed Root Cause

Before the patch, this path could repeat indefinitely:

1. `entrypoints/background.ts`
   - `case 'STORE_DEEPSEEK_CLIENT_HEADERS'`
   - stored/remembered the headers
   - called `broadcastChatAuthStatus(sender.tab?.id)`

2. `broadcastChatAuthStatus(sender.tab?.id)`
   - called `getChatAuthStatus(preferredTabId)`

3. `getChatAuthStatus(preferredTabId)`
   - called `loadOrRefreshClientHeaders(preferredTabId)`

4. `loadOrRefreshClientHeaders(preferredTabId)`
   - with a preferred tab id, called `refreshClientHeadersFromDeepSeekTabs(preferredTabId)`

5. `refreshClientHeadersFromDeepSeekTabs(preferredTabId)`
   - sent `REFRESH_DEEPSEEK_AUTH` to the same DeepSeek tab

6. `entrypoints/content.ts`
   - `REFRESH_DEEPSEEK_AUTH` handler called `persistDeepSeekClientHeaders()`

7. `persistDeepSeekClientHeaders()`
   - sent `STORE_DEEPSEEK_CLIENT_HEADERS` back to the background
   - also sent a redundant `AUTH_STATUS_CHANGED`

That returned to step 1.

The proximate bug was not just "too many messages." It was that storing headers synchronously caused the background to refresh auth from the same tab, and that refresh made the content script store the same headers again.

## Patch

### `entrypoints/background.ts`

Changed the `STORE_DEEPSEEK_CLIENT_HEADERS` case to:
- Load previously stored headers first.
- Normalize and compare the new payload against the previous headers.
- Remember and save the headers.
- Clear sidepanel web-auth rejection after a successful save.
- Broadcast auth status only when headers actually changed.
- Call `broadcastChatAuthStatus()` without `sender.tab?.id`, so the broadcast path does not immediately refresh the originating tab.

Added helper:
- `areStoredClientHeadersEqual(current, next)`

This keeps legitimate auth-status updates working while preventing the no-op store/refresh/store cycle.

### `entrypoints/content.ts`

Changed `persistDeepSeekClientHeaders()` to stop sending the extra:

```ts
chrome.runtime.sendMessage({ type: 'AUTH_STATUS_CHANGED' })
```

after `STORE_DEEPSEEK_CLIENT_HEADERS`.

The background is now the owner of auth-status broadcasts for this path.

### `tests/background-memory-bounds.test.ts`

Added regression coverage:
- Test name: `does not refresh the DeepSeek tab again while storing fresh client headers`
- Asserts `areStoredClientHeadersEqual` exists.
- Asserts previous headers are loaded.
- Asserts `headersChanged` is computed.
- Asserts the store case calls `broadcastChatAuthStatus()` only when changed.
- Asserts the store case does not contain `broadcastChatAuthStatus(sender.tab?.id)`.
- Asserts content `persistDeepSeekClientHeaders` does not send `AUTH_STATUS_CHANGED`.

## Verification

Commands passed:

```sh
npm test -- tests/background-memory-bounds.test.ts
npm run compile
npm run build:chrome
```

Build note:
- `npm run build:chrome` emitted only the existing Pyodide externalization warnings.

Runtime verification after build/reload:
- Fresh `chat.deepseek.com` attach:
  - DeepSeek++ extension renderer candidates: 0.0%.
  - DeepSeek page: about 6-9% while settling.
- During a prompt/tool run:
  - Extension process was mostly 0.0%, with one brief 3.0% spike.
- About 60 seconds after completion:
  - Extension processes stayed 0.0%.
  - DeepSeek tab stayed around 6-9%.
  - Extension storage stayed flat at 3,196 KB except one 19-byte LevelDB log tick.

Later live spot check around 2026-06-22 03:35:50 PDT:
- DeepSeek++ extension renderers:
  - PID `96508`: 0.0%.
  - PID `74256`: 0.0%.
- Earlier DeepSeek test tab:
  - PID `74642`: 0.0%.
- Extension storage path:
  - `/Users/kyin/Library/Application Support/Google/Chrome/Profile 1/Local Extension Settings/chhlagfdfeanaefgbdbgmdlpgaoahhbi`
  - `du -sk`: 1,504 KB.
  - newest log: `000040.log`, 1,050,036 bytes, mtime Jun 22 03:34.

Passive preflight snapshot around 2026-06-22 03:42:09 PDT:
- `npm run smoke:chrome-preflight`: `GO`.
- Top Chrome processes included page renderer PID `74642` at 7.8%, GPU PID `74163` at 7.7%, browser PID `74033` at 7.0%.
- DeepSeek++ extension renderer PID `74256`: 0.0%, RSS 127 MB.
- Extension storage remained 1,504 KB.
- Newest log stayed `000040.log`, 1,050,150 bytes, mtime Jun 22 03:41:05.

## What Worked

- Chrome Task Manager process mapping. It quickly separated page renderer heat from extension renderer assumptions.
- macOS `sample`. It confirmed process/thread shape even though it did not reveal JS function names.
- Fresh-page/no-prompt reproduction. It moved the investigation away from prompt-only paths.
- In-memory DevTools counters. This was the decisive proof because it counted the repeating message edge without writing debug traces to `chrome.storage.local`.
- Keeping the patch at the first confirmed repeating edge. The fix did not require broad browser-control, Runtime Doctor, or bundle changes.
- Focused static regression test. It locks the specific shape that caused the oscillator.

## What Did Not Work

- Native samples alone did not name the JavaScript function.
- Bundle-size/Pyodide analysis was a false priority after the PID mapping changed.
- Grok was invoked but did not return a useful final result before max-turn exhaustion.
- Asking DeepSeek for broad diagnostic reports produced generic advice; it was useful as background pressure-testing, not root-cause proof.
- Looking for storage growth alone was insufficient. The final measured loop had `storageSet: 0`.

## Rejected Leads

Rejected as primary root cause:
- Pyodide / wasm execution.
- Extension bundle size.
- AXTree or accessibility-tree scanning.
- Browser-control snapshotting as the attach-time trigger.
- Runtime Doctor scanning as the immediate loop.
- Prompt injection or stream parsing as required reproduction steps.
- A pure storage write/onChanged loop.

Still possible as separate future performance work:
- Bundle-size reduction.
- Runtime Doctor scan gating.
- Browser-control snapshot rate limiting.
- Sidepanel rendering/memory work.

These are not the confirmed Chrome-hot root cause from this incident.

## Accepted Facts vs Inference vs Speculation

Fact:
- Background and DeepSeek tab were both hot.
- Fresh page attach could reproduce the heat.
- Instrumentation saw 2,561 `STORE_DEEPSEEK_CLIENT_HEADERS` and 2,561 `REFRESH_DEEPSEEK_AUTH` events in 40.8 seconds.
- Storage writes were 0 in that measurement.
- The patch stopped the observed extension CPU heat in post-build runtime checks.

Inference:
- The DeepSeek tab heat was caused or amplified by content-script participation in the background refresh loop.
- The service worker heat came from processing the repeating message path.
- Removing same-tab refresh from the store handler is the smallest safe loop break.

Speculation:
- DeepSeek's own renderer baseline may explain the remaining 6-9% page CPU seen during/after some tests.
- Some earlier LevelDB growth may have come from adjacent auth/status/storage paths, but the decisive hot loop did not require storage writes.

## Decision Ledger

Each entry covers one hypothesis evaluated during the investigation.

| Hypothesis | Status | Evidence | Consequence |
|---|---|---|---|
| Extension renderer is the primary hot process | **Rejected** | PID 8917 mapped to page renderer (Tab: DeepSeek answer summary), not extension renderer. Physical footprint ~2.4 GB, CPU ~100%. | Shifted investigation to page-side code and background↔page messaging, not extension bundle load. |
| Pyodide / wasm execution is root cause | **Rejected** | macOS sample stack did not show wasm/Pyodide signature. Idle fresh-page reproduction showed no wasm activity. | Lead closed. Marked possible future perf work but not this incident's cause. |
| Extension bundle size is root cause | **Rejected** | Hot process appeared on fresh attach with no loading/parse-phase signals in samples. | Lead closed for this incident. Bundle reduction remains valid as unrelated perf work. |
| Pure storage write loop is root cause | **Rejected** | In-memory counters over 40.8 s showed `storageSet: 0` while message counts hit 2,561. | Led to message-path instrumentation as the next investigative step. |
| Loop is attach-time; requires no user prompt | **Accepted** | Fresh logged-in page with no prompt reproduced extension SW heat (~80% CPU) and tab heat (~100% CPU) with network 0. | Narrowed the patch target to on-attach / page-load code paths. |
| Active message oscillator: `STORE_DEEPSEEK_CLIENT_HEADERS → REFRESH_DEEPSEEK_AUTH → STORE_DEEPSEEK_CLIENT_HEADERS` | **Accepted** | 2,561 counts on each side in 40.8 s (~63 cycles/sec); symmetric count proves a closed loop. | Confirmed exact loop; directed patch to the `STORE_DEEPSEEK_CLIENT_HEADERS` case in `background.ts`. |
| Removing same-tab ID from `broadcastChatAuthStatus` breaks the re-trigger | **Accepted** | Post-build runtime: extension processes 0.0% at idle; no resumed oscillation observed in spot checks. | Core patch leg; auth-status broadcast for other tabs still works. |
| Removing redundant `AUTH_STATUS_CHANGED` from `content.ts` is safe | **Accepted with follow-up** | Background is now sole owner of auth-status broadcast after store. Sidepanel-open runtime check did not restart the loop; a focused auth-status UI correctness check remains useful. | Second patch leg; prevents double-trigger from content side while preserving the intended single broadcaster. |
| Browser-control snapshotting / AXTree scanning is required for reproduction | **Rejected** | Fresh page with no browser-control action reproduced the loop. | These remain possible future perf items; not the oscillator's trigger. |

## Subagent And Advisor Notes

Carson:
- Identified duplicate content `AUTH_STATUS_CHANGED` around the `entrypoints/content.ts` persist path.
- Identified the background auth broadcast around `entrypoints/background.ts` `STORE_DEEPSEEK_CLIENT_HEADERS`.
- This matched the final patched edge.

Wegener:
- Documented inline-agent/tool path and storage trace candidates.
- Helped rule where instrumentation should be placed.

Curie:
- Performed earlier read-only review.
- Helped keep focus on MutationObserver/content cleanup and away from unproven bundle assumptions.

Oracle/advisor:
- Suspected an attach-time oscillator:
  `chat.deepseek.com load -> content/main bootstrap -> background attach/readiness/auth path -> broadcast/message listener -> repeat`.
- This was directionally correct.
- Final proof still came from local runtime instrumentation.

Grok:
- Invoked as an outside reviewer.
- Did not produce useful final output before max-turn exhaustion.

Claude:
- Used after the fix for the delegated documentation pass.
- Added the decision ledger, operational lessons, and future resume path.
- Main agent corrected one overclaim about positive-path auth-state verification after checking the doc.

## Remaining Tests

Useful next tests, in priority order:

1. Five-to-ten-minute idle soak:
   - Fresh logged-in `chat.deepseek.com`.
   - Sidepanel closed.
   - No prompt.
   - Expected: DeepSeek++ extension CPU under 1-2%, DeepSeek tab near baseline, no monotonic extension LevelDB growth.

2. Repeated tool-run/new-chat test:
   - Run the same short web-search/tool prompt two or three times in fresh chats.
   - Expected: bounded activity during the run, extension returns to 0.0% after `Agent complete`.

3. Sidepanel/settings positive-path test:
   - Open sidepanel/settings once.
   - Confirm auth status still updates.
   - Expected: no renewed `STORE_DEEPSEEK_CLIENT_HEADERS` / `REFRESH_DEEPSEEK_AUTH` loop.

4. Optional service-worker counter rerun:
   - Reinstall the same in-memory counters after the patch.
   - Expected: no repeated post-completion `STORE_DEEPSEEK_CLIENT_HEADERS` / `REFRESH_DEEPSEEK_AUTH` counts.

Do not reopen the bundle/Pyodide lead unless new runtime evidence shows repeated loading or wasm execution.

## Operational Lessons

Practical rules distilled from this incident for future Chrome-hot debugging in this codebase.

**1. PID-map before theorizing.**
Chrome Task Manager → hover each hot process → read the label. Until you know whether the heat is in the page renderer, extension renderer, or service worker, no other analysis is directionally reliable.

**2. macOS `sample` tells you process and thread shape only.**
It confirms which PID is hot and which thread is running. It will not name JavaScript functions. Use it for process attribution and then move to runtime instrumentation.

**3. In-memory DevTools counters are the right tool for message-loop proof.**
Do not write debug traces to `chrome.storage.local` — they add noise and become their own storage growth.
In the service worker DevTools console:
```js
let c = {};
chrome.runtime.onMessage.addListener((m) => { c[m.type] = (c[m.type]||0)+1; });
// wait 30-60s, then:
console.log(c);
```

**4. Reproduce without a prompt first.**
If a fresh idle page is hot, the loop is unconditional. Narrowest reproduction first.

**5. Storage growth is not sufficient evidence of a message loop.**
The decisive loop in this incident wrote nothing (`storageSet: 0`). Message counters are the right instrument.

**6. Symmetric message counts on both sides of a request/response edge fingerprint a synchronous oscillator.**
`A: 2561, B: 2561` → A triggers B triggers A.

**7. Keep auth-broadcast ownership clear.**
After this patch: `background.ts` is the owner. Content script must not independently re-broadcast auth-status changes after a `STORE_DEEPSEEK_CLIENT_HEADERS` message.

**8. Do not target bundle size or wasm unless the hot process is the extension renderer and the stack shows load/parse/compile work.**
Both leads were ruled out here before meaningful time was spent on them — but only after PID mapping.

---

## Future Resume Path

Steps to resume investigation if Chrome-hot symptom returns after this patch.

**Step 1 — Confirm which process is hot.**
Open Chrome Task Manager. Note PIDs and labels for all hot entries. Distinguish between:
- Extension service worker (`Service Worker: chrome-extension://…/background.js`)
- Extension renderer (`Extension: DeepSeek++`)
- Page renderer (`Tab: chat.deepseek.com`)

**Step 2 — Attach counters to the service worker (if it is hot).**
Go to `chrome://extensions` → DeepSeek++ → "Service Worker" → Inspect.
In the console:
```js
let c = {};
chrome.runtime.onMessage.addListener((m) => { c[m.type] = (c[m.type]||0)+1; });
```
Load a fresh idle `chat.deepseek.com` page. Wait 30–60 seconds. Print `c`.

**Step 3 — Check for oscillator resumption.**
If `STORE_DEEPSEEK_CLIENT_HEADERS` and `REFRESH_DEEPSEEK_AUTH` both show climbing symmetric counts, the oscillator has resumed.

**Step 4 — Verify patch is still in place.**
In `entrypoints/background.ts` `STORE_DEEPSEEK_CLIENT_HEADERS` case:
- `areStoredClientHeadersEqual` is present and called.
- `broadcastChatAuthStatus()` is called **without** `sender.tab?.id` (unconditional tab-id is the regression).

In `entrypoints/content.ts` `persistDeepSeekClientHeaders`:
- No `chrome.runtime.sendMessage({ type: 'AUTH_STATUS_CHANGED' })` immediately after `STORE_DEEPSEEK_CLIENT_HEADERS`.

**Step 5 — Run regression test.**
```sh
npm test -- tests/background-memory-bounds.test.ts
```
All assertions must pass. A test failure here means the patch regressed.

**Step 6 — If patch is intact but loop resumed.**
A new entry point introduced the oscillator. Expand counters to all message types:
```js
chrome.runtime.onMessage.addListener((m) => { c[m.type] = (c[m.type]||0)+1; });
```
Look for any new pair with symmetric counts.

**Step 7 — If hot process is the page renderer, not the extension.**
The extension-side fix is not the cause. Investigate DeepSeek's own page code or a new content-script injection loop that runs unconditionally at attach time.

---

## Do Not Regress

- Do not restore `broadcastChatAuthStatus(sender.tab?.id)` inside `STORE_DEEPSEEK_CLIENT_HEADERS`.
- Do not make auth-status broadcast unconditional after every header store.
- Do not re-add content-side `AUTH_STATUS_CHANGED` immediately after `STORE_DEEPSEEK_CLIENT_HEADERS`.
- Do not write debug traces to `chrome.storage.local` for this class of investigation.
- Do not use storage growth alone as proof of this loop; message counters were the decisive evidence.
- Do not claim repo tests alone prove Chrome runtime behavior. Keep runtime CPU/storage checks separate from static/build checks.
