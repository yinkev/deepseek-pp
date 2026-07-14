# Session closeout — Wave 1 sandbox + tool-results + fail-closed persistence

**Date:** 2026-07-13 (local Pacific; commit timestamps `-0700`)  
**Repo:** `/Users/kyin/Projects/Deepseek-pp` (case-insensitive FS also reachable as `deepseek-pp`)  
**Branch:** `codex/provider-conversation-persistence`  
**Range documented:** `04a65f42` (merge origin/main) → `ad7c7d91` (HEAD)  
**HEAD at documentation time:** `ad7c7d91de07c0438634b8658f9862ce6fe8a6b4`  
**Fork remote tip:** `fork/codex/provider-conversation-persistence` = `750577bf` (**local ahead by 9**)  
**Push / origin / PR:** **not performed** (explicit user preference: commit only; no origin push to zhu)  
**Chrome load path (live smoke):** extension `dist/chrome-mv3` reloaded by user  

---

## 1. Executive summary

This session closed **Wave 1** of post–upstream-merge work on DeepSeek++:

1. **Sidepanel sandbox on DeepSeek legacy chat paths** — execute `sandbox_run` when the catalog is not hydrated (legacy web/official loops), hide streamed tool XML, inject sandbox into the sidepanel tool catalog without advertising it in the public page catalog.
2. **Page (content) hide of internal tool-results / sandbox protocol** — JSON/XML-aware envelope classification; hide only genuine internal envelopes; keep user-authored split examples visible.
3. **Fail-closed conversation load** — distinguish *absent* storage (fresh chat; status `absent`) from *present but invalid/future* records (status `invalid`; block hydrate/autosave; never overwrite corrupt data).
4. **Cursor-bridge vault test isolation** — reset module-global vault between worker tests so `missing_login` stays deterministic.
5. **SOL xhigh reverify ladder** — FAIL through rounds #1–#11; **#12 PASS_WITH_WARNINGS** on behavior; polish commit `ad7c7d91` pins the remaining adjacency/legacy matrix in tests.
6. **Live user smoke (sidepanel + page)** — unfakeable JSON result `{"t":1750807910634,"r":887,"sum":31}` observed in both UIs after reload.
7. **Ops clarification** — CLIProxy stderr about missing `deepseek_web_route_logger.js` is **historical noise**; current `jshandler` points only at existing `omlx_prompt_inspector.js`. **Do not delete** proxy config/plugins for that line.

**Product outcome:** Sandbox tool execution and internal protocol hygiene work on **sidepanel legacy + page content** paths; durable chat load fails closed; automated gates green at close of day; live dual-surface smoke passed.

---

## 2. Goals, constraints, non-goals

### Goals (delivered this session)

