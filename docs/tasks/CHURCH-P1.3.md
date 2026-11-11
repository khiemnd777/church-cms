# P1.3 — P1.3-plan-r1 được duyệt

Khiêm: “Duyệt triển khai P1.3-plan-r1”. Một gói nghiệm thu Theo roadmap P1, hoàn tất production code/wiring trước tests, bàn giao trước P1.4. Phạm vi P13-01–05: O03/F15–19/F21; user A01/A04/F02–07; F09/F24 context/policy; nối menu/O02/counts; kiểm chứng tenant/realm/CAS/idempotency/secret/concurrency/UI và hồi quy P1.1/P1.2.

Owner vẫn quản trị accounts khi church suspended; user login/business context bị chặn. Một account một churchId bất biến, cùng email khác church độc lập. Temp24h/response đầu; F22/replay không secret; reset recent auth<=5m/supportReference/rate5giờ, không tự mutation sau reauth. Role/scope theo foundation; không P2 target giả, không role owner qua user flow. UI từ bộ chung: icon+tên menu, labels/fields/cột/status/confirm đầy đủ,900/560 và hai theme.

Các trạng thái live ở project-state. Chưa quyền P1.4/P2, Git publication/deploy, global config hoặc dữ liệu thật. Các đề xuất thuộc phạm vi mới phải duyệt lại; không dùng receipt cũ làm authority cho task khác.

## Bàn giao P1.3-r1 — snapshot trước nghiệm thu

Code/wiring hoàn tất, kiểm chứng local/synthetic PASS; chưa human accepted, chưa released. **P1.4 chưa mở**. Bức tranh: P1.1/P1.2 đã nghiệm thu → P1.3 chờ nghiệm thu → P1.4 Kiểm chứng tích hợp → P2 sau quyền riêng.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P13-01 | O03/F15–F19/F21: tạo, tìm/lọc/keyset, quyền, khóa/mở, temp/reset | api/identity/accounts.ts, web/account-management.tsx | Hoàn tất; đã kiểm chứng local | — |
| P13-02 | User A01/A04/F02–F07, vòng đời phiên đúng realm/church | api/identity/church-service.ts, web/church-app.tsx | Hoàn tất; đã kiểm chứng local | — |
| P13-03 | F09/F24, role/scope/context thực tế | api/authorization, web/access-context.tsx, api/tenancy/access.ts | Hoàn tất; đã kiểm chứng local | P2 target/business capability chưa có, từ chối/hiển thị chưa khả dụng theo scope |
| P13-04 | Menu, O02→O03/context, số account active | web/main.tsx, web/church-management.tsx | Hoàn tất; đã kiểm chứng local | — |
| P13-05 | Hồi quy tenant/realm/CAS/retry/secret/UI và hồ sơ bàn giao | tests/integration/accounts.test.ts, scripts/browser-accounts.ts, output/p1.3 | PASS kỹ thuật; chờ human acceptance | Thiết bị thật/Safari/remote CI/production NOT_RUN; ngoài môi trường được phép |

### Ảnh thực tế

![O03 sáng desktop](../../output/p1.3/o03-1440-light.png)
![Context user tối mobile](../../output/p1.3/user-context-390-dark.png)

P1.3-r1 · Firefox/1440 và390 · Đã xác minh local/synthetic. Không phải thiết bị thật/UAT/production. Tên/email trong ảnh chỉ fixture, đã xóa cùng DB test. Ảnh không chứa mật khẩu. Mẫu HTML nguồn/kit dùng lại, không tuyên bố pixel-match literal O03 vì nguồn không có O03. Có ảnh form, credential đã che và user login/change/reauth light/dark trong output/p1.3.

### Kiểm tra để Khiêm nghiệm thu

- [ ] Owner → O02 → Tài khoản → tạo account; kiểm tra nhãn/cột/menu ở light/dark và desktop/mobile; đóng temp không xem lại secret.
- [ ] User theo URL đúng Hội Thánh → mật khẩu tạm → đổi mật khẩu → đăng nhập → context đúng người/role/scope; không tenant picker hoặc owner fallback.
- [ ] Sửa quyền, khóa/mở/cấp lại đúng account; reset quá5m yêu cầu reauth rồi trở về xác nhận, không tự cấp lại. Account độc lập church khác không bị tác động.
- [ ] Xung đột version yêu cầu tải lại; mất phản hồi chỉ đối soát/thử lại cùng ý định, không duplicate hoặc replay secret; số account active O02 thay đổi thực tế.

