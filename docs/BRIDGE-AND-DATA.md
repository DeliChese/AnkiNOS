# AnkiNOS Bridge Protocol, Settings & Data Persistence

This guide documents every `pycmd` message channel, the complete profile settings schema, SQLite schemas, and the `.nosbackup` archive contract.

---

## 1. WebView <-> Python Bridge Protocols

### Channel 1: `nos:<JSON>` (`integration.py:bridge`)
Max payload size: `32,000` bytes. Active on `DeckBrowser` and `Overview`.

#### JS → Python Actions

| Action | Payload Fields | Handler / Behavior |
| :--- | :--- | :--- |
| `snapshot` | `{force?: bool}` | Forces revision bump if `force:true`, runs `refresh()` via `QueryOp`. |
| `history_year` | `{year: int}` | Lazy-loads revlog counts for `2006 <= year <= current_year`. |
| `study_support` | `{force?: bool}` | Loads 30/60-day timing quantiles & deck insights (`study_data.py`). |
| `quick_study` | `{id, minutes?: 15\|30\|60}` | Selects deck, moves to Overview with `auto_start`, optional Focus timer. |
| `insight_browse` | `{id, kind: "retention_drop"\|"repeated_lapses"}` | Opens Anki Browser with `cid:...` query. |
| `daily` | `{method, request_id, ...}` | Dispatches to `daily_bridge.handle()` (see Daily RPC table below). |
| `graphs` | `{scope: "deck"\|"collection", days: 0\|365, search?, deck_id?}` | Fetches native Anki Rust graphs (`graphs_data.py`). |
| `stats_select_deck` | `{deck_id, scope, days, search}` | Sets Anki current deck & reloads graphs. |
| `stats_browser_search` | `{query}` | Opens Anki Browser with search query (max 1000 chars). |
| `stats_pdf` | `{}` | Scrolls to top and exports Stats via `page.printToPdf(...)`. |
| `focus_history` | `{}` | Returns `focus_store().history()`. |
| `study` | `{id}` | Sets `_begin_navigation()` and opens Deck Overview via `set_current_deck`. |
| `overview_native` | `{command: "study"\|"decks"\|"opts"\|"studymore"\|"description"\|"refresh"\|"empty"\|"unbury"}` | Runs Anki Overview action (`study` hooks Focus plan first). |
| `back` | `{}` | `mw.moveToState("deckBrowser")`. |
| `show_children` | `{id}` | Stores `_library_focus` and opens Library expanded on that deck. |
| `library_ack` | `{id}` | Clears `_library_focus`. |
| `create_deck` / `delete_deck` / `deck_menu` / `favorite` | `{id?}` | Native Qt deck dialog/menu/confirmations or star toggle. |
| `browse` / `add_cards` / `stats` / `sync` / `import` / `export` / `shared` / `preferences` / `open_anki_prefs` / `addons` / `switch_profile` | `{id?}` | Invokes native Anki dialogs/actions. |
| `fullscreen` | `{}` | Toggles Anki fullscreen, re-syncs chrome, emits `fullscreen`. |
| `commands` / `notebook` | `{id?}` | Opens `ToolDialog` (`palette` or `workspace`). |
| `set_goal` | `{}` | Opens native `QInputDialog` for daily review goal. |
| `add_file` / `add_link` / `open_resource` / `resource_menu` | `{id?}` | Attaches/opens/removes external file or HTTP(S) link references. |
| `save_ui` | `{values: dict}` | Persists validated partial settings (`_save_ui`) without re-broadcasting. |
| `apply_settings` | `{values: dict}` | Persists validated settings, broadcasts `settings` to main WebView AND `study_tools_ui.sync_settings()`. |
| `image_previews` / `image_add` / `image_delete` / `image_rename` / `image_move` / `image_assign` | `{id?, album_id?, name?, slot?}` | Local Media Studio operations (`media_store.py`). |
| `album_create` / `album_rename` / `album_delete` | `{id?, name?}` | Local album operations (max 30 albums; delete never deletes images). |
| `backup_export` / `backup_restore` | `{}` | `.nosbackup` export or preview-confirmed restore (`backup_store.py`). |
| `compatibility` / `native_mode` / `runtime_failure` | `{message?}` | API check dialog, disable AnkiNOS, or runtime fallback. |

#### Daily Schedule RPC (`action: "daily"` -> `daily_bridge.py:handle`)
Every call carries `request_id` and returns event `daily`: `{request_id, method, data, error}`.

