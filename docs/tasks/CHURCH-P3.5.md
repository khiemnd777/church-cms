# CHURCH-P3.5 — Chứng nhận và bản in

## Authority — 2026-11-13

Khiêm: “duyệt P3.5-plan-r1, C35-01–03 và ASCII, cho triển khai trọn P35-01–05 local/synthetic rồi bàn giao, dừng trước P3.6.”

Theo roadmap P0–P8/P3; hoàn thiện toàn bộ code/wiring trước tests. P35-01 bốn mẫu/snapshot/version/public contracts; P35-02 DOCX/PDF/print/fonts/artifacts/download; P35-03 W11/W17/W06/W14/hai realm; P35-04 integration/files/render/browser/regression/workload; P35-05 contracts/runbook/journal/evidence/handoff. Một lần bàn giao rồi dừng trước P3.6. Không commit/push/deploy/real data/main DB init/restart3443.

- C35-01: Bốn mẫu nội bộ r1 theo W17 (GCN Báp-têm, Dâng con, Chứng thư Thành hôn, Đơn xin chịu Báp-têm), luôn đánh dấu MẪU KIỂM THỬ — KHÔNG DÙNG THỰC TẾ. Không hardcode hệ phái/địa hạt hoặc dùng district hành chính, không tên ký demo. Nội dung xác nhận đức tin cần xác nhận rõ. Cha mẹ/guardian explicit; rao theo sự kiện nhập, không tự3Chúa nhật/quy định. Đơn để trống lời làm chứng/ý kiến/chữ ký để điền/ký ngoài hệ thống; không thu thập lời làm chứng/ảnh ký/con dấu/e-sign.
- C35-02: Certificates sở hữu snapshots/versions/artifacts/history, đọc public Members/Rites/PrepClasses/Tenancy. Dữ kiện nguồn biết được khóa; bổ sung chỗ thiếu có lý do/source/actor, không ghi ngược. Lễ phải recorded, ngày/nơi canonical Báp-têm mâu thuẫn phải đối soát. Nháp→Đã chốt→Đã thay thế/Đã thu hồi, không overwrite bản cũ; mã hệ thống không là số chứng nhận nghiệp vụ. Preview source/version/template hash, fresh permissions/CAS/idempotency/atomic metadata+artifacts/history/audit/receipt. Owner tenant context/pastor/secretary; không mở lead/treasurer/member hoặc đổi classes:interview.
- C35-03: Pin/audit docx và PDFKit; fonts Be Vietnam Pro/Lora offline đủ glyph tiếng Việt; chung snapshot/model nội dung, A4/phân trang/vùng ký không cắt, bounded timeout/pages/bytes/concurrency. DOCX editable, PDF fixed. Tải session/tenant/resource fresh, không publicURL/converter ngoài. Render ngoài transaction, chốt chỉ khi đủ artifacts và nguồn/quyền còn khớp. LibreOfficeDev/Poppler local kiểm file/render, không thay Microsoft Word/giấy thật.

UI: W11 tám ô đúng thứ tự nguồn, bốn mẫu mở, bốn ô còn lại chưa mở. W17 chọn mẫu/người/lễ/phiên bản, đối chiếu nguồn/bổ sung/người ký, A4 preview/pagecontrols, confirmation/Lưu nháp/Chốt/Word/PDF/In/Lịch sử. Shared UI-STD-r1/light-dark/responsive/keyboard/focus/reauth/pending intent. W06 print icon; W14 liên kết bản đã chốt.

## Checklist nghiệm thu — Khiêm chấp nhận đủ năm mục ngày2026-11-13

- [x] Bốn mẫu chọn đúng nguồn, thiếu/khác biệt rõ, không dữ liệu demo tự điền.
- [x] Preview/DOCX/PDF cùng nội dung/phiên bản, tiếng Việt/phân trang/vùng ký đầy đủ.
- [x] Chốt/thay thế/thu hồi giữ lịch sử, nguồn/mẫu đổi không sửa bản cũ.
- [x] Quyền/tenant/source changes/concurrency/rollback/render failures/replay được kiểm chứng.
- [x] W06/W11/W14/W17 hai realm và regression P3.1–P3.4 PASS.

