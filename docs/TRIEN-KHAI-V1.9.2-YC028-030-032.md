# HƯỚNG DẪN NÂNG CẤP NHẮC VIỆC KPI – TÂN HIỆP V1.9.2

**Phạm vi:** YC-028 (phân quyền người chấm KPI theo từng Phòng/Khu và kiêm nhiệm), YC-030 (công việc KPI / cá nhân, **đã chọn phương án C**), YC-032 (đặt lịch và chuyển thông báo độc lập, xử lý tồn đọng cho khoảng 140 tài khoản).

**Nền:** V1.9.1/YC-033. Không triển khai YC-027, YC-029, YC-031 trong bản này. Các hành vi cũ khác được giữ nguyên, nhưng vẫn cần kiểm thử thực tế.

> **Quan trọng:** Mã nguồn đã được sửa và kiểm thử **cục bộ**, CHƯA được tải lên GitHub, CHƯA cập nhật Apps Script production, CHƯA sửa Google Sheets của Trung tâm và CHƯA được nghiệm thu Push thật trên iPhone/Android. Việc đáp ứng 140 tài khoản về mặt xử lý nghiệp vụ không tương đương bảo đảm 140 thiết bị nhận Push chính xác cùng phút.

## 1. Những file đã sửa

- `apps-script/Code.gs`: phân công KPI V2, điều phối nhận thông báo, phân loại công việc, hàng đợi hoàn thành, gửi OneSignal theo lô, quét khôi phục thông báo chờ, nâng ngân sách dự phòng từ 35 lên tối đa 70 yêu cầu/lượt (có giới hạn thời gian).
- `public/app.js`: lựa chọn loại công việc và Phòng/Khu, kiểm tra khi hoàn thành, cập nhật giao diện xem thông báo.
- `public/index.html`, `public/styles.css`: các trường và nhãn UI, phiên bản asset V1.9.2.
- `package.json`, `tests/`: phiên bản và bài kiểm thử mới.
- **Không đổi:** `api/`, `server/`, Chrome Extension, OneSignal Worker, App ID, khóa truy cập và tên các tab cũ.

## 2. Sao lưu TRƯỚC KHI cập nhật

1. Tải bản GitHub/Vercel V1.9.1 đang dùng, ghi lại commit trước nâng cấp.
2. Tạo bản sao đầy đủ file Google Sheets production (**Access, Tài khoản, Quản lý Phòng-Khu, State**) ở nơi được đơn vị cho phép. Không gửi thông tin nhạy cảm trong chat.
3. Lưu toàn bộ `Code.gs` Apps Script hiện tại và ghi lại mã triển khai đang dùng. Chỉ quản trị viên được xem Script Properties; **không chia sẻ mật khẩu, khóa API**.
4. Chuẩn bị môi trường kiểm thử hoặc bản sao Sheets với tài khoản/thiết bị kiểm thử trước khi sửa production.

## 3. Thứ tự triển khai an toàn

### Bước 1 – Kiểm thử code mới trước

Trên máy có Node.js phù hợp, tại thư mục gốc source:

```bash
npm run check
npm test
```

Bộ kiểm thử cục bộ phiên bản này có **124 bài**, đã chạy đạt **124/124**. Không coi đây là nghiệm thu trên hệ thống thật.

### Bước 2 – Cập nhật Apps Script trước giao diện

Trong Apps Script đang dùng: thay **toàn bộ** nội dung `Code.gs` bằng `apps-script/Code.gs` của V1.9.2, kiểm tra Script Properties hiện tại, lưu và triển khai **phiên bản mới** của Web App theo hình thức đơn vị đang dùng.

**Không chạy** `setupProject`, `prepareVietnameseAdminSheets` hoặc các hàm tạo bảng cũ nếu Trung tâm đã có các tab đang hoạt động.

Khi vừa thay `Code.gs`, `KPI_ROUTING_SCHEMA` chưa được kích hoạt thì các luồng phân quyền mới chưa vận hành. Đây là cách giảm nguy cơ đổi quyền đồng loạt trước khi chuẩn bị dữ liệu.

**Cảnh báo:** Không đưa giao diện V1.9.2 lên production trước Apps Script V1.9.2. Apps Script cũ chưa hiểu loại công việc Cá nhân, có thể khiến thao tác hoàn thành bị gửi nhầm thông báo chấm KPI.

### Bước 3 – Cập nhật GitHub/Vercel

Cập nhật **toàn bộ nội dung** repository từ gói V1.9.2, giữ cấu hình Vercel/Google và domain đang sử dụng; không ghi đè biến môi trường bởi mẫu ví dụ. Trước hết kiểm thử trên môi trường Preview. Sau nghiệm thu mới triển khai phiên bản chính.

