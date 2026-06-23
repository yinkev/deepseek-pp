# Autonomous Worker Roadmap

## Call

Build DeepSeek++ Pet into a self-governing autonomous worker control plane, not a supervised helper.

The end state is a local/browser agent loop that can pick scoped work, implement, evaluate, review, grade, iterate, persist evidence, survive restart, surface blockers, and continue until a real stop condition appears. The pet is the cockpit over this loop. It is not the main product and it is not a second sidepanel.

Oracle, Grok, Claude, Hermes, and other agents are advisory or worker lanes. None of them are authority. Durable repo-visible state, local tests, commits, contract coverage, and independent P1/P2 review decide progress.

## Current State

- Worktree: this checkout's repository root. Agents should resolve it from their current working directory or an injected `REPO_ROOT`; do not hard-code a personal absolute path into reusable prompts.
- Branch: `codex/deepseek-pet`.
- Latest verified autonomous commit before the scheduler/watchdog implementation slice: `319b27c Adversarial probe: contradictory gates fail closed at unit and worker level`.
- Frozen until explicit user resume: `entrypoints/background.ts`, Chrome/runtime wiring, and live browser mutation.
- Completed pure-core foundation: durable iteration apply, worker prompt quality gate, contract coverage, result-state consistency, quality-gate persistence, pure orchestrator enforcement, review-lane persistence/gate consumption, telemetry handoff summary, pet cockpit projections, worker-level scheduler watchdog preflight, startup reconciliation for invalid target leases, repo-visible restart telemetry handoff, pet projection fidelity audit, and autonomous safety/redaction summaries.

  Review-lane gate-input blocking logic was consolidated into a single shared implementation in core/run/review-lane-gate.ts (isBlockingGateInput + normalizeReviewLaneGate) with full contract coverage and adversarial probes.

## Advisory Fan-Out Synthesis

Codex launched twelve Grok CLI advisory workers across roadmap, orchestration, worker queue, review lanes, pet cockpit, telemetry/restart, safety, tests, failure modes, integration, novel features, and sequencing.

Their output is not authority. Codex accepted only the parts that matched committed repo state, existing plan docs, and local code inspection.

Accepted findings:

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
| 1 | Restartable scheduler/watchdog contract | Add a pure liveness gate around the existing run/orchestrator flow: lease age, evidence age, no-progress count, retry budget, pause/resume flag, and review-lane blocker state. Keep it in `core/run/*`; do not wire runtime. Implementation surface: `core/run/scheduler-watchdog.ts` plus worker preflight integration. | Unit tests for stale lease, stale evidence, repeated no-progress, review blocker, pause, terminal no-op, and result/durable agreement. | `Add autonomous scheduler watchdog contract` |
| 2 | Lease/retry/restart reconciliation | Harden startup reconciliation so interrupted, stale, or expired active work becomes blocked/retryable with durable error metadata before new work is selected. Implementation surface: `reconcileInterruptedAutonomousRuns` blocks running runs with missing, inactive, or expired target leases before selection. | Store/orchestrator tests proving expired leases reconcile before selection and terminal runs stay terminal. | `Harden autonomous restart reconciliation` |
| 3 | Repo-visible restart telemetry | Extend telemetry writer/package so restart handoff includes scheduler gate, watchdog verdict, retry posture, unresolved blockers, and last safe checkpoint. | Telemetry writer tests for `.complete.json`, path safety, privacy, and handoff fields agreeing with durable state. | `Add restartable telemetry handoff` |
| 4 | Projection fidelity auditor | Measure pet cockpit projection fidelity against durable state after each pure cycle. Persist score, drift count, and gate-impact metadata. This is the selected novel feature. | Pet/orchestrator bridge tests where injected projection drift fails the fidelity probe and clean projections pass. | `Add pet projection fidelity audit` |
| 5 | Safety policy and redaction gate | Add a pure deny-by-default policy summary for autonomous actions and privacy redaction flags for telemetry/pet exports. No raw prompts, transcripts, target labels, URLs, or secrets should leak. | Privacy false-positive probes across telemetry, quality gates, review lanes, and pet handoff. | `Add autonomous safety policy gate` |
| 6 | Pure review dispatch contract | Define the dispatch contract for implementer/reviewer/safety/UX/Grok/Oracle lanes without actually invoking runtime workers. Persist planned lane metadata and required result shape. | Scheduler/review-lane tests for planned lanes, blocker propagation, and no raw transcript leakage. | `Add pure review dispatch contract` |
| 7 | Contract coverage automation | Make the contract coverage table a first-class artifact for every slice: coverage rows, false-positive probe status, verification commands, self-grade, independent review status. | Quality-gate store tests proving coverage gaps or conflicts block advancement. | `Enforce autonomous contract coverage records` |
| 8 | Pet cockpit completion by projection | Complete the safe metadata cockpit contract first: run posture, scheduler gate, watchdog, telemetry handoff, quality gate, review lane gate, fidelity score, and stop-line state. UI wiring waits until runtime/Chrome resume if needed. | Pure pet-control and handoff tests. No content/background changes in this slice. | `Complete pet cockpit projection contract` |
| 9 | Controlled runtime resume checklist | Write the explicit resume gate: required commands, runtime smoke, Chrome safety checks, manual user instruction record, rollback path, and P1/P2 review requirements. | Documentation plus pure guard tests where resume remains blocked without explicit durable authorization. | `Document controlled runtime resume gate` |
| 10 | Runtime wiring after explicit resume | Only after user resumes Chrome/runtime work, connect the proven pure loop to background/runtime dispatch. This is where `entrypoints/background.ts` becomes eligible. | Runtime smoke, Chrome extension build, live sidepanel/pet verification, full relevant suite, independent review. | `Wire autonomous runtime dispatch` |

