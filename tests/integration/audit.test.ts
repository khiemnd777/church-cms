import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { config } from "../../api/config";
import { digest } from "../../api/identity/crypto";
import { OwnerOperations } from "../../api/identity/owner-operations";
import { cookieName, Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";

const conf = {
  ...config(),
  origin: "https://localhost:3452",
  database: `church_cms_test_audit_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw new Error("Local synthetic DB only");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  logs: { route?: string; status?: number }[] = [];
let clock = new Date(),
  app: ReturnType<typeof createApp>,
  ownerId: string,
  otherId: string,
  ownerEmail: string,
  otherEmail: string,
  a: Client,
  b: Client,
  limited: Client;
const password = `Audit 🌿 ${crypto.randomUUID()}`,
  churchA = new ObjectId(),
  churchB = new ObjectId(),
  time = new Date("2025-01-01T12:00:00.000Z");
class Client {
  jar = new Map<string, string>();
  csrf = "";
  ip = crypto.randomUUID();
  async call(path: string, body?: object, method?: string) {
    const response = await app(
      new Request(`${conf.origin}/api/v1/${path}`, {
        method: method ?? (body ? "POST" : "GET"),
        headers: {
          cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join(";"),
          ...(body
            ? { "content-type": "application/json", origin: conf.origin, "x-csrf-token": this.csrf }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { ip: this.ip },
    );
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";")[0] as string,
        i = pair.indexOf("=");
      if (pair.slice(i + 1)) this.jar.set(pair.slice(0, i), pair.slice(i + 1));
      else this.jar.delete(pair.slice(0, i));
    }
    const json = response.status === 204 ? null : await response.json();
    if (json?.data?.csrfToken) this.csrf = json.data.csrfToken;
    return { response, json };
  }
  async login(email: string, secret: string) {
    await this.call("auth/csrf?realm=owner");
    const r = await this.call("owner/auth/login", { email, password: secret });
    expect(r.response.status).toBe(200);
  }
  audit(query = "") {
    return this.call(`owner/audit-events${query ? `?${query}` : ""}`);
  }
}
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf, () => clock);
  await identity.initialize();
  app = createApp(identity, conf, { log: (row) => logs.push(row) });
  async function principal(full: boolean) {
    const made = await new OwnerOperations(db).create({
        email: `audit-${crypto.randomUUID()}@example.test`,
        displayName: "Owner synthetic",
      }),
      c = new Client();
    await c.login(made.email, made.temporaryPassword);
    if (full) {
      expect(
        (
          await c.call("owner/auth/change-initial-password", {
            newPassword: password,
            confirmation: password,
          })
        ).response.status,
      ).toBe(204);
      await c.login(made.email, password);
    }
    return { c, made };
  }
  const one = await principal(true),
    two = await principal(true);
  a = one.c;
  ownerId = one.made.employeeId;
  ownerEmail = one.made.email;
  b = two.c;
  otherId = two.made.employeeId;
  otherEmail = two.made.email;
  limited = (await principal(false)).c;
});
beforeEach(async () => {
  clock = new Date();
  await db.audits.deleteMany({});
  for (let i = 0; i < 15; i++)
    await db.audits.insertOne({
      _id: new ObjectId(),
      occurredAt: new Date(time.getTime() + Math.floor(i / 5) * 1000),
      actorKind: "owner",
      actorId: new ObjectId(ownerId),
      actorChurchId: null,
      targetChurchId: i % 3 === 0 ? null : i % 3 === 1 ? churchA : churchB,
      eventType: i % 2 === 0 ? "account.created" : "account.status_changed",
      targetType: "account",
      targetId: new ObjectId(),
      outcome: "success",
      changedFields: ["status"],
      safeSummary: "Safe synthetic summary",
      requestId: crypto.randomUUID(),
    });
});
afterAll(async () => {
  if (db.db.databaseName === conf.database) await db.db.dropDatabase();
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
describe("P1.4 F23 real MongoDB/Redis", () => {
  test("full owner global includes null; scoped query includes only target church, never global/other tenant", async () => {
    const global = await a.audit();
    expect(global.response.status).toBe(200);
    expect(global.json.data.items.length).toBe(15);
    expect(
      global.json.data.items.some(
        (e: { targetChurchId: string | null }) => e.targetChurchId === null,
      ),
    ).toBe(true);
    for (const church of [churchA, churchB]) {
      const r = await a.audit(`churchId=${church.toHexString()}`);
      expect(r.json.data.items.length).toBe(5);
      expect(
        r.json.data.items.every(
          (e: { targetChurchId: string }) => e.targetChurchId === church.toHexString(),
        ),
      ).toBe(true);
    }
    expect((await a.audit(`churchId=${new ObjectId()}`)).json.data.items).toEqual([]);
    expect(global.response.headers.get("cache-control")).toContain("no-store");
    expect(global.json.data.total).toBeUndefined();
  });
  test("DTO allowlist never exposes extra secret fields, including nested future storage fields", async () => {
    await db.db.collection("audit_events").updateOne(
      {},
      {
        $set: {
          password: "secret-marker",
          credentials: { hash: "secret-marker" },
          token: "secret-marker",
          body: { secret: "secret-marker" },
        },
      },
    );
    const r = await a.audit();
    expect(JSON.stringify(r.json).includes("secret-marker")).toBe(false);
    for (const item of r.json.data.items)
      expect(Object.keys(item).sort()).toEqual(
        [
          "id",
          "occurredAt",
          "actorKind",
          "actorId",
          "actorChurchId",
          "targetChurchId",
          "eventType",
          "targetType",
          "targetId",
          "outcome",
          "changedFields",
          "safeSummary",
          "requestId",
        ].sort(),
      );
    expect(JSON.stringify(logs).includes("secret-marker")).toBe(false);
  });
  test("eventType exact and from inclusive/to exclusive with normalized timezone", async () => {
    const query = new URLSearchParams({
      eventType: "account.created",
      from: "2025-01-01T19:00:00+07:00",
      to: "2025-01-01T12:00:01Z",
    });
    const r = await a.audit(query.toString());
    expect(r.response.status).toBe(200);
    expect(r.json.data.items.length).toBe(3);
    expect(
      r.json.data.items.every(
        (e: { occurredAt: string; eventType: string }) =>
          e.occurredAt === time.toISOString() && e.eventType === "account.created",
      ),
    ).toBe(true);
  });
  test("descending keyset ties: all records once, no implicit total, requested page-size bounded", async () => {
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const r = await a.audit(`limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      expect(r.response.status).toBe(200);
      expect(r.json.data.items.length <= 2).toBe(true);
      ids.push(...r.json.data.items.map((e: { id: string }) => e.id));
      cursor = r.json.data.nextCursor;
    } while (cursor);
    const expected = (await db.audits.find().sort({ occurredAt: -1, _id: -1 }).toArray()).map((e) =>
      e._id.toHexString(),
    );
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(15);
  });
  test("cursor binds actor/filter/tenant/global/date and rejects tamper/expiry; equivalent UTC bounds work", async () => {
    const p = new URLSearchParams({
      churchId: churchA.toHexString(),
      from: "2025-01-01T12:00:00Z",
      limit: "1",
    });
    const first = await a.audit(p.toString()),
      cursor = first.json.data.nextCursor;
    expect(typeof cursor).toBe("string");
    p.set("cursor", cursor);
    expect((await b.audit(p.toString())).json.error.code).toBe("CURSOR_CONTEXT_MISMATCH");
    for (const [key, value] of [
      ["churchId", churchB.toHexString()],
      ["eventType", "account.created"],
      ["from", "2025-01-01T12:00:01Z"],
    ]) {
      const altered = new URLSearchParams(p);
      altered.set(key as string, value as string);
      expect((await a.audit(altered.toString())).json.error.code).toBe("CURSOR_CONTEXT_MISMATCH");
    }
    const global = new URLSearchParams(p);
    global.delete("churchId");
    expect((await a.audit(global.toString())).json.error.code).toBe("CURSOR_CONTEXT_MISMATCH");
    p.set("from", "2025-01-01T19:00:00+07:00");
    expect((await a.audit(p.toString())).response.status).toBe(200);
    p.set("cursor", cursor.slice(0, -1) + (cursor.endsWith("a") ? "b" : "a"));
    expect((await a.audit(p.toString())).json.error.code).toBe("INVALID_CURSOR");
    p.set("cursor", cursor);
    clock = new Date(clock.getTime() + 16 * 60_000);
    await db.sessions.updateOne(
      { tokenHash: digest(a.jar.get(cookieName("owner")) as string) },
      { $set: { lastActivityAt: clock } },
    );
    expect((await a.audit(p.toString())).json.error.code).toBe("CURSOR_EXPIRED");
  });
  test("strict/bounded query, duplicate params, impossible ranges and invalid timestamps fail400", async () => {
    for (const query of [
      "churchId=",
      "churchId=bad",
      "limit=0",
      "limit=101",
      "limit=1.5",
      "limit=01",
      "limit=1&limit=2",
      "eventType=",
      "eventType=%24where",
      "from=bad",
      "from=2025-99-99T00%3A00%3A00Z",
      "from=2025-01-02T00%3A00%3A00Z&to=2025-01-01T00%3A00%3A00Z",
      "from=2025-01-01T00%3A00%3A00Z&to=2025-01-01T00%3A00%3A00Z",
      "sort=asc",
      "actorId=1",
      "cursor=",
      `cursor=${"a".repeat(4097)}`,
    ])
      expect((await a.audit(query)).response.status).toBe(400);
  });
  test("anonymous/bootstrap/limited and confused church cookie cannot read audit", async () => {
    const c = new Client();
    expect((await c.audit()).response.status).toBe(401);
    await c.call("auth/csrf?realm=owner");
    expect((await c.audit()).response.status).toBe(401);
    expect((await limited.audit()).response.status).toBe(403);
    const church = await c.call("auth/csrf?realm=church");
    expect(church.response.status).toBe(200);
    c.jar.set(cookieName("owner"), c.jar.get(cookieName("church", true)) as string);
    expect((await c.audit()).response.status).toBe(401);
  });
  test("idle, absolute expiry, epoch change and lock take effect on audit reads", async () => {
    const fresh = new Client();
    await fresh.login(otherEmail, password);
    const tokenHash = digest(fresh.jar.get(cookieName("owner")) as string);
    await db.sessions.updateOne(
      { tokenHash },
      { $set: { lastActivityAt: new Date(clock.getTime() - 16 * 60_000) } },
    );
    expect((await fresh.audit()).json.error.code).toBe("REAUTH_REQUIRED");
    await db.sessions.updateOne(
      { tokenHash },
      { $set: { lastActivityAt: clock, absoluteExpiresAt: new Date(clock.getTime() - 1) } },
    );
    expect((await fresh.audit()).json.error.code).toBe("SESSION_EXPIRED");
    await fresh.login(otherEmail, password);
    await db.owners.updateOne({ _id: new ObjectId(otherId) }, { $inc: { authEpoch: 1 } });
    expect((await fresh.audit()).response.status).toBe(401);
    await fresh.login(otherEmail, password);
    await db.owners.updateOne({ _id: new ObjectId(otherId) }, { $set: { status: "locked" } });
    expect((await fresh.audit()).response.status).toBe(401);
    await db.owners.updateOne({ _id: new ObjectId(otherId) }, { $set: { status: "active" } });
    // The other owner now needs a fresh session after epoch bump for later tests.
    b = new Client();
    await b.login(otherEmail, password);
  });
  test("real Mongo connection outage returns503 without audit DTO or internals", async () => {
    const broken = new Database({
      ...conf,
      mongoUrl: "mongodb://127.0.0.1:1/?directConnection=true",
    });
    try {
      const failing = createApp(new Identity(broken, rate, conf), conf, { log: () => {} });
      const r = await failing(
        new Request(`${conf.origin}/api/v1/owner/audit-events`, {
          headers: { cookie: [...a.jar].map(([k, v]) => `${k}=${v}`).join(";") },
        }),
        { ip: "fault" },
      );
      expect(r.status).toBe(503);
      const json = await r.json();
      expect(json.data).toBeUndefined();
      expect(JSON.stringify(json).includes("127.0.0.1")).toBe(false);
    } finally {
      await broken.client.close();
    }
  });
  test("method and route boundaries: no write/delete audit endpoint, logout revokes reader", async () => {
    for (const method of ["POST", "PATCH", "DELETE"])
      expect((await a.call("owner/audit-events", {}, method)).response.status).toBe(405);
    expect((await a.call(`owner/audit-events/${new ObjectId()}`)).response.status).toBe(404);
    const c = new Client();
    await c.login(ownerEmail, password);
    expect((await c.call("owner/auth/logout", {})).response.status).toBe(204);
    expect((await c.audit()).response.status).toBe(401);
  });
  test("HTTP inventory exposes exactly the28 approved IDs; retired/unapproved routes remain404", async () => {
    const id = new ObjectId().toHexString(),
      table: [string, string, string][] = [
        ["F01", "GET", "auth/csrf?realm=owner"],
        ["F02", "POST", "auth/login"],
        ["F03", "GET", "auth/me"],
        ["F04", "POST", "auth/logout"],
        ["F05", "POST", "auth/change-initial-password"],
        ["F06", "POST", "auth/reauth"],
        ["F07", "POST", "auth/activity"],
        ["F09", "GET", `churches/${id}/context`],
        ["F10", "GET", "owner/churches"],
        ["F11", "POST", "owner/churches"],
        ["F12", "GET", `owner/churches/${id}`],
        ["F13", "PATCH", `owner/churches/${id}`],
        ["F14", "PATCH", `owner/churches/${id}/status`],
        ["F15", "GET", `owner/churches/${id}/accounts`],
        ["F16", "GET", `owner/churches/${id}/accounts/${id}`],
        ["F17", "POST", `owner/churches/${id}/accounts`],
        ["F18", "PATCH", `owner/churches/${id}/accounts/${id}/permissions`],
        ["F19", "PATCH", `owner/churches/${id}/accounts/${id}/status`],
        ["F21", "POST", `owner/churches/${id}/accounts/${id}/temporary-passwords`],
        ["F22", "GET", `owner/operations/${id}`],
        ["F23", "GET", "owner/audit-events"],
        ["F24", "GET", `owner/churches/${id}/context`],
        ["F25", "POST", "owner/auth/login"],
        ["F26", "GET", "owner/auth/me"],
        ["F27", "POST", "owner/auth/logout"],
        ["F28", "POST", "owner/auth/change-initial-password"],
        ["F29", "POST", "owner/auth/reauth"],
        ["F30", "POST", "owner/auth/activity"],
      ];
    const observed = [];
    for (const [id, method, path] of table) {
      const c = new Client();
      const r = await c.call(path, method === "GET" ? undefined : {}, method);
      expect(r.response.status !== 404 && r.response.status !== 405).toBe(true);
      expect(logs.at(-1)?.route).toBe(id);
      observed.push({ id, method, path, status: r.response.status });
    }
    for (const path of [
      "me/churches",
      "owner/accounts",
      "auth/signup",
      "auth/reset",
      "auth/2fa",
      "owner/bootstrap",
      "owner/auth/signup",
      "owner/audit-events/extra",
      "billing",
    ]) {
      expect((await a.call(path)).response.status).toBe(404);
    }
    expect(new Set(observed.map((e) => e.id)).size).toBe(28);
    await Bun.write(
      "output/p1.4/route-inventory.json",
      JSON.stringify(
        {
          status: "PASS",
          routes: observed,
          limits: [
            "Canonical approved HTTP catalogue exercised; not proof of absence of every possible unknown URL",
            "POST/PATCH use invalid intents to avoid mutations; positive flows covered by other tests",
          ],
        },
        null,
        2,
      ),
    );
  });
});
