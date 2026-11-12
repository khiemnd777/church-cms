# CHURCH-P2.4 — P2.4-plan-r1

## Quyền triển khai

Khiêm: “Duyệt P2.4-plan-r1 để triển khai trọn P24-01–05 local/synthetic, bàn giao nghiệm thu rồi dừng trước P2.5”. Theo roadmap P2-plan-r1, một gói nghiệm thu P24-01–05; không commit/push/deploy/dữ liệu thật.

## Contracts và acceptance đã duyệt

- P24-01 Organization: nhiệm kỳ nháp/xác nhận/kết thúc/hủy, không chồng hiệu lực, chức vụ không cấp quyền account; trưởng đơn vị/lịch mô tả và history.
- P24-02 Members: danh sách thực tế, service memberships cùng tồn tại ban tuổi, giữ mode/ban phục vụ khi tính lại tuổi; khu vực do Families sở hữu. Batch tối đa100, version từng hồ sơ, reason/effectiveOn.
- P24-03 Authorization/Accounts: owner cấp assigned_units1–50 active age/service/area same church; ministry_lead chỉ đọc DTO rút gọn, full Members/Families/history/operations vẫn bị chặn; scope trước search/count/page, read barrier chống thu hồi/đổi đơn vị đồng thời.
- P24-04 W04/W13/O03/shared UI: giữ source thứ tự BCH → age → service → area; scoped roster, forms/preview, role matrix readonly; future modules Chưa mở, no fake counters.
- P24-05: hoàn tất production wiring trước tests; API/Mongo transactions/security/races/retry/rollback, light/dark/responsive/spacing/keyboard, hồi quy P1–P2.3, build/typecheck/lint/ui:check, receipt/ảnh và handoff.

Chi tiết kế hoạch/mockup đã duyệt trong chat P2.4-plan-r1. Bổ nhiệm chỉ dùng thuộc viên chính thức đang sinh hoạt cùng church, không suy điều kiện tuổi từ demo. Một thư ký/một thủ quỹ/nhiều chấp sự, một người một chức vụ/nhiệm kỳ. Giữ lịch sử khi hồ sơ đổi trạng thái. Không mở P2.5.

## Trạng thái

P24-01–05/P2.4-r3 **HUMAN ACCEPTED** theo Khiêm ngày 2026-11-12. P24-01–03 kế thừa r1; P24-04/05 hoàn tất icon theo P2.4-icon-plan-r1. Source complete/behavior verified local-synthetic; chưa released. R1/r2/review1/review2 và trạng thái chờ nghiệm thu theo thời điểm bên dưới giữ làm lịch sử. P2.5 chỉ mở lập kế hoạch.

## Bàn giao P2.4-r1

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P24-01 | Nhiệm kỳ/BCH, trưởng đơn vị/lịch/history | api/organization | Hoàn tất, local verified | — |
| P24-02 | Roster/gán service giữ age/mode, khu vực theo family | api/members/organization.ts, api/families/service.ts, web/member-form.tsx | Hoàn tất, local verified | — |
| P24-03 | assigned_units/O03/policy/scoped read fences/receipt boundaries | api/identity, api/authorization, api/operations | Hoàn tất, local verified | — |
| P24-04 | W04/W13/menu/O03/W15/form/preview/pending/reauth | web/organization-runtime*, organization-forms, organization-scope-picker | Hoàn tất, Firefox verified | — |
| P24-05 | API/security/races/rollback/replay/browser/regression/docs/journal | tests/scripts/docs/output/p2.4 | Hoàn tất, chờ nghiệm thu | Chưa có human acceptance |

### Bằng chứng

[Receipt](../../output/p2.4/verification.json), [contracts/runbook](../engineering/P2.4-organization-runtime.md). API toàn bộ137tests/2133assertions PASS; sau sửa receipt uppercase chạy lại13tests/254assertions scope bị tác động PASS, không cộng trùng vào tổng. Firefox3326checks =794P24 +540Members +822Families +508Organization +173Accounts +88Churches +119Owner +282UI. P24 geometry130samples: fieldgap5/group18/cardheader12/control33–44px, đủ light/dark×1440/901/900/560/390, cuộn tới cột cuối. Self-review source/contracts/ảnh; không reviewer độc lập.

