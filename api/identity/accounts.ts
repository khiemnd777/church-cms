import { type ClientSession, type Filter, MongoServerError, ObjectId } from "mongodb";
import { z } from "zod";
import type { Audit } from "../audit/service";
import { roleSchema, scopeSchema, validateRoleScope } from "../authorization/church-policy";
import type { OwnerGrant } from "../authorization/owner-grant";
import { AppError, requireCondition } from "../errors";
import { idempotencyKey, objectId, parse, version } from "../http-validation";
import type { Database } from "../infrastructure/database";
import type { RateLimit } from "../infrastructure/rate-limit";
import type { Operations } from "../operations/service";
import type { UnitScopeValidator } from "../organization/scope";
import type { ChurchAccess } from "../tenancy/access";
import { AccountCursors } from "./accounts-cursor";
import { type Account, accountDto, roles } from "./accounts-model";
import { hashPassword, temporaryPassword } from "./crypto";
import type { AuthContext } from "./service";

const name = z
  .string()
  .trim()
  .refine(
    (s) =>
      [...s].length >= 1 &&
      [...s].length <= 160 &&
      [...s].every((c) => (c.codePointAt(0) ?? 0) >= 32 && c.codePointAt(0) !== 127),
  );
const permissionInput = z.strictObject({ role: roleSchema, scope: scopeSchema });
const createInput = permissionInput.extend({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .regex(/^[\x20-\x7e]+$/),
  displayName: name,
});
const statusInput = z.strictObject({
  status: z.enum(["active", "locked"]),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((s) => [...s].every((c) => (c.codePointAt(0) ?? 0) >= 32 && c.codePointAt(0) !== 127)),
});
const resetInput = z.strictObject({
  supportReference: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((s) => [...s].every((c) => (c.codePointAt(0) ?? 0) >= 32 && c.codePointAt(0) !== 127)),
});
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export class Accounts {
  private cursors: AccountCursors;
  constructor(
    private db: Database,
    private access: ChurchAccess,
    private operations: Operations,
    private audit: Audit,
    private rate: RateLimit,
    key: string,
    private now: () => Date,
    private units?: UnitScopeValidator,
  ) {
    this.cursors = new AccountCursors(key, now);
  }
  private get collection() {
    return this.db.db.collection<Account>("accounts");
  }
  private async church(id: string) {
    const church = await this.access.byId(objectId(id));
    requireCondition(church, 404, "NOT_FOUND");
    return church;
  }
  async list(_grant: OwnerGrant, churchId: string, query: URLSearchParams) {
    const church = await this.church(churchId);
    requireCondition(
      [...query.keys()].every((k) => ["q", "role", "status", "limit", "cursor"].includes(k)),
      400,
      "INVALID_REQUEST",
    );
    const q = (query.get("q") ?? "").trim().toLowerCase(),
      role = query.get("role") ?? "",
      status = query.get("status") ?? "",
      size = query.get("limit") ?? "25";
    requireCondition(
      [...q].length <= 100 &&
        (!role || roles.some((r) => r === role)) &&
        (!status || ["active", "locked"].includes(status)) &&
        /^[1-9]\d{0,2}$/.test(size) &&
        Number(size) <= 100,
      400,
      "INVALID_REQUEST",
    );
    const scopeChurch = church.id.toHexString(),
      filter = this.cursors.filter(q, role, status),
      after = query.get("cursor")
        ? this.cursors.decode(
            query.get("cursor") as string,
            _grant.actorId.toHexString(),
            scopeChurch,
            filter,
          )
        : null;
    const base: Filter<Account> = {
      churchId: church.id,
      ...(role ? { role: role as Account["role"] } : {}),
      ...(status ? { status: status as Account["status"] } : {}),
    };
    const mode =
      after?.mode ??
      (!q
        ? "all"
        : (await this.collection.findOne({ ...base, emailKey: q }, { projection: { _id: 1 } }))
          ? "exact"
          : "prefix");
    const filters: Filter<Account>[] = [base];
    if (mode === "exact") filters.push({ emailKey: q });
    else if (mode === "prefix")
      filters.push({
        $or: [
          { displayNameKey: { $regex: `^${escaped(q)}` } },
          { emailKey: { $regex: `^${escaped(q)}` } },
        ],
      });
    if (after)
      filters.push({
        $or: [
          { displayNameKey: { $gt: after.lastName } },
          { displayNameKey: after.lastName, _id: { $gt: objectId(after.lastId) } },
        ],
      });
    const data = await this.collection
        .find({ $and: filters }, { maxTimeMS: 3000 })
        .sort({ displayNameKey: 1, _id: 1 })
        .limit(Number(size) + 1)
        .toArray(),
      more = data.length > Number(size);
    if (more) data.pop();
    const last = data.at(-1);
    return {
      items: data.map(accountDto),
      nextCursor:
        more && last
          ? this.cursors.encode({
              actor: _grant.actorId.toHexString(),
              church: scopeChurch,
              filter,
              mode,
              lastName: last.displayNameKey,
              lastId: last._id.toHexString(),
            })
          : null,
    };
  }
  async get(_grant: OwnerGrant, churchId: string, id: string) {
    await this.church(churchId);
    const a = await this.collection.findOne({ _id: objectId(id), churchId: objectId(churchId) });
    requireCondition(a, 404, "NOT_FOUND");
    return accountDto(a);
  }
  private async load(churchId: ObjectId, id: ObjectId, expected: number, tx: ClientSession) {
    const a = await this.collection.findOne({ _id: id, churchId }, { session: tx });
    requireCondition(a, 404, "NOT_FOUND");
    requireCondition(a.version === expected, 412, "VERSION_CONFLICT");
    return a;
  }
  private async event(
    kind: string,
    requestId: string,
    grant: OwnerGrant,
    a: Account,
    fields: string[],
    tx: ClientSession,
    operationId: ObjectId,
    summary?: string,
  ) {
    await this.audit.principal(
      kind,
      requestId,
      { kind: "owner", id: grant.actorId, churchId: null },
      { id: a._id, churchId: a.churchId },
      fields,
      tx,
      operationId,
      "success",
      summary,
    );
  }
  async create(
    grant: OwnerGrant,
    churchId: string,
    body: unknown,
    keyValue: string | null,
    requestId: string,
  ) {
    const church = await this.church(churchId),
      data = parse(createInput, body),
      key = idempotencyKey(keyValue);
    validateRoleScope(data.role, data.scope);
    const route = `/owner/churches/${churchId}/accounts`,
      previous = await this.operations.replayResult(grant, "POST", route, key, data, null);
    if (previous) return previous;
    const password = temporaryPassword(),
      passwordHash = await hashPassword(password),
      expiresAt = new Date(this.now().getTime() + 24 * 60 * 60_000);
    try {
      const result = await this.operations.execute(
        grant,
        "POST",
        route,
        key,
        data,
        null,
        async (tx, op) => {
          await this.access.fence(church.id, tx, false);
          if (data.scope.kind === "assigned_units") {
            requireCondition(this.units, 503, "DEPENDENCY_UNAVAILABLE");
            await this.units.validateScope(church.id, data.scope, tx);
          }
          const exists = await this.collection.findOne(
            { churchId: church.id, emailKey: data.email.toLowerCase() },
            { session: tx },
          );
          if (exists) {
            const e = new AppError(409, "ACCOUNT_EXISTS");
            e.resourceId = exists._id.toHexString();
            throw e;
          }
          const now = this.now(),
            a: Account = {
              _id: new ObjectId(),
              churchId: church.id,
              email: data.email,
              emailKey: data.email.toLowerCase(),
              displayName: data.displayName,
              displayNameKey: data.displayName.toLowerCase(),
              role: data.role,
              scope: data.scope,
              status: "active",
              authEpoch: 1,
              version: 1,
              writeFence: 0,
              createdAt: now,
              updatedAt: now,
              createdBy: grant.actorId,
              updatedBy: grant.actorId,
            };
          await this.collection.insertOne(a, { session: tx });
          await this.db.credentials.insertOne(
            {
              _id: new ObjectId(),
              principalKind: "church_user",
              principalId: a._id,
              churchId: a.churchId,
              passwordHash,
              kind: "temporary",
              temporaryExpiresAt: expiresAt,
              credentialVersion: 1,
              writeFence: 0,
              updatedAt: now,
            },
            { session: tx },
          );
          await this.event(
            "account.created",
            requestId,
            grant,
            a,
            ["email", "displayName", "role", "scope", "status"],
            tx,
            op,
          );
          return {
            safeResult: {
              account: accountDto(a),
              temporaryCredential: null,
              credentialReplay: "not_available",
            },
            resourceRefs: [{ type: "account", id: a._id.toHexString() }],
          };
        },
        201,
      );
      return result.replayed
        ? result
        : {
            ...result,
            data: {
              ...result.data,
              temporaryCredential: {
                password,
                expiresAt: expiresAt.toISOString(),
                loginPath: `/h/${church.code}/login`,
              },
              credentialReplay: "first_response",
            },
          };
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const a = await this.collection.findOne({
          churchId: church.id,
          emailKey: data.email.toLowerCase(),
        });
        if (a) {
          const e = new AppError(409, "ACCOUNT_EXISTS");
          e.resourceId = a._id.toHexString();
          throw e;
        }
      }
      throw error;
    }
  }
  async permissions(
    grant: OwnerGrant,
    churchId: string,
    id: string,
    body: unknown,
    keyValue: string | null,
    match: string | null,
    requestId: string,
  ) {
    const data = parse(permissionInput, body);
    validateRoleScope(data.role, data.scope);
    const key = idempotencyKey(keyValue),
      expected = version(match),
      church = await this.church(churchId),
      accountId = objectId(id);
    return this.operations.execute(
      grant,
      "PATCH",
      `/owner/churches/${churchId}/accounts/${id}/permissions`,
      key,
      data,
      expected,
      async (tx, op) => {
        await this.access.fence(church.id, tx, false);
        if (data.scope.kind === "assigned_units") {
          requireCondition(this.units, 503, "DEPENDENCY_UNAVAILABLE");
          await this.units.validateScope(church.id, data.scope, tx);
        }
        await this.load(church.id, accountId, expected, tx);
        const a = await this.collection.findOneAndUpdate(
          { _id: accountId, churchId: church.id, version: expected },
          {
            $set: {
              role: data.role,
              scope: data.scope,
              updatedAt: this.now(),
              updatedBy: grant.actorId,
            },
            $inc: { version: 1, writeFence: 1 },
          },
          { session: tx, returnDocument: "after" },
        );
        requireCondition(a, 412, "VERSION_CONFLICT");
        await this.event(
          "account.permissions_changed",
          requestId,
          grant,
          a,
          ["role", "scope"],
          tx,
          op,
        );
        return { safeResult: { account: accountDto(a) }, resourceRefs: [{ type: "account", id }] };
      },
    );
  }
  async status(
    grant: OwnerGrant,
    churchId: string,
    id: string,
    body: unknown,
    keyValue: string | null,
    match: string | null,
    requestId: string,
  ) {
    const data = parse(statusInput, body),
      key = idempotencyKey(keyValue),
      expected = version(match),
      church = await this.church(churchId),
      accountId = objectId(id);
    return this.operations.execute(
      grant,
      "PATCH",
      `/owner/churches/${churchId}/accounts/${id}/status`,
      key,
      data,
      expected,
      async (tx, op) => {
        await this.access.fence(church.id, tx, false);
        await this.load(church.id, accountId, expected, tx);
        const now = this.now(),
          a = await this.collection.findOneAndUpdate(
            { _id: accountId, churchId: church.id, version: expected },
            {
              $set: { status: data.status, updatedAt: now, updatedBy: grant.actorId },
              $inc: { version: 1, writeFence: 1, authEpoch: 1 },
            },
            { session: tx, returnDocument: "after" },
          );
        requireCondition(a, 412, "VERSION_CONFLICT");
        await this.db.sessions.updateMany(
          {
            realm: "church",
            churchId: church.id,
            principalId: accountId,
            revokedAt: { $exists: false },
          },
          { $set: { revokedAt: now }, $inc: { writeFence: 1 } },
          { session: tx },
        );
        await this.event(
          "account.status_changed",
          requestId,
          grant,
          a,
          ["status"],
          tx,
          op,
          `account.status_changed: ${data.reason}`,
        );
        return { safeResult: { account: accountDto(a) }, resourceRefs: [{ type: "account", id }] };
      },
    );
  }
  async reset(
    ctx: AuthContext,
    grant: OwnerGrant,
    churchId: string,
    id: string,
    body: unknown,
    keyValue: string | null,
    match: string | null,
    requestId: string,
  ) {
    const data = parse(resetInput, body),
      key = idempotencyKey(keyValue),
      expected = version(match),
      church = await this.church(churchId),
      accountId = objectId(id),
      route = `/owner/churches/${churchId}/accounts/${id}/temporary-passwords`;
    requireCondition(
      ctx.session.lastPasswordVerifiedAt &&
        ctx.session.lastPasswordVerifiedAt <= this.now() &&
        this.now().getTime() - ctx.session.lastPasswordVerifiedAt.getTime() <= 5 * 60_000,
      403,
      "RECENT_AUTH_REQUIRED",
    );
    const prior = await this.operations.replayResult(grant, "POST", route, key, data, expected);
    if (prior) return prior;
    const current = await this.collection.findOne({ _id: accountId, churchId: church.id });
    requireCondition(current, 404, "NOT_FOUND");
    requireCondition(current.status === "active", 409, "ACCOUNT_LOCKED");
    requireCondition(current.version === expected, 412, "VERSION_CONFLICT");
    await this.rate.reset(
      church.id.toHexString(),
      accountId.toHexString(),
      `${grant.actorId}:${key.toLowerCase()}`,
    );
    const password = temporaryPassword(),
      passwordHash = await hashPassword(password),
      expiresAt = new Date(this.now().getTime() + 24 * 60 * 60_000);
    const resetGrant: OwnerGrant = {
      actorId: grant.actorId,
      fence: async (tx) => {
        await grant.fence(tx);
        const recent = await this.db.sessions.findOne(
          {
            _id: ctx.session._id,
            lastPasswordVerifiedAt: {
              $gte: new Date(this.now().getTime() - 5 * 60_000),
              $lte: this.now(),
            },
          },
          { session: tx },
        );
        requireCondition(recent, 403, "RECENT_AUTH_REQUIRED");
      },
    };
    const result = await this.operations.execute(
      resetGrant,
      "POST",
      route,
      key,
      data,
      expected,
      async (tx, op) => {
        await this.access.fence(church.id, tx, false);
        const account = await this.load(church.id, accountId, expected, tx);
        requireCondition(account.status === "active", 409, "ACCOUNT_LOCKED");
        const now = this.now();
        const cred = await this.db.credentials.updateOne(
          { principalKind: "church_user", principalId: accountId, churchId: church.id },
          {
            $set: {
              passwordHash,
              kind: "temporary",
              temporaryExpiresAt: expiresAt,
              updatedAt: now,
            },
            $inc: { credentialVersion: 1, writeFence: 1 },
          },
          { session: tx },
        );
        requireCondition(cred.matchedCount, 412, "VERSION_CONFLICT");
        const a = await this.collection.findOneAndUpdate(
          { _id: accountId, churchId: church.id, version: expected },
          {
            $set: { updatedAt: now, updatedBy: grant.actorId },
            $inc: { version: 1, authEpoch: 1, writeFence: 1 },
          },
          { session: tx, returnDocument: "after" },
        );
        requireCondition(a, 412, "VERSION_CONFLICT");
        await this.db.sessions.updateMany(
          {
            realm: "church",
            churchId: church.id,
            principalId: accountId,
            revokedAt: { $exists: false },
          },
          { $set: { revokedAt: now }, $inc: { writeFence: 1 } },
          { session: tx },
        );
        await this.event(
          "account.temp_password_issued",
          requestId,
          grant,
          a,
          ["credentialVersion", "authEpoch"],
          tx,
          op,
          `account.temp_password_issued: ${data.supportReference}`,
        );
        return {
          safeResult: {
            account: accountDto(a),
            temporaryCredential: null,
            credentialReplay: "not_available",
          },
          resourceRefs: [{ type: "account", id }],
        };
      },
      201,
    );
    return result.replayed
      ? result
      : {
          ...result,
          data: {
            ...result.data,
            temporaryCredential: {
              password,
              expiresAt: expiresAt.toISOString(),
              loginPath: `/h/${church.code}/login`,
            },
            credentialReplay: "first_response",
          },
        };
  }
}
