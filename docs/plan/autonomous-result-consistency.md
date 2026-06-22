# Autonomous Result-State Consistency Probe

## Scope

This slice adds a pure reviewer for worker and orchestrator result objects. It compares returned result metadata against the durable run ledger snapshot supplied by the caller.

No Chrome/runtime wiring is included in this slice, and `entrypoints/background.ts` remains out of scope.

## Contract Coverage

| Required behavior | Test assertion |
| --- | --- |
| Missing-run noop can be represented without falsely failing the gate. | `accepts a missing-run noop as consistent with absent durable state` |
| Block results require the result and durable state to agree on `blocked`. | `accepts worker block results only when durable state is blocked too`; `rejects block actions whose result status is not blocked` |
| Executor failures do not imply durable `failed`; the returned final status must match durable state. | `does not require executor fail actions to produce durable failed status` |
| False-positive success is rejected when the result claims success/pass but durable state is not `succeeded`. | `adversarial probe: rejects false-positive success when durable state is still running` |
| Non-noop results fail closed when the durable run is absent. | `rejects non-noop results when the durable run is missing` |
| Reports expose issue codes/statuses only, not raw run IDs or secret-bearing run content. | `keeps consistency reports free of raw run IDs and secret-bearing values`; orchestrator mismatch privacy assertion |
| No-selected-run orchestrator cycles are valid no-op cases when no worker result is present. | `accepts orchestrator cycles with no selected run and no worker result as not applicable` |
| Selected orchestrator runs must have a worker result for the same run. | `rejects orchestrator selected-run and worker-result mismatches`; `rejects orchestrator cycles that select a run but omit worker result` |
| After-snapshot status is checked only when the active run is the selected run, and then must agree with worker final status. | `does not require after-snapshot active run to be the selected run`; `rejects after-snapshot status disagreement for the selected run` |

## False-Positive Success Probe

The adversarial test builds a worker result that claims:

- `finalStatus: succeeded`
- `iterationAction: succeed`
- `reviewSummary.action: succeed`
- `reviewSummary.completionDecision: pass`

The durable ledger still holds the run as `running`. The reviewer returns `ok: false` with P1 issue codes for final-status mismatch and success/pass claims without durable success.

## Self-Review

Grade: A

The module is intentionally pure and narrow. It does not mutate storage, call browser APIs, inspect evidence, or decide the next autonomous action. It only produces a compact gate verdict that later slices can persist or wire into pet/orchestrator surfaces.
