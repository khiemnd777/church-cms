# CHURCH-P5.4 — Phiếu chi và sổ thu chi

Quyết định mới nhất: **P5.4-r1 HUMAN_ACCEPTED đủ5/5 local/synthetic; P5.5 chỉ PLANNING_ONLY trong chat.** Giữ E51-01 USER_WAIVED và UI-POSTP8-01 AFTER_P8. Biên bản ở cuối tài liệu; technical snapshots giữ lịch sử.

## Authority — 2026-11-17

Khiêm: **“Duyệt P5.4-plan-r1, C54-01–03 và ASCII. Cho phép triển khai trọn P54-01–05 local/synthetic, bàn giao rồi dừng trước P5.5. Giữ E51-01 đã bỏ qua và vấn đề canh nút xử lý sau P8.”** Theo roadmap Church CMS P5; một handoff P54-01–05. Hoàn tất production code/wiring trước tests; dừng trước P5.5. Không publication/commit/push/deploy/realdata/mainDBread/init/restart3443/worktree/delegation. E51-01 USER_WAIVED; UI-POSTP8-01 AFTER_P8. P5.3-r1 HUMAN_ACCEPTED5/5.

## C54-01 — quyền đã duyệt

Chỉ treasurer lập phiếu; pastor/treasurer xem full Finance payment/ledger/history. Expense viewers chỉ thấy paid/code/day trong phạm vi proposal hiện hành, không balance/Finance details. Treasurer được chi own proposal nếu account khác duyệt; không ép ba account. Approval hợp lệ giữ qua config changes; fresh account/tenant/payer/fund/proposal ACL mỗi TX/replay. Owner không Finance.

## C54-02 — tiền/ngày/số dư đã duyệt

Approved→paid, toàn bộ immutable amount/fund/purpose, đúng một PC/proposal; snapshot proposal/decision/fund/payer. VND integer exact. Ngày chi VN hôm nay, timestamp UTC; closed period deny, không backdate/future/auto chuyển kỳ. Balance hiện tại từng fund = toàn bộ receipt − void − payment; không opening nhập tay/chuyển quỹ. Empty measured ledger=0, unavailable/error=unknown và block; không gọi balance sổ là tiền mặt/ngân hàng đã đối soát. Payment và receipt void không được làm current book balance âm; approved không reserve. Không cam kết historical daily nonnegative sau void hồi tố. Không edit/delete/void payment trong P5.4; correction P5.5.

## C54-03 — an toàn và callers đã duyệt

Server preview5min gắn actor/body/proposal+decision/fund/day/period/book state. TX payment+negative ledger+proposal paid+history+safeAudit+Ops atomic; unique tenant/proposal durable qua Ops TTL. Fresh ACL replay/lookup, exact intent retry; reauth không auto replay. Shared fund fence cho post/void/pay; hai proposal khác nhau không overspend. Ledger source payment riêng, không đổi netIncome semantics (thu ròng). W09 KPI kỳ/quỹ: income/expense/opening/closing, filter type/code chỉ bảng; Mongo keyset default25/max100. Minimal ledger DTO, detailed purpose ở Finance details. No upload/external payment/bank/notification/chart/close/reopen.

## ASCII đã duyệt — P5.4-plan-r1

```text
W10: Đề xuất → Duyệt → Phiếu chi → Vào sổ
[Chờ] [Đã duyệt,chờ chi] [Đã chi] [Từ chối]
DX | Ngày gửi | Người gửi | Quỹ | Nội dung | Tiền | Trạng thái | Xem
Đã duyệt: [Lập phiếu chi]; Đã chi: PC/ngày [Xem]
LẬP PHIẾU: DX/approver/time/fund/purpose/amount readonly
Ngày chi hôm nay readonly; số dư hiện tại→sau chi
[Hủy] [Xem trước] → Tóm tắt server → [Xác nhận]
W09: [Kỳ] [Quỹ]
[Thu ròng] [Chi] [Đầu kỳ] [Cuối kỳ]
[Phiếu thu/Sổ thu chi] [Loại] [Tìm PT/PC/DX]
Ngày | Phiếu | Quỹ | Diễn giải loại | Nguồn | Tiền +/− | Xem
[Trước] [Tiếp]
```

