from __future__ import annotations


import random
from typing import Any, List

from .field_mapper import map_fields
from .models import CardSource, DeckInfo


def list_decks(col: Any) -> List[DeckInfo]:
    try:
        items = col.decks.all_names_and_ids()
        decks = [DeckInfo(int(item.id), str(item.name)) for item in items]
    except AttributeError:
        decks = [DeckInfo(int(item["id"]), str(item["name"])) for item in col.decks.all()]
    return sorted(decks, key=lambda item: item.name.casefold())


def _quoted_deck_name(name: str) -> str:
    return name.replace("\\", "\\\\").replace('"', '\\"')


def card_ids_for_deck(col: Any, deck: DeckInfo, include_children: bool) -> List[int]:
    query = 'deck:"{}"'.format(_quoted_deck_name(deck.name))
    ids = [int(card_id) for card_id in col.find_cards(query)]
    if include_children:
        return ids
    return [card_id for card_id in ids if int(col.get_card(card_id).did) == deck.id]


def sample_sources(
    col: Any,
    deck: DeckInfo,
    include_children: bool,
    sample_size: int = 5,
) -> List[CardSource]:
    return sample_card_ids(col, card_ids_for_deck(col, deck, include_children), sample_size)


def sample_card_ids(col: Any, ids: List[int], sample_size: int) -> List[CardSource]:
    random.shuffle(ids)
    sources = []
    seen_notes = set()
    seen_contents = set()
    for card_id in ids:
        card = col.get_card(card_id)
        note = card.note()
        if note.id in seen_notes:
            continue
        seen_notes.add(note.id)
        target, context, pos, fields = map_fields(dict(note.items()))
        if not target:
            continue
        signature = tuple(sorted((name, value) for name, value in fields.items() if value))
        if signature in seen_contents:
            continue
        seen_contents.add(signature)
        sources.append(
            CardSource(
                card_id=int(card.id),
                note_id=int(note.id),
                deck_id=int(card.did),
                target=target,
                context=context,
                part_of_speech=pos,
                fields=fields,
            )
        )
        if len(sources) >= max(1, sample_size):
            break
    return sources
