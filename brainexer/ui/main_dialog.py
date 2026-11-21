from __future__ import annotations

import html
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from aqt import mw
from aqt.operations import QueryOp
from aqt.qt import (
    QAction, QCheckBox, QComboBox, QDialog, QFormLayout, QHBoxLayout,
    QLabel, QPlainTextEdit, QPushButton, QTextBrowser, QVBoxLayout,
)
from aqt.utils import qconnect, showInfo, showWarning

from ..ai.factory import PROVIDER_LABELS, PROVIDERS, create_ai_client, model_for_provider
from ..core.deck_reader import card_ids_for_deck, list_decks, sample_sources
from ..core.exceptions import BrainExerError, ConfigurationError
from ..core.models import CardSource, DeckInfo, GeneratedExercise
from ..core.rate_limiter import RateLimiter
from ..core.service import BrainExerService, ServiceConfig
from ..db.connection import Database
from ..security.keyring_store import KeyringStore
from .mistakes_dialog import MistakesDialog
from .settings_dialog import SettingsDialog


ROOT = Path(__file__).resolve().parents[1]
LIMIT_KEYS = (
    "max_api_calls_per_day", "max_api_calls_per_week",
    "max_exercises_per_day", "max_exercises_per_week",
)
EXERCISE_LABELS = {
    "fill_blank": "Điền vào chỗ trống",
    "synonym_antonym": "Đồng nghĩa / trái nghĩa",
    "word_form": "Biến đổi từ loại",
    "nuance": "Phân biệt sắc thái",
    "writing_free": "Luyện viết tự do",
}
_database_instance: Optional[Database] = None
_registered = False


def addon_config() -> Dict[str, Any]:
    return dict(mw.addonManager.getConfig(__name__) or {})


def database() -> Database:
    global _database_instance
    if _database_instance is None:
        _database_instance = Database(ROOT / "user_files" / "brainexer.db")
    config = addon_config()
    _database_instance.sync_limits({key: int(config.get(key, 0)) for key in LIMIT_KEYS})
    return _database_instance


def keyring_store() -> KeyringStore:
    profile = getattr(mw.pm, "name", None) or "default"
    return KeyringStore(account=str(profile))


def save_config(config: Dict[str, Any]) -> None:
    mw.addonManager.writeConfig(__name__, config)
    database().sync_limits({key: int(config.get(key, 0)) for key in LIMIT_KEYS})


def open_settings() -> None:
    SettingsDialog(mw, addon_config(), keyring_store(), save_config).exec()


def open_mistakes() -> None:
    MistakesDialog(mw, database()).exec()


def open_practice() -> None:
    PracticeDialog(mw).exec()


