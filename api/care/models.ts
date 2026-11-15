import type { ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { CareKind } from "./validation";
export interface CareGrant extends TenantGrant {
  canReadCare: boolean;
  canManageCare: boolean;
}
export type CareTarget = { kind: "member" | "family"; id: string };
export type CareSnapshot = CareTarget & { code: string; name: string };
export interface CareSignal {
  _id: ObjectId;
  churchId: ObjectId;
  code: string;
  version: number;
  targetKind: CareTarget["kind"];
  targetId: ObjectId;
  targetSnapshot: CareSnapshot;
  targetNameKey: string;
  kind: Exclude<CareKind, "absence">;
  occurredOn: string;
  summary: string | null;
  state: "open" | "ended";
  createdAt: Date;
  updatedAt: Date;
}
export interface CareEvidence {
  type: "attendance" | "belief" | "signal";
  id: string;
  version: number;
  day: string;
  summary: string | null;
}
export interface CareAlert {
  _id: ObjectId;
  churchId: ObjectId;
  code: string;
  version: number;
  targetKind: CareTarget["kind"];
  targetId: ObjectId;
  targetSnapshot: CareSnapshot;
  targetNameKey: string;
  kind: CareKind;
  state: "pending" | "linked" | "dismissed" | "expired";
  episodeActive: boolean;
  availability: "eligible" | "unknown" | "ineligible";
  evidence: CareEvidence[];
  caseId: ObjectId | null;
  decisionReason: string | null;
  lastEvaluatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
export interface CareHistory {
  _id: ObjectId;
  churchId: ObjectId;
  resourceKind: "signal" | "alert";
  resourceId: ObjectId;
  event: string;
  before: object | null;
  after: object;
  reason: string | null;
  actorId: ObjectId;
  actorKind: "owner" | "church_user";
  operationId: ObjectId;
  occurredAt: Date;
}
export interface CareAssessment {
  _id: ObjectId;
  lastEvaluatedAt: Date;
  lastCompleteAt: Date | null;
  complete: boolean;
  context: string;
}
export const signalDto = (s: CareSignal) => ({
  id: s._id.toHexString(),
  code: s.code,
  version: s.version,
  target: { kind: s.targetKind, id: s.targetId.toHexString() },
  targetSnapshot: s.targetSnapshot,
  kind: s.kind,
  occurredOn: s.occurredOn,
  summary: s.summary,
  state: s.state,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});
export const alertDto = (s: CareAlert) => ({
  id: s._id.toHexString(),
  code: s.code,
  version: s.version,
  target: { kind: s.targetKind, id: s.targetId.toHexString() },
  targetSnapshot: s.targetSnapshot,
  kind: s.kind,
  state: s.state,
  episodeActive: s.episodeActive,
  availability: s.availability,
  evidence: s.evidence,
  caseId: s.caseId?.toHexString() ?? null,
  decisionReason: s.decisionReason,
  lastEvaluatedAt: s.lastEvaluatedAt.toISOString(),
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});
