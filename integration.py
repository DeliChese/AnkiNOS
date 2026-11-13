"""Supported Anki hooks, native actions, and profile-local dashboard settings."""

from __future__ import annotations

import json
import html
import re
import uuid
from datetime import datetime
from functools import lru_cache, wraps
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from aqt import dialogs, gui_hooks, mw
from aqt.deckbrowser import DeckBrowser
from aqt.overview import Overview
from aqt.operations import QueryOp
from aqt.operations.deck import remove_decks
from aqt.qt import QAction, QDesktopServices, QEvent, QFileDialog, QInputDialog, QMenu, QObject, QTimer, QUrl, QCursor, qconnect
from aqt.utils import askUser, getOnlyText, showWarning

from .data import collect_snapshot, collect_overview_snapshot, collect_history_year, overview_base, clear_snapshot_cache

ROOT = Path(__file__).resolve().parent
MODULE = __package__ or "NOS"
_generation = 0
_installed = False
_active_query: tuple[int, str] | None = None
_refresh_timer: QTimer | None = None
_toggle_action: QAction | None = None
_chrome_visibility: list[tuple[Any, bool]] = []
_chrome_guard: QObject | None = None
_overview_rendered = False
_overview_pending = False
_config_cache: dict[str, Any] | None = None
_navigating = False
_library_focus: str | None = None
_dashboard_tree: Any = None
_data_revision = 0
_review_changes_only = True
_history_queries: set[tuple[int, str, int]] = set()
ALLOWED_FILES = {".pdf", ".epub", ".txt", ".md", ".csv", ".xlsx", ".docx", ".pptx", ".mp3", ".wav", ".mp4", ".webm", ".png", ".jpg", ".jpeg", ".webp"}


def _dashboard_active() -> bool:
    return bool(getattr(mw, "col", None) and config().get("enabled", True)
                and (mw.state in {"deckBrowser", "review"} or (mw.state == "overview" and _overview_rendered)))


def _sync_chrome(*_args: Any) -> None:
    if _dashboard_active():
        if not _chrome_visibility:
            _chrome_visibility.extend((widget, not widget.isHidden()) for widget in (mw.toolbarWeb, mw.bottomWeb))
        for widget, _visible in _chrome_visibility:
            # Anki overrides hide() to fade HTML while retaining layout space.
            # QWidget visibility actually removes the duplicated bars' space.
            widget.setVisible(mw.state == "review" and widget is mw.bottomWeb)
    else:
        _restore_chrome()


def _restore_chrome() -> None:
    previous = list(_chrome_visibility)
    _chrome_visibility.clear()
    for widget, visible in previous:
        widget.setVisible(visible)


def _state_changing(new: str, _old: str) -> None:
    global _overview_rendered, _overview_pending, _navigating
    _navigating = False
    _overview_rendered = False
    _overview_pending = False
    # Restore before Anki applies the destination screen's own toolbar policy.
    if new not in {"deckBrowser", "overview"}:
        _restore_chrome()


def _overview_refreshed(_overview: Any) -> None:
    global _overview_rendered, _overview_pending
    # Anki's completion page uses Svelte, bypassing the legacy HTML hook. Keep
    # its own controls visible instead of hiding them behind an absent NOS menu.
    _overview_rendered = _overview_pending
    _overview_pending = False
    _sync_chrome()


class _ChromeGuard(QObject):
    def eventFilter(self, watched: Any, event: Any) -> bool:
        # Anki may show bars after redraw, resize, or fullscreen mouse movement.
        if event.type() == QEvent.Type.Show and _chrome_visibility and _dashboard_active():
            QTimer.singleShot(0, _sync_chrome)
        if watched is mw and event.type() == QEvent.Type.WindowStateChange:
            QTimer.singleShot(0, lambda: send("fullscreen", mw.isFullScreen()))
        return False


def config() -> dict[str, Any]:
    global _config_cache
    if _config_cache is None:
        _config_cache = mw.addonManager.getConfig(MODULE) or {"enabled": True, "profiles": {}}
    return _config_cache


def _config_updated(values: dict[str, Any]) -> None:
    global _config_cache
    _config_cache = values
    _sync_chrome()
    if mw.col and mw.state in {"deckBrowser", "overview"}:
        mw.moveToState(mw.state)


