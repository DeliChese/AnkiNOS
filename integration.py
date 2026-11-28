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
from aqt.qt import QAction, QApplication, QComboBox, QDesktopServices, QDialog, QDialogButtonBox, QEvent, QFileDialog, QFormLayout, QColor, QImage, QImageReader, QLocale, QPainter, QSize, QInputDialog, QLabel, QLineEdit, QMenu, QObject, QTimer, QUrl, QCursor, Qt, qconnect
from aqt.utils import askUser, getOnlyText, showWarning

from .data import collect_snapshot, collect_overview_snapshot, collect_history_year, overview_base, quick_snapshot, pending_snapshot, clear_snapshot_cache
from .i18n import format_restore_preview, translate as _translate_text
from .theme_settings import (DEFAULT_FONT, DEFAULT_GLASS_BLUR, DEFAULT_GLASS_OPACITY, DEFAULT_LANGUAGE, DEFAULT_LAYOUT,
                             DEFAULT_REVIEWER_CARD_OPACITY, DEFAULT_SIDEBAR_SIDE, LANGUAGE_AUTO, THEME_DEFAULTS,
                             clean_theme_settings, resolve_system_language)
from .media_store import (MAX_IMAGES, MAX_IMAGE_BYTES, SLOTS, THUMBNAIL_SUFFIX, WALLPAPER_SUFFIX, WALLPAPER_MAX_SIDE,
                          WALLPAPER_DIM_MAX, WALLPAPER_BLUR_MAX, IMAGE_FITS,
                          IMAGE_POSITIONS, add_image, delete_image, public_images,
                          valid_images, valid_albums, valid_image_frames, MAX_ALBUMS, profile_dir)
from .pomodoro_store import clean_pomodoro_settings, public_pomodoro_settings

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
_rendering_congrats = False
_config_cache: dict[str, Any] | None = None
_navigating = False
_library_focus: str | None = None
_dashboard_tree: Any = None
_dashboard_tree_rev = -1
_snapshot_requested = False
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
_prefetched_snapshot: tuple[tuple[int, str, int], dict[str, Any]] | None = None
ALLOWED_FILES = {".pdf", ".epub", ".txt", ".md", ".csv", ".xlsx", ".docx", ".pptx", ".mp3", ".wav", ".mp4", ".webm", ".png", ".jpg", ".jpeg", ".webp"}


def _clear_support_cache() -> None:
    import sys
    mod = sys.modules.get(f"{__package__}.study_data") if __package__ else None
    if mod is not None:
        mod.clear_cache()


def enabled() -> bool:
    return _integration_ready and not _session_error and bool(config().get("enabled", True))


def _anki_locale() -> str:
    """Return Anki's active interface locale (fallback: profile meta, then OS locale)."""
    try:
        from anki import lang as anki_lang
        current = getattr(anki_lang, "current_lang", "")
        if isinstance(current, str) and current.strip():
            return current.strip()
    except Exception:
        pass
    try:
        meta_lang = getattr(mw.pm, "meta", {}).get("defaultLang", "")
        if isinstance(meta_lang, str) and meta_lang.strip():
            return meta_lang.strip()
    except Exception:
        pass
    try:
        sys_locale = QLocale.system().name()
        if isinstance(sys_locale, str) and sys_locale.strip():
            return sys_locale.strip()
    except Exception:
        pass
    return ""


def _lang() -> str:
    try:
        if getattr(mw, "pm", None) and mw.pm.name:
            return str(settings().get("language", DEFAULT_LANGUAGE))
    except Exception:
        pass
    return resolve_system_language(_anki_locale())


def _t(text: str) -> str:
    return _translate_text(text, _lang())


def _copy_diagnostics(client: Any = None) -> None:
    import platform
    import sys
    from importlib.metadata import PackageNotFoundError, version
    try:
        anki_version = version("anki")
    except PackageNotFoundError:
        anki_version = "unknown"
    try:
        manifest_ver = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8")).get("version", "unknown")
    except Exception:
        manifest_ver = "unknown"
    s = settings()
    info = client if isinstance(client, dict) else {}
    vw = info.get("width") if isinstance(info.get("width"), int) else 0
    vh = info.get("height") if isinstance(info.get("height"), int) else 0
    dpr = info.get("dpr") if isinstance(info.get("dpr"), (int, float)) else 1
    try:
        addon_count = len(mw.addonManager.allAddons())
    except Exception:
        addon_count = 0
    lines = [
        f"AnkiNOS: {manifest_ver}",
        f"Anki: {anki_version}",
        f"OS: {platform.system()} {platform.release()} ({platform.machine()}) · Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        f"Locale: anki={s.get('anki_locale') or 'unknown'} · pref={s.get('language_pref')} · active={s.get('language')}",
        f"Display: {vw}x{vh} @{dpr}x · scale={s.get('ui_scale', 100)}%",
        f"UI: layout={s.get('layout')} · theme={s.get('theme')}/{s.get('color_theme')} · font={s.get('font_family')} · blur={s.get('blur')} · anim={s.get('animations')} · lite={bool(s.get('lite_mode', False))}",
        f"Add-ons installed: {addon_count}",
        f"Session error: {_session_error or 'none'}",
    ]
    report = "\n".join(lines)
    clipboard = QApplication.clipboard()
    if clipboard is not None:
        clipboard.setText(report)
    send("diagnostics_copied", {"ok": True})


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
        showWarning(_t("AnkiNOS đã chuyển về giao diện Anki gốc để bạn tiếp tục học.\n"
                       "Hãy kiểm tra cấu hình add-on và khởi động lại Anki.\n\n") + _t(_session_error), parent=mw)
    QTimer.singleShot(0, recover)


def _compatibility() -> None:
    from importlib.metadata import PackageNotFoundError, version
    try:
        anki_version = version("anki")
    except PackageNotFoundError:
        anki_version = _t("không xác định")
    checks = [("Danh sách bộ thẻ", callable(getattr(DeckBrowser, "_renderDeckTree", None))),
        ("Chuyển bộ thẻ", callable(getattr(DeckBrowser, "set_current_deck", None))),
        ("Bắt đầu học", callable(getattr(Overview, "_linkHandler", None))),
        ("Thống kê gốc", bool(mw.col and callable(getattr(mw.col._backend, "graphs", None))))]
    text = "Anki " + anki_version + "\n\n" + "\n".join(
        _t(("Có: " if okay else "Chưa hỗ trợ: ") + name) for name, okay in checks)
    if _session_error:
        text += "\n\n" + _t("Lần lỗi gần nhất: " + _session_error)
    from aqt.utils import showInfo
    showInfo(text + "\n\n" + _t("Đây là kiểm tra khả năng API, không phải chứng nhận mọi add-on đều tương thích."), parent=mw)


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


