# CHURCH-P5.2 — Thu và dâng hiến

## Authority — 2026-11-17

Khiêm: **“Duyệt P5.2-plan-r1, C52-01–03 và ASCII. Cho phép triển khai trọn P52-01–05 local/synthetic, bàn giao rồi dừng trước P5.3. Giữ ngoại lệ E51-01 đã bỏ qua.”** Theo roadmap P5; một handoff P52-01–05, code/wiring toàn gói trước tests. Không P5.3/publication/commit/push/deploy/realdata/mainDBread/init/restart3443/worktree/delegation; E51-01 USER_WAIVED, không mở lại troubleshoot.

## Contracts đã duyệt — P5.2-plan-r1 / C52-01–03

C52-01: pastor/treasurer đọc sổ/phiếu/dâng hiến cá nhân; chỉ treasurer cấp/ngừng/khôi phục mã và lập/hủy phiếu; pastor giữ quyền quỹ/config P5.1. Owner/secretary/lead/member deny Finance. Không cấp members:read cho treasurer; public Members port chỉ ID/code/name/status tối thiểu; W14 treasurer drawer tài chính rút gọn, pastor section riêng trong Members. Không đưa tiền/mã dâng hiến vào DTO/import/export Members. Mã DH độc lập/memberId unique trong tenant, không tái dùng/relink; cấp từ current(active/long_absent), không giới hạn tuổi/Báp-têm. Ngừng/khôi phục cần reason/CAS; không auto deactivate theo Members lifecycle, không auto tạo Members.

C52-02: VND nguyên đồng, API string và bigint arithmetic/Decimal128 storage, không float/rounding; mỗi amount và total phiếu1..999999999999999999. Một fund/day/receipt; aggregate amount không donor hoặc itemized1–100givingId/amount lines, hai mode loại trừ. Một ledger credit tổng, không cộng lines hai lần. SourceReference tường minh unique tenant cả sau void; replacement có sourceRef mới và liên kết phiếu đã hủy. Receipt code/submissionId durable unique và payload hash; không hứa phát hiện cùng tiền thật khi người nhập dùng sourceRef khác. NgàyYYYY-MM-DD≤businessDay(VN), backdate kỳ mở; actual timestamp UTC. Không opening balance/available cash claim.

C52-03: editor→server preview5min(actor/tenant/body/source versions)→confirm atomic. Active fund/code/same tenant/fresh auth/resources/period; phiếu/ledger/history/safe audit/operation cùng TX. Snapshot fund/donor/name không rewrite; general ledger/audit không name/mapping/private note. JSON16KiB, no client-trusted snapshots. Period singleton tenant/month: GET no init, first money TX may init open; every write conditional fence on same period, future close races safely. Không close/reopen UI/API P5.2. Receipt immutable; treasurer void whole posted receipt in original open period with reason/confirmation/CAS: one opposite entry original amount/date/period, actual void UTC, no partial void. Replacement references voided receipt, new sourceRef. Closed period adjustments thuộc P5.5.

Retry keeps body/key/version/submission; no auto replay on reauth. Ops TTL24/48h không durable dedupe; exact submission/payload retained with receipt, current ACL and actor fences; voided original never becomes posted on replay. Hard reload requires reconciliation by sourceRef first. Lists default25/max100, signed context cursor/day+id stable, source paging/filter/sums, no implicit exactcount. Quỹ/source changes require repreview, no silent fund/day/month fallback.

## ASCII đã duyệt

```text
DÂNG HIẾN & QUỸ [⚙ Quỹ]
[Kỳ▼] [Quỹ▼] [Trạng thái▼] [Tìm phiếu/nguồn…]
[Tổng thu hiệu lực] [Số phiếu] [Chi:—] [Số dư:—]
[Mã dâng hiến] [＋ Phiếu thu]
Ngày | Phiếu | Quỹ | Diễn giải | Thu/Đối ứng | Xem
[Trước] [Tiếp]
PHIẾU THU: Ngày/Quỹ/Nguồn/Nội dung · aggregate(amount) hoặc itemized(code/person/amount lines≤100)
[Hủy] [Xem trước] → server summary → [Quay lại] [Xác nhận ghi thu]
CHI TIẾT: code/state/day/fund/source/lines/total/history · [Hủy phiếu nhập sai] chỉ treasurer/open period
CÁ NHÂN: name/memberCode/givingCode · kỳ/contributions/codeHistory
```

