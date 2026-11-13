# CHURCH-P3 — roadmap P3-plan-r1

Quyết định chốt ngày2026-11-13: **P3 CLOSED**, P3.1–P3.6 HUMAN_ACCEPTED local/synthetic; **P4 NOT_OPENED**, chưa released. [Biên bản đóng P3](#đóng-p3). Các mục trước biên bản đóng giữ lịch sử từng gói.

## Phê duyệt danh mục — 2026-11-12

Khiêm: **“Duyệt P3-plan-r1. Mở kế hoạch chi tiết P3.1 để duyệt trước coding.”**

Kiểu bàn giao: Theo roadmap Church CMS P0–P8/P3. Mỗi gói hoàn thiện dữ liệu/API/quyền/UI và real wiring trước khi viết/cập nhật tests, chạy checks/review và bàn giao. Dừng sau mỗi gói, chỉ tiếp tục khi Khiêm nghiệm thu và cho mở gói sau. Danh mục không tự cấp quyền coding hoặc publication/deploy/dữ liệu thật.

| Gói | Kết quả được duyệt trong danh mục | Phụ thuộc |
|---|---|---|
| P3.1 — Buổi nhóm và điểm danh tay | W05; tạo buổi, danh sách dự kiến có lịch sử, ghi/bỏ hiện diện, chốt/sửa có quyền và audit, Làm lại có xác nhận/chống mất ghi đồng thời | P2 đã nghiệm thu |
| P3.2 — Thẻ tín hữu và quét QR | W05/W14; cấp/đổi/thu hồi mã không chứa PII, người quét có quyền, ghi qua cùng nghiệp vụ P3.1; camera thật là bằng chứng riêng | P3.1 |
| P3.3 — Lớp dự bị Báp-têm | W06; khóa/ghi danh/buổi học/học bù/phỏng vấn, dùng Attendance; không tự ghi danh từ conversion hoặc tự áp ngưỡng demo | P3.1; bàn giao sau P3.2 |
| P3.4 — Sổ lễ nghi | Năm tab W06 còn lại và W14; thống nhất Báp-têm với hồ sơ/import, snapshot/history, không tự suy cha mẹ/gộp hộ/trạng thái qua đời hoặc số dự Tiệc Thánh | P3.3 và các public contracts P2 |
| P3.5 — Chứng nhận và bản in | GCN Báp-têm, GCN Dâng con, Chứng thư Thành hôn, Đơn xin chịu Báp-têm; preview/Word/PDF/versioned snapshot; mẫu thật chưa xác nhận | P3.3–P3.4 |
| P3.6 — Tổng hợp và kiểm chứng P3 | W01/W02/W14/W04; số liệu có định nghĩa từ dữ liệu thật trong scope, workflow/concurrency/revoke/qualification/restore | P3.1–P3.5 |

Thứ tự bàn giao: **P3.1 → P3.2 → P3.3 → P3.4 → P3.5 → P3.6**. Từng gói có kế hoạch contracts/acceptance/ASCII UI được duyệt trước coding; thay đổi vật chất về danh mục/phạm vi cần duyệt lại. Không tách gói theo UI/API/database hoặc tạo điểm dừng theo file.

## Mở planning P3.1

Chỉ dẫn trên mở investigation và kế hoạch chi tiết P3.1 để duyệt trước coding. Dự thảo chưa duyệt giữ trong chat; chưa tạo đặc tả kỹ thuật P3.1 đã chốt. Không mở QR/camera, lớp/lễ nghi, chứng nhận, tổng hợp P3.6, account binding/self portal, offline sync hoặc lịch lặp P4 trong gói P3.1.

## Nguồn và giới hạn

- Danh mục được duyệt từ P3-plan-r1 trong chat hiện hành; [roadmap cha](../project-plan.md), [P0/W05–W17](CHURCH-P0.md), [UI-STD-r1](../ui-system.md).
- P2 đã human accepted local/synthetic, không phải bằng chứng runtime P3. Camera thật, mẫu giấy thật, quy mô/SLA và production chưa được xác nhận.
- Ranh giới dự kiến local/synthetic; không init main DB/restart dịch vụ hoặc tự commit/push/deploy. Bàn giao P3.6 không tự đóng P3/mở P4.
- [Ghi nhận phê duyệt](../engineering/skill-usage/records/CHURCH-P3/P3-plan-human-approval-1.json). Trạng thái hiện hành duy nhất: [project-state](../project-state.md).

## Quyền implementation P3.1 — 2026-11-12

Khiêm duyệt P3.1-plan-r1 cùng ba lựa chọn, trọn P31-01–05 local/synthetic; bàn giao nghiệm thu rồi dừng trước P3.2. [Task/authority](CHURCH-P3.1.md). Chưa commit/push/deploy/dữ liệu thật; không mở P3.2–P3.6. Bản planning-only phía trên giữ chronology trước approval này.

## Bàn giao P3.1-r1

[Task/checklist](CHURCH-P3.1.md): P31-01–05 source complete/local-synthetic verified, chờ Khiêm nghiệm thu. Không mở P3.2/publication/deploy/dữ liệu thật; technical evidence không thay human acceptance. Các gói tiếp theo giữ thứ tự đã duyệt; live status chỉ tại project-state.

## Nghiệm thu P3.1-r1 và mở planning P3.2 — 2026-11-13

Khiêm: **“Nghiệm thu P3.1-r1, mở P3.2”**. P31-01–05/P3.1-r1 HUMAN ACCEPTED local/synthetic; [biên bản](CHURCH-P3.1.md#human-review1--accepted-mở-planning-p32--2026-11-13), [evaluation](../engineering/skill-usage/records/CHURCH-P3/P3.1-human-acceptance-1.json). Snapshot technical evidence/implementation journal giữ nguyên, không chạy lại tests.

P3.2 Thẻ tín hữu và quét QR mở **PLANNING_ONLY**; đối chiếu W05/W14/nguồn HTML, Attendance/Members/Authorization/Operations và giới hạn camera/TLS. Trình P3.2-plan-r1 trong chat, chờ duyệt trước coding; chưa lưu dự thảo technical spec/phase planning journal. Không mở P3.3 hoặc commit/push/deploy/dữ liệu thật/init main DB/restart dịch vụ. Live status chỉ tại project-state.

<a id="p3-physical-verification-note"></a>

## Ghi chú cần nhắc — camera thật và bản in giấy (P3-PHYSICAL-01)

Nguồn: yêu cầu Khiêm ngày2026-11-13: **“Ghi lại giới hạn Camera thật và bản in giấy vào note để agent có thể nhắc tôi sau này/tránh quên.”** Đây là ghi chú giới hạn kiểm chứng và yêu cầu nhắc theo ngữ cảnh, không là phê duyệt P3.2-plan-r1/coding hoặc quyền mở gói mới.

- **Camera điện thoại thật: NOT_RUN.** Cần kiểm trên thiết bị/trình duyệt đích được chọn, qua HTTPS được thiết bị tin cậy: cấp/từ chối quyền, camera trước/sau nếu có, lấy nét/quét QR thực tế, dừng camera khi đóng/chuyển nền/reauth và đối soát sau mất mạng. Android/Chrome và iPhone/Safari là đề xuất trong planning P3.2, chưa là ma trận đã duyệt.
- **Bản in giấy thật: NOT_RUN.** Cần in thẻ/tài liệu thuộc phạm vi đã được duyệt bằng máy in/giấy thật, kiểm kích thước/lề/chữ tiếng Việt/độ rõ QR và thử quét QR trên bản giấy nếu có QR. Ảnh màn hình, print preview hoặc file PDF không chứng minh bản giấy đã đạt.
- Agent **chủ động nhắc Khiêm** khi bắt đầu/tiếp tục hoặc bàn giao/nghiệm thu P3.2; rà lại khi lập kế hoạch/bàn giao P3.5/P3.6 và trước UAT/pilot/phát hành. Nếu chưa có thiết bị/máy in/HTTPS tin cậy hoặc chưa có kết quả, giữ nguyên NOT_RUN và nêu điều kiện còn thiếu.
- Không dùng source/build/browser automation/camera mô phỏng/QR decode ảnh để thay bằng chứng vật lý. Nghiệm thu local/synthetic không tự đóng hai mục này.
- Chỉ đánh dấu từng mục đã kiểm chứng sau khi có bằng chứng thực tế và Khiêm xác nhận kết quả; ghi ngày, thiết bị/trình duyệt hoặc máy in/giấy, môi trường/phiên bản và kết quả trong task/evidence liên quan. Không tự suy PASS hoặc khẳng định production-ready.

Theo dõi hiện hành chỉ tại [project-state](../project-state.md); ghi chú này giữ yêu cầu nhắc và điều kiện kiểm chứng, không tạo tracker cạnh tranh.

## P3.2-plan-r1 — implementation được duyệt — 2026-11-13

Khiêm: **“duyệt P3.2-plan-r1”**. Cho triển khai trọn P32-01–05 local/synthetic theo kế hoạch/ASCII đã trình, bàn giao nghiệm thu rồi dừng trước P3.3. [Task](CHURCH-P3.2.md). Chưa commit/push/deploy/dữ liệu thật/init main DB/restart dịch vụ. P3-PHYSICAL-01 giữ NOT_RUN cho camera điện thoại/bản giấy; không suy qualification vật lý từ synthetic. Chỉ dẫn này thay giới hạn P3.2 planning-only phía trên.

## Bàn giao P3.2-r1 — chờ nghiệm thu

P32-01–05 source complete/local-synthetic verified; [task/checklist](CHURCH-P3.2.md), [contracts](../engineering/P3.2-cards-qr.md), [receipt](../../output/p3.2/verification.json). Chờ Khiêm nghiệm thu, dừng trước P3.3; chưa mở planning/coding P3.3. P3-PHYSICAL-01 giữ NOT_RUN; không tự đóng qua canvas/print CSS. Không commit/push/deploy/real data/main DB init/restart. Live status chỉ tại project-state.

## Nghiệm thu P3.2-r1 và mở planning P3.3 — 2026-11-13

Khiêm: **“nghiệm thu P3.2-r1 theo checklist; đồng ý mở planning P3.3”**. P32-01–05 HUMAN ACCEPTED local/synthetic; [biên bản](CHURCH-P3.2.md#human-review1--accepted-mở-planning-p33--2026-11-13), [evaluation](../engineering/skill-usage/records/CHURCH-P3/P3.2-human-acceptance-1.json). Giữ technical snapshots, không chạy lại runtime/tests để ghi nghiệm thu.

P3.3 Lớp dự bị Báp-têm mở **PLANNING_ONLY**, đối chiếu W06/source HTML và public Attendance/Members contracts; kế hoạch chi tiết/ASCII chỉ trình trong chat, chưa lưu draft thành thiết kế đã duyệt. Chưa implementation P3.3 hoặc mở P3.4–P3.6/publication/deploy/dữ liệu thật/init main DB/restart. P3-PHYSICAL-01 vẫn NOT_RUN cho điện thoại/bản giấy; human acceptance không tự đóng hai mục này. Live status chỉ tại project-state.

## P3.3-plan-r1 — implementation được duyệt — 2026-11-13

Khiêm duyệt P3.3-plan-r1/C33-01–03 và trọn P33-01–05 local/synthetic. [Task/authority](CHURCH-P3.3.md). Bàn giao rồi dừng trước P3.4; không commit/push/deploy/real data/main DB init/restart. Giới hạn planning-only phía trên giữ chronology trước chỉ dẫn mới.

## Bàn giao P3.3-r1 — chờ nghiệm thu

P33-01–05/C33-01–03 source complete/local-synthetic verified; [task/checklist](CHURCH-P3.3.md), [contracts](../engineering/P3.3-prep-classes.md), [receipt](../../output/p3.3/verification.json). Chờ Khiêm nghiệm thu P3.3-r1, dừng trước planning/coding P3.4. P3-PHYSICAL-01 giữ NOT_RUN; chưa commit/push/deploy/real data/main DB init/restart. Live state chỉ tại project-state.

## Nghiệm thu P3.3-r1 và mở planning P3.4 — 2026-11-13

Khiêm: **“Nghiệm thu P3.3-r1 theo checklist; đồng ý mở planning P3.4 để duyệt trước coding.”** P33-01–05/C33-01–03 HUMAN ACCEPTED theo toàn bộ checklist local/synthetic. [Task/checklist](CHURCH-P3.3.md), [evaluation](../engineering/skill-usage/records/CHURCH-P3/P3.3-human-acceptance-1.json). Giữ nguyên technical receipts/source manifest và original/correction journal; không chạy lại runtime/checks trong lần ghi nhận.

P3.4 mở **PLANNING_ONLY**: năm tab W06 còn lại và W14, thống nhất Báp-têm với hồ sơ/import; kế hoạch chi tiết/ASCII chỉ trình trong chat, chưa lưu thành thiết kế đã duyệt, chưa coding. P3.5/P3.6 chưa mở. P3-PHYSICAL-01 vẫn NOT_RUN; không commit/push/deploy/real data/main DB init/restart. Live status duy nhất tại project-state.

## P3.4-plan-r1 — implementation được duyệt 2026-11-13

Khiêm duyệt C34-01–03/ASCII và trọn P34-01–05 local/synthetic; [authority và phạm vi](CHURCH-P3.4.md). Code/wiring trước tests, một lần bàn giao rồi dừng trước P3.5. Không commit/push/deploy/real data/main DB init/restart. Physical NOT_RUN giữ nguyên; các planning-only phía trên là lịch sử trước approval này.

## Bàn giao P3.4-r1 — chờ nghiệm thu

P34-01–05/C34-01–03/ASCII source complete/local-synthetic verified; [task/checklist](CHURCH-P3.4.md), [contracts](../engineering/P3.4-rites.md), [receipt](../../output/p3.4/verification.json). Chờ Khiêm nghiệm thu P3.4-r1; dừng trước P3.5/P3.6. Camera điện thoại/bản giấy P3-PHYSICAL-01 giữ NOT_RUN. Không commit/push/deploy/real data/main DB init/restart3443. Live state chỉ tại project-state; technical snapshots và human acceptance P3.1–P3.3 không đổi.

## Nghiệm thu P3.4-r1 và mở planning P3.5 — 2026-11-13

Khiêm: **“Nghiệm thu P3.4-r1 theo 5 mục trong checklist. Mở P3.5.”** P34-01–05 HUMAN ACCEPTED đủ năm mục checklist local/synthetic. [Task/checklist](CHURCH-P3.4.md), [evaluation](../engineering/skill-usage/records/CHURCH-P3/P3.4-human-acceptance-1.json). Technical receipts/source manifest/implementation journal giữ nguyên; không chạy lại runtime/checks trong lần ghi nhận.

P3.5 mở **PLANNING_ONLY** cho bốn mẫu đã nằm trong roadmap: GCN Báp-têm, GCN Dâng con, Chứng thư Thành hôn, Đơn xin chịu Báp-têm; kế hoạch/ASCII giữ trong chat để duyệt trước coding. Mẫu thật chưa xác nhận, không mặc định mẫu demo thành mẫu chính thức. Chưa implementation P3.5; P3.6 chưa mở. Physical camera/paper P3-PHYSICAL-01 giữ NOT_RUN. Không commit/push/deploy/real data/main DB init/restart. Live state chỉ tại project-state.

## P3.5-plan-r1 — implementation được duyệt 2026-11-13

Khiêm duyệt C35-01–03/ASCII và trọn P35-01–05 local/synthetic; [authority/checklist](CHURCH-P3.5.md). Code/wiring trước tests, một lần bàn giao rồi dừng trước P3.6. Không commit/push/deploy/real data/main DB init/restart. Physical NOT_RUN giữ nguyên; planning-only phía trên là chronology trước approval.

## P3.5-r1 — bàn giao local/synthetic 2026-11-13

P35-01–05/C35-01–03/ASCII SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; [task/checklist](CHURCH-P3.5.md), [contracts](../engineering/P3.5-certificates.md), [receipt](../../output/p3.5/verification.json). Chờ Khiêm nghiệm thu năm mục, chưa released. Dừng trước P3.6/planning/coding; không commit/push/deploy/real data/main DB init/restart3443. Camera/giấy thật P3-PHYSICAL-01 vẫn NOT_RUN, nhắc tại nghiệm thu P3.5/P3.6 và trước UAT/pilot/release; native Word cũng chưa chứng minh. Giữ technical receipts và acceptance P3.1–P3.4, live state chỉ tại project-state.

## Nghiệm thu P3.5-r1 và mở planning P3.6 — 2026-11-13

Khiêm: **“Nghiệm thu P3.5-r1 theo năm mục trên; mở P3.6.”** P35-01–05/P3.5-r1 HUMAN ACCEPTED đủ năm mục local/synthetic; [task/checklist](CHURCH-P3.5.md), [evaluation](../engineering/skill-usage/records/CHURCH-P3/P3.5-human-acceptance-1.json). Giữ nguyên technical receipt/source manifest/implementation journal/verification completion; không chạy lại tests để ghi nghiệm thu.

P3.6 Tổng hợp và kiểm chứng mở **PLANNING_ONLY**, đối chiếu W01/W02/W14/W04, public read ports và workflow/qualification/restore xuyên P3. Trình kế hoạch/định nghĩa/contracts/ASCII trong chat để duyệt trước coding; không lưu draft như quyết định đã duyệt. P3 chưa đóng/P4 chưa mở; không commit/push/deploy/real data/main DB init/restart3443. P3-PHYSICAL-01 Camera thật/giấy thật và native Word NOT_RUN giữ nguyên; nhắc tại planning/bàn giao/nghiệm thu P3.6 và trước UAT/pilot/release. Live status chỉ tại project-state.

## P3.6-plan-r1 — implementation được duyệt 2026-11-13

Khiêm duyệt C36-01–03/ASCII và P36-01–05 local/synthetic; [task/authority](CHURCH-P3.6.md). Code/wiring trước tests, bàn giao rồi dừng; chưa đóng P3/mở P4, chưa publication/deploy/real data/main DB init/restart3443. Physical/native Word NOT_RUN giữ nguyên.


## Bàn giao P3.6-r1 — 2026-11-13

P36-01–05/C36-01–03/ASCII source complete/local-synthetic verified; [task/năm mục nghiệm thu](CHURCH-P3.6.md), [contracts](../engineering/P3.6-reporting.md), [receipt](../../output/p3.6/verification.json). Chờ Khiêm nghiệm thu; chưa đóng P3/mở P4, chưa commit/push/deploy/real data/main DB init/restart3443. P3-PHYSICAL-01 Camera/giấy thật và native Word NOT_RUN giữ nguyên, không suy từ kiểm thử browser/PDF/synthetic. Live state duy nhất tại project-state; historical technical receipts và acceptance P3.1–P3.5 không đổi.


## Nghiệm thu P3.6-r1 và tiếp tục dừng — 2026-11-13

Khiêm: **“Anh nghiệm thu P3.6-r1 theo năm mục; ghi nhận acceptance rồi tiếp tục dừng trước đóng P3, chưa mở P4.”** P36-01–05/P3.6-r1 HUMAN_ACCEPTED đủ5/5mục local/synthetic; [task/checklist](CHURCH-P3.6.md), [evaluation](../engineering/skill-usage/records/CHURCH-P3/P3.6-human-acceptance-1.json). Các gói P3.1–P3.6 đã được nghiệm thu trong phạm vi local/synthetic, nhưng **P3 chưa đóng/P4 chưa mở/chưa released**. Chưa commit/push/deploy/real data/main DB init/restart3443. Camera thật/giấy thật P3-PHYSICAL-01, native Word và các giới hạn NOT_RUN giữ nguyên; nhắc lại trước UAT/pilot/release. Giữ nguyên technical snapshots/implementation journals, không chạy lại tests/runtime để ghi acceptance; live state chỉ project-state.


## Đóng P3

Khiêm: **“Đóng P3. chưa mở P4. sau đó báo [Lập kế hoạch gói implementation P4](codex://threads/01a1d590-89c6-7681-8f5c-6d9e6ceb9bbf) biết rằng P3 đã đóng.”** (2026-11-13).

- **P3 CLOSED** trong phạm vi local/synthetic đã nghiệm thu: P3.1-r1 Buổi nhóm/điểm danh tay; P3.2-r1 Thẻ/QR; P3.3-r1 Lớp dự bị; P3.4-r1 Sổ lễ nghi; P3.5-r1 Chứng nhận/bản in; P3.6-r1 Tổng hợp/kiểm chứng.
- [Closure evaluation](../engineering/skill-usage/records/CHURCH-P3/P3-closure-1.json) liên kết roadmap và đủ sáu acceptance. Giữ nguyên implementation journals, receipts, source manifest và số đo tại bàn giao; không chạy lại tests/runtime hoặc tính lại usage implementation.
- **P4 NOT_OPENED.** Được phép gửi thông báo closure đến chat [Lập kế hoạch gói implementation P4](codex://threads/01a1d590-89c6-7681-8f5c-6d9e6ceb9bbf). Thông báo không duyệt P4-plan-r1, không mở planning chi tiết hoặc coding P4.
- P3-PHYSICAL-01 Camera điện thoại/bản in giấy thật, native Word và các giới hạn NOT_RUN giữ nguyên. Nhắc trước UAT/pilot/release; chỉ đóng kiểm chứng vật lý khi có bằng chứng thực tế và Khiêm xác nhận. p95 local W04~8.83s ở2000/10 vẫn là giới hạn đo được, không SLA.
- Chưa released/commit/push/deploy/real data/main DB init/restart3443. Live state duy nhất tại project-state. Các chỉ dẫn “P3 chưa đóng” trong lịch sử trước phần này đã được chỉ dẫn đóng P3 mới thay thế.

Thông báo closure đã gửi bằng công cụ Codex tới chat [Lập kế hoạch gói implementation P4](codex://threads/01a1d590-89c6-7681-8f5c-6d9e6ceb9bbf) sau khi ghi hồ sơ đóng P3 (2026-11-13T16:03:54.749498+00:00). Nội dung xác nhận P3 CLOSED, P4 NOT_OPENED và P4-plan-r1 chưa được duyệt; không yêu cầu coding hoặc chỉnh file ở chat đích.
