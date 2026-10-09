# Nhắc việc KPI – Tân Hiệp v1.5.0

**Ngày:** 09/10/2026  
**Nguồn:** ZIP v1.4.1 do người dùng cung cấp + Apps Script v1.4.0.  
**Phạm vi:** YC-007, YC-008 phương án A đã đơn giản hóa, YC-009, YC-010 (chuẩn bị kiểm thử), YC-012, YC-013, YC-014.  
**Không triển khai:** YC-011 tự phát hiện iCPV không cần bấm (còn nghiên cứu và cần quyền sử dụng dữ liệu).

## 1. Những gì đã thay đổi

- iCPV: sau mỗi lượt đồng bộ, chỉ đề xuất những việc chưa có; việc nhập lại không sinh bản sao. Nhiệm vụ chưa nhập được do hạn sai/quá hạn có thể nhập khi nguồn được sửa. Nếu cùng nguồn đã nhập nhưng hạn khác thì **không ghi đè**; hiển thị để người dùng tự kiểm tra. Không khôi phục tự động nguồn đã xóa (dấu nguồn được lưu riêng).
- Nhân viên: xác nhận **Đã hoàn thành, xóa** sau khi hoàn tất việc trên iCPV. Hủy các thông báo nhắc còn lại, lưu sự kiện và chuyển thông tin sang hộp thư của Trưởng phòng được cấu hình. Chọn **Xóa do nhập nhầm** để xóa mà không báo Trưởng phòng.
- Trưởng phòng: xem mục **Thông báo → Nhân viên đã hoàn thành**, xóa từng thông báo sau khi xử lý. Push gửi đến External ID riêng (OneSignal App cũ). Nếu không đăng ký Web Push, thông báo vẫn được giữ trong ứng dụng sau khi đăng nhập.
- Quản trị: tài khoản có `Role = ADMIN` trên Access xem **Tổng quan quản trị**: số tài khoản Access duy nhất, tổng đầu việc tính lũy kế từ dữ liệu còn lưu và các đầu việc tạo tiếp theo. Không cho phép quản trị xem chi tiết nhiệm vụ cá nhân.
- Không thêm tab Google Sheets. Các trường kỹ thuật mới được lưu *bên trong JSON State hiện có*, không reset dữ liệu cũ.
- Bổ sung dự phòng an toàn: giao diện **cũ** không gửi `mode=completed` sẽ xóa theo hành vi cũ, không phát thông báo hoàn thành. Chỉ giao diện v1.5.0 xác nhận hoàn thành mới tạo sự kiện.

## 2. Điều kiện bắt buộc: xác định Trưởng phòng

**Không thể đoán đúng Trưởng phòng chỉ từ Gmail hoặc OneSignal.** Trước khi bật chức năng mới cho nhân viên, quản trị viên cần khai báo mối quan hệ trên Google Sheets **Access**.

Cách đề xuất: thêm **cột E** vào tab `Access` hiện hữu bằng thao tác **thủ công của quản trị viên**, đặt tiêu đề `Email Trưởng phòng`. *Bản code không tự thêm cột này; yêu cầu phê duyệt thay đổi bảng Access trước khi áp dụng trên production.*

| A: Email | B: Họ tên | C: Active | D: Role | E: Email Trưởng phòng |
|---|---|---|---|---|
| a@example.com | Nhân viên A | YES | EMPLOYEE | b@example.com |
| b@example.com | Trưởng phòng B | YES | MANAGER | *(để trống)* |
| c@example.com | Nhân viên C | YES | EMPLOYEE | d@example.com |
| d@example.com | Trưởng phòng D | YES | MANAGER | *(để trống)* |
| root@example.com | Quản trị viên | YES | ADMIN | *(để trống)* |

Các địa chỉ ví dụ trên **không phải địa chỉ thật** và không được sao chép nguyên vào production. Chỉ sử dụng các tài khoản thực tế được cơ quan cho phép. Cột E của Trưởng phòng và quản trị viên nên để trống để không phát sinh chuỗi thông báo. Các vai trò được nhận diện không gửi lên cấp trên gồm `MANAGER`, `TRƯỞNG PHÒNG`, `TRUONG PHONG`, `ADMIN` và biến thể liên quan trong code; muốn truy cập quản trị, `Role` phải là `ADMIN` hoặc một cách ghi quản trị được hỗ trợ.

Nếu chưa khai báo cột E hoặc E trống, người dùng vẫn có thể xóa công việc nhưng ứng dụng **không gửi thông báo cho người quản lý**; sẽ hiển thị cảnh báo, không tự chọn người nhận. Khi đổi Trưởng phòng, chỉnh cột E đúng người mới; các sự kiện còn đợi sẽ chuyển theo người quản lý hiện hành.

Trưởng phòng phải từng đăng nhập ứng dụng trước khi Push có thể gửi thành công đến các thiết bị đã đăng ký. Nếu Trưởng phòng chưa từng đăng nhập, sự kiện nhân viên hoàn thành được giữ tại hộp thư đi của nhân viên và chuyển khi Trưởng phòng đăng nhập lần đầu (trong trường hợp quan hệ quản lý vẫn hợp lệ).

## 3. Cách cập nhật an toàn – đúng thứ tự

**Không làm bất cứ bước nào khi chưa sao lưu và chưa được phép cấu hình quan hệ quản lý.**

