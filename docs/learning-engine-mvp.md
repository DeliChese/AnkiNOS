# AnkiNOS Learning Engine — đặc tả MVP

Trạng thái: đề xuất thiết kế, chưa triển khai engine. Ngày: 16/11/2026.

## Mục tiêu sản phẩm

Cho phép luyện cùng một nội dung bằng nhiều hình thức, lưu bằng chứng riêng
cho từng mục tiêu học và giải thích được đề xuất luyện tiếp. Giao diện phục vụ
luồng học này. Chưa tuyên bố engine đo chính xác mức hiểu hoặc cải thiện ghi nhớ.

Luồng MVP: chọn bộ thẻ → chọn kiểu note và ánh xạ trường → xem trước nội dung →
chọn mode → luyện → xem kết quả theo mục tiêu → chọn bài luyện tiếp.

## Thiết kế đa ngành và giảm công nhập liệu

Tách hai trách nhiệm: biên soạn học liệu từ nội dung nguồn, và điều phối luyện
tập từ học liệu đã duyệt. Lõi dùng chung hợp đồng dữ liệu; gói chuyên ngành
cung cấp cấu trúc nội dung, mẫu nhiệm vụ, điều kiện đủ dữ liệu và rubric chấm.
Nhãn Bloom mô tả mục tiêu của nhiệm vụ, không thay thế cấu trúc chuyên ngành.

Ví dụ gói Ngoại ngữ phân biệt từ, nghĩa, cấu trúc, ngữ cảnh và đáp án tương
đương; gói Y học phân biệt khái niệm, cơ chế, điều kiện áp dụng, quan hệ và dữ
kiện tình huống. Không buộc người dùng điền cùng một biểu mẫu cho mọi ngành.
Gói chuyên ngành là cấu hình/mẫu có phiên bản; MVP không nạp mã thực thi do bên
thứ ba cung cấp.

Luồng biên soạn đề xuất:

1. Người dùng chọn mục tiêu bằng ngôn ngữ gần gũi, chẳng hạn nhớ thuật ngữ,
   dùng được cấu trúc, giải thích cơ chế hoặc luyện tình huống. Cho phép phối
   hợp nhiều mục tiêu; lựa chọn ngành là gợi ý có thể sửa, không là nhãn cố định.
2. Nhập đoạn văn hoặc chọn note có sẵn. Ánh xạ note type chỉ làm một lần và
   được dùng lại; chỉ yêu cầu bổ sung thông tin cần thiết đang thiếu.
3. Hệ thống đề xuất các điểm kiến thức và quan hệ, giữ tham chiếu chính xác
   tới đoạn nguồn hoặc trường note. Người dùng có thể sửa, gộp, tách hoặc bỏ.
4. Áp dụng mẫu nhiệm vụ phù hợp mục tiêu và dữ liệu. Mỗi bài nháp có câu hỏi,
   đáp án/rubric, giải thích, nguồn, mode và điều kiện áp dụng.
5. Hiển thị theo nhóm để duyệt: phần trích từ nguồn, phần suy diễn và ví dụ
   mới được đề xuất phải phân biệt rõ. Không tạo trích dẫn giả cho phần sinh mới.
6. Chỉ học liệu được chấp nhận mới vào kho hoạt động. Lưu một lần nội dung
   chuẩn hóa; tạo biến thể trình bày từ nội dung đó theo nhu cầu, không tự nhân
   mọi nhiệm vụ thành card Anki có lịch ôn độc lập.

Một đầu vào có thể sinh nhiều nhiệm vụ, nhưng không bắt buộc đủ sáu bậc Bloom.
Một cặp thuật ngữ–định nghĩa thường không đủ dữ liệu để tạo tình huống vận dụng
hay rubric sáng tạo. Hệ thống nêu phần còn thiếu, tiếp tục với nhiệm vụ hợp lệ
và cho bổ sung sau; không chặn toàn bộ luồng vì thiếu một mục tiêu nâng cao.

