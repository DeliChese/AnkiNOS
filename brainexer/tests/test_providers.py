from __future__ import annotations

import json

import pytest

from brainexer.ai.deepseek_client import DeepSeekClient, DeepSeekConfig
from brainexer.ai.factory import create_ai_client, model_for_provider
from brainexer.ai.gemini_client import GeminiClient, GeminiConfig, extract_gemini_text
from brainexer.core.exceptions import ConfigurationError


class FakeResponse:
    def __init__(self, body: dict, headers: dict | None = None) -> None:
        self.body = json.dumps(body).encode("utf-8")
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *args) -> None:
        return None

    def read(self) -> bytes:
        return self.body


SCHEMA = {"type": "object", "properties": {}, "additionalProperties": False}


def test_deepseek_uses_chat_json_mode(monkeypatch) -> None:
    captured = {}

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["authorization"] = request.get_header("Authorization")
        captured["timeout"] = timeout
        return FakeResponse(
            {
                "id": "deepseek-response",
                "choices": [{
                    "finish_reason": "stop",
                    "message": {"content": '{"status":"ok"}'},
                }],
            },
            {"x-request-id": "deepseek-request"},
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    client = DeepSeekClient("deepseek-secret", DeepSeekConfig("deepseek-test", 24))
    result = client.create_structured("system", "task", {"card": "data"}, "schema", SCHEMA)

    assert result.payload == {"status": "ok"}
    assert result.request_id == "deepseek-request"
    assert captured["url"].endswith("/chat/completions")
    assert captured["body"]["model"] == "deepseek-test"
    assert captured["body"]["response_format"] == {"type": "json_object"}
    assert captured["body"]["thinking"] == {"type": "disabled"}
    assert "JSON Schema" in captured["body"]["messages"][0]["content"]
    assert captured["authorization"] == "Bearer deepseek-secret"
    assert captured["timeout"] == 24


def test_gemini_uses_interactions_structured_output_without_storage(monkeypatch) -> None:
    captured = {}

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["api_key"] = request.get_header("X-goog-api-key")
        captured["timeout"] = timeout
        return FakeResponse(
            {
                "id": "gemini-interaction",
                "status": "completed",
                "steps": [{
                    "type": "model_output",
                    "content": [{"type": "text", "text": '{"status":"ok"}'}],
                }],
            },
            {"x-goog-request-id": "gemini-request"},
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    client = GeminiClient("gemini-secret", GeminiConfig("gemini-test", 33))
    result = client.create_structured("system", "task", {"card": "data"}, "schema", SCHEMA)

    assert result.payload == {"status": "ok"}
    assert result.request_id == "gemini-request"
    assert captured["url"].endswith("/v1beta/interactions")
    assert captured["body"]["model"] == "gemini-test"
    assert captured["body"]["store"] is False
    assert captured["body"]["generation_config"]["max_output_tokens"] == 4000
    assert "max_output_tokens" not in captured["body"]
    assert captured["body"]["response_format"]["mime_type"] == "application/json"
    assert captured["body"]["response_format"]["schema"] == SCHEMA
    assert captured["api_key"] == "gemini-secret"
    assert captured["timeout"] == 33


def test_gemini_legacy_output_is_still_readable() -> None:
    assert extract_gemini_text({"outputs": [{"type": "text", "text": "legacy"}]}) == "legacy"


def test_provider_factory_and_models() -> None:
    config = {"model": "openai-x", "deepseek_model": "deepseek-x", "gemini_model": "gemini-x"}
    assert model_for_provider(config, "openai") == "openai-x"
    assert model_for_provider(config, "deepseek") == "deepseek-x"
    assert model_for_provider(config, "gemini") == "gemini-x"
    assert isinstance(create_ai_client("deepseek", "key", "model", 10), DeepSeekClient)
    assert isinstance(create_ai_client("gemini", "key", "model", 10), GeminiClient)
    with pytest.raises(ConfigurationError):
        model_for_provider(config, "unknown")
