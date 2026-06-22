# Autonomous Review, Grade, Iterate Gate

## Purpose

The autonomous worker must not declare completion from model text alone.

This slice adds a pure completion reviewer:

```ts
reviewAutonomousRunCompletion({ run, steps, evidence, targetLease, liveTarget, now })
```

It does not run tools, mutate browser state, retry, or finish the run. It returns the decision that orchestration must obey.

## Decisions

The reviewer returns:

- `pass` - completion evidence is sufficient;
- `iterate` - the run should do another implementation or verification pass;
- `fail` - the run is too far from the proof contract to continue as-is.

It also returns:

- grade: `A`, `B`, `C`, `D`, or `F`;
- numeric score;
- issue codes;
- missing done criteria;
- missing required evidence;
- accepted fresh evidence ids;
- retryable or non-retryable error.

## Review Inputs

The reviewer uses:

- `proofContract.doneCriteria`;
- `proofContract.requiredEvidence`;
- step `proofDelta`;
- accepted fresh evidence kind, summary, refs, lease, source, and freshness;
- optional live target review against the active target lease;
- failed step count.

## Pass Rule

A run can pass only when:

- grade is `A` or `B`;
- no issue codes remain;
- done criteria match proof deltas from succeeded steps;
- required evidence matches accepted fresh evidence only;
- target lease review passes when the run has a target lease pointer;
- provided target lease id and run id match the run;
- no failed steps are present.
- the proof contract is not empty.

## Iterate Rule

The reviewer asks for iteration when the run has recoverable gaps:

- missing proof criteria;
- target lease review mismatch;
- failed steps with otherwise recoverable score.

## Fail Rule

The reviewer fails when the score falls to `F` and either no fresh evidence was accepted or the run has several missing proof/evidence requirements. Invalid-only evidence cannot satisfy required evidence.

## Verification

Current tests prove:

- pass with matching proof and fresh evidence;
- iterate with missing proof;
- fail with absent proof and absent evidence;
- stale and lease-mismatched evidence are rejected and cannot satisfy required evidence;
- target lease failures become issue codes;
- failed steps prevent pass.
- empty proof contracts cannot pass with no accepted evidence;
- non-succeeded step proof deltas do not satisfy done criteria;
- target leases must be present and bound to the run when the run has a target lease pointer.
