from __future__ import annotations

from typing import Any, Dict, Iterable

from ..core.exceptions import ResponseValidationError


STRING_ARRAY = {"type": "array", "items": {"type": "string"}}

EXERCISE_DATA_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "question_prompt": {"type": "string"},
        "correct_answers": STRING_ARRAY,
        "options": STRING_ARRAY,
        "hint": {"type": "string"},
        "explanation": {"type": "string"},
        "target_meaning": {"type": "string"},
        "nuance_note": {"type": "string"},
        "suggested_length": {"type": "string"},
        "target_words_to_use": STRING_ARRAY,
        "example_opening": {"type": "string"},
    },
    "required": [
        "question_prompt", "correct_answers", "options", "hint",
        "explanation", "target_meaning", "nuance_note",
        "suggested_length", "target_words_to_use", "example_opening",
    ],
}

EXERCISE_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "status": {"type": "string", "enum": ["ok", "insufficient_data"]},
        "reason": {"type": "string"},
        "data": EXERCISE_DATA_SCHEMA,
    },
    "required": ["status", "reason", "data"],
}

ERROR_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "original_text": {"type": "string"},
        "corrected_text": {"type": "string"},
        "mistake_type": {
            "type": "string",
            "enum": ["grammar", "word_choice", "spelling", "nuance", "word_form", "other"],
        },
        "severity": {"type": "string", "enum": ["minor", "major"]},
        "explanation": {"type": "string"},
    },
    "required": ["original_text", "corrected_text", "mistake_type", "severity", "explanation"],
}

STYLE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "original_text": {"type": "string"},
        "suggested_text": {"type": "string"},
        "note": {"type": "string"},
    },
    "required": ["original_text", "suggested_text", "note"],
}

GRADING_DATA_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "score": {"type": "number", "minimum": 0, "maximum": 10},
        "grammar_score": {"type": "number", "minimum": 0, "maximum": 10},
        "vocabulary_score": {"type": "number", "minimum": 0, "maximum": 10},
        "clarity_score": {"type": "number", "minimum": 0, "maximum": 10},
        "summary": {"type": "string"},
        "strengths": STRING_ARRAY,
        "errors": {"type": "array", "items": ERROR_SCHEMA},
        "style_suggestions": {"type": "array", "items": STYLE_SCHEMA},
        "corrected_full_text": {"type": "string"},
        "applied_target_words_correctly": STRING_ARRAY,
        "missed_target_words": STRING_ARRAY,
    },
    "required": [
        "score", "grammar_score", "vocabulary_score", "clarity_score",
        "summary", "strengths", "errors", "style_suggestions",
        "corrected_full_text", "applied_target_words_correctly", "missed_target_words",
    ],
}

GRADING_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "status": {"type": "string", "enum": ["ok", "insufficient_data"]},
        "reason": {"type": "string"},
        "data": GRADING_DATA_SCHEMA,
    },
    "required": ["status", "reason", "data"],
}

APPLICATION_GRADING_PROPERTIES = {
    key: value for key, value in GRADING_DATA_SCHEMA["properties"].items()
    if key not in {"grammar_score", "vocabulary_score"}
}
APPLICATION_GRADING_PROPERTIES.update({
    "accuracy_score": GRADING_DATA_SCHEMA["properties"]["grammar_score"],
    "reasoning_score": GRADING_DATA_SCHEMA["properties"]["grammar_score"],
})
APPLICATION_GRADING_RESPONSE_SCHEMA = {
    **GRADING_RESPONSE_SCHEMA,
    "properties": {
        **GRADING_RESPONSE_SCHEMA["properties"],
        "data": {
            **GRADING_DATA_SCHEMA,
            "properties": APPLICATION_GRADING_PROPERTIES,
            "required": list(APPLICATION_GRADING_PROPERTIES),
        },
    },
}


def _require_keys(value: Dict[str, Any], keys: Iterable[str], context: str) -> None:
    missing = [key for key in keys if key not in value]
    if missing:
        raise ResponseValidationError("{} thiếu trường: {}".format(context, ", ".join(missing)))


def _validate_value(value: Any, schema: Dict[str, Any], field: str) -> None:
    kind = schema["type"]
    if kind == "object" and isinstance(value, dict):
        _require_keys(value, schema["required"], field)
        for key, rule in schema["properties"].items():
            _validate_value(value[key], rule, key)
        return
    if kind == "array" and isinstance(value, list):
        for item in value:
            _validate_value(item, schema["items"], field)
        return
    if kind == "number" and type(value) in (int, float) and schema["minimum"] <= value <= schema["maximum"]:
        return
    if kind == "string" and isinstance(value, str) and ("enum" not in schema or value in schema["enum"]):
        return
    raise ResponseValidationError(f"AI trả giá trị không hợp lệ cho trường {field}.")


def validate_envelope(
    payload: Any, schema: Dict[str, Any] = EXERCISE_RESPONSE_SCHEMA
) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise ResponseValidationError("AI phải trả về một JSON object.")
    _require_keys(payload, ("status", "reason", "data"), "Response")
    if payload["status"] not in ("ok", "insufficient_data"):
        raise ResponseValidationError("Trạng thái response không hợp lệ.")
    if not isinstance(payload["reason"], str) or not isinstance(payload["data"], dict):
        raise ResponseValidationError("reason hoặc data sai kiểu dữ liệu.")
    if payload["status"] == "insufficient_data":
        if not payload["reason"].strip():
            raise ResponseValidationError("Response thiếu lý do insufficient_data.")
        return payload

    data = payload["data"]
    _validate_value(data, schema["properties"]["data"], "data")
    if schema is EXERCISE_RESPONSE_SCHEMA and not data["question_prompt"].strip():
        raise ResponseValidationError("Câu hỏi AI tạo ra đang trống.")
    return payload
