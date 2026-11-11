import type { ClientSession, ObjectId } from "mongodb";
import { z } from "zod";
import { Audit } from "../audit/service";
import type { OwnerGrant } from "../authorization/owner-grant";
import { ownerCapabilities, requireFull } from "../authorization/owner-policy";
import type { Config } from "../config";
import { AppError, requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import type { RateLimit } from "../infrastructure/rate-limit";
import {
  csrf,
  digest,
  equal,
  hashPassword,
  opaque,
  validatePassword,
  verifyPassword,
} from "./crypto";
import type { Credential, Owner, Realm, Session } from "./models";
import { newSession } from "./session";
export const IDLE_MS = 15 * 60_000,
  ABSOLUTE_MS = 8 * 60 * 60_000,
  ACTIVITY_MS = 30_000;
export const cookieName = (realm: Realm, bootstrap = false) =>
  `__Host-qlht_${realm === "owner" ? "owner" : "church"}_${bootstrap ? "bootstrap" : "session"}`;
export const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
export interface AuthContext {
  session: Session;
  owner: Owner;
  credential: Credential;
  token: string;
}
export interface SessionResult {
  token: string;
  session: Session;
  csrfToken: string;
}
const loginInput = z.strictObject({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .regex(/^[\x20-\x7e]+$/),
  password: z.string().min(1).max(1024),
});
const reauthInput = z.strictObject({ password: z.string().min(1).max(1024) });
const changeInput = z.strictObject({ newPassword: z.string(), confirmation: z.string() });
function input<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError(422, "VALIDATION_FAILED");
  return parsed.data;
}
export class Identity {
  readonly audit: Audit;
  private dummyHash = "";
  constructor(
    readonly db: Database,
    readonly rate: RateLimit,
    readonly conf: Config,
    readonly now: () => Date = () => new Date(),
  ) {
    this.audit = new Audit(db);
  }
  async initialize() {
    this.dummyHash = await hashPassword(opaque());
  }
  async verifyCandidate(password: string, credential: Credential | null) {
    return verifyPassword(password, credential?.passwordHash ?? this.dummyHash);
  }
  private newSession(
    realm: Realm,
    owner?: Owner,
    credential?: Credential,
    absolute?: Date,
  ): SessionResult {
    return newSession(this.conf.csrfKey, this.now(), realm, owner, credential, absolute);
  }

