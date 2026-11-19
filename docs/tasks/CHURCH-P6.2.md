# P6.2 — Báo cáo Tổng Liên Hội và mẫu theo Hội Thánh

Khiêm duyệt P6.2–P6.5-plan-r2, ASCII bổ sung và triển khai riêng P6.2 local/synthetic. Bản đầu dùng mẫu XLSX riêng từng Hội Thánh, một sheet. Thư ký/Mục sư tải lên, Mục sư kích hoạt/ngừng dùng. Hệ thống đóng dấu **BÁO CÁO NỘI BỘ**. [Contract P6.2](../engineering/P6.2-church-reports.md).

## Năm mục nghiệm thu

- [x] W11/W01 mở W18. Hai Hội Thánh tự chọn hai bố cục khác nhau. Thư ký có thể tải và xem thử, Mục sư kích hoạt. Hai tenant cách ly.
- [x] 13 chỉ tiêu theo kỳ và nguồn đã duyệt. Số hiện trạng có thời điểm tổng hợp; dữ kiện thiếu có cảnh báo và ký hiệu riêng phù hợp.
- [x] Preview, xác nhận, chốt, Excel/PDF cùng nội dung. Bản thay thế giữ bản và file cũ. Excel/PDF có dấu nội bộ.
- [x] File không phù hợp bị chặn và giữ mẫu đang dùng. Nguồn/mẫu/quyền đổi và thao tác đồng thời giữ đúng quyền và bản chốt.
- [x] Kiểm tra kỹ thuật và bằng chứng local/synthetic, ghi rõ giới hạn.

Dừng chờ Khiêm nghiệm thu P6.2 trước khi mở P6.3. E51-01 USER_WAIVED, E55-01 hoãn trước production, UI-POSTP8-01 hoãn sau P8. Không áp main hoặc phát hành.

## P6.2-r1 — Bàn giao local/synthetic

SOURCE_COMPLETE, HUMAN_ACCEPTANCE=PENDING_REVIEW, NOT_RELEASED. [Bằng chứng](../../output/p6.2/verification.json).

- 57 tests/847 assertions, 0 fail ở lượt hồi quy. Lượt Reporting cuối có 5 tests/84 assertions, 0 fail, tính riêng vì có 4 test trùng với lượt hồi quy. Kiểm 13 chỉ tiêu, ca lệch kỳ và thiếu ngày, tách hai Hội Thánh, phân quyền, lỗi file, cạnh tranh kích hoạt/chốt và retry.
- Firefox 1.094 checks, 64 ảnh, 430 khoảng cách đo thực, trong đó W18 có 370. Không ghi nhận lỗi bố cục. Đo các cột số liệu vừa trong khung ở 5 chiều rộng, light/dark. [Ảnh bảng số liệu synthetic](../../output/p6.2/browser-handoff/browser/report-values.png).
- Kiểm Excel và PDF tải từ cùng bản chốt khớp số liệu và watermark. Đã xem 4 trang PDF, gồm một ca 3 trang. Xác nhận giữ nguyên bytes khi tải lại bản cũ sau thay thế. Excel cài đặt và giấy in thật chưa chạy.
- Typecheck, lint, UI check, build và diff check đạt. Main/production, dữ liệu thật, UAT, Safari, multi-replica và review độc lập chưa chạy. Không mở P6.3. E55-01 còn mở theo quyết định hoãn đến trước production.

## Nghiệm thu của Khiêm — 2026-11-19

Khiêm: “Nghiệm thu P6.2-r1 theo năm mục checklist. Mở triển khai P6.3 local/synthetic theo kế hoạch đã duyệt, bàn giao rồi dừng để tôi nghiệm thu trước P6.4.” **P6.2-r1 HUMAN_ACCEPTED đủ năm mục local/synthetic, chưa released.** [Biên bản](../engineering/skill-usage/records/CHURCH-P6/P6.2-human-acceptance-1.json). Bằng chứng kỹ thuật giữ trạng thái gốc tại thời điểm bàn giao. Các mục NOT_RUN và giới hạn mẫu nội bộ giữ nguyên.
