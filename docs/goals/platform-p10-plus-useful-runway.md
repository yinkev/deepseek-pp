# Goal: P10+ useful runway (no gimmicks)


> **STALE PATHS (2026-07-10):** This goal doc may still mention `/Users/kyin/Projects/deepseek-pp-platform` or dual worktrees. **Ignore those paths.** Only `/Users/kyin/Projects/deepseek-pp` exists. Chrome load: `dist/chrome-mv3` under that repo. See [docs/INDEX.md](../INDEX.md) and [docs/bridge/PLATFORM-WORK-LOG.md](../bridge/PLATFORM-WORK-LOG.md).

**Status:** planned backlog for autonomous continuation after P5–P9  
**Date:** 2026-07-09  
**Audience:** you (Cursor + Hermes daily driver) + agent away sessions  
**Filter rule:** if it does not reduce pain in *your* loop, it is out.

## Your loop (inferred — source of truth)

```text
You live in Cursor and/or Hermes
  → OpenAI-compatible API
  → CLIProxyAPI (optional)
  → bridge :8787
  → Chrome + DeepSeek++ + logged-in chat.deepseek.com
  → DeepSeek web models (octopus / eyes / squid)
```

**What you actually need**

1. Reliable answers (no mid-word opens, no greeting loops)  
2. Multi-turn that feels like one conversation (sticky without babysitting)  
3. Vision when useful (eyes-as-tool)  
4. Enough project/context to code without pasting the world  
5. Failures that are diagnosable in 10 seconds  
6. Survives upstream zhu merges  

**What you do *not* need**

- Pretty chat folders / auto-sort theater  
- Multi-agent orchestration  
- “AI organizes my life” product surface  
- jshandler pretending to be DeepSeek  
- Official API  
- Renaming packages for aesthetics  
- More model names for sport  

---

## Already shipped / in flight

| Band | Phases | Job |
|---|---|---|
| Base | P0–P4 | Models, eyes tool, sticky API, delta, cache, status, queue |
| Daily driver | P5–P9 | Land git, first-token, harness sticky, live smoke, optional memory/pack |

Do **P5–P9 first**. Only then burn P10+.

---

## P10+ board (useful only)

Priority order is the execution order. Skip a phase only if blocked or already true.

### P10 — Operator “when broken” pack (high ROI)

**Pain:** “is it me, Chrome, login, or the model?”

**Ship**

- Host `/v1/health` already has flags → extend with: last error, last thread id, queue depth, uptime, sticky hit/miss counters  
- Sidepanel About: one **Copy diagnostics** button (JSON: readiness + last error + versions)  
- `docs/cursor-bridge-try-it-out.md`: 5-line troubleshooting only  

**Done when:** from a cold failure you can diagnose missing tab vs missing login vs busy vs upstream in one curl + About glance.

**Not gimmick:** this is time saved every bad day.

---

### P11 — Streaming correctness for Cursor (high ROI)

**Pain:** stream looks wrong even when final text is ok; Cursor UX suffers.

**Ship**

- Align stream chunks with final non-stream text for same job (tests)  
- If history repair fixes final text, ensure stream clients get a safe recovery path (document limitation if Cursor cannot rewrite)  
- Abort / cancel maps cleanly (client disconnect → abort DeepSeek job)

**Done when:** stream and non-stream parity tests; cancel does not leave zombie busy forever.

---

### P12 — Sticky lifecycle that matches how you chat (high ROI)

**Pain:** sticky is either sticky forever or reset is obscure.

**Ship**

- Explicit reset: `reset_thread` / header (exists) + document “new Cursor chat = new fingerprint seed” behavior  
- TTL + max turns per thread (avoid zombie web sessions)  
- Optional: response header `X-DPP-Thread-Id` + `X-DPP-Sticky: hit|miss`  
- Soft limit: if DeepSeek rejects parent_message_id, auto-new session once and mark sticky miss

**Done when:** multi-day use does not accumulate dead sessions; failed parent recovers without manual wipe.

---

### P13 — Context pack v1 for coding (high ROI if you code in Cursor)

**Pain:** octopus answers generic; your repo is the point.

**Ship (minimal, not a second Cursor)**

- Accept optional body field `dpp_context` or a single system message convention already sent by harness  
- Hard token budget (e.g. 2–4k tokens) + truncation  
- Inject after sanitized system, before latest user  
- Unit tests: pack present, greeting loop still suppressed  

**Do not ship:** filesystem crawler, auto-watch project root, secret scanning theater, “index whole monorepo”.

**Done when:** one Cursor-shaped request with a small file dump answers about *that* code.

**Note:** harness-owned context remains best practice; bridge only stops dropping/smashing it.

---

### P14 — Memory inject v1 (medium ROI — only if you keep prefs in DeepSeek++)

**Pain:** prefs live in extension but Hermes/Cursor never see them.

**Ship**

- Read-only: `selectMemories` → short block in bridge prompt  
- Budget hard-capped  
- No auto-save from bridge  

**Skip if:** you do not use DeepSeek++ memory UI at all — then harness memory wins; mark deferred.

**Done when:** unit shows inject; optional live with one saved memory.

---

### P15 — Rate / queue honesty (high ROI under parallel agents)

**Pain:** two Cursor tabs or Hermes + Cursor → mystery delays or failures.

