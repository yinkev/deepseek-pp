# Pet Memory Pressure Consumption

Pure pet/control consumption of prompt memory pressure metadata.

## Goals
- Carry `PromptAugmentationResult.memoryPressure` through request augmentation.
- Let the pet snapshot and handoff capsule expose safe memory-pressure aggregates.
- Keep memory pressure metadata-only in this slice; it must not change prompt text, tool protocol, run state, next-action priority, Chrome runtime, or `entrypoints/background.ts`.

## Scope
- `core/interceptor/request-augmentation.ts`
- `core/pet/control.ts`
- `tests/request-augmentation.test.ts`
- `tests/pet-control.test.ts`
- `docs/plan/pet-memory-pressure-consumption.md`

## Contract Coverage Table

| id | behavior | assertion / evidence | status |
|----|----------|----------------------|--------|
| 1 | `augmentRequestBody` returns `memoryPressure` for normal prompts | `tests/request-augmentation.test.ts` normal path asserts `memoryPressure.enabled`, `selectedCount`, and `selectedCount === usedMemoryIds.length` | covered |
| 2 | `augmentRequestBody` returns `memoryPressure` for Skill invocation prompts | Skill path test asserts returned pressure exists and agrees with `usedMemoryIds.length` | covered |
| 3 | Request augmentation preserves existing prompt behavior | Existing request augmentation tests still assert prompt scaffolding, Vision routing, research controls, project context, locale text, and `usedMemoryIds` | covered |
| 4 | `PetControlSnapshot` has a default no-pressure state | `createBasePetSnapshot` and `createPetControlSnapshotFromRunCockpit` default test asserts `enabled=false`, `level=none`, zero counts | covered |
| 5 | `mergePromptMemoryPressureIntoSnapshot` is a pure metadata merge | Null/undefined test returns the original object; merge test returns a new snapshot preserving unrelated fields | covered |
| 6 | Pet memory pressure exposes only safe aggregate fields | Merge test asserts level, truncation, selected/available counts, selected token estimate, budget tokens only | covered |
| 7 | Handoff capsule projects compact safe memory-pressure fields | Handoff projection test asserts `memoryPressureEnabled`, `memoryPressureLevel`, `memoryPressureTruncated`, selected/available counts, selected estimate, budget | covered |
| 8 | Memory pressure does not alter `nextAction` priority | Metadata-only priority test compares base `continue_run` with high pressure and expects unchanged `nextAction` | covered |
| 9 | Secret source strings do not leak into pet/handoff pressure output | Privacy false-positive test creates secret-looking source text and asserts capsule JSON omits it while safe numeric fields remain | covered |
| 10 | No Chrome/runtime/background files are part of this slice | `git status` keeps `entrypoints/background.ts` as pre-existing dirty only; staged/commit file list excludes it | covered |
| 11 | Prompt freeze does not gain new failure buckets | `npm run prompt:freeze` remains limited to the known `promptAugmentationBuild` plus pre-existing locale hash drift | covered |

## Adversarial Probe
- Source positive: request augmentation returns `usedMemoryIds` and `memoryPressure` from the same `buildPromptAugmentation` result.
- Result agreement: tests assert `memoryPressure.selectedCount === usedMemoryIds.length` for normal and Skill paths.
- Privacy negative: pet/handoff projection receives only the aggregate pressure object and source-side secret strings are absent from capsule JSON.
- Priority negative: high pressure does not change `nextAction`; this slice is observability only.

## Verification Commands
- `npm test -- tests/request-augmentation.test.ts tests/pet-control.test.ts`
- `npm test`
- `npm run compile`
- `git diff --check`
- `npm run prompt:freeze` (expected fail: `promptAugmentationBuild`, `promptLocaleResourcesEn`, `promptLocaleResourcesZhCN` only)

## Self Review
- Contract coverage maps all requested behaviors to tests.
- No raw memory text, tags, IDs, prompt text, project context, tool schema, target data, or URLs are copied into pet/handoff pressure fields.
- No Chrome/runtime/background file is touched by this slice.
- Grade: A pending final verification and independent review.
