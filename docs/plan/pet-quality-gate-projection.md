# Pet Quality Gate Projection

## Purpose

Expose autonomous quality-gate decisions in the pet snapshot and handoff capsule as safe metadata. This closes the visibility gap after orchestrator quality-gate enforcement: a run can be held by a failed gate without mutating durable run status, and the pet must explain that hold without leaking raw review or command content.

## Scope

- `core/pet/control.ts`
- `tests/pet-control.test.ts`
- `docs/plan/pet-quality-gate-projection.md`
- No Chrome, background, runtime, prompt, or browser-control files.

## Contract Coverage Table

| id | required behavior | assertion / location | status |
|----|-------------------|----------------------|--------|
| 1 | Default pet snapshots report no quality gate observed | `createPetControlSnapshotFromRunCockpit and createBase default to no quality gate observed` | covered |
| 2 | Null or undefined gate decision is a no-op and preserves snapshot identity | `mergeAutonomousQualityGateDecisionIntoSnapshot returns original snapshot object unchanged` | covered |
| 3 | Blocked quality gates project safe status, reason, latest status, sequence, coverage counts, grade, and verification result | `projects blocked quality gates into safe pet and handoff metadata` | covered |
| 4 | Blocked quality gates appear in the blocker lens as review blockers | same blocked projection test asserts `blockerLens.primary = review` | covered |
| 5 | Handoff capsule fields agree with the merged pet snapshot | same blocked projection test compares every handoff quality-gate field | covered |
| 6 | Blocked quality gates change handoff `nextAction` to `review_blocker` behind leak/target priority | same blocked projection test, with target locked and no leaks | covered |
| 7 | Warning and clear gates are informational and do not alter `nextAction` | `warning and clear quality gates are informational and do not alter nextAction priority` | covered |
| 8 | No-gate decisions and malformed numeric fields normalize to bounded safe metadata | `normalizes no-gate decisions and malformed numeric fields to safe metadata` | covered |
| 9 | Raw gate ids, commands, reviewer prose, URLs, and secrets never reach pet or handoff JSON | quality-gate privacy false-positive probe | covered |

## Mechanism

`mergeAutonomousQualityGateDecisionIntoSnapshot(snapshot, decision)` accepts the safe aggregate `AutonomousRunQualityGateDecision` returned by the orchestrator. It stores only enums, booleans, nullable sequence/count fields, and grade metadata under `snapshot.qualityGate`.

Blocked gates recompute the existing blocker lens with a review blocker and make the handoff capsule choose `review_blocker` when no higher-priority leak or target issue is present. Warning, clear, and no-gate states remain informational.

## Privacy

The projection does not carry gate ids, run ids, command names, command summaries, commit messages, reviewer prose, evidence ids, URLs, tokens, or raw issue text. The privacy probe includes those strings as source-only extra fields and verifies they are absent from pet and handoff JSON.

## Verification

Run:

```sh
npm test -- tests/pet-control.test.ts
npm test -- tests/pet-control.test.ts tests/run-orchestrator.test.ts tests/run-result-consistency.test.ts
npm run compile
git diff --check
```

`npm run prompt:freeze` is expected to keep failing on pre-existing prompt hash drift until the dedicated prompt snapshot reconciliation slice.

## Self Review

Grade target: A. This slice is pure pet projection. It does not change orchestrator enforcement, durable storage, Chrome runtime wiring, prompt generation, or browser behavior.
