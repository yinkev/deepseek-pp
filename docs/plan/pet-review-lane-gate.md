# Pet Review Lane Gate

## Contract

The pet control snapshot exposes a derived review lane gate so later autonomous loop slices can stop on independent P1/P2 review findings without leaking raw reviewer content or changing the existing handoff `nextAction` priority.

Required behavior:

| Requirement | Coverage |
| --- | --- |
| Default snapshots have `clear` gate, `none` reason, `canProceed: true`, no blocking priority, and zero blocking lanes. | `createPetControlSnapshotFromRunCockpit and createBase default to no review lanes observed` |
| Null or undefined review lane input is a no-op and appends no gate mutation. | `mergePetReviewLanesIntoSnapshot returns original snapshot object unchanged if lanes null or undefined` |
| P1 review lane blocks progress with `reason: p1`. | `mergePetReviewLanesIntoSnapshot normalizes valid lanes and aggregates counts` |
| P2 review lane blocks progress with `reason: p2`. | `createPetReviewLaneGate blocks on P2 and counts blocking lanes without requiring a block recommendation` |
| Block recommendation blocks progress even without P1/P2. | `createPetReviewLaneGate blocks on block recommendation when priority is not P1/P2` |
| Gate derivation sees blocking lanes beyond the handoff summary cap. | `mergePetReviewLanesIntoSnapshot blocks on lanes beyond handoff summary cap` |
| Failed and blocked lanes block progress; running lanes produce attention and keep `canProceed: true`. | `createPetReviewLaneGate blocks failed and blocked lanes while running lanes remain attention` |
| Clean passed lanes stay clear. | `createPetReviewLaneGate stays clear for no lanes or clean passed lanes` |
| Handoff capsule exposes only gate enums, booleans, priority, and counts that agree with stored snapshot state. | `createPetHandoffCapsule projects review lane fields that agree with the merged snapshot` |
| Handoff capsule sanitizes lane summaries and derives aggregate/gate projection from those sanitized summaries even when a caller hand-builds a malformed snapshot. | `createPetHandoffCapsule sanitizes hand-built review lane summaries before projection` |
| Review lane gate telemetry does not alter `nextAction` or adjacent lenses. | `review lane metadata does not alter nextAction priority or adjacent pet lenses` |
| Raw reviewer labels, messages, details, transcripts, and unknown fields do not leak into snapshot or handoff JSON. | `privacy false-positive probe: raw lane labels, ids, messages, details, transcripts, and raw fields stay out of pet snapshot and handoff projection` |

## Mechanism

`createPetReviewLaneGate` derives a compact state from normalized review lane telemetry:

- `blocked / p1` when any lane reports highest priority P1.
- `blocked / p2` when any lane reports highest priority P2.
- `blocked / block_recommendation` when a lane recommends `block` without P1/P2.
- `blocked / failed_lane` or `blocked / blocked_lane` when a lane status failed or blocked.
- `attention / active_review` for non-blocking review attention.
- `clear / none` when no review lane requires attention.

`blockingLaneCount` counts lanes that carry P1, P2, `block` recommendation, blocked status, or failed status when the gate is blocked. It is zero for attention and clear gates. Gate derivation uses all sanitized review lanes; handoff may expose only the first four summaries, but hidden blocking lanes still affect the gate/count projection.

**Note:** When this derived gate is later consumed by the autonomous run loop, blocking evaluation uses the shared `isBlockingGateInput` / `normalizeReviewLaneGate` in core/run/review-lane-gate.ts.

The handoff capsule treats sanitized `snapshot.reviewLanes.lanes` as the source for projected review-lane counts and gate fields, then exposes only a capped `reviewLaneSummaries` array. Caller-provided aggregate counts or gate fields are not trusted when the capsule is built.

## Adversarial Probe

The false-positive success probe compares the durable pet snapshot gate with the handoff capsule fields after merge. The handoff must agree with `snapshot.reviewLaneGate` exactly while `nextAction` remains controlled by the existing priority order.

This slice is projection-only. Enforcing `reviewLaneGate.canProceed === false` inside the worker/orchestrator loop belongs to the scheduler/gate-consumer slice.

## Verification

Run:

```sh
npm test -- tests/pet-control.test.ts
npm test -- tests/pet-control.test.ts tests/run-worker.test.ts tests/run-orchestrator.test.ts
npm test
npm run compile
git diff --check
```

`npm run prompt:freeze` is expected to remain blocked by pre-existing prompt hash drift until that separate prompt-freeze slice updates or reconciles prompt snapshots.

## Self Review

Grade target: A. The slice is pure reducer and projection work, scoped to `core/pet/control.ts`, `tests/pet-control.test.ts`, and this plan doc. It should not touch Chrome/runtime files.
