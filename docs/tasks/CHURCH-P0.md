# Church CMS — Hồ sơ P0

Ngày tổng hợp: 2026-11-10. Task: `CHURCH-P0`.

Hồ sơ chi tiết về yêu cầu, quyết định và mockup của P0. Trạng thái hiện hành duy nhất nằm tại [project-state](../project-state.md); kế hoạch tổng thể tại [project-plan](../project-plan.md). C16 chấp thuận phạm vi/thiết kế đã trình, không có nghĩa toàn bộ thiết kế kỹ thuật P0 đã hoàn tất. Phần nền tảng tại [P0-FOUNDATION-r2](../engineering/P0-FOUNDATION.md) đã được Khiêm duyệt ở C20; không đồng nghĩa đã implement hoặc hoàn tất thiết kế mọi module P2–P7. Kế hoạch/gói implementation P1 phải được lập và duyệt riêng; hồ sơ này không cấp quyền viết ứng dụng.

## 1. Thẩm quyền và cách đọc

- Nguồn phê duyệt: các phát biểu trực tiếp của Khiêm trong chat hiện tại, tóm tắt tại sổ quyết định bên dưới. Không có mã message hoặc biên bản ký riêng để viện dẫn.
- Khiêm yêu cầu planning trước, “No implement” / “Chưa implement” xuyên suốt.
- Lần ghi hồ sơ này được cho phép rõ: “cho phép tổng hợp và lưu hồ sơ P0 vào repo, gồm yêu cầu đã chốt, mockup đã duyệt, thay đổi thay thế quyết định cũ và các điểm còn mở; đồng thời cập nhật ba file trạng thái và skill journal. Phạm vi chỉ là tài liệu, chưa implement ứng dụng.”
- Được duyệt về thiết kế không đồng nghĩa code đã có, runtime đã kiểm chứng, UAT đã đạt hoặc đã được phép phát hành.
- `ĐÃ DUYỆT`: quyết định hoặc mockup được Khiêm chấp thuận. `ĐỀ XUẤT`: chưa có phê duyệt đủ rõ. `TẠM GÁC`: không tiếp tục đặc tả/triển khai hiện tại. `BỊ THAY THẾ`: chỉ để tra lịch sử.
- Không ghi ngược thời điểm của các lượt chat. Thứ tự C01–C20 là thứ tự trao đổi/quyết định trong chat, không phải timestamp hoặc ID của hệ thống chat.
- Thư mục hiện chưa được Git nhận diện là repository; tên gọi “repo” chỉ workspace dự án, không hàm ý đã có commit.

## 2. Nguồn yêu cầu đã đọc

| Nguồn | Vai trò |
|---|---|
| [Sơ đồ hệ thống QLHT(1).html](../../../documents/Sơ%20đồ%20hệ%20thống%20QLHT%281%29.html) | Sơ đồ v0.3 ngày 21/10/2026; cây chức năng, dữ liệu, vai trò, các mục đã demo và đề xuất |
| [Quản lý Hội Thánh Tin Lành(1).html](../../../documents/Quản%20lý%20Hội%20Thánh%20Tin%20Lành%281%29.html) | **Nguồn UI/UX chuẩn**, 13 màn hình, 6 tab lễ nghi, 5 dạng drawer/popup |
| [QLHT bản xem thử.html](../../../documents/QLHT%20bản%20xem%20thử.html) | Tham khảo luồng hồ sơ, gia đình, lễ nghi, điểm danh và tài khoản; có mã giả lập Google Apps Script trong trình duyệt |

Tên file trên filesystem có thể ở dạng Unicode tổ hợp. Khi kiểm tra liên kết cần chuẩn hóa Unicode để đối chiếu tên; không đổi tên tài liệu nguồn.

`Proposal - Crm for churhes.pdf` và `QLHT_Ke_hoach_von.html` chưa dùng làm nguồn phê duyệt trong P0 này. Không lấy ngân sách, mức phí hoặc lịch từ các tài liệu đó làm quyết định hiện hành.

Các HTML là nguồn yêu cầu/prototype, không phải bằng chứng ứng dụng React/Bun hoạt động. Các con số, tên người và Hội Thánh mẫu không phải dữ liệu production.

## 3. Mục tiêu và stack đã chốt

- Hệ thống multitenant Quản lý Hội Thánh Tin Lành.
- Frontend: ReactJS, TypeScript, Vite, TailwindCSS.
- Backend/runtime: Bun, TypeScript. Dữ liệu: MongoDB. Hỗ trợ phiên/cache/giới hạn truy cập: Redis.
- Một Hội Thánh là một tenant theo định hướng P0; ban và khu vực nằm bên trong Hội Thánh. Cần đặc tả tiếp nếu có cấp tổ chức liên Hội Thánh.
- Phía nhà cung cấp/owner tạo tài khoản và gán Hội Thánh, vai trò, phạm vi. Người dùng Hội Thánh không quản lý lời mời/tài khoản cho người khác.
- UI/UX bám sát HTML chuẩn, chuyển wordless theo bảng đã duyệt; không tự chế UI/UX mới.
- Không được tự cài dependencies, viết ứng dụng, tạo migration, commit/push, gửi thông báo thật hoặc deploy theo hồ sơ này.

## 4. Kiến trúc và tính năng theo định hướng

Định hướng được Khiêm đồng ý là modular monolith, frontend → API Bun → module nghiệp vụ → MongoDB/Redis; tiến trình nền cùng codebase khi cần. Chưa chốt phiên bản, framework API, driver, thư viện xác thực/export, hạ tầng hoặc nhà cung cấp dịch vụ.

Đề xuất kỹ thuật cần cụ thể hóa: collections chung có `tenantId`; ngữ cảnh tenant xác minh ở backend; quyền đi trước truy vấn/count/search/export; file/cache/tác vụ nền cùng scope; transaction cho tài chính và các ghi liên quan; unique constraints trong tenant; phân trang/lọc tại nguồn. Đây là hướng thiết kế, chưa có schema/API/ADR chi tiết được duyệt riêng.

| Nhóm | Nội dung từ yêu cầu/HTML | Đợt dự kiến |
|---|---|---|
| Nền tảng | Tenant, tài khoản, phân quyền, cấu hình, audit | P1 |
| Thuộc viên | Tín hữu/thân hữu; hồ sơ; tìm/lọc; sinh nhật; Báp-têm; chuyển đổi/chuyển sinh hoạt/qua đời; nhập/xuất | P2 |
| Tổ chức | Gia đình, tách/gộp hộ, Ban Chấp sự/nhiệm kỳ, ban tuổi/phục vụ, khu vực | P2 |
| Tổng quan | Chỉ số, thân hữu, sinh nhật, hiện diện, việc cần quan tâm | P2–P4 theo dữ liệu nguồn |
| Lễ nghi và hiện diện | Sáu tab lễ nghi, lớp dự bị, điểm danh tay/QR, thẻ và chứng nhận | P3 |
| Mục vụ | Lịch giảng, phân công, sinh hoạt ban, thăm viếng, cầu thay | P4 |
| Tài chính | Quỹ, mã dâng hiến, đề xuất/duyệt, thu/chi, khóa sổ, báo cáo | P5 |
| Báo cáo/cổng cá nhân | Bảy biểu mẫu, báo cáo Tổng Liên Hội, Word/PDF/Excel, cổng tín hữu | P6 |
| Mở rộng | OCR chữ viết tay, Zalo/email/SMS, chứng từ, duyệt nhiều cấp, chữ lớn | P7 có điều kiện |
| Pilot/phát hành | UAT nhiều Hội Thánh, chuyển dữ liệu, phục hồi, vận hành | P8, cần quyền riêng |

