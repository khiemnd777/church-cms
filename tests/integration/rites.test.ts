import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { Audit } from "../../api/audit/service";
import { config } from "../../api/config";
import { importFields } from "../../api/data-exchange/contracts";
import { makeFile } from "../../api/data-exchange/files";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../../api/members/dates";
import { Rites } from "../../api/rites/service";
import type { RiteCommand } from "../../api/rites/validation";
import {
  SyntheticClient,
  seedP2,
  syntheticChurch,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3467",
  database: `church_cms_test_p34_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw new Error("Local synthetic only");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let app: ReturnType<typeof createApp>, owner: SyntheticClient, ownerId: string;
const client = (realm: "owner" | "church" = "owner") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
const base = (c: { id: string }, s = owner) =>
  `${s.realm === "owner" ? "owner/" : ""}churches/${c.id}`;
const rp = (c: { id: string }, s = owner) => `${base(c, s)}/rites/records`;
const day = () => businessDay();
async function fixture(n = 6) {
  const c = await syntheticChurch(owner, `Lễ synthetic ${crypto.randomUUID()}`);
  await seedP2(db, c.id, ownerId, n);
  const rows = await db.db
    .collection("members")
    .find({ churchId: new ObjectId(c.id) })
    .sort({ _id: 1 })
    .toArray();
  return { ...c, rows };
}
const member = (c: Awaited<ReturnType<typeof fixture>>, i = 0) => ({
  source: "member" as const,
  memberId: c.rows[i]?._id.toHexString() as string,
});
const external = (name = "Người ngoài synthetic") => ({
  source: "external" as const,
  fullName: name,
  birthDate: null,
});
function body(
  c: Awaited<ReturnType<typeof fixture>>,
  kind: RiteCommand["record"]["payload"]["kind"] = "baptism",
  extra: Partial<RiteCommand> = {},
): RiteCommand {
  const p =
    kind === "baptism"
      ? { kind, person: member(c), officiant: external("Mục sư synthetic"), place: "Nơi synthetic" }
      : kind === "dedication"
        ? {
            kind,
            child: member(c),
            parents: [{ role: "guardian" as const, person: member(c, 1) }],
            officiant: null,
            place: null,
          }
        : kind === "marriage"
          ? {
              kind,
              groom: member(c),
              bride: external(),
              officiant: null,
              place: null,
              announcements: [],
            }
          : kind === "funeral"
            ? { kind, person: member(c), deathOn: shiftDay(day(), -1), age: null, place: null }
            : { kind, officiant: null, count: null, place: null };
  return {
    record: { payload: p, date: day(), historical: false, note: null },
    state: "draft",
    reason: null,
    baptismAfter: null,
    preview: null,
    ...extra,
  };
}
async function preview(c: { id: string }, b: RiteCommand, id?: string, v?: number, s = owner) {
  return s.call(`${rp(c, s)}${id ? `/${id}` : ""}/preview`, b, { version: v });
}
async function save(
  c: { id: string },
  b: RiteCommand,
  id?: string,
  v?: number,
  s = owner,
  key = crypto.randomUUID(),
) {
  const p = await preview(c, b, id, v, s);
  expect(p.status).toBe(200);
  return s.call(
    `${rp(c, s)}${id ? `/${id}` : ""}`,
    { ...b, preview: p.payload.data.context },
    { method: id ? "PATCH" : "POST", version: v, key },
  );
}
async function get(c: { id: string }, id: string, s = owner) {
  const r = await s.call(`${rp(c, s)}/${id}`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
const recorded = (b: RiteCommand): RiteCommand => ({
  ...b,
  state: "recorded",
  baptismAfter:
    b.record.payload.kind === "baptism"
      ? { status: "baptized", date: b.record.date, place: b.record.payload.place }
      : null,
});
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  app = createApp(identity, conf, { log: () => {} });
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
describe("P3.4 Rites real Mongo Redis", () => {
  test("five typed ceremonies, partial legacy facts and no fabricated officiant/place", async () => {
    const c = await fixture();
    await db.db
      .collection("members")
      .updateOne(
        { _id: c.rows[0]?._id },
        { $set: { baptism: { status: "baptized", date: null, place: null } } },
      );
    let facts = await owner.call(`${base(c)}/rites/baptism-facts`);
    expect(facts.status).toBe(200);
    expect(
      facts.payload.data.items.find((m: { id: string }) => m.id === member(c).memberId).rite,
    ).toBeNull();
    for (const kind of ["baptism", "dedication", "marriage", "funeral", "communion"] as const) {
      const b = body(c, kind);
      const r = await owner.call(rp(c), b);
      expect(r.status).toBe(201);
      const d = await get(c, r.payload.data.riteId);
      expect(d.kind).toBe(kind);
      expect(d.state).toBe("draft");
    }
    expect(
      (await owner.call(`${base(c)}/members/${member(c).memberId}/rites`)).payload.data.items
        .length,
    ).toBe(4);
    const b = body(c, "communion");
    expect(
      (
        await owner.call(rp(c), {
          ...b,
          record: { ...b.record, payload: { ...b.record.payload, person: member(c) } },
        })
      ).status,
    ).toBe(422);
    facts = await owner.call(`${base(c)}/rites/baptism-facts`);
    expect(
      facts.payload.data.items.find((m: { id: string }) => m.id === member(c).memberId).baptism
        .date,
    ).toBeNull();
  });
  test("Baptism preview required, atomic profile fact, eligible class read, exact replay and one active ceremony", async () => {
    const c = await fixture(),
      b = recorded(body(c));
    await db.db.collection("members").updateOne(
      { _id: c.rows[0]?._id },
      {
        $set: {
          type: "believer",
          membership: "preparatory",
          baptism: { status: "unknown", date: null, place: null },
        },
      },
    );
    expect((await owner.call(rp(c), b)).status).toBe(412);
    const p = await preview(c, b),
      key = crypto.randomUUID(),
      intent = { ...b, preview: p.payload.data.context };
    const r = await owner.call(rp(c), intent, { key });
    expect(r.status).toBe(201);
    const again = await owner.call(rp(c), intent, { key });
    expect(again.status).toBe(200);
    expect(again.payload.meta.replayed).toBe(true);
    const current = (await owner.call(`${base(c)}/members/${member(c).memberId}`)).payload.data;
    expect(current.baptism).toEqual(b.baptismAfter);
    expect(current.type).toBe("believer");
    expect(current.membership).toBe("preparatory");
    const course = await owner.call(`${base(c)}/prep-classes/courses`, {
      name: "Lớp synthetic",
      startOn: day(),
      teacher: null,
      baptismOn: null,
      lessons: ["Bài"],
    });
    expect(course.status).toBe(201);
    const cand = await owner.call(
      `${base(c)}/prep-classes/courses/${course.payload.data.courseId}/candidates`,
    );
    expect(cand.payload.data.items.some((m: { id: string }) => m.id === member(c).memberId)).toBe(
      false,
    );
    expect((await save(c, b)).status).toBe(409);
    expect(
      await db.db
        .collection("rite_records")
        .countDocuments({ churchId: new ObjectId(c.id), state: "recorded" }),
    ).toBe(1);
    expect(
      (
        await owner.call(
          `${base(c)}/rites/operations/${r.payload.meta.operationId ?? r.payload.data.operationId}`,
        )
      ).status,
    ).toBe(200);
  });
  test("profile edits observe same transaction, preserve ceremony snapshot, invalidate stale preview", async () => {
    const c = await fixture(),
      b = recorded(body(c)),
      r = await save(c, b),
      id = r.payload.data.riteId,
      d = await get(c, id);
    const correction = { ...b, reason: "Đính chính synthetic" },
      p = await preview(c, correction, id, d.version);
    const m = (await owner.call(`${base(c)}/members/${member(c).memberId}`)).payload.data;
    const changed = { status: "baptized", date: shiftDay(day(), -1), place: "Nơi đã sửa" };
    expect(
      (
        await owner.call(
          `${base(c)}/members/${m.id}`,
          { baptism: changed, fullName: "Họ tên đã sửa synthetic" },
          { method: "PATCH", version: m.version },
        )
      ).status,
    ).toBe(200);
    const next = await get(c, id);
    expect(next.version).toBe(d.version + 1);
    expect(next.currentBaptism).toEqual(changed);
    expect(next.people[0].fullName).toBe(d.people[0].fullName);
    expect(next.record).toEqual(d.record);
    expect(
      (
        await owner.call(
          `${rp(c)}/${id}`,
          { ...correction, preview: p.payload.data.context },
          { method: "PATCH", version: d.version },
        )
      ).status,
    ).toBe(412);
    const h = await owner.call(`${rp(c)}/${id}/history`);
    expect(h.payload.data.items[0].event).toBe("profile_baptism_changed");
  });
  test("planned baptism never changes profile; historical null accepted; void explicitly preserves or corrects fact", async () => {
    const c = await fixture(),
      b = body(c);
    const old = (await owner.call(`${base(c)}/members/${member(c).memberId}`)).payload.data.baptism;
    const planned = {
      ...b,
      state: "planned" as const,
      record: { ...b.record, date: shiftDay(day(), 7) },
    };
    const made = await save(c, planned);
    expect(made.status).toBe(201);
    expect(
      (await owner.call(`${base(c)}/members/${member(c).memberId}`)).payload.data.baptism,
    ).toEqual(old);
    expect((await preview(c, recorded(planned))).status).toBe(422);
    const historical = recorded({ ...b, record: { ...b.record, date: null, historical: true } });
    const r = await save(c, historical);
    expect(r.status).toBe(201);
    const id = r.payload.data.riteId,
      d = await get(c, id);
    const voided = {
      ...historical,
      state: "void" as const,
      reason: "Hủy bản ghi, giữ sự kiện hồ sơ",
      baptismAfter: null,
    };
    expect((await save(c, voided, id, d.version)).status).toBe(200);
    expect((await get(c, id)).currentBaptism.status).toBe("baptized");
    const c2 = await fixture(),
      r2 = await save(c2, recorded(body(c2))),
      id2 = r2.payload.data.riteId,
      d2 = await get(c2, id2);
    expect(
      (
        await save(
          c2,
          {
            ...recorded(body(c2)),
            state: "void",
            reason: "Đính chính thông tin nhập sai",
            baptismAfter: { status: "unknown", date: null, place: null },
          },
          id2,
          d2.version,
        )
      ).status,
    ).toBe(200);
    expect((await get(c2, id2)).currentBaptism.status).toBe("unknown");
  });
  test("explicit dedication parents not inferred; source version changes invalidate preview; snapshots freeze", async () => {
    const c = await fixture(),
      b = recorded(body(c, "dedication"));
    if (b.record.payload.kind !== "dedication") throw Error();
    b.record.payload.parents = [
      { role: "father", person: external("Cha ngoài synthetic") },
      { role: "guardian", person: member(c, 4) },
    ];
    const p = await preview(c, b),
      m = (await owner.call(`${base(c)}/members/${member(c, 4).memberId}`)).payload.data;
    expect(
      (
        await owner.call(
          `${base(c)}/members/${m.id}`,
          { fullName: "Giám hộ đổi tên" },
          { method: "PATCH", version: m.version },
        )
      ).status,
    ).toBe(200);
    expect((await owner.call(rp(c), { ...b, preview: p.payload.data.context })).status).toBe(412);
    const r = await save(c, b);
    expect(r.status).toBe(201);
    const d = await get(c, r.payload.data.riteId);
    expect(d.people.map((p: { fullName: string }) => p.fullName)).toEqual([
      c.rows[0]?.fullName,
      "Cha ngoài synthetic",
      "Giám hộ đổi tên",
    ]);
    const oldFamily = c.rows[0]?.familyId;
    expect((await db.db.collection("members").findOne({ _id: c.rows[0]?._id }))?.familyId).toEqual(
      oldFamily,
    );
    expect(
      (
        await preview(
          c,
          { ...b, reason: "Đính chính", record: { ...b.record, note: "Ghi chú" } },
          d.id,
          d.version,
        )
      ).payload.data.after.people,
    ).toEqual(d.people);
  });
  test("marriage explicit link, announcements and future planned records without household writes", async () => {
    const c = await fixture(),
      b = body(c, "marriage");
    if (b.record.payload.kind !== "marriage") throw Error();
    expect(
      (
        await preview(c, {
          ...b,
          record: { ...b.record, payload: { ...b.record.payload, groom: external() } },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await preview(c, {
          ...b,
          record: { ...b.record, payload: { ...b.record.payload, bride: member(c) } },
        })
      ).status,
    ).toBe(422);
    b.record.payload.announcements = [
      { date: day(), state: "announced", note: "Đã rao lần đầu" },
      { date: shiftDay(day(), 7), state: "planned", note: null },
    ];
    b.state = "planned";
    b.record.date = shiftDay(day(), 14);
    const r = await save(c, b);
    expect(r.status).toBe(201);
    const d = await get(c, r.payload.data.riteId);
    expect(d.record.payload.announcements).toEqual(b.record.payload.announcements);
    expect(
      (await db.db.collection("members").findOne({ _id: c.rows[0]?._id }))?.householdRole,
    ).toBe(c.rows[0]?.householdRole);
  });
  test("funeral distinguishes ceremony/death/age, keeps participation and allows historical non-current profiles", async () => {
    const c = await fixture();
    await db.db
      .collection("members")
      .updateOne({ _id: c.rows[0]?._id }, { $set: { participation: "transferred" } });
    const b = recorded(body(c, "funeral")),
      r = await save(c, b);
    expect(r.status).toBe(201);
    const d = await get(c, r.payload.data.riteId);
    expect(d.record.payload.age).toBeNull();
    expect(
      (await owner.call(`${base(c)}/members/${member(c).memberId}`)).payload.data.participation,
    ).toBe("transferred");
    if (b.record.payload.kind !== "funeral") throw Error();
    expect(
      (
        await preview(c, {
          ...b,
          record: { ...b.record, payload: { ...b.record.payload, deathOn: shiftDay(day(), 1) } },
        })
      ).status,
    ).toBe(422);
  });
  test("communion null differs zero, no attendance inference, next from explicit planned record", async () => {
    const c = await fixture(),
      b = recorded(body(c, "communion"));
    const r = await save(c, b);
    expect(r.status).toBe(201);
    expect((await get(c, r.payload.data.riteId)).record.payload.count).toBeNull();
    if (b.record.payload.kind !== "communion") throw Error();
    const z = { ...b, record: { ...b.record, payload: { ...b.record.payload, count: 0 } } };
    const zero = await save(c, z);
    expect((await get(c, zero.payload.data.riteId)).record.payload.count).toBe(0);
    const future = { ...body(c, "communion"), state: "planned" as const };
    future.record.date = shiftDay(day(), 3);
    const planned = await save(c, future);
    expect(planned.status).toBe(201);
    const list = await owner.call(`${rp(c)}?kind=communion`);
    expect(list.payload.data.nextPlanned.record.date).toBe(future.record.date);
    expect(
      await db.db
        .collection("attendance_sessions")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
  });
  test("RBAC all routes, cross tenant subjects/cursors, actor receipts and CSRF", async () => {
    const c = await fixture(),
      other = await fixture();
    for (const role of ["secretary", "pastor"]) {
      const s = client("church");
      await syntheticUser(owner, s, c, role);
      const r = await save(c, recorded(body(c, "communion")), undefined, undefined, s);
      expect(r.status).toBe(201);
      expect((await s.call(rp(c, s))).status).toBe(200);
      expect((await s.call(rp(other, s))).status).toBe(404);
      expect(
        (await s.call(`${base(c, s)}/rites/operations/${r.payload.data.operationId}`)).status,
      ).toBe(200);
      expect(
        (await owner.call(`${base(c)}/rites/operations/${r.payload.data.operationId}`)).status,
      ).toBe(404);
    }
    const units = await db.db
      .collection("organization_units")
      .find({ churchId: new ObjectId(c.id) })
      .limit(1)
      .toArray();
    for (const role of ["treasurer", "member", "ministry_lead"]) {
      const s = client("church");
      await syntheticUser(
        owner,
        s,
        c,
        role,
        units.map((u) => u._id.toHexString()),
      );
      expect((await s.call(rp(c, s))).status).toBe(403);
      expect((await s.call(`${base(c, s)}/members/${member(c).memberId}/rites`)).status).toBe(403);
      expect((await preview(c, body(c), undefined, undefined, s)).status).toBe(403);
    }
    const b = body(c);
    if (b.record.payload.kind !== "baptism") throw Error();
    b.record.payload.person = member(other);
    expect((await preview(c, b)).status).toBe(404);
    expect(
      (await owner.call(rp(c), body(c), { headers: { origin: "https://wrong.test" } })).status,
    ).toBe(403);
  });
  test("keyset has stable dates/null order, signed filter/actor context, year/name search and history pages", async () => {
    const c = await fixture();
    for (let i = 0; i < 6; i++) {
      const b = body(c, "communion");
      b.record.date = i < 3 ? day() : null;
      b.record.historical = true;
      expect((await save(c, b)).status).toBe(201);
    }
    const seen = new Set();
    let cursor = "";
    do {
      const r = await owner.call(
        `${rp(c)}?kind=communion&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(r.status).toBe(200);
      for (const row of r.payload.data.items) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = r.payload.data.nextCursor ?? "";
    } while (cursor);
    expect(seen.size).toBe(6);
    const first = await owner.call(`${rp(c)}?kind=communion&limit=1`);
    expect(
      (
        await owner.call(
          `${rp(c)}?kind=funeral&cursor=${encodeURIComponent(first.payload.data.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (await owner.call(`${rp(c)}?kind=communion&year=${day().slice(0, 4)}`)).payload.data.items
        .length,
    ).toBe(3);
    expect((await owner.call(`${rp(c)}?limit=101`)).status).toBe(400);
    const r = await save(c, recorded(body(c, "dedication"))),
      id = r.payload.data.riteId,
      d = await get(c, id);
    const b = { ...recorded(body(c, "dedication")), reason: "Đính chính" };
    expect((await save(c, b, id, d.version)).status).toBe(200);
    const h = await owner.call(`${rp(c)}/${id}/history?limit=1`);
    expect(h.payload.data.nextCursor).toBeTruthy();
    expect(
      (
        await owner.call(
          `${rp(c)}/${id}/history?limit=1&cursor=${encodeURIComponent(h.payload.data.nextCursor)}`,
        )
      ).payload.data.items.length,
    ).toBe(1);
  });
  test("concurrent same version wins once; unknown committed acknowledgement recovers with one history", async () => {
    const c = await fixture(),
      b = body(c, "communion"),
      r = await save(c, b),
      id = r.payload.data.riteId,
      d = await get(c, id),
      ed = { ...b, record: { ...b.record, note: "Đồng thời" } };
    const edits = await Promise.all([
      owner.call(`${rp(c)}/${id}`, ed, { method: "PATCH", version: d.version }),
      owner.call(`${rp(c)}/${id}`, ed, { method: "PATCH", version: d.version }),
    ]);
    expect(edits.map((r) => r.status).sort()).toEqual([200, 412]);
    const p = await preview(c, recorded(b)),
      intent = { ...recorded(b), preview: p.payload.data.context },
      key = crypto.randomUUID(),
      start = db.client.startSession.bind(db.client),
      spy = spyOn(db.client, "startSession").mockImplementation((...args) => {
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
    let lost: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      lost = await owner.call(rp(c), intent, { key });
    } finally {
      spy.mockRestore();
    }
    expect(lost.status).toBe(503);
    expect(lost.payload.error.code).toBe("OUTCOME_UNKNOWN");
    expect(
      (await owner.call(`${base(c)}/rites/operations/${lost.payload.meta.operationId}`)).status,
    ).toBe(200);
    const replay = await owner.call(rp(c), intent, { key });
    expect(replay.status).toBe(200);
    expect(replay.payload.meta.replayed).toBe(true);
    expect(
      await db.db
        .collection("rite_history")
        .countDocuments({ riteId: new ObjectId(replay.payload.data.riteId) }),
    ).toBe(1);
  });
  test("audit failure atomically rolls back member fact, ceremony, history and operation", async () => {
    const c = await fixture(),
      b = recorded(body(c)),
      p = await preview(c, b),
      old = (await owner.call(`${base(c)}/members/${member(c).memberId}`)).payload.data;
    const original = Audit.prototype.organization,
      spy = spyOn(Audit.prototype, "organization").mockImplementation(async function (
        this: Audit,
        ...args: Parameters<Audit["organization"]>
      ) {
        if (args[0] === "rites.created") throw Error("Synthetic audit failure");
        return original.apply(this, args);
      });
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await owner.call(rp(c), { ...b, preview: p.payload.data.context });
    } finally {
      spy.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(r.payload.error.code).toBe("DEPENDENCY_UNAVAILABLE");
    const current = (await owner.call(`${base(c)}/members/${member(c).memberId}`)).payload.data;
    expect(current.baptism).toEqual(old.baptism);
    expect(current.version).toBe(old.version);
    expect(
      await db.db.collection("rite_records").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
    expect(
      await db.db.collection("rite_history").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
  });
  test("in-flight revoke blocks writes, replay and receipt with fresh action fences", async () => {
    const c = await fixture(),
      s = client("church"),
      account = await syntheticUser(owner, s, c),
      b = body(c, "communion"),
      key = crypto.randomUUID(),
      saved = await s.call(rp(c, s), b, { key });
    expect(saved.status).toBe(201);
    let enter!: () => void, release!: () => void;
    const reached = new Promise<void>((r) => {
        enter = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      }),
      original = Rites.prototype.save,
      spy = spyOn(Rites.prototype, "save").mockImplementation(async function (
        this: Rites,
        ...args: Parameters<Rites["save"]>
      ) {
        enter();
        await gate;
        return original.apply(this, args);
      });
    const inFlight = s.call(rp(c, s), b);
    await reached;
    try {
      await db.db
        .collection("accounts")
        .updateOne(
          { _id: new ObjectId(account.id) },
          { $set: { role: "member", scope: { kind: "self" } }, $inc: { version: 1 } },
        );
    } finally {
      release();
      spy.mockRestore();
    }
    expect((await inFlight).status).toBe(401);
    expect((await s.call(rp(c, s), b, { key })).status).toBe(403);
    expect(
      (await s.call(`${base(c, s)}/rites/operations/${saved.payload.data.operationId}`)).status,
    ).toBe(403);
    expect(
      await db.db.collection("rite_records").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
  });
  test("DB validators and bounded typed payloads reject bypass and cap overflow", async () => {
    const c = await fixture(),
      b = body(c, "dedication");
    if (b.record.payload.kind !== "dedication") throw Error();
    b.record.payload.parents = Array.from({ length: 20 }, () => ({
      role: "guardian",
      person: external(),
    }));
    expect((await save(c, b)).status).toBe(201);
    b.record.payload.parents.push({ role: "guardian", person: external() });
    expect((await preview(c, b)).status).toBe(422);
    await expect(
      db.db
        .collection("rite_records")
        .insertOne({ _id: new ObjectId(), churchId: new ObjectId(c.id), kind: "unknown" }),
    ).rejects.toThrow();
    const indexes = await db.db.collection("rite_records").listIndexes().toArray();
    expect(indexes.some((i) => i.name === "rites_baptism_current" && i.unique)).toBe(true);
  });
  test("CSV import creates canonical baptism, source link never overwrites profile or ceremony", async () => {
    const c = await fixture(0),
      xp = `${base(c)}/data-exchange`,
      row: Record<string, string> = {
        externalId: "P34-import",
        fullName: "Nguyễn lễ nhập synthetic",
        gender: "unknown",
        birthDate: "1990-01-02",
        type: "believer",
        membership: "member",
        participation: "active",
        familyKey: "P34-family",
        householdRole: "head",
        assignmentMode: "auto",
        baptismStatus: "baptized",
        baptismDate: "2010-01-02",
        baptismPlace: "Nơi nhập",
        consent: "true",
      };
    const file = await makeFile(importFields, [importFields.map((f) => row[f] ?? "")], "csv"),
      upload = await owner.call(`${xp}/imports`, file.bytes, {
        headers: { "x-file-format": "csv", "x-import-source": encodeURIComponent("P34 synthetic") },
      });
    expect(upload.status).toBe(201);
    const id = upload.payload.data.importId;
    let j = (await owner.call(`${xp}/imports/${id}`)).payload.data;
    expect(
      (await owner.call(`${xp}/imports/${id}/prepare`, {}, { version: j.version })).status,
    ).toBe(200);
    j = (await owner.call(`${xp}/imports/${id}`)).payload.data;
    expect(
      (
        await owner.call(
          `${xp}/imports/${id}/batches`,
          { token: j.planToken, nextBatch: j.nextBatch, consent: true },
          { version: j.version },
        )
      ).status,
    ).toBe(200);
    const facts = await owner.call(`${base(c)}/rites/baptism-facts`);
    expect(facts.payload.data.items.length).toBe(1);
    expect(facts.payload.data.items[0].baptism.place).toBe("Nơi nhập");
    expect(facts.payload.data.items[0].rite).toBeNull();
    row.baptismPlace = "Không được ghi đè";
    const file2 = await makeFile(importFields, [importFields.map((f) => row[f] ?? "")], "csv"),
      upload2 = await owner.call(`${xp}/imports`, file2.bytes, {
        headers: { "x-file-format": "csv", "x-import-source": encodeURIComponent("P34 synthetic") },
      });
    expect(upload2.status).toBe(201);
    const id2 = upload2.payload.data.importId;
    j = (await owner.call(`${xp}/imports/${id2}`)).payload.data;
    expect(
      (await owner.call(`${xp}/imports/${id2}/prepare`, {}, { version: j.version })).status,
    ).toBe(200);
    j = (await owner.call(`${xp}/imports/${id2}`)).payload.data;
    expect(
      (
        await owner.call(
          `${xp}/imports/${id2}/batches`,
          { token: j.planToken, nextBatch: j.nextBatch, consent: true },
          { version: j.version },
        )
      ).status,
    ).toBe(200);
    expect(
      (await owner.call(`${base(c)}/rites/baptism-facts`)).payload.data.items[0].baptism.place,
    ).toBe("Nơi nhập");
  });
  test("profile baptism and ceremony confirmation racing cannot overwrite or half-commit", async () => {
    const c = await fixture(),
      b = recorded(body(c)),
      p = await preview(c, b);
    const m = (await owner.call(`${base(c)}/members/${member(c).memberId}`)).payload.data;
    const [profile, ceremony] = await Promise.all([
      owner.call(
        `${base(c)}/members/${m.id}`,
        {
          baptism: {
            status: "baptized",
            date: shiftDay(day(), -2),
            place: "Nguồn hồ sơ đồng thời",
          },
        },
        { method: "PATCH", version: m.version },
      ),
      owner.call(rp(c), { ...b, preview: p.payload.data.context }),
    ]);
    expect([profile.status, ceremony.status].filter((x) => x === 412).length).toBe(1);
    expect([profile.status, ceremony.status].filter((x) => x === 200 || x === 201).length).toBe(1);
    const final = (await owner.call(`${base(c)}/members/${m.id}`)).payload.data;
    expect(final.version).toBe(m.version + 1);
    expect(
      await db.db.collection("rite_records").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(ceremony.status === 201 ? 1 : 0);
    expect(final.baptism.place).toBe(
      ceremony.status === 201 ? "Nơi synthetic" : "Nguồn hồ sơ đồng thời",
    );
  });
  test("confirmed subject/kind are immutable, stale preview and bounds do not cause side effects", async () => {
    const c = await fixture(),
      b = recorded(body(c)),
      r = await save(c, b),
      d = await get(c, r.payload.data.riteId);
    const before = await db.db
      .collection("rite_history")
      .countDocuments({ churchId: new ObjectId(c.id) });
    if (b.record.payload.kind !== "baptism") throw Error();
    expect(
      (
        await preview(
          c,
          {
            ...b,
            reason: "Sai đối tượng",
            record: { ...b.record, payload: { ...b.record.payload, person: member(c, 1) } },
          },
          d.id,
          d.version,
        )
      ).payload.error.code,
    ).toBe("RITE_SUBJECT_IMMUTABLE");
    expect(
      (await preview(c, { ...recorded(body(c, "communion")), reason: "Sai loại" }, d.id, d.version))
        .payload.error.code,
    ).toBe("RITE_KIND_IMMUTABLE");
    const edit = { ...b, reason: "Đính chính", record: { ...b.record, note: "Đổi ghi chú" } },
      p = await preview(c, edit, d.id, d.version);
    expect(
      (
        await owner.call(
          `${rp(c)}/${d.id}`,
          {
            ...edit,
            record: { ...edit.record, note: "Payload khác" },
            preview: p.payload.data.context,
          },
          { method: "PATCH", version: d.version },
        )
      ).payload.error.code,
    ).toBe("RITE_PREVIEW_STALE");
    expect(
      await db.db.collection("rite_history").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(before);
    const marriage = body(c, "marriage");
    if (marriage.record.payload.kind !== "marriage") throw Error();
    marriage.record.payload.announcements = Array.from({ length: 100 }, () => ({
      date: day(),
      state: "announced",
      note: null,
    }));
    expect((await save(c, marriage)).status).toBe(201);
    marriage.record.payload.announcements.push({ date: day(), state: "planned", note: null });
    expect((await preview(c, marriage)).status).toBe(422);
  });
});
