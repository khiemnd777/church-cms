# CHURCH-P2.6 — P2.6-plan-r1

## Quyền triển khai

Khiêm: “Duyệt P2.6-plan-r1 để triển khai trọn P26-01–05 local/synthetic, bàn giao nghiệm thu rồi dừng trước P3. Chưa đóng P2, commit/push, deploy hoặc dùng dữ liệu thật.” (2026-11-12). Theo roadmap P2-plan-r1; một gói nghiệm thu. Không đóng P2 hoặc mở P3; không commit/push/deploy/dữ liệu thật.

## Phạm vi đã duyệt

- P26-01 public read contracts Members/Families/Organization/Tenancy: current active+long_absent, distinct people/families, unknown gender/baptism riêng; family active có current believer, bình quân null khi mẫu số0. Visitors stages/current/new30d theo firstVisit known, latest3; conversions year theo convertedOn không đồng nhất believed; birthdays Sunday–Saturday/month/nextmonth timezone Asia/Ho_Chi_Minh/29Feb rules; area unassigned/inactive giữ thật.
- P26-02 GET /api/v1/{owner/}churches/{id}/overview, capability overview:read owner/pastor/secretary; snapshot+asOf/fresh realm/tenant/auth fences; available0 khác unavailable null khác lỗi; không client-side full dataset counting. Extended last30 visitors và explicit birthday year-month, đồng bộ list/count/cursor/export, compatible existing filters.
- P26-03 W01 từ HTML chuẩn giữ hero/4KPI/visitors+birthdays/8shortcuts/chart+care/areas+rites. Real P2 data; attendance/rites/care/finance future giữ —/Chưa khả dụng, không giả count/chart/events. Hero chỉ dữ liệu có thật/đúng source; không suy pastor từ account role. Menu icon+tên; quick icons nguồn; lookup/add active theo quyền, six future disabled. Owner church-selected + staff overview; other roles giữ hiện hành. Drilldown matching filters/IDs, refresh/empty/error/reauth, UI-STD/light-dark/responsive/keyboard/spacing.
- P26-04 qualification synthetic10churches×1000members +empty +hot5000, edge dates/status/family-history/units/duplicates across tenant; concurrency1/5/10,p50/p95/RSS/errors/explain, local no production SLA. Secretary cross-P2 workflow. Dump/restore new target DB compare all docs/indexes/validators/history/source registry/artifact bytes, revoke restored sessions/fresh login/idempotency dedupe; private files/CA, cleanup only owned resources, main DB/server3443 untouched.
- P26-05 full code/wiring trước tests, tests/regression/new browser1440/901/900/560/390 light-dark, qualification/review/acceptance matrix/docs/receipt and P2.6-r1 handoff. Source complete/verified khác human acceptance/release. Bounded defects evidenced in P2 can repair/retest; material business/scope change needs amended approval.

ASCII đã duyệt trong chat: hero→4KPI (members/families real,attendance/rites unavailable)→visitors/birthdays→8shortcuts→attendance-unavailable/care→area distribution/rites-unavailable. Không tự đóng P2 sau technical PASS; dừng chờ Khiêm nghiệm thu/closing decision, P3 chưa mở.

## Trạng thái

P2.6-r1 SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED / HUMAN_ACCEPTED theo chỉ dẫn Khiêm ngày2026-11-12. P2 CLOSED; P3 NOT_OPENED; chưa released. [Acceptance1](../engineering/skill-usage/records/CHURCH-P2/P2.6-human-acceptance-1.json).

## Bàn giao P2.6-r1 — lịch sử trước nghiệm thu

P26-01–05 SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; HUMAN_ACCEPTANCE=PENDING_REVIEW, chưa released. P2 vẫn OPEN; P3 NOT_OPENED. Không commit/push/deploy/dữ liệu thật; không init main DB hoặc restart3443. Authority phía trên ghi phê duyệt triển khai đầu gói.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P26-01 | Public read contracts và metric invariants | api/overview, members/overview, Families/Organization/Tenancy ports | Hoàn tất, API verified | — |
| P26-02 | Snapshot/auth/tenant fences, drilldown filters/list/count/cursor/export | api/app, infrastructure/database, members/dates+queries | Hoàn tất, regression verified | — |
| P26-03 | W01, menu, W02/W15/profile links, loading/error/unavailable | web/overview, UI adapters, main/church-app/members-management | Hoàn tất, Firefox verified | — |
| P26-04 | Synthetic qualification, cross-P2 HTTP workflow, restore/cleanup | scripts/p2-qualification/p2-workflow/p2-fixtures | Hoàn tất, local verified | — |
| P26-05 | Regression/review/docs/receipt/journal và handoff | tests/scripts/docs/output/p2.6 | Hoàn tất kỹ thuật; chờ Khiêm nghiệm thu | Human acceptance chưa được cấp |

### Bằng chứng

