# CHURCH-P2.2 — P2.2-plan-r1

## Authority

Ngày2026-11-11 Khiêm: “Duyệt P2.2-plan-r1 và triển khai trọn P22-01–05 local/synthetic, bàn giao để nghiệm thu rồi dừng trước P2.3.” Theo roadmap P2-plan-r1; không tự mở P2.3 hoặc publication/deploy/dữ liệu thật. P2.1-r2 đã HUMAN ACCEPTED; thay đổi tài liệu nghiệm thu hiện có được giữ nguyên.

## Danh mục đã duyệt

P22-01 dữ liệu hồ sơ/mã/lịch sử; P22-02 chọn/tạo hộ tối thiểu atomic và xếp ban qua Organization; P22-03 API/quyền/transaction/retry/audit; P22-04 W02/W14/W15/menu/O02; P22-05 tests/browser/source checks/docs/journal và bàn giao. Code/wiring trọn gói trước tests; không chia handoff theo lớp/file.

## Quy tắc đã duyệt

Owner đúng tenant/pastor/secretary đọc ghi; role khác chưa có hồ sơ, church suspended chặn nghiệp vụ. ID/churchId bất biến, mã unique tenant; không ghép theo tên/phone hoặc gắn account. Ba trục loại believer/visitor, membership preparatory/member/child, participation active/long_absent/transferred/deceased. Chuyển visitor giữ ID/lịch sử, mặc định preparatory, không ghi danh lớp. Thay participation có lý do/ngày hiệu lực, sự kiện chưa rõ ngày để trống; restore giữ lịch sử, không xóa hồ sơ.

DOB/date-only nullable, không date/age giả, Asia/Ho_Chi_Minh cho ngày nghiệp vụ;29/2 dùng1/3 năm không nhuận. Baptism unknown/not_baptized/baptized, date/place nullable, không tự tạo sổ/chứng nhận. Consent xác nhận bắt buộc, lưu actor/time/wording version.

Mỗi người một hộ, tối đa một head hiện hành; tạo hộ tối thiểu cùng hồ sơ trong transaction. Family sở hữu area; không link mới vào area inactive; chọn hộ hiện hành hoặc tạo mới/area nullable. Move/split/merge và quản lý hộ đầy đủ để P2.3. Auto xếp ban tại ngày lưu, DOB unknown không tự xếp; manual<=50active age/service units, không board. Không tự xếp lại khi sửa field không liên quan.

Lists scoped trước query/count, default25/max100, stable keyset+signed cursor. Search code/name words/phone; không fuzzy/bỏ dấu. Default active+long_absent, query không tự mở historical; summary theo filters không tính ngầm mỗi trang. O01/O02 counts/dashboard để P2.6. W14 giữ thứ tự nguồn, attendance/giving/QR unavailable. Spacing theo P2.1-r2, geometry thật.

## Acceptance

AC01 create/search/update + family atomic; AC02 quyền/realm/tenant/cursor/history/operations/two tabs; AC03 dates/unknown/age/birthday/leap; AC04 active catalogue/context/fences; AC05 conversion/retry/history/no-class; AC06 lifecycle/restore/history/no-delete; AC07 CAS/revoke/suspend/audit failure/unknown commit; AC08 light/dark/mobile/keyboard/spacing/pending/reauth/denied/unavailable. Chưa human accepted/released.

Chi tiết contracts/results được cập nhật trước bàn giao; live state duy nhất docs/project-state.md.

## Bàn giao P2.2-r1

Trọn P22-01–05 source complete; local/synthetic behavior verified theo receipt. Human acceptance **PENDING_REVIEW**, chưa released. P1/P2.1 đã nghiệm thu; P2.3 Gia đình là gói kế tiếp chưa mở; sau đó P2.4 Tổ chức/quyền → P2.5 Import/export → P2.6 Tổng quan/kiểm chứng.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P22-01 | Hồ sơ, mã bất biến, ngày nullable, consent và lịch sử | api/members, api/infrastructure/database.ts | Hoàn tất; PASS local | — |
| P22-02 | Hộ tối thiểu atomic, catalogue active và xếp ban | api/families, api/organization/service.ts | Hoàn tất; PASS local | — |
| P22-03 |24method/path, hai realm, CAS/quyền/retry/audit | api/app.ts, api/authorization, api/operations | Hoàn tất; PASS local | — |
| P22-04 |W02/W14/W15, O02/menu, pending/reauth | web/members-management.tsx, web/member-form.tsx, web/tenant-mutation.ts | Hoàn tất; PASS Firefox | — |
| P22-05 |Tests, browser/source checks, contracts/journal/biên bản | tests, scripts/browser-members.ts, docs/engineering/P2.2-members.md | Hoàn tất kiểm chứng; chờ Khiêm nghiệm thu | Human acceptance là quyết định riêng |

### Ảnh thực tế

![P2.2-r1 — hồ sơ đã chuyển từ thân hữu](../../output/p2.2/final/members/w14-converted-history-1440-light.png)

P2.2-r1 · working tree local · Firefox/private CA/synthetic · đã tự xem ảnh, không là bằng chứng thiết bị thật/production. [W02 desktop](../../output/p2.2/final/members/w02-list-1440-light.png), [W15 mobile dark](../../output/p2.2/final/members/w15-create-unknown-390-dark.png), [W15 chọn hộ/ban](../../output/p2.2/final/members/w15-existing-family-visitor-manual-390-dark.png).

### Đối chiếu acceptance kỹ thuật

