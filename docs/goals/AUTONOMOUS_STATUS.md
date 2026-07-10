# Autonomous status

**Updated:** 2026-07-10 (full eval pass — FREEZE verified)  
**Repo:** `/Users/kyin/Projects/deepseek-pp` only (`main`, large uncommitted bridge surface)  
**Goal board:** [bridge-p0-p25-autonomous.md](./bridge-p0-p25-autonomous.md)

## Full eval verdict

| Gate | Result |
|------|--------|
| Unit (`cursor-bridge-*.test.ts`) | **113/113 PASS** |
| Live smoke matrix | **SMOKE PASS** (H M C1 S Q T E V) |
| ENI + headers | **200** + `x-dpp-account-id: ds-75222fbc` |
| CPA `:8317` | **200** `cpa-eval` |
| Vault stability | **5 → 5** after all probes |
| ds2api in code deps | **none** (docs ban only) |
| Auth delete path | soft-fail only; host `vault_remove` ignored |

**Overall grade: A** (P0–P25). Transient `502 Failed to fetch` can still appear under concurrent load; retry succeeded; not a vault wipe.

## Done (this runway)

- Host-disk multi-account vault (5 accounts); never-delete on auth failure
- Soft-fail cooldown (`markAccountAuthFailed`) + pick exclude
- Operator `lastJob` on `/v1/health` (id/model/thread/sticky/ok/duration/promptChars/…)
- Account public fields (label, lastErrorCode, cooldownUntil)
- Sticky multi-turn + concurrent queue smoke
- Tool-loop abort stops continuation; OpenAI tools shape OK
- Sticky parent recovery path; per-client rotate policy (hermes ENI no rotate)
- `scripts/bridge-smoke.mjs` matrix + `--quick`
- CPA `dspp/ds/octopus` live OK
- Upstream bridge checklist (P21)
- **113** `tests/cursor-bridge-*.test.ts` green; full smoke **PASS**

## Needs human (optional)

1. Commit when you ask (do not auto-commit)
2. After any extension rebuild, reload once in `chrome://extensions` so service worker matches source

## Do not

- Delete vault slots on auth failure
- ds2api / dual worktrees / multi-profile capture automation
- Claim multi-account production-done from health alone (use smoke matrix)
- List banned paths under ROI / “skip for now” tiers

## Evidence

```bash
cd /Users/kyin/Projects/deepseek-pp
npx vitest run tests/cursor-bridge-*.test.ts
npm run build
node scripts/install-cursor-bridge-host.mjs --extension-id chhlagfdfeanaefgbdbgmdlpgaoahhbi
# reload extension in chrome://extensions after install
node scripts/bridge-smoke.mjs
curl -s http://127.0.0.1:8787/v1/health | python3 -m json.tool | head -60
```