Không coi toàn bộ các mục “Đề xuất” trong HTML là đã được duyệt chức năng chi tiết chỉ vì nằm trong bảng roadmap. Chưa có thời gian/chi phí cam kết.

## 5. Sổ quyết định và thay thế

| Mốc | Bằng chứng trong chat / nội dung | Hiệu lực hiện tại |
|---|---|---|
| C01 | Yêu cầu hệ thống multitenant, stack nêu trên, “Lập kế hoạch triển khai trước. No implement.” | ĐÃ DUYỆT về mục tiêu/stack; chỉ planning |
| C02 | “Định hướng trên OK” nhưng bám HTML chuẩn, “phải wordless, và không chế UI/UX mới” | ĐÃ DUYỆT; mockup ASCII tổng quan ban đầu của agent không làm mẫu triển khai |
| C03 | “Duyệt bảng W01–W18 và các ngoại lệ giữ chữ” | ĐÃ DUYỆT bảng tại mục 6 |
| C04 | “Duyệt D1–D4 và mockup A01–A02” | ĐÃ DUYỆT tại thời điểm đó; lời mời/khôi phục tự phục vụ và A02 user sau đó bị thay thế |
| C05 | Yêu cầu đặc tả nhận lời mời, đặt mật khẩu, thiết lập/khôi phục 2FA | Chỉ cho phép planning; bản A03–A08 được trình chưa được duyệt toàn bộ |
| C06 | “Tạm bỏ qua những phần A05-08”; quên mật khẩu/mất tài khoản chỉ liên hệ dịch vụ | A05–A08 TẠM GÁC; bỏ khôi phục tự phục vụ |
| C07 | “Duyệt mockup trên” đối với card hỗ trợ | ĐÃ DUYỆT card hỗ trợ tại mục 7 |
| C08 | Nhà cung cấp/owner tạo tài khoản; giảm nghiệp vụ kỹ thuật cho Hội Thánh/users | BỎ lời mời: thay thế A03 và phần mời của D1 |
| C09 | Hỏi hệ quản trị owner; xác nhận còn thiếu trong P0 | Không phải bằng chứng đã có ứng dụng/portal |
| C10 | Yêu cầu bảng quyền và mockup owner | Cho phép planning O01–O03 |
| C11 | “Duyệt O-D1–O-D5 và mockup O01–O03” | ĐÃ DUYỆT quyền/thiết kế tại mục 8 |
| C12 | Yêu cầu luồng owner cấp tài khoản → đăng nhập đầu → đổi mật khẩu | Cho phép planning luồng tại mục 9 |
| C13 | “Tôi duyệt mockup trên, nhưng mật khẩu mới minimum 8 ký tự” | ĐÃ DUYỆT mockup; tối thiểu 8 thay 15. Các chi tiết trình kèm giữ dưới mục 9; giới hạn trên 128 |
| C14 | Hỏi planning đã note chưa; agent xác nhận chỉ trong chat, chưa lưu file/journal | Không có hồ sơ lưu trước lần tổng hợp này |
| C15 | Cho phép lưu P0, cập nhật ba file dự án và skill journal, chỉ tài liệu | Quyền ghi của lần tổng hợp này; không cấp quyền ứng dụng |
| C16 | “2FA … tạm bỏ qua trong kế hoạch triển khai này … tương lai”; “Bàn giao và hỗ trợ tài khoản theo hướng đã chốt”; “Các phần khác trong P0: OK.” | ĐÃ DUYỆT phạm vi/thiết kế P0 đã trình; D2 không áp dụng scope hiện tại; chưa cho phép implementation P1 |
| C17 | Khiêm hỏi P0 có gì để triển khai; agent làm rõ thiết kế dữ liệu/API và rules chi tiết chưa đầy đủ | Làm rõ giới hạn C16; không đánh dấu toàn bộ đầu ra P0 hoàn tất chỉ vì mockup/phạm vi đã duyệt |
| C18 | “Tiếp tục hoàn thiện thiết kế kỹ thuật P0 cho nền tảng: mô hình dữ liệu, API và tiêu chí nghiệm thu. Cập nhật hồ sơ đã lưu, chưa implement ứng dụng.” | Cho phép viết tài liệu kỹ thuật nền tảng và đồng bộ hồ sơ/journal. Contracts mới phải trình duyệt; không quyền code ứng dụng |
| C19 | Owner là nhân viên công ty; “một tài khoản thuộc về một hội thánh duy nhất”; tenant cô lập, chỉ Owners được across tenant | ĐÃ XÁC NHẬN; thay thế account chung/membership, user chọn/chuyển tenant và mọi suy luận user cross-tenant trước đó. r2 cập nhật kỹ thuật chờ duyệt |
| C20 | “Duyệt r2.” | HUMAN ACCEPTED thiết kế nền tảng r2; không cho phép coding hoặc tự mở gói tiếp |

### D1–D4 sau các thay đổi

| Mã | Nội dung ban đầu | Quyết định hiện hành |
|---|---|---|
| D1 | Email + mật khẩu; cấp qua lời mời, không đăng ký tự do | Email + mật khẩu giữ; **owner cấp trực tiếp**, không lời mời/đăng ký tự do |
| D2 | TOTP bắt buộc cho Mục sư, Thủ quỹ, quản trị nền tảng | **BỊ THAY THẾ trong scope hiện tại tại C16: không triển khai 2FA**. A05–A08 để tương lai, chỉ làm lại khi có phạm vi/phê duyệt mới |
| D3 | Một Hội Thánh thì vào thẳng; nhiều thì chọn; đổi qua tên Hội Thánh ở thanh trên | **BỊ THAY THẾ bởi C19:** user chỉ có một Hội Thánh, không chọn/chuyển tenant; owner chọn tenant qua O01 |
| D4 | 15 phút không hoạt động phải xác thực lại; phiên tối đa 8 giờ | Giữ; không đồng nghĩa mọi token onboarding đều có TTL này |

### Các đề xuất cũ không còn áp dụng