W09/W14 dùng shared UI, menu icon+tên, dark/light/responsive/keyboard. Pastor readonly money/code; treasurer no full Members. W01/chart/expense/available balance/printing/import chưa mở. Quỹ/config đã nghiệm thu giữ semantics.

## WHAT / checklist

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P52-01 | Quyền/mã/identity minimal | Finance/authorization/Members port | Hoàn tất · PASS local/synthetic | — |
| P52-02 | Money/receipts/ledger/period/void/dedupe | Finance/Mongo/Operations/Audit | Hoàn tất · PASS local/synthetic | — |
| P52-03 | W09/W14/forms/callers | Web | Hoàn tất · PASS local/synthetic | — |
| P52-04 | Transactions/roles/privacy/concurrency/replay/UI/query/qualification | Tests/runners | Hoàn tất · PASS local/synthetic | — |
| P52-05 | Contracts/runbook/evidence/review/journal/state | Docs/output/p5.2 | Hoàn tất · PASS local/synthetic | — |

Giữ source complete/local verified/human accepted/released tách biệt. Main Finance schema/index/Policy20 chưa áp, physical/nativeWord/Safari/UAT/mainruntime/pilot/remoteCI/production/multi-replica/independentreview NOT_RUN; P3.4race/P4.2fastfillUNKNOWN, E51-01USER_WAIVED giữ nguyên. Snapshot bytes+hash prior artifacts/journals trước regression, evidence P5.2 riêng; không dùng lại path P4.6 bị mất gốc.

## P5.2-r1 — bàn giao local/synthetic, chờ nghiệm thu

Source/wiring P52-01–05 hoàn tất; **chưa HUMAN_ACCEPTED/chưa released**, dừng trước P5.3. [Contracts/runbook](../engineering/P5.2-income.md), [receipt](../../output/p5.2/verification.json), [manifest](../../output/p5.2/source-manifest.json). Không khởi động/đọc/init database chính hoặc runtime3443.

### Checklist nghiệm thu của Khiêm — năm mục

- [x] **P52-01:** pastor/treasurer đọc; treasurer cấp/ngừng/khôi phục mã có reason/CAS; các vai trò khác deny; treasurer chỉ có identity tối thiểu, không toàn bộ Members.
- [x] **P52-02:** nhập tổng hợp hoặc theo cá nhân → preview → phiếu/sổ/history/audit atomic, VND exact, sourceReference/submission dedupe; hủy một lần ở ngày/kỳ gốc, kỳ đóng từ chối.
- [x] **P52-03:** W09 và W14 đọc nguồn thực, lọc/phân trang, Diễn giải/Nguồn, đối soát, light/dark/responsive/keyboard; owner W14 không fetch/render Finance.
- [x] **P52-04:** đối chiếu quyền/tenant/tiền/rollback/race/retry/preview/period tests, browser và qualification; phân biệt stored-volume fixture với workflow công khai.
- [x] **P52-05:** kiểm tra tài liệu/receipt/manifest/journal, bảo toàn evidence hiện có; giữ E51-01 USER_WAIVED, không coi là đã phục hồi gốc; dừng P5.3.

### Kết quả thực tế

Full suite **413 PASS/0 FAIL, 6062 assertions**; affected Finance **29 PASS/0 FAIL, 545 assertions**. Browser P5.2 379 + regression P5.1 141 = 520 checks, 48 ảnh P5.2/10 tổ hợp theme-width; Firefox/private CA/local synthetic. Typecheck/lint/build/build:ui/UI-STD/audit/diff/shell PASS; 10 CSS warnings có sẵn và advisory bundle lớn giữ nguyên mức cảnh báo, không tắt gate.

Qualification: 12 plans tại100/500/2000phiếu stored-volume; 32 HTTPS journeys tại1/5/10actors, 10 retry responses được ghi, terminalerrors0. Tổng VND so khớp ledger sau concurrency, không SLA production. Database/TLS/container synthetic cleanup PASS.

### Review và bảo toàn

