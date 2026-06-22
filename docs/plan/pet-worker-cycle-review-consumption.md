# Pet Worker Cycle Review Consumption

## Purpose

Expose the latest autonomous worker-cycle review as pet-control metadata without changing orchestration behavior, review heat, next-action priority, Chrome wiring, or runtime surfaces.

## Scope

- `core/pet/control.ts`
- `tests/pet-control.test.ts`
- `docs/plan/pet-worker-cycle-review-consumption.md`
- No Chrome/background/runtime files.

## Contract

`mergeAutonomousWorkerCycleResultIntoSnapshot(snapshot, result)` consumes an `AutonomousRunCycleResult` and projects only safe metadata into `snapshot.workerCycle`:

- cycle action, policy decision, iteration action, final status;
- applied/advanced booleans;
- review grade, decision, score, issue count, proof-debt count, accepted-evidence count;
- allowlisted review error code, or `unknown_worker_cycle_error` for arbitrary strings.

The projection is telemetry only. It does not mutate the completion-review lens, review heat, blocker lens, memory pressure, stop-line state, or handoff next-action decision.

## Contract Coverage Table

| id | required behavior | assertion / location | status |
|----|-------------------|----------------------|--------|
| 1 | Default pet snapshots report no observed worker cycle | `tests/pet-control.test.ts` worker-cycle default test checks `createBasePetSnapshot` and `createPetControlSnapshotFromRunCockpit` | covered |
| 2 | Null/undefined cycle result is a no-op and preserves object identity | `mergeAutonomousWorkerCycleResultIntoSnapshot returns original snapshot object unchanged` | covered |
| 3 | Cycle result projects safe action/status/review aggregates into `workerCycle` | `projects safe review fields without changing review heat or next action inputs` | covered |
| 4 | Missing `reviewSummary` still records action/status metadata with zero review counters | `null reviewSummary still records cycle action/status metadata` | covered |
| 5 | Handoff capsule mirrors worker-cycle metadata from the merged snapshot | `createPetHandoffCapsule projects worker cycle fields that agree with the merged snapshot` | covered |
| 6 | Worker-cycle telemetry does not change `nextAction` priority | `worker cycle metadata does not alter nextAction priority` | covered |
| 7 | Raw run IDs, evidence IDs, messages, transcripts, and arbitrary error strings do not leak | `privacy false-positive probe` with secret-looking source strings | covered |
| 8 | Arbitrary review error code is normalized before pet/handoff projection | same privacy probe asserts `unknown_worker_cycle_error` | covered |
| 9 | Existing memory pressure and handoff defaults remain explicit | idle handoff test includes worker-cycle defaults; memory-pressure tests remain green | covered |
| 10 | Forbidden Chrome/runtime files are untouched | git status/diff review before commit | covered |

## Adversarial Probe

False-positive success probe:

1. Build a source `AutonomousRunCycleResult` containing secret-looking `runId`, top-level `errorCode`, extra summary fields, raw evidence IDs, and transcript text.
2. Merge it into pet state.
3. Generate a handoff capsule.
4. Assert source JSON contains the secret strings.
5. Assert pet JSON and handoff JSON omit every secret string while preserving safe grade/counts.
6. Assert handoff worker-cycle fields equal the merged snapshot fields, proving source result and stored projection agree.

## Verification Commands

- `npm test -- tests/pet-control.test.ts` -> 54/54 pass
- `npm test -- tests/pet-control.test.ts tests/run-worker.test.ts tests/run-orchestrator.test.ts` -> 74/74 pass
- `npm test` -> 605/605 pass
- `npm run compile` -> clean
- `git diff --check` -> clean
- `npm run prompt:freeze` -> fails on pre-existing prompt source/locale hash drift (`promptAugmentationBuild`, `promptLocaleResourcesEn`, `promptLocaleResourcesZhCN`); this slice does not touch prompt files

## Self Review

Contract coverage is complete for this slice. The only raw string copied from worker review is now allowlisted, so arbitrary error-code text cannot leak into pet or handoff output.

Grade: A