- A03 nhận lời mời và các tính năng gửi/gửi lại/thu hồi/theo dõi lời mời: BỊ THAY THẾ bởi owner cấp trực tiếp.
- A04 ban đầu bắt đầu từ lời mời và tối thiểu 15 ký tự: BỊ THAY THẾ bởi lần đăng nhập bằng mật khẩu tạm và tối thiểu 8 ký tự.
- Form quên mật khẩu gửi liên kết email: BỊ THAY THẾ bởi card liên hệ hỗ trợ.
- A05 thiết lập TOTP, A06 bộ 10 mã khôi phục, A07 dùng mã buộc thiết lập lại, A08 khôi phục thủ công hai người duyệt: TẠM GÁC, chưa có phê duyệt toàn bộ; không mang hạn 48 giờ lời mời/15 phút token hoặc quy trình hai người vào phạm vi hiện hành.
- Khung UI mới do agent minh họa trước khi chốt nguồn: không làm chuẩn triển khai; chỉ HTML chuẩn và các mockup đã duyệt dưới đây.

## 6. Wordless W01–W18 — ĐÃ DUYỆT

Giữ bố cục, thứ tự khối, bảng, drawer, popup, màu, Be Vietnam Pro/Lora, bo góc, bóng, light/dark và responsive của HTML chuẩn. Không đổi thành bottom navigation hoặc rail mới. Giữ một tên trang ngắn trên thanh trên; bỏ tiêu đề/mô tả lặp trong nội dung.

Nút có icon rõ nghĩa dùng icon gốc, tên truy cập và tooltip khi hover/focus; cách nhận biết trên touch cần kiểm chứng, không chỉ dựa hover. Nút chưa có icon phù hợp giữ nhãn ngắn. Nhãn trường/cột/tab, dữ liệu, tiền/kỳ, phạm vi quyền, trạng thái, cảnh báo, nội dung giấy tờ/in vẫn giữ. Không truyền đạt trạng thái chỉ bằng màu.

### Khung

- Logo và `QLHT` giữ; ẩn dòng tên sản phẩm đầy đủ lặp lại.
- Bỏ nội dung giới thiệu, phiên bản demo và badge dữ liệu mẫu khỏi sản phẩm thật.
- Menu giữ thứ tự, kích thước sidebar, icon, màu chọn, badge; **hiện icon + nhãn mục**, ẩn chữ nhóm và giữ khoảng phân nhóm. Mobile giữ drawer gốc và nhãn mục. Phê duyệt sửa thiếu text sau UI-STD-r1 thay quy tắc ẩn nhãn mục trước đây; xem docs/ui-system.md và biên bản UI-STD-r1.
- Bộ chọn “Đang xem với vai trò” là công cụ demo, không phải cách cấp/đổi quyền sản phẩm.
- Thanh trên giữ tên trang và tên Hội Thánh/Địa hạt; bổ sung owner context theo O01–O03 đã duyệt.

| ID | Màn hình / thành phần | Giữ và wordless |
|---|---|---|
| W01 | Tổng quan `overview` | Giữ hero, 4 KPI, thân hữu/sinh nhật, 8 shortcut, biểu đồ, việc cần quan tâm, khu vực/lễ nghi. Shortcut dùng icon gốc; “Xem…” dùng mũi tên. Giữ nhãn KPI/kỳ, danh tính, giai đoạn và chú giải |
| W02 | Thuộc viên `members` | Giữ 3 loại, toolbar/chip, 9 cột, mở hồ sơ, Xem thêm. Thêm dùng plus; bỏ hướng dẫn bấm dòng/Lọc nhanh. Giữ tên lọc/cột, số lượng, ngày sinh/trạng thái |
| W03 | Gia đình `families` | Giữ tìm kiếm/lưới thẻ/thành viên. Bỏ giải thích tách hộ; rút năm thành “Từ …”. Giữ mã hộ, khu vực, tên/vai trò/tuổi/trạng thái |
| W04 | Ban ngành & Khu vực `bans` | Giữ thứ tự Ban Chấp sự, ban tuổi, phục vụ, bảng khu vực. Thiết lập dùng gear; xem danh sách dùng mũi tên. Giữ nhiệm kỳ, chức vụ, lịch, số lượng, tỷ lệ/kỳ |
| W05 | Điểm danh `attendance` | Giữ buổi, bộ đếm, thanh tỷ lệ, tìm tên, checkbox. Quét dùng scan; bỏ hướng dẫn dài. Giữ tên buổi/người/mã/khu vực, có mặt/tổng và chữ Làm lại |
| W06 | Sổ lễ nghi `rites` | Giữ 6 tab và bảng/card. Bỏ mô tả chung; chứng nhận dùng print; OCR scan chỉ khi chức năng được duyệt. Giữ tên tab/cột/ngày/người/nơi/trạng thái |
| W07 | Thờ phượng & Lịch giảng `worship` | Giữ bảng 6 CN, lịch tuần, chương trình/chọn ban. Bỏ giới thiệu; nhãn Bản nháp ngắn. Giữ phân công, Kinh Thánh/chủ đề, giờ, tiết mục, Tiệc Thánh |
| W08 | Chăm sóc & Cầu thay `care` | Giữ bảng/list. Đã thăm dùng tick có trợ giúp. Giữ lý do, người phụ trách, ưu tiên/ngày/trạng thái, nội dung được phép; Riêng tư + lock |
| W09 | Dâng hiến & Quỹ `giving` | Giữ KPI/biểu đồ/quỹ/sổ/xác nhận tại chỗ. Cấu hình quỹ dùng gear. Giữ Thu/Chi, tiền, kỳ, tên quỹ, mã phiếu/đề xuất, diễn giải, +/−; chữ Khóa sổ/xác nhận |
| W10 | Đề xuất chi & Duyệt `expense` | Giữ 4 bước/KPI/bảng/popup. Tạo dùng plus. Giữ Đề xuất → Duyệt → Phiếu chi → Vào sổ; người/quỹ/tiền/trạng thái/lý do; chữ Duyệt/Từ chối/Lập phiếu chi |
| W11 | Biểu mẫu & Báo cáo `forms` | Giữ 8 ô, icon + tên, preview; bỏ mô tả dưới tên. Ẩn khối giới thiệu “Tính năng đề xuất cho bản chính thức”; tính năng vẫn trong backlog, không bị xóa khỏi phạm vi nghiên cứu |
| W12 | Cấu hình Hội Thánh `config` | Giữ card/radio/checkbox/input/danh sách/chọn vai trò. Thêm plus, x/trash gốc; bỏ ví dụ lặp. Giữ nhãn, tuổi, tên, quyền/người duyệt và Có số liệu |
| W13 | Phân quyền `roles` | Giữ ma trận. Bỏ giới thiệu; rút câu nhưng giữ Của mình/Ban mình/Toàn bộ và quyền thao tác; không đổi toàn bảng thành dấu tick |
| W14 | Drawer hồ sơ `openMember` | Giữ bên phải và thứ tự cá nhân → lễ nghi → thân hữu → hiện diện → gia đình → dâng hiến → QR. Giữ nhãn dữ liệu, giai đoạn và chữ Chuyển thành tín hữu |
| W15 | Thêm thuộc viên `openAdd` | Giữ popup/thứ tự/form 2→1 cột/xếp ban. Rút ví dụ; giữ nhãn, kết quả xếp ban, đồng ý lưu trữ, Hủy/Lưu |
| W16 | Tạo đề xuất chi `openPropose` | Giữ quỹ/tiền/nội dung/người liên quan. Giữ Số tiền (đồng), Nội dung chi, Hủy/Gửi đề xuất |
| W17 | Preview biểu mẫu `openCert` | Giữ chọn người/trang/chữ ký; tên ngắn Xem trước; giữ Word/PDF. Không rút nội dung giấy chứng nhận |
| W18 | Báo cáo Tổng Liên Hội `openReport` | Giữ popup/kỳ/bảng; rút tiêu đề; giữ Excel/PDF và chỉ tiêu/số liệu/kỳ |

