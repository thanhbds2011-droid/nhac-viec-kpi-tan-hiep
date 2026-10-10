# Nhắc việc KPI – Tân Hiệp V1.9.0: Nâng cấp giao diện YC-026

## 1. Phạm vi được duyệt

Bộ mã V1.9.0 nâng cấp giao diện desktop, iOS và Android theo bộ hình ảnh đã duyệt ngày 10/10/2026. Giữ nguyên kiến trúc và xử lý nghiệp vụ V1.8.0, không cần cập nhật Apps Script, Google Sheets, Vercel API, OneSignal hoặc Chrome Extension.

### Các file thay đổi

- `public/index.html`: cấu trúc header, thông tin chào, tiêu đề thẻ, bộ lọc đếm thật và shortcut quản trị.
- `public/styles.css`: thiết kế xanh-trắng, hai cột desktop, các thẻ công việc, responsive iOS/Android và vùng an toàn.
- `public/app.js`: chỉ cập nhật trạng thái hiển thị, đếm các bộ lọc theo dữ liệu hiện tại, avatar, và nối nút mới đến các chức năng đã có.
- `package.json`: cập nhật metadata phiên bản V1.9.0, không đổi dependencies hoặc scripts.
- `tests/v190-ui-baseline.test.js`: kiểm thử giao diện mới.

Các file `api/*`, `server/*`, `apps-script/*`, `chrome-extension/*`, `public/OneSignalSDKWorker.js`, `public/manifest.webmanifest` và các icon PWA được giữ nguyên byte so với ZIP V1.8.0.

## 2. Các điểm cần hiểu rõ

- Những số 8 tài khoản, 76 đầu việc, tên người và ngày tháng trong mockup chỉ là minh họa. Giao diện bản mới dùng dữ liệu thật. Trên desktop, shortcut quản trị dẫn đến màn hình tổng quan; số liệu vẫn được tải bởi API `adminStats` **khi vào màn hình này**, không phát sinh thêm yêu cầu API ngầm khi đăng nhập.
- Các tác vụ sửa và xóa có sẵn vẫn nằm dưới menu dấu ba chấm. Menu giữ nguyên hộp xác nhận **Xóa do nhập nhầm / Đã hoàn thành, xóa**.
- Khu vực “Nhân viên đã hoàn thành” trên dashboard desktop chỉ xuất hiện khi tài khoản có thông báo trong hộp thư. Dữ liệu vẫn lấy từ inbox cá nhân hợp lệ đã cấp bởi backend; không mở quyền quản lý mới.
- Trên mobile không hiển thị dải tab desktop bị trùng với thanh điều hướng dưới. Tổng quan quản trị truy cập từ **Cá nhân** và chỉ khả dụng khi có quyền.
- Khung kỹ thuật kiểm tra thông báo lớn vẫn được bỏ như V1.8.0; nếu thiết bị chưa đăng ký Push, thông báo yêu cầu bật được giữ ở dạng thanh nhỏ. Không xóa OneSignal hoặc cơ chế cấp quyền.
- Không bổ sung bộ lọc “Sắp đến hạn” mới: số đếm hiển thị căn cứ đúng định nghĩa có sẵn của V1.8.0: hạn từ hôm nay đến 3 ngày tới.

## 3. Trình tự cập nhật GitHub/Vercel

1. Sao lưu commit/bản ZIP V1.8.0 trước khi triển khai.
2. Từ ZIP toàn bộ V1.9.0 hoặc ZIP chỉ file thay đổi, thay đúng `public/index.html`, `public/styles.css` và `public/app.js` trong repo; cập nhật `package.json` chỉ để hiển thị đúng số phiên bản ở metadata.
3. Không xóa thư mục `public/icons/`, không thay `OneSignalSDKWorker.js`, không sửa các file `api`, `server`, `apps-script` hoặc `chrome-extension`.
4. Commit lên nhánh đang được Vercel deploy (thường là `main`). Chờ Vercel báo **Ready**.
5. Máy tính: mở website và nhấn `Ctrl+Shift+R`. iPhone/Android PWA: đóng hẳn ứng dụng rồi mở lại; khi cần, tải lại website để nhận asset `v=1.9.0`.

## 4. Nghiệm thu bắt buộc trên môi trường thật

1. **Đăng nhập:** Google Sign-In và phạm vi tài khoản vẫn đúng; không đổi External ID.
2. **Công việc:** kiểm tra tất cả, sắp hạn (0–3 ngày), quá hạn và đếm số liệu; vào dấu ba chấm → Sửa/Xóa để xác thực có đúng hộp xác nhận như trước.
3. **Thông báo:** thử trên nhiệm vụ giả lập; nhân viên chọn “Đã hoàn thành, xóa”, Trưởng phòng nhận lần đầu và nhắc lại từ 08:00 hôm sau nếu chưa xóa. Sau khi Trưởng phòng xóa, kiểm tra dừng nhắc. **Tính năng backend nhắc lại không được sửa trong bản V1.9.0.**
4. **Quản trị:** tài khoản quyền G = Có vào Cá nhân/Tổng quan quản trị; tài khoản không có quyền không thấy chức năng quản trị.
5. **iCPV:** Chrome Extension đồng bộ nhiệm vụ thử; không tạo bản ghi ngoài lựa chọn người dùng.
6. **Thiết bị:** kiểm tra desktop Chrome/Edge, iPhone Safari/PWA, Android Chrome/PWA, các hộp thoại khi nhập bằng bàn phím ảo và vùng an toàn thanh điều hướng.
7. **Push:** thử riêng trên thiết bị thật; kiểm thử DOM không chứng minh thiết bị đã nhận Push.

## 5. Khôi phục

Nếu giao diện lỗi, revert commit giao diện V1.9.0 về commit V1.8.0 (hoặc thay lại 3 file `public/*` và metadata `package.json` bằng bản sao lưu); chờ Vercel Ready, tải lại trang. Không sửa `State` và không chạy các hàm thiết lập Apps Script. Không xóa dữ liệu tài khoản hay nhiệm vụ.

## 6. Kiểm thử đã thực hiện tại thời điểm đóng gói

`npm test` và `npm run check`; kiểm tra trình duyệt Chromium headless với kích thước desktop 1440×1000, iOS 390×844, Android 412×915. Dữ liệu trong ảnh chụp trình duyệt là dữ liệu giả lập **chỉ để thử bố cục**, không kết nối production. Không thay thế nghiệm thu thực tế trên trình duyệt và điện thoại của người dùng.
