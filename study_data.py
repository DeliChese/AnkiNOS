"""Read-only, bounded learning insights and personal timing estimates."""
from __future__ import annotations

from datetime import datetime, timedelta
from math import ceil
from typing import Any

_cache: dict[str, Any] | None = None
MIN_SAMPLES = 20


def clear_cache() -> None:
    global _cache
    _cache = None


def _boundaries(col: Any) -> tuple[int, int, int]:
    end = datetime.fromtimestamp(col.sched.day_cutoff)
    return tuple(int((end - timedelta(days=days)).timestamp() * 1000) for days in (60, 30, 0))


def _timing(histogram: list[tuple[int, int]]) -> dict[str, Any]:
    total = sum(count for _, count in histogram)
    if total < MIN_SAMPLES:
        return {"samples": total, "median_ms": None, "low_ms": None, "high_ms": None}
    def quantile(fraction: float) -> int:
        target, count = max(1, ceil(total * fraction)), 0
        for seconds, amount in sorted(histogram):
            count += amount
            if count >= target:
                return max(1000, seconds * 1000)
        raise ValueError("Empty timing histogram")
    return {"samples": total, "median_ms": quantile(.5), "low_ms": quantile(.25), "high_ms": quantile(.75)}


def collect_support(col: Any, revision: int = 0) -> dict[str, Any]:
    """60 days for retention comparisons; 30 days for timing and repeated lapses.

    Only actual answers count. Filtered cards belong to their original decks.
    A cached result is scoped to the collection, write counter and Anki day.
    """
    global _cache
    previous, start, end = _boundaries(col)
    key = (id(col), revision, col.db.scalar("SELECT total_changes()"), end)
    if _cache and _cache["col"] is col and _cache["key"] == key:
        return _cache["result"]
    rows = col.db.all("""SELECT CASE WHEN c.odid!=0 THEN c.odid ELSE c.did END,
        sum(CASE WHEN r.id>=? AND r.type=1 THEN 1 ELSE 0 END),
        sum(CASE WHEN r.id>=? AND r.type=1 AND r.ease>1 THEN 1 ELSE 0 END),
        sum(CASE WHEN r.id<? AND r.type=1 THEN 1 ELSE 0 END),
        sum(CASE WHEN r.id<? AND r.type=1 AND r.ease>1 THEN 1 ELSE 0 END)
        FROM revlog r JOIN cards c ON c.id=r.cid
        WHERE r.id>=? AND r.id<? AND r.ease>0 AND r.type<4 GROUP BY 1""",
        start, start, start, start, previous, end)
    repeated = dict(col.db.all("""SELECT did,count(*) FROM (
        SELECT CASE WHEN c.odid!=0 THEN c.odid ELSE c.did END AS did,r.cid
        FROM revlog r JOIN cards c ON c.id=r.cid
        WHERE r.id>=? AND r.id<? AND r.ease=1 AND r.type IN (1,2)
        GROUP BY did,r.cid HAVING count(*)>=3) GROUP BY did""", start, end))
    names = {int(d.id): d.name for d in col.decks.all_names_and_ids()}
    by_name = {name: did for did, name in names.items()}
    totals: dict[int, list[int]] = {}
    for did, current, passed, old, old_passed in rows:
        values = [int(current or 0), int(passed or 0), int(old or 0), int(old_passed or 0), int(repeated.get(did, 0))]
        name = names.get(did)
        if not name:
            continue
        parts = name.split("::")
        # Aggregate by exact hierarchy, never by leaf names.
        for length in range(1, len(parts) + 1):
            ancestor = by_name.get("::".join(parts[:length]))
            if ancestor is not None:
                target = totals.setdefault(ancestor, [0] * 5)
                for index, value in enumerate(values):
                    target[index] += value
    decks = {}
    for did, values in totals.items():
        current, passed, old, old_passed, difficult = values
        current_rate = round(100 * passed / current, 1) if current else None
        old_rate = round(100 * old_passed / old, 1) if old else None
        decks[str(did)] = {"name": names[did], "samples": current, "passed": passed,
            "previous_samples": old, "retention": current_rate, "previous_retention": old_rate,
            "change_points": round(current_rate-old_rate, 1) if current and old else None,
            "repeated_lapses": difficult}
    hist = col.db.all("""SELECT type,cast(time/1000 AS integer),count(*) FROM revlog
        WHERE id>=? AND id<? AND ease>0 AND type<4 AND time>=1000 AND time<=120000
        GROUP BY 1,2""", start, end)
    pooled: dict[int, int] = {}
    kinds = {}
    for kind, label in ((0, "new"), (1, "review"), (2, "learn"), (3, "filtered")):
        bins = [(int(seconds), int(count)) for entry_kind, seconds, count in hist if entry_kind == kind]
        kinds[label] = _timing(bins)
        for seconds, count in bins:
            pooled[seconds] = pooled.get(seconds, 0) + count
    kinds["learn"] = _timing([(int(seconds), int(count)) for kind, seconds, count in hist if kind in {0, 2}])
    result = {"decks": decks, "timing": {"all": _timing(list(pooled.items())), **kinds},
        "period_days": 30, "minimum_samples": MIN_SAMPLES,
        "start": datetime.fromtimestamp(start/1000).isoformat(timespec="minutes"),
        "end": datetime.fromtimestamp(end/1000).isoformat(timespec="minutes"),
        "source": "Lịch sử trả lời 30 ngày trong toàn bộ bộ sưu tập; thời gian nghỉ không được đo trong revlog."}
    _cache = {"col": col, "key": key, "result": result}
    return result


def insight_cards(col: Any, did: int, kind: str) -> list[int]:
    if kind not in {"retention_drop", "repeated_lapses"}:
        raise ValueError("Loại nhận xét không hợp lệ.")
    ids = col.decks.deck_and_child_ids(did)
    placeholders = ",".join("?" for _ in ids)
    _, start, end = _boundaries(col)
    group = "GROUP BY r.cid HAVING count(*)>=3" if kind == "repeated_lapses" else "GROUP BY r.cid"
    types = "(1,2)" if kind == "repeated_lapses" else "(1)"
    return [int(row[0]) for row in col.db.all(f"""SELECT r.cid FROM revlog r JOIN cards c ON c.id=r.cid
        WHERE (CASE WHEN c.odid!=0 THEN c.odid ELSE c.did END) IN ({placeholders})
        AND r.id>=? AND r.id<? AND r.ease=1 AND r.type IN {types} {group}""", *ids, start, end)]
