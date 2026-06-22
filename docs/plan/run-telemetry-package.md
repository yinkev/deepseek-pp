# Run Telemetry Package

## Contract

Create a pure run telemetry exporter that turns the durable autonomous run ledger into a repo-visible package shape without writing files.

| Requirement | Coverage |
| --- | --- |
| Missing runs return `null`. | `returns null for a missing run` |
| Existing runs produce stable `.runs/<runId>/...` file paths. | `creates stable repo-visible telemetry files for one run` |
| Manifest exposes safe status, counts, policy modes/counts, budgets, and proof-contract counts. | `creates stable repo-visible telemetry files for one run` |
| Steps export only IDs, phases, status, timestamps, progress score, counts, and safe error codes. | `creates stable repo-visible telemetry files for one run` |
| Evidence export omits summaries, refs, metadata, URLs, and raw target content. | `omits raw goals, checkpoint text, evidence summaries, refs, urls, metadata, and secrets` |
| Checkpoint export omits provider IDs and resumable summary text while preserving presence/count signals. | `omits raw goals, checkpoint text, evidence summaries, refs, urls, metadata, and secrets` |
| Verification and commit metadata are sanitized and bounded. | `omits raw goals, checkpoint text, evidence summaries, refs, urls, metadata, and secrets` |
| Root paths are normalized so package file paths remain under the requested telemetry root. | `normalizes root paths and keeps package paths inside .runs-style directories` |

## Mechanism

`createAutonomousRunTelemetryPackage(state, runId, options)` returns:

- `manifest.json`
- `checkpoint.json`
- `steps.ndjson`
- `evidence.ndjson`
- `target-leases.ndjson`
- `verification.json`
- `commits.ndjson`
- `report.md`

The function is pure. It does not call Chrome, storage, filesystem, terminal, network, or pet reducers.

## Privacy

The package intentionally omits:

- run goal text;
- checkpoint summary text and provider message IDs;
- proof delta text;
- observation refs, evidence refs, tool-call IDs, and model-turn IDs;
- evidence summaries, refs, metadata, URLs, tab/window IDs, page titles, and origins;
- target lease labels, titles, origins, tab IDs, and window IDs.

It exports only safe IDs, counts, booleans, timestamps, status enums, and bounded sanitized verification/commit strings.

## Adversarial Probe

The privacy probe constructs a state containing bearer tokens, cookies, signed URLs, file refs, data URLs, private target metadata, evidence refs, proof text, and checkpoint text. The source JSON must contain those strings; the telemetry package JSON must omit them.

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

Iteration applied before commit:

- verification `passed` is derived from the normalized exit code, so a caller cannot mark a nonzero exit as passed;
- sensitive assignment redaction is case-insensitive and covers token variants before verification/commit strings are exported.

The slice is pure, metadata-only, and moves the autonomous loop toward repo-visible source-of-truth without touching Chrome/runtime files.
