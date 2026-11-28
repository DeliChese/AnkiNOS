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
    "Lịch sử Pomodoro bị hỏng.": "Pomodoro history database is corrupted.",
    "Cấu trúc lịch sử Pomodoro không được hỗ trợ.": "Unsupported Pomodoro history database schema.",
    "Cột dữ liệu Pomodoro không hợp lệ.": "Invalid Pomodoro history columns.",
    "Lịch sử Pomodoro chứa phiên không hợp lệ.": "Pomodoro history contains invalid session records.",
    "Thư mục âm thanh Pomodoro không hợp lệ.": "Pomodoro audio folder is invalid.",
    "Thư mục âm thanh Pomodoro chứa tệp không hợp lệ.": "Pomodoro audio folder contains an invalid file.",
    "Âm thanh Pomodoro không hợp lệ.": "Invalid Pomodoro audio file.",
    "AnkiNOS · Pomodoro": "AnkiNOS · Pomodoro",
    "Mở Pomodoro": "Open Pomodoro",
    "Chọn âm thanh báo hết giờ học": "Choose study-end alert sound",
    "Chọn âm thanh báo hết giờ nghỉ": "Choose break-end alert sound",
    "Tệp âm thanh (*.mp3 *.wav *.ogg)": "Audio files (*.mp3 *.wav *.ogg)",
    "Tệp âm thanh không tồn tại hoặc không hợp lệ.": "Audio file does not exist or is invalid.",
    "Chỉ hỗ trợ tệp âm thanh MP3, WAV hoặc OGG.": "Only MP3, WAV, or OGG audio files are supported.",
    "Tệp âm thanh phải nhỏ hơn 4 MB.": "Audio file must be smaller than 4 MB.",
    "Định dạng tệp âm thanh không hợp lệ.": "Invalid audio file format.",
    "Đường dẫn âm thanh không hợp lệ.": "Invalid audio file path.",
    "Thời lượng học không hợp lệ (1–180 phút).": "Invalid study duration (1–180 minutes).",
    "Thời lượng nghỉ không hợp lệ (1–60 phút).": "Invalid break duration (1–60 minutes).",
    "Chế độ Pomodoro không hợp lệ.": "Invalid Pomodoro mode.",
    "Pha Pomodoro không hợp lệ.": "Invalid Pomodoro phase.",
    "Thời gian cộng thêm không hợp lệ.": "Invalid extension duration.",
    "Chọn thời lượng học từ 1 đến 180 phút.": "Choose a study duration from 1 to 180 minutes.",
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
    "Quay lại giao diện AnkiNOS": "Return to AnkiNOS",
    "Đang dùng giao diện Anki gốc · nhấn để bật lại AnkiNOS": "Using default Anki interface · click to switch back to AnkiNOS",
    "Đã ghim ghi chú lên đầu.": "Note pinned to top.",
    "Đã bỏ ghim ghi chú.": "Note unpinned.",
    "Đã nhân bản ghi chú.": "Note duplicated.",
    "Không tìm thấy ghi chú.": "Note not found.",
    "Không tìm thấy ghi chú để nhân bản.": "Note not found to duplicate.",
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

