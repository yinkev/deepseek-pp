# Pet Target Lease Pulse Slice

## Summary
Add a metadata-only target lease pulse for the autonomous cockpit, pet snapshot, and handoff capsule. The pulse exposes safe lease status, age, and expiry countdown. It does not expose tab ids, window ids, origins, titles, URLs, or browser payloads; pet and handoff surfaces also omit lease ids.

## Required Behavior Contract

| ID | Required Behavior | Implementation | Test Assertion / Location | Status |
|----|-------------------|----------------|---------------------------|--------|
| 1 | Keep this slice non-Chrome and pure-core only | core/run/orchestrator.ts, core/pet/control.ts, tests, and this doc | staged file list before commit | covered |
| 2 | Extend AutonomousRunCockpitRun with safe target lease summary only | targetLeaseStatus, targetLeaseAgeMs, targetLeaseExpiresInMs | tests/run-orchestrator.test.ts active-run summary test | covered |
| 3 | Do not expose tab/window ids, origins, titles, URLs, or raw strings in the new pulse fields; pet/capsule outputs must also omit lease ids | only status and timing fields are projected | run-orchestrator and pet-control privacy assertions | covered |
| 4 | Active target leases report active while expiresAt is after snapshot time | getCockpitTargetLeaseStatus | active-run summary test asserts targetLeaseStatus active | covered |
| 5 | Active target leases report expired when expiresAt is at/before snapshot time without mutating storage | getCockpitTargetLeaseStatus | expired target lease pet test asserts leaseStatus expired | covered |
| 6 | targetLeaseAgeMs is generatedAt - acquiredAt, clamped to zero | toCockpitRun | active-run summary and expired target tests assert age | covered |
| 7 | targetLeaseExpiresInMs is expiresAt - generatedAt, clamped to zero | toCockpitRun | active-run summary and expired target tests assert countdown | covered |
| 8 | Pet target is locked only when leaseStatus is active | createPetControlSnapshotFromRunCockpit | active lease target test and expired lease target test | covered |
| 9 | Pet target becomes stale with generic Target stale label when leaseStatus is stale/expired/released | createPetControlSnapshotFromRunCockpit | expired lease target test | covered |
| 10 | Runtime Doctor merge preserves existing lease pulse while overriding generic target readiness | mergeRuntimeDoctorReportIntoSnapshot | Runtime Doctor target tests assert preserved leaseStatus none | covered |
| 11 | Handoff capsule exposes only targetLeaseStatus, targetLeaseAgeMs, and targetLeaseExpiresInMs | createPetHandoffCapsule | handoff defaults and expired target test | covered |
| 12 | Expired/stale target lease drives existing open_target handoff via targetState stale, without adding browser mutation | target.stale feeds existing nextAction ladder | expired target capsule asserts nextAction open_target | covered |
| 13 | False-positive privacy probe proves durable source contains target secrets while pet/capsule omit them and keep safe status/age/expiry | expired target lease test source JSON positive control + negative assertions | tests/pet-control.test.ts expired target lease test | covered |
| 14 | Create doc with coverage table and verification/self-review | this file | this file | covered |

## Adversarial / Privacy
- The expired target lease test injects secret-looking data into target lease origin/title.
- The durable ledger JSON must contain those strings as a positive control.
- Pet snapshot JSON and handoff capsule JSON must omit those strings and the lease id while preserving safe status, age, expiry countdown, and nextAction.
- The orchestrator active-run summary test proves cockpit target lease output is status/timing only.

## Verification Commands
- `npm test -- tests/run-orchestrator.test.ts tests/pet-control.test.ts` -> passed, 49/49 tests.
- `npm test -- tests/pet-control.test.ts tests/runtime-doctor.test.ts tests/run-orchestrator.test.ts tests/run-review.test.ts` -> passed, 68/68 tests.
- `npm test -- tests/run-kernel.test.ts tests/run-store.test.ts tests/run-target.test.ts tests/run-target-store.test.ts tests/run-policy.test.ts tests/run-review.test.ts tests/run-orchestrator.test.ts tests/run-iteration.test.ts tests/run-iteration-store.test.ts tests/pet-control.test.ts tests/runtime-doctor.test.ts` -> passed, 122/122 tests.
- `npm run compile` -> passed, `tsc --noEmit` clean.
- `git diff --check` -> passed.

## Notes
- This slice is reducer/snapshot/test/doc only. No Chrome, background, content, sidepanel UI, browser APIs, or runtime wiring.
- Excluded: entrypoints/background.ts remains unrelated and must not be staged.
- Self-review grade: A. The slice is compact, metadata-only, and directly covered by privacy probes.