| Method | Worker Type | Behavior |
| :--- | :--- | :--- |
| `load` | `QueryOp` | Builds live schedule, presets, and last 20 ledger batches. |
| `save_config` | `QueryOp` | Saves `scope_mode`, `deck_names`, `include_children`, `daily_cap`, `active_preset_id`. |
| `save_preset` / `delete_preset` | `QueryOp` | Manages up to 40 saved scope presets in `daily_schedule.sqlite3`. |
| `apply_plan` | `CollectionOp` | Shifts real `card.due` on unmodified overdue review cards (`queue=2, odid=0`), records Anki Undo + ledger batch, bumps `_data_revision`. |
| `rollback_batch` | `CollectionOp` | Restores `old_due` for unreviewed cards in a batch, skips already-reviewed/changed cards, marks batch rolled back. |
| `batch_detail` | `QueryOp` | Returns full batch + `move_entries`. |
| `study_today` | `CollectionOp` | Rebuilds filtered deck `AnkiNOS::Lịch hôm nay` strictly from today's unlocked cards (`queue IN (2,3), odid=0, due=sched_today`), launches review (+ optional 15/30/60m Focus). |

#### Python → JS Events (`window.AnkiNOS.receive({event, payload})`)
`snapshot`, `overview_snapshot`, `settings`, `fullscreen`, `error`, `history_year`, `history_error`, `graphs`, `graphs_error`, `focus_history`, `study_support`, `study_support_error`, `daily`, `image_library`, `backup_status`.

---

### Channel 2: `nos-review:<action>` (`reviewer_ui.py:_bridge`)
- Actions: `back`, `more`, `notebook`, `native`, `focus:start:<minutes>`, `focus:pause`, `focus:resume`, `focus:stop`, `focus:complete`.
- Python → JS: `window.NOSReview.setState({side, answered, card})` and `window.NOSReview.setFocus(status)`.

### Channel 3: `nostool:<JSON>` (`study_tools_ui.py:bridge`)
Max payload size: `500,000` bytes.
- Common actions: `close`, `minimize`, `restore`, `drag_start`, `backup`.
- `palette` actions: `boot`, `search` (`{query, seq}`), `execute` (`{kind: "deck"|"resource"|"note"|"action", id}`).
- `workspace` actions: `boot`, `load` (`{scope, query, archived, trash}`), `save` (`{id, title, body, deck_id, scope}`), `trash` (`{id, restore, scope}`), `open_source` (`{id}`).
- Python → JS (`window.NOSTool.receive({event, payload})`): `results`, `notebook`, `note_context`, `note_focus`, `window_state`, `settings`, `notice`, `error`.

---

## 2. Profile Settings Schema & 4-Boundary Persistence Rule

Stored in Anki add-on config under `config["profiles"][profile_name]`.

| Key | Type / Allowed Values | Default | Validated In |
| :--- | :--- | :--- | :--- |
| `theme` | `"dusk" \| "night" \| "oled" \| "light" \| "system"` | `"dusk"` | `theme_settings.py` |
| `color_theme` | `"nos" \| "tokyo" \| "mononoke" \| "catppuccin" \| "rosepine" \| "nord" \| "solarized" \| "dracula"` | `"nos"` | `theme_settings.py` |
| `accent` | `"auto" \| "blue" \| "cyan" \| "mint" \| "purple" \| "amber" \| "pink" \| "custom"` | `"blue"` | `theme_settings.py` |
| `custom_accent` | `#[0-9a-f]{6}` (lowercased) | `"#83b8ff"` | `theme_settings.py` |
| `layout` | `"aurora" \| "bento" \| "dock" \| "sidebar" \| "zen" \| "edges"` | `"aurora"` | `theme_settings.py` |
| `sidebar_side` | `"left" \| "right"` | `"left"` | `theme_settings.py` |
| `glass_blur` | `int` `0..32` | `16` | `theme_settings.py` |
| `glass_opacity` | `int` `30..100` | `74` | `theme_settings.py` |
| `language` | `"vi" \| "en"` | `"vi"` | `theme_settings.py` |
| `blur`, `animations`, `lite_mode` | `bool` | `True, True, False` | `integration.py`, `backup_store.py` |
| `stat_retention`, `stat_pace`, `stat_time`, `stat_studied` | `bool` | `True` | `integration.py`, `backup_store.py` |
| `activity_collapsed`, `library_collapsed`, `sidebar_collapsed` | `bool` | `False` | `integration.py`, `backup_store.py` |
| `view` | `"list" \| "grid"` | `"list"` | `integration.py`, `backup_store.py` |
| `heatmap_day` | `"monday" \| "sunday"` | `"monday"` | `integration.py`, `backup_store.py` |
| `heatmap_palette` | `"default" \| "green" \| "orange" \| "purple"` | `"default"` | `integration.py`, `backup_store.py` |
| `goal` | `int` `1..100000` | `200` | `integration.py`, `backup_store.py` |
| `ui_scale` | `85 \| 90 \| 100 \| 110 \| 120` | `100` | `integration.py`, `backup_store.py` |
| `study_budget` | `15 \| 30 \| 60` | `30` | `integration.py`, `backup_store.py` |
| `wallpaper_dim` / `wallpaper_blur` | `int` `0..80` / `0..24` | `28` / `0` | `integration.py`, `backup_store.py` |
| `image_dashboard`, `image_overview`, `image_review`, `image_avatar` | image UUID `str \| None` | `None` | `integration.py`, `backup_store.py` |
| `image_fit_*` / `image_position_*` | `"cover"\|"contain"` / `"center"\|...` | `"cover"` / `"center"` | `integration.py`, `backup_store.py` |
| `images`, `image_albums` | sanitized lists (Studio-only save) | `[]` | `media_store.py` |
| `favorites`, `colors`, `resources`, `last_study_deck` | deck-ID lists/dicts (remapped by full deck name on backup restore) | `[]`, `{}`, `[]`, `None` | `integration.py`, `backup_store.py` |

