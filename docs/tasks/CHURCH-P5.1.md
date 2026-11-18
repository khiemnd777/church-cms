# CHURCH-P5.1 — Quỹ và quyền tài chính

Quyết định mới nhất: **P5.1-r2 HUMAN_ACCEPTED đủ P51-01–05 local/synthetic, giữ E51-01 USER_WAIVED; chỉ mở P5.2 PLANNING_ONLY.** Biên bản nghiệm thu ở cuối tài liệu; r1 INCOMPLETE/FAIL và r2 pending trong snapshot gốc giữ lịch sử.

## Authority — 2026-11-16

Khiêm: **“Duyệt `P5.1-plan-r1`, C51-01–03 và ASCII, cho phép triển khai trọn P51-01–05 local/synthetic, bàn giao rồi dừng trước P5.2.”**

Kiểu bàn giao: **Theo roadmap Church CMS/P5/P5.1**; danh mục cha [P5-plan-r1](CHURCH-P5.md). Một gói P51-01–05 xuyên domain/API/dữ liệu/UI/callers; code/wiring toàn gói trước tests, không handoff theo file. P5.2 chưa mở. Không publication/commit/push/merge/deploy/real data/main DB read/init/restart3443/worktree/delegation.

## P5.1-plan-r1 / C51-01–03 — đã duyệt

- C51-01: Mục sư xem/quản lý quỹ và cấu hình; Thủ quỹ chỉ xem quỹ/cấu hình/history; secretary/ministry_lead/member/owner không truy cập Finance. Chức vụ tổ chức không cấp account role. Quyền Finance riêng khỏi organization:read/manage. Các quyền tương lai chỉ là ranh giới đã chốt, chưa endpoint: pastor/treasurer xem thu-chi/cá nhân bằng capability tách; treasurer ghi thu/lập phiếu/khóa; proposer theo cấu hình, approver role được đề xuất nhưng cấm duyệt chính account tạo; portal self P6. Không cách ly mật mã khỏi infrastructure/credential admin.
- C51-02: Quỹ thuộc tenant, ID bất biến; tên1–100 sau NFC/trim/gộp spaces, unique tên không phân biệt hoa thường trong tenant kể cả inactive; active↔inactive có lý do và history. Không hard-delete, không seed/demo/balance/amount. Rename không viết lại snapshots giao dịch tương lai; inactive không dùng cho giao dịch mới. Server prefix search có dấu, stable nameKey+id sort; default25/max100 signed cursor, không load-all.
- C51-03: proposerRoles chọn secretary/treasurer/ministry_lead; approverRole chọn pastor/secretary/treasurer và tự có quyền đề xuất. Initial unconfigured, không tự bật defaults; POST thiết lập và PATCH If-Match. Account/tenant/auth fences trong TX, unique+CAS, data/history/safe audit/operation atomic. Idempotency replay/receipt fresh financial ACL; safeResult chỉ IDs/versions. Detailed history không đi vào general audit. GET không write Finance/config seed. Hai init chỉ một thắng. Policy18→19; chỉ quảng bá capabilities thực thi P5.1, tương lai chưa mở.

## ASCII đã duyệt

```text
CẤU HÌNH HỘI THÁNH [Tên · Mã HT]
[Cấu hình tổ chức hiện có, theo quyền]
┌ QUỸ HỘI THÁNH ────────────────────────────────┐
│ [Tìm tên quỹ…] [Đang dùng ▼]              [＋] │
│ Tên quỹ          Trạng thái        Thao tác   │
│ Quỹ A            Đang dùng         [✎] [⋯]   │
│ Quỹ B            Ngừng dùng        [↶]       │
│                              [Trước] [Tiếp]  │
└──────────────────────────────────────────────┘
┌ ĐỀ XUẤT CHI & PHÊ DUYỆT ─────────────────────┐
│ Vai trò được lập đề xuất                      │
│ [ ] Thư ký [ ] Thủ quỹ [ ] Trưởng ban          │
│ Vai trò phê duyệt [Chọn vai trò… ▼]            │
│ Vai trò duyệt được lập đề xuất.                │
│ Không duyệt đề xuất do chính mình tạo. [Lưu]   │
│ [Lịch sử thay đổi]                            │
└──────────────────────────────────────────────┘
THÊM/ĐỔI TÊN: Tên quỹ [ ] · lỗi tại field · Hủy/Lưu.
NGỪNG/KHÔI PHỤC: Tên quỹ + hậu quả/giữ history + lý do · Hủy/Xác nhận.
```