Có hai mức hỗ trợ biên soạn: mẫu xác định từ trường đã ánh xạ, và AI hỗ trợ
trích xuất/đề xuất. AI là thành phần có thể thay thế, chưa là phụ thuộc bắt buộc
của lõi. Khi dùng dịch vụ ngoài, phải cho người dùng biết nội dung sẽ được gửi
đến nhà cung cấp nào trước khi bật. Tính năng AI chưa được triển khai trong MVP.

Độ tự tin do mô hình tự khai không phải bằng chứng đúng. Kiểm tra cấu trúc,
đáp án mâu thuẫn, phương án nhiễu tương đương, điều kiện và tham chiếu nguồn;
kiểm tra chuyên môn vẫn cần người có năng lực phù hợp. Gói Y học thí điểm dùng
học liệu đã được người có chuyên môn duyệt; bài tình huống sinh mới giữ trạng
thái bản nháp cho tới khi được kiểm tra. Có nguồn chưa chứng minh nội dung nguồn
đúng hoặc còn cập nhật.

## Giải thích engine qua trải nghiệm

Lần đầu có hai lựa chọn: học thử bằng nội dung mẫu và dùng nội dung của tôi.
Ví dụ mẫu đã chuẩn bị cho thấy cùng nội dung có thể được nhận diện, tự nhớ và
vận dụng ra sao. Mỗi bài có giải thích ngắn về việc đang luyện; kết quả cho thấy
trả lời có gợi ý và độc lập được ghi khác nhau. Không yêu cầu học lý thuyết Bloom
trước khi thêm nội dung. Chế độ thêm nhanh dùng cấu hình deck đã lưu, với bản
xem trước có thể sửa trước khi đưa học liệu vào sử dụng.

Trước khi mở rộng số mode, chạy cùng hợp đồng dữ liệu với hai bộ mẫu Ngoại ngữ
và Y học đã duyệt. Đo thời gian nhập/duyệt, số sửa lỗi và chất lượng nhiệm vụ;
không coi số lượng bài sinh ra là thước đo thành công. Xử lý nội dung dài, file
tài liệu và các gói ngành khác được mở rộng sau khi luồng này hoạt động tốt.

## Phạm vi đầu tiên

- Nội dung thí điểm: từ vựng song ngữ, gồm từ/cụm từ, nghĩa và ví dụ tùy chọn.
- Dùng note có sẵn qua ánh xạ trường; người dùng xem trước trước khi bắt đầu.
- Ba mode: nối cặp, trắc nghiệm một đáp án, nhập đáp án ngắn.
- Hai mục tiêu ban đầu: nhận diện và tự nhớ lại. Mode và mục tiêu là hai thuộc
  tính riêng, không suy ra cấp Bloom từ tên mode hoặc độ dài câu trả lời.
- Luyện tập chạy trong cửa sổ AnkiWebView riêng, mở từ menu bộ thẻ; học và ôn
  Anki hiện tại tiếp tục đi qua reviewer gốc.
- Chưa tự sinh bài Hiểu/Vận dụng/Create, chưa chấm tự luận bằng AI, chưa có
  scheduler mới hoặc tự chuyển kết quả luyện thành rating của Anki.

## Nội dung và ánh xạ

Một note nguồn có thể phục vụ nhiều nhiệm vụ, không tạo một bản sao note cho
mỗi mode. Một phiên chỉ sử dụng một cấu hình ánh xạ note type để tránh lẫn trường.

Nội dung phải có prompt, một hoặc nhiều đáp án chấp nhận, chiều hỏi và ngôn ngữ.
Ví dụ và giải thích là tùy chọn. Không tách tùy tiện HTML của mặt thẻ để đoán đáp án.
Đợt đầu chỉ nhận văn bản; note có cloze, ảnh, âm thanh, HTML phức tạp hoặc thiếu
trường cần thiết được liệt kê là chưa hỗ trợ. Không chạy script của note trong UI.

