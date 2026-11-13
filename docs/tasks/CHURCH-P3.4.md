# CHURCH-P3.4 — Sổ lễ nghi

## Authority — 2026-11-13

Khiêm: “Duyệt P3.4-plan-r1, gồm C34-01–03 và ASCII. Triển khai trọn P34-01–05 local/synthetic rồi bàn giao nghiệm thu, dừng trước P3.5. Chưa commit/push, deploy hoặc dùng dữ liệu thật.”

Theo roadmap Church CMS P0–P8/P3. P34-01 domain/schema/history; P34-02 Members/import/Authorization/Operations; P34-03 W06/W14/hai realm/shared UI; P34-04 tests/browser/workload/review; P34-05 contracts/runbook/evidence/journal/handoff. Hoàn thiện toàn bộ code và wiring trước tests; một lần bàn giao rồi dừng trước P3.5. Không main DB init/restart3443 hoặc dữ liệu thật.

- C34-01: Members.baptism là thông tin hiện hành; Rites sở hữu chi tiết/snapshot/history. Cùng transaction cho mọi đường ghi liên quan, giữ dữ liệu cũ thiếu thông tin, import link không overwrite. Profile edits không sửa snapshot đã ghi nhận; hủy/đính chính preview thông tin Báp-têm sau thao tác. Không auto hoàn thành lớp/conversion/membership.
- C34-02: Báp-têm/dâng con/an táng chọn hồ sơ cùng Hội Thánh; cha mẹ/người giám hộ, phối ngẫu/người cử hành được liên kết hoặc snapshot ngoài HT. Thành hôn ít nhất một hồ sơ. Không suy quan hệ/tự tạo người/gộp hộ/đổi deceased; snapshot không đổi theo hồ sơ.
- C34-03: Owner tenant context/pastor/secretary xem/ghi/xác nhận/đính chính. Không mở cho lead/treasurer/member. Xác nhận sự kiện, không phê duyệt mục vụ. Số dự Tiệc Thánh nhập tay, null khác0; rao hôn phối ngày/trạng thái/ghi chú, không ngưỡng thần học/tuổi/lịch demo.

Nháp→Dự kiến→Đã ghi nhận; ghi trực tiếp lịch sử, đính chính/hủy có lý do/history, không xóa cứng. Ngày ghi nhận mới không tương lai; lịch sử thiếu đánh dấu. Hưởng thọ do người nhập, không tính từ an táng. Lễ kế tiếp từ bản ghi dự kiến, không lịch lặp. Payload riêng từng loại; public ports/atomic/CAS/idempotency/receipt/fences; tenant scope trước pagination.

W06 giữ sáu tab/bảng/card/nhãn/cột nguồn; Lớp dự bị nguyên luồng. Toolbar tìm người/năm/trạng thái/+Ghi lễ; detail/form/history/preview trước xác nhận hoặc đính chính; mobile tabs/table scroll theo nguồn. W14 giữ thứ tự lễ nghi. Dùng shared UI-STD-r1; chứng nhận/Word/PDF thuộc P3.5, OCR chưa mở. P3-PHYSICAL-01 vẫn NOT_RUN.

## Checklist bàn giao — đã nghiệm thu theo chỉ dẫn 2026-11-13

- [x] Năm tab thao tác đúng loại và trạng thái; dự kiến không thành sự kiện đã diễn ra.
- [x] Báp-têm nhất quán hồ sơ/import/sổ/lớp, giữ partial legacy, không bổ sung giả.
- [x] Quan hệ explicit, không auto family/deceased/attendance count.
- [x] Quyền/tenant/CAS/rollback/replay/unknown outcome kiểm bằng Mongo/Redis synthetic.
- [x] W06/W14/source/light-dark/responsive/keyboard và regression P3.1–P3.3.

Source complete, behavior verified, human accepted và release tách biệt. Live status duy nhất tại ../project-state.md.

