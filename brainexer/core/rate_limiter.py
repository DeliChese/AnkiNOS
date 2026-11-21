from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple

from .exceptions import RateLimitExceeded
from ..db.connection import Database, utc_now


class RateLimiter:
    def __init__(self, database: Database) -> None:
        self.database = database

    @staticmethod
    def periods(now: Optional[datetime] = None) -> Tuple[str, str]:
        local = now or datetime.now().astimezone()
        day = local.date()
        monday = day - timedelta(days=day.weekday())
        return day.isoformat(), monday.isoformat()

    def reserve(self, request_key: str, include_exercise: bool) -> None:
        local_date, week_start = self.periods()
        with self.database.immediate() as connection:
            limits = {
                row["key"]: int(row["value"])
                for row in connection.execute("SELECT key, value FROM limit_settings")
            }
            self._check(
                connection, "api_call", local_date, week_start,
                limits.get("max_api_calls_per_day", 0),
                limits.get("max_api_calls_per_week", 0),
            )
            if include_exercise:
                self._check(
                    connection, "exercise_generated", local_date, week_start,
                    limits.get("max_exercises_per_day", 0),
                    limits.get("max_exercises_per_week", 0),
                )
            created_at = utc_now()
            connection.execute(
                "INSERT INTO usage_events(request_key, event_type, status, local_date, week_start, created_at) "
                "VALUES(?, 'api_call', 'reserved', ?, ?, ?)",
                (request_key, local_date, week_start, created_at),
            )
            if include_exercise:
                connection.execute(
                    "INSERT INTO usage_events(request_key, event_type, status, local_date, week_start, created_at) "
                    "VALUES(?, 'exercise_generated', 'reserved', ?, ?, ?)",
                    (request_key, local_date, week_start, created_at),
                )

    @staticmethod
    def _check(connection, event_type: str, local_date: str, week_start: str, day_limit: int, week_limit: int) -> None:
        day_count = int(connection.execute(
            "SELECT COUNT(*) FROM usage_events WHERE event_type=? AND local_date=? AND status!='cancelled'",
            (event_type, local_date),
        ).fetchone()[0])
        week_count = int(connection.execute(
            "SELECT COUNT(*) FROM usage_events WHERE event_type=? AND week_start=? AND status!='cancelled'",
            (event_type, week_start),
        ).fetchone()[0])
        label = "lượt gọi AI" if event_type == "api_call" else "bài tập"
        if day_count >= day_limit:
            raise RateLimitExceeded("Đã đạt giới hạn {} {} trong ngày.".format(day_limit, label))
        if week_count >= week_limit:
            raise RateLimitExceeded("Đã đạt giới hạn {} {} trong tuần.".format(week_limit, label))

    def finish(self, request_key: str, api_succeeded: bool, exercise_created: bool = False) -> None:
        with self.database.connect() as connection:
            connection.execute(
                "UPDATE usage_events SET status=? WHERE request_key=? AND event_type='api_call'",
                ("succeeded" if api_succeeded else "failed", request_key),
            )
            connection.execute(
                "UPDATE usage_events SET status=? WHERE request_key=? AND event_type='exercise_generated'",
                ("succeeded" if exercise_created else "cancelled", request_key),
            )

    def usage(self) -> Dict[str, int]:
        local_date, week_start = self.periods()
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT "
                "SUM(CASE WHEN event_type='api_call' AND local_date=? AND status!='cancelled' THEN 1 ELSE 0 END), "
                "SUM(CASE WHEN event_type='api_call' AND week_start=? AND status!='cancelled' THEN 1 ELSE 0 END), "
                "SUM(CASE WHEN event_type='exercise_generated' AND local_date=? AND status!='cancelled' THEN 1 ELSE 0 END), "
                "SUM(CASE WHEN event_type='exercise_generated' AND week_start=? AND status!='cancelled' THEN 1 ELSE 0 END) "
                "FROM usage_events",
                (local_date, week_start, local_date, week_start),
            ).fetchone()
        return {
            "api_day": int(row[0] or 0),
            "api_week": int(row[1] or 0),
            "exercise_day": int(row[2] or 0),
            "exercise_week": int(row[3] or 0),
        }
