# Roadmap — browser-origin Cursor API (long horizon)

**Status:** living plan after v1 vertical slice  
**Date:** 2026-07-09  
**Feature branch:** `local/browser-origin-api`  
**Intent (inferred):** Make `ds/octopus*` feel like a real Cursor coding model — project-aware, tool-capable, mode-rich — while every DeepSeek call stays **browser-origin** via DeepSeek++ (never official API, never ds2api-class).

## What we already have (v1)

```text
Cursor → CLIProxyAPI → native host :8787 → DeepSeek++ SW → web adapter → chat.deepseek.com
```

- Models: `ds/octopus` (expert), `ds/octopus-eyes` (vision + auto eyes notes)
- Stream + non-stream OpenAI surface
- Readiness (tab + login + busy)
- Prompt compile that strips Cursor agent system dumps and elevates latest user ask
- SSE extraction for SET + relative BATCH fragment paths

### What v1 deliberately does **not** do

| Missing | Why it hurts |
|---|---|
| Project folder / workspace context | Model answers general knowledge, not *this* repo |
| Tool loop (read/edit/search/shell) | Cannot act like Cursor agent |
| Multi-turn DeepSeek session continuity | Every request = new chat session; history only if re-embedded |
| Model modes: expert / vision / search | Hardcoded `modelType: 'default'`, no uploads, no search |
| DeepSeek++ memory / skills / presets on bridge path | Bypass-hook path skips page injection |
| Queue instead of hard busy | Parallel Cursor turns 503 |
| Reasoning channel for thinking model | Thinking enabled but not exposed as structured stream |
| Status UI | Failures feel like “model broken” |

## Hard rules (do not break)

1. Browser-origin only for DeepSeek website traffic  
2. No official DeepSeek API on this path  
3. No headless token reverse  
4. Isolated packages: `core/cursor-bridge`, `packages/cursor-bridge-host`  
5. Thin hook only in `entrypoints/background.ts`  
6. No secrets in repo  

## Harness-agnostic design (Cursor, Hermes, raw OpenAI, …)

### What is already client-agnostic

Anything that speaks **OpenAI Chat Completions** can use the bridge:

```text
Any harness
  → (optional) CLIProxyAPI
    → http://127.0.0.1:8787/v1
      → DeepSeek++ browser-origin worker
```

| Surface | Agnostic? |
|---|---|
| `GET /v1/models` | Yes |
| `POST /v1/chat/completions` (+ stream) | Yes |
| Model ids `ds/octopus*` | Yes (product brand, not Cursor-only) |
| Native host + extension worker | Yes (infra) |
| Browser-origin hard rule | Yes |

**Cursor is only the first client.** Hermes, OpenClaw-style agents, curl, Continue, Aider, custom scripts — same endpoint if they can set `base_url` + `api_key` + model name.

### What is *not* fully agnostic today (fix later, not fork)

| Coupling | Reality |
|---|---|
| Package/folder names `cursor-bridge` | Historical; rename later to `openai-bridge` / `browser-bridge` if desired — **not required for Hermes** |
| Native host id `com.deepseek_pp.cursor_bridge` | Install-time name; keep stable or alias |
| Prompt sanitizer detects “Cursor coding agent” system dumps | **Client profile** should be: `cursor` \| `hermes` \| `generic` |
| CLIProxyAPI provider name `DeepSeekPPBrowser` | Shared front door for all harnesses |

### How to organize (recommended)

**One backend. Many client profiles. Stable model labels.**

```text
ds/octopus*          = model capability labels (what brain / mode)
client profile       = how we compile prompts for that harness
CLIProxyAPI prefix   = optional routing sugar (dspp/…), not a second product
```

| Layer | Examples | Rule |
|---|---|---|
| **Capability models** | `ds/octopus`, `ds/octopus-expert`, `ds/octopus-vision` | Same ids for every harness |
| **Client profiles** | `generic` (default), `cursor`, `hermes` | Prompt compile + tool policy defaults |
| **Proxy aliases** | `dspp/ds/octopus`, `hermes-ds` if you want | Optional; map to same capability id |
| **Do not create** | `ds/octopus-cursor` vs `ds/octopus-hermes` as separate brains | Duplicates product surface |

### Hermes specifically

Hermes (or any agent with OpenAI-compatible provider config) should:

1. Point `base_url` at `http://127.0.0.1:8317/v1` (via CLIProxyAPI) **or** `http://127.0.0.1:8787/v1` (direct)  
2. Use model `ds/octopus` / future `ds/octopus-expert`  
3. Keep Chrome + DeepSeek++ + logged-in tab running (same as Cursor)  
4. **Not** require a second extension  

