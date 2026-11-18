# CHURCH-P5.3 — Đề xuất và phê duyệt chi

Quyết định mới nhất: **P5.3-r1 HUMAN_ACCEPTED đủ5/5 local/synthetic; P5.4 chỉ PLANNING_ONLY trong chat.** Giữ E51-01 USER_WAIVED và UI-POSTP8-01 AFTER_P8. Biên bản ở cuối tài liệu; technical snapshots tại handoff không rewrite.

## Authority — 2026-11-17

Khiêm: **“Duyệt P5.3-plan-r1, C53-01–03 và ASCII, phạm vi là trọn P53-01–05 local/synthetic, bàn giao rồi dừng trước P5.4.”** Theo roadmap Church CMS P0–P8/P5, một handoff trọn P53-01–05. Code/wiring toàn gói trước tests. Không P5.4+/publication/commit/push/deploy/realdata/mainDBread/init/restart3443/worktree/delegation. P5.2-r1 HUMAN_ACCEPTED5/5; E51-01 USER_WAIVED, không recovered/troubleshoot tiếp; UI-POSTP8-01 xử lý sau P8, không sửa alignment trong gói này.

## C53-01 — quyền đã duyệt

Full church account; owner/member deny. Propose khi role thuộc proposerRoles hoặc là approverRole (kế thừa P5.1). Pastor/treasurer đọc tất cả đề xuất; role duyệt hiện hành đọc/duyệt/từ chối tất cả đề xuất khác account; người chỉ đề xuất đọc riêng proposal.createdBy == actorId, không theo role/ban. Cấm tự duyệt/tự từ chối kể cả đổi role. Thu quyền áp dụng trên mỗi request/TX/replay; không cấp Finance income/giving/settings/funds manage hoặc members:read vì được Expense. Quỹ picker chỉ id/name active tối thiểu. Context/menu/W13 phản ánh cấu hình hiện hành; không auto defaults.

## C53-02 — workflow đã duyệt

Gửi → pending → approved hoặc rejected; duyệt chỉ chờ chi, không tạo phiếu chi/ledger/giữ-trừ tiền. VND exact integer1..999999999999999999, một fund/amount/purpose1..500. Proposer từ account đã xác thực, ngày gửi VN/server và timestampUTC riêng; không tin actor/amount snapshots client. Submitted content bất biến; reject reason1..500 bắt buộc, approve comment0..500; chưa edit/withdraw/delete/reopen, cần sửa lập proposal mới. Snapshot nguồn/config/actor giữ lịch sử, pending theo approverRole hiện hành; decision xong không đổi hồi tố khi đổi tên/role/config. Fund inactive chặn submit/approve, vẫn reject đúng quyền. Không dùng tổng thu làm available balance; kỳ/điều kiện thực chi thuộc P5.4–P5.5.

## C53-03 — safety/callers đã duyệt

Submit và decision server preview5min → confirm, actor/body/proposal/config/fund versions bound; stale nguồn/expired preview cần xem lại. Proposal/decision/history/safeAudit/Ops cùng TX; CAS chỉ một winner approve-vs-reject. Tenant-unique DX/submissionId + actor/payloadHash durable qua OpsTTL; same intent body/key/version trên retry, reauth không auto replay, hardreload đối soát danh sách trước intent mới. Nhiều intent cùng nội dung có thể hợp lệ, không hứa phát hiện trùng tiền thật chỉ từ nội dung. Query nguồn default25/max100/keyset; KPI theo cùng quyền/kỳ/quỹ, state chỉ lọc bảng; Đã chi “—” khi chưa mở. General audit metadata, không nội dung riêng. No upload/external notifications/multilevel approvals.

## ASCII đã duyệt

