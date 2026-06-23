# Autonomous Worker Roadmap

## Call

Build DeepSeek++ Pet into a self-governing autonomous worker control plane, not a supervised helper.

The end state is a local/browser agent loop that can pick scoped work, implement, evaluate, review, grade, iterate, persist evidence, survive restart, surface blockers, and continue until a real stop condition appears. The pet is the cockpit over this loop. It is not the main product and it is not a second sidepanel.

Oracle, Grok, Claude, Hermes, and other agents are advisory or worker lanes. None of them are authority. Durable repo-visible state, local tests, commits, contract coverage, and independent P1/P2 review decide progress.

## Current State

- Worktree: `/Users/kyin/Projects/deepseek-pp-pet`.
- Branch: `codex/deepseek-pet`.
- Latest verified autonomous commit before this roadmap: `100eb30 Align review lane gate predicates`.
- Frozen until explicit user resume: `entrypoints/background.ts`, Chrome/runtime wiring, and live browser mutation.
- Completed pure-core foundation: durable iteration apply, worker prompt quality gate, contract coverage, result-state consistency, quality-gate persistence, pure orchestrator enforcement, review-lane persistence/gate consumption, telemetry handoff summary, pet cockpit projections.

## Grok Fan-Out Synthesis

Codex launched twelve Grok CLI advisory workers across roadmap, orchestration, worker queue, review lanes, pet cockpit, telemetry/restart, safety, tests, failure modes, integration, novel features, and sequencing.

Consensus:

- Do not keep adding standalone gate abstractions.
- The next meaningful layer is restartable scheduler/watchdog behavior in pure core.
- Result objects and durable stored state must agree after every mutation.
- Review-lane blockers must keep blocking until explicitly resolved.
- Runtime resume is a later gated slice, not an implicit next step.
- The strongest unconventional feature to carry forward is a projection fidelity auditor: the pet cockpit projection itself becomes a measured contract against durable state.

Rejected or downgraded:

- Worker proposals that invented new `src/` paths instead of matching this repo's `core/run` and `core/pet` layout.
- Any plan that edits `entrypoints/background.ts` before explicit runtime resume.
- Any plan that treats model output as proof without durable state and tests.

## Non-Negotiable Loop

Every implementation slice must follow this order:

1. Inspect current repo state.
2. Define the slice contract.
3. Map required behavior to tests or explicitly mark it not testable in this slice.
4. Implement the smallest useful change.
5. Run narrow verification.
6. Run broader verification when shared behavior changed.
7. Probe false-positive success by comparing returned result objects with durable stored state.
8. Self-review and grade A-F.
9. If below A, iterate once before committing.
10. Commit only that slice.
11. Run independent adversarial review.
12. Do not start the next slice while P1/P2 findings remain unresolved.

## Roadmap

| Step | Slice | How To Accomplish It | Verification | Commit Boundary |
| --- | --- | --- | --- | --- |
| 1 | Restartable scheduler/watchdog contract | Add a pure liveness gate around the existing run/orchestrator flow: lease age, evidence age, no-progress count, retry budget, pause/resume flag, and review-lane blocker state. Keep it in `core/run/*`; do not wire runtime. | Unit tests for stale lease, stale evidence, repeated no-progress, review blocker, pause, terminal no-op, and result/durable agreement. | `Add autonomous scheduler watchdog contract` |
| 2 | Lease/retry/restart reconciliation | Harden startup reconciliation so interrupted, stale, or expired active work becomes blocked/retryable with durable error metadata before new work is selected. | Store/orchestrator tests proving expired leases reconcile before selection and terminal runs stay terminal. | `Harden autonomous restart reconciliation` |
| 3 | Repo-visible restart telemetry | Extend telemetry writer/package so restart handoff includes scheduler gate, watchdog verdict, retry posture, unresolved blockers, and last safe checkpoint. | Telemetry writer tests for `.complete.json`, path safety, privacy, and handoff fields agreeing with durable state. | `Add restartable telemetry handoff` |
| 4 | Projection fidelity auditor | Measure pet cockpit projection fidelity against durable state after each pure cycle. Persist score, drift count, and gate-impact metadata. This is the selected novel feature. | Pet/orchestrator bridge tests where injected projection drift fails the fidelity probe and clean projections pass. | `Add pet projection fidelity audit` |
| 5 | Safety policy and redaction gate | Add a pure deny-by-default policy summary for autonomous actions and privacy redaction flags for telemetry/pet exports. No raw prompts, transcripts, target labels, URLs, or secrets should leak. | Privacy false-positive probes across telemetry, quality gates, review lanes, and pet handoff. | `Add autonomous safety policy gate` |
| 6 | Pure review dispatch contract | Define the dispatch contract for implementer/reviewer/safety/UX/Grok/Oracle lanes without actually invoking runtime workers. Persist planned lane metadata and required result shape. | Scheduler/review-lane tests for planned lanes, blocker propagation, and no raw transcript leakage. | `Add pure review dispatch contract` |
| 7 | Contract coverage automation | Make the contract coverage table a first-class artifact for every slice: coverage rows, false-positive probe status, verification commands, self-grade, independent review status. | Quality-gate store tests proving coverage gaps or conflicts block advancement. | `Enforce autonomous contract coverage records` |
| 8 | Pet cockpit completion by projection | Complete the safe metadata cockpit contract first: run posture, scheduler gate, watchdog, telemetry handoff, quality gate, review lane gate, fidelity score, and stop-line state. UI wiring waits until runtime/Chrome resume if needed. | Pure pet-control and handoff tests. No content/background changes in this slice. | `Complete pet cockpit projection contract` |
| 9 | Controlled runtime resume checklist | Write the explicit resume gate: required commands, runtime smoke, Chrome safety checks, manual user instruction record, rollback path, and P1/P2 review requirements. | Documentation plus pure guard tests where resume remains blocked without explicit durable authorization. | `Document controlled runtime resume gate` |
| 10 | Runtime wiring after explicit resume | Only after user resumes Chrome/runtime work, connect the proven pure loop to background/runtime dispatch. This is where `entrypoints/background.ts` becomes eligible. | Runtime smoke, Chrome extension build, live sidepanel/pet verification, full relevant suite, independent review. | `Wire autonomous runtime dispatch` |

