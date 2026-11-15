# CHURCH-P4.2 — Chương trình sinh hoạt ban

## Authority — 2026-11-14

Khiêm: **“Duyệt P4.2-plan-r1, C42-01–03 và ASCII. Triển khai trọn P42-01–05 local/synthetic rồi bàn giao, dừng trước P4.3. Chưa commit/push/deploy hoặc dùng dữ liệu thật.”**

Theo [roadmap P4](CHURCH-P4.md). Trọn P42-01–05 local/synthetic: production code/wiring trước tests; một bàn giao rồi dừng trước P4.3. Không commit/push/deploy/real data/main DB init/restart3443. P4.1 HUMAN_ACCEPTED đủ5/5; giữ historical receipts/journals.

## C42-01–03 và ASCII đã duyệt

- C42-01: Một chương trình cho một buổi P4.1 thuộc đúng ban tuổi/phục vụ/Chấp sự, không area. Bảy tiết mục HTML nguồn. Current roster active/long_absent, không age>=16/demo fallback/guest assignment. Board theo confirmed term phù hợp ngày; source unavailable khác empty. Deterministic bounded suggestions, selected IDs và paging backend; scripture/theme đúng occurrence.
- C42-02:1–50rows/16KiBbody. Stable row IDs/template keys, field baseline bảo vệ manual edits/order/custom rows/deletions khi regenerate. Chưa phân công/Không áp dụng/member tách biệt; invalid old assignment giữ trong draft+cảnh báo và không finalize trước sửa. Owner/pastor/secretary all; ministry_lead manage/read/finalize/print own active assigned age/service unit; treasury/member deny. Separate program capabilities, không nâng schedule manage hoặc cấp role từ phân công.
- C42-03: draft→preview→immutable edition r1; amend from latest head→r2, giữ editions/history. Finalize missing assignment cần confirm. Create/regenerate/finalize chỉ scheduled matching unit chưa started. Calendar changed/cancelled/moved không auto relink hoặc overwrite; archived print có cảnh báo phù hợp, fresh auth/source fences/CAS/idempotency/history/audit/receipt atomic. A4 authenticated browser HTML, draft watermark, edition revision; không Word/PDF exports/ngoài scope.
- ASCII: thay unavailable card W07, giữ six Sundays/weekly. Ban/buổi/edition selectors, editable title/assignee/detail/reorder/remove/add, create/regenerate/save/preview/finalize/print/history. Hai realm/deep link/reauth/pending reconciliation; shared UI-STD-r1.

## WHAT / checklist nghiệm thu

| Hạng mục | Kết quả | Trạng thái |
|---|---|---|
| P42-01 | Domain/template/regen/editions/history/public source ports | Hoàn tất nguồn / PASS local-synthetic |
| P42-02 | API/permissions/fences/CAS/ledger/schema | Hoàn tất nguồn / PASS local-synthetic |
| P42-03 | W07/editor/preview/print/callers | Hoàn tất nguồn / PASS local-synthetic |
| P42-04 | Tests/browser/regression/self-review | PASS local-synthetic |
| P42-05 | Qualification/A4/render/cleanup/runbook/evidence | PASS local-synthetic |

- [x] Nháp đúng ban/buổi, bảy tiết mục, nguồn unknown khác empty.
- [x] Chỉnh/sinh lại giữ manual fields/order/custom/removal, không ghi ngược roster/lịch.
- [x] Immutable editions, source drift/cancel/race/replay/lost response đúng kết quả.
- [x] Hai realm/tenant/assigned scope/revoke bảo vệ draft/history/print/receipt.
- [x] UI light/dark/responsive/keyboard/A4/workload/index/cleanup có evidence.

P4.2-r1 SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; chờ Khiêm nghiệm thu năm mục trên, chưa released. P3-PHYSICAL-01/native Word/main runtime/Safari/UAT/pilot/remoteCI/production/multi-replica NOT_RUN giữ nguyên. Browser/PDF verification không thay paper/printer thật. Live state chỉ project-state.


## Bàn giao P4.2-r1 — 2026-11-14

**Kiểu bàn giao: Theo roadmap Church CMS P0–P8/P4.** Một gói trọn P42-01–05. P4.1 đã HUMAN_ACCEPTED; P4.2 chờ nghiệm thu; tiếp theo P4.3 — Hồ sơ thăm viếng; sau đó P4.4 — Cầu thay/quyền riêng tư, P4.5 — Cảnh báo/chăm sóc tự động, P4.6 — Tổng hợp/kiểm chứng. Không mở gói kế tiếp trong lượt này.

| Tên | Mục đích | Vị trí | Kết quả kỹ thuật | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P42-01 | Template/field baselines/merge/draft/immutable editions và nguồn | api/programs; api/members/programs.ts; api/organization/programs.ts; Scheduling public port | Hoàn tất / PASS local-synthetic | — |
| P42-02 | API/quyền/tenant/fences/CAS/ledger/history/audit/schema/index | api/app.ts; authorization; programs/service.ts, schema.ts | Hoàn tất / PASS local-synthetic | — |
| P42-03 | W07/editor/selectors/preview/history/reauth/print A4 | web/programs*; web/scheduling.tsx; api/programs/printing.ts; shared print adapters | Hoàn tất / PASS local-synthetic | — |
| P42-04 | Unit/HTTP/Mongo/Redis/browser/regression/self-review | tests/program-generation.test.ts; tests/integration/programs.test.ts; scripts/browser-programs.ts | Hoàn tất / PASS local-synthetic | Independent review NOT_RUN; self-review trong scope |
| P42-05 | Workload/index/A4/render/cleanup/runbook/receipts | scripts/p42-qualification.ts; P4.2-programs.md; output/p4.2 | Hoàn tất / PASS local-synthetic | Paper/printer thật NOT_RUN; P4 aggregate restore thuộc P4.6 chưa mở |

