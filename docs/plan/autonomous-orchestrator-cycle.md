# Autonomous Orchestrator Cycle

## Contract

`executeAutonomousOrchestratorCycle` advances at most one autonomous run per call. It is a non-Chrome coordination seam over existing durable run primitives:

- Reconcile interrupted running runs first using `reconcileInterruptedAutonomousRuns`.
- Build a `beforeSnapshot` from the cockpit snapshot contract after reconciliation and before worker execution.
- Select exactly one runnable run from the normalized ledger:
  - newest `running` run by `updatedAt`;
  - otherwise newest `queued` run by `updatedAt`;
  - never select `paused`, `blocked`, `succeeded`, `failed`, or `cancelled`.
- If no runnable run exists, return `selectedRunId=null` and `workerResult=null`.
- If a run is selected, call `executeAutonomousRunCycle` once with the injected executor.
- Build an `afterSnapshot` from the cockpit snapshot contract after worker execution.

## Return Shape

```ts
interface AutonomousRunOrchestratorCycleResult {
  selectedRunId: AutonomousRunId | null;
  reconciledInterruptedRuns: number;
  beforeSnapshot: AutonomousRunCockpitSnapshot;
  workerResult: AutonomousRunCycleResult | null;
  afterSnapshot: AutonomousRunCockpitSnapshot;
}
```

Snapshots intentionally expose only the cockpit snapshot fields. Raw evidence refs, evidence summaries, evidence metadata, model text, browser payloads, and secrets stay out of the orchestrator result.

## Out Of Scope

- Chrome alarms, service-worker timers, message handlers, and runtime entrypoints.
- Browser UI, target mutation, model calls, shell execution, or real tool adapters.
- Changes to worker policy, budget normalization, iteration review, or proof semantics.

## Verification

Tests prove:

- newest queued run selection and worker-cycle delegation;
- running runs are prioritized over newer queued runs;
- stale running runs are reconciled before queued fallback selection;
- paused, blocked, and terminal runs are not resumed;
- no-runnable cycles do not call the executor;
- cycle result snapshots preserve cockpit privacy;
- selected result status agrees with durable stored state.
