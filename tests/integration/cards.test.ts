import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { config } from "../../api/config";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay } from "../../api/members/dates";
import {
  SyntheticClient,
  seedP2,
  syntheticChurch,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3464",
  database: `church_cms_test_p32_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw new Error("Local synthetic only");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  logs: object[] = [];
let app: ReturnType<typeof createApp>,
  owner: SyntheticClient,
  ownerId: string,
  now = Date.now();
const client = (realm: "owner" | "church" = "owner") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
const base = (c: { id: string }, s = owner) =>
  `${s.realm === "owner" ? "owner/" : ""}churches/${c.id}`;
async function fixture(count = 3) {
  const c = await syntheticChurch(owner, `QR synthetic ${crypto.randomUUID()}`);
  await seedP2(db, c.id, ownerId, count);
  await db.db
    .collection("members")
    .updateMany({ churchId: new ObjectId(c.id) }, { $set: { participation: "active" } });
  const rows = await db.db
    .collection("members")
    .find({ churchId: new ObjectId(c.id) })
    .sort({ _id: 1 })
    .toArray();
  const r = await owner.call(`${base(c)}/attendance/sessions`, {
    label: "Quét QR synthetic",
    heldOn: businessDay(new Date(now)),
    location: null,
    scope: "church",
    unitId: null,
  });
  expect(r.status).toBe(201);
  const id = r.payload.data.sessionId,
    p = await owner.call(`${base(c)}/attendance/sessions/${id}/candidates`);
  expect(
    (
      await owner.call(
        `${base(c)}/attendance/sessions/${id}/open`,
        { previewToken: p.payload.data.previewToken },
        { version: 1 },
      )
    ).status,
  ).toBe(200);
  return { ...c, rows, sessionId: id };
}
function member(c: { rows: { _id: ObjectId }[] }, index = 0) {
  const row = c.rows[index];
  if (!row) throw new Error("Missing synthetic member");
  return row._id.toString();
}
async function issue(c: { id: string }, memberId: string, s = owner) {
  const r = await s.call(`${base(c, s)}/members/${memberId}/cards`, {});
  expect(r.status).toBe(201);
  const image = await s.call(`${base(c, s)}/cards/${r.payload.data.cardId}/render`);
  expect(image.status).toBe(200);
  return image.payload.data;
}
async function resolve(
  c: { id: string; sessionId: string },
  code: string,
  s = owner,
  generation = 2,
) {
  return s.call(`${base(c, s)}/attendance/sessions/${c.sessionId}/qr-resolutions`, {
    code,
    generation,
  });
}
async function scan(
  c: { id: string; sessionId: string },
  p: { resolutionToken: string; participant: { version: number }; session: { generation: number } },
  s = owner,
  key: string = crypto.randomUUID(),
) {
  return s.call(
    `${base(c, s)}/attendance/sessions/${c.sessionId}/scans`,
    { resolutionToken: p.resolutionToken, generation: p.session.generation },
    { version: p.participant.version, key },
  );
}
async function state(c: { id: string; sessionId: string }) {
  const r = await owner.call(`${base(c)}/attendance/sessions/${c.sessionId}`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf, () => new Date(now));
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  owner = client();
  ownerId = (await syntheticOwner(db, owner)).id;
});
afterAll(async () => {
  await db.db.dropDatabase();
  expect(
    (await db.client.db("admin").admin().listDatabases()).databases.some(
      (d) => d.name === conf.database,
    ),
  ).toBe(false);
  await rate.client.quit();
  await db.client.close();
});
describe("P3.2 Cards / QR real Mongo Redis", () => {
  test("opaque QR, snapshot, duplicate issue, SVG escaping and no public lookup", async () => {
    const c = await fixture(),
      mid = member(c);
    const image = await issue(c, mid);
    expect(image.payload).toMatch(/^QLHT1:[A-Za-z0-9_-]{43}$/);
    expect(image.payload).not.toContain(mid);
    expect(image.svg).toContain("<svg");
    expect((await owner.call(`${base(c)}/members/${mid}/cards`, {})).status).toBe(409);
    const snapshot = image.card.snapshot;
    await db.db
      .collection("members")
      .updateOne(
        { _id: new ObjectId(mid) },
        { $set: { fullName: "<img src=x onerror=alert(1)> Mới" } },
      );
    const current = (await owner.call(`${base(c)}/members/${mid}/card`)).payload.data;
    expect(current.profileChanged).toBe(true);
    expect(current.card.snapshot).toEqual(snapshot);
    expect(
      (await owner.call(`${base(c)}/cards/${image.card.id}/render`)).payload.data.payload,
    ).toBe(image.payload);
    expect((await client().call(`${base(c)}/cards/${image.card.id}/render`)).status).toBe(401);
    expect((await client().call(`qr/${image.payload}`)).status).toBe(404);
  });
  test("issue same-key exact replay yields one card, history and sanitized receipt", async () => {
    const c = await fixture(),
      mid = member(c),
      key = crypto.randomUUID(),
      path = `${base(c)}/members/${mid}/cards`;
    const first = await owner.call(path, {}, { key }),
      again = await owner.call(path, {}, { key });
    expect(first.status).toBe(201);
    expect(again.payload.data).toEqual(first.payload.data);
    expect(again.payload.meta.replayed).toBe(true);
    expect(
      await db.db
        .collection("member_cards")
        .countDocuments({ churchId: new ObjectId(c.id), memberId: new ObjectId(mid) }),
    ).toBe(1);
    expect(
      await db.db
        .collection("member_card_history")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
    const op = await db.db
      .collection("idempotency_operations")
      .findOne({ routeKey: `cards/${c.id}/members/${mid}/cards` });
    expect(op).toBeTruthy();
    const receipt = await owner.call(`${base(c)}/cards/operations/${op?._id}`);
    expect(receipt.status).toBe(200);
    expect(JSON.stringify(receipt.payload)).not.toContain("QLHT1:");
    expect(JSON.stringify(receipt.payload)).not.toContain("fullName");
  });
  test("rotation invalidates previously resolved proof, captures snapshot and enforces CAS", async () => {
    const c = await fixture(),
      mid = member(c),
      image = await issue(c, mid),
      p = (await resolve(c, image.payload)).payload.data;
    await db.db
      .collection("members")
      .updateOne({ _id: new ObjectId(mid) }, { $set: { fullName: "Tên mới synthetic" } });
    const path = `${base(c)}/cards/${image.card.id}/replace`;
    expect((await owner.call(path, { reason: "Mất thẻ" }, { version: 1 })).status).toBe(200);
    expect((await owner.call(path, { reason: "Mất thẻ" }, { version: 1 })).status).toBe(412);
    expect((await resolve(c, image.payload)).status).toBe(404);
    expect((await scan(c, p)).status).toBe(404);
    const fresh = (await owner.call(`${base(c)}/cards/${image.card.id}/render`)).payload.data;
    expect(fresh.payload).not.toBe(image.payload);
    expect(fresh.card.snapshot.fullName).toBe("Tên mới synthetic");
    const h = (await owner.call(`${base(c)}/cards/${image.card.id}/history?limit=1`)).payload.data;
    expect(h.items[0].event).toBe("replaced");
    expect(h.items[0].before.state).toBe("revoked");
    expect(h.nextCursor).toBeTruthy();
    expect(
      (
        await owner.call(
          `${base(c)}/cards/${image.card.id}/history?cursor=${encodeURIComponent(h.nextCursor)}`,
        )
      ).payload.data.items,
    ).toHaveLength(1);
  });
  test("scan / repeated-present no-op / revoke preserves attendance / issue after revoke", async () => {
    const c = await fixture(),
      mid = member(c),
      image = await issue(c, mid),
      p = (await resolve(c, image.payload)).payload.data;
    expect((await scan(c, p)).status).toBe(200);
    expect((await state(c)).presentCount).toBe(1);
    const next = (await resolve(c, image.payload)).payload.data;
    expect((await scan(c, next)).payload.data.applied).toBe(false);
    expect((await state(c)).presentCount).toBe(1);
    const history = await db.db
      .collection("attendance_history")
      .find({ churchId: new ObjectId(c.id), event: "marked" })
      .toArray();
    expect(history).toHaveLength(1);
    expect(history[0]?.after.source).toBe("qr");
    expect(
      (
        await owner.call(
          `${base(c)}/cards/${image.card.id}/revoke`,
          { reason: "Thu hồi" },
          { version: 1 },
        )
      ).status,
    ).toBe(200);
    expect((await resolve(c, image.payload)).status).toBe(404);
    expect((await owner.call(`${base(c)}/cards/${image.card.id}/render`)).status).toBe(409);
    expect((await state(c)).presentCount).toBe(1);
    const fresh = await issue(c, mid);
    expect(fresh.card.version).toBe(3);
    expect(fresh.payload).not.toBe(image.payload);
  });
  test("member inactive between resolve and scan fails, but manual historical marking remains available", async () => {
    const c = await fixture(),
      mid = member(c),
      image = await issue(c, mid),
      p = (await resolve(c, image.payload)).payload.data;
    await db.db
      .collection("members")
      .updateOne({ _id: new ObjectId(mid) }, { $set: { participation: "transferred" } });
    expect((await scan(c, p)).status).toBe(404);
    expect((await state(c)).presentCount).toBe(0);
    expect(
      (
        await owner.call(
          `${base(c)}/attendance/sessions/${c.sessionId}/participants/${mid}`,
          { present: true, generation: 2 },
          { method: "PATCH", version: 1 },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await owner.call(
          `${base(c)}/cards/${image.card.id}/replace`,
          { reason: "Đổi tên" },
          { version: 1 },
        )
      ).status,
    ).toBe(422);
  });
  test("proof binds actor, tenant, session, generation, row version and expires in 60 seconds", async () => {
    const c = await fixture(),
      image = await issue(c, member(c)),
      p = (await resolve(c, image.payload)).payload.data;
    const second = client();
    await syntheticOwner(db, second);
    expect((await scan(c, p, second)).status).toBe(409);
    const foreign = await fixture();
    expect((await scan(foreign, p)).status).toBe(409);
    expect((await resolve(foreign, image.payload)).status).toBe(404);
    expect((await scan(c, { ...p, participant: { version: 99 } })).status).toBe(409);
    expect((await scan(c, { ...p, resolutionToken: `${p.resolutionToken}x` })).status).toBe(409);
    now += 60_001;
    expect((await scan(c, p)).status).toBe(409);
    now -= 60_001;
    expect((await resolve(c, image.payload, owner, 999)).status).toBe(409);
  });
  test("close/reset/excluded row invalidate proof and same-key committed replay cannot remark reset", async () => {
    const c = await fixture(),
      image = await issue(c, member(c)),
      p = (await resolve(c, image.payload)).payload.data,
      key = crypto.randomUUID();
    const first = await scan(c, p, owner, key);
    expect(first.status).toBe(200);
    let s = await state(c);
    expect(
      (
        await owner.call(
          `${base(c)}/attendance/sessions/${c.sessionId}/reset`,
          { reason: "Làm lại" },
          { version: s.version },
        )
      ).status,
    ).toBe(200);
    now += 61_000;
    const replay = await scan(c, p, owner, key);
    expect(replay.status).toBe(200);
    expect(replay.payload.meta.replayed).toBe(true);
    expect((await state(c)).presentCount).toBe(0);
    now -= 61_000;
    expect((await scan(c, p)).status).toBe(409);
    s = await state(c);
    const fresh = (await resolve(c, image.payload, owner, s.generation)).payload.data;
    expect(
      (
        await owner.call(
          `${base(c)}/attendance/sessions/${c.sessionId}/close`,
          {},
          { version: s.version },
        )
      ).status,
    ).toBe(200);
    expect((await scan(c, fresh)).status).toBe(409);
  });
  test("concurrent same-row QR/manual uses shared row CAS with one count/history", async () => {
    const c = await fixture(),
      mid = member(c),
      image = await issue(c, mid),
      p = (await resolve(c, image.payload)).payload.data;
    const result = await Promise.all([
      scan(c, p),
      owner.call(
        `${base(c)}/attendance/sessions/${c.sessionId}/participants/${mid}`,
        { present: true, generation: 2 },
        { method: "PATCH", version: 1 },
      ),
    ]);
    expect(result.filter((r) => r.status === 200)).toHaveLength(1);
    expect([409, 412]).toContain(result.find((r) => r.status !== 200)?.status ?? 0);
    expect((await state(c)).presentCount).toBe(1);
  });
  test("transaction rollback removes card and history when audit insertion fails", async () => {
    const c = await fixture(),
      mid = member(c),
      collection = db.db.collection.bind(db.db);
    const intercepted = spyOn(db.db, "collection").mockImplementation(((
      name: string,
      ...args: unknown[]
    ) => {
      const col = collection(name, ...(args as []));
      if (name === "audit_events")
        return new Proxy(col, {
          get(target, key) {
            if (key === "insertOne")
              return async () => {
                throw new Error("Synthetic audit failure");
              };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      return col;
    }) as typeof db.db.collection);
    let r: Awaited<ReturnType<SyntheticClient["call"]>> | undefined;
    try {
      r = await owner.call(`${base(c)}/members/${mid}/cards`, {});
    } finally {
      intercepted.mockRestore();
    }
    expect(r?.status).toBe(503);
    expect(
      await db.db.collection("member_cards").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
    expect(
      await db.db
        .collection("member_card_history")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
  });
  test("role matrix, tenant fence, CSRF resolution, fresh receipt permission and PII-free logs", async () => {
    const c = await fixture(),
      image = await issue(c, member(c)),
      secretary = client("church"),
      treasurer = client("church"),
      lead = client("church");
    const staff = await syntheticUser(owner, secretary, c, "secretary");
    await syntheticUser(owner, treasurer, c, "treasurer");
    const u = await owner.call(`${base(c)}/organization/units`, {
      kind: "service_ministry",
      name: "Ban synthetic QR",
    });
    expect(u.status).toBe(201);
    await syntheticUser(owner, lead, c, "ministry_lead", [u.payload.data.unit.id]);
    expect(
      (await secretary.call(`${base(c, secretary)}/members/${c.rows[0]?._id}/card`)).status,
    ).toBe(200);
    expect(
      (await treasurer.call(`${base(c, treasurer)}/cards/${image.card.id}/render`)).status,
    ).toBe(403);
    expect((await lead.call(`${base(c, lead)}/cards/${image.card.id}/render`)).status).toBe(403);
    expect((await resolve(c, image.payload, lead)).status).toBe(404);
    expect(
      (
        await owner.call(
          `${base(c)}/attendance/sessions/${c.sessionId}/qr-resolutions`,
          { code: image.payload, generation: 2 },
          { headers: { "x-csrf-token": "invalid" } },
        )
      ).status,
    ).toBe(403);
    const foreign = await fixture();
    expect(
      (await secretary.call(`${base(foreign, secretary)}/members/${foreign.rows[0]?._id}/card`))
        .status,
    ).toBe(404);
    const issued = await issue(c, member(c, 1), secretary),
      op = await db.db
        .collection("idempotency_operations")
        .findOne({ actorId: new ObjectId(staff.id), routeKey: { $regex: "^cards/" } });
    expect(issued.card).toBeTruthy();
    expect(op).toBeTruthy();
    await db.db
      .collection("accounts")
      .updateOne(
        { _id: new ObjectId(staff.id) },
        { $set: { role: "treasurer" }, $inc: { version: 1 } },
      );
    expect(
      (await secretary.call(`${base(c, secretary)}/cards/operations/${op?._id}`)).status,
    ).not.toBe(200);
    expect(JSON.stringify(logs)).not.toContain(image.payload);
    expect(JSON.stringify(logs)).not.toContain("resolutionToken");
    expect(JSON.stringify(logs)).not.toContain(image.card.snapshot.fullName);
  });
  test("QR committed unknown acknowledgement replays once; revoke after resolve blocks commit", async () => {
    const c = await fixture(),
      image = await issue(c, member(c)),
      p = (await resolve(c, image.payload)).payload.data,
      key = crypto.randomUUID();
    const start = db.client.startSession.bind(db.client);
    const intercepted = spyOn(db.client, "startSession").mockImplementation((...args) => {
      const tx = start(...args),
        commit = tx.commitTransaction.bind(tx);
      tx.commitTransaction = async () => {
        await commit();
        const error = new MongoError("Synthetic QR acknowledgement loss");
        error.addErrorLabel("UnknownTransactionCommitResult");
        throw error;
      };
      return tx;
    });
    let response: Awaited<ReturnType<typeof scan>>;
    try {
      response = await scan(c, p, owner, key);
    } finally {
      intercepted.mockRestore();
    }
    expect(response.status).toBe(503);
    expect(response.payload.error.code).toBe("OUTCOME_UNKNOWN");
    expect(
      (await owner.call(`${base(c)}/attendance/operations/${response.payload.meta.operationId}`))
        .status,
    ).toBe(200);
    expect((await scan(c, p, owner, key)).payload.meta.replayed).toBe(true);
    expect((await state(c)).presentCount).toBe(1);
    const second = await issue(c, member(c, 1)),
      pending = (await resolve(c, second.payload)).payload.data;
    expect(
      (
        await owner.call(
          `${base(c)}/cards/${second.card.id}/revoke`,
          { reason: "Báo mất" },
          { version: 1 },
        )
      ).status,
    ).toBe(200);
    expect((await scan(c, pending)).status).toBe(404);
    expect((await state(c)).presentCount).toBe(1);
  });
  test("lead resolves own unit snapshot only, excluded member fails, lost unit permission denies receipt", async () => {
    const c = await fixture(),
      u = (
        await owner.call(`${base(c)}/organization/units`, {
          kind: "service_ministry",
          name: "Ban QR giới hạn",
        })
      ).payload.data.unit;
    await db.db
      .collection("members")
      .updateMany(
        { churchId: new ObjectId(c.id) },
        { $set: { "assignment.unitIds": [new ObjectId(u.id)] } },
      );
    const made = await owner.call(`${base(c)}/attendance/sessions`, {
      label: "Buổi ban QR",
      heldOn: businessDay(new Date(now)),
      location: null,
      scope: "unit",
      unitId: u.id,
    });
    expect(made.status).toBe(201);
    const scoped = { ...c, sessionId: made.payload.data.sessionId };
    const preview = await owner.call(
      `${base(c)}/attendance/sessions/${scoped.sessionId}/candidates`,
    );
    expect(
      (
        await owner.call(
          `${base(c)}/attendance/sessions/${scoped.sessionId}/open`,
          { previewToken: preview.payload.data.previewToken },
          { version: 1 },
        )
      ).status,
    ).toBe(200);
    const lead = client("church"),
      account = await syntheticUser(owner, lead, c, "ministry_lead", [u.id]),
      image = await issue(c, member(c));
    const resolved = await resolve(scoped, image.payload, lead);
    expect(resolved.status).toBe(200);
    expect(
      Object.keys(resolved.payload.data.participant).some((k) =>
        ["phone", "notes", "address", "birthDate"].includes(k),
      ),
    ).toBe(false);
    const marked = await scan(scoped, resolved.payload.data, lead);
    expect(marked.status).toBe(200);
    const op = await db.db.collection("idempotency_operations").findOne({
      actorId: new ObjectId(account.id),
      routeKey: `attendance/${c.id}/sessions/${scoped.sessionId}/scans`,
    });
    expect(op).toBeTruthy();
    expect((await lead.call(`${base(c, lead)}/attendance/operations/${op?._id}`)).status).toBe(200);
    const s = await owner.call(`${base(c)}/attendance/sessions/${scoped.sessionId}`);
    expect(
      (
        await owner.call(
          `${base(c)}/attendance/sessions/${scoped.sessionId}/roster-changes`,
          { memberId: member(c), included: false, reason: "Loại synthetic" },
          { version: s.payload.data.version },
        )
      ).status,
    ).toBe(200);
    expect((await resolve(scoped, image.payload, lead)).status).toBe(404);
    await db.db
      .collection("accounts")
      .updateOne(
        { _id: new ObjectId(account.id) },
        { $set: { "scope.unitIds": [new ObjectId().toHexString()] }, $inc: { version: 1 } },
      );
    expect((await lead.call(`${base(c, lead)}/attendance/operations/${op?._id}`)).status).not.toBe(
      200,
    );
  });
  test("card concurrent issue has one active revision; read limiter excludes commit/replay", async () => {
    const c = await fixture(),
      mid = member(c),
      responses = await Promise.all(
        Array.from({ length: 5 }, () => owner.call(`${base(c)}/members/${mid}/cards`, {})),
      );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      await db.db.collection("member_cards").countDocuments({
        churchId: new ObjectId(c.id),
        memberId: new ObjectId(mid),
        state: "active",
      }),
    ).toBe(1);
    const card = responses.find((r) => r.status === 201)?.payload.data.cardId,
      image = (await owner.call(`${base(c)}/cards/${card}/render`)).payload.data;
    const p = (await resolve(c, image.payload)).payload.data;
    const limiter = spyOn(rate, "qrResolution").mockRejectedValue(
      new Error("Synthetic limiter boundary"),
    );
    // An unavailable resolution limiter does not block commit of an existing proof.
    try {
      expect((await resolve(c, image.payload)).status).toBe(503);
      expect((await scan(c, p)).status).toBe(200);
    } finally {
      limiter.mockRestore();
    }
    expect((await state(c)).presentCount).toBe(1);
  });
});