**Ship**

- Queue position or `Retry-After` style signal when waiting  
- Health: `queueDepth`, `activeJobAgeMs`  
- Never silent infinite wait without progress  

**Done when:** second concurrent request waits predictably; health shows queue > 0.

---

### P16 — Eyes cost control (medium ROI if you use images often)

**Pain:** every image turn burns a full vision session.

**Ship**

- Eyes cache already exists → verify live + expose cache hit in status/debug  
- Cap images per turn (already 3)  
- Optional: skip eyes subcall if user message has no image-dependent ask *and* no images (noop)  
- Clear error if upload fails (POW) with fix hint  

**Done when:** repeated same image does not re-run vision subcall (unit + one live).

---

### P17 — CLIProxyAPI daily-driver polish (high ROI for your routing)

**Pain:** Cursor points at CPA; bridge is behind it.

**Ship**

- Confirm models list includes squid/octopus/eyes  
- Document which headers CPA forwards (`X-DPP-*`)  
- If headers stripped: rely on fingerprint sticky (P7) + document; only add CPA-side pass-through if trivial  
- No jshandler DeepSeek  

**Done when:** Cursor via CPA matches direct :8787 for models + a real completion.

---

### P18 — Regression harness (high ROI for autonomous safety)

**Pain:** we break sticky/eyes/first-token and only notice in Cursor.

**Ship**

- `scripts/bridge-smoke.mjs` (or similar): health → models → non-stream real question → optional sticky turn 2  
- Exit non-zero on fail  
- Run after build in autonomous FREEZE  

**Done when:** one command proves bridge alive without opening Cursor.

---

### P19 — Upstream survival kit (medium ROI, future-you)

**Pain:** zhu moves; local bridge dies.

**Ship**

- Keep bridge isolated (`core/cursor-bridge`, host package)  
- Thin background hook only  
- `docs/UPSTREAM_UPDATE.md` already — add “bridge checklist after merge” (tests + host reinstall + health)  
- No drive-by merge of unrelated upstream UI  

**Done when:** checklist exists and is linked from autonomous status.

---

### P20 — Observability for *your* debugging (medium ROI)

**Pain:** “what prompt did we actually send?” when model greets again.

**Ship**

- Debug flag / host-only endpoint or extension log ring buffer: last job model, sticky hit, prompt char length, eyes used, error  
- **Never** log full secrets/tokens; truncate prompts  
- Toggle default off  

**Done when:** you can see last prompt size + sticky hit without Chrome DevTools archaeology.

---

## Explicit reject list (do not implement as “more P#”)

| Idea | Why rejected for you |
|---|---|
| Auto-sort chats into projects/folders | You don’t live in web history; taxonomy ≠ leverage |
| Multi-agent orchestration | Out of scope; complexity without daily win |
| New model name every week | Confuses CPA/Cursor; three is enough |
| jshandler completions | Wrong layer; no browser origin |
| Official API fallback | You rejected account-risk path class |
| Full Cursor tool loop in extension | Huge epic; harness already has tools |
| Pet/theme/UI gimmicks on bridge path | Zero API value |
| Rename cursor-bridge package | Cosmetic; breaks installs |
| “Smart” auto memory_save from every agent turn | Noise + privacy + cost |

---

## Suggested autonomous bands while away

| Band | Phases | When |
|---|---|---|
| **Must** | P5–P8 | Always |
| **Should** | P9a or P9b (one only), P10, P11, P12, P18 | After must |
| **If time** | P13, P15, P16, P17 | After should |
| **Only if easy** | P14, P19, P20 | Last |
| **Never this run** | Reject list | — |

If P5–P8 finish fast: **do not invent work** — execute **P10 → P11 → P12 → P18 → P13 → P15** in that order.

---

## Phase table

| Phase | Deliverable | ROI | Status |
|---|---|---|---|
| P10 | Diagnostics pack (health + copy + troubleshoot) | high | planned |
| P11 | Stream/cancel parity | high | planned |
| P12 | Sticky lifecycle + parent recovery | high | planned |
| P13 | Context pack v1 (budgeted) | high (coding) | planned |
| P14 | Memory inject read-only | medium / skip if unused | planned |
| P15 | Queue honesty | high (parallel) | planned |
| P16 | Eyes cost control | medium | planned |
| P17 | CPA daily-driver verify | high | planned |
| P18 | `bridge-smoke` script | high | planned |
| P19 | Upstream merge checklist | medium | planned |
| P20 | Last-job debug ring (opt-in) | medium | planned |

---

## Master prompt (long runway)

```text
READ AND OBEY:
- docs/goals/AUTONOMOUS_RUNBOOK_P5_P9.md
- docs/goals/platform-p5-p9-daily-driver.md
- docs/goals/platform-p10-plus-useful-runway.md

Worktree: /Users/kyin/Projects/deepseek-pp-platform

Execute P5→P8 first. Then continue P10→P12→P18→P13→P15→… per useful runway.
Skip anything on the reject list. No gimmicks. Real live questions only.
Update docs/goals/AUTONOMOUS_STATUS.md continuously.
Pre-approved: commit/push fork, implement, smoke.
Stop only: account risk, origin force, product forks.
When I return: DONE + try-it-out in AUTONOMOUS_STATUS.md.
```