Typecheck/lint(10warnings CSS source)/product build/reference build/ui:check/audit/bash syntax/diff PASS. Audit không tìm thấy vulnerabilities tại thời điểm chạy. Source HTML/CSS hash chuẩn không đổi. Readback0DB P24 test còn lại, không init main DB/restart server3443, không commit/push/deploy/dữ liệu thật hoặc mở P2.5. Server test/container UUID đã dọn theo finally/wrapper; ảnh/receipt chỉ local Git-ignore.

Ảnh thực tế: [W04](../../output/p2.4/w04-complete-1440-light.png), [W04 mobile dark](../../output/p2.4/w04-complete-390-dark.png), [trưởng ban](../../output/p2.4/w04-lead-roster-1440-light.png), [W13](../../output/p2.4/w13-policy-1440-light.png), [O03scope](../../output/p2.4/o03-assigned-scope-1440-light.png), [pending](../../output/p2.4/w04-pending-1440-light.png). Ảnh chứng minh trạng thái render; quyền/giao dịch có tests tương ứng, không suy từ ảnh.

### Review và sửa trong giai đoạn kiểm chứng

- Chặn secretary đọc receipt quản trị cũ sau khi hạ từ pastor; chỉ receipt memberships được phép, giữ assertion P2.1 revoked-capability. Receipt namespace/actor/church và uppercase target đều được kiểm.
- W04 tải sections tuần tự do dùng chung church transaction fence; bỏ self-contention503 khi tải song song, không bỏ auth fence. Tuân thủ thứ tự tuổi chuẩn.
- Thêm thao tác kiểm tra kết quả trong dialog đang khóa và sau reauth; Firefox làm mất phản hồi sau commit thật với private-CA forwarding, giữ UUID/no-auto-replay/one-version-increment/Escape locked.
- Fixtures ban đầu dùng account version trước đổi password, thiếu reason đổi area và kỳ vọng403 thay vì SESSION_REVOKED401 đã sửa theo contract thực tế; giữ kiểm tra stale/denial riêng.
- Browser tests cũ giữ rule role ministry_lead disabled và5menu đã cập nhật đúng phạm vi P24: role enabled nhưng scope rỗng422/noaccount, đủ7menu label/disabled/description checks. Locator dùng tên control thực và footer Đóng. Không hạ assertions để lấy PASS.

### Checklist Khiêm nghiệm thu

- [ ] Tạo nháp nhiệm kỳ với ngày chưa rõ; nhập đủ ngày, chọn chức vụ, xem trước/xác nhận, đổi nhân sự và xem lịch sử.
- [ ] Gán/bỏ ban phục vụ; sửa DOB/tính lại ban tuổi và đối chiếu service/mode/khu vực không bị đổi ngầm.
- [ ] Owner cấp account Trưởng ban đúng đơn vị; kiểm danh sách rút gọn và không mở được profile/gia đình ngoài quyền.
- [ ] Đối chiếu W04/W13/O03, light/dark/mobile, spacing, focus, pending/reauth và ma trận quyền.
- [ ] Đọc receipt race/CAS/rollback/replay và giới hạn local trước quyết định nghiệm thu.

Quyết định Khiêm: ☐ Chấp nhận ☐ Yêu cầu sửa ☐ Tạm dừng. Dừng trước P2.5. P2.1-r2/P2.2-r1/P2.3-r1 đã nghiệm thu; P2.4-r1 chờ nghiệm thu; P2.5–P2.6 chưa mở.

NOT_RUN: Safari/thiết bị thật/remote CI/production/real-data schema upgrade, qualification SLA. Không mở self portal/account binding/import/export/dashboard/attendance. Scope đọc có điểm tuyến tính qua church fence, không realtime pixel revocation hay snapshot xuyên các trang.

Journals: [planning1](../engineering/skill-usage/records/CHURCH-P2/P2.4-planning-1.json), [implementation1](../engineering/skill-usage/records/CHURCH-P2/P2.4-implementation-1.json). Implementation skills: incremental25%, frontend25%, api-interface15%, testing25%, review10%; ước lượng đóng góp tổng100%, không đo thời gian/token/hiệu quả. Counters chưa đo để null.


## Human review1 — CHANGES_REQUESTED

Khiêm: “Chưa nghiệm thu P2.4, tôi muốn thêm cơ chế display theo dạng table/grid: 1. Giữ group. 2. Cơ chế switch card <-> table/grid”. [Evaluation1](../engineering/skill-usage/records/CHURCH-P2/P2.4-human-review-1.json) liên kết implementation1; giữ receipt/journal r1 là bằng chứng tại thời điểm bàn giao, không ghi lại usage.

