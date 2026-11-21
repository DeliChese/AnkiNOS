# Migrations

Schema phiên bản 1 được khởi tạo từ `db/schema.sql`. Mỗi tệp nâng cấp chạy theo thứ tự và cập nhật `PRAGMA user_version` trong cùng giao dịch. Phiên bản 2 mở rộng các dạng bài kiến thức và giữ lại ID bài cũ, lượt trả lời cùng liên kết sổ lỗi.
