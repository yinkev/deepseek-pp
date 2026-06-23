# Pet Projection Fidelity Audit

## Contract

The pet cockpit is now measured against the durable autonomous cockpit state that produced it.

`PetControlSnapshot.projectionFidelity` and the handoff capsule expose only safe metadata:

- `status`: `unchecked`, `passed`, or `drifted`;
- `score`: bounded 0..1 projection score;
- `driftCount`: number of contradictory projection fields;
- `gateImpact`: whether drift could mislead worker gating or operator action;
- `source`: `none`, `cockpit`, or `orchestrator_cycle`;
- `checkedAt`: cockpit timestamp;
- `driftKeys`: bounded enum keys.

No raw run IDs, target labels, prompts, URLs, evidence text, provider IDs, command text, transcripts, or secrets are emitted by the fidelity object or handoff fields.

## Mechanism

`createPetControlSnapshotFromRunCockpit` builds the existing safe pet snapshot and attaches a fidelity audit against the same `AutonomousRunCockpitSnapshot`.

`auditPetProjectionFidelity(snapshot, cockpit, source)` compares stable scalar and aggregate fields:

- generated timestamp;
- readiness status and preparing flag;
- run activity, phase, and next action;
- run queue counts and posture;
- target lease status, age, expiry, locked/stale flags;
- evidence status, counts, latest timestamp, and age;
- stop-line action/reason/status;
- handoff next action.

`mergeAutonomousOrchestratorCycleResultIntoSnapshot` refreshes cockpit-derived fields from the cycle `afterSnapshot` before applying worker, telemetry, quality-gate, and review-lane overlays. This prevents a stale or forged pet snapshot from surviving when fresh durable state is available.

## Contract Coverage

| Required Behavior | Coverage |
| --- | --- |
| Clean cockpit-derived projection passes with score 1 and no drift. | `marks clean cockpit-derived pet projection as fidelity passed and mirrors it in handoff` |
| Handoff fidelity fields agree with snapshot fidelity fields. | `marks clean cockpit-derived pet projection as fidelity passed and mirrors it in handoff`; `fails forged projection fidelity and prevents fake pass from reaching handoff` |
| Forged projection drift fails with drift count, score below 1, drift keys, and gate impact. | `fails forged projection fidelity and prevents fake pass from reaching handoff` |
| False-positive success is blocked when a forged snapshot claims fidelity pass. | `fails forged projection fidelity and prevents fake pass from reaching handoff` |
| Orchestrator bridge refreshes stale/forged cockpit fields from fresh `afterSnapshot`. | `refreshes forged cockpit projection fields from orchestrator afterSnapshot` |
| Fidelity output remains safe metadata only. | `marks clean cockpit-derived pet projection as fidelity passed and mirrors it in handoff`; `fails forged projection fidelity and prevents fake pass from reaching handoff`; `refreshes forged cockpit projection fields from orchestrator afterSnapshot` |
| Existing pet behavior remains stable except for new fidelity fields. | Existing pet-control and pet-orchestrator-bridge suites plus full test suite. |
| `entrypoints/background.ts` remains untouched. | `git diff --name-only HEAD -- entrypoints/background.ts` |

## Adversarial Probe

The false-positive probe starts with a legitimate running cockpit, then forges the pet snapshot to look idle, target-stale, evidence-empty, and stop-line unavailable while also embedding a fake `projectionFidelity.status = passed`.

Expected result:

- `attachPetProjectionFidelity` replaces the fake pass with `status = drifted`;
- `score < 1`;
- `driftCount > 0`;
- `gateImpact = true`;
- handoff fidelity fields match the audited snapshot;
- raw forged strings and durable IDs do not appear in fidelity or handoff output.

## Scope

This slice is pure pet/control-plane work. It does not invoke workers, mutate Chrome/runtime files, write local telemetry packages, or touch `entrypoints/background.ts`.

## Verification

Run:

```sh
npm test -- tests/pet-control.test.ts tests/pet-orchestrator-bridge.test.ts tests/run-telemetry.test.ts
npm run compile
npm test
git diff --check
git diff --name-only HEAD -- entrypoints/background.ts
```

## Self Review

Grade target: A.

Reasons:

- the auditor compares only safe aggregate fields that already exist in pet/cockpit projections;
- forged fidelity metadata is normalized through the audit before handoff;
- bridge refresh makes fresh durable state authoritative over stale pet fields;
- the tests include clean, forged, and bridge-refresh paths plus privacy assertions.
