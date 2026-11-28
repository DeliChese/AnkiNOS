"""Profile-local Pomodoro timer, custom alert audio, and analytics store.

Pure Python (no aqt/Qt imports) so unit tests run fast without GUI.
Never modifies Anki cards, revlog, or FSRS scheduling.
"""
from __future__ import annotations

import calendar
from contextlib import closing, contextmanager
from datetime import date, datetime, timedelta
from hashlib import sha256
from pathlib import Path
import re
import sqlite3
import time
from typing import Any
from uuid import uuid4

from .media_store import profile_dir

MODES = ("classic", "long", "custom", "stopwatch")
UI_MODES = ("pill", "ring", "flip", "ambient")
PHASES = ("study", "break")
SOUNDS = ("zen", "chime", "digital", "wood", "custom", "none")
CORNERS = ("top-right", "top-left", "bottom-right", "bottom-left")
AUDIO_EXTS = {".mp3", ".wav", ".ogg"}
MAX_AUDIO_BYTES = 4 * 1024 * 1024
MAX_RECORDS = 10_000
AUDIO_ID_RE = re.compile(r"[0-9a-f]{32}\Z")

POMODORO_DEFAULTS: dict[str, Any] = {
    "mode": "classic",
    "ui_mode": "pill",
    "study_minutes": 25,
    "break_minutes": 5,
    "long_break_minutes": 15,
    "cycles_before_long": 4,
    "long_break_enabled": False,
    "auto_start_break": False,
    "auto_start_study": False,
    "pause_on_blur": False,
    "sound_study_end": "zen",
    "sound_break_end": "chime",
    "sound_volume": 75,
    "custom_study_sound": None,
    "custom_break_sound": None,
    "widget_corner": "bottom-right",
}


