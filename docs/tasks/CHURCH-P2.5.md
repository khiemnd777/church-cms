# CHURCH-P2.5 — P2.5-plan-r1

## Quyền triển khai

Khiêm: “Duyệt `P2.5-plan-r1` để triển khai trọn **P25-01–05 local/synthetic**, bàn giao nghiệm thu rồi dừng trước **P2.6**.” (2026-11-12). Theo roadmap P2-plan-r1; một gói nghiệm thu. Không commit/push/deploy/dữ liệu thật.

## Phạm vi đã duyệt

- P25-01: CSV UTF-8 và Excel .xlsx, template, đọc file/ánh xạ cột/schema chung. 1.000 dòng/5MiB/40cột/4.096ký tự một ô; XLSX giải nén32MiB có resource bounds, từ chối formula/macro/external/encrypted. Ngày ISO hoặc Excel date đúng workbook, text bảo toàn mã/phone.
- P25-02: preview chưa ghi domain; sourceSystem+externalId unique cùng church; exact member code/link chỉ source identity, tên+DOB/phone chỉ candidates cần quyết định; không tự gộp/ghi đè. Mã nguồn/mã thành viên mâu thuẫn bị chặn. Dòng lỗi sửa file hoặc chủ động skip. Consent theo từng hồ sơ và xác nhận nguồn ở bước ghi.
- P25-03: import create active theo quy tắc hiện hành, attach active family hoặc new family_key; không suy household, tự tạo catalog, lifecycle/conversion/move/head changes. Public Members/Families/Org contracts; một transaction/lô≤100, nhóm new family cùng lô≤100. Preview/context/version/refs kiểm lại; retry UUID/receipt/registry durable; failed batch rollback, prior batches retained, kết quả partial rõ, resume remaining only.
- P25-04: W02 launch/import wizard/mapping/decisions/confirm/progress/reconciliation/resume, export theo server filters/allowlisted columns CSV/XLSX;5000rows/5MiB không truncate; stable snapshot count/hash/time. Quyền riêng owner/pastor/secretary; actor+realm+church ACL/fresh fences/no publiclinks; role revocation/suspension/expiry chặn. Import24h/export1h hard expiry, TTL cleanup; registry durable. Shared UI/light-dark/responsive/spacing/keyboard/pending/reauth.
- P25-05: full production wiring trước tests; unit/file/realMongo API/security/CAS/races/replay/unknowncommit/partial/resume/export/Unicode/resource bounds, browser1440/901/900/560/390 light-dark, regression affected P1–P24; lint/typecheck/builds/ui:check/audit/diff. Bàn giao P2.5-r1 evidence và dừng trước P2.6.

UI ASCII đã duyệt trong chat: W02 [Nhập dữ liệu][Xuất dữ liệu][+]; import Chọn file→Đối chiếu cột→Xử lý dòng→Xác nhận→Kết quả; table dòng/mã nguồn/họ tên/kết quả/quyết định, thống kê mới/đã có/đối chiếu/lỗi, protected đối soát; export filters/count/columns/format preview→create→download. CSV có formula-neutralization và cảnh báo tác động prefix; XLSX text. Không báo CSV roundtrip mọi spreadsheet. Không báo cáo P6, real migration hoặc production qualification; mẫu thật/ẩn danh chưa có.

## Trạng thái

P25-01–05/P2.5-r1 **HUMAN ACCEPTED** theo Khiêm ngày 2026-11-12; source complete/behavior verified local-synthetic, chưa released. P2.6 chỉ mở lập kế hoạch. Trạng thái PENDING_REVIEW ở bàn giao bên dưới là lịch sử tại thời điểm ghi.


## Bàn giao P2.5-r1

Đã nghiệm thu: P2.1-r2/P2.2-r1/P2.3-r1/P2.4-r3. Chờ nghiệm thu: P2.5-r1 Import/export có đối soát. Tiếp theo: P2.6 Tổng quan và qualification, chưa mở; chỉ bắt đầu khi Khiêm có chỉ dẫn riêng.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P25-01 | Mẫu/đọc CSV-XLSX, sheet/mapping/validation/resource bounds | api/data-exchange/files/contracts/review, Members.exchangePort | Hoàn tất, local verified | — |
| P25-02 | Source identity/candidates/explicit decisions/preview CAS | api/data-exchange/review/service, web/data-exchange | Hoàn tất, local verified | — |
| P25-03 | Batch atomic/group/registry/history/audit/receipt/partial/resume | Members/Families/Organization public ports, Operations, Mongo schema | Hoàn tất, real Mongo verified | — |
| P25-04 | W02 nhập/xuất/quyền/filter/snapshot/download/reauth | web/data-exchange, members-management, api/app, policy6 | Hoàn tất, Firefox verified | — |
| P25-05 | Tests/regression/review/docs/evidence | tests/scripts/docs/output/p2.5 | Hoàn tất kỹ thuật; chờ nghiệm thu | Chưa có human acceptance |

### Kết quả và bằng chứng

[Receipt](../../output/p2.5/verification.json), [contracts/runbook](../engineering/P2.5-data-exchange.md), [source manifest](../../output/p2.5/source-manifest.json).

