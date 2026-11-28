"""WebView tools for commands and contextual/general ANOS notebook."""
from __future__ import annotations

import html
import json
import os
from pathlib import Path
import re
import sys
from typing import Any
from uuid import uuid4

from aqt import dialogs, gui_hooks, mw
from aqt.operations import QueryOp
from aqt.qt import QAction, QColor, QDialog, QKeySequence, QPainterPath, QRectF, QRegion, QSizeGrip, Qt, QVBoxLayout, qconnect
from aqt.webview import AnkiWebView

from .i18n import translate as _tr_text
from .media_store import profile_dir

ROOT = Path(__file__).resolve().parent
_dialogs: dict[str, "ToolDialog"] = {}
_workspace: dict[str, Any] = {}
_installed = False
_commands_action: QAction | None = None
GENERAL_DECK_NAME = "Ghi chú chung"
_TOOL_TITLES = {"palette": "Lệnh nhanh AnkiNOS", "workspace": "Sổ tay AnkiNOS"}


def _lang() -> str:
    try:
        from .integration import settings
        return str(settings().get("language", "vi"))
    except Exception:
        return "vi"


def _t(text: str, lang: str | None = None) -> str:
    return _tr_text(text, _lang() if lang is None else lang)


def collection_key() -> str:
    from .study_tools_data import COLLECTION_KEY
    value = mw.col.get_config(COLLECTION_KEY)
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{32}", value):
        value = uuid4().hex
        mw.col.set_config(COLLECTION_KEY, value)
    return value


def workspace_store() -> Any:
    profile = mw.pm.name
    if profile not in _workspace:
        from .workspace_store import WorkspaceStore
        _workspace[profile] = WorkspaceStore(profile_dir(ROOT, profile) / "workspace.sqlite3")
    return _workspace[profile]


