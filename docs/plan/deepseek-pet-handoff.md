# DeepSeek Pet Control Panel Handoff

## Evidence

- Worktree: `/Users/kyin/Projects/deepseek-pp-pet`
- Branch: `codex/deepseek-pet`
- Exact pet Oracle run: `deepseek-pet-control` failed before submission because Oracle could not use the ChatGPT model selector/login state.
- Hidden Oracle rerun: `deepseek-pet-vision-hidden` submitted successfully but failed before answer capture because the Oracle-owned Chrome window closed.
- Hidden Oracle retry: `deepseek-pet-vision-hidden-2` completed with `--browser-hide-window --browser-model-strategy current`, but the captured answer was the unusable one-token output `I`.
- Reduced-context hidden Oracle retry: `deepseek-pet-vision-hidden-3` completed with the same hidden/current-model strategy and ~8.4k input tokens, but again captured only the unusable one-token output `I`.
- Usable Oracle evidence: completed browser Oracle session `deepseek-control-panel-vision` from 2026-06-21, focused on DeepSeek++ as a personal browser-side control panel and long-horizon agent surface. Treat it as advisory, not as exact pet-specific review.
- Local repo evidence: `docs/plan/deepseek-pet-context.md`, `core/pet/*`, `entrypoints/content.ts` pet regions, `entrypoints/background.ts` pet/runtime-doctor regions, `core/personal-convenience/*`, `core/automation/readiness.ts`, `core/automation/workflow-templates.ts`, `core/chat/runtime-doctor.ts`.

## Current Worktree State

Implemented Slice 1: read-only pet click popover.

Changed files:

- `entrypoints/content.ts`
  - Click without drag toggles a compact pet control popover.
  - Popover shows current pet status and one next action from existing pet state only.
  - Popover is read-only: no tool execution, browser mutation, readiness repair, or detach action is triggered.
  - Bubble speech is suppressed while the control popover is open to prevent overlap.
  - Host is keyboard reachable with `role="button"`, `aria-expanded`, `aria-label`, `Enter`/`Space` activation, `Escape` close, focus-visible outline, and polite state announcement.
- `core/i18n/resources/en.ts`
  - Added pet control labels/state/next-action strings.
- `core/i18n/resources/zh-CN.ts`
  - Added matching Chinese pet control labels/state/next-action strings.
- `tests/tool-block-style.test.ts`
  - Added read-only/bounded/ARIA/keyboard invariants.
  - Added exhaustive `PetState` i18n coverage for `states` and `next`.

Verification run:

```sh
npm install
npm test -- tests/tool-block-style.test.ts
npm run compile
npm test
npm run build:chrome
git diff --check
```

Review result:

- Claude sub-agent review found no blocking findings after two iterations.
- Grade: A for Slice 1.
- Residual risk: live browser visual smoke was not run, so actual DeepSeek page placement still needs one manual/Playwright smoke before merge.

## Call

The DeepSeek pet should become a compact personal control surface over the existing DeepSeek++ runtime, not a mascot and not a second sidepanel.

Default end state: the pet is the always-visible cockpit for readiness, current run state, target/browser state, review gates, recovery, and next action. DeepSeek Web remains the model adapter. Existing Runtime Doctor, Personal Convenience, Automation, Browser Control, Inline Agent, MCP, Memory, Skills, and tool-loop surfaces remain the underlying systems.

Do not make the pet an autonomous actor that silently clicks, submits, deletes, publishes, changes accounts, stores memories, or runs shell/browser mutations without policy gates. The pet can suggest, expose, pause, resume, prepare, and hand off. Mutating work stays behind existing tool policy, browser target locks, and explicit confirmation where risk requires it.

## Architecture Contract

### Pet Owns

- A visible status summary derived from existing runtime state.
- A tiny command menu for the highest-leverage actions.
- A handoff/next-action panel that turns runtime state into "what should happen next."
- Links into existing sidepanel surfaces: Runtime Doctor, Automation, Browser Control, Chat, Memory, Skills.
- Optional review-gate affordances: evaluate, review, grade, iterate, stop.

