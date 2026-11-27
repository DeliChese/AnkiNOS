# AnkiNOS — Agent Working Guide

AnkiNOS (`NOS`) is an offline, zero-dependency Anki desktop add-on (Anki `>= 25.02`, Python 3.12+, PyQt6) providing a glassmorphism Dashboard, Smart Daily Memory Scheduler, Native Statistics workspace, Media Studio, Focus Mode, Quick Commands (`Ctrl+K`), Contextual Notebook, 6 Layouts, 8 Color Palettes, and full Vietnamese/English i18n.

**Stack**: Pure Python (`anki`/`aqt` only in Qt/hook modules) + Vanilla ES2022 JS + CSS + HTML. **No npm, no bundler, no CDN, no external pip packages.**

---

## Non-Negotiable Invariants

1. **Never touch flashcard content or Anki scheduling semantics**:
   - Never restyle `#qa`, card template HTML/CSS, or native editor/browser dialogs.
   - Never alter FSRS parameters, `ivl`, card ordering, or answer grading. Only `daily_bridge.py` shifts `card.due` on standard review cards (`queue=2, odid=0`) with Anki Undo + SQLite rollback ledger.
   - Never install application-wide Qt stylesheets (`app.setStyleSheet`).
2. **Thread safety & Anki lifecycle**:
   - Collection reads run in `QueryOp`; collection mutations run in `CollectionOp` (with `OpChanges` merged). Disk/ZIP/image I/O runs via `mw.taskman` off the UI thread.
   - Never access Qt widgets from background threads; guard async callbacks with `_generation` / `serial` / `live()` / `_navigating`.
   - Keep pure-Python modules (`data.py`, `graphs_data.py`, `study_data.py`, `daily_scheduler.py`, `daily_store.py`, `focus_store.py`, `media_store.py`, `workspace_store.py`, `backup_store.py`, `theme_settings.py`, `i18n.py`) **free of `aqt`/Qt imports** so `tests/run-unit.py` runs fast without GUI.
3. **Persistence validation at ALL boundaries**:
   - Any profile setting must be validated in `theme_settings.py` (if appearance/language), `integration.py` (`settings()` + `_save_ui()`), `backup_store.py` (`clean_settings()`), and `assets/dashboard.js` (`applySettingsDraft()` `keys` allowlist).
   - User-imported files & SQLite DBs live strictly in `user_files/<sha256(profile)[:20]>/`, validated against path traversal/symlinks, never written to `collection.media` or synced to AnkiWeb.
4. **Bilingual i18n parity (`vi` source → `en` complete)**:
   - Vietnamese (`vi`) is the canonical source language in HTML, JS, and Python.
   - Every user-facing string added/changed in HTML/JS MUST have a matching entry/pattern in `assets/i18n-en.js` (zero duplicate keys); native Qt/error strings MUST also be in `i18n.py`.
   - Protect user-authored content (`#qa`, deck names, note bodies, album/image names) with `data-i18n-skip`.
   - Wrap `window.confirm(...)` and instant hover tooltips with `window.NOSI18n.t(...)`.
5. **Standalone preview must keep working offline**:
   - Opening `ankios-ui.html`, `ankios-overview.html`, `ankios-review.html`, or `ankios-tools.html` directly in Chromium (`!native`, no `pycmd`) must render cleanly with mock fixtures (and support `?lang=en`).
6. **DOM reuse & responsiveness**:
   - Never rebuild hidden Library/Stats/Studio DOM unnecessarily; respect `lite_mode`, `blur=false`, `animations=false`, and `320px–1600px` zero horizontal overflow.
   - All theme/palette tokens must maintain WCAG contrast (`>= 4.5:1` text/links/status on `--surface`, `>= 3:1` primary CTA).
7. **Always keep fallback safe**:
   - Wrap top-level WebView content hooks so exceptions call `_fallback(error)` and restore native Anki toolbars (`_restore_chrome()`).

---

## Token-Efficient Navigation (Read Only What You Need!)

**Do NOT read giant files (`integration.py`, `dashboard.js`, `stats-page.js`, `ankios-ui.html`) top-to-bottom.** First consult `docs/FILE-MAP.md` for exact line ranges, or jump directly to the relevant doc/skill:

| If your task touches… | Read this reference doc first | Activate skill (optional) |
| :--- | :--- | :--- |
| System flow, hooks, caching, threads | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | — |
| Finding exact file & line ranges | [docs/FILE-MAP.md](docs/FILE-MAP.md) | — |
| `pycmd` bridge, SQLite DBs, `.nosbackup` | [docs/BRIDGE-AND-DATA.md](docs/BRIDGE-AND-DATA.md) | `anos-bridge-feature` |
| Profile settings & persistence | [docs/BRIDGE-AND-DATA.md](docs/BRIDGE-AND-DATA.md) | `anos-add-setting` |
| Themes, palettes, layouts, CSS, `#qa` | [docs/UI-THEMES-LAYOUTS.md](docs/UI-THEMES-LAYOUTS.md) | `anos-ui-layout-theme` |
| Vietnamese / English i18n or new language | [docs/I18N-GUIDE.md](docs/I18N-GUIDE.md) | `anos-i18n` |
| Choosing & running tests / CI | [docs/TESTING-AND-CI.md](docs/TESTING-AND-CI.md) | `anos-verify` |

---

## Quick Verification Commands (Windows)

Use Anki's bundled Python (`& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe'`) and Node 22+:

```powershell
# 1. Fast checks (<6s, no Chromium — run after every edit)
node tests/i18n-check.mjs
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' -m compileall -q .
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/run-unit.py

# 2. JS syntax check on modified script(s)
node --check assets/dashboard.js

# 3. Targeted browser suites (require local Chrome; run only for affected UI areas)
node tests/ui-check.mjs        # Dashboard, heatmap, library, stats, daily, mobile
node tests/theme-check.mjs     # 440 contrast combos, 8 palettes, overview, reviewer, notebook
node tests/tools-ui.mjs        # Ctrl+K Quick Commands & Notebook dialog

# 4. Full Anki offscreen smoke test (when changing hooks/integration/reviewer_ui)
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/anki-smoke.py
```

All disposable test files must stay under `tests/.tmp/` (gitignored). Never modify `user_files/` or `ankios-ui.original.html`.
