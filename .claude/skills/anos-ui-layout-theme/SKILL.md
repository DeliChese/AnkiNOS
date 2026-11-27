---
name: anos-ui-layout-theme
description: Use when editing AnkiNOS HTML, CSS, dashboard layouts (aurora/bento/dock/edges/workspace/zen), color palettes, contrast tokens, glassmorphism, responsive breakpoints, or reviewer/tools UI.
---

# Editing AnkiNOS UI, Layouts, and Themes Safely

Consult [docs/UI-THEMES-LAYOUTS.md](../../../docs/UI-THEMES-LAYOUTS.md) and [docs/FILE-MAP.md](../../../docs/FILE-MAP.md) before touching CSS or layout markup.

## Non-Negotiable Visual & DOM Invariants

1. **Card Content (`#qa`) & Native Qt Isolation**:
   - Never apply AnkiNOS styles inside `#qa` or override card template typography/backgrounds/scripts.
   - Never install an app-wide Qt stylesheet (`app.setStyleSheet`).
   - Keep Reviewer bottom bar height stable and disable whole-card fade animations when NOS is active.
2. **Color Palettes & WCAG Contrast (`assets/theme.js` + `assets/theme.css`)**:
   - Never hardcode light/dark text or surface hex colors in component CSS — use theme tokens (`--surface`, `--surface-2`, `--text`, `--muted`, `--accent`, `--border`, `--danger`, `--ok`, etc.).
   - All **8 palettes × 5 modes × 8 accents** must pass WCAG contrast: `>= 4.5:1` for text/links/status on `--surface`, `>= 3:1` for primary CTA buttons.
   - Test both light (`light`) and dark (`dusk`, `dark`, `oled`) modes plus `system`.
3. **6 Dashboard Layouts & `edges` DOM Reparenting**:
   - Layouts: `aurora`, `bento`, `dock`, `edges`, `workspace`, `zen`.
   - `edges` dynamically reparents nav/brand/actions nodes inside `applyLayout()` (`assets/dashboard.js`). Never assume fixed ancestor selectors for those elements; always restore original parent slots cleanly when switching away from `edges`.
4. **Performance, Lite Mode & Motion Flags**:
   - Respect `body[data-lite="1"]`, `body[data-blur="0"]`, `body[data-anim="0"]`, and `@media (prefers-reduced-motion: reduce)`.
   - Avoid `backdrop-filter` on large scrolling containers; use `content-visibility: auto` on offscreen heavy rows/charts (ensuring `@media print` reveals all Stats charts for PDF export).
   - Preserve DOM reuse for Library tree, Stats charts, and Studio thumbnails — never recreate hidden DOM on every state update.
5. **Responsiveness & Accessibility**:
   - Maintain **zero horizontal overflow** across `320px–1600px` (mobile bottom nav on narrow widths).
   - Preserve keyboard focus rings, Escape-to-close on modals/popovers, and focus restoration to trigger buttons.
6. **i18n & Standalone Preview**:
   - Write source UI text in Vietnamese, add English entries in `assets/i18n-en.js`, and put `data-i18n-skip` on user data containers.
   - Verify standalone HTML files open cleanly offline without `pycmd`.

## Verification

```powershell
node tests/i18n-check.mjs
node tests/theme-check.mjs
node tests/ui-check.mjs
node tests/tools-ui.mjs
```
(Run `tools-ui.mjs` when touching `ankios-tools.html` / `assets/tools.css` / `commands.js` / `notebook.js`.)