### Pet Does Not Own

- DeepSeek request/stream interception.
- Tool execution semantics.
- Browser-control mutation policy.
- Automation scheduling or run storage.
- Memory persistence policy.
- MCP/native-shell execution.
- Prompt-output templates that are frozen by `docs/refactor-current-architecture.md`.

### Minimal New Module Boundary

Add a small pet control layer only after the first UI slice proves useful:

```ts
core/pet/control.ts
```

It should aggregate existing state into a render-safe view model:

```ts
export interface PetControlSnapshot {
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
```

This view model must not store secrets, raw screenshots, auth headers, raw Vision refs, or tool payloads. It should be recomputed from existing stores/reports.

## UX Contract

Pet idle click opens a small control popover, not a full dashboard.

Default actions:

1. Make Ready: calls existing personal readiness/autopilot path.
2. Open Current Run: navigates sidepanel to Chat or Automation context if available.
3. Open Target: navigates sidepanel to Browser Control / Runtime Doctor target state.
4. Review Gate: inserts or opens the existing review/grade/iterate workflow path, not a new prompt protocol.
5. Pause / Stop: only if a run/automation/inline loop is active and existing stop APIs support it.

Popover content:

```txt
Status: Ready / Needs Attention / Blocked
Run: idle / thinking / tool / review / blocked
Target: locked / missing / stale
Next: one concrete action
Actions: Make Ready, Open Run, Open Target, Review Gate
```

No raw XML. No JSON walls. No protocol tags. No fake proof. No broad page overlays.

## Implementation Slices

### Slice 1: Pet Click Popover, Read-Only

Goal: turn pet from purely decorative telemetry into a read-only cockpit.

Changes:

- Add click handling that distinguishes click from drag in `entrypoints/content.ts`.
- Add compact popover markup/CSS next to existing pet bubble.
- Populate from existing content-local state only: pet state, active streaming state, basic "open sidepanel" actions if available.
- Keep it read-only except sidepanel navigation/open commands.

Success criteria:

- Drag behavior still works.
- Click opens/closes popover.
- Popover does not overlap incoherently with existing bubble.
- No tool execution or browser mutation is triggered by pet click.
- Pet remains disabled by default unless current config enables it.

Verification:

```sh
npm run compile
npm test -- tests/tool-block-style.test.ts
npm run build:chrome
```

### Slice 2: Runtime Doctor Summary

Goal: pet shows readiness/blocker summary from existing Runtime Doctor instead of inventing readiness state.

Changes:

- Add a background message if needed: `GET_PET_CONTROL_SNAPSHOT`.
- Implement snapshot by calling existing `getRuntimeDoctorReport` and reducing it to safe fields.
- Add content-side fetch/cache with short TTL and manual refresh via Make Ready.

Success criteria:

- Snapshot contains readiness status, blocker count, target lock summary, leak issue count.
- No secrets/raw images/raw Vision refs leave existing reports.
- Blocked readiness changes pet phase to `confused` or `error` only when user opens control popover or explicit event occurs; avoid noisy state flipping.

Verification:

```sh
npm run compile
npm test -- tests/runtime-doctor.test.ts
npm test -- tests/tool-block-style.test.ts
```

### Slice 3: Make Ready From Pet

Goal: pet exposes one high-value action: prepare runtime.

Changes:

- Wire "Make Ready" to existing `RUN_PERSONAL_AUTOPILOT_REPAIR` or readiness path.
- Show running/success/error in popover and pet state.
- Do not add new repair logic.

Success criteria:

- Duplicate clicks are disabled while pending.
- Result is reflected from existing Runtime Doctor report/autopilot ledger.
- Failure shows exact blocker summary and "Open Runtime Doctor."

Verification:

```sh
npm run compile
npm test -- tests/runtime-doctor.test.ts tests/sidepanel-interactions.test.ts
```

### Slice 4: Review Gate Shortcut

