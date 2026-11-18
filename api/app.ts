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
import type { CareGrant } from "./care/models";
import { CareReporting } from "./care/reporting";
import { Care } from "./care/service";
import { CareSources } from "./care/sources";
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
import { Expenses } from "./finance/expenses";
import type { ExpenseGrant } from "./finance/expenses-model";
import type { FinanceGrant } from "./finance/models";
import { Payments } from "./finance/payments";
import { FinancePeriods } from "./finance/periods";
import { FinanceReporting } from "./finance/reporting";
import { Finance } from "./finance/service";
import { FinanceTransactions } from "./finance/transactions";
import { readFileBody, readJson } from "./http";
import { objectId } from "./http-validation";
import { Accounts } from "./identity/accounts";
import { type ChurchAuthContext, ChurchIdentity } from "./identity/church-service";
import type { Realm } from "./identity/models";
import { cookie, cookieName, type Identity, type SessionResult } from "./identity/service";
import { FinanceMembers } from "./members/finance";
import { Members } from "./members/service";
import { Operations } from "./operations/service";
import type { OrganizationGrant } from "./organization/grant";
import { ProgramOrganization } from "./organization/programs";
import { OrganizationRuntime } from "./organization/runtime";
import { Organization } from "./organization/service";
import { Overview } from "./overview/service";
import type { PrayerGrant } from "./prayers/models";
import { PrayerReporting } from "./prayers/reporting";
import { Prayers } from "./prayers/service";
import { PrepAttendanceSource } from "./prep-classes/attendance-port";
import type { ClassGrant } from "./prep-classes/models";
import { PrepReporting } from "./prep-classes/reporting";
import { PrepClasses } from "./prep-classes/service";
import type { ProgramGrant } from "./programs/models";
import { printProgram, programPrintError, programPrintScript } from "./programs/printing";
import { Programs } from "./programs/service";
import { ProgramSources } from "./programs/sources";
import type { RiteGrant } from "./rites/models";
import { RiteReporting } from "./rites/reporting";
import { Rites } from "./rites/service";
import type { ScheduleGrant } from "./scheduling/models";
import { Scheduling } from "./scheduling/service";
import { Tenancy } from "./tenancy/service";
import { Visitation } from "./visitation/service";
import { VisitationSources } from "./visitation/sources";
export interface RequestInfo {
  ip: string;
}
const messages: Record<string, string> = {
  EXPENSE_SELF_DECISION: "Không được tự duyệt hoặc từ chối đề xuất của chính account này.",
  EXPENSE_ALREADY_DECIDED: "Đề xuất đã có quyết định. Tải lại để đối soát.",
  EXPENSE_FUND_UNAVAILABLE:
    "Quỹ đã ngừng hoặc không khả dụng. Chọn lại quỹ; đề xuất chờ vẫn có thể bị từ chối đúng quyền.",
  EXPENSE_PREVIEW_STALE:
    "Bản xem trước hết hạn hoặc nguồn đã thay đổi. Xem trước lại trước khi xác nhận.",
  EXPENSE_SUBMISSION_CONFLICT:
    "Lần gửi này đã có nội dung hoặc người gửi khác. Đối soát đề xuất hiện có.",
  FINANCE_FUTURE_PERIOD: "Không được khóa kỳ tương lai.",
  FINANCE_ALREADY_CLOSED: "Mốc này đã khóa. Đối soát biên bản hiện có.",
  FINANCE_RECONCILIATION_FAILED: "Phiếu và sổ chưa khớp. Chưa thể khóa; xem kết quả đối chiếu.",
  PERIOD_PREVIEW_STALE: "Dữ liệu sổ hoặc mốc khóa đã thay đổi. Đối chiếu và xem trước lại.",
  PAYMENT_ALREADY_VOIDED: "Phiếu chi đã hủy. Đối soát phiếu và đối ứng hiện có.",
  PAYMENT_PROPOSAL_CONFLICT: "Phiếu, đề xuất và sổ chưa khớp; không ghi đối ứng.",
  PAYMENT_NOT_APPROVED: "Đề xuất chưa ở trạng thái được duyệt, chờ chi. Tải lại để đối soát.",
  PAYMENT_ALREADY_POSTED: "Đề xuất hoặc ý định đã có phiếu chi. Đối soát phiếu hiện có.",
  PAYMENT_PREVIEW_STALE: "Ngày, kỳ hoặc nguồn đã thay đổi; hãy xem trước lại.",
  FINANCE_INSUFFICIENT_BALANCE: "Số dư sổ của quỹ không đủ. Thao tác này không được làm số dư âm.",
  FINANCE_AMOUNT_INVALID:
    "Số tiền và tổng phiếu phải là VND nguyên đồng trong giới hạn 1–999999999999999999.",
  FINANCE_FUTURE_DAY: "Ngày thu không được sau ngày hiện tại tại Việt Nam.",
  FINANCE_GIVING_EXISTS: "Người này đã có mã dâng hiến. Tìm cả mã đã ngừng để đối soát.",
  FINANCE_MEMBER_UNAVAILABLE: "Chỉ cấp mã cho người đang sinh hoạt hoặc vắng lâu trong Hội Thánh.",
  FINANCE_SOURCE_UNAVAILABLE: "Quỹ, mã hoặc hồ sơ nguồn không còn khả dụng. Chọn lại và xem trước.",
  FINANCE_SOURCE_STALE: "Nguồn đã thay đổi. Xem trước lại trước khi xác nhận.",
  FINANCE_PREVIEW_STALE:
    "Bản xem trước đã hết hạn hoặc nguồn đã thay đổi. Quay lại và xem trước lại.",
  FINANCE_PERIOD_CLOSED: "Kỳ gốc đã đóng. Không thể ghi hoặc hủy phiếu trong kỳ này.",
  FINANCE_SOURCE_EXISTS:
    "Nguồn tham chiếu đã được dùng, kể cả phiếu đã hủy. Đối soát phiếu hiện có.",
  FINANCE_SUBMISSION_CONFLICT:
    "Lần gửi này đã có nội dung hoặc người nhập khác. Đối soát phiếu hiện có.",
  FINANCE_REPLACEMENT_INVALID: "Phiếu gốc phải đã hủy và thuộc cùng Hội Thánh.",
  FINANCE_REPLACEMENT_EXISTS: "Phiếu đã hủy đã có phiếu thay thế. Đối soát phiếu hiện có.",
  FINANCE_ALREADY_VOIDED: "Phiếu đã hủy. Tải lại để đối soát.",
  FINANCE_ALREADY_CONFIGURED: "Tài chính đã được cấu hình. Tải bản hiện hành để đối soát.",
  FINANCE_NOT_CONFIGURED: "Tài chính chưa được cấu hình.",
  FINANCE_FUND_NAME_EXISTS: "Tên quỹ đã tồn tại, kể cả quỹ đang ngừng dùng.",
  FINANCE_STATUS_UNCHANGED: "Trạng thái đã thay đổi. Tải lại để đối soát.",

  VISIT_TARGET_UNAVAILABLE:
    "Đối tượng/gia đình không còn phù hợp để ghi nghiệp vụ mới. Giữ hồ sơ để đối soát, hoàn tất hoặc hủy có lý do.",
  VISIT_ASSIGNEE_UNAVAILABLE:
    "Người phụ trách không còn hợp lệ. Chọn người khác hoặc bỏ phân công.",
  VISIT_PARTICIPANT_UNAVAILABLE:
    "Người tham gia phải còn hoạt động hoặc vắng lâu trong cùng Hội Thánh.",
  VISIT_FUTURE_DATE: "Ngày thăm không được ở tương lai.",
  VISIT_CASE_CLOSED: "Hồ sơ đã đóng; chỉ có thể đính chính lần thăm có lý do.",
  VISIT_CASE_EXISTS:
    "Đã có hồ sơ đang mở cho đối tượng và nhóm lý do này. Kiểm tra danh sách trước khi tạo mới.",
  VISIT_PREVIEW_STALE: "Hồ sơ hoặc nguồn đã thay đổi. Xem trước lại trước khi lưu.",
  VISIT_SOURCE_STALE: "Nguồn đã thay đổi. Đọc lại hồ sơ và xem trước lại.",
  VISIT_CONFIRMATION_REQUIRED: "Xác nhận trước khi hoàn tất hoặc hủy hồ sơ.",
  VISIT_NEEDS_VISITED_ENTRY: "Cần ít nhất một lần Đã gặp để hoàn tất hồ sơ.",
  VISIT_COMPLETION_INVALID:
    "Không thể đổi lần Đã gặp cuối cùng của hồ sơ đã hoàn tất thành kết quả khác.",
  PROGRAM_SOURCE_UNAVAILABLE:
    "Lịch/ban/nhiệm kỳ hoặc phân công không còn phù hợp. Đối soát nguồn trước khi chốt.",
  PROGRAM_SOURCE_STALE: "Nguồn đã thay đổi. Xem trước lại trước khi lưu/chốt.",
  PROGRAM_PREVIEW_STALE: "Chương trình hoặc nguồn đã thay đổi. Xem trước lại.",
  PROGRAM_DRAFT_LOCKED: "Bản đã chốt được giữ nguyên. Tạo nháp đính chính nếu cần.",
  PROGRAM_PERSON_UNAVAILABLE:
    "Chỉ chọn người hiện còn trong ban. Phân công cũ không còn phù hợp cần thay hoặc bỏ.",
  PROGRAM_INCOMPLETE_CONFIRMATION: "Xác nhận các tiết mục còn chưa phân công trước khi chốt.",
  PROGRAM_EXISTS: "Buổi/ban này đã có chương trình. Mở chương trình hiện có để đối soát.",
  CERT_SOURCE_REQUIRED: "Chọn đúng hồ sơ, lễ hoặc ghi danh cùng Hội Thánh.",
  CERT_SOURCE_LOCKED: "Dữ kiện nguồn đã biết được khóa. Đối soát nguồn hoặc giữ giá trị đã chọn.",
  CERT_SUPPLEMENT_INVALID: "Chỉ bổ sung trường phù hợp với mẫu này.",
  CERT_DATE_INVALID: "Kiểm tra ngày sinh, ngày lễ và ngày chốt bản.",
  CERT_KIND_IMMUTABLE: "Không đổi loại mẫu của bản nháp đã tạo.",
  CERT_PREVIEW_STALE: "Preview đã hết hạn hoặc nguồn đã thay đổi. Tải lại và chuẩn bị preview mới.",
  CERT_INCOMPLETE: "Còn dữ kiện thiếu hoặc mâu thuẫn. Đối soát trước khi chốt.",
  CERT_FAITH_CONFIRMATION: "Cần xác nhận riêng nội dung đức tin trong GCN Báp-têm.",
  CERT_REASON_REQUIRED: "Nhập lý do thay thế hoặc thu hồi bản.",
  SCHEDULE_PREVIEW_STALE: "Lịch hoặc nguồn đã thay đổi. Hãy xem trước lại.",
  SCHEDULE_TIME_INVALID: "Giờ kết thúc phải sau giờ bắt đầu, trong tối đa 24 giờ.",
  SCHEDULE_RANGE_LIMIT: "Chuỗi lịch phải kết thúc trong tối đa 365 ngày.",
  SCHEDULE_OCCURRENCE_LIMIT: "Chuỗi lịch vượt giới hạn 200 lần diễn ra.",
  SCHEDULE_EMPTY: "Quy tắc chưa tạo lần diễn ra nào trong khoảng đã chọn.",
  SCHEDULE_PAST_LOCKED: "Lịch đã qua cần lý do đính chính và giữ ngày giờ/phạm vi.",
  SCHEDULE_CANCELLED: "Lịch đã hủy được giữ trong lịch sử. Tạo lịch mới nếu cần.",
  SCHEDULE_PERSON_UNAVAILABLE: "Người được phân công không còn phù hợp.",
  SCHEDULE_UNIT_UNAVAILABLE: "Đơn vị được chọn không còn hoạt động.",
  SCHEDULE_CONFLICT_CONFIRMATION: "Xác nhận trùng giờ và nhập lý do trước khi lưu.",
  SCHEDULE_EXCEPTION_CONFIRMATION: "Xác nhận các lần đã chỉnh riêng bị ảnh hưởng.",
  SCHEDULE_CONFLICT_LIMIT: "Có quá nhiều xung đột. Hãy thu hẹp phạm vi lịch.",
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
  CARE_SIGNAL_EXISTS: "Đã có nguồn nhu cầu đang mở cho đối tượng và loại này.",
  CARE_EPISODE_EXISTS: "Đề nghị đã được đánh giá đồng thời. Vui lòng tải lại.",
  CARE_ALREADY_DECIDED: "Đề nghị đã được xử lý hoặc không còn hoạt động.",
  CARE_SIGNAL_ENDED: "Nguồn nhu cầu đã kết thúc.",
  CARE_SOURCE_INVALID: "Nguồn hoặc ngày ghi nhận không hợp lệ.",
  CARE_SOURCE_UNKNOWN: "Chưa đủ bằng chứng từ nguồn để chuyển sang thăm viếng.",
  CARE_TARGET_UNAVAILABLE: "Đối tượng không còn hợp lệ trong nguồn hiện hành.",
  CARE_SOURCE_STALE: "Nguồn đã thay đổi. Vui lòng đánh giá và xem trước lại.",
  CARE_PREVIEW_STALE: "Nội dung hoặc nguồn đã đổi. Vui lòng xem trước lại.",
  CARE_LINK_CHANGED: "Hồ sơ đang mở đã thay đổi. Vui lòng kiểm tra và xem trước lại.",
  CARE_CONFIRMATION_REQUIRED: "Cần xác nhận sau khi xem trước.",
  PRAYER_SOURCE_STALE: "Nguồn người gửi đã thay đổi. Vui lòng xem trước lại.",
  PRAYER_SOURCE_UNAVAILABLE: "Người gửi không còn hợp lệ để chọn mới.",
  PRAYER_DATE_INVALID: "Ngày nhận/chia sẻ không hợp lệ hoặc ở tương lai.",
  PRAYER_CLOSED: "Lời cầu thay đã đóng; chỉ có thể đính chính có lý do.",
  PRAYER_PRIVATE_SHARE: "Không ghi nhận chia sẻ cho lời cầu thay riêng tư.",
  PRAYER_STATE_CONFLICT: "Trạng thái lời cầu thay đã thay đổi.",
  PRAYER_PREVIEW_STALE: "Thông tin đã thay đổi. Vui lòng xem trước lại.",
  PRAYER_CONFIRMATION_REQUIRED: "Cần xác nhận nội dung và phạm vi xem.",
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
  const finance = new Finance(identity.db, operations, identity.audit, conf.csrfKey, identity.now);
  const income = new FinanceTransactions(
    identity.db,
    operations,
    finance,
    new FinanceMembers(identity.db),
    conf.csrfKey,
    identity.now,
  );
  const reporting = new FinanceReporting(identity.db, identity.now);
  const periods = new FinancePeriods(identity.db, operations, finance, conf.csrfKey, identity.now);
  const payments = new Payments(identity.db, operations, finance, conf.csrfKey, identity.now);
  const expenses = new Expenses(identity.db, operations, finance, conf.csrfKey, identity.now);
  const expenseGrant = (ctx: ChurchAuthContext): ExpenseGrant => {
    const auth = churchIdentity.grant(ctx);
    return {
      actorKind: "church_user",
      actorId: ctx.account._id,
      churchId: ctx.account.churchId,
      role: ctx.account.role,
      actorName: ctx.account.displayName,
      canWrite: ctx.account.role !== "member",
      policyContext: `${policyVersion}:${ctx.account.version}`,
      fence: (tx) => auth.fence(tx),
    };
  };
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
  const scheduling = new Scheduling(
    identity.db,
    members.schedulingPort(),
    organization,
    operations,
    identity.audit,
    conf.csrfKey,
    identity.now,
  );
  const programs = new Programs(
    identity.db,
    new ProgramSources(
      members.programPort(),
      new ProgramOrganization(identity.db, conf.csrfKey, identity.now),
      scheduling,
      tenancy,
      identity.now,
    ),
    operations,
    identity.audit,
    conf.csrfKey,
    identity.now,
  );
  const visitation = new Visitation(
    identity.db,
    new VisitationSources(members.visitationPort(), families.visitationPort()),
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
  const prayers = new Prayers(
    identity.db,
    members.prayerPort(),
    operations,
    identity.audit,
    conf.csrfKey,
    identity.now,
  );
  const care = new Care(
    identity.db,
    new CareSources(members.carePort(), families.carePort(), reports),
    visitation.carePort(),
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
    new PrayerReporting(prayers),
    new CareReporting(care),
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
      printingCertificate = false,
      printingProgram = false;
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
        } else if (/^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/finance\/summary$/.test(path)) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            churchId = objectId(parts[isOwner ? 5 : 4] as string);
          requestRealm = isOwner ? "owner" : "church";
          route = `P56.${requestRealm}.summary`;
          targetChurchId = churchId;
          if (isOwner) {
            await identity.authorize(ownerToken, "owner", false, true);
            throw new AppError(403, "FORBIDDEN");
          }
          const ctx = await churchIdentity.authorize(churchToken, false, false);
          actorId = ctx.account._id;
          actorChurchId = ctx.account.churchId;
          requireCondition(churchId.equals(actorChurchId), 403, "FORBIDDEN");
          requireCondition(
            ctx.account.role === "pastor" || ctx.account.role === "treasurer",
            403,
            "FORBIDDEN",
          );
          const auth = churchIdentity.grant(ctx);
          auth.require("finance:summary:read");
          requireCondition(req.method === "GET", 405, "METHOD_NOT_ALLOWED");
          response = json(
            await reporting.summary(
              {
                actorKind: "church_user",
                actorId,
                churchId,
                actorName: ctx.account.displayName,
                financeRole: ctx.account.role,
                canWrite: false,
                policyContext: `${policyVersion}:${ctx.account.version}`,
                fence: (tx) => auth.fence(tx),
              },
              url.searchParams,
            ),
          );
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/finance\/(?:periods\/(?:operations\/[^/]+|[^/]+(?:\/(?:funds|close-preview|close))?)|period-closures\/[^/]+(?:\/history)?)$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            section = parts[6 + offset],
            id = parts[7 + offset] as string,
            action = parts[8 + offset];
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          route = `P55.${requestRealm}.${section}.${action ?? id}.${req.method}`;
          if (isOwner) {
            await identity.authorize(ownerToken, "owner", false, true);
            throw new AppError(403, "FORBIDDEN");
          }
          const ctx = await churchIdentity.authorize(churchToken, false, false);
          actorId = ctx.account._id;
          actorChurchId = ctx.account.churchId;
          requireCondition(churchId.equals(actorChurchId), 403, "FORBIDDEN");
          requireCondition(
            ctx.account.role === "pastor" || ctx.account.role === "treasurer",
            403,
            "FORBIDDEN",
          );
          const auth = churchIdentity.grant(ctx),
            write = action === "close-preview" || action === "close";
          auth.require(write ? "finance:periods:close" : "finance:periods:read");
          const grant: FinanceGrant = {
            actorKind: "church_user",
            actorId,
            churchId,
            financeRole: ctx.account.role,
            actorName: ctx.account.displayName,
            canWrite: ctx.account.role === "treasurer",
            policyContext: `${policyVersion}:${ctx.account.version}`,
            fence: (tx) => auth.fence(tx),
          };
          requireCondition(req.method === (write ? "POST" : "GET"), 405, "METHOD_NOT_ALLOWED");
          if (write) {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(churchToken, "church", req.headers.get("x-csrf-token"));
            const body = await readJson(req);
            if (action === "close-preview") response = json(await periods.preview(grant, id, body));
            else {
              const result = await periods.close(
                grant,
                id,
                body,
                req.headers.get("idempotency-key"),
                requestId,
              );
              headers.set("ETag", `"${result.data.version}"`);
              response = json(result.data, result.status, { replayed: result.replayed });
            }
          } else if (action === "funds")
            response = json(await periods.funds(grant, id, url.searchParams));
          else if (section === "period-closures" && action === "history")
            response = json(await periods.history(grant, id, url.searchParams));
          else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            response = json(
              id === "operations"
                ? await periods.operation(grant, action as string)
                : section === "period-closures"
                  ? await periods.closure(grant, id)
                  : await periods.get(grant, id),
            );
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/finance\/(?:expense-proposals\/[^/]+\/(?:payment-preview|payment)|payments\/(?:operations\/[^/]+|[^/]+(?:\/(?:history|void-preview|void))?))$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            section = parts[6 + offset],
            id = parts[7 + offset] as string,
            action = parts[8 + offset];
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          route = `P54.${requestRealm}.${section}.${action ?? "root"}.${req.method}`;
          if (isOwner) {
            await identity.authorize(ownerToken, "owner", false, true);
            throw new AppError(403, "FORBIDDEN");
          }
          const ctx = await churchIdentity.authorize(churchToken, false, false);
          actorId = ctx.account._id;
          actorChurchId = ctx.account.churchId;
          requireCondition(churchId.equals(actorChurchId), 403, "FORBIDDEN");
          requireCondition(
            ctx.account.role === "pastor" || ctx.account.role === "treasurer",
            403,
            "FORBIDDEN",
          );
          const auth = churchIdentity.grant(ctx),
            write =
              section === "expense-proposals" || action === "void-preview" || action === "void";
          auth.require(
            write
              ? section === "payments"
                ? "finance:payments:void"
                : "finance:payments:manage"
              : "finance:payments:read",
          );
          const grant: FinanceGrant = {
            actorKind: "church_user",
            actorId,
            churchId,
            financeRole: ctx.account.role,
            actorName: ctx.account.displayName,
            canWrite: ctx.account.role === "treasurer",
            policyContext: `${policyVersion}:${ctx.account.version}`,
            fence: (tx) => auth.fence(tx),
          };
          requireCondition(req.method === (write ? "POST" : "GET"), 405, "METHOD_NOT_ALLOWED");
          if (write) {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(churchToken, "church", req.headers.get("x-csrf-token"));
            const body = await readJson(req);
            if (action === "payment-preview")
              response = json(await payments.preview(grant, id, body, req.headers.get("if-match")));
            else if (action === "void-preview")
              response = json(
                await payments.previewVoid(grant, id, body, req.headers.get("if-match")),
              );
            else {
              const result = await (action === "void"
                ? payments.void.bind(payments)
                : payments.post.bind(payments))(
                grant,
                id,
                body,
                req.headers.get("idempotency-key"),
                req.headers.get("if-match"),
                requestId,
              );
              headers.set("ETag", `"${result.data.version}"`);
              response = json(result.data, result.status, { replayed: result.replayed });
            }
          } else if (id === "operations") {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            response = json(await payments.operation(grant, action as string));
          } else if (action === "history")
            response = json(await payments.history(grant, id, url.searchParams));
          else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            const result = await payments.get(grant, id);
            headers.set("ETag", `"${result.version}"`);
            response = json(result);
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/finance\/expense-proposals(?:\/(?:context|funds|preview|operations\/[^/]+|[^/]+(?:\/(?:history|preview|decision))?))?$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            id = parts[7 + offset],
            action = parts[8 + offset];
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          route = `P53.${requestRealm}.${id ? "detail" : "root"}.${action ?? "root"}.${req.method}`;
          if (isOwner) {
            await identity.authorize(ownerToken, "owner", false, true);
            throw new AppError(403, "FORBIDDEN");
          }
          const ctx = await churchIdentity.authorize(churchToken, false, false);
          actorId = ctx.account._id;
          actorChurchId = ctx.account.churchId;
          requireCondition(churchId.equals(actorChurchId), 403, "FORBIDDEN");
          requireCondition(ctx.account.role !== "member", 403, "FORBIDDEN");
          const g = expenseGrant(ctx),
            write = req.method !== "GET",
            rootOnly = !id,
            creatingPreview = id === "preview",
            decisionPreview = action === "preview";
          const methods = rootOnly
            ? ["GET", "POST"]
            : creatingPreview || decisionPreview || action === "decision"
              ? ["POST"]
              : ["GET"];
          requireCondition(methods.includes(req.method), 405, "METHOD_NOT_ALLOWED");
          if (write) {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(churchToken, "church", req.headers.get("x-csrf-token"));
            const body = await readJson(req);
            if (creatingPreview) response = json(await expenses.previewSubmit(g, body));
            else if (decisionPreview)
              response = json(
                await expenses.previewDecision(g, id as string, body, req.headers.get("if-match")),
              );
            else {
              const r = rootOnly
                ? await expenses.submit(g, body, req.headers.get("idempotency-key"), requestId)
                : await expenses.decide(
                    g,
                    id as string,
                    body,
                    req.headers.get("idempotency-key"),
                    req.headers.get("if-match"),
                    requestId,
                  );
              headers.set("ETag", `"${r.data.version}"`);
              response = json(r.data, r.status, { replayed: r.replayed });
            }
          } else if (rootOnly) response = json(await expenses.list(g, url.searchParams));
          else if (id === "context") {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            response = json(await expenses.context(g));
          } else if (id === "funds") response = json(await expenses.funds(g, url.searchParams));
          else if (id === "operations") {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            response = json(await expenses.operation(g, action as string));
          } else if (action === "history")
            response = json(await expenses.history(g, id as string, url.searchParams));
          else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            const r = await expenses.get(g, id as string);
            headers.set("ETag", `"${r.version}"`);
            response = json(r);
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/finance\/(?:member-options|giving-codes(?:\/[^/]+\/(?:status|history))?|receipts(?:\/(?:preview|[^/]+(?:\/(?:void|history))?))?|ledger)$/.test(
            path,
          )
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
          route = `P52.${requestRealm}.${section}.${action ?? id ?? "root"}.${req.method}`;
          if (isOwner) {
            await identity.authorize(ownerToken, "owner", false, true);
            throw new AppError(403, "FORBIDDEN");
          }
          const ctx = await churchIdentity.authorize(churchToken, false, false);
          actorId = ctx.account._id;
          actorChurchId = ctx.account.churchId;
          requireCondition(churchId.equals(actorChurchId), 403, "FORBIDDEN");
          requireCondition(
            ctx.account.role === "pastor" || ctx.account.role === "treasurer",
            403,
            "FORBIDDEN",
          );
          const auth = churchIdentity.grant(ctx),
            write = req.method !== "GET";
          auth.require(
            write
              ? section === "giving-codes"
                ? "finance:codes:manage"
                : "finance:receipts:manage"
              : "finance:receipts:read",
          );
          const grant: FinanceGrant = {
            actorKind: "church_user",
            actorId,
            churchId,
            financeRole: ctx.account.role,
            actorName: ctx.account.displayName,
            canWrite: ctx.account.role === "treasurer",
            policyContext: `${policyVersion}:${ctx.account.version}`,
            fence: (tx) => auth.fence(tx),
          };
          const allowed =
            section === "giving-codes"
              ? action === "status"
                ? ["PATCH"]
                : action === "history"
                  ? ["GET"]
                  : ["GET", "POST"]
              : section === "receipts"
                ? id === "preview" || action === "void"
                  ? ["POST"]
                  : action === "history" || id
                    ? ["GET"]
                    : ["GET", "POST"]
                : ["GET"];
          requireCondition(allowed.includes(req.method), 405, "METHOD_NOT_ALLOWED");
          if (write) {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(churchToken, "church", req.headers.get("x-csrf-token"));
            const body = await readJson(req);
            if (id === "preview") response = json(await income.preview(grant, body));
            else {
              const result =
                section === "giving-codes"
                  ? await income.codeWrite(
                      grant,
                      id ?? null,
                      body,
                      req.headers.get("idempotency-key"),
                      req.headers.get("if-match"),
                      requestId,
                    )
                  : action === "void"
                    ? await income.void(
                        grant,
                        id as string,
                        body,
                        req.headers.get("idempotency-key"),
                        req.headers.get("if-match"),
                        requestId,
                      )
                    : await income.post(grant, body, req.headers.get("idempotency-key"), requestId);
              headers.set("ETag", `"${result.data.version}"`);
              response = json(result.data, result.status, { replayed: result.replayed });
            }
          } else if (action === "history")
            response = json(
              await income.history(
                grant,
                section === "receipts" ? "receipt" : "giving_code",
                id as string,
                url.searchParams,
              ),
            );
          else if (section === "member-options")
            response = json(await income.memberOptions(grant, url.searchParams));
          else if (section === "giving-codes")
            response = json(await income.codeList(grant, url.searchParams));
          else if (section === "receipts" && id) {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            const result = await income.get(grant, id);
            headers.set("ETag", `"${result.version}"`);
            response = json(result);
          } else response = json(await income.list(grant, url.searchParams, section === "ledger"));
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/finance\/(?:settings(?:\/history)?|funds(?:\/[^/]+(?:\/(?:status|history))?)?|operations\/[^/]+)$/.test(
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
            history = section === "settings" ? id === "history" : action === "history";
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          route = `P51.${requestRealm}.${section}.${history ? "history" : (action ?? (id ? "detail" : "root"))}.${req.method}`;
          if (isOwner) {
            await identity.authorize(ownerToken, "owner", false, true);
            throw new AppError(403, "FORBIDDEN");
          }
          const ctx = await churchIdentity.authorize(churchToken, false, false);
          actorId = ctx.account._id;
          actorChurchId = ctx.account.churchId;
          requireCondition(churchId.equals(ctx.account.churchId), 403, "FORBIDDEN");
          requireCondition(
            ctx.account.role === "pastor" || ctx.account.role === "treasurer",
            403,
            "FORBIDDEN",
          );
          const auth = churchIdentity.grant(ctx),
            write = req.method !== "GET";
          auth.require(
            write
              ? section === "settings"
                ? "finance:settings:manage"
                : "finance:funds:manage"
              : "finance:funds:read",
          );
          const grant: FinanceGrant = {
            actorKind: "church_user",
            actorId,
            churchId,
            financeRole: ctx.account.role,
            actorName: ctx.account.displayName,
            canWrite: true,
            policyContext: `${policyVersion}:${ctx.account.version}`,
            fence: (tx) => auth.fence(tx),
          };
          const methods =
            history || section === "operations"
              ? ["GET"]
              : section === "settings"
                ? ["GET", "POST", "PATCH"]
                : action === "status"
                  ? ["PATCH"]
                  : id
                    ? ["GET", "PATCH"]
                    : ["GET", "POST"];
          requireCondition(methods.includes(req.method), 405, "METHOD_NOT_ALLOWED");
          if (!(section === "funds" && !id && !write) && !history)
            requireCondition(!url.search, 400, "INVALID_REQUEST");
          if (write) {
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(churchToken, "church", req.headers.get("x-csrf-token"));
            const body = await readJson(req),
              key = req.headers.get("idempotency-key"),
              match = req.headers.get("if-match");
            const result =
              section === "settings"
                ? await finance.writeSettings(
                    grant,
                    body,
                    req.method === "POST",
                    key,
                    match,
                    requestId,
                  )
                : await finance.writeFund(
                    grant,
                    id ?? null,
                    action === "status",
                    body,
                    key,
                    match,
                    requestId,
                  );
            headers.set("ETag", `"${result.data.version}"`);
            response = json(result.data, result.status, { replayed: result.replayed });
          } else if (section === "operations")
            response = json(await income.operation(grant, id as string));
          else if (history)
            response = json(
              await finance.historyPage(
                grant,
                section === "settings" ? "settings" : "fund",
                section === "settings" ? churchId.toHexString() : (id as string),
                url.searchParams,
              ),
            );
          else if (section === "settings") {
            const result = await finance.getSettings(grant);
            if (result.settings) headers.set("ETag", `"${result.settings.version}"`);
            response = json(result);
          } else if (id) {
            const result = await finance.getFund(grant, id);
            headers.set("ETag", `"${result.version}"`);
            response = json(result);
          } else response = json(await finance.list(grant, url.searchParams));
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
              canReadCare: true,
              canManageCare: false,
              prayerAudience: "shared",
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
              canReadCare: true,
              canManageCare: false,
              prayerAudience: ctx.account.role === "pastor" ? "all" : "shared",
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
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/care\/suggestions(?:\/[^/]+){0,3}$/.test(path)
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            tail = parts.slice(7 + offset),
            area = tail[0] === "signals" ? "signal" : "alert",
            segments = area === "signal" ? tail.slice(1) : tail;
          const special =
              area === "alert" && ["evaluate", "people", "operations"].includes(segments[0] ?? ""),
            operation = special && segments[0] === "operations",
            people = special && segments[0] === "people",
            evaluate = special && segments[0] === "evaluate",
            preview = segments.at(-1) === "preview",
            history = segments.at(-1) === "history",
            id = operation
              ? segments[1]
              : !special && segments[0] && segments[0] !== "preview"
                ? segments[0]
                : null;
          requireCondition(
            operation
              ? segments.length === 2
              : people || evaluate
                ? segments.length === 1
                : preview
                  ? segments.length <= (id ? 2 : 1)
                  : history
                    ? !!id && segments.length === 2
                    : segments.length <= (id ? 1 : 0),
            404,
            "NOT_FOUND",
          );
          requireCondition(!history || !!id, 404, "NOT_FOUND");
          requireCondition(area === "signal" || !preview || !!id, 404, "NOT_FOUND");
          requireCondition(
            preview || evaluate
              ? req.method === "POST"
              : operation || people || history
                ? req.method === "GET"
                : id
                  ? ["GET", "PATCH"].includes(req.method)
                  : ["GET", ...(area === "signal" ? ["POST"] : [])].includes(req.method),
            405,
            "METHOD_NOT_ALLOWED",
          );
          const writing = req.method !== "GET";
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          route = `P45.${requestRealm}.${special ? segments[0] : area}.${preview ? "preview" : history ? "history" : "root"}.${req.method}`;
          let grant: CareGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true),
              auth = identity.ownerGrant(ctx, writing || operation ? "care:manage" : "care:read");
            actorId = ctx.owner._id;
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              canReadCare: true,
              canManageCare: true,
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
            requireCondition(churchId.equals(actorChurchId), 404, "NOT_FOUND");
            const auth = churchIdentity.grant(ctx);
            auth.require(writing || operation ? "care:manage" : "care:read");
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: true,
              canReadCare: true,
              canManageCare: ["pastor", "secretary"].includes(ctx.account.role),
              canReadAttendance: true,
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          if (!writing) {
            if (people) response = json(await visitation.people(grant, url.searchParams));
            else if (operation) {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              response = json(await care.operation(grant, id as string));
            } else if (history)
              response = json(await care.history(grant, id as string, area, url.searchParams));
            else if (id) {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              const r = await care.get(grant, id, area);
              headers.set("ETag", `"${r.record.version}"`);
              response = json(r);
            } else response = json(await care.list(grant, url.searchParams, area));
          } else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
            const body = await readJson(req),
              match = req.headers.get("if-match");
            if (preview)
              response = json(
                area === "signal"
                  ? await care.previewSignal(grant, id ?? null, body, match)
                  : await care.previewAlert(grant, id as string, body, match),
              );
            else {
              const r = evaluate
                ? await care.evaluate(grant, body, req.headers.get("idempotency-key"), requestId)
                : area === "signal"
                  ? await care.saveSignal(
                      grant,
                      id ?? null,
                      body,
                      req.headers.get("idempotency-key"),
                      match,
                      requestId,
                    )
                  : await care.decide(
                      grant,
                      id as string,
                      body,
                      req.headers.get("idempotency-key"),
                      match,
                      requestId,
                    );
              response = json(r.data, r.status, { replayed: r.replayed });
            }
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/care\/prayers(?:\/(?:people|preview|operations\/[^/]+|[^/]+(?:\/(?:preview|history))?))?$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            tail = parts[7 + offset],
            action = parts[8 + offset],
            reserved = ["people", "operations", "preview"].includes(tail ?? ""),
            id = tail && !reserved ? tail : undefined,
            preview = tail === "preview" || action === "preview",
            writing = req.method !== "GET";
          requireCondition(!(tail === "people" || tail === "preview") || !action, 404, "NOT_FOUND");
          requireCondition(tail !== "operations" || !!action, 404, "NOT_FOUND");
          requireCondition(
            preview
              ? req.method === "POST"
              : !tail || (id && !action)
                ? (id ? ["GET", "PATCH"] : ["GET", "POST"]).includes(req.method)
                : req.method === "GET",
            405,
            "METHOD_NOT_ALLOWED",
          );
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          route = `P44.${requestRealm}.${reserved ? tail : "requests"}.${preview ? "preview" : action === "history" ? "history" : "root"}.${req.method}`;
          let grant: PrayerGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true),
              auth = identity.ownerGrant(
                ctx,
                writing || tail === "operations" ? "prayers:manage" : "prayers:read",
              );
            actorId = ctx.owner._id;
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              prayerAudience: "shared",
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
            requireCondition(churchId.equals(actorChurchId), 404, "NOT_FOUND");
            const auth = churchIdentity.grant(ctx);
            auth.require(writing || tail === "operations" ? "prayers:manage" : "prayers:read");
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: ["pastor", "secretary"].includes(ctx.account.role),
              prayerAudience: ctx.account.role === "pastor" ? "all" : "shared",
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          if (!writing) {
            if (tail === "people") response = json(await prayers.people(grant, url.searchParams));
            else if (tail === "operations") {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              response = json(await prayers.operation(grant, action as string));
            } else if (action === "history")
              response = json(await prayers.history(grant, id as string, url.searchParams));
            else if (id) {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              const p = await prayers.get(grant, id);
              headers.set("ETag", `"${p.version}"`);
              response = json(p);
            } else response = json(await prayers.list(grant, url.searchParams));
          } else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
            const body = await readJson(req),
              match = req.headers.get("if-match");
            if (preview) response = json(await prayers.preview(grant, id ?? null, body, match));
            else {
              const r = await prayers.save(
                grant,
                id ?? null,
                body,
                req.headers.get("idempotency-key"),
                match,
                requestId,
              );
              response = json(r.data, r.status, { replayed: r.replayed });
            }
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/care\/(?:people|operations\/[^/]+|cases(?:\/preview|\/[^/]+(?:\/(?:preview|entries|history))?)?)$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            section = parts[6 + offset],
            tail = parts[7 + offset],
            action = parts[8 + offset],
            id = section === "cases" && tail !== "preview" ? tail : undefined,
            preview = tail === "preview" || action === "preview",
            writing = req.method !== "GET";
          requireCondition(
            preview
              ? req.method === "POST"
              : section === "cases" && !action
                ? (id ? ["GET", "PATCH"] : ["GET", "POST"]).includes(req.method)
                : req.method === "GET",
            405,
            "METHOD_NOT_ALLOWED",
          );
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          route = `P43.${requestRealm}.${section}.${preview ? "preview" : (action ?? "root")}.${req.method}`;
          let grant: TenantGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true);
            actorId = ctx.owner._id;
            const auth = identity.ownerGrant(
              ctx,
              writing || section === "operations" ? "visitation:manage" : "visitation:read",
            );
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
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
            requireCondition(churchId.equals(actorChurchId), 404, "NOT_FOUND");
            const auth = churchIdentity.grant(ctx);
            auth.require(
              writing || section === "operations" ? "visitation:manage" : "visitation:read",
            );
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: ["pastor", "secretary"].includes(ctx.account.role),
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          if (!writing) {
            if (section === "people")
              response = json(await visitation.people(grant, url.searchParams));
            else if (section === "operations") {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              response = json(await visitation.operation(grant, tail as string));
            } else if (action === "entries")
              response = json(await visitation.entriesPage(grant, id as string, url.searchParams));
            else if (action === "history")
              response = json(await visitation.historyPage(grant, id as string, url.searchParams));
            else if (id) {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              const c = await visitation.get(grant, id);
              headers.set("ETag", `"${c.version}"`);
              response = json(c);
            } else response = json(await visitation.list(grant, url.searchParams));
          } else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
            const body = await readJson(req),
              match = req.headers.get("if-match");
            if (preview) response = json(await visitation.preview(grant, id ?? null, body, match));
            else {
              const r = await visitation.save(
                grant,
                id ?? null,
                body,
                req.headers.get("idempotency-key"),
                match,
                requestId,
              );
              response = json(r.data, r.status, { replayed: r.replayed });
            }
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/programs\/(?:units|occurrences|people|operations\/[^/]+|drafts(?:\/preview|\/[^/]+(?:\/(?:preview|history|editions|print|print-script))?)?)$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            section = parts[6 + offset],
            tail = parts[7 + offset],
            action = parts[8 + offset],
            id = section === "drafts" && tail !== "preview" ? tail : undefined,
            preview = tail === "preview" || action === "preview",
            print = action === "print" || action === "print-script",
            writing = req.method !== "GET";
          requireCondition(
            preview
              ? req.method === "POST"
              : section === "drafts" && !action
                ? (id ? ["GET", "PATCH"] : ["GET", "POST"]).includes(req.method)
                : req.method === "GET",
            405,
            "METHOD_NOT_ALLOWED",
          );
          printingProgram = action === "print";
          printing = printingProgram;
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          route = `P42.${requestRealm}.${section}.${preview ? "preview" : (action ?? "root")}.${req.method}`;
          let grant: ProgramGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true);
            actorId = ctx.owner._id;
            const auth = identity.ownerGrant(
              ctx,
              writing || section === "people" || section === "operations"
                ? "programs:manage"
                : "programs:read",
            );
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              canManagePrograms: true,
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
            requireCondition(churchId.equals(actorChurchId), 404, "NOT_FOUND");
            const auth = churchIdentity.grant(ctx);
            auth.require(
              writing || section === "people" || section === "operations"
                ? "programs:manage"
                : "programs:read",
            );
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: true,
              canManagePrograms: ["pastor", "secretary", "ministry_lead"].includes(
                ctx.account.role,
              ),
              ...(ctx.account.scope.kind === "assigned_units"
                ? { unitScope: ctx.account.scope.unitIds.map((id) => id.toLowerCase()) }
                : {}),
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          if (!writing) {
            if (section === "units") response = json(await programs.units(grant, url.searchParams));
            else if (section === "occurrences")
              response = json(await programs.occurrences(grant, url.searchParams));
            else if (section === "people")
              response = json(await programs.people(grant, url.searchParams));
            else if (section === "operations") {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              response = json(await programs.operation(grant, tail as string));
            } else if (action === "editions")
              response = json(await programs.editionsPage(grant, id as string, url.searchParams));
            else if (action === "history")
              response = json(await programs.historyPage(grant, id as string, url.searchParams));
            else if (print) {
              requireCondition(
                [...url.searchParams.keys()].every((k) => k === "version" || k === "revision") &&
                  url.searchParams.getAll("version").length === 1 &&
                  url.searchParams.getAll("revision").length <= 1,
                400,
                "INVALID_REQUEST",
              );
              const v = url.searchParams.get("version"),
                r = url.searchParams.get("revision");
              requireCondition(
                v &&
                  /^[1-9][0-9]*$/.test(v) &&
                  Number.isSafeInteger(Number(v)) &&
                  (!r || (/^[1-9][0-9]*$/.test(r) && Number.isSafeInteger(Number(r)))),
                400,
                "INVALID_REQUEST",
              );
              const p = await programs.printable(
                grant,
                id as string,
                r ? Number(r) : null,
                Number(v),
              );
              if (action === "print-script")
                response = new Response(programPrintScript, {
                  headers: { ...security, "Content-Type": "application/javascript" },
                });
              else {
                const files = await Array.fromAsync(
                  new Bun.Glob("*.css").scan({ cwd: resolve(options.dist ?? "dist", "assets") }),
                );
                response = new Response(
                  printProgram(
                    p,
                    files.map((n) => `/assets/${n}`),
                    `${path}-script?${url.searchParams}`,
                  ),
                  { headers: { ...security, "Content-Type": "text/html; charset=utf-8" } },
                );
              }
            } else if (id) {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              const d = await programs.get(grant, id);
              headers.set("ETag", `"${d.version}"`);
              response = json(d);
            } else response = json(await programs.list(grant, url.searchParams));
          } else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
            const body = await readJson(req),
              match = req.headers.get("if-match");
            if (preview) response = json(await programs.preview(grant, id ?? null, body, match));
            else {
              const r = await programs.save(
                grant,
                id ?? null,
                body,
                req.headers.get("idempotency-key"),
                match,
                requestId,
              );
              response = json(r.data, r.status, { replayed: r.replayed });
            }
          }
        } else if (
          /^\/api\/v1\/(?:owner\/)?churches\/[^/]+\/scheduling\/(?:people|units|operations\/[^/]+|occurrences(?:\/preview|\/[^/]+(?:\/(?:preview|history))?)?)$/.test(
            path,
          )
        ) {
          const parts = path.split("/"),
            isOwner = parts[3] === "owner",
            offset = isOwner ? 1 : 0,
            churchId = objectId(parts[4 + offset] as string),
            section = parts[6 + offset],
            tail = parts[7 + offset],
            action = parts[8 + offset],
            id = section === "occurrences" && tail !== "preview" ? tail : undefined,
            preview = tail === "preview" || action === "preview";
          const writing = req.method !== "GET",
            managing = writing || section !== "occurrences" || action === "history";
          requireCondition(
            section === "occurrences" && preview
              ? req.method === "POST"
              : section === "occurrences" && !action
                ? (id ? ["GET", "PATCH"] : ["GET", "POST"]).includes(req.method)
                : req.method === "GET",
            405,
            "METHOD_NOT_ALLOWED",
          );
          requestRealm = isOwner ? "owner" : "church";
          targetChurchId = churchId;
          route = `P41.${requestRealm}.${section}.${preview ? "preview" : action === "history" ? "history" : "root"}.${req.method}`;
          let grant: ScheduleGrant;
          if (isOwner) {
            const ctx = await identity.authorize(ownerToken, "owner", false, true);
            actorId = ctx.owner._id;
            const auth = identity.ownerGrant(ctx, managing ? "schedule:manage" : "schedule:read");
            grant = {
              actorKind: "owner",
              actorId,
              churchId,
              canWrite: true,
              canManageSchedule: true,
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
            requireCondition(churchId.equals(actorChurchId), 404, "NOT_FOUND");
            const auth = churchIdentity.grant(ctx);
            auth.require(managing ? "schedule:manage" : "schedule:read");
            grant = {
              actorKind: "church_user",
              actorId,
              churchId,
              canWrite: ["pastor", "secretary"].includes(ctx.account.role),
              canManageSchedule: ["pastor", "secretary"].includes(ctx.account.role),
              ...(ctx.account.scope.kind === "assigned_units"
                ? { unitScope: ctx.account.scope.unitIds.map((id) => id.toLowerCase()) }
                : {}),
              policyContext: `${policyVersion}:${ctx.account.version}`,
              fence: (tx) => auth.fence(tx),
            };
          }
          if (!writing) {
            if (section === "people")
              response = json(await scheduling.people(grant, url.searchParams));
            else if (section === "units")
              response = json(await scheduling.units(grant, url.searchParams));
            else if (section === "operations") {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              response = json(await scheduling.operation(grant, tail as string));
            } else if (action === "history")
              response = json(await scheduling.historyPage(grant, id as string, url.searchParams));
            else if (id) {
              requireCondition(!url.search, 400, "INVALID_REQUEST");
              const r = await scheduling.get(grant, id);
              headers.set("ETag", `"${r.version}"`);
              response = json(r);
            } else response = json(await scheduling.list(grant, url.searchParams));
          } else {
            requireCondition(!url.search, 400, "INVALID_REQUEST");
            requireCondition(req.headers.get("origin") === conf.origin, 403, "CSRF_FAILED");
            await identity.csrfSession(
              isOwner ? ownerToken : churchToken,
              requestRealm,
              req.headers.get("x-csrf-token"),
            );
            const body = await readJson(req),
              match = req.headers.get("if-match");
            if (preview) response = json(await scheduling.preview(grant, id ?? null, body, match));
            else {
              const r = await scheduling.save(
                grant,
                id ?? null,
                body,
                req.headers.get("idempotency-key"),
                match,
                requestId,
              );
              response = json(r.data, r.status, { replayed: r.replayed });
            }
          }
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
            let result = policyMatrix();
            if (!isOwner) {
              const ctx = await churchIdentity.authorize(churchToken, false, false);
              if (ctx.account.role === "pastor" || ctx.account.role === "treasurer")
                result = await finance.matrix(
                  { ...grant, financeRole: ctx.account.role, actorName: ctx.account.displayName },
                  result,
                );
              if (ctx.account.role !== "member")
                result = await expenses.matrix(expenseGrant(ctx), result);
            }
            response = json(result);
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
          const context = churchIdentity.context(ctx, id);
          if (ctx.account.role !== "member") {
            const expense = await expenses.context(expenseGrant(ctx));
            response = json({
              ...context,
              capabilities: [...context.capabilities, ...expense.capabilities],
              expense,
              availability: {
                ...context.availability,
                expense: expense.canReadAll || expense.canReadOwn ? "available" : "not_available",
              },
            });
          } else response = json(context);
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
              /^\/owner\/churches\/[a-f0-9]{24}(?:\/(?:accounts|manage|config|members|families|bans|roles|overview|attendance|rites|forms|worship|care))?$/i.test(
                path,
              ) ||
              /^\/h\/[a-z0-9-]{1,100}(?:\/(?:login|change-password|support|config|members|families|bans|roles|overview|access|attendance|rites|forms|worship|care|giving|expense))?$/i.test(
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
        (printingProgram
          ? programPrintError
          : printingCertificate
            ? certificatePrintError
            : printError)(
          messages[
            response.status === 401
              ? "REAUTH_REQUIRED"
              : printingProgram
                ? "PROGRAM_SOURCE_STALE"
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
