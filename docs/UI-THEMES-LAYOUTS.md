# AnkiNOS UI, Themes, Layouts & Card Isolation

Reference for modifying HTML, CSS, dashboard layouts, color palettes, glassmorphism, animations, and reviewer styling without regressions.

---

## 1. The 6 Dashboard Layouts (`assets/layouts.js` + `assets/layouts.css`)

Controlled by `#nos-app[data-layout="<id>"]` and `#nos-app[data-sidebar-side="left|right"]`.

| Layout ID | Display Name (VI / EN) | Structure & Special Behavior | Supports `sidebar_side`? |
| :--- | :--- | :--- | :---: |
| `aurora` | Cực quang / Aurora | Default. Vertical frosted rail with elastic SVG hover bulge, ambient aurora glow. | Yes |
| `bento` | Bento | Top navigation bar + bento module grid. | No |
| `dock` | Dock nổi / Floating dock | Centered stage + macOS-style spring-magnifying dock at bottom. | No |
| `sidebar` | Không gian làm việc / Workspace | Expanded labelled sidebar + side panels. | Yes |
| `zen` | Zen | Minimalist large-type focus layout; layout menu pops left of right-side rail. | No |
| `edges` | 4 Cạnh (Ảnh nền) / 4 Edges (Wallpaper) | 4 hidden macOS-style edge docks (`#nos-edge-top`, `.rail` as bottom, `#nos-edge-left`, `#nos-edge-right`) with wallpaper peek mode (`data-edges-peek`). | No |

### Critical `edges` Layout DOM Invariant
On desktop (`min-width: 721px`), `layouts.js:syncEdgeDocks()` **physically reparents** real buttons (`#fullscreen-toggle`, `#study-notebook`, `#launcher-toggle`, `#profile-toggle`, `#layout-toggle`, `[data-action="preferences"]`) into `#nos-edge-*` docks and restores them back to `.rail` / `.topbar-actions` when switching away or shrinking below `721px`.
- **Rule**: Never assume those buttons have a fixed parent selector (e.g., use ID selectors or `[data-action="..."]` instead of `.topbar-actions > #profile-toggle`).
- **Rule**: Keep each edge dock `<= 4` items and ensure `positionLibrary()` / `positionMenu()` handle `edges` geometry.

### Responsive Breakpoints
- `<= 720px` (mobile): Navigation moves to bottom bar; Library popover anchors to `data-side="bottom"`; `edges` unmounts hidden docks.
- `<= 1100px` / `<= 1200px`: Adjusted rail outer width calculations in `dashboard.js:positionLibrary()`.
- Verified widths in automated tests: `320px`, `390px`, `768px`, `1000px`, `1024px`, `1600px` — **zero horizontal overflow (`scrollWidth <= innerWidth`)**.

---

## 2. Theme Engine & WCAG Contrast Contract (`assets/theme.js` + `assets/theme.css`)

### Independent Axes
1. **Color Palette (`color_theme`)**: `nos`, `tokyo`, `mononoke`, `catppuccin`, `rosepine`, `nord`, `solarized`, `dracula` (8 palettes, inspired by Onigiri's semantic model — independent implementation, see `THEME-NOTES.md`).
2. **Mode (`theme`)**: `dusk` (default soft dark), `night` (deep dark), `oled` (pure `#000000` canvas), `light`, `system` (live `prefers-color-scheme` listener).
3. **Accent (`accent` + `custom_accent`)**: `auto` (palette's suggested accent), 6 named swatches (`blue`, `cyan`, `mint`, `purple`, `amber`, `pink`), or `custom` (`#rrggbb`).
4. **Glassmorphism (`blur`, `glass_blur`, `glass_opacity`, `lite_mode`)**:
   - When `blur === false` or `lite_mode === true`: `--glass-blur: 0px`, `--glass-alpha: 100%`, `--glass-card-alpha: 100%`.
   - Otherwise: `--glass-blur: <0..32>px`, `--glass-alpha: <30..100>%`, `--glass-card-alpha: min(100, alpha + 8)%`.

### Automated Contrast Enforcement (`tests/theme-check.mjs`)
`theme.js:visible(color, bg, min)` iteratively blends colors toward readable white/black until WCAG relative-luminance contrast passes across **all 440 combinations**:
- `--text`, `--muted`, `--blue`, `--success`, `--warning`, `--danger` against `--surface`: **`>= 4.5:1`**
- `--blue` against `--accent-soft`: **`>= 4.5:1`**
- `--primary` against `--on-primary`: **`>= 3.0:1`** (checked by `readable()` + `visible(..., 3)`)
- Hover text tokens (`--on-danger`, `--on-warning`, `--on-blue`, `--on-success`) must always be defined for Reviewer rating buttons.
- Print mode (`@media print` in `theme.css`): forces `--surface: #ffffff` and shows all Statistics charts cleanly for PDF export.

---

## 3. Reviewer `#qa` Card Isolation Contract

- `assets/theme.css` and `assets/reviewer.css` **MUST NEVER** restyle `#qa`, user card fonts, card colors, or card backgrounds.
- `assets/reviewer.js` preserves the card template's own `document.body` background color/image onto `#nos-review-card` using a targeted `MutationObserver` watching ONLY `$('#qa')` (`childList: true`, NOT `subtree: true`) and `document.body` (`attributes: ['class', 'style']`), throttled via `requestAnimationFrame`.
  - Why no `subtree: true`? MathJax and interactive card scripts mutate thousands of DOM nodes inside `#qa`.
- `window.qFade = 0` disables Anki's fade animation for instant card reveal; rating buttons (`assets/reviewer-bottom.js` / `.css`) remain native Anki buttons decorated with `.nos-btn-fill` radial hover and `data-nos-key` badges (height `<= 54px`).
- `#nos-review-card` carries `data-i18n-skip` so `NOSI18n` never modifies card content.

---

## 4. Performance & Motion Rules

- **Respect Motion Flags Everywhere**: Check `lite_mode`, `animations === false` (`data-animations="off"` / `.reduce-motion` / `.no-motion`), and `prefers-reduced-motion: reduce`. Disable ripples, 3D tilt, View Transitions, dock spring magnification, and aurora drift when motion is off.
- **Backdrop-Filter Restraint**: Avoid heavy `backdrop-filter: blur(...)` on giant scrolling containers (like the full Library or Stats grids); use tinted glass backgrounds and `content-visibility: auto` on offscreen rows/thumbnails/charts.
- **DOM Reuse Invariants** (enforced by `tests/ui-check.mjs`):
  - Re-opening Library without data changes must NOT rebuild `#deck-list`.
  - Expanding one parent deck must replace ONLY that branch (`children.parentElement.outerHTML`).
  - Returning to Stats with the same filter must reuse existing `#stats-report` card nodes.
  - Clicking thumbnails in Media Studio must only toggle `.selected` / `aria-pressed` (no gallery rebuild, no full-res decode in inspector).
- **Settings Preview Isolation**: Changes inside `#settings-dialog` preview ONLY on `#theme-preview` and `#language-preview` until the user clicks **Apply** (`#btn-apply-settings`); closing discards `settingsDraft`.
