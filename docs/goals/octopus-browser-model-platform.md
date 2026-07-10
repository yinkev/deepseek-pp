# Goal: Octopus browser model platform (harness-agnostic)


> **STALE PATHS (2026-07-10):** This goal doc may still mention `/Users/kyin/Projects/deepseek-pp-platform` or dual worktrees. **Ignore those paths.** Only `/Users/kyin/Projects/deepseek-pp` exists. Chrome load: `dist/chrome-mv3` under that repo. See [docs/INDEX.md](../INDEX.md) and [docs/bridge/PLATFORM-WORK-LOG.md](../bridge/PLATFORM-WORK-LOG.md).

**Status:** superseded in part by platform P0–P4 sticky runtime — see docs/goals/platform-p0-p4-e2e.md  
**Date:** 2026-07-09  
**Working tree:** `/Users/kyin/Projects/deepseek-pp` only  
**Feature branch:** `local/browser-origin-api`  
**Supersedes partial naming in older roadmap rows where they conflict**

### Implementation progress

| Phase | Status |
|---|---|
| P0 naming + expert default | done in code |
| P1 image ingest + host assets | done in code |
| P2 eyes subcall → expert main | done in code |
| P3 profiles (header + heuristic) | done in code |
| P4 FIFO queue (no hard busy 503) | done in host |
| Live smoke (Chrome reload + image) | pending operator |

## Objective (one sentence)

Ship a harness-agnostic OpenAI-compatible browser-origin DeepSeek backend whose default model is **`ds/octopus` (expert)** and whose vision path is **`ds/octopus-eyes`**, with automatic “eyes notes” injection so expert can use images without replacing the whole turn with vision — verified by live completions from Cursor/CLIProxyAPI/curl while Chrome + DeepSeek++ own the website call.

## Done when (evidence)

1. **Default brain**
   - `ds/octopus` maps to DeepSeek `model_type=expert`
   - `POST /v1/chat/completions` with a normal research prompt returns a full expert-quality answer (not greeting loop; not truncated opening)
2. **Eyes model**
   - `ds/octopus-eyes` maps to `model_type=vision`
   - Image-bearing OpenAI message content can complete via eyes (upload + vision turn)
3. **Eyes-as-tool for expert**
   - Request to `ds/octopus` with at least one image part:
     - runs an internal vision subcall (or equivalent)
     - main streamed answer is still expert reasoning over text + eyes notes
     - non-image history/prompt is preserved (not dropped)
   - Verified with a real screenshot + a text question about it
4. **Harness agnostic**
   - Same model ids work via CLIProxyAPI for Cursor and for a non-Cursor OpenAI client (curl or Hermes config)
   - No second bridge/extension per harness
5. **Profiles**
   - Best-effort profile detection + optional `X-DPP-Client` header
   - Cursor-sized agent system dumps still stripped
6. **Hard rules still true**
   - No official DeepSeek API
   - No ds2api-class headless token reverse
   - No jshandler-based DeepSeek completion path

## In scope

- Model id surface: `ds/octopus`, `ds/octopus-eyes` (+ optional later think flag)
- Worker routing: expert default, vision for eyes, eyes-notes pipeline
- OpenAI image part parsing → upload → vision caption/notes → expert main turn
- Client profiles: generic / cursor / hermes
- CLIProxyAPI provider rows for both model ids
- Docs: try-it-out + roadmap alignment
- Tests for prompt compile, image part extraction, eyes-notes injection shape

## Out of scope (this goal)

- Reimplementing Cursor/Hermes filesystem tools inside the extension
- Building a custom CLIProxyAPI native plugin to replace the host
- Using jshandler to call chat.deepseek.com
- Official DeepSeek API fallback
- Perfect 100% harness fingerprinting
- Multi-agent orchestration product beyond single completion (+ internal eyes subcall)

## Architecture (locked)

```text
Any harness (Cursor / Hermes / curl)
  → CLIProxyAPI (optional front door)
    → native host :8787  (OpenAI surface only)
      → DeepSeek++ worker
          ├─ ds/octopus       → expert completion
          ├─ ds/octopus-eyes  → vision completion
          └─ ds/octopus + images
                 → eyes subcall(s) → notes
                 → expert main call with notes injected
          → browser-origin DeepSeek web (cookies + PoW)
```

### jshandler

Optional side car for **logging / light rewrite only**.  
Not on the critical path for octopus completions.

## Implementation phases (autonomous order)

### P0 — Naming + expert default
- Map `ds/octopus` → expert
- Map `ds/octopus-eyes` → vision
- Update host models list, CLIProxyAPI rows, tests, docs
- **Verify:** text-only expert completion still works

### P1 — Image ingest
- Parse OpenAI image_url / input_image / data URL parts
- Upload via existing `uploadDeepSeekFile`
- **Verify:** unit tests for extraction; live upload if headers present

### P2 — Eyes subcall + expert main
- Internal vision job → bounded notes block
- Expert main job streams to client
- **Verify:** image+question returns expert answer that references image content; opening not truncated

### P3 — Profiles
- `X-DPP-Client` + heuristics
- **Verify:** Cursor dump still sanitized; generic Hermes-like system doesn’t force Cursor-only behavior

### P4 — Reliability
- Queue instead of hard busy where safe
- History fallback if stream empty
- **Verify:** two serial jobs; no permanent busy stuck

## Stop conditions (ask human)

- Account risk / suspension signals on normal web chat
- DeepSeek blocks vision uploads from extension path
- Need OS file-read permissions beyond current native host scope
- Product wants eyes as an explicit OpenAI tool only (no auto) — policy fork

## Success metrics

| Metric | Target |
|---|---|
| Text expert answer | ≥1 real multi-paragraph answer, no greeting loop |
| Eyes auto path | ≥1 image+question success |
| Model list | both ids visible on `/v1/models` when ready |
| Harness | curl and Cursor both succeed on same host |
| Regression | existing protocol unit tests pass |

## Non-goals reminder

This is **not** “make jshandler talk to DeepSeek.”  
This is **not** “one model id per harness.”  
This is **not** “vision replaces expert for the whole chat.”
