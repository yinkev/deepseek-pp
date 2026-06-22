# Autonomous Target Lease And Evidence Freshness

## Purpose

Autonomous browser work needs a run-owned contract for two questions:

- Is this still the browser target this run is allowed to mutate?
- Is this evidence fresh enough to support a completion or verification claim?

This slice adds that contract without changing browser actions or orchestration.

## Target Lease

A target lease records:

- run id;
- tab id and window id;
- origin only, not full URL;
- label and redacted title;
- acquired, expiry, verification, and release times;
- status: `active`, `released`, `expired`, or `stale`.

When a run acquires a new lease, any previous active lease for that run is marked `stale` and expired at the acquisition time.

`reviewAutonomousTargetLease` accepts a lease only when:

- the lease exists and is active;
- it has not expired;
- the target tab exists and is controllable;
- tab id, window id, and origin still match.

Origin mismatch is treated as non-retryable because it means the run is about to act on a different site than it leased.

## Evidence Freshness

An evidence record stores metadata only:

- evidence id and run id;
- optional target lease id;
- observation kind;
- captured and expiry times;
- short summary;
- metadata refs;
- redacted source metadata.

It never stores raw screenshots, data URLs, signed URLs, cookies, auth headers, or full page URLs.
An explicit `leaseId: null` means the evidence is target-independent and must not be rebound to the run's current target lease.

`reviewAutonomousEvidenceFreshness` accepts evidence only when:

- the evidence exists;
- it has not expired and is not marked stale;
- the provided lease is active and unexpired;
- the lease id matches the active lease when a lease is provided;
- source tab/window still match the active lease when present;
- at least one metadata ref exists.

## Store APIs

The run store now owns:

- `upsertAutonomousTargetLease`;
- `releaseAutonomousTargetLease`;
- `getAutonomousTargetLeaseById`;
- `getAutonomousRunTargetLeases`;
- `appendAutonomousEvidenceRecord`;
- `getAutonomousRunEvidence`.

Replacing a run id clears stale steps, target leases, and evidence rows for that id.
Terminal runs reject late step, lease, and evidence writes.

## Verification

Current tests prove:

- active lease review accepts a matching target;
- expired, origin-mismatched, and uncontrollable targets are rejected;
- fresh evidence bound to a lease is accepted;
- stale, expired, mismatched, and ref-less evidence is rejected;
- stored leases normalize full URLs down to origins;
- stored evidence redacts secret/media/Vision-like refs;
- stored evidence preserves explicit target-independent `leaseId: null`;
- evidence review rejects inactive or expired leases;
- reacquiring a target stales the previous active lease;
- released leases clear the active run target pointer;
- replacing a run clears old lease/evidence rows.
