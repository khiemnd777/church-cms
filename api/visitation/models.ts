import type { ObjectId } from "mongodb";
import type { VisitEntryInput, VisitFields, VisitTarget } from "./validation";
export interface VisitPerson {
  id: string;
  code: string;
  fullName: string;
}
export interface VisitSnapshot {
  kind: VisitTarget["kind"];
  id: string;
  code: string;
  name: string;
  phone: string | null;
  familyId: string | null;
  familyCode: string | null;
  familyName: string | null;
  address: string | null;
}
export interface VisitCase extends Omit<VisitFields, "assigneeId"> {
  _id: ObjectId;
  churchId: ObjectId;
  code: string;
  version: number;
  state: "open" | "completed" | "cancelled";
  targetKind: VisitTarget["kind"];
  targetId: ObjectId;
  targetSnapshot: VisitSnapshot;
  targetNameKey: string;
  assigneeId: ObjectId | null;
  assigneeSnapshot: VisitPerson | null;
  entryCount: number;
  visitedCount: number;
  closeReason: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface VisitEntry extends Omit<VisitEntryInput, "participantIds"> {
  _id: ObjectId;
  churchId: ObjectId;
  caseId: ObjectId;
  version: number;
  participantIds: ObjectId[];
  participants: VisitPerson[];
  targetSnapshot: VisitSnapshot;
  createdAt: Date;
  updatedAt: Date;
}
export interface VisitHistory {
  _id: ObjectId;
  churchId: ObjectId;
  caseId: ObjectId;
  entryId: ObjectId | null;
  event: VisitCommandAction;
  operationId: ObjectId;
  reason: string | null;
  before: object | null;
  after: object;
  actorId: ObjectId;
  actorKind: "owner" | "church_user";
  occurredAt: Date;
}
type VisitCommandAction = "create" | "update" | "record" | "correct" | "complete" | "cancel";
export const caseDto = (c: VisitCase) => ({
  id: c._id.toHexString(),
  code: c.code,
  version: c.version,
  state: c.state,
  target: { kind: c.targetKind, id: c.targetId.toHexString() },
  targetSnapshot: c.targetSnapshot,
  reasonCode: c.reasonCode,
  description: c.description,
  priority: c.priority,
  plannedOn: c.plannedOn,
  assigneeId: c.assigneeId?.toHexString() ?? null,
  assignee: c.assigneeSnapshot,
  entryCount: c.entryCount,
  visitedCount: c.visitedCount,
  closeReason: c.closeReason,
  closedAt: c.closedAt?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});
export const entryDto = (e: VisitEntry) => ({
  id: e._id.toHexString(),
  caseId: e.caseId.toHexString(),
  version: e.version,
  visitedOn: e.visitedOn,
  participantIds: e.participantIds.map((id) => id.toHexString()),
  participants: e.participants,
  outcome: e.outcome,
  note: e.note,
  targetSnapshot: e.targetSnapshot,
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
});