_ZH_CN_DICT: dict[str, str] = {
    # ── Fallback, compatibility & lifecycle ───────────────────────────────
    "không xác định": "未知",
    "Danh sách bộ thẻ": "牌组列表",
    "Chuyển bộ thẻ": "切换牌组",
    "Bắt đầu học": "开始学习",
    "Thống kê gốc": "原生统计",
    "AnkiNOS đã chuyển về giao diện Anki gốc để bạn tiếp tục học.\nHãy kiểm tra cấu hình add-on và khởi động lại Anki.\n\n": (
        "AnkiNOS 已切换回 Anki 原生界面，便于你继续学习。\n"
        "请检查插件配置并重启 Anki。\n\n"
    ),
    "Đây là kiểm tra khả năng API, không phải chứng nhận mọi add-on đều tương thích.": (
        "此检查仅验证 API 可用性，不代表与所有插件完全兼容。"
    ),
    "AnkiNOS chưa khởi tạo đầy đủ. Hãy kiểm tra phiên bản Anki và khởi động lại trước khi bật lại.": (
        "AnkiNOS 尚未完成初始化。请检查 Anki 版本并在重新启用前重启。"
    ),
    "Không thể nạp giao diện.": "无法加载界面。",
    "Không thể nạp giao diện phiên học.": "无法加载复习界面。",
    "Không thể khởi tạo giao diện AnkiNOS.": "无法初始化 AnkiNOS 界面。",
    "Nội dung thẻ": "卡片内容",

    # ── Native Qt menus & dialogs ─────────────────────────────────────────
    "AnkiNOS — Lệnh nhanh": "AnkiNOS — 快捷命令",
    "Lệnh nhanh AnkiNOS": "AnkiNOS 快捷命令",
    "Sổ tay AnkiNOS": "AnkiNOS 笔记本",
    "Ghi chú chung": "通用笔记",
    "Tạo bộ thẻ": "新建牌组",
    "Tên bộ thẻ mới": "新牌组名称",
    "Không có — tạo bộ thẻ cấp cao nhất": "无 — 创建顶级牌组",
    "Tên bộ thẻ:": "牌组名称：",
    "Bộ thẻ cha:": "父牌组：",
    "Tạo": "创建",
    "Đóng": "关闭",
    "Không thể tạo deck con trong bộ thẻ lọc.": "无法在筛选牌组中创建子牌组。",
    "Nhập tên bộ thẻ; tên từng cấp không được để trống.": "请输入牌组名称，各级名称不能为空。",
    "Bộ thẻ này đã tồn tại. Hãy chọn tên khác.": "该牌组已存在，请使用其他名称。",
    "Đang tạo bộ thẻ…": "正在创建牌组…",
    "Sổ tay…": "笔记本…",
    "Bỏ gắn sao": "取消星标",
    "Gắn sao bộ thẻ": "标星牌组",
    "Duyệt thẻ": "浏览卡片",
    "Tạo deck con…": "新建子牌组…",
    "Đổi tên bộ thẻ…": "重命名牌组…",
    "Tùy chọn bộ thẻ…": "牌组选项…",
    "Xuất bộ thẻ…": "导出牌组…",
    "Xóa bộ thẻ…": "删除牌组…",
    "Xóa bộ thẻ": "删除牌组",
    "Màu thư mục": "文件夹颜色",
    "Xanh dương": "蓝色",
    "Tím": "紫色",
    "Hồng": "粉色",
    "Xanh lá": "绿色",
    "Vàng": "琥珀色",
    "Mục tiêu học mỗi ngày": "每日学习目标",
    "Số lượt ôn tập mỗi ngày:": "每日复习目标次数：",
    "Mở tài nguyên": "打开资源",
    "Gỡ khỏi dashboard (giữ nguyên file)": "从主页移除（保留原文件）",
    "Đường dẫn tài nguyên (https://…)": "资源链接 (https://…)",
    "Thêm liên kết": "添加链接",
    "Hãy nhập một liên kết http hoặc https hợp lệ.": "请输入有效的 http 或 https 链接。",
    "Tên tài nguyên": "资源名称",
    "Gắn tài nguyên học tập": "附加学习资源",
    "Tài nguyên (*.pdf *.epub *.txt *.md *.csv *.xlsx *.docx *.pptx *.mp3 *.wav *.mp4 *.webm *.png *.jpg *.jpeg *.webp)": (
        "学习资源 (*.pdf *.epub *.txt *.md *.csv *.xlsx *.docx *.pptx *.mp3 *.wav *.mp4 *.webm *.png *.jpg *.jpeg *.webp)"
    ),
    "Không tìm thấy file tài nguyên. File có thể đã được di chuyển hoặc đổi tên.": (
        "未找到资源文件，文件可能已被移动或重命名。"
    ),
    "Lưu PDF": "保存 PDF",
    "Đã lưu.": "已保存。",

    # ── Media library & Qt file picker ────────────────────────────────────
    "Thêm ảnh vào thư viện AnkiNOS": "添加图片到 AnkiNOS 图库",
    "Ảnh (*.png *.jpg *.jpeg *.webp)": "图片 (*.png *.jpg *.jpeg *.webp)",
    "Dung lượng vượt quá 16 MB.": "文件大小超过 16 MB。",
    "Không thể đọc tệp ảnh.": "无法读取图片文件。",
    "Ảnh quá lớn (tối đa 24 megapixel).": "图片分辨率过大（最高 2400 万像素）。",
    "Không tạo được ảnh xem trước.": "无法生成图片预览。",
    "Không có ảnh nào được thêm.": "未添加任何图片。",
    "Một số ảnh chưa tạo được bản xem trước hoặc bản nền.": "部分图片未能生成预览或壁纸副本。",
    "Đã xóa ảnh khỏi thư viện.": "已从图库移除图片。",
    "Tên ảnh không hợp lệ (1–80 ký tự).": "图片名称无效（需 1–80 个字符）。",
    "Đã đổi tên ảnh.": "已重命名图片。",
    "Đã lưu ảnh cho giao diện.": "已为界面保存图片。",
    "Tên album trống, trùng hoặc không hợp lệ.": "相册名称为空、重复或无效。",
    "Chỉ được tạo tối đa 30 album.": "最多只能创建 30 个相册。",
    "Đã cập nhật album.": "已更新相册。",
    "Chỉ hỗ trợ PNG, JPG và WebP.": "仅支持 PNG、JPG 和 WebP 图片。",
    "Ảnh phải có dung lượng từ 1 byte đến 16 MB.": "图片大小必须在 1 字节到 16 MB 之间。",
    "Ảnh không tồn tại trong thư viện.": "图库中不存在该图片。",

    # ── Backup & restore ──────────────────────────────────────────────────
    "Đang kiểm tra và xử lý gói dữ liệu…": "正在检查并处理备份包…",
    "Đang xử lý sao lưu AnkiNOS…": "正在处理 AnkiNOS 备份…",
    "Sao lưu đầy đủ AnkiNOS": "AnkiNOS 完整备份",
    "Chọn gói AnkiNOS để xem trước": "选择要预览的 AnkiNOS 备份包",
    "Gói AnkiNOS (*.nosbackup)": "AnkiNOS 备份包 (*.nosbackup)",
    "Đã kiểm tra toàn vẹn gói. Đang chờ xác nhận khôi phục.": "已通过完整性校验，等待确认恢复。",
    "Đã hủy khôi phục. Dữ liệu hiện tại được giữ nguyên.": "已取消恢复，当前数据保持不变。",
    "Gói sao lưu thiếu audio của một câu trong Thư viện BrainExer.": "备份包缺少 BrainExer 曲库中某条目的音频。",
    "Cấu hình trong gói sao lưu không hợp lệ.": "备份包中的配置无效。",
    "Thư mục dữ liệu hồ sơ không an toàn.": "配置文件数据目录不安全。",
    "Thư mục tạm không hợp lệ.": "临时目录无效。",
    "Lịch sử Focus bị hỏng.": "专注历史数据库已损坏。",
    "Cấu trúc lịch sử Focus không được hỗ trợ.": "不支持的专注历史数据库结构。",
    "Cột dữ liệu Focus không hợp lệ.": "专注历史数据列无效。",
    "Lịch sử Focus chứa phiên không hợp lệ.": "专注历史包含无效记录。",
    "Lịch sử Pomodoro bị hỏng.": "番茄钟历史数据库已损坏。",
    "Cấu trúc lịch sử Pomodoro không được hỗ trợ.": "不支持的番茄钟历史数据库结构。",
    "Cột dữ liệu Pomodoro không hợp lệ.": "番茄钟历史数据列无效。",
    "Lịch sử Pomodoro chứa phiên không hợp lệ.": "番茄钟历史包含无效记录。",
    "Thư mục âm thanh Pomodoro không hợp lệ.": "番茄钟音频目录无效。",
    "Thư mục âm thanh Pomodoro chứa tệp không hợp lệ.": "番茄钟音频目录包含无效文件。",
    "Âm thanh Pomodoro không hợp lệ.": "番茄钟音频文件无效。",
    "AnkiNOS · Pomodoro": "AnkiNOS · 番茄钟",
    "Mở Pomodoro": "打开番茄钟",
    "Chọn âm thanh báo hết giờ học": "选择学习结束提示音",
    "Chọn âm thanh báo hết giờ nghỉ": "选择休息结束提示音",
    "Tệp âm thanh (*.mp3 *.wav *.ogg)": "音频文件 (*.mp3 *.wav *.ogg)",
    "Tệp âm thanh không tồn tại hoặc không hợp lệ.": "音频文件不存在或无效。",
    "Chỉ hỗ trợ tệp âm thanh MP3, WAV hoặc OGG.": "仅支持 MP3、WAV 或 OGG 音频文件。",
    "Tệp âm thanh phải nhỏ hơn 4 MB.": "音频文件必须小于 4 MB。",
    "Định dạng tệp âm thanh không hợp lệ.": "音频文件格式无效。",
    "Đường dẫn âm thanh không hợp lệ.": "音频文件路径无效。",
    "Thời lượng học không hợp lệ (1–180 phút).": "学习时长无效（1–180 分钟）。",
    "Thời lượng nghỉ không hợp lệ (1–60 phút).": "休息时长无效（1–60 分钟）。",
    "Chế độ Pomodoro không hợp lệ.": "番茄钟模式无效。",
    "Pha Pomodoro không hợp lệ.": "番茄钟阶段无效。",
    "Thời gian cộng thêm không hợp lệ.": "延长时间无效。",
    "Chọn thời lượng học từ 1 đến 180 phút.": "请选择 1 到 180 分钟的学习时长。",
    "Hãy lưu gói sao lưu bên ngoài thư mục dữ liệu hồ sơ.": "请将备份包保存在配置文件数据目录之外。",
    "Không sao lưu liên kết ngoài thư mục hồ sơ.": "无法备份指向配置文件目录外部的符号链接。",
    "Thư viện audio BrainExer không hợp lệ.": "BrainExer 音频目录无效。",
    "Thư viện audio BrainExer chứa tệp không hợp lệ.": "BrainExer 音频目录包含无效文件。",
    "Gói sao lưu có quá nhiều tệp.": "备份包包含的文件数量过多。",
    "Dữ liệu vượt giới hạn dung lượng sao lưu.": "数据超出备份大小限制。",
    "Danh sách tệp sao lưu không hợp lệ.": "备份文件列表无效。",
    "Không hỗ trợ tệp mã hóa hoặc liên kết.": "不支持加密条目或符号链接。",
    "Gói sao lưu chứa đường dẫn hoặc tệp không được hỗ trợ.": "备份包包含不支持的路径或文件。",
    "Gói sao lưu vượt giới hạn dung lượng.": "备份包超出允许的最大容量。",
    "Định dạng hoặc phiên bản gói sao lưu không được hỗ trợ.": "不支持的备份格式或版本。",
    "Nội dung gói sao lưu không khớp bản kê.": "备份内容与清单不匹配。",
    "Phiên bản gói sao lưu không hỗ trợ dữ liệu BrainExer.": "此备份版本不支持 BrainExer 数据。",
    "Phiên bản gói sao lưu không hỗ trợ audio BrainExer.": "此备份版本不支持 BrainExer 音频。",
    "Bản kê tệp không hợp lệ.": "文件清单无效。",
    "Dung lượng tệp không khớp bản kê.": "文件大小与清单不匹配。",
    "Tệp sao lưu không vượt qua kiểm tra toàn vẹn.": "备份文件未通过完整性检查。",
    "Audio BrainExer không hợp lệ.": "BrainExer 音频文件无效。",
    "Gói sao lưu thiếu ảnh đã đăng ký.": "备份包缺少已登记的图片。",
    "Danh sách bộ thẻ không hợp lệ.": "备份中的牌组名称映射无效。",
    "Gói sao lưu đã thay đổi trong khi đọc. Hãy chọn lại.": "读取期间备份文件已变更，请重新选择。",
    "Gói sao lưu đã thay đổi. Hãy chọn lại để xem trước.": "备份文件已变更，请重新选择以预览。",
    "Thư mục hồ sơ chứa mục chưa hỗ trợ khôi phục.": "配置文件目录包含无法安全恢复的项目。",
    "Thư mục đích nằm ngoài dữ liệu AnkiNOS.": "目标目录位于 AnkiNOS 数据目录之外。",
    "Phiên bản dữ liệu BrainExer cũ không được hỗ trợ.": "不支持的旧版 BrainExer 数据库版本。",
    "Dữ liệu BrainExer cũ bị lỗi.": "旧版 BrainExer 数据库已损坏。",
    "Cấu trúc dữ liệu BrainExer cũ không hợp lệ.": "旧版 BrainExer 数据库结构无效。",
    "Cấu hình BrainExer cũ không hợp lệ.": "旧版 BrainExer 配置无效。",
    "Dữ liệu học cũ không hợp lệ hoặc phiên bản chưa hỗ trợ.": "旧学习数据无效或版本不受支持。",
    "Cấu trúc dữ liệu học cũ không hợp lệ.": "旧学习数据库结构无效。",
    "Thiếu cột trong dữ liệu học cũ.": "旧学习数据库缺少必要字段。",
    "Nội dung dữ liệu học cũ không hợp lệ.": "旧学习数据库包含无效记录。",

    # ── Study, stats, daily scheduler, tools & stores ─────────────────────
    "Bộ thẻ không còn tồn tại.": "该牌组已不存在。",
    "Bộ thẻ không còn tồn tại. Hãy làm mới dashboard.": "该牌组已不存在，请刷新主页。",
    "Chọn thời lượng 15, 30 hoặc 60 phút.": "请选择 15、30 或 60 分钟。",
    "Các thẻ liên quan đã thay đổi. Hãy làm mới nhận xét.": "相关卡片已变更，请刷新洞察。",
    "Bộ lọc thống kê không hợp lệ.": "统计筛选条件无效。",
    "Bộ lọc tìm kiếm thẻ không hợp lệ.": "卡片搜索筛选条件无效。",
    "Phạm vi thống kê không hợp lệ.": "统计范围无效。",
    "Khoảng thời gian thống kê không hợp lệ.": "统计时间范围无效。",
    "Phiên bản Anki này chưa hỗ trợ dữ liệu đồ thị gốc.": "当前 Anki 版本不支持原生图表数据。",
    "Bộ thẻ được chọn không tồn tại.": "所选牌组不存在。",
    "Loại nhận xét không hợp lệ.": "洞察类型无效。",
    "Thời lượng Focus không hợp lệ.": "专注时长无效。",
    "Đang mở phiên học, vui lòng chờ giây lát.": "正在打开学习会话，请稍候。",
    "AnkiNOS: Điều phối lịch ôn": "AnkiNOS：调整每日复习计划",
    "AnkiNOS: Hoàn tác điều phối lịch ôn": "AnkiNOS：撤销每日复习调整",
    "Không tìm thấy đợt điều phối cần hoàn tác.": "未找到要撤销的调整批次。",
    "Đợt điều phối này đã được hoàn tác trước đó.": "此调整批次先前已被撤销。",
    "Phạm vi hiện tại không khớp bộ thẻ nào.": "当前范围未匹配到任何牌组。",
    "Hôm nay chưa có thẻ đến hạn trong phạm vi đang chọn.": "当前范围内今日没有到期卡片。",
    "Hôm nay không còn thẻ đến hạn sẵn sàng (có thể đang nằm trong bộ thẻ lọc khác).": (
        "今日已无可用到期卡片（可能已在其他筛选牌组中）。"
    ),
    "Hôm nay không còn thẻ đến hạn sẵn sàng để mở phiên ôn.": "今日已无可用于开始复习的到期卡片。",
    "Cấu hình phạm vi không hợp lệ.": "范围配置无效。",
    "Thiếu mã đợt điều phối cần hoàn tác.": "缺少要撤销的调整批次 ID。",
    "Chọn thời lượng Focus 15, 30 hoặc 60 phút.": "请选择 15、30 或 60 分钟的专注时长。",
    "Lệnh Lịch ôn không được hỗ trợ.": "不支持的每日计划命令。",
    "Hãy nhập tên phạm vi.": "请输入范围名称。",
    "Dữ liệu Lịch ôn bị hỏng.": "每日计划数据库已损坏。",
    "Dữ liệu Lịch ôn lỗi khóa ngoại.": "每日计划数据库外键校验失败。",
    "Phiên bản dữ liệu Lịch ôn không được hỗ trợ.": "不支持的每日计划数据库版本。",
    "Cấu trúc dữ liệu Lịch ôn không hợp lệ.": "每日计划数据库结构无效。",
    "Thiếu cột trong dữ liệu Lịch ôn.": "每日计划数据库缺少列。",
    "Dữ liệu gửi quá lớn.": "提交的数据过大。",
    "Lệnh không hợp lệ.": "无效命令。",
    "Kết quả tìm kiếm không hợp lệ.": "无效的搜索结果。",
    "Ghi chú đã thay đổi. Hãy tìm lại.": "笔记已变更，请重新搜索。",
    "Lệnh không được hỗ trợ.": "不支持的命令。",
    "Đã lưu ghi chú trên máy.": "笔记已保存在本地。",
    "Ghi chú này không gắn với note Anki đang tồn tại trong bộ sưu tập này.": (
        "此笔记未关联到当前牌组集合中的 Anki 笔记。"
    ),
    "Note nguồn đã bị xóa; ghi chú vẫn được giữ.": "源 Anki 笔记已被删除，但笔记本记录已保留。",
    "Dữ liệu sổ tay không hợp lệ hoặc chưa hỗ trợ phiên bản này.": "笔记本数据库无效或版本不受支持。",
    "Cấu trúc sổ tay không hợp lệ.": "笔记本数据库结构无效。",
    "Thiếu cột dữ liệu sổ tay.": "笔记本数据库缺少列。",
    "Ghi chú không hợp lệ.": "无效的笔记条目。",
    "Phiên bản sổ tay chưa được hỗ trợ.": "不支持的笔记本数据库版本。",
    "Ghi chú cần nội dung, tối đa 20.000 ký tự; tiêu đề tối đa 160 ký tự.": (
        "笔记内容不能为空（最多 20,000 字符；标题最多 160 字符）。"
    ),
    "Ghi chú thuộc ngữ cảnh khác.": "此笔记属于其他上下文。",
    "Quay lại giao diện AnkiNOS": "返回 AnkiNOS 界面",
    "Đang dùng giao diện Anki gốc · nhấn để bật lại AnkiNOS": "当前正在使用 Anki 原生界面 · 点击切换回 AnkiNOS",
    "Đã ghim ghi chú lên đầu.": "已置顶笔记。",
    "Đã bỏ ghim ghi chú.": "已取消置顶笔记。",
    "Đã nhân bản ghi chú.": "已复制笔记。",
    "Không tìm thấy ghi chú.": "未找到该笔记。",
    "Không tìm thấy ghi chú để nhân bản.": "未找到要复制的笔记。",
}