Sáu tab W06: Báp-têm, Lớp dự bị (rút tên từ Lớp dự bị Báp-têm), Dâng con, Thành hôn, An táng, Tiệc Thánh. Không tự tạo sáu icon mới. Giữ dữ liệu từng tab, phỏng vấn/học bù và rao hôn phối. Giấy chứng nhận/chứng thư dùng print. Giữ lịch/ngày lễ kế tiếp dưới dạng dữ liệu ngắn.

Bảy mẫu W11/W17: GCN Báp-têm, GCN Dâng con, Chứng thư Thành hôn, Thư giới thiệu chuyển sinh hoạt, Giấy xác nhận tín hữu, Đơn xin chịu Báp-têm, Phiếu thăm viếng. Ô thứ tám mở báo cáo Tổng Liên Hội.

Xác nhận khóa sổ giữ câu nêu hậu quả và Hủy/Xác nhận khóa sổ. Rỗng/lỗi/không có quyền/thành công dùng thông báo ngắn tại thành phần gốc, không chỉ màu/icon. Quét QR/OCR/export trong demo chưa phải chức năng thật đã kiểm chứng.

Ví dụ chữ và icon đã duyệt:

```text
[ + Thêm thuộc viên ] → [ + ]        (tên truy cập giữ đầy đủ)
[ print Giấy chứng nhận ] → [print]  (icon gốc, không icon mới)
[ ✓ Duyệt ] [ Từ chối ] → giữ chữ
[file] Tên biểu mẫu → giữ tên, bỏ đoạn mô tả
```

## 7. A01, hỗ trợ và thay thế A02 theo C19

### A01 đăng nhập

```text
┌────────────────────────────────────┐
│ [logo gốc] QLHT                    │
│ Đăng nhập                          │
│ Email                              │
│ [                                ] │
│ Mật khẩu                           │
│ [                                ] │
│ [          Đăng nhập             ] │
│ Quên mật khẩu hoặc mất tài khoản?  │
└────────────────────────────────────┘
```

Card giữa nền gốc; mobile cùng một cột, co chiều ngang, cuộn khi mở bàn phím. Email bắt buộc, loại khoảng trắng đầu/cuối và kiểm tra định dạng. Mật khẩu che, hỗ trợ dán/password manager. Enter và nút cùng hành vi. Đang xác thực chặn gửi lặp; sai trả “Email hoặc mật khẩu không đúng.”; mất mạng báo lỗi kết nối, không giả thành công. Giới hạn thử theo tài khoản/nguồn, ngưỡng chi tiết chưa chốt.

Không trả danh sách tenant/dữ liệu trước khi đủ xác thực. Mật khẩu tạm đúng chuyển A04, chỉ có phiên đổi mật khẩu/đăng xuất. Theo C16, 2FA không thuộc kế hoạch triển khai hiện tại, kể cả các vai trò từng nêu ở D2; không hiển thị hoặc yêu cầu bước 2FA.

### Card hỗ trợ tài khoản

```text
┌────────────────────────────────────┐
│ [logo gốc] QLHT                    │
│ Hỗ trợ tài khoản                   │
│ Nếu quên mật khẩu hoặc mất quyền   │
│ truy cập tài khoản, vui lòng       │
│ liên hệ:                          │
│ Dịch vu chăm sóc và hỗ trợ          │
│ [        Về đăng nhập            ] │
└────────────────────────────────────┘
```

Tên “Dịch vu chăm sóc và hỗ trợ” giữ đúng chữ Khiêm cung cấp. Chưa có điện thoại/email/URL nên chưa gắn liên kết. Không có form khôi phục tự phục vụ, gửi liên kết hay yêu cầu hai người duyệt.

### A02 — BỎ đối với người dùng Hội Thánh theo C19

Mockup A02 và logic 0/1/nhiều Hội Thánh từng được duyệt nay bị thay thế. User đăng nhập vào đúng một Hội Thánh gắn cố định trong account; topbar chỉ hiển thị tenant, không chọn/chuyển nơi khác. Chỉ owner chọn tenant qua O01/O02.

Owner là nhân viên công ty cung cấp QLHT, account owner tách user account. Đề xuất wiring r2: user nhận URL `/h/{churchCode}/login`, giữ nguyên form A01; owner dùng `/owner/login`. Không tìm email across tenant để chọn account. Policy cho cùng email tạo các account độc lập và route này đang chờ duyệt kỹ thuật r2, không quyền đa tenant cho user.

Phiên D4 giữ15 phút không hoạt động xác thực lại/tối đa8 giờ. Khóa account user thu hồi phiên của chính account/tenant đó; không ảnh hưởng account độc lập khác. Owner có realm và session riêng. Sau xác thực kiểm tra lại quyền, không replay mutation tự động. Draft giữ trong bộ nhớ nếu có thể. Đăng xuất xóa cookie/cache đúng realm.

## 8. Owner O01–O03 và O-D1–O-D5 — đã duyệt, giới hạn theo C19

Chưa tạo vai trò nhân viên hỗ trợ riêng. Owner là nhân viên công ty cung cấp dịch vụ; tài khoản user thuộc duy nhất một Hội Thánh và chỉ dùng nghiệp vụ trong đó. Không đăng nhập giả thành người được hỗ trợ.

### Bảng quyền hiện hành

| Hành động | Owner | Mục sư Quản nhiệm | Người dùng Hội Thánh khác |
|---|---|---|---|
| Danh sách mọi Hội Thánh / tạo Hội Thánh | Có | Chỉ Hội Thánh của tài khoản / không tạo | Chỉ Hội Thánh của tài khoản / không tạo |
| Sửa thông tin nhận diện/liên hệ | Có | Hội Thánh mình | Theo quyền |
| Tạm ngưng/mở lại Hội Thánh | Có | Không | Không |
| Tạo tài khoản/gán vai trò/phạm vi | Có | Không | Không |
| Khóa/mở tài khoản user trong Hội Thánh đích | Có | Không | Không |
| Hỗ trợ truy cập | Có | Liên hệ hỗ trợ | Liên hệ hỗ trợ |
| Thuộc viên/gia đình/ban/khu vực | Có trong tenant đang chọn | Theo W01–W18 | Theo vai trò/phạm vi |
| Lễ nghi/điểm danh/lịch/thăm viếng | Có trong tenant đang chọn | Theo W01–W18 | Theo vai trò/phạm vi |
| Cấu hình tổ chức | Có | Hội Thánh mình | Theo W12 |
| Tài chính/dâng hiến cá nhân | Không mặc định | Theo nghiệp vụ | Theo nghiệp vụ |
| Duyệt chi/lập phiếu/khóa sổ | Không chỉ nhờ quyền owner | Theo cấu hình nghiệp vụ | Theo cấu hình nghiệp vụ |
| Cầu thay riêng tư | Không mặc định | Theo nghiệp vụ | Theo W08 |
| Nhật ký nền tảng | Có | Không | Không |
| Xóa vĩnh viễn tenant/dữ liệu hàng loạt | Chưa đưa vào bản đầu | Không | Không |

