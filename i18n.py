"""Pure-Python interface translation helper for native Qt dialogs, menus, and errors.

Vietnamese ('vi') is the canonical source language across all AnkiNOS Python modules.
This module translates strings into the active profile language without importing Qt,
keeping store and scheduler modules testable outside Anki.
"""
from __future__ import annotations

import re
from typing import Callable

SOURCE_LANGUAGE = "vi"

_EN_DICT: dict[str, str] = {
    # ── Fallback, compatibility & lifecycle ───────────────────────────────
    "không xác định": "unknown",
    "Danh sách bộ thẻ": "Deck list",
    "Chuyển bộ thẻ": "Switch deck",
    "Bắt đầu học": "Start studying",
    "Thống kê gốc": "Native statistics",
    "AnkiNOS đã chuyển về giao diện Anki gốc để bạn tiếp tục học.\nHãy kiểm tra cấu hình add-on và khởi động lại Anki.\n\n": (
        "AnkiNOS has switched back to the original Anki interface so you can keep studying.\n"
        "Please check your add-on configuration and restart Anki.\n\n"
    ),
    "Đây là kiểm tra khả năng API, không phải chứng nhận mọi add-on đều tương thích.": (
        "This checks API availability only and does not certify compatibility with every add-on."
    ),
    "AnkiNOS chưa khởi tạo đầy đủ. Hãy kiểm tra phiên bản Anki và khởi động lại trước khi bật lại.": (
        "AnkiNOS is not fully initialized. Check your Anki version and restart before enabling it again."
    ),
    "Không thể nạp giao diện.": "Could not load the interface.",
    "Không thể nạp giao diện phiên học.": "Could not load the review interface.",
    "Không thể khởi tạo giao diện AnkiNOS.": "Could not initialize the AnkiNOS interface.",
    "Nội dung thẻ": "Card content",

    # ── Native Qt menus & dialogs ─────────────────────────────────────────
    "AnkiNOS — Lệnh nhanh": "AnkiNOS — Quick Commands",
    "Lệnh nhanh AnkiNOS": "AnkiNOS Quick Commands",
    "Sổ tay AnkiNOS": "AnkiNOS Notebook",
    "Ghi chú chung": "General notes",
    "Tạo bộ thẻ": "Create deck",
    "Tên bộ thẻ mới": "New deck name",
    "Không có — tạo bộ thẻ cấp cao nhất": "None — create a top-level deck",
    "Tên bộ thẻ:": "Deck name:",
    "Bộ thẻ cha:": "Parent deck:",
    "Tạo": "Create",
    "Đóng": "Close",
    "Không thể tạo deck con trong bộ thẻ lọc.": "Cannot create a sub-deck inside a filtered deck.",
    "Nhập tên bộ thẻ; tên từng cấp không được để trống.": "Enter a deck name; no level name may be empty.",
    "Bộ thẻ này đã tồn tại. Hãy chọn tên khác.": "This deck already exists. Choose a different name.",
    "Đang tạo bộ thẻ…": "Creating deck…",
    "Sổ tay…": "Notebook…",
    "Bỏ gắn sao": "Remove star",
    "Gắn sao bộ thẻ": "Star deck",
    "Duyệt thẻ": "Browse cards",
    "Tạo deck con…": "Create sub-deck…",
    "Đổi tên bộ thẻ…": "Rename deck…",
    "Tùy chọn bộ thẻ…": "Deck options…",
    "Xuất bộ thẻ…": "Export deck…",
    "Xóa bộ thẻ…": "Delete deck…",
    "Xóa bộ thẻ": "Delete deck",
    "Màu thư mục": "Folder color",
    "Xanh dương": "Blue",
    "Tím": "Purple",
    "Hồng": "Pink",
    "Xanh lá": "Green",
    "Vàng": "Amber",
    "Mục tiêu học mỗi ngày": "Daily study goal",
    "Số lượt ôn tập mỗi ngày:": "Target reviews per day:",
    "Mở tài nguyên": "Open resource",
    "Gỡ khỏi dashboard (giữ nguyên file)": "Remove from dashboard (keep file)",
    "Đường dẫn tài nguyên (https://…)": "Resource URL (https://…)",
    "Thêm liên kết": "Add link",
    "Hãy nhập một liên kết http hoặc https hợp lệ.": "Please enter a valid http or https link.",
    "Tên tài nguyên": "Resource name",
    "Gắn tài nguyên học tập": "Attach study resources",
    "Tài nguyên (*.pdf *.epub *.txt *.md *.csv *.xlsx *.docx *.pptx *.mp3 *.wav *.mp4 *.webm *.png *.jpg *.jpeg *.webp)": (
        "Resources (*.pdf *.epub *.txt *.md *.csv *.xlsx *.docx *.pptx *.mp3 *.wav *.mp4 *.webm *.png *.jpg *.jpeg *.webp)"
    ),
    "Không tìm thấy file tài nguyên. File có thể đã được di chuyển hoặc đổi tên.": (
        "Resource file not found. It may have been moved or renamed."
    ),
    "Lưu PDF": "Save PDF",
    "Đã lưu.": "Saved.",

    # ── Media library & Qt file picker ────────────────────────────────────
    "Thêm ảnh vào thư viện AnkiNOS": "Add images to the AnkiNOS library",
    "Ảnh (*.png *.jpg *.jpeg *.webp)": "Images (*.png *.jpg *.jpeg *.webp)",
    "Dung lượng vượt quá 16 MB.": "File size exceeds 16 MB.",
    "Không thể đọc tệp ảnh.": "Could not read image file.",
    "Ảnh quá lớn (tối đa 24 megapixel).": "Image is too large (maximum 24 megapixels).",
    "Không tạo được ảnh xem trước.": "Could not generate image preview.",
    "Không có ảnh nào được thêm.": "No images were added.",
    "Một số ảnh chưa tạo được bản xem trước hoặc bản nền.": "Some images could not generate previews or wallpaper copies.",
    "Đã xóa ảnh khỏi thư viện.": "Image removed from library.",
    "Tên ảnh không hợp lệ (1–80 ký tự).": "Invalid image name (1–80 characters).",
    "Đã đổi tên ảnh.": "Image renamed.",
    "Đã lưu ảnh cho giao diện.": "Image saved for the interface.",
    "Tên album trống, trùng hoặc không hợp lệ.": "Album name is empty, duplicated, or invalid.",
    "Chỉ được tạo tối đa 30 album.": "You can create at most 30 albums.",
    "Đã cập nhật album.": "Album updated.",
    "Chỉ hỗ trợ PNG, JPG và WebP.": "Only PNG, JPG, and WebP images are supported.",
    "Ảnh phải có dung lượng từ 1 byte đến 16 MB.": "Image size must be between 1 byte and 16 MB.",
    "Ảnh không tồn tại trong thư viện.": "Image does not exist in the library.",

    # ── Backup & restore ──────────────────────────────────────────────────
    "Đang kiểm tra và xử lý gói dữ liệu…": "Checking and processing backup bundle…",
    "Đang xử lý sao lưu AnkiNOS…": "Processing AnkiNOS backup…",
    "Sao lưu đầy đủ AnkiNOS": "Full AnkiNOS backup",
    "Chọn gói AnkiNOS để xem trước": "Choose an AnkiNOS backup bundle to preview",
    "Gói AnkiNOS (*.nosbackup)": "AnkiNOS Backup (*.nosbackup)",
    "Đã kiểm tra toàn vẹn gói. Đang chờ xác nhận khôi phục.": "Bundle integrity verified. Waiting for restore confirmation.",
    "Đã hủy khôi phục. Dữ liệu hiện tại được giữ nguyên.": "Restore canceled. Current data was kept unchanged.",
    "Gói sao lưu thiếu audio của một câu trong Thư viện BrainExer.": "Backup bundle is missing audio for a BrainExer Library item.",
    "Cấu hình trong gói sao lưu không hợp lệ.": "Settings inside the backup bundle are invalid.",
    "Thư mục dữ liệu hồ sơ không an toàn.": "Profile data directory is unsafe.",
    "Thư mục tạm không hợp lệ.": "Temporary directory is invalid.",
    "Lịch sử Focus bị hỏng.": "Focus history database is corrupted.",
    "Cấu trúc lịch sử Focus không được hỗ trợ.": "Unsupported Focus history database schema.",
    "Cột dữ liệu Focus không hợp lệ.": "Invalid Focus history columns.",
    "Lịch sử Focus chứa phiên không hợp lệ.": "Focus history contains invalid session records.",
    "Hãy lưu gói sao lưu bên ngoài thư mục dữ liệu hồ sơ.": "Please save the backup outside the profile data folder.",
    "Không sao lưu liên kết ngoài thư mục hồ sơ.": "Cannot back up symlinks outside the profile folder.",
    "Thư viện audio BrainExer không hợp lệ.": "BrainExer audio folder is invalid.",
    "Thư viện audio BrainExer chứa tệp không hợp lệ.": "BrainExer audio folder contains an invalid file.",
    "Gói sao lưu có quá nhiều tệp.": "Backup bundle contains too many files.",
    "Dữ liệu vượt giới hạn dung lượng sao lưu.": "Data exceeds the backup size limit.",
    "Danh sách tệp sao lưu không hợp lệ.": "Backup file list is invalid.",
    "Không hỗ trợ tệp mã hóa hoặc liên kết.": "Encrypted entries and symlinks are not supported.",
    "Gói sao lưu chứa đường dẫn hoặc tệp không được hỗ trợ.": "Backup bundle contains an unsupported path or file.",
    "Gói sao lưu vượt giới hạn dung lượng.": "Backup bundle exceeds the maximum allowed size.",
    "Định dạng hoặc phiên bản gói sao lưu không được hỗ trợ.": "Unsupported backup format or version.",
    "Nội dung gói sao lưu không khớp bản kê.": "Backup contents do not match the manifest.",
    "Phiên bản gói sao lưu không hỗ trợ dữ liệu BrainExer.": "This backup version does not support BrainExer data.",
    "Phiên bản gói sao lưu không hỗ trợ audio BrainExer.": "This backup version does not support BrainExer audio.",
    "Bản kê tệp không hợp lệ.": "Invalid file manifest.",
    "Dung lượng tệp không khớp bản kê.": "File size does not match the manifest.",
    "Tệp sao lưu không vượt qua kiểm tra toàn vẹn.": "Backup file failed the integrity check.",
    "Audio BrainExer không hợp lệ.": "Invalid BrainExer audio file.",
    "Gói sao lưu thiếu ảnh đã đăng ký.": "Backup bundle is missing a registered image.",
    "Danh sách bộ thẻ không hợp lệ.": "Invalid deck name map in backup.",
    "Gói sao lưu đã thay đổi trong khi đọc. Hãy chọn lại.": "Backup file changed while reading. Please choose it again.",
    "Gói sao lưu đã thay đổi. Hãy chọn lại để xem trước.": "Backup file changed. Please select it again to preview.",
    "Thư mục hồ sơ chứa mục chưa hỗ trợ khôi phục.": "Profile folder contains an item that cannot be restored safely.",
    "Thư mục đích nằm ngoài dữ liệu AnkiNOS.": "Target folder is outside AnkiNOS data.",
    "Phiên bản dữ liệu BrainExer cũ không được hỗ trợ.": "Unsupported legacy BrainExer database version.",
    "Dữ liệu BrainExer cũ bị lỗi.": "Legacy BrainExer database is corrupted.",
    "Cấu trúc dữ liệu BrainExer cũ không hợp lệ.": "Invalid legacy BrainExer database structure.",
    "Cấu hình BrainExer cũ không hợp lệ.": "Invalid legacy BrainExer settings.",
    "Dữ liệu học cũ không hợp lệ hoặc phiên bản chưa hỗ trợ.": "Legacy learning data is invalid or uses an unsupported version.",
    "Cấu trúc dữ liệu học cũ không hợp lệ.": "Invalid legacy learning database structure.",
    "Thiếu cột trong dữ liệu học cũ.": "Missing columns in legacy learning database.",
    "Nội dung dữ liệu học cũ không hợp lệ.": "Invalid records in legacy learning database.",

    # ── Study, stats, daily scheduler, tools & stores ─────────────────────
    "Bộ thẻ không còn tồn tại.": "This deck no longer exists.",
    "Bộ thẻ không còn tồn tại. Hãy làm mới dashboard.": "This deck no longer exists. Refresh the dashboard.",
    "Chọn thời lượng 15, 30 hoặc 60 phút.": "Choose a duration of 15, 30, or 60 minutes.",
    "Các thẻ liên quan đã thay đổi. Hãy làm mới nhận xét.": "The related cards have changed. Refresh insights.",
    "Bộ lọc thống kê không hợp lệ.": "Invalid statistics filter.",
    "Bộ lọc tìm kiếm thẻ không hợp lệ.": "Invalid card search filter.",
    "Phạm vi thống kê không hợp lệ.": "Invalid statistics scope.",
    "Khoảng thời gian thống kê không hợp lệ.": "Invalid statistics time range.",
    "Phiên bản Anki này chưa hỗ trợ dữ liệu đồ thị gốc.": "This Anki version does not support native graph data.",
    "Bộ thẻ được chọn không tồn tại.": "The selected deck does not exist.",
    "Loại nhận xét không hợp lệ.": "Invalid insight type.",
    "Thời lượng Focus không hợp lệ.": "Invalid Focus duration.",
    "Đang mở phiên học, vui lòng chờ giây lát.": "Opening a study session, please wait a moment.",
    "AnkiNOS: Điều phối lịch ôn": "AnkiNOS: Reschedule daily reviews",
    "AnkiNOS: Hoàn tác điều phối lịch ôn": "AnkiNOS: Undo daily review rescheduling",
    "Không tìm thấy đợt điều phối cần hoàn tác.": "Rescheduling batch not found.",
    "Đợt điều phối này đã được hoàn tác trước đó.": "This rescheduling batch was already undone.",
    "Phạm vi hiện tại không khớp bộ thẻ nào.": "Current scope does not match any deck.",
    "Hôm nay chưa có thẻ đến hạn trong phạm vi đang chọn.": "No cards are due today in the selected scope.",
    "Hôm nay không còn thẻ đến hạn sẵn sàng (có thể đang nằm trong bộ thẻ lọc khác).": (
        "No due cards are available for today (they may already be in another filtered deck)."
    ),
    "Hôm nay không còn thẻ đến hạn sẵn sàng để mở phiên ôn.": "No due cards remain available to start today's session.",
    "Cấu hình phạm vi không hợp lệ.": "Invalid scope configuration.",
    "Thiếu mã đợt điều phối cần hoàn tác.": "Missing rescheduling batch ID to undo.",
    "Chọn thời lượng Focus 15, 30 hoặc 60 phút.": "Choose a Focus duration of 15, 30, or 60 minutes.",
    "Lệnh Lịch ôn không được hỗ trợ.": "Unsupported Daily Schedule command.",
    "Hãy nhập tên phạm vi.": "Please enter a scope name.",
    "Dữ liệu Lịch ôn bị hỏng.": "Daily Schedule database is corrupted.",
    "Dữ liệu Lịch ôn lỗi khóa ngoại.": "Daily Schedule database failed foreign-key check.",
    "Phiên bản dữ liệu Lịch ôn không được hỗ trợ.": "Unsupported Daily Schedule database version.",
    "Cấu trúc dữ liệu Lịch ôn không hợp lệ.": "Invalid Daily Schedule database schema.",
    "Thiếu cột trong dữ liệu Lịch ôn.": "Missing columns in Daily Schedule database.",
    "Dữ liệu gửi quá lớn.": "Payload is too large.",
    "Lệnh không hợp lệ.": "Invalid command.",
    "Kết quả tìm kiếm không hợp lệ.": "Invalid search result.",
    "Ghi chú đã thay đổi. Hãy tìm lại.": "This note has changed. Please search again.",
    "Lệnh không được hỗ trợ.": "Unsupported command.",
    "Đã lưu ghi chú trên máy.": "Note saved locally.",
    "Ghi chú này không gắn với note Anki đang tồn tại trong bộ sưu tập này.": (
        "This note is not linked to an existing Anki note in this collection."
    ),
    "Note nguồn đã bị xóa; ghi chú vẫn được giữ.": "The source note was deleted; your notebook entry is still kept.",
    "Dữ liệu sổ tay không hợp lệ hoặc chưa hỗ trợ phiên bản này.": "Notebook database is invalid or uses an unsupported version.",
    "Cấu trúc sổ tay không hợp lệ.": "Invalid notebook database schema.",
    "Thiếu cột dữ liệu sổ tay.": "Missing columns in notebook database.",
    "Ghi chú không hợp lệ.": "Invalid note entry.",
    "Phiên bản sổ tay chưa được hỗ trợ.": "Unsupported notebook database version.",
    "Ghi chú cần nội dung, tối đa 20.000 ký tự; tiêu đề tối đa 160 ký tự.": (
        "Notes require content (up to 20,000 characters; title up to 160 characters)."
    ),
    "Ghi chú thuộc ngữ cảnh khác.": "This note belongs to a different context.",
}

