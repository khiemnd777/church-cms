# CHURCH-P3.3 — Lớp dự bị Báp-têm

## Authority — 2026-11-13

Khiêm: **“duyệt P3.3-plan-r1, gồm C33-01–03, để triển khai trọn P33-01–05 local/synthetic rồi bàn giao nghiệm thu.”** Một gói theo roadmap P3; code/schema/API/UI wiring hoàn chỉnh trước tests. Dừng trước P3.4. Không commit/push/deploy/real data/main DB init/restart3443.

- **C33-01:** ghi danh believer/preparatory active hoặc long_absent, chưa Báp-têm; unknown cần xác nhận kèm lý do. Không ngưỡng tuổi demo hoặc tự conversion/ghi danh.
- **C33-02:** bài bắt buộc do khóa khai báo; credit từ Attendance đã chốt, buổi chính/bù theo bài và không đếm đôi. Không threshold 5/7/12 hoặc tự đủ điều kiện Báp-têm.
- **C33-03:** owner/pastor ghi ngày/người/trạng thái đã phỏng vấn; secretary xem. Không nội dung trả lời hoặc suy đạt/rớt; tên giảng viên không cấp quyền.

P33-01 domain/schema/ports; P33-02 Attendance/Authorization/Operations; P33-03 W06/W14/W05; P33-04 tests/browser/workload/review; P33-05 contracts/runbook/evidence/journal/handoff. Owner/pastor/secretary quản lý khóa/ghi danh/điểm danh; lead/treasurer/member chưa được mở lớp. Khóa Nháp→Đang học→Đã đóng; mở lại có lý do. Snapshot roster đã mở và lịch sử không sửa hồi tố; danh sách bài khóa khi mở buổi đầu. UI giữ sáu tab W06, các tab P3.4 chưa mở, UI-STD-r1/ASCII P3.3-plan-r1.

P3-PHYSICAL-01 camera điện thoại/giấy thật vẫn NOT_RUN; không dùng synthetic đóng note. Trạng thái hiện hành duy nhất tại [project-state](../project-state.md).

## Bàn giao P3.3-r1 — 2026-11-13 (snapshot trước nghiệm thu)

**SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; HUMAN_ACCEPTANCE=PENDING_REVIEW; chưa released.** P33-01–05 hoàn tất theo C33-01–03; dừng trước P3.4. Live status duy nhất tại project-state.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P33-01 | Khóa/ghi danh/bài học/phỏng vấn/schema/index/history | `api/prep-classes`, `api/members/prep-classes.ts` | Hoàn tất local/synthetic | — |
| P33-02 | Source/fences/credit/transaction/receipt giữa modules | Attendance/Members/Authorization/Operations | Hoàn tất local/synthetic | — |
| P33-03 | W06 lớp, W14 link, W05 tay/QR; hai realm | `web/prep-classes*`, `web/member-prep-classes.tsx`, roots/shared kit | Hoàn tất local/synthetic | — |
| P33-04 | Integration/browser/workload và review | Tests/scripts, `output/p3.3` | PASS local/synthetic | Full200lesson capacity chưa đo; không suy production/SLA |
| P33-05 | Contracts/runbook/receipts/journal/state/handoff | [Contracts](../engineering/P3.3-prep-classes.md), [journal head](../engineering/skill-usage/records/CHURCH-P3/P3.3-implementation-correction-1.json) | Hoàn tất; chờ Khiêm nghiệm thu | — |
| P3-PHYSICAL-01 | Camera điện thoại/giấy thật | [Note](CHURCH-P3.md#p3-physical-verification-note) | NOT_RUN | Cần bằng chứng thực tế và Khiêm xác nhận; ngoài proof local/synthetic |

### Bằng chứng kỹ thuật

- **221 PASS / 0 FAIL / 3166 assertions / 16 files** qua `bun test tests`;13testsP33. Real Mongo/Redis: eligibility/unknown confirmation/không age demo, schema/CAS/preview source changes, late enroll/withdrawal snapshots, multiple makeup credits dedup/original absence, role/tenant/cursor/receipt ACL, class QR kernel, true unknown-commit ack/replay, rollback meeting+Attendance/history, in-flight revoke, roster2000/cap2001 và metadata200lessons/192KiB body. Historical interview cho enrollment đã ngừng hoặc trước khai giảng được ghi đúng sự kiện, không tự khôi phục ghi danh.
- **2773 Firefox checks PASS:**736P33+785Attendance+419QR+541Members+173Accounts+119navigation. Private CA/container; light/dark1440/901/900/560/390, W06source style parity matched1440/390, sáu tab/scroll giữ nguyên, keyboard table-focus/scroll/action/escape, W14→W06→W05, mất phản hồi/explicit replay, reauth course context cả owner/church, secretary không có control ghi interview. Đã xem ảnh desktop light/mobile dark. Toolbar/table gap **18px ở60mẫu**. P33 trên bundle cuối; unaffected regressions tái dùng từ trước sửa layout/interview-state chỉ trong P33; từng results giữ bundle hash riêng.
- **9configs / 540 measured completed +90warmup**, HTTPS100/500/2000×1/5/10;1237HTTPattempts gồm157contention409, bounded original-intent retry. Đo mark Attendance + read progress, p95 **25.59–284.51ms** local. Counter/history/credits sau chốt và makeup khớp, class-progress index selected. Qualification dùng direct enrollment fixtures để setup; API/UI enrollment verified riêng. Workload3bài, không full200lesson capacity hoặc production SLA/multi-replica.
- Typecheck/lint/build/build:ui/UI-STD-r1/audit/bash syntax/diff check PASS. Lint giữ10warningsCSSnguồn. Không dependencies mới; audit no vulnerabilities found không là chứng nhận an toàn.
- [Receipt](../../output/p3.3/verification.json), [source manifest](../../output/p3.3/source-manifest.json), [browser](../../output/p3.3/browser-results.json), [workload](../../output/p3.3/qualification.json), [cleanup readback](../../output/p3.3/cleanup-readback.json). Xác nhận0DBsynthetic/CAp33dirs/container còn lại. Không ghi đè P3.1/P3.2 technical receipts/journal.
- NOT_RUN: physical camera/paper/Safari/UAT/production/real data/multi-replica/remoteCI/full200lessoncapacity/main DB init/restart3443. Chưa commit/push/deploy. Human acceptance không tự có từ các PASS này.

### Self-review và giới hạn

Đã rà ownership/read ports/no cross-module writes, exact actor/tenant/action fences trước replay/receipt, class-source injection, CAS/preview/generation, state/credit/no-op/rollback/unknown outcomes, payload/query bounds, dates và UI/source/callers. Self-review, không reviewer độc lập; không còn finding chặn trong scope đã duyệt.

Sửa trong verification: SPA/auth route allowlists và active-menu cho rites cả realm; W05 label/scope lớp; wrapper layout18px toolbar/table; test scroll tabs theo nguồn thay vì coi các nhãn disabled nằm trong vùng cuộn là page overflow; cập nhật navigation expectation cho mục Sổ lễ nghi mới. Replay status200 giữ contract Operations hiện hữu, không giảm assertions count/history. Rà C33-03 bỏ hai guards không có trong plan (phỏng vấn trước startOn hoặc enrollment withdrawn), giữ permission/CAS/reason/history/date≤today/course-closed rules; thêm regression API/UI và rerun suite/browser cuối.

Journal event implementation1 giữ nguyên; [correction1](../engineering/skill-usage/records/CHURCH-P3/P3.3-implementation-correction-1.json) là head của cùng logical phase, không thêm skill usage. [Snapshot trước sửa cuối](../../output/p3.3/pre-final-review/verification.json) giữ chronology, không dùng thay receipt cuối.

### Checklist nghiệm thu cho Khiêm — đã chấp nhận theo chỉ dẫn 2026-11-13

- [x] Tạo/bắt đầu/đóng/mở lại khóa; ghi danh đúng eligibility, unknown cần xác nhận/lý do; không age threshold demo hoặc auto conversion/enroll.
- [x] W06/W14/W05 liên kết đúng khóa/người/buổi; roster đúng ghi danh, buổi đã mở giữ snapshot, curriculum không đổi hồi tố.
- [x] Chốt buổi mới tăng số bài; học bù không đếm đôi và không xóa vắng gốc; bài tương lai/thiếu ghi nhận không thành vắng giả.
- [x] Owner/pastor ghi sự kiện phỏng vấn, secretary chỉ xem; bổ sung lịch sử không tự khôi phục ghi danh, không pass/fail/hoàn thành/Báp-têm tự động.
- [x] Unknown outcome/reauth giữ intent, đối soát chủ động; chấp nhận giới hạn local/synthetic và physical NOT_RUN.

**Điểm dừng tại bàn giao:** chờ Khiêm nghiệm thu P3.3-r1; P3.4 chưa mở tại thời điểm đó. Chỉ dẫn mới phía dưới thay điểm dừng này ở phạm vi planning.


## Nghiệm thu P3.3-r1 và mở planning P3.4 — 2026-11-13

Khiêm: **“Nghiệm thu P3.3-r1 theo checklist; đồng ý mở planning P3.4 để duyệt trước coding.”** P33-01–05/C33-01–03 **HUMAN_ACCEPTANCE=ACCEPTED local/synthetic**, gồm năm mục checklist phía trên. [Evaluation](../engineering/skill-usage/records/CHURCH-P3/P3.3-human-acceptance-1.json) liên kết corrected head của implementation; original/correction/technical receipt/source manifest giữ nguyên. Không chạy lại tests hoặc coi nghiệm thu là bằng chứng mới cho runtime/production/full200lessoncapacity.

P3.4 Sổ lễ nghi chỉ mở **PLANNING_ONLY**, kế hoạch và ASCII mockup trình trong chat để duyệt trước coding; P3.5/P3.6 chưa mở. Không commit/push/deploy/real data/main DB init/restart3443. Camera điện thoại thật/bản in giấy thật vẫn **NOT_RUN** theo [note](CHURCH-P3.md#p3-physical-verification-note). Trạng thái hiện hành duy nhất tại project-state.
