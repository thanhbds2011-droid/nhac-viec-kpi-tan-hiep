# HƯỚNG DẪN CẬP NHẬT V1.4.1 – THÔNG BÁO TRÊN NHIỀU THIẾT BỊ

**Bản gốc:** Nhắc việc KPI – Tân Hiệp v1.4.0 (đã cập nhật Apps Script, tiện ích Chrome, Vercel).  
**Bản mới:** v1.4.1 – tập trung vào đăng ký quyền Web Push trên Chrome/Edge/Android/iPhone và nhận diện tài khoản OneSignal.

## 1. Vì sao có máy không bật được thông báo?

V1.4.0 chờ khởi tạo OneSignal, rồi chờ gắn tài khoản (`OneSignal.login`) **trước khi** gọi cửa sổ xin quyền. Trình duyệt có thể yêu cầu thao tác xin quyền diễn ra ngay trong cú bấm thật của người dùng. Một số tình huống còn không được giải thích rõ: quyền đã bị chặn, OneSignal SDK không tải, iPhone chưa cài PWA lên Màn hình chính, hoặc đã cấp quyền nhưng OneSignal chưa có Subscription ID. Không có log thực tế của máy lỗi nên **chưa thể kết luận nguyên nhân duy nhất**.

## 2. Thay đổi trong v1.4.1

- Gọi `OneSignal.Notifications.requestPermission()` ngay trong cú bấm **Bật thông báo**, trước các lệnh `await`/đăng nhập thiết bị qua mạng, khi SDK đã khởi tạo và quyền còn ở trạng thái `default`.
- Khởi tạo OneSignal **một lần duy nhất**, nhưng cho phép chờ lại sau khi CDN tải chậm; khi không thành công hiển thị lỗi có ích thay vì không phản hồi.
- Gọi `OneSignal.login(externalId)` theo tài khoản Google **đã xác thực và thuộc Access**. Cùng tài khoản trên máy mới được liên kết với External ID cũ; khi đổi tài khoản trên cùng trình duyệt phải đăng xuất rồi đăng nhập lại.
- Thông báo "Đã bật" chỉ hiển thị khi có quyền, đúng tài khoản đã gắn, có Subscription ID, và Subscription ở trạng thái opt-in.
- Chỉ rõ tình huống Chrome bị chặn, PWA iPhone chưa cài, trình duyệt không hỗ trợ, SDK chưa khởi tạo, đăng ký Subscription thất bại.
- Có **Thông báo → Kiểm tra trạng thái thiết bị** với chẩn đoán cơ bản; không hiển thị token hay khóa bí mật.
- Bấm kiểm tra sau khi thiết bị đăng ký thành công sẽ yêu cầu đối chiếu lịch OneSignal (`api('sync')`).
- Không thay cấu trúc Sheets, Apps Script, API Vercel, tiện ích Chrome, External ID, App ID, danh sách nhiệm vụ, giờ nhắc, 4 mốc nhắc, giới hạn tác vụ, trigger hằng giờ.

## 3. File cần cập nhật lên GitHub

Cập nhật **đúng đường dẫn trong repository hiện có**, nhánh `main`:

1. `public/app.js` – toàn bộ nội dung mới.
2. `public/index.html` – toàn bộ nội dung mới, cache-bust `?v=1.4.1`.
3. `public/styles.css` – toàn bộ nội dung mới.
4. `package.json` – phiên bản mới, không thay dependencies.

Tùy chọn (không cần cho Vercel): `tests/push-devices.test.js`, `docs/CAP-NHAT-V1.4.1-THONG-BAO-DA-THIET-BI.md`, `README.md`.

**Không thay/không deploy lại:** `apps-script/Code.gs`, `apps-script/appsscript.json`, `api/*.js`, `server/*.js`, `vercel.json`, `public/OneSignalSDKWorker.js`, `chrome-extension/*` và các biến môi trường Vercel/Script Properties.

Để tải lên bằng web GitHub: dùng `Add file → Upload files` trong từng thư mục tương ứng để bảo đảm file trùng đường dẫn được thay thế. Không tải nguyên ZIP vào repository, không tạo thư mục `file-can-thay-v1.4.1/` bên trong repository. Commit `Fix OneSignal per-device subscription v1.4.1`. Chờ Vercel `Ready – Production`. Nếu người dùng đang mở tab cũ, tải lại hoặc đóng và mở lại PWA.

## 4. Thiết lập OneSignal dashboard – quản trị viên kiểm tra **một lần**

