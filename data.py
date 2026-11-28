"""Read-only collection queries. This module deliberately has no Qt imports."""

from __future__ import annotations

from datetime import date, datetime, timedelta
import html
import re
from typing import Any

_AGGREGATES: dict[str, Any] | None = None

def clear_snapshot_cache() -> None:
    global _AGGREGATES
    _AGGREGATES = None


def quick_snapshot(col: Any, *, due_tree: Any = None, revision: int | None = None) -> dict[str, Any]:
    """Use live scheduler counts and already available aggregates on startup."""
    return collect_snapshot(col, due_tree=due_tree, revision=revision, _bootstrap=True)


def pending_snapshot(today: date | None = None, decks: list[dict] | None = None) -> dict[str, Any]:
    return {
        "today": today.isoformat() if today else None,
        "days": {},
        "decks": decks or [],
        "history_start_year": today.year if today else None,
        "history_loaded_years": [],
        "due": None if decks is None else sum(d["new"] + d["learn"] + d["review"] for d in decks),
        "total_cards": None,
        "trends": {},
        "stats": {
            "retention": None, "true_retention": None, "correct": 0, "tested": 0,
            "pace": None, "milliseconds": 0, "reviews": 0, "streak": 0,
        },
        "partial": True,
    }


def _deck_records(tree: Any, counts: dict | None = None, filtered_counts: dict | None = None,
                  retention: dict | None = None) -> list[dict]:
    retention = retention or {}

    def build(node: Any, depth: int, parent_id: str | None = None, parent_name: str = "") -> dict:
        deck_id = int(node.deck_id)
        full_name = f"{parent_name}::{node.name}" if parent_name else node.name
        children = [build(child, depth + 1, str(deck_id), full_name) for child in node.children]
        tested, passed = retention.get(deck_id, (0, 0))
        tested += sum(child["tested"] for child in children)
        passed += sum(child["passed"] for child in children)
        gathered = 0
        if node.filtered:
            gathered = None if filtered_counts is None else filtered_counts.get(deck_id, 0)
        return {
            "id": str(deck_id), "name": node.name, "full_name": full_name,
            "new": int(node.new_count), "learn": int(node.learn_count),
            "review": int(node.review_count), "filtered": bool(node.filtered),
            "children": children, "depth": depth, "parent_id": parent_id,
            "total": None if counts is None else counts.get(deck_id, 0) + sum(child["total"] for child in children),
            "gathered": gathered,
            "tested": tested, "passed": passed,
            "retention": round(passed * 100 / tested, 1) if tested else None,
        }

    return [build(node, 0) for node in tree.children]


def _pace_per_min(reviews: int, milliseconds: int) -> float | None:
    """Realistic study speed in reviews/minute without exploding on tiny samples.

    Floors active time at 1 minute so studying a handful of cards (e.g. 10 cards
    in 40 seconds) never extrapolates into hundreds or thousands of cards/hour.
    """
    if reviews <= 0:
        return None
    minutes = max(1.0, max(0, milliseconds) / 60_000)
    return round(reviews / minutes, 1)


def metric_change(current: float | int | None, previous: float | int | None, comparison: str) -> dict[str, Any]:
    # A zero baseline cannot produce a meaningful relative percentage.
    change = None if current is None or previous is None or previous == 0 else round((current - previous) / previous * 100, 1)
    return {"current": current, "previous": previous, "percent": change, "comparison": comparison}


