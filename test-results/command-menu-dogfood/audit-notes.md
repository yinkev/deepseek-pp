# Command Menu Dogfood Audit

Scope: sidepanel shell route gateway after replacing the old dropdown with a shadcn CommandDialog.

Screenshots inspected:

1. `01-command-open-420.png` - healthy. The full command menu opens over the production sidepanel, keeps the background inert, exposes recent work plus all workspace/system routes, and stays readable at 420px.
2. `02-command-search-health-420.png` - healthy. Search narrows the route list to Health, keeps the command input focused, and leaves the close control reachable.
3. `03-command-open-360.png` - healthy. The full route list stays within the 360px panel with no horizontal clipping.
4. `04-command-search-automation-360.png` - healthy. Search narrows to Automation at 360px and preserves section context without overflowing.
5. `05-command-search-settings-360.png` - healthy. Search narrows to Settings at 360px; the result label and detail fit without truncating the command action.

Interaction evidence:

- Opened the production bundle command menu at 420px and 360px.
- Typed Health, Automation, and Settings searches.
- Pressed Enter on the Health result and verified the Health route rendered.
- Clicked the Settings result and verified the Settings route rendered.
- Pressed Escape after a search and verified focus returned to the Menu button.
- Checked command/dialog slots, visible filtered item counts, page overflow, console errors, page errors, and visible leak patterns.

Findings:

- No P1/P2 UX issues found for this slice.
- The dialog is a clear improvement over the old static dropdown because route discovery is now searchable without losing direct menu reachability.
- The focused result rows are compact and readable at 360px.
- The current visual density is acceptable for a route gateway, though future full-shell work should consider making the command menu the single global action surface rather than only a route picker.

Accessibility notes:

- Dialog title and description are present.
- Input, list, groups, and command items are rendered through shadcn/cmdk slots.
- Escape returns focus to the Menu button in the production dogfood run.
- This audit did not run a screen reader, so announcement quality remains a manual AT check for a later milestone.

Evidence limits:

- This was production-bundle Playwright dogfood with a contract-shaped Chrome runtime stub, not a live installed extension runtime.
- Automation was searched to prove discoverability, but not selected in the accepted run because this slice is shell navigation and Automation page data contracts are outside this slice.
