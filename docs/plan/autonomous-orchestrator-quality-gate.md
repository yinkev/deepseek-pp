# Autonomous Orchestrator Quality Gate Enforcement

## Scope

Step 5 adds quality-gate enforcement to the autonomous orchestrator cycle. When a runnable run is selected, the orchestrator consults the latest persisted quality gate before calling the executor. This slice is pure core/run orchestrator logic, types, tests, and docs. It does not wire Chrome runtime, prompt generation, background entrypoints, or pet UI.

## Mechanism

1. A new exported pure helper `evaluateAutonomousQualityGateRecord(record)` evaluates a gate record and returns a `AutonomousRunQualityGateDecision`; `evaluateAutonomousRunQualityGate(runId)` fetches the latest persisted gate and delegates to it.
2. The decision is consulted in `executeAutonomousOrchestratorCycle` after selecting a runnable run but before calling `executeAutonomousRunCycle`.
3. If the gate blocks (via top-level `failed`/`blocked` status or deep block conditions), the executor is not called, `workerResult` is `null`, and the cycle result carries the blocking decision in `qualityGateDecision`.
4. The durable run state is NOT mutated on gate block (non-mutating hold) — the run stays in its current `queued` or `running` status, and will be re-checked on the next cycle.

## Design decisions

- **Non-mutating hold on block**: No durable transition is applied when a gate blocks. This is the smallest coherent behavior. The run remains selectable for future cycles, and the gate condition is re-evaluated each time.
- **Deep block safety net**: The checker evaluates both top-level gate status and the same deep conditions the store normalizer applies (independent review failures, result-state inconsistency, contract coverage conflicts). This is partially redundant with the store's normalization (which already propagates deep issues to the top-level status) but provides defense-in-depth.
- **Safe aggregate metadata only**: The decision exposes only compact count/status fields. No raw gate ids, reviewer prose, commit messages, command summaries, evidence ids, URLs, tokens, or secrets.

## Contract coverage table

| ID | Required behavior | Test assertion / proof | Status |
| --- | --- | --- | --- |
| 1 | Orchestrator inspects latest persisted quality gate for the selected runnable run before calling executor. | `tests/run-orchestrator.test.ts` asserts `qualityGateDecision` is populated when a run is selected and checked before executor. | covered |
| 2 | No quality gate yet allows the first cycle to proceed. | `allows worker execution when no quality gate exists (first cycle compatibility)` asserts `blocked: false`, executor called. | covered |
| 3 | Latest gate status `passed` allows worker execution. | `allows worker execution when latest gate status is passed` asserts `blocked: false`, executor called. | covered |
| 4 | Latest gate status `warning` allows worker execution with safe warning metadata. | `allows worker execution with warning metadata when latest gate status is warning` asserts `blocked: false, latestGateStatus: 'warning'`, executor called. | covered |
| 5 | Latest gate status `failed` blocks worker execution: executor not called, workerResult null. | `blocks worker execution when latest gate status is failed` asserts `blocked: true, workerResult: null`, executor not called. | covered |
| 6 | Latest gate status `blocked` blocks worker execution: executor not called, workerResult null. | `blocks worker execution when latest gate status is blocked` asserts `blocked: true, workerResult: null`, executor not called. | covered |
| 7 | Deep block: independentReview.status `failed`/`blocked`, independentReview.blockingIssueCount > 0, resultStateConsistency.status `inconsistent`, resultStateConsistency.blockingIssueCount > 0, or contractCoverage.conflictCount > 0 must block even if top-level status is permissive. | `pure evaluator blocks permissive top-level gates with deep blocking conditions` directly tests malformed/permissive records against `evaluateAutonomousQualityGateRecord`; persisted orchestrator tests verify normalized store records still block executor execution. | covered |
| 8 | Orchestrator result includes compact quality-gate decision with safe metadata only. | All orchestrator tests verify `qualityGateDecision` shape. Privacy probe asserts no raw gate ids, command names/summaries, run ids, or secret strings leak into JSON output. | covered |
| 9 | Result object and durable state agree: when gate blocks, decision says blocked, workerResult null, executor not called, durable run state unadvanced. | `adversarial probe: result object and durable state agree when gate blocks (non-mutating hold)` asserts `blocked: true, workerResult: null`, executor not called, durable status remains `running' with updatedAt at gate-append time (not the cycle's now). | covered |
| 10 | Existing no-runnable behavior remains intact. | `returns null qualityGateDecision when no selected run exists` asserts `selectedRunId: null, qualityGateDecision: null, workerResult: null`. | covered |
| 11 | Result consistency accepts valid non-mutating quality-gate holds and still rejects missing worker results without a gate hold. | `tests/run-result-consistency.test.ts` rejects selected-run cycles with no worker result when no gate blocks, and accepts selected-run cycles when `qualityGateDecision.blocked: true`. | covered |
| 12 | No Chrome/background/runtime files touched. | `git diff --name-only` shows only `core/run/orchestrator.ts`, `core/run/result-consistency.ts`, `tests/run-orchestrator.test.ts`, `tests/run-result-consistency.test.ts`, and this plan doc. | covered |
| 13 | No new dependencies. | `package.json` unchanged; implementation uses only existing types and store functions. | covered |

## Residual risk

- The store normalizer in `normalizeQualityGateStatus` already performs equivalent deep checking and may override a `passed` input to `failed`/`blocked`/`warning`. The orchestrator's checker is partially redundant but provides defense-in-depth for code paths that may bypass the normalizer.
- The non-mutating hold means a blocked-by-gate run stays in `queued` or `running` status indefinitely until the gate condition resolves. Downstream consumers (pet UI, telemetry) see a `running` run that repeatedly produces `qualityGateDecision.blocked: true` cycles.
