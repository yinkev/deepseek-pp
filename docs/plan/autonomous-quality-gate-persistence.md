# Autonomous Quality Gate Persistence

## Scope

Step 4 adds a repo-local durable quality-gate record for autonomous run iterations.

This slice is pure core/run storage, types, tests, and docs. It does not wire Chrome runtime, prompt generation, background entrypoints, or orchestrator policy decisions.

## Durable record

Quality gates are persisted in the autonomous run storage state as compact records keyed by `runId` with generated gate ids and per-run sequence numbers.

Stored fields are safe aggregates only:

- contract coverage counts and completion status
- result-state consistency status and issue counts
- self-review letter grade
- verification command name/result/short summary
- commit hash/message summary
- independent review status/grade/blocking issue count

The store ignores raw reviewer prose, raw output, raw transcripts, evidence ids supplied inside summaries, source run ids supplied inside summaries, arbitrary extra fields, and oversized/unrecognized payload shape.

## Contract coverage table

| ID | Required behavior | Test assertion / proof | Status |
| --- | --- | --- | --- |
| 1 | Add durable quality-gate record type. | `core/run/types.ts` exports `AutonomousQualityGateRecord` and related summary/input types; `npm run compile` validates callers. | covered |
| 2 | Persist gate records in autonomous run storage state, keyed to runId and generated gate id / createdAt / seq order. | `tests/run-quality-gate-store.test.ts` expects generated `gate-*` ids, `createdAt`, seq `1`/`2`, and `getAutonomousRunQualityGates(run.id)` returning `[first, second]`. | covered |
| 3 | Provide store append/get APIs similar to existing append/get functions. | `tests/run-quality-gate-store.test.ts` imports and exercises `appendAutonomousQualityGateRecord` and `getAutonomousRunQualityGates`. | covered |
| 4 | Store safe summaries for contract coverage, result-state consistency, self-review, verification, commit, and independent review. | `tests/run-quality-gate-store.test.ts` appends both passing and failing records with all summary sections and compares returned records to durable retrieval. | covered |
| 5 | Normalize/sanitize inputs so raw run ids, evidence ids, URLs, bearer/API tokens, transcript text, raw reviewer prose, and arbitrary secret strings do not leak into persisted/output gate JSON. | Privacy probe in `tests/run-quality-gate-store.test.ts` injects secret-bearing extra fields, signed/private URLs, bearer/cookie data, transcript text, raw output, and reviewer prose, then asserts returned and durable JSON exclude those source strings and contain redaction markers. | covered |
| 6 | Returned append result and durable stored state agree exactly for the same gate. | False-positive success probe in `tests/run-quality-gate-store.test.ts` asserts `gate` deep-equals `getAutonomousRunQualityGates(run.id)[0]`. | covered |
| 7 | Missing or terminal runs do not accept new quality-gate records. | `tests/run-quality-gate-store.test.ts` asserts appends for missing and succeeded runs return null and durable gate list remains empty. | covered |
| 8 | Malformed gate status, result-state consistency status, and verification command results must fail closed instead of becoming passing data. | `tests/run-quality-gate-store.test.ts` asserts unknown/missing gate status and verification results normalize to `failed`, and unknown consistency status normalizes to `inconsistent`. | covered |
| 9 | Do not touch `entrypoints/background.ts`, Chrome/runtime wiring, or prompt/freeze-sensitive prompt output. | `git diff -- entrypoints/background.ts`, `git diff -- core/i18n scripts/prompt-freeze*`, and `npm run prompt:freeze` verification; prompt freeze may report known pre-existing drift only. | covered |
| 10 | No new dependencies. | `package.json` unchanged and implementation uses existing store/redaction helpers only. | covered |

## Adversarial probe design

The focused privacy test deliberately passes untyped extra fields that resemble future mistakes: raw source run ids, evidence ids, reviewer prose, transcript text, raw output, bearer-like strings, GitHub tokens, assignment-style `token=` / `api_key=` secrets, signed/private URLs, cookie-bearing commit messages, and arbitrary `TOPSECRET_*` tokens.

The expected durable output keeps only bounded aggregate fields and redacted short command/commit summaries. The exact append result is then compared against durable retrieval to prevent false-positive success claims where the returned object differs from storage.

## Residual risk

This slice only stores the gate evidence. It does not decide whether the next autonomous cycle is allowed; that belongs to the later orchestrator/pet policy consumption slice.
