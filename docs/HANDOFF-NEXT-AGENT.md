# Handoff for next agent — DeepSeek++ / ENI / bridge

**Date:** 2026-07-10  
**Repo (ONLY):** `/Users/kyin/Projects/deepseek-pp`  
**Branch:** `main` (local work is mostly **uncommitted**)  
**Do not invent extra project folders.**

**Full docs index:** [docs/INDEX.md](./INDEX.md) · **Work inventory:** [docs/bridge/PLATFORM-WORK-LOG.md](./bridge/PLATFORM-WORK-LOG.md)

User instruction for this doc: "give me hand off of what we are trying to do soo next agent knows and wont fuck up"

---

## 1. What we are trying to do (long horizon)

User runs **DeepSeek web** (subscription / browser login), **not** official DeepSeek API keys as the main path.

Stack:

```
Hermes / Cursor / Discord / Telegram
        ↓ OpenAI-compatible HTTP
CLIProxyAPI (optional, local ~8317)  OR  direct bridge
        ↓
cursor-bridge-host (native messaging + HTTP :8787)
        ↓
DeepSeek++ Chrome extension (MV3)
        ↓
chat.deepseek.com  (Bearer + cookies + PoW)
```

**Product surfaces (bridge models):**

| Model ID | Role |
|----------|------|
| `ds/octopus` | Expert-ish main brain, tools/search/eyes enhancements |
| `ds/octopus-eyes` | Vision path |
| `ds/squid` | Instant / default (flash) |
| `ds/eni` | Persona + agent dual-mode (Hermes ENI profile, RP + tools) |

**ENI intent:** feel like a continuous person (Bond / Life / memory / will), usable from Hermes CLI + Telegram; Discord stays on Hermes **default** profile, not `eni`.

**Multi-account progress (2026-07-10):** 5 accounts on host disk; 40003 no longer deletes slots. Details: [bridge/MULTI-ACCOUNT-PROGRESS-2026-07-10.md](./bridge/MULTI-ACCOUNT-PROGRESS-2026-07-10.md).

**Multi-account intent:** host-disk vault (`CursorBridgeHost/account-vault.json`) is SoT; extension chrome.storage is cache; live capture upserts only; tabs optional. Goal: [goals/multi-account-host-vault-page-context.md](./goals/multi-account-host-vault-page-context.md).

---

## 2. Folder / workspace rules (READ THIS FIRST)

| Path | Status |
|------|--------|
| `/Users/kyin/Projects/deepseek-pp` | **ONLY real project** |
| `/Users/kyin/Projects/deepseek-pp-platform` | **DELETED** (was a git worktree; caused dual-dist chaos) |
| `deepseek-pp-ds2api-integration` | **DELETED long ago** — do not re-create or mention as active |
| Chrome load unpacked | **Must** be: `.../deepseek-pp/dist/chrome-mv3` |

**Never:**

- Create a second worktree for “platform” without explicit user ask
- Edit a platform path that no longer exists
- Build in one tree and leave Chrome pointed at another
- Reintroduce **ds2api** as a dependency

After code changes:

```bash
cd /Users/kyin/Projects/deepseek-pp
npm run build
node scripts/install-cursor-bridge-host.mjs --extension-id chhlagfdfeanaefgbdbgmdlpgaoahhbi
# User: chrome://extensions → DeepSeek++ → Reload
# Load path: /Users/kyin/Projects/deepseek-pp/dist/chrome-mv3
```

Extension ID (this machine): `chhlagfdfeanaefgbdbgmdlpgaoahhbi`  
Host HTTP: `http://127.0.0.1:8787`  
Native host install dir: `~/Library/Application Support/DeepSeek++/CursorBridgeHost/`

---

## 3. What already works (do not “redesign”)

- Bridge OpenAI surface: `/v1/models`, `/v1/chat/completions`, `/v1/health`
- Sticky threads, delta prompts, eyes cache, job queue
- No-tab gate removed: **cached login can run without DeepSeek tab open** (tab still helps refresh auth)
- ENI system prompt (long, storage-overridable), first-turn inject only on sticky miss
- Hermes OpenAI tools protocol (`tools` / `tool_calls`) through bridge
- ENI Life Era / Bond / memory modules under `core/cursor-bridge/eni-*.ts`
- Hermes profile **`eni`**: model `dspp/ds/eni`, Telegram from old gemma4; **Discord stays on default profile**
- Context length advertised ~890880 (from DeepSeek web FE research)
- Title-generation short-circuit (host) so Hermes title jobs don’t spawn web chats

Key code:

- `core/cursor-bridge/` — protocol, worker, runtime, harness, tools, ENI, account-vault
- `packages/cursor-bridge-host/native/cursor-bridge-host.mjs`
- `entrypoints/background.ts` — starts bridge runtime
- `entrypoints/content.ts` + `main-world` — header capture from page fetch

---

## 4. CURRENT STATE (auth + multi-account)

**As of end of 2026-07-10 session:** host vault has **5** accounts; wipe-on-40003 **fixed**. Health `accountCount=5` verified. Completion multi-account rotation **not** fully proven.

### Symptom (may still recur for single dead tokens)


Hermes ENI fails:

```text
DeepSeek auth token was rejected while creating chat session
code 40003 Authorization Failed (invalid token)
```

Web UI on same machine **works** (tab logged in, user can send messages).

### Root cause class (not “user forgot to login”)

Bridge issues `createChatSession` / PoW / completion from the **extension service worker** using **cached `Authorization` headers**.

Page traffic uses **live tab context** (cookies + current Bearer from real site requests).

