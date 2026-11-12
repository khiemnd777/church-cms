import type { FamilyApplication } from "../api/families/application";
import type { FamilyCommand, FamilyInput, RoleChange } from "../api/families/validation";
export type { FamilyCommand, FamilyInput, RoleChange };
export type FamilyDto = Awaited<ReturnType<FamilyApplication["get"]>>;
export type FamilyCards = Awaited<ReturnType<FamilyApplication["list"]>>;
export type FamilyPeople = Awaited<ReturnType<FamilyApplication["members"]>>;
export type FamilyHistory = Awaited<ReturnType<FamilyApplication["history"]>>;
export type FamilyPreview = Awaited<ReturnType<FamilyApplication["preview"]>>;
export const emptyFamily: FamilyInput = {
  name: null,
  address: null,
  notes: null,
  sinceYear: null,
  areaId: null,
};
export const familyEventLabels: Record<string, string> = {
  created: "Tạo gia đình",
  updated: "Sửa thông tin hộ",
  area_changed: "Đổi khu vực",
  roles_changed: "Đổi vai trò",
  member_joined: "Thêm thành viên",
  roles: "Đổi vai trò",
  transfer: "Chuyển người",
  transfer_received: "Nhận thành viên",
  split: "Tách hộ",
  split_created: "Hộ mới từ tách hộ",
  merge: "Gộp vào hộ khác",
  merge_received: "Nhận hộ gộp",
};
