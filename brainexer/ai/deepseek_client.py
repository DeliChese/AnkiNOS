from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any, Dict

from ..core.exceptions import APIError, ResponseValidationError
from ..core.models import AIResult
from .base import build_input, parse_json_output, post_json


DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"


@dataclass(frozen=True)
class DeepSeekConfig:
    model: str = "deepseek-v4-flash"
    timeout_seconds: int = 60
    max_output_tokens: int = 4000


class DeepSeekClient:
    def __init__(self, api_key: str, config: DeepSeekConfig) -> None:
        if not api_key.strip():
            raise APIError("Chưa có DeepSeek API key trong Keyring.")
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
        schema_instruction = (
            instructions.strip()
            + "\n\nChỉ trả một JSON object hợp lệ theo JSON Schema sau. "
            + "Không dùng markdown:\n"
            + json.dumps(schema, ensure_ascii=False, separators=(",", ":"))
        )
        body = {
            "model": self._config.model,
            "messages": [
                {"role": "system", "content": schema_instruction},
                {"role": "user", "content": build_input(task_prompt, source_data)},
            ],
            "response_format": {"type": "json_object"},
            "thinking": {"type": "disabled"},
            "max_tokens": self._config.max_output_tokens,
            "stream": False,
        }
        response, raw, request_id = post_json(
            DEEPSEEK_URL,
            body,
            {
                "Authorization": "Bearer " + self._api_key,
                "X-Client-Request-Id": client_request_id,
            },
            self._config.timeout_seconds,
            "DeepSeek",
        )
        choices = response.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ResponseValidationError("DeepSeek response không có choices.")
        choice = choices[0]
        if choice.get("finish_reason") == "length":
            raise APIError("DeepSeek dừng vì max_tokens; hãy thử lại hoặc tăng giới hạn output.")
        message = choice.get("message", {})
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str) or not content.strip():
            raise ResponseValidationError("DeepSeek trả nội dung rỗng; hãy thử tạo lại.")
        return AIResult(
            payload=parse_json_output(content),
            raw_response=raw,
            request_id=request_id or str(response.get("id") or client_request_id),
        )
