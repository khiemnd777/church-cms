# Hiện trạng Church CMS

Cập nhật: 2026-11-11. Đây là bản tóm tắt hiện hành duy nhất. Authority/acceptance chi tiết: [CHURCH-P0](tasks/CHURCH-P0.md), [CHURCH-P1](tasks/CHURCH-P1.md), [UI-STD-r1](tasks/UI-STD-r1.md).

## Git publication — 2026-11-11

- Khiêm đã duyệt kế hoạch khởi tạo Git, commit và push repository `khiemnd777/church-cms`. Remote trống đã được kiểm tra; nhánh ban đầu `main`. Publication không mở P2 hoặc cấp quyền deploy.
- Kiểm tra trước publication: lint PASS (10 warnings CSS có sẵn), typecheck/product build/reference build/ui:check PASS; integration 76 PASS/997 assertions với MongoDB/Redis local. Browser/remote CI chưa chạy lại trong task này.
- `.env`, `.local/`, dependencies, build và `output/` không đưa lên Git; liên kết bằng chứng `output/` trong tài liệu chỉ dùng ở workspace local. Trạng thái publication thực tế đối chiếu Git refs/local–remote; journal lưu checkpoint trước commit.

## Trạng thái hiện hành

- **P1 CLOSED — P1.1/P1.2/P1.3/P1.4 HUMAN ACCEPTED** theo Khiêm: “Nghiệm thu P1.4 và Đóng P1. Chưa mở P2.” [Biên bản đóng P1](tasks/CHURCH-P1.md#đóng-p1), [acceptance P1.4](engineering/skill-usage/records/CHURCH-P1/P1.4-human-acceptance-1.json).
- **P2 NOT_OPENED**. Chưa quyền lập kế hoạch/implementation P2; không publication/deploy/dữ liệu thật. Kết quả local không thay release/production qualification.

- **P0-FOUNDATION-r2 và P1.1-r1 HUMAN ACCEPTED**. P1-plan-r1/hai mockup đã được duyệt; không suy rằng các gói sau tự được mở.
- **P1.2 Quản lý Hội Thánh, gồm UI-STD-r1/UI-STD-nav-r2: HUMAN ACCEPTED** theo lời Khiêm “Nghiệm thu P1.2. Tiếp theo, kế hoạch P1.3”. [Acceptance P1.2](engineering/skill-usage/records/CHURCH-P1/P1.2-human-acceptance-2.json), [acceptance UI](engineering/skill-usage/records/CHURCH-P1/UI-STD-r1-human-acceptance-2.json).
- Các lần CHANGES_REQUESTED vì UI và mất text trước đây giữ nguyên làm lịch sử; không xóa receipt hoặc ghi lại usage.
- **P1.3-r1: HUMAN ACCEPTED** theo Khiêm “Hiểu rồi, nghiệm thu P1.3. Tiếp theo, kế hoạch P1.4”. Phạm vi [CHURCH-P1.3](tasks/CHURCH-P1.3.md). **P1.4-r1 HUMAN ACCEPTED — P1 đã đóng**. Không Git publication/deploy, production hoặc dữ liệu thật.

## P1.4-r1 — kết quả hiện hành

- P14-01–06 hoàn tất. F23 owner-safe, đủ28endpoint; [ma trận26AC](engineering/P1.4-acceptance-matrix.md), [contracts/runbook](engineering/P1.4-qualification.md), [biên bản/checklist](tasks/CHURCH-P1.4.md). **P2 NOT_OPENED**, P1.4 đã human accepted; chưa released.
- **PASS76integration tests/997assertions**, Mongo replica set/Redis thật ở DB synthetic riêng. F23/DTO/cursor/global–church/auth/faults và real barrier revoke/permission; sửa account VERSION_CONFLICT412/RECENT_AUTH_REQUIRED403 theo r2, giữ error.code/quy tắc. **PASS658Firefox checks** (171account/user+88P1.2+119owner+280UI), cả F05lost response và owner2tabs2church với dual cookies. UI/source style giữ nguyên.
- **PASS100church/10.000account/100.000audit fixtures (+5operational events)**, hash riêng;3300HTTP samples/33cấu hình1/5/10,0errors, p95=4.31–27.57ms, RSSpeak532MiB của client/server/seed cùng process. Explain F10/F15/F23 indexed, hash1/2/4 PASS. Không production SLA/capacity.
- **PASS restore8collections**: data/index key order/validator fingerprints khớp; revoke2restored sessions, old owner/user401, fresh login/F23/ready PASS. Dump550ms/restore1548ms chỉ subprocess, không RTO. Cleanup/readback0leftover DB/private directory; main/volumes/shared services không bị sửa bởi bộ đo. Ledger collection trống ở workload; integration riêng kiểm ledger atomicity/replay.
- **PASS** lint(10warnings source CSS)/typecheck/product+reference build/ui:check/shell/YAML source check/audit `{}`/HTTPS readback bundle parity. [Receipt](../output/p1.4/verification.json), [đo](../output/p1.4/qualification.json), [restore](../output/p1.4/restore.json), [journal](engineering/skill-usage/records/CHURCH-P1/P1.4-implementation-1.json).
- **NOT_RUN:** remote CI/Linux runner/physical devices/Safari/OS clipboard/production failover/real-data restore/RPO-RTO. CI source cấu hình, workspace chưa Git repo; không publication/deploy. Self review, không reviewer độc lập. Liên kết account–thuộc viên/P2/self business chưa triển khai; không suy từ26AC PASS theo scope P1.

## P1.3-r1 — kết quả hiện hành

- P13-01–05 hoàn tất:14routes mới, tổng27active; O03/F15–19/F21, user A01/A04/F02–07, F09/F24, menu/O02/account counts. Contracts/limits ở [P1.3 accounts](engineering/P1.3-accounts.md), biên bản/checklist tại [CHURCH-P1.3](tasks/CHURCH-P1.3.md).
- **PASS63integration tests/789assertions** (25tests P1.3), Mongo replica set/Redis thật và dữ liệu synthetic riêng tự dọn. **PASS652browser checks**:165P1.3 +88P1.2 +119owner +280UI. Hai theme, viewport1440/901/900/560/390, visible labels/scroll/dialog focus/Tab/Escape, real auth/CAS/retry/F22.
- **PASS** formatter/lint(10warnings từ CSS nguồn)/typecheck/UI source guard/product+reference build/shell syntax/db:init local. HTTPS readiness/static readback và product/gallery bundle hashes khớp suite tương ứng. Explain601 synthetic accounts, không SLA production.
- Owner admin accounts khi church suspended; user login/context/F24 bị chặn. Role Trưởng ban cần catalogue P2 chưa có nên API422/UI không cho chọn; không target giả hoặc scope nới rộng. Business modules vẫn chưa khả dụng.
- [Receipt](../output/p1.3/verification.json), [ảnh O03](../output/p1.3/o03-1440-light.png), [user mobile](../output/p1.3/user-context-390-dark.png), [journal](engineering/skill-usage/records/CHURCH-P1/P1.3-implementation-1.json). **HUMAN ACCEPTED, chưa released**; [acceptance](engineering/skill-usage/records/CHURCH-P1/P1.3-human-acceptance-1.json). Self review kỹ thuật. NOT_RUN thiết bị thật/Safari/remote CI/production/UAT/failover/backup-restore tổng thể. P1.4 đã nghiệm thu và P1 đã đóng; P2 chưa được mở; không seed accounts/churches vào DB main.

## Đã có

- P1.1: owner realm/auth/CSRF/rate-limit/audit; A01/A04/hỗ trợ/reauth; Bun HTTPS cùng origin, React/TS/Vite/Tailwind, Mongo replica set/Redis. P1.1 đã được Khiêm nghiệm thu, không ghi lại usage.
- P1.2: F10–F14/F22, O01/O02; Tenancy/Operations/Audit qua OwnerGrant/fence. Tạo/tìm/lọc/keyset/sửa/status với CAS/idempotency/atomic audit, giữ phone0/contact PATCH omit-null; account counts scoped và P2 null/—.
- UI-STD-r1: `web/ui` chứa stylesheet/icon nguồn và semantic adapters/components; main/church-management dùng kit; `web/style.css` chỉ import, feature CSS chỉ bố trí nội dung. Header phân cấp, O02 thông tin/stat compact, unavailable phụ, status riêng; light/dark theo OS, responsive900/560.
- [ui-system](ui-system.md) + AGENTS pointer + `bun run ui:check` yêu cầu task sau kế thừa bộ chung; trang mẫu local xuất riêng khỏi product build, không menu/routes sản phẩm. P1.3 là gói kế thừa đầu tiên; bằng chứng trong output/p1.3.
- P1.3 đã hoàn tất code/wiring và kiểm chứng O03/user auth/context. O02/menu/counts nối thực tế. Business modules/cấu hình W12/P2 chưa khả dụng. Contracts: [P1.3 accounts](engineering/P1.3-accounts.md).

## Bản sửa nhãn menu — UI-STD-nav-r2

- N01/N02/N03 hoàn tất: tên menu hiển thị trên desktop/mobile; “Tài khoản” lúc bàn giao P1.2 disabled, có dòng “Chưa khả dụng”; P1.3 nối mục này theo church đang chọn. Cập nhật rule thay ẩn nhãn wordless; bỏ tooltip menu trùng chữ để không che mục kế tiếp.
- **PASS** 280checks UI chung +119checks owner =399checks lần sửa này; trong đó10cấu hình light/dark ×1440/901/900/560/390 xác nhận visible DOM text, không cắt/overflow, colors kế thừa, active/disabled và Escape/focus. Navigation gọi O01 API thật.
- **PASS** formatter/lint(10warnings nguồn)/typecheck/product+reference build/source guard.19 API files không đổi hash. API/CAS/F22 không chạy lại cho sửa navigation; bằng chứng cũ bên dưới chỉ được tái sử dụng cho phần không ảnh hưởng.
- HTTP ready/login và gallery preview200; served HTML khớp bundle đã test. [Receipt](../output/ui-std-nav-r2/verification.json), [ảnh sáng](../output/ui-std-nav-r2/nav-crop-1440-light.png), [ảnh tối/mobile](../output/ui-std-nav-r2/nav-crop-390-dark.png), [handoff2 journal](engineering/skill-usage/records/CHURCH-P1/UI-STD-r1-implementation-2.json). Đã human accepted cùng P1.2; chưa released. Thiết bị thật/Safari/production chưa kiểm chứng.

## Bằng chứng r1 trước bản sửa nhãn

- **PASS:** lint (10warnings giữ từ CSS nguyên bản), typecheck, product/reference build, shell syntax và source/feature guard. SHA HTML `4bdc4e…dc8b6`; prelude/tokens/base/patterns giữ nguyên sau chuẩn hóa format.
- **PASS:** UI chung278 + P1.2 88 + owner62 = **428 browser checks** Firefox. Ma trận1440/1024/901/900/768/561/560/390 ở light/dark, theme đổi trực tiếp/override, common patterns theo nguồn, keyboard/tooltip/nav/modal/drawer, các màn owner và O01/O02.
- **PASS:** `bun test --timeout 30000 tests`: **38tests/347assertions**, Mongo replica set/Redis thật trên database thử riêng, tự dọn. CAS/transactions/authorization/idempotency/F22 được hồi quy. Fault tại driver/transport sau real commit, không production failover test.
- **PASS:** 19/19 API files giữ nguyên hash baseline. Không schema/backend/library mới trong UI-STD-r1.
- **PASS:** HTTPS local ready/login200; gallery product404; local preview200; served HTML khớp hash bundle đã test. Dữ liệu trong ảnh là synthetic; không seed vào database main cho lần bàn giao này.
- Receipt tổng hợp: [verification](../output/ui-std-verification.json), [UI](../output/ui-std-visual-results.json), [P1.2](../output/ui-std-p12-browser-results.json), [owner](../output/ui-std-owner-browser-results.json), [integration](../output/ui-std-integration.log), [inventory](../output/ui-std-inventory.json). Ảnh/checklist và journal tại [biên bản](tasks/UI-STD-r1.md).
- Đối chiếu CSS/common patterns không là pixel-match literal O01/O02 (HTML nguồn không có các màn đó). Adaptation owner/wordless/mobile ghi rõ trong ui-system. Tự review, không reviewer độc lập.
- **NOT_RUN:** thiết bị thật/Safari, UAT luồng đầy đủ, remote CI (workspace chưa là Git repo, chưa publish), production/backup-restore tổng thể và qualification P1.4. Không gọi source complete là human accepted/released.

## Xem cục bộ và bước tiếp theo

- [Trang mẫu bộ UI](http://127.0.0.1:4173/ui-reference.html) · [Owner](https://localhost:3443/owner/login). Chỉ loopback cục bộ, không public deployment. Runbook: [P1.1](engineering/P1.1-local-runbook.md); chuẩn UI/cách khởi động lại preview: [ui-system](ui-system.md) và biên bản.
- P1 đã được Khiêm đóng sau nghiệm thu P1.4. Dừng tại đây; P2 chưa mở, không tự lập kế hoạch/triển khai hoặc phát hành.

## Agent conventions

[Agent Kit installation](agent-kit-installation.md); upstream history không là quyền/kết quả Church CMS. [Implementation journal UI-STD-r1](engineering/skill-usage/records/CHURCH-P1/UI-STD-r1-implementation-1.json) và [correction sau rà cuối](engineering/skill-usage/records/CHURCH-P1/UI-STD-r1-implementation-1-correction-1.json) chỉ ghi gói này; không ghi lại lịch sử P1.1/P1.2 cũ thành usage mới.
