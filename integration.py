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
from aqt.operations.deck import add_deck, remove_decks
from aqt.qt import QAction, QComboBox, QDesktopServices, QDialog, QDialogButtonBox, QEvent, QFileDialog, QFormLayout, QColor, QImage, QImageReader, QPainter, QSize, QInputDialog, QLabel, QLineEdit, QMenu, QObject, QTimer, QUrl, QCursor, Qt, qconnect
from aqt.utils import askUser, getOnlyText, showWarning

from .data import collect_snapshot, collect_overview_snapshot, collect_history_year, overview_base, clear_snapshot_cache
from .graphs_data import collect_native_graphs
from .study_data import collect_support, insight_cards, clear_cache as clear_support_cache
from .backup_store import export_archive, inspect_archive, restore_archive
from .theme_settings import THEME_DEFAULTS, clean_theme_settings
from .media_store import (MAX_IMAGES, MAX_IMAGE_BYTES, SLOTS, THUMBNAIL_SUFFIX, WALLPAPER_SUFFIX, WALLPAPER_MAX_SIDE,
                          WALLPAPER_DIM_MAX, WALLPAPER_BLUR_MAX, IMAGE_FITS,
                          IMAGE_POSITIONS, add_image, delete_image, public_images,
                          valid_images, valid_albums, MAX_ALBUMS, profile_dir)

ROOT = Path(__file__).resolve().parent
MODULE = __package__ or "NOS"
_generation = 0
_installed = False
_integration_ready = False
_active_query: tuple[int, str] | None = None
_refresh_timer: QTimer | None = None
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
_stats_request_serial = 0
_live_context: Any = None
_image_preview_jobs: set[str] = set()
_support_query: tuple | None = None
_backup_busy = False
_session_error = ""
_quick_plan: tuple | None = None
_landing_page: str | None = None
ALLOWED_FILES = {".pdf", ".epub", ".txt", ".md", ".csv", ".xlsx", ".docx", ".pptx", ".mp3", ".wav", ".mp4", ".webm", ".png", ".jpg", ".jpeg", ".webp"}


def enabled() -> bool:
    return _integration_ready and not _session_error and bool(config().get("enabled", True))


def _fallback(error: Exception) -> None:
    """A failed skin must never strand the user on an empty deck browser."""
    global _session_error, _navigating
    if _session_error:
        return
    _session_error = str(error)
    _navigating = False
    _restore_chrome()
    def recover() -> None:
        if mw.col:
            mw.moveToState("deckBrowser")
        showWarning("AnkiNOS đã chuyển về giao diện Anki gốc để bạn tiếp tục học.\n"
                    "Hãy kiểm tra cấu hình add-on và khởi động lại Anki.\n\n" + _session_error, parent=mw)
    QTimer.singleShot(0, recover)


def _compatibility() -> None:
    from importlib.metadata import PackageNotFoundError, version
    try:
        anki_version = version("anki")
    except PackageNotFoundError:
        anki_version = "không xác định"
    checks = [("Danh sách bộ thẻ", callable(getattr(DeckBrowser, "_renderDeckTree", None))),
        ("Chuyển bộ thẻ", callable(getattr(DeckBrowser, "set_current_deck", None))),
        ("Bắt đầu học", callable(getattr(Overview, "_linkHandler", None))),
        ("Thống kê gốc", bool(mw.col and callable(getattr(mw.col._backend, "graphs", None))))]
    text = "Anki " + anki_version + "\n\n" + "\n".join(
        ("Có: " if okay else "Chưa hỗ trợ: ") + name for name, okay in checks)
    if _session_error:
        text += "\n\nLần lỗi gần nhất: " + _session_error
    from aqt.utils import showInfo
    showInfo(text + "\n\nĐây là kiểm tra khả năng API, không phải chứng nhận mọi add-on đều tương thích.", parent=mw)


