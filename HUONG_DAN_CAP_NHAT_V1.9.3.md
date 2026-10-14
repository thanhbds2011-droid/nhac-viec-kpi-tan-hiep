# NHẮC VIỆC KPI – TÂN HIỆP
## HƯỚNG DẪN NÂNG CẤP V1.9.3 (YC-036, YC-037, YC-038)

**Trạng thái:** Đã chuẩn bị mã nguồn và kiểm thử cục bộ. **CHƯA triển khai production, CHƯA xác minh phiên bản production hiện tại, CHƯA nghiệm thu Push trên thiết bị thật.**

### 1. Những thay đổi đã thực hiện

| Yêu cầu | Kết quả |
|---|---|
| YC-036 – Công việc lịch sử | Trong chế độ phân quyền hợp nhất, công việc lịch sử chưa phân loại được hiển thị và xử lý là KPI **mà không ghi đổi hàng loạt JSON `State`**. Người chỉ có một phân công hợp lệ được tự xác định người chấm. Người kiêm nhiệm nhiều đơn vị chọn Phòng/Khu **tại lúc xác nhận hoàn thành**, không phải sửa mọi công việc. Nếu sửa ngày/giờ việc cũ, không bị buộc chọn lại loại hoặc Phòng/Khu. |
| YC-037 – Phân quyền | Cả Giám đốc và Phó Giám đốc có thể phụ trách nhiều Phòng/Khu bằng các mã trong cột F; Trưởng/Quyền Trưởng hoàn thành thì đúng người được phân công nhận. Phó Giám đốc hoàn thành KPI của chính mình thì chuyển Giám đốc. Giám đốc hoàn thành KPI của chính mình thì không tự gửi lên cấp trên. |
| YC-038 – Cập nhật | Trình duyệt/PWA phiên bản **1.9.3 trở lên** kiểm tra version qua `/api/config`, khi mở/quay lại/online và mỗi 2 phút khi trang hoạt động. Chỉ tải mới nếu không có thao tác chưa lưu. Thiết bị chạy mã cũ mà không nêu rõ loại thao tác xóa sẽ bị từ chối thay vì xóa âm thầm. |

**Đặc biệt:** Mã cũ trước V1.9.3 **chưa có logic tự kiểm tra phiên bản** nên không thể tự biết có bản mới khi đang mở mà chưa reload. Cần để người dùng mở lại ứng dụng hoặc tải lại trang **một lần đầu tiên** để nhận V1.9.3. Kể từ đó, những lần cập nhật sau mới có thể dùng cơ chế tự kiểm tra. Không thể cập nhật thiết bị đang offline hay bị hệ điều hành tạm dừng.

### 2. Phạm vi file thay đổi

**Mã vận hành được sửa:** `apps-script/Code.gs`, `public/app.js`, `public/index.html`, `api/config.js`, `vercel.json`, `package.json`.

**Kiểm thử được sửa/bổ sung:** `tests/yc028-030-032-routing.test.js`, `tests/yc033-compatibility.test.js`, `tests/yc034-one-sheet.test.js`; mới: `tests/yc038-app-version.test.js`.

**Không thay đổi:** `api/data.js`, `api/realtime.js`, các file `server/*`, `public/styles.css`, `public/OneSignalSDKWorker.js`, mọi file thuộc `chrome-extension/*`, cấu trúc Google Sheets A:H, tab `State`, các tab dự phòng, tài khoản Google, các Script Properties, OneSignal application.

**Chrome Extension có thay đổi không? KHÔNG.** Giữ phiên bản 1.1.0. Không có file tiện ích bị sửa; không cần cài lại tiện ích vì YC-036/037/038. Tiện ích cài thủ công dạng unpacked không tự cập nhật từ Vercel: nếu sau này thay đổi, cần hướng dẫn riêng.

### 3. Bước 0 – Chỉ triển khai khi đã xác minh baseline

