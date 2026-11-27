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

FILTERED_DECK_NAME = "AnkiNOS::Lịch hôm nay"
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


def prepare_today_filtered_deck(
    col: Any,
    *,
    scope_mode: str = "all",
    deck_names: list[str] | None = None,
    include_children: bool = True,
    limit: int = MAX_SESSION_CARDS,
    changes: OpChanges | None = None,
) -> tuple[int, int]:
    """Build or rebuild the managed Anki filtered deck for Today's unlocked cards only."""
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

    # Empty our managed filtered deck first so cards return to their home decks before re-gathering.
    existing_did = col.decks.id_for_name(FILTERED_DECK_NAME)
    if existing_did:
        existing_deck = col.decks.get(existing_did)
        if existing_deck and existing_deck.get("dyn"):
            _merge_changes(changes, col.sched.empty_filtered_deck(existing_did))
        else:
            existing_did = None

    # Re-collect exact Today unlocked card IDs (never pulls queue=0, queue=1, or future locked cards).
    snapshot = collect_daily_schedule(
        col,
        scope_mode=scope_mode,
        deck_names=deck_names,
        include_children=include_children,
    )
    valid_ids = [int(cid) for cid in snapshot["today_bucket"].get("card_ids", [])][: max(1, min(MAX_SESSION_CARDS, int(limit)))]
    if not valid_ids:
        raise ValueError("Hôm nay chưa có thẻ đến hạn trong phạm vi đang chọn.")

    # Double-check against live DB that no future card slipped in and card is free to gather.
    placeholders = ",".join("?" for _ in valid_ids)
    verified = [
        int(row[0])
        for row in col.db.all(
            f"SELECT id FROM cards WHERE id IN ({placeholders}) AND queue IN (2, 3) "
            "AND odid = 0 AND due = ?",
            *valid_ids,
            sched_today,
        )
    ]
    if not verified:
        raise ValueError("Hôm nay không còn thẻ đến hạn sẵn sàng (có thể đang nằm trong bộ thẻ lọc khác).")

    did = existing_did if existing_did else col.decks.new_filtered(FILTERED_DECK_NAME)
    deck = col.decks.get(did)
    search = "cid:" + ",".join(str(cid) for cid in verified)
    # Keep native Anki/FSRS rescheduling enabled in the filtered session.
    deck["terms"] = [[search, len(verified), 0]]
    deck["resched"] = True
    deck["delays"] = None
    _merge_changes(changes, col.decks.update_dict(deck))
    rebuilt = col.sched.rebuild_filtered_deck(did)
    _merge_changes(changes, rebuilt.changes)
    gathered = int(getattr(rebuilt, "count", len(verified)))
    if gathered <= 0:
        raise ValueError("Hôm nay không còn thẻ đến hạn sẵn sàng để mở phiên ôn.")
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
    )
    return {
        "config": cfg,
        "scope_label": scope_label_for(cfg),
        "presets": store.list_presets(),
        "batches": store.list_batches(20),
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
            reply("daily", {"request_id": request_id, "method": method, "data": data, "error": error})

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

    if method == "study_today":
        minutes = command.get("minutes")
        if minutes is not None and (type(minutes) is not int or minutes not in {15, 30, 60}):
            respond(error="Chọn thời lượng Focus 15, 30 hoặc 60 phút.")
            return

        def op_study(col: Any) -> _CollectionResult[tuple[int, int]]:
            cfg = DailyStore(root, profile).get_config()
            changes = OpChanges()
            result = prepare_today_filtered_deck(
                col,
                scope_mode=cfg["scope_mode"],
                deck_names=cfg["deck_names"],
                include_children=cfg["include_children"],
                changes=changes,
            )
            return _CollectionResult(changes, result)

        def done_study(result: _CollectionResult[tuple[int, int]]) -> None:
            did, count = result.data
            on_mutated()
            respond(data={"started": True, "deck_id": str(did), "count": count})
            on_start_review(did, minutes)

        CollectionOp(parent=mw, op=op_study).success(done_study).failure(fail).run_in_background(initiator=initiator)
        return

    respond(error="Lệnh Lịch ôn không được hỗ trợ.")
