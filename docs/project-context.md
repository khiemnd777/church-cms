# Bối cảnh Church CMS

## P6.5 — Cầu thay riêng từ cổng tín hữu

Prayers tiếp nhận yêu cầu riêng cho Mục sư trong cùng Hội Thánh. Mỗi yêu cầu từ cổng lưu account gửi, thuộc viên tại lúc gửi và khóa chống trùng. Phép đọc self khớp cả account gửi lẫn liên kết hiện hành. Người gửi theo dõi trạng thái công khai. [Contract](engineering/P6.5-personal-prayers.md).

## P6.4 — Quyền xem dâng hiến cá nhân

Finance sở hữu phép đọc chỉ trả phần thuộc viên lưu trên phiếu chi tiết trong Hội Thánh của phiên hiện hành. Cổng tín hữu dùng quyền self và liên kết đã kiểm qua P6.3. Tổng tháng tính các khoản còn hiệu lực và không bao gồm phiếu tổng hợp. [Contract](engineering/P6.4-personal-giving.md).

## P6.3 — Quyền xem hồ sơ và lễ nghi cá nhân

Cổng tín hữu suy subject từ account member/self đã liên kết. Identity sở hữu vòng đời liên kết và thu hồi phiên, Members/Rites cung cấp projection cá nhân. Hồ sơ mất điều kiện cần xác nhận lại kể cả sau khi phục hồi. [Contract](engineering/P6.3-member-portal.md).

## P6.2 — Mẫu và báo cáo nội bộ theo Hội Thánh

Reporting giữ mẫu đã kiểm tra, một lựa chọn hiện hành theo tenant, snapshot và file bản chốt. Thư ký và Mục sư tải mẫu XLSX, chỉ Mục sư đổi lựa chọn. Mỗi bố cục dùng mã chỉ tiêu để điền số từ các module nguồn, rồi renderer đóng dấu BÁO CÁO NỘI BỘ lên Excel/PDF. [Contract](engineering/P6.2-church-reports.md).

## P6.1 — thiết kế bảy biểu mẫu nội bộ

Certificates dùng chung vòng đời và renderer P3.5. Ba mẫu mới đọc tín hữu hiện hành hoặc hồ sơ thăm viếng đang mở qua public ports; phiên bản chốt giữ snapshot và binaries. Mẫu thăm viếng cần quyền Visitation và chỉ lấy các trường in đã duyệt. [Contract](engineering/P6.1-certificates.md); trạng thái tại project-state.

## Đóng P5 và ranh giới planning P6