### Bằng chứng và giới hạn

- `bun run test`:304PASS/0FAIL/4299assertions. Bộ focused cuối21PASS/0FAIL/241assertions, gồm delta cảnh báo print cuối sau full suite; không gán lại counter full suite.
- Browser P4.2:326checks PASS, Firefox/Chromium private CA;10samples light/dark×1440/901/900/560/390 cho mỗi trạng thái. Editor/preview/final/lead, field geometry/scroll/keyboard/focus, exact r1 ngoài25editions, immutable r1→r2, real committed response loss→pending→reauth→receipt, archived print sau cancel. [Results](../../output/p4.2/browser-results.json).
- Regression W07/P4.1:466checks; W13/P2.4:1407checks; tổng1873. Chạy trước exact-edition/print-only fixes; latest P4.2 HTTP/browser/PDF recheck các path thay đổi. Bằng chứng regression tại output/p4.2, P4.1 historical artifacts được bảo toàn byte-identical; không đổi receipts/journals P4.1.
- Workload9configs:100/500/2000roster+program fixtures ×1/5/10workers,480measured journeys,3057HTTPattempts,379retries409; p95journey54.4–3125.2ms, không là SLA/capacity production.30finalize/edition-print bổ sung ngoài latency samples. Program unit-page dùng index và đọc26docs trong cả3sizes. Lượt đầu hết10attempts được lưu lịch sử; lượt cuối capped20attempts + exponential jitter. UI không tự xác nhận proposal mới. [Qualification](../../output/p4.2/qualification.json).
- A4 Chromium:7rows/1page;50rows/3pages. PDFium/Poppler render review và geometry/text checks: đủ1–50, thead mỗi trang, không STT overlap, nội dung trong page margins. [Print receipt](../../output/p4.2/print-verification.json), [r1 PDF](../../output/p4.2/program-final-r1-a4.pdf), [50rows PDF](../../output/p4.2/program-draft-50-a4.pdf). Đây là bằng chứng, không có product PDF export hoặc paper verification.
- typecheck/lint/ui:check/build/build:ui/audit/diff-check/shell-syntax PASS.10warnings CSS nguồn có sẵn; bundle556.21KB/gzip157.33KB vượt advisory500KB. Không giảm gates/nâng dependency/đổi source style để xóa cảnh báo.
- Source review sửa deep-link edition ngoài trang đầu, valid speaker ngoài50candidates và cảnh báo source/roster drift; print table flow/fixed columns được kiểm tra lại trên50dòng. Self-review, không giả là reviewer độc lập.
- Cleanup:0database synthetic P4.2 còn lại;3476/3477/3478 không còn listener; CA qualification đã xóa, private browser container đã dọn. Không đọc/init main DB, không restart3443. [Readback](../../output/p4.2/readback.json).

[Contracts/runbook](../engineering/P4.2-programs.md), [verification](../../output/p4.2/verification.json), [source manifest/reuse boundary](../../output/p4.2/source-manifest.json), [implementation journal](../engineering/skill-usage/records/CHURCH-P4/P4.2-implementation-1.json), [self-review evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.2-self-review-1.json).

![P4.2-r1 — bản chốt A4 synthetic; đã kiểm chứng render, chưa paper](../../output/p4.2/program-final-r1-a4-page-1.png)

### Quyết định của Khiêm và điểm dừng

Năm checkbox là **human acceptance**, vẫn chưa đánh dấu thay Khiêm. Technical PASS không phải nghiệm thu hoặc release. Không commit/push/deploy/real data; P4.3–P4.6 NOT_OPENED. P3-PHYSICAL-01, camera/paper/printer, Safari/native Word/main runtime/UAT/pilot/remoteCI/production/multi-replica NOT_RUN; aggregate restore chưa mở. Pending intent chỉ memory, browser reload không phục hồi bền vững.

Bước tiếp theo: (1) Khiêm nghiệm thu P4.2-r1 theo năm mục và cho phép mở kế hoạch P4.3; hoặc (2) chỉ rõ mục cần sửa trong gói P4.2. Không tự suy quyền coding P4.3 từ nghiệm thu P4.2.


## Nghiệm thu P4.2-r1 và mở planning P4.3 — 2026-11-14

Khiêm: **“Nghiệm thu P4.2-r1 theo năm mục; đồng ý, cho phép mở kế hoạch chi tiết P4.3 để duyệt trước coding.”**

Năm mục checklist P42-01–05 đã **HUMAN_ACCEPTED đủ5/5 local/synthetic**. [Evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.2-human-acceptance-1.json) bổ sung cho bản bàn giao; technical receipts/source manifest/implementation/self-review journals giữ nguyên, gồm trạng thái PENDING_REVIEW tại thời điểm bàn giao. Những đoạn chờ nghiệm thu ở trên là lịch sử.

Chỉ mở **PLANNING_ONLY P4.3 — Hồ sơ thăm viếng** trong chat để duyệt trước coding. Chưa chốt C43/contracts/quyền/ASCII; chưa tạo code/schema/tests/runtime hoặc tài liệu thiết kế chi tiết P4.3. P4.4–P4.6 chưa mở. Chưa commit/push/deploy/real data/main DB init/restart3443; physical/NOT_RUN, số đo/giới hạn local và aggregate restore P4.6 giữ nguyên. Không chạy lại kiểm chứng để ghi nhận nghiệm thu. Live state chỉ project-state.
