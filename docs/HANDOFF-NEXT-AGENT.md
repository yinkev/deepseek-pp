# Handoff for next agent — DeepSeek++ / ENI / bridge

**Date:** 2026-07-10 (evening — post FREEZE + upstream merge)  
**Repo (ONLY):** `/Users/kyin/Projects/deepseek-pp`  
**Branch:** `main` — **committed** (`bcf7aaf` bridge + `09ee70c` upstream merge)  
**Git:** 6 commits ahead of `fork/main` (local machine OK; not pushed)  
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

**As of 2026-07-10 evening:** P0–P25 FREEZE verified. Host vault **5** accounts; wipe-on-40003 **fixed**; Hermes ENI + CPA completions **green**; smoke matrix **PASS**.

### Verified live

```bash
curl -s http://127.0.0.1:8787/v1/health
# ready:true, accountCount:5, lastJob populated

curl -sS -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' -H 'X-DPP-Client: hermes' \
  -d '{"model":"ds/eni","messages":[{"role":"user","content":"say only: hi"}],"stream":false,"reset_thread":true}'
# 200 + content; x-dpp-account-id header set
```

### If 40003 recurs

- **Do not** delete vault slots — `markAccountAuthFailed` + cooldown only
- Host ignores `vault_remove`
- Re-capture from live tab or wait cooldown; optional future: page-context fetch

### Health alone is not enough

`ready:true` + `hasLogin:true` does not prove token validity. Use completion probe or `node scripts/bridge-smoke.mjs --quick`.


## 5. Multi-account (shipped)

**SoT:** host disk `~/Library/Application Support/DeepSeek++/CursorBridgeHost/account-vault.json`  
**Cache:** `chrome.storage.local` `cursorBridgeAccountVault` (sync from host snapshot)  
**Capture:** upsert on header capture from tabs; 5 accounts live on this machine  
**Pick:** `pickAccountForJob` with cooldown exclude; sticky pins account; hermes/eni no rotate by default  
**40003:** soft-fail only — never delete slots

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

1. Reload extension from `/Users/kyin/Projects/deepseek-pp/dist/chrome-mv3` after any rebuild
2. `node scripts/bridge-smoke.mjs --quick` after host/extension changes
3. Optional: page-context fetch for even tighter cookie parity (deferred)
4. `git fetch origin` + `git merge origin/main` when zhu updates (see UPSTREAM_UPDATE.md)
5. Push to `fork` only if you want GitHub backup

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