Camera điện thoại/giấy thật P3-PHYSICAL-01 vẫn NOT_RUN; Microsoft Word thật/Safari/UAT/production/multi-replica/remoteCI chưa chứng minh. Live status duy nhất tại ../project-state.md.

## Bàn giao P3.5-r1 — local/synthetic, 2026-11-13

**SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; HUMAN_ACCEPTANCE=PENDING_REVIEW; NOT_RELEASED.** P35-01–05 hoàn tất, C35-01–03/ASCII giữ phạm vi đã duyệt; dừng trước P3.6. Không commit/push/deploy/real data/main DB init/restart3443. [Contracts/runbook](../engineering/P3.5-certificates.md), [receipt](../../output/p3.5/verification.json), [source manifest](../../output/p3.5/source-manifest.json), [journal usage](../engineering/skill-usage/records/CHURCH-P3/P3.5-implementation-1.json), [kết quả xác minh liên kết](../engineering/skill-usage/records/CHURCH-P3/P3.5-implementation-verification-1.json). Usage gốc lưu khi đang xác minh; completion event chỉ cập nhật kết quả, không tính thêm skill usage.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P35-01 | Bốn mẫu/snapshot/version/public ports/quyền | api/certificates, Members/Rites/PrepClasses/Tenancy ports | Hoàn tất; kiểm chứng local/synthetic | — |
| P35-02 | DOCX/PDF/A4/fonts/artifacts/print/download | render/process/fonts/printing, protected routes | Hoàn tất; file thật và render PASS | Native Word/giấy thật NOT_RUN |
| P35-03 | W11/W17 + W06/W14/hai realm | CertificatesView/Forms/MemberCertificates/shared UI | Hoàn tất; Firefox PASS | Safari/điện thoại thật NOT_RUN |
| P35-04 | Integration/files/render/browser/regression/workload/review | tests/scripts/output/p3.5 | PASS; self-review | Không reviewer độc lập; không production/SLA |
| P35-05 | Contracts/runbook/journal/evidence/state/bàn giao | docs và output/p3.5 | Hoàn tất; chờ Khiêm nghiệm thu | P3.6 chưa mở |

### Bằng chứng kỹ thuật

- `bun test tests`: **253 PASS / 0 FAIL / 3.638 assertions**, 18 files, 137,26s; có 15 ca Certificates. Nguồn thật đi qua API/Mongo/Redis với DB synthetic riêng. Guard nguồn XML-invalid được kiểm qua public Member API rồi prepare, không stage/issue file lỗi.
- `bun run test:browser:p3.5`: **417 PASS** Firefox/private CA; bốn mẫu, Word/PDF downloads, authenticated print, W06/W14 links, hai realm, source style parity W11, light/dark ở1440/901/900/560/390, focus/keyboard/reauth và response-loss thật sau commit→same intent recovery→một edition.
- Regression browser: Attendance785, QR419, PrepClasses736, Rites768, Members541, DataExchange417: **3.666 PASS**; evidence mới dưới output/p3.5/regression, giữ receipts P3.1–P3.4.
- `scripts/p35-documents-check.py` bằng bundled Python/Poppler/LibreOfficeDev: **10 tài liệu/12 trang PASS** gồm bốn mẫu và stress20guardian/tên người ký dài; A4, mọi model lines/reference/watermark/footer, pagecount và vùng ký trang cuối. Đã xem12PNG hiện hành: [visual record](../../output/p3.5/visual-review.json). Đây không là Microsoft Word hoặc giấy thật.
- `bun run qualify:p3.5`:6cấu hình initial10/25/50editions thật × concurrency1/2, 1warmup +10journeys/worker: **90 measured journeys**, source/population tạo qua public API, **3 contention409 retries** cùng key, latency tính cả retry. p95 prepare269,44–461,62ms; issue37,12–176,24ms; download đôi29,10–96,77ms; không SLA. Indexed plans cho tenant/member/drafts, bounded list không binaries. [Workload](../../output/p3.5/workload.json).
- Typecheck/lint/UIcheck/build/build:ui/audit/diff-check PASS; lint còn10warnings CSS nguồn có sẵn, app build có chunk509,05kB warning. Không hạ gates/tắt assertions.
- Self-review đã sửa PDF footer sinh trang phụ, modal history làm mất focus trigger và nguồn có ký tự XML-invalid. Full-suite quan sát Bun1.3.1 crash tại repeated Worker boundary; đã thay bằng disposable child process bounded và full suite PASS. Không kết luận nguyên nhân internals Bun. [Review](../../output/p3.5/review.json).
- Readback0DB synthetic P3.5/private CA dirs/renderer jobs/browser containers; chỉ dọn1DB P3.5 sót từ crash. Không đụng main DB. [Cleanup](../../output/p3.5/cleanup-readback.json).

