"""Cross-screen Pomodoro controller & optional frameless floating mini-widget."""
from __future__ import annotations

import html
import json
import os
from pathlib import Path
import re
import sys
from typing import Any, Callable

from aqt import gui_hooks, mw
from aqt.qt import QColor, QDialog, QEvent, QFileDialog, QObject, QPainterPath, QRectF, QRegion, QTimer, Qt, QVBoxLayout
from aqt.utils import showWarning
from aqt.webview import AnkiWebView

from .i18n import translate as _tr_text
from .pomodoro_store import (
    PomodoroStore,
    clean_pomodoro_settings,
    delete_custom_sound,
    public_pomodoro_settings,
    save_custom_sound,
)

ROOT = Path(__file__).resolve().parent

_enabled: Callable[[], bool] | None = None
_settings: Callable[[], dict[str, Any]] | None = None
_save_settings: Callable[[dict[str, Any]], None] | None = None
_broadcast_settings: Callable[[], None] | None = None

_store: PomodoroStore | None = None
_store_profile: str | None = None
_tick_timer: QTimer | None = None
_blur_guard: QObject | None = None
_float_dialog: "PomodoroFloatDialog | None" = None
_pending_start: tuple[str, str, dict[str, Any]] | None = None
_tick_counter = 0
_installed = False


def _lang() -> str:
    try:
        return str(_settings().get("language", "vi")) if callable(_settings) else "vi"
    except Exception:
        return "vi"


def _t(text: str) -> str:
    return _tr_text(text, _lang())


def _current_pomo_config() -> dict[str, Any]:
    if not callable(_settings):
        return clean_pomodoro_settings({})
    try:
        s = _settings()
        return clean_pomodoro_settings(s.get("pomodoro"))
    except Exception:
        return clean_pomodoro_settings({})


def _public_pomo_config() -> dict[str, Any]:
    cfg = _current_pomo_config()
    if not mw.pm or not mw.pm.name:
        return cfg
    try:
        package = mw.addonManager.addonFromModule(__package__)
        return public_pomodoro_settings(cfg, ROOT, mw.pm.name, package)
    except Exception:
        return cfg


def pomodoro_store() -> PomodoroStore:
    global _store, _store_profile
    name = mw.pm.name
    if _store is None or _store_profile != name:
        if _store is not None:
            _store.stop("interrupted")
        _store = PomodoroStore(ROOT, name)
        _store_profile = name
    _store.update_config(_current_pomo_config())
    return _store


def current_payload() -> dict[str, Any]:
    store = pomodoro_store()
    return {
        "state": store.status(),
        "config": _public_pomo_config(),
        "float_open": bool(_float_dialog is not None and not _float_dialog.closed and _float_dialog.isVisible()),
    }


def analytics_payload(params: dict[str, Any] | None = None) -> dict[str, Any]:
    opts = params if isinstance(params, dict) else {}
    return pomodoro_store().analytics(
        period=str(opts.get("period") or "week"),
        anchor=opts.get("anchor") if isinstance(opts.get("anchor"), str) else None,
        mode=str(opts.get("mode") or "all"),
        status=str(opts.get("status") or "all"),
        deck_id=str(opts.get("deck_id") or "all"),
    )


def checkpoint_pomodoro() -> None:
    if _store is not None:
        _store.checkpoint()


def reset_pomodoro_store() -> None:
    _profile_close()


def prepare_pomodoro(mode: str | None = None, study_minutes: int | None = None, break_minutes: int | None = None) -> None:
    global _pending_start
    if not mw.col or not mw.pm:
        return
    opts: dict[str, Any] = {}
    if mode is not None:
        opts["mode"] = mode
    if study_minutes is not None:
        opts["study_minutes"] = study_minutes
    if break_minutes is not None:
        opts["break_minutes"] = break_minutes
    _pending_start = (mw.pm.name, str(mw.col.decks.selected()), opts)


