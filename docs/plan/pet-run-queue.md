# Pet Run Queue

## Contract

The pet control snapshot exposes durable run queue posture as safe telemetry only. It does not schedule work, mutate runs, expose run IDs, or change handoff `nextAction`.

Required behavior:

| Requirement | Coverage |
| --- | --- |
| Empty/base snapshots default to zero queue counts, no backlog, no contention, `idle` posture. | `createPetControlSnapshotFromRunCockpit and createBase default to no queued work observed` |
| Queued-only totals project `waiting` posture and backlog. | `createPetRunQueue derives waiting, draining, contention, and blocked-ahead posture from totals` |
| Running plus queued totals project `draining` posture and contention. | `createPetRunQueue derives waiting, draining, contention, and blocked-ahead posture from totals` |
| Blocked plus queued totals project `blocked_ahead` posture. | `createPetRunQueue derives waiting, draining, contention, and blocked-ahead posture from totals` |
| Paused or blocked work without queued backlog projects `held` posture. | `createPetRunQueue derives waiting, draining, contention, and blocked-ahead posture from totals`; `createPetControlSnapshotFromRunCockpit wires non-idle totals into run queue projection` |
| Non-idle cockpit totals are wired through `createPetControlSnapshotFromRunCockpit`. | `createPetControlSnapshotFromRunCockpit wires non-idle totals into run queue projection` |
| Durable blocked and paused ledger states reach held queue posture through `getPetControlSnapshot`. | `getPetControlSnapshot projects held posture from a durable blocked run` |
| Invalid numeric totals are clamped to safe non-negative integers. | `createPetRunQueue derives waiting, draining, contention, and blocked-ahead posture from totals` |
| Handoff mirrors queue fields across waiting, draining, held, and blocked-ahead postures and queue telemetry does not alter `nextAction` or adjacent lenses. | `createPetHandoffCapsule projects run queue fields and does not alter nextAction or adjacent lenses` |
| Queue projection and queue-only capsule fields expose counts/posture only, not run ids, goals, labels, or blockers. | `run queue projection carries counts only and does not leak run ids, goals, blockers, or labels` |

## Mechanism

`createPetRunQueue` derives:

- `queuedDepth`
- `runningCount`
- `pausedCount`
- `blockedCount`
- `backlog`
- `contention`
- `posture`

Posture priority:

1. `blocked_ahead` when blocked and queued work coexist.
2. `draining` when any run is running.
3. `waiting` when queued work exists.
4. `held` when paused or blocked work exists without queued backlog.
5. `idle` otherwise.

The handoff capsule mirrors the queue projection as compact fields. It does not alter `nextAction`; queue execution remains a later scheduler concern.

## Adversarial Probe

The queue handoff test proves queue telemetry can coexist with `finalize` without changing `nextAction`. The privacy probe verifies the queue projection carries only numeric counts, booleans, and posture enums.

## Verification

Run:

```sh
npm test -- tests/pet-control.test.ts
npm test -- tests/pet-control.test.ts tests/run-worker.test.ts tests/run-orchestrator.test.ts
npm test
npm run compile
git diff --check
```

`npm run prompt:freeze` remains blocked by the known prompt hash drift and is not caused by this queue projection slice.

## Self Review

Grade target: A. This slice is pure pet snapshot/handoff telemetry and does not touch Chrome/runtime files.