def collect_snapshot(col: Any, *, due_tree: Any = None, revision: int | None = None,
                     review_only: bool = False, _bootstrap: bool = False) -> dict[str, Any]:
    global _AGGREGATES
    cutoff = int(col.sched.day_cutoff)
    # Anki days end at the configured rollover, rather than at midnight.
    end = datetime.fromtimestamp(cutoff)
    today = (end - timedelta(days=1)).date()
    rollover = end.hour
    offset = f"-{rollover} hours"
    # Combine operation hooks with SQLite's write counter. This also catches
    # edits by plugins that write directly without a CollectionOp notification.
    cached = _AGGREGATES if _AGGREGATES and _AGGREGATES['col'] is col else None
    can_reuse = bool(cached and cached['cutoff'] == cutoff and cached['revision'] == revision)
    stamp = (revision, int(col.db.scalar('SELECT total_changes()'))) if can_reuse or not _bootstrap else None
    unchanged = bool(can_reuse and cached['stamp'] == stamp)
    if _bootstrap and not unchanged:
        tree = due_tree if due_tree is not None else col.sched.deck_due_tree()
        return pending_snapshot(today, _deck_records(tree))
    incremental = bool(cached and review_only and not unchanged
                       and 0 <= cutoff - cached['cutoff'] <= 25 * 3600
                       and rollover == cached['rollover']
                       and revision is not None and revision != cached['revision'])
    # Load this year's heatmap plus the 60 days needed by the comparisons.
    # Older years remain available on demand instead of delaying first paint.
    history_start = min(today.replace(month=1, day=1), today-timedelta(days=59)).isoformat()
    refresh_day = min(cached['today'], today.isoformat()) if incremental else history_start
    start_ms = int(datetime.combine(datetime.fromisoformat(refresh_day).date(), datetime.min.time()).replace(hour=rollover).timestamp()*1000)
    # Answering cards only rescans the current day (including rollover).
    daily = [] if unchanged else col.db.all(
        """SELECT date(id / 1000, 'unixepoch', 'localtime', ?),
                  count(*), coalesce(sum(time), 0),
                  sum(CASE WHEN ease > 1 THEN 1 ELSE 0 END),
                  sum(CASE WHEN type = 1 OR (type = 3 AND lastIvl > 0) THEN 1 ELSE 0 END),
                  sum(CASE WHEN (type = 1 OR (type = 3 AND lastIvl > 0)) AND ease > 1 THEN 1 ELSE 0 END)
           FROM revlog WHERE ease > 0 AND type < 4 AND id >= ? AND id < ?
           GROUP BY 1 ORDER BY 1""",
        offset, start_ms, cutoff * 1000,
    )
    days = dict(cached['days']) if unchanged else {
        **({key:value for key,value in cached['days'].items() if key < refresh_day} if incremental else {}),
        **{
        date: {"reviews": int(count), "milliseconds": int(ms), "correct": int(correct or 0),
               "tested": int(tested or 0), "passed": int(passed or 0)}
        for date, count, ms, correct, tested, passed in daily if date and date <= today.isoformat()
        },
    }
    today_data = days.get(today.isoformat(), {"reviews": 0, "milliseconds": 0, "correct": 0, "tested": 0, "passed": 0})
    tested = int(today_data.get("tested", 0))
    passed = int(today_data.get("passed", 0))
    correct = int(today_data.get("correct", 0))
    # A streak remains active before the first review today if yesterday was studied.
    cursor = today if today_data["reviews"] else today - timedelta(days=1)
    streak = cached['streak'] if unchanged else 0
    while not unchanged and days.get(cursor.isoformat(), {}).get("reviews", 0):
        streak += 1
        cursor -= timedelta(days=1)
    if not unchanged and cursor.isoformat() < history_start:
        # Continue a long streak with indexed existence probes, without
        # grouping every historical review just to detect missing days. Local
        # date boundaries preserve Anki rollover, including DST transitions.
        clock = f' {rollover:02d}:00:00'
        streak += int(col.db.scalar(
            """WITH RECURSIVE chain(day, n) AS (
                VALUES (?, 0)
                UNION ALL SELECT date(day, '-1 day'), n+1 FROM chain
                WHERE EXISTS (SELECT 1 FROM revlog WHERE
                    id >= cast(strftime('%s', date(day, '-1 day') || ?, 'utc') AS integer)*1000
                    AND id < cast(strftime('%s', day || ?, 'utc') AS integer)*1000
                    AND ease > 0 AND type < 4)
            ) SELECT max(n) FROM chain""",
            (cursor+timedelta(days=1)).isoformat(), clock, clock))

    first_day = cached['first_day'] if unchanged or incremental else col.db.scalar(
        "SELECT date(min(id)/1000, 'unixepoch', 'localtime', ?) FROM revlog WHERE ease>0 AND type<4", offset)
    loaded_years = set(cached['loaded_years']) if unchanged or incremental else set()
    loaded_years.add(today.year)

    if unchanged:
        filtered_counts = cached['filtered_counts']
        moved_counts = []
    else:
        moved_counts = col.db.all("SELECT did, odid, count(*) FROM cards WHERE odid != 0 GROUP BY 1, 2")
        filtered_counts = {}
        for active_id, _, count in moved_counts:
            filtered_counts[active_id] = filtered_counts.get(active_id, 0) + count
    if unchanged or incremental:
        counts = cached['counts']
    else:
        # Physical deck totals use Anki's covering scheduler index. Only
        # filtered cards need the original-deck adjustment.
        counts = dict(col.db.all("SELECT did, count(*) FROM cards GROUP BY did"))
        for active_id, original_id, count in moved_counts:
            counts[active_id] -= count
            counts[original_id] = counts.get(original_id, 0) + count
    today_start_ms = int((end - timedelta(days=1)).timestamp() * 1000)
    deck_retention = cached['retention'] if unchanged else {
        int(did): (int(total), int(passed_cnt))
        for did, total, passed_cnt in col.db.all(
            """SELECT CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END,
                      count(*), sum(CASE WHEN r.ease > 1 THEN 1 ELSE 0 END)
               FROM revlog r JOIN cards c ON c.id = r.cid
               WHERE r.id >= ? AND r.id < ? AND r.ease > 0 AND r.type < 4
               GROUP BY 1""", today_start_ms, cutoff * 1000
        )
    }
    tree = due_tree if due_tree is not None else col.sched.deck_due_tree()
    decks = _deck_records(tree, counts, filtered_counts, deck_retention)
    total_ms = int(today_data["milliseconds"])
    reviews = int(today_data["reviews"])
    pace = _pace_per_min(reviews, total_ms)
    retention = round(correct * 100 / reviews, 1) if reviews else None
    true_retention = round(passed * 100 / tested, 1) if tested else None
    yesterday_data = days.get((today - timedelta(days=1)).isoformat(), {"reviews": 0, "correct": 0})
    yesterday_reviews_full = int(yesterday_data.get("reviews", 0))
    yesterday_correct_full = int(yesterday_data.get("correct", 0))
    previous_retention = round(yesterday_correct_full * 100 / yesterday_reviews_full, 1) if yesterday_reviews_full else None
    # Compare partial today with the same local clock time yesterday, not a full day.
    yesterday_start = (end - timedelta(days=2)).timestamp() * 1000
    yesterday_now = (datetime.now() - timedelta(days=1)).timestamp() * 1000
    previous_reviews, previous_ms = col.db.first(
        "SELECT count(*), coalesce(sum(time), 0) FROM revlog "
        "WHERE id >= ? AND id <= ? AND ease > 0 AND type < 4",
        int(yesterday_start), int(yesterday_now),
    )
    previous_pace = _pace_per_min(int(previous_reviews or 0), int(previous_ms or 0))
    trends = {
        "retention": metric_change(retention, previous_retention, "hôm qua"),
        "pace": metric_change(pace, previous_pace, "cùng giờ hôm qua"),
        "milliseconds": metric_change(total_ms, previous_ms, "cùng giờ hôm qua"),
        "reviews": metric_change(reviews, previous_reviews, "cùng giờ hôm qua"),
    }
    result = {
        "today": today.isoformat(), "days": days, "decks": decks,
        "history_start_year": int(first_day[:4]) if first_day else today.year,
        "history_loaded_years": sorted(loaded_years),
        "due": sum(d["new"] + d["learn"] + d["review"] for d in decks),
        "total_cards": sum(int(c) for c in counts.values()),
        "trends": trends,
        "stats": {"retention": retention, "true_retention": true_retention,
                  "correct": correct, "tested": tested,
                  "pace": pace, "milliseconds": total_ms, "reviews": reviews,
                  "streak": streak},
    }
    if _bootstrap:
        result["partial"] = False
        return result
    # Store only read-only aggregates, never the UI payload/settings. A new
    # payload and live scheduler counts are returned even on a cache hit.
    _AGGREGATES = {'col':col, 'stamp':stamp, 'revision':revision, 'cutoff':cutoff, 'rollover':rollover, 'today':today.isoformat(),
                   'days':days, 'counts':counts, 'filtered_counts':filtered_counts, 'retention':deck_retention,
                   'loaded_years':loaded_years, 'first_day':first_day, 'streak':streak}
    return result


