# Pet Review Proof Signal Slice

## Summary

Add a compact, safe `review` section to `PetControlSnapshot` derived only from aggregate fields of `AutonomousRunCompletionReview`. The pet snapshot now carries grade, decision, proof debt, issue count, accepted evidence count, and `canFinalize` without leaking raw evidence, issue codes, missing proof text, evidence ids, error details, model output, or target data.

## Required Behavior Contract

| ID | Required Behavior | Implementation | Test Assertion / Location | Status |
|----|-------------------|----------------|---------------------------|--------|
| 1 | Read AGENTS.md and docs/plan/deepseek-pet-handoff.md before editing | Performed before implementation | N/A | covered |
| 2 | Inspect core/pet/control.ts, core/run/review.ts, tests/pet-control.test.ts, tests/run-review.test.ts, docs/plan/autonomous-review-grade-iterate.md | Performed before implementation | N/A | covered |
| 3 | Extend `PetControlSnapshot` with compact review section | `core/pet/control.ts` | Base snapshot assertions in `tests/pet-control.test.ts` | covered |
| 4 | `createPetControlSnapshotFromRunCockpit` populates review defaults | `grade=null`, `decision=null`, counts `0`, `canFinalize=false` | `base pet snapshots include review defaults` | covered |
| 5 | Runtime Doctor merge preserves base review section | `mergeRuntimeDoctorReportIntoSnapshot` carries `snapshot.review` forward | `Runtime Doctor merge preserves review values already present...` | covered |
| 6 | Add pure `mergeAutonomousCompletionReviewIntoSnapshot(snapshot, review)` with type-only imports | `core/pet/control.ts` imports only `AutonomousRunCompletion*` types | Merge tests call the function directly | covered |
| 7 | Merge copies only safe aggregate fields | Production code reads grade, decision, and array lengths only | Privacy probe checks raw strings absent from pet JSON | covered |
| 8 | `proofDebtCount = doneCriteriaMissing.length + requiredEvidenceMissing.length` | Production reducer | Iterate/fail test and privacy probe assert counts | covered |
| 9 | `issueCount = issueCodes.length` | Production reducer | Pass, iterate/fail, and privacy tests assert counts | covered |
| 10 | `acceptedEvidenceCount = acceptedEvidenceIds.length` | Production reducer | Pass, iterate/fail, and privacy tests assert counts | covered |
| 11 | `canFinalize` true only when `decision === 'pass'` | Production reducer | Pass and iterate/fail tests assert true/false | covered |
| 12 | Null/undefined review returns original snapshot object | Early return in reducer | `if review is null/undefined...` test uses `toBe` | covered |
| 13 | False-positive privacy proof | Source review JSON contains secret issue/missing/evidence/error strings; pet JSON omits them | Privacy probe test | covered |
| 14 | No Chrome/background/runtime work | Diff limited to core pet reducer, pet tests, and this doc | `entrypoints/background.ts` remains unrelated and unstaged | covered |

## Adversarial / Privacy
- Privacy probe constructs review with secret tokens in all raw list fields + error details.
- Asserts pet counts/grade/decision are correct but JSON of snapshot contains none of the secret strings.

## Verification Commands

- `npm test -- tests/pet-control.test.ts tests/run-review.test.ts` -> 34/34 passed.
- `npm test -- tests/pet-control.test.ts tests/runtime-doctor.test.ts tests/run-orchestrator.test.ts` -> 47/47 passed.
- `npm test -- tests/run-kernel.test.ts tests/run-store.test.ts tests/run-target.test.ts tests/run-target-store.test.ts tests/run-policy.test.ts tests/run-review.test.ts tests/run-orchestrator.test.ts tests/run-iteration.test.ts tests/run-iteration-store.test.ts tests/pet-control.test.ts tests/runtime-doctor.test.ts` -> 110/110 passed.
- `npm run compile` -> passed.
- `git diff --check` -> passed.

## Notes
Self-review grade: A.

This slice is reducer + tests + docs only. No Chrome, background, UI, or runtime wiring changes.
