# P7.3 — Chọn cấp duyệt theo hạn mức

Khiêm nghiệm thu P7.2-r1 đủ 72-01–03 và mở P7.3 local/synthetic theo [C73 và ASCII](CHURCH-P7.md#p73--chọn-cấp-duyệt-theo-hạn-mức). Bàn giao để nghiệm thu rồi dừng trước P7.4.

## Cấu hình và dữ liệu

Mục sư bật hoặc tắt và xem trước ở W12. Settings API giữ version/If-Match và idempotency từ P5.1. `approvalThreshold` nhận `{amount, belowRole, atOrAboveRole}` hoặc `null` để tắt. Khi PATCH bỏ trường này, quy tắc đang dùng được giữ. Tiền là chuỗi nguyên đồng dương tối đa 18 chữ số. Quy tắc dùng so sánh BigInt. Đúng ngưỡng thuộc dải từ ngưỡng. Vai trò thuộc danh sách duyệt P5.

Cấu hình luôn giữ vai trò duyệt P5 cho đề xuất cũ và khi tắt hạn mức. Preview gửi gắn với phiên bản cấu hình. Đề xuất tạo khi bật lưu `approvalBand`, `approverRole` và `settingsVersion`. Đổi cấu hình hoặc tắt chỉ định tuyến các đề xuất gửi sau đó. Các đề xuất theo luồng P5 tiếp tục dùng vai trò duyệt hiện hành; dữ liệu cũ giữ nguyên. Quyền lập đề xuất vẫn theo vai trò duyệt P5 và danh sách vai trò lập đã cấu hình.

## Quyền và giới hạn

W10 thêm phạm vi **Cần tôi duyệt** (`scope=review`), chỉ gồm đề xuất chờ do tài khoản khác lập và thuộc cấp tài khoản hiện được quyền xử lý. Mongo lọc tenant, quyền và phạm vi trước bảng, tổng số, tổng tiền và phân trang. Con trỏ tiếp tục gắn cấu hình và bộ lọc. Có chỉ mục dành cho đề xuất theo hạn mức.

Mục sư và Thủ quỹ giữ quyền đọc rộng theo nghiệp vụ tài chính. Người duyệt theo cấp đọc đề xuất được giao, còn quyền đọc đề xuất của chính mình theo quy tắc tạo đề xuất. Vai trò duyệt P5 ngoài Mục sư/Thủ quỹ có phạm vi rộng với hồ sơ P5, và chỉ có quyền đọc theo hồ sơ đối với đề xuất theo hạn mức. Chi tiết, ảnh chứng từ và lịch sử cùng kiểm quyền trên chính đề xuất. Một tài khoản chỉ duyệt theo hạn mức có thể dùng hàng chờ mà không được cấp quyền lập hoặc tải danh sách quỹ. W13 phản ánh khả năng duyệt theo cấp đang có và cấp đã lưu.

Backend xác nhận vai trò hiện hành, cấp đã lưu hoặc quy tắc P5 tương ứng, version và trạng thái chờ trước khi quyết định. Người lập không được tự xử lý. Giao dịch CAS chỉ ghi một quyết định, kèm lịch sử và biên nhận. Đề xuất chưa có người đủ quyền tiếp tục chờ. Thủ quỹ lập phiếu qua kiểm quỹ, số dư, kỳ và phiên bản theo quy tắc P5 hiện hành. P7.3 thay đổi định tuyến quyết định, luồng ghi phiếu và sổ dùng API P5.

## Kiểm chứng

| Mục | Kết quả local/synthetic |
|---|---|
| 73-01 | PASS. Dưới, bằng, trên ngưỡng, gồm giá trị lớn hơn giới hạn nguyên an toàn JS. Cấu hình sai bị từ chối. Đổi hoặc tắt giữ cấp đã chốt, giữ cơ chế P5 cho đề xuất cũ và làm stale preview gửi. |
| 73-02 | PASS. Queue/KPI đúng cấp, chặn chi tiết/ảnh/lịch sử sai cấp, tự duyệt và mất vai trò. Hai tài khoản cùng xử lý chỉ ghi một quyết định. |
| 73-03 | PASS. Đề xuất có ảnh qua duyệt, lập một phiếu, sổ ghi đúng số tiền và số dư. Chặn thiếu số dư, quỹ ngừng dùng và kỳ đóng. Firefox W09 hiển thị phiếu từ đề xuất theo hạn mức. |

- `bun test --timeout 30000 tests/finance-validation.test.ts tests/integration/finance.test.ts tests/integration/expense-proposals.test.ts tests/integration/finance-payments.test.ts tests/integration/finance-periods.test.ts` với Mongo tools local cho ca restore. Kết quả 71 tests, 1265 assertions, gồm hồi quy TTL và restore ảnh C72.
- Hai lượt `bash scripts/browser-check.sh` với `browser-expenses.ts` và `browser-payments.ts` đạt 1328 checks, 124 ảnh, 310 lượt đo bố cục. Hai database browser synthetic đã dọn.
- Lint PASS với 10 cảnh báo CSS có sẵn. Typecheck, UI/CSS, build ứng dụng, build UI reference và diff check PASS.

[Biên nhận](../../output/p7.3/verification.json) · [W12 xem trước](../../output/p7.3/browser/p73-w12-threshold-preview-light-1440.png) · [W10 chi tiết đúng cấp](../../output/p7.3/browser/p73-w10-assigned-detail-light-1440.png) · [W09 sổ chi](../../output/p7.3/payments/ledger-payments-only-light-1440.png).

**PENDING_REVIEW.** Thiết bị thật, Safari, toàn bộ test suite, UAT, main, pilot, remote CI và production NOT_RUN. Chỉ mục và validator chỉ áp dụng trên fixture local. Trước khi áp cho dữ liệu thật cần Khiêm cho phép và Hội Thánh chốt ngưỡng/vai trò. Dừng trước P7.4.

## Nghiệm thu P7.3-r1

Khiêm nghiệm thu local/synthetic đủ **73-01–73-03** và mở kế hoạch chi tiết P7.4 theo C74 để duyệt trước coding. Các kết quả và giới hạn tại bàn giao được giữ để đối chiếu. [Biên bản](../engineering/skill-usage/records/CHURCH-P7/P7.3-human-acceptance-1.json).
