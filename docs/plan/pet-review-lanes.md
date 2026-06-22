# Pet Review Lanes

## Purpose

Expose a compact agent-council signal in the pet cockpit without storing or handing off reviewer transcripts.

This slice lets the pet represent reviewer/worker lanes such as implementer, reviewer, safety, UX, Oracle, and Grok as safe metadata only. It is telemetry, not execution control.

## Scope

- `core/pet/control.ts`
- `tests/pet-control.test.ts`
- `docs/plan/pet-review-lanes.md`
- No Chrome/background/runtime/prompt/locale files.

## Contract

`mergePetReviewLanesIntoSnapshot(snapshot, lanes)` accepts lane inputs and projects only safe fields:

- role
- status
- grade
- recommendation
- highest priority
- issue count
- updated timestamp

It drops raw ids, names, labels, messages, details, transcripts, raw fields, URLs, and secrets. It keeps all sanitized lanes for aggregate and gate derivation, caps handoff lane summaries to four, normalizes invalid strings to safe defaults, clamps issue count to a non-negative integer, and uses `null` for non-finite timestamps.

Review lanes do not change review heat, blocker lens, stop-line state, memory pressure, worker-cycle telemetry, or `nextAction`.

## Contract Coverage Table

| id | required behavior | assertion / location | status |
|----|-------------------|----------------------|--------|
| 1 | Base and cockpit snapshots default to empty review lanes | `tests/pet-control.test.ts` review-lane defaults test | covered |
| 2 | Null/undefined lane input is an identity no-op | `mergePetReviewLanesIntoSnapshot returns original snapshot object unchanged` | covered |
| 3 | Valid lane inputs normalize and aggregate counts | aggregation test checks total, status counts, recommendation counts, highest priority, worst grade, and summaries | covered |
| 4 | Lane aggregation keeps all sanitized lanes for gate derivation | cap/clamp test supplies five lanes and expects all five in snapshot aggregate | covered |
| 5 | Invalid enums and numbers are clamped to safe defaults | cap/clamp test checks invalid role/status/grade/recommendation/priority, NaN, infinity, negative issue count | covered |
| 6 | Handoff review-lane fields agree with snapshot state | handoff agreement test compares every handoff field to `merged.reviewLanes` | covered |
| 7 | Review lane telemetry does not alter `nextAction` | isolation test keeps `finalize` priority despite blocking lane metadata | covered |
| 8 | Review lane telemetry does not mutate adjacent lenses | isolation test checks review, reviewHeat, blockerLens, stopLine, memoryPressure, and workerCycle unchanged | covered |
| 9 | Raw lane ids/messages/details/transcripts do not leak | privacy false-positive probe asserts source JSON contains secrets and pet/handoff JSON omit them | covered |
| 10 | Handoff summaries are capped while gate still sees hidden blocking lanes | hidden fifth-lane test expects `reviewLaneCount=5`, four summaries, and blocked P1 gate | covered |
| 11 | Forbidden files are untouched by the slice | git status/diff before commit | covered |

## Adversarial Probe

False-positive success probe:

1. Build lane input containing secret-looking `laneId`, `name`, `label`, `message`, `details`, `transcript`, and `raw` fields.
2. Assert the source lane JSON contains those strings.
3. Merge lanes into pet state.
4. Generate a handoff capsule.
5. Assert pet JSON and handoff JSON omit every secret string.
6. Assert safe lane aggregate and summary fields remain present and equal between snapshot and handoff.

## Verification Commands

- `npm run compile` -> clean
- `npm test -- tests/pet-control.test.ts` -> 61/61 pass
- `npm test -- tests/pet-control.test.ts tests/run-worker.test.ts tests/run-orchestrator.test.ts` -> 81/81 pass
- `npm test` -> 612/612 pass
- `git diff --check` -> clean
- `npm run prompt:freeze` -> fails on existing `promptAugmentationBuild`, `promptLocaleResourcesEn`, and `promptLocaleResourcesZhCN` hash drift

No prompt files are touched by this slice.

## Self Review

The slice projects reviewer-lane verdicts into bounded, safe metadata. It does not wire Chrome/runtime behavior and does not affect run execution or next-action priority.

Grade: A
