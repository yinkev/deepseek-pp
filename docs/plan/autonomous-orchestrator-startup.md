# Autonomous Orchestrator Readiness Contract

## Purpose

The run substrate is not useful if the system cannot summarize and reconcile it.

This slice adds the non-Chrome contract that the background worker and pet can call once Chrome integration resumes:

- startup reconciles stale `running` runs into `blocked`;
- `getAutonomousRunCockpitSnapshot` returns a compact worker-state snapshot.

It does not execute model turns, browser actions, or tool calls.
It is not yet wired into the background service worker.

## Startup Reconciliation

When Chrome integration resumes, service-worker wake should call:

```ts
initializeAutonomousRunOrchestrator()
```

The default interruption threshold is five minutes. Any `running` run whose ledger has not updated beyond that threshold is marked `blocked` with the existing interrupted-run error.

This makes MV3 shutdown visible to the worker and pet instead of leaving silent `running` rows.

## Cockpit Snapshot

`getAutonomousRunCockpitSnapshot` returns:

- generated timestamp;
- overall cockpit status;
- counts by run status;
- one selected active run;
- latest step summary;
- target lease count;
- evidence count;
- current error code.

Selection priority is:

```txt
running -> blocked -> paused -> queued -> newest run -> null
```

This is the first stable API for the pet cockpit over worker state.

## Verification

Current tests prove:

- startup reconciliation converts stale running runs to blocked;
- malformed stale running rows without `startedAt` are still blocked;
- cockpit status prioritizes running before blocked;
- cockpit snapshots are built from one normalized ledger read;
- active run summary includes latest step, target lease count, and evidence count;
- cockpit snapshots do not expose raw evidence refs, summaries, or metadata;
- completed-only ledgers select the newest terminal run;
- empty ledger returns idle/null snapshot.
