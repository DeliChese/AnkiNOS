# AnkiNOS

Giao diện kính mờ cho màn hình danh sách bộ thẻ Anki, thống nhất từ ba ảnh tham chiếu. Nền hồ hoàng hôn xanh tím, thư mục pastel, thanh điều hướng gọn và bảng hồ sơ mở từ avatar. Thư viện mở thành popup; hoạt động và thanh bộ lọc có thể thu gọn.

## Sử dụng

Thư mục này đã nằm trong `Anki2/addons21/NOS`. Khởi động lại Anki, mở **Decks** để sử dụng. Trong **Tools → AnkiNOS — Giao diện kính**, bỏ chọn để trở về giao diện gốc. Add-on bổ sung giao diện cho dashboard, chuẩn bị học và lúc trả lời thẻ; giữ trình sửa thẻ, nội dung mẫu thẻ và thuật toán lên lịch của Anki.

- Nhấn avatar ở góc trên phải để mở hồ sơ; nhấn lại, nhấn ngoài bảng hoặc Escape để đóng.
- Nút **Bộ thẻ** (biểu tượng các lớp) trên sidebar mở bảng **Bộ thẻ & tài nguyên** dạng popup, giữ nguyên trang tổng quan phía sau. Bảng không còn nằm trên giao diện chính và không mở tab khác. Mũi tam giác nối về nút sidebar, chuyển xuống cạnh dưới khi dùng thanh điều hướng di động.
- **Trang chính** tập trung vào không gian nền cá nhân, điều hướng học và **heatmap**. Retention / Pace / Time / Studied chuyển sang mục **Thống kê** trên sidebar, thay cho mục Thông tin. Menu chức năng AnkiNOS không còn nút mở thống kê riêng.
- **Trang Thống kê AnkiNOS** dùng dữ liệu graph gốc do Anki tính (không mở popup hay chép ảnh giao diện Anki): Hôm nay, Dự báo, Lượt ôn, Thời gian ôn, Phân loại thẻ, Khoảng cách ôn, Độ dễ, các chỉ số FSRS (Stability / Difficulty / Retrievability), True Retention, phân bố giờ học, nút trả lời và lịch sử thêm thẻ. Heatmap chỉ ở trang chính, không lặp tại trang Thống kê.
- Nút **Lưu PDF** trong Thống kê xuất toàn bộ báo cáo AnkiNOS ở trang hiện tại, với CSS in A4, thay cho nút trong cửa sổ Anki mặc định.\n- Có thể lọc thống kê theo **bộ thẻ hiện tại/toàn bộ bộ sưu tập** và **12 tháng/tất cả lịch sử**. Số liệu được truy vấn không đồng bộ qua `QueryOp` từ `col._backend.graphs()` (cùng nguồn với thống kê gốc của Anki), kết quả được cache theo bộ lọc; nhấn **Làm mới báo cáo** để đọc lại. 
- Popup sử dụng chính bảng thư viện hiện có: tìm kiếm, lọc, dạng lưới/danh sách, tài nguyên, thêm/sửa/xóa và học. Đóng bằng **×**, **Escape** hoặc bấm nền ngoài; focus quay về nút mở. **Ctrl+K** mở popup và đưa focus vào ô tìm kiếm.
- Ở hàng deck cha, bấm **Xem … deck con** để mở nhánh. Mỗi dòng con có nút **Học** riêng; deck con còn có nhánh sâu hơn thì tiếp tục bấm **Xem deck con**. Màn hình chuẩn bị học của deck cha cũng có **Xem deck con**, đưa về đúng nhánh trong popup.
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

## Thư viện ảnh cá nhân

