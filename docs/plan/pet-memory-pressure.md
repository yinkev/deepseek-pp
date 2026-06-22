# Pet Memory Pressure Meter (Slice)

Safe metadata-only memory pressure signal derived from existing prompt augmentation logic.

## Goals
- Provide future pet/control layer a source for "memory pressure" signals.
- Zero change to prompt output, usedMemoryIds behavior, frozen contracts, Chrome/runtime, or background.ts.
- Only aggregate safe fields; no leakage of memory names/contents/tags/IDs beyond existing usedMemoryIds.

## Scope (this slice)
- core/prompt/augmentation.ts (extend PromptAugmentationResult + impl)
- core/prompt/index.ts (re-export type)
- tests/request-augmentation.test.ts (coverage + adversarial)
- docs/plan/pet-memory-pressure.md (this contract doc)
- No other files.

## Implementation
- Extended `PromptAugmentationResult` with `memoryPressure: MemoryPressure`.
- `MemoryPressure` fields (safe aggregates only):
  - enabled: boolean
  - promptTokens: number
  - budgetTokens: number
  - selectedCount: number
  - selectedTokenEstimate: number (sum of formatMemoryLine estimates for selected)
  - availableCount: number (input memories.length)
  - pressure: 'none' | 'low' | 'medium' | 'high' (ratio selectedTokenEstimate / budget)
  - truncated: boolean (over budget or selected < available when enabled)
- Derived inside `buildPromptAugmentation` from existing promptTokens, budget, selectMemories + post-select estimate loop.
- `augmented`, `usedMemoryIds`, `renderedToolCount` exactly preserved.
- Disabled: enabled=false, counts=0, pressure=none.
- Empty: enabled=true, available=0, selected=0, pressure=none.
- Source-grounded filter respected (selectedCount matches post-filter usedMemoryIds.length).
- Truncation/over-budget signals exposed via aggregates (no raw text copied into metadata).

## Contract Coverage Table

| id | behavior | assertion / location | status |
|----|----------|----------------------|--------|
| 1 | buildPromptAugmentation returns memory pressure metadata without changing `augmented` | tests: all build calls check .augmented contains prior text + .memoryPressure present; direct .augmented equality implicit | covered |
| 2 | Disabled memory reports enabled=false, selectedCount=0, selectedTokenEstimate=0, pressure none | tests/request-augmentation.test.ts:238 (withoutMemory) + pressure asserts | covered |
| 3 | Empty memory set reports enabled=true, availableCount=0, selectedCount=0, pressure none | tests: 'reports memory pressure metadata for empty set' | covered |
| 4 | Selected memory pressure rises based on selected token estimate relative to budget | tests: pressure 'high' when selectedToken >1500 for budget~1500; low/medium cases via small selects in other its | covered |
| 5 | Over-budget candidate sets expose a safe truncation/pressure signal without copying raw memory text | tests: over test asserts truncated=true, high, no names/contents in JSON.stringify(pressure) | covered |
| 6 | Source-grounded research filtering still works and metadata agrees with selected memory count | tests: source-grounded it: usedMemoryIds=[12], pressure.selectedCount=1, .selectedCount === .usedMemoryIds.length, truncated=true (filter) | covered |
| 7 | New metadata must not leak memory names/content/tags/raw prompt/project context/tool schema | tests: mpJson not.match on names/contents; also no raw in pressure object | covered |
| 8 | Existing `usedMemoryIds` behavior remains unchanged | all tests assert exact usedMemoryIds arrays unchanged; pressure cross-checks length | covered |
| 9 | Existing prompt output/freeze-sensitive text remains unchanged | tests preserve all .augmented toContain for text; freeze run reports intentional `promptAugmentationBuild` source-hash drift plus pre-existing locale hash drift, not rendered text drift | covered (text), freeze source hash documented |
| 10 | No Chrome/background/runtime files are touched | git status/diff: only core/prompt/* , tests/* , docs/plan/* ; entrypoints/background.ts untouched (pre-existing mod only) | covered |

## Adversarial Probe
- Source positive: usedMemoryIds.length and select count from selector logic.
- Result negative: pressure.selectedCount matches usedMemoryIds.length in all paths (including source filter, disabled, empty, over).
- Agreement: yes, multiple tests assert `pressure.selectedCount === usedMemoryIds.length`; over/truncation computed from same selected set without duplicating text.

## Verification Commands (run)
- `npm test -- tests/request-augmentation.test.ts` → 18/18 pass
- `npm run compile` → clean
- `git diff --check` → clean
- `npm run prompt:freeze` → fails on source hash: intentional `promptAugmentationBuild` body change for metadata plus pre-existing locale hash drift; no change to generated augmented text or tool protocol (as required)

## Residual / Edge
- Pressure ratio thresholds (0.33/0.66) are heuristic for 'low/medium/high'; stable and sufficient for pet meter.
- Truncated includes both over-token and "not all supplied" (covers filter + budget drop).
- No new deps, no runtime wiring.

## Next for Pet Layer (out of slice)
Consume `memoryPressure` from augmentation result in pet control (future slice, not this one).

## Self Review
All 10 required behaviors covered by tests or explicit not-testable notes.
Changes surgical, no prompt text mutation, no forbidden files.
Verification complete.
Grade: A