Trắc nghiệm dùng phương án nhiễu do người dùng cung cấp và duyệt trước, cùng
loại nội dung; không lấy ngẫu nhiên từ mọi note. Nếu thiếu phương án hợp lệ thì
bỏ qua nhiệm vụ trắc nghiệm và nêu lý do. Một câu có ít nhất ba phương án khác
nhau, đúng một phương án được chấp nhận; không đưa đáp án tương đương vào nhiễu.

Nối cặp chỉ dùng nhóm có ánh xạ một-một rõ ràng. Nội dung trùng hoặc đa nghĩa
chưa được phân biệt thì không ghép vào cùng nhóm.

## Quy tắc trả lời và bằng chứng

| Mode | Mục tiêu mặc định | Bằng chứng lưu |
| --- | --- | --- |
| Nối cặp | Nhận diện | Cặp chọn, lần chọn sai, số cặp còn lại, lần lộ đáp án |
| Trắc nghiệm | Nhận diện | Tập phương án, lựa chọn đầu, số lần thử, gợi ý |
| Nhập ngắn | Tự nhớ lại | Câu trả lời đầu, quy tắc chấm, lỗi, gợi ý và số lần thử |

- Lưu riêng kết quả lần đầu và kết quả sau sửa; không ghi đè sai thành đúng.
- Ghi sự kiện đã thấy đáp án, kể cả khi chuyển sang mode khác. Lượt sau khi đã
  thấy đáp án trong phiên có nhãn đã được hỗ trợ, không là bằng chứng tự nhớ độc lập.
- Nối cặp ghi nhận cả việc loại trừ: cặp cuối bắt buộc không tính là thành công
  nhận diện độc lập. Hiện toàn bộ nhóm cũng là một sự kiện tiếp xúc nội dung.
- Thời gian trả lời chỉ là dữ liệu quan sát; không tự quy thành năng lực vì tốc
  độ gõ và khả năng tiếp cận của mỗi người khác nhau.
- Nhập ngắn chuẩn hóa Unicode NFC và khoảng trắng đầu/cuối. Hoa/thường có tùy
  chọn, mặc định không phân biệt; dấu tiếng Việt và dấu câu được giữ. Danh sách
  đáp án tương đương do người soạn xác nhận. Quy tắc chấm hiển thị trước khi học.
- Lưu dấu hiệu sai chính tả/hoa-thường riêng khi phát hiện được; không tự kết
  luận một chuỗi gần giống chứng minh người học hiểu đúng nghĩa.

## Dữ liệu và ranh giới với Anki

Mô hình đề xuất:

- `SourceRef`: collection key, note ID, note type ID, ánh xạ trường, chiều hỏi,
  mã băm nội dung và phiên bản cấu hình chấm.
- `Task`: nguồn, mode, mục tiêu, prompt, đáp án, nhiễu, quy tắc chấm và revision.
- `Session`: ID, thời điểm bắt đầu/kết thúc, trạng thái hoàn thành/gián đoạn.
- `Attempt`: ID duy nhất, task revision, thời điểm, câu trả lời đầu, kết quả,
  số lần thử, thời gian chủ động, gợi ý và thông tin tiếp xúc đáp án.
- `EvidenceSummary`: tổng hợp theo nguồn, mục tiêu và revision; có thể dựng lại
  từ lịch sử, không là điểm Bloom hoặc phần trăm thành thạo đã được kiểm chứng.

SQLite riêng theo profile tại `user_files/<profile>/learning.sqlite3`, có schema
version và migration. Collection key là UUID trong collection config, được tạo
qua API cấu hình Anki khi người dùng lần đầu bật engine. Đây là metadata định
danh; engine không sửa note, card, due, interval hoặc revlog trong phiên luyện.

Lịch sử ghi đủ snapshot nhiệm vụ để hiểu lần trả lời cũ. Note đổi nội dung hoặc
quy tắc chấm thì tạo revision mới, không gộp thành thạo từ nội dung cũ. Note bị xóa
thì ngừng đưa vào phiên mới và giữ lịch sử có nhãn nguồn không còn tồn tại.

