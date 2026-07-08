# Settings Status Card Dogfood

Evidence source: production bundle `dist/chrome-mv3/sidepanel.html` served locally with a contract-shaped Chrome runtime/storage stub.

1. Ready Settings through Menu - healthy. The real command menu opened Settings, the status card rendered with shadcn Card/Badge slots, and no retry action was shown.
2. Settings View dropdown - healthy. The real View dropdown opened, Data was selected, and the status card updated its current-view row without overflow.
3. Source failure and keyboard recovery - healthy. The status card showed `Needs refresh`, the detailed warning listed sanitized source evidence without a second Retry button, and keyboard Enter on the card Retry recovered to ready/configured state.

Checked: 420px and 360px, command menu, Settings status card slots, View dropdown, source failure, keyboard retry recovery, DOM overflow, console/page errors, and visible leak patterns.
