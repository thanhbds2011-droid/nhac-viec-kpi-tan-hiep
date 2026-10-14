# HƯỚNG DẪN V1.9.2-HF2 – YC-034: GỘP QUẢN TRỊ THÀNH MỘT TAB

**Đơn vị:** Trung tâm Bảo trợ xã hội Tân Hiệp  
**Phạm vi:** Chỉ nâng cấp quản trị tài khoản/phân quyền. Không thay đổi giao diện Web/PWA, Vercel API, OneSignal Worker, Chrome Extension hoặc cơ chế lưu State.  
**Trạng thái bàn giao:** Đã viết mã và kiểm thử cục bộ; **chưa cập nhật Apps Script/Google Sheets production**.

## 1. Kết quả mong muốn

Quản trị viên chỉ cần **một tab `Nhân sự - Phân quyền`**, mỗi email một dòng. Ba tab cũ (`Tài khoản`, `Phân công KPI`, `Quản lý Phòng-Khu`) và tab `Access` vẫn giữ để đối chiếu/khôi phục, **không còn được đọc khi kích hoạt một tab mới**. Tab `State` vẫn độc lập và **không được sửa, di chuyển hoặc xóa**.

| Cột | Tên trường | Cách nhập |
|---|---|---|
| A | Email đăng nhập | Mỗi email chỉ một dòng |
| B | Họ và tên | Họ tên người sử dụng |
| C | Trạng thái | `Hoạt động` hoặc `Ngừng hoạt động` |
| D | Chức danh chính | `Nhân viên`, `Phó Trưởng phòng/Khu`, `Trưởng phòng/Khu`, `Quyền Trưởng phòng/Khu`, `Giám đốc`, `Phó Giám đốc`, `Ban Giám đốc`, `Quản trị viên` |
| E | Đơn vị chính | Mã như `TCHC`, `KHTC`, `BGD`; riêng Giám đốc/Phó Giám đốc dùng `BGD` |
| F | Phòng/Khu phụ trách hoặc kiêm nhiệm | Mã đơn vị, nhiều mã cách nhau bằng dấu phẩy, ví dụ `TCHC, KHTC` |
| G | Chức danh kiêm nhiệm (nếu khác) | **Để trống** nếu cùng chức danh hoặc là Giám đốc/Phó Giám đốc phụ trách Phòng/Khu. Nếu Phó phòng A kiêm Quyền Trưởng phòng B, chọn `Quyền Trưởng phòng/Khu` |
| H | Quyền quản trị | `Có` hoặc `Không`; độc lập với chức danh |

**Ví dụ Giám đốc phụ trách TCHC:** `Nguyễn Văn Nam | Hoạt động | Giám đốc | BGD | TCHC | [trống]`. **Không cần cột “Vai trò tại TCHC”.** Một Giám đốc phụ trách nhiều phòng nhập `TCHC, KHTC` vào F và vẫn để G trống.

**Ví dụ kiêm nhiệm chức vụ khác:** Một người Phó Trưởng phòng A kiêm Quyền Trưởng phòng B: D=`Phó Trưởng phòng/Khu`, E=`A`, F=`B`, G=`Quyền Trưởng phòng/Khu`. Với người thuộc đơn vị chính A và kiêm cùng một chức danh tại B, để G trống.

**Giới hạn được kiểm soát:** Nếu cùng một người có từ hai chức danh *khác nhau* tại các Phòng/Khu kiêm nhiệm bổ sung, cấu trúc một ô G không thể biểu diễn chính xác. Hàm chuẩn bị sẽ dừng với thông báo rõ ràng thay vì nhập nhầm; cần duyệt cấu trúc mở rộng trước khi hỗ trợ tình huống đặc biệt đó.

## 2. Triển khai mã – không tự kích hoạt

1. Sao lưu toàn bộ file Google Sheets và Apps Script hiện tại; lưu lại deployment đang chạy và các Script Properties (`ACCOUNT_SCHEMA`, `KPI_ROUTING_SCHEMA`, v.v.) qua phương án bảo mật nội bộ. **Không đưa khóa bí mật ra ngoài.**
2. Thay **toàn bộ** nội dung `apps-script/Code.gs` bằng bản `Code.gs` của gói V1.9.2-HF2. Giữ nguyên Script Properties hiện có, không tự sửa `SHEET_ID`, `SHARED_SECRET`, khóa OneSignal.
3. Lưu script, kiểm tra lỗi cú pháp. Nếu đang dùng Web App Apps Script theo phiên bản triển khai cố định, cần triển khai phiên bản mới theo quy trình thông thường **sau khi kiểm thử**, không xóa bản cũ ngay.
4. **Chưa thay đổi hoặc xóa ba tab cũ.** Chỉ sử dụng các hàm mới ở bước tiếp theo.

## 3. Chuẩn bị và kiểm tra tab hợp nhất

Trong Apps Script (quản trị viên thực hiện), chạy đúng thứ tự:

