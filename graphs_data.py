"""Read Anki's native statistics graph data without recreating its scheduler logic.

Anki's Svelte graphs dialog and this add-on use the same Rust graphs backend.
This adapter is deliberately read-only and can run in a QueryOp worker.
"""
from __future__ import annotations

from typing import Any

MAX_SEARCH_LENGTH = 1000


def _deck_search_query(col: Any, deck_name: str) -> str:
    """Build an Anki search query targeting a deck and its children."""
    try:
        from anki.collection import SearchNode

        return str(col.build_search_string(SearchNode(deck=deck_name)))
    except Exception:
        escaped = deck_name.replace("\\", "\\\\").replace('"', '\\"')
        return f'"deck:{escaped}"'


def _deck_list(col: Any) -> list[dict[str, str]]:
    """Return all decks (including subdecks and filtered decks) sorted by name."""
    try:
        entries = col.decks.all_names_and_ids(include_filtered=True)
    except TypeError:
        entries = col.decks.all_names_and_ids()
    items = [{"id": str(entry.id), "name": str(entry.name)} for entry in entries]
    items.sort(key=lambda item: item["name"].casefold())
    return items


def collect_native_graphs(
    col: Any,
    scope: str = "deck",
    days: int = 365,
    *,
    search: str | None = None,
    deck_id: int | None = None,
) -> dict[str, Any]:
    """Return all native graph categories as regular JSON-compatible values.

    GraphsRequest.days=0 requests all history in Anki.
    ``scope`` remains strictly validated for backward compatibility; optional
    ``search`` (Anki card filter syntax) and ``deck_id`` allow filtering cards
    and selecting any deck just like Anki's native Statistics dialog.
    """
    if scope not in {"deck", "collection"}:
        raise ValueError("Phạm vi thống kê không hợp lệ.")
    if type(days) is not int or days not in {0, 365}:
        raise ValueError("Khoảng thời gian thống kê không hợp lệ.")
    if search is not None:
        if not isinstance(search, str) or len(search) > MAX_SEARCH_LENGTH:
            raise ValueError("Bộ lọc tìm kiếm thẻ không hợp lệ.")
        search = search.strip()

    from google.protobuf.json_format import MessageToDict

    if not hasattr(col._backend, "graphs"):
        raise RuntimeError("Phiên bản Anki này chưa hỗ trợ dữ liệu đồ thị gốc.")

    current_did = int(col.decks.get_current_id())
    resolved_did = current_did
    if deck_id is not None:
        if type(deck_id) is not int or deck_id <= 0 or not col.decks.get(deck_id, default=False):
            raise ValueError("Bộ thẻ được chọn không tồn tại.")
        resolved_did = deck_id

    current_deck = col.decks.get(resolved_did, default=False)
    deck_name = str(current_deck["name"]) if current_deck else ""

    if search is not None:
        effective_search = search
    elif scope == "collection":
        effective_search = ""
    elif deck_id is not None and deck_id != current_did and deck_name:
        effective_search = _deck_search_query(col, deck_name)
    else:
        effective_search = "deck:current"

    response = col._backend.graphs(
        search=effective_search,
        days=days,
    )
    calendar_days = collect_calendar_days(
        col,
        scope,
        search=effective_search,
        deck_id=resolved_did,
    )
    return {
        "scope": scope,
        "days": days,
        "search": effective_search,
        "deck_id": str(resolved_did),
        "deck_name": deck_name,
        "decks": _deck_list(col),
        "calendar_days": calendar_days,
        "data": MessageToDict(response, preserving_proto_field_name=True),
        "metrics": collect_scope_metrics(
            col,
            scope,
            search=effective_search,
            deck_id=resolved_did,
        ),
    }


def _matching_card_filter(
    col: Any,
    scope: str,
    *,
    search: str | None = None,
    deck_id: int | None = None,
) -> tuple[str, list[Any]] | None:
    """Return a SQL subquery filtering ``cid`` to cards matching the stats scope/search."""
    query = search.strip() if isinstance(search, str) else None
    if query == "":
        return ("SELECT id FROM cards", [])
    if query is None or query == "deck:current":
        if scope == "collection" and query is None:
            return ("SELECT id FROM cards", [])
        target_did = deck_id if deck_id is not None else int(col.decks.get_current_id())
        ids = [int(i) for i in col.decks.deck_and_child_ids(target_did)]
        if not ids:
            return None
        joined = ",".join(str(i) for i in ids)
        return (f"SELECT id FROM cards WHERE did IN ({joined}) OR odid IN ({joined})", [])

    card_ids = [int(cid) for cid in col.find_cards(query)]
    if not card_ids:
        return ("SELECT id FROM cards WHERE 0", [])
    joined = ",".join(str(cid) for cid in card_ids)
    return (f"SELECT id FROM cards WHERE id IN ({joined})", [])


