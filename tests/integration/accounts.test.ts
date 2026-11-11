import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { type Document, type Filter, MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { config } from "../../api/config";
import { AppError } from "../../api/errors";
import { ChurchIdentity } from "../../api/identity/church-service";
import { digest, verifyPassword } from "../../api/identity/crypto";
import { OwnerOperations } from "../../api/identity/owner-operations";
import { cookieName, Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { Operations } from "../../api/operations/service";
import { Tenancy } from "../../api/tenancy/service";

const conf = {
  ...config(),
  origin: "https://localhost:3451",
  database: `church_cms_test_accounts_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["127.0.0.1", "localhost"].includes(new URL(conf.mongoUrl).hostname))
  throw new Error("Only local synthetic MongoDB");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let clock = new Date(),
  identity: Identity,
  app: ReturnType<typeof createApp>,
  owner: Client,
  other: Client,
  churchA: { id: string; code: string },
  churchB: { id: string; code: string };
let ownerEmail = "",
  otherEmail = "";
const ownerPassword = `Owner 🌿 ${crypto.randomUUID()}`;
const logs: object[] = [];
class Client {
  jar = new Map<string, string>();
  csrf = "";
  ip = crypto.randomUUID();
  constructor(public realm: "owner" | "church" = "owner") {}
  async call(path: string, body?: object, headers: Record<string, string> = {}, method?: string) {
    const res = await app(
      new Request(`${conf.origin}/api/v1/${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          cookie: Array.from(this.jar, ([k, v]) => `${k}=${v}`).join(";"),
          ...(body === undefined
            ? {}
            : {
                "content-type": "application/json",
                origin: conf.origin,
                "x-csrf-token": this.csrf,
              }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { ip: this.ip },
    );
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0] as string,
        i = pair.indexOf("="),
        name = pair.slice(0, i),
        value = pair.slice(i + 1);
      if (value) this.jar.set(name, value);
      else this.jar.delete(name);
    }
    const json = res.status === 204 ? null : await res.json();
    if (json?.data?.csrfToken) this.csrf = json.data.csrfToken;
    return { res, json };
  }
  async boot() {
    const r = await this.call(`auth/csrf?realm=${this.realm}`);
    expect(r.res.status).toBe(200);
  }
  login(email: string, password: string, churchCode?: string) {
    return this.call(`${this.realm === "owner" ? "owner/" : ""}auth/login`, {
      email,
      password,
      ...(this.realm === "church" ? { churchCode } : {}),
    });
  }
  create(churchId: string, body: object, key: string = crypto.randomUUID()) {
    return this.call(`owner/churches/${churchId}/accounts`, body, { "idempotency-key": key });
  }
  mutate(
    churchId: string,
    id: string,
    action: string,
    body: object,
    version: number,
    key: string = crypto.randomUUID(),
  ) {
    return this.call(
      `owner/churches/${churchId}/accounts/${id}/${action}`,
      body,
      { "idempotency-key": key, "if-match": `"${version}"` },
      action === "temporary-passwords" ? "POST" : "PATCH",
    );
  }
}
async function permanentOwner(email: string) {
  const created = await new OwnerOperations(db).create({ email, displayName: "Owner synthetic" });
  const c = new Client();
  await c.boot();
  expect((await c.login(email, created.temporaryPassword)).res.status).toBe(200);
  expect(
    (
      await c.call("owner/auth/change-initial-password", {
        newPassword: ownerPassword,
        confirmation: ownerPassword,
      })
    ).res.status,
  ).toBe(204);
}
const input = (email = `acct-${crypto.randomUUID()}@example.test`) => ({
  email,
  displayName: "Nguyễn Văn An",
  role: "secretary",
  scope: { kind: "church" },
});
async function created(church = churchA, body = input()) {
  const r = await owner.create(church.id, body);
  expect(r.res.status).toBe(201);
  return r.json.data as {
    account: { id: string; churchId: string; version: number; email: string };
    temporaryCredential: { password: string; expiresAt: string; loginPath: string };
    operationId: string;
  };
}
async function userSession(church = churchA, body = input(), permanent = true) {
  const made = await created(church, body),
    c = new Client("church");
  await c.boot();
  expect(
    (await c.login(body.email, made.temporaryCredential.password, church.code)).res.status,
  ).toBe(200);
  const password = `User 🕊 ${crypto.randomUUID()}`;
  if (permanent) {
    expect(
      (
        await c.call("auth/change-initial-password", {
          newPassword: password,
          confirmation: password,
        })
      ).res.status,
    ).toBe(204);
    await c.boot();
    expect((await c.login(body.email, password, church.code)).res.status).toBe(200);
  }
  return { c, made, password };
}
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  identity = new Identity(db, rate, conf, () => new Date(clock));
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  ownerEmail = `owner-${crypto.randomUUID()}@example.test`;
  otherEmail = `other-${crypto.randomUUID()}@example.test`;
  await permanentOwner(ownerEmail);
  await permanentOwner(otherEmail);
});
beforeEach(async () => {
  clock = new Date();
  owner = new Client();
  await owner.boot();
  expect((await owner.login(ownerEmail, ownerPassword)).res.status).toBe(200);
  other = new Client();
  await other.boot();
  expect((await other.login(otherEmail, ownerPassword)).res.status).toBe(200);
  const a = await owner.call(
    "owner/churches",
    { name: `A ${crypto.randomUUID()}`, province: "Đà Nẵng" },
    { "idempotency-key": crypto.randomUUID() },
  );
  const b = await owner.call(
    "owner/churches",
    { name: `B ${crypto.randomUUID()}`, province: "Đà Nẵng" },
    { "idempotency-key": crypto.randomUUID() },
  );
  expect(a.res.status).toBe(201);
  expect(b.res.status).toBe(201);
  churchA = a.json.data.church;
  churchB = b.json.data.church;
});
afterAll(async () => {
  if (db.db.databaseName === conf.database) await db.db.dropDatabase();
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
describe("P1.3 Accounts and church realm — real Mongo/Redis", () => {
  test("create response only contains first secret; replay/F22/DTO/DB/log never contain plaintext", async () => {
    const data = input(),
      key: string = crypto.randomUUID(),
      first = await owner.create(churchA.id, data, key);
    expect(first.res.status).toBe(201);
    const made = first.json.data,
      password = made.temporaryCredential.password as string;
    expect(password.length === 20).toBe(true);
    expect(Date.parse(made.temporaryCredential.expiresAt) - clock.getTime()).toBe(24 * 60 * 60_000);
    const replay = await owner.create(churchA.id, data, key);
    expect(replay.res.status).toBe(200);
    expect(replay.json.meta.replayed).toBe(true);
    expect(replay.json.data.temporaryCredential === null).toBe(true);
    const op = await owner.call(`owner/operations/${made.operationId}`);
    expect(op.res.status).toBe(200);
    expect(JSON.stringify(op.json).includes(password)).toBe(false);
    const detail = await owner.call(`owner/churches/${churchA.id}/accounts/${made.account.id}`);
    expect(detail.res.headers.get("etag")).toBe('"1"');
    expect(JSON.stringify(detail.json).includes(password)).toBe(false);
    expect("passwordHash" in detail.json.data).toBe(false);
    const credential = await db.credentials.findOne({
      principalKind: "church_user",
      principalId: new ObjectId(made.account.id),
    });
    expect(!!credential && (await verifyPassword(password, credential.passwordHash))).toBe(true);
    const snapshots = JSON.stringify(
      await Promise.all([
        db.db
          .collection("accounts")
          .find({ churchId: new ObjectId(churchA.id) })
          .toArray(),
        db.db
          .collection("idempotency_operations")
          .find({ routeKey: { $regex: churchA.id } })
          .toArray(),
        db.audits.find({ targetChurchId: new ObjectId(churchA.id) }).toArray(),
      ]),
    );
    expect(snapshots.includes(password)).toBe(false);
    expect(JSON.stringify(logs).includes(password)).toBe(false);
    expect(
      (await owner.create(churchA.id, { ...data, displayName: "Ý định khác" }, key)).json.error
        .code,
    ).toBe("IDEMPOTENCY_CONFLICT");
  });
  test("same email is unique inside church and independent across churches; concurrent duplicate cannot create half credentials", async () => {
    const data = input(),
      rs = await Promise.all([owner.create(churchA.id, data), other.create(churchA.id, data)]);
    expect(rs.map((r) => r.res.status).sort()).toEqual([201, 409]);
    const id = rs.find((r) => r.res.status === 201)?.json.data.account.id;
    const duplicate = rs.find((r) => r.res.status === 409);
    expect(duplicate?.json.error.code).toBe("ACCOUNT_EXISTS");
    expect(duplicate?.json.error.resourceId === id).toBe(true);
    const inB = await other.create(churchB.id, data);
    expect(inB.res.status).toBe(201);
    expect(inB.json.data.account.id !== id).toBe(true);
    const creds = await db.credentials
      .find({
        principalKind: "church_user",
        principalId: { $in: [new ObjectId(id), new ObjectId(inB.json.data.account.id)] },
      })
      .toArray();
    expect(creds.length).toBe(2);
    expect(creds[0]?.passwordHash !== creds[1]?.passwordHash).toBe(true);
  });
  test("strict inputs forbid owner escalation, church change, profile matching and incompatible scopes", async () => {
    for (const body of [
      { ...input(), role: "owner" },
      { ...input(), churchId: churchB.id },
      { ...input(), subjectMemberId: new ObjectId().toHexString() },
      { ...input(), role: "member", scope: { kind: "church" } },
      { ...input(), scope: { kind: "self" } },
    ])
      expect((await owner.create(churchA.id, body)).res.status).toBe(422);
    expect(
      (
        await owner.create(churchA.id, {
          ...input(),
          role: "ministry_lead",
          scope: { kind: "assigned_units", unitIds: [new ObjectId().toHexString()] },
        })
      ).json.error.code,
    ).toBe("SCOPE_TARGET_NOT_AVAILABLE");
    const member = await created(churchA, { ...input(), role: "member", scope: { kind: "self" } });
    const doc = await db.db
      .collection("accounts")
      .findOne({ _id: new ObjectId(member.account.id) });
    expect(doc?.subjectMemberId === undefined).toBe(true);
  });
  test("limited session cannot read context/activity or owner routes; password change returns correct realm and invalidates temp", async () => {
    const { c, made } = await userSession(churchA, input(), false);
    expect((await c.call("auth/me")).json.data.sessionState).toBe("password_change");
    expect((await c.call(`churches/${churchA.id}/context`)).res.status).toBe(403);
    expect((await c.call("auth/activity", {})).res.status).toBe(403);
    expect((await c.call("owner/churches")).res.status).toBe(401);
    for (const password of ["abcdefg", "x".repeat(129), "bad\ud800secret"]) {
      expect(
        (
          await c.call("auth/change-initial-password", {
            newPassword: password,
            confirmation: password,
          })
        ).res.status,
      ).toBe(422);
    }
    const password = " 🌿".repeat(4);
    expect(
      (
        await c.call("auth/change-initial-password", {
          newPassword: password,
          confirmation: password,
        })
      ).res.status,
    ).toBe(204);
    expect(c.jar.has(cookieName("church"))).toBe(false);
    await c.boot();
    expect(
      (await c.login(made.account.email, made.temporaryCredential.password, churchA.code)).res
        .status,
    ).toBe(401);
    expect((await c.login(made.account.email, password, churchA.code)).res.status).toBe(200);
    expect((await c.call(`churches/${churchA.id}/context`)).res.status).toBe(200);
  });
  test("same browser owner cookie cannot elevate user context; opposite realm credentials fail", async () => {
    const { c, made, password } = await userSession(churchA, input(ownerEmail));
    c.jar.set(cookieName("owner"), owner.jar.get(cookieName("owner")) as string);
    expect((await c.call(`churches/${churchB.id}/context`)).res.status).toBe(403);
    const context = await c.call(`churches/${churchA.id}/context`);
    expect(context.json.data.church.id).toBe(churchA.id);
    expect(context.json.data.principal.principalKind).toBe("church_user");
    expect(context.json.data.capabilities.includes("accounts:manage")).toBe(false);
    const wrong = new Client();
    await wrong.boot();
    expect((await wrong.login(made.account.email, password)).res.status).toBe(401);
    const wrongUser = new Client("church");
    await wrongUser.boot();
    expect((await wrongUser.login(ownerEmail, ownerPassword, churchA.code)).res.status).toBe(401);
    await c.boot();
    const ownerCookie = c.jar.get(cookieName("owner"));
    expect((await c.call("auth/logout", {})).res.status).toBe(204);
    expect(c.jar.get(cookieName("owner")) === ownerCookie).toBe(true);
    expect((await c.call("owner/auth/me")).res.status).toBe(200);
  });
  test("account/permissions/status/reset endpoints never accept a different church path or request tenant override", async () => {
    const { made } = await userSession();
    for (const action of ["permissions", "status", "temporary-passwords"]) {
      const body =
        action === "permissions"
          ? { role: "member", scope: { kind: "self" } }
          : action === "status"
            ? { status: "locked", reason: "test" }
            : { supportReference: "test" };
      expect((await owner.mutate(churchB.id, made.account.id, action, body, 2)).res.status).toBe(
        404,
      );
    }
    expect(
      (await owner.call(`owner/churches/${churchB.id}/accounts/${made.account.id}`)).res.status,
    ).toBe(404);
    expect(
      (
        await owner.mutate(
          churchA.id,
          made.account.id,
          "permissions",
          { role: "secretary", scope: { kind: "church" }, churchId: churchB.id },
          2,
        )
      ).res.status,
    ).toBe(422);
  });
  test("permissions CAS races one winner, preserves status and changes live context without old write grants", async () => {
    const { c, made } = await userSession();
    const a = await owner.call(`owner/churches/${churchA.id}/accounts/${made.account.id}`),
      v = a.json.data.version;
    const tenancy = new Tenancy(
        db,
        new Operations(db, identity.now),
        identity.audit,
        (ids) => identity.activeAccountCounts(ids),
        conf.csrfKey,
        (id, tx) => identity.suspendChurchSessions(id, tx),
        identity.now,
      ),
      churchIdentity = new ChurchIdentity(identity, tenancy.access());
    const old = churchIdentity.grant(
      await churchIdentity.authorize(c.jar.get(cookieName("church"))),
    );
    const results = await Promise.all([
      owner.mutate(
        churchA.id,
        made.account.id,
        "permissions",
        { role: "member", scope: { kind: "self" } },
        v,
      ),
      other.mutate(
        churchA.id,
        made.account.id,
        "permissions",
        { role: "treasurer", scope: { kind: "church" } },
        v,
      ),
    ]);
    expect(results.map((r) => r.res.status).sort()).toEqual([200, 412]);
    let denied = false;
    try {
      await db.transaction(async (tx) => {
        await old.fence(tx);
      });
    } catch (e) {
      denied = e instanceof AppError && e.code === "SESSION_REVOKED";
    }
    expect(denied).toBe(true);
    const me = await c.call("auth/me"),
      ctx = await c.call(`churches/${churchA.id}/context`);
    expect(me.res.status).toBe(200);
    expect(ctx.res.status).toBe(200);
    expect(me.json.data.version).toBe(v + 1);
    expect(ctx.json.data.principal.role).toBe(me.json.data.role);
    expect(() => old.require("finance:personal")).toThrow("FORBIDDEN");
  });
  test("P1.4 barrier: permission change or lock after snapshot read prevents in-flight grant commit", async () => {
    for (const action of ["permissions", "status"]) {
      const { c, made } = await userSession();
      const tenancy = new Tenancy(
        db,
        new Operations(db, identity.now),
        identity.audit,
        (ids) => identity.activeAccountCounts(ids),
        conf.csrfKey,
        (id, tx) => identity.suspendChurchSessions(id, tx),
        identity.now,
      );
      const churchIdentity = new ChurchIdentity(identity, tenancy.access());
      const grant = churchIdentity.grant(
        await churchIdentity.authorize(c.jar.get(cookieName("church"))),
      );
      const current = await owner.call(`owner/churches/${churchA.id}/accounts/${made.account.id}`);
      let entered = () => {},
        release = () => {},
        attempts = 0,
        error: unknown;
      const reached = new Promise<void>((resolve) => {
          entered = resolve;
        }),
        resume = new Promise<void>((resolve) => {
          release = resolve;
        });
      const inFlight = db
        .transaction(async (tx) => {
          await db.db
            .collection("accounts")
            .findOne({ _id: new ObjectId(made.account.id) }, { session: tx });
          attempts++;
          if (attempts === 1) {
            entered();
            await resume;
          }
          await grant.fence(tx);
          await identity.audit.principal(
            "qualification.fenced_write",
            crypto.randomUUID(),
            {
              kind: "church_user",
              id: new ObjectId(made.account.id),
              churchId: new ObjectId(churchA.id),
            },
            { id: new ObjectId(made.account.id), churchId: new ObjectId(churchA.id) },
            [],
            tx,
          );
        })
        .catch((e) => {
          error = e;
        });
      await reached;
      try {
        const result = await owner.mutate(
          churchA.id,
          made.account.id,
          action,
          action === "permissions"
            ? { role: "member", scope: { kind: "self" } }
            : { status: "locked", reason: "Barrier verification" },
          current.json.data.version,
        );
        expect(result.res.status).toBe(200);
      } finally {
        release();
      }
      await inFlight;
      expect(attempts >= 2).toBe(true);
      expect(error instanceof AppError && error.code === "SESSION_REVOKED").toBe(true);
      expect(
        await db.audits.countDocuments({
          eventType: "qualification.fenced_write",
          targetId: new ObjectId(made.account.id),
        }),
      ).toBe(0);
    }
  });
  test("lock/unlock revokes only target account; unlock never revives old session; permission edit cannot unlock", async () => {
    const email = input().email,
      a = await userSession(churchA, input(email)),
      b = await userSession(churchB, input(email));
    const detail = await owner.call(`owner/churches/${churchA.id}/accounts/${a.made.account.id}`);
    let result = await owner.mutate(
      churchA.id,
      a.made.account.id,
      "status",
      { status: "locked", reason: "Security test" },
      detail.json.data.version,
    );
    expect(result.res.status).toBe(200);
    expect((await a.c.call("auth/me")).res.status).toBe(401);
    expect((await b.c.call("auth/me")).res.status).toBe(200);
    result = await owner.mutate(
      churchA.id,
      a.made.account.id,
      "permissions",
      { role: "member", scope: { kind: "self" } },
      result.json.data.account.version,
    );
    expect(result.json.data.account.status).toBe("locked");
    expect(
      (
        await owner.mutate(
          churchA.id,
          a.made.account.id,
          "temporary-passwords",
          { supportReference: "test" },
          result.json.data.account.version,
        )
      ).json.error.code,
    ).toBe("ACCOUNT_LOCKED");
    result = await owner.mutate(
      churchA.id,
      a.made.account.id,
      "status",
      { status: "active", reason: "Allowed again" },
      result.json.data.account.version,
    );
    expect(result.res.status).toBe(200);
    expect((await a.c.call("auth/me")).res.status).toBe(401);
    const fresh = new Client("church");
    await fresh.boot();
    expect((await fresh.login(email, a.password, churchA.code)).res.status).toBe(200);
  });
  test("suspended church permits account administration but blocks all user access/context, not other church", async () => {
    const a = await userSession(),
      b = await userSession(churchB);
    expect(
      (
        await owner.call(
          `owner/churches/${churchA.id}/status`,
          { status: "suspended", reason: "test" },
          { "idempotency-key": crypto.randomUUID(), "if-match": '"1"' },
          "PATCH",
        )
      ).res.status,
    ).toBe(200);
    expect((await a.c.call("auth/me")).res.status).toBe(401);
    expect((await b.c.call("auth/me")).res.status).toBe(200);
    expect((await owner.call(`owner/churches/${churchA.id}/context`)).res.status).toBe(403);
    expect((await owner.call(`owner/churches/${churchB.id}/context`)).res.status).toBe(200);
    const newAccount = await created();
    expect(
      (
        await owner.mutate(
          churchA.id,
          newAccount.account.id,
          "permissions",
          { role: "member", scope: { kind: "self" } },
          1,
        )
      ).res.status,
    ).toBe(200);
    const c = new Client("church");
    await c.boot();
    expect((await c.login(newAccount.account.email, "wrong", churchA.code)).json.error.code).toBe(
      "INVALID_CREDENTIALS",
    );
    expect(
      (
        await c.login(
          newAccount.account.email,
          newAccount.temporaryCredential.password,
          churchA.code,
        )
      ).json.error.code,
    ).toBe("CHURCH_SUSPENDED");
  });
  test("reset recent auth, first response, replay, references and account-local credential/session invalidation", async () => {
    const { c, made, password } = await userSession(),
      detail = await owner.call(`owner/churches/${churchA.id}/accounts/${made.account.id}`),
      v = detail.json.data.version;
    const session = await db.sessions.findOne({
      tokenHash: digest(owner.jar.get(cookieName("owner")) as string),
    });
    await db.sessions.updateOne(
      { _id: session?._id },
      { $set: { lastPasswordVerifiedAt: new Date(clock.getTime() - 6 * 60_000) } },
    );
    expect(
      (
        await owner.mutate(
          churchA.id,
          made.account.id,
          "temporary-passwords",
          { supportReference: "CASE-123" },
          v,
        )
      ).json.error.code,
    ).toBe("RECENT_AUTH_REQUIRED");
    await owner.boot();
    expect((await owner.call("owner/auth/reauth", { password: ownerPassword })).res.status).toBe(
      200,
    );
    const key: string = crypto.randomUUID(),
      reset = await owner.mutate(
        churchA.id,
        made.account.id,
        "temporary-passwords",
        { supportReference: "CASE-123" },
        v,
        key,
      );
    expect(reset.res.status).toBe(201);
    expect((await c.call("auth/me")).res.status).toBe(401);
    const replay = await owner.mutate(
      churchA.id,
      made.account.id,
      "temporary-passwords",
      { supportReference: "CASE-123" },
      v,
      key,
    );
    expect(replay.res.status).toBe(200);
    expect(replay.json.data.temporaryCredential === null).toBe(true);
    const fresh = new Client("church");
    await fresh.boot();
    expect((await fresh.login(made.account.email, password, churchA.code)).res.status).toBe(401);
    expect(
      (
        await fresh.login(
          made.account.email,
          reset.json.data.temporaryCredential.password,
          churchA.code,
        )
      ).res.status,
    ).toBe(200);
    expect((await fresh.call("auth/me")).json.data.sessionState).toBe("password_change");
    const audit = await db.audits.findOne({
      eventType: "account.temp_password_issued",
      targetId: new ObjectId(made.account.id),
    });
    expect(audit?.safeSummary.includes("CASE-123")).toBe(true);
    expect(audit?.targetChurchId?.toHexString()).toBe(churchA.id);
    expect(audit?.actorKind).toBe("owner");
  });
  test("reset rate is scoped to account/church, and replay does not consume another attempt", async () => {
    const made = await created(),
      same = await created(churchB, input(made.account.email));
    let v = 1;
    let firstKey = "";
    for (let i = 0; i < 5; i++) {
      const key: string = crypto.randomUUID();
      if (i === 0) firstKey = key;
      const r = await owner.mutate(
        churchA.id,
        made.account.id,
        "temporary-passwords",
        { supportReference: "RATE" },
        v,
        key,
      );
      expect(r.res.status).toBe(201);
      v = r.json.data.account.version;
    }
    expect(
      (
        await owner.mutate(
          churchA.id,
          made.account.id,
          "temporary-passwords",
          { supportReference: "RATE" },
          1,
          firstKey,
        )
      ).res.status,
    ).toBe(200);
    expect(
      (
        await owner.mutate(
          churchA.id.toUpperCase(),
          made.account.id.toUpperCase(),
          "temporary-passwords",
          { supportReference: "RATE" },
          v,
        )
      ).res.status,
    ).toBe(429);
    expect(
      (
        await owner.mutate(
          churchB.id,
          same.account.id,
          "temporary-passwords",
          { supportReference: "RATE" },
          1,
        )
      ).res.status,
    ).toBe(201);
  });
  test("user rate limits bind email to church and never to global matching email", async () => {
    const email = input().email;
    await created(churchA, input(email));
    await created(churchB, input(email));
    const a = new Client("church"),
      b = new Client("church");
    b.ip = a.ip;
    await a.boot();
    await b.boot();
    for (let i = 0; i < 5; i++)
      expect((await a.login(email, "wrong", churchA.code)).res.status).toBe(401);
    expect((await a.login(email, "wrong", churchA.code)).res.status).toBe(429);
    expect((await b.login(email, "wrong", churchB.code)).res.status).toBe(401);
  });
  test("user idle/absolute/limited expiry and TTL checks; reauth rotates but keeps absolute deadline", async () => {
    const { c } = await userSession();
    const recent = await userSession(churchB);
    const before = await db.sessions.findOne({
      tokenHash: digest(recent.c.jar.get(cookieName("church")) as string),
    });
    const old = await db.sessions.findOne({
      tokenHash: digest(c.jar.get(cookieName("church")) as string),
    });
    expect(!!old).toBe(true);
    clock = new Date(clock.getTime() + 16 * 60_000);
    expect((await c.call("auth/me")).json.error.code).toBe("REAUTH_REQUIRED");
    expect((await c.call("auth/activity", {})).res.status).toBe(401);
    const account = await db.db.collection("accounts").findOne({ _id: old?.principalId });
    expect(!!account).toBe(true);
    // Use a second session fixture to retain its known password for reauth.
    await recent.c.boot();
    expect((await recent.c.call("auth/reauth", { password: recent.password })).res.status).toBe(
      200,
    );
    const after = await db.sessions.findOne({
      tokenHash: digest(recent.c.jar.get(cookieName("church")) as string),
    });
    expect(after?.absoluteExpiresAt.getTime()).toBe(before?.absoluteExpiresAt.getTime());
    expect(after?._id.equals(before?._id as ObjectId)).toBe(false);
    clock = new Date((after?.absoluteExpiresAt.getTime() ?? 0) + 1);
    expect((await recent.c.call("auth/me")).res.status).toBe(401);
  });
  test("temp24h and limited15m rejected even while expired documents still exist", async () => {
    const { c, made } = await userSession(churchA, input(), false);
    clock = new Date(clock.getTime() + 16 * 60_000);
    expect((await c.call("auth/me")).res.status).toBe(401);
    const fresh = new Client("church");
    await fresh.boot();
    expect(
      (await fresh.login(made.account.email, made.temporaryCredential.password, churchA.code)).res
        .status,
    ).toBe(200);
    clock = new Date(Date.parse(made.temporaryCredential.expiresAt) + 1);
    const late = new Client("church");
    await late.boot();
    expect(
      (await late.login(made.account.email, made.temporaryCredential.password, churchA.code)).json
        .error.code,
    ).toBe("TEMP_PASSWORD_EXPIRED");
    expect(
      await db.credentials.countDocuments({ principalId: new ObjectId(made.account.id) }),
    ).toBe(1);
  });
  test("two password-change tabs commit once and all old limited sessions are revoked", async () => {
    const { c, made } = await userSession(churchA, input(), false),
      second = new Client("church");
    await second.boot();
    expect(
      (await second.login(made.account.email, made.temporaryCredential.password, churchA.code)).res
        .status,
    ).toBe(200);
    const p = `Changed ${crypto.randomUUID()}`,
      rs = await Promise.all([
        c.call("auth/change-initial-password", { newPassword: p, confirmation: p }),
        second.call("auth/change-initial-password", { newPassword: p, confirmation: p }),
      ]);
    expect(rs.filter((r) => r.res.status === 204).length).toBe(1);
    expect(rs.filter((r) => r.res.status === 401).length).toBe(1);
  });
  test("audit failure aborts account+credential+operation; no half create", async () => {
    const data = input();
    await db.db.command({ collMod: "audit_events", validator: { $expr: { $eq: [1, 0] } } });
    try {
      expect((await owner.create(churchA.id, data)).res.status).toBe(503);
      expect(
        await db.db
          .collection("accounts")
          .countDocuments({ churchId: new ObjectId(churchA.id), emailKey: data.email }),
      ).toBe(0);
      expect(
        await db.db
          .collection("idempotency_operations")
          .countDocuments({ routeKey: `/owner/churches/${churchA.id}/accounts` }),
      ).toBe(0);
    } finally {
      await initialize(db.db);
    }
  });
  test("lost commit acknowledgement keeps real account and resolves via F22/replay without secret or duplicate", async () => {
    const data = input(),
      key: string = crypto.randomUUID();
    const original = db.client.startSession.bind(db.client);
    const spy = spyOn(db.client, "startSession").mockImplementation((...args) => {
      const session = original(...args),
        commit = session.commitTransaction.bind(session);
      let committed = false;
      session.commitTransaction = async () => {
        if (!committed) {
          await commit();
          committed = true;
        }
        const error = new MongoError("Synthetic acknowledgement loss");
        error.addErrorLabel("UnknownTransactionCommitResult");
        throw error;
      };
      return session;
    });
    let r: Awaited<ReturnType<Client["create"]>>;
    try {
      r = await owner.create(churchA.id, data, key);
    } finally {
      spy.mockRestore();
    }
    expect(r.res.status).toBe(503);
    expect(r.json.error.code).toBe("OUTCOME_UNKNOWN");
    expect(typeof r.json.meta.operationId === "string").toBe(true);
    expect(
      await db.db
        .collection("accounts")
        .countDocuments({ churchId: new ObjectId(churchA.id), emailKey: data.email }),
    ).toBe(1);
    const op = await owner.call(`owner/operations/${r.json.meta.operationId}`);
    expect(op.res.status).toBe(200);
    expect(op.json.data.safeResult.temporaryCredential === null).toBe(true);
    const replay = await owner.create(churchA.id, data, key);
    expect(replay.res.status).toBe(200);
    expect(replay.json.data.temporaryCredential === null).toBe(true);
  });
  test("keyset25 default, ties/filter/tenant/actor-bound cursors, exact email and literal regex characters", async () => {
    for (let i = 0; i < 5; i++)
      await created(churchA, {
        ...input(`list${i}@example.test`),
        displayName: i < 3 ? "Tên trùng" : "Tên khác",
      });
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const r = await owner.call(
        `owner/churches/${churchA.id}/accounts?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(r.res.status).toBe(200);
      expect("total" in r.json.data).toBe(false);
      ids.push(...r.json.data.items.map((a: { id: string }) => a.id));
      cursor = r.json.data.nextCursor;
      if (cursor) {
        expect(
          (
            await owner.call(
              `owner/churches/${churchB.id}/accounts?limit=2&cursor=${encodeURIComponent(cursor)}`,
            )
          ).json.error.code,
        ).toBe("CURSOR_CONTEXT_MISMATCH");
        expect(
          (
            await other.call(
              `owner/churches/${churchA.id}/accounts?limit=2&cursor=${encodeURIComponent(cursor)}`,
            )
          ).json.error.code,
        ).toBe("CURSOR_CONTEXT_MISMATCH");
      }
    } while (cursor);
    expect(ids.length).toBe(5);
    expect(new Set(ids).size).toBe(5);
    expect(
      (await owner.call(`owner/churches/${churchA.id}/accounts?q=list1%40example.test`)).json.data
        .items.length,
    ).toBe(1);
    expect(
      (await owner.call(`owner/churches/${churchA.id}/accounts?q=.*`)).json.data.items.length,
    ).toBe(0);
    expect(
      (await owner.call(`owner/churches/${churchA.id}/accounts?churchId=${churchB.id}`)).res.status,
    ).toBe(400);
  });
  test("F15 query plans stay tenant bounded for ordered pages, exact email, role/status and literal prefix", async () => {
    const made = await created();
    const collection = db.db.collection("accounts");
    const source = await collection.findOne({ _id: new ObjectId(made.account.id) });
    if (!source) throw new Error("Missing synthetic query fixture");
    await collection.insertMany(
      Array.from({ length: 600 }, (_, i) => ({
        ...source,
        _id: new ObjectId(),
        email: `sample-${i}@example.test`,
        emailKey: `sample-${i}@example.test`,
        displayName: `Sample ${i}`,
        displayNameKey: `sample ${i}`,
      })),
    );
    const rows = [];
    for (const [name, extra] of [
      ["ordered", {}],
      ["exact-email", { emailKey: made.account.email.toLowerCase() }],
      ["role-status", { role: "secretary", status: "active" }],
      [
        "prefix",
        { $or: [{ displayNameKey: { $regex: "^nguyễn" } }, { emailKey: { $regex: "^acct" } }] },
      ],
    ] as [string, Filter<Document>][]) {
      const plan = await db.db
        .collection("accounts")
        .find({ churchId: new ObjectId(churchA.id), ...extra })
        .sort({ displayNameKey: 1, _id: 1 })
        .limit(26)
        .explain("executionStats");
      const indexes = new Set<string>();
      function walk(value: unknown) {
        if (value && typeof value === "object")
          for (const [key, item] of Object.entries(value)) {
            if (key === "indexName" && typeof item === "string") indexes.add(item);
            else walk(item);
          }
      }
      walk(plan.queryPlanner.winningPlan);
      expect(indexes.size > 0).toBe(true);
      if (name === "ordered") expect(indexes.has("church_name")).toBe(true);
      if (name === "exact-email") expect(indexes.has("church_email_unique")).toBe(true);
      expect(plan.executionStats.nReturned).toBe(
        name === "exact-email" || name === "prefix" ? 1 : 26,
      );
      if (name === "exact-email") expect(plan.executionStats.totalDocsExamined <= 2).toBe(true);
      rows.push({
        name,
        indexes: [...indexes],
        returned: plan.executionStats.nReturned,
        keysExamined: plan.executionStats.totalKeysExamined,
        documentsExamined: plan.executionStats.totalDocsExamined,
        millis: plan.executionStats.executionTimeMillis,
      });
    }
    await Bun.write(
      "output/p1.4/accounts-query-explain.json",
      JSON.stringify(
        {
          status: "PASS",
          limits: [
            "601 accounts in one synthetic church, not production capacity",
            "Role/status or prefix may filter/sort within tenant; no search index or scale claim",
          ],
          queries: rows,
        },
        null,
        2,
      ),
    );
  });
  test("active counts update across create/lock/unlock without contaminating another church", async () => {
    const made = await created();
    expect(
      (await owner.call(`owner/churches/${churchA.id}`)).json.data.counters.accounts.value,
    ).toBe(1);
    expect(
      (await owner.call(`owner/churches/${churchB.id}`)).json.data.counters.accounts.value,
    ).toBe(0);
    const lock = await owner.mutate(
      churchA.id,
      made.account.id,
      "status",
      { status: "locked", reason: "test" },
      1,
    );
    expect(
      (await owner.call(`owner/churches/${churchA.id}`)).json.data.counters.accounts.value,
    ).toBe(0);
    await owner.mutate(
      churchA.id,
      made.account.id,
      "status",
      { status: "active", reason: "test" },
      lock.json.data.account.version,
    );
    expect(
      (await owner.call(`owner/churches/${churchA.id}`)).json.data.counters.accounts.value,
    ).toBe(1);
  });
  test("CSRF/Origin scoped to church; logout does not revoke owner; user audit target is own church", async () => {
    const { c, made } = await userSession();
    expect(
      (await c.call("auth/activity", {}, { origin: "https://invalid.example" })).res.status,
    ).toBe(403);
    expect((await c.call("auth/activity", {}, { "x-csrf-token": owner.csrf })).res.status).toBe(
      403,
    );
    const audit = await db.audits.findOne({
      actorKind: "church_user",
      actorId: new ObjectId(made.account.id),
    });
    expect(audit?.actorChurchId?.toHexString()).toBe(churchA.id);
    expect(audit?.targetChurchId?.toHexString()).toBe(churchA.id);
    const deny = await c.call(`churches/${churchB.id}/context`);
    expect(deny.res.status).toBe(403);
    const denied = await db.audits.findOne({
      eventType: "authorization.denied",
      requestId: deny.json.meta.requestId,
    });
    expect(denied?.targetChurchId?.toHexString()).toBe(churchA.id);
  });
  test("Redis failure closes user login and reset without a credential change", async () => {
    const made = await created(),
      c = new Client("church");
    await c.boot();
    let spy = spyOn(rate.client, "eval").mockImplementationOnce(async () => {
      throw new Error("Synthetic Redis outage");
    });
    try {
      expect(
        (await c.login(made.account.email, made.temporaryCredential.password, churchA.code)).res
          .status,
      ).toBe(503);
    } finally {
      spy.mockRestore();
    }
    const old = await db.credentials.findOne({
      principalKind: "church_user",
      principalId: new ObjectId(made.account.id),
    });
    spy = spyOn(rate.client, "eval").mockImplementationOnce(async () => {
      throw new Error("Synthetic Redis outage");
    });
    try {
      expect(
        (
          await owner.mutate(
            churchA.id,
            made.account.id,
            "temporary-passwords",
            { supportReference: "REDIS" },
            1,
          )
        ).res.status,
      ).toBe(503);
    } finally {
      spy.mockRestore();
    }
    const after = await db.credentials.findOne({ _id: old?._id });
    expect(after?.credentialVersion).toBe(old?.credentialVersion);
    expect(after?.passwordHash === old?.passwordHash).toBe(true);
  });
  test("F15 missing preconditions and malformed intents rejected, role/scope targets cannot escape", async () => {
    const made = await created();
    expect(
      (
        await owner.call(
          `owner/churches/${churchA.id}/accounts/${made.account.id}/permissions`,
          { role: "member", scope: { kind: "self" } },
          { "idempotency-key": crypto.randomUUID() },
          "PATCH",
        )
      ).res.status,
    ).toBe(428);
    expect((await owner.create(churchA.id, input(), "invalid")).res.status).toBe(400);
    expect((await owner.call(`owner/churches/${churchA.id}/accounts?limit=101`)).res.status).toBe(
      400,
    );
    expect((await owner.call(`owner/churches/${churchA.id}/accounts?role=owner`)).res.status).toBe(
      400,
    );
  });
  test("Mongo validator denies role/scope mismatch and non-user owner flags", async () => {
    const made = await created(),
      doc = await db.db.collection("accounts").findOne({ _id: new ObjectId(made.account.id) });
    expect(!!doc).toBe(true);
    for (const extra of [
      { role: "owner" },
      { scope: { kind: "self" } },
      { platformRole: "owner" },
      { churchIds: [new ObjectId()] },
    ]) {
      let rejected = false;
      try {
        await db.db
          .collection("accounts")
          .insertOne({ ...doc, _id: new ObjectId(), emailKey: crypto.randomUUID(), ...extra });
      } catch (e) {
        rejected = typeof e === "object" && e !== null && "code" in e && e.code === 121;
      }
      expect(rejected).toBe(true);
    }
  });
  test("P1.4 contract: stale If-Match412 and missing recent auth403, with no unintended mutation", async () => {
    const made = await created();
    for (const [action, body] of [
      ["permissions", { role: "member", scope: { kind: "self" } }],
      ["status", { status: "locked", reason: "Stale request" }],
      ["temporary-passwords", { supportReference: "STALE" }],
    ] as [string, object][]) {
      const r = await owner.mutate(churchA.id, made.account.id, action, body, 999);
      expect(r.res.status).toBe(412);
      expect(r.json.error.code).toBe("VERSION_CONFLICT");
    }
    const before = await owner.call(`owner/churches/${churchA.id}/accounts/${made.account.id}`);
    expect(before.json.data.version).toBe(1);
    expect(before.json.data.status).toBe("active");
    await db.sessions.updateOne(
      { tokenHash: digest(owner.jar.get(cookieName("owner")) as string) },
      { $set: { lastPasswordVerifiedAt: new Date(clock.getTime() - 6 * 60_000) } },
    );
    const r = await owner.mutate(
      churchA.id,
      made.account.id,
      "temporary-passwords",
      { supportReference: "RECENT" },
      1,
    );
    expect(r.res.status).toBe(403);
    expect(r.json.error.code).toBe("RECENT_AUTH_REQUIRED");
    expect(
      await db.audits.countDocuments({
        eventType: "authorization.denied",
        targetId: new ObjectId(made.account.id),
        actorKind: "owner",
      }),
    ).toBe(1);
    const provider = await owner.call(`owner/churches/${churchA.id}/context`);
    expect(provider.json.data.principal.principalKind).toBe("owner");
    expect(
      provider.json.data.capabilities.some(
        (v: string) => v.startsWith("finance") || v.startsWith("prayer"),
      ),
    ).toBe(false);
  });
  test("retired routes remain unregistered; static user URLs served", async () => {
    for (const path of ["me/churches", "owner/accounts"])
      expect((await owner.call(path)).res.status).toBe(404);
    for (const path of [
      `/h/${churchA.code}/login`,
      `/h/${churchA.code}/change-password`,
      `/h/${churchA.code}`,
      `/owner/churches/${churchA.id}/accounts`,
    ]) {
      const r = await app(new Request(`${conf.origin}${path}`), { ip: "static" });
      expect(r.status).toBe(200);
    }
  });
});
