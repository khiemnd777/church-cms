# CHURCH-P3.6 — Tổng hợp và kiểm chứng

## Authority — 2026-11-13

Khiêm: “Duyệt P3.6-plan-r1, C36-01–03 và ASCII để triển khai trọn P36-01–05 local/synthetic rồi bàn giao; chưa đóng P3/mở P4, chưa commit/push/deploy/dữ liệu thật.”

Theo roadmap P0–P8/P3. Một lần bàn giao; code/wiring hoàn tất trước tests. Không main DB init/restart3443, đóng P3/mở P4. C36-01: reportingKind general/sunday_reference, mặc định legacy general, tối đa một church/Sunday reference, church scope/non-prep, reason+confirmation/CAS/idempotency/history. C36-02:12calendarSundays; closed snapshot denominators/all ages/types, missing khác0, TB4/delta cần đủ coverage; absent3 đúng3calendarCN, W04bốn buổi riêng closed/12tuần theo unitId, annual4rite kinds recorded/known dates, recent5/courses factual; W02list/count/cursor/export nhất quán. C36-03: public read ports/snapshot/fresh auth,9workloadconfigs/480journeys, quiesced dump/restore DB UUID mới/index/validator/binaries, restored auth/temporary proofs invalidated. Physical/native Word/Safari/UAT/production NOT_RUN giữ riêng.

| Gói | Nội dung |
|---|---|
| P36-01 | Metadata/reference, metric definitions và public read ports |
| P36-02 | W01/W02/W14/W04 và W05 metadata UI/data wiring hai realm |
| P36-03 | Cross-P3 workflow, permissions, races/revoke/replay/regression |
| P36-04 | Workload/explain/restore/cleanup synthetic |
| P36-05 | Contracts/runbook/evidence/journal/state/handoff |

## Checklist nghiệm thu

- [x] Công thức/kỳ/snapshot đúng;0/thiếu dữ liệu/không áp dụng phân biệt rõ.
- [x] W01/W02/W14/W04 drilldown đúng nguồn, UI-STD-r1/hai realm.
- [x] Workflow điểm danh/QR/lớp/lễ/chứng nhận đối soát được.
- [x] Quyền/concurrency/revoke/rollback/replay/regression đạt.
- [x] Workload/restore/cleanup có bằng chứng và giới hạn NOT_RUN rõ.

P3-PHYSICAL-01 Camera thật/bản giấy thật và native Word vẫn NOT_RUN; chỉ đóng với bằng chứng thực tế/Khiêm xác nhận. Live state duy nhất ../project-state.md.

## Bàn giao P3.6-r1 — 2026-11-13

**Snapshot tại thời điểm bàn giao: SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED / HUMAN_ACCEPTANCE=PENDING_REVIEW; chưa released.** P36-01–05 hoàn tất trong scope đã duyệt. [Contracts/công thức/runbook](../engineering/P3.6-reporting.md), [receipt](../../output/p3.6/verification.json), [manifest](../../output/p3.6/source-manifest.json), [journal](../engineering/skill-usage/records/CHURCH-P3/P3.6-implementation-1.json).

| Gói | Kết quả thực tế | Bằng chứng |
|---|---|---|
| P36-01 | ReportingKind/reference unique, public read ports và định nghĩa snapshot/calendar/coverage | api/attendance/reporting.ts; api/rites/reporting.ts; api/prep-classes/reporting.ts |
| P36-02 | W01/W02/W14/W04/W05 hai realm; drilldown/period/filter/export/confirmation | output/p3.6/browser-results.json; ảnh trong output/p3.6 |
| P36-03 | Workflow QR/lớp/lễ/chứng nhận; role/tenant/rollback/replay/CAS/revoke và regression | output/p3.6/tests-full.log; workflow.json; regression/ |
| P36-04 |9configs/480journeys, indexed explain, restore34collections và cleanup/readback | output/p3.6/workload.json; restore.json; cleanup-readback.json |
| P36-05 | Contracts/runbook/checklist/receipt/journal/state và giới hạn bàn giao | Tài liệu liên kết ở trên |

### Bằng chứng thực chạy

