# DeepSeek++ Cursor Bridge Host

Local OpenAI-compatible HTTP surface that relays completions through the DeepSeek++ Chrome extension on a logged-in `chat.deepseek.com` tab.

**This host never calls DeepSeek servers itself.** Browser-origin only.

## Install

1. Load DeepSeek++ in Chrome and copy the extension ID from `chrome://extensions`.
2. From the repo root:

```bash
node packages/cursor-bridge-host/bin/deepseek-pp-cursor-bridge-host.mjs install \
  --browser chrome \
  --extension-id YOUR_EXTENSION_ID
```

3. Restart Chrome.
4. Open a logged-in `chat.deepseek.com` tab (DeepSeek++ active).
5. Check readiness:

```bash
curl http://127.0.0.1:8787/v1/models
curl http://127.0.0.1:8787/health
```

## CLIProxyAPI

Add an `openai-compatibility` provider pointing at:

- Base URL: `http://127.0.0.1:8787/v1`
- Models: `ds/octopus` (expert), `ds/octopus-eyes` (vision)

Any API key string is accepted by the bridge (local only); use a random local key in CLIProxyAPI.

## Hard rules

- No official DeepSeek API
- No headless token reverse
- Extension + logged-in tab required or requests return structured 503 errors
