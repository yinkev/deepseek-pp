# Autonomous Iteration Controller

## Purpose

This slice adds the deterministic gate that a real worker loop must call after each implementation attempt:

```ts
reviewAutonomousRunIteration(input)
```

It does not run models, call tools, invoke browser actions, spawn subagents, or mutate storage.

## Call

After an implementation step, the worker must evaluate, review, grade, and decide the next state from local evidence:

1. run the completion reviewer to produce grade, score, issue codes, and accepted evidence;
2. reject no-progress and repeated-error loops before another iteration;
3. succeed only when completion review passes;
4. fail only when completion was explicitly claimed and review fails;
5. block empty proof contracts because unattended work without done criteria is ungoverned;
6. otherwise keep the run running and iterate.

Passing completion review takes precedence over no-progress checks. A run with sufficient accepted evidence should finish even if trailing bookkeeping steps did not add proof.

For no-progress detection, the iteration gate does not trust arbitrary self-reported progress. It counts only implementation step proof deltas that match the run's done criteria or evidence refs that match accepted fresh evidence ids.
Review and checkpoint steps are bookkeeping and never reset no-progress detection.

## Actions

The iteration gate returns:

- `succeed` with `nextStatus: succeeded` when completion proof passes;
- `fail` with `nextStatus: failed` when completion was claimed but review fails;
- `block` with `nextStatus: blocked` for no-progress, repeated-error, or empty-proof failures;
- `iterate` with `nextStatus: running` for recoverable incomplete work;
- `noop` for terminal or non-running runs.

## Why This Exists

The worker loop needs one non-negotiable rule:

```txt
implementation -> evaluation -> review -> grade -> iterate/succeed/fail/block
```

Without this gate, the system can drift into a supervised helper or a model-text completion claim. This controller keeps iteration mechanical and auditable before Chrome/background wiring resumes.

## Subagent Boundary

Subagents, Oracle, and external advisors can contribute implementation or review notes later. They do not decide run status.

Their outputs must be converted into ledger steps, evidence records, or proof deltas, then this gate makes the status decision from current local evidence.

## Verification

Current tests prove:

- passing completion review becomes `succeed`;
- passing completion beats trailing no-progress bookkeeping;
- incomplete work without a completion claim becomes `iterate`;
- failed claimed completion becomes `fail`;
- no-progress loops become `block`;
- bogus progress scores, unrelated proof deltas, and unaccepted evidence refs still become `block`;
- review/checkpoint bookkeeping does not count as verified progress;
- repeated same-error loops become `block`;
- empty proof contracts become `block` with a non-retryable error;
- terminal and non-running runs produce `noop`.