  async rawSession(token: string | undefined, realm: Realm) {
    if (!token || !/^[\w-]{43}$/.test(token)) return null;
    return this.db.sessions.findOne({ tokenHash: digest(token), realm });
  }
  async bootstrap(realm: Realm, token?: string, bootstrapToken?: string) {
    const existing = await this.rawSession(token, realm);
    if (existing && existing.kind !== "bootstrap") {
      try {
        await this.authorize(token, realm, true, true);
        return {
          token: token as string,
          session: existing,
          csrfToken: csrf(this.conf.csrfKey, realm, existing.tokenHash),
        };
      } catch (e) {
        if (!(e instanceof AppError && e.status === 401)) throw e;
      }
    }
    const previous = await this.rawSession(bootstrapToken, realm);
    if (
      previous?.kind === "bootstrap" &&
      !previous.revokedAt &&
      previous.absoluteExpiresAt > this.now()
    )
      return {
        token: bootstrapToken as string,
        session: previous,
        csrfToken: csrf(this.conf.csrfKey, realm, previous.tokenHash),
      };
    const created = this.newSession(realm);
    await this.db.sessions.insertOne(created.session);
    return created;
  }
  async csrfSession(token: string | undefined, realm: Realm, header: string | null) {
    const session = await this.rawSession(token, realm);
    requireCondition(
      session && !session.revokedAt && session.absoluteExpiresAt > this.now(),
      401,
      "SESSION_EXPIRED",
    );
    requireCondition(
      header &&
        equal(digest(header), session.csrfTokenHash) &&
        equal(header, csrf(this.conf.csrfKey, realm, session.tokenHash)),
      403,
      "CSRF_FAILED",
    );
    return session;
  }
  async authorize(
    token: string | undefined,
    realm: Realm = "owner",
    allowIdle = false,
    allowLimited = true,
  ): Promise<AuthContext> {
    requireCondition(realm === "owner", 403, "FORBIDDEN");
    const session = await this.rawSession(token, realm),
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
      session.realm === "owner" && session.churchId === null && session.principalId,
      401,
      "SESSION_REVOKED",
    );
    const owner = await this.db.owners.findOne({ _id: session.principalId });
    const credential = await this.db.credentials.findOne({
      principalKind: "owner",
      principalId: session.principalId,
      churchId: null,
    });
    requireCondition(
      owner &&
        credential &&
        owner.status === "active" &&
        owner.authEpoch === session.authEpoch &&
        credential.credentialVersion === session.credentialVersion,
      401,
      "SESSION_REVOKED",
    );
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
    if (!allowLimited) requireFull(session);
    return { session, owner, credential, token: token as string };
  }
  private async fence(ctx: AuthContext, tx: ClientSession, allowIdle = false) {
    const now = this.now();
    const owner = await this.db.owners.updateOne(
      {
        _id: ctx.owner._id,
        status: "active",
        authEpoch: ctx.owner.authEpoch,
        version: ctx.owner.version,
      },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    const cred = await this.db.credentials.updateOne(
      {
        _id: ctx.credential._id,
        principalKind: "owner",
        churchId: null,
        credentialVersion: ctx.credential.credentialVersion,
        ...(ctx.credential.kind === "temporary" ? { temporaryExpiresAt: { $gt: now } } : {}),
      },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    const session = await this.db.sessions.updateOne(
      {
        _id: ctx.session._id,
        realm: "owner",
        principalId: ctx.owner._id,
        revokedAt: { $exists: false },
        absoluteExpiresAt: { $gt: now },
        authEpoch: ctx.owner.authEpoch,
        credentialVersion: ctx.credential.credentialVersion,
        ...(!allowIdle && ctx.session.kind === "full"
          ? { lastActivityAt: { $gt: new Date(now.getTime() - IDLE_MS) } }
          : {}),
      },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    requireCondition(
      owner.matchedCount && cred.matchedCount && session.matchedCount,
      401,
      "SESSION_REVOKED",
    );
  }
  ownerGrant(ctx: AuthContext, capability: (typeof ownerCapabilities)[number]): OwnerGrant {
    requireFull(ctx.session);
    requireCondition(ownerCapabilities.includes(capability), 403, "FORBIDDEN");
    return { actorId: ctx.owner._id, fence: (tx) => this.fence(ctx, tx) };
  }
  async suspendChurchSessions(churchId: ObjectId, tx: ClientSession) {
    await this.db.sessions.updateMany(
      { realm: "church", churchId, revokedAt: { $exists: false } },
      { $set: { revokedAt: this.now() }, $inc: { writeFence: 1 } },
      { session: tx },
    );
  }
  async activeAccountCounts(ids: ObjectId[]): Promise<Map<string, number>> {
    requireCondition(ids.length <= 100, 400, "INVALID_REQUEST");
    if (!ids.length) return new Map();
    const counts = await this.db.db
      .collection("accounts")
      .aggregate<{ _id: ObjectId; count: number }>(
        [
          { $match: { churchId: { $in: ids }, status: "active" } },
          { $group: { _id: "$churchId", count: { $sum: 1 } } },
        ],
        { maxTimeMS: 3000 },
      )
      .toArray();
    return new Map(counts.map((row) => [row._id.toHexString(), row.count]));
  }
  async login(
    body: unknown,
    bootstrap: Session,
    ip: string,
    requestId: string,
  ): Promise<SessionResult> {
    requireCondition(
      bootstrap.realm === "owner" && bootstrap.kind === "bootstrap",
      403,
      "CSRF_FAILED",
    );
    const data = input(loginInput, body),
      emailKey = data.email.toLowerCase();
    const success = await this.rate.consume(emailKey, ip);
    const owner = await this.db.owners.findOne({ emailKey });
    const credential = owner
      ? await this.db.credentials.findOne({
          principalKind: "owner",
          principalId: owner._id,
          churchId: null,
        })
      : null;
    const valid = await verifyPassword(data.password, credential?.passwordHash ?? this.dummyHash);
    if (!valid || !owner || !credential || owner.status !== "active") {
      await this.audit.record("auth.login_failed", requestId, undefined, undefined, "failure");
      throw new AppError(401, "INVALID_CREDENTIALS");
    }
    requireCondition(
      credential.kind !== "temporary" ||
        (credential.temporaryExpiresAt && credential.temporaryExpiresAt > this.now()),
      401,
      "TEMP_PASSWORD_EXPIRED",
    );
    const created = this.newSession("owner", owner, credential);
    await this.db.transaction(async (tx) => {
      const now = this.now();
      const principal = await this.db.owners.updateOne(
        { _id: owner._id, status: "active", authEpoch: owner.authEpoch },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
      const current = await this.db.credentials.updateOne(
        {
          _id: credential._id,
          principalKind: "owner",
          churchId: null,
          credentialVersion: credential.credentialVersion,
          ...(credential.kind === "temporary" ? { temporaryExpiresAt: { $gt: now } } : {}),
        },
        { $inc: { writeFence: 1 } },
        { session: tx },
      );
      const boot = await this.db.sessions.updateOne(
        {
          _id: bootstrap._id,
          kind: "bootstrap",
          realm: "owner",
          revokedAt: { $exists: false },
          absoluteExpiresAt: { $gt: now },
        },
        { $set: { revokedAt: now }, $inc: { writeFence: 1 } },
        { session: tx },
      );
      requireCondition(
        principal.matchedCount && current.matchedCount && boot.matchedCount,
        401,
        "SESSION_REVOKED",
      );
      await this.db.sessions.insertOne(created.session, { session: tx });
      await this.audit.record("auth.login_succeeded", requestId, owner._id, tx);
    });
    await success();
    return created;
  }
  me(ctx: AuthContext) {
    return {
      principalKind: "owner",
      employeeId: ctx.owner._id.toHexString(),
      email: ctx.owner.email,
      displayName: ctx.owner.displayName,
      sessionState: ctx.session.kind,
      ...(ctx.session.kind === "full" ? { platformCapabilities: ownerCapabilities } : {}),
      absoluteExpiresAt: ctx.session.absoluteExpiresAt,
    };
  }
  async change(ctx: AuthContext, body: unknown, requestId: string) {
    requireCondition(ctx.session.kind === "password_change", 403, "FORBIDDEN");
    const data = input(changeInput, body),
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
      const changed = await this.db.credentials.updateOne(
        { _id: ctx.credential._id, credentialVersion: ctx.credential.credentialVersion },
        {
          $set: { passwordHash, kind: "permanent", updatedAt: now },
          $inc: { credentialVersion: 1 },
          $unset: { temporaryExpiresAt: "" },
        },
        { session: tx },
      );
      requireCondition(changed.modifiedCount === 1, 401, "SESSION_REVOKED");
      await this.db.owners.updateOne(
        { _id: ctx.owner._id },
        { $inc: { authEpoch: 1, version: 1 }, $set: { updatedAt: now } },
        { session: tx },
      );
      await this.db.sessions.updateMany(
        { realm: "owner", principalId: ctx.owner._id, revokedAt: { $exists: false } },
        { $set: { revokedAt: now }, $inc: { writeFence: 1 } },
        { session: tx },
      );
      await this.audit.record("owner.password_changed", requestId, ctx.owner._id, tx);
    });
  }
  async reauth(ctx: AuthContext, body: unknown, ip: string, requestId: string) {
    requireFull(ctx.session);
    const data = input(reauthInput, body);
    const success = await this.rate.consume(ctx.owner.emailKey, ip);
    if (!(await verifyPassword(data.password, ctx.credential.passwordHash))) {
      await this.audit.record("auth.reauth_failed", requestId, ctx.owner._id, undefined, "failure");
      throw new AppError(401, "INVALID_CREDENTIALS");
    }
    const created = this.newSession(
      "owner",
      ctx.owner,
      ctx.credential,
      new Date(ctx.session.absoluteExpiresAt),
    );
    await this.db.transaction(async (tx) => {
      await this.fence(ctx, tx, true);
      await this.db.sessions.updateOne(
        { _id: ctx.session._id },
        { $set: { revokedAt: this.now() } },
        { session: tx },
      );
      await this.db.sessions.insertOne(created.session, { session: tx });
      await this.audit.record("auth.reauth", requestId, ctx.owner._id, tx);
    });
    await success();
    return created;
  }
  async activity(ctx: AuthContext) {
    requireFull(ctx.session);
    const now = this.now();
    if (now.getTime() - ctx.session.lastActivityAt.getTime() < ACTIVITY_MS) return;
    await this.db.transaction(async (tx) => {
      await this.fence(ctx, tx);
      await this.db.sessions.updateOne(
        { _id: ctx.session._id, lastActivityAt: { $lt: now } },
        { $set: { lastActivityAt: now } },
        { session: tx },
      );
    });
  }
  async logout(ctx: AuthContext, requestId: string) {
    await this.db.transaction(async (tx) => {
      await this.fence(ctx, tx, true);
      await this.db.sessions.updateOne(
        { _id: ctx.session._id },
        { $set: { revokedAt: this.now() } },
        { session: tx },
      );
      await this.audit.record("auth.logout", requestId, ctx.owner._id, tx);
    });
  }
}
