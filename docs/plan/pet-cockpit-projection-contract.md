# Pet Cockpit Projection Contract

## Purpose

Step 8 completes the pure pet cockpit projection contract.

The pet snapshot and handoff capsule now expose safe metadata for run posture, run queue, scheduler/watchdog verdicts, telemetry handoff, quality gate row/probe status, review lane gate, projection fidelity, and stop-line state. This is metadata projection only; it does not add UI/runtime wiring, Chrome/background work, or live browser mutation.

## Contract Coverage

| Requirement | Coverage |
| --- | --- |
| Pet snapshot exposes scheduler/watchdog gate state. | `PetControlSnapshot.schedulerWatchdog` stores compact verdict status, decision, reason, retryability, block flag, recommended status, safe error code, and bounded counts. |
| Pet handoff exposes scheduler/watchdog state. | `PetHandoffCapsule` includes `schedulerWatchdog*` fields; `tests/pet-control.test.ts` asserts defaults and populated blocked verdicts. |
| Scheduler/watchdog data is safe metadata only. | `normalizeWatchdogErrorCode` allowlists known error shapes and maps unknown/raw strings to `unknown_watchdog_error`; privacy tests inject secret-like raw watchdog data and assert it stays out of snapshot/handoff JSON. |
| Orchestrator-cycle bridge preserves watchdog projection. | `tests/pet-orchestrator-bridge.test.ts` verifies worker verdict metadata survives the final cockpit projection merge. |
| Existing cockpit surfaces remain intact. | Focused tests cover run queue, telemetry, quality gate, review lane gate, projection fidelity, stop-line, and handoff fields. |
| Runtime/background remain frozen. | Verification includes `git diff --name-only HEAD -- entrypoints/background.ts`; this slice changes no Chrome/runtime files. |

## Verification

Passed:

```sh
npm test -- tests/pet-control.test.ts tests/pet-orchestrator-bridge.test.ts tests/run-telemetry.test.ts tests/run-orchestrator.test.ts
npm run compile
npm test
git diff --check
git diff --name-only HEAD -- entrypoints/background.ts
```

Results: focused Step 8 suite passed 178/178; TypeScript compile passed; full suite passed 850/850; diff check passed; `entrypoints/background.ts` diff was empty.

## Self Review

Grade: A.

Iteration applied before commit:

- TypeScript compile initially failed because optional watchdog detail counts were passed to a numeric normalizer that accepted only `number | null`.
- The normalizer call sites now coerce missing detail values to `null`, compile passes, and focused tests still pass.

Reason: the only missing Step 8 surface was scheduler/watchdog projection. The implementation adds that surface as bounded safe metadata while preserving all existing cockpit, handoff, privacy, and runtime-freeze constraints.
