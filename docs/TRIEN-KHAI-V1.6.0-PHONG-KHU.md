# NHẮC VIỆC KPI – TÂN HIỆP | HƯỚNG DẪN V1.6.0

**Ngày:** 09/10/2026  
**Nguồn:** v1.5.0 đã bàn giao; chỉ triển khai YC-015 (một Trưởng phòng/Khu quản lý nhiều nhân viên) và YC-016 (bảng quản trị tiếng Việt).  
**Không sửa:** nhắc hạn 3/2/1/0 ngày, OneSignal App ID, mã nguồn Chrome Extension, phân quyền đăng nhập Google, API Vercel, dữ liệu `State`, chức năng đồng bộ iCPV hoặc cấu trúc nhiệm vụ.

## A. Điều quan trọng nhất – chuyển đổi hai giai đoạn

Bản v1.6.0 **mặc định vẫn dùng `Access` cũ** sau khi cập nhật Apps Script. Không tự đổi dữ liệu/quyền khi deploy. Chỉ khi quản trị viên chạy **`activateVietnameseAdminSheets`** sau khi cấu hình hợp lệ thì bắt đầu dùng bảng tiếng Việt.

Hai tab mới **được tạo từ hàm chuẩn bị do quản trị viên chủ động chạy**, không tự tạo khi deploy:

- `Tài khoản`: một tài khoản một dòng; cột A **Email đăng nhập**; B **Họ và tên**; C **Trạng thái** (*Hoạt động* / *Ngừng hoạt động*); D **Vai trò** (*Nhân viên*, *Phó Trưởng phòng/Khu*, *Trưởng phòng/Khu*, *Quản trị viên*); E **Mã Phòng/Khu**; F **Email quản lý cũ (đối chiếu)** (được ẩn, chỉ lưu để tra cứu, không dùng gửi thông báo).
- `Quản lý Phòng-Khu`: một dòng cho một Phòng/Khu; cột A **Mã Phòng/Khu**, B **Tên Phòng/Khu**, C **Email Trưởng phòng/Khu**, D **Email Phó thứ nhất** (tùy chọn), E **Email Phó thứ hai** (tùy chọn).
- `State` vẫn nguyên vẹn. `Access` cũ vẫn tồn tại làm **bản dự phòng, ẩn sau khi kích hoạt**, nên có tổng cộng 4 tab dữ liệu và thường 3 tab nhìn thấy. Đây là lựa chọn an toàn để không xóa bản gốc khi chuyển đổi.

> Google Sheets dùng tên thực tế `Quản lý Phòng-Khu` (dấu gạch nối thay cho dấu `/`); chức năng vẫn đúng ý “Quản lý Phòng/Khu”.

**Một mã Phòng/Khu không được trùng.** Mỗi người được chọn một mã Phòng/Khu. Mỗi Phòng/Khu nhập email Trưởng phòng **một lần**, không lặp cho 5–30 nhân viên. Hai Phó Trưởng phòng là tùy chọn; họ **không tự động là người nhận thông báo**. Một Phó Trưởng phòng có thể báo hoàn thành lên Trưởng phòng; Trưởng phòng xóa nhiệm vụ cá nhân không tự tạo thông báo lên cấp khác.

## B. Trước khi bắt đầu

1. Tải bản sao của **toàn bộ Google Sheets** và sao lưu `Code.gs` / bản GitHub đang chạy. Không gửi cho bất kỳ ai mã bí mật từ Script Properties/Vercel/OneSignal.
2. Xác nhận bạn đang dùng đúng file Sheets chứa tab `Access` và `State`. Không tạo file Sheets mới.
3. Mỗi tài khoản Trưởng phòng/Khu phải có **một dòng email riêng**, được bật hoạt động và có vai trò **Trưởng phòng/Khu**. Người quản trị có thể giữ vai trò **Quản trị viên** và không cần chọn Phòng/Khu.
4. Không tự đổi tên hoặc xóa `Access`, không chỉnh sửa `State`, không xóa trigger `syncScheduledNotifications`.

## C. Triển khai theo thứ tự

### Giai đoạn 1 – Đưa code lên hệ thống nhưng vẫn đọc Access cũ

1. Mở dự án Apps Script **hiện hữu**, thay toàn bộ `Code.gs` bằng `apps-script/Code.gs` từ bộ v1.6.0.
2. Bấm **Lưu**, vào **Deploy → Manage deployments → Edit (biểu tượng bút) → New version → Deploy** để giữ URL `/exec` đang sử dụng. Không tạo deployment hoàn toàn mới.
3. Nếu trigger `syncScheduledNotifications` đã có thì **không chạy lại `setupProject()`** và không tạo thêm trigger. Nếu trigger bị thiếu, cần kiểm tra tình trạng trước khi tạo lại.
4. Lúc này chưa cần cập nhật GitHub: website v1.5.0 vẫn hoạt động với backend mới ở chế độ `LEGACY` (mặc định).

