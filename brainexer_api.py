"""The profile-scoped BrainExer API used by the AnkiNOS dashboard."""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from .brainexer.ai.factory import PROVIDER_LABELS, PROVIDERS, create_ai_client, model_for_provider
from .brainexer.core.deck_reader import card_ids_for_deck, list_decks, sample_card_ids
from .brainexer.core.exceptions import APIError, BrainExerError, ConfigurationError, InsufficientDataError, KeyringError
from .brainexer.core.mistake_bank import add_mistake_note_with_changes, mistake_fields
from .brainexer.core.models import AI_GRADED_TYPES, KNOWLEDGE_TYPES, DeckInfo, GeneratedExercise
from .brainexer.core.rate_limiter import RateLimiter
from .brainexer.core.service import BrainExerService, ServiceConfig, submit_objective
from .brainexer.db.connection import Database, validate_database
from .brainexer.security.keyring_store import KeyringStore
from .media_store import profile_dir

ROOT = Path(__file__).resolve().parent
DATABASE_NAME = "brainexer.sqlite3"
EXERCISES = {
    "recall": "Gợi nhớ kiến thức",
    "multiple_choice": "Trắc nghiệm",
    "application": "Vận dụng kiến thức",
    "fill_blank": "Điền vào chỗ trống",
    "synonym_antonym": "Đồng nghĩa / trái nghĩa",
    "word_form": "Biến đổi từ loại",
    "nuance": "Phân biệt sắc thái",
    "writing_free": "Luyện viết tự do",
}
LIMITS = {
    "max_api_calls_per_day": (0, 10000),
    "max_api_calls_per_week": (0, 100000),
    "max_exercises_per_day": (0, 10000),
    "max_exercises_per_week": (0, 100000),
}
TEXT_SETTINGS = ("model", "deepseek_model", "gemini_model", "language", "feedback_language", "learner_level")
BOOL_SETTINGS = ("ai_data_consent", "store_raw_responses")
QUESTION_FIELDS = ("question_prompt", "options", "suggested_length", "target_words_to_use")
MISTAKE_FIELDS = (
    "id", "deck_name", "exercise_type", "prompt_shown", "mistake_type", "original_text",
    "corrected_text", "explanation", "severity", "mastered", "linked_anki_note_id",
)
MISTAKES_PER_PAGE = 20


@lru_cache(maxsize=1)
def _defaults() -> dict:
    return json.loads((ROOT / "brainexer" / "config.json").read_text(encoding="utf-8"))


def clean_config(values: Any, *, strict: bool = False) -> dict:
    if not isinstance(values, dict):
        if strict:
            raise ValueError("Cấu hình BrainExer không hợp lệ.")
        values = {}
    config = _defaults().copy()
    for key in config:
        if key not in values:
            continue
        value = values[key]
        if key == "provider":
            valid = isinstance(value, str) and value in PROVIDERS
        elif key in BOOL_SETTINGS:
            valid = type(value) is bool
        elif key in TEXT_SETTINGS:
            valid = isinstance(value, str) and len(value) <= 160 and (bool(value.strip()) or key == "learner_level")
            if valid:
                value = value.strip()
        else:
            minimum, maximum = LIMITS.get(key, (10, 300))
            valid = type(value) is int and minimum <= value <= maximum
        if valid:
            config[key] = value
        elif strict:
            raise ValueError("Hãy kiểm tra lại model, ngôn ngữ và các giới hạn trong cài đặt BrainExer.")
    return config


def positive_id(value: Any) -> int:
    if isinstance(value, str) and value.isascii() and value.isdecimal() and len(value) <= 19:
        value = int(value)
    if type(value) is not int or not 0 < value <= 2**63 - 1:
        raise ValueError("Mã mục BrainExer không hợp lệ.")
    return value


@dataclass(frozen=True)
class AnkiMistake:
    changes: Any
    note_id: int


