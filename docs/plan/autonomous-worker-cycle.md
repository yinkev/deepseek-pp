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
- Non-allow policy: appends review step with error, does not call executor.
- Allow: calls executor once.
- Executor errors: append failed step (no swallow), then apply.
- After any executor work (or policy block): calls applyAutonomousRunIterationReview.
- Returns compact result with action, started/advanced/applied, policyDecision, iterationAction, finalStatus, errorCode.

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
- policy deny/manual records review step, skips executor, still applies iteration.
- allow calls executor, applies iteration.
- executor throw records failed step, applies, surfaces in result.
- every non-noop cycle ends with review/apply.

No Chrome, no real execution, no unrelated refactors.
