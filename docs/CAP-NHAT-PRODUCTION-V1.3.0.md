# HƯỚNG DẪN TRIỂN KHAI – NHẮC VIỆC KPI V1.3.0 (YC-005)

**Trạng thái:** mã nguồn được xây dựng và kiểm thử tự động; **CHƯA** cập nhật GitHub, Apps Script, Vercel hoặc thiết bị thật. Không nhầm với kết quả nghiệm thu production.

## 0. Kiểm tra trước khi triển khai

1. Xác nhận website và Apps Script thực tế vẫn khớp **baseline v1.2.0**; nếu đã sửa thêm từ đó, cần đối chiếu/diff và hợp nhất thay vì ghi đè.
2. Tải xuống/sao lưu nguyên bộ GitHub, mã `Code.gs`, tab `Access`, `State` trong Sheets và giá trị cấu hình (lưu bí mật ở nơi riêng an toàn, không chụp gửi cho người khác).
3. Chỉ triển khai khi có thời gian kiểm thử; ưu tiên thử tài khoản thử nghiệm đã được cấp Active trước.
4. Không xóa hoặc làm mới Sheets. Không đổi `PUSH_ID_SECRET`, `SHARED_SECRET`, `APPS_SCRIPT_SHARED_SECRET`, `ONESIGNAL_APP_ID`, cấu hình Google OAuth hay worker OneSignal.

## 1. Những gì thay đổi

- **Apps Script**: thêm `revision` vào JSON State (dữ liệu v1.2.0 không có sẽ mặc định 0), thêm hành động `status` và `authorize`, kiểm tra `expectedRevision` để tránh cập nhật đè; các mốc nhắc và hàng đợi hủy vẫn giữ nguyên.
- **API Vercel**: giữ `/api/data`; bổ sung `/api/realtime` để cấp **token Ably chỉ được subscribe** sau khi Google/phiên server xác thực và Access vẫn Active. Thêm `/server/identity.js`, `session.js`, `realtime.js`. Không có token/API key Ably trong frontend.
- **Client**: cập nhật giao diện tức thời khi thêm/sửa/xóa, xác nhận hoặc phục hồi khi máy chủ phản hồi; kênh sự kiện `revision + change`, BroadcastChannel cho nhiều tab cùng trình duyệt, đối soát `status` khi quay lại ứng dụng, không polling nền mỗi vài giây.
- **Thông báo OneSignal**: không thay App ID hoặc External ID. Các thay đổi bình thường lưu trước, sau đó gửi yêu cầu lập/hủy lịch tách biệt; nếu có nhắc sắp đến trong **90 phút**, thực hiện đồng bộ ngay trong yêu cầu để giảm nguy cơ lỡ lịch. Trigger mỗi giờ vẫn là phương án phục hồi khi người dùng đóng ứng dụng trước lúc đồng bộ nền chạy.
- **Phiên server**: chỉ sau khi Google ID token hợp lệ và Apps Script chấp thuận đăng nhập, Vercel phát hành phiên ký HMAC **8 giờ** lưu trong bộ nhớ trình duyệt, không lưu localStorage. Mọi request vẫn kiểm tra `Access` ở Apps Script. Sau 8 giờ phải đăng nhập lại.

### Tối ưu đọc và quota

| Trường hợp | Gọi Sheets? |
|---|---|
| Chuyển mục, mở form, lọc, xem bốn mốc | Không |
| Thêm/sửa/xóa công việc | Một yêu cầu ghi dữ liệu chính; lập/hủy OneSignal xử lý riêng nếu cần |
| Thiết bị khác nhận sự kiện `revision` liên tiếp | Không cần đọc lại Sheets |
| Thiết bị mất sự kiện hoặc khi app quay lại foreground | Gọi `status` để đối chiếu rồi `load` chỉ nếu phiên bản khác |
| Token Ably gia hạn mỗi 15 phút | Kiểm tra quyền Active trong Access, **không đọc State** |

Lưu ý `status` vẫn cần đọc quyền Active, rồi đọc JSON State để lấy revision nếu cần; không khẳng định bằng 0 lượt đọc trong mọi trường hợp.

