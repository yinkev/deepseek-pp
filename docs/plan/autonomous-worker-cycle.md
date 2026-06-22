# Autonomous Worker Cycle

## Purpose

This slice adds the first non-Chrome store-backed autonomous worker execution loop:

```ts
executeAutonomousRunCycle(runId, executor, options)
```

It coordinates queued start, policy/budget gate, injected executor seam (test-only), durable step recording on policy or error, and always ends the cycle with `applyAutonomousRunIterationReview`.

It does not perform real model calls, tool execution, browser actions, subagents, or Chrome integration.

## Call

A worker (or test harness) calls the cycle for one advance of a run:

- Accepts runId and injected `AutonomousRunExecutor` (seam that may use store appends or side-effect simulation).
- If missing or terminal: noop, no writes.
- Queued: transitions to running.
- Paused/blocked: noop, no auto-resume.
- Before executor: runs `reviewAutonomousRunAction` (default model_turn; tool_call supported).
- Non-allow policy (deny or manual_review):
  - Appends a metadata-only review step with the policy error.
  - Explicitly transitions the run to `blocked` with the policy error (durable, independent of proofContract.doneCriteria or iteration review path).
  - Calls `applyAutonomousRunIterationReview` (will noop because status is no longer 'running'; applied=false is reported honestly).
  - Executor is never called.
- Allow: calls executor once.
- Executor errors: append failed step (no swallow), then apply.
- After executor work: calls applyAutonomousRunIterationReview.
- After policy block transition: calls applyAutonomousRunIterationReview (no-op; applied=false reported honestly).
- Returns compact result with action, started/advanced/applied, policyDecision, iterationAction, finalStatus, errorCode.

**Policy-block durability guarantee**: When reviewAutonomousRunAction returns non-allow, the final durable status is always 'blocked' with the policy error, even if the run's proofContract has valid non-empty doneCriteria. The iteration gate cannot override this because the status transition happens before the apply.

## Executor Seam

The executor is a pure test seam. In production it will be replaced by real adapters; in tests it simulates by calling existing append/evidence store APIs or returning data.

Worker chooses the simpler repo-fit: executor performs its work (including appends via store) when allowed.

## Result Contract

```ts
{
  action: 'noop' | 'start' | 'advance' | 'block' | 'fail',
  runId,
  started: boolean,
  advanced: boolean,
  applied: boolean,
  policyDecision: 'allow' | 'manual_review' | 'deny' | null,
  iterationAction: string | null,
  finalStatus: AutonomousRunStatus | null,
  errorCode: string | null,
}
```

## Verification

Tests prove:
- noop for missing/terminal/paused/blocked (no executor).
- queued transitions to running before work.
- policy non-allow (deny or manual_review, including with non-empty valid proofContract) records review step, explicitly transitions to blocked durably (before iteration review), skips executor, calls apply (no-op, applied=false), returns action=block + finalStatus=blocked.
- allow calls executor, applies iteration.
- executor throw records failed step, applies, surfaces in result.
- blocked runs (including policy-blocked) are not auto-resumed on subsequent calls.
- every non-noop cycle ends with review/apply.

No Chrome, no real execution, no unrelated refactors.
