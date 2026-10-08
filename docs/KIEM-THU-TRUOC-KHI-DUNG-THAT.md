# Kiểm thử nghiệm thu trước khi mở cho 140 viên chức

Dùng 3 tài khoản A, B, C **thật**, 2–3 thiết bị thật và một ngày đến hạn trong tương lai gần.

| STT | Tình huống | Kết quả kỳ vọng |
|---|---|---|
| 1 | Email chưa có trong Access | Không truy cập được dữ liệu |
| 2 | Email trong Access nhưng Active=NO | Không truy cập |
| 3 | A đăng ký 5 công việc, B 2 công việc | A chỉ thấy 5; B chỉ thấy 2 |
| 4 | A đăng ký công việc hạn thứ Ba 15/12/2026 | Nhắc 12,13,14,15 (4 lượt) |
| 5 | Thứ Bảy, Chủ nhật, ngày 01/01 | Không bị loại khỏi tính lịch |
| 6 | A chọn 07:30, B chọn 20:15 | Đúng giờ từng người theo VN |
| 7 | A đóng tab sau khi bật push | A vẫn nhận trên thiết bị hợp lệ |
| 8 | Đăng xuất A trên máy dùng chung | Không tiếp tục nhận thông báo nhắm A trên máy đó |
| 9 | Sửa giờ/đổi hạn việc của A | Lịch cũ được hủy, lịch mới được tạo, không nhắc lặp |
| 10 | Xóa việc trước hạn | Không nhận tiếp các thông báo đã hủy |
| 11 | A có nhiều việc trùng ngày/giờ | Các việc được nhắc riêng, không gộp sai |
| 12 | B nhận thông báo | Không thấy tên việc của A |
| 13 | Một API request lưu bị timeout | Mở lại để xác định việc đã lưu chưa; không bấm lưu liên tục |
| 14 | OneSignal chưa bật trên trình duyệt | Trạng thái ứng dụng cảnh báo, có thể bật lại |
| 15 | Tài khoản bị khóa sau khi có lịch | Trigger bắt đầu hủy các lịch tương lai của người đó |
| 16 | Việc đăng ký quá 7 ngày | Được lưu, OneSignal được lập lịch khi sắp tới hạn |

## Kiểm thử kỹ thuật tự động

Nếu máy có Node.js, trong thư mục gốc dự án chạy:

```bash
npm test
npm run check
```

Phần test không cần khóa thật và không gửi push ra môi trường OneSignal. Test code ngày/giờ dùng đúng giờ Việt Nam và cả trường hợp giao thừa. **Phải thử thực tế** OneSignal, Google Login, Vercel, Apps Script sau khi khai báo cấu hình.

## Các lỗi thường gặp

**Google Login không hiện:** kiểm tra Client ID đã thêm Vercel domain vào JavaScript origins; một số trình duyệt hoặc extension chặn GIS. Xem Console trong Developer Tools nếu cần.

**Đăng nhập báo không có quyền:** kiểm tra đúng email tại tab Access và Active=YES.

**Apps Script trả HTML:** kiểm tra đúng deployment Web app mới nhất, địa chỉ `/exec`, quyền truy cập Anyone, Execute as Me.

**Có thông báo đã đăng ký nhưng không nhận:** trên thiết bị cần bật Web Push; nếu OneSignal chưa nhận subscription, vào app bấm **Bật thông báo/kiểm tra lại** để yêu cầu đồng bộ lại. Kiểm tra OneSignal dashboard và Apps Script Executions.

**Giờ gửi chậm/không chính xác tuyệt đối:** web push phụ thuộc OneSignal, mạng, thiết bị, hệ điều hành, chế độ tiết kiệm pin. Apps Script trigger chỉ lập lịch trước, không phải đồng hồ bấm chuông theo phút.

**Sửa công việc mà vẫn nhận lịch cũ:** kiểm tra Apps Script Executions và phần cảnh báo lịch chưa được hủy. Không coi các lệnh hủy đã hoàn thành nếu API OneSignal trả lỗi; trước khi mở rộng cần thử thực tế.

**Quản trị viên đổi tên miền:** subscriber của domain cũ không tự đồng bộ sang domain mới. Người dùng phải bật lại push trên domain mới.
