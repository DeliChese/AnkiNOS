"""Contextual study notes and resource links, local to profile and collection."""
from __future__ import annotations

from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path
import json
import sqlite3
import unicodedata
from uuid import uuid4


def folded(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text.casefold().replace("đ", "d")) if not unicodedata.combining(c))


def validate_database(path: Path) -> dict:
    with closing(sqlite3.connect(path.resolve().as_uri()+"?mode=ro", uri=True)) as db:
        if db.execute("PRAGMA user_version").fetchone()[0] != 1 or db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Dữ liệu sổ tay không hợp lệ hoặc chưa hỗ trợ phiên bản này.")
        objects = db.execute("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall()
        if {name for kind,name in objects if kind == "table"} != {"notes", "bindings"} or any(kind not in {"index","table"} for kind,_ in objects):
            raise ValueError("Cấu trúc sổ tay không hợp lệ.")
        for table, columns in {"notes": {"id","collection_key","deck_id","deck_name","note_id","title","body","search","created_at","updated_at","deleted_at"},
                               "bindings": {"collection_key","deck_id","resource_id"}}.items():
            if not columns.issubset({row[1] for row in db.execute(f"PRAGMA table_info({table})")}):
                raise ValueError("Thiếu cột dữ liệu sổ tay.")
        if db.execute("SELECT count(*) FROM notes WHERE typeof(body)!='text' OR length(body)>20000 OR typeof(title)!='text' OR length(title)>160 OR typeof(search)!='text'").fetchone()[0]:
            raise ValueError("Ghi chú không hợp lệ.")
        return {"notes": db.execute("SELECT count(*) FROM notes").fetchone()[0]}


class WorkspaceStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            if db.execute("PRAGMA user_version").fetchone()[0] not in {0,1}:
                raise ValueError("Phiên bản sổ tay chưa được hỗ trợ.")
            db.executescript("""CREATE TABLE IF NOT EXISTS notes(
                id TEXT PRIMARY KEY,collection_key TEXT NOT NULL,deck_id TEXT NOT NULL,deck_name TEXT NOT NULL,
                note_id TEXT,title TEXT NOT NULL,body TEXT NOT NULL,search TEXT NOT NULL,
                created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
                CREATE INDEX IF NOT EXISTS notes_context ON notes(collection_key,deck_id,deleted_at);
                CREATE TABLE IF NOT EXISTS bindings(collection_key TEXT,deck_id TEXT,resource_id TEXT,
                PRIMARY KEY(collection_key,deck_id,resource_id));PRAGMA user_version=1;""")

    @contextmanager
    def db(self):
        with closing(sqlite3.connect(self.path, timeout=5)) as db:
            db.row_factory = sqlite3.Row
            with db:
                yield db

    def save(self, collection: str, deck: str, deck_name: str, title: str, body: str, *, note_id: str | None = None, identifier: str | None = None, allow_deck_change: bool = False) -> str:
        if not isinstance(title,str) or not isinstance(body,str) or not body.strip() or len(body)>20000 or len(title)>160:
            raise ValueError("Ghi chú cần nội dung, tối đa 20.000 ký tự; tiêu đề tối đa 160 ký tự.")
        timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        identifier = identifier or uuid4().hex
        with self.db() as db:
            old = db.execute("SELECT collection_key,deck_id,note_id FROM notes WHERE id=?",(identifier,)).fetchone()
            if old:
                if old[0] != collection or (not allow_deck_change and old[1] != deck):
                    raise ValueError("Ghi chú thuộc ngữ cảnh khác.")
                # Editing a contextual note never silently rebinds its Anki note.
                if allow_deck_change:
                    db.execute("UPDATE notes SET deck_id=?,deck_name=?,title=?,body=?,search=?,updated_at=? WHERE id=?",
                        (deck,deck_name,title.strip(),body,folded(title+" "+body),timestamp,identifier))
                else:
                    db.execute("UPDATE notes SET title=?,body=?,search=?,updated_at=? WHERE id=?",
                        (title.strip(),body,folded(title+" "+body),timestamp,identifier))
            else:
                db.execute("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,NULL)",
                    (identifier,collection,deck,deck_name,note_id,title.strip(),body,folded(title+" "+body),timestamp,timestamp))
        return identifier

    def list(self, collection: str, deck: str | None = None, *, trash: bool = False, query: str = "", archived: bool = False) -> list[dict]:
        where = "collection_key != ?" if archived else "collection_key = ?"
        args = [collection]
        if deck is not None and not archived:
            where += " AND deck_id=?"; args.append(deck)
        where += " AND deleted_at IS NOT NULL" if trash else " AND deleted_at IS NULL"
        if query:
            where += " AND instr(search,?)>0"; args.append(folded(query[:300]))
        with self.db() as db:
            return [dict(row) for row in db.execute("SELECT * FROM notes WHERE "+where+" ORDER BY updated_at DESC,id LIMIT 100",args)]

    def trash(self, collection: str, identifier: str, restore: bool = False):
        with self.db() as db:
            db.execute("UPDATE notes SET deleted_at=? WHERE id=? AND collection_key=?",
                (None if restore else datetime.now(timezone.utc).isoformat(),identifier,collection))

    def get(self, collection: str, identifier: str) -> dict | None:
        with self.db() as db:
            row = db.execute("SELECT * FROM notes WHERE id=? AND collection_key=? AND deleted_at IS NULL",(identifier,collection)).fetchone()
            return dict(row) if row else None

    def bind(self, collection: str, deck: str, resource: str, remove: bool = False):
        with self.db() as db:
            if remove:
                db.execute("DELETE FROM bindings WHERE collection_key=? AND deck_id=? AND resource_id=?",(collection,deck,resource))
            else:
                db.execute("INSERT OR IGNORE INTO bindings VALUES (?,?,?)",(collection,deck,resource))

    def bindings(self, collection: str, deck: str) -> set[str]:
        with self.db() as db:
            return {row[0] for row in db.execute("SELECT resource_id FROM bindings WHERE collection_key=? AND deck_id=?",(collection,deck))}
