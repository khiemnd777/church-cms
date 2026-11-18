# CHURCH-P5.5 — Khóa sổ và điều chỉnh

## Authority — 2026-11-18

Khiêm: **“duyệt P5.5-plan-r1, C55-01–03 và ASCII, cho phép trọn P55-01–05 local/synthetic, bàn giao rồi dừng trước P5.6”** Theo roadmap Church CMS P5; một gói P55-01–05, code/wiring toàn gói trước tests; dừng P5.6. P5.4-r1 HUMAN_ACCEPTED5/5; E51-01 USER_WAIVED/original not recovered, không troubleshoot. UI-POSTP8-01 AFTER_P8, không sửa alignment. Không publication/commit/push/deploy/mainDBread/init/restart3443/realdata/worktree/delegation.

## C55-01 — quyền/phạm vi khóa đã duyệt

Treasurer đối chiếu/khóa/hủy chi; pastor chỉ xem biên bản/history. Role khác/owner không Finance. Khóa toàn church/tất cả quỹ, không theo fund filter. Khóa đến hết M (M<=VN current month), bao gồm mọi tháng trước dù chưa có period doc; mốc chỉ tăng, không reopen. Empty measured period có thể khóa; GET/preview không init. Mọi money writer kiểm mốc chung trong TX. Proposal/approval không ghi tiền vẫn giữ quyền, payment kiểm ngày/kỳ thực chi.

## C55-02 — sửa sai đã duyệt

Receipt void/replacement P52 giữ quy tắc, thêm cutline gate; void thu không âm quỹ. Payment void toàn bộ ở kỳ gốc mở: reason→preview→confirm; positive reversal cùng fund/amount/day/period gốc, UTC action stamps riêng. Payment posted→voided, proposal paid→payment_voided, không reopen approved; một PC/proposal luôn giữ cả sau void. Cần chi lại thì new proposal/approval. Inactive fund vẫn cho void; không partial/overwrite/arbitrary adjustment/closed-period correction hoặc external refund.

## C55-03 — contracts/safety đã duyệt

Đối chiếu nguồn phiếu↔ledger trong dải sắp khóa; mismatch/unknown block. Preview5min bind actor/scope/reason/version/book sources; stale phải xem lại. Một immutable KS cho mỗi advance cutline; fixed summary, paged funds/history. Close và post/void/pay/payvoid chung DB control fence, TX money/status/history/audit/Ops atomic. Durable unique reversal/closure qua OpsTTL; fresh action ACL/replay/lookup, reauth không auto replay. Payment reversal giảm netExpense, không tăng netIncome. W09 Chi ròng kỳ; W10 giữ4KPI, paid effective + phụ số/tổng voided/filter; Expense viewers chỉ minimal status/code/day, không balance/private void reason. Không tự đổi ngày/kỳ.

## ASCII đã duyệt

```text
W09 [Kỳ▼] [Quỹ▼] [Đối chiếu kỳ] [Khóa sổ]
[Thu ròng] [Chi ròng] [Đầu kỳ] [Cuối kỳ]
KHÓA ĐẾN HẾT M — toàn church/tất cả quỹ, mọi tháng trước
Lý do [ ] [Đối chiếu & Xem trước]
Khớp / Sai lệch / Chưa xác định · Tổng thu/chi/cuối kỳ
Sau khóa không ghi/hủy trong phạm vi này. [Hủy] [Xác nhận khóa sổ]
Đã khóa đếnM · KS · actor/time [Lịch sử]
SỔ: Ngày | Phiếu | Quỹ | Loại (Chi/Đối ứng hủy chi) | Nguồn | ±Tiền
PAYMENT DETAIL PC/DX/fund/amount/day/decision [Hủy phiếu chi]
VOID: nguyên phiếu/ngày-kỳ gốc readonly, reason [Đóng] [Xem trước]
→ Tóm tắt → [Quay lại] [Xác nhận hủy phiếu]
W10: Phiếu chi đã hủy · PC; không PC thứ hai.
```

