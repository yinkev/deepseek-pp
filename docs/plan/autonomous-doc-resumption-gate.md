# Autonomous Doc Resumption Gate

## Purpose

This post-Step-9 hardening slice makes repo-visible resumption measurable.

A fresh autonomous agent should be able to recover the current control-plane posture from docs alone: Step 10 is blocked, runtime wiring requires explicit durable `chrome_runtime` authorization, `entrypoints/background.ts` is frozen until that authorization exists, and every future implementation slice must keep the Evaluate/Review/Grade/Iterate quality loop.

This is pure autonomous core and documentation work. It does not touch `entrypoints/background.ts`, Chrome/runtime wiring, live browser behavior, or UI runtime dispatch.

## Resumption Contract

```text
autonomous_doc_resumption_contract_v1
contract_status: current
runtime_authorization_required: true
background_file_frozen: true
step_10_blocked: true
contract_coverage_required: true
false_positive_probe_required: true
self_review_grade_required: true
independent_p1p2_review_required: true
verification_ladder_required: true
```

## Contract Coverage

| Requirement | Coverage |
| --- | --- |
| Repo-visible docs contain the resume contract. | `passes when repo-visible docs contain the autonomous resume contract` reads `docs/plan/autonomous-worker-roadmap.md`, `docs/plan/controlled-runtime-resume-gate.md`, and this doc. |
| The gate does not depend on ambiguous prose. | `passes a minimal self-contained structured contract without relying on plan prose`. |
| Stale structured contracts fail closed. | `blocks when the structured contract status is stale`. |
| Keyword-only denial phrasing cannot produce a false pass. | Denial, embedded quote, separate-sentence stale posture, and historical framing tests omit the exact structured markers for the three critical posture requirements and assert those markers remain missing. |
| Missing docs fail closed. | `blocks when no documents are supplied`. |
| Incomplete docs report exact missing markers. | `blocks incomplete docs with exact missing marker codes`. |
| Runtime resume requires explicit durable `chrome_runtime` authorization. | Covered by exact marker line `runtime_authorization_required: true`. |
| `entrypoints/background.ts` remains frozen until resume. | Covered by exact marker line `background_file_frozen: true`. |
| Step 10 remains blocked until authorization. | Covered by exact marker line `step_10_blocked: true`. |
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

Results: focused suite passed 33/33; TypeScript compile passed; full suite passed 872/872; diff check passed; `entrypoints/background.ts` diff was empty.

## Self Review

Grade: A.

Iteration applied before fix-up commit:

- Independent review found a P2: keyword-only marker checks could pass denial phrasing, and the positive repo-doc test did not include this slice's new doc artifact.
- The first implementation used keyword prose checks. Independent review found they could pass denial phrasing and did not prove this new doc artifact was part of the positive path.
- The gate now requires an exact structured contract with `contract_status: current` and exact `marker: true` lines, so denial prose cannot satisfy the machine-readable resumption contract.
- Tests now include this new doc artifact, a minimal self-contained structured contract, stale contract status, and adversarial denial-text probes.

Reason: the slice makes repo-visible resumption measurable without touching runtime files, fails closed when docs are missing, incomplete, stale, or only prose-denial phrased, uses actual docs and a synthetic structured contract as positive paths, keeps gate output to safe marker metadata, and leaves the Chrome/runtime freeze intact.