@lru_cache(maxsize=3)
def _body_template(filename: str) -> str:
    source = (ROOT / filename).read_text(encoding="utf-8")
    body = re.search(r"<body[^>]*>(.*?)</body>", source, re.S)
    if not body:
        raise ValueError(f"Invalid AnkiNOS template: {filename}")
    return re.sub(r"<script\b[^>]*>.*?</script>", "", body.group(1), flags=re.S)


def _guard_unused_heatmaps(*_args: Any) -> None:
    controller = getattr(mw, "_review_heatmap", None)
    original = getattr(controller, "render_for_view", None)
    if original is None or getattr(original, "_nos_guard", False):
        return

    @wraps(original)
    def render(view: Any, *args: Any, **kwargs: Any) -> str:
        # These legacy heatmaps are replaced entirely by NOS. Skip their SQL
        # and HTML construction as well as their pixels. Other views delegate.
        if config().get("enabled", True) and getattr(view, "name", "") in {"deckbrowser", "overview"}:
            return ""
        return original(view, *args, **kwargs)

    render._nos_guard = True
    controller.render_for_view = render


def _guard_unused_deck_html() -> None:
    original = DeckBrowser._renderDeckTree
    if getattr(original, '_nos_guard', False):
        return

    @wraps(original)
    def render(browser: Any, tree: Any) -> str:
        # NOS replaces this entire table later. Retain Anki's scheduler query
        # and hooks, but avoid building thousands of HTML rows to discard them.
        if config().get('enabled', True):
            return ''
        return original(browser, tree)

    render._nos_guard = True
    DeckBrowser._renderDeckTree = render


def _begin_navigation() -> None:
    global _navigating, _generation
    _navigating = True
    _generation += 1
    if _refresh_timer:
        _refresh_timer.stop()


def settings() -> dict[str, Any]:
    profile = config().get("profiles", {}).get(mw.pm.name, {})
    return {"goal": 200, "theme": "dusk", "accent": "blue",
            "activity_collapsed": False, "library_collapsed": False, "sidebar_collapsed": False,
            "favorites": [], "colors": {}, "resources": [], "view": "list",
            "blur": True, "animations": True, "ui_scale": 100,
            "stat_retention": True, "stat_pace": True, "stat_time": True, "stat_studied": True,
            "heatmap_day": "monday", "heatmap_palette": "default",
            **profile}


def save_settings(patch: dict[str, Any]) -> None:
    conf = config()
    profiles = conf.setdefault("profiles", {})
    profiles[mw.pm.name] = {**settings(), **patch}
    mw.addonManager.writeConfig(MODULE, conf)


def send(event: str, payload: Any) -> None:
    if mw.col and mw.state in {"deckBrowser", "overview"} and config().get("enabled", True):
        encoded = json.dumps({"event": event, "payload": payload}, ensure_ascii=True)
        mw.web.eval(f"window.AnkiNOS && window.AnkiNOS.receive({encoded});")


def refresh() -> None:
    global _active_query, _dashboard_tree
    if _navigating or not mw.col or mw.state not in {"deckBrowser", "overview"} or not config().get("enabled", True):
        return
    overview = mw.state == "overview"
    if overview and not _overview_rendered:
        return
    token = (_generation, mw.pm.name)
    if _active_query == token:
        return
    _active_query = token
    profile_name = mw.pm.name
    revision, review_only = _data_revision, _review_changes_only
    tree = _dashboard_tree if not overview else None
    if not overview:
        _dashboard_tree = None

    def success(snapshot: dict[str, Any] | None) -> None:
        global _active_query, _review_changes_only
        if _active_query == token:
            _active_query = None
        if token != (_generation, mw.pm.name) or not mw.col:
            return
        if revision != _data_revision:
            QTimer.singleShot(0, refresh)
            return
        if snapshot is None:
            return
        if not overview:
            _review_changes_only = True
        snapshot = {**snapshot, 'profile':profile_name, 'settings':settings(), 'fullscreen':mw.isFullScreen()}
        if not overview and _library_focus:
            snapshot["library_focus"] = _library_focus
        send("overview_snapshot" if overview else "snapshot", snapshot)

    def failure(error: Exception) -> None:
        global _active_query
        if _active_query == token:
            _active_query = None
        if token == (_generation, mw.pm.name):
            send("error", "Không thể đọc dữ liệu Anki: " + str(error))

    def read(col: Any) -> dict[str, Any] | None:
        # Anki serializes collection jobs. Don't let an abandoned dashboard job
        # queue expensive scans in front of selecting/answering a card.
        if token != (_generation, mw.pm.name) or _navigating:
            return None
        return collect_overview_snapshot(col) if overview else collect_snapshot(
            col, due_tree=tree, revision=revision, review_only=review_only)

    QueryOp(parent=mw, op=read,
            success=success).failure(failure).run_in_background()


