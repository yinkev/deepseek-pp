# Goal: Multi-account host vault + page-context DeepSeek

**Status:** active  
**Date:** 2026-07-10  
**Repo:** `/Users/kyin/Projects/deepseek-pp` only  
**Related:** [browser-origin-cursor-api](./browser-origin-cursor-api.md), [ds2api vs browser-origin](../decisions/2026-07-10-ds2api-vs-browser-origin.md)

## Objective

Deliver durable **multi-account DeepSeek web logins** for the cursor bridge without Chrome multi-profile babysitting or headless token reverse (ds2api-class):

1. **Host disk vault** is the shared source of truth for account tokens (survives profile/extension reloads; any connected extension can push/pull).
2. **Tabs remain optional.** Cached host/extension vault tokens can run jobs with no DeepSeek tab open. Page-context execute is a later optional optimization when a matching tab happens to be open — never a readiness gate.
3. **Auth failures (40003)** drop only the dead slot and rotate; live capture never wipes other slots.

### Done when (evidence)

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Host persists vault on disk | File under CursorBridgeHost data dir; survives host restart |
| 2 | Capture upserts to host | After login + page message, vault grows without clearing siblings |
| 3 | Health merges host + extension | `GET /v1/health` → `readiness.accountCount` ≥ vault size; accounts list includes labels |
| 4 | Job pick uses host vault | Unpinned jobs can rotate when `accountCount > 1`; sticky pin still wins mid-thread |
| 5 | Tabs not required | Readiness ready with hasLogin from vault even when hasDeepSeekTab=false |
| 6 | 40003 surgical drop | Dead account removed only; other slots remain; retry once with exclude |
| 7 | Unit tests green | `vitest` for host vault pure logic + account-vault + page transport message shape |
| 8 | No ds2api | Host still never calls `chat.deepseek.com` |

### In scope

- Host-side vault file + native protocol (`vault_*`)
- Extension push on capture + pull before jobs/readiness
- (Deferred) Page-context fetch relay — not required for multi-account v1
- Worker/runtime wiring; docs/handoff update

### Out of scope

- ds2api / headless TLS fingerprint clients
- Official DeepSeek API multi-key
- Full multi-profile auto-launcher / second Chrome automation
- UI account manager (labels via capture order is enough for v1)
- Synthetic “Reply OK” health chat spam

## Architecture (locked)

```text
Hermes/Cursor → host :8787
                 ├─ account-vault.json  (host disk, multi-account SoT)
                 └─ native port → extension
                                   ├─ chrome.storage vault (cache/mirror)
                                   └─ chat.deepseek.com tab (page-context fetch when match)
```

**Hard rules**

1. Host process never calls DeepSeek website servers.
2. Live capture upserts only; never wipe vault on capture.
3. Prefer page-context when a tab’s live token matches selected account; else SW + vault headers.
4. Working tree only this repo; load unpacked `dist/chrome-mv3`.

## Stop conditions (ask human)

- DeepSeek changes auth so page token + cookies cannot run bridge jobs.
- Native messaging cannot carry vault size needed for N accounts (then chunk/protocol redesign).
- User wants multi-profile automation (separate product decision).

## Autonomy

Continue implementation phases without re-asking unless a stop condition hits. User already approved final vision (“ok go make no mistakes”).
