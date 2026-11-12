import type { policyMatrix } from "../api/authorization/church-policy";
import type { OrganizationRuntime } from "../api/organization/runtime";
export type Overview = Awaited<ReturnType<OrganizationRuntime["overview"]>>;
export type RuntimeUnit = Overview["items"][number];
export type Roster = Awaited<ReturnType<OrganizationRuntime["roster"]>>;
export type Terms = Awaited<ReturnType<OrganizationRuntime["termList"]>>;
export type Term = Terms["items"][number];
export type OrgHistory = Awaited<ReturnType<OrganizationRuntime["historyPage"]>>;
export type PolicyMatrix = ReturnType<typeof policyMatrix>;
export const positionLabels = { secretary: "Thư ký", treasurer: "Thủ quỹ", deacon: "Chấp sự" };
export const termStates = {
  draft: "Nháp",
  confirmed: "Đã xác nhận",
  ended: "Đã kết thúc",
  cancelled: "Đã hủy",
};