def _maybe_cleanup_daily_filtered_deck() -> None:
    """Clean empty managed Daily Schedule filtered decks after leaving Reviewer."""
    if not mw.col or mw.state != "deckBrowser" or _navigating or not enabled():
        return
    try:
        from .daily_bridge import (
            FILTERED_DECK_NAME,
            LEGACY_EMPTY_PARENT_NAME,
            LEGACY_FILTERED_DECK_NAMES,
            cleanup_empty_filtered_decks_in_col,
        )
        from .daily_store import DailyStore

        if not DailyStore(ROOT, mw.pm.name).get_config().get("auto_clean_filtered", True):
            return
        needs_cleanup = False
        for name in (FILTERED_DECK_NAME, *LEGACY_FILTERED_DECK_NAMES):
            did = mw.col.decks.id_for_name(name)
            if did:
                deck = mw.col.decks.get(did)
                if deck and deck.get("dyn"):
                    count = int(mw.col.db.scalar("SELECT count(*) FROM cards WHERE did = ?", did) or 0)
                    if count == 0:
                        needs_cleanup = True
                        break
        if not needs_cleanup:
            pdid = mw.col.decks.id_for_name(LEGACY_EMPTY_PARENT_NAME)
            if pdid:
                pdeck = mw.col.decks.get(pdid)
                if pdeck and not pdeck.get("dyn"):
                    prefix = LEGACY_EMPTY_PARENT_NAME + "::"
                    has_children = any(entry.name.startswith(prefix) for entry in mw.col.decks.all_names_and_ids())
                    count = int(mw.col.db.scalar("SELECT count(*) FROM cards WHERE did = ? OR odid = ?", pdid, pdid) or 0)
                    if not has_children and count == 0:
                        needs_cleanup = True
        if not needs_cleanup:
            return

        from anki.collection import OpChanges
        from aqt.operations import CollectionOp

        profile, generation = mw.pm.name, _generation

        def op_clean(col: Any) -> Any:
            changes = OpChanges()
            removed = cleanup_empty_filtered_decks_in_col(col, changes=changes)
            return type("_CleanupResult", (), {"changes": changes, "removed": removed})()

        def done_clean(result: Any) -> None:
            global _data_revision, _review_changes_only, _dashboard_tree, _prefetched_snapshot
            if not getattr(result, "removed", False):
                return
            _dashboard_tree = None
            _prefetched_snapshot = None
            _data_revision += 1
            _review_changes_only = False
            clear_snapshot_cache()
            _clear_support_cache()
            if mw.col and mw.pm.name == profile and generation == _generation and mw.state == "deckBrowser" and not _navigating:
                refresh()

        CollectionOp(parent=mw, op=op_clean).success(done_clean).run_in_background(initiator=mw.deckBrowser)
    except Exception:
        pass


def _state_changing(new: str, _old: str) -> None:
    global _overview_rendered, _overview_pending, _navigating, _live_context, _quick_plan
    global _dashboard_tree, _dashboard_tree_rev, _prefetched_snapshot, _data_revision
    _live_context = None
    _navigating = False
    _overview_rendered = False
    _overview_pending = False
    if new not in {"overview", "review"}:
        _quick_plan = None
    if _old == "review" and new in {"deckBrowser", "overview"}:
        # Returning from studying cards must always fetch live queue counts and revlog totals.
        _dashboard_tree = None
        _dashboard_tree_rev = -1
        _prefetched_snapshot = None
        _data_revision += 1
    if new == "review" and mw.col and enabled():
        save_settings({"last_study_deck": str(mw.col.decks.selected())})
    if _old == "review" and new == "deckBrowser" and mw.col and enabled():
        QTimer.singleShot(0, _maybe_cleanup_daily_filtered_deck)
    # Restore before Anki applies the destination screen's own toolbar policy.
    if new not in {"deckBrowser", "overview"}:
        _restore_chrome()


def _overview_refreshed(overview: Any) -> None:
    global _overview_rendered, _overview_pending, _rendering_congrats
    # Anki's completion page ("Congratulations! You have finished this deck")
    # uses Svelte and bypasses webview_will_set_content. Take over cleanly with
    # AnkiNOS's celebratory overview screen instead of falling back to native UI.
    if enabled() and mw.col and mw.state == "overview" and not _overview_pending and not _rendering_congrats:
        _rendering_congrats = True
        try:
            overview.web.stdHtml("", context=overview, default_css=False)
            _overview_rendered = True
            _overview_pending = False
            _sync_chrome()
            QTimer.singleShot(0, refresh)
            return
        except Exception:
            _overview_rendered = False
            _overview_pending = False
            _sync_chrome()
            return
        finally:
            _rendering_congrats = False
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
            current_public = public_settings()
            send("settings", current_public)
            from .study_tools_ui import sync_settings
            sync_settings(current_public)
            from .pomodoro_ui import sync_settings as sync_pomo_settings
            sync_pomo_settings(current_public)


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
            if view is _live_context and _navigating and mw.col and enabled():
                # An operation finishing mid-navigation (such as rebuilding the
                # Daily Schedule filtered deck right before entering review)
                # must not reload DeckBrowser HTML and abort the transition.
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
            if view is _live_context and _navigating and mw.col and enabled():
                view._refresh_needed = False
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


def _addon_version() -> str:
    try:
        data = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        ver = data.get("version")
        if isinstance(ver, str) and ver.strip():
            return ver.strip()[:32]
    except Exception:
        pass
    return "1.0.1-beta.2"


def settings() -> dict[str, Any]:
    profile = config().get("profiles", {}).get(mw.pm.name, {})
    cleaned = clean_theme_settings(profile)
    anki_locale = _anki_locale()
    lang_pref = cleaned.get("language", LANGUAGE_AUTO)
    effective_lang = resolve_system_language(anki_locale) if lang_pref == LANGUAGE_AUTO else lang_pref
    return {"goal": 200, "custom_greeting": "", "update_notice_muted": False,
            "custom_ui_presets": [], "custom_ui_active": "", **THEME_DEFAULTS,
            "activity_collapsed": False, "launchpad_collapsed": False, "library_collapsed": False, "sidebar_collapsed": False,
            "welcome_dismissed": False,
            "favorites": [], "colors": {}, "resources": [], "view": "list",
            "blur": True, "animations": True, "ui_scale": 100,
            "stat_retention": True, "stat_pace": True, "stat_time": True, "stat_studied": True,
            "heatmap_day": "monday", "heatmap_palette": "default",
            "images": [], "image_albums": [], "image_dashboard": None, "image_overview": None,
            "image_review": None, "image_avatar": None, "image_cover": None, "image_frames": {},
            "image_fit_dashboard": "cover", "image_fit_overview": "cover",
            "image_fit_review": "cover", "image_fit_avatar": "cover",
            "wallpaper_dim": 28, "wallpaper_blur": 0,
            "image_position_dashboard": "center", "image_position_overview": "center",
            "image_position_review": "center", "image_position_avatar": "center",
            **profile,
            "image_frames": valid_image_frames(profile.get("image_frames")),
            "theme_overrides": cleaned.get("theme_overrides", {}),
            **{key: cleaned.get(key, THEME_DEFAULTS[key])
               for key in ("surface_style", "motion_preset", "motion_duration")},
            "text_color": cleaned.get("text_color", "auto"),
            "custom_text_color": cleaned.get("custom_text_color", THEME_DEFAULTS["custom_text_color"]),
            "rating_colors": cleaned.get("rating_colors", "auto"),
            "rating_color_again": cleaned.get("rating_color_again", THEME_DEFAULTS["rating_color_again"]),
            "rating_color_hard": cleaned.get("rating_color_hard", THEME_DEFAULTS["rating_color_hard"]),
            "rating_color_good": cleaned.get("rating_color_good", THEME_DEFAULTS["rating_color_good"]),
            "rating_color_easy": cleaned.get("rating_color_easy", THEME_DEFAULTS["rating_color_easy"]),
            "reviewer_card_opacity": cleaned.get("reviewer_card_opacity", DEFAULT_REVIEWER_CARD_OPACITY),
            "font_family": cleaned.get("font_family", DEFAULT_FONT),
            "layout": cleaned.get("layout", DEFAULT_LAYOUT),
            "sidebar_side": cleaned.get("sidebar_side", DEFAULT_SIDEBAR_SIDE),
            "glass_blur": cleaned.get("glass_blur", DEFAULT_GLASS_BLUR),
            "glass_opacity": cleaned.get("glass_opacity", DEFAULT_GLASS_OPACITY),
            "language_pref": lang_pref,
            "anki_locale": anki_locale,
            "language": effective_lang,
            "addon_version": _addon_version(),
            "update_notice_muted": bool(profile.get("update_notice_muted", False)),
            "custom_ui_presets": cleaned.get("custom_ui_presets", []),
            "custom_ui_active": cleaned.get("custom_ui_active", "")
            if cleaned.get("custom_ui_active", "") in {p["id"] for p in cleaned.get("custom_ui_presets", [])} else "",
            "whats_new_seen_version": profile.get("whats_new_seen_version", "")
            if isinstance(profile.get("whats_new_seen_version"), str) else "",
            "custom_greeting": re.sub(r"[\x00-\x1f\x7f]+", " ", profile.get("custom_greeting", "")).strip()[:120]
            if isinstance(profile.get("custom_greeting"), str) else "",
            "pomodoro": clean_pomodoro_settings(profile.get("pomodoro"))}


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
    data["pomodoro"] = public_pomodoro_settings(data.get("pomodoro"), ROOT, mw.pm.name, str(package))
    return data


