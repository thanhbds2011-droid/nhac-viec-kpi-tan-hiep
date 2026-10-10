# Nhắc việc KPI – Tân Hiệp | v1.7.0

**Bản nền:** v1.6.0 HOTFIX (đã xác minh Code.gs trong ZIP trùng file HOTFIX bàn giao).  
**Phạm vi:** YC-017/018/019/020 theo Master Prompt V2.6.  
**Không làm:** YC-021 (Push thử) và YC-022 (thời gian đồng bộ) vì chưa chốt. Không tự sửa iCPV, không tự triển khai production.

## 1. Giao diện người dùng thay đổi gì?

- Khi người dùng **mở danh sách iCPV đã cấp quyền cho Chrome Extension**, tiện ích kiểm tra dữ liệu đang hiển thị và đối chiếu với dấu kiểm tra cũ **trên cùng thiết bị, hồ sơ Chrome, tài khoản Nhắc việc và trang iCPV**.
- Lần đầu kiểm tra chỉ tạo mốc đối chiếu. Những lần sau nếu tên/hạn của ít nhất một dòng thay đổi, xuất hiện lời nhắc: **“Danh sách công việc có thay đổi. Vui lòng rà soát và cập nhật nếu cần.”**
- Người dùng nhấn **Xem thay đổi**, xác nhận quyền chuyển tên/hạn nhiệm vụ; Chrome mở Nhắc việc KPI. Tại đây, **từng dòng** có ba lựa chọn: **Bỏ qua**, **Thêm thành công việc mới**, **Cập nhật một công việc đã có**.
- Khi chọn Cập nhật, người dùng phải chọn cụ thể **đầu việc nhận cập nhật**. Không tự ghép theo tên. Hai đầu việc cùng tên (kể cả cùng thời hạn) có thể được lưu độc lập nếu người dùng chủ động xác nhận.
- Không tự tạo hoặc sửa nhiệm vụ chỉ vì mở iCPV. Quyền truy cập iCPV cần được cơ quan có thẩm quyền cho phép.
- Nút đọc thủ công trong tiện ích vẫn dùng được.

## 2. Thành phần bắt buộc cập nhật (theo đúng thứ tự)

### Giai đoạn A – Apps Script

1. **Sao lưu** toàn bộ Code.gs v1.6.0 HOTFIX và sao lưu Google Sheets trước khi thao tác.
2. Mở **cùng dự án Apps Script production**, thay toàn bộ `Code.gs` bằng file `apps-script/Code.gs` từ ZIP v1.7.0.
3. Bấm **Lưu**; chọn **Triển khai → Quản lý các bản triển khai → biểu tượng bút chì → Phiên bản mới → Triển khai**.
4. **Giữ nguyên deployment hiện tại và URL `/exec`**, Script Properties, trigger và dữ liệu `State`. **Không chạy `setupProject()`**, không chạy hàm chuyển đổi Sheets. Không thêm hoặc xóa tab.
5. Kiểm tra đăng nhập và lịch đang lưu qua phiên bản giao diện hiện tại trước khi tiếp tục.

### Giai đoạn B – GitHub → Vercel

1. Trên repository hiện tại, cập nhật đúng các file: `api/data.js`, `public/app.js`, `public/index.html`, `public/styles.css`, `package.json`.
2. Các file test và tài liệu có thể cập nhật cùng commit; không thay bất kỳ biến môi trường Vercel nào.
3. Đợi Vercel ở trạng thái **Ready**. Mở lại website bằng Chrome, nhấn Ctrl + Shift + R, đăng nhập và xác nhận danh sách nhiệm vụ cũ còn nguyên.
4. **Không** xóa dữ liệu Sheets, không tạo OneSignal App mới, không sửa Chrome Extension của người khác khi họ chưa sẵn sàng.

### Giai đoạn C – Tiện ích Chrome

1. **Sao lưu thư mục tiện ích cũ.** Giải nén `Nhac-viec-KPI-v1.7.0-CHROME-EXTENSION.zip` và lấy thư mục `chrome-extension` chứa `manifest.json`.
2. Vào `chrome://extensions`, bật **Chế độ dành cho nhà phát triển**. Nếu đã cài bản cũ bằng Load unpacked: thay file trong đúng thư mục tiện ích, nhấn **Tải lại**. Nếu không biết thư mục cũ: gỡ tiện ích cũ và **Tải tiện ích đã giải nén** từ thư mục mới; lưu ý lúc này phải thiết lập lại nguồn iCPV được ghim.
3. Trong **cùng hồ sơ Chrome đã cài tiện ích**, vào Nhắc việc KPI và **đăng nhập Google**. Không chuyển dữ liệu qua hồ sơ Chrome hay tài khoản khác.
4. Mở danh sách nhiệm vụ iCPV; mở popup Chrome Extension. Tích xác nhận quyền sử dụng dữ liệu, nhấn **Bật kiểm tra tự động khi mở iCPV** và chỉ chấp thuận quyền truy cập đối với **đúng tên miền iCPV chính thức** bạn đang sử dụng.
5. **Tải lại iCPV**. Khi có bảng hợp lệ, tiện ích ghi nhận mốc kiểm tra đầu tiên; từ lần thay đổi tiếp theo sẽ thông báo.
6. Chọn **Xem thay đổi** trên thông báo, xác nhận một lần nữa trước khi chuyển dữ liệu. Trên Nhắc việc, kiểm tra đúng tài khoản, chọn các dòng và xác nhận.

