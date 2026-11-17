"""WebView tools for commands and contextual notes."""
from __future__ import annotations

import html
import json
from pathlib import Path
import re
from uuid import uuid4

from aqt import dialogs, gui_hooks, mw
from aqt.operations import QueryOp
from aqt.qt import QAction, QDialog, QKeySequence, QVBoxLayout, qconnect
from aqt.webview import AnkiWebView

from .workspace_store import WorkspaceStore
from .media_store import profile_dir
from .study_tools_data import COLLECTION_KEY, palette_results

ROOT = Path(__file__).resolve().parent
_dialogs: dict[str, "ToolDialog"] = {}
_workspace: dict[str, WorkspaceStore] = {}
_installed = False


def collection_key() -> str:
    value = mw.col.get_config(COLLECTION_KEY)
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{32}", value):
        value = uuid4().hex
        mw.col.set_config(COLLECTION_KEY, value)
    return value


def workspace_store() -> WorkspaceStore:
    profile = mw.pm.name
    if profile not in _workspace:
        _workspace[profile] = WorkspaceStore(profile_dir(ROOT,profile)/"workspace.sqlite3")
    return _workspace[profile]


class ToolDialog(QDialog):
    def __init__(self, kind: str, did: int | None = None, note: str | None = None, selected_note: str | None = None):
        super().__init__(mw)
        self.kind, self.profile, self.collection = kind, mw.pm.name, mw.col
        self.did = int(did or mw.col.decks.selected())
        if not mw.col.decks.get(self.did,default=False):
            raise ValueError("Bộ thẻ không còn tồn tại.")
        self.note_id, self.selected_note = note, selected_note
        self.deck_name = mw.col.decks.name(self.did)
        self.key = collection_key() if kind != "palette" else None
        self.serial, self.closed = 0, False
        self.setWindowTitle({"palette":"Lệnh nhanh AnkiNOS", "workspace":"Sổ tay & tài liệu"}[kind])
        self.resize(760, 580) if kind == "palette" else self.resize(1050, 760)
        self.setMinimumSize(360,400)
        layout = QVBoxLayout(self); layout.setContentsMargins(0,0,0,0)
        self.web = AnkiWebView(self)
        self.web.set_bridge_command(self.bridge,self)
        layout.addWidget(self.web)
        body = re.search(r"<body[^>]*>(.*?)</body>",(ROOT/"ankios-tools.html").read_text(encoding="utf-8"),re.S).group(1)
        body = re.sub(r"<script\b[^>]*>.*?</script>","",body,flags=re.S)
        initial = {"kind":kind,"native":True,"deck":self.deck_name,"deck_id":str(self.did),"note_id":self.note_id}
        body += '<textarea id="nos-tool-bootstrap" hidden>'+html.escape(json.dumps(initial,ensure_ascii=True))+'</textarea>'
        package = mw.addonManager.addonFromModule(__package__)
        base = f"/_addons/{package}/assets"
        self.web.stdHtml(body,css=[base+"/tools.css"],js=[base+"/tools.js",base+"/commands.js",base+"/notebook.js"],context=self,default_css=False)

    def live(self):
        return not self.closed and mw.col is self.collection and mw.pm.name == self.profile

    def send(self, event: str, payload):
        if self.live():
            value = json.dumps({"event":event,"payload":payload},ensure_ascii=True)
            self.web.eval("window.NOSTool && window.NOSTool.receive("+value+");")

    def query(self, read, done):
        self.serial += 1
        serial = self.serial
        def success(payload):
            if self.live() and serial == self.serial and payload is not None:
                done(payload)
        QueryOp(parent=self,op=lambda col: read(col) if self.live() and serial == self.serial else None,
                success=success).failure(lambda error:self.send("error",str(error))).run_in_background()

    def bridge(self, message: str):
        if not self.live() or not message.startswith("nostool:"):
            return
        try:
            if len(message)>500000:
                raise ValueError("Dữ liệu gửi quá lớn.")
            command = json.loads(message[8:])
            if not isinstance(command,dict):
                raise ValueError("Lệnh không hợp lệ.")
            action = command.get("action")
            if action == "close":
                self.close(); return
            if action == "backup":
                from .integration import _backup_export
                _backup_export(); return
            if self.kind == "palette":
                self.palette(action,command)
            elif self.kind == "workspace":
                self.notebook(action,command)
        except Exception as error:
            self.send("error",str(error))

    def palette(self, action, command):
        from . import integration as host
        if action in {"boot","search"}:
            query = str(command.get("query",""))[:200]
            seq = command.get("seq",0)
            resources = list(host.settings()["resources"])
            folder = profile_dir(ROOT,self.profile)/"workspace.sqlite3"
            store = workspace_store() if folder.is_file() else None
            self.query(lambda col:palette_results(col,query,resources,store),lambda items:self.send("results",{"seq":seq,"items":items}))
        elif action == "execute":
            kind, identifier = command.get("kind"), command.get("id")
            if not isinstance(identifier,str):
                raise ValueError("Kết quả tìm kiếm không hợp lệ.")
            # Resolve all IDs against trusted host state, never execute a JS action string.
            if kind == "deck":
                did = host._deck_id(identifier)
                self.accept()
                mw.deckBrowser.set_current_deck(did)
            elif kind == "resource":
                self.accept(); host._open_resource(identifier)
            elif kind == "note":
                key = mw.col.get_config(COLLECTION_KEY)
                entry = workspace_store().get(key,identifier)
                if not entry:
                    raise ValueError("Ghi chú đã thay đổi. Hãy tìm lại.")
                self.accept(); open_notebook(int(entry["deck_id"]),selected_note=identifier)
            elif kind == "action":
                def start(minutes=None):
                    if mw.state!="deckBrowser":
                        mw.moveToState("deckBrowser")
                    host._quick_study(self.did,minutes)
                actions = {
                    "study":lambda:start(),
                    "focus":lambda:start(host.settings().get("study_budget",30)),
                    "notebook":lambda:open_notebook(self.did),
                    "add":mw.onAddCard,"browse":lambda:host._browse(),"stats":host.open_statistics,
                    "sync":mw.on_sync_button_clicked,"backup":host._backup_export}
                if identifier not in actions:
                    raise ValueError("Lệnh không được hỗ trợ.")
                self.accept(); actions[identifier]()

    def notebook(self, action, command):
        from . import integration as host
        store = workspace_store()
        if action in {"boot","load"}:
            resources = list(host.settings()["resources"])
            archive = command.get("archived") is True
            trash = command.get("trash") is True
            query = str(command.get("query",""))[:300]
            def read(col):
                notes = store.list(self.key,str(self.did),trash=trash,query=query,archived=archive)
                if self.selected_note and not archive and not trash:
                    focus = store.get(self.key,self.selected_note)
                    if focus and focus["deck_id"]==str(self.did) and all(n["id"]!=focus["id"] for n in notes):
                        notes = [focus,*notes[:99]]
                ids = store.bindings(self.key,str(self.did))
                return {"notes":notes,"resources":[{**r,"attached":r["id"] in ids} for r in resources],
                    "archived":archive,"trash":trash,"selected_note":self.selected_note}
            self.query(read,lambda data:self.send("notebook",data))
        elif action == "save":
            identifier = store.save(self.key,str(self.did),self.deck_name,command.get("title",""),command.get("body",""),
                note_id=self.note_id,identifier=command.get("id") or None)
            self.selected_note = identifier
            self.notebook("load",{}); self.send("notice","Đã lưu ghi chú trên máy.")
        elif action == "trash":
            store.trash(self.key,str(command.get("id","")),command.get("restore") is True)
            self.notebook("load",{"trash":command.get("restore") is not True})
        elif action == "bind":
            resource = str(command.get("id",""))
            if not any(r["id"]==resource for r in host.settings()["resources"]):
                raise ValueError("Tài nguyên không còn trong thư viện.")
            store.bind(self.key,str(self.did),resource,command.get("remove") is True)
            self.notebook("load",{})
        elif action == "resource":
            host._open_resource(str(command.get("id","")))
        elif action == "add_resource":
            before = {r["id"] for r in host.settings()["resources"]}
            host._add_resource(command.get("link") is True)
            for resource in host.settings()["resources"]:
                if resource["id"] not in before:
                    store.bind(self.key,str(self.did),resource["id"])
            self.notebook("load",{})
        elif action == "open_source":
            entry = store.get(self.key,str(command.get("id","")))
            if not entry or not str(entry["note_id"] or "").isdigit():
                raise ValueError("Ghi chú này không gắn với note Anki đang tồn tại trong bộ sưu tập này.")
            nid = int(entry["note_id"])
            self.query(lambda col:bool(col.db.scalar("SELECT 1 FROM notes WHERE id=?",nid)),
                lambda exists:self._open_source(nid) if exists else self.send("error","Note nguồn đã bị xóa; ghi chú vẫn được giữ."))

    def _open_source(self,nid):
        browser = dialogs.open("Browser",mw)
        browser.search_for("nid:"+str(nid)); browser.show(); browser.raise_(); browser.activateWindow()

    def done(self,result):
        if not self.closed:
            self.closed = True; self.serial += 1
            if _dialogs.get(self.kind) is self:
                _dialogs.pop(self.kind,None)
        super().done(result)


