# Pet Review Heat Slice

## Summary
Add a metadata-only review heat signal for the pet snapshot and handoff capsule. Review Heat turns existing safe review aggregates into compact heat levels and reason enums so the pet can show whether a result is safe to finalize, needs iteration, or is blocked. It does not copy issue codes, missing evidence text, evidence IDs, error details, model output, browser payloads, or raw review prose.

## Required Behavior Contract

| ID | Required Behavior | Implementation | Test Assertion / Location | Status |
|----|-------------------|----------------|---------------------------|--------|
| 1 | Keep this slice non-Chrome and pure-core only | core/pet/control.ts, tests, and this doc | staged file list before commit | covered |
| 2 | Define stable review heat levels | PetReviewHeatLevel union: none, cool, warm, hot, blocked | compile/type coverage and review heat tests | covered |
| 3 | Define stable safe reason enums | PetReviewHeatReason union | compile/type coverage and review heat tests | covered |
| 4 | Idle/no review maps to none + no_review | createPetReviewHeat | idle reducer and base snapshot default assertions | covered |
| 5 | Pass review with no debt/issues maps to cool + ready_to_finalize | createPetReviewHeat | pass A/B completion review assertions and handoff finalize assertion | covered |
| 6 | Proof debt or review issues map to hot with safe aggregate reasons | createPetReviewHeat | iterate/debt assertions and Runtime Doctor preserved-review adversarial assertion | covered |
| 7 | Fail review or F grade maps to blocked | createPetReviewHeat | fail review and handoff fail assertions | covered |
| 8 | Runtime Doctor merge recomputes heat from preserved review fields | mergeRuntimeDoctorReportIntoSnapshot | preserved-review test asserts hot despite pass decision when issueCount is nonzero | covered |
| 9 | Completion review merge recomputes heat from aggregate review fields only | mergeAutonomousCompletionReviewIntoSnapshot | pass/iterate/fail tests assert heat states and reasons | covered |
| 10 | Handoff capsule exposes only reviewHeatLevel and reviewHeatReasons from the snapshot heat signal | createPetHandoffCapsule | idle/pass/iterate/fail/privacy handoff assertions | covered |
| 11 | Handoff capsule must not expose raw review issue strings, evidence IDs, missing proof text, or error details | capsule projects heat enums and existing safe counts only | review privacy and handoff privacy negative assertions | covered |
| 12 | False-positive privacy probe proves source review contains private strings while pet/capsule expose only safe heat enums/counts | review privacy test source JSON positive control + pet/capsule negative assertions | tests/pet-control.test.ts | covered |
| 13 | Existing nextAction priority remains unchanged | createPetHandoffCapsule nextAction ladder unchanged | existing handoff nextAction tests still pass | covered |
| 14 | Create doc with coverage table and verification/self-review | this file | this file | covered |

## Adversarial / Privacy
- The review privacy test injects secret-looking strings into issue codes, missing evidence, missing criteria, accepted evidence IDs, and error details.
- The source review JSON must contain those strings as a positive control.
- The merged pet snapshot and handoff capsule must expose only grade/decision/counts/heat enums and omit the raw strings.
- Review Heat intentionally treats contradictory safe aggregates as risky: a `pass` decision with nonzero issue count is `hot`, not `cool`.

## Verification Commands
- `npm test -- tests/pet-control.test.ts` -> passed, 38/38 tests.
- `npm test -- tests/pet-control.test.ts tests/runtime-doctor.test.ts tests/run-orchestrator.test.ts tests/run-review.test.ts` -> passed, 69/69 tests.
- `npm test -- tests/run-kernel.test.ts tests/run-store.test.ts tests/run-target.test.ts tests/run-target-store.test.ts tests/run-policy.test.ts tests/run-review.test.ts tests/run-orchestrator.test.ts tests/run-iteration.test.ts tests/run-iteration-store.test.ts tests/pet-control.test.ts tests/runtime-doctor.test.ts` -> passed, 123/123 tests.
- `npm run compile` -> passed, `tsc --noEmit` clean.
- `git diff --check` -> passed.

## Notes
- This slice is reducer/test/doc only. No Chrome, background, content, sidepanel UI, browser APIs, or runtime wiring.
- Excluded: entrypoints/background.ts remains unrelated and must not be staged.
- Self-review grade: A. The slice is compact, metadata-only, keeps existing next-action behavior, and has positive/negative privacy probes.
