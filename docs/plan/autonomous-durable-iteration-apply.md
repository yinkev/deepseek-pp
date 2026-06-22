# Autonomous Durable Iteration Apply

## Purpose

This slice turns the pure iteration gate into a durable ledger operation:

```ts
applyAutonomousRunIterationReview({ runId, completionClaimed, liveTarget }, now)
```

It reads the current normalized ledger inside the storage mutation lock, runs `reviewAutonomousRunIteration`, appends one review step when action is required, and updates run status in the same storage write.

It still does not execute models, tools, browser actions, subagents, or Chrome/background startup wiring.

## Durable Contract

For a running run:

- `succeed` appends a succeeded review step and transitions the run to `succeeded`;
- `fail` appends a failed review step and transitions the run to `failed`;
- `block` appends a failed review step and transitions the run to `blocked`;
- `iterate` appends a succeeded review step and keeps the run `running`;
- `noop` writes nothing.

For terminal or non-running runs, the controller returns the review but does not append a step or mutate status.

For missing runs, the controller returns `{ applied: false, run: null, step: null, review: null }`.

## Review Step

The review step records metadata only:

- phase `review`;
- status `succeeded` or `failed`;
- normalized score as `progressScore`;
- accepted evidence ids as `evidenceRefs`;
- issue-code refs as `observationRefs`;
- transition error only for `block` or `fail`.

It does not store raw evidence, model transcripts, screenshots, browser payloads, secrets, or advisor text.
Review steps are bookkeeping. Future no-progress checks must not treat review-step score or evidence refs as new implementation progress.

## Why Atomic

The review decision must be applied to the same ledger state it reviewed. Separate read, review, append, and transition calls can race with another worker update.

This operation runs under the existing serialized storage mutation path, so the reviewed steps/evidence/lease and the applied step/status transition are one durable update.

## Verification

Current tests prove:

- passing review records a review step and transitions to `succeeded`;
- incomplete unclaimed review records a review step and keeps the run `running`;
- no-progress review records a failed review step and transitions to `blocked`;
- terminal and missing runs do not append review steps;
- review application updates the checkpoint latest step id.
