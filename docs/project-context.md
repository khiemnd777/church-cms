# Bối cảnh Church CMS

Cập nhật theo planning và phê duyệt trong chat ngày 2026-11-10. Chi tiết và lịch sử thay thế: [hồ sơ P0](tasks/CHURCH-P0.md). Trạng thái hiện hành: [project-state](project-state.md).

## Mục tiêu và lựa chọn đã chốt

- Xây dựng hệ thống multitenant Quản lý Hội Thánh Tin Lành; một Hội Thánh là ngữ cảnh tenant theo định hướng P0.
- Stack: ReactJS/TypeScript/Vite, TailwindCSS, Bun/TypeScript, Redis, MongoDB. Phiên bản cục bộ pin trong package.json/bun.lock; HTTP dùng native Bun.serve, frontend build được phục vụ cùng origin HTTPS. Nhà cung cấp production chưa chốt.
- Trao đổi bằng tiếng Việt. UI/UX theo `../documents/Quản lý Hội Thánh Tin Lành(1).html` (đường dẫn mô tả từ root `src`); hai HTML còn lại dùng đối chiếu nghiệp vụ. Liên kết nguồn đầy đủ nằm trong hồ sơ P0.
- Wordless theo bảng W01–W18 đã duyệt: giữ bố cục/thành phần/màu/font/responsive gốc; giảm chữ điều khiển/hướng dẫn; giữ nhãn dữ liệu, quyền, tiền/kỳ, xác nhận và nội dung giấy tờ. Không tự thiết kế UI/UX khác.
- Owner/nhà cung cấp quản lý danh sách Hội Thánh, cấp tài khoản/quyền, hỗ trợ truy cập; người dùng Hội Thánh không quản lý lời mời/tài khoản cho người khác.
- O-D1–O-D5/O01–O03 đã duyệt: owner quản lý thuộc viên/tổ chức/mục vụ trong tenant được chọn, dùng W01–W18; không mặc định xem tài chính/dâng hiến cá nhân/cầu thay riêng tư hoặc duyệt chi.
- Tài khoản mới dùng mật khẩu tạm riêng, buộc đổi ở lần đầu; không thêm Hội Thánh cho account hiện có; C19 bắt buộc account riêng trong từng tenant. Mật khẩu mới **8–128 ký tự**. Không đăng ký tự do hoặc lời mời.
- Quên mật khẩu/mất tài khoản: hiển thị liên hệ **Dịch vu chăm sóc và hỗ trợ**. Hướng bàn giao/hỗ trợ đã được C16 xác nhận; thông tin liên hệ/kênh cụ thể chưa cung cấp thì không tự điền hoặc gửi thật.
- Phiên theo D4: 15 phút không hoạt động cần xác thực lại, tối đa 8 giờ. Theo C16, 2FA không thuộc kế hoạch triển khai hiện tại; yêu cầu bắt buộc D2 bị thay thế trong scope này. A05–A08 chỉ xem xét lại trong tương lai với phê duyệt mới.

## Ranh giới và hướng kiến trúc

Định hướng modular monolith và cách ly tenant từ nền tảng được đồng ý. [Thiết kế nền tảng P0-FOUNDATION-r2](engineering/P0-FOUNDATION.md) cụ thể hóa account người dùng một churchId cố định, owners nhân viên nhà cung cấp tách riêng, không memberships, MongoDB authoritative sessions, Redis rate-limit, cookie/CSRF, collection/index, transaction/idempotency và contracts API. Các lựa chọn kỹ thuật r2 đã được Khiêm duyệt ở C20, không tự là bằng chứng runtime; bằng chứng implementation theo từng gói P1. Không coi phương án chi tiết của agent hoặc hành vi demo là nghiệp vụ đã duyệt toàn bộ.

Hồ sơ và account user thuộc đúng một Hội Thánh; churchId bất biến, không danh tính user chung/membership nhiều tenant. Owner là nhân viên công ty có account riêng và là ngoại lệ duy nhất across tenant. Khóa/cấp lại account user không ảnh hưởng account độc lập ở tenant khác. Không gộp hồ sơ vì trùng tên/email hoặc impersonation.

Quyền thực hiện theo [task P1](tasks/CHURCH-P1.md) và [trạng thái hiện hành](project-state.md). P1-plan-r1 được duyệt; từng gói vẫn có điểm dừng nghiệm thu. Không tự dùng dữ liệu thật, Git publication hoặc deploy. Chi tiết P2–P7 chưa được suy là hoàn tất từ phê duyệt nền tảng.

