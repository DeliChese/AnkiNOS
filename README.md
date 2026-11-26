# AnkiNOS

## Bố cục dashboard

Chọn **Cực quang**, **Bento**, **Dock nổi**, **Không gian làm việc** hoặc **Zen** bằng nút **Đổi bố cục** trên thanh đầu trang. **Alt + Shift + L** chuyển sang bố cục kế tiếp. Trong **Cài đặt AnkiNOS → Giao diện**, nhấn **Áp dụng** để lưu lựa chọn.

Hồ sơ chưa chọn bố cục dùng **Cực quang**. Mỗi bố cục dùng được với mọi bộ màu và được lưu theo hồ sơ, cùng với cấu hình JSON và gói `.nosbackup`. Khi cửa sổ hẹp, điều hướng nằm ở thanh dưới.

## Theme và màu sắc

Vào **Cài đặt AnkiNOS → Giao diện** để chọn **NOS Glass, Tokyo, Mononoke, Catppuccin, Rosé Pine, Nord, Solarized hoặc Dracula**. Hệ thống tham khảo [Onigiri](https://github.com/thepeacemonk/Onigiri), được viết riêng và tinh chỉnh cho AnkiNOS.

- Chọn **Hoàng hôn / Kính tối / OLED / Sáng / Theo hệ thống**. Chế độ hệ thống tự đổi sáng/tối theo máy.
- Dùng màu **Theo theme**, sáu màu có sẵn hoặc màu tùy chỉnh. Màu chữ, nút và trạng thái được cân chỉnh độ tương phản; heatmap mặc định đi theo màu nhấn.
- Có mẫu xem trước ngay trong Cài đặt. Nhấn **Áp dụng** để lưu; đóng cửa sổ để bỏ thay đổi chưa áp dụng.
- Theme dùng chung cho dashboard, bộ thẻ, thống kê, Studio ảnh, thanh ôn tập và sổ tay/lệnh nhanh; lưu riêng từng hồ sơ và đi kèm JSON/gói sao lưu. Nội dung mẫu thẻ giữ cách trình bày riêng của thẻ.

Nguồn tham khảo, cấu trúc và kiểm thử: [THEME-NOTES.md](THEME-NOTES.md).

Dashboard Anki với giao diện kính, học nhanh, Focus, thư viện ảnh, lệnh nhanh và sổ tay.

Hệ thống học nhiều mode của NOS đã được gỡ. Học thẻ dùng reviewer và lịch ôn gốc của Anki; không còn gán trường hoặc thống kê học NOS. Tệp dữ liệu học cũ được giữ trên máy và vẫn có trong gói sao lưu, không được mở hay nâng cấp khi khởi động add-on.

## Lệnh nhanh và sổ tay

- **Ctrl+K** tìm bộ thẻ, tài nguyên, ghi chú hoặc lệnh Anki. **Ctrl+Shift+K** mở thư viện bộ thẻ trên dashboard.
- **Sổ tay** lưu ghi chú theo bộ thẻ/note, tìm không dấu và có thùng rác/khôi phục. Trong reviewer, nút **Ghi chú** mở sổ tay cho note đang học.
- Sổ tay lưu cục bộ trong `workspace.sqlite3` theo hồ sơ; tài nguyên bên ngoài chỉ lưu đường dẫn.

## Học nhanh, Focus và nhận xét học tập — 0.2.0

- **Tiếp tục học trên trang chủ**: chọn bộ thẻ trong cụm **Bước tiếp theo của bạn**, bấm **Học ngay** để vào reviewer qua luồng chuẩn của Anki. AnkiNOS nhớ bộ đã học gần nhất; khi bộ đó chưa có thẻ sẵn sàng, gợi ý bộ có lịch học. Danh sách nhanh giới hạn 12 lựa chọn để thư viện lớn không làm chậm trang; **Chọn bộ thẻ khác** mở thư viện đầy đủ.
- **Quỹ thời gian 15 / 30 / 60 phút**: bấm **Focus … phút** để chọn bộ thẻ, dựng hàng đợi bằng Anki và bắt đầu Focus trong một thao tác. Khi đủ giờ, hiện tổng kết thời gian tập trung và số lượt trả lời; người dùng quyết định nghỉ hoặc học tiếp. Không tự thay đổi lịch FSRS, giới hạn ngày, thứ tự thẻ hay đánh giá đáp án. Nếu hàng đợi đã hết trong lúc điều hướng, Anki hiển thị trạng thái hoàn thành của nó.
- **Ước lượng có nguồn**: từ các lượt trả lời thật trong 30 ngày học Anki, loại bản ghi thủ công và thời gian thiếu/ngoài 1–120 giây. Cần ít nhất 20 mẫu có thời gian; dùng phân vị 25/50/75% theo loại lượt khi đủ mẫu, nếu thiếu dùng mẫu chung của collection. Khoảng phút quy đổi từ thời gian từng lượt và số lượt hiện có; đây không phải khoảng tin cậy của toàn phiên. Thẻ mới/học lại có thể xuất hiện nhiều lần, âm thanh và thời gian nghỉ có thể làm phiên kéo dài. Không đủ mẫu thì ghi rõ, vẫn cho bắt đầu Focus.
- **Thống kê → Điều đáng chú ý**: so sánh tỷ lệ trả lời đúng của lượt ôn đến hạn trong hai khoảng 30 ngày liền kề. Chỉ nhắc mức giảm từ 5 điểm phần trăm khi mỗi khoảng có ít nhất 20 lượt. Một nhận xét khác phát hiện thẻ được trả lời **Quên ít nhất 3 lần** trong 30 ngày (ôn đến hạn/học lại). Hiển thị số mẫu, nguồn, mốc ngày và không kết luận nguyên nhân. Nút **Xem các thẻ liên quan** mở đúng ID thẻ trong Browse, không chỉnh sửa thẻ. Bộ con tính về đúng nhánh cha, thẻ lọc tính về bộ gốc; tránh lặp nhận xét của cả cha và con.
- **Dễ đọc trong cửa sổ nhỏ**: thanh reviewer có nền đủ tương phản độc lập với ảnh nền và CSS mẫu thẻ. Các điều khiển Focus tự xuống hàng, thông tin quan trọng có chữ lớn hơn, focus bàn phím dễ nhận biết. Có kiểm tra bố cục ở độ rộng 320–1024 px. Mẫu thẻ và nút đánh giá gốc vẫn được giữ.

## Sao lưu đầy đủ và quay về Anki gốc

Vào **Cài đặt AnkiNOS → Dữ liệu → Tạo gói sao lưu** để xuất `.nosbackup` gồm cấu hình của hồ sơ hiện tại, ảnh gốc, thumbnail, ảnh nền tối ưu và bản chụp SQLite nhất quán của Focus, sổ tay, liên kết tài nguyên, ánh xạ trường và lịch sử luyện tập. Gói có bản kê phiên bản và SHA-256 từng tệp. Đây là dữ liệu add-on; thẻ và lịch sử ôn của collection vẫn dùng chức năng sao lưu của Anki. Tài nguyên gắn ngoài add-on chỉ lưu tham chiếu, cần gắn lại nếu đường dẫn đổi trên máy khác.

**Chọn gói khôi phục…** kiểm tra toàn vẹn, đường dẫn, loại tệp, dung lượng và cấu trúc SQLite trước khi hiện hộp xem trước: hồ sơ nguồn/đích, ngày tạo, ảnh, album, phiên Focus, ghi chú và phiên/lượt luyện. Chỉ sau khi xác nhận mới thay thế dữ liệu. Mỗi lần khôi phục tạo một gói của trạng thái trước đó tại `user_files/backups/before-restore-….nosbackup`; có thể chọn gói này để quay lại. Nếu thao tác ghi thất bại, thư mục và cấu hình cũ được phục hồi. Các bản dự phòng được giữ lại, không tự xóa. Gói giới hạn 2 GB, mỗi ảnh 16 MB, SQLite Focus 64 MB, mỗi SQLite sổ tay/luyện tập 256 MB; audio BrainExer tối đa 4 MB mỗi tệp. Gói hiện tại dùng phiên bản v4 khi có BrainExer và vẫn đọc v1–v3. Không nhận phiên bản gói mới hơn mà mã hiện tại chưa hỗ trợ.

Khi chuyển sang collection khác, dấu sao/màu và bộ học gần nhất được đối chiếu bằng **tên đầy đủ** của bộ thẻ; mục không khớp được bỏ qua thay vì gắn vào ID trùng nhưng khác nội dung. Gói chỉ áp dụng vào hồ sơ đang chọn, không ảnh hưởng hồ sơ khác và không tự tải lên AnkiWeb. **Xuất/Nhập JSON** cũ vẫn chỉ phục vụ tùy chỉnh giao diện; không thay thế gói sao lưu đầy đủ.

Trong **Cài đặt AnkiNOS → Dữ liệu** có các chức năng sao lưu, khôi phục và **Dùng giao diện Anki gốc**. Nếu dựng giao diện Python hoặc khởi tạo JavaScript chính bị lỗi, add-on trả về giao diện gốc và khôi phục các thanh chức năng. Có thể bật lại bằng cấu hình add-on (`enabled: true`) rồi khởi động lại Anki. Khôi phục khi đang ôn sẽ kết thúc phiên Focus sau bước xác nhận. Menu Tools không thêm mục AnkiNOS; mở Sổ tay từ thanh bên hoặc menu bộ thẻ, mở Lệnh nhanh bằng **Ctrl+K**.

## Sử dụng

Đặt thư mục add-on trong `Anki2/addons21/` (bản làm việc hiện tại có tên `AnkiNOS`). Khởi động lại Anki, mở **Decks** để sử dụng. Trong **Cài đặt AnkiNOS → Dữ liệu**, chọn **Dùng giao diện Anki gốc** để trở về giao diện gốc. Add-on bổ sung giao diện cho dashboard, chuẩn bị học và lúc trả lời thẻ; giữ trình sửa thẻ, nội dung mẫu thẻ và thuật toán lên lịch của Anki.

- Nhấn avatar ở góc trên phải để mở hồ sơ; nhấn lại, nhấn ngoài bảng hoặc Escape để đóng.
- Nút **Bộ thẻ** (biểu tượng các lớp) trên sidebar mở bảng **Bộ thẻ & tài nguyên** dạng popup, giữ nguyên trang tổng quan phía sau. Bảng không còn nằm trên giao diện chính và không mở tab khác. Mũi tam giác nối về nút sidebar, chuyển xuống cạnh dưới khi dùng thanh điều hướng di động.
- **Trang chính** gồm không gian nền cá nhân, cụm học nhanh và **heatmap**. Retention / Pace / Time / Studied nằm trong **Thống kê** trên sidebar. Menu chức năng AnkiNOS không còn nút mở thống kê riêng.
- **Trang Thống kê AnkiNOS** dùng dữ liệu graph gốc do Anki tính (không mở popup hay chép ảnh giao diện Anki): Hôm nay, Dự báo, Lượt ôn, Thời gian ôn, Phân loại thẻ, Khoảng cách ôn, Độ dễ, các chỉ số FSRS (Stability / Difficulty / Retrievability), True Retention, phân bố giờ học, nút trả lời và lịch sử thêm thẻ. Heatmap chỉ ở trang chính, không lặp tại trang Thống kê.
- Nút **Lưu PDF** trong Thống kê xuất toàn bộ báo cáo AnkiNOS ở trang hiện tại, với CSS in A4, thay cho nút trong cửa sổ Anki mặc định.\n- Có thể lọc thống kê theo **bộ thẻ hiện tại/toàn bộ bộ sưu tập** và **12 tháng/tất cả lịch sử**. Số liệu được truy vấn không đồng bộ qua `QueryOp` từ `col._backend.graphs()` (cùng nguồn với thống kê gốc của Anki), kết quả được cache theo bộ lọc; nhấn **Làm mới báo cáo** để đọc lại. 
- Popup sử dụng chính bảng thư viện hiện có: tìm kiếm, lọc, dạng lưới/danh sách, tài nguyên, thêm/sửa/xóa và học. Đóng bằng **×**, **Escape** hoặc bấm nền ngoài; focus quay về nút mở. **Ctrl+Shift+K** mở popup và đưa focus vào ô tìm kiếm; **Ctrl+K** mở lệnh nhanh.
- Ở hàng deck cha, bấm **Xem … deck con** để mở nhánh. Mỗi dòng con có nút **Học** riêng; deck con còn có nhánh sâu hơn thì tiếp tục bấm **Xem deck con**. Màn hình chuẩn bị học của deck cha cũng có **Xem deck con**, đưa về đúng nhánh trong popup.
- Trong **Thêm → Bộ thẻ mới**, chọn **Bộ thẻ cha** để tạo deck con; chọn **Không có** để tạo deck cấp cao nhất. Menu từng deck có **Tạo deck con…** chọn sẵn deck cha, hỗ trợ cả nhánh nhiều cấp. Heatmap dashboard được thu gọn với ô vuông; mục **Bộ thẻ** được bỏ khỏi menu 6 chấm, vẫn mở thư viện từ sidebar.
- Thêm, xóa, đổi tên deck và lưu chỉnh sửa thẻ cập nhật dữ liệu ngay trên trang đang mở, kể cả khi cửa sổ Thêm thẻ hoặc Duyệt thẻ đang có focus. Thư viện giữ nguyên bộ lọc và các nhánh đang mở. Hộp tạo deck giữ mở sau khi **Tạo** thành công, báo đã lưu và cho phép tạo tiếp; dùng **Đóng** khi hoàn tất.
- Heatmap dùng lịch dương với đúng thứ, số ngày trong tháng và năm nhuận. Chọn trực tiếp tháng/năm; hai mũi tên chuyển theo chế độ **Năm / Tháng / Tuần**, nút **Hôm nay** quay về ngày học hiện tại. Bấm tên tháng trong lịch năm để mở tháng đó. Lịch sử ôn lấy từ Anki, bao gồm cả hai năm khi một tuần vắt qua giao thừa.
- Danh sách năm Heatmap giới hạn từ **2006** (năm Anki ra mắt) đến năm hiện tại. Thư viện ảnh chuẩn bị giao diện khi rảnh và giữ lại ảnh đã tải cho lần mở tiếp theo; ảnh cũ thiếu bản xem trước được tạo bản nhỏ ở luồng nền, không giải mã hàng loạt ảnh gốc khi mở.
- Hai thanh nút mặc định trên/dưới của Anki được ẩn hoàn toàn trong dashboard, không để lại khoảng trống. Chúng được khôi phục khi vào học hoặc tắt AnkiNOS. Các lệnh duyệt/thêm/đồng bộ/tiện ích nằm trong menu chín chấm; Cài đặt chỉ còn trên thanh điều hướng.
- Nút bốn góc ở đầu trang bật/tắt chế độ toàn màn hình gốc của Anki. Dashboard phủ toàn bộ WebView, không giới hạn chiều rộng trên màn hình lớn.
- Nhấn mũi tên tại tiêu đề hoạt động để thu gọn. Thư viện bỏ nút thu gọn lên/xuống thừa, dùng **×** để đóng popup. Nút cạnh ô tìm kiếm ẩn/hiện bộ lọc. Mũi tên ở từng deck cha vẫn mở/đóng nhánh con.
- Tìm kiếm hỗ trợ tiếng Việt không dấu.
- Nhấn **Học** mở tổng quan học gốc của Anki với đúng bộ thẻ. Các số xanh dương, hồng, xanh lá lần lượt là thẻ mới, đang học, cần ôn; số lượng tuân theo giới hạn của scheduler.
- Menu `…` của bộ thẻ mở duyệt thẻ, đổi tên, tùy chọn, xuất, gắn sao, chọn màu và xóa. Nút thùng rác cũng có ở từng hàng. Trước khi xóa, hộp xác nhận nêu số bộ con và thẻ; thao tác hỗ trợ Hoàn tác của Anki. Xóa bộ lọc trả thẻ về bộ gốc.
- Cây bộ thẻ được dựng theo tên đầy đủ `Cha::Con`, hiển thị con bên trong đúng cha và sắp xếp số tự nhiên (1, 2, 10) trong từng nhánh. Những tên con giống nhau ở nhánh khác không bị trộn. Chỉ dựng DOM của nhánh đang mở để thư viện lớn nhẹ hơn.
- **Thêm** cho phép tạo bộ thẻ, thêm thẻ, gắn file tài nguyên hoặc thêm liên kết. Gắn file chỉ lưu đường dẫn; không sao chép file vào collection.media. Nếu di chuyển file, hãy gỡ tham chiếu cũ rồi gắn lại. Gỡ tài nguyên không xóa file gốc.
- Nhấn mục tiêu ngày để đổi số lượt ôn mong muốn. Màu, dấu sao, mục tiêu, tài nguyên và tùy chọn thu gọn lưu riêng theo tên profile trong cấu hình add-on. Các thiết lập và đường dẫn tài nguyên này không đồng bộ qua AnkiWeb.
- Chế độ Năm/Tháng/Tuần hiển thị cùng lịch sử ôn thật. Tháng/Tuần theo thời điểm hiện tại trong năm đang chọn. Các năm có dữ liệu có thể chọn bằng mũi tên.

## Focus Mode — phiên tập trung và lịch sử

Trong màn hình ôn tập, chọn 5/15/25/30/45/60/90 phút rồi nhấn **Focus**. Bộ đếm ngược có **Tạm dừng**, **Tiếp tục** và **Kết thúc**. Chế độ tự kết thúc khi đủ thời lượng, tự tạm dừng khi cửa sổ Anki mất focus và kết thúc khi rời màn hình ôn tập. Cơ chế chấm điểm, nút trả lời và lịch FSRS vẫn do Anki quản lý.

Vào **Thống kê → Focus Mode** để xem thời gian hôm nay, 7 ngày, tổng thời gian, số phiên, số phiên đạt mục tiêu, thời lượng trung bình, tổng lượt ôn trong Focus, biểu đồ 14 ngày và 40 phiên gần nhất. Thời gian nghỉ không được tính. Lịch sử là dữ liệu ghi từ lúc sử dụng tính năng, không suy diễn ngược từ revlog.

Dữ liệu lưu trong SQLite tại `user_files/<mã profile>/focus.sqlite3`, riêng theo profile, **không đồng bộ AnkiWeb**; hãy sao lưu `user_files` khi đổi máy. Phiên đang chạy được checkpoint mỗi 10 giây. Khi Anki đóng bất thường, thời gian đã checkpoint được giữ lại dưới trạng thái “Gián đoạn”, phần thời gian sau checkpoint không được đoán thêm. Dữ liệu được giới hạn 2.000 phiên gần nhất để tránh tăng dung lượng vô hạn.

Kiểm tra mô-đun lưu trữ không cần cài Anki: `python -m unittest discover -s tests -p 'test_focus.py'`. Cần kiểm tra giao diện và vòng đời Focus trong Anki thực tế trên profile thử trước khi phát hành.

## Media Studio — album ảnh trong AnkiNOS

Mở **menu 6 chấm → Thư viện ảnh** để quản lý kho ảnh riêng của từng hồ sơ Anki. Không còn mục chỉnh ảnh trong Settings hay nút **Áp dụng**.

- **Nhập ảnh từ máy**: PNG/JPG/WebP; giới hạn 16 MB, 24 megapixel mỗi ảnh và 100 ảnh mỗi hồ sơ. Ảnh gốc được sao chép nguyên vẹn vào `user_files/<mã hồ sơ>/` của add-on, ảnh mới có thumbnail PNG nhỏ để thư viện hoạt động mượt.
- **Album**: tạo album, đổi tên, xóa album, chuyển ảnh vào album. Xóa một album **không xóa ảnh** — ảnh được chuyển vào “Chưa phân loại”. Lọc ảnh theo album, tìm kiếm theo tên.
- **Đổi tên**: chọn ảnh, thay tên tại bảng bên phải → **Lưu tên**. Không đổi tên file ảnh gốc nên không làm mất liên kết. **Xóa ảnh** vẫn yêu cầu xác nhận và chỉ xóa bản sao trong add-on.
- **Xem trước ngay**: chọn ảnh trong lưới, ảnh đầy đủ hiển thị tại bảng xem trước nhỏ bên phải. Bấm **Dashboard**, **Chuẩn bị học**, **Lúc ôn tập** hoặc **Avatar** để lưu ảnh cho từng nơi tức thì; nhấn lại mục đang bật để trả về nền mặc định. **Không có nút Áp dụng.**
- **Cách hiển thị nền**: chọn **Lấp đầy** (`cover`) hoặc **Vừa khung** (`contain`), chỉnh **Độ tối** và **Độ mờ** trong Studio; thay đổi được lưu ngay. Lấp đầy giữ tỷ lệ và có thể cắt rìa; Vừa khung giữ toàn ảnh và có khoảng trống nếu khác tỷ lệ cửa sổ. Avatar dùng khung bo góc.
- **Ảnh gốc và ảnh nền nhẹ**: ảnh gốc giữ nguyên; nền dùng bản JPEG có cạnh dài tối đa 2048 px để giảm tải giải mã. Ảnh cũ vẫn còn và được tạo bản nền nhẹ khi cần.
- **Dữ liệu cục bộ**: file ảnh không chứa trong config.json hay bộ thẻ Anki, không sync AnkiWeb. Sao lưu `user_files` khi chuyển máy. Update add-on bình thường giữ lại `user_files`.

Kiểm tra cơ bản: `python -m unittest discover -s tests -p 'test_media.py'`, `node tests/ui-check.mjs`. Kiểm tra thực tế trong Anki trên hồ sơ thử trước khi phân phối rộng.

## Màn hình chuẩn bị học

Khi chọn một bộ thẻ, AnkiNOS hiển thị tên và mô tả, ba ô Mới / Đang học / Cần ôn, nút **Học ngay** và bảng **Hôm nay của bạn**. Số liệu của bảng bên phải chỉ gồm bộ thẻ đang chọn và các bộ con. Mô tả dài có thể mở rộng/thu gọn; nội dung mô tả hiển thị dạng văn bản để không chạy mã HTML từ bộ thẻ nhập vào.

Heatmap của màn hình chuẩn bị học được bỏ, kể cả heatmap do Review Heatmap chèn vào bảng gốc. Heatmap trên dashboard và cửa sổ thống kê vẫn giữ nguyên. Hai thanh chức năng mặc định trên/dưới tiếp tục ẩn ở bước chuẩn bị; **Tùy chọn**, **Học tùy biến**, **Mô tả**, **Duyệt thẻ** và các chức năng phụ nằm trong menu chín chấm góc trên phải. Bộ thẻ lọc có thêm **Tạo lại** và **Làm trống**, thẻ bị chôn có **Bỏ chôn** khi thích hợp.

**Học ngay** gọi luồng học gốc của Anki. Số thẻ và nút bắt đầu có sẵn cùng HTML, không chờ truy vấn thống kê phụ. Khi hết thẻ, màn hình hoàn thành gốc vẫn có các nút điều hướng của nó.

Bản xem trước riêng: mở `ankios-overview.html`; giao diện trong Anki được nạp tự động, không cần mở HTML thủ công.

## Trong lúc học

Nền và thanh đầu phiên học đồng bộ AnkiNOS, có nút về bộ thẻ, tên bộ thẻ, số lượt ôn trong phiên và menu thẻ. Nội dung thẻ vẫn nằm trong `#qa` gốc, không viết lại mặt trước/mặt sau. Phông, màu nền và ảnh nền từ CSS của mẫu thẻ được giữ trong khung nội dung.

Các nút **Quên / Khó / Tốt / Dễ** vẫn do Anki tạo, được trình bày bằng bốn màu khác nhau và có nhãn phím tắt theo cấu hình thực tế. Thời gian hẹn ôn, nút hiện đáp án, nhập câu trả lời, âm thanh và hành động đánh giá vẫn đi qua luồng gốc. Thanh dưới có chiều cao ổn định. Bỏ animation toàn khung thẻ, hiệu ứng xuất hiện nút đánh giá và fade gốc khi NOS đang bật để đáp án xuất hiện ngay khi Anki dựng xong. Hiệu ứng hover của nút vẫn giữ.

Bản xem trước: `ankios-review.html`. Mọi thời gian hẹn ôn trong bản xem trước là minh họa; trong Anki dùng kết quả scheduler thật.

## Tối ưu chuyển vào học

- Review Heatmap cũ được bỏ qua trước cả bước truy vấn/dựng HTML ở các view đã được NOS thay thế. Heatmap trong cửa sổ thống kê và khi tắt NOS vẫn gọi plugin như cũ; không sửa file hay cấu hình plugin khác.
- Cache cấu hình và mẫu HTML trong phiên, dừng làm mới nền khi bắt đầu điều hướng, nạp thống kê phụ sau khi nút Học đã dùng được.
- Giảm blur kính và dựng cây thư viện theo các nhánh đang mở. Không tạo lại heatmap khi chỉ thay đổi dấu sao, màu hoặc giao diện.
- Cache cây đã lọc và DOM thư viện khi dữ liệu không đổi; mở/đóng lại popup không dựng lại bảng. Mở một nhánh chỉ thay DOM nhánh đó. Các hàng ngoài vùng nhìn dùng `content-visibility` để giảm layout/paint; vẫn giữ đầy đủ bộ thẻ để tìm và học.
- Tính vị trí popup trước khi hiển thị; bỏ blur nền trên riêng bảng lớn, dùng lớp màu kính để giảm tải đồ họa. Giữ vùng scrollbar ổn định để tránh xê dịch bố cục khi mở popup.
- Không theo dõi toàn bộ cây DOM bên trong thẻ khi MathJax hoặc script mẫu thẻ cập nhật; gộp đọc màu nền theo khung hình và chỉ ghi CSS khi giá trị thay đổi. Tái sử dụng bộ định dạng ngày/số và biểu đồ không đổi.
- Bỏ thời gian chờ khởi động 300 ms và chặn yêu cầu tải trong 2 giây. Yêu cầu của màn hình mới luôn được xử lý; các yêu cầu trùng của cùng màn hình được gộp khi đang chạy. Truy vấn chờ của trang đã rời đi được bỏ qua, kết quả cũ không ghi đè trang mới.
- Tái sử dụng cây scheduler Anki đã tính, không tính lần thứ hai và không dựng bảng HTML gốc đã bị NOS thay thế. Khi tắt NOS, renderer gốc hoạt động lại.
- Cache tổng hợp theo đúng đối tượng collection, lần thay đổi dữ liệu và giờ chuyển ngày; kiểm tra cả bộ đếm ghi SQLite. Cập nhật sau thao tác, Undo, nhập dữ liệu và đồng bộ; không chia sẻ cache giữa các profile. Nút **Làm mới** buộc đọc lại dữ liệu khi cần.
- Heatmap hiện khung lịch ngay lúc mở trang. Lần đầu chỉ đọc năm hiện tại và tối thiểu 60 ngày dùng cho so sánh; năm cũ được đọc bằng truy vấn có giới hạn thời gian khi chuyển năm, rồi giữ trong bộ nhớ. Không xóa hoặc giới hạn lịch sử ở hai năm. Chuỗi học dài được kiểm tra qua chỉ mục lịch sử nên vẫn tính cả những năm chưa mở.
- Sau khi trả lời, chỉ tổng hợp lại ngày thay đổi và ghi nhớ 30 ngày; không quét toàn bộ lịch sử mỗi lần quay về dashboard. Với 20.000 thẻ / 600.000 lượt ôn giả, đo được khoảng 107 ms tải đầu, 1 ms làm mới dữ liệu không đổi và 12 ms sau khi ôn. Số đo chi tiết ở `previews/data-performance-after.json`; trước tối ưu ở `previews/data-performance-before.json`.
- Đo Chromium với 12.300 deck giả (300 cha × 40 con): trước tối ưu khoảng 389 ms mở popup lần đầu, 191 ms mở lại, 320 ms mở nhánh. Kết quả sau tối ưu nằm tại `previews/performance-after.json`; kiểm tra Anki thật nằm tại `previews/anki-report.json`. Đây là số đo dữ liệu thử, phụ thuộc máy, collection và add-on khác; không cam kết mọi thao tác đều tức thì.

### Giảm giật khi đổi tab (đợt tối ưu mới)

- Thống kê giữ nguyên DOM/SVG khi trở lại cùng bộ lọc. Truy vấn lần đầu vẫn lấy dữ liệu thật từ Anki trong luồng nền; đồ thị gốc được dựng theo từng nhóm nhỏ qua `requestAnimationFrame`, tránh một lần xử lý dài trên WebView. Nút **Làm mới báo cáo** vẫn đọc lại kết quả.
- Thư viện bộ thẻ không dựng lại cây DOM khi bảng đang đóng và chỉ cập nhật khi mở nếu dữ liệu/bộ lọc đã thay đổi. Heatmap dùng bộ đếm phiên bản thay vì `JSON.stringify` toàn bộ lịch sử từng lần.
- Studio giữ các phần tử thumbnail, ảnh đã giải mã và chỉ thay trạng thái chọn. Bảng xem trước dùng thumbnail khi có (không giải mã bản gốc 24 megapixel để hiện trong ô xem nhỏ).
- Giảm `backdrop-filter` trên các panel lớn, giữ hiệu ứng kính nhẹ trên thanh điều hướng và dùng `content-visibility` cho các biểu đồ/thumbnail chưa thấy. Khi xuất PDF thống kê, mọi biểu đồ được hiện đầy đủ.
- Cập nhật Settings được gộp theo khung hình; khi đổi cửa sổ Anki, chỉ đọc lại collection nếu đã quá 90 giây từ bản cập nhật gần nhất. Màn hình chuẩn bị học không truy vấn trùng; cập nhật nền tối đa khoảng 3 phút khi không học.
- `tests/ui-check.mjs` kiểm tra tái sử dụng DOM của Thống kê, Thư viện và Studio, đồng thời in thời gian 12 lượt đổi trang Thống kê trong Chromium. Kết quả đó chỉ là bài thử trình duyệt, không đại diện cho FPS thực tế của Anki/Qt trên mọi máy.

## Ý nghĩa thống kê

**Ghi nhớ:** tỷ lệ lượt trả lời Hard/Good/Easy trên tổng lượt ôn đến hạn (`revlog.type = 1`) trong 30 ngày học gần nhất. Đây là tỷ lệ trả lời đúng, không phải xác suất ghi nhớ do FSRS dự đoán. Không có lượt ôn đến hạn thì hiển thị `—`.

**Nhịp học:** số lượt ôn hôm nay chia cho tổng thời gian trả lời đã ghi trong revlog, quy đổi ra lượt/giờ. **Thời gian:** tổng thời gian trả lời trong revlog hôm nay. **Đã ôn:** số lần trả lời, không phải số thẻ khác nhau. Không tính bản ghi lên lịch thủ công. Biểu đồ nhỏ biểu diễn 14 ngày học gần nhất.

Mỗi chỉ số có phần trăm tăng/giảm tương đối: `(hiện tại − mốc trước) / mốc trước × 100`. Ghi nhớ so sánh hai khoảng 30 ngày liền kề; ba chỉ số hôm nay so sánh với **cùng giờ địa phương hôm qua** để tránh lấy một ngày chưa kết thúc so với cả ngày. Xanh biểu thị tăng, đỏ biểu thị giảm về mặt số học; không mặc định rằng học lâu hơn luôn tốt hơn. Khi mốc trước bằng 0 hoặc thiếu số liệu, không bịa phần trăm.

Biểu đồ được dựng từ dữ liệu từng ngày trong revlog, có đường chỉ vị trí và số liệu khi di chuột. Có thể chọn biểu đồ bằng Tab rồi dùng mũi tên trái/phải để xem từng ngày. Ngày không có mẫu ghi nhớ/nhịp học để trống thay vì giả định bằng 0. Dashboard làm mới sau thao tác collection, khi cửa sổ nhận focus và mỗi 5 phút khi đang hiển thị.

Ngày học theo giờ chuyển ngày của Anki, không mặc định đổi ngày lúc 0 giờ. Chuỗi học vẫn được giữ khi đã học hôm qua và chưa ôn lần nào hôm nay. Thẻ trong bộ lọc được tính vào bộ thẻ gốc khi hiển thị tổng số thẻ. Không tạo hạng, cấp độ hay mức tăng trưởng giả.

## Các tệp

- `__init__.py`, `integration.py`: hooks Anki, cầu nối WebView, các thao tác gốc và cấu hình.
- `data.py`: truy vấn chỉ đọc chạy trên luồng nền qua `QueryOp`.
- `study_data.py`, `assets/study-dashboard.*`: lối vào học nhanh, ước lượng thời gian và nhận xét có hành động.
- `backup_store.py`: bản kê, kiểm tra gói dữ liệu, sao lưu trước khôi phục và quay lại dữ liệu cũ khi lỗi ghi.
- `study_tools_ui.py`, `study_tools_data.py`: lệnh nhanh, sổ tay và cửa sổ lịch sử chỉ đọc.
- `workspace_store.py`: ghi chú theo collection/bộ thẻ/note, thùng rác và liên kết tài nguyên.
- `ankios-tools.html`, `assets/tools.css`, `assets/tools.js`, `assets/commands.js`, `assets/notebook.js`: công cụ và bản xem trước bằng `?tool=palette`, `?tool=workspace` hoặc `?tool=workspace` (lịch sử).
- `ankios-ui.html`, `assets/dashboard.css`, `assets/dashboard.js`: giao diện không phụ thuộc CDN hoặc Tailwind.
- `ankios-overview.html`, `assets/overview.css`, `assets/overview.js`: màn hình chuẩn bị học bộ thẻ.
- `reviewer_ui.py`, `assets/reviewer*.css`, `assets/reviewer*.js`: giao diện phiên học và nút đánh giá; `ankios-review.html` là bản xem trước.
- `ankios-ui.original.html`: bản HTML ban đầu được giữ lại.
- `assets/sunset-lake.png`: nền cục bộ được tạo bằng công cụ imagegen tích hợp. Prompt cuối được lưu trong [assets/background-prompt.txt](assets/background-prompt.txt).
- `previews/`: ảnh xem trước. Mở `ankios-ui.html` ngoài Anki sẽ dùng dữ liệu minh họa có nhãn rõ ràng; phiên bản trong Anki chỉ dùng dữ liệu thật, kể cả khi cầu nối đang tải.

## Kiểm tra


```powershell
# Chạy bằng Python đi kèm Anki, có package anki/aqt.
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/run-unit.py
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/test_data.py
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/anki-smoke.py
node tests/ui-check.mjs
node tests/tools-ui.mjs
node tests/perf-check.mjs
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/data-perf.py
```

Kiểm tra giao diện Chromium cần Chrome cục bộ và Node 22 trở lên; có thể đặt `NOS_CHROME` để đổi đường dẫn trình duyệt. Kiểm tra Anki có thể đặt `NOS_ANKI_PACKAGES` trỏ tới thư mục `app_packages` của bản Anki muốn kiểm tra. Dữ liệu thử chỉ được tạo dưới `tests/.tmp`.
