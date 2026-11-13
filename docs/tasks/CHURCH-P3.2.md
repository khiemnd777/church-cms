# CHURCH-P3.2 — Thẻ tín hữu và quét QR

## Quyền hiện hành — 2026-11-13

Khiêm: **“duyệt P3.2-plan-r1”**. Mở implementation trọn P32-01–05 local/synthetic theo kế hoạch đã trình trong chat, bàn giao nghiệm thu rồi dừng trước P3.3. Kế thừa giới hạn chưa commit/push/deploy/dữ liệu thật/init main DB/restart dịch vụ hiện hành.

## Phạm vi đã duyệt

- P32-01 Cards lifecycle/schema/index/public Members ports: cấp cho believer/visitor active hoặc long_absent, tối đa một thẻ active; đổi/thu hồi với CAS/reason/history; QR opaque256-bit không PII/URL công khai. Snapshot tên/mã/church lúc cấp, in lại giữ snapshot.
- P32-02 QR resolution token60giây gắn actor/church/session/card/rowVersion/generation; commit bằng kernel Attendance P3.1 trong cùng TX/fresh fences. Scan chỉ present=true, không toggle; không thêm roster hoặc xử lý offline. No-op không tăng count/history. Ledger/receipt kiểm quyền hiện hành, không phá P3.1.
- P32-03 W14 cấp/in/đổi/thu hồi/history; W05 scan camera cục bộ, tự dừng khi đóng/đổi buổi/chuyển nền/reauth, bao gồm stream trả về muộn. Same-origin camera policy, microphone/geolocation deny, workers self-hosted. Thẻ86×54mm in qua browser; không server Word/PDF. UI-STD-r1/ASCII P3.2-plan-r1.
- P32-04 code/wiring trước tests; real Mongo/Redis concurrency/revoke/abort/unknown commit, QR roundtrip, Firefox geometry/light-dark/responsive/keyboard/print layout/camera synthetic và workload1/5/10. Không camera giả làm proof điện thoại thật.
- P32-05 contracts/runbook/journal/evidence/state/handoff. Giữ P3.1 technical snapshots và human acceptance.

Owner/pastor/secretary quản lý và xem/in thẻ. Lead chỉ scan đúng active assigned unit/reduced roster; treasurer/member deny. QR frames không upload/log/lưu. Chưa cổng self/account binding/bulk cards/lớp/lễ nghi.

