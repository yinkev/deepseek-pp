# Run Telemetry Package

## Contract

Create a pure run telemetry exporter that turns the durable autonomous run ledger into a repo-visible package shape without writing files.

| Requirement | Coverage |
| --- | --- |
| Missing runs return `null`. | `returns null for a missing run` |
| Existing runs produce stable `.runs/<runHandle>/...` file paths. | `creates stable repo-visible telemetry files for one run` |
| Omitted `generatedAt` is deterministic. | `uses deterministic generatedAt when omitted` |
| Manifest exposes safe status, counts, policy modes/counts, budgets, and proof-contract counts. | `creates stable repo-visible telemetry files for one run` |
| Steps export only IDs, phases, status, timestamps, progress score, counts, and safe error codes. | `creates stable repo-visible telemetry files for one run` |
| Exported run, step, evidence, target lease IDs, paths, and free-form strings use package-local opaque handles, not raw durable IDs. | `redacts plain durable IDs from paths and free-form telemetry strings` |
| Evidence export omits summaries, refs, metadata, URLs, and raw target content. | `omits raw goals, checkpoint text, evidence summaries, refs, urls, metadata, and secrets` |
| Checkpoint export omits provider IDs and resumable summary text while preserving presence/count signals. | `omits raw goals, checkpoint text, evidence summaries, refs, urls, metadata, and secrets` |
| Verification and commit metadata are sanitized and bounded. | `omits raw goals, checkpoint text, evidence summaries, refs, urls, metadata, and secrets` |
| Durable quality-gate and review-lane records export as safe handles, enums, booleans, counts, grades, and timestamps only. | `exports quality gates and review lanes as safe repo-visible metadata` |
| Quality-gate command names/summaries, commit messages, review-lane summaries, raw durable gate/lane IDs, transcripts, and secret-like text do not leak into telemetry. | `exports quality gates and review lanes as safe repo-visible metadata` |
| Verification summary cannot pass when durable run/step state records failure, even if command metadata says success. | `fails verification summary when durable run state failed despite passing commands` |
| Root paths are normalized so package file paths remain under the requested telemetry root. | `normalizes root paths and keeps package paths inside .runs-style directories` |

## Mechanism

`createAutonomousRunTelemetryPackage(state, runId, options)` returns deterministic package-local telemetry. The raw durable `runId` is used only to select the run; exported identifiers are opaque handles such as `run-1`, `step-1`, `evidence-1`, and `target-lease-1`.

- `manifest.json`
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

## Privacy

The package intentionally omits:

- run goal text;
- checkpoint summary text and provider message IDs;
- proof delta text;
- observation refs, evidence refs, tool-call IDs, and model-turn IDs;
- evidence summaries, refs, metadata, URLs, tab/window IDs, page titles, and origins;
- target lease labels, titles, origins, tab IDs, and window IDs.
- quality-gate command names/summaries and commit messages;
- review-lane summaries, prompts, sessions, transcripts, and raw reviewer text.

It exports only safe IDs, counts, booleans, timestamps, status enums, and bounded sanitized verification/commit strings.

## Adversarial Probe

The privacy probe constructs states containing bearer tokens, cookies, signed URLs, secret-bearing durable IDs, plain durable IDs, file refs, data URLs, private target metadata, evidence refs, proof text, checkpoint text, quality-gate command summaries, commit messages, review-lane summaries, and raw transcript/output markers. The source JSON must contain those strings; the telemetry package JSON must omit them.

The false-positive success probe constructs a failed durable run with a passing command exit. The command row can still record the raw command exit result, but the package-level verification summary must remain `failed`.

## Scope Caveat

This slice creates the repo-visible package contract only. A later writer/CLI/runtime slice can persist these files under `.runs/`, but the browser extension still cannot safely write the local repo directly.

## Verification

Run:

```sh
npm test -- tests/run-telemetry.test.ts
npm test -- tests/run-telemetry.test.ts tests/run-store.test.ts tests/run-iteration-store.test.ts
npm test
npm run compile
git diff --check
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