## Step Execution Specs

### Step 1: Restartable Scheduler/Watchdog Contract

- Files: `core/run/orchestrator.ts`, `core/run/worker.ts`, `core/run/target.ts`, `core/run/store.ts`, optionally a new `core/run/scheduler-watchdog.ts`, plus `tests/run-orchestrator.test.ts`, `tests/run-worker.test.ts`, `tests/run-target-store.test.ts`.
- Contract: pure function derives `canContinue`, `mustBlock`, `mustRetry`, or `terminalNoop` from run status, target lease freshness, evidence freshness, no-progress count, retry budget, pause flag, terminal state, quality gate, and review-lane blocker records.
- Acceptance: a returned scheduler/watchdog verdict must match the durable run state after apply; an injected mismatch must fail a test.
- Slice doc: `docs/plan/autonomous-scheduler-watchdog.md`.

### Step 2: Lease/Retry/Restart Reconciliation

- Files: `core/run/store.ts`, `core/run/orchestrator.ts`, `tests/run-store.test.ts`, `tests/run-orchestrator.test.ts`, `tests/run-target-store.test.ts`.
- Contract: startup reconciliation converts interrupted or stale running state into explicit blocked/retryable durable records before any new run is selected.
- Acceptance: expired leases reconcile before selection; terminal runs never reacquire leases; retry exhaustion becomes a durable blocker.
- Slice doc: `docs/plan/autonomous-restart-reconciliation.md`.

### Step 3: Repo-Visible Restart Telemetry

- Files: `core/run/telemetry.ts`, `core/run/telemetry-writer.ts`, `tests/run-telemetry.test.ts`, `tests/run-telemetry-writer.test.ts`, `docs/plan/run-telemetry-package.md`.
- Contract: `handoff.json` and `.complete.json` expose scheduler/watchdog state, retry posture, unresolved blockers, and latest safe checkpoint through safe package-local handles only.
- Acceptance: package summary fails if durable state is failed or blocked even when command metadata says pass; no raw durable IDs, prompts, target labels, URLs, or transcripts leak.

### Step 4: Projection Fidelity Auditor

- Files: `core/pet/control.ts`, `core/run/orchestrator.ts`, `tests/pet-control.test.ts`, `tests/pet-orchestrator-bridge.test.ts`.
- Contract: compare pet cockpit projections against durable run state and persist a compact fidelity verdict, drift count, and gate-impact signal.
- Acceptance: injected projection drift fails; clean projection passes; handoff projection agrees with stored fidelity state.

### Step 5: Safety Policy And Redaction Gate

- Files: `core/run/policy.ts`, `core/run/telemetry.ts`, `core/pet/control.ts`, `core/run/worker-prompt.ts`, relevant tests under `tests/run-policy.test.ts`, `tests/run-telemetry.test.ts`, `tests/pet-control.test.ts`, `tests/run-worker-prompt.test.ts`, plus `docs/plan/autonomous-safety-policy-gate.md`.
- Contract: deny-by-default autonomous action summaries and privacy redaction flags are enforced before telemetry, review lanes, worker prompts, or pet handoff export raw state.
- Acceptance: secret-like text and raw user content are present in source fixtures and absent from exported telemetry/pet/review records.

### Step 6: Pure Review Dispatch Contract

- Files: `core/run/review-scheduler.ts`, `core/run/review-lane-gate.ts`, `core/run/worker-prompt.ts`, `tests/run-review-scheduler.test.ts`, `tests/run-worker-prompt.test.ts`, `tests/run-review-lane-store.test.ts`.
- Contract: describe planned implementer/reviewer/safety/UX/Grok/Oracle lanes, their allowed outputs, and their blocker semantics without invoking live workers.
- Acceptance: lane plans persist compact metadata, raw transcripts do not leak, and P1/P2 or failed/blocked lanes prevent advancement.

### Step 7: Contract Coverage Automation

