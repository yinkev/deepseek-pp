# DeepSeek++ internal docs index

**Repo:** `/Users/kyin/Projects/deepseek-pp` only  
**Public README:** user-facing features only — no API paths, no architecture dumps.  
**This tree:** operator / agent documentation of provider, bridge, and ENI work.

## Start here

| Doc | Purpose |
|-----|---------|
| [HANDOFF-NEXT-AGENT.md](./HANDOFF-NEXT-AGENT.md) | Current provider addendum plus historical bridge handoff |
| [QWEN-PROVIDER-PLAN.md](./QWEN-PROVIDER-PLAN.md) | Approved and completed Qwen provider scope |
| [QWEN-PROVIDER-ARCHITECTURE.md](./QWEN-PROVIDER-ARCHITECTURE.md) | Implemented architecture, ownership, and mechanisms |
| [QWEN-PROVIDER-VERIFICATION.md](./QWEN-PROVIDER-VERIFICATION.md) | Automated/live evidence ledger and closeout |
| [roadmap/provider-workspace-continuity.md](./roadmap/provider-workspace-continuity.md) | Deferred provider/workspace continuity features |
| [bridge/PLATFORM-WORK-LOG.md](./bridge/PLATFORM-WORK-LOG.md) | **What we built** (chronological inventory) |
| [bridge/ARCHITECTURE.md](./bridge/ARCHITECTURE.md) | How host ↔ extension ↔ DeepSeek connect |
| [bridge/MODELS.md](./bridge/MODELS.md) | Model IDs and behavior |
| [bridge/ENI.md](./bridge/ENI.md) | ENI persona, dual-mode, Life/Bond |
| [bridge/AUTH-AND-ACCOUNTS.md](./bridge/AUTH-AND-ACCOUNTS.md) | Login cache, multi-account vault, 40003 |
| [bridge/MULTI-ACCOUNT-PROGRESS-2026-07-10.md](./bridge/MULTI-ACCOUNT-PROGRESS-2026-07-10.md) | **Saved progress:** 5 accounts + wipe fix |
| [bridge/OPS.md](./bridge/OPS.md) | Build, Chrome load path, Hermes, verify |
| [bridge/SURFACES.md](./bridge/SURFACES.md) | Host routes, headers, storage keys, ENI commands |
| [bridge/DOC-AUDIT.md](./bridge/DOC-AUDIT.md) | What was verified / still stale |
| [cursor-bridge-try-it-out.md](./cursor-bridge-try-it-out.md) | Smoke commands |

## Research (DeepSeek web)

| Doc | Purpose |
|-----|---------|
| [research/deepseek-web-client-findings.md](./research/deepseek-web-client-findings.md) | Context limits (~890880), composer limits |
| [research/deepseek-web-api-protocol.md](./research/deepseek-web-api-protocol.md) | HAR-derived protocol notes |

## Goals / history

| Doc | Purpose |
|-----|---------|
| [goals/browser-origin-cursor-api.md](./goals/browser-origin-cursor-api.md) | Original browser-origin goal |
| [goals/multi-account-host-vault-page-context.md](./goals/multi-account-host-vault-page-context.md) | Host-disk multi-account vault (tabs optional) |
| [goals/platform-p0-p4-e2e.md](./goals/platform-p0-p4-e2e.md) | P0–P4 sticky/eyes/queue |
| [goals/platform-p5-p9-daily-driver.md](./goals/platform-p5-p9-daily-driver.md) | Daily-driver track |
| [goals/AUTONOMOUS_STATUS.md](./goals/AUTONOMOUS_STATUS.md) | Rolling status (keep current) |
| [goals/bridge-p0-p25-autonomous.md](./goals/bridge-p0-p25-autonomous.md) | P0–P25 self-governing bridge runway + grade card |
| [UPSTREAM_UPDATE.md](./UPSTREAM_UPDATE.md) | Merge from zhu upstream without losing fork |

## Decisions

| Doc | Purpose |
|-----|---------|
| [decisions/2026-07-09-browser-origin-cursor-api.md](./decisions/2026-07-09-browser-origin-cursor-api.md) | Why browser-origin vs API/ds2api |
| [decisions/2026-07-10-ds2api-vs-browser-origin.md](./decisions/2026-07-10-ds2api-vs-browser-origin.md) | **ds2api ban risk vs our path (binding)** |
| [decisions/2026-07-10-single-repo-no-worktree.md](./decisions/2026-07-10-single-repo-no-worktree.md) | Kill dual folders / worktree |
| [decisions/2026-07-10-eni-and-hermes.md](./decisions/2026-07-10-eni-and-hermes.md) | ENI + Hermes profiles |

## Code map (bridge)

```
core/cursor-bridge/
  protocol.ts          models, prompt flatten, readiness types
  openai.ts            OpenAI request parse / responses
  openai-tools.ts      tools → prompt + parse tool_calls
  worker.ts            job orchestration (session, sticky, ENI, tools)
  runtime.ts           native host connection
  thread-store.ts      sticky threads + eyes cache
  harness.ts           Cursor/Hermes hygiene, strip bureaucracy
  tool-loop.ts         DeepSeek++ runtime tools on bridge
  account-vault.ts     multi-account login vault
  eni-system-prompt.ts long ENI soul (user-editable)
  eni-prompt.ts        storage override + hash reinject
  eni-policy.ts        scene/agent gate, presence, commands
  eni-memory.ts        ENI-owned facts
  eni-bond.ts          LO/US/NOW bond card
  eni-tools-policy.ts  Discord allowlist, receipts
  eni-life.ts          home/will/dreams/autonomic/gut
  index.ts             barrel

packages/cursor-bridge-host/native/cursor-bridge-host.mjs
entrypoints/background.ts   startCursorBridgeRuntime
entrypoints/content.ts      HEADER capture → storage/vault
core/deepseek/adapter.ts    web API client (session/PoW/stream)
```

Tests: `tests/cursor-bridge-*.test.ts`

## Code map (provider workspace)

```text
core/chat/
  provider.ts               internal provider/session/turn contract
  provider-registry.ts      DeepSeek + Qwen model catalog
  provider-model-store.ts   persisted selected model
  agent-prompt.ts           shared ENI/memory/Skill/preset compiler
  conversation-transfer.ts  bounded cross-provider transcript
  provider-tool-loop.ts     shared execution + continuation loop
  tool-protocol.ts          Qwen JSON envelope boundary

core/qwen/
  auth.ts                   Qwen header/cookie capture and cache
  provider-adapter.ts       shared contract → Qwen transport
  transport.ts              native chat.qwen.ai chat + SSE
  upload.ts                 Qwen STS/OSS image flow
  upload-limits.ts          Qwen image limit

entrypoints/background.ts                 provider orchestration
entrypoints/sidepanel/pages/ChatPage.tsx  selector and logical transcript
```

Tests: `tests/provider-*.test.ts`, `tests/qwen-*.test.ts`, and `tests/sidepanel-interactions.test.ts`
