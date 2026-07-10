# Multi-account progress snapshot — 2026-07-10

**Status:** vault populated + wipe fixed + smoke matrix PASS (2026-07-10 evening); soft-fail cooldown shipped  
**Repo:** `/Users/kyin/Projects/deepseek-pp` only  
**User:** "Save this progress" + evaluate/review/grade/iterate/zoom-out

## Verified live (this machine)

```text
GET http://127.0.0.1:8787/v1/health
ready=true hasLogin=true accountCount=5 hostAccountVault=true
hostVaultPath=~/Library/Application Support/DeepSeek++/CursorBridgeHost/account-vault.json
```

### Account order (user-locked)

| Order | Email | Vault id (Bearer fingerprint) | Notes |
|-------|-------|-------------------------------|-------|
| 1 | private | `ds-bbadbd22` | password not stored in git |
| 2 | deepingseek@minimax.kevinyin.com | `ds-666815cf` | |
| 3 | dsing@minimax.kevinyin.com | `ds-75222fbc` | re-captured after earlier wipe; old `ds-55b55c01` dead |
| 4 | ds4ing@minimax.kevinyin.com | `ds-9e46cca2` | |
| 5 | ds5ing@minimax.kevinyin.com | `ds-37fc4e2f` | |

Passwords / private email for account-1: **only** in local file (not git):

`~/Library/Application Support/DeepSeek++/CursorBridgeHost/accounts-private.local.md`

## What shipped in code

| Piece | Path | Behavior |
|-------|------|----------|
| Host disk vault | `packages/cursor-bridge-host/native/account-vault.mjs` | load/save upsert; max 8 |
| Host protocol | `cursor-bridge-host.mjs` | `vault_upsert` / `vault_get` / `vault_snapshot` / `vault_ack`; **`vault_remove` ignored** |
| Extension cache | `core/cursor-bridge/account-vault.ts` | chrome.storage upsert; push to host; apply host snapshot (upsert only) |
| Host bridge | `core/cursor-bridge/host-vault-bridge.ts` | fire-and-forget post to native port |
| Runtime | `core/cursor-bridge/runtime.ts` | on `vault_snapshot` → apply + seed local→host |
| Protocol types | `core/cursor-bridge/protocol.ts` | vault message types |
| Worker 40003 | `core/cursor-bridge/worker.ts` | **never delete vault slots**; exclude slot for retry only |
| Installer | `packages/cursor-bridge-host/lib/installer.mjs` | copies `account-vault.mjs` |
| Goal | `docs/goals/multi-account-host-vault-page-context.md` | tabs optional; page-context deferred |
| Decision | `docs/decisions/2026-07-10-ds2api-vs-browser-origin.md` | no ds2api |

## Critical incident (learn this)

**Failure mode:** on DeepSeek `40003`, worker called `removeBridgeAccount` which deleted the slot and pushed `vault_remove` to host → multi-account wiped when job used non-live account while browser was on another login. Admin reload during capture also raced seed and dropped slots.

**Mitigation now:**
1. Worker: no vault delete on 40003
2. Host: `vault_remove` is no-op (log only)
3. Extension: local remove does not push remove to host

**Still true:** tokens expire; re-login + one chat message recaptures. Fingerprint id **changes** on new login.

## Not proven yet

- [x] Completions succeed with vault count stable (smoke V); rotate policy unit-tested (full 5-way explicit matrix optional)
- [x] Sticky turn-2 smoke hit; account pin stored on thread (accountId header after extension reload)
- [ ] Host labels match user order in health UI (disk labels ok; extension auto-labels still messy)
- [ ] Page-context DeepSeek execute (deferred; tabs still optional)
- [ ] Git commit of this surface (user has not asked)

## Hard rules for next agent

1. **Never** delete vault slots on auth failure.
2. **Never** admin-reload mid multi-account capture unless disk already has N and you will re-seed carefully.
3. **Never** claim multi-account "done" from health alone — need completion probe.
4. **Never** reintroduce ds2api.
5. **Never** store passwords in the git repo.
6. Working tree only: `/Users/kyin/Projects/deepseek-pp`. Load unpacked: `dist/chrome-mv3`.

## Quick verify

```bash
curl -s http://127.0.0.1:8787/v1/health | python3 -m json.tool | head -40
python3 -c "import json;from pathlib import Path;d=json.loads((Path.home()/'Library/Application Support/DeepSeek++/CursorBridgeHost/account-vault.json').read_text());print(len(d['order']), d['order'])"
```