V1.9.2 mặc định:

- Công việc **thêm thủ công**: Cá nhân.
- Công việc **nhập từ iCPV**: KPI.
- Công việc thủ công có thể chọn KPI để thông báo người quản lý khi hoàn thành.
- Công việc cá nhân hoàn thành không gửi thông báo chấm điểm.
- Công việc cũ thiếu phân loại được nhận diện là **Việc cũ**, không tự chuyển sang KPI/Cá nhân.

### Bước 4 – Quản trị viên CHỦ ĐỘNG chuẩn bị phân công KPI

Chỉ thực hiện khi đã sao lưu và đã phê duyệt chính thức danh sách lãnh đạo phụ trách:

1. Mở Google Apps Script, chọn hàm `prepareKpiRoutingSheets` và bấm **Run/Chạy** **một lần**.
2. Hàm sẽ tạo **duy nhất một tab mới** `Phân công KPI` và đặt **hai tiêu đề cột F, G** tại tab `Quản lý Phòng-Khu` nếu các vị trí đó còn trống hoặc đúng tiêu đề yêu cầu. Không tự kích hoạt phân quyền mới; không sửa tab State.
3. Kiểm tra tab `Phân công KPI`: ba cột `Email đăng nhập`, `Mã Phòng/Khu`, `Chức vụ tại Phòng/Khu`. Mỗi email đăng nhập vẫn chỉ có **một dòng tại tab Tài khoản**, nhưng có thể có **nhiều dòng phân công khác Phòng/Khu**.
4. Đối với từng Phòng/Khu, điền cột C **Email Trưởng phòng/Khu** HOẶC cột F **Email Quyền Trưởng phòng/Khu**: **chỉ một trong hai cột có email người có thẩm quyền**. Cột G = email thành viên **Ban Giám đốc phụ trách** Phòng/Khu.
5. Nếu có thành viên Ban Giám đốc chưa có dòng tài khoản, thêm vào tab `Tài khoản` theo quy trình quản lý của đơn vị; vai trò hiển thị có thể là `Ban Giám đốc`, trạng thái `Hoạt động`, quyền quản trị là trường riêng (Có/Không).
6. Trong tab `Phân công KPI`, bảo đảm mỗi người nhận thông báo có phân công vai trò hợp lệ tại Phòng/Khu. Người phụ trách nhiều Phòng/Khu có thể có nhiều dòng tại tab này.
7. Gọi **`inspectKpiRoutingSheets`** để xem các lỗi cần sửa. Khi hợp lệ, mới chọn **`activateKpiRoutingSheets`**. Hàm này kiểm tra lại và bật thuộc tính `KPI_ROUTING_SCHEMA=V2`; nếu không hợp lệ sẽ từ chối, không tự sửa dữ liệu.

**Ví dụ A giữ Phó phòng A và Quyền Trưởng phòng B:**

| Email | Mã Phòng/Khu | Chức vụ tại Phòng/Khu |
|---|---|---|
| a@example.com | A | Phó Trưởng phòng/Khu |
| a@example.com | B | Quyền Trưởng phòng/Khu |
| truong-a@example.com | A | Trưởng phòng/Khu |
| pho-giam-doc@example.com | A | Ban Giám đốc |
| pho-giam-doc@example.com | B | Ban Giám đốc |

Phòng A: cột C = `truong-a@example.com`, F để trống, G = `pho-giam-doc@example.com`.

Phòng B: cột C để trống, F = `a@example.com`, G = `pho-giam-doc@example.com`.

**Chức vụ được phép sử dụng:** `Nhân viên`, `Phó Trưởng phòng/Khu`, `Trưởng phòng/Khu`, `Quyền Trưởng phòng/Khu`, `Ban Giám đốc`.

**Không** nhập trùng email ở `Tài khoản`; **không** sao chép lại hay xóa dữ liệu ở `State`.

### Bước 5 – Công việc cũ

Công việc tạo từ bản cũ chưa có loại công việc. Trước khi đánh dấu **Đã hoàn thành** sau khi bật V2, người dùng mở **Sửa** và xác định **KPI** hoặc **Cá nhân**. Nếu là KPI và người đó có nhiều chức vụ, chọn đúng Phòng/Khu. Không tự phân loại theo nguồn hoặc chức vụ đối với việc cũ, tránh gửi sai người.

Xóa vì nhập nhầm vẫn thực hiện được mà không gửi thông báo chấm KPI.

### Bước 6 – Giờ nhắc lại người quản lý