class ToolDialog(QDialog):
    def __init__(self, kind: str, did: int | None = None, note: str | None = None, selected_note: str | None = None):
        super().__init__(mw)
        self.kind, self.profile, self.collection = kind, mw.pm.name, mw.col
        resolved_did: int | None = None
        if did is not None:
            candidate = int(did)
            if mw.col.decks.get(candidate, default=False):
                resolved_did = candidate
            elif kind != "workspace":
                raise ValueError("Bộ thẻ không còn tồn tại.")
        elif kind != "workspace":
            resolved_did = int(mw.col.decks.selected())
        self.did = resolved_did
        self.note_id, self.selected_note = note, selected_note
        self.deck_name = mw.col.decks.name(self.did) if self.did is not None else GENERAL_DECK_NAME
        self.key = collection_key() if kind != "palette" else None
        self.serial, self.closed, self.minimized = 0, False, False
        self._normal_geo = None
        self.setWindowTitle(_t(_TOOL_TITLES[kind]))
        is_wayland = (
            sys.platform.startswith("linux")
            and (os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland"
                 or os.environ.get("QT_QPA_PLATFORM", "").lower().startswith("wayland"))
        )
        self._use_frameless = kind == "workspace" and not is_wayland
        self._use_mask = self._use_frameless and sys.platform != "darwin"
        if self._use_frameless:
            # Frameless ANOS window with rounded translucent corners and corner-minimize pocket mode.
            self.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.FramelessWindowHint)
            self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
            self.setStyleSheet("QDialog { background: transparent; border: none; }")
            self.resize(1060, 720)
            self.setMinimumSize(210, 56)
        elif kind == "workspace":
            # Wayland fallback: keep native window frame so move/resize always work reliably.
            self.resize(1060, 720)
            self.setMinimumSize(420, 420)
        else:
            self.resize(760, 580)
            self.setMinimumSize(360, 400)
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
        if self._use_frameless:
            self._grip = QSizeGrip(self)
            self._grip.setFixedSize(16, 16)
            self._apply_rounded_mask()
        else:
            self._grip = None
        body = re.search(r"<body[^>]*>(.*?)</body>", (ROOT / "ankios-tools.html").read_text(encoding="utf-8"), re.S).group(1)
        body = re.sub(r"<script\b[^>]*>.*?</script>", "", body, flags=re.S)
        from .integration import settings
        appearance = {
            key: value for key, value in settings().items()
            if key in {"theme", "color_theme", "theme_overrides", "accent", "custom_accent", "text_color", "custom_text_color", "font_family", "blur", "glass_blur", "glass_opacity", "animations", "lite_mode", "language"}
        }
        initial = {
            "settings": appearance,
            "kind": kind,
            "native": True,
            "frameless": self._use_frameless,
            "deck": self.deck_name if self.did is not None else "",
            "deck_id": str(self.did) if self.did is not None else "",
            "note_id": self.note_id,
            "default_scope": "current" if (kind == "workspace" and self.did is not None) else "all",
        }
        body += '<textarea id="nos-tool-bootstrap" hidden>' + html.escape(json.dumps(initial, ensure_ascii=True)) + '</textarea>'
        package = mw.addonManager.addonFromModule(__package__)
        base = f"/_addons/{package}/assets"
        self.web.stdHtml(
            body,
            css=[base + "/tools.css", base + "/theme.css"],
            js=[base + "/i18n.js", base + "/i18n-en.js", base + "/i18n-zh-cn.js", base + "/theme.js", base + "/tools.js", base + "/commands.js", base + "/notebook.js"],
            context=self,
            default_css=False,
        )

    def _apply_rounded_mask(self):
        if not self._use_mask:
            return
        w, h = self.width(), self.height()
        if w <= 0 or h <= 0:
            return
        radius = 18.0 if self.minimized else 22.0
        path = QPainterPath()
        path.addRoundedRect(QRectF(0, 0, float(w), float(h)), radius, radius)
        self.setMask(QRegion(path.toFillPolygon().toPolygon()))

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if self._grip is not None:
            self._grip.setVisible(not self.minimized)
            self._grip.move(self.width() - self._grip.width() - 6, self.height() - self._grip.height() - 6)
        self._apply_rounded_mask()

    def live(self):
        return not self.closed and mw.col is self.collection and mw.pm.name == self.profile

    def send(self, event: str, payload):
        if self.live():
            value = json.dumps({"event": event, "payload": payload}, ensure_ascii=True)
            self.web.eval("window.NOSTool && window.NOSTool.receive(" + value + ");")

    def query(self, read, done):
        self.serial += 1
        serial = self.serial
        def success(payload):
            if self.live() and serial == self.serial and payload is not None:
                done(payload)
        QueryOp(
            parent=self,
            op=lambda col: read(col) if self.live() and serial == self.serial else None,
            success=success,
        ).failure(lambda error: self.send("error", str(error))).run_in_background()

    def set_minimized(self, minimized: bool):
        if self.kind != "workspace" or self.minimized == minimized:
            return
        if minimized:
            self._normal_geo = self.geometry()
            self.minimized = True
            self.setMinimumSize(200, 52)
            self.resize(236, 56)
            host = mw.frameGeometry()
            x = max(host.left() + 16, host.right() - self.width() - 24)
            y = max(host.top() + 16, host.bottom() - self.height() - 28)
            self.move(x, y)
            if self._grip is not None:
                self._grip.hide()
        else:
            self.minimized = False
            self.setMinimumSize(420, 420)
            if self._normal_geo is not None:
                self.setGeometry(self._normal_geo)
            else:
                self.resize(1020, 700)
            if self._grip is not None:
                self._grip.show()
                self._grip.move(self.width() - self._grip.width() - 6, self.height() - self._grip.height() - 6)
        self._apply_rounded_mask()
        self.send("window_state", {"minimized": self.minimized})

    def bridge(self, message: str):
        if not self.live() or not message.startswith("nostool:"):
            return
        try:
            if len(message) > 500000:
                raise ValueError("Dữ liệu gửi quá lớn.")
            command = json.loads(message[8:])
            if not isinstance(command, dict):
                raise ValueError("Lệnh không hợp lệ.")
            action = command.get("action")
            if action == "close":
                self.close()
                return
            if action == "minimize":
                self.set_minimized(True)
                return
            if action == "restore":
                self.set_minimized(False)
                return
            if action == "drag_start":
                handle = self.windowHandle()
                if handle is not None and hasattr(handle, "startSystemMove"):
                    handle.startSystemMove()
                return
            if action == "backup":
                from .integration import _backup_export
                _backup_export()
                return
            if self.kind == "palette":
                self.palette(action, command)
            elif self.kind == "workspace":
                self.notebook(action, command)
        except Exception as error:
            self.send("error", str(error))

    def palette(self, action, command):
        from . import integration as host
        from .study_tools_data import COLLECTION_KEY, palette_results
        if action in {"boot", "search"}:
            query = str(command.get("query", ""))[:200]
            seq = command.get("seq", 0)
            resources = list(host.settings()["resources"])
            folder = profile_dir(ROOT, self.profile) / "workspace.sqlite3"
            store = workspace_store() if folder.is_file() else None
            self.query(lambda col: palette_results(col, query, resources, store), lambda items: self.send("results", {"seq": seq, "items": items}))
        elif action == "execute":
            kind, identifier = command.get("kind"), command.get("id")
            if not isinstance(identifier, str):
                raise ValueError("Kết quả tìm kiếm không hợp lệ.")
            # Resolve all IDs against trusted host state, never execute a JS action string.
            if kind == "deck":
                did = host._deck_id(identifier)
                self.accept()
                mw.deckBrowser.set_current_deck(did)
            elif kind == "resource":
                self.accept()
                host._open_resource(identifier)
            elif kind == "note":
                key = mw.col.get_config(COLLECTION_KEY)
                entry = workspace_store().get(key, identifier)
                if not entry:
                    raise ValueError("Ghi chú đã thay đổi. Hãy tìm lại.")
                self.accept()
                did = int(entry["deck_id"]) if str(entry["deck_id"] or "").isdigit() else None
                open_notebook(did, selected_note=identifier)
            elif kind == "action":
                def start(minutes=None):
                    if mw.state != "deckBrowser":
                        mw.moveToState("deckBrowser")
                    host._quick_study(self.did or mw.col.decks.selected(), minutes)
                def _open_pomo():
                    from .pomodoro_ui import open_floating_widget
                    open_floating_widget()
                actions = {
                    "study": lambda: start(),
                    "daily": host.open_daily_schedule,
                    "pomodoro": _open_pomo,
                    "focus": _open_pomo,
                    "notebook": lambda: open_notebook(None),
                    "add": mw.onAddCard,
                    "browse": lambda: host._browse(),
                    "stats": host.open_statistics,
                    "sync": mw.on_sync_button_clicked,
                    "backup": host._backup_export,
                    "toggle_nos": lambda: host._toggle(not host.enabled()),
                }
                if identifier not in actions:
                    raise ValueError("Lệnh không được hỗ trợ.")
                self.accept()
                actions[identifier]()

    def _resolve_deck(self, raw_deck_id: Any) -> tuple[str, str]:
        if raw_deck_id is None or str(raw_deck_id).strip() == "":
            return ("", GENERAL_DECK_NAME)
        text = str(raw_deck_id).strip()
        if text.isdigit():
            deck = mw.col.decks.get(int(text), default=False)
            if deck:
                return (text, deck["name"])
        return ("", GENERAL_DECK_NAME)

    def notebook(self, action, command):
        store = workspace_store()
        if action in {"boot", "load"}:
            archive = command.get("archived") is True
            trash = command.get("trash") is True
            raw_scope = command.get("scope")
            if raw_scope in {"all", "general", "current"}:
                scope = raw_scope
            elif action == "boot":
                scope = "current" if self.did is not None else "all"
            else:
                scope = "all"
            query = str(command.get("query", ""))[:300]
            color = str(command.get("color", ""))[:20]
            pinned_only = command.get("pinned_only") is True
            sort = "title" if command.get("sort") == "title" else "recent"
            def read(col):
                deck_filter: str | None
                if scope == "general":
                    deck_filter = ""
                elif scope == "current" and self.did is not None:
                    deck_filter = str(self.did)
                else:
                    deck_filter = None
                notes = store.list(self.key, deck_filter, trash=trash, query=query, archived=archive, color=color, pinned_only=pinned_only, sort=sort)
                if self.selected_note and not archive and not trash and not color and not pinned_only:
                    focus = store.get(self.key, self.selected_note)
                    if focus and (deck_filter is None or focus["deck_id"] == deck_filter) and all(n["id"] != focus["id"] for n in notes):
                        notes = [focus, *notes[:99]]
                decks = [{"id": str(d.id), "name": d.name} for d in col.decks.all_names_and_ids()]
                return {
                    "notes": notes,
                    "decks": decks,
                    "scope": scope,
                    "archived": archive,
                    "trash": trash,
                    "color": color,
                    "pinned_only": pinned_only,
                    "sort": sort,
                    "selected_note": self.selected_note,
                }
            self.query(read, lambda data: self.send("notebook", data))
        elif action == "save":
            deck_id, deck_name = self._resolve_deck(command.get("deck_id"))
            identifier = store.save(
                self.key,
                deck_id,
                deck_name,
                command.get("title", ""),
                command.get("body", ""),
                note_id=self.note_id if deck_id and self.did is not None and deck_id == str(self.did) else None,
                identifier=command.get("id") or None,
                allow_deck_change=True,
                pinned=command.get("pinned") if isinstance(command.get("pinned"), bool) else None,
                color=command.get("color") if isinstance(command.get("color"), str) else None,
                tags=command.get("tags") if isinstance(command.get("tags"), str) else None,
            )
            self.selected_note = identifier
            scope = command.get("scope") if command.get("scope") in {"all", "general", "current"} else "all"
            self.notebook("load", {"scope": scope, "color": command.get("filter_color", ""), "pinned_only": command.get("pinned_only") is True, "sort": command.get("sort", "recent")})
            self.send("notice", "Đã lưu ghi chú trên máy.")
        elif action == "pin":
            pinned_state = store.toggle_pin(self.key, str(command.get("id", "")))
            scope = command.get("scope") if command.get("scope") in {"all", "general", "current"} else "all"
            self.notebook("load", {"scope": scope, "color": command.get("filter_color", ""), "pinned_only": command.get("pinned_only") is True, "sort": command.get("sort", "recent")})
            self.send("notice", "Đã ghim ghi chú lên đầu." if pinned_state else "Đã bỏ ghim ghi chú.")
        elif action == "duplicate":
            new_id = store.duplicate(self.key, str(command.get("id", "")))
            self.selected_note = new_id
            scope = command.get("scope") if command.get("scope") in {"all", "general", "current"} else "all"
            self.notebook("load", {"scope": scope, "color": command.get("filter_color", ""), "pinned_only": command.get("pinned_only") is True, "sort": command.get("sort", "recent")})
            self.send("notice", "Đã nhân bản ghi chú.")
        elif action == "trash":
            store.trash(self.key, str(command.get("id", "")), command.get("restore") is True)
            scope = command.get("scope") if command.get("scope") in {"all", "general", "current"} else "all"
            self.notebook("load", {"trash": command.get("restore") is not True, "scope": scope})
        elif action == "open_source":
            entry = store.get(self.key, str(command.get("id", "")))
            if not entry or not str(entry["note_id"] or "").isdigit():
                raise ValueError("Ghi chú này không gắn với note Anki đang tồn tại trong bộ sưu tập này.")
            nid = int(entry["note_id"])
            self.query(
                lambda col: bool(col.db.scalar("SELECT 1 FROM notes WHERE id=?", nid)),
                lambda exists: self._open_source(nid) if exists else self.send("error", "Note nguồn đã bị xóa; ghi chú vẫn được giữ."),
            )

    def _open_source(self, nid):
        browser = dialogs.open("Browser", mw)
        browser.search_for("nid:" + str(nid))
        browser.show()
        browser.raise_()
        browser.activateWindow()

    def done(self, result):
        if not self.closed:
            self.closed = True
            self.serial += 1
            if _dialogs.get(self.kind) is self:
                _dialogs.pop(self.kind, None)
        super().done(result)


