# TRIỂN KHAI NHẮC VIỆC KPI v1.4.0 + TIỆN ÍCH CHROME ĐỒNG BỘ iCPV

> **QUAN TRỌNG:** Bộ code đã được kiểm tra bằng test tự động, nhưng **chưa kiểm thử với HTML của website iCPV thật**; chỉ có ảnh chụp màn hình. Trước khi dùng dữ liệu công vụ, đơn vị phải xác nhận quyền đọc và chuyển thông tin từ iCPV vào hệ thống Google Sheets/OneSignal/Ably đang dùng. Tuyệt đối không đưa mật khẩu/cookie/token iCPV vào tiện ích.

## A. Đã hoàn thiện trong bộ mã

- Tiện ích Chrome Manifest V3 chạy theo yêu cầu người dùng, chỉ khi nhấn nút trong popup.
- Tự tìm bảng có hai cột `Tên công việc` (hoặc `Tên nhiệm vụ`) và `Hạn hoàn thành` (hoặc `Thời hạn hoàn thành`), kể cả bảng cuộn ngang nếu các cột vẫn ở trong DOM.
- Chỉ đọc tên nhiệm vụ, hạn hoàn thành từ những hàng đang hiển thị trong DOM; không đọc điểm KPI, không gọi API iCPV, không thu cookie/token.
- Tên gốc được mã hóa dấu vân tay SHA-256 (kèm origin iCPV) để nhận biết lần nhập sau. Không coi đó là mã nhiệm vụ chính thức.
- Nếu có nhiều nhiệm vụ trùng **tên gốc**, tiện ích bỏ qua các dòng này vì thiếu mã nhiệm vụ chính thức để đối chiếu chắc chắn.
- Chuyển dữ liệu qua bộ nhớ phiên của tiện ích đến trang Nhắc việc chính thức, không đưa tên nhiệm vụ vào URL hay clipboard; bộ nhớ tạm hết hạn 15 phút, dùng một lần.
- Trang Nhắc việc yêu cầu đăng nhập Google, hiển thị danh sách xem trước, cho phép bỏ chọn/sửa tên ngắn và xác nhận tài khoản trước khi ghi.
- Mỗi lô tối đa 30 nhiệm vụ; Apps Script đối chiếu theo `sourceKey`, thêm mới hoặc cập nhật **chỉ ngày hạn**; giữ tên đã sửa và giờ nhắc riêng.
- Một lần nhập ghi tối đa **một lần** trạng thái Google Sheets cho một tài khoản, revision tăng một lần cho cả lô thay đổi.
- Không tự xóa nhiệm vụ không còn xuất hiện ở nguồn; không tự khôi phục nhiệm vụ người dùng đã xóa; không ảnh hưởng nhiệm vụ thủ công.
- Không tự nhập công việc đã quá hạn hoặc vượt giới hạn ba năm, không vượt quá 50 công việc còn hạn của tài khoản.
- Sau lưu, gửi sự kiện `importBatch` sang Ably (nếu cấu hình) và yêu cầu OneSignal đồng bộ; trigger mỗi giờ tiếp tục là cơ chế dự phòng.

## B. Sao lưu trước khi cập nhật

1. Google Sheets: tạo **bản sao** của file chứa hai tab `Access` và `State`; chỉ lưu bản sao trong vị trí được đơn vị chấp thuận, hạn chế quyền truy cập.
2. Google Apps Script: lưu bản `Code.gs` v1.3.0 và ghi lại **ID phiên triển khai** đang chạy.
3. GitHub: lưu commit/ZIP của v1.3.0, giữ bản rollback.
4. Không đổi `SHEET_ID`, `SHARED_SECRET`, `PUSH_ID_SECRET`, `ONESIGNAL_APP_ID`, `APPS_SCRIPT_URL`, `GOOGLE_CLIENT_ID` hoặc `ABLY_API_KEY` trừ khi có yêu cầu riêng.

## C. Triển khai Backend trước

1. Mở dự án Apps Script **BACKEND NHẮC VIỆC KPI TÂN HIỆP**.
2. Thay **toàn bộ nội dung** file `Code.gs` bằng `apps-script/Code.gs` từ v1.4.0, bấm **Lưu**.
3. Chọn `Triển khai` → `Quản lý các tùy chọn triển khai` → chọn **Web App đang hoạt động** → bấm biểu tượng bút chì.
4. Chọn **Phiên bản mới (New version)**, giữ nguyên `Thực thi bằng tên: Tôi` và `Người có quyền truy cập: Bất kỳ ai` theo cấu hình API-HMAC trước đây, rồi bấm **Triển khai**.
5. Kiểm tra URL `/exec` của bản triển khai hiện tại **không đổi**. Nếu đổi URL, dừng lại và đối chiếu cấu hình Vercel, không đoán.
6. Không chạy `setupProject()` lại nếu các tab và trigger đã tồn tại. Không cần thêm cột mới trong Sheets.

