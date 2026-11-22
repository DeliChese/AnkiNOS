from __future__ import annotations

import json
import sqlite3
from contextlib import closing, contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple


SCHEMA_VERSION = 4
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class Database:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.path), timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    def initialize(self) -> None:
        with closing(self.connect()) as connection, connection:
            current = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if current == 0:
                schema = SCHEMA_PATH.read_text(encoding="utf-8")
                connection.executescript(schema)
                current = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if current > SCHEMA_VERSION:
                raise RuntimeError("Database được tạo bởi BrainExer phiên bản mới hơn.")
            if current < SCHEMA_VERSION:
                self._run_migrations(connection, current)

    @staticmethod
    def _run_migrations(connection: sqlite3.Connection, current: int, target: int = SCHEMA_VERSION) -> None:
        migration_dir = SCHEMA_PATH.parent / "migrations"
        for path in sorted(migration_dir.glob("[0-9][0-9][0-9][0-9]_*.sql")):
            version = int(path.name[:4])
            if current < version <= target:
                connection.executescript(path.read_text(encoding="utf-8"))
                current = version
        if connection.execute("PRAGMA user_version").fetchone()[0] != target:
            raise ValueError("Thiếu bản nâng cấp dữ liệu BrainExer.")

    @contextmanager
    def immediate(self) -> Iterator[sqlite3.Connection]:
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def sync_limits(self, limits: Dict[str, int]) -> None:
        allowed = {
            "max_api_calls_per_day", "max_api_calls_per_week",
            "max_exercises_per_day", "max_exercises_per_week",
        }
        rows = [(key, max(0, int(value))) for key, value in limits.items() if key in allowed]
        with closing(self.connect()) as connection, connection:
            connection.executemany(
                "INSERT INTO limit_settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                rows,
            )

    def create_session(
        self,
        deck_id: int,
        deck_name: str,
        card_count: int,
        include_children: bool,
        exercise_types: Sequence[str],
        language: str,
        learner_level: str,
    ) -> int:
        with closing(self.connect()) as connection, connection:
            cursor = connection.execute(
                "INSERT INTO sessions(deck_id, deck_name, card_count, include_children, exercise_types, "
                "language, learner_level, started_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    deck_id, deck_name, card_count, int(include_children), json_text(list(exercise_types)),
                    language, learner_level, utc_now(),
                ),
            )
            return int(cursor.lastrowid)

    def end_session(self, session_id: int) -> None:
        with closing(self.connect()) as connection, connection:
            connection.execute("UPDATE sessions SET ended_at=? WHERE id=? AND ended_at IS NULL", (utc_now(), session_id))

    def insert_exercise(
        self,
        session_id: int,
        exercise_type: str,
        prompt_shown: str,
        source_context: Dict[str, Any],
        payload: Dict[str, Any],
        provider: str,
        model: str,
        prompt_version: str,
        request_id: str,
        card_id: Optional[int] = None,
        note_id: Optional[int] = None,
        raw_response: Optional[str] = None,
    ) -> int:
        with closing(self.connect()) as connection, connection:
            cursor = connection.execute(
                "INSERT INTO exercises(session_id, card_id, note_id, exercise_type, prompt_shown, "
                "source_context, exercise_payload, ai_raw_response, provider, model, prompt_version, "
                "response_request_id, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    session_id, card_id, note_id, exercise_type, prompt_shown,
                    json_text(source_context), json_text(payload), raw_response, provider, model,
                    prompt_version, request_id, utc_now(),
                ),
            )
            return int(cursor.lastrowid)

    def insert_attempt(
        self,
        exercise_id: int,
        user_answer: str,
        feedback: Dict[str, Any],
        is_correct: Optional[bool] = None,
        score: Optional[float] = None,
        mistakes: Iterable[Dict[str, Any]] = (),
    ) -> int:
        with closing(self.connect()) as connection, connection:
            cursor = connection.execute(
                "INSERT INTO attempts(exercise_id, user_answer, is_correct, score, feedback_payload, submitted_at) "
                "VALUES(?, ?, ?, ?, ?, ?)",
                (
                    exercise_id, user_answer, None if is_correct is None else int(is_correct),
                    score, json_text(feedback), utc_now(),
                ),
            )
            connection.execute("UPDATE exercises SET status='answered' WHERE id=?", (exercise_id,))
            attempt_id = int(cursor.lastrowid)
            self._insert_mistakes(connection, attempt_id, mistakes)
            return attempt_id

    def insert_mistakes(self, attempt_id: int, errors: Iterable[Dict[str, Any]]) -> None:
        with closing(self.connect()) as connection, connection:
            self._insert_mistakes(connection, attempt_id, errors)

    @staticmethod
    def _insert_mistakes(connection, attempt_id: int, errors: Iterable[Dict[str, Any]]) -> None:
        source = connection.execute(
            "SELECT e.id,e.card_id,e.prompt_shown,s.deck_name FROM attempts a "
            "JOIN exercises e ON e.id=a.exercise_id JOIN sessions s ON s.id=e.session_id "
            "WHERE a.id=?", (attempt_id,),
        ).fetchone()
        if source is None:
            raise ValueError("Không tìm thấy nguồn của lỗi BrainExer.")
        due = (date.today() + timedelta(days=1)).isoformat()
        source_key = str(source["card_id"]) if source["card_id"] else "exercise:" + str(source["id"])
        kind_map = {"grammar": "usage", "word_choice": "usage", "spelling": "spelling",
                    "nuance": "meaning", "word_form": "usage", "other": "concept"}
        rows = [
            (
                attempt_id, error.get("mistake_type", "other"), error.get("original_text", ""),
                error.get("corrected_text", ""), error.get("explanation", ""),
                error.get("severity", "minor"), utc_now(), source["deck_name"],
                source["card_id"], kind_map.get(error.get("mistake_type", "other"), "concept"),
                source["prompt_shown"], due, source_key, utc_now(),
            )
            for error in errors
        ]
        connection.executemany(
            "INSERT INTO mistakes(attempt_id, mistake_type, original_text, corrected_text, "
            "explanation, severity, created_at, deck_name, source_card_id, kind, prompt, "
            "due_date, source_key, last_seen_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )

    def get_exercise(self, exercise_id: int) -> Optional[sqlite3.Row]:
        with closing(self.connect()) as connection, connection:
            return connection.execute(
                "SELECT * FROM exercises WHERE id=?", (exercise_id,)
            ).fetchone()

    def get_attempt(self, exercise_id: int) -> Optional[sqlite3.Row]:
        with closing(self.connect()) as connection, connection:
            return connection.execute(
                "SELECT * FROM attempts WHERE exercise_id=? ORDER BY id DESC LIMIT 1", (exercise_id,)
            ).fetchone()

    def list_mistakes(
        self, include_mastered: bool = True, *, limit: int = -1, offset: int = 0
    ) -> List[sqlite3.Row]:
        query = (
            "SELECT m.*, s.deck_name, e.exercise_type, e.prompt_shown FROM mistakes m "
            "JOIN attempts a ON a.id=m.attempt_id "
            "JOIN exercises e ON e.id=a.exercise_id "
            "JOIN sessions s ON s.id=e.session_id "
        )
        params: Tuple[Any, ...] = ()
        if not include_mastered:
            query += "WHERE m.mastered=0 "
        query += "ORDER BY m.mastered, m.created_at DESC, m.id DESC LIMIT ? OFFSET ?"
        with closing(self.connect()) as connection, connection:
            return list(connection.execute(query, (*params, limit, offset)).fetchall())

    def set_mastered(self, mistake_id: int, mastered: bool) -> None:
        with closing(self.connect()) as connection, connection:
            connection.execute(
                "UPDATE mistakes SET mastered=? WHERE id=?",
                (int(mastered), mistake_id),
            )

    def link_anki_note(self, mistake_id: int, note_id: int, card_id: Optional[int]) -> None:
        with closing(self.connect()) as connection, connection:
            connection.execute(
                "UPDATE mistakes SET linked_anki_note_id=?, linked_anki_card_id=? WHERE id=?",
                (note_id, card_id, mistake_id),
            )

    def get_mistake(self, mistake_id: int) -> Optional[sqlite3.Row]:
        with closing(self.connect()) as connection, connection:
            return connection.execute(
                "SELECT m.*, e.exercise_type, e.prompt_shown FROM mistakes m "
                "JOIN attempts a ON a.id=m.attempt_id JOIN exercises e ON e.id=a.exercise_id "
                "WHERE m.id=?", (mistake_id,),
            ).fetchone()


def validate_database(path: Path) -> dict:
    def schema(database):
        objects = database.execute(
            "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
        )
        return [(kind, name, (sql or "").split()) for kind, name, sql in objects]

    with (closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as database,
          closing(sqlite3.connect(":memory:")) as reference):
        reference.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        database.execute("PRAGMA trusted_schema=OFF")
        version = database.execute("PRAGMA user_version").fetchone()[0]
        if version not in (1, 2, 3, SCHEMA_VERSION):
            raise ValueError("Phiên bản dữ liệu BrainExer không được hỗ trợ.")
        Database._run_migrations(reference, 1, version)
        if schema(database) != schema(reference):
            raise ValueError("Cấu trúc dữ liệu BrainExer không hợp lệ.")
        if (database.execute("PRAGMA quick_check").fetchone() != ("ok",)
                or database.execute("PRAGMA foreign_key_check").fetchone() is not None):
            raise ValueError("Dữ liệu BrainExer bị lỗi.")
        return {
            "sessions": database.execute("SELECT COUNT(*) FROM sessions").fetchone()[0],
            "mistakes": database.execute("SELECT COUNT(*) FROM mistakes").fetchone()[0],
        }
