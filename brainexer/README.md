# Anki BrainExer 0.2.0

BrainExer tạo bài tập ứng dụng từ deck Anki, chấm bài viết bằng AI và biến lỗi thành dữ liệu có thể ôn lại.

## Tính năng MVP

- Chọn deck, tùy chọn bao gồm deck con và hiển thị số thẻ khả dụng.
- Điền từ, đồng/trái nghĩa, biến đổi từ loại, sắc thái và viết tự do.
- Các bài có đáp án rõ ràng được chấm cục bộ; bài viết được AI chấm theo rubric 0-10.
- Lưu lỗi lưu từng lỗi độc lập, có trạng thái cần ôn/đã thuộc.
- Chuyển một lỗi thành thẻ trong deck BrainExer::Mistakes để ôn bằng SRS.
- Quota ngày/tuần được reserve bằng transaction SQLite.
- API key lưu trong OS Keyring; Windows hoạt động không cần thư viện ngoài.
- Chọn OpenAI, DeepSeek hoặc Gemini; mỗi provider có model và API key riêng.

## Cách dùng

1. Khởi động lại Anki sau khi đặt thư mục này trong addons21.
2. Mở Tools > BrainExer: Luyện tập.
3. Mở Cài đặt, chọn OpenAI, DeepSeek hoặc Gemini, nhập API key tương ứng và bật xác nhận gửi dữ liệu.
4. Chọn deck, dạng bài rồi bấm Tạo câu hỏi.
5. Xem lại lỗi qua Tools > BrainExer: Sổ lỗi.

API key không được ghi vào config.json, meta.json hoặc brainexer.db. Trên Windows, credential có target Anki BrainExer và được tách theo cả profile Anki lẫn provider.

## AI và dữ liệu

Các adapter gọi API chính thức bằng HTTPS và không cần cài SDK: OpenAI Responses API, DeepSeek Chat Completions ở JSON mode và Gemini Interactions API với structured output. BrainExer luôn kiểm tra lại response theo hợp đồng chung ở local. Với API hỗ trợ tùy chọn lưu trữ, request đặt `store=false`.

Chỉ các field thẻ được lấy mẫu cho câu hiện tại cùng bài viết người dùng được gửi đi. Lưu response thô mặc định tắt. Model mặc định là `gpt-5-mini`, `deepseek-v4-flash` và `gemini-2.5-flash`; có thể đổi từng model trong Cài đặt. Việc dùng API có thể phát sinh chi phí trong tài khoản nhà cung cấp.

## Kiểm thử lõi

Chạy từ thư mục add-on:

    python -m pytest -p no:cacheprovider

Các unit test không cần mở Anki. Kiểm thử giao diện và API thật cần chạy trong Anki với API key của người dùng.
