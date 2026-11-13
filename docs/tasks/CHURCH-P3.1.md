# CHURCH-P3.1 — Buổi nhóm và điểm danh tay

## Quyền hiện hành

Khiêm: **“Duyệt P3.1-plan-r1, gồm ba lựa chọn ở mục 3. Triển khai trọn P31-01–05 local/synthetic, bàn giao nghiệm thu rồi dừng trước P3.2. Chưa commit/push, deploy hoặc dùng dữ liệu thật.”** (2026-11-12).

Theo roadmap [P3-plan-r1](CHURCH-P3.md), một gói nghiệm thu gồm P31-01 domain/schema/public ports; P31-02 routes/grants/ledger/audit; P31-03 W05 và hai realm; P31-04 tests/concurrency/rendered/measurement; P31-05 contracts/runbook/evidence/handoff. Hoàn tất production code/wiring rồi mới viết/cập nhật và chạy tests. Dừng trước P3.2; chưa human accepted/released.

## Quy tắc đã duyệt

- Owner trong church đang chọn/pastor/secretary quản lý toàn bộ; lead chỉ reduced historical roster và điểm danh buổi thuộc active unit đang được giao; treasurer/member deny. Actor/tenant/action/resource và quyền replay được kiểm tại transaction.
- Nháp → Đang mở → Đã chốt; mở lại cần lý do, giữ kết quả và chốt lại. Không ghi vào buổi tương lai; không unique theo ngày/tên hoặc lịch lặp.
- Danh sách ban đầu có believer/visitor current (active/long_absent), không ngưỡng ba tuổi. Xem trước/token5phút; open kiểm lại fingerprint và lưu snapshot atomic. Ngày lùi dùng nguồn hiện tại, không tái dựng quá khứ.
- Giới hạn r1 tối đa2.000dòng/buổi kể cả dòng đã loại, không cắt ngầm. Trưởng ban được xem snapshot rút gọn của buổi thuộc đơn vị hiện được giao, kể cả người đã chuyển ban; mất scope/đơn vị inactive chặn cả receipt.
- Chưa tick khi mở = chưa ghi nhận; sau chốt = vắng. Summary không phụ thuộc q/page. Bổ sung/loại có lý do và history; không xóa dòng, không tự đổi snapshot sau sửa hồ sơ/tổ chức.
- Tick explicit present boolean + If-Match dòng + generation buổi; close/reset/roster changes CAS toàn buổi. Reset chỉ manager, xác nhận số hiện diện/lý do, giữ roster/history. Mutation/counters/history/audit/ledger atomic.
- UI-STD-r1/W05/ASCII đã duyệt; menu icon+tên, reauth/unknown intent giữ trong memory, đối soát tường minh. Không QR/camera, offline/self portal, lớp/lễ nghi, thống kê P3.6 hoặc main DB upgrade/restart.

Contracts/runbook: [P3.1-attendance](../engineering/P3.1-attendance.md). Chỉ local/synthetic; tests không thay human acceptance. Current state duy nhất: [project-state](../project-state.md).

## Tiến trình

Production code và hai realm đã nối; typecheck/product build/reference build/ui:check PASS. Integration P3.1 PASS11tests/183assertions với Mongo replica set/Redis thật; browser/full regression/measurement/review còn đang thực hiện. Đây là checkpoint, chưa là biên bản bàn giao đủ nghiệm thu.

## Bàn giao P3.1-r1 — 2026-11-12

**P31-01–05 SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; HUMAN_ACCEPTANCE=PENDING_REVIEW; chưa released.** Dừng trước P3.2, không commit/push/deploy/dữ liệu thật hoặc init main DB/restart3443. Biên bản phía trên về tiến trình là checkpoint trước bàn giao này.

Bức tranh: P2 đã nghiệm thu/đóng; P3.1 Điểm danh tay chờ nghiệm thu; kế tiếp P3.2 Thẻ/QR khi được phép; sau đó P3.3 Lớp dự bị → P3.4 Sổ lễ nghi → P3.5 Chứng nhận → P3.6 Tổng hợp/kiểm chứng.

![W05 desktop light — P3.1-r1, local synthetic](../../output/p3.1/attendance-open-1440-light.png)

Nguồn: Firefox/private CA, W05/UI-STD-r1 và bundle thực tế. Đã xem ảnh desktop light/mobile dark/modal reset. Source-pattern parity4samples, geometry110samples gồm width dòng/gap12/actions và field gap5. Không phải physical-device/Safari/production hoặc human approval.

| WHAT | Kết quả | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P31-01 | Models/validators/index/counters; bounded public Members/Organization ports | api/attendance, api/members/attendance, Organization | Hoàn tất nguồn/local verified | — |
| P31-02 | Hai realm, policy8/grants/resource-scoped replay/receipt, atomic history/audit | app/authorization/operations | Hoàn tất nguồn/local verified | — |
| P31-03 | W05/forms/preview/history/reset/reauth/pending, menu thật | web/attendance*, shared adapters, owner/church callers | Hoàn tất nguồn/rendered verified | — |
| P31-04 | Integration/concurrency/fault/capacity, Firefox/source parity/measurement | tests/integration/attendance, scripts/browser-attendance/p31-qualification | Hoàn tất checks local/synthetic | — |
| P31-05 | Contracts/runbook/receipt/journal/handoff/state | docs + output/p3.1 | Hoàn tất tài liệu | — |

### Bằng chứng kỹ thuật

