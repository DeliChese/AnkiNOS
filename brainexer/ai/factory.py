from __future__ import annotations

from typing import Any, Dict

from ..core.exceptions import ConfigurationError
from .base import StructuredAIClient
from .client import OpenAIClient, OpenAIConfig
from .deepseek_client import DeepSeekClient, DeepSeekConfig
from .gemini_client import GeminiClient, GeminiConfig


PROVIDERS = ("openai", "deepseek", "gemini")
PROVIDER_LABELS = {"openai": "OpenAI", "deepseek": "DeepSeek", "gemini": "Gemini"}


def model_for_provider(config: Dict[str, Any], provider: str) -> str:
    defaults = {
        "openai": "gpt-5-mini",
        "deepseek": "deepseek-v4-flash",
        "gemini": "gemini-2.5-flash",
    }
    keys = {"openai": "model", "deepseek": "deepseek_model", "gemini": "gemini_model"}
    if provider not in PROVIDERS:
        raise ConfigurationError("Provider không được hỗ trợ: {}".format(provider))
    return str(config.get(keys[provider], defaults[provider])).strip() or defaults[provider]


def create_ai_client(provider: str, api_key: str, model: str, timeout_seconds: int) -> StructuredAIClient:
    if provider == "openai":
        return OpenAIClient(api_key, OpenAIConfig(model, timeout_seconds))
    if provider == "deepseek":
        return DeepSeekClient(api_key, DeepSeekConfig(model, timeout_seconds))
    if provider == "gemini":
        return GeminiClient(api_key, GeminiConfig(model, timeout_seconds))
    raise ConfigurationError("Provider không được hỗ trợ: {}".format(provider))
