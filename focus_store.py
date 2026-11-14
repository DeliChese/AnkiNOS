"""Profile-local Focus sessions. Never changes Anki cards or scheduler."""
from __future__ import annotations

import sqlite3
import time
from datetime import datetime, timedelta
from pathlib import Path

from .media_store import profile_dir

DURATIONS = (5, 15, 25, 45, 60, 90)
MAX_RECORDS = 2000


class FocusStore:
    def __init__(self, root: Path, profile: str):
        folder = profile_dir(root, profile)
        folder.mkdir(parents=True, exist_ok=True)
        self.path = folder / "focus.sqlite3"
        self.session_id: int | None = None
        self.elapsed = 0.0
        self.running_since: float | None = None
        self.target = 25 * 60
        self.cards = 0
        with self._db() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY, started_at TEXT NOT NULL,
                ended_at TEXT, seconds REAL NOT NULL DEFAULT 0,
                target_seconds INTEGER NOT NULL, cards INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL)""")
            # Interrupted sessions retain only previously checkpointed active time.
            db.execute("UPDATE sessions SET status='interrupted', ended_at=datetime('now','localtime') WHERE status IN ('running','paused')")

    def _db(self):
        return sqlite3.connect(self.path, timeout=3)

    def _seconds(self) -> float:
        return max(0.0, self.elapsed + (max(0.0, time.monotonic() - self.running_since)
                    if self.running_since is not None else 0.0))

    def start(self, minutes: int) -> dict:
        if type(minutes) is not int or minutes not in DURATIONS:
            raise ValueError("Thời lượng Focus không hợp lệ.")
        if self.session_id is not None:
            self.stop("stopped")
        self.target = minutes * 60
        self.elapsed = 0
        self.cards = 0
        self.running_since = time.monotonic()
        with self._db() as db:
            cursor = db.execute(
                "INSERT INTO sessions(started_at,seconds,target_seconds,cards,status) VALUES (?,0,?,0,'running')",
                (datetime.now().astimezone().isoformat(timespec="seconds"), self.target))
            self.session_id = cursor.lastrowid
        return self.status()

    def checkpoint(self) -> dict:
        if self.session_id is not None:
            seconds = min(self._seconds(), self.target)
            if self.running_since is not None:
                self.elapsed = seconds
                self.running_since = time.monotonic()
            with self._db() as db:
                db.execute("UPDATE sessions SET seconds=?,cards=? WHERE id=?",
                           (seconds, self.cards, self.session_id))
            if seconds >= self.target:
                return self.stop("completed")
        return self.status()

    def pause(self) -> dict:
        if self.session_id is not None and self.running_since is not None:
            self.elapsed = min(self._seconds(), self.target)
            self.running_since = None
            with self._db() as db:
                db.execute("UPDATE sessions SET seconds=?,cards=?,status='paused' WHERE id=?",
                           (self.elapsed, self.cards, self.session_id))
        return self.status()

    def resume(self) -> dict:
        if self.session_id is not None and self.running_since is None:
            self.running_since = time.monotonic()
            with self._db() as db:
                db.execute("UPDATE sessions SET status='running' WHERE id=?", (self.session_id,))
        return self.status()

    def answer(self) -> None:
        if self.session_id is not None and self.running_since is not None:
            self.cards += 1
            self.checkpoint()

    def stop(self, reason: str = "stopped") -> dict:
        if self.session_id is not None:
            seconds = min(self._seconds(), self.target)
            if seconds >= self.target:
                reason = "completed"
            with self._db() as db:
                db.execute("UPDATE sessions SET ended_at=?,seconds=?,cards=?,status=? WHERE id=?",
                           (datetime.now().astimezone().isoformat(timespec="seconds"),
                            seconds, self.cards, reason, self.session_id))
                db.execute("""DELETE FROM sessions WHERE id IN (
                    SELECT id FROM sessions ORDER BY id DESC LIMIT -1 OFFSET ?)""", (MAX_RECORDS,))
            self.session_id = None
            self.elapsed = 0
            self.cards = 0
            self.running_since = None
        return self.status()

    def status(self) -> dict:
        return {"active": self.session_id is not None,
                "paused": self.session_id is not None and self.running_since is None,
                "seconds": int(min(self._seconds(), self.target)) if self.session_id is not None else 0,
                "target_seconds": self.target, "cards": self.cards}

    def history(self) -> dict:
        today = datetime.now().astimezone().date()
        with self._db() as db:
            rows = db.execute(
                "SELECT started_at,seconds,target_seconds,cards,status FROM sessions "
                "WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT ?", (MAX_RECORDS,)).fetchall()
        sessions = [
            {"started_at": start, "seconds": int(round(seconds)), "target_seconds": target,
             "cards": cards, "status": status}
            for start, seconds, target, cards, status in rows
        ]
        daily = {}
        for item in sessions:
            day = item["started_at"][:10]
            entry = daily.setdefault(day, {"seconds": 0, "sessions": 0, "cards": 0})
            entry["seconds"] += item["seconds"]
            entry["sessions"] += 1
            entry["cards"] += item["cards"]
        last_week = {(today - timedelta(days=i)).isoformat() for i in range(7)}
        today_data = daily.get(today.isoformat(), {})
        return {"today_seconds": today_data.get("seconds", 0),
                "week_seconds": sum(daily.get(day, {}).get("seconds", 0) for day in last_week),
                "total_seconds": sum(item["seconds"] for item in sessions),
                "total_sessions": len(sessions),
                "completed_sessions": sum(item["status"] == "completed" for item in sessions),
                "total_cards": sum(item["cards"] for item in sessions),
                "daily": [{"date": (today - timedelta(days=i)).isoformat(),
                           **daily.get((today - timedelta(days=i)).isoformat(),
                                       {"seconds": 0, "sessions": 0, "cards": 0})}
                          for i in range(13, -1, -1)],
                "sessions": sessions[:40], "current": self.status()}
