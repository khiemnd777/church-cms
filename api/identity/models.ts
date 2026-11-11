import type { ObjectId } from "mongodb";
export interface Owner {
  _id: ObjectId;
  email: string;
  emailKey: string;
  displayName: string;
  status: "active" | "locked";
  authEpoch: number;
  version: number;
  writeFence: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface Credential {
  _id: ObjectId;
  principalKind: "owner" | "church_user";
  principalId: ObjectId;
  churchId: ObjectId | null;
  passwordHash: string;
  kind: "temporary" | "permanent";
  temporaryExpiresAt?: Date;
  credentialVersion: number;
  writeFence: number;
  updatedAt: Date;
}
export type Realm = "owner" | "church";
export interface Session {
  _id: ObjectId;
  tokenHash: string;
  realm: Realm;
  principalId?: ObjectId;
  churchId: ObjectId | null;
  kind: "bootstrap" | "password_change" | "full";
  authEpoch?: number;
  credentialVersion?: number;
  csrfTokenHash: string;
  csrfKeyVersion: number;
  createdAt: Date;
  lastActivityAt: Date;
  lastPasswordVerifiedAt?: Date;
  absoluteExpiresAt: Date;
  revokedAt?: Date;
  writeFence: number;
}
export interface AuditEvent {
  operationId?: ObjectId;
  _id: ObjectId;
  occurredAt: Date;
  actorKind: "owner" | "church_user" | "system" | "anonymous";
  actorId?: ObjectId;
  actorChurchId: ObjectId | null;
  targetChurchId: ObjectId | null;
  eventType: string;
  targetType: string;
  targetId?: ObjectId;
  outcome: "success" | "denied" | "failure";
  changedFields: string[];
  safeSummary: string;
  requestId: string;
}