class PracticeDialog(QDialog):
    def __init__(self, parent: Any) -> None:
        super().__init__(parent)
        self.setWindowTitle("Anki BrainExer")
        self.resize(760, 680)
        self.db = database()
        self.config = addon_config()
        self.current_exercise: Optional[GeneratedExercise] = None
        self.current_service: Optional[BrainExerService] = None
        self.session_id: Optional[int] = None
        self.session_deck_id: Optional[int] = None
        self._build_ui()
        self._load_decks()
        self._refresh_usage()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        form = QFormLayout()
        self.deck_combo = QComboBox()
        self.deck_combo.currentIndexChanged.connect(self._deck_changed)
        self.exercise_combo = QComboBox()
        for value, label in EXERCISE_LABELS.items():
            self.exercise_combo.addItem(label, value)
        self.exercise_combo.currentIndexChanged.connect(self._scope_changed)
        self.include_children = QCheckBox("Bao gồm deck con")
        self.include_children.setChecked(True)
        self.include_children.toggled.connect(self._scope_changed)
        self.count_label = QLabel("Đang đọc deck…")
        form.addRow("Deck", self.deck_combo)
        form.addRow("Dạng bài", self.exercise_combo)
        form.addRow("", self.include_children)
        form.addRow("Phạm vi", self.count_label)
        layout.addLayout(form)

        top_buttons = QHBoxLayout()
        self.generate_button = QPushButton("Tạo câu hỏi")
        self.generate_button.clicked.connect(self._generate)
        settings_button = QPushButton("Cài đặt")
        settings_button.clicked.connect(self._settings)
        mistakes_button = QPushButton("Sổ lỗi")
        mistakes_button.clicked.connect(lambda: MistakesDialog(self, self.db).exec())
        top_buttons.addWidget(self.generate_button)
        top_buttons.addWidget(settings_button)
        top_buttons.addWidget(mistakes_button)
        top_buttons.addStretch()
        layout.addLayout(top_buttons)

        self.question = QTextBrowser()
        self.question.setMinimumHeight(180)
        self.question.setHtml("<p>Chọn deck và bấm <b>Tạo câu hỏi</b>.</p>")
        layout.addWidget(self.question)
        self.answer = QPlainTextEdit()
        self.answer.setPlaceholderText("Nhập câu trả lời hoặc bài viết tại đây…")
        self.answer.setMinimumHeight(110)
        layout.addWidget(self.answer)

        answer_buttons = QHBoxLayout()
        self.submit_button = QPushButton("Nộp bài")
        self.submit_button.setEnabled(False)
        self.submit_button.clicked.connect(self._submit)
        self.hint_button = QPushButton("Xem gợi ý")
        self.hint_button.setEnabled(False)
        self.hint_button.clicked.connect(self._show_hint)
        answer_buttons.addWidget(self.submit_button)
        answer_buttons.addWidget(self.hint_button)
        answer_buttons.addStretch()
        layout.addLayout(answer_buttons)

        self.feedback = QTextBrowser()
        self.feedback.setMinimumHeight(150)
        layout.addWidget(self.feedback)
        self.usage_label = QLabel()
        layout.addWidget(self.usage_label)

    def _load_decks(self) -> None:
        self.deck_combo.blockSignals(True)
        self.deck_combo.clear()
        for deck in list_decks(mw.col):
            self.deck_combo.addItem(deck.name, deck)
        self.deck_combo.blockSignals(False)
        self._refresh_count()

    def _selected_deck(self) -> Optional[DeckInfo]:
        value = self.deck_combo.currentData()
        return value if isinstance(value, DeckInfo) else None

    def _deck_changed(self) -> None:
        if self.session_id is not None:
            self.db.end_session(self.session_id)
            self.session_id = None
            self.session_deck_id = None
        self._refresh_count()

    def _scope_changed(self) -> None:
        if self.session_id is not None:
            self.db.end_session(self.session_id)
            self.session_id = None
            self.session_deck_id = None
        self._refresh_count()

    def _refresh_count(self) -> None:
        deck = self._selected_deck()
        if deck is None:
            self.count_label.setText("Không có deck")
            return
        include_children = self.include_children.isChecked()
        self.count_label.setText("Đang đếm…")
        QueryOp(
            parent=self,
            op=lambda col: len(card_ids_for_deck(col, deck, include_children)),
            success=lambda count: self.count_label.setText("{} thẻ khả dụng".format(count)),
        ).run_in_background()

    def _service(self) -> BrainExerService:
        self.config = addon_config()
        provider = str(self.config.get("provider", "openai")).strip().casefold()
        if provider not in PROVIDERS:
            raise ConfigurationError("Provider không được hỗ trợ: {}".format(provider))
        provider_label = PROVIDER_LABELS[provider]
        if not self.config.get("ai_data_consent", False):
            raise ConfigurationError(
                "Hãy mở Cài đặt và đồng ý gửi dữ liệu được chọn tới {}.".format(provider_label)
            )
        api_key = keyring_store().get_api_key(provider)
        if not api_key:
            raise ConfigurationError("Chưa có {} API key trong OS Keyring.".format(provider_label))
        model = model_for_provider(self.config, provider)
        client = create_ai_client(
            provider,
            api_key,
            model,
            int(self.config.get("request_timeout_seconds", 60)),
        )
        service_config = ServiceConfig(
            provider=provider,
            model=model,
            language=str(self.config.get("language", "English")),
            feedback_language=str(self.config.get("feedback_language", "Vietnamese")),
            learner_level=str(self.config.get("learner_level", "")),
            store_raw_responses=bool(self.config.get("store_raw_responses", False)),
        )
        return BrainExerService(self.db, RateLimiter(self.db), client, service_config)

    def _generate(self) -> None:
        deck = self._selected_deck()
        if deck is None:
            showWarning("Không có deck để luyện.", parent=self)
            return
        try:
            service = self._service()
        except Exception as exc:
            showWarning(str(exc), parent=self)
            return
        self.current_service = service
        exercise_type = str(self.exercise_combo.currentData())
        include_children = self.include_children.isChecked()
        sample_size = 5 if exercise_type == "writing_free" else 2
        self._set_busy(True, "Đang đọc thẻ…")

        def prepare(col) -> Tuple[int, List[CardSource]]:
            card_ids = card_ids_for_deck(col, deck, include_children)
            return len(card_ids), sample_sources(col, deck, include_children, sample_size)

        def prepared(result: Tuple[int, List[CardSource]]) -> None:
            count, sources = result
            if not sources:
                self._on_error(BrainExerError("Deck không có field văn bản phù hợp."))
                return
            if self.session_id is None or self.session_deck_id != deck.id:
                self.session_id = self.db.create_session(
                    deck.id, deck.name, count, include_children, [exercise_type],
                    str(self.config.get("language", "English")),
                    str(self.config.get("learner_level", "")),
                )
                self.session_deck_id = deck.id
            self.question.setHtml("<p>Đang nhờ AI tạo bài tập…</p>")
            QueryOp(
                parent=self,
                op=lambda _col: service.generate_exercise(self.session_id or 0, exercise_type, sources),
                success=self._exercise_ready,
            ).without_collection().failure(self._on_error).run_in_background()

        QueryOp(parent=self, op=prepare, success=prepared).failure(self._on_error).run_in_background()

    def _exercise_ready(self, exercise: GeneratedExercise) -> None:
        self.current_exercise = exercise
        data = exercise.data
        pieces = ["<h3>{}</h3>".format(html.escape(str(data.get("question_prompt", ""))))]
        options = data.get("options", [])
        if options:
            pieces.append("<ol>{}</ol>".format("".join("<li>{}</li>".format(html.escape(str(x))) for x in options)))
        if data.get("suggested_length"):
            pieces.append("<p><i>Độ dài gợi ý: {}</i></p>".format(html.escape(str(data["suggested_length"]))))
        if data.get("target_words_to_use"):
            pieces.append("<p>Từ gợi ý: {}</p>".format(html.escape(", ".join(data["target_words_to_use"]))))
        self.question.setHtml("".join(pieces))
        self.answer.clear()
        self.feedback.clear()
        self._set_busy(False)
        self.submit_button.setEnabled(True)
        self.hint_button.setEnabled(bool(data.get("hint") or data.get("example_opening")))
        self._refresh_usage()

    def _submit(self) -> None:
        exercise = self.current_exercise
        if exercise is None:
            return
        user_answer = self.answer.toPlainText()
        if not user_answer.strip():
            showWarning("Hãy nhập câu trả lời trước.", parent=self)
            return
        self.submit_button.setEnabled(False)
        self.generate_button.setEnabled(False)
        if exercise.exercise_type != "writing_free":
            try:
                service = self.current_service or self._service()
                result = service.submit_objective(exercise, user_answer)
                self._show_feedback(result.feedback, result.score)
            except Exception as exc:
                self._on_error(exc)
                return
            self.generate_button.setEnabled(True)
            return

        try:
            service = self.current_service or self._service()
        except Exception as exc:
            self._on_error(exc)
            return
        self._set_busy(True, "AI đang chấm bài viết…")
        QueryOp(
            parent=self,
            op=lambda _col: service.grade_writing(exercise, user_answer),
            success=lambda result: self._writing_ready(result.feedback, result.score),
        ).without_collection().failure(self._on_error).run_in_background()

    def _writing_ready(self, feedback: Dict[str, Any], score: Optional[float]) -> None:
        self._set_busy(False)
        self._show_feedback(feedback, score)
        self._refresh_usage()

    def _show_feedback(self, feedback: Dict[str, Any], score: Optional[float]) -> None:
        parts = []
        if score is not None:
            parts.append("<h3>Điểm: {:.1f}/10</h3>".format(score))
        parts.append("<p>{}</p>".format(html.escape(str(feedback.get("summary", "")))))
        if feedback.get("explanation"):
            parts.append("<p>{}</p>".format(html.escape(str(feedback["explanation"]))))
        errors = feedback.get("errors", [])
        if errors:
            parts.append("<h4>Lỗi cần xem lại</h4><ul>")
            for error in errors:
                parts.append("<li><b>{}</b> → <b>{}</b>: {}</li>".format(
                    html.escape(str(error.get("original_text", ""))),
                    html.escape(str(error.get("corrected_text", ""))),
                    html.escape(str(error.get("explanation", ""))),
                ))
            parts.append("</ul>")
        suggestions = feedback.get("style_suggestions", [])
        if suggestions:
            parts.append("<h4>Gợi ý diễn đạt</h4><ul>")
            for item in suggestions:
                parts.append("<li>{}: {}</li>".format(
                    html.escape(str(item.get("suggested_text", ""))),
                    html.escape(str(item.get("note", ""))),
                ))
            parts.append("</ul>")
        self.feedback.setHtml("".join(parts))
        self.submit_button.setEnabled(False)
        self.generate_button.setEnabled(True)

    def _show_hint(self) -> None:
        if not self.current_exercise:
            return
        data = self.current_exercise.data
        hint = data.get("hint") or data.get("example_opening") or "Không có gợi ý."
        showInfo(str(hint), parent=self)

    def _settings(self) -> None:
        SettingsDialog(self, addon_config(), keyring_store(), save_config).exec()
        self.config = addon_config()
        self._refresh_usage()

    def _set_busy(self, busy: bool, message: str = "") -> None:
        self.generate_button.setEnabled(not busy)
        self.submit_button.setEnabled(not busy and self.current_exercise is not None)
        if message:
            self.feedback.setHtml("<p>{}</p>".format(html.escape(message)))

    def _on_error(self, error: Exception) -> None:
        self._set_busy(False)
        showWarning(str(error), parent=self)
        self._refresh_usage()

    def _refresh_usage(self) -> None:
        usage = RateLimiter(self.db).usage()
        config = addon_config()
        provider = str(config.get("provider", "openai")).strip().casefold()
        provider_label = PROVIDER_LABELS.get(provider, provider or "không xác định")
        try:
            model = model_for_provider(config, provider)
        except ConfigurationError:
            model = "model không hợp lệ"
        self.usage_label.setText(
            "AI: {} / {} · Hôm nay: {{api_day}} API call, {{exercise_day}} bài · "
            "Tuần này: {{api_week}} API call, {{exercise_week}} bài".format(
                provider_label, model
            ).format(**usage)
        )

    def closeEvent(self, event) -> None:
        if self.session_id is not None:
            self.db.end_session(self.session_id)
        super().closeEvent(event)


def register_menu() -> None:
    global _registered
    if _registered:
        return
    _registered = True
    practice_action = QAction("BrainExer: Luyện tập", mw)
    qconnect(practice_action.triggered, open_practice)
    mw.form.menuTools.addAction(practice_action)
    mistakes_action = QAction("BrainExer: Sổ lỗi", mw)
    qconnect(mistakes_action.triggered, open_mistakes)
    mw.form.menuTools.addAction(mistakes_action)
    mw.addonManager.setConfigAction(__name__, open_settings)
