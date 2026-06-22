# Pet Orchestrator Review Lane Plan Projection

## Purpose

Project the pure orchestrator's safe `reviewLanePlan` into the pet snapshot and handoff capsule. This lets the control panel show that persisted review-lane blockers halted the worker even when no raw lane summaries are available.

This slice is pure `core/pet` bridge logic, tests, and docs. It does not dispatch review workers, spawn Grok or Oracle, touch Chrome/runtime files, mutate prompt contracts, or change browser/background wiring.

## Contract Coverage Table

| id | required behavior | assertion / location | status |
|----|-------------------|----------------------|--------|
| 1 | Orchestrator cycle result projects a blocking review-lane plan into pet snapshot fields | `projects blocking orchestrator review lane plans into pet snapshot and handoff fields` | covered |
| 2 | Handoff capsule review-lane gate fields agree with the projected pet snapshot | same blocking-plan test compares capsule gate fields to `merged.reviewLaneGate` | covered |
| 3 | Dispatch plans project selected advisor roles as safe running lane summaries | `projects dispatch review lane plans as safe running lane summaries` | covered |
| 4 | Raw or malformed plan fields do not leak into pet snapshot or capsule | `keeps raw and malformed orchestrator review lane plan fields out of pet projection` | covered |
| 5 | Projection remains bounded for forged blocking counts | malformed-plan test uses non-finite count and expects one safe blocker; implementation caps projected counts at the store bound | covered |
| 6 | Idle plans clear stale projected review-lane state | `clears stale projected review lanes when the orchestrator has no pending lane plan` | covered |
| 7 | No Chrome/background/runtime/prompt files are touched | staged file list and `git diff --check`; prompt freeze may still show known pre-existing hash drift only | process check; not unit-testable in this slice |

## Mechanism

`mergeAutonomousOrchestratorCycleResultIntoSnapshot` now also consumes `result.reviewLanePlan`.

- `halt` plans become synthetic safe blocked lane summaries, bounded to the review-lane store cap.
- `dispatch` plans become safe running lane summaries for selected roles.
- idle/hold plans clear the projected review-lane lane list.

The projection carries only role, status, grade, recommendation, priority, issue count, and timestamp fields that already exist in pet review-lane summaries. It does not copy run ids, lane ids, goals, summaries, prompts, transcripts, URLs, tokens, raw reviewer text, or arbitrary plan fields.

## Adversarial Probe

The false-positive projection probe builds a cycle result with:

- selected run id;
- worker run id;
- a halting P2 review-lane plan.

The merged pet snapshot and handoff capsule must show a blocked P2 review-lane gate, while omitting both raw run ids. A separate malformed-plan probe injects raw prompt, transcript, URL, token, unknown priority, and non-finite count; the projection must keep only one sanitized blocked lane.

## Verification

Run:

```sh
npm test -- tests/pet-orchestrator-bridge.test.ts tests/pet-control.test.ts tests/run-orchestrator.test.ts
npm run compile
git diff --check
```

`npm run prompt:freeze` remains expected to fail on pre-existing prompt hash drift until the dedicated prompt snapshot reconciliation slice.

## Self Review

Grade target: A. This is a safe projection of existing pure orchestrator metadata into the pet control plane; it does not claim live advisor dispatch or runtime wiring.
