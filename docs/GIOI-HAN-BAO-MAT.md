# Giới hạn, bảo mật và vận hành

## Dữ liệu và bảo mật

- **Trình duyệt:** chỉ chứa Google ID token trong bộ nhớ tab hiện tại; không lưu token vào localStorage. Khi tải lại, có thể cần đăng nhập lại.
- **Vercel API:** xác minh chữ ký token Google và Client ID, sau đó sinh OneSignal External ID dạng HMAC từ Google `sub` (không dùng email thuần). API ký mỗi yêu cầu bằng HMAC SHA-256 + thời gian + nonce.
- **Apps Script:** chỉ nhận HMAC đúng, giới hạn 2 phút và chống replay nonce bằng CacheService, tra danh sách email được phép, khóa cập nhật bằng LockService.
- **Google Sheets:** tab Access (whitelist), State (mỗi Google `sub` một hàng với JSON lịch riêng). Người dùng cuối **không** có quyền sửa Sheet.
- **OneSignal:** REST API Key chỉ nằm trong Apps Script Properties. Một App ID chung; từng thông báo nhắm **đúng một** External ID, không dùng segment All/Subscribed Users.
- **Thông báo trên màn hình khóa:** có tên công việc rút gọn, nên chỉ đặt tên chung, **không ghi thông tin cá nhân nhạy cảm** trong tiêu đề công việc. Tương lai có thể bật chế độ thông báo chung hoàn toàn.

**Giới hạn xác thực OneSignal:** Token Identity Verification của OneSignal hiện không dùng được với Web SDK. External ID trên web không có chữ ký bắt buộc từ SDK nên không thể bảo đảm ngăn tuyệt đối kẻ tấn công có quyền thao tác SDK và biết External ID của người khác liên kết giả. App đã dùng External ID khó đoán, xác thực Google ở API và không đưa dữ liệu riêng trong API ra tài khoản khác; nhưng đây là hạn chế của dịch vụ, không nên xem là hệ thống phân phối thông tin mật.

## Tránh trùng thông báo

- OneSignal có thuộc tính `idempotency_key` (UUID) cho từng lượt nhắc; ghi khóa vào Sheets **trước** khi gọi OneSignal.
- Khi request timeout, lần thử lại dùng **chính khóa cũ**, giúp giảm trùng thông báo.
- Khi đổi ngày/giờ/tên việc, các lượt đã đặt được đưa sang hàng chờ hủy; **hủy thành công trước khi đặt lịch mới**.
- Nếu OneSignal đang mất kết nối, giữ trạng thái để worker thử lại. Không bao giờ tuyên bố "đã gửi thành công" chỉ vì lưu Sheets thành công.

Các trường hợp race ngay tại giờ gửi, việc thiết bị offline hoặc OneSignal thay đổi API vẫn có thể khiến hủy không kịp hoặc push không đến. Cần giám sát thực tế.

## Cách giảm quota

- Lần mở app: sau Google login **1 yêu cầu load**, chỉ trả lịch của tài khoản này.
- Nhấn mở form, sửa tại UI: **không tải lại** dữ liệu.
- Lưu/xóa: chỉ thao tác dữ liệu của tài khoản (1 ô JSON) và sync lịch liên quan.
- Mỗi giờ: **1 trigger chung** đọc khoảng 140 hàng State **một lần**, chỉ gọi OneSignal cho lịch sắp đến hạn / đang chờ hủy; không tạo 140 trigger, không polling mỗi phút.
- Lịch 7 ngày tới đặt trước ở OneSignal; thời điểm push dựa vào `send_after` UTC, nên không phụ thuộc chính xác giờ trigger Apps Script.
- Giới hạn 50 công việc chưa quá hạn/cá nhân để không vượt giới hạn 50.000 ký tự/ô Google Sheets; dữ liệu được dọn sau 30 ngày kể từ hạn.

**Quota vẫn có thể bị chạm** khi dịch vụ thay đổi chính sách hoặc có quá nhiều người thao tác cùng lúc. Triggers Apps Script có thể bị trễ và tổng thời gian chạy có hạn. Nếu cần mở rộng sang nhiều ngàn người, nên chuyển queue lưu trữ/lập lịch sang hạ tầng backend phù hợp hơn.

## Đặc thù hoạt động

- Đăng ký lịch khi thời điểm nhắc thứ nhất đã qua: hệ thống **chỉ đặt các lượt còn ở tương lai**, không gửi dồn. Mọi slot trong vòng 1 phút tới có thể không lập lịch kịp.
- Trong lúc chưa có thiết bị subscribed, OneSignal có thể không nhận lịch; app sẽ cảnh báo và worker thử lại sau. Muốn kích hoạt sớm, đăng nhập trên thiết bị và bấm **Bật thông báo**.
- Đã cấp quyền cho trình duyệt không đồng nghĩa chắc chắn có subscription, SDK phải đang opted-in và có ID.
- Đăng xuất thật bằng nút **Đăng xuất** ngắt liên kết OneSignal của trình duyệt với tài khoản; đóng tab **không** đăng xuất.
- Nếu người dùng xóa cookie, đổi trình duyệt, đổi điện thoại hoặc vô hiệu thông báo hệ thống, cần vào lại ứng dụng để bật push.
- Không có phân hệ upload, hồ sơ KPI hay quyền quản lý KPI. Quản lý danh sách người dùng bằng tab Access.
- Mã nguồn **chưa được kết nối tài khoản dịch vụ thật của bạn**, nên không thể bảo đảm tích hợp end-to-end cho tới khi hoàn thành kiểm thử nghiệm thu.
