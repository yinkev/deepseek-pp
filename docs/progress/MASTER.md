# DeepSeek++ PC Runtime Hardening Wave 2 — Active Progress

## Run State

| Field | Value |
|:--|:--|
| Status | COMPLETE |
| Baseline | `origin/main` / `450b5e2e8e2e61a73417c26840ef9d0224418eb6` |
| Branch | `codex/pc-runtime-hardening-wave-2` |
| Worktree | `/Users/zcl/code/deepseek-pp-worktrees/pc-runtime-hardening-wave-2` |
| Tracking | `GITHUB_STANDARD` |
| Run label | `spec:pc-runtime-hardening-wave-2-2026-07` |
| Delivery | Seven acceptance Issues closed through the merged batch PR [#402](https://github.com/zhu1090093659/deepseek-pp/pull/402) |
| Scope | Desktop Chrome, Edge and Firefox only; Android/mobile remains removed |
| Resume point | Run complete; start the next bounded PC-only refactor as a fresh spec-driven run |

## GitHub Index

| Phase | Milestone | Task | Issue | Status | Lane |
|:--|:--|:--|:--|:--|:--:|
| 1 | [#49](https://github.com/zhu1090093659/deepseek-pp/milestone/49) | W2.1 MCP response/budget authority | [#395](https://github.com/zhu1090093659/deepseek-pp/issues/395) | Complete via PR #402 | A |
| 1 | [#49](https://github.com/zhu1090093659/deepseek-pp/milestone/49) | W2.2 Strict request decode | [#396](https://github.com/zhu1090093659/deepseek-pp/issues/396) | Complete via PR #402 | B1 |
| 1 | [#49](https://github.com/zhu1090093659/deepseek-pp/milestone/49) | W2.3 Tool EOF terminal state | [#397](https://github.com/zhu1090093659/deepseek-pp/issues/397) | Complete via PR #402 | B2 |
| 2 | [#50](https://github.com/zhu1090093659/deepseek-pp/milestone/50) | W2.4 Platform capability/loading truth | [#398](https://github.com/zhu1090093659/deepseek-pp/issues/398) | Complete via PR #402 | C |
| 2 | [#50](https://github.com/zhu1090093659/deepseek-pp/milestone/50) | W2.5 Shell version/catalog truth | [#399](https://github.com/zhu1090093659/deepseek-pp/issues/399) | Complete via PR #402 | D |
| 2 | [#50](https://github.com/zhu1090093659/deepseek-pp/milestone/50) | W2.6 First-chat headroom | [#400](https://github.com/zhu1090093659/deepseek-pp/issues/400) | Complete via PR #402 | E |
| 2 | [#50](https://github.com/zhu1090093659/deepseek-pp/milestone/50) | W2.7 Gap reconciliation and closure | [#401](https://github.com/zhu1090093659/deepseek-pp/issues/401) | Complete via PR #402 | F |

## Active Decisions

- User authorization and the explicit speed/PR instruction confirm execution without another interactive phase gate. The built-in confirmation control was unavailable in Default mode; this run uses the documented recommended scope rather than pausing.
- The completed reliability/compatibility archive remains read-only. Its five previously audited findings are verified fixed on the current baseline and are not re-opened.
- Shared compatibility/progress files have one owner, W2.7. Code lanes do not independently rewrite gap ownership.
- A real Chrome smoke is evidence only when the unpacked extension and an actual runtime probe are observed. A tooling failure remains a declared non-pass and does not masquerade as closure evidence.

## Governance Resolution

| Surface | Resolution |
|:--|:--|
| Project instructions | Root `AGENTS.md` is the sole repository instruction truth |
| Native memory | Available for workflow context; not stored in this repository |
| Repo-local memory | Forbidden; none will be created |
| Root `CLAUDE.md` | Forbidden; none will be created |
| Android/mobile | Permanently outside the supported product/build/test scope |

## Validation Ledger

| Time | Scope | Evidence |
|:--|:--|:--|
| 2026-07-14 | Baseline candidate contracts | 6 files / 47 tests passed after worktree-local `npm run postinstall` |
| 2026-07-14 | Baseline TypeScript | `npm run compile` passed |
| 2026-07-14 | Integrated task matrix | 33 files / 274 targeted tests passed with a 60-second hard timeout |
| 2026-07-14 | MCP review correction | 2 files / 24 tests passed for Streamable HTTP `202`, SSE server-message ordering and integer error codes |
| 2026-07-14 | Prompt and types | `npm run prompt:freeze` passed 7/7; `npm run compile` passed |
| 2026-07-14 | PC browser builds | Chrome, Edge and Firefox MV3 production builds passed |
| 2026-07-14 | Manifest and encoding | `verify:manifest-policy` and `verify:extension-utf8` passed; 159 built files scanned |
| 2026-07-14 | Runtime smoke | MCP discovery/tool/timeout, MCP live mock and Shell Host 17/17 passed |
| 2026-07-14 | Side Panel budget | All three browsers: first Chat screen 498,013/150,087 → 383,584/116,367 raw/gzip; Chat route 134,902/40,039 → 20,438/6,302; rich renderer static increment 115,534/34,522 |
| 2026-07-14 | Full quality closure | `npm run ci:quality` passed: 166 files / 1,200 tests plus persistence 3/3, audit, i18n, automation, MCP/Shell/PoW, builds, package budgets, zip/assets and offline Pyodide |
| 2026-07-14 | Remote PR closure | PR contribution evidence and GitHub `Quality gates` passed; remote quality job completed in 3m27s |

## Declared Evidence Gaps

| Owner | Gap | Closure rule |
|:--|:--|:--|
| `deferred:deepseek-stream-observability` | Malformed DeepSeek SSE JSON is represented as `null` without a diagnostic event. | A future bounded protocol task must add an observable error without changing legal SSE bytes. |
| `deferred:installer-transactionality` | Shell/OfficeCLI installation has no complete cross-effect journal. | Close only with failure-prefix and restart recovery evidence. |
| `deferred:installer-integrity-policy` | Missing OfficeCLI checksum metadata currently allows installation to continue. | Close only after an explicit compatibility/security policy decision and tests. |
| `deferred:installer-registry-health` | Windows registry write/status health is not fully observable. | Close with deterministic registry verification and failure tests. |
| `deferred:real-chrome-lifecycle-smoke` | A real unpacked Chrome extension lifecycle has not been observed by automation. | Mark pass only after extension ID/service worker/content probe evidence; launching Chrome alone is insufficient. |

## Execution Log

| Time | Event |
|:--|:--|
| 2026-07-14 | Confirmed the previous run is complete/archived and PR #394 is merged at the baseline SHA. |
| 2026-07-14 | Created isolated integration worktree/branch; preserved the dirty original checkout. |
| 2026-07-14 | Completed architecture/risk analysis and two independent task-decomposition reviews. |
| 2026-07-14 | Created Milestones #49–#50 and Issues #395–#401 for one batch PR. |
| 2026-07-14 | Completed W2.1–W2.6 implementation; independent reviews caught and closed Firefox OAuth, Side Panel lazy-failure/budget/scroll and MCP notification/SSE compatibility regressions. |
| 2026-07-14 | Reconciled live gaps, preserved the explicit real-Chrome non-pass, and passed the full local quality closure. |
| 2026-07-14 | Repaired Issue-template metadata after automatic governance closure, restored Issues #395–#401, recorded telemetry, and opened the single batch PR #402. |
| 2026-07-14 | Corrected the PR template evidence fields, passed both remote checks, and merged PR #402 as the one batch delivery. |