def collect_calendar_days(
    col: Any,
    scope: str,
    *,
    search: str | None = None,
    deck_id: int | None = None,
) -> dict[str, int]:
    """Return full-history daily review counts (YYYY-MM-DD -> count) for the active scope/filter.

    Allows the Calendar (Lịch) card to switch smoothly across all years even
    when the main graphs request is scoped to 12 months (days=365).
    """
    try:
        from datetime import datetime, timedelta

        cutoff = int(col.sched.day_cutoff)
        end = datetime.fromtimestamp(cutoff)
        today = (end - timedelta(days=1)).date().isoformat()
        rollover = end.hour
        card_filter = _matching_card_filter(col, scope, search=search, deck_id=deck_id)
        if card_filter is None:
            return {}
        cards_sql, _params = card_filter
        rows = col.db.all(
            f"""SELECT date(id / 1000, 'unixepoch', 'localtime', ?), count(*)
                FROM revlog
                WHERE ease > 0 AND type < 4 AND cid IN ({cards_sql})
                GROUP BY 1 ORDER BY 1""",
            f"-{rollover} hours",
        )
        return {
            str(day): int(count)
            for day, count in rows
            if day and str(day) <= today and int(count or 0) > 0
        }
    except Exception:  # pragma: no cover - older Anki builds
        return {}


def collect_scope_metrics(
    col: Any,
    scope: str,
    *,
    search: str | None = None,
    deck_id: int | None = None,
) -> dict[str, Any] | None:
    """Daily review aggregates for the same cards the native graphs describe.

    The summary cards used to mix the native (deck-scoped) numbers with
    collection-wide trends, so the sparklines, trends and values disagreed.
    This reads the last 60 Anki days of revlog restricted to the selected
    scope / deck / search filter and to cards that still exist, exactly
    as Anki's own search-based graphs do. Returns None when unavailable so
    the UI can fall back to the native data alone.
    """
    try:
        from datetime import datetime, time, timedelta

        cutoff = int(col.sched.day_cutoff)
        end = datetime.fromtimestamp(cutoff)
        today = (end - timedelta(days=1)).date()
        rollover = end.hour
        first = today - timedelta(days=59)
        start_ms = int(datetime.combine(first, time.min).replace(hour=rollover).timestamp() * 1000)
        card_filter = _matching_card_filter(col, scope, search=search, deck_id=deck_id)
        if card_filter is None:
            return None
        cards_sql, _params = card_filter
        rows = col.db.all(
            f"""SELECT date(id / 1000, 'unixepoch', 'localtime', ?),
                       count(*), coalesce(sum(time), 0),
                       sum(CASE WHEN type = 1 THEN 1 ELSE 0 END),
                       sum(CASE WHEN type = 1 AND ease > 1 THEN 1 ELSE 0 END)
                FROM revlog
                WHERE ease > 0 AND type < 4 AND id >= ? AND cid IN ({cards_sql})
                GROUP BY 1 ORDER BY 1""",
            f"-{rollover} hours", start_ms,
        )
        days = {
            date: {"reviews": int(count), "milliseconds": int(ms),
                   "tested": int(tested or 0), "passed": int(passed or 0)}
            for date, count, ms, tested, passed in rows
            if date and date <= today.isoformat()
        }
        # Partial today is compared with the same clock time yesterday.
        yesterday_start = int((end - timedelta(days=2)).timestamp() * 1000)
        yesterday_now = int((datetime.now() - timedelta(days=1)).timestamp() * 1000)
        reviews, millis = col.db.first(
            f"""SELECT count(*), coalesce(sum(time), 0) FROM revlog
                WHERE id >= ? AND id <= ? AND ease > 0 AND type < 4 AND cid IN ({cards_sql})""",
            yesterday_start, yesterday_now,
        )
        return {
            "today": today.isoformat(),
            "days": days,
            "previous": {"reviews": int(reviews or 0), "milliseconds": int(millis or 0)},
        }
    except Exception:  # pragma: no cover - older Anki builds
        return None
