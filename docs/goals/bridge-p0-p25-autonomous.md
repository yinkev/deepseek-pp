# Goal: Bridge P0–P25 self-governing autonomous runway

**Status:** FREEZE complete (P0–P25 graded) — 2026-07-10  
**Date:** 2026-07-10  
**Repo:** `/Users/kyin/Projects/deepseek-pp` only  
**Chrome load:** `dist/chrome-mv3`  
**Host:** `http://127.0.0.1:8787`  
**Related:** multi-account vault, platform-p10-plus, ENI, tool-loop, Hermes/Telegram

## Objective (one sentence)

Ship a **self-governing bridge daily-driver** for Hermes/Cursor/Telegram: multi-account vault stays intact, jobs are diagnosable, sticky + tool loops + concurrent queue work under automation, regression smoke proves it — **P0 through P25 complete** with evaluate/review/grade/verify after every phase.

## Self-governing loop (mandatory after every P#)

```text
IMPLEMENT → UNIT/BUILD VERIFY → LIVE SMOKE IF SAFE → EVALUATE (what shipped)
→ REVIEW (blast radius, vault safety) → GRADE (A–F vs done-when) → ITERATE IF <B
→ MARK PHASE DONE IN THIS DOC + AUTONOMOUS_STATUS → NEXT P#
```

**Stop and ask human only when:**
- Vault tokens all dead and capture requires login
- Chrome extension reload required for live proof (code continues; live deferred)
- Destructive host/Hermes global change
- DeepSeek hard-blocks accounts
- User says stop

**Never stop for:** boredom, “enough for today,” missing optional UI polish, 40003 tunnel vision.

## Hard rules (all phases)

1. Never delete host/extension vault slots on auth or tool failure (cooldown/exclude only).
2. Never reintroduce ds2api / multi-profile automation / dual worktrees.
3. Never log Bearer tokens or passwords.
4. Never commit unless user asks.
5. Tabs optional; page-context is deferred unless listed.
6. Prefer surgical diffs; no drive-by refactors.

## Use of DeepSeek agents

When bridge is ready (`/v1/health` ready + completion 200), agents MAY use:
- `ds/octopus` / `dspp/ds/octopus` for code review summaries
- `ds/eni` only for persona-path smoke, not for coding authority

If bridge fails, continue with local vitest + curl only — do not block the runway.

---

## Phase board P0–P25

### Band 0 — Integrity (must)

| Phase | Deliverable | Done when | Grade bar |
|-------|-------------|-----------|-----------|
| **P0** | Vault never-delete audit + regression tests | No job path calls remove/clear-on-auth; host ignores vault_remove; tests assert | A = tests green + code audit clean |
| **P1** | Operator `lastJob` on health | `/v1/health` includes last job id/model/accountId/threadId/ok/error/duration (no secrets) | A = curl shows fields after 1 job |
| **P2** | Account public fields | health accounts: id, label, lastUsedAt, lastErrorCode?, cooldownUntil? | A = accounts listed without tokens |
| **P3** | Soft-fail cooldown | auth fail sets cooldown; pick excludes until expiry/recapture; vault count stable | A = unit + no remove |
| **P4** | Label hygiene | stable labels for known order; host labels win | A = labels when set |

### Band 1 — Sticky + loops (must)

| Phase | Deliverable | Done when | Grade bar |
|-------|-------------|-----------|-----------|
| **P5** | Sticky account pin multi-turn | turn2 same accountId when sticky hit | A = unit + optional live headers |
| **P6** | Tool-loop same account | XML tool-loop continuations never re-pick account | A = unit |
| **P7** | Response headers | `X-DPP-Thread-Id`, `X-DPP-Sticky`, `X-DPP-Account-Id` | A = smoke prints headers |
| **P8** | Busy/abort integrity | abort clears busy; next job runs | A = no zombie busy |
| **P9** | Queue honesty | concurrent HTTP waits; health queueDepth accurate | A = dual curl or host unit |
| **P10** | Tool-loop abort + metrics | abort mid-loop safe; job reports depth/executions | A = tool-loop tests |
| **P11** | OpenAI tools Hermes path | tools request returns tool_calls or final text; no crash | A = unit + optional live |

### Band 2 — Stream + recovery (should)

| Phase | Deliverable | Done when | Grade bar |
|-------|-------------|-----------|-----------|
| **P12** | Stream/cancel + abort path | cancel does not leave busy | A = abort path proven |
| **P13** | Sticky parent recovery | parent fail → one new session + sticky miss | A = unit or worker path |
| **P14** | Per-client account policy | hermes/eni sticky body; rotate only unpinned multi | A = pick policy tests |
| **P15** | Multi-account matrix | smoke rotate/explicit when count>1; count stable | A = script + vault count |

