from __future__ import annotations

from html import escape
from typing import Any, Optional, Tuple


DECK_NAME = "BrainExer::Mistakes"
NOTETYPE_NAME = "BrainExer Mistake"


def ensure_notetype(col: Any) -> Any:
    notetype = col.models.by_name(NOTETYPE_NAME)
    if notetype:
        return notetype
    notetype = col.models.new(NOTETYPE_NAME)
    for field_name in ("Sai", "Đúng", "Giải thích", "Loại lỗi"):
        col.models.add_field(notetype, col.models.new_field(field_name))
    template = col.models.new_template("Card 1")
    template["qfmt"] = "<div class='brainexer-label'>Hãy sửa lỗi:</div><div class='brainexer-wrong'>{{Sai}}</div>"
    template["afmt"] = (
        "{{FrontSide}}<hr id='answer'><div class='brainexer-correct'>{{Đúng}}</div>"
        "<div class='brainexer-explanation'>{{Giải thích}}</div>"
    )
    col.models.add_template(notetype, template)
    notetype["css"] = (
        ".card{font-family:Arial;font-size:22px;text-align:left;color:#202124;background:#fff;}"
        ".brainexer-label{color:#666;font-size:14px;margin-bottom:12px;}"
        ".brainexer-wrong{color:#b3261e;}"
        ".brainexer-correct{color:#146c2e;font-weight:600;margin-bottom:12px;}"
        ".brainexer-explanation{font-size:16px;line-height:1.5;}"
    )
    col.models.add(notetype)
    return notetype


def add_mistake_note(col: Any, mistake: Any) -> Tuple[int, Optional[int]]:
    note_id, card_id, _changes = add_mistake_note_with_changes(col, mistake)
    return note_id, card_id


def mistake_fields(mistake: Any) -> dict[str, str]:
    fields = {
        field: escape(str(mistake[key])).replace("\n", "<br>")
        for field, key in (
            ("Sai", "original_text"), ("Đúng", "corrected_text"),
            ("Giải thích", "explanation"), ("Loại lỗi", "mistake_type"),
        )
    }
    if "exercise_type" in mistake.keys() and mistake["exercise_type"] in ("recall", "multiple_choice"):
        fields["Sai"] = escape(mistake["prompt_shown"]).replace("\n", "<br>") + "<br><br>Bạn đã trả lời · " + fields["Sai"]
    return fields


def add_mistake_note_with_changes(col: Any, mistake: Any, record_tag: str = "") -> Tuple[int, Optional[int], Any]:
    notetype = ensure_notetype(col)
    deck_id = col.decks.id(DECK_NAME)
    note = col.new_note(notetype)
    for field, value in mistake_fields(mistake).items():
        note[field] = value
    note.tags.append("brainexer::mistake")
    if record_tag:
        note.tags.append(record_tag)
    changes = col.add_note(note, deck_id).changes
    card_ids = list(col.card_ids_of_note(note.id))
    return int(note.id), int(card_ids[0]) if card_ids else None, changes
