# CHURCH-P1 — P1-plan-r1

## Phê duyệt hiện hành

Khiêm: “duyệt kế hoạch P1-plan-r1, hai mockup bổ sung và cho mở **P1.1.**”
Kế hoạch và mockup reauth/cấp lại đã được duyệt. Phê duyệt mới nhất: Khiêm **nghiệm thu P1.4 và đóng P1**, chưa mở P2. Toàn bộ P1.1–P1.4 HUMAN ACCEPTED; [acceptance P1.4](../engineering/skill-usage/records/CHURCH-P1/P1.4-human-acceptance-1.json). Không publication/deploy/dữ liệu thật.

Kiểu bàn giao: Theo roadmap. Thuộc Church CMS P0–P8 → P1. Căn cứ: các luồng cần nghiệm thu riêng theo phụ thuộc.

## Các gói đã duyệt — lịch sử phạm vi, P1 đã đóng

| Gói | Kết quả | Phụ thuộc / điểm dừng |
|---|---|---|
| P1.1 | Local HTTPS, React/Vite/Tailwind, Bun, Mongo replica set/Redis, module/index/validator nền tảng; F01/F25–F30 owner; CLI bootstrap/status với guard owner cuối; A01/A04/hỗ trợ và khung O01; CI cục bộ | Được mở. Bàn giao rồi dừng chờ nghiệm thu + cho mở P1.2 |
| P1.2 | O01/O02, F10–F14/F22; church CRUD/status, CAS/idempotency/TX/audit, keyset, KPI P2 null | Sau nghiệm thu P1.1 và cho phép mở |
| P1.3 | O03, A01/A04 user, F02–F07/F09/F15–F19/F21/F24; cấp/quản lý account và quyền, temp/reset, context đúng tenant | Sau nghiệm thu P1.2 và cho phép mở |
| P1.4 | F23, đủ 28 routes; ma trận AC01–26, faults/E2E/render/CI, explain, benchmark, local synthetic backup/restore/runbook | Sau nghiệm thu P1.3 và cho phép mở; dừng trước P2/release |

Mỗi gói hoàn tất production code/wiring trước tests; kiểm chứng ngay các hành vi của gói, không dồn an toàn sang P1.4. Runtime PASS không thay human acceptance.

## Acceptance P1.1

- Tái lập local HTTPS/Mongo replica set/Redis không đổi thiết lập global.
- CLI tạo owner synthetic với secret một lần, guard không tự khóa/khóa owner cuối.
- Owner temp → limited → A04 → login → khung O01; F01/F25–F30.
- CSRF/Origin/cookie theo realm; idle15m/absolute8h/limited15m; temp24h; Unicode8–128 và tối đa512bytes; reauth giữ absolute deadline; logout/revocation không revive.
- Redis/Mongo lỗi fail closed; rate-limit5/15m email,20/15m IP; hash Argon2id64MiB/3/p1 có đo concurrency/memory.
- AC05–08/14–16/20/24–26 theo owner; UI desktop/mobile/light/dark; typecheck/lint/build/integration thật.
- Gói sau kiểm tra phần user/tenant và tổng hợp AC; không báo hoàn tất toàn P1.

## Giới hạn

Chưa có workload/SLA production, thông tin liên hệ cụ thể, hạ tầng/retention/RPO/RTO. Không cài trust certificate global, không dữ liệu thật hoặc external messaging. Chưa là quyền publication/deploy.

## Hai mockup bổ sung được duyệt cùng P1-plan-r1

```text
┌ Xác thực lại ──────────────────┐
│ [Danh tính hiện tại]           │
│ Mật khẩu [••••••••••]          │
│ [Đăng xuất] [Tiếp tục]         │
└───────────────────────────────┘

┌ Cấp lại mật khẩu tạm ──────────┐
│ [Hội Thánh · Mã]               │
│ [Họ tên · Email]               │
│ Tham chiếu hỗ trợ [          ] │
│ Các phiên hiện tại sẽ bị thu hồi│
│ [Hủy] [Cấp lại]                │
└───────────────────────────────┘
```

Giữ style gốc. Khi cần recent auth, xác thực rồi quay lại xác nhận cấp lại; không tự gửi mutation. Reauth thuộc P1.1 owner; UI cấp lại account Hội Thánh thuộc P1.3.

## Kiểm chứng từng gói tiếp theo đã nằm trong kế hoạch