_ZH_CN_PATTERNS: list[tuple[re.Pattern[str], Callable[[re.Match[str], Callable[[str], str]], str]]] = [
    (re.compile(r"^Có: (.+)$"), lambda m, t: "支持：" + t(m.group(1))),
    (re.compile(r"^Chưa hỗ trợ: (.+)$"), lambda m, t: "暂不支持：" + t(m.group(1))),
    (re.compile(r"^Lần lỗi gần nhất: (.+)$", re.S), lambda m, t: "最近错误：" + t(m.group(1))),
    (re.compile(r"^Thư viện đã đạt giới hạn (\d+) ảnh\.$"), lambda m, _: f"图库已达到 {m.group(1)} 张图片上限。"),
    (re.compile(r"^Không giải mã được ảnh: (.+)$", re.S), lambda m, _: f"无法解码图片：{m.group(1)}"),
    (re.compile(r"^Đã thêm (\d+) ảnh\.$"), lambda m, _: f"已添加 {m.group(1)} 张图片。"),
    (re.compile(r"^Xóa ảnh '(.+)' khỏi thư viện AnkiNOS\?$"), lambda m, _: f"确定从 AnkiNOS 图库中删除图片“{m.group(1)}”吗？"),
    (re.compile(r"^Không thể đọc dữ liệu Anki: (.+)$", re.S), lambda m, t: "无法读取 Anki 数据：" + t(m.group(1))),
    (re.compile(r"^Không thể đọc nhận xét học tập: (.+)$", re.S), lambda m, t: "无法读取学习洞察：" + t(m.group(1))),
    (re.compile(r"^Không thể bắt đầu phiên học: (.+)$", re.S), lambda m, t: "无法开始学习会话：" + t(m.group(1))),
    (re.compile(r"^Không thể xử lý gói sao lưu: (.+)$", re.S), lambda m, t: "无法处理备份包：" + t(m.group(1))),
    (re.compile(r"^Đã sao lưu đầy đủ tại (.+)$", re.S), lambda m, _: "完整备份已保存到 " + m.group(1)),
    (re.compile(r"^Đã khôi phục đầy đủ\. Bản trước khôi phục: (.+)$", re.S), lambda m, _: "恢复完成。恢复前备份：" + m.group(1)),
    (re.compile(r"^Đã khôi phục dữ liệu AnkiNOS\. Bản trước khôi phục: (.+)$", re.S), lambda m, _: "已恢复 AnkiNOS 数据。恢复前备份：" + m.group(1)),
    (re.compile(r"^Ảnh trong gói không hợp lệ hoặc vượt 24 megapixel: (.+)$"), lambda m, _: "备份包中的图片无效或超过 2400 万像素：" + m.group(1)),
    (re.compile(r"^Thiếu ảnh trong thư viện: (.+)$"), lambda m, _: "图库缺少图片：" + m.group(1)),
    (re.compile(r"^Không thể tải thống kê Anki: (.+)$", re.S), lambda m, t: "无法加载 Anki 统计：" + t(m.group(1))),
    (re.compile(r"^Không thể đổi bộ thẻ thống kê: (.+)$", re.S), lambda m, t: "无法切换统计牌组：" + t(m.group(1))),
    (re.compile(r"^Đã tạo: (.+)$"), lambda m, _: "已创建：" + m.group(1)),
    (re.compile(r"^Không thể tạo bộ thẻ: (.+)$", re.S), lambda m, t: "无法创建牌组：" + t(m.group(1))),
    (re.compile(r"^Tối đa (\d+) phạm vi đã lưu\. Hãy xóa bớt trước khi thêm\.$"), lambda m, _: f"已达 {m.group(1)} 个已保存范围上限，请先删除旧范围后再添加。"),
    (re.compile(r"^Xóa bộ thẻ lọc <b>(.+)</b>\?<br>Thẻ sẽ được trả về bộ thẻ gốc\.$", re.S),
     lambda m, _: f"确定删除筛选牌组 <b>{m.group(1)}</b> 吗？<br>卡片将退回原始牌组。"),
    (re.compile(r"^Xóa bộ thẻ <b>(.+)</b>, (\d+) bộ con và (\d+) thẻ\?<br>Bạn có thể dùng Hoàn tác của Anki sau khi xóa\.$", re.S),
     lambda m, _: (
         f"确定删除牌组 <b>{m.group(1)}</b>、{m.group(2)} 个子牌组和 {m.group(3)} 张卡片吗？<br>删除后可使用 Anki 撤销。"
     )),
    (re.compile(r"^([^:\n]+): (.+)$"), lambda m, t: f"{m.group(1)}: {t(m.group(2))}" if t(m.group(2)) != m.group(2) else m.group(0)),
]