def _history_year(year: int) -> None:
    if mw.state != 'deckBrowser' or not 1900 <= year <= datetime.now().year:
        return
    token = (_generation, mw.pm.name, year)
    if token in _history_queries:
        return
    _history_queries.add(token)
    revision = _data_revision

    def success(payload: dict[str, Any] | None) -> None:
        _history_queries.discard(token)
        if token[:2] != (_generation, mw.pm.name) or not payload:
            return
        if revision != _data_revision:
            _history_year(year)
        else:
            send('history_year', payload)

    def failure(error: Exception) -> None:
        _history_queries.discard(token)
        if token[:2] == (_generation, mw.pm.name):
            send('history_error', {'year':year,'message':str(error)})

    def read(col: Any) -> dict[str, Any] | None:
        if token[:2] != (_generation, mw.pm.name) or _navigating:
            return None
        return collect_history_year(col, year, revision=revision)

    QueryOp(parent=mw, op=read, success=success).failure(failure).run_in_background()


def replace_content(content: Any, context: Any) -> None:
    global _generation, _overview_rendered, _overview_pending, _dashboard_tree
    if not isinstance(context, (DeckBrowser, Overview)) or not config().get("enabled", True):
        return
    overview = isinstance(context, Overview)
    if overview:
        _overview_rendered = _overview_pending = True
    else:
        _dashboard_tree = getattr(getattr(context, '_render_data', None), 'tree', None)
    _generation += 1
    if _refresh_timer:
        _refresh_timer.stop()
    content.body = _body_template("ankios-overview.html" if overview else "ankios-ui.html")
    content.body = content.body.replace('id="nos-app"', 'id="nos-app" data-native="true"', 1)
    if overview:
        initial = overview_base(mw.col)
        initial.update(profile=mw.pm.name, settings=settings(), fullscreen=mw.isFullScreen())
        content.body += '<textarea id="nos-overview-bootstrap" hidden>' + html.escape(json.dumps(initial, ensure_ascii=True)) + '</textarea>'
    package = mw.addonManager.addonFromModule(MODULE)
    base = f"/_addons/{package}/assets"
    content.css = [p for p in content.css if p != "css/deckbrowser.css"]
    content.js = [p for p in content.js if p != "js/deckbrowser.js"]
    content.css.append(f"{base}/dashboard.css")
    if overview:
        content.css = [p for p in content.css if p != "css/overview.css"]
        content.css.append(f"{base}/overview.css")
    content.js.append(f"{base}/overview.js" if overview else f"{base}/dashboard.js")


def _deck_id(raw: Any) -> int:
    did = int(raw)
    if did <= 0 or not mw.col.decks.get(did, default=False):
        raise ValueError("Bộ thẻ không còn tồn tại. Hãy làm mới dashboard.")
    return did


def _browse(did: int | None = None) -> None:
    browser = dialogs.open("Browser", mw)
    if did is not None:
        browser.search_for(f"did:{did}")
    browser.show()
    browser.raise_()
    browser.activateWindow()


def _add_resource(link: bool = False) -> None:
    resources = list(settings()["resources"])
    if link:
        url = getOnlyText("Đường dẫn tài nguyên (https://…)", parent=mw, title="Thêm liên kết").strip()
        if not url:
            return
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            showWarning("Hãy nhập một liên kết http hoặc https hợp lệ.", parent=mw)
            return
        name = getOnlyText("Tên tài nguyên", default=parsed.netloc, parent=mw).strip()
        if not name:
            return
        resources.append({"id": uuid.uuid4().hex, "name": name[:240], "path": url, "kind": "link", "detail": parsed.netloc})
    else:
        paths, _ = QFileDialog.getOpenFileNames(mw, "Gắn tài nguyên học tập", "", "Tài nguyên (*.pdf *.epub *.txt *.md *.csv *.xlsx *.docx *.pptx *.mp3 *.wav *.mp4 *.webm *.png *.jpg *.jpeg *.webp)")
        for raw in paths:
            path = Path(raw)
            if path.suffix.lower() not in ALLOWED_FILES or not path.is_file():
                continue
            if any(r["path"] == str(path) for r in resources):
                continue
            size = path.stat().st_size
            detail = f"{size / 1_048_576:.1f} MB" if size >= 1_048_576 else f"{max(1, round(size / 1024))} KB"
            resources.append({"id": uuid.uuid4().hex, "name": path.stem, "path": str(path), "kind": path.suffix[1:].lower(), "detail": detail})
    save_settings({"resources": resources})
    send("settings", settings())