### Band 3 — Harness + product light (should)

| Phase | Deliverable | Done when | Grade bar |
|-------|-------------|-----------|-----------|
| **P16** | bridge-smoke matrix | H/M/C/S/Q/T/E/V; `--quick` | A = exit 0 when ready |
| **P17** | Eyes cost control | cache hit path in unit | A = eyes tests green |
| **P18** | Context pack v1 | optional budgeted `dpp_context` inject | A = unit budget + inject |
| **P19** | Memory inject read-only | short inject OR explicit skip | A = unit OR skip logged |
| **P20** | CPA daily-driver verify | curl via :8317 dspp if up | A = completion or offline note |

### Band 4 — Survival + ENI + freeze

| Phase | Deliverable | Done when | Grade bar |
|-------|-------------|-----------|-----------|
| **P21** | Upstream survival checklist | bridge checklist in UPSTREAM_UPDATE + link | A = doc exists |
| **P22** | Last-job debug ring | opt-in prompt length + sticky + error | A = health/debug field |
| **P23** | ENI continuity commands | remember/forget/will parse tests | A = eni tests green |
| **P24** | Docs truth-up | AUTONOMOUS_STATUS + grade card + OPS | A = docs consistent |
| **P25** | FREEZE gate | vitest cursor-bridge*, build, smoke --quick, grades ≥B or skip | A = freeze green |

## Reject list (not P0–P25)

- ds2api, multi-Chrome profiles, dual worktrees
- Full sidepanel account manager UI (data layer only in P2–P4)
- Page-context MAIN-world (optional later)
- Pet/theme gimmicks, remote announcements
- Commit/push without user ask

## Evidence commands

```bash
cd /Users/kyin/Projects/deepseek-pp
npx vitest run tests/cursor-bridge-*.test.ts
npm run build
node scripts/install-cursor-bridge-host.mjs --extension-id chhlagfdfeanaefgbdbgmdlpgaoahhbi
node scripts/bridge-smoke.mjs --quick
curl -s http://127.0.0.1:8787/v1/health | python3 -m json.tool | head -80
```

## Grade card (fill as phases complete)

| Phase | Grade | Evidence | Notes |
|-------|-------|----------|-------|
| P0 | A | vitest vault; host vault_remove ignored; worker never removes | audit+tests |
| P1 | A | health.lastJob after smoke: id/model/ok/durationMs | live smoke |
| P2 | A | accounts list id/label/useCount/lastErrorCode/cooldownUntil | health+listBridgeAccounts |
| P3 | A | markAccountAuthFailed unit; count stable; no delete | unit |
| P4 | A | setAccountLabel unit; host labels in vault file | unit |
| P5 | A | smoke S sticky hit turn2 | live smoke |
| P6 | A | tool-loop uses fixed headers/session; unit green | unit+code |
| P7 | A | live headers: x-dpp-thread-id + sticky + x-dpp-account-id=ds-75222fbc | live re-verify |
| P8 | A | runtime finally clears busy; engine abort stops loop | code+unit |
| P9 | A | smoke Q concurrent both 200; host FIFO | live smoke |
| P10 | A | abort mid-loop unit; toolLoopDepth field on tools meta | unit |
| P11 | A | smoke T tools-shape 200; openAi tools path exists | live+unit |
| P12 | A | abort_job + finally busy; engine abort no zombie | code+unit |
| P13 | A | isStickyParentError + one fresh session in worker | code |
| P14 | A | shouldRotateAccountsForJob unit hermes/eni no rotate | unit |
| P15 | A | smoke V vault 5→5; multi rotate policy | live |
| P16 | A | scripts/bridge-smoke.mjs matrix + --quick PASS | live |
| P17 | A | eyes cache path existing + worker getEyesCache | existing unit suite |
| P18 | A | dppContext inject already in messagesToPrompt; budget 12k in openai parse | existing |
| P19 | A | selectMemories budget 600 in worker when loadMemories | existing |
| P20 | A | CPA :8317 dspp/ds/octopus → cpa-ok | live |
| P21 | A | UPSTREAM_UPDATE bridge checklist P21 | doc |
| P22 | A | lastJob on health; tools.promptChars wired from worker | live+code |
| P23 | A | eni life tests green after timestamp fix | unit |
| P24 | A | this doc + AUTONOMOUS_STATUS truth-up (no stale reload-empty) | doc |
| P25 | A | 113 tests; full smoke PASS; ENI+CPA live; vault 5→5 | freeze |

## Autonomy

Continue P0→P25 without re-asking. User approved long-horizon autonomous goal 2026-07-10.
