# Autonomous Restart Reconciliation

## Purpose

Harden startup reconciliation so invalid running work becomes a durable blocker before the orchestrator selects more work.

This slice is pure store/orchestrator behavior. It does not touch Chrome runtime wiring or `entrypoints/background.ts`.

## Scope

- Extended `reconcileInterruptedAutonomousRuns` in `core/run/store.ts`.
- Added store-level reconciliation for missing, inactive, and expired target leases.
- Added orchestrator coverage proving expired target leases are reconciled before falling back to queued work.
- Updated existing orchestrator invalid-lease expectations now that reconciliation happens before worker selection.

## Contract Coverage

| Required behavior | Assertion | Status |
| --- | --- | --- |
| Stale running runs still reconcile to blocked/retryable | Existing `tests/run-store.test.ts` stale-running test and orchestrator stale fallback test still pass | Covered |
| Missing target lease on running run reconciles before selection | Store test asserts blocked run with `autonomous_reconcile_target_lease_missing`; orchestrator invalid-lease test asserts no worker selection | Covered |
| Inactive target lease on running run reconciles before selection | Store test uses released lease reattached to run and asserts `autonomous_reconcile_target_lease_inactive`; orchestrator test asserts no worker selection | Covered |
| Expired active target lease on running run reconciles before selection | Store test asserts `autonomous_reconcile_target_lease_expired`; orchestrator fallback test blocks expired running run then selects queued run | Covered |
| Reconciliation error metadata is safe | Reconcile details contain only lease status and bounded lease age/expiry numbers, not lease id, label, title, origin, URL, prompt, evidence body, or secrets | Covered |
| Terminal, paused, blocked, and queued runs are not mutated by this reconciliation path | Existing store/orchestrator no-resume and terminal tests still pass | Covered |
| Result object and durable state agree after reconciliation | Orchestrator tests assert selected run behavior, durable blocked status, and cockpit snapshot error codes after reconciliation | Covered |
| Runtime/Chrome wiring remains frozen | `entrypoints/background.ts` excluded and verified by diff command | Covered |

## Adversarial Probe

False-positive progress probe: a running run with an expired target lease is present alongside a queued run. Startup reconciliation blocks the invalid running run before selection, the orchestrator selects the queued run, and durable state for the expired run records `autonomous_reconcile_target_lease_expired`.

This prevents a stale running run from hiding the runnable queue or advancing with an invalid target lease.

## Verification

- `npm test -- tests/run-store.test.ts tests/run-orchestrator.test.ts tests/run-worker.test.ts tests/run-scheduler-watchdog.test.ts` passed: 83 tests.
- `npm test -- tests/run-store.test.ts tests/run-orchestrator.test.ts tests/run-target-store.test.ts tests/run-worker.test.ts tests/run-scheduler-watchdog.test.ts` passed: 89 tests.
- `npm run compile` passed.
- `npm test` passed: 101 files, 824 tests.
- `git diff --check` passed.
- `git diff --name-only HEAD -- entrypoints/background.ts` returned no files.

## Self Review

Grade: A.

Reason: the slice is narrow and moves invalid running target leases into durable blocked state before selection. Result/snapshot behavior is covered, full suite passes, and the frozen runtime boundary remains untouched.
