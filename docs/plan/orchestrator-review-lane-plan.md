# Orchestrator Review Lane Plan

## Contract

Expose the pure review-lane scheduler from the non-Chrome orchestrator cycle without importing pet control or touching Chrome/runtime files.

| Requirement | Coverage |
| --- | --- |
| Every orchestrator cycle returns a safe `reviewLanePlan`. | `passes review lane gate to the selected worker and blocks before executor work`, `returns noop when no runnable run exists and does not resume paused or blocked runs` |
| No runnable run returns an idle plan and does not call the executor. | `returns noop when no runnable run exists and does not resume paused or blocked runs` |
| A blocking review gate returns a halt plan and the worker durably blocks before executor work. | `returns halt review lane plan and durable worker block on blocking gate` |
| Review-lane capacity hold does not prevent worker progress because it is a review-dispatch plan, not a worker gate. | `returns review lane hold plan without preventing worker progress` |
| Unknown active lane roles count against capacity without leaking raw role text. | `returns review lane hold plan without preventing worker progress`, `keeps orchestrator review lane plan private` |
| Raw review labels, transcripts, prompts, URLs, commands, and unknown fields stay out of the orchestrator result. | `keeps orchestrator review lane plan private` |

## Mechanism

`executeAutonomousOrchestratorCycle` now computes `reviewLanePlan` after reconciliation and runnable-run selection. The orchestrator supplies the selected run status and optional review-lane gate to `planAutonomousReviewLanes`, plus optional scheduler metadata from `reviewLaneScheduler`.

The plan is observational metadata for review-lane dispatch. It does not start review workers and it does not stop the selected autonomous worker when `action` is `hold` or `dispatch`. Blocking remains enforced by the existing worker review-lane gate path: a halt plan with a selected run calls the worker with the same gate, and the worker appends the durable review block.

## Adversarial Probe

The halt test passes a runnable run, a P2 gate, and every dispatch trigger. The result must contain `reviewLanePlan.action = halt`, `canRunWorker = false`, no selected roles, no executor call, and durable stored run status/error matching the worker result.

The privacy test injects raw role text, transcript, prompt, URL, and command-like fields into the scheduler input. Neither `reviewLanePlan` nor the full orchestrator result may contain those strings.

## Scope Caveat

This is still a non-Chrome seam. It proves the orchestrator can compute and expose the scheduler plan and that halt agrees with durable worker blocking when a gate is supplied. It does not prove production runtime enforcement until a Chrome/runtime caller feeds a fresh pet review-lane gate into the orchestrator every cycle.

## Verification

Run:

```sh
npm test -- tests/run-orchestrator.test.ts tests/run-review-scheduler.test.ts
npm test -- tests/run-review-scheduler.test.ts tests/run-worker.test.ts tests/run-orchestrator.test.ts
npm test
npm run compile
git diff --check
```

`npm run prompt:freeze` remains expected to fail on pre-existing prompt hash drift until the prompt snapshot slice reconciles it.

## Self Review

Grade target: A. This slice only wires safe scheduler metadata into the run orchestrator contract and keeps Chrome/runtime work frozen.