- O-D1: owner trực tiếp quản lý thuộc viên/tổ chức/mục vụ, dùng W01–W18, không màn hình dữ liệu song song.
- O-D2: owner không mặc định xem tài chính/dâng hiến cá nhân/cầu thay riêng tư hoặc duyệt chi. Cách cấp quyền nghiệp vụ riêng chưa đặc tả; không tự gán vai trò để vượt giới hạn.
- O-D3: owner cấp mật khẩu tạm, bắt buộc đổi. Theo C19 không có thao tác thêm Hội Thánh cho user account hiện có; tạo account độc lập nếu ở Hội Thánh khác.
- O-D4: theo C19 chỉ còn suspend tenant và lock user account cố định trong tenant; không membership hoặc global user account. Không ảnh hưởng account độc lập khác tenant.
- O-D5: duyệt bố cục O01–O03 và popup dưới đây.

### O01 danh sách Hội Thánh

```text
┌──────────────┬─────────────────────────────────────────────────┐
│ [logo] QLHT  │ Hội Thánh                                       │
│ [house] ●    │ [Tìm tên, mã, địa bàn…] [Trạng thái v]     [ + ] │
│ [users]      │ Mã     Hội Thánh     Địa bàn      Trạng thái     │
│              │ HT001  Bình An       Khánh Hòa    Hoạt động      │
│              │        420 thuộc viên · 6 tài khoản           → │
│              │ HT002  Hy Vọng       Đà Nẵng      Tạm ngưng      │
│              │        185 thuộc viên · 4 tài khoản           → │
│              │                  [Xem thêm]                     │
└──────────────┴─────────────────────────────────────────────────┘
```

Giữ sidebar/kích thước; house/users là icon gốc, không chữ sản phẩm. Tìm tên/mã/địa bàn; lọc Tất cả/Hoạt động/Tạm ngưng; dòng mở O02. Số thuộc viên gồm tín hữu+thân hữu; số tài khoản tính account active có churchId của tenant. Tìm/lọc/phân trang backend, sort ổn định. Rỗng và không có kết quả có thông báo riêng.

Popup tạo/sửa Hội Thánh:

```text
┌────────────────────────────────────────┐
│ Hội Thánh                         [x]  │
│ Tên Hội Thánh                          │
│ [                                    ] │
│ Địa hạt             Tỉnh/Thành          │
│ [                 ] [                ] │
│ Địa chỉ                                │
│ [                                    ] │
│ Người liên hệ       Điện thoại          │
│ [                 ] [                ] │
│ Email liên hệ                          │
│ [                                    ] │
│                      [Hủy] [Lưu]       │
└────────────────────────────────────────┘
```

Tên/địa bàn bắt buộc, mã tự cấp. Cảnh báo tên/địa bàn tương tự, không cấm tên trùng tuyệt đối. Không tự tạo user hoặc sao chép dữ liệu. Lưu xong mở O02.

### O02 chi tiết Hội Thánh

```text
┌──────────────┬─────────────────────────────────────────────────┐
│ [logo] QLHT  │ Bình An · HT001 · Khánh Hòa                      │
│ [house] ●    │ ← Hội Thánh                                     │
│ [users]      │ ┌─────────────────────────────────────────────┐ │
│              │ │ Hội Thánh Bình An                  [edit]  │ │
│              │ │ [Hoạt động]                                │ │
│              │ │ Địa hạt… · Địa chỉ…                        │ │
│              │ │ Người liên hệ… · Điện thoại…               │ │
│              │ └─────────────────────────────────────────────┘ │
│              │ [Thuộc viên] [Gia đình] [Ban/Khu vực] [Tài khoản]│
│              │ [    420   ] [  112   ] [    6     ] [    6    ]│
│              │ [users] Tài khoản →     [gear] Cấu hình →       │
│              │ [         Vào quản lý Hội Thánh         ]       │
│              │ Tạm ngưng Hội Thánh                             │
└──────────────┴─────────────────────────────────────────────────┘
```

Tài khoản → O03 đúng tenant. Cấu hình → W12. Vào quản lý → W01 và W02–W18 theo quyền owner. KPI theo dữ liệu thật, cần chốt định nghĩa đếm Ban/Khu vực trước implementation. Tên/mã Hội Thánh luôn rõ trên thanh trên.

Xác nhận: “Tạm ngưng Hội Thánh Bình An — HT001? Người dùng Hội Thánh sẽ không truy cập được. Dữ liệu được giữ nguyên.” [Hủy] [Tạm ngưng]. Chặn user/phiên/tác vụ ghi chờ của tenant đó; không ảnh hưởng account độc lập ở nơi khác. Owner còn xem quản trị/mở lại nhưng không ghi nghiệp vụ thông thường khi tenant tạm ngưng. Ghi đã hoàn tất trước thời điểm tạm ngưng được giữ; ghi chưa chấp nhận bị từ chối rõ.

### O03 quản lý tài khoản

```text
┌──────────────┬─────────────────────────────────────────────────┐
│ [logo] QLHT  │ Tài khoản · Hội Thánh Bình An · HT001             │
│ [house]      │ ← Chi tiết Hội Thánh                            │
│ [users] ●    │ [Tìm tên, email…] [Vai trò v] [Trạng thái v] [+] │
│              │ Họ tên / Email     Vai trò       Quyền tại HT    │
│              │ Nguyễn Văn An      Thư ký        Hoạt động       │
│              │ an@example.com                          [edit] │
│              │ Trần Văn Bình      Trưởng ban    Đã khóa         │
│              │ binh@example.com                        [edit] │
│              │                  [Xem thêm]                     │
└──────────────┴─────────────────────────────────────────────────┘
```

Mở từ sidebar có chọn Hội Thánh; mở từ O02 đã cố định tenant. Popup tại mục 9. Không có vai trò owner trong select vai trò Hội Thánh. Sửa vai trò có hiệu lực với phiên đang dùng. Khóa account chỉ ảnh hưởng user thuộc tenant đang mở, không có global user lock/membership. Không đổi churchId hoặc email trong form quyền; không ghép hồ sơ thuộc viên chỉ do trùng tên/email.

Audit giữ danh tính owner thật và tenant. Không cho tự khóa/gỡ owner cuối cùng. Ghi cấu hình/quyền đồng thời phải phát hiện xung đột. Backend kiểm tra quyền cho mọi thao tác/count/export, không dựa nút ẩn.