P2.4-r1 chưa human accepted; P24-04/05 cần bổ sung UI và verification. Mở bước trình kế hoạch/mockup switch view trong chat, chưa cấp quyền coding mockup sửa đổi. Không mở P2.5/commit/push/deploy/dữ liệu thật. Dự thảo chưa duyệt giữ trong chat theo AGENTS.md.


## Quyền sửa P24-04/05 — P2.4-view-plan-r1

Khiêm: “Duyệt P2.4-view-plan-r1 để sửa P24-04/05 và bàn giao P2.4-r2. Hoàn thành code,bàn giao nghiệm thu rồi dừng trước P2.5”. P2.4-r1 CHANGES_REQUESTED giữ làm lịch sử. Gói sửa local/synthetic được phép hoàn tất code/UI wiring rồi tests, không commit/push/deploy/dữ liệu thật hoặc mở P2.5.

Scope đã duyệt: switch chung Card ↔ Bảng tại W04; giữ bốn group BCH → tuổi → phục vụ → khu vực, đổi presentation bên trong mỗi group. Card=grid2→1cột theo chuẩn; Bảng=table scoped/scrollable. Giữ selected term, loaded pages/counts/actions/permissions khi switch; không mutation/refetch do switch. Default Card, preference local theo account/church. Kiểm đủ views/light/dark/responsive/keyboard/last action column/empty/scoped/pending/reauth và bằng chứng bàn giao r2.

Trạng thái: P24-04/05 IN_PROGRESS theo view-plan-r1; checks bổ sung NOT_RUN tại lúc mở. Contracts/data/API r1 kế thừa; review1 không bị ghi đè.


## Bàn giao P2.4-r2 — P24-04/05

Source complete / behavior verified local-synthetic; **P2.4-r2 PENDING_REVIEW**, chưa human accepted/released. P2.4-r1/review1 và journals cũ giữ làm lịch sử. Sửa theo đúng P2.4-view-plan-r1 đã được Khiêm duyệt.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P24-04 | Switch chung Card/Bảng, giữ4group/selected term/pages/data/actions/scope, preference account/church | web/organization-runtime.tsx, organization-views.tsx, organization-runtime.css | Hoàn tất, verified Firefox | — |
| P24-05 | Kiểm cả2views, persistence, keyboard, scoped/pending/reauth, responsive/spacing/scroll/row height, docs/journals | scripts/browser-organization-runtime.ts, package.json, docs/output | Hoàn tất, PASS local | — |

### Bằng chứng r2

[Receipt r2](../../output/p2.4/r2/verification.json), [browser1254checks](../../output/p2.4/r2/browser-results.json). **1254Firefoxchecks PASS**,170geometry samples light/dark×1440/901/900/560/390: fieldgap5px/group18px/cardheader12px/control33–44px; row height56.5–65px. Last column reachable cả table main/modal. Giữ26units qua2pages và nhiệm kỳ không hiện hành khi switch; no Organization request/mutation; nhớ view qua reload/reauth và tách account/church; invalid/blocked storage vẫn đọc/switch; lead table không có board/full profile/leader/household fields hoặc actions ngoài quyền. Pending khóa switch, real-response-loss/reauth giữ UUID/không auto replay/không tăng version trùng.

Typecheck/lint(10warnings CSS source)/product build/reference build/ui:check/bash syntax/diff PASS. Đối chiếu **52 API file fingerprints không đổi**; reuse r1 API137tests/2133assertions và focused13tests/254assertions, generic browser2532checks của screens/shared components không đổi. Đây là bằng chứng r1 được đối chiếu, không gọi là run r2 hoặc cộng trùng vào1254checks. Không thay API/schema/quyền/data contracts.

Ảnh thực tế cùng fixture trước thay lịch: [Card](../../output/p2.4/r2/w04-complete-1440-light.png), [Bảng](../../output/p2.4/r2/w04-table-1440-light.png), [Bảng mobile dark](../../output/p2.4/r2/w04-table-390-dark.png), [lead table](../../output/p2.4/r2/w04-lead-table-1440-light.png), [26units](../../output/p2.4/r2/w04-paged-table-1440-light.png). Ảnh chỉ chứng minh render, checks/receipt chứng minh state/interaction tại mức local/synthetic.

