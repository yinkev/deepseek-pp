# Operations — build, load, Hermes, verify

## Single repo rule

```text
ONLY: /Users/kyin/Projects/deepseek-pp
Chrome Load unpacked: /Users/kyin/Projects/deepseek-pp/dist/chrome-mv3
```

No `deepseek-pp-platform`. No ds2api folder.

## Build + host install

```bash
cd /Users/kyin/Projects/deepseek-pp
npm install   # if needed
npm run build
node scripts/install-cursor-bridge-host.mjs --extension-id chhlagfdfeanaefgbdbgmdlpgaoahhbi
```

This machine:

| Item | Value |
|------|-------|
| Extension ID | `chhlagfdfeanaefgbdbgmdlpgaoahhbi` |
| Host HTTP | `http://127.0.0.1:8787` |
| Host files | `~/Library/Application Support/DeepSeek++/CursorBridgeHost/` |
| NM manifest | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.deepseek_pp.cursor_bridge.json` |

After install/build: **Reload extension** in chrome://extensions.

## Smoke

```bash
curl -s http://127.0.0.1:8787/v1/health | python3 -m json.tool | head -50
curl -s http://127.0.0.1:8787/v1/models | python3 -m json.tool | head -40

curl -sS -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'X-DPP-Client: hermes' \
  -d '{"model":"ds/eni","messages":[{"role":"user","content":"say only: hi"}],"stream":false,"reset_thread":true}'
```

## Tests

```bash
cd /Users/kyin/Projects/deepseek-pp
npx vitest run tests/cursor-bridge-*.test.ts
```

## CLIProxyAPI

Typical local base: `http://127.0.0.1:8317/v1` with model prefix `dspp/...` → bridge `:8787`.  
User may also point Hermes directly at bridge. Check live `~/.hermes/config.yaml` and `~/.hermes/profiles/eni/config.yaml`.

## Hermes profiles

| Profile | Role |
|---------|------|
| `default` | Discord + general |
| `eni` | ENI life; Telegram; model `dspp/ds/eni`; no Discord |

Do not move Discord onto eni without user ask.  
Do not edit default Nous crons without user ask.

## Upstream DeepSeek++

See `docs/UPSTREAM_UPDATE.md`. Stash/worktree discipline — but **do not** leave a permanent second worktree that Chrome loads.

## Commit policy

Large uncommitted ENI/bridge work on `main`. Commit only when user asks. Conventional commits preferred.

## Automation smoke (P16)

```bash
node scripts/bridge-smoke.mjs --quick   # health + models + one completion
node scripts/bridge-smoke.mjs           # sticky + concurrent + tools + eni + vault
```

Health should show `lastJob`, `queueDepth`, `accountCount`, and feature flags `operatorLastJob` / `accountCooldown` after host reinstall.