UI-STD/shared components/themes900/560/keyboard/menu icon+tên; không đổi shared Toolbar/Field alignment.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P55-01 | Rights/book cutline/all money writers | Authorization/FinanceBook/callers | Hoàn tất nguồn; chờ nghiệm thu | — |
| P55-02 | Reconcile/preview/close/KS/history | Finance/Mongo/Ops/Audit | Hoàn tất nguồn; chờ nghiệm thu | — |
| P55-03 | Void PC/reversal/W09/W10/details | Finance/Web | Hoàn tất nguồn; chờ nghiệm thu | — |
| P55-04 | Tests/browser/concurrency/query/regression | Tests/runners | Behavior PASS; audit FAIL | E55-01 dependency hiện hữu, chưa miễn trừ |
| P55-05 | Contracts/evidence/journal/manifest/handoff | Docs/output/p5.5 | Hoàn tất nguồn; chờ nghiệm thu | — |

## Checklist nghiệm thu — năm mục

- [ ] P55-01: quyền/scope/mọi quỹ, Expense viewer không lộ balance/private reason.
- [ ] P55-02: reconcile→preview→một KS; cutline chặn mọi tháng trước kể cả thiếu period doc.
- [ ] P55-03: void PC một lần, đối ứng đúng, không PC thứ hai, totals/KPI/history khớp.
- [ ] P55-04: race close/post/void/pay/payvoid/close, rollback/durable retry/revoke/reauth/query/UI/regression.
- [ ] P55-05: hồ sơ/receipts/cleanup/hashes đủ; giữ waived/deferred/UNKNOWN/NOT_RUN, dừng P5.6.

Main schema/index/policy chưa áp; physical/Safari/UAT/mainruntime/pilot/remoteCI/production/multi-replica/independent review NOT_RUN. Không suy local workload thành production SLA/capacity/RPO/RTO; restore P5.6.

## Bàn giao P5.5-r1 — nguồn hoàn tất; audit còn FAIL

P55-01–03 đã nối UI/API/Mongo/Ops/Audit/callers; P55-04 đã chạy kiểm chứng, còn E55-01; P55-05 hồ sơ bàn giao hoàn tất. **Không ghi overall PASS hoặc đủ mọi gate.** Human acceptance PENDING_REVIEW; NOT_RELEASED; dừng trước P5.6.

466 tests/6801 assertions/0FAIL toàn dự án; final Finance82tests/1284assertions/0FAIL, gồm18P55 cases. Full suite trước guard đối chiếu PC↔ledger cuối; final Finance/browser/qualification xác minh guard; reuse phần unaffected, không claim toàn suite trên exact final source. P55browser550checks/68ảnh + P54:387/P53:488/P52:379/P51:141 =1945checks; light/dark,1440/901/900/560/390. PrivateCA/Firefox; selector lịch sử test sai đã sửa, attemptFAIL giữ lại.

Qualification: 13 query plans,32public void→close journeys,2.000stored payment fixtures,33KS/32reversals;0 retryresponses/0terminalerrors. Samechurch races ở integration; timed cases tách church, setup không tính thời gian. Không suy production capacity.

Typecheck/lint/build/buildUI/UI/diff/shell/cleanup/hash PASS; lint10CSSwarnings cũ. **bun audit FAIL1high:** picomatch4.0.7, GHSA-fc5q-39xc-vjpf, dev/build chain; bun.lock giữ nguyên. E55-01 OPEN_NOT_WAIVED, không đổi dependency hoặc tự chấp nhận rủi ro. [Advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) hiện không liệt kê patched version; cần phạm vi riêng trước remediation. Không có bằng chứng exploit runtime; không gọi finding đã khắc phục.

[Verification](../../output/p5.5/verification.json) · [Preservation](../../output/p5.5/preservation.json) · [Manifest](../../output/p5.5/source-manifest.json) · [Dependency finding](../../output/p5.5/dependency-finding.json) · [Contracts/runbook](../engineering/P5.5-periods.md).2805priorartifacts nguyênhash/15sharedUI unchanged. E51-01 USER_WAIVED/original unavailable; UI-POSTP8-01 AFTER_P8. Main schema/index/Policy23 chưa áp, payment-ledger index replacement cần maintenance riêng. Physical/Safari/UAT/mainruntime/pilot/remoteCI/production/multi-replica/independentreview NOT_RUN; restore P5.6 chưa mở.

