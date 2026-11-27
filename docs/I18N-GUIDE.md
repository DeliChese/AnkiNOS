# AnkiNOS Internationalization (i18n) Guide

AnkiNOS uses **Vietnamese (`vi`) as the canonical source language** across all HTML templates, JavaScript modules, and Python modules, with **100% English (`en`) coverage** across every WebView surface and native Qt dialog/menu.

---

## 1. Dual-Layer Architecture

### Layer A — WebView DOM Engine (`assets/i18n.js` + `assets/i18n-en.js`)
- Loaded **first** on all 5 WebView surfaces:
  1. Dashboard (`ankios-ui.html` + `integration.py`)
  2. Overview (`ankios-overview.html` + `integration.py`)
  3. Reviewer (`ankios-review.html` + `reviewer_ui.py`)
  4. Reviewer Controls Preview (`assets/reviewer-controls-preview.html`)
  5. Quick Commands & Notebook (`ankios-tools.html` + `study_tools_ui.py`)
- **How `window.NOSI18n` works**:
  - `register(id, {name, native, locale, dict, patterns})`: Registers a language pack.
  - `set(lang)`: Switches active language (unknown codes fall back to `'vi'`), translates `document.title` and `document.body`, sets `<html lang="...">`, attaches a `MutationObserver` (batched per `requestAnimationFrame`) when `lang !== 'vi'`, and dispatches `CustomEvent('nos:language', {detail: {language}})`.
  - Keeps original source strings in `WeakMap`s (`texts`, `attrs`) and `titleRec`, so toggling back to `'vi'` restores exact Vietnamese text cleanly.
  - Translates text nodes AND `['title', 'aria-label', 'placeholder', 'alt']` attributes.
  - Uses separate skip selectors:
    - `SKIP_TEXT = 'script,style,textarea,[data-i18n-skip]'` (never modifies user-typed `<textarea>` text or `<textarea hidden>` JSON bootstraps).
    - `SKIP_ATTR = 'script,style,[data-i18n-skip]'` (DOES translate `<textarea placeholder="...">` and `aria-label`!).
  - Provides locale-aware cached formatters: `NOSI18n.numberFormat(opts)`, `NOSI18n.dateFormat(opts)`, `NOSI18n.locale()`.
  - Provides synchronous helpers: `NOSI18n.t(text)` (active language) and `NOSI18n.preview(text, lang)` (used by Settings → Language preview without changing the live page).

### Layer B — Pure-Python Qt & Error Translator (`i18n.py`)
- Zero Qt imports; exports `translate(text, lang)` and `format_restore_preview(..., lang)`.
- Used by `integration.py` (`_t()`), `reviewer_ui.py` (`_t()`), `study_tools_ui.py` (`_t()`, `sync_settings()`), and `daily_bridge.py` (Anki Undo labels).
- Pure-Python store/scheduler modules (`backup_store.py`, `daily_scheduler.py`, `media_store.py`, `workspace_store.py`, `focus_store.py`, `study_data.py`, `graphs_data.py`) keep Vietnamese error/summary strings so:
  - Unit tests stay decoupled from profile language state.
  - Persisted SQLite records (`daily_schedule.sqlite3` ledger batches, `workspace.sqlite3` `"Ghi chú chung"`) stay consistent even when the user later switches languages — and get translated on the fly in the WebView DOM!

---

## 2. Protecting User Content (`data-i18n-skip`)

Always add `data-i18n-skip` on elements displaying user-authored text so a deck/note/album named `"Hôm nay"` or `"Ghi nhớ"` is never silently renamed in English mode:
- `#nos-review-card` (Anki flashcard `#qa` HTML)
- `.deck-name`, `#overview-name`, `#overview-description`, `#overview-parent` (when parent exists), `#stats-deck-name` (when custom deck), `.stats-deck-option-name`, `#study-deck option`, `.study-insight h3`, `.daily-tree-name`, `#nos-review-deck`, `#tool-context` (when deck set)
- `.resource-name`, custom album names/options, photo names in Media Studio
- User note titles/body snippets in `#note-list`, rendered Markdown in `#note-md-preview` (removed when showing the empty placeholder), and non-action titles in `#command-results`
- Language selector cards (`#language-grid`) and `#language-preview`

