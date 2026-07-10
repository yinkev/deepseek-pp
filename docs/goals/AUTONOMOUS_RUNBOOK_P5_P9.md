# Autonomous runbook — P5–P9 daily driver

**For:** agents executing while the human is away  
**Date:** 2026-07-09  
**Human intent:** plan thoroughly, then work as long as needed without check-ins  
**Primary goal doc:** `docs/goals/platform-p5-p9-daily-driver.md`  
**Prior goal (done in code):** `docs/goals/platform-p0-p4-e2e.md`

---

## 0. Snapshot at plan time (do not assume — re-verify)

| Item | Value at 2026-07-09 |
|---|---|
| Worktree | `/Users/kyin/Projects/deepseek-pp-platform` |
| Branch | `local/platform-p0-p4` (dirty: P0–P4 sticky + docs uncommitted) |
| Main worktree | `/Users/kyin/Projects/deepseek-pp` on `main` |
| Remotes | `origin` = zhu upstream; `fork` = user remote |
| Extension id (Chrome host) | `chhlagfdfeanaefgbdbgmdlpgaoahhbi` |
| Host install | `npm run cursor-bridge:install -- --extension-id chhlagfdfeanaefgbdbgmdlpgaoahhbi` |
| Load path | `/Users/kyin/Projects/deepseek-pp-platform/dist/chrome-mv3` |
| Bridge | `http://127.0.0.1:8787/v1` (was healthy when human reloaded) |
| Models | `ds/octopus`, `ds/octopus-eyes`, `ds/squid` |
| CLIProxyAPI | `/Users/kyin/cliproxyapi/config.yaml` already lists three models |

**First action every autonomous session:**  
`cd /Users/kyin/Projects/deepseek-pp-platform && git status -sb && curl -sS http://127.0.0.1:8787/v1/health | head -c 400`

If health fails: reinstall host, note that human must keep Chrome + DeepSeek tab open — agent cannot click Chrome reload; work offline (tests/build) until live checks possible.

---

## 1. Pre-approved decisions (do not ask)

Human stepped away and wants long autonomous work. Treat these as **already approved**:

| Decision | Approval |
|---|---|
| Commit P0–P4 + plan docs on platform branch | **YES** (conventional commits) |
| Push to `fork` only (never force `origin`/zhu) | **YES** |
| Create branch `local/platform-p5-p9` from post-P5 tip | **YES** |
| FF-merge into local `main` + push `fork/main` when clean | **YES** |
| Checkpoint branch/tag after P5 | **YES** |
| Edit `core/cursor-bridge/*`, host `.mjs`, tests, goal docs | **YES** |
| Edit CLIProxyAPI docs/config for headers/models only | **YES** (no unrelated CPA rewrites) |
| Live smokes with real questions (relationships, technical, image if available) | **YES** |
| Skip P9 if timeboxed or P6–P8 flaky | **YES** |
| Skip chat folders / multi-agent / official API forever in this run | **YES — hard no** |

### Still stop and leave a note (do not grind)

| Condition | Action |
|---|---|
| DeepSeek account ban risk / captcha / hard auth death | STOP; write `docs/goals/AUTONOMOUS_STATUS.md` |
| `origin` (zhu) needs force or history rewrite | STOP |
| Unrelated dirty files in other projects | leave alone |
| Live smoke impossible (no Chrome/tab) after offline work done | finish P5–P7 offline evidence; mark P8 blocked in status file |
| Product fork (e.g. rename all models again) | do not invent; stick to plan |

---

## 2. Hard rules (never break)

1. Browser-origin DeepSeek only — no official API, no ds2api-class reverse  
2. No multi-agent orchestration  
3. No chat-folder / project-taxonomy product  
4. No jshandler DeepSeek completions  
5. Surgical diffs; no drive-by refactors  
6. Real questions in live tests — never “2+2” / “reply ok”  
7. README stays user-facing only (no internal API path dumps)  
8. Do not `git push --force` to `origin`; `fork` force-with-lease only if already established pattern and required for alignment  
9. Prefer worktree `deepseek-pp-platform`; do not thrash `deepseek-pp` main checkout unless merging  

---

## 3. Execution order (strict)

```text
BOOT → P5 → P6 → P7 → P8 → P9a? → P9b? → FREEZE → STATUS
```

Do **not** start P9 until P6–P8 green (or P8 blocked only by missing browser with offline code complete).

---

## 4. Phase playbooks

