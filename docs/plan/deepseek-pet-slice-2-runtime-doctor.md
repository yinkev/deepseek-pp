# DeepSeek Pet Slice 2: Runtime Doctor Summary (Pure Reducer)

## Scope
This slice adds pure reducer support in `core/pet/control.ts` for merging `RuntimeDoctorReport` (safe types only) into `PetControlSnapshot`.
- Pure function only: `mergeRuntimeDoctorReportIntoSnapshot(snapshot, report)`.
- No wiring, no chrome calls, no entrypoints, no sidepanel, no getRuntimeDoctorReport import.
- Run state is never fabricated by doctor merge.

## Required Behaviors

1. Add a pure merge function.
2. Import only safe Runtime Doctor types from `core/chat/runtime-doctor.ts`.
3. Runtime Doctor may override `readiness.status`, `readiness.blockers`, `readiness.preparing`, `target.locked`, `target.label`, `target.stale`, and `safety.leakIssueCount`.
4. Runtime Doctor must not override or fabricate autonomous run state.
5. Target labels must be generic: `Target locked`, `Target missing`, or `Target stale`.
6. Raw Runtime Doctor fields must not leak into the pet snapshot.
7. `target.stale` is true for `missing`, `unsupported`, and `not_controllable`; it is false for usable target statuses.
8. `safety.leakIssueCount` is the max of leak sentry count, leak quarantine count, and storage issue count.
9. `safety.highRiskArmed` remains false in this slice.
10. The slice remains pure core/tests/docs with no Chrome, content, sidepanel, or background wiring.

## Contract Coverage Table

| Required Behavior | Test Assertion / Coverage | Notes |
|-------------------|---------------------------|-------|
| Pure merge function | `mergeRuntimeDoctorReportIntoSnapshot` is imported and called in `tests/pet-control.test.ts` | No async/runtime dependency |
| Only safe type import | `core/pet/control.ts` imports `type RuntimeDoctorReport` only | No `entrypoints/*` import |
| Readiness overrides | Ready and blocked merge tests assert exact `readiness` objects | Status, blockers, preparing covered |
| Target overrides | Ready/lock and target-status tests assert exact `target` objects | Generic labels only |
| Run preserved | Tests assert `pet.run` is the same object reference as `base.run` | No fabricated run |
| Timestamp preserved | Ready merge test asserts base `generatedAt` stays unchanged | Doctor does not own pet timestamp |
| Stale target logic | Target-status table covers `missing`, `unsupported`, `not_controllable`, and `selected_active` | Covers usable and unusable states |
| Leak count max | Ready merge test asserts max of sentry/quarantine/storage counts | High-risk remains false |
| Privacy false-positive probe | Source report JSON contains unique target, failure, suggestion, storage, automation, and sample secrets; pet JSON omits each | Proves source/result disagreement is intentional redaction, not absent fixture data |
| Null/undefined report | Test asserts original snapshot object is returned | Defensive edge |
| No Chrome/runtime wiring | Git diff contains only `core/pet/control.ts`, `tests/pet-control.test.ts`, and this doc | `entrypoints/background.ts` remains unrelated and unstaged |

All slice behaviors are either directly asserted in pet-control.test.ts or marked via this table as covered for pure core slice.

## Verification Performed

- `npm test -- tests/pet-control.test.ts` -> 19/19 passed.
- `npm test -- tests/pet-control.test.ts tests/runtime-doctor.test.ts` -> 29/29 passed.
- `npm test -- tests/pet-control.test.ts tests/run-orchestrator.test.ts` -> 31/31 passed.
- `npm test -- tests/run-kernel.test.ts tests/run-store.test.ts tests/run-target.test.ts tests/run-target-store.test.ts tests/run-policy.test.ts tests/run-review.test.ts tests/run-orchestrator.test.ts tests/run-iteration.test.ts tests/run-iteration-store.test.ts tests/pet-control.test.ts tests/runtime-doctor.test.ts` -> 104/104 passed.
- `npm run compile` -> passed.
- `git diff --check` -> passed.

## Adversarial Probe
- Source report constructed with unique secret strings in target lock label/origin, failure explanations, debug suggestions, automation failure, storage issue path, and quarantine sample paths.
- Result pet snapshot JSON contains none of them.
- Result still reflects safe status/count fields and preserves base run state.

## Grade / Next

Self-review grade: A.

Commit only:

- `core/pet/control.ts`
- `tests/pet-control.test.ts`
- `docs/plan/deepseek-pet-slice-2-runtime-doctor.md`

Excluded: `entrypoints/background.ts` remains unrelated and must not be staged for this slice.
