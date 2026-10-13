# NHẮC VIỆC KPI TÂN HIỆP – V1.9.2-HF1
## Sửa xác thực nhóm BGD và tự cấu hình Ban Giám đốc phụ trách

**Bản nền:** V1.9.2 YC-028/030/032, giữ cải tiến tương thích YC-033. **Phạm vi CHỐT:** khắc phục kiểm tra phân công KPI với nhóm `BGD`; cho phép quản trị viên tự điền cột G `Quản lý Phòng-Khu`; bổ sung lựa chọn chức vụ `Ban Giám đốc` và `Quyền Trưởng phòng/Khu` trong các danh sách thả xuống.

**Trạng thái:** Bộ code mới đã qua kiểm thử cục bộ **130/130** và kiểm tra cú pháp. **CHƯA** triển khai Google Apps Script production, GitHub/Vercel hay chỉnh sửa Google Sheets thật. Chưa nghiệm thu Push trên điện thoại thật hoặc 140 người dùng đồng thời.

### 1. Mã nguồn nào phải cập nhật?

- **Phải thay thế:** Toàn bộ `apps-script/Code.gs` bằng `Code.gs` trong gói HF1 (hoặc dùng file Apps Script HF1 riêng). Không dán thêm hàm lẻ và không gộp thủ công những đoạn mã khác phiên bản.
- **Giữ nguyên:** `public/` giao diện V1.9.2; `api/`, `server/`, Chrome Extension, OneSignal Worker, App ID, cấu hình Vercel, dữ liệu tab `State`.
- **Bổ sung:** Một lựa chọn trong menu Sheets/App Script cho hàm `prepareKpiRoleDropdowns()` và các bài kiểm thử.
- **Không chạy** `setupProject`, `prepareVietnameseAdminSheets`, `prepareKpiRoutingSheets` trên file Google Sheets đã tạo đủ bảng như ảnh, vì có thể đụng vào quá trình chuẩn bị cũ. **Không tạo lại tab `Phân công KPI`**.

### 2. Sao lưu trước khi thay Apps Script

1. Sao lưu `Code.gs` Apps Script đang chạy và ghi lại deployment hiện tại.
2. Tạo bản sao Google Sheets gồm `Tài khoản`, `Quản lý Phòng-Khu`, `Phân công KPI`, `State` và `Access` nếu còn.
3. Sao lưu thuộc tính dự án (chỉ giữ trong hệ thống nội bộ; không gửi token, khóa bí mật qua chat).
4. Ưu tiên kiểm thử trên bản sao Sheet và Web App riêng trước; không chỉnh sửa production tự động.

### 3. Cập nhật Apps Script

1. Mở **Tiện ích mở rộng → Apps Script** trong trang tính hiện tại hoặc dự án Apps Script gắn đúng Google Sheets.
2. Thay toàn bộ `Code.gs` bằng file HF1 và lưu.
3. Nếu hệ thống đang dùng **Apps Script Web App**, cập nhật deployment hiện có với phiên bản code mới theo quy trình đang vận hành; cần lưu ý URL/Deployment ID để API Vercel vẫn dùng đúng địa chỉ.
4. Sau khi lưu, **chưa** chạy `activateKpiRoutingSheets` cho đến khi kiểm tra dữ liệu.

### 4. Cho phép chọn chức vụ mới trong Google Sheets (chỉ khi chủ động chạy)

1. Trong Apps Script chọn hàm **`prepareKpiRoleDropdowns` → Chạy** một lần; hoặc chọn mục **"8. Bổ sung lựa chọn chức vụ KPI"** trong menu **Nhắc việc KPI** nếu menu đã được làm mới.
2. Hàm chỉ cập nhật quy tắc **danh sách lựa chọn** của:
   - Tab **`Tài khoản`**: cột **D – Vai trò**;
   - Tab **`Phân công KPI`**: cột **C – Chức vụ tại Phòng/Khu**.
3. Hàm **không tự đổi bất kỳ giá trị ô nào**, không động tới dữ liệu `State`, không tự kích hoạt V2.
4. Danh sách có `Ban Giám đốc`, `Quyền Trưởng phòng/Khu`, `Trưởng phòng/Khu`, `Phó Trưởng phòng/Khu`, `Nhân viên`, `Quản trị viên`.

### 5. Theo đúng ba ảnh Google Sheets đã cung cấp

**Tab `Tài khoản`** (theo ảnh dòng 10–12):

- Đặt cột **D** của ba tài khoản ông Nguyễn Văn Nam, ông Nguyễn Đình Bắc và ông Nguyễn Trung Hiếu thành **`Ban Giám đốc`** qua danh sách vừa bổ sung.
- Giữ cột **E = BGD** nếu đang khai báo như vậy; giữ cột **G = Quyền quản trị** theo quyền quản trị thực tế, **không** mặc định chuyển thành `Có` chỉ vì là Ban Giám đốc.
- Không tạo thêm tài khoản trùng email.

**Tab `Phân công KPI`** (theo ảnh dòng 10–12):

- Đặt cột **C** của ba lãnh đạo ở mã đơn vị **BGD** thành **`Ban Giám đốc`**. Các dòng `BGD` chỉ ghi nhận người thuộc nhóm lãnh đạo; **không** buộc phải có người đứng đầu hoặc người phụ trách được chấm KPI.
- **Thêm một dòng phân công** dành cho lãnh đạo phụ trách mỗi Phòng/Khu khác, ví dụ dưới đây với TCHC:

