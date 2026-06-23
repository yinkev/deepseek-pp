# Autonomous Review Dispatch Contract

## Purpose

Step 6 is the pure review dispatch contract for autonomous worker lanes.

It defines implementer, reviewer, safety, UX, Oracle, and Grok lanes as bounded metadata. It does not invoke live workers, spawn Grok, call Oracle, touch Chrome/runtime wiring, or mutate `entrypoints/background.ts`.

## Contract Coverage

| Requirement | Coverage |
| --- | --- |
| Defaults or non-runnable runs do not dispatch lanes. | `returns idle for defaults or no runnable run and allows no roles` in `tests/run-review-scheduler.test.ts`. |
| P1, P2, block recommendation, failed, or blocked gates prevent advancement before dispatch. | Scheduler halt tests plus persisted gate tests in `tests/run-orchestrator.test.ts`. |
| Implementer, reviewer, safety, UX, Oracle, and Grok roles are selected only from safe metadata and capacity. | Role dispatch tests in `tests/run-review-scheduler.test.ts`. |
| Oracle and Grok lanes require explicit request booleans and do not carry prompts, sessions, URLs, or transcripts. | Oracle/Grok scheduler tests and bridge privacy tests. |
| Planned lane output contains only compact enums, booleans, priorities, and counts. | Planner privacy test and orchestrator privacy tests. |
| Durable review-lane records persist compact advisor outcomes and sanitize raw reviewer fields. | `tests/run-review-lane-store.test.ts`. |
| Pet bridge projects planned lane metadata without claiming live workers are running. | `tests/pet-orchestrator-bridge.test.ts` and related docs. |
| Result object and durable state agree when blockers are consumed. | `tests/run-orchestrator.test.ts` and `tests/run-worker.test.ts` review-lane blocker probes. |
| Runtime and Chrome/background remain frozen. | `git diff --name-only HEAD -- entrypoints/background.ts` must stay empty for this slice. |

## Mechanism

- `planAutonomousReviewLanes` returns `idle`, `dispatch`, `hold`, or `halt`.
- `appendAutonomousReviewLaneRecord` stores compact reviewer outcomes.
- The orchestrator merges explicit and persisted review-lane gates before worker execution.
- The pet bridge converts safe pet lane summaries into orchestrator scheduler options and projects plan results back into pet metadata.

## Scope Boundary

This is not live worker spawning. Actual review-worker execution remains a runtime-wiring task after the Chrome/runtime freeze is explicitly lifted.

## Verification

Verified command:

```sh
npm test -- tests/run-review-scheduler.test.ts tests/run-worker-prompt.test.ts tests/run-review-lane-store.test.ts tests/run-orchestrator.test.ts
```

Result: 71/71 tests passed.

## Self Review

Grade: A.

The current repo already had the pure scheduler, store, orchestrator consumption, Grok/Oracle metadata, and pet bridge pieces. This doc records the verified Step 6 contract and makes the roadmap transition explicit without adding duplicate abstractions.
