# Pet Evidence Pulse Slice

## Summary
Add a metadata-only evidence pulse for the autonomous cockpit, pet snapshot, and handoff capsule. The pulse exposes safe counts, latest evidence timestamp age, and freshness status. It does not expose evidence refs, summaries, metadata, URLs, target details, model text, or raw tool payloads.

## Required Behavior Contract

| ID | Required Behavior | Implementation | Test Assertion / Location | Status |
|----|-------------------|----------------|---------------------------|--------|
| 1 | Keep this slice non-Chrome and pure-core only | core/run/orchestrator.ts, core/pet/control.ts, tests, and this doc | staged file list before commit | covered |
| 2 | Extend AutonomousRunCockpitRun with safe evidence summary only | freshEvidenceCount, staleEvidenceCount, expiredEvidenceCount, latestEvidenceAt | tests/run-orchestrator.test.ts active-run summary test | covered |
| 3 | Do not expose evidence refs, summaries, metadata, URLs, or raw strings in cockpit snapshots | only counts/timestamps are added | run-orchestrator privacy assertion | covered |
| 4 | Count fresh evidence only when freshness is fresh and expiresAt is after snapshot time | toCockpitRun filters by freshness/expiresAt | fresh+expired evidence fixture asserts freshEvidenceCount=1 | covered |
| 5 | Count expired evidence when freshness is expired or expiresAt is at/before snapshot time | toCockpitRun filters by freshness/expiresAt | expired evidence fixture asserts expiredEvidenceCount=1 | covered |
| 6 | Track latest evidence timestamp without exposing evidence ids | latestEvidenceAt = max(capturedAt) | active-run summary test asserts latestEvidenceAt | covered |
| 7 | Add PetControlSnapshot.evidence pulse with status, counts, latestCapturedAt, latestAgeMs | createPetEvidencePulse reducer | tests/pet-control.test.ts evidence pulse test | covered |
| 8 | Evidence pulse status is none when count=0, fresh when any fresh evidence exists, stale when stale evidence exists and no fresh evidence exists, expired otherwise | createPetEvidencePulse status ladder | idle pet test, fresh evidence pulse test, stale/expired synthetic cockpit test | covered |
| 9 | latestAgeMs uses generatedAt - latestCapturedAt, clamped at 0, null when no evidence exists | createPetEvidencePulse | evidence pulse test asserts latestAgeMs=100; stale synthetic cockpit asserts clamp to 0; idle asserts null | covered |
| 10 | Runtime Doctor merge preserves existing evidence pulse | mergeRuntimeDoctorReportIntoSnapshot keeps snapshot.evidence | compile/type coverage and unchanged merge tests | covered |
| 11 | Handoff capsule exposes only evidenceStatus, evidenceCount, and latestEvidenceAgeMs | createPetHandoffCapsule safe projection | handoff defaults + evidence pulse test | covered |
| 12 | Evidence pulse must not affect nextAction priority in this slice | nextAction ladder unchanged | existing handoff nextAction tests still pass | covered |
| 13 | False-positive privacy probe proves source storage contains evidence secrets while pet/capsule omit them and keep safe counts/age | evidence pulse test source JSON positive control + pet/capsule negative assertions | tests/pet-control.test.ts evidence pulse test | covered |
| 14 | Create doc with coverage table and verification/self-review | this file | this file | covered |

## Adversarial / Privacy
- The active evidence pulse test injects secret-looking strings into evidence summaries, refs, and metadata.
- The durable ledger JSON must contain those strings as a positive control.
- Pet snapshot JSON and handoff capsule JSON must omit those strings while preserving safe counts, freshness status, and latest age.
- The orchestrator active-run summary test also proves cockpit snapshots omit raw evidence refs, summaries, and metadata.

## Verification Commands
- `npm test -- tests/run-orchestrator.test.ts tests/pet-control.test.ts` -> passed, 48/48 tests.
- `npm test -- tests/pet-control.test.ts tests/runtime-doctor.test.ts tests/run-orchestrator.test.ts tests/run-review.test.ts` -> passed, 67/67 tests.
- `npm test -- tests/run-kernel.test.ts tests/run-store.test.ts tests/run-target.test.ts tests/run-target-store.test.ts tests/run-policy.test.ts tests/run-review.test.ts tests/run-orchestrator.test.ts tests/run-iteration.test.ts tests/run-iteration-store.test.ts tests/pet-control.test.ts tests/runtime-doctor.test.ts` -> passed, 121/121 tests.
- `npm run compile` -> passed, `tsc --noEmit` clean.
- `git diff --check` -> passed.

## Notes
- This slice is reducer/snapshot/test/doc only. No Chrome, background, content, sidepanel UI, browser APIs, or runtime wiring.
- Excluded: entrypoints/background.ts remains unrelated and must not be staged.
- Self-review grade: A. The slice is compact, metadata-only, and directly covered by privacy probes.
