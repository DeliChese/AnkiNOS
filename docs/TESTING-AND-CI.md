# AnkiNOS Testing & CI Guide

All tests run with **zero npm dependencies** and keep temporary artifacts strictly inside `tests/.tmp/` (gitignored).

---

## 1. Environment Setup (Windows Local vs Linux CI)

- **Python with `anki` / `aqt`** (Windows local):
  ```powershell
  $PY = 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe'
  ```
- **Node.js**: `v22+` (built-in `WebSocket`, `fetch`, `node:test`/`node:assert`).
- **Chromium**: Local Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe` on Windows, `/usr/bin/google-chrome` on CI). Override via `$env:NOS_CHROME`.
- **Anki packages override**: Set `NOS_ANKI_PACKAGES` if testing against a custom Anki `app_packages` folder.

> **Sandbox note (Windows)**: Headless Chromium CDP tests (`ui-check.mjs`, `theme-check.mjs`, `tools-ui.mjs`, `perf-check.mjs`) bind a local loopback debugging port and launch Chrome's crashpad process — run them outside restricted sandboxes if local port binding is blocked. All Python unit tests, syntax checks, and `i18n-check.mjs` run cleanly inside standard sandboxes.

---

## 2. Change-to-Test Matrix (Save Time & Tokens!)

Run the **fast baseline** (`i18n-check.mjs` + `compileall` + `run-unit.py`, ~6 seconds total) after every edit, plus **only the targeted suites** for the layer you modified:

| What You Changed | Minimum Required Commands |
| :--- | :--- |
| Any `.py` file | `& $PY -m compileall -q .` + `& $PY tests/run-unit.py` |
| Any `assets/*.js` file | `node --check assets/<file>.js` |
| Any UI text, `i18n.js`, `i18n-en.js`, `i18n.py` | `node tests/i18n-check.mjs` + `& $PY -m unittest discover -s tests -p 'test_i18n.py'` |
| `theme_settings.py`, `theme.js`, `theme.css`, color/contrast | `& $PY -m unittest discover -s tests -p 'test_theme.py'` + `node tests/theme-check.mjs` |
| `dashboard.js`, `layouts.*`, `stats-page.*`, `daily-schedule.*`, `media-studio.*`, `ankios-ui.html`, `overview.*` | `node tests/ui-check.mjs` |
| `tools.*`, `commands.js`, `notebook.js`, `ankios-tools.html`, `workspace_store.py`, `study_tools_*` | `& $PY -m unittest discover -s tests -p 'test_workspace.py'` + `node tests/tools-ui.mjs` |
| `daily_scheduler.py`, `daily_store.py`, `daily_bridge.py` | `& $PY -m unittest discover -s tests -p 'test_daily_scheduler.py'` |
| `backup_store.py`, `media_store.py`, `focus_store.py` | `& $PY -m unittest discover -s tests -p 'test_backup.py'` (+ `test_media.py`, `test_focus.py`) |
| `data.py`, `graphs_data.py`, `study_data.py` | `& $PY tests/run-unit.py` (+ `& $PY tests/data-perf.py` if touching SQL/caching) |
| `integration.py`, `reviewer_ui.py`, Anki hooks | `& $PY tests/anki-smoke.py` + `node tests/ui-check.mjs` |

---

## 3. Complete Test Catalog (`tests/`)

### Fast Pure-Python Unit Suite (`& $PY tests/run-unit.py`)
Discovers all `tests/test_*.py` (~5.5s, 72+ tests):

| Test File | Tests What | Requires `anki`? |
| :--- | :--- | :---: |
| `test_i18n.py` | `i18n.py` exact/pattern translations & bilingual restore preview HTML | No |
| `test_theme.py` | `theme_settings.py` validation (modes, palettes, accents, layouts, sidebar_side, glass sliders, language) | No |
| `test_media.py` | `media_store.py` image/album validation, path-traversal defense, delete cleanup | No |
| `test_focus.py` | `focus_store.py` timer checkpoints, pause/resume/interrupt, 2000-row cap, 14-day history | No |
| `test_workspace.py` | `workspace_store.py` note CRUD, accent-insensitive Vietnamese search, trash/archive, DB validation | No |
| `test_backup.py` | `backup_store.py` v1–v4 export/inspect/restore, SHA-256 tamper rejection, atomic rollback, deck-name remapping | No |
| `test_daily_scheduler.py` | `daily_scheduler.py` + `daily_store.py` + `daily_bridge.py` FSRS/SM-2 R math, adaptive window, swap refinement, Undo + rollback ledger, Today filtered deck safety | No |
| `test_data.py` | `data.py` snapshot/overview queries, rollover boundaries, streak CTE, incremental cache invalidation | Yes (`anki`) |
| `test_graphs_data.py` | `graphs_data.py` native `col._backend.graphs()`, calendar full-history days, scoped metrics | Yes (`anki`) |
| `test_study.py` | `study_data.py` timing quantiles (25/50/75%), retention drop & repeated lapse insights | Yes (`anki`) |

### Node.js & Headless Chromium Suites

| Test File | Runtime | Tests What |
| :--- | :---: | :--- |
| `tests/i18n-check.mjs` | <0.2s (Node only) | Zero duplicate keys in `i18n-en.js`, 100% coverage of all 5 HTML files (decoding numeric entities, respecting `data-i18n-skip`), 49+ dynamic pattern spot checks. |
| `tests/ui-check.mjs` | ~15–25s (Chrome) | Full Dashboard E2E: profile, heatmap (Year/Month/Week, Gregorian 2006–2026 leap years), nested decks, grid/list, Vietnamese search, XSS escaping, Stats 13 cards & cached round-trip timing, Studio DOM reuse, mobile 390px, updates `previews/*.png`. |
| `tests/theme-check.mjs` | ~10–15s (Chrome) | All 440 color/mode/accent WCAG contrast combos, draft/apply/cancel, 8 palettes, live `prefers-color-scheme`, print mode, 320–768px picker fit, Overview, Reviewer `#qa` style isolation, rating bar height/tokens, Notebook theme. |
| `tests/tools-ui.mjs` | ~8s (Chrome) | `Ctrl+K` Quick Commands (keyboard, accent-insensitive search, stale-seq ignore, XSS safety) & Notebook (CRUD, Markdown toolbar/preview, trash/restore, archive readonly, corner pocket minimize/restore, 320–1024px fit). |
| `tests/perf-check.mjs` | ~15s (Chrome) | 12,300 synthetic decks (300 × 40) Library open/reopen/expand benchmark -> `previews/performance-after.json`. |
| `tests/anki-smoke.py` | ~20–30s (Qt offscreen) | Boots real Anki `mw` offscreen on disposable profile -> tests DeckBrowser, Overview, Reviewer, Backup, Daily Schedule, Tools hooks end-to-end -> `previews/anki-report.json`. |
| `tests/data-perf.py` | ~10s (Anki) | 20,000 cards / 600,000 revlog synthetic benchmark -> `previews/data-performance-after.json`. |

---

## 4. CI Pipeline (`.github/workflows/code-checks.yml`)

Triggered on `push` to `master` and all `pull_request`s (Ubuntu, Python 3.12, Node 22):
1. Python `compileall` across all backend modules
2. Pure-Python unit tests (`test_media`, `test_theme`, `test_i18n`, `test_backup`, `test_daily_scheduler`, `test_focus`, `test_workspace`)
3. `pip install "anki>=25.02,<27"` + `test_graphs_data.py`
4. `node --check` on all 17 `assets/*.js` files
5. `node tests/i18n-check.mjs`
6. `node tests/ui-check.mjs` & `node tests/theme-check.mjs` with `/usr/bin/google-chrome`