Self-review sửa guard PC/ledger/proposal lệch, recovery pending chỉ xóa sau explicit readback, dịch event lịch sử đề xuất; không independent review. Initial stale-preview assertion phân biệt controlVersion412 với book-fingerprint409; fixture/selector sửa theo contract, không hạ valid assertions. Không publication/realdata/mainDBread/init/restart3443/worktree/delegation.

Bước tiếp theo: Khiêm xem năm mục checklist và E55-01; có thể yêu cầu kế hoạch dependency riêng. Chỉ mở planning P5.6 khi có chỉ dẫn, không suy từ bàn giao này.

## Human review P5.5-r1 — CHANGES_REQUESTED — 2026-11-18

Khiêm chưa nghiệm thu vì các section dính nhau; yêu cầu nếu lỗi general phải có rule UI/UX khắc phục hiện tại và phòng tái diễn. **P5.5 CHANGES_REQUESTED, chưa HUMAN_ACCEPTED; P5.6 NOT_OPENED.** UI-P55-SECTION-01 OPEN: PeriodPanel thiếu spacing composition; Card không tự tạo vertical gap, shared paragraph/heading margin0. Gate cũ không đo section gaps; browser PASS lịch sử không chứng minh visual acceptance. [Human review](../engineering/skill-usage/records/CHURCH-P5/P5.5-human-review-1.json) ghi feedback; technical receipts/journals/manifest r1 giữ nguyên như snapshot lịch sử. E55-01 audit vẫn OPEN_NOT_WAIVED; E51-01 USER_WAIVED, UI-POSTP8-01 AFTER_P8 giữ nguyên. Rule/layout chung và phạm vi migration sẽ trình P5.5-ui-r2-plan-r1/ASCII trong chat trước coding; chưa sửa application/shared UI/rules hoặc chạy runtime mới.


## P5.5-ui-r2-plan-r1 — được duyệt

Duyệt P5.5-ui-r2-plan-r1 và ASCII. Triển khai trọn UI55-01–04 local/synthetic, bổ sung rule dùng chung, rà và sửa các màn cùng lỗi, bàn giao P5.5-r2 rồi dừng trước P5.6. Giữ E51-01, E55-01 và canh nút sau P8 như đã ghi.

Theo roadmap P5.5; UI55-01 shared rule/primitive, UI55-02 P55 compositions, UI55-03 audit/migrate same defect across existing screens, UI55-04 source guard/rendered gap regression. Code/wiring toàn gói trước tests. IN_PROGRESS; chưa nghiệm thu r2. Snapshot protected/source trước sửa; technical snapshots r1 giữ nguyên.

ASCII được duyệt: toolbar+scope →18px→ đối chiếu heading →12px→ feedback/nội dung →18px→ bảng/quỹ →18px→ khóa/preview/confirm; dòng thông tin cùng nhóm6px. Rule UI-COMPOSITION-r1 theo token6/12/18, light/dark và1440/901/900/560/390. Không sửa Toolbar/Field alignment, dependencies, backend, main hoặc P5.6.

## Bàn giao P5.5-r2 — UI55-01–04 hoàn tất

