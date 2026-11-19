# P6.6 — Kiểm chứng tổng hợp P6

Thuộc Church CMS P0–P8 → P6. Khiêm nghiệm thu P6.5-r1 đủ 5 mục và mở kiểm chứng tổng hợp local/synthetic. Bàn giao rồi dừng trước đóng P6. [Cách chạy và giới hạn](../engineering/P6.6-qualification.md).

## Checklist nghiệm thu

- [x] Nối owner liên kết → đăng nhập tín hữu → hồ sơ/lễ nghi → phần dâng hiến riêng → gửi cầu thay riêng. Cùng Hội Thánh giả lập thực hiện phát hành giấy và chốt báo cáo.
- [x] So khớp bảy loại giấy và chỉ tiêu/bản chốt của báo cáo với các file đầu ra. Mẫu nội bộ giữ watermark và giới hạn sử dụng.
- [x] Kiểm hai realm và hai Hội Thánh, đổi liên kết trong lúc đọc, nguồn đổi sau preview, mất phản hồi/thử lại, rollback và tải file sau khi thu hồi quyền.
- [x] Có số đo tải local có điều kiện rõ và kết quả hồi quy cùng ảnh trình duyệt.
- [x] Restore sang database UUID mới. So documents, indexes, validators và hash file trước biến đổi. Sau đó thu hồi phiên/preview, kiểm lại quyền và giữ giao dịch sau mốc sao lưu ở trạng thái UNKNOWN trên bản phục hồi. Dừng để Khiêm nghiệm thu trước khi đóng P6.


## P6.6-r1 — Bàn giao local/synthetic

P6.1–P6.5 HUMAN_ACCEPTED. P6.6 đã kiểm chứng kỹ thuật, HUMAN_ACCEPTANCE=PENDING_REVIEW. P6 chờ Khiêm nghiệm thu và cho đóng, chưa phát hành. [Hồ sơ kiểm chứng](../../output/p6.6/verification.json).

- 115 kiểm tra trên luồng nối thật, cùng Hội Thánh synthetic cho cổng, phiếu dâng hiến chi tiết, cầu thay, chứng nhận và báo cáo. Hồi quy toàn dự án 499 tests/7.356 assertions và Firefox hai bộ 1.591 checks/144 ảnh/1.276 khoảng cách, 0 lỗi.
- Đối chiếu tên mẫu và watermark của 7 cặp DOCX/PDF tải từ giao diện. PDF và Excel của bản chốt tích hợp khớp đủ 13 hàng với số liệu fixture. [Đối chiếu file](../../output/p6.6/file-parity.json) · [Ảnh PDF](../../output/p6.6/qualification-handoff/report-page-1.png).
- Hai Hội Thánh và hai realm, nguồn thay đổi sau preview, đổi liên kết khi đang đọc, mất phản hồi, retry và audit rollback đã được kiểm. Bốn đường tải file trả 403 ngay sau mất quyền, kể cả cookie hiện hành. Sau thu hồi phiên trả 401.
- 192 lượt đọc gồm 1/5/10 tác vụ đồng thời. Ở 10 tác vụ, p95 từng route từ 60,85 đến 104,74 ms. Dùng 8 hồ sơ giả lập và handler nội tiến trình. [Số đo](../../output/p6.6/qualification-handoff/load.json).
- Restore 66 collection khớp documents, indexes, validators và 4 SHA-256 trước biến đổi. Thu hồi 6 phiên và 3 preview, đổi khóa ký. Đăng nhập mới kiểm lại quyền và tải file. Giao dịch sau mốc sao lưu được giữ UNKNOWN trên bản phục hồi, không phát lại tiền. Hai database UUID và thư mục tạm đã dọn. [Bằng chứng restore](../../output/p6.6/qualification-handoff/restore.json).
- Typecheck, lint, build, UI standard và diff check đạt. Lint còn 10 cảnh báo CSS có sẵn. Safari, thiết bị thật, Word cài đặt, UAT, main, pilot, production, remote CI, nhiều replica và review độc lập NOT_RUN. E55-01 tiếp tục hoãn trước production.


## Nghiệm thu P6.6 và đóng P6

Khiêm: “Nghiệm thu P6.6-r1 đủ 5 mục checklist. Đóng P6 ở phạm vi local/synthetic rồi dừng.”

**P6.6-r1 HUMAN_ACCEPTED 5/5. P6.1–P6.6 đã nghiệm thu và P6 CLOSED local/synthetic.** Chưa phát hành. Bằng chứng kiểm chứng tại thời điểm bàn giao vẫn được lưu làm lịch sử. Các giới hạn kiểm chứng, watermark nội bộ và E51-01/E55-01/UI-POSTP8-01 giữ theo quyết định hiện có.

[Biên bản nghiệm thu P6.6](../engineering/skill-usage/records/CHURCH-P6/P6.6-human-acceptance-1.json) · [Biên bản đóng P6 và sáu gói](../engineering/skill-usage/records/CHURCH-P6/P6-closure-1.json).
