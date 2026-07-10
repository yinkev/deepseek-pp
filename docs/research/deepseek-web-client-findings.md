# DeepSeek Web Client — Research Findings

> Source dump: `docs/research/dumps/deepseek-web-dump-FULL-2026-07-10.json`  
> Captured: `2026-07-10T12:17:15.837Z`  
> Page: `https://chat.deepseek.com/a/chat/s/073c9008-809d-43d3-adaa-93715bda132e`  
> Account-specific remote feature version may change.

## Executive summary

| Claim | Value |
|-------|------:|
| Instant + Vision history/file token budget | **890880** |
| R1 / normal history+file flag | **890880** |
| Expert file_feature | **null** (no uploads, no token_limit in config) |
| Expert composer char limit | **163840** |
| Instant/Vision composer char limit | **2621440** |
| Supported file extensions (Instant+Vision) | **985** (full list saved) |
| FE hardcoded fallback (static JS) | **61440** when config missing |
| Models exposed | `default` (Instant), `expert` (Expert), `vision` (Vision) |

Bridge mapping (product → bridge IDs):

| Web `model_type` | Bridge model | Notes from dump |
|------------------|--------------|-----------------|
| `default` | `ds/squid` | Instant; files yes; token 890880 |
| `expert` | `ds/octopus` | No file_feature; no search; char 163840; **token_limit not in config** |
| `vision` | `ds/octopus-eyes` | vision=true; same 890880 + 985-style ext list as Instant |

**Important:** Expert has `file_feature: null`. The static FE fallback `61440` only applies when looking up file token budgets. Expert still runs long chats; history budget may come from server-side session rules / `normal_history_and_file_token_limit` / `r1_history_and_file_token_limit` (both **890880** in this dump), not from Expert's missing `token_limit` field.

---

## 1. model_configs (complete, this dump)

### Instant (`default`)

- enabled, switchable, **is_default**
- `input_character_limit`: **2621440**
- `file_feature.token_limit`: **890880**
- `file_feature.token_limit_with_thinking`: **890880**
- `max_input_file_count`: 50
- `max_upload_file_size`: 104857600 (100 MiB)
- `support_file_exts`: **985** entries (see dumps)
- `think_feature`: `{}`
- `search_feature`: `{}` (present → search supported)
- tips: `upload_panel_hint` = "Instant Mode: text extraction only"
- edit/regenerate quota: 5 / 5

### Expert (`expert`)

- enabled, switchable
- description: *"For complex problems, limited resource, no search or file uploads."*
- `input_character_limit`: **163840**
- `file_feature`: **null**
- `search_feature`: **null**
- `think_feature`: `{}`
- `support_file_exts`: none
- tips: "Expert Mode: text extraction only" (upload panel hint even though files disabled)

### Vision (`vision`)

- enabled, switchable
- `input_character_limit`: **2621440**
- `token_limit` / `token_limit_with_thinking`: **890880**
- files: 50 / 100 MiB
- `vision`: **true**, `enable_thumbnail`: true
- `conflict_with_search`: false
- `search_feature`: null
- `support_file_exts`: **same set as Instant** (985 exts)
- edit/regenerate quota: 5 / 5

### Extension list

- Full list: `docs/research/dumps/support_file_exts-default-vision.txt` (and `.json`)
- Instant vs Vision: **identical** extension sets
- Expert: **empty / N/A**

---

## 2. Global feature store (`__ds_remote_feature_store`)

| Key | Value |
|-----|------:|
| `normal_history_and_file_token_limit` | 890880 |
| `r1_history_and_file_token_limit` | 890880 |
| `completion_request_timeout_ms` | 60000 |
| `edit_request_timeout_ms` | 60000 |
| `regenerate_request_timeout_ms` | 60000 |
| `continue_request_timeout_ms` | 60000 |
| `resume_request_timeout_ms` | 60000 |
| `auto_resume_request_timeout_ms` | 3000 |
| `sse_auto_resume_timeout` | 3000 |
| `launch_clean_session_interval_seconds` | 21600 (6h) |
| `allow_file_with_search` | true |
| `search_state_on_launch` | on |
| `search_state_on_login` | on |
| `search_state_on_automatically_created_chat` | on |
| `search_state_on_manually_created_chat` | keep |
| `conversation_search_enabled` | true |
| `pow_prefetch` | true |
| `pow_prefetch_count` | 1 |
| `files_host` | `files.deepseeksvc.com` |
| `picture_compress_format` | webp |
| `photo_picker_compress_ratio` | 0.8 |
| `chat_hcaptcha` | true |
| `volcengine_enabled` | true |
| `hif_max_retry_interval_secs` | 600 |
| `image_cache_invalidate_before` | 1777444200000 |

`__ds_remote_feature_store_web_upgrade` was **not** present in this dump.

