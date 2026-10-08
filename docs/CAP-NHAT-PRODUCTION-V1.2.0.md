# HƯỚNG DẪN CẬP NHẬT V1.2.0 (YC-001 + YC-002 + YC-003)

**Ứng dụng Nhắc việc KPI – Tân Hiệp.** Đây là bộ mã production chuẩn bị triển khai, không phải bản đã deploy hay đã nghiệm thu trên thiết bị thật.

## 1. Thành phần thay đổi

| Thành phần | Tình trạng |
|---|---|
| `apps-script/Code.gs` | **Thay toàn bộ**; thay đổi cách khóa, claim, xử lý lập/hủy lịch, cơ chế trigger công bằng |
| `public/index.html` | **Thay toàn bộ**; giao diện mobile đã duyệt, menu sửa/xóa, tabs |
| `public/styles.css` | **Thay toàn bộ**; responsive iOS/Android, safe area, FAB, thanh điều hướng dưới |
| `public/app.js` | **Thay toàn bộ**; JS giao diện, giảm lượt tải lại, bảo vệ phiên OneSignal |
| `public/manifest.webmanifest` | **Thay toàn bộ**; PWA standalone và bộ icon đa nền tảng |
| `public/icons/*.png` | **Thêm mới** 4 tệp biểu tượng 192 / 512 / maskable / Apple 180 |
| `package.json` | Bump version 1.2.0 + mở rộng bước check |
| `tests/*.test.js` | Test gốc và test mới, có mô phỏng backend |
| `docs/CAP-NHAT-PRODUCTION-V1.2.0.md` | Tài liệu này |
| `api/config.js`, `api/data.js`, `public/OneSignalSDKWorker.js`, `apps-script/appsscript.json`, `vercel.json` | **Giữ nguyên**. Không đổi API contract hoặc cấu hình secrets |

## 2. Những điều KHÔNG thay đổi

- Một OneSignal App ID; mỗi tài khoản có external ID riêng.
- Google Login + token verification + Access whitelist + HMAC giữa Vercel/Apps Script.
- Google Sheets `Access`, `State`, các tên cột, định danh Google Sub và JSON State có sẵn.
- Bốn lịch nhắc trước 3 / 2 / 1 ngày và ngày đến hạn, múi giờ Việt Nam, kể cả ngày nghỉ.
- Tối đa 50 việc chưa quá hạn, lịch hẹn OneSignal trong 7 ngày, một trigger mỗi giờ.
- Không có đồng bộ KPI, chấm điểm hay minh chứng.

## 3. Sao lưu trước khi cập nhật

1. Giữ lại file ZIP mã nguồn và phiên bản GitHub đang chạy **v1.1.0**; ghi lại commit ID đang dùng.
2. Trong Google Sheets, tạo một bản sao file `Access` và `State` bằng **File → Make a copy** (không gửi dữ liệu cá nhân vào chat).
3. Trong Apps Script, lưu riêng nội dung **Code.gs cũ** trước khi thay, ghi lại deployment version đang phục vụ Web App.
4. Trong Vercel, ghi lại deployment production đang chạy; **không** thay khóa bí mật hoặc Environment Variables.
5. Kiểm tra có đúng một trigger `syncScheduledNotifications`; không xóa dữ liệu hoặc tạo thêm trigger.
6. Chọn thời điểm ít người sử dụng; tránh cập nhật khi nhiều người đang sửa công việc.

## 4. Cập nhật Apps Script – làm trước

1. Mở dự án Apps Script hiện tại của ứng dụng.
2. Mở file **Code.gs** → chọn toàn bộ → thay bằng nội dung file `apps-script/Code.gs` v1.2.0.
3. Nhấn **Save**. Không cần chạy `setupProject` vì sheet/tab/trigger đã tồn tại.
4. Chọn **Deploy → Manage deployments** → chọn Web App hiện hành → biểu tượng **Edit**.
5. Ở **Version**, chọn **New version** → mô tả `KPI v1.2.0 - YC-001` → **Deploy**.
6. Không thay Web App URL nếu bạn cập nhật cùng deployment. Nếu URL thay đổi vì tạo deployment khác, phải điều chỉnh biến `APPS_SCRIPT_URL` ở Vercel tương ứng trước khi tiếp tục.
7. Kiểm tra **Executions** không có lỗi mới. Cần thiết có thể dùng một tài khoản thử nghiệm trên `Access` để thêm/sửa/xóa công việc.
8. **Không** gửi bất cứ Script Property secret nào cho bên thứ ba.

### Về dữ liệu cũ

`JSON State` không cần migration hàng loạt. Các slot chưa được lập lịch trên v1.1.0 vẫn được đọc, các slot đã có ID sẽ được giữ khi sửa/xóa. Slot chưa có ID nhưng từng có `nextRetryAt` được coi là có thể đã gọi API trước đó, cần đối soát trước khi hủy. Bản mới chỉ thêm metadata nhỏ (`attempted`, `leaseUntil`) vào slot khi xử lý.

### Về đồng bộ

- Bản mới chỉ giữ **LockService** cho đoạn kiểm tra/ghi ngắn, không giữ khóa trong lúc chờ OneSignal HTTP.
- Trước khi gửi yêu cầu OneSignal, hệ thống ghi trạng thái claim vào JSON để bảo vệ khi cùng lúc sửa/xóa. Kết quả được đối chiếu với trạng thái mới nhất trước khi hoàn tất.
- Trong trường hợp OneSignal timeout, idempotency key gốc được sử dụng lại, nên không mặc định tạo một thông báo hoàn toàn mới.
- Trigger sử dụng vòng quét xoay vòng (`SYNC_CURSOR` Script Property do chương trình tự tạo) và bỏ qua các dòng chắc chắn không có việc phải xử lý.
- Không gọi `sync` nền theo từng lần chuyển tab. Khi người dùng ấn nút Kiểm tra/Bật thông báo, đây là thao tác đồng bộ do người dùng yêu cầu.

