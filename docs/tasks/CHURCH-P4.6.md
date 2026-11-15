# CHURCH-P4.6 — Tổng hợp và kiểm chứng P4

Quyết định ngày 2026-11-15: **P4.6-r1 HUMAN_ACCEPTED đủ5/5; P4 CLOSED local/synthetic; P5 NOT_OPENED; chưa released.** [Evaluation nghiệm thu](../engineering/skill-usage/records/CHURCH-P4/P4.6-human-acceptance-1.json), [biên bản đóng P4](CHURCH-P4.md#đóng-p4). Các authority/checkpoint/bàn giao trước đây giữ lịch sử.


## Authority — 2026-11-14

Khiêm: **“Duyệt P4.6-plan-r1, C46-01–03 và ASCII, cho phép triển khai trọn P46-01–05 local/synthetic, bàn giao rồi dừng trước đóng P4 hoặc mở P5. Chưa commit/push/deploy hoặc dùng dữ liệu thật.”**

Kiểu bàn giao: Theo roadmap Church CMS P0–P8/P4/P4.6; một handoff P46-01–05. P4.1–P4.5 HUMAN_ACCEPTED. Không đóng P4/mở P5 hoặc publication/deploy/real data/main DB read/init/restart3443/worktree/delegation.

## Contracts đã duyệt

C46-01: Ba nhánh lịch→chương trình immutable; Attendance3calendarCN/nguồn Care→preview/confirm→create/link→thăm viếng; Prayer shared/pastoral độc lập không cấp nguồn Care. Hai realm/tenant/revoke/CAS/source-drift/rollback/retry/lostACK/receipt; ministry lead chỉ chương trình đúng ban; assignment không account role. Không schedule→Attendance/Rites tự động hoặc auto visited/completed/send.

C46-02: Dừng request mới và drain writes trước fingerprint/dump; restore UUID target rỗng không --drop; dynamic collections/docs/binaries/indexes/validators khớp trước transformations. Sau đó revoke sessions/purge certificate_previews/rotate synthetic key; fresh login kiểm P4 snapshots/ACL/ledger/episodes. Không Redis restore/flush. P4 preview digest không bảo đảm bị vô hiệu chỉ bằng rotate key; bỏ client pending cũ, receipt trước rồi preview/confirm mới. Không recovery epoch mới, không auto retry qua backup cut line, không PITR/RPO/RTO.

C46-03: 100/500/2000 source profiles×1/5/10workers,10/50/100 distinct terminal mixed journeys/config=480. Setup/scan tách measured latency; p50/p95/max/status/retries/outcomes/query plans. Full suite chạy riêng workload/browser; static/UI/build/browser hai realm/light-dark/responsive/keyboard/reauth. Giữ prior evidence/P3.4race UNKNOWN; bounded diagnostics, self-review không independent review. Fix chỉ evidenced defects vi phạm approved contract, material growth cần amended approval.

ASCII đã duyệt: nhánh W07 lịch→nháp→merge→chốt/in; W01/W08 nguồn Care→preview/confirm→case→entries/correction; Prayer độc lập; DBnguồn→quiesce/drain→dump/fingerprint→UUIDrestoretrống→compare→revoke/purge/rotate→fresh receipt/quyền/workflow→cleanup/readback.

## WHAT

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P46-01 | Contracts/fixtures/runner tích hợp | scripts/public ports | Hoàn tất nguồn; PASS local/synthetic | — |
| P46-02 | Workflow/quyền/race/retry/browser | tests/scripts | PASS local/synthetic | — |
| P46-03 | 9configs/480journeys/query plans | qualification/output/p4.6 | PASS local/synthetic | — |
| P46-04 | Backup/restore/recovery/cleanup | isolated UUID databases | PASS local/synthetic | — |
| P46-05 | Runbook/evidence/self-review/handoff | docs/journal/output | Hoàn tất nguồn; PASS local/synthetic | — |

## Năm mục đã được Khiêm nghiệm thu

- [x] Workflow xuyên gói đúng; snapshots/bản chốt/sửa tay giữ nguyên, không tác vụ ngoài scope.
- [x] Quyền hai realm/tenant/revoke/Prayerprivacy/concurrency/rollback/replay/lostACK đúng contract.
- [x] 9configs/480distinctjourneys/queryplans/số đo và giới hạn đầy đủ.
- [x] Restore khớp trước recovery transformations; phiên cũ bị từ chối, receipt/preview mới không trùng/lộ dữ liệu.
- [x] Checks/evidence/runbook/self-review và cleanup readback đủ.

SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED / HUMAN_ACCEPTED đủ5/5; P4 CLOSED local/synthetic; P5 NOT_OPENED; NOT_RELEASED. Physical/native Word/Safari/UAT/main runtime/pilot/remoteCI/production/multi-replica/independent review NOT_RUN; P3.4prior race UNKNOWN. Không production SLA/capacity/RPO/RTO/PITR.


## Checkpoint kiểm chứng — 2026-11-14

Không đổi production application code/UI/schema/policy/dependencies. Nguồn API/web vẫn nguyên manifest P4.5; chỉ thêm runners/tests và package/wrapper wiring. Focused3tests/60assertions PASS sau sửa fixture/hook; đã bổ sung current history-index coverage để chạy trong final suite. Qualification9configs/480distinct terminal IDs/6877requests/769retryresponses/18plans PASS;162program/159visit/159prayer,81create+78link, p95config152.31–3317.91ms/max8312.84ms. Restore50collections exact trước transformations;12sessions revoked/1preview purged; oldcursor400/QRproof409/certificatepreview412/cookies401. Quiesce nhận0in-flight tại cut, drain0/probe503; chưa ép request in-flight có chủ đích. Source/workload HTTPS; postrestore handler in-process Mongo/Redis thật. Exact2DB/privateDir/listenercleanup PASS.

Browser tổng hợp144checks PASS, light/dark1440/901/900/560/390/two realms/W01-W07-W08-W13/keyboard/authenticated immutable print. RegressionP41–45 và final fullsuite đang chạy; technical completion chưa chốt. [Runbook](../engineering/P4.6-qualification.md), [workflow](../../output/p4.6/workflow.json), [workload](../../output/p4.6/qualification.json), [restore](../../output/p4.6/restore.json).


## Bàn giao P4.6-r1 — 2026-11-14

P46-01–05/C46-01–03/ASCII hoàn tất và kiểm chứng local/synthetic; **chờ Khiêm nghiệm thu năm mục, dừng trước đóng P4 hoặc mở P5**. 384tests/5517assertions/0FAIL;144browser tổng hợp+2601regressionchecks=2745;9configs/480distinct terminaljourneys/6877requests/769retryresponses;18list-count+5historyplans=23;restore50collections exact trước transformations;cleanup/readback0. Các checkpoint IN_PROGRESS phía trên là chronology trước bàn giao này.

162program editions/159completed visits/159closedprayers;visit81create+78link. p95config152.31–3317.91ms/max8312.84ms gồm bounded repreview/backoff. History plans dùng current source-linked small histories, không deep saturation/allfilters; listbound26 chỉ queries đo, exactcount không bound26.

Static/type/lint/UI/build/build:ui/audit/diff/shellPASS;10existingCSSwarnings/bundle615.15kB advisory. Source API/web/dependencies nguyênP45;3changedpriorpaths là package.json/browserwrapper/P42browserharness,6newrunners/tests. Dist56hashes không đổi;6browserbundlesmatches.78prior technical artifacts/journals nguyênSHA256.

[Verification](../../output/p4.6/verification.json) · [manifest](../../output/p4.6/source-manifest.json) · [workflow](../../output/p4.6/workflow.json) · [workload](../../output/p4.6/qualification.json) · [restore](../../output/p4.6/restore.json) · [history plans](../../output/p4.6/history-plans.json) · [readback](../../output/p4.6/readback.json) · [preservation](../../output/p4.6/prior-evidence-preservation.json) · [attempts/limits](../../output/p4.6/attempts/README.md). [Implementation journal](../engineering/skill-usage/records/CHURCH-P4/P4.6-implementation-1.json), [self-review](../engineering/skill-usage/records/CHURCH-P4/P4.6-self-review-1.json).5skills sum100%, measuredphasecountersnull có lý do; self-review không independentreview/humanacceptance/release.

Giữ UNKNOWN P3.4race và P42postreauthfastfill exactcause. P42currentkeyboard+blur/exactreason/preview200/r2immutabilityPASS không chứng minh fastfill/paste đã sửa. Quiesce observed0inflight/drain0/probe503; chưa ép requestinflight. P4digest không tự invalidated khi rotatekey; bỏpendingcũ/freshauthorizedreceipt trướcpreview/confirm. Postrestore handler in-process/realMongoRedis; source/workloadHTTPS. Physical/nativeWord/Safari/UAT/mainruntime/pilot/remoteCI/production/multi-replica/independentreviewNOT_RUN; không SLA/capacity/RPO/RTO/PITR. Không commit/push/deploy/realdata/mainread/init/restart3443/worktree/delegation hoặc tự đóngP4/mởP5.


## Nghiệm thu P4.6-r1 và đóng P4 — 2026-11-15

Khiêm: **“nghiệm thu năm mục P4.6-r1, đóng P4.”** P46-01–05 được HUMAN_ACCEPTED đủ năm mục. [Evaluation nghiệm thu](../engineering/skill-usage/records/CHURCH-P4/P4.6-human-acceptance-1.json), [closure P4](../engineering/skill-usage/records/CHURCH-P4/P4-closure-1.json). P4.1–P4.6 đã nghiệm thu; P4 CLOSED local/synthetic. P5 chưa mở. Không chạy lại tests/runtime hoặc sửa technical snapshots; giữ snapshot 384 tests/5.517 assertions,2.745 browser checks,9configs/480journeys/23plans,restore50collections/readback0. Acceptance bổ sung lịch sử, không rewrite trạng thái pending trong receipt/journal bàn giao gốc.

Giữ mọi UNKNOWN/NOT_RUN và recovery/workload/main-maintenance limits theo verification; chưa released. Không commit/push/deploy/real data/main DB read/init/restart3443 hoặc mở P5. Trạng thái sống duy nhất ở project-state.
