# P6.5 — Gửi cầu thay cá nhân

Thuộc Church CMS P0–P8 → P6. Khiêm nghiệm thu P6.4-r1 đủ 5 mục và mở P6.5 local/synthetic theo P6.2–P6.5-plan-r2, ASCII và C6-08 đã duyệt. Bàn giao rồi dừng trước P6.6. [Contract](../engineering/P6.5-personal-prayers.md).

## Checklist nghiệm thu

- [x] Tín hữu có liên kết hợp lệ chọn danh mục, nhập nội dung, thấy người nhận là Mục sư và xác nhận gửi. Yêu cầu vào sổ hiện có với quyền riêng tư.
- [x] Hai lượt cùng ý định, mất phản hồi sau commit và retry sau khi receipt hết hạn hoặc bị dọn đều tạo một yêu cầu. Lỗi ghi audit giữ giao dịch nhất quán.
- [x] Cổng chỉ xem yêu cầu do cùng account và subject gửi. Yêu cầu nhân sự nhập hộ, account khác, Hội Thánh khác, liên kết cũ hoặc quyền bị thu hồi không trả dữ liệu.
- [x] Mục sư xem và xử lý yêu cầu riêng tư. Cổng chỉ có Đã gửi, Đã khép lại, Đã hủy. Owner/Thư ký không thấy qua danh sách, tìm kiếm, số đếm, lịch sử, audit hoặc receipt. Không mở luồng chia sẻ nội bộ.
- [x] Có bằng chứng synthetic cho API và giao diện, gồm xác nhận, đang gửi/thử lại, rỗng/lỗi, hiển thị desktop/mobile sáng/tối. Ghi phần chưa kiểm chứng.


## P6.5-r1 — Bàn giao local/synthetic

SOURCE_COMPLETE, HUMAN_ACCEPTANCE=PENDING_REVIEW, NOT_RELEASED. [Hồ sơ kiểm chứng](../../output/p6.5/verification.json).

- 95 tests, 1.544 assertions, 0 lỗi trên 5 bộ kiểm thử cổng tín hữu, Prayers, tài khoản, chăm sóc và tổng quan. Thử cùng ý định đồng thời, hết hạn/xóa receipt, rollback khi audit lỗi, thay đổi liên kết giữa lúc đọc/gửi và quyền pastoral theo tenant. MongoDB chặn trùng khóa và từ chối đổi yêu cầu từ cổng sang chia sẻ.
- Firefox 497 checks, 80 ảnh và 846 khoảng cách đo thực, 0 lỗi bố cục. Ca mất phản hồi sau commit giữ nguyên mã ý định; thử lại chỉ có một yêu cầu trong sổ. Đã rà trạng thái chờ, loại thông báo danh sách trống khi kết quả gửi chưa rõ và chạy lại. [Ảnh sau gửi](../../output/p6.5/browser-final/portal-prayers-390-dark.png) · [Ảnh khi chờ](../../output/p6.5/browser-final/prayers-pending-1440-light.png).
- Typecheck, lint (10 cảnh báo CSS có sẵn), UI standard, build sản phẩm/reference và diff check đạt. Cơ sở dữ liệu browser synthetic đã được dọn. Full suite, Safari, thiết bị thật, UAT, main, pilot, production, remote CI, multi-replica và review độc lập NOT_RUN.
- P6.6 dừng chờ Khiêm nghiệm thu P6.5. E55-01 tiếp tục hoãn trước production.

## Nghiệm thu và mở P6.6

Khiêm: “Nghiệm thu P6.5-r1 đủ 5 mục checklist. Mở P6.6 để kiểm chứng tổng hợp P6 bằng dữ liệu local/synthetic, bàn giao rồi dừng để tôi nghiệm thu trước khi đóng P6.” **P6.5-r1 HUMAN_ACCEPTED 5/5 local/synthetic, chưa phát hành.** [Biên bản](../engineering/skill-usage/records/CHURCH-P6/P6.5-human-acceptance-1.json).