def _open_resource(resource_id: str) -> None:
    resource = next((r for r in settings()["resources"] if r["id"] == resource_id), None)
    if not resource:
        return
    if resource["kind"] == "link":
        if urlparse(resource["path"]).scheme not in {"http", "https"}:
            return
        url = QUrl(resource["path"])
    else:
        path = Path(resource["path"])
        if not path.is_file() or path.suffix.lower() not in ALLOWED_FILES:
            showWarning("Không tìm thấy file tài nguyên. File có thể đã được di chuyển hoặc đổi tên.", parent=mw)
            return
        url = QUrl.fromLocalFile(str(path))
    QDesktopServices.openUrl(url)


def _menu_action(menu: QMenu, text: str, action: Any) -> None:
    item = menu.addAction(text)
    qconnect(item.triggered, lambda _checked=False: action())


def _deck_menu(did: int) -> None:
    menu = QMenu(mw)
    starred = str(did) in settings()["favorites"]
    _menu_action(menu, "Bỏ gắn sao" if starred else "Gắn sao bộ thẻ", lambda: _favorite(str(did)))
    _menu_action(menu, "Duyệt thẻ", lambda: _browse(did))
    _menu_action(menu, "Đổi tên bộ thẻ…", lambda: mw.deckBrowser._rename(did))
    _menu_action(menu, "Tùy chọn bộ thẻ…", lambda: mw.deckBrowser._options(did))
    _menu_action(menu, "Xuất bộ thẻ…", lambda: mw.onExport(did=did))
    menu.addSeparator()
    _menu_action(menu, "Xóa bộ thẻ…", lambda: _delete_deck(did))
    colors = menu.addMenu("Màu thư mục")
    for name, color in [("Xanh dương", "blue"), ("Tím", "purple"), ("Hồng", "pink"), ("Xanh lá", "green"), ("Vàng", "amber")]:
        def set_color(color: str = color) -> None:
            mapping = dict(settings()["colors"])
            mapping[str(did)] = color
            save_settings({"colors": mapping})
            send("settings", settings())
        _menu_action(colors, name, set_color)
    menu.exec(QCursor.pos())


def _delete_deck(did: int) -> None:
    def prepare(col: Any) -> dict[str, Any]:
        deck = col.decks.get(did, default=False)
        if not deck:
            raise ValueError("Bộ thẻ không còn tồn tại.")
        ids = col.decks.deck_and_child_ids(did)
        placeholders = ",".join("?" for _ in ids)
        count = col.db.scalar(f"SELECT count(*) FROM cards WHERE did IN ({placeholders}) OR odid IN ({placeholders})", *ids, *ids)
        return {"name": deck["name"], "count": int(count), "children": len(ids)-1, "filtered": bool(deck.get("dyn"))}

    def confirm(info: dict[str, Any]) -> None:
        name = html.escape(info["name"])
        if info["filtered"]:
            message = f"Xóa bộ thẻ lọc <b>{name}</b>?<br>Thẻ sẽ được trả về bộ thẻ gốc."
        else:
            message = f"Xóa bộ thẻ <b>{name}</b>, {info['children']} bộ con và {info['count']} thẻ?<br>Bạn có thể dùng Hoàn tác của Anki sau khi xóa."
        if not askUser(message, parent=mw, defaultno=True, title="Xóa bộ thẻ"):
            return
        def removed(_result: Any) -> None:
            # CollectionOp already refreshes the deck browser through its
            # operation hooks. A second moveToState races two WebView loads.
            if mw.state == "overview":
                QTimer.singleShot(0, lambda: mw.moveToState("deckBrowser"))
        remove_decks(parent=mw, deck_ids=[did], deck_name=info["name"]).success(removed).run_in_background()

    QueryOp(parent=mw, op=prepare, success=confirm).failure(lambda error: showWarning(str(error), parent=mw)).run_in_background()