## 9. Luồng cấp tài khoản → đăng nhập đầu → đổi mật khẩu

Luồng/mockup được trình tại C12–C13. C13 duyệt mockup và sửa minimum thành 8. Đây là hồ sơ thiết kế, không là bằng chứng đã cấp user thật.

### 9.1 Owner tạo/gán tài khoản

```text
┌────────────────────────────────────────┐
│ Tài khoản                         [x]  │
│ Hội Thánh Bình An · HT001               │
│ Email                                  │
│ [ an@example.com                     ] │
│ Họ tên                                 │
│ [ Nguyễn Văn An                      ] │
│ Vai trò                                │
│ [ Thư ký Ban Chấp sự                v ] │
│ Phạm vi                                │
│ [ Toàn Hội Thánh                    v ] │
│                      [Hủy] [Lưu]       │
└────────────────────────────────────────┘
```

- Lookup email **trong Hội Thánh đang mở**. Chưa có: tạo account gắn churchId/role/scope, sinh credential riêng. Có rồi trong cùng Hội Thánh: mở account để sửa, không thêm tenant hay reset mật khẩu âm thầm.
- Cùng email ở Hội Thánh khác không reuse/đọc credential/profile; nếu cấp thì tạo account độc lập theo đề xuất kỹ thuật r2, không liên kết hai account.
- Unique churchId+email bảo vệ account trùng trong cùng tenant khi owner/retry đồng thời; không collection membership.
- Account đang khóa không tự mở khi owner sửa quyền; không endpoint chuyển tenant.
- Phạm vi vai trò phải hợp lệ trong tenant; không cấp owner từ form này.
- Mất kết nối kiểm tra kết quả, không tự tạo lại account.

### 9.2 Thông tin bàn giao cho account mới

```text
┌────────────────────────────────────────┐
│ Đã cấp tài khoản                  [x]  │
│ Hội Thánh Bình An · HT001               │
│ Email                                  │
│ an@example.com                         │
│ Mật khẩu tạm                           │
│ [mật khẩu do hệ thống sinh]            │
│ Hết hạn: [ngày/giờ thực tế]             │
│ Chỉ hiển thị tại bước này.             │
│ [Sao chép thông tin đăng nhập]          │
│                              [Đóng]   │
└────────────────────────────────────────┘
```

Mật khẩu tạm ngẫu nhiên riêng, hạn 24 giờ từ lúc cấp. Chỉ hiện rõ ở bước này, không xem lại. Sao chép chỉ khi bấm: địa chỉ đăng nhập, email, mật khẩu tạm, hạn dùng. Owner bàn giao qua kênh riêng đã xác minh; chưa tích hợp email/SMS/Zalo. Đóng/tải lại mất phần hiển thị; owner chủ động cấp lại nếu cần, mật khẩu cũ mất hiệu lực. Không plaintext trong logs/history/browser storage lâu dài.

“Hiển thị một lần” không phải “chỉ được nhập một lần”: mật khẩu tạm còn dùng tới khi đổi thành công/cấp lại/hết hạn/khóa account. Theo C19 không có nhánh thêm Hội Thánh cho account hiện có. Account trùng cùng church được mở sửa, không tự sinh/cấp lại mật khẩu.

### 9.3 Đăng nhập bằng mật khẩu tạm

Dùng A01. Đúng chuyển ngay A04, phiên chỉ đổi mật khẩu/đăng xuất; deep link/API nghiệp vụ vẫn bị chặn. Sai trả thông báo chung; mật khẩu tạm đúng nhưng hết hạn báo “Mật khẩu tạm đã hết hạn. Liên hệ Dịch vu chăm sóc và hỗ trợ.” Lỗi mạng không báo thành công.

### 9.4 A04 hiện hành — đổi mật khẩu

```text
┌────────────────────────────────────┐
│ [logo gốc] QLHT                    │
│ Đổi mật khẩu                       │
│ an@example.com                     │
│ Mật khẩu mới                       │
│ [                                ] │
│ 8–128 ký tự                        │
│ Nhập lại mật khẩu                  │
│ [                                ] │
│ [         Lưu mật khẩu           ] │
│ Đăng xuất                          │
└────────────────────────────────────┘
```

Email chỉ đọc. Không yêu cầu nhập lại mật khẩu tạm vì phiên đã xác minh. Không Bỏ qua.

Mật khẩu mới: **8–128 ký tự**, khác mật khẩu tạm; hỗ trợ paste/password manager/Unicode/khoảng trắng, không cắt/trim; không ép chữ hoa/số/ký tự đặc biệt. Từ chối mật khẩu phổ biến/đã biết lộ; nguồn kiểm tra và định nghĩa đếm ký tự cần đặc tả kỹ thuật, không mặc định gửi mật khẩu cho dịch vụ ngoài.

- Không khớp/không đạt: lỗi tại trường, giữ trạng thái bắt buộc đổi.
- Phiên đổi mật khẩu hết hạn: về A01, mật khẩu tạm còn hạn vẫn dùng được. TTL riêng của phiên giới hạn chưa chốt ngoài chính sách D4.
- Owner cấp lại: phiên đổi cũ vô hiệu, dùng thông tin mới.
- Hai tab: chỉ lần hợp lệ đầu tiên lưu; tab kia yêu cầu đăng nhập.
- Lưu thành công cùng lúc lưu mật khẩu mới, bỏ must-change, vô hiệu mật khẩu tạm/phiên đổi cũ; nếu cấp lại truy cập thì thu hồi phiên cũ.
- Về A01 có thông báo “Đã đổi mật khẩu.”, điền email, không điền mật khẩu mới. Người dùng đăng nhập lại.
- Mất phản hồi lưu: thử đăng nhập bằng mật khẩu mới; không tự kết luận thất bại hoặc yêu cầu cấp lại.
- Không 2FA trong scope hiện tại. Theo C19 user đăng nhập mới vào thẳng đúng tenant cố định nếu active; không A02/chuyển tenant. Owner vào O01 sau xác thực realm riêng.

### 9.5 Cấp lại truy cập qua hỗ trợ

Owner có thể cấp lại mật khẩu tạm sau xác minh đúng người; không xem mật khẩu cũ; thu hồi phiên và buộc đổi. Popup phải nêu đúng account và Hội Thánh đích. Cấp lại không ảnh hưởng account độc lập ở tenant khác, không reset owner bằng user flow. Không tự đặt lại 2FA. Kênh bàn giao, cách xác minh và mockup thao tác cấp lại chi tiết còn mở, không tự kế thừa quy trình A08 tạm gác.

## 10. Quy tắc nghiệp vụ cần cụ thể hóa

