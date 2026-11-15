import type { ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { ScheduleCommand, ScheduleInput } from "./validation";
export interface ScheduleGrant extends TenantGrant {
  canManageSchedule: boolean;
}
export interface ScheduleRow {
  _id: ObjectId;
  churchId: ObjectId;
  seriesId: ObjectId;
  generation: number;
  slot: string;
  input: ScheduleInput;
  startAt: Date;
  endAt: Date;
  state: ScheduleCommand["state"];
  unitName: string | null;
  speakerName: string | null;
  leaderName: string | null;
  choirName: string | null;
  memberIds: ObjectId[];
  version: number;
  exception: boolean;
  superseded: boolean;
  programFence?: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface ScheduleSeries {
  _id: ObjectId;
  churchId: ObjectId;
  generation: number;
  version: number;
  input: ScheduleInput;
  createdAt: Date;
  updatedAt: Date;
}
export interface ScheduleState {
  _id: ObjectId;
  revision: number;
}
export interface ScheduleHistory {
  _id: ObjectId;
  churchId: ObjectId;
  occurrenceId: ObjectId;
  operationId: ObjectId;
  event: string;
  before: object | null;
  after: object;
  reason: string | null;
  actorId: ObjectId;
  actorKind: "owner" | "church_user";
  occurredAt: Date;
}
export function scheduleDto(r: ScheduleRow) {
  return {
    id: r._id.toHexString(),
    seriesId: r.seriesId.toHexString(),
    generation: r.generation,
    slot: r.slot,
    input: r.input,
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    state: r.state,
    unitName: r.unitName,
    speakerName: r.speakerName,
    leaderName: r.leaderName,
    choirName: r.choirName,
    version: r.version,
    exception: r.exception,
    superseded: r.superseded,
  };
}
