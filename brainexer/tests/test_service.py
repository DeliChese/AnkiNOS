from __future__ import annotations

from pathlib import Path

import pytest

from brainexer.core.exceptions import InsufficientDataError
from brainexer.core.models import AIResult, CardSource
from brainexer.core.rate_limiter import RateLimiter
from brainexer.core.service import BrainExerService, ServiceConfig
from brainexer.db.connection import Database


ROOT = Path(__file__).resolve().parents[1]


def exercise_data():
    return {
        "question_prompt": "I ___ in Hanoi.", "correct_answers": ["live"], "options": [],
        "hint": "verb", "explanation": "Live means reside.", "target_meaning": "reside",
        "nuance_note": "", "suggested_length": "", "target_words_to_use": [],
        "example_opening": "",
    }


class FakeClient:
    def __init__(self, payload) -> None:
        self.payload = payload

    def create_structured(self, *args, **kwargs) -> AIResult:
        return AIResult(self.payload, "raw secret-adjacent response", "req-1")


def service(name: str, payload):
    path = ROOT / "user_files" / ("pytest_" + name + ".db")
    if path.exists():
        path.unlink()
    database = Database(path)
    database.sync_limits({
        "max_api_calls_per_day": 10, "max_api_calls_per_week": 10,
        "max_exercises_per_day": 10, "max_exercises_per_week": 10,
    })
    instance = BrainExerService(
        database, RateLimiter(database), FakeClient(payload),
        ServiceConfig("openai", "fake", "English", "Vietnamese", "A2", False),
    )
    return database, instance


def source() -> CardSource:
    return CardSource(1, 2, 3, "live", "I live here.", "verb", {"Front": "live"})


def test_generate_and_submit_persists_normalized_payload() -> None:
    database, instance = service("service_ok", {"status": "ok", "reason": "", "data": exercise_data()})
    session_id = database.create_session(3, "English", 1, False, ["fill_blank"], "English", "A2")
    exercise = instance.generate_exercise(session_id, "fill_blank", [source()])
    attempt = instance.submit_objective(exercise, "LIVE")
    assert attempt.is_correct is True
    with database.connect() as connection:
        row = connection.execute("SELECT ai_raw_response, response_request_id FROM exercises").fetchone()
        assert row["ai_raw_response"] is None
        assert row["response_request_id"] == "req-1"


def test_insufficient_data_counts_api_but_releases_exercise_quota() -> None:
    payload = {"status": "insufficient_data", "reason": "Thiếu ngữ cảnh.", "data": {}}
    database, instance = service("service_insufficient", payload)
    session_id = database.create_session(3, "English", 1, False, ["nuance"], "English", "A2")
    with pytest.raises(InsufficientDataError):
        instance.generate_exercise(session_id, "nuance", [source()])
    usage = RateLimiter(database).usage()
    assert usage["api_day"] == 1
    assert usage["exercise_day"] == 0
