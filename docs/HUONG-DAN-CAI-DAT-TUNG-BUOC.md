# HƯỚNG DẪN CÀI ĐẶT TỪ ĐẦU – NHẮC VIỆC KPI TÂN HIỆP

**Dành cho người mới.** Không yêu cầu biết lập trình. Làm **theo đúng thứ tự**. Gói mã nguồn có thể chạy sau khi nhập đủ cấu hình. Không gửi khóa bí mật, ID Token, mật khẩu qua chat hoặc đưa lên GitHub.

> QUAN TRỌNG: Trước tiên làm thử với 2–3 email của bạn và đồng nghiệp. Sau khi kiểm thử thành công mới mở quyền cho 140 người.

## BƯỚC 1. Tạo Google Sheet lưu dữ liệu

1. Mở https://sheets.google.com bằng tài khoản Google quản trị.
2. Bấm **Trống (Blank)** tạo bảng tính mới.
3. Đổi tên thành **NHAC VIEC KPI TAN HIEP - DATABASE**.
4. Tại thanh địa chỉ, đường dẫn tương tự `https://docs.google.com/spreadsheets/d/1ABCDE.../edit`. **SHEET_ID** là phần giữa `/d/` và `/edit`.
5. Sao chép SHEET_ID vào ghi chú **riêng tư**, không đăng công khai.
6. Chưa cần tự tạo các tab vì Apps Script sẽ tạo `Access` và `State` ở bước sau.

## BƯỚC 2. Tạo OneSignal duy nhất cho cả đơn vị

1. Mở https://onesignal.com , đăng nhập, chọn tạo ứng dụng **New App / Add App**.
2. Đặt tên **Nhắc việc KPI – Tân Hiệp**.
3. Chọn kênh **Web Push**.
4. Trong phần cấu hình website (Site URL), **sẽ phải nhập URL Vercel chính thức** (ví dụ `https://nhac-viec-kpi-tanhiep.vercel.app`), **không** nhập địa chỉ GitHub repo. Có thể quay lại hoàn thiện cấu hình này sau Bước 7 khi Vercel cấp URL.
5. Trong phần **Settings → Keys & IDs** lấy **App ID** (định danh công khai) và **REST API Key** (bí mật, KHÔNG phải App ID và KHÔNG phải Organization API Key).
6. Ghi riêng **ONESIGNAL_APP_ID** và **ONESIGNAL_REST_API_KEY**.
7. Không bật tính năng **Token Identity Verification** nếu cấu hình OneSignal có mục đó: hiện Web SDK không hỗ trợ, bật lên có thể làm web login của OneSignal thất bại.
8. Trong OneSignal, đảm bảo tính năng **Web Push** đã cấu hình cho chính xác domain Vercel dùng thật. Domain preview khác domain chính thức phải cấu hình riêng; không tùy tiện đổi domain sau khi đã có subscription.

Một ứng dụng OneSignal sẽ phục vụ toàn bộ A/B/C/... theo định danh `external_id` riêng; **KHÔNG tạo ứng dụng OneSignal cho từng viên chức**.

## BƯỚC 3. Tạo Apps Script

1. Truy cập https://script.google.com → **Dự án mới / New project**.
2. Đặt tên **BACKEND NHAC VIEC KPI TAN HIEP**.
3. Xóa mã mặc định đang có trong file `Code.gs` của Google.
4. Mở file `apps-script/Code.gs` trong bộ code đã nhận, **sao chép toàn bộ**, dán đè vào `Code.gs` trên trình duyệt và **Ctrl+S**.
5. Trong Apps Script, chọn **Project Settings (biểu tượng bánh răng)** → đặt Time zone là **(GMT+07:00) Ho Chi Minh** nếu giao diện hỗ trợ. Nếu thấy phần *Show "appsscript.json" manifest file in editor*, bật lên; file `appsscript.json` mẫu trong gói đã cấu hình `Asia/Ho_Chi_Minh`.
6. Đừng bấm Deploy vội; làm Bước 4.

## BƯỚC 4. Cài Script Properties – KHÔNG dán khóa vào code

Trong Apps Script: bánh răng **Project Settings** → mục **Script Properties** → **Add script property**. Thêm **5** thuộc tính đúng như tên sau:

