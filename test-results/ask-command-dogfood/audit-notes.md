# Ask Command/Context Dogfood Audit - 2026-07-01 19:32 PDT

Audit scope: DeepSeek++ production sidepanel Ask composer suggestion flow at 420px and 360px.

Destination: `/Users/kyin/Projects/Deepseek-pp/test-results/ask-command-dogfood/`.

Capture tool: production `dist/chrome-mv3/sidepanel.html` opened with Playwright and a contract-shaped Chrome runtime/storage stub. Product Design saved context preflight returned no saved context.

## Steps

1. `ask-ready-420.png`, `ask-ready-360.png` - Ask entry state. Healthy: current and recent work are visible, composer is reachable, and no horizontal overflow was detected.
2. `slash-open-420.png`, `slash-open-360.png` - User types `/r`. Healthy: real command rows appear from `GET_SKILL_LIBRARY`, disabled commands stay hidden, details fit in the composer panel, and keyboard Enter inserts `/review`.
3. `context-open-420.png`, `context-open-360.png` - User types `@`. Healthy: project, current chat, memory, saved item, and browser actions are visible without fake rows; ArrowDown plus Enter inserts `@Project: Run1`.
4. `slash-failure-420.png`, `slash-failure-360.png` - Command source fails. Healthy: the UI shows a retryable partial-source issue instead of a false empty state and does not expose raw runtime message names or schema/storage details.
5. `slash-recovered-420.png`, `slash-recovered-360.png` - User retries after source recovery. Healthy: command rows return, `command-list` and `command-item` slots are present, and the composer remains stable at narrow width.

## Findings

- Strength: The suggestion panel is anchored close to the composer, which keeps slash and context work local to the Ask task instead of sending the user to another page.
- Strength: The narrow 360px flow keeps labels, row detail, composer buttons, and retry action readable without clipping.
- Strength: Failure and recovery are truthful. The source failure keeps loaded context visible when applicable and retry restores usable rows.
- Accessibility: The textarea exposes `aria-controls`, `aria-expanded`, and `aria-activedescendant`; dogfood verified the active descendant target exists for slash, context, and recovered states.
- Accessibility risk: Screenshots cannot prove screen-reader announcement quality or full focus order. Unit and dogfood checks covered labels, active descendant existence, and keyboard selection, but a live assistive-technology pass remains a milestone-level check.
- UX risk: Raw upstream error prose can remain mixed-language if the underlying source returns English text, as shown by the stubbed `commands offline`. This is acceptable for this slice because it is not a privacy leak, but future state-system work should decide whether user-safe source errors should be localized or normalized.

## Verdict

No P1/P2 UX, accessibility, privacy, or capability findings from the current evidence. Slice grade: 9/10.
