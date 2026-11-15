import type { ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { ProgramRow } from "./validation";
export interface ProgramGrant extends TenantGrant {
  canManagePrograms: boolean;
}
export interface AssignedPerson {
  id: string;
  fullName: string;
  code: string;
}
export interface ProgramSnapshot {
  churchName: string;
  unitName: string;
  label: string;
  startAt: string;
  endAt: string;
  location: string | null;
  scripture: string | null;
  theme: string | null;
  sourceVersion: number;
  sourceAvailable: boolean;
  termLabel: string | null;
  capturedAt: string;
}
export interface ProgramDraft {
  _id: ObjectId;
  churchId: ObjectId;
  unitId: ObjectId;
  occurrenceId: ObjectId;
  version: number;
  state: "draft" | "finalized";
  rows: ProgramRow[];
  baseline: ProgramRow[];
  people: AssignedPerson[];
  snapshot: ProgramSnapshot;
  latestRevision: number;
  latestEditionId: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface ProgramEdition {
  _id: ObjectId;
  churchId: ObjectId;
  programId: ObjectId;
  unitId: ObjectId;
  occurrenceId: ObjectId;
  revision: number;
  rows: ProgramRow[];
  people: AssignedPerson[];
  snapshot: ProgramSnapshot;
  reason: string | null;
  templateVersion: "P42-r1";
  actorId: ObjectId;
  actorKind: "owner" | "church_user";
  createdAt: Date;
}
export interface ProgramHistory {
  _id: ObjectId;
  churchId: ObjectId;
  programId: ObjectId;
  operationId: ObjectId;
  event: string;
  reason: string | null;
  before: object | null;
  after: object;
  actorId: ObjectId;
  actorKind: "owner" | "church_user";
  occurredAt: Date;
}
export function draftDto(d: ProgramDraft) {
  return {
    id: d._id.toHexString(),
    unitId: d.unitId.toHexString(),
    occurrenceId: d.occurrenceId.toHexString(),
    version: d.version,
    state: d.state,
    rows: d.rows,
    people: d.people,
    snapshot: d.snapshot,
    latestRevision: d.latestRevision,
    latestEditionId: d.latestEditionId?.toHexString() ?? null,
  };
}
export function editionDto(e: ProgramEdition) {
  return {
    id: e._id.toHexString(),
    programId: e.programId.toHexString(),
    unitId: e.unitId.toHexString(),
    occurrenceId: e.occurrenceId.toHexString(),
    revision: e.revision,
    rows: e.rows,
    people: e.people,
    snapshot: e.snapshot,
    reason: e.reason,
    templateVersion: e.templateVersion,
    createdAt: e.createdAt.toISOString(),
  };
}