W12 compose theo capability: treasurer chỉ Finance, owner chỉ organization cũ, pastor cả hai, secretary organization readonly. W13 static policy không lộ finance config cho owner/role không quyền; pastor/treasurer có cấu hình hiện hành và history trong W12. W09/W10/W14 giving chưa mở. UI-STD-r1, shared components, menu icon+tên, light/dark/responsive/keyboard/pending/error.

## WHAT / checklist bàn giao dự kiến

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P51-01 | Finance quyền/cấu hình/version/fences | api/finance, authorization/context | Hoàn tất nguồn; local verified | — |
| P51-02 | Quỹ/query/history/TX/receipt/schema | Finance/Mongo/Operations/Audit | Hoàn tất nguồn; local verified | — |
| P51-03 | W12/W13/menu/pending/reauth/callers | web Finance/organization/church app | Hoàn tất nguồn; local verified | — |
| P51-04 | Quyền/tenant/concurrency/retry/query/UI/regression | Tests/runners synthetic | PASS local/synthetic | — |
| P51-05 | Contracts/runbook/evidence/review/state/journal | Docs và output/p5.1 | Hoàn tất với ngoại lệ được Khiêm cho phép | E51-01 USER_WAIVED; artifact gốc chưa khôi phục |

Năm mục nghiệm thu: đúng role/tenant/backend/history/receipt; lifecycle/name/ID/history; concurrency và rollback atomic; retry/revoke/reauth không auto replay; UI hai theme/responsive/keyboard và hồi quy organization. Main schema/index/Policy19 chưa áp; UNKNOWN và physical/native Word/Safari/UAT/mainruntime/pilot/remoteCI/production/multi-replica/independent review NOT_RUN giữ nguyên. Bằng chứng kỹ thuật không tự human acceptance/release.


## P5.1-r1 — bàn giao có thiếu sót evidence — 2026-11-16

**SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; overall INCOMPLETE; human acceptance PENDING_REVIEW; NOT_RELEASED.** P51-01–04 đã kiểm chứng; P51-05 chưa đạt bảo toàn evidence. Dừng trước P5.2; không tự đóng P5.1 hoặc mở gói sau.

- P51-01: policy19/capabilities/grant/config tường minh, owner deny, treasurer readonly và W13 projected theo ACL.
- P51-02:3collections/4businessindexes, quỹ NFC/name unique kể cả inactive, ID/history/CAS/transaction/receipt, no money.
- P51-03: W12 capability composition/two realms, forms/history actor snapshot/VN time, readonly UI, pending/reauth không auto replay; sửa lỗi Organization nhận nhầm Finance pending bằng namespace check. Global pending vẫn chặn mutation mới.
- P51-04:398tests/5884assertions/0FAIL;141Finance+508Organizationbrowserchecks=649;313qualificationchecks/12plans/9configs/255samples tại100/500/2000funds và1/5/10workers; p95~7.55–59.19ms. Type/lint/build/buildUI/UIcheck/audit/diff PASS;10existingCSSwarnings/bundle627.83kB advisory. Sau test-output repair, affected P4 workflow4tests/80assertions PASS; không cộng thành402unique tests.
- P51-05: contracts/runbook/evidence/source manifest/implementation+self-review journals đã lưu, **còn E51-01**. Full suite test cũ ghi đè output/p4.6/history-plans.json. Delivery owner chỉ lưu hash trước chạy nên bản gốc chưa phục hồi; baseline hash khớp acceptance P4.6.565/566protected artifacts/journals không đổi. Kết quả mới ở output/p5.1/regression/p4-history-plans.json; đường dẫn cũ chứa notice ORIGINAL_NOT_AVAILABLE, không giả thành artifact gốc. Legacy test chỉ xuất evidence opt-in CHURCH_EVIDENCE_DIR; assertions không giảm. Cần bản sao gốc khớp hash để hoàn tất gate. Self-review FAIL vì E51-01, không independent review.

