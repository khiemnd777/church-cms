import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { config } from "../../api/config";
import { AppError } from "../../api/errors";
import { digest, hashPassword, validatePassword } from "../../api/identity/crypto";
import { OwnerOperations } from "../../api/identity/owner-operations";
import { ABSOLUTE_MS, cookieName, IDLE_MS, Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";

const conf = {
  ...config(),
  origin: "https://localhost:3448",
  port: 3448,
  database: `church_cms_test_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw new Error("Tests require local synthetic MongoDB");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  ops = new OwnerOperations(db);
let clock = new Date(),
  identity: Identity,
  app: ReturnType<typeof createApp>;
const logs: object[] = [];
class Browser {
  jar = new Map<string, string>();
  csrf = "";
  ip = crypto.randomUUID();
  async call(path: string, body?: object, extra: Record<string, string> = {}, method?: string) {
    const req = new Request(`${conf.origin}/api/v1/${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        cookie: Array.from(this.jar, ([k, v]) => `${k}=${v}`).join(";"),
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", origin: conf.origin, "x-csrf-token": this.csrf }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const res = await app(req, { ip: this.ip });
    for (const value of res.headers.getSetCookie()) {
      const pair = value.split(";")[0] as string;
      const index = pair.indexOf("=");
      const name = pair.slice(0, index),
        token = pair.slice(index + 1);
      if (token) this.jar.set(name, token);
      else this.jar.delete(name);
    }
    const json = res.status === 204 ? null : await res.json();
    return { res, json };
  }
  async bootstrap(realm = "owner") {
    const { res, json } = await this.call(`auth/csrf?realm=${realm}`);
    expect(res.status).toBe(200);
    this.csrf = json.data.csrfToken as string;
    return { res, json };
  }
  async login(email: string, password: string) {
    await this.bootstrap();
    const result = await this.call("owner/auth/login", { email, password });
    if (result.res.ok) this.csrf = result.json.data.csrfToken as string;
    return result;
  }
  token() {
    return this.jar.get(cookieName("owner")) as string;
  }
}
async function temp() {
  const created = await ops.create({
    email: `${crypto.randomUUID()}@example.test`,
    displayName: "Owner synthetic",
  });
  const browser = new Browser();
  const result = await browser.login(created.email, created.temporaryPassword);
  expect(result.res.status).toBe(200);
  return { created, browser };
}
async function full() {
  const { created, browser } = await temp();
  const password = `Mới 🌿 ${crypto.randomUUID()}`;
  expect(
    (
      await browser.call("owner/auth/change-initial-password", {
        newPassword: password,
        confirmation: password,
      })
    ).res.status,
  ).toBe(204);
  expect((await browser.login(created.email, password)).res.status).toBe(200);
  return { created, browser, password };
}
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await db.ready();
  await rate.connect();
  identity = new Identity(db, rate, conf, () => clock);
  await identity.initialize();
  app = createApp(identity, conf, { log: (row) => logs.push(row) });
});
beforeEach(() => {
  clock = new Date();
});
afterAll(async () => {
  if (db.db.databaseName === conf.database && conf.database.startsWith("church_cms_test_"))
    await db.db.dropDatabase();
  await db.client.close();
  rate.client.destroy();
});
describe("P1.1 real MongoDB replica set and Redis", () => {
  test("temporary owner → limited → password change → login; no secret DTO/logs", async () => {
    const { created, browser } = await temp();
    let result = await browser.call("owner/auth/me");
    expect(result.json.data.sessionState).toBe("password_change");
    expect("platformCapabilities" in result.json.data).toBe(false);
    expect((await browser.call("owner/auth/activity", {})).res.status).toBe(403);
    expect(
      (await browser.call("owner/auth/reauth", { password: created.temporaryPassword })).res.status,
    ).toBe(403);
    const old = browser.token(),
      password = `  Mật khẩu 🌿 ${crypto.randomUUID()}  `;
    expect(
      (
        await browser.call("owner/auth/change-initial-password", {
          newPassword: password,
          confirmation: password,
        })
      ).res.status,
    ).toBe(204);
    expect((await new Browser().login(created.email, created.temporaryPassword)).res.status).toBe(
      401,
    );
    expect((await browser.login(created.email, password)).res.status).toBe(200);
    result = await browser.call("owner/auth/me");
    expect(result.res.status).toBe(200);
    expect(result.json.data.principalKind).toBe("owner");
    expect(result.json.data.platformCapabilities).not.toContain("finance:read");
    const persisted = await db.credentials.findOne({
      principalId: new ObjectId(created.employeeId),
    });
    expect(persisted?.passwordHash.startsWith("$argon2id$v=19$m=65536,t=3,p=1$")).toBe(true);
    const safe = JSON.stringify({
      response: result.json,
      logs,
      audit: await db.audits.find({ actorId: new ObjectId(created.employeeId) }).toArray(),
    });
    for (const value of [
      created.temporaryPassword,
      password,
      old,
      persisted?.passwordHash as string,
    ])
      expect(safe.includes(value)).toBe(false);
    expect((await db.sessions.findOne({ tokenHash: digest(old) }))?.revokedAt instanceof Date).toBe(
      true,
    );
  }, 20000);
  test("password Unicode boundaries, malformed Unicode, common password, confirmation and no trim", () => {
    for (const value of ["a".repeat(7), "a".repeat(129), "\ud800", "password123"])
      expect(() => validatePassword(value)).toThrow(AppError);
    for (const value of ["🌿".repeat(8), "🌿".repeat(128), " ".repeat(8), "a".repeat(128)])
      expect(validatePassword(value) === value).toBe(true);
  });
  test("invalid new password/confirmation/temp reuse keeps limited state", async () => {
    const { created, browser } = await temp();
    for (const body of [
      { newPassword: "1234567", confirmation: "1234567" },
      { newPassword: "Valid pass 1234", confirmation: "different" },
      { newPassword: created.temporaryPassword, confirmation: created.temporaryPassword },
    ])
      expect((await browser.call("owner/auth/change-initial-password", body)).res.status).toBe(422);
    expect((await browser.call("owner/auth/me")).json.data.sessionState).toBe("password_change");
  });
  test("two tabs changing password commit exactly once", async () => {
    const { browser } = await temp();
    const other = new Browser();
    other.jar = new Map(browser.jar);
    other.csrf = browser.csrf;
    const body = {
      newPassword: "Valid concurrent password 🌿",
      confirmation: "Valid concurrent password 🌿",
    };
    const results = await Promise.all([
      browser.call("owner/auth/change-initial-password", body),
      other.call("owner/auth/change-initial-password", body),
    ]);
    expect(results.filter((x) => x.res.status === 204)).toHaveLength(1);
    expect(results.filter((x) => x.res.status === 401)).toHaveLength(1);
  }, 15000);
  test("CSRF tokens stable across tabs; missing/foreign Origin and token rejected", async () => {
    const { browser } = await full();
    const first = browser.csrf;
    expect((await browser.bootstrap()).json.data.csrfToken).toBe(first);
    for (const headers of [
      { origin: "https://evil.example" },
      { "x-csrf-token": "" },
      { "x-csrf-token": "wrong" },
    ] as Record<string, string>[])
      expect((await browser.call("owner/auth/activity", {}, headers)).res.status).toBe(403);
  });
  test("Secure HttpOnly host cookies; token/cookie realm confusion and fixation denied", async () => {
    const browser = new Browser();
    const boot = await browser.bootstrap();
    const attrs = boot.res.headers.getSetCookie().join(";");
    for (const flag of [
      "__Host-qlht_owner_bootstrap",
      "Secure",
      "HttpOnly",
      "Path=/",
      "SameSite=Lax",
    ])
      expect(attrs.includes(flag)).toBe(true);
    expect(attrs.includes("Domain=")).toBe(false);
    const created = await ops.create({
      email: `${crypto.randomUUID()}@example.test`,
      displayName: "Test",
    });
    const bootToken = browser.jar.get(cookieName("owner", true));
    const result = await browser.call("owner/auth/login", {
      email: created.email,
      password: created.temporaryPassword,
    });
    expect(result.res.status).toBe(200);
    expect(browser.token() === bootToken).toBe(false);
    const wrong = new Browser();
    wrong.jar.set(cookieName("church"), browser.token());
    expect((await wrong.call("owner/auth/me")).res.status).toBe(401);
    wrong.jar.set(cookieName("owner"), bootToken as string);
    expect((await wrong.call("owner/auth/me")).res.status).toBe(401);
  });
  test("idle reauth rotates token without extending absolute deadline; old token revoked", async () => {
    const { browser, password } = await full();
    const old = browser.token();
    const original = await db.sessions.findOne({ tokenHash: digest(old) });
    clock = new Date(clock.getTime() + IDLE_MS);
    expect((await browser.call("owner/auth/me")).json.error.code).toBe("REAUTH_REQUIRED");
    expect((await browser.call("owner/auth/activity", {})).res.status).toBe(401);
    await browser.bootstrap();
    expect((await browser.call("owner/auth/reauth", { password })).res.status).toBe(200);
    const next = await db.sessions.findOne({ tokenHash: digest(browser.token()) });
    expect(next?.absoluteExpiresAt.getTime()).toBe(original?.absoluteExpiresAt.getTime());
    expect(browser.token() === old).toBe(false);
    const stale = new Browser();
    stale.jar.set(cookieName("owner"), old);
    expect((await stale.call("owner/auth/me")).res.status).toBe(401);
  });
  test("activity throttled at30s; reads do not touch; absolute expiry not revived", async () => {
    const { browser, password } = await full();
    const hash = digest(browser.token()),
      initial = await db.sessions.findOne({ tokenHash: hash });
    clock = new Date(clock.getTime() + 20000);
    await browser.call("owner/auth/me");
    await browser.call("owner/auth/activity", {});
    expect((await db.sessions.findOne({ tokenHash: hash }))?.lastActivityAt.getTime()).toBe(
      initial?.lastActivityAt.getTime(),
    );
    clock = new Date(clock.getTime() + 10001);
    expect((await browser.call("owner/auth/activity", {})).res.status).toBe(204);
    expect((await db.sessions.findOne({ tokenHash: hash }))?.lastActivityAt.getTime()).toBe(
      clock.getTime(),
    );
    clock = new Date((initial?.createdAt.getTime() ?? 0) + ABSOLUTE_MS);
    expect((await browser.call("owner/auth/reauth", { password })).res.status).toBe(401);
  });
  test("temporary24h and limited15m expiry checked before TTL cleanup", async () => {
    const created = await ops.create({
      email: `${crypto.randomUUID()}@example.test`,
      displayName: "Test",
    });
    const browser = new Browser();
    clock = new Date(created.expiresAt.getTime());
    expect((await browser.login(created.email, created.temporaryPassword)).json.error.code).toBe(
      "TEMP_PASSWORD_EXPIRED",
    );
    clock = new Date();
    const limited = await temp();
    clock = new Date(clock.getTime() + IDLE_MS);
    expect((await limited.browser.call("owner/auth/me")).res.status).toBe(401);
  });
  test("logout clears owner only, revokes token, rejects subsequent reads", async () => {
    const { browser } = await full();
    browser.jar.set(cookieName("church"), "unrelated-church-token");
    const result = await browser.call("owner/auth/logout", {});
    expect(result.res.status).toBe(204);
    expect(browser.jar.has(cookieName("owner"))).toBe(false);
    expect(browser.jar.get(cookieName("church"))).toBe("unrelated-church-token");
    expect((await browser.call("owner/auth/me")).res.status).toBe(401);
  });
  test("email rate limit429 Retry-After; other principal independent; IP limiter shared", async () => {
    const browser = new Browser(),
      email = `${crypto.randomUUID()}@example.test`;
    for (let i = 0; i < 5; i++) expect((await browser.login(email, "bad")).res.status).toBe(401);
    const limited = await browser.login(email, "bad");
    expect(limited.res.status).toBe(429);
    expect(Number(limited.res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await browser.login(`${crypto.randomUUID()}@example.test`, "bad")).res.status).toBe(
      401,
    );
    const ip = crypto.randomUUID();
    for (let i = 0; i < 20; i++) {
      const b = new Browser();
      b.ip = ip;
      expect((await b.login(`${crypto.randomUUID()}@example.test`, "bad")).res.status).toBe(401);
    }
    const b = new Browser();
    b.ip = ip;
    expect((await b.login(`${crypto.randomUUID()}@example.test`, "bad")).res.status).toBe(429);
  }, 30000);
  test("locked owner and authEpoch revoke cannot reauthenticate", async () => {
    const actor = await ops.create({
      email: `${crypto.randomUUID()}@example.test`,
      displayName: "Actor",
    });
    const { created, browser, password } = await full();
    await ops.status(actor.employeeId, created.employeeId, "locked");
    expect((await browser.call("owner/auth/me")).res.status).toBe(401);
    expect((await browser.call("owner/auth/reauth", { password })).res.status).toBe(401);
    await ops.status(actor.employeeId, created.employeeId, "active");
    expect((await browser.call("owner/auth/me")).res.status).toBe(401);
  });
  test("ops cannot self-lock or use locked actor; no HTTP bootstrap/status/user promotion", async () => {
    const actor = await ops.create({
      email: `${crypto.randomUUID()}@example.test`,
      displayName: "Actor",
    });
    await expect(ops.status(actor.employeeId, actor.employeeId, "locked")).rejects.toMatchObject({
      code: "LAST_OWNER_PROTECTED",
    });
    const browser = new Browser();
    for (const path of [
      "owner/bootstrap",
      "owner/auth/signup",
      "owner/auth/reset",
      "owner/auth/status",
      "me/churches",
    ])
      expect((await browser.call(path, {})).res.status).toBe(404);
  });
  test("schema prevents owner as tenant account; duplicate bootstrap transaction rolls back", async () => {
    const owner = await ops.create({
      email: `${crypto.randomUUID()}@example.test`,
      displayName: "Test",
    });
    const before = await db.credentials.countDocuments();
    await expect(ops.create({ email: owner.email, displayName: "Again" })).rejects.toMatchObject({
      code: "ACCOUNT_EXISTS",
    });
    expect(await db.credentials.countDocuments()).toBe(before);
    const record = await db.owners.findOne({ _id: new ObjectId(owner.employeeId) });
    expect(record !== null).toBe(true);
    await expect(
      db.db.collection("owners").insertOne({
        ...record,
        _id: new ObjectId(),
        emailKey: crypto.randomUUID(),
        churchId: new ObjectId(),
      }),
    ).rejects.toMatchObject({ code: 121 });
  });
  test("transaction abort leaves no owner/credential/audit half state", async () => {
    const count = await db.audits.countDocuments();
    await expect(
      db.transaction(async (tx) => {
        await identity.audit.record("synthetic.abort", crypto.randomUUID(), undefined, tx);
        throw new AppError(409, "ABORT_TEST");
      }),
    ).rejects.toMatchObject({ code: "ABORT_TEST" });
    expect(await db.audits.countDocuments()).toBe(count);
  });
  test("Mongo outage503, liveness stays alive; Redis outage503 denies login", async () => {
    const deadDb = new Database(conf);
    await deadDb.client.close();
    const deadIdentity = new Identity(deadDb, rate, conf);
    const deadApp = createApp(deadIdentity, conf, { log: () => {} });
    expect(
      (
        await deadApp(
          new Request(`${conf.origin}/api/v1/owner/auth/me`, {
            headers: { cookie: `${cookieName("owner")}=${"a".repeat(43)}` },
          }),
          { ip: "fault" },
        )
      ).status,
    ).toBe(503);
    expect(
      (await deadApp(new Request(`${conf.origin}/api/health/live`), { ip: "fault" })).status,
    ).toBe(200);
    const deadRate = new RateLimit("redis://127.0.0.1:1", conf.csrfKey);
    await expect(deadRate.consume("test@example.test", "fault")).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
    });
    if (deadRate.client.isOpen) deadRate.client.destroy();
  });
  test("HTTPS listener verifies local CA, same-origin bundle/security headers/readiness", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 3448,
      tls: { cert: Bun.file(conf.cert), key: Bun.file(conf.key) },
      fetch: (req) => app(req, { ip: "tls" }),
    });
    try {
      const get = (path: string) =>
        new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
          (resolve, reject) => {
            const req = request(
              `${conf.origin}${path}`,
              { ca: readFileSync(".local/root-ca.pem"), family: 4 },
              (res) => {
                let body = "";
                res.on("data", (x) => {
                  body += x;
                });
                res.on("end", () =>
                  resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
                );
              },
            );
            req.on("error", reject);
            req.end();
          },
        );
      const ready = await get("/api/health/ready");
      expect(ready.status).toBe(200);
      const page = await get("/owner/login");
      expect(page.status).toBe(200);
      expect(page.body.includes("QLHT")).toBe(true);
      expect(
        String(page.headers["content-security-policy"]).includes("frame-ancestors 'none'"),
      ).toBe(true);
    } finally {
      await server.stop(true);
    }
  });
  test("stale authorized context cannot commit after owner lock", async () => {
    const { created, browser } = await temp();
    const actor = await ops.create({
      email: `${crypto.randomUUID()}@example.test`,
      displayName: "Actor",
    });
    const stale = await identity.authorize(browser.token());
    await ops.status(actor.employeeId, created.employeeId, "locked");
    await expect(
      identity.change(
        stale,
        { newPassword: "Valid stale password 🌿", confirmation: "Valid stale password 🌿" },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "SESSION_REVOKED" });
    expect(
      (await db.credentials.findOne({ principalId: new ObjectId(created.employeeId) }))?.kind,
    ).toBe("temporary");
  });
  test("concurrent owner locks preserve at least one active owner and guard count", async () => {
    const isolatedConf = {
      ...conf,
      database: `church_cms_test_guard_${crypto.randomUUID().replaceAll("-", "")}`,
    };
    const isolated = new Database(isolatedConf);
    try {
      await isolated.client.connect();
      await initialize(isolated.db);
      const manage = new OwnerOperations(isolated);
      const a = await manage.create({ email: "a@example.test", displayName: "A" }),
        b = await manage.create({ email: "b@example.test", displayName: "B" });
      const outcomes = await Promise.allSettled([
        manage.status(a.employeeId, b.employeeId, "locked"),
        manage.status(b.employeeId, a.employeeId, "locked"),
      ]);
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await isolated.owners.countDocuments({ status: "active" })).toBe(1);
      expect(
        (await isolated.db.collection("platform_guard").findOne({ _id: "owner-registry" as never }))
          ?.activeOwnerCount,
      ).toBe(1);
    } finally {
      await isolated.db.dropDatabase();
      await isolated.client.close();
    }
  });
  test("denied limited action records safe audit with true owner actor", async () => {
    const { created, browser } = await temp();
    expect((await browser.call("owner/auth/activity", {})).res.status).toBe(403);
    const denied = await db.audits.findOne({
      eventType: "authorization.denied",
      actorId: new ObjectId(created.employeeId),
    });
    expect(denied?.outcome).toBe("denied");
    expect(denied?.actorChurchId).toBe(null);
    expect(denied?.targetChurchId).toBe(null);
  });
  test("hash concurrency bound fails closed without reducing Argon2 cost", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => hashPassword(crypto.randomUUID())),
    );
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(4);
    expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
  }, 15000);
});