```text
ĐỀ XUẤT CHI & DUYỆT [＋]
Đề xuất → Duyệt → Phiếu chi [P5.4] → Vào sổ [P5.4]
[Kỳ gửi▼] [Quỹ▼] [Trạng thái▼] [Phạm vi theo quyền▼]
[Chờ:n/Σ] [Đã duyệt:n/Σ] [Đã chi:—] [Từ chối:n/Σ]
Mã DX | Ngày | Người gửi | Quỹ | Nội dung | Tiền | Trạng thái | Xem
[Trước] [Tiếp]
TẠO: Quỹ/Số tiền/Nội dung; Người gửi/Role duyệt readonly
[Hủy] [Xem trước] → Tóm tắt server → [Xác nhận gửi]
CHI TIẾT: snapshots/người gửi/lịch sử
[Duyệt] [Từ chối] → Lý do/ghi chú → Xem trước → Xác nhận
Đã duyệt: Chờ lập phiếu chi — P5.4
```

Shared UI/tokens/menu icon+tên/one page title/light-dark900/560/keyboard. Không sửa shared alignment (UI-POSTP8-01).

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P53-01 | Dynamic ACL/context/menu/W13/own scope | Identity/Finance | Hoàn tất · PASS local/synthetic | — |
| P53-02 | DX/preview/decision/atomic/history/dedupe | Finance/Mongo/Ops/Audit | Hoàn tất · PASS local/synthetic | — |
| P53-03 | W10/W16/confirm/reconcile/callers | Web | Hoàn tất · PASS local/synthetic | — |
| P53-04 | Roles/race/rollback/replay/UI/query/qualification/regression | Tests/runners | Hoàn tất · PASS local/synthetic | — |
| P53-05 | Contracts/evidence/journal/manifest/state/handoff | Docs/output/p5.3 | Hoàn tất · PASS local/synthetic | — |

Source complete/local behavior/human acceptance/release tách riêng. Main schema/index/Policy mới chưa áp; physical/Safari/UAT/mainruntime/pilot/remoteCI/production/multi-replica/independentreviewNOT_RUN. Prior P3.4race/P4.2fastfillUNKNOWN giữ nguyên. Bảo toàn old receipts/journals bằng bytes+hash trước regression; evidence mới output/p5.3.

## P5.3-r1 — bàn giao local/synthetic, chờ nghiệm thu

P53-01–05 hoàn tất source/wiring và PASS local/synthetic; chưa humanaccepted/released, **dừng trước P5.4**. [Contracts/runbook](../engineering/P5.3-expenses.md), [verification](../../output/p5.3/verification.json), [manifest](../../output/p5.3/source-manifest.json). Main DB/schema/index/Policy21 chưa áp.

### Checklist nghiệm thu của Khiêm — năm mục

- [x] **P53-01:** cấu hình role → đúng quyền gửi/duyệt và phạm vi All/Mine theo account; owner/member deny; Expense không cấp income/giving/funds-manage/Members. Kiểm tra đổi role/cấu hình và cấm tự quyết định.
- [x] **P53-02:** VND exact → preview → pending; approve/reject cần đúng quyền/version và reason phù hợp; snapshots/terminal decision/history/audit/Ops atomic. Retry không trùng, không ledger/payment/giữ tiền.
- [x] **P53-03:** W10/W16, KPI đúng scope và thứ tự ASCII, unknown outcome/explicit retry/reauth không auto replay, history, responsive/theme/keyboard; refresh thu hẹp scope không giữ proposal ngoài quyền; deeplink hoạt động và Member không có dữ liệu.
- [x] **P53-04:** xem bộ role/tenant/race/rollback/preview/dedupe/validator tests, browser và qualification; phân biệt stored-volume fixtures với public workflows, không suy production SLA.
- [x] **P53-05:** tài liệu/receipts/journals/manifest/hash đọc lại được; giữ E51-01 USER_WAIVED, UI-POSTP8-01 sau P8 và UNKNOWN/NOT_RUN; không tự mở P5.4.

### Bằng chứng kỹ thuật

Full suite **431 PASS/0 FAIL, 6317 assertions**, Finance P5.1–P5.3 **47 PASS/0 FAIL, 800 assertions**. Browser P53 488 + P52 regression 379 + P51 regression 141 = **1008checks**; 60ảnh P53,10 tổ hợp theme-width. Source/UI/backend thực, private CA, synthetic UUID DB. Typecheck/lint/build/build:ui/UI-STD/dependency audit/diff/shell PASS;10CSSwarnings có sẵn và Vite large-bundle advisory không bị tắt.