- P1.2: AC01/03/17/19/22–24 theo phạm vi tenant; unique code, CAS, keyset/context cursor, retry/mất response, abort/unknown outcome; KPI P2 null/—. Suspend tác động user kiểm tiếp P1.3.
- P1.3: AC02–18/20–24 theo user/account; same-email khác church độc lập; URL/body/cursor không chuyển tenant; owner hai tab/cả hai cookie không nâng quyền; thu hồi quyền/concurrency; Unicode/temp/reset/recent auth; không dựng scope target P2 giả.
- P1.4: ma trận đủ AC01–26; F23 backend audit không menu mới; đúng28 routes, F08/F20 retired; explain F10/F15/F23. Bộ đo synthetic100tenant/10.000account/100.000audit, ghi máy/concurrency/p50/p95/lỗi/memory, không là SLA production. Local synthetic backup/restore và runbook, human walkthrough. Không phát hành hoặc tự mở P2.

## Bàn giao P1.1-r1

Source complete; local behavior verified trong phạm vi owner; human acceptance PENDING_REVIEW; chưa phát hành. P1.2–P1.4 chưa được mở.

- Backend: F01/F25–F30, native Bun.serve cùng origin; Mongo authoritative session và transaction/fences; owner realm/limited/full; password/temp/CSRF/rate-limit; schema/indexes nền tảng8collections; audit cùng transaction. Collections cho gói sau không đồng nghĩa API/semantics gói sau đã implement.
- Operations: CLI owner local synthetic, guard owner cuối, Argon2id64MiB/t3/p1 tối đa4concurrent; dependencies Docker loopback và local CA không trust global.
- UI: A01/A04/hỗ trợ, khung O01, desktop/mobile light/dark, Enter và Escape/focus sidebar; không dữ liệu tenant giả hoặc thông tin liên hệ tự bịa.
- Kiểm tra: lint/typecheck/build PASS; integration21/21 với Mongo replica set/Redis thật; Firefox14/14, TLS verification bật với trust chỉ trong profile tạm; dependency audit `{}`; hash benchmark có concurrency/memory.
- Sửa lỗi được tìm trong kiểm chứng: focus khi bỏ inert của mobile drawer; phục hồi full session khi /me sau login lỗi mạng. Regression browser PASS. Không giảm assertions hoặc bypass TLS/sandbox.
- Test fixtures được xóa sau kiểm chứng, không dữ liệu thật; source/build mount chỉ đọc trong browser container, không mount secrets host. API local có thể chạy bằng `bun start` theo runbook.
- Tự review source/contracts/security; không reviewer độc lập. Remote CI NOT_RUN (workspace không phải Git repo/không có quyền publication), thiết bị thật/Safari và production/UAT NOT_RUN. Không diễn giải local PASS là acceptance/release.
- Evidence: `output/p1.1-integration.log`, `output/p1.1-browser-results.json` (hash bundle), `output/p1.1-browser.log`, `output/p1.1-hash-benchmark.json`, `output/p1.1-dependency-audit.json`, các ảnh `output/p1.1-*.png`; runbook `docs/engineering/P1.1-local-runbook.md`.
- Điểm dừng: Khiêm nghiệm thu P1.1 và cho mở P1.2 trước khi làm gói sau.

## Mở P1.2

P1.1-r1 HUMAN ACCEPTED theo chat hiện tại; evaluation nối implementation event, không ghi thêm usage P1.1. P1.2 được mở implementation O01/O02 và F10–F14/F22; trạng thái hiện hành xem project-state.md. Mỗi gói vẫn dừng nghiệm thu riêng.

## Bàn giao P1.2-r1

Kiểu bàn giao: Theo roadmap, thuộc P1. Đã nghiệm thu: P0-FOUNDATION-r2 và P1.1-r1. Chờ nghiệm thu: P1.2-r1. Tiếp theo: P1.3 — Cấp/quản lý truy cập user. Sau đó: P1.4 — Kiểm chứng tích hợp.

**Source complete, local behavior verified; human acceptance PENDING_REVIEW, NOT RELEASED.** Phạm vi F10–F14/F22 và O01/O02 hoàn thành; không mở P1.3.

