from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Dict, List

from ..core.exceptions import APIError, ResponseValidationError
from ..core.models import AIResult
from .base import build_input, parse_json_output, post_json


GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"


@dataclass(frozen=True)
class GeminiConfig:
    model: str = "gemini-2.5-flash"
    timeout_seconds: int = 60
    max_output_tokens: int = 4000


class GeminiClient:
    def __init__(self, api_key: str, config: GeminiConfig) -> None:
        if not api_key.strip():
            raise APIError("Chưa có Gemini API key trong Keyring.")
        self._api_key = api_key.strip()
        self._config = config

    def create_structured(
        self,
        instructions: str,
        task_prompt: str,
        source_data: Dict[str, Any],
        schema_name: str,
        schema: Dict[str, Any],
    ) -> AIResult:
        client_request_id = str(uuid.uuid4())
        body = {
            "model": self._config.model,
            "system_instruction": instructions,
            "input": build_input(task_prompt, source_data),
            "response_format": {
                "type": "text",
                "mime_type": "application/json",
                "schema": schema,
            },
            "generation_config": {"max_output_tokens": self._config.max_output_tokens},
            "store": False,
        }
        response, raw, request_id = post_json(
            GEMINI_INTERACTIONS_URL,
            body,
            {
                "x-goog-api-key": self._api_key,
                "X-Client-Request-Id": client_request_id,
            },
            self._config.timeout_seconds,
            "Gemini",
        )
        text = extract_gemini_text(response)
        return AIResult(
            payload=parse_json_output(text),
            raw_response=raw,
            request_id=request_id or str(response.get("id") or client_request_id),
        )


def extract_gemini_text(response: Dict[str, Any]) -> str:
    if response.get("error"):
        raise APIError("Gemini trả lỗi: {}".format(response["error"]))
    status = response.get("status")
    if status not in (None, "completed"):
        detail = response.get("incomplete_details") or status
        raise APIError("Gemini chưa hoàn tất response: {}".format(detail))
    chunks: List[str] = []
    for step in response.get("steps", []):
        if not isinstance(step, dict) or step.get("type") != "model_output":
            continue
        for content in step.get("content", []):
            if isinstance(content, dict) and content.get("type") == "text" and isinstance(content.get("text"), str):
                chunks.append(content["text"])
    # Compatibility with the pre-June-2026 Interactions response shape.
    for output in response.get("outputs", []):
        if isinstance(output, dict) and output.get("type") == "text" and isinstance(output.get("text"), str):
            chunks.append(output["text"])
    if not chunks:
        raise ResponseValidationError("Gemini response không có model_output dạng text.")
    return "".join(chunks)
