import type { Members } from "../api/members/service";
import type { SettingsReply, UnitPage } from "./organization-api";
export type MemberDto = Awaited<ReturnType<Members["get"]>>;
export interface MemberPage {
  items: Omit<MemberDto, "familyMembers">[];
  nextCursor: string | null;
  attendanceWindow?: { until: string; fingerprint: string } | null;
}
export type FamilyPage = Awaited<ReturnType<Members["familyPicker"]>>;
export type HistoryPage = Awaited<ReturnType<Members["history"]>>;
export interface MemberOptions extends SettingsReply {
  asOfDate: string;
  units: UnitPage;
}
export interface MemberMutation {
  member: { id: string; code: string; version: number };
  operationId?: string;
}
export const memberTypeLabels = { believer: "Tín hữu", visitor: "Thân hữu" };
export const membershipLabels = { preparatory: "Dự bị", member: "Thành viên", child: "Thiếu nhi" };
export const participationLabels = {
  active: "Đang sinh hoạt",
  long_absent: "Vắng lâu",
  transferred: "Chuyển đi",
  deceased: "Qua đời",
};
export const stageLabels = { new: "Mới đến", exploring: "Đang tìm hiểu", believed: "Đã tin Chúa" };
export const baptismLabels = {
  unknown: "Chưa rõ",
  not_baptized: "Chưa Báp-têm",
  baptized: "Đã Báp-têm",
};
export const householdLabels = {
  head: "Chủ hộ",
  spouse: "Vợ/chồng",
  child: "Con",
  relative: "Người thân",
  other: "Thành viên khác",
};
export const genderLabels = { male: "Nam", female: "Nữ", unknown: "Chưa rõ" };
export const dayLabel = (day: string | null | undefined) =>
  day ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : "—";
