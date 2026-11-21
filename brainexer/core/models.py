from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

KNOWLEDGE_TYPES = ("recall", "multiple_choice", "application")
AI_GRADED_TYPES = ("writing_free", "application")


@dataclass(frozen=True)
class DeckInfo:
    id: int
    name: str


@dataclass(frozen=True)
class CardSource:
    card_id: int
    note_id: int
    deck_id: int
    target: str
    context: str
    part_of_speech: str
    fields: Dict[str, str]

@dataclass(frozen=True)
class AIResult:
    payload: Dict[str, Any]
    raw_response: Optional[str]
    request_id: str


@dataclass(frozen=True)
class GeneratedExercise:
    exercise_id: int
    session_id: int
    exercise_type: str
    data: Dict[str, Any]


@dataclass(frozen=True)
class AttemptResult:
    attempt_id: int
    score: Optional[float]
    is_correct: Optional[bool]
    feedback: Dict[str, Any]


JsonDict = Dict[str, Any]
JsonList = List[Any]
