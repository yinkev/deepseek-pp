# DeepSeek Web API Protocol (from HAR)

> Source: `docs/research/dumps/chat.deepseek.com-2026-07-10.har` (~10.8 MB, 56 entries)  
> Captured 2026-07-10 via Chrome Network “Save all as HAR with content”.  
> Secrets live only in the HAR file — do not paste HAR into public chats.

## Endpoint inventory (this capture)

| Count | Method | Path |
|------:|--------|------|
| 15 | GET | `/api/v0/client/settings` |
| 12 | POST | `/api/v0/chat/create_pow_challenge` |
| 8 | POST | `/api/v0/chat/completion` |
| 8 | POST | `/api/v0/chat/resume_stream` |
| 5 | POST | `/api/v0/chat_session/create` |
| 2 | GET | `/api/v0/file/fetch_files` |
| 1 | POST | `/api/v0/file/upload_file` |
| 1 | GET | `/api/v0/chat/history_messages` |
| 1 | GET | `/api/v0/chat_session/fetch_page` |
| 1 | GET | `/api/v0/users/current` |
| 1 | POST | `/api/v0/client/settings/report` |
| 1 | GET | `/api/v0/users/settings` |

Transport for chat calls: **XHR** (seen via extension `main-world.js`), response for completion is **`text/event-stream`**.

---

## Happy path (one turn)

```
1) POST /api/v0/chat_session/create  body: {}
   → chat_session.id, ttl_seconds: 259200 (3 days)

2) POST /api/v0/chat/create_pow_challenge
   body: { "target_path": "/api/v0/chat/completion" }
   → challenge { algorithm, challenge, salt, signature, difficulty, expire_at, expire_after, target_path }

3) POST /api/v0/chat/completion
   headers:
     Authorization: Bearer <userToken>
     x-ds-pow-response: <base64 JSON of solved PoW>
     content-type: application/json
   body: see schema below
   → SSE stream

4) (client often) POST /api/v0/chat/resume_stream
   body: { chat_session_id, message_id }
   → if already FINISHED: biz_code 22 "invalid message status" + full message snapshot (tokens, fragments)
```

### Vision / image turn extra

```
2a) POST create_pow_challenge { target_path: "/api/v0/file/upload_file" }
2b) POST /api/v0/file/upload_file  multipart file=...
    → file id, status PENDING, model_kind VISION, is_image true
2c) GET /api/v0/file/fetch_files?file_ids=file-...
    → PARSING → SUCCESS, token_usage, signed_path, width/height, audit_result pass
3)  completion with ref_file_ids: ["file-..."], model_type: "vision"
```

---

## Completion request schema (observed)

```json
{
  "chat_session_id": "uuid",
  "parent_message_id": null,
  "model_type": "default | expert | vision | null",
  "prompt": "string",
  "ref_file_ids": [],
  "thinking_enabled": true,
  "search_enabled": true,
  "action": null,
  "preempt": false
}
```

| Field | Notes from HAR |
|-------|----------------|
| `parent_message_id` | `null` first turn; then `2`, `4`, … (assistant message ids) |
| `model_type` | `default` / `expert` / `vision`; sometimes **null** on follow-ups (server still used default in SSE ready) |
| `thinking_enabled` | true on expert/vision samples; one default turn false |
| `search_enabled` | true/false; expert config says no search product-wise but requests still sent true sometimes |
| `ref_file_ids` | non-empty only on vision image turn |
| `prompt` | **Single current-turn string** — in this capture often ~29–31k chars because **DeepSeek++ memory injection** was in the prompt (not raw user text only) |
| `action` / `preempt` | always null / false here |

**Auth:** every completion had `x-ds-pow-response`.

---

## SSE response (completion)

Content-Type: `text/event-stream; charset=utf-8`

### Named events seen

| event | Role |
|-------|------|
| `ready` | `{ request_message_id, response_message_id, model_type }` |
| `update_session` | `{ updated_at }` |
| `title` | session title updates (4 of 8 streams) |
| `close` | end of stream (8/8) |

Many chunks are bare `data: {...}` **without** `event:` (patch language).

