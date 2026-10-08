# Nhắc việc KPI – Trung tâm Bảo trợ xã hội Tân Hiệp

Ứng dụng web nhẹ cho **khoảng 140 viên chức**, dùng Google đăng nhập, GitHub làm kho mã nguồn, Vercel làm website/API, Apps Script + Google Sheets làm kho dữ liệu và bộ lập lịch, OneSignal gửi web push.

**Tài liệu bắt đầu:** mở `docs/HUONG-DAN-CAI-DAT-TUNG-BUOC.md` và thực hiện **theo đúng thứ tự**.

## Các nghiệp vụ đã chốt

- Chỉ tài khoản Google được cấp quyền trong sheet `Access` mới đăng nhập được.
- Mỗi người đăng ký **nhiều công việc** độc lập, mỗi công việc có tên ngắn, ngày đến hạn và giờ nhắc.
- **4 lượt** vào 3 ngày dương lịch trước hạn và chính ngày hạn, kể cả thứ Bảy, Chủ nhật, lễ, Tết.
- Múi giờ **Asia/Ho_Chi_Minh**; giờ của mỗi công việc có thể khác nhau; có một giờ mặc định mỗi tài khoản.
- Một OneSignal App ID duy nhất, nhắc đúng `external_id` riêng đã xác thực tại Vercel.
- Được sửa, xóa; hệ thống hủy thông báo chưa gửi và đặt lại lịch mới khi cần.
- Không upload minh chứng, không đồng bộ KPI, không chấm KPI, không polling từ giao diện.
- Mỗi tài khoản có tối đa **50 công việc chưa qua hạn** cùng lúc (giới hạn bảo vệ kích thước ô trong Google Sheets). Có thể điều chỉnh khi nâng cấp kho dữ liệu.
- Lịch hẹn trong **7 ngày sắp tới** được tạo ở OneSignal. Công việc xa hơn vẫn được lưu và sẽ được trigger mỗi giờ lập lịch khi đến khoảng 7 ngày trước lượt nhắc đầu tiên.
- Lịch đã qua **30 ngày** được dọn tự động, giúp dữ liệu không phình to.

## Cấu trúc

```
public/
  index.html                 Giao diện
  styles.css                 CSS mobile-first
  app.js                     Đăng nhập, danh sách, kết nối OneSignal
  OneSignalSDKWorker.js      Service worker OneSignal ở gốc website
  manifest.webmanifest       PWA có thể ghim Màn hình chính
  favicon.svg                Biểu tượng
api/
  config.js                  Chỉ xuất Google Client ID và OneSignal App ID (công khai)
  data.js                    Xác minh Google ID token, HMAC ký truy cập Apps Script
apps-script/
  Code.gs                    Sheet + quyền + lập/hủy lịch OneSignal + trigger
  appsscript.json             Cấu hình dự án Apps Script (tham khảo)
docs/
  HUONG-DAN-CAI-DAT-TUNG-BUOC.md
  KIEM-THU-TRUOC-KHI-DUNG-THAT.md
  GIOI-HAN-BAO-MAT.md
.env.example                  Mẫu tên biến môi trường, KHÔNG chứa khóa thật
```

## Những gì cần chuẩn bị

1. Tài khoản Google có quyền tạo Google Sheet, Apps Script và Google Cloud Console.
2. Tài khoản GitHub; Vercel phù hợp điều kiện sử dụng.
3. Tài khoản OneSignal và app cấu hình Web Push; **chỉ 1 app**.
4. Quyền truy cập quản trị danh sách tối đa khoảng 140 email.

## Về độ tin cậy

Dữ liệu được bảo vệ bằng: xác minh Google ID token ở Vercel; whitelist trong Apps Script; chữ ký HMAC giữa Vercel và Apps Script; REST API Key của OneSignal chỉ lưu trong Script Properties; khóa chống gửi trùng của OneSignal; LockService khi cập nhật Sheets.

Dù đặt lịch thành công, web push **không bảo đảm tuyệt đối đã xuất hiện trên màn hình** nếu thiết bị chặn quyền, mất kết nối, hệ điều hành trì hoãn hoặc không còn subscription hợp lệ. Phần mềm này chỉ hỗ trợ nhắc việc, không thay thế nghĩa vụ tự theo dõi hạn KPI.

**Chưa deploy thực tế:** gói này cần người dùng tự nhập ID, URL, khóa dịch vụ và danh sách tài khoản; kiểm thử với vài tài khoản trước khi đưa 140 người vào vận hành.

## Bản cập nhật giao diện v1.1.0 (Desktop + Mobile)

Bổ sung SPEC `docs/SPEC-UI-UX-DESKTOP-MOBILE.md` và hướng dẫn cập nhật giao diện không ảnh hưởng production `docs/HUONG-DAN-CAP-NHAT-GIAO-DIEN-V1.1.md`.

Chỉ thay đổi 3 file `public/index.html`, `public/styles.css`, `public/app.js`. Mọi API, Apps Script, quy tắc OneSignal, Sheets, khóa môi trường và lịch 4 lượt giữ nguyên. Desktop xem form + danh sách cùng lúc; mobile có 2 mục chuyển nhanh và ít cuộn hơn.

## Cập nhật v1.2.0 – YC-001/002/003

Bộ mã này kế thừa v1.1.0 và bổ sung giao diện mobile đã duyệt (Danh sách / Lịch nhắc / Thông báo / Cá nhân, thêm/sửa/xóa), PWA standalone iOS/Android, cùng cơ chế claim và finalize an toàn khi Apps Script gọi OneSignal ngoài LockService. Không đổi cấu trúc Sheet hoặc định danh người dùng.

**Đọc trước khi thay mã:** `docs/CAP-NHAT-PRODUCTION-V1.2.0.md`. Các tài liệu v1.1.0 trong `docs/` được giữ lại làm hồ sơ baseline lịch sử. Không thực hiện lại setup hay sửa API nếu đang chạy ổn định.
