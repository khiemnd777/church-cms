# CHURCH-P4.1 — Lịch giảng và sinh hoạt

**P4.1-r1 HUMAN_ACCEPTED đủ5/5mục local/synthetic; chưa released.** [Evaluation nghiệm thu](../engineering/skill-usage/records/CHURCH-P4/P4.1-human-acceptance-1.json). Các phần bàn giao dưới đây giữ snapshot trước acceptance; quyền hiện hành chỉ tại [project-state](../project-state.md).

## Authority — 2026-11-13

Khiêm: **“Duyệt P4.1-plan-r1, C41-01–03 và ASCII. Triển khai trọn P41-01–05 local/synthetic rồi bàn giao, dừng trước P4.2. Chưa commit/push/deploy hoặc dùng dữ liệu thật.”**

Theo roadmap [P4-plan-r1](CHURCH-P4.md), bàn giao một gói P41-01–05 sau production code/wiring → tests/checks/review/qualification. Chưa mở P4.2, không main DB init/restart3443/publication/deploy/real data. Live state duy nhất tại [project-state](../project-state.md).

## Thiết kế đã duyệt

- C41-01: Scheduling sở hữu chuỗi/lần diễn ra/history; đọc public Members/Organization ports. Fixed Asia/Ho_Chi_Minh, bắt đầu/kết thúc tối đa24h, overnight; speaker member/external/null, leader/choir/null; snapshots. draft→scheduled→cancelled, không xóa hoặc tự ghi Attendance/Rites. Owner/pastor/secretary quản lý; lead chỉ đọc scheduled own active unit, không lịch nháp/history/picker; treasurer/member deny. scheduleText giữ mô tả riêng.
- C41-02: once; weekly interval1–4/weekdays; monthly weekday/ordinals1–5. End required, ≤365days/≤200occurrences, fail không truncate. Preview one/future, không viết lại started instances; exceptions cần explicit confirmation. Past metadata correction cần reason và giữ dates/times/scope/unit/state. Không scheduler hoặc auto-extend.
- C41-03: member/choir same-tenant overlap advisory; confirm+reason; guests/free-text place không đủ identity để bảo đảm không trùng. CAS/idempotency, preview/fresh source+auth fences, tenant calendar revision ngăn write skew, history/audit/receipt atomic. Unknown response đối soát cùng intent, không tự gửi mới.
- ASCII đã duyệt: W07 six Sundays/weekly; shared layout/icon+menu label; form scope/time/assignments/recurrence/reason; preview cancel/create/exceptions/conflicts và explicit confirmation. P4.2 program card chưa mở. Hai realm/deep link/refresh/reauth/date filters.

## WHAT và checklist

| Hạng mục | Kết quả | Trạng thái |
|---|---|---|
| P41-01 | Domain/schemas/recurrence/snapshots/history/public ports | Hoàn tất nguồn / PASS local-synthetic |
| P41-02 | Hai realm/API/quyền/CAS/preview/ledger | Hoàn tất nguồn / PASS local-synthetic |
| P41-03 | W07/forms/routes/menu/reconciliation | Hoàn tất nguồn / PASS local-synthetic |
| P41-04 | Unit/integration/security/concurrency/browser/regression/self-review | PASS local/synthetic |
| P41-05 | Workload/index/cleanup/runbook/evidence/handoff | PASS local/synthetic |

- [x] Lịch một lần/lặp đúng ngày giờ, sáu CN/lịch tuần, nhiều buổi cùng ngày.
- [x] Sửa one/future/cancel đúng phạm vi, bảo toàn lịch đã qua và lịch sử, explicit exception confirmation.
- [x] Conflicts/stale preview/concurrency/replay/unknown commit đúng kết quả.
- [x] Hai realm/tenant/assigned scope/revoke và picker/history/operation không lộ ngoài quyền.
- [x] UI light/dark/responsive/keyboard; đủ checks/tải/cleanup, không ghi ngược Attendance/Rites.

## Bằng chứng

