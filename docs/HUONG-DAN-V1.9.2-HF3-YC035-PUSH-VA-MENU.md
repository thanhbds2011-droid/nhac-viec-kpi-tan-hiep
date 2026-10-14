# NHẮC VIỆC KPI – TÂN HIỆP · V1.9.2-HF3

## Phạm vi bản nâng cấp (đã CHỐT)

1. **YC-035**: Khi nhân viên B hoàn thành KPI, Apps Script lưu thông báo cho người có thẩm quyền C, ưu tiên đẩy OneSignal ngay và chuyển tín hiệu cập nhật đến phiên C (nếu đã cấu hình Ably). Không yêu cầu C phải nhấn **Làm mới** để khởi động luồng Push. Khi thiết bị A đăng xuất rồi đăng nhập C, giao diện thử liên kết OneSignal đúng tài khoản C và thử lại có giới hạn nếu khởi tạo/đăng nhập SDK tạm thất bại. Không tự xin lại quyền Push nếu trình duyệt chưa được người dùng cấp.
2. **Menu Google Sheets**: Chỉ hiển thị **Nhắc việc KPI → Kiểm tra nhân sự và phân quyền**. Những hàm tạo bảng/kích hoạt/khôi phục cũ không bị xóa khỏi Apps Script và có thể chạy có chủ đích trong trình biên tập nếu thực sự cần khôi phục.
3. **Bảo toàn**: Giữ tab `Nhân sự - Phân quyền`, `State`, ba tab cũ, định danh tài khoản, dữ liệu công việc, loại KPI/Cá nhân, 4 mốc nhắc, số lượt xử lý nền và các luồng YC-028/030/032/033/034; không tự sửa Google Sheets hoặc production.

## Các file mã thay đổi

- `apps-script/Code.gs`: menu tối giản; retry chuyển sự kiện hoàn thành khi cần; tạo tín hiệu inbox đổi chỉ khi đã có dữ liệu thật của C. Meta gồm Google subject/revision của C chỉ trả về **từ Apps Script đến Vercel**, không đưa cho trình duyệt B.
- `api/data.js`: phát thêm sự kiện `inboxChanged` **đến kênh riêng của C** qua Ably theo tín hiệu đáng tin cậy từ Apps Script. Việc không kết nối được Ably không làm đảo ngược thành công của thao tác lưu/hoàn thành KPI.
- `public/app.js`: liên kết OneSignal có kiểm soát khi chuyển tài khoản; tối đa bốn lần retry theo thời gian khác nhau, được hủy ngay khi phiên thay đổi; khi không có kết nối Ably, ứng dụng đang mở đối chiếu revision theo chu kỳ giới hạn (không yêu cầu bấm Làm mới). Đây là đối soát **nội bộ ứng dụng**, không thay thế Push nền.
- `public/index.html`: thay phiên bản tài nguyên để hạn chế tải nhầm cache HF2.
- `package.json`, kiểm thử YC-035, tài liệu: cập nhật tương ứng.

Các file không thay đổi: `api/realtime.js`, `server/identity.js`, `server/realtime.js`, `server/session.js`, Chrome Extension, `OneSignalSDKWorker.js`, Google Sheets.

## Trình tự cập nhật an toàn

1. **Sao lưu** bản Apps Script đang dùng, ZIP GitHub/Vercel đang chạy, danh sách biến môi trường, và bản sao Google Sheets (đặc biệt `State`). Không gửi giá trị bí mật lên cuộc trò chuyện.
2. **Apps Script**: mở dự án đang kết nối Google Sheets, thay toàn bộ `Code.gs` bằng file HF3, lưu. Trong **Triển khai → Quản lý bản triển khai → Chỉnh sửa**, chọn **Phiên bản mới**, triển khai giữ nguyên URL Web App. Không cần thêm tab/cột, không chạy lại các hàm khởi tạo cũ.
3. **GitHub/Vercel**: cập nhật nguyên bộ nguồn HF3 (ít nhất `api/data.js`, `public/app.js`, `public/index.html`) và cho Vercel tạo bản triển khai mới. Giữ nguyên các giá trị `APPS_SCRIPT_URL`, `APPS_SCRIPT_SHARED_SECRET`, `PUSH_ID_SECRET`, `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`. Kiểm tra `APPS_SCRIPT_URL` trỏ đến Web App vừa triển khai.
4. Nếu muốn cập nhật hộp thông báo **ngay tức thì trong ứng dụng**, Ably cần được cấu hình đúng bằng `ABLY_API_KEY` hiện có; **không được tự phát sinh khóa hoặc bật dịch vụ mới**. Nếu chưa có Ably, Push vẫn qua OneSignal; ứng dụng đang mở có cơ chế đối soát dự phòng theo chu kỳ giới hạn.
5. Tải lại Google Sheets để menu mới xuất hiện. Chỉ còn mục **Kiểm tra nhân sự và phân quyền**. Việc không thấy mục cũ **không đồng nghĩa chúng đã bị xóa khỏi code**.
6. Dùng **ba tài khoản thử** và các thiết bị đã cấp quyền Push. Không gửi Push hàng loạt đến 140 tài khoản thật trước khi nghiệm thu.