## 5. Cập nhật GitHub / Vercel

1. Mở repository `nhac-viec-kpi-tan-hiep`, branch `main` của dự án hiện có.
2. Giữ nguyên các thư mục và file không thay đổi, cập nhật đúng các file ở mục 1.
3. Thêm **đầy đủ thư mục `public/icons/`**. Nếu dùng gói **TOAN-BO**, bạn có thể dùng toàn bộ nội dung làm bản mới; không đưa tệp cấu hình chứa bí mật vào repository.
4. Commit với mô tả `v1.2.0: UI mobile + PWA + sync optimization`.
5. Chờ Vercel hoàn thành deploy tự động; vào trang production mở trình duyệt, dùng refresh mạnh nếu cần.
6. Kiểm tra `https://nhac-viec-kpi-tan-hiep.vercel.app/manifest.webmanifest` và bốn icon không trả về 404.
7. Không xóa hoặc đổi tên `public/OneSignalSDKWorker.js`: nó vừa là worker OneSignal vừa được đăng ký cho PWA, duy nhất ở scope `/`.

## 6. Kiểm tra trên iOS và Android

**iPhone (iOS 16.4 trở lên để dùng Web Push Home Screen):** Safari → vào website production → Chia sẻ → **Thêm vào Màn hình chính** → Mở **từ biểu tượng vừa cài** → đăng nhập Google → bật quyền thông báo theo hướng dẫn. Nếu bấm URL trong Safari bình thường, thanh địa chỉ vẫn xuất hiện. Một số hành vi đăng nhập/lưu trữ khác nhau giữa Safari tab và Home Screen, có thể phải đăng nhập lại.

**Android:** Chrome → vào website production → Menu ba chấm → **Cài đặt ứng dụng** hoặc **Thêm vào Màn hình chính** → mở biểu tượng trên màn hình → đăng nhập → Bật thông báo. Tùy phiên bản Android/Chrome, câu chữ của nút cài đặt có thể khác.

**Lưu ý:** PWA chạy dạng `standalone` chỉ khi được cài và mở theo đúng chế độ do hệ điều hành hỗ trợ. Website truy cập trong trình duyệt bình thường vẫn có thanh địa chỉ. OneSignal không đảm bảo thông báo được hệ điều hành hiển thị đúng từng giây; phải thử trên thiết bị thật.

## 7. Checklist nghiệm thu trên môi trường thật

- [ ] Đăng nhập Google và kiểm tra whitelist `Access` (tài khoản bật/tắt).
- [ ] Tài khoản A chỉ thấy công việc A; tài khoản B chỉ thấy công việc B.
- [ ] Đăng ký nhiều việc, giới hạn 50, chống trùng tên+ngày+giờ.
- [ ] Sửa tên/ngày/giờ, xem 4 mốc trên lịch, sửa lại lịch theo quy định.
- [ ] Xóa công việc chưa lên lịch 7 ngày: không phát sinh create rồi cancel giả.
- [ ] Xóa công việc đã có ID trên OneSignal: thao tác hủy hoạt động.
- [ ] Sửa/xóa gần đồng thời với trigger; không gửi sai lịch và không mất hủy cũ.
- [ ] Bấm liên tiếp Lưu/Xóa: không tạo thao tác trùng.
- [ ] Chuyển 4 tab mobile, mở/sửa form: không gọi lại `/api/data` nếu chỉ đổi giao diện.
- [ ] Bật thông báo trên iPhone và Android, gửi thử 4 mốc và 2 thiết bị cùng một tài khoản.
- [ ] Đăng xuất A → đăng nhập B trên cùng thiết bị, OneSignal không gắn nhầm.
- [ ] Test ít nhất 5 và 20 lượt gần đồng thời, sau đó tăng tải thử nếu được phép.
- [ ] Ghi lại Logs Vercel / Apps Script Executions / phản hồi OneSignal để so sánh thời gian thật và quota.
- [ ] Mở ứng dụng từ biểu tượng màn hình chính trên iOS và Android, không còn thanh địa chỉ khi ở chế độ standalone.

## 8. Phương án khôi phục

Nếu gặp lỗi, trước hết dừng cho phép phát sinh thay đổi mới, kiểm tra Logs và status OneSignal. Có thể rollback GitHub/Vercel deployment cũ và redeploy **Code.gs v1.1.0** tương ứng nếu cần.

**Không tùy tiện restore bản sao Google Sheets vào file production đang vận hành:** thao tác này có thể làm mất các công việc mới được thêm sau thời điểm backup. Dữ liệu JSON v1.2.0 có thêm thuộc tính nhưng vẫn giữ các khóa gốc, tuy nhiên phải thử rollback bằng tài khoản test trước khi áp dụng quy mô lớn.

## 9. Phạm vi kiểm thử đã thực hiện trong gói

- Kiểm thử cú pháp JavaScript/Apps Script V8 bằng Node.js.
- Kiểm thử các mốc nhắc qua ngày lễ, tháng và năm mới.
- Kiểm thử mô phỏng luồng claim, chống claim trùng, hủy lịch đã có ID, giữ hủy khi có sửa trong lúc tạo OneSignal.
- Kiểm thử cấu trúc 4 tab, PWA standalone, icon 192/512/Apple 180, không gọi API khi đổi tab.

**Chưa thực hiện:** gọi Google/OneSignal thật, tải đồng thời production, đo quota thực tế, hiển thị push trên điện thoại thật. Đừng công bố nghiệm thu PASS các phần này khi chưa có kết quả.
