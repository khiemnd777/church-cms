# CHURCH-P2.3 — P2.3-plan-r1

## Authority và phạm vi

Khiêm: “Duyệt P2.3-plan-r1 và triển khai trọn P23-01–05 local/synthetic, bàn giao để nghiệm thu rồi dừng trước P2.4. Chưa commit/push, deploy hoặc dùng dữ liệu thật.” P2.2 đã HUMAN ACCEPTED. Đây là gói theo roadmap P2-plan-r1; một lần bàn giao sau khi hoàn tất code/wiring rồi tests, không gate theo file.

P23-01 metadata/state/history/upgrade hộ; P23-02 scoped search/cards/detail/members/history; P23-03 preview và chuyển/tách/gộp/roles atomic; P23-04 W03/menu/O02/W14 và dialogs; P23-05 tests/regression/UI geometry/docs/journals/handoff.

## Quy tắc đã duyệt

Owner/pastor/secretary đọc ghi đúng tenant, role khác chưa mở; suspended chặn hai realm. Mã/ID bất biến. Metadata tên hiển thị/địa chỉ/ghi chú/năm sinh hoạt từ nullable, không suy từ createdAt. Family sở hữu area, active-link fence. Một người một hộ hiện tại, tối đa một head; không bắt buộc có head. Chọn vai trò tường minh, không tự suy theo tuổi/tên hoặc đổi head khi participation đổi.

Transfer chọn người/roles; split tạo mã mới giữ liên kết nguồn, source rỗng vẫn giữ. Merge chuyển toàn bộ hồ sơ gồm historical, source merged giữ mã/link; không dedup người hoặc xóa. Giới hạn100changed profiles/lệnh, không partial merge. Preview thể hiện người/roles/head/count/area trước–sau; reason/effectiveOn cho transitions, áp dụng trạng thái khi lưu, không lịch tương lai.

12cards mặc định/max50, preview6people/card; detail/member/history paging; source-side search code/name/member và cursor scoped. Prefix hai realm; giữ picker GET /families của P2.2. POST/PATCH CSRF/idempotency, If-Match source và expected target/member versions. Metadata/roles/links/member history/family history/ledger/audit atomic, current grant/catalogue fences. Không tự xếp ban/đổi participation/consent/account link. Source HTML/UI-STD-r1, spacing P2.1-r2.

## Acceptance

AC01 metadata/unknown/date/area/legacy compatibility; AC02 card/search/paging/history/links; AC03 role/head and two-tab CAS; AC04 transfer/split/merge all historical and100limit; AC05 tenant/realm/current rights/suspend/cursor/operations; AC06 rollback/unknown commit/exact replay; AC07 existing P2.2 paths/picker/history/assignments invariant; AC08 UI source/light/dark/responsive/keyboard/geometry/pending/reauth.

Source/behavior verification chưa hoàn tất; human acceptance PENDING_REVIEW, chưa released. Không main DB init/restart server hiện hành, publication/real data/P2.4.

## Bàn giao P2.3-r1 — chờ nghiệm thu

Trọn P23-01–05 source complete/local behavior verified. **Human acceptance PENDING_REVIEW, chưa released.** Đã nghiệm thu P1/P2.1/P2.2; tiếp theo P2.4 Tổ chức/quyền chưa mở, sau đó P2.5 Import/export → P2.6 Tổng quan/kiểm chứng.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P23-01 | Metadata/status/lineage/history/upgrade hộ P2.2 | api/families/models/schema/service, database.ts, db-init.ts | Hoàn tất; PASS local | — |
| P23-02 | Scoped cards/search/paging/detail/people/history | FamilyApplication, Members FamilyMembers port, TenantQueries | Hoàn tất; PASS local | — |
| P23-03 | Roles/chuyển/tách/gộp/preview, quyền/CAS/retry/audit | Families/Members/Operations/Authorization/app.ts | Hoàn tất; PASS local | — |
| P23-04 | W03/menu/O02/W14, dialogs và pending/reauth | web/families-management, family-form/command, main/church-app | Hoàn tất; PASS Firefox | — |
| P23-05 | Tests/geometry/source check/contracts/journals/handoff | tests/integration/families.test.ts, scripts/browser-families.ts, docs/engineering/P2.3-families.md | Hoàn tất kỹ thuật; chờ nghiệm thu | Human acceptance là quyết định riêng |

### Ảnh thực tế

![P2.3-r1 — preview tách hộ](../../output/p2.3/final/families/w03-split-preview-1440-light.png)

P2.3-r1 · working tree local · Firefox/private CA/synthetic · đã tự xem ảnh; không là bằng chứng Safari/thiết bị thật/production. [W03 desktop](../../output/p2.3/final/families/w03-cards-1440-light.png), [mobile dark](../../output/p2.3/final/families/w03-cards-390-dark.png), [preview mobile](../../output/p2.3/final/families/w03-split-preview-390-dark.png).

### Acceptance kỹ thuật