[Verification/limits](../../output/p5.1/verification.json) · [source manifest](../../output/p5.1/source-manifest.json) · [browser](../../output/p5.1/browser/browser-results.json) · [qualification](../../output/p5.1/qualification/qualification.json) · [incident/expected hash](../../output/p5.1/evidence-integrity-incident.json) · [preservation FAIL](../../output/p5.1/prior-evidence-preservation.json) · [diagnostics](../../output/p5.1/diagnostics/README.md) · [contracts](../engineering/P5.1-finance.md).

[Planning/approval](../engineering/skill-usage/records/CHURCH-P5/P5.1-planning-1.json) · [human approval](../engineering/skill-usage/records/CHURCH-P5/P5.1-human-approval-1.json) · [implementation](../engineering/skill-usage/records/CHURCH-P5/P5.1-implementation-1.json) · [self-review FAIL](../engineering/skill-usage/records/CHURCH-P5/P5.1-self-review-1.json). Skills20/20/25/25/5/5 sum100 là ước tính đóng góp, countersphase null có lý do.

Cleanup:0P51DBs còn lại,0verificationcontainers/listeners3492–3493, private qualification dir đã xóa; Mongo/Redis shared được khởi động phục vụ test và còn chạy, không main read/init/restart3443. Browser screenshots là Firefox local/synthetic; không physical/Safari/UAT/production. Main Finance schema/index/Policy19 chưa áp, prior UNKNOWN/NOT_RUN giữ nguyên; workload không SLA/capacity/RPO/RTO/PITR, aggregate restore thuộc P5.6. Không publication/realdata/worktree/delegation.

### Năm mục cần Khiêm xem xét

- [ ] Quyền/config: pastor quản lý, treasurer chỉ xem, owner/roles khác deny; chưa mở quyền thu/chi.
- [ ] Quỹ: tạo/đổi tên/ngừng/khôi phục giữ ID/history; duplicate/invalid/stale bị chặn.
- [ ] W12/W13 và data/callers: đúng role, hai theme/responsive, history/reauth/đối soát.
- [ ] Kiểm chứng runtime: transaction/retry/revoke/tenant/query/regression và cleanup theo receipts.
- [ ] Hồ sơ/evidence: **chưa đạt** vì bản gốc artifact P4.6 chưa phục hồi; không đóng bằng technical PASS khác.

Ảnh thực tế P5.1-r1 (Firefox/synthetic, không acceptance/production):

![W12 Thủ quỹ chỉ xem](../../output/p5.1/browser/treasurer-config-light-1440.png)


## P5.1-r2 — hoàn tất với ngoại lệ E51-01 được cho phép — 2026-11-16

Khiêm: **“không có backup, nếu không tìm thấy thì bỏ qua issue này, không cần troubleshoot.”** Sau tìm kiếm các nguồn cục bộ không thấy bản sao đúng SHA-256, dừng tìm/troubleshoot theo chỉ dẫn. E51-01 **USER_WAIVED**, không ORIGINAL_RECOVERED và không technical preservation PASS. P51-05 hoàn tất với ngoại lệ; P51-01–04 giữ source/runtime evidence r1. **P5.1 vẫn PENDING_REVIEW của Khiêm; không tự nghiệm thu toàn gói hoặc mở P5.2.**

Đã đối chiếu: project/tmp evidence;11CodexGitcheckpointrefs/141blobcandidates theo size; scoped P4.6 chat/editor history;21Codextempcandidates;17archives ở các thư mục backup thông dụng, không có entry đích. Time Machine root local snapshots không được liệt kê; external backup chưa xác minh vì không có machine directory/OS denied. Đây là phạm vi tìm kiếm đã làm, không khẳng định không tồn tại bản sao ở mọi nơi. Ngừng toàn bộ recovery diagnostics sau chỉ dẫn mới; không tái tạo/giả số đo.