def _current_deck_info() -> tuple[str, str]:
    try:
        if mw.col and mw.state in {"review", "overview"}:
            deck = mw.col.decks.current()
            if deck:
                return (str(deck["id"]), str(deck["name"]))
    except Exception:
        pass
    return ("", "")


def broadcast_state() -> None:
    if not callable(_enabled) or not _enabled():
        return
    try:
        data = json.dumps(current_payload(), ensure_ascii=True)
    except Exception:
        return
    if mw.web and mw.state in {"deckBrowser", "overview", "review"}:
        mw.web.eval(f"window.NOSPomodoro && window.NOSPomodoro.receive({data});")
    if _float_dialog is not None and _float_dialog.live():
        _float_dialog.send_state(data)


def sync_settings(public_values: dict[str, Any]) -> None:
    if _store is not None and isinstance(public_values, dict):
        _store.update_config(public_values.get("pomodoro"))
    if _float_dialog is not None and _float_dialog.live():
        _float_dialog.send_settings(public_values)
    broadcast_state()


def _persist_pomo_patch(patch: dict[str, Any]) -> dict[str, Any]:
    merged = dict(_current_pomo_config())
    merged.update(patch)
    cleaned = clean_pomodoro_settings(merged)
    if callable(_save_settings):
        _save_settings({"pomodoro": cleaned})
    if _store is not None:
        _store.update_config(cleaned)
    if callable(_broadcast_settings):
        _broadcast_settings()
    return _public_pomo_config()


def _pick_custom_sound(slot: str) -> None:
    if slot not in {"study", "break"}:
        return
    title = _t("Chọn âm thanh báo hết giờ học") if slot == "study" else _t("Chọn âm thanh báo hết giờ nghỉ")
    path, _ = QFileDialog.getOpenFileName(
        mw,
        title,
        "",
        _t("Tệp âm thanh (*.mp3 *.wav *.ogg)"),
    )
    if not path:
        return
    key = "custom_study_sound" if slot == "study" else "custom_break_sound"
    sound_key = "sound_study_end" if slot == "study" else "sound_break_end"
    cfg = _current_pomo_config()
    try:
        entry = save_custom_sound(ROOT, mw.pm.name, Path(path), previous=cfg.get(key))
        _persist_pomo_patch({key: entry, sound_key: "custom"})
        broadcast_state()
    except (ValueError, OSError) as error:
        showWarning("Pomodoro: " + _t(str(error)), parent=mw)


def _remove_custom_sound(slot: str) -> None:
    if slot not in {"study", "break"}:
        return
    key = "custom_study_sound" if slot == "study" else "custom_break_sound"
    sound_key = "sound_study_end" if slot == "study" else "sound_break_end"
    cfg = _current_pomo_config()
    delete_custom_sound(ROOT, mw.pm.name, cfg.get(key))
    patch: dict[str, Any] = {key: None}
    if cfg.get(sound_key) == "custom":
        patch[sound_key] = "zen" if slot == "study" else "chime"
    _persist_pomo_patch(patch)
    broadcast_state()