Nếu Trung tâm thống nhất nhắc lại 08:00, quản trị viên có thể kiểm tra/đặt Script Property `MANAGER_REMINDER_TIME=08:00` theo quy định đã duyệt. Nếu thuộc tính này trống hoặc sai định dạng, hệ thống không tự bật nhắc lại ngày hôm sau. **Không đổi OneSignal App ID** hoặc cấp khóa cho người dùng cuối.

## 4. Kiểm thử thực tế trước khi triển khai diện rộng

**Phân quyền:** Nhân viên A → Trưởng A; Phó A → Trưởng A; Trưởng A → BGĐ A; Quyền B → BGĐ B; nhân viên B → Quyền B. Một người kiêm nhiệm không được gửi và nhận nhầm giữa hai đơn vị.

**Phân loại:** Tạo Cá nhân → hoàn thành không gửi cấp trên. Tạo KPI thủ công → hoàn thành gửi cấp trên. Nhập iCPV → mặc định KPI. Xóa do nhập nhầm → không thông báo cấp trên.

**Thông báo:** Thử A và B cùng đến hạn trong khi C hoàn thành KPI. Xác minh từng External ID, inbox và Push. Một yêu cầu OneSignal lỗi không được làm mất các sự kiện khác. Kiểm tra thông báo khi quản lý chưa từng đăng nhập, và khi OneSignal trả lỗi.

**Đa thiết bị:** Nhóm nhỏ trên Windows/Android/iPhone, một người nhiều máy và đổi tài khoản trên máy dùng chung. Thử nhiều mạng và trạng thái Push. iPhone phiên bản không hỗ trợ Web Push nền không thể nhận Push nền chỉ bằng cách sửa JavaScript.

**Kiểm thử tải:** 124 bài cục bộ bao gồm mô phỏng 140 External ID; đó **không phải** bằng chứng OneSignal/Apps Script thực tế có đủ quota, không phải kiểm thử nhận Push trên 140 điện thoại. Cần tăng dần người thử và giám sát Apps Script Executions, lỗi `BUSY`, quota, OneSignal Dashboard, độ trễ lịch đặt và hàng đợi thông báo. Không gửi thử đại trà nếu chưa được phê duyệt.

## 5. Khôi phục khi có lỗi

1. **Dừng mở rộng người dùng**, ghi lại lỗi và thời điểm, không xóa State.
2. Nếu lỗi liên quan phân quyền V2, chạy `rollbackKpiRoutingSheets` để tắt cơ chế định tuyến V2, giữ nguyên các tab và sự kiện đã lưu. **Lưu ý:** Các công việc KPI đã gắn phân công V2 **không được chuyển về người quản lý cũ** khi tắt V2; chúng sẽ không tự gửi sai người. Phải sửa cấu hình và kích hoạt lại V2 để xử lý đúng các sự kiện này.
3. Nếu lỗi giao diện, quay lại commit V1.9.1. Nếu lỗi phía Apps Script, khôi phục deployment từ bản sao mã đã sao lưu, bảo đảm phối hợp phiên bản UI/Apps Script tương thích. Không dùng frontend mới với backend cũ cho công việc Cá nhân.
4. Khôi phục bản sao Google Sheets **chỉ theo quy trình phê duyệt**, vì ghi đè toàn bộ Sheet có thể làm mất những công việc mới phát sinh sau thời điểm sao lưu.

## 6. Giới hạn và nội dung chưa triển khai trong bản này

- YC-027 nhận diện tài khoản iCPV và YC-029 tách nhãn ngày hạn/lịch nhắc, YC-031 lỗi SDK iPhone chuyên sâu: **không thuộc phạm vi sửa đợt V1.9.2**. Bản V1.9.1/YC-033 về tương thích chung được giữ lại.
- Nhắc việc đúng phút phụ thuộc đặt lịch sớm, dịch vụ OneSignal, kết nối mạng, quyền của thiết bị và hạn mức nhà cung cấp.
- Nâng ngân sách tác vụ trigger là điều chỉnh kỹ thuật cần giám sát quota và thời gian chạy; không cam kết vô hạn số thông báo hoặc 100% thiết bị nhận.
- Chrome Extension vẫn chỉ hỗ trợ trình duyệt tương thích để đọc iCPV đang mở hợp lệ; điện thoại vẫn sử dụng ứng dụng Nhắc việc độc lập.

**Kết luận:** Gói nguồn V1.9.2 sẵn sàng để kiểm thử và triển khai theo từng bước bởi quản trị viên. Chưa chỉnh sửa môi trường production hoặc kiểm chứng tương thích thực tế trên mọi thiết bị.
