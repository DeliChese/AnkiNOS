from __future__ import annotations

import html
import json
import re
from html.parser import HTMLParser
from typing import Dict, Iterable, Tuple

from .models import CardSource

BLOCK_TAGS = {"br", "div", "p", "li", "ul", "ol", "tr", "td", "th", "section", "hr", "h1", "h2", "h3"}
HIDDEN_TAGS = {"script", "style"}
CLOZE = re.compile(r"\{\{c\d+::([^{}]*?)(?:::[^{}]*?)?\}\}", re.IGNORECASE)
MAX_CARD_SOURCE_BYTES = 8000
MAX_FIELD_BYTES = 1400


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts = []
        self.hidden = False

    def handle_starttag(self, tag: str, attributes: list) -> None:
        if tag in HIDDEN_TAGS:
            self.hidden = True
        if tag in BLOCK_TAGS:
            self.parts.append(" ")
        if tag == "sup":
            self.parts.append("^(")
        if tag == "img":
            alt = dict(attributes).get("alt")
            if alt:
                self.parts.extend((" ", alt, " "))

    def handle_endtag(self, tag: str) -> None:
        if tag in HIDDEN_TAGS:
            self.hidden = False
        if tag in BLOCK_TAGS:
            self.parts.append(" ")
        if tag == "sup":
            self.parts.append(")")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


TARGET_NAMES = (
    "target", "word", "expression", "term", "front", "question",
    "từ", "từ vựng", "cụm từ",
)
CONTEXT_NAMES = (
    "context", "example", "sentence", "definition", "meaning", "back",
    "answer", "ví dụ", "ngữ cảnh", "nghĩa",
)
POS_NAMES = (
    "part of speech", "part_of_speech", "pos", "word type", "từ loại",
)


def plain_text(value: object) -> str:
    raw = "" if value is None else str(value)
    raw = re.sub(r"\[sound:[^]]+\]", "", raw, flags=re.IGNORECASE)
    parser = _TextExtractor()
    try:
        parser.feed(raw)
        parser.close()
        text = "".join(parser.parts)
    except Exception:
        text = re.sub(r"<[^>]+>", " ", raw)
    text = html.unescape(text)
    while CLOZE.search(text):
        text = CLOZE.sub(r"\1", text)
    return " ".join(text.split())


def _first_named(fields: Dict[str, str], names: Iterable[str]) -> str:
    lowered = {name.casefold().strip(): value for name, value in fields.items()}
    for name in names:
        value = lowered.get(name)
        if value:
            return value
    return ""


def map_fields(raw_fields: Dict[str, object]) -> Tuple[str, str, str, Dict[str, str]]:
    fields = {str(name): plain_text(value) for name, value in raw_fields.items()}
    non_empty = [value for value in fields.values() if value]
    target = _first_named(fields, TARGET_NAMES) or (non_empty[0] if non_empty else "")
    context = _first_named(fields, CONTEXT_NAMES)
    if not context:
        context = next((value for value in non_empty if value != target), "")
    pos = _first_named(fields, POS_NAMES)
    return target, context, pos, fields


def _json_size(value: object) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _excerpt(text: str, budget: int) -> str:
    if _json_size(text) <= budget:
        return text
    if budget < 32:
        return ""
    encoded = text.encode("utf-8")
    size = (budget - 9) // 2
    while size > 0:
        first = encoded[:size].decode("utf-8", errors="ignore").rstrip()
        last = encoded[-size:].decode("utf-8", errors="ignore").lstrip()
        excerpt = first + " […] " + last
        if _json_size(excerpt) <= budget:
            return excerpt
        size //= 2
    return ""


def prompt_cards(sources: list[CardSource], *, knowledge: bool) -> list[dict]:
    """Keep named text fields and fit sampled cards in an exact UTF-8 JSON budget."""
    cards = []
    remaining = MAX_CARD_SOURCE_BYTES - 2
    for index, source in enumerate(sources):
        budget = remaining // (len(sources) - index)
        fields: dict[str, str] = {}
        card: dict = {"fields": fields}
        repeated = set()
        if not knowledge:
            for key, value, aliases in (
                ("target", source.target, TARGET_NAMES),
                ("context", source.context, CONTEXT_NAMES),
                ("part_of_speech", source.part_of_speech, POS_NAMES),
            ):
                if value:
                    card[key] = _excerpt(value, min(600, budget // 6))
                    if card[key] == value:
                        repeated.update((name, value) for name in aliases)
        available = budget - _json_size(card) - 1
        content = sorted(
            ((name, value) for name, value in source.fields.items()
             if value and (name.casefold().strip(), value) not in repeated),
            key=lambda field: len(field[1]),
        )
        for ordinal, (name, value) in enumerate(content):
            room = (available // (len(content) - ordinal)) - _json_size(name) - 2
            excerpt = _excerpt(value, min(MAX_FIELD_BYTES, room))
            if not excerpt:
                continue
            fields[name] = excerpt
            available -= _json_size(name) + _json_size(excerpt) + 2
        if fields or card.get("target"):
            cards.append(card)
            remaining -= _json_size(card) + 1
    return cards
