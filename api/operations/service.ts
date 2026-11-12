import { type ClientSession, MongoError, MongoServerError, ObjectId } from "mongodb";
import type { OwnerGrant } from "../authorization/owner-grant";
import type { TenantGrant } from "../authorization/tenant-grant";
import { AppError, requireCondition } from "../errors";
import { digest } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import type { OrganizationGrant } from "../organization/grant";
export interface Operation {
  _id: ObjectId;
  ownerId?: ObjectId;
  schemaVersion?: 2;
  actorKind?: "owner" | "church_user";
  actorId?: ObjectId;
  churchId?: ObjectId;
  method: string;
  routeKey: string;
  keyHash: string;
  payloadHash: string;
  status: "completed";
  resourceRefs: { type: string; id: string }[];
  safeResult: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}
export interface OperationResult {
  data: Record<string, unknown>;
  status: number;
  replayed: boolean;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export class Operations {
  private running = new Set<string>();
  constructor(
    private db: Database,
    private now: () => Date = () => new Date(),
  ) {}
  private get collection() {
    return this.db.db.collection<Operation>("idempotency_operations");
  }
  private replay(op: Operation, payloadHash: string): OperationResult {
    requireCondition(
      op.expiresAt > this.now() && this.now().getTime() - op.createdAt.getTime() < 24 * 60 * 60_000,
      409,
      "IDEMPOTENCY_EXPIRED",
    );
    requireCondition(op.payloadHash === payloadHash, 409, "IDEMPOTENCY_CONFLICT");
    return {
      data: { ...op.safeResult, operationId: op._id.toHexString() },
      status: 200,
      replayed: true,
    };
  }
  async replayResult(
    grant: OwnerGrant,
    method: string,
    routeKey: string,
    key: string,
    payload: unknown,
    ifMatch: number | null,
  ) {
    const previous = await this.collection.findOne({
      ownerId: grant.actorId,
      method,
      routeKey,
      keyHash: digest(key.toLowerCase()),
    });
    return previous ? this.replay(previous, digest(canonical({ payload, ifMatch }))) : null;
  }
  async execute(
    grant: OwnerGrant,
    method: string,
    routeKey: string,
    key: string | null,
    payload: unknown,
    ifMatch: number | null,
    mutate: (
      tx: ClientSession,
      operationId: ObjectId,
    ) => Promise<{ safeResult: Record<string, unknown>; resourceRefs: Operation["resourceRefs"] }>,
    status = 200,
  ): Promise<OperationResult> {
    return this.executeScoped(
      grant,
      { ownerId: grant.actorId },
      method,
      routeKey,
      key,
      payload,
      ifMatch,
      mutate,
      status,
    );
  }
  async executeOrganization(
    grant: OrganizationGrant,
    method: string,
    routeKey: string,
    key: string | null,
    payload: unknown,
    ifMatch: number | null,
    mutate: (
      tx: ClientSession,
      operationId: ObjectId,
    ) => Promise<{ safeResult: Record<string, unknown>; resourceRefs: Operation["resourceRefs"] }>,
    status = 200,
  ) {
    return this.executeTenant(grant, method, routeKey, key, payload, ifMatch, mutate, status);
  }
  async executeTenant(
    grant: TenantGrant,
    method: string,
    routeKey: string,
    key: string | null,
    payload: unknown,
    ifMatch: number | null,
    mutate: (
      tx: ClientSession,
      operationId: ObjectId,
    ) => Promise<{ safeResult: Record<string, unknown>; resourceRefs: Operation["resourceRefs"] }>,
    status = 200,
  ) {
    requireCondition(grant.canWrite, 403, "FORBIDDEN");
    return this.executeScoped(
      grant,
      {
        schemaVersion: 2,
        actorKind: grant.actorKind,
        actorId: grant.actorId,
        churchId: grant.churchId,
      },
      method,
      routeKey,
      key,
      payload,
      ifMatch,
      mutate,
      status,
      true,
    );
  }
  private async executeScoped(
    grant: OwnerGrant,
    scope: Pick<Operation, "ownerId" | "schemaVersion" | "actorKind" | "actorId" | "churchId">,
    method: string,
    routeKey: string,
    key: string | null,
    payload: unknown,
    ifMatch: number | null,
    mutate: (
      tx: ClientSession,
      operationId: ObjectId,
    ) => Promise<{ safeResult: Record<string, unknown>; resourceRefs: Operation["resourceRefs"] }>,
    status: number,
    fencedReplay = false,
  ): Promise<OperationResult> {
    requireCondition(
      key && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key),
      400,
      "INVALID_REQUEST",
    );
    const lookup = { ...scope, method, routeKey, keyHash: digest(key.toLowerCase()) },
      payloadHash = digest(canonical({ payload, ifMatch }));
    const previous = fencedReplay ? null : await this.collection.findOne(lookup);
    if (previous) return this.replay(previous, payloadHash);
    const runningKey = canonical(lookup);
    requireCondition(!this.running.has(runningKey), 409, "OPERATION_IN_PROGRESS");
    this.running.add(runningKey);
    const operationId = new ObjectId();
    try {
      return await this.db.transaction(async (tx) => {
        await grant.fence(tx);
        const existing = await this.collection.findOne(lookup, { session: tx });
        if (existing) return this.replay(existing, payloadHash);
        const now = this.now();
        await this.collection.insertOne(
          {
            _id: operationId,
            ...lookup,
            payloadHash,
            status: "completed",
            resourceRefs: [],
            safeResult: {},
            createdAt: now,
            expiresAt: new Date(now.getTime() + 48 * 60 * 60_000),
          },
          { session: tx },
        );
        const result = await mutate(tx, operationId);
        await this.collection.updateOne({ _id: operationId }, { $set: result }, { session: tx });
        return {
          data: { ...result.safeResult, operationId: operationId.toHexString() },
          status,
          replayed: false,
        };
      });
    } catch (error) {
      if (error instanceof AppError && error.code === "OUTCOME_UNKNOWN")
        error.operationId = operationId.toHexString();
      if (error instanceof MongoServerError && error.code === 11000 && error.keyPattern?.keyHash) {
        const existing = await this.collection.findOne(lookup);
        if (existing) {
          if (fencedReplay)
            return this.db.transaction(async (tx) => {
              await grant.fence(tx);
              return this.replay(existing, payloadHash);
            });
          return this.replay(existing, payloadHash);
        }
        throw new AppError(409, "OPERATION_IN_PROGRESS");
      }
      if (error instanceof MongoError && error.hasErrorLabel("TransientTransactionError"))
        throw new AppError(409, "OPERATION_IN_PROGRESS");
      throw error;
    } finally {
      this.running.delete(runningKey);
    }
  }
  async getOrganization(grant: OrganizationGrant, id: string) {
    return this.getTenant(grant, id, "organization");
  }
  async getTenant(
    grant: TenantGrant,
    id: string,
    namespace: "organization" | "members" | "families" | "exchange",
  ) {
    requireCondition(grant.canWrite, 403, "FORBIDDEN");
    requireCondition(/^[a-f0-9]{24}$/i.test(id), 400, "INVALID_REQUEST");
    return this.db.transaction(async (tx) => {
      await grant.fence(tx);
      const op = await this.collection.findOne(
        {
          _id: new ObjectId(id),
          schemaVersion: 2,
          actorKind: grant.actorKind,
          actorId: grant.actorId,
          churchId: grant.churchId,
          routeKey: { $regex: `^${namespace}/${grant.churchId}/` },
        },
        { session: tx },
      );
      requireCondition(op && op.expiresAt > this.now(), 404, "NOT_FOUND");
      requireCondition(
        grant.receiptScope !== "memberships" ||
          /^organization\/[a-f0-9]{24}\/units\/[a-f0-9]{24}\/memberships$/i.test(op.routeKey),
        403,
        "FORBIDDEN",
      );
      return {
        operationId: op._id.toHexString(),
        status: op.status,
        safeResult: op.safeResult,
        createdAt: op.createdAt.toISOString(),
        expiresAt: op.expiresAt.toISOString(),
      };
    });
  }
  async get(grant: OwnerGrant, id: string) {
    requireCondition(/^[a-f0-9]{24}$/i.test(id), 400, "INVALID_REQUEST");
    const op = await this.collection.findOne({ _id: new ObjectId(id), ownerId: grant.actorId });
    requireCondition(op && op.expiresAt > this.now(), 404, "NOT_FOUND");
    return {
      operationId: op._id.toHexString(),
      status: op.status,
      method: op.method,
      routeKey: op.routeKey,
      resourceRefs: op.resourceRefs,
      safeResult: op.safeResult,
      createdAt: op.createdAt.toISOString(),
      expiresAt: op.expiresAt.toISOString(),
    };
  }
}