Bộ mã nguồn này xuất phát từ ZIP V1.9.2-HF3 người dùng cung cấp, **không tự khẳng định đang giống production**. Trước khi cập nhật, so sánh mã GitHub và Apps Script **đang chạy thật** với baseline này; nếu đang chạy bản khác hoặc đã có sửa đổi trên production, **không thay đè**, cần hợp nhất các sửa đổi phát sinh trước.

### 4. Bước 1 – Sao lưu

1. Trên Google Sheets của hệ thống thật: chọn **Tệp → Tạo bản sao** để lưu nguyên tab `Nhân sự - Phân quyền`, `State`, các tab dự phòng. Không đổi tên, xóa hay di chuyển tab trên file thật.
2. Trên Apps Script: sao lưu toàn bộ `Code.gs` đang chạy ra một file dự phòng; ghi lại deployment ID/Web App URL hiện có.
3. Trên GitHub: giữ commit hiện tại hoặc tạo nhánh/tag ghi `truoc-v1.9.3` để có thể khôi phục; xác nhận Vercel project hiện kết nối đúng repository.
4. Ghi nhận danh sách tài khoản thử (ít nhất một nhân viên, một Phó/Trưởng hoặc Quyền Trưởng, một Phó Giám đốc, Giám đốc), thiết bị kiểm thử và trạng thái thông báo hiện tại.

**Không chạy** `setupProject`, `prepareUnifiedAdminSheet`, `activateUnifiedAdminSheet` hay các hàm tạo bảng chỉ để nâng cấp phiên bản này. Không tự tạo trigger mới; giữ trigger hiện hành.

### 5. Bước 2 – Rà soát tab nhân sự (chỉ sửa dữ liệu do đơn vị xác nhận)

Tại tab `Nhân sự - Phân quyền`, giữ 8 cột A:H. Mỗi email một dòng:

- Cột D: đối với lãnh đạo BGD, ghi chính xác **Giám đốc** hoặc **Phó Giám đốc**. Chức danh chung **Ban Giám đốc** vẫn được hệ thống hiểu thuộc nhóm lãnh đạo, nhưng không đủ để phân biệt luồng Phó Giám đốc → Giám đốc; chức năng kiểm tra sẽ cảnh báo để người quản trị đối chiếu, **không tự sửa chức danh**.
- Cột E của BGD: `BGD`.
- Cột F của BGD: các mã Phòng/Khu phụ trách, cách nhau dấu phẩy: `TCHC, CTXH, KIII` (chỉ là ví dụ). Giám đốc **hoặc** Phó Giám đốc đều được điền F, không ưu tiên loại chức vụ nào. Một người được phụ trách nhiều Phòng/Khu.
- Cột G của BGD: để trống, không dùng để khai báo Phòng/Khu phụ trách.
- Mỗi Phòng/Khu cần xác định duy nhất một Trưởng hoặc Quyền Trưởng, và duy nhất một thành viên BGD được phân công phụ trách. Trùng/thiếu thì phải chỉnh phân công thật trước khi mong chờ thông báo đến đúng người.
- Chỉ một Giám đốc đang hoạt động được nhận thông báo từ các Phó Giám đốc. Nếu thiếu/trùng Giám đốc, thông báo chưa xác định người nhận sẽ được lưu chờ, **không gửi tùy tiện**.

**Đặc biệt với file Excel người dùng cung cấp:** trong bản dữ liệu này có tài khoản mang tên chức danh chung `Ban Giám đốc`, nên cần người quản trị **đối chiếu nhân sự thực tế trước khi chỉnh cột D**. Không được dùng ví dụ trong tài liệu này làm phân công thật.

Sau khi rà soát, mở lại Google Sheets để dùng menu **Nhắc việc KPI → Kiểm tra nhân sự và phân quyền**. Đây vẫn là **mục menu duy nhất**. Nếu hiện lỗi/cảnh báo, xử lý dựa trên phân công thực tế, không tự bỏ qua thông báo lỗi.

