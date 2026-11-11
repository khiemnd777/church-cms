# Kế hoạch Church CMS

Ngày tổng hợp: 2026-11-10. Nguồn chi tiết: [hồ sơ P0](tasks/CHURCH-P0.md). Trạng thái hiện hành duy nhất: [project-state](project-state.md).

## Phạm vi được phép hiện tại

**P1 đã đóng. P1.1–P1.4 HUMAN ACCEPTED.** Khiêm: “Nghiệm thu P1.4 và Đóng P1. Chưa mở P2.” [Biên bản đóng](tasks/CHURCH-P1.md#đóng-p1), [acceptance P1.4](engineering/skill-usage/records/CHURCH-P1/P1.4-human-acceptance-1.json). **P2 NOT_OPENED**; roadmap P2–P8 chỉ là định hướng, chưa quyền planning/implementation hoặc release. Giữ kết quả trong phạm vi local/synthetic đã bàn giao; không publication/deploy/production/dữ liệu thật.

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
