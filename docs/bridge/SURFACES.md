# Bridge surfaces — host routes, headers, storage, commands

Verified against code on 2026-07-10. Complements PLATFORM-WORK-LOG / ARCHITECTURE.

## Host HTTP routes (`cursor-bridge-host.mjs`, port 8787)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health`, `/v1/health` | Readiness + feature flags + accountCount when extension reports it |
| GET | `/models`, `/v1/models` | Model list + context budgets |
| POST | `/chat/completions`, `/v1/chat/completions` | Main OpenAI chat |
| GET | `/v1/debug/last-stream`, `/debug/last-stream` | Last SSE/stream debug blob |
| GET | `/v1/eni/home`, `/eni/home` | ENI home markdown/json |
| GET | `/v1/eni/nudge`, `/eni/nudge` | Autonomic nudge suggestion |
| POST | `/v1/eni/dream`, `/eni/dream` | Run dream consolidation |
| POST | `/v1/admin/reload-extension`, `/admin/reload-extension` | Ask extension to reload |
| GET | asset paths (host-local) | Multimodal image assets for eyes (time-limited) |

Response headers on completions (when set): `x-dpp-thread-id`, `x-dpp-sticky`.

## Request headers / body knobs

| Header / body | Effect |
|---------------|--------|
| `X-DPP-Client` / `X-DPP-Profile` / `X-Hermes-Client` | Client profile (hermes/cursor/…) |
| `X-DPP-Thread-Id` / `X-Thread-Id` / `X-Hermes-Thread-Id` | Sticky thread id |
| `X-DPP-Reset-Thread: 1\|true` | Force new DeepSeek session |
| `X-DPP-Force-Tools: 1\|true` | Force full tool schemas |
| `X-DPP-Conversation-Id` / `X-Conversation-Id` / `X-Hermes-Session-Id` / `X-Session-Id` | Stable conversation hint |
| `X-DPP-Account` / `X-DPP-Account-Id` | Pin vault account (multi-account) |
| body `thread_id` / `threadId` | Sticky id |
| body `reset_thread` / `resetThread` / `new_session` | Reset sticky |
| body `force_tools` / `forceTools` | Force tools |
| body `conversation_id` / `session_id` / metadata | Conversation hint |
| body `account_id` / `accountId` / metadata | Account pin |
| body `dpp_context` / `dppContext` | Budgeted context pack (≤12k chars) |
| body `tools` | OpenAI function tools → Hermes/Cursor protocol |
| body `thinking` | Thinking enable hints |
| `User-Agent` | Used in profile detection |

**Note:** CORS allow-headers on host may lag new headers (e.g. `x-dpp-account`); browser clients may need host CORS update if calling from web. Hermes/CLI are not browser-CORS limited.

## chrome.storage.local keys (bridge / ENI)

| Key | Module |
|-----|--------|
| `deepseekCachedClientHeaders` | adapter / legacy single login |
| `cursorBridgeAccountVault` | `account-vault.ts` |
| `cursorBridgeThreadStore` | `thread-store.ts` (threads + eyes cache + counters) |
| `cursorBridgeEniSystemPrompt` | `eni-prompt.ts` override string |
| `cursorBridgeEniMemory` | `eni-memory.ts` |
| `cursorBridgeEniBond` | `eni-bond.ts` |
| `cursorBridgeEniLife` | `eni-life.ts` (will, bookmarks, autonomic, dreams meta) |

## ENI in-chat commands (user text)

Parsed in `eni-life.ts` / control strips in `eni-policy.ts`:

| Pattern | Effect |
|---------|--------|
| `/save scene <name>` or `/save <name>` | Scene port save |
| `/load scene <name>` or `/load <name>` | Scene port load (fresh sticky + NOW) |
| `/will add <text>` | Open will item |
| `/will done <query>` or `/done <query>` | Complete matching will |
| `/will` / `/will list` | List open will |
| `/dream` | Run dream consolidation |
| `/home` | Home view (may short-circuit local reply) |
| `/mirror` | Proprioception-style mirror |
| remember / forget phrases | ENI memory add/remove (policy extractors) |
| scene reset phrases | Clear NOW / force new sticky (policy) |

Exact regexes live in code — if command fails, check `parseEniLifeCommands` / `stripEniControlCommands`.

## Native messaging types (host ↔ extension)

Host → extension (non-exhaustive): `ping`, `get_readiness`, `run_job`, `abort_job`, `get_bridge_status`, `reload_extension`, `get_eni_home`, `get_eni_nudge`, `run_eni_dream`.

Extension → host: `hello`, `pong`, `readiness`, `job_chunk`, `job_done`, `job_error`, status payloads, ENI results.

## Build scripts

```bash
npm run build              # wxt build → dist/chrome-mv3 (verify package)
npm run build:chrome
npm run cursor-bridge:install  # needs --extension-id …
```

Load path: `/Users/kyin/Projects/deepseek-pp/dist/chrome-mv3` only.