| Property | Giá trị | Lấy ở đâu |
|---|---|---|
| `SHEET_ID` | Chuỗi ID Google Sheet | Bước 1 |
| `ONESIGNAL_APP_ID` | OneSignal App ID | Bước 2 |
| `ONESIGNAL_REST_API_KEY` | REST API Key của OneSignal | Bước 2 |
| `WEB_URL` | URL HTTPS Vercel chính thức, KHÔNG có dấu `/` cuối | Có tại Bước 7; tạm điền URL dự kiến rồi sửa lại sau |
| `SHARED_SECRET` | Chuỗi bí mật dài, sinh ngẫu nhiên ít nhất 32 bytes | Tự tạo bằng trình tạo mật khẩu **trên thiết bị tin cậy**; giá trị **phải trùng** với Vercel ở Bước 8 |

Không đặt dấu nháy quanh giá trị. Không cung cấp Script Properties cho người không có trách nhiệm quản trị.

**Gợi ý tạo SHARED_SECRET an toàn nếu máy bạn có Node.js**: mở Terminal/PowerShell rồi chạy `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Sao chép kết quả vào ghi chú riêng tư. Cần tạo thêm một chuỗi *khác* cho biến `PUSH_ID_SECRET` dùng tại Vercel.

## BƯỚC 5. Khởi tạo Sheets và 1 trigger duy nhất

1. Quay lại màn hình Apps Script **Editor**.
2. Tại thanh dropdown chọn hàm **`setupProject`**.
3. Bấm **Run / Chạy**.
4. Nếu Google hỏi quyền, chọn **Review permissions / Xem xét quyền** → chọn đúng tài khoản quản trị → làm theo hộp thoại để cấp quyền (Apps Script sẽ cần Sheets, HTTP requests, triggers). Nếu ứng dụng tự tạo bị cảnh báo chưa xác minh, chỉ tiếp tục khi đó đúng là dự án Apps Script **do chính bạn tạo**, đã xem lại mã nguồn và quyền yêu cầu; không coi cảnh báo là luôn vô hại.
5. Khi chạy thành công, mở lại Google Sheet Bước 1; phải có tab `Access` và `State`.
6. Trong thanh bên trái Apps Script chọn **Triggers (biểu tượng đồng hồ)**. Kiểm tra **chỉ 1 trigger** `syncScheduledNotifications`, loại time-driven, lặp **mỗi 1 giờ**.

**Không cần** tạo trigger cho 140 người; cũng không cần trigger kiểm tra mỗi phút. OneSignal nhận lịch đặt trước để gửi đúng giờ người dùng chọn.

## BƯỚC 6. Cấp quyền Google cho người dùng thử

Vào Google Sheet → tab **Access**. Hàng đầu phải là:

| A: Email | B: Họ tên | C: Active | D: Role |
|---|---|---|---|
| `email-thu-1@gmail.com` | `Người thử A` | `YES` | `USER` |
| `email-thu-2@gmail.com` | `Người thử B` | `YES` | `USER` |
| `email-thu-3@gmail.com` | `Người thử C` | `YES` | `USER` |

Thay bằng **email thật** của người dùng thử. Cột **Active** điền `YES` để cho phép đăng nhập, `NO` để khóa. Không chia sẻ quyền chỉnh sửa Sheet với toàn bộ 140 người vì ứng dụng đã phân quyền ở API.

Lưu ý: Email phải đúng Gmail hoặc Google Workspace thực tế mà viên chức dùng khi đăng nhập; viết hoa/thường không ảnh hưởng.

## BƯỚC 7. Đưa mã GitHub và kết nối Vercel

1. Truy cập https://github.com → **New repository**.
2. Đặt tên ví dụ `nhac-viec-kpi-tan-hiep`, chọn **Private** nếu bạn muốn hạn chế người đọc mã; cũng có thể chọn Public vì gói code không chứa khóa bí mật, nhưng Private phù hợp quản trị hơn.
3. Trên máy tính, giải nén `nhac-viec-kpi-tan-hiep.zip`. Các file `package.json`, `vercel.json`, thư mục `public`, `api` phải nằm ngay **thư mục gốc** của repo, không lồng thêm một thư mục tên dự án bên trong.
4. Trong GitHub repo mới bấm **Add file → Upload files** (hoặc dùng Git) rồi tải lên toàn bộ **mã nguồn**, **không** tải `.env` chứa khóa thật hoặc thư mục `node_modules`.
5. Truy cập https://vercel.com → **Add New → Project → Import Git Repository**, chọn repo vừa tạo.
6. Framework Preset chọn **Other**; Root Directory giữ mặc định thư mục gốc. Không cần build command vì đây là web tĩnh + Node serverless API.
7. Bấm Deploy để Vercel tạo domain `https://...vercel.app`. Lần đầu chưa cấu hình env, giao diện có thể báo thiếu biến; đó là bình thường. Ghi lại **URL chính thức**.
8. Quay lại OneSignal Bước 2, hoàn thiện **Site URL** chính xác theo URL Vercel. Quay lại Apps Script Bước 4, sửa **WEB_URL** thành URL này.
9. Lưu ý: Vercel Hobby có điều kiện sử dụng cá nhân/phi thương mại. Với triển khai chính thức tại đơn vị, cần xem xét gói và điều khoản phù hợp trước khi vận hành.

