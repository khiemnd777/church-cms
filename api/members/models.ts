export { resourceCode } from "../resource-code";

import type { ObjectId } from "mongodb";
export type MemberType = "believer" | "visitor";
export type Participation = "active" | "long_absent" | "transferred" | "deceased";
export interface Assignment {
  mode: "auto" | "manual";
  unitIds: ObjectId[];
  asOfDate: string;
}
export interface Baptism {
  status: "unknown" | "not_baptized" | "baptized";
  date: string | null;
  place: string | null;
}
export interface Visitor {
  stage: "new" | "exploring" | "believed";
  firstVisit: string | null;
  believedOn: string | null;
  referrer: string | null;
  caregiverId: ObjectId | null;
}
export interface Member {
  _id: ObjectId;
  churchId: ObjectId;
  code: string;
  fullName: string;
  nameKey: string;
  nameTokens: string[];
  gender: "male" | "female" | "unknown";
  birthDate: string | null;
  phone: string | null;
  phoneKey: string | null;
  type: MemberType;
  membership: "preparatory" | "member" | "child" | null;
  participation: Participation;
  familyId: ObjectId;
  householdRole: "head" | "spouse" | "child" | "relative" | "other";
  assignment: Assignment;
  baptism: Baptism;
  visitor: Visitor | null;
  convertedOn?: string;
  consent: {
    confirmed: true;
    wordingVersion: string;
    recordedAt: Date;
    actorId: ObjectId;
    actorKind: "owner" | "church_user";
  };
  version: number;
  writeFence: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: ObjectId;
  updatedBy: ObjectId;
}
export interface MemberHistory {
  _id: ObjectId;
  churchId: ObjectId;
  memberId: ObjectId;
  event: string;
  effectiveOn: string;
  eventDate: string | null;
  reason: string | null;
  actorKind: "owner" | "church_user";
  actorId: ObjectId;
  occurredAt: Date;
  version: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  changedFields: string[];
}
export const normalized = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ");
export const searchName = (name: string) => normalized(name).toLowerCase();
export const phoneKey = (phone: string | null) => phone?.replace(/[^\d]/g, "") || null;
export function memberSnapshot(m: Member) {
  return {
    code: m.code,
    fullName: m.fullName,
    gender: m.gender,
    birthDate: m.birthDate,
    phone: m.phone,
    type: m.type,
    membership: m.membership,
    participation: m.participation,
    familyId: m.familyId.toHexString(),
    householdRole: m.householdRole,
    assignment: { ...m.assignment, unitIds: m.assignment.unitIds.map((id) => id.toHexString()) },
    baptism: m.baptism,
    visitor: m.visitor
      ? { ...m.visitor, caregiverId: m.visitor.caregiverId?.toHexString() ?? null }
      : null,
    ...(m.convertedOn ? { convertedOn: m.convertedOn } : {}),
  };
}
