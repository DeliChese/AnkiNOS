# AnkiNOS Themes & Typography (`v1.0.0 Beta`)

The theme architecture was informed by [Onigiri](https://github.com/thepeacemonk/Onigiri) at commit `db8c719fa90eccbb815b0c66809e1ae23febee59`, especially its [light/dark theme definitions](https://github.com/thepeacemonk/Onigiri/blob/db8c719fa90eccbb815b0c66809e1ae23febee59/rendering/themes.py) and [semantic palette completion](https://github.com/thepeacemonk/Onigiri/blob/db8c719fa90eccbb815b0c66809e1ae23febee59/rendering/theme_palette.py). No Onigiri implementation code, stylesheets, icons, or artwork is bundled. This is an independent implementation for AnkiNOS's WebViews and profile storage.

## 12 Curated Color Palettes

1. **NOS Glass** — signature soft frosted glass identity
2. **Tokyo** — inspired by [Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme)
3. **Mononoke** — calm forest greens
4. **Catppuccin** — inspired by [Catppuccin](https://github.com/catppuccin/catppuccin) (Mocha / Latte)
5. **Rosé Pine** — inspired by [Rosé Pine](https://rosepinetheme.com/palette/)
6. **Nord** — inspired by [Nord](https://www.nordtheme.com/docs/colors-and-palettes)
7. **Solarized** — inspired by [Solarized](https://ethanschoonover.com/solarized/)
8. **Dracula** — inspired by [Dracula](https://draculatheme.com/contribute)
9. **Gruvbox** — inspired by [Gruvbox](https://github.com/morhetz/gruvbox)
10. **Everforest** — inspired by [Everforest](https://github.com/sainnhe/everforest)
11. **Kanagawa** — inspired by [Kanagawa](https://github.com/rebelot/kanagawa.nvim)
12. **Sakura** — soft cherry blossom tones tailored for AnkiNOS

Several light variants and surface shades are adjusted specifically for AnkiNOS readability and frosted-glass layering; they are not exact replicas of the upstream projects.

## 8 Offline Typography Presets

All font presets use zero-download cross-OS system font stacks (`Windows` / `macOS` / `Linux` fallbacks) defined in `assets/theme.js`:
`system`, `humanist`, `geometric`, `rounded`, `editorial`, `classic`, `mono`, and `compact`.

## Token Derivation & Contrast Guarantees

`assets/theme.js` owns all palette definitions, font stacks, and derived CSS variables. It resolves `theme` modes (`dusk`, `night`, `oled`, `light`, `system`) together with the independent `color_theme` and `font_family` preferences:

- **OLED** preserves a true black page canvas; **System** follows `prefers-color-scheme` live.
- Selecting a palette sets `accent=auto`; users can override it with a built-in swatch or custom `#RRGGBB` hex color.
- Derived tokens cover surfaces, text, borders, links, primary buttons, status indicators, and heatmap levels. Relative luminance selects readable button text (`>= 3:1` for primary CTA) and adjusts links, secondary text, and semantic status colors to at least **4.5:1** against opaque surfaces.
- Explicit heatmap color choices and deck-folder colors remain independent.

## Strict Card Isolation (`#qa`)

`assets/theme.css` adapts Dashboard, Overview, Statistics, Media Studio, Reviewer chrome, native rating controls, Quick Commands, and Notebook WebViews. It **never** selects or restyles `#qa`, user-authored card templates, or native Anki Editor/Browser dialogs. No application-wide Qt stylesheet (`app.setStyleSheet`) is installed.

## Draft Preview & Validation

Settings are previewed on an isolated sample inside the Settings modal until **Áp dụng** (*Apply*); closing discards unapplied changes. Profile persistence, JSON import/export, and `.nosbackup` archives validate all appearance keys through `theme_settings.py`, `integration.py`, `backup_store.py`, and `assets/dashboard.js`.

**Automated checks:** `tests/test_theme.py`, `tests/test_backup.py`, `node tests/theme-check.mjs`, `node tests/ui-check.mjs`, and `tests/anki-smoke.py`. Browser checks verify **660 contrast combinations** (12 palettes × display modes × accents), live system-mode switching, apply/cancel isolation, responsive `320–768 px` pickers, and `#qa` card isolation.
