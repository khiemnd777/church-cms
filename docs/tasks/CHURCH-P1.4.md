# P1.4 — P1.4-plan-r1 đã được duyệt

Khiêm: “Duyệt P1.4-plan-r1 và cho triển khai toàn bộ gói, bàn giao để tôi nghiệm thu trước P2.”

Kiểu bàn giao Theo roadmap Church CMS P0–P8 → P1 → P1.4; một gói nghiệm thu, không thêm gate theo file/script. P1.1/P1.2/P1.3 HUMAN ACCEPTED. Trạng thái live duy nhất tại project-state. Không P2/publication/deploy/dữ liệu thật/global config.

- P14-01: F23 GET /owner/audit-events, owner full audit:read, safe allowlist DTO, church/global/eventType/from/to,25–100, signed cursor actor/filter/context15m, occurredAt+id DESC, không exactcount/menu mới.
- P14-02: ma trận AC01–26 và28 active endpoint, retired F08/F20; kiểm chứng thật tenant/realm/CAS/epoch/idempotency/F22/secret/temp/TTL/unknown commit/failure.
- P14-03: synthetic100church/10.000account/100.000audit trong DB riêng, explain F10/F15/F23; HTTP concurrency1/5/10, warm-up+>=100samples/profile, p50/p95/errors/throughput/RSS; hash1/2/4, không SLA production hoặc giảm bảo mật.
- P14-04: backup synthetic ngừng ghi, restore sang DB mới, checksum/data/index/validator/smoke, revoke restored sessions. Không đụng church_cms_local/volume hoặc ngừng shared services. Mongo source of truth, không phục hồi quyền từ Redis; không RPO/RTO production.
- P14-05: hồi quy UI chung light/dark/responsive/labels/focus/scroll, các luồng P1; lint/typecheck/build/ui:check/integration/browser/audit, cập nhật CI. Remote CI NOT_RUN khi chưa Git/publication.
- P14-06: receipt/ma trận/measurements/restore/ảnh/runbook/journal, tự review có giới hạn, bàn giao và dừng trước P2/release.

Hoàn tất production code và operational wiring trước tests; sau đó sửa lỗi có bằng chứng trong phạm vi và chạy checks. Liên kết account–thuộc viên/business self/catalogue P2 không đưa vào P1.4.

## Bàn giao P1.4-r1 — snapshot trước nghiệm thu

Source complete và behavior verified local/synthetic; chưa human accepted/released. P1.1/P1.2/P1.3 đã nghiệm thu → P1.4 chờ nghiệm thu → P2 chưa mở → P3–P8 sau đó theo roadmap.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P14-01 | F23 owner-safe; đủ28endpoints | api/audit/reader.ts, api/app.ts | PASS local | — |
| P14-02 | AC01–26/quyền/concurrency/faults | tests/integration, P1.4-acceptance-matrix | PASS trong phạm vi P1 | Không giả lập P2 để gọi là self/business hoàn tất |
| P14-03 | Explain và đo dataset đã duyệt | scripts/p1-qualification.ts, output/p1.4 | PASS synthetic | Không production SLA/capacity |
| P14-04 | Backup/restore và thu hồi phiên target | script qualification, restore/cleanup reports | PASS local | Không RPO/RTO hoặc recovery dữ liệu thật |
| P14-05 | UI regression, CI checks | browser scripts, .github/workflows/ci.yml | PASS local/source checks | Remote CI/Linux runner/physical/Safari NOT_RUN |
| P14-06 | Hồ sơ/ma trận/runbook/journal | docs, output/p1.4 | Đã bàn giao; chờ human acceptance | Chỉ Khiêm quyết định nghiệm thu |

### Hình thực tế

![O03 desktop sáng](../../output/p1.4/o03-1440-light.png)
![Context user mobile tối](../../output/p1.4/user-context-390-dark.png)

P1.4-r1 · Đã xác minh Firefox local/synthetic; không UI/menu mới. Nguồn HTML SHA4bdc4e…dc8b6 và common kit giữ nguyên; ảnh không chứng minh quyền/transaction hoặc thiết bị thật. Fixture đã dọn, không dữ liệu thật. F23/restore thể hiện trong receipts kỹ thuật, không dựng màn audit giả.

### Kết quả thực tế