def _open(kind,did=None,note=None,selected_note=None):
    if not mw.col:
        return
    target_did = int(did or mw.col.decks.selected())
    existing = _dialogs.get(kind)
    if existing and existing.live() and existing.did==target_did:
        if kind=="workspace":
            existing.note_id = note
            existing.send("note_context",{"note_id":note})
            if selected_note:
                entry = workspace_store().get(existing.key,selected_note)
                if entry:
                    existing.send("note_focus",entry)
        existing.show(); existing.raise_(); existing.activateWindow(); return existing
    if existing:
        existing.close()
    dialog = ToolDialog(kind,target_did,note,selected_note)
    _dialogs[kind] = dialog
    dialog.show(); dialog.raise_(); dialog.activateWindow()
    return dialog


def open_commands():
    return _open("palette")


def open_notebook(did=None,*,selected_note=None):
    note = None
    if mw.state=="review" and mw.reviewer.card:
        note = str(mw.reviewer.card.nid)
    return _open("workspace",did,note,selected_note)


def reset_tools():
    for dialog in list(_dialogs.values()):
        dialog.close()
    _dialogs.clear(); _workspace.clear()


def install():
    global _installed
    if _installed:
        return
    _installed = True
    for label,callback,shortcut in (("AnkiNOS — Lệnh nhanh",open_commands,"Ctrl+K"),
        ("AnkiNOS — Sổ tay & tài liệu",open_notebook,"")):
        action = QAction(label,mw)
        if shortcut:
            action.setShortcut(QKeySequence(shortcut))
        qconnect(action.triggered,lambda _checked=False,callback=callback:callback())
        mw.form.menuTools.addAction(action)
    gui_hooks.profile_will_close.append(reset_tools)
