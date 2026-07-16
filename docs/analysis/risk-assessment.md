# DeepSeek++ PC Runtime Hardening Wave 2 — Risk Assessment

## S.U.P.E.R Architecture Health Summary

| Principle | Status | Key findings | Priority |
|:--|:--:|:--|:--:|
| S — Single Purpose | 🟡 | Handler/controller foundations are healthy; Content、interceptor、Skill import and Background roots remain multi-domain hotspots. | High |
| U — Unidirectional Flow | 🟢/🟡 | Current TS relative-import graph has zero SCC; `core/types.ts` and duplicated contract descriptions still expand change propagation. | Medium |
| P — Ports over Implementation | 🟡 | Runtime/persistence/sync are mostly typed; MCP response、platform capability、Shell catalog/version still have multiple or permissive truths. | High |
| E — Environment-Agnostic | 🟡 | Android is gone and three desktop builds are explicit; Chromium-only capabilities and real extension loading are not fully proven. | High |
| R — Replaceable Parts | 🟡 | Providers/transports/handlers are replaceable; large roots and duplicate import/catalog policies still raise replacement cost. | Medium |

**Overall health**：0 new P0 regressions found；architecture foundation is stable, but compatibility gaps must be closed before another broad monolith split.

## Verified Resolved Findings

The following previous review findings are closed on `450b5e2` and are excluded from this run:

- MAIN/content single-side restart reconnect and peer disconnect.
- Settings `GET_CONFIG` response decoding and loading completion.
- Duplicate Side Panel runtime-failure predicate.
- PET event/load stale response race.
- Auth refresh error swallowing beyond expected missing receivers.

## Risk Matrix

| ID | Risk | Impact | Likelihood | Severity | Recommended response |
|:--|:--|:--:|:--:|:--:|:--|
| W2-R01 | MCP accepts malformed/cross-request response shapes before privileged result handling. | High | Medium | P0 | Strict direction-specific response codec tied to receiver-owned request ID. |
| W2-R02 | MCP result truncation can split UTF-16 surrogate pairs and exceed byte budgets. | High | High | P0 | UTF-8 byte-safe truncation with explicit `truncated` signal. |
| W2-R03 | MCP discovery can exceed `maxToolCount` by a full page. | Medium | High | P0/P1 | Apply exact per-item cap while preserving pagination/cursor semantics. |
| W2-R04 | Platform capability map disagrees with manifest and pre-load UI is optimistic. | Medium | High | P1 | Fail closed during loading and add only consumer-owned capability checks. |
| W2-R05 | Shell server version and tool catalog have multiple truths. | Medium | Certain | P1 | Derive version/catalog from one serializable source; keep released Native protocol and catalog bytes stable. |
| W2-R06 | Request augmentation parses the same untrusted body in several places without one object/string-prompt decoder. | Medium | Medium | P1 | Decode once before grant/project/prompt processing; invalid input fails before privileged work. |
| W2-R07 | Unclosed streaming tool call emits start but no terminal state. | High | Medium | P1 | Emit one non-executable terminal parse failure and release externalized state at EOF. |
| W2-R08 | First Chat screen is within 1% of raw/gzip ceiling. | Medium | High | P1 | Lazy-load rich rendering not needed by an empty first screen, measure, then lower the budget. |
| W2-R09 | Real browser lifecycle remains unverified because unpacked load was not proven. | High | Medium | P0 evidence gap | Build a narrow load/assert/reinject smoke that fails if the extension ID/service worker/content probe is absent. |
| W2-R10 | Live `CURRENT_GAPS` point at closed historical Issues. | Medium | Certain | P1 governance | Re-map every retained gap to this run or remove it only when executable evidence closes it. |
| W2-R11 | Broad Content/Background/root-type refactors can create a large merge and regression radius. | High | Medium | P1 | Keep out of the first bounded batch or serialize by hotspot owner with frozen fixtures. |

## High-Severity Risks

### MCP boundary and budgets

MCP is an external-I/O trust boundary and can feed tool descriptors/results into privileged runtime behavior. Current transport normalization accepts wrong JSON-RPC version/ID and simultaneous `result`/`error`; the client then slices output by JavaScript character count and appends whole discovery pages. These are independent symptoms of one missing receiving authority: response identity/shape and resource budgets must be validated before downstream normalization.

### Streaming tool EOF

The parser emits `started` immediately for large/externalized payloads, but `flush()` drops `current` without a `completed` failure. That can leave UI/runtime correlation pending and makes EOF behavior implicit. The fix must never execute an unclosed call, must settle exactly once, and must clean any externalized payload state.

### Real browser evidence

Build success and jsdom lifecycle tests cannot prove that Chrome actually loaded an unpacked extension, created its service worker, injected MAIN/content scripts, and survived reload/reinjection. Any smoke implementation must assert those facts; simply launching Chrome is not evidence. Because Chrome 150 rejected the previous command-line attempt, this task carries tooling risk and should be isolated from code-correctness closure if it cannot be made deterministic quickly.

## Compatibility Concerns

- Do not change legal prompt bytes, tool XML tags/names, inline-agent text, runtime message names, bridge envelopes, storage keys, IndexedDB identities, sync files, MCP request protocol version, Native envelope version, or Shell tool order/schema/risk.
- Invalid external input is not a successful compatibility contract. Replacing permissive malformed behavior with explicit failure is allowed only with executable negative tests and unchanged legal fixtures.
- Keep the 15-key platform environment record readable. New environment checks need a real consumer in the same task; do not create a second broad facade.
- Shell version-source changes must work from installed npm package layout, not only the repository checkout.
- Side Panel optimization must measure the built route, preserve first-chat behavior, and lower the ceiling only after the new baseline is stable.

## Testing Risks and Required Evidence

- All unit tests use a hard 60-second timeout; after interruption verify no Vitest child remains.
- MCP changes require external-contract, transport, discovery, tool-call and native/mock smoke coverage.
- Platform changes require Chrome/Edge/Firefox fixtures, manifest policy, Side Panel controller tests and all-browser builds.
- Shell changes require external-contract tests, 17-command shell smoke and npm package-layout verification.
- Request/tool-stream changes require malformed object/prompt cases, EOF/idempotency/externalized cleanup, and prompt freeze.
- Performance changes require before/after built chunk evidence plus a tightened executable budget.
- Closure requires `npm run ci:quality`; real Chrome smoke must remain explicitly non-pass if the extension is not actually loaded.

## Governance Risks

- `AGENTS.md` is the only project instruction truth source; do not create root `CLAUDE.md` or repo-local memory.
- The completed `core-refactor-2026-07` archive is historical and must not be edited as the active tracker.
- The new run must use a fresh label, Milestones and active `docs/progress/MASTER.md`.
- Closely related Issues may share the current batch branch and one PR, matching the user's explicit speed/PR preference; telemetry still belongs on every Issue before merge.
- Security-sensitive public Issues should state repair goals and verifiable outcomes, not detailed exploit chains.

## Recommended Phase-2 Decision

For a fast first wave-2 batch, prefer the bounded contract/performance slice over another monolith-wide rewrite:

1. MCP receiving codec and exact budgets.
2. Platform capability/loading truth.
3. Shell version/catalog truth.
4. Strict request decode and terminal tool EOF behavior.
5. Side Panel first-chat headroom.
6. Re-map live compatibility gaps and run the full PC-browser closure.

Treat deterministic real Chrome smoke as a parallel evidence task only if the first short feasibility spike proves that the extension can actually be loaded; otherwise record it as a blocker/gap without holding the code batch hostage. Defer full Content/Background/root-type/Skill-import rewrites to later batches with separate hotspot ownership.
