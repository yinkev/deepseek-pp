# Autonomous Worker Instructions

## Call

Build DeepSeek++ toward an autonomous worker system. The pet is the cockpit for worker state, not the main product.

Oracle is an advisor only. Treat Oracle output like peer review: useful when coherent, ignored when wrong, never authoritative.

## Operating Default

Agents should keep working without user supervision when work is safe, scoped, and verifiable.

Do not stop for small choices. Make the technical call, state assumptions in the run output, implement the smallest coherent slice, verify it, review it, grade it, iterate once if needed, then continue or hand off.

Ask the user only when the next action is unsafe, irreversible, account-affecting, secret-affecting, public-publishing, destructive outside the project, or architecturally ambiguous in a way that changes the product.

## Product Direction

DeepSeek++ should become:

- An autonomous local/browser-side worker system.
- A resumable run loop with checkpoints, evidence, budgets, review gates, and failure recovery.
- A system that can plan, implement, test, evaluate, review, grade, iterate, and continue without constant supervision.
- A system where pet/control UI exposes state, evidence, blockers, next action, and handoff.

DeepSeek++ should not become:

- A supervised helper that waits for the user after every step.
- A mascot-first product.
- A second sidepanel.
- A prompt-only safety layer.
- A hidden actor that mutates browser/account/local state without policy gates.
- A system that treats Oracle or any advisor as authority.

## Long-Term Goal

Build DeepSeek++ into a self-governing autonomous worker control plane:

- durable run state is the source of truth;
- each implementation slice has an explicit contract coverage table;
- result objects must agree with durable stored state before success is trusted;
- independent P1/P2 review blocks the next slice;
- the pet becomes the compact cockpit for state, blockers, evidence, review gates, and safe controls;
- Chrome/runtime mutation stays frozen until explicitly resumed.

The operating default is autonomy, not supervision. The user should not be the relay, evaluator, or babysitter. Agents and workers should continue through safe, scoped, verifiable slices until a real blocker appears.

The active execution roadmap is maintained in `docs/plan/autonomous-worker-roadmap.md`. That roadmap is the source of truth for step order, commit boundaries, quality gates, and the next worker prompt.

## Execution Loop

For each autonomous work cycle:

1. Inspect repo state.
2. Pick the smallest useful slice.
3. State assumptions.
4. Implement.
5. Run narrow verification first.
6. Run broader verification when shared/runtime behavior changes.
7. Review correctness, safety, UX, maintainability, storage/leak risk, prompt-freeze risk, and browser mutation risk.
8. Grade A-F.
9. If below A and fixable in scope, iterate once.
10. Record exact next action and blockers.
11. Continue when safe.

## Human Escalation

Stop and ask before:

- Deleting files outside the active project scope.
- Touching secrets, auth, browser accounts, payment, purchases, publishing, deploys, or public release.
- Broad destructive shell commands.
- Browser mutations on ambiguous or stale targets.
- Changing frozen prompt-output contracts.
- Adding new external services or dependencies without clear need.
- Taking any action where rollback is unclear.

## Architecture Priority

Priority order:

1. Run kernel / autonomous worker loop.
2. Durable run ledger and checkpoints.
3. Target lease and evidence freshness.
4. Tool policy, budgets, stop conditions, and no-progress detection.
5. Review/evaluate/grade/iterate gates.
6. Subagent worker/reviewer lanes.
7. Pet cockpit over autonomous worker state.
8. UI polish.

## Nine Major Tracks

1. Durable iteration apply and run-state mutation discipline.
   - Status: complete.
   - Accomplish by keeping review/apply inside storage mutation locks, appending metadata-only review steps, and proving terminal transitions agree with durable state.
   - Gate: iteration/store tests, no-progress filtering tests, compile, commit, independent review.

2. Worker prompt contract and quality gate.
   - Status: complete.
   - Accomplish by generating deterministic worker prompts that always require Evaluate, Review, Grade, Iterate, contract coverage, false-positive success probing, self-grade, commit, and XML reporting.
   - Gate: prompt snapshot tests, marker tests, no Chrome/runtime edits.

