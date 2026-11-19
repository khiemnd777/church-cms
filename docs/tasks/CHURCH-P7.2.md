# P7.2 — Chứng từ đề xuất chi

Khiêm nghiệm thu P7.1-r1 đủ 71-01–03 và cho triển khai P7.2 local/synthetic theo [C72 và ASCII](CHURCH-P7.md#p72--chứng-từ-đề-xuất-chi). Bàn giao để nghiệm thu rồi dừng trước P7.3.

## Luồng và quyền

W10 cho chọn một ảnh JPEG/PNG tối đa 5 MiB. Có thể xem, thay hoặc bỏ trước khi gửi. Ảnh đã gắn cố định khi gửi. Chi tiết của đề xuất cũ hoặc không đính ảnh hiển thị **Chưa có chứng từ**. Bảng chỉ hiện cờ có chứng từ.

Prefix `/api/v1/churches/:churchId/finance/expense-proposals`:

| Endpoint | Phạm vi |
|---|---|
| `POST /attachments` | Ảnh nhị phân JPEG/PNG, same-origin/CSRF. Chỉ người có quyền gửi đề xuất. Trả ID ảnh tạm. |
| `GET /attachments/:id` | Ảnh tạm chưa hết hạn. Chỉ actor tải lên trong tenant và còn quyền gửi. |
| `POST /preview`, `POST /` | Optional `attachmentId`. Preview ràng buộc checksum. Submit chốt ảnh cùng đề xuất, lịch sử, audit và biên nhận trong một giao dịch MongoDB. |
| `GET /:id/attachment` | Ảnh cố định, kiểm quyền trên chính đề xuất. Thêm `?download=1` để tải. Response `no-store`, MIME ảnh và tên chuẩn `chung-tu.jpg/png`. |

Ảnh tạm có TTL 15 phút và bị từ chối ngay khi hết hạn. Thay hoặc bỏ trong giao diện để ảnh cũ hết hạn. Khi gửi, loại trường TTL và gắn ID đề xuất. Cùng ý định gửi đi qua Ops/durable submission của P5 để đối soát. Tách file nhị phân khỏi danh sách đề xuất. Đề xuất cũ giữ dữ liệu và hash đã ghi.

Ảnh kiểm signature, codec, giải mã và giới hạn 20 megapixel. Sharp 0.35.5 chuẩn hóa hướng ảnh và bỏ metadata, rồi mã hóa lại và tính SHA-256 trên bản lưu. Giới hạn 5 MiB áp cho cả đầu vào và bản lưu. Mỗi actor tối đa 12 lượt tải lên/phút và tiến trình xử lý tối đa hai lượt đồng thời. Bun server nhận tối đa 5 MiB để chuyển body đến route ảnh. Các handler JSON vẫn kiểm giới hạn riêng. Retention của chứng từ cố định cần chốt trước khi dùng dữ liệu thật.

## Kiểm chứng local/synthetic

- `bun test --timeout 30000 tests/integration/expense-proposals.test.ts tests/integration/finance-payments.test.ts tests/finance-validation.test.ts`.
- Đặt `CHURCH_P72_MONGO_TOOLS_CONTAINER` thành container MongoDB local để chạy thêm backup/restore và TTL. Test dùng database synthetic UUID cho nguồn và đích, sau đó dọn cả hai.
- `CHURCH_EVIDENCE_DIR=output/p7.2/browser bash scripts/browser-check.sh browser-expenses.ts`. Browser Docker cần binary Sharp Linux cùng kiến trúc. Khi dùng node_modules từ macOS vào container cùng kiến trúc, cài lockfile với `bun install --frozen-lockfile --ignore-scripts --os '*'`.

| Mục | Kết quả local/synthetic |
|---|---|
| 72-01 | PASS. Tạo đề xuất có hoặc không ảnh. Đọc đề xuất cũ. Tải đúng checksum. JPEG đã xoay theo metadata, ảnh kết quả không còn EXIF. |
| 72-02 | PASS. Từ chối sai định dạng, ảnh hỏng, quá cỡ, sai CSRF, khác actor/tenant, owner và member. Thu quyền gửi làm mất quyền tải ảnh của đề xuất tương ứng. |
| 72-03 | PASS. Rollback khi lịch sử lỗi. Gửi lại sau mất phản hồi và hai ý định đồng thời chỉ gắn ảnh một lần. Mongo dọn ảnh tạm hết hạn. Phục hồi database synthetic và đối chiếu SHA-256 của ảnh đã gắn. |

41 tests/581 assertions. Firefox 646 checks, 60 ảnh, 150 lượt đo bố cục. Lint PASS có 10 cảnh báo CSS có sẵn. Typecheck, hai build, UI standard, diff check và audit dependency PASS. Audit lần này trả kết quả rỗng. E55-01 vẫn theo quyết định xử lý trước production. [Biên nhận](../../output/p7.2/verification.json) · [Ảnh chi tiết](../../output/p7.2/browser-r4/pending-detail-light-1440.png).

Sharp được kiểm tra theo [tài liệu đầu vào](https://sharp.pixelplumbing.com/api-constructor/) và [tài liệu mã hóa đầu ra](https://sharp.pixelplumbing.com/api-output/).

**PENDING_REVIEW.** Chạy collection/index TTL và validator mới trên fixture riêng. Thiết bị thật, Safari, toàn bộ suite, UAT, main, pilot, remote CI và production NOT_RUN. Quyền kích hoạt main và chính sách lưu dữ liệu thật thuộc quyết định riêng. Chờ nghiệm thu P7.2 và lệnh mở P7.3.

## Nghiệm thu P7.2-r1

Khiêm nghiệm thu local/synthetic đủ **72-01–72-03** và cho triển khai [P7.3 theo C73](CHURCH-P7.md#p73--chọn-cấp-duyệt-theo-hạn-mức). Các kết quả tại thời điểm bàn giao được giữ để đối chiếu. [Biên bản](../engineering/skill-usage/records/CHURCH-P7/P7.2-human-acceptance-1.json).