## Kiểm thử YC-035 trên thiết bị thật

1. Trên máy tính số 1, đăng nhập A, sau đó **Đăng xuất** và đăng nhập C. Đến khi trạng thái máy C hiện **Thông báo đã bật trên thiết bị này** mới cho B tạo sự kiện thử. Trạng thái đăng nhập Google thành công **không đủ** xác nhận OneSignal đã liên kết C.
2. Trên máy tính hoặc điện thoại số 2, đăng nhập B; thêm một công việc **KPI**, chọn đúng Phòng/Khu và hoàn thành → **Đã hoàn thành, xóa**.
3. Máy C **không bấm Làm mới**. Kiểm tra: (a) Push từ hệ điều hành/trình duyệt có đến không; (b) tab Thông báo trong ứng dụng có tự cập nhật không. Đây là hai bước nghiệm thu khác nhau.
4. Thử đóng ứng dụng C, sau đó B hoàn thành KPI mới, kiểm tra Push nền trên thiết bị C đã đăng ký.
5. Đăng xuất C, đăng nhập A trên cùng máy; tạo một KPI gửi đến C và xác minh **A không nhận nhầm Push của C**.
6. Kiểm thử thông báo hạn của cá nhân A và B cùng thời điểm với việc C nhận KPI; không để lỗi của một người chặn người khác. Lặp lại trên Windows/Chrome/Edge và ít nhất Android/iPhone hỗ trợ Push nền.
7. Nếu không đến, kiểm tra **OneSignal Audience → Subscriptions** (thiết bị có liên kết đúng External ID người nhận và opted-in?), trạng thái Delivery của notification, Google Apps Script Executions và log Vercel. Nếu inbox C đã có nhưng Push không đến, tập trung kiểm tra subscription/OneSignal chứ không thay đổi phân quyền ở Google Sheets một cách phỏng đoán.

**Chú ý:** Thông báo đến đúng phút không thể bảo đảm trên mọi thiết bị/OS khi có mạng yếu, hệ điều hành chặn, tiết kiệm pin hay trình duyệt không hỗ trợ. iPhone cần Home Screen web app và hỗ trợ phiên bản phù hợp (Web Push từ iOS 16.4). Nếu C đã nhận thông báo chờ *trước khi* thiết bị được đăng ký Push, việc đăng nhập sau đó không bảo đảm tự phát lại Push cũ, nhưng inbox phải bảo toàn.

## Kiểm thử cục bộ

- `npm run check` – kiểm tra cú pháp các thành phần JS/Apps Script.
- `npm test` – kiểm thử hồi quy 138 bài cũ và 5 bài YC-035 = **143 bài**.
- Đây là **kiểm thử cục bộ/mô phỏng**, không phải xác nhận đã triển khai production, có Ably thật, OneSignal thật hoặc nghiệm thu 140 tài khoản đồng thời.

## Khôi phục

Nếu chức năng quan trọng sai: (1) dừng nâng cấp diện rộng; (2) triển khai lại ZIP GitHub/Vercel HF2 đã sao lưu; (3) khôi phục `Code.gs` HF2 và tạo **phiên bản Web App mới** tương ứng; (4) không xóa/chỉnh `State` để xử lý lỗi phần mềm; (5) nếu gặp dữ liệu mới không tương thích, cần đối chiếu trước khi rollback. HF3 không thêm trường dữ liệu Google Sheets.
