# Roadmap — after v1 browser-origin Cursor API

Zoomed-out forecast / fix suggestions. Not committed work items.

## Near term (stability)

1. **Host lifecycle** — keep HTTP server alive across extension SW sleeps (today host exits when native port closes; SW reconnect relaunches it). Consider a small always-on companion process if Cursor traffic is bursty.
2. **Single-flight queue** — fair queue with timeout instead of hard busy 503 when two Cursor requests overlap.
3. **Status UI** — tiny sidepanel badge: bridge connected / tab ready / last error (no secrets).
4. **CLIProxyAPI health gate** — document or script that disables the provider row when `/health` is not ready (avoid Cursor hanging).

## Mid term (product)

1. **Multi-turn sessions** — map OpenAI conversation ids to one DeepSeek `chat_session_id` instead of a fresh session per request.
2. **Reasoning stream** — expose thinking tokens as OpenAI `reasoning` / separate channel when model is `deepseek-web-thinking`.
3. **Optional memory/skills injection** — flag on the job to reuse sidepanel augmentation (off by default for Cursor agent prompts).
4. **Tool-call passthrough** — later; out of scope for v1.

## Hard constraints (do not break)

- Never official DeepSeek API for this path
- Never headless token reverse (ds2api-class)
- Keep packages isolated (`core/cursor-bridge`, `packages/cursor-bridge-host`) so `git merge origin/main` stays thin-hook only
- No secrets in repo / docs

## Upstream survival checklist

```bash
git fetch origin
git checkout local/browser-origin-api
git merge origin/main
npm test
npm run compile
```

If `background.ts` conflicts: re-apply only the `startCursorBridgeRuntime(...)` block.

## Success metric still

Cursor streams a real DeepSeek answer while the browser tab owns the website call.
