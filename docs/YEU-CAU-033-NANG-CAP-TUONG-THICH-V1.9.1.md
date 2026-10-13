# YC-033 – Bản mã nguồn V1.9.1 (CHỐT phạm vi tương thích và đồng bộ đa thiết bị)

**Ngày chuẩn bị:** 13/10/2026. **Baseline:** V1.9.0. **Nghiệp vụ nền:** V1.8.0.

## 1. Phạm vi thực hiện

Bản V1.9.1 chỉ nâng cấp tương thích/trải nghiệm đa thiết bị theo **YC-033**, không tự triển khai các tính năng nghiệp vụ còn chờ theo YC-027, YC-028, YC-029, YC-030, YC-031 và YC-032. YC-030 được duyệt phương án C ở mức nghiệp vụ, nhưng **chưa được triển khai trong gói này**. Các luồng nghiệp vụ cũ giữ nguyên để tránh tác động dữ liệu thật.

Đã thay đổi đầy đủ các tệp:

- `public/app.js`: có dự phòng khi trình duyệt cũ thiếu `replaceChildren`, `<dialog>.showModal`, `BroadcastChannel`; đồng bộ giữa tab cũ dựa trên **revision** và xác nhận lại từ backend, không ghi nội dung nhiệm vụ vào localStorage; đăng ký Service Worker kể cả khi `load` đã xảy ra; chẩn đoán iOS cũ không hỗ trợ Push; xử lý OneSignal khởi tạo lỗi với cơ chế thử lại giới hạn; tránh tải SDK chỉ để đăng xuất.
- `public/styles.css`: thêm `vh` trước `dvh` để hỗ trợ viewport cũ; định dạng dự phòng cho hộp thoại trên Safari cũ.
- `public/index.html`: cập nhật phiên bản hiển thị và query version cho JS/CSS từ 1.9.0 lên 1.9.1, giảm nguy cơ dùng cache asset lệch phiên bản.
- `package.json`: số phiên bản 1.9.1.
- `tests/yc033-compatibility.test.js`: thêm 11 bài kiểm thử tương thích/hồi quy.
- Tài liệu này.

**Không chỉnh sửa:** Google Apps Script, Google Sheets, State, các API Vercel, OneSignal Worker, Chrome Extension, phân quyền hoặc thiết lập cấu hình production.

## 2. Kết quả kiểm thử đã thực hiện

- `npm run check`: đạt kiểm tra cú pháp tất cả file trong script kiểm tra.
- `npm test`: **110/110 bài đạt**, gồm 99 bài gốc và 11 bài mới.
- Chromium headless với dữ liệu giả lập: **1440×900 (desktop), 412×915 (Android-size), 390×844 (iPhone-size), 320×640 (điện thoại nhỏ)**: đăng nhập mô phỏng, xem danh sách, điều hướng mobile, kiểm tra tràn ngang đạt. Với viewport 320×640 đã vô hiệu hóa giả lập `<dialog>.showModal` và `BroadcastChannel` để kiểm tra dự phòng; thao tác mở menu, mở/xóa hủy hộp thoại đạt.
- Kiểm thử Chromium **không phải** kiểm thử chạy trên iOS Safari/Android thật. Không có kết nối đến Google Sign-In, OneSignal, Apps Script production hoặc tài khoản thật trong các bài mô phỏng.

## 3. Những giới hạn chưa được nghiệm thu

1. Chưa kiểm thử trực tiếp trên iPhone/iPad Safari nhiều phiên bản, Android trình duyệt cũ, macOS Safari, Windows Chrome/Edge ngoài môi trường mô phỏng.
2. Chưa xác nhận lỗi OneSignal 15 giây trên thiết bị thực tế đã hết. Nếu CDN, mạng, quyền thông báo, thiết lập Service Worker hoặc cấu hình OneSignal không hợp lệ, thiết bị vẫn có thể không nhận Push.
3. **iOS/iPadOS dưới 16.4 không hỗ trợ Web Push nền của web app được thêm vào Màn hình chính**. Việc sửa code không thể bổ sung tính năng này ở cấp hệ điều hành.
4. Chưa chạy kiểm thử tải **140 tài khoản/thiết bị thật** và nhiều sự kiện OneSignal đồng thời; không được khẳng định đã bảo đảm Push đến đúng phút cho 140 người.
5. Một số phiên bản trình duyệt quá cũ không hỗ trợ cú pháp JavaScript hiện đại hoặc Google Sign-In; phiên bản thấp nhất dùng được cần kiểm thử thực tế. Không giảm yêu cầu HTTPS/xác thực để cố hỗ trợ thiết bị cũ.
6. Các YC-027–032 có thay đổi nghiệp vụ riêng vẫn chưa triển khai trong bản YC-033 này.

