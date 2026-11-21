# Anki BrainExer — cấu trúc phiên bản 0.2.0

Tên chính thức của dự án là BrainExer. Thư mục phát triển hiện tại có thể có dấu cách, nhưng gói phát hành dùng package brainexer trong manifest.json.

## Thành phần chạy thật

    __init__.py                 Entry point và đăng ký menu Anki
    manifest.json               Metadata gói add-on
    config.json                 Cấu hình không bí mật mặc định
    config.md                   Hướng dẫn cấu hình trong Anki
    core/
      deck_reader.py            Đọc, đếm và lấy mẫu thẻ bằng API Anki
      field_mapper.py           Tự nhận diện target/context/POS
      rate_limiter.py           Reserve quota nguyên tử theo ngày/tuần
      answering.py              Chấm cục bộ các bài có đáp án rõ ràng
      service.py                Điều phối AI, DB, quota và sổ lỗi
      mistake_bank.py           Chuyển lỗi thành thẻ SRS của Anki
    ai/
      base.py                   Hợp đồng client và HTTP/JSON dùng chung
      factory.py                Chọn adapter và model theo provider
      client.py                 OpenAI Responses API
      deepseek_client.py        DeepSeek Chat Completions + JSON mode
      gemini_client.py          Gemini Interactions + structured output
      schemas.py                JSON Schema và validation cục bộ
      prompt_loader.py          Chỉ tải prompt nằm trong allow-list
      prompts/                  Prompt đang được sử dụng ở runtime
    security/
      keyring_store.py          OS Keyring; Windows dùng Credential Manager
    db/
      schema.sql                Nguồn schema cho database mới
      connection.py             Kết nối, foreign keys và migrations
      migrations/               Migration từ schema phiên bản 2 trở đi
    ui/
      main_dialog.py            Luồng chọn deck, tạo bài và chấm
      settings_dialog.py        Cấu hình + lưu API key vào Keyring
      mistakes_dialog.py        Xem lỗi, đánh dấu thuộc, tạo thẻ Anki
    user_files/
      brainexer.db              Dữ liệu runtime, không commit
    tests/                       Unit tests không cần mở Anki

## Quy tắc phụ thuộc

UI gọi core. Core có thể gọi ai và db, nhưng không import Qt. AI và db không import UI hay Anki. Các thao tác đọc collection chạy bằng QueryOp; gọi mạng chạy nền mà không khóa collection; sửa collection dùng CollectionOp.

## Dữ liệu bí mật và riêng tư

API key không xuất hiện trong config.json, meta.json, log hoặc SQLite; mỗi khóa được tách theo profile Anki và provider. Người dùng phải bật đồng ý trước khi field thẻ/bài viết được gửi tới provider đã chọn. Response thô mặc định không được lưu.

## Schema và migration

db/schema.sql là nguồn dùng để tạo database mới và đặt PRAGMA user_version. File 02-schema.sql là snapshot có chú thích để review. Từ phiên bản 2, mỗi thay đổi thêm một migration; không sửa database collection của Anki.
