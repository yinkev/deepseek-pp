# Connectors Status Card Dogfood

Evidence source: production bundle `dist/chrome-mv3/sidepanel.html` served locally with a contract-shaped Chrome runtime/storage/permissions stub.

1. Connectors through Menu - healthy. The real command menu opened Connectors at 420px and 360px, and the status card rendered shadcn Card/Header/Title/Description/Action/Content plus the Ready badge.
2. Connector actions - healthy. Local computer, Add connector, Edit, Delete, Test, Refresh actions, Save, and Cancel rendered as shadcn Button slots with the expected variants and sizes while preserving the existing handlers.
3. Dropdowns and details - healthy. The detail execution dropdown exposed localized Auto/Manual/Disabled options, changed through the runtime update path, and reset cleanly; Recent activity opened, rendered the sanitized action label, and did not expose raw action ids.
4. Add connector form - healthy. The form opened from the real Add connector action, connection type changed to Local bridge, advanced controls opened, the default execution dropdown changed and reset, and form actions remained readable at 420px and 360px.
5. Delete confirmation - healthy. The delete confirmation opened and cancel flow returned without deleting; focused dialog screenshots were captured.
6. Failure and recovery - healthy. Connector list failure and action-cache failure rendered truthful retry states, preserved reachable rows when partial data failed, and recovered through the status action.
7. Permission/action failures - healthy. Permission denial and test-action failure rendered sanitized user-facing copy without raw runtime message names.

Checked: 420px and 360px, command menu, status Card slots, Badge variants, shadcn Button slots for connector actions, detail/form dropdown interactions, detail disclosure, add form, delete dialog, list/action failure recovery, permission denial, action failure, DOM overflow, console/page errors, and visible leak patterns.

Visual review: accepted `connectors-ready-420.png`, `connectors-ready-360.png`, `connectors-detail-dropdown-360.png`, `connectors-form-dropdown-420.png`, `connectors-form-420.png`, `connectors-form-360.png`, `connectors-delete-dialog-focused-360.png`, `connectors-list-failure-360.png`, `connectors-permission-denied-420.png`, and `connectors-action-failure-360.png`. No clipped action labels or horizontal overflow were visible.

UX rubric: clarity 9/10, function 9/10, visual taste 9/10, evidence integrity 9/10, accessibility 9/10, user cognitive load 9/10, architecture fit 9/10, regression risk 9/10, long-horizon usefulness 9/10. No known P1/P2 findings remain for this slice.