Kiểu bàn giao: Theo roadmap; sửa CHANGES_REQUESTED trong P5.5, giữ điểm dừng P5.6. Source/UI composition hoàn tất và PASS local/synthetic; chưa HUMAN_ACCEPTED/released. E55-01 audit vẫn FAIL/OPEN_NOT_WAIVED, không ghi mọi quality gate đạt.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| UI55-01 | Rule/primitive6/12/18, shared dialog spacing | AGENTS/ui-system/shared UI | PASS local; chờ nghiệm thu | — |
| UI55-02 | P55 scope/reconcile/funds/close/preview/history | W09/W10 | PASS local; chờ nghiệm thu | — |
| UI55-03 | Source audit và migration cùng lỗi | web/** | PASS source/browser | Phạm vi spacing/hierarchy; không whole-site human acceptance |
| UI55-04 | AST guard, measured gap, negative control, regression | ui:check/browser/tests | PASS local | Physical/Safari/UAT/independent review NOT_RUN |

Source audit46TSX/118Card-Modal-Drawer sites;28baseline gate violations→0; thêm8TSX shared components/reference với4baseline violations→0.38compact metadata groups +26Card spacing migrations trong22featurefiles, cùng P55 sections và shared Modal/Drawer renderer. 27browser suites/15582checks/6795actual gap measurements. P55:950checks/220state-viewport samples/1600gaps/96ảnh; đủ normal/empty/loading/mismatch/error/pending/preview/reauth/closed/history. SharedUI314checks/negativegap0. Unitguard6PASS/16assertions.

Typecheck/lint/build/buildUI/UI/diff/shell/cleanup PASS;10CSSwarnings cũ.3309protected files nguyênhash; mutable reference alias được archive r2 rồi phục hồi byte cũ sau tests. Số liệu backend/full-suite được reuse từ r1 và không chạy lại. API/integration sources, request/mutation calls, package/lock và Toolbar/Field/control functions không đổi; source styles/hash giữ nguyên.

### Checklist nghiệm thu P5.5-r2 — năm mục

- [x] UI55-01: rule/primitive chung quy định6/12/18px, dùng lại được, không đổi source style hoặc Toolbar/Field alignment.
- [x] UI55-02: xem scope→đối chiếu→quỹ→khóa/preview/history; các nhóm tách rõ trên desktop/mobile/light/dark; tiền/quyền/C55 giữ nguyên.
- [x] UI55-03: xem migration/các màn cũ đại diện và source audit, không còn cấu trúc thiếu spacing được guard phát hiện.
- [x] UI55-04: actual gaps/negative control, focus/quyền/regression đạt; functional PASS không thay visual acceptance.
- [x] Hồ sơ r2/bằng chứng cũ/cleanup/hashes đủ; E51-01 waived/E55-01 open/UI-POSTP8-01 AFTER_P8, dừng P5.6.

[Verification](../../output/p5.5/r2/verification.json) · [Audit](../../output/p5.5/r2/composition-audit.json) · [Migration](../../output/p5.5/r2/migration-actions.json) · [Preservation](../../output/p5.5/r2/preservation.json) · [Manifest](../../output/p5.5/r2/source-manifest.json). Technical receipts r1 giữ nguyên; UI-P55-SECTION-01 đã sửa kỹ thuật, chờ Khiêm review lại.

Self-review phát hiện margin Stats/progress cộng dồn trong Stack (12→28/26px); rule cuối reset margin-block con trực tiếp để container sở hữu toàn bộ vertical rhythm, không xử lý riêng từng component. Shared audit8TSX thêm4baseline violations→0; EmptyState có action cũng dùng content gap12, được shared UI cuối xác minh. Initial test preconditions/selector được sửa: theme sau ma trận, mở section khi đổi kỳ/closed, scope lỗi trong panel, giữ tên quỹ, kỳ vọng giving-owner/menu theo contracts P52/P3/P4. Failed attempts giữ nguyên, không hạ assertions hợp lệ. Không independent review.

Bước tiếp theo: Khiêm xem ảnh và năm mục checklist để nghiệm thu hoặc yêu cầu sửa; P5.6 vẫn chưa mở.

## Human acceptance P5.5-r2 — mở planning P5.6

Khiêm: **“nghiệm thu. mở P5.6”**. P55-01–05 và UI55-01–04 HUMAN_ACCEPTED local/synthetic theo năm mục checklist r2. [Acceptance](../engineering/skill-usage/records/CHURCH-P5/P5.5-human-acceptance-1.json) liên kết implementation/2 và giữ review/1 CHANGES_REQUESTED như lịch sử. UI-P55-SECTION-01 đã được chấp nhận ở r2. E51-01 USER_WAIVED/original not recovered, E55-01 OPEN_NOT_WAIVED/audit FAIL, UI-POSTP8-01 AFTER_P8 giữ nguyên. Acceptance không là waiver dependency hoặc release/main authorization.

Chỉ mở khảo sát/kế hoạch chi tiết P5.6 trong chat để duyệt trước coding; C56/contracts/ASCII/implementation chưa duyệt. Chưa tạo task/engineering contract/planning journal P5.6. Không đóng P5/mở P6, không publication/realdata/mainDBread/init/restart3443/worktree/delegation. Source700files khớp manifest trước acceptance;8technical artifacts/journals giữ hash, không chạy lại tests/runtime hoặc rewrite pending snapshots. Trạng thái hiện hành duy nhất ở project-state.
