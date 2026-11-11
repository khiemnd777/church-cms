# UI-STD-r1 — Bộ UI dùng chung Church CMS

## Nguồn và quyền thay đổi

Chuẩn style là `documents/Quản lý Hội Thánh Tin Lành(1).html` (tên file Unicode có thể decomposed trên macOS), SHA256 `4bdc4ebdb3bcc7ccb98e675162ef9f14568c46bf9b1ad2d38c9a979cda2dc8b6`. Khiêm duyệt UI-STD-r1: dùng bộ chung cho tất cả task tiếp theo, chuyển toàn bộ màn hiện có, kiểm chứng P1.2 và dừng trước P1.3. Không suy ra quyền mở nghiệp vụ mới hay phát hành.

`web/ui/source.json` lưu revision và khác biệt đã duyệt. `prelude.css`, `tokens.css`, `base.css`, `patterns.css` được tách nguyên stylesheet HTML, chỉ format; không sửa tay. `adapters.css` là nơi duy nhất cho điều chỉnh semantic/accessibility/owner đã duyệt. `web/style.css` chỉ là entry import. `web/church-management.css` chỉ bố trí nội dung nghiệp vụ; không định nghĩa lại control/màu/font/border của kit.

## Thứ tự nguồn

1. HTML gốc: màu/theme, typography, spacing, radius, shadows, breakpoint, biểu tượng và common patterns.
2. Các mockup owner/wordless đã duyệt: nội dung, hierarchy, những phần HTML không có.
3. UI-STD-r1: O02 compact info/KPI, unavailable actions thứ yếu, status action riêng; mobile ưu tiên tên Hội Thánh.
4. Khi thiếu mẫu: tìm pattern tương đương trong HTML, đưa adaptation nhỏ vào bộ chung và ghi lý do. Thay đổi đáng kể cần trình lại phạm vi/mẫu; không tự chế style trong màn nghiệp vụ.

HTML không có literal O01/O02 hay A01/A04 hiện tại. Đối chiếu common patterns không có nghĩa mọi pixel của các màn owner tồn tại trong HTML hoặc đã được người dùng nghiệm thu.

## Nền tảng

| Thành phần | Chuẩn từ HTML |
|---|---|
| Theme | `--bg`, `--surface`, `--surface-2`, `--line`, `--fg`, `--muted`, `--primary`, semantic good/warn/bad… giữ nguyên cả hai bảng màu |
| Typography | Be Vietnam Pro 400/500/600/700; Lora 600/700. Font tự phục vụ từ package có sẵn, không tải Google Fonts runtime |
| Shell | sidebar256px; <=900px drawer272px; header title16px/context11px; content padding22/24, gap18 |
| Controls | button13px/600, padding8×13, radius9; input/select padding8×11, radius9 |
| Card | padding18, radius14, border và shadow từ token |
| Form | 2 cột gap12; <=560px một cột; field label12px/600, gap5 |
| Modal | width min720px/viewport−32px, max-height viewport−48px, padding22, radius16 |
| Drawer chi tiết | width min460px/100%; khác drawer điều hướng272px |
| Key-value | label130px / nội dung co giãn, gap6×10; <=560 label110px |
| Table | header/cell/pill theo nguồn; cuộn trong `.tbl-wrap`, không làm tràn trang |
| Icons | SVG path trong `P` của HTML; menu từ HTML, logout giữ bổ sung owner đã duyệt; dùng mũi tên chữ như nguồn |

Theme mặc định theo OS (`prefers-color-scheme`) và cập nhật trực tiếp khi OS đổi. `data-theme=light/dark` có ưu tiên khi host chủ động đặt; chưa thêm theme selector vào sản phẩm. Selector chỉ có trong trang mẫu cục bộ.

## Nhãn điều hướng — điều chỉnh đã duyệt sau phản hồi mất text

Menu dùng **icon + tên hiển thị thường trực** trên desktop và drawer mobile. Tên chỉ có trong aria-label/title/tooltip không đủ nghiệm thu. Giữ nguyên kích thước sidebar/drawer, thứ tự, màu chọn và trạng thái disabled từ nguồn. `AppShell.items` nhận `label` và `description?`; description hiển thị dòng phụ (ví dụ “Chưa khả dụng”), không thay nhãn mục. Rule này thay quy tắc ẩn nhãn menu của bản wordless cũ; các quy tắc wordless khác giữ phạm vi đã duyệt. Mọi caller AppShell kế thừa cùng một renderer, không tự ẩn chữ menu. Menu không cần tooltip trùng nhãn; tránh tooltip từ focus che mục kế tiếp khi mở drawer. Tooltip vẫn dành cho nút chỉ có icon.

## Component và contracts

Tất cả caller nhập từ `web/ui/components`; biểu tượng từ cùng export `Icon`. Bộ chung không gọi API, không giữ churchId/owner grants, không xử lý CAS/F22 hoặc tạo số liệu.