- O01 tìm/lọc/phân trang backend25–100, cursor signed/context-bound; trạng thái empty/no-results/lỗi riêng; cảnh báo tên tương tự bounded.
- O02 tạo/sửa/status/ETag, số tài khoản active scoped, P2 null/— và Ban/Khu vực riêng. Account/cấu hình/business entry chưa khả dụng theo gói.
- Identity cấp OwnerGrant/fence không lộ credential cho module khác; Tenancy/Operations/Audit phối hợp transaction. Church/audit/operation/revoke sessions atomic, CAS và idempotency cùng key, F22 owner-safe. Không tạo user cùng church.
- PATCH contact giữ trường không gửi, null xóa từng field hoặc toàn contact; Unicode/phone0 đầu/strict allowlist. Có regression tránh mất tên/email khi chỉ đổi phone.
- Unknown response giữ intent/key/body/version; chủ động replay hoặc F22; không tự replay sau reauth. Conflict yêu cầu tải và xem lại bản hiện tại; form bị khóa khi reload. Client 24h/ledger48h không là chống reuse key vô hạn; rời trang sau unknown phải đối soát trước ý định mới.
- Đã sửa các lỗi phát hiện: thiếu rule bảng chuẩn và nhãn sr-only thoát biên cuộn gây overflow; menu desktop bị .btn override; stale password notice; nested contact PATCH; khóa form khi reload conflict. Tests không giảm assertion/bypass TLS/sandbox.
- **PASS** lint/typecheck/build; integration38/38 (21P1.1+17P1.2),347assertions; browser30checks Firefox, hash bundle; HTTPS main readiness; audit `{}`. Query explain25churches synthetic không chứng minh production capacity. Biên bản chi tiết và API/limits: [P1.2 tenancy](../engineering/P1.2-tenancy.md).
- Fault evidence: Mongo audit validator gây abort trong DB test; driver mất acknowledgement sau commit thật; browser response/drop được inject ở transport sau real commit. Không mô tả là production failover test.
- Tự review source/contracts/security, không reviewer độc lập. Remote CI NOT_RUN (không Git repo/publication), physical mobile/Safari/human UAT/production NOT_RUN. Tác động suspended đến user login/permission thật kiểm tiếp P1.3.
- Evidence: output/p1.2-integration.log, p1.2-browser-results.json/log, p1.2-query-explain.json, p1.2-dependency-audit.json, p1.2-startup-readiness.json và ảnh p1.2-*.png. Journal/inventory/validation được lưu riêng cho P1.2, không sửa outcome lịch sử P1.1 thành usage mới.

Checklist bàn giao kỹ thuật: tạo→O02→reload đúng route; sửa/clear optional giữ dữ liệu khác; hai tab CAS từ chối stale; suspend/resume giữ account và revoke đúng church; retry/F22 không trùng; mobile overflow/focus PASS. Khiêm chưa nghiệm thu UI/hành vi P1.2.

Điểm dừng: chờ Khiêm nghiệm thu P1.2 và cho mở P1.3; không tự Git publication/deploy/dữ liệu thật.

## Human review P1.2 — CHANGES_REQUESTED

Khiêm: “P1.2 không thể được nghiệm thu vì giao diện quá tệ, hãy nhìn lại giao diện UI/UX xem tại sao nó chưa đạt!”

Ghi nhận từ chối nghiệm thu; không ghi đè journal/hashes/bằng chứng lịch sử. Evaluation nối implementation/1: P1.2-human-review-1.json. Audit read-only application: đối chiếu ảnh hiện tại, code, mockup owner đã duyệt và HTML chuẩn (render Firefox1440x1000; prototype không có O01/O02 nên chỉ dùng đối chiếu design language/shared patterns). Browser interaction PASS trước đó không chứng minh fidelity hoặc chất lượng UX. Cần kế hoạch/mockup sửa P1.2 được Khiêm duyệt trước coding; không mở P1.3. Phần phân tích và đề xuất trình trong chat; không tự áp design mới.

## UI-STD-r1 — bàn giao thay đổi UI trong P1.2

Khiêm duyệt UI-STD-r1 và cho triển khai toàn bộ bộ UI chung, chuyển các màn hiện có, kiểm chứng P1.2 rồi bàn giao trước P1.3. [Biên bản UI-STD-r1](UI-STD-r1.md) chứa scope, ảnh và bằng chứng mới. Giữ nguyên biên bản P1.2-r1 bị CHANGES_REQUESTED ở trên; kết quả mới chờ human acceptance, không tự đánh dấu nghiệm thu hoặc mở P1.3.

## P1.2 HUMAN ACCEPTED — mở bước lập kế hoạch P1.3

