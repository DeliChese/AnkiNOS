"""Read-only collection queries. This module deliberately has no Qt imports."""

from __future__ import annotations

from datetime import datetime, timedelta
import html
import re
from typing import Any

_AGGREGATES: dict[str, Any] | None = None

def clear_snapshot_cache() -> None:
    global _AGGREGATES
    _AGGREGATES = None


def metric_change(current: float | int | None, previous: float | int | None, comparison: str) -> dict[str, Any]:
    # A zero baseline cannot produce a meaningful relative percentage.
    change = None if current is None or previous is None or previous == 0 else round((current - previous) / previous * 100, 1)
    return {"current": current, "previous": previous, "percent": change, "comparison": comparison}


def collect_snapshot(col: Any, *, due_tree: Any = None, revision: int | None = None,
                     review_only: bool = False) -> dict[str, Any]:
    global _AGGREGATES
    cutoff = int(col.sched.day_cutoff)
    # Anki days end at the configured rollover, rather than at midnight.
    end = datetime.fromtimestamp(cutoff)
    today = (end - timedelta(days=1)).date()
    rollover = end.hour
    offset = f"-{rollover} hours"
    # Combine operation hooks with SQLite's write counter. This also catches
    # edits by plugins that write directly without a CollectionOp notification.
    stamp = (revision, int(col.db.scalar('SELECT total_changes()')))
    cached = _AGGREGATES if _AGGREGATES and _AGGREGATES['col'] is col else None
    unchanged = bool(cached and cached['stamp'] == stamp and cached['cutoff'] == cutoff)
    incremental = bool(cached and review_only and cached['cutoff'] <= cutoff
                       and (revision is None or revision != cached['revision']))
    # Load this year's heatmap plus the 60 days needed by the comparisons.
    # Older years remain available on demand instead of delaying first paint.
    history_start = min(today.replace(month=1, day=1), today-timedelta(days=59)).isoformat()
    refresh_day = min(cached['today'], today.isoformat()) if incremental else history_start
    start_ms = int(datetime.combine(datetime.fromisoformat(refresh_day).date(), datetime.min.time()).replace(hour=rollover).timestamp()*1000)
    # Answering cards only rescans the current day (including rollover).
    daily = [] if unchanged else col.db.all(
        """SELECT date(id / 1000, 'unixepoch', 'localtime', ?),
                  count(*), coalesce(sum(time), 0),
                  sum(CASE WHEN type = 1 THEN 1 ELSE 0 END),
                  sum(CASE WHEN type = 1 AND ease > 1 THEN 1 ELSE 0 END)
           FROM revlog WHERE ease > 0 AND type < 4 AND id >= ?
           GROUP BY 1 ORDER BY 1""",
        offset, start_ms,
    )
    days = dict(cached['days']) if unchanged else {
        **({key:value for key,value in cached['days'].items() if key < refresh_day} if incremental else {}),
        **{
        date: {"reviews": int(count), "milliseconds": int(ms),
               "tested": int(tested), "passed": int(passed)}
        for date, count, ms, tested, passed in daily if date and date <= today.isoformat()
        },
    }
    start_30 = today - timedelta(days=29)
    recent = [v for k, v in days.items() if start_30.isoformat() <= k <= today.isoformat()]
    tested = sum(v["tested"] for v in recent)
    passed = sum(v["passed"] for v in recent)
    today_data = days.get(today.isoformat(), {"reviews": 0, "milliseconds": 0})
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

    counts = cached['counts'] if unchanged or incremental else dict(col.db.all(
        "SELECT CASE WHEN odid != 0 THEN odid ELSE did END, count(*) FROM cards GROUP BY 1"
    ))
    since = int(datetime.combine(start_30, datetime.min.time()).replace(hour=rollover).timestamp() * 1000)
    deck_retention = cached['retention'] if unchanged else {
        int(did): (int(total), int(passed))
        for did, total, passed in col.db.all(
            """SELECT CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END,
                      count(*), sum(CASE WHEN r.ease > 1 THEN 1 ELSE 0 END)
               FROM revlog r JOIN cards c ON c.id = r.cid
               WHERE r.id >= ? AND r.id < ? AND r.type = 1 AND r.ease > 0
               GROUP BY 1""", since, cutoff * 1000
        )
    }
    tree = due_tree if due_tree is not None else col.sched.deck_due_tree()
    names = cached['names'] if unchanged or incremental else {int(entry.id): entry.name for entry in col.decks.all_names_and_ids()}
    records: dict[int, dict[str, Any]] = {}

    def gather(node: Any) -> None:
        if node.deck_id:
            full_name = names.get(int(node.deck_id), node.name)
            records[int(node.deck_id)] = {
                "id": str(node.deck_id), "name": full_name.split("::")[-1], "full_name": full_name,
                "new": int(node.new_count), "learn": int(node.learn_count),
                "review": int(node.review_count), "filtered": bool(node.filtered), "children": [],
                "depth": full_name.count("::"), "parent_id": None,
            }
        for child in node.children:
            gather(child)

    gather(tree)
    by_name = {record["full_name"]: record for record in records.values()}
    decks = []
    for record in records.values():
        parent = by_name.get(record["full_name"].rpartition("::")[0])
        if parent:
            record["parent_id"] = parent["id"]
            parent["children"].append(record)
        else:
            decks.append(record)

    def aggregate(record: dict[str, Any]) -> None:
        for child in record["children"]:
            aggregate(child)
        children = record["children"]
        own_tested, own_passed = deck_retention.get(int(record["id"]), (0, 0))
        total_tested = own_tested + sum(c["tested"] for c in children)
        total_passed = own_passed + sum(c["passed"] for c in children)
        record.update({
            "total": int(counts.get(int(record["id"]), 0)) + sum(c["total"] for c in children),
            "tested": total_tested, "passed": total_passed,
            "retention": round(total_passed * 100 / total_tested, 1) if total_tested else None,
        })

    for record in decks:
        aggregate(record)
    total_ms = int(today_data["milliseconds"])
    reviews = int(today_data["reviews"])
    pace = round(reviews / (total_ms / 3_600_000)) if total_ms else None
    previous_30 = [v for k, v in days.items()
                   if (today - timedelta(days=59)).isoformat() <= k < start_30.isoformat()]
    previous_tested = sum(v["tested"] for v in previous_30)
    previous_passed = sum(v["passed"] for v in previous_30)
    retention = round(passed * 100 / tested, 1) if tested else None
    previous_retention = round(previous_passed * 100 / previous_tested, 1) if previous_tested else None
    # Compare partial today with the same local clock time yesterday, not a full day.
    yesterday_start = (end - timedelta(days=2)).timestamp() * 1000
    yesterday_now = (datetime.now() - timedelta(days=1)).timestamp() * 1000
    previous_reviews, previous_ms = col.db.first(
        "SELECT count(*), coalesce(sum(time), 0) FROM revlog "
        "WHERE id >= ? AND id <= ? AND ease > 0 AND type < 4",
        int(yesterday_start), int(yesterday_now),
    )
    previous_pace = round(previous_reviews / (previous_ms / 3_600_000)) if previous_ms else None
    trends = {
        "retention": metric_change(retention, previous_retention, "30 ngày trước"),
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
        "stats": {"retention": retention,
                  "pace": pace, "milliseconds": total_ms, "reviews": reviews,
                  "streak": streak, "tested": tested},
    }
    # Store only read-only aggregates, never the UI payload/settings. A new
    # payload and live scheduler counts are returned even on a cache hit.
    stamp = (revision, int(col.db.scalar('SELECT total_changes()')))
    _AGGREGATES = {'col':col, 'stamp':stamp, 'revision':revision, 'cutoff':cutoff, 'today':today.isoformat(),
                   'days':days, 'counts':counts, 'retention':deck_retention, 'names':names,
                   'loaded_years':loaded_years, 'first_day':first_day, 'streak':streak}
    return result