Tải nguồn và truy vấn collection trên luồng nền. Thao tác trên SQLite engine
phải ngắn và tuần tự, ghi theo giao dịch; gửi lại cùng attempt ID không tạo bản
ghi trùng. Khi đóng profile phải kết thúc phiên và bỏ kết quả nền của profile cũ.

Dữ liệu ban đầu là cục bộ, cần ghi rõ không sync AnkiWeb. Trước phát hành công
khai phải có xuất/nhập gói engine gồm ánh xạ, cấu hình, nguồn đã lưu và lịch sử;
không được tự liên kết note khi nhập sang collection khác. Câu trả lời cá nhân
không gửi ra dịch vụ ngoài.

## Đề xuất bài tiếp theo

Đợt đầu dùng quy tắc minh bạch, người học có thể chọn mode khác:

- Nhận diện đúng nhưng chưa có lượt tự nhớ độc lập: đề xuất nhập ngắn.
- Tự nhớ thất bại: phản hồi đáp án và cho luyện có gợi ý; ghi đây là luyện hỗ trợ.
- Thành công sau khi vừa xem đáp án: đề xuất kiểm tra lại ở phiên sau.
- Chưa có dữ liệu: hiển thị chưa đủ dữ liệu, không tự gán mức thành thạo.

Không bắt buộc đi qua sáu bậc Bloom. Hiểu/Vận dụng/Create được bổ sung khi có
nhiệm vụ phù hợp, rubric và cách kiểm tra chất lượng chấm.

## Thứ tự triển khai và điều kiện hoàn tất

1. **Lõi và lưu trữ:** kiểu dữ liệu, revision, chấm nhập ngắn, sự kiện tiếp xúc,
   lưu attempt và tổng hợp. Chạy được không cần Anki/Qt.
2. **Luồng học hoàn chỉnh đầu tiên:** ánh xạ trường → nhập ngắn trong WebView
   riêng → lưu → xem kết quả → mở lại lịch sử. Dùng dữ liệu thử trước.
3. **Nối cặp và trắc nghiệm:** cùng hợp đồng dữ liệu và bằng chứng; xử lý nhiễu,
   câu mơ hồ, loại trừ và tiếp xúc đáp án.
4. **Gợi ý và chuyển máy:** đề xuất có giải thích, xuất/nhập gói, lỗi nguồn,
   đóng bất thường và tách profile; hoàn thiện khả năng dùng bàn phím.
5. **Thí điểm học thật:** ghi nhận khó khăn sử dụng và kiểm tra lại sau 24 giờ,
   7 ngày bằng bài không gợi ý và ví dụ chưa gặp. Đây là khảo sát ban đầu,
   chưa đủ để công bố engine hiệu quả hơn phương pháp khác.

Kiểm thử bắt buộc: Unicode và dấu tiếng Việt; đáp án tương đương; lần đầu so
với lần sửa; lộ đáp án xuyên mode; chống ghi trùng; lưu/mở lại; revision và xóa
nguồn; profile/collection tách biệt; lỗi/gián đoạn; và xác nhận trên collection
thử rằng luyện tập không thay đổi dữ liệu card, lịch ôn hoặc revlog.

## Điểm tích hợp hiện có

- `integration.py`: menu bộ thẻ là nơi mở luyện tập, adapter đọc note qua QueryOp.
- `reviewer_ui.py`: giữ trách nhiệm reviewer gốc và Focus; engine có controller,
  WebView và bridge riêng, không mở rộng bridge reviewer thành controller luyện.
- `focus_store.py`: tham khảo cách tách lưu trữ khỏi Qt; không dùng bảng Focus
  làm lịch sử trả lời vì hai mô hình dữ liệu có mục đích khác nhau.
- Đề xuất mô-đun: `learning_engine/` (model, grading, evidence, policy, store),
  `learning_ui.py` (adapter Anki), `assets/learning.*` và bộ kiểm thử riêng.
