# AnkiNOS Surgical File & Symbol Map

Use this index to locate the **exact file and line range** before calling `read_file` or `edit_file`. Avoid reading 1,000+ line files in full when you only need one subsystem.

---

## 1. Python Backend Modules (Root Directory)

### Entry & UI Integration (Qt / `aqt` allowed)

| File | Lines | Responsibility & Section Map |
| :--- | :---: | :--- |
| `__init__.py` | 11 | Calls `integration.install()`, catches startup errors into `_fallback(error)`. |
| `integration.py` | 1,761 | Main Anki host bridge. **Exact sections**:<br>• `L1–L70`: Imports, globals, `_clear_support_cache()`, `enabled()`<br>• `L72–L118`: `_lang()`, `_t()`, `_fallback()`, `_compatibility()`<br>• `L120–L225`: `_sync_chrome()`, `_restore_chrome()`, `_state_changing()`, `_overview_refreshed()`, `_ChromeGuard`, `config()`, `_config_updated()`<br>• `L226–L325`: `_body_template()`, `_guard_unused_heatmaps()`, `_guard_unused_deck_html()`, `_guard_live_updates()`, `_begin_navigation()`<br>• `L326–L360`: `settings()`, `public_settings()`<br>• `L361–L606`: Media Studio backend (`_image_add`, `_write_derivative`, `_prepare_image_previews`, `_image_delete`, `_image_rename`, `_image_move`, `_image_assign`, `_album_action`)<br>• `L607–L697`: `save_settings()`, `send()`, `_deliver_snapshot()`, `refresh()`<br>• `L698–L782`: `_study_support()`, `_quick_study()`, `_start_overview_review()`, `_insight_browse()`<br>• `L783–L893`: `_backup_job()`, `_backup_export()`, `_backup_restore()`<br>• `L894–L1080`: `_stats_pdf()`, `open_statistics()`, `open_daily_schedule()`, `_stats_graphs()`, `_stats_select_deck()`, `_history_year()`<br>• `L1081–L1182`: `_replace_content()`, `replace_content()` (DeckBrowser & Overview HTML/CSS/JS injection)<br>• `L1183–L1395`: `_deck_id()`, `_browse()`, `_add_resource()`, `_open_resource()`, `_create_deck()`, `_deck_menu()`, `_delete_deck()`, `_favorite()`<br>• `L1396–L1443`: `_save_ui()` (strict WebView settings validation)<br>• `L1444–L1659`: `bridge()` (`nos:*` command dispatcher)<br>• `L1660–L1761`: `_operation_finished()`, `_profile_closing()`, `_sync_finished()`, `_toggle()`, `install()` |
| `reviewer_ui.py` | 247 | Reviewer chrome + Focus Mode lifecycle (`prepare_focus`, `focus_store`, `focus_history`, `_review_content` with `#nos-review-card data-i18n-skip`, `_bridge` for `nos-review:*`, `_FocusWindowGuard`, `install`). |
| `study_tools_ui.py` | 436 | `ToolDialog` (`QDialog` + `AnkiWebView`) for `palette` (Quick Commands) and `workspace` (frameless corner-minimizable Notebook). Exports `open_commands`, `open_notebook`, `reset_tools`, `sync_settings`, `install`. |

### Pure-Python Logic & Stores (NO `aqt` / Qt imports — unit-testable directly!)

