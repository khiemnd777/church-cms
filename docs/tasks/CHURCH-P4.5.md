# CHURCH-P4.5 — Cảnh báo/chăm sóc tự động

## Authority — 2026-11-14

Khiêm: **“duyệt P4.5-plan-r1, C45-01–03 và ASCII, cho phép triển khai trọn P45-01–05 local/synthetic, bàn giao rồi dừng trước P4.6”**.

C45-01: vắng3 đúng3calendarCN selected+closed/included+absent; tân tín hữu theo visitor.stage=believed/believedOn known trong30calendarngày kể cả type đã chuyển, hoặc nguồn Care nhập tay đã xác nhận ngày tin Chúa; không convertedOn/baptism/createdAt. Illness(member)/bereavement(family) nguồn Care nhập tay, còn mở đến end. Date không bịa/future, target current active/long_absent/familyactive; snapshot reduced; không đọc Prayers. Signal khóa target/kind; correct/end reason/history, không reverse domain writes.

C45-02: pending→linked/dismissed/expired. Một active episode/tenant/target/reason; update/week/version không sinh episode mới. Linked/dismissed còn suppressed đến khi nguồn knownfalse rồi phát sinh lại. Unknown/missing không làfalse hoặc0. Preview/confirmation create hoặc link existingopen case; assignee chọn tường minh/chưa phân công, không override existingcase hoặc tự ghi visited/complete.

C45-03: owner tenant/pastor/secretary, deny lead/treasurer/member; assignment không role. Public Members/Families/Attendance/Visitation ports; CAS/source/fresh auth, create/link+alert/history/audit/ledger atomic. Refresh theo yêu cầu ≤100/lô, keyset/context/progress thật, không global snapshot xuyênlô; lỗi không xóa kết quả prior batch/không giả0. W01 GET chỉ read cached assessment/asOf, giữ absent3drilldown; W13 policy mở scope. Strict payload/CSRF/If-Match/preview/idempotency/fresh receipts. Không Prayer inputs/background jobs/external messages.

ASCII: W08 anchors3, card Đề nghị chăm sóc trước Visitation/Prayers; filters/list/detail/source status/preview create-or-link/manual signal/history; một dialog/pending tại một thời điểm, paths/query keys domain riêng, UI-STD-r1/hai realm/light-dark/responsive/keyboard.

## WHAT — P4.5-r1

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P45-01 | Nguồn/signals/episodes/schema | api/care, public Members/Families ports | Hoàn tất nguồn; PASS local/synthetic | — |
| P45-02 | API/quyền/atomic create-link/audit/ledger | Care/Visitation/Operations/app | Hoàn tất nguồn; PASS local/synthetic | — |
| P45-03 | W08/W01/W13/pending/URL/reauth | web/care*, shared callers | Hoàn tất nguồn; PASS local/synthetic | — |
| P45-04 | Tests/browser/regression/self-review | tests/scripts/output/p4.5 | PASS local/synthetic; self-review | — |
| P45-05 | Workload/plans/cleanup/docs/handoff | scripts/p45-qualification.ts/runbook/evidence | PASS local/synthetic | — |

## Năm mục đã được Khiêm nghiệm thu

- [x] Bốn nguồn đúng, unknown/error khác false/0, Prayer không ảnh hưởng đề nghị.
- [x] Chống trùng đợt/opencase; bỏ qua/source-end/recurrence đúng.
- [x] Create/link/assignment preview+confirm+history; không tự visited/completed.
- [x] Role/tenant/revoke/race/rollback/replay/lostACK an toàn/không trùng.
- [x] UI hai realm/light-dark/responsive/keyboard và9configs/480journeys/plans/cleanup có evidence.

SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED / HUMAN_ACCEPTED đủ5/5; NOT_RELEASED. P4.1–P4.5 HUMAN_ACCEPTED; P4.6 Tổng hợp/kiểm chứng chỉ PLANNING_ONLY trong chat để duyệt trước coding. Chưa duyệt C46/ASCII/contracts hoặc implementation; P4 chưa đóng, P5 chưa mở. Hoàn tất production code/wiring trước test phase; sau đó sửa defects có evidence trong gói, không artificial intermediate handoff.

## Bằng chứng cuối