_PACKS: dict[str, tuple[dict[str, str], list[tuple[re.Pattern[str], Callable[[re.Match[str], Callable[[str], str]], str]]]]] = {
    "en": (_EN_DICT, _EN_PATTERNS),
    "zh-cn": (_ZH_CN_DICT, _ZH_CN_PATTERNS),
}


def translate(text: str, lang: str = SOURCE_LANGUAGE) -> str:
    """Translate a Vietnamese source string to ``lang``; return unchanged if unknown."""
    if not text or lang not in _PACKS:
        return text
    dictionary, patterns = _PACKS[lang]
    direct = dictionary.get(text)
    if direct is not None:
        return direct
    sub = lambda piece: translate(piece, lang)
    for pattern, build in patterns:
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
    if lang == "zh-cn":
        return (
            "<b>AnkiNOS 恢复预览</b>"
            f"<br><br>源配置文件：{source_profile}"
            f"<br>创建时间：{created_at}"
            f"<br>图片：{images_count} · 相册：{albums_count} · 专注会话：{focus_sessions}"
            f"<br>资源引用：{resources_count}"
            f"<br>笔记：{notes_count}"
            f"<br><br>目标配置文件：<b>{target_profile}</b>"
            "<br>界面设置、图片、专注历史与笔记本将被替换。"
            "替换前会自动将当前状态安全备份到 user_files/backups。"
            "<br>此备份包不包含 Anki 卡片。外部资源仅保存文件路径，更换电脑后可能需要重新关联。"
            "<br><br>确认恢复到此配置文件吗？"
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
