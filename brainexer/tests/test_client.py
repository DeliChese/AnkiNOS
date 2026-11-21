from __future__ import annotations

import json

from brainexer.ai.client import OpenAIClient, OpenAIConfig


class FakeResponse:
    def __init__(self, body: dict) -> None:
        self.body = json.dumps(body).encode("utf-8")
        self.headers = {"x-request-id": "req-server"}

    def __enter__(self):
        return self

    def __exit__(self, *args) -> None:
        return None

    def read(self) -> bytes:
        return self.body


def test_responses_request_uses_strict_schema_and_store_false(monkeypatch) -> None:
    captured = {}

    def fake_urlopen(request, timeout):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["authorization"] = request.get_header("Authorization")
        captured["timeout"] = timeout
        return FakeResponse({
            "status": "completed",
            "output": [{
                "type": "message",
                "content": [{"type": "output_text", "text": '{"status":"ok"}'}],
            }],
        })

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    client = OpenAIClient("test-secret", OpenAIConfig("test-model", timeout_seconds=25))
    result = client.create_structured(
        "system", "task", {"card": "data"}, "test_schema",
        {"type": "object", "properties": {}, "additionalProperties": False},
    )
    assert result.payload == {"status": "ok"}
    assert result.request_id == "req-server"
    assert captured["body"]["store"] is False
    assert captured["body"]["text"]["format"]["strict"] is True
    assert captured["authorization"] == "Bearer test-secret"
    assert captured["timeout"] == 25
