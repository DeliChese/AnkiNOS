"""Profile-local SQLite persistence for Daily Schedule presets and real-due Move Ledger."""
from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import time
from typing import Any
from uuid import uuid4

from .daily_scheduler import DEFAULT_DAILY_CAP, MAX_DAILY_CAP, MIN_DAILY_CAP
from .media_store import profile_dir

SCHEMA_VERSION = 1
MAX_PRESETS = 40
MAX_BATCHES = 200
DB_NAME = "daily_schedule.sqlite3"

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scope_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    scope_mode TEXT NOT NULL CHECK(scope_mode IN ('all', 'decks')),
    deck_names TEXT NOT NULL,
    include_children INTEGER NOT NULL DEFAULT 1 CHECK(include_children IN (0, 1)),
    daily_cap INTEGER NOT NULL CHECK(daily_cap BETWEEN 1 AND 2000),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS move_batches (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    created_ms INTEGER NOT NULL,
    scope_label TEXT NOT NULL,
    daily_cap INTEGER NOT NULL,
    window_days INTEGER NOT NULL,
    card_count INTEGER NOT NULL CHECK(card_count >= 0),
    summary TEXT NOT NULL,
    rolled_back_at TEXT
);
CREATE TABLE IF NOT EXISTS move_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL REFERENCES move_batches(id) ON DELETE CASCADE,
    card_id INTEGER NOT NULL,
    deck_name TEXT NOT NULL,
    preview TEXT NOT NULL DEFAULT '',
    old_due INTEGER NOT NULL,
    new_due INTEGER NOT NULL,
    old_date TEXT NOT NULL,
    new_date TEXT NOT NULL,
    ivl INTEGER NOT NULL DEFAULT 0,
    r_before REAL NOT NULL DEFAULT 0,
    r_target REAL NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_daily_entries_batch ON move_entries(batch_id);
