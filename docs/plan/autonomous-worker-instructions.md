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