| File | Lines | Responsibility & Key Exports |
| :--- | :---: | :--- |
| `data.py` | 326 | Read-only collection queries & `_AGGREGATES` cache: `quick_snapshot`, `collect_snapshot`, `collect_history_year`, `overview_base`, `collect_overview_snapshot`, `clear_snapshot_cache`. |
| `graphs_data.py` | 238 | Native Rust stats adapter: `collect_native_graphs` (`col._backend.graphs`), `collect_calendar_days`, `collect_scope_metrics`, `MAX_SEARCH_LENGTH`. |
| `study_data.py` | 116 | 30/60-day timing quantiles (25/50/75%) & deck insights (`retention_drop`, `repeated_lapses`): `collect_support`, `insight_cards`, `clear_cache`. |
| `daily_scheduler.py` | 654 | Pure-Python Smart Daily Memory Scheduler: FSRS power-law `compute_retrievability`, `parse_memory_state`, `resolve_scope_deck_ids`, `plan_redistribution` (adaptive window + local swap refinement), `collect_daily_schedule`. |
| `daily_store.py` | 360 | `daily_schedule.sqlite3` store (`preferences`, `scope_presets`, `move_batches`, `move_entries`): `clean_daily_config`, `DailyStore`, `validate_database`. |
| `daily_bridge.py` | 434 | Collection bridge for Daily Schedule (`QueryOp`/`CollectionOp`): `scope_label_for`, `apply_redistribution_in_col`, `rollback_batch_in_col`, `prepare_today_filtered_deck`, `build_daily_payload`, `handle`. Uses `FILTERED_DECK_NAME = "AnkiNOS::Lịch hôm nay"`. |
| `focus_store.py` | 152 | `focus.sqlite3` store (`sessions`, max 2000 rows, durations `5/15/25/30/45/60/90` min): `FocusStore` (`start`, `checkpoint`, `pause`, `resume`, `answer`, `stop`, `status`, `history`). |
| `media_store.py` | 160 | Local image library under `user_files/<sha256(profile)[:20]>/` (max 100 images, 16 MB, 30 albums): `profile_dir`, `valid_albums`, `valid_images`, `add_image`, `delete_image`, `public_images`. |
| `workspace_store.py` | 108 | `workspace.sqlite3` store (`notes`, `bindings`), Vietnamese accent-insensitive `folded()`, `WorkspaceStore`, `validate_database`. |
| `study_tools_data.py` | 37 | `COMMANDS` table (VI+EN keywords) & `palette_results(col, query, resources, workspace)`. |
| `theme_settings.py` | 40 | Shared validation constants (`THEME_MODES`, `COLOR_THEMES`, `ACCENTS`, `DASHBOARD_LAYOUTS`, `SIDEBAR_SIDES`, `LANGUAGES`, `DEFAULT_*`) + `clean_theme_settings`. |
| `i18n.py` | 298 | Pure-Python Vietnamese->English translation for native Qt dialogs, menus, undo labels, and errors: `translate(text, lang)`, `format_restore_preview(...)`. |
| `backup_store.py` | 363 | `.nosbackup` ZIP archive export/inspect/restore (v1–v4, SHA-256 manifest, pre-restore snapshot, atomic swap/rollback, deck-name remapping): `clean_settings`, `export_archive`, `inspect_archive`, `restore_archive`. |
| `legacy_brainexer_backup.py` | 52 | Read-only SQLite + settings archive validation for removed BrainExer feature. |
| `legacy_learning_backup.py` | 33 | Read-only SQLite archive validation for removed multi-mode learning feature. |

---

## 2. HTML Templates

| File | Lines | Exact Sections |
| :--- | :---: | :--- |
| `ankios-ui.html` | 793 | Main Dashboard markup:<br>• `L1–L58`: Head, SVG icon `<symbol>` defs (`#i-*`)<br>• `L59–L92`: 4-Edge hidden docks (`#nos-edge-*`) + main `.rail` sidebar<br>• `L93–L129`: Home workspace (`.topbar`, `.greeting`, `#activity-panel` heatmap, `#study-launchpad`)<br>• `L130–L292`: `#daily-page` (controls, scope panel, undo banner, overdue preview, Today card, Future grid, inspector, `#daily-ledger-dialog`)<br>• `L293–L402`: `#stats-page` (KPI cards, `#study-insights-list`, `#nos-focus-history`, native toolbar, `#stats-report`, `#stats-deck-dialog`)<br>• `L403–L417`: `#library-dialog` (anchored popover, sidebar filters, deck list, resources list)<br>• `L418–L700`: `#settings-dialog` (7 tabs: `#stab-language`, `#stab-appearance`, `#stab-dashboard`, `#stab-goals`, `#stab-performance`, `#stab-shortcuts`, `#stab-data`)<br>• `L703–L772`: `#studio-dialog` (Media Studio albums, gallery, inspector)<br>• `L773–L793`: `#profile-panel`, `#launcher`, `#layout-menu`, toasts/tooltips, script tags |
| `ankios-overview.html` | 92 | Deck Overview screen: topbar, breadcrumb, `#overview-hero` (ready + `#overview-complete-banner` + 3 count cards + actions), `#overview-today` sidebar, `#overview-menu`. |
| `ankios-review.html` | 10 | Standalone Reviewer preview with `#nos-review-shell`, `#qa[data-i18n-skip]`, and `#preview-ratings` iframe. |
| `ankios-tools.html` | 44 | Shared host shell for Quick Commands (`?tool=palette`) and Notebook (`?tool=workspace`, includes `#tool-mini-dock` corner pocket). |
| `assets/reviewer-controls-preview.html` | 7 | Standalone preview iframe for native Anki rating buttons (`Show Answer` / `Again·Hard·Good·Easy`). |
| `ankios-ui.original.html` | — | Legacy reference backup. **Do not edit.** |

