# Orchestrator Telemetry Handoff

## Contract

Let `executeAutonomousOrchestratorCycle` optionally export the selected run's post-cycle ledger state through the validated telemetry writer.

| Requirement | Coverage |
| --- | --- |
| Telemetry is opt-in and uses an injected write target only. | `writes selected run telemetry after the worker cycle using post-cycle durable state` |
| Omitting telemetry options returns `telemetryResult: null`. | `selects the newest queued run and advances it through the worker cycle` |
| Written telemetry is generated after the worker cycle and agrees with durable final run state. | `writes selected run telemetry after the worker cycle using post-cycle durable state` |
| Written telemetry includes safe persisted quality-gate and review-lane metadata from the post-cycle ledger. | same post-cycle telemetry test reads `quality-gates.ndjson` and `review-lanes.ndjson` from the injected write target |
| No selected runnable run skips telemetry without calling the target. | `skips telemetry when no runnable run is selected` |
| Writer failures do not throw from the orchestrator and expose only safe error metadata. | `returns safe telemetry failure metadata without leaking writer errors` |
| Partial writer failures do not produce the final `.complete.json` marker. | `returns safe telemetry failure metadata without leaking writer errors` |
| Orchestrator telemetry writes preserve existing privacy guarantees. | `keeps orchestrator cycle snapshots private` |

## Mechanism

`AutonomousRunOrchestratorCycleOptions.telemetry` accepts:

- `target`: an injected `writeTextFile(path, content)` sink;
- optional `rootDir`, `verification`, and `commits` metadata passed into `createAutonomousRunTelemetryPackage`.

The orchestrator reads the ledger again after the worker cycle, builds a telemetry package for the selected run, and writes it through `writeAutonomousRunTelemetryPackage`.

The package includes safe quality-gate and review-lane NDJSON files when those durable records exist. The orchestrator does not read package content back or treat that metadata as new authority; it only writes the repo-visible package from the same post-cycle ledger snapshot.

## Failure Semantics

Telemetry is non-blocking for run state:

- no telemetry option returns `telemetryResult: null`;
- no selected run returns `status: skipped` with `errorCode: no_selected_run`;
- missing target returns `status: skipped` with `errorCode: target_unavailable`;
- package creation failure returns `status: skipped` with `errorCode: package_unavailable`;
- writer failure returns `status: failed` with `errorCode: telemetry_write_failed`.

Writer exception messages are intentionally not surfaced. Consumers must only trust written telemetry directories that contain the final `.complete.json` marker.

## Adversarial Probe

The privacy probe stores secret evidence refs, summaries, metadata URLs, raw durable IDs, quality-gate command summaries, commit messages, and review-lane summaries, then enables telemetry writes. The orchestrator result and written telemetry JSON must omit those strings while still reporting safe package metadata.

## Self Review

Grade: A. This slice connects the autonomous loop to repo-visible telemetry via injected sinks only. It does not touch Chrome/runtime files or `entrypoints/background.ts`.
