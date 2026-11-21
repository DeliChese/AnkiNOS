from __future__ import annotations

from typing import Dict, Optional, Tuple

from brainexer.security.keyring_store import KeyringStore


class FakeBackend:
    def __init__(self) -> None:
        self.values: Dict[Tuple[str, str], str] = {}

    def get(self, service: str, account: str) -> Optional[str]:
        return self.values.get((service, account))

    def set(self, service: str, account: str, secret: str) -> None:
        self.values[(service, account)] = secret

    def delete(self, service: str, account: str) -> None:
        self.values.pop((service, account), None)


def test_keyring_store_round_trip_without_files() -> None:
    backend = FakeBackend()
    store = KeyringStore("Profile 1", backend=backend)
    store.set_api_key("  sk-test  ")
    assert store.get_api_key() == "sk-test"
    assert "sk-test" not in repr(store.__dict__)
    store.delete_api_key()
    assert store.get_api_key() is None


def test_keyring_store_separates_provider_keys() -> None:
    backend = FakeBackend()
    store = KeyringStore("Profile 1", backend=backend)
    store.set_api_key("openai-key", "openai")
    store.set_api_key("deepseek-key", "deepseek")
    store.set_api_key("gemini-key", "gemini")

    assert store.get_api_key("openai") == "openai-key"
    assert store.get_api_key("deepseek") == "deepseek-key"
    assert store.get_api_key("gemini") == "gemini-key"

    store.delete_api_key("deepseek")
    assert store.get_api_key("deepseek") is None
    assert store.get_api_key("openai") == "openai-key"
    assert store.get_api_key("gemini") == "gemini-key"