def collect_history_year(col: Any, year: int, *, revision: int | None = None) -> dict[str, Any]:
    """Read a requested heatmap year using revlog's primary-key range index."""
    rollover = datetime.fromtimestamp(col.sched.day_cutoff).hour
    start = int(datetime(year,1,1,rollover).timestamp()*1000)
    end = int(datetime(year+1,1,1,rollover).timestamp()*1000)
    rows = col.db.all(
        """SELECT date(id/1000,'unixepoch','localtime',?), count(*), coalesce(sum(time),0),
                  sum(CASE WHEN type=1 THEN 1 ELSE 0 END),
                  sum(CASE WHEN type=1 AND ease>1 THEN 1 ELSE 0 END)
           FROM revlog WHERE id>=? AND id<? AND ease>0 AND type<4 GROUP BY 1""",
        f'-{rollover} hours', start, end)
    days = {date:{'reviews':int(count),'milliseconds':int(ms),'tested':int(tested),'passed':int(passed)}
            for date,count,ms,tested,passed in rows if date}
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
    placeholders = ",".join("?" for _ in ids)
    # Count filtered cards under their original deck; also include a filtered
    # deck's currently gathered cards when the filtered deck itself is selected.
    scope = f"(c.did IN ({placeholders}) OR c.odid IN ({placeholders}))"
    args = [*ids, *ids]
    cutoff = datetime.fromtimestamp(col.sched.day_cutoff)
    start = int((cutoff - timedelta(days=1)).timestamp() * 1000)
    since = int((cutoff - timedelta(days=30)).timestamp() * 1000)
    total = int(col.db.scalar(f"SELECT count(*) FROM cards c WHERE {scope}", *args))
    reviews, milliseconds = col.db.first(
        f"SELECT count(*), coalesce(sum(r.time),0) FROM revlog r JOIN cards c ON c.id=r.cid "
        f"WHERE {scope} AND r.id>=? AND r.id<? AND r.ease>0 AND r.type<4",
        *args, start, int(cutoff.timestamp()*1000),
    )
    tested, passed = col.db.first(
        f"SELECT count(*), coalesce(sum(CASE WHEN r.ease>1 THEN 1 ELSE 0 END),0) "
        f"FROM revlog r JOIN cards c ON c.id=r.cid WHERE {scope} "
        "AND r.id>=? AND r.id<? AND r.type=1 AND r.ease>0",
        *args, since, int(cutoff.timestamp()*1000),
    )
    snapshot.update({
        "total": total, "children": len(ids)-1, "has_buried": bool(col.sched.have_buried()),
        "today_reviews": int(reviews), "today_milliseconds": int(milliseconds),
        "retention": round(passed*100/tested,1) if tested else None,
        "partial": False,
    })
    return snapshot
