# Review Lane Gate Consumer

## Contract

The run worker accepts a safe review-lane gate input and refuses to advance autonomous work when independent review has raised a blocking gate.

Required behavior:

| Requirement | Coverage |
| --- | --- |
| A blocked gate prevents queued work from starting and prevents executor calls. | `blocks on review lane gate before starting queued work or calling executor` |
| Blocking produces a durable review step with safe observation refs only. | `blocks on review lane gate before starting queued work or calling executor` |
| Blocking transitions the selected run to `blocked` with `autonomous_review_lane_gate_blocked`. | `blocks on review lane gate before starting queued work or calling executor` |
| Non-blocking attention gates do not prevent worker progress. | `does not block on non-blocking review lane attention` |
| Orchestrator forwards the gate to the selected worker and result/durable state agree. | `passes review lane gate to the selected worker and blocks before executor work` |

## Mechanism

`executeAutonomousRunCycle` accepts `reviewLaneGate` in options. The gate is normalized into safe enum-like fields before use. It blocks when any of these are true:

- `canProceed === false`
- `status === blocked`
- `blockingPriority` is P1 or P2
- `reason` is `p1`, `p2`, or `block_recommendation`

The worker appends a metadata-only failed review step, transitions the run to `blocked`, and returns a block result. It does not call the executor and it does not start queued work first.

`executeAutonomousOrchestratorCycle` forwards the gate option to the selected worker. Selection remains unchanged.

## Privacy

The worker never accepts raw lane text, labels, transcripts, prompts, or reviewer messages. Observation refs are limited to normalized reason, normalized priority, and numeric blocking lane count.

## Adversarial Probe

The orchestrator test proves the selected worker result and durable stored run state agree after a blocked gate. The worker test proves false-positive success cannot occur because executor is not called, `advanced` stays false, and durable status is `blocked`.

## Verification

Run:

```sh
npm test -- tests/run-worker.test.ts tests/run-orchestrator.test.ts
npm test -- tests/pet-control.test.ts tests/run-worker.test.ts tests/run-orchestrator.test.ts
npm test
npm run compile
git diff --check
```

`npm run prompt:freeze` is still expected to fail on the pre-existing prompt hash drift until that dedicated slice reconciles the prompt snapshots.

## Self Review

Grade target: A. This slice is pure run-layer gating. It does not wire Chrome runtime or content UI, and it does not alter review-lane telemetry projection semantics.
