# Chrome Runtime Smoke Gate

Use this before the real Chrome sidepanel smoke from the handoff. It is passive: it reads `ps` output and does not attach DevTools, click Chrome, reload tabs, or send a sidepanel prompt.

```bash
npm run smoke:chrome-preflight
```

The command returns:

- exit `0`: `GO`; Chrome is cool enough to run the live sidepanel smoke.
- exit `2`: `NO-GO`; do not drive Chrome yet.
- exit `1`: preflight script or argument failure.

Default no-go thresholds:

- main Chrome process at or above `80%` CPU
- page renderer at or above `50%` CPU
- extension renderer at or above `25%` CPU

Default memory warning thresholds:

- main Chrome process at or above `8192 MB` RSS
- page renderer at or above `2048 MB` RSS
- extension renderer at or above `1024 MB` RSS

Memory warnings do not change the exit code by themselves. They are evidence to record before blaming extension memory or running deeper Chrome Task Manager / service-worker lifetime checks.

For machine-readable output:

```bash
npm run smoke:chrome-preflight -- --json
```

Current local gate evidence from 2026-06-22:

- `npm test -- tests/tool-parser.test.ts tests/streaming-tool-text.test.ts tests/xml-tool-stream-filter.test.ts tests/history-cleanup.test.ts tests/streaming-tool-call-parser.test.ts tests/tool-block-style.test.ts tests/browser-control.test.ts tests/deepseek-adapter-stream.test.ts tests/deepseek-web-vision.test.ts tests/background-memory-bounds.test.ts tests/sidepanel-chat-attachments.test.ts tests/inline-agent-loop.test.ts tests/read-history-snapshot.test.ts tests/chrome-runtime-preflight.test.ts` passed: 14 files, 186 tests.
- `npm run compile` passed.
- `npm run build:all` passed.
- `npm run verify:extension-utf8` passed.
- `npm run verify:manifest-policy` passed.
- Built `dist/chrome-mv3/manifest.json` uses `optional_host_permissions: ["<all_urls>"]`.
- Built `dist/chrome-mv3/content-scripts/main-world.js` and `dist/chrome-mv3/content-scripts/content.js` contain the plain `<tool_calls>` wrapper parser/filter markers.

When the preflight returns `GO`, run the handoff smoke in the existing real Chrome session with the unpacked extension from `dist/chrome-mv3`:

> I'm on this page. Read the visible answer and tell me the main point in one sentence.

Expected result:

- compact DeepSeek Web status disclosure while working
- no raw XML or JSON tool payloads in the chat, including `<browser_snapshot>`, `<task_complete>`, and `<tool_calls><invoke ...>`
- final disclosure does not remain stuck on `Using ... tools`
- send button unlocks after completion
- Chrome remains cool after the answer, especially the page renderer and extension renderer under the preflight thresholds above

If the preflight returns `NO-GO`, record the top process evidence and treat the live smoke as blocked. Do not replace the real Chrome check with a fresh Playwright tab.
