# Run Telemetry Package

## Contract

Create a pure run telemetry exporter that turns the durable autonomous run ledger into a repo-visible package shape without writing files.

| Requirement | Coverage |
| --- | --- |
| Missing runs return `null`. | `returns null for a missing run` |
| Existing runs produce stable `.runs/<runHandle>/...` file paths. | `creates stable repo-visible telemetry files for one run` |
| Omitted `generatedAt` is deterministic. | `uses deterministic generatedAt when omitted` |
| Manifest exposes safe status, counts, policy modes/counts, budgets, and proof-contract counts. | `creates stable repo-visible telemetry files for one run` |
| Handoff export exposes a compact repo-visible next action from safe durable state only. | `creates stable repo-visible telemetry files for one run`; `exports quality gates and review lanes as safe repo-visible metadata`; `fails verification summary when durable run state failed despite passing commands`; `collects evidence before continuing an unfinished run with no evidence`; `idles a terminal run when verification is not recorded`; `inspects a terminal run when verification commands fail`; `keeps historical review blockers active until durable records are removed`; `keeps latest review blockers ahead of durable failure inspection`; `blocks on a failed persisted review lane without priority blockers`; `finalizes the handoff only when durable success and verification both pass` |
| Steps export only IDs, phases, status, timestamps, progress score, counts, and safe error codes. | `creates stable repo-visible telemetry files for one run` |
| Exported run, step, evidence, target lease IDs, paths, and free-form strings use package-local opaque handles, not raw durable IDs. | `redacts plain durable IDs from paths and free-form telemetry strings` |
| Evidence export omits summaries, refs, metadata, URLs, and raw target content. | `omits raw goals, checkpoint text, evidence summaries, refs, urls, metadata, and secrets` |
| Checkpoint export omits provider IDs and resumable summary text while preserving presence/count signals. | `omits raw goals, checkpoint text, evidence summaries, refs, urls, metadata, and secrets` |
| Verification and commit metadata are sanitized and bounded. | `omits raw goals, checkpoint text, evidence summaries, refs, urls, metadata, and secrets` |
| Durable quality-gate and review-lane records export as safe handles, enums, booleans, counts, grades, and timestamps only. | `exports quality gates and review lanes as safe repo-visible metadata` |
| Quality-gate command names/summaries, commit messages, review-lane summaries, raw durable gate/lane IDs, transcripts, and secret-like text do not leak into telemetry. | `exports quality gates and review lanes as safe repo-visible metadata` |
| Verification summary cannot pass when durable run/step state records failure, even if command metadata says success. | `fails verification summary when durable run state failed despite passing commands` |
| Handoff export exposes restart-safe scheduler/watchdog verdict, retry posture, unresolved blocker aggregates, and checkpoint metadata. | `exports safe restart watchdog, retry, blocker, and checkpoint handoff fields` |
| Handoff restart fields cover review-lane blockers, quality-gate blockers, stale evidence, no-progress, pause, and terminal success watchdog verdicts. | `exports quality gates and review lanes as safe repo-visible metadata`; `exports a quality-gate watchdog blocker when no review lane blocks`; `exports stale evidence and no-progress watchdog blockers through handoff`; `idles a paused run instead of reporting a restart failure`; `finalizes the handoff only when durable success and verification both pass` |
| Watchdog/reconcile blocked state cannot become `finalize` or `passed` just because verification command metadata passed. | `does not finalize a blocked restart handoff when verification commands pass` |
| Missing runtime authorization preflight observation exports fail-closed informational metadata: `status: none`, `canStartRuntimeSlice: false`, null gate reasons/statuses, zero counts, false booleans, and null scope. | `exports no-observed runtime authorization preflight metadata by default` |
| Provided runtime authorization preflight exports only bounded safe metadata: status, can-start boolean, source gate statuses/reasons, counts, runtime-file flag, authorization booleans, and authorization scope. | `projects blocked runtime authorization preflight as safe handoff metadata`; `privacy probe: runtime preflight handoff projection omits unknown raw fields` |
| Runtime authorization preflight handoff projection is informational only; even `canStartRuntimeSlice: true` cannot alter `nextAction`, verification status, durable status/failure, watchdog, retry posture, unresolved blockers, quality gate, or review lane. | `keeps authorized runtime preflight projection informational and off primary handoff gates` |
| False-positive success is blocked: an authorized preflight attached to failed durable telemetry cannot make handoff finalize or verification pass; handoff and verification durable-failure fields agree. | `false-positive probe: authorized preflight cannot pass failed durable telemetry` |
| Root paths are normalized so package file paths remain under the requested telemetry root. | `normalizes root paths and keeps package paths inside .runs-style directories` |

## Mechanism

`createAutonomousRunTelemetryPackage(state, runId, options)` returns deterministic package-local telemetry. The raw durable `runId` is used only to select the run; exported identifiers are opaque handles such as `run-1`, `step-1`, `evidence-1`, and `target-lease-1`.

- `manifest.json`
- `handoff.json`
- `checkpoint.json`
- `steps.ndjson`
- `evidence.ndjson`
- `target-leases.ndjson`
- `quality-gates.ndjson`
- `review-lanes.ndjson`
- `verification.json`
- `commits.ndjson`
- `report.md`

The function is pure. It does not call Chrome, storage, filesystem, terminal, network, or pet reducers.

When `generatedAt` is omitted, the exporter uses `run.updatedAt` instead of wall-clock time.