| Email đăng nhập | Mã Phòng/Khu | Chức vụ tại Phòng/Khu |
|---|---|---|
| `baynambtxh@gmail.com` | `TCHC` | `Ban Giám đốc` |

- Một lãnh đạo phụ trách nhiều Phòng/Khu được phép có **nhiều dòng phân công**, mỗi Phòng/Khu một dòng. Nhưng cùng một người **không được có hai chức vụ trong cùng một Phòng/Khu** theo quy tắc V1.9.2.

**Tab `Quản lý Phòng-Khu`:**

- Dòng **TCHC**: cột **G** là nơi **bạn tự nhập email Ban Giám đốc phụ trách**. Nếu vẫn theo phân công hiện tại, có thể điền `baynambtxh@gmail.com` tại **G2**. Đây chỉ là ví dụ dữ liệu, **không được ghi cứng trong Apps Script**.
- Cột **C** TCHC giữ email Trưởng phòng hợp lệ; cột **F** để trống nếu đã có Trưởng phòng tại C.
- Dòng **BGD**: cột **G** để trống; **không** phải nhập email một thành viên Ban Giám đốc phụ trách lại chính nhóm BGD. Các ô C/D/E cũ nếu vẫn giữ trong bảng sẽ được **bỏ qua khi định tuyến V2**; không cần xóa hoặc sửa tự động.
- Nếu sau này thay người phụ trách TCHC, **bạn tự đổi ô G2** và đồng thời cập nhật dòng `Ban Giám đốc` tại mã TCHC trong `Phân công KPI` cho người mới. Người mới phải có tài khoản `Tài khoản` đang hoạt động với vai trò Ban Giám đốc. Không sửa code để đổi người.
- Các Phòng/Khu khác cũng làm như TCHC. Dòng **BGD** là ngoại lệ; Phòng/Khu thông thường vẫn phải xác định đúng người đứng đầu và Ban Giám đốc phụ trách.

### 6. Kiểm tra và kích hoạt

1. Chạy **`inspectVietnameseAdminSheets`** và **`inspectKpiRoutingSheets`**; xem toàn bộ lỗi.
2. Lưu ý: thông báo **"thiếu Ban Giám đốc phụ trách"** tại TCHC là hợp lệ nếu chưa điền G2; không kích hoạt khi còn lỗi. Nhóm BGD không còn bị yêu cầu G3.
3. Chỉ khi kiểm tra hợp lệ, chạy **`activateKpiRoutingSheets`** để đặt thuộc tính `KPI_ROUTING_SCHEMA=V2`. Nếu đã kích hoạt từ trước, chỉ cần kiểm tra lại, không cần tự kích hoạt lần hai.
4. Lưu ý sau kích hoạt: **công việc chưa phân loại từ phiên bản cũ** cần mở **Sửa** và chọn KPI/Cá nhân trước khi đánh dấu hoàn thành theo V1.9.2; các việc Cá nhân hoàn thành **không** gửi thông báo chấm KPI.

### 7. Kiểm thử nghiệp vụ quan trọng

- Nhân viên TCHC hoàn thành KPI → đúng Trưởng phòng TCHC.
- Trưởng phòng TCHC hoàn thành KPI → đúng lãnh đạo nhập tại G2 (khi có dòng `Phân công KPI` tương ứng).
- Một người Phó Phòng A và Quyền Trưởng phòng B → hai loại nhiệm vụ đi đúng hai cấp quản lý.
- Công việc Cá nhân hoàn thành → không gửi Trưởng phòng.
- Khi đổi G2 sang lãnh đạo khác được khai hợp lệ, các **sự kiện chưa chuyển** sử dụng người phụ trách mới; **thông báo đã giao trước đó không tự di chuyển** giữa các hộp thư quản lý.
- Nếu G2 không tồn tại trong `Tài khoản`, tài khoản bị khóa, hoặc thiếu dòng Ban Giám đốc trong `Phân công KPI`, hệ thống báo cấu hình không hợp lệ, tránh gửi nhầm.
- Dòng `BGD` có thể giữ giá trị C/D/E lịch sử và **không** bị ép điền F/G.

### 8. Khôi phục khi cần

- Dừng thử nghiệm, lưu ghi nhận lỗi; không xóa `State`.
- Nếu vấn đề nằm ở tuyến thông báo KPI V2, chỉ quản trị viên cân nhắc chạy `rollbackKpiRoutingSheets` để tạm tắt V2; nhiệm vụ đã gắn phân công V2 **không** tự chuyển sang luồng người quản lý cũ. Các sự kiện cần xử lý lại sau khi bật V2 đúng cấu hình.
- Có thể khôi phục Apps Script deployment/mã từ bản đã sao lưu; không tự động phục hồi đè dữ liệu Google Sheets từ bản sao khi đã phát sinh công việc mới.
- Nếu chỉ muốn đổi người phụ trách khi cấu hình đã hợp lệ: sửa trong Google Sheets, không cần chạy lại Apps Script deployment.

**Các nội dung không thuộc hotfix:** YC-027 định danh nguồn iCPV; YC-029 nhãn “Đang xếp lịch”; YC-031 xử lý sâu lỗi OneSignal trên iPhone. Khả năng Push và chịu tải thực tế 140 thiết bị vẫn phải được nghiệm thu riêng.
