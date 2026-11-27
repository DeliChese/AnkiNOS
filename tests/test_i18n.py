"""Unit tests for Python-side interface translation (i18n.py); no Qt required."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("nos_i18n_test", ROOT / "i18n.py")
i18n = importlib.util.module_from_spec(spec)
spec.loader.exec_module(i18n)


class PythonI18nTests(unittest.TestCase):
    def test_vietnamese_source_returns_unchanged(self):
        self.assertEqual(i18n.translate("Tạo bộ thẻ", "vi"), "Tạo bộ thẻ")
        self.assertEqual(i18n.translate("Tạo bộ thẻ", "unknown"), "Tạo bộ thẻ")
        self.assertEqual(i18n.translate("", "en"), "")

    def test_exact_english_translations(self):
        cases = {
            "Tạo bộ thẻ": "Create deck",
            "Sổ tay AnkiNOS": "AnkiNOS Notebook",
            "Lệnh nhanh AnkiNOS": "AnkiNOS Quick Commands",
            "AnkiNOS — Lệnh nhanh": "AnkiNOS — Quick Commands",
            "Màu thư mục": "Folder color",
            "AnkiNOS: Điều phối lịch ôn": "AnkiNOS: Reschedule daily reviews",
            "AnkiNOS: Hoàn tác điều phối lịch ôn": "AnkiNOS: Undo daily review rescheduling",
            "Không tìm thấy file tài nguyên. File có thể đã được di chuyển hoặc đổi tên.": (
                "Resource file not found. It may have been moved or renamed."
            ),
            "Cấu hình trong gói sao lưu không hợp lệ.": "Settings inside the backup bundle are invalid.",
            "Thời lượng Focus không hợp lệ.": "Invalid Focus duration.",
            "Nội dung thẻ": "Card content",
        }
        for source, expected in cases.items():
            self.assertEqual(i18n.translate(source, "en"), expected)

    def test_pattern_english_translations(self):
        self.assertEqual(i18n.translate("Đã thêm 1 ảnh.", "en"), "Added 1 image.")
        self.assertEqual(i18n.translate("Đã thêm 5 ảnh.", "en"), "Added 5 images.")
        self.assertEqual(
            i18n.translate("Xóa ảnh 'lake.png' khỏi thư viện AnkiNOS?", "en"),
            "Delete image 'lake.png' from the AnkiNOS library?",
        )
        self.assertEqual(
            i18n.translate("Đã tạo: Japanese::Kanji", "en"),
            "Created: Japanese::Kanji",
        )
        self.assertEqual(
            i18n.translate("Không thể xử lý gói sao lưu: Gói sao lưu vượt giới hạn dung lượng.", "en"),
            "Could not process backup bundle: Backup bundle exceeds the maximum allowed size.",
        )
        self.assertEqual(
            i18n.translate("Có: Danh sách bộ thẻ", "en"),
            "Supported: Deck list",
        )
        self.assertEqual(
            i18n.translate("Chưa hỗ trợ: Thống kê gốc", "en"),
            "Unsupported: Native statistics",
        )
        self.assertEqual(
            i18n.translate(
                "Xóa bộ thẻ <b>English</b>, 2 bộ con và 15 thẻ?<br>Bạn có thể dùng Hoàn tác của Anki sau khi xóa.",
                "en",
            ),
            "Delete deck <b>English</b>, 2 sub-decks, and 15 cards?<br>You can use Anki's Undo afterwards.",
        )
        self.assertEqual(
            i18n.translate("photo.png: Dung lượng vượt quá 16 MB.", "en"),
            "photo.png: File size exceeds 16 MB.",
        )

    def test_restore_preview_bilingual(self):
        kwargs = dict(
            source_profile="Work",
            created_at="2026-11-27T00:00:00Z",
            images_count=3,
            albums_count=1,
            focus_sessions=12,
            resources_count=2,
            notes_count=5,
            target_profile="Home",
        )
        vi = i18n.format_restore_preview(**kwargs, lang="vi")
        en = i18n.format_restore_preview(**kwargs, lang="en")
        self.assertIn("Xem trước khôi phục AnkiNOS", vi)
        self.assertIn("AnkiNOS Restore Preview", en)
        self.assertIn("Source profile: Work", en)
        self.assertIn("Destination profile: <b>Home</b>", en)
        self.assertNotIn("Hồ sơ", en)


if __name__ == "__main__":
    unittest.main()
