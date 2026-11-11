import type { ObjectId } from "mongodb";
export const roles = ["pastor", "secretary", "treasurer", "ministry_lead", "member"] as const;
export type Role = (typeof roles)[number];
export type Scope =
  | { kind: "church" }
  | { kind: "self" }
  | { kind: "assigned_units"; unitIds: string[] };
export interface Account {
  _id: ObjectId;
  churchId: ObjectId;
  email: string;
  emailKey: string;
  displayName: string;
  displayNameKey: string;
  role: Role;
  scope: Scope;
  subjectMemberId?: ObjectId;
  status: "active" | "locked";
  authEpoch: number;
  version: number;
  writeFence: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: ObjectId;
  updatedBy?: ObjectId;
}
export function accountDto(a: Account) {
  return {
    id: a._id.toHexString(),
    churchId: a.churchId.toHexString(),
    email: a.email,
    displayName: a.displayName,
    role: a.role,
    scope: a.scope,
    status: a.status,
    version: a.version,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
