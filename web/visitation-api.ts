import type { Visitation } from "../api/visitation/service";
export type CareCase = Awaited<ReturnType<Visitation["get"]>>;
export type CareCaseRow = Awaited<ReturnType<Visitation["list"]>>["items"][number];
export type CarePage = Awaited<ReturnType<Visitation["list"]>>;
export type CarePreview = Awaited<ReturnType<Visitation["preview"]>>;
export type CareEntries = Awaited<ReturnType<Visitation["entriesPage"]>>;
export type CareEntry = CareEntries["items"][number];
export type CareHistory = Awaited<ReturnType<Visitation["historyPage"]>>;
export type CarePeople = Awaited<ReturnType<Visitation["people"]>>;
export const careReasons = {
  absence: "Vắng nhóm",
  illness: "Đau ốm",
  new_believer: "Tân tín hữu",
  bereavement: "Gia đình có tang",
  other: "Khác",
};
export const careStates = { open: "Đang mở", completed: "Hoàn tất", cancelled: "Đã hủy" };
export const careOutcomes = { visited: "Đã gặp", not_met: "Không gặp", declined: "Từ chối" };
export const careActions = {
  create: "Tạo hồ sơ",
  update: "Sửa phân công / thông tin",
  record: "Ghi lần thăm",
  correct: "Đính chính lần thăm",
  complete: "Hoàn tất hồ sơ",
  cancel: "Hủy hồ sơ",
};