def _open(kind, did=None, note=None, selected_note=None):
    if not mw.col:
        return
    target_did = int(did) if did is not None else (int(mw.col.decks.selected()) if kind != "workspace" else None)
    existing = _dialogs.get(kind)
    if existing and existing.live() and (kind == "workspace" or existing.did == target_did):
        if kind == "workspace":
            if existing.minimized:
                existing.set_minimized(False)
            if target_did is not None and mw.col.decks.get(target_did, default=False):
                existing.did = target_did
                existing.deck_name = mw.col.decks.name(target_did)
            existing.note_id = note
            existing.send("note_context", {"note_id": note, "deck_id": str(existing.did) if existing.did is not None else "", "deck": existing.deck_name if existing.did is not None else ""})
            if selected_note:
                entry = workspace_store().get(existing.key, selected_note)
                if entry:
                    existing.send("note_focus", entry)
        existing.show()
        existing.raise_()
        existing.activateWindow()
        return existing
    if existing:
        existing.close()
    dialog = ToolDialog(kind, target_did, note, selected_note)
    _dialogs[kind] = dialog
    dialog.show()
    dialog.raise_()
    dialog.activateWindow()
    return dialog


def open_commands():
    return _open("palette")


def open_notebook(did=None, *, selected_note=None):
    note = None
    if mw.state == "review" and mw.reviewer.card:
        note = str(mw.reviewer.card.nid)
        if did is None:
            did = mw.col.decks.selected()
    return _open("workspace", did, note, selected_note)


