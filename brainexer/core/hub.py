"""Local BrainExer modes, grading and the independent mistake schedule."""

from __future__ import annotations

import random
import re
import unicodedata
from datetime import date, timedelta

from .answering import normalize_answer
from .models import CardSource

INTERVALS = (1, 3, 7, 14, 30)
LOCAL_MODES = {
    "multiple_choice", "fill_blank", "phrase", "quick", "recall",
    "matching", "word_hunter", "unscramble", "listening_reflex",
}
GAME_MODES = {"matching", "word_hunter", "unscramble", "listening_reflex"}
MODE_DECK_KIND = {
    "multiple_choice": {"language", "knowledge"},
    "fill_blank": {"language"},
    "phrase": {"language"},
    "sentence": {"language"},
    "listening": {"language"},
    "quick": {"language", "knowledge"},
    "recall": {"knowledge"},
    "explain": {"knowledge"},
    "application": {"knowledge"},
    "review": {"language", "knowledge"},
    "matching": {"language", "knowledge"},
    "word_hunter": {"language"},
    "unscramble": {"language"},
    "listening_reflex": {"language"},
}
MODE_LABELS = {
    "multiple_choice": "Trắc nghiệm", "fill_blank": "Điền vào câu",
    "phrase": "Cụm từ", "sentence": "Đặt câu", "listening": "Nghe & chép",
    "quick": "Ôn nhanh 60 giây", "recall": "Gợi nhớ",
    "explain": "Giải thích", "application": "Vận dụng",
    "review": "Ôn sổ lỗi", "matching": "Ghép cặp",
    "word_hunter": "Thợ săn từ", "unscramble": "Sắp xếp chữ",
    "listening_reflex": "Phản xạ nghe",
}


def normalize_text(text: str, *, ignore_accents: bool = False) -> str:
    text = normalize_answer(text.replace("’", "'").replace("‘", "'"))
    if ignore_accents:
        text = "".join(char for char in unicodedata.normalize("NFD", text)
                       if unicodedata.category(char) != "Mn").replace("đ", "d")
    return text


def local_grade(answer: str, accepted: list[str], *, ignore_accents: bool = False) -> bool:
    value = normalize_text(answer, ignore_accents=ignore_accents)
    return bool(value) and any(value == normalize_text(item, ignore_accents=ignore_accents)
                               for item in accepted)


def schedule(level: int, correct: bool, today: date, intervals: tuple[int, ...] = INTERVALS) -> tuple[int, str]:
    next_level = min(level + 1, len(intervals) - 1) if correct else 0
    return next_level, (today + timedelta(days=intervals[next_level])).isoformat()


def _fields(source: CardSource) -> list[str]:
    return [value for value in source.fields.values() if value]