---

## 3. Client APIs seen in performance list

Settings are **scoped** (important — unscoped call returned INVALID_PARAM):

- `GET /api/v0/client/settings?did=…&scope=main`
- `GET /api/v0/client/settings?did=…&scope=model`
- `GET /api/v0/client/settings?did=…&scope=web_upgrade`
- `GET /api/v0/client/settings?did=…&scope=banner`
- `GET /api/v0/users/current`
- `GET /api/v0/chat_session/fetch_page?lte_cursor.pinned=false`

Dump's bare `client/settings` without correct scope → `biz_code: 2 INVALID_PARAM`.

---

## 4. IndexedDB

| DB | Store | Count (this dump) | Notes |
|----|-------|------------------:|-------|
| `deepseek-chat` | `history-message` | 50 | Cached sessions + messages |
| `applog_sdk_event_store_20006317` | analytics | 0 | Volcengine/tea logging |

### history-message record shape (sample)

```json
{
  "key": "<session-uuid>",
  "version": 2,
  "frontendVersion": "fv-6",
  "data": {
    "chat_session": {
      "id": "...",
      "title": "...",
      "model_type": "default",
      "agent": "chat",
      "current_message_id": 2,
      "pinned": false
    },
    "chat_messages": [
      {
        "message_id": 1,
        "role": "USER",
        "status": "FINISHED",
        "accumulated_token_usage": 38,
        "thinking_enabled": false,
        "search_enabled": false,
        "fragments": [{ "type": "REQUEST", "content": "..." }]
      },
      {
        "message_id": 2,
        "parent_id": 1,
        "role": "ASSISTANT",
        "accumulated_token_usage": 40,
        "fragments": [{ "type": "RESPONSE", "content": "..." }]
      }
    ],
    "cache_control": "REPLACE"
  }
}
```

Useful for bridge: **sticky session reconciliation**, token usage samples, fragment types.

---

## 5. localStorage prefs (non-secret summary)

| Key | Observed |
|-----|----------|
| `thinkingEnabled` | true |
| `searchEnabled` | true |
| `debugModelChannel` | default |
| `debugLiteModelChannel` | default |
| `userToken` | present (secret — in full dump only) |
| `settingsJwt` | present |
| `aws-waf` related | present |
| theme / locale / banner / lastSession | present |
| `__ds_remote_feature_did` | device id for settings queries |

Cookie names: `ds_cookie_preference`, thumbcache, `aws-waf-token` (HttpOnly session cookies may still exist beyond `document.cookie`).

---

## 6. Static JS vs live config (already known)

From offline `main.*.js` scan:

- Fallback `getTokenConfig` → **61440** if modelType null or no `file_feature`
- Status enum includes `CONTEXT_LENGTH_EXCEEDED`
- Feature store names match live dump

---

## 7. Bridge implications (actionable)

1. **Advertise context** for Instant/Vision-like modes: **890880** (done).
2. **Expert (`ds/octopus`) — overpowered bridge policy (not web UI fidelity):** product config says no search/files and **163840** composer chars, but bridge intentionally runs `search_enabled: true`, eyes subcall for images, and ~160k harness message cap. HAR shows expert completions accepting `search_enabled: true`. Server may still ignore search or overflow huge prompts — best-effort power-up, not guaranteed web Expert surface.
3. **Vision**: same token budget as Instant; `vision: true`; full ext list; thumbnails on.
4. **File accept list**: 985 extensions — use dump file for upload validation if bridge uploads.
5. **Settings fetch** must use `scope=model|main|…` + `did=`.
6. **Files host**: `files.deepseeksvc.com`.
7. **Timeouts**: 60s completion; 3s SSE auto-resume — align bridge host timeouts.
8. **Still missing for protocol**: live completion/SSE network spy, project/folder APIs, HttpOnly cookies, in-memory stores.

---

## 8. Files in repo

| Path | Contents |
|------|----------|
| `docs/research/dumps/deepseek-web-dump-FULL-2026-07-10.json` | Full browser dump (~2.9 MB) |
| `docs/research/dumps/support_file_exts-default-vision.txt` | One extension per line |
| `docs/research/dumps/support_file_exts-default-vision.json` | JSON array |
| `docs/research/deepseek-web-client-findings.md` | This document |

---

## 9. Changelog

| Date | Note |
|------|------|
| 2026-07-10 | Initial static JS findings (61440 fallback) |
| 2026-07-10 | Live Instant paste → 890880 |
| 2026-07-10 | Full dump ingested: 3 models, 985 exts, IDB shape, feature flat map, scoped settings URLs |


---

## Related: live API HAR

See [`deepseek-web-api-protocol.md`](./deepseek-web-api-protocol.md) for completion/SSE/upload protocol from `chat.deepseek.com.har`.
