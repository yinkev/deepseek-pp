# Controlled Runtime Resume Gate

## Purpose

Step 9 makes the Chrome/runtime freeze an explicit pure guard instead of an informal instruction.

Runtime wiring remains blocked unless a durable, explicit user authorization exists for `chrome_runtime`, the resume checklist is complete, no runtime files were already changed ahead of the authorized slice, and independent review has no open P1/P2 findings.

This slice does not touch `entrypoints/background.ts`, Chrome/runtime wiring, live browser behavior, or UI runtime dispatch.

## Resume Checklist

A runtime resume slice must document all of these before Step 10 starts:

- exact build/test commands;
- runtime smoke procedure;
- Chrome safety checks;
- manual authorization record;
- rollback path;
- independent P1/P2 review requirement.

## Contract Coverage

| Requirement | Coverage |
| --- | --- |
| Missing authorization blocks runtime resume. | `blocks by default without explicit durable user authorization` in `tests/run-runtime-resume-gate.test.ts`. |
| Authorization must be explicit and durable. | Invalid-authorization table tests cover missing explicit flag, missing id, and missing timestamp. |
| Authorization must be for Chrome runtime and unexpired. | Scope mismatch and expiry tests block resume. |
| Runtime files cannot change before authorization. | `blocks when runtime files changed before the authorized resume slice`. |
| Checklist must be complete. | `blocks incomplete resume checklist even with authorization`. |
| Independent review evidence must exist and pass. | `blocks when independent review evidence is missing`. |
| Open P1/P2 review blocks resume. | `blocks unresolved independent P1/P2 review findings`. |
| Gate output is safe metadata only. | Privacy test injects arbitrary raw authorization/review fields and asserts they do not leak into the decision. |
| Runtime/background remain frozen. | Verification includes `git diff --name-only HEAD -- entrypoints/background.ts`; this slice changes no Chrome/runtime files. |

## Verification

Passed:

```sh
npm test -- tests/run-runtime-resume-gate.test.ts tests/run-orchestrator.test.ts tests/pet-control.test.ts
npm run compile
npm test
git diff --check
git diff --name-only HEAD -- entrypoints/background.ts
```

- Focused suite: 151/151 tests passed.
- Compile: `tsc --noEmit` clean.
- Full suite: 862/862 tests passed.
- Diff check: no whitespace errors.
- Runtime freeze check: no `entrypoints/background.ts` diff.

## Self Review

Grade: A.

Reason: the guard defaults to blocked, requires explicit durable authorization plus the full checklist, rejects stale/mismatched/ambiguous authorization, blocks unresolved P1/P2 findings, and exposes only compact safe metadata.
