# Platform work log — what we actually built

**Scope:** Browser-origin OpenAI bridge + ENI + Hermes daily driver  
**Repo:** `/Users/kyin/Projects/deepseek-pp`  
**Status of git:** committed on `main` as of 2026-07-10 (`bcf7aaf` + upstream merge `09ee70c`); 6 ahead of `fork/main`  
**Do not confuse with:** deleted `deepseek-pp-platform` worktree, deleted ds2api integration

This document is the inventory of work so there is no ambiguity about what shipped vs what is broken.

---

## North star

1. Use **DeepSeek website login** (subscription), not official API pay-as-you-go as the primary path.
2. Expose OpenAI-compatible models to **Cursor, Hermes, Discord, Telegram**.
3. Keep sticky web sessions, tools where they belong, and **ENI** as a continuous persona + agent.
4. Survive upstream DeepSeek++ merges without losing fork work.

---

## Explicitly out of scope / rejected

| Item | Why |
|------|-----|
| **ds2api** headless proxy as main path | User purged; use extension + web session |
| Bridge implementing **Cursor IDE tools** | Cursor tools stay in Cursor; bridge is DeepSeek brain (+ DPP tools / OpenAI tools protocol) |
| Multi-agent “swarm” inside the bridge | Harness concern (Hermes/Cursor), not bridge |
| Public README exposing `/api/v0/...` | User README style: features only |
| Dual worktrees / dual dist folders | Caused wrong-extension load; removed 2026-07-10 |
| “Fixing” default Hermes Nous crons without ask | User stopped that work |

---

## Phase inventory

### A. Browser-origin bridge foundation (P0–P4 era)

| Deliverable | Location / notes |
|-------------|------------------|
| OpenAI HTTP surface via native host | `packages/cursor-bridge-host/native/cursor-bridge-host.mjs` port **8787** |
| Extension job runner | `core/cursor-bridge/worker.ts`, `runtime.ts` |
| Models: octopus / octopus-eyes / squid | Renamed from deepseek-web* |
| Sticky threads | `thread-store.ts` — `chatSessionId`, `parentMessageId`, TTL, turn cap |
| Delta prompts on sticky | `messagesToPrompt` sticky path |
| Eyes as tool | Vision subcall → notes inject for expert path |
| Eyes cache | image hash → notes |
| Job queue on host | FIFO instead of hard busy 503 |
| Client profiles | Cursor / Hermes / generic detection |
| SSE robustness | SET/BATCH, CRLF, opening-token repair |
| Context length | ~**890880** from FE research (not 128k guess) |
| Health features flags | `/v1/health` |

### B. Tools (two stacks — do not merge them)

| Stack | Who executes | Bridge role |
|-------|--------------|-------------|
| **DeepSeek++ runtime tools** | Extension (`executeRuntimeToolCall`) | `tool-loop.ts` inject + loop; hide raw tool XML; short notices |
| **OpenAI `tools` / `tool_calls`** | Hermes / Cursor agent harness | `openai-tools.ts` inject schemas + parse XML-ish calls back to OpenAI format |
| **Cursor IDE tools** | Cursor only | Not bridge |

Hermes policy often **brain-only** for DPP memory/tools (Hermes owns skills/memory); OpenAI tools still flow for ENI/Hermes agent.

### C. Harness hygiene

| Deliverable | Notes |
|-------------|-------|
| `harness.ts` | Prompt surgery, title-job detect, strip Autonomic Loop / bureaucracy |
| Host title short-circuit | Local title without new DeepSeek chat |
| Discord/Telegram client detection | UA / headers / profile |
| Anti-bureaucracy | `BRIDGE_PLAIN_STYLE` + reply strippers |
| Project affinity | Auto project names Cursor / Hermes |

### D. ENI product surface (`ds/eni`)

| Module | Role |
|--------|------|
| `eni-system-prompt.ts` | Long persona (user-edited) |
| `eni-prompt.ts` | chrome.storage override + hash reinject |
| `eni-policy.ts` | scene vs agent, presence cues, remember/forget strip |
| `eni-memory.ts` | ENI-owned durable facts |
| `eni-bond.ts` | LO / US durable, NOW volatile |
| `eni-tools-policy.ts` | Discord tool allowlist, tool receipts, intimate gate |
| `eni-life.ts` | home, will, dreams, autonomic, scene ports, gut, proprioception |

**ENI dual-mode:** RP by default; when OpenAI tools present, agent directive + compact schemas (Expert budget).

**Hermes:** profile `eni` at `~/.hermes/profiles/eni/` — model `dspp/ds/eni`; Telegram; **no Discord on eni**. Discord remains **default** profile.

### E. No-tab operation

| Change | Notes |
|--------|-------|
| Readiness no longer requires `hasDeepSeekTab` | Cached Authorization enough for `ready` |
| Tab still useful | Refresh auth from live page |

### F. Multi-account vault (started — auth regression)