Goal: make review/evaluate/grade/iterate a first-class pet action without changing frozen prompt output.

Changes:

- Pet action opens Automation page with `review-grade-iterate` template or inserts existing review-gate contract only through current Automation UI helpers.
- Do not mutate system templates or interceptor prompt scaffolding.

Success criteria:

- Existing `applyAutomationReviewGate` behavior is reused.
- Existing automation readiness tests still cover review-gate text.
- No new prompt-output paths are added in interceptor.

Verification:

```sh
npm run compile
npm test -- tests/automation-readiness.test.ts tests/automation-workflow-templates.test.ts
npm run prompt:freeze
```

### Slice 5: Target/Evidence Awareness

Goal: pet tells the user when Browser Control target is missing/stale before long work starts.

Changes:

- Read target status from Runtime Doctor/browser-control state.
- Show "Target missing/stale" and "Open Target" action.
- Do not perform browser mutation from pet.

Success criteria:

- Browser-control disabled/missing/stale state is visible.
- No `chrome.debugger` mutation starts from pet.
- Pet cannot silently select active tab.

Verification:

```sh
npm run compile
npm test -- tests/browser-control.test.ts tests/runtime-doctor.test.ts
```

## Novel Features Worth Considering

Near-term, plausible:

1. **Evidence Pulse**: pet badge shows last verified evidence age, e.g. "7s" / "stale" / "none." This changes behavior because agents must keep evidence fresh.
2. **Blocker Lens**: pet cycles only blocker categories, not cute lines, when readiness is blocked: auth, target, leak, busy, stale content script.
3. **Review Heat**: pet color/state reflects current confidence grade A-F from automation readiness or human eval.
4. **Handoff Capsule**: one pet action creates a compact local handoff from current run/doctor/target state. No raw payloads.
5. **Proof Debt Counter**: pet shows count of claims/results lacking evidence refs. If nonzero, finalization should be discouraged.
6. **Memory Pressure Meter**: pet warns when memory/project context injection grows or duplicate proposals appear.
7. **Target Lease Ring**: visual ring around pet indicates browser target lock freshness; stale target turns ring amber.
8. **Stop-the-Line Button**: pet exposes universal pause/stop for active automation/inline loops, routed to existing cancellation APIs.

Speculative, only after run-kernel/evidence maturity:

1. **Run Replay Filmstrip**: compact chronological visual replay of key browser evidence frames, metadata-only unless user opens details.
2. **Agent Council Queue**: pet shows multiple review lanes (implementer, reviewer, safety, UX) but stores only verdicts/evidence, not verbose transcripts.
3. **Intent Firewall**: pet blocks a run if planned actions drift from original goal, using proof contract mismatch.
4. **Trust Budget**: pet tracks accumulated risk across shell, browser mutation, memory persistence, and external network use; high trust debt forces review.

Reject:

- Animated gimmicks without control value.
- Pet-initiated autonomous browser mutation.
- Always-on speech spam.
- Another permanent sidepanel page.
- Prompt-only safety.
- Raw screenshot/tool payloads in chat continuation.

## Risks

- **Prompt freeze**: avoid changing system templates, tool schema rendering, tool reminders, and inline-agent continuation/nudge/finalization prompts unless explicitly intended and tested with `npm run prompt:freeze`.
- **DOM fragility**: content pet popover must be isolated and not depend on fragile DeepSeek DOM beyond existing host injection.
- **Storage safety**: pet snapshot must be reduced metadata only.
- **Extension review**: user-facing public docs should say what the pet does, not expose internal APIs/protocols.
- **Scope creep**: the pet should first expose existing readiness/control state; do not build a new run kernel inside the pet.

## Strongest Counterargument

Counterargument: building pet control now may polish the visible edge while deeper architecture still has duplicated loops across sidepanel chat, inline agent, and automation.

Default response: start with read-only pet cockpit and Runtime Doctor integration because it improves user orientation without changing core execution. Defer run-kernel refactor until the pet makes gaps visible and there is concrete evidence that loop divergence blocks real workflows.

