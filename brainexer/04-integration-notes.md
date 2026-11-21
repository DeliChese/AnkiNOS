# BrainExer — ghi chú tích hợp phiên bản 0.2.0

## Luồng tạo bài

1. QueryOp đọc danh sách card ID và field cần thiết từ deck.
2. RateLimiter mở BEGIN IMMEDIATE, kiểm tra giới hạn và reserve cả api_call lẫn exercise_generated.
3. Factory tạo adapter OpenAI, DeepSeek hoặc Gemini theo cấu hình và gửi system instructions, task prompt cùng source_data đã JSON-serialize.
4. Adapter yêu cầu JSON có cấu trúc bằng cơ chế tương ứng của provider; BrainExer vẫn validate lại response ở local.
5. Nếu status là insufficient_data, api_call được tính nhưng reservation exercise_generated bị hủy.
6. Nếu thành công, payload đã validate được lưu riêng với model, prompt_version và request ID.

## Hợp đồng response chung

Mọi prompt trả đúng ba trường:

    status: ok hoặc insufficient_data
    reason: chuỗi rỗng khi ok, lý do khi insufficient_data
    data: object theo schema tương ứng

Schema strict yêu cầu data luôn đủ key; field không áp dụng dùng chuỗi hoặc danh sách rỗng. Không có biến thể reason_if_insufficient.

## Chấm câu trả lời

Fill blank, synonym/antonym, word form và nuance được so khớp cục bộ sau khi chuẩn hóa Unicode, chữ hoa/thường và khoảng trắng. Cách này không tốn thêm API call. Writing free gọi AI lần thứ hai và mỗi errors item được lưu thành một mistake độc lập.

## Keyring

Trên Windows, security/keyring_store.py gọi Credential Manager bằng ctypes. Trên macOS/Linux, backend Python keyring được dùng nếu có. API key được phân tách theo tên profile Anki và provider, không được ghi vào config hoặc database.

## Làm lại bài

Sổ lỗi hỗ trợ đánh dấu cần ôn/đã thuộc. Nút Thêm thành thẻ Anki tạo note type BrainExer Mistake và deck BrainExer::Mistakes để sử dụng thuật toán SRS có sẵn của Anki.

## Chính sách dữ liệu

Chỉ các field đã lấy mẫu được gửi đi. Nội dung thẻ được đánh dấu là untrusted data để giảm prompt injection. `store=false` được gửi tới OpenAI Responses và Gemini Interactions; tùy chọn lưu response thô ở local mặc định tắt.

## Adapter AI

- OpenAI: Responses API với JSON Schema strict.
- DeepSeek: Chat Completions với `response_format=json_object`; schema cũng được nhúng trong system prompt và response được validate lại.
- Gemini: Interactions API ở chế độ stateless với `store=false` và JSON Schema trong `response_format`.