def handle_action(payload: dict[str, Any]) -> None:
    op = str(payload.get("op") or "")
    store = pomodoro_store()
    did, dname = _current_deck_info()
    try:
        if op == "status":
            broadcast_state()
            return
        if op == "start":
            mode = payload.get("mode")
            phase = payload.get("phase") or "study"
            sm = payload.get("study_minutes")
            bm = payload.get("break_minutes")
            cfg_patch: dict[str, Any] = {}
            if isinstance(mode, str):
                cfg_patch["mode"] = mode
            if type(sm) is int:
                cfg_patch["study_minutes"] = sm
            if type(bm) is int:
                cfg_patch["break_minutes"] = bm
            if cfg_patch:
                _persist_pomo_patch(cfg_patch)
            store.start(
                mode=mode if isinstance(mode, str) else None,
                phase=str(phase),
                study_minutes=sm if type(sm) is int else None,
                break_minutes=bm if type(bm) is int else None,
                deck_id=did,
                deck_name=dname,
                cfg=_current_pomo_config(),
            )
        elif op == "pause":
            store.pause()
        elif op == "resume":
            store.resume()
        elif op == "stop":
            store.stop("stopped")
        elif op == "switch":
            phase = payload.get("phase")
            store.switch_phase(
                phase if isinstance(phase, str) else None,
                deck_id=did,
                deck_name=dname,
            )
        elif op == "extend":
            mins = payload.get("minutes")
            store.extend(mins if type(mins) is int else 5)
        elif op == "dismiss":
            store.dismiss_awaiting()
        elif op == "complete":
            store.checkpoint()
        elif op == "config":
            values = payload.get("values")
            if isinstance(values, dict):
                _persist_pomo_patch(values)
                if _float_dialog is not None and _float_dialog.live():
                    _float_dialog.apply_ui_size(_current_pomo_config().get("ui_mode", "pill"))
        elif op == "pick_sound":
            _pick_custom_sound(str(payload.get("slot") or "study"))
            return
        elif op == "clear_sound":
            _remove_custom_sound(str(payload.get("slot") or "study"))
            return
        elif op == "open_float":
            open_floating_widget()
            return
        elif op == "close_float":
            close_floating_widget()
            return
        elif op == "toggle_float":
            if _float_dialog is not None and _float_dialog.live() and _float_dialog.isVisible():
                close_floating_widget()
            else:
                open_floating_widget()
            return
        broadcast_state()
    except (ValueError, OSError) as error:
        showWarning("Pomodoro: " + _t(str(error)), parent=mw)