- `bun test --timeout 30000 tests`: **76PASS/997assertions**. Bao gồm F23 và HTTP catalogue28IDs, query allowlist/DTO/cursor/global–church/auth/expiry/Mongo outage; barrier thật đọc snapshot→đổi quyền/khóa→grant cũ không commit; hồi quy P1.1/P1.2/P1.3.
- Browser **171account/user +88P1.2 +119owner +280UI =658PASS**. Hai theme, mốc1440/901/900/560/390 và các mốc mở rộng của bộ cũ; native insertion128codepoints/whitespace; F05lost response sau commit thật→login password mới; owner2tabs2church với dual cookies; reset/CAS/focus/nav/scroll; không script errors.
- **AC01–AC26:** đủ26dòng yêu cầu→test/source→receipt→result/limit, [ma trận](../engineering/P1.4-acceptance-matrix.md), [JSON](../../output/p1.4/ac-matrix.json). PASS chỉ phạm vi P1; không tuyên bố đã có hồ sơ tự xem/P2 hoặc dữ liệu Ban/Khu vực giả.
- **Dataset100church/10.000account/100.000audit fixtures (+5audit vận hành)**; hash riêng từng account.3300HTTP samples/33cấu hình1/5/10,0errors, p95=4.31–27.57ms; RSSpeak532MiB của process kết hợp client/server/seed. Explain F10/F15/F23 dùng index, không baseline COLLSCAN. Chi phí filter/keyset và giới hạn ở [report](../../output/p1.4/qualification.json); không SLA production.
- **Restore PASS:** document fingerprints/index key order/validators8collections khớp, dump550ms/restore1548ms, archive~4.84MB đã xóa. Revoke2restored live sessions; old owner/user token401; fresh owner/user login/F23/readiness PASS. Ledger trống ở workload đo; integration riêng kiểm transaction/replay ledger có dữ liệu. [Restore](../../output/p1.4/restore.json), [cleanup](../../output/p1.4/cleanup.json), [cleanup readback](../../output/p1.4/cleanup-readback.json).
- **PASS** lint(10warnings CSS nguồn)/typecheck/product+reference build/ui:check/shell syntax/dependency audit `{}`. Hash benchmark1/2/4 PASS, không giảm cost. CI YAML parse/expected steps bằng Ruby PASS; Linux host routing cấu hình, chưa chạy remote. No schema/index/dependency mới.
- **PASS** HTTPS local ready, F23 unauth401, served product HTML khớp bundle đã test, gallery hash khớp suite UI. [Readback](../../output/p1.4/local-readback.json), [inventory](../../output/p1.4/inventory.json), [receipt](../../output/p1.4/verification.json).

### Sửa lỗi có bằng chứng

Account VERSION_CONFLICT dùng409 và RECENT_AUTH_REQUIRED dùng401 từ P1.3 lệch r2: sửa412/403 cho permissions/status/reset, giữ error.code và quy tắc; test xác nhận không mutation với stale version, audit403 đúng actor và UI reauth quay lại confirm. Tests đổi expected vì đối chiếu contract đã duyệt, không giảm assertions để làm xanh.

Tool qualification mới có hai lượt chờ trước khi đủ proof: sửa quiesce/request gate, dùng lại listener, dump/restore qua FD trực tiếp với timeout, giữ logs diagnostics. Lượt cuối hoàn tất và cleanup exit0; không đổi shared services hoặc che check thất bại bằng fallback giả. Không suy lỗi Bun/Mongo tổng quát.

### Checklist để Khiêm nghiệm thu

- [ ] Đối chiếu F23 owner full: global/church/date/type/keyset và DTO; user/limited/expired không đọc được.
- [ ] Kiểm tra ma trận26AC,28endpoint và các bằng chứng barrier/CAS/retry/secret.
- [ ] Đọc số đo/restore/cleanup cùng giới hạn; phân biệt snapshot quiesced với recovery production.
- [ ] Kiểm tra lại UI owner/user light/dark và nhãn/focus; không màn/menu mới hoặc mất text.

### Giới hạn và điểm dừng

Self review, không reviewer độc lập. NOT_RUN physical mobile/Safari/OS clipboard, remote CI/Linux runtime, production election/failover/real-data restore/RPO-RTO. CI chỉ cấu hình/source-validated vì workspace chưa Git repository; không publication/deploy. P2 chưa mở; liên kết account–thuộc viên cần cụ thể hóa trong kế hoạch module P2, là phụ thuộc dữ liệu self/cổng P6. Human acceptance/release riêng; bàn giao dừng trước P2.

[Contracts/runbook chi tiết](../engineering/P1.4-qualification.md). [Planning journal](../engineering/skill-usage/records/CHURCH-P1/P1.4-planning-1.json) và [implementation journal](../engineering/skill-usage/records/CHURCH-P1/P1.4-implementation-1.json); source/receipts lịch sử P1.1–P1.3 giữ nguyên, không ghi lại usage cũ.


## P1.4 HUMAN ACCEPTED — P1 CLOSED

Khiêm: “Nghiệm thu P1.4 và Đóng P1. Chưa mở P2.”

[Acceptance](../engineering/skill-usage/records/CHURCH-P1/P1.4-human-acceptance-1.json) nối implementation/1, đồng thời ghi P1 CLOSED. Không sửa implementation journal/receipts snapshot hoặc ghi lại usage cũ. Toàn bộ P1.1–P1.4 đã được nghiệm thu; giới hạn local/synthetic và NOT_RUN vẫn giữ nguyên, chưa released. P2 chưa mở; không thêm planning/implementation, Git publication/deploy hoặc thao tác dữ liệu thật. Biên bản tổng: [Đóng P1](CHURCH-P1.md#đóng-p1).
