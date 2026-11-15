# Hiện trạng Church CMS

Cập nhật ngày 2026-11-15: **P1/P2/P3/P4 CLOSED; P4.1–P4.6 HUMAN_ACCEPTED đủ5/5 mỗi gói; P5 NOT_OPENED; chưa released.** Trạng thái hiện hành duy nhất; các mục phía dưới giữ chronology.


## P4 — đã đóng theo chỉ dẫn Khiêm 2026-11-15

Khiêm: **“nghiệm thu năm mục P4.6-r1, đóng P4.”** P4.6-r1 đã HUMAN_ACCEPTED đủ năm mục; **P4 CLOSED local/synthetic, P5 NOT_OPENED**. [Task/checklist P4.6](tasks/CHURCH-P4.6.md), [biên bản đóng P4](tasks/CHURCH-P4.md#đóng-p4), [acceptance evaluation](engineering/skill-usage/records/CHURCH-P4/P4.6-human-acceptance-1.json), [closure evaluation](engineering/skill-usage/records/CHURCH-P4/P4-closure-1.json) liên kết đủ sáu gói P4.1–P4.6.

Không chạy lại tests/runtime; giữ snapshot bàn giao 384 tests/5.517 assertions,2.745 browser checks,9configs/480journeys/23plans,restore50collections/readback0. Technical receipts/source manifests/implementation/self-review journals và bằng chứng cũ giữ nguyên hash; acceptance/closure bổ sung lịch sử, không rewrite trạng thái pending trong snapshot gốc.

Giữ P3.4 race/P4.2 fast-fill exact cause UNKNOWN; keyboard PASS không chứng minh fast-fill/paste đã sửa. Giữ giới hạn P4preview digest/receipt/recovery cut line/quiesce0inflight và postrestore handler in-process. Physical/native Word/Safari/UAT/main runtime/pilot/remoteCI/production/multi-replica/independent review NOT_RUN; main schemas/index/Policy18 chưa áp. Local workload/restore không production SLA/capacity/RPO/RTO/PITR. Chưa commit/push/deploy/real data/main DB read/init/restart3443. Không mở P5 hoặc gửi thông báo chat khác. Các mục sau là chronology.


## P4.6-r1 — bàn giao, chờ nghiệm thu

P46-01–05/C46-01–03/ASCII hoàn tất và PASS local/synthetic. **Chờ Khiêm nghiệm thu năm mục; dừng trước đóng P4/mở P5.** [Task/checklist](tasks/CHURCH-P4.6.md), [runbook](engineering/P4.6-qualification.md), [verification](../output/p4.6/verification.json). 384tests/5517assertions/0FAIL;144browser tổng hợp+2601regressionchecks=2745;9configs/480distinct terminaljourneys/6877requests/769retryresponses;18list-count+5historyplans=23;restore50collections exact trước transformations;cleanup/readback0. Snapshot50collections khớp trước revoke12sessions/purge1preview/rotatekey;oldcookies401/cursor400/QRproof409/certificatepreview412.81creates/78links,162program/159visit/159prayer. Static/build/UI/audit/diff/shellPASS;10existingCSSwarnings/bundle615.15kB advisory.78prior artifacts/journals và API/web/dependencies/dist56hashes giữ nguyên; source add6runners/tests + package/wrapper/P42harness.5skills journal sum100%; self-review không independentreview/humanacceptance/release.

Giữ P3.4priorraceUNKNOWN và P42postreauthfastfill exactcauseUNKNOWN; keyboardPASS không claim fastfill/pastefixed. Quiesce observed0inflight, chưa held-requeststress. P4previewdigest không tự invalidated khi rotatekey; bỏpendingcũ/freshauthorizedreceipt trướcpreview/confirm. Source/workloadHTTPS; postrestoreHTTPhandler in-process/realMongoRedis. Physical/nativeWord/Safari/UAT/mainruntime/pilot/remoteCI/production/multi-replica/independentreviewNOT_RUN, không SLA/capacity/RPO/RTO/PITR. Main schemas/index/Policy18 chưa áp; không publication/deploy/realdata/mainread/init/restart3443/worktree/delegation. Các mục sau là chronology.


## P4.6 — đang triển khai theo approval

Khiêm duyệt P4.6-plan-r1/C46-01–03/ASCII và trọn P46-01–05 local/synthetic. [Task/checklist](tasks/CHURCH-P4.6.md). Hoàn thiện code/wiring trước tests, một handoff; dừng trước đóng P4/mở P5. Không publication/deploy/real data/main DB read/init/restart3443/worktree/delegation; giữ prior evidence/P3.4UNKNOWN/physical/NOT_RUN. Các mục sau là chronology.


## Nghiệm thu P4.5-r1, mở planning P4.6

Khiêm: **“nghiệm thu năm mục P4.5-r1 và cho phép mở kế hoạch chi tiết P4.6 để duyệt trước coding.”** [Task/checklist](tasks/CHURCH-P4.5.md), [evaluation](engineering/skill-usage/records/CHURCH-P4/P4.5-human-acceptance-1.json). P45-01–05 HUMAN_ACCEPTED đủ5/5 local/synthetic. Giữ nguyên snapshot380tests/5437assertions,702browser+2996regressionchecks;9configs/480journeys/3210requests/270retries;12plans/cleanup0. Không chạy lại tests/runtime;9technical artifacts/journals P4.5 nguyênSHA256 và source313/dist56 khớp manifest bàn giao. Acceptance bổ sung lịch sử, không rewrite technical snapshots.

P4.6 Tổng hợp/kiểm chứng chỉ khảo sát/kế hoạch chi tiết trong chat; C46/workflow/recovery/workload/ASCII và coding chưa duyệt. P4 chưa đóng/P5 chưa mở. Không publication/deploy/realdata/main DB read/init/restart3443/worktree/delegation. Main schemas/index/Policy18 chưa áp; P3.4 prior race UNKNOWN và physical/native Word/Safari/UAT/main runtime/pilot/remoteCI/production/multi-replica/independent review NOT_RUN giữ nguyên. Aggregate restore P4.6 chưa chạy; workload không SLA/capacity/RPO/RTO. Các mục sau là chronology.


## P4.5-r1 — bàn giao, chờ nghiệm thu

P45-01–05/C45-01–03/ASCII hoàn tất nguồn/wiring trước tests và PASS local/synthetic; **chờ Khiêm nghiệm thu đủ5mục, dừng trước P4.6**. [Task/checklist](tasks/CHURCH-P4.5.md), [contracts/runbook](engineering/P4.5-care.md), [verification](../output/p4.5/verification.json).380tests/5437assertions/0FAIL;702W08Firefoxchecks+2996regressionchecks;9configs/480journeys/3210requests/270retries, p95~57–2136ms/max4629ms;12plans/cleanup0. Workload255creates/63links/162dismissals. Static/build/UI/audit/diffPASS,10existingCSSwarnings/bundle615.15kB advisory. Cleanup0,9P44technical artifacts/journals giữ nguyên SHA256. Journal implementation/self-review đã lưu; self-review không independent review hoặc human acceptance.

P4.1 Lịch giảng/sinh hoạt, P4.2 Chương trình ban, P4.3 Hồ sơ thăm viếng, P4.4 Cầu thay/quyền riêng tư đã HUMAN_ACCEPTED. P4.5 Cảnh báo/chăm sóc tự động chờ nghiệm thu; P4.6 Tổng hợp/kiểm chứng NOT_OPENED. Không commit/push/deploy/realdata/main DB read/init/restart3443/worktree/delegation. Main schema/index/Policy18 chưa áp; refresh theo yêu cầu, cachedasOf/partial, không global snapshot/job nền/Prayer inputs/autoselectassignee/external send/auto visited. P3.4 prior race causeUNKNOWN và physical/native Word/Safari/UAT/main runtime/pilot/remoteCI/production/multi-replica/independent reviewNOT_RUN giữ nguyên; aggregate restore P4.6 chưa mở, không SLA/capacity/RPO/RTO. Các mục sau là chronology.

## Nghiệm thu P4.4-r1, mở planning P4.5

Khiêm: **“nghiệm thu P4.4-r1 và cho phép mở kế hoạch chi tiết P4.5 để duyệt trước coding.”** [Task/checklist](tasks/CHURCH-P4.4.md), [evaluation](engineering/skill-usage/records/CHURCH-P4/P4.4-human-acceptance-1.json). P44-01–05 HUMAN_ACCEPTED đủ5/5 local/synthetic. Giữ nguyên snapshot354tests/5133assertions,707browser+2289regressionchecks;9configs/480journeys/2646requests/82retries, p95~39–796ms/max2832ms;12plans/cleanup0. Không chạy lại tests/runtime;9technical artifacts/journals P4.4 nguyênSHA256. P3.4 prior race cause UNKNOWN giữ nguyên, không xóa bằng acceptance.

Chỉ mở khảo sát/kế hoạch chi tiết P4.5 trong chat để duyệt trước coding; chưa chốt C45/nguồn/quyền/trạng thái/contracts/ASCII, không application code/schema/tests/runtime mới hoặc lưu thiết kế chưa duyệt thành quyết định. P4.6 NOT_OPENED. Không commit/push/deploy/real data/main DB read/init/restart3443/worktree/delegation. Giữ main schemas/index/audit audience chưa áp; physical/native Word/Safari/UAT/main runtime/pilot/remoteCI/production/multi-replica/independent review NOT_RUN và aggregate restore P4.6 chưa mở, workload không SLA. Các mục dưới là chronology.

## P4.4-r1 — bàn giao, chờ nghiệm thu

P44-01–05/C44-01–03/ASCII hoàn tất nguồn/wiring trước tests và PASS local/synthetic. **Chờ Khiêm nghiệm thu năm mục; dừng trước P4.5.** [Task/checklist/evidence](tasks/CHURCH-P4.4.md), [contracts/runbook](engineering/P4.4-prayers.md), [verification](../output/p4.4/verification.json).354tests/5133assertions/0FAIL;707W08Firefoxchecks+2289regressionchecks (P43=398/W13=1407/W01=484);9configs/480journeys/2646requests/82retries, p95~39–796ms/max2832ms;12query plans. Cleanup0owned DB/private dirs/listeners/verification containers,9P43technical artifacts/journals nguyênSHA256. Static/build/UI/audit/diff PASS;10existingCSSwarnings/bundle594.90kB advisory. Journal implementation/self-review đã lưu, planning accounting correction liên kết không đổi C44/scope.

P4.1 Lịch giảng/sinh hoạt, P4.2 Chương trình ban, P4.3 Hồ sơ thăm viếng đã HUMAN_ACCEPTED; P4.4 Cầu thay/quyền riêng tư chờ nghiệm thu; P4.5 Cảnh báo/chăm sóc tự động và P4.6 Tổng hợp/kiểm chứng NOT_OPENED. Không commit/push/deploy/real data/main DB read/init/restart3443/worktree/delegation. Main schema/index/audit audience chưa áp; không release. Self-review, chưa independent review/UAT. P3.4 prior race UNKNOWN giữ nguyên (current suite có ca đó PASS); physical/native Word/Safari/main runtime/pilot/remoteCI/production/multi-replica NOT_RUN. Aggregate restore P4.6 chưa mở; không SLA/capacity/RPO/RTO. Private theo application role hiện hành, không cách ly mật mã khỏi Owner account/infrastructure administration. Pending/query chỉ RAM, không revocation push guarantee. Các mục dưới là chronology.

## Nghiệm thu P4.3-r1, mở planning P4.4

Khiêm: **“nghiệm thu năm mục P4.3-r1 và cho phép mở kế hoạch chi tiết P4.4 để duyệt trước coding.”** [Task/checklist](tasks/CHURCH-P4.3.md), [evaluation](engineering/skill-usage/records/CHURCH-P4/P4.3-human-acceptance-1.json). P43-01–05 đủ năm mục HUMAN_ACCEPTED local/synthetic. Giữ snapshot bàn giao:328tests/4728assertions,398W08checks+2217regressionchecks;9configs/480journeys/4953requests/851retries, p95~272–12127ms; cleanup0. Không chạy lại tests/runtime ở lượt nghiệm thu;9technical artifacts/journals P4.3 giữ nguyên SHA256. P3.4 prior race UNKNOWN,10diagnostic loops không tái hiện và final suitePASS vẫn là các bằng chứng tách biệt, không xóa UNKNOWN bằng acceptance.

P4.4 chỉ khảo sát nguồn và trình kế hoạch chi tiết/C44/ASCII trong chat, chưa chốt thiết kế hoặc coding. Không tạo application code/schema hoặc lưu dự thảo chi tiết thành quyết định đã duyệt; P4.5–P4.6 chưa mở. Không publication/deploy/real data/main DB read/init/restart3443. Giữ physical/native Word/main runtime/Safari/UAT/pilot/remoteCI/production/multi-replica NOT_RUN và aggregate restore P4.6 chưa mở; workload không SLA. Các mục sau là chronology.

## P4.3-r1 — bàn giao, chờ nghiệm thu

P43-01–05/C43-01–03/ASCII hoàn tất nguồn/wiring trước test phase và kiểm chứng local/synthetic; chờ Khiêm nghiệm thu năm mục P4.3-r1. P4.4–P4.6 NOT_OPENED. Không publication/deploy/real data/main DB read/init/restart3443. [Task/checklist](tasks/CHURCH-P4.3.md). 328tests/4728assertions;24P43tests trong suite;398W08Firefoxchecks +2217regressionchecks;9configs/480journeys/4953requests/851retries, p95~272–12127ms (max13517ms). [Verification](../output/p4.3/verification.json), [contracts/runbook](engineering/P4.3-visitation.md), [journal](engineering/skill-usage/records/CHURCH-P4/P4.3-implementation-1.json). Static/build/UI/audit/diff PASS,10existingCSSwarnings/bundle577.23kB advisory. Cleanup readback0ownedP43databases/private dirs/listeners; P42technical artifacts/journals giữ nguyên9/9hash. Self-review, chưa independent review/UAT/human acceptance/release. Workload5stages gồm list+summary và bounded retry/backoff; không SLA/capacity production. Pending intent memory-only, aggregate restore P4.6 chưa mở, physical/native Word/main runtime/Safari/UAT/pilot/remoteCI/production/multi-replica NOT_RUN. Một lượt trước327PASS/1P3.4raceFAIL;10diagnostic loops không tái hiện, assertions/P3.4 application source giữ nguyên, chỉ thêm safe error-message. Nguyên nhân lượt trước UNKNOWN, giữ finding/evidence; final suite báo riêng. Các mục bên dưới là chronology trước bàn giao hiện hành.

## Nghiệm thu P4.2-r1, mở planning P4.3

Khiêm: **“Nghiệm thu P4.2-r1 theo năm mục; đồng ý, cho phép mở kế hoạch chi tiết P4.3 để duyệt trước coding.”** [Task/checklist](tasks/CHURCH-P4.2.md), [evaluation](engineering/skill-usage/records/CHURCH-P4/P4.2-human-acceptance-1.json). P42-01–05 đủ năm mục HUMAN_ACCEPTED. Snapshot kỹ thuật giữ nguyên:304tests/4299assertions; focused21/241; browser326+regression1873;9configs/480journeys/3057requests/379retries, p95~54–3125ms; A4 7rows/1page và50rows/3pages; cleanup0. Đây là bằng chứng tại thời điểm bàn giao, không chạy lại runtime/tests ở lượt nghiệm thu.

P4.3 chỉ khảo sát nguồn và trình kế hoạch chi tiết/C43/ASCII trong chat, chưa duyệt thiết kế/coding. Không tạo application code/schema hoặc lưu draft chi tiết như quyết định đã chốt; P4.4–P4.6 chưa mở. Không publication/deploy/real data/main DB init/restart3443. Giữ P4.2 technical receipts/source manifest/implementation/self-review journals và physical/native Word/main runtime/Safari/UAT/pilot/remoteCI/production/multi-replica NOT_RUN; workload không là SLA, aggregate restore thuộc P4.6 chưa mở.

## P4.2-r1 — đã bàn giao, chờ nghiệm thu

Khiêm: **“Duyệt P4.2-plan-r1, C42-01–03 và ASCII. Triển khai trọn P42-01–05 local/synthetic rồi bàn giao, dừng trước P4.3. Chưa commit/push/deploy hoặc dùng dữ liệu thật.”** [Task/checklist](tasks/CHURCH-P4.2.md). Trọn P42-01–05 nguồn và wiring hoàn tất trước test phase.304tests/4299assertions; focused21/241; browser326 + regression1873; workload9configs/480journeys/3057requests/379retries, p95~54–3125ms; A4 7rows/1page và50rows/3pages; cleanup0. [Verification](../output/p4.2/verification.json), [contracts/runbook](engineering/P4.2-programs.md), [journal](engineering/skill-usage/records/CHURCH-P4/P4.2-implementation-1.json). Chờ Khiêm nghiệm thu năm mục P4.2-r1, chưa release. Đã dừng trước P4.3; P4.3–P4.6 chưa mở, không publication/deploy/real data/main DB init/restart3443. Giữ P4.1 acceptance/technical snapshots và mọi physical/NOT_RUN; các mục planning bên dưới giữ chronology.

## P4.1-r1 — đã nghiệm thu; chỉ mở planning P4.2

Khiêm: **“Nghiệm thu P4.1-r1 theo năm mục trong checklist. Mở kế hoạch chi tiết P4.2 để duyệt trước coding.”** [Task/checklist](tasks/CHURCH-P4.1.md), [evaluation](engineering/skill-usage/records/CHURCH-P4/P4.1-human-acceptance-1.json). P41-01–05/C41-01–03/ASCII source complete/local-synthetic verified và HUMAN_ACCEPTED đủ năm mục. P4.2 — Chương trình sinh hoạt ban chỉ investigation/kế hoạch chi tiết trong chat, chưa duyệt coding. P4.3–P4.6 chưa mở.

Giữ snapshot bàn giao **283tests/4059assertions;466P41+1909regressionFirefoxchecks;9configs/480measuredjourneys/2898requests/326retries**, p95local35.13–1149.89ms; không SLA/full200-assignment saturation. Static/build/UI/audit/diff PASS,10sourceCSSwarnings/bundle539.21kB warning. Self-review, không reviewer độc lập; readback0P41DB/private dirs/verification containers/listener3475 là snapshot bàn giao. [Receipt](../output/p4.1/verification.json), [manifest](../output/p4.1/source-manifest.json), [implementation journal](engineering/skill-usage/records/CHURCH-P4/P4.1-implementation-1.json) và self-review giữ nguyên; không chạy lại tests/runtime ở bước nghiệm thu này. Chưa commit/push/deploy/real data/main DB init/restart3443. Giữ P3 physical/native Word/main runtime/Safari/UAT/pilot/remoteCI/production/multi-replica NOT_RUN; P4 aggregate restore thuộc P4.6 chưa mở.

## P4 — danh mục đã duyệt, chỉ mở planning P4.1

Khiêm: **“Duyệt P4-plan-r1. Mở kế hoạch chi tiết P4.1 để duyệt trước coding.”** Đã ghi danh mục sáu gói/thứ tự/điểm dừng tại [CHURCH-P4](tasks/CHURCH-P4.md), [journal danh mục](engineering/skill-usage/records/CHURCH-P4/P4-plan-planning-1.json) và [approval evaluation](engineering/skill-usage/records/CHURCH-P4/P4-plan-human-approval-1.json). P4.1 — Lịch giảng và sinh hoạt chỉ investigation/kế hoạch chi tiết trong chat; chưa duyệt implementation. P4.2–P4.6 chưa mở. Không lưu draft P4.1 như thiết kế đã chốt, không code/tests/runtime mới, không commit/push/deploy/real data/main DB init/restart3443. Giữ P3 CLOSED local/synthetic, technical snapshots và toàn bộ NOT_RUN/physical note; các dòng P4 NOT_OPENED bên dưới là chronology trước approval hiện hành.

## P3 — đã đóng theo chỉ dẫn Khiêm 2026-11-13

**P3 CLOSED local/synthetic; P4 NOT_OPENED.** [Biên bản đóng P3](tasks/CHURCH-P3.md#đóng-p3), [closure evaluation](engineering/skill-usage/records/CHURCH-P3/P3-closure-1.json) dẫn đủ sáu acceptance P3.1–P3.6. Chỉ cập nhật hồ sơ và thông báo chat P4 theo chỉ dẫn, không duyệt P4-plan-r1/mở P4 hoặc implementation mới. Không chạy lại tests/runtime, không thay technical snapshots hoặc journals trước đó. Chưa commit/push/deploy/real data/main DB init/restart3443. P3-PHYSICAL-01 Camera/giấy thật và mọi NOT_RUN dưới đây giữ nguyên.

## P3.6-r1 — đã nghiệm thu đủ năm mục

P36-01–05/C36-01–03/ASCII hoàn tất; Khiêm đã nghiệm thu đủ năm mục local/synthetic. [Evaluation nghiệm thu](engineering/skill-usage/records/CHURCH-P3/P3.6-human-acceptance-1.json). [Task/checklist](tasks/CHURCH-P3.6.md), [contracts/runbook](engineering/P3.6-reporting.md), [receipt](../output/p3.6/verification.json), [journal](engineering/skill-usage/records/CHURCH-P3/P3.6-implementation-1.json). Reference explicit/partial unique/reason+confirmation;12CN calendar/coverage/missing≠0; public ports/snapshot/fresh auth; W01/W02/W14/W04/W05 hai realm/filter/cursor/export source binding; QR/lớp/lễ/chứng nhận public workflow.

**PASS263tests/3762assertions;329P36+5973regressionFirefoxchecks;9workloadconfigs/480measuredjourneys/1920HTTPSrequests;restore34collections fingerprints khớp.** Readback0syntheticDB/privateP3.6dirs/verificationcontainers/listener3472. Typecheck/lint(UI CSS nguồn10warnings)/UIguard/product+reference builds/audit/diff PASS; bundle516.80kB warning>500kB. Self-review, không reviewer độc lập. p95 local tải2000/10: W01~8.30s/W04~8.83s; không production SLA/capacity. [Số đo/giới hạn](tasks/CHURCH-P3.6.md#bằng-chứng-thực-chạy).

Đã ghi acceptance theo chỉ dẫn Khiêm; không chạy lại tests/runtime. Các số liệu/readback ở trên giữ snapshot bàn giao. P3 đã đóng theo chỉ dẫn mới; tiếp tục dừng, P4 chưa mở. Chưa commit/push/deploy/real data/main DB init/restart3443. **P3-PHYSICAL-01 Camera điện thoại/bản giấy thật vẫn NOT_RUN**, native Word/main runtime/Safari/UAT/pilot/remoteCI/production/multi-replica NOT_RUN. [Note cần nhắc](tasks/CHURCH-P3.md#p3-physical-verification-note): chỉ đóng khi có bằng chứng thực tế và Khiêm xác nhận; nhắc tại nghiệm thu P3.6 và trước UAT/pilot/release. Giữ historical receipts/acceptance P3.1–P3.5 và technical receipt/source manifest/implementation journal P3.6; trạng thái pending của bản bàn giao gốc được evaluation nghiệm thu bổ sung, không rewrite lịch sử.

## P3.5-r1 — đã nghiệm thu local/synthetic

**P35-01–05/C35-01–03/ASCII SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED / HUMAN_ACCEPTED đủ năm mục; chưa released.** [Task/checklist](tasks/CHURCH-P3.5.md), [contracts](engineering/P3.5-certificates.md), [evaluation](engineering/skill-usage/records/CHURCH-P3/P3.5-human-acceptance-1.json). Snapshot bàn giao giữ nguyên:253tests/3638assertions,417Firefoxchecks+3666browserregression,10tài liệu/12trang render+visualPASS,6workloadconfigs/90journeys/3same-key409retries. Static/build/UI/audit/diff PASS;10warnings CSS nguồn và bundle509,05kB warning; self-review. [Receipt](../output/p3.5/verification.json), [journal usage](engineering/skill-usage/records/CHURCH-P3/P3.5-implementation-1.json), [verification completion](engineering/skill-usage/records/CHURCH-P3/P3.5-implementation-verification-1.json) không đổi và không tính lại usage.

Không chạy lại tests/runtime trong bước nghiệm thu. Readback0DB/private CA/renderer jobs/browser containers là snapshot bàn giao; không main DB init/restart3443/commit/push/deploy/real data. Camera/giấy/native Word và stress15s/5MiB exact saturation NOT_RUN giữ nguyên. Tại thời điểm nghiệm thu P3.5, P3.6 chỉ mở planning; authority và kết quả mới ở đầu trang thay trạng thái lịch sử đó.

## P3.4-r1 — đã nghiệm thu local/synthetic

- P34-01–05/C34-01–03/ASCII **SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; HUMAN_ACCEPTANCE=ACCEPTED theo đủ năm mục checklist; chưa released**. [Task/checklist](tasks/CHURCH-P3.4.md), [contracts](engineering/P3.4-rites.md), [receipt](../output/p3.4/verification.json), [journal](engineering/skill-usage/records/CHURCH-P3/P3.4-implementation-1.json).
- Năm tab W06/W14, canonical Members.baptism + public Rites history handler, same transaction/import compatibility, snapshots, preview/CAS/fences/replay, explicit relations và no auto family/deceased/communion counts. Giữ Lớp dự bị và classes:interview riêng; policy11 rites:read/manage cho owner/pastor/secretary.
- PASS238tests/3366assertions,3665Firefoxchecks (768P34+736classes+541members+417import+785attendance+418QR),20source parity/120layout samples, gap18px.9configs/540measured+90warmup/2731attempts gồm31contention409, p95=42.39–651.75ms cho5bước list/detail/preview/commit/history. Local communion workload, không SLA/full mixed capacity. Static/build/UI/audit PASS,10warningsCSSnguồn. Self-review, không reviewer độc lập. Readback0syntheticDB/privateP34dirs/verificationcontainers; main runtime chưa kiểm chứng source/schema mới.
- P3.5 chỉ mở planning; P3.6 chưa mở. Các số đo trên giữ snapshot bàn giao, không chạy lại trong lần ghi nhận nghiệm thu. Không commit/push/deploy/real data/main DB init/restart3443. Safari/remoteCI/production/multi-replica/UAT NOT_RUN. **Camera điện thoại/giấy thật vẫn NOT_RUN** theo [note](tasks/CHURCH-P3.md#p3-physical-verification-note); chỉ đóng khi có bằng chứng thực tế và Khiêm xác nhận. Những trạng thái planning cũ trong lịch sử phía dưới ghi thời điểm trước approval P3.4.

## P3.3-r1 — đã nghiệm thu local/synthetic

- Khiêm duyệt P3.3-plan-r1/C33-01–03, trọn P33-01–05 local/synthetic. **SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; HUMAN_ACCEPTANCE=ACCEPTED theo checklist; P3.4 chỉ mở planning, chưa released.** [Task/checklist](tasks/CHURCH-P3.3.md), [contracts](engineering/P3.3-prep-classes.md), [receipt](../output/p3.3/verification.json), [journal head](engineering/skill-usage/records/CHURCH-P3/P3.3-implementation-correction-1.json).
- PASS221tests/3166assertions,2773Firefoxchecks (736P33+785attendance+419QR+541members+173accounts+119navigation). W06source parity/light-dark/responsive/keyboard/route continuity;18px toolbar-table gap60mẫu.9configs/540completed measured +90warmup,1237attempts gồm157contention409 bounded exact-intent retry, p95=25.59–284.51ms mark+progress read local. Roster2000/cap2001/200lesson metadata validated; workload3bài không full200lessoncapacity. Self-review, không review độc lập. Static/build/UI/audit PASS,10warningsCSSnguồn; readback0syntheticDB/CAp33dirs/container.
- Không commit/push/deploy/real data/main DB init/restart3443; runtime chính/Safari/remoteCI/production/multi-replica/UAT NOT_RUN. P3.4 chỉ planning; P3.5/P3.6 chưa mở. Giữ P3.1/P3.2 human acceptance và toàn bộ technical snapshots P3.3. Không chạy lại runtime/tests trong bước ghi nhận nghiệm thu. Journal correction giữ original event, không tính thêm usage.
- **P3-PHYSICAL-01 vẫn NOT_RUN:** camera điện thoại và giấy thật; [note](tasks/CHURCH-P3.md#p3-physical-verification-note). Chỉ đóng sau bằng chứng thực tế và Khiêm xác nhận, nhắc lại P3.5/P3.6 và trước UAT/pilot/release.

## P3.2-r1 — gói đã nghiệm thu và bằng chứng bàn giao

- Khiêm: “duyệt P3.2-plan-r1”. Triển khai trọn P32-01–05 local/synthetic; code/wiring trước tests, bàn giao rồi dừng trước P3.3. [Task/authority](tasks/CHURCH-P3.2.md). Không commit/push/deploy/dữ liệu thật/init main DB/restart dịch vụ hiện hành. P3.3 nay chỉ mở planning; P3.4–P3.6 chưa mở.
- **P32-01–05 hoàn tất local/synthetic, HUMAN ACCEPTED theo chỉ dẫn mới; P3.3 chỉ mở planning, chưa released.** [Contracts](engineering/P3.2-cards-qr.md), [receipt](../output/p3.2/verification.json), [journal](engineering/skill-usage/records/CHURCH-P3/P3.2-implementation-1.json). 208tests/2924assertions;1917Firefoxchecks (418QR+785attendance+173accounts+541members);9configs/540measured completed/1190HTTPattempts gồm110contention409, p95=20.49–236.33ms local resolution+commit. Static/build/UI/audit PASS,10warningsCSSnguồn. Self-review; main runtime/Safari/remoteCI/production/multi-replica NOT_RUN;0syntheticP32DB/CA dirs/container. Không init main DB/restart3443, commit/push/deploy/dữ liệu thật. Các ghi chép planning/implementing trong lịch sử giữ chronology; P3.1 receipts/usage không đổi.
- **Cần nhắc Khiêm — P3-PHYSICAL-01:** camera điện thoại thật và bản in giấy thật vẫn **NOT_RUN**. Agent nhắc khi tiếp tục/bàn giao/nghiệm thu P3.2, rà lại P3.5/P3.6 và trước UAT/pilot/phát hành; nghiệm thu local/synthetic không tự đóng các mục này. [Ghi chú và điều kiện hoàn tất](tasks/CHURCH-P3.md#p3-physical-verification-note).


## P3.1 — gói đã nghiệm thu và bằng chứng bàn giao

- Khiêm duyệt P3.1-plan-r1 cùng ba lựa chọn và trọn P31-01–05 local/synthetic, bàn giao rồi dừng trước P3.2. Chưa commit/push/deploy/dữ liệu thật. [Authority/task](tasks/CHURCH-P3.1.md), [contracts](engineering/P3.1-attendance.md).
- **P31-01–05/P3.1-r1 SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; HUMAN_ACCEPTANCE=ACCEPTED theo chỉ dẫn ngày2026-11-13; chưa released.** PASS195tests/2756assertions,1359Firefoxchecks;9configs/540completed measured intents (765attempts gồm225contention409, exact-intent retry), p95=11.81–244.87ms synthetic. Roster explain indexed; schema/cap2000/reset2000/revoke/real-commit loss verified. [Task/checklist](tasks/CHURCH-P3.1.md), [receipt](../output/p3.1/verification.json), [journal](engineering/skill-usage/records/CHURCH-P3/P3.1-implementation-1.json). Readback0P31DB/private directories/browser containers. Lint10warningsCSSnguồn, các static/builds/UI/audit PASS. Self-review; NOT_RUN Safari/physical/remoteCI/production/multi-replica/main runtime. Không init main DB/restart3443; chưa commit/push/deploy/dữ liệu thật. **P3.1 đã nghiệm thu; P3.2 được mở planning tại thời điểm nghiệm thu này, approval/bàn giao P3.2 về sau ghi phía trên; P3.3–P3.6 chưa mở.** Số đo là snapshot bàn giao trước nghiệm thu, không chạy lại trong lần ghi nhận này.

## P3 — lịch sử duyệt danh mục và mở kế hoạch P3.1

- Khiêm: “Duyệt P3-plan-r1. Mở kế hoạch chi tiết P3.1 để duyệt trước coding.” Danh mục sáu gói và thứ tự bàn giao đã được duyệt; P3.1 Buổi nhóm và điểm danh tay đang lập kế hoạch chi tiết trong chat, chưa được duyệt implementation. P3.2–P3.6 chưa mở.
- Chỉ ghi nhận danh mục/authority trong tài liệu; dự thảo contracts/quy tắc/mockup P3.1 chưa duyệt không lưu thành thiết kế đã chốt. Chưa có code, tests hoặc bằng chứng runtime P3; không Git publication/deploy/dữ liệu thật, init main DB hoặc restart dịch vụ.
- [Roadmap và điểm dừng](tasks/CHURCH-P3.md); [journal phê duyệt](engineering/skill-usage/records/CHURCH-P3/P3-plan-human-approval-1.json). Bằng chứng và giới hạn P2 giữ nguyên, không chạy lại tests để ghi nhận chỉ dẫn.

## CI-REFERENCE-r1 — 2026-11-11

- Khiêm duyệt kế hoạch sửa local trong chat: “Duyệt.” Gói một lần ngoài roadmap; P1 vẫn CLOSED, P2 NOT_OPENED; không commit/push/deploy.
- Lỗi xác minh từ run `42943023514` tại revision `9ebb3df8a1788746b2b150f720c9a8c5dbf16dbf`: `ui:check` đọc `../documents` không tồn tại trên runner. Đã đưa snapshot HTML đúng SHA256 vào `tools/ui-reference`, sửa source check và read-only browser mount cùng dùng snapshot.
- Đã PASS: checkout mô phỏng không có sibling documents, chặn HTML bị sửa, lint (10 warnings CSS có sẵn), typecheck, hai builds, ui:check, shell syntax, 76 integration tests/997 assertions, 658 Firefox checks (171+88+119+280), audit và benchmark. Qualification/restore/cleanup PASS (33 cấu hình/3.300 HTTP samples; 100 churches/10.000 accounts/100.005 audit events). `git diff --check` PASS. Remote Linux CI NOT_RUN với bản sửa, chưa human accepted/released. [Receipt local](../output/ci-reference/verification.json), [journal](engineering/skill-usage/records/CI-REFERENCE/implementation-1.json).

## CI-REFERENCE publication — quyền hiện hành

- Khiêm yêu cầu “commit and push.” trong chat ngày 2026-11-11, cấp quyền publication bản sửa CI-REFERENCE-r1 qua task branch và PR vào `main`. Không merge/deploy/P2. Các giới hạn không-publication ở biên bản implementation phía trên ghi phạm vi trước yêu cầu này.
- Đã push commit `3f80508` trên `codex/fix-ci-reference`, remote SHA khớp local; [PR #1](https://github.com/khiemnd777/church-cms/pull/1) vào `main`, chưa merge/deploy. Các giới hạn “remote NOT_RUN” phía trên là bằng chứng tại bàn giao local trước publication.
- Hai run đầu của `3f80508` đều vượt lint/typecheck/builds/ui:check/integration/audit trên Linux. Push run `42949303549` vượt browser; PR run `42949331660` fail assertion `full-login-O01-empty`: heading xuất hiện trước khi async list trả về. Sửa test chờ empty state visible trước assertion, không đổi app hoặc assertion. Suite liên quan rerun local PASS119checks; lint/typecheck/diff check PASS.
- Kết quả cuối của bản sửa bổ sung được kiểm tra tại [Actions của PR #1](https://github.com/khiemnd777/church-cms/pull/1/checks); không dùng PASS local hoặc một run làm bằng chứng mọi run thành công. [Journal publication](engineering/skill-usage/records/CI-REFERENCE/publication-1.json).

## Git publication — 2026-11-11

- Khiêm đã duyệt kế hoạch khởi tạo Git, commit và push repository `khiemnd777/church-cms`. Remote trống đã được kiểm tra; nhánh ban đầu `main`. Publication không mở P2 hoặc cấp quyền deploy.
- Kiểm tra trước publication: lint PASS (10 warnings CSS có sẵn), typecheck/product build/reference build/ui:check PASS; integration 76 PASS/997 assertions với MongoDB/Redis local. Browser/remote CI chưa chạy lại trong task này.
- `.env`, `.local/`, dependencies, build và `output/` không đưa lên Git; liên kết bằng chứng `output/` trong tài liệu chỉ dùng ở workspace local. Đã push commit nguồn `d372743832232eb62797629bc040170c01d68d0b` lên `origin/main`; remote hash khớp local khi readback. Đây là Git publication, chưa deploy; remote CI chưa xác minh.

## Trạng thái hiện hành

- **P2 CLOSED; P2.1-r2/P2.2-r1/P2.3-r1/P2.4-r3/P2.5-r1/P2.6-r1 HUMAN ACCEPTED.** P26-01–05 source complete/local-synthetic verified:183tests/2560assertions,4838Firefoxchecks;24configs/720measuredHTTP0errors,21cross-P2workflowchecks,restore19collections/fingerprints/sessions/artifact/registry PASS. [Task/checklist](tasks/CHURCH-P2.6.md), [receipt](../output/p2.6/verification.json), [journal](engineering/skill-usage/records/CHURCH-P2/P2.6-implementation-1.json). Readback0DB/privateP26directories/browsercontainers còn lại. Self-review; Safari/physical/remoteCI/production/multi-replica/real-data NOT_RUN. Không init main DB/restart3443; environment test đã dọn, instance hiện hành chưa kiểm source mới. **P2 CLOSED/P3 NOT_OPENED; không commit/push/deploy/dữ liệu thật; chưa released.** [Human acceptance/closure](engineering/skill-usage/records/CHURCH-P2/P2.6-human-acceptance-1.json). Các số đo phía trên là bằng chứng bàn giao trước acceptance, không chạy lại ở bước đóng P2.

- **P2-plan-r1 APPROVED; P2.1-plan-r1 IMPLEMENTATION AUTHORIZED** ngày 2026-11-11 trong chat. P21-01–05 đã bàn giao r1 nhưng Khiêm chưa nghiệm thu vì UI spacing; P21-03/04 đã sửa và bàn giao r2, nay đã được nghiệm thu; P2.2 đã được duyệt triển khai theo chỉ dẫn mới. P2.1 đã push tại `668e8db`, [PR #2](https://github.com/khiemnd777/church-cms/pull/2) draft; chưa merge/deploy/dữ liệu thật. Hồ sơ: [CHURCH-P2](tasks/CHURCH-P2.md), [P2.1](tasks/CHURCH-P2.1.md). Các giới hạn publication/NOT_OPENED phía dưới là lịch sử tại thời điểm ghi.

- **CI P2.1:** run `43044929795` fail khi build browser image do không phân giải được Ubuntu repositories; lint/typecheck/builds/ui:check/integration/audit PASS, browser assertions chưa chạy, qualification/benchmark bị skip. Theo chỉ dẫn Khiêm “Bỏ browser tests, giữ các checks khác”, đã bỏ bước browser khỏi workflow local; lệnh browser local còn nguyên, các bước CI khác giữ nguyên. Tại bàn giao local, thay đổi workflow chưa commit/push và CI với cấu hình mới NOT_RUN. Browser regression không còn được CI tự chạy, P2.1-r2 đã được nghiệm thu bằng chỉ dẫn mới; thông tin CI không thay acceptance.

- **P1 CLOSED — P1.1/P1.2/P1.3/P1.4 HUMAN ACCEPTED** theo Khiêm: “Nghiệm thu P1.4 và Đóng P1. Chưa mở P2.” [Biên bản đóng P1](tasks/CHURCH-P1.md#đóng-p1), [acceptance P1.4](engineering/skill-usage/records/CHURCH-P1/P1.4-human-acceptance-1.json).
- **P2.1-r2 HUMAN ACCEPTED — r1 CHANGES_REQUESTED giữ làm lịch sử**; P2.2-r1 đã nghiệm thu; P2.3-r1 đã nghiệm thu; P2.4-r3 đã nghiệm thu, P2.5-r1 đã nghiệm thu local/synthetic; P2.6-r1 đã nghiệm thu; P2 CLOSED/P3 NOT_OPENED. Kết quả local không thay release/production qualification.

- **P0-FOUNDATION-r2 và P1.1-r1 HUMAN ACCEPTED**. P1-plan-r1/hai mockup đã được duyệt; không suy rằng các gói sau tự được mở.
- **P1.2 Quản lý Hội Thánh, gồm UI-STD-r1/UI-STD-nav-r2: HUMAN ACCEPTED** theo lời Khiêm “Nghiệm thu P1.2. Tiếp theo, kế hoạch P1.3”. [Acceptance P1.2](engineering/skill-usage/records/CHURCH-P1/P1.2-human-acceptance-2.json), [acceptance UI](engineering/skill-usage/records/CHURCH-P1/UI-STD-r1-human-acceptance-2.json).
- Các lần CHANGES_REQUESTED vì UI và mất text trước đây giữ nguyên làm lịch sử; không xóa receipt hoặc ghi lại usage.
- **P1.3-r1: HUMAN ACCEPTED** theo Khiêm “Hiểu rồi, nghiệm thu P1.3. Tiếp theo, kế hoạch P1.4”. Phạm vi [CHURCH-P1.3](tasks/CHURCH-P1.3.md). **P1.4-r1 HUMAN ACCEPTED — P1 đã đóng**. Không Git publication/deploy, production hoặc dữ liệu thật.

## P2.1 — lịch sử phản hồi nghiệm thu

- Khiêm **CHANGES_REQUESTED** ngày2026-11-11: components nằm sát nhau, margin/padding unexpected. [Ảnh phản hồi](../output/p2.1-spacing/reported.jpg), [human review](engineering/skill-usage/records/CHURCH-P2/P2.1-human-review-1.json). Đã sửa layout/Field spacing và thêm kiểm tra khoảng cách thực ở r2; nay đã được nghiệm thu ở review2. Review1 giữ làm lịch sử, không ghi đè bằng chứng. PASS kỹ thuật r1 phía dưới không chứng minh spacing đạt.

## P2.1-r2 — bằng chứng gói đã nghiệm thu

- Field tự có gap5px ngoài form và input/select không nhận flex-basis từ ancestor toolbar; W12 tách nhóm18px, heading/content12px, toolbar/table18px, tên ban/tuổi10px bằng spacing tokens/nguồn hiện có. Không đổi API/schema/quyền/nghiệp vụ.
- **PASS1168Firefox checks**:508P2.1 (80mẫu đo geometry)+282UI chung+171accounts+88churches+119owner. Measured label/control5px, group18px, heading12px, toolbar/table18px, age label/value10px, control một dòng36–44px. Đã xem ảnh desktop light/mobile dark; nay HUMAN ACCEPTED theo acceptance2 phía trên.
- PASS lint(10warnings CSS nguồn), typecheck, product/reference builds, ui:check/diff/bundle parity. Readback0DB synthetic browser P2.1 còn lại. Integration92tests/1227assertions r1 được tái sử dụng vì backend không đổi, không chạy lại trong sửa UI này.
- [Receipt r2](../output/p2.1-spacing/verification.json), [ảnh desktop](../output/p2.1-spacing/final/organization/w12-complete-1440-light.png), [mobile dark](../output/p2.1-spacing/final/organization/w12-complete-390-dark.png), [journal2](engineering/skill-usage/records/CHURCH-P2/P2.1-implementation-2.json). Self-review; NOT_RUN thiết bị thật/Safari/remote CI/production; không commit/push/deploy/main migration/restart server hiện hành. P2.2 chưa mở.

## P2.1-r1 — bằng chứng trước phản hồi

- P21-01–05 source complete/local behavior verified, **chưa human accepted/released**. Module Organization/settings/units,18API method/path mới hai realm, policyVersion2/actor-scoped ledger v2 giữ v1/F22; W12/O02/menu/config deep links. Scope local/synthetic và dừng trước P2.2.
- **PASS92integration tests/1227assertions** (16P2.1), Mongo replica set/Redis thật; **PASS766Firefox checks** (108P2.1+171accounts+88churches+119owner+280UI), gồm pending → idle → reauth → đối soát tường minh, real-commit fault và revoke/suspend barrier.
- **PASS** lint(10warnings CSS nguồn), typecheck/product+reference builds/ui:check/shell/audit `{}`/diff check/bundle parity. Explain300units bổ sung synthetic indexed, không SLA. Readback0DB synthetic P2.1 còn lại. Không ghi main DB/index/volume; chưa restart/kiểm chứng instance server hiện hành. Nâng cấp ledger index chỉ test trên DB UUID riêng.
- [Task/biên bản](tasks/CHURCH-P2.1.md), [contracts/runbook](engineering/P2.1-organization.md), [receipt](../output/p2.1/verification.json), [journal](engineering/skill-usage/records/CHURCH-P2/P2.1-implementation-1.json). NOT_RUN thiết bị thật/Safari/remote CI/production/real-data migration. Self-review, không reviewer độc lập. Các mục P1 bên dưới giữ evidence lịch sử tại lúc bàn giao P1, không thay quyền P2.1 mới.

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
- P1 đã đóng, P2.1-r2 đã nghiệm thu. P2.2-r1 đã HUMAN ACCEPTED theo Khiêm; P2.3-r1 đã nghiệm thu local/synthetic; P2.4-r3 icon switcher đã HUMAN ACCEPTED; P2.5-r1 CSV UTF-8 và Excel .xlsx đã nghiệm thu local/synthetic; P2.6-r1 đã HUMAN ACCEPTED, P2 CLOSED/P3 NOT_OPENED. Không publication/deploy/dữ liệu thật. Không init main DB/restart3443; ảnh/receipts P2.6-r1 tại output/p2.6 từ môi trường test riêng đã dọn.

## Agent conventions

[Agent Kit installation](agent-kit-installation.md); upstream history không là quyền/kết quả Church CMS. [Implementation journal UI-STD-r1](engineering/skill-usage/records/CHURCH-P1/UI-STD-r1-implementation-1.json) và [correction sau rà cuối](engineering/skill-usage/records/CHURCH-P1/UI-STD-r1-implementation-1-correction-1.json) chỉ ghi gói này; không ghi lại lịch sử P1.1/P1.2 cũ thành usage mới.

## Quyền implementation P2.5 — 2026-11-12

Khiêm duyệt P2.5-plan-r1 và trọn P25-01–05 local/synthetic. [Task](tasks/CHURCH-P2.5.md); bàn giao nghiệm thu rồi dừng trước P2.6. Không commit/push/deploy/dữ liệu thật.

## Quyền implementation P2.6 — 2026-11-12

Khiêm: “Duyệt P2.6-plan-r1 để triển khai trọn P26-01–05 local/synthetic, bàn giao nghiệm thu rồi dừng trước P3. Chưa đóng P2, commit/push, deploy hoặc dùng dữ liệu thật.” [Task](tasks/CHURCH-P2.6.md). Hoàn tất P26-01–05 local/synthetic, bàn giao nghiệm thu; chưa đóng P2/P3 chưa mở.


## Nghiệm thu P2.6-r1 và đóng P2 — 2026-11-12

Khiêm: “Nghiệm thu P2.6-r1. Đóng P2. Chưa mở P3.” [Closure P2](tasks/CHURCH-P2.md#đóng-p2), [acceptance](engineering/skill-usage/records/CHURCH-P2/P2.6-human-acceptance-1.json). **P2 CLOSED; P3 NOT_OPENED.** Chỉ cập nhật hồ sơ, không chạy lại tests/sửa ứng dụng hoặc điều khiển dịch vụ. Không tự mở planning/implementation P3, Git publication/deploy/dữ liệu thật; các quyền implementation trước đó là lịch sử đã hoàn tất.
