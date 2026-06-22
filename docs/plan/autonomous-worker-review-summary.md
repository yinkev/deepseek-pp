# Autonomous Worker Review Summary

Safe review-grade telemetry for one autonomous worker cycle.

## Goals
- Make `executeAutonomousRunCycle` expose the result of its evaluate/review/grade/iterate gate.
- Keep the worker result compact and safe: no issue strings, missing proof text, evidence IDs, executor messages, model output, browser payloads, target URLs, or raw review prose.
- Preserve all existing worker/orchestrator state transitions.

## Scope
- `core/run/worker.ts`
- `tests/run-worker.test.ts`
- `tests/run-orchestrator.test.ts`
- `docs/plan/autonomous-worker-review-summary.md`

No Chrome, background, content, sidepanel, prompt, or runtime wiring changes.

## Contract Coverage Table

| id | behavior | assertion / evidence | status |
|----|----------|----------------------|--------|
| 1 | `AutonomousRunCycleResult` includes `reviewSummary` | Worker result type and focused worker assertions cover null and non-null cases | covered |
| 2 | Missing, terminal, paused, and blocked no-op cycles have no review summary | Missing and paused tests assert `reviewSummary === null`; terminal/blocked use same no-op path | covered |
| 3 | Allowed cycles summarize iteration review action, decision, grade, score, issue count, proof debt, accepted evidence count, progress reason, and safe error code | Queued/allowed worker tests assert summary fields and score presence | covered |
| 4 | Policy-block cycles still expose the no-op iteration review summary after durable block | Manual review and deny tests assert `reviewSummary.action === 'noop'`, fail decision, proof debt, evidence count | covered |
| 5 | Executor failures do not leak raw error messages through `reviewSummary` | Executor-error test asserts summary safe fields and JSON omits the thrown error message | covered |
| 6 | Orchestrator result carries selected worker review summary without changing durable state agreement | Orchestrator queued-run test asserts summary and existing final-status/after-snapshot assertions still pass | covered |
| 7 | Existing worker policy and transition semantics are preserved | Existing run-worker and run-orchestrator tests still pass | covered |
| 8 | No forbidden files touched | Staged file list excludes `entrypoints/background.ts` and Chrome/runtime files | covered |

## Adversarial Probe
- Source positive: `applyAutonomousRunIterationReview` returns a full `review`.
- Result projection: `summarizeIterationReview` copies only aggregate fields and safe enum/error-code values.
- Agreement: worker tests assert result summary action/decision/counts match expected review outcomes; orchestrator tests assert worker result and durable after-snapshot still agree.
- Privacy negative: executor throws a raw message, but `reviewSummary` JSON omits it.

## Verification Commands
- `npm test -- tests/run-worker.test.ts tests/run-orchestrator.test.ts`
- `npm test`
- `npm run compile`
- `git diff --check`

## Self Review
This slice makes review/evaluate/grade/iterate auditable from the worker cycle result without exposing raw review details. It is pure run-kernel code with focused tests and no browser/prompt surface changes.

Grade: A pending final verification and independent review.
