# Bản vá v1.6.0 – Gửi ngay thông báo hoàn thành đến Trưởng phòng

**Phạm vi:** Chỉ cập nhật `apps-script/Code.gs`. Không thay đổi Google Sheets, Chrome Extension, API Vercel, giao diện, trigger hoặc OneSignal App ID.

## 1. Lỗi đã tìm được

Trong `doPost()`, lệnh `syncManagerByEmail_()` nằm bên trong điều kiện `result.sync && (request.action === 'sync' || result.urgentSync)`. Khi nhân viên xóa công việc hoàn thành mà không có lịch hủy khẩn cấp, việc ghi nhận hoàn thành vẫn được lưu, nhưng việc gửi OneSignal cho Trưởng phòng không được khởi chạy ngay. Do đó thông báo có thể đến khi Trưởng phòng bấm **Kiểm tra lại**, hoặc khi trigger xử lý hàng đợi.

Ngoài ra, `syncManagerByEmail_()` trước đây dùng chung bộ chọn công việc thông báo hạn; nếu tài khoản Trưởng phòng có thông báo hủy lịch riêng đang chờ, thông báo hoàn thành mới có thể bị xử lý chậm.

## 2. Phần sửa

- Chuyển lời gọi gửi đến Trưởng phòng ra ngoài nhánh đồng bộ lịch nhắc khẩn. Khi backend xử lý xóa hoàn thành thành công, nếu đã định danh được Trưởng phòng, hệ thống thử gửi ngay.
- Chỉ lấy những thông báo hoàn thành chưa gửi của Trưởng phòng để gửi, tránh bị hàng đợi hủy lịch riêng cản trở. Các lịch nhắc hạn khác giữ nguyên.
- Vẫn dùng sự kiện đã lưu, khoá nhận diện OneSignal và cơ chế chống gửi trùng hiện có; lỗi tạm thời vẫn dựa vào trigger hằng giờ để xử lý tiếp.

**Giới hạn:** Push chỉ nhận được nếu Trưởng phòng đã từng đăng nhập, có trạng thái/External ID và thiết bị đăng ký OneSignal hợp lệ; việc gửi ngay không thể bảo đảm thiết bị luôn nhận tức thời khi mất mạng hoặc trình duyệt chặn quyền.

## 3. Triển khai an toàn (Apps Script)

1. **Sao lưu:** Lưu một bản `Code.gs` đang chạy; bảo đảm Google Sheets có bản sao lưu. Không chỉnh sửa hoặc xóa `State`.
2. Mở dự án Apps Script đúng của ứng dụng. Thay **toàn bộ** nội dung `Code.gs` bằng file `Code-v1.6.0-HOTFIX-TRUONG-PHONG.gs` đi kèm và bấm **Lưu**.
3. Chọn **Triển khai → Quản lý các bản triển khai**; chọn deployment Web App **đang dùng** → biểu tượng bút chì → **Phiên bản mới** → **Triển khai**. Không tạo Web App mới hoặc đổi URL `/exec`.
4. **Không chạy** `setupProject()`, `prepareVietnameseAdminSheets()` hoặc `activateVietnameseAdminSheets()` chỉ để áp dụng bản vá. Không sửa `ACCOUNT_SCHEMA`, Script Properties, phòng/khu, hay cấu hình OneSignal.
5. Không cần cập nhật GitHub/Vercel vì chỉ có Apps Script chạy trên server thay đổi. Bộ ZIP toàn bộ cung cấp để lưu trữ/đối chiếu.

## 4. Nghiệm thu

- Đăng nhập tài khoản Trưởng phòng trên một thiết bị đã bật thông báo, xác minh tài khoản đang liên kết đúng OneSignal.
- Sử dụng **một nhiệm vụ thử** (không xóa nhiệm vụ thật đang còn sử dụng); nhân viên đã được gán đúng Phòng/Khu chọn **Đã hoàn thành, xóa**.
- Không bấm **Kiểm tra lại** trên thiết bị Trưởng phòng. Chờ một khoảng ngắn; xác nhận thông báo Push tự đến. Kiểm tra mục thông báo trong ứng dụng.
- Kiểm tra không có thông báo trùng. Thử thêm tình huống **xóa do nhập nhầm** và xác nhận không gửi thông báo hoàn thành.
- Nếu thiết bị không nhận, mở Nhật ký `doPost` và `syncScheduledNotifications` trong Apps Script, đồng thời kiểm tra tình trạng subscription trong OneSignal trước khi suy ra lỗi mới.

**Không kết luận nghiệm thu thực tế chỉ từ unit test.**

## 5. Kiểm thử offline và khôi phục

- Kiểm tra cú pháp: `npm run check` — đạt.
- Kiểm thử tự động: `npm test` — **74/74 đạt** (bao gồm 6 bài kiểm thử hồi quy cho việc gửi thông báo ngay).
- Nếu cần quay lại: khôi phục phiên bản `Code.gs` trước đây bằng **Quản lý các bản triển khai** (chọn phiên bản Web App cũ), hoặc thay lại bản mã nguồn sao lưu và triển khai version mới. Không động đến dữ liệu Sheets.

## 6. File thay đổi

- `apps-script/Code.gs`: sửa điều kiện gọi gửi OneSignal và dành riêng bộ chọn thông báo Trưởng phòng.
- `tests/manager-immediate-push.test.js`: bổ sung kiểm thử hồi quy (không triển khai lên Apps Script).
- `docs/HOTFIX-V1.6.0-GUI-THONG-BAO-TRUONG-PHONG.md`: hướng dẫn này.

Các file khác giữ nguyên mã nguồn v1.6.0. Không cập nhật version package, frontend, OneSignal hoặc Google Sheets.