def _favorite(did: str) -> None:
    favorites = list(settings()["favorites"])
    if did in favorites:
        favorites.remove(did)
    else:
        favorites.append(did)
    save_settings({"favorites": favorites})
    send("settings", settings())


def _save_ui(values: Any) -> None:
    if not isinstance(values, dict):
        return
    patch: dict[str, Any] = {}
    for key in ("activity_collapsed", "library_collapsed", "sidebar_collapsed"):
        if key in values and isinstance(values[key], bool):
            patch[key] = values[key]
    if values.get("theme") in {"dusk", "night"}:
        patch["theme"] = values["theme"]
    if values.get("view") in {"list", "grid"}:
        patch["view"] = values["view"]
    if patch:
        save_settings(patch)


def bridge(handled: tuple[bool, Any], message: str, context: Any) -> tuple[bool, Any]:
    global _library_focus, _data_revision, _review_changes_only
    if handled[0] or not isinstance(context, (DeckBrowser, Overview)) or not message.startswith("nos:"):
        return handled
    if not mw.col or mw.state not in {"deckBrowser", "overview"} or not config().get("enabled", True):
        return (True, None)
    if (isinstance(context, Overview) and mw.state != "overview") or (isinstance(context, DeckBrowser) and mw.state != "deckBrowser"):
        return (True, None)
    try:
        if len(message) > 32_000:
            return (True, None)
        command = json.loads(message[4:])
        if not isinstance(command, dict):
            return (True, None)
        action = command.get("action")
        if action == "show_children":
            _library_focus = str(_deck_id(command.get("id")))
            mw.moveToState("deckBrowser")
        elif action == "library_ack":
            if command.get("id") == _library_focus:
                _library_focus = None
        elif isinstance(context, Overview) and action == "overview_native":
            native_action = command.get("command")
            if native_action in {"study", "decks", "opts", "studymore", "description", "refresh", "empty", "unbury"}:
                if native_action == "study":
                    _begin_navigation()
                mw.overview._linkHandler(native_action)
        elif action == "back":
            mw.moveToState("deckBrowser")
        elif action == "snapshot":
            if command.get('force') is True:
                _data_revision += 1
                _review_changes_only = False
            refresh()
        elif action == 'history_year':
            _history_year(int(command.get('year')))
        elif action == "study":
            did = _deck_id(command.get("id"))
            _begin_navigation()
            mw.deckBrowser.set_current_deck(did)
        elif action == "delete_deck":
            _delete_deck(_deck_id(command.get("id")))
        elif action == "browse":
            _browse(_deck_id(command["id"]) if command.get("id") else None)
        elif action == "add_cards":
            mw.onAddCard()
        elif action == "stats":
            mw.onStats()
        elif action == "sync":
            mw.on_sync_button_clicked()
        elif action == "fullscreen":
            mw.on_toggle_full_screen()
            _sync_chrome()
            send("fullscreen", mw.isFullScreen())
        elif action == "import":
            mw.onImport()
        elif action == "export":
            mw.onExport()
        elif action == "shared":
            mw.deckBrowser._onShared()
        elif action in {"preferences", "open_anki_prefs"}:
            mw.onPrefs()
        elif action == "addons":
            dialogs.open("AddonsDialog", mw)
        elif action == "switch_profile":
            mw.unloadProfileAndShowProfileManager()
        elif action == "create_deck":
            mw.deckBrowser._on_create()
        elif action == "deck_menu":
            _deck_menu(_deck_id(command.get("id")))
        elif action == "favorite":
            did = str(_deck_id(command.get("id")))
            _favorite(did)
        elif action == "set_goal":
            goal, ok = QInputDialog.getInt(mw, "Mục tiêu học mỗi ngày", "Số lượt ôn tập mỗi ngày:", int(settings()["goal"]), 1, 100_000)
            if ok:
                save_settings({"goal": goal})
                send("settings", settings())
        elif action in {"add_file", "add_link"}:
            _add_resource(action == "add_link")
        elif action == "open_resource":
            _open_resource(str(command.get("id")))
        elif action == "resource_menu":
            rid = str(command.get("id"))
            menu = QMenu(mw)
            _menu_action(menu, "Mở tài nguyên", lambda: _open_resource(rid))
            def remove_reference() -> None:
                save_settings({"resources": [r for r in settings()["resources"] if r["id"] != rid]})
                send("settings", settings())
            _menu_action(menu, "Gỡ khỏi dashboard (giữ nguyên file)", remove_reference)
            menu.exec(QCursor.pos())
        elif action == "save_ui":
            _save_ui(command.get("values"))
    except Exception as error:
        global _navigating
        _navigating = False
        send("error", str(error))
    return (True, None)


