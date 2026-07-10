# Goal: Platform P5–P9 daily driver (next E2E)

**Status:** planned (ready to execute after P0–P4 land)  
**Date:** 2026-07-09  
**Working tree:** `/Users/kyin/Projects/deepseek-pp-platform`  
**Branch:** `local/platform-p5-p9` (create from `local/platform-p0-p4` or aligned `main`)  
**Supersedes partial “Phase C/D” rows in older roadmap where they conflict**  
**Stop only for:** account risk, DeepSeek hard blocks, true product forks

## Objective (one sentence)

Make the browser-origin bridge a **daily driver** for Cursor + Hermes: freeze P0–P4, kill first-token chop, make sticky work without manual headers, prove multi-turn + vision live, then add only high-ROI context (optional memory inject + light project pack) — verified by unit tests, build, and live smokes with real questions.

## Why this sequence

| Already true after P0–P4 | Still hurts daily use |
|---|---|
| 3 models, eyes-as-tool, queue, sticky API | First tokens sometimes missing |
| Sticky works with `X-DPP-Thread-Id` | Cursor/Hermes rarely send that header |
| About status + `/health` | Operator still thinks in “is it broken?” |
| Live text E2E passed | Image path not re-proven after sticky rewrite |
| Uncommitted platform worktree | Easy to lose or diverge from `main` |

**Not in this goal (explicit):** multi-agent orchestration, chat folder taxonomy product, jshandler completions, official API, rebuilding DeepSeek++ project sidebar as source of truth.

## Phases (P5–P9)

### P5 — Land + freeze (git hygiene)

**Do**

- Commit all P0–P4 platform work on `local/platform-p0-p4` (or current platform branch)
- Push to `fork`
- FF-merge into local `main` when clean; push `fork/main` if you want remote aligned
- Tag or checkpoint: `checkpoint/post-p0-p4-daily-driver-base`
- Confirm operator load path still: `dist/chrome-mv3` + host install + DeepSeek tab

**Done when**

- `git status` clean on platform branch after commit
- `fork` has the commit
- One-line note in goal doc: base SHA recorded

**Evidence**

```bash
git log -1 --oneline
git status -sb
```

---

### P6 — First-token reliability (quality ROI #1)

**Problem:** live answers sometimes open mid-word (` dynamic` vs `This dynamic`).

**Do**

- Harden SSE assembly path (SET/BATCH edge cases still leaking)
- Make history fallback authoritative when opening looks truncated **and** improve non-stream final text always
- For stream clients: optional final corrective chunk only if safe; never double-append garbage
- Unit tests with real truncated-opening fixtures from live captures
- Live smoke: 3 consecutive non-stream octopus answers start with a complete first word (human-judged)

**Done when**

- Regression tests green
- 3/3 live non-stream completions start cleanly (no mid-word open)
- Stream path does not regress length/content vs non-stream for same prompt

**Out of P6**

- Full reasoning-channel redesign
- Perfect mid-stream rewrite for all clients

---

### P7 — Sticky that works for Cursor + Hermes (product ROI #1)

**Problem:** sticky exists but harnesses don’t send `thread_id`.

**Do**

1. **Server-side thread resolution (default on)**  
   - Prefer explicit: body `thread_id` / headers `X-DPP-Thread-Id`  
   - Else fingerprint: `clientProfile + model family + first user turn seed` (already partial)  
   - Improve fingerprint stability for multi-turn harness history (same first user message across turns)  
   - Document `reset_thread` / `X-DPP-Reset-Thread` for “new chat”

2. **CLIProxyAPI pass-through (if headers strip)**  
   - Verify Cursor → CPA → :8787 preserves custom headers  
   - If not: CPA config note or light proxy header map (no jshandler DeepSeek)

3. **Optional response metadata**  
   - Non-stream: include `thread_id` in a non-breaking extension field or echo header  
   - Host response header `X-DPP-Thread-Id` so clients can log it

4. **Live multi-turn without manual header**  
   - Two-turn flow that only sends OpenAI messages (no thread header) reuses same DeepSeek session

5. **Operator doc**  
   - “How sticky works in Cursor / Hermes / curl” in try-it-out (no API path spam in user README)

**Done when**

- Unit: second turn without explicit thread reuses `chatSessionId` when first user seed matches  
- Live: 2-turn octopus without `X-DPP-Thread-Id` continues context  
- Doc updated; status About shows last thread id after runs

**Out of P7**

- Auto-file chats into DeepSeek++ Projects/folders  
- Per-harness model ids

---

### P8 — Live multimodal + daily smoke pack (prove eyes after sticky)

**Do**

- Live: image + question on `ds/octopus` (auto-eyes → expert)  
- Live: same image on `ds/octopus-eyes` direct  
- Live: `ds/squid` short factual  
- Optional local evidence note under `docs/evidence/`  
- Confirm eyes cache behavior (unit already; live optional)

