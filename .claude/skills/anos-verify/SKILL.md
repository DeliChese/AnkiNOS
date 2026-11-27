---
name: anos-verify
description: Use before completing any AnkiNOS change to select the exact minimal verification commands from the change-to-test matrix, run Python/Node/Chromium/Anki checks on Windows, and confirm clean workspace state.
---

# Verifying AnkiNOS Changes Efficiently

Consult [docs/TESTING-AND-CI.md](../../../docs/TESTING-AND-CI.md) for the complete test catalog and CI workflow details.

## Environment Rules (Windows)

- **Python**: Always invoke Anki's bundled Python — never bare `python`:
  `& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe'`
- **Node**: Node 22+ on PATH (`node`).
- **Chromium CDP tests** (`ui-check.mjs`, `theme-check.mjs`, `tools-ui.mjs`): Require local Chrome (or `NOS_CHROME` env var). In sandboxed shells where Chrome crashpad pipe fails, run Chromium tests unsandboxed while keeping Python/syntax/i18n checks sandboxed.

## Change-to-Test Matrix (Run Minimal Required Set)

| Changed Area | Required Commands |
| :--- | :--- |
| **Any edit (baseline, <6s)** | `node tests/i18n-check.mjs` + `compileall` + `tests/run-unit.py` + `node --check` on edited `assets/*.js` |
| `assets/i18n*.js` or `i18n.py` | Baseline (`i18n-check.mjs` + `test_i18n.py` inside `run-unit.py`) + `?lang=en` DOM sanity if markup changed |
| `assets/theme*.js/css`, `theme_settings.py`, `dashboard.css`, `overview.*`, `reviewer.*` | Baseline + `node tests/theme-check.mjs` + `node tests/ui-check.mjs` |
| `ankios-ui.html`, `dashboard.js`, `stats-page.js`, `daily-schedule.js`, `media-studio.js`, `study-dashboard.js`, `focus-dashboard.js` | Baseline + `node tests/ui-check.mjs` |
| `ankios-tools.html`, `tools.*`, `commands.js`, `notebook.js`, `study_tools_*` | Baseline + `node tests/tools-ui.mjs` |
| `data.py`, `graphs_data.py`, `study_data.py` | Baseline + `tests/test_data.py` |
| `integration.py`, `reviewer_ui.py`, `study_tools_ui.py`, `daily_bridge.py`, `__init__.py` | Baseline + `tests/anki-smoke.py` |
| Performance-sensitive query/UI refactor | Above + `node tests/perf-check.mjs` and/or `tests/data-perf.py` |

## Exact Commands

```powershell
# Tier 1 — Always (<6s)
node tests/i18n-check.mjs
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' -m compileall -q .
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/run-unit.py

# Tier 2 — Browser CDP (targeted)
node tests/ui-check.mjs
node tests/theme-check.mjs
node tests/tools-ui.mjs

# Tier 3 — Real Anki integration (when hooks/data/bridge changed)
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/test_data.py
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/anki-smoke.py
```

## Final Hygiene Check

Run `git status -s` and confirm:
- No stray temporary files outside `tests/.tmp/` (gitignored).
- Zero modifications to `user_files/` or `ankios-ui.original.html`.
- No broken CI checks relative to `.github/workflows/code-checks.yml`.