def local_question(mode: str, sources: list[CardSource], deck_kind: str,
                   question_number: int = 0) -> dict:
    if mode not in LOCAL_MODES:
        raise ValueError("Dạng bài cần dịch vụ AI.")
    if mode == "quick":
        preferred = "fill_blank" if deck_kind == "language" and question_number % 2 else "multiple_choice"
        try:
            payload = local_question(preferred, sources, deck_kind)
            actual = preferred
        except ValueError:
            fallback = "multiple_choice" if preferred == "fill_blank" else (
                "fill_blank" if deck_kind == "language" else "recall")
            payload = local_question(fallback, sources, deck_kind)
            actual = fallback
        payload["mode"] = "quick"
        payload["question_style"] = actual
        return payload
    usable = [source for source in sources if source.target and source.context
              and source.target != source.context]
    if not usable:
        raise ValueError("Bộ thẻ cần ít nhất hai trường văn bản có nội dung để luyện tại máy.")
    if mode == "matching":
        if len(usable) < 3:
            raise ValueError("Ghép cặp cần ít nhất ba thẻ có câu hỏi và đáp án riêng.")
        selected = random.sample(usable, min(4, len(usable)))
        pairs = [{"left": item.target, "right": item.context,
                  "card_id": item.card_id, "note_id": item.note_id} for item in selected]
        if len({item["right"] for item in pairs}) != len(pairs):
            raise ValueError("Các đáp án ghép cặp trong bộ thẻ cần khác nhau.")
        right_options = [item["right"] for item in pairs]
        random.shuffle(right_options)
        return {"mode": mode, "prompt": "Ghép mỗi mục với đáp án tương ứng.",
                "answers": [item["right"] for item in pairs], "pairs": pairs,
                "right_options": right_options, "options": [], "explanation": "",
                "source_card_id": pairs[0]["card_id"], "source_note_id": pairs[0]["note_id"],
                "deck_kind": deck_kind}
    if mode == "fill_blank":
        usable = [source for source in usable if any(
            any(key in name.casefold() for key in ("example", "sentence", "ví dụ", "câu"))
            and normalize_text(source.target) in normalize_text(value)
            for name, value in source.fields.items())]
        if not usable:
            raise ValueError("Thẻ cần trường câu ví dụ chứa đáp án để luyện điền vào câu tại máy.")
    if mode == "phrase":
        usable = [source for source in usable if any(
            value and any(key in name.casefold() for key in ("cụm", "collocation", "phrase"))
            for name, value in source.fields.items())]
        if not usable:
            raise ValueError("Thẻ chưa có trường cụm từ để luyện mode này.")
    source = random.choice(usable)
    target, explanation = source.target, source.context
    if deck_kind == "knowledge":
        target, explanation = source.context, source.target
    alternatives = [other.context if deck_kind == "knowledge" else other.target
                    for other in usable if other.card_id != source.card_id]
    alternatives = [item for item in alternatives if item and item != target]
    if mode == "phrase":
        target = next((value for name, value in source.fields.items()
                       if any(key in name.casefold() for key in ("cụm", "collocation", "phrase")) and value), "")
        if not target:
            raise ValueError("Thẻ chưa có trường cụm từ để luyện mode này.")
        alternatives = [value for other in usable for name, value in other.fields.items()
                        if other.card_id != source.card_id and value
                        and any(key in name.casefold() for key in ("cụm", "collocation", "phrase"))]
    if mode in {"multiple_choice", "phrase", "quick", "matching", "word_hunter", "listening_reflex"}:
        unique = list(dict.fromkeys(alternatives))
        if len(unique) < 3:
            raise ValueError("Cần ít nhất bốn đáp án khác nhau trong bộ thẻ để tạo lựa chọn.")
        options = random.sample(unique, 3) + [target]
        random.shuffle(options)
    else:
        options = []
    if mode == "fill_blank":
        example = next((value for name, value in source.fields.items()
                        if any(key in name.casefold() for key in ("example", "sentence", "ví dụ", "câu"))
                        and normalize_text(target) in normalize_text(value)), "")
        if not example:
            raise ValueError("Thẻ cần trường câu ví dụ chứa đáp án để luyện điền vào câu tại máy.")
        prompt = re.sub(re.escape(target), "___", example, count=1, flags=re.IGNORECASE)
        if prompt == example:
            raise ValueError("Câu ví dụ chưa chứa từ cần điền.")
    elif mode == "unscramble":
        pronunciation = next((value for name, value in source.fields.items()
                              if any(key in name.casefold() for key in ("ipa", "phonetic", "phiên âm"))
                              and value), "")
        prompt = f"Sắp xếp chữ theo gợi ý: {explanation}" + (f" · {pronunciation}" if pronunciation else "")
        options = list(target)
        random.shuffle(options)
    elif mode == "recall":
        prompt = f"{source.target} — Hãy nhập đáp án từ thẻ."
        target = source.context
    elif mode == "listening_reflex":
        prompt = "Nghe và chọn từ đúng."
    else:
        prompt = f"{explanation} — chọn hoặc nhập đáp án phù hợp."
    return {
        "mode": mode, "prompt": prompt, "answers": [target], "options": options,
        "explanation": explanation, "source_card_id": source.card_id,
        "source_note_id": source.note_id, "deck_kind": deck_kind,
        "hint": (target[:1] + "…") if mode == "unscramble" else "",
    }


