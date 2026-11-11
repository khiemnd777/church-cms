# CHURCH-P2.1 — P2.1-plan-r1

## Authority

Khiêm: “Duyệt P2.1-plan-r1 và cho triển khai trọn P21-01–05 trong phạm vi local/synthetic. Bàn giao để nghiệm thu rồi dừng trước P2.2; chưa commit/push, deploy hoặc dùng dữ liệu thật.” Ngày ghi: 2026-11-11. Theo roadmap P2-plan-r1, một lần bàn giao trong P2.1.

## Phạm vi đã duyệt

P21-01 dữ liệu tổ chức; P21-02 API/quyền/transaction/ledger v2 và tương thích v1/audit; P21-03 UI W12 chung owner/user; P21-04 kiểm chứng tích hợp; P21-05 tài liệu, trạng thái, journal/bằng chứng. Owner/pastor đọc ghi, secretary chỉ đọc; role khác không cấp nghiệp vụ P2.1. Church suspended chặn nghiệp vụ hai realm. Trưởng ban/subjectMemberId thuộc P2.4; hồ sơ/gia đình/import/dashboard thuộc các gói sau.

## Acceptance đã duyệt

- AC01 GET chưa cấu hình không ghi/không tạo mẫu.
- AC02 init cạnh tranh/retry chỉ tạo một settings và sáu system units.
- AC03 role/realm policy ở backend, UI đúng quyền.
- AC04 URL/ID/cursor/operations scoped; owner hai tab không lẫn.
- AC05 unique danh mục, giữ ID khi rename/status; system units bất biến.
- AC06 CAS một thắng, stale412.
- AC07 revoke/suspend cạnh tranh với commit/replay bị fence.
- AC08 mutation/ledger/audit atomic; faults/retry/unknown outcome đối soát đúng.
- AC09 actor đúng, ledger v1/v2/F22 tương thích.
- AC10 light/dark/responsive/keyboard/deep link/loading/error/empty/read-only.

Contracts và runbook implementation tại [P2.1 organization](../engineering/P2.1-organization.md). Bằng chứng/biên bản được bổ sung trước bàn giao; chưa human accepted/released.

## Bàn giao P2.1-r1 — CHANGES_REQUESTED tại human review1

P21-01–05 source complete và local behavior verified, chưa human accepted/released. Hoàn thiện module Organization,18 API method/path mới qua hai realm, role policyVersion2, ledger v2 tương thích v1/F22, W12/O02/menu/deep link và runbook nâng cấp index tường minh. Chỉ sửa workspace, không commit/push/deploy hoặc dùng dữ liệu thật; dừng trước P2.2.

| WHAT | Kết quả thực tế | Bằng chứng |
|---|---|---|
| P21-01 Dữ liệu | Settings và units validators/indexes; khởi tạo6fixed units, không mẫu demo | api/organization, integration |
| P21-02 API/quyền | Owner/pastor ghi, secretary đọc; CAS/tenant/realm/replay/fences/audit actor đúng |92integration tests/1227assertions toàn bộ P1/P2.1 |
| P21-03 UI | Renderer hai realm, readonly, dialogs, pending qua reauth, nhãn menu và O02 entry |108browser checks P2.1 |
| P21-04 Kiểm chứng | Regression171accounts+88churches+119owner+280UI; tổng766browser checks |output/p2.1/verification.json |
| P21-05 Hồ sơ | Contracts/runbook/task/state/roadmap và3phase records đã lưu |docs/engineering/P2.1-organization.md, skill-usage/records/CHURCH-P2 |

### Trực quan

![W12 desktop light — P2.1-r1](../../output/p2.1/final/browser-organization/w12-complete-1440-light.png)

P2.1-r1 · working tree từ07f9d8b · ảnh Firefox/container local với dữ liệu synthetic, source/bundle parity PASS; không bằng chứng thiết bị thật hoặc production. [Mobile dark](../../output/p2.1/final/browser-organization/w12-complete-390-dark.png).

### Checklist nghiệm thu của Khiêm

- [ ] Xem/thực hiện thiết lập → không tự tạo mẫu; chỉ cấu hình và6danh mục hệ thống.
- [ ] Đối chiếu quyền → pastor/owner ghi được, secretary chỉ đọc, user khác bị backend chặn.
- [ ] Thêm/rename/ngừng/khôi phục → giữ ID, tên trùng bị chặn, stale version có tải bản mới.
- [ ] Mất phản hồi và reauth → không tự replay, đối soát đúng một kết quả.
- [ ] Xem light/dark/mobile và menu → nhãn rõ, controls sử dụng được.

### Bằng chứng kỹ thuật

- PASS `bun test --timeout 30000 tests`:92tests/1227assertions, Mongo replica set/Redis thật, DB synthetic riêng.16tests P2.1 gồm audit failure rollback, real commit acknowledgement loss, real snapshot barrier revoke/suspend, actor/tenant/cursor/query bounds, v1 index upgrade/F22 compatibility. Các fixtures kiểm thử không seed vào main.
- PASS766Firefox checks:108P2.1+658P1/UI. Cấu hình/pending/readonly/pastor/dialog/CAS, hai theme ×1440/901/900/560/390; retained intent qua idle/reauth và no automatic replay được kiểm trực tiếp.
- PASS lint (10warnings CSS nguồn có sẵn), typecheck, product/reference build, ui:check, shell syntax, dependency audit `{}`, diff whitespace và bundle hashes khớp suites tương ứng. Explain300units bổ sung synthetic dùng index, không capacity/SLA.
- Readback0DB còn lại theo hai prefix test của P2.1. Không drop/xóa volume/main. Receipt:[verification](../../output/p2.1/verification.json),[integration](../../output/p2.1/integration.log),[query](../../output/p2.1/query-explain.json). Output là local Git-ignored.
- Lỗi trong quá trình kiểm: fixture ban đầu hardcode account version trước đổi mật khẩu, fixture dùng chung IP chạm rate-limit, locator heading/menu trùng và assertion thông báo P1 cũ. Đã sửa fixture/locator/expected behavior được duyệt; không thay rate-limit, giảm assertion hoặc tắt gate. Final receipts PASS thay các failed attempts giữ trong output/history.
- Self-review, không reviewer độc lập. NOT_RUN physical devices/Safari/remote CI/production/real-data migration hoặc production recovery. Chưa nâng cấp DB main hoặc restart server hiện hành; bằng chứng API/UI từ các môi trường synthetic cô lập.

