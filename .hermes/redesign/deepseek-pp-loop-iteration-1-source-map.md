# DeepSeek++ Redesign Loop — Iteration 1 Source Map

## Target
Make DeepSeek++ feel like a clean autonomous-work command system: intent → scope → readiness → long loop → proof → review/continue.

## Observed facts

### Sidepanel information architecture
- Top tabs in `entrypoints/sidepanel/App.tsx:10-23`: `chat`, `library`, `projects`, `capabilities`, `settings`.
- `LibraryPage` subtabs in `entrypoints/sidepanel/pages/LibraryPage.tsx:7-12`: `memory`, `saved`.
- `CapabilitiesPage` subtabs in `entrypoints/sidepanel/pages/CapabilitiesPage.tsx:13-27`: `skill`, `mcp`, `tools`, `browser`, `doctor`, `preset`, `automation`.
- `SettingsPage` subtabs in `entrypoints/sidepanel/pages/SettingsPage.tsx:16-27`: `general`, `api`, `prompt`, `voice`, `appearance`, `usage`, `data`, `about`.

### Automation model
- Core automation types in `core/automation/types.ts` include `Automation`, `AutomationRun`, schedule kind `manual|cron|rrule`, run statuses, preflight grading, chain policy, DeepSeek session, visual monitor, and flight recorder.
- Flight recorder facts in `core/automation/types.ts:184-229`: events cover readiness preflight, request prepared, session/auth/visual monitor, runner start/completion, retry scheduled; visual evidence metadata records counts and `rawImageStored: false`.
- Workflow templates live in `core/automation/workflow-templates.ts:55-266`.

### Current template inventory
- `runtime-readiness-recovery` — readiness — manual.
- `deep-research-swarm` — research — manual.
- `project-status-council` — project — weekly cron.
- `implementation-council` — project — manual.
- `browser-watchtower` — browser — manual.
- `review-grade-iterate` — quality — manual.
- `systematic-debug-loop` — quality — manual.
- `prompt-workflow-refinery` — prompt — manual.
- `memory-hygiene-council` — memory — manual.
- `source-monitor` — research — daily cron.

### Verification baseline
- `npm test -- tests/sidepanel-navigation.test.ts tests/sidepanel-interactions.test.ts` → 2 files passed, 32 tests passed.
- `npm run verify:automation` → Automation contract smoke passed.

## Inferences
1. Automation is implemented as a capability subtab, not the center of the product experience. That is probably backwards for the long-horizon goal.
2. Existing templates are useful but fragmented by task type; the default posture is “pick a workflow” rather than “continue the autonomous loop.”
3. The system already has the necessary primitives for a strong loop UI: readiness, preflight, visual evidence, chain policy, run history, and flight recorder.
4. The first useful slice should probably use existing primitives and change the default product shape, not invent a new runner.

## Unknowns
- Whether current dirty changes already implement part of the desired command-center direction.
- Oracle answer pending; treat as critique, not plan.
- Whether the extension has a live loaded dev build available for browser-level dogfood in this session.

## Candidate first slice before Oracle returns
Promote automation from “Capabilities → Automation subtab” into a clearer command-center journey without changing runner behavior:
- rename/position around “Autonomous loops” semantics;
- add a default long-loop template/action if source truth confirms no equivalent exists;
- adjust tests to assert the IA and template default.

Do not implement until Oracle returns or a source contradiction appears.