| Nhóm | API dùng chung | Trách nhiệm caller |
|---|---|---|
| Khung | AppShell, AuthCard, Brand | title/context/identity/activeId, navigation, logout thực |
| Controls | Button, IconButton, Tooltip | action, accessible label; default button type=button; submit phải chỉ rõ |
| Form | Field, TextInput, Select, TextArea, Choice | value/events, required, validation; Field nối nhãn riêng bằng aria-labelledby; error/hint bằng aria-describedby |
| Nội dung | Card, SectionHeader, Badge, KeyValueList | label/value/tone đã xác định; hiển thị `null` theo nghiệp vụ |
| Số liệu | StatCard, Stats | giá trị thật; unavailable hiển thị “—”, không đổi null thành0 |
| Danh sách | Toolbar, TableFrame, PaginationControl | semantic table, tìm/lọc/paging tại API; kit không tải/lọc dữ liệu |
| Phản hồi | Feedback, EmptyState, Loading | thông báo có nghĩa, trạng thái thật; không giả thành công |
| Tương tác | Tabs, Modal, Drawer, DialogActions | state mở/chọn, quyền, pending/locked, submit/cancel. Native dialog + vòng Tab giữ focus/Escape; locked không cho đóng |

Tabs nhận id riêng, caller nối panel bằng `${id}-panel-${item.id}`/`${id}-tab-${item.id}` để tránh trùng và giữ aria-controls/labelledby. Tabs dùng keyboard Left/Right/Home/End, bỏ qua disabled. Caller cung cấp nội dung theo tab được chọn. Không dựng abstraction data-grid/form engine mới. Modal dùng native `<dialog>` với CSS nguồn; không đóng khi click backdrop để tránh mất intent trong luồng CRUD. Khi đóng trả focus về trigger còn tồn tại. Drawer điều hướng có Escape/Tab vòng/khôi phục focus, background inert và tự đóng khi sang desktop.

## Adaptations có chủ đích

- Native dialog thay demo div+scrim: giữ geometry/theme nguồn, bỏ UA margin/max-width/border để tránh lệch; mở focus vào field đầu tiên, vòng Tab tường minh và trả focus khi đóng. Heading được focus để định hướng nhưng không vẽ viền control quanh tiêu đề.
- Header action căn phải kế thừa `.card-h .link` của nguồn và mockup owner; caller có thể dùng nút Sửa secondary. Fixture source chỉ dùng common CSS nguyên bản, không tuyên bố pixel-match toàn bộ owner header.
- Tooltip theo token nguồn, tự giới hạn vị trí trong viewport, chỉ xuất hiện khi hover/focus và đóng bằng Escape; không tạo overflow khi ẩn. Wrapper không nhận thao tác thay button.
- Semantic dl/dt/dd thay span/b: giữ cột/gap/font nguồn; label nối field, errors/live feedback và tooltip cho các nút chỉ có icon.
- O02 stat compact dùng Lora24 từ mini patterns, hiển thị unknown trung thực, không thành5card KPI lớn. Cùng một StatCard có variant đầy đủ `.kpi` cho nhu cầu được duyệt sau.
- Các nhóm unavailable/status và bố cục record nằm trong phạm vi owner đã duyệt; không đưa business rules vào kit.
- <=560px controls chạm tối thiểu44px; input16px để giảm auto-zoom mobile. Đây là adaptation mobile đã nêu trong chuẩn, không tuyên bố khớp tuyệt đối kích thước nguồn ở mốc này.
- Các pattern demo tương lai trong stylesheet nguồn được giữ để tra cứu, không có demo business logic/routes trong sản phẩm.
- Các cảnh báo CSS `!important`/print giữ nguyên từ HTML. Không hạ lint gate; kiểm tra source drift khóa nguyên stylesheet. Hai suppression cục bộ có lý do accessibility: vùng bảng cuộn cần Tab và wrapper tooltip chỉ quan sát hover/focus của button.

## Trang mẫu và quy trình task sau

`bun run build:ui` xuất `output/ui-reference-dist/ui-reference.html` riêng; không nằm trong product `dist`, menu hay API routes. Có thể xem cục bộ bằng `bunx --no-install vite --host 127.0.0.1` rồi mở `/ui-reference.html`; không publish. Trang mẫu có controls/states/forms/table/stats/tabs/modal/drawer/theme và dữ liệu minh họa, không truy cập dữ liệu thật. `?fixture=1` là fixture common patterns phục vụ đối chiếu.

Task UI tiếp theo phải: xác định source pattern → dùng component hiện có → cập nhật kit nếu thiếu mẫu nhỏ trong phạm vi đã duyệt → kiểm tra cả light/dark/responsive/keyboard → ghi bằng chứng và giới hạn. Không sao chép CSS sang module khác hoặc thêm UI library/inline colors/fonts. Screen CSS chỉ chứa bố trí nội dung và breakpoint900/560.

## Kiểm tra

- `bun run ui:check`: source SHA/CSS nguyên bản và cấm feature tự định nghĩa palette/font/breakpoint/component override. Guard này nhỏ, không chứng minh toàn bộ UX; reviewer vẫn phải xem ảnh/runtime.
- `bun run lint`, `bun run typecheck`, `bun run build`, `bun run build:ui`.
- `bun run test:ui`: Firefox local cô lập, common-pattern computed style/geometry, theme live/override, responsive quanh900/560 và keyboard/modal/drawer.
- `bun run test:browser` + `bun run test:browser:p1.2`: luồng thực với Mongo/Redis synthetic, quyền/CAS/idempotency/F22; không thay nghiệm thu thị giác.
- `bun test --timeout 30000 tests`: regression API. Backend phải giữ nguyên trong UI-STD-r1, đối chiếu baseline hash trong output.

Trạng thái thực tế và evidence được ghi trong `docs/project-state.md` và `docs/tasks/UI-STD-r1.md`; tài liệu chuẩn này không tự tuyên bố kiểm tra PASS hoặc human ACCEPTED.
