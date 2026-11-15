# CHURCH-P4.3 — Hồ sơ thăm viếng

**2026-11-14: P4.3-r1 HUMAN_ACCEPTED đủ5/5 local/synthetic; chỉ mở PLANNING_ONLY P4.4.** Các mục bàn giao bên dưới giữ lịch sử trước nghiệm thu.

## Authority — 2026-11-14

Khiêm: **“Duyệt P4.3-plan-r1, C43-01–03 và ASCII, cho phép triển khai trọn P43-01–05 local/synthetic, bàn giao rồi dừng trước P4.4”**

Theo roadmap Church CMS P0–P8/P4. C43-01–03/ASCII đã duyệt; trọn P43-01–05 local/synthetic, hoàn tất production code/wiring trước tests; một bàn giao rồi dừng trước P4.4. P4.1/P4.2 HUMAN_ACCEPTED; không commit/push/deploy/real data/main DB init/restart3443. Giữ technical snapshots/journals P4.2 và mọi NOT_RUN.

## Quyết định C43 đã duyệt

- C43-01: target member(thân hữu/thuộc viên) hoặc family cùng tenant, ID bất biến. Reason vắng nhóm/đau ốm/tân tín hữu/gia đình có tang/khác, mô tả; priority thường/cao; ngày/người phụ trách nullable. Current active/long_absent assignee, không demo fallback, cấp role hoặc sửa visitor.caregiverId/membership. Snapshot giữ lịch sử, current-source warnings; không auto-relink khi merge/move. Một open case cho cùng tenant/targetKind/targetId/reasonCode, unique constraint; member và family khác target.
- C43-02: open→completed/cancelled; labels chờ phân công/chờ thăm/đã có lần thăm suy từ dữ liệu. “Đã thăm” mở entry form, không tự đóng. visitedOn<=ngày HCM hiện tại; trước ngày tạo cần lý do. Participants cùng tenant hợp lệ, kết quả visited/not_met/declined; hoàn tất cần ít nhất1visited và xác nhận. Hủy/correction cần lý do; không DELETE/reopen, correction giữ before/after kể cả hồ sơ đóng. Source/assignee invalid giữ snapshot+cảnh báo, chặn nghiệp vụ mới đến khi xử lý; vẫn đóng/hủy có lý do.
- C43-03: Owner/pastor/secretary manage/read cùng tenant; ministry_lead/treasurer/member deny. Assignee Member không là quyền Account. Hồ sơ là thông tin chăm sóc dùng chung cho các actor được phép; không trường private hay copy prayer private, P4.4 chưa mở. Logs/audit metadata, history bảo vệ như resource.
- ASCII: W08 shared UI, tạo/filter/list/detail/assignment/entry/complete/cancel/history/correction; hai realm, deep links/reauth/pending; W01 shortcut/menu/W13. Prayer unavailable, automation thuộc P4.5, phiếu in/PDF/Word P6, ngoài scope upload/Zalo/email/SMS. UI-STD-r1, light/dark/responsive/keyboard.
- API: hai realm care/cases, entries/history/operations; preview, CSRF,16KiB, quoted If-Match, idempotency, fresh resource/source fences và transaction domain/history/audit/receipt. Backend paging25/max100, tenant/auth trước search/count/paging. Không load toàn bộ Members/history.