- Chuyển thân hữu giữ ID/lịch sử/ngày tin Chúa; phân biệt tình trạng Dự bị với ghi danh một lớp cụ thể.
- Tách/gộp hộ giữ lịch sử/liên kết hộ gốc; chưa dùng xóa vĩnh viễn để xử lý chuyển đi/qua đời.
- Xếp ban dựa ngày sinh/chính sách tuổi; thời điểm tự chuyển và ngày sinh thiếu còn mở.
- Mã thuộc viên/hộ/phiếu unique trong tenant; mọi liên kết phải cùng tenant.
- Ngày nghiệp vụ khác timestamp thao tác; hướng thiết kế UTC cho thời điểm, hiển thị theo múi giờ Hội Thánh. Các trường ngày giữ nghĩa ngày, không dịch sai múi giờ.
- Luồng tài chính Chờ duyệt → Đã duyệt → Đã chi, nhánh Từ chối. Phiếu chi từ đề xuất được duyệt, một phiếu/đề xuất theo mô hình hiện tại; retry không trùng; đổi trạng thái và ghi sổ cùng thành công.
- Khóa sổ phải chống ghi đồng thời tại database; quỹ đã có dữ liệu không xóa, đổi tên giữ ID. Chưa tự áp dụng hành vi tự duyệt hoặc tự dời phiếu sang tháng sau của demo.
- Snapshot/lịch sử cho lễ nghi/chứng nhận/giao dịch; không sửa hồi tố chỉ vì đổi cấu hình/danh mục.

## 11. Đầu vào chi tiết sau phê duyệt P0

C16 chấp thuận các phần P0 còn lại theo nội dung đã trình. Các dòng dưới giữ những đầu vào chưa có giá trị cụ thể và công việc chi tiết cần làm ở gói tương ứng; không diễn giải “OK” thành số lượng tenant, nhà cung cấp, schema hoặc chính sách nghiệp vụ chưa từng được chọn. Không mở lại câu hỏi về hướng bàn giao/hỗ trợ đã chốt. Trước implementation từng gói, cụ thể hóa contracts/acceptance liên quan và xin duyệt kế hoạch gói đó.

| ID | Điểm cần chốt / đầu vào | Tác động |
|---|---|---|
| OPEN-01 — ĐÃ GIẢI QUYẾT | C16 loại 2FA khỏi kế hoạch triển khai hiện tại | Không chặn lập kế hoạch P1; tương lai cần scope/phê duyệt mới |
| OPEN-02 — HƯỚNG ĐÃ CHỐT | Giữ owner bàn giao trực tiếp, hỗ trợ cấp lại và card “Dịch vu chăm sóc và hỗ trợ” theo C16 | Không hỏi lại phương thức. Chưa có URL/số/email/kênh cụ thể thì không tự điền hoặc gửi thật |
| OPEN-03 | Chi tiết cấp quyền nhạy cảm riêng cho owner; không mặc định truy cập | Finance/cầu thay và chống tự nâng quyền |
| OPEN-04 | Quy mô tenant/thuộc viên/concurrency/dữ liệu cũ; nhân sự/ngân sách | Capacity, hiệu năng, ước lượng lịch/chi phí |
| OPEN-05 | C19 chốt chỉ owner across tenant; user account một church. Vai trò/scope/gắn thuộc viên/cổng cá nhân còn chi tiết theo gói | Không mở quyền Địa hạt/Tổng Liên Hội hoặc user đa tenant từ yêu cầu xuất báo cáo |
| OPEN-06 | Cấu hình tuổi ban, ngày sinh thiếu, thời điểm chuyển ban; định nghĩa thân hữu/lớp dự bị | Dữ liệu và transition |
| OPEN-07 | Tự duyệt, số dư, sửa/hủy đề xuất/phiếu, mở lại kỳ, nhiều cấp/chứng từ | Finance chưa đủ đặc tả implementation |
| OPEN-08 | Mẫu giấy/báo cáo Tổng Liên Hội thật và file import ẩn danh | Chưa nghiệm thu bản in/import |
| OPEN-09 | Hạ tầng/nơi lưu/file, sao lưu/retention, RPO/RTO, consent/chính sách dữ liệu | Chưa có lựa chọn nhà cung cấp hoặc kết luận tuân thủ |
| OPEN-10 | OCR/Zalo/email/SMS/chứng từ/nhiều cấp/chữ lớn: phạm vi bản đầu | Chưa gửi dữ liệu nhạy cảm/thuê dịch vụ |
| OPEN-11 | API/schema/index/transaction/phiên bản thư viện, giới hạn rate-limit và token | Thiết kế kỹ thuật tiếp; không có lệnh build/test ứng dụng |
| OPEN-12 | Mockup nhập/sửa nghiệp vụ chưa có, import, tách/gộp hộ và các luồng còn thiếu mẫu | Duyệt trước coding UI |
| OPEN-13 | Định nghĩa KPI Ban/Khu vực; tổng hợp/thống kê và tiêu chí hiệu năng | Tránh hiểu sai con số |

Không có phí/gói thanh toán/billing hoặc xóa hàng loạt được duyệt. Không triển khai quy trình lời mời đã bỏ.

## 12. Kiểm chứng và nghiệm thu dự kiến

Các tiêu chí sau là kế hoạch kiểm chứng, không phải kết quả đã chạy:

- Fidelity W01–W18/O01–O03/A01–A04 theo bản hiện hành: vị trí/thứ tự, thành phần, desktop/mobile, light/dark, keyboard/focus, nhãn/icon/touch; không mất dữ liệu/cảnh báo.
- Multitenant: chéo tenant qua ID/search/count/export/cache/file/job, owner hai tab hai tenant và user bị chặn đổi tenant, role đổi/thu hồi giữa chừng.
- Tài khoản: owner scope, email chỉ lookup trong tenant; không thêm tenant/membership, account trùng cùng church bị chặn khi retry/concurrency; temp expired/reissue/changed bị kiểm tra; pre-change session không gọi nghiệp vụ; khóa user chỉ account/tenant đó, không khóa account độc lập cùng email ở tenant khác.
- Mật khẩu: dưới 8 từ chối; 8 trở lên chấp nhận nếu các điều kiện khác đạt; trên 128 từ chối; không trim/truncate; hai tab/password version và mất phản hồi; logs không chứa secrets.
- Nghiệp vụ: chuyển thân hữu, tách/gộp hộ, xếp ban, lớp dự bị/lễ nghi, điểm danh nhiều người; regression tại lớp lỗi thực tế.
- Finance: quyền, idempotency, transaction, approve/pay/lock cạnh tranh; chỉ hoàn tất sau human acceptance của người phụ trách nghiệp vụ.
- Export/import: preview/báo lỗi/chống trùng/đối soát, phân quyền đầu ra và Unicode tiếng Việt.
- Vận hành: sao lưu/phục hồi thử, giám sát, Redis/worker lỗi, workload đại diện và query plans.

Trình tự sau này, chỉ khi được duyệt implementation: hoàn thiện code sản phẩm và wiring trong scope → viết/cập nhật tests → chạy checks/review/render/UAT liên quan. Không dùng technical PASS thay human accepted hoặc released.

## 13. Bằng chứng và lưu hồ sơ

