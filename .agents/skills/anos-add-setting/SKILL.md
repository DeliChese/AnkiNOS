---
name: anos-add-setting
description: Use when adding, renaming, or modifying any AnkiNOS profile setting, appearance option, language preference, or config value persisted in config.json and .nosbackup archives.
---

# Adding or Modifying an AnkiNOS Profile Setting

Before editing large files, consult [docs/BRIDGE-AND-DATA.md](../../../docs/BRIDGE-AND-DATA.md) (Settings Schema) and [docs/FILE-MAP.md](../../../docs/FILE-MAP.md) for exact line ranges.

## Checklist (All 4 Persistence Boundaries)

Missing any single boundary causes settings to silently drop on Save, fail `.nosbackup` restore, or desync between WebViews.

1. **Choose ownership**:
   - Appearance / theme / layout / glass / `language` -> owned by `theme_settings.py` (keep zero `aqt`/Qt imports).
   - Non-visual profile preference (goals, collapsed state, daily defaults) -> owned by `integration.py` + `backup_store.py`.
2. **Backend defaults & validation**:
   - If appearance/language: add default, enum/bounds validator, and normalization in `theme_settings.py` (`clean_appearance()` / `theme_payload()`).
   - In `integration.py`:
     - Add default in `settings()` (and `appearance()` if visual).
     - Validate and persist in `_save_ui()` (or dedicated handler).
     - Push live updates to secondary WebViews if relevant (`reviewer_ui.sync_settings()`, `study_tools_ui.sync_settings()`, plus `_config_updated`).
3. **Backup & restore validation**:
   - Update `backup_store.py:clean_settings()` so `.nosbackup` export/restore preserves and sanitizes the new field safely (reject invalid types, clamp ranges, never crash on older v1–v4 archives).
4. **Frontend allowlist & UI (`ankios-ui.html` + `assets/dashboard.js`)**:
   - Add the control in the Settings modal of `ankios-ui.html` (source text in Vietnamese).
   - **CRITICAL**: Add the setting key to the `keys` allowlist inside `applySettingsDraft()` in `assets/dashboard.js` — keys missing from this array are silently discarded on Apply!
   - Populate the control inside `syncSettingsForm()`.
   - Apply its visual/behavioral effect inside `applySettings()` (and in `assets/theme.js` / `assets/overview.js` / `assets/reviewer.js` / `assets/tools.js` if cross-surface).
   - Ensure standalone preview (`!native` mock settings in `dashboard.js`) includes a sensible default.
5. **English i18n parity**:
   - Add every new Vietnamese label, tooltip, option, and description to `assets/i18n-en.js` (zero duplicate keys).
   - If exposed in Qt dialogs/warnings, also add to `i18n.py`.
6. **Tests**:
   - Add validation & round-trip assertions in `tests/test_theme.py` and/or `tests/test_backup.py`.
   - Run:
     ```powershell
     node tests/i18n-check.mjs
     node --check assets/dashboard.js
     & 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' -m compileall -q .
     & 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/run-unit.py
     ```
   - If visual/theme-related, also run `node tests/theme-check.mjs` and `node tests/ui-check.mjs`.
