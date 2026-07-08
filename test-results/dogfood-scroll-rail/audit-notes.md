# Automation Scroll Rail Audit

Scope: Automation page dense filter row and Automation card metadata rail after the shadcn ScrollArea substrate slice.

Screenshots inspected:

1. `automation-scroll-420-clean.png` - healthy. The page hierarchy is stable, the filter row is compact, and the first card shows metadata without wrapping into a tall chip block.
2. `automation-scroll-420-meta-scrolled.png` - healthy. Horizontal rail behavior exposes later metadata chips without creating page-level overflow.
3. `automation-scroll-360-clean.png` - healthy. The card title truncates instead of pushing controls offscreen, action buttons remain reachable, and the metadata rail stays bounded.
4. `automation-scroll-360-meta-scrolled.png` - healthy. The scrolled metadata state is understandable at narrow width and keeps the primary card actions visible.

Strengths:

- The filter rail and metadata rail use labelled shadcn/Radix ScrollArea structure instead of ad hoc overflow.
- At 360px and 420px, the page width stays bounded and the dense metadata row no longer compresses chips into unreadable slivers.
- The filters were dogfooded with Active, Paused, and Clear filters at both widths; card visibility changed correctly.
- The UI keeps Automation actions visible while the secondary metadata scrolls independently.

UX risks:

- The horizontal scrollbar is subtle. It is acceptable for this dense secondary row, but future broader workbench rebuild slices should not rely on horizontal rails for primary actions.
- At 360px, long card titles truncate aggressively. This is preferable to overflow, but a future card rewrite should consider a two-line title rule if more context becomes necessary.

Accessibility risks:

- The rails have explicit `aria-label` values and keyboard focus remains reachable through the page, but this audit did not run a screen reader.
- Horizontal scroll areas can be harder for keyboard-only users if the focused child does not naturally bring hidden content into view. This slice keeps the metadata read-only; future interactive content inside rails should add stronger keyboard checks.

Evidence limits:

- This audit used production-bundle Playwright with a contract-shaped Chrome runtime stub, not a live installed Chrome extension.
- The screenshots prove visual state and DOM checks prove overflow/slot structure, but they do not prove assistive-technology announcement quality.

Recommendation:

- Accept this slice. It improves narrow-width Automation readability without capability loss, fake data, or page overflow. Keep the pattern scoped to dense secondary rows until the larger workbench rebuild replaces the old Automation layout.