If Hermes sends a huge “you are Hermes agent with tools…” system prompt, treat it like Cursor: **profile=`hermes`** strips/replaces agent boilerplate and elevates the latest user task. Same bug class, same fix class.

### Tool ownership by harness

| Harness | Who owns workspace tools? | Bridge default |
|---|---|---|
| **Cursor** | Cursor | `tools: off` on plain models |
| **Hermes** | Hermes | `tools: off` on plain models; optional `*-tools` for DeepSeek++-only powers |
| **Raw curl / dumb client** | Nobody | Optional extension tool loop more valuable |

Never build one mega-agent that reimplements every harness’s tools inside DeepSeek++.

### Naming migration (optional, low urgency)

| Today | Future-friendly |
|---|---|
| `cursor-bridge` packages | keep until rename is free; docs can say **browser OpenAI bridge** |
| User-facing docs | “DeepSeek++ local OpenAI bridge” (not “Cursor-only”) |
| Model owned_by | `deepseek-pp-browser-bridge` |

Rename code when it stops shipping value — **do not block Hermes on a rename.**

## Domain glossary (bridge era)

| Term | Meaning |
|---|---|
| **Bridge path** | Cursor → host → extension worker → adapter (bypass fetch-hook) |
| **Page path** | User types on chat.deepseek.com; fetch-hook injects memory/tools |
| **Expert** | DeepSeek `model_type=expert` (reasoner-class); web UI may lack uploads/tools — **we** can still attach our tool protocol |
| **Vision** | `model_type=vision` + `ref_file_ids` image uploads |
| **Instant / default** | `model_type=default` (current bridge default) |
| **Pseudo tool-use** | Model emits XML/tool blocks; extension executes; result re-injected as next prompt |
| **Project context** | Text snapshot of the active Cursor workspace (not DeepSeek++ “project” UI unless we map them) |

## Architecture truth: two brains

```text
Cursor already has: tools, workspace, agent loop, system prompt
DeepSeek++ already has: memory, skills, presets, tool descriptors, PoW, web adapter, model modes
Bridge today: only the web completion pipe between them
```

**Long-horizon product decision (locked recommendation):**

- **Cursor remains the agent runtime** for filesystem / terminal / IDE tools when the user is *in Cursor*.  
- **DeepSeek++ remains the model runtime** (browser-origin completion + optional memory/skills + expert/vision).  
- **Bridge becomes a smarter model backend**, not a second full agent that fights Cursor.

That means “give project access” is mostly:

1. **Context packing** into the prompt (or tool results Cursor already sends), and/or  
2. **Optional tool loop inside the extension** only for capabilities Cursor does not own (web search, DeepSeek++ memory, browser control) — not re-implementing `read_file` for the open workspace unless Cursor is *not* the client.

When the client **is** Cursor: prefer teaching the model with packed context + letting Cursor tools run.  
When the client is **raw OpenAI** (curl, other apps): extension-side tool loop becomes more valuable.

## Phased roadmap

### Phase A — Stability (ship next)

1. **Job queue** — replace hard busy 503 with FIFO + timeout  
2. **Host lifecycle** — survive SW sleep without dropping in-flight jobs  
3. **Sidepanel bridge badge** — connected / ready / last error (no secrets)  
4. **History fallback** — if stream text empty/truncated, reconcile via `history_messages`  
5. **Observability** — job id, prompt chars, answer chars, mode (no content logs by default)

**Done when:** parallel Cursor turns rarely fail; failures are visible in UI.

### Phase B — Model surface + eyes (LOCKED 2026-07-09)

Canonical goal doc: `docs/goals/octopus-browser-model-platform.md`

| Model id | DeepSeek `model_type` | Role |
|---|---|---|
| `ds/octopus` | **`expert`** | Default brain (user sets web default to expert) |
| `ds/octopus-eyes` | **`vision`** | Vision brain + internal eyes subcall target |

Worker today hardcodes `modelType: 'default'` → change default mapping to **expert**.

**Eyes-as-tool (best practice):** when `ds/octopus` receives image parts, run internal vision subcall(s) → bounded eyes notes → expert main turn streams to client. Do **not** replace the whole expert turn with vision. Do **not** implement this in jshandler.

**Profiles:** `generic` / `cursor` / `hermes` — auto-detect best-effort + optional `X-DPP-Client`. Same model ids for all harnesses.

**jshandler:** logging / light proxy intercept only. Never DeepSeek completions.

