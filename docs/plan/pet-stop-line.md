# Pet Stop-the-Line Slice

## Summary
Add a non-Chrome Stop-the-Line control-plane contract for the pet. The pet snapshot and handoff capsule expose only a safe recommended stop action (`pause`, `cancel`, or `none`) and reason. A store-backed helper applies the recommended action to the selected cockpit run using existing autonomous run transitions. It does not expose run IDs, goals, target data, browser payloads, or raw error text.

## Required Behavior Contract

| ID | Required Behavior | Implementation | Test Assertion / Location | Status |
|----|-------------------|----------------|---------------------------|--------|
| 1 | Keep this slice non-Chrome and pure-core only | core/pet/control.ts, tests, and this doc | staged file list before commit | covered |
| 2 | Define stable stop actions | PetStopLineAction union: none, pause, cancel | compile/type coverage and stop-line tests | covered |
| 3 | Define stable safe reasons | PetStopLineReason union: no_run, can_pause, can_cancel, terminal | compile/type coverage and stop-line tests | covered |
| 4 | PetControlSnapshot exposes stopLine without run IDs or goals | stopLine fields: available, action, reason, runStatus | idle/queued/running/blocked/paused/terminal pet assertions | covered |
| 5 | No active run maps to unavailable none/no_run | createPetStopLineState | idle snapshot and apply noop assertions | covered |
| 6 | Queued/running run maps to pause/can_pause | createPetStopLineState | queued and running pet assertions | covered |
| 7 | Paused/blocked run maps to cancel/can_cancel | createPetStopLineState | paused and blocked pet assertions | covered |
| 8 | Terminal run maps to unavailable none/terminal | createPetStopLineState | terminal pet assertion | covered |
| 9 | applyPetStopLine pauses selected running/queued run via existing transitionAutonomousRun | applyPetStopLine | running apply test asserts result and durable stored status paused | covered |
| 10 | applyPetStopLine cancels paused/blocked run with safe stop-line error | applyPetStopLine | paused apply test asserts result and durable stored cancelled/error state | covered |
| 11 | applyPetStopLine noops safely when no active stoppable run exists | applyPetStopLine | no-active-run apply test | covered |
| 12 | Handoff capsule exposes only stopLineAvailable, stopLineAction, stopLineReason | createPetHandoffCapsule | idle and privacy handoff assertions | covered |
| 13 | False-positive privacy probe proves source run goals can contain private strings while stop-line result/capsule omit them and preserve safe state | apply tests and handoff privacy test | tests/pet-control.test.ts | covered |
| 14 | Existing nextAction priority remains unchanged | createPetHandoffCapsule nextAction ladder unchanged | existing handoff nextAction tests still pass | covered |
| 15 | Create doc with coverage table and verification/self-review | this file | this file | covered |

## Adversarial / Privacy
- The apply tests create runs whose goals contain secret-looking strings.
- The Stop-the-Line result must omit run IDs and goals while agreeing with durable stored state on the safe status transition.
- The handoff capsule exposes only safe stop-line enums/booleans, not run labels, run IDs, browser target data, or error details.
- The cancel path writes a generic stop-line error with no copied goal text.

## Verification Commands
- `npm test -- tests/pet-control.test.ts` -> passed, 41/41 tests.
- `npm test -- tests/pet-control.test.ts tests/runtime-doctor.test.ts tests/run-orchestrator.test.ts tests/run-review.test.ts` -> passed, 72/72 tests.
- `npm test -- tests/run-kernel.test.ts tests/run-store.test.ts tests/run-target.test.ts tests/run-target-store.test.ts tests/run-policy.test.ts tests/run-review.test.ts tests/run-orchestrator.test.ts tests/run-iteration.test.ts tests/run-iteration-store.test.ts tests/pet-control.test.ts tests/runtime-doctor.test.ts` -> passed, 126/126 tests.
- `npm run compile` -> passed, `tsc --noEmit` clean.
- `git diff --check` -> passed.

## Notes
- This slice is store/reducer/test/doc only. No Chrome, background, content, sidepanel UI, browser APIs, or runtime wiring.
- Excluded: entrypoints/background.ts remains unrelated and must not be staged.
- Self-review grade: A. The slice uses existing run transitions, exposes only safe stop-line metadata, and proves result/durable state agreement.