## Bàn giao P3.4-r1 — 2026-11-13 (snapshot trước nghiệm thu)

**P34-01–05 SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; HUMAN_ACCEPTANCE=PENDING_REVIEW; chưa released.** C34-01–03/ASCII được triển khai trọn gói; dừng trước P3.5. Checklist phía trên đã được chấp nhận theo chỉ dẫn mới; trạng thái pending trong snapshot này ghi thời điểm bàn giao.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P34-01 | Năm loại lễ, schema/index, trạng thái, snapshot/history | api/rites/models.ts, schema.ts, validation.ts | Hoàn tất local/synthetic | — |
| P34-02 | Canonical baptism, public ports, transaction/fences/CAS/preview/receipt, import compatibility | api/rites/service.ts, api/members/rites.ts, Members/Authorization/Operations/app | Hoàn tất local/synthetic | — |
| P34-03 | W06 năm tab, W14, hai realm, shared UI, focus/pending recovery | web/rites*, member-rites.tsx, PrepClasses/root callers | Hoàn tất; browser PASS | — |
| P34-04 | Integration, regression, browser/source/layout, workload và self-review | tests/scripts, output/p3.4 | PASS local/synthetic | Không chứng minh mọi max mixed payload hoặc production capacity |
| P34-05 | Contracts/runbook/authority/receipts/journal/current state/handoff | Docs, [journal](../engineering/skill-usage/records/CHURCH-P3/P3.4-implementation-1.json) | Hoàn tất; chờ human acceptance | — |
| P3-PHYSICAL-01 | Camera điện thoại/bản in giấy | [Note](CHURCH-P3.md#p3-physical-verification-note) | NOT_RUN | Cần bằng chứng thực tế và Khiêm xác nhận |

### Bằng chứng và phạm vi

- `bun test tests`: **238 PASS /0FAIL /3366 assertions /17files**, gồm17tests Rites. Mongo/Redis thực local: năm payloads/state/legacy null; canonical profile/import; lớp đọc trạng thái đúng; reference snapshots; source changes invalidate preview; hủy có quyết định canonical rõ; explicit parents/external spouse/rao hôn phối; no automatic family/deceased/attendance; role/tenant/CSRF/cursor/receipt scope; CAS cạnh tranh và race profile–Báp-têm; rollback member+rite+history khi audit lỗi; true unknown-commit ack và replay đúng một lần; in-flight revoke; bounds20parents/100announcements/DB validators/unique index.
- **3665 Firefox checks PASS** trên cùng bundle index SHA256 `0287edd5eda6a0e4f793e389b2925ee33e51952a22115a7b21aa1bcfa862ec3f`:768P34+736PrepClasses+541Members+417DataExchange+785Attendance+418QR. Evidence từng suite ở output/p3.4/regression-*; giữ các receipts P3.1–P3.3 cũ nguyên trạng.20source parity samples cho5tab×light/dark×1440/390;120layout samples ở1440/901/900/560/390; toolbar gap18px. Table scroll/fields/keyboard selected-tab focus/history Escape focus/preview-back form/confirmation/W06↔W14/owner reauth/secretary write/mất HTTPS response sau commit thật và same-intent replay đều có checks. Đã xem desktop light/mobile dark screenshots.
- HTTPS qualification: **9configs /540completed measured +90warmup /2731measured HTTPattempts (2700HTTP200+31contention409)**. 100/500/2000records×concurrency1/5/10;5steps/list-detail-preview-commit-latestHistory, bounded retries cùng intent. p95 **42.39–651.75ms** local. Direct fixtures cho danh sách lớn; public creation kiểm riêng; rites_page được planner chọn, <=26docs examined/returned26, histories210/church sau210warmup+measuredcommands. Workload chỉ communion, một process API, máy cũng chạy verification; không full mixed max-payload capacity hoặc SLA/production/multi-replica.
- Lint/typecheck/build/build:ui/ui:check/audit/bash syntax/git diff --check PASS.10warningsCSSnguồn giữ nguyên. Không dependencies mới. Source HTML/tokens/base/patterns không đổi.
- [Receipt](../../output/p3.4/verification.json), [source manifest](../../output/p3.4/source-manifest.json), [contracts](../engineering/P3.4-rites.md), [browser](../../output/p3.4/browser-results.json), [qualification](../../output/p3.4/qualification.json), [cleanup readback](../../output/p3.4/cleanup-readback.json).0syntheticDB/0privateP34directories/0verificationcontainers còn lại; Docker chỉ còn Mongo/Redis hiện hữu. Member/DataExchange browser runners không có cleanup JSON riêng nhưng drop trong finally; inventory sau toàn bộ suites xác nhận0DBprefix liên quan.

### Self-review và sửa trong verification

Self-review, không reviewer độc lập. Đã rà ownership/callback trong cùng transaction/no cross-module writes, snapshots/canonical fact, state/subject/kind guards, actor/tenant/resource/action fences trước replay/receipt, validation/cursor/query bounds, rollback/unknown outcomes và caller wiring. Không còn finding chặn trong scope đã duyệt.

Sửa semantic table bên trong TableFrame, trả focus khi đổi tab/đóng modal, đặt pending recovery controls trong modal. Script parity so cùng trạng thái trung tính để không so keyboard focus radius6px với trạng thái không focus; kiểm focus riêng giữ nguyên. Mô phỏng mất phản hồi chuyển tiếp HTTPS bằng private CA tin cậy, bỏ Host chứa port gây sai SNI và header byte-length do transport tự tính; không bypass TLS. Regression P3.3 đổi duy nhất kỳ vọng nghiệp vụ tab Báp-têm disabled→enabled theo approval P3.4 (và geometry chấp nhận tab cuộn dù enabled); không giảm kiểm tra lớp. Test fault injection kỳ vọng503/DEPENDENCY_UNAVAILABLE đúng contract lỗi hạ tầng hiện hữu, giữ assertions rollback. Artifact failure trước khi sửa nằm trong output/p3.4/attempts, không dùng làm proof cuối.

### Điểm dừng

Chờ Khiêm nghiệm thu **P3.4-r1 theo5mục checklist**. P3.5/P3.6 chưa mở. Không commit/push/deploy/real data/main DB init/restart3443. Main runtime/Safari/UAT/remoteCI/production/multi-replica/physical camera/paper NOT_RUN. Nhắc lại P3-PHYSICAL-01 ở P3.5/P3.6 và trước UAT/pilot/release.

## Nghiệm thu P3.4-r1 và mở planning P3.5 — 2026-11-13

Khiêm: **“Nghiệm thu P3.4-r1 theo 5 mục trong checklist. Mở P3.5.”** P34-01–05/C34-01–03/ASCII **HUMAN_ACCEPTANCE=ACCEPTED local/synthetic**, đủ năm mục checklist. [Evaluation](../engineering/skill-usage/records/CHURCH-P3/P3.4-human-acceptance-1.json) liên kết implementation1; receipts/source manifest/journal giữ nguyên, không chạy lại tests/runtime hoặc suy thêm proof production/physical. Điểm dừng tại bàn giao phía trên là lịch sử trước chỉ dẫn này.

P3.5 Chứng nhận và bản in mở **PLANNING_ONLY** để trình kế hoạch/ASCII trong chat, duyệt trước coding theo roadmap; chưa tạo thiết kế đã chốt hoặc implementation P3.5. P3.6 chưa mở. Camera điện thoại thật/giấy thật vẫn NOT_RUN theo [note](CHURCH-P3.md#p3-physical-verification-note); cần rà lại trong P3.5/P3.6 và trước UAT/pilot/release. Không commit/push/deploy/real data/main DB init/restart3443. Live state duy nhất tại project-state.
