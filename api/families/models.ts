import type { ObjectId } from "mongodb";
export interface FamilyMeta {
  name: string | null;
  address: string | null;
  notes: string | null;
  sinceYear: number | null;
  areaId: ObjectId | null;
}
export interface Family extends FamilyMeta {
  _id: ObjectId;
  churchId: ObjectId;
  code: string;
  status: "active" | "merged";
  mergedIntoId: ObjectId | null;
  version: number;
  writeFence: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: ObjectId;
}
export interface LinkChange {
  fullName?: string;
  fromCode?: string;
  toCode?: string;
  id: string;
  fromFamilyId: string;
  toFamilyId: string;
  fromRole: string;
  toRole: string;
}
export interface FamilyHistory {
  _id: ObjectId;
  churchId: ObjectId;
  familyId: ObjectId;
  event: string;
  operationId: ObjectId;
  version: number;
  effectiveOn: string;
  reason: string | null;
  actorId: ObjectId;
  actorKind: "owner" | "church_user";
  occurredAt: Date;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  relatedFamilyIds: ObjectId[];
  changes: LinkChange[];
}
export const familySnapshot = (f: Family) => ({
  id: f._id.toHexString(),
  code: f.code,
  name: f.name,
  address: f.address,
  notes: f.notes,
  sinceYear: f.sinceYear,
  areaId: f.areaId?.toHexString() ?? null,
  status: f.status,
  mergedIntoId: f.mergedIntoId?.toHexString() ?? null,
  version: f.version,
});