| AC | Quan sát/bằng chứng | Kết quả |
|---|---|---|
| AC01 |Create/search/edit, consent/phone/code, family atomic/headunique/rollback, profile canonical | PASS Mongo/HTTP + browser |
| AC02 |Roles/realm/tenant/namespace/cursor, filters/summary, keyset/history paging, two-tab CAS | PASS local; assigned_units/lead chưa mở ở P2.4 |
| AC03 |Calendar/timezone/unknown/leapday, birthday aggregation thật, ngày sai/birth ordering | PASS unit/integration/browser |
| AC04 |Active catalogue/cross tenant/board/manual limits/stale config/age assignment; giữ ban khi sửa field khác | PASS local |
| AC05 |Visitor stage/conversion giữ ID/family/source/history, nullable beliefdate, exact replay, không lớp/account binding | PASS local |
| AC06 |Reason/effective/event date, historical filter explicit, transfer/deceased/restore/history, no delete | PASS local |
| AC07 |CAS, real snapshot revoke/suspend, audit validator rollback, unknown acknowledgement sau commit thật | PASS Mongo/HTTP |
| AC08 |Sáng/tối ×1440/901/900/560/390, geometry, focus trap, pending/Escape/nav/reauth, denied/unavailable | PASS Firefox; physical devices/Safari NOT_RUN |

Bằng chứng tổng hợp [verification](../../output/p2.2/verification.json), contracts/runbook [P2.2-members](../engineering/P2.2-members.md). Bộ kiểm cuối có540P2.2+508Organization+171accounts+88churches+119owner+282UI=1708Firefoxchecks. Full tests được chạy lại trên code cuối; số assertion và command exit theo receipt, không dùng kết quả của lần fail làm PASS.

### Review và giới hạn

- Tự review source/contracts/ảnh, không reviewer độc lập. Phát hiện changedFields của conversion ghi requestkeys thay vì domain fields; sửa tính diff snapshots, thêm regression. UI history thêm Báp-têm/stage/date. Giữ snapshots/actor/tenant/CAS và audit nguyên tử.
- Các lần kiểm đầu được giữ trong thư mục members-r1…r6/members-final và logs riêng, không dùng làm receipt cuối. Test defects đã sửa: selector chữ “Chưa rõ”/alert trùng ở dialog đóng; expected session code sau response xóa cookie; bộ forward ban đầu chưa tin CA riêng và cần chờ route abort hoàn tất. Bản cuối forward bằng HTTPS client tin đúng CA, không bypass TLS, có assertion real commit trước khi abort.
- Kiểm menu owner thay kỳ vọng3mục bằng4mục đã duyệt và vẫn kiểm nhãn/trạng thái disabled. Thông báo access cập nhật vì capability hồ sơ nay có thật. Không giảm assertion/gates để che lỗi.
- Không main DB init, không restart acceptance server hiện hành. Bằng chứng dùng server/db test riêng đã dọn; bundle đã đọc lại qua HTTPS loopback3457, CA verified, hash khớp. Server3443 hiện hữu chưa được nâng cấp để dùng làm bằng chứng P2.2.
- NOT_RUN remote CI/Safari/physical devices/production/real-data migration. Không commit/push/deploy, không mở P2.3, không gán account hoặc mở assigned_units. O01/O02 counts/Organization memberCount/attendance/giving/QR giữ unavailable.

### Checklist Khiêm nghiệm thu

- [ ] Thêm/sửa hồ sơ với ngày sinh/Báp-têm chưa rõ; kiểm consent và phone0đầu.
- [ ] Chọn hộ có sẵn hoặc tạo hộ; auto/manual ban đúng và không tự đổi khi sửa điện thoại.
- [ ] Chuyển thân hữu thành tín hữu; chuyển đi/khôi phục; ID/mã/lịch sử giữ nguyên.
- [ ] Search/filter/paging; owner/pastor/secretary và role bị từ chối đúng tenant.
- [ ] Xem spacing desktop/mobile/light/dark, drawer/form và pending/reauth trước quyết định.

Quyết định của Khiêm: ☐ Chấp nhận ☐ Yêu cầu sửa ☐ Tạm dừng. Dừng trước P2.3. Bước tiếp theo: nghiệm thu/yêu cầu sửa P2.2; chỉ lập kế hoạch chi tiết P2.3 sau chỉ dẫn mới, không tự coding gói sau.

Journals: [planning1](../engineering/skill-usage/records/CHURCH-P2/P2.2-planning-1.json), [implementation1](../engineering/skill-usage/records/CHURCH-P2/P2.2-implementation-1.json). Tỷ lệ skills là ước lượng đóng góp, tổng100%; counters không có đo được để null, không phải0. Full run cuối108PASS/1574assertions; focused sau review16PASS/347assertions.

## Human review1 — ACCEPTED

Khiêm xác nhận trong chat: **“Nghiệm thu P2.2, chưa mở P2.3”**. Trọn P22-01–05/P2.2-r1 **HUMAN ACCEPTED** trong phạm vi local/synthetic. [Acceptance1](../engineering/skill-usage/records/CHURCH-P2/P2.2-human-acceptance-1.json) liên kết implementation1; không ghi đè journal/receipt PENDING_REVIEW tại thời điểm bàn giao hoặc ghi lại skill usage như gói mới.

Quyết định hiện hành: ☑ Chấp nhận P2.2; **P2.3 NOT_OPENED**. Không mở planning/coding P2.3; không commit/push/deploy hoặc dữ liệu thật. Bước tiếp theo: giữ điểm dừng đến khi Khiêm có chỉ dẫn mới. Nội dung “chờ nghiệm thu” phía trên là lịch sử tại bàn giao trước xác nhận này.