## WHAT và năm mục nghiệm thu

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P43-01 | Domain/snapshot/state/current-source/public ports | api/visitation, api/members/visitation.ts, api/families/visitation.ts | Hoàn tất; đã kiểm chứng local/synthetic | — |
| P43-02 | API/quyền/CAS/unique/fences/history/audit/receipt/schema | api/app.ts, api/authorization, api/operations, api/infrastructure/database.ts | Hoàn tất; đã kiểm chứng local/synthetic | — |
| P43-03 | W08/forms/callers/W01/menu/W13 | web/visitation*, web/main.tsx, web/church-app.tsx, web/overview.tsx, web/organization-runtime.tsx | Hoàn tất; đã kiểm chứng local/synthetic | — |
| P43-04 | Tests/browser/regression/self-review | tests/*visitation*, scripts/browser-visitation.ts, output/p4.3 | Hoàn tất; đã kiểm chứng local/synthetic | — |
| P43-05 | Workload/plans/cleanup/runbook/evidence | scripts/p43-qualification.ts, docs/engineering/P4.3-visitation.md, output/p4.3 | Hoàn tất; đã kiểm chứng local/synthetic | — |

- [x] Tạo đúng member/family, snapshot/manual reason và chặn trùng open case.
- [x] Phân công/ngày/priority/source invalid đúng, không ghi ngược Members/Families.
- [x] Entry/complete/cancel/correction có lịch sử; not_met khác visited.
- [x] Hai realm/tenant/revoke/CSRF/CAS/race/rollback/replay/lost response không vượt quyền/tạo trùng.
- [x] UI light/dark/responsive/keyboard/reauth/pending; workload100/500/2000×1/5/10, plans/cleanup có evidence.

Runtime local/synthetic PASS; HUMAN_ACCEPTANCE ACCEPTED theo chỉ dẫn Khiêm ngày2026-11-14, NOT_RELEASED. Năm checkbox phía trên đã được Khiêm nghiệm thu, không suy từ PASS kỹ thuật. Chỉ mở PLANNING_ONLY P4.4; P4.5–P4.6 chưa mở. Physical camera/paper/printer/native Word/main runtime/Safari/UAT/pilot/remoteCI/production/multi-replica và aggregate restore P4.6 giữ NOT_RUN/chưa mở.


## Bàn giao P4.3-r1 — 2026-11-14

P43-01–05/C43-01–03/ASCII hoàn tất nguồn/wiring trước test phase và kiểm chứng local/synthetic; chờ Khiêm nghiệm thu năm mục P4.3-r1. P4.4–P4.6 NOT_OPENED. Không publication/deploy/real data/main DB read/init/restart3443.

328tests/4728assertions;24P43tests trong suite;398W08Firefoxchecks +2217regressionchecks;9configs/480journeys/4953requests/851retries, p95~272–12127ms (max13517ms). Workload gồm list+scoped summary/detail/preview/record/entry page, kể cả retry/backoff khi cạnh tranh;30completions và3cancellations kiểm chứng ngoài latency. Không có SLA latency được duyệt; không suy capacity production từ mẫu này. Sáu query plans cho case/entry pages đều IXSCAN/26docs; không suy aggregate count cũng chỉ26docs. Volume fixtures/placeholder targets tách khỏi public source-linked workflows.

Static/typecheck/lint/UI/build/build:ui/audit/shell syntax/diff PASS;10CSSwarnings có sẵn, bundle577.23kB vượt advisory500kB. W08 hai realm/light/dark1440/901/900/560/390, preview-back, focus/scroll/native keyboard, closed correction, invalid source/assignee, lost real-commit acknowledgement→reauth→receipt không duplicate. Full suite cuối chạy riêng bằng `bun test --timeout 30000 tests`; các lượt trước SPA fix/timeout5s lưu `output/p4.3/attempts`, không gọi là PASS. Focused snapshot24/426 trước hai assertions cuối được giữ nguyên; final suite có đủ24P43tests hiện hành. Regression W13/W01/Programs chạy trước thay đổi cuối chỉ trong W08 copy/filter; finalW08 artifact khớp bundle cuối. Self-review, chưa reviewer độc lập/human acceptance. Một lượt suite trước327PASS/1P3.4raceFAIL không quan sát đúng một412;10lượt diagnostic riêng đúng1commit/version+1/record theo winner, không tái hiện. Chỉ bổ sung status/error code vào message test, không sửa assertion hoặc P3.4 application source; nguyên nhân lượt trước UNKNOWN, giữ log và finding giới hạn, final suite báo riêng theo nguồn hiện hành.

[Verification](../../output/p4.3/verification.json), [source manifest](../../output/p4.3/source-manifest.json), [browser](../../output/p4.3/browser-results.json), [qualification](../../output/p4.3/qualification.json), [readback](../../output/p4.3/readback.json), [P42 preservation](../../output/p4.3/p42-evidence-preservation.json), [contracts/runbook](../engineering/P4.3-visitation.md), [implementation journal](../engineering/skill-usage/records/CHURCH-P4/P4.3-implementation-1.json), [self-review](../engineering/skill-usage/records/CHURCH-P4/P4.3-self-review-1.json). P4.2 technical snapshots/journals giữ nguyên9/9 SHA256. Cleanup DB/private CA/container/listeners sở hữu đã readback, không dọn rộng hoặc chạm DB/runtime chính.

![W08 desktop light](../../output/p4.3/owner-care-detail-1440-light.png)

P4.3-r1 · W08 runtime Firefox/private CA · Đã xác minh local/synthetic · Không proof production/physical/Safari/UAT. [Mobile dark](../../output/p4.3/secretary-care-detail-390-dark.png).

Bức tranh: P4.1 Lịch giảng/sinh hoạt và P4.2 Chương trình ban đã nghiệm thu; P4.3 Hồ sơ thăm viếng chờ nghiệm thu; tiếp theo P4.4 Cầu thay/quyền riêng tư; sau đó P4.5 Cảnh báo/chăm sóc tự động và P4.6 Tổng hợp/kiểm chứng. Đã dừng, chưa mở P4.4.

Bước tiếp theo: (1) Ưu tiên Khiêm nghiệm thu đủ năm mục P4.3-r1 và cho phép mở kế hoạch chi tiết P4.4 để duyệt trước coding; hoặc (2) yêu cầu sửa cụ thể trong P4.3 để kiểm lại phạm vi bị ảnh hưởng. Không lựa chọn nào tự cấp quyền publication/deploy/dữ liệu thật.


## Nghiệm thu P4.3-r1, mở planning P4.4 — 2026-11-14

Khiêm: **“nghiệm thu năm mục P4.3-r1 và cho phép mở kế hoạch chi tiết P4.4 để duyệt trước coding.”** P43-01–05 đã HUMAN_ACCEPTED đủ năm mục local/synthetic; [task/checklist](CHURCH-P4.3.md), [evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.3-human-acceptance-1.json). Chỉ mở khảo sát/kế hoạch chi tiết P4.4 trong chat để duyệt trước coding; chưa chốt C44/quyền/trạng thái/contracts/ASCII hoặc implementation. P4.5–P4.6 chưa mở. Giữ nguyên technical snapshots/journals P4.3 và UNKNOWN P3.4 race/physical/NOT_RUN/workload/restore limits; không chạy lại runtime/tests hoặc publication/deploy/real data/main DB read/init/restart3443. Live state chỉ project-state.
