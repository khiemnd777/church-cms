# CHURCH-P2 — roadmap P2-plan-r1

Quyết định chốt ngày2026-11-12: **P2 CLOSED**, P2.1–P2.6 HUMAN ACCEPTED local/synthetic; **P3 NOT_OPENED**. [Biên bản đóng P2](#đóng-p2). Các mục trước biên bản đóng là lịch sử từng gói.

Khiêm duyệt P2-plan-r1 trong chat ngày 2026-11-11. Danh mục: P2.1 Cấu hình và danh mục tổ chức → P2.2 Hồ sơ thuộc viên/thân hữu → P2.3 Gia đình và lịch sử tách/gộp → P2.4 Tổ chức thực tế và phạm vi truy cập → P2.5 Import/export có đối soát → P2.6 Tổng quan và kiểm chứng P2.

Mỗi gói hoàn thiện dữ liệu/API/quyền/UI rồi tests và bàn giao; dừng đến khi Khiêm nghiệm thu và cho mở gói tiếp. P2.1-plan-r1 và trọn P21-01–05 được phép implementation local/synthetic. Không commit/push/deploy/dữ liệu thật; không tự mở P2.2. Chi tiết [P2.1](CHURCH-P2.1.md), trạng thái live duy nhất [project-state](../project-state.md).

## Quyền mở P2.2

Ngày2026-11-11 Khiêm nghiệm thu P2.1 và mở P2.2. P2.1-r2 HUMAN ACCEPTED. P2.2 được mở để cụ thể hóa hồ sơ thuộc viên/thân hữu theo roadmap đã duyệt; kế hoạch chi tiết, contracts và ASCII mockup trình trong chat trước coding. Không tự mở P2.3 hoặc cấp quyền Git publication/deploy/dữ liệu thật cho P2.2.

P2.2-plan-r1 đã được duyệt và mở trọn P22-01–05 ngày2026-11-11; xem [P2.2](CHURCH-P2.2.md). Điểm dừng tiếp theo là trước P2.3.

## Bàn giao P2.2-r1

P22-01–05 hoàn tất và kiểm chứng local/synthetic; chờ human acceptance, chưa released.108tests/1574assertions và1708Firefoxchecks PASS. [Biên bản P2.2](CHURCH-P2.2.md), [receipt](../../output/p2.2/verification.json). Dừng trước P2.3; không commit/push/deploy/dữ liệu thật. Quyền mở gói sau vẫn cần chỉ dẫn Khiêm.

## Nghiệm thu P2.2 — chưa mở P2.3

Khiêm: **“Nghiệm thu P2.2, chưa mở P2.3”**. P2.2-r1/P22-01–05 HUMAN ACCEPTED local/synthetic; [acceptance1](../engineering/skill-usage/records/CHURCH-P2/P2.2-human-acceptance-1.json). Giữ P2.3 NOT_OPENED, không mở gói sau hoặc suy quyền publication/deploy/dữ liệu thật. Các trạng thái chờ nghiệm thu ở phần bàn giao phía trên giữ làm lịch sử.

## Quyền mở lập kế hoạch P2.3

Ngày2026-11-11 Khiêm chỉ dẫn mới: **“mở P2.3”**. Thay điểm dừng chưa mở P2.3 ở biên bản nghiệm thu P2.2 trước đó: mở bước lập kế hoạch chi tiết Gia đình/lịch sử tách-gộp theo P2-plan-r1. Đối chiếu W03/P0 và code Families/Members P2.2; trình P2.3-plan-r1 với contracts, acceptance và ASCII mockup trong chat để duyệt trước coding. Chưa cấp quyền implementation P23, P2.4, commit/push/deploy hoặc dữ liệu thật. Dự thảo chưa duyệt giữ trong chat theo AGENTS.md; chỉ cập nhật authority/current state, không ghi lại implementation/skill usage P2.2.

Khiêm đã duyệt P2.3-plan-r1 và cho triển khai trọn P23-01–05 local/synthetic; [task P2.3](CHURCH-P2.3.md). Bàn giao rồi dừng trước P2.4; không commit/push/deploy/dữ liệu thật.

## Bàn giao P2.3-r1

P23-01–05 source complete/local verified;124tests/1879assertions và2530Firefoxchecks PASS. [Biên bản P2.3](CHURCH-P2.3.md), [receipt](../../output/p2.3/verification.json). Chờ human acceptance, chưa released; dừng trước P2.4, không publication/deploy/dữ liệu thật.

## Nghiệm thu P2.3 và mở planning P2.4

Khiêm: **“Nghiệm thu P2.3, mở 2.4”**. P2.3-r1 HUMAN ACCEPTED; [acceptance1](../engineering/skill-usage/records/CHURCH-P2/P2.3-human-acceptance-1.json). P2.4 mở lập kế hoạch Tổ chức thực tế và phạm vi truy cập: đối chiếu W04/W13, Organization/Members/Families/Accounts/Authorization; trình P2.4-plan-r1 trong chat để duyệt trước coding. Chưa mở implementation P24 hoặc P2.5/publication/deploy/dữ liệu thật. Dự thảo chưa duyệt giữ trong chat; chỉ cập nhật acceptance/authority/current state trong lượt mở gói này.

## Quyền implementation P2.4

Khiêm duyệt P2.4-plan-r1 và trọn P24-01–05 local/synthetic; [task](CHURCH-P2.4.md). Bàn giao rồi dừng trước P2.5; không commit/push/deploy/dữ liệu thật.

## Bàn giao P2.4-r1

P24-01–05 source complete/local verified; chờ human acceptance. PASS137tests/2133assertions +13focused/254assertions sau receipt-case fix; Firefox3326checks. [Task/checklist](CHURCH-P2.4.md), [receipt](../../output/p2.4/verification.json). Dừng trước P2.5; không publication/deploy/dữ liệu thật.

## Human review P2.4-r1

Khiêm chưa nghiệm thu, yêu cầu giữ group và switch card ↔ table/grid; [task/review1](CHURCH-P2.4.md#human-review1--changes_requested). Trình kế hoạch/mockup sửa đổi trước coding; P2.5 chưa mở.

## Bàn giao P2.4-r2

Theo view-plan-r1 đã duyệt, P24-04/05 hoàn tất Card/Bảng giữ group/state/scope;1254Firefoxchecks/170geometry samples PASS. [Task](CHURCH-P2.4.md), [receipt r2](../../output/p2.4/r2/verification.json). R2 chờ nghiệm thu; dừng trước P2.5, không publication/deploy/dữ liệu thật.

## Bàn giao P2.4-r3

Theo icon-plan-r1 đã duyệt, switcher Card/Bảng icon-only đã source complete/local verified;1407P24+282sharedUI checks PASS. [Task](CHURCH-P2.4.md), [receipt](../../output/p2.4/r3/verification.json). Chờ Khiêm nghiệm thu; dừng trước P2.5, không publication/deploy/dữ liệu thật.

## Nghiệm thu P2.4-r3; mở kế hoạch P2.5 — 2026-11-12

Khiêm: “Nghiệm thu P2.4-r3, mở kế hoạch P2.5.” P2.4-r3/P24-01–05 HUMAN ACCEPTED local/synthetic. P2.5 mở PLANNING_ONLY; CSV UTF-8 và Excel .xlsx theo lựa chọn Khiêm. P2.5-plan-r1/contracts/acceptance/mockup chờ duyệt trước coding. Không mở P2.6, commit/push/deploy hoặc dùng dữ liệu thật.

[Human acceptance](../engineering/skill-usage/records/CHURCH-P2/P2.4-human-acceptance-3.json). P2.1–P2.4 đã nghiệm thu; P2.5 Import/export có đối soát đang lập kế hoạch; P2.6 chưa mở. Dự thảo P2.5-plan-r1 chỉ trình trong chat, chưa lưu thành đặc tả đã duyệt hoặc planning usage. Chưa có mẫu import thật/ẩn danh được nghiệm thu; chỉ dự kiến synthetic.

## Quyền implementation P2.5 — 2026-11-12

Khiêm duyệt P2.5-plan-r1 và trọn P25-01–05 local/synthetic; [task](CHURCH-P2.5.md). Bàn giao rồi dừng trước P2.6, không commit/push/deploy/dữ liệu thật.

## Bàn giao P2.5-r1

P25-01–05 source complete/local-synthetic verified; [task/checklist](CHURCH-P2.5.md), [receipt](../../output/p2.5/verification.json). PASS169tests/2450assertions và2646Firefoxchecks. Chờ Khiêm nghiệm thu; P2.6 chưa mở. Không commit/push/deploy/dữ liệu thật, main DB/server3443 chưa nâng cấp.

## Nghiệm thu P2.5-r1; mở kế hoạch P2.6 — 2026-11-12

Khiêm: “Nghiệm thu P2.5-r1, mở kế hoạch P2.6.” P2.5-r1/P25-01–05 HUMAN ACCEPTED local/synthetic. Mở P2.6 Tổng quan và kiểm chứng P2 ở bước PLANNING_ONLY; P2.6-plan-r1/contracts/acceptance/mockup chờ duyệt trước coding. Không đóng P2 hoặc mở P3; không commit/push/deploy/dữ liệu thật.

[Acceptance](../engineering/skill-usage/records/CHURCH-P2/P2.5-human-acceptance-1.json). P2.1–P2.5 đã nghiệm thu; P2.6 Tổng quan và kiểm chứng P2 đang lập kế hoạch. Đối chiếu W01/P0, nguồn HTML UI-STD-r1, Members/Families/Organization/Identity và qualification P1.4/P2.5. Dự thảo P2.6-plan-r1 trình trong chat; chưa tạo đặc tả đã duyệt hoặc planning usage.

## Quyền implementation P2.6 — 2026-11-12

Khiêm: “Duyệt P2.6-plan-r1 để triển khai trọn P26-01–05 local/synthetic, bàn giao nghiệm thu rồi dừng trước P3. Chưa đóng P2, commit/push, deploy hoặc dùng dữ liệu thật.” [Task](CHURCH-P2.6.md). Một gói P26-01–05 local/synthetic; chờ nghiệm thu, P2 chưa đóng/P3 chưa mở.

## Bàn giao P2.6-r1 — 2026-11-12

P26-01–05 source complete/local-synthetic verified; [task/checklist](CHURCH-P2.6.md), [receipt](../../output/p2.6/verification.json). PASS183tests/2560assertions,4838Firefoxchecks;720measuredHTTP0errors/21workflowchecks/restore19collections/cleanup readback PASS. P2.1–P2.5 đã nghiệm thu; P2.6-r1 chờ nghiệm thu. **P2 OPEN; P3 NOT_OPENED.** Không commit/push/deploy/dữ liệu thật, không init main DB/restart3443. Human acceptance và closing P2 cần chỉ dẫn riêng.


## Đóng P2

Khiêm: **“Nghiệm thu P2.6-r1. Đóng P2. Chưa mở P3.”** (2026-11-12).

- **P2 CLOSED**; toàn bộ gói đã HUMAN ACCEPTED: P2.1-r2 Cấu hình/danh mục tổ chức; P2.2-r1 Hồ sơ; P2.3-r1 Gia đình; P2.4-r3 Tổ chức/quyền; P2.5-r1 Import/export; P2.6-r1 Tổng quan/kiểm chứng.
- [Acceptance P2.6 và closure](../engineering/skill-usage/records/CHURCH-P2/P2.6-human-acceptance-1.json) nối implementation P2.6/1, tham chiếu5acceptance trước. [Biên bản P2.6](CHURCH-P2.6.md), [receipt kỹ thuật tại bàn giao](../../output/p2.6/verification.json). Không sửa receipts/journals cũ hoặc tính lại usage implementation.
- Bằng chứng tại bàn giao P2.6:183tests/2560assertions,4838Firefoxchecks,720measuredHTTP0errors,21workflowchecks và restore19collections/cleanup PASS. Đây không phải tests mới trong bước đóng P2; giới hạn/NOT_RUN giữ nguyên, chưa released.
- **P3 NOT_OPENED**: không tự lập kế hoạch hoặc implementation P3. Không commit/push/deploy/dữ liệu thật, init main DB/restart/shutdown dịch vụ trong bước ghi nhận này.

Điểm dừng: P2 đã đóng; chờ chỉ dẫn mới của Khiêm. Trạng thái sống duy nhất tại [project-state](../project-state.md).
