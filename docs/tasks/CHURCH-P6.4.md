# P6.4 — Dâng hiến cá nhân

Thuộc Church CMS P0–P8 → P6. Khiêm duyệt P6.3-r1 và mở P6.4 local/synthetic theo P6.2–P6.5-plan-r2 và ASCII đã duyệt. Bàn giao rồi dừng trước P6.5. [Contract](../engineering/P6.4-personal-giving.md).

## Checklist nghiệm thu

- [x] Tài khoản tín hữu có liên kết hiệu lực xem phần của mình trên phiếu chung. Mỗi mục chỉ có ngày nghiệp vụ, quỹ, phần của tôi và trạng thái.
- [x] Tổng ròng theo kỳ đúng đến từng đồng. Phiếu tổng hợp không phân bổ. Phiếu hủy vẫn hiển thị phần gốc và đóng góp 0. Phiếu thay đã ghi sổ được tính đúng kỳ của chính nó.
- [x] Trang nào cũng kiểm quyền và liên kết hiện hành. Owner hỗ trợ, các vai trò ngoài cổng, tài khoản chưa liên kết hoặc khác Hội Thánh bị từ chối. Cursor sai kỳ, sai người hoặc phiên đã thu hồi bị chặn.
- [x] Cổng có mục Dâng hiến, chọn kỳ, tổng ròng, Xem thêm và các trạng thái tải, trống, lỗi. Bố cục đọc được trên desktop/mobile ở sáng/tối.
- [x] Kiểm chứng synthetic cả API và giao diện. Đối chiếu truy vấn đã lọc tại nguồn, kiểm không phát sinh bút toán và ghi giới hạn bàn giao.


## P6.4-r1 — Bàn giao local/synthetic

SOURCE_COMPLETE, HUMAN_ACCEPTANCE=PENDING_REVIEW, NOT_RELEASED. [Hồ sơ kiểm chứng](../../output/p6.4/verification.json).

- Kiểm thử tích hợp Finance và cổng tín hữu đạt 64 tests, 1.078 assertions, 0 fail. Kiểm số nguyên lớn hơn 2^53, dòng lặp của mình trên phiếu chung, phiếu tổng hợp, hủy và thay khác kỳ, mã đã ngừng, và đối chiếu bút toán giữ nguyên. Kiểm phiên bị thu hồi ngay cả khi đổi liên kết trong lúc yêu cầu cũ đang chờ.
- Firefox đạt 405 checks, 64 ảnh, 492 khoảng cách đo thực, không lỗi bố cục. Có trạng thái tải, lỗi và tải lại, trống, danh sách có phiếu hủy, chọn kỳ và tải trang sau. Đã xem ảnh 390 và 1440 px. [Ảnh mobile](../../output/p6.4/browser/portal-giving-390-dark.png) · [Ảnh desktop](../../output/p6.4/browser/portal-giving-1440-light.png).
- Truy vấn của gói đo với 6.000 phiếu synthetic. Số phiếu phải đọc giảm 5.555 → 26 ở trang đầu, 4.288 → 29 ở trang sau và 6.000 → 29 khi tính tổng. [Kế hoạch truy vấn](../../output/p6.4/query-plan-runtime.json).
- Typecheck, lint (10 cảnh báo CSS có sẵn), UI standard, build sản phẩm/reference và diff check đạt. MongoDB synthetic đã được dọn. Full suite, Safari, thiết bị thật, UAT, main, pilot, production, remote CI, multi-replica và review độc lập NOT_RUN.
- P6.5 dừng chờ Khiêm nghiệm thu P6.4. E55-01 tiếp tục hoãn trước production.

## Nghiệm thu và mở P6.5

Khiêm: “Nghiệm thu P6.4-r1 đủ 5 mục checklist. Mở triển khai P6.5 local/synthetic theo kế hoạch đã duyệt, bàn giao rồi dừng để tôi nghiệm thu trước P6.6.” **P6.4-r1 HUMAN_ACCEPTED 5/5 local/synthetic, chưa phát hành.** [Biên bản](../engineering/skill-usage/records/CHURCH-P6/P6.4-human-acceptance-1.json).