1. `prepareUnifiedAdminSheet()` – **chỉ chạy một lần**, tạo tab nháp `Nhân sự - Phân quyền`, sao chép dữ liệu có thể suy ra an toàn từ ba tab cũ. **Không tự bật phân quyền mới.** Nếu tab đã tồn tại, hàm từ chối ghi đè.
2. Mở tab mới, rà soát toàn bộ các dòng. Đặc biệt, chuyển chức danh chung `Ban Giám đốc` sang `Giám đốc` hoặc `Phó Giám đốc` dựa trên phân công thực tế; cột F ghi các mã phòng do từng lãnh đạo phụ trách. Với ông Nguyễn Văn Nam phụ trách TCHC, F=`TCHC`, G để trống. Không suy đoán người phụ trách các phòng khác.
3. `inspectUnifiedAdminSheet()` – đọc toàn bộ tab mới và báo chi tiết vấn đề cần chỉnh. Để kích hoạt, mỗi Phòng/Khu có tài khoản hoạt động cần **đúng một** Trưởng phòng hoặc Quyền Trưởng phòng, **đúng một** thành viên BGD phụ trách. Không cho phép email trùng hoặc chức danh kiêm nhiệm mâu thuẫn.
4. Chỉ khi trả về `ok: true`, chạy `activateUnifiedAdminSheet()` để ứng dụng **bắt đầu đọc từ một tab hợp nhất**. Đây là bước chuyển đổi thực sự, có khóa xử lý, nhưng không xóa dữ liệu cũ.
5. Mở ứng dụng bằng nhóm tài khoản thử nghiệm: nhân viên TCHC, Trưởng TCHC, Giám đốc phụ trách, một người kiêm nhiệm khác vai trò và một tài khoản quản trị không có quyền chấm KPI.

**Cảnh báo:** Việc chỉ tạo tab nháp và điền dữ liệu **chưa làm ứng dụng đổi cách phân quyền**; phải `inspect` rồi `activate` mới có tác dụng. Không sửa `ADMIN_UNIFIED_SCHEMA` bằng tay. Không tự xóa/hide ba tab cũ nếu chưa có bản sao và phương án quản trị quyền phù hợp.

## 4. Sau khi kích hoạt

- Ứng dụng đọc danh sách tài khoản, quyền quản trị và phân công từ `Nhân sự - Phân quyền`.
- Người nhập công việc cá nhân vẫn chỉ nhận nhắc riêng, khi đánh dấu hoàn thành không thông báo chấm KPI.
- Người nhập/chuyển từ iCPV công việc KPI vẫn gắn mã nhiệm vụ và đơn vị thực hiện; khi hoàn thành gửi đúng người đứng đầu hoặc Ban Giám đốc được phân công.
- Thay đổi mã Phòng/Khu phụ trách ở cột F chỉ có hiệu lực cho việc định tuyến **sau khi cấu hình mới hợp lệ**; không mã hóa cố định email lãnh đạo trong Apps Script.
- Không tự gửi Push thử tới toàn bộ 140 tài khoản. Phải thử nhóm nhỏ theo phương án nghiệm thu.
- Tên đơn vị trong giao diện phân công ở chế độ hợp nhất hiện hiển thị **mã Phòng/Khu**, vì tab một dòng/người chưa có danh mục tên đơn vị riêng. Đây là giới hạn cần lưu ý khi bàn giao.

## 5. Khôi phục an toàn

- Nếu cấu hình mới gây lỗi, **không xóa tab hợp nhất** và không chỉnh sửa `State`.
- Chạy `rollbackUnifiedAdminSheet()` để trở về nguồn quản trị trước khi hợp nhất (các tab cũ). Dữ liệu `State` không bị đổi bởi hàm này.
- Nếu đã sửa phân quyền ở tab mới mà không đồng bộ ngược về các tab cũ, sau rollback **phân quyền sẽ theo dữ liệu cũ**, không phải dữ liệu vừa sửa. Cần kiểm tra trước khi cho người dùng thao tác KPI tiếp.
- Khi lỗi do thay đổi Script Code, khôi phục bản `Code.gs` đã sao lưu và deployment Apps Script phù hợp.

## 6. Kiểm thử và giới hạn nghiệm thu

Mã đã kiểm tra cú pháp và **138 bài kiểm thử tự động đều đạt**, trong đó 8 bài mới cho YC-034. Chúng bao gồm đăng nhập, chấm KPI theo cấp, kiêm nhiệm, cá nhân không gửi người quản lý, phát hiện email trùng, phân công thiếu, chuẩn bị, kích hoạt/khôi phục.

**Chưa kiểm thử Google Sheets thật của Trung tâm hoặc hiệu năng 140 tài khoản đồng thời trên dịch vụ thật.** Trước production cần đối soát tab nháp với danh sách 140 người, thử cập nhật phân công, điều kiện thông báo trên iPhone/Android/Desktop hỗ trợ, thử tải và quan sát thông báo OneSignal thực nhận. Không cam kết hỗ trợ Web Push nền trên iOS quá cũ không được nền tảng hỗ trợ.

## 7. Thành phần bàn giao

- ZIP mã nguồn đầy đủ V1.9.2-HF2 (kế thừa toàn bộ mã V1.9.2-HF1; chỉ thay đổi Apps Script, thêm 8 bài kiểm thử và hướng dẫn này).
- `Code.gs` bản đầy đủ để thay thế.
- Hướng dẫn này.

**Không thao tác tự động trên Google Sheets production, không thay đổi dữ liệu người dùng và không triển khai lên Vercel trong quá trình tạo bộ bàn giao.**
