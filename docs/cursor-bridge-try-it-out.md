# Try it out — Browser-origin Cursor API

## What you get

```text
Cursor → CLIProxyAPI → http://127.0.0.1:8787/v1
  → DeepSeek++ extension (native messaging)
    → logged-in chat.deepseek.com tab
      → DeepSeek website (browser-origin)
```

## One-time setup

1. **Build / load extension** on branch `local/browser-origin-api`:

```bash
cd /Users/kyin/Projects/deepseek-pp
npm install
npm run build:chrome
# Load unpacked: .output/chrome-mv3 (or your usual WXT dist path)
```

2. Copy the **extension ID** from `chrome://extensions`.

3. **Install native host**:

```bash
npm run cursor-bridge:install -- --browser chrome --extension-id YOUR_EXTENSION_ID
```

4. **Restart Chrome**, open a logged-in **chat.deepseek.com** tab (extension active).

5. **Smoke check**:

```bash
curl -s http://127.0.0.1:8787/health | jq .
curl -s http://127.0.0.1:8787/v1/models | jq .
curl -s http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"ds/octopus","messages":[{"role":"user","content":"Say hi in one short sentence."}]}' | jq .
```

When not ready, `/v1/models` still returns model ids but `available: false`, and chat returns a structured 503 (`missing_tab` / `missing_login` / `not_ready`).

## CLIProxyAPI

In `/Users/kyin/cliproxyapi/config.yaml` under `openai-compatibility`:

```yaml
- name: DeepSeekPPBrowser
  prefix: dspp
  base-url: http://127.0.0.1:8787/v1
  api-key-entries:
    - api-key: local-bridge-key
  models:
    - name: ds/octopus
      alias: ""
    - name: ds/octopus-eyes`, `ds/squid
      alias: ""
```

Then point Cursor at CLIProxyAPI as usual and pick:

- `ds/octopus` — expert (default brain)
- `ds/octopus-eyes`, `ds/squid` — vision

If you send an image on `ds/octopus`, the bridge runs an internal eyes pass and injects notes into the expert turn (text history is preserved).

## Requirements while using

- Chrome running
- DeepSeek++ loaded
- Logged-in chat.deepseek.com tab open
- Native host installed for this extension ID

## Uninstall host

```bash
npm run cursor-bridge:install -- uninstall --browser chrome
```


## Sticky threads (P1–P2)

Same harness chat can continue the same DeepSeek web session:

- Pass `thread_id` in the chat body, or header `X-DPP-Thread-Id`
- Force a new session with `reset_thread: true` or `X-DPP-Reset-Thread: true`
- Without an explicit id, the bridge fingerprints the first user turn + model family

Eyes subcalls remain one-shot (ephemeral). Main expert/squid/eyes turns are sticky.

## Health

`GET http://127.0.0.1:8787/v1/health` returns readiness, model list, and feature flags.


## Troubleshooting (fast)

1. `curl -s http://127.0.0.1:8787/v1/health` — need `extensionAlive`, `hasDeepSeekTab`, `hasLogin`
2. Missing tab/login → open logged-in chat.deepseek.com and reload the extension
3. Host dead → `npm run cursor-bridge:install -- --extension-id <id>` then reload extension
4. Stale models/features → reinstall host + reload extension (service worker caches old code)
5. Sticky: same first user message + same client profile reuses a web session; `reset_thread: true` forces new
