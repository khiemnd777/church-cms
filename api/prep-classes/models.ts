import type { ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
export interface ClassGrant extends TenantGrant {
  canManageClasses: boolean;
  canInterview: boolean;
}
export interface Lesson {
  id: ObjectId;
  title: string;
}
export interface Course {
  writeFence?: number;
  _id: ObjectId;
  churchId: ObjectId;
  name: string;
  startOn: string;
  teacher: string | null;
  baptismOn: string | null;
  lessons: Lesson[];
  state: "draft" | "active" | "closed";
  version: number;
  enrollmentCount: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface Enrollment {
  writeFence?: number;
  _id: ObjectId;
  churchId: ObjectId;
  courseId: ObjectId;
  memberId: ObjectId;
  fullName: string;
  code: string;
  nameKey: string;
  birthDate: string | null;
  areaName: string | null;
  state: "studying" | "withdrawn";
  version: number;
  interview: { heldOn: string; interviewer: string; actorId: ObjectId; actorKind: string } | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface Meeting {
  _id: ObjectId;
  churchId: ObjectId;
  courseId: ObjectId;
  lessonId: ObjectId;
  sessionId: ObjectId;
  kind: "regular" | "makeup";
  notBefore: string;
  memberIds: ObjectId[] | null;
  createdAt: Date;
}
export interface ClassHistory {
  _id: ObjectId;
  churchId: ObjectId;
  courseId: ObjectId;
  memberId: ObjectId | null;
  event: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  reason: string | null;
  actorId: ObjectId;
  actorKind: string;
  operationId: ObjectId;
  occurredAt: Date;
}
export const courseDto = (c: Course) => ({
  id: c._id.toHexString(),
  name: c.name,
  startOn: c.startOn,
  teacher: c.teacher,
  baptismOn: c.baptismOn,
  lessons: c.lessons.map((l) => ({ id: l.id.toHexString(), title: l.title })),
  state: c.state,
  version: c.version,
  enrollmentCount: c.enrollmentCount,
});
export const enrollmentDto = (e: Enrollment) => ({
  id: e._id.toHexString(),
  memberId: e.memberId.toHexString(),
  fullName: e.fullName,
  code: e.code,
  birthDate: e.birthDate,
  areaName: e.areaName,
  state: e.state,
  version: e.version,
  interview: e.interview
    ? { heldOn: e.interview.heldOn, interviewer: e.interview.interviewer }
    : null,
});
