# Page Tools Status Card Dogfood

Evidence source: production bundle `dist/chrome-mv3/sidepanel.html` served locally with a contract-shaped Chrome runtime/storage/permissions stub.

1. Page tools through Menu - healthy. The real command menu opened Page tools at 420px and 360px, and the status card rendered shadcn Card/Header/Title/Description/Action/Content plus the Ready badge.
2. Tool toggles and Local Python setup action - healthy. The Read page switch toggled through the real SET_WEB_TOOL_SETTING path, and Set up rendered as a small outline shadcn Button without claiming Local Python was ready.
3. Site access controls - healthy. Grant and Allow all sites rendered as small outline shadcn Buttons. Invalid URL handling showed user-facing copy, and all-sites permission reached the allowed state without raw permission/runtime text.
4. Diagnostics disclosure - healthy. The disclosure opened, Diagnose rendered as a small outline shadcn Button, the search diagnostic ran, and the reachable result stayed readable at 420px and 360px.
5. Local source failure and recovery - healthy. A seeded local connector failure rendered sanitized copy, kept web tools visible, exposed one Retry action, and recovered to Ready.
6. No-tools state - healthy. With all tools off, the card said No tools on and pointed to the real enablement path instead of fake help data.

Checked: 420px and 360px, command menu, status Card slots, Badge variants, shadcn Button slots for Set up/Grant/Allow all sites/Diagnose, switch toggle, diagnostics disclosure, invalid URL, all-sites permission, source failure/retry recovery, DOM overflow, console/page errors, and visible leak patterns.

Visual review: accepted `tools-diagnostics-open-420.png`, `tools-invalid-url-360.png`, `tools-all-sites-360.png`, `tools-local-failure-360.png`, and `tools-empty-360.png`. No clipped labels or horizontal overflow were visible.

UX rubric: clarity 9/10, function 9/10, visual taste 9/10, evidence integrity 9/10, accessibility 9/10, user cognitive load 9/10, architecture fit 9/10, regression risk 9/10, long-horizon usefulness 9/10. No known P1/P2 findings remain for this slice.
