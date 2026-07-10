# Goal: Browser-origin Cursor API via DeepSeek++

**Status:** active  
**Date:** 2026-07-09  
**Owner:** local fork work on `/Users/kyin/Projects/deepseek-pp` only  
**Feature branch:** `local/browser-origin-api`

## Objective

Deliver a **local OpenAI-compatible API** that Cursor reaches through CLIProxyAPI, where every DeepSeek completion is executed **browser-origin** by DeepSeek++ on a logged-in `chat.deepseek.com` Chrome tab — never via official DeepSeek API and never via headless token reverse (ds2api-class).

### Done when (evidence)

1. `GET http://127.0.0.1:<bridge-port>/v1/models` returns at least one DeepSeek model id when bridge + extension + tab are ready.
2. `POST /v1/chat/completions` (stream + non-stream) with a normal human prompt returns assistant text; DeepSeek network traffic is from the **browser page context** (not a Node/Go process calling chat.deepseek.com with an exported token alone).
3. CLIProxyAPI `openai-compatibility` can point at that bridge; Cursor can select the model and receive a streamed reply.
4. Bridge refuses cleanly when Chrome tab / DeepSeek++ / login is missing (structured error; no silent fallback to official API or headless web reverse).
5. Upstream DeepSeek++ pulls do not delete this feature when the documented fork merge workflow is followed.

### In scope

- Local OpenAI-compatible surface: `/v1/models`, `/v1/chat/completions` (stream).
- DeepSeek++ job intake + page-origin completion using existing web adapter / page fetch path.
- CLIProxyAPI wiring notes only (provider row pointing at the bridge).
- Fork/upstream survival strategy for this work.

### Out of scope

- Official DeepSeek API.
- Rebuilding ds2api or any headless web reverse that only reuses `userToken` outside the browser.
- Full tool-calling / vision parity in v1.
- Synthetic health-check prompts (`Reply exactly OK`, etc.).
- Shipping this feature into upstream `zhu1090093659/deepseek-pp` unless explicitly requested later.

## Architecture (locked)

```text
Cursor
  → CLIProxyAPI
    → local bridge (OpenAI-compatible HTTP)
      → DeepSeek++ (extension)
        → logged-in chat.deepseek.com tab
          → DeepSeek website
```

**Hard rule:** the process that talks to DeepSeek website servers must be the **browser page / extension path**, same class as normal DeepSeek++ usage.

## Hard rules

1. Working tree for all product work: **only** `/Users/kyin/Projects/deepseek-pp` (no second worktree for this feature).
2. No official DeepSeek API. No headless token reverse. No reintroduce of ds2api “temporarily.”
3. No secrets in the repo.
4. Prefer isolated packages over editing hot upstream files.
5. Never force-push to `origin` (upstream). `origin` push may be disabled.
6. Do not implement live DeepSeek completion tests as “proof” of this goal doc alone.

## Stop conditions (ask human)

- Account still suspended / unusable in normal browser chat.
- Implementation would require exporting tokens for a non-browser HTTP client to call DeepSeek web.
- Upstream architecture makes page-origin completion impossible without large invasive forks (re-evaluate approach).
- Any irreversible account/config change outside this repo and local CLIProxyAPI bridge notes.

## Autonomy

Agents **continue phases without re-asking** unless a stop condition hits. Phase checkboxes are the shared ledger; update them when evidence exists. Oracle/advisors are non-authoritative; verify against repo and tests.

## Upstream survival

| Practice | Why |
|---|---|
| `origin` = upstream (push disabled) | Safe pull-only |
| `fork` = `yinkev/deepseek-pp` | Durable remote for local branches |
| Feature branch `local/browser-origin-api` | All bridge commits live here |
| New modules over hot-file edits | Fewer merge conflicts |
| Thin hooks only in background/entrypoints | Survive `origin/main` merges |

### Isolated placement (required)

- `packages/cursor-bridge-host/` — native host / local HTTP server (OpenAI surface)
- `core/cursor-bridge/` — job queue types, protocol, errors (extension side)
- Background/entrypoints: **minimal** registration hooks only
- This file: long-horizon goal

### Merge workflow

```bash
cd /Users/kyin/Projects/deepseek-pp
git fetch origin
git checkout local/browser-origin-api
git merge origin/main
# resolve conflicts only at thin hook points
npm test
npm run compile
```

If conflicts explode: re-apply portable packages on a fresh branch from new `origin/main`; do not force-push over upstream history.

## Implementation phases

### Phase 0 — cleanup

- [x] Stop ds2api process / free port 8327
- [x] Delete `/Users/kyin/Projects/ds2api-activer007` (absent or removed)
- [x] Remove CLIProxyAPI ds2api binaries/scripts/logger/run state if present
- [x] Remove CLIProxyAPI `DeepSeekWeb` provider / `:8327` routes from live `config.yaml`
- [x] Remove ds2 worktree `deepseek-pp-ds2api-integration` and prune worktrees
- [x] Delete local ds2/sidecar branches if present
- [x] Checkpoint pre-upstream local commits on durable branches; push to `fork` when possible
- [x] Align local `main` to `origin/main`
- [x] Create `local/browser-origin-api` from latest `main` with this goal doc

### Phase 1 — design freeze

- [x] Choose transport: Native Messaging host HTTP vs extension-local only (default: **native host HTTP** on localhost; extension as worker)
- [x] Define job schema: request id, messages, model, stream flag, error codes
- [x] Define readiness: tab present, logged in, extension alive

### Phase 2 — vertical slice

- [x] `/v1/models` readiness-aware
- [x] Non-stream completion browser-origin
- [x] Stream completion
- [x] CLIProxyAPI provider row (disabled until healthy) — documented in docs/cursor-bridge-try-it-out.md

### Phase 3 — hardening

- [x] Missing-tab / missing-login errors
- [x] Concurrency policy (single flight vs queue) — single-flight busy 503
- [x] No synthetic probe prompts in docs/scripts
- [ ] Upstream merge dry-run documented with evidence

## Non-goals reminder

This is **not** “add API base URL settings that point sidepanel chat at a sidecar.” That was the rejected ds2api integration path.

## Related paths

| Path | Role |
|---|---|
| `/Users/kyin/Projects/deepseek-pp` | **Only** working tree for this goal |
| `packages/cursor-bridge-host`, `core/cursor-bridge` | Implemented isolated bridge packages |
| `/Users/kyin/cliproxyapi` | CLIProxyAPI runtime; DeepSeekWeb/:8327 removed from live config |
| `packages/shell-host` | Existing native messaging pattern to learn from — not for headless DeepSeek web |

## Success metric (one line)

Cursor streams a real DeepSeek answer through CLIProxyAPI while DeepSeek++ + Chrome tab own the website call — and upstream pulls cannot silently delete the bridge packages if the merge process is followed.
