import type { ClientSession, ObjectId } from "mongodb";
import { z } from "zod";
import type { ChurchGrant } from "../authorization/church-grant";
import {
  capabilityAllowed,
  churchCapabilities,
  policyVersion,
  roleSchema,
  scopeSchema,
  validateRoleScope,
} from "../authorization/church-policy";
import { AppError, requireCondition } from "../errors";
import { parse } from "../http-validation";
import type { ChurchAccess, ChurchAccessInfo } from "../tenancy/access";
import type { Account } from "./accounts-model";
import { csrf, hashPassword, validatePassword, verifyPassword } from "./crypto";
import type { Credential, Session } from "./models";
import { ACTIVITY_MS, IDLE_MS, type Identity } from "./service";
import { newSession } from "./session";
export interface ChurchAuthContext {
  account: Account;
  credential: Credential;
  session: Session;
  church: ChurchAccessInfo;
  token: string;
}
const login = z.strictObject({
  churchCode: z.string().min(1).max(100),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .regex(/^[\x20-\x7e]+$/),
  password: z.string().min(1).max(1024),
});
const reauth = z.strictObject({ password: z.string().min(1).max(1024) }),
  change = z.strictObject({ newPassword: z.string(), confirmation: z.string() });
export class ChurchIdentity {
  constructor(
    private identity: Identity,
    private access: ChurchAccess,
  ) {}
  private get db() {
    return this.identity.db;
  }
  private get now() {
    return this.identity.now;
  }
  private get accounts() {
    return this.db.db.collection<Account>("accounts");
  }
  private actor(a: Account) {
    return { kind: "church_user" as const, id: a._id, churchId: a.churchId };
  }
  async bootstrap(token: string | undefined, bootstrapToken: string | undefined) {
    const existing = await this.identity.rawSession(token, "church");
    if (existing && existing.kind !== "bootstrap")
      try {
        await this.authorize(token, true, true);
        return {
          token: token as string,
          session: existing,
          csrfToken: csrf(this.identity.conf.csrfKey, "church", existing.tokenHash),
        };
      } catch (e) {
        if (!(e instanceof AppError && [401, 403].includes(e.status))) throw e;
      }
    return this.identity.bootstrap("church", undefined, bootstrapToken);
  }
  async authorize(
    token: string | undefined,
    allowIdle = false,
    allowLimited = true,
  ): Promise<ChurchAuthContext> {
    const session = await this.identity.rawSession(token, "church"),
      now = this.now();
    requireCondition(
      session &&
        session.kind !== "bootstrap" &&
        !session.revokedAt &&
        session.absoluteExpiresAt > now,
      401,
      "SESSION_EXPIRED",
    );
    requireCondition(
      session.realm === "church" && session.churchId && session.principalId,
      401,
      "SESSION_REVOKED",
    );
    const account = await this.accounts.findOne({
        _id: session.principalId,
        churchId: session.churchId,
      }),
      credential = await this.db.credentials.findOne({
        principalKind: "church_user",
        principalId: session.principalId,
        churchId: session.churchId,
      });
    requireCondition(
      account &&
        credential &&
        account.status === "active" &&
        account.authEpoch === session.authEpoch &&
        credential.credentialVersion === session.credentialVersion,
      401,
      "SESSION_REVOKED",
    );
    const church = await this.access.byId(account.churchId);
    requireCondition(church && church.status === "active", 403, "CHURCH_SUSPENDED");
    requireCondition(
      roleSchema.safeParse(account.role).success && scopeSchema.safeParse(account.scope).success,
      403,
      "FORBIDDEN",
    );
    try {
      validateRoleScope(account.role, account.scope);
    } catch {
      throw new AppError(403, "FORBIDDEN");
    }
    if (session.kind === "password_change")
      requireCondition(
        credential.kind === "temporary" &&
          credential.temporaryExpiresAt &&
          credential.temporaryExpiresAt > now,
        401,
        "SESSION_EXPIRED",
      );
    else requireCondition(credential.kind === "permanent", 401, "SESSION_REVOKED");
    if (
      !allowIdle &&
      session.kind === "full" &&
      now.getTime() - session.lastActivityAt.getTime() >= IDLE_MS
    )
      throw new AppError(401, "REAUTH_REQUIRED");
    if (!allowLimited) requireCondition(session.kind === "full", 403, "PASSWORD_CHANGE_REQUIRED");
    return { account, credential, session, church, token: token as string };
  }
  private async fence(ctx: ChurchAuthContext, tx: ClientSession, allowIdle = false) {
    const now = this.now();
    await this.access.fence(ctx.account.churchId, tx, true);
    const account = await this.accounts.updateOne(
      {
        _id: ctx.account._id,
        churchId: ctx.account.churchId,
        status: "active",
        authEpoch: ctx.account.authEpoch,
        version: ctx.account.version,
      },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    const credential = await this.db.credentials.updateOne(
      {
        _id: ctx.credential._id,
        principalKind: "church_user",
        principalId: ctx.account._id,
        churchId: ctx.account.churchId,
        credentialVersion: ctx.credential.credentialVersion,
        ...(ctx.credential.kind === "temporary" ? { temporaryExpiresAt: { $gt: now } } : {}),
      },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    const session = await this.db.sessions.updateOne(
      {
        _id: ctx.session._id,
        realm: "church",
        principalId: ctx.account._id,
        churchId: ctx.account.churchId,
        authEpoch: ctx.account.authEpoch,
        credentialVersion: ctx.credential.credentialVersion,
        revokedAt: { $exists: false },
        absoluteExpiresAt: { $gt: now },
        ...(!allowIdle && ctx.session.kind === "full"
          ? { lastActivityAt: { $gt: new Date(now.getTime() - IDLE_MS) } }
          : {}),
      },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    requireCondition(
      account.matchedCount && credential.matchedCount && session.matchedCount,
      401,
      "SESSION_REVOKED",
    );
  }
  grant(ctx: ChurchAuthContext): ChurchGrant {
    requireCondition(ctx.session.kind === "full", 403, "PASSWORD_CHANGE_REQUIRED");
    return {
      actorId: ctx.account._id,
      churchId: ctx.account.churchId,
      role: ctx.account.role,
      scope: ctx.account.scope,
      version: ctx.account.version,
      require: (capability) => requireCondition(capabilityAllowed(capability), 403, "FORBIDDEN"),
      fence: (tx) => this.fence(ctx, tx),
    };
  }
  async login(body: unknown, bootstrap: Session, ip: string, requestId: string) {
    requireCondition(
      bootstrap.realm === "church" && bootstrap.kind === "bootstrap",
      403,
      "CSRF_FAILED",
    );
    const data = parse(login, body),
      code = data.churchCode.toUpperCase(),
      email = data.email.toLowerCase();
    const success = await this.identity.rate.consume(email, ip, "church", code),
      church = await this.access.byCode(code);
    const account = church
      ? await this.accounts.findOne({ churchId: church.id, emailKey: email })
      : null;
    const credential = account
      ? await this.db.credentials.findOne({
          principalKind: "church_user",
          principalId: account._id,
          churchId: account.churchId,
        })
      : null;
    const valid = await this.identity.verifyCandidate(data.password, credential);
    if (!valid || !church || !account || !credential || account.status !== "active") {
      await this.identity.audit.principal(
        "auth.login_failed",
        requestId,
        { kind: "anonymous", churchId: null },
        { churchId: null },
        [],
        undefined,
        undefined,
        "failure",
      );
      throw new AppError(401, "INVALID_CREDENTIALS");
    }
    requireCondition(church.status === "active", 403, "CHURCH_SUSPENDED");
    requireCondition(
      credential.kind !== "temporary" ||
        (credential.temporaryExpiresAt && credential.temporaryExpiresAt > this.now()),
      401,
      "TEMP_PASSWORD_EXPIRED",
    );
    requireCondition(
      roleSchema.safeParse(account.role).success && scopeSchema.safeParse(account.scope).success,
      403,
      "FORBIDDEN",
    );
    try {
      validateRoleScope(account.role, account.scope);
    } catch {
      throw new AppError(403, "FORBIDDEN");
    }
    const created = newSession(
      this.identity.conf.csrfKey,
      this.now(),
      "church",
      account,
      credential,
    );
    await this.db.transaction(async (tx) => {
      const now = this.now();
      await this.access.fence(church.id, tx, true);
      const a = await this.accounts.updateOne(
        {
          _id: account._id,
          churchId: church.id,
          status: "active",
          authEpoch: account.authEpoch,
          version: account.version,
        },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
      const c = await this.db.credentials.updateOne(
        {
          _id: credential._id,
          principalKind: "church_user",
          principalId: account._id,
          churchId: church.id,
          credentialVersion: credential.credentialVersion,
          ...(credential.kind === "temporary" ? { temporaryExpiresAt: { $gt: now } } : {}),
        },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
      const b = await this.db.sessions.updateOne(
        {
          _id: bootstrap._id,
          realm: "church",
          kind: "bootstrap",
          revokedAt: { $exists: false },
          absoluteExpiresAt: { $gt: now },
        },
        { $set: { revokedAt: now }, $inc: { writeFence: 1 } },
        { session: tx },
      );
      requireCondition(a.matchedCount && c.matchedCount && b.matchedCount, 401, "SESSION_REVOKED");
      await this.db.sessions.insertOne(created.session, { session: tx });
      await this.identity.audit.principal(
        "auth.login_succeeded",
        requestId,
        this.actor(account),
        { id: account._id, churchId: account.churchId },
        [],
        tx,
      );
    });
    await success();
    return created;
  }
  me(ctx: ChurchAuthContext) {
    return {
      principalKind: "church_user",
      accountId: ctx.account._id.toHexString(),
      churchId: ctx.account.churchId.toHexString(),
      churchCode: ctx.church.code,
      email: ctx.account.email,
      displayName: ctx.account.displayName,
      sessionState: ctx.session.kind,
      absoluteExpiresAt: ctx.session.absoluteExpiresAt.toISOString(),
      ...(ctx.session.kind === "full"
        ? { role: ctx.account.role, scope: ctx.account.scope, version: ctx.account.version }
        : {}),
    };
  }
  context(ctx: ChurchAuthContext, id: string) {
    const grant = this.grant(ctx);
    grant.require("context:read");
    requireCondition(ctx.account.churchId.toHexString() === id.toLowerCase(), 403, "FORBIDDEN");
    return {
      church: {
        id: ctx.church.id.toHexString(),
        code: ctx.church.code,
        name: ctx.church.name,
        status: ctx.church.status,
      },
      principal: this.me(ctx),
      subjectLinked: !!ctx.account.subjectMemberId,
      policyVersion,
      capabilities: churchCapabilities,
      availability: { business: "not_available" },
    };
  }
  async change(ctx: ChurchAuthContext, body: unknown, requestId: string) {
    requireCondition(ctx.session.kind === "password_change", 403, "FORBIDDEN");
    const data = parse(change, body),
      password = validatePassword(data.newPassword);
    requireCondition(password === data.confirmation, 422, "VALIDATION_FAILED");
    requireCondition(
      !(await verifyPassword(password, ctx.credential.passwordHash)),
      422,
      "VALIDATION_FAILED",
    );
    const passwordHash = await hashPassword(password);
    await this.db.transaction(async (tx) => {
      await this.fence(ctx, tx);
      const now = this.now();
      const c = await this.db.credentials.updateOne(
        {
          _id: ctx.credential._id,
          principalKind: "church_user",
          principalId: ctx.account._id,
          churchId: ctx.account.churchId,
          credentialVersion: ctx.credential.credentialVersion,
        },
        {
          $set: { passwordHash, kind: "permanent", updatedAt: now },
          $unset: { temporaryExpiresAt: "" },
          $inc: { credentialVersion: 1, writeFence: 1 },
        },
        { session: tx },
      );
      requireCondition(c.modifiedCount, 401, "SESSION_REVOKED");
      await this.accounts.updateOne(
        { _id: ctx.account._id, churchId: ctx.account.churchId },
        { $set: { updatedAt: now }, $inc: { version: 1, authEpoch: 1, writeFence: 1 } },
        { session: tx },
      );
      await this.revoke(ctx.account._id, ctx.account.churchId, tx);
      await this.identity.audit.principal(
        "account.password_changed",
        requestId,
        this.actor(ctx.account),
        { id: ctx.account._id, churchId: ctx.account.churchId },
        ["credentialVersion", "authEpoch"],
        tx,
      );
    });
  }
  private async revoke(id: ObjectId, churchId: ObjectId, tx: ClientSession) {
    await this.db.sessions.updateMany(
      { realm: "church", principalId: id, churchId, revokedAt: { $exists: false } },
      { $set: { revokedAt: this.now() }, $inc: { writeFence: 1 } },
      { session: tx },
    );
  }
  async reauth(ctx: ChurchAuthContext, body: unknown, ip: string, requestId: string) {
    requireCondition(ctx.session.kind === "full", 403, "PASSWORD_CHANGE_REQUIRED");
    const data = parse(reauth, body),
      success = await this.identity.rate.consume(
        ctx.account.emailKey,
        ip,
        "church",
        ctx.church.code,
      );
    if (!(await verifyPassword(data.password, ctx.credential.passwordHash))) {
      await this.identity.audit.principal(
        "auth.reauth_failed",
        requestId,
        this.actor(ctx.account),
        { id: ctx.account._id, churchId: ctx.account.churchId },
        [],
        undefined,
        undefined,
        "failure",
      );
      throw new AppError(401, "INVALID_CREDENTIALS");
    }
    const created = newSession(
      this.identity.conf.csrfKey,
      this.now(),
      "church",
      ctx.account,
      ctx.credential,
      ctx.session.absoluteExpiresAt,
    );
    await this.db.transaction(async (tx) => {
      await this.fence(ctx, tx, true);
      await this.db.sessions.updateOne(
        { _id: ctx.session._id },
        { $set: { revokedAt: this.now() } },
        { session: tx },
      );
      await this.db.sessions.insertOne(created.session, { session: tx });
      await this.identity.audit.principal(
        "auth.reauth",
        requestId,
        this.actor(ctx.account),
        { id: ctx.account._id, churchId: ctx.account.churchId },
        [],
        tx,
      );
    });
    await success();
    return created;
  }
  async activity(ctx: ChurchAuthContext) {
    requireCondition(ctx.session.kind === "full", 403, "PASSWORD_CHANGE_REQUIRED");
    if (this.now().getTime() - ctx.session.lastActivityAt.getTime() < ACTIVITY_MS) return;
    await this.db.transaction(async (tx) => {
      await this.fence(ctx, tx);
      await this.db.sessions.updateOne(
        { _id: ctx.session._id, lastActivityAt: { $lt: this.now() } },
        { $set: { lastActivityAt: this.now() } },
        { session: tx },
      );
    });
  }
  async logout(ctx: ChurchAuthContext, requestId: string) {
    await this.db.transaction(async (tx) => {
      await this.fence(ctx, tx, true);
      await this.db.sessions.updateOne(
        { _id: ctx.session._id },
        { $set: { revokedAt: this.now() } },
        { session: tx },
      );
      await this.identity.audit.principal(
        "auth.logout",
        requestId,
        this.actor(ctx.account),
        { id: ctx.account._id, churchId: ctx.account.churchId },
        [],
        tx,
      );
    });
  }
}
