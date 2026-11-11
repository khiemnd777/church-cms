# UI-STD-r1 — Chuẩn UI từ HTML và chuyển P1.2

## Phê duyệt

Khiêm duyệt UI-STD-r1 và cho triển khai toàn bộ bộ UI chung, chuyển các màn hiện có, kiểm chứng P1.2, bàn giao trước P1.3. Kiểu bàn giao Theo roadmap, thuộc sửa P1.2, một gói nghiệm thu.

## Hạng mục đã duyệt

- UI01: tokens/base/layout/theme/spacing/icon từ HTML chuẩn; sidebar256/drawer272, drawer breakpoint900/form560, source hash được lưu.
- UI02: component khung, controls/form, feedback, table/card/KPI/key-value, modal/drawer/tab và icon nguồn; không business rules/API trong kit.
- UI03: A01/A04/hỗ trợ/reauth và O01/O02 dùng bộ chung; loại style cũ song song; không sửa backend/schema. Header tách cấp, info compact, null/— trung thực, unavailable actions thứ yếu.
- UI04: trang tham chiếu cục bộ không menu sản phẩm; đối chiếu HTML tại cùng viewport/theme/font/trạng thái; kiểm tra responsive quanh900/560, keyboard/error/pending/CAS/F22.
- UI05: docs/ui-system.md + AGENTS pointer và check nhẹ bắt màu/font/breakpoint/override tự đặt. Task sau kế thừa, thiếu mẫu phải bổ sung bộ chung theo nguồn.

## Trình tự/điểm dừng

Hoàn tất production UI và wiring trước tests, sau đó kiểm chứng và bàn giao một lần. Giữ contracts/quyền/CAS/idempotency/F22. Không Storybook/UI library mới, không thêm P1.3, Git publication hoặc deploy. Human acceptance và fidelity không suy từ test chức năng PASS.

## Bàn giao UI-STD-r1 · 2026-11-11

**SOURCE COMPLETE · LOCAL VERIFIED · HUMAN ACCEPTANCE PENDING_REVIEW · NOT RELEASED.** P1.2-r1 cũ giữ nguyên CHANGES_REQUESTED. Không mở P1.3.

```text
✓ Đã nghiệm thu:  P0-FOUNDATION-r2 · P1.1-r1
◉ Chờ nghiệm thu: P1.2 — Quản lý Hội Thánh + UI-STD-r1
→ Tiếp theo:      P1.3 — Cấp/quản lý truy cập user (chưa được mở)
○ Sau đó:         P1.4 — Kiểm chứng tích hợp
```

### WHAT

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| UI01 | Chuẩn style từ HTML, hai theme và icons nguồn | web/ui/styles, web/ui/icons, web/ui/source.json | Hoàn tất; source drift PASS | — |
| UI02 | Component dùng chung và contracts nhỏ | web/ui/components | Hoàn tất; style/geometry/keyboard được kiểm chứng cục bộ | — |
| UI03 | Chuyển A01/A04/hỗ trợ/reauth/O01/O02; bỏ style cũ | web/main.tsx, web/church-management.tsx, web/style.css, web/church-management.css | Hoàn tất; owner62 và P1.2 88 checks PASS | — |
| UI04 | Gallery cục bộ, đối chiếu HTML và kiểm chứng P1.2 | web/ui/reference.tsx, ui-reference.html, scripts/browser-*.ts | Hoàn tất; UI chung278 checks, API38tests PASS | — |
| UI05 | Quy tắc kế thừa và kiểm tra style cho task sau | docs/ui-system.md, AGENTS.md, scripts/ui-standard-check.ts | Hoàn tất; source/feature guard PASS | — |

UI kit không giữ business state/API/tenant. CAS/idempotency/F22/reauth và các chuyển trạng thái vẫn do caller/API sở hữu; cả19file API giữ nguyên SHA256 so với baseline đầu gói. Không thêm UI library/dependency.

### Ảnh runtime

![O02 sáng desktop](../../output/ui-std-p12-o02-1440-light.png)
![O02 tối mobile](../../output/ui-std-p12-o02-390-dark.png)

UI-STD-r1 · ảnh Firefox từ bundle đã kiểm chứng, dữ liệu synthetic. Đây là ảnh runtime, không mockup/ảnh AI. Các pattern chung được so với CSS nguyên bản và cùng font/viewport/theme; HTML nguồn không có literal O01/O02 nên không tuyên bố pixel-match toàn màn. Xem khác biệt owner/wordless/mobile tại [ui-system](../ui-system.md).

