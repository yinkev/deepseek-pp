# Projects Shadcn Primary Flow Dogfood Audit

Date: 2026-07-01 20:44 PDT
Surface: DeepSeek++ production sidepanel bundle, Menu -> Projects.
Artifact folder: `/Users/kyin/Projects/Deepseek-pp/test-results/projects-shadcn-dogfood`

## Steps Captured

1. `projects-empty-420.png` / `projects-empty-360.png`
   - Opened the real command menu, selected Projects, and verified the first-run no-project state renders through shadcn `Empty`.
   - Verified the header create action renders through a shadcn `Button`.

2. `projects-create-form-420.png` / `projects-create-form-360.png`
   - Clicked `创建项目`, typed project name, description, and instructions, and verified shadcn `Field`, `Input`, `Textarea`, labels, and primary `Button`.
   - Iteration: first captures exposed a pale enabled primary button. The CSS now forces enabled Project submit buttons to `var(--ds-blue)`, and dogfood rejects pale submit buttons before capture.

3. `projects-created-420.png` / `projects-created-360.png`
   - Submitted the visible create action and verified the `CREATE_PROJECT_CONTEXT` payload matched typed name, description, and instructions.
   - Verified the created project stayed selected after reload.

4. `projects-edit-form-420.png` / `projects-edit-form-360.png`
   - Opened project settings, edited description/instructions, and verified the edit form uses the same shadcn-backed controls.
   - Verified the visible Save action renders as a primary shadcn `Button`.

5. `projects-pending-420.png` / `projects-pending-360.png`
   - Set the selected project for the next DeepSeek conversation and verified the `SET_PENDING_PROJECT_CONTEXT` payload.
   - Verified readiness uses a shadcn `Badge` and the clear action remains reachable.

6. `projects-linked-420.png` / `projects-linked-360.png`
   - Linked the current DeepSeek conversation and verified the `ADD_CONVERSATION_TO_PROJECT` payload plus visible linked state.

7. `projects-delete-dialog-420.png` / `projects-delete-dialog-360.png`
   - Opened the visible destructive action and verified a shadcn `AlertDialog` title, cancel, and destructive action.
   - Iteration: first captures were mid-animation and too faint. The dogfood script now waits for stable dialog opacity and size before screenshot.

8. `projects-memory-failure-420.png` / `projects-memory-failure-360.png`
   - Forced project memory load to fail while project data stayed available.
   - Verified a shadcn `Alert` reports the partial source failure instead of collapsing to a false empty state.

9. `projects-memory-recovered-420.png` / `projects-memory-recovered-360.png`
   - Clicked Retry and verified project memory rows recovered.
   - Verified memory row icon actions preserve shadcn Button variant/size through `TooltipTrigger asChild`.

## Checks

- Production bundle loaded from `dist/chrome-mv3/sidepanel.html`.
- Real command menu navigation opened Projects.
- No-project state used shadcn `Empty`.
- Create/edit forms used shadcn `Field`, `Input`, and `Textarea` slots with label wiring.
- Create, edit, assignment, link, retry, and destructive actions used shadcn `Button` slots.
- Memory icon actions preserved shadcn Button variant/size while Radix Tooltip owns the final trigger slot.
- Readiness state used shadcn `Badge`.
- Memory partial failure used shadcn `Alert`.
- Delete confirmation used shadcn `AlertDialog`.
- Create, update, pending, and linked-conversation payloads matched the typed/selected values.
- No horizontal overflow at 420px or 360px.
- No console errors or page errors.
- Visible leak scan passed for runtime message names, storage/schema strings, URLs, bearer/cookie/token strings, data images, and object fallback strings.

## Risks

- This dogfood uses a contract-shaped Chrome stub and does not prove the installed live extension runtime.
- Project memory create/edit/delete remains covered by existing Projects and MemoryForm tests plus prior tooltip dogfood; this slice focused on Projects primary flow, project-level state, and partial memory-source recovery.
- Grok advisor was invoked with the documented headless shape and no reasoning flags, but produced only startup/auth/tool warnings and no substantive review output after bounded polling, then was stopped. Local verification is the accepted evidence for this slice.

## Rubric

- Clarity: 9/10
- Function: 9/10
- Visual taste: 9/10
- Evidence integrity: 9/10
- Accessibility: 9/10
- Cognitive load: 9/10
- Architecture fit: 9/10
- Regression risk: 9/10
- Long-horizon usefulness: 9/10

No known P1/P2 findings remain for this slice.