def _image_add(album_id: str = "") -> None:
    paths, _ = QFileDialog.getOpenFileNames(
        mw, _t("Thêm ảnh vào thư viện AnkiNOS"), "",
        _t("Ảnh (*.png *.jpg *.jpeg *.webp)"))
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
            errors.append(f"{Path(path).name}: {_t(str(error))}")
    if added:
        save_settings({"images": images})
        send("settings", public_settings())
        _prepare_image_previews()  # wallpaper-sized copies are built off the UI thread
    send("image_library", {"message": _t(f"Đã thêm {added} ảnh." if added else "Không có ảnh nào được thêm."),
                           "errors": [_t(err) for err in errors[:5]]})


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
    if not askUser(_t(f"Xóa ảnh '{item['name']}' khỏi thư viện AnkiNOS?")):
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


def _deliver_snapshot(snapshot: dict[str, Any], profile_name: str, overview: bool) -> None:
    global _landing_page
    payload = {**snapshot, 'profile': profile_name, 'settings': public_settings(),
               'fullscreen': mw.isFullScreen(), 'selected_deck': str(mw.col.decks.selected()),
               'support_revision': _data_revision, 'partial': False}
    if not overview and _library_focus:
        payload["library_focus"] = _library_focus
    if not overview and _landing_page:
        payload["open_page"], _landing_page = _landing_page, None
    send("overview_snapshot" if overview else "snapshot", payload)


def refresh(*, prefetch: bool = False) -> None:
    global _active_query, _dashboard_tree, _dashboard_tree_rev, _prefetched_snapshot
    if _navigating or not mw.col or mw.state not in {"deckBrowser", "overview"} or not enabled():
        return
    overview = mw.state == "overview"
    if overview and not _overview_rendered:
        return
    cache_key = (_generation, mw.pm.name, _data_revision)
    if not prefetch and not overview and _prefetched_snapshot and _prefetched_snapshot[0] == cache_key:
        cached_payload = _prefetched_snapshot[1]
        _prefetched_snapshot = None
        _deliver_snapshot(cached_payload, mw.pm.name, False)
        return
    token = (_generation, mw.pm.name)
    if _active_query == token:
        return
    _active_query = token
    profile_name = mw.pm.name
    revision, review_only = _data_revision, _review_changes_only
    tree = _dashboard_tree if (not overview and _dashboard_tree is not None and _dashboard_tree_rev == revision) else None
    if not overview:
        _dashboard_tree = None
        _dashboard_tree_rev = -1

    def success(snapshot: dict[str, Any] | None) -> None:
        global _active_query, _review_changes_only, _prefetched_snapshot
        if _active_query == token:
            _active_query = None
        if token != (_generation, mw.pm.name) or not mw.col or _navigating:
            return
        if revision != _data_revision:
            refresh(prefetch=prefetch)
            return
        if snapshot is None:
            return
        if not overview:
            _review_changes_only = True
        if not overview and not _snapshot_requested:
            # JS explicitly takes the prefetch after mounting, so one result
            # serves both the early collection job and the WebView request.
            _prefetched_snapshot = (cache_key, snapshot)
            return
        _prefetched_snapshot = None
        _deliver_snapshot(snapshot, profile_name, overview)

    def failure(error: Exception) -> None:
        global _active_query
        if _active_query == token:
            _active_query = None
        if token != (_generation, mw.pm.name) or not mw.col or _navigating:
            return
        if revision != _data_revision:
            refresh(prefetch=prefetch)
        elif overview or _snapshot_requested:
            send("error", "Không thể đọc dữ liệu Anki: " + str(error))

    def read(col: Any) -> dict[str, Any] | None:
        # Anki serializes collection jobs. Don't let an abandoned dashboard job
        # queue expensive scans in front of selecting/answering a card.
        if token != (_generation, mw.pm.name) or _navigating or revision != _data_revision:
            return None
        return collect_overview_snapshot(col) if overview else collect_snapshot(
            col, due_tree=tree, revision=revision, review_only=review_only)

    QueryOp(parent=mw, op=read,
            success=success).failure(failure).run_in_background()


def _study_support(force: bool = False) -> None:
    global _support_query
    if not mw.col or mw.state != "deckBrowser" or _navigating:
        return
    from .study_data import collect_support, clear_cache as clear_support_cache
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


def _quick_study(did: int, minutes: Any = None, pomodoro: Any = None) -> None:
    if _navigating:
        return
    if minutes is not None and (type(minutes) is not int or not (1 <= minutes <= 180)):
        raise ValueError("Chọn thời lượng học từ 1 đến 180 phút.")
    pomo_opts: dict[str, Any] | None = None
    if pomodoro is True:
        pomo_opts = {}
    elif isinstance(pomodoro, dict):
        pomo_opts = {}
        if pomodoro.get("mode") in {"classic", "long", "custom", "stopwatch"}:
            pomo_opts["mode"] = pomodoro["mode"]
        if type(pomodoro.get("study_minutes")) is int and 1 <= pomodoro["study_minutes"] <= 180:
            pomo_opts["study_minutes"] = pomodoro["study_minutes"]
        if type(pomodoro.get("break_minutes")) is int and 1 <= pomodoro["break_minutes"] <= 60:
            pomo_opts["break_minutes"] = pomodoro["break_minutes"]
    elif minutes is not None:
        if minutes == 25:
            pomo_opts = {"mode": "classic"}
        elif minutes == 50:
            pomo_opts = {"mode": "long"}
        else:
            pomo_opts = {"mode": "custom", "study_minutes": minutes}
    from aqt.operations.deck import set_current_deck
    profile = mw.pm.name
    _begin_navigation()
    generation = _generation
    def success(_result: Any) -> None:
        global _navigating, _quick_plan
        if not mw.col or mw.pm.name != profile or generation != _generation or mw.state != "deckBrowser" or not enabled():
            _navigating = False
            if mw.col and mw.pm.name == profile and mw.state == "deckBrowser" and enabled():
                refresh()
            return
        _quick_plan = (profile, str(did), pomo_opts)
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
    if plan and plan[:2] == (mw.pm.name, str(mw.col.decks.selected())) and plan[2] is not None:
        from .pomodoro_ui import prepare_pomodoro
        opts = plan[2]
        prepare_pomodoro(
            mode=opts.get("mode"),
            study_minutes=opts.get("study_minutes"),
            break_minutes=opts.get("break_minutes"),
        )
    _begin_navigation()
    mw.overview._linkHandler("study")