Ảnh khác: [O01 sáng](../../output/ui-std-p12-o01-1440-light.png), [O01 tối/mobile](../../output/ui-std-p12-o01-390-dark.png), [biểu mẫu mobile](../../output/ui-std-p12-edit-mobile-dark.png), [A01 tối/mobile](../../output/ui-std-owner-a01-390-dark.png), [A04](../../output/ui-std-owner-a04-1440-light.png), [reauth](../../output/ui-std-owner-reauth-390-dark.png), [hỗ trợ](../../output/ui-std-owner-support-390-light.png), [fixture CSS nguồn](../../output/ui-std-source-patterns-1440-light.png), [fixture React](../../output/ui-std-patterns-1440-light.png).

### Bằng chứng kỹ thuật

| Kiểm tra | Kết quả thực tế | Bằng chứng |
|---|---|---|
| bun run ui:check | PASS: SHA HTML, prelude/tokens/base/patterns, 4file feature kế thừa kit | output/ui-std-source-check.log |
| bun run lint | PASS, không error; giữ10warnings `!important`/specificity từ CSS nguồn | output/ui-std-lint.log |
| bun run typecheck, build, build:ui; bash -n scripts/browser-check.sh | PASS; gallery xuất riêng khỏi product dist | output/ui-std-typecheck.log, ui-std-build.log, ui-std-reference-build.log |
| bun run test:ui | 278checks PASS. 1440/1024/901/900/768/561/560/390, light/dark; style nguồn, form/card/button/KV/table, theme đổi trực tiếp/explicit override, tooltip, keyboard/tab/modal/drawer | output/ui-std-visual-results.json, ui-std-visual.log |
| bun run test:browser:p1.2 | 88checks PASS: ma trận O01/O02, CRUD/status, phone0, null/—, CAS hai tab, replay cùng key và F22 sau commit thật, phân trang/tìm kiếm, focus/modal | output/ui-std-p12-browser-results.json, ui-std-p12-browser.log |
| bun run test:browser | 62checks PASS: A01/A04/reauth/hỗ trợ sáng/tối/responsive, network recovery, logout/nav keyboard | output/ui-std-owner-browser-results.json, ui-std-owner-browser.log |
| bun test --timeout 30000 tests | 38tests/347assertions PASS trên Mongo replica set + Redis thật, database thử riêng được dọn | output/ui-std-integration.log |
| HTTP local/TLS và bundle | Ready/login200; gallery product404, preview200; served HTML khớp đúng hash bundle đã test | output/ui-std-verification.json |
| Backend invariant | 19/19 API files không đổi hash | output/ui-std-api-baseline.json, ui-std-verification.json |

Tổng428 browser checks, tách khỏi38tests API. Faults được inject sau real database commit tại driver/transport boundary; không phải production failover proof. Lỗi phát hiện đã sửa tại shared Field (nhãn/hint), Tooltip (viewport và Escape) và Modal (vòng Tab/focus). Rà cuối bổ sung target44px và font16px cho tất cả controls mobile, gồm cả link/search/filter/Choice, kèm regression trên các màn hiện có. Diagnostic của lượt thất bại trước giữ ở output/ui-std-diagnostics, không là trạng thái hiện hành.

Tự review đã kiểm tra source provenance, overrides, semantic labels, theme/responsive, focus, unknown state và API hash. Không reviewer độc lập. **NOT_RUN:** thiết bị thật/Safari, remote CI (chưa có Git repository/publication), human UAT, production, P1.3 và qualification P1.4. Không thay các giới hạn lịch sử thành PASS.

### Xem cục bộ / checklist nghiệm thu

