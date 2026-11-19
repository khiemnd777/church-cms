# P6.1 — Hoàn thiện bảy biểu mẫu

**Theo roadmap P0–P8 / P6.** Khiêm duyệt P6.1–P6.6 và C6-01–08 trong chat. Sau đó: “Duyệt **P6.1-plan-r1**, gồm ba quy tắc dữ kiện, ASCII và lựa chọn **bộ mẫu nội bộ có watermark**, triển khai local/synthetic.”

Phạm vi: P61-01 giữ bốn mẫu P3.5; P61-02 mở ba mẫu còn thiếu; P61-03 dùng lại luồng file/chốt/thay thế/thu hồi; P61-04 kiểm chứng và bàn giao. [Contracts](../engineering/P6.1-certificates.md). Bảy mẫu dùng nội bộ kiểm thử. W18 thuộc P6.2.

## Năm mục nghiệm thu của Khiêm

- [ ] Bảy mẫu W11/W17 mở đúng; W06/W14 giữ luồng hiện có.
- [ ] Word/PDF và bản in đủ nội dung đã xác nhận, watermark, vùng ký và phân trang.
- [ ] Hai tenant và hai realm giữ đúng quyền xem, chốt, tải, in và lịch sử.
- [ ] Preview cũ, cạnh tranh, mất phản hồi và lỗi render không tạo bản chốt sai hoặc đổi nghiệp vụ nguồn.
- [ ] Kiểm tra kỹ thuật, chứng cứ trực quan và giới hạn local/synthetic rõ ràng.

Điểm dừng sau P6.1. Chỉ Khiêm có quyền nghiệm thu và mở P6.2. E51-01 đã được Khiêm bỏ qua; E55-01 còn mở và hoãn đến trước production; UI-POSTP8-01 hoãn sau P8. Không áp main, dùng dữ liệu thật hoặc phát hành.

## P6.1-r1 — Bàn giao local/synthetic

SOURCE_COMPLETE, kiểm chứng cục bộ trong phạm vi dưới đây, HUMAN_ACCEPTANCE=PENDING_REVIEW, NOT_RELEASED. [Bằng chứng](../../output/p6.1/verification.json).

- 51 tests / 857 assertions / 0 fail trên Certificates, Visitation, P4 workflows và hai bộ kiểm tra liên quan. Bao gồm bốn mẫu P3.5, hai realm/tenant, yêu cầu chốt cạnh tranh, mất phản hồi, thu hồi quyền và nguồn đổi sau preview. Lượt đầu trong môi trường không truy cập được Mongo loopback dừng ở setup; lượt cuối dùng đúng Mongo/Redis local và database synthetic riêng.
- Firefox 924 checks, 55 ảnh, 60 khoảng cách đo thực, không có lỗi composition được ghi nhận. Cả bảy mẫu chốt, tải file thật và mở bản in. Browser chạy trước khi bổ sung hai thông báo lỗi tiếng Việt; integration và kiểm tra tĩnh chạy sau.
- Đã xem 9 trang PDF A4, gồm 7 mẫu và ca dài 2 trang; đối chiếu watermark, phân trang, font tiếng Việt và vùng ký. Kiểm XML/nội dung/font của 7 DOCX tải từ browser. Chưa render DOCX trong ứng dụng đọc Word độc lập, chưa kiểm Word cài đặt hay giấy in.
- Typecheck, lint (10 cảnh báo CSS gốc), UI standard, product/reference build và diff check đạt. Audit dependency hoãn theo E55-01. Full repository suite và các xác minh vật lý/Safari/UAT/main/pilot/remote CI/production/multi-replica/review độc lập chưa chạy. Prior UNKNOWN giữ nguyên.
- Validator tương thích cho fence Visitation chỉ dùng ở database synthetic. Không áp main/production. Đề nghị Khiêm xem năm mục checklist và xác nhận ngay trong chat trước khi mở P6.2.

## Nghiệm thu của Khiêm — 2026-11-19

Khiêm: “Nghiệm thu P6.1-r1. Mở P6.2 đến P6.5 trong cùng một kế hoạch.” **P6.1-r1 HUMAN_ACCEPTED local/synthetic, chưa released.** [Biên bản nghiệm thu](../engineering/skill-usage/records/CHURCH-P6/P6.1-human-acceptance-1.json). Bằng chứng kỹ thuật phía trên giữ trạng thái tại thời điểm bàn giao. Các mục NOT_RUN và giới hạn nội bộ giữ nguyên. P6.2–P6.5 mở lập kế hoạch chung trước coding; P6.6 chưa mở.
