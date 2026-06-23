# Autonomous Doc Resumption Gate

## Purpose

This post-Step-9 hardening slice makes repo-visible resumption measurable.

A fresh autonomous agent should be able to recover the current control-plane posture from docs alone: Step 10 is blocked, runtime wiring requires explicit durable `chrome_runtime` authorization, `entrypoints/background.ts` is frozen until that authorization exists, and every future implementation slice must keep the Evaluate/Review/Grade/Iterate quality loop.

This is pure autonomous core and documentation work. It does not touch `entrypoints/background.ts`, Chrome/runtime wiring, live browser behavior, or UI runtime dispatch.

## Contract Coverage

| Requirement | Coverage |
| --- | --- |
| Repo-visible docs contain the resume contract. | `passes when repo-visible docs contain the autonomous resume contract` reads `docs/plan/autonomous-worker-roadmap.md` and `docs/plan/controlled-runtime-resume-gate.md`. |
| Missing docs fail closed. | `blocks when no documents are supplied`. |
| Incomplete docs report exact missing markers. | `blocks incomplete docs with exact missing marker codes`. |
| Runtime resume requires explicit durable `chrome_runtime` authorization. | Covered by `runtime_authorization_required`. |
| `entrypoints/background.ts` remains frozen until resume. | Covered by `background_file_frozen`. |
| Step 10 remains blocked until authorization. | Covered by `step_10_blocked`. |
| Future slices require contract coverage, false-positive probe, self-grade, and independent P1/P2 review. | Covered by marker codes for coverage, false-positive probe, grade, and independent review. |
| Verification ladder remains visible in docs. | Covered by `verification_ladder_required`. |
| Gate output is safe metadata only. | Privacy probe injects raw secret-like document text and asserts the decision exposes only marker codes and counts. |
| Result object and durable stored state agree. | Not testable in this slice: the doc-resumption gate is a pure non-mutating evaluator and writes no durable state. The false-positive probe reads the actual repo docs and asserts the returned result object exposes the complete marker set without leaking raw document text. |

## Verification

Passed:

```sh
npm test -- tests/run-doc-resumption-gate.test.ts tests/run-runtime-resume-gate.test.ts tests/run-contract-coverage.test.ts
npm run compile
npm test
git diff --check
git diff --name-only HEAD -- entrypoints/background.ts
```

Results: focused suite passed 27/27; TypeScript compile passed; full suite passed 866/866; diff check passed; `entrypoints/background.ts` diff was empty.

## Self Review

Grade: A.

Reason: the slice makes repo-visible resumption measurable without touching runtime files, fails closed when docs are missing or incomplete, uses actual docs as the positive path, keeps gate output to safe marker metadata, and leaves the Chrome/runtime freeze intact.
