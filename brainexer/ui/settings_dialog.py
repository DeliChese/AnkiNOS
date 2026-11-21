from __future__ import annotations

from typing import Any, Dict

from aqt.qt import (
    QCheckBox, QComboBox, QDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QSpinBox, QVBoxLayout,
)
from aqt.utils import showInfo, showWarning

from ..ai.factory import PROVIDER_LABELS, PROVIDERS
from ..security.keyring_store import KeyringStore


class SettingsDialog(QDialog):
    def __init__(self, parent: Any, config: Dict[str, Any], keyring: KeyringStore, on_saved) -> None:
        super().__init__(parent)
        self.setWindowTitle("BrainExer — Cài đặt")
        self.setMinimumWidth(520)
        self.config = dict(config)
        self.keyring = keyring
        self.on_saved = on_saved

        layout = QVBoxLayout(self)
        form = QFormLayout()
        self.provider = QComboBox()
        for provider in PROVIDERS:
            self.provider.addItem(PROVIDER_LABELS[provider], provider)
        configured_provider = str(config.get("provider", "openai")).strip().casefold()
        provider_index = self.provider.findData(configured_provider)
        self.provider.setCurrentIndex(provider_index if provider_index >= 0 else 0)
        self.openai_model = QLineEdit(str(config.get("model", "gpt-5-mini")))
        self.deepseek_model = QLineEdit(str(config.get("deepseek_model", "deepseek-v4-flash")))
        self.gemini_model = QLineEdit(str(config.get("gemini_model", "gemini-2.5-flash")))
        self.language = QLineEdit(str(config.get("language", "English")))
        self.feedback_language = QLineEdit(str(config.get("feedback_language", "Vietnamese")))
        self.level = QLineEdit(str(config.get("learner_level", "")))
        self.timeout = self._spin(config.get("request_timeout_seconds", 60), 10, 300)
        self.api_day = self._spin(config.get("max_api_calls_per_day", 50), 0, 10000)
        self.api_week = self._spin(config.get("max_api_calls_per_week", 250), 0, 100000)
        self.exercise_day = self._spin(config.get("max_exercises_per_day", 30), 0, 10000)
        self.exercise_week = self._spin(config.get("max_exercises_per_week", 150), 0, 100000)
        self.store_raw = QCheckBox("Lưu response thô để debug (có thể chứa dữ liệu học tập)")
        self.store_raw.setChecked(bool(config.get("store_raw_responses", False)))
        self.consent = QCheckBox(
            "Tôi đồng ý gửi các field thẻ được chọn và bài viết tới nhà cung cấp AI đã chọn"
        )
        self.consent.setChecked(bool(config.get("ai_data_consent", False)))
        self.api_key = QLineEdit()
        self.api_key.setEchoMode(QLineEdit.EchoMode.Password)
        self.api_key.setPlaceholderText("Để trống để giữ API key hiện tại")
        self._active_provider = self._selected_provider()
        self._pending_api_keys: Dict[str, str] = {}

        form.addRow("Nhà cung cấp AI", self.provider)
        form.addRow("Model OpenAI", self.openai_model)
        form.addRow("Model DeepSeek", self.deepseek_model)
        form.addRow("Model Gemini", self.gemini_model)
        form.addRow("Ngôn ngữ đang học", self.language)
        form.addRow("Ngôn ngữ phản hồi", self.feedback_language)
        form.addRow("Trình độ (tùy chọn)", self.level)
        form.addRow("Timeout API (giây)", self.timeout)
        form.addRow("API calls/ngày", self.api_day)
        form.addRow("API calls/tuần", self.api_week)
        form.addRow("Bài được tạo/ngày", self.exercise_day)
        form.addRow("Bài được tạo/tuần", self.exercise_week)
        form.addRow("API key của provider đã chọn", self.api_key)
        form.addRow("", self.store_raw)
        form.addRow("", self.consent)
        layout.addLayout(form)

        self.keyring_status = QLabel()
        layout.addWidget(self.keyring_status)
        self.provider.currentIndexChanged.connect(self._provider_changed)
        self._refresh_keyring_status()

        buttons = QHBoxLayout()
        delete_button = QPushButton("Xóa API key")
        delete_button.clicked.connect(self._delete_key)
        buttons.addWidget(delete_button)
        buttons.addStretch()
        cancel_button = QPushButton("Hủy")
        cancel_button.clicked.connect(self.reject)
        save_button = QPushButton("Lưu")
        save_button.setDefault(True)
        save_button.clicked.connect(self._save)
        buttons.addWidget(cancel_button)
        buttons.addWidget(save_button)
        layout.addLayout(buttons)

    @staticmethod
    def _spin(value: Any, minimum: int, maximum: int) -> QSpinBox:
        widget = QSpinBox()
        widget.setRange(minimum, maximum)
        widget.setValue(int(value))
        return widget

    def _delete_key(self) -> None:
        provider = self._selected_provider()
        try:
            self.keyring.delete_api_key(provider)
            self._pending_api_keys.pop(provider, None)
            self.api_key.clear()
            self._refresh_keyring_status()
            showInfo(
                "Đã xóa {} API key khỏi OS Keyring.".format(PROVIDER_LABELS[provider]),
                parent=self,
            )
        except Exception as exc:
            showWarning(str(exc), parent=self)

    def _selected_provider(self) -> str:
        provider = str(self.provider.currentData() or "openai")
        return provider if provider in PROVIDERS else "openai"

    def _provider_changed(self) -> None:
        pending = self.api_key.text().strip()
        if pending:
            self._pending_api_keys[self._active_provider] = pending
        self._active_provider = self._selected_provider()
        self.api_key.setText(self._pending_api_keys.get(self._active_provider, ""))
        self._refresh_keyring_status()

    def _refresh_keyring_status(self) -> None:
        provider = self._selected_provider()
        if self._pending_api_keys.get(provider):
            self.keyring_status.setText(
                "Keyring {}: API key mới sẽ được lưu".format(PROVIDER_LABELS[provider])
            )
            return
        try:
            stored = bool(self.keyring.get_api_key(provider))
            state = "đã có API key" if stored else "chưa có API key"
            self.keyring_status.setText("Keyring {}: {}".format(PROVIDER_LABELS[provider], state))
        except Exception as exc:
            self.keyring_status.setText("Keyring {}: lỗi — {}".format(PROVIDER_LABELS[provider], exc))

    def _save(self) -> None:
        models = {
            "model": self.openai_model.text().strip(),
            "deepseek_model": self.deepseek_model.text().strip(),
            "gemini_model": self.gemini_model.text().strip(),
        }
        if not all(models.values()) or not self.language.text().strip():
            showWarning("Các model và ngôn ngữ không được để trống.", parent=self)
            return
        provider = self._selected_provider()
        try:
            current_key = self.api_key.text().strip()
            if current_key:
                self._pending_api_keys[provider] = current_key
            for key_provider, value in self._pending_api_keys.items():
                self.keyring.set_api_key(value, key_provider)
            self.config.update({
                "provider": provider,
                **models,
                "language": self.language.text().strip(),
                "feedback_language": self.feedback_language.text().strip() or "Vietnamese",
                "learner_level": self.level.text().strip(),
                "request_timeout_seconds": self.timeout.value(),
                "max_api_calls_per_day": self.api_day.value(),
                "max_api_calls_per_week": self.api_week.value(),
                "max_exercises_per_day": self.exercise_day.value(),
                "max_exercises_per_week": self.exercise_week.value(),
                "store_raw_responses": self.store_raw.isChecked(),
                "ai_data_consent": self.consent.isChecked(),
            })
            self.on_saved(self.config)
        except Exception as exc:
            showWarning(str(exc), parent=self)
            return
        self.accept()
