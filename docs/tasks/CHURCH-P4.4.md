# CHURCH-P4.4 — Lời cầu thay và quyền riêng tư

## Authority — 2026-11-14

Khiêm: **“duyệt P4.4-plan-r1, C44-01–03 và ASCII, cho phép triển khai trọn P44-01–05 local/synthetic, bàn giao rồi dừng trước P4.5.”**

Theo roadmap P0–P8/P4; trọn P44-01–05 local/synthetic, code/wiring trước tests, một bàn giao rồi dừng trước P4.5. Không publication/deploy/real data/main DB read/init/restart3443; không worktree/delegation. P4.1–P4.3 HUMAN_ACCEPTED, technical snapshots và UNKNOWN/NOT_RUN giữ nguyên.

## C44/ASCII đã duyệt

- C44-01: shared chỉ owner/pastor/secretary, pastoral chỉ account pastor hợp lệ cùng tenant, không chỉ người tạo; lead/treasurer/member chưa mở. Visibility bất biến. Pastor mặc định pastoral; owner/secretary chỉ shared. Plaintext1–2000, categories health/family/work/church/study/thanksgiving/other. Requester none/member/text, tách người gửi và actor nhập hộ; reduced snapshot không phone/address. receivedOn nullable, không tương lai HCM. Không tự relink nguồn.
- C44-02: open→shared (chỉ visibility shared), open/shared→closed/cancelled có reason+confirmation. Shared là ghi nhận đã chia sẻ, không gửi thông báo hoặc khẳng định đáp lời; active=open+shared. Không DELETE/reopen. Update/correct có reason/preview/before-after; correct được sau đóng, visibility không đổi. Source cũ invalid không chặn close/cancel hoặc sửa không đổi nguồn; source mới phải hợp lệ, có fences, không ghi Members.
- C44-03: dedicated trusted scope, backend predicate trước list/count/search/paging/detail/history/preview/replay/receipt, non-visible validID404 giống missing. Không masked rows/metadata/private counts/dedup oracle. Metadata audit có audience, F23 owner loại pastoral trước paging; không teaser. CSRF16KiB/If-Match/preview/idempotency/fresh fences, atomic request/history/audit/receipt. W01 actor-visible active count; không tự copy care/automation. Pending namespace/path dispatch rõ; private query/body không URL/storage; clear trên mất quyền/context đổi, không replay actor mới.
- Giới hạn đã duyệt: owner account provisioning/role/reset P1.3 giữ nguyên; quyền prayer theo danh tính hiện hành, không cách ly mật mã khỏi quản trị tài khoản/hạ tầng.
- ASCII: W08 hai card, anchors, list/filter/detail/forms/preview/confirm/history, một dialog/pending domain tại một thời điểm; UI-STD-r1/light/dark/responsive/keyboard. Owner/secretary không thấy hàng riêng tư. Portal/exports/Word/PDF thuộc P6; external notifications/automation/aggregate restore ngoài gói.

## WHAT — P4.4-r1

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P44-01 | Domain/snapshot/source ports/schema | api/prayers, api/members/prayers.ts | Hoàn tất nguồn; PASS local/synthetic | — |
| P44-02 | API/quyền/audit/operations/transaction | api/app.ts, authorization/audit/database | Hoàn tất nguồn; PASS local/synthetic | — |
| P44-03 | W08/W01/W13/two realms/pending/URL | web/prayers*, visitation, callers | Hoàn tất nguồn; PASS local/synthetic | — |
| P44-04 | Tests/browser/regression/self-review | tests/scripts/output/p4.4 | PASS local/synthetic; self-review | — |
| P44-05 | Workload/plans/cleanup/runbook/handoff | scripts/p44-qualification.ts, engineering docs | PASS local/synthetic | — |

## Năm mục nghiệm thu — Khiêm đã chấp nhận

- [x] Nhập/snapshot đúng, không ghi nghiệp vụ ngược Members.
- [x] Owner/secretary không thấy content/metadata pastoral qua mọi đường đọc.
- [x] States/correction/history đúng; không tự gửi/đổi scope.
- [x] Race/rollback/revoke/replay/lost response không vượt quyền/tạo trùng.
- [x] UI chuẩn/keyboard/reauth/pending, workload100/500/2000×1/5/10 và cleanup có evidence.

SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED / HUMAN_ACCEPTED đủ5/5 theo chỉ dẫn Khiêm ngày2026-11-14; NOT_RELEASED. P4.5 chỉ PLANNING_ONLY trong chat để duyệt trước coding; P4.6 chưa mở. Technical snapshots vẫn giữ PENDING_REVIEW tại thời điểm bàn giao, không sửa hồi tố.

## Bằng chứng kỹ thuật cuối

