# Autonomous Contract Coverage

## Contract

Create a pure coverage table for each autonomous run proof contract so workers, reviewers, telemetry, and later quality gates can distinguish covered requirements, gaps, conflicts, and explicitly not-testable items.

| Requirement | Coverage |
| --- | --- |
| Done criteria map to succeeded-step `proofDelta` entries. | `maps done criteria, required evidence, and anti-proof rows to covered status`; `reports gaps for missing criteria and missing accepted evidence`; `ignores proof deltas from non-succeeded or wrong-run steps` |
| Required evidence maps only to explicitly accepted evidence kind, summary, and refs. Omitted accepted IDs are treated as none accepted. | `maps done criteria, required evidence, and anti-proof rows to covered status`; `reports gaps for missing criteria and missing accepted evidence`; `does not accept evidence when acceptedEvidenceIds is omitted by an untyped caller`; `false-positive success probe: coverage gaps agree with completion review missing lists` |
| Anti-proof requirements are covered when absent and conflict when matched by proof or accepted evidence; conflicts override not-testable declarations. | `maps done criteria, required evidence, and anti-proof rows to covered status`; `marks anti-proof conflicts when forbidden evidence appears in proof or accepted evidence`; `anti-proof conflict wins over not-testable declarations` |
| Empty and duplicate requirements are ignored deterministically. | `deduplicates blank and repeated requirements and can mark explicit not-testable rows` |
| Explicit not-testable requirements are represented as `not_testable` rows. | `deduplicates blank and repeated requirements and can mark explicit not-testable rows` |
| Table summary counts covered, gap, conflict, and not-testable rows and sets `complete` only when no gaps or conflicts remain. | Covered across all focused tests, especially the gap/conflict/not-testable cases. |
| Coverage output sanitizes exported requirement text and exposes table-local opaque handles only, not raw durable IDs, evidence summaries, refs, URLs, credentials, or media. | `privacy probe: coverage rows expose only step/evidence handles, not raw evidence summaries or refs`; `privacy probe: matchedBy handles never expose durable step or evidence ids` |
| False-positive success probe proves table gaps agree with completion-review missing durable state. | `false-positive success probe: coverage gaps agree with completion review missing lists` |

## Mechanism

`createAutonomousContractCoverageTable(input)` accepts a run, durable steps, durable evidence, pre-reviewed accepted evidence IDs, and optional not-testable declarations. Callers should pass `reviewAutonomousRunCompletion(...).acceptedEvidenceIds` or an equivalent pre-reviewed list. Omitted accepted evidence IDs are treated as an empty list, never as "accept all evidence."

The table emits rows:

- `done_criterion`: covered by succeeded-step `proofDelta`;
- `required_evidence`: covered by accepted evidence kind, summary, or refs;
- `anti_proof`: covered when absent, conflict when present in proof or accepted evidence. A real conflict wins over `not_testable`;
- `not_testable`: explicit caller declaration for a requirement that cannot be asserted in this slice.

The module is pure. It does not read storage, call Chrome, run commands, or mutate state.

## Privacy

Rows use table-local handles such as `step-1`, `evidence-1:kind`, `evidence-1:summary`, and `evidence-1:ref`. Exported requirement text is sanitized before it leaves the module. Rows do not copy raw durable IDs, proof text, evidence summaries, evidence refs, URLs, credentials, target metadata, or command output into the table.

This keeps the table useful for pet/telemetry surfaces without turning it into a transcript leak.

## Adversarial Probe

The false-positive probe builds a run where only one done criterion is proved and no required evidence is accepted. Existing completion review reports `tests pass` and `shell_output` as missing, does not pass, and the coverage table must report exactly those gaps.

The privacy probes feed secret-bearing requirements, evidence summaries, refs, and durable step/evidence IDs. The source contains credentials, signed URL fragments, and secret IDs; the coverage JSON must not.

## Self Review

Grade: A.

This slice adds a pure run-layer contract table and tests. It does not touch Chrome/runtime files or `entrypoints/background.ts`.