**Done when**

- Auto-eyes path returns expert-quality answer that uses visual detail  
- No `INVALID_POW` on upload  
- Smoke checklist checked once after P6–P7

**Smoke checklist (operator or agent)**

```text
[ ] GET /v1/health ok + 3 models
[ ] octopus real question (not 2+2)
[ ] sticky follow-up (with and without header)
[ ] squid one paragraph
[ ] octopus + image auto-eyes
```

---

### P9 — High-ROI context (optional, only if P6–P8 green)

Ship **at most** these two; skip if timeboxed.

#### P9a — Read-only memory inject into bridge (small)

- On each bridge job: load DeepSeek++ memories → existing `selectMemories` budget → inject short block into main prompt  
- **No** auto `memory_save` from bridge turns in this phase  
- Toggle: on if memories exist, or settings flag if easy  
- Client-agnostic: helps Cursor **and** Hermes without website UI

**Done when:** unit proves memories appear in prompt; live optional

#### P9b — Light project pack (coding daily driver)

- Optional request field or host-local pack: short “workspace summary” (paths + snippets), **not** whole repo dump  
- Cap tokens hard; profile-aware  
- Prefer harness-owned context long-term; this is a bridge helper only

**Done when:** unit + one Cursor-shaped multi-message completion includes pack without greeting loop

**Explicitly not P9**

- Chat folders / auto-sort into projects  
- Multi-agent orchestration  
- Full Cursor tool loop (read/edit/shell) — later epic if ever

---

## Order of execution (do not reorder casually)

```text
P5 land  →  P6 first-token  →  P7 sticky harness  →  P8 live multimodal  →  P9a/b optional
```

If blocked:

| Block | Action |
|---|---|
| Git conflict / dirty main | Finish P5 only; stop |
| DeepSeek account / PoW / 403 | Stop; report |
| CPA strips headers | Fix in P7; don’t invent second protocol |
| Memory inject fights prompt budget | Ship P9a behind flag or skip |

## Success metrics

| Metric | Target |
|---|---|
| Bridge unit tests | all `tests/cursor-bridge-*.test.ts` pass |
| Build | `npm run build:chrome` green |
| First-token | 3/3 live clean opens |
| Sticky without header | 1 live 2-turn reuse proven |
| Multimodal | 1 live auto-eyes success |
| Scope creep | zero folder product / multi-agent |

## Recommended defaults for *you*

| You live in… | Treat as source of truth | Use bridge for |
|---|---|---|
| Cursor | project folder + rules | octopus brain + sticky + eyes |
| Hermes | harness workspace / agent memory | same models + sticky + profiles |
| Web UI rarely | ignore DeepSeek++ project folders | optional memory inject only if P9a ships |

## Operator try-it-out (after P5–P8)

1. Reload `…/deepseek-pp-platform/dist/chrome-mv3`  
2. Open logged-in `chat.deepseek.com`  
3. `curl http://127.0.0.1:8787/v1/health`  
4. Real multi-turn without thread header  
5. One image on `ds/octopus`  

## Prompt to run this goal autonomously

```text
/define-goal Execute docs/goals/platform-p5-p9-daily-driver.md end-to-end on
/Users/kyin/Projects/deepseek-pp-platform. Do not stop until P5–P8 are done;
P9 only if P6–P8 green and time remains. Real questions only for live smokes.
Commit only if I asked, or ask once at P5. Browser-origin only. No multi-agent,
no chat folder product, no official API.
```

## Relationship to prior goals

| Doc | Role |
|---|---|
| `platform-p0-p4-e2e.md` | Shipped base (models, sticky API, eyes, queue) |
| `octopus-browser-model-platform.md` | Model surface + eyes design lock |
| **This doc** | Next daily-driver E2E |

## Phase table (execution board)

| Phase | Deliverable | Status |
|---|---|---|
| P5 | Commit/push/freeze P0–P4 base | planned |
| P6 | First-token / stream repair E2E | planned |
| P7 | Harness sticky without manual headers | planned |
| P8 | Live multimodal + smoke pack | planned |
| P9a | Optional memory inject (read-only) | planned optional |
| P9b | Optional light project pack | planned optional |

## Autonomous execution

Full away-session runbook: `docs/goals/AUTONOMOUS_RUNBOOK_P5_P9.md`  
Live status file: `docs/goals/AUTONOMOUS_STATUS.md`

## Longer runway (after P5–P9)

If P5–P8 finish early: continue **useful-only** phases in
`docs/goals/platform-p10-plus-useful-runway.md` (P10–P20).
**Reject list applies** — no folders product, no multi-agent, no gimmicks.
