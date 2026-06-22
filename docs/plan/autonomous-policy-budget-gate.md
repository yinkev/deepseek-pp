# Autonomous Policy And Budget Gate

## Purpose

The autonomous worker needs a deterministic preflight for each next action.

This slice adds a pure gate:

```ts
reviewAutonomousRunAction(run, steps, action, now)
```

It does not execute model turns, tools, browser actions, or memory writes.

## Decisions

The gate returns one of:

- `allow` - action may proceed;
- `manual_review` - action is possible but needs operator review;
- `deny` - action must not proceed.

Every non-allow result includes an `AutonomousRunError` with a policy or execution phase.

## Budget Rules

The gate denies when:

- the run is terminal;
- the run is not `running` for non-finish actions;
- wall-clock budget is exhausted;
- model-turn budget is exhausted;
- tool-call budget is exhausted;
- prompt bytes exceed `maxPromptBytesPerTurn`;
- observation bytes exceed `maxObservationBytesPerTurn`.

## Tool Policy Rules

The gate denies when:

- the descriptor is disabled;
- the tool is explicitly denied;
- an allowlist exists and the tool is not in it;
- a browser mutation tool lacks a verified active target lease;
- shell is disabled;
- shell is allowlisted but the Shell Local tool is absent from `allowedTools`;
- memory writes are disabled.

The gate returns `manual_review` when:

- the descriptor execution mode is `manual`;
- approval mode is `manual_all`;
- approval mode is `confirm_high_risk` and the descriptor risk is `high`;
- approval mode is `auto_low_risk` and descriptor risk is not `low`;
- shell mode is `manual`;
- memory policy is `propose`;
- memory policy is `auto_pinned_only` and the write is not marked pinned.

Memory policy applies to `memory_save`, `memory_update`, and `memory_delete`.
Shell policy applies to every Shell Local tool name, including non-prefixed tools like `local_skill_preview` and `local_folder_pick`.

## Target And Evidence Boundary

Browser mutation tools require `targetLeaseOk: true`.

The gate does not itself inspect Chrome tabs. Callers must first use `reviewAutonomousTargetLease` against the live browser target, then pass the result into this gate.

Evidence freshness remains separate: callers must use `reviewAutonomousEvidenceFreshness` before treating evidence as proof.

## Verification

Current tests prove:

- low-risk allowlisted tools are allowed;
- terminal and non-running actions are denied;
- wall/model/tool/prompt/observation budgets deny correctly;
- denied tools, allowlists, and disabled descriptors are enforced;
- browser mutations require a verified target lease;
- Shell Local and memory mutator policies route to deny or manual review;
- descriptor manual mode always routes to manual review;
- approval modes route risk correctly.