def collect_history_year(col: Any, year: int, *, revision: int | None = None) -> dict[str, Any]:
    """Read a requested heatmap year using revlog's primary-key range index."""
    rollover = datetime.fromtimestamp(col.sched.day_cutoff).hour
    start = int(datetime(year,1,1,rollover).timestamp()*1000)
    end = int(datetime(year+1,1,1,rollover).timestamp()*1000)
    rows = col.db.all(
        """SELECT date(id/1000,'unixepoch','localtime',?), count(*), coalesce(sum(time),0),
                  sum(CASE WHEN ease>1 THEN 1 ELSE 0 END),
                  sum(CASE WHEN type=1 OR (type=3 AND lastIvl>0) THEN 1 ELSE 0 END),
                  sum(CASE WHEN (type=1 OR (type=3 AND lastIvl>0)) AND ease>1 THEN 1 ELSE 0 END)
           FROM revlog WHERE id>=? AND id<? AND ease>0 AND type<4 GROUP BY 1""",
        f'-{rollover} hours', start, end)
    days = {date:{'reviews':int(count),'milliseconds':int(ms),'correct':int(correct or 0),
                  'tested':int(tested or 0),'passed':int(passed or 0)}
            for date,count,ms,correct,tested,passed in rows if date}
    cached = _AGGREGATES
    if cached and cached['col'] is col and cached['revision'] == revision:
        # Copy on write: an already-delivered snapshot must not change beneath
        # a queued WebView serialization or an older reader.
        cached['days'] = {**{key:value for key,value in cached['days'].items() if not key.startswith(f'{year}-')}, **days}
        cached['loaded_years'] = cached['loaded_years'] | {year}
    return {'year':year,'days':days}