- **PASS183tests/2560assertions**,13files: full P1–P2 integration/unit trên Mongo replica set/Redis thật, DB synthetic riêng. Focused14tests/110assertions. Snapshot/relative dates/year rollover/29Feb/unknown/empty/filters/exports/cursor/roles/realm/crosschurch/revoke/suspend/concurrent catalogue và10simultaneous readers; queue scoped/bounded/releases sau failure.
- **PASS4838Firefox checks**: P26 482 +P22 540 +P24 1407 +P25 417 +accounts173 +churches88 +owner119 +sharedUI282 +P21 508 +P23 822. W01 có80geometry samples light/dark×1440/901/900/560/390, thêm50retained-style comparisons với HTML chuẩn độc lập/cùng fonts. Đã xem ảnh desktop light và mobile dark thực tế; menu active, tên/ngày tách dòng, icon shortcuts, no fakechart, drilldown/reload/export/profile/add/refresh/error/reauth/denied roles được kiểm.
- **PASS qualification24configs/720measured HTTP +240warmup,0errors**:10×1000profiles+hot5000+empty, client/server cùng process HTTPS local. p95 across configs6.22–5652.91ms; RSSpeak820MiB gồm client/server/seed trong process;0snapshot transient retries ở final measured workload sau admission. Ở concurrency10, Overview normal p95≈981ms,hot≈4073ms,import-review1000≈5653ms. Không production SLA/capacity; nhiều app replicas chưa kiểm. Explain có IXSCAN; source-identity là miss probe, không registry capacity proof.
- **PASS21workflow checks** qua owner/secretary public HTTP P21→P25→Overview. **PASS restore19collections** all documents/index ordered keys/options/validators fingerprints, artifact bytes, restored source registry chống trùng, Overview/term reconciliation; revoke15sessions, old owner/user401/fresh login/readiness PASS. Dump≈377ms/restore≈1375ms chỉ subprocess, không RTO/PITR/RPO.
- **PASS** lint(10warnings CSS nguồn có sẵn), typecheck, product/reference builds, ui:check source SHA256 `4bdc4ebdb3bcc7ccb98e675162ef9f14568c46bf9b1ad2d38c9a979cda2dc8b6`, shell/diff, dependency audit0advisories. Final bundle parity kiểm những browser receipts có checksum; P24 dùng wrapper build/mount cùng source, không có runtime bundle checksum riêng.
- **PASS cleanup/readback**0DB P26/overview test,0privateP2.6directories,0browsercontainers còn lại. Chỉ dọn UUID resources của run, không flush Redis/đụng main/shared services. Historical FAIL giữ dưới diagnostics, final PASS chọn bằng receipt.

[Receipt](../../output/p2.6/verification.json), [source manifest](../../output/p2.6/source-manifest.json), [contracts/runbook](../engineering/P2.6-overview-qualification.md), [ma trận nghiệm thu](../engineering/P2.6-acceptance-matrix.md), [qualification](../../output/p2.6/qualification.json), [restore](../../output/p2.6/restore.json).

Ảnh actual runtime P2.6-r1/local-synthetic: [W01 desktop light](../../output/p2.6/w01-complete-1440-light.png), [mobile dark](../../output/p2.6/w01-complete-390-dark.png), [W02last30](../../output/p2.6/w02-last30-1440-light.png). Ảnh HTML gốc `reference-w01-*` chỉ đối chiếu thiết kế; không là sản phẩm/runtime evidence.

### Checklist Khiêm

- [ ] W01 đúng church, current/unknown/family/visitor/birthday/area/term; future metrics —/Chưa khả dụng.
- [ ] Last30/month-nextyear→W02 đúng filter, reload/export giữ filter; tên→đúng hồ sơ, quick add→W15 hiện hành.
- [ ] Menu icon+tên/active; shortcut icon đúng, sáu future disabled; desktop/mobile light/dark có spacing.
- [ ] Secretary thấy Tổng quan; ministry_lead/treasurer không global metrics; refresh lỗi bỏ số cũ, reauth giữ church/query.
- [ ] Đọc qualification/restore/cleanup cùng giới hạn local/synthetic rồi chọn nghiệm thu hoặc yêu cầu sửa P2.6-r1. Nghiệm thu không tự đóng P2/mở P3.

### Review và giới hạn

Self-review, không reviewer độc lập. Đã sửa bounded defects được qualification phát hiện: auth-fence contention dùng admission32/tenant/process+bounded retry; budget/timeout minh bạch, writers/ledger giữ nguyên; year0099 không cộng1900; owner reload giữ query; menu active và tên/detail theo source markup. Tests cũ chỉ đổi synchronization/default/menu order theo hành vi mới đã duyệt, giữ checks quyền/nghiệp vụ/focus/spacing. Không tắt gates/TLS/auth/rate limit.

NOT_RUN: Safari/thiết bị thật/remote CI/deploy/production/failover/multi-replica load/real-data import+restore/client Excel interoperability trên dữ liệu thật. Main DB chưa init/server3443 chưa restart; evidence từ môi trường test riêng đã dọn, không cam kết instance hiện hành đã chạy source mới. CSV/XLSX/batch/expiry/registry limits P2.5 còn nguyên. Qualification archive đã xóa sau kiểm; fingerprints không là backup để dùng lại.

[Planning journal](../engineering/skill-usage/records/CHURCH-P2/P2.6-planning-1.json), [implementation journal](../engineering/skill-usage/records/CHURCH-P2/P2.6-implementation-1.json): incremental35/frontend25/testing30/review10%, ước lượng tổng100%, counters đo không có giữ null/reason. **Dừng tại P2.6-r1 chờ nghiệm thu; P2 OPEN/P3 NOT_OPENED.**


## Human review1 — ACCEPTED; đóng P2

Khiêm: **“Nghiệm thu P2.6-r1. Đóng P2. Chưa mở P3.”** (2026-11-12). P2.6-r1/P26-01–05 HUMAN ACCEPTED trong phạm vi local/synthetic đã bàn giao. **P2 CLOSED; P3 NOT_OPENED.**

[Acceptance1](../engineering/skill-usage/records/CHURCH-P2/P2.6-human-acceptance-1.json) nối implementation/1 và ghi closure P2, đủ6gói đã nghiệm thu. Receipt/source manifest/implementation journal giữ nguyên snapshot lúc bàn giao; các trạng thái pending/open trong phần bàn giao trên là lịch sử, không trạng thái hiện hành. Không chạy lại tests/runtime hoặc sửa code để ghi nhận acceptance. Giữ các NOT_RUN/giới hạn local/synthetic, chưa released; không commit/push/deploy/dữ liệu thật. Không tự mở planning/implementation P3.
