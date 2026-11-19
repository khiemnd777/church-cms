# Kế hoạch Church CMS

## P6.6 — Kiểm chứng tổng hợp

Khiêm nghiệm thu P6.5-r1 và cho kiểm chứng P6.6 local/synthetic. Ghép luồng P6, đối chiếu file và số liệu, quyền hai Hội Thánh, lỗi/thu hồi, tải có kiểm soát và restore tách biệt trước khi bàn giao. [Task P6.6](tasks/CHURCH-P6.6.md).

## P6.5 — Gửi cầu thay cá nhân theo P6.2–P6.5-plan-r2

Khiêm xác nhận P6.4-r1 đạt đủ 5 mục và mở P6.5 local/synthetic. Dùng sổ Prayers chung, gửi riêng Mục sư, đối soát theo từng ý định gửi và xem trạng thái của chính mình. Bàn giao rồi dừng trước P6.6. [Task P6.5](tasks/CHURCH-P6.5.md).

## P6.4 — Dâng hiến cá nhân theo P6.2–P6.5-plan-r2

Khiêm nghiệm thu P6.3-r1, cho triển khai P6.4 local/synthetic theo kế hoạch và ASCII đã duyệt. Finance trả ngày, quỹ, phần đã gắn chính mình và trạng thái. Tổng ròng trong kỳ chỉ tính phần ghi sổ còn hiệu lực. Bàn giao rồi dừng trước P6.5. [Task P6.4](tasks/CHURCH-P6.4.md).

## P6.3 — gói triển khai đã duyệt

Khiêm nghiệm thu P6.2-r1 đủ năm mục local/synthetic, cho phép P6.3 local/synthetic theo kế hoạch và ASCII đã duyệt. [Task và checklist](tasks/CHURCH-P6.3.md). Handoff trước P6.4.

## P6.2–P6.5-plan-r2

Khiêm duyệt kế hoạch chung và ASCII r2, bổ sung upload mẫu Excel và kích hoạt theo Hội Thánh vào P6.2. Thứ tự nghiệm thu giữ P6.2 → P6.3 → P6.4 → P6.5. Quyền triển khai P6.2 chỉ local/synthetic. [P6.2 và checklist](tasks/CHURCH-P6.2.md). Trạng thái hiện hành tại project-state.

## P6 — danh mục đã duyệt

Khiêm duyệt P6.1–P6.6 và C6-01–08: (1) bảy biểu mẫu, (2) Báo cáo Tổng Liên Hội, (3) liên kết tài khoản và cổng hồ sơ, (4) dâng hiến cá nhân, (5) gửi cầu thay cá nhân, (6) kiểm chứng tổng hợp. Mỗi gói có quyền triển khai và nghiệm thu riêng. P6.1 được duyệt local/synthetic, dùng bộ mẫu nội bộ có watermark. [Task P6.1](tasks/CHURCH-P6.1.md); trạng thái tại project-state.

## Kế hoạch chung P6.2–P6.5

Khiêm nghiệm thu P6.1-r1 local/synthetic và mở một kế hoạch chung cho Báo cáo Tổng Liên Hội, Liên kết tài khoản và cổng hồ sơ, Dâng hiến cá nhân, Gửi cầu thay cá nhân. Chi tiết đề xuất trình trong chat để duyệt trước coding. Giữ các mốc nghiệm thu theo gói; P6.6 theo kế hoạch riêng. Trạng thái tại project-state.

## Đóng P5 và ranh giới planning P6