### Giai đoạn 2 – Chuẩn bị bảng tiếng Việt (chưa kích hoạt)

1. Trong Apps Script, chọn hàm **`prepareVietnameseAdminSheets`** rồi nhấn **Run** một lần. Cấp quyền Google nếu Apps Script yêu cầu.
2. Kiểm tra 2 tab tiếng Việt vừa được tạo. Dữ liệu A–D được sao chép từ `Access`; cột E để trống để **bạn chọn mã Phòng/Khu**; cột F giữ email Trưởng phòng của bản cũ để đối chiếu.
3. Trong tab **Quản lý Phòng-Khu**, điền **mỗi Phòng/Khu một dòng**, ví dụ mã minh họa: `TCHC`, `KHTC`, `CTXH`, `YT`, `KI`, `KII`, `KIII`. Chọn mã và tên đơn vị **đúng cơ cấu đang áp dụng**, đây chỉ là ví dụ – code không có danh mục hard-code.
4. Tại cột C nhập email Trưởng phòng/Khu **đã có ở cột A tab Tài khoản**. Phó thứ nhất/thứ hai điền nếu cần (cũng phải đăng ký tài khoản và đúng vai trò Phó Trưởng phòng/Khu).
5. Trở lại **Tài khoản**, tại cột E chọn mã Phòng/Khu tương ứng cho từng nhân viên, Phó Trưởng phòng, Trưởng phòng. Quản trị viên độc lập có thể để trống Phòng/Khu. Email cũ ở cột F **không còn là nơi khai báo người nhận**.
6. Không tự chỉnh sửa `State` và không thay dữ liệu `Access` cũ khi đang chuẩn bị.

**Quy tắc:** Chỉ email Trưởng phòng/Khu trong cột C của tab quản lý mới nhận thông báo hoàn thành. Một Trưởng phòng nhận từ tất cả tài khoản cấp dưới cùng mã Phòng/Khu. Nếu Trưởng phòng nghỉ/đổi, cập nhật email ở một dòng và điều chỉnh vai trò nếu cần; thông báo cũ đã chuyển tới tài khoản trước vẫn giữ nguyên.

### Giai đoạn 3 – Kiểm tra rồi mới kích hoạt

1. Chạy hàm **`inspectVietnameseAdminSheets`** trong Apps Script. Xem **Execution log** để đọc toàn bộ lỗi tiếng Việt (hoặc hộp thoại nếu Script gắn trực tiếp với Sheets).
2. Nếu không có lỗi, chạy **`activateVietnameseAdminSheets`** đúng **một lần**. Hàm này kiểm tra lại trong khóa xử lý rồi đặt Script Property `ACCOUNT_SCHEMA = VI`, ẩn Access dự phòng và bật cảnh báo trước khi chỉnh sửa `State` (nếu có quyền). **Không ghi lại JSON State**.
3. Nếu còn lỗi, hàm **từ chối kích hoạt**, hệ thống vẫn dùng `Access` cũ; chỉnh sửa tab tiếng Việt rồi kiểm tra lại.
4. **Chỉ sau đó**, cập nhật GitHub đúng các file trong ZIP thay đổi, đợi Vercel báo Ready và xác nhận giao diện phiên bản v1.6.0. Nội dung frontend vẫn giữ nguyên chức năng v1.5.0.

**Nếu Apps Script gắn trực tiếp với Sheets**, có thể thấy menu **Nhắc việc KPI** trên Google Sheets để chạy các hàm. Nếu là dự án Script độc lập thì có thể không có menu; hãy chọn tên hàm và Run trong trình biên tập Apps Script.

## D. Nguyên tắc kiểm soát lỗi và an toàn

