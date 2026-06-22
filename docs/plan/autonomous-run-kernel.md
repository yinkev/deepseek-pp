# Autonomous Run Kernel Foundation

## Purpose

DeepSeek++ needs one durable worker substrate before deeper pet cockpit work can be truthful.

This slice creates the first foundation:

- typed autonomous run records;
- durable run ledger in `chrome.storage.local`;
- checkpoint storage for resumability after MV3 service-worker shutdown;
- metadata-only step records;
- pure no-progress / repeated-error review logic.

It does not execute model turns, tools, browser actions, shell commands, sidepanel UI, or startup reconciliation wiring.

## Authority

The run ledger becomes the source of truth for autonomous worker progress when callers use the store APIs.

Automation, inline-agent, sidepanel chat, and future browser worker flows should eventually route through this run model or adapt into it. Until then, this module is isolated and safe.

Store writes are serialized through a mutation lock. The store uses the browser Web Locks API when available, with a module-local queue fallback for the active extension context.

## Storage Contract

Storage key:

```txt
deepseek_pp_autonomous_runs_v1
```

Stored shape:

```ts
{
  version: 1,
  runs: AutonomousRun[],
  steps: AutonomousRunStep[]
}
```

The store keeps metadata only. It redacts durable strings and nested details with the existing tool redaction helper.
`error.details` is bounded by depth, key count, array length, string length, and total serialized size.

Never store:

- auth headers;
- cookies;
- API keys;
- raw screenshots;
- raw Vision refs;
- raw tool payloads;
- signed URLs;
- large model transcripts.

## Run Lifecycle

Allowed status transitions:

```txt
queued -> running | paused | blocked | cancelled
running -> paused | blocked | succeeded | failed | cancelled
paused -> running | blocked | cancelled
blocked -> running | failed | cancelled
terminal -> terminal only
```

Terminal statuses:

```txt
succeeded
failed
cancelled
```

## Checkpoint Contract

Every run carries a checkpoint:

```ts
{
  providerConversationId,
  parentMessageId,
  latestStepId,
  resumableSummary,
  unresolvedQuestions
}
```

This checkpoint is the durable bridge across worker restarts. Correctness must not depend on globals.
This slice only exposes `reconcileInterruptedAutonomousRuns`; a later orchestration slice must call it during worker startup.

## Progress Contract

`reviewAutonomousRunProgress` blocks a run when:

- the last `maxConsecutiveNoProgress` completed steps have no progress score, proof delta, or evidence refs;
- the same normalized error repeats `maxSameErrorRepeats` times.
  A successful or no-error step breaks the repeated-error chain.

This is only detection. Actual orchestration comes later.

## Verification

Current slice must prove:

- run create/read/update persists through storage;
- steps append in sequence;
- checkpoint updates survive reload;
- interrupted running runs reconcile to blocked;
- concurrent step appends preserve all ledger entries;
- terminal runs reject late steps/checkpoint edits;
- no-progress and repeated-error detection work;
- stored JSON redacts secret/media/Vision-like data;
- stored error details stay bounded;
- no globals are needed for correctness.