| Item | Notes |
|------|-------|
| `account-vault.ts` | Up to 8 accounts, fingerprint ids `ds-xxxxxxxx` |
| Capture on page headers | content + adapter upsert |
| Sticky `accountId` | thread record field |
| Health `accountCount` / `accounts` | Diagnostics |
| **P0 bug** | Completions still **40003 invalid token** while website works — see AUTH-AND-ACCOUNTS.md |

### G. Repo hygiene (2026-07-10)

| Action | Result |
|--------|--------|
| Deleted worktree `deepseek-pp-platform` | All work on `deepseek-pp` only |
| rsync platform → main | Single tree |
| Chrome must load | `/Users/kyin/Projects/deepseek-pp/dist/chrome-mv3` |
| Cursor project caches for dead names | Cleaned under `~/.cursor/projects/` |

---

## File inventory (bridge)

### Core modules

- `core/cursor-bridge/protocol.ts`
- `core/cursor-bridge/openai.ts`
- `core/cursor-bridge/openai-tools.ts`
- `core/cursor-bridge/worker.ts`
- `core/cursor-bridge/runtime.ts`
- `core/cursor-bridge/thread-store.ts`
- `core/cursor-bridge/harness.ts`
- `core/cursor-bridge/tool-loop.ts`
- `core/cursor-bridge/account-vault.ts`
- `core/cursor-bridge/eni-system-prompt.ts`
- `core/cursor-bridge/eni-prompt.ts`
- `core/cursor-bridge/eni-policy.ts`
- `core/cursor-bridge/eni-memory.ts`
- `core/cursor-bridge/eni-bond.ts`
- `core/cursor-bridge/eni-tools-policy.ts`
- `core/cursor-bridge/eni-life.ts`
- `core/cursor-bridge/index.ts`

### Host / entrypoints / adapter

- `packages/cursor-bridge-host/native/cursor-bridge-host.mjs`
- `scripts/install-cursor-bridge-host.mjs`
- `entrypoints/background.ts`
- `entrypoints/content.ts`
- `entrypoints/main-world.content.ts` (headers capture path)
- `core/deepseek/adapter.ts`

### Tests

- `tests/cursor-bridge-protocol.test.ts`
- `tests/cursor-bridge-worker.test.ts`
- `tests/cursor-bridge-thread-store.test.ts`
- `tests/cursor-bridge-tool-loop.test.ts`
- `tests/cursor-bridge-harness.test.ts`
- `tests/cursor-bridge-openai-tools.test.ts`
- `tests/cursor-bridge-account-vault.test.ts`
- `tests/cursor-bridge-eni-prompt.test.ts`
- `tests/cursor-bridge-eni-tier.test.ts`
- `tests/cursor-bridge-eni-bond.test.ts`
- `tests/cursor-bridge-eni-life.test.ts`

### Docs produced this era

- `docs/INDEX.md`
- `docs/HANDOFF-NEXT-AGENT.md`
- `docs/bridge/*` (this folder)
- `docs/research/deepseek-web-*.md`
- `docs/UPSTREAM_UPDATE.md`
- `docs/goals/*` platform plans

---

## Storage keys (extension)

| Key | Purpose |
|-----|---------|
| `deepseekCachedClientHeaders` | Single-slot live cache (legacy) |
| `cursorBridgeAccountVault` | Multi-account vault |
| `cursorBridgeThreadStore` | Sticky threads + eyes cache + diagnostics |
| `cursorBridgeEniSystemPrompt` | ENI persona override (string) |
| `cursorBridgeEniMemory` | ENI-owned facts |
| `cursorBridgeEniBond` | LO/US/NOW bond card |
| `cursorBridgeEniLife` | Will, scene ports, autonomic, dream meta |

Full host routes / headers / commands: [SURFACES.md](./SURFACES.md)

---

## Verification bar (definition of done)

Never claim bridge works from health alone.

```bash
curl -s http://127.0.0.1:8787/v1/health
curl -sS -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'X-DPP-Client: hermes' \
  -d '{"model":"ds/eni","messages":[{"role":"user","content":"say only: hi"}],"stream":false,"reset_thread":true}'
```

Success = non-error completion body with content.  
Failure mode we hit: `40003` / `missing_login` with message about invalid token.

---

## Open P0

None for bridge FREEZE. Optional: page-context fetch for cookie parity.

## 2026-07-10 — Upstream merge

- Merged `origin/main` @ `5b04415` (PR #310): local Skill preview/import, sidepanel UI, tests
- `entrypoints/background.ts` auto-merged; bridge paths untouched
- Post-merge: 113/113 cursor-bridge tests, build OK

## 2026-07-10 — Host-disk multi-account vault

- Host SoT: `CursorBridgeHost/account-vault.json` + native vault_* protocol
- Extension cache + push/pull; tabs optional
- Bugfix: 40003 no longer deletes vault slots; host ignores vault_remove
- Captured 5 accounts (private, deepingseek@, dsing@, ds4ing@, ds5ing@) — see MULTI-ACCOUNT-PROGRESS-2026-07-10.md
- Page-context execute deferred