---

## 3. Mandatory Patterns When Writing New UI Code

1. **Wrap non-DOM prompts**: `window.confirm(window.NOSI18n ? window.NOSI18n.t('...') : '...')`.
2. **Wrap synchronous floating tooltips**: `tip.textContent = window.NOSI18n.t(raw)` (avoids 1-frame Vietnamese flicker before `MutationObserver`'s rAF flush).
3. **Use `NOSI18n.numberFormat()` / `NOSI18n.dateFormat()`**: Never hardcode `new Intl.NumberFormat('vi-VN')` or `'0,00'`.
4. **Listen to `nos:language`** in any module that formats numbers, dates, or localized SVG ticks into cached HTML (`dashboard.js`, `overview.js`, `stats-page.js`, `focus-dashboard.js`, `study-dashboard.js`, `daily-schedule.js`, `media-studio.js`, `reviewer.js`).
5. **Standalone preview `?lang=en`**: Supported across `ankios-ui.html`, `ankios-overview.html`, `ankios-review.html`, `assets/reviewer-controls-preview.html`, and `ankios-tools.html` for quick visual/automated verification.

---

## 4. Common i18n Pitfalls (Read Before Editing `assets/i18n-en.js`!)

1. **Duplicate keys in `dict`**: JavaScript silently lets the second key overwrite the first (e.g., `"Lọc:"` for `"Filter:"` vs `", Lọc:"` for `", Filtered:"`). `tests/i18n-check.mjs` strictly fails on ANY duplicate key!
2. **Regex ordering in `patterns`**: Always place specific patterns **before** catch-all `(.+)` patterns!
   - Example: `/^(\d{2}\/\d{2}\/\d{4}): Không có lượt ôn$/` MUST come BEFORE `/^(\d{2}\/\d{2}\/\d{4}): (.+) lượt ôn$/`.
3. **Whitespace normalization**: `assets/i18n.js` runs `value.replace(/\s+/g, ' ').trim()` BEFORE lookup. Multiline strings (e.g. `title` attributes containing `\n`) arrive with spaces, NOT `\n`! Write patterns matching spaces.
4. **Text nodes split by inline tags**: `<p>Đã học <strong>24 thẻ</strong> trong <strong>16 phút</strong></p>` produces separate text nodes (`"Đã học"`, `"24 thẻ"`, `"trong"`, `"16 phút"`). Translate each fragment cleanly.
5. **HTML numeric entities**: Some legacy markup uses `&#272;&#243;ng` instead of `Đóng`; the browser decodes them before `NOSI18n` sees them. Prefer plain UTF-8 Vietnamese text in new HTML.

---

## 5. How to Add a Third Language (e.g., Japanese `ja`)

1. Add `"ja"` to `LANGUAGES` in `theme_settings.py`.
2. Create `assets/i18n-ja.js` calling `window.NOSI18n.register('ja', {name, native, locale, dict, patterns})`.
3. Load `i18n-ja.js` after `i18n.js` in:
   - `integration.py:_replace_content`
   - `reviewer_ui.py:_review_content`
   - `study_tools_ui.py:ToolDialog.__init__`
   - `ankios-ui.html`, `ankios-overview.html`, `ankios-review.html`, `ankios-tools.html`, `assets/reviewer-controls-preview.html`
4. Add a language radio button card in `#language-grid` (`ankios-ui.html`).
5. Add `"ja"` translation tables to `i18n.py` for native Qt dialogs/menus.
6. Update `tests/test_theme.py`, `tests/test_i18n.py`, and `tests/i18n-check.mjs`.

---

## 6. Verification

```powershell
node tests/i18n-check.mjs
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' -m unittest discover -s tests -p 'test_i18n.py'
```
