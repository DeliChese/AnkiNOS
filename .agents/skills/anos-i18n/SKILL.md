---
name: anos-i18n
description: Use when adding or editing user-facing UI text, maintaining Vietnamese-to-English i18n parity across HTML/JS/Python Qt dialogs, protecting user content with data-i18n-skip, or adding a new language.
---

# Maintaining AnkiNOS i18n (`vi` Source -> `en` Complete)

Read [docs/I18N-GUIDE.md](../../../docs/I18N-GUIDE.md) for the full architecture and [docs/FILE-MAP.md](../../../docs/FILE-MAP.md) for line ranges.

## Core Rules

1. **Vietnamese (`vi`) is the canonical source language** in all HTML, JS, and Python files. Never hardcode English-only strings in markup or templates.
2. **Frontend dictionary (`assets/i18n-en.js`)**:
   - Add exact strings to `dict` (zero duplicate keys — `i18n-check.mjs` fails on duplicates).
   - Add dynamic templates to `patterns` (array of `[RegExp, replacer]`).
   - **Ordering matters**: place specific patterns BEFORE broad patterns (e.g. `Không có lượt ôn` before `(.+) lượt ôn`).
   - **Whitespace normalization**: `assets/i18n.js:norm()` collapses `\s+` (including `\n`) to single spaces before lookup. Write multiline `title` patterns matching spaces, not `\n`.
   - **Unit prefixes**: allow `[<>≤≥]` where intervals like `<1 phút` appear.
   - Use `window.NOSI18n.numberFormat()` instead of hardcoded `'vi-VN'` or comma decimals (`'0,00'`).
3. **Backend / Qt dictionary (`i18n.py`)**:
   - Keep `i18n.py` pure Python (zero Qt imports).
   - Add every Qt menu, `askUser`, `showInfo`, `showWarning`, `QFileDialog`, `QInputDialog`, compatibility alert, and Anki Undo label to `i18n.py`.
   - Wrap Qt text with `_t(...)` in `integration.py` or `translate(..., lang)` in `reviewer_ui.py` / `study_tools_ui.py` / `daily_bridge.py`.
   - If adding a Quick Command in `study_tools_data.py`, include both Vietnamese and English keywords in its search text.
4. **Protect user-authored content (`data-i18n-skip`)**:
   - Always set `data-i18n-skip` on elements holding user data: `#qa`, deck names, parent deck names, deck descriptions, note bodies/titles, album/photo names, resource names, native card previews, and user `<select>` deck options.
   - Note: `assets/i18n.js` still translates `placeholder` and `aria-label` on `<textarea>`, while skipping textarea body text.
5. **Non-DOM strings & live switching**:
   - Wrap `window.confirm(...)`, instant hover tooltips (`heat-tooltip`, `data-tip`), SVG axis ticks, and markdown helper placeholders with `window.NOSI18n.t(...)`.
   - Subscribe dynamic views to `window.addEventListener('nos:language', ...)` so switching language in Settings re-renders immediately without reload.
   - Ensure standalone previews support `?lang=en`.

## Verification

```powershell
node tests/i18n-check.mjs
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/run-unit.py
```
If modifying DOM structure or dynamic tooltips, also check standalone HTML with `?lang=en` and run `node tests/ui-check.mjs` / `node tests/tools-ui.mjs`.
