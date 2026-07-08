# Mission Starter Shadcn Slice Audit

Date: 2026-07-01 20:55 PDT

## Contract

- Preserve autonomous run storage key and schema: `deepseek_pp_autonomous_runs_v1`.
- Preserve Mission start payload semantics: objective, done criteria lines, required evidence lines.
- Preserve Mission pause/resume/stop behavior through `applyRuntimeCockpitMissionAction`.
- Replace raw Mission starter textarea/error markup with shadcn-backed field and alert composition.
- Dogfood visible Mission start, Activity routing, pause, resume, and stop at 420px and 360px.

## Implementation

- `MissionStarter` now uses shared `TextAreaField` for objective, done criteria, and required evidence.
- `TextAreaField` now accepts optional `name`, `fieldClassName`, and `textareaClassName` so existing selectors and page-specific styling survive migration.
- Starter error rendering now uses shadcn `Alert`/`AlertDescription`.
- Mission runtime/storage contracts, navigation targets, and action handlers are unchanged.

## Verification

- `npx shadcn@latest docs field textarea alert button`
- Official docs inspected:
  - https://ui.shadcn.com/docs/components/radix/field
  - https://ui.shadcn.com/docs/components/radix/textarea
  - https://ui.shadcn.com/docs/components/radix/alert
  - https://ui.shadcn.com/docs/components/radix/button
- `npx vitest run tests/mission-page.test.ts tests/sidepanel-polish.test.ts`: 97 tests passed.
- `npm run compile -- --pretty false`: passed.
- `npm run verify:i18n`: passed.
- `npm test`: 131 files / 1441 tests passed.
- `npm run build`: passed with the pre-existing pyodide browser-externalization and chunk-size warnings.
- `node test-results/mission-starter-dogfood/dogfood-mission-starter.mjs`: passed.

## Dogfood

Production bundle served from `dist/chrome-mv3/sidepanel.html` with a contract-shaped Chrome runtime/storage stub.

Checked at 420px and 360px:

- Opened Mission from the real primary nav.
- Verified first-run Mission empty state uses shadcn Empty.
- Opened starter form through visible Start mission action.
- Filled objective, done criteria, and required evidence fields.
- Verified shadcn Field/Textarea slots, rows, and label wiring.
- Verified Cancel/Create actions use shadcn Button slots.
- Created a mission and verified the autonomous run ledger payload.
- Opened Activity from Mission action and returned to Mission.
- Clicked Pause and verified ledger status `paused`.
- Clicked Resume and verified ledger status `running`.
- Clicked Stop and verified ledger status `cancelled`.
- Checked no horizontal overflow, no console/page errors, and no visible leak patterns.

Screenshots:

- `mission-empty-420.png`, `mission-empty-360.png`
- `mission-starter-420.png`, `mission-starter-360.png`
- `mission-created-420.png`, `mission-created-360.png`
- `mission-open-activity-420.png`, `mission-open-activity-360.png`
- `mission-paused-420.png`, `mission-paused-360.png`
- `mission-resumed-420.png`, `mission-resumed-360.png`
- `mission-stopped-420.png`, `mission-stopped-360.png`

Direct visual inspection accepted:

- `mission-starter-360.png`: labelled fields fit, text does not overlap, primary Create action is clear.
- `mission-created-420.png`: status and mission panels are readable; lower controls are scroll-reachable.
- `mission-open-activity-360.png`: Activity route is readable with mission strip and event state visible.
- `mission-stopped-360.png`: terminal state and restart/review/activity controls are visible.
- `mission-resumed-420.png`: pause/stop controls remain visible after state mutation.

## Iteration Notes

- First dogfood run failed on a strict selector: the label `活动` existed in both primary nav and the Mission action row. The harness now targets `main` for the Mission action. App behavior did not change.

## Advisor Status

- Grok advisor was not run for this small slice after previous repeated startup/auth-only outputs. This is recorded as advisor unavailable for this slice, not accepted reviewer approval.
- Local tests, production dogfood, screenshot inspection, and Codex P1/P2 review are the evidence source.

## UX Rubric

- Clarity: 9/10
- Function: 9/10
- Visual taste: 9/10
- Evidence integrity: 9/10
- Accessibility: 9/10
- User cognitive load: 9/10
- Architecture fit: 9/10
- Regression risk: 9/10
- Long-horizon usefulness: 9/10

No known P1/P2 findings remain for this slice.