## 4. Hướng dẫn cập nhật an toàn (chỉ khi quản trị viên quyết định triển khai)

1. **Sao lưu** toàn bộ repo GitHub đang vận hành hoặc lưu commit hiện hành. Đối chiếu bản V1.9.0 gốc; nếu production đã có sửa đổi khác, phải hợp nhất trước, **không ghi đè những sửa đổi chưa kiểm tra**.
2. Dùng đủ các file đã thay đổi trong mục 1. Nếu lựa chọn thay từng file, chỉ cập nhật `public/app.js`, `public/styles.css`, `public/index.html`, `package.json`; có thể thêm thư mục kiểm thử/tài liệu. Không thay Google Apps Script hoặc Google Sheets.
3. Commit lên nhánh GitHub do quản trị viên kiểm soát; dùng **Vercel Preview** để thử trước. Không tự đẩy thẳng production khi chưa kiểm thử nhóm pilot.
4. Dùng 8 tài khoản/thiết bị thử (Desktop, iPhone hỗ trợ Web Push, Android, một thiết bị cũ), kiểm tra đăng nhập, thêm/sửa/xóa, phân quyền hiện hành, nhập iCPV được phép, cập nhật giữa hai tab, cùng tài khoản trên nhiều thiết bị.
5. Kiểm thử riêng Push: đăng ký trên từng thiết bị; nhận một thông báo thử nghiệm trên mỗi thiết bị được hỗ trợ, thử khi app đóng; kiểm tra chính xác người nhận. **Không gửi thử hàng loạt cho 140 tài khoản.**
6. Chỉ sau khi nghiệm thu ở Preview mới cho Vercel production nhận commit. Kiểm tra cache JS/CSS phiên bản 1.9.1, đóng rồi mở lại PWA trên điện thoại khi cần.
7. Theo dõi lỗi/thời gian phản hồi và chỉ mở rộng từ pilot lên toàn đơn vị sau khi có kết quả đo thực tế.

### Ma trận nghiệm thu thực tế (chưa xác nhận)

| Thiết bị | Đăng nhập và thao tác | Đồng bộ | Nhận Push nền |
|---|---|---|---|
| Windows Chrome/Edge | Cần thử | Cần thử | Cần thử |
| macOS Safari/Chrome | Cần thử | Cần thử | Cần thử |
| iPhone Safari/iOS từ 16.4 qua app Màn hình chính | Cần thử | Cần thử | Cần thử |
| iPhone iOS dưới 16.4 | Cần xác định trình duyệt tối thiểu | Cần thử | Không hỗ trợ theo cơ chế Web Push này |
| Android Chrome/Edge tương thích | Cần thử | Cần thử | Cần thử |
| Android/trình duyệt đời cũ | Cần kiểm tra điều kiện | Cần thử nếu hoạt động | Tùy nền tảng; không cam kết |

## 5. Khôi phục

Nếu phát sinh lỗi sau khi nâng cấp: revert commit V1.9.1 trên GitHub hoặc khôi phục bốn file thay đổi từ bản sao lưu V1.9.0, chờ Vercel triển khai lại, đóng và mở lại ứng dụng PWA. Không xóa dữ liệu `State`, không chạy hàm tạo tab Google Sheets, không xoá OneSignal subscription của người dùng trên toàn đơn vị.

## 6. Yêu cầu riêng vẫn chờ

YC-027 nhận diện tài khoản iCPV; YC-028 phân cấp kiêm nhiệm; YC-029 nhãn hạn/lịch nhắc; YC-030 phương án C phân loại KPI/cá nhân; YC-031 khắc phục đầy đủ vấn đề OneSignal đa nền tảng; YC-032 bảo đảm tải và thông báo độc lập cho 140 tài khoản. **Bản V1.9.1 không được coi là đã triển khai hoặc nghiệm thu những yêu cầu này.**
