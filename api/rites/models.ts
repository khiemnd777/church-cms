import type { ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { PersonInput, RecordInput, RiteCommand } from "./validation";
export interface RiteGrant extends TenantGrant {
  canManageRites: boolean;
}
export interface PersonSnapshot {
  source: PersonInput["source"];
  memberId: string | null;
  fullName: string;
  birthDate: string | null;
  code: string | null;
  version: number | null;
}
export interface RiteRecord {
  writeFence?: number;
  _id: ObjectId;
  churchId: ObjectId;
  kind: RecordInput["payload"]["kind"];
  input: RecordInput;
  people: PersonSnapshot[];
  memberIds: ObjectId[];
  subjectMemberId: ObjectId | null;
  searchTokens: string[];
  state: RiteCommand["state"];
  version: number;
  recordedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface RiteHistory {
  _id: ObjectId;
  churchId: ObjectId;
  riteId: ObjectId;
  event: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  reason: string | null;
  actorId: ObjectId;
  actorKind: string;
  operationId: ObjectId;
  occurredAt: Date;
}
export const riteDto = (r: RiteRecord) => ({
  id: r._id.toHexString(),
  kind: r.kind,
  record: r.input,
  people: r.people,
  state: r.state,
  version: r.version,
  recordedAt: r.recordedAt?.toISOString() ?? null,
});
export function participants(input: RecordInput): PersonInput[] {
  const p = input.payload;
  switch (p.kind) {
    case "baptism":
      return [p.person, ...(p.officiant ? [p.officiant] : [])];
    case "dedication":
      return [p.child, ...p.parents.map((p) => p.person), ...(p.officiant ? [p.officiant] : [])];
    case "marriage":
      return [p.groom, p.bride, ...(p.officiant ? [p.officiant] : [])];
    case "funeral":
      return [p.person];
    case "communion":
      return p.officiant ? [p.officiant] : [];
  }
}