[Search/waiver](../../output/p5.1/recovery/search-and-waiver-1.json) · [disposition](../../output/p5.1/evidence-integrity-disposition-r2.json) · [verification r2](../../output/p5.1/verification-r2.json) · [human waiver](../engineering/skill-usage/records/CHURCH-P5/P5.1-E51-01-human-waiver-1.json) · [handoff2](../engineering/skill-usage/records/CHURCH-P5/P5.1-implementation-2.json) · [self-review2](../engineering/skill-usage/records/CHURCH-P5/P5.1-self-review-2.json).

Không sửa receipt/incident/self-review FAIL r1 hoặc hash kỳ vọng của P4.6. Original output/p4.6/history-plans.json vẫn là notice ORIGINAL_NOT_AVAILABLE; bản regression mới không thay artifact đã nghiệm thu. Giữ565/566protectedfiles, một file thiếu được miễn trừ theo Khiêm. Không sửa source/dependencies/dist, không chạy lại tests/runtime; xác minh lại source/dist hashes và links/journal/diff. Tái sử dụng398tests/5884assertions/649browserchecks/12plans/9configs, không tính là kết quả chạy mới. Main/physical/UNKNOWN/NOT_RUN/release boundaries giữ nguyên.

### Checklist nghiệm thu P5.1-r2

- [x] P51-01: quyền/cấu hình theo C51-01–03.
- [x] P51-02: quỹ, validation, CAS/history/transaction/retry.
- [x] P51-03: W12/W13/callers, theme/responsive/reauth/đối soát.
- [x] P51-04: bằng chứng local/synthetic và các giới hạn đã nêu.
- [x] P51-05: hồ sơ hoàn tất với **ngoại lệ E51-01 USER_WAIVED**; không yêu cầu recovery tiếp theo theo chỉ dẫn mới. Khiêm đã nghiệm thu đủ năm mục theo biên bản bên dưới.

Skills lượt search/disposition: debugging-and-error-recovery Repo70%, documentation-and-adrs Repo30%; estimate sum100, counters không đo giữ null. Không lặp lại usage implementation r1. Human waiver chỉ là ngoại lệ E51-01, không acceptance của năm mục hoặc quyền mở P5.2.


## Nghiệm thu P5.1-r2 và mở planning P5.2 — 2026-11-16

Khiêm: **“Nghiệm thu P5.1-r2 theo năm mục trong checklist, giữ ngoại lệ E51-01 đã bỏ qua. Mở kế hoạch chi tiết P5.2 để duyệt trước coding.”** P51-01–05 **HUMAN_ACCEPTED đủ5/5 local/synthetic**, bao gồm P51-05 với E51-01 USER_WAIVED. Bản gốc history-plans P4.6 chưa khôi phục, technical preservation không đổi thành PASS; không troubleshoot E51-01 tiếp. [Human acceptance evaluation](../engineering/skill-usage/records/CHURCH-P5/P5.1-human-acceptance-1.json), [acceptance record](../engineering/skill-usage/records/CHURCH-P5/P5.1-acceptance-record-1.json).

Chỉ ghi nhận acceptance và mở khảo sát/kế hoạch P5.2 trong chat. Chưa duyệt C52/contracts/quy tắc tiền/ngày/quyền/mã dâng hiến/phiếu thu/ASCII hoặc implementation P5.2; không tạo draft đã chốt. Giữ nguyên receipts/journals/incident/waiver và source/dist; copy bytes/hash98file trước ghi nhận để bảo toàn. Không chạy lại runtime/tests, không publication/realdata/mainDBread/init/restart3443/worktree/delegation. P5.3–P5.6 chưa mở; UNKNOWN/NOT_RUN giữ nguyên. Trạng thái sống duy nhất ở project-state.