Journal:[planning](../engineering/skill-usage/records/CHURCH-P2/P2.1-planning-1.json),[implementation](../engineering/skill-usage/records/CHURCH-P2/P2.1-implementation-1.json). P2 roadmap planning có record riêng, không backdate.

**Điểm dừng:** Khiêm nghiệm thu hoặc yêu cầu sửa P2.1; chỉ mở P2.2 bằng chỉ dẫn riêng sau nghiệm thu.

## Human review1 — CHANGES_REQUESTED

Khiêm chưa nghiệm thu P2.1 ngày2026-11-11: margin/padding components nằm sát nhau, unexpected. [Ảnh gốc](../../output/p2.1-spacing/reported.jpg), [evaluation](../engineering/skill-usage/records/CHURCH-P2/P2.1-human-review-1.json). Đây là lỗi implementation UI trong P21-03/04, không là scope mới. Root cause: ui-field chỉ có min-width, phụ thuộc .form label để có gap; toolbar không tạo khoảng cách với bảng; form xếp phẳng các nhóm gây nhịp spacing không rõ. Bằng chứng PASS r1 giữ nguyên, không đủ cho acceptance spacing. Sửa trong P2.1 và bàn giao lại, vẫn dừng trước P2.2.

## Bàn giao P2.1-r2 — chờ nghiệm thu lại

Sửa lỗi trong P21-03/04 theo phản hồi, không thêm gói hoặc thay nghiệp vụ. P21-05 ghi nhận review1 và bàn giao2; r1/receipts/journal cũ giữ nguyên làm lịch sử.

| WHAT | Kết quả | Vị trí |
|---|---|---|
| P21-03 | Field gap5px độc lập form, input flex:none; group/header/table/age-label spacing theo source/tokens | web/ui/styles/adapters.css, web/organization-management.tsx/css |
| P21-04 |508P2.1+282UI+171accounts+88churches+119owner=1168browser checks PASS;80mẫu đo | scripts/browser-organization.ts, scripts/browser-ui-standard.ts, output/p2.1-spacing |
| P21-05 | Human review1 CHANGES_REQUESTED đã lưu; state/contract/UI standard và planning/implementation2 đã ghi | docs/engineering/skill-usage/records/CHURCH-P2 |

### Ảnh thực tế r2

![P2.1-r2 — desktop light](../../output/p2.1-spacing/final/organization/w12-complete-1440-light.png)

P2.1-r2 · working tree từ07f9d8b · Firefox/container synthetic; đã tự xem ảnh, chưa human accepted hoặc production verified. [Mobile dark](../../output/p2.1-spacing/final/organization/w12-complete-390-dark.png).

### Kết quả đo và kiểm chứng

- 80mẫu render trên light/dark ×1440/901/900/560/390, các trạng thái setup/configured/dialog/pending/readonly/pastor. Gap label/control5px; group18px; heading/content12px; toolbar/table18px; age label/value10px; input/select một dòng36–44px. Assertions kiểm số nhóm/bảng và chiều cao, không chỉ no-overflow/min-touch-target.
- Trong lần sửa đầu, ảnh thật phát hiện flex-basis của toolbar làm input cao220px khi Field thành flex column; đã sửa adapter input/select flex:none và thêm assertion chiều cao trước bàn giao này. Bằng chứng cuối cùng được tách ở final, không dùng PASS của ảnh trung gian làm kết luận.
- PASS1168Firefox checks, lint(10warnings CSS nguồn), typecheck/product/reference builds/ui:check/diff/bundle parity. [Receipt](../../output/p2.1-spacing/verification.json) trỏ từng suite và numeric geometry; readback0DB synthetic còn lại.
- API không đổi; dùng lại92integration tests/1227assertions r1, không chạy lại integration cho sửa spacing. Self-review, không reviewer độc lập; thiết bị thật/Safari/remote CI/production NOT_RUN. Không commit/push/deploy/main migration hoặc restart server hiện hành.

### Checklist xem lại

- [ ] Label và input tách nhau rõ; input không cao bất thường.
- [ ] Hai nhóm cấu hình có nhịp khoảng cách rõ; tên ban và độ tuổi không dính.
- [ ] Toolbar không chạm bảng ở cả ban phục vụ và khu vực.
- [ ] Đối chiếu desktop/mobile/light/dark và các dialog trước nghiệm thu.

Journal:[planning2](../engineering/skill-usage/records/CHURCH-P2/P2.1-planning-2.json),[implementation2](../engineering/skill-usage/records/CHURCH-P2/P2.1-implementation-2.json). Đề nghị Khiêm nghiệm thu lại hoặc yêu cầu sửa P2.1; không tự mở P2.2.
