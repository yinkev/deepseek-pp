# Review Lane Scheduler

## Contract

Add a pure review-lane dispatch planner for autonomous runs. This slice does not wire Chrome/runtime callers and does not import pet control into `core/run`.

| Requirement | Coverage |
| --- | --- |
| Defaults or non-runnable status return `idle`, no selected roles, `canRunWorker: false`. | `returns idle for defaults or no runnable run and allows no roles` |
| Non-runnable terminal/paused states ignore stale blocked gates and expose no stale blocking priority/count. | `returns idle for non-runnable runs even with a stale blocked gate` |
| P1, P2, or block recommendation halts before any dispatch logic. | `halts on P1, P2, or block recommendation before dispatching roles` |
| Contradictory blocked gate fields fail closed. | `halts on contradictory blocked gate fields before any dispatch` |
| Attention gate reasons (`active_review`, `failed_lane`, `blocked_lane`) do not halt when `canProceed` is true. | `does not halt on attention gates and can still dispatch` |
| Active lane count at capacity returns `hold`, no roles, `canRunWorker: true`. | `holds when active lane count is already at maxParallel` |
| Unknown active lane roles still count against capacity without leaking raw role text. | `counts unknown active lanes against maxParallel without leaking the role` |
| Queued/running work dispatches implementer first. | `dispatches implementer first for queued or running work` |
| Worker progress dispatches reviewer when implementer is occupied. | `dispatches reviewer after worker progress when implementer is occupied` |
| Shell/browser/memory risk dispatches safety. | `dispatches safety for shell, browser, or memory risk` |
| UI risk dispatches UX. | `dispatches ux for ui risk` |
| Oracle lane dispatches only when requested and capacity remains. | `dispatches oracle only when requested and capacity remains` |
| Selected roles respect `maxParallel`. | `caps role selection by maxParallel` |
| Planner output contains only safe enums, booleans, and counts. | `keeps raw secret fields out of planner output JSON` |
| False-positive success probe: halt plans cannot dispatch roles or allow worker execution. | `adversarial probe: halt plans never dispatch roles or allow worker execution` |

## Mechanism

`planAutonomousReviewLanes(input)` consumes run status, safe lane role/status metadata, risk booleans, oracle request state, capacity, and the same review-lane gate shape accepted by `executeAutonomousRunCycle`.

Decision order:

1. Idle if the run is not `queued` or `running`, ignoring stale gate fields.
2. Halt on blocking gate signals (`status: blocked`, `canProceed: false`, P1/P2, or block recommendation).
3. Hold if active lanes already meet `maxParallel`.
4. Select roles by priority: implementer, reviewer, safety, UX, oracle.

The planner is pure. It does not call storage, Chrome, terminal, network, worker execution, or pet reducers.

## Adversarial Probe

The halt probe gives the planner a runnable queued run plus every dispatch trigger and a P2 gate. The returned plan must have `action: halt`, `selectedRoles: []`, `canRunWorker: false`, and `blockingPriority: P2`.

The durable state agreement probe is not testable in this pure slice because no durable state is read or written. The adjacent consumer slice covers durable agreement in `tests/run-worker.test.ts` and `tests/run-orchestrator.test.ts`.

## Scope Caveat

Independent Grok review found a production-enforcement gap: the run worker can consume `reviewLaneGate`, but no Chrome/runtime caller is wired in this non-Chrome slice. Because Chrome/background work remains explicitly frozen, this scheduler is only a pure planning primitive. Do not claim review-lane enforcement is production-complete until a runtime caller feeds a fresh gate into the orchestrator every cycle.

## Verification

Run:

```sh
npm test -- tests/run-review-scheduler.test.ts
npm test -- tests/run-review-scheduler.test.ts tests/run-worker.test.ts tests/run-orchestrator.test.ts
npm test
npm run compile
git diff --check
```

`npm run prompt:freeze` remains expected to fail on pre-existing prompt hash drift until the prompt snapshot slice reconciles it.

## Self Review

Grade target: A. The slice is pure TypeScript/domain logic, keeps roles/statuses safe, and does not touch Chrome/runtime or forbidden files.