- `bun test --timeout 30000 tests`: **263PASS/0FAIL,3762assertions/19files**;10tests riêng P3.6 bao phủ reference duplicate/race, closed snapshot/0/missing, calendar absence/pending/outside, cursor/export stale, real rollback/lost commit acknowledgement/replay, weighted unit snapshots, workflow, annual4kinds/unknown/Communion/sourcefailure, scoped lead và roles/tenant.
- Firefox riêng P3.6 **329checks PASS**, hai realm/light-dark/1440–901–900–560–390, source style parity, chart12/keyboard/touch bounds và route continuity. Regression **5973checks PASS**: overview483 +members542 +organization-runtime1407 +data-exchange417 +attendance785 +QR418 +prep-classes736 +rites768 +certificates417. Kỳ vọng cũ P2 “attendance unavailable/six shortcuts disabled” đổi sang contract P3.6 đã duyệt; giữ assertions cho phần chưa mở. Các lỗi fixture/expectation ban đầu được sửa, chỉ số trên lấy từ lần chạy hoàn tất cuối; logs không được dùng để gọi các lần lỗi là PASS.
- Typecheck/lint/UI-STD guard/product+reference builds/audit `{}`/shell/diff check PASS. Lint giữ10warnings CSS nguồn; bundle516.80kB có warning>500kB. SHA HTML4bdc4e…dc8b6, CSS nguồn/tokens/base/patterns không đổi.
- Tải100/500/2000 profiles ×1/5/10 workers,2warmup+10measured/worker: **480measured journeys/1920measured HTTPSrequests**, không request lỗi trong ma trận; volume12church references +10areas×4own-unit closed snapshots riêng với workflow public commands. Explain không COLLSCAN: reference/member unique; batchunit chọn tenant/date index,52documents examined/40returned. Không ép planner chọn unit/date nếu tenant/date phù hợp cho batch.
- p95 local qua9configs: W01 **52.54–8299.71ms**; W02 **32.53–3122.75ms**; W14 **18.20–1392.34ms**; W04 **98.84–8829.30ms**. p95 W04 cao ở2000/10 là giới hạn có thật; không SLA/production capacity, không tự mở tối ưu kiến trúc ngoài gói. Raw results trong workload.json.
- Restore **34collections** khớp toàn bộ document/binary/index/validator fingerprints trước xử lý recovery; revoke2sessions/purge1livepreview/rotate synthetic key. Old owner/secretary cookie, QR proof, actual staged preview bị từ chối; fresh login/active card/canonical baptism/PDF+DOCX hashes/revoke→download-denial đạt. Quiesced dump sang UUID mới, không PITR/RPO/RTO.
- Readback **0syntheticDB/0privateP3.6dirs/0verificationcontainers/listener3472=false**.96historical skill journals trong baseline giữ nguyên; không main DB init/restart3443/commit/push/deploy/dữ liệu thật. Self-review, không reviewer độc lập.

### Checklist để Khiêm nghiệm thu

Năm ô đầu tài liệu đã được tick theo chỉ dẫn nghiệm thu P3.6-r1 của Khiêm. Nội dung đối chiếu trong biên bản bàn giao:

1. Đối chiếu công thức/kỳ/snapshot; buổi chưa chọn/chưa chốt hiển thị—, closed0 hiển thị0, coverage và mẫu số0 rõ.
2. Mở W01→vắng3/W02→W14→W05 và W04; đúng nguồn/kỳ/quyền, hai realm/light-dark/mobile.
3. Xem workflow.json và restore.json: QR/lớp/phỏng vấn thủ công/Báp-têm/chứng nhận đối soát, không tự suy điều kiện.
4. Xem tests-full.log và regression: tenant/role/scoped lead, rollback/CAS/lost-ack/replay/revoke/sourcefailure đã chạy.
5. Xem workload/restore/cleanup; ghi nhận độ trễ local ở tải cao và NOT_RUN trước khi quyết định chấp nhận.

**Giới hạn chưa kiểm chứng:** Camera điện thoại thật/bản giấy thật P3-PHYSICAL-01 và native Word vẫn NOT_RUN; PDF/browser/synthetic không đóng mục này. Cần thiết bị+trusted HTTPS, printer/giấy/quét QR giấy, ngày/môi trường/kết quả/bằng chứng và Khiêm xác nhận. Main runtime/Safari/UAT/pilot/remote CI/production/multi-replica NOT_RUN. Nhắc lại trước UAT/pilot/release.

**Điểm dừng hiện hành:** Khiêm đã nghiệm thu P3.6-r1 đủ năm mục local/synthetic và cho đóng P3 riêng sau đó; [biên bản đóng P3](CHURCH-P3.md#đóng-p3). P4 chưa mở; chưa publication/deploy/dữ liệu thật.


## Nghiệm thu P3.6-r1 — 2026-11-13

Khiêm: **“Anh nghiệm thu P3.6-r1 theo năm mục; ghi nhận acceptance rồi tiếp tục dừng trước đóng P3, chưa mở P4.”**

**P36-01–05/P3.6-r1 HUMAN_ACCEPTED đủ5/5mục, local/synthetic; chưa released.** [Evaluation](../engineering/skill-usage/records/CHURCH-P3/P3.6-human-acceptance-1.json) liên kết journal implementation gốc; trạng thái PENDING_REVIEW ở snapshot bàn giao là lịch sử trước chỉ dẫn này. Giữ nguyên receipt/source-manifest/implementation journal và số đo, không chạy lại tests/runtime để ghi nhận acceptance, không tính thêm usage implementation.

**P3 chưa đóng, P4 chưa mở.** Camera thật/bản giấy P3-PHYSICAL-01 và native Word/main runtime/Safari/UAT/pilot/remoteCI/production/multi-replica vẫn NOT_RUN; không đóng các mục này qua nghiệm thu local/synthetic. Chưa commit/push/deploy/real data/main DB init/restart3443. Live state duy nhất tại project-state.


## Liên kết đóng milestone — 2026-11-13

Sau acceptance P3.6-r1, Khiêm đã chỉ dẫn đóng P3, chưa mở P4. [Closure](CHURCH-P3.md#đóng-p3), [evaluation](../engineering/skill-usage/records/CHURCH-P3/P3-closure-1.json). Chỉ dẫn mới thay điểm dừng trước đóng P3 trong lịch sử; không thay technical snapshots, human acceptance hoặc NOT_RUN.
