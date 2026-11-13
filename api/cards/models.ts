import type { ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
export interface CardGrant extends TenantGrant {
  canManageCards: boolean;
}
export interface MemberCard {
  _id: ObjectId;
  churchId: ObjectId;
  memberId: ObjectId;
  publicId: string;
  state: "active" | "revoked";
  version: number;
  snapshot: { fullName: string; memberCode: string; churchName: string; churchCode: string };
  issuedAt: Date;
  issuedBy: ObjectId;
  issuedByKind: "owner" | "church_user";
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface CardHistory {
  _id: ObjectId;
  churchId: ObjectId;
  memberId: ObjectId;
  cardId: ObjectId;
  event: "issued" | "replaced" | "revoked";
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  reason: string | null;
  actorId: ObjectId;
  actorKind: "owner" | "church_user";
  operationId: ObjectId;
  occurredAt: Date;
}
export function cardDto(c: MemberCard) {
  return {
    id: c._id.toHexString(),
    memberId: c.memberId.toHexString(),
    state: c.state,
    version: c.version,
    snapshot: c.snapshot,
    issuedAt: c.issuedAt.toISOString(),
    revokedAt: c.revokedAt?.toISOString() ?? null,
  };
}
export interface CardResolver {
  resolve(
    churchId: ObjectId,
    payload: string,
    tx: import("mongodb").ClientSession,
  ): Promise<{ cardId: ObjectId; memberId: ObjectId; version: number }>;
  verify(
    churchId: ObjectId,
    cardId: ObjectId,
    memberId: ObjectId,
    version: number,
    tx: import("mongodb").ClientSession,
  ): Promise<void>;
}
