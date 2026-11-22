"""The profile-scoped BrainExer API used by the AnkiNOS dashboard."""

from __future__ import annotations

import json
import re
import sqlite3
from contextlib import closing
from dataclasses import asdict, dataclass, replace
from datetime import date
from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from .brainexer.ai.factory import PROVIDER_LABELS, PROVIDERS, create_ai_client, model_for_provider
from .brainexer.audio import VOICES, SPEEDS, cache_key, cached_audio, cleanup_audio
from .brainexer.core.deck_reader import card_ids_for_deck, list_decks, sample_card_ids
from .brainexer.core.hub import (
    DEFAULT_LISTENING_DIFFICULTY, GAME_MODES, LISTENING_DIFFICULTIES, LOCAL_MODES,
    MODE_DECK_KIND, MODE_LABELS, calculation_question, listening_grade, local_question,
)
from .brainexer.core.exceptions import APIError, BrainExerError, ConfigurationError, InsufficientDataError, KeyringError
from .brainexer.core.mistake_bank import add_mistake_note_with_changes, mistake_fields
from .brainexer.core.models import AI_GRADED_TYPES, KNOWLEDGE_TYPES, DeckInfo, GeneratedExercise
from .brainexer.core.rate_limiter import RateLimiter
from .brainexer.core.service import BrainExerService, ServiceConfig, submit_objective
from .brainexer.db.connection import Database, validate_database
from .brainexer.security.keyring_store import KeyringStore
from .brainexer.hub_store import HubStore
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
    "quick_seconds": (0, 600),
    "game_seconds": (0, 600),
    "listening_prefetch": (0, 3),
    "max_listens_per_sentence": (0, 20),
}
TEXT_SETTINGS = ("model", "deepseek_model", "gemini_model", "language", "feedback_language", "learner_level", "azure_region")
BOOL_SETTINGS = ("ai_data_consent", "store_raw_responses", "azure_data_consent", "game_mistakes", "allow_anki_mistake_export", "ignore_accents", "half_spelling")
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
            valid = isinstance(value, str) and len(value) <= 160 and (bool(value.strip()) or key in ("learner_level", "azure_region"))
            if valid:
                value = value.strip()
        elif key == "review_intervals":
            valid = isinstance(value, str) and bool(re.fullmatch(r"[1-9][0-9]{0,2}(?:,[1-9][0-9]{0,2}){0,7}", value))
            if valid:
                parts = [int(part) for part in value.split(",")]
                valid = all(left < right <= 365 for left, right in zip([0, *parts[:-1]], parts))
        else:
            minimum, maximum = LIMITS.get(key, (0, 1_000_000) if key == "max_tts_chars_per_month" else
                                          (1, 100) if key == "review_daily_limit" else (10, 300))
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
            keys = {provider: bool(keyring.get_api_key(provider)) for provider in (*PROVIDERS, "azure")}
            keyring_error = ""
        except KeyringError:
            keys = {}
            keyring_error = "Không truy cập được kho khóa của hệ điều hành."
        return {
            "config": self.config, "keys": keys, "keyring_error": keyring_error,
            "providers": PROVIDER_LABELS, "exercises": EXERCISES, "knowledge_types": KNOWLEDGE_TYPES,
            "usage": self.usage(),
            "can_import": self.legacy_path.is_file() and not self.path.exists(),
            "hub_modes": MODE_LABELS,
            "voices": VOICES, "speeds": list(SPEEDS),
            "deck_kinds": HubStore(self.path).deck_kinds() if self.path.exists() else {},
            "tts_used": HubStore(self.path).tts_usage() if self.path.exists() else 0,
            "profile_folder": self.path.parent.name,
        }

    def review_intervals(self) -> tuple[int, ...]:
        return tuple(int(part) for part in self.config["review_intervals"].split(","))

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

    def prepare(self, col: Any, deck_id: int, include_children: bool, exercise_type: str,
                preferred_ids: list[int] | None = None) -> tuple:
        if not (deck := col.decks.get(deck_id, default=False)):
            raise ValueError("Bộ thẻ đã bị xóa hoặc không còn khả dụng.")
        deck = DeckInfo(deck_id, deck["name"])
        card_ids = card_ids_for_deck(col, deck, include_children)
        size = 12 if exercise_type in LOCAL_MODES else 5 if exercise_type in ("application", "sentence") else 2
        preferred = (HubStore(self.path).listening_priority(deck.name, include_children)
                     if exercise_type == "listening" and self.path.exists() else
                     preferred_ids if exercise_type == "listening_reflex" else [])
        sources = sample_card_ids(col, card_ids, size, preferred)
        if not sources:
            raise InsufficientDataError("Bộ thẻ không có nội dung văn bản phù hợp để tạo bài.")
        return deck, len(card_ids), sources

    def hub_kind(self, deck_name: str, kind: str) -> None:
        HubStore(self.path).set_deck_kind(deck_name, kind)

    def hub_fields(self, prepared: tuple) -> dict:
        deck, _count, sources = prepared
        names = list(dict.fromkeys(name for source in sources for name in source.fields))
        return {"fields": names, "roles": HubStore(self.path).field_roles(deck.name)}

    def hub_field_names(self, col: Any, deck_id: int, include_children: bool) -> dict:
        selected = col.decks.get(deck_id, default=False)
        if not selected:
            raise ValueError("Bộ thẻ đã bị xóa hoặc không còn khả dụng.")
        name = selected["name"]
        deck_ids = [item.id for item in list_decks(col)
                    if item.name == name or include_children and item.name.startswith(name + "::")]
        model_ids: set[int] = set()
        for start in range(0, len(deck_ids), 500):
            batch = deck_ids[start:start + 500]
            placeholders = ",".join("?" for _ in batch)
            model_ids.update(int(row[0]) for row in col.db.all(
                "SELECT DISTINCT n.mid FROM cards c JOIN notes n ON n.id=c.nid "
                f"WHERE c.did IN ({placeholders})", *batch))
        fields = list(dict.fromkeys(field["name"] for model_id in sorted(model_ids)
                                    for field in col.models.get(model_id)["flds"]))
        return {"fields": fields, "roles": HubStore(self.path).field_roles(name)}

    def hub_set_fields(self, deck_name: str, kind: str, question: str, answer: str) -> None:
        HubStore(self.path).set_field_roles(deck_name, kind, question, answer)

    def _field_sources(self, deck_name: str, sources: list) -> list:
        roles = HubStore(self.path).field_roles(deck_name)
        question, answer = roles["question_field"], roles["answer_field"]
        if not question:
            return sources
        selected = [replace(source, target=source.fields[question], context=source.fields[answer])
                    for source in sources if source.fields.get(question) and source.fields.get(answer)]
        if not selected:
            raise InsufficientDataError("Bộ thẻ chưa có nội dung trong hai trường đã chọn. Hãy chỉnh vai trò trường.")
        return selected

    def hub_next(self, prepared: tuple, mode: str, kind: str, session_id: int = 0,
                 voice: str = "") -> dict:
        if kind not in MODE_DECK_KIND.get(mode, set()):
            raise ValueError("Dạng bài không phù hợp loại bộ thẻ.")
        deck, _count, sources = prepared
        store = HubStore(self.path)
        if store.deck_kind(deck.name) != kind:
            raise ValueError("Hãy xác nhận loại bộ thẻ trước khi luyện.")
        sources = self._field_sources(deck.name, sources)
        if mode in LOCAL_MODES:
            if mode == "listening_reflex":
                if voice not in VOICES.values():
                    raise ValueError("Giọng đọc không hợp lệ.")
                directory = self.path.parent / "brainexer_audio"
                sources = [source for source in sources if
                           (directory / f"{cache_key(source.target, voice, '1')}.mp3").is_file()]
                if len(sources) < 4:
                    raise ValueError("Phản xạ nghe cần ít nhất bốn từ đã có audio. Hãy chuẩn bị lại.")
            try:
                question_number = store.summary(session_id)["count"] if session_id and mode == "quick" else 0
                payload = local_question(mode, sources, kind, question_number)
            except ValueError:
                if mode in ("multiple_choice", "fill_blank", "phrase"):
                    return self.hub_ai_next(prepared, mode, kind, session_id)
                raise
            if mode == "listening_reflex":
                payload["audio_hash"] = cache_key(payload["answers"][0], voice, "1")
            if not session_id:
                session_id = store.start(deck.id, deck.name, kind, mode,
                                         "game" if mode in GAME_MODES else "practice")
            question = store.question(session_id, payload)
            return {"session_id": session_id, "question": question}
        raise ValueError("Dạng bài cần dịch vụ AI.")

    def reflex_prepare(self, prepared: tuple, voice: str) -> dict:
        if voice not in VOICES.values():
            raise ValueError("Giọng đọc không hợp lệ.")
        sources = list({source.target.casefold(): source for source in self._field_sources(prepared[0].name, prepared[2])
                        if source.target and source.context}.values())
        directory = self.path.parent / "brainexer_audio"
        selected = sources
        cached = [source for source in selected if
                  (directory / f"{cache_key(source.target, voice, '1')}.mp3").is_file()]
        if len(cached) >= 4:
            return {"prepared": len(cached), "card_ids": [source.card_id for source in cached],
                    "tts_used": HubStore(self.path).tts_usage()}
        missing = [source for source in selected if not
                   (directory / f"{cache_key(source.target, voice, '1')}.mp3").is_file()]
        if missing:
            if not self.config["azure_data_consent"]:
                raise ConfigurationError("Hãy xác nhận gửi từ cần đọc tới Azure Speech trong Cài đặt AI.")
            key = KeyringStore(account=self.profile).get_api_key("azure")
            if not key or not self.config["azure_region"]:
                raise ConfigurationError("Hãy nhập khóa và khu vực Azure Speech để chuẩn bị audio game.")
            database = Database(self.path)
            for source in missing[:4 - len(cached)]:
                cached_audio(database, directory, source.target, voice, "1",
                             self.config["azure_region"], key,
                             self.config["max_tts_chars_per_month"])
        ready = [source for source in selected if
                 (directory / f"{cache_key(source.target, voice, '1')}.mp3").is_file()]
        if len(ready) < 4:
            raise ValueError("Phản xạ nghe cần ít nhất bốn từ khác nhau có audio.")
        return {"prepared": len(ready), "card_ids": [source.card_id for source in ready],
                "tts_used": HubStore(self.path).tts_usage()}

    def hub_ai_next(self, prepared: tuple, mode: str, kind: str, session_id: int = 0, *,
                    listening_difficulty: str = DEFAULT_LISTENING_DIFFICULTY) -> dict:
        if kind not in MODE_DECK_KIND.get(mode, set()):
            raise ValueError("Dạng bài không phù hợp loại bộ thẻ.")
        deck, count, sources = prepared
        store = HubStore(self.path)
        if store.deck_kind(deck.name) != kind:
            raise ValueError("Hãy xác nhận loại bộ thẻ trước khi luyện.")
        sources = self._field_sources(deck.name, sources)
        if mode == "application" and (payload := calculation_question(sources)):
            if not session_id:
                session_id = store.start(deck.id, deck.name, kind, mode)
            return {"session_id": session_id, "question": store.question(session_id, payload)}
        service = self._service(store.database)
        new_session = not session_id
        if new_session:
            session_id = store.start(deck.id, deck.name, kind, mode)
        try:
            exercise = service.generate_exercise(
                session_id, mode, sources, knowledge_override=kind == "knowledge",
                listening_difficulty=listening_difficulty,
            )
        except Exception:
            if new_session:
                store.finish(session_id)
            raise
        data = exercise.data
        return {"session_id": session_id, "usage": self.usage(), "question": {
            "id": exercise.exercise_id, "mode": mode, "prompt": data["question_prompt"],
            "answers": data["correct_answers"], "options": data["options"],
            "explanation": data["explanation"], "hint": data["hint"],
            "source_card_id": sources[0].card_id, "deck_kind": kind,
        }}

    def hub_answer(self, exercise_id: int, answer: str, confidence: str = "",
                   hint: bool = False, response_ms: int = 0,
                   today: date | None = None, self_score: int | None = None) -> dict:
        database = Database(self.path)
        row = database.get_exercise(exercise_id)
        if row is None:
            raise ValueError("Không tìm thấy câu hỏi.")
        if row["provider"] == "local":
            return HubStore(self.path).answer(exercise_id, answer, confidence=confidence, hint=hint,
                                               response_ms=response_ms,
                                               today=today,
                                               ignore_accents=self.config["ignore_accents"],
                                               game_mistakes=self.config["game_mistakes"],
                                               intervals=self.review_intervals(), self_score=self_score)
        if row["exercise_type"] == "listening":
            raise ValueError("Hãy chấm câu nghe từ Thư viện câu nghe.")
        if self_score is not None:
            manual = HubStore(self.path).manual_ai_result(
                exercise_id, answer, confidence, response_ms, today,
                self.review_intervals(), self_score)
            manual["usage"] = self.usage()
            return manual
        with closing(database.connect()) as connection:
            deck_kind = connection.execute("SELECT deck_kind FROM sessions WHERE id=?",
                                           (row["session_id"],)).fetchone()[0]
        try:
            result = self.submit(exercise_id, answer,
                                 ignore_accents=deck_kind == "language" and self.config["ignore_accents"])
        except BrainExerError as error:
            manual = HubStore(self.path).manual_ai_result(
                exercise_id, answer, confidence, response_ms, today,
                self.review_intervals(), reason=error_message(error))
            manual["usage"] = self.usage()
            return manual
        graded = HubStore(self.path).record_ai_result(
            exercise_id, float(result["score"] or 0), confidence, response_ms, today,
            self.review_intervals(),
        )
        graded["usage"] = self.usage()
        return graded

    def hub_summary(self, session_id: int, finish: bool = False) -> dict:
        store = HubStore(self.path)
        return store.finish(session_id) if finish else store.summary(session_id)

    def listening_generate(self, prepared: tuple, voice: str, speed: str,
                           session_id: int = 0, force_new: bool = False, *,
                           difficulty: str = DEFAULT_LISTENING_DIFFICULTY) -> dict:
        if difficulty not in LISTENING_DIFFICULTIES:
            raise ValueError("Độ khó câu nghe không hợp lệ.")
        if not self.config["azure_data_consent"]:
            raise ConfigurationError("Hãy xác nhận gửi câu văn bản tới Azure Speech.")
        if not self.config["ai_data_consent"]:
            raise ConfigurationError("Hãy xác nhận gửi dữ liệu thẻ tới nhà cung cấp AI.")
        if voice not in VOICES.values() or speed not in SPEEDS:
            raise ValueError("Giọng hoặc tốc độ không hợp lệ.")
        key = KeyringStore(account=self.profile).get_api_key("azure")
        if not key or not self.config["azure_region"]:
            raise ConfigurationError("Hãy nhập khóa và khu vực Azure Speech.")
        store = HubStore(self.path)
        pending = None if force_new else store.pending_listening(prepared[0].name, session_id, difficulty)
        if not pending and store.tts_usage() >= self.config["max_tts_chars_per_month"]:
            raise ValueError("Đã đạt giới hạn ký tự Azure Speech trong tháng; hãy dùng Thư viện câu nghe.")
        if pending:
            exercise_id, session_id = pending["id"], pending["session_id"]
        else:
            result = self.hub_ai_next(
                prepared, "listening", "language", session_id, listening_difficulty=difficulty,
            )
            exercise_id, session_id = result["question"]["id"], result["session_id"]
        database = Database(self.path)
        exercise = database.get_exercise(exercise_id)
        data = json.loads(exercise["exercise_payload"])
        sentence = data["question_prompt"]
        targets = data["target_words_to_use"]
        def contains_target(word: str) -> bool:
            if not word.strip():
                return False
            if re.search(r"[\u3400-\u9fff\u3040-\u30ff]", word):
                return word.casefold() in sentence.casefold()
            return bool(re.search(r"(?<!\w)" + re.escape(word) + r"(?!\w)", sentence,
                                  flags=re.IGNORECASE))
        if not targets or not all(contains_target(word) for word in targets):
            store.skip_exercise(exercise_id)
            raise ValueError("Câu nghe chưa chứa từ mục tiêu, hãy tạo lại.")
        directory = self.path.parent / "brainexer_audio"
        digest = cached_audio(database, directory, sentence, voice, speed,
                              self.config["azure_region"], key, self.config["max_tts_chars_per_month"])
        item_id = store.listening_item(
            prepared[0].name, sentence, data["target_meaning"], targets,
            self.config["learner_level"], voice, speed, digest,
        )
        return {"item_id": item_id, "audio_hash": digest, "session_id": session_id,
                "exercise_id": exercise_id, "voice": voice, "speed": speed,
                "hint_initials": " ".join(word[:1] + "…" for word in sentence.split()),
                "hint_translation": data["target_meaning"], "tts_used": store.tts_usage(),
                "usage": self.usage()}

    def listening_library(self, deck_name: str = "") -> list[dict]:
        return HubStore(self.path).listening_items(deck_name) if self.path.exists() else []

    def listening_cleanup(self) -> dict:
        if not self.path.exists():
            return {"removed": 0, "freed_bytes": 0, "total_bytes": 0}
        return cleanup_audio(Database(self.path), self.path.parent / "brainexer_audio", 0)

    def listening_respeed(self, item_id: int, speed: str) -> dict:
        if speed not in SPEEDS:
            raise ValueError("Tốc độ nghe không hợp lệ.")
        store = HubStore(self.path)
        with closing(store.database.connect()) as connection:
            item = connection.execute("SELECT * FROM listening_items WHERE id=?", (item_id,)).fetchone()
        if item is None:
            raise ValueError("Không tìm thấy câu nghe.")
        directory = self.path.parent / "brainexer_audio"
        digest = cache_key(item["sentence"], item["voice"], speed)
        if not (directory / f"{digest}.mp3").is_file():
            if not self.config["azure_data_consent"]:
                raise ConfigurationError("Hãy xác nhận gửi câu văn bản tới Azure Speech trong Cài đặt AI.")
            key = KeyringStore(account=self.profile).get_api_key("azure")
            if not key or not self.config["azure_region"]:
                raise ConfigurationError("Hãy nhập khóa và khu vực Azure Speech.")
            cached_audio(store.database, directory, item["sentence"], item["voice"], speed,
                         self.config["azure_region"], key, self.config["max_tts_chars_per_month"])
        new_id = store.listening_item(item["deck_name"], item["sentence"], item["translation"],
                                      json.loads(item["targets"]), item["level"],
                                      item["voice"], speed, digest)
        return {"item_id": new_id, "audio_hash": digest, "tts_used": store.tts_usage()}

    def listening_answer(self, item_id: int, answer: str, hint: bool = False,
                         exercise_id: int = 0, today: date | None = None,
                         response_ms: int = 0) -> dict:
        if not isinstance(answer, str) or len(answer) > 6000:
            raise ValueError("Câu trả lời không hợp lệ.")
        store = HubStore(self.path)
        with closing(store.database.connect()) as connection:
            item = connection.execute("SELECT * FROM listening_items WHERE id=?", (item_id,)).fetchone()
        if item is None:
            raise ValueError("Không tìm thấy câu nghe.")
        feedback = listening_grade(item["sentence"], answer, half_spelling=self.config["half_spelling"])
        feedback["sentence"] = item["sentence"]
        feedback["score"] = round(max(0, feedback["accuracy"] - (.1 if hint else 0)) * 10, 1)
        if exercise_id:
            store.listening_attempt(exercise_id, answer, feedback, today, self.review_intervals(),
                                    response_ms, hint, item_id)
        else:
            store.listening_result(item_id, feedback["accuracy"])
        return feedback

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

    def submit(self, exercise_id: int, answer: Any, *, ignore_accents: bool = False) -> dict:
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
            result = submit_objective(database, exercise, answer, ignore_accents=ignore_accents)
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
