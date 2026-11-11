import type { settingsDto, unitDto } from "../api/organization/models";
import { churchRequest, type Intent, ownerRequest } from "./api";
export type SettingsDto = ReturnType<typeof settingsDto>;
export type UnitDto = ReturnType<typeof unitDto>;
export type OrganizationRealm = "owner" | "church";
export interface OrganizationIntent extends Intent {
  churchId: string;
  realm: OrganizationRealm;
  principalKey: string;
}
export interface SettingsReply {
  configured: boolean;
  settings: SettingsDto | null;
  defaults: { unitType: SettingsDto["unitType"]; defaultAssignmentMode: "auto" | "manual" };
  ageBands: { key: string; name: string; min: number; max: number | null }[];
}
export interface UnitPage {
  items: UnitDto[];
  nextCursor: string | null;
  configured: boolean;
}
export const organizationPath = (realm: OrganizationRealm, id: string) =>
  `${realm === "owner" ? "owner/" : ""}churches/${id}/organization`;
export const organizationRequest = <T>(
  realm: OrganizationRealm,
  path: string,
  options?: Parameters<typeof ownerRequest>[1],
) => (realm === "owner" ? ownerRequest<T> : churchRequest<T>)(path, options);
export const sendOrganizationIntent = (i: OrganizationIntent) =>
  organizationRequest(i.realm, i.path, {
    method: i.method,
    body: i.body,
    headers: { "Idempotency-Key": i.key, ...(i.version ? { "If-Match": `"${i.version}"` } : {}) },
  });