P5 có sáu gói đã nghiệm thu local/synthetic; [biên bản closure](tasks/CHURCH-P5.md#đóng-p5) không là release hoặc main activation. Năng lực Finance/Policy24/reporting/restore tiếp tục theo contracts đã bàn giao; không waive E55-01, không phục hồi E51-01 hoặc sửa canh nút deferred sau P8. P6 vẫn là phạm vi định hướng biểu mẫu/báo cáo/định dạng và cổng tín hữu từ P0/roadmap; quyền mới chỉ lập kế hoạch chi tiết trong conversation riêng, không tạo contract/implementation khi chưa duyệt. Trạng thái và chat tiếp nhận xem project-state.

## P5.6 — kết quả và ranh giới bàn giao

Finance bổ sung FinanceReporting dùng snapshot/fresh grant với Policy24, Decimal128/string và bookTotals dùng chung ledger; W09 fourKPI/chart12tháng/details theo period/fund. W01 church pastor đủ overview+summary read mới gọi Finance; owner DTO không thêm Finance fields. UI dùng source/shared6/12/18 và vùng cuộn chart keyboard/mobile; không đổi Toolbar/Field. Restore harness chỉ UUID synthetic, đối chiếu trước revoke/rotate, hậu backup UNKNOWN không auto replay. [Thiết kế/giới hạn](engineering/P5.6-reporting.md); [kết quả](tasks/CHURCH-P5.6.md). Trạng thái hiện hành chỉ project-state; P5 closure/P6 không được tự mở.

## Thiết kế UI-COMPOSITION-r1 — adaptation đã duyệt

Theo P5.5-ui-r2-plan-r1/ASCII: Stack/Card spacing quản lý khoảng cách dọc6/12/18px và reset margin-block con trực tiếp; ContentSection tạo heading→body12px; Modal/Drawer dùng content stack chung. Metadata/actions được nhóm có chủ đích; giữ source HTML/hash/palette/font/breakpoint và layout chuyên biệt như AuthCard/Field/KPI. Guard kiểm cả feature và shared components; rendered gap checks/negative control và review ảnh là bắt buộc khi ảnh hưởng. [Chuẩn](ui-system.md#ui-composition-r1), [task/acceptance](tasks/CHURCH-P5.5.md); trạng thái hiện hành chỉ ở project-state.

## P5.5 UI r2 — implementation được duyệt

UI55-01–04 local/synthetic IN_PROGRESS theo P5.5-ui-r2-plan-r1/ASCII; [task](tasks/CHURCH-P5.5.md). P5.5-r1 CHANGES_REQUESTED chưa nghiệm thu; sửa composition/rule/gap checks rồi bàn giao P5.5-r2, dừng P5.6. E51-01 waived/E55-01 open/UI alignment AFTER_P8 giữ nguyên. Phần dưới giữ chronology.

## Human review P5.5-r1 — CHANGES_REQUESTED — 2026-11-18

Khiêm chưa nghiệm thu vì các section dính nhau; yêu cầu nếu lỗi general phải có rule UI/UX khắc phục hiện tại và phòng tái diễn. **P5.5 CHANGES_REQUESTED, chưa HUMAN_ACCEPTED; P5.6 NOT_OPENED.** UI-P55-SECTION-01 OPEN: PeriodPanel thiếu spacing composition; Card không tự tạo vertical gap, shared paragraph/heading margin0. Gate cũ không đo section gaps; browser PASS lịch sử không chứng minh visual acceptance. [Human review](engineering/skill-usage/records/CHURCH-P5/P5.5-human-review-1.json) ghi feedback; technical receipts/journals/manifest r1 giữ nguyên như snapshot lịch sử. E55-01 audit vẫn OPEN_NOT_WAIVED; E51-01 USER_WAIVED, UI-POSTP8-01 AFTER_P8 giữ nguyên. Rule/layout chung và phạm vi migration sẽ trình P5.5-ui-r2-plan-r1/ASCII trong chat trước coding; chưa sửa application/shared UI/rules hoặc chạy runtime mới.

## P5.5-r1 — bàn giao, còn gate dependency — 2026-11-18

[Task/checklist](tasks/CHURCH-P5.5.md), [contracts](engineering/P5.5-periods.md), [verification](../output/p5.5/verification.json). P55-01–03 source complete/behavior local verified; P55-04 kiểm chứng hành vi PASS nhưng **dependency audit FAIL1high E55-01 OPEN_NOT_WAIVED**; P55-05 hồ sơ đã lưu. Chờ Khiêm nghiệm thu5mục; chưa overallPASS/released. P5.1-r2/P5.2-r1/P5.3-r1/P5.4-r1 HUMAN_ACCEPTED; P5.6 NOT_OPENED, dừng tại đây.

466tests/6801assertions; finalFinance82tests/1284assertions;1945browserchecks gồm550P55/68ảnh;13queryplans/32HTTPSjourneys/33KS/32reversals. Full suite trước final PC↔ledger guard; affected final Finance/browser/qualification xác minh guard, reuse unaffected.2805priorartifacts exacthash/15sharedUI unchanged. Static/build/UI/cleanup PASS,10existingCSSwarnings. Lock không đổi; advisory picomatch4.0.7 còn mở, không nâng dependencies hoặc waive.

Khóa allfund/allprior có common DB control fence, preview5min/immutableKS; voidPC đối ứng nguyên kỳ, mộtPC/proposal kể cả sauvoid; W09/W10 totals không ghi reversal thành income. Main schema/index/Policy23 chưa áp; thay key payment-ledger unique index cần maintenance/backup/activation riêng. E51-01USER_WAIVED và UI-POSTP8-01AFTER_P8 giữ nguyên. Physical/Safari/UAT/mainruntime/pilot/remoteCI/production/multi-replica/independent review NOT_RUN; no productionSLA/restoreclaim. Không publication/main/realdata/worktree/delegation. Trạng thái hiện hành duy nhất ở project-state; phần dưới giữ chronology.

## P5.5 — implementation được duyệt — 2026-11-18

Khiêm duyệt P5.5-plan-r1/C55-01–03/ASCII và trọn P55-01–05 local/synthetic; [task/authority](tasks/CHURCH-P5.5.md). Code/wiring trước tests; một handoff rồi dừng P5.6. P5.4-r1 HUMAN_ACCEPTED5/5, E51-01 USER_WAIVED và UI-POSTP8-01 AFTER_P8 giữ nguyên. Không publication/main/realdata/worktree/delegation. Các ghi nhận planning-only bên dưới là lịch sử.

## Nghiệm thu P5.4-r1; mở planning P5.5 — 2026-11-18

Khiêm: **“Nghiệm thu P5.4-r1 theo năm mục checklist. Mở kế hoạch chi tiết P5.5 để duyệt trước coding. Giữ E51-01 đã bỏ qua và vấn đề canh nút xử lý sau P8.”** P54-01–05 **HUMAN_ACCEPTED đủ5/5 local/synthetic**. [Task/checklist](tasks/CHURCH-P5.4.md) và [Human acceptance](engineering/skill-usage/records/CHURCH-P5/P5.4-human-acceptance-1.json) ghi quyết định sau implementation/1. Verification/manifest/implementation/self-review gốc giữ nguyên trạng thái tại handoff; không rewrite technical snapshot thành nghiệm thu, không chạy lại tests/runtime. Source/dependencies/dist không đổi; chưa released/publication/deploy/realdata/mainDBread/init/restart3443.

P5.5 — Khóa sổ và điều chỉnh chỉ **PLANNING_ONLY trong chat**, trình P5.5-plan-r1/C55/quyền/khóa kỳ/sửa sai/ASCII để duyệt trước coding. Chưa duyệt contracts, schema/API/UI hoặc implementation; chưa tạo task/engineering contract/planning journal P5.5. P5.6 chưa mở.

Giữ **E51-01 USER_WAIVED**, original chưa recovered, không troubleshoot tiếp. Giữ **UI-POSTP8-01 USER_DEFERRED_AFTER_P8**, không sửa canh nút trong P5.5–P8. UNKNOWN/NOT_RUN và giới hạn local/synthetic giữ nguyên. Trạng thái hiện hành duy nhất ở project-state; các ghi nhận phía dưới là lịch sử.

## P5.4-r1 — source hoàn tất, bàn giao local/synthetic — 2026-11-17

[Task/checklist](tasks/CHURCH-P5.4.md), [contracts](engineering/P5.4-payments.md), [verification](../output/p5.4/verification.json). P54-01–05 source complete/PASS local-synthetic, **chờ nghiệm thu năm mục, dừng trước P5.5**.448tests/6547assertions, Finance64tests/1030assertions;1395browserchecks (P54:387+P52:379+P53:488+P51:141),12plans/32HTTPSjourneys/22retryresponses/0terminalerrors. Static/build/UI/audit/cleanup/hashPASS;10existingCSSwarnings.2279priorartifacts/journals exacthash,15sharedUI unchanged.

Finance sở hữu payment PC và mixed ledger source riêng; approved→paid atomic/onePC, exact current book guard dùng chung post/void/pay, không opening nhập tay, không actual bank payment. netIncome giữ nghĩa thu ròng; W09 thêm netExpense/opening/closing. Main schema/index/Policy22 chưa áp; index replacement cần maintenance riêng. P5.3-r1 HUMAN_ACCEPTED5/5; E51-01 USER_WAIVED và UI-POSTP8-01 AFTER_P8 giữ nguyên. Chưa humanaccepted/released/publication/realdata; UNKNOWN/NOT_RUN và giới hạn local workload giữ nguyên. Trạng thái hiện hành duy nhất ở project-state; phần dưới là lịch sử.

## P5.4 — implementation được duyệt — 2026-11-17

Khiêm duyệt P5.4-plan-r1/C54-01–03/ASCII và trọn P54-01–05 local/synthetic; [task/authority](tasks/CHURCH-P5.4.md). Code/wiring toàn gói trước tests, một handoff rồi dừng P5.5. Không publication/mainDBread/init/restart3443/realdata. P5.3-r1 HUMAN_ACCEPTED5/5; E51-01 USER_WAIVED, UI-POSTP8-01 AFTER_P8 giữ nguyên. Các ghi nhận planning-only trước đó là lịch sử.

## Nghiệm thu P5.3-r1; mở planning P5.4 — 2026-11-17

Khiêm: **“Nghiệm thu P5.3-r1 theo năm mục checklist. Mở kế hoạch chi tiết P5.4 để duyệt trước coding. Giữ E51-01 đã bỏ qua và vấn đề canh nút xử lý sau P8.”** P53-01–05 **HUMAN_ACCEPTED đủ5/5 local/synthetic**. [Task/checklist](tasks/CHURCH-P5.3.md) và [Human acceptance](engineering/skill-usage/records/CHURCH-P5/P5.3-human-acceptance-1.json) ghi nhận quyết định sau implementation/1; technical verification/manifest/implementation/self-review gốc giữ nguyên trạng thái tại handoff, không rewrite thành nghiệm thu hoặc chạy lại runtime. Source/dependencies/dist không đổi; chưa released, không publication/deploy/real data/main DB read/init/restart3443.

P5.4 — Phiếu chi và sổ thu chi chỉ **PLANNING_ONLY trong chat**, trình P5.4-plan-r1/C54/quyền/số dư/kỳ/ASCII để duyệt trước coding. Chưa duyệt contracts, schema/API/UI hoặc implementation; chưa tạo task/engineering contract/planning journal P5.4. P5.5/P5.6 chưa mở.

Giữ **E51-01 USER_WAIVED**, original chưa recovered và không troubleshoot tiếp. Giữ **UI-POSTP8-01 USER_DEFERRED_AFTER_P8**, không sửa canh nút trong P5.4–P8. Prior UNKNOWN/NOT_RUN và giới hạn local/synthetic giữ nguyên. Trạng thái hiện hành duy nhất tại project-state; các ghi nhận phía dưới là lịch sử.

## P5.3-r1 — source hoàn tất, bàn giao local/synthetic — 2026-11-17

[Task/checklist](tasks/CHURCH-P5.3.md), [contracts](engineering/P5.3-expenses.md), [verification](../output/p5.3/verification.json). P53-01–05 hoàn tất source/behavior PASS local/synthetic; human acceptance/release là gates riêng. Dừng trước P5.4; không thanh toán hoặc ghi sổ từ duyệt. Giữ E51-01 USER_WAIVED, UI-POSTP8-01 AFTER_P8 và prior1713protectedbytes. Live state duy nhất ở project-state; chi tiết outcome/evidence trong task.


## P5.3 — implementation được duyệt — 2026-11-17

Khiêm duyệt P5.3-plan-r1/C53-01–03/ASCII và trọn P53-01–05 local/synthetic; [task/authority](tasks/CHURCH-P5.3.md). Code/wiring toàn gói trước tests; một handoff rồi dừng P5.4. Không publication/realdata/mainDBread/init/restart3443. Giữ P5.2HUMAN_ACCEPTED/E51-01USER_WAIVED/UI-POSTP8-01_AFTER_P8; không sửa alignment hay troubleshoot E51-01. Các ghi nhận planning-only phía dưới là chronology.


## Nghiệm thu P5.2-r1; mở planning P5.3 — 2026-11-17

Theo Khiêm, P52-01–05 **HUMAN_ACCEPTED đủ5/5 local/synthetic**; [acceptance và note UI](tasks/CHURCH-P5.2.md#ui-postp8-01). **UI-POSTP8-01**: nút canh giữa với Field làm nút/ô nhập nhìn lệch; ghi lại để xử lý **sau P8**, không sửa trong lượt này. Đây là deferred UI followup, không mở lại acceptance P5.2. Giữ E51-01 USER_WAIVED, không recovered/troubleshoot tiếp.

P5.3 Đề xuất và phê duyệt chi chỉ **PLANNING_ONLY trong chat** để chốt C53/quyền/workflow/ASCII trước coding; chưa application/schema/tests/implementation P5.3 hoặc UI alignment fix. Không publication/realdata/mainDBread/init/restart3443; giữ technical receipts/journals/source/dist và UNKNOWN/NOT_RUN. Trạng thái hiện hành duy nhất tại project-state.


## P5.2-r1 — source hoàn tất, bàn giao local/synthetic — 2026-11-17

[Task/checklist năm mục](tasks/CHURCH-P5.2.md), [contracts](engineering/P5.2-income.md), [verification](../output/p5.2/verification.json). P52-01–05: nguồn hoàn chỉnh, behavior PASS local/synthetic; human acceptance và release là gates riêng. Giữ phạm vi/điểm dừng P5.3; không suy quyền từ technical PASS. Snapshot hiện có 1386 file giữ đúng hash; E51-01 USER_WAIVED, không recovered. Chi tiết kết quả ở task; live status duy nhất ở project-state.


## P5.2 — authority implementation — 2026-11-17

Khiêm: **“Duyệt P5.2-plan-r1, C52-01–03 và ASCII. Cho phép triển khai trọn P52-01–05 local/synthetic, bàn giao rồi dừng trước P5.3. Giữ ngoại lệ E51-01 đã bỏ qua.”** [Task/C52/ASCII/checklist](tasks/CHURCH-P5.2.md). Theo roadmap P5; một gói P52-01–05, code/wiring trước tests. Không mở P5.3/publication/commit/push/deploy/real data/main DB read/init/restart3443. E51-01 USER_WAIVED, không troubleshoot lại; giữ records cũ. Quyền planning-only P5.2 trong các ghi nhận lịch sử phía dưới đã được thay bằng approval này. Trạng thái hiện hành duy nhất tại project-state.


Cập nhật theo planning và phê duyệt trong chat ngày 2026-11-10. Chi tiết và lịch sử thay thế: [hồ sơ P0](tasks/CHURCH-P0.md). Trạng thái hiện hành: [project-state](project-state.md).

## Mục tiêu và lựa chọn đã chốt

- Xây dựng hệ thống multitenant Quản lý Hội Thánh Tin Lành; một Hội Thánh là ngữ cảnh tenant theo định hướng P0.
- Stack: ReactJS/TypeScript/Vite, TailwindCSS, Bun/TypeScript, Redis, MongoDB. Phiên bản cục bộ pin trong package.json/bun.lock; HTTP dùng native Bun.serve, frontend build được phục vụ cùng origin HTTPS. Nhà cung cấp production chưa chốt.
- Trao đổi bằng tiếng Việt. UI/UX theo `../documents/Quản lý Hội Thánh Tin Lành(1).html` (đường dẫn mô tả từ root `src`); hai HTML còn lại dùng đối chiếu nghiệp vụ. Liên kết nguồn đầy đủ nằm trong hồ sơ P0.
- Wordless theo bảng W01–W18 đã duyệt: giữ bố cục/thành phần/màu/font/responsive gốc; giảm chữ điều khiển/hướng dẫn; giữ nhãn dữ liệu, quyền, tiền/kỳ, xác nhận và nội dung giấy tờ. Không tự thiết kế UI/UX khác.
- Owner/nhà cung cấp quản lý danh sách Hội Thánh, cấp tài khoản/quyền, hỗ trợ truy cập; người dùng Hội Thánh không quản lý lời mời/tài khoản cho người khác.
- O-D1–O-D5/O01–O03 đã duyệt: owner quản lý thuộc viên/tổ chức/mục vụ trong tenant được chọn, dùng W01–W18; không mặc định xem tài chính/dâng hiến cá nhân/cầu thay riêng tư hoặc duyệt chi.
- Tài khoản mới dùng mật khẩu tạm riêng, buộc đổi ở lần đầu; không thêm Hội Thánh cho account hiện có; C19 bắt buộc account riêng trong từng tenant. Mật khẩu mới **8–128 ký tự**. Không đăng ký tự do hoặc lời mời.
- Quên mật khẩu/mất tài khoản: hiển thị liên hệ **Dịch vu chăm sóc và hỗ trợ**. Hướng bàn giao/hỗ trợ đã được C16 xác nhận; thông tin liên hệ/kênh cụ thể chưa cung cấp thì không tự điền hoặc gửi thật.
- Phiên theo D4: 15 phút không hoạt động cần xác thực lại, tối đa 8 giờ. Theo C16, 2FA không thuộc kế hoạch triển khai hiện tại; yêu cầu bắt buộc D2 bị thay thế trong scope này. A05–A08 chỉ xem xét lại trong tương lai với phê duyệt mới.

## Ranh giới và hướng kiến trúc

Định hướng modular monolith và cách ly tenant từ nền tảng được đồng ý. [Thiết kế nền tảng P0-FOUNDATION-r2](engineering/P0-FOUNDATION.md) cụ thể hóa account người dùng một churchId cố định, owners nhân viên nhà cung cấp tách riêng, không memberships, MongoDB authoritative sessions, Redis rate-limit, cookie/CSRF, collection/index, transaction/idempotency và contracts API. Các lựa chọn kỹ thuật r2 đã được Khiêm duyệt ở C20, không tự là bằng chứng runtime; bằng chứng implementation theo từng gói P1. Không coi phương án chi tiết của agent hoặc hành vi demo là nghiệp vụ đã duyệt toàn bộ.

Hồ sơ và account user thuộc đúng một Hội Thánh; churchId bất biến, không danh tính user chung/membership nhiều tenant. Owner là nhân viên công ty có account riêng và là ngoại lệ duy nhất across tenant. Khóa/cấp lại account user không ảnh hưởng account độc lập ở tenant khác. Không gộp hồ sơ vì trùng tên/email hoặc impersonation.

Quyền thực hiện theo [task P1](tasks/CHURCH-P1.md) và [trạng thái hiện hành](project-state.md). P1-plan-r1 được duyệt; từng gói vẫn có điểm dừng nghiệm thu. Không tự dùng dữ liệu thật, Git publication hoặc deploy. Chi tiết P2–P7 chưa được suy là hoàn tất từ phê duyệt nền tảng.

## Bức tranh tổng thể và cách bàn giao

Quy tắc bàn giao đã được thống nhất trong trao đổi ngày 2026-11-10, bổ sung ảnh kết quả hoặc sơ đồ kỹ thuật thực tế theo yêu cầu “áp dụng vào”. Dùng [hai mẫu biên bản](handoff-templates.md): task dài bàn giao theo gói và dừng chờ nghiệm thu/cho phép mở gói sau; task ngắn bàn giao một lần, không hiển thị roadmap. Cả hai có phần trực quan, Outline, Checklist nghiệm thu, Bằng chứng kỹ thuật, WHAT, skills và đề xuất tiếp theo.

Theo bổ sung đã được Khiêm duyệt ngày 2026-11-10, ngay đầu mỗi kế hoạch agent nêu **Kiểu bàn giao**, **Căn cứ**, **Thuộc roadmap** trực tiếp trong chat. Phân loại theo nhu cầu nghiệm thu; gói nhỏ thuộc roadmap giữ roadmap và điểm dừng. Xem [tiêu chí phân loại](handoff-templates.md#phan-loai-khi-lap-ke-hoach) là nguồn quy tắc chi tiết; mức rủi ro quyết định kiểm tra riêng, không thay thế kiểu bàn giao.

Bức tranh định hướng có sẵn, không là scope bản đầu đã duyệt hoặc quyền triển khai:

```text
P0  Đặc tả và phê duyệt
P1  Nền tảng tenant, auth, owner/account, quyền, audit, local/CI
P2  Cấu hình, thuộc viên/thân hữu, gia đình, ban/khu vực, import/export, dashboard
P3  Điểm danh, lớp dự bị/lễ nghi, thẻ/chứng nhận
P4  Lịch giảng/sinh hoạt, thăm viếng, cầu thay, cảnh báo
P5  Quỹ/dâng hiến, đề xuất/duyệt/thu chi, khóa sổ
P6  Biểu mẫu/báo cáo/định dạng, cổng tín hữu
P7  OCR/nhắc ngoài/chứng từ/nhiều cấp/chữ lớn
P8  Pilot nhiều Hội Thánh, chuyển dữ liệu, phục hồi, phát hành
```

Tên và thứ tự trên lấy từ roadmap đã ghi tại [project-plan](project-plan.md). Danh mục implementation P1 đã chốt ở phần P1 bên dưới; không tự sinh phần tiếp theo sau bàn giao. Khi kế hoạch được sửa đổi có phê duyệt, cập nhật bức tranh ở đây cùng chi tiết kế hoạch. Không lưu tiến độ sống tại đây; xem [project-state](project-state.md).

## Nguồn và giới hạn bằng chứng

Agent Kit được cài cục bộ ngày 2026-11-10; xem [thông tin cài đặt](agent-kit-installation.md). Các tasks/journal/verification-results upstream không là bằng chứng Church CMS. Scaffold owner P1.1 và bằng chứng kiểm tra có trong workspace; xem task P1 và runbook. Workspace chưa được Git nhận diện là repository.

Các phê duyệt là thiết kế/mockup trong chat, không là kết quả runtime, UAT hoặc phát hành. Không có dữ liệu Hội Thánh thật được tạo bởi pha này.

## Điều chỉnh C19 — ràng buộc danh tính

Owner là nhân viên công ty cung cấp QLHT, account riêng; user account thuộc duy nhất một Hội Thánh, không memberships nhiều tenant hoặc chọn/chuyển Hội Thánh. Chỉ owners có cross-tenant và vẫn giữ giới hạn O-D2. R2 tại tài liệu nền tảng là hợp đồng hiện hành HUMAN ACCEPTED tại C20, thay thế r1. Implementation ứng dụng theo gói P1; thiết kế không thay bằng chứng chạy.

## C20 — r2 đã được duyệt

Thiết kế nền tảng P0-FOUNDATION-r2 đã được Khiêm duyệt (“Duyệt r2.”). C20 chỉ duyệt thiết kế; quyền mở P1.1 đến từ phê duyệt P1-plan-r1 riêng sau đó. Phần thiết kế nghiệp vụ P2–P7 chưa được coi là hoàn tất chỉ từ xác nhận này.

## Danh mục implementation P1 được duyệt

P1.1 Owner truy cập cục bộ → P1.2 Quản lý Hội Thánh → P1.3 Cấp/quản lý truy cập user → P1.4 Kiểm chứng tích hợp. Chi tiết [CHURCH-P1](tasks/CHURCH-P1.md). Mỗi gói dừng nghiệm thu, không tự mở gói sau.

## Ranh giới Tenancy/Operations P1.2

Tenancy sở hữu churches; Identity trả OwnerGrant chỉ có actorId/commit-time fence và query counts scoped/revoke church sessions. Operations sở hữu idempotency ledger, Audit sở hữu event append cùng transaction; không chuyền credential/passwordHash qua các module này. O01/O02 dùng cùng renderer owner và context tường minh từ URL, không selectedChurch toàn cục. PATCH contact giữ field không gửi, null clear tường minh. Chi tiết ổn định: [P1.2 tenancy](engineering/P1.2-tenancy.md); trạng thái/acceptance chỉ tại project-state/task record.

## Chuẩn UI từ HTML — UI-STD-r1

HTML `Quản lý Hội Thánh Tin Lành(1).html` là nguồn style, cùng mockup owner/wordless và adaptation UI-STD-r1 đã duyệt. Nền tảng/component ở `web/ui`; contracts, theme, responsive và quy tắc kế thừa tại [ui-system](ui-system.md). Feature CSS chỉ bố trí nội dung; bộ chung không sở hữu API/quyền/tenant/CAS/F22. Trang tham chiếu được build riêng khỏi sản phẩm.

Điều chỉnh đã duyệt sau phản hồi thiếu text UI-STD-r1: menu AppShell hiển thị icon + tên trên desktop/mobile, trạng thái chưa khả dụng là dòng phụ; không coi tooltip/aria-label là nhãn hiển thị. Thay quy tắc ẩn nhãn menu wordless cũ; xem ui-system.md.


## Ranh giới Identity/Authorization P1.3

`Accounts`/`ChurchIdentity` sở hữu account/credential/session, dùng public `Tenancy.access()`/ChurchAccess để resolve và fence church; Operations ledger và Audit qua contracts đã có. User session realm riêng, fixed church, fresh role/scope mỗi request và fence tại transaction. Ở P1 chỉ có `context:read`; P2.1/P2.2 mở catalogue và hồ sơ theo capability versioned riêng bên dưới. Owner có thể quản trị account khi suspended, nhưng F09/F24/user login bị chặn; thao tác account không resume church. Chi tiết contracts/rules/retention/canonical reset bucket tại [P1.3 accounts](engineering/P1.3-accounts.md). Không thay mô hình foundation r2 hoặc tự mở P2.


## Audit reader và qualification P1.4

F23 là backend capability audit:read cho owner full; không menu UI mới, DTO allowlist, query scoped/global và signed keyset time+id DESC. Hoàn chỉnh28API r2; account CAS412/recent-auth403 theo contract. [P1.4 contracts/measurement/recovery](engineering/P1.4-qualification.md), [ma trận](engineering/P1.4-acceptance-matrix.md). Tools chỉ tự tạo DB synthetic loopback, quiesced snapshot/restore target mới và revoke restored sessions; không restore main hoặc gọi local proof là production SLA/RPO-RTO. Từng gói vẫn cần human acceptance; không tự mở P2.


## Mốc nghiệm thu và đóng P1

Khiêm đã nghiệm thu P1.4 và đóng P1; P1.1–P1.4 đều HUMAN ACCEPTED trong phạm vi local/synthetic. [Biên bản đóng P1](tasks/CHURCH-P1.md#đóng-p1). Phê duyệt đóng P1 không là production release hoặc quyền mở giai đoạn mới. P2 được mở bằng chỉ dẫn mới ngày2026-11-11, ghi ở phần roadmap P2 bên dưới. Trạng thái hiện hành duy nhất vẫn ở project-state.

## Roadmap P2 đã duyệt

P2.1 Cấu hình → P2.2 Hồ sơ → P2.3 Gia đình → P2.4 Tổ chức/quyền → P2.5 Import/export → P2.6 Tổng quan/kiểm chứng. Authority mới ngày 2026-11-11 thay trạng thái P2 chưa mở trong lịch sử. Mỗi gói có điểm dừng nghiệm thu. Chi tiết [CHURCH-P2](tasks/CHURCH-P2.md).

## Ranh giới Organization P2.1

Organization sở hữu church_settings/organization_units; cấp cấu hình và catalogue tenant-scoped qua contracts. Identity/Authorization cấp grant theo role và realm, Tenancy fence church, Operations ledger v2 actor-scoped cùng collection với v1 (không backfill), Audit ghi đúng actor trong transaction. GET không khởi tạo; POST setup tạo đúng6system units. UI W12 dùng chung hai realm/UI-STD-r1; pending intent ở parent qua reauth, không tự replay. Chi tiết ổn định tại engineering/P2.1-organization.md; live status/acceptance chỉ ở project-state/task.

## Chuyển gói P2.1 → P2.2

Khiêm nghiệm thu P2.1-r2 và mở P2.2 ngày2026-11-11. Tiếp tục danh mục P2-plan-r1 đã duyệt, giữ điểm nghiệm thu từng gói; hợp đồng nghiệp vụ/ASCII mockup P2.2 được trình duyệt trước coding. Quyền cho gói mới không bao gồm publication/deploy/dữ liệu thật. Chi tiết authority/acceptance trong task P2 và P2.1; trạng thái sống chỉ tại project-state.

## Ranh giới Members/Families P2.2

Members sở hữu hồ sơ và history; Families cấp hộ tối thiểu/area/read-model scoped, Organization cấp labels/active-link fences và assignment. ID/code bất biến; ba trục type/membership/participation độc lập. Create member+family/history/ledger/audit atomic; ngày nullable, consent versioned, conversion giữ nguồn thân hữu và không liên kết account/lớp. PolicyVersion3 cho pastor/secretary đọc ghi hồ sơ, secretary vẫn readonly catalogue. Shared tenant intent bảo vệ actor/tenant/namespace qua reauth. [Contracts/runbook](engineering/P2.2-members.md). Quản lý hộ đầy đủ/P2.3 và các gói sau giữ điểm dừng nghiệm thu; live state chỉ ở project-state.

## Ranh giới Families P2.3

Families sở hữu metadata/status/lineage và family_history; Members public port sở hữu chuyển familyId/roles/member_history, cùng transaction với Operations/Audit/active-area fences. Family version tăng khi metadata/member links/roles đổi, kể cả callers P2.2. Split tạo mã mới giữ nguồn; merge chuyển toàn bộ historical profiles rồi giữ source merged/link, không xóa/dedup/viết lại quá khứ. Metadata chưa rõ giữ null; upgrade P2.2 tường minh, không tạo năm/lịch sử giả. UI W03 và W14 dùng kit chung; [contracts/runbook](engineering/P2.3-families.md). P2.4 vẫn cần quyền mở riêng, live state chỉ ở project-state.

## P2.4 — tổ chức thực tế và assigned-unit scope

Organization sở hữu term/appointment snapshots, leader/schedule/history; Members public OrganizationMembers port sở hữu roster/eligibility/service changes, Family area vẫn là nguồn có thẩm quyền. Auto age và explicit service cùng tồn tại, DOB recalc giữ services. Identity gọi public UnitScopeValidator khi owner cấp assigned_units1–50active age/service/area cùng church; policyVersion5 cho lead reduced roster riêng, không cấp full Members/Families capability. Scoped reads fence church/account/session và query trong cùng Mongo snapshot; existing writers dùng cùng church fence. Chức vụ tổ chức không tự cấp role account. W04/W13/O03/W15 dùng kit/source hiện có; [contracts/runbook](engineering/P2.4-organization-runtime.md). Trạng thái/nghiệm thu chỉ ở project-state/task.

W04 hỗ trợ Card/Bảng trên cùng DTO/controller, giữ bốn group, selected term/pages/actions/scope. Preference chỉ enum view tại localStorage theo realm/principal/church; lỗi storage không chặn render/switch. Shared TableFrame/grid giữ responsive, compact table actions có aria-label đầy đủ. Chi tiết tại contracts P2.4-r2; không thay API/schema/quyền.

W04 switcher Card/Bảng dùng shared IconButton icon-only grid/table theo P2.4-icon-plan-r1; tooltip/aria-label/pressed/disabled giữ tên/trạng thái. Table là SVG bổ sung trong shared catalogue; không đổi source CSS/glyphgrid hay rule menu AppShell icon + tên.

## P2.5 — ranh giới import/export

Theo P2.5-plan-r1 đã duyệt: DataExchange sở hữu staged imports, protected export artifacts và durable source identities; gọi public transactional Members/Families/Organization contracts, không cross-module writes. CSV/XLSX→mapping/review→preview→batches≤100→reconciliation, create/link/skip không bulk overwrite/lifecycle/move; new family groups atomic trong lô. Policy6 cấp capability riêng owner/pastor/secretary, giữ reduced roster privacy P2.4. File ACL actor/realm/church/fresh fence/expiry; export server filters + allowlisted columns/snapshot. [Thiết kế và contracts](engineering/P2.5-data-exchange.md). Live acceptance chỉ tại project-state; P2.6 cần quyền riêng.

## P2.6 — ranh giới Tổng quan/read snapshot

Theo P2.6-plan-r1 đã duyệt: Overview orchestration gọi public Tenancy/Members/Families/Organization read ports trên một Mongo snapshot với fresh auth/tenant fences; không sở hữu/ghi domain collections. Policy7 overview:read chỉ owner/pastor/secretary, reduced roster giữ riêng. W01 giữ HTML source layout với current P2 metrics, unknown/null/unavailable rõ; future chart/rites/finance/care không có số giả. last30 visitors/explicit birthday year-month dùng chung list/count/cursor/export contracts. Local fenced snapshots được admission theo church/process, bounded queue/retry, không đổi writer/ledger semantics. Qualification/restore chỉ DB synthetic UUID, không là production SLA/PITR. [Contracts/runbook](engineering/P2.6-overview-qualification.md). Quyền P2.6 không đóng P2/mở P3; live acceptance chỉ tại project-state.

## Roadmap P3 đã duyệt

P3-plan-r1 được Khiêm duyệt ngày2026-11-12: **P3.1 Buổi nhóm/điểm danh tay → P3.2 Thẻ/QR → P3.3 Lớp dự bị → P3.4 Sổ lễ nghi → P3.5 Chứng nhận/bản in → P3.6 Tổng hợp/kiểm chứng**. Mỗi gói có điểm dừng nghiệm thu và cần quyền mở riêng. Danh mục/phụ thuộc/giới hạn tại [CHURCH-P3](tasks/CHURCH-P3.md); thiết kế kỹ thuật từng gói duyệt trước coding, không suy từ danh mục rằng schema/API/quyền chi tiết đã chốt. Trạng thái sống chỉ tại project-state.

## P3.1 — ranh giới Attendance

Theo P3.1-plan-r1 đã duyệt: Attendance sở hữu sessions/participants/history và reduced identity snapshots; public Members read model và Organization scope/labels giữ ranh giới dữ liệu. Policy8 có attendance:read/mark/manage; manager tách canWrite, lead chỉ historical roster thuộc active assigned unit. Ledger replay/receipt cùng fresh resource/action fence; per-row CAS+session generation, session revision cho close/reset/roster edits, history/audit/counters atomic. W05 dùng kit/source và intent-memory/explicit reconciliation hai realm. Danh sách<=2000 gồm current believer/visitor, không ngưỡng tuổi demo. [Contracts/runbook](engineering/P3.1-attendance.md). Human acceptance/live status chỉ tại task/project-state; P3.2 cần quyền mở riêng.

## P3.2 — ranh giới Cards/QR

Theo P3.2-plan-r1 đã duyệt: Cards sở hữu current card revision và append-only history; public Members/Tenancy read ports cung cấp eligibility/snapshot trong cùng TX. QR opaque256-bit, không PII/public URL; snapshot lúc cấp, CAS/reason khi thay/thu hồi, old QR mất hiệu lực atomic. Attendance resolve proof60giây gắn actor/tenant/session/card/row revision/generation, ghi bằng kernel P3.1 hiện diện=true; exact replay vẫn fresh permission và không ghi lại sau reset. Policy9: owner/pastor/secretary quản lý thẻ, lead chỉ scan own active unit; treasurer/member deny. W14 thẻ/in86×54mm + W05 local camera worker có explicit opt-in/cleanup/reconciliation. [Contracts/runbook](engineering/P3.2-cards-qr.md). Camera điện thoại/bản giấy giữ NOT_RUN theo [P3-PHYSICAL-01](tasks/CHURCH-P3.md#p3-physical-verification-note); không suy proof vật lý từ synthetic. Live status chỉ tại project-state, P3.3 cần quyền mở riêng.

## P3.3 — ranh giới PrepClasses

Theo P3.3-plan-r1/C33-01–03 đã duyệt: PrepClasses sở hữu khóa/ghi danh/bài học/phỏng vấn, Members read ports kiểm eligibility/identity, Attendance sở hữu buổi/roster/hiện diện qua source/fence public interface và transaction ports, không cross-module writes/cycle. Class source gắn course/meeting/lesson và roster current enrollment; snapshot mở buổi không tự sửa hồi tố. Credit distinct member/lesson chỉ từ buổi đã chốt, bù không xóa vắng gốc; curriculum khóa sau first open, course close không tự hoàn thành/Báp-têm. Policy10 owner/pastor/secretary quản lý lớp, owner/pastor ghi sự kiện phỏng vấn; không suy pass/fail/teacher role. W06 giữ6tab (5lễ nghi P3.4 chưa mở), W14 links và W05 kernel/QR/reconciliation được dùng lại. [Contracts/runbook](engineering/P3.3-prep-classes.md). Live acceptance tại project-state; physical note giữ NOT_RUN, P3.4 cần quyền mở riêng.

## P3.4 — ranh giới Rites và thông tin Báp-têm

Theo P3.4-plan-r1/C34-01–03/ASCII đã duyệt: Rites sở hữu sổ/snapshot/history năm loại lễ; Members.baptism giữ thông tin hiện hành. Public Members port và handler Rites nối tại composition root, cập nhật fact/history/audit cùng transaction, không ghi xuyên module hoặc tự backfill lễ từ hồ sơ/import. Snapshot lễ đã ghi nhận giữ nguyên khi profile đổi; preview/CAS/fresh source versions bảo vệ xác nhận/đính chính, partial unique tránh hai bản Báp-têm recorded hiện hành. Người liên quan chọn rõ/link hoặc external snapshot, không suy hộ/quan hệ/deceased; count Tiệc Thánh nhập tay/null khác0, lịch kế tiếp từ planned record. Policy11 rites:read/manage cho owner/pastor/secretary; classes interview giữ riêng. W06 mở năm tab còn lại, W14 liên kết đúng sổ; chứng nhận/bản in thuộc P3.5. [Contracts](engineering/P3.4-rites.md). Live acceptance tại project-state; physical note vẫn NOT_RUN.

## P3.5 — ranh giới Certificates và artifact nội bộ

Theo P3.5-plan-r1/C35-01–03/ASCII: Certificates sở hữu drafts/previews/immutable editions/history, đọc public Members/Rites/PrepClasses/Tenancy ports, source/version fences, không cập nhật dữ kiện nghiệp vụ ngược. Bốn mẫu `internal-r1` có dấu kiểm thử; thông tin hệ phái/người ký explicit, đức tin cần xác nhận riêng, đơn không thu thập lời làm chứng/chữ ký. Preview render ngoài transaction, fresh context trước chốt atomic cả DOCX/PDF/history/audit/ledger; replacement/revoke bảo toàn bytes và lineage. Shared A4 model/offline licensed fonts, child renderer bounded2/15s/10pages/5MiB, preview8/church/15m. Policy12 certificates read/manage cho owner/pastor/secretary, không đổi interview. W11/W17/W06/W14 hai realm nối thật; four unopened catalog items giữ chưa mở. [Contracts/runbook](engineering/P3.5-certificates.md). Physical/native Word NOT_RUN; live acceptance chỉ tại project-state, P3.6 cần quyền mở riêng.

## Tổng hợp P3.6 — hợp đồng ổn định

Theo P3.6-plan-r1/C36-01–03/ASCII: Attendance sở hữu general/sunday_reference, partial unique church/calendarSunday, reason+confirmation/CAS/idempotency/history cho thay đổi phân loại; không backfill hoặc viết lại roster. Public read ports Attendance/Rites/PrepClasses cung cấp số liệu cùng snapshot/fresh tenant auth.12CN lịch/missing≠0, absent3 đúng ba CN đủ dữ liệu, W04 weighted bốn own-unit closed trong84ngày; lễ năm bốn kinds/unknown-date riêng, classes factual. W01/W02/W14/W04/W05 nối hai realm; cursor/export preview gắn period/reference fingerprint. Workload và restore synthetic tách volume fixtures với public-command workflow; chưa đóng P3/mở P4. [Contracts/runbook](engineering/P3.6-reporting.md); live state chỉ project-state. Camera/giấy thật và native Word NOT_RUN.


## Roadmap P4 đã duyệt

Theo chỉ dẫn Khiêm ngày2026-11-13, P4-plan-r1 gồm **P4.1 Lịch giảng/sinh hoạt → P4.2 Chương trình ban → P4.3 Hồ sơ thăm viếng → P4.4 Cầu thay/quyền riêng tư → P4.5 Cảnh báo/chăm sóc tự động → P4.6 Tổng hợp/kiểm chứng**. Mỗi gói cần kế hoạch chi tiết và ASCII UI được duyệt trước coding, có điểm dừng nghiệm thu và cần quyền mở gói sau. [Danh mục/kết quả/phụ thuộc/giới hạn](tasks/CHURCH-P4.md). Đây là danh mục đã duyệt, không là schema/API hoặc thiết kế chi tiết đã chốt của từng gói. Các kế hoạch chi tiết chỉ thành quyết định sau phê duyệt; live state chỉ tại project-state.

## P4.1 — ranh giới Scheduling

Theo P4.1-plan-r1/C41-01–03/ASCII đã duyệt: Scheduling sở hữu series/occurrences/history và tenant calendar revision; public Members/Organization ports cấp reduced identities/units và fences. Fixed Asia/Ho_Chi_Minh, UTC intervals≤24h, once/weekly1–4/monthly ordinal1–5, bounded365days/200occurrences; original slots/generations và explicit one/future preview giữ past/history. cancelled one-off exception được phân biệt với superseded generations, cần xác nhận trước khi có thể tạo lại. CAS/idempotency/audit/receipt atomic; conflict member/choir là advisory có reason+confirmation, guest/location text không chứng minh identity/venue booking. Policy14 owner/pastor/secretary manage, lead chỉ scheduled own active unit và không picker/history/receipt. W07 hai realm/deep link/reauth/pending reconciliation, W13 permissions và W01 route dùng shared UI; chương trình ban vẫn thuộc P4.2. Không ghi Attendance/Rites, không auto-parse/sync scheduleText. [Contracts/runbook](engineering/P4.1-scheduling.md), [task/checklist](tasks/CHURCH-P4.1.md); live state chỉ project-state.


## P4.2 — ranh giới Programs

Theo P4.2-plan-r1/C42-01–03/ASCII đã duyệt: Programs sở hữu draft/field baseline/immutable editions/history; unique program theo tenant/unit/occurrence. Nguồn roster/current identities/confirmed board term/calendar đi qua public ports của module sở hữu và source fences; không ghi nghiệp vụ ngược nguồn. Bảy tiết mục, manual merge theo trường/order/custom/deletion, unavailable khác empty, invalid retained assignment chặn finalize. Chốt/đính chính latest giữ snapshot/editions, CAS/preview/idempotency/audit/receipt atomic. Policy15 kế thừa Scheduling read-only cho lead và thêm programs read/manage đúng own active assigned age/service unit; không cấp schedule:manage hoặc role từ assignment. A4 browser HTML xác thực, draft/revision và archived-source warning; named print page, self-host assets, không product Word/PDF export. [Contracts/runbook](engineering/P4.2-programs.md), [task](tasks/CHURCH-P4.2.md); live status chỉ project-state.


## P4.3 — ranh giới Visitation

Theo P4.3-plan-r1/C43-01–03/ASCII đã duyệt: Visitation sở hữu hồ sơ/lần thăm/history, immutable member/family target và creation snapshot, source hiện hành trả riêng với warning. Public Members/Families reduced ports/fences giữ ownership; assignment không cấp Account role hoặc ghi membership/visitor caregiver/family metadata. Unique open target+reason, root/entry CAS, preview/source fences, reasoned close/cancel/correction và history/audit/ledger cùng transaction. Policy16 cho owner/pastor/secretary, deny lead/treasurer/member kể cả counts/picker/history/receipt. Nội dung chăm sóc dùng chung cho các actor được phép, không prayer-private fields hoặc automation. W08 hai realm/deep links/reauth/frozen memory pending, W01/menu/W13 dùng shared UI. [Contracts/runbook](engineering/P4.3-visitation.md), [task](tasks/CHURCH-P4.3.md); live state chỉ project-state. P4.4 cần quyền mở riêng, phiếu in/Word/PDF thuộc P6.


## P4.4 — ranh giới Prayers và privacy

Theo P4.4-plan-r1/C44-01–03/ASCII đã duyệt: Prayers sở hữu prayer_requests/prayer_history; requester none/member/text và reduced snapshot độc lập actor nhập hộ. Visibility bất biến: shared cho owner/pastor/secretary cùng tenant, pastoral chỉ account pastor hợp lệ hiện hành (không chỉ creator). Không Owner private bypass, role từ assignment hoặc copy sang Visitation/automation. Members public prayerPort/fence không ghi profile/membership; chỉ thay source chủ động mới capture snapshot mới. Root CAS/preview/source/actor fences và request/history/audit/receipt atomic. Prayer operations bắt buộc resource ACL cả POST replay và receipt; mọi read/count/search/history scoped tại nguồn. Audit audience general/pastoral loại private metadata khỏi F23 Owner trước paging; legacy missing audience vẫn general, không backfill main.

Policy17/W01 visible-active count/W13 và W08 native list hai card; source UI-STD-r1, one-dialog/pending coordinator, URL keys riêng, private search/body chỉ RAM. Same actor receipt lookup trước cửa sổ24h resend; sau mất quyền/context hoặc hết cửa sổ mà không có receipt, xóa private DOM/form/history/query/pending. Không hứa revocation push tới tab chưa gửi request. Owner provisioning/role/reset theo P1.3 vẫn giữ nguyên; đây là quyền ứng dụng theo danh tính hiện hành, không cách ly mật mã khỏi quản trị tài khoản/hạ tầng. [Contracts/runbook](engineering/P4.4-prayers.md), [task](tasks/CHURCH-P4.4.md); live state chỉ project-state. P4.5 cần quyền mở riêng; portal/Word/PDF/export thuộc P6.


## P4.5 — ranh giới Care và đề nghị

Theo P4.5-plan-r1/C45-01–03/ASCII đã duyệt: Care sở hữu nguồn nhập tay, episode đề nghị/history và assessment từng lô; public reduced Members/Families/Attendance ports giữ nguồn có thẩm quyền. Absence theo đúng3calendarCN P3.6; newbelief theo known believedOn/stage hoặc Care signal ngày đã xác nhận trong30HCMcalendarngày, không convertedOn/baptism/createdAt; illness/member và bereavement/family là nguồn Care nhập tay. Không dependency Prayers (chung hoặc pastoral), không suy medical/family từ notes/funeral, không reverse business writes. Một active episode/tenant/target/reason; linked/dismissed suppress đến knownfalse, unknown không false/0; recurrence là đợt mới. Public Visitation application port chạy trong caller-owned transaction, giữ create/link+Care history/audit/ledger atomic, link existingcase không overwrite; assignment chọn tường minh, không cấp role hoặc tự visited/complete.

Policy18 owner tenant/pastor/secretary, deny lead/treasurer/member cả metadata. Fresh source/version/actor/preview/confirmation/CAS/resource receipt ACL; bounded paged evaluation theo yêu cầu, không scheduler hoặc global snapshot xuyên lô. W08 anchors/card3/one-dialog/pending/domain URLs, W01cached count+asOf và W13; UI-STD-r1 giữ source. [Contracts/runbook](engineering/P4.5-care.md), [task](tasks/CHURCH-P4.5.md); live state chỉ project-state. P4.6 cần quyền mở riêng; publication/real-data/main schema maintenance vẫn riêng.


## P4.6 — giao thức kiểm chứng và phục hồi tổng hợp

C46-01–03 giữ ownership/contracts P4.1–P4.5, bổ sung public cross-package workflows và qualification riêng. Backup local phải chặn request mới và drain trước fingerprint/dump, restore namespace sang UUID DB rỗng, compare toàn collections/docs/binaries/options/indexes trước revoke sessions/purge certificate_previews/rotate synthetic key. Giữ operation ledger/resource ACL và immutable histories; không auto replay qua backup cut line hoặc Redis restore/flush. P4preview digest actor/source/day không tự mất hiệu lực khi rotate key; runbook yêu cầu bỏ pending client cũ, fresh authorized receipt trước preview/confirm mới. Không recovery epoch/newproductUI/API/schema/policy hoặc production RPO/RTO/PITR. [Contracts/runbook](engineering/P4.6-qualification.md), [task](tasks/CHURCH-P4.6.md); outcomes ở project-plan, live state chỉ project-state. Đóng P4/mở P5 và publication/main maintenance cần chỉ dẫn riêng.


## Roadmap P5 đã duyệt

Ngày 2026-11-16 Khiêm duyệt P5-plan-r1: **P5.1 Quỹ và quyền tài chính → P5.2 Thu và dâng hiến → P5.3 Đề xuất và phê duyệt chi → P5.4 Phiếu chi và sổ thu chi → P5.5 Khóa sổ và điều chỉnh → P5.6 Tổng hợp và kiểm chứng tài chính**. [Danh mục/phụ thuộc/điểm dừng](tasks/CHURCH-P5.md). Mỗi gói là luồng xuyên UI/API/dữ liệu/callers, cần contracts/quyền/ASCII được duyệt trước coding và nghiệm thu/quyền mở gói sau. Định hướng Finance sở hữu dữ liệu tài chính, dùng public Members read port định danh tối thiểu và contracts Operations/Audit; bảo vệ kỳ/ghi đồng thời từ P5.2. O-D2 tiếp tục áp dụng; duyệt danh mục không chốt mapping quyền, tự duyệt, số dư, sửa sai/mở kỳ hoặc schema/API chi tiết. Thiết kế từng gói chỉ ghi sau approval tương ứng; outcomes ở project-plan, trạng thái hiện hành duy nhất ở project-state. Không tự mở P6 hoặc publication/real data/main operations.


## P5.1 — ranh giới Finance

Theo P5.1-plan-r1/C51-01–03/ASCII đã duyệt: Finance sở hữu finance_settings/funds/history; không gộp vào Organization hoặc mở money/proposals. Policy19 pastor quản lý, treasurer chỉ xem, owner/secretary/lead/member deny Finance. Config proposerRoles secretary/treasurer/lead, approverRole pastor/secretary/treasurer; không defaults/auto-init; quyền tương lai chưa endpoint. Quỹ NFC/normalized name unique trong tenant kể cả inactive, immutable ID, active↔inactive reason/CAS/history, không hard-delete. Data/history/safe audit/operation atomic; fresh auth/resource replay/receipt; general audit không name/config/reason. W12 compose theo capability; namespace pending tách riêng nhưng global intent chặn mutation mới, reauth không auto replay. W13 configured projection chỉ người có Finance ACL; static matrix không lộ live config. [Contracts/runbook](engineering/P5.1-finance.md), [task](tasks/CHURCH-P5.1.md); outcomes ở project-plan, live state chỉ project-state. Main maintenance/P5.2/publication cần authority riêng.

## Nghiệm thu P5.5-r2; mở planning P5.6 — 2026-11-18

Khiêm: **“nghiệm thu. mở P5.6”**. P5.5-r2 P55-01–05/UI55-01–04 HUMAN_ACCEPTED local/synthetic, đủ năm mục checklist; [task/acceptance](tasks/CHURCH-P5.5.md). Giữ E51-01 USER_WAIVED, E55-01 OPEN_NOT_WAIVED/audit FAIL, UI-POSTP8-01 AFTER_P8. Technical snapshots/manifest/journals r1/r2 không rewrite; source/dependencies/dist không đổi và không chạy lại tests/runtime.

P5.6 Tổng hợp và kiểm chứng tài chính chỉ **PLANNING_ONLY trong chat**: trình C56/quyền/công thức/restore/ASCII trước coding. Chưa duyệt contracts/schema/API/UI/implementation hoặc tạo task/contract/planning journal P5.6. P5 chưa đóng/P6 chưa mở; không publication/realdata/main operations/worktree/delegation. Physical/Safari/UAT/mainruntime/production/independent review và prior UNKNOWN giữ nguyên. Trạng thái hiện hành duy nhất ở project-state; phần dưới giữ chronology.