## 3. Điều kiện và giới hạn rõ ràng

- Tiện ích Chrome không có API iCPV. Chỉ theo dõi **bảng đang được tải trong trang mở và có quyền đọc**. Nếu bảng chưa tải xong hoặc không xác định được cột Tên/Hạn, không tuyên bố đã kiểm tra.
- Hỗ trợ tối đa **30 nhiệm vụ được đọc trên một trang mỗi lượt**. Khi có nhiều trang, phải xem từng trang để tạo dấu kiểm tra. Các địa chỉ trang hoặc thay đổi bộ lọc được xem là phạm vi kiểm tra riêng nếu URL khác.
- Tính năng tự phát hiện không hoạt động khi **đóng trình duyệt, chưa cấp quyền iCPV, chưa có tài khoản Nhắc việc đăng nhập cùng hồ sơ Chrome**, hoặc giao diện iCPV thay đổi HTML khiến bộ đọc không còn nhận cột.
- Hệ thống không biết chắc đâu là nhiệm vụ mới khi tên/hạn bị sửa; người dùng **tự rà soát**, chủ động cập nhật hoặc thêm mới. Dấu kiểm tra dùng **bản băm**, không lưu nội dung tên/hạn công vụ trên Chrome để theo dõi nền.
- Sau khi người dùng đồng ý chuyển dữ liệu, danh sách được đặt trong **Chrome session tạm tối đa 15 phút**, chỉ website Nhắc việc được ghim mới nhận; người dùng phải xác nhận đúng tài khoản ở màn hình Nhắc việc.
- **Không xóa công việc khi chưa hoàn thành** để thử; thao tác xóa hoàn thành vẫn gửi thông báo cho Trưởng phòng theo v1.6.0 HOTFIX.
- Một vài trình duyệt/ứng dụng Chrome doanh nghiệp có thể không cho phép tiện ích đọc iCPV theo chính sách của cơ quan; không hướng dẫn vượt chính sách.

## 4. Quy trình kiểm thử tối thiểu trước khi dùng thật

1. Trên iCPV, xem một trang nhiệm vụ thử **chưa có thay đổi**: kiểm tra hiển thị thông báo lần đầu hoặc không thay đổi; **không tự nhập** bất cứ việc nào.
2. Thay đổi hạn của một nhiệm vụ thử trên iCPV (nếu bạn có quyền), tải lại bảng. Thông báo khác biệt xuất hiện. Tại Nhắc việc chọn **Cập nhật một công việc đã có** và chọn đúng đầu việc; giờ nhắc riêng giữ nguyên.
3. Thử hai nhiệm vụ trùng tên, chọn **Thêm mới** cho nhiệm vụ độc lập; hai công việc vẫn tồn tại riêng.
4. Thử **Bỏ qua**: toàn bộ dữ liệu và lịch nhắc cũ vẫn giữ nguyên.
5. Thử chuyển tài khoản Google trong Nhắc việc trên cùng Chrome: dữ liệu tạm của tài khoản trước không được chấp nhận trên tài khoản sau.
6. Kiểm tra lại đăng nhập, danh sách nhiệm vụ, bốn mốc nhắc hạn, xóa đã hoàn thành → thông báo Trưởng phòng, thống kê quản trị và phân quyền Phòng/Khu.

**Đã kiểm tra tự động:** Node syntax check và 83/83 test pass tại thời điểm đóng gói. **Chưa** xác nhận thực tế trên iCPV/Chrome của bạn hoặc gửi OneSignal thật.

## 5. Hoàn nguyên (rollback)

- **Chrome:** khôi phục thư mục Chrome Extension từ bản HOTFIX v1.6.0, nhấn Tải lại. Thao tác này không xóa dữ liệu nhiệm vụ đã lưu.
- **Vercel:** redeploy commit v1.6.0 HOTFIX đã sao lưu. Không sửa biến môi trường.
- **Apps Script:** mở deployment Web App hiện tại và chọn phiên bản Apps Script v1.6.0 HOTFIX đã lưu trước khi nâng cấp; giữ nguyên `/exec`.
- **Sheets:** không reset để rollback. Các thay đổi nhiệm vụ mà người dùng đã xác nhận ở v1.7.0 vẫn tồn tại sau rollback; không tự xóa hay hoàn tác giao dịch nghiệp vụ.

## 6. Danh sách file thay đổi

Bắt buộc cho tính năng mới: `api/data.js`, `apps-script/Code.gs`, `public/app.js`, `public/index.html`, `public/styles.css`, `chrome-extension/manifest.json`, `chrome-extension/background.js`, `chrome-extension/bridge.js`, `chrome-extension/extract.js`, `chrome-extension/icpv-reader.js` (mới), `chrome-extension/auto-watch.js` (mới), `chrome-extension/popup.html`, `chrome-extension/popup.js`, `chrome-extension/popup.css`. `package.json` là phiên bản và lệnh kiểm tra; `chrome-extension/README-CAI-DAT.txt`, `tests/import.test.js`, `tests/v170-review.test.js` và tài liệu này phục vụ cài đặt/kiểm thử.