3. Contract coverage and result-state consistency.
   - Status: complete as of `d119af5`.
   - Accomplish by producing pure reviewers for required behavior coverage and result/durable-state agreement, including malformed-result adversarial cases.
   - Gate: focused consistency/coverage tests, adjacent worker/orchestrator tests, full serial suite, independent P1/P2 review.

4. Durable quality-gate persistence.
   - Status: complete for durable store API, normalized quality-gate records, and first-class contract coverage automation.
   - Implemented by storing compact gate results for each run/iteration: contract coverage rows and counts, false-positive probe status, result-state consistency verdict, self-review grade, verification commands, commit hash, and independent review status.
   - Gate: missing coverage rows, conflicts, failed false-positive probe, state inconsistency, failed verification, or independent P1/P2 review blocks advancement; raw IDs/secrets stay out of gate summaries.

5. Orchestrator enforcement.
   - Status: complete for pure core orchestration; Chrome/runtime caller wiring remains frozen.
   - Implemented by making the pure orchestrator consult persisted quality gates before advancing the selected runnable run.
   - Gate: P1/P2 review state blocks the core cycle; green gate allows continuation; no Chrome/runtime wiring.

6. Review-lane worker coordination.
   - Status: complete for the pure review dispatch contract; actual live worker dispatch remains runtime-frozen.
   - Implemented by formalizing implementer, reviewer, safety, UX, and Oracle/Grok advisor lanes as bounded metadata, durable review-lane outcome records, pure scheduler/orchestrator gate input, and pet-visible safe plan projection.
   - Remaining work: live dispatch only after runtime work resumes.
   - Gate: lane outputs are summarized as verdict/evidence only; no raw transcripts or advisor authority leaks.

7. Autonomous telemetry and repo-visible handoff.
   - Status: partially complete; marker-based telemetry writing, pet telemetry projection, quality-gate projection, and orchestrator-cycle-to-pet bridge are implemented.
   - Accomplish by exporting complete, marker-based telemetry packages and handoff capsules that reflect post-cycle durable state.
   - Gate: `.complete.json` marker required, writer failures safe, package summaries agree with durable state.

8. Pet cockpit projection.
   - Status: complete for the pure projection contract; UI/runtime wiring remains frozen.
   - Implemented by projecting run status, run queue, scheduler/watchdog verdict, evidence freshness, target lease pulse, proof debt, blocker lens, review heat, stop-line, memory pressure, worker-cycle, telemetry, quality-gate row/probe status, bounded review lanes, review-lane gate, projection fidelity, and handoff capsule state into safe pet snapshot/handoff fields.
   - Gate: pet surfaces expose safe metadata only and never trigger browser/file mutation by themselves.

9. Controlled runtime resume.
   - Status: complete for the pure resume guard; runtime wiring remains blocked until the user explicitly resumes Chrome/runtime work.
   - Implemented by requiring explicit durable `chrome_runtime` authorization, a complete resume checklist, no pre-authorization runtime file changes, and no unresolved independent P1/P2 review findings.
   - Gate: no `entrypoints/background.ts` change until the resume guard authorizes Step 10; runtime smoke required before claiming live autonomy.

## Subagent Use

Use subagents as workers/reviewers when useful:

- Claude for code review, repo-fit review, architecture critique.
- Grok through approved/local proxy paths for edge-case review or alternate critique.
- Do not use reverse-engineered web APIs unless the user explicitly asks.
- Treat every subagent result as advisory. Verify with local code/tests.

## Evidence Standard

Do not claim done from model text alone.

Completion needs evidence:

- Passing tests/builds/checks.
- File diffs.
- Command output.
- Runtime smoke when claiming live behavior.
- Explicit unverified caveat when live proof was not run.

## Persistent Rule

When the user speaks imprecisely, reconstruct the strongest buildable objective and proceed. The default objective is autonomous worker progress, not another discussion loop.