def calculation_question(sources: list[CardSource]) -> dict | None:
    """Use explicit solution/final-answer fields instead of treating AI as a calculator."""
    for source in sources:
        named = {name.casefold().strip(): value for name, value in source.fields.items() if value}
        final = next((value for name, value in named.items()
                      if any(term in name for term in ("final answer", "numeric answer", "đáp án cuối",
                                                       "đáp án số", "kết quả số"))), "")
        solution = next((value for name, value in named.items()
                         if any(term in name for term in ("solution", "working", "lời giải",
                                                          "các bước giải", "bài giải"))), "")
        tolerance = next((value for name, value in named.items()
                          if any(term in name for term in ("tolerance", "dung sai"))), "")
        numeric_context = bool(re.fullmatch(r"[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)", source.context.strip()))
        calculation_hint = bool(re.search(r"\d\s*[+*/=−-]\s*\d|[∑∫√]|\b(?:def|function|return)\b",
                                          source.target, re.IGNORECASE))
        if not (final or solution or tolerance or numeric_context or calculation_hint) or not source.target:
            continue
        expected = final or source.context
        numeric = re.fullmatch(r"[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)", expected.strip())
        try:
            numeric_tolerance = float(tolerance.replace(",", ".")) if tolerance else 0.0
        except ValueError:
            numeric_tolerance = 0.0
        if numeric_tolerance < 0 or numeric_tolerance > 1_000_000:
            numeric_tolerance = 0.0
        return {"mode": "application", "prompt": source.target,
                "answers": [expected], "options": [],
                "explanation": solution or (source.context if not numeric else ""),
                "self_check": not bool(numeric), "numeric_tolerance": numeric_tolerance,
                "source_card_id": source.card_id, "source_note_id": source.note_id,
                "deck_kind": "knowledge"}
    return None


def _words(text: str) -> list[str]:
    cleaned = unicodedata.normalize("NFC", text).casefold().replace("’", "'").replace("‘", "'")
    # CJK text commonly has no spaces. A character is the stable fallback unit
    # without requiring a network tokenizer or a language-specific dictionary.
    return re.findall(r"[\u3400-\u9fff\u3040-\u30ff]|[^\W_\u3400-\u9fff\u3040-\u30ff]+"
                      r"(?:'[^\W_\u3400-\u9fff\u3040-\u30ff]+)?",
                      cleaned, re.UNICODE)


def listening_grade(reference: str, answer: str, *, half_spelling: bool = True) -> dict:
    expected, actual = _words(reference), _words(answer)
    counts = [[0] * (len(actual) + 1) for _ in range(len(expected) + 1)]
    for i in range(len(expected) + 1):
        counts[i][0] = i
    for j in range(len(actual) + 1):
        counts[0][j] = j
    for i, word in enumerate(expected, 1):
        for j, entered in enumerate(actual, 1):
            counts[i][j] = min(counts[i - 1][j] + 1, counts[i][j - 1] + 1,
                               counts[i - 1][j - 1] + (word != entered))
    i, j = len(expected), len(actual)
    alignment = []
    while i or j:
        if i and j and counts[i][j] == counts[i - 1][j - 1] + (expected[i - 1] != actual[j - 1]):
            original, entered = expected[i - 1], actual[j - 1]
            kind = "correct" if original == entered else "wrong"
            if kind == "wrong" and abs(len(original) - len(entered)) <= 2:
                distance = _character_distance(original, entered)
                if distance <= 2:
                    kind = "spelling"
            alignment.append({"expected": original, "actual": entered, "kind": kind})
            i -= 1
            j -= 1
        elif i and counts[i][j] == counts[i - 1][j] + 1:
            alignment.append({"expected": expected[i - 1], "actual": "", "kind": "missing"})
            i -= 1
        else:
            alignment.append({"expected": "", "actual": actual[j - 1], "kind": "extra"})
            j -= 1
    alignment.reverse()
    earned = sum(1 if item["kind"] == "correct" else .5 if half_spelling and item["kind"] == "spelling" else 0
                 for item in alignment)
    return {"alignment": alignment, "accuracy": earned / len(expected) if expected else 0}


def _character_distance(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for i, character in enumerate(left, 1):
        current = [i]
        for j, other in enumerate(right, 1):
            current.append(min(current[-1] + 1, previous[j] + 1,
                               previous[j - 1] + (character != other)))
        previous = current
    return previous[-1]