## Bức tranh tổng thể và cách bàn giao

Quy tắc bàn giao đã được thống nhất trong trao đổi ngày 2026-11-10, bổ sung ảnh kết quả hoặc sơ đồ kỹ thuật thực tế theo yêu cầu “áp dụng vào”. Dùng [hai mẫu biên bản](handoff-templates.md): task dài bàn giao theo gói và dừng chờ nghiệm thu/cho phép mở gói sau; task ngắn bàn giao một lần, không hiển thị roadmap. Cả hai có phần trực quan, Outline, Checklist nghiệm thu, Bằng chứng kỹ thuật, WHAT, skills và đề xuất tiếp theo.

Theo bổ sung đã được Khiêm duyệt ngày 2026-11-10, ngay đầu mỗi kế hoạch agent nêu **Kiểu bàn giao**, **Căn cứ**, **Thuộc roadmap** trực tiếp trong chat. Phân loại theo nhu cầu nghiệm thu; gói nhỏ thuộc roadmap giữ roadmap và điểm dừng. Xem [tiêu chí phân loại](handoff-templates.md#phan-loai-khi-lap-ke-hoach) là nguồn quy tắc chi tiết; mức rủi ro quyết định kiểm tra riêng, không thay thế kiểu bàn giao.

Bức tranh định hướng có sẵn, không là scope bản đầu đã duyệt hoặc quyền triển khai:

```text
P0  Đặc tả và phê duyệt
P1  Nền tảng tenant, auth, owner/account, quyền, audit, local/CI
P2  Cấu hình, thuộc viên/thân hữu, gia đình, ban/khu vực, import/export, dashboard
P3  Điểm danh, lớp dự bị/lễ nghi, thẻ/chứng nhận
P4  Lịch giảng/sinh hoạt, thăm viếng, cầu thay, cảnh báo
P5  Quỹ/dâng hiến, đề xuất/duyệt/thu chi, khóa sổ
P6  Biểu mẫu/báo cáo/định dạng, cổng tín hữu
P7  OCR/nhắc ngoài/chứng từ/nhiều cấp/chữ lớn
P8  Pilot nhiều Hội Thánh, chuyển dữ liệu, phục hồi, phát hành
```

Tên và thứ tự trên lấy từ roadmap đã ghi tại [project-plan](project-plan.md). Danh mục implementation P1 đã chốt ở phần P1 bên dưới; không tự sinh phần tiếp theo sau bàn giao. Khi kế hoạch được sửa đổi có phê duyệt, cập nhật bức tranh ở đây cùng chi tiết kế hoạch. Không lưu tiến độ sống tại đây; xem [project-state](project-state.md).

## Nguồn và giới hạn bằng chứng

Agent Kit được cài cục bộ ngày 2026-11-10; xem [thông tin cài đặt](agent-kit-installation.md). Các tasks/journal/verification-results upstream không là bằng chứng Church CMS. Scaffold owner P1.1 và bằng chứng kiểm tra có trong workspace; xem task P1 và runbook. Workspace chưa được Git nhận diện là repository.

Các phê duyệt là thiết kế/mockup trong chat, không là kết quả runtime, UAT hoặc phát hành. Không có dữ liệu Hội Thánh thật được tạo bởi pha này.

## Điều chỉnh C19 — ràng buộc danh tính

Owner là nhân viên công ty cung cấp QLHT, account riêng; user account thuộc duy nhất một Hội Thánh, không memberships nhiều tenant hoặc chọn/chuyển Hội Thánh. Chỉ owners có cross-tenant và vẫn giữ giới hạn O-D2. R2 tại tài liệu nền tảng là hợp đồng hiện hành HUMAN ACCEPTED tại C20, thay thế r1. Implementation ứng dụng theo gói P1; thiết kế không thay bằng chứng chạy.

## C20 — r2 đã được duyệt

Thiết kế nền tảng P0-FOUNDATION-r2 đã được Khiêm duyệt (“Duyệt r2.”). C20 chỉ duyệt thiết kế; quyền mở P1.1 đến từ phê duyệt P1-plan-r1 riêng sau đó. Phần thiết kế nghiệp vụ P2–P7 chưa được coi là hoàn tất chỉ từ xác nhận này.

## Danh mục implementation P1 được duyệt

P1.1 Owner truy cập cục bộ → P1.2 Quản lý Hội Thánh → P1.3 Cấp/quản lý truy cập user → P1.4 Kiểm chứng tích hợp. Chi tiết [CHURCH-P1](tasks/CHURCH-P1.md). Mỗi gói dừng nghiệm thu, không tự mở gói sau.

## Ranh giới Tenancy/Operations P1.2

Tenancy sở hữu churches; Identity trả OwnerGrant chỉ có actorId/commit-time fence và query counts scoped/revoke church sessions. Operations sở hữu idempotency ledger, Audit sở hữu event append cùng transaction; không chuyền credential/passwordHash qua các module này. O01/O02 dùng cùng renderer owner và context tường minh từ URL, không selectedChurch toàn cục. PATCH contact giữ field không gửi, null clear tường minh. Chi tiết ổn định: [P1.2 tenancy](engineering/P1.2-tenancy.md); trạng thái/acceptance chỉ tại project-state/task record.

## Chuẩn UI từ HTML — UI-STD-r1

HTML `Quản lý Hội Thánh Tin Lành(1).html` là nguồn style, cùng mockup owner/wordless và adaptation UI-STD-r1 đã duyệt. Nền tảng/component ở `web/ui`; contracts, theme, responsive và quy tắc kế thừa tại [ui-system](ui-system.md). Feature CSS chỉ bố trí nội dung; bộ chung không sở hữu API/quyền/tenant/CAS/F22. Trang tham chiếu được build riêng khỏi sản phẩm.

Điều chỉnh đã duyệt sau phản hồi thiếu text UI-STD-r1: menu AppShell hiển thị icon + tên trên desktop/mobile, trạng thái chưa khả dụng là dòng phụ; không coi tooltip/aria-label là nhãn hiển thị. Thay quy tắc ẩn nhãn menu wordless cũ; xem ui-system.md.


## Ranh giới Identity/Authorization P1.3

`Accounts`/`ChurchIdentity` sở hữu account/credential/session, dùng public `Tenancy.access()`/ChurchAccess để resolve và fence church; Operations ledger và Audit qua contracts đã có. User session realm riêng, fixed church, fresh role/scope mỗi request và fence tại transaction. Ở P1 chỉ có `context:read`; P2.1/P2.2 mở catalogue và hồ sơ theo capability versioned riêng bên dưới. Owner có thể quản trị account khi suspended, nhưng F09/F24/user login bị chặn; thao tác account không resume church. Chi tiết contracts/rules/retention/canonical reset bucket tại [P1.3 accounts](engineering/P1.3-accounts.md). Không thay mô hình foundation r2 hoặc tự mở P2.


## Audit reader và qualification P1.4

F23 là backend capability audit:read cho owner full; không menu UI mới, DTO allowlist, query scoped/global và signed keyset time+id DESC. Hoàn chỉnh28API r2; account CAS412/recent-auth403 theo contract. [P1.4 contracts/measurement/recovery](engineering/P1.4-qualification.md), [ma trận](engineering/P1.4-acceptance-matrix.md). Tools chỉ tự tạo DB synthetic loopback, quiesced snapshot/restore target mới và revoke restored sessions; không restore main hoặc gọi local proof là production SLA/RPO-RTO. Từng gói vẫn cần human acceptance; không tự mở P2.


## Mốc nghiệm thu và đóng P1

Khiêm đã nghiệm thu P1.4 và đóng P1; P1.1–P1.4 đều HUMAN ACCEPTED trong phạm vi local/synthetic. [Biên bản đóng P1](tasks/CHURCH-P1.md#đóng-p1). Phê duyệt đóng P1 không là production release hoặc quyền mở giai đoạn mới. P2 được mở bằng chỉ dẫn mới ngày2026-11-11, ghi ở phần roadmap P2 bên dưới. Trạng thái hiện hành duy nhất vẫn ở project-state.

## Roadmap P2 đã duyệt

P2.1 Cấu hình → P2.2 Hồ sơ → P2.3 Gia đình → P2.4 Tổ chức/quyền → P2.5 Import/export → P2.6 Tổng quan/kiểm chứng. Authority mới ngày 2026-11-11 thay trạng thái P2 chưa mở trong lịch sử. Mỗi gói có điểm dừng nghiệm thu. Chi tiết [CHURCH-P2](tasks/CHURCH-P2.md).

## Ranh giới Organization P2.1

Organization sở hữu church_settings/organization_units; cấp cấu hình và catalogue tenant-scoped qua contracts. Identity/Authorization cấp grant theo role và realm, Tenancy fence church, Operations ledger v2 actor-scoped cùng collection với v1 (không backfill), Audit ghi đúng actor trong transaction. GET không khởi tạo; POST setup tạo đúng6system units. UI W12 dùng chung hai realm/UI-STD-r1; pending intent ở parent qua reauth, không tự replay. Chi tiết ổn định tại engineering/P2.1-organization.md; live status/acceptance chỉ ở project-state/task.

## Chuyển gói P2.1 → P2.2

Khiêm nghiệm thu P2.1-r2 và mở P2.2 ngày2026-11-11. Tiếp tục danh mục P2-plan-r1 đã duyệt, giữ điểm nghiệm thu từng gói; hợp đồng nghiệp vụ/ASCII mockup P2.2 được trình duyệt trước coding. Quyền cho gói mới không bao gồm publication/deploy/dữ liệu thật. Chi tiết authority/acceptance trong task P2 và P2.1; trạng thái sống chỉ tại project-state.

## Ranh giới Members/Families P2.2

Members sở hữu hồ sơ và history; Families cấp hộ tối thiểu/area/read-model scoped, Organization cấp labels/active-link fences và assignment. ID/code bất biến; ba trục type/membership/participation độc lập. Create member+family/history/ledger/audit atomic; ngày nullable, consent versioned, conversion giữ nguồn thân hữu và không liên kết account/lớp. PolicyVersion3 cho pastor/secretary đọc ghi hồ sơ, secretary vẫn readonly catalogue. Shared tenant intent bảo vệ actor/tenant/namespace qua reauth. [Contracts/runbook](engineering/P2.2-members.md). Quản lý hộ đầy đủ/P2.3 và các gói sau giữ điểm dừng nghiệm thu; live state chỉ ở project-state.

## Ranh giới Families P2.3

Families sở hữu metadata/status/lineage và family_history; Members public port sở hữu chuyển familyId/roles/member_history, cùng transaction với Operations/Audit/active-area fences. Family version tăng khi metadata/member links/roles đổi, kể cả callers P2.2. Split tạo mã mới giữ nguồn; merge chuyển toàn bộ historical profiles rồi giữ source merged/link, không xóa/dedup/viết lại quá khứ. Metadata chưa rõ giữ null; upgrade P2.2 tường minh, không tạo năm/lịch sử giả. UI W03 và W14 dùng kit chung; [contracts/runbook](engineering/P2.3-families.md). P2.4 vẫn cần quyền mở riêng, live state chỉ ở project-state.

## P2.4 — tổ chức thực tế và assigned-unit scope

Organization sở hữu term/appointment snapshots, leader/schedule/history; Members public OrganizationMembers port sở hữu roster/eligibility/service changes, Family area vẫn là nguồn có thẩm quyền. Auto age và explicit service cùng tồn tại, DOB recalc giữ services. Identity gọi public UnitScopeValidator khi owner cấp assigned_units1–50active age/service/area cùng church; policyVersion5 cho lead reduced roster riêng, không cấp full Members/Families capability. Scoped reads fence church/account/session và query trong cùng Mongo snapshot; existing writers dùng cùng church fence. Chức vụ tổ chức không tự cấp role account. W04/W13/O03/W15 dùng kit/source hiện có; [contracts/runbook](engineering/P2.4-organization-runtime.md). Trạng thái/nghiệm thu chỉ ở project-state/task.

W04 hỗ trợ Card/Bảng trên cùng DTO/controller, giữ bốn group, selected term/pages/actions/scope. Preference chỉ enum view tại localStorage theo realm/principal/church; lỗi storage không chặn render/switch. Shared TableFrame/grid giữ responsive, compact table actions có aria-label đầy đủ. Chi tiết tại contracts P2.4-r2; không thay API/schema/quyền.

W04 switcher Card/Bảng dùng shared IconButton icon-only grid/table theo P2.4-icon-plan-r1; tooltip/aria-label/pressed/disabled giữ tên/trạng thái. Table là SVG bổ sung trong shared catalogue; không đổi source CSS/glyphgrid hay rule menu AppShell icon + tên.

## P2.5 — ranh giới import/export

Theo P2.5-plan-r1 đã duyệt: DataExchange sở hữu staged imports, protected export artifacts và durable source identities; gọi public transactional Members/Families/Organization contracts, không cross-module writes. CSV/XLSX→mapping/review→preview→batches≤100→reconciliation, create/link/skip không bulk overwrite/lifecycle/move; new family groups atomic trong lô. Policy6 cấp capability riêng owner/pastor/secretary, giữ reduced roster privacy P2.4. File ACL actor/realm/church/fresh fence/expiry; export server filters + allowlisted columns/snapshot. [Thiết kế và contracts](engineering/P2.5-data-exchange.md). Live acceptance chỉ tại project-state; P2.6 cần quyền riêng.

## P2.6 — ranh giới Tổng quan/read snapshot

Theo P2.6-plan-r1 đã duyệt: Overview orchestration gọi public Tenancy/Members/Families/Organization read ports trên một Mongo snapshot với fresh auth/tenant fences; không sở hữu/ghi domain collections. Policy7 overview:read chỉ owner/pastor/secretary, reduced roster giữ riêng. W01 giữ HTML source layout với current P2 metrics, unknown/null/unavailable rõ; future chart/rites/finance/care không có số giả. last30 visitors/explicit birthday year-month dùng chung list/count/cursor/export contracts. Local fenced snapshots được admission theo church/process, bounded queue/retry, không đổi writer/ledger semantics. Qualification/restore chỉ DB synthetic UUID, không là production SLA/PITR. [Contracts/runbook](engineering/P2.6-overview-qualification.md). Quyền P2.6 không đóng P2/mở P3; live acceptance chỉ tại project-state.

## Roadmap P3 đã duyệt

P3-plan-r1 được Khiêm duyệt ngày2026-11-12: **P3.1 Buổi nhóm/điểm danh tay → P3.2 Thẻ/QR → P3.3 Lớp dự bị → P3.4 Sổ lễ nghi → P3.5 Chứng nhận/bản in → P3.6 Tổng hợp/kiểm chứng**. Mỗi gói có điểm dừng nghiệm thu và cần quyền mở riêng. Danh mục/phụ thuộc/giới hạn tại [CHURCH-P3](tasks/CHURCH-P3.md); thiết kế kỹ thuật từng gói duyệt trước coding, không suy từ danh mục rằng schema/API/quyền chi tiết đã chốt. Trạng thái sống chỉ tại project-state.

## P3.1 — ranh giới Attendance

Theo P3.1-plan-r1 đã duyệt: Attendance sở hữu sessions/participants/history và reduced identity snapshots; public Members read model và Organization scope/labels giữ ranh giới dữ liệu. Policy8 có attendance:read/mark/manage; manager tách canWrite, lead chỉ historical roster thuộc active assigned unit. Ledger replay/receipt cùng fresh resource/action fence; per-row CAS+session generation, session revision cho close/reset/roster edits, history/audit/counters atomic. W05 dùng kit/source và intent-memory/explicit reconciliation hai realm. Danh sách<=2000 gồm current believer/visitor, không ngưỡng tuổi demo. [Contracts/runbook](engineering/P3.1-attendance.md). Human acceptance/live status chỉ tại task/project-state; P3.2 cần quyền mở riêng.

## P3.2 — ranh giới Cards/QR

Theo P3.2-plan-r1 đã duyệt: Cards sở hữu current card revision và append-only history; public Members/Tenancy read ports cung cấp eligibility/snapshot trong cùng TX. QR opaque256-bit, không PII/public URL; snapshot lúc cấp, CAS/reason khi thay/thu hồi, old QR mất hiệu lực atomic. Attendance resolve proof60giây gắn actor/tenant/session/card/row revision/generation, ghi bằng kernel P3.1 hiện diện=true; exact replay vẫn fresh permission và không ghi lại sau reset. Policy9: owner/pastor/secretary quản lý thẻ, lead chỉ scan own active unit; treasurer/member deny. W14 thẻ/in86×54mm + W05 local camera worker có explicit opt-in/cleanup/reconciliation. [Contracts/runbook](engineering/P3.2-cards-qr.md). Camera điện thoại/bản giấy giữ NOT_RUN theo [P3-PHYSICAL-01](tasks/CHURCH-P3.md#p3-physical-verification-note); không suy proof vật lý từ synthetic. Live status chỉ tại project-state, P3.3 cần quyền mở riêng.

## P3.3 — ranh giới PrepClasses

Theo P3.3-plan-r1/C33-01–03 đã duyệt: PrepClasses sở hữu khóa/ghi danh/bài học/phỏng vấn, Members read ports kiểm eligibility/identity, Attendance sở hữu buổi/roster/hiện diện qua source/fence public interface và transaction ports, không cross-module writes/cycle. Class source gắn course/meeting/lesson và roster current enrollment; snapshot mở buổi không tự sửa hồi tố. Credit distinct member/lesson chỉ từ buổi đã chốt, bù không xóa vắng gốc; curriculum khóa sau first open, course close không tự hoàn thành/Báp-têm. Policy10 owner/pastor/secretary quản lý lớp, owner/pastor ghi sự kiện phỏng vấn; không suy pass/fail/teacher role. W06 giữ6tab (5lễ nghi P3.4 chưa mở), W14 links và W05 kernel/QR/reconciliation được dùng lại. [Contracts/runbook](engineering/P3.3-prep-classes.md). Live acceptance tại project-state; physical note giữ NOT_RUN, P3.4 cần quyền mở riêng.

## P3.4 — ranh giới Rites và thông tin Báp-têm

Theo P3.4-plan-r1/C34-01–03/ASCII đã duyệt: Rites sở hữu sổ/snapshot/history năm loại lễ; Members.baptism giữ thông tin hiện hành. Public Members port và handler Rites nối tại composition root, cập nhật fact/history/audit cùng transaction, không ghi xuyên module hoặc tự backfill lễ từ hồ sơ/import. Snapshot lễ đã ghi nhận giữ nguyên khi profile đổi; preview/CAS/fresh source versions bảo vệ xác nhận/đính chính, partial unique tránh hai bản Báp-têm recorded hiện hành. Người liên quan chọn rõ/link hoặc external snapshot, không suy hộ/quan hệ/deceased; count Tiệc Thánh nhập tay/null khác0, lịch kế tiếp từ planned record. Policy11 rites:read/manage cho owner/pastor/secretary; classes interview giữ riêng. W06 mở năm tab còn lại, W14 liên kết đúng sổ; chứng nhận/bản in thuộc P3.5. [Contracts](engineering/P3.4-rites.md). Live acceptance tại project-state; physical note vẫn NOT_RUN.

## P3.5 — ranh giới Certificates và artifact nội bộ

Theo P3.5-plan-r1/C35-01–03/ASCII: Certificates sở hữu drafts/previews/immutable editions/history, đọc public Members/Rites/PrepClasses/Tenancy ports, source/version fences, không cập nhật dữ kiện nghiệp vụ ngược. Bốn mẫu `internal-r1` có dấu kiểm thử; thông tin hệ phái/người ký explicit, đức tin cần xác nhận riêng, đơn không thu thập lời làm chứng/chữ ký. Preview render ngoài transaction, fresh context trước chốt atomic cả DOCX/PDF/history/audit/ledger; replacement/revoke bảo toàn bytes và lineage. Shared A4 model/offline licensed fonts, child renderer bounded2/15s/10pages/5MiB, preview8/church/15m. Policy12 certificates read/manage cho owner/pastor/secretary, không đổi interview. W11/W17/W06/W14 hai realm nối thật; four unopened catalog items giữ chưa mở. [Contracts/runbook](engineering/P3.5-certificates.md). Physical/native Word NOT_RUN; live acceptance chỉ tại project-state, P3.6 cần quyền mở riêng.

## Tổng hợp P3.6 — hợp đồng ổn định

Theo P3.6-plan-r1/C36-01–03/ASCII: Attendance sở hữu general/sunday_reference, partial unique church/calendarSunday, reason+confirmation/CAS/idempotency/history cho thay đổi phân loại; không backfill hoặc viết lại roster. Public read ports Attendance/Rites/PrepClasses cung cấp số liệu cùng snapshot/fresh tenant auth.12CN lịch/missing≠0, absent3 đúng ba CN đủ dữ liệu, W04 weighted bốn own-unit closed trong84ngày; lễ năm bốn kinds/unknown-date riêng, classes factual. W01/W02/W14/W04/W05 nối hai realm; cursor/export preview gắn period/reference fingerprint. Workload và restore synthetic tách volume fixtures với public-command workflow; chưa đóng P3/mở P4. [Contracts/runbook](engineering/P3.6-reporting.md); live state chỉ project-state. Camera/giấy thật và native Word NOT_RUN.