> **Critical Trap**: Settings edited inside `#settings-dialog` are buffered in `settingsDraft` and only persisted on **Apply** via `applySettingsDraft()`, which sends ONLY keys listed in its `keys` allowlist (`assets/dashboard.js` ~L128). **Forgetting to add a new key to that array causes silent discard on Apply!** (Image slots/albums are the deliberate exception: Media Studio saves immediately.)

---

## 3. Profile-Local SQLite Databases

All DBs live in `user_files/<sha256(profile_name)[:20]>/` (computed by `media_store.profile_dir`).

| File | Module | Tables & Key Constraints | Backup Limit |
| :--- | :--- | :--- | :---: |
| `focus.sqlite3` | `focus_store.py` | `sessions(id, started_at, ended_at, seconds, target_seconds, cards, status)`. Status in `running/paused/completed/stopped/interrupted`. Pruned to 2,000 rows. | 64 MB |
| `workspace.sqlite3` | `workspace_store.py` | `PRAGMA user_version = 1`. `notes(id, collection_key, deck_id, deck_name, note_id, title<=160, body<=20000, search, created_at, updated_at, deleted_at)`, `bindings(collection_key, deck_id, resource_id)`. `collection_key` is a 32-hex UUID stored in `col.get_config("ankinos_learning_collection_uuid")`. | 256 MB |
| `daily_schedule.sqlite3` | `daily_store.py` | `PRAGMA user_version = 1`. `preferences(key, value)`, `scope_presets(id, name, scope_mode, deck_names, include_children, daily_cap, created_at, updated_at)` (max 40), `move_batches(...)` (max 200), `move_entries(... ON DELETE CASCADE)`. | 64 MB |
| `learning.sqlite3`, `brainexer.sqlite3` | `legacy_*_backup.py` | Legacy read-only archive compatibility only. Never opened on add-on startup. | 256 MB |

---

## 4. `.nosbackup` Archive Contract (`backup_store.py`)

- **Format**: Standard deflated ZIP with `manifest.json` + `profile/<filename>`.
- **Versions**: Supports reading v1–v4; exports v2 (or v4 if legacy BrainExer data/audio exists). Never accepts versions > 4.
- **Hard Limits**: Total `<= 2 GB`, files `<= 10,000`, `manifest.json <= 4 MB`, images `<= 16 MB` & `<= 24 MP`, BrainExer MP3 `<= 4 MB`.
- **Integrity & Safety**:
  1. Rejects encrypted entries, symlinks, duplicate names, and any file outside `FILE_NAME` / `AUDIO_NAME`.
  2. Verifies every file size + SHA-256 against `manifest.json`.
  3. Validates every SQLite file in read-only mode (`?mode=ro`, `PRAGMA quick_check`, schema + column checks).
  4. Re-hashes archive before/after reading to catch TOCTOU file changes.
  5. Exports current state to `user_files/backups/before-restore-*.nosbackup` before swapping; preserves unknown non-AnkiNOS files; rolls back directory & config if `apply_settings` fails.
  6. Remaps `favorites`, `colors`, and `last_study_deck` across collections strictly by **full deck name**, dropping non-matching IDs.