## D. Cập nhật GitHub và Vercel

1. Dùng gói `v1.4.0-CHI-FILE-THAY.zip` (hoặc toàn bộ v1.4.0) để thay đúng các file trên nhánh `main`:
   - `api/data.js`
   - `apps-script/Code.gs` (bản tham chiếu; Apps Script Web App vẫn phải cập nhật riêng)
   - `public/app.js`, `public/index.html`, `public/styles.css`
   - `package.json`
   - các file test và tài liệu
2. **Không cần đưa thư mục `chrome-extension` lên Vercel/public/**. Có thể giữ thư mục này trong repo để quản lý phiên bản, nhưng cài tại máy người dùng riêng.
3. Chờ Vercel triển khai mới đạt trạng thái `Ready` → Production.
4. Kiểm tra trước khi cài tiện ích: Google Login, danh sách cũ, thêm/sửa/xóa, OneSignal, Ably vẫn hoạt động; kiểm tra Console/Logs không có lỗi mới.
5. Vercel không cần biến môi trường mới cho YC-006.

## E. Cài tiện ích Chrome trên Windows/macOS

1. Giải nén gói `KPI-ICPV-TIEN-ICH-CHROME-v1.4.0.zip` vào một thư mục cố định (ví dụ `Documents/KPI-ICPV-Extension`). **Không xóa/chuyển thư mục** sau khi tải tiện ích.
2. Mở Chrome và nhập `chrome://extensions` vào thanh địa chỉ.
3. Bật **Chế độ dành cho nhà phát triển / Developer mode** (góc trên bên phải).
4. Bấm **Tải tiện ích đã giải nén / Load unpacked**.
5. Chọn thư mục chứa **`manifest.json`**, không chọn chính file ZIP.
6. Trong thanh tiện ích Chrome (biểu tượng mảnh ghép), ghim **Nhắc việc KPI – Đồng bộ iCPV** để dễ dùng.
7. Nếu Chrome có cảnh báo tiện ích chưa qua Chrome Web Store: đây là bản nội bộ chưa được Google xét duyệt. Chỉ triển khai theo quy trình công nghệ thông tin và phê duyệt của đơn vị.
8. Không cài tiện ích Chrome này trên iPhone/Android: công cụ lấy dữ liệu chạy trên Chrome máy tính; PWA Nhắc việc nhận thông báo vẫn chạy trên thiết bị di động.

## F. Lần đồng bộ đầu tiên

1. Trên Chrome máy tính, đăng nhập hệ thống iCPV bằng tài khoản được cấp quyền.
2. Chọn `Quản lý đánh giá cá nhân` → `Quản lý nhiệm vụ`, tab nhiệm vụ muốn đồng bộ (ví dụ `Đã duyệt`).
3. Đợi trang hiển thị đủ danh sách; nếu có nhiều trang, phải xử lý từng trang; tiện ích **không tự lấy trang ẩn**.
4. Bấm biểu tượng tiện ích → tích **xác nhận quyền sử dụng dữ liệu** → bấm **Lấy nhiệm vụ trên trang đang mở**.
5. Đọc kết quả xem trước ngay trong popup. Nếu báo không nhận diện được cột, **dừng** và gửi ảnh cấu trúc bảng đã che thông tin nhạy cảm để hiệu chỉnh bộ đọc; không cố gọi API iCPV.
6. Bấm **Mở Nhắc việc để duyệt và đồng bộ**. Tiện ích mở trang `https://nhac-viec-kpi-tan-hiep.vercel.app/`.
7. Đăng nhập Google đúng **tài khoản Nhắc việc cá nhân**, đã nằm trong `Access`.
8. Màn hình **Đồng bộ nhiệm vụ từ iCPV** tự mở. Kiểm tra tên, hạn, bỏ chọn công việc không cần; sửa tên ngắn tối đa 90 ký tự.
9. Tích **Tôi xác nhận đây là nhiệm vụ thuộc chính tài khoản Nhắc việc**.
10. Bấm **Xác nhận đồng bộ**; ứng dụng thông báo số mới, số đổi hạn, số không đổi và số bỏ qua. Nếu có dòng bị bỏ qua, xem lý do.
11. Kiểm tra Danh sách công việc, giờ nhắc mặc định và tình trạng bật Web Push.
12. Nếu xuất hiện thời hạn sát giờ, mở **Thông báo → Kiểm tra / bật thông báo** để yêu cầu đồng bộ lịch; nhớ OneSignal và kết nối mạng có giới hạn thực tế.

## G. Lần đồng bộ tiếp theo

- Mở iCPV và bấm tiện ích khi cần cập nhật.
- Nếu nguồn có cùng tên gốc và chỉ **ngày hạn** đổi: ứng dụng cập nhật hạn, giữ tên ngắn và giờ nhắc cá nhân.
- Nếu nguồn đổi **tên gốc**, vân tay thay đổi; phải rà soát thủ công vì không có mã nhiệm vụ chính thức. Không bảo đảm tự nhận biết đó là nhiệm vụ cũ.
- Không đồng bộ trùng khi giữ nguyên tên/hạn; không tự xóa công việc nếu thiếu trong lần đọc.

## H. Giới hạn chưa nghiệm thu (bắt buộc thử trước khi dùng thật)

- Chưa có DOM/HTML của iCPV thật, chỉ có ảnh chụp. Bộ đọc giả định bảng có cấu trúc `table` hoặc ARIA grid, các tiêu đề cột còn trong DOM dù kéo ngang. Nếu website dùng bảng ảo hóa/custom `div`, phải sửa bộ đọc theo HTML thực tế, không tuyên bố đồng bộ đã hoàn chỉnh trên iCPV.
- Chưa kiểm thử thực tế cài tiện ích trên Chrome máy của đơn vị, chưa kiểm chứng iCPV chặn tiện ích bằng chính sách IT.
- Không có ID nhiệm vụ chính thức. Định danh theo dấu vân tay **tên gốc + origin** chỉ an toàn khi tên gốc ổn định và không trùng. Tên bị sửa ở hệ thống iCPV có thể khiến hệ thống xem là công việc mới; phải rà soát.
- Những nhiệm vụ quá hạn không được nhập vào danh sách nhắc mới. Bảng 11 nhiệm vụ từ ảnh có một hạn 08/10/2026, trong khi hôm nay là 09/10/2026.
- Mỗi lần bấm chỉ lấy **những dòng DOM đã tải**, tối đa 30; không thể đọc những trang/hàng ngoài phần dữ liệu đã tải.
- Nếu Google Sign-In trên trang đích mất quá 15 phút, hãy quay lại iCPV và thực hiện lần đồng bộ mới.
- Nếu tài khoản trên iCPV là của lãnh đạo và xem được nhiệm vụ nhiều người, tuyệt đối không chuyển các nhiệm vụ không thuộc chính tài khoản Nhắc việc.
- Cần xác nhận cơ quan cho phép chuyển dữ liệu nhiệm vụ từ hệ thống công vụ đến Google Sheets, Vercel, Ably/OneSignal hiện tại trước khi triển khai; quyền **xem trên iCPV không mặc nhiên là quyền sao chép dữ liệu ra ngoài**.

## I. Rollback

1. **Dừng** dùng tiện ích, gỡ khỏi `chrome://extensions` nếu cần.
2. Khôi phục `Code.gs` v1.3.0 vào **deployment hiện có** bằng cách triển khai lại một phiên bản trước đó.
3. Khôi phục commit GitHub v1.3.0 và đợi Vercel `Ready`; không xóa Google Sheets.
4. Những nhiệm vụ đã nhập v1.4.0 vẫn là bản ghi tương thích v1.3.0, nhưng v1.3.0 không tự hiểu mối liên kết `sourceKey` và sẽ chỉ quản lý như công việc thông thường; KHÔNG nhập lại từ tiện ích sau rollback.
5. Nếu đã xảy ra lỗi dữ liệu, chỉ phục hồi Sheets sau khi sao lưu trạng thái hiện tại và kiểm tra những công việc thay đổi từ sau thời điểm backup; tránh ghi đè dữ liệu mới của người dùng khác.

## J. Kiểm thử nghiệm thu tối thiểu

- Một tài khoản: nhập 2 nhiệm vụ → kiểm tra hiện đúng tên và hạn.
- Nhập lần hai giữ nguyên → `unchanged`, không tạo trùng.
- Thay hạn trên iCPV (nếu được phép thao tác thử) → cập nhật đúng hạn; không thay tên/giờ.
- Đặt tên và giờ riêng ở Nhắc việc rồi đồng bộ lần nữa → giữ nguyên.
- Nhập một nhiệm vụ đã hết hạn → bỏ qua có lý do.
- Xóa một nhiệm vụ đã nhập → lần sau không được tự tạo lại nếu dấu vân tay còn trong State.
- Thử một tài khoản khác → không nhìn thấy nhiệm vụ của người kia.
- Hai thiết bị cùng tài khoản → Ably (nếu đã cấu hình) nhận sự kiện `importBatch`; không F5.
- Kiểm tra 4 mốc nhắc OneSignal và log lỗi/timeout trên thiết bị thật.
- Trong Chrome popup, nếu bảng iCPV không được phát hiện, ghi nhận kết quả **CHƯA ĐẠT**, cần điều chỉnh selectors có căn cứ, không ép trích xuất từ API riêng.
