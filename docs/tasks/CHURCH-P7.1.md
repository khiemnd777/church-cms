# P7.1 — Màn chữ lớn cho người giảng

Phạm vi và tiêu chí 71-01–03 theo [P7-plan-r2/C71](CHURCH-P7.md#p71--màn-chữ-lớn). Khiêm cho triển khai P7.1 local/synthetic và yêu cầu dừng trước P7.2.

## Tích hợp

Từ W07, nút **Chữ lớn** mở chế độ đọc của buổi đã xếp lịch. Trạng thái nằm trên URL W07 với `view=large-text&occurrenceId=…`. **Quay lại** bỏ chế độ đọc và giữ chi tiết buổi cùng bộ lọc. **Tải lại** xóa nội dung trước khi gọi lại phép đọc chi tiết Scheduling với phiên hiện hành. Chỉ hiển thị năm trường C71 và trạng thái tải hoặc lỗi phù hợp. Dữ liệu từ request bị hủy khi rời màn. Hai realm dùng chung UI, API và phạm vi quyền sẵn có. Chữ lớn dùng kiểu cục bộ trong màn đọc.

## Kiểm chứng

| Mục | Kết quả local/synthetic |
|---|---|
| 71-01 | PASS. Mở từ chi tiết và URL, đúng nguồn, trường thiếu, bàn phím. Tám tổ hợp desktop/tablet ngang dọc/mobile với light/dark. Nhóm cách 18 px, chủ đề tới Kinh Thánh cách 12 px. |
| 71-02 | PASS. Tải lại sau chỉnh lịch trả chủ đề mới. Quay lại đúng chi tiết và bộ lọc. |
| 71-03 | PASS. Mất quyền ban, ngoài phạm vi, ID khác Hội Thánh, phiên hết hạn và lịch hủy. Hồi quy W07 chạy cùng suite. |

Lint PASS với 10 cảnh báo CSS có sẵn. Typecheck, UI-STD/COMPOSITION, build ứng dụng, build UI reference và diff check PASS. Scheduling 20 tests/297 assertions. Firefox 568 checks và 34 ảnh. Database browser synthetic đã được dọn. [Biên nhận](../../output/p7.1/verification.json) · [Ảnh tablet](../../output/p7.1/browser-r3/p71-reader-tablet.png).

**PENDING_REVIEW.** Thiết bị thật, Safari, toàn bộ test suite, UAT, main runtime, pilot, remote CI và production NOT_RUN. Chế độ đọc kiểm lại quyền vào lúc tải dữ liệu hoặc người dùng bấm tải lại. P7.2 chờ Khiêm nghiệm thu và cho mở.

## Nghiệm thu P7.1-r1

Khiêm nghiệm thu local/synthetic đủ **71-01–71-03** và cho triển khai [P7.2 theo C72](CHURCH-P7.md#p72--chứng-từ-đề-xuất-chi). Kết quả kỹ thuật và các mục NOT_RUN ở trên là trạng thái tại bàn giao. [Biên bản nghiệm thu](../engineering/skill-usage/records/CHURCH-P7/P7.1-human-acceptance-1.json).
