# P6.3 — Liên kết tài khoản và cổng hồ sơ

Khiêm nghiệm thu P6.2-r1 đủ năm mục và cho phép triển khai P6.3 local/synthetic theo kế hoạch P6.2–P6.5 đã duyệt. Phạm vi gồm owner gắn/đổi/gỡ, cổng hồ sơ/lễ nghi chỉ đọc, quyền và kiểm chứng. [Contract](../engineering/P6.3-member-portal.md).

## Năm mục nghiệm thu

- [x] Owner tìm và xác nhận đúng hồ sơ cùng Hội Thánh, có lý do. Hai tài khoản tranh một hồ sơ chỉ một giao dịch thành công.
- [x] Tín hữu xem đúng tập trường hồ sơ của mình. Trước khi liên kết chỉ thấy trạng thái và hướng hỗ trợ.
- [x] Lễ nghi chỉ hiện bản đã ghi nhận và vai trò của chính mình. Không có danh tính người cùng lễ, ghi chú hoặc file.
- [x] Đổi/gỡ liên kết, khóa, đổi role và hồ sơ chuyển đi được kiểm lại. Phiên/cursor cũ bị từ chối. Phục hồi hồ sơ cần xác nhận lại.
- [x] Kiểm thử local/synthetic và bằng chứng giao diện đạt trong phạm vi, nêu rõ phần chưa chạy.

Bàn giao để Khiêm nghiệm thu rồi dừng trước P6.4. E51-01 USER_WAIVED, E55-01 hoãn trước production và UI-POSTP8-01 hoãn sau P8. Không áp main hoặc phát hành.

## P6.3-r1 — Bàn giao local/synthetic

SOURCE_COMPLETE, HUMAN_ACCEPTANCE=PENDING_REVIEW, NOT_RELEASED. [Hồ sơ kiểm chứng](../../output/p6.3/verification.json).

- 76 tests/1.244 assertions, 0 fail. Thử cạnh tranh liên kết, đổi/gỡ, khóa, đổi role, phục hồi hồ sơ và cursor/token cũ. Ca dừng một yêu cầu đọc đã xác thực trước transaction, gắn lại đúng người bằng owner, sau đó tiếp tục yêu cầu cũ đã xác nhận không trả hồ sơ cũ.
- Firefox 334 checks, 52 ảnh, 160 khoảng cách đo thực, không lỗi bố cục. Ca mobile đo đúng nhãn bấm của checkbox và vai trò lễ nghi hiện ngay không cuộn ngang. [Ảnh owner](../../output/p6.3/browser-handoff/browser/member-link-390-light.png) · [Ảnh portal](../../output/p6.3/browser-handoff/browser/portal-rites-390-dark.png).
- Typecheck, lint, UI standard, build sản phẩm/reference và diff check đạt. Gói dùng MongoDB/Redis local và database UUID synthetic, browser cleanup xác minh DB đã xóa. Không có lần áp main, release hay kiểm Safari/thiết bị thật. E55-01 tiếp tục hoãn trước production. Không mở P6.4.

## Nghiệm thu và mở P6.4

Khiêm: “Duyệt P6.3-r1. Mở P6.4 dừng trước P6.5”. **P6.3-r1 HUMAN_ACCEPTED 5/5 local/synthetic, chưa phát hành.** Các mục NOT_RUN vẫn giữ nguyên. [Biên bản](../engineering/skill-usage/records/CHURCH-P6/P6.3-human-acceptance-1.json).
