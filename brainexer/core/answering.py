from __future__ import annotations

import unicodedata
from typing import Any, Dict, Iterable


def normalize_answer(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    return " ".join(normalized.casefold().strip().split())


def answer_is_correct(user_answer: str, accepted: Iterable[str]) -> bool:
    user = normalize_answer(user_answer)
    return bool(user) and any(user == normalize_answer(item) for item in accepted)


def local_feedback(exercise_type: str, data: Dict[str, Any], user_answer: str) -> Dict[str, Any]:
    accepted = [str(item) for item in data.get("correct_answers", [])]
    correct = answer_is_correct(user_answer, accepted)
    return {
        "summary": "Chính xác." if correct else "Câu trả lời chưa khớp đáp án chấp nhận được.",
        "explanation": data.get("explanation", ""),
        "correct_answers": accepted,
        "is_correct": correct,
        "exercise_type": exercise_type,
    }


def deterministic_mistake(exercise_type: str, data: Dict[str, Any], user_answer: str) -> Dict[str, str]:
    mapping = {
        "fill_blank": "word_choice",
        "synonym_antonym": "word_choice",
        "word_form": "word_form",
        "nuance": "nuance",
    }
    accepted = [str(item) for item in data.get("correct_answers", [])]
    return {
        "mistake_type": mapping.get(exercise_type, "other"),
        "original_text": user_answer or "(Không trả lời)",
        "corrected_text": accepted[0] if accepted else "",
        "explanation": str(data.get("explanation", "")),
        "severity": "minor",
    }
