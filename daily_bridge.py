"""Anki collection bridge for the Smart Daily Memory Scheduler (Lịch ôn)."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import time
from typing import TYPE_CHECKING, Any, Callable, Generic, TypeVar

from .daily_scheduler import (
    DEFAULT_DAILY_CAP,
    HORIZON_DISPLAY_DAYS,
    collect_daily_schedule,
    resolve_scope_deck_ids,
)
from .daily_store import DailyStore, clean_daily_config
from .i18n import translate as _tr_text

if TYPE_CHECKING:
    from anki.collection import OpChanges

FILTERED_DECK_NAME = "AnkiNOS — Lịch hôm nay"
LEGACY_FILTERED_DECK_NAMES = ("AnkiNOS::Lịch hôm nay",)
LEGACY_EMPTY_PARENT_NAME = "AnkiNOS"
MAX_SESSION_CARDS = 1500
T = TypeVar("T")


@dataclass
class _CollectionResult(Generic[T]):
    changes: OpChanges
    data: T


def _merge_changes(changes: OpChanges | None, result: OpChanges | None) -> None:
    if changes is not None and result is not None:
        changes.MergeFrom(result)


def _update_cards_with_undo(col: Any, cards: list[Any], label: str, changes: OpChanges | None) -> None:
    undo_entry = None
    if callable(getattr(col, "add_custom_undo_entry", None)):
        undo_entry = col.add_custom_undo_entry(label)

    if callable(getattr(col, "update_cards", None)):
        _merge_changes(changes, col.update_cards(cards))
    else:
        for card in cards:
            _merge_changes(changes, col.update_card(card))

    if undo_entry is not None and callable(getattr(col, "merge_undo_entries", None)):
        _merge_changes(changes, col.merge_undo_entries(undo_entry))


def scope_label_for(config: dict[str, Any]) -> str:
    if config.get("scope_mode") != "decks":
        return "Toàn bộ bộ sưu tập"
    names = config.get("deck_names") or []
    if not names:
        return "Chưa chọn bộ thẻ"
    if len(names) == 1:
        suffix = " (+ bộ con)" if config.get("include_children", True) else ""
        return names[0] + suffix
    return f"{len(names)} bộ thẻ đã chọn"


def apply_redistribution_in_col(
    col: Any,
    plan: dict[str, Any],
    store: DailyStore,
    scope_label: str,
    *,
    changes: OpChanges | None = None,
    lang: str = "vi",
) -> dict[str, Any]:
    """Safely apply real card.due shifts inside an Anki CollectionOp, preserving ivl and FSRS state."""
    planned_moves = plan.get("moves") or []
    if not planned_moves:
        return {"applied": 0, "skipped": 0, "batch": None}

    updated_cards = []
    applied_moves = []
    skipped = 0

    for move in planned_moves:
        cid = int(move["card_id"])
        expected_old = int(move["old_due"])
        target_due = int(move["new_due"])
        try:
            card = col.get_card(cid)
        except Exception:
            skipped += 1
            continue
        # Strictly touch only unmodified overdue review cards in their home deck.
        if int(card.queue) != 2 or int(card.odid) != 0 or int(card.due) != expected_old:
            skipped += 1
            continue
        card.due = target_due
        updated_cards.append(card)
        applied_moves.append(move)

    if not updated_cards:
        return {"applied": 0, "skipped": skipped, "batch": None}

    _update_cards_with_undo(col, updated_cards, _tr_text("AnkiNOS: Điều phối lịch ôn", lang), changes)

    batch = store.record_batch(
        scope_label=scope_label,
        daily_cap=int(plan.get("daily_cap", DEFAULT_DAILY_CAP)),
        window_days=int(plan.get("expanded_window", 14)),
        summary=str(plan.get("summary", "")),
        moves=applied_moves,
        created_ms=int(time.time() * 1000),
    )
    return {"applied": len(applied_moves), "skipped": skipped, "batch": batch}


def rollback_batch_in_col(
    col: Any,
    batch_id: str,
    store: DailyStore,
    *,
    changes: OpChanges | None = None,
    lang: str = "vi",
) -> dict[str, Any]:
    """Restore old_due for cards in a batch that have not been reviewed since the batch ran."""
    batch = store.get_batch(batch_id)
    if not batch:
        raise ValueError("Không tìm thấy đợt điều phối cần hoàn tác.")
    if batch.get("rolled_back_at"):
        raise ValueError("Đợt điều phối này đã được hoàn tác trước đó.")

    entries = batch.get("entries") or []
    created_ms = int(batch["created_ms"])
    cids = [int(entry["card_id"]) for entry in entries]
    reviewed_since: set[int] = set()
    if cids:
        placeholders = ",".join("?" for _ in cids)
        rows = col.db.all(
            f"SELECT DISTINCT cid FROM revlog WHERE cid IN ({placeholders}) AND id >= ? AND ease > 0 AND type < 4",
            *cids,
            created_ms,
        )
        reviewed_since = {int(row[0]) for row in rows}

    restored_cards = []
    skipped_reviewed = 0
    skipped_changed = 0
    for entry in entries:
        cid = int(entry["card_id"])
        if cid in reviewed_since:
            skipped_reviewed += 1
            continue
        try:
            card = col.get_card(cid)
        except Exception:
            skipped_changed += 1
            continue
        if int(card.queue) != 2 or int(card.odid) != 0 or int(card.due) != int(entry["new_due"]):
            skipped_changed += 1
            continue
        card.due = int(entry["old_due"])
        restored_cards.append(card)

    if restored_cards:
        _update_cards_with_undo(col, restored_cards, _tr_text("AnkiNOS: Hoàn tác điều phối lịch ôn", lang), changes)

    rolled_at = store.mark_rolled_back(batch_id)
    return {
        "batch_id": batch_id,
        "restored": len(restored_cards),
        "skipped_reviewed": skipped_reviewed,
        "skipped_changed": skipped_changed,
        "rolled_back_at": rolled_at,
    }


def inspect_active_filtered_session(col: Any) -> dict[str, Any]:
    """Inspect whether a managed Daily Schedule filtered deck currently holds active cards."""
    for name in (FILTERED_DECK_NAME, *LEGACY_FILTERED_DECK_NAMES):
        did = col.decks.id_for_name(name)
        if not did:
            continue
        deck = col.decks.get(did)
        if not deck or not deck.get("dyn"):
            continue
        rows = col.db.all("SELECT queue, count(*) FROM cards WHERE did = ? GROUP BY queue", did)
        total = sum(int(cnt) for _q, cnt in rows)
        if total <= 0:
            continue
        relearning_count = sum(int(cnt) for q, cnt in rows if int(q) == 1)
        review_count = sum(int(cnt) for q, cnt in rows if int(q) in (2, 3))
        return {
            "active": True,
            "deck_id": str(did),
            "deck_name": str(deck.get("name") or name),
            "total": total,
            "relearning_count": relearning_count,
            "review_count": review_count,
        }
    return {"active": False, "deck_id": "", "deck_name": "", "total": 0, "relearning_count": 0, "review_count": 0}


def _remove_deck_with_changes(col: Any, did: int, changes: OpChanges | None) -> bool:
    remove_fn = getattr(col.decks, "remove", None)
    if not callable(remove_fn):
        return False
    res = remove_fn([did])
    _merge_changes(changes, getattr(res, "changes", res))
    return True


def _cleanup_legacy_and_empty_shells(
    col: Any,
    changes: OpChanges | None,
    *,
    empty_active_legacy: bool = False,
) -> bool:
    """Remove obsolete nested filtered decks and any empty 'AnkiNOS' parent shell."""
    removed = False
    for legacy_name in LEGACY_FILTERED_DECK_NAMES:
        ldid = col.decks.id_for_name(legacy_name)
        if not ldid:
            continue
        ldeck = col.decks.get(ldid)
        if not ldeck or not ldeck.get("dyn"):
            continue
        count = int(col.db.scalar("SELECT count(*) FROM cards WHERE did = ?", ldid) or 0)
        if count > 0 and not empty_active_legacy:
            continue
        if count > 0:
            _merge_changes(changes, col.sched.empty_filtered_deck(ldid))
        if _remove_deck_with_changes(col, ldid, changes):
            removed = True

    parent_did = col.decks.id_for_name(LEGACY_EMPTY_PARENT_NAME)
    if parent_did:
        parent_deck = col.decks.get(parent_did)
        if parent_deck and not parent_deck.get("dyn"):
            prefix = LEGACY_EMPTY_PARENT_NAME + "::"
            has_children = any(entry.name.startswith(prefix) for entry in col.decks.all_names_and_ids())
            card_count = int(
                col.db.scalar("SELECT count(*) FROM cards WHERE did = ? OR odid = ?", parent_did, parent_did) or 0
            )
            if not has_children and card_count == 0 and _remove_deck_with_changes(col, parent_did, changes):
                removed = True
    return removed


def cleanup_empty_filtered_decks_in_col(col: Any, *, changes: OpChanges | None = None) -> bool:
    """Remove empty managed Daily Schedule filtered decks and any empty legacy parent shell."""
    removed = False
    fdid = col.decks.id_for_name(FILTERED_DECK_NAME)
    if fdid:
        fdeck = col.decks.get(fdid)
        if fdeck and fdeck.get("dyn"):
            count = int(col.db.scalar("SELECT count(*) FROM cards WHERE did = ?", fdid) or 0)
            if count == 0 and _remove_deck_with_changes(col, fdid, changes):
                removed = True
    if _cleanup_legacy_and_empty_shells(col, changes, empty_active_legacy=False):
        removed = True
    return removed


def empty_session_in_col(col: Any, *, changes: OpChanges | None = None) -> int:
    """Return all cards from any managed filtered deck to their home decks and remove the shell."""
    returned = 0
    for name in (FILTERED_DECK_NAME, *LEGACY_FILTERED_DECK_NAMES):
        did = col.decks.id_for_name(name)
        if not did:
            continue
        deck = col.decks.get(did)
        if not deck or not deck.get("dyn"):
            continue
        count = int(col.db.scalar("SELECT count(*) FROM cards WHERE did = ?", did) or 0)
        if count > 0:
            _merge_changes(changes, col.sched.empty_filtered_deck(did))
            returned += count
        _remove_deck_with_changes(col, did, changes)
    _cleanup_legacy_and_empty_shells(col, changes, empty_active_legacy=False)
    return returned


def prepare_today_filtered_deck(
    col: Any,
    *,
    scope_mode: str = "all",
    deck_names: list[str] | None = None,
    include_children: bool = True,
    limit: int = MAX_SESSION_CARDS,
    daily_cap: int = DEFAULT_DAILY_CAP,
    backlog_mode: str = "virtual",
    review_order: str = "auto",
    session_mode: str = "smart",
    changes: OpChanges | None = None,
) -> tuple[int, int]:
    """Build, resume, or rebuild the managed Anki filtered deck for Today's session."""
    sched_today = int(col.sched.today)
    all_decks = {int(entry.id): entry.name for entry in col.decks.all_names_and_ids()}
    filtered_ids = {int(deck["id"]) for deck in col.decks.all() if deck.get("dyn")}
    origin_decks = {did: name for did, name in all_decks.items() if did not in filtered_ids}
    scope_dids = resolve_scope_deck_ids(
        origin_decks,
        scope_mode=scope_mode,
        deck_names=deck_names,
        include_children=include_children,
    )
    if not scope_dids:
        raise ValueError("Phạm vi hiện tại không khớp bộ thẻ nào.")

    # Protect in-progress sessions (especially queue=1 relearning cards) unless user asks to rebuild.
    active = inspect_active_filtered_session(col)
    if active["active"] and (session_mode == "continue" or (session_mode == "smart" and active["relearning_count"] > 0)):
        did = int(active["deck_id"])
        _merge_changes(changes, col.decks.set_current(did))
        return did, int(active["total"])

    # Clean up legacy nested filtered decks and empty 'AnkiNOS' parent shell.
    _cleanup_legacy_and_empty_shells(col, changes, empty_active_legacy=True)

    # Empty our managed filtered deck first so cards return to their home decks before re-gathering.
    existing_did = col.decks.id_for_name(FILTERED_DECK_NAME)
    if existing_did:
        existing_deck = col.decks.get(existing_did)
        if existing_deck and existing_deck.get("dyn"):
            _merge_changes(changes, col.sched.empty_filtered_deck(existing_did))
        else:
            existing_did = None

    # Collect session queue IDs (virtual mode includes capped overdue; reschedule mode uses today only).
    snapshot = collect_daily_schedule(
        col,
        scope_mode=scope_mode,
        deck_names=deck_names,
        include_children=include_children,
        daily_cap=daily_cap,
        backlog_mode=backlog_mode,
        review_order=review_order,
    )
    queue_ids = snapshot.get("session_queue", {}).get("card_ids") or snapshot["today_bucket"].get("card_ids", [])
    valid_ids = [int(cid) for cid in queue_ids][: max(1, min(MAX_SESSION_CARDS, int(limit)))]
    if not valid_ids:
        raise ValueError("Hôm nay chưa có thẻ đến hạn trong phạm vi đang chọn.")

    # Double-check against live DB that no future card slipped in and preserve exact serving order.
    placeholders = ",".join("?" for _ in valid_ids)
    due_clause = "due <= ?" if backlog_mode == "virtual" else "due = ?"
    available_set = {
        int(row[0])
        for row in col.db.all(
            f"SELECT id FROM cards WHERE id IN ({placeholders}) AND queue IN (2, 3) "
            f"AND odid = 0 AND {due_clause}",
            *valid_ids,
            sched_today,
        )
    }
    verified = [cid for cid in valid_ids if cid in available_set]
    if not verified:
        raise ValueError("Hôm nay không còn thẻ đến hạn sẵn sàng (có thể đang nằm trong bộ thẻ lọc khác).")

    did = existing_did if existing_did else col.decks.new_filtered(FILTERED_DECK_NAME)
    deck = col.decks.get(did)
    search = "cid:" + ",".join(str(cid) for cid in verified)
    # Always pass order=0 (DYN_OLDEST) to avoid Anki DbError on orders 8/9 when FSRS is disabled,
    # then stamp exact Retrievability ordinals on the gathered filtered cards.
    deck["terms"] = [[search, len(verified), 0]]
    deck["resched"] = True
    deck["delays"] = None
    _merge_changes(changes, col.decks.update_dict(deck))
    rebuilt = col.sched.rebuild_filtered_deck(did)
    _merge_changes(changes, rebuilt.changes)
    gathered = int(getattr(rebuilt, "count", len(verified)))
    if gathered <= 0:
        raise ValueError("Hôm nay không còn thẻ đến hạn sẵn sàng để mở phiên ôn.")

    if len(verified) > 1 and callable(getattr(col, "update_cards", None)):
        reordered = []
        for idx, cid in enumerate(verified):
            try:
                fc = col.get_card(cid)
            except Exception:
                continue
            if int(fc.did) == int(did) and int(fc.odid) != 0 and int(fc.queue) in (2, 3):
                # Filtered deck ordinals sit below 0 (preserving real home due in fc.odue).
                fc.due = -100_000 + idx
                reordered.append(fc)
        if reordered:
            _merge_changes(changes, col.update_cards(reordered))

    _merge_changes(changes, col.decks.set_current(did))
    return int(did), gathered