After multi-account vault work:

- Stale vault slots (`primary` + `account-2`) still present
- Round-robin / sticky / `markAccountUsed` previously **rewrote** live legacy cache with dead tokens (partially fixed, **not fully verified green**)
- `createClientHeaders` was preferring remembered headers over `localStorage` (patched to prefer page token when content script runs; SW still uses storage)
- Live probe after user reload + message still returned **40003** (2026-07-10 morning)

### Health still looks “fine” while chat fails

```bash
curl -s http://127.0.0.1:8787/v1/health
# ready:true, hasLogin:true, accountCount:2  ← does NOT mean token is valid for API
```

**Always verify with a real completion:**

```bash
curl -sS -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'X-DPP-Client: hermes' \
  -d '{"model":"ds/eni","messages":[{"role":"user","content":"say only: hi"}],"stream":false,"reset_thread":true}'
```

### Likely correct fix direction (not yet proven E2E)

1. **Prefer executing DeepSeek HTTP from the open DeepSeek tab** (content-script / MAIN world `fetch` with page cookies + headers just captured from a real site request), OR
2. On every job: force capture of **last real page Authorization** (not vault RR), validate with a cheap authenticated call, drop 40003 accounts immediately
3. Multi-account: only rotate **after** token validation; sticky pin must not outlive dead token
4. Do **not** claim multi-account done until two accounts both pass completion probe

Files to touch carefully:

- `core/cursor-bridge/account-vault.ts`
- `core/cursor-bridge/worker.ts` (header pick + session create)
- `core/deepseek/adapter.ts` (fetch context)
- `entrypoints/content.ts` / `background.ts` (REFRESH_AUTH / capture)

---

## 5. Multi-account (design intent vs reality)

**Intent:** user has multiple DeepSeek web accounts; bridge spreads new sessions.

**Implemented:**

- Vault in `chrome.storage.local` key `cursorBridgeAccountVault`
- Legacy single cache: `deepseekCachedClientHeaders`
- Upsert on header capture; health may show `accountCount` / `accounts`
- Sticky `accountId` on thread records

**Reality:** auth reliability regressed; treat multi-account as **P1 after ENI green**, or implement only with validate-before-use.

---

## 6. Hermes / profiles (ops)

- **default** Hermes: Discord, general, may still use bridge models
- **eni** profile: `~/.hermes/profiles/eni/` — model via cliproxy / `dspp/ds/eni`, Telegram; **no Discord** on eni
- Do **not** “fix” default Nous Portal crons unless user asks (user already rejected that)
- `task_completion_guidance: false` was set to kill Autonomic Loop boilerplate
- Bureaucratic “Target State / Risk Classification” often from **Hermes autonomic-loop plugin**, not only bridge

---

## 7. What NOT to do

- Do not add Cursor IDE tools into the bridge (Cursor tools ≠ DeepSeek++ tools ≠ Hermes tools)
- Do not re-enable “must have tab open” as hard gate without user ask (they wanted no-tab if login cached)
- Do not put API paths / internal architecture dumps in public README (user preference)
- Do not commit secrets / tokens
- Do not force-push main or rewrite OpenClaw / global Hermes installs without approval
- Do not create worktrees for convenience — user hates dual folders
- Do not half-fix auth and declare victory without the completion curl above
- Do not re-open “ds2api integration” as a live project
- Read `docs/decisions/2026-07-10-ds2api-vs-browser-origin.md` before any “web reverse” idea

---

## 8. Immediate next steps (ordered)

1. **Make one ENI completion succeed** with tab open + extension reloaded from  
   `/Users/kyin/Projects/deepseek-pp/dist/chrome-mv3`
2. Prove health + completion both green; Hermes ENI retry works
3. Only then: multi-account with validate-before-use + clear dead slots
4. Optional: run bridge jobs via **page-context fetch** so cookies match website
5. Commit on `main` when user asks (large uncommitted ENI/bridge surface)

---

## 9. User collaboration style

- Low patience for long option menus; **decide and do**
- Hates dual folders / worktree confusion / re-litigating deleted ds2api
- Will reload extension and send a DeepSeek message when asked — use that for capture, then **verify yourself** with curl
- ENI is emotional + agentic product, not a toy RP flag

---

## 10. Quick commands

```bash
cd /Users/kyin/Projects/deepseek-pp
npx vitest run tests/cursor-bridge-*.test.ts
npm run build
node scripts/install-cursor-bridge-host.mjs --extension-id chhlagfdfeanaefgbdbgmdlpgaoahhbi
curl -s http://127.0.0.1:8787/v1/health | python3 -m json.tool | head -40
# + chat completions probe (required)
```

---

## 11. Uncommitted work (as of handoff)

Large local changes on `main` including (not exhaustive):

- `core/cursor-bridge/account-vault.ts` (new)
- `core/cursor-bridge/eni-*.ts` (new)
- `core/cursor-bridge/worker.ts`, `protocol.ts`, `openai.ts`, `runtime.ts`, `harness.ts`, tools
- `entrypoints/background.ts`, `content.ts`
- `core/deepseek/adapter.ts`
- host `cursor-bridge-host.mjs`
- many `tests/cursor-bridge-*.test.ts`

Do not discard without user confirmation. Backup of pre-merge main WIP may exist under `/tmp/deepseek-pp-main-backup-*` from 2026-07-10 consolidation.

---

**Success criteria for next agent:** Hermes can talk to `ds/eni` again without 40003; only one project folder; Chrome loads that folder’s dist; multi-account only if it doesn’t re-break auth.