- Đã đọc mã HTML/CSS/JavaScript và tài liệu kit liên quan; chưa chạy demo trên browser hoặc ứng dụng thật.
- Mọi mockup trong hồ sơ là ASCII theo chat, không ảnh chụp/render hoặc code sản phẩm.
- Tham khảo kỹ thuật đã tra trong planning: [MongoDB multitenancy](https://www.mongodb.com/docs/atlas/build-multi-tenant-arch/), [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/), [Bun Node compatibility](https://bun.sh/docs/runtime/nodejs-compat), [OWASP password recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html). Nguồn tham khảo không cấp quyền hoặc chứng nhận tuân thủ; phần lời mời/MFA tạm gác không tự trở lại scope vì có liên kết.
- Planning trước C15 chỉ trong chat; lần này là lần lưu đầu, không backdate.
- Journal của pha planning: [planning-1.json](../engineering/skill-usage/records/CHURCH-P0/planning-1.json). Bản planning-1 giữ nguyên trạng thái lịch sử tại lần lưu đầu; phê duyệt C16 được ghi bằng evaluation nối tiếp, không sửa ngược journal hoặc đếm thêm usage.
- Lịch sử upstream trong kit giữ nguyên, không là lịch sử triển khai hoặc quyền của Church CMS.

## 14. Phê duyệt P0 — C16

- Phạm vi/thiết kế đã trình: **HUMAN ACCEPTED**. Không bao gồm kết quả runtime/UAT/production.
- 2FA loại khỏi kế hoạch triển khai hiện tại, có thể làm tương lai; thay thế yêu cầu bắt buộc D2 cho scope này.
- Bàn giao/hỗ trợ giữ hướng đã chốt: owner cấp/cấp lại mật khẩu tạm sau xác minh, người dùng đổi lần đầu; quên/mất tài khoản chỉ hiển thị liên hệ dịch vụ; không tự phục vụ hoặc lời mời.
- Phần còn lại của P0 được chấp thuận theo thiết kế đã trình. Thông số chưa có không được bịa giá trị; chi tiết kỹ thuật/nghiệp vụ đưa vào kế hoạch gói phù hợp.
- P1 chưa bắt đầu. Điểm dừng: bàn giao cập nhật P0, không tự mở implementation gói tiếp.
- Journal: [human-acceptance-1.json](../engineering/skill-usage/records/CHURCH-P0/human-acceptance-1.json); [kiểm tra cập nhật](../../output/p0-approval-validation.json).

## 15. Thiết kế nền tảng r1 — lịch sử C18, bị thay thế bởi C19/r2

Theo yêu cầu C18, đã bổ sung [mô hình dữ liệu, API và tiêu chí nghiệm thu r1](../engineering/P0-FOUNDATION-r1.md). **Toàn bộ mục 15 mô tả lịch sử r1, không là contract hiện hành.** Tài liệu mô tả ownership, collections/indexes, scope/role, vòng đời password/session, transaction/concurrency, retry, 23 endpoint F01–F23 và 26 tiêu chí AC01–AC26 nối A01/A02/A04/O01–O03. Đây là thiết kế mới để review, không code hoặc database đã chạy.

- **Phần sản phẩm đã duyệt:** W01–W18, các A/O hiện hành, owner cấp tài khoản, min password 8, C16 loại 2FA khỏi scope.
- **Phần kỹ thuật mới chờ duyệt:** FD01–FD07, schema/API/session/idempotency/thông số r1. Không coi C16 là phê duyệt trước các nội dung chưa từng trình.
- **Giới hạn:** không schema P2–P7, không code/driver/migration/script bootstrap, không endpoint invitation/reset tự phục vụ/2FA. Chưa chọn hạ tầng hoặc bịa workload/mẫu báo cáo/thông tin liên hệ.
- **Điểm cần chú ý khi duyệt r1:** Mongo làm nguồn session có thẩm quyền; cookie+CSRF; mật khẩu tạm không replay plaintext; membership scope cần target thật từ module tổ chức; P1 chưa có KPI nghiệp vụ thì hiển thị chưa có số liệu, không số 0 giả.
- **Tiêu chí kết thúc gói tài liệu:** đầy đủ và nhất quán model/API/acceptance, kiểm tra liên kết/journal và review thiết kế; technical document PASS không thay human acceptance hoặc runtime proof.
- **Bước sau:** Khiêm duyệt/sửa r1, sau đó cho phép lập gói implementation P1 nếu muốn. Không tự mở gói tiếp.
- Journal: [foundation-planning-1.json](../engineering/skill-usage/records/CHURCH-P0/foundation-planning-1.json). Bằng chứng tài liệu: [foundation validation](../../output/p0-foundation-validation.json).

## 16. C19 — Owner nhân viên, user account một Hội Thánh

- **ĐÃ XÁC NHẬN:** owner là nhân viên nhà cung cấp; user account thuộc đúng một churchId bất biến; tenant cô lập; chỉ owner được across tenant.
- Bỏ account người dùng toàn hệ thống, memberships nhiều tenant, A02 cho user, user đổi tenant, thêm church cho account hiện có và reset ảnh hưởng nhiều church.
- Account owner tách riêng, không role/cờ nâng user; O-D2 vẫn giới hạn finance/private prayer. Owner thao tác dưới danh tính thật.
- Thiết kế hiện hành: [P0-FOUNDATION-r2](../engineering/P0-FOUNDATION.md), 8 collections và28 endpoint active. r2 giữ F08/F20 ở trạng thái retired, bổ sung owner auth/context;26 AC đã sửa cho fixed tenant/realm isolation.
- Đã được C20 duyệt kỹ thuật: URL tenant-specific login không thêm field UI, unique churchId+email, cookie/route realm riêng. Không diễn giải thành một account tham gia nhiều church.
- Lưu nguyên [hồ sơ trước C19](CHURCH-P0-pre-C19.md) và [thiết kế r1](../engineering/P0-FOUNDATION-r1.md) để truy lịch sử; không dùng chúng làm scope hiện hành.
- Journal: [foundation-r2-planning-1.json](../engineering/skill-usage/records/CHURCH-P0/foundation-r2-planning-1.json); kiểm tra tài liệu: [r2 validation](../../output/p0-foundation-r2-validation.json).
- Chưa code/migration/dữ liệu cần chuyển đổi; r2 HUMAN ACCEPTED tại C20, P1 NOT_STARTED. Không suy ra mọi thiết kế module P2–P7 đã hoàn tất.

## 17. C20 — Nghiệm thu thiết kế nền tảng r2

Khiêm xác nhận “Duyệt r2.” Model/API/acceptance r2 được HUMAN ACCEPTED, gồm mô hình user một tenant/owners riêng và wiring đã trình. Không ghi runtime/UAT PASS từ phê duyệt này. Dừng chờ quyền lập gói implementation P1; chưa tự bắt đầu. Journal nối r2: [foundation-r2-human-acceptance-1.json](../engineering/skill-usage/records/CHURCH-P0/foundation-r2-human-acceptance-1.json).
