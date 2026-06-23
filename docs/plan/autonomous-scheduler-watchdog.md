# Autonomous Scheduler Watchdog

## Purpose

Add a pure restartable scheduler watchdog contract for autonomous runs.

This slice keeps Chrome/runtime wiring frozen. It only adds pure core liveness evaluation plus worker/orchestrator coverage that proves unsafe state cannot advance to executor work.

## Scope

- Added `core/run/scheduler-watchdog.ts`.
- Updated `core/run/worker.ts` to evaluate the watchdog before queue start, policy review, or executor dispatch.
- Added focused unit coverage in `tests/run-scheduler-watchdog.test.ts`.
- Added worker and orchestrator adversarial probes in `tests/run-worker.test.ts` and `tests/run-orchestrator.test.ts`.
- Did not touch `entrypoints/background.ts`.

## Contract Coverage

| Required behavior | Assertion | Status |
| --- | --- | --- |
| Pure watchdog evaluation is deterministic and side-effect free | `tests/run-scheduler-watchdog.test.ts` calls `evaluateAutonomousSchedulerWatchdog` with plain objects and no store/browser globals | Covered |
| Verdict includes decision, reason, retryability, blocking flag, recommended status, safe error, and bounded details | Unit tests assert verdict shape for idle, runnable, lease, evidence, progress, review-lane, and quality-gate cases | Covered |
| Terminal runs do not call executor | Unit test asserts `terminalNoop`; existing worker terminal test still passes | Covered |
| Paused and already-blocked runs do not advance | Unit test asserts `paused` and `blocked`; existing worker/orchestrator no-resume tests still pass | Covered |
| Expired, missing, or inactive target lease blocks before executor | Unit tests cover missing/inactive/expired; worker and orchestrator probes cover all three states and assert executor not called, durable run blocked, and result/durable status agreement | Covered |
| Stale or expired evidence cannot be used as fresh proof | Unit test covers stale and expired required evidence with no accepted fresh evidence | Covered |
| Repeated no-progress or same-error state blocks before more work dispatch | Unit test covers both `run_no_progress` and `run_repeated_error`; worker probes cover both; orchestrator probe covers no-progress after-snapshot agreement | Covered |
| Review-lane P1/P2/block recommendation fails closed | Unit test covers contradictory gate; existing worker review-lane adversarial probe still passes | Covered |
| Persisted quality gate blockers can be represented by the watchdog contract | Unit test covers quality-gate-like blocked verdict; cycle-level quality-gate enforcement remains the existing orchestrator non-mutating hold path and is intentionally not duplicated in worker options | Covered |
| No runnable run returns idle/noop without mutation | Unit test covers missing run; existing orchestrator no-runnable test still passes | Covered |
| Result object and durable state agree after watchdog block | Worker expired-lease probe asserts `result.finalStatus` and `result.errorCode` match `getAutonomousRunById`; orchestrator probe asserts `afterSnapshot.activeRun` matches durable block | Covered |
| No raw prompts, transcripts, secrets, URLs, target labels, evidence body, or raw ids leak from watchdog details | Unit privacy probe injects raw goal, lease, evidence, URL, and secret-like values and asserts verdict JSON excludes them | Covered |
| Runtime/Chrome wiring remains frozen | `entrypoints/background.ts` excluded and verified by diff command | Covered |

## Adversarial Probe

False-positive success probe: a running run with an expired durable target lease is selected by the orchestrator, but the worker watchdog blocks before executor dispatch. The worker result reports `finalStatus=blocked`, durable storage reports `status=blocked`, and the orchestrator after-snapshot reports the same blocked status and error code.

This catches the dangerous case where a cycle could otherwise return an advance/success-like result while durable state should have blocked.

## Verification

- `npm test -- tests/run-scheduler-watchdog.test.ts tests/run-worker.test.ts tests/run-orchestrator.test.ts` passed: 66 tests after P2 coverage iteration.
- `npm test -- tests/run-scheduler-watchdog.test.ts tests/run-orchestrator.test.ts tests/run-worker.test.ts tests/run-result-consistency.test.ts tests/run-iteration-store.test.ts` passed: 85 tests.
- `npm run compile` passed.
- `npm test` passed: 101 files, 820 tests.
- `git diff --check` passed.
- `git diff --name-only HEAD -- entrypoints/background.ts` returned no files.

## Self Review

Grade: A after P2 coverage iteration.

Reason: the pure contract is small, tested directly, and integrated at the worker boundary that the orchestrator already uses. The false-positive success probes now cover missing, inactive, and expired leases plus progress-budget blocks; full suite passes, and the frozen runtime boundary remains untouched.

Independent Grok review initially found P2 coverage gaps for missing/inactive lease and progress-budget integration probes. This slice iterated before advancing and added those probes.