### BOOT

```bash
cd /Users/kyin/Projects/deepseek-pp-platform
git status -sb
git branch -vv
curl -sS --max-time 3 http://127.0.0.1:8787/v1/health || true
# ensure deps
[ -d node_modules ] || ln -sfn /Users/kyin/Projects/deepseek-pp/node_modules ./node_modules
npm run postinstall 2>/dev/null || true
```

Write/overwrite `docs/goals/AUTONOMOUS_STATUS.md` with start timestamp + HEAD.

---

### P5 — Land + freeze

**Goal:** uncommitted P0–P4 + plan docs are safely on `fork`.

1. Run bridge tests:  
   `./node_modules/.bin/vitest run tests/cursor-bridge-*.test.ts`
2. If fail → fix before commit  
3. Commit (one or two conventional commits), e.g.  
   - `feat(cursor-bridge): sticky threads, delta prompts, eyes cache, squid host`  
   - `docs: P0–P4 evidence + P5–P9 daily driver plan`
4. `git push -u fork HEAD`  
5. Optionally:  
   - from main worktree FF-merge platform branch  
   - `git push fork main`  
   - `git branch checkpoint/post-p0-p4-$(date +%Y%m%d) && git push fork checkpoint/...`
6. Create/switch `local/platform-p5-p9` for subsequent work  
7. Record SHA in `AUTONOMOUS_STATUS.md`

**P5 done:** clean tree (except intentional WIP), remote has commits.

---

### P6 — First-token reliability

**Symptom:** assistant text starts mid-word (` dynamic` vs `This dynamic`).

**Likely touch points**

- `core/interceptor/sse-parser.ts`  
- `core/deepseek/adapter.ts` (`readHistorySnapshot` / assistantText)  
- `core/cursor-bridge/worker.ts` (history reconcile + stream final text)

**Do**

1. Capture 1–2 live truncated examples if reproducible (save redacted fixture in tests)  
2. Fix root cause; prefer correct stream assembly over client-side hacks  
3. Non-stream final text must prefer full history when opening truncated  
4. Stream: do not double-send entire answer; fix at source if possible  
5. Tests: fixtures for SET/BATCH/opening truncation  
6. Live: 3 non-stream octopus completions with real prompts; first character must be letter/quote/markdown heading start — not mid-word fragment  

**P6 done:** tests green + 3/3 live clean opens (or 3/3 offline fixtures + 1 live if rate-limited).

---

### P7 — Sticky without manual headers

**Problem:** Cursor/Hermes won’t send `X-DPP-Thread-Id`.

**Do**

1. Harden `resolveThreadId` / fingerprint:  
   `clientProfile + modelFamily + first user content seed`  
   stable across multi-turn message arrays that prepend history  
2. Ensure worker uses fingerprint when header absent (already partial — verify)  
3. Host returns `X-DPP-Thread-Id` response header on chat completions  
4. Probe CLIProxyAPI header pass-through; document if Cursor cannot set headers (fingerprint still works)  
5. Unit: two jobs, no threadId, same first user message → same `chatSessionId`  
6. Live: 2-turn without header, real follow-up that requires prior context  

**P7 done:** unit + live reuse without header.

---

### P8 — Live multimodal smoke pack

**Do (when health ok)**

| # | Call | Pass criteria |
|---|---|---|
| 1 | GET `/v1/health` | ok, 3 models, features flags |
| 2 | octopus real text | ≥400 chars, no greeting loop |
| 3 | sticky follow-up no header | references prior content |
| 4 | squid short | coherent paragraph |
| 5 | octopus + image | expert answer uses visual detail; no INVALID_POW |

Image source: any small PNG/JPEG already on disk, or generate a minimal synthetic chart PNG in `/tmp` for upload. Prefer real screenshot if available under Downloads without leaking secrets.

**P8 done:** checklist all pass or blocked with reason in status file.

---

### P9a — Memory inject (optional)

Only if P6–P8 green and complexity stays small.

- Load memories via existing store  
- `selectMemories` + budget  
- Inject into `messagesToPrompt` or worker main prompt  
- **No** bridge-side `memory_save` loop  
- Unit test with fake memories  

Skip if store coupling is messy — note “deferred” in status.

---

### P9b — Light project pack (optional)

- Optional body field e.g. `dpp_project_pack` string or messages system segment already provided by harness  
- Prefer documenting “send context as system/user in harness” over building file watchers  
- If implemented: hard token cap (~2–4k tokens), no whole-repo crawl  