Qualification:10plans tại100/500/2000proposal fixtures và32HTTPS submit–approve journeys ở1/5/10worker pairs, 11retryresponses/0terminalerrors; exact scoped totals và no-ledger/no-period writes readback PASS. Cleanup DB/TLS/browser PASS; hook-timeout cleanup xác minh0residual P53 fixture.

### Review/corrections trong scope

Self-review, không reviewer độc lập. Đã sửa và kiểm chứng: create Ops route key phải thuộc namespace prefix; GET operation phải gọi fresh action ACL; list cursor gắn effective scope/configVersion; UI chờ context mới/reset page và xóa private view khi thu hẹp quyền; KPI tổng lớn không tràn390px, đúng grid/order source; native shell whitelist có /expense và /giving cho deeplink/hardreload. Member thiếu Expense availability được xử lý như unavailable, không dereference undefined. Financial API ACL không bị nới vì shell HTML200.

Test defects được giữ trong logs/attempts: setup9actors vượt5s nên dùng timeout30s theo runbook; test DTO Account và revoked-session fixture được sửa; expectations W13 của P5.1 cập nhật vì Expense đã mở, giữ owner mask/current ACL. Browser actor switch dùng about:blank/fresh cookie isolation và kiểm /auth/me, thay raw logout helper không kiểm kết quả; không claim đã sửa identity logout bug.

**1713/1713 prior artifacts/journals giữ nguyên hash**, 15shared UI files không đổi. E51-01 original không recovered; waiver/notice/technical FAIL cũ không rewrite. UI-POSTP8-01 Toolbar/Field alignment không sửa; wrapping KPI mới chỉ thuộc P53. Không chạy main runtime, không publication/realdata/deploy.

[Implementation journal](../engineering/skill-usage/records/CHURCH-P5/P5.3-implementation-1.json) và [self-review](../engineering/skill-usage/records/CHURCH-P5/P5.3-self-review-1.json). Quyết định human acceptance chờ Khiêm.

## Nghiệm thu P5.3-r1; mở planning P5.4 — 2026-11-17

Khiêm: **“Nghiệm thu P5.3-r1 theo năm mục checklist. Mở kế hoạch chi tiết P5.4 để duyệt trước coding. Giữ E51-01 đã bỏ qua và vấn đề canh nút xử lý sau P8.”** P53-01–05 **HUMAN_ACCEPTED đủ5/5 local/synthetic**. [Checklist năm mục](#checklist-nghiệm-thu-của-khiêm--năm-mục) và [Human acceptance](../engineering/skill-usage/records/CHURCH-P5/P5.3-human-acceptance-1.json) ghi nhận quyết định sau implementation/1; technical verification/manifest/implementation/self-review gốc giữ nguyên trạng thái tại handoff, không rewrite thành nghiệm thu hoặc chạy lại runtime. Source/dependencies/dist không đổi; chưa released, không publication/deploy/real data/main DB read/init/restart3443.

P5.4 — Phiếu chi và sổ thu chi chỉ **PLANNING_ONLY trong chat**, trình P5.4-plan-r1/C54/quyền/số dư/kỳ/ASCII để duyệt trước coding. Chưa duyệt contracts, schema/API/UI hoặc implementation; chưa tạo task/engineering contract/planning journal P5.4. P5.5/P5.6 chưa mở.

Giữ **E51-01 USER_WAIVED**, original chưa recovered và không troubleshoot tiếp. Giữ **UI-POSTP8-01 USER_DEFERRED_AFTER_P8**, không sửa canh nút trong P5.4–P8. Prior UNKNOWN/NOT_RUN và giới hạn local/synthetic giữ nguyên. Trạng thái hiện hành duy nhất tại project-state; các ghi nhận phía dưới là lịch sử.

[Journal lượt ghi nhận](../engineering/skill-usage/records/CHURCH-P5/P5.3-acceptance-opening-P5.4-record-1.json). Năm dấu tick phía trên là quyết định nghiệm thu của Khiêm, không phải đo runtime mới.