**P3-PHYSICAL-01: camera điện thoại thật và bản in giấy thật vẫn NOT_RUN**, chỉ đóng khi có bằng chứng thực tế và Khiêm xác nhận. Agent phải nhắc khi bàn giao/nghiệm thu; [ghi chú](CHURCH-P3.md#p3-physical-verification-note). Nghiệm thu local/synthetic không tự đóng hai mục này.

## Bàn giao P3.2-r1 — snapshot trước human acceptance

**SOURCE_COMPLETE / LOCAL_SYNTHETIC_VERIFIED; HUMAN_ACCEPTANCE=PENDING_REVIEW; chưa released.** Trọn P32-01–05; dừng trước P3.3. Live status duy nhất tại [project-state](../project-state.md).

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| P32-01 | Lifecycle/schema/index/snapshot thẻ | `api/cards`, Members/Tenancy ports | Hoàn tất local/synthetic | — |
| P32-02 | Resolution/proof/fresh fenced commit/ledger | `api/attendance`, Operations/rate limit | Hoàn tất local/synthetic | — |
| P32-03 | W14 thẻ/in/history, W05 local camera | `web/member-cards.tsx`, `web/qr-attendance.tsx`, shared kit | Hoàn tất local/synthetic | — |
| P32-04 | Integration/browser/qualification/review | `tests/integration/cards.test.ts`, `scripts/browser-qr.ts`, `scripts/p32-qualification.ts` | PASS local/synthetic | Không suy từ synthetic thành kiểm vật lý |
| P32-05 | Contracts/runbook/receipts/journal/state/handoff | [Contracts](../engineering/P3.2-cards-qr.md), [journal](../engineering/skill-usage/records/CHURCH-P3/P3.2-implementation-1.json) | Hoàn tất; chờ Khiêm nghiệm thu | — |
| P3-PHYSICAL-01 | Camera điện thoại và giấy thật | [Note](CHURCH-P3.md#p3-physical-verification-note) | NOT_RUN | Cần thiết bị/HTTPS tin cậy, máy in/giấy và Khiêm xác nhận |

### Bằng chứng thực tế

- `bun test tests`: **208 PASS, 0 FAIL, 2924 assertions / 15 files**; gồm13 tests P3.2 với real Mongo/Redis: snapshot/opaque QR, unique/cạnh tranh, CAS, revoke/lifecycle, row/proof/session binding/TTL, close/reset/no-op, history/receipt ACL, rollback và commit thật mất acknowledgement.
- Browser P3.2 **418 PASS**, regression Attendance **785**, Accounts **173**, Members **541**: tổng1917. Firefox/container/private CA; light/dark và1440/901/900/560/390, geometry/touch, shared modal keyboard, thẻ/in CSS86×54mm/tên dài, canvas MediaStream qua bundled QR worker → resolution → commit; track cleanup/late grant/reauth, conflict manual/QR, unknown response + explicit reconciliation. Các regression không bị ảnh hưởng bởi sửa cleanup scanner cuối được tái dùng; bundle hash lưu riêng từng results, scanner được kiểm trên bundle cuối.
- `bun run qualify:p3.2`: **9configs × 60 measured intents =540 hoàn tất**,90warmup,1190HTTPattempts gồm110contention409, bounded original-intent retry; p95 **20.49–236.33ms** cho resolution+commit. Counter/history chính xác, QR lookup chọn `card_public_unique`. Chỉ một API/local replica set, không là production SLA/multi-replica proof.
- Typecheck/lint/build/build:ui/UI-STD-r1/audit/bash syntax/diff whitespace PASS. Lint giữ **10 warnings CSS nguồn**; không sửa CSS chuẩn để xóa warning. Pinned qrcode1.5.4/qr-scanner1.4.2/types1.5.6; `bun audit`: no vulnerabilities found, không là chứng nhận an toàn.
- [Receipt](../../output/p3.2/verification.json), [source manifest](../../output/p3.2/source-manifest.json), [browser](../../output/p3.2/browser-results.json), [workload](../../output/p3.2/qualification.json), [cleanup](../../output/p3.2/cleanup-readback.json). Readback0P32DB/CA dirs/container; fixtures đã xóa. Giữ nguyên P3.1 receipts/journal.
- NOT_RUN: điện thoại/giấy thật, Safari, UAT/production/real data/multi-replica/remoteCI/main runtime. Không init main DB/restart3443; instance hiện hành chưa được nâng P3.2. Không commit/push/deploy.

### Self-review

Đã rà domain/contracts/tenant/actor/realm/capability trước cả replay, atomic card/member/attendance fences, QR privacy, CSRF/CSP/rate limit, source/worker/dependency metadata và callers. Không có reviewer độc lập; chưa có human acceptance. Không còn finding chặn trong phạm vi local/synthetic.

Các sửa trong vòng verification: metadata intent thẻ giữ trong bộ nhớ để khôi phục sau reauth thay vì đổi URL gây remount; stale QR commit dừng camera trước retry chủ động; print chờ font/màu giấy/tên dài; validation QR qua public seam thay import concrete Cards. Fixtures sai tên collection/role đã sửa; assertions unavailable của P2/W14 được đổi đúng chức năng P3.2 đã duyệt, không tắt gates. Một fixture camera hết hạn phiên giữa transaction được chuyển đến boundary HTTP để kiểm đúng reauth; vẫn giữ assertion dừng tracks và không tự bật lại.

### Checklist nghiệm thu cho Khiêm

- [x] Hồ sơ current believer/visitor → cấp/xem/in thẻ; thay/thu hồi có lý do; QR cũ bị từ chối, snapshot/history được giữ.
- [x] W05 buổi đang mở → quét QR ghi có mặt một lần; không tự thêm roster; manual/QR dùng cùng counts/history và xử lý conflict.
- [x] Lost response/reauth → dừng camera, giữ intent và đối soát chủ động; không tự phát sinh thao tác mới.
- [x] Chấp nhận phạm vi local/synthetic và giữ camera điện thoại/bản giấy NOT_RUN theo P3-PHYSICAL-01.

**Điểm dừng:** P3.3 Lớp dự bị chưa mở. Khiêm nghiệm thu P3.2-r1 và cho mở planning P3.3 mới tiếp tục; không suy implementation P3.3 từ việc mở planning.


## Human review1 — ACCEPTED; mở planning P3.3 — 2026-11-13

Khiêm: **“nghiệm thu P3.2-r1 theo checklist; đồng ý mở planning P3.3”**. P32-01–05/P3.2-r1 **HUMAN ACCEPTED local/synthetic** theo checklist phía trên; [evaluation](../engineering/skill-usage/records/CHURCH-P3/P3.2-human-acceptance-1.json). Snapshot bàn giao/technical receipt/source manifest/implementation journal giữ nguyên; không chạy lại tests ở bước ghi nhận. Human acceptance không là release hoặc proof camera điện thoại/bản giấy: P3-PHYSICAL-01 giữ NOT_RUN.

Mở **P3.3 PLANNING_ONLY** theo roadmap: khảo sát W06/Attendance/Members/Authorization/Operations, trình P3.3-plan-r1 và ASCII trong chat, chờ duyệt trước coding. Không tạo code/schema/tests/runtime P3.3 hoặc tự mở P3.4. Không commit/push/deploy/real data/main DB init/restart dịch vụ. Live status duy nhất tại project-state. Điểm dừng của snapshot phía trên đã được thay bằng chỉ dẫn này đối với việc mở planning, chưa cấp implementation.