1. **Sao lưu:** xuất bản sao Google Sheets Access/State, tải mã nguồn GitHub v1.4.1, lưu bản Apps Script trước thay đổi; ghi lại deployment Apps Script hiện hành, Vercel environment variable names và OneSignal App ID (không chia sẻ giá trị khóa mật với bên ngoài).
2. **Xác nhận cột E:** kiểm tra cấu trúc Access, sau khi được đồng ý mới thêm cột E thủ công và điền địa chỉ Trưởng phòng phù hợp. Không thay 4 cột cũ.
3. **Apps Script:** mở đúng dự án Script hiện tại; thay hoàn toàn `Code.gs` bằng file v1.5.0; vào `Deploy → Manage deployments → Edit → New version → Deploy` để giữ URL `/exec` đang dùng. Không tạo Google Sheets mới, không xóa trigger hiện hành, không đổi Script Properties. Không cần chạy lại `setupProject()` nếu trigger hằng giờ đã tồn tại.
4. **GitHub:** trong repository cũ, thay đúng các file trong ZIP *chỉ file thay đổi*. Bản full ZIP dùng tham chiếu/sao lưu, không tải toàn bộ `.git` cũ lên. Commit vào nhánh main để Vercel tự deploy.
5. **Kiểm tra Vercel Ready:** làm mới website để chắc chắn JS/CSS `v=1.5.0`; kiểm tra quyền đăng nhập cũ, nút bật Web Push và lịch nhắc bốn mốc.
6. **Nghiệm thu từng cặp thử:** chọn nhân viên A và Trưởng phòng B trong nhóm người dùng thử; kiểm tra A xóa một **nhiệm vụ thử** bằng nút *Đã hoàn thành, xóa*. Xác nhận B nhận 1 thông báo trong ứng dụng, và trên thiết bị nếu đã cho phép nhận Push. B xóa thông báo, tải lại vẫn không xuất hiện. Sau đó thử nhân viên C → Trưởng phòng D riêng.
7. **Kiểm thử iCPV có phép:** sử dụng danh sách đã được cho phép chuyển; thử 9 việc/8 thành công/1 sai hạn; chỉnh đúng hạn nguồn, kiểm tra nhập thêm 1 mà không thay 8 việc cũ. Kiểm tra tình huống hạn nguồn đổi và tên trùng.
8. **Kiểm thử quản trị:** đúng tài khoản `Role=ADMIN` thấy chỉ số; tài khoản nhân viên gọi API `adminStats` bị từ chối.

## 4. Giới hạn và các điểm cần kiểm chứng

- Bộ mã đã kiểm thử **cú pháp và các bài kiểm thử mô phỏng**. Chưa có quyền truy cập Sheets/Apps Script/OneSignal production trong lượt này nên **chưa thể tuyên bố nghiệm thu Push thật, số liệu thật hoặc tải 140 tài khoản**.
- Thống kê `totalCreated` chỉ biết chính xác dữ liệu còn lưu ở thời điểm nâng cấp và việc tạo mới về sau. Công việc đã bị trigger dọn bỏ khỏi State trước khi nâng cấp không thể đếm ngược chính xác.
- Theo thuật toán iCPV hiện hữu, các nhiệm vụ trùng tên nguyên gốc hoặc đổi tên có thể không có mã nguồn ổn định để tự đối chiếu chắc chắn; các dòng không chắc chắn phải được kiểm tra thủ công, không tự gộp.
- Google Sheets State dùng giới hạn `MAX_JSON_CHARS=45000` mỗi tài khoản. Nếu hộp thư Trưởng phòng tăng quá lớn, thao tác chuyển tin có thể tạm thất bại; hộp thư đi của nhân viên vẫn giữ sự kiện để thử lại, không được cho là đã Push thành công. Quản trị cần theo dõi tải trước khi mở rộng 140 người.
- Các chính sách dọn dữ liệu khi vô hiệu hóa Access và các vấn đề ngoài phạm vi đã chốt vẫn giữ nguyên để tránh thay đổi nghiệp vụ khác; cần có quyết định riêng nếu muốn điều chỉnh.
- Máy tính/iPhone nhận Push còn phụ thuộc trình duyệt, quyền thông báo, trạng thái dịch vụ, internet và đăng ký thiết bị. Một OneSignal App dùng chung nhiều người là hợp lệ, nhưng không bảo đảm 100% Push đã hiển thị trên mọi thiết bị.
- **Đồng bộ iCPV hoàn toàn tự động khi website Thành ủy đóng** chưa được triển khai; Chrome Extension vẫn là quy trình đồng bộ có xác nhận, không truy cập API/cookie/token iCPV ngoài quyền cho phép.

## 5. Khôi phục khi phát sinh lỗi

1. Ngừng đưa thêm người dùng vào thử nghiệm và giữ nguyên Google Sheets hiện tại.
2. Khôi phục mã nguồn GitHub v1.4.1 và đợi Vercel báo Ready.
3. Mở **Manage deployments** Apps Script, chuyển về phiên bản trước của cùng deployment (tránh đổi URL `/exec`).
4. Nếu đã có dữ liệu mới trong State, **không ghi đè toàn bộ State bằng bản sao cũ**, vì sẽ làm mất những thay đổi xảy ra sau sao lưu; chỉ khôi phục dữ liệu từ bản sao khi đã đối chiếu và có phê duyệt.
5. Trước khi khôi phục production, phải biết rằng thông báo đã được OneSignal chấp nhận không nhất thiết có thể thu hồi sau khi gửi. Kiểm tra các sự kiện đang chờ để tránh gửi lặp.

**Lưu ý:** Bản ZIP không chứa các khóa bí mật, không tạo bản triển khai Google Apps Script, không chỉnh sửa GitHub/Vercel/OneSignal đang hoạt động. Việc đưa vào production cần người sở hữu hệ thống thực hiện và xác nhận từng giai đoạn.