`handoff.json` is the compact operator-facing summary for autonomous loops. It exposes safe counts, latest gate status/grade, aggregate review-lane blocker counts, verification status, and one `nextAction`. Review-lane blockers are durable gate records: a later clean lane does not erase an earlier persisted P1/P2, block recommendation, blocked lane, or failed lane. Clearing those blockers requires a separate durable resolution/pruning model; this exporter does not infer resolution from later clean records.

`runtimeAuthorizationPreflight` is optional read-only handoff metadata supplied by the caller. If absent, the handoff records no observation with `status: none` and `canStartRuntimeSlice: false`. If present, the exporter copies only bounded fields from the pure preflight decision: status, can-start boolean, source gate statuses/reasons, marker/review counts, runtime-file changed flag, authorization booleans, and authorization scope. It does not export raw document text, missing marker arrays, authorization IDs, raw review prose, URLs, tokens, prompts, transcripts, file contents, or unknown extra fields.

`canStartRuntimeSlice: true` in handoff metadata is not runtime permission. Step 10 runtime work still requires a fresh `evaluateAutonomousRuntimeAuthorizationPreflight` immediately before runtime work; this telemetry field is only a repo-visible last-observed projection for operator handoff.

Restart handoff fields are safe metadata only:

- `schedulerWatchdog`: watchdog decision, reason, retryability, block flag, recommended status, safe error code, and count/age details;
- `retryPosture`: whether durable status allows continuation, whether a retryable durable error exists, and total blocker count;
- `unresolvedBlockers`: review, quality gate, durable run, failed step, target lease, evidence, and watchdog aggregate counts;
- `checkpoint`: latest package-local step handle, provider/parent presence booleans, resumable summary character count, and unresolved question count.

- `review_blocker` when the latest quality gate, independent review, or persisted review lane records report a blocking P1/P2, block recommendation, blocked status, or failed status;
- `inspect_failure` when durable state or verification reports failure;
- `collect_evidence` when unfinished work has no evidence yet;
- `continue_run` when the durable run is still active;
- `finalize` only when the durable run succeeded and verification passed;
- `idle` otherwise.

## Privacy

The package intentionally omits:

- run goal text;
- checkpoint summary text and provider message IDs;
- proof delta text;
- observation refs, evidence refs, tool-call IDs, and model-turn IDs;
- evidence summaries, refs, metadata, URLs, tab/window IDs, page titles, and origins;
- target lease labels, titles, origins, tab IDs, and window IDs;
- quality-gate command names/summaries and commit messages;
- review-lane summaries, prompts, sessions, transcripts, and raw reviewer text;
- handoff raw text, raw durable IDs, and raw reviewer output.

It exports only safe IDs, counts, booleans, timestamps, status enums, and bounded sanitized verification/commit strings.

## Adversarial Probe

The privacy probe constructs states containing bearer tokens, cookies, signed URLs, secret-bearing durable IDs, plain durable IDs, file refs, data URLs, private target metadata, evidence refs, proof text, checkpoint text, quality-gate command summaries, commit messages, review-lane summaries, and raw transcript/output markers. The source JSON must contain those strings; the telemetry package JSON must omit them.

The false-positive success probe constructs a failed durable run with a passing command exit. The command row can still record the raw command exit result, but the package-level verification summary must remain `failed`.

The restart false-positive probe constructs a blocked durable run with a retryable reconcile error and a passing command exit. The handoff must remain `inspect_failure`, the package-level verification status must remain `failed`, and `nextAction` must not become `finalize`.

The runtime-preflight false-positive probe constructs a failed durable run with passing command metadata plus an authorized preflight projection. The handoff must remain `inspect_failure`, verification must remain `failed`, durable failure must remain true in both `verification.json` and `handoff.json`, and `nextAction` must not become `finalize`.

The runtime-preflight privacy probe casts unknown raw fields onto the source decision, including raw document text, missing-marker arrays, authorization IDs, review prose, prompts, and file-content-like strings. The handoff must expose only the explicit safe projection object.

## Scope Caveat

This slice creates the repo-visible package contract only. A later writer/CLI/runtime slice can persist these files under `.runs/`, but the browser extension still cannot safely write the local repo directly.

## Verification

Run:

```sh
npm test -- tests/run-telemetry.test.ts
npm test -- tests/run-telemetry.test.ts tests/run-runtime-authorization-preflight.test.ts
npm test -- tests/run-telemetry.test.ts tests/run-store.test.ts tests/run-iteration-store.test.ts
npm test
npm run compile
git diff --check
git diff --name-only HEAD -- entrypoints/background.ts
```

`npm run prompt:freeze` remains expected to fail on pre-existing prompt hash drift until the prompt snapshot slice reconciles it.

## Self Review

Grade: A.

Review-driven iteration applied before this follow-up commit:

- verification `passed` is derived from the normalized exit code, so a caller cannot mark a nonzero exit as passed;
- sensitive assignment redaction is case-insensitive and covers token variants before verification/commit strings are exported;
- exported IDs are package-local handles, so secret-bearing durable IDs cannot leak into files, paths, or reports;
- plain durable IDs, including automation IDs, are redacted from caller-provided roots and exported free-form strings such as error codes, commands, commit messages, SHAs, and tool names;
- package-level verification summary reconciles command results with durable run/step failure state;
- omitted `generatedAt` is deterministic and uses `run.updatedAt`.

The slice is pure, metadata-only, and moves the autonomous loop toward repo-visible source-of-truth without touching Chrome/runtime files.