- Full suite `bun test --timeout 30000 tests`: **380PASS/0FAIL/5437assertions**, chạy riêng sau workload/browser. Focused26tests/304assertions PASS;26P45tests gồm2strictvalidation+24integration. Source change after scan preview/current evidence/history, canonical mixedcase signalID replay, codeunique và episodeunique có assertions riêng.
- `bun run test:browser:p4.5`: **702checksPASS**, source hash/table styles parity và light/dark1440/901/900/560/390, native keyboard table scroll/focus/dialog/source preview-back/create/correct/end/existinglink giữcase/knownfaithdate/sourcecoverage/partialcomplete/W01. Secretary realcommit ACKloss→sameactor reauth→receipt không duplicate, explicit assignee/noauto visited. Pastor secondrealcommit ACKloss→downgrade→403 xóa Care hiddenDOM/form/query/pending và sibling Prayer marker khỏi W08.
- Regression P44=707, P43=398, W13=1407, W01=484, tổng**2996PASS**. Output riêng P45, không ghi technical snapshots gói trước. FinalP45/P44/W01 bundle matches dist; P43/W13 runs trước Care-only sourcepreview/auth-flow fixes, paths được review không đổi; full suite dùng final source.
- `bun run qualify:p4.5`: **9configs/480terminaljourneys/3210requests/270retries**, **255creates/63links/162dismissals**. Mỗi config đủ3roles trên3accounts/tenant;10workers chia sẻaccounts. p95~56.81–2135.66ms/max4628.57ms, gồm bounded retry/backoff.100/500/2000source profiles + base expired-volume clones +160distinct public source-linked work items/size. Publicsource setup/fullpagedscan ngoài measuredlatency, không gọi lại cùng terminalalert để giả nhiềujourneys.
- 12plans: alertpending/all pages26returned/26examined, history≤26, pendingcount indexaggregate không bound26 hoặc mọifilter/search. Không hint/SLA/capacity/RPO/RTO.
- Typecheck/lint/UI/build/build:ui/audit/diff/shell **PASS**;10existingCSSwarnings,615.15kB bundle vượt advisory500kB. Dependencies/sourceHTML/tokens/base/patterns không đổi.
- Readback **PASS**:0ownedP45DB/private dirs/listeners3487/3488/3489/verificationcontainers; regressionprefixDB0; giữsharedMongo/Redis.9P44technical artifacts/journals nguyênSHA256. Không mainread/init/probe3443/restart3443.

[Verification](../../output/p4.5/verification.json) · [source manifest](../../output/p4.5/source-manifest.json) · [browser](../../output/p4.5/browser-results.json) · [workload/plans](../../output/p4.5/qualification.json) · [readback](../../output/p4.5/readback.json) · [handoff readback](../../output/p4.5/handoff-readback.json) · [P44 preservation](../../output/p4.5/p44-evidence-preservation.json) · [attempts](../../output/p4.5/attempts/README.md).

[Contracts/runbook](../engineering/P4.5-care.md) · [implementation journal](../engineering/skill-usage/records/CHURCH-P4/P4.5-implementation-1.json) · [self-review](../engineering/skill-usage/records/CHURCH-P4/P4.5-self-review-1.json). Six implementation skills sum100%; measured phase counters null có lý do thiếu bộ đếm. Self-review không là independent review/human acceptance.

## Giới hạn / điểm dừng

Không commit/push/deploy/realdata/main DB read/init/restart3443/worktree/delegation. Main Care schemas/indexes/Policy18 chưa áp; cần maintenance authority/data/index/writer review riêng. Refresh theo yêu cầu theo lô, không global snapshot/job nền; cached W01/list có asOf/partial status, convert rechecks current source. Không Prayer input/automatic assignee/external send/automatic visited. Pending/query RAM-only, idle reauth có receipt recovery; hard permission/session/context loss clears owned pending/W08, không hủy case đã commit. Phải người có quyền đối soát trước intent mới.

P3.4 prior race cause UNKNOWN giữ nguyên, current suite không xóa finding cũ. Physical/native Word/Safari/UAT/main runtime/pilot/remoteCI/production/multi-replica/independent review NOT_RUN; aggregate restore thuộc P4.6 chưa mở. Workload không production SLA/capacity/RPO/RTO. Technical PASS chưa thay human acceptance/release; dừng trước P4.6.


## Nghiệm thu P4.5-r1, mở planning P4.6 — 2026-11-14

Khiêm: **“nghiệm thu năm mục P4.5-r1 và cho phép mở kế hoạch chi tiết P4.6 để duyệt trước coding.”** P45-01–05 HUMAN_ACCEPTED đủ5/5 local/synthetic; [evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.5-human-acceptance-1.json). Giữ nguyên snapshot380tests/5437assertions,702browser+2996regressionchecks;9configs/480journeys/3210requests/270retries;12plans/cleanup0. Không chạy lại tests/runtime ở lượt nghiệm thu;9technical artifacts/implementation/self-review journals P4.5 nguyênSHA256, source313/dist56 khớp manifest bàn giao. Các trạng thái pending/chưa mở trong bằng chứng và điểm dừng bàn giao phía trên là lịch sử; acceptance này bổ sung, không rewrite technical snapshot.

Chỉ mở khảo sát/kế hoạch chi tiết P4.6 trong chat trước coding; chưa chốt C46/workflow/recovery/workload/ASCII hoặc implementation. Không đóng P4/mở P5. Giữ P3.4 prior race UNKNOWN, physical/NOT_RUN, main-maintenance và publication/data boundaries; aggregate restore chưa chạy. Live state duy nhất ở project-state.