class BrainExer:
    def __init__(self, profile: str, config: dict, root: Path = ROOT) -> None:
        self.profile = profile
        self.config = clean_config(config)
        self.path = profile_dir(root, profile) / DATABASE_NAME
        self.legacy_path = root / "brainexer" / "user_files" / "brainexer.db"

    def status(self) -> dict:
        try:
            keyring = KeyringStore(account=self.profile)
            keys = {provider: bool(keyring.get_api_key(provider)) for provider in PROVIDERS}
            keyring_error = ""
        except KeyringError:
            keys = {}
            keyring_error = "Không truy cập được kho khóa của hệ điều hành."
        return {
            "config": self.config, "keys": keys, "keyring_error": keyring_error,
            "providers": PROVIDER_LABELS, "exercises": EXERCISES, "knowledge_types": KNOWLEDGE_TYPES,
            "usage": self.usage(),
            "can_import": self.legacy_path.is_file() and not self.path.exists(),
        }

    @staticmethod
    def decks(col: Any) -> dict:
        return {
            "decks": [{"id": str(deck.id), "name": deck.name} for deck in list_decks(col)],
            "selected": str(col.decks.selected()),
        }

    def save_key(self, provider: str, key: Any, delete: bool = False) -> None:
        if not isinstance(key, str) or len(key) > 2048:
            raise ValueError("API key không hợp lệ.")
        if delete:
            KeyringStore(account=self.profile).delete_api_key(provider)
        elif key.strip():
            KeyringStore(account=self.profile).set_api_key(key, provider)

    def usage(self) -> dict:
        if not self.path.exists():
            return dict.fromkeys(("api_day", "api_week", "exercise_day", "exercise_week"), 0)
        return RateLimiter(Database(self.path)).usage()

    def _service(self, database: Database | None = None) -> BrainExerService:
        config = self.config
        provider = config["provider"]
        label = PROVIDER_LABELS[provider]
        if not config["ai_data_consent"]:
            raise ConfigurationError(f"Hãy xác nhận chia sẻ dữ liệu với {label} trong Cài đặt AI.")
        key = KeyringStore(account=self.profile).get_api_key(provider)
        if not key:
            raise ConfigurationError(f"Hãy thêm API key {label} trong Cài đặt AI.")
        model = model_for_provider(config, provider)
        client = create_ai_client(provider, key, model, config["request_timeout_seconds"])
        if database is None:
            database = Database(self.path)
        database.sync_limits({setting: config[setting] for setting in LIMITS})
        return BrainExerService(
            database, RateLimiter(database), client,
            ServiceConfig(provider, model, config["language"], config["feedback_language"],
                          config["learner_level"], config["store_raw_responses"]),
        )

    @staticmethod
    def prepare(col: Any, deck_id: int, include_children: bool, exercise_type: str) -> tuple:
        if not (deck := col.decks.get(deck_id, default=False)):
            raise ValueError("Bộ thẻ đã bị xóa hoặc không còn khả dụng.")
        deck = DeckInfo(deck_id, deck["name"])
        card_ids = card_ids_for_deck(col, deck, include_children)
        sources = sample_card_ids(col, card_ids, 5 if exercise_type in AI_GRADED_TYPES else 2)
        if not sources:
            raise InsufficientDataError("Bộ thẻ không có nội dung văn bản phù hợp để tạo bài.")
        return deck, len(card_ids), sources

    def generate(self, exercise_type: str, include_children: bool, prepared: tuple) -> dict:
        service = self._service()
        database = service.database
        deck, count, sources = prepared
        session_id = database.create_session(deck.id, deck.name, count, include_children, [exercise_type],
                                             "auto" if exercise_type in KNOWLEDGE_TYPES else self.config["language"],
                                             self.config["learner_level"])
        try:
            exercise = service.generate_exercise(session_id, exercise_type, sources)
        finally:
            database.end_session(session_id)
        return {
            "id": exercise.exercise_id, "type": exercise_type, "deck_name": deck.name,
            "card_count": count, "hint": exercise.data["hint"] or exercise.data["example_opening"],
            **{key: exercise.data[key] for key in QUESTION_FIELDS},
        }

    def submit(self, exercise_id: int, answer: Any) -> dict:
        if not isinstance(answer, str) or not answer.strip() or len(answer) > 6000:
            raise ValueError("Hãy nhập câu trả lời từ 1 đến 6.000 ký tự.")
        if not self.path.exists():
            raise ValueError("Không tìm thấy bài tập trong hồ sơ này.")
        database = Database(self.path)
        row = database.get_exercise(exercise_id)
        if row is None:
            raise ValueError("Không tìm thấy bài tập trong hồ sơ này.")
        previous = database.get_attempt(exercise_id)
        if previous is not None:
            return {"score": previous["score"], "feedback": json.loads(previous["feedback_payload"])}
        exercise = GeneratedExercise(exercise_id, row["session_id"], row["exercise_type"], json.loads(row["exercise_payload"]))
        if exercise.exercise_type in AI_GRADED_TYPES:
            result = self._service(database).grade_writing(exercise, answer, source_context=json.loads(row["source_context"]))
        else:
            result = submit_objective(database, exercise, answer)
        return asdict(result)

    def mistakes(self, include_mastered: bool, offset: int) -> dict:
        if not self.path.exists():
            return {"rows": [], "more": False}
        rows = Database(self.path).list_mistakes(include_mastered, limit=MISTAKES_PER_PAGE + 1, offset=offset)
        return {
            "rows": [{key: row[key] for key in MISTAKE_FIELDS} for row in rows[:MISTAKES_PER_PAGE]],
            "more": len(rows) > MISTAKES_PER_PAGE,
        }

    def _mistake(self, mistake_id: int) -> tuple:
        if self.path.exists():
            database = Database(self.path)
            if (mistake := database.get_mistake(mistake_id)) is not None:
                return database, mistake
        raise ValueError("Không tìm thấy lỗi này trong hồ sơ.")

    def set_mastered(self, mistake_id: int, mastered: bool) -> None:
        database, mistake = self._mistake(mistake_id)
        if bool(mistake["mastered"]) != mastered:
            database.set_mastered(mistake_id, mastered)

    def add_mistake(self, col: Any, mistake_id: int) -> AnkiMistake:
        from anki.collection import OpChanges
        from anki.errors import NotFoundError

        database, mistake = self._mistake(mistake_id)
        linked_id = mistake["linked_anki_note_id"]
        tag = f"brainexer::records::{self.path.parent.name}::m{mistake_id}"
        fields = mistake_fields(mistake)
        candidates = col.find_notes(f"tag:{tag}")
        if linked_id and linked_id not in candidates:
            candidates = [linked_id, *candidates]
        for candidate in candidates:
            try:
                note = col.get_note(candidate)
            except NotFoundError:
                continue
            if "brainexer::mistake" not in note.tags or "Sai" not in note or "Đúng" not in note:
                continue
            escaped = (fields["Sai"], fields["Đúng"])
            original = (mistake["original_text"], mistake["corrected_text"])
            if (note["Sai"], note["Đúng"]) in (escaped, original):
                if candidate != linked_id:
                    cards = col.card_ids_of_note(candidate)
                    database.link_anki_note(mistake_id, int(candidate), int(cards[0]) if cards else None)
                return AnkiMistake(OpChanges(), int(candidate))
        note_id, card_id, changes = add_mistake_note_with_changes(col, mistake, tag)
        database.link_anki_note(mistake_id, note_id, card_id)
        return AnkiMistake(changes, note_id)

    def import_legacy(self) -> None:
        if self.path.exists() or not self.legacy_path.is_file():
            raise ValueError("Chỉ có thể nhập sổ lỗi cũ trước khi hồ sơ có dữ liệu BrainExer.")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(dir=self.path.parent, prefix=".brainexer-") as directory:
            snapshot = Path(directory) / DATABASE_NAME
            with (closing(sqlite3.connect(self.legacy_path.resolve().as_uri() + "?mode=ro", uri=True)) as source,
                  closing(sqlite3.connect(snapshot)) as target):
                source.backup(target)
            validate_database(snapshot)
            snapshot.rename(self.path)


def error_message(error: Exception) -> str:
    if isinstance(error, APIError):
        return "Nhà cung cấp AI không xử lý được yêu cầu. Hãy kiểm tra kết nối, model, API key và hạn mức."
    if isinstance(error, KeyringError):
        return "Không truy cập được kho khóa của hệ điều hành."
    if isinstance(error, (BrainExerError, ValueError)):
        return str(error)[:800]
    return "Không thể hoàn tất thao tác BrainExer."