- Files: `core/run/contract-coverage.ts`, `core/run/result-consistency.ts`, `core/run/store.ts`, `tests/run-contract-coverage.test.ts`, `tests/run-result-consistency.test.ts`, `tests/run-quality-gate-store.test.ts`.
- Contract: every slice quality gate stores coverage rows, result-state consistency, self-grade, verification summary, commit hash, and independent review status.
- Acceptance: missing coverage rows, conflicts, result-state mismatch, failed review, or P1/P2 review blocks advancement.

### Step 8: Pet Cockpit Projection Contract

- Files: `core/pet/control.ts`, `tests/pet-control.test.ts`, `tests/pet-orchestrator-bridge.test.ts`.
- Contract: pet snapshot exposes only safe metadata for run posture, scheduler/watchdog gate, telemetry handoff, quality gate, review lane gate, fidelity score, and stop-line state.
- Acceptance: projection tests prove no raw labels, prompts, URLs, transcripts, target IDs, or secret-like strings leak.

### Step 9: Controlled Runtime Resume Gate

- Files: docs plus pure guard tests if a guard type is added.
- Contract: the current Chrome/runtime freeze is a user-imposed active blocker, not permanent supervision. Pure-core work continues autonomously. Runtime wiring begins only after the user explicitly lifts this current freeze.
- Acceptance: any resume state without an explicit durable resume authorization remains blocked.

### Step 10: Runtime Wiring After Freeze Is Lifted

- Files: `entrypoints/background.ts` and Chrome/runtime surfaces become eligible only in this step.
- Contract: connect the proven pure scheduler, gates, telemetry, and review lanes to live runtime dispatch.
- Acceptance: extension build, runtime smoke, live pet/sidepanel verification, full relevant tests, contract coverage, false-positive probe, and independent P1/P2 review all pass.

## Immediate Next Worker Slice

Step 6 is the next implementation slice.

Default worker prompt:

```xml
<worker_task>
  <repo_root>resolve from current checkout or injected REPO_ROOT</repo_root>
  <branch>codex/deepseek-pet</branch>
  <slice>pure-review-dispatch-contract</slice>
  <scope>
    Work only in pure autonomous core and pet/control-plane files under core/run, core/pet, tests, and docs.
    Do not touch entrypoints/background.ts, Chrome/runtime wiring, or live browser behavior.
  </scope>
  <objective>
    Add the pure review dispatch contract.
    Define planned implementer, reviewer, safety, UX, Grok, and Oracle lanes without invoking live workers.
    Persist or project only compact planned-lane metadata and the required result shape.
    P1/P2, failed, blocked, or block-recommendation lanes must prevent advancement.
    Raw prompts, transcripts, reviewer prose, provider IDs, session URLs, and secret-like source fields must not leak.
  </objective>
  <quality_gate>
    <item>Before committing, build a contract coverage table: each required behavior must map to at least one test assertion or be explicitly marked not testable in this slice.</item>
    <item>Run one adversarial probe for false-positive success: prove the result object and durable stored state agree.</item>
    <item>Self-review after verification and assign grade A-F.</item>
    <item>If grade is below A, iterate once before committing.</item>
    <item>After commit, expect an independent adversarial review; do not start the next slice if a P1/P2 is found.</item>
  </quality_gate>
  <verification>
    <command>npm test -- tests/run-review-scheduler.test.ts tests/run-worker-prompt.test.ts tests/run-review-lane-store.test.ts tests/run-orchestrator.test.ts</command>
    <command>npm run compile</command>
    <command>npm test</command>
    <command>git diff --check</command>
    <command>git diff --name-only HEAD -- entrypoints/background.ts</command>
  </verification>
  <report_format>XML final report with changed files, contract coverage, false-positive probe, verification, self-grade, commit hash, blockers, and next recommendation.</report_format>
</worker_task>
```

## Contract Coverage For This Roadmap Slice

| Required Behavior | Coverage |
| --- | --- |
| Use multiple Grok workers as advisory lanes. | Session evidence only; not a repo behavior and not used as proof of correctness. |
| Preserve runtime/background freeze. | Roadmap states freeze and marks runtime wiring as Step 10 only. |
| Choose one next default implementation slice. | `Immediate Next Worker Slice` selects pure review dispatch contract. |
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
- Independent review then found P1/P2 issues: hardcoded path, advisory wording that sounded authoritative, runtime freeze wording that implied permanent user supervision, and underspecified later steps.
- This revision removes the reusable hardcoded path, reframes Grok as advisory only, clarifies that the runtime freeze is the current user-imposed blocker while pure-core autonomy continues, and adds file-level execution specs for every roadmap step.

Reason: the roadmap is concrete, repo-shaped, respects the frozen runtime boundary, chooses one default next implementation slice, includes the required quality gate, and separates established repo state from advisory model output. No P1/P2 blocker remains in this documentation slice.