## Immediate Next Worker Slice

Step 1 is the next implementation slice.

Default worker prompt:

```xml
<worker_task>
  <repo>/Users/kyin/Projects/deepseek-pp-pet</repo>
  <branch>codex/deepseek-pet</branch>
  <slice>restartable-scheduler-watchdog-contract</slice>
  <scope>
    Work only in pure autonomous core files under core/run, tests, and docs.
    Do not touch entrypoints/background.ts, Chrome/runtime wiring, or live browser behavior.
  </scope>
  <objective>
    Add a pure scheduler/watchdog contract that prevents the autonomous loop from silently stalling.
    It must account for stale target leases, stale evidence, repeated no-progress, retry budget exhaustion,
    pause/resume gates, terminal runs, and unresolved review-lane blockers.
  </objective>
  <quality_gate>
    <item>Before committing, build a contract coverage table: each required behavior must map to at least one test assertion or be explicitly marked not testable in this slice.</item>
    <item>Run one adversarial probe for false-positive success: prove the result object and durable stored state agree.</item>
    <item>Self-review after verification and assign grade A-F.</item>
    <item>If grade is below A, iterate once before committing.</item>
    <item>After commit, expect an independent adversarial review; do not start the next slice if a P1/P2 is found.</item>
  </quality_gate>
  <verification>
    <command>npm test -- tests/run-orchestrator.test.ts tests/run-worker.test.ts tests/run-target-store.test.ts tests/pet-orchestrator-bridge.test.ts</command>
    <command>npm run compile</command>
    <command>git diff --check</command>
  </verification>
  <report_format>XML final report with changed files, contract coverage, false-positive probe, verification, self-grade, commit hash, blockers, and next recommendation.</report_format>
</worker_task>
```

## Contract Coverage For This Roadmap Slice

| Required Behavior | Coverage |
| --- | --- |
| Use multiple Grok workers as advisory lanes. | Tool run evidence in this Codex session; not repo-testable. |
| Preserve runtime/background freeze. | Roadmap states freeze and marks runtime wiring as Step 10 only. |
| Choose one next default implementation slice. | `Immediate Next Worker Slice` selects restartable scheduler/watchdog. |
| Include every major step and how to accomplish it. | `Roadmap` table lists ten steps with implementation method, verification, and commit boundary. |
| Include Evaluate, Review, Grade, Iterate quality gate. | `Non-Negotiable Loop` and worker XML prompt include the quality gate. |
| Include false-positive success probe. | Loop and worker prompt require result/durable agreement. |
| Include unconventional feature. | Step 4 selects projection fidelity auditor. |

## Self Review

Grade: A.

Iteration applied before commit:

- Initial grade was A- because Grok fan-out evidence and future implementation behavior are not repo-testable inside this documentation slice.
- The contract coverage table now marks those items explicitly as not repo-testable instead of implying test proof.
- The roadmap avoids code claims and makes Step 1 responsible for turning the next behavior into executable tests before implementation.

Reason: the roadmap is concrete, repo-shaped, respects the frozen runtime boundary, chooses one default next implementation slice, includes the required quality gate, and separates established repo state from advisory model output. No P1/P2 blocker remains in this documentation slice.
