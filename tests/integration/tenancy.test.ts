import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { type Document, type Filter, MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { config } from "../../api/config";
import { digest } from "../../api/identity/crypto";
import { OwnerOperations } from "../../api/identity/owner-operations";
import { cookieName, Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { Operations } from "../../api/operations/service";
import { Tenancy } from "../../api/tenancy/service";

const conf = {
  ...config(),
  origin: "https://localhost:3450",
  database: `church_cms_test_tenancy_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw new Error("Only local synthetic MongoDB");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  ops = new OwnerOperations(db);
let identity: Identity,
  app: ReturnType<typeof createApp>,
  clock = new Date();
class Client {
  jar = new Map<string, string>();
  csrf = "";
  ip = crypto.randomUUID();
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
        i = pair.indexOf("=");
      if (pair.slice(i + 1)) this.jar.set(pair.slice(0, i), pair.slice(i + 1));
      else this.jar.delete(pair.slice(0, i));
    }
    return { res, json: res.status === 204 ? null : await res.json() };
  }
  async bootstrap() {
    const r = await this.call("auth/csrf?realm=owner");
    expect(r.res.status).toBe(200);
    this.csrf = r.json.data.csrfToken;
  }
  async login(email: string, password: string) {
    await this.bootstrap();
    const r = await this.call("owner/auth/login", { email, password });
    expect(r.res.status).toBe(200);
    this.csrf = r.json.data.csrfToken;
  }
  create(body: object, key: string = crypto.randomUUID()) {
    return this.call("owner/churches", body, { "idempotency-key": key });
  }
  patch(id: string, body: object, version = 1, key: string = crypto.randomUUID(), status = false) {
    return this.call(
      `owner/churches/${id}${status ? "/status" : ""}`,
      body,
      { "idempotency-key": key, "if-match": `"${version}"` },
      "PATCH",
    );
  }
}
let a: Client, b: Client, limited: Client, ownerId: string;
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  identity = new Identity(db, rate, conf, () => clock);
  await identity.initialize();
  app = createApp(identity, conf, { log: () => {} });
  async function principal(full: boolean) {
    const fixture = await ops.create({
        email: `${crypto.randomUUID()}@example.test`,
        displayName: "Owner synthetic",
      }),
      client = new Client();
    await client.login(fixture.email, fixture.temporaryPassword);
    if (full) {
      const password = `Valid 🌿 ${crypto.randomUUID()}`;
      expect(
        (
          await client.call("owner/auth/change-initial-password", {
            newPassword: password,
            confirmation: password,
          })
        ).res.status,
      ).toBe(204);
      await client.login(fixture.email, password);
    }
    return { client, id: fixture.employeeId };
  }
  const first = await principal(true);
  a = first.client;
  ownerId = first.id;
  b = (await principal(true)).client;
  limited = (await principal(false)).client;
});
beforeEach(() => {
  clock = new Date();
});
afterAll(async () => {
  if (db.db.databaseName === conf.database) await db.db.dropDatabase();
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
const data = (suffix = crypto.randomUUID()) => ({
  name: `Hội Thánh ${suffix}`,
  province: "Đà Nẵng",
  district: "Địa hạt synthetic",
  address: "12 Đường thử nghiệm",
  contact: {
    name: "Liên hệ synthetic",
    phone: "0900123456",
    email: `${crypto.randomUUID()}@example.test`,
  },
});
describe("P1.2 Tenancy real database/transactions", () => {
  test("create/get DTO, generated unique code, no auto account, null P2 counters, safe audit", async () => {
    const before = await db.db.collection("accounts").countDocuments(),
      created = await a.create(data());
    expect(created.res.status).toBe(201);
    const c = created.json.data.church;
    expect(/^HT-[A-Z2-9]{10}$/.test(c.code)).toBe(true);
    expect(c.contact.phone).toBe("0900123456");
    expect(c.version).toBe(1);
    expect(created.res.headers.get("etag")).toBe('"1"');
    expect(await db.db.collection("accounts").countDocuments()).toBe(before);
    const read = await a.call(`owner/churches/${c.id}`);
    expect(read.res.status).toBe(200);
    expect(read.json.data.counters.accounts.value).toBe(0);
    for (const k of ["members", "families", "ministries", "areas"])
      expect(read.json.data.counters[k]).toEqual({ value: null, availability: "not_available" });
    for (const field of ["nameKey", "writeFence", "createdBy", "updatedBy"])
      expect(field in c).toBe(false);
    const event = await db.audits.findOne({
      operationId: new ObjectId(created.json.data.operationId),
    });
    expect(event?.actorId?.toHexString()).toBe(ownerId);
    expect(event?.actorKind).toBe("owner");
    expect(event?.targetChurchId?.toHexString()).toBe(c.id);
    expect(event?.targetType).toBe("church");
    expect(event?.actorChurchId).toBe(null);
  });
  test("replay same intent after lost response returns200; changed payload409; one audit and resource", async () => {
    const body = data(),
      key: string = crypto.randomUUID(),
      first = await a.create(body, key),
      again = await a.create(body, key);
    expect(first.res.status).toBe(201);
    expect(again.res.status).toBe(200);
    expect(again.json.meta.replayed).toBe(true);
    expect(again.json.data).toEqual(first.json.data);
    expect((await a.create({ ...body, name: "Different" }, key)).json.error.code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );
    expect(
      await db.audits.countDocuments({ operationId: new ObjectId(first.json.data.operationId) }),
    ).toBe(1);
    expect(
      await db.db
        .collection("churches")
        .countDocuments({ _id: new ObjectId(first.json.data.church.id) }),
    ).toBe(1);
  });
  test("F22 safe result only for original owner, same UUID distinct owners/routes allowed", async () => {
    const key: string = crypto.randomUUID(),
      one = await a.create(data(), key),
      two = await b.create(data(), key);
    expect(two.res.status).toBe(201);
    expect(one.json.data.church.id === two.json.data.church.id).toBe(false);
    const check = await a.call(`owner/operations/${one.json.data.operationId}`);
    expect(check.res.status).toBe(200);
    expect(check.json.data.safeResult.church.id).toBe(one.json.data.church.id);
    expect((await b.call(`owner/operations/${one.json.data.operationId}`)).res.status).toBe(404);
    for (const field of [
      "ownerId",
      "keyHash",
      "payloadHash",
      "password",
      "passwordHash",
      "tokenHash",
    ])
      expect(JSON.stringify(check.json.data).includes(`"${field}"`)).toBe(false);
    expect(
      (await a.patch(one.json.data.church.id, { address: "route scoped" }, 1, key)).res.status,
    ).toBe(200);
  });
  test("PATCH precondition required/stale; null clears optional and omitted retains; no immutable or unknown input", async () => {
    const c = (await a.create(data())).json.data.church,
      path = `owner/churches/${c.id}`;
    expect(
      (await a.call(path, { name: "New" }, { "idempotency-key": crypto.randomUUID() }, "PATCH")).res
        .status,
    ).toBe(428);
    for (const match of ["1", 'W/"1"', '"0"'])
      expect(
        (
          await a.call(
            path,
            { name: "New" },
            { "idempotency-key": crypto.randomUUID(), "if-match": match },
            "PATCH",
          )
        ).res.status,
      ).toBe(400);
    const key: string = crypto.randomUUID(),
      patch = await a.patch(c.id, { address: null, district: null }, 1, key);
    expect(patch.res.status).toBe(200);
    expect(patch.json.data.church.contact).toEqual(c.contact);
    expect("address" in patch.json.data.church).toBe(false);
    expect((await a.patch(c.id, { name: "Stale" }, 1)).json.error.code).toBe("VERSION_CONFLICT");
    expect((await a.patch(c.id, { address: null, district: null }, 1, key)).res.status).toBe(200);
    for (const body of [
      { code: "HT-INVALID" },
      { churchId: new ObjectId().toHexString() },
      { status: "suspended" },
      { name: null },
      {},
    ])
      expect((await a.patch(c.id, body, 2)).res.status).toBe(422);
  });
  test("nested contact PATCH preserves omitted fields; null clears only intended property", async () => {
    const body = data(),
      c = (await a.create(body)).json.data.church;
    const phone = await a.patch(c.id, { contact: { phone: "0012345678" } }, 1);
    expect(phone.res.status).toBe(200);
    expect(phone.json.data.church.contact).toEqual({ ...body.contact, phone: "0012345678" });
    const cleared = await a.patch(c.id, { contact: { email: null } }, 2);
    expect(cleared.res.status).toBe(200);
    expect(cleared.json.data.church.contact).toEqual({
      name: body.contact.name,
      phone: "0012345678",
    });
    expect((await a.patch(c.id, { contact: null }, 3)).json.data.church.contact).toBeUndefined();
  });
  test("validation fields/codepoint bounds/contact and literal query escaping; duplicate names allowed", async () => {
    const same = data(`Duplicate ${crypto.randomUUID()}`);
    expect((await a.create(same)).res.status).toBe(201);
    expect((await a.create(same)).res.status).toBe(201);
    for (const body of [
      { name: "", province: "A" },
      { name: "a".repeat(161), province: "A" },
      { name: "A", province: "" },
      { ...data(), contact: { phone: 123 } },
      { ...data(), contact: { phone: "0".repeat(33) } },
      { ...data(), contact: { email: "invalid" } },
    ])
      expect((await a.create(body)).res.status).toBe(422);
    const unique = `Regex [.*] ${crypto.randomUUID()}`;
    expect((await a.create({ ...data(), name: unique })).res.status).toBe(201);
    const literal = await a.call(`owner/churches?q=${encodeURIComponent(unique)}`);
    expect(literal.res.status).toBe(200);
    expect(literal.json.data.items).toHaveLength(1);
  });
  test("status suspend/resume preserves account/data, revokes church sessions only, reason/CAS audited", async () => {
    const ca = (await a.create(data())).json.data.church,
      cb = (await a.create(data())).json.data.church,
      aid = new ObjectId(),
      bid = new ObjectId(),
      now = new Date();
    const sessions = [
      { churchId: new ObjectId(ca.id), principalId: aid },
      { churchId: new ObjectId(cb.id), principalId: bid },
    ].map((row) => ({
      _id: new ObjectId(),
      ...row,
      tokenHash: digest(crypto.randomUUID()),
      realm: "church",
      kind: "full",
      authEpoch: 1,
      credentialVersion: 1,
      csrfTokenHash: digest(crypto.randomUUID()),
      csrfKeyVersion: 1,
      createdAt: now,
      lastActivityAt: now,
      absoluteExpiresAt: new Date(now.getTime() + 3600000),
      writeFence: 0,
    }));
    await db.db.collection("sessions").insertMany(sessions);
    const accountRows = [
      { churchId: new ObjectId(ca.id), _id: aid },
      { churchId: new ObjectId(cb.id), _id: bid },
    ].map((row) => ({
      ...row,
      email: "same@example.test",
      emailKey: "same@example.test",
      displayName: "Synthetic account",
      displayNameKey: "synthetic account",
      role: "secretary",
      scope: { kind: "church" },
      status: "active",
      authEpoch: 1,
      version: 1,
      writeFence: 0,
      createdAt: now,
      updatedAt: now,
    }));
    await db.db.collection("accounts").insertMany(accountRows);
    const statusKey = crypto.randomUUID();
    await db.db.command({ collMod: "audit_events", validator: { $expr: { $eq: [1, 0] } } });
    try {
      expect(
        (
          await a.patch(
            ca.id,
            { status: "suspended", reason: "Synthetic maintenance" },
            1,
            statusKey,
            true,
          )
        ).res.status,
      ).toBe(503);
      expect(
        (await db.db.collection("churches").findOne({ _id: new ObjectId(ca.id) }))?.status,
      ).toBe("active");
      expect((await db.sessions.findOne({ _id: sessions[0]?._id }))?.revokedAt).toBeUndefined();
      expect(
        await db.db
          .collection("idempotency_operations")
          .countDocuments({ keyHash: digest(statusKey) }),
      ).toBe(0);
    } finally {
      await initialize(db.db);
    }

    const suspended = await a.patch(
      ca.id,
      { status: "suspended", reason: "Synthetic maintenance" },
      1,
      statusKey,
      true,
    );
    expect(suspended.res.status).toBe(200);
    expect((await db.sessions.findOne({ _id: sessions[0]?._id }))?.revokedAt instanceof Date).toBe(
      true,
    );
    expect((await db.sessions.findOne({ _id: sessions[1]?._id }))?.revokedAt).toBeUndefined();
    expect((await a.call(`owner/churches/${ca.id}`)).json.data.status).toBe("suspended");
    expect(
      (await a.patch(ca.id, { status: "active", reason: "Restored" }, 2, crypto.randomUUID(), true))
        .res.status,
    ).toBe(200);
    expect((await db.sessions.findOne({ _id: sessions[0]?._id }))?.revokedAt instanceof Date).toBe(
      true,
    );
    expect((await a.call("owner/auth/me")).res.status).toBe(200);
    expect(
      await db.db
        .collection("accounts")
        .find({ _id: { $in: [aid, bid] } })
        .sort({ _id: 1 })
        .toArray(),
    ).toEqual(
      [...accountRows].sort((x, y) => x._id.toHexString().localeCompare(y._id.toHexString())),
    );
    expect(
      (await a.patch(ca.id, { status: "suspended", reason: "" }, 3, crypto.randomUUID(), true)).res
        .status,
    ).toBe(422);
  });
  test("counts scope before aggregation; active only, separate unknown Ban/Khu vực", async () => {
    const ca = (await a.create(data())).json.data.church,
      cb = (await a.create(data())).json.data.church;
    const now = new Date();
    for (const [churchId, status] of [
      [ca.id, "active"],
      [ca.id, "locked"],
      [cb.id, "active"],
      [cb.id, "active"],
    ] as const)
      await db.db.collection("accounts").insertOne({
        _id: new ObjectId(),
        churchId: new ObjectId(churchId),
        email: "same@example.test",
        emailKey: `${crypto.randomUUID()}@example.test`,
        displayName: "Synthetic",
        displayNameKey: "synthetic",
        role: "secretary",
        scope: { kind: "church" },
        status,
        authEpoch: 1,
        version: 1,
        writeFence: 0,
        createdAt: now,
        updatedAt: now,
      });
    expect((await a.call(`owner/churches/${ca.id}`)).json.data.counters.accounts.value).toBe(1);
    expect((await a.call(`owner/churches/${cb.id}`)).json.data.counters.accounts.value).toBe(2);
  });
  test("keyset ties stable, limit/filter/actor-bound cursor tamper and expiry; no implicit total", async () => {
    const prefix = `Page ${crypto.randomUUID()}`;
    for (let i = 0; i < 6; i++)
      expect(
        (await a.create({ ...data(), name: `${prefix} ${i < 3 ? "same" : i}` })).res.status,
      ).toBe(201);
    const params = `owner/churches?q=${encodeURIComponent(prefix)}&limit=2`,
      ids: string[] = [];
    let next: string | null = null;
    do {
      const r = await a.call(`${params}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`);
      expect(r.res.status).toBe(200);
      ids.push(...r.json.data.items.map((x: { id: string }) => x.id));
      next = r.json.data.nextCursor;
      expect("total" in r.json.data).toBe(false);
    } while (next);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    const first = await a.call(params),
      cursor = first.json.data.nextCursor;
    expect((await b.call(`${params}&cursor=${cursor}`)).json.error.code).toBe(
      "CURSOR_CONTEXT_MISMATCH",
    );
    expect((await a.call(`${params}&status=suspended&cursor=${cursor}`)).json.error.code).toBe(
      "CURSOR_CONTEXT_MISMATCH",
    );
    expect((await a.call(`${params}&cursor=${cursor}x`)).json.error.code).toBe("INVALID_CURSOR");
    clock = new Date(clock.getTime() + 15 * 60_000);
    const freshSession = await db.sessions.findOne({
      tokenHash: digest(a.jar.get(cookieName("owner")) as string),
    });
    await db.sessions.updateOne({ _id: freshSession?._id }, { $set: { lastActivityAt: clock } });
    expect((await a.call(`${params}&cursor=${cursor}`)).json.error.code).toBe("CURSOR_EXPIRED");
  });
  test("exact code/email search and status filter; all query limits and override inputs bounded", async () => {
    const body = data(),
      c = (await a.create(body)).json.data.church;
    for (const q of [c.code.toLowerCase(), body.contact.email.toUpperCase(), "Đà Nẵng"]) {
      const r = await a.call(`owner/churches?q=${encodeURIComponent(q)}`);
      expect(r.res.status).toBe(200);
      expect(r.json.data.items.some((x: { id: string }) => x.id === c.id)).toBe(true);
    }
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=-1",
      "limit=1.5",
      "limit=2&limit=3",
      "status=bad",
      "churchId=any",
      `q=${"a".repeat(101)}`,
    ])
      expect((await a.call(`owner/churches?${query}`)).res.status).toBe(400);
    expect((await a.call(`owner/churches/${c.id}?churchId=${new ObjectId()}`)).res.status).toBe(
      400,
    );
  });
  test("deny bootstrap/limited/church realm, CSRF/Origin, invalid IDs, no DELETE/membership endpoints", async () => {
    const c = (await a.create(data())).json.data.church;
    expect((await new Client().call("owner/churches")).res.status).toBe(401);
    expect((await limited.call("owner/churches")).res.status).toBe(403);
    const wrong = new Client();
    wrong.jar.set(cookieName("church"), a.jar.get(cookieName("owner")) as string);
    expect((await wrong.call("owner/churches")).res.status).toBe(401);
    expect((await a.create(data(), "not-a-uuid")).res.status).toBe(400);
    expect(
      (
        await a.call("owner/churches", data(), {
          "idempotency-key": crypto.randomUUID(),
          origin: "https://evil.example",
        })
      ).res.status,
    ).toBe(403);
    expect(
      (
        await a.call("owner/churches", data(), {
          "idempotency-key": crypto.randomUUID(),
          "x-csrf-token": "",
        })
      ).res.status,
    ).toBe(403);
    expect((await a.call("owner/churches/bad")).res.status).toBe(400);
    expect((await a.call(`owner/churches/${new ObjectId()}`)).res.status).toBe(404);
    expect((await a.call(`owner/churches/${c.id}`, {}, {}, "DELETE")).res.status).toBe(405);
  });
  test("expired ledger still present rejects replay; F22 readable until48h cleanup boundary", async () => {
    const body = data(),
      key: string = crypto.randomUUID(),
      created = await a.create(body, key),
      opid = new ObjectId(created.json.data.operationId);
    const old = new Date(clock.getTime() - 25 * 3600000);
    await db.db
      .collection("idempotency_operations")
      .updateOne({ _id: opid }, { $set: { createdAt: old } });
    expect((await a.create(body, key)).json.error.code).toBe("IDEMPOTENCY_EXPIRED");
    expect((await a.call(`owner/operations/${opid}`)).res.status).toBe(200);
    await db.db
      .collection("idempotency_operations")
      .updateOne({ _id: opid }, { $set: { expiresAt: new Date(clock.getTime() - 1) } });
    expect((await a.call(`owner/operations/${opid}`)).res.status).toBe(404);
  });
  test("same key concurrent requests never duplicate; optimistic updates one version winner", async () => {
    const body = data(),
      key: string = crypto.randomUUID(),
      results = await Promise.all([a.create(body, key), a.create(body, key)]);
    expect(results.filter((r) => r.res.status === 201)).toHaveLength(1);
    for (const r of results) expect([200, 201, 409].includes(r.res.status)).toBe(true);
    expect(await db.db.collection("churches").countDocuments({ name: body.name })).toBe(1);
    const c = results.find((r) => r.res.status === 201)?.json.data.church;
    const updates = await Promise.all([
      a.patch(c.id, { address: "A" }, 1),
      b.patch(c.id, { address: "B" }, 1),
    ]);
    expect(updates.filter((r) => r.res.status === 200)).toHaveLength(1);
    expect(
      updates.some(
        (r) =>
          r.json.error?.code === "VERSION_CONFLICT" ||
          r.json.error?.code === "OPERATION_IN_PROGRESS",
      ),
    ).toBe(true);
  });
  test("real TX audit failure rolls back church and ledger, retry same key succeeds", async () => {
    const body = data(),
      key: string = crypto.randomUUID(),
      before = await db.db.collection("churches").countDocuments();
    // Real Mongo validator fault only in this owned test DB, restored before the next operation.
    await db.db.command({ collMod: "audit_events", validator: { $expr: { $eq: [1, 0] } } });
    try {
      expect((await a.create(body, key)).res.status).toBe(503);
      expect(await db.db.collection("churches").countDocuments()).toBe(before);
      expect(
        await db.db.collection("idempotency_operations").countDocuments({ keyHash: digest(key) }),
      ).toBe(0);
    } finally {
      await initialize(db.db);
    }
    expect((await a.create(body, key)).res.status).toBe(201);
  });
  test("lost commit acknowledgement returns OUTCOME_UNKNOWN; F22/replay resolve same real commit", async () => {
    const actual = db.client.startSession.bind(db.client);
    let committed = false;
    const intercepted = spyOn(db.client, "startSession").mockImplementation((...args) => {
      const session = actual(...args),
        commit = session.commitTransaction.bind(session);
      session.commitTransaction = async () => {
        await commit();
        committed = true;
        const error = new MongoError("synthetic lost commit acknowledgement");
        error.addErrorLabel("UnknownTransactionCommitResult");
        throw error;
      };
      return session;
    });
    const body = data(),
      key: string = crypto.randomUUID();
    let result: Awaited<ReturnType<Client["create"]>>;
    try {
      result = await a.create(body, key);
    } finally {
      intercepted.mockRestore();
    }
    expect(committed).toBe(true);
    expect(result.res.status).toBe(503);
    expect(result.json.error.code).toBe("OUTCOME_UNKNOWN");
    const id = result.json.meta.operationId;
    expect(typeof id).toBe("string");
    expect((await a.call(`owner/operations/${id}`)).res.status).toBe(200);
    expect((await a.create(body, key)).res.status).toBe(200);
    expect(await db.db.collection("churches").countDocuments({ name: body.name })).toBe(1);
  });
  test("query plans for unfiltered/status/geo keyset access; measurements are synthetic only", async () => {
    const rows = [];
    for (const [name, filter] of [
      ["all", {}],
      ["active", { status: "active" }],
      [
        "geography",
        {
          $or: [
            { nameKey: { $regex: "^đà" } },
            { province: { $regex: "^Đà", $options: "i" } },
            { district: { $regex: "^Đà", $options: "i" } },
          ],
        },
      ],
    ] as [string, Filter<Document>][]) {
      const plan = await db.db
        .collection("churches")
        .find(filter)
        .sort({ nameKey: 1, _id: 1 })
        .limit(26)
        .explain("executionStats");
      const names = new Set<string>();
      function walk(value: unknown) {
        if (value && typeof value === "object") {
          for (const [key, item] of Object.entries(value)) {
            if (key === "indexName" && typeof item === "string") names.add(item);
            else walk(item);
          }
        }
      }
      walk(plan.queryPlanner.winningPlan);
      rows.push({
        name,
        indexes: [...names],
        nReturned: plan.executionStats.nReturned,
        keysExamined: plan.executionStats.totalKeysExamined,
        documentsExamined: plan.executionStats.totalDocsExamined,
        millis: plan.executionStats.executionTimeMillis,
      });
      expect(plan.executionStats.nReturned <= 26).toBe(true);
      if (name === "all") expect(names.has("name")).toBe(true);
    }
    await Bun.write(
      "output/p1.4/p12-query-explain.json",
      JSON.stringify(
        {
          status: "PASS",
          datasetChurches: await db.db.collection("churches").countDocuments(),
          limits: [
            "Small synthetic dataset, not a production capacity benchmark",
            "Geography/prefix OR may scan/filter; no new index claimed",
          ],
          queries: rows,
        },
        null,
        2,
      ),
    );
  });
  test("stale authorized owner cannot mutate after lock; no partial tenant/ledger", async () => {
    const ctx = await identity.authorize(a.jar.get(cookieName("owner"))),
      grant = identity.ownerGrant(ctx, "churches:manage");
    const operations = new Operations(db, () => clock),
      tenancy = new Tenancy(
        db,
        operations,
        identity.audit,
        (ids) => identity.activeAccountCounts(ids),
        conf.csrfKey,
        (id, tx) => identity.suspendChurchSessions(id, tx),
        () => clock,
      ),
      body = data(),
      key: string = crypto.randomUUID();
    await db.owners.updateOne(
      { _id: new ObjectId(ownerId) },
      { $inc: { authEpoch: 1 }, $set: { status: "locked" } },
    );
    try {
      await expect(tenancy.create(grant, body, key, crypto.randomUUID())).rejects.toMatchObject({
        code: "SESSION_REVOKED",
      });
      expect(await db.db.collection("churches").countDocuments({ name: body.name })).toBe(0);
    } finally {
      await db.owners.updateOne(
        { _id: new ObjectId(ownerId) },
        { $set: { status: "active", authEpoch: ctx.owner.authEpoch } },
      );
    }
  });
});
