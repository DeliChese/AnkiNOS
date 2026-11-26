"""Pure-Python Smart Daily Memory Scheduler. No Qt imports."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
import html
import json
import math
import re
from typing import Any

DEFAULT_DAILY_CAP = 40
MIN_DAILY_CAP = 1
MAX_DAILY_CAP = 2000
DEFAULT_INITIAL_WINDOW = 14
MAX_EXPANDED_WINDOW = 365
DEFAULT_SAFE_R = 0.78
DEFAULT_FSRS_DECAY = 0.5
HORIZON_DISPLAY_DAYS = 45
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class ScheduledCard:
    card_id: int
    note_id: int
    deck_id: int
    deck_name: str
    queue: int  # 2 = review, 3 = day-learn
    due: int  # raw Anki day index (effective due, using odue when filtered)
    due_offset: int  # due - sched_today (negative = overdue, 0 = today, positive = future)
    ivl: int
    reps: int
    lapses: int
    odid: int
    first_studied_day: str  # YYYY-MM-DD
    last_review_day: str  # YYYY-MM-DD
    stability: float
    difficulty: float | None
    decay: float
    memory_model: str  # "fsrs" | "sm2"
    preview: str = ""

    @property
    def movable(self) -> bool:
        return self.queue == 2 and self.odid == 0 and self.due_offset < 0


def fsrs_factor(decay: float) -> float:
    safe_decay = max(0.05, min(2.0, float(decay)))
    return (0.9 ** (-1.0 / safe_decay)) - 1.0


def compute_retrievability(elapsed_days: float, stability: float, decay: float = DEFAULT_FSRS_DECAY) -> float:
    """FSRS power-law forgetting curve (also used with SM-2 ivl fallback)."""
    elapsed = max(0.0, float(elapsed_days))
    stab = max(0.1, float(stability))
    safe_decay = max(0.05, min(2.0, float(decay)))
    factor = fsrs_factor(safe_decay)
    value = (1.0 + factor * (elapsed / stab)) ** (-safe_decay)
    return max(0.0, min(1.0, value))


def parse_memory_state(raw_data: str | None, ivl: int, factor_permille: int) -> tuple[float, float | None, float, str]:
    """Extract FSRS (stability, difficulty, decay) from cards.data JSON or estimate from SM-2."""
    if raw_data:
        try:
            payload = json.loads(raw_data)
            if isinstance(payload, dict):
                s = payload.get("s")
                if isinstance(s, (int, float)) and s > 0:
                    d = payload.get("d")
                    difficulty = float(d) if isinstance(d, (int, float)) else None
                    decay = payload.get("decay")
                    safe_decay = float(decay) if isinstance(decay, (int, float)) and 0.05 <= decay <= 2.0 else DEFAULT_FSRS_DECAY
                    return max(0.1, float(s)), difficulty, safe_decay, "fsrs"
        except (ValueError, TypeError):
            pass
    # SM-2 fallback: interval in days approximates stability at 90% target retention.
    ease_scale = max(0.75, min(1.35, (factor_permille or 2500) / 2500.0))
    est_stability = max(1.0, float(max(1, ivl)) * (0.9 + 0.1 * ease_scale))
    return est_stability, None, DEFAULT_FSRS_DECAY, "sm2"


def _strip_preview(raw_flds: str | None, limit: int = 90) -> str:
    if not raw_flds:
        return ""
    front = raw_flds.split("\x1f", 1)[0]
    cleaned = html.unescape(TAG_RE.sub(" ", front))
    cleaned = SPACE_RE.sub(" ", cleaned).strip()
    if len(cleaned) > limit:
        return cleaned[: limit - 1].rstrip() + "…"
    return cleaned


def resolve_scope_deck_ids(
    all_decks: dict[int, str],
    scope_mode: str = "all",
    deck_names: list[str] | None = None,
    deck_ids: list[int] | None = None,
    include_children: bool = True,
) -> set[int]:
    """Resolve hierarchical scope selection (all, parent decks, child decks) to deck IDs."""
    if scope_mode == "all":
        return set(all_decks.keys())
    selected_names: set[str] = set()
    if deck_names:
        for name in deck_names:
            if isinstance(name, str) and name:
                selected_names.add(name)
    if deck_ids:
        for did in deck_ids:
            name = all_decks.get(int(did))
            if name:
                selected_names.add(name)
    if not selected_names:
        return set()
    matched: set[int] = set()
    for did, full_name in all_decks.items():
        if full_name in selected_names:
            matched.add(did)
            continue
        if include_children:
            for prefix in selected_names:
                if full_name.startswith(prefix + "::"):
                    matched.add(did)
                    break
    return matched


def card_retrievability_on_offset(card: ScheduledCard, today_date: date, day_offset: int) -> float:
    target_date = today_date + timedelta(days=day_offset)
    try:
        last_date = date.fromisoformat(card.last_review_day)
    except ValueError:
        last_date = today_date - timedelta(days=max(1, card.ivl))
    elapsed = max(0, (target_date - last_date).days)
    return compute_retrievability(elapsed, card.stability, card.decay)


def _card_urgency(card: ScheduledCard, today_date: date) -> tuple[float, float, float]:
    r_now = card_retrievability_on_offset(card, today_date, 0)
    r_next = card_retrievability_on_offset(card, today_date, 1)
    drop_per_day = max(0.0, r_now - r_next)
    # Higher urgency => needs earlier day (Today or soonest available).
    urgency = (
        0.65 * (1.0 - r_now)
        + 0.35 * min(1.0, drop_per_day * 12.0)
        + 0.15 * (1.0 / max(card.stability, 0.5))
    )
    return urgency, r_now, drop_per_day


def _memory_cost(
    card: ScheduledCard,
    today_date: date,
    r_now: float,
    target_offset: int,
    safe_r: float,
    window: int = DEFAULT_INITIAL_WINDOW,
) -> tuple[float, float]:
    r_target = card_retrievability_on_offset(card, today_date, target_offset)
    memory_loss = max(0.0, r_now - r_target)
    safety_penalty = max(0.0, safe_r - r_target)
    urgent_delay = max(0.0, safe_r - r_now) * (target_offset / max(1, window))
    return 9.0 * memory_loss + 6.0 * safety_penalty + 2.5 * urgent_delay, r_target


def plan_redistribution(
    overdue_cards: list[ScheduledCard],
    existing_loads: dict[int, int],
    today_date: date,
    *,
    daily_cap: int = DEFAULT_DAILY_CAP,
    initial_window: int = DEFAULT_INITIAL_WINDOW,
    safe_r: float = DEFAULT_SAFE_R,
    max_window: int = MAX_EXPANDED_WINDOW,
) -> dict[str, Any]:
    """Compute a deterministic, memory-aware redistribution plan with adaptive window expansion.

    - Prioritizes low-Retrievability / fast-decaying cards into Today or earliest days.
    - Routes durable (high-stability) cards into future days with the lightest due load.
    - Automatically expands the future horizon in 7-day steps whenever backlog exceeds capacity.
    """
    cap = max(MIN_DAILY_CAP, min(MAX_DAILY_CAP, int(daily_cap)))
    window = max(1, int(initial_window))
    movable = [card for card in overdue_cards if card.movable]
    if not movable:
        return {
            "total_movable": 0,
            "daily_cap": cap,
            "initial_window": window,
            "expanded_window": window,
            "window_expanded": False,
            "moves": [],
            "days": [],
            "summary": "Không có thẻ quá hạn cần điều phối.",
        }

    # Step 1: Expand window automatically until free slots cover all movable overdue cards.
    def free_slots(horizon: int) -> int:
        return sum(max(0, cap - existing_loads.get(offset, 0)) for offset in range(0, horizon + 1))

    while free_slots(window) < len(movable) and window < max_window:
        window = min(max_window, window + 7)

    # Edge case: astronomical backlog even beyond max_window — raise effective overflow cap cleanly.
    effective_cap = cap
    if free_slots(window) < len(movable):
        deficit = len(movable) - free_slots(window)
        effective_cap = cap + math.ceil(deficit / (window + 1))

    # Step 2: Rank overdue cards by memory urgency (lowest R & fastest decay first).
    metrics: dict[int, tuple[float, float, float]] = {}
    for card in movable:
        metrics[card.card_id] = _card_urgency(card, today_date)

    ordered = sorted(
        movable,
        key=lambda c: (
            -metrics[c.card_id][0],
            metrics[c.card_id][1],
            c.stability,
            c.due_offset,
            c.card_id,
        ),
    )

    projected = {offset: int(existing_loads.get(offset, 0)) for offset in range(0, window + 1)}
    assignments: dict[int, int] = {}
    by_id = {card.card_id: card for card in ordered}

    for card in ordered:
        _urgency, r_now, _drop = metrics[card.card_id]
        best_offset = 0
        best_cost = float("inf")
        for offset in range(0, window + 1):
            day_load = projected[offset]
            if day_load >= effective_cap:
                continue
            mem_cost, _r_target = _memory_cost(card, today_date, r_now, offset, safe_r, window)
            load_ratio = day_load / max(1, effective_cap)
            distance_tie = offset / max(1, window)
            total_cost = mem_cost + 0.95 * load_ratio + 0.06 * distance_tie
            if total_cost < best_cost - 1e-12:
                best_cost = total_cost
                best_offset = offset
        assignments[card.card_id] = best_offset
        projected[best_offset] += 1

    # Step 3: Local swap refinement — keep exact day loads while ensuring more-urgent cards sit earlier.
    buckets: dict[int, list[int]] = {}
    for cid, offset in assignments.items():
        buckets.setdefault(offset, []).append(cid)

    active_offsets = sorted(buckets.keys())
    for _pass in range(3):
        improved = False
        for i in range(len(active_offsets)):
            d1 = active_offsets[i]
            if not buckets[d1]:
                continue
            for j in range(i + 1, len(active_offsets)):
                d2 = active_offsets[j]
                if not buckets[d2]:
                    continue
                # Pick most durable on earlier day d1, most urgent on later day d2.
                c1_id = min(buckets[d1], key=lambda cid: (metrics[cid][2], -metrics[cid][1], -by_id[cid].stability))
                c2_id = max(buckets[d2], key=lambda cid: (metrics[cid][2], -metrics[cid][1], -by_id[cid].stability))
                c1, c2 = by_id[c1_id], by_id[c2_id]
                r1_now, r2_now = metrics[c1_id][1], metrics[c2_id][1]
                before_cost = (
                    _memory_cost(c1, today_date, r1_now, d1, safe_r, window)[0]
                    + _memory_cost(c2, today_date, r2_now, d2, safe_r, window)[0]
                )
                after_cost = (
                    _memory_cost(c1, today_date, r1_now, d2, safe_r, window)[0]
                    + _memory_cost(c2, today_date, r2_now, d1, safe_r, window)[0]
                )
                if after_cost + 1e-6 < before_cost:
                    buckets[d1].remove(c1_id)
                    buckets[d2].remove(c2_id)
                    buckets[d1].append(c2_id)
                    buckets[d2].append(c1_id)
                    assignments[c1_id] = d2
                    assignments[c2_id] = d1
                    improved = True
        if not improved:
            break

    # Build move list and before/after day distribution.
    moves: list[dict[str, Any]] = []
    min_existing_future = min(
        (existing_loads.get(offset, 0) for offset in range(1, window + 1)),
        default=0,
    )
    for card in ordered:
        target_offset = assignments[card.card_id]
        r_now = metrics[card.card_id][1]
        r_target = card_retrievability_on_offset(card, today_date, target_offset)
        old_date = (today_date + timedelta(days=card.due_offset)).isoformat()
        new_date = (today_date + timedelta(days=target_offset)).isoformat()
        new_due = card.due - card.due_offset + target_offset
        if target_offset == 0:
            reason = f"R thấp ({round(r_now * 100)}%) — ưu tiên ôn hôm nay"
        elif target_offset <= 2 and r_now < 0.82:
            reason = f"R giảm nhanh ({round(r_now * 100)}%) — giữ sát hôm nay"
        elif existing_loads.get(target_offset, 0) <= min_existing_future + 2:
            reason = "Ổn định tốt — dời sang ngày tương lai ít thẻ nhất"
        else:
            reason = f"Cân bằng tải theo trần {cap} thẻ/ngày"
        moves.append({
            "card_id": card.card_id,
            "deck_id": str(card.deck_id),
            "deck_name": card.deck_name,
            "preview": card.preview,
            "first_studied_day": card.first_studied_day,
            "old_due": card.due,
            "new_due": new_due,
            "old_date": old_date,
            "new_date": new_date,
            "target_offset": target_offset,
            "ivl": card.ivl,
            "stability": round(card.stability, 1),
            "r_before": round(r_now * 100, 1),
            "r_target": round(r_target * 100, 1),
            "reason": reason,
        })

    # Determine the furthest day actually used for concise chart display.
    furthest_used = max(assignments.values(), default=0)
    chart_end = max(min(window, 14), furthest_used)
    days_chart = []
    for offset in range(0, chart_end + 1):
        before = int(existing_loads.get(offset, 0))
        after = int(projected.get(offset, before))
        added = after - before
        days_chart.append({
            "offset": offset,
            "date": (today_date + timedelta(days=offset)).isoformat(),
            "before": before,
            "added": added,
            "after": after,
            "cap": cap,
        })

    today_added = sum(1 for item in moves if item["target_offset"] == 0)
    future_added = len(moves) - today_added
    future_days_used = len({item["target_offset"] for item in moves if item["target_offset"] > 0})
    parts = [f"Đề xuất dời {len(moves)} thẻ quá hạn"]
    if today_added:
        parts.append(f"{today_added} thẻ R thấp về Hôm nay")
    if future_added:
        parts.append(f"{future_added} thẻ rải sang {future_days_used} ngày tương lai thưa thẻ")
    if window > initial_window:
        parts.append(f"tự mở rộng cửa sổ lên {window} ngày để giữ trần {cap} thẻ/ngày")

    return {
        "total_movable": len(moves),
        "daily_cap": cap,
        "effective_cap": effective_cap,
        "initial_window": initial_window,
        "expanded_window": window,
        "window_expanded": window > initial_window,
        "today_added": today_added,
        "future_added": future_added,
        "future_days_used": future_days_used,
        "moves": moves,
        "days": days_chart,
        "summary": " · ".join(parts) + ".",
    }


def collect_daily_schedule(
    col: Any,
    *,
    scope_mode: str = "all",
    deck_names: list[str] | None = None,
    deck_ids: list[int] | None = None,
    include_children: bool = True,
    daily_cap: int = DEFAULT_DAILY_CAP,
    horizon_days: int = HORIZON_DISPLAY_DAYS,
    safe_r: float = DEFAULT_SAFE_R,
) -> dict[str, Any]:
    """Read studied day-scheduled cards from Anki and build the Daily Schedule snapshot."""
    cutoff = int(col.sched.day_cutoff)
    sched_today = int(col.sched.today)
    end = datetime.fromtimestamp(cutoff)
    today_date = (end - timedelta(days=1)).date()
    rollover = end.hour
    offset_sql = f"-{rollover} hours"

    all_decks = {
        int(entry.id): entry.name
        for entry in col.decks.all_names_and_ids()
    }
    filtered_deck_ids = {
        int(deck["id"])
        for deck in col.decks.all()
        if deck.get("dyn")
    }
    origin_decks = {did: name for did, name in all_decks.items() if did not in filtered_deck_ids}
    scope_dids = resolve_scope_deck_ids(
        origin_decks,
        scope_mode=scope_mode,
        deck_names=deck_names,
        deck_ids=deck_ids,
        include_children=include_children,
    )

    if not scope_dids:
        empty_plan = plan_redistribution([], {}, today_date, daily_cap=daily_cap, safe_r=safe_r)
        return _empty_schedule_payload(today_date, daily_cap, scope_mode, origin_decks, empty_plan)

    placeholders = ",".join("?" for _ in scope_dids)
    # Only cards that have graduated to day-based queues (2=review, 3=day-learn)
    # AND have at least one real answer in revlog enter the Daily Schedule tab.
    rows = col.db.all(
        f"""SELECT
                c.id,
                c.nid,
                CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END AS home_did,
                c.queue,
                CASE WHEN c.odid != 0 THEN c.odue ELSE c.due END AS eff_due,
                c.ivl,
                c.factor,
                c.reps,
                c.lapses,
                c.odid,
                c.data,
                n.flds,
                date(min(r.id) / 1000, 'unixepoch', 'localtime', ?) AS first_day,
                date(max(r.id) / 1000, 'unixepoch', 'localtime', ?) AS last_day
            FROM cards c
            JOIN notes n ON n.id = c.nid
            JOIN revlog r ON r.cid = c.id AND r.ease > 0 AND r.type < 4
            WHERE c.queue IN (2, 3)
              AND (CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END) IN ({placeholders})
            GROUP BY c.id""",
        offset_sql,
        offset_sql,
        *sorted(scope_dids),
    )

    # Also count cards still waiting for first graduation in origin decks (New + intra-day Learn).
    pending_first = int(col.db.scalar(
        f"""SELECT count(*) FROM cards c
            WHERE c.queue IN (0, 1)
              AND (CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END) IN ({placeholders})""",
        *sorted(scope_dids),
    ) or 0)

    cards: list[ScheduledCard] = []
    overdue: list[ScheduledCard] = []
    today_cards: list[ScheduledCard] = []
    future_by_offset: dict[int, list[ScheduledCard]] = {}
    existing_loads: dict[int, int] = {}

    for row in rows:
        cid, nid, home_did, queue, eff_due, ivl, factor, reps, lapses, odid, raw_data, flds, first_day, last_day = row
        due_offset = int(eff_due) - sched_today
        stability, difficulty, decay, model = parse_memory_state(raw_data, int(ivl or 0), int(factor or 2500))
        card = ScheduledCard(
            card_id=int(cid),
            note_id=int(nid),
            deck_id=int(home_did),
            deck_name=origin_decks.get(int(home_did), all_decks.get(int(home_did), "Bộ thẻ")),
            queue=int(queue),
            due=int(eff_due),
            due_offset=due_offset,
            ivl=int(ivl or 0),
            reps=int(reps or 0),
            lapses=int(lapses or 0),
            odid=int(odid or 0),
            first_studied_day=str(first_day or today_date.isoformat()),
            last_review_day=str(last_day or today_date.isoformat()),
            stability=stability,
            difficulty=difficulty,
            decay=decay,
            memory_model=model,
            preview=_strip_preview(flds),
        )
        cards.append(card)
        if due_offset < 0:
            overdue.append(card)
        elif due_offset == 0:
            today_cards.append(card)
            existing_loads[0] = existing_loads.get(0, 0) + 1
        else:
            future_by_offset.setdefault(due_offset, []).append(card)
            existing_loads[due_offset] = existing_loads.get(due_offset, 0) + 1

    # Order today's cards by lowest retrievability first for best retention.
    today_ranked = sorted(
        today_cards,
        key=lambda c: (card_retrievability_on_offset(c, today_date, 0), c.stability, c.card_id),
    )

    def summarize_group(group: list[ScheduledCard], day_offset: int, *, include_cards: bool = True) -> dict[str, Any]:
        decks_map: dict[str, int] = {}
        cohorts_map: dict[str, int] = {}
        r_values: list[float] = []
        tiers = {"critical": 0, "due": 0, "strong": 0}
        review_count = 0
        learn_count = 0
        items = []
        for card in group:
            r = card_retrievability_on_offset(card, today_date, day_offset)
            r_values.append(r)
            if r < 0.70:
                tiers["critical"] += 1
            elif r < 0.90:
                tiers["due"] += 1
            else:
                tiers["strong"] += 1
            if card.queue == 2:
                review_count += 1
            else:
                learn_count += 1
            decks_map[card.deck_name] = decks_map.get(card.deck_name, 0) + 1
            cohorts_map[card.first_studied_day] = cohorts_map.get(card.first_studied_day, 0) + 1
            if include_cards and len(items) < 60:
                items.append({
                    "card_id": card.card_id,
                    "deck_name": card.deck_name,
                    "preview": card.preview,
                    "first_studied_day": card.first_studied_day,
                    "ivl": card.ivl,
                    "stability": round(card.stability, 1),
                    "retrievability": round(r * 100, 1),
                    "queue": card.queue,
                })
        top_decks = [{"name": k, "count": v} for k, v in sorted(decks_map.items(), key=lambda pair: (-pair[1], pair[0]))[:8]]
        top_cohorts = [{"day": k, "count": v} for k, v in sorted(cohorts_map.items(), key=lambda pair: (-pair[1], pair[0]))[:8]]
        return {
            "count": len(group),
            "review_count": review_count,
            "day_learn_count": learn_count,
            "avg_r": round(sum(r_values) * 100 / len(r_values), 1) if r_values else None,
            "min_r": round(min(r_values) * 100, 1) if r_values else None,
            "tiers": tiers,
            "decks": top_decks,
            "cohorts": top_cohorts,
            "cards": items,
        }

    today_summary = summarize_group(today_ranked, 0, include_cards=True)
    today_summary["date"] = today_date.isoformat()
    today_summary["locked"] = False
    today_summary["card_ids"] = [c.card_id for c in today_ranked]

    # Overdue days breakdown (past dates still holding cards).
    overdue_by_offset: dict[int, list[ScheduledCard]] = {}
    for card in overdue:
        overdue_by_offset.setdefault(card.due_offset, []).append(card)
    overdue_days = []
    for offset in sorted(overdue_by_offset.keys()):
        group = overdue_by_offset[offset]
        day_info = summarize_group(group, 0, include_cards=False)
        day_info.update({
            "offset": offset,
            "date": (today_date + timedelta(days=offset)).isoformat(),
            "days_late": abs(offset),
            "movable_count": sum(1 for c in group if c.movable),
        })
        overdue_days.append(day_info)

    # Future locked days timeline.
    future_days = []
    beyond_count = 0
    for offset in range(1, horizon_days + 1):
        group = future_by_offset.get(offset, [])
        if group:
            ranked_future = sorted(
                group,
                key=lambda c: (card_retrievability_on_offset(c, today_date, offset), c.card_id),
            )
            info = summarize_group(ranked_future, offset, include_cards=True)
        else:
            info = {
                "count": 0, "review_count": 0, "day_learn_count": 0,
                "avg_r": None, "min_r": None, "tiers": {"critical": 0, "due": 0, "strong": 0},
                "decks": [], "cohorts": [], "cards": [],
            }
        info.update({
            "offset": offset,
            "date": (today_date + timedelta(days=offset)).isoformat(),
            "locked": True,
        })
        future_days.append(info)
    for offset, group in future_by_offset.items():
        if offset > horizon_days:
            beyond_count += len(group)

    plan = plan_redistribution(
        overdue,
        existing_loads,
        today_date,
        daily_cap=daily_cap,
        safe_r=safe_r,
    )

    return {
        "today": today_date.isoformat(),
        "sched_today": sched_today,
        "daily_cap": max(MIN_DAILY_CAP, min(MAX_DAILY_CAP, int(daily_cap))),
        "scope_mode": scope_mode,
        "total_tracked": len(cards),
        "pending_first_study": pending_first,
        "overdue": {
            "count": len(overdue),
            "movable_count": sum(1 for c in overdue if c.movable),
            "non_movable_count": sum(1 for c in overdue if not c.movable),
            "days_count": len(overdue_days),
            "days": overdue_days,
        },
        "today_bucket": today_summary,
        "future": {
            "horizon_days": horizon_days,
            "total_in_horizon": sum(d["count"] for d in future_days),
            "beyond_horizon_count": beyond_count,
            "days": future_days,
        },
        "plan": plan,
        "decks": [{"id": str(did), "name": name} for did, name in sorted(origin_decks.items(), key=lambda x: x[1].casefold())],
    }


def _empty_schedule_payload(
    today_date: date,
    daily_cap: int,
    scope_mode: str,
    origin_decks: dict[int, str],
    empty_plan: dict[str, Any],
) -> dict[str, Any]:
    return {
        "today": today_date.isoformat(),
        "sched_today": 0,
        "daily_cap": max(MIN_DAILY_CAP, min(MAX_DAILY_CAP, int(daily_cap))),
        "scope_mode": scope_mode,
        "total_tracked": 0,
        "pending_first_study": 0,
        "overdue": {"count": 0, "movable_count": 0, "non_movable_count": 0, "days_count": 0, "days": []},
        "today_bucket": {
            "date": today_date.isoformat(), "locked": False, "count": 0,
            "review_count": 0, "day_learn_count": 0, "avg_r": None, "min_r": None,
            "tiers": {"critical": 0, "due": 0, "strong": 0}, "decks": [], "cohorts": [], "cards": [], "card_ids": [],
        },
        "future": {"horizon_days": HORIZON_DISPLAY_DAYS, "total_in_horizon": 0, "beyond_horizon_count": 0, "days": []},
        "plan": empty_plan,
        "decks": [{"id": str(did), "name": name} for did, name in sorted(origin_decks.items(), key=lambda x: x[1].casefold())],
    }