_EN_PATTERNS: list[tuple[re.Pattern[str], Callable[[re.Match[str], Callable[[str], str]], str]]] = [
    (re.compile(r"^Có: (.+)$"), lambda m, t: "Supported: " + t(m.group(1))),
    (re.compile(r"^Chưa hỗ trợ: (.+)$"), lambda m, t: "Unsupported: " + t(m.group(1))),
    (re.compile(r"^Lần lỗi gần nhất: (.+)$", re.S), lambda m, t: "Last error: " + t(m.group(1))),
    (re.compile(r"^Thư viện đã đạt giới hạn (\d+) ảnh\.$"), lambda m, _: f"Library reached the {m.group(1)}-image limit."),
    (re.compile(r"^Không giải mã được ảnh: (.+)$", re.S), lambda m, _: f"Could not decode image: {m.group(1)}"),
    (re.compile(r"^Đã thêm (\d+) ảnh\.$"), lambda m, _: f"Added {m.group(1)} {'image' if m.group(1) == '1' else 'images'}."),
    (re.compile(r"^Xóa ảnh '(.+)' khỏi thư viện AnkiNOS\?$"), lambda m, _: f"Delete image '{m.group(1)}' from the AnkiNOS library?"),
    (re.compile(r"^Không thể đọc dữ liệu Anki: (.+)$", re.S), lambda m, t: "Could not read Anki data: " + t(m.group(1))),
    (re.compile(r"^Không thể đọc nhận xét học tập: (.+)$", re.S), lambda m, t: "Could not read study insights: " + t(m.group(1))),
    (re.compile(r"^Không thể bắt đầu phiên học: (.+)$", re.S), lambda m, t: "Could not start study session: " + t(m.group(1))),
    (re.compile(r"^Không thể xử lý gói sao lưu: (.+)$", re.S), lambda m, t: "Could not process backup bundle: " + t(m.group(1))),
    (re.compile(r"^Đã sao lưu đầy đủ tại (.+)$", re.S), lambda m, _: "Full backup saved to " + m.group(1)),
    (re.compile(r"^Đã khôi phục đầy đủ\. Bản trước khôi phục: (.+)$", re.S), lambda m, _: "Restore complete. Pre-restore backup: " + m.group(1)),
    (re.compile(r"^Đã khôi phục dữ liệu AnkiNOS\. Bản trước khôi phục: (.+)$", re.S), lambda m, _: "AnkiNOS data restored. Pre-restore backup: " + m.group(1)),
    (re.compile(r"^Ảnh trong gói không hợp lệ hoặc vượt 24 megapixel: (.+)$"), lambda m, _: "Image in backup is invalid or exceeds 24 megapixels: " + m.group(1)),
    (re.compile(r"^Thiếu ảnh trong thư viện: (.+)$"), lambda m, _: "Missing image in library: " + m.group(1)),
    (re.compile(r"^Không thể tải thống kê Anki: (.+)$", re.S), lambda m, t: "Could not load Anki statistics: " + t(m.group(1))),
    (re.compile(r"^Không thể đổi bộ thẻ thống kê: (.+)$", re.S), lambda m, t: "Could not switch statistics deck: " + t(m.group(1))),
    (re.compile(r"^Đã tạo: (.+)$"), lambda m, _: "Created: " + m.group(1)),
    (re.compile(r"^Không thể tạo bộ thẻ: (.+)$", re.S), lambda m, t: "Could not create deck: " + t(m.group(1))),
    (re.compile(r"^Tối đa (\d+) phạm vi đã lưu\. Hãy xóa bớt trước khi thêm\.$"), lambda m, _: f"Maximum of {m.group(1)} saved scopes reached. Delete one before adding another."),
    (re.compile(r"^Xóa bộ thẻ lọc <b>(.+)</b>\?<br>Thẻ sẽ được trả về bộ thẻ gốc\.$", re.S),
     lambda m, _: f"Delete filtered deck <b>{m.group(1)}</b>?<br>Cards will be returned to their home decks."),
    (re.compile(r"^Xóa bộ thẻ <b>(.+)</b>, (\d+) bộ con và (\d+) thẻ\?<br>Bạn có thể dùng Hoàn tác của Anki sau khi xóa\.$", re.S),
     lambda m, _: (
         f"Delete deck <b>{m.group(1)}</b>, {m.group(2)} {'sub-deck' if m.group(2) == '1' else 'sub-decks'}, "
         f"and {m.group(3)} {'card' if m.group(3) == '1' else 'cards'}?<br>You can use Anki's Undo afterwards."
     )),
    (re.compile(r"^([^:\n]+): (.+)$"), lambda m, t: f"{m.group(1)}: {t(m.group(2))}" if t(m.group(2)) != m.group(2) else m.group(0)),
]


