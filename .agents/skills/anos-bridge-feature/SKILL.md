---
name: anos-bridge-feature
description: Use when implementing a new AnkiNOS feature, pycmd bridge command, SQLite store, background QueryOp/CollectionOp task, or backup-integrated local dataset.
---

# Building a Bridge Feature or Local Store in AnkiNOS

Consult [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md), [docs/BRIDGE-AND-DATA.md](../../../docs/BRIDGE-AND-DATA.md), and [docs/FILE-MAP.md](../../../docs/FILE-MAP.md) first so you only read the exact sections you need.

## Implementation Runbook

1. **Keep pure logic Qt-free**:
   - Place data queries, schedulers, and SQLite stores in standalone Python modules with **zero `aqt`/PyQt6 imports** so `tests/run-unit.py` tests them without Anki GUI.
2. **Local storage & security (if adding a SQLite DB or files)**:
   - Store under `user_files/<sha256(profile)[:20]>/` using `profile_dir()`. Never write into `collection.media` or sync to AnkiWeb.
   - Enable SQLite `WAL` mode, validate filenames against traversal/symlinks, and enforce explicit row/size limits.
   - Register the DB/files in `backup_store.py` (manifest entry, SHA-256, size cap, SQLite schema validation, restore preview counter in `i18n.py:format_restore_preview`, and atomic rollback).
3. **Wire the `pycmd` bridge (`integration.py`, `reviewer_ui.py`, `study_tools_ui.py`, or `daily_bridge.py`)**:
   - Follow existing prefixes: `nos:` (Dashboard/Overview), `daily` (Daily Schedule), `nos-review:` (Reviewer), `nostool:` (Quick Commands & Notebook).
   - **Threading**:
     - Read collection -> `QueryOp(parent=mw, op=..., success=...)`.
     - Mutate collection -> `CollectionOp` (merge `OpChanges`, pass translated Undo label via `i18n.translate(..., lang)`).
     - Heavy disk/ZIP/image I/O -> `mw.taskman.run_in_background(...)`.
   - **Stale-callback protection**: capture `_generation` / `serial` before async dispatch; check `live()` and `not _navigating` in `.success(...)` before calling `web.eval(...)`. Never touch Qt widgets from worker threads.
   - **Never alter FSRS/card scheduling semantics** unless explicitly shifting `card.due` on `queue=2, odid=0` with Undo + rollback ledger like `daily_bridge.py`.
4. **Frontend JS wiring**:
   - Provide offline mock handling when `!native` (no `pycmd`) so standalone HTML previews still work (including `?lang=en`).
   - Add `data-i18n-skip` on user-authored text and register new UI strings in `assets/i18n-en.js` + `i18n.py`.
   - Preserve DOM reuse and avoid rebuilding hidden panels.
5. **Tests & CI**:
   - If you created a new top-level `.py` or `.html` file, add it to the copied-files tuple in `tests/anki-smoke.py` (line 63) so the isolated smoke profile loads it.
   - Add unit tests in `tests/test_<module>.py` writing temp artifacts only under `tests/.tmp/`.
   - If the new test is pure Python (no `anki`/`aqt`), also add it to `.github/workflows/code-checks.yml`.
   - Run `tests/run-unit.py`, `tests/i18n-check.mjs`, `node --check assets/<file>.js`, relevant browser checks (`ui-check.mjs` / `tools-ui.mjs`), and `tests/anki-smoke.py` when hooks change.