CREATE INDEX IF NOT EXISTS idx_daily_batches_time ON move_batches(created_ms DESC);
PRAGMA user_version = 1;
"""

REQUIRED_TABLES = {
    "preferences": {"key", "value"},
    "scope_presets": {"id", "name", "scope_mode", "deck_names", "include_children", "daily_cap", "created_at", "updated_at"},
    "move_batches": {"id", "created_at", "created_ms", "scope_label", "daily_cap", "window_days", "card_count", "summary", "rolled_back_at"},
    "move_entries": {"id", "batch_id", "card_id", "deck_name", "preview", "old_due", "new_due", "old_date", "new_date", "ivl", "r_before", "r_target", "reason"},
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def clean_daily_config(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {}
    scope_mode = raw.get("scope_mode") if raw.get("scope_mode") in {"all", "decks"} else "all"
    raw_names = raw.get("deck_names")
    deck_names = []
    if isinstance(raw_names, list):
        seen: set[str] = set()
        for item in raw_names[:300]:
            if isinstance(item, str) and 0 < len(item.strip()) <= 500:
                name = item.strip()
                if name not in seen:
                    seen.add(name)
                    deck_names.append(name)
    include_children = raw.get("include_children") is not False
    cap_raw = raw.get("daily_cap", DEFAULT_DAILY_CAP)
    try:
        daily_cap = max(MIN_DAILY_CAP, min(MAX_DAILY_CAP, int(cap_raw)))
    except (TypeError, ValueError):
        daily_cap = DEFAULT_DAILY_CAP
    active_preset_id = raw.get("active_preset_id") if isinstance(raw.get("active_preset_id"), str) else ""
    return {
        "scope_mode": scope_mode,
        "deck_names": deck_names,
        "include_children": include_children,
        "daily_cap": daily_cap,
        "auto_reschedule": raw.get("auto_reschedule") is True,
        "active_preset_id": active_preset_id[:64],
    }


class DailyStore:
    def __init__(self, root: Path, profile: str) -> None:
        self.path = profile_dir(Path(root), profile) / DB_NAME
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as db:
            db.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(str(self.path), timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("PRAGMA busy_timeout = 5000")
        return db

    def get_config(self) -> dict[str, Any]:
        with closing(self._connect()) as db:
            row = db.execute("SELECT value FROM preferences WHERE key='config'").fetchone()
        if not row:
            return clean_daily_config({})
        try:
            return clean_daily_config(json.loads(row["value"]))
        except ValueError:
            return clean_daily_config({})

    def save_config(self, values: dict[str, Any]) -> dict[str, Any]:
        merged = {**self.get_config(), **(values if isinstance(values, dict) else {})}
        cleaned = clean_daily_config(merged)
        with closing(self._connect()) as db, db:
            db.execute(
                "INSERT INTO preferences(key, value) VALUES('config', ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (json.dumps(cleaned, ensure_ascii=False),),
            )
        return cleaned

    def list_presets(self) -> list[dict[str, Any]]:
        with closing(self._connect()) as db:
            rows = db.execute(
                "SELECT id, name, scope_mode, deck_names, include_children, daily_cap, created_at, updated_at "
                "FROM scope_presets ORDER BY updated_at DESC, name COLLATE NOCASE"
            ).fetchall()
        result = []
        for row in rows:
            try:
                names = json.loads(row["deck_names"])
            except ValueError:
                names = []
            result.append({
                "id": row["id"],
                "name": row["name"],
                "scope_mode": row["scope_mode"],
                "deck_names": names if isinstance(names, list) else [],
                "include_children": bool(row["include_children"]),
                "daily_cap": int(row["daily_cap"]),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            })
        return result

    def save_preset(
        self,
        name: str,
        *,
        scope_mode: str,
        deck_names: list[str],
        include_children: bool,
        daily_cap: int,
        preset_id: str | None = None,
    ) -> dict[str, Any]:
        clean_name = str(name or "").strip()[:80]
        if not clean_name:
            raise ValueError("Hãy nhập tên phạm vi.")
        cleaned = clean_daily_config({
            "scope_mode": scope_mode,
            "deck_names": deck_names,
            "include_children": include_children,
            "daily_cap": daily_cap,
        })
        now = _utc_now()
        pid = (preset_id or "").strip()[:64] or uuid4().hex[:16]
        with closing(self._connect()) as db, db:
            existing = db.execute("SELECT id, created_at FROM scope_presets WHERE id=?", (pid,)).fetchone()
            if not existing:
                count = int(db.execute("SELECT count(*) FROM scope_presets").fetchone()[0])
                if count >= MAX_PRESETS:
                    raise ValueError(f"Tối đa {MAX_PRESETS} phạm vi đã lưu. Hãy xóa bớt trước khi thêm.")
            created = existing["created_at"] if existing else now
            db.execute(
                """INSERT INTO scope_presets(id, name, scope_mode, deck_names, include_children, daily_cap, created_at, updated_at)
                   VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                     name=excluded.name,
                     scope_mode=excluded.scope_mode,
                     deck_names=excluded.deck_names,
                     include_children=excluded.include_children,
                     daily_cap=excluded.daily_cap,
                     updated_at=excluded.updated_at""",
                (
                    pid,
                    clean_name,
                    cleaned["scope_mode"],
                    json.dumps(cleaned["deck_names"], ensure_ascii=False),
                    int(cleaned["include_children"]),
                    cleaned["daily_cap"],
                    created,
                    now,
                ),
            )
        return {
            "id": pid,
            "name": clean_name,
            "scope_mode": cleaned["scope_mode"],
            "deck_names": cleaned["deck_names"],
            "include_children": cleaned["include_children"],
            "daily_cap": cleaned["daily_cap"],
            "created_at": created,
            "updated_at": now,
        }

    def delete_preset(self, preset_id: str) -> None:
        pid = str(preset_id or "").strip()[:64]
        with closing(self._connect()) as db, db:
            db.execute("DELETE FROM scope_presets WHERE id=?", (pid,))
        cfg = self.get_config()
        if cfg.get("active_preset_id") == pid:
            self.save_config({"active_preset_id": ""})

    def record_batch(
        self,
        *,
        scope_label: str,
        daily_cap: int,
        window_days: int,
        summary: str,
        moves: list[dict[str, Any]],
        created_ms: int | None = None,
    ) -> dict[str, Any]:
        batch_id = uuid4().hex[:16]
        now = _utc_now()
        ts_ms = int(created_ms if created_ms is not None else time.time() * 1000)
        with closing(self._connect()) as db, db:
            db.execute(
                """INSERT INTO move_batches(id, created_at, created_ms, scope_label, daily_cap, window_days, card_count, summary, rolled_back_at)
                   VALUES(?, ?, ?, ?, ?, ?, ?, ?, NULL)""",
                (batch_id, now, ts_ms, scope_label[:200], int(daily_cap), int(window_days), len(moves), summary[:400]),
            )
            db.executemany(
                """INSERT INTO move_entries(batch_id, card_id, deck_name, preview, old_due, new_due, old_date, new_date, ivl, r_before, r_target, reason)
                   VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    (
                        batch_id,
                        int(item["card_id"]),
                        str(item.get("deck_name", ""))[:300],
                        str(item.get("preview", ""))[:160],
                        int(item["old_due"]),
                        int(item["new_due"]),
                        str(item.get("old_date", ""))[:20],
                        str(item.get("new_date", ""))[:20],
                        int(item.get("ivl", 0)),
                        float(item.get("r_before", 0.0)),
                        float(item.get("r_target", 0.0)),
                        str(item.get("reason", ""))[:200],
                    )
                    for item in moves
                ],
            )
            # Prune oldest batches beyond MAX_BATCHES.
            db.execute(
                """DELETE FROM move_batches WHERE id NOT IN (
                       SELECT id FROM move_batches ORDER BY created_ms DESC LIMIT ?
                   )""",
                (MAX_BATCHES,),
            )
        return {
            "id": batch_id,
            "created_at": now,
            "created_ms": ts_ms,
            "scope_label": scope_label,
            "daily_cap": int(daily_cap),
            "window_days": int(window_days),
            "card_count": len(moves),
            "summary": summary,
            "rolled_back_at": None,
        }

    def list_batches(self, limit: int = 25) -> list[dict[str, Any]]:
        safe_limit = max(1, min(100, int(limit)))
        with closing(self._connect()) as db:
            rows = db.execute(
                """SELECT id, created_at, created_ms, scope_label, daily_cap, window_days, card_count, summary, rolled_back_at
                   FROM move_batches ORDER BY created_ms DESC LIMIT ?""",
                (safe_limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_batch(self, batch_id: str) -> dict[str, Any] | None:
        bid = str(batch_id or "").strip()[:64]
        with closing(self._connect()) as db:
            batch = db.execute(
                """SELECT id, created_at, created_ms, scope_label, daily_cap, window_days, card_count, summary, rolled_back_at
                   FROM move_batches WHERE id=?""",
                (bid,),
            ).fetchone()
            if not batch:
                return None
            entries = db.execute(
                """SELECT card_id, deck_name, preview, old_due, new_due, old_date, new_date, ivl, r_before, r_target, reason
                   FROM move_entries WHERE batch_id=? ORDER BY id""",
                (bid,),
            ).fetchall()
        return {**dict(batch), "entries": [dict(row) for row in entries]}

    def mark_rolled_back(self, batch_id: str) -> str:
        now = _utc_now()
        with closing(self._connect()) as db, db:
            db.execute(
                "UPDATE move_batches SET rolled_back_at=? WHERE id=? AND rolled_back_at IS NULL",
                (now, str(batch_id)),
            )
        return now


def validate_database(path: Path) -> dict[str, int]:
    """Read-only SQLite validation for .nosbackup archives."""
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.execute("PRAGMA trusted_schema=OFF")
        if db.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise ValueError("Dữ liệu Lịch ôn bị hỏng.")
        if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("Dữ liệu Lịch ôn lỗi khóa ngoại.")
        version = int(db.execute("PRAGMA user_version").fetchone()[0])
        if version != SCHEMA_VERSION:
            raise ValueError("Phiên bản dữ liệu Lịch ôn không được hỗ trợ.")
        objects = db.execute(
            "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
        ).fetchall()
        if {name for kind, name in objects if kind == "table"} != set(REQUIRED_TABLES) or any(
            kind not in {"table", "index"} for kind, _ in objects
        ):
            raise ValueError("Cấu trúc dữ liệu Lịch ôn không hợp lệ.")
        for table, columns in REQUIRED_TABLES.items():
            actual = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
            if not columns.issubset(actual):
                raise ValueError("Thiếu cột trong dữ liệu Lịch ôn.")
        return {
            "presets": int(db.execute("SELECT count(*) FROM scope_presets").fetchone()[0]),
            "batches": int(db.execute("SELECT count(*) FROM move_batches").fetchone()[0]),
        }