---

## 3. Frontend JavaScript Modules (`assets/`)

| File | Lines | Global Export & Section Map |
| :--- | :---: | :--- |
| `i18n.js` | 206 | `window.NOSI18n`: `register`, `set`, `translate`/`t`, `preview`, `languages`, `locale`, `numberFormat`, `dateFormat`, `has`. Walks `document.title` + `document.body` (MutationObserver), splits `SKIP_TEXT` vs `SKIP_ATTR`. |
| `i18n-en.js` | 1,238 | English language pack (`dict` + `patterns`). Sections match UI areas (`Page titles`, `Page chrome`, `Study launchpad`, `Daily schedule`, `Statistics`, `Library`, `Media Studio`, `Profile`, `Settings`, `Language tab`, `Overview`, `Reviewer`, `Quick Commands & Notebook`, `Themes/Layouts`, `Accessible names`, `patterns`). |
| `theme.js` | 161 | `window.NOSTheme`: 8 palettes, WCAG `contrast`/`visible`/`readable`, `resolve`, `apply`, `watch` (`prefers-color-scheme`), `cards`, `sync` (preview card + meta line). |
| `layouts.js` | 644 | `window.NOSLayout`: 6 layout defs, 4-Edge dock control reparenting (`syncEdgeDocks`), spring magnification (Dock & Edges), elastic Aurora rail SVG wave, View Transitions (`choose`/`cycle`), ripple/tilt effects. |
| `dashboard.js` | 1,348 | `window.AnkiNOS`:<br>• `L1–L95`: Init, state, `toast()`, `command()`<br>• `L96–L169`: `saveUI()`, `applySettingsDraft()`, popups, `saveLayout()`<br>• `L170–L245`: `positionLibrary()`, `openLibrary()`, `closeLibrary()`<br>• `L246–L427`: Settings dialog (`openSettings`, `syncSettingsForm`, `renderLanguagePreview`, `nos:language`, export/import/reset JSON)<br>• `L428–L529`: Wallpaper URL helpers, `applySettings()`<br>• `L530–L649`: `renderStats()`, `renderTrend()`, `sparkline()`, `chartTooltip()`, `fullscreenState()`<br>• `L650–L776`: Calendar/Heatmap engine (`renderHeatmap`, `heatCell`, lazy year requests)<br>• `L777–L903`: Library tree filter/sort/branch-patching (`filterTree`, `deckHTML`, `renderLibrary`)<br>• `L904–L1060`: `changePage()`, `openCommands()`, `receive()` event router<br>• `L1061–L1290`: Event delegation, keyboard shortcuts (`Ctrl+K`, `Ctrl+Shift+K`, `Ctrl+,`, `Alt+Shift+L`, `Esc`)<br>• `L1291–L1348`: `previewData()` fixture, inline bootstrap mount, 5-min polling & 90s focus refresh |
| `stats-page.js` | 1,790 | `window.NOSStats`:<br>• `L1–L180`: Formatters, `cardState` filters, `frame()`, `groupRows()`, `niceMax()`<br>• `L181–L410`: SVG plot primitives (`barPlot`, `stackPlot`, `groupedBarPlot`)<br>• `L411–L1158`: All 13 native Anki chart builders (`today`, `future`, `calendar`, `reviews`, `counts`, `intervals`, `stability`, `ease`, `difficulty`, `retrievability`, `trueRetention`, `hours`, `buttons`, `added`)<br>• `L1159–L1365`: `rerenderCard()`, `syncToolbarUI()`, `render()` (4-card rAF batching), `updateMetricCards()`, `drawMetricCharts()`<br>• `L1366–L1498`: `preview()` mock payload, `request()`, `receive()`<br>• `L1499–L1790`: Deck chooser modal, event delegation, floating tooltip, PDF export, `nos:language` re-render |
| `daily-schedule.js` | 889 | `window.NOSDaily`: Standalone mock mirror (`L91–L288`), `request`/`receive` RPC (`L289–L362`), `renderScopeControls`/`Tree`, SVG Before/After chart (`L430–L512`), `renderOverdue`, `renderToday`, `renderFuture`, `renderInspector`, `renderLedger`, event bindings. |
| `media-studio.js` | 444 | `window.NOSStudio`: Album sidebar, lazy thumbnail gallery, inspector preview/fit/dim/blur sliders, instant slot assignment (no Apply), idle preview warming. |
| `study-dashboard.js` | 154 | `window.NOSStudy`: Home launchpad deck selector (max 12), 15/30/60m Focus estimate, Stats `Worth noticing` insight cards. |
| `focus-dashboard.js` | 76 | `window.NOSFocusHistory`: Stats Focus summary metrics, 14-day bar chart, 40 recent sessions list. |
| `overview.js` | 279 | `window.AnkiNOS` (Overview page): Queue counts, completed state banner/actions, Today stats, menu, 3D card tilt, inline bootstrap + idle live refresh. |
| `reviewer.js` | 146 | `window.NOSReview`: Top header, Focus countdown/controls/summary, `qFade=0`, card background preservation observer (`#qa` childList + `body` class/style only). |
| `reviewer-bottom.js` | 45 | Native rating bar radial fill decoration + shortcut key badge (`data-nos-key`). |
| `tools.js` | 94 | `window.NOSTool`: Shared shell, frameless drag/minimize/restore, `pycmd` `nostool:*` bridge, live `settings` receiver. |
| `commands.js` | 36 | `window.NOSCommands`: `Ctrl+K` combobox search, debounce 120ms, keyboard navigation, stale-seq protection. |
| `notebook.js` | 273 | `window.NOSNotebook`: Note list/search/scope/trash/archive, safe inline Markdown formatter/preview, mini toolbar (`Ctrl+B`/`I`/`S`), dirty-state guard. |
| `runtime-guard.js` | 22 | Error & 8s boot-timeout watchdog triggering native Anki fallback. |

