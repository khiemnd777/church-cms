import type { ObjectId } from "mongodb";
export const ageBands = [
  { key: "children", name: "Ban Thiếu nhi", min: 4, max: 11 },
  { key: "teens", name: "Ban Thiếu niên", min: 12, max: 17 },
  { key: "youth", name: "Ban Thanh niên", min: 18, max: 35 },
  { key: "adults", name: "Ban Trung niên", min: 36, max: 59 },
  { key: "seniors", name: "Ban Cao niên", min: 60, max: null },
] as const;
export interface Settings {
  _id: ObjectId;
  unitType: "area" | "cell_group" | "branch" | "custom";
  customUnitLabel?: string;
  defaultAssignmentMode: "auto" | "manual";
  version: number;
  writeFence: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: ObjectId;
  updatedBy: ObjectId;
  createdByKind: "owner" | "church_user";
  updatedByKind: "owner" | "church_user";
}
export const kinds = ["board", "age_ministry", "service_ministry", "area"] as const;
export type UnitKind = (typeof kinds)[number];
export interface Unit
  extends Omit<Settings, "unitType" | "customUnitLabel" | "defaultAssignmentMode"> {
  churchId: ObjectId;
  kind: UnitKind;
  namespace: "ministry" | "area";
  systemKey?: string;
  name: string;
  nameKey: string;
  status: "active" | "inactive";
}
export const normalizeName = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ");
export function settingsDto(s: Settings) {
  return {
    churchId: s._id.toHexString(),
    unitType: s.unitType,
    ...(s.customUnitLabel ? { customUnitLabel: s.customUnitLabel } : {}),
    defaultAssignmentMode: s.defaultAssignmentMode,
    version: s.version,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
export function unitDto(u: Unit) {
  return {
    id: u._id.toHexString(),
    churchId: u.churchId.toHexString(),
    kind: u.kind,
    name: u.name,
    status: u.status,
    version: u.version,
    system: !!u.systemKey,
    memberCount: { value: null, availability: "not_available" as const },
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}
