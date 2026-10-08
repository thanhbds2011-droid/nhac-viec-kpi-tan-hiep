# ĐẶC TẢ CHỐT – NHẮC VIỆC KPI TÂN HIỆP

Ngày chốt: 08/10/2026.

**Mục tiêu:** nhắc việc KPI cá nhân cho khoảng 140 viên chức, đơn giản, nhanh, không cần mở ứng dụng hằng ngày; không lưu minh chứng hoặc sao chép nghiệp vụ KPI.

**Bộ nền tảng:** GitHub → Vercel (Web + API Node xác thực Google) → Apps Script/Google Sheets → OneSignal Web Push (một App ID duy nhất).

**Lịch thông báo:** Nhiều việc trên mỗi tài khoản. Mỗi việc tối đa 4 lượt theo ngày dương lịch: hạn-3, hạn-2, hạn-1, đúng hạn. Tính cả thứ Bảy, Chủ nhật, ngày nghỉ lễ và Tết, không dùng lịch làm việc. Người dùng chọn giờ HH:mm theo `Asia/Ho_Chi_Minh`, có thể chọn giờ khác nhau cho từng việc. Ví dụ hạn 15/12/2026 07:30 → 12, 13, 14, 15/12/2026 07:30.

**Chỉ đúng người:** máy chủ xác thực Google, kiểm tra whitelist và dùng OneSignal `include_aliases.external_id` chỉ định duy nhất người đã đăng ký lịch, không gửi đại trà.

**Người dùng cuối:** Google Sign-In, bật web push, thêm tên ngắn/ngày/giờ, xem và sửa/xóa công việc. Đăng ký xong có thể đóng ứng dụng, không cần mở hằng ngày. Web Push phụ thuộc thiết bị và quyền.

**Tiết kiệm quota:** không polling, không trigger theo cá nhân, không gọi lại Sheets khi đổi màn hình. Lập lịch push trước 7 ngày, đồng bộ hàng giờ chỉ khi cần. Mỗi tài khoản một JSON row, chống trùng yêu cầu.

**Giới hạn an toàn triển khai v1:** 50 việc chưa qua hạn/tài khoản (chống vượt giới hạn ô Sheets), tự dọn sau 30 ngày. Không upload file, không chấm KPI, không admin UI ngoài danh sách Access. Cần thử trên thiết bị thật để xác minh push.