---

## 4. Stylesheets (`assets/*.css`)

| File | Lines | Scope |
| :--- | :---: | :--- |
| `dashboard.css` | 779 | Base design tokens, Home, Library popover, Settings dialog, Profile, Launcher, mobile responsive rules. |
| `layouts.css` | 758 | Layout-specific CSS for `[data-layout="aurora|bento|dock|sidebar|zen|edges"]`, View Transitions, 4-Edge hidden docks, sidebar-right flips. |
| `theme.css` | 214 | Consumes `--surface`, `--text`, `--blue`, `--glass-blur`, `--glass-alpha`, etc. across all views + `@media print` for Stats PDF. **Never targets `#qa`.** |
| `daily-schedule.css` | 609 | Daily Schedule page, scope panel, Before/After chart, Today card, locked Future grid, ledger dialog. |
| `stats-page.css` | 248 | Statistics KPI grid, 13 SVG chart cards, deck chooser dialog, floating glass tooltip, print rules. |
| `overview.css` | 186 | Overview hero, completed banner, count cards, Today sidebar, menu. |
| `tools.css` | 665 | Quick Commands & frameless Notebook window, mini formatting bar, Markdown preview, corner pocket dock. |
| `media-studio.css` | 105 | Media Studio modal, album rail, thumbnail grid, live wallpaper preview frame. |
| `reviewer.css` | 118 | Reviewer shell, top header, `#nos-review-card` container (preserves `#qa`). |
| `reviewer-bottom.css` | 133 | Native rating buttons (4 colors, radial fill, shortcut badge, fixed bar height). |
| `study-dashboard.css` | 94 | Home study launchpad & Stats insights cards. |
| `focus-dashboard.css` | 22 | Stats Focus history panel & 14-day bars. |
| `focus-review.css` | 13 | Reviewer inline Focus timer controls & summary bar. |

---

## 5. Config, Metadata & Tests

| File | Purpose |
| :--- | :--- |
| `manifest.json` | Anki add-on metadata (`package: "NOS"`, `version: "0.4.0"`, `min_point_version: 250200`). |
| `config.json` / `meta.json` | Default add-on config (`enabled`, `profiles`) and local Anki runtime config (do not commit personal profile data unnecessarily). |
| `.github/workflows/code-checks.yml` | GitHub Actions CI pipeline (Python syntax, unit tests, Anki backend tests, JS syntax, i18n, Chromium UI & theme checks). |
| `tests/` | See [docs/TESTING-AND-CI.md](TESTING-AND-CI.md) for the complete 17-file test matrix. |