**P4.1-r1 SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; HUMAN_ACCEPTANCE=PENDING_REVIEW; chưa released.** [Receipt](../../output/p4.1/verification.json), [source manifest](../../output/p4.1/source-manifest.json), [journal](../engineering/skill-usage/records/CHURCH-P4/P4.1-implementation-1.json), [self-review](../engineering/skill-usage/records/CHURCH-P4/P4.1-self-review-1.json). Contracts/runbook tại [P4.1-scheduling](../engineering/P4.1-scheduling.md). Checklist phía trên được tick theo chỉ dẫn nghiệm thu trực tiếp của Khiêm, không suy từ technical PASS; receipt và implementation journal gốc giữ trạng thái lịch sử.

## Bàn giao P4.1-r1 — 2026-11-14

- PASS283tests/4059assertions; focused20tests/297assertions. Calendar/time/weekly/monthly/leap/caps/strict inputs; two realm/tenant/scope/revoke; history/audit/ledger rollback, race/CAS/stale preview, actual committed acknowledgement loss + exact replay, past retention và cancelled one-off exception supersession.
- PASS466Firefoxchecks P41 +1909regression (W13/organization1407, P3 reporting329, accounts173). W07 source header/badge parity4matched samples, populated/create/edit/history/preview/assignment/weekly/exception/conflict/read-only lead, keyboard/focus and scroll-to-last-column,1440/901/900/560/390 ×light/dark. W01→W07 và refresh/deep link/reauth/lost-response reconciliation thực chạy. [Browser evidence](../../output/p4.1/browser-results.json), [ảnh desktop](../../output/p4.1/owner-w07-1440-light.png), [mobile](../../output/p4.1/owner-w07-390-light.png).
- PASS9workloadconfigs/480measuredjourneys/2898HTTPrequests;326contention409/412 retries có đọc/preview mới. p95 journey35.13–1149.89ms local.3explain plans dùng schedule_page,≤26docs examined. Volume fixtures tách public-command workflow; không SLA/full200-assignment saturation. [Qualification](../../output/p4.1/qualification.json).
- Typecheck/lint/UIguard/product+reference builds/audit/diff/shellsyntax PASS.10warnings CSS nguồn giữ nguyên; bundle539.21kB cảnh báo>500kB. Self-review, không reviewer độc lập. Đã sửa input date400 thay vì503, nhãn preview tạo chuỗi, và bắt buộc xác nhận cả ngoại lệ hủy riêng trước tái tạo; tests giữ assertions và thêm regression.
- [Readback](../../output/p4.1/readback.json):0P41DB/owned private dirs/verification containers/listener3475. Không init main DB/restart3443. Chưa commit/push/deploy/real data. P3-PHYSICAL-01/native Word/main runtime/Safari/UAT/pilot/remoteCI/production/multi-replica NOT_RUN giữ nguyên; backup/restore P4 tổng hợp thuộc P4.6 chưa mở.

**Điểm dừng:** chờ Khiêm nghiệm thu P4.1-r1 theo5mục; P4.2–P4.6 chưa mở. Technical PASS không tự nghiệm thu hoặc cấp quyền mở gói sau.


## Nghiệm thu P4.1-r1 và mở planning P4.2 — 2026-11-14

Khiêm: **“Nghiệm thu P4.1-r1 theo năm mục trong checklist. Mở kế hoạch chi tiết P4.2 để duyệt trước coding.”**

P41-01–05/P4.1-r1 **HUMAN_ACCEPTED đủ5/5mục local/synthetic**; [evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.1-human-acceptance-1.json). Giữ nguyên technical receipt/source manifest/browser/qualification/readback và implementation/self-review journals. Không chạy lại tests/runtime để ghi nhận acceptance; các số liệu trước đó là snapshot bàn giao.

P4.2 — Chương trình sinh hoạt ban chỉ mở **PLANNING_ONLY**, trình contracts/quyền/ASCII/acceptance trong chat để duyệt trước coding. Không lưu draft P4.2 như thiết kế đã chốt; chưa tạo implementation/contracts P4.2. P4.3–P4.6 chưa mở. Chưa commit/push/deploy/real data/main DB init/restart3443. P3-PHYSICAL-01/native Word/main runtime/Safari/UAT/pilot/remoteCI/production/multi-replica và giới hạn workload/restore giữ nguyên.