def translate(text: str, lang: str = SOURCE_LANGUAGE) -> str:
    """Translate a Vietnamese source string to ``lang``; return unchanged if unknown."""
    if not text or lang != "en":
        return text
    direct = _EN_DICT.get(text)
    if direct is not None:
        return direct
    sub = lambda piece: translate(piece, lang)
    for pattern, build in _EN_PATTERNS:
        match = pattern.match(text)
        if match:
            return build(match, sub)
    return text


def format_restore_preview(
    *,
    source_profile: str,
    created_at: str,
    images_count: int,
    albums_count: int,
    focus_sessions: int,
    resources_count: int,
    notes_count: int,
    target_profile: str,
    lang: str = SOURCE_LANGUAGE,
) -> str:
    """Build the HTML confirmation text for restoring a .nosbackup archive."""
    if lang == "en":
        return (
            "<b>AnkiNOS Restore Preview</b>"
            f"<br><br>Source profile: {source_profile}"
            f"<br>Created: {created_at}"
            f"<br>Images: {images_count} · Albums: {albums_count} · Focus sessions: {focus_sessions}"
            f"<br>Resource references: {resources_count}"
            f"<br>Notes: {notes_count}"
            f"<br><br>Destination profile: <b>{target_profile}</b>"
            "<br>Appearance settings, images, Focus history, and Notebook will be replaced. "
            "A safety backup of the current state is saved to user_files/backups beforehand."
            "<br>Anki cards are not included in this archive. External resources store file paths only and may need re-attaching on another computer."
            "<br><br>Restore into this profile?"
        )
    return (
        "<b>Xem trước khôi phục AnkiNOS</b>"
        f"<br><br>Hồ sơ nguồn: {source_profile}"
        f"<br>Tạo lúc: {created_at}"
        f"<br>Ảnh: {images_count} · Album: {albums_count} · Phiên Focus: {focus_sessions}"
        f"<br>Tham chiếu tài nguyên: {resources_count}"
        f"<br>Ghi chú: {notes_count}"
        f"<br><br>Hồ sơ nhận: <b>{target_profile}</b>"
        "<br>Cấu hình giao diện, ảnh, Focus và sổ tay sẽ được thay thế. "
        "Bản dự phòng hiện tại được lưu vào user_files/backups trước khi thay thế."
        "<br>Thẻ Anki không nằm trong gói này. Tài nguyên ngoài add-on chỉ lưu đường dẫn, có thể cần gắn lại khi đổi máy."
        "<br><br>Khôi phục vào hồ sơ này?"
    )