| ID | Goal | Status |
|----|------|--------|
| G1 | Sandbox executes on DeepSeek **legacy** sidepanel path (not only hydrated provider path) | Done |
| G2 | Streamed sandbox/tool XML not shown as final user-visible answer on that path | Done |
| G3 | Page content hides internal `[TOOL_RESULTS]` / sandbox continuation bubbles | Done |
| G4 | Fail-closed load for corrupt/future conversation records | Done |
| G5 | SOL grades until non-FAIL on Wave 1 claims; pin test matrix for warnings | Done (#12 PWW → test pin) |
| G6 | Live smoke sidepanel + page with unfakeable JSON | Done (user screenshots) |

### Hard constraints (session / standing)

- Surgical changes; KISS; no invented Qwen cursor fix without fixtures.
- Fail-closed data: never silently heal corrupt conversation storage by overwrite.
- Separate **page hide** (visibility/DOM) from **tool execution** (sidepanel/background).
- Do **not** push to `origin` (zhu). Fork push only if user explicitly authorizes (they said commit only).
- `internal/translator`-style rules apply to CLIProxy work; **this session’s code work was Deepseek-pp**, not CLIProxy source.
- Timeouts after upstream connection established: N/A for extension work; no new network timeouts introduced here.

### Explicit non-goals (not done, not claimed)

- Qwen P1-1 cursor / response-id transport fix (needs fixtures; deferred).
- Multi-chat history browsing / export / continuity toggle (roadmap).
- Pushing branch to fork or opening PR.
- “Fixing” CLIProxy missing-logger stderr by deleting files (correct action: **none**).
- Advertising sandbox in the **public page** tool catalog (intentionally excluded).

---

## 3. Chronological timeline

Times are commit timestamps on 2026-07-13 `-0700` unless noted.

| When | Event |
|------|--------|
| 14:13 | `04a65f42` merge `origin/main` through `16eec9a` (baseline for this wave) |
| 14:46 | `210830a7` sidepanel sandbox on legacy DeepSeek path + streaming hide |
| 14:55 | `750577bf` behavioral tests for legacy stream; helper extraction |
| ~15:00–16:00 | SOL sandbox diagnosis + verify notes under `/tmp/codex-sol-sandbox-*` |
| 17:03 | Batch: fail-closed store (`c5af5976`), page hide (`6fc320d2`), sidepanel extractCalls (`8b385c79`), vault reset test (`8948c261`) |
| 17:19–18:09 | Hardening loop on tool-results parse/hide under SOL FAIL #7–#11 |
| 18:09 | `35f6ad33` JSON-aware envelope, **no marker rewrite** |
| 18:17 | SOL reverify **#12 GRADE: PASS_WITH_WARNINGS** (behavior pass; test matrix gap) |
| 19:06 | `ad7c7d91` pin full adjacency + legacy wrapper matrix (closes #12 warning intent) |
| Evening | User reload + live smoke sidepanel + page; JSON `sum:31` |
| Evening | Log check: no extension disk logs for sandbox; proxy healthy; old logger stderr explained → **do nothing / do not delete** |

---

## 4. Commit inventory (merge → HEAD)

Parent of wave: **`04a65f42`** `merge: integrate origin/main through 16eec9a`.

| SHA | Subject | Intent (1 line) |
|-----|---------|-----------------|
| `210830a7` | fix(sidepanel): execute sandbox tools on DeepSeek legacy chat path | Shared sidepanel catalog + sandbox; stream accumulator; auth banner coherence |
| `750577bf` | test(sidepanel): cover legacy sandbox stream execution path | Extract `createSidepanelLegacyToolStream`; prove hide + single execute |
| `c5af5976` | fix(chat): fail closed on invalid conversation state | `absent` vs `invalid`; ChatPage does not hydrate/overwrite corrupt |
| `6fc320d2` | fix(content): hide internal sandbox transcript protocol | Page cleanup recognizes sandbox + strict TOOL_RESULTS continuations |
| `8b385c79` | fix(sidepanel): parse fallback legacy tool text | `extractCalls(fullText)` so fallback-only XML still runs once |
| `8948c261` | test(cursor-bridge): reset account vault between worker cases | `__resetBridgeAccountVaultForTests()`; no cross-test vault leak |
| `07707bab` | fix(content): harden tool-results close boundary and generator tests | First valid outer close; generator + observer coverage |
| `573c9273` | fix(content): tighten tool-results payload and split-example hide | Require real JSON/XML payload; split user examples stay visible |
| `99d3d936` | fix(content): preserve JSON-string markers in tool-results parse | Do not treat close markers inside JSON strings as structure |
| `35f6ad33` | fix(content): parse tool-results envelope without marker rewrite | Normalizer = CRLF→LF only; JSON/XML-aware envelope measure |
| `ad7c7d91` | test(content): pin tool-results adjacency and legacy wrapper matrix | Commit full summary/detail/output + legacy name/malformed pins |

**Diffstat (04a65f42..ad7c7d91):** 23 files, **+2113 / −116**.

### Files touched (by role)

| Area | Paths |
|------|--------|
| Persistence | `core/chat/conversation-store.ts`, `entrypoints/sidepanel/pages/ChatPage.tsx`, `docs/PROVIDER-CONVERSATION-PERSISTENCE-VERIFICATION.md`, `docs/compatibility/persistence-and-sync.md` |
| Legacy sidepanel tools | `core/chat/sidepanel-legacy-tool-stream.ts` (new), `core/tool/sidepanel.ts`, `entrypoints/background.ts` |
| Visibility / hide | `core/prompt/visibility.ts`, `core/prompt/page-tool-results-hide.ts` (new/expanded), `core/prompt/index.ts`, `entrypoints/content.ts` |
| Bridge tests | `core/cursor-bridge/account-vault.ts`, `tests/cursor-bridge-worker.test.ts` |
| Tests | `tests/prompt-visibility.test.ts`, `tests/page-tool-results-hide-dom.test.ts`, `tests/sidepanel-legacy-tool-stream.test.ts`, `tests/sidepanel-interactions.test.ts`, `tests/provider-conversation-store.test.ts`, plus smaller contract updates |

---

## 5. Architecture / mechanism notes

### 5.1 Sidepanel legacy sandbox execution

**Problem:** When ChatPage submits before catalog hydration (no `model` / `logicalConversationId`), background takes the **legacy** DeepSeek path. That path used `getRuntimeToolDescriptors` only, which **excludes** sandbox → `<sandbox_run>` ignored. Raw deltas also exposed tool XML before parse.

**Fix shape:**

- Compose **sidepanel** descriptors = runtime + `createSandboxToolDescriptors` + sidepanel filter (sandbox allowed in sidepanel, not public page catalog).
- Shared helper `createSidepanelLegacyToolStream` in `core/chat/sidepanel-legacy-tool-stream.ts`.
- Legacy loops use streaming tool-text accumulator; broadcast visible text only; `extractCalls(fullText)` for final parse (including fallback-only XML).
- Wire sites in `entrypoints/background.ts` at HEAD (line numbers may drift):
  - `runOfficialApiToolLoop` — official-API legacy path creates the stream ~3216; `extractCalls` ~3250
  - `runSidepanelToolLoop` — DeepSeek **web** legacy path creates the stream ~3298; `extractCalls` ~3320

**Invariant:** Sandbox remains executable in sidepanel trusted loops; **not** advertised in page-facing public catalog.

### 5.2 Page tool-results hide (content script)

**Problem:** Internal continuation envelopes (`[TOOL_RESULTS]…[/TOOL_RESULTS]`, sandbox result wrappers) were user-visible on chat.deepseek.com; naive string/marker rewrite corrupted JSON payloads that *contain* close-marker text.

**Fix shape:**

- `normalizeRenderedToolResultsText`: **CRLF → LF only** (no open-marker insertion, no continuation-lookahead rewrites).
- `locateInternalToolResultsContinuation` / classifier: JSON- or XML-aware body measure (`endIndexOfJsonValue` + `JSON.parse`); require outer close **at** measured end.
- Legacy `*_result` wrappers: production-shaped name grammar + `_result`; body must be object/array JSON; matching XML close at structural end.
- DOM: `createContentScriptToolResultsMessageHider` — hide message bubbles when outside-`<pre>` text is a complete internal envelope; **do not** hide pure user-authored split/fenced examples.
- Wire: `entrypoints/content.ts` ~6002.

**Invariant:** Hide is display-only. It does not grant or deny tool execution authority.

### 5.3 Fail-closed conversation store

**Storage key:** `deepseek_pp_active_chat_conversation` (schema v1).

| Load shape | Result (`LoadActiveChatConversationResult.status`) | UI behavior |
|------------|--------|-------------|
| Key absent / undefined | `absent` | Fresh conversation; normal autosave |
| Present + valid v1 | `ok` | Hydrate; debounced save |
| Present + invalid / wrong schema / corrupt | `invalid` | **Fail closed:** no hydrate, no autosave overwrite |

Budgets unchanged: max 200 messages; 1_000_000 combined text+reasoning characters.

### 5.4 Cursor-bridge vault test hygiene

Module-global vault could leak tokens across Vitest cases → false failures / non-deterministic `missing_login`.  
`__resetBridgeAccountVaultForTests()` clears vault for tests only; production paths unchanged.

---

## 6. SOL reverify ladder (Wave 1)

Artifacts under `/tmp/codex-sol-wave1-reverify*.md` (and prompts/consoles). Grades:

| Round | Grade | What still blocked PASS (accurate to `/tmp` report titles + results) |
|-------|-------|---------------------------|
| #1 | FAIL | Fail-closed race on New Session during pending load; page hide false positives/negatives; compat key count wrong; full suite red |
| #2 | FAIL | P0-1 + registry pass; P2-1 still fails DOM false-negative for genuine continuations with code; full suite still red |
| #3 | FAIL | P2-1 still fails when chrome/renderer boundaries break strict whole-`textContent` classification before outside-pre path |
| #4 | FAIL | Legacy production `<name_result>` payloads rejected; incremental observer can miss completed bubble; no executable DOM regression |
| #5 | FAIL | **Functional** legacy payload + incremental observer fixed; still FAIL on missing checked-in executable DOM regression + full suite `cursor-bridge-worker` flake |
| #6 | FAIL | JSDOM suite added but incomplete vs production observer; suite still not fully green / not production-wrapper equivalent |
| #7 | FAIL | Vault isolation **PASS** (suite green); still FAIL on content.ts separate observer vs factory, synthetic Text routing, parser edge cases, over-budget load strictness |
| #8 | FAIL | Factory wiring + prior payload-close / task-suffix behaviors **PASS**; still FAIL when **`Original task` contains** literal `[/TOOL_RESULTS]` (payload-close already OK), plus incomplete live raw-`Text` observer coverage and missing production-generator regressions |
| #9 | FAIL | Close-marker-in-payload positives pass; still FAIL on split user-authored examples hidden + forged damaged-close promotion |
| #10 | FAIL | Split example + forged close fixed; still FAIL on `normalizeRenderedToolResultsText` rewriting JSON-string markers + loose legacy body rules |
| #11 | FAIL | Several #10 cases fixed; still FAIL on context-free marker rewrite under `]`/`>` + continuation adjacency; legacy name grammar / `JSON.parse` gaps |
| **#12** | **PASS_WITH_WARNINGS** | Behavior fixed at `35f6ad33` (CRLF-only normalize + JSON/XML-aware envelope); **warning = committed test matrix narrower than #11 requested** |

**#12 claims (all behavior PASS at that HEAD):**

1. Line-ending-only normalization  
2. JSON/XML-aware envelope measurement  
3–4. Adjacency preservation + collapsed open/close forms  
5. Prior regressions retained (forged close, invalid JSON, split examples, etc.)

**#12 warning disposition:** Commit `ad7c7d91` pins full `summary`/`detail`/`output` adjacency and production-shaped legacy tag/malformed-body negatives in `tests/prompt-visibility.test.ts`.  
**Note:** A fresh SOL grade of HEAD after `ad7c7d91` for “full PASS” was not archived under `/tmp` at doc-write time; automated tests and live smoke are the post-pin evidence. Re-grade is recommended when reopening Wave 1 audit.

Related pre-wave notes:

- `/tmp/codex-sol-sandbox-sidepanel-fix.md` — root cause: legacy descriptor omission  
- `/tmp/codex-sol-sandbox-sidepanel-verify.md` — B+ implementation; need behavioral tests (later added)

---

## 7. Live acceptance (user)

User reloaded the extension and ran sandbox smoke on **both** surfaces:

| Surface | Result |
|---------|--------|
| Sidepanel chat | PASS — JSON body with `sum: 31` |
| Page (DeepSeek web + content hide) | PASS — same unfakeable JSON shape |

**Canonical payload observed:**

```json
{"t":1750807910634,"r":887,"sum":31}
```

Interpretation: sandbox executed (non-zero structured fields; `sum` matches known test vector sum of `[3,1,4,1,5,9,2,6]` = 31).  
Raw internal protocol was not required as the user-facing success signal; visible result was the JSON.

**Screenshot evidence:** provided by user in session (sidepanel + page); not stored in-repo.

---

## 8. Ops / log triage (CLIProxy)

User asked to check logs after smoke.

| Check | Result |
|-------|--------|
| Extension on-disk sandbox logs | None required / none found as product log path |
| CLIProxy process | Healthy / serving |
| Scary-looking stderr | Historical: missing `deepseek_web_route_logger.js` |
| Current config | `jshandler` scripts list only `/Users/kyin/cliproxyapi/local-js/omlx_prompt_inspector.js` (**exists**) |
| Action | **None.** Do **not** delete jshandler, omlx script, or invent logger file |

**Communication failure (process, not product):** Prior wording “Anything scary… only noise” was misread as “there is a scary problem.” Intended meaning: **nothing material is wrong.** Operator decision: **NOT DELETE**.

---

## 9. Process / agent rules used this day

Session-local (unless user re-asserts):

- Plan (SOL) → implement → verify → SOL grade; on FAIL raise pua-en L; stop at max **L4** if still FAIL.
- `/karpathy-guidelines`, `/ultrathink`, `/council` before high-risk implement turns.
- Multi-lane Grok 4.5 when implementing (where used).
- User rejected push complexity: **git commit only**.
- No forged Qwen cursor fix without fixtures.

---

## 10. Automated evidence template

Run from repo root `/Users/kyin/Projects/Deepseek-pp`:

```bash
git rev-parse HEAD   # expect ad7c7d91… at doc freeze
git status -sb
npm run compile
npx vitest run tests/prompt-visibility.test.ts tests/page-tool-results-hide-dom.test.ts tests/sidepanel-legacy-tool-stream.test.ts tests/provider-conversation-store.test.ts
npm test             # full suite; historical #12 reported 931/931 under hard cap
npm run prompt:freeze
```

**Historical #12 automated gates (at `35f6ad33`):**

- Focused visibility-related: 18/18 (then expanded by `ad7c7d91`)  
- Full suite: 127 files, **931/931**, ~12.7s Vitest  
- `npm run compile`: pass  
- `npm run prompt:freeze`: 7/7  

**Post-`ad7c7d91`:** re-run commands and paste results into §14 appendix when regenerating this ledger.

---

## 11. Open follow-ups (ordered)

| Priority | Item | Notes |
|----------|------|--------|
| Optional audit | SOL re-grade HEAD `ad7c7d91` after matrix pin | Expect full PASS if behavior+tests align |
| P1 (deferred) | Qwen missing response id / cursor | Needs fixtures; do not invent |
| P3 (roadmap) | Multi-chat history / export / continuity toggle | Horizon B deferred |
| Ops | Fork push when user asks | `git push fork HEAD` only with explicit OK |
| Docs hygiene | Keep this session doc linked from INDEX + HANDOFF | Done in same change set as this file |

---

## 12. Explicit “do not” list (for next agent)

1. Do **not** “fix” CLIProxy by deleting `jshandler` or `omlx_prompt_inspector.js` for the old logger message.  
2. Do **not** reintroduce marker rewrite / open-marker insertion into `normalizeRenderedToolResultsText`.  
3. Do **not** treat page hide as authorization for tools.  
4. Do **not** overwrite invalid conversation storage with a silent heal.  
5. Do **not** push to `origin` (zhu) without explicit user order.  
6. Do **not** claim Qwen cursor fixed without failing tests + fixtures.

---

## 13. Quick map for next agent

```text
Sidepanel legacy sandbox exec
  core/chat/sidepanel-legacy-tool-stream.ts
  core/tool/sidepanel.ts
  entrypoints/background.ts (legacy loops)

Page hide
  core/prompt/visibility.ts
  core/prompt/page-tool-results-hide.ts
  entrypoints/content.ts

Fail-closed chat
  core/chat/conversation-store.ts
  entrypoints/sidepanel/pages/ChatPage.tsx

Tests
  tests/prompt-visibility.test.ts
  tests/page-tool-results-hide-dom.test.ts
  tests/sidepanel-legacy-tool-stream.test.ts
  tests/provider-conversation-store.test.ts
  tests/sidepanel-interactions.test.ts

SOL artifacts (ephemeral /tmp)
  /tmp/codex-sol-wave1-reverify.md          # round #1 (no reverify1.md)
  /tmp/codex-sol-wave1-reverify{2..12}.md   # rounds #2–#12
  /tmp/codex-sol-sandbox-sidepanel-{fix,verify}.md
  /tmp/codex-sol-session-doc-review*.md     # documentation grades for this ledger
```

---

## 14. Appendix — verification runs (filled at doc freeze / SOL iterate)

Recorded **2026-07-13 19:27–19:28 PDT** on machine workspace; code HEAD clean of product changes; docs dirty only.

| Gate | Command | Result | When |
|------|---------|--------|------|
| HEAD | `git rev-parse HEAD` | `ad7c7d91de07c0438634b8658f9862ce6fe8a6b4` | 2026-07-13 19:27 PDT |
| Status | `git status -sb` | Branch ahead of fork by 9; modified `docs/HANDOFF-NEXT-AGENT.md`, `docs/INDEX.md`; untracked `docs/sessions/` | same |
| Compile | `npm run compile` | **pass** (`tsc --noEmit`, exit 0) | same |
| Focused tests | `npx vitest run tests/prompt-visibility.test.ts tests/page-tool-results-hide-dom.test.ts tests/sidepanel-legacy-tool-stream.test.ts tests/provider-conversation-store.test.ts` | **4 files, 29/29 pass** (~1.0s) | same |
| Full tests | `npm test` | **127 files, 932/932 pass** (~15.6s Vitest) | same |
| Prompt freeze | `npm run prompt:freeze` | **7/7 pass** | same |
| SOL doc grade #1 | gpt-5.6-sol high | **FAIL** (C3 load `missing` vs `absent`; loop labels swapped; SOL #5/#7 themes) | `/tmp/codex-sol-session-doc-review.md` |
| SOL doc grade #2 | gpt-5.6-sol high | **FAIL** (C4: #8 payload-close misstated; reverify1 path wrong) | `/tmp/codex-sol-session-doc-review2.md` |
| SOL doc grade #3 | gpt-5.6-sol high | **PASS_WITH_WARNINGS** — all C1–C10 PASS | `/tmp/codex-sol-session-doc-review3.md` |
| Post-grade gates | compile + focused 29 + full 932 + freeze 7 | **pass** (orchestrator + SOL #3) | 2026-07-13 evening |

Note: #12 historical full suite was 931/931 at `35f6ad33`. Post-`ad7c7d91` is **932/932** (matrix pin added cases).

---

## 15. Document control

| Field | Value |
|-------|--------|
| Authoring agent | Grok 4.5 session (CLIProxyAPI workspace, work on Deepseek-pp) |
| Review | GPT-5.6 SOL high — **PASS_WITH_WARNINGS** (doc review #3) |
| Status | **FINAL** for 2026-07-13 Wave 1 closeout documentation |
| Related docs | `PROVIDER-CONVERSATION-PERSISTENCE-VERIFICATION.md`, `HANDOFF-NEXT-AGENT.md`, `INDEX.md` |

### SOL grade (documentation accuracy)

**GRADE: PASS_WITH_WARNINGS** (`/tmp/codex-sol-session-doc-review3.md`)

- All claims C1–C10 **PASS** after FAIL→FAIL→fix iteration.
- Non-blocking warnings: no archived product-code SOL re-grade of HEAD `ad7c7d91` (disclosed in §6); optional only.
- Factual errors remaining: **none**.