class PomodoroFloatDialog(QDialog):
    """Frameless translucent floating Pomodoro widget that stays alive across all Anki views."""

    _SIZES = {
        "pill": (244, 58),
        "ring": (244, 290),
        "flip": (276, 198),
        "ambient": (340, 34),
    }

    def __init__(self):
        super().__init__(mw)
        self.profile = mw.pm.name
        self.collection = mw.col
        self.closed = False
        self.minimized = False
        self._ui_mode = _current_pomo_config().get("ui_mode", "pill")
        self.setWindowTitle(_t("AnkiNOS · Pomodoro"))
        is_wayland = (
            sys.platform.startswith("linux")
            and (
                os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland"
                or os.environ.get("QT_QPA_PLATFORM", "").lower().startswith("wayland")
            )
        )
        self._use_frameless = not is_wayland
        self._use_mask = self._use_frameless and sys.platform != "darwin"
        if self._use_frameless:
            self.setWindowFlags(
                Qt.WindowType.Tool | Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint
            )
            self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
            self.setStyleSheet("QDialog { background: transparent; border: none; }")
        else:
            self.setWindowFlags(Qt.WindowType.Tool | Qt.WindowType.WindowStaysOnTopHint)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        self.web = AnkiWebView(self)
        if self._use_frameless:
            self.web.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
            self.web.setStyleSheet("background: transparent;")
            page = self.web.page()
            if page is not None:
                page.setBackgroundColor(QColor(0, 0, 0, 0))
        self.web.set_bridge_command(self.bridge, self)
        layout.addWidget(self.web)

        self.apply_ui_size(self._ui_mode)
        host = mw.frameGeometry()
        corner = _current_pomo_config().get("widget_corner", "bottom-right")
        x = host.left() + 24 if corner.endswith("left") else max(host.left() + 16, host.right() - self.width() - 28)
        y = host.top() + 56 if corner.startswith("top") else max(host.top() + 40, host.bottom() - self.height() - 48)
        self.move(x, y)

        body = re.search(
            r"<body[^>]*>(.*?)</body>",
            (ROOT / "ankios-pomodoro.html").read_text(encoding="utf-8"),
            re.S,
        ).group(1)
        body = re.sub(r"<script\b[^>]*>.*?</script>", "", body, flags=re.S)
        s = _settings() if callable(_settings) else {}
        appearance = {
            k: v
            for k, v in s.items()
            if k
            in {
                "theme", "color_theme", "theme_overrides", "accent", "custom_accent",
                "text_color", "custom_text_color", "font_family", "blur", "glass_blur",
                "glass_opacity", "animations", "lite_mode", "language",
            }
        }
        initial = {
            "native": True,
            "frameless": self._use_frameless,
            "settings": appearance,
            "pomodoro": current_payload(),
        }
        body += '<textarea id="nos-pomo-float-bootstrap" hidden>' + html.escape(json.dumps(initial, ensure_ascii=True)) + "</textarea>"
        package = mw.addonManager.addonFromModule(__package__)
        base = f"/_addons/{package}/assets"
        self.web.stdHtml(
            body,
            css=[base + "/pomodoro.css", base + "/theme.css"],
            js=[
                base + "/i18n.js",
                base + "/i18n-en.js",
                base + "/i18n-zh-cn.js",
                base + "/theme.js",
                base + "/pomodoro.js",
            ],
            context=self,
            default_css=False,
        )

    def live(self) -> bool:
        return not self.closed and mw.col is self.collection and mw.pm.name == self.profile

    def _apply_mask(self) -> None:
        if not self._use_mask:
            return
        w, h = self.width(), self.height()
        if w <= 0 or h <= 0:
            return
        radius = 16.0 if (self.minimized or self._ui_mode in {"pill", "ambient"}) else 22.0
        path = QPainterPath()
        path.addRoundedRect(QRectF(0, 0, float(w), float(h)), radius, radius)
        self.setMask(QRegion(path.toFillPolygon().toPolygon()))

    def apply_ui_size(self, ui_mode: str) -> None:
        self._ui_mode = ui_mode if ui_mode in self._SIZES else "pill"
        if self.minimized:
            self.setFixedSize(156, 44)
        else:
            w, h = self._SIZES[self._ui_mode]
            self.setFixedSize(w, h)
        self._apply_mask()

    def set_minimized(self, minimized: bool) -> None:
        if self.minimized == minimized:
            return
        self.minimized = minimized
        self.apply_ui_size(self._ui_mode)
        if minimized:
            host = mw.frameGeometry()
            x = max(host.left() + 16, host.right() - self.width() - 24)
            y = max(host.top() + 16, host.bottom() - self.height() - 28)
            self.move(x, y)
        if self.live():
            val = json.dumps({"minimized": self.minimized})
            self.web.eval(f"window.NOSPomodoroFloat && window.NOSPomodoroFloat.setMinimized({val});")

    def send_state(self, raw_json: str) -> None:
        if self.live():
            self.web.eval(f"window.NOSPomodoro && window.NOSPomodoro.receive({raw_json});")

    def send_settings(self, public_values: dict[str, Any]) -> None:
        if self.live():
            val = json.dumps(public_values, ensure_ascii=True)
            self.web.eval(f"window.NOSPomodoroFloat && window.NOSPomodoroFloat.setSettings({val});")

    def bridge(self, message: str) -> None:
        if not self.live() or not message.startswith("nospomo:"):
            return
        try:
            if len(message) > 32_000:
                return
            cmd = json.loads(message[8:])
            if not isinstance(cmd, dict):
                return
            op = cmd.get("op")
            if op == "close_float":
                self.close()
                return
            if op == "minimize":
                self.set_minimized(True)
                return
            if op == "restore":
                self.set_minimized(False)
                return
            if op == "drag_start":
                handle = self.windowHandle()
                if handle is not None and hasattr(handle, "startSystemMove"):
                    handle.startSystemMove()
                return
            handle_action(cmd)
        except Exception:
            pass

    def closeEvent(self, event: Any) -> None:
        global _float_dialog
        self.closed = True
        if _float_dialog is self:
            _float_dialog = None
        super().closeEvent(event)
        QTimer.singleShot(0, broadcast_state)


