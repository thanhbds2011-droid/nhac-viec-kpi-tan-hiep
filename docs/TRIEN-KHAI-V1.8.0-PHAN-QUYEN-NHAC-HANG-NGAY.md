# HƯỚNG DẪN TRIỂN KHAI NHẮC VIỆC KPI – V1.8.0

## 1. Mục tiêu và phạm vi

Nâng cấp theo Master Prompt V2.8: (YC-023) bỏ khung hướng dẫn/kiểm tra kỹ thuật thông báo, giữ hộp công việc nhân viên đã hoàn thành; (YC-024) chuẩn bị nhắc Trưởng phòng hằng ngày cho từng thông báo chưa xóa; (YC-025) tách **vai trò công tác** với **quyền quản trị ứng dụng**.

**Chưa chốt giờ gửi nhắc lại hằng ngày:** Bản code hỗ trợ cấu hình `MANAGER_REMINDER_TIME` (HH:mm, giờ Việt Nam). Khi chưa thiết lập thuộc tính này, chỉ có thông báo hoàn thành lần đầu như cũ. **Không tự đặt giờ mặc định.** Sau khi người quản trị xác nhận thời điểm, cấu hình thuộc tính để kích hoạt việc nhắc lại. Trigger `syncScheduledNotifications` hiện hữu chạy khoảng mỗi giờ nên không bảo đảm chính xác từng phút.

## 2. Những file thực sự thay đổi

- `apps-script/Code.gs`: cờ quyền quản trị, chuyển đổi cột G và lịch nhắc Trưởng phòng hằng ngày có cấu hình.
- `public/index.html`: xóa khung thông tin kỹ thuật, giữ danh sách thông báo và nút cấp quyền thông báo dạng gọn.
- `public/app.js`: ngừng tham chiếu các thành phần đã bỏ, tự ẩn thanh cấp quyền khi thiết bị đã đăng ký, còn nút bật khi cần.
- `public/styles.css`: bỏ CSS không sử dụng thuộc khung lớn.
- `package.json`: đổi số phiên bản.
- Bổ sung/mở rộng các bài kiểm thử và hướng dẫn triển khai.

**Không thay đổi:** Chrome Extension v1.7.0, Vercel API, Google Sign-In, OneSignal App ID, lịch nhắc nhân viên 3–2–1–0 ngày, Google Sheets `State`, cấu trúc Phòng/Khu.

## 3. Bắt buộc sao lưu trước

1. Sao lưu file Google Sheets hiện hữu, đặc biệt các tab `Tài khoản`, `Quản lý Phòng-Khu` và `State`. **Không xóa hoặc chuyển State.**
2. Lưu `Code.gs` v1.7.0, thông tin ID của Apps Script deployment `/exec` đang chạy, và bản GitHub/Vercel đang hoạt động.
3. Không chạy `setupProject`, không chạy `prepareVietnameseAdminSheets` nếu đang dùng tab tiếng Việt, không xóa trigger hằng giờ.

## 4. Triển khai Apps Script

1. Mở Apps Script hiện tại → sao lưu rồi thay **toàn bộ** `Code.gs` bằng `apps-script/Code.gs` v1.8.0.
2. Bấm Lưu.
3. Chọn **Triển khai → Quản lý bản triển khai → chọn deployment Web App hiện tại → Sửa → Phiên bản mới → Triển khai**. Giữ nguyên URL `/exec` và các Script Properties bí mật.
4. Trong trình biên tập Apps Script, chọn hàm `prepareAdminPermissionColumn`, bấm **Chạy** đúng một lần để thêm cột G trong tab `Tài khoản` (có thể chạy lại nhưng sẽ không ghi đè dữ liệu G đã nhập).
5. Kiểm tra tiêu đề **G1 = Quyền quản trị**, mỗi hàng có `Có` hoặc `Không`. Cột F vẫn giữ dữ liệu đối chiếu cũ và có thể tiếp tục ẩn.
6. Giữ **D = Nhân viên** đối với người là nhân viên thật, **E = mã Phòng/Khu đúng**, đặt **G = Có** nếu được phép quản trị. Cách này vừa xem thống kê vừa báo Trưởng phòng khi hoàn thành. Với Trưởng phòng: D = Trưởng phòng/Khu, G = Có nếu được phép quản trị.
7. Không sử dụng vai trò `Quản trị viên` tại cột D chỉ nhằm cấp quyền quản trị cho nhân viên; hãy dùng cột G để tách riêng.
8. Bấm **Lưu** trong Sheets (Google Sheets tự động lưu). Không cần deploy lại Apps Script chỉ vì đổi G.
9. Cấu hình và thử với một số tài khoản trước khi mở cho toàn đơn vị.

### Trường hợp quyền quản trị cũ

- Nếu D vẫn là `Quản trị viên` và G để trống, code giữ quyền quản trị cũ để tránh mất truy cập trong thời gian chuyển đổi.
- Nếu G ghi rõ `Không`, backend từ chối quyền xem thống kê kể cả D đang là `Quản trị viên`.
- Khi chuyển D của tài khoản từ `Quản trị viên` sang `Nhân viên`, cần điền E đúng Phòng/Khu và G = `Có` nếu muốn giữ quyền quản trị.

