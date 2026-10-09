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