def _operation_finished(changes: Any, initiator: Any) -> None:
    global _data_revision, _review_changes_only
    if not any(getattr(changes, key, False) for key in ('card','note','deck','config','deck_config','notetype','study_queues','mtime')):
        return
    navigation_only = isinstance(initiator, DeckBrowser) and not any(
        getattr(changes, key, False) for key in ('card','note','deck','notetype','deck_config'))
    if not navigation_only:
        _data_revision += 1
        # Answers and mark/flag operations initiated by Reviewer leave the
        # archive/card totals intact. Edits, imports, sync and Undo invalidate it.
        _review_changes_only = _review_changes_only and initiator is mw.reviewer
    if _refresh_timer and not _navigating and mw.col and mw.state in {"deckBrowser", "overview"} and _dashboard_active():
        _refresh_timer.start(120)


def _profile_closing() -> None:
    global _generation, _active_query, _library_focus, _dashboard_tree, _data_revision, _review_changes_only
    _generation += 1
    _active_query = None
    _library_focus = None
    _dashboard_tree = None
    _data_revision += 1
    _review_changes_only = False
    _history_queries.clear()
    clear_snapshot_cache()
    if _refresh_timer:
        _refresh_timer.stop()
    _restore_chrome()


def _sync_finished(*_args: Any) -> None:
    global _data_revision, _review_changes_only
    _data_revision += 1
    _review_changes_only = False
    clear_snapshot_cache()
    if _refresh_timer and _dashboard_active():
        _refresh_timer.start(120)


def _toggle(enabled: bool) -> None:
    conf = config()
    conf["enabled"] = enabled
    mw.addonManager.writeConfig(MODULE, conf)
    if not enabled:
        _restore_chrome()
    if mw.col:
        mw.moveToState("deckBrowser")


def install() -> None:
    global _installed, _refresh_timer, _toggle_action, _chrome_guard
    if _installed:
        return
    _installed = True
    mw.addonManager.setWebExports(MODULE, r"assets/.*\.(css|js|png|webp)")
    mw.addonManager.setConfigUpdatedAction(MODULE, _config_updated)
    _guard_unused_heatmaps()
    _guard_unused_deck_html()
    gui_hooks.profile_did_open.append(_guard_unused_heatmaps)
    gui_hooks.webview_will_set_content.append(replace_content)
    gui_hooks.webview_did_receive_js_message.append(bridge)
    gui_hooks.operation_did_execute.append(_operation_finished)
    gui_hooks.profile_will_close.append(_profile_closing)
    gui_hooks.sync_did_finish.append(_sync_finished)
    gui_hooks.state_will_change.append(_state_changing)
    gui_hooks.state_did_change.append(_sync_chrome)
    gui_hooks.deck_browser_did_render.append(_sync_chrome)
    gui_hooks.overview_did_refresh.append(_overview_refreshed)
    gui_hooks.top_toolbar_did_redraw.append(_sync_chrome)
    _chrome_guard = _ChromeGuard(mw)
    mw.toolbarWeb.installEventFilter(_chrome_guard)
    mw.bottomWeb.installEventFilter(_chrome_guard)
    mw.installEventFilter(_chrome_guard)
    _refresh_timer = QTimer(mw)
    _refresh_timer.setSingleShot(True)
    qconnect(_refresh_timer.timeout, refresh)
    _toggle_action = QAction("AnkiNOS — Giao diện kính", mw)
    _toggle_action.setCheckable(True)
    _toggle_action.setChecked(bool(config().get("enabled", True)))
    qconnect(_toggle_action.triggered, _toggle)
    mw.form.menuTools.addAction(_toggle_action)
    from .reviewer_ui import install as install_reviewer
    install_reviewer(lambda: bool(config().get("enabled", True)), settings)