**Ảnh nền không bị cắt:** Ở Cài đặt → Thư viện ảnh, mỗi vị trí có chế độ **Vừa khung** (giữ trọn ảnh, có thể có khoảng trống) và **Phủ kín** (lấp đầy nhưng có thể cắt rìa), kèm căn trên/dưới/trái/phải/giữa. Mặc định 3 hình nền là **Vừa khung**, avatar là **Phủ kín**. Xem trước rồi nhấn **Áp dụng**. Ảnh đã lưu trước đây tiếp tục dùng được, không cần nhập lại.

Ảnh nhập **mới** được giữ nguyên file gốc, lưu kích thước/dung lượng và tạo ảnh xem trước PNG riêng tối đa 480 px. Hình nền luôn dùng file gốc. Ảnh cũ thiếu thumbnail sẽ dùng file gốc cho ảnh xem trước, không bị chỉnh sửa. Xóa một ảnh trong kho sẽ xóa cả bản sao lẫn thumbnail, không ảnh hưởng ảnh nguồn trên máy.


Mở **Cài đặt AnkiNOS → Thư viện ảnh → Thêm ảnh từ máy** để sao chép ảnh vào kho riêng của add-on. Hỗ trợ **PNG, JPG, WebP** (tối đa 16 MB, 24 megapixel/ảnh và 100 ảnh/hồ sơ). Không cần giữ ảnh gốc ở đường dẫn cũ sau khi nhập.

- Chọn độc lập ảnh nền cho **Dashboard**, **màn hình chuẩn bị học** và **màn hình ôn tập**, hoặc một ảnh **avatar** cho trang chủ/hồ sơ. Có thể chọn "mặc định" để bỏ hình riêng.
- Nhấn **Áp dụng** để lưu các lựa chọn theo hồ sơ Anki. Chưa áp dụng thì các thay đổi lựa chọn chưa được lưu.
- **Thêm ảnh** lưu vào kho ngay; **Xóa ảnh** xác nhận trước khi xóa bản sao trong kho. Nếu ảnh đang được chọn, add-on tự bỏ gán ở các vị trí tương ứng. Ảnh nguồn trên máy không bị xóa.
- Ảnh nằm trong `user_files/<mã hồ sơ>/` thuộc thư mục add-on, **không commit lên Git**, không đưa vào bộ thẻ hoặc đồng bộ qua AnkiWeb. Các bản cập nhật add-on thông thường giữ lại thư mục `user_files`; nếu chuyển sang máy khác thì phải sao lưu/chuyển thư mục đó. File JSON cấu hình **không** chứa dữ liệu ảnh và không thể tự khôi phục ảnh đã xóa.
- Add-on chỉ xuất bản các ảnh có ID nội bộ và đuôi định dạng hợp lệ qua Anki WebView; không mở URL hay tùy ý đọc file từ trình duyệt.

Kiểm tra kho ảnh mà không cần Anki: `python -m unittest discover -s tests -p 'test_media.py'`. Kiểm thử chọn ảnh và khả năng giữ thiết lập qua khởi động lại nên thực hiện thêm trên hồ sơ Anki riêng.

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

## Ý nghĩa thống kê

**Ghi nhớ:** tỷ lệ lượt trả lời Hard/Good/Easy trên tổng lượt ôn đến hạn (`revlog.type = 1`) trong 30 ngày học gần nhất. Đây là tỷ lệ trả lời đúng, không phải xác suất ghi nhớ do FSRS dự đoán. Không có lượt ôn đến hạn thì hiển thị `—`.

**Nhịp học:** số lượt ôn hôm nay chia cho tổng thời gian trả lời đã ghi trong revlog, quy đổi ra lượt/giờ. **Thời gian:** tổng thời gian trả lời trong revlog hôm nay. **Đã ôn:** số lần trả lời, không phải số thẻ khác nhau. Không tính bản ghi lên lịch thủ công. Biểu đồ nhỏ biểu diễn 14 ngày học gần nhất.

