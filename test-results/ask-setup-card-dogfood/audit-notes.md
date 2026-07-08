# Ask Setup Card Dogfood

Result: pass.

Evidence source: production bundle `dist/chrome-mv3/sidepanel.html` served locally with a contract-shaped Chrome runtime/storage stub.

- Disabled Ask renders a shadcn Card setup state, no composer, real Enable/API Settings actions, and keyboard Enter enables chat.
- Needs-setup Ask renders truthful DeepSeek/API status and the Open DeepSeek action requests the real target URL.
- Checking Ask renders Skeleton rows while auth is pending.
- Enabled Ask still exposes the composer, real navigation menu, slash suggestions, context suggestions, and retryable slash/context source-failure alerts.
- Checked 420px and 360px, horizontal overflow, console/page errors, and visible leak patterns.