## BƯỚC 8. Tạo Google Cloud OAuth Client ID

1. Mở https://console.cloud.google.com/ → chọn hoặc tạo **Project**.
2. Tìm **Google Auth Platform** (một số giao diện gọi **APIs & Services → OAuth consent screen**).
3. Thiết lập tên ứng dụng **Nhắc việc KPI – Tân Hiệp**, email liên hệ; đối tượng **External** nếu nhân viên dùng nhiều tài khoản Gmail độc lập, hoặc **Internal** nếu tất cả thuộc cùng tổ chức Google Workspace và có quyền chọn chế độ này.
4. Nếu chọn **External**, lưu ý chế độ **Testing** giới hạn người dùng thử (thường chỉ tối đa 100 test users); để phục vụ 140 tài khoản cần **Publish app** vào Production khi đủ điều kiện. Dùng scopes đăng nhập cơ bản `openid`, `email`, `profile`; không yêu cầu quyền Google Drive hoặc đọc Gmail.
5. Chọn **Clients / Credentials → Create OAuth client → Web application**.
6. Tại **Authorized JavaScript origins**, thêm đúng domain Vercel, ví dụ `https://nhac-viec-kpi-tan-hiep.vercel.app` (không thêm đường dẫn hoặc dấu `/` cuối).
7. Không cần tạo Redirect URI cho mô hình **Google Identity Services callback nhận ID token** này.
8. Bấm Create, sao chép **Client ID** định dạng `....apps.googleusercontent.com`. Không cần OAuth Client Secret trong ứng dụng này.

## BƯỚC 9. Đặt 5 biến môi trường trong Vercel

Trong Vercel → Project → **Settings → Environment Variables**. Thêm chính xác:

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID Bước 8 |
| `ONESIGNAL_APP_ID` | App ID Bước 2 |
| `APPS_SCRIPT_URL` | URL web app Apps Script ở Bước 10 |
| `APPS_SCRIPT_SHARED_SECRET` | **CHÍNH XÁC** chuỗi `SHARED_SECRET` ở Apps Script Bước 4 |
| `PUSH_ID_SECRET` | Chuỗi bí mật ngẫu nhiên **khác** `SHARED_SECRET` |

Khuyên chọn phạm vi **Production** (và Preview chỉ khi bạn hiểu rõ môi trường). **Không** tạo biến có tiền tố `VITE_` hoặc `NEXT_PUBLIC_` cho hai secret; không chèn chúng vào `public/`.

Sau khi đủ 5 biến, vào **Deployments → Redeploy** (hoặc tạo commit mới) để máy chủ nhận biến mới.

## BƯỚC 10. Deploy Apps Script thành Web App

1. Trong Apps Script, bấm **Deploy → New deployment**.
2. Chọn loại **Web app**.
3. Description: `Nhac KPI API v1`.
4. **Execute as / Thực thi với tư cách: Me (chủ script)**.
5. **Who has access / Ai có quyền truy cập: Anyone (Bất kỳ ai)** để API trên Vercel có thể gọi server-to-server. Đây là endpoint công khai về mạng nhưng **mọi thao tác đều kiểm tra chữ ký HMAC** trước khi đọc dữ liệu.
6. Bấm **Deploy**, cấp quyền nếu được hỏi và sao chép **Web app URL** dạng `https://script.google.com/macros/s/.../exec`.
7. Dán URL này vào biến `APPS_SCRIPT_URL` ở Vercel Bước 9, rồi **Redeploy Vercel**.
8. Với các lần sửa code Apps Script sau này, bấm **Deploy → Manage deployments → Edit (bút chì) → Version: New version → Deploy** để cập nhật bản đang chạy. Bấm Save code thôi thường **không** cập nhật bản Web App hiện hành.

**Không chia sẻ APPS_SCRIPT_SHARED_SECRET, PUSH_ID_SECRET, OneSignal REST API Key.** Không sử dụng URL `/dev` cho môi trường chính thức.

## BƯỚC 11. Kiểm tra giao diện và Google Login

