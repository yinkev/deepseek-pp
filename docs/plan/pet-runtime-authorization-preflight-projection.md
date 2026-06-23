# Pet Runtime Authorization Preflight Projection

## Purpose

Expose the pure runtime authorization preflight decision in pet cockpit and handoff metadata without wiring Chrome/runtime.

This slice keeps Step 10 visible as blocked until explicit durable `chrome_runtime` authorization exists. It touches only pet/core/docs/tests and does not touch `entrypoints/background.ts`, browser behavior, installed host state, credentials, package dependencies, or live browser state.

## Contract

`core/run/runtime-authorization-preflight.ts` remains the source of truth for gate evaluation. Pet/control-plane only projects the existing `AutonomousRuntimeAuthorizationPreflightDecision` into safe metadata.

`runtimeAuthorizationPreflight` is read-only informational metadata. It is not an authorization signal for runtime dispatch, readiness, blocker lens, stop-line, next-action selection, or any runtime worker. Consumers must not treat `runtimeAuthorizationPreflightCanStartRuntimeSlice: true` in a pet snapshot or handoff capsule as permission to start runtime work.

Pet snapshot field: `runtimeAuthorizationPreflight`.

Default/no-observation values:

- `status: 'none'`
- `canStartRuntimeSlice: false`
- `reason: null`
- `docGateStatus: null`
- `docGateReason: null`
- `runtimeGateStatus: null`
- `runtimeGateReason: null`
- marker/review counts: `0`
- runtime/authorization booleans: `false`
- `authorizationScope: null`

Merged decision values:

- projected: status, canStartRuntimeSlice, reason, doc gate status/reason, runtime gate status/reason, checked/missing marker counts, open P1/P2 counts, runtimeFilesChanged, authorization booleans, authorizationScope;
- deliberately not projected: raw document text, missing marker arrays, authorization ids, raw review prose, URLs, tokens, prompts, transcripts, file contents, or other source extras.

The handoff capsule flattens the same safe fields with the `runtimeAuthorizationPreflight*` prefix and must exactly agree with the stored pet projection.

Cockpit merges intentionally preserve the last observed `runtimeAuthorizationPreflight` metadata. Cockpit state does not re-evaluate runtime authorization and must not clear or refresh this field implicitly. A stale-looking value is therefore expected after a cockpit-only merge: it means "last observed preflight decision," not "current authorization."

Revocation/recheck must happen by rerunning `evaluateAutonomousRuntimeAuthorizationPreflight` immediately before Step 10 runtime work. The durable runtime resume/preflight gate is the only authority for Step 10; the pet projection is display metadata only.

## Non-Interference

Runtime preflight metadata is informational only. It must not alter:

- `nextAction` priority;
- stop-line state;
- completion review and review heat;
- blocker lens;
- worker cycle;
- scheduler watchdog;
- quality gate;
- review lane gate;
- telemetry;
- memory pressure;
- projection fidelity.

Projection fidelity deliberately excludes `runtimeAuthorizationPreflight` because it is not derived from cockpit state. It is an independent observed gate result merged into the pet snapshot by the runtime authorization preflight path.

## Current Default Posture

Repo-visible docs currently pass the doc-resumption contract, but runtime resume has no explicit durable `chrome_runtime` authorization. Therefore the current default preflight decision is:

- `status: 'blocked'`
- `canStartRuntimeSlice: false`
- `reason: 'missing_authorization'`
- `runtimeGateReason: 'missing_authorization'`

The pet cockpit and handoff capsule can display that Step 10 remains blocked without touching Chrome/runtime.

## Contract Coverage

| Required Behavior | Coverage |
| --- | --- |
| Add pet snapshot field for runtime authorization preflight with safe metadata only. | `tests/pet-control.test.ts` asserts `runtimeAuthorizationPreflight` default and merged fields. |
| Default pet snapshots and handoff capsules report no observed runtime preflight. | `createPetControlSnapshotFromRunCockpit and handoff default to no observed runtime preflight`. |
| Pure merge helper returns same snapshot for null/undefined. | `mergeRuntimeAuthorizationPreflightIntoSnapshot returns original snapshot object unchanged if decision null or undefined`. |
| Project blocked current-default decisions with status blocked, missing_authorization, source statuses/reasons, counts, runtimeFilesChanged, authorization booleans/scope. | `projects default blocked runtime preflight as safe metadata without changing adjacent pet lanes`. |
| Project authorized decisions when both source gates pass. | `projects authorized runtime preflight only when both source gates pass`. |
| Handoff capsule fields agree exactly with merged snapshot fields. | Blocked projection test and false-positive probe compare every/critical handoff field to stored projection; default handoff assertions prove `runtimeAuthorizationPreflightCanStartRuntimeSlice` is never true without an observed preflight. |
| Runtime preflight metadata does not change nextAction or adjacent lenses/gates. | Blocked projection test compares nextAction, stopLine, review, reviewHeat, blockerLens, workerCycle, schedulerWatchdog, qualityGate, reviewLaneGate, telemetry, memoryPressure, projectionFidelity. Authorized projection test proves `canStartRuntimeSlice: true` still does not alter readiness, blockerLens, stopLine, review, reviewHeat, workerCycle, schedulerWatchdog, qualityGate, reviewLaneGate, telemetry, memoryPressure, projectionFidelity, or handoff `nextAction`. |
| Cockpit merges preserve last observed runtime preflight metadata as read-only metadata. | `mergeCockpitProjectionIntoPetSnapshot preserves the last observed runtime preflight as read-only metadata`. |
| Projection fidelity excludes runtimeAuthorizationPreflight because it is not cockpit-derived. | `projection fidelity ignores runtime authorization preflight because it is an independent observed gate result`. |
| No raw document text, missing marker arrays, authorization ids, raw review prose, URLs, tokens, prompts, transcripts, or file contents leak. | False-positive probe injects secret-looking source extras and asserts pet snapshot/handoff JSON omit them. |
| Use existing `AutonomousRuntimeAuthorizationPreflightDecision` type; do not duplicate gate internals. | `core/pet/control.ts` imports the type and projects its fields; no doc/runtime gate evaluation is copied into pet. |
| Do not touch Chrome/runtime entrypoints. | Verification includes `git diff --name-only HEAD -- entrypoints/background.ts`. |

## Adversarial Probe

The pet-control false-positive probe injects secret-looking source extras into a decision object:

- authorization id;
- raw document text with URL/token;
- raw review prose;
- missing-marker arrays;
- prompt/transcript text.

The source JSON contains those strings, while the merged pet snapshot and handoff JSON omit them. Handoff runtime preflight fields agree with the stored pet projection.

## Verification Ladder

```sh
npm test -- tests/pet-control.test.ts tests/run-runtime-authorization-preflight.test.ts
npm run compile
npm test
git diff --check
git diff --name-only HEAD -- entrypoints/background.ts
```

## Self Review

Grade: A pending final verification.

Reason: projection is pure, metadata-only, uses the existing preflight decision type, defaults fail-closed/no-observation, keeps handoff parity, includes a no-leak adversarial probe, and preserves the frozen Chrome/runtime boundary.
