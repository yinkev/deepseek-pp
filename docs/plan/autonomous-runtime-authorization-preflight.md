# Autonomous Runtime Authorization Preflight

## Purpose

This pure-core slice makes the Step 10 stop-line executable before any Chrome/runtime work starts.

The preflight combines two existing source gates:

1. `evaluateAutonomousDocResumptionGate` proves repo-visible docs still contain the current structured runtime-freeze contract.
2. `evaluateAutonomousRuntimeResumeGate` proves explicit durable `chrome_runtime` authorization, checklist completion, runtime-file cleanliness, and independent P1/P2 review posture.

The combined decision is deterministic and side-effect-free. It touches no extension entrypoints, browser state, installed hosts, credentials, package dependencies, or Chrome/runtime behavior.

## Decision Contract

`evaluateAutonomousRuntimeAuthorizationPreflight` returns safe metadata only:

- `status`, `canStartRuntimeSlice`, and source-derived `reason`;
- doc gate status/reason plus missing marker codes and marker counts;
- runtime gate status/reason;
- open P1/P2 counts;
- runtime-file changed flag;
- authorization booleans and authorization scope.

It never exposes raw document text, authorization id, raw review prose, URLs, tokens, prompts, transcripts, or file contents.

## Ordering

The doc-resumption gate is authoritative first.

- If docs are missing, stale, or incomplete, the preflight blocks with the doc gate reason even when runtime inputs look authorized.
- If docs pass but runtime resume blocks, the preflight blocks with the runtime gate reason.
- Only if both gates pass does the preflight authorize Step 10 runtime wiring.

In the repo/default posture, docs pass but runtime resume has no explicit durable `chrome_runtime` authorization, so the preflight blocks with `missing_authorization`.

## Contract Coverage

| Required Behavior | Coverage |
| --- | --- |
| Create deterministic, side-effect-free preflight function. | `tests/run-runtime-authorization-preflight.test.ts` calls the pure function with in-memory inputs only and asserts deterministic decision objects. |
| Input accepts doc-resumption documents and runtime-resume gate input. | Every preflight test passes `documents` and `runtime`; default runtime input is covered by the missing-authorization test. |
| Decision exposes safe metadata only. | Exact-object and privacy assertions cover status, reason, doc/runtime gate metadata, marker counts, P1/P2 counts, runtime changed flag, and authorization booleans/scope. |
| Doc-resumption block wins before trusting runtime resume. | `blocks before trusting runtime resume when doc resumption gate is blocked` passes authorized runtime input with incomplete docs and asserts blocked doc reason. |
| Docs pass plus runtime block blocks with runtime reason. | `blocks with missing_authorization in the default repo posture after docs pass`. |
| Docs pass plus runtime authorization authorizes Step 10. | `authorizes Step 10 only when docs pass and runtime resume gate authorizes`. |
| Stale/missing/incomplete docs fail closed. | `fails closed for no documents`, stale documents, and incomplete documents. |
| Open P1/P2 and runtimeFilesChanged block through runtime resume gate. | `passes open P1/P2 and runtime file changes through the runtime resume gate as blockers`. |
| No raw docs, authorization id, review prose, URLs, tokens, prompts, transcripts, or file contents leak. | Privacy test injects private-like raw fields and asserts serialized decision omits them. |
| False-positive probe: result object agrees with source gate decisions. | `false-positive probe: contradictory gate inputs cannot produce success` asserts doc-blocked/runtime-authorized and docs-passed/runtime-blocked both remain blocked and expose source gate statuses. |
| Use existing source gates; do not duplicate internals. | Implementation imports and delegates to `evaluateAutonomousDocResumptionGate` and `evaluateAutonomousRuntimeResumeGate`; tests exercise source-gate agreement rather than copied marker/checklist logic. |
| Do not touch Chrome/runtime entrypoints. | Verification includes `git diff --name-only HEAD -- entrypoints/background.ts`; this slice changes only pure core/docs/tests. |

## Adversarial Probe

Contradictory injected inputs were tested:

- incomplete doc contract plus fully authorized runtime input;
- complete doc contract plus missing runtime authorization.

Both decisions stayed blocked and the result object exposed the same source gate status that caused the block.

## Verification

Required ladder for this slice:

```sh
npm test -- tests/run-runtime-authorization-preflight.test.ts tests/run-doc-resumption-gate.test.ts tests/run-runtime-resume-gate.test.ts
npm run compile
npm test
git diff --check
git diff --name-only HEAD -- entrypoints/background.ts
```

## Self Review

Grade: A.

Reason: the function is pure, minimal, delegates to both existing gates, preserves source-gate ordering, defaults to blocked without durable runtime authorization, includes adversarial false-positive probes, and exposes only bounded metadata. Final verification passed the focused gate suite, TypeScript compile, full test suite, diff check, and runtime-entrypoint exclusion check.
