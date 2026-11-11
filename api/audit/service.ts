import { type ClientSession, ObjectId } from "mongodb";
import type { Database } from "../infrastructure/database";
export class Audit {
  constructor(private db: Database) {}
  async organization(
    eventType: string,
    requestId: string,
    actor: { kind: "owner" | "church_user"; id: ObjectId; churchId: ObjectId | null },
    churchId: ObjectId,
    targetType: string,
    targetId: ObjectId,
    changedFields: string[],
    operationId: ObjectId,
    tx: ClientSession,
    safeSummary = eventType,
  ) {
    await this.db.audits.insertOne(
      {
        _id: new ObjectId(),
        occurredAt: new Date(),
        actorKind: actor.kind,
        actorId: actor.id,
        actorChurchId: actor.churchId,
        targetChurchId: churchId,
        eventType,
        targetType,
        targetId,
        changedFields,
        operationId,
        requestId,
        outcome: "success",
        safeSummary,
      },
      { session: tx },
    );
  }
  async principal(
    eventType: string,
    requestId: string,
    actor: {
      kind: "owner" | "church_user" | "anonymous";
      id?: ObjectId;
      churchId: ObjectId | null;
    },
    target: { id?: ObjectId; churchId: ObjectId | null },
    changedFields: string[] = [],
    session?: ClientSession,
    operationId?: ObjectId,
    outcome: "success" | "failure" | "denied" = "success",
    safeSummary = eventType,
  ) {
    await this.db.audits.insertOne(
      {
        _id: new ObjectId(),
        occurredAt: new Date(),
        actorKind: actor.kind,
        ...(actor.id ? { actorId: actor.id } : {}),
        actorChurchId: actor.churchId,
        targetChurchId: target.churchId,
        eventType,
        targetType: "account",
        ...(target.id ? { targetId: target.id } : {}),
        outcome,
        changedFields,
        safeSummary,
        requestId,
        ...(operationId ? { operationId } : {}),
      },
      { session },
    );
  }
  async church(
    eventType: string,
    requestId: string,
    actorId: ObjectId,
    churchId: ObjectId,
    operationId: ObjectId,
    changedFields: string[],
    session: ClientSession,
    safeSummary = eventType,
  ) {
    await this.db.audits.insertOne(
      {
        _id: new ObjectId(),
        occurredAt: new Date(),
        actorKind: "owner",
        actorId,
        actorChurchId: null,
        targetChurchId: churchId,
        eventType,
        targetType: "church",
        targetId: churchId,
        operationId,
        outcome: "success",
        changedFields,
        safeSummary,
        requestId,
      },
      { session },
    );
  }
  async record(
    eventType: string,
    requestId: string,
    actorId?: ObjectId,
    session?: ClientSession,
    outcome: "success" | "denied" | "failure" = "success",
    targetId?: ObjectId,
    details?: { changedFields: string[]; safeSummary: string },
  ) {
    await this.db.audits.insertOne(
      {
        _id: new ObjectId(),
        occurredAt: new Date(),
        actorKind: actorId ? "owner" : eventType === "owner.bootstrap" ? "system" : "anonymous",
        ...(actorId ? { actorId } : {}),
        actorChurchId: null,
        targetChurchId: null,
        eventType,
        targetType: "owner",
        ...((targetId ?? actorId) ? { targetId: targetId ?? actorId } : {}),
        outcome,
        changedFields:
          details?.changedFields ??
          (eventType === "owner.password_changed" ? ["credentialVersion", "authEpoch"] : []),
        safeSummary: details?.safeSummary ?? eventType,
        requestId,
      },
      { session },
    );
  }
}