1. Trên Vercel xác nhận biến `ONESIGNAL_APP_ID` trỏ đến đúng một OneSignal App ID; giữ nguyên khóa hiện tại, **không dán khóa** vào chat hoặc frontend.
2. Trong OneSignal Dashboard, kiểm tra Web Push đã được thiết lập cho **chính xác** origin `https://nhac-viec-kpi-tan-hiep.vercel.app` (không thêm đường dẫn trang). Nếu website dùng domain tùy chỉnh, mỗi origin cần cấu hình/đánh giá phù hợp.
3. Mở `https://nhac-viec-kpi-tan-hiep.vercel.app/OneSignalSDKWorker.js` để kiểm tra nó có được phục vụ dưới đúng origin HTTPS dưới dạng JS (không redirect sang trang HTML).
4. Đăng nhập app trên máy mới rồi bật quyền; kiểm tra **Audience → Subscriptions** trên OneSignal, thấy một Subscription thuộc người dùng tương ứng và trạng thái `Subscribed` (giao diện OneSignal có thể thay đổi).
5. Dùng chức năng **gửi thử đến đúng Subscription thử nghiệm** trên OneSignal (không gửi cả đơn vị). Nếu không nhận được, xem kết quả trong phần Delivery; kiểm tra OS có chặn thông báo/Không làm phiền/Chế độ tập trung hay không.
6. Nếu một số tài khoản đăng ký được, tài khoản khác không: kiểm tra tab `Access` (Active=YES), OneSignal External ID liên kết sau đăng nhập, quyền site từng browser; không gán nhiều người vào một tài khoản hoặc một External ID.

## 5. Cách dùng trên máy tính mới (Chrome/Edge)

1. Dùng Chrome/Edge mới, cửa sổ thường (không ẩn danh), mở website Nhắc việc HTTPS chính thức.
2. Đăng nhập Google **bằng tài khoản có trong Access**, kiểm tra tên tài khoản hiện trên ứng dụng.
3. Nếu bật thông báo được ngay: bấm **Bật thông báo**, chọn **Cho phép** trên hộp thoại trình duyệt.
4. Nếu ứng dụng báo **OneSignal đang khởi tạo**, chờ vài giây và bấm lại; kiểm tra có trình chặn quảng cáo hoặc mạng cơ quan chặn `cdn.onesignal.com`/OneSignal hay không.
5. Nếu đã **chặn**: nhấn biểu tượng điều chỉnh/ổ khóa bên trái URL → Cài đặt trang web → Thông báo → Cho phép; tải lại trang rồi bấm Bật thông báo.
6. Vào tab **Thông báo → Kiểm tra trạng thái thiết bị**, chỉ xác nhận hoàn tất khi Quyền = `granted`, Đúng tài khoản = Có, Subscription = Có, Đăng ký nhận tin = Có. Sau đó thử thông báo trên OneSignal.
7. Đóng ứng dụng hoặc trình duyệt không hủy lịch OneSignal đã lập; máy phải có mạng, quyền hệ điều hành và browser cho phép nhận thông báo nền.

## 6. iPhone

- iOS/iPadOS 16.4+, vào **Safari** mở website → Chia sẻ → Thêm vào Màn hình chính.
- **Mở ứng dụng từ biểu tượng Màn hình chính**, không chỉ mở trong tab Safari/Chrome bình thường.
- Đăng nhập cùng tài khoản đã được cấp quyền; bấm Bật thông báo → Cho phép.
- Nếu trước đó từ chối: iPhone **Cài đặt → Thông báo → Nhắc việc KPI** để bật lại; kiểm tra Chế độ tập trung.
- Tiện ích Chrome đồng bộ iCPV **không cần cài** trên iPhone. Nó chỉ lấy nhiệm vụ từ trang Thành ủy trên máy tính; khi đã lưu, mọi thiết bị có đăng ký OneSignal hợp lệ của cùng tài khoản có thể nhận push.

## 7. Kiểm thử nhiều tài khoản và thiết bị

| Ca | Quy trình | Kết quả dự kiến |
|---|---|---|
| 1 | Tài khoản A đăng nhập Chrome máy 1, cấp quyền | Có Subscription máy 1 liên kết A |
| 2 | A đăng nhập Chrome máy 2, cấp quyền | Có Subscription máy 2 liên kết A |
| 3 | A đăng nhập PWA iPhone, cấp quyền | Có Subscription iPhone liên kết A |
| 4 | Tạo một nhiệm vụ A có giờ nhắc hợp lệ trong tương lai, kiểm tra 4 mốc | Các thiết bị A có đăng ký hợp lệ là đối tượng nhận, phụ thuộc trạng thái OneSignal/OS |
| 5 | Đăng xuất A trên máy 2, đăng nhập tài khoản B trong Access, cấp quyền nếu cần | Máy 2 được gắn B; không nhận nhiệm vụ A sau khi chuyển tài khoản |
| 6 | Chặn quyền trình duyệt trên máy 2 | Ứng dụng hướng dẫn bật quyền, không báo đã bật sai |
| 7 | Tạo tác vụ B | Chỉ các Subscription của B là người nhận |

**Lưu ý:** `Thông báo đã bật` chỉ là chứng nhận browser được đăng ký, KHÔNG bảo đảm lịch OneSignal đã có/đã giao. Kiểm thử gửi push thật trên Dashboard vẫn là điều kiện nghiệm thu. Không có mã nào có thể buộc máy bị từ chối quyền hoặc trình duyệt không hỗ trợ tự nhận push.

## 8. Rollback

Nếu bản mới gây lỗi: phục hồi `public/app.js`, `public/index.html`, `public/styles.css`, `package.json` từ bản sao GitHub v1.4.0 rồi commit lại; giữ nguyên Sheets/Apps Script và tiện ích Chrome. Không xóa `State` hoặc thay App ID để sửa lỗi đăng ký thiết bị.
