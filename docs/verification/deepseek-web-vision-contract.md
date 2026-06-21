# DeepSeek Web Vision Contract

Date: 2026-06-20

Source: signed-in `chat.deepseek.com` session in the `Dev++` Chrome window.

## Evidence Summary

- Native Vision UI resource timing hit:
  - `/api/v0/file/upload_file`
  - `/api/v0/file/fetch_files?file_ids=file-...`
  - `/api/v0/chat/create_pow_challenge`
  - `/api/v0/chat_session/create`
- A same-origin page-context probe then reproduced the upload and completion flow with the logged-in web session.
- The probe used a synthetic PNG Blob generated in the page. It did not read local file bytes.
- Auth and PoW header values were redacted. Signed file paths were not retained.

## Required Client Headers

Shared web-session requests require the normal DeepSeek Web client headers:

```text
Authorization: Bearer <localStorage.userToken>
X-App-Version: 2.0.0
x-client-platform: web
x-client-version: 2.0.0
x-client-locale: <document language or browser language>
x-client-timezone-offset: <seconds>
```

Upload and completion both require `X-DS-PoW-Response`, created from `/api/v0/chat/create_pow_challenge` with the matching target path.

## Vision Upload

PoW challenge body:

```json
{
  "target_path": "/api/v0/file/upload_file"
}
```

Upload request:

```text
POST /api/v0/file/upload_file
credentials: include
body: multipart/form-data
```

Upload-specific headers:

```text
X-DS-PoW-Response: <redacted>
x-thinking-enabled: 0
x-model-type: vision
x-file-size: <image byte size>
```

Form fields:

```text
file: <File name="dpp-vision-probe.png" type="image/png">
```

Observed response shape:

```json
{
  "code": 0,
  "data": {
    "biz_code": 0,
    "biz_data": {
      "id": "file-...",
      "status": "PENDING",
      "file_name": "dpp-vision-probe.png",
      "file_size": 1830,
      "model_kind": "VISION",
      "is_image": true,
      "audit_result": "unknown"
    }
  }
}
```

Poll until ready:

```text
GET /api/v0/file/fetch_files?file_ids=file-...
```

Observed ready state:

```json
{
  "code": 0,
  "data": {
    "biz_code": 0,
    "biz_data": {
      "files": [
        {
          "id": "file-...",
          "status": "SUCCESS",
          "model_kind": "VISION",
          "is_image": true,
          "audit_result": "pass",
          "width": 160,
          "height": 80
        }
      ]
    }
  }
}
```

## Vision Completion

Create a chat session first:

```text
POST /api/v0/chat_session/create
body: {}
```

PoW challenge body:

```json
{
  "target_path": "/api/v0/chat/completion"
}
```

Completion request:

```text
POST /api/v0/chat/completion
credentials: include
content-type: application/json
```

Body:

```json
{
  "chat_session_id": "<session id>",
  "parent_message_id": null,
  "model_type": "vision",
  "prompt": "What text is in the image? Answer briefly.",
  "ref_file_ids": ["file-..."],
  "thinking_enabled": false,
  "search_enabled": false,
  "action": null,
  "preempt": false
}
```

Observed completion response:

```text
HTTP 200
content-type: text/event-stream; charset=utf-8
event: ready
data: {"request_message_id":1,"response_message_id":2,"model_type":"vision"}
```

The streamed answer correctly read the generated image text (`DPP`).

## Instant / Default Comparison

Using the same upload endpoint with `x-model-type: default` is not equivalent to Vision.

Default upload request differs only in the model header:

```text
x-model-type: default
```

Observed default upload response:

```json
{
  "code": 0,
  "data": {
    "biz_code": 0,
    "biz_data": {
      "id": "file-...",
      "status": "PENDING",
      "model_kind": "NORMAL",
      "is_image": true,
      "audit_result": "unknown"
    }
  }
}
```

Observed default fetch state for the same image style:

```json
{
  "status": "CONTENT_EMPTY",
  "model_kind": "NORMAL",
  "is_image": true,
  "audit_result": "pass"
}
```

Submitting that file id with default completion:

```json
{
  "model_type": "default",
  "ref_file_ids": ["file-..."]
}
```

returned:

```json
{
  "code": 0,
  "data": {
    "biz_code": 9,
    "biz_msg": "invalid ref file id",
    "biz_data": null
  }
}
```

Conclusion: upload availability alone is not sufficient. DeepSeek++ must upload images with `x-model-type: vision`, wait for a Vision `SUCCESS` file, and submit completion with `model_type: "vision"` plus `ref_file_ids`.

## Implementation Notes

- Upload can run from an authenticated `chat.deepseek.com` page context or extension context that has the same cookies, `localStorage.userToken`-derived client headers, and extension-hosted PoW WASM.
- The upload PoW target path must be `/api/v0/file/upload_file`.
- The completion PoW target path must be `/api/v0/chat/completion`.
- Do not set `thinking_enabled: true` for image-backed completion; DeepSeek's web bundle contains a file/thinking incompatibility error path.
- Durable app state should store only safe metadata and returned file ids, not raw image bytes.
