import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { config } from "../../api/config";
import { AppError } from "../../api/errors";
import { Finance } from "../../api/finance/service";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import {
  localOnly,
  SyntheticClient,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";
import { financeChurch, financeRoot, financeSetup } from "../../scripts/p51-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3491",
  database: `church_cms_test_p51_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
localOnly(conf);
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  logs: object[] = [];
let identity: Identity,
  app: ReturnType<typeof createApp>,
  owner: SyntheticClient,
  c: Awaited<ReturnType<typeof financeChurch>>;
let pastor: SyntheticClient,
  pastor2: SyntheticClient,
  treasurer: SyntheticClient,
  secretary: SyntheticClient,
  lead: SyntheticClient,
  member: SyntheticClient;
const client = (realm: "church" | "owner" = "church") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
const root = () => financeRoot(c);
async function create(name = `Quỹ ${crypto.randomUUID()}`, s = pastor) {
  const r = await s.call(`${root()}/funds`, { name });
  expect(r.status).toBe(201);
  return r.payload.data as { fundId: string; version: number; operationId: string };
}
const patch = (path: string, body: object, version: number, s = pastor, key?: string) =>
  s.call(path, body, { method: "PATCH", version, key });
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  identity = new Identity(db, rate, conf);
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  owner = client("owner");
  await syntheticOwner(db, owner);
  c = await financeChurch(owner);
  [pastor, pastor2, treasurer, secretary, lead, member] = [
    client(),
    client(),
    client(),
    client(),
    client(),
    client(),
  ];
  for (const [s, role] of [
    [pastor, "pastor"],
    [pastor2, "pastor"],
    [treasurer, "treasurer"],
    [secretary, "secretary"],
    [lead, "ministry_lead"],
    [member, "member"],
  ] as const)
    await syntheticUser(owner, s, c, role, [c.unitId]);
});
afterAll(async () => {
  await db.db.dropDatabase();
  expect(
    (await db.db.admin().listDatabases()).databases.some((d) => d.name === conf.database),
  ).toBe(false);
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
describe("P5.1 real Mongo/Redis financial configuration contracts", () => {
  test("fresh GET has no financial writes or hidden defaults; allowed roles and contexts", async () => {
    const counts = await Promise.all(
      ["finance_settings", "finance_funds", "finance_history", "idempotency_operations"].map((n) =>
        db.db.collection(n).countDocuments(),
      ),
    );
    for (const s of [pastor, treasurer]) {
      const r = await s.call(`${root()}/settings`);
      expect(r.status).toBe(200);
      expect(r.payload.data).toEqual({ configured: false, settings: null });
      expect((await s.call(`${root()}/funds`)).payload.data).toEqual({
        items: [],
        nextCursor: null,
      });
    }
    expect(
      await Promise.all(
        ["finance_settings", "finance_funds", "finance_history", "idempotency_operations"].map(
          (n) => db.db.collection(n).countDocuments(),
        ),
      ),
    ).toEqual(counts);
    const t = await treasurer.call(`churches/${c.id}/context`);
    expect(t.payload.data.capabilities).toContain("finance:funds:read");
    expect(t.payload.data.capabilities).not.toContain("organization:read");
    expect((await treasurer.call(`churches/${c.id}/organization/settings`)).status).toBe(403);
    for (const s of [secretary, lead, member])
      for (const path of ["settings", "funds", "settings/history"])
        expect((await s.call(`${root()}/${path}`)).status).toBe(403);
    for (const path of ["settings", "funds", "settings/history"])
      expect((await owner.call(`owner/${root()}/${path}`)).status).toBe(403);
    expect((await owner.call(`${root()}/settings`)).status).toBe(401);
  });
  test("initialization is explicit and atomic, exact replay metadata and allowlisted policy", async () => {
    const key = crypto.randomUUID(),
      r = await pastor.call(`${root()}/settings`, financeSetup, { key });
    expect(r.status).toBe(201);
    expect(r.payload.data).not.toHaveProperty("proposerRoles");
    expect(r.headers.get("etag")).toBe('"1"');
    const again = await pastor.call(`${root()}/settings`, financeSetup, { key });
    expect(again.status).toBe(200);
    expect(again.payload.data).toEqual(r.payload.data);
    expect(again.payload.meta.replayed).toBe(true);
    expect((await pastor.call(`${root()}/settings`, financeSetup)).status).toBe(409);
    expect(
      await db.db
        .collection("finance_history")
        .countDocuments({ churchId: new ObjectId(c.id), targetType: "settings" }),
    ).toBe(1);
    expect((await treasurer.call(`${root()}/settings`)).payload.data.settings.approverRole).toBe(
      "pastor",
    );
    const pm = await pastor.call(`churches/${c.id}/authorization/policy`),
      sm = await secretary.call(`churches/${c.id}/authorization/policy`),
      om = await owner.call(`owner/churches/${c.id}/authorization/policy`);
    expect(
      pm.payload.data.rows.find((r: { role: string }) => r.role === "pastor").expense,
    ).toContain("cấm tự quyết định");
    expect(
      sm.payload.data.rows.find((r: { role: string }) => r.role === "secretary").expense,
    ).toContain("Xem của mình");
    expect(
      sm.payload.data.rows.find((r: { role: string }) => r.role === "secretary").expense,
    ).toContain("Không duyệt");
    expect(
      om.payload.data.rows.every((r: { expense: string }) =>
        ["Theo cấu hình Hội Thánh", "Không"].includes(r.expense),
      ),
    ).toBe(true);
    for (const s of [treasurer, secretary, lead, member])
      expect((await s.call(`${root()}/settings`, financeSetup)).status).toBe(403);
    expect(
      (await pastor.call(`${root()}/settings`, { ...financeSetup, autoApprove: true })).status,
    ).toBe(422);
  });
  test("fund name normalization, duplicate reservation includes inactive; rename/restore keep id and history", async () => {
    const f = await create("  Quỹ  đặc biệt  ");
    const get = await pastor.call(`${root()}/funds/${f.fundId}`);
    expect(get.payload.data.name).toBe("Quỹ đặc biệt");
    expect((await pastor.call(`${root()}/funds`, { name: "QUỸ ĐẶC BIỆT" })).status).toBe(409);
    expect(
      (
        await patch(
          `${root()}/funds/${f.fundId}/status`,
          { status: "inactive", reason: "Ngừng synthetic" },
          1,
        )
      ).status,
    ).toBe(200);
    expect((await pastor.call(`${root()}/funds`, { name: "Quỹ đặc biệt" })).status).toBe(409);
    expect(
      (await patch(`${root()}/funds/${f.fundId}`, { name: "Quỹ đổi tên synthetic" }, 2)).status,
    ).toBe(200);
    expect(
      (
        await patch(
          `${root()}/funds/${f.fundId}/status`,
          { status: "active", reason: "Khôi phục synthetic" },
          3,
        )
      ).status,
    ).toBe(200);
    const history = await treasurer.call(`${root()}/funds/${f.fundId}/history`);
    expect(history.payload.data.items).toHaveLength(4);
    expect(history.payload.data.items.map((h: { event: string }) => h.event)).toEqual([
      "status_changed",
      "renamed",
      "status_changed",
      "created",
    ]);
    expect(history.payload.data.items[0].after.id).toBe(f.fundId);
    expect(
      (await pastor.call(`${root()}/funds/${f.fundId}`, undefined, { method: "DELETE" })).status,
    ).toBe(405);
    expect((await treasurer.call(`${root()}/funds`, { name: "Forbidden" })).status).toBe(403);
  });
  test("settings CAS, required precondition, malformed input and no overwrite", async () => {
    const current = (await pastor.call(`${root()}/settings`)).payload.data.settings;
    const path = `${root()}/settings`,
      body = { proposerRoles: [], approverRole: "secretary" };
    expect((await pastor.call(path, body, { method: "PATCH" })).status).toBe(428);
    expect(
      (await pastor.call(path, body, { method: "PATCH", headers: { "if-match": "1" } })).status,
    ).toBe(400);
    expect((await patch(path, body, current.version)).status).toBe(200);
    expect((await patch(path, financeSetup, current.version)).status).toBe(412);
    expect(
      (
        await patch(
          path,
          { proposerRoles: ["member"], approverRole: "pastor" },
          current.version + 1,
        )
      ).status,
    ).toBe(422);
    expect((await treasurer.call(path)).payload.data.settings.approverRole).toBe("secretary");
    const before = await db.db
      .collection("finance_history")
      .countDocuments({ churchId: new ObjectId(c.id) });
    const f = await create();
    expect(
      (await patch(`${root()}/funds/${f.fundId}/status`, { status: "inactive", reason: " " }, 1))
        .status,
    ).toBe(422);
    expect(
      await db.db.collection("finance_history").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(before + 1);
  });
  test("independent create intents, init intents, same-version edits have one winner", async () => {
    const name = `Race ${crypto.randomUUID()}`;
    const r = await Promise.all([
      pastor.call(`${root()}/funds`, { name }),
      pastor2.call(`${root()}/funds`, { name }),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
    const id = r.find((x) => x.status === 201)?.payload.data.fundId;
    const changed = await Promise.all([
      patch(`${root()}/funds/${id}`, { name: `Race A ${crypto.randomUUID()}` }, 1),
      patch(`${root()}/funds/${id}`, { name: `Race B ${crypto.randomUUID()}` }, 1, pastor2),
    ]);
    expect(changed.map((x) => x.status).sort()).toEqual([200, 412]);
    const cc = await financeChurch(owner),
      a = client(),
      b = client();
    await syntheticUser(owner, a, cc, "pastor");
    await syntheticUser(owner, b, cc, "pastor");
    const init = await Promise.all([
      a.call(`${financeRoot(cc)}/settings`, financeSetup),
      b.call(`${financeRoot(cc)}/settings`, financeSetup),
    ]);
    expect(init.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(
      await db.db.collection("finance_history").countDocuments({ churchId: new ObjectId(cc.id) }),
    ).toBe(1);
  }, 15000);
  test("exact-key replay, changed payload conflict, actor-scoped receipts and finite retry window", async () => {
    const key = crypto.randomUUID(),
      path = `${root()}/funds`,
      body = { name: `Replay ${crypto.randomUUID()}` };
    const a = await pastor.call(path, body, { key });
    expect(a.status).toBe(201);
    expect((await pastor.call(path, body, { key })).payload.data).toEqual(a.payload.data);
    expect((await pastor.call(path, { name: `${body.name} changed` }, { key })).status).toBe(409);
    expect((await pastor.call(`${root()}/operations/${a.payload.data.operationId}`)).status).toBe(
      200,
    );
    expect((await pastor2.call(`${root()}/operations/${a.payload.data.operationId}`)).status).toBe(
      404,
    );
    expect(
      (await treasurer.call(`${root()}/operations/${a.payload.data.operationId}`)).status,
    ).toBe(404);
    const op = await db.db
      .collection("idempotency_operations")
      .findOne({ _id: new ObjectId(a.payload.data.operationId) });
    expect(Object.keys(op?.safeResult).sort()).toEqual(["fundId", "version"]);
    await db.db
      .collection("idempotency_operations")
      .updateOne(
        { _id: new ObjectId(a.payload.data.operationId) },
        { $set: { createdAt: new Date(Date.now() - 25 * 3600000) } },
      );
    expect((await pastor.call(path, body, { key })).payload.error.code).toBe("IDEMPOTENCY_EXPIRED");
    expect(
      await db.db
        .collection("finance_funds")
        .countDocuments({ churchId: new ObjectId(c.id), name: body.name }),
    ).toBe(1);
  });
  test("rollback after business insert leaves no fund/history/audit/ledger", async () => {
    const name = `Rollback ${crypto.randomUUID()}`,
      before = await db.db.collection("finance_history").countDocuments(),
      ops = await db.db.collection("idempotency_operations").countDocuments();
    const mock = spyOn(identity.audit, "organization").mockImplementationOnce(async () => {
      throw new AppError(503, "DEPENDENCY_UNAVAILABLE");
    });
    try {
      expect((await pastor.call(`${root()}/funds`, { name })).status).toBe(503);
    } finally {
      mock.mockRestore();
    }
    expect(await db.db.collection("finance_funds").countDocuments({ name })).toBe(0);
    expect(await db.db.collection("finance_history").countDocuments()).toBe(before);
    expect(await db.db.collection("idempotency_operations").countDocuments()).toBe(ops);
  });
  test("tenant isolation across IDs/history/cursors/receipts and mixed cookies", async () => {
    const cc = await financeChurch(owner),
      s = client();
    await syntheticUser(owner, s, cc, "pastor");
    const f = await create();
    for (const suffix of [
      `funds/${f.fundId}`,
      `funds/${f.fundId}/history`,
      `operations/${f.operationId}`,
    ])
      expect((await s.call(`${financeRoot(cc)}/${suffix}`)).status).toBe(404);
    expect((await s.call(`${root()}/funds`)).status).toBe(403);
    s.jar.set("__Host-church-owner", "ambient-not-authority");
    secretary.jar = new Map([...secretary.jar, ...owner.jar]);
    expect((await secretary.call(`${root()}/funds`)).status).toBe(403);
  });
  test("stable server pages, literal accented prefix and signed filter/actor cursor binding", async () => {
    const prefix = `Pages ${crypto.randomUUID()}`;
    for (let i = 0; i < 29; i++) await create(`${prefix} ${String(i).padStart(2, "0")}`);
    const query = `q=${encodeURIComponent(prefix)}`,
      first = await pastor.call(`${root()}/funds?${query}&limit=7`),
      cursor = first.payload.data.nextCursor;
    expect(first.payload.data.items).toHaveLength(7);
    expect(cursor).toBeString();
    const ids: string[] = [];
    let next: string | null = null;
    do {
      const r = await pastor.call(
        `${root()}/funds?${query}&limit=7${next ? `&cursor=${next}` : ""}`,
      );
      expect(r.status).toBe(200);
      ids.push(...r.payload.data.items.map((f: { id: string }) => f.id));
      next = r.payload.data.nextCursor;
    } while (next);
    expect(ids).toHaveLength(29);
    expect(new Set(ids).size).toBe(29);
    expect(
      (await pastor.call(`${root()}/funds?${query}&status=inactive&cursor=${cursor}`)).status,
    ).toBe(400);
    expect((await treasurer.call(`${root()}/funds?${query}&cursor=${cursor}`)).status).toBe(400);
    expect((await pastor.call(`${root()}/funds?limit=101`)).status).toBe(400);
    expect((await pastor.call(`${root()}/funds?q=.*`)).payload.data.items).toHaveLength(0);
    const a = await create("Quỹ Ánh sáng"),
      match = await pastor.call(`${root()}/funds?q=${encodeURIComponent("quỹ ánh")}`);
    expect(match.payload.data.items.map((f: { id: string }) => f.id)).toContain(a.fundId);
  });
  test("revoke between authentication and TX rejects writes; revoked roles cannot replay prior result", async () => {
    const s = client(),
      u = await syntheticUser(owner, s, c, "pastor"),
      path = `${root()}/funds`,
      body = { name: `Before revoke ${crypto.randomUUID()}` },
      key = crypto.randomUUID();
    const made = await s.call(path, body, { key });
    expect(made.status).toBe(201);
    const original = Finance.prototype.writeFund,
      spy = spyOn(Finance.prototype, "writeFund").mockImplementationOnce(async function (
        this: Finance,
        ...args
      ) {
        await db.db
          .collection("accounts")
          .updateOne(
            { _id: new ObjectId(u.id) },
            { $set: { role: "treasurer" }, $inc: { version: 1 } },
          );
        return original.apply(this, args);
      });
    const name = `Fence ${crypto.randomUUID()}`;
    try {
      expect((await s.call(path, { name })).status).toBe(401);
    } finally {
      spy.mockRestore();
    }
    expect(await db.db.collection("finance_funds").countDocuments({ name })).toBe(0);
    expect((await s.call(path, body, { key })).status).toBe(403);
    expect((await s.call(`${root()}/operations/${made.payload.data.operationId}`)).status).toBe(
      403,
    );
  });
  test("CSRF, unsupported future commands, audit allowlist and no finance details in provider response/logs", async () => {
    expect(
      (
        await pastor.call(
          `${root()}/funds`,
          { name: "no csrf" },
          { headers: { "x-csrf-token": "" } },
        )
      ).status,
    ).toBe(403);
    for (const suffix of ["proposals", "payments"])
      expect((await pastor.call(`${root()}/${suffix}`, {})).status).toBe(404);
    expect((await pastor.call(`${root()}/periods/2026-11/close`, {})).status).toBe(403);
    const f = await create("Quỹ nội dung không vào audit"),
      reason = "Lý do riêng không vào audit";
    await patch(`${root()}/funds/${f.fundId}/status`, { status: "inactive", reason }, 1);
    const audit = await owner.call(
      `owner/audit-events?churchId=${c.id}&eventType=finance.fund.status_changed`,
    );
    expect(audit.status).toBe(200);
    expect(JSON.stringify(audit.payload)).not.toContain(reason);
    expect(JSON.stringify(audit.payload)).not.toContain("Quỹ nội dung");
    expect(JSON.stringify(logs)).not.toContain(reason);
    expect(JSON.stringify(logs)).not.toContain("proposerRoles");
    for (const log of logs)
      expect(Object.keys(log).sort()).toEqual([
        "latencyMs",
        "method",
        "requestId",
        "route",
        "status",
      ]);
  });
});