## 2. Cập nhật Apps Script (PHẢI trước GitHub)

1. Mở dự án `BACKEND NHAC VIEC KPI TAN HIEP` trên script.google.com.
2. Sao lưu file `Code.gs` hiện tại ở nơi riêng.
3. Thay **toàn bộ** nội dung `Code.gs` bằng file `apps-script/Code.gs` trong ZIP v1.3.0; không trộn từng đoạn vào bản v1.2.0.
4. Lưu. Vào **Triển khai → Quản lý các bản triển khai**, chọn đúng Web App hiện tại, bấm biểu tượng chỉnh sửa (bút chì) → **Phiên bản mới** → Triển khai. **Không cần tạo deployment ID mới** nếu cập nhật bản hiện có.
5. Kiểm tra `doPost` Web App mới xuất hiện trong Executions khi thử trên môi trường an toàn. Không đổi quyền **Thực thi dưới tên: Tôi / Bất kỳ ai** nếu đó là cấu hình đang làm việc. Tuy endpoint có thể truy cập công khai, Apps Script bắt buộc xác thực HMAC rồi kiểm tra Access trước khi xử lý.
6. `setupProject()` và các thao tác reset dữ liệu **không cần chạy lại**.

Nếu bị lỗi sau bước này, chưa cập nhật frontend, khôi phục `Code.gs` trước đó hoặc cập nhật đúng deployment; bản mới giữ API cũ nên frontend v1.2.0 có thể tiếp tục hoạt động trong thời gian chuyển đổi.

## 3. Thiết lập Ably (chỉ khi đồng ý sử dụng nền tảng bổ sung)

1. Tạo tài khoản/ứng dụng Ably trên https://ably.com/ rồi tạo API key với quyền **publish** và **subscribe** phục vụ các kênh riêng.
2. Kiểm tra **hạn mức kết nối đồng thời, tin nhắn/tháng** và điều khoản free ở thời điểm sử dụng. Khoảng 140 người dùng với nhiều thiết bị **có thể vượt gói miễn phí 200 kết nối đồng thời**.
3. Vercel → dự án `nhac-viec-kpi-tan-hiep` → Settings → Environment Variables → thêm **ABLY_API_KEY** (đủ tên khóa và secret, dạng `appId.keyId:secret`), chỉ đặt **Production** nếu chỉ triển khai Production. **Không ghi giá trị thật vào GitHub, .env.example, tài liệu hoặc ảnh chụp**.
4. Không cần thêm Ably vào Script Properties. Apps Script không tiếp xúc với khóa Ably.
5. **Nếu chưa thiết lập Ably**, bỏ qua biến này: ứng dụng vẫn dùng được, nhưng **không cam kết đồng bộ tự động giữa iPhone/Android/máy tính đang mở**. Cùng trình duyệt có thể được cập nhật qua BroadcastChannel.

Ably là bên cung cấp bổ sung, không phải kho lưu công việc. Người dùng thường chỉ được `subscribe` một kênh riêng; chỉ Vercel được publish sau khi Apps Script xác nhận đã ghi.

## 4. Triển khai Vercel/GitHub

1. Trên GitHub, sao lưu hoặc tạo nhánh/tag bản v1.2.0.
2. Dùng ZIP **CHI-FILE-THAY** hoặc đồng bộ bản đầy đủ v1.3.0; giữ đúng đường dẫn `api/`, `server/`, `apps-script/`, `public/`. Không tải cả thư mục `nhac-viec-kpi-tan-hiep-v1.3.0` thành một thư mục con trong repository; phải đưa **nội dung bên trong** ra gốc repo.
3. Commit lên `main` nếu đó là nhánh sản xuất. Vercel tự triển khai khi GitHub được kết nối.
4. Mở Vercel → Deployments → chọn bản Production mới → xác minh **Ready**, kiểm tra Logs không có 502/504. Nếu mới chỉnh `ABLY_API_KEY`, cần **Redeploy** để Production dùng biến mới.
5. Khi thử nghiệm lần đầu, đóng tab cũ, mở lại ứng dụng hoặc tải cứng để dùng asset `app.js?v=1.3.0` và `styles.css?v=1.3.0`.
6. Không thêm service worker thứ hai, không làm mất OneSignal worker `/OneSignalSDKWorker.js`.