Khiêm đã nghiệm thu P5.6-r1 năm mục và đóng P5 local/synthetic. Sáu gói P5 đều HUMAN_ACCEPTED; [biên bản closure](tasks/CHURCH-P5.md#đóng-p5) giữ riêng human decision với technical snapshots. P6 được mở planning trong conversation khác để khảo sát nguồn, chốt gói/tiêu chí/quyền/ASCII trước coding; chưa duyệt implementation. Giữ E51-01/E55-01/UI-POSTP8-01; no main/realdata/publication. Trạng thái hiện hành chỉ project-state.

## P5.6 — kết quả và ranh giới bàn giao

P56-01–05 đã hoàn tất source và bàn giao P5.6-r1 để Khiêm nghiệm thu năm mục tại [task](tasks/CHURCH-P5.6.md). Summary/quyền/formulas/W09/W01, crossflow/browser, workload/restore và hồ sơ đều có evidence local/synthetic. E55-01 audit còn mở; E51-01 waived và UI-POSTP8-01 deferred giữ nguyên. Không đánh dấu human acceptance hoặc đóng P5/mở P6; chỉ project-state là trạng thái hiện hành.

## P5.5 — bổ sung UI55-01–04 đã duyệt

P5.5-ui-r2-plan-r1/ASCII bổ sung rule/primitive dùng chung, sửa composition W09/W10, rà/migrate các màn cùng nguyên nhân và source/rendered gap regression. Kết quả dự kiến: nhóm độc lập18px, heading/body12px, metadata6px; cả normal/empty/loading/error/pending/preview/history có bố cục rõ. Code/wiring trước tests, bàn giao P5.5-r2 theo [năm mục checklist](tasks/CHURCH-P5.5.md), dừng trước P5.6. Giữ E51-01/E55-01/UI-POSTP8-01 và authority local/synthetic; mọi mở rộng/publication/main/deploy giữ gate riêng. Trạng thái hiện hành chỉ ở project-state.

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


Ngày tổng hợp: 2026-11-10. Nguồn chi tiết: [hồ sơ P0](tasks/CHURCH-P0.md). Trạng thái hiện hành duy nhất: [project-state](project-state.md).

## Phạm vi được phép hiện tại

**P4 CLOSED local/synthetic; P4.1–P4.6 HUMAN_ACCEPTED đủ5/5 mỗi gói**, theo chỉ dẫn Khiêm ngày 2026-11-15. [Biên bản đóng P4](tasks/CHURCH-P4.md#đóng-p4). Ngày 2026-11-16 Khiêm duyệt **P5-plan-r1** rồi duyệt **P5.1-plan-r1/C51-01–03/ASCII**, cho phép trọn P51-01–05 local/synthetic. [Danh mục P5](tasks/CHURCH-P5.md), [authority P5.1](tasks/CHURCH-P5.1.md); bàn giao rồi dừng trước P5.2–P5.6. P5.1-r2 đã được Khiêm nghiệm thu đủ P51-01–05, giữ E51-01 USER_WAIVED; chỉ mở kế hoạch chi tiết P5.2 trong chat để duyệt trước coding. Không claim artifact khôi phục. Chưa released/publication/deploy/real data/main DB read/init/restart3443; giữ snapshots/UNKNOWN/NOT_RUN.


## P0 — Đặc tả và phê duyệt

Đầu ra: ma trận nguồn → tính năng → quyền/trạng thái → mockup → tiêu chí kiểm chứng; chốt phạm vi bản đầu và các quyết định ảnh hưởng kiến trúc.

Đã được duyệt từng phần: định hướng/stack; W01–W18 và ngoại lệ wordless; A01 và card hỗ trợ; A02 user bị C19 thay thế; owner cấp account thay lời mời; O-D1–O-D5/O01–O03; mockup luồng mật khẩu tạm → đăng nhập đầu → đổi mật khẩu, tối thiểu 8 ký tự. Xem các phiên bản hiện hành trong hồ sơ P0, không dùng nhánh lời mời cũ.

C16: Khiêm chấp thuận phần còn lại của P0 theo thiết kế đã trình. 2FA **không thuộc scope triển khai hiện tại**, không tiếp tục hỏi lại D2; có thể xét trong tương lai. Bàn giao/hỗ trợ theo hướng đã chốt, không mở lại phương án lời mời hoặc khôi phục tự phục vụ.

C16 chỉ chấp thuận phạm vi/thiết kế đã trình. C17 làm rõ dữ liệu/API nền tảng chưa được thiết kế đầy đủ; C18 cho phép hoàn thiện phần kỹ thuật bằng tài liệu, chưa code. Đã lập [P0-FOUNDATION-r2](engineering/P0-FOUNDATION.md): model/indexes, session/authorization, transaction/idempotency, 28 API active và 26 tiêu chí nghiệm thu. Contracts/thông số r2 đã được Khiêm duyệt tại C20, không coi toàn bộ đầu ra P0 đã hoàn tất.

Gói thiết kế đã nghiệm thu: **P0-FOUNDATION-r2 — tài liệu thiết kế nền tảng**. Đầu ra có đủ dữ liệu/API/acceptance và liên kết tới A/O đã duyệt; kiểm tra tĩnh và tự review thiết kế, đã được Khiêm nghiệm thu tại C20. Không cài dependencies, tạo schema/migration hoặc code/tests ứng dụng. Sau bàn giao dừng, không mở gói tiếp.

Các thông số chưa có giá trị cụ thể (quy mô, nơi lưu, liên hệ, mẫu thật và rules P2–P7) vẫn là đầu vào của gói tương ứng, không bịa dữ liệu. Danh mục/gói P1 đã được duyệt ở P1-plan-r1 bên dưới; chỉ P1.1 được mở implementation.

## Roadmap theo định hướng đã thảo luận

| Đợt | Kết quả dự kiến | Điều kiện kiểm chứng/duyệt |
|---|---|---|
| P1 | Nền tảng tenant, auth, owner/account, quyền, audit, local/CI | Cách ly tenant, đổi/thu hồi quyền, vòng đời tài khoản/phiên |
| P2 | Cấu hình, thuộc viên/thân hữu, gia đình, ban/khu vực, import/export, dashboard cơ bản | Luồng Thư ký thật; import preview/đối soát/chống trùng |
| P3 | Điểm danh tay/QR, lớp dự bị/lễ nghi, thẻ/chứng nhận | Cạnh tranh điểm danh; camera điện thoại; dữ liệu và bản in |
| P4 | Lịch giảng/sinh hoạt, thăm viếng, cầu thay, cảnh báo | Phân công/quyền riêng tư/tác vụ không trùng |
| P5 | Quỹ/dâng hiến, đề xuất/duyệt/thu chi, khóa sổ | Quyền, retry/transaction/concurrency và nghiệm thu nghiệp vụ tài chính |
| P6 | Đủ biểu mẫu/báo cáo/định dạng, cổng tín hữu | Mẫu thật, dữ liệu đúng scope, tài khoản gắn đúng người |
| P7 | OCR/nhắc ngoài/chứng từ/nhiều cấp/chữ lớn | Chỉ khi có scope, nhà cung cấp, chi phí và quyền dữ liệu riêng |
| P8 | Pilot nhiều Hội Thánh, chuyển dữ liệu, phục hồi, phát hành | UAT, vận hành và quyền phát hành riêng |

Đây là roadmap, không phải lệnh bắt đầu P1–P8 hoặc cam kết tất cả mục đề xuất có trong bản đầu. Chưa có lịch/chi phí cam kết; cần OPEN-04 và phạm vi đã chốt.

## Trình tự thực hiện sau khi được phép

Trước implementation của roadmap dài, xác định và duyệt danh mục gói nghiệm thu có ý nghĩa, kết quả, phụ thuộc và tiêu chí kiểm chứng. Bức tranh định hướng lưu tại [project-context](project-context.md); P0–P8 chưa là danh mục gói implementation đã chốt.

Trong mỗi gói được phép: hoàn thiện production code và wiring → viết/cập nhật tests → chạy checks/review/render/UAT liên quan → bàn giao theo [mẫu có ảnh/sơ đồ thực tế](handoff-templates.md) → dừng chờ Khiêm nghiệm thu và cho phép mở gói sau. Không tạo handoff giả giữa từng file; không dùng mocks hoặc technical PASS thay nghiệm thu sản phẩm. Task ngắn dùng mẫu bàn giao một lần, không thêm roadmap. Test chọn theo rủi ro domain, tenant, concurrency, import/export và vận hành. Lệnh thực tế chỉ ghi sau khi có scaffold và được xác minh.

## Điều chỉnh C19 — ràng buộc danh tính

Owner là nhân viên công ty cung cấp QLHT, account riêng; user account thuộc duy nhất một Hội Thánh, không memberships nhiều tenant hoặc chọn/chuyển Hội Thánh. Chỉ owners có cross-tenant và vẫn giữ giới hạn O-D2. R2 tại tài liệu nền tảng là hợp đồng hiện hành HUMAN ACCEPTED tại C20, thay thế r1. Đây là mô hình thiết kế đã duyệt; implementation theo các gói P1.

## C20 — r2 đã được duyệt

Thiết kế nền tảng P0-FOUNDATION-r2 đã được Khiêm duyệt (“Duyệt r2.”). Tại C20 dừng trước P1; phê duyệt P1-plan-r1 mới nhất bên dưới thay điểm dừng này và chỉ mở P1.1. Phần thiết kế nghiệp vụ P2–P7 chưa được coi là hoàn tất chỉ từ xác nhận này.

## P1-plan-r1 — đã duyệt

Danh mục và acceptance: [CHURCH-P1](tasks/CHURCH-P1.md). Khiêm duyệt kế hoạch/hai mockup và mở P1.1. P1.2–P1.4 cần nghiệm thu và quyền mở riêng.

## Quyền mở P1.2

Khiêm nghiệm thu P1.1 và cho mở P1.2/O01/O02 theo P1-plan-r1. F10–F14/F22, kiểm chứng CAS/idempotency/transaction/audit/keyset/UI. Dừng bàn giao trước P1.3.

## Hồ sơ implementation P1.2

O01/O02 và F10–F14/F22 theo P1-plan-r1. Contracts/wiring tại [P1.2 tenancy](engineering/P1.2-tenancy.md); biên bản trong CHURCH-P1, trạng thái hiện hành tại project-state. Sau nghiệm thu và quyền mở riêng mới thực hiện P1.3.

## UI-STD-r1 — chuẩn hóa UI trong P1.2

Khiêm đã duyệt trọn gói UI01–UI05: nguồn style HTML → bộ UI chung → chuyển A01/A04/hỗ trợ/reauth/O01/O02 → trang mẫu/đối chiếu light-dark-responsive và luồng P1.2 → tài liệu/check kế thừa. Một lần bàn giao trong gói P1.2, không tách approval theo file/component. Phạm vi và tiêu chí: [UI-STD-r1](tasks/UI-STD-r1.md); kết quả sống xem project-state. Sau bàn giao dừng trước P1.3 để Khiêm nghiệm thu.

Sửa nhãn menu đã được Khiêm duyệt sau khi từ chối UI-STD-r1: N01 render icon+tên/description tại AppShell, N02 cập nhật chuẩn thay rule ẩn nhãn cũ, N03 xác minh visible text trên hai theme/desktop/mobile và trạng thái chọn/disabled. Cùng gói P1.2, không mở P1.3.


## Quyền mở P1.3

Khiêm: “Duyệt triển khai P1.3-plan-r1”. P1.3 giữ chính sách owner quản trị account khi church suspended; user login/context bị chặn. P13-01–05 bàn giao cùng lúc, không thêm gate theo file/lớp. Không tự mở P1.4. Hạng mục và tiêu chí nghiệm thu tại CHURCH-P1.3, trạng thái live duy nhất tại project-state.

## P2-plan-r1 và P2.1-plan-r1 — đã duyệt 2026-11-11

Khiêm duyệt danh mục P2.1–P2.6 và mở trọn P21-01–05 local/synthetic theo [CHURCH-P2](tasks/CHURCH-P2.md), [CHURCH-P2.1](tasks/CHURCH-P2.1.md). Phê duyệt mới thay giới hạn P2 NOT_OPENED ở phần lịch sử; không tự mở P2.2 hoặc commit/push/deploy/dữ liệu thật.

### Sửa UI theo nghiệm thu P2.1

Human review1 CHANGES_REQUESTED vì spacing. P2.1-r2 sửa Field/layout và thêm geometry regression trong cùng P21-03/04; bàn giao lại, không thay danh mục/thứ tự gói. Chi tiết outcome ở CHURCH-P2.1; trạng thái hiện hành ở project-state.

## P2.2-plan-r1 — implementation được duyệt

Khiêm duyệt contracts/quy tắc/mockup P2.2-plan-r1 và mở trọn P22-01–05 local/synthetic ngày2026-11-11. Chi tiết [CHURCH-P2.2](tasks/CHURCH-P2.2.md). Bàn giao rồi dừng trước P2.3; không publication/deploy/dữ liệu thật.

## Nghiệm thu P2.2 và điểm dừng

Khiêm xác nhận “Nghiệm thu P2.2, chưa mở P2.3”. P22-01–05/P2.2-r1 đã human accepted local/synthetic; [biên bản](tasks/CHURCH-P2.2.md#human-review1--accepted). Chưa mở planning/implementation P2.3, không publication/deploy/dữ liệu thật. Trạng thái sống duy nhất tại project-state.

## Mở lập kế hoạch P2.3

Chỉ dẫn mới của Khiêm: “mở P2.3”. Mở lập kế hoạch chi tiết Gia đình và lịch sử tách/gộp, kế thừa P2.2 đã nghiệm thu. P2.3-plan-r1 trình trong chat để duyệt contracts/acceptance/mockup trước implementation; dự thảo chưa duyệt chưa lưu thành đặc tả đã chốt. Chưa mở P2.4 hoặc publication/deploy/dữ liệu thật. [Authority](tasks/CHURCH-P2.md#quyền-mở-lập-kế-hoạch-p23); live state tại project-state.

## P2.3-plan-r1 — implementation được duyệt

Khiêm đã duyệt trọn P23-01–05 local/synthetic; [contracts/acceptance](tasks/CHURCH-P2.3.md). Hoàn tất code/wiring trước tests, bàn giao rồi dừng trước P2.4. Không publication/deploy/dữ liệu thật.

P23-01–05 đã bàn giao P2.3-r1 với local verification; human acceptance PENDING_REVIEW, dừng trước P2.4. [Biên bản](tasks/CHURCH-P2.3.md). Không publication/deploy/dữ liệu thật.

## Mở lập kế hoạch P2.4

Theo chỉ dẫn mới của Khiêm, P2.3 đã nghiệm thu; mở P2.4 Tổ chức thực tế và phạm vi truy cập để trình kế hoạch chi tiết trước coding. P2.4-plan-r1 còn chờ duyệt; đề xuất trong chat không là quyền implementation. [Authority](tasks/CHURCH-P2.md#nghiệm-thu-p23-và-mở-planning-p24).

## P2.4-plan-r1 — đã duyệt triển khai

Khiêm duyệt trọn P24-01–05 local/synthetic, một gói nghiệm thu; [task](tasks/CHURCH-P2.4.md), [contracts](engineering/P2.4-organization-runtime.md). Dừng trước P2.5; không publication/deploy/dữ liệu thật. Bản planning mở phía trên là lịch sử trước approval mới.

P24-01–05 đã bàn giao P2.4-r1 local/synthetic; human acceptance PENDING_REVIEW. [Biên bản](tasks/CHURCH-P2.4.md). Dừng trước P2.5; live state chỉ ở project-state.

## P2.4-view-plan-r1 — sửa P24-04/05

Khiêm duyệt switch Card ↔ Bảng giữ group và scoped data/actions, nhớ preference account/church. Bàn giao P2.4-r2 local/synthetic để nghiệm thu rồi dừng trước P2.5; không publication/deploy/dữ liệu thật. [Task](tasks/CHURCH-P2.4.md).

P24-04/05 đã bàn giao P2.4-r2 Card/Bảng theo view-plan-r1, local verified/chờ nghiệm thu; [task](tasks/CHURCH-P2.4.md). Dừng trước P2.5; live state chỉ ở project-state.

## P2.4-icon-plan-r1 — bàn giao r3

Khiêm duyệt icon-only switcher P24-04/05; r3 local verified/chờ nghiệm thu. [Biên bản](tasks/CHURCH-P2.4.md). Không publication/deploy/dữ liệu thật; dừng trước P2.5. Live state chỉ ở project-state.

## Quyền implementation P2.5 — 2026-11-12

Khiêm duyệt P2.5-plan-r1 và trọn P25-01–05 local/synthetic. [Task](tasks/CHURCH-P2.5.md); bàn giao nghiệm thu rồi dừng trước P2.6. Không commit/push/deploy/dữ liệu thật.

## Bàn giao P2.5-r1

P25-01–05 source complete/local verified: CSV/XLSX import preview/đối chiếu/source identities/batches/partial/resume và protected filtered export. [Task/checklist](tasks/CHURCH-P2.5.md), [contracts](engineering/P2.5-data-exchange.md), [receipt](../output/p2.5/verification.json). Bàn giao để Khiêm nghiệm thu rồi dừng trước P2.6; không publication/deploy/dữ liệu thật. Live status chỉ tại project-state.

## Mở kế hoạch P2.6 — 2026-11-12

Theo chỉ dẫn Khiêm, P2.5-r1 đã nghiệm thu; mở lập kế hoạch gói cuối P2: Tổng quan W01 và qualification xuyên P2. [Authority](tasks/CHURCH-P2.md). P2.6-plan-r1 trình chat, chưa coding. P2 chưa đóng/P3 chưa mở; không publication/deploy/dữ liệu thật.

## Quyền implementation P2.6 — 2026-11-12

Khiêm: “Duyệt P2.6-plan-r1 để triển khai trọn P26-01–05 local/synthetic, bàn giao nghiệm thu rồi dừng trước P3. Chưa đóng P2, commit/push, deploy hoặc dùng dữ liệu thật.” [Task](tasks/CHURCH-P2.6.md). Hoàn tất P26-01–05 local/synthetic, bàn giao nghiệm thu; chưa đóng P2/P3 chưa mở.

## Bàn giao P2.6-r1 — 2026-11-12

P26-01–05 source complete/local-synthetic verified: public metrics/snapshot API/W01+drilldowns/qualification+restore/regression. [Biên bản/checklist](tasks/CHURCH-P2.6.md), [contracts](engineering/P2.6-overview-qualification.md), [receipt](../output/p2.6/verification.json). Bàn giao chờ Khiêm nghiệm thu; không tự đóng P2/mở P3, publication/deploy/dữ liệu thật. Live status chỉ tại project-state.


## Đóng P2 — 2026-11-12

Khiêm: “Nghiệm thu P2.6-r1. Đóng P2. Chưa mở P3.” P2.1–P2.6 đã nghiệm thu local/synthetic; P2 CLOSED, P3 NOT_OPENED. [Closure](tasks/CHURCH-P2.md#đóng-p2), [acceptance P2.6](engineering/skill-usage/records/CHURCH-P2/P2.6-human-acceptance-1.json). Không tự mở planning/implementation P3 hoặc publication/deploy/dữ liệu thật; bằng chứng và giới hạn kỹ thuật giữ nguyên từ bàn giao, không chạy tests mới.

## P3-plan-r1 — duyệt danh mục và mở planning P3.1

Khiêm: **“Duyệt P3-plan-r1. Mở kế hoạch chi tiết P3.1 để duyệt trước coding.”** ngày2026-11-12. Chỉ dẫn này thay điểm dừng chưa mở P3 ở biên bản đóng P2. Danh mục sáu gói/đầu ra/phụ thuộc tại [CHURCH-P3](tasks/CHURCH-P3.md): điểm danh tay → QR/thẻ → lớp dự bị → sổ lễ nghi → chứng nhận → tổng hợp/kiểm chứng. Gói P3.1 đang lập kế hoạch chi tiết trong chat; chưa có quyền implementation, không mở P3.2–P3.6/publication/deploy/dữ liệu thật. Chỉ ghi nhận phần đã được duyệt, không lưu dự thảo P3.1 chưa duyệt thành đặc tả đã chốt.

## P3.1-plan-r1 — implementation được duyệt

Khiêm duyệt P3.1-plan-r1, gồm ba lựa chọn ở mục3, trọn P31-01–05 local/synthetic; bàn giao nghiệm thu rồi dừng trước P3.2. Không commit/push/deploy/dữ liệu thật. [Task/authority](tasks/CHURCH-P3.1.md), [contracts/runbook](engineering/P3.1-attendance.md). Chỉ dẫn này thay giới hạn planning-only P3.1 ở biên bản trước; không mở gói khác.

## Bàn giao P3.1-r1 — 2026-11-12

P31-01–05 source complete/local-synthetic verified: Attendance sessions/snapshots/marks/CAS/generation/ledger/resource ACL/W05/qualification. [Biên bản và checklist](tasks/CHURCH-P3.1.md), [contracts/runbook](engineering/P3.1-attendance.md), [receipt](../output/p3.1/verification.json). Chờ Khiêm nghiệm thu rồi mới có thể mở gói tiếp theo bằng chỉ dẫn riêng; dừng trước P3.2. Không Git publication/deploy/dữ liệu thật/init main DB/restart3443. Live status chỉ tại project-state.

## Nghiệm thu P3.1-r1; mở kế hoạch P3.2 — 2026-11-13

Theo chỉ dẫn Khiêm “Nghiệm thu P3.1-r1, mở P3.2”, P31-01–05 HUMAN ACCEPTED local/synthetic. [Biên bản/evidence](tasks/CHURCH-P3.1.md), [acceptance](engineering/skill-usage/records/CHURCH-P3/P3.1-human-acceptance-1.json). P3.2 Thẻ tín hữu/QR mở PLANNING_ONLY theo P3-plan-r1; contracts/ASCII/mockup đề xuất trong chat chờ duyệt trước coding. Không sửa receipt/journal implementation P3.1 hoặc tính lại usage; không chạy lại runtime/tests trong bước ghi nhận. Không tự mở P3.3/publication/deploy/dữ liệu thật/init main DB/restart dịch vụ.

## Quyền implementation P3.2 — 2026-11-13

Khiêm: “duyệt P3.2-plan-r1”. P32-01–05 theo [task P3.2](tasks/CHURCH-P3.2.md) được phép trọn gói local/synthetic, code/wiring trước tests, bàn giao rồi dừng trước P3.3. Không publication/deploy/dữ liệu thật/init main DB/restart. P3-PHYSICAL-01 chưa kiểm camera điện thoại/bản giấy, giữ mục cần nhắc và không tự đóng bằng synthetic.

## Bàn giao P3.2-r1

P32-01–05 Cards/QR source complete/local-synthetic verified: lifecycle/snapshot/revision + Attendance proof60giây/fresh commit + W14/W05/print86×54mm + tests/qualification + contracts/evidence. [Checklist/kết quả](tasks/CHURCH-P3.2.md), [contracts](engineering/P3.2-cards-qr.md). Human acceptance chờ Khiêm; P3.3 chưa mở. Physical camera/giấy giữ NOT_RUN; chưa init main DB/restart3443/publication/deploy/dữ liệu thật. Trạng thái hiện hành duy nhất tại project-state.

## Nghiệm thu P3.2-r1; mở planning P3.3

Theo Khiêm “nghiệm thu P3.2-r1 theo checklist; đồng ý mở planning P3.3”, P32-01–05 HUMAN ACCEPTED local/synthetic. [Biên bản](tasks/CHURCH-P3.2.md), [evaluation](engineering/skill-usage/records/CHURCH-P3/P3.2-human-acceptance-1.json). P3.3 Lớp dự bị chỉ PLANNING_ONLY: khảo sát nghiệp vụ/source, trình contracts/acceptance/ASCII trong chat để duyệt trước coding, không tự tạo draft đã duyệt hoặc code. Bằng chứng/journal implementation P3.2 giữ nguyên; camera thật/giấy thật vẫn NOT_RUN. Không publication/deploy/real data/main DB init/restart; P3.4–P3.6 chưa mở.

## P3.3-plan-r1 — implementation authority

Khiêm duyệt C33-01–03 và trọn P33-01–05 local/synthetic; [task](tasks/CHURCH-P3.3.md). Code/wiring toàn gói trước tests; bàn giao rồi dừng trước P3.4. Chưa commit/push/deploy/real data/main DB init/restart; camera thật/giấy giữ NOT_RUN. Live status tại project-state.

## Bàn giao P3.3-r1

P33-01–05 source complete/local-synthetic verified theo C33-01–03: khóa/ghi danh, source Attendance/credit bù, phỏng vấn sự kiện không tự điều kiện Báp-têm, W06/W14/W05, tests/workload/contracts/evidence. [Checklist/kết quả](tasks/CHURCH-P3.3.md), [contracts](engineering/P3.3-prep-classes.md). Human acceptance pending; P3.4 chưa mở. Physical camera/giấy/main runtime/full200lessoncapacity/production chưa kiểm; không publication/deploy/real data/main DB init/restart. Live state chỉ tại project-state.

## P3.4-plan-r1 — implementation được duyệt 2026-11-13

Khiêm duyệt C34-01–03/ASCII và trọn P34-01–05 local/synthetic; [authority và phạm vi](tasks/CHURCH-P3.4.md). Code/wiring trước tests, một lần bàn giao rồi dừng trước P3.5. Không commit/push/deploy/real data/main DB init/restart. Physical NOT_RUN giữ nguyên; các planning-only phía trên là lịch sử trước approval này.

## Bàn giao P3.4-r1

P34-01–05 local/synthetic hoàn tất và đã kiểm chứng; [task/checklist](tasks/CHURCH-P3.4.md), [contracts](engineering/P3.4-rites.md). Chờ human acceptance, chưa released; dừng trước P3.5/P3.6. Bằng chứng và giới hạn tại task/receipt; live state duy nhất tại project-state. Không commit/push/deploy/real data/main DB init/restart. Physical NOT_RUN giữ nguyên.

## P3.5-plan-r1 — implementation được duyệt 2026-11-13

Khiêm duyệt C35-01–03/ASCII và trọn P35-01–05 local/synthetic; [authority/checklist](tasks/CHURCH-P3.5.md). Code/wiring trước tests, một lần bàn giao rồi dừng trước P3.6. Không commit/push/deploy/real data/main DB init/restart. Physical NOT_RUN giữ nguyên; planning-only phía trên là chronology trước approval.

## P3.5-r1 — bàn giao local/synthetic 2026-11-13

P35-01–05/C35-01–03/ASCII hoàn tất; [task/checklist](tasks/CHURCH-P3.5.md), [contracts](engineering/P3.5-certificates.md), [receipt](../output/p3.5/verification.json). Technical PASS không thay Khiêm nghiệm thu/release. Chờ nghiệm thu năm mục; dừng trước P3.6, chưa mở planning/coding. Không commit/push/deploy/real data/main DB init/restart3443. Physical/native Word NOT_RUN giữ nguyên; live status duy nhất tại project-state.

## P3.5-r1 accepted; P3.6 mở planning — 2026-11-13

Khiêm: **“Nghiệm thu P3.5-r1 theo năm mục trên; mở P3.6.”** [Biên bản/checklist](tasks/CHURCH-P3.5.md), [evaluation](engineering/skill-usage/records/CHURCH-P3/P3.5-human-acceptance-1.json). Không sửa technical snapshots/usage cũ. P3.6 chỉ PLANNING_ONLY trong chat để duyệt kế hoạch trước coding; không mở P4/đóng P3/publication/deploy/real data/main DB init/restart. Physical/native Word NOT_RUN giữ nguyên.

## P3.6-plan-r1 — implementation được duyệt 2026-11-13

Khiêm duyệt C36-01–03/ASCII và P36-01–05 local/synthetic; [task/authority](tasks/CHURCH-P3.6.md). Code/wiring trước tests, bàn giao rồi dừng; chưa đóng P3/mở P4, chưa publication/deploy/real data/main DB init/restart3443. Physical/native Word NOT_RUN giữ nguyên.


## Đầu ra bàn giao P3.6-r1 — 2026-11-13

P36-01–05 hoàn tất nguồn và kiểm chứng local/synthetic theo plan-r1/C36-01–03/ASCII. [Checklist/biên bản](tasks/CHURCH-P3.6.md) gồm công thức/source window; UI/drilldown hai realm; cross-P3 workflow; quyền/concurrency/replay/regression; tải/restore/cleanup/NOT_RUN. Chờ Khiêm nghiệm thu; không tự đóng P3/mở P4 hoặc publication/deploy/dữ liệu thật. Read ports/snapshot/query contracts và runbook tại [P3.6](engineering/P3.6-reporting.md).


## Nghiệm thu P3.6-r1 và giữ điểm dừng — 2026-11-13

Khiêm: **“Anh nghiệm thu P3.6-r1 theo năm mục; ghi nhận acceptance rồi tiếp tục dừng trước đóng P3, chưa mở P4.”** P36-01–05 HUMAN_ACCEPTED đủ năm mục local/synthetic. [Biên bản/checklist](tasks/CHURCH-P3.6.md), [evaluation](engineering/skill-usage/records/CHURCH-P3/P3.6-human-acceptance-1.json). Giữ nguyên technical snapshots/journal implementation; không chạy lại tests/runtime. Chưa đóng P3/mở P4/commit/push/deploy/real data/main DB init/restart3443. Camera/giấy thật/native Word và các giới hạn NOT_RUN vẫn giữ nguyên. Live state duy nhất tại project-state.


## Đóng P3; P4 chưa mở — 2026-11-13

Theo chỉ dẫn Khiêm, P3 CLOSED sau nghiệm thu sáu gói local/synthetic. [Biên bản](tasks/CHURCH-P3.md#đóng-p3), [closure evaluation](engineering/skill-usage/records/CHURCH-P3/P3-closure-1.json). Chỉ thông báo chat P4 đã chỉ định; không duyệt P4-plan-r1 hoặc mở P4/planning chi tiết/coding. Giữ technical snapshots, NOT_RUN và giới hạn; chưa commit/push/deploy/real data/main DB init/restart3443. Live state duy nhất tại project-state; các điểm dừng P3 chưa đóng phía trên là lịch sử.


## P4-plan-r1 — duyệt danh mục, mở planning P4.1 — 2026-11-13

Khiêm: **“Duyệt P4-plan-r1. Mở kế hoạch chi tiết P4.1 để duyệt trước coding.”** [Danh mục sáu gói/thứ tự/điểm dừng](tasks/CHURCH-P4.md), [journal danh mục](engineering/skill-usage/records/CHURCH-P4/P4-plan-planning-1.json), [approval evaluation](engineering/skill-usage/records/CHURCH-P4/P4-plan-human-approval-1.json). Chỉ ghi nhận kế hoạch danh mục đã duyệt; P4.1 mở investigation và kế hoạch chi tiết trong chat, chưa duyệt implementation. Không lưu draft contracts/quy tắc/ASCII P4.1 như quyết định đã chốt. P4.2–P4.6 chưa mở. P3 CLOSED local/synthetic và technical snapshots/NOT_RUN giữ nguyên; không code/tests/runtime mới hoặc commit/push/deploy/real data/main DB init/restart3443.


## P4.1-plan-r1 — implementation được duyệt — 2026-11-13

Khiêm duyệt C41-01–03/ASCII và P41-01–05 local/synthetic; [task](tasks/CHURCH-P4.1.md). Domain/API/quyền/W07/callers hoàn chỉnh trước tests/checks/self-review/qualification; một bàn giao rồi dừng trước P4.2. Không publication/deploy/real data/main DB init/restart3443.


## Bàn giao P4.1-r1 — 2026-11-14

P41-01–05/C41-01–03/ASCII hoàn tất nguồn và kiểm chứng local/synthetic; [task/năm mục nghiệm thu](tasks/CHURCH-P4.1.md), [receipt](../output/p4.1/verification.json). Calendar/recurrence/assignments/preview/history và quyền hai realm, W07/W13/W01 wiring; tests/browser/workload/index/cleanup/self-review theo scope. Chờ human acceptance, dừng trước P4.2. Không publication/deploy/real data/main DB init/restart3443; giữ NOT_RUN/physical và P3 receipts.


## Nghiệm thu P4.1-r1 và mở planning P4.2 — 2026-11-14

Khiêm: **“Nghiệm thu P4.1-r1 theo năm mục trong checklist. Mở kế hoạch chi tiết P4.2 để duyệt trước coding.”** [Checklist/evaluation](tasks/CHURCH-P4.1.md). Năm mục P41-01–05 HUMAN_ACCEPTED local/synthetic. P4.2 chỉ lập kế hoạch chi tiết/ASCII trong chat, chưa duyệt thiết kế hoặc implementation; P4.3–P4.6 chưa mở. Không ghi lại usage hoặc sửa receipts/source manifest/implementation/self-review journals P4.1, không chạy lại tests/runtime. Chưa publication/deploy/real data/main DB init/restart3443; physical/NOT_RUN và qualification limits giữ nguyên.


## P4.2-plan-r1 — implementation được duyệt — 2026-11-14

Khiêm: **“Duyệt P4.2-plan-r1, C42-01–03 và ASCII. Triển khai trọn P42-01–05 local/synthetic rồi bàn giao, dừng trước P4.3. Chưa commit/push/deploy hoặc dùng dữ liệu thật.”** [Authority/C42/ASCII/checklist](tasks/CHURCH-P4.2.md). Không mở P4.3 hoặc publication/deploy/real data/main DB init/restart3443.


## Bàn giao P4.2-r1 — 2026-11-14

P42-01–05 source/wiring và kiểm chứng local/synthetic hoàn tất; [năm mục nghiệm thu và evidence](tasks/CHURCH-P4.2.md), [contracts/runbook](engineering/P4.2-programs.md). Template/merge giữ manual, draft/immutable revisions/history, rights15 tách program/calendar, W07 hai realm, authenticated A4. Chờ human acceptance, không tự mở P4.3. P4.1 đã nghiệm thu; P4.3 Hồ sơ thăm viếng → P4.4 Cầu thay/quyền riêng tư → P4.5 Cảnh báo/chăm sóc tự động → P4.6 Tổng hợp/kiểm chứng còn theo thứ tự đã duyệt và chưa mở. Giữ giới hạn physical/NOT_RUN/main runtime/restore, chưa publication/deploy/real data. Live state chỉ project-state.


## Nghiệm thu P4.2-r1 và mở planning P4.3 — 2026-11-14

Khiêm: **“Nghiệm thu P4.2-r1 theo năm mục; đồng ý, cho phép mở kế hoạch chi tiết P4.3 để duyệt trước coding.”** [Checklist/evaluation](tasks/CHURCH-P4.2.md). P42-01–05 HUMAN_ACCEPTED đủ5/5; chỉ mở planning P4.3 trong chat, chưa chốt C43/contracts/quyền/ASCII hoặc coding. P4.4–P4.6 chưa mở; không chạy lại runtime/tests, không sửa technical receipts/implementation journals, không publication/deploy/real data/main DB init/restart3443. Physical/NOT_RUN và workload/restore limits giữ nguyên.


## P4.3 implementation được duyệt — 2026-11-14

Khiêm: **“Duyệt P4.3-plan-r1, C43-01–03 và ASCII, cho phép triển khai trọn P43-01–05 local/synthetic, bàn giao rồi dừng trước P4.4”** [Authority/C43/ASCII/checklist](tasks/CHURCH-P4.3.md). Không mở P4.4 hoặc publication/deploy/real data/main DB init/restart3443.


## Bàn giao P4.3-r1 — 2026-11-14

P43-01–05/C43-01–03/ASCII hoàn tất nguồn/wiring trước test phase và kiểm chứng local/synthetic; chờ Khiêm nghiệm thu năm mục P4.3-r1. P4.4–P4.6 NOT_OPENED. Không publication/deploy/real data/main DB read/init/restart3443. [Task/checklist/evidence](tasks/CHURCH-P4.3.md), [contracts](engineering/P4.3-visitation.md). Visitation/public source ports/Policy16/W08 và callers, transaction/history/receipt, tests/browser/workload/cleanup hoàn tất trong scope. Chưa mở P4.4 Cầu thay/quyền riêng tư; P4.5/P4.6 theo thứ tự đã duyệt, physical/NOT_RUN/restore limits giữ nguyên. Live state chỉ project-state.


## Nghiệm thu P4.3-r1, mở planning P4.4 — 2026-11-14

Khiêm: **“nghiệm thu năm mục P4.3-r1 và cho phép mở kế hoạch chi tiết P4.4 để duyệt trước coding.”** P43-01–05 đã HUMAN_ACCEPTED đủ năm mục local/synthetic; [task/checklist](tasks/CHURCH-P4.3.md), [evaluation](engineering/skill-usage/records/CHURCH-P4/P4.3-human-acceptance-1.json). Chỉ mở khảo sát/kế hoạch chi tiết P4.4 trong chat để duyệt trước coding; chưa chốt C44/quyền/trạng thái/contracts/ASCII hoặc implementation. P4.5–P4.6 chưa mở. Giữ nguyên technical snapshots/journals P4.3 và UNKNOWN P3.4 race/physical/NOT_RUN/workload/restore limits; không chạy lại runtime/tests hoặc publication/deploy/real data/main DB read/init/restart3443. Live state chỉ project-state.


## P4.4 implementation được duyệt — 2026-11-14

Khiêm: **“duyệt P4.4-plan-r1, C44-01–03 và ASCII, cho phép triển khai trọn P44-01–05 local/synthetic, bàn giao rồi dừng trước P4.5.”** [Task/C44/ASCII/checklist](tasks/CHURCH-P4.4.md). Không mở P4.5 hoặc publication/deploy/real data/main DB read/init/restart3443.


## Bàn giao P4.4-r1 — 2026-11-14

P44-01–05 hoàn tất nguồn/wiring trước test phase và PASS local/synthetic:354tests/5133assertions,707browserchecks+2289regressionchecks,9configs/480journeys/12plans, cleanup0. [Task/năm mục/evidence](tasks/CHURCH-P4.4.md), [contracts/runbook](engineering/P4.4-prayers.md). Chờ human acceptance; P4.5/P4.6 chưa mở, không tự coding/implementation planning gói sau. Không publication/deploy/real data/main DB read/init/restart3443. P4.1–P4.3 HUMAN_ACCEPTED; giữ P43technical artifacts và P3.4UNKNOWN/physical/NOT_RUN/restore limits. Live state chỉ project-state.


## Nghiệm thu P4.4-r1, mở planning P4.5 — 2026-11-14

Khiêm: **“nghiệm thu P4.4-r1 và cho phép mở kế hoạch chi tiết P4.5 để duyệt trước coding.”** P44-01–05 HUMAN_ACCEPTED đủ năm mục local/synthetic; [task/checklist](tasks/CHURCH-P4.4.md), [evaluation](engineering/skill-usage/records/CHURCH-P4/P4.4-human-acceptance-1.json). Chỉ mở khảo sát/kế hoạch chi tiết P4.5 trong chat trước coding; chưa chốt C45/nguồn/quyền/trạng thái/contracts/ASCII hoặc implementation. P4.6 chưa mở. Không chạy lại tests/runtime, giữ9technical artifacts/journals P4.4 và P3.4UNKNOWN/physical/NOT_RUN/restore limits. Không publication/deploy/real data/main DB read/init/restart3443/worktree/delegation. Live state chỉ project-state.


## P4.5 implementation được duyệt — 2026-11-14

Khiêm duyệt P4.5-plan-r1/C45-01–03/ASCII, triển khai trọn P45-01–05 local/synthetic, bàn giao rồi dừng P4.6. Không publication/deploy/real data/main DB read/init/restart3443; giữ prior snapshots/UNKNOWN/NOT_RUN. Chi tiết tại [CHURCH-P4.5](tasks/CHURCH-P4.5.md).


## Bàn giao P4.5-r1 — 2026-11-14

P45-01–05/C45-01–03/ASCII hoàn tất nguồn/wiring trước testphase và PASS local/synthetic; [task/năm mục/evidence](tasks/CHURCH-P4.5.md), [contracts](engineering/P4.5-care.md). Chờ Khiêm nghiệm thu P4.5-r1; dừng trước P4.6 Tổng hợp/kiểm chứng, chưa mở. P4.1–P4.4 HUMAN_ACCEPTED; giữ9P44technical artifacts/journals. Không publication/deploy/realdata/main DB read/init/restart3443/worktree/delegation. Giữ P3.4UNKNOWN/physical/NOT_RUN/restore limits; live state chỉ project-state.


## Nghiệm thu P4.5-r1, mở planning P4.6 — 2026-11-14

Khiêm: **“nghiệm thu năm mục P4.5-r1 và cho phép mở kế hoạch chi tiết P4.6 để duyệt trước coding.”** P45-01–05 HUMAN_ACCEPTED đủ5/5 local/synthetic; [task/checklist](tasks/CHURCH-P4.5.md), [evaluation](engineering/skill-usage/records/CHURCH-P4/P4.5-human-acceptance-1.json). Chỉ mở khảo sát/kế hoạch chi tiết P4.6 Tổng hợp/kiểm chứng trong chat để duyệt trước coding; chưa chốt C46/ASCII/contracts hoặc implementation, P4 chưa đóng/P5 chưa mở. Không chạy lại tests/runtime; giữ9technical artifacts/journals P4.5 nguyênSHA256 và source313/dist56 khớp manifest. Giữ P3.4UNKNOWN/physical/NOT_RUN và giới hạn main-maintenance/workload/restore; không publication/deploy/real data/main DB read/init/restart3443/worktree/delegation. Live state chỉ project-state.


## P4.6 implementation được duyệt — 2026-11-14

Khiêm: **“Duyệt P4.6-plan-r1, C46-01–03 và ASCII, cho phép triển khai trọn P46-01–05 local/synthetic, bàn giao rồi dừng trước đóng P4 hoặc mở P5. Chưa commit/push/deploy hoặc dùng dữ liệu thật.”** [Task/contracts/checklist](tasks/CHURCH-P4.6.md). Triển khai trọn P46-01–05 local/synthetic rồi bàn giao, dừng trước đóng P4/mở P5; giữ snapshots/UNKNOWN/NOT_RUN và publication/data boundaries.


## Bàn giao P4.6-r1 — 2026-11-14

[Task/năm mục/evidence](tasks/CHURCH-P4.6.md). P46-01–05/C46-01–03/ASCII hoàn tất nguồn và PASS local/synthetic; 384tests/5517assertions/0FAIL;144browser tổng hợp+2601regressionchecks=2745;9configs/480distinct terminaljourneys/6877requests/769retryresponses;18list-count+5historyplans=23;restore50collections exact trước transformations;cleanup/readback0. Chờ Khiêm nghiệm thu, dừng trước đóng P4/mở P5; P4.1–P4.5 HUMAN_ACCEPTED. Không publication/deploy/realdata/mainread/init/restart3443/worktree/delegation. Giữ78prior artifacts/journals, P3.4race/P42fastfillUNKNOWN/physical/NOT_RUN và localrestore/workloadlimits; live state chỉ project-state.


## Nghiệm thu P4.6-r1 và đóng P4 — 2026-11-15

Khiêm: **“nghiệm thu năm mục P4.6-r1, đóng P4.”** [Biên bản closure](tasks/CHURCH-P4.md#đóng-p4) liên kết đủ sáu package HUMAN_ACCEPTED. P4 CLOSED local/synthetic; P5 chưa mở. Giữ nguyên technical snapshots/journals, không chạy lại tests/runtime hoặc publication/deploy/real data/main operations; UNKNOWN/NOT_RUN và giới hạn local workload/recovery giữ nguyên. Live state chỉ project-state.


## P5-plan-r1 — duyệt danh mục, mở planning P5.1 — 2026-11-16

Khiêm: **“Duyệt P5-plan-r1. Mở kế hoạch chi tiết P5.1 để chốt quyền, cấu hình quỹ và ASCII trước coding.”** Danh mục được duyệt: **P5.1 Quỹ và quyền tài chính → P5.2 Thu và dâng hiến → P5.3 Đề xuất và phê duyệt chi → P5.4 Phiếu chi và sổ thu chi → P5.5 Khóa sổ và điều chỉnh → P5.6 Tổng hợp và kiểm chứng tài chính**. [Kết quả/phụ thuộc/checklist/điểm dừng](tasks/CHURCH-P5.md). Mỗi gói cần kế hoạch chi tiết được duyệt, hoàn chỉnh code/wiring trước tests và dừng nghiệm thu/quyền mở gói sau. Chỉ P5.1 PLANNING_ONLY trong chat; mapping quyền, quy tắc quỹ và ASCII chi tiết chưa được duyệt. Không lưu draft P5.1 như quyết định đã chốt; không source/schema/tests/runtime P5 mới. Chưa publication/real data/main operations; giữ prior evidence/UNKNOWN/NOT_RUN. Live state duy nhất tại project-state.


## P5.1-plan-r1 — implementation được duyệt — 2026-11-16

Khiêm duyệt P5.1-plan-r1/C51-01–03/ASCII và trọn P51-01–05 local/synthetic; [task/checklist](tasks/CHURCH-P5.1.md). Finance riêng khỏi Organization, pastor quản lý/treasurer chỉ xem; quỹ lifecycle/unique/CAS/history, settings explicit, W12/W13/callers/pending, tests/qualification/contracts/evidence. Hoàn chỉnh code/wiring trước tests; một handoff rồi dừng trước P5.2. Không publication/real data/main DB read/init/restart3443/worktree/delegation; prior snapshots/UNKNOWN/NOT_RUN giữ nguyên. Live state chỉ project-state; các mục planning-only phía trên là chronology trước approval này.


## P5.1-r1 — kết quả bàn giao có thiếu sót evidence — 2026-11-16

[P51-01–04](tasks/CHURCH-P5.1.md) source complete/local verified theo C51-01–03/ASCII.398tests/5884assertions,649browserchecks,12plans/9configs/255samples; static/build/UI/auditPASS. P51-05 **INCOMPLETE**: mất original accepted P4.6history-plans do legacy test output; chưa recoverybytes,565/566protectedfilesunchanged. [Verification](../output/p5.1/verification.json), [incident](../output/p5.1/evidence-integrity-incident.json), self-reviewFAIL. Test output isolation repaired và affected4tests/80assertionsPASS, không thay bằng chứng cũ. Chờ bản sao gốc khớp hash và Khiêm xem xét; không đóng P5.1/mở P5.2, no release/mainmaintenance. Live state chỉ project-state.


## P5.1-r2 — E51-01 được miễn trừ theo Khiêm — 2026-11-16

Khiêm xác nhận không có backup và cho phép bỏ qua issue nếu không tìm thấy, không troubleshoot tiếp. Tìm kiếm cục bộ chưa có bản đúng hash; E51-01 USER_WAIVED, P51-05 hoàn tất với ngoại lệ, không recovered/preservationPASS. [Task/checklist r2](tasks/CHURCH-P5.1.md), [receipt r2](../output/p5.1/verification-r2.json), [disposition](../output/p5.1/evidence-integrity-disposition-r2.json). Giữ history r1 FAIL/incident và evidence nguồn/runtime; không chạy lại tests/runtime hoặc sửa ứng dụng. Chờ Khiêm nghiệm thu toàn P5.1; P5.2 chưa mở. Live state duy nhất ở project-state.


## Nghiệm thu P5.1-r2, mở planning P5.2 — 2026-11-16

Theo Khiêm, P51-01–05 HUMAN_ACCEPTED đủ5/5 local/synthetic với E51-01 USER_WAIVED. [Task/checklist/evaluation](tasks/CHURCH-P5.1.md). Chỉ mở khảo sát và trình kế hoạch chi tiết P5.2 Thu và dâng hiến trong chat trước coding; quy tắc C52/ASCII/contracts chưa được duyệt, không lưu draft hoặc tạo application/schema/tests mới. P5.3–P5.6 chưa mở. Giữ source/dist và receipts/journals/incident/waiver; không chạy lại runtime/tests hoặc troubleshoot E51-01/publication/main operations. Live state ở project-state.

## Nghiệm thu P5.5-r2; mở planning P5.6 — 2026-11-18

Khiêm: **“nghiệm thu. mở P5.6”**. P5.5-r2 P55-01–05/UI55-01–04 HUMAN_ACCEPTED local/synthetic, đủ năm mục checklist; [task/acceptance](tasks/CHURCH-P5.5.md). Giữ E51-01 USER_WAIVED, E55-01 OPEN_NOT_WAIVED/audit FAIL, UI-POSTP8-01 AFTER_P8. Technical snapshots/manifest/journals r1/r2 không rewrite; source/dependencies/dist không đổi và không chạy lại tests/runtime.

P5.6 Tổng hợp và kiểm chứng tài chính chỉ **PLANNING_ONLY trong chat**: trình C56/quyền/công thức/restore/ASCII trước coding. Chưa duyệt contracts/schema/API/UI/implementation hoặc tạo task/contract/planning journal P5.6. P5 chưa đóng/P6 chưa mở; không publication/realdata/main operations/worktree/delegation. Physical/Safari/UAT/mainruntime/production/independent review và prior UNKNOWN giữ nguyên. Trạng thái hiện hành duy nhất ở project-state; phần dưới giữ chronology.