### Bằng chứng và giới hạn

- `bun test --timeout 30000 tests`: **63PASS/789assertions**, Mongo replica set/Redis thật, DB synthetic riêng tự dọn;25test mới accounts/context/auth. Negative tenant/realm/escalation, clock/TTL, two-tabs/concurrency, schema/audit rollback, lost commit acknowledgement và dependency failure.
- Browser: **165P1.3 +88P1.2 +119owner +280UI =652PASS**. P1.3 light/dark ×1440/901/900/560/390, fields/actions/scroll, temp/password flow, role/status/reset/recent auth, source filters/keyset, F22/same-key after real commit, wrong church URL, logout isolation, Modal focus/Tab/Escape.
- Formatter/lint(10warnings từ CSS nguồn)/typecheck/product+reference build/UI source guard/shell syntax: PASS. Source HTML SHA `4bdc4e…dc8b6`; tokens/base/patterns không đổi. Không dependency/collection/index mới.
- Explain601 synthetic accounts: ordered dùng church_name26docs, exact email church_email_unique1doc; không capacity/SLA production. Local db:init và HTTPS readiness/static readback PASS; served HTML khớp bundle đã test, cả product và gallery hash được đối chiếu với receipt browser.
- [Receipt tổng](../../output/p1.3/verification.json), [browser](../../output/p1.3/browser-results.json), [integration](../../output/p1.3/integration.log), [query](../../output/p1.3/accounts-query-explain.json), [inventory](../../output/p1.3/inventory.json), [readback](../../output/p1.3/local-readback.json).
- Self review, không reviewer độc lập. NOT_RUN thiết bị thật/Safari/remote CI/UAT/production/failover/backup-restore toàn hệ thống. P1.4/F23 và P2 chưa được mở; các giới hạn này không được báo PASS. Không Git publication/deploy hoặc seed data vào DB main.

### Sửa lỗi phát hiện trong test phase

Reset rate bucket dùng canonical church/account ObjectId để case variant không tạo hạn mức khác. Modal selector ưu tiên field rồi mới button để không mặc định focus nút đóng; sửa ở component chung và hồi quy ba suite cũ. Kỳ vọng test `auth/login`404 của P1.1 được bỏ vì F02 đã được duyệt triển khai, negative realm/CSRF được kiểm tra riêng; không tắt gate hoặc giảm kiểm tra quyền. Explain ban đầu1row không đại diện lựa chọn planner; thêm601row, giữ assert index và bounded exact lookup. Chi tiết diagnostics trong output/p1.3/diagnostics; receipt final tách riêng.

Contracts và thao tác local: [P1.3 accounts](../engineering/P1.3-accounts.md), [runbook](../engineering/P1.1-local-runbook.md). [Planning journal](../engineering/skill-usage/records/CHURCH-P1/P1.3-planning-1.json); [Implementation journal](../engineering/skill-usage/records/CHURCH-P1/P1.3-implementation-1.json). Điểm dừng: Khiêm nghiệm thu P1.3; chỉ mở P1.4 khi có chỉ dẫn riêng.


## P1.3 HUMAN ACCEPTED

Khiêm: “Hiểu rồi, nghiệm thu P1.3. Tiếp theo, kế hoạch P1.4”. Chấp nhận P1.3-r1 sau khi làm rõ account mới chưa liên kết hồ sơ thuộc viên; foundation r2 đã có subjectMemberId/quy tắc self chưa gắn subject, roadmap có module P2 và cổng tín hữu P6. Không coi việc nghiệm thu là đã có nghiệp vụ self hoặc quyền triển khai liên kết/P2.

[Acceptance](../engineering/skill-usage/records/CHURCH-P1/P1.3-human-acceptance-1.json) nối implementation/1, không ghi thêm skill usage hoặc sửa receipt kỹ thuật lịch sử. Chỉ mở bước lập kế hoạch P1.4; chưa implementation/release.
