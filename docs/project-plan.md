# Kế hoạch Church CMS

Ngày tổng hợp: 2026-11-10. Nguồn chi tiết: [hồ sơ P0](tasks/CHURCH-P0.md). Trạng thái hiện hành duy nhất: [project-state](project-state.md).

## Phạm vi được phép hiện tại

P3.6-plan-r1/C36-01–03/ASCII đã được Khiêm duyệt để triển khai P36-01–05 local/synthetic và bàn giao một lần theo roadmap P3. [Đầu ra/checklist/bằng chứng P3.6-r1](tasks/CHURCH-P3.6.md), [contracts](engineering/P3.6-reporting.md). Khiêm đã nghiệm thu P3.6-r1 đủ năm mục local/synthetic; [evaluation](engineering/skill-usage/records/CHURCH-P3/P3.6-human-acceptance-1.json). Khiêm đã cho đóng P3; [biên bản closure](tasks/CHURCH-P3.md#đóng-p3). P4 NOT_OPENED; không commit/push/deploy/real data/main DB init/restart3443. Camera/giấy thật/native Word NOT_RUN. Live state duy nhất tại project-state; các mục phía dưới giữ chronology.

## P0 — Đặc tả và phê duyệt

Đầu ra: ma trận nguồn → tính năng → quyền/trạng thái → mockup → tiêu chí kiểm chứng; chốt phạm vi bản đầu và các quyết định ảnh hưởng kiến trúc.

Đã được duyệt từng phần: định hướng/stack; W01–W18 và ngoại lệ wordless; A01 và card hỗ trợ; A02 user bị C19 thay thế; owner cấp account thay lời mời; O-D1–O-D5/O01–O03; mockup luồng mật khẩu tạm → đăng nhập đầu → đổi mật khẩu, tối thiểu 8 ký tự. Xem các phiên bản hiện hành trong hồ sơ P0, không dùng nhánh lời mời cũ.

C16: Khiêm chấp thuận phần còn lại của P0 theo thiết kế đã trình. 2FA **không thuộc scope triển khai hiện tại**, không tiếp tục hỏi lại D2; có thể xét trong tương lai. Bàn giao/hỗ trợ theo hướng đã chốt, không mở lại phương án lời mời hoặc khôi phục tự phục vụ.

C16 chỉ chấp thuận phạm vi/thiết kế đã trình. C17 làm rõ dữ liệu/API nền tảng chưa được thiết kế đầy đủ; C18 cho phép hoàn thiện phần kỹ thuật bằng tài liệu, chưa code. Đã lập [P0-FOUNDATION-r2](engineering/P0-FOUNDATION.md): model/indexes, session/authorization, transaction/idempotency, 28 API active và 26 tiêu chí nghiệm thu. Contracts/thông số r2 đã được Khiêm duyệt tại C20, không coi toàn bộ đầu ra P0 đã hoàn tất.

Gói thiết kế đã nghiệm thu: **P0-FOUNDATION-r2 — tài liệu thiết kế nền tảng**. Đầu ra có đủ dữ liệu/API/acceptance và liên kết tới A/O đã duyệt; kiểm tra tĩnh và tự review thiết kế, đã được Khiêm nghiệm thu tại C20. Không cài dependencies, tạo schema/migration hoặc code/tests ứng dụng. Sau bàn giao dừng, không mở gói tiếp.

Các thông số chưa có giá trị cụ thể (quy mô, nơi lưu, liên hệ, mẫu thật và rules P2–P7) vẫn là đầu vào của gói tương ứng, không bịa dữ liệu. Danh mục/gói P1 đã được duyệt ở P1-plan-r1 bên dưới; chỉ P1.1 được mở implementation.

## Roadmap theo định hướng đã thảo luận

| Đợt | Kết quả dự kiến | Điều kiện kiểm chứng/duyệt |
|---|---|---|
| P1 | Nền tảng tenant, auth, owner/account, quyền, audit, local/CI | Cách ly tenant, đổi/thu hồi quyền, vòng đời tài khoản/phiên |
| P2 | Cấu hình, thuộc viên/thân hữu, gia đình, ban/khu vực, import/export, dashboard cơ bản | Luồng Thư ký thật; import preview/đối soát/chống trùng |
| P3 | Điểm danh tay/QR, lớp dự bị/lễ nghi, thẻ/chứng nhận | Cạnh tranh điểm danh; camera điện thoại; dữ liệu và bản in |
| P4 | Lịch giảng/sinh hoạt, thăm viếng, cầu thay, cảnh báo | Phân công/quyền riêng tư/tác vụ không trùng |
| P5 | Quỹ/dâng hiến, đề xuất/duyệt/thu chi, khóa sổ | Quyền, retry/transaction/concurrency và nghiệm thu nghiệp vụ tài chính |
| P6 | Đủ biểu mẫu/báo cáo/định dạng, cổng tín hữu | Mẫu thật, dữ liệu đúng scope, tài khoản gắn đúng người |
| P7 | OCR/nhắc ngoài/chứng từ/nhiều cấp/chữ lớn | Chỉ khi có scope, nhà cung cấp, chi phí và quyền dữ liệu riêng |
| P8 | Pilot nhiều Hội Thánh, chuyển dữ liệu, phục hồi, phát hành | UAT, vận hành và quyền phát hành riêng |

Đây là roadmap, không phải lệnh bắt đầu P1–P8 hoặc cam kết tất cả mục đề xuất có trong bản đầu. Chưa có lịch/chi phí cam kết; cần OPEN-04 và phạm vi đã chốt.

## Trình tự thực hiện sau khi được phép

Trước implementation của roadmap dài, xác định và duyệt danh mục gói nghiệm thu có ý nghĩa, kết quả, phụ thuộc và tiêu chí kiểm chứng. Bức tranh định hướng lưu tại [project-context](project-context.md); P0–P8 chưa là danh mục gói implementation đã chốt.

Trong mỗi gói được phép: hoàn thiện production code và wiring → viết/cập nhật tests → chạy checks/review/render/UAT liên quan → bàn giao theo [mẫu có ảnh/sơ đồ thực tế](handoff-templates.md) → dừng chờ Khiêm nghiệm thu và cho phép mở gói sau. Không tạo handoff giả giữa từng file; không dùng mocks hoặc technical PASS thay nghiệm thu sản phẩm. Task ngắn dùng mẫu bàn giao một lần, không thêm roadmap. Test chọn theo rủi ro domain, tenant, concurrency, import/export và vận hành. Lệnh thực tế chỉ ghi sau khi có scaffold và được xác minh.

## Điều chỉnh C19 — ràng buộc danh tính

Owner là nhân viên công ty cung cấp QLHT, account riêng; user account thuộc duy nhất một Hội Thánh, không memberships nhiều tenant hoặc chọn/chuyển Hội Thánh. Chỉ owners có cross-tenant và vẫn giữ giới hạn O-D2. R2 tại tài liệu nền tảng là hợp đồng hiện hành HUMAN ACCEPTED tại C20, thay thế r1. Đây là mô hình thiết kế đã duyệt; implementation theo các gói P1.

## C20 — r2 đã được duyệt

Thiết kế nền tảng P0-FOUNDATION-r2 đã được Khiêm duyệt (“Duyệt r2.”). Tại C20 dừng trước P1; phê duyệt P1-plan-r1 mới nhất bên dưới thay điểm dừng này và chỉ mở P1.1. Phần thiết kế nghiệp vụ P2–P7 chưa được coi là hoàn tất chỉ từ xác nhận này.

## P1-plan-r1 — đã duyệt

Danh mục và acceptance: [CHURCH-P1](tasks/CHURCH-P1.md). Khiêm duyệt kế hoạch/hai mockup và mở P1.1. P1.2–P1.4 cần nghiệm thu và quyền mở riêng.

## Quyền mở P1.2

Khiêm nghiệm thu P1.1 và cho mở P1.2/O01/O02 theo P1-plan-r1. F10–F14/F22, kiểm chứng CAS/idempotency/transaction/audit/keyset/UI. Dừng bàn giao trước P1.3.

## Hồ sơ implementation P1.2

O01/O02 và F10–F14/F22 theo P1-plan-r1. Contracts/wiring tại [P1.2 tenancy](engineering/P1.2-tenancy.md); biên bản trong CHURCH-P1, trạng thái hiện hành tại project-state. Sau nghiệm thu và quyền mở riêng mới thực hiện P1.3.

## UI-STD-r1 — chuẩn hóa UI trong P1.2

Khiêm đã duyệt trọn gói UI01–UI05: nguồn style HTML → bộ UI chung → chuyển A01/A04/hỗ trợ/reauth/O01/O02 → trang mẫu/đối chiếu light-dark-responsive và luồng P1.2 → tài liệu/check kế thừa. Một lần bàn giao trong gói P1.2, không tách approval theo file/component. Phạm vi và tiêu chí: [UI-STD-r1](tasks/UI-STD-r1.md); kết quả sống xem project-state. Sau bàn giao dừng trước P1.3 để Khiêm nghiệm thu.

Sửa nhãn menu đã được Khiêm duyệt sau khi từ chối UI-STD-r1: N01 render icon+tên/description tại AppShell, N02 cập nhật chuẩn thay rule ẩn nhãn cũ, N03 xác minh visible text trên hai theme/desktop/mobile và trạng thái chọn/disabled. Cùng gói P1.2, không mở P1.3.


## Quyền mở P1.3

Khiêm: “Duyệt triển khai P1.3-plan-r1”. P1.3 giữ chính sách owner quản trị account khi church suspended; user login/context bị chặn. P13-01–05 bàn giao cùng lúc, không thêm gate theo file/lớp. Không tự mở P1.4. Hạng mục và tiêu chí nghiệm thu tại CHURCH-P1.3, trạng thái live duy nhất tại project-state.

## P2-plan-r1 và P2.1-plan-r1 — đã duyệt 2026-11-11

Khiêm duyệt danh mục P2.1–P2.6 và mở trọn P21-01–05 local/synthetic theo [CHURCH-P2](tasks/CHURCH-P2.md), [CHURCH-P2.1](tasks/CHURCH-P2.1.md). Phê duyệt mới thay giới hạn P2 NOT_OPENED ở phần lịch sử; không tự mở P2.2 hoặc commit/push/deploy/dữ liệu thật.

### Sửa UI theo nghiệm thu P2.1

Human review1 CHANGES_REQUESTED vì spacing. P2.1-r2 sửa Field/layout và thêm geometry regression trong cùng P21-03/04; bàn giao lại, không thay danh mục/thứ tự gói. Chi tiết outcome ở CHURCH-P2.1; trạng thái hiện hành ở project-state.

## P2.2-plan-r1 — implementation được duyệt

Khiêm duyệt contracts/quy tắc/mockup P2.2-plan-r1 và mở trọn P22-01–05 local/synthetic ngày2026-11-11. Chi tiết [CHURCH-P2.2](tasks/CHURCH-P2.2.md). Bàn giao rồi dừng trước P2.3; không publication/deploy/dữ liệu thật.

## Nghiệm thu P2.2 và điểm dừng

Khiêm xác nhận “Nghiệm thu P2.2, chưa mở P2.3”. P22-01–05/P2.2-r1 đã human accepted local/synthetic; [biên bản](tasks/CHURCH-P2.2.md#human-review1--accepted). Chưa mở planning/implementation P2.3, không publication/deploy/dữ liệu thật. Trạng thái sống duy nhất tại project-state.

## Mở lập kế hoạch P2.3

Chỉ dẫn mới của Khiêm: “mở P2.3”. Mở lập kế hoạch chi tiết Gia đình và lịch sử tách/gộp, kế thừa P2.2 đã nghiệm thu. P2.3-plan-r1 trình trong chat để duyệt contracts/acceptance/mockup trước implementation; dự thảo chưa duyệt chưa lưu thành đặc tả đã chốt. Chưa mở P2.4 hoặc publication/deploy/dữ liệu thật. [Authority](tasks/CHURCH-P2.md#quyền-mở-lập-kế-hoạch-p23); live state tại project-state.

## P2.3-plan-r1 — implementation được duyệt

Khiêm đã duyệt trọn P23-01–05 local/synthetic; [contracts/acceptance](tasks/CHURCH-P2.3.md). Hoàn tất code/wiring trước tests, bàn giao rồi dừng trước P2.4. Không publication/deploy/dữ liệu thật.

P23-01–05 đã bàn giao P2.3-r1 với local verification; human acceptance PENDING_REVIEW, dừng trước P2.4. [Biên bản](tasks/CHURCH-P2.3.md). Không publication/deploy/dữ liệu thật.

## Mở lập kế hoạch P2.4

Theo chỉ dẫn mới của Khiêm, P2.3 đã nghiệm thu; mở P2.4 Tổ chức thực tế và phạm vi truy cập để trình kế hoạch chi tiết trước coding. P2.4-plan-r1 còn chờ duyệt; đề xuất trong chat không là quyền implementation. [Authority](tasks/CHURCH-P2.md#nghiệm-thu-p23-và-mở-planning-p24).

## P2.4-plan-r1 — đã duyệt triển khai

Khiêm duyệt trọn P24-01–05 local/synthetic, một gói nghiệm thu; [task](tasks/CHURCH-P2.4.md), [contracts](engineering/P2.4-organization-runtime.md). Dừng trước P2.5; không publication/deploy/dữ liệu thật. Bản planning mở phía trên là lịch sử trước approval mới.

P24-01–05 đã bàn giao P2.4-r1 local/synthetic; human acceptance PENDING_REVIEW. [Biên bản](tasks/CHURCH-P2.4.md). Dừng trước P2.5; live state chỉ ở project-state.

## P2.4-view-plan-r1 — sửa P24-04/05

Khiêm duyệt switch Card ↔ Bảng giữ group và scoped data/actions, nhớ preference account/church. Bàn giao P2.4-r2 local/synthetic để nghiệm thu rồi dừng trước P2.5; không publication/deploy/dữ liệu thật. [Task](tasks/CHURCH-P2.4.md).

P24-04/05 đã bàn giao P2.4-r2 Card/Bảng theo view-plan-r1, local verified/chờ nghiệm thu; [task](tasks/CHURCH-P2.4.md). Dừng trước P2.5; live state chỉ ở project-state.

## P2.4-icon-plan-r1 — bàn giao r3

Khiêm duyệt icon-only switcher P24-04/05; r3 local verified/chờ nghiệm thu. [Biên bản](tasks/CHURCH-P2.4.md). Không publication/deploy/dữ liệu thật; dừng trước P2.5. Live state chỉ ở project-state.

## Quyền implementation P2.5 — 2026-11-12

Khiêm duyệt P2.5-plan-r1 và trọn P25-01–05 local/synthetic. [Task](tasks/CHURCH-P2.5.md); bàn giao nghiệm thu rồi dừng trước P2.6. Không commit/push/deploy/dữ liệu thật.

## Bàn giao P2.5-r1

P25-01–05 source complete/local verified: CSV/XLSX import preview/đối chiếu/source identities/batches/partial/resume và protected filtered export. [Task/checklist](tasks/CHURCH-P2.5.md), [contracts](engineering/P2.5-data-exchange.md), [receipt](../output/p2.5/verification.json). Bàn giao để Khiêm nghiệm thu rồi dừng trước P2.6; không publication/deploy/dữ liệu thật. Live status chỉ tại project-state.

## Mở kế hoạch P2.6 — 2026-11-12

Theo chỉ dẫn Khiêm, P2.5-r1 đã nghiệm thu; mở lập kế hoạch gói cuối P2: Tổng quan W01 và qualification xuyên P2. [Authority](tasks/CHURCH-P2.md). P2.6-plan-r1 trình chat, chưa coding. P2 chưa đóng/P3 chưa mở; không publication/deploy/dữ liệu thật.

## Quyền implementation P2.6 — 2026-11-12

Khiêm: “Duyệt P2.6-plan-r1 để triển khai trọn P26-01–05 local/synthetic, bàn giao nghiệm thu rồi dừng trước P3. Chưa đóng P2, commit/push, deploy hoặc dùng dữ liệu thật.” [Task](tasks/CHURCH-P2.6.md). Hoàn tất P26-01–05 local/synthetic, bàn giao nghiệm thu; chưa đóng P2/P3 chưa mở.

## Bàn giao P2.6-r1 — 2026-11-12

P26-01–05 source complete/local-synthetic verified: public metrics/snapshot API/W01+drilldowns/qualification+restore/regression. [Biên bản/checklist](tasks/CHURCH-P2.6.md), [contracts](engineering/P2.6-overview-qualification.md), [receipt](../output/p2.6/verification.json). Bàn giao chờ Khiêm nghiệm thu; không tự đóng P2/mở P3, publication/deploy/dữ liệu thật. Live status chỉ tại project-state.


## Đóng P2 — 2026-11-12

Khiêm: “Nghiệm thu P2.6-r1. Đóng P2. Chưa mở P3.” P2.1–P2.6 đã nghiệm thu local/synthetic; P2 CLOSED, P3 NOT_OPENED. [Closure](tasks/CHURCH-P2.md#đóng-p2), [acceptance P2.6](engineering/skill-usage/records/CHURCH-P2/P2.6-human-acceptance-1.json). Không tự mở planning/implementation P3 hoặc publication/deploy/dữ liệu thật; bằng chứng và giới hạn kỹ thuật giữ nguyên từ bàn giao, không chạy tests mới.

## P3-plan-r1 — duyệt danh mục và mở planning P3.1

Khiêm: **“Duyệt P3-plan-r1. Mở kế hoạch chi tiết P3.1 để duyệt trước coding.”** ngày2026-11-12. Chỉ dẫn này thay điểm dừng chưa mở P3 ở biên bản đóng P2. Danh mục sáu gói/đầu ra/phụ thuộc tại [CHURCH-P3](tasks/CHURCH-P3.md): điểm danh tay → QR/thẻ → lớp dự bị → sổ lễ nghi → chứng nhận → tổng hợp/kiểm chứng. Gói P3.1 đang lập kế hoạch chi tiết trong chat; chưa có quyền implementation, không mở P3.2–P3.6/publication/deploy/dữ liệu thật. Chỉ ghi nhận phần đã được duyệt, không lưu dự thảo P3.1 chưa duyệt thành đặc tả đã chốt.

## P3.1-plan-r1 — implementation được duyệt

Khiêm duyệt P3.1-plan-r1, gồm ba lựa chọn ở mục3, trọn P31-01–05 local/synthetic; bàn giao nghiệm thu rồi dừng trước P3.2. Không commit/push/deploy/dữ liệu thật. [Task/authority](tasks/CHURCH-P3.1.md), [contracts/runbook](engineering/P3.1-attendance.md). Chỉ dẫn này thay giới hạn planning-only P3.1 ở biên bản trước; không mở gói khác.

## Bàn giao P3.1-r1 — 2026-11-12

P31-01–05 source complete/local-synthetic verified: Attendance sessions/snapshots/marks/CAS/generation/ledger/resource ACL/W05/qualification. [Biên bản và checklist](tasks/CHURCH-P3.1.md), [contracts/runbook](engineering/P3.1-attendance.md), [receipt](../output/p3.1/verification.json). Chờ Khiêm nghiệm thu rồi mới có thể mở gói tiếp theo bằng chỉ dẫn riêng; dừng trước P3.2. Không Git publication/deploy/dữ liệu thật/init main DB/restart3443. Live status chỉ tại project-state.

## Nghiệm thu P3.1-r1; mở kế hoạch P3.2 — 2026-11-13

Theo chỉ dẫn Khiêm “Nghiệm thu P3.1-r1, mở P3.2”, P31-01–05 HUMAN ACCEPTED local/synthetic. [Biên bản/evidence](tasks/CHURCH-P3.1.md), [acceptance](engineering/skill-usage/records/CHURCH-P3/P3.1-human-acceptance-1.json). P3.2 Thẻ tín hữu/QR mở PLANNING_ONLY theo P3-plan-r1; contracts/ASCII/mockup đề xuất trong chat chờ duyệt trước coding. Không sửa receipt/journal implementation P3.1 hoặc tính lại usage; không chạy lại runtime/tests trong bước ghi nhận. Không tự mở P3.3/publication/deploy/dữ liệu thật/init main DB/restart dịch vụ.

## Quyền implementation P3.2 — 2026-11-13

Khiêm: “duyệt P3.2-plan-r1”. P32-01–05 theo [task P3.2](tasks/CHURCH-P3.2.md) được phép trọn gói local/synthetic, code/wiring trước tests, bàn giao rồi dừng trước P3.3. Không publication/deploy/dữ liệu thật/init main DB/restart. P3-PHYSICAL-01 chưa kiểm camera điện thoại/bản giấy, giữ mục cần nhắc và không tự đóng bằng synthetic.

## Bàn giao P3.2-r1

P32-01–05 Cards/QR source complete/local-synthetic verified: lifecycle/snapshot/revision + Attendance proof60giây/fresh commit + W14/W05/print86×54mm + tests/qualification + contracts/evidence. [Checklist/kết quả](tasks/CHURCH-P3.2.md), [contracts](engineering/P3.2-cards-qr.md). Human acceptance chờ Khiêm; P3.3 chưa mở. Physical camera/giấy giữ NOT_RUN; chưa init main DB/restart3443/publication/deploy/dữ liệu thật. Trạng thái hiện hành duy nhất tại project-state.

## Nghiệm thu P3.2-r1; mở planning P3.3

Theo Khiêm “nghiệm thu P3.2-r1 theo checklist; đồng ý mở planning P3.3”, P32-01–05 HUMAN ACCEPTED local/synthetic. [Biên bản](tasks/CHURCH-P3.2.md), [evaluation](engineering/skill-usage/records/CHURCH-P3/P3.2-human-acceptance-1.json). P3.3 Lớp dự bị chỉ PLANNING_ONLY: khảo sát nghiệp vụ/source, trình contracts/acceptance/ASCII trong chat để duyệt trước coding, không tự tạo draft đã duyệt hoặc code. Bằng chứng/journal implementation P3.2 giữ nguyên; camera thật/giấy thật vẫn NOT_RUN. Không publication/deploy/real data/main DB init/restart; P3.4–P3.6 chưa mở.

## P3.3-plan-r1 — implementation authority

Khiêm duyệt C33-01–03 và trọn P33-01–05 local/synthetic; [task](tasks/CHURCH-P3.3.md). Code/wiring toàn gói trước tests; bàn giao rồi dừng trước P3.4. Chưa commit/push/deploy/real data/main DB init/restart; camera thật/giấy giữ NOT_RUN. Live status tại project-state.

## Bàn giao P3.3-r1

P33-01–05 source complete/local-synthetic verified theo C33-01–03: khóa/ghi danh, source Attendance/credit bù, phỏng vấn sự kiện không tự điều kiện Báp-têm, W06/W14/W05, tests/workload/contracts/evidence. [Checklist/kết quả](tasks/CHURCH-P3.3.md), [contracts](engineering/P3.3-prep-classes.md). Human acceptance pending; P3.4 chưa mở. Physical camera/giấy/main runtime/full200lessoncapacity/production chưa kiểm; không publication/deploy/real data/main DB init/restart. Live state chỉ tại project-state.

## P3.4-plan-r1 — implementation được duyệt 2026-11-13

Khiêm duyệt C34-01–03/ASCII và trọn P34-01–05 local/synthetic; [authority và phạm vi](tasks/CHURCH-P3.4.md). Code/wiring trước tests, một lần bàn giao rồi dừng trước P3.5. Không commit/push/deploy/real data/main DB init/restart. Physical NOT_RUN giữ nguyên; các planning-only phía trên là lịch sử trước approval này.

## Bàn giao P3.4-r1

P34-01–05 local/synthetic hoàn tất và đã kiểm chứng; [task/checklist](tasks/CHURCH-P3.4.md), [contracts](engineering/P3.4-rites.md). Chờ human acceptance, chưa released; dừng trước P3.5/P3.6. Bằng chứng và giới hạn tại task/receipt; live state duy nhất tại project-state. Không commit/push/deploy/real data/main DB init/restart. Physical NOT_RUN giữ nguyên.

## P3.5-plan-r1 — implementation được duyệt 2026-11-13

Khiêm duyệt C35-01–03/ASCII và trọn P35-01–05 local/synthetic; [authority/checklist](tasks/CHURCH-P3.5.md). Code/wiring trước tests, một lần bàn giao rồi dừng trước P3.6. Không commit/push/deploy/real data/main DB init/restart. Physical NOT_RUN giữ nguyên; planning-only phía trên là chronology trước approval.

## P3.5-r1 — bàn giao local/synthetic 2026-11-13

P35-01–05/C35-01–03/ASCII hoàn tất; [task/checklist](tasks/CHURCH-P3.5.md), [contracts](engineering/P3.5-certificates.md), [receipt](../output/p3.5/verification.json). Technical PASS không thay Khiêm nghiệm thu/release. Chờ nghiệm thu năm mục; dừng trước P3.6, chưa mở planning/coding. Không commit/push/deploy/real data/main DB init/restart3443. Physical/native Word NOT_RUN giữ nguyên; live status duy nhất tại project-state.

## P3.5-r1 accepted; P3.6 mở planning — 2026-11-13

Khiêm: **“Nghiệm thu P3.5-r1 theo năm mục trên; mở P3.6.”** [Biên bản/checklist](tasks/CHURCH-P3.5.md), [evaluation](engineering/skill-usage/records/CHURCH-P3/P3.5-human-acceptance-1.json). Không sửa technical snapshots/usage cũ. P3.6 chỉ PLANNING_ONLY trong chat để duyệt kế hoạch trước coding; không mở P4/đóng P3/publication/deploy/real data/main DB init/restart. Physical/native Word NOT_RUN giữ nguyên.

## P3.6-plan-r1 — implementation được duyệt 2026-11-13

Khiêm duyệt C36-01–03/ASCII và P36-01–05 local/synthetic; [task/authority](tasks/CHURCH-P3.6.md). Code/wiring trước tests, bàn giao rồi dừng; chưa đóng P3/mở P4, chưa publication/deploy/real data/main DB init/restart3443. Physical/native Word NOT_RUN giữ nguyên.


## Đầu ra bàn giao P3.6-r1 — 2026-11-13

P36-01–05 hoàn tất nguồn và kiểm chứng local/synthetic theo plan-r1/C36-01–03/ASCII. [Checklist/biên bản](tasks/CHURCH-P3.6.md) gồm công thức/source window; UI/drilldown hai realm; cross-P3 workflow; quyền/concurrency/replay/regression; tải/restore/cleanup/NOT_RUN. Chờ Khiêm nghiệm thu; không tự đóng P3/mở P4 hoặc publication/deploy/dữ liệu thật. Read ports/snapshot/query contracts và runbook tại [P3.6](engineering/P3.6-reporting.md).


## Nghiệm thu P3.6-r1 và giữ điểm dừng — 2026-11-13

Khiêm: **“Anh nghiệm thu P3.6-r1 theo năm mục; ghi nhận acceptance rồi tiếp tục dừng trước đóng P3, chưa mở P4.”** P36-01–05 HUMAN_ACCEPTED đủ năm mục local/synthetic. [Biên bản/checklist](tasks/CHURCH-P3.6.md), [evaluation](engineering/skill-usage/records/CHURCH-P3/P3.6-human-acceptance-1.json). Giữ nguyên technical snapshots/journal implementation; không chạy lại tests/runtime. Chưa đóng P3/mở P4/commit/push/deploy/real data/main DB init/restart3443. Camera/giấy thật/native Word và các giới hạn NOT_RUN vẫn giữ nguyên. Live state duy nhất tại project-state.


## Đóng P3; P4 chưa mở — 2026-11-13

Theo chỉ dẫn Khiêm, P3 CLOSED sau nghiệm thu sáu gói local/synthetic. [Biên bản](tasks/CHURCH-P3.md#đóng-p3), [closure evaluation](engineering/skill-usage/records/CHURCH-P3/P3-closure-1.json). Chỉ thông báo chat P4 đã chỉ định; không duyệt P4-plan-r1 hoặc mở P4/planning chi tiết/coding. Giữ technical snapshots, NOT_RUN và giới hạn; chưa commit/push/deploy/real data/main DB init/restart3443. Live state duy nhất tại project-state; các điểm dừng P3 chưa đóng phía trên là lịch sử.
