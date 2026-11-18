# CHURCH-P5.6 — Tổng hợp và kiểm chứng tài chính

Quyết định mới nhất: **P5.6-r1 HUMAN_ACCEPTED đủ5/5 local/synthetic; P5 CLOSED.** [Nghiệm thu](#nghiệm-thu-p56-r1-và-đóng-p5). Các phần bàn giao trước là snapshot lịch sử.

## Authority

duyệt P5.6-plan-r1, C56-01–03 và ASCII để cho phép triển khai trọn P56-01–05 local/synthetic, bàn giao rồi dừng trước đóng P5/mở P6.

Theo roadmap Church CMS P5; một gói P56-01–05. Code/wiring trước tests; bàn giao rồi dừng trước đóng P5/mở P6. P5.1–P5.5 HUMAN_ACCEPTED local/synthetic; không publication/main/realdata/dependencies/worktree/delegation. E51-01 USER_WAIVED/original not recovered, E55-01 OPEN_NOT_WAIVED và UI-POSTP8-01 AFTER_P8 giữ nguyên.

## C56-01 — quyền/source đã duyệt

Finance summary read chỉ pastor/treasurer; W09 cả hai, W01 chỉ pastor đủ quyền overview+finance. Owner/role khác không gọi Finance, không Finance fields trong OverviewDto. Summary không donor identity/private purpose/reason. Grant/tenant fence trước query; church switch/revoke loại bỏ dữ liệu cũ. GET không init/seed.

## C56-02 — công thức/UI đã duyệt

Thu ròng=receipt+void; chi ròng=-(payment+payment_void); đầu kỳ=tổng trước kỳ; cuối=đầu+thu−chi. Decimal128/string exact, không UI tính lại nghiệp vụ. Một snapshot cho KPI/tháng và12month series/quỹ/asOf/status; các request độc lập không hứa cùng snapshot. Biểu đồ thu ròng theo năm của kỳ chọn, quỹ lọc; số liệu chi tiết keyboard/mobile. Kỳ mở tạm tính, future/failed read là —; measured empty là0. Search/kind/state chỉ lọc danh sách, không KPI. Reuse bảng quỹ hiện có.

ASCII: W09 giữ P55 period actions → filters →4KPI →18px→ Thu ròng từng tháng/year/fund +12month chart + details toggle →18px→ existing receipts/ledger. W01 pastor-only compact current-month income/expense/closing +asOf/state +MởW09. UI-COMPOSITION-r1 gap6/12/18; giữ Toolbar/Field alignment.

## C56-03 — verification/restore đã duyệt

Cross-flow funds→income→proposal/approval→payment→void→close→summary; ACL/tenant/revoke/reauth/retry/rollback/concurrent reads/writes. Volumes100/500/2000, workers1/5/10, actual query plans/workload not production SLA. Quiesce/drain isolated source, dump/restore into second UUID DB; compare all docs/indexes/validators before transformations. Then revoke target sessions/rotate synthetic signing key; check old previews/Operations/pre-post-cut markers. Missing restored operation is unknown, no money auto-replay. No product restore button/main/realdata/sharedRedisflush.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P56-01 | Summary contract/ACL/formulas | api/finance/reporting.ts, app.ts, Policy24 | HUMAN_ACCEPTED | — |
| P56-02 | W09 chart/W01 compact block | W09/W01, FinanceChart/shared UI | HUMAN_ACCEPTED | — |
| P56-03 | Integration/browser/permission/race | tests, scripts/browser-reporting.ts | HUMAN_ACCEPTED | — |
| P56-04 | Plans/workload/restore | p56-qualification/recovery.ts | HUMAN_ACCEPTED local/synthetic | E55-01 audit vẫn mở, không nâng deps |
| P56-05 | Contracts/evidence/handoff | docs/output/journals | HUMAN_ACCEPTED | — |

## Checklist nghiệm thu — năm mục

- [x] Quyền/scope tổng hợp đúng, không lộ dữ liệu.
- [x] KPI/biểu đồ/công thức khớp sổ.
- [x] Workflow/concurrency/recovery đạt.
- [x] Restore giữ liên kết/tiền/cutline.
- [x] Hồ sơ/evidence đủ, ngoại lệ giữ nguyên, dừng đóng P5/mở P6.

## P5.6-r1 — hồ sơ bàn giao

Source hoàn tất; hành vi local/synthetic đã kiểm chứng, **PENDING_REVIEW**, chưa released. [Verification](../../output/p5.6/verification.json) · [contract/runbook](../engineering/P5.6-reporting.md) · [manifest](../../output/p5.6/source-manifest.json) · [preservation](../../output/p5.6/preservation.json).

483tests/6926assertions toàn dự án; final Finance93tests/1393assertions (gồm11reporting). 7browser suites/4061checks/344ảnh; P56final1358checks/126ảnh. 19plans tại100/500/2000;32public HTTPSjourneys,0terminalerrors,33KS/32reversals trước recovery. Restore61collections khớp documents/indexes/validators trước transforms,21checks,70sessions revoked; fresh ACL/pre-cutOps/old preview/known-intent durable uniqueness/new close đạt. Hai DB nguồn/target và private TLS/archive đã cleanup. Static/build/UI/diff/shellPASS,10CSSwarnings có sẵn.

Full suite trước final mobile repair và test-fixture serialization; final Finance/browser/static phủ phần bị tác động. Lần Finance92PASS/1FAIL ở concurrent proposal setup409 trước phép thử payment đã giữ; setup được tách tuần tự, payment race và assertion tiền không đổi. Không kết luận underlying runtime cause đã sửa. Các attempt browser lỗi End/focus phía sau modal đã lưu và test sửa đúng tương tác. Nhãn tháng nhỏ là lỗi UI đã sửa và rendered lại. Chi tiết tại verification; không che FAIL lịch sử bằng PASS mới.

E51-01 USER_WAIVED/original không recovered; **E55-01 OPEN_NOT_WAIVED**, audit FAIL kế thừa không chạy lại/không nâng dependencies; UI-POSTP8-01 AFTER_P8. Policy24/schema/index không áp main. Physical/Safari/UAT/mainruntime/pilot/remoteCI/production/multi-replica/independent review NOT_RUN; self-review, không production SLA/RPO/RTO/PITR. 5290prior artifacts/journals exact; archive build hiện tại vào P56 rồi phục hồi reference alias cũ. Không publication/main/realdata/worktree/delegation.

Năm ô checklist phía trên dành cho nghiệm thu của Khiêm, chưa tự đánh dấu. **Dừng trước đóng P5/mở P6.**

## Nghiệm thu P5.6-r1 và đóng P5

Khiêm: **“Nghiệm thu P5.6-r1 theo năm mục checklist. Đóng P5 local/synthetic và mở kế hoạch chi tiết P6 để duyệt trước coding trong conversation khác. Giữ E51-01 đã bỏ qua, E55-01 còn mở và canh nút xử lý sau P8.”** (2026-11-18). P56-01–05 và năm mục checklist **HUMAN_ACCEPTED local/synthetic**. [Human evaluation](../engineering/skill-usage/records/CHURCH-P5/P5.6-human-acceptance-1.json) liên kết implementation/1; [biên bản đóng P5](CHURCH-P5.md#đóng-p5) liên kết cả sáu gói. Các nhãn PENDING_REVIEW tại snapshot bàn giao phía trên mô tả thời điểm trước nghiệm thu, không trạng thái hiện hành.

Không sửa verification/source-manifest/preservation hoặc implementation/self-review gốc thành humanaccepted; không chạy lại tests/build/runtime. Source/dependencies/dist giữ nguyên. **E51-01 USER_WAIVED/original không recovered, E55-01 OPEN_NOT_WAIVED/audit FAIL, UI-POSTP8-01 AFTER_P8**. Giới hạn/UNKNOWN/NOT_RUN không đổi; closure không là release/main activation. P6 chỉ mở planning trong conversation khác, chưa duyệt danh mục chi tiết/contracts/ASCII/coding. Trạng thái hiện hành chỉ project-state.
