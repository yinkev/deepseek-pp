# Pet Blocker Lens Slice

## Summary
Add a metadata-only blocker lens for the pet snapshot and handoff capsule. The lens converts raw readiness blockers, stale target signals, leak counts, blocked run state, and review proof debt into safe blocker categories. It exposes categories and counts only; raw blocker text stays out of the handoff capsule.

## Required Behavior Contract

| ID | Required Behavior | Implementation | Test Assertion / Location | Status |
|----|-------------------|----------------|---------------------------|--------|
| 1 | Keep this slice non-Chrome and pure-core only | core/pet/control.ts, tests, and this doc | staged file list before commit | covered |
| 2 | Define stable blocker categories | PetBlockerCategory union and fixed priority list | compile/type coverage and blocker lens tests | covered |
| 3 | Classify raw blocker strings into safe categories, not raw text | classifyPetBlocker | raw blocker category test | covered |
| 4 | Fixed primary category priority is leak, target, auth, policy, budget, evidence, review, paused, busy, runtime, unknown | PET_BLOCKER_CATEGORY_PRIORITY | raw blocker category test asserts primary leak and ordered categories | covered |
| 5 | Target stale signal adds target category when no target blocker is present | createPetBlockerLens targetStale signal | Runtime Doctor target status test asserts target blocker lens for stale statuses with no raw target blocker | covered |
| 6 | Leak issue count adds leak category when no raw leak blocker is present | createPetBlockerLens leakIssueCount signal | ready Runtime Doctor merge test asserts leak category/count from leak issue count only | covered |
| 7 | Blocked run phase adds review category unless paused already explains it | createPetBlockerLens runPhase signal | blocked handoff tests still pass | covered |
| 8 | Review proof debt adds evidence category and review issue count adds review category | mergeAutonomousCompletionReviewIntoSnapshot recomputes lens | iterate/fail review test asserts evidence/review counts | covered |
| 9 | Runtime Doctor merge recomputes blocker lens from updated readiness/target/safety state | mergeRuntimeDoctorReportIntoSnapshot recomputes lens | raw blocker category test and existing Runtime Doctor tests | covered |
| 10 | Handoff capsule exposes blockerPrimaryCategory, blockerCategories, and blockerCategoryCounts only | createPetHandoffCapsule projection | idle handoff default and raw blocker capsule test | covered |
| 11 | Handoff capsule must not expose raw readiness blocker strings or secret-looking blocker payloads | capsule omits readiness.blockers and stores categories/counts | raw blocker capsule negative assertion | covered |
| 12 | Existing blockerCount remains raw blocker count for backwards compatibility | createPetHandoffCapsule keeps blockerCount = readiness.blockers.length | existing handoff privacy test asserts blockerCount | covered |
| 13 | False-positive privacy probe proves source contains private blocker text while capsule omits it and preserves safe category counts | raw blocker category test source JSON positive control + capsule negative assertion | tests/pet-control.test.ts | covered |
| 14 | Create doc with coverage table and verification/self-review | this file | this file | covered |

## Adversarial / Privacy
- The raw blocker test injects private-looking text into auth, target, leak, and policy blockers.
- The source pet snapshot JSON must contain that private text as a positive control.
- The handoff capsule JSON must omit those strings while preserving safe category counts and primary category.
- PetControlSnapshot still keeps internal readiness.blockers for existing behavior; the safe handoff boundary is the capsule blocker lens.

## Verification Commands
- `npm test -- tests/pet-control.test.ts` -> passed, 38/38 tests.
- `npm test -- tests/pet-control.test.ts tests/runtime-doctor.test.ts tests/run-orchestrator.test.ts tests/run-review.test.ts` -> passed, 69/69 tests.
- `npm test -- tests/run-kernel.test.ts tests/run-store.test.ts tests/run-target.test.ts tests/run-target-store.test.ts tests/run-policy.test.ts tests/run-review.test.ts tests/run-orchestrator.test.ts tests/run-iteration.test.ts tests/run-iteration-store.test.ts tests/pet-control.test.ts tests/runtime-doctor.test.ts` -> passed, 123/123 tests.
- `npm run compile` -> passed, `tsc --noEmit` clean.
- `git diff --check` -> passed.

## Notes
- This slice is reducer/test/doc only. No Chrome, background, content, sidepanel UI, browser APIs, or runtime wiring.
- Excluded: entrypoints/background.ts remains unrelated and must not be staged.
- Self-review grade: A. The slice is compact, category-only, and covered by a false-positive privacy probe.
