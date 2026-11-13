import type { ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { PrepSessionRef } from "./prep-port";

export interface AttendanceGrant extends TenantGrant {
  canManageAttendance: boolean;
  canReadClasses?: boolean;
  canManageClasses?: boolean;
}
export interface AttendanceSession {
  _id: ObjectId;
  churchId: ObjectId;
  label: string;
  heldOn: string;
  location: string | null;
  scope: "church" | "unit";
  unitId: ObjectId | null;
  unitName: string | null;
  prepClass?: PrepSessionRef;
  reportingKind?: "general" | "sunday_reference";
  state: "draft" | "open" | "closed";
  version: number;
  generation: number;
  rowCount: number;
  includedCount: number;
  presentCount: number;
  capturedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface AttendanceParticipant {
  _id: ObjectId;
  churchId: ObjectId;
  sessionId: ObjectId;
  memberId: ObjectId;
  code: string;
  fullName: string;
  nameKey: string;
  nameTokens: string[];
  type: "believer" | "visitor";
  areaName: string | null;
  included: boolean;
  present: boolean;
  version: number;
  capturedAt: Date;
}
export interface AttendanceHistory {
  _id: ObjectId;
  churchId: ObjectId;
  sessionId: ObjectId;
  event: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  reason: string | null;
  actorKind: "owner" | "church_user";
  actorId: ObjectId;
  operationId: ObjectId;
  occurredAt: Date;
}
export const rosterLimit = 2000;
export function sessionDto(s: AttendanceSession) {
  return {
    id: s._id.toHexString(),
    ...(s.prepClass
      ? {
          prepClass: {
            courseId: s.prepClass.courseId.toHexString(),
            meetingId: s.prepClass.meetingId.toHexString(),
            lessonId: s.prepClass.lessonId.toHexString(),
            kind: s.prepClass.kind,
          },
        }
      : {}),
    label: s.label,
    heldOn: s.heldOn,
    location: s.location,
    scope: s.scope,
    unitId: s.unitId?.toHexString() ?? null,
    unitName: s.unitName,
    reportingKind: s.reportingKind ?? "general",
    state: s.state,
    version: s.version,
    generation: s.generation,
    rowCount: s.rowCount,
    includedCount: s.includedCount,
    presentCount: s.presentCount,
    absentCount: s.state === "closed" ? s.includedCount - s.presentCount : null,
    unrecordedCount: s.state === "open" ? s.includedCount - s.presentCount : null,
    capturedAt: s.capturedAt?.toISOString() ?? null,
  };
}
export function participantDto(p: AttendanceParticipant, state: AttendanceSession["state"]) {
  return {
    memberId: p.memberId.toHexString(),
    code: p.code,
    fullName: p.fullName,
    type: p.type,
    areaName: p.areaName,
    included: p.included,
    present: p.present,
    version: p.version,
    status: !p.included
      ? "excluded"
      : p.present
        ? "present"
        : state === "closed"
          ? "absent"
          : "unrecorded",
  };
}