Shared UI/themes900/560/keyboard/menu icon+tên. Không sửa shared alignment.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P54-01 | Rights/context/W13/book safety P52 callers | Authorization/Finance | Hoàn tất · PASS local/synthetic | — |
| P54-02 | Payment/preview/atomic/paid/history/dedupe | Finance/Mongo/Ops/Audit | Hoàn tất · PASS local/synthetic | — |
| P54-03 | W10 pay/detail, W09 mixed ledger/KPI | Web | Hoàn tất · PASS local/synthetic | — |
| P54-04 | Tests/browser/query/concurrency/regression/qualification | Tests/runners | Hoàn tất · PASS local/synthetic | — |
| P54-05 | Contracts/evidence/journals/manifest/state/handoff | Docs/output/p5.4 | Hoàn tất · PASS local/synthetic | — |

## Checklist nghiệm thu — năm mục

- [x] P54-01: treasurer lập, pastor xem, các role khác đúng scope không lộ sổ/số dư.
- [x] P54-02: approved→preview→một PC/một negative ledger/paid/history atomic.
- [x] P54-03: W09/W10 đúng data/filter/link/KPI/themes/responsive/keyboard/reauth/reconcile.
- [x] P54-04: thiếu tiền/closed/inactive deny; pay/pay và pay/void không âm; rollback/retry/TTL không trùng, regression P51–53.
- [x] P54-05: contracts/receipts/query/workload/cleanup/manifest/journal đủ, giữ exceptions/UNKNOWN/NOT_RUN và dừng P5.5.

Main schema/index/policy mới chưa áp; physical/Safari/UAT/mainruntime/pilot/remoteCI/production/multi-replica/independent review NOT_RUN. Snapshot source/test/runtime trước sửa không thay human acceptance hoặc release.

## P5.4-r1 — bàn giao local/synthetic, chờ nghiệm thu

P54-01–05 hoàn tất source/wiring và behavior PASS local/synthetic; **chờ Khiêm nghiệm thu năm mục phía trên và dừng trước P5.5**. Không tự humanaccept/release. [Contracts/runbook](../engineering/P5.4-payments.md), [verification](../../output/p5.4/verification.json), [manifest](../../output/p5.4/source-manifest.json).

### Kết quả thực tế

Full suite **448 PASS/0 FAIL, 6547 assertions**,35files. Finance P5.1–P5.4 **64 PASS/0 FAIL, 1030 assertions**,5files; riêng P54 có17case gồm exact money, ACL/tenant/owner, own treasurer proposal, durable dedupe qua Ops removal/fresh revoke, pending/rejected/inactive/closed/insufficient, two payers/same or distinct proposals, pay-vs-void, rollback, mixed-source validators, period opening/closing và scoped filters/cursors. Backend/test semantics giữ nguyên sau full suite; sửa UI cuối đã verify riêng.

Browser P54 **387** + P52 regression379 + P53 regression488 + P51 regression141 = **1395checks**.48ảnh P54, light/dark tại1440/901/900/560/390. API/source thật, Firefox/private CA/synthetic UUID DB; current P54 evidence ở output/p5.4/browser-accepted-candidate (tên thư mục không có nghĩa human acceptance); các regression paths trong receipt. 12queryplans tại100/500/2000payment stored-volume fixtures;32HTTPS submit→approve→pay journeys ở1/5/10worker pairs,22retryresponses/0terminalerrors. p95~77/440/1089ms; separate funded workers, shared-fund overspend kiểm trong integration, không SLA/capacity production. Stored-volume không được cộng thành public workflows.

Typecheck/lint/build/build:ui/UI-STD/audit/diff/shell PASS;10CSSwarnings có sẵn và Vite bundle advisory giữ nguyên. Aggregate/query dùng source Mongo; empty ledger được đo=0, error không fallback0. Ops/current readback không leak balance vào Expense scope. Database/browser-container/TLS cleanup PASS; metadata read-only xác minh0residualP54 synthetic DB, không main data read. Shared Mongo/Redis còn chạy phục vụ local infra; không runtime3443.

### Self-review và corrections