### Sửa trong kiểm chứng/self-review

- DB fixture prefix ban đầu dài65 ký tự vượt giới hạn Mongo; rút prefix namespace UUID riêng, không đụng main.
- Đo đúng toolbar/table đang hiển thị trong cùng container, không lấy dialog đã đóng; giữ ngưỡng spacing.
- Thêm scope=col cho header mới để khai báo cột tường minh và kiểm qua role; không bỏ assertion header ngoài quyền.
- Assertion sau reauth dùng table cell và thêm assertion giữ view Bảng thay cho literal text chỉ có ở Card.
- Review ảnh thấy row mobile quá cao; thêm kiểm row-height, phát hiện153.5px ở bảng đã tải thêm. Sửa business layoutmin1040/actions280, nhãn action ngắn trong table nhưng aria-label đủ tên; final56.5–65px, cuộn tới cột cuối PASS. Không sửa palette/font/breakpoint/style shared.

### Checklist nghiệm thu r2

- [ ] Switch Card ↔ Bảng: còn đúng4groups, dữ liệu/count/actions như nhau theo quyền.
- [ ] Chọn nhiệm kỳ khác/tải thêm đơn vị rồi switch: giữ lựa chọn và toàn bộ trang đã tải.
- [ ] Reload/chuyển account/church: nhớ riêng view; preference không chứa hồ sơ/credential.
- [ ] Mobile/light/dark: bảng cuộn ngang, hàng gọn, cột thao tác cuối tới được; Card2→1 cột.
- [ ] Lead/pending/reauth: quyền không đổi, switch khóa khi chưa rõ kết quả thao tác.

Readback0DB P24-view còn lại. Không main DB init/restart3443, commit/push/deploy/dữ liệu thật. Server kiểm thử/container được dọn; ảnh/receipt Git-ignore chỉ local. Self-review source và ảnh; không reviewer độc lập. NOT_RUN Safari/thiết bị thật/remote CI/production. Server3443 chưa nâng cấp P2.4-r2.

[Planning2](../engineering/skill-usage/records/CHURCH-P2/P2.4-planning-2.json), [implementation2](../engineering/skill-usage/records/CHURCH-P2/P2.4-implementation-2.json). Skills frontend60%/testing40%, ước lượng đóng góp tổng100%, không đo time/token/effectiveness; counters thiếu để null.

Quyết định Khiêm: ☐ Chấp nhận r2 ☐ Yêu cầu sửa ☐ Tạm dừng. **Dừng trước P2.5**; P2.5/P2.6 chưa mở. Nghiệm thu r1/plan approval không được suy thành nghiệm thu r2 hay quyền publication.


## Human review2 — CHANGES_REQUESTED

Khiêm: “chưa nghiệm thu, Bộ switcher phải sử dụng icon thay text.” [Evaluation2](../engineering/skill-usage/records/CHURCH-P2/P2.4-human-review-2.json) liên kết implementation2, giữ nguyên r2receipt/journal tại thời điểm bàn giao. P24-04/05 cần sửa switcher icon-only, giữ tooltip/aria-pressed/aria-label và state/permissions. Trình kế hoạch/mockup bổ sung trong chat trước coding; chưa implementation kế hoạch icon, không mở P2.5/publication/deploy/dữ liệu thật. Không ghi lại usage r2.


## Quyền sửa icon — P2.4-icon-plan-r1

Khiêm “Duyệt” ngay sau mockup P2.4-icon-plan-r1: cho sửa P24-04/05, switcher icon-only grid/Card và table/Bảng; tooltip/aria-label/aria-pressed/disabled và mọi state/data/permissions giữ nguyên. Icon table bổ sung cùng chuẩn SVG shared; không CSS palette/font/breakpoint mới. Bàn giao P2.4-r3 local/synthetic để nghiệm thu rồi dừng trước P2.5; không commit/push/deploy/dữ liệu thật. R2/review2 giữ làm lịch sử. Trạng thái lúc mở: implementation IN_PROGRESS, icon checks NOT_RUN.


## Bàn giao P2.4-r3 — switcher icon-only

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P24-04 | Grid/Card và table/Bảng chỉ icon, tooltip/aria-pressed/aria-label/disabled, giữ state/scope | web/organization-runtime.tsx, web/ui/icons/index.tsx | Hoàn tất, verified Firefox | — |
| P24-05 | Kiểm icon/caller và shared UI, ảnh/receipt/journals | scripts/browser-organization-runtime.ts, docs/output | Hoàn tất, PASS local | — |

