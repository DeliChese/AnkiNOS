from __future__ import annotations

from typing import Any, List

from aqt.operations import CollectionOp
from aqt.qt import (
    QCheckBox, QDialog, QHBoxLayout, QPushButton, QTableWidget,
    QTableWidgetItem, QVBoxLayout,
)
from aqt.utils import showInfo, showWarning

from ..core.mistake_bank import add_mistake_note
from ..db.connection import Database


class MistakesDialog(QDialog):
    def __init__(self, parent: Any, database: Database) -> None:
        super().__init__(parent)
        self.database = database
        self.ids: List[int] = []
        self.setWindowTitle("BrainExer — Sổ lỗi")
        self.resize(1000, 600)

        layout = QVBoxLayout(self)
        self.include_mastered = QCheckBox("Hiện lỗi đã thuộc")
        self.include_mastered.setChecked(True)
        self.include_mastered.toggled.connect(self.reload)
        layout.addWidget(self.include_mastered)

        self.table = QTableWidget(0, 7)
        self.table.setHorizontalHeaderLabels([
            "Deck", "Loại", "Sai", "Đúng", "Giải thích", "Mức độ", "Trạng thái",
        ])
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.horizontalHeader().setStretchLastSection(True)
        layout.addWidget(self.table)

        buttons = QHBoxLayout()
        mastered = QPushButton("Đánh dấu đã thuộc")
        mastered.clicked.connect(lambda: self._set_mastered(True))
        unmastered = QPushButton("Đánh dấu cần ôn")
        unmastered.clicked.connect(lambda: self._set_mastered(False))
        add_to_anki = QPushButton("Thêm thành thẻ Anki")
        add_to_anki.clicked.connect(self._add_to_anki)
        close = QPushButton("Đóng")
        close.clicked.connect(self.accept)
        buttons.addWidget(mastered)
        buttons.addWidget(unmastered)
        buttons.addWidget(add_to_anki)
        buttons.addStretch()
        buttons.addWidget(close)
        layout.addLayout(buttons)
        self.reload()

    def reload(self) -> None:
        rows = self.database.list_mistakes(self.include_mastered.isChecked())
        self.ids = [int(row["id"]) for row in rows]
        self.table.setRowCount(len(rows))
        for index, row in enumerate(rows):
            values = [
                row["deck_name"], row["mistake_type"], row["original_text"],
                row["corrected_text"], row["explanation"], row["severity"],
                "Đã thuộc" if row["mastered"] else "Cần ôn",
            ]
            for column, value in enumerate(values):
                self.table.setItem(index, column, QTableWidgetItem(str(value)))
        self.table.resizeColumnsToContents()

    def _selected_id(self) -> int:
        row = self.table.currentRow()
        return self.ids[row] if 0 <= row < len(self.ids) else 0

    def _set_mastered(self, value: bool) -> None:
        mistake_id = self._selected_id()
        if not mistake_id:
            showWarning("Hãy chọn một lỗi trước.", parent=self)
            return
        self.database.set_mastered(mistake_id, value)
        self.reload()

    def _add_to_anki(self) -> None:
        mistake_id = self._selected_id()
        if not mistake_id:
            showWarning("Hãy chọn một lỗi trước.", parent=self)
            return
        mistake = self.database.get_mistake(mistake_id)
        if mistake is None:
            showWarning("Không còn tìm thấy lỗi này.", parent=self)
            return
        if mistake["linked_anki_note_id"]:
            showInfo("Lỗi này đã được thêm vào Anki.", parent=self)
            return

        def operation(col):
            return add_mistake_note(col, mistake)

        def success(result) -> None:
            note_id, card_id = result
            self.database.link_anki_note(mistake_id, note_id, card_id)
            showInfo("Đã thêm vào deck BrainExer::Mistakes.", parent=self)
            self.reload()

        CollectionOp(parent=self, op=operation).success(success).run_in_background()