def _dashboard_active() -> bool:
    return bool(getattr(mw, "col", None) and enabled()
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
    global _overview_rendered, _overview_pending, _navigating, _live_context, _quick_plan
    _live_context = None
    _navigating = False
    _overview_rendered = False
    _overview_pending = False
    if new not in {"overview", "review"}:
        _quick_plan = None
    if new == "review" and mw.col and enabled():
        save_settings({"last_study_deck": str(mw.col.decks.selected())})
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
    previous_enabled = enabled()
    _config_cache = values
    _sync_chrome()
    # Changing profile appearance must not recreate the entire WebView.
    # A native redraw is only needed when the add-on itself was toggled.
    if mw.col and mw.state in {"deckBrowser", "overview"}:
        if previous_enabled != values.get("enabled", True):
            mw.moveToState(mw.state)
        elif values.get("enabled", True):
            send("settings", public_settings())


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
        if enabled() and getattr(view, "name", "") in {"deckbrowser", "overview"}:
            return ""
        return original(view, *args, **kwargs)

    render._nos_guard = True
    controller.render_for_view = render


def _guard_unused_deck_html() -> None:
    original = getattr(DeckBrowser, "_renderDeckTree", None)
    if not callable(original):
        return
    if getattr(original, '_nos_guard', False):
        return

    @wraps(original)
    def render(browser: Any, tree: Any) -> str:
        # NOS replaces this entire table later. Retain Anki's scheduler query
        # and hooks, but avoid building thousands of HTML rows to discard them.
        if enabled():
            return ''
        return original(browser, tree)

    render._nos_guard = True
    DeckBrowser._renderDeckTree = render


def _live_updates(view: Any) -> bool:
    return bool(view is _live_context and mw.col and not _navigating
                and enabled()
                and ((isinstance(view, DeckBrowser) and mw.state == "deckBrowser")
                     or (isinstance(view, Overview) and mw.state == "overview" and _overview_rendered)))


def _guard_live_updates() -> None:
    def guard(view_type: Any) -> None:
        original_op = getattr(view_type, "op_executed", None)
        original_refresh = getattr(view_type, "refresh", None)
        if not callable(original_op) or not callable(original_refresh):
            return
        if getattr(original_op, "_nos_guard", False):
            return

        @wraps(original_op)
        def op_executed(view: Any, changes: Any, handler: Any, focused: bool) -> bool:
            if _live_updates(view):
                # The operation hook pushes a snapshot even while Add/Browser
                # has focus. Returning dirty would fade and later reload HTML.
                view._refresh_needed = False
                return False
            return original_op(view, changes, handler, focused)

        @wraps(original_refresh)
        def refresh_view(view: Any) -> None:
            if _live_updates(view):
                view._refresh_needed = False
                if _refresh_timer:
                    _refresh_timer.start(0)
                return
            return original_refresh(view)

        op_executed._nos_guard = True
        view_type.op_executed = op_executed
        view_type.refresh = refresh_view

    guard(DeckBrowser)
    guard(Overview)


def _begin_navigation() -> None:
    global _navigating, _generation
    _navigating = True
    _generation += 1
    if _refresh_timer:
        _refresh_timer.stop()


def settings() -> dict[str, Any]:
    profile = config().get("profiles", {}).get(mw.pm.name, {})
    return {"goal": 200, **THEME_DEFAULTS,
            "activity_collapsed": False, "library_collapsed": False, "sidebar_collapsed": False,
            "favorites": [], "colors": {}, "resources": [], "view": "list",
            "blur": True, "animations": True, "ui_scale": 100,
            "stat_retention": True, "stat_pace": True, "stat_time": True, "stat_studied": True,
            "heatmap_day": "monday", "heatmap_palette": "default",
            "images": [], "image_albums": [], "image_dashboard": None, "image_overview": None,
            "image_review": None, "image_avatar": None,
            "image_fit_dashboard": "cover", "image_fit_overview": "cover",
            "image_fit_review": "cover", "image_fit_avatar": "cover",
            "wallpaper_dim": 28, "wallpaper_blur": 0,
            "image_position_dashboard": "center", "image_position_overview": "center",
            "image_position_review": "center", "image_position_avatar": "center",
            **profile}


def public_settings() -> dict[str, Any]:
    """Send only verified, existing local-image URLs to the WebView."""
    data = settings()
    package = mw.addonManager.addonFromModule(MODULE)
    data["image_albums"] = valid_albums(data.get("image_albums"))
    album_ids = {item["id"] for item in data["image_albums"]}
    data["images"] = public_images(ROOT, mw.pm.name, data.get("images"), str(package))
    for entry in data["images"]:
        if entry.get("album_id") not in album_ids:
            entry.pop("album_id", None)
    return data


def _image_add(album_id: str = "") -> None:
    paths, _ = QFileDialog.getOpenFileNames(
        mw, "Thêm ảnh vào thư viện AnkiNOS", "",
        "Ảnh (*.png *.jpg *.jpeg *.webp)")
    if not paths:
        return
    images = valid_images(settings().get("images"))
    album_ids = {entry["id"] for entry in valid_albums(settings().get("image_albums"))}
    if album_id not in album_ids:
        album_id = ""
    added = 0
    errors: list[str] = []
    for path in paths:
        if len(images) >= MAX_IMAGES:
            errors.append(f"Thư viện đã đạt giới hạn {MAX_IMAGES} ảnh.")
            break
        try:
            source = Path(path)
            if source.stat().st_size > MAX_IMAGE_BYTES:
                raise ValueError("Dung lượng vượt quá 16 MB.")
            reader = QImageReader(str(source))
            if not reader.canRead():
                raise ValueError("Không thể đọc tệp ảnh.")
            image_format = bytes(reader.format()).decode("ascii", "ignore").lower()
            reader.setAutoTransform(True)
            dimensions = reader.size()
            if (not dimensions.isValid() or dimensions.width() < 1
                    or dimensions.height() < 1 or dimensions.width() > 8000
                    or dimensions.height() > 8000
                    or dimensions.width() * dimensions.height() > 24_000_000):
                raise ValueError("Ảnh quá lớn (tối đa 24 megapixel).")
            # Decode once at preview resolution to reject corrupt images and
            # avoid decoding a 24-megapixel original in the settings gallery.
            scale = min(1.0, 480 / max(dimensions.width(), dimensions.height()))
            reader.setScaledSize(QSize(
                max(1, round(dimensions.width() * scale)),
                max(1, round(dimensions.height() * scale)),
            ))
            thumbnail = reader.read()
            if thumbnail.isNull():
                raise ValueError("Không giải mã được ảnh: " + reader.errorString())
            entry = add_image(
                ROOT, mw.pm.name, source, image_format,
                width=dimensions.width(), height=dimensions.height(),
            )
            thumb_path = profile_dir(ROOT, mw.pm.name) / (entry["id"] + THUMBNAIL_SUFFIX)
            temporary = thumb_path.with_suffix(".tmp")
            try:
                # PNG preview retains transparency and source aspect ratio.
                if not thumbnail.save(str(temporary), "PNG"):
                    raise ValueError("Không tạo được ảnh xem trước.")
                temporary.replace(thumb_path)
            except Exception:
                temporary.unlink(missing_ok=True)
                (profile_dir(ROOT, mw.pm.name) / (entry["id"] + entry["ext"])).unlink(missing_ok=True)
                raise
            if album_id:
                entry["album_id"] = album_id
            images.append(entry)
            added += 1
        except (OSError, ValueError) as error:
            errors.append(f"{Path(path).name}: {error}")
    if added:
        save_settings({"images": images})
        send("settings", public_settings())
        _prepare_image_previews()  # wallpaper-sized copies are built off the UI thread
    send("image_library", {"message": f"Đã thêm {added} ảnh." if added else "Không có ảnh nào được thêm.",
                           "errors": errors[:5]})


def _write_derivative(source: Path, target: Path, max_side: int, fmt: str, quality: int = -1) -> None:
    """Write a downscaled copy of ``source`` atomically. Never upscales."""
    temporary = target.with_suffix("." + uuid.uuid4().hex + ".tmp")
    try:
        reader = QImageReader(str(source))
        reader.setAutoTransform(True)
        size = reader.size()
        if (not size.isValid() or size.width() < 1 or size.height() < 1
                or size.width() * size.height() > 24_000_000):
            raise ValueError("Invalid image dimensions")
        scale = min(1.0, max_side / max(size.width(), size.height()))
        reader.setScaledSize(QSize(max(1, round(size.width() * scale)), max(1, round(size.height() * scale))))
        image = reader.read()
        if image.isNull():
            raise ValueError("Could not decode image")
        if fmt == "JPEG" and image.hasAlphaChannel():
            # JPEG has no alpha: flatten transparent PNG/WebP onto the dusk gradient colour.
            canvas = QImage(image.size(), QImage.Format.Format_RGB32)
            canvas.fill(QColor("#233450"))
            painter = QPainter(canvas)
            painter.drawImage(0, 0, image)
            painter.end()
            image = canvas
        if not image.save(str(temporary), fmt, quality):
            raise ValueError("Could not write image")
        if source.is_file():  # a photo deleted while this job ran must stay deleted
            temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def _prepare_image_previews() -> None:
    """Build missing previews and wallpaper copies without blocking the UI thread."""
    profile = mw.pm.name
    if profile in _image_preview_jobs:
        return
    directory = profile_dir(ROOT, profile)
    missing = [entry for entry in valid_images(settings().get("images"))
               if not (directory / (entry["id"] + THUMBNAIL_SUFFIX)).is_file()
               or not (directory / (entry["id"] + WALLPAPER_SUFFIX)).is_file()]
    if not missing:
        return
    _image_preview_jobs.add(profile)

    def build() -> int:
        failures = 0
        for entry in missing:
            source = directory / (entry["id"] + entry["ext"])
            if not source.is_file():
                continue
            for suffix, side, fmt, quality in ((THUMBNAIL_SUFFIX, 480, "PNG", -1),
                                               (WALLPAPER_SUFFIX, WALLPAPER_MAX_SIDE, "JPEG", 86)):
                target = directory / (entry["id"] + suffix)
                if target.is_file():
                    continue
                try:
                    _write_derivative(source, target, side, fmt, quality)
                except Exception:
                    failures += 1
        return failures

    def done(future: Any) -> None:
        _image_preview_jobs.discard(profile)
        try:
            failures = future.result()
        except Exception:
            failures = 1
        if mw.col and mw.pm.name == profile:
            send("settings", public_settings())
            if failures:
                send("image_library", {"message": "Một số ảnh chưa tạo được bản xem trước hoặc bản nền.", "errors": []})

    mw.taskman.run_in_background(build, done)


def _image_delete(identifier: str) -> None:
    data = settings()
    images = valid_images(data.get("images"))
    item = next((entry for entry in images if entry["id"] == identifier), None)
    if not item:
        return
    if not askUser(f"Xóa ảnh '{item['name']}' khỏi thư viện AnkiNOS?"):
        return
    remaining = delete_image(ROOT, mw.pm.name, images, identifier)
    patch: dict[str, Any] = {"images": remaining}
    for slot in SLOTS:
        if data.get(slot) == identifier:
            patch[slot] = None
    save_settings(patch)
    send("settings", public_settings())
    send("image_library", {"message": "Đã xóa ảnh khỏi thư viện.", "errors": []})



def _image_rename(identifier: str, title: Any) -> None:
    if not isinstance(title, str):
        return
    title = title.strip()
    if not 1 <= len(title) <= 80 or any(ord(char) < 32 for char in title):
        send("image_library", {"message": "Tên ảnh không hợp lệ (1–80 ký tự).", "errors": []})
        return
    images = valid_images(settings().get("images"))
    entry = next((item for item in images if item["id"] == identifier), None)
    if not entry:
        return
    entry["name"] = title
    save_settings({"images": images})
    send("settings", public_settings())
    send("image_library", {"message": "Đã đổi tên ảnh.", "errors": []})


def _image_move(identifier: str, album_id: str) -> None:
    albums = valid_albums(settings().get("image_albums"))
    if album_id and album_id not in {item["id"] for item in albums}:
        return
    images = valid_images(settings().get("images"))
    entry = next((item for item in images if item["id"] == identifier), None)
    if not entry:
        return
    if album_id:
        entry["album_id"] = album_id
    else:
        entry.pop("album_id", None)
    save_settings({"images": images})
    send("settings", public_settings())


def _image_assign(slot: str, identifier: Any) -> None:
    if slot not in SLOTS:
        return
    allowed = {item["id"] for item in public_settings()["images"]}
    if identifier not in (None, "") and (not isinstance(identifier, str) or identifier not in allowed):
        return
    save_settings({slot: identifier or None})
    send("settings", public_settings())
    send("image_library", {"message": "Đã lưu ảnh cho giao diện.", "errors": []})


def _album_action(action: str, identifier: str, title: Any) -> None:
    albums = valid_albums(settings().get("image_albums"))
    images = valid_images(settings().get("images"))
    selected = next((item for item in albums if item["id"] == identifier), None)
    if action == "album_delete":
        if selected is None:
            return
        albums = [item for item in albums if item["id"] != identifier]
        # Deleting an album never deletes original images.
        for image in images:
            if image.get("album_id") == identifier:
                image.pop("album_id", None)
        save_settings({"image_albums": albums, "images": images})
    elif action in {"album_create", "album_rename"}:
        if not isinstance(title, str):
            return
        title = title.strip()
        if (not 1 <= len(title) <= 80 or any(ord(char) < 32 for char in title)
                or any(item["name"].casefold() == title.casefold() and item["id"] != identifier for item in albums)):
            send("image_library", {"message": "Tên album trống, trùng hoặc không hợp lệ.", "errors": []})
            return
        if action == "album_create":
            if len(albums) >= MAX_ALBUMS:
                send("image_library", {"message": "Chỉ được tạo tối đa 30 album.", "errors": []})
                return
            albums.append({"id": uuid.uuid4().hex, "name": title})
        elif selected is not None:
            selected["name"] = title
        else:
            return
        save_settings({"image_albums": albums})
    else:
        return
    send("settings", public_settings())
    send("image_library", {"message": "Đã cập nhật album.", "errors": []})


def save_settings(patch: dict[str, Any]) -> None:
    conf = config()
    profiles = conf.setdefault("profiles", {})
    updated = {**settings(), **patch}
    if profiles.get(mw.pm.name) == updated:
        return
    profiles[mw.pm.name] = updated
    mw.addonManager.writeConfig(MODULE, conf)


def send(event: str, payload: Any) -> None:
    if mw.col and mw.state in {"deckBrowser", "overview"} and enabled():
        encoded = json.dumps({"event": event, "payload": payload}, ensure_ascii=True)
        mw.web.eval(f"window.AnkiNOS && window.AnkiNOS.receive({encoded});")


def refresh() -> None:
    global _active_query, _dashboard_tree
    if _navigating or not mw.col or mw.state not in {"deckBrowser", "overview"} or not enabled():
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
        global _active_query, _review_changes_only, _landing_page
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
        snapshot = {**snapshot, 'profile':profile_name, 'settings':public_settings(), 'fullscreen':mw.isFullScreen(), 'selected_deck':str(mw.col.decks.selected()), 'support_revision':_data_revision}
        if not overview and _library_focus:
            snapshot["library_focus"] = _library_focus
        if not overview and _landing_page:
            snapshot["open_page"], _landing_page = _landing_page, None
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


def _study_support(force: bool = False) -> None:
    global _support_query
    if not mw.col or mw.state != "deckBrowser" or _navigating:
        return
    token = (_generation, mw.pm.name, _data_revision)
    if _support_query == token:
        return
    if force:
        clear_support_cache()
    _support_query = token
    def success(payload: dict | None) -> None:
        global _support_query
        if _support_query == token:
            _support_query = None
        if token != (_generation, mw.pm.name, _data_revision):
            if mw.state == "deckBrowser":
                _study_support()
            return
        if payload:
            send("study_support", payload)
    def failure(error: Exception) -> None:
        global _support_query
        if _support_query == token:
            _support_query = None
        if token[:2] == (_generation, mw.pm.name):
            send("study_support_error", "Không thể đọc nhận xét học tập: " + str(error))
    QueryOp(parent=mw, op=lambda col: collect_support(col, token[2])
            if token == (_generation, mw.pm.name, _data_revision) and not _navigating else None,
            success=success).failure(failure).run_in_background()


def _quick_study(did: int, minutes: Any = None) -> None:
    if _navigating:
        return
    if minutes is not None and (type(minutes) is not int or minutes not in {15, 30, 60}):
        raise ValueError("Chọn thời lượng 15, 30 hoặc 60 phút.")
    from aqt.operations.deck import set_current_deck
    profile = mw.pm.name
    _begin_navigation()
    generation = _generation
    def success(_result: Any) -> None:
        global _navigating, _quick_plan
        if not mw.col or mw.pm.name != profile or generation != _generation or mw.state != "deckBrowser" or not enabled():
            _navigating = False
            return
        _quick_plan = (profile, str(did), minutes)
        # Start from the loaded overview's bridge. An immediate second setHtml
        # can let its asynchronous load overwrite the reviewer's card page.
        mw.onOverview()
    def failure(error: Exception) -> None:
        global _navigating
        _navigating = False
        send("error", "Không thể bắt đầu phiên học: " + str(error))
    set_current_deck(parent=mw, deck_id=did).success(success).failure(failure).run_in_background(initiator=mw.deckBrowser)


def _start_overview_review() -> None:
    global _quick_plan
    plan, _quick_plan = _quick_plan, None
    if plan and plan[:2] == (mw.pm.name, str(mw.col.decks.selected())) and plan[2]:
        from .reviewer_ui import prepare_focus
        prepare_focus(plan[2])
    _begin_navigation()
    mw.overview._linkHandler("study")


def _insight_browse(did: int, kind: str) -> None:
    token = (_generation, mw.pm.name)
    def success(ids: list[int]) -> None:
        if token != (_generation, mw.pm.name) or not mw.col:
            return
        if not ids:
            send("study_support_error", "Các thẻ liên quan đã thay đổi. Hãy làm mới nhận xét.")
            return
        browser = dialogs.open("Browser", mw)
        browser.search_for("cid:" + ",".join(str(cid) for cid in ids))
        browser.show(); browser.raise_(); browser.activateWindow()
    QueryOp(parent=mw, op=lambda col: insight_cards(col, did, kind), success=success).failure(
        lambda error: send("study_support_error", str(error))).run_in_background()


def _backup_job(task: Any, done: Any) -> None:
    global _backup_busy
    if _backup_busy:
        return
    _backup_busy = True
    send("backup_status", {"busy": True, "message": "Đang kiểm tra và xử lý gói dữ liệu…"})
    def finished(future: Any) -> None:
        global _backup_busy
        _backup_busy = False
        try:
            done(future.result())
        except Exception as error:
            message = "Không thể xử lý gói sao lưu: " + str(error)
            send("backup_status", {"busy": False, "message": message})
            showWarning(message, parent=mw)
    mw.taskman.with_progress(task, finished, label="Đang xử lý sao lưu AnkiNOS…", immediate=True, uses_collection=False)


def _backup_export() -> None:
    if _backup_busy:
        return
    path, _ = QFileDialog.getSaveFileName(mw, "Sao lưu đầy đủ AnkiNOS", "AnkiNOS-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".nosbackup", "Gói AnkiNOS (*.nosbackup)")
    if not path:
        return
    from .reviewer_ui import checkpoint_focus
    checkpoint_focus()
    profile, values = mw.pm.name, settings()
    names = {str(d.id): d.name for d in mw.col.decks.all_names_and_ids()}
    def done(destination: Path) -> None:
        send("backup_status", {"busy": False, "message": "Đã sao lưu đầy đủ tại " + str(destination)})
        if not enabled():
            from aqt.utils import showInfo
            showInfo("Đã sao lưu đầy đủ tại " + str(destination), parent=mw)
    _backup_job(lambda: export_archive(ROOT, profile, values, Path(path).with_suffix(".nosbackup"), deck_names=names), done)


def _backup_restore() -> None:
    if _backup_busy:
        return
    path, _ = QFileDialog.getOpenFileName(mw, "Chọn gói AnkiNOS để xem trước", "", "Gói AnkiNOS (*.nosbackup)")
    if not path:
        return
    profile = mw.pm.name
    def preview(manifest: dict) -> None:
        if not mw.col or mw.pm.name != profile:
            return
        values = manifest["settings"]
        text = ("<b>Xem trước khôi phục AnkiNOS</b><br><br>Hồ sơ nguồn: " + html.escape(str(manifest.get("profile", "")))
            + "<br>Tạo lúc: " + html.escape(str(manifest.get("created_at", "")))
            + f"<br>Ảnh: {len(values['images'])} · Album: {len(values['image_albums'])} · Phiên Focus: {manifest['focus_sessions']}"
            + f"<br>Tham chiếu tài nguyên: {len(values['resources'])}"
            + f"<br>Ghi chú: {manifest.get('workspace',{}).get('notes',0)}"
            + "<br><br>Hồ sơ nhận: <b>" + html.escape(profile) + "</b>"
            + "<br>Cấu hình, ảnh, Focus và sổ tay sẽ được thay thế. Dữ liệu lưu trữ cũ được giữ trong gói. Bản dự phòng hiện tại được lưu vào user_files/backups trước khi thay thế."
            + "<br>Thẻ Anki không nằm trong gói này. Tài nguyên ngoài add-on chỉ lưu đường dẫn, có thể cần gắn lại khi đổi máy."
            + "<br><br>Khôi phục vào hồ sơ này?")
        send("backup_status", {"busy": False, "message": "Đã kiểm tra toàn vẹn gói. Đang chờ xác nhận khôi phục."})
        if not askUser(text, parent=mw, defaultno=True):
            send("backup_status", {"busy": False, "message": "Đã hủy khôi phục. Dữ liệu hiện tại được giữ nguyên."})
            return
        if mw.state == "review":
            mw.moveToState("deckBrowser")
        from .reviewer_ui import reset_focus_store
        reset_focus_store()
        from .study_tools_ui import reset_tools
        reset_tools()
        original = settings()
        names = {str(d.id): d.name for d in mw.col.decks.all_names_and_ids()}
        def persist(values: dict) -> None:
            # Disk I/O stays off the UI thread; only Anki's config API runs here.
            from threading import Event
            completed, errors = Event(), []
            def write() -> None:
                try:
                    conf = config()
                    conf.setdefault("profiles", {})[profile] = values
                    mw.addonManager.writeConfig(MODULE, conf)
                except Exception as error:
                    errors.append(error)
                finally:
                    completed.set()
            mw.taskman.run_on_main(write)
            completed.wait()
            if errors:
                raise errors[0]
        def restored(backup: Path) -> None:
            global _data_revision
            _data_revision += 1
            clear_support_cache()
            send("settings", public_settings())
            refresh()
            send("backup_status", {"busy": False, "message": "Đã khôi phục đầy đủ. Bản trước khôi phục: " + str(backup)})
            if not enabled():
                from aqt.utils import showInfo
                showInfo("Đã khôi phục dữ liệu AnkiNOS. Bản trước khôi phục: " + str(backup), parent=mw)
        _backup_job(lambda: restore_archive(ROOT, profile, Path(path), manifest["archive_sha256"], original, persist, deck_names=names), restored)
    def validate_image(path: Path) -> None:
        reader = QImageReader(str(path))
        size = reader.size()
        if not reader.canRead() or size.width() <= 0 or size.height() <= 0 or size.width() * size.height() > 24_000_000:
            raise ValueError("Ảnh trong gói không hợp lệ hoặc vượt 24 megapixel: " + path.name)
    _backup_job(lambda: inspect_archive(ROOT, Path(path), validate_image=validate_image), preview)


def _stats_pdf() -> None:
    """Export the currently visible AnkiNOS statistics page, not the legacy dialog."""
    if mw.state != "deckBrowser" or not mw.col:
        return
    suggested = f"AnkiNOS-Thong-ke-{datetime.now():%Y-%m-%d}.pdf"
    path, _ = QFileDialog.getSaveFileName(
        mw, "Lưu báo cáo Thống kê AnkiNOS",
        str(Path.home() / suggested), "Tệp PDF (*.pdf)")
    if not path:
        return
    destination = str(Path(path).with_suffix(".pdf"))
    mw.web.page().printToPdf(destination)


def open_statistics() -> None:
    global _landing_page
    if not enabled():
        mw.onStats()
        return
    _landing_page = "stats"
    if mw.state != "deckBrowser":
        mw.moveToState("deckBrowser")
    else:
        refresh()


def _stats_graphs(scope: str, days: int) -> None:
    """Fetch the native Anki graphs lazily, only while the Stats page is open."""
    global _stats_request_serial
    if not mw.col or mw.state != "deckBrowser" or _navigating:
        return
    if scope not in {"deck", "collection"} or type(days) is not int or days not in {0, 365}:
        send("graphs_error", "Bộ lọc thống kê không hợp lệ.")
        return
    _stats_request_serial += 1
    token = (_generation, mw.pm.name, _stats_request_serial)
    revision = _data_revision

    def read(col: Any) -> dict[str, Any] | None:
        if token != (_generation, mw.pm.name, _stats_request_serial) or _navigating:
            return None
        return collect_native_graphs(col, scope, days)

    def success(payload: dict[str, Any] | None) -> None:
        if not payload or token != (_generation, mw.pm.name, _stats_request_serial):
            return
        if revision != _data_revision:
            _stats_graphs(scope, days)
            return
        send("graphs", payload)

    def failure(error: Exception) -> None:
        if token == (_generation, mw.pm.name, _stats_request_serial):
            send("graphs_error", "Không thể tải thống kê Anki: " + str(error))

    QueryOp(parent=mw, op=read, success=success).failure(failure).run_in_background()


def _history_year(year: int) -> None:
    if mw.state != 'deckBrowser' or not 2006 <= year <= datetime.now().year:
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


def _replace_content(content: Any, context: Any) -> None:
    global _generation, _overview_rendered, _overview_pending, _dashboard_tree, _live_context
    if not isinstance(context, (DeckBrowser, Overview)) or not enabled():
        return
    _live_context = context
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
        initial["auto_start"] = bool(_quick_plan and _quick_plan[:2] == (mw.pm.name, str(initial["id"])))
        initial.update(profile=mw.pm.name, settings=public_settings(), fullscreen=mw.isFullScreen())
        content.body += '<textarea id="nos-overview-bootstrap" hidden>' + html.escape(json.dumps(initial, ensure_ascii=True)) + '</textarea>'
    package = mw.addonManager.addonFromModule(MODULE)
    base = f"/_addons/{package}/assets"
    content.css = [p for p in content.css if p != "css/deckbrowser.css"]
    content.js = [p for p in content.js if p != "js/deckbrowser.js"]
    content.css.append(f"{base}/dashboard.css")
    if overview:
        content.css = [p for p in content.css if p != "css/overview.css"]
        content.css.append(f"{base}/overview.css")
    content.js.append(f"{base}/theme.js")
    content.js.append(f"{base}/runtime-guard.js")
    content.js.append(f"{base}/overview.js" if overview else f"{base}/dashboard.js")
    if not overview:
        content.css.append(f"{base}/stats-page.css")
        content.css.append(f"{base}/focus-dashboard.css")
        content.js.append(f"{base}/stats-page.js")
        content.js.append(f"{base}/focus-dashboard.js")
        content.css.append(f"{base}/media-studio.css")
        content.js.append(f"{base}/media-studio.js")
        content.css.append(f"{base}/study-dashboard.css")
        content.js.append(f"{base}/study-dashboard.js")
    content.css.append(f"{base}/theme.css")



def replace_content(content: Any, context: Any) -> None:
    original = (content.body, list(content.css), list(content.js))
    try:
        _replace_content(content, context)
    except Exception as error:
        content.body, content.css, content.js = original
        _fallback(error)


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
    send("settings", public_settings())


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


def _create_deck(parent_id: int | None = None) -> None:
    dialog = QDialog(mw)
    dialog.setWindowTitle("Tạo bộ thẻ")
    dialog.setMinimumWidth(420)
    layout = QFormLayout(dialog)
    name = QLineEdit(dialog)
    name.setObjectName("nos-deck-name")
    name.setPlaceholderText("Tên bộ thẻ mới")
    parent = QComboBox(dialog)
    parent.setObjectName("nos-deck-parent")
    parent.addItem("Không có — tạo bộ thẻ cấp cao nhất", 0)
    for deck in mw.col.decks.all_names_and_ids(include_filtered=False):
        parent.addItem(deck.name, deck.id)
    if parent_id is not None:
        selected = parent.findData(parent_id)
        if selected < 0:
            raise ValueError("Không thể tạo deck con trong bộ thẻ lọc.")
        parent.setCurrentIndex(selected)
    layout.addRow("Tên bộ thẻ:", name)
    layout.addRow("Bộ thẻ cha:", parent)
    buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
    buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Tạo")
    buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("Đóng")
    layout.addRow(buttons)
    status = QLabel(dialog)
    status.setObjectName("nos-deck-status")
    status.setTextFormat(Qt.TextFormat.PlainText)
    status.setWordWrap(True)
    layout.addRow(status)
    creating = False

    def busy(value: bool) -> None:
        nonlocal creating
        creating = value
        name.setEnabled(not value)
        parent.setEnabled(not value)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setEnabled(not value)

    def create() -> None:
        if creating:
            return
        parts = [part.strip() for part in name.text().split("::")]
        if not all(parts):
            showWarning("Nhập tên bộ thẻ; tên từng cấp không được để trống.", parent=dialog)
            return
        full_name = "::".join(parts)
        if selected_id := parent.currentData():
            deck = mw.col.decks.get(_deck_id(selected_id), default=False)
            full_name = deck["name"] + "::" + full_name
        if mw.col.decks.by_name(full_name):
            showWarning("Bộ thẻ này đã tồn tại. Hãy chọn tên khác.", parent=dialog)
            return
        busy(True)
        status.setText("Đang tạo bộ thẻ…")

        def created(_result: Any) -> None:
            if not dialog.isVisible():
                return
            selected_id = parent.currentData()
            parent.clear()
            parent.addItem("Không có — tạo bộ thẻ cấp cao nhất", 0)
            for deck in mw.col.decks.all_names_and_ids(include_filtered=False):
                parent.addItem(deck.name, deck.id)
            parent.setCurrentIndex(max(0, parent.findData(selected_id)))
            busy(False)
            name.clear()
            status.setText("Đã tạo: " + full_name)
            name.setFocus()

        def failed(error: Exception) -> None:
            if dialog.isVisible():
                busy(False)
                status.setText("Không thể tạo bộ thẻ: " + str(error))
                name.setFocus()

        add_deck(parent=mw, name=full_name).success(created).failure(failed).run_in_background()

    qconnect(buttons.accepted, create)
    qconnect(buttons.rejected, dialog.reject)
    name.setFocus()
    dialog.exec()


def _deck_menu(did: int) -> None:
    menu = QMenu(mw)
    from .study_tools_ui import open_notebook
    _menu_action(menu, "Sổ tay…", lambda: open_notebook(did))
    menu.addSeparator()
    starred = str(did) in settings()["favorites"]
    _menu_action(menu, "Bỏ gắn sao" if starred else "Gắn sao bộ thẻ", lambda: _favorite(str(did)))
    _menu_action(menu, "Duyệt thẻ", lambda: _browse(did))
    if not mw.col.decks.get(did)["dyn"]:
        _menu_action(menu, "Tạo deck con…", lambda: _create_deck(did))
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
            send("settings", public_settings())
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
            # Keep the library open; only leave an overview whose deck vanished.
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
    send("settings", public_settings())


def _save_ui(values: Any) -> None:
    """Persist only supported profile settings; ignore malformed WebView data."""
    if not isinstance(values, dict):
        return
    patch: dict[str, Any] = clean_theme_settings(values)
    for key in (
        "activity_collapsed", "library_collapsed", "sidebar_collapsed", "blur",
        "animations", "lite_mode", "stat_retention", "stat_pace",
        "stat_time", "stat_studied",
    ):
        if type(values.get(key)) is bool:
            patch[key] = values[key]
    for key, allowed in {
        "view": {"list", "grid"},
        "heatmap_day": {"monday", "sunday"},
        "heatmap_palette": {"default", "green", "orange", "purple"},
    }.items():
        if isinstance(values.get(key), str) and values[key] in allowed:
            patch[key] = values[key]
    if type(values.get("goal")) is int and 1 <= values["goal"] <= 100_000:
        patch["goal"] = values["goal"]
    if type(values.get("ui_scale")) is int and values["ui_scale"] in {85, 90, 100, 110, 120}:
        patch["ui_scale"] = values["ui_scale"]
    if type(values.get("study_budget")) is int and values["study_budget"] in {15, 30, 60}:
        patch["study_budget"] = values["study_budget"]
    for key, limit in (("wallpaper_dim", WALLPAPER_DIM_MAX), ("wallpaper_blur", WALLPAPER_BLUR_MAX)):
        if type(values.get(key)) is int and 0 <= values[key] <= limit:
            patch[key] = values[key]
    known_images = {item["id"] for item in public_settings()["images"]}
    for slot in SLOTS:
        if slot not in values:
            continue
        value = values[slot]
        if value is None or value == "":
            patch[slot] = None
        elif isinstance(value, str) and value in known_images:
            patch[slot] = value
    for surface in ("dashboard", "overview", "review", "avatar"):
        fit = values.get("image_fit_" + surface)
        position = values.get("image_position_" + surface)
        if isinstance(fit, str) and fit in IMAGE_FITS:
            patch["image_fit_" + surface] = fit
        if isinstance(position, str) and position in IMAGE_POSITIONS:
            patch["image_position_" + surface] = position
    if patch:
        save_settings(patch)


def bridge(handled: tuple[bool, Any], message: str, context: Any) -> tuple[bool, Any]:
    global _library_focus, _data_revision, _review_changes_only, _quick_plan
    if handled[0] or not isinstance(context, (DeckBrowser, Overview)) or not message.startswith("nos:"):
        return handled
    if not mw.col or mw.state not in {"deckBrowser", "overview"} or not enabled():
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
                    _start_overview_review()
                else:
                    mw.overview._linkHandler(native_action)
        elif action == "back":
            mw.moveToState("deckBrowser")
        elif action == "snapshot":
            if command.get('force') is True:
                _data_revision += 1
                _review_changes_only = False
            refresh()
        elif action == "study_support":
            _study_support(command.get("force") is True)
        elif action == "commands":
            from .study_tools_ui import open_commands
            open_commands()
        elif action == "notebook":
            from .study_tools_ui import open_notebook
            did = _deck_id(command["id"]) if command.get("id") else mw.col.decks.selected()
            open_notebook(did)
        elif action == "quick_study":
            _quick_study(_deck_id(command.get("id")), command.get("minutes"))
        elif action == "insight_browse":
            _insight_browse(_deck_id(command.get("id")), command.get("kind"))
        elif action == "backup_export":
            _backup_export()
        elif action == "backup_restore":
            _backup_restore()
        elif action == "compatibility":
            _compatibility()
        elif action == "native_mode":
            _toggle(False)
        elif action == "runtime_failure":
            _fallback(RuntimeError(str(command.get("message", "Không thể nạp giao diện."))[:1000]))
        elif action == 'history_year':
            _history_year(int(command.get('year')))
        elif action == "graphs":
            # Native Rust graph data: all standard Anki statistics sections.
            _stats_graphs(command.get("scope"), command.get("days"))
        elif action == "focus_history":
            from .reviewer_ui import focus_history
            send("focus_history", focus_history())
        elif action == "stats_pdf":
            _stats_pdf()
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
            _create_deck(_deck_id(command["id"]) if command.get("id") else None)
        elif action == "deck_menu":
            _deck_menu(_deck_id(command.get("id")))
        elif action == "favorite":
            did = str(_deck_id(command.get("id")))
            _favorite(did)
        elif action == "set_goal":
            goal, ok = QInputDialog.getInt(mw, "Mục tiêu học mỗi ngày", "Số lượt ôn tập mỗi ngày:", int(settings()["goal"]), 1, 100_000)
            if ok:
                save_settings({"goal": goal})
                send("settings", public_settings())
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
                send("settings", public_settings())
            _menu_action(menu, "Gỡ khỏi dashboard (giữ nguyên file)", remove_reference)
            menu.exec(QCursor.pos())
        elif action == "save_ui":
            _save_ui(command.get("values"))
        elif action == "apply_settings":
            _save_ui(command.get("values"))
            send("settings", public_settings())
        elif action == "image_previews":
            _prepare_image_previews()
        elif action == "image_add":
            _image_add(str(command.get("album_id") or ""))
        elif action == "image_delete":
            _image_delete(str(command.get("id", "")))
        elif action == "image_rename":
            _image_rename(str(command.get("id", "")), command.get("name"))
        elif action == "image_move":
            _image_move(str(command.get("id", "")), str(command.get("album_id") or ""))
        elif action == "image_assign":
            _image_assign(str(command.get("slot", "")), command.get("id"))
        elif action in {"album_create", "album_rename", "album_delete"}:
            _album_action(action, str(command.get("id", "")), command.get("name"))
    except Exception as error:
        global _navigating
        _navigating = False
        send("error", str(error))
    return (True, None)


def _operation_finished(changes: Any, initiator: Any) -> None:
    global _data_revision, _review_changes_only, _dashboard_tree
    if not any(getattr(changes, key, False) for key in ('card','note','deck','config','deck_config','notetype','study_queues','mtime')):
        return
    navigation_only = isinstance(initiator, DeckBrowser) and not any(
        getattr(changes, key, False) for key in ('card','note','deck','notetype','deck_config'))
    if not navigation_only:
        _dashboard_tree = None
        _data_revision += 1
        # Answers and mark/flag operations initiated by Reviewer leave the
        # archive/card totals intact. Edits, imports, sync and Undo invalidate it.
        _review_changes_only = _review_changes_only and initiator is mw.reviewer
    if _refresh_timer and not _navigating and mw.col and mw.state in {"deckBrowser", "overview"} and _dashboard_active():
        _refresh_timer.start(120)


def _profile_closing() -> None:
    global _generation, _active_query, _library_focus, _dashboard_tree, _data_revision, _review_changes_only, _stats_request_serial, _live_context, _landing_page
    _live_context = None
    _generation += 1
    _stats_request_serial += 1
    _active_query = None
    _library_focus = None
    _landing_page = None
    _dashboard_tree = None
    _data_revision += 1
    _review_changes_only = False
    _history_queries.clear()
    clear_snapshot_cache()
    clear_support_cache()
    if _refresh_timer:
        _refresh_timer.stop()
    _restore_chrome()


def _sync_finished(*_args: Any) -> None:
    global _data_revision, _review_changes_only, _dashboard_tree
    _dashboard_tree = None
    _data_revision += 1
    _review_changes_only = False
    clear_snapshot_cache()
    clear_support_cache()
    if _refresh_timer and _dashboard_active():
        _refresh_timer.start(120)


def _toggle(active: bool) -> None:
    global _session_error
    if active and not _integration_ready:
        showWarning("AnkiNOS chưa khởi tạo đầy đủ. Hãy kiểm tra phiên bản Anki và khởi động lại trước khi bật lại.", parent=mw)
        return
    _session_error = ""
    conf = config()
    conf["enabled"] = active
    mw.addonManager.writeConfig(MODULE, conf)
    if not active:
        _restore_chrome()
    if mw.col:
        mw.moveToState("deckBrowser")


def install() -> None:
    global _installed, _refresh_timer, _chrome_guard, _integration_ready
    if _installed:
        return
    _installed = True
    mw.addonManager.setWebExports(MODULE, r"(?:assets/.*\.(?:css|js|png|webp)|user_files/[0-9a-f]{20}/[0-9a-f]{32}(?:-thumb|-wall)?\.(?:png|jpg|webp))")
    mw.addonManager.setConfigUpdatedAction(MODULE, _config_updated)
    _guard_unused_heatmaps()
    _guard_unused_deck_html()
    _guard_live_updates()
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
    from .reviewer_ui import install as install_reviewer
    install_reviewer(lambda: bool(enabled()), public_settings)
    from .study_tools_ui import install as install_tools
    install_tools()
    _integration_ready = True