[Receipt r3](../../output/p2.4/r3/verification.json): **1407P24 +282shared UI =1689Firefoxchecks PASS**.170geometry samples, trong đó150samples thực sự có switcher: button không text,1SVG/nút, đủ labelCard/Bảng, chỉ1pressed, kích thước đều theo kit46×36desktop/46×44mobile. HoverCard/focusBảng tooltip và Escape, keyboardEnter, pendingdisabled, light/dark×1440/901/900/560/390 PASS. Cả suite view/state26units/2pages/noncurrent term/preference account-church/reload/reauth/invalid-blocked storage/scoped roster/response-loss retry và source style/tooltip/modal/focus shared UI được kiểm lại.

Typecheck/lint(10warnings CSSsource)/build/build:ui/ui:check/bash/diff PASS.52API files unchanged; kế thừa API/schema/race/security receipts r1/r2, không gọi là API run r3. Icon table là SVG bổ sung trong shared catalogue theo scope đã duyệt; grid/icon renderer/CSS source giữ nguyên. Không thay menu AppShell icon + tên.

Ảnh actual local/synthetic: [Card icon](../../output/p2.4/r3/w04-complete-1440-light.png), [Bảng icon/tooltip](../../output/p2.4/r3/w04-table-1440-light.png), [mobile dark](../../output/p2.4/r3/w04-table-390-dark.png). Trong ảnh table, chữ Bảng dưới nút là tooltip; bên trong hai button chỉ SVG. [P24 results](../../output/p2.4/r3/browser-results.json), [shared UI results](../../output/p2.4/r3/shared-ui/regression/ui-std-visual-results.json).

Self-review source/ảnh. Test mới ban đầu giả định square nhưng shared IconButton thực tế46×36/46×44; sửa phép kiểm theo shared dimensions/equal sizing/touch target, giữ icon-only/nhãn/pressed assertion, không sửa style kit để chiều theo test. Lint-only refactor predicate bỏ non-null assertions, revalidate cùng điều kiện trên150quan sát thực, không giảm ngưỡng.

Checklist nghiệm thu r3:
- [ ] Hai nút switch chỉ icon grid/table; tooltip và trạng thái đang chọn rõ.
- [ ] Chuyển view giữ group/data/selected term/pages/actions/scope/preference.
- [ ] Keyboard/mobile/light-dark và pending/reauth hoạt động đúng.

Readback0DB synthetic P24-view còn lại, môi trường test đã dọn. Không main DB init/restart3443, commit/push/deploy/dữ liệu thật. NOT_RUN Safari/thiết bị thật/remote CI/production; không reviewer độc lập. **R3 chờ Khiêm nghiệm thu; dừng trước P2.5**, không human accepted/released.

[Planning3](../engineering/skill-usage/records/CHURCH-P2/P2.4-planning-3.json), [implementation3](../engineering/skill-usage/records/CHURCH-P2/P2.4-implementation-3.json). Skills frontend60%/testing40%, ước lượng tổng100%, không đo thời gian/token/hiệu quả, missing counters null. Các record r2 và review2 không bị sửa/ghi lại usage.

## Human review 3 — ACCEPTED; mở kế hoạch P2.5

Khiêm: “Nghiệm thu P2.4-r3, mở kế hoạch P2.5.” (2026-11-12). P2.4-r3/P24-01–05 HUMAN ACCEPTED local/synthetic. P2.5 mở PLANNING_ONLY; CSV UTF-8 và Excel .xlsx theo lựa chọn Khiêm. P2.5-plan-r1/contracts/acceptance/mockup chờ duyệt trước coding. Không mở P2.6, commit/push/deploy hoặc dùng dữ liệu thật.

[Acceptance 3](../engineering/skill-usage/records/CHURCH-P2/P2.4-human-acceptance-3.json) liên kết implementation/3; không sửa receipt, usage hoặc trạng thái tại thời điểm bàn giao. Checklist r3 được Khiêm chấp nhận trong phạm vi local/synthetic; các giới hạn Safari/thiết bị thật/remote CI/production còn nguyên. Không chạy lại tests cho thao tác ghi nhận này.
