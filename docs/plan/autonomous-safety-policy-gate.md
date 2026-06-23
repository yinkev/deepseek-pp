# Autonomous Safety Policy Gate

## Purpose

Step 5 adds a pure safety and redaction summary for autonomous worker surfaces.

The summary is deliberately metadata-only. It reports whether a surface is safe, redacted, or blocked, plus bounded issue codes/categories and policy posture. It never exports raw prompts, goals, target labels, URLs, transcripts, evidence summaries, refs, provider IDs, commands, commit messages, or secret candidates.

## Contract Coverage

| Requirement | Coverage |
| --- | --- |
| Clean metadata-only surfaces can report `safe`. | `createAutonomousSafetyRedactionSummary` clean telemetry test in `tests/run-policy.test.ts`. |
| Missing metadata-only posture fails closed. | Unsafe export-surface test in `tests/run-policy.test.ts` expects `blocked` and `unsafe_export_surface`. |
| Secret-like candidates set redaction flags without returning raw source text. | Privacy summary test in `tests/run-policy.test.ts`; JSON-style structured secret candidate test in `tests/run-policy.test.ts`; worker prompt privacy test in `tests/run-worker-prompt.test.ts`. |
| Deny and manual-review policy gates block autonomous summaries. | Policy gate summary test in `tests/run-policy.test.ts`. |
| Real action-policy reviews can be converted into safe policy summaries. | Action-policy helper test in `tests/run-policy.test.ts`. |
| Already-sanitized redaction markers cannot report clean. | False-positive probe in `tests/run-policy.test.ts`. |
| Declared raw-content presence blocks and cannot be hidden by duplicate/invalid issue codes. | Raw-content issue-code vocabulary test in `tests/run-policy.test.ts`. |
| Worker prompts expose safety metadata and preserve the required quality gate. | Deterministic and privacy prompt tests in `tests/run-worker-prompt.test.ts`. |
| Telemetry handoff exposes redaction metadata only. | Stable telemetry package and privacy telemetry tests in `tests/run-telemetry.test.ts`. |
| Review-lane exports expose redaction metadata only. | Quality gate/review-lane telemetry test in `tests/run-telemetry.test.ts`. |
| Pet handoff capsule exposes redaction metadata and worker-cycle policy posture only. | Clean, forged-source, allow, and deny handoff tests in `tests/pet-control.test.ts`. |
| Runtime and Chrome/background remain frozen. | `git diff --name-only HEAD -- entrypoints/background.ts` must be empty before commit. |

## Mechanism

`createAutonomousSafetyRedactionSummary` lives in `core/run/policy.ts`. Callers pass:

- the export surface;
- whether the surface is metadata-only;
- optional policy gate posture;
- optional redaction candidates.

The helper fails closed when `metadataOnly` is absent, blocks denied/manual-review policy postures, and treats detected raw secrets, URLs, or redaction markers as redaction evidence.

`policyGate` is `not_applicable` on surfaces that do not carry an action-policy decision. Pet handoff passes the worker-cycle policy decision when one is available; direct action-policy summaries cover `allow`, `manual_review`, and `deny`.

## Export Surfaces

- Worker prompts include a `<safety_redaction>` block.
- Telemetry `handoff.json` includes `safetyRedaction`.
- Review-lane telemetry rows include `safetyRedaction`.
- Pet handoff capsules include flattened `safetyRedaction*` fields.

## Adversarial Probe

The source fixtures contain secret-looking values and private URLs. The exported payloads omit the raw values while the safety metadata reports redaction. This prevents the false-positive state where a surface silently redacts or drops unsafe input while still claiming no safety issue occurred.

## Self Review

Grade: A.

This slice is pure core/pet metadata and tests. It does not execute workers, invoke browser/runtime behavior, mutate Chrome entrypoints, or make Oracle/Grok outputs authoritative.
