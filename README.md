# Nhắc việc KPI – Tân Hiệp v1.3.0 (YC-005)

Ứng dụng PWA nhắc việc cá nhân cho nhân sự Trung tâm Bảo trợ xã hội Tân Hiệp; phát triển từ **baseline v1.2.0**, không tạo dự án mới.

## Thành phần

- `public/`: giao diện responsive, PWA, đăng nhập Google, OneSignal Web Push, hiển thị optimistic và đồng bộ sự kiện trên thiết bị.
- `api/data.js`, `api/realtime.js`, `api/config.js`: API Vercel.
- `server/`: xác thực phiên server ký HMAC và phát sự kiện/token Ably theo kênh cá nhân.
- `apps-script/`: backend Google Sheets Access / State và lịch OneSignal.
- `tests/`: các bài kiểm thử chạy bằng `npm test`.
- `docs/CAP-NHAT-PRODUCTION-V1.3.0.md`: **hướng dẫn triển khai, nghiệm thu và rollback**.

## Cấu hình

Tương thích biến môi trường cũ: `GOOGLE_CLIENT_ID`, `ONESIGNAL_APP_ID`, `APPS_SCRIPT_URL`, `APPS_SCRIPT_SHARED_SECRET`, `PUSH_ID_SECRET`. Thêm `ABLY_API_KEY` **nếu muốn bật đồng bộ gần real-time trên nhiều thiết bị**. Không đổi/đưa khóa cũ ra frontend.

Script Properties hiện tại tiếp tục sử dụng: `SHEET_ID`, `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, `WEB_URL`, `SHARED_SECRET`.

## Các tính năng chính

- Cập nhật UI ngay sau thao tác thêm/sửa/xóa, không F5; chỉ xác nhận đã lưu khi backend thành công.
- `revision` tăng theo thay đổi của người dùng, từ chối ghi đè do hai thiết bị cùng sửa (`409 CONFLICT`).
- Đồng bộ delta qua Ably (quyền kênh riêng), BroadcastChannel giữa các tab, và kiểm tra `status` khi quay lại ứng dụng để khôi phục sau mất kết nối.
- Giữ OneSignal, một App ID và bốn lượt nhắc theo ngày dương lịch/múi giờ Việt Nam.
- Giữ một trigger Apps Script mỗi giờ; lập lịch sớm qua sync tách biệt và ưu tiên xử lý ngay khi gần đến hạn.
- Access Active kiểm tra ở backend; không thêm chức năng Admin chưa được mô tả.

## Kiểm thử trước deploy

```sh
npm install
npm run check
npm test
```

Kiểm thử tự động không thay thế kiểm thử iPhone/Android/OneSignal/Ably thực tế. Không có dữ liệu production nào được điều chỉnh trong gói mã nguồn.

## Phiên bản 1.4.0 – YC-006: Tiện ích Chrome đồng bộ tên/hạn iCPV

- Đã thêm `chrome-extension/` (Manifest V3) để **người dùng chủ động đọc bảng** nhiệm vụ đang hiển thị trên iCPV, chuyển bản xem trước sang Nhắc việc đã đăng nhập rồi xác nhận.
- Đã thêm action backend `importTasks` để ghi đối chiếu theo lô, giữ tên ngắn và giờ cá nhân, hỗ trợ sự kiện đa thiết bị.
- **Chưa được nghiệm thu với HTML iCPV thật**, chưa triển khai production và chưa xác minh quyền chia sẻ dữ liệu công vụ.
- Hướng dẫn chi tiết và rollback: [`docs/CAP-NHAT-V1.4.0-DONG-BO-ICPV.md`](docs/CAP-NHAT-V1.4.0-DONG-BO-ICPV.md).

## Phiên bản 1.4.1 – Tối ưu OneSignal đa tài khoản / đa thiết bị

- Sửa thứ tự xin quyền thông báo ngay trong cú bấm người dùng; kiểm tra trạng thái Subscription và quyền trình duyệt trước khi báo "Đã bật".
- Hiển thị hướng dẫn chi tiết cho Chrome bị chặn, OneSignal chưa tải xong và iPhone chưa mở PWA từ Màn hình chính.
- Không thay Apps Script, API, Sheets, OneSignal App ID hoặc tiện ích iCPV; chỉ cập nhật giao diện / logic trình duyệt.
- **Chưa thể cam kết mọi thiết bị nhận tin nếu quyền bị chặn, browser không hỗ trợ hoặc cấu hình/đường truyền OneSignal gặp lỗi.** Cần thử trên máy thật và kiểm tra dashboard.
- Hướng dẫn triển khai: [`docs/CAP-NHAT-V1.4.1-THONG-BAO-DA-THIET-BI.md`](docs/CAP-NHAT-V1.4.1-THONG-BAO-DA-THIET-BI.md).