Evidence that changes this: if user workflows require overnight or multi-hour unattended browser/shell tasks, prioritize run ledger/target lease/evidence kernel before deeper pet UI.

## Long-Running Agent Prompt

```text
You are working in /Users/kyin/Projects/deepseek-pp-pet on branch codex/deepseek-pet.

Mission:
Make the DeepSeek++ floating pet work like a personal Codex-style control surface: visible runtime state, readiness, browser target status, review/grade/iterate gates, next-action handoff, and safe control over long-running agent workflows.

Core call:
The pet is a compact cockpit over existing systems. It is not a new runtime, not a mascot-only feature, not a second sidepanel, and not an autonomous actor that silently mutates browser state or local files.

Before acting:
1. Inspect current repo state with git status and targeted rg/sed reads.
2. Read AGENTS.md and docs/plan/deepseek-pet-handoff.md.
3. State assumptions and the specific slice you will implement.
4. Use the smallest coherent slice that moves the final state forward.
5. Do not ask questions unless missing information makes the work unsafe or meaningless.

Architecture boundaries:
- Pet UI may live in entrypoints/content.ts only while small. If it grows, move view-model logic into core/pet/control.ts.
- Runtime truth comes from existing Runtime Doctor, Personal Convenience, Automation, Browser Control, Inline Agent, and Tool Loop systems.
- Do not duplicate tool execution, automation scheduling, browser-control policy, memory policy, or prompt scaffolding in pet code.
- Do not change frozen prompt-output contracts casually.
- Do not store secrets, auth headers, raw screenshots, raw Vision refs, or raw tool payloads.

Implementation loop:
1. Plan one slice.
2. Implement only that slice.
3. Evaluate against the handoff success criteria.
4. Review risks: prompt freeze, DOM fragility, storage safety, UI clutter, browser mutation, memory buildup.
5. Grade A-F.
6. If below A and the issue is fixable in scope, iterate once.
7. Run the smallest relevant verification commands.
8. Update or create a short handoff note if remaining work matters.
9. Continue to the next slice only after the current slice is verified or honestly blocked.

Default slice order:
1. Read-only pet click popover.
2. Runtime Doctor summary snapshot.
3. Make Ready action via existing personal readiness/autopilot path.
4. Review Gate shortcut via existing automation readiness/review helpers.
5. Browser target/evidence awareness.
6. Universal pause/stop only if existing cancellation APIs support it safely.

Hard rejects:
- No reverse-engineered external tools unless explicitly requested by the user.
- No pet-triggered browser mutation.
- No active-tab mutation fallback.
- No raw XML/JSON/protocol UI.
- No new permanent sidepanel page for pet.
- No broad refactor unrelated to the selected slice.
- No public README internals.
- No claiming live behavior without live evidence.

Verification defaults:
- Type/UI slice: npm run compile; targeted Vitest; npm run build:chrome if content-script behavior changes.
- Runtime Doctor slice: npm test -- tests/runtime-doctor.test.ts plus compile.
- Automation/review slice: npm test -- tests/automation-readiness.test.ts tests/automation-workflow-templates.test.ts; npm run prompt:freeze.
- Browser Control slice: npm test -- tests/browser-control.test.ts; live smoke only if claiming browser behavior.

Final report format:
1. Changed: exact files and behavior.
2. Verified: commands and results.
3. Notes: risks, unverified behavior, next slice.
```

## Open Questions

1. Should pet work stay private-only or Chrome Web Store-safe?
   - Default: keep it private-power-user first, but avoid public-review-hostile behavior.
   - Evidence that changes it: explicit release requirement.

2. Should pet work wait for a run-kernel refactor?
   - Default: no. Start with read-only cockpit over existing runtime state.
   - Evidence that changes it: real long-running runs fail because loop state is duplicated or not resumable.

3. Should pet expose stop/pause immediately?
   - Default: only if existing cancellation APIs are already safe to call.
   - Evidence that changes it: clear active-loop cancellation path with tests.