def reset_tools():
    for dialog in list(_dialogs.values()):
        dialog.close()
    _dialogs.clear()
    _workspace.clear()


def sync_settings(raw_settings: dict[str, Any]) -> None:
    appearance = {
        key: value for key, value in raw_settings.items()
        if key in {"theme", "color_theme", "theme_overrides", "accent", "custom_accent", "text_color", "custom_text_color", "font_family", "blur", "glass_blur", "glass_opacity", "animations", "lite_mode", "language"}
    }
    lang = str(appearance.get("language", "vi"))
    if _commands_action is not None:
        _commands_action.setText(_t("AnkiNOS — Lệnh nhanh", lang))
    for dialog in list(_dialogs.values()):
        if dialog.live():
            dialog.setWindowTitle(_t(_TOOL_TITLES[dialog.kind], lang))
            dialog.send("settings", appearance)


def install():
    global _installed, _commands_action
    if _installed:
        return
    _installed = True
    _commands_action = QAction(_t("AnkiNOS — Lệnh nhanh"), mw)
    _commands_action.setShortcut(QKeySequence("Ctrl+K"))
    qconnect(_commands_action.triggered, lambda _checked=False: open_commands())
    mw.addAction(_commands_action)
    gui_hooks.profile_did_open.append(lambda: _commands_action and _commands_action.setText(_t("AnkiNOS — Lệnh nhanh")))
    gui_hooks.profile_will_close.append(reset_tools)
