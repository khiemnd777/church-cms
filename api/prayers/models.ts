import type { ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { PrayerCommand, PrayerFields, PrayerRequester } from "./validation";
// Constructed only at authenticated composition roots, never from request fields.
export interface PrayerGrant extends TenantGrant {
  prayerAudience: "shared" | "all";
}
export interface RequesterSnapshot {
  kind: PrayerRequester["kind"];
  id: string | null;
  code: string | null;
  name: string | null;
}
export interface Prayer extends Omit<PrayerFields, "requester"> {
  _id: ObjectId;
  churchId: ObjectId;
  code: string;
  version: number;
  visibility: "shared" | "pastoral";
  state: "open" | "shared" | "closed" | "cancelled";
  requester: PrayerRequester;
  requesterSnapshot: RequesterSnapshot;
  requesterNameKey: string;
  contentKey: string;
  sharedOn: string | null;
  closeReason: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface PrayerHistory {
  _id: ObjectId;
  churchId: ObjectId;
  prayerId: ObjectId;
  event: PrayerCommand["action"];
  operationId: ObjectId;
  reason: string | null;
  before: object | null;
  after: object;
  actorKind: TenantGrant["actorKind"];
  actorId: ObjectId;
  occurredAt: Date;
}
export const prayerDto = (p: Prayer) => ({
  id: p._id.toHexString(),
  code: p.code,
  version: p.version,
  visibility: p.visibility,
  state: p.state,
  content: p.content,
  category: p.category,
  receivedOn: p.receivedOn,
  requester: p.requester,
  requesterSnapshot: p.requesterSnapshot,
  sharedOn: p.sharedOn,
  closeReason: p.closeReason,
  closedAt: p.closedAt?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});
