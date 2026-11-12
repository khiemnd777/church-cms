export const importFields = [
  "externalId",
  "memberCode",
  "fullName",
  "gender",
  "birthDate",
  "phone",
  "type",
  "membership",
  "participation",
  "familyCode",
  "familyKey",
  "householdRole",
  "area",
  "familyName",
  "familyAddress",
  "familyNotes",
  "familySinceYear",
  "assignmentMode",
  "ageMinistries",
  "serviceMinistries",
  "baptismStatus",
  "baptismDate",
  "baptismPlace",
  "visitorStage",
  "firstVisit",
  "believedOn",
  "referrer",
  "caregiverCode",
  "consent",
] as const;
export type ImportField = (typeof importFields)[number];
export const fieldLabels: Record<ImportField, string> = {
  externalId: "Mã nguồn",
  memberCode: "Mã thuộc viên đã có",
  fullName: "Họ tên",
  gender: "Giới tính",
  birthDate: "Ngày sinh",
  phone: "Điện thoại",
  type: "Loại hồ sơ",
  membership: "Tư cách",
  participation: "Trạng thái sinh hoạt",
  familyCode: "Mã gia đình đã có",
  familyKey: "Nhóm gia đình mới",
  householdRole: "Vai trò trong hộ",
  area: "Tên khu vực",
  familyName: "Tên gia đình mới",
  familyAddress: "Địa chỉ gia đình mới",
  familyNotes: "Ghi chú gia đình mới",
  familySinceYear: "Năm lập gia đình",
  assignmentMode: "Cách xếp ban",
  ageMinistries: "Ban tuổi (mỗi tên một dòng)",
  serviceMinistries: "Ban phục vụ (mỗi tên một dòng)",
  baptismStatus: "Tình trạng báp-têm",
  baptismDate: "Ngày báp-têm",
  baptismPlace: "Nơi báp-têm",
  visitorStage: "Giai đoạn thân hữu",
  firstVisit: "Ngày đến lần đầu",
  believedOn: "Ngày tin Chúa",
  referrer: "Người giới thiệu",
  caregiverCode: "Mã người chăm sóc",
  consent: "Đã có sự đồng ý (true/false)",
};
export const exportColumns = [
  "code",
  "fullName",
  "type",
  "membership",
  "participation",
  "familyCode",
  "area",
  "ministries",
  "gender",
  "birthDate",
  "phone",
  "householdRole",
  "baptismStatus",
  "baptismDate",
  "baptismPlace",
] as const;
export type ExportColumn = (typeof exportColumns)[number];
export const exportLabels: Record<ExportColumn, string> = {
  code: "Mã thuộc viên",
  fullName: "Họ tên",
  type: "Loại",
  membership: "Tư cách",
  participation: "Sinh hoạt",
  familyCode: "Mã gia đình",
  area: "Khu vực",
  ministries: "Ban ngành",
  gender: "Giới tính",
  birthDate: "Ngày sinh",
  phone: "Điện thoại",
  householdRole: "Vai trò trong hộ",
  baptismStatus: "Báp-têm",
  baptismDate: "Ngày báp-têm",
  baptismPlace: "Nơi báp-têm",
};
export type FileFormat = "csv" | "xlsx";
export interface SheetData {
  name: string;
  headers: string[];
  rows: string[][];
}
export interface Decision {
  action: "create" | "link" | "skip";
  memberCode?: string;
  reason: string;
}
export interface Candidate {
  id: string;
  code: string;
  fullName: string;
  birthDate: string | null;
  phone: string | null;
  version: number;
}
export interface RowReview {
  row: number;
  externalId: string;
  fullName: string;
  errors: string[];
  warnings: string[];
  candidates: Candidate[];
  action: "create" | "link" | "skip" | "review" | "error";
  target: Candidate | null;
  fingerprint: string;
  outcome?: RowOutcome | null;
}
export interface RowOutcome {
  row: number;
  action: "created" | "linked" | "skipped";
  memberId: string | null;
  memberCode: string | null;
}
export interface ImportDto {
  id: string;
  source: string;
  format: FileFormat;
  digest: string;
  sheets: string[];
  selectedSheet: string | null;
  headers: string[];
  mapping: Partial<Record<ImportField, string>>;
  version: number;
  state: "review" | "ready" | "partial" | "completed";
  total: number;
  processed: number;
  nextBatch: number;
  decisions: Record<string, Decision>;
  counts: Record<string, number>;
  planToken: string | null;
  expiresAt: string;
  updatedAt: string;
  lastError: string | null;
}
export interface ReviewPage {
  items: RowReview[];
  total: number;
  offset: number;
  nextOffset: number | null;
  counts: Record<string, number>;
}
export interface ExportDto {
  id: string;
  count: number;
  digest: string;
  format: FileFormat;
  columns: ExportColumn[];
  asOf: string;
  expiresAt: string;
  protectedCells: number;
}
export const limits = {
  fileBytes: 5 * 1024 * 1024,
  rows: 1000,
  columns: 40,
  cellChars: 4096,
  expandedBytes: 32 * 1024 * 1024,
  zipEntries: 200,
  batch: 100,
  exportRows: 5000,
} as const;
