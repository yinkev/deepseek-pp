# Presets Status Card Dogfood

Evidence source: production bundle `dist/chrome-mv3/sidepanel.html` served locally with a contract-shaped Chrome runtime/storage stub.

1. Ready Presets through Menu - healthy. The command menu opened Presets, the status card showed Ready, the selected preset row used shadcn Badge state, header Import/New buttons carried lucide icons, imported markdown saved through the hidden file input, the imported row appeared, and Escape closed the menu.
2. Empty and create - healthy. The status card showed No presets, its footer New action opened the real form, typed values saved through Save, and Use made the new preset active.
3. Preset library failure - healthy. A raw failing source rendered sanitized unavailable copy, a single Retry action, and recovered by keyboard Enter.
4. Selection failure - healthy. Existing rows stayed visible while selection needed refresh, Retry recovered to Ready, and no false empty state appeared.

Checked: 420px and 360px, command menu, Presets status card slots, row Badge slots, header icon Button slots, file import payload, card New action, form typing/save, Use action, load failure, selection failure, keyboard retry, DOM overflow, console/page errors, and visible leak patterns.
