# CHURCH-P4 — roadmap P4-plan-r1

Quyết định chốt ngày 2026-11-15: **P4 CLOSED; P4.1–P4.6 HUMAN_ACCEPTED local/synthetic; P5 NOT_OPENED; chưa released.** [Biên bản đóng P4](#đóng-p4). Các mục trước biên bản đóng giữ lịch sử từng gói.


## Phê duyệt danh mục và mở planning P4.1 — 2026-11-13

Khiêm: **“Duyệt P4-plan-r1. Mở kế hoạch chi tiết P4.1 để duyệt trước coding.”**

P3 đã đóng local/synthetic theo [biên bản closure](CHURCH-P3.md#đóng-p3). Chỉ dẫn hiện tại duyệt danh mục sáu gói P4 và mở **PLANNING_ONLY P4.1 — Lịch giảng và sinh hoạt**. Chưa có approval implementation P4.1; P4.2–P4.6 chưa mở. Trạng thái sống duy nhất tại [project-state](../project-state.md).

Kiểu bàn giao: **Theo roadmap Church CMS P0–P8/P4**. Các luồng lịch, phân công, chăm sóc và dữ liệu riêng tư cần nghiệm thu riêng. Trong từng gói được duyệt implementation: hoàn tất code và wiring thực trước khi viết/cập nhật tests, chạy checks/review, bàn giao rồi dừng. Chỉ mở gói sau khi Khiêm nghiệm thu gói hiện tại và cho phép mở gói sau.

| Gói | Kết quả được duyệt trong danh mục | Phụ thuộc và nghiệm thu chính |
|---|---|---|
| P4.1 — Lịch giảng và sinh hoạt | W07; bảng sáu Chúa nhật, lịch tuần, phân công, lịch một lần/lặp có kết thúc và ngoại lệ; lịch sử thay đổi | P3 đã đóng; lưu thật, ngày giờ Việt Nam, không tạo trùng/ghi đè đồng thời; không tự tạo Attendance/Rites từ lịch dự kiến |
| P4.2 — Chương trình sinh hoạt ban | W07; chọn ban/buổi → tạo nháp từ roster đúng quyền → chỉnh → chốt phiên bản → xem/in chương trình | P4.1; không lấy người ngoài ban để bù thiếu, không mất chỉnh sửa khi sinh lại hoặc viết lại chương trình đã chốt khi roster đổi; quyền trưởng ban chốt trong kế hoạch chi tiết |
| P4.3 — Hồ sơ thăm viếng | W08; tạo thủ công, giao người, ưu tiên/ngày dự kiến, ghi lần thăm/kết quả, hoàn tất/hủy có lý do và lịch sử | Dùng Members/Families, bàn giao sau P4.2; không cấp quyền từ phân công, không tự thay visitor.caregiverId |
| P4.4 — Lời cầu thay và quyền riêng tư | W08; nhập bởi người có quyền, danh mục/phạm vi, trạng thái, lịch sử; kiểm quyền backend cả reads/count/search/history/retry | Bàn giao sau P4.3; riêng tư chỉ Mục sư theo chính sách đề xuất đã trình ở danh mục; owner không có mặc định, quyền chi tiết duyệt trước coding; cổng tín hữu thuộc P6 |
| P4.5 — Cảnh báo và chăm sóc tự động | W01/W08; cảnh báo có nguồn, chuyển thành đề nghị chăm sóc và giao việc không trùng | P4.3–P4.4 và public reporting P3; vắng3 đúng định nghĩa P3.6; nguồn đau ốm/tân tín hữu/gia đình có tang phải chốt; không tự suy từ cầu thay riêng tư hoặc chọn người/gửi thông báo ngoài |
| P4.6 — Tổng hợp và kiểm chứng P4 | Workflow xuyên gói, quyền hai realm/tenant/revoke, concurrency/retry, tải, backup/restore, runbook/checklist/evidence | P4.1–P4.5; bổ sung kiểm chứng tổng hợp, không dời tests của từng gói đến đây; số đo local không là production SLA |

Thứ tự bàn giao: **P4.1 → P4.2 → P4.3 → P4.4 → P4.5 → P4.6**. P4.3 dùng nền tảng Members/Families; P4.4 độc lập về dữ liệu nhưng giữ thứ tự xem xét/nghiệm thu đã duyệt. Không tách gói máy móc theo UI/API/database hoặc theo file. Thay đổi vật chất danh mục/phạm vi cần duyệt kế hoạch sửa đổi.

## Phạm vi và điểm dừng

- Mỗi gói có kế hoạch chi tiết/contracts/quyền/acceptance/ASCII UI được duyệt trước coding. Duyệt danh mục không tự duyệt schema/API hoặc các quy tắc còn cần quyết định ở gói chi tiết.
- P4.1 đang lập kế hoạch trong chat. Dự thảo lịch lặp, phân công, trạng thái, quyền, API và ASCII chưa duyệt không lưu thành thiết kế đã chốt; chưa tạo CHURCH-P4.1 hoặc engineering contract được duyệt.
- UI dùng [UI-STD-r1](../ui-system.md), components chung và nhãn menu icon + tên; chương trình/in ở W07 thuộc P4.2. Phiếu thăm viếng/biểu mẫu hành chính/Word-PDF tổng quát giữ ranh giới P6. Nhắc ngoài, chữ lớn, tích hợp Zalo/email/SMS thuộc P7 hoặc phạm vi riêng.
- Chỉ local/synthetic. Không commit/push/deploy/dữ liệu thật/main DB init/restart3443. Các limits [P3-PHYSICAL-01](CHURCH-P3.md#p3-physical-verification-note) và native Word/main runtime/Safari/UAT/pilot/remoteCI/production/multi-replica NOT_RUN giữ nguyên; không dùng closure P3 để suy đã kiểm chứng.
- [Journal danh mục](../engineering/skill-usage/records/CHURCH-P4/P4-plan-planning-1.json), [evaluation approval](../engineering/skill-usage/records/CHURCH-P4/P4-plan-human-approval-1.json). Không sửa receipts/source manifests/implementation journals P3 hoặc chạy lại runtime/tests để ghi nhận approval.

Nguồn: P4-plan-r1 trong chat đã được Khiêm duyệt; [roadmap cha](../project-plan.md), [W07/W08 và ranh giới quyền](CHURCH-P0.md), source Organization/Members/Attendance/Rites/Overview hiện hành. Chi tiết P4.1 chưa duyệt chỉ ở chat.


## P4.1-plan-r1 — implementation được duyệt — 2026-11-13

Khiêm duyệt C41-01–03/ASCII và trọn P41-01–05 local/synthetic; [authority/checklist](CHURCH-P4.1.md). Thay quyền planning-only ở các mục lịch sử trên; bàn giao rồi dừng trước P4.2. Không commit/push/deploy/real data/main DB init/restart3443.


## Bàn giao P4.1-r1 — 2026-11-14

P41-01–05/C41-01–03/ASCII SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; [task/năm mục nghiệm thu](CHURCH-P4.1.md). Chờ Khiêm nghiệm thu; P4.2–P4.6 chưa mở. Không publication/deploy/real data/main DB init/restart3443. Live state chỉ project-state, receipts P3 và NOT_RUN giữ nguyên.


## Nghiệm thu P4.1-r1, mở planning P4.2 — 2026-11-14

Khiêm: **“Nghiệm thu P4.1-r1 theo năm mục trong checklist. Mở kế hoạch chi tiết P4.2 để duyệt trước coding.”** P41-01–05 đã HUMAN_ACCEPTED đủ năm mục local/synthetic; [task/checklist](CHURCH-P4.1.md), [evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.1-human-acceptance-1.json). P4.2 chỉ investigation/kế hoạch chi tiết trong chat để duyệt trước coding; P4.3–P4.6 chưa mở. Không sửa technical snapshots/journals P4.1 hoặc chạy lại tests/runtime. Không publication/deploy/real data/main DB init/restart3443. Physical/NOT_RUN và các giới hạn qualification/restore giữ nguyên. Live state chỉ project-state.


## P4.2-plan-r1 — implementation được duyệt — 2026-11-14

Khiêm duyệt C42-01–03/ASCII và trọn P42-01–05 local/synthetic; [task](CHURCH-P4.2.md). Code/wiring trước tests, bàn giao rồi dừng trước P4.3. Không publication/deploy/real data/main DB init/restart3443; giữ P4.1 acceptance và limits.


## Bàn giao P4.2-r1 — 2026-11-14

[P42-01–05/năm mục nghiệm thu/evidence](CHURCH-P4.2.md) hoàn tất nguồn và kiểm chứng local/synthetic; chờ human acceptance. P4.1 đã nghiệm thu, P4.3–P4.6 chưa mở. Không tự coding gói sau hoặc publication/deploy/real data; giới hạn physical/NOT_RUN/main runtime/restore giữ nguyên. Live state chỉ project-state.


## Nghiệm thu P4.2-r1, mở planning P4.3 — 2026-11-14

Khiêm: **“Nghiệm thu P4.2-r1 theo năm mục; đồng ý, cho phép mở kế hoạch chi tiết P4.3 để duyệt trước coding.”** P42-01–05 đã HUMAN_ACCEPTED đủ năm mục local/synthetic; [task/checklist](CHURCH-P4.2.md), [evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.2-human-acceptance-1.json). P4.3 chỉ khảo sát và kế hoạch chi tiết trong chat để duyệt trước coding; chưa duyệt C43/contracts/quyền/ASCII hoặc implementation, P4.4–P4.6 chưa mở. Giữ technical snapshots/journals P4.2 và physical/NOT_RUN/workload/restore limits. Không runtime/tests mới hoặc publication/deploy/real data/main DB init/restart3443. Live state chỉ project-state.


## P4.3-plan-r1 implementation được duyệt — 2026-11-14

Khiêm: **“Duyệt P4.3-plan-r1, C43-01–03 và ASCII, cho phép triển khai trọn P43-01–05 local/synthetic, bàn giao rồi dừng trước P4.4”** [Task](CHURCH-P4.3.md). Trọn P43-01–05 local/synthetic, code/wiring trước tests, dừng trước P4.4; giữ authority/NOT_RUN/publication boundaries.


## Bàn giao P4.3-r1 — 2026-11-14

P43-01–05/C43-01–03/ASCII hoàn tất nguồn/wiring trước test phase và kiểm chứng local/synthetic; chờ Khiêm nghiệm thu năm mục P4.3-r1. P4.4–P4.6 NOT_OPENED. Không publication/deploy/real data/main DB read/init/restart3443. [Task/năm mục nghiệm thu/evidence](CHURCH-P4.3.md), [contracts](../engineering/P4.3-visitation.md). P4.1/P4.2 đã nghiệm thu; tiếp theo P4.4 Cầu thay/quyền riêng tư, rồi P4.5 Cảnh báo/chăm sóc tự động và P4.6 Tổng hợp/kiểm chứng, chưa mở. Technical PASS không thay human acceptance/release. Physical/NOT_RUN và aggregate restore limits giữ nguyên; live state chỉ project-state.


## Nghiệm thu P4.3-r1, mở planning P4.4 — 2026-11-14

Khiêm: **“nghiệm thu năm mục P4.3-r1 và cho phép mở kế hoạch chi tiết P4.4 để duyệt trước coding.”** P43-01–05 đã HUMAN_ACCEPTED đủ năm mục local/synthetic; [task/checklist](CHURCH-P4.3.md), [evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.3-human-acceptance-1.json). Chỉ mở khảo sát/kế hoạch chi tiết P4.4 trong chat để duyệt trước coding; chưa chốt C44/quyền/trạng thái/contracts/ASCII hoặc implementation. P4.5–P4.6 chưa mở. Giữ nguyên technical snapshots/journals P4.3 và UNKNOWN P3.4 race/physical/NOT_RUN/workload/restore limits; không chạy lại runtime/tests hoặc publication/deploy/real data/main DB read/init/restart3443. Live state chỉ project-state.


## P4.4 implementation được duyệt — 2026-11-14

Khiêm: **“duyệt P4.4-plan-r1, C44-01–03 và ASCII, cho phép triển khai trọn P44-01–05 local/synthetic, bàn giao rồi dừng trước P4.5.”** [Task/C44/ASCII/checklist](CHURCH-P4.4.md). Không mở P4.5 hoặc publication/deploy/real data/main DB read/init/restart3443.


## Bàn giao P4.4-r1 — 2026-11-14

P44-01–05/C44-01–03/ASCII hoàn tất nguồn và kiểm chứng local/synthetic; [task/năm mục/evidence](CHURCH-P4.4.md), [contracts](../engineering/P4.4-prayers.md). Chờ Khiêm nghiệm thu năm mục P4.4-r1; dừng trước P4.5 Cảnh báo/chăm sóc tự động. P4.1–P4.3 HUMAN_ACCEPTED; P4.5/P4.6 NOT_OPENED. Không publication/deploy/real data/main DB read/init/restart3443. Giữ P43technical snapshots/journals, P3.4UNKNOWN/physical/NOT_RUN/restore limits; live state chỉ project-state.


## Nghiệm thu P4.4-r1, mở planning P4.5 — 2026-11-14

Khiêm: **“nghiệm thu P4.4-r1 và cho phép mở kế hoạch chi tiết P4.5 để duyệt trước coding.”** P44-01–05 HUMAN_ACCEPTED đủ năm mục local/synthetic; [task/checklist](CHURCH-P4.4.md), [evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.4-human-acceptance-1.json). Chỉ mở khảo sát/kế hoạch chi tiết P4.5 trong chat trước coding; chưa chốt C45/nguồn/quyền/trạng thái/contracts/ASCII hoặc implementation. P4.6 chưa mở. Không chạy lại tests/runtime, giữ9technical artifacts/journals P4.4 và P3.4UNKNOWN/physical/NOT_RUN/restore limits. Không publication/deploy/real data/main DB read/init/restart3443/worktree/delegation. Live state chỉ project-state.


## P4.5 implementation được duyệt — 2026-11-14

Khiêm duyệt P4.5-plan-r1/C45-01–03/ASCII, triển khai trọn P45-01–05 local/synthetic, bàn giao rồi dừng P4.6. Không publication/deploy/real data/main DB read/init/restart3443; giữ prior snapshots/UNKNOWN/NOT_RUN. Chi tiết tại [CHURCH-P4.5](CHURCH-P4.5.md).


## Bàn giao P4.5-r1 — 2026-11-14

P45-01–05/C45-01–03/ASCII hoàn tất nguồn/wiring trước testphase và PASS local/synthetic; [task/năm mục/evidence](CHURCH-P4.5.md), [contracts](../engineering/P4.5-care.md). Chờ Khiêm nghiệm thu P4.5-r1; dừng trước P4.6 Tổng hợp/kiểm chứng, chưa mở. P4.1–P4.4 HUMAN_ACCEPTED; giữ9P44technical artifacts/journals. Không publication/deploy/realdata/main DB read/init/restart3443/worktree/delegation. Giữ P3.4UNKNOWN/physical/NOT_RUN/restore limits; live state chỉ project-state.


## Nghiệm thu P4.5-r1, mở planning P4.6 — 2026-11-14

Khiêm: **“nghiệm thu năm mục P4.5-r1 và cho phép mở kế hoạch chi tiết P4.6 để duyệt trước coding.”** P45-01–05 HUMAN_ACCEPTED đủ5/5 local/synthetic; [task/checklist](CHURCH-P4.5.md), [evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.5-human-acceptance-1.json). Chỉ mở khảo sát/kế hoạch chi tiết P4.6 Tổng hợp/kiểm chứng trong chat để duyệt trước coding; chưa chốt C46/ASCII/contracts hoặc implementation, P4 chưa đóng/P5 chưa mở. Không chạy lại tests/runtime; giữ9technical artifacts/journals P4.5 nguyênSHA256 và source313/dist56 khớp manifest. Giữ P3.4UNKNOWN/physical/NOT_RUN và giới hạn main-maintenance/workload/restore; không publication/deploy/real data/main DB read/init/restart3443/worktree/delegation. Live state chỉ project-state.


## P4.6 implementation được duyệt — 2026-11-14

Khiêm: **“Duyệt P4.6-plan-r1, C46-01–03 và ASCII, cho phép triển khai trọn P46-01–05 local/synthetic, bàn giao rồi dừng trước đóng P4 hoặc mở P5. Chưa commit/push/deploy hoặc dùng dữ liệu thật.”** [Task/contracts/checklist](CHURCH-P4.6.md). Triển khai trọn P46-01–05 local/synthetic rồi bàn giao, dừng trước đóng P4/mở P5; giữ snapshots/UNKNOWN/NOT_RUN và publication/data boundaries.


## Bàn giao P4.6-r1 — 2026-11-14

[Task/năm mục/evidence](CHURCH-P4.6.md). P46-01–05/C46-01–03/ASCII hoàn tất nguồn và PASS local/synthetic; 384tests/5517assertions/0FAIL;144browser tổng hợp+2601regressionchecks=2745;9configs/480distinct terminaljourneys/6877requests/769retryresponses;18list-count+5historyplans=23;restore50collections exact trước transformations;cleanup/readback0. Chờ Khiêm nghiệm thu, dừng trước đóng P4/mở P5; P4.1–P4.5 HUMAN_ACCEPTED. Không publication/deploy/realdata/mainread/init/restart3443/worktree/delegation. Giữ78prior artifacts/journals, P3.4race/P42fastfillUNKNOWN/physical/NOT_RUN và localrestore/workloadlimits; live state chỉ project-state.


## Đóng P4

Khiêm: **“nghiệm thu năm mục P4.6-r1, đóng P4.”** (2026-11-15).

**P4 CLOSED** trong phạm vi local/synthetic đã nghiệm thu:

| Gói | Kết quả được nghiệm thu | Hồ sơ acceptance |
|---|---|---|
| P4.1-r1 | Lịch giảng và sinh hoạt; HUMAN_ACCEPTED đủ5/5 | [Evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.1-human-acceptance-1.json) |
| P4.2-r1 | Chương trình sinh hoạt ban; HUMAN_ACCEPTED đủ5/5 | [Evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.2-human-acceptance-1.json) |
| P4.3-r1 | Hồ sơ thăm viếng; HUMAN_ACCEPTED đủ5/5 | [Evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.3-human-acceptance-1.json) |
| P4.4-r1 | Cầu thay và quyền riêng tư; HUMAN_ACCEPTED đủ5/5 | [Evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.4-human-acceptance-1.json) |
| P4.5-r1 | Cảnh báo và chăm sóc tự động; HUMAN_ACCEPTED đủ5/5 | [Evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.5-human-acceptance-1.json) |
| P4.6-r1 | Tổng hợp và kiểm chứng P4; HUMAN_ACCEPTED đủ5/5 | [Evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.6-human-acceptance-1.json) |

[Closure evaluation](../engineering/skill-usage/records/CHURCH-P4/P4-closure-1.json) liên kết đủ sáu acceptance. [Task P4.6](CHURCH-P4.6.md), [verification snapshot](../../output/p4.6/verification.json). Giữ nguyên technical artifacts và implementation/self-review journals; không chạy lại tests/runtime hoặc tính lại usage implementation.

**P5 NOT_OPENED.** Chưa lập danh mục/kế hoạch chi tiết hoặc coding P5. Chưa commit/push/deploy/real data/main DB read/init/restart3443; closure không là release hoặc quyền maintenance main. Không gửi thông báo sang chat khác khi chưa có chỉ dẫn.

Giữ UNKNOWN P3.4 race và P4.2 fast-fill sau reauth; keyboard PASS không chứng minh fast-fill/paste đã sửa. Giữ P4preview-digest/receipt/recovery cut-line limits, quiesce0inflight (chưa held-request stress), postrestore handler in-process. Physical/native Word/Safari/UAT/main runtime/pilot/remoteCI/production/multi-replica/independent review NOT_RUN; main schemas/index/Policy18 chưa áp. Số đo/restore local không production SLA/capacity/RPO/RTO/PITR. Closure không xóa hoặc nâng mức bằng chứng.
