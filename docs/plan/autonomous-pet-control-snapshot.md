# Autonomous Pet Control Snapshot

## Purpose
This slice adds the first durable, render-safe `PetControlSnapshot` contract over the existing autonomous run cockpit. The pet cockpit (display layer) can now consume worker state without duplicating runtime, storage, or becoming a Chrome actor.

It is a pure reduction layer: no execution, no scheduling, no browser control, no policy, no memory, no prompts.

## Contract
```ts
export interface PetControlSnapshot {
  schemaVersion: 1;
  generatedAt: number;
  readiness: {
    status: 'ready' | 'needs_attention' | 'blocked';
    blockers: string[];
    preparing: boolean;
  };
  run: {
    active: boolean;
    label: string | null;
    phase: 'idle' | 'thinking' | 'speaking' | 'working' | 'reviewing' | 'blocked' | 'done';
    nextAction: string | null;
  };
  target: {
    locked: boolean;
    label: string | null;
    stale: boolean;
  };
  safety: {
    leakIssueCount: number;
    highRiskArmed: boolean;
  };
}

export function createPetControlSnapshotFromRunCockpit(
  snapshot: AutonomousRunCockpitSnapshot,
): PetControlSnapshot;

export async function getPetControlSnapshot(now?: number): Promise<PetControlSnapshot>;
```

- `getPetControlSnapshot` calls the existing `getAutonomousRunCockpitSnapshot(now)` and reduces.
- Pure reducer is deterministic and side-effect free.
- All fields are metadata-only.

## State Mapping (Conservative)
Cockpit status and latest step drive the pet view:

- **idle** → readiness: ready; run: active=false, phase=idle, nextAction=null; target locked=false
- **queued** → readiness: ready (preparing=true); run: active=true, phase=thinking, nextAction indicates start/continue worker cycle
- **running**:
  - latestStep.phase === 'review' → phase=reviewing
  - latestStep.phase === 'plan' → phase=thinking
  - latestStep.phase === 'finish' → phase=done
  - latestStep.phase in [model_turn, tool_selection, tool_execution, observation, verification, checkpoint] or unknown → phase=working
  - readiness ready, active=true, nextAction continue
- **blocked** → readiness: blocked; phase=blocked; blockers=[errorCode || 'run_blocked']; nextAction=review blocker
- **paused** → readiness: needs_attention; phase=blocked; blockers=['run_paused']; nextAction=resume or inspect
- **complete** → readiness: ready; run phase=done; nextAction='Review result' only if active terminal run is selected; otherwise null

Target:
- locked = !!activeRun.targetLeaseId || activeRun.targetLeaseCount > 0
- label = 'Target locked' (generic) when locked, else null
- stale = false (this slice; cockpit does not expose freshness)

Safety:
- leakIssueCount = 0
- highRiskArmed = false (no proving field present in cockpit snapshot; do not inspect raw policy or run records here)

## Privacy Boundary
The snapshot MUST NOT expose:
- raw evidence refs, summaries, metadata
- model text, browser payloads, observations
- target URL, origin, title, tab/window ids
- secrets, auth tokens, headers
- Chrome objects or storage internals
- run proof contracts, full budgets, full policies, checkpoints details, raw errors beyond code

Only counts, ids (internal), goal (as run label), high-level status, phase, generic labels, and derived booleans.

The reducer operates exclusively on `AutonomousRunCockpitSnapshot` (already redacted for cockpit use). No direct ledger, evidence, or lease table access in the pet reducer.

## Out of Scope (This Slice)
- No wiring to content/background, no message passing, no pet UI changes.
- No duplicate worker execution, cycle selection, scheduling.
- No browser control, target acquisition, evidence capture.
- No policy gates, review logic, memory, prompt changes.
- No chrome.storage, runtime, or sidepanel usage.
- No changes to autonomous-worker-cycle.md, background.ts, content.ts, manifests.
- No high-risk or leak detection beyond cockpit-provided metadata (none today).
- Stale target freshness and deeper safety signals left for future slices.

## Verification
Required commands (run before any commit):
```sh
npm test -- tests/pet-control.test.ts
npm test -- tests/pet-control.test.ts tests/run-orchestrator.test.ts
npm test -- tests/run-kernel.test.ts tests/run-store.test.ts tests/run-target.test.ts tests/run-target-store.test.ts tests/run-policy.test.ts tests/run-review.test.ts tests/run-orchestrator.test.ts tests/run-iteration.test.ts tests/run-iteration-store.test.ts tests/run-worker.test.ts tests/pet-control.test.ts
npm run compile
git diff --check
git status --porcelain -b
```

Test requirements (must pass):
- Pure reducer idle case: ready/idle, no active target, safety defaults.
- Coverage of queued, running (with review + working phase mapping), blocked (with/without errorCode), paused, terminal/complete.
- Target metadata: locked + generic label + stale=false; no raw target strings leak.
- Privacy adversarial: secrets injected into evidence+leases; final pet JSON contains none of them.
- Async `get...` honors `now` for generatedAt; reduced result equals direct cockpit reduction.
- Contract coverage table (see below) must be satisfied in tests or explicitly marked not-testable-here.

## Contract Coverage Table (Pre-Commit)
(Updated after tests written and verified)

| Behavior | Covered By | Notes |
|----------|------------|-------|
| schemaVersion:1 + generatedAt from cockpit/now | idle test, now test | - |
| readiness ready for idle/queued/running/complete | multiple status tests | - |
| readiness blocked for blocked | blocked tests | - |
| readiness needs_attention for paused | paused test | - |
| blockers populated from errorCode or generic | blocked tests | - |
| run.active, phase, nextAction per mapping rules | all status+phase tests | - |
| review phase => reviewing | running review test | - |
| plan => thinking; working phases => working; finish => done | plan/finish + working tests | - |
| target locked from leaseId or count; generic label; stale=false | target metadata test | - |
| no raw target URL/title/origin or secrets in output | target + privacy probe tests | - |
| safety always 0/false in this slice | idle + all | - |
| privacy: evidence refs/summary/metadata + lease secrets not in JSON | privacy probe test | - |
| async getPet uses provided now | now test + equality | - |
| reducer agrees with cockpit state | now test | - |
| contract table itself | this doc + test file assertions | documented here |

All behaviors testable in this non-Chrome slice are asserted. Chrome integration, UI binding, and runtime doctor cross-checks are out of scope here.

## Adversarial Probe Performed
- Privacy JSON grep for injected secrets (evidence + leases).
- False-positive success check: stored run state has secrets, pet snapshot and cockpit do not.
- Direct equality between getPetControlSnapshot output and reducer(cockpit) for same now.

## Next
This is the durable snapshot contract. Subsequent slices may wire display (without touching this), add freshness, or surface from doctor when appropriate, but must consume this or extend via pure reduction.