Self-review theo source/contracts/evidence; không phải reviewer độc lập. Đã sửa trong scope: title trùng; pending dialog không đóng được/không lọc đối soát được; nhãn số dòng sổ; cột Diễn giải/Nguồn đúng ASCII. Lượt FAIL và test-selector/hook defects giữ tại output/p5.2/attempts và logs. Runner qualification có retry hữu hạn giữ body/key; giữ cả lượt raw contention FAIL, không tắt CAS/fence/validation.

Regression đầu phát hiện legacy writers ghi lại20artifact. Đã phục hồi **đúng bytes/hash trước lượt chạy P5.2** từ snapshot riêng; đã cô lập8writer vào CHURCH_EVIDENCE_DIR qua tests/evidence.ts. Full suite cuối xuất vào output/p5.2/regression/final-suite, không ghi paths cũ. **1386/1386 file hiện có được bảo vệ khớp hash**. Đây không phải phục hồi original history-plans P4.6; E51-01/notice/waiver/r1 FAIL nguyên trạng.

Policy20 thay expectations Policy19: treasurer nay có own financial operation lookup; operation của actor khác404, own action không còn quyền403. Giữ nguyên kiểm tra quyền fund/config và provider deny. Không giảm assertions để làm xanh.

Journal: [implementation](../engineering/skill-usage/records/CHURCH-P5/P5.2-implementation-1.json), [self-review](../engineering/skill-usage/records/CHURCH-P5/P5.2-self-review-1.json). Main schema/index/Policy20 chưa áp; các UNKNOWN/NOT_RUN nêu trong receipt giữ nguyên.

## Nghiệm thu P5.2-r1; mở planning P5.3 — 2026-11-17

Khiêm: **“Nghiệm thu P5.2-r1; nhưng thấy vấn đề UI: nút bị canh giữa với field tạo cảm giác nút và fields bị lệch -> note vấn đề này giải quyết sau P8. Tiếp theo mở kế hoạch P5.3”** P52-01–05 **HUMAN_ACCEPTED đủ5/5 local/synthetic**. [Human acceptance](../engineering/skill-usage/records/CHURCH-P5/P5.2-human-acceptance-1.json) liên kết implementation/1; không rewrite verification/manifest/implementation/self-review gốc có trạng thái pending tại handoff. Không sửa ứng dụng, chạy lại tests/runtime, publication hoặc áp main schema/index/Policy20. E51-01 USER_WAIVED, không recovered, không troubleshoot lại.

P5.3 — Đề xuất và phê duyệt chi mở **PLANNING_ONLY**: khảo sát source hiện có và trình P5.3-plan-r1/C53/ASCII trong chat để duyệt trước coding. Chưa duyệt rules/contracts/ASCII hoặc implementation; chưa lưu draft thành quyết định. P5.4–P5.6 chưa mở.

<a id="ui-postp8-01"></a>
## UI-POSTP8-01 — Canh nút và field · xử lý sau P8

- **Nguồn/authority:** phản hồi trực tiếp của Khiêm khi nghiệm thu P5.2-r1. **USER_DEFERRED_AFTER_P8**, không chặn acceptance P5.2; không sửa trong P5.3–P8 theo ghi chú này. Sau P8 cần khảo sát và duyệt kế hoạch/UI trước sửa, không tự kích hoạt implementation.
- **Triệu chứng:** nút nằm giữa theo chiều dọc của Field có label khiến cạnh nút và ô nhập nhìn lệch hàng, nhất là toolbar lọc. Nguồn tham chiếu: output/p5.2/browser/ledger-light-1440.png; shared Toolbar/Field, web/ui/styles/patterns.css: `.toolbar { align-items:center }`. Đây là observation source, chưa đo/khẳng định root cause hoặc phạm vi mọi màn hình.
- **Việc làm sau P8:** rà nhóm field+nút, nhãn nhiều dòng, hint/error và wrap; trình ASCII/preview để chốt cách căn. Ưu tiên sửa shared pattern nếu xác minh lỗi dùng chung; không tự override feature CSS hoặc đổi palette/font/breakpoint.
- **Tiêu chí dự kiến:** nút và control cùng hàng nhìn thẳng hàng; label/hint/error không gây lệch khó hiểu; light/dark,1440/901/900/560/390, keyboard/touch và các callers của shared UI không regression. Chi tiết giải pháp còn chờ duyệt.
