# Autonomous Review Lane Gate Consumption

## Purpose

Make persisted review-lane records affect the pure autonomous orchestrator. A durable P1/P2, `block` recommendation, `blocked` lane, or `failed` lane now derives an effective review-lane gate before worker execution.

This slice is pure `core/run` orchestration, tests, and docs. It does not dispatch review workers, spawn Grok or Oracle, touch Chrome/runtime files, mutate prompt contracts, expose lane records in the pet, or add browser/background wiring.

## Contract Coverage Table

| id | required behavior | assertion / location | status |
|----|-------------------|----------------------|--------|
| 1 | Derive a safe review-lane gate from persisted review-lane records | `pure review lane gate derivation covers block, failed, active, and clear states`; persisted P2 cycle test covers store-fed records | covered |
| 2 | P1/P2 records halt the scheduler and block worker execution before executor work | persisted P2 test and persisted P1 override test assert `reviewLanePlan.action = halt`, executor not called, and durable worker result is `block` | covered |
| 3 | Non-blocking persisted lane records do not prevent worker execution | `allows worker execution when persisted review lane records are non-blocking` | covered |
| 4 | Persisted blocking records dominate an explicit clear review gate | `lets persisted P1 records dominate an explicit clear review lane gate` | covered |
| 5 | Review-lane gate output remains safe metadata only | persisted P2 test asserts plan JSON omits run id, goal, and lane summary text | covered |
| 6 | No Chrome/background/runtime/prompt files are touched | staged file list and `git diff --check`; prompt freeze may still show known pre-existing hash drift only | process check; not unit-testable in this slice |

## Mechanism

`executeAutonomousOrchestratorCycle` reads the ledger snapshot once, selects the runnable run, derives an effective gate from that run's persisted lane records, merges it with any explicit caller gate, and passes the effective gate into both the scheduler and worker cycle.

The derived gate contains only status, reason, blocking priority, and blocking lane count. It does not expose lane ids, run ids, summaries, prompts, transcripts, sessions, URLs, or raw reviewer prose.

## Adversarial Probe

The false-positive safety probe stores a P2 lane, runs a cycle with no explicit gate, and asserts:

- the scheduler halts;
- the executor is not called;
- the worker result durably blocks the run;
- the serialized plan omits the run id, goal, and lane summary.

The override probe stores a P1 lane and supplies an explicit clear gate. The persisted P1 must still halt and block.

## Verification

Run:

```sh
npm test -- tests/run-orchestrator.test.ts tests/run-worker.test.ts tests/run-review-lane-store.test.ts
npm run compile
git diff --check
```

`npm run prompt:freeze` remains expected to fail on pre-existing prompt hash drift until the dedicated prompt snapshot reconciliation slice.

## Self Review

Grade target: A. This is pure policy consumption of already-sanitized durable lane metadata; it does not claim live advisor dispatch or pet exposure.
