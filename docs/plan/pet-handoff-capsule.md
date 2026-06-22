# Pet Handoff Capsule Slice

## Summary
Add a pure safe `PetHandoffCapsule` derived from `PetControlSnapshot` via `createPetHandoffCapsule`. This is the near-term Handoff Capsule feature: one reducer produces compact worker/control handoff with safe enums/counts and one next action. Never exposes raw run goals, blockers, target labels (except generic marker), issue strings, evidence ids, URLs, model text, tool payloads, or Runtime Doctor prose.

## Required Behavior Contract

| ID | Required Behavior | Implementation | Test Assertion / Location | Status |
|----|-------------------|----------------|---------------------------|--------|
| 1 | Keep this slice limited to the pet handoff reducer, tests, and documentation | Only core/pet/control.ts, tests/pet-control.test.ts, and this doc are part of the slice | git status / staged file list before commit | covered |
| 2 | Inspect core/pet/control.ts and tests/pet-control.test.ts before changing behavior | Existing snapshot/review patterns reused | N/A (process) | covered |
| 3 | Add compact exported type PetHandoffCapsule in core/pet/control.ts with safe fields only | core/pet/control.ts: added interface + PetHandoffNextAction | direct import and calls in tests/pet-control.test.ts | covered |
| 4 | Add pure exported function createPetHandoffCapsule(snapshot: PetControlSnapshot): PetHandoffCapsule | core/pet/control.ts | All handoff describe tests call it directly | covered |
| 5 | Function reads only safe fields: generatedAt, readiness.status/preparing/blockers.length, run.active/phase, target.locked/stale/label (only for == 'Target missing'), safety.leakIssueCount, review.grade/decision/counts/canFinalize. No raw strings copied. | Reducer destructures and uses only listed safe; no run.label etc assigned | Privacy probe + all count/enum assertions | covered |
| 6 | targetState semantics: 'stale' if target.stale; else 'locked' if target.locked; else 'missing' if readiness.status !== 'ready' or label==='Target missing'; else 'none' | Exact if/else in createPetHandoffCapsule | 'stale/missing target...' test; locked+active test; idle test | covered |
| 7 | reviewState semantics: 'pass'/'iterate'/'fail' per decision; else 'none' | Exact if chain on review.decision | review pass/iterate tests; idle defaults to 'none' | covered |
| 8 | nextAction fixed enum using priority: leak>0 -> open_runtime_doctor; else target missing/stale -> open_target; else phase==='blocked' -> review_blocker; else preparing or status!=ready -> make_ready; else canFinalize -> finalize; else decision==='iterate' or proofDebt>0 or issue>0 -> iterate; else active -> continue_run; else 'idle' | Exact priority ladder in reducer | leak priority test; target priority; blocked test; finalize test; iterate/debt test; continue_run in locked test; idle test | covered |
| 9 | blockerCount = readiness.blockers.length only (not strings) | `const blockerCount = readiness.blockers.length` | blocked test asserts 1; privacy probe asserts 2 | covered |
| 10 | proofDebtCount/issueCount/acceptedEvidenceCount copied from review (already safe) | Direct assign from snapshot.review.* | All review tests assert the counts | covered |
| 11 | grade copied (bounded enum/null) | Direct from review.grade | pass/iterate/idle tests | covered |
| 12 | canFinalize copied from review.canFinalize | Direct | finalize and pass tests assert true; others false | covered |
| 13a | Add focused tests: idle/ready snapshot creates safe idle capsule with defaults | describe('createPetHandoffCapsule') | 'idle/ready snapshot...' it | covered |
| 13b | locked target + active run -> targetState locked + nextAction continue_run | ... | 'locked target + active run...' | covered |
| 13c | stale/missing target priority -> open_target | ... | 'stale/missing target takes priority...' | covered |
| 13d | leak issue priority -> open_runtime_doctor | ... | 'leak issue takes priority...' | covered |
| 13e | review pass canFinalize -> finalize | ... | 'review pass canFinalize...' | covered |
| 13f | review iterate/proof debt -> iterate | ... | 'review iterate/proof debt...' | covered |
| 13g | review fail -> reviewState fail with safe issue count | ... | 'review fail produces...' | covered |
| 13h | blocked run -> review_blocker when no higher override | ... | 'blocked run produces...' | covered |
| 13i | privacy false-positive probe: source has secrets in run.label/readiness.blockers/target.label/other strings; capsule JSON omits while reflecting safe counts/enums | ... | 'privacy false-positive probe...' it + source vs capsule asserts | covered |
| 14 | Create short doc under docs/plan/ with contract coverage table and verification section | docs/plan/pet-handoff-capsule.md | This file | covered |

## Adversarial / Privacy
- Privacy probe constructs base snapshot with secret tokens injected into unsafe string fields (run.label, readiness.blockers, target.label, nextAction).
- Asserts source JSON contains secrets; capsule JSON contains none.
- Also asserts capsule still carries correct safe enums, counts, and computed nextAction.
- False-positive success would fail the `not.toMatch` + `toBe` on counts/decision.

## Verification Commands
- `npm test -- tests/pet-control.test.ts` -> passed, 34/34 tests.
- `npm test -- tests/pet-control.test.ts tests/runtime-doctor.test.ts tests/run-orchestrator.test.ts tests/run-review.test.ts` -> passed, 65/65 tests.
- `npm test -- tests/run-kernel.test.ts tests/run-store.test.ts tests/run-target.test.ts tests/run-target-store.test.ts tests/run-policy.test.ts tests/run-review.test.ts tests/run-orchestrator.test.ts tests/run-iteration.test.ts tests/run-iteration-store.test.ts tests/pet-control.test.ts tests/runtime-doctor.test.ts` -> passed, 119/119 tests.
- `npm run compile` -> passed, `tsc --noEmit` clean.
- `git diff --check` -> passed.

## Notes
- This slice is reducer + tests + docs only. No Chrome, background, content, sidepanel UI, browser APIs, or runtime wiring.
- Excluded: entrypoints/background.ts (never read for edits, never modified, never staged).
- Self-review grade: A. The reducer is pure, compact, directly covered by focused tests, and includes a false-positive privacy probe.
- Adversarial probe for false-positive: result capsule derived purely, counts agree with source snapshot review/readiness lengths, no raw leakage in capsule.

## Contract Coverage Evidence
Each row above maps to >=1 direct expect/toMatchObject in the new describe or existing review privacy logic.