| AC | Bằng chứng và giới hạn | Kết quả |
|---|---|---|
| AC01 |Create/edit/unknown year/area active, strict payload; explicit legacy upgrade chạy2lần giữ ID/code/link/timestamps, không fake history | PASS Mongo/HTTP |
| AC02 |Cards6people/count, search theo member/name/code, keyset/history/people/cursor context;301hộ code plan examines1doc | PASS local; không SLA các tổ hợp query |
| AC03 |Atomic head swap với DB unique index giữ nguyên, historical head không tự đổi, CAS hai intent và P2.2 join/profile update | PASS local |
| AC04 |Transfer/split/merge full historical; source rỗng giữ record/merged link, complete roster/100limit/source≠target, không dedup/account/assignment changes | PASS local + browser |
| AC05 |Owner/pastor/secretary/treasurer/member, realm/tenant/namespace, snapshot barrier revoke/suspend | PASS local; assigned_units/P2.4 chưa mở |
| AC06 |Real audit validator rollback member/family/history/ledger; unknown ack sau real commit + exact replay; response loss + reauth browser | PASS local |
| AC07 |W02/W14/W15/picker/history/auto/manual và P1/P2.1 regressions | PASS full API +6browser regression suites |
| AC08 |Light/dark ×1440/901/900/560/390;130geometry samples, gap field5/group18/header12, control33–44px, last-column reachable; focus/pending/Escape/denied | PASS Firefox; physical/Safari NOT_RUN |

Full run cuối **124tests/1879assertions** PASS. Browser **2530checks** =822Families+540Members+508Organization+171accounts+88churches+119owner+282UI. Lint PASS với10warnings CSS gốc, typecheck/product/reference builds/ui:check/shell/diff/HTTPS bundle parity PASS. [Receipt](../../output/p2.3/verification.json), [contracts/runbook](../engineering/P2.3-families.md). Readback0DB test P2.3 còn lại; giữ services/volumes/main.

### Review và giới hạn

Self-review source/contracts/ảnh, không reviewer độc lập. Audit Family changedFields được tính từ metadata snapshot thực tế; history trả actorId và lưu tên/mã/vai trò tại thời điểm thao tác. Preview hiển thị source/target count/head trước–sau, không cấp mã thật trước commit. DB unique head không bị gỡ/tắt để đổi chủ hộ.

Lần focused đầu có1test defect: dùng targetVersion cũ khi kiểm payload trùng nên đúng ra412trước422; sửa fixture dùng targetVersion hiện tại để kiểm đúng nhánh duplicate, giữ cả assertion412stale riêng. Kết quả122tests/562Familieschecks trước bổ sung assertions/geometry giữ làm lịch sử; receipt cuối dùng124/822, không gọi lần fail là PASS.

Không main DB init/restart acceptance server3443, commit/push/deploy hoặc dữ liệu thật. Không mở P2.4/assigned_units/account binding/dashboard/import. NOT_RUN remote CI/Safari/physical devices/production/real-data upgrade; test upgrade chỉ DB UUID tự tạo, không chứng minh production migration. Server test và HTTPS readback riêng đã dừng; output Git-ignore local.

### Checklist Khiêm nghiệm thu

- [ ] Tạo/sửa hộ với năm/khu vực chưa rõ; đổi khu vực xem trước đủ ảnh hưởng.
- [ ] Đổi chủ hộ/chuyển người/tách hộ đúng người và vai trò; nguồn không bị tự chọn chủ hộ.
- [ ] Gộp đủ hồ sơ chuyển đi/qua đời; mã hộ nguồn vẫn tra cứu được qua filter/links/history.
- [ ] Kiểm W03↔W14, light/dark/mobile/spacing và pending/reauth không tạo trùng.
- [ ] Đối chiếu quyền, CAS/rollback và giới hạn100trong contracts/receipts.

Quyết định Khiêm: ☐ Chấp nhận ☐ Yêu cầu sửa ☐ Tạm dừng. Dừng trước P2.4. Bước tiếp theo: nghiệm thu/yêu cầu sửa P2.3; sau nghiệm thu và chỉ dẫn mới mới mở kế hoạch P2.4.

Journals: [planning1](../engineering/skill-usage/records/CHURCH-P2/P2.3-planning-1.json), [implementation1](../engineering/skill-usage/records/CHURCH-P2/P2.3-implementation-1.json). Skills là ước lượng đóng góp tổng100%, không đo thời gian/token/hiệu quả; counters chưa có để null.

## Human review1 — ACCEPTED

Khiêm xác nhận: **“Nghiệm thu P2.3, mở 2.4”**. Trọn P23-01–05/P2.3-r1 HUMAN ACCEPTED local/synthetic. [Acceptance1](../engineering/skill-usage/records/CHURCH-P2/P2.3-human-acceptance-1.json) liên kết implementation1; giữ nguyên receipt/journal PENDING_REVIEW tại thời điểm bàn giao và không ghi lại usage gói cũ.

Mở lập kế hoạch P2.4 theo roadmap; trình contracts/acceptance/ASCII mockup để duyệt trước coding. Không cấp quyền implementation P2.4 từ chỉ dẫn mở planning này, không mở P2.5 hoặc publication/deploy/dữ liệu thật. Nội dung chờ nghiệm thu/dừng trước P2.4 phía trên giữ làm lịch sử trước xác nhận mới.