1. Mở link Vercel trên Chrome/Edge hoặc trình duyệt hỗ trợ.
2. Trang hiện tên **Nhắc việc KPI – Tân Hiệp** và nút **Sign in with Google**.
3. Đăng nhập một email đã có trong `Access` và `Active=YES`.
4. Nếu thành công, thấy màn hình **Thêm công việc** và **Các công việc đã đăng ký**.
5. Nếu báo không có quyền: kiểm tra đúng email trong `Access`, cột C nhập `YES`, không thừa khoảng trắng.
6. Nếu Google báo `origin_mismatch`: kiểm tra domain Vercel được thêm trong Authorized JavaScript origins Bước 8.
7. Nếu máy chủ báo trả HTML: kiểm tra Bước 10, URL `/exec`, Web App public Anyone và đã Redeploy đúng phiên bản.

## BƯỚC 12. Bật Web Push (bắt buộc nếu muốn nhận khi không mở app)

1. Đăng nhập thành công bằng Google trên chính **thiết bị cần nhận**.
2. Bấm **Bật thông báo**; khi trình duyệt hỏi quyền, chọn **Cho phép / Allow**.
3. Đảm bảo dòng trạng thái chuyển thành **Thiết bị này đã bật thông báo**.
4. Trên **iPhone/iPad**, cần mở link bằng Safari, dùng Share → **Add to Home Screen / Thêm vào Màn hình chính**; sau đó mở ứng dụng từ biểu tượng và cấp quyền thông báo. Hỗ trợ tùy phiên bản iOS và cài đặt hệ thống.
5. Mỗi thiết bị cần cấp quyền riêng. Một tài khoản dùng nhiều thiết bị có thể nhận trên nhiều thiết bị đã liên kết.
6. **Đóng trang** vẫn có thể nhận push; **Đăng xuất** thì SDK ngắt liên kết thiết bị với người dùng hiện tại (để bảo vệ người dùng dùng chung máy).

## BƯỚC 13. Thử 4 lượt nhắc và kiểm tra đúng A/B/C

Ví dụ chọn **ngày đến hạn 15/12/2026, giờ 07:30**. Hệ thống lập các thời điểm:

- 12/12/2026 07:30 (Thứ Bảy)
- 13/12/2026 07:30 (Chủ nhật)
- 14/12/2026 07:30 (Thứ Hai)
- 15/12/2026 07:30 (Thứ Ba)

Nếu hôm nay đã sau một số thời điểm trên, ứng dụng **không gửi bù** lịch đã trễ. Để kiểm thử nhanh, chọn hạn bằng **ngày hiện tại +3 ngày**, giờ nhắc sau thời điểm hiện tại khoảng 10–20 phút. Lượt đầu sẽ xảy ra hôm nay, sau đó mỗi ngày thêm 1 lượt.

Tài khoản A đăng ký việc 1, việc 2; tài khoản B đăng ký việc khác, tài khoản C chưa đăng ký. Đúng giờ, **chỉ A nhận lịch của A, chỉ B nhận lịch của B, C không nhận**. Kiểm tra trên thiết bị thật; không chỉ dựa vào thông báo “Đã lưu” ở web.

## BƯỚC 14. Triển khai cho toàn đơn vị

1. Khi các trường hợp thử đạt, bổ sung danh sách 140 email vào `Access`; tránh nhập trùng email.
2. Hướng dẫn từng viên chức vào Vercel → đăng nhập Google → bật thông báo → thêm công việc → chọn thời hạn và giờ nhận → Lưu.
3. Mỗi công việc có lịch riêng. Ví dụ 5 công việc ×4 =20 lần dự kiến, có thể trùng cùng giờ; hệ thống tạo các thông báo riêng, không phát toàn bộ.
4. Quản trị viên theo dõi Apps Script **Executions** khi phát sinh lỗi; kiểm tra trạng thái OneSignal trong dashboard.
5. Nếu viên chức không dùng nữa: đổi `Active` của email thành `NO` trong sheet. Trigger sẽ xử lý hủy lịch trong kỳ tiếp theo; để khẩn cấp, chạy thủ công hàm `syncScheduledNotifications` trong Apps Script rồi kiểm tra tiếp trạng thái.

## SỬA CODE VỀ SAU

- **Sửa GitHub UI/API:** cập nhật file trong repo; Vercel sẽ tự deploy (nếu đã bật Git integration).
- **Sửa Apps Script:** sửa `Code.gs`, Save, **tạo New version trong Manage deployments**. Không chỉnh giá trị secret để tránh ngắt kết nối.
- **Đổi domain Vercel:** phải điều chỉnh lại OneSignal Site URL, `WEB_URL`, Google Allowed JavaScript origins; web subscriptions trên domain cũ không chuyển tự động sang domain mới.

ĐỌC TIẾP: `docs/KIEM-THU-TRUOC-KHI-DUNG-THAT.md` và `docs/GIOI-HAN-BAO-MAT.md`.
