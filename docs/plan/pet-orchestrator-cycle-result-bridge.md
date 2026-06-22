# Pet Orchestrator Cycle Result Bridge

## Purpose

Add one pure reducer that consumes an `AutonomousRunOrchestratorCycleResult` and updates the pet snapshot with the safe worker-cycle, telemetry, and quality-gate projections already supported by `core/pet/control.ts`.

This prevents future callers from manually merging only part of an orchestrator result and accidentally hiding a quality-gate hold, telemetry completion, or worker-cycle review signal.

## Scope

- `core/pet/orchestrator-bridge.ts`
- `tests/pet-orchestrator-bridge.test.ts`
- `docs/plan/pet-orchestrator-cycle-result-bridge.md`
- No Chrome, background, runtime, prompt, storage, or browser-control files.

## Contract Coverage Table

| id | required behavior | assertion / location | status |
|----|-------------------|----------------------|--------|
| 1 | Null or undefined orchestrator result is a no-op and preserves snapshot identity | `returns the original snapshot when orchestrator cycle result is unavailable` | covered |
| 2 | Worker-cycle result, telemetry result, and quality-gate decision are projected from one orchestrator result | `projects worker, telemetry, and quality gate results from one orchestrator cycle` | covered |
| 3 | Handoff capsule fields agree with the merged pet snapshot | same projection test compares worker, telemetry, and quality-gate capsule fields to corresponding fields on the merged post-projection snapshot | covered |
| 4 | Non-mutating quality-gate holds with `workerResult: null` project the gate without inventing worker progress | `projects non-mutating quality-gate holds without inventing worker progress` | covered |
| 5 | Blocked quality-gate holds drive `review_blocker` through existing handoff priority | same hold test asserts `nextAction = review_blocker` | covered |
| 6 | Raw selected run IDs, worker run IDs/errors, telemetry paths/roots, quality-gate raw fields, and arbitrary orchestrator notes do not leak | `keeps raw orchestrator cycle fields out of pet projection` | covered |
| 7 | Existing review-lane option bridge continues to sanitize pet fields, derive blocking gates, and avoid leaking raw snapshot data | `maps a default pet snapshot to clear review lane orchestrator options`, `projects sanitized pet review lanes, worker pulse, risk, and advisor requests`, `re-derives the gate from sanitized summaries instead of trusting forged snapshot gate fields`, `derives blocking gate from lanes beyond scheduler output cap`, `feeds pet-derived blocking gate into orchestrator and durable worker block`, and `keeps raw pet snapshot fields out of bridged orchestrator options` | covered |

## Mechanism

`mergeAutonomousOrchestratorCycleResultIntoSnapshot(snapshot, result)` composes the existing safe reducers:

1. `mergeAutonomousWorkerCycleResultIntoSnapshot` when `workerResult` exists.
2. `mergeOrchestratorTelemetryResultIntoSnapshot` when `telemetryResult` exists.
3. `mergeAutonomousQualityGateDecisionIntoSnapshot` when `qualityGateDecision` exists.

It is intentionally projection-only. It does not execute cycles, write telemetry, mutate storage, schedule workers, inspect Chrome, or change review-lane gate enforcement.

## Adversarial Probe

The false-positive privacy probe starts with an orchestrator result containing raw selected run IDs, worker run IDs, unknown worker errors, telemetry roots/paths/tokens, telemetry unknown errors, quality-gate extra prose, and arbitrary orchestrator notes. The merged pet snapshot and handoff capsule must omit those strings while preserving safe metadata such as `unknown_telemetry_error` and quality-gate grade/status.

## Verification

Run:

```sh
npm test -- tests/pet-orchestrator-bridge.test.ts
npm test -- tests/pet-orchestrator-bridge.test.ts tests/pet-control.test.ts tests/run-orchestrator.test.ts tests/run-result-consistency.test.ts
npm run compile
git diff --check
```

`npm run prompt:freeze` is expected to keep failing on pre-existing prompt hash drift until the dedicated prompt snapshot reconciliation slice.

## Self Review

Grade target: A. This slice only closes a pure pet/run projection boundary and keeps Chrome/runtime work frozen.