- **PASS** `bun test --timeout 30000 tests`:169tests/2450assertions trên11files, MongoDB replica set/Redis local thật, DB riêng. Focused cuối32tests/317assertions. Input bounds/malicious ZIP/formula/1900-1904 date/cell text/reader concurrency, source re-upload/concurrent jobs/preview refs, consent/household/service-age invariants, real rollback lô/partial100→101/resume, unknown commit ack/receipt/replay, in-flight auth revocation/suspension, protected file/expiry/CAS được kiểm.
- **PASS** Firefox417P25 +540P22 +1407P24 +282sharedUI = **2646checks**. P25 có100geometry samples light/dark×1440/901/900/560/390: spacing/field gap/control size/bounds/touch/names, mapping/decisions/confirm/results/export. CSV/XLSX upload, selected sheet, real commit lost-response→reauth→explicit replay, reload-owned-session, actual protected downloads/count/phone text. Không sửa source CSS/tokens; dùng shared Choice cho checkbox.
- **PASS** lint (10warnings CSS nguồn có sẵn), typecheck, product/reference builds, ui:check, bash syntax, git diff --check, `bun audit --json`0advisories. Final product bundle hash khớp P25/P22 browser evidence; reference hash khớp shared UI; P24 wrapper build asset hashes khớp final product. Không gọi browser PASS là production proof.
- **PASS** actual export5000rows,5001 bị từ chối, query filter trước count; [boundary](../../output/p2.5/export-boundary.json). Số đo synthetic local không là SLA. [Cleanup](../../output/p2.5/cleanup.json):0DB P25 test còn lại; không main DB init hoặc restart3443. Không commit/push/deploy/dữ liệu thật.

Ảnh actual P2.5-r1/local-synthetic: [nhập hoàn tất](../../output/p2.5/w02-import-completed-1440-light.png), [xuất XLSX](../../output/p2.5/w02-export-ready-1440-light.png), [mobile dark đối chiếu](../../output/p2.5/w02-import-decision-390-dark.png). Ảnh chỉ chứng minh giao diện quan sát được; transaction/security dùng tests và receipts tương ứng.

### Checklist nghiệm thu Khiêm

- [ ] CSV và XLSX có template, chọn sheet/ánh xạ, báo lỗi và đối chiếu trước khi ghi; checkbox xác nhận nguồn không tự chọn.
- [ ] Mã nguồn đã có không tạo trùng; link không ghi đè hồ sơ; ngày/phone/tiếng Việt đúng theo dữ liệu file có thể bảo toàn.
- [ ] Kết quả created/linked/skipped/not_written rõ; lỗi lô giữ các lô trước, tiếp tục chỉ phần còn lại.
- [ ] Xuất đúng bộ lọc/cột/định dạng, đủ tập trong giới hạn, file cố định/hash/count/hết hạn; quyền mới chặn truy cập.
- [ ] Spacing/keyboard/light-dark/mobile giữ chuẩn UI; P2.4 group/icon switcher không hồi quy.

### Giới hạn và review

Self-review, không reviewer độc lập. NOT_RUN Safari/thiết bị thật/remote CI/production, chưa có mẫu chuyển đổi thật/ẩn danh được nghiệm thu. CSV prefix bảo vệ có thể đổi text và không đảm bảo roundtrip mọi spreadsheet; XLSX dùng string cells. Không whole-file atomic; ≤1000rows import,≤5000rows export/5MiB. Phiên24h/file export1h; registry giữ durable. Source/behavior verified không thay human acceptance hoặc release.

Đã sửa lỗi phân loại cả nhóm family>100, phân biệt lỗi chính sách ZIP, checksum SHA256 theo bytes và dependency advisories trong qualification. Fixture/browser synchronization sửa theo async state thực và CA riêng, không giảm assertions hoặc tắt TLS/quality gates. Historical browser diagnostics tách `output/p2.5/diagnostics`, final PASS chọn bằng receipt.

[Planning journal](../engineering/skill-usage/records/CHURCH-P2/P2.5-planning-1.json), [implementation journal](../engineering/skill-usage/records/CHURCH-P2/P2.5-implementation-1.json). Skills implementation incremental35%/frontend25%/testing30%/review10%; ước lượng tổng100%, counters đo không có giữ null với reason. **Dừng tại bàn giao P2.5-r1, chờ Khiêm nghiệm thu; P2.6 chưa mở.**

## Human review 1 — ACCEPTED; mở kế hoạch P2.6

Khiêm: “Nghiệm thu P2.5-r1, mở kế hoạch P2.6.” (2026-11-12). P2.5-r1/P25-01–05 HUMAN ACCEPTED local/synthetic. Mở P2.6 Tổng quan và kiểm chứng P2 ở bước PLANNING_ONLY; P2.6-plan-r1/contracts/acceptance/mockup chờ duyệt trước coding. Không đóng P2 hoặc mở P3; không commit/push/deploy/dữ liệu thật.

[Acceptance 1](../engineering/skill-usage/records/CHURCH-P2/P2.5-human-acceptance-1.json) liên kết implementation/1. Giữ receipt, journal, checklist và trạng thái tại thời điểm bàn giao làm lịch sử, không ghi lại usage. Acceptance không thay các giới hạn Safari/thiết bị thật/remote CI/production/real-file compatibility. Không chạy lại ứng dụng/tests để ghi nhận acceptance này.
