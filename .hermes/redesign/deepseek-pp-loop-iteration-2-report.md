# DeepSeek++ Redesign Loop — Iteration 2

## Coverage Summary
Implemented the first source-backed long-loop slice: typed long-loop automation budget + primary Repair & Verify workflow profile. This is deliberately narrower than Oracle's full Run Command Center proposal: it strengthens the engine/profile contract first, because UI promises are worthless if the runner silently stops at the old short-loop budget.

Touched project-local files only:
- `core/automation/types.ts`
- `core/automation/store.ts`
- `core/automation/runner.ts`
- `core/automation/workflow-templates.ts`
- `core/i18n/resources/en.ts`
- `core/i18n/resources/zh-CN.ts`
- `tests/automation-runner-pow.test.ts`
- `tests/automation-workflow-templates.test.ts`

## Features Tested
- Per-run `maxToolContinuationTurns` budget override is honored by the DeepSeek automation runner.
- Default non-long-loop behavior remains at 5 continuation turns.
- New `repo-repair-verify-loop` template creates a manual long-loop payload with:
  - `timeoutMs: 3_600_000`
  - `maxToolContinuationTurns: 25`
  - visual monitor enabled
  - explicit stop gates
  - artifact contract: run-state, proof-ledger, defect-log, verification-matrix, coverage-summary, final handoff
- Template i18n exists in English and Chinese, so the sidepanel template picker does not crash.

## Defects Found
- Missing long-loop budget override path: runner had a hard continuation cap even when the product goal requires sustained autonomous loops.
- Adding the template initially exposed missing i18n keys through sidepanel tests.
- New budget override test initially leaked unused mocked turns into later tests; fixed by using only the turns consumed by the configured budget.

## Defects Fixed
- Added `AutomationPromptOptions.maxToolContinuationTurns`.
- Normalized budget in automation storage with clamp `1..50`.
- Runner now uses per-run budget in `runToolContinuationLoop` and failure details/messages.
- Added primary `Repair & Verify Loop` workflow profile with 60-minute timeout and 25 continuation turns.
- Added English/Chinese template copy.
- Added regression tests for runner budget override and long-loop profile contract.

## Remaining Risks
- Run Command Center UI is still not implemented; automation is still exposed through the existing template/form path.
- Proof ledger/artifact contract is still prompt-level and template-level, not yet persisted as machine artifacts.
- Live Chrome/extension smoke was not run in this iteration.
- Existing repo was dirty before this slice; diff contains unrelated pre-existing changes in adjacent automation files.

## Confidence Score
86%.

Evidence:
- RED failures observed before implementation:
  - `automation-runner-pow.test.ts -t per-run tool continuation budget override` failed with maxDepth 5 instead of 2.
  - `automation-workflow-templates.test.ts -t repair-and-verification long-loop` failed because template was missing.
- GREEN / regression:
  - `npm test -- tests/automation-runner-pow.test.ts tests/automation-workflow-templates.test.ts tests/automation-readiness.test.ts tests/automation-runner-e2e.test.ts` → 40 passed.
  - `npm test -- tests/sidepanel-interactions.test.ts tests/sidepanel-navigation.test.ts` → 32 passed.
  - `npm run verify:automation` → passed.
  - `npm run compile` → passed.
  - `npm run test` → 96 files passed, 782 tests passed.
  - `npm run build` → passed.

Not complete. Exit criteria are not satisfied yet.

Next slice: inspect and implement the smallest Run Command Center v0 UI change that makes the new Repair & Verify long-loop profile the obvious primary automation path without hiding advanced controls.