### Patch ops seen

| op | Use |
|----|-----|
| `APPEND` | stream text into fragment content |
| `SET` | set fields |
| `BATCH` | batch updates (includes finish / token usage) |

### Fragment types seen

- `THINK` (thinking_enabled paths)
- `RESPONSE` (final answer)

Initial snapshot often includes full `response` object with `status: "WIP"`, `accumulated_token_usage`, `fragments`, etc.

---

## resume_stream

Request:

```json
{ "chat_session_id": "uuid", "message_id": 2 }
```

Observed when stream already finished:

- `biz_code`: **22**
- `biz_msg`: **invalid message status**
- `biz_data`: full assistant message with `status: "FINISHED"`, `accumulated_token_usage`, `fragments` (THINK + RESPONSE)

So resume is both **reconnect** and a **snapshot fetch** after finish (client still calls it).

Token samples after finish (this capture): ~7k → ~14k → ~22k as multi-turn grew.

---

## Session list / history

### `GET /api/v0/chat_session/fetch_page?lte_cursor.pinned=false`

- Returned **100** sessions in one page
- Fields: `id`, `title`, `title_type`, `pinned`, `model_type`, `updated_at`
- model_type mix in this account page: expert 50 / default 45 / vision 5

### `GET /api/v0/chat/history_messages?chat_session_id=…&cache_version=2&cache_reset_at=…`

- Can return `cache_control: "MERGE"` with **empty** `chat_messages` when client cache is enough
- Session meta includes `current_message_id`, `agent: "chat"`, `version`, etc.

### `POST /api/v0/chat_session/create` body `{}`

- Returns new session + **`ttl_seconds`: 259200** (72h)

---

## Settings

- Must use **`scope=`** query: `main`, `model`, `banner`, `web_upgrade`, …
- Plus `did=` device id
- `scope=main` returns the same feature map as localStorage store (token limits 890880, timeouts, etc.)
- Bare settings without scope → INVALID_PARAM (seen earlier)

---

## File upload

| Stage | status | notes |
|-------|--------|-------|
| upload | PENDING | id `file-…`, model_kind VISION, is_image |
| fetch | PARSING | token_usage null |
| fetch | SUCCESS | token_usage **329** (this image), signed_path, width/height, audit pass |

PoW target for upload: `/api/v0/file/upload_file`.

---

## Bridge implications

1. **Sticky**: `chat_session_id` + `parent_message_id` chain is the real multi-turn protocol (matches bridge thread design).
2. **PoW**: required on completion + upload; `target_path` must match.
3. **Models**: `default` / `expert` / `vision` strings in body = squid / octopus / octopus-eyes.
4. **Overpowered octopus**: bridge sets `search_enabled: true` on expert; images use vision subcall → eyes notes. New sessions auto-join DeepSeek++ projects `Cursor` / `Hermes` by client profile.
5. **SSE**: keep supporting ready + patch APPEND/SET/BATCH + THINK/RESPONSE fragments + close.
6. **resume_stream**: expect biz 22 after finish; still useful for final token usage / full text recovery.
7. **Prompt size**: web UI can send ~30k char prompts with memory injection; bridge should not assume tiny prompts.
8. **Sessions page**: 100 per fetch_page — pagination via cursor (only first page in this HAR).
9. **Why fetch spy failed**: chat is XHR through extension main-world, not page `window.fetch`.

---

## Still missing / not in this HAR

- `regenerate` / `edit` / `continue` endpoints (not exercised)
- `CONTEXT_LENGTH_EXCEEDED` stream sample
- Project/folder APIs (none in this capture)
- Pagination beyond first `fetch_page`
- Official streaming without DeepSeek++ memory injection (cleaner prompt baseline)

---

## Files

| Path | Notes |
|------|-------|
| `docs/research/dumps/chat.deepseek.com-2026-07-10.har` | Full HAR (contains tokens — local only) |
| `docs/research/dumps/har-protocol-extract-2026-07-10.json` | Sanitized summary |
| `docs/research/deepseek-web-api-protocol.md` | This doc |