Mỗi chỉ số có phần trăm tăng/giảm tương đối: `(hiện tại − mốc trước) / mốc trước × 100`. Ghi nhớ so sánh hai khoảng 30 ngày liền kề; ba chỉ số hôm nay so sánh với **cùng giờ địa phương hôm qua** để tránh lấy một ngày chưa kết thúc so với cả ngày. Xanh biểu thị tăng, đỏ biểu thị giảm về mặt số học; không mặc định rằng học lâu hơn luôn tốt hơn. Khi mốc trước bằng 0 hoặc thiếu số liệu, không bịa phần trăm.

Biểu đồ được dựng từ dữ liệu từng ngày trong revlog, có đường chỉ vị trí và số liệu khi di chuột. Có thể chọn biểu đồ bằng Tab rồi dùng mũi tên trái/phải để xem từng ngày. Ngày không có mẫu ghi nhớ/nhịp học để trống thay vì giả định bằng 0. Dashboard làm mới sau thao tác collection, khi cửa sổ nhận focus và mỗi 5 phút khi đang hiển thị.

Ngày học theo giờ chuyển ngày của Anki, không mặc định đổi ngày lúc 0 giờ. Chuỗi học vẫn được giữ khi đã học hôm qua và chưa ôn lần nào hôm nay. Thẻ trong bộ lọc được tính vào bộ thẻ gốc khi hiển thị tổng số thẻ. Không tạo hạng, cấp độ hay mức tăng trưởng giả.

## Các tệp

- `__init__.py`, `integration.py`: hooks Anki, cầu nối WebView, các thao tác gốc và cấu hình.
- `data.py`: truy vấn chỉ đọc chạy trên luồng nền qua `QueryOp`.
- `ankios-ui.html`, `assets/dashboard.css`, `assets/dashboard.js`: giao diện không phụ thuộc CDN hoặc Tailwind.
- `ankios-overview.html`, `assets/overview.css`, `assets/overview.js`: màn hình chuẩn bị học bộ thẻ.
- `reviewer_ui.py`, `assets/reviewer*.css`, `assets/reviewer*.js`: giao diện phiên học và nút đánh giá; `ankios-review.html` là bản xem trước.
- `ankios-ui.original.html`: bản HTML ban đầu được giữ lại.
- `assets/sunset-lake.png`: nền cục bộ được tạo bằng công cụ imagegen tích hợp. Prompt cuối được lưu trong [assets/background-prompt.txt](assets/background-prompt.txt).
- `previews/`: ảnh xem trước. Mở `ankios-ui.html` ngoài Anki sẽ dùng dữ liệu minh họa có nhãn rõ ràng; phiên bản trong Anki chỉ dùng dữ liệu thật, kể cả khi cầu nối đang tải.

## Kiểm tra

Đã chạy kiểm tra dữ liệu trên collection dùng một lần; kiểm tra Chromium cho tìm kiếm, bộ lọc, dạng lưới, profile, thu gọn, biểu đồ và kích thước màn hình; kiểm tra Anki thật bằng profile riêng cho nạp add-on, pycmd, chọn bộ thẻ, trả lời thẻ, cập nhật thống kê, lưu cấu hình và trở về danh sách bộ thẻ gốc. Không mở hoặc thay đổi collection người dùng trong kiểm tra.

```powershell
# Chạy bằng Python đi kèm Anki, có package anki/aqt.
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/test_data.py
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/anki-smoke.py
node tests/ui-check.mjs
node tests/perf-check.mjs
& 'C:/Users/nguye/AppData/Local/Programs/Anki/.venv/Scripts/python.exe' tests/data-perf.py
```

Kiểm tra giao diện Chromium cần Chrome cục bộ và Node 22 trở lên; có thể đặt `NOS_CHROME` để đổi đường dẫn trình duyệt. Kiểm tra Anki có thể đặt `NOS_ANKI_PACKAGES` trỏ tới thư mục `app_packages` của bản Anki muốn kiểm tra. Dữ liệu thử chỉ được tạo dưới `tests/.tmp`.