- `bun test --timeout 30000 tests`: **354PASS/0FAIL/5133assertions**,27files/149.78s, chạy riêng sau browser/workload.26P44tests gồm2unit+24integration, có boundary2000characters hiện hành. Focused26/404assertions là snapshot trước1assertion boundary bổ sung.
- `bun run test:browser:p4.4`: **707checks PASS**, Firefox/private CA, owner/pastor/secretary; source styles table/list light/dark1440/390, geometry light/dark1440/901/900/560/390; native keyboard scroll/focus; long Vietnamese preview/back; plaintext script literal; cả hidden DOM/form/query/pending purge sau role downgrade/receipt404 ở25h.
- Hồi quy ở output/p4.4: **P4.3=398, W13/P2.4=1407, W01/P2.6=484**, tổng2289PASS. Không ghi vào output/p4.3. Browser P44/P43/W01 dùng cùng bundle index SHA256.
- `bun run qualify:p4.4`: **9configs/480journeys/2646requests/82retries**; mỗi config có owner/secretary/pastor. p95~38.89–795.68ms, max2831.65ms, gồm retry/backoff.6shares/9closes/3cancellations ngoài latency.12plans; actual active=open+shared list26returned/26examined; history17examined ở mẫu đo; visible count aggregate dùng index và không claim26documents.
- Typecheck/lint/ui:check/build/build:ui/audit/diff/shell syntax **PASS**;10CSSwarnings có sẵn, bundle594.90kB vượt advisory500kB. Không đổi source UI SHA/tokens/base/patterns hoặc dependencies.
- Readback **PASS**:0owned DB/private dirs/temporary listeners3484/3485/3486/verification containers; regression-prefix DB0; shared Mongo/Redis giữ chạy.9technical artifacts/journals P4.3 nguyên SHA256. Không đọc/init main DB/probe hoặc restart3443.

[Verification/metrics/limits](../../output/p4.4/verification.json) · [source manifest](../../output/p4.4/source-manifest.json) · [browser](../../output/p4.4/browser-results.json) · [workload/plans](../../output/p4.4/qualification.json) · [readback](../../output/p4.4/readback.json) · [handoff readback](../../output/p4.4/handoff-readback.json) · [P43 preservation](../../output/p4.4/p43-evidence-preservation.json) · [attempts/diagnostics](../../output/p4.4/attempts/README.md).

Contracts/runbook: [P4.4-prayers](../engineering/P4.4-prayers.md). Code/wiring hoàn tất trước test phase; sau đó sửa defects có evidence: preview đính chính giữ closeReason cũ, expired unresolvable prayer intent purge RAM. Harness waits/locators và query-plan expectation sửa theo response/plan thực, không giảm business assertions hoặc hint query.

Journal: [implementation](../engineering/skill-usage/records/CHURCH-P4/P4.4-implementation-1.json), [self-review](../engineering/skill-usage/records/CHURCH-P4/P4.4-self-review-1.json), [planning correction](../engineering/skill-usage/records/CHURCH-P4/P4.4-planning-correction-1.json). Six implementation skills sum100%, measured counters null vì không có bộ đếm scope/phase. Self-review không là independent review.

## Giới hạn và điểm dừng

Không commit/push/deploy/real data/main DB read/init/restart3443, không worktree/delegation. Schema/indexes/optional audit audience chỉ init trên UUID DB; trước áp vào main cũ cần maintenance authority và kiểm dữ liệu/index/writers. Private chỉ account pastor hiện hành trong tenant, không chỉ creator; Owner provisioning/role/reset theo P1.3 vẫn giữ, không cách ly mật mã khỏi quản trị tài khoản/hạ tầng. Không revocation push tới tab idle/offline; request sau dùng fresh fences.

Physical/native Word/Safari/UAT/main runtime/pilot/remoteCI/production/multi-replica và independent review NOT_RUN. P3.4 prior race vẫn UNKNOWN; ca đó PASS ở suite hiện hành không chứng minh nguyên nhân lượt cũ. Aggregate restore P4 thuộc P4.6 chưa mở; workload không SLA/capacity/RPO/RTO. Stored volume clones tách khỏi public workflow/source-linked checks. Pending chỉ RAM, không tồn tại qua reload. Portal/exports/Word/PDF thuộc P6, external notifications/automation ngoài gói. Human acceptance hiện hành đã ghi ở mục sau; P4.5 chỉ planning, chưa coding.


## Nghiệm thu P4.4-r1, mở planning P4.5 — 2026-11-14

Khiêm: **“nghiệm thu P4.4-r1 và cho phép mở kế hoạch chi tiết P4.5 để duyệt trước coding.”**

P44-01–05 đủ năm mục HUMAN_ACCEPTED local/synthetic; [evaluation](../engineering/skill-usage/records/CHURCH-P4/P4.4-human-acceptance-1.json). Giữ nguyên9technical artifacts/implementation/self-review journals P4.4 và snapshot354tests/5133assertions,707browser+2289regressionchecks,9configs/480journeys/2646requests/82retries/12plans. Không chạy lại tests/runtime, không tính thêm implementation usage. Chỉ mở kế hoạch chi tiết P4.5 trong chat, chưa chốt C45/nguồn/quyền/trạng thái/contracts/ASCII hoặc coding. P4.6 chưa mở; giữ UNKNOWN/NOT_RUN/main runtime/publication boundaries.