### File mẫu để Khiêm xem

| Mẫu | PDF cố định | DOCX chỉnh sửa |
|---|---|---|
| Báp-têm | [PDF](../../output/p3.5/documents/baptism.pdf) | [DOCX](../../output/p3.5/documents/baptism.docx) |
| Dâng con | [PDF](../../output/p3.5/documents/dedication.pdf) | [DOCX](../../output/p3.5/documents/dedication.docx) |
| Thành hôn | [PDF](../../output/p3.5/documents/marriage.pdf) | [DOCX](../../output/p3.5/documents/marriage.docx) |
| Đơn xin | [PDF](../../output/p3.5/documents/application.pdf) | [DOCX](../../output/p3.5/documents/application.docx) |

Ảnh runtime: [W11 desktop](../../output/p3.5/catalog-1440-light.png), [W17 mobile dark](../../output/p3.5/baptism-preview-390-dark.png). Nguồn font/hash/OFL tại api/certificates/fonts; không dữ liệu thật hoặc chữ ký thật. Runtime chính3443 chưa restart; browser tests đã dùng app/DB synthetic riêng và cleanup.

### Phần chưa xác minh và điểm dừng

**P3-PHYSICAL-01 vẫn NOT_RUN:** camera điện thoại thật và máy in/giấy thật; cần thiết bị/browser mục tiêu + trusted HTTPS, printer/giấy và quét QR trên giấy khi có, ghi ngày/thiết bị/môi trường/kết quả/bằng chứng và Khiêm xác nhận. Nhắc tại nghiệm thu P3.5/P3.6 và trước UAT/pilot/release. Preview/PDF/LibreOffice/browser automation không thay bằng chứng vật lý. Native Word/Safari/UAT/production/multi-replica/remoteCI cũng NOT_RUN. 15s timeout/5MiB exact saturation source-reviewed, chưa stress đúng hai cực trị đó; đã runtime test10page rejection/2renderer/8preview/expiry/actor binding và fail/rollback/replay/source-role races.

Tại thời điểm bàn giao r1, checklist năm mục chờ Khiêm nghiệm thu; quyết định mới được ghi ở mục human review bên dưới. Đã nghiệm thu P3.1 Attendance/P3.2CardsQR/P3.3PrepClasses/P3.4Rites; chờ P3.5Certificates; tiếp theo P3.6Tổng hợp/kiểm chứng **CHƯA MỞ**. Chỉ mở khi Khiêm nghiệm thu và cho phép rõ. Bước tiếp theo đề nghị: nghiệm thu P3.5-r1 theo năm mục hoặc chỉ ra mục cần sửa trong cùng scope.

## Human review1 — ACCEPTED, mở planning P3.6 — 2026-11-13

Khiêm: **“Nghiệm thu P3.5-r1 theo năm mục trên; mở P3.6.”** P35-01–05/P3.5-r1 HUMAN ACCEPTED đủ năm mục checklist local/synthetic; chưa released. [Evaluation](../engineering/skill-usage/records/CHURCH-P3/P3.5-human-acceptance-1.json). Snapshot technical receipt/source manifest/implementation journal và verification completion giữ nguyên; các trạng thái pending trong mục bàn giao là lịch sử. Không chạy lại tests/runtime trong bước ghi nhận.

P3.6 Tổng hợp và kiểm chứng chỉ **PLANNING_ONLY**: khảo sát source và trình P3.6-plan-r1/định nghĩa số liệu/contracts/ASCII trong chat để duyệt trước coding. Chưa tạo đặc tả kỹ thuật hoặc planning journal P3.6 chưa duyệt. Không tự đóng P3/mở P4/publication/deploy/real data/main DB init/restart3443. Camera điện thoại/bản giấy P3-PHYSICAL-01 và native Word vẫn NOT_RUN; cần bằng chứng thực tế cùng Khiêm xác nhận. Live state duy nhất tại ../project-state.md.