Self-review, **không review độc lập**. Đã sửa và verify focus preview/confirm, paid badge dùng success tone, hiện thời điểm duyệt và nút Hủy theo ASCII. Replay test đổi sang đúng idempotency_operations và HTTP200 replay; P53 KPI paid giờ được đo và filter paid hợp lệ; selectors regression scope vào table cell do có option cùng nhãn; thông điệp chờ chi cập nhật khi P54 mở. Giữ assertions không ledger từ approval/không trùng/ACL, không giảm để xanh. Browser uncertain check chờ response thực sau commit trước assert; không nhầm pending intent vừa tạo với lost acknowledgement.

Attempts/environment failures giữ nguyên trong numbered logs/folders: local Mongo dừng/sandbox network không truy cập, replay test fixture và browser selectors/focus. Chỉ khởi động Mongo/Redis local, không main read/init/restart; không có financial command thật.

**2279/2279 prior artifacts/journals giữ đúng hash**,15shared UI files không đổi; [receipt preservation](../../output/p5.4/preservation.json). E51-01 original không recovered/không troubleshoot; notice/waiver/technical FAIL cũ không rewrite. UI-POSTP8-01 alignment giữ AFTER_P8; wrapped large KPI chỉ thuộc Finance layout đã có.

[Implementation journal](../engineering/skill-usage/records/CHURCH-P5/P5.4-implementation-1.json), [self-review](../engineering/skill-usage/records/CHURCH-P5/P5.4-self-review-1.json). Main schema/index/Policy22 chưa áp; finance_ledger_once đổi partial-source index cần maintenance duyệt riêng. Physical/Safari/UAT/mainruntime/pilot/remoteCI/production/multi-replica/independent review NOT_RUN; P3.4race/P4.2fastfillUNKNOWN giữ nguyên. Restore thuộc P5.6. Source complete/verified/humanaccepted/released tách riêng.

Ảnh thực tế P5.4-r1, Firefox/private CA/synthetic; chỉ là bằng chứng giao diện, không tự chứng minh hidden transaction/ACL:

![W09 sổ thu chi P54-r1](../../output/p5.4/browser-accepted-candidate/mixed-ledger-light-1440.png)

## Nghiệm thu P5.4-r1; mở planning P5.5 — 2026-11-18

Khiêm: **“Nghiệm thu P5.4-r1 theo năm mục checklist. Mở kế hoạch chi tiết P5.5 để duyệt trước coding. Giữ E51-01 đã bỏ qua và vấn đề canh nút xử lý sau P8.”** P54-01–05 **HUMAN_ACCEPTED đủ5/5 local/synthetic**. [Checklist năm mục](#checklist-nghiệm-thu--năm-mục) và [Human acceptance](../engineering/skill-usage/records/CHURCH-P5/P5.4-human-acceptance-1.json) ghi quyết định sau implementation/1. Verification/manifest/implementation/self-review gốc giữ nguyên trạng thái tại handoff; không rewrite technical snapshot thành nghiệm thu, không chạy lại tests/runtime. Source/dependencies/dist không đổi; chưa released/publication/deploy/realdata/mainDBread/init/restart3443.

P5.5 — Khóa sổ và điều chỉnh chỉ **PLANNING_ONLY trong chat**, trình P5.5-plan-r1/C55/quyền/khóa kỳ/sửa sai/ASCII để duyệt trước coding. Chưa duyệt contracts, schema/API/UI hoặc implementation; chưa tạo task/engineering contract/planning journal P5.5. P5.6 chưa mở.

Giữ **E51-01 USER_WAIVED**, original chưa recovered, không troubleshoot tiếp. Giữ **UI-POSTP8-01 USER_DEFERRED_AFTER_P8**, không sửa canh nút trong P5.5–P8. UNKNOWN/NOT_RUN và giới hạn local/synthetic giữ nguyên. Trạng thái hiện hành duy nhất ở project-state; các ghi nhận phía dưới là lịch sử.

[Journal lượt ghi nhận](../engineering/skill-usage/records/CHURCH-P5/P5.4-acceptance-opening-P5.5-record-1.json). Năm dấu tick là nghiệm thu của Khiêm, không phải kết quả runtime đo mới.
