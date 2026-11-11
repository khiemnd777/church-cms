import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { config } from "../../api/config";
import { digest, sign } from "../../api/identity/crypto";
import { OwnerOperations } from "../../api/identity/owner-operations";
import { cookieName, Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import type { OrganizationGrant } from "../../api/organization/grant";
import { Organization } from "../../api/organization/service";

const conf = {
  ...config(),
  origin: "https://localhost:3454",
  database: `church_cms_test_org_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw new Error("Only local synthetic MongoDB");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let app: ReturnType<typeof createApp>, owner: Client, other: Client;
const logs: object[] = [];
class Client {
  jar = new Map<string, string>();
  csrf = "";
  ip = crypto.randomUUID();
  constructor(public realm: "owner" | "church" = "owner") {}
  async call(
    path: string,
    body?: object,
    method = body ? "POST" : "GET",
    headers: Record<string, string> = {},
  ) {
    const response = await app(
      new Request(`${conf.origin}/api/v1/${path}`, {
        method,
        headers: {
          cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join(";"),
          ...(body
            ? { "content-type": "application/json", origin: conf.origin, "x-csrf-token": this.csrf }
            : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { ip: this.ip },
    );
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0] as string,
        i = pair.indexOf("=");
      if (pair.slice(i + 1)) this.jar.set(pair.slice(0, i), pair.slice(i + 1));
      else this.jar.delete(pair.slice(0, i));
    }
    const json = response.status === 204 ? null : await response.json();
    if (json?.data?.csrfToken) this.csrf = json.data.csrfToken;
    return { status: response.status, json, headers: response.headers };
  }
  async login(email: string, password: string, code?: string) {
    await this.call(`auth/csrf?realm=${this.realm}`);
    return this.call(`${this.realm === "owner" ? "owner/" : ""}auth/login`, {
      email,
      password,
      ...(code ? { churchCode: code } : {}),
    });
  }
  write(
    path: string,
    body: object,
    version?: number,
    key: string = crypto.randomUUID(),
    extra: Record<string, string> = {},
  ) {
    return this.call(path, body, version === undefined ? "POST" : "PATCH", {
      "idempotency-key": key,
      ...(version ? { "if-match": `"${version}"` } : {}),
      ...extra,
    });
  }
}
const defaults = { unitType: "area", defaultAssignmentMode: "auto" };
const path = (id: string, realm: "owner" | "church" = "owner") =>
  `${realm === "owner" ? "owner/" : ""}churches/${id}/organization`;
async function newOwner() {
  const fixture = await new OwnerOperations(db).create({
      email: `${crypto.randomUUID()}@example.test`,
      displayName: "Owner synthetic",
    }),
    c = new Client(),
    pw = `Owner 🌿 ${crypto.randomUUID()}`;
  expect((await c.login(fixture.email, fixture.temporaryPassword)).status).toBe(200);
  expect(
    (await c.call("owner/auth/change-initial-password", { newPassword: pw, confirmation: pw }))
      .status,
  ).toBe(204);
  expect((await c.login(fixture.email, pw)).status).toBe(200);
  return c;
}
async function church(configure = true) {
  const r = await owner.write("owner/churches", {
    name: `Hội Thánh synthetic ${crypto.randomUUID()}`,
    province: "Đà Nẵng",
  });
  expect(r.status).toBe(201);
  const c = r.json.data.church as { id: string; code: string };
  if (configure) expect((await owner.write(`${path(c.id)}/settings`, defaults)).status).toBe(201);
  return c;
}
async function user(c: { id: string; code: string }, role = "pastor", permanent = true) {
  const email = `${crypto.randomUUID()}@example.test`,
    made = await owner.write(`owner/churches/${c.id}/accounts`, {
      email,
      displayName: "Người synthetic",
      role,
      scope: { kind: role === "member" ? "self" : "church" },
    });
  expect(made.status).toBe(201);
  const client = new Client("church"),
    pw = `Người 🕊 ${crypto.randomUUID()}`;
  expect(
    (await client.login(email, made.json.data.temporaryCredential.password, c.code)).status,
  ).toBe(200);
  if (permanent) {
    expect(
      (await client.call("auth/change-initial-password", { newPassword: pw, confirmation: pw }))
        .status,
    ).toBe(204);
    expect((await client.login(email, pw, c.code)).status).toBe(200);
  }
  return { client, id: made.json.data.account.id as string };
}
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  owner = await newOwner();
  other = await newOwner();
});
afterAll(async () => {
  if (db.db.databaseName === conf.database) await db.db.dropDatabase();
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
describe("P2.1 real Organization contracts and transaction fences", () => {
  test("AC01 GET without settings has no writes; setup creates only six fixed units", async () => {
    const c = await church(false),
      b = path(c.id),
      before = await db.audits.countDocuments();
    const r = await owner.call(`${b}/settings`);
    expect(r.status).toBe(200);
    expect(r.json.data.configured).toBe(false);
    expect(r.json.data.settings).toBeNull();
    expect(r.headers.get("etag")).toBeNull();
    expect(
      await db.db.collection("church_settings").countDocuments({ _id: new ObjectId(c.id) }),
    ).toBe(0);
    expect(
      await db.db.collection("organization_units").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
    expect(await db.audits.countDocuments()).toBe(before);
    const key = crypto.randomUUID(),
      one = await owner.write(`${b}/settings`, defaults, undefined, key),
      replay = await owner.write(`${b}/settings`, defaults, undefined, key);
    expect(one.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.json.data).toEqual(one.json.data);
    expect(replay.json.meta.replayed).toBe(true);
    expect(one.headers.get("etag")).toBe('"1"');
    expect(
      await db.db.collection("organization_units").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(6);
    expect(
      (await owner.call(`${b}/units`)).json.data.items.every((u: { system: boolean }) => u.system),
    ).toBe(true);
    expect((await owner.write(`${b}/settings`, defaults)).json.error.code).toBe(
      "SETTINGS_ALREADY_CONFIGURED",
    );
  });
  test("AC02 independent setup intents race with one winner and no partial/duplicate system units", async () => {
    const c = await church(false),
      b = path(c.id),
      results = await Promise.all([
        owner.write(`${b}/settings`, defaults),
        other.write(`${b}/settings`, defaults),
      ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    expect(
      await db.db.collection("organization_units").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(6);
    expect(
      await db.audits.countDocuments({
        eventType: "organization.initialized",
        targetChurchId: new ObjectId(c.id),
      }),
    ).toBe(1);
  });
  test("AC03 actor matrix, limited sessions, CSRF, realm separation and capability advertising", async () => {
    const c = await church();
    for (const role of ["pastor", "secretary", "treasurer", "member"]) {
      const { client } = await user(c, role),
        b = path(c.id, "church");
      const context = await client.call(`churches/${c.id}/context`);
      expect(context.json.data.capabilities.includes("organization:read")).toBe(
        ["pastor", "secretary"].includes(role),
      );
      expect(context.json.data.capabilities.includes("organization:manage")).toBe(
        role === "pastor",
      );
      expect((await client.call(`${b}/settings`)).status).toBe(
        ["pastor", "secretary"].includes(role) ? 200 : 403,
      );
      expect((await client.write(`${b}/units`, { kind: "area", name: `Khu ${role}` })).status).toBe(
        role === "pastor" ? 201 : 403,
      );
      client.jar.set(cookieName("owner"), owner.jar.get(cookieName("owner")) as string);
      if (role !== "pastor")
        expect(
          (
            await client.write(`${b}/units`, {
              kind: "area",
              name: "Ambient owner must not elevate",
            })
          ).status,
        ).toBe(403);
    }
    const limited = await user(c, "pastor", false);
    expect((await limited.client.call(`${path(c.id, "church")}/settings`)).status).toBe(403);
    expect(
      (
        await owner.write(
          `${path(c.id)}/units`,
          { kind: "area", name: "CSRF" },
          undefined,
          crypto.randomUUID(),
          { "x-csrf-token": "" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await owner.write(
          `${path(c.id)}/units`,
          { kind: "area", name: "Origin" },
          undefined,
          crypto.randomUUID(),
          { origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
  });
  test("AC04 scope IDs, operation IDs, owner/user cookies, two churches and cursor context", async () => {
    const a = await church(),
      c = await church(),
      { client } = await user(a),
      key = crypto.randomUUID();
    const u = await owner.write(
      `${path(a.id)}/units`,
      { kind: "area", name: "Khu A" },
      undefined,
      key,
    );
    expect(u.status).toBe(201);
    expect((await client.call(`${path(c.id, "church")}/settings`)).status).toBe(403);
    expect((await owner.call(`${path(c.id)}/units/${u.json.data.unit.id}`)).status).toBe(404);
    expect((await owner.call(`${path(c.id)}/operations/${u.json.data.operationId}`)).status).toBe(
      404,
    );
    expect((await other.call(`${path(a.id)}/operations/${u.json.data.operationId}`)).status).toBe(
      404,
    );
    expect((await owner.call(`${path(a.id)}/settings`)).json.data.settings.churchId).toBe(a.id);
    expect((await owner.call(`${path(c.id)}/settings`)).json.data.settings.churchId).toBe(c.id);
    const page = await owner.call(`${path(a.id)}/units?limit=2`),
      cursor = encodeURIComponent(page.json.data.nextCursor);
    expect(page.json.data.items).toHaveLength(2);
    for (const url of [
      `${path(c.id)}/units?limit=2&cursor=${cursor}`,
      `${path(a.id)}/units?status=all&limit=2&cursor=${cursor}`,
    ])
      expect((await owner.call(url)).json.error.code).toBe("CURSOR_CONTEXT_MISMATCH");
    expect((await other.call(`${path(a.id)}/units?limit=2&cursor=${cursor}`)).json.error.code).toBe(
      "CURSOR_CONTEXT_MISMATCH",
    );
    expect((await owner.call(`${path(a.id)}/units?cursor=${cursor}x`)).json.error.code).toBe(
      "INVALID_CURSOR",
    );
  });
  test("AC05 normalized namespace uniqueness, immutable system units and retained inactive names", async () => {
    const c = await church(),
      b = path(c.id),
      key = crypto.randomUUID(),
      name = "Ban âm nhạc";
    const one = await owner.write(
      `${b}/units`,
      { kind: "service_ministry", name: `  ${name.normalize("NFD")}  ` },
      undefined,
      key,
    );
    expect(one.status).toBe(201);
    const u = one.json.data.unit;
    expect(u.name).toBe(name);
    expect(u.memberCount.value).toBeNull();
    expect(u.nameKey).toBeUndefined();
    expect(
      (await owner.write(`${b}/units`, { kind: "service_ministry", name: name.toUpperCase() })).json
        .error.code,
    ).toBe("UNIT_NAME_EXISTS");
    const inactive = await owner.write(
      `${b}/units/${u.id}/status`,
      { status: "inactive", reason: "Ngừng thử nghiệm" },
      1,
    );
    expect(inactive.status).toBe(200);
    expect(inactive.json.data.unit.id).toBe(u.id);
    expect(
      (await db.audits.findOne({ operationId: new ObjectId(inactive.json.data.operationId) }))
        ?.safeSummary,
    ).toContain("Ngừng thử nghiệm");
    expect((await owner.write(`${b}/units`, { kind: "service_ministry", name })).status).toBe(409);
    expect((await owner.write(`${b}/units/${u.id}`, { name: "Tên mới" }, 2)).status).toBe(200);
    expect(
      (await owner.write(`${b}/units/${u.id}/status`, { status: "active", reason: "Mở lại" }, 3))
        .status,
    ).toBe(200);
    const system = (await owner.call(`${b}/units?kind=age_ministry`)).json.data.items[0];
    expect(
      (await owner.write(`${b}/units/${system.id}`, { name: "Không cho sửa" }, 1)).json.error.code,
    ).toBe("SYSTEM_UNIT_IMMUTABLE");
    expect(
      (
        await owner.write(
          `${b}/units/${system.id}/status`,
          { status: "inactive", reason: "Không cho ngừng" },
          1,
        )
      ).status,
    ).toBe(409);
    expect(
      (await owner.write(`${b}/units`, { kind: "service_ministry", name: system.name })).json.error
        .code,
    ).toBe("UNIT_NAME_EXISTS");
    expect((await owner.write(`${b}/units`, { kind: "area", name: system.name })).status).toBe(201);
  });
  test("AC06 CAS and missing precondition; custom label clearing; reject invalid configs", async () => {
    const c = await church(),
      b = path(c.id);
    const changes = await Promise.all([
      owner.write(`${b}/settings`, { unitType: "custom", customUnitLabel: "Giáo khu" }, 1),
      other.write(`${b}/settings`, { defaultAssignmentMode: "manual" }, 1),
    ]);
    expect(changes.filter((r) => r.status === 200)).toHaveLength(1);
    expect(changes.find((r) => r.status !== 200)?.json.error.code).toBe("VERSION_CONFLICT");
    expect(
      (
        await owner.call(`${b}/settings`, { unitType: "area" }, "PATCH", {
          "idempotency-key": crypto.randomUUID(),
        })
      ).status,
    ).toBe(428);
    let current = (await owner.call(`${b}/settings`)).json.data.settings;
    expect(
      (
        await owner.write(
          `${b}/settings`,
          { unitType: "custom", customUnitLabel: "Nhóm" },
          current.version,
        )
      ).status,
    ).toBe(200);
    current = (await owner.call(`${b}/settings`)).json.data.settings;
    const clear = await owner.write(`${b}/settings`, { unitType: "area" }, current.version);
    expect(clear.status).toBe(200);
    expect(clear.json.data.settings.customUnitLabel).toBeUndefined();
    for (const body of [
      {},
      { churchId: c.id },
      { unitType: "custom" },
      { unitType: "custom", customUnitLabel: null },
      { defaultAssignmentMode: "wrong" },
      { unitType: "area", customUnitLabel: "Không dùng" },
    ])
      expect(
        (await owner.write(`${b}/settings`, body, clear.json.data.settings.version)).status,
      ).toBe(422);
  });
  test("AC05/06 concurrent duplicate unit name and unit edits keep one winner", async () => {
    const c = await church(),
      b = path(c.id),
      body = { kind: "area", name: "Khu cạnh tranh" },
      results = await Promise.all([
        owner.write(`${b}/units`, body),
        other.write(`${b}/units`, body),
      ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.find((r) => r.status !== 201)?.json.error.code).toBe("UNIT_NAME_EXISTS");
    const id = results.find((r) => r.status === 201)?.json.data.unit.id;
    const edits = await Promise.all([
      owner.write(`${b}/units/${id}`, { name: "Tên 1" }, 1),
      other.write(`${b}/units/${id}`, { name: "Tên 2" }, 1),
    ]);
    expect(edits.filter((r) => r.status === 200)).toHaveLength(1);
    expect(edits.find((r) => r.status !== 200)?.status).toBe(412);
  });
  test("AC07 revoked capability cannot replay/read previous successful user operation", async () => {
    const c = await church(),
      { client, id } = await user(c),
      b = path(c.id, "church"),
      body = { kind: "area", name: "Phạm vi user" },
      key = crypto.randomUUID();
    const made = await client.write(`${b}/units`, body, undefined, key);
    expect(made.status).toBe(201);
    expect(
      (
        await owner.write(
          `owner/churches/${c.id}/accounts/${id}/permissions`,
          { role: "secretary", scope: { kind: "church" } },
          (
            await owner.call(`owner/churches/${c.id}/accounts/${id}`)
          ).json.data.version,
        )
      ).status,
    ).toBe(200);
    expect((await client.write(`${b}/units`, body, undefined, key)).status).toBe(403);
    expect((await client.call(`${b}/operations/${made.json.data.operationId}`)).status).toBe(403);
  });
  test("AC07 real snapshot barrier: permission change and church suspend prevent in-flight commit", async () => {
    for (const action of ["permissions", "suspend"]) {
      const c = await church(),
        { client, id } = await user(c),
        b = path(c.id, "church");
      let reached = () => {},
        resume = () => {},
        attempts = 0;
      const entered = new Promise<void>((r) => {
          reached = r;
        }),
        released = new Promise<void>((r) => {
          resume = r;
        });
      const original = Organization.prototype.writeUnit;
      const spy = spyOn(Organization.prototype, "writeUnit").mockImplementation(async function (
        this: Organization,
        g: OrganizationGrant,
        ...args: Parameters<Organization["writeUnit"]> extends [OrganizationGrant, ...infer R]
          ? R
          : never
      ) {
        const fence = g.fence;
        const fenced = {
          ...g,
          fence: async (tx: Parameters<OrganizationGrant["fence"]>[0]) => {
            await db.db.collection("accounts").findOne({ _id: new ObjectId(id) }, { session: tx });
            attempts++;
            if (attempts === 1) {
              reached();
              await released;
            }
            await fence(tx);
          },
        };
        return original.call(this, fenced, ...args);
      });
      const inFlight = client.write(`${b}/units`, { kind: "area", name: `Barrier ${action}` });
      await entered;
      spy.mockRestore();
      try {
        const changed =
          action === "permissions"
            ? await owner.write(
                `owner/churches/${c.id}/accounts/${id}/permissions`,
                { role: "member", scope: { kind: "self" } },
                (await owner.call(`owner/churches/${c.id}/accounts/${id}`)).json.data.version,
              )
            : await owner.write(
                `owner/churches/${c.id}/status`,
                { status: "suspended", reason: "Barrier" },
                1,
              );
        expect(changed.status).toBe(200);
      } finally {
        resume();
      }
      const result = await inFlight;
      expect([401, 403]).toContain(result.status);
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(
        await db.db
          .collection("organization_units")
          .countDocuments({ churchId: new ObjectId(c.id), name: `Barrier ${action}` }),
      ).toBe(0);
    }
  });
  test("AC08 real audit validator failure rolls back settings, six units and v2 ledger", async () => {
    const c = await church(false),
      b = path(c.id),
      key = crypto.randomUUID();
    await db.db.command({ collMod: "audit_events", validator: { $expr: { $eq: [1, 0] } } });
    try {
      expect((await owner.write(`${b}/settings`, defaults, undefined, key)).status).toBe(503);
      expect(
        await db.db.collection("church_settings").countDocuments({ _id: new ObjectId(c.id) }),
      ).toBe(0);
      expect(
        await db.db
          .collection("organization_units")
          .countDocuments({ churchId: new ObjectId(c.id) }),
      ).toBe(0);
      expect(
        await db.db.collection("idempotency_operations").countDocuments({ keyHash: digest(key) }),
      ).toBe(0);
    } finally {
      await initialize(db.db);
    }
    expect((await owner.write(`${b}/settings`, defaults, undefined, key)).status).toBe(201);
  });
  test("AC08 unknown real commit resolved by original actor status and exact replay", async () => {
    const c = await church(),
      b = path(c.id),
      actual = db.client.startSession.bind(db.client),
      key = crypto.randomUUID(),
      body = { kind: "area", name: "Lost acknowledgement" };
    const spy = spyOn(db.client, "startSession").mockImplementation((...args) => {
      const session = actual(...args),
        commit = session.commitTransaction.bind(session);
      session.commitTransaction = async () => {
        await commit();
        const e = new MongoError("synthetic lost acknowledgement");
        e.addErrorLabel("UnknownTransactionCommitResult");
        throw e;
      };
      return session;
    });
    let r: Awaited<ReturnType<Client["write"]>>;
    try {
      r = await owner.write(`${b}/units`, body, undefined, key);
    } finally {
      spy.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("OUTCOME_UNKNOWN");
    expect((await owner.call(`${b}/operations/${r.json.meta.operationId}`)).status).toBe(200);
    const replay = await owner.write(`${b}/units`, body, undefined, key);
    expect(replay.status).toBe(200);
    expect(replay.json.meta.replayed).toBe(true);
    expect(
      await db.db
        .collection("organization_units")
        .countDocuments({ churchId: new ObjectId(c.id), name: body.name }),
    ).toBe(1);
  });
  test("AC09 v2 actor audit, scoped safe operation DTO and v1 F22 unaffected", async () => {
    const c = await church(),
      { client, id } = await user(c),
      b = path(c.id, "church"),
      r = await client.write(`${b}/units`, { kind: "area", name: "User-authored" });
    expect(r.status).toBe(201);
    const event = await db.audits.findOne({ operationId: new ObjectId(r.json.data.operationId) });
    expect(event?.actorKind).toBe("church_user");
    expect(event?.actorId?.toHexString()).toBe(id);
    expect(event?.actorChurchId?.toHexString()).toBe(c.id);
    expect(event?.targetChurchId?.toHexString()).toBe(c.id);
    const status = await client.call(`${b}/operations/${r.json.data.operationId}`);
    expect(status.status).toBe(200);
    for (const field of ["keyHash", "payloadHash", "actorId", "ownerId"])
      expect(status.json.data[field]).toBeUndefined();
    expect((await owner.call(`owner/operations/${r.json.data.operationId}`)).status).toBe(404);
    const old = await owner.write("owner/churches", { name: "Legacy ledger", province: "Đà Nẵng" });
    expect((await owner.call(`owner/operations/${old.json.data.operationId}`)).status).toBe(200);
  });
  test("AC09 explicit legacy index upgrade preserves v1 rows and supports distinct v2 actors", async () => {
    const coll = db.db.collection("idempotency_operations"),
      old = await owner.write("owner/churches", { name: "Before upgrade", province: "Đà Nẵng" });
    await coll.dropIndex("operation_unique");
    await coll.createIndex(
      { ownerId: 1, method: 1, routeKey: 1, keyHash: 1 },
      { name: "operation_unique", unique: true },
    );
    await expect(initialize(db.db)).rejects.toThrow("Stop local HTTP writers");
    await initialize(db.db, { upgradeOperationsV2: true });
    await db.ready();
    expect((await owner.call(`owner/operations/${old.json.data.operationId}`)).status).toBe(200);
    const c = await church(),
      key = crypto.randomUUID(),
      body = { unitType: "branch" },
      a = await owner.write(`${path(c.id)}/settings`, body, 1, key),
      b = await other.write(`${path(c.id)}/settings`, body, 2, key);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(
      await coll.countDocuments({
        schemaVersion: 2,
        churchId: new ObjectId(c.id),
        keyHash: digest(key),
      }),
    ).toBe(2);
  });
  test("pagination tie breaker/filter bounds, tamper checks, strict input and no DELETE", async () => {
    const c = await church(),
      b = path(c.id),
      pages: string[] = [];
    let cursor: string | null = null;
    do {
      const r = await owner.call(
        `${b}/units?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(r.status).toBe(200);
      pages.push(...r.json.data.items.map((u: { id: string }) => u.id));
      cursor = r.json.data.nextCursor;
    } while (cursor);
    expect(pages).toHaveLength(6);
    expect(new Set(pages).size).toBe(6);
    for (const q of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "limit=2&limit=3",
      "status=bad",
      "kind=bad",
      "churchId=other",
      `q=${"a".repeat(101)}`,
    ])
      expect((await owner.call(`${b}/units?${q}`)).status).toBe(400);
    for (const body of [
      { kind: "board", name: "Fake board" },
      { kind: "area", name: " " },
      { kind: "area", name: "x", churchId: c.id },
    ])
      expect((await owner.write(`${b}/units`, body)).status).toBe(422);
    expect((await owner.call(`${b}/settings`, {}, "DELETE")).status).toBe(405);
    const dump = JSON.stringify(logs);
    expect(dump.includes("x-csrf-token")).toBe(false);
    expect(dump.includes("User-authored")).toBe(false);
  });
  test("indexed tenant pages, literal-prefix search, expired/policy-bound cursors and mixed-ledger schema rejected", async () => {
    const c = await church(),
      b = path(c.id),
      { client, id } = await user(c);
    const seed = await owner.write(`${b}/units`, { kind: "area", name: "Khu.*" });
    const original = await db.db
      .collection("organization_units")
      .findOne({ _id: new ObjectId(seed.json.data.unit.id) });
    expect(original).not.toBeNull();
    await db.db.collection("organization_units").insertMany(
      Array.from({ length: 300 }, (_, i) => ({
        ...original,
        _id: new ObjectId(),
        name: `Khu ${String(i).padStart(4, "0")}`,
        nameKey: `khu ${String(i).padStart(4, "0")}`,
      })),
    );
    const literal = await owner.call(`${b}/units?kind=area&q=${encodeURIComponent("Khu.*")}`);
    expect(literal.json.data.items.map((u: { name: string }) => u.name)).toEqual(["Khu.*"]);
    const plan = await db.db
      .collection("organization_units")
      .find({
        churchId: new ObjectId(c.id),
        kind: "area",
        status: "active",
        nameKey: { $regex: "^khu" },
      })
      .sort({ nameKey: 1, _id: 1 })
      .limit(26)
      .explain("executionStats");
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).not.toContain("COLLSCAN");
    await Bun.write(
      "output/p2.1/query-explain.json",
      JSON.stringify({ source: "300 synthetic units; no production SLA", plan }, null, 2),
    );
    const first = await client.call(`${path(c.id, "church")}/units?limit=2`),
      token = first.json.data.nextCursor as string;
    const raw = JSON.parse(Buffer.from(token.split(".")[0] as string, "base64url").toString());
    const payload = Buffer.from(JSON.stringify({ ...raw, expiresAt: 0 })).toString("base64url");
    expect(
      (
        await client.call(
          `${path(c.id, "church")}/units?limit=2&cursor=${encodeURIComponent(`${payload}.${sign(conf.csrfKey, `organization:${payload}`)}`)}`,
        )
      ).json.error.code,
    ).toBe("CURSOR_EXPIRED");
    const current = await owner.call(`owner/churches/${c.id}/accounts/${id}`);
    expect(
      (
        await owner.write(
          `owner/churches/${c.id}/accounts/${id}/permissions`,
          { role: "secretary", scope: { kind: "church" } },
          current.json.data.version,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await client.call(
          `${path(c.id, "church")}/units?limit=2&cursor=${encodeURIComponent(token)}`,
        )
      ).json.error.code,
    ).toBe("CURSOR_CONTEXT_MISMATCH");
    const operation = await db.db
      .collection("idempotency_operations")
      .findOne({ _id: new ObjectId(seed.json.data.operationId) });
    await expect(
      db.db
        .collection("idempotency_operations")
        .insertOne({ ...operation, _id: new ObjectId(), ownerId: new ObjectId() }),
    ).rejects.toThrow();
  });
  test("suspended church denies owner business read/write/replay; v2 retry window enforced despite TTL lag", async () => {
    const c = await church(),
      b = path(c.id),
      key = crypto.randomUUID(),
      body = { kind: "area", name: "TTL" },
      r = await owner.write(`${b}/units`, body, undefined, key);
    await db.db
      .collection("idempotency_operations")
      .updateOne(
        { _id: new ObjectId(r.json.data.operationId) },
        { $set: { createdAt: new Date(Date.now() - 25 * 3600000) } },
      );
    expect((await owner.write(`${b}/units`, body, undefined, key)).json.error.code).toBe(
      "IDEMPOTENCY_EXPIRED",
    );
    expect(
      (
        await owner.write(
          `owner/churches/${c.id}/status`,
          { status: "suspended", reason: "Testing" },
          1,
        )
      ).status,
    ).toBe(200);
    expect((await owner.call(`${b}/settings`)).json.error.code).toBe("CHURCH_SUSPENDED");
    expect((await owner.call(`${b}/operations/${r.json.data.operationId}`)).status).toBe(403);
    expect((await owner.write(`${b}/units`, body, undefined, key)).status).toBe(403);
  });
});
