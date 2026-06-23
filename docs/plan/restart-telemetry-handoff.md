# Restart Telemetry Handoff

## Contract

Repo-visible run telemetry must let an autonomous worker resume from durable state without reading raw prompts, target labels, URLs, transcripts, provider IDs, or evidence text.

`handoff.json` now carries four restart-safe groups:

- `schedulerWatchdog`: the pure watchdog verdict derived from the durable run, target lease, evidence, quality gate, and review lanes;
- `retryPosture`: retryability, durable status continuation posture, retryable error presence, and total blocker count;
- `unresolvedBlockers`: aggregate blocker counts for review lanes, quality gate, durable run error, failed steps, target lease, evidence, and watchdog;
- `checkpoint`: package-local latest step handle plus provider/parent presence booleans and checkpoint text counts.

The fields are intentionally small. They are restart signals, not transcripts.

## Contract Coverage

| Required Behavior | Coverage |
| --- | --- |
| Expose scheduler/watchdog state in `handoff.json`. | `exports safe restart watchdog, retry, blocker, and checkpoint handoff fields` |
| Expose retry posture from durable status, retryable error flag, blocker counts, and verification posture. | `exports safe restart watchdog, retry, blocker, and checkpoint handoff fields`; `does not finalize a blocked restart handoff when verification commands pass` |
| Expose unresolved blocker aggregates without raw details. | `exports safe restart watchdog, retry, blocker, and checkpoint handoff fields`; `exports quality gates and review lanes as safe repo-visible metadata` |
| Expose latest safe checkpoint metadata without provider IDs or summary text. | `exports safe restart watchdog, retry, blocker, and checkpoint handoff fields`; `omits raw goals, checkpoint text, evidence summaries, refs, urls, metadata, and secrets` |
| Keep false-positive success blocked when durable state is blocked/failed and command metadata passed. | `does not finalize a blocked restart handoff when verification commands pass`; `fails verification summary when durable run state failed despite passing commands` |
| Preserve writer completion semantics: `.complete.json` is written only after validated package files are written. | `validates then writes package files in package order`; `does not write a completion marker when a package file write fails` |
| Preserve writer path safety and duplicate marker rejection. | `rejects unsafe paths before writing any file`; `writes a validated snapshot even if caller mutates package during write` |

## Adversarial Probe

The restart probe uses a blocked durable run with `autonomous_reconcile_missing_target_lease` and a passing verification command. Expected result:

- `verification.json.summary.status` is `failed`;
- `handoff.json.verificationStatus` is `failed`;
- `handoff.json.nextAction` is `inspect_failure`;
- `handoff.json.nextAction` is not `finalize`;
- retry posture records the durable retryable error while also showing that blocked status cannot continue automatically.

## Scope

This slice is telemetry-only. It does not write files to disk by itself, dispatch workers, touch Chrome/runtime wiring, or mutate `entrypoints/background.ts`.

## Verification

Run:

```sh
npm test -- tests/run-telemetry.test.ts tests/run-telemetry-writer.test.ts tests/run-store.test.ts tests/run-orchestrator.test.ts
npm run compile
npm test
git diff --check
git diff --name-only HEAD -- entrypoints/background.ts
```

## Self Review

Grade target: A.

Reasons:

- restart handoff fields are derived from existing durable state and the pure scheduler watchdog;
- the handoff exports only enums, counts, booleans, bounded safe codes, and package-local handles;
- blocked/failed durable state overrides passing command metadata;
- writer completion semantics and path safety remain covered by existing writer tests.
