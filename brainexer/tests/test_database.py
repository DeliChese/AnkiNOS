from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from brainexer.db.connection import SCHEMA_VERSION, Database


ROOT = Path(__file__).resolve().parents[1]


def fresh_database(name: str) -> Database:
    path = ROOT / "user_files" / ("pytest_" + name + ".db")
    for candidate in (path, Path(str(path) + "-wal"), Path(str(path) + "-shm")):
        if candidate.exists():
            candidate.unlink()
    return Database(path)


def test_schema_initializes_and_enables_foreign_keys() -> None:
    database = fresh_database("schema")
    with database.connect() as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_session_exercise_attempt_and_mistake_flow() -> None:
    database = fresh_database("flow")
    session_id = database.create_session(1, "English", 10, True, ["fill_blank"], "English", "A2")
    exercise_id = database.insert_exercise(
        session_id, "fill_blank", "I ___ here.", {"cards": []},
        {"question_prompt": "I ___ here.", "correct_answers": ["live"]},
        "openai", "test-model", "1", "req-test",
    )
    attempt_id = database.insert_attempt(exercise_id, "leave", {"summary": "Sai"}, False, 0)
    database.insert_mistakes(attempt_id, [{
        "mistake_type": "word_choice", "original_text": "leave", "corrected_text": "live",
        "explanation": "Sai nghĩa.", "severity": "minor",
    }])
    rows = database.list_mistakes()
    assert len(rows) == 1
    assert rows[0]["deck_name"] == "English"
    database.set_mastered(int(rows[0]["id"]), True)
    assert database.list_mistakes(False) == []


def test_review_schema_snapshot_matches_runtime() -> None:
    review = (ROOT / "02-schema.sql").read_text(encoding="utf-8").rstrip().splitlines()[1:]
    runtime = (ROOT / "db" / "schema.sql").read_text(encoding="utf-8").rstrip().splitlines()
    assert review == runtime


def test_legacy_database_upgrades_without_losing_attempt_links() -> None:
    path = ROOT / "user_files" / "pytest_migration.db"
    path.unlink(missing_ok=True)
    with closing(sqlite3.connect(path)) as connection, connection:
        connection.executescript((ROOT / "db" / "schema.sql").read_text(encoding="utf-8"))
        connection.execute("INSERT INTO sessions VALUES(2,1,'Old deck',1,1,'[]','English','','now',NULL)")
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO exercises VALUES(3,2,NULL,NULL,'recall','generated','What?', '{}','{}',NULL,'openai','x','1','','now')"
            )
        connection.execute(
            "INSERT INTO exercises VALUES(3,2,NULL,NULL,'fill_blank','answered','Old question','{}','{}',NULL,'openai','x','1','','now')"
        )
        connection.execute("INSERT INTO attempts VALUES(4,3,'wrong',0,0,'{}','now')")
        connection.execute("INSERT INTO mistakes VALUES(5,4,'other','wrong','right','why','minor',0,0,123,456,'now',NULL)")

    database = Database(path)
    assert database.get_mistake(5)["linked_anki_note_id"] == 123
    assert database.get_attempt(3)["id"] == 4
    assert database.get_exercise(3)["exercise_type"] == "fill_blank"
    assert database.insert_exercise(2, "recall", "New question", {}, {}, "openai", "x", "1", "") > 3
    with closing(database.connect()) as connection:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