- **195tests/2756assertions PASS**,14files real Mongo replica set/Redis; P3.1 riêng12tests/196assertions. AC01 default roster/lifecycle; AC02 stale/expired preview/cap2001/future date; AC03 paging/scoped counts/no PII/snapshot; AC04 simultaneous independent rows+same-row CAS; AC05 reset/add/exclude/reinclude; AC06 roles/realms/unit scope/history/receipt; AC07 former manager deny; AC08 rollback all writes; AC09 real committed unknown ack/replay; AC10 revoke while snapshot in flight; AC11 strict transport/schema; AC12 full2000present reset. Không mock transaction/database.
- **1359Firefox checks PASS**:785P3.1+282shared UI+119navigation+173accounts. Light/dark1440/901/900/560/390; source parity4samples, geometry110samples. Real-commit response dropped rồi explicit same-key replay, no double count; reauth giữ sessionId, lead own-unit unmark, treasurer deny. Role-limited/cross-tenant/receipt proof bổ sung bằng integration.
- **9configs/540measured intents+90warmups PASS** qua HTTPS loopback;100/500/2000profiles ×1/5/10operators. 540completed intents,765HTTP attempts gồm540status200+225status409 tranh chấp, bounded exact-intent retries. p95=11.81–244.87ms gồm retries. Bộ đo tự retry same intent; không tuyên bố UI tự retry hoặc0HTTPerrors. Roster explain chọn attendance_roster. Single process/local replica, không production SLA/capacity.
- Lint PASS với10warningsCSS nguồn có sẵn; typecheck/product+reference builds/ui:check/shell syntax/diff PASS. Audit không phát hiện vulnerabilities. Browser receipt bundle hash khớp final dist. Readback0P31DB/0private directories/0browser containers còn lại; main DB/volumes/server không init/restart.
- Self-review (không independent reviewer). Sửa trong test phase: test AccountDTO shape, private-CA forwarding, tên DB benchmark dưới63ký tự; không giảm assertions/quality gates. Ảnh thực tế dẫn đến width dòng đồng đều/gap actions12 và geometry regression. Menu test cập nhật đúng9items vì Attendance đã được mở; AccessContext availability copy cập nhật tương ứng. Các failures ban đầu giữ trong chronology này, receipt cuối không dùng chúng làm PASS.

[Receipt](../../output/p3.1/verification.json), [integration log](../../output/p3.1/integration.log), [browser](../../output/p3.1/browser-results.json), [qualification](../../output/p3.1/qualification.json), [cleanup](../../output/p3.1/cleanup-readback.json), [source manifest](../../output/p3.1/source-manifest.json). Output Git-ignored, chỉ có tại workspace. [Planning journal](../engineering/skill-usage/records/CHURCH-P3/P3.1-planning-1.json), [implementation journal](../engineering/skill-usage/records/CHURCH-P3/P3.1-implementation-1.json). Estimates implementation: incremental30/frontend25/testing25/review10/security5/docs5%, counters tài nguyên theo skill null/reason.

### Checklist nghiệm thu của Khiêm

- [ ] Xem W05 desktop/mobile và form/preview; xác nhận đúng style/spacing và menu icon+tên.
- [ ] Mở buổi có believer/visitor/child; tick rồi chốt thấy vắng đúng, mở lại cần lý do và giữ kết quả.
- [ ] Bổ sung/loại và Làm lại có xác nhận/lý do/history; bộ đếm không đổi theo tìm kiếm/trang.
- [ ] Kiểm receipt quyền/concurrency/replay/snapshot và giới hạn local/synthetic trước chọn nghiệm thu hoặc yêu cầu sửa.

**NOT_RUN:** Safari/physical devices/camera/remote CI/production/real data/multi-replica/SLA/main-runtime upgrade. Main instance hiện hành chưa được restart hoặc kiểm source P3.1; môi trường synthetic dùng tạo evidence đã dọn. QR/P3.2 chưa mở; restore xuyên P3 ở P3.6. Technical PASS không tự nghiệm thu hoặc phát hành.

## Human review1 — ACCEPTED; mở planning P3.2 — 2026-11-13

Khiêm: **“Nghiệm thu P3.1-r1, mở P3.2”**. P3.1-r1/P31-01–05 **HUMAN ACCEPTED** trong phạm vi local/synthetic đã bàn giao. [Acceptance1](../engineering/skill-usage/records/CHURCH-P3/P3.1-human-acceptance-1.json) nối implementation/1; không ghi lại usage implementation hoặc sửa snapshot technical receipt/source manifest.

P3.2 Thẻ tín hữu và quét QR được mở **PLANNING_ONLY** theo P3-plan-r1. Kế hoạch contracts/quy tắc/ASCII UI trình trong chat để duyệt trước coding; dự thảo chưa duyệt không lưu thành đặc tả đã chốt. Chỉ dẫn này thay điểm dừng chưa mở P3.2 tại bàn giao trước đó; không là quyền implementation P3.2/P3.3 hoặc Git publication/deploy/dữ liệu thật.

Các con số/tests/ảnh/NOT_RUN phía trên là bằng chứng tại bàn giao trước nghiệm thu, không phải lần chạy mới. Giữ giới hạn physical/Safari/remoteCI/production/multi-replica/main runtime; chưa released. Bước ghi nhận chỉ sửa hồ sơ, không sửa ứng dụng/init DB/restart dịch vụ/chạy lại tests. Trạng thái sống duy nhất tại project-state.
