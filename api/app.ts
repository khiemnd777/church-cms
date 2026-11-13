import { resolve } from "node:path";
import type { ObjectId } from "mongodb";
import { MongoServerError } from "mongodb";
import type { AttendanceGrant } from "./attendance/models";
import { AttendanceReporting } from "./attendance/reporting";
import { Attendance } from "./attendance/service";
import { AuditReader } from "./audit/reader";
import { policyMatrix, policyVersion } from "./authorization/church-policy";
import { ownerCapabilities } from "./authorization/owner-policy";
import type { TenantGrant } from "./authorization/tenant-grant";
import type { CardGrant } from "./cards/models";
import { printDocument, printError, printScript } from "./cards/printing";
import { Cards } from "./cards/service";
import type { CertificateGrant } from "./certificates/models";
import {
  certificatePrintError,
  certificatePrintScript,
  printCertificate,
} from "./certificates/printing";
import { Certificates } from "./certificates/service";
import { CertificateSources } from "./certificates/source";
import type { Config } from "./config";
import { limits } from "./data-exchange/contracts";
import { DataExchange } from "./data-exchange/service";
import { AppError, requireCondition } from "./errors";
import { FamilyApplication } from "./families/application";
import { Families } from "./families/service";
import { readFileBody, readJson } from "./http";
import { objectId } from "./http-validation";
import { Accounts } from "./identity/accounts";
import { ChurchIdentity } from "./identity/church-service";
import type { Realm } from "./identity/models";
import { cookie, cookieName, type Identity, type SessionResult } from "./identity/service";
import { Members } from "./members/service";
import { Operations } from "./operations/service";
import type { OrganizationGrant } from "./organization/grant";
import { OrganizationRuntime } from "./organization/runtime";
import { Organization } from "./organization/service";
import { Overview } from "./overview/service";
import { PrepAttendanceSource } from "./prep-classes/attendance-port";
import type { ClassGrant } from "./prep-classes/models";
import { PrepReporting } from "./prep-classes/reporting";
import { PrepClasses } from "./prep-classes/service";
import type { RiteGrant } from "./rites/models";
import { RiteReporting } from "./rites/reporting";
import { Rites } from "./rites/service";
import { Tenancy } from "./tenancy/service";
export interface RequestInfo {
  ip: string;
}
const messages: Record<string, string> = {
  CERT_SOURCE_REQUIRED: "Chọn đúng hồ sơ, lễ hoặc ghi danh cùng Hội Thánh.",
  CERT_SOURCE_LOCKED: "Dữ kiện nguồn đã biết được khóa. Đối soát nguồn hoặc giữ giá trị đã chọn.",
  CERT_SUPPLEMENT_INVALID: "Chỉ bổ sung trường phù hợp với mẫu này.",
  CERT_DATE_INVALID: "Kiểm tra ngày sinh, ngày lễ và ngày chốt bản.",
  CERT_KIND_IMMUTABLE: "Không đổi loại mẫu của bản nháp đã tạo.",
  CERT_PREVIEW_STALE: "Preview đã hết hạn hoặc nguồn đã thay đổi. Tải lại và chuẩn bị preview mới.",
  CERT_INCOMPLETE: "Còn dữ kiện thiếu hoặc mâu thuẫn. Đối soát trước khi chốt.",
  CERT_FAITH_CONFIRMATION: "Cần xác nhận riêng nội dung đức tin trong GCN Báp-têm.",
  CERT_REASON_REQUIRED: "Nhập lý do thay thế hoặc thu hồi bản.",
  CERT_VERSION_STALE: "Bản nguồn đã có phiên bản mới. Đối soát lịch sử.",
  CERT_NOT_CURRENT: "Bản đã thay thế hoặc thu hồi; không tải/in lại.",
  CERT_RENDER_BUSY: "Đang tạo tài liệu khác. Thử chuẩn bị preview lại sau.",
  CERT_RENDER_TIMEOUT: "Tạo file quá thời hạn. Bản chưa được chốt; kiểm tra lại.",
  CERT_RENDER_FAILED: "Chưa tạo được file. Bản chưa được chốt.",
  ATTENDANCE_REFERENCE_REASON: "Cần lý do thay đổi buổi tham chiếu.",
  ATTENDANCE_REFERENCE_EXISTS:
    "Ngày này đã có buổi tham chiếu. Bỏ chọn buổi cũ có lý do trước khi chọn buổi khác.",
  CERT_SOURCE_TEXT_INVALID:
    "Nguồn có ký tự không hợp lệ cho tài liệu. Đối soát nguồn rồi chuẩn bị preview lại.",
  CERT_PREVIEW_LIMIT:
    "Đã đạt giới hạn preview tạm của Hội Thánh. Chốt bản đang làm hoặc chờ preview hết hạn.",
  CERT_FILE_LIMIT: "Tài liệu vượt giới hạn dung lượng. Bản chưa được chốt.",
  CERT_PAGE_LIMIT: "Tài liệu vượt giới hạn số trang. Kiểm tra nội dung; không cắt bớt dữ kiện.",
  RITE_KIND_IMMUTABLE: "Không đổi loại lễ của bản ghi. Tạo bản ghi đúng loại.",
  RITE_SUBJECT_IMMUTABLE:
    "Bản Báp-têm đã ghi nhận không đổi người. Hủy có đối soát rồi ghi bản đúng.",
  RITE_REASON_REQUIRED: "Nhập lý do thay đổi trạng thái hoặc đính chính.",
  RITE_DATE_INVALID: "Kiểm tra ngày lễ/ngày sinh/ngày qua đời và trạng thái ghi nhận.",
  RITE_MEMBER_REQUIRED: "Thành hôn cần ít nhất một người liên kết hồ sơ Hội Thánh.",
  RITE_SAME_PERSON: "Hai người trong lễ thành hôn phải là hai hồ sơ khác nhau.",
  RITE_BAPTISM_DECISION:
    "Thông tin Báp-têm sau ghi nhận phải khớp ngày/nơi lễ. Chọn cập nhật theo lễ hoặc đính chính trước.",
  RITE_PREVIEW_STALE:
    "Dữ liệu đã thay đổi hoặc chưa xem preview. Tải lại và kiểm tra trước khi xác nhận.",
  RITE_BAPTISM_EXISTS: "Hồ sơ đã có một bản Báp-têm được ghi nhận. Mở bản hiện có để đính chính.",
  PREP_COURSE_STATE: "Khóa không ở trạng thái cho phép thao tác. Tải lại để kiểm tra.",
  PREP_PLAN_LOCKED:
    "Chương trình/ngày khai giảng đã gắn buổi học hoặc đã được sử dụng. Giữ lịch sử và kiểm tra lại.",
  PREP_OPEN_SESSIONS: "Còn buổi đang mở. Chốt các buổi trước khi đóng khóa.",
  PREP_NOT_ELIGIBLE: "Hồ sơ cần là tín hữu dự bị đang sinh hoạt/vắng lâu và chưa Báp-têm.",
  PREP_CONFIRM_UNKNOWN: "Chưa rõ trạng thái Báp-têm. Cần xác nhận và ghi lý do để ghi danh.",
  PREP_ALREADY_ENROLLED: "Học viên đã có ghi danh trong khóa. Mở danh sách để xem hoặc khôi phục.",
  PREP_REGULAR_EXISTS: "Bài đã có buổi chính. Mở buổi hiện có hoặc tạo buổi học bù.",
  PREP_MAKEUP_UNAVAILABLE: "Cần buổi chính đã chốt và ngày học bù không trước buổi chính.",
  PREP_ALREADY_CREDITED: "Học viên đã có bài được xác nhận. Tải lại danh sách cần học bù.",
  PREP_NOT_ENROLLED: "Chỉ chọn học viên đang học trong khóa để học bù.",
  QR_RESOLUTION_STALE: "Kết quả xác minh đã thay đổi hoặc hết hạn. Tải lại buổi và quét lại.",
  QR_NOT_AVAILABLE: "Không thể dùng thẻ cho buổi này. Kiểm tra thẻ và danh sách buổi.",
  CARD_NOT_USABLE: "Thẻ không còn sử dụng được hoặc hồ sơ đã ngừng sinh hoạt. Tải lại để kiểm tra.",
  CARD_ALREADY_ACTIVE: "Hồ sơ đã có thẻ đang hiệu lực. Tải lại hoặc chọn Đổi thẻ.",
  ATTENDANCE_ROSTER_LIMIT:
    "Mỗi buổi tối đa 2.000 dòng danh sách. Không có dữ liệu bị cắt hoặc ghi một phần.",
  ATTENDANCE_PREVIEW_STALE:
    "Danh sách hoặc phiên xem trước đã thay đổi/hết hạn. Xem lại trước khi mở buổi.",
  ATTENDANCE_SESSION_CHANGED: "Buổi đã chốt, mở lại hoặc làm lại. Tải lại trước khi ghi nhận.",
  ATTENDANCE_STATE: "Buổi không ở trạng thái cho phép thao tác. Tải lại để kiểm tra.",
  FILE_LIMIT:
    "File vượt giới hạn dòng, cột, dung lượng hoặc tài nguyên xử lý. Thu hẹp dữ liệu rồi thử lại.",
  FILE_INVALID: "File không đúng định dạng CSV UTF-8 hoặc Excel .xlsx theo mẫu.",
  FILE_HEADERS: "Tên cột trống, trùng hoặc ánh xạ không hợp lệ. Kiểm tra lại file.",
  FILE_DATE: "Ô ngày Excel không hợp lệ hoặc có giờ. Dùng ngày YYYY-MM-DD theo mẫu.",
  FILE_UNSAFE:
    "File chứa công thức, macro, liên kết ngoài hoặc ô không được hỗ trợ. Chuyển thành giá trị trước khi nhập.",
  FILE_BUSY: "Đang xử lý file khác. Thử lại sau.",
  IMPORT_SHEET_REQUIRED: "Chọn sheet dữ liệu để tiếp tục.",
  IMPORT_REVIEW_REQUIRED:
    "Còn dòng lỗi hoặc cần đối chiếu. Sửa hoặc chủ động bỏ qua trước khi xác nhận.",
  IMPORT_PREVIEW_STALE: "Dữ liệu đã thay đổi. Kiểm tra lại phần chưa ghi trước khi tiếp tục.",
  IMPORT_ALREADY_STARTED:
    "Phiên đã ghi dữ liệu; chỉ được đối chiếu phần chưa ghi, không thay file hoặc ánh xạ.",
  UNIT_NOT_AVAILABLE: "Ban hoặc khu vực không khả dụng. Tải lại danh mục để kiểm tra.",
  FAMILY_MERGED: "Hộ đã được gộp. Mở hộ đích để tiếp tục.",
  FAMILY_COMMAND_LIMIT:
    "Mỗi lệnh tối đa100 hồ sơ; không xử lý một phần. Giảm số người được chọn hoặc đối soát trước khi tiếp tục.",
  FAMILY_MEMBER_MISMATCH: "Thành viên hoặc hộ đích không khớp. Tải lại để kiểm tra.",
  FAMILY_REASON_REQUIRED: "Nhập ngày hiệu lực và lý do khi đổi khu vực.",
  NO_CHANGES: "Chưa có thay đổi để lưu.",
  FAMILY_NOT_FOUND: "Không tìm thấy gia đình trong Hội Thánh này.",
  FAMILY_HEAD_EXISTS: "Gia đình đã có chủ hộ hiện hành. Chọn vai trò khác.",
  CAREGIVER_NOT_AVAILABLE: "Người chăm sóc không khả dụng trong Hội Thánh này.",
  ASSIGNMENT_CONTEXT_CHANGED: "Cấu hình hoặc ngày xếp ban đã thay đổi. Tải bản mới trước khi lưu.",
  ASSIGNMENT_CONTEXT_REQUIRED: "Tải cấu hình xếp ban trước khi lưu ngày sinh hoặc ban ngành.",
  NOT_A_VISITOR: "Hồ sơ này không còn là thân hữu. Tải lại để kiểm tra.",
  MEMBER_NOT_CURRENT: "Hồ sơ đã chuyển đi hoặc qua đời. Kiểm tra trạng thái trước khi chuyển loại.",
  SETTINGS_NOT_CONFIGURED: "Hội Thánh chưa thiết lập cấu hình.",
  SETTINGS_ALREADY_CONFIGURED: "Hội Thánh đã được thiết lập. Tải bản hiện tại để tiếp tục.",
  UNIT_NAME_EXISTS: "Tên đã được sử dụng trong nhóm này, kể cả mục đã ngừng sử dụng.",
  SYSTEM_UNIT_IMMUTABLE: "Danh mục hệ thống không cho sửa hoặc ngừng sử dụng.",
  INVALID_CREDENTIALS: "Email hoặc mật khẩu không đúng.",
  TEMP_PASSWORD_EXPIRED: "Mật khẩu tạm đã hết hạn. Liên hệ Dịch vu chăm sóc và hỗ trợ.",
  ACCOUNT_EXISTS: "Email đã có tài khoản trong Hội Thánh này. Mở tài khoản hiện có để quản lý.",
  ACCOUNT_LOCKED: "Tài khoản đang bị khóa. Không thể cấp lại mật khẩu.",
  SCOPE_TARGET_NOT_AVAILABLE: "Chưa có Ban/Khu vực hợp lệ cho phạm vi này.",
  CHURCH_SUSPENDED: "Hội Thánh đang tạm ngưng truy cập.",
  RECENT_AUTH_REQUIRED: "Xác thực lại trước khi cấp lại mật khẩu tạm.",
  REAUTH_REQUIRED: "Vui lòng xác thực lại.",
  SESSION_EXPIRED: "Phiên đã hết hạn. Vui lòng đăng nhập.",
  SESSION_REVOKED: "Phiên không còn hiệu lực. Vui lòng đăng nhập.",
  PASSWORD_CHANGE_REQUIRED: "Vui lòng đổi mật khẩu.",
  VALIDATION_FAILED: "Kiểm tra thông tin đã nhập.",
  RATE_LIMITED: "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.",
  DEPENDENCY_UNAVAILABLE: "Dịch vụ tạm thời không khả dụng. Vui lòng thử lại.",
  CSRF_FAILED: "Phiên xác thực không hợp lệ. Vui lòng tải lại trang.",
  FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
  NOT_FOUND: "Không tìm thấy.",
  PRECONDITION_REQUIRED: "Vui lòng tải lại phiên bản hiện tại trước khi lưu.",
  VERSION_CONFLICT: "Dữ liệu đã thay đổi. Tải lại và kiểm tra trước khi lưu.",
  IDEMPOTENCY_CONFLICT: "Khóa thao tác đã được dùng với nội dung khác.",
  IDEMPOTENCY_EXPIRED:
    "Thao tác đã quá thời hạn thử lại. Đối soát kết quả trước khi tạo thao tác mới.",
  OPERATION_IN_PROGRESS: "Thao tác đang được xử lý. Giữ nguyên và kiểm tra kết quả.",
  INVALID_CURSOR: "Thông tin phân trang không hợp lệ.",
  CURSOR_CONTEXT_MISMATCH: "Bộ lọc hoặc người dùng đã thay đổi. Tìm lại từ đầu.",
  CURSOR_EXPIRED: "Thông tin phân trang đã hết hạn. Tìm lại từ đầu.",
  OUTCOME_UNKNOWN: "Chưa xác định kết quả. Vui lòng kiểm tra lại trước khi thử.",
};
const security = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
};
function cookies(req: Request) {
  const map = new Map<string, string>();
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      const k = part.slice(0, i).trim();
      if (map.has(k)) throw new AppError(400, "INVALID_REQUEST");
      map.set(k, part.slice(i + 1).trim());
    }
  }
  return map;
}
export function createApp(
  identity: Identity,
  conf: Config,
  options: { log?: (row: object) => void; dist?: string } = {},
) {
  const operations = new Operations(identity.db, identity.now);
  const auditReader = new AuditReader(identity.db, conf.csrfKey, identity.now);
  const tenancy = new Tenancy(
    identity.db,
    operations,
    identity.audit,
    (ids) => identity.activeAccountCounts(ids),
    conf.csrfKey,
    (id, tx) => identity.suspendChurchSessions(id, tx),
    identity.now,
  );
  const access = tenancy.access();
  const churchIdentity = new ChurchIdentity(identity, access);
  const organization = new Organization(
    identity.db,
    operations,
    identity.audit,
    conf.csrfKey,
    identity.now,
  );
  const accounts = new Accounts(
    identity.db,
    access,
    operations,
    identity.audit,
    identity.rate,
    conf.csrfKey,
    identity.now,
    organization,
  );
  const families = new Families(identity.db, identity.now, identity.audit);
  const reports = new AttendanceReporting(identity.db, identity.now);
  const members = new Members(
    identity.db,
    operations,
    identity.audit,
    families,
    organization,
    conf.csrfKey,
    identity.now,
  );
  members.bindAttendanceReports(reports);
  const exchange = new DataExchange(
    identity.db,
    operations,
    identity.audit,
    members.exchangePort(conf.csrfKey),
    conf.csrfKey,
    identity.now,
  );
  const organizationRuntime = new OrganizationRuntime(
    identity.db,
    members.organizationPort(conf.csrfKey),
    families,
    operations,
    identity.audit,
    conf.csrfKey,
    identity.now,
    reports,
  );
  const familyApp = new FamilyApplication(
    families,
    members.familyPort(conf.csrfKey),
    operations,
    organization,
    conf.csrfKey,
    identity.now,
  );
  const cards = new Cards(
    identity.db,
    members.cardPort(),
    tenancy,
    operations,
    identity.audit,
    conf.csrfKey,
    identity.now,
  );
  const attendance = new Attendance(
    identity.db,
    members.attendancePort(),
    organization,
    operations,
    identity.audit,
    conf.csrfKey,
    identity.now,
    cards,
    new PrepAttendanceSource(identity.db, members.attendancePort()),
  );
  const prepClasses = new PrepClasses(
    identity.db,
    members.prepPort(),
    members.attendancePort(),
    organization,
    attendance,
    operations,
    identity.audit,
    conf.csrfKey,
    identity.now,
  );
  const rites = new Rites(
    identity.db,
    members.ritesPort(),
    operations,
    identity.audit,
    conf.csrfKey,
    identity.now,
  );
  members.bindBaptismLedger(rites.baptismChanged);
  const certificates = new Certificates(
    identity.db,
    new CertificateSources(
      members.ritesPort(),
      rites.certificatePort(),
      prepClasses.certificatePort(),
      tenancy,
      identity.now,
    ),
    operations,
    identity.audit,
    conf.csrfKey,
    identity.now,
  );
  const overview = new Overview(
    identity.db,
    tenancy,
    members.overviewPort(conf.csrfKey),
    organization,
    organizationRuntime,
    identity.now,
    reports,
    new RiteReporting(identity.db),
    new PrepReporting(identity.db),
  );
  const log = options.log ?? ((row) => console.info(JSON.stringify(row)));
  return async function handle(req: Request, info: RequestInfo): Promise<Response> {
    const started = performance.now(),
      requestId = crypto.randomUUID();
    let route = "unmatched",
      response: Response;
    let actorId: ObjectId | undefined;
    let requestRealm: Realm = "owner",
      actorChurchId: ObjectId | null = null,
      targetChurchId: ObjectId | null = null,
      targetAccountId: ObjectId | undefined,
      printing = false,
      printingCertificate = false;
    const headers = new Headers({
      ...security,
      "X-Request-Id": requestId,
      Date: new Date().toUTCString(),
    });
    const json = (data: unknown, status = 200, meta: Record<string, unknown> = {}) =>
      Response.json({ data, meta: { requestId, ...meta } }, { status, headers });
    const setSession = (result: SessionResult) => {
      headers.append(
        "Set-Cookie",
        cookie(
          cookieName(result.session.realm, result.session.kind === "bootstrap"),
          result.token,
          (result.session.absoluteExpiresAt.getTime() - identity.now().getTime()) / 1000,
        ),
      );
    };
    const clear = (realm: Realm, bootstrap = false) =>
      headers.append("Set-Cookie", cookie(cookieName(realm, bootstrap), "", 0));
    try {
      const url = new URL(req.url),
        path = url.pathname;
      requireCondition(url.origin === conf.origin, 400, "INVALID_REQUEST");
      if (path === "/api/health/live" && req.method === "GET") {
        route = "health.live";
        response = json({ status: "alive" });
      } else if (path === "/api/health/ready" && req.method === "GET") {
        route = "health.ready";
        await identity.db.ready();
        await identity.rate.ready();
        response = json({ status: "ready" });
      } else if (path.startsWith("/api/")) {
        const jar = cookies(req),
          ownerToken = jar.get(cookieName("owner")),
          churchToken = jar.get(cookieName("church"));
        if (path === "/api/v1/auth/csrf" && req.method === "GET") {
          route = "F01";
          const realm = url.searchParams.get("realm");
          requireCondition(realm === "owner" || realm === "church", 400, "INVALID_REQUEST");
          requestRealm = realm;
          const result =
            realm === "church"
              ? await churchIdentity.bootstrap(churchToken, jar.get(cookieName("church", true)))
              : await identity.bootstrap(realm, ownerToken, jar.get(cookieName(realm, true)));
          setSession(result);
          response = json({
            csrfToken: result.csrfToken,
            expiresAt: result.session.absoluteExpiresAt,
          });
        } else if (path === "/api/v1/owner/audit-events") {
          route = "F23";
          requireCondition(req.method === "GET", 405, "METHOD_NOT_ALLOWED");
          const ctx = await identity.authorize(ownerToken, "owner", false, true);
          actorId = ctx.owner._id;
          const grant = identity.ownerGrant(ctx, "audit:read");
          response = json(await auditReader.list(grant, url.searchParams));
        } else if (/^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/overview$/.test(path)) {
          requireCondition(req.method === "GET", 405, "METHOD_NOT_ALLOWED");
          requireCondition(!url.search, 400, "INVALID_REQUEST");
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            churchId = objectId(parts[isOwner ? 5 : 4] as string);
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          route = `P26.${requestRealm}.overview`;
          let grant: TenantGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true),
              auth = identity.ownerGrant(ctx, "overview:read");
            actorId = ctx.owner._id;
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: false,
              canReadAttendance: true,
              policyContext: `${policyVersion}:owner`,
              fence: async (tx) => {
                await auth.fence(tx);
                await access.fence(churchId, tx, true);
              },
            };
          } else {
            const ctx = await churchIdentity.authorize(churchToken, false, false);
            actorId = ctx.account._id;
            actorChurchId = ctx.account.churchId;
            requireCondition(churchId.equals(actorChurchId), 403, "FORBIDDEN");
            const auth = churchIdentity.grant(ctx);
            auth.require("overview:read");
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: false,
              canReadAttendance: ["pastor", "secretary", "ministry_lead"].includes(
                ctx.account.role,
              ),
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          response = json(await overview.get(grant));
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/data-exchange(?:\/[^/]+){1,3}$/.test(path)
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            section = parts[6 + offset],
            id = parts[7 + offset],
            action = parts[8 + offset];
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          const exporting = section === "exports",
            capability = exporting ? "data:export" : "data:import";
          let grant: TenantGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true),
              auth = identity.ownerGrant(ctx, capability);
            actorId = ctx.owner._id;
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: true,
              policyContext: `${policyVersion}:owner`,
              fence: async (tx) => {
                await auth.fence(tx);
                await access.fence(churchId, tx, true);
              },
            };
          } else {
            const ctx = await churchIdentity.authorize(churchToken, false, false);
            actorId = ctx.account._id;
            actorChurchId = ctx.account.churchId;
            requireCondition(churchId.equals(actorChurchId), 403, "FORBIDDEN");
            const auth = churchIdentity.grant(ctx);
            auth.require(capability);
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: ["pastor", "secretary", "ministry_lead"].includes(
                ctx.account.role,
              ),
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          route = `P25.${requestRealm}.${section}.${action ?? (id ? "detail" : "root")}.${req.method}`;
          const binary = (
            bytes: Uint8Array,
            format: "csv" | "xlsx",
            name: string,
            hash?: string,
          ) => {
            headers.set(
              "Content-Type",
              format === "csv"
                ? "text/csv; charset=utf-8"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            );
            headers.set("Content-Disposition", `attachment; filename="${name}.${format}"`);
            if (hash) headers.set("X-File-Digest", hash);
            return new Response(bytes as BodyInit, { headers });
          };
          if (req.method !== "GET") {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
          }
          const key = req.headers.get("idempotency-key"),
            match = req.headers.get("if-match");
          if (req.method === "GET" && section === "templates" && !id) {
            requireCondition(
              [...url.searchParams.keys()].every((k) => k === "format") &&
                url.searchParams.getAll("format").length <= 1,
              400,
              "INVALID_REQUEST",
            );
            const format = url.searchParams.get("format") ?? "csv";
            requireCondition(format === "csv" || format === "xlsx", 400, "INVALID_REQUEST");
            await identity.db.transaction(async (tx) => grant.fence(tx));
            const file = await exchange.template(format);
            response = binary(file.bytes, format, "church-members-template");
          } else if (req.method === "GET" && section === "operations" && id && !action) {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            response = json(await operations.getTenant(grant, id, "exchange"));
          } else if (section === "imports") {
            if (req.method === "POST" && !id) {
              const format = req.headers.get("x-file-format");
              requireCondition(format === "csv" || format === "xlsx", 415, "FILE_INVALID");
              const source = decodeURIComponent(req.headers.get("x-import-source") ?? "");
              const bytes = await readFileBody(req, limits.fileBytes),
                r = await exchange.stage(grant, source, format, bytes, key, requestId);
              response = json(r.data, r.status, { replayed: r.replayed });
            } else if (req.method === "GET" && !id)
              response = json(await exchange.list(grant, url.searchParams));
            else if (req.method === "GET" && id && !action) {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              response = json(await exchange.get(grant, id));
            } else if (req.method === "GET" && id && action === "rows")
              response = json(await exchange.rows(grant, id, url.searchParams));
            else if (req.method === "GET" && id && action === "reconciliation") {
              const format = url.searchParams.get("format") ?? "csv";
              requireCondition(
                (format === "csv" || format === "xlsx") &&
                  [...url.searchParams.keys()].every((k) => k === "format") &&
                  url.searchParams.getAll("format").length <= 1,
                400,
                "INVALID_REQUEST",
              );
              const file = await exchange.reconciliation(grant, id, format);
              response = binary(file.bytes, format, "church-import-reconciliation");
            } else if (
              id &&
              ((req.method === "PATCH" && !action) ||
                (req.method === "POST" && (action === "prepare" || action === "batches")))
            ) {
              const body = await readJson(req),
                r = !action
                  ? await exchange.patch(grant, id, body, key, match, requestId)
                  : action === "prepare"
                    ? await exchange.prepare(grant, id, key, match, requestId)
                    : await exchange.batch(grant, id, body, key, match, requestId);
              response = json(r.data, r.status, { replayed: r.replayed });
            } else throw new AppError(405, "METHOD_NOT_ALLOWED");
          } else if (section === "exports") {
            if (req.method === "POST" && id === "preview" && !action)
              response = json(await exchange.previewExport(grant, await readJson(req)));
            else if (req.method === "POST" && !id) {
              const r = await exchange.createExport(grant, await readJson(req), key, requestId);
              response = json(r.data, r.status, { replayed: r.replayed });
            } else if (req.method === "GET" && id && action === "download") {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              const f = await exchange.download(grant, id);
              response = binary(f.bytes, f.format, "church-members", f.meta.digest);
            } else throw new AppError(405, "METHOD_NOT_ALLOWED");
          } else throw new AppError(404, "NOT_FOUND");
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/families(?:\/(?:operations\/[^/]+|[^/]+(?:\/(?:members|history|roles|preview|transfers|splits|merges))?))?$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            tail = parts[6 + offset],
            action = parts[7 + offset];
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          const methods =
            tail === "operations" || action === "history" || action === "members"
              ? ["GET"]
              : action
                ? [action === "roles" ? "PATCH" : "POST"]
                : tail
                  ? ["GET", "PATCH"]
                  : ["GET", "POST"];
          requireCondition(methods.includes(req.method), 405, "METHOD_NOT_ALLOWED");
          route = `P23.${requestRealm}.${action ?? (tail ? "detail" : "root")}.${req.method}`;
          const manage = req.method !== "GET" || tail === "operations",
            capability = manage ? "families:manage" : "families:read";
          let grant: TenantGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true);
            actorId = ctx.owner._id;
            const auth = identity.ownerGrant(ctx, capability);
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: true,
              policyContext: `${policyVersion}:owner`,
              fence: async (tx) => {
                await auth.fence(tx);
                await access.fence(churchId, tx, true);
              },
            };
          } else {
            const ctx = await churchIdentity.authorize(churchToken, false, false);
            actorId = ctx.account._id;
            actorChurchId = ctx.account.churchId;
            requireCondition(churchId.equals(ctx.account.churchId), 403, "FORBIDDEN");
            const auth = churchIdentity.grant(ctx);
            auth.require(capability);
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: ["pastor", "secretary"].includes(ctx.account.role),
              canReadAttendance: ["pastor", "secretary", "ministry_lead"].includes(
                ctx.account.role,
              ),
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          const church = await access.byId(churchId);
          requireCondition(church, 404, "NOT_FOUND");
          requireCondition(church.status === "active", 403, "CHURCH_SUSPENDED");
          if (req.method === "GET") {
            if (tail === "operations") {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              response = json(await operations.getTenant(grant, action as string, "families"));
            } else if (action === "members")
              response = json(await familyApp.members(grant, tail as string, url.searchParams));
            else if (action === "history")
              response = json(await familyApp.history(grant, tail as string, url.searchParams));
            else if (tail) {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              const f = await familyApp.get(grant, tail);
              headers.set("ETag", `"${f.version}"`);
              response = json(f);
            } else
              response = json(
                url.searchParams.has("view")
                  ? await familyApp.list(grant, url.searchParams)
                  : await members.familyPicker(grant, url.searchParams),
              );
          } else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
            const body = await readJson(req),
              key = req.headers.get("idempotency-key"),
              match = req.headers.get("if-match");
            if (action === "preview")
              response = json(await familyApp.preview(grant, tail as string, body, match));
            else {
              const result = !tail
                ? await familyApp.create(grant, body, key, requestId)
                : !action
                  ? await familyApp.patch(grant, tail, body, key, match, requestId)
                  : await familyApp.command(
                      grant,
                      tail,
                      body,
                      (
                        {
                          roles: "roles",
                          transfers: "transfer",
                          splits: "split",
                          merges: "merge",
                        } as const
                      )[action as "roles" | "transfers" | "splits" | "merges"],
                      key,
                      match,
                      requestId,
                    );
              headers.set("ETag", `"${(result.data.family as { version: number }).version}"`);
              response = json(result.data, result.status, { replayed: result.replayed });
            }
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/(?:members(?:\/(?:summary|options|operations\/[^/]+|[^/]+(?:\/(?:history|visitor-stage|conversion|participation))?))?)$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            section = parts[5 + offset],
            tail = parts[6 + offset],
            action = parts[7 + offset];
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          const reserved = tail === "summary" || tail === "options" || tail === "operations";
          const methods =
            section === "families" || reserved || action === "history"
              ? ["GET"]
              : action
                ? [action === "conversion" ? "POST" : "PATCH"]
                : tail
                  ? ["GET", "PATCH"]
                  : ["GET", "POST"];
          requireCondition(methods.includes(req.method), 405, "METHOD_NOT_ALLOWED");
          route = `P22.${requestRealm}.${section}.${tail && reserved ? tail : tail ? (action ?? "detail") : "root"}.${req.method}`;
          const manage = req.method !== "GET" || tail === "operations";
          let grant: TenantGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true);
            actorId = ctx.owner._id;
            const auth = identity.ownerGrant(ctx, manage ? "members:manage" : "members:read");
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: true,
              policyContext: `${policyVersion}:owner`,
              fence: async (tx) => {
                await auth.fence(tx);
                await access.fence(churchId, tx, true);
              },
            };
          } else {
            const ctx = await churchIdentity.authorize(churchToken, false, false);
            actorId = ctx.account._id;
            actorChurchId = ctx.account.churchId;
            requireCondition(churchId.equals(ctx.account.churchId), 403, "FORBIDDEN");
            const auth = churchIdentity.grant(ctx);
            auth.require(manage ? "members:manage" : "members:read");
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: ["pastor", "secretary"].includes(ctx.account.role),
              canReadAttendance: ["pastor", "secretary", "ministry_lead"].includes(
                ctx.account.role,
              ),
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          const church = await access.byId(churchId);
          requireCondition(church, 404, "NOT_FOUND");
          requireCondition(church.status === "active", 403, "CHURCH_SUSPENDED");
          if (req.method === "GET") {
            if (section === "families")
              response = json(await members.familyPicker(grant, url.searchParams));
            else if (tail === "options")
              response = json(await members.options(grant, url.searchParams));
            else if (tail === "summary")
              response = json(await members.summary(grant, url.searchParams));
            else if (tail === "operations") {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              response = json(await operations.getTenant(grant, action as string, "members"));
            } else if (action === "history")
              response = json(await members.history(grant, tail as string, url.searchParams));
            else if (tail) {
              const m = await members.get(grant, tail, url.searchParams);
              headers.set("ETag", `"${m.version}"`);
              response = json(m);
            } else response = json(await members.list(grant, url.searchParams));
          } else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
            const body = await readJson(req),
              key = req.headers.get("idempotency-key");
            const result = tail
              ? await members.mutate(
                  grant,
                  tail,
                  (action ?? "profile") as
                    | "profile"
                    | "visitor-stage"
                    | "conversion"
                    | "participation",
                  body,
                  key,
                  req.headers.get("if-match"),
                  requestId,
                )
              : await members.create(grant, body, key, requestId);
            headers.set("ETag", `"${(result.data.member as { version: number }).version}"`);
            response = json(result.data, result.status, { replayed: result.replayed });
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/(?:members\/[^/]+\/certificates|certificates\/(?:operations\/[^/]+|drafts(?:\/[^/]+(?:\/(?:prepare|issue|history))?)?|editions(?:\/[^/]+(?:\/(?:revise|revoke|print|print-script|files\/(?:pdf|docx)))?)?))$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            memberRead = parts[5 + offset] === "members",
            section = parts[6 + offset],
            id = parts[7 + offset],
            action = parts[8 + offset],
            format = parts[9 + offset];
          const methods =
            memberRead ||
            section === "operations" ||
            action === "history" ||
            action === "files" ||
            action === "print" ||
            action === "print-script"
              ? ["GET"]
              : action
                ? ["POST"]
                : section === "drafts"
                  ? id
                    ? ["GET", "PATCH"]
                    : ["GET", "POST"]
                  : ["GET"];
          requireCondition(methods.includes(req.method), 405, "METHOD_NOT_ALLOWED");
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          printing = action === "print";
          printingCertificate = printing;
          const writing = req.method !== "GET",
            capability =
              writing || section === "operations" ? "certificates:manage" : "certificates:read";
          route = `P35.${requestRealm}.${section}.${action ?? "root"}.${req.method}`;
          let grant: CertificateGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true);
            actorId = ctx.owner._id;
            const auth = identity.ownerGrant(ctx, capability);
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: true,
              canManageCertificates: true,
              policyContext: `${policyVersion}:owner`,
              fence: async (tx) => {
                await auth.fence(tx);
                await access.fence(churchId, tx, true);
              },
            };
          } else {
            const ctx = await churchIdentity.authorize(churchToken, false, false);
            actorId = ctx.account._id;
            actorChurchId = ctx.account.churchId;
            requireCondition(churchId.equals(ctx.account.churchId), 404, "NOT_FOUND");
            const auth = churchIdentity.grant(ctx);
            auth.require(capability);
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: ["pastor", "secretary", "ministry_lead"].includes(
                ctx.account.role,
              ),
              canManageCertificates:
                ctx.account.role === "pastor" || ctx.account.role === "secretary",
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          if (writing) {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
            const body = await readJson(req, 32768),
              key = req.headers.get("idempotency-key"),
              match = req.headers.get("if-match");
            if (action === "prepare") {
              requireCondition(
                body &&
                  typeof body === "object" &&
                  !Array.isArray(body) &&
                  Object.keys(body).length === 0,
                422,
                "VALIDATION_FAILED",
              );
              response = json(await certificates.prepare(grant, id as string, match));
            } else {
              const result =
                section === "editions"
                  ? action === "revise"
                    ? await certificates.revise(grant, id as string, body, key, match, requestId)
                    : await certificates.revoke(grant, id as string, body, key, match, requestId)
                  : action === "issue"
                    ? await certificates.issue(grant, id as string, body, key, match, requestId)
                    : await certificates.saveDraft(grant, id ?? null, body, key, match, requestId);
              response = json(result.data, result.status, { replayed: result.replayed });
            }
          } else if (memberRead)
            response = json(
              await certificates.list(grant, url.searchParams, parts[6 + offset] as string),
            );
          else if (section === "operations") {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            response = json(await certificates.operation(grant, id as string));
          } else if (action === "history")
            response = json(await certificates.historyPage(grant, id as string, url.searchParams));
          else if (action === "files" || action === "print" || action === "print-script") {
            requireCondition(
              [...url.searchParams.keys()].every((k) => k === "version") &&
                url.searchParams.getAll("version").length === 1,
              400,
              "INVALID_REQUEST",
            );
            const v = url.searchParams.get("version");
            requireCondition(
              v && /^[1-9][0-9]*$/.test(v) && Number.isSafeInteger(Number(v)),
              400,
              "INVALID_REQUEST",
            );
            if (action === "files") {
              const file = await certificates.file(
                grant,
                id as string,
                format as "pdf" | "docx",
                Number(v),
                requestId,
              );
              response = new Response(new Uint8Array(file.bytes), {
                headers: {
                  ...security,
                  "Content-Type":
                    format === "pdf"
                      ? "application/pdf"
                      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  "Content-Disposition": `attachment; filename="${file.filename}"`,
                  ETag: `"${file.hash}"`,
                },
              });
            } else {
              const e = await certificates.printable(grant, id as string, Number(v));
              if (action === "print-script")
                response = new Response(certificatePrintScript, {
                  headers: { ...security, "Content-Type": "application/javascript" },
                });
              else {
                const files = await Array.fromAsync(
                  new Bun.Glob("*.css").scan({ cwd: resolve("dist/assets") }),
                );
                response = new Response(
                  printCertificate(
                    e.snapshot.content,
                    e.pages,
                    files.map((n) => `/assets/${n}`),
                    `${path}-script?version=${e.version}`,
                  ),
                  { headers: { ...security, "Content-Type": "text/html; charset=utf-8" } },
                );
              }
            }
          } else if (section === "drafts")
            response = json(
              id
                ? await certificates.getDraft(grant, id)
                : await certificates.draftList(grant, url.searchParams),
            );
          else if (id) {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            response = json(await certificates.getEdition(grant, id));
          } else response = json(await certificates.list(grant, url.searchParams));
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/(?:members\/[^/]+\/rites|rites\/(?:people|baptism-facts|operations\/[^/]+|records(?:\/preview|\/[^/]+(?:\/(?:history|preview))?)?))$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            memberRead = parts[5 + offset] === "members",
            section = parts[6 + offset],
            recordId =
              section === "records" && parts[7 + offset] !== "preview"
                ? parts[7 + offset]
                : undefined,
            preview =
              section === "records" &&
              (parts[7 + offset] === "preview" || parts[8 + offset] === "preview"),
            history = parts[8 + offset] === "history";
          const methods =
            memberRead || section !== "records" || history
              ? ["GET"]
              : preview
                ? ["POST"]
                : recordId
                  ? ["GET", "PATCH"]
                  : ["GET", "POST"];
          requireCondition(methods.includes(req.method), 405, "METHOD_NOT_ALLOWED");
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          const writing = req.method !== "GET",
            capability = writing || section === "operations" ? "rites:manage" : "rites:read";
          route = `P34.${requestRealm}.${section}.${preview ? "preview" : history ? "history" : "root"}.${req.method}`;
          let grant: RiteGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true);
            actorId = ctx.owner._id;
            const auth = identity.ownerGrant(ctx, capability);
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: true,
              canManageRites: true,
              policyContext: `${policyVersion}:owner`,
              fence: async (tx) => {
                await auth.fence(tx);
                await access.fence(churchId, tx, true);
              },
            };
          } else {
            const ctx = await churchIdentity.authorize(churchToken, false, false);
            actorId = ctx.account._id;
            actorChurchId = ctx.account.churchId;
            requireCondition(churchId.equals(ctx.account.churchId), 404, "NOT_FOUND");
            const auth = churchIdentity.grant(ctx);
            auth.require(capability);
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: ["pastor", "secretary", "ministry_lead"].includes(
                ctx.account.role,
              ),
              canManageRites: ctx.account.role === "pastor" || ctx.account.role === "secretary",
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          if (!writing) {
            if (memberRead)
              response = json(
                await rites.list(grant, url.searchParams, parts[6 + offset] as string),
              );
            else if (section === "people" || section === "baptism-facts")
              response = json(
                await rites.peoplePage(grant, url.searchParams, section === "baptism-facts"),
              );
            else if (section === "operations") {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              response = json(await rites.operation(grant, parts[7 + offset] as string));
            } else if (history)
              response = json(await rites.historyPage(grant, recordId as string, url.searchParams));
            else if (recordId) {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              const data = await rites.get(grant, recordId);
              headers.set("ETag", `"${data.version}"`);
              response = json(data);
            } else response = json(await rites.list(grant, url.searchParams));
          } else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
            const body = await readJson(req, 131072),
              match = req.headers.get("if-match");
            if (preview) response = json(await rites.preview(grant, recordId ?? null, body, match));
            else {
              const r = await rites.save(
                grant,
                recordId ?? null,
                body,
                req.headers.get("idempotency-key"),
                match,
                requestId,
              );
              response = json(r.data, r.status, { replayed: r.replayed });
            }
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/(?:members\/[^/]+\/prep-classes|prep-classes\/(?:operations\/[^/]+|courses(?:\/[^/]+(?:\/(?:activate|close|reopen|candidates|history|meetings|enrollments(?:\/[^/]+\/(?:state|interview))?))?)?))$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            memberRead = parts[5 + offset] === "members",
            section = parts[6 + offset],
            id = parts[7 + offset],
            action = parts[8 + offset],
            memberId = parts[9 + offset],
            detail = parts[10 + offset];
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          const methods =
            memberRead ||
            section === "operations" ||
            ["candidates", "history"].includes(action ?? "")
              ? ["GET"]
              : detail
                ? ["POST"]
                : action
                  ? action === "enrollments" || action === "meetings"
                    ? ["GET", "POST"]
                    : ["POST"]
                  : id
                    ? ["GET", "PATCH"]
                    : ["GET", "POST"];
          requireCondition(methods.includes(req.method), 405, "METHOD_NOT_ALLOWED");
          const writing = req.method !== "GET",
            capability = writing
              ? detail === "interview"
                ? "classes:interview"
                : "classes:manage"
              : "classes:read";
          route = `P33.${requestRealm}.${section}.${action ?? "root"}.${detail ?? "root"}.${req.method}`;
          let grant: ClassGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true);
            actorId = ctx.owner._id;
            const auth = identity.ownerGrant(ctx, capability);
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: true,
              canManageClasses: true,
              canInterview: true,
              policyContext: `${policyVersion}:owner`,
              fence: async (tx) => {
                await auth.fence(tx);
                await access.fence(churchId, tx, true);
              },
            };
          } else {
            const ctx = await churchIdentity.authorize(churchToken, false, false);
            actorId = ctx.account._id;
            actorChurchId = ctx.account.churchId;
            requireCondition(churchId.equals(ctx.account.churchId), 404, "NOT_FOUND");
            const auth = churchIdentity.grant(ctx);
            auth.require(capability);
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: ["pastor", "secretary", "ministry_lead"].includes(
                ctx.account.role,
              ),
              canManageClasses: ctx.account.role === "pastor" || ctx.account.role === "secretary",
              canInterview: ctx.account.role === "pastor",
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          if (!writing) {
            if (memberRead)
              response = json(
                await prepClasses.memberCourses(
                  grant,
                  parts[6 + offset] as string,
                  url.searchParams,
                ),
              );
            else if (section === "operations") {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              response = json(await prepClasses.operation(grant, id as string));
            } else if (action === "candidates")
              response = json(await prepClasses.candidates(grant, id as string, url.searchParams));
            else if (action === "enrollments")
              response = json(
                await prepClasses.enrollmentPage(grant, id as string, url.searchParams),
              );
            else if (action === "meetings")
              response = json(await prepClasses.meetingPage(grant, id as string, url.searchParams));
            else if (action === "history")
              response = json(await prepClasses.historyPage(grant, id as string, url.searchParams));
            else if (id) {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              const data = await prepClasses.get(grant, id);
              headers.set("ETag", `"${data.version}"`);
              response = json(data);
            } else response = json(await prepClasses.list(grant, url.searchParams));
          } else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
            const body = await readJson(req, 196608),
              key = req.headers.get("idempotency-key"),
              match = req.headers.get("if-match");
            const result =
              detail === "interview"
                ? await prepClasses.interview(
                    grant,
                    id as string,
                    memberId as string,
                    body,
                    key,
                    match,
                    requestId,
                  )
                : detail === "state"
                  ? await prepClasses.changeEnrollment(
                      grant,
                      id as string,
                      memberId as string,
                      body,
                      key,
                      match,
                      requestId,
                    )
                  : action === "enrollments"
                    ? await prepClasses.enroll(grant, id as string, body, key, requestId)
                    : action === "meetings"
                      ? await prepClasses.meeting(grant, id as string, body, key, requestId)
                      : action
                        ? await prepClasses.transition(
                            grant,
                            id as string,
                            action as "activate" | "close" | "reopen",
                            body,
                            key,
                            match,
                            requestId,
                          )
                        : id
                          ? await prepClasses.patch(grant, id, body, key, match, requestId)
                          : await prepClasses.create(grant, body, key, requestId);
            response = json(result.data, result.status, { replayed: result.replayed });
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/(?:members\/[^/]+\/(?:card|cards)|cards\/(?:operations\/[^/]+|[^/]+\/(?:render|print|print-script|history|replace|revoke)))$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            section = parts[5 + offset],
            id = parts[6 + offset],
            action = parts[7 + offset];
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          printing = action === "print";
          const writing = action === "cards" || action === "replace" || action === "revoke";
          requireCondition(req.method === (writing ? "POST" : "GET"), 405, "METHOD_NOT_ALLOWED");
          route = `P32.${requestRealm}.cards.${action}.${req.method}`;
          let grant: CardGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true);
            actorId = ctx.owner._id;
            const auth = identity.ownerGrant(ctx, writing ? "cards:manage" : "cards:read");
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: true,
              canManageCards: true,
              policyContext: `${policyVersion}:owner`,
              fence: async (tx) => {
                await auth.fence(tx);
                await access.fence(churchId, tx, true);
              },
            };
          } else {
            const ctx = await churchIdentity.authorize(churchToken, false, false);
            actorId = ctx.account._id;
            actorChurchId = ctx.account.churchId;
            requireCondition(churchId.equals(ctx.account.churchId), 404, "NOT_FOUND");
            const auth = churchIdentity.grant(ctx);
            auth.require(writing ? "cards:manage" : "cards:read");
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: ["pastor", "secretary", "ministry_lead"].includes(
                ctx.account.role,
              ),
              canManageCards: ctx.account.role === "pastor" || ctx.account.role === "secretary",
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          if (writing) {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
            const body = await readJson(req),
              key = req.headers.get("idempotency-key");
            const result =
              section === "members"
                ? await cards.issue(grant, id as string, body, key, requestId)
                : await cards.change(
                    grant,
                    id as string,
                    action as "replace" | "revoke",
                    body,
                    key,
                    req.headers.get("if-match"),
                    requestId,
                  );
            response = json(result.data, result.status, { replayed: result.replayed });
          } else if (action === "history")
            response = json(await cards.historyPage(grant, id as string, url.searchParams));
          else if (id === "operations") {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            response = json(await cards.operation(grant, action as string));
          } else if (section === "members") {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            response = json(await cards.current(grant, id as string));
          } else {
            requireCondition(
              [...url.searchParams.keys()].every((k) => k === "version") &&
                url.searchParams.getAll("version").length <= 1,
              400,
              "INVALID_REQUEST",
            );
            const v = url.searchParams.get("version"),
              expected = v ? Number(v) : undefined;
            requireCondition(
              v === null || (/^[1-9][0-9]*$/.test(v) && Number.isSafeInteger(expected)),
              400,
              "INVALID_REQUEST",
            );
            const render = await cards.render(grant, id as string, expected);
            if (action === "render") response = json(render);
            else if (action === "print-script")
              response = new Response(printScript, {
                headers: {
                  ...Object.fromEntries(headers),
                  "Content-Type": "text/javascript; charset=utf-8",
                },
              });
            else {
              const index = await Bun.file(`${resolve(options.dist ?? "dist")}/index.html`).text();
              const css = Array.from(
                index.matchAll(/href="(\/assets\/[A-Za-z0-9._-]+\.css)"/g),
                (m) => m[1] as string,
              );
              requireCondition(css.length, 503, "DEPENDENCY_UNAVAILABLE");
              response = new Response(
                printDocument(render, css, `${path}-script?version=${render.card.version}`),
                {
                  headers: {
                    ...Object.fromEntries(headers),
                    "Content-Type": "text/html; charset=utf-8",
                  },
                },
              );
            }
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/attendance\/(?:sessions(?:\/[^/]+(?:\/(?:candidates|participants(?:\/[^/]+)?|roster-changes|history|open|close|reopen|reset|qr-resolutions|scans))?)?|operations\/[^/]+)$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            section = parts[6 + offset],
            id = parts[7 + offset],
            action = parts[8 + offset],
            memberId = parts[9 + offset];
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          const marking = action === "participants" && !!memberId,
            scanning = action === "qr-resolutions" || action === "scans";
          const methods =
            section === "operations" ||
            action === "candidates" ||
            action === "history" ||
            (action === "participants" && !memberId)
              ? ["GET"]
              : marking
                ? ["PATCH"]
                : action
                  ? ["POST"]
                  : id
                    ? ["GET", "PATCH"]
                    : ["GET", "POST"];
          requireCondition(methods.includes(req.method), 405, "METHOD_NOT_ALLOWED");
          const writing = req.method !== "GET",
            manager = writing
              ? !marking && !scanning
              : action === "candidates" || action === "history";
          const capability = scanning
            ? "attendance:scan"
            : manager
              ? "attendance:manage"
              : writing
                ? "attendance:mark"
                : "attendance:read";
          route = `P31.${isOwner ? "owner" : "church"}.${section}.${action ?? "root"}.${req.method}`;
          let grant: AttendanceGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true);
            actorId = ctx.owner._id;
            const auth = identity.ownerGrant(ctx, capability);
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: true,
              canManageAttendance: true,
              canReadClasses: true,
              canManageClasses: true,
              policyContext: `${policyVersion}:owner`,
              fence: async (tx) => {
                await auth.fence(tx);
                await access.fence(churchId, tx, true);
              },
            };
          } else {
            const ctx = await churchIdentity.authorize(churchToken, false, false);
            actorId = ctx.account._id;
            actorChurchId = ctx.account.churchId;
            requireCondition(churchId.equals(ctx.account.churchId), 404, "NOT_FOUND");
            const auth = churchIdentity.grant(ctx);
            auth.require(capability);
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: ["pastor", "secretary", "ministry_lead"].includes(
                ctx.account.role,
              ),
              canManageAttendance:
                ctx.account.role === "pastor" || ctx.account.role === "secretary",
              canReadClasses: ctx.account.role === "pastor" || ctx.account.role === "secretary",
              canManageClasses: ctx.account.role === "pastor" || ctx.account.role === "secretary",
              ...(ctx.account.scope.kind === "assigned_units"
                ? { unitScope: ctx.account.scope.unitIds }
                : {}),
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          if (!writing) {
            if (section === "operations") {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              response = json(await attendance.operation(grant, id as string));
            } else if (action === "candidates")
              response = json(await attendance.candidates(grant, id as string, url.searchParams));
            else if (action === "participants")
              response = json(await attendance.roster(grant, id as string, url.searchParams));
            else if (action === "history")
              response = json(await attendance.historyPage(grant, id as string, url.searchParams));
            else if (id) {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              const data = await attendance.get(grant, id);
              headers.set("ETag", `"${data.version}"`);
              response = json(data);
            } else response = json(await attendance.list(grant, url.searchParams));
          } else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
            const body = await readJson(req),
              key = req.headers.get("idempotency-key"),
              match = req.headers.get("if-match");
            if (action === "qr-resolutions") {
              await identity.rate.qrResolution(
                churchId.toHexString(),
                grant.actorKind,
                grant.actorId.toHexString(),
              );
              response = json(await attendance.qrResolution(grant, id as string, body));
            } else {
              const result =
                action === "scans"
                  ? await attendance.scan(grant, id as string, body, key, match, requestId)
                  : marking
                    ? await attendance.mark(
                        grant,
                        id as string,
                        memberId as string,
                        body,
                        key,
                        match,
                        requestId,
                      )
                    : action === "roster-changes"
                      ? await attendance.changeRoster(
                          grant,
                          id as string,
                          body,
                          key,
                          match,
                          requestId,
                        )
                      : action
                        ? await attendance.transition(
                            grant,
                            id as string,
                            action as "open" | "close" | "reopen" | "reset",
                            body,
                            key,
                            match,
                            requestId,
                          )
                        : id
                          ? await attendance.patch(grant, id, body, key, match, requestId)
                          : await attendance.create(grant, body, key, requestId);
              response = json(result.data, result.status, { replayed: result.replayed });
            }
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/(?:authorization\/policy|organization\/(?:overview|units\/[^/]+\/(?:members|details|memberships|membership-preview|history)|board-terms(?:\/[^/]+(?:\/(?:confirm|amend|close|cancel|history))?)?))$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            namespace = parts[5 + offset],
            section = parts[6 + offset],
            id = parts[7 + offset],
            action = parts[8 + offset];
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          const preview = action === "membership-preview",
            writing = req.method !== "GET" && !preview,
            memberships = action === "memberships" || preview,
            matrix = namespace === "authorization";
          const methods =
            matrix || section === "overview" || action === "members" || action === "history"
              ? ["GET"]
              : preview || action === "memberships" || (section === "board-terms" && action)
                ? ["POST"]
                : action === "details"
                  ? ["PATCH"]
                  : id
                    ? ["PATCH"]
                    : ["GET", "POST"];
          requireCondition(methods.includes(req.method), 405, "METHOD_NOT_ALLOWED");
          route = `P24.${isOwner ? "owner" : "church"}.${section}.${action ?? "root"}.${req.method}`;
          let grant: OrganizationGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true);
            actorId = ctx.owner._id;
            const auth = identity.ownerGrant(
              ctx,
              memberships
                ? "members:manage"
                : writing
                  ? "organization:manage"
                  : "organization:read",
            );
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: true,
              canManageMemberships: true,
              policyContext: `${policyVersion}:owner`,
              fence: async (tx) => {
                await auth.fence(tx);
                await access.fence(churchId, tx, true);
              },
            };
          } else {
            const ctx = await churchIdentity.authorize(churchToken, false, false);
            actorId = ctx.account._id;
            actorChurchId = ctx.account.churchId;
            requireCondition(churchId.equals(ctx.account.churchId), 403, "FORBIDDEN");
            const auth = churchIdentity.grant(ctx);
            auth.require(
              matrix
                ? "policy:read"
                : memberships
                  ? "members:manage"
                  : writing
                    ? "organization:manage"
                    : "organization:roster",
            );
            if (section === "board-terms" || action === "history")
              auth.require("organization:read");
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: ctx.account.role === "pastor",
              canReadAttendance: ["pastor", "secretary", "ministry_lead"].includes(
                ctx.account.role,
              ),
              canManageMemberships:
                ctx.account.role === "pastor" || ctx.account.role === "secretary",
              ...(ctx.account.scope.kind === "assigned_units"
                ? { unitScope: ctx.account.scope.unitIds }
                : {}),
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          const church = await access.byId(churchId);
          requireCondition(church, 404, "NOT_FOUND");
          requireCondition(church.status === "active", 403, "CHURCH_SUSPENDED");
          if (matrix) {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            response = json(policyMatrix());
          } else if (req.method === "GET") {
            if (section === "overview")
              response = json(await organizationRuntime.overview(grant, url.searchParams));
            else if (action === "members")
              response = json(
                await organizationRuntime.roster(grant, id as string, url.searchParams),
              );
            else if (action === "history")
              response = json(
                await organizationRuntime.historyPage(grant, id as string, url.searchParams),
              );
            else response = json(await organizationRuntime.termList(grant, url.searchParams));
          } else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
            const body = await readJson(req),
              key = req.headers.get("idempotency-key"),
              match = req.headers.get("if-match");
            if (preview)
              response = json(
                await organizationRuntime.membershipPreview(grant, id as string, body, match),
              );
            else {
              const result =
                action === "details"
                  ? await organizationRuntime.details(
                      grant,
                      id as string,
                      body,
                      key,
                      match,
                      requestId,
                    )
                  : action === "memberships"
                    ? await organizationRuntime.memberships(
                        grant,
                        id as string,
                        body,
                        key,
                        match,
                        requestId,
                      )
                    : await organizationRuntime.termWrite(
                        grant,
                        id ?? null,
                        action ?? null,
                        body,
                        key,
                        match,
                        requestId,
                      );
              response = json(result.data, result.status, { replayed: result.replayed });
            }
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/organization\/(?:settings|units(?:\/[^/]+(?:\/status)?)?|operations\/[^/]+)$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            section = parts[6 + offset],
            id = parts[7 + offset],
            status = parts[8 + offset] === "status";
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          const methods =
            section === "operations"
              ? ["GET"]
              : section === "settings"
                ? ["GET", "POST", "PATCH"]
                : status
                  ? ["PATCH"]
                  : id
                    ? ["GET", "PATCH"]
                    : ["GET", "POST"];
          requireCondition(methods.includes(req.method), 405, "METHOD_NOT_ALLOWED");
          const write = req.method !== "GET";
          route = `P21.${isOwner ? "owner" : "church"}.${section}.${status ? "status" : id ? "detail" : "root"}.${req.method}`;
          let grant: OrganizationGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true);
            actorId = ctx.owner._id;
            const ownerGrant = identity.ownerGrant(
              ctx,
              section === "operations"
                ? "members:manage"
                : write
                  ? "organization:manage"
                  : "organization:read",
            );
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              canReadAttendance: true,
              policyContext: `${policyVersion}:owner`,
              fence: async (tx) => {
                await ownerGrant.fence(tx);
                await access.fence(churchId, tx, true);
              },
            };
          } else {
            const ctx = await churchIdentity.authorize(churchToken, false, false);
            actorId = ctx.account._id;
            actorChurchId = ctx.account.churchId;
            requireCondition(churchId.equals(ctx.account.churchId), 403, "FORBIDDEN");
            const userGrant = churchIdentity.grant(ctx);
            userGrant.require(
              section === "operations"
                ? "members:manage"
                : write
                  ? "organization:manage"
                  : "organization:read",
            );
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite:
                ctx.account.role === "pastor" ||
                (section === "operations" && ctx.account.role === "secretary"),
              ...(ctx.account.role === "secretary" && section === "operations"
                ? { receiptScope: "memberships" as const }
                : {}),
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => userGrant.fence(tx),
            };
          }
          const church = await access.byId(churchId);
          requireCondition(church, 404, "NOT_FOUND");
          requireCondition(church.status === "active", 403, "CHURCH_SUSPENDED");
          if (!(section === "units" && !id && req.method === "GET"))
            requireCondition(!url.search, 400, "INVALID_REQUEST");
          if (!write) {
            if (section === "operations")
              response = json(await operations.getOrganization(grant, id as string));
            else if (section === "settings") {
              const data = await organization.getSettings(grant);
              if (data.settings) headers.set("ETag", `"${data.settings.version}"`);
              response = json(data);
            } else if (id) {
              const unit = await organization.get(grant, id);
              headers.set("ETag", `"${unit.version}"`);
              response = json(unit);
            } else response = json(await organization.list(grant, url.searchParams));
          } else {
            const token = isOwner ? ownerToken : churchToken;
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(token, requestRealm, req.headers.get("x-csrf-token"));
            const body = await readJson(req),
              key = req.headers.get("idempotency-key"),
              match = req.headers.get("if-match");
            const result =
              section === "settings"
                ? await organization.writeSettings(
                    grant,
                    body,
                    req.method === "POST",
                    key,
                    match,
                    requestId,
                  )
                : await organization.writeUnit(
                    grant,
                    id ?? null,
                    status,
                    body,
                    key,
                    match,
                    requestId,
                  );
            const resource = (result.data.settings ?? result.data.unit) as { version: number };
            headers.set("ETag", `"${resource.version}"`);
            response = json(result.data, result.status, { replayed: result.replayed });
          }
        } else if (
          /^\/api\/v1\/owner\/churches\/[^/]+\/accounts(?:\/[^/]+(?:\/(?:permissions|status|temporary-passwords))?)?$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            churchId = parts[5] as string,
            id = parts[7],
            action = parts[8];
          const method =
            action === "temporary-passwords"
              ? "POST"
              : action
                ? "PATCH"
                : id
                  ? "GET"
                  : req.method === "GET"
                    ? "GET"
                    : "POST";
          requireCondition(req.method === method, 405, "METHOD_NOT_ALLOWED");
          route =
            action === "temporary-passwords"
              ? "F21"
              : action === "permissions"
                ? "F18"
                : action === "status"
                  ? "F19"
                  : id
                    ? "F16"
                    : method === "GET"
                      ? "F15"
                      : "F17";
          const ctx = await identity.authorize(ownerToken, "owner", false, true);
          actorId = ctx.owner._id;
          const grant = identity.ownerGrant(ctx, "accounts:manage");
          targetChurchId = objectId(churchId);
          if (id) targetAccountId = objectId(id);
          let body: unknown;
          if (method !== "GET") {
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(ownerToken, "owner", req.headers.get("x-csrf-token"));
            body = await readJson(req);
          }
          if (route !== "F15") requireCondition(!url.search, 400, "INVALID_REQUEST");
          if (method === "GET") {
            const data = id
              ? await accounts.get(grant, churchId, id)
              : await accounts.list(grant, churchId, url.searchParams);
            if (id) headers.set("ETag", `"${(data as { version: number }).version}"`);
            response = json(data);
          } else {
            const key = req.headers.get("idempotency-key"),
              match = req.headers.get("if-match");
            const result =
              action === "permissions"
                ? await accounts.permissions(
                    grant,
                    churchId,
                    id as string,
                    body,
                    key,
                    match,
                    requestId,
                  )
                : action === "status"
                  ? await accounts.status(
                      grant,
                      churchId,
                      id as string,
                      body,
                      key,
                      match,
                      requestId,
                    )
                  : action === "temporary-passwords"
                    ? await accounts.reset(
                        ctx,
                        grant,
                        churchId,
                        id as string,
                        body,
                        key,
                        match,
                        requestId,
                      )
                    : await accounts.create(grant, churchId, body, key, requestId);
            headers.set("ETag", `"${(result.data.account as { version: number }).version}"`);
            response = json(result.data, result.status, { replayed: result.replayed });
          }
        } else if (/^\/api\/v1\/owner\/churches\/[^/]+\/context$/.test(path)) {
          route = "F24";
          requireCondition(req.method === "GET", 405, "METHOD_NOT_ALLOWED");
          requireCondition(!url.search, 400, "INVALID_REQUEST");
          const ctx = await identity.authorize(ownerToken, "owner", false, true);
          actorId = ctx.owner._id;
          identity.ownerGrant(ctx, "churches:manage");
          targetChurchId = objectId(path.split("/")[5] as string);
          const church = await access.byId(targetChurchId);
          requireCondition(church, 404, "NOT_FOUND");
          requireCondition(church.status === "active", 403, "CHURCH_SUSPENDED");
          response = json({
            church: {
              id: church.id.toHexString(),
              code: church.code,
              name: church.name,
              status: church.status,
            },
            principal: identity.me(ctx),
            policyVersion,
            capabilities: ["context:read", ...ownerCapabilities],
            availability: {
              business: "not_available",
              organization: "available",
              members: "available",
              families: "available",
              attendance: "available",
            },
          });
        } else if (/^\/api\/v1\/churches\/[^/]+\/context$/.test(path)) {
          requestRealm = "church";
          route = "F09";
          requireCondition(req.method === "GET", 405, "METHOD_NOT_ALLOWED");
          requireCondition(!url.search, 400, "INVALID_REQUEST");
          const ctx = await churchIdentity.authorize(churchToken);
          actorId = ctx.account._id;
          actorChurchId = ctx.account.churchId;
          const id = objectId(path.split("/")[4] as string).toHexString();
          response = json(churchIdentity.context(ctx, id));
        } else if (path.startsWith("/api/v1/auth/")) {
          requestRealm = "church";
          const endpoint = path.slice("/api/v1/auth/".length);
          const registry: Record<string, { method: string; id: string }> = {
            login: { method: "POST", id: "F02" },
            me: { method: "GET", id: "F03" },
            logout: { method: "POST", id: "F04" },
            "change-initial-password": { method: "POST", id: "F05" },
            reauth: { method: "POST", id: "F06" },
            activity: { method: "POST", id: "F07" },
          };
          const spec = registry[endpoint];
          requireCondition(Object.hasOwn(registry, endpoint) && spec, 404, "NOT_FOUND");
          route = spec.id;
          requireCondition(req.method === spec.method, 405, "METHOD_NOT_ALLOWED");
          requireCondition(!url.search, 400, "INVALID_REQUEST");
          if (req.method === "POST")
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
          const body = req.method === "POST" ? await readJson(req) : {};
          if (endpoint === "login") {
            const bootstrap = await identity.csrfSession(
              jar.get(cookieName("church", true)),
              "church",
              req.headers.get("x-csrf-token"),
            );
            const result = await churchIdentity.login(body, bootstrap, info.ip, requestId);
            setSession(result);
            clear("church", true);
            response = json({ sessionState: result.session.kind, csrfToken: result.csrfToken });
          } else {
            if (req.method === "POST")
              await identity.csrfSession(churchToken, "church", req.headers.get("x-csrf-token"));
            const ctx = await churchIdentity.authorize(
              churchToken,
              endpoint === "reauth" || endpoint === "logout",
            );
            actorId = ctx.account._id;
            actorChurchId = ctx.account.churchId;
            if (endpoint === "me") response = json(churchIdentity.me(ctx));
            else if (endpoint === "change-initial-password") {
              await churchIdentity.change(ctx, body, requestId);
              clear("church");
              response = new Response(null, { status: 204, headers });
            } else if (endpoint === "reauth") {
              const result = await churchIdentity.reauth(ctx, body, info.ip, requestId);
              setSession(result);
              response = json({ sessionState: result.session.kind, csrfToken: result.csrfToken });
            } else if (endpoint === "activity") {
              await churchIdentity.activity(ctx);
              response = new Response(null, { status: 204, headers });
            } else {
              await churchIdentity.logout(ctx, requestId);
              clear("church");
              response = new Response(null, { status: 204, headers });
            }
          }
        } else if (
          path === "/api/v1/owner/churches" ||
          /^\/api\/v1\/owner\/churches\/[^/]+(?:\/status)?$/.test(path) ||
          /^\/api\/v1\/owner\/operations\/[^/]+$/.test(path)
        ) {
          const parts = path.split("/"),
            operation = parts[4] === "operations",
            churchId = parts[5],
            status = parts[6] === "status";
          const allowed =
            operation || status
              ? [operation ? "GET" : "PATCH"]
              : churchId
                ? ["GET", "PATCH"]
                : ["GET", "POST"];
          requireCondition(allowed.includes(req.method), 405, "METHOD_NOT_ALLOWED");
          route = operation
            ? "F22"
            : status
              ? "F14"
              : churchId
                ? req.method === "GET"
                  ? "F12"
                  : "F13"
                : req.method === "GET"
                  ? "F10"
                  : "F11";
          const write = req.method !== "GET";
          let body: unknown;
          if (write) {
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(ownerToken, "owner", req.headers.get("x-csrf-token"));
            body = await readJson(req);
          }
          const ctx = await identity.authorize(ownerToken, "owner", false, true);
          actorId = ctx.owner._id;
          const grant = identity.ownerGrant(ctx, "churches:manage");
          if (route !== "F10") requireCondition(url.search === "", 400, "INVALID_REQUEST");
          if (operation) response = json(await operations.get(grant, churchId as string));
          else if (!write) {
            if (churchId) {
              const detail = await tenancy.get(grant, churchId);
              headers.set("ETag", `"${detail.version}"`);
              response = json(detail);
            } else response = json(await tenancy.list(grant, url.searchParams));
          } else {
            const key = req.headers.get("idempotency-key"),
              match = req.headers.get("if-match");
            const result = status
              ? await tenancy.status(grant, churchId as string, body, key, match, requestId)
              : churchId
                ? await tenancy.update(grant, churchId, body, key, match, requestId)
                : await tenancy.create(grant, body, key, requestId);
            const church = result.data.church as { version: number };
            headers.set("ETag", `"${church.version}"`);
            response = json(result.data, result.status, { replayed: result.replayed });
          }
        } else {
          const endpoint = path.replace("/api/v1/owner/auth/", "");
          const registry: Record<string, { method: string; id: string }> = {
            login: { method: "POST", id: "F25" },
            me: { method: "GET", id: "F26" },
            logout: { method: "POST", id: "F27" },
            "change-initial-password": { method: "POST", id: "F28" },
            reauth: { method: "POST", id: "F29" },
            activity: { method: "POST", id: "F30" },
          };
          const spec = registry[endpoint];
          requireCondition(
            path.startsWith("/api/v1/owner/auth/") && Object.hasOwn(registry, endpoint) && spec,
            404,
            "NOT_FOUND",
          );
          route = spec.id;
          requireCondition(req.method === spec.method, 405, "METHOD_NOT_ALLOWED");
          if (req.method === "POST") {
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
          }
          const body = req.method === "POST" ? await readJson(req) : {};
          if (endpoint === "login") {
            const bootstrap = await identity.csrfSession(
              jar.get(cookieName("owner", true)),
              "owner",
              req.headers.get("x-csrf-token"),
            );
            const result = await identity.login(body, bootstrap, info.ip, requestId);
            setSession(result);
            clear("owner", true);
            response = json({ sessionState: result.session.kind, csrfToken: result.csrfToken });
          } else {
            if (req.method === "POST")
              await identity.csrfSession(ownerToken, "owner", req.headers.get("x-csrf-token"));
            const ctx = await identity.authorize(
              ownerToken,
              "owner",
              endpoint === "reauth" || endpoint === "logout",
            );
            actorId = ctx.owner._id;
            if (endpoint === "me") response = json(identity.me(ctx));
            else if (endpoint === "change-initial-password") {
              await identity.change(ctx, body, requestId);
              clear("owner");
              response = new Response(null, { status: 204, headers });
            } else if (endpoint === "reauth") {
              const result = await identity.reauth(ctx, body, info.ip, requestId);
              setSession(result);
              response = json({ sessionState: result.session.kind, csrfToken: result.csrfToken });
            } else if (endpoint === "activity") {
              await identity.activity(ctx);
              response = new Response(null, { status: 204, headers });
            } else {
              await identity.logout(ctx, requestId);
              clear("owner");
              response = new Response(null, { status: 204, headers });
            }
          }
        }
      } else {
        requireCondition(req.method === "GET" || req.method === "HEAD", 405, "METHOD_NOT_ALLOWED");
        const root = resolve(options.dist ?? "dist");
        const decoded = decodeURIComponent(path);
        const file = resolve(root, `.${decoded}`);
        requireCondition(file === root || file.startsWith(`${root}/`), 404, "NOT_FOUND");
        if (path.startsWith("/assets/")) {
          requireCondition(await Bun.file(file).exists(), 404, "NOT_FOUND");
          response = new Response(req.method === "HEAD" ? null : Bun.file(file), {
            headers: {
              ...Object.fromEntries(headers),
              "Content-Type": Bun.file(file).type,
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        } else {
          requireCondition(
            [
              "/",
              "/owner",
              "/owner/churches",
              "/owner/login",
              "/owner/change-password",
              "/owner/support",
            ].includes(path) ||
              /^\/owner\/churches\/[a-f0-9]{24}(?:\/(?:accounts|manage|config|members|families|bans|roles|overview|attendance|rites|forms))?$/i.test(
                path,
              ) ||
              /^\/h\/[a-z0-9-]{1,100}(?:\/(?:login|change-password|support|config|members|families|bans|roles|overview|access|attendance|rites|forms))?$/i.test(
                path,
              ),
            404,
            "NOT_FOUND",
          );
          requireCondition(
            await Bun.file(`${root}/index.html`).exists(),
            503,
            "DEPENDENCY_UNAVAILABLE",
          );
          response = new Response(req.method === "HEAD" ? null : Bun.file(`${root}/index.html`), {
            headers: { ...Object.fromEntries(headers), "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }
    } catch (error) {
      let e =
        error instanceof AppError
          ? error
          : error instanceof MongoServerError &&
              error.code === 11000 &&
              String(error.message).includes("attendance_sunday_reference_unique")
            ? new AppError(409, "ATTENDANCE_REFERENCE_EXISTS")
            : new AppError(503, "DEPENDENCY_UNAVAILABLE");
      if (e.status === 403) {
        try {
          if (requestRealm === "church" || targetChurchId)
            await identity.audit.principal(
              "authorization.denied",
              requestId,
              {
                kind: actorId ? (requestRealm === "church" ? "church_user" : "owner") : "anonymous",
                ...(actorId ? { id: actorId } : {}),
                churchId: actorChurchId,
              },
              {
                id: targetAccountId ?? (requestRealm === "church" ? actorId : undefined),
                churchId: requestRealm === "church" ? actorChurchId : targetChurchId,
              },
              [],
              undefined,
              undefined,
              "denied",
            );
          else
            await identity.audit.record(
              "authorization.denied",
              requestId,
              actorId,
              undefined,
              "denied",
            );
        } catch {
          e = new AppError(503, "DEPENDENCY_UNAVAILABLE");
        }
      }
      if (e.retryAfter) headers.set("Retry-After", String(e.retryAfter));
      response = Response.json(
        {
          error: {
            code: e.code,
            message: messages[e.code] ?? "Không thể thực hiện thao tác.",
            ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}),
            ...(e.resourceId ? { resourceId: e.resourceId } : {}),
          },
          meta: { requestId, ...(e.operationId ? { operationId: e.operationId } : {}) },
        },
        { status: e.status, headers },
      );
    }
    if (printing && response.status >= 400)
      response = new Response(
        (printingCertificate ? certificatePrintError : printError)(
          messages[
            response.status === 401
              ? "REAUTH_REQUIRED"
              : printingCertificate
                ? "CERT_NOT_CURRENT"
                : "CARD_NOT_USABLE"
          ] as string,
        ),
        {
          status: response.status,
          headers: { ...Object.fromEntries(headers), "Content-Type": "text/html; charset=utf-8" },
        },
      );
    log({
      requestId,
      route,
      method: req.method,
      status: response.status,
      latencyMs: Math.round(performance.now() - started),
    });
    return response;
  };
}
