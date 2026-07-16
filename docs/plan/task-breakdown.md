# DeepSeek++ PC Runtime Hardening Wave 2 — Task Breakdown

## Delivery Model

本轮使用 7 个 GitHub Issue 作为验收与遥测单元，但不采用一 Issue 一 PR。所有任务进入 `codex/pc-runtime-hardening-wave-2` 集成分支，按独立 owner lane 形成可审查提交，最终由一张 batch PR 合并。Android、移动 WebView、移动构建与移动发布路径不在范围内。

## Task Matrix

| ID | Task | Priority / size | Depends on | Lane | S.U.P.E.R | Primary scope | Acceptance evidence |
|:--|:--|:--|:--|:--:|:--|:--|:--|
| W2.1 | Make MCP response decoding and budgets authoritative | P0 / M | None | A | P, U, R | `core/mcp/transports/common.ts`, `core/mcp/client.ts`, MCP fixtures/tests | Reject wrong JSON-RPC version/ID and simultaneous `result` + `error` before consumption; truncate results on UTF-8 byte boundaries with an explicit signal; discovery never exceeds `maxToolCount`; legal fixtures remain unchanged. |
| W2.2 | Decode DeepSeek request bodies once before privileged work | P1 / M | None | B | S, P, R | `core/interceptor/request-augmentation.ts`, Content augmentation caller, request/prompt tests | Only a plain object with a string prompt enters augmentation; malformed-but-valid JSON fails before authorization/project/prompt work; legal prompt bytes and unrelated sibling fields remain unchanged. |
| W2.3 | Give incomplete streaming tool calls one terminal EOF outcome | P1 / M | W2.2 | B | S, U, R | streaming parser, passive fetch hook, inline-agent consumer, related tests | An unclosed call never executes; a previously emitted `started` event receives exactly one same-ID non-executable parse-failure terminal event; externalized state is released; repeated flush is idempotent. |
| W2.4 | Align desktop platform capability and loading truth | P1 / M | None | C | P, E, R | `core/platform/*`, narrow sync/Side Panel consumers, platform fixtures/tests | Pre-load state fails closed; `downloads` stays false without manifest permission; sync identity has a narrow production consumer-owned check; the serialized 15-key environment remains readable; Chrome/Edge/Firefox degradation stays explicit. |
| W2.5 | Derive Shell version and catalog checks from authoritative sources | P1 / M | None | D | S, P, R | `core/shell/*`, `packages/shell-host/native/*`, package/install tests | Native `serverInfo.version` matches package metadata from installed npm layout; exact 12-tool name/order/schema/risk and Native protocol v1 remain stable; no repo-only runtime import is introduced. |
| W2.6 | Increase first Chat screen bundle headroom | P1 / M | None | E | S, E, R | `ChatPage.tsx`, rich message renderer boundary, chunk budget/tests | Empty first Chat screen does not load rich rendering code; interaction behavior is unchanged; raw and gzip measurements improve on all PC builds; the executable ceiling is lowered only after measurement. |
| W2.7 | Reconcile live compatibility gaps and close the batch | P1 / M | W2.1–W2.6 | F | U, P, E, R | live external-runtime fixtures, active progress index, CI/smoke scripts | Resolved gaps are removed; every retained gap has a current or explicit deferred owner; archived run is not edited; targeted tests, compile, prompt freeze, all-browser builds, manifest/UTF-8 checks and `ci:quality` pass. Real Chrome smoke is recorded as pass only when an unpacked extension is actually observed. |

GitHub mapping: W2.1 [#395](https://github.com/zhu1090093659/deepseek-pp/issues/395), W2.2 [#396](https://github.com/zhu1090093659/deepseek-pp/issues/396), W2.3 [#397](https://github.com/zhu1090093659/deepseek-pp/issues/397), W2.4 [#398](https://github.com/zhu1090093659/deepseek-pp/issues/398), W2.5 [#399](https://github.com/zhu1090093659/deepseek-pp/issues/399), W2.6 [#400](https://github.com/zhu1090093659/deepseek-pp/issues/400), W2.7 [#401](https://github.com/zhu1090093659/deepseek-pp/issues/401).

## Phase 1 — External Boundary Correctness

### W2.1 MCP response and budget authority

- Add one direction-specific response decoder at the receiving boundary; transports may call it but must not repair invalid wire data.
- Count result limits in UTF-8 bytes and avoid splitting surrogate pairs.
- Apply the discovery cap per item while preserving valid cursor/pagination behavior.
- Required checks: MCP transport/common, external-contract, discovery/tool-call tests, mock/live-mock and MCP smoke.
- Public Issue wording describes malformed-response rejection and bounded resources, not exploit payloads or trust-boundary internals.

### W2.2 Strict DeepSeek request decode

- Parse and validate once, before authorization or data lookup.
- Reuse the validated value; do not add another request parser or fallback path.
- Preserve every legal body field and byte-compatible prompt output.
- Required checks: request augmentation, bridge/protocol, multimodal paths where applicable, and prompt freeze.

### W2.3 Terminal incomplete tool calls

- Extend the existing parser event contract rather than adding a second cleanup channel.
- The terminal failure is observable, non-executable and exactly once.
- Keep parser, passive interception and inline-agent semantics aligned.
- Required checks: parser/text, passive fetch lifecycle, inline-agent and authorization/externalized-state cleanup.

## Phase 2 — Capability, Performance and Closure

### W2.4 Platform truth

- Keep the existing environment record compatible; do not expand the broad platform abstraction.
- Remove optimistic pre-load behavior and unsupported permission inference.
- Add a capability only with its actual production consumer in the same task.
- Required checks: platform external contract, Side Panel controllers, sync OAuth, manifest policy, all-browser builds.

### W2.5 Shell truth

- Use package metadata for the released server version in both repo and installed-package layouts.
- Prefer shared serializable evidence or contract tests for the browser/native catalog; do not make the native executable depend on repo-only TypeScript paths.
- Required checks: Shell external/runtime/installer tests, pack-layout verification and the complete Shell smoke command set.

### W2.6 Side Panel first-chat budget

- Record the before metric, move rich rendering behind a real demand boundary, then record the after metric.
- Do not claim improvement by raising the budget or changing first-screen behavior.
- Required checks: chat interactions, lazy-route/static graph assertions, `build:all` and Side Panel chunk budget for Chrome/Edge/Firefox.

### W2.7 Compatibility and quality closure

- Update only the active wave-2 progress/index and live fixtures; leave the completed archive read-only.
- A short deterministic Chrome smoke feasibility check may run, but absence of a proven unpacked load remains an explicit gap and does not become a false pass.
- Record telemetry on all seven Issues before the final PR closes them.

## Conflict and Parallelism Rules

- W2.2 then W2.3 are serial because both own interceptor hot paths.
- W2.4 and W2.6 may run concurrently only while they avoid the same Side Panel file; otherwise W2.6 follows the narrow platform consumer change.
- W2.7 is the sole owner of shared compatibility/progress documents.
- W2.1, W2.4, W2.5 and W2.6 are otherwise independent and may run in parallel.

## Validation Order

1. Task-local tests with a 60-second hard timeout.
2. `npm run compile` and applicable static checks.
3. `npm run prompt:freeze` for W2.2/W2.3 and final closure.
4. `npm run build:all`.
5. `npm run verify:manifest-policy` and `npm run verify:extension-utf8`.
6. Narrow MCP/Shell/Side Panel smoke and budget checks.
7. `npm run ci:quality` followed by a final diff review.