## 5. Checklist nghiệm thu bắt buộc

- [ ] Tài khoản được Active đăng nhập và thấy chính xác dữ liệu cũ.
- [ ] Tạo một việc: giao diện cập nhật tức thì rồi hiện thông báo đã lưu khi server xác nhận.
- [ ] Sửa thời gian công việc trên máy tính: iPhone đang mở cùng tài khoản được cập nhật sau sự kiện mà không F5.
- [ ] Xóa việc trên iPhone: máy tính nhận thay đổi; lịch chưa gửi được hủy.
- [ ] Cùng tài khoản mở 2 tab: BroadcastChannel cập nhật mà không thêm truy vấn Sheets.
- [ ] Một tài khoản **khác** không nhận được sự kiện/dữ liệu của tài khoản này.
- [ ] Hai thiết bị sửa cùng một dữ liệu cũ: một thao tác phải bị từ chối `409 CONFLICT` và được đối soát, không ghi đè âm thầm.
- [ ] Đăng xuất A, đăng nhập B: ngắt kênh Ably của A và ngắt liên kết OneSignal theo quy trình cũ.
- [ ] Giờ mặc định cá nhân không đổi giờ của công việc đã có hoặc tài khoản khác.
- [ ] Mất Wi-Fi, quay lại ứng dụng, kiểm tra `revision` và tải nếu cần; nếu Ably bị giới hạn quota, có phản hồi và khả năng đối soát.
- [ ] OneSignal thực tế gửi bốn mốc trên Android, iPhone cài vào Màn hình chính (iOS 16.4+ và có quyền), máy tính tương thích; không tuyên bố đạt trước kiểm thử thật.
- [ ] Đo Vercel Logs, Apps Script Executions, lượt đọc/ghi và quota Ably khi có 5, 20, 50 người dùng đồng thời; không giả định tự động chịu tải 140 người cùng 2 thiết bị.

## 6. Rollback về v1.2.0

1. Giữ nguyên dữ liệu Sheets, không xóa `revision`; bản v1.2.0 bỏ qua trường mở rộng này.
2. Trên GitHub, khôi phục commit/tag v1.2.0; xác nhận Vercel Production Ready trước.
3. Trong Apps Script, triển khai lại **phiên bản Code.gs v1.2.0** vào bản Web App hiện tại; kiểm tra URL `APPS_SCRIPT_URL` không đổi.
4. Có thể xóa hoặc tắt `ABLY_API_KEY` nếu muốn ngừng kết nối real-time, sau đó Redeploy Vercel nếu cần.
5. Thử đăng nhập, thêm/sửa/xóa, hủy lịch, OneSignal và kiểm tra nhật ký. **Không khôi phục một bản Google Sheets cũ lên dữ liệu người dùng mới đã phát sinh** trừ khi có phương án kiểm soát riêng.

## 7. Giới hạn cần chấp nhận

- **Không cam kết mọi thay đổi đến thiết bị khác nếu tab đang ngủ/đóng**; khi mở hoặc quay lại phải đối soát.
- Google Sheets và Ably không có giao dịch chung: sau khi Sheets lưu thành công, nếu Vercel bị ngắt trước khi publish, sự kiện có thể bị thiếu; lúc thiết bị mở lại hoặc tái kết nối phải `status`/`load` để khôi phục. Đây là **best-effort realtime + reconciliation**, chưa có transactional outbox.
- OneSignal gửi push tùy quyền hệ điều hành, mạng, trình duyệt, trạng thái thiết bị và chính sách dịch vụ.
- Chưa định nghĩa ma trận vai trò Role mới: tất cả tài khoản Active chỉ thao tác danh sách của chính mình; **không tự cấp chức năng admin, xem việc người khác**. Nếu cần quyền chuyên biệt phải chốt bảng quyền cụ thể trước khi viết tiếp.
- Mã hiện chưa kiểm thử tích hợp với dịch vụ thật vì không có tài khoản/khóa của chủ dự án trong môi trường này. Các bài kiểm thử tự động chỉ chứng minh các luồng/mô phỏng trong phạm vi test.
