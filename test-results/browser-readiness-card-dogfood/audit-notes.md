# Browser Readiness Card Dogfood Audit

Date: 2026-07-01 21:36 PDT
Surface: Browser Control, production bundle at `dist/chrome-mv3/sidepanel.html`
Destination: local evidence folder `test-results/browser-readiness-card-dogfood/`

## Flow Steps

1. Opened the sidepanel production bundle with a Chrome runtime/storage stub and opened Browser through the real command menu.
   Health: pass. The command menu opened, filtered to Browser, and navigated to the Browser surface without console or page errors.

2. Started with no selected target.
   Health: pass. The Browser status card showed `Needs target`, a shadcn Badge, three status rows, and a shadcn Button action. No horizontal overflow at 420px or 360px.

3. Clicked the readiness `Choose target` action, verified focus moved to the first controllable target, then selected it with keyboard Enter.
   Health: pass. The selected target became visible and Browser status changed to `Ready` with the readiness Card in view after harness iteration.

4. Locked and cleared the selected target memory.
   Health: pass. Both actions used shadcn Button slots, showed localized success copy, and did not expose tab ids or runtime message names.

5. Opened the advanced snapshot budget details.
   Health: pass. The opened details body, toggles, and sliders were visible after harness iteration. No horizontal overflow at 360px.

6. Simulated a Browser status source failure, clicked Retry, and verified recovery.
   Health: pass. Failure state stayed blocked with a destructive Badge and Retry action. Recovery returned to Ready and removed the failure copy.

7. Simulated a target-selection action failure.
   Health: pass. The page showed sanitized failure copy and kept reachable targets visible. Raw runtime message names and the simulated permission detail did not render.

## Findings

- No P1/P2 UX findings remain for this slice.
- Initial dogfood caught two harness/evidence issues: target fixtures were out of scope inside `addInitScript`, and accepted readiness/advanced screenshots could be captured at the wrong scroll position. Both were fixed in the harness and rerun successfully.
- The visible Browser readiness panel is compact and readable at 360px and 420px. The action hierarchy is clear: status card first, connection controls second, target rows third, advanced controls collapsed by default.

## Accessibility And Privacy Checks

- Verified shadcn Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, Badge, and Button slots in production DOM.
- Verified keyboard Enter can select the focused target after the readiness action moves focus.
- Verified no horizontal overflow at 360px or 420px.
- Verified no visible `GET_*`, `SET_*`, `SAVE_*`, `schemaVersion`, `chrome.runtime`, `chrome.storage`, tab ids, raw unsupported-scheme text, raw permission-denied text, tokens, image data, or object fallback strings.
- Screenshot-only limits: this does not prove full screen-reader output. Unit tests cover semantic slots and labels; a dedicated assistive-tech pass remains a full-milestone requirement.

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