def open_floating_widget() -> None:
    global _float_dialog
    if not mw.col or not callable(_enabled) or not _enabled():
        return
    if _float_dialog is not None and _float_dialog.live():
        _float_dialog.set_minimized(False)
        _float_dialog.show()
        _float_dialog.raise_()
        broadcast_state()
        return
    _float_dialog = PomodoroFloatDialog()
    _float_dialog.show()
    _float_dialog.raise_()
    broadcast_state()


def close_floating_widget() -> None:
    global _float_dialog
    if _float_dialog is not None:
        dlg = _float_dialog
        _float_dialog = None
        dlg.close()
    broadcast_state()


class _PomodoroWindowGuard(QObject):
    def eventFilter(self, watched: Any, event: Any) -> bool:
        if (
            event.type() == QEvent.Type.WindowDeactivate
            and _store is not None
            and _store.session_id is not None
            and _store.running_since is not None
            and _store.phase == "study"
            and _current_pomo_config().get("pause_on_blur") is True
        ):
            # Do not auto-pause when the user simply clicked our floating Pomodoro window or Notebook.
            active_win = mw.app.activeWindow() if hasattr(mw, "app") and mw.app else None
            if active_win is not None and active_win.parent() is mw:
                return False
            _store.pause()
            broadcast_state()
        return False


def _tick() -> None:
    global _tick_counter
    if not callable(_enabled) or not _enabled() or _store is None:
        return
    if _store.session_id is None or _store.running_since is None:
        return
    _tick_counter += 1
    before_id = _store.session_id
    before_seq = _store._event_seq
    # Check countdown expiry every second; checkpoint DB every 15 seconds or on completion.
    if _store.target > 0 and _store._seconds() >= _store.target:
        _store.checkpoint()
    elif _tick_counter % 15 == 0:
        _store.checkpoint()
    if before_id != _store.session_id or before_seq != _store._event_seq:
        broadcast_state()


def _on_state_change(new: str, old: str) -> None:
    global _pending_start
    if new == "review" and old != "review":
        did, dname = _current_deck_info()
        planned, _pending_start = _pending_start, None
        if callable(_enabled) and _enabled():
            if planned and planned[:2] == (mw.pm.name, str(mw.col.decks.selected())):
                opts = planned[2]
                pomodoro_store().start(
                    mode=opts.get("mode"),
                    phase="study",
                    study_minutes=opts.get("study_minutes"),
                    break_minutes=opts.get("break_minutes"),
                    deck_id=did,
                    deck_name=dname,
                    cfg=_current_pomo_config(),
                )
            elif _store is not None and _store.session_id is not None:
                _store.set_deck(did, dname)
        QTimer.singleShot(50, broadcast_state)


def _on_answered(_reviewer: Any, _card: Any, _ease: int) -> None:
    if _store is not None:
        did, dname = _current_deck_info()
        _store.answer(did, dname)


def _profile_close() -> None:
    global _store, _store_profile, _pending_start
    close_floating_widget()
    if _store is not None:
        _store.stop("stopped")
    _store = None
    _store_profile = None
    _pending_start = None


def install(
    enabled: Callable[[], bool],
    settings_fn: Callable[[], dict[str, Any]],
    save_fn: Callable[[dict[str, Any]], None],
    broadcast_fn: Callable[[], None],
) -> None:
    global _enabled, _settings, _save_settings, _broadcast_settings, _tick_timer, _blur_guard, _installed
    _enabled = enabled
    _settings = settings_fn
    _save_settings = save_fn
    _broadcast_settings = broadcast_fn
    if _installed:
        return
    _installed = True
    _blur_guard = _PomodoroWindowGuard(mw)
    mw.installEventFilter(_blur_guard)
    _tick_timer = QTimer(mw)
    _tick_timer.setInterval(1000)
    _tick_timer.timeout.connect(_tick)
    _tick_timer.start()
    gui_hooks.profile_will_close.append(_profile_close)
    gui_hooks.state_will_change.append(_on_state_change)
    gui_hooks.reviewer_did_answer_card.append(_on_answered)