Trang mẫu đang phục vụ tại [UI reference](http://127.0.0.1:4173/ui-reference.html); sản phẩm tại [Owner](https://localhost:3443/owner/login). Đây là loopback cục bộ, không public deployment. Khởi động lại gallery bằng `bunx --no-install vite preview --host 127.0.0.1 --port 4173 --strictPort --outDir output/ui-reference-dist` sau build:ui.

- [ ] Xem bộ chung sáng/tối, đổi theme hệ thống và thu viewport quanh900/560 → style kế thừa HTML, navigation/form chuyển bố cục nhất quán.
- [ ] Trên dữ liệu thử: O01 → tạo/mở/sửa O02 → thông tin compact, “—” trung thực, số0 thật riêng, unavailable thứ yếu và status action tách riêng.
- [ ] Dùng Tab/Shift+Tab/Escape với form và điều hướng mobile → nhãn rõ, focus không thoát modal và trở về trigger khi đóng.

### Skills và journal

| Skill | Nguồn | Đóng góp thực tế | Ước tính % |
|---|---|---|---|
| frontend-ui-engineering | Repo | Chuẩn HTML, bộ chung, migration và rendered verification | 65 |
| api-and-interface-design | Repo | Contracts component/caller; giữ API và state nghiệp vụ | 20 |
| incremental-implementation | Repo | Code/wiring hoàn chỉnh trước tests, tích hợp và bàn giao trọn gói | 15 |

[Implementation event](../engineering/skill-usage/records/CHURCH-P1/UI-STD-r1-implementation-1.json), [correction sau rà cuối](../engineering/skill-usage/records/CHURCH-P1/UI-STD-r1-implementation-1-correction-1.json). Tỷ lệ là ước tính đóng góp, không là số đo thời gian/token/hiệu quả. Các counters chưa đo giữ null.

**Quyết định của Khiêm:** ☐ Chấp nhận ☐ Yêu cầu sửa ☐ Tạm dừng.

**Bước tiếp theo:** ưu tiên nghiệm thu UI-STD-r1/P1.2 theo ảnh và luồng cục bộ; hoặc chỉ ra điểm chưa đạt để sửa ở bộ chung. Chỉ mở P1.3 sau khi Khiêm nghiệm thu và cấp quyền mở riêng. Không Git publication/deploy tự động.

## Human review — CHANGES_REQUESTED: thiếu text sidebar

Khiêm: “Chưa nghiệm thu được, vì bị mất text!”, kèm ảnh sidebar chỉ có icon nhà/người. Đã xác minh tại `AppShell`: `items[].label` có dữ liệu, nhưng nav button chỉ render Icon; text không có trong DOM hiển thị, chỉ nằm ở aria-label/title/Tooltip. Đây không phải chữ trắng trên nền trắng hoặc font chưa tải. HTML gốc có span nhãn; bảng wordless cũ ở CHURCH-P0 mục6 đã ẩn nhãn mục. Phản hồi mới yêu cầu điều chỉnh quy tắc này; chưa coding hoặc thay contract trước khi trình phạm vi sửa.

Receipt: [human-review-1](../engineering/skill-usage/records/CHURCH-P1/UI-STD-r1-human-review-1.json). 428checks trước giữ làm bằng chứng của lượt bàn giao; không kiểm tra nhãn menu hiện thường trực và không thay human acceptance. Trạng thái hiện hành: CHANGES_REQUESTED; P1.3 vẫn chưa mở.

## Phê duyệt sửa nhãn menu — N01–N03

Khiêm trả lời “Approved” cho phạm vi: N01 phục hồi icon+tên/trạng thái tại AppShell chung; N02 cập nhật quy tắc kế thừa; N03 regression nhãn hiển thị thực trên desktop/mobile và hai theme, giữ disabled/focus. Kiểu bàn giao Theo roadmap P1.2/UI-STD-r1, một lần bàn giao sau kiểm chứng; chưa mở P1.3. N01/N02 source/wiring đã hoàn tất; N03 đã kiểm chứng, kết quả tại bàn giao UI-STD-nav-r2 bên dưới. Không đổi backend/schema/phân quyền hoặc các rules wordless khác.

## Bàn giao lại — UI-STD-nav-r2 · N01–N03

**SOURCE COMPLETE · LOCAL VERIFIED · HUMAN ACCEPTANCE PENDING_REVIEW · NOT RELEASED.** Bản r1 bị từ chối vẫn giữ receipt CHANGES_REQUESTED. Đây là handoff2 trong cùng P1.2/UI-STD-r1, không phải gói roadmap mới hoặc tự nghiệm thu.

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| N01 | Icon + nhãn menu hiển thị, description riêng | web/ui/components/index.tsx, web/main.tsx, web/ui/styles/adapters.css | Hoàn tất, kiểm chứng runtime | — |
| N02 | Menu luôn có tên trên desktop/mobile, thay rule ẩn chữ cũ | ui-system.md, AGENTS.md, CHURCH-P0, project-context/plan | Hoàn tất | — |
| N03 | Regression nhìn text thật, không chỉ aria-label | browser-check.ts, browser-ui-standard.ts | PASS399checks;10cấu hình menu | — |

![Sidebar sáng desktop](../../output/ui-std-nav-r2/nav-crop-1440-light.png)
![Sidebar tối mobile](../../output/ui-std-nav-r2/nav-crop-390-dark.png)

Ảnh screenshot cắt tại viewport bằng Playwright của ứng dụng owner thực, Firefox, dữ liệu synthetic. Không phải mockup/ảnh AI. Full views: [desktop](../../output/ui-std-nav-r2/nav-1440-light.png), [mobile drawer](../../output/ui-std-nav-r2/nav-390-dark.png).

Đã sửa nguyên nhân tại AppShell chung: trước chỉ render Icon, nay luôn render label; description không thay label. Tài khoản giữ disabled và hiện “Chưa khả dụng”. Menu có chữ nên bỏ tooltip trùng nhãn để tránh che dòng kế tiếp khi focus. Kích thước256/272, breakpoint900, colors nguồn, active state và caller không đổi; các rules wordless khác không đổi.

Kiểm chứng:

- PASS `bun run format`, `bun run lint` (10warnings CSS gốc), `bun run typecheck`, `bun run ui:check`. Hai build PASS qua browser helpers.
- PASS `bun run test:ui`:280checks; gallery caller dùng cùng AppShell và thấy nhãn trên desktop/mobile, giữ common patterns/theme/keyboard.
- PASS `bun run test:browser`:119checks; gồm10cấu hình light/dark ×1440/901/900/560/390. Assert `.ui-nav-label`/`.ui-nav-description` thực sự visible, đúng innerText, bounds nằm trong button/sidebar, colors kế thừa; active/disabled, root không overflow và Escape trả focus. Click menu vẫn gọi GET O01 thật.
- PASS19 API file hashes không đổi. Không chạy lại API38tests/347assertions hoặc suite CAS/F22 cho sửa nhãn; receipt r1 giữ làm bằng chứng lịch sử cho phần không tác động.
- PASS local ready/login/preview200 và HTML phục vụ khớp hash bundle đã test. Đã mở lại hai tiến trình local vì tiến trình cũ đã dừng; không migration/seed/Git publication/deploy.
- NOT_RUN physical mobile/Safari, remote CI/human UAT đầy đủ/production. Tự review, không reviewer độc lập; human visual acceptance đang chờ.

[Receipt tổng hợp](../../output/ui-std-nav-r2/verification.json); log/JSON/ảnh của sửa nhãn ở output/ui-std-nav-r2, không ghi đè ảnh/receipts r1 bị từ chối. [Journal handoff2](../engineering/skill-usage/records/CHURCH-P1/UI-STD-r1-implementation-2.json); phần kế hoạch lưu sau approval: [planning](../engineering/skill-usage/records/CHURCH-P1/UI-STD-nav-r2-planning-1.json). Skills implementation: frontend-ui-engineering Repo80%, debugging-and-error-recovery Repo20%; tổng100% là ước tính đóng góp, các counters chưa đo giữ null.

Checklist nghiệm thu lại:
- [ ] Tải lại trang owner: nhìn thấy “Hội Thánh”, “Tài khoản” và “Chưa khả dụng” ở sidebar.
- [ ] Mở drawer mobile ở hai theme: nhãn đọc được, không cắt và không bị tooltip che; Escape trả focus.
- [ ] Tài khoản vẫn khóa; chọn Hội Thánh vẫn mở/tải O01.

Đã nghiệm thu: P1.1 Owner. Chờ nghiệm thu: P1.2 Quản lý Hội Thánh + UI-STD-r1/NAV-r2. Tiếp theo: P1.3 Cấp/quản lý truy cập user (chưa mở). Sau đó: P1.4 Kiểm chứng tích hợp.

Bước tiếp theo: Khiêm nghiệm thu lại sửa nhãn và P1.2, hoặc nêu điểm còn chưa đạt trong gói. Chỉ mở P1.3 sau nghiệm thu và quyền mở riêng.

## HUMAN ACCEPTED cùng P1.2

Khiêm đã nghiệm thu P1.2 sau bản sửa nhãn UI-STD-nav-r2; [evaluation](../engineering/skill-usage/records/CHURCH-P1/UI-STD-r1-human-acceptance-2.json) nối handoff2. Gói UI được chấp nhận trong phạm vi bàn giao cục bộ, không tự released/production-qualified. Các biên bản CHANGES_REQUESTED và handoff cũ giữ nguyên. Tiếp theo chỉ lập kế hoạch P1.3; chưa có quyền coding.
