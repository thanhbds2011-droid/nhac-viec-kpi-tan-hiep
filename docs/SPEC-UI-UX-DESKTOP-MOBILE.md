# SPEC UI/UX – NHẮC VIỆC KPI TÂN HIỆP – V1.1.0

**Mục tiêu:** Giao diện tối giản để mỗi viên chức đăng nhập, đăng ký nhiều công việc, chọn ngày đến hạn + giờ nhắc, xem/sửa/xóa và theo dõi trạng thái thông báo. Không biến ứng dụng thành dashboard thống kê hay phần mềm chấm KPI.

## 1. Quy tắc nội dung

- Tiêu đề chính **NHẮC VIỆC KPI** chỉ hiển thị **một lần**, trên header.
- Tên đơn vị chỉ hiển thị dưới thương hiệu, không lặp trong các thẻ nội dung.
- Hai mục công việc: **Thêm công việc** và **Công việc của tôi**; khi sửa đổi thành **Sửa công việc**.
- Hạn chế các dòng mô tả dài, nhãn trùng lặp và thẻ thống kê không liên quan.
- Chỉ một con số **việc đang theo dõi**; không có dashboard KPI/biểu đồ.

## 2. Desktop (>720px)

- Header gọn; thương hiệu bên trái, Đăng xuất bên phải.
- Khối chào và số việc trên một hàng, kế tiếp là dải trạng thái OneSignal ngắn.
- Hai cột: trái **form**, phải **danh sách**, nhìn đồng thời.
- Form: Tên → Ngày đến hạn + Giờ nhắc → 4 mốc lịch trực quan → nút Lưu.
- Giờ mặc định trong mục thu gọn, giảm chiều cao form.
- Thẻ công việc: tên, hạn, giờ, trạng thái, nút Sửa/Xóa có chữ và xác nhận trước khi xóa.

## 3. Mobile (<=720px)

- Header rút gọn, không lặp tên ở thân trang.
- Chào/tổng việc và trạng thái thông báo ngắn.
- Điều hướng **Đăng ký** | **Danh sách**; mỗi lần chỉ hiện một nội dung để không phải cuộn qua form trước khi xem danh sách.
- Nhấn Sửa một việc → tự mở mục Thêm việc với tiêu đề Sửa công việc và giá trị có sẵn.
- Lưu thành công → tự chuyển qua Công việc của tôi.
- Nút tối thiểu 39–44px; trong mobile nhỏ ngày và giờ xếp dọc, không tràn.

## 4. Trạng thái và thông báo

- OneSignal: trạng thái chỉ xác nhận subscription trên thiết bị; không tuyên bố thông báo đã giao thực tế.
- Lịch nhắc 4 lượt: trước hạn 3/2/1 ngày và ngày đến hạn, tính ngày dương lịch, kể cả thứ Bảy/Chủ nhật/ngày lễ.
- Ngày đã qua sẽ **không gửi bù**; preview chỉ hiển thị 4 mốc lý thuyết.
- Không gửi toàn bộ 140 người; thiết bị chỉ nhận lịch thuộc External ID của tài khoản.
- Tên và dữ liệu được render bằng `textContent` (không HTML injection).

## 5. Đảm bảo không ảnh hưởng production

- Không thay đổi backend `/api/data`, `/api/config`, Apps Script, Sheets, OneSignal API hay quy tắc lưu dữ liệu.
- Không cần tạo lại các khóa hoặc cấu hình dịch vụ.
- UI chỉ thực hiện yêu cầu API `load`, `save`, `remove`, `setDefaultTime`, `sync` như trước; không polling.
- Không tạo trigger mới; không có việc đọc bổ sung khi chuyển tab trên mobile.

## 6. Nghiệm thu

1. Desktop hiển thị song song form/danh sách, header có một thương hiệu.
2. Mobile có hai mục điều hướng; chuyển mục không gọi API mới.
3. Form tính ngày nhắc đúng cả khi chuyển tháng/năm.
4. Tạo/sửa/xóa và giờ mặc định sử dụng API hiện có; sau Lưu danh sách cập nhật.
5. Bật/kiểm tra OneSignal không thay đổi logic External ID; thử trên thiết bị thật trước khi thông báo ứng dụng hoạt động chính thức.
6. Trên màn hình 320/375/768/1440px không tràn ngang, nút rõ và chữ dễ đọc.
