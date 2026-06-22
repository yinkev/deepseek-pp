# Grok Review Lane

## Purpose

Add `grok` as a bounded review-lane role in the pure autonomous scheduler and pet bridge. This lets the control plane represent Grok advisory/review workers as safe metadata without wiring CLI spawning, Chrome runtime behavior, network calls, prompts, transcripts, or raw session state into product code.

## Scope

- `core/run/review-scheduler.ts`
- `core/run/orchestrator.ts`
- `core/pet/control.ts`
- `core/pet/orchestrator-bridge.ts`
- scheduler, orchestrator, pet-control, and pet-bridge tests
- review-lane plan docs
- No `entrypoints/background.ts`, Chrome/runtime, prompt-freeze, or live Grok CLI product integration.

## Contract Coverage Table

| id | required behavior | assertion / location | status |
|----|-------------------|----------------------|--------|
| 1 | Scheduler recognizes `grok` as a first-class safe review-lane role | `dispatches grok only when requested and capacity remains` | covered |
| 2 | Grok dispatch requires an explicit `grokRequested` flag and capacity | same scheduler test checks false request, true request, and occupied Grok lane cases | covered |
| 3 | Existing maxParallel cap still limits selected roles when Grok is also requested | `caps role selection by maxParallel` includes `grokRequested: true` while expecting only the first two roles | covered |
| 4 | Orchestrator forwards `grokRequested` into the planner and worker result remains durable/source-of-truth | `returns grok review lane dispatch when requested and earlier lanes are complete` asserts `selectedRoles: ['grok']`, executor call, and no run id/goal in the plan JSON | covered |
| 5 | Pet review-lane normalization preserves `grok` as safe metadata and drops raw prompts/sessions/transcripts | `mergePetReviewLanesIntoSnapshot preserves grok advisor lanes as safe metadata only` | covered |
| 6 | Pet-to-orchestrator bridge projects `grokRequested` as a boolean and keeps lane output sanitized | `projects sanitized pet review lanes, worker pulse, risk, and advisor requests` | covered |
| 7 | Blocking gate derivation still scans hidden lanes beyond the four-lane scheduler cap, including Grok lanes | `derives blocking gate from lanes beyond scheduler output cap` uses a fifth Grok lane with P1 | covered |
| 8 | Planner/pet output does not leak raw role text, prompts, transcripts, sessions, URLs, or command-like fields | existing privacy probes plus Grok lane safe-metadata test | covered |

## Mechanism

`grok` joins the review-lane role enum in `core/run` and the pet review-lane role enum. The scheduler accepts a boolean `grokRequested`; when the run is runnable, gates do not halt, capacity remains, and no Grok lane is already occupied, it can select `grok` after implementer, reviewer, safety, UX, and Oracle.

The pet bridge forwards `grokRequested` as a boolean only. It does not create prompts, execute Grok, store Grok sessions, or copy any worker transcript into pet/orchestrator state.

## Adversarial Probe

The false-positive success probe is the orchestrator test: a requested Grok lane produces `reviewLanePlan.selectedRoles = ['grok']`, the worker still executes, and the plan JSON omits the run id and goal. That proves the selected role is advisory metadata, not a fabricated durable completion state.

The privacy probe injects raw Grok prompt/session/transcript strings into a pet review lane. The merged pet snapshot and handoff capsule must contain only the safe enum/count/time fields.

## Verification

Run:

```sh
npm test -- tests/run-review-scheduler.test.ts tests/run-orchestrator.test.ts tests/pet-control.test.ts tests/pet-orchestrator-bridge.test.ts
npm run compile
git diff --check
```

`npm run prompt:freeze` remains expected to fail on pre-existing prompt hash drift until the dedicated prompt snapshot reconciliation slice.

## Self Review

Grade target: A. This slice is a pure metadata contract and does not claim live Grok worker spawning.
