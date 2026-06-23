# Autonomous Contract Coverage Automation

## Purpose

Step 7 makes contract coverage a durable quality-gate artifact, not just a prompt/report convention.

Every quality gate now stores bounded coverage rows, false-positive probe status, result-state consistency, verification summary, self-review grade, commit summary, and independent review summary. Missing coverage rows, conflicts, failed false-positive probes, state mismatches, failed verification, or independent review blockers prevent advancement.

This is pure autonomous core and pet metadata work. It does not touch `entrypoints/background.ts`, Chrome/runtime wiring, live browser behavior, or UI runtime dispatch.

## Contract Coverage

| Requirement | Coverage |
| --- | --- |
| Quality gates store first-class coverage rows. | `core/run/types.ts` adds `contractCoverage.rows`; `tests/run-quality-gate-store.test.ts` asserts rows persist and returned state equals durable retrieval. |
| Coverage counts cannot contradict rows. | `normalizeQualityGateContractCoverage` derives counts from rows; `derives durable coverage counts from first-class rows instead of caller aggregates` proves caller aggregate lies are ignored. |
| Missing coverage rows block advancement. | Store test `fails overall passed gates when coverage rows are missing` and orchestrator test `blocks advancement when first-class contract coverage rows are missing`. |
| Contract conflicts block advancement. | Existing orchestrator conflict probes now use row-backed summaries and still block worker execution. |
| False-positive probe status is stored and failed probes block. | `falsePositiveProbe` is stored on quality gates; store and orchestrator tests prove failed probes normalize to failed gates and prevent worker execution. |
| Result object and durable stored state agree. | Quality-gate store tests compare append results with `getAutonomousRunQualityGates(run.id)[0]` after row/probe normalization. |
| Telemetry and pet handoff expose only safe aggregate metadata. | `core/run/telemetry.ts` exports row count/probe status; `core/pet/control.ts` projects row count/probe status into safe pet and handoff fields; privacy tests reject raw IDs/secrets. |
| Worker prompts carry the required loop and coverage gate. | `core/run/worker-prompt.ts` and `tests/run-worker-prompt.test.ts` require literal `Evaluate, Review, Grade, Iterate` and `Contract coverage gate` text. |
| Runtime/background freeze remains intact. | Verification includes `git diff --name-only HEAD -- entrypoints/background.ts`; this slice changes no Chrome/runtime files. |

## Verification

Passed:

```sh
npm test -- tests/run-quality-gate-store.test.ts tests/run-orchestrator.test.ts tests/run-telemetry.test.ts tests/pet-control.test.ts tests/pet-orchestrator-bridge.test.ts tests/run-result-consistency.test.ts tests/run-worker-prompt.test.ts
npm run compile
npm test -- tests/run-contract-coverage.test.ts tests/run-result-consistency.test.ts tests/run-quality-gate-store.test.ts tests/run-orchestrator.test.ts
npm test
git diff --check
git diff --name-only HEAD -- entrypoints/background.ts
```

Results: focused Step 7 suite passed 207/207; declared Step 7 suite passed 82/82; full suite passed 849/849; TypeScript compile passed; diff check passed; `entrypoints/background.ts` diff was empty.

## Self Review

Grade: A.

Iteration applied before commit:

- Focused tests initially failed because `appendAutonomousQualityGateRecord` did not pass explicit `falsePositiveProbe` input into the normalizer.
- The store path was fixed and the same focused suite passed.

Reason: the durable gate record now contains the required first-class coverage/probe state, unsafe or contradictory inputs fail closed, pet/telemetry exports expose safe aggregates only, and the worker prompt contract carries the required quality gate language.
