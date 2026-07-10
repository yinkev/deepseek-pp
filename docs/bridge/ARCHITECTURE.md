# Cursor bridge architecture

## Data path

```text
Client (Cursor / Hermes / Discord gateway / Telegram)
  → OpenAI-compatible HTTP (often via CLIProxyAPI prefix dspp)
    → cursor-bridge-host :8787  (Node native messaging host)
      → Chrome extension background (service worker)
        → worker.runCursorBridgeJob
          → DeepSeek web API (create session, PoW, completion SSE)
            → chat.deepseek.com origin semantics (Bearer + cookies + PoW)
```

## Components

### 1. Native host (`cursor-bridge-host.mjs`)

- Listens HTTP `127.0.0.1:8787`
- Speaks Chrome native messaging to extension
- Parses chat body → job; client profile from headers/UA
- Queues jobs; streams SSE chunks back as OpenAI stream or non-stream
- Short-circuits Hermes **title generation** jobs locally
- Endpoints: `/v1/models`, `/v1/chat/completions`, `/v1/health`, ENI home/nudge/dream helpers

### 2. Extension background

- `startCursorBridgeRuntime({ deps })`
- Provides: load headers, refresh from tabs, execute DPP tools, memories, tool descriptors
- Does **not** require a DeepSeek tab for readiness if login cache exists

### 3. Worker

- Resolves model → DeepSeek `model_type` (default/expert/vision)
- Sticky thread resolve / create session / parent message id
- Prompt assembly (system/history/delta/ENI/tools/memory/bond/life)
- Optional eyes subcall + cache
- Optional DPP tool loop
- Optional OpenAI tool_calls parse
- Persists thread + diagnostics

### 4. Content / main world

- Intercepts page fetch to DeepSeek APIs
- Captures Authorization + client headers → `HEADERS_CAPTURED`
- Persists to `deepseekCachedClientHeaders` + account vault upsert

### 5. Adapter (`core/deepseek/adapter.ts`)

- `createChatSession`, `createPowHeaders`, `submitPromptStreaming`, file upload
- Uses `fetch` with `credentials: 'include'` and client headers
- **Caveat:** when called from service worker, cookie jar is SW context, not the tab — this is central to the 40003 investigation

## Sticky sessions

```text
threadId = explicit | conversationHint hash | first-user fingerprint
record: chatSessionId, parentMessageId, modelFamily, accountId?, eniPromptHash?, ...
next turn: reuse session + parent, send delta/latest user (not full history dump when sticky)
```

## Prompt pipeline (simplified)

1. Detect client profile (Cursor / Hermes / generic)
2. Sanitize messages (strip Hermes ephemera, optional memory-context for ENI)
3. ENI: local commands (home/will/dream/…) may short-circuit
4. Build prompt: ENI system (first sticky inject), tools, bond, life, eyes notes, user
5. Submit streaming; strip bureaucracy; parse tool calls; stream text to client

## Tool stacks (again)

```text
DeepSeek++ tools  → extension runtime (shell/MCP/memory/…)  → tool-loop
OpenAI tools      → Hermes/Cursor executes                   → openai-tools protocol
Cursor IDE tools  → never bridge
```

## Failure modes

| Symptom | Likely layer |
|---------|----------------|
| 503 missing_login | No Authorization in storage |
| 40003 invalid token | Stale Bearer / wrong account / SW vs page auth |
| Twin empty DeepSeek chats | Title jobs not short-circuited / sticky miss |
| Bureaucratic Target State prose | Hermes autonomic-loop plugin + incomplete strip |
| Health OK but chat fails | Health only checks “has some Authorization string” |

## Related docs

- [MODELS.md](./MODELS.md)
- [ENI.md](./ENI.md)
- [AUTH-AND-ACCOUNTS.md](./AUTH-AND-ACCOUNTS.md)
- [OPS.md](./OPS.md)
