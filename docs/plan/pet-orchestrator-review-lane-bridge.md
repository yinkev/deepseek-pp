# Pet Orchestrator Review Lane Bridge

## Contract

Add a pure bridge from pet review-lane state to orchestrator review-lane options. The bridge lives under `core/pet` so `core/run` remains independent of pet control.

| Requirement | Coverage |
| --- | --- |
| Default pet snapshots produce clear review-lane gate options and empty scheduler lanes. | `maps a default pet snapshot to clear review lane orchestrator options` |
| Review lane summaries project only safe role/status fields into the scheduler. | `projects sanitized pet review lanes, worker pulse, risk, and oracle request` |
| Worker pulse, memory/browser/shell/ui risk, maxParallel, and oracle request map into scheduler metadata. | `projects sanitized pet review lanes, worker pulse, risk, and oracle request` |
| Gate fields are re-derived from sanitized lane summaries instead of trusting forged snapshot gate fields. | `re-derives the gate from sanitized summaries instead of trusting forged snapshot gate fields` |
| Pet-derived blocking gates can be passed to the orchestrator and durably block worker execution. | `feeds pet-derived blocking gate into orchestrator and durable worker block` |
| Raw pet labels, transcripts, messages, URLs, and unknown fields do not appear in bridged options. | `keeps raw pet snapshot fields out of bridged orchestrator options` |

## Mechanism

`createPetOrchestratorReviewLaneOptions(snapshot, options)` returns only:

- `reviewLaneGate`
- `reviewLaneScheduler`

The bridge sanitizes `snapshot.reviewLanes.lanes`, caps at four lanes, maps unknown roles to `other`, and re-derives the gate with `createPetReviewLaneGate`. It does not trust hand-built `snapshot.reviewLaneGate` fields.

This is still a pure non-Chrome seam. It does not schedule timers, call Chrome APIs, execute review workers, mutate storage, or start browser/runtime work.

## Adversarial Probe

The durable probe creates a queued run, builds a pet snapshot with a P2 review lane, bridges it into orchestrator options, and proves:

- `reviewLanePlan.action` is `halt`.
- no roles are dispatched;
- `canRunWorker` is false;
- the executor is not called;
- durable run status and worker result both agree on `blocked` with `autonomous_review_lane_gate_blocked`.

The privacy probe injects raw role text, labels, transcripts, URLs, and messages into a hand-built pet snapshot and verifies the bridged options omit all of them.

## Scope Caveat

This closes the typed pure boundary from pet state to orchestrator options. Production runtime enforcement still requires a Chrome/runtime caller to invoke this bridge with a fresh pet snapshot every cycle; that remains frozen until Chrome work is explicitly resumed.

## Verification

Run:

```sh
npm test -- tests/pet-orchestrator-bridge.test.ts
npm test -- tests/pet-orchestrator-bridge.test.ts tests/run-orchestrator.test.ts tests/run-review-scheduler.test.ts tests/run-worker.test.ts tests/pet-control.test.ts
npm test
npm run compile
git diff --check
```

`npm run prompt:freeze` remains expected to fail on pre-existing prompt hash drift until the prompt snapshot slice reconciles it.

## Self Review

Grade target: A. This slice is pure adapter logic and documentation, scoped to pet/run contract boundaries without touching Chrome/runtime files.