### 6. Bước 3 – Cập nhật Apps Script

1. Mở đúng Apps Script kết nối Google Sheets thật.
2. Sao chép **toàn bộ** file `apps-script/Code.gs` trong ZIP (hoặc bản Code.gs độc lập được bàn giao), thay thế **toàn bộ nội dung** file Code.gs của deployment cần nâng cấp, không dán đoạn vá.
3. Nhấn **Lưu**. Không thay đổi Script Properties hoặc thông tin bí mật.
4. Tại **Triển khai → Quản lý việc triển khai (Manage deployments)**, chọn đúng bản triển khai Web App hiện có, **Chỉnh sửa**, tạo **phiên bản mới**, triển khai. Ưu tiên cập nhật **cùng deployment** để giữ URL nếu cấu hình cho phép. Nếu URL thay đổi, phải cập nhật `APPS_SCRIPT_URL` trên Vercel tương ứng sau khi đối chiếu.
5. Xác nhận quyền truy cập và các cài đặt deployment đang sử dụng được giữ nguyên. **Không công khai quyền truy cập mới** ngoài thiết lập đã được duyệt.
6. Việc triển khai là thao tác riêng cần quản trị viên thực hiện; việc bấm **Lưu** mã Script không đồng nghĩa Web App hiện hành đã chuyển sang phiên bản mới.

### 7. Bước 4 – Cập nhật GitHub/Vercel

1. Giữ nguyên GitHub repository, Vercel project và tên miền hiện có.
2. Thay thế **nguyên file** trong repository theo các file đã sửa trong bảng mục 2; không cần tự viết/dán từng đoạn code.
3. Nếu muốn tiện nhất, tải toàn bộ repository trong ZIP mới lên nhánh thử, kiểm tra nội dung rồi merge theo quy trình đơn vị. **Không xóa file sản xuất khác phát sinh sau baseline**.
4. Kiểm tra Vercel hoàn tất build/deploy đúng commit. `GET /api/config` của site mới phải trả `appVersion: "1.9.3"` khi các biến môi trường đã được cấu hình.
5. Mở site trên trình duyệt bằng thao tác tải lại trang để tải `app.js?v=1.9.3`, `styles.css?v=1.9.3`. Không tự xóa dữ liệu duyệt web/cookie hay đăng ký OneSignal.
6. Website V1.9.3 có cơ chế tự phát hiện phiên bản tiếp theo. Việc đồng bộ **mã ứng dụng** và đồng bộ **dữ liệu công việc** là hai luồng độc lập.

### 8. Bước 5 – Nghiệm thu nhóm nhỏ trước khi mở rộng

Kiểm thử trên môi trường thử hoặc bộ tài khoản thử **không phát Push hàng loạt**. Thực hiện có đối chiếu kết quả trên điện thoại/thông báo thực:

1. Nhân viên TCHC hoàn thành KPI: Trưởng/Quyền Trưởng TCHC nhận Push và có thông báo bên trong ứng dụng.
2. Phó Trưởng phòng hoàn thành KPI: đúng Trưởng/Quyền Trưởng nhận.
3. Trưởng/Quyền Trưởng hoàn thành KPI tại phòng Giám đốc trực tiếp phụ trách: Giám đốc nhận.
4. Trưởng/Quyền Trưởng hoàn thành KPI tại phòng Phó Giám đốc phụ trách: đúng Phó Giám đốc nhận.
5. Phó Giám đốc hoàn thành KPI của chính mình: Giám đốc nhận, không cần chọn từng Phòng/Khu cột F.
6. Giám đốc hoàn thành KPI riêng: ứng dụng không tự gửi đến người nhận cấp trên chưa xác định.
7. Việc Cá nhân hoàn thành: không có thông báo chấm KPI; Xóa do nhập nhầm cũng không gửi.
8. Công việc lịch sử ở `State` thiếu `workType`/`assignmentKey`: load không bắt sửa; một phân công thì hoàn thành tự xác định. Người có nhiều phân công chỉ chọn Phòng/Khu **tại bước hoàn thành**. Chỉnh sửa hạn/giờ cũ không phải phân loại lại.
9. Kiểm tra các lịch nhắc trước 3, 2, 1 và đúng ngày; công việc đang lưu không mất lịch/ID chỉ do mở app mới.
10. Windows Chrome, Android, iPhone/PWA: đăng nhập, đổi account A↔B, nhiều thiết bị, Push và cảnh báo cập nhật. Việc kiểm tra realtime chỉ khẳng định khi **đã có mạng và hệ điều hành cho phép**.
11. Thử phiên bản web cũ thiếu tham số loại thao tác xóa: máy chủ phải từ chối an toàn, không âm thầm xóa công việc.

