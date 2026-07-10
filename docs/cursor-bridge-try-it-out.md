# Try it out — browser-origin bridge

## Path (only one)

```text
Repo:   /Users/kyin/Projects/deepseek-pp
Load:   /Users/kyin/Projects/deepseek-pp/dist/chrome-mv3
Host:   http://127.0.0.1:8787
```

## What you get

```text
Cursor / Hermes → (optional CLIProxyAPI dspp/) → :8787/v1
  → DeepSeek++ extension
    → DeepSeek web session (cached login; tab optional but helps auth refresh)
```

Models: `ds/octopus`, `ds/octopus-eyes`, `ds/squid`, `ds/eni`.

## One-time setup

```bash
cd /Users/kyin/Projects/deepseek-pp
npm install
npm run build
node scripts/install-cursor-bridge-host.mjs --extension-id chhlagfdfeanaefgbdbgmdlpgaoahhbi
```

1. Chrome → Load unpacked → `dist/chrome-mv3`
2. Reload extension after every build
3. Open `chat.deepseek.com` logged in at least once; send a message to capture token

## Smoke

```bash
curl -s http://127.0.0.1:8787/v1/health | python3 -m json.tool | head -60
curl -s http://127.0.0.1:8787/v1/models | python3 -m json.tool | head -40

# REQUIRED — health alone is not enough
curl -sS -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'X-DPP-Client: hermes' \
  -d '{"model":"ds/eni","messages":[{"role":"user","content":"Say hi in one short sentence."}],"stream":false,"reset_thread":true}'
```

If you see `40003` / invalid token while the website works, see `docs/bridge/AUTH-AND-ACCOUNTS.md` (P0).

## CLIProxyAPI sketch

```yaml
# openai-compatibility entry idea
- name: DeepSeekPPBrowser
  prefix: dspp
  base-url: http://127.0.0.1:8787/v1
  models:
    - name: ds/octopus
    - name: ds/octopus-eyes
    - name: ds/squid
    - name: ds/eni
```

Hermes then uses `dspp/ds/eni` etc.

## More docs

- [docs/INDEX.md](./INDEX.md)
- [docs/bridge/PLATFORM-WORK-LOG.md](./bridge/PLATFORM-WORK-LOG.md)
- [docs/HANDOFF-NEXT-AGENT.md](./HANDOFF-NEXT-AGENT.md)

## Automation smoke (P16)

```bash
node scripts/bridge-smoke.mjs --quick   # health + models + one completion
node scripts/bridge-smoke.mjs           # sticky + concurrent + tools + eni + vault
```

Health should show `lastJob`, `queueDepth`, `accountCount`, and feature flags `operatorLastJob` / `accountCooldown` after host reinstall.