Khiêm: “Nghiệm thu P1.2. Tiếp theo, kế hoạch P1.3”. Chấp nhận kết quả P1.2 gồm UI-STD-r1/UI-STD-nav-r2. [Acceptance](../engineering/skill-usage/records/CHURCH-P1/P1.2-human-acceptance-2.json), [acceptance UI](../engineering/skill-usage/records/CHURCH-P1/UI-STD-r1-human-acceptance-2.json). Giữ các evaluation CHANGES_REQUESTED trước đây; không ghi usage mới cho việc nghiệm thu.

Chỉ cho lập và trình kế hoạch P1.3/O03/user auth/context theo roadmap đã duyệt; không tự mở implementation. Kế hoạch mới trình trong chat, chưa lưu proposal chưa duyệt thành thiết kế được phép.

## P1.3-plan-r1 đã được mở implementation

Khiêm duyệt triển khai P1.3-plan-r1, gồm chính sách owner quản trị account khi church suspended, user/context bị chặn. Phạm vi P13-01–05/14routes và một gói nghiệm thu tại [CHURCH-P1.3](CHURCH-P1.3.md). Không mở P1.4 hoặc deploy.


## Bàn giao P1.3-r1

[CHURCH-P1.3](CHURCH-P1.3.md): source complete, local behavior/UI verified, chưa human accepted/released. PASS63tests/789assertions và652browser checks, kết quả/giới hạn tại output/p1.3. Dừng trước P1.4/F23. Không dùng technical PASS cấp quyền mở gói sau.


## P1.3 HUMAN ACCEPTED — lập kế hoạch P1.4

Khiêm: “Hiểu rồi, nghiệm thu P1.3. Tiếp theo, kế hoạch P1.4”. Acceptance liên kết implementation P1.3/1, giữ nguyên bằng chứng lịch sử. Kế hoạch P1.4 trình trong chat, chưa ghi proposal chưa duyệt thành implementation authority. Danh mục gốc giữ F23/28routes, AC01–26, synthetic100tenant/10.000account/100.000audit, benchmark/query plans/local restore/CI/runbook; dừng trước P2/release.


## P1.4 được mở implementation

Khiêm duyệt P1.4-plan-r1 trọn gói P14-01–06, bàn giao nghiệm thu trước P2. Trạng thái live ở project-state, kế hoạch ghi tại CHURCH-P1.4. Không tự phát hành hoặc mở P2.


## Bàn giao P1.4-r1

P14-01–06 source complete, local behavior verified; chưa human accepted/released. PASS76tests/997assertions,658browser checks,26AC/28routes, workload100/10000/100000,3300HTTP samples và local restore/cleanup; chi tiết/giới hạn tại CHURCH-P1.4/output/p1.4. Sửa account HTTP412/403 theo r2, không đổi business rules. Dừng trước P2, không publication/deploy.


## Đóng P1

Khiêm: **“Nghiệm thu P1.4 và Đóng P1. Chưa mở P2.”**

- **P1 CLOSED**; P1.1 Owner, P1.2 Quản lý Hội Thánh, P1.3 Truy cập/tài khoản user và P1.4 Kiểm chứng tích hợp đều HUMAN ACCEPTED.
- [Acceptance P1.4](../engineering/skill-usage/records/CHURCH-P1/P1.4-human-acceptance-1.json) nối implementation P1.4/1; không ghi thêm usage implementation hoặc sửa receipts kỹ thuật snapshot lúc bàn giao.
- Phạm vi chốt:28API active,26AC theo P1 local/synthetic;76integration tests/997assertions,658Firefox checks, đo100/10000/100000 và restore/cleanup. [Biên bản P1.4](CHURCH-P1.4.md), [receipt](../../output/p1.4/verification.json). Đây là bằng chứng đã bàn giao trước khi Khiêm nghiệm thu, không tests mới trong bước đóng.
- Giữ các giới hạn/NOT_RUN đã bàn giao; chưa released, không Git publication/deploy hoặc dữ liệu thật.
- **P2 NOT_OPENED**. Không tự lập kế hoạch/implementation P2. Khi mở P2 bằng chỉ dẫn mới, cần cụ thể hóa account–thuộc viên và dữ liệu self theo foundation r2/roadmap P2–P6; chưa làm hoặc chốt gói mới ở bước đóng P1.

Điểm dừng hiện hành: P1 đã đóng, chờ chỉ dẫn mới của Khiêm. Không tự shutdown dịch vụ local, publish hoặc mở gói tiếp theo.