def _insight_browse(did: int, kind: str) -> None:
    from .study_data import insight_cards
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
            message = _t("Không thể xử lý gói sao lưu: " + str(error))
            send("backup_status", {"busy": False, "message": message})
            showWarning(message, parent=mw)
    mw.taskman.with_progress(task, finished, label=_t("Đang xử lý sao lưu AnkiNOS…"), immediate=True, uses_collection=False)


def _backup_export() -> None:
    if _backup_busy:
        return
    from .backup_store import export_archive
    path, _ = QFileDialog.getSaveFileName(mw, _t("Sao lưu đầy đủ AnkiNOS"), "AnkiNOS-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".nosbackup", _t("Gói AnkiNOS (*.nosbackup)"))
    if not path:
        return
    from .pomodoro_ui import checkpoint_pomodoro
    checkpoint_pomodoro()
    profile, values = mw.pm.name, settings()
    names = {str(d.id): d.name for d in mw.col.decks.all_names_and_ids()}
    def done(destination: Path) -> None:
        msg = _t("Đã sao lưu đầy đủ tại " + str(destination))
        send("backup_status", {"busy": False, "message": msg})
        if not enabled():
            from aqt.utils import showInfo
            showInfo(msg, parent=mw)
    _backup_job(lambda: export_archive(ROOT, profile, values, Path(path).with_suffix(".nosbackup"),
                                      deck_names=names), done)


def _backup_restore() -> None:
    if _backup_busy:
        return
    from .backup_store import inspect_archive, restore_archive
    path, _ = QFileDialog.getOpenFileName(mw, _t("Chọn gói AnkiNOS để xem trước"), "", _t("Gói AnkiNOS (*.nosbackup)"))
    if not path:
        return
    profile = mw.pm.name
    def preview(manifest: dict) -> None:
        if not mw.col or mw.pm.name != profile:
            return
        values = manifest["settings"]
        text = format_restore_preview(
            source_profile=html.escape(str(manifest.get("profile", ""))),
            created_at=html.escape(str(manifest.get("created_at", ""))),
            images_count=len(values["images"]),
            albums_count=len(values["image_albums"]),
            focus_sessions=manifest.get("pomodoro", {}).get("sessions", 0) or manifest["focus_sessions"],
            resources_count=len(values["resources"]),
            notes_count=manifest.get("workspace", {}).get("notes", 0),
            target_profile=html.escape(profile),
            lang=_lang(),
        )
        send("backup_status", {"busy": False, "message": _t("Đã kiểm tra toàn vẹn gói. Đang chờ xác nhận khôi phục.")})
        if not askUser(text, parent=mw, defaultno=True):
            send("backup_status", {"busy": False, "message": _t("Đã hủy khôi phục. Dữ liệu hiện tại được giữ nguyên.")})
            return
        if mw.state == "review":
            mw.moveToState("deckBrowser")
        from .pomodoro_ui import reset_pomodoro_store
        reset_pomodoro_store()
        from .study_tools_ui import reset_tools
        reset_tools()
        original = settings()
        names = {str(d.id): d.name for d in mw.col.decks.all_names_and_ids()}
        def persist(values: dict, key: str = "profiles") -> None:
            # Disk I/O stays off the UI thread; only Anki's config API runs here.
            from threading import Event
            completed, errors = Event(), []
            def write() -> None:
                try:
                    conf = config()
                    conf.setdefault(key, {})[profile] = values
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
            _clear_support_cache()
            send("settings", public_settings())
            refresh()
            send("backup_status", {"busy": False, "message": _t("Đã khôi phục đầy đủ. Bản trước khôi phục: " + str(backup))})
            if not enabled():
                from aqt.utils import showInfo
                showInfo(_t("Đã khôi phục dữ liệu AnkiNOS. Bản trước khôi phục: " + str(backup)), parent=mw)
        _backup_job(lambda: restore_archive(
            ROOT, profile, Path(path), manifest["archive_sha256"], original, persist,
            deck_names=names), restored)
    def validate_image(path: Path) -> None:
        reader = QImageReader(str(path))
        size = reader.size()
        if not reader.canRead() or size.width() <= 0 or size.height() <= 0 or size.width() * size.height() > 24_000_000:
            raise ValueError("Ảnh trong gói không hợp lệ hoặc vượt 24 megapixel: " + path.name)
    _backup_job(lambda: inspect_archive(ROOT, Path(path), validate_image=validate_image), preview)


def _stats_pdf() -> None:
    """Export the currently visible AnkiNOS statistics page like Anki's native NewDeckStats."""
    if mw.state != "deckBrowser" or not mw.col:
        return
    try:
        from aqt.utils import getSaveFile, tooltip, tr

        stats_word = tr.statistics_stats()
        title = tr.statistics_save_pdf()
        saved_msg = tr.statistics_saved()
    except Exception:
        getSaveFile = None
        tooltip = None
        stats_word = "stats"
        title = _t("Lưu PDF")
        saved_msg = _t("Đã lưu.")
    stamp = datetime.now().strftime("-%Y-%m-%d@%H-%M-%S.pdf")
    suggested = f"anki-{stats_word}{stamp}"
    if callable(getSaveFile):
        path = getSaveFile(
            mw,
            title=title,
            dir_description="stats",
            key="stats",
            ext=".pdf",
            fname=suggested,
        )
    else:
        path, _ = QFileDialog.getSaveFileName(
            mw, title, str(Path.home() / suggested), "PDF (*.pdf)"
        )
    if not path:
        return
    destination = str(Path(path).with_suffix(".pdf"))

    def after_scroll(_arg: Any = None) -> None:
        if not mw.col or mw.state != "deckBrowser":
            return
        page = mw.web.page()
        if page is not None:
            page.printToPdf(destination)
            if callable(tooltip):
                tooltip(saved_msg)

    mw.web.evalWithCallback(
        "window.scrollTo(0, 0); document.getElementById('nos-app')?.scrollTo(0, 0);",
        after_scroll,
    )


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


def open_daily_schedule() -> None:
    global _landing_page
    if not enabled():
        return
    _landing_page = "daily"
    if mw.state != "deckBrowser":
        mw.moveToState("deckBrowser")
    else:
        refresh()


def _stats_graphs(
    scope: str,
    days: int,
    search: str | None = None,
    deck_id: int | None = None,
) -> None:
    """Fetch the native Anki graphs lazily, only while the Stats page is open."""
    global _stats_request_serial
    if not mw.col or mw.state != "deckBrowser" or _navigating:
        return
    from .graphs_data import MAX_SEARCH_LENGTH, collect_native_graphs
    if scope not in {"deck", "collection"} or type(days) is not int or days not in {0, 365}:
        send("graphs_error", "Bộ lọc thống kê không hợp lệ.")
        return
    clean_search: str | None = None
    if search is not None:
        if not isinstance(search, str) or len(search) > MAX_SEARCH_LENGTH:
            send("graphs_error", "Bộ lọc tìm kiếm thẻ không hợp lệ.")
            return
        clean_search = search.strip()
    clean_deck_id: int | None = None
    if deck_id is not None and deck_id != "":
        try:
            clean_deck_id = _deck_id(deck_id)
        except Exception as error:
            send("graphs_error", str(error))
            return
    _stats_request_serial += 1
    token = (_generation, mw.pm.name, _stats_request_serial)
    revision = _data_revision

    def read(col: Any) -> dict[str, Any] | None:
        if token != (_generation, mw.pm.name, _stats_request_serial) or _navigating:
            return None
        return collect_native_graphs(
            col,
            scope,
            days,
            search=clean_search,
            deck_id=clean_deck_id,
        )

    def success(payload: dict[str, Any] | None) -> None:
        if not payload or token != (_generation, mw.pm.name, _stats_request_serial):
            return
        if revision != _data_revision:
            _stats_graphs(scope, days, search=clean_search, deck_id=clean_deck_id)
            return
        send("graphs", {**payload, "revision": revision})

    def failure(error: Exception) -> None:
        if token == (_generation, mw.pm.name, _stats_request_serial):
            send("graphs_error", "Không thể tải thống kê Anki: " + str(error))

    QueryOp(parent=mw, op=read, success=success).failure(failure).run_in_background()


def _stats_select_deck(
    did: int,
    scope: str = "deck",
    days: int = 365,
    search: str | None = None,
) -> None:
    """Switch Anki's selected deck from Stats (like NewDeckStats.on_deck_changed) and reload graphs."""
    if not mw.col or mw.state != "deckBrowser" or _navigating:
        return
    from aqt.operations.deck import set_current_deck

    token = (_generation, mw.pm.name)

    def after_select(_result: Any) -> None:
        if token != (_generation, mw.pm.name) or not mw.col or mw.state != "deckBrowser":
            return
        _stats_graphs(scope if scope in {"deck", "collection"} else "deck",
                      days if days in {0, 365} else 365,
                      search=search,
                      deck_id=did)

    def failed(error: Exception) -> None:
        if token == (_generation, mw.pm.name):
            send("graphs_error", "Không thể đổi bộ thẻ thống kê: " + str(error))

    set_current_deck(parent=mw, deck_id=did).success(after_select).failure(failed).run_in_background(initiator=mw.deckBrowser)


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
    global _generation, _overview_rendered, _overview_pending, _dashboard_tree, _dashboard_tree_rev, _live_context, _prefetched_snapshot, _landing_page, _snapshot_requested
    if not isinstance(context, (DeckBrowser, Overview)) or not enabled():
        return
    _live_context = context
    _prefetched_snapshot = None
    _snapshot_requested = False
    overview = isinstance(context, Overview)
    if overview:
        _overview_rendered = _overview_pending = True
    else:
        _dashboard_tree = getattr(getattr(context, '_render_data', None), 'tree', None)
        _dashboard_tree_rev = _data_revision if _dashboard_tree is not None else -1
    _generation += 1
    if _refresh_timer:
        _refresh_timer.stop()
    content.body = _body_template("ankios-overview.html" if overview else "ankios-ui.html")
    content.body = content.body.replace('id="nos-app"', 'id="nos-app" data-native="true"', 1)
    from .pomodoro_ui import current_payload as pomodoro_payload
    if overview:
        initial = overview_base(mw.col)
        initial["auto_start"] = bool(_quick_plan and _quick_plan[:2] == (mw.pm.name, str(initial["id"])))
        initial.update(profile=mw.pm.name, settings=public_settings(), fullscreen=mw.isFullScreen(), pomodoro=pomodoro_payload())
        content.body += '<textarea id="nos-overview-bootstrap" hidden>' + html.escape(json.dumps(initial, ensure_ascii=True)) + '</textarea>'
    else:
        current_settings = public_settings()
        layout = current_settings["layout"]
        sidebar_side = current_settings.get("sidebar_side", DEFAULT_SIDEBAR_SIDE)
        content.body = content.body.replace(f'data-layout="{DEFAULT_LAYOUT}"', f'data-layout="{layout}"', 1)
        content.body = content.body.replace(f'data-sidebar-side="{DEFAULT_SIDEBAR_SIDE}"', f'data-sidebar-side="{sidebar_side}"', 1)
        boot_classes = []
        if current_settings.get("lite_mode"):
            boot_classes.append("lite-mode")
        if current_settings.get("blur") is False:
            boot_classes.append("no-blur")
        if current_settings.get("animations") is False:
            boot_classes.append("reduce-motion")
        animations_attr = "off" if current_settings.get("animations") is False else "on"
        content.body = content.body.replace(
            'id="nos-app"',
            f'id="nos-app" data-animations="{animations_attr}"' + (f' class="{" ".join(boot_classes)}"' if boot_classes else ''),
            1,
        )
        try:
            initial = quick_snapshot(mw.col, due_tree=_dashboard_tree, revision=_data_revision)
        except Exception:
            initial = pending_snapshot()
        initial.update(
            profile=mw.pm.name,
            settings=current_settings,
            fullscreen=mw.isFullScreen(),
            selected_deck=str(mw.col.decks.selected()),
            support_revision=_data_revision,
            pomodoro=pomodoro_payload(),
        )
        if _library_focus:
            initial["library_focus"] = _library_focus
        if _landing_page:
            initial["open_page"], _landing_page = _landing_page, None
        content.body += '<textarea id="nos-dashboard-bootstrap" hidden>' + html.escape(json.dumps(initial, ensure_ascii=True)) + '</textarea>'
        _snapshot_requested = not initial.get("partial")
        if not _snapshot_requested:
            # Start computing the full revlog snapshot immediately in parallel
            # with HTML/CSS/JS parsing so first load finishes without waiting.
            generation = _generation
            QTimer.singleShot(0, lambda: refresh(prefetch=True)
                              if generation == _generation and not _snapshot_requested else None)
        else:
            # A later refresh can see a different learning queue at the same
            # revision. Reuse Anki's render tree only on the initial load.
            _dashboard_tree = None
            _dashboard_tree_rev = -1
    package = mw.addonManager.addonFromModule(MODULE)
    base = f"/_addons/{package}/assets"
    content.css = [p for p in content.css if p != "css/deckbrowser.css"]
    content.js = [p for p in content.js if p != "js/deckbrowser.js"]
    content.css.append(f"{base}/dashboard.css")
    # Language support loads first so every page script can translate/format.
    content.js.append(f"{base}/i18n.js")
    content.js.append(f"{base}/i18n-en.js")
    content.js.append(f"{base}/i18n-zh-cn.js")
    if overview:
        content.css = [p for p in content.css if p != "css/overview.css"]
        content.css.append(f"{base}/overview.css")
    content.js.append(f"{base}/theme.js")
    content.js.append(f"{base}/runtime-guard.js")
    if not overview:
        content.js.append(f"{base}/layouts.js")
    content.css.append(f"{base}/pomodoro.css")
    content.js.append(f"{base}/overview.js" if overview else f"{base}/dashboard.js")
    content.js.append(f"{base}/pomodoro.js")
    if not overview:
        content.css.append(f"{base}/stats-page.css")
        content.css.append(f"{base}/pomodoro-stats.css")
        content.js.append(f"{base}/stats-page.js")
        content.js.append(f"{base}/pomodoro-stats.js")
        content.css.append(f"{base}/media-studio.css")
        content.js.append(f"{base}/media-studio.js")
        content.css.append(f"{base}/study-dashboard.css")
        content.js.append(f"{base}/study-dashboard.js")
        content.css.append(f"{base}/daily-schedule.css")
        content.js.append(f"{base}/daily-schedule.js")
    content.css.append(f"{base}/theme.css")
    if not overview:
        content.css.append(f"{base}/layouts.css")
        content.css.append(f"{base}/custom-ui.css")
        content.js.append(f"{base}/custom-ui.js")



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
        url = getOnlyText(_t("Đường dẫn tài nguyên (https://…)"), parent=mw, title=_t("Thêm liên kết")).strip()
        if not url:
            return
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            showWarning(_t("Hãy nhập một liên kết http hoặc https hợp lệ."), parent=mw)
            return
        name = getOnlyText(_t("Tên tài nguyên"), default=parsed.netloc, parent=mw).strip()
        if not name:
            return
        resources.append({"id": uuid.uuid4().hex, "name": name[:240], "path": url, "kind": "link", "detail": parsed.netloc})
    else:
        paths, _ = QFileDialog.getOpenFileNames(mw, _t("Gắn tài nguyên học tập"), "", _t("Tài nguyên (*.pdf *.epub *.txt *.md *.csv *.xlsx *.docx *.pptx *.mp3 *.wav *.mp4 *.webm *.png *.jpg *.jpeg *.webp)"))
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
            showWarning(_t("Không tìm thấy file tài nguyên. File có thể đã được di chuyển hoặc đổi tên."), parent=mw)
            return
        url = QUrl.fromLocalFile(str(path))
    QDesktopServices.openUrl(url)


def _menu_action(menu: QMenu, text: str, action: Any) -> None:
    item = menu.addAction(text)
    qconnect(item.triggered, lambda _checked=False: action())


def _create_deck(parent_id: int | None = None) -> None:
    dialog = QDialog(mw)
    dialog.setWindowTitle(_t("Tạo bộ thẻ"))
    dialog.setMinimumWidth(420)
    layout = QFormLayout(dialog)
    name = QLineEdit(dialog)
    name.setObjectName("nos-deck-name")
    name.setPlaceholderText(_t("Tên bộ thẻ mới"))
    parent = QComboBox(dialog)
    parent.setObjectName("nos-deck-parent")
    parent.addItem(_t("Không có — tạo bộ thẻ cấp cao nhất"), 0)
    for deck in mw.col.decks.all_names_and_ids(include_filtered=False):
        parent.addItem(deck.name, deck.id)
    if parent_id is not None:
        selected = parent.findData(parent_id)
        if selected < 0:
            raise ValueError("Không thể tạo deck con trong bộ thẻ lọc.")
        parent.setCurrentIndex(selected)
    layout.addRow(_t("Tên bộ thẻ:"), name)
    layout.addRow(_t("Bộ thẻ cha:"), parent)
    buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
    buttons.button(QDialogButtonBox.StandardButton.Ok).setText(_t("Tạo"))
    buttons.button(QDialogButtonBox.StandardButton.Cancel).setText(_t("Đóng"))
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
            showWarning(_t("Nhập tên bộ thẻ; tên từng cấp không được để trống."), parent=dialog)
            return
        full_name = "::".join(parts)
        if selected_id := parent.currentData():
            deck = mw.col.decks.get(_deck_id(selected_id), default=False)
            full_name = deck["name"] + "::" + full_name
        if mw.col.decks.by_name(full_name):
            showWarning(_t("Bộ thẻ này đã tồn tại. Hãy chọn tên khác."), parent=dialog)
            return
        busy(True)
        status.setText(_t("Đang tạo bộ thẻ…"))

        def created(_result: Any) -> None:
            if not dialog.isVisible():
                return
            selected_id = parent.currentData()
            parent.clear()
            parent.addItem(_t("Không có — tạo bộ thẻ cấp cao nhất"), 0)
            for deck in mw.col.decks.all_names_and_ids(include_filtered=False):
                parent.addItem(deck.name, deck.id)
            parent.setCurrentIndex(max(0, parent.findData(selected_id)))
            busy(False)
            name.clear()
            status.setText(_t("Đã tạo: " + full_name))
            name.setFocus()

        def failed(error: Exception) -> None:
            if dialog.isVisible():
                busy(False)
                status.setText(_t("Không thể tạo bộ thẻ: " + str(error)))
                name.setFocus()

        add_deck(parent=mw, name=full_name).success(created).failure(failed).run_in_background()

    qconnect(buttons.accepted, create)
    qconnect(buttons.rejected, dialog.reject)
    name.setFocus()
    dialog.exec()


def _deck_menu(did: int) -> None:
    menu = QMenu(mw)
    from .study_tools_ui import open_notebook
    _menu_action(menu, _t("Sổ tay…"), lambda: open_notebook(did))
    menu.addSeparator()
    starred = str(did) in settings()["favorites"]
    _menu_action(menu, _t("Bỏ gắn sao" if starred else "Gắn sao bộ thẻ"), lambda: _favorite(str(did)))
    _menu_action(menu, _t("Duyệt thẻ"), lambda: _browse(did))
    if not mw.col.decks.get(did)["dyn"]:
        _menu_action(menu, _t("Tạo deck con…"), lambda: _create_deck(did))
    _menu_action(menu, _t("Đổi tên bộ thẻ…"), lambda: mw.deckBrowser._rename(did))
    _menu_action(menu, _t("Tùy chọn bộ thẻ…"), lambda: mw.deckBrowser._options(did))
    _menu_action(menu, _t("Xuất bộ thẻ…"), lambda: mw.onExport(did=did))
    menu.addSeparator()
    _menu_action(menu, _t("Xóa bộ thẻ…"), lambda: _delete_deck(did))
    colors = menu.addMenu(_t("Màu thư mục"))
    for name, color in [("Xanh dương", "blue"), ("Tím", "purple"), ("Hồng", "pink"), ("Xanh lá", "green"), ("Vàng", "amber")]:
        def set_color(color: str = color) -> None:
            mapping = dict(settings()["colors"])
            mapping[str(did)] = color
            save_settings({"colors": mapping})
            send("settings", public_settings())
        _menu_action(colors, _t(name), set_color)
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
            message = _t(f"Xóa bộ thẻ lọc <b>{name}</b>?<br>Thẻ sẽ được trả về bộ thẻ gốc.")
        else:
            message = _t(f"Xóa bộ thẻ <b>{name}</b>, {info['children']} bộ con và {info['count']} thẻ?<br>Bạn có thể dùng Hoàn tác của Anki sau khi xóa.")
        if not askUser(message, parent=mw, defaultno=True, title=_t("Xóa bộ thẻ")):
            return
        def removed(_result: Any) -> None:
            # Keep the library open; only leave an overview whose deck vanished.
            if mw.state == "overview":
                QTimer.singleShot(0, lambda: mw.moveToState("deckBrowser"))
        remove_decks(parent=mw, deck_ids=[did], deck_name=info["name"]).success(removed).run_in_background()

    QueryOp(parent=mw, op=prepare, success=confirm).failure(lambda error: showWarning(_t(str(error)), parent=mw)).run_in_background()


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
        "activity_collapsed", "launchpad_collapsed", "library_collapsed", "sidebar_collapsed",
        "welcome_dismissed", "update_notice_muted", "blur", "animations", "lite_mode",
        "stat_retention", "stat_pace", "stat_time", "stat_studied",
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
    if isinstance(values.get("custom_greeting"), str):
        patch["custom_greeting"] = re.sub(r"[\x00-\x1f\x7f]+", " ", values["custom_greeting"]).strip()[:120]
    if isinstance(values.get("whats_new_seen_version"), str) and re.fullmatch(r"[A-Za-z0-9._-]{1,32}", values["whats_new_seen_version"]):
        patch["whats_new_seen_version"] = values["whats_new_seen_version"]
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
    if isinstance(values.get("image_frames"), dict):
        incoming_frames = valid_image_frames(values["image_frames"])
        if incoming_frames:
            merged_frames = dict(valid_image_frames(settings().get("image_frames")))
            merged_frames.update(incoming_frames)
            patch["image_frames"] = merged_frames
    if isinstance(values.get("pomodoro"), dict):
        merged_pomo = dict(clean_pomodoro_settings(settings().get("pomodoro")))
        merged_pomo.update(values["pomodoro"])
        patch["pomodoro"] = clean_pomodoro_settings(merged_pomo)
    if patch:
        save_settings(patch)


def bridge(handled: tuple[bool, Any], message: str, context: Any) -> tuple[bool, Any]:
    global _library_focus, _data_revision, _review_changes_only, _quick_plan, _navigating
    if handled[0] or not isinstance(context, (DeckBrowser, Overview)) or not message.startswith("nos:"):
        return handled
    if message == "nos:enable":
        _toggle(True)
        return (True, None)
    if not mw.col or mw.state not in {"deckBrowser", "overview"} or not enabled():
        return (True, None)
    if (isinstance(context, Overview) and mw.state != "overview") or (isinstance(context, DeckBrowser) and mw.state != "deckBrowser"):
        return (True, None)
    try:
        if len(message) > 256_000:
            return (True, None)
        command = json.loads(message[4:])
        if not isinstance(command, dict):
            return (True, None)
        action = command.get("action")
        # A full Custom UI preset library can exceed the limit for ordinary commands.
        if len(message) > 32_000 and action not in ("save_ui", "apply_settings"):
            return (True, None)
        if action == "daily":
            if context is _live_context and isinstance(context, DeckBrowser):
                if _navigating:
                    send("daily", {
                        "request_id": command.get("request_id"),
                        "method": command.get("method"),
                        "data": None,
                        "error": "Đang mở phiên học, vui lòng chờ giây lát.",
                    })
                else:
                    from .daily_bridge import handle as handle_daily

                    profile, generation = mw.pm.name, _generation

                    def current() -> bool:
                        return (
                            context is _live_context
                            and generation == _generation
                            and mw.col is not None
                            and mw.pm.name == profile
                            and not _navigating
                        )

                    def mutated() -> None:
                        global _data_revision, _review_changes_only, _dashboard_tree, _prefetched_snapshot
                        _dashboard_tree = None
                        _prefetched_snapshot = None
                        _data_revision += 1
                        _review_changes_only = False
                        clear_snapshot_cache()
                        _clear_support_cache()

                    def launch_review(did: int, minutes: int | None, pomo: Any = None) -> None:
                        if current():
                            _quick_study(did, minutes, pomo)

                    handle_daily(
                        command,
                        root=ROOT,
                        profile=profile,
                        current=current,
                        reply=send,
                        on_mutated=mutated,
                        on_start_review=launch_review,
                        lang=_lang(),
                    )
        elif action == "show_children":
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
            global _snapshot_requested
            _snapshot_requested = True
            if command.get('force') is True:
                global _prefetched_snapshot
                _prefetched_snapshot = None
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
            did = _deck_id(command["id"]) if command.get("id") else None
            open_notebook(did)
        elif action == "quick_study":
            _quick_study(_deck_id(command.get("id")), command.get("minutes"), command.get("pomodoro"))
        elif action == "insight_browse":
            _insight_browse(_deck_id(command.get("id")), command.get("kind"))
        elif action == "backup_export":
            _backup_export()
        elif action == "backup_restore":
            _backup_restore()
        elif action == "compatibility":
            _compatibility()
        elif action == "copy_diagnostics":
            _copy_diagnostics(command.get("client"))
        elif action == "native_mode":
            _toggle(False)
        elif action == "runtime_failure":
            _fallback(RuntimeError(str(command.get("message", "Không thể nạp giao diện."))[:1000]))
        elif action == 'history_year':
            _history_year(int(command.get('year')))
        elif action == "graphs":
            # Native Rust graph data: all standard Anki statistics sections.
            _stats_graphs(
                command.get("scope"),
                command.get("days"),
                search=command.get("search"),
                deck_id=command.get("deck_id"),
            )
        elif action == "stats_select_deck":
            _stats_select_deck(
                _deck_id(command.get("deck_id")),
                scope=command.get("scope") or "deck",
                days=command.get("days") if command.get("days") in {0, 365} else 365,
                search=command.get("search"),
            )
        elif action == "stats_browser_search":
            query = str(command.get("query") or "")[:1000]
            browser = dialogs.open("Browser", mw)
            browser.search_for(query)
            browser.show()
            browser.raise_()
            browser.activateWindow()
        elif action == "pomodoro":
            from .pomodoro_ui import handle_action as handle_pomodoro
            handle_pomodoro(command)
        elif action in {"pomodoro_analytics", "focus_history"}:
            from .pomodoro_ui import analytics_payload
            send("pomodoro_analytics", analytics_payload(command))
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
            mw.addonManager.onAddonsDialog()
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
            goal, ok = QInputDialog.getInt(mw, _t("Mục tiêu học mỗi ngày"), _t("Số lượt ôn tập mỗi ngày:"), int(settings()["goal"]), 1, 100_000)
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
            _menu_action(menu, _t("Mở tài nguyên"), lambda: _open_resource(rid))
            def remove_reference() -> None:
                save_settings({"resources": [r for r in settings()["resources"] if r["id"] != rid]})
                send("settings", public_settings())
            _menu_action(menu, _t("Gỡ khỏi dashboard (giữ nguyên file)"), remove_reference)
            menu.exec(QCursor.pos())
        elif action == "save_ui":
            _save_ui(command.get("values"))
            # A snapshot sent while the save was in flight may still have older settings.
            send("settings", public_settings())
        elif action == "apply_settings":
            _save_ui(command.get("values"))
            current_public = public_settings()
            send("settings", current_public)
            from .study_tools_ui import sync_settings
            sync_settings(current_public)
            from .pomodoro_ui import sync_settings as sync_pomo_settings
            sync_pomo_settings(current_public)
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
        _navigating = False
        send("error", str(error))
    return (True, None)


def _operation_finished(changes: Any, initiator: Any) -> None:
    global _data_revision, _review_changes_only, _dashboard_tree, _dashboard_tree_rev, _prefetched_snapshot
    if not any(getattr(changes, key, False) for key in ('card','note','deck','config','deck_config','notetype','study_queues','mtime')):
        return
    navigation_only = isinstance(initiator, DeckBrowser) and not any(
        getattr(changes, key, False) for key in ('card','note','deck','notetype','deck_config','study_queues'))
    if not navigation_only:
        _dashboard_tree = None
        _dashboard_tree_rev = -1
        _prefetched_snapshot = None
        _data_revision += 1
        # Answers and mark/flag operations initiated by Reviewer leave the
        # archive/card totals intact. Edits, imports, sync and Undo invalidate it.
        _review_changes_only = _review_changes_only and initiator is mw.reviewer
    if _refresh_timer and not _navigating and mw.col and mw.state in {"deckBrowser", "overview"} and _dashboard_active():
        _refresh_timer.start(120)


def _profile_closing() -> None:
    global _generation, _active_query, _library_focus, _dashboard_tree, _dashboard_tree_rev, _data_revision, _review_changes_only, _stats_request_serial, _live_context, _landing_page, _prefetched_snapshot
    _live_context = None
    _generation += 1
    _stats_request_serial += 1
    _active_query = None
    _library_focus = None
    _landing_page = None
    _dashboard_tree = None
    _dashboard_tree_rev = -1
    _prefetched_snapshot = None
    _data_revision += 1
    _review_changes_only = False
    _history_queries.clear()
    clear_snapshot_cache()
    _clear_support_cache()
    if _refresh_timer:
        _refresh_timer.stop()
    _restore_chrome()


def _sync_finished(*_args: Any) -> None:
    global _data_revision, _review_changes_only, _dashboard_tree, _prefetched_snapshot
    _dashboard_tree = None
    _prefetched_snapshot = None
    _data_revision += 1
    _review_changes_only = False
    clear_snapshot_cache()
    _clear_support_cache()
    if _refresh_timer and _dashboard_active():
        _refresh_timer.start(120)


def _native_return_banner_html() -> str:
    """Compact one-click banner shown in native Anki UI so users can always return to AnkiNOS."""
    label = html.escape(_t("Quay lại giao diện AnkiNOS"))
    hint = html.escape(_t("Đang dùng giao diện Anki gốc · nhấn để bật lại AnkiNOS"))
    return (
        '<style id="nos-return-style">'
        '#nos-return-banner{margin:18px auto 6px;max-width:520px;padding:10px 14px;border-radius:14px;'
        'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;'
        'background:rgba(71,125,235,.09);border:1px solid rgba(71,125,235,.32);'
        'font:12.5px/1.45 "Segoe UI",system-ui,sans-serif;text-align:left;}'
        '.nightMode #nos-return-banner{background:rgba(131,184,255,.12);border-color:rgba(131,184,255,.35);}'
        '#nos-return-banner .nos-ret-copy{display:flex;flex-direction:column;gap:2px;min-width:160px;flex:1;}'
        '#nos-return-banner .nos-ret-copy strong{font-size:12.5px;font-weight:700;}'
        '#nos-return-banner .nos-ret-copy span{font-size:11.5px;opacity:.78;}'
        '#nos-return-btn{cursor:pointer;padding:7px 14px;border-radius:999px;border:1px solid #477deb;'
        'background:#477deb;color:#fff;font:600 12px/1.2 "Segoe UI",system-ui,sans-serif;'
        'white-space:nowrap;transition:filter 160ms ease,transform 160ms ease;}'
        '#nos-return-btn:hover{filter:brightness(1.08);transform:translateY(-1px);}'
        '</style>'
        '<div id="nos-return-banner">'
        f'<div class="nos-ret-copy"><strong>✦ AnkiNOS</strong><span>{hint}</span></div>'
        f'<button type="button" id="nos-return-btn" onclick="pycmd(\'nos:enable\')">✦ {label}</button>'
        '</div>'
    )


def _inject_native_deckbrowser_return(_browser: Any, content: Any) -> None:
    if _integration_ready and not enabled():
        content.stats += _native_return_banner_html()


def _inject_native_overview_return(_overview: Any, content: Any) -> None:
    if _integration_ready and not enabled():
        content.table += _native_return_banner_html()


def _inject_native_toolbar_return(links: list[str], toolbar: Any) -> None:
    if _integration_ready and not enabled():
        links.append(
            toolbar.create_link(
                "nos_enable",
                "✦ AnkiNOS",
                lambda: _toggle(True),
                tip=_t("Quay lại giao diện AnkiNOS"),
                id="nos-enable",
            )
        )


def _toggle(active: bool) -> None:
    global _session_error
    if active and not _integration_ready:
        showWarning(_t("AnkiNOS chưa khởi tạo đầy đủ. Hãy kiểm tra phiên bản Anki và khởi động lại trước khi bật lại."), parent=mw)
        return
    _session_error = ""
    conf = config()
    conf["enabled"] = active
    mw.addonManager.writeConfig(MODULE, conf)
    if not active:
        _restore_chrome()
    if getattr(mw, "toolbar", None):
        mw.toolbar.redraw()
    if mw.col:
        mw.moveToState("deckBrowser")


def install() -> None:
    global _installed, _refresh_timer, _chrome_guard, _integration_ready
    if _installed:
        return
    _installed = True
    mw.addonManager.setWebExports(
        MODULE,
        r"(?:assets/.*\.(?:css|js|png|webp)|user_files/[0-9a-f]{20}/(?:[0-9a-f]{32}(?:-thumb|-wall)?\.(?:png|jpg|webp)|pomodoro_audio/[0-9a-f]{32}\.(?:mp3|wav|ogg)))",
    )
    mw.addonManager.setConfigUpdatedAction(MODULE, _config_updated)
    _guard_unused_heatmaps()
    _guard_unused_deck_html()
    _guard_live_updates()
    gui_hooks.profile_did_open.append(_guard_unused_heatmaps)
    gui_hooks.webview_will_set_content.append(replace_content)
    gui_hooks.webview_did_receive_js_message.append(bridge)
    gui_hooks.deck_browser_will_render_content.append(_inject_native_deckbrowser_return)
    gui_hooks.overview_will_render_content.append(_inject_native_overview_return)
    gui_hooks.top_toolbar_did_init_links.append(_inject_native_toolbar_return)
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
    from .pomodoro_ui import install as install_pomodoro
    install_pomodoro(
        lambda: bool(enabled()),
        settings,
        save_settings,
        lambda: send("settings", public_settings()),
    )
    from .reviewer_ui import install as install_reviewer
    install_reviewer(lambda: bool(enabled()), public_settings)
    from .study_tools_ui import install as install_tools
    install_tools()
    _integration_ready = True
