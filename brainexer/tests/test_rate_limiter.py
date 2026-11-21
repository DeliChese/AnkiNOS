from __future__ import annotations

from pathlib import Path

import pytest

from brainexer.core.exceptions import RateLimitExceeded
from brainexer.core.rate_limiter import RateLimiter
from brainexer.db.connection import Database


ROOT = Path(__file__).resolve().parents[1]


def configured(name: str, api: int = 2, exercises: int = 1) -> RateLimiter:
    path = ROOT / "user_files" / ("pytest_" + name + ".db")
    for candidate in (path, Path(str(path) + "-wal"), Path(str(path) + "-shm")):
        if candidate.exists():
            candidate.unlink()
    database = Database(path)
    database.sync_limits({
        "max_api_calls_per_day": api,
        "max_api_calls_per_week": api,
        "max_exercises_per_day": exercises,
        "max_exercises_per_week": exercises,
    })
    return RateLimiter(database)


def test_api_reservations_are_counted_atomically() -> None:
    limiter = configured("rate_api", api=2, exercises=2)
    limiter.reserve("one", include_exercise=False)
    limiter.finish("one", api_succeeded=True)
    limiter.reserve("two", include_exercise=False)
    limiter.finish("two", api_succeeded=False)
    with pytest.raises(RateLimitExceeded):
        limiter.reserve("three", include_exercise=False)
    assert limiter.usage()["api_day"] == 2


def test_cancelled_exercise_does_not_consume_exercise_quota() -> None:
    limiter = configured("rate_exercise", api=5, exercises=1)
    limiter.reserve("insufficient", include_exercise=True)
    limiter.finish("insufficient", api_succeeded=True, exercise_created=False)
    limiter.reserve("real", include_exercise=True)
    limiter.finish("real", api_succeeded=True, exercise_created=True)
    with pytest.raises(RateLimitExceeded):
        limiter.reserve("extra", include_exercise=True)
    assert limiter.usage()["exercise_day"] == 1