**Done when:** expert text works; image+question on `ds/octopus` uses eyes notes; `ds/octopus-eyes` listed and usable.

### Phase C — Project alignment (Cursor workspace)

**Problem:** Cursor knows the open folder; DeepSeek does not.

**Do not** try to make DeepSeek++ “own” the Cursor project by default. Align them:

#### C1 — Passive context (fastest)

When request includes (in order of preference):

1. OpenAI `messages` already containing file excerpts (Cursor often does this) → keep prompt compiler smart about size  
2. Optional bridge header / body field: `x-cursor-workspace` / `metadata.project_root` (if we add a tiny Cursor-side helper later)  
3. DeepSeek++ **project context** store if user linked a conversation  

Compile into:

```text
[workspace summary]
- root: ...
- key files: ...
- open files / selection: ...
```

Budget-capped (token estimate already exists in memory selector).

#### C2 — Active tools (only where needed)

| Client | Project tools |
|---|---|
| **Cursor** | Prefer Cursor’s native tools; model returns text/edits; Cursor applies |
| **Non-Cursor OpenAI client** | Extension tool loop can offer limited read via user-granted folder (native host file access) — higher risk, opt-in |

#### C3 — “DeepSeek++ Extension” role

Yes — **the extension is always required** as the browser worker.  
No — the extension should **not** become a second Cursor. Its job:

- own login + PoW + completion  
- optional memory/skills  
- optional extension-only tools (search, browser, memory_save)  
- optional workspace **summary** injection if we feed it paths  

**Done when:** asking “what does this repo’s X module do?” with Cursor open yields repo-specific answers, not generic essays.

### Phase D — Tooling / agentic enhancement

Reuse, don’t rewrite:

| Existing | Bridge use |
|---|---|
| `buildPromptAugmentation` | Optional system + tools + memory |
| `XmlToolStreamFilter` / tool parser | Strip tool XML from user-visible stream |
| Sidepanel / automation tool executor | Run tool calls mid-job |
| `inline-agent` loop | Pattern for multi-turn parent_message_id |
| Shell MCP / browser control | Advanced tools (gated) |

**Policy flags on job / model:**

- `tools: off | deepseek_pp | all`  
- `memory: off | on`  
- `skills: off | on`  

Default for Cursor: **tools off, memory off** (Cursor already tools; avoid double agents).  
Opt-in models: `ds/octopus-expert-tools` with DeepSeek++ tools enabled.

**Done when:** expert model can web-search / save memory / run approved tools without Cursor fighting it.

### Phase E — Multimodal

- Accept OpenAI image parts in `messages[].content[]`  
- Upload via existing `uploadDeepSeekFile` + `modelType: 'vision'`  
- Model id `ds/octopus-vision`

**Done when:** paste screenshot in Cursor → vision path → useful answer.

### Phase F — Product polish

- Reasoning stream for thinking models  
- Session map: Cursor conversation id → one DeepSeek session  
- Rate / fairness limits  
- Health script for CLIProxyAPI provider  
- Optional “bridge system prompt” presets (research / coding / concise) without Cursor dump

## Suggested work order (autonomous default)

If continuing without re-asking:

1. **Phase B model modes** (expert + thinking mapping) — small, reuses adapter  
2. **Phase A queue + history fallback** — reliability  
3. **Phase C1 context packing** — project alignment for Cursor  
4. **Phase D opt-in tools on expert** — your “expert has no tools on web” fix  
5. **Phase E vision**  
6. **Phase F polish**

Stop and ask only if: account risk, need filesystem native host permissions beyond current install, or conflict with Cursor’s own agent tools design.

## What not to do

- Rebuild Cursor tools inside DeepSeek++ for Cursor users  
- Point bridge at official DeepSeek API “just for tools”  
- Reintroduce ds2api  
- Inject full Cursor system prompt into DeepSeek again  
- Enable all tools by default on every `ds/octopus` call (double-agent chaos)

## Success metrics (long horizon)

1. Cursor research/coding questions stay on-topic (no greeting loops) — **met in v1**  
2. Expert mode selectable and clearly stronger on hard problems  
3. Repo-specific answers when workspace context is present  
4. Opt-in tool loop works for web/search/memory without breaking Cursor  
5. Vision path for screenshots  
6. Upstream merge still thin-hook only  

## Related docs

- `docs/goals/browser-origin-cursor-api.md` — v1 goal / hard rules  
- `docs/cursor-bridge-try-it-out.md` — operator steps  
- `/Users/kyin/cliproxyapi/docs/DEEPSEEK_PP_BROWSER_BRIDGE.md` — proxy wiring  
