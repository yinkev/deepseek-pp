# Health Status Card Dogfood

Evidence source: production bundle `dist/chrome-mv3/sidepanel.html` served locally with a contract-shaped Chrome runtime/storage stub.

1. Ready Health through Menu - healthy. The real command menu opened Health, the shadcn Card/Badge rows rendered, the Health action row and readiness action rendered as shadcn Button slots, and the Refresh, Refresh login, Check readiness, and Run review controls called their runtime paths.
2. Load failure and recovery - healthy. The status card showed `需要刷新`, a single focused refresh action recovered the report through keyboard Enter, and raw runtime text stayed hidden.
3. Page bridge action failure and recovery - healthy. The status card guided `刷新页面桥接`, the first action failure used sanitized copy, and the second keyboard retry returned to ready.
4. Repair retry and recovery memory - healthy. The Repair and retry action refreshed auth and retried automation, while Save memory persisted a sanitized recovery memory from the debug suggestion.

Checked: 420px and 360px, command menu, status Card slots, Badge variants, shadcn Button slots for Health actions, details disclosure, keyboard Enter on retry actions, repair/retry flow, recovery memory save, DOM overflow, console/page errors, and visible leak patterns.
