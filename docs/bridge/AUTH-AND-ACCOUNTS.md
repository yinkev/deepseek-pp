# Auth, no-tab, multi-account

## Related decision (ban risk)

Headless reverse proxies (ds2api-class) are **out of scope and rejected**. See [../decisions/2026-07-10-ds2api-vs-browser-origin.md](../decisions/2026-07-10-ds2api-vs-browser-origin.md).

## How login is supposed to work

1. User is logged into `chat.deepseek.com` in Chrome.
2. DeepSeek++ main-world hook sees chat API requests with `Authorization: Bearer …`.
3. Content script persists headers to:
   - `deepseekCachedClientHeaders` (legacy single slot)
   - `cursorBridgeAccountVault` (multi-account upsert by token fingerprint)
4. Bridge worker uses those headers for `createChatSession` / PoW / completion from the **extension service worker**.

## No-tab mode

| Before | After (intended) |
|--------|------------------|
| `ready` required open DeepSeek tab | `ready` = hasLogin && !busy |
| missing_tab hard error | Tab optional; used to refresh auth |

User can close DeepSeek tabs if a valid token is cached. **If token is dead, still fails** — tab helps recapture.

## Multi-account vault (`account-vault.ts`)

| Behavior | Design |
|----------|--------|
| Upsert by fingerprint of Bearer | Same token updates; new token new slot |
| Max accounts | 8 |
| Sticky | Thread stores `accountId` so mid-conversation doesn’t hop |
| Default pick | Freshest `updatedAt` (rotate is opt-in; RR was dangerous) |
| `markAccountUsed` | Must **not** rewrite live legacy cache with stale vault slot |

Health may expose:

```json
"accountCount": 2,
"accounts": [{ "id": "ds-…", "label": "primary", "useCount": N }]
```

## P0 failure (2026-07-10) — documented for real

### Symptom

```text
DeepSeek auth token was rejected while creating chat session
{"code":40003,"msg":"Authorization Failed (invalid token)"}
```

- Hermes ENI broken
- Direct `curl` to `:8787` chat completions also fails
- **Website chat works** with tab open
- Health often shows `ready: true`, `hasLogin: true`, `accountCount: 2`

### Root cause class

Bridge trusts a **cached Authorization string** and calls DeepSeek APIs from the **service worker**.  
Page uses **current session** (and possibly different cookie/token pairing).

Contributing bugs we introduced or worsened:

1. Round-robin onto dead vault slots
2. `markAccountUsed` overwriting live legacy with stale primary (fixed in code intent; not proven E2E green)
3. `createClientHeaders` preferring in-memory remembered headers over page `userToken` (patched for content path)
4. Sticky `accountId` pinning dead logins
5. Dual worktree / wrong dist load (resolved by single folder)

### What is NOT the problem

- Hermes API key for CLIProxyAPI (error text is DeepSeek web 40003)
- ENI system prompt content
- Missing DeepSeek tab alone (health already shows tab + login)

### Fix directions (pick one and prove with curl)

1. **Page-context execution:** create session / PoW / stream via content script or MAIN world fetch on open DeepSeek tab (same origin as working UI).
2. **Strict live capture:** every job refresh from tab; validate token with a cheap authenticated call; drop 40003 accounts; never RR without validate.
3. **Clear vault + recapture:** temporary recovery — wipe vault keys, one clean login, single account until validate-before-use exists.

### Required verification

```bash
# insufficient alone
curl -s http://127.0.0.1:8787/v1/health

# required
curl -sS -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'X-DPP-Client: hermes' \
  -d '{"model":"ds/eni","messages":[{"role":"user","content":"say only: hi"}],"stream":false,"reset_thread":true}'
```

## Storage keys

- `deepseekCachedClientHeaders`
- `cursorBridgeAccountVault`
- Thread sticky: `cursorBridgeThreadStore` → `accountId` field

## Operator recovery (temporary)

1. Load unpacked: `/Users/kyin/Projects/deepseek-pp/dist/chrome-mv3` only
2. Reload extension
3. On working DeepSeek tab send a short message
4. Retry completion probe
5. If still 40003: treat as code bug (page-context path), not user error

## Hidden footguns

1. **CORS allow-headers** on host may not include `x-dpp-account` yet — fine for Hermes/CLI; breaks browser-js callers until updated.
2. **Health ≠ valid token** — always completion-probe.
3. **Title jobs** must stay short-circuited on host or twin empty chats return.
4. **Hermes autonomic-loop plugin** re-injects bureaucracy independent of bridge strippers.
5. **Wrong Chrome load path** (historical worktree dist) looks like “reload did nothing.”
6. **Service worker fetch** may not share tab cookie/token pairing — root of 40003 investigation.

## Host-disk vault (2026-07-10) — current

**Source of truth:** `~/Library/Application Support/DeepSeek++/CursorBridgeHost/account-vault.json`  
**Extension chrome.storage** is a cache. Capture **upserts only**.

**Hard rules (enforced in code):**

1. Live capture never wipes sibling slots.
2. **40003 never deletes vault slots** (worker retries other slots with exclude; host ignores `vault_remove`).
3. Tabs optional for jobs once a token is cached.
4. Token fingerprint (`ds-…`) changes when user re-logs; treat as new slot, keep old until operator cleans.

**Progress + live map:** [MULTI-ACCOUNT-PROGRESS-2026-07-10.md](./MULTI-ACCOUNT-PROGRESS-2026-07-10.md)  
**Goal:** [../goals/multi-account-host-vault-page-context.md](../goals/multi-account-host-vault-page-context.md)

**Operator passwords:** local only `CursorBridgeHost/accounts-private.local.md` (mode 600, outside git).