## 5. Triển khai giao diện

Cập nhật đúng file thay đổi trên GitHub, bảo đảm Vercel build/deploy thành công. Trang mới dùng `/app.js?v=1.8.0` và `/styles.css?v=1.8.0`. Tải lại PWA/Chrome khi cần. **Không cập nhật Chrome Extension** cho v1.8.0, vì tiện ích v1.7.0 không thay đổi.

Mục `Nhân viên đã hoàn thành` vẫn tồn tại để Trưởng phòng xóa thông báo. Khung hướng dẫn kỹ thuật lớn đã bỏ; thanh đề nghị bật thông báo chỉ hiện nếu thiết bị chưa đăng ký hợp lệ. Người dùng phải cấp quyền thông báo theo yêu cầu trình duyệt khi cần.

## 6. Cấu hình lịch nhắc hằng ngày (sau khi quyết định thời gian)

**KHÔNG làm bước này trước khi chọn giờ.** Khi đã chốt giờ nhắc (ví dụ **HH:mm** do người quản trị quyết định):

1. Apps Script → **Cài đặt dự án → Thuộc tính tập lệnh → Chỉnh sửa**.
2. Thêm thuộc tính `MANAGER_REMINDER_TIME` và giá trị dạng `HH:mm` 24 giờ, giờ Việt Nam. Không có giá trị mặc định.
3. Lưu. Hàm trigger hằng giờ hiện tại sẽ tự đọc cấu hình; không cần tạo trigger mới hoặc deploy chỉ vì thay Script Properties.
4. Thử với tài khoản Trưởng phòng và một thông báo chưa xóa. Nếu nhân viên hoàn thành trong ngày X thì gửi lần đầu ngay; bắt đầu nhắc lại từ ngày X+1 sau giờ cấu hình, mỗi ngày tối đa một lượt gửi của chính thông báo đó.
5. Nếu Trưởng phòng xóa thông báo, các lần nhắc tương lai dừng lại. Push đã được OneSignal chấp nhận trước khi xóa không thể thu hồi chắc chắn.

**Lưu ý:** Trigger đang chạy hằng giờ; ví dụ đặt 07:30 thì lượt chạy tiếp theo sau 07:30 mới gửi (có thể gần 08:00 hoặc muộn nếu bị nghẽn/hạn mức). Không thể bảo đảm thời điểm thực nhận tại thiết bị.

## 7. Kiểm thử bắt buộc trên hệ thống thật

- Tài khoản nhân viên D = `Nhân viên`, G = `Có` đăng nhập → nhìn thấy nút/bảng Tổng quan → xem được thống kê.
- Tài khoản nhân viên D = `Nhân viên`, G = `Không` không được truy cập thống kê, kể cả khi tự gọi API.
- Nhân viên kiêm quản trị xóa công việc với lựa chọn **Đã hoàn thành** → Trưởng phòng đúng Phòng/Khu nhận một thông báo; không gửi nhầm.
- Trưởng phòng G = `Có` vẫn nhận thông báo của nhân viên.
- Phó Trưởng phòng G = `Có` không tự trở thành Trưởng phòng.
- Sau khi cấu hình giờ: không xóa thông báo trong ngày N → từ ngày sau nhận tối đa một lượt mỗi ngày cho cùng thông báo; xóa trước lượt nhắc → không còn nhắc mới.
- Kiểm tra máy tính/PWA/mobile, nhắc hạn 4 mốc, Google Sign-In, Chrome Extension iCPV và các công việc cũ còn nguyên.

## 8. Khôi phục phiên bản cũ

1. Dừng thử nghiệm với nhóm tài khoản và **bỏ/để trống `MANAGER_REMINDER_TIME`** nếu vừa kích hoạt nhắc hằng ngày.
2. Khôi phục `Code.gs` v1.7.0 HOTFIX từ bản sao lưu; triển khai **phiên bản mới** lên đúng deployment cũ. Khôi phục giao diện GitHub/Vercel bằng commit trước đó.
3. Không xóa `State`, `Tài khoản`, `Quản lý Phòng-Khu` hay cột G. Code cũ không dùng cột G nên dữ liệu đó có thể giữ để đối chiếu.
4. Nếu đã đổi D của một tài khoản từ `Quản trị viên` sang `Nhân viên`, muốn rollback quyền thống kê cũ thì phải xem lại vai trò đó sau khi khôi phục (tránh thay đổi trước khi có kế hoạch rollback).

## 9. Hạn chế và phạm vi nghiệm thu

- Việc gửi OneSignal tự động và nhắc lịch thực tế **chưa được kiểm chứng trên thiết bị đang hoạt động của Trung tâm**. Kiểm thử tự động chỉ mô phỏng một số tình huống nghiệp vụ.
- Một OneSignal App có thể phục vụ nhiều tài khoản; tải gửi lại thực tế còn phụ thuộc giới hạn Apps Script/OneSignal và số thông báo chưa xử lý.
- Việc đặt giờ hằng ngày **chưa được người dùng chốt**, nên tính năng nhắc lại sẽ tạm chưa hoạt động đến khi cấu hình.
- Không tự sửa source iCPV; không thay đổi Google Sheets hay production trong quá trình tạo gói mã nguồn.
