# Autonomous Review Lane Persistence

## Purpose

Persist bounded review-lane verdict metadata for autonomous runs. This closes the gap between the pure scheduler/pet bridge and durable state: review workers or advisors can later write compact lane outcomes without storing prompts, transcripts, sessions, URLs, raw reviewer prose, or command output.

This slice is pure `core/run` storage, types, tests, and docs. It does not dispatch review workers, call Grok or Oracle, touch Chrome/runtime files, mutate prompt contracts, or change worker/orchestrator policy.

## Durable Record

Review lane records are stored in the autonomous run ledger keyed by `runId` with generated lane ids and per-run sequence numbers.

Stored fields are safe metadata only:

- role: implementer, reviewer, safety, UX, Oracle, Grok, or other
- status: idle, running, passed, blocked, or failed
- grade
- recommendation
- highest priority
- issue count
- evidence reference count
- bounded redacted summary

The store ignores raw prompts, sessions, transcripts, reviewer prose, URLs, tool output, and arbitrary extra fields.

## Contract Coverage Table

| id | required behavior | assertion / location | status |
|----|-------------------|----------------------|--------|
| 1 | Add durable review-lane record and create-input types | `npm run compile` validates `AutonomousReviewLaneRecord` and `AutonomousReviewLaneCreateInput` callers | covered |
| 2 | Persist lane records with generated ids, per-run sequence, and chronological retrieval | `appends compact durable review lane records in sequence and returns stored state exactly` | covered |
| 3 | Returned append result and durable stored state agree exactly | same sequence test and privacy probe compare append result with `getAutonomousRunReviewLanes(run.id)` | covered |
| 4 | Store only bounded verdict metadata and no raw advisor payloads | `privacy probe: sanitizes raw advisor fields from returned and durable lane JSON` | covered |
| 5 | Unknown roles collapse to `other` without leaking raw role text | privacy probe asserts raw `SECRET_ROLE` is absent and role is `other` | covered |
| 6 | Contradictory passing data with P1/P2 or `block` recommendation fails closed to blocked | `normalizes malformed lane records and fails contradictory passing data closed` | covered |
| 7 | Malformed statuses, grades, recommendations, priorities, and counts fail closed or normalize to safe defaults | same malformed test | covered |
| 8 | Missing or terminal runs do not accept new lane records | `returns null for missing or terminal runs and clears lane records when replacing a run id` | covered |
| 9 | Replacing a run id clears old review-lane rows for that id | same replacement test | covered |
| 10 | No Chrome/background/runtime/prompt files are touched | staged file list and `git diff --check`; prompt freeze may still show known pre-existing hash drift only | covered |

## Adversarial Probe

The privacy probe passes a record with a secret-looking role, raw prompt/session/transcript/reviewer prose fields, private URLs, bearer tokens, durable ids, and raw-output words. The returned record and durable storage JSON must omit those strings while retaining safe metadata and redaction markers.

The false-positive success probe compares every appended record to durable retrieval. A returned object that differs from storage does not count as success.

## Scope Caveat

This slice persists lane outcomes only. It does not launch reviewers, attach external agents, feed lane records into orchestrator policy, or expose the records in the pet. Those are separate consumer/runtime slices.

## Verification

Run:

```sh
npm test -- tests/run-review-lane-store.test.ts
npm test -- tests/run-review-lane-store.test.ts tests/run-review-scheduler.test.ts tests/run-orchestrator.test.ts tests/pet-control.test.ts tests/pet-orchestrator-bridge.test.ts
npm run compile
git diff --check
```

`npm run prompt:freeze` remains expected to fail on pre-existing prompt hash drift until the dedicated prompt snapshot reconciliation slice.

## Self Review

Grade target: A. This is durable metadata plumbing only, with no live advisor dispatch or runtime wiring claims.
