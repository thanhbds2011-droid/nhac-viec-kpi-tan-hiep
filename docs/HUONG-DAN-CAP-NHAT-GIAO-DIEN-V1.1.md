# CẬP NHẬT GIAO DIỆN V1.1.0 QUA GITHUB / VERCEL

**Dành cho dự án đang hoạt động**: `nhac-viec-kpi-tan-hiep`.

## Phương án dễ nhất – thay 3 tệp trong GitHub

1. Sao lưu mã nguồn v1.0 hoặc giữ commit cũ để có thể quay lại.
2. Mở GitHub repository `thanhbds2011-droid/nhac-viec-kpi-tan-hiep` (kiểm tra đúng tài khoản GitHub bạn đang dùng).
3. Mở thư mục `public`. Lần lượt mở từng file `index.html`, `styles.css`, `app.js`.
4. Với mỗi file, bấm biểu tượng bút chì **Edit this file**, chọn toàn bộ nội dung, thay bằng toàn bộ nội dung file *cùng tên* trong thư mục `public` của gói v1.1.0, rồi bấm **Commit changes**.
5. **Chỉ thay 3 file này**, không xóa các file khác. Không cần tải ZIP nguyên vào repository.
6. Vào Vercel → dự án Nhắc việc KPI → **Deployments**, chờ bản deploy mới của nhánh `main` có trạng thái **Ready** (GitHub integration tự triển khai).
7. Mở Production URL `https://nhac-viec-kpi-tan-hiep.vercel.app`, nhấn `Ctrl+F5` trên Chrome/Edge nếu giao diện cũ còn được cache.
8. Đăng nhập bằng tài khoản đã có trong Google Sheets `Access`; kiểm tra danh sách việc cũ vẫn hiển thị, thử tạo/sửa/xóa với *một công việc thử nghiệm*.
9. Thử OneSignal trên thiết bị đã đăng ký: trạng thái trên giao diện chỉ là điều kiện cần, nên cần chờ và xác nhận thông báo thực tế.

## Không được thay đổi trong lần cập nhật UI

- Không tạo lại Google Cloud OAuth Client ID; không thay Vercel Environment Variables.
- Không sửa Apps Script `Code.gs` hoặc trigger `syncScheduledNotifications`.
- Không sửa OneSignal App ID, OneSignal API Key và Site URL.
- Không xóa các tab `Access`/`State`, không sửa cột hoặc JSON State.

## Quay lại bản cũ nếu có lỗi

- Tìm commit trước khi nâng cấp trên GitHub → **History** của từng file `public/` hoặc dùng Revert commit giao diện. Vercel sẽ tự triển khai lại bản cũ.
- Nếu gặp lỗi kết nối, ghi lại thông báo trên màn hình và xem **Vercel Logs / Apps Script Executions** trước khi thay đổi code.

## Kiểm thử mobile

- Dùng đường dẫn website hiện tại hoặc mở PWA đã cài trên thiết bị.
- Chọn `Đăng ký` và `Danh sách`; khi nhấn `Sửa`, phần form phải hiện ra ngay; sau khi lưu quay về danh sách.
- Không đăng xuất nếu bạn đang kiểm thử nhận push trong nền.