def build_daily_payload(col: Any, root: Path, profile: str) -> dict[str, Any]:
    """Collect live Anki daily schedule + profile presets + recent move ledger batches."""
    store = DailyStore(root, profile)
    cfg = store.get_config()
    schedule = collect_daily_schedule(
        col,
        scope_mode=cfg["scope_mode"],
        deck_names=cfg["deck_names"],
        include_children=cfg["include_children"],
        daily_cap=cfg["daily_cap"],
        horizon_days=HORIZON_DISPLAY_DAYS,
        backlog_mode=cfg["backlog_mode"],
        review_order=cfg["review_order"],
        safe_floor_r=cfg["safe_floor_r"],
        max_shift_days=cfg["max_shift_days"],
    )
    return {
        "config": cfg,
        "scope_label": scope_label_for(cfg),
        "presets": store.list_presets(),
        "batches": store.list_batches(20),
        "active_session": inspect_active_filtered_session(col),
        "schedule": schedule,
    }


def handle(
    command: dict[str, Any],
    *,
    root: Path,
    profile: str,
    current: Callable[[], bool],
    reply: Callable[[str, Any], None],
    on_mutated: Callable[[], None],
    on_start_review: Callable[[int, int | None], None],
    lang: str = "vi",
) -> None:
    """Dispatch dashboard daily_* commands onto Anki's QueryOp / CollectionOp executors."""
    from anki.collection import OpChanges
    from aqt import mw
    from aqt.operations import CollectionOp, QueryOp

    method = command.get("method")
    request_id = command.get("request_id")
    initiator = getattr(mw, "deckBrowser", None)

    def respond(data: Any = None, error: str = "") -> None:
        if current():
            reply("daily", {"request_id": request_id, "method": method, "data": data, "error": _tr_text(error, lang)})

    def fail(error: Exception) -> None:
        respond(error=str(error))

    if method == "load":
        QueryOp(
            parent=mw,
            op=lambda col: build_daily_payload(col, root, profile),
            success=lambda data: respond(data=data),
        ).failure(fail).run_in_background()
        return

    if method == "save_config":
        raw_cfg = command.get("config")
        if not isinstance(raw_cfg, dict):
            respond(error="Cấu hình phạm vi không hợp lệ.")
            return

        def op_save(col: Any) -> dict[str, Any]:
            DailyStore(root, profile).save_config(raw_cfg)
            return build_daily_payload(col, root, profile)

        QueryOp(parent=mw, op=op_save, success=lambda data: respond(data=data)).failure(fail).run_in_background()
        return

    if method == "save_preset":
        name = command.get("name", "")
        raw_cfg = clean_daily_config(command.get("config") or {})
        preset_id = command.get("preset_id") or None

        def op_preset(col: Any) -> dict[str, Any]:
            store = DailyStore(root, profile)
            saved = store.save_preset(
                name,
                scope_mode=raw_cfg["scope_mode"],
                deck_names=raw_cfg["deck_names"],
                include_children=raw_cfg["include_children"],
                daily_cap=raw_cfg["daily_cap"],
                preset_id=preset_id,
            )
            store.save_config({**raw_cfg, "active_preset_id": saved["id"]})
            payload = build_daily_payload(col, root, profile)
            payload["saved_preset"] = saved
            return payload

        QueryOp(parent=mw, op=op_preset, success=lambda data: respond(data=data)).failure(fail).run_in_background()
        return

    if method == "delete_preset":
        preset_id = str(command.get("preset_id") or "")

        def op_delete(col: Any) -> dict[str, Any]:
            DailyStore(root, profile).delete_preset(preset_id)
            return build_daily_payload(col, root, profile)

        QueryOp(parent=mw, op=op_delete, success=lambda data: respond(data=data)).failure(fail).run_in_background()
        return

    if method == "apply_plan":
        def op_apply(col: Any) -> _CollectionResult[dict[str, Any]]:
            store = DailyStore(root, profile)
            cfg = store.get_config()
            schedule = collect_daily_schedule(
                col,
                scope_mode=cfg["scope_mode"],
                deck_names=cfg["deck_names"],
                include_children=cfg["include_children"],
                daily_cap=cfg["daily_cap"],
                horizon_days=HORIZON_DISPLAY_DAYS,
                backlog_mode=cfg["backlog_mode"],
                review_order=cfg["review_order"],
                safe_floor_r=cfg["safe_floor_r"],
                max_shift_days=cfg["max_shift_days"],
            )
            changes = OpChanges()
            result = apply_redistribution_in_col(col, schedule["plan"], store, scope_label_for(cfg), changes=changes, lang=lang)
            payload = build_daily_payload(col, root, profile)
            payload["apply_result"] = result
            return _CollectionResult(changes, payload)

        def done_apply(result: _CollectionResult[dict[str, Any]]) -> None:
            on_mutated()
            respond(data=result.data)

        CollectionOp(parent=mw, op=op_apply).success(done_apply).failure(fail).run_in_background(initiator=initiator)
        return

    if method == "rollback_batch":
        batch_id = str(command.get("batch_id") or "")
        if not batch_id:
            respond(error="Thiếu mã đợt điều phối cần hoàn tác.")
            return

        def op_rollback(col: Any) -> _CollectionResult[dict[str, Any]]:
            store = DailyStore(root, profile)
            changes = OpChanges()
            result = rollback_batch_in_col(col, batch_id, store, changes=changes, lang=lang)
            payload = build_daily_payload(col, root, profile)
            payload["rollback_result"] = result
            return _CollectionResult(changes, payload)

        def done_rollback(result: _CollectionResult[dict[str, Any]]) -> None:
            on_mutated()
            respond(data=result.data)

        CollectionOp(parent=mw, op=op_rollback).success(done_rollback).failure(fail).run_in_background(initiator=initiator)
        return

    if method == "batch_detail":
        batch_id = str(command.get("batch_id") or "")
        QueryOp(
            parent=mw,
            op=lambda _col: DailyStore(root, profile).get_batch(batch_id),
            success=lambda data: respond(data={"batch": data}),
        ).failure(fail).run_in_background()
        return

    if method == "empty_session":
        def op_empty(col: Any) -> _CollectionResult[dict[str, Any]]:
            changes = OpChanges()
            returned = empty_session_in_col(col, changes=changes)
            payload = build_daily_payload(col, root, profile)
            payload["empty_result"] = {"returned": returned}
            return _CollectionResult(changes, payload)

        def done_empty(result: _CollectionResult[dict[str, Any]]) -> None:
            on_mutated()
            respond(data=result.data)

        CollectionOp(parent=mw, op=op_empty).success(done_empty).failure(fail).run_in_background(initiator=initiator)
        return

    if method == "study_today":
        minutes = command.get("minutes")
        pomo = command.get("pomodoro")
        if minutes is not None and (type(minutes) is not int or not (1 <= minutes <= 180)):
            respond(error="Chọn thời lượng học từ 1 đến 180 phút.")
            return
        session_mode = command.get("session_mode")
        if session_mode not in {"smart", "continue", "rebuild"}:
            session_mode = "smart"

        def op_study(col: Any) -> _CollectionResult[tuple[int, int]]:
            cfg = DailyStore(root, profile).get_config()
            changes = OpChanges()
            result = prepare_today_filtered_deck(
                col,
                scope_mode=cfg["scope_mode"],
                deck_names=cfg["deck_names"],
                include_children=cfg["include_children"],
                daily_cap=cfg["daily_cap"],
                backlog_mode=cfg["backlog_mode"],
                review_order=cfg["review_order"],
                session_mode=session_mode,
                changes=changes,
            )
            return _CollectionResult(changes, result)

        def done_study(result: _CollectionResult[tuple[int, int]]) -> None:
            did, count = result.data
            on_mutated()
            respond(data={"started": True, "deck_id": str(did), "count": count})
            if pomo is not None:
                on_start_review(did, minutes, pomo)
            else:
                on_start_review(did, minutes)

        CollectionOp(parent=mw, op=op_study).success(done_study).failure(fail).run_in_background(initiator=initiator)
        return

    respond(error="Lệnh Lịch ôn không được hỗ trợ.")
