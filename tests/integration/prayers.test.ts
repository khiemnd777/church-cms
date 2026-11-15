import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { Audit } from "../../api/audit/service";
import { config } from "../../api/config";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../../api/members/dates";
import { PrayerMembers } from "../../api/members/prayers";
import { Prayers } from "../../api/prayers/service";
import type { PrayerCommand } from "../../api/prayers/validation";
import { SyntheticClient, syntheticOwner, syntheticUser } from "../../scripts/p2-fixtures";
import {
  p44Fixture,
  prayerCommon,
  prayerCreate,
  prayerEdit,
  prayerRoot,
  prayerSave,
} from "../../scripts/p44-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3484",
  database: `church_cms_test_p44_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw Error("Local synthetic only");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  logs: object[] = [];
let app: ReturnType<typeof createApp>, owner: SyntheticClient, actorId: string;
const client = (realm: "owner" | "church" = "owner") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
const fixture = (n = 12) => p44Fixture(db, owner, actorId, n),
  root = (c: { id: string }, s = owner) => prayerRoot(c, s);
async function get(c: { id: string }, id: string, s = owner) {
  const r = await s.call(`${root(c, s)}/${id}`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
async function made(c: { id: string }, b = prayerCreate(), s = owner) {
  const r = await prayerSave(s, c, b);
  expect(r.status).toBe(201);
  return get(c, r.payload.data.prayerId, s);
}
async function save(
  c: { id: string },
  p: { id: string; version: number },
  b: PrayerCommand,
  s = owner,
) {
  const r = await prayerSave(s, c, b, p.id, p.version);
  expect(r.status).toBe(200);
  return get(c, p.id, s);
}
const closing = (action: "close" | "cancel"): PrayerCommand => ({
  action,
  ...prayerCommon,
  reason: "Kết thúc synthetic",
  confirmed: true,
});
async function pastor(c: { id: string; code: string }) {
  const s = client("church"),
    account = await syntheticUser(owner, s, c, "pastor");
  return { s, account };
}
const base = (c: { id: string }, s = owner) =>
  `${s.realm === "owner" ? "owner/" : ""}churches/${c.id}`;
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  app = createApp(identity, conf, { log: (row) => logs.push(row) });
  owner = client();
  actorId = (await syntheticOwner(db, owner)).id;
});
afterAll(async () => {
  await db.db.dropDatabase();
  expect(
    (await db.db.admin().listDatabases()).databases.some((d) => d.name === conf.database),
  ).toBe(false);
  await rate.client.quit();
  await db.client.close();
});
describe("P4.4 real Mongo Redis HTTP prayer privacy", () => {
  test("shared request snapshot, unknown sender/date and no business writes to sources", async () => {
    const c = await fixture(),
      person = c.people[0];
    if (!person) throw Error();
    const b = prayerCreate("shared", {
        requester: { kind: "member", id: person._id.toHexString() },
        receivedOn: null,
      }),
      d = await made(c, b);
    expect(d.code).toMatch(/^CT-/);
    expect(d.state).toBe("open");
    expect(d.receivedOn).toBeNull();
    expect(d.requesterSnapshot.name).toBe(person.fullName);
    expect(d.requesterSnapshot).not.toHaveProperty("phone");
    expect(d.requesterSnapshot).not.toHaveProperty("address");
    const after = await db.db.collection("members").findOne({ _id: person._id });
    expect(after?.version).toBe(person.version);
    expect(after?.visitor).toEqual(person.visitor);
    expect(after?.assignment).toEqual(person.assignment);
    expect(
      await db.db.collection("visitation_cases").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
    expect(
      await db.db.collection("care_alerts").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
    const none = await made(c);
    expect(none.requesterSnapshot).toEqual({ kind: "none", id: null, code: null, name: null });
  });
  test("only pastor can create/read pastoral; all current pastors same tenant can manage", async () => {
    const c = await fixture(),
      { s } = await pastor(c),
      other = await pastor(c),
      secretary = client("church");
    await syntheticUser(owner, secretary, c);
    for (const who of [owner, secretary])
      expect((await who.call(`${root(c, who)}/preview`, prayerCreate("pastoral"))).status).toBe(
        403,
      );
    const d = await made(c, prayerCreate("pastoral"), s);
    expect(d.visibility).toBe("pastoral");
    expect((await other.s.call(`${root(c, other.s)}/${d.id}`)).status).toBe(200);
    expect((await other.s.call(`${root(c, other.s)}/${d.id}/history`)).status).toBe(200);
    expect((await owner.call(`${base(c)}/context`)).payload.data.capabilities).not.toContain(
      "prayers:private",
    );
    expect((await owner.call(`${base(c)}/context`)).payload.data.capabilities).toContain(
      "prayers:manage",
    );
  }, 30000);
  test("adding private records changes no shared list/count/search/pages or hidden placeholders", async () => {
    const c = await fixture(),
      { s } = await pastor(c),
      secretary = client("church");
    await syntheticUser(owner, secretary, c);
    for (let i = 0; i < 3; i++)
      await made(c, prayerCreate("shared", { content: `Chung synthetic ${i}` }));
    const before = await owner.call(`${root(c)}?limit=2&state=all`);
    for (let i = 0; i < 8; i++)
      await made(
        c,
        prayerCreate("pastoral", {
          content: `PRIVATE_SENTINEL_${i}`,
          requester: { kind: "text", name: "PRIVATE_SENDER_SENTINEL" },
          category: "health",
        }),
        s,
      );
    const after = await owner.call(`${root(c)}?limit=2&state=all`);
    expect(after.payload.data.items).toEqual(before.payload.data.items);
    expect(after.payload.data.summary).toEqual(before.payload.data.summary);
    const decode = (x: string) => {
      const v = JSON.parse(Buffer.from(x.split(".")[0] as string, "base64url").toString());
      return { id: v.id, context: v.context };
    };
    expect(decode(after.payload.data.nextCursor)).toEqual(decode(before.payload.data.nextCursor));
    for (const who of [owner, secretary]) {
      const list = await who.call(`${root(c, who)}?state=all`);
      expect(list.payload.data.summary.total).toBe(3);
      expect(JSON.stringify(list.payload)).not.toContain("PRIVATE_");
      expect(list.payload.data).not.toHaveProperty("privateCount");
      expect(
        (await who.call(`${root(c, who)}?q=PRIVATE_SENTINEL`)).payload.data.summary.total,
      ).toBe(0);
      expect((await who.call(`${root(c, who)}?visibility=pastoral`)).status).toBe(403);
    }
    expect((await s.call(`${root(c, s)}?state=all`)).payload.data.summary.total).toBe(11);
  }, 30000);
  test("private IDs behave like missing IDs on detail history preview and mutation", async () => {
    const c = await fixture(),
      { s } = await pastor(c),
      d = await made(c, prayerCreate("pastoral"), s),
      missing = new ObjectId().toHexString(),
      secretary = client("church");
    await syntheticUser(owner, secretary, c);
    for (const who of [owner, secretary])
      for (const suffix of ["", "/history"]) {
        const a = await who.call(`${root(c, who)}/${d.id}${suffix}`),
          b = await who.call(`${root(c, who)}/${missing}${suffix}`);
        expect(a.status).toBe(404);
        expect(a.payload.error).toEqual(b.payload.error);
        expect(a.payload.meta).not.toHaveProperty("operationId");
      }
    for (const method of ["POST", "PATCH"]) {
      const path = `${root(c)}/${d.id}${method === "POST" ? "/preview" : ""}`;
      expect(
        (await owner.call(path, closing("close"), { method, version: d.version })).status,
      ).toBe(404);
    }
  });
  test("manual share is distinct from close, confirmation and immutable visibility", async () => {
    const c = await fixture();
    let d = await made(c);
    const b: PrayerCommand = {
      action: "share",
      ...prayerCommon,
      sharedOn: businessDay(),
      reason: "Đã chia sẻ synthetic",
    };
    const p = await owner.call(`${root(c)}/${d.id}/preview`, b, { version: d.version });
    expect(
      (
        await owner.call(
          `${root(c)}/${d.id}`,
          { ...b, preview: p.payload.data.context },
          { method: "PATCH", version: d.version },
        )
      ).status,
    ).toBe(422);
    d = await save(c, d, b);
    expect(d.state).toBe("shared");
    expect(d.closedAt).toBeNull();
    expect((await owner.call(`${root(c)}`)).payload.data.summary.active).toBe(1);
    expect((await owner.call(`${root(c)}/${d.id}/preview`, b, { version: d.version })).status).toBe(
      409,
    );
    expect(
      (
        await owner.call(
          `${root(c)}/${d.id}/preview`,
          { ...prayerEdit(d), visibility: "pastoral" },
          { version: d.version },
        )
      ).status,
    ).toBe(422);
    d = await save(c, d, closing("close"));
    expect(d.state).toBe("closed");
    expect((await owner.call(`${root(c)}`)).payload.data.summary.active).toBe(0);
    expect(
      (await owner.call(`${root(c)}/${d.id}/preview`, prayerEdit(d), { version: d.version }))
        .status,
    ).toBe(409);
  });
  test("private share denied; cancel requires reason/confirmation and no reopen/delete", async () => {
    const c = await fixture(),
      { s } = await pastor(c);
    let d = await made(c, prayerCreate("pastoral"), s);
    expect(
      (
        await s.call(
          `${root(c, s)}/${d.id}/preview`,
          { action: "share", ...prayerCommon, sharedOn: businessDay(), reason: "x" },
          { version: d.version },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await s.call(
          `${root(c, s)}/${d.id}/preview`,
          { ...closing("cancel"), reason: null },
          { version: d.version },
        )
      ).status,
    ).toBe(422);
    d = await save(c, d, closing("cancel"), s);
    expect(d.state).toBe("cancelled");
    for (const action of ["reopen", "delete"])
      expect(
        (await s.call(`${root(c, s)}/${d.id}`, { action }, { method: "PATCH", version: d.version }))
          .status,
      ).toBe(422);
    expect((await s.call(`${root(c, s)}/${d.id}`, undefined, { method: "DELETE" })).status).toBe(
      405,
    );
  });
  test("reasoned closed correction preserves snapshots before/after and permits share-date correction only after sharing", async () => {
    const c = await fixture();
    let d = await made(c, prayerCreate("shared", { receivedOn: shiftDay(businessDay(), -5) }));
    expect(
      (
        await owner.call(
          `${root(c)}/${d.id}/preview`,
          { ...prayerEdit(d, {}, "correct"), sharedOn: businessDay() },
          { version: d.version },
        )
      ).status,
    ).toBe(422);
    d = await save(c, d, {
      action: "share",
      ...prayerCommon,
      sharedOn: shiftDay(businessDay(), -1),
      reason: "Shared synthetic",
    });
    d = await save(c, d, closing("close"));
    const before = d;
    d = await save(c, d, {
      ...prayerEdit(d, { content: "Đính chính synthetic", category: "thanksgiving" }, "correct"),
      action: "correct",
      sharedOn: businessDay(),
    });
    expect(d.state).toBe("closed");
    expect(d.sharedOn).toBe(businessDay());
    expect(d.closedAt).toBe(before.closedAt);
    const history = (await owner.call(`${root(c)}/${d.id}/history`)).payload.data.items;
    expect(history[0].before.content).toBe(before.content);
    expect(history[0].after.content).toBe(d.content);
    expect(history[0].reason).toBeTruthy();
  });
  test("date rules preserve null, reject future and share before known receipt", async () => {
    const c = await fixture(),
      future = shiftDay(businessDay(), 1);
    expect(
      (await owner.call(`${root(c)}/preview`, prayerCreate("shared", { receivedOn: future })))
        .status,
    ).toBe(422);
    const d = await made(c);
    for (const day of [future, shiftDay(businessDay(), -1)])
      expect(
        (
          await owner.call(
            `${root(c)}/${d.id}/preview`,
            { action: "share", ...prayerCommon, sharedOn: day, reason: "x" },
            { version: d.version },
          )
        ).status,
      ).toBe(422);
    const unknown = await made(c, prayerCreate("shared", { receivedOn: null }));
    expect(
      (
        await save(c, unknown, {
          action: "share",
          ...prayerCommon,
          sharedOn: shiftDay(businessDay(), -1),
          reason: "x",
        })
      ).state,
    ).toBe("shared");
  });
  test("source picker is reduced, paged and current; foreign/inactive new requester denied", async () => {
    const c = await fixture(60),
      other = await fixture();
    const p = await owner.call(`${root(c)}/people?limit=17`);
    expect(p.payload.data.items).toHaveLength(17);
    expect(p.payload.data.nextCursor).toBeTruthy();
    expect(Object.keys(p.payload.data.items[0]).sort()).toEqual(["code", "fullName", "id"]);
    expect(
      (
        await owner.call(
          `${root(c)}/people?limit=17&cursor=${encodeURIComponent(p.payload.data.nextCursor)}`,
        )
      ).payload.data.items[0].id,
    ).not.toBe(p.payload.data.items[0].id);
    const last = c.people.at(-1);
    if (!last) throw Error();
    expect(
      (
        await owner.call(`${root(c)}/people?q=${encodeURIComponent(last.fullName)}`)
      ).payload.data.items.some((x: { id: string }) => x.id === last._id.toHexString()),
    ).toBe(true);
    for (const id of [other.people[0]?._id.toHexString(), new ObjectId().toHexString()])
      expect(
        (
          await owner.call(
            `${root(c)}/preview`,
            prayerCreate("shared", { requester: { kind: "member", id: id as string } }),
          )
        ).status,
      ).toBe(422);
    await db.db
      .collection("members")
      .updateOne({ _id: last._id }, { $set: { participation: "deceased" }, $inc: { version: 1 } });
    expect(
      (
        await owner.call(
          `${root(c)}/preview`,
          prayerCreate("shared", { requester: { kind: "member", id: last._id.toHexString() } }),
        )
      ).status,
    ).toBe(422);
  });
  test("source drift is separate, retained invalid sender allows close/correction without relink", async () => {
    const c = await fixture(),
      person = c.people[0];
    if (!person) throw Error();
    let d = await made(
      c,
      prayerCreate("shared", { requester: { kind: "member", id: person._id.toHexString() } }),
    );
    const snapshot = d.requesterSnapshot;
    await db.db.collection("members").updateOne(
      { _id: person._id },
      {
        $set: { fullName: "Tên nguồn đổi synthetic", participation: "deceased" },
        $inc: { version: 1 },
      },
    );
    d = await get(c, d.id);
    expect(d.source.available).toBe(false);
    expect(d.source.changed).toBe(true);
    expect(d.requesterSnapshot).toEqual(snapshot);
    d = await save(c, d, closing("close"));
    d = await save(c, d, prayerEdit(d, { content: "Sửa giữ người gửi cũ" }, "correct"));
    expect(d.requesterSnapshot).toEqual(snapshot);
    const replacement = c.people[1];
    if (!replacement) throw Error();
    d = await save(
      c,
      d,
      prayerEdit(
        d,
        { requester: { kind: "member", id: replacement._id.toHexString() } },
        "correct",
      ),
    );
    expect(d.requesterSnapshot.id).toBe(replacement._id.toHexString());
  });
  test("same content may repeat; exact key replay does not duplicate and changed body conflicts", async () => {
    const c = await fixture(),
      r = await prayerSave(owner, c, prayerCreate());
    expect(r.status).toBe(201);
    expect((await owner.call(root(c), r.intent, { key: r.key })).payload.meta.replayed).toBe(true);
    expect(
      (await owner.call(root(c), { ...r.intent, reason: "Khác" }, { key: r.key })).status,
    ).toBe(409);
    expect(
      await db.db.collection("prayer_history").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
    await made(c);
    expect(
      await db.db.collection("prayer_requests").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(2);
  });
  test("pastoral receipt/replay re-authorizes resource after role downgrade, including create replay", async () => {
    const c = await fixture(),
      { s, account } = await pastor(c),
      r = await prayerSave(s, c, prayerCreate("pastoral"));
    expect(r.status).toBe(201);
    const id = r.payload.data.prayerId,
      op = r.payload.data.operationId;
    expect((await s.call(`${root(c, s)}/operations/${op}`)).status).toBe(200);
    expect((await owner.call(`${root(c)}/operations/${op}`)).status).toBe(404);
    expect((await owner.call(`owner/operations/${op}`)).status).toBe(404);
    await db.db
      .collection("accounts")
      .updateOne(
        { _id: new ObjectId(account.id) },
        { $set: { role: "secretary" }, $inc: { version: 1 } },
      );
    for (const path of [
      `${root(c, s)}/${id}`,
      `${root(c, s)}/${id}/history`,
      `${root(c, s)}/operations/${op}`,
    ])
      expect((await s.call(path)).status).toBe(404);
    const replay = await s.call(root(c, s), r.intent, { key: r.key });
    expect(replay.status).toBe(404);
    expect(JSON.stringify(replay.payload)).not.toContain(id);
    expect(
      (await s.call(root(c, s), { ...r.intent, visibility: "shared" }, { key: r.key })).status,
    ).toBe(404);
  });
  test("cross tenant/actor receipt, history and cursors cannot cross authorization context", async () => {
    const c = await fixture(),
      other = await fixture(),
      { s } = await pastor(c),
      another = await pastor(c),
      r = await prayerSave(s, c, prayerCreate("pastoral"));
    expect(
      (await another.s.call(`${root(c, another.s)}/operations/${r.payload.data.operationId}`))
        .status,
    ).toBe(404);
    expect((await owner.call(`${root(other)}/${r.payload.data.prayerId}`)).status).toBe(404);
    expect((await s.call(root(other, s))).status).toBe(404);
    await made(c);
    await made(c);
    const p = await owner.call(`${root(c)}?limit=1`);
    expect(
      (
        await owner.call(
          `${root(other)}?limit=1&cursor=${encodeURIComponent(p.payload.data.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await s.call(
          `${root(c, s)}?limit=1&cursor=${encodeURIComponent(p.payload.data.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await owner.call(
          `${root(c)}?state=all&limit=1&cursor=${encodeURIComponent(p.payload.data.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
  });
  test("lead treasurer member denied including people counters history receipts and writes", async () => {
    const c = await fixture(),
      d = await made(c),
      unit = (
        await owner.call(`${base(c)}/organization/units`, {
          kind: "service_ministry",
          name: "Ban synthetic",
        })
      ).payload.data.unit.id;
    for (const role of ["ministry_lead", "treasurer", "member"]) {
      const s = client("church");
      await syntheticUser(owner, s, c, role, role === "ministry_lead" ? [unit] : []);
      for (const path of [
        "",
        "/people",
        `/${d.id}`,
        `/${d.id}/history`,
        `/operations/${new ObjectId()}`,
      ])
        expect((await s.call(root(c, s) + path)).status).toBe(403);
      expect((await s.call(`${root(c, s)}/preview`, prayerCreate())).status).toBe(403);
    }
  }, 30000);
  test("audit privacy is enforced before F23 filtering/paging, with legacy/general events preserved", async () => {
    const c = await fixture(),
      { s } = await pastor(c),
      shared = await made(c),
      secret = await made(
        c,
        prayerCreate("pastoral", {
          content: "AUDIT_PRIVATE_MARKER",
          requester: { kind: "text", name: "SENDER_PRIVATE_MARKER" },
        }),
        s,
      );
    await db.db.collection("audit_events").insertOne({
      _id: new ObjectId(),
      occurredAt: new Date(),
      actorKind: "owner",
      actorId: new ObjectId(actorId),
      actorChurchId: null,
      targetChurchId: new ObjectId(c.id),
      eventType: "legacy.synthetic",
      targetType: "church",
      outcome: "success",
      changedFields: [],
      safeSummary: "Legacy synthetic",
      requestId: crypto.randomUUID(),
    });
    let cursor: string | null = null;
    const rows: { targetId?: string; eventType: string }[] = [];
    do {
      const p = await owner.call(
        `owner/audit-events?churchId=${c.id}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(p.status).toBe(200);
      rows.push(...p.payload.data.items);
      cursor = p.payload.data.nextCursor;
    } while (cursor);
    expect(rows.some((x) => x.targetId === shared.id)).toBe(true);
    expect(rows.some((x) => x.eventType === "legacy.synthetic")).toBe(true);
    expect(rows.some((x) => x.targetId === secret.id)).toBe(false);
    expect(
      (await owner.call(`owner/audit-events?churchId=${c.id}&eventType=prayer.create`)).payload.data
        .items,
    ).toHaveLength(1);
    const actual = await db.db
      .collection("audit_events")
      .findOne({ targetId: new ObjectId(secret.id) });
    expect(actual?.audience).toBe("pastoral");
    expect(JSON.stringify(actual)).not.toContain("AUDIT_PRIVATE_MARKER");
    expect(JSON.stringify(actual)).not.toContain("SENDER_PRIVATE_MARKER");
  });
  test("W01 count follows actor scope and cannot reveal new pastoral requests", async () => {
    const c = await fixture(),
      { s } = await pastor(c),
      secretary = client("church");
    await syntheticUser(owner, secretary, c);
    await made(c);
    for (let i = 0; i < 2; i++) await made(c, prayerCreate("pastoral"), s);
    for (const who of [owner, secretary]) {
      const p = await who.call(`${base(c, who)}/overview`);
      expect(p.status).toBe(200);
      expect(p.payload.data.prayers).toEqual({ active: 1, availability: "available" });
    }
    expect((await s.call(`${base(c, s)}/overview`)).payload.data.prayers.active).toBe(3);
  });
  test("CAS race has one winner and preserves coherent state/history", async () => {
    const c = await fixture(),
      d = await made(c),
      b = prayerEdit(d, { content: "First contender synthetic" }),
      p = await owner.call(`${root(c)}/${d.id}/preview`, b, { version: d.version });
    const results = await Promise.all(
      [1, 2].map(() =>
        owner.call(
          `${root(c)}/${d.id}`,
          { ...b, confirmed: true, preview: p.payload.data.context },
          { method: "PATCH", version: d.version },
        ),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.every((r) => [200, 409, 412].includes(r.status))).toBe(true);
    const current = await get(c, d.id);
    expect(current.version).toBe(d.version + 1);
    expect(
      await db.db.collection("prayer_history").countDocuments({ prayerId: new ObjectId(d.id) }),
    ).toBe(2);
  });
  test("audit failure rolls back request/history/ledger and source fence", async () => {
    const c = await fixture(),
      person = c.people[0];
    if (!person) throw Error();
    const b = prayerCreate("shared", {
        requester: { kind: "member", id: person._id.toHexString() },
      }),
      p = await owner.call(`${root(c)}/preview`, b),
      key = crypto.randomUUID();
    const hook = spyOn(Audit.prototype, "organization").mockRejectedValue(
      new Error("synthetic audit failure"),
    );
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await owner.call(
        root(c),
        { ...b, preview: p.payload.data.context, confirmed: true },
        { key },
      );
    } finally {
      hook.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(
      await db.db.collection("prayer_requests").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
    expect(
      await db.db.collection("prayer_history").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
    expect((await db.db.collection("members").findOne({ _id: person._id }))?.writeFence).toBe(
      person.writeFence,
    );
    expect(
      await db.db
        .collection("idempotency_operations")
        .countDocuments({ churchId: new ObjectId(c.id), routeKey: { $regex: "^prayers/" } }),
    ).toBe(0);
  });
  test("source changes after preview and after proposal cannot write stale requester snapshots", async () => {
    const c = await fixture(),
      person = c.people[0];
    if (!person) throw Error();
    const b = prayerCreate("shared", {
        requester: { kind: "member", id: person._id.toHexString() },
      }),
      p = await owner.call(`${root(c)}/preview`, b);
    await db.db
      .collection("members")
      .updateOne(
        { _id: person._id },
        { $set: { fullName: "Tên đổi synthetic" }, $inc: { version: 1 } },
      );
    expect(
      (await owner.call(root(c), { ...b, confirmed: true, preview: p.payload.data.context }))
        .status,
    ).toBe(412);
    const next = await owner.call(`${root(c)}/preview`, b),
      original = PrayerMembers.prototype.fence;
    let changed = false;
    const hook = spyOn(PrayerMembers.prototype, "fence").mockImplementation(async function (
      this: PrayerMembers,
      g,
      p,
      tx,
    ) {
      if (!changed) {
        changed = true;
        await db.db
          .collection("members")
          .updateOne(
            { _id: person._id },
            { $set: { participation: "deceased" }, $inc: { version: 1 } },
          );
      }
      return original.call(this, g, p, tx);
    });
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await owner.call(root(c), { ...b, confirmed: true, preview: next.payload.data.context });
    } finally {
      hook.mockRestore();
    }
    expect([409, 412, 422]).toContain(r.status);
    expect(
      await db.db.collection("prayer_requests").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
  });
  test("real committed acknowledgement loss recovers same actor receipt/exact replay without duplicate", async () => {
    const c = await fixture(),
      { s } = await pastor(c),
      b = prayerCreate("pastoral"),
      p = await s.call(`${root(c, s)}/preview`, b),
      intent = { ...b, confirmed: true, preview: p.payload.data.context },
      key = crypto.randomUUID(),
      start = db.client.startSession.bind(db.client);
    const hook = spyOn(db.client, "startSession").mockImplementation((...args) => {
      const tx = start(...args),
        commit = tx.commitTransaction.bind(tx);
      tx.commitTransaction = async () => {
        await commit();
        const e = new MongoError("Synthetic ack loss");
        e.addErrorLabel("UnknownTransactionCommitResult");
        throw e;
      };
      return tx;
    });
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await s.call(root(c, s), intent, { key });
    } finally {
      hook.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(r.payload.error.code).toBe("OUTCOME_UNKNOWN");
    expect(r.payload.meta.operationId).toBeTruthy();
    expect((await s.call(`${root(c, s)}/operations/${r.payload.meta.operationId}`)).status).toBe(
      200,
    );
    expect((await s.call(root(c, s), intent, { key })).payload.meta.replayed).toBe(true);
    expect(
      await db.db.collection("prayer_requests").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
    expect(
      await db.db.collection("prayer_history").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
  });
  test("in-flight role revoke fences private mutation before commit", async () => {
    const c = await fixture(),
      { s, account } = await pastor(c),
      b = prayerCreate("pastoral"),
      p = await s.call(`${root(c, s)}/preview`, b),
      original = Prayers.prototype.save;
    let revoked = false;
    const hook = spyOn(Prayers.prototype, "save").mockImplementation(async function (
      this: Prayers,
      ...args
    ) {
      if (!revoked) {
        revoked = true;
        await db.db
          .collection("accounts")
          .updateOne(
            { _id: new ObjectId(account.id) },
            { $set: { role: "secretary" }, $inc: { version: 1 } },
          );
      }
      return original.apply(this, args);
    });
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await s.call(root(c, s), { ...b, confirmed: true, preview: p.payload.data.context });
    } finally {
      hook.mockRestore();
    }
    expect(r.status).toBe(401);
    expect(r.payload.error.code).toBe("SESSION_REVOKED");
    expect(
      await db.db.collection("prayer_requests").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
  });
  test("strict query/body/CSRF/method bounds and metadata-only transport logs", async () => {
    const c = await fixture();
    for (const query of [
      "limit=101",
      "limit=0",
      "state=bad",
      `q=${"a".repeat(101)}`,
      "state=all&state=active",
      "private=true",
      "cursor=bad",
    ])
      expect((await owner.call(`${root(c)}?${query}`)).status).toBe(400);
    expect((await client().call(root(c))).status).toBe(401);
    const b = prayerCreate("shared", { content: "TRANSPORT_SECRET_SENTINEL" });
    expect(
      (await owner.call(`${root(c)}/preview`, b, { headers: { "x-csrf-token": "bad" } })).status,
    ).toBe(403);
    expect(
      (
        await owner.call(root(c), new TextEncoder().encode("x".repeat(17000)), {
          headers: { "content-type": "application/json" },
        })
      ).status,
    ).toBe(413);
    expect((await owner.call(`${root(c)}/preview`, { ...b, prayerAudience: "all" })).status).toBe(
      422,
    );
    await made(c, b);
    await owner.call(`${root(c)}?q=TRANSPORT_SECRET_SENTINEL`);
    expect(JSON.stringify(logs)).not.toContain("TRANSPORT_SECRET_SENTINEL");
    expect((await owner.call(`${root(c)}/people/preview`, b)).status).toBe(404);
  });
  test("50 public corrections traverse bounded history and preserve all rows", async () => {
    const c = await fixture();
    let d = await made(c);
    for (let i = 0; i < 50; i++)
      d = await save(c, d, prayerEdit(d, { content: `Synthetic revision ${i}` }, "correct"));
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const p = await owner.call(
        `${root(c)}/${d.id}/history?limit=17${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(p.status).toBe(200);
      expect(p.payload.data.items.length).toBeLessThanOrEqual(17);
      ids.push(...p.payload.data.items.map((r: { id: string }) => r.id));
      cursor = p.payload.data.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(51);
    expect(new Set(ids).size).toBe(51);
    expect(d.version).toBe(51);
  }, 30000);
  test("database validators and code uniqueness reject malformed bypass without private dedup", async () => {
    const c = await fixture(),
      d = await made(c),
      raw = await db.db.collection("prayer_requests").findOne({ _id: new ObjectId(d.id) });
    if (!raw) throw Error();
    await expect(
      db.db.collection("prayer_requests").insertOne({ ...raw, _id: new ObjectId() }),
    ).rejects.toThrow();
    await expect(
      db.db
        .collection("prayer_requests")
        .updateOne({ _id: raw._id }, { $set: { visibility: "public" } }),
    ).rejects.toThrow();
    await expect(
      db.db
        .collection("audit_events")
        .updateOne({ targetId: raw._id }, { $set: { audience: "public" } }),
    ).rejects.toThrow();
    expect((await get(c, d.id)).visibility).toBe("shared");
  });
});