def _clean_sound_entry(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    sid = raw.get("id")
    ext = str(raw.get("ext", "")).lower()
    name = raw.get("name")
    if not isinstance(sid, str) or not AUDIO_ID_RE.fullmatch(sid) or ext not in AUDIO_EXTS:
        return None
    label = re.sub(r"[\x00-\x1f\x7f]+", " ", str(name or "Âm thanh tùy chỉnh")).strip()[:120]
    return {"id": sid, "name": label or "Âm thanh tùy chỉnh", "ext": ext}


def clean_pomodoro_settings(raw: Any) -> dict[str, Any]:
    """Validate and normalize profile Pomodoro settings at all persistence boundaries."""
    base = dict(POMODORO_DEFAULTS)
    if not isinstance(raw, dict):
        return base
    if raw.get("mode") in MODES:
        base["mode"] = raw["mode"]
    if raw.get("ui_mode") in UI_MODES:
        base["ui_mode"] = raw["ui_mode"]
    if raw.get("widget_corner") in CORNERS:
        base["widget_corner"] = raw["widget_corner"]
    for key, lo, hi in (
        ("study_minutes", 1, 180),
        ("break_minutes", 1, 60),
        ("long_break_minutes", 5, 60),
        ("cycles_before_long", 2, 8),
        ("sound_volume", 0, 100),
    ):
        val = raw.get(key)
        if type(val) is int and lo <= val <= hi:
            base[key] = val
    for key in ("long_break_enabled", "auto_start_break", "auto_start_study", "pause_on_blur"):
        if type(raw.get(key)) is bool:
            base[key] = raw[key]
    for key in ("sound_study_end", "sound_break_end"):
        if raw.get(key) in SOUNDS:
            base[key] = raw[key]
    for key in ("custom_study_sound", "custom_break_sound"):
        if key in raw:
            base[key] = _clean_sound_entry(raw[key])
    return base


def audio_dir(root: Path, profile: str) -> Path:
    return profile_dir(root, profile) / "pomodoro_audio"


def validate_audio_bytes(data: bytes, ext: str) -> bool:
    ext = ext.lower()
    if ext not in AUDIO_EXTS or not data or len(data) > MAX_AUDIO_BYTES:
        return False
    if ext == ".mp3":
        return data[:3] == b"ID3" or (len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0)
    if ext == ".wav":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE"
    if ext == ".ogg":
        return len(data) >= 4 and data[:4] == b"OggS"
    return False


def save_custom_sound(root: Path, profile: str, source: Path, *, previous: dict[str, str] | None = None) -> dict[str, str]:
    src = Path(source)
    if not src.is_file() or src.is_symlink():
        raise ValueError("Tệp âm thanh không tồn tại hoặc không hợp lệ.")
    ext = src.suffix.lower()
    if ext not in AUDIO_EXTS:
        raise ValueError("Chỉ hỗ trợ tệp âm thanh MP3, WAV hoặc OGG.")
    size = src.stat().st_size
    if size <= 0 or size > MAX_AUDIO_BYTES:
        raise ValueError("Tệp âm thanh phải nhỏ hơn 4 MB.")
    data = src.read_bytes()
    if not validate_audio_bytes(data, ext):
        raise ValueError("Định dạng tệp âm thanh không hợp lệ.")
    sid = sha256(data + uuid4().bytes).hexdigest()[:32]
    folder = audio_dir(root, profile)
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"{sid}{ext}"
    if dest.resolve().parent != folder.resolve():
        raise ValueError("Đường dẫn âm thanh không hợp lệ.")
    dest.write_bytes(data)
    if previous:
        delete_custom_sound(root, profile, previous)
    label = re.sub(r"[\x00-\x1f\x7f]+", " ", src.name).strip()[:120] or f"sound{ext}"
    return {"id": sid, "name": label, "ext": ext}


def delete_custom_sound(root: Path, profile: str, entry: dict[str, str] | None) -> None:
    cleaned = _clean_sound_entry(entry)
    if not cleaned:
        return
    folder = audio_dir(root, profile)
    if not folder.is_dir():
        return
    target = folder / f"{cleaned['id']}{cleaned['ext']}"
    try:
        if target.is_file() and not target.is_symlink() and target.resolve().parent == folder.resolve():
            target.unlink(missing_ok=True)
    except OSError:
        pass


def public_pomodoro_settings(raw: Any, root: Path, profile: str, package: str) -> dict[str, Any]:
    cfg = clean_pomodoro_settings(raw)
    folder = profile_dir(root, profile)
    aud = folder / "pomodoro_audio"
    for key in ("custom_study_sound", "custom_break_sound"):
        entry = cfg.get(key)
        if entry:
            fname = f"{entry['id']}{entry['ext']}"
            if (aud / fname).is_file():
                cfg[key] = {**entry, "url": f"/_addons/{package}/user_files/{folder.name}/pomodoro_audio/{fname}"}
            else:
                cfg[key] = None
    return cfg


def _mode_durations(mode: str, cfg: dict[str, Any], cycle_count: int) -> tuple[int, int]:
    """Return (study_seconds, break_seconds) for the given mode."""
    if mode == "stopwatch":
        return (0, 0)
    use_long = bool(cfg.get("long_break_enabled")) and cycle_count > 0 and (
        cycle_count % max(2, int(cfg.get("cycles_before_long", 4))) == 0
    )
    if mode == "classic":
        return (25 * 60, (15 if use_long else 5) * 60)
    if mode == "long":
        return (50 * 60, (20 if use_long else 10) * 60)
    study_m = int(cfg.get("study_minutes", 25))
    break_m = int(cfg.get("long_break_minutes", 15)) if use_long else int(cfg.get("break_minutes", 5))
    return (study_m * 60, break_m * 60)


def validate_database(path: Path) -> dict[str, int]:
    """Read-only integrity & schema verification for .nosbackup archives."""
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Lịch sử Pomodoro bị hỏng.")
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        if not {"sessions", "meta"}.issubset(tables) or not tables.issubset({"sessions", "meta"}):
            raise ValueError("Cấu trúc lịch sử Pomodoro không được hỗ trợ.")
        columns = {row[1] for row in db.execute("PRAGMA table_info(sessions)")}
        expected = {
            "id", "cycle_id", "started_at", "ended_at", "phase", "mode",
            "seconds", "target_seconds", "cards", "deck_id", "deck_name", "status",
        }
        if columns != expected:
            raise ValueError("Cột dữ liệu Pomodoro không hợp lệ.")
        invalid = db.execute("""SELECT count(*) FROM sessions WHERE
            typeof(id)!='integer' OR typeof(cycle_id)!='text'
            OR typeof(started_at)!='text'
            OR (ended_at IS NOT NULL AND typeof(ended_at)!='text')
            OR phase NOT IN ('study','break')
            OR mode NOT IN ('classic','long','custom','stopwatch')
            OR typeof(seconds) NOT IN ('integer','real') OR seconds < 0 OR seconds > 86400
            OR typeof(target_seconds)!='integer' OR target_seconds < 0 OR target_seconds > 86400
            OR typeof(cards)!='integer' OR cards < 0
            OR typeof(deck_id)!='text' OR typeof(deck_name)!='text'
            OR status NOT IN ('running','paused','completed','stopped','skipped','interrupted')""").fetchone()[0]
        if invalid:
            raise ValueError("Lịch sử Pomodoro chứa phiên không hợp lệ.")
        count = int(db.execute("SELECT count(*) FROM sessions").fetchone()[0])
        return {"sessions": count}


class PomodoroStore:
    def __init__(self, root: Path, profile: str):
        self.root = Path(root)
        self.profile = profile
        folder = profile_dir(self.root, profile)
        folder.mkdir(parents=True, exist_ok=True)
        self.path = folder / "pomodoro.sqlite3"
        self.session_id: int | None = None
        self.cycle_id: str = ""
        self.phase: str = "study"
        self.mode: str = "classic"
        self.elapsed: float = 0.0
        self.running_since: float | None = None
        self.target: int = 25 * 60
        self.cards: int = 0
        self.cycle_count: int = 0
        self.deck_id: str = ""
        self.deck_name: str = ""
        self.awaiting_phase: str | None = None
        self.awaiting_target: int = 0
        self.awaiting_mode: str = "classic"
        self.last_session: dict[str, Any] | None = None
        self.last_event: dict[str, Any] | None = None
        self._event_seq: int = 0
        self._cfg: dict[str, Any] = dict(POMODORO_DEFAULTS)

        with self._db() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA user_version=1")
            db.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.execute("""CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY,
                cycle_id TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                phase TEXT NOT NULL,
                mode TEXT NOT NULL,
                seconds REAL NOT NULL DEFAULT 0,
                target_seconds INTEGER NOT NULL DEFAULT 0,
                cards INTEGER NOT NULL DEFAULT 0,
                deck_id TEXT NOT NULL DEFAULT '',
                deck_name TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL)""")
            db.execute("CREATE INDEX IF NOT EXISTS idx_pomo_started ON sessions(started_at)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_pomo_phase_mode ON sessions(phase, mode)")
            db.execute(
                "UPDATE sessions SET status='interrupted', ended_at=datetime('now','localtime') "
                "WHERE status IN ('running','paused')"
            )
            self._migrate_legacy_focus(db, folder / "focus.sqlite3")

    def _migrate_legacy_focus(self, db: sqlite3.Connection, focus_path: Path) -> None:
        row = db.execute("SELECT value FROM meta WHERE key='focus_migrated'").fetchone()
        if row and row[0] == "1":
            return
        if focus_path.is_file():
            try:
                with closing(sqlite3.connect(focus_path.resolve().as_uri() + "?mode=ro", uri=True)) as old:
                    legacy_rows = old.execute(
                        "SELECT started_at, ended_at, seconds, target_seconds, cards, status "
                        "FROM sessions WHERE ended_at IS NOT NULL ORDER BY id ASC"
                    ).fetchall()
                for started_at, ended_at, seconds, target_seconds, cards, status in legacy_rows:
                    sec = max(0.0, min(86400.0, float(seconds or 0)))
                    tgt = max(0, min(86400, int(target_seconds or 0)))
                    st = status if status in {"completed", "stopped", "interrupted"} else "stopped"
                    mode = "classic" if tgt == 1500 else "custom"
                    db.execute(
                        "INSERT INTO sessions(cycle_id,started_at,ended_at,phase,mode,seconds,target_seconds,cards,deck_id,deck_name,status) "
                        "VALUES (?,?,?,'study',?,?,?,?,'','',?)",
                        ("legacy-" + uuid4().hex[:8], str(started_at), str(ended_at), mode, sec, tgt, max(0, int(cards or 0)), st),
                    )
            except (sqlite3.DatabaseError, OSError, ValueError):
                pass
        db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES ('focus_migrated','1')")

    @contextmanager
    def _db(self):
        with closing(sqlite3.connect(self.path, timeout=3)) as db:
            with db:
                yield db

    def update_config(self, cfg: dict[str, Any] | None) -> None:
        if isinstance(cfg, dict):
            self._cfg = clean_pomodoro_settings(cfg)

    def _seconds(self) -> float:
        base = self.elapsed + (
            max(0.0, time.monotonic() - self.running_since) if self.running_since is not None else 0.0
        )
        base = max(0.0, min(86400.0, base))
        return min(base, float(self.target)) if self.target > 0 else base

    def _next_event(self, kind: str, **payload: Any) -> dict[str, Any]:
        self._event_seq += 1
        self.last_event = {"event_id": self._event_seq, "kind": kind, **payload}
        return self.last_event

    def start(
        self,
        *,
        mode: str | None = None,
        phase: str = "study",
        study_minutes: int | None = None,
        break_minutes: int | None = None,
        deck_id: str = "",
        deck_name: str = "",
        cfg: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if cfg is not None:
            self.update_config(cfg)
        active_cfg = dict(self._cfg)
        if study_minutes is not None:
            if type(study_minutes) is not int or not (1 <= study_minutes <= 180):
                raise ValueError("Thời lượng học không hợp lệ (1–180 phút).")
            active_cfg["study_minutes"] = study_minutes
        if break_minutes is not None:
            if type(break_minutes) is not int or not (1 <= break_minutes <= 60):
                raise ValueError("Thời lượng nghỉ không hợp lệ (1–60 phút).")
            active_cfg["break_minutes"] = break_minutes
        chosen_mode = mode if mode is not None else active_cfg["mode"]
        if chosen_mode not in MODES:
            raise ValueError("Chế độ Pomodoro không hợp lệ.")
        if phase not in PHASES:
            raise ValueError("Pha Pomodoro không hợp lệ.")
        if self.session_id is not None:
            self._finish_active("stopped", emit_event=False)
        self._cfg = active_cfg
        self.awaiting_phase = None
        self.awaiting_target = 0
        self.last_session = None
        if phase == "study" and not self.cycle_id:
            self.cycle_id = uuid4().hex[:12]
        elif not self.cycle_id:
            self.cycle_id = uuid4().hex[:12]
        study_sec, break_sec = _mode_durations(chosen_mode, active_cfg, self.cycle_count)
        self.mode = chosen_mode
        self.phase = phase
        self.target = study_sec if phase == "study" else break_sec
        self.elapsed = 0.0
        self.cards = 0
        self.deck_id = str(deck_id or "")[:32]
        self.deck_name = str(deck_name or "")[:160]
        self.running_since = time.monotonic()
        with self._db() as db:
            cursor = db.execute(
                "INSERT INTO sessions(cycle_id,started_at,phase,mode,seconds,target_seconds,cards,deck_id,deck_name,status) "
                "VALUES (?,?,?,?,0,?,0,?,?,'running')",
                (
                    self.cycle_id,
                    datetime.now().astimezone().isoformat(timespec="seconds"),
                    self.phase,
                    self.mode,
                    self.target,
                    self.deck_id,
                    self.deck_name,
                ),
            )
            self.session_id = cursor.lastrowid
        return self.status()

    def _finish_active(self, reason: str, *, emit_event: bool = False) -> dict[str, Any] | None:
        if self.session_id is None:
            return None
        seconds = self._seconds()
        if self.target > 0 and seconds >= self.target:
            reason = "completed"
        finished_phase = self.phase
        finished_mode = self.mode
        finished_target = self.target
        finished_cards = self.cards
        summary = {
            "phase": finished_phase,
            "mode": finished_mode,
            "seconds": int(round(seconds)),
            "target_seconds": finished_target,
            "cards": finished_cards,
            "status": reason,
        }
        with self._db() as db:
            if seconds < 1.0 and reason != "completed" and finished_cards == 0:
                db.execute("DELETE FROM sessions WHERE id=?", (self.session_id,))
            else:
                db.execute(
                    "UPDATE sessions SET ended_at=?,seconds=?,cards=?,deck_id=?,deck_name=?,status=? WHERE id=?",
                    (
                        datetime.now().astimezone().isoformat(timespec="seconds"),
                        seconds,
                        finished_cards,
                        self.deck_id,
                        self.deck_name,
                        reason,
                        self.session_id,
                    ),
                )
                db.execute(
                    "DELETE FROM sessions WHERE id IN (SELECT id FROM sessions ORDER BY id DESC LIMIT -1 OFFSET ?)",
                    (MAX_RECORDS,),
                )
        self.session_id = None
        self.elapsed = 0.0
        self.cards = 0
        self.running_since = None
        self.last_session = summary
        if finished_phase == "study" and reason == "completed":
            self.cycle_count += 1
        elif finished_phase == "break" and reason in {"completed", "skipped"}:
            self.cycle_id = uuid4().hex[:12]

        if emit_event and reason == "completed":
            next_phase = "break" if finished_phase == "study" else "study"
            study_sec, break_sec = _mode_durations(finished_mode, self._cfg, self.cycle_count)
            next_target = break_sec if next_phase == "break" else study_sec
            self._next_event(
                "study_done" if finished_phase == "study" else "break_done",
                phase=finished_phase,
                mode=finished_mode,
                seconds=summary["seconds"],
                target_seconds=finished_target,
                cards=finished_cards,
                next_phase=next_phase,
                next_target_seconds=next_target,
            )
            auto_next = (
                bool(self._cfg.get("auto_start_break"))
                if next_phase == "break"
                else bool(self._cfg.get("auto_start_study"))
            )
            if auto_next:
                self.start(mode=finished_mode, phase=next_phase, deck_id=self.deck_id, deck_name=self.deck_name)
            else:
                self.awaiting_phase = next_phase
                self.awaiting_target = next_target
                self.awaiting_mode = finished_mode
        return summary

    def checkpoint(self) -> dict[str, Any]:
        if self.session_id is not None:
            seconds = self._seconds()
            if self.running_since is not None:
                self.elapsed = seconds
                self.running_since = time.monotonic()
            with self._db() as db:
                db.execute(
                    "UPDATE sessions SET seconds=?,cards=?,deck_id=?,deck_name=? WHERE id=?",
                    (seconds, self.cards, self.deck_id, self.deck_name, self.session_id),
                )
            if self.target > 0 and seconds >= self.target:
                self._finish_active("completed", emit_event=True)
        return self.status()

    def pause(self) -> dict[str, Any]:
        if self.session_id is not None and self.running_since is not None:
            self.elapsed = self._seconds()
            self.running_since = None
            with self._db() as db:
                db.execute(
                    "UPDATE sessions SET seconds=?,cards=?,status='paused' WHERE id=?",
                    (self.elapsed, self.cards, self.session_id),
                )
        return self.status()

    def resume(self) -> dict[str, Any]:
        if self.session_id is not None and self.running_since is None:
            self.running_since = time.monotonic()
            with self._db() as db:
                db.execute("UPDATE sessions SET status='running' WHERE id=?", (self.session_id,))
        return self.status()

    def switch_phase(self, target_phase: str | None = None, *, deck_id: str = "", deck_name: str = "") -> dict[str, Any]:
        if target_phase is None:
            if self.awaiting_phase in PHASES:
                target_phase = self.awaiting_phase
            else:
                target_phase = "break" if self.phase == "study" else "study"
        if target_phase not in PHASES:
            raise ValueError("Pha Pomodoro không hợp lệ.")
        chosen_mode = self.awaiting_mode if (self.session_id is None and self.awaiting_phase) else self.mode
        if self.session_id is not None:
            reason = "completed" if self.mode == "stopwatch" else "skipped"
            self._finish_active(reason, emit_event=False)
        return self.start(
            mode=chosen_mode,
            phase=target_phase,
            deck_id=deck_id or self.deck_id,
            deck_name=deck_name or self.deck_name,
        )

    def extend(self, minutes: int = 5) -> dict[str, Any]:
        if type(minutes) is not int or not (1 <= minutes <= 60):
            raise ValueError("Thời gian cộng thêm không hợp lệ.")
        if self.session_id is not None and self.target > 0:
            self.target = min(86400, self.target + minutes * 60)
            with self._db() as db:
                db.execute("UPDATE sessions SET target_seconds=? WHERE id=?", (self.target, self.session_id))
            return self.status()
        # Extend from just-finished study phase cleanly
        prev_mode = self.awaiting_mode if self.awaiting_phase else self.mode
        self.awaiting_phase = None
        self.awaiting_target = 0
        self.start(mode="custom", phase="study", study_minutes=minutes, deck_id=self.deck_id, deck_name=self.deck_name)
        if prev_mode in MODES:
            self.awaiting_mode = prev_mode
        return self.status()

    def dismiss_awaiting(self) -> dict[str, Any]:
        self.awaiting_phase = None
        self.awaiting_target = 0
        return self.status()

    def stop(self, reason: str = "stopped") -> dict[str, Any]:
        self.awaiting_phase = None
        self.awaiting_target = 0
        if self.session_id is not None:
            self._finish_active(reason, emit_event=False)
        self.cycle_id = ""
        return self.status()

    def set_deck(self, deck_id: str, deck_name: str) -> None:
        if self.session_id is not None and self.phase == "study":
            if deck_id and not self.deck_id:
                self.deck_id = str(deck_id)[:32]
                self.deck_name = str(deck_name or "")[:160]

    def answer(self, deck_id: str = "", deck_name: str = "") -> None:
        if self.session_id is not None and self.running_since is not None and self.phase == "study":
            self.cards += 1
            if deck_id and not self.deck_id:
                self.deck_id = str(deck_id)[:32]
                self.deck_name = str(deck_name or "")[:160]

    def status(self) -> dict[str, Any]:
        active = self.session_id is not None
        seconds = int(self._seconds()) if active else 0
        return {
            "active": active,
            "paused": active and self.running_since is None,
            "phase": self.phase,
            "mode": self.mode,
            "seconds": seconds,
            "target_seconds": self.target if active else _mode_durations(self._cfg["mode"], self._cfg, self.cycle_count)[0],
            "cards": self.cards if active else 0,
            "cycle_count": self.cycle_count,
            "deck_id": self.deck_id,
            "deck_name": self.deck_name,
            "awaiting_phase": self.awaiting_phase,
            "awaiting_target_seconds": self.awaiting_target,
            "awaiting_mode": self.awaiting_mode,
            "last_session": self.last_session,
            "last_event": self.last_event,
        }

    def analytics(
        self,
        *,
        period: str = "week",
        anchor: str | None = None,
        mode: str = "all",
        status: str = "all",
        deck_id: str = "all",
    ) -> dict[str, Any]:
        if period not in {"week", "month", "year"}:
            period = "week"
        if mode not in {"all", *MODES}:
            mode = "all"
        if status not in {"all", "completed", "stopped"}:
            status = "all"
        today = datetime.now().astimezone().date()
        anchor_date = today
        if isinstance(anchor, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", anchor):
            try:
                anchor_date = date.fromisoformat(anchor)
            except ValueError:
                anchor_date = today

        if period == "week":
            start_day = anchor_date - timedelta(days=anchor_date.weekday())
            end_day = start_day + timedelta(days=6)
            prev_anchor = (start_day - timedelta(days=7)).isoformat()
            next_anchor = (start_day + timedelta(days=7)).isoformat()
            bucket_defs = [
                (
                    (start_day + timedelta(days=i)).isoformat(),
                    (start_day + timedelta(days=i)).strftime("%d/%m"),
                    (start_day + timedelta(days=i)).isoformat(),
                )
                for i in range(7)
            ]
            period_label = f"{start_day.strftime('%d/%m')} – {end_day.strftime('%d/%m/%Y')}"
            key_len = 10
        elif period == "month":
            days_in_month = calendar.monthrange(anchor_date.year, anchor_date.month)[1]
            start_day = date(anchor_date.year, anchor_date.month, 1)
            end_day = date(anchor_date.year, anchor_date.month, days_in_month)
            prev_month_end = start_day - timedelta(days=1)
            next_month_start = end_day + timedelta(days=1)
            prev_anchor = date(prev_month_end.year, prev_month_end.month, 1).isoformat()
            next_anchor = next_month_start.isoformat()
            bucket_defs = [
                (
                    date(anchor_date.year, anchor_date.month, d).isoformat(),
                    str(d),
                    date(anchor_date.year, anchor_date.month, d).isoformat(),
                )
                for d in range(1, days_in_month + 1)
            ]
            period_label = f"Tháng {anchor_date.month}/{anchor_date.year}"
            key_len = 10
        else:
            start_day = date(anchor_date.year, 1, 1)
            end_day = date(anchor_date.year, 12, 31)
            prev_anchor = date(anchor_date.year - 1, 1, 1).isoformat()
            next_anchor = date(anchor_date.year + 1, 1, 1).isoformat()
            bucket_defs = [
                (
                    f"{anchor_date.year}-{m:02d}",
                    f"Th{m}",
                    f"Tháng {m}/{anchor_date.year}",
                )
                for m in range(1, 13)
            ]
            period_label = f"Năm {anchor_date.year}"
            key_len = 7

        with self._db() as db:
            rows = db.execute(
                "SELECT started_at, phase, mode, seconds, target_seconds, cards, deck_id, deck_name, status "
                "FROM sessions WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT ?",
                (MAX_RECORDS,),
            ).fetchall()

        decks_seen: dict[str, str] = {}
        today_iso = today.isoformat()
        today_study = 0
        today_break = 0

        buckets: dict[str, dict[str, Any]] = {
            bkey: {
                "key": bkey,
                "label": blabel,
                "full_label": bfull,
                "study_seconds": 0,
                "break_seconds": 0,
                "total_seconds": 0,
                "focus_ratio": None,
                "cards": 0,
                "study_sessions": 0,
                "break_sessions": 0,
                "completed_sessions": 0,
            }
            for bkey, blabel, bfull in bucket_defs
        }

        filtered_sessions: list[dict[str, Any]] = []
        total_study = 0
        total_break = 0
        total_cards = 0
        study_sessions = 0
        break_sessions = 0
        completed_sessions = 0

        start_iso = start_day.isoformat()
        end_iso = end_day.isoformat()

        for started_at, phase, row_mode, seconds, target_seconds, cards, r_deck_id, r_deck_name, row_status in rows:
            sec = int(round(float(seconds or 0)))
            if r_deck_id and r_deck_name and r_deck_id not in decks_seen:
                decks_seen[r_deck_id] = r_deck_name
            day_str = str(started_at)[:10]
            if day_str == today_iso:
                if phase == "study":
                    today_study += sec
                else:
                    today_break += sec
            if mode != "all" and row_mode != mode:
                continue
            if status == "completed" and row_status != "completed":
                continue
            if status == "stopped" and row_status == "completed":
                continue
            if deck_id != "all" and r_deck_id != deck_id:
                continue
            if not (start_iso <= day_str <= end_iso):
                continue

            bkey = str(started_at)[:key_len]
            bucket = buckets.get(bkey)
            if bucket is not None:
                if phase == "study":
                    bucket["study_seconds"] += sec
                    bucket["study_sessions"] += 1
                    bucket["cards"] += int(cards or 0)
                else:
                    bucket["break_seconds"] += sec
                    bucket["break_sessions"] += 1
                if row_status == "completed":
                    bucket["completed_sessions"] += 1

            if phase == "study":
                total_study += sec
                study_sessions += 1
                total_cards += int(cards or 0)
            else:
                total_break += sec
                break_sessions += 1
            if row_status == "completed":
                completed_sessions += 1

            if len(filtered_sessions) < 60:
                filtered_sessions.append({
                    "started_at": started_at,
                    "phase": phase,
                    "mode": row_mode,
                    "seconds": sec,
                    "target_seconds": int(target_seconds or 0),
                    "cards": int(cards or 0),
                    "deck_id": r_deck_id,
                    "deck_name": r_deck_name,
                    "status": row_status,
                })

        bucket_list: list[dict[str, Any]] = []
        for bkey, _, _ in bucket_defs:
            b = buckets[bkey]
            tot = b["study_seconds"] + b["break_seconds"]
            b["total_seconds"] = tot
            b["focus_ratio"] = round((b["study_seconds"] / tot) * 100.0, 1) if tot > 0 else None
            bucket_list.append(b)

        total_all = total_study + total_break
        total_sessions = study_sessions + break_sessions
        focus_ratio = round((total_study / total_all) * 100.0, 1) if total_all > 0 else None
        avg_study = int(round(total_study / study_sessions)) if study_sessions > 0 else 0

        return {
            "period": period,
            "anchor": anchor_date.isoformat(),
            "today": today_iso,
            "period_label": period_label,
            "prev_anchor": prev_anchor,
            "next_anchor": next_anchor,
            "can_next": end_day < today,
            "filters": {"mode": mode, "status": status, "deck_id": deck_id},
            "summary": {
                "study_seconds": total_study,
                "break_seconds": total_break,
                "total_seconds": total_all,
                "focus_ratio": focus_ratio,
                "study_sessions": study_sessions,
                "break_sessions": break_sessions,
                "total_sessions": total_sessions,
                "completed_sessions": completed_sessions,
                "avg_study_seconds": avg_study,
                "total_cards": total_cards,
                "today_study_seconds": today_study,
                "today_break_seconds": today_break,
            },
            "buckets": bucket_list,
            "decks": [{"id": did, "name": dname} for did, dname in sorted(decks_seen.items(), key=lambda x: x[1].casefold())],
            "sessions": filtered_sessions,
            "current": self.status(),
        }
