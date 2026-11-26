"""Read-only archive compatibility for the removed BrainExer Hub feature."""
from __future__ import annotations

from contextlib import closing
from pathlib import Path
import sqlite3

BASE_TABLES = {"sessions", "exercises", "attempts", "mistakes", "usage_events", "limit_settings"}
HUB_TABLES = BASE_TABLES | {"deck_kinds", "listening_items", "audio_cache", "highscores", "overrides", "tts_usage"}


def validate_database(path: Path) -> dict:
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.execute("PRAGMA trusted_schema=OFF")
        version = int(db.execute("PRAGMA user_version").fetchone()[0])
        if version not in {1, 2, 3, 4}:
            raise ValueError("Phiên bản dữ liệu BrainExer cũ không được hỗ trợ.")
        if db.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise ValueError("Dữ liệu BrainExer cũ bị lỗi.")
        if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("Dữ liệu BrainExer cũ bị lỗi.")
        objects = db.execute(
            "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
        ).fetchall()
        expected = BASE_TABLES if version < 3 else HUB_TABLES
        if {name for kind, name in objects if kind == "table"} != expected or any(
            kind not in {"table", "index"} for kind, _ in objects
        ):
            raise ValueError("Cấu trúc dữ liệu BrainExer cũ không hợp lệ.")
        return {
            "sessions": int(db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]),
            "mistakes": int(db.execute("SELECT COUNT(*) FROM mistakes").fetchone()[0]),
        }


def clean_settings(values: object, *, strict: bool = False) -> dict:
    if not isinstance(values, dict):
        if strict:
            raise ValueError("Cấu hình BrainExer cũ không hợp lệ.")
        return {}
    cleaned = {}
    for key, value in values.items():
        if isinstance(key, str) and len(key) <= 80 and isinstance(value, (str, int, bool)):
            if isinstance(value, str) and len(value) > 160:
                if strict:
                    raise ValueError("Cấu hình BrainExer cũ không hợp lệ.")
                continue
            cleaned[key] = value
        elif strict:
            raise ValueError("Cấu hình BrainExer cũ không hợp lệ.")
    return cleaned
