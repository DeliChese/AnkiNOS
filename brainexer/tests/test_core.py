from __future__ import annotations

import json

import pytest

from brainexer.ai.client import extract_output_text
from brainexer.ai.schemas import EXERCISE_DATA_SCHEMA, validate_envelope
from brainexer.core.answering import answer_is_correct
from brainexer.core.exceptions import ResponseValidationError
from brainexer.core.field_mapper import MAX_CARD_SOURCE_BYTES, map_fields, plain_text, prompt_cards
from brainexer.core.models import CardSource


def exercise_data():
    return {
        "question_prompt": "I ___ here.", "correct_answers": ["live"], "options": [],
        "hint": "verb", "explanation": "Live means reside.", "target_meaning": "",
        "nuance_note": "", "suggested_length": "", "target_words_to_use": [],
        "example_opening": "",
    }


def test_objective_answer_normalization() -> None:
    assert answer_is_correct("  CAFÉ ", ["café"])
    assert not answer_is_correct("", [""])


def test_field_mapper_strips_html_and_uses_common_names() -> None:
    target, context, pos, fields = map_fields({
        "Front": "<b>abandon</b>", "Back": "to leave", "POS": "verb", "Audio": "[sound:x.mp3]",
    })
    assert target == "abandon"
    assert context == "to leave"
    assert pos == "verb"
    assert plain_text("A<br>B") == "A B"
    assert plain_text("H<sub>2</sub>O<br>{{c1::nước::Tên}}<style>.hidden{}</style>") == "H2O nước"
    assert plain_text('10<sup>2</sup><br><img src="figure.png" alt="Biểu đồ gia tốc">') == "10^(2) Biểu đồ gia tốc"
    assert fields["Audio"] == ""


def test_prompt_budget_keeps_custom_fields_and_removes_repeated_language_values() -> None:
    sources = []
    for index in range(5):
        fields = {
            "Mục tiêu riêng": "Công suất",
            "Đơn vị do tôi đặt": "watt",
            "Luận giải": 'Giả thiết đầu ' + 'năng lượng "\\" ' * 600 + " Kết luận cuối",
            "Chưa nhập": "",
        }
        sources.append(CardSource(index, index, 1, "Công suất", "watt", "", fields))
    cards = prompt_cards(sources, knowledge=True)
    encoded = json.dumps(cards, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    assert len(encoded) <= MAX_CARD_SOURCE_BYTES
    assert len(cards) == 5
    for card in cards:
        fields = card["fields"]
        assert set(fields) == {"Mục tiêu riêng", "Đơn vị do tôi đặt", "Luận giải"}
        assert fields["Đơn vị do tôi đặt"] == "watt"
        assert fields["Luận giải"].startswith("Giả thiết đầu") and fields["Luận giải"].endswith("Kết luận cuối")
        assert " […] " in fields["Luận giải"]

    source = CardSource(101, 102, 2, "live", "I live here", "verb",
                        {"Front": "live", "Back": "I live here", "Ghi chú tự đặt": "Cách dùng"})
    language = prompt_cards([source], knowledge=False)
    assert language == [{
        "target": "live", "context": "I live here", "part_of_speech": "verb",
        "fields": {"Ghi chú tự đặt": "Cách dùng"},
    }]


def test_envelope_validation() -> None:
    payload = {"status": "ok", "reason": "", "data": exercise_data()}
    assert validate_envelope(payload) is payload
    with pytest.raises(ResponseValidationError):
        validate_envelope({"status": "insufficient_data", "reason": "", "data": {}})
    assert set(EXERCISE_DATA_SCHEMA["required"]) == set(EXERCISE_DATA_SCHEMA["properties"])


def test_extract_output_text_does_not_assume_first_output_item() -> None:
    response = {
        "status": "completed",
        "output": [
            {"type": "reasoning"},
            {"type": "message", "content": [{"type": "output_text", "text": "{\"status\":\"ok\"}"}]},
        ],
    }
    assert extract_output_text(response) == '{"status":"ok"}'
