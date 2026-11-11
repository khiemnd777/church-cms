import { ObjectId } from "mongodb";
import { z } from "zod";
import { Audit } from "../audit/service";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import { hashPassword, temporaryPassword } from "./crypto";
export class OwnerOperations {
  constructor(private db: Database) {}
  async create(data: unknown) {
    const parsed = z
      .strictObject({
        email: z
          .string()
          .trim()
          .email()
          .max(254)
          .regex(/^[\x20-\x7e]+$/),
        displayName: z
          .string()
          .trim()
          .min(1)
          .refine((s) => [...s].length <= 160),
      })
      .safeParse(data);
    requireCondition(parsed.success, 422, "VALIDATION_FAILED");
    const { email, displayName } = parsed.data,
      emailKey = email.toLowerCase(),
      password = temporaryPassword(),
      passwordHash = await hashPassword(password),
      id = new ObjectId(),
      now = new Date(),
      expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
    await this.db.transaction(async (tx) => {
      requireCondition(
        !(await this.db.owners.findOne({ emailKey }, { session: tx })),
        409,
        "ACCOUNT_EXISTS",
      );
      await this.db.owners.insertOne(
        {
          _id: id,
          email,
          emailKey,
          displayName,
          status: "active",
          authEpoch: 1,
          version: 1,
          writeFence: 0,
          createdAt: now,
          updatedAt: now,
        },
        { session: tx },
      );
      await this.db.credentials.insertOne(
        {
          _id: new ObjectId(),
          principalKind: "owner",
          principalId: id,
          churchId: null,
          passwordHash,
          kind: "temporary",
          temporaryExpiresAt: expiresAt,
          credentialVersion: 1,
          writeFence: 0,
          updatedAt: now,
        },
        { session: tx },
      );
      const guard = await this.db.db
        .collection("platform_guard")
        .updateOne(
          { _id: "owner-registry" as never },
          { $inc: { activeOwnerCount: 1, version: 1 } },
          { session: tx },
        );
      requireCondition(guard.matchedCount === 1, 503, "DEPENDENCY_UNAVAILABLE");
      await new Audit(this.db).record(
        "owner.bootstrap",
        crypto.randomUUID(),
        undefined,
        tx,
        "success",
        id,
      );
    });
    return { employeeId: id.toHexString(), email, temporaryPassword: password, expiresAt };
  }
  async status(actorId: string, targetId: string, status: "active" | "locked") {
    requireCondition(
      ObjectId.isValid(actorId) && ObjectId.isValid(targetId),
      422,
      "VALIDATION_FAILED",
    );
    requireCondition(actorId !== targetId, 409, "LAST_OWNER_PROTECTED");
    const actor = new ObjectId(actorId),
      target = new ObjectId(targetId),
      now = new Date();
    await this.db.transaction(async (tx) => {
      const acting = await this.db.owners.updateOne(
        { _id: actor, status: "active" },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
      requireCondition(acting.matchedCount, 403, "FORBIDDEN");
      const owner = await this.db.owners.findOne({ _id: target }, { session: tx });
      requireCondition(owner, 404, "NOT_FOUND");
      if (owner.status === status) return;
      const guard = await this.db.db.collection("platform_guard").updateOne(
        {
          _id: "owner-registry" as never,
          ...(status === "locked" ? { activeOwnerCount: { $gt: 1 } } : {}),
        },
        { $inc: { activeOwnerCount: status === "active" ? 1 : -1, version: 1 } },
        { session: tx },
      );
      requireCondition(guard.matchedCount, 409, "LAST_OWNER_PROTECTED");
      const changed = await this.db.owners.updateOne(
        { _id: target, status: owner.status, version: owner.version },
        { $set: { status, updatedAt: now }, $inc: { authEpoch: 1, version: 1, writeFence: 1 } },
        { session: tx },
      );
      requireCondition(changed.modifiedCount, 412, "VERSION_CONFLICT");
      await this.db.sessions.updateMany(
        { realm: "owner", principalId: target, revokedAt: { $exists: false } },
        { $set: { revokedAt: now }, $inc: { writeFence: 1 } },
        { session: tx },
      );
      await new Audit(this.db).record(
        "owner.status_changed",
        crypto.randomUUID(),
        actor,
        tx,
        "success",
        target,
        { changedFields: ["status", "authEpoch"], safeSummary: `owner.status_changed:${status}` },
      );
    });
  }
}