def overview_base(col: Any) -> dict[str, Any]:
    """Immediate metadata/queue, without scanning cards or review history."""
    from anki.utils import strip_html

    deck = col.decks.current()
    raw_description = deck.get("desc", "")
    if deck.get("md"):
        raw_description = col.render_markdown(raw_description)
    raw_description = re.sub(r"<(?:script|style)\b[^>]*>.*?</(?:script|style)>", "", raw_description, flags=re.S | re.I)
    raw_description = re.sub(r"<br\s*/?>|</(?:p|div|li|h[1-6])>", "\n", raw_description, flags=re.I)
    new, learn, review = (int(value) for value in col.sched.counts())
    return {"id": str(deck["id"]), "name": deck["name"].split("::")[-1], "full_name": deck["name"],
            "description": html.unescape(strip_html(raw_description)).strip(), "filtered": bool(deck.get("dyn")),
            "new": new, "learn": learn, "review": review, "available": new+learn+review,
            "total": None, "children": 0, "has_buried": False, "today_reviews": None,
            "today_milliseconds": None, "retention": None, "partial": True}


def collect_overview_snapshot(col: Any) -> dict[str, Any]:
    """The selected deck's real queue and review totals, with no heatmap data."""
    snapshot = overview_base(col)
    deck = col.decks.current()
    did = int(deck["id"])
    ids = col.decks.deck_and_child_ids(did)
    placeholders = ",".join(f"?{index}" for index in range(1, len(ids) + 1))
    # Count filtered cards under their original deck; also include a filtered
    # deck's currently gathered cards when the filtered deck itself is selected.
    scope = f"(c.did IN ({placeholders}) OR (c.odid != 0 AND c.odid IN ({placeholders})))"
    cutoff = datetime.fromtimestamp(col.sched.day_cutoff)
    start = int((cutoff - timedelta(days=1)).timestamp() * 1000)
    total = int(col.db.scalar(
        f"""SELECT
           (SELECT count(*) FROM cards WHERE did IN ({placeholders}))
           + (SELECT count(*) FROM cards WHERE odid != 0
              AND odid IN ({placeholders}) AND did NOT IN ({placeholders}))""",
        *ids,
    ))
    reviews, milliseconds, correct = col.db.first(
        f"SELECT count(*), coalesce(sum(r.time),0), coalesce(sum(CASE WHEN r.ease>1 THEN 1 ELSE 0 END),0) "
        f"FROM revlog r CROSS JOIN cards c ON c.id=r.cid "
        f"WHERE {scope} AND r.id>=? AND r.id<? AND r.ease>0 AND r.type<4",
        *ids, start, int(cutoff.timestamp()*1000),
    )
    reviews_int = int(reviews or 0)
    correct_int = int(correct or 0)
    snapshot.update({
        "total": total, "children": len(ids)-1, "has_buried": bool(col.sched.have_buried()),
        "today_reviews": reviews_int, "today_milliseconds": int(milliseconds or 0),
        "retention": round(correct_int*100/reviews_int,1) if reviews_int else None,
        "partial": False,
    })
    return snapshot