Skip if P9a already filled the session — one context feature is enough.

---

### FREEZE

1. `vitest` bridge tests  
2. `npm run build:chrome`  
3. Reinstall host with extension id  
4. Commit + push `fork`  
5. Update `platform-p5-p9-daily-driver.md` phase table to done/blocked  
6. Final `AUTONOMOUS_STATUS.md` with “try it out” for human return  

---

## 5. Live prompt bank (use these — not toy prompts)

**Turn A (octopus)**  
“When someone keeps a situationship warm with daily texts but never books real time, what hidden paths usually explain it — including ‘busy’ and ‘anxious attachment’ covers? Be concrete.”

**Turn B (sticky follow-up)**  
“If they also refuse labels but get jealous when I mention other people, which path is most likely and what should I do this week? Short decision tree.”

**Coding (octopus)**  
“I’m maintaining a browser-origin OpenAI bridge that sticky-sessions DeepSeek web chats. What failure modes make multi-turn agents re-greet or lose first stream tokens? Practical checklist.”

**Squid**  
One tight paragraph on the same situationship question — no capability menu.

**Vision**  
Any UI screenshot or diagram: “What is the user stuck on, and what’s the most likely next fix?”

---

## 6. Status file contract

Maintain `docs/goals/AUTONOMOUS_STATUS.md`:

```markdown
# Autonomous status
Updated: <ISO>
HEAD: <sha>
Phase: P5|P6|...
## Done
- ...
## In progress
- ...
## Blocked
- ...
## Evidence
- tests: ...
- live: ...
## When you return
1. Reload dist/chrome-mv3
2. curl health
3. ...
```

Update after every phase. Human should open this file first when back.

---

## 7. Time / scope budget (anti-thrash)

| If you’ve spent… | Then |
|---|---|
| >2h on P6 with no fix | ship best-effort history final-text fix + fixtures; continue P7 |
| >2h on P7 | ship fingerprint + response header; doc limitation; continue P8 |
| P9 unclear | skip both P9; freeze |
| Live blocked | complete offline; leave P8 for human 10 min |

Never open a new epic (tools loop, multi-agent, folder product) in this run.

---

## 8. Master prompt (paste to start autonomous work)

```text
You are continuing DeepSeek++ browser-origin bridge work.

READ AND OBEY:
- /Users/kyin/Projects/deepseek-pp-platform/docs/goals/AUTONOMOUS_RUNBOOK_P5_P9.md
- /Users/kyin/Projects/deepseek-pp-platform/docs/goals/platform-p5-p9-daily-driver.md

Working tree ONLY: /Users/kyin/Projects/deepseek-pp-platform

Execute BOOT → P5 → P6 → P7 → P8 → optional P9 → FREEZE.
Do not stop for permission on pre-approved items (commit/push fork, implement fixes, live smokes).
Stop only for account risk, zhu/origin force, or true product forks.
Real questions only for live tests.
Keep docs/goals/AUTONOMOUS_STATUS.md updated.
When finished, leave a short "when you return" section — I want to see DONE + try-it-out.

Browser-origin only. No multi-agent. No chat folder product. No official API.
```

---

## 9. Longer useful runway (AFTER P5–P8 green)

If P5–P8 finish fast, continue in order from:
`docs/goals/platform-p10-plus-useful-runway.md`

Default continuation: **P10 → P11 → P12 → P18 → P13 → P15** then optional P14/P16/P17/P19/P20.
Obey that doc’s **reject list** — no gimmicks.

## 9b. Horizon after this run (do not start now — park only)

If somehow P5–P9 finish early with time left, **park** these in status as “next backlog” — do not implement unless human already greenlit in this message (they did not for these):

1. Stream reasoning channel polish  
2. Queue depth / ETA in About status  
3. Rename package `cursor-bridge` → `browser-bridge` (cosmetic)  
4. Selective tool-result externalization for long agent turns  
5. Upstream merge drill using `docs/UPSTREAM_UPDATE.md`  

---

## 10. Definition of DONE for the away session

Human returns and can:

1. Open `AUTONOMOUS_STATUS.md` and see green P5–P8 (or honest blocks)  
2. Reload extension once and use `ds/octopus` in Cursor/Hermes without babysitting  
3. Trust sticky multi-turn + cleaner first tokens  
4. Know P9 shipped or explicitly deferred  

That is success — not infinite polish.
