# AnkiNOS — Claude Code Guide

AnkiNOS (`NOS`) is an offline, zero-dependency Anki desktop add-on (`anki >= 25.02`, Python 3.12+, PyQt6) delivering a glassmorphism Dashboard, Smart Daily Memory Scheduler, Native Statistics workspace, Media Studio, Focus Mode, Quick Commands (`Ctrl+K`), Contextual Notebook, 6 Layouts, 8 Color Palettes, and full Vietnamese/English i18n.

**Stack**: Pure Python (`anki`/`aqt` only in UI/hook layers) + Vanilla ES2022 JS + CSS + HTML. **No npm, no build pipeline, no CDN, no external runtime packages.**

---

## Core Engineering Rules

1. **Card & Scheduler Safety**:
   - Never restyle `#qa`, user card templates, or native Anki editor/browser dialogs; never install an app-wide Qt stylesheet.
   - Never alter FSRS parameters, `ivl`, card queue ordering, or rating behavior. Only `daily_bridge.py` updates `card.due` on standard review cards (`queue=2, odid=0`) with Anki Undo + `daily_schedule.sqlite3` rollback ledger.
2. **Anki Threading & Qt Isolation**:
   - Collection reads -> `QueryOp`; collection writes -> `CollectionOp` (merge `OpChanges`); heavy disk/ZIP/image work -> `mw.taskman`.
   - Guard async callbacks with `_generation` / `serial` / `live()` / `_navigating`.
   - Keep pure-Python modules (`data.py`, `graphs_data.py`, `study_data.py`, `daily_scheduler.py`, `daily_store.py`, `focus_store.py`, `media_store.py`, `workspace_store.py`, `backup_store.py`, `theme_settings.py`, `i18n.py`) **zero-Qt** so `tests/run-unit.py` runs without Anki GUI.
3. **4-Boundary Persistence Validation**:
   - Every profile setting must be registered & validated across `theme_settings.py` (appearance/language), `integration.py` (`settings()` + `_save_ui()`), `backup_store.py` (`clean_settings()`), and `assets/dashboard.js` (`applySettingsDraft()` `keys` allowlist).
   - Store all local media/SQLite files under `user_files/<sha256(profile)[:20]>/` (never `collection.media`, never synced to AnkiWeb).
4. **Full Vietnamese/English i18n Parity**:
   - Vietnamese (`vi`) is canonical source; every new/changed UI string must be added to `assets/i18n-en.js` (no duplicate keys), and native Qt/error strings to `i18n.py`.
   - Mark user-authored content (`#qa`, deck names, note text, album/image names) with `data-i18n-skip`.
   - Wrap `window.confirm(...)` and synchronous tooltips with `window.NOSI18n.t(...)`.
5. **Standalone Browser Preview & Performance**:
   - Every HTML surface (`ankios-ui.html`, `ankios-overview.html`, `ankios-review.html`, `ankios-tools.html`) must work standalone in Chromium without `pycmd` (supporting `?lang=en`).
   - Preserve DOM reuse (Library, Stats, Studio), `lite_mode` / `blur=false` / `animations=false`, WCAG contrast (`>= 4.5:1`), and zero horizontal overflow from `320px` to `1600px`.
6. **Fail-Safe Recovery**:
   - WebView content hooks must roll back to native HTML and call `_fallback(error)` + `_restore_chrome()` on unhandled exceptions.

---

## Token-Saving Workflow (Read Targeted Docs, Not Giant Files)

Large files (`integration.py` ~1.7k lines, `stats-page.js` ~1.8k lines, `dashboard.js` ~1.3k lines, `ankios-ui.html` ~800 lines) are indexed by exact line ranges in `docs/FILE-MAP.md`. Always look up line ranges first instead of reading whole files.

| Task Area | Reference Doc | Claude Skill |
| :--- | :--- | :--- |
| Architecture, hooks, caches, threading | `docs/ARCHITECTURE.md` | — |
| Exact file/symbol/line-range lookup | `docs/FILE-MAP.md` | — |
| `pycmd` bridge, SQLite stores, `.nosbackup` | `docs/BRIDGE-AND-DATA.md` | `.claude/skills/anos-bridge-feature/SKILL.md` |
| Adding/changing profile settings | `docs/BRIDGE-AND-DATA.md` | `.claude/skills/anos-add-setting/SKILL.md` |
| Themes, layouts, CSS tokens, `#qa` safety | `docs/UI-THEMES-LAYOUTS.md` | `.claude/skills/anos-ui-layout-theme/SKILL.md` |
| i18n (`vi`/`en` or adding a language) | `docs/I18N-GUIDE.md` | `.claude/skills/anos-i18n/SKILL.md` |
| Running targeted unit/browser/smoke tests | `docs/TESTING-AND-CI.md` | `.claude/skills/anos-verify/SKILL.md` |

---

## Essential Commands (Windows)

```powershell
# Fast checks (<6s, no browser)
node tests/i18n-check.mjs
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' -m compileall -q .
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/run-unit.py

# JS syntax check
node --check assets/dashboard.js

# Browser suites (Chromium CDP, no npm)
node tests/ui-check.mjs
node tests/theme-check.mjs
node tests/tools-ui.mjs

# Offscreen Anki smoke test
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/anki-smoke.py
```

Keep all temp artifacts inside `tests/.tmp/`. Never edit `user_files/` or `ankios-ui.original.html`.