Chỉ mở rộng người dùng sau khi nhóm thử đạt yêu cầu. Kết quả **154/154 test cục bộ** không thay cho nghiệm thu này.

### 9. Luồng cũ được giữ nguyên và giới hạn quan trọng

- 4 mốc lịch nhắc: 3/2/1/0 ngày; múi giờ `Asia/Ho_Chi_Minh`; giờ cá nhân, không loại ngày nghỉ; giới hạn 50 công việc.
- Google Login, phân quyền theo email, một email một dòng, tài khoản quản trị độc lập chức vụ, khôi phục qua các tab cũ.
- OneSignal, Service Worker, idempotency, các sự kiện hoàn thành đã ghi trong State và cơ chế thử lại.
- Đồng bộ iCPV theo xác nhận, không tự mở tài khoản, không ghi đè nhiệm vụ, không hồi sinh công việc đã xóa.
- Realtime công việc qua revision/BroadcastChannel/Ably nếu được cấu hình.

**Giới hạn cần báo rõ:** Nếu nhiệm vụ lịch sử không có `assignmentKey`, người dùng có **nhiều phân công**, hệ thống không được chọn đại; cần người dùng xác nhận đúng Phòng/Khu khi hoàn thành. Nếu hiện không có **bất cứ phân công hợp lệ nào**, sự kiện KPI có thể được lưu chờ mà **không thể tự định tuyến an toàn** chỉ dựa trên dữ liệu hiện có; người quản trị cần đối chiếu hồ sơ/phân công và xử lý theo quy trình được duyệt. Không sửa trực tiếp JSON `State` trên production để “ép gửi”.

### 10. Khi cần rollback

1. Tạm dừng thao tác nâng cấp và ghi nhận phiên bản đang chạy.
2. Khôi phục **commit Vercel và Apps Script tương ứng** với bản đã sao lưu (không chỉ phục hồi một phía vì hai phía cần tương thích).
3. **Không phục hồi đè `State` cũ nếu đã có người dùng tiếp tục làm việc**, vì có thể mất nhiệm vụ/sự kiện phát sinh sau cập nhật.
4. **Lưu ý quan trọng:** nhiệm vụ BGD hoặc thông báo tạo trong V1.9.3 có thể dùng `BGD::DIRECTOR`; phiên bản HF3 cũ **không có luồng Phó Giám đốc → Giám đốc**. Sau rollback, các sự kiện dạng này cần được đối soát riêng, không được coi rằng HF3 sẽ tự chuyển lại hoàn chỉnh.
5. Kiểm tra lại phân quyền và 4 luồng thông báo ở nhóm thử trước khi tiếp tục sử dụng rộng rãi.

### 11. Kết quả bàn giao

- Mã nguồn đầy đủ của GitHub/Vercel trong ZIP.
- `apps-script/Code.gs` hoàn chỉnh (cũng được cung cấp file độc lập).
- Các bài kiểm thử và tài liệu nâng cấp.
- Không có thao tác sửa production hoặc thay đổi trực tiếp Google Sheets.
- Chrome Extension: **KHÔNG sửa**, không có việc cài lại tiện ích ở lần nâng cấp này.