- **Không gửi nhầm:** Nếu mã Phòng/Khu bị trùng, trưởng phòng không có trong danh sách, bị ngừng hoạt động, vai trò không đúng hoặc không thuộc chính Phòng/Khu đó, hệ thống **không gán người nhận**; người dùng được cảnh báo trong thao tác xóa. Không đoán email quản lý.
- **Tài khoản trùng:** Nếu phát sinh hai dòng trùng email trong bảng tiếng Việt, backend từ chối đăng nhập email đó đến khi quản trị sửa xong.
- **Phó Trưởng phòng:** Không được nhận diện nhầm là Trưởng phòng chỉ do chứa từ “Trưởng”. Các mã kỹ thuật cũ `USER`, `EMPLOYEE`, `MANAGER`, `ADMIN` vẫn tương thích trong `Access` cũ; dữ liệu ở bảng mới dùng tên vai trò tiếng Việt.
- **Trạng thái:** Bảng tiếng Việt sử dụng `Hoạt động` hoặc `Ngừng hoạt động`, không yêu cầu nhập `YES` ở bảng mới.
- **State:** Được giữ nguyên; cảnh báo chỉnh sửa trên tab `State` không thay thế việc quản lý quyền chia sẻ Google Sheets. Không cung cấp quyền chỉnh sửa database cho người không có nhiệm vụ quản trị.
- **Lịch sử:** Sự kiện đã đến Trưởng phòng cũ **không chuyển đi hoặc bị xóa** khi thay đổi Trưởng phòng. Sự kiện hoàn thành đang chờ chuyển sẽ được kiểm tra theo quan hệ hiện hành.

## E. Kiểm thử nghiệm thu thực tế – theo nhóm 8 người trước

1. Đăng nhập bằng **nhân viên TCHC**; xóa một nhiệm vụ **thử nghiệm** bằng lựa chọn *Đã hoàn thành, xóa*; xác nhận đúng tài khoản Trưởng phòng TCHC nhận 1 thông báo trong ứng dụng.
2. Kiểm tra **Trưởng phòng KHTC** không nhận thông báo thử của TCHC.
3. Dùng một **nhân viên KHTC** hoàn thành nhiệm vụ thử; kiểm tra Trưởng phòng KHTC nhận riêng.
4. Phó Trưởng phòng TCHC xác nhận hoàn thành một nhiệm vụ thử; kiểm tra Trưởng phòng TCHC nhận thông báo đúng và Phó Trưởng phòng không bị xem là Trưởng phòng.
5. Trưởng phòng xóa thông báo đã xử lý, tải lại vẫn không xuất hiện.
6. Kiểm tra nút *Xóa do nhập nhầm* không gửi thông báo hoàn thành.
7. Xác nhận bảng thống kê quản trị và các quyền đăng nhập thông thường hoạt động như trước.
8. Thử bốn mốc nhắc hạn và một thông báo Push trên thiết bị thực tế có đăng ký; không coi bài kiểm thử mô phỏng là đã nghiệm thu máy tính/iPhone.
9. Sau khi nhóm nhỏ đạt, mới điền các Phòng/Khu còn lại và mở rộng người dùng. Để kích hoạt, các tài khoản hoạt động đã có trong danh sách phải được phân đúng Phòng/Khu và người quản lý hợp lệ.

## F. Khôi phục

**Trường hợp cấu hình mới sai và cần quay về đọc Access cũ (không reset State):**

1. Trong Apps Script v1.6.0, chạy **`rollbackVietnameseAdminSheets`**. Hàm đưa `ACCOUNT_SCHEMA` về `LEGACY` và hiện lại tab Access. Dữ liệu `State` không thay đổi.
2. Kiểm tra lại đăng nhập và thông báo của nhóm thử.
3. Nếu cần quay về chính code v1.5.0, triển khai lại phiên bản trước của cùng Apps Script deployment và commit GitHub cũ. Khôi phục có kiểm tra, không xóa dữ liệu mới phát sinh.

**Quan trọng:** Các chỉnh sửa tài khoản chỉ thực hiện trong tab `Tài khoản` **sau khi kích hoạt** sẽ không tự sao chép về `Access` dự phòng. Khi rollback, phải đối chiếu những chỉnh sửa này trước. Không chép đè `State` bằng bản sao cũ vì có thể mất các nhiệm vụ/thông báo mới.

## G. Những file thay đổi v1.6.0

- `apps-script/Code.gs`: đọc schema tiếng Việt, phân quyền theo đơn vị, xác thực vai trò rõ ràng; các hàm chuẩn bị/kiểm tra/kích hoạt/khôi phục và định dạng Google Sheets.
- `tests/v160-departments.test.js`: kiểm thử độc lập schema, role, 30 nhân viên, nhiều đơn vị, đổi quản lý, lỗi và luồng thông báo.
- `package.json`: tăng phiên bản.
- `public/index.html`: đổi nhãn/cache phiên bản, không đổi nghiệp vụ.
- `README.md`, `docs/TRIEN-KHAI-V1.6.0-PHONG-KHU.md`, `DANH-SACH-THAY-DOI.txt`: hướng dẫn và lịch sử.

**Chưa tự cập nhật GitHub, Vercel, Apps Script hoặc Google Sheets production. Không cần thay OneSignal App ID hay Vercel environment variables.**
