import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import type { AttendanceGrant } from "../../api/attendance/models";
import { Attendance } from "../../api/attendance/service";
import { config } from "../../api/config";
import { digest } from "../../api/identity/crypto";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../../api/members/dates";
import {
  SyntheticClient,
  seedP2,
  syntheticChurch,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3463",
  database: `church_cms_test_p31_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw new Error("Synthetic local Mongo only");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let app: ReturnType<typeof createApp>, owner: SyntheticClient, ownerId: string;
let now = Date.now();
const logs: object[] = [];
const client = (realm: "owner" | "church" = "owner") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
const path = (c: { id: string }, subject = owner) =>
  `${subject.realm === "owner" ? "owner/" : ""}churches/${c.id}/attendance`;
async function fixture(count = 4) {
  const c = await syntheticChurch(owner, `P31 ${crypto.randomUUID()}`);
  await seedP2(db, c.id, ownerId, count);
  // Explicit fixture population: all current, including children and visitors.
  await db.db
    .collection("members")
    .updateMany({ churchId: new ObjectId(c.id) }, { $set: { participation: "active" } });
  const rows = await db.db
    .collection("members")
    .find({ churchId: new ObjectId(c.id) })
    .sort({ nameKey: 1, _id: 1 })
    .toArray();
  return { ...c, rows };
}
async function session(c: { id: string }, extra: object = {}, subject = owner) {
  const r = await subject.call(`${path(c, subject)}/sessions`, {
    label: "Buổi synthetic",
    heldOn: businessDay(new Date(now)),
    location: null,
    scope: "church",
    unitId: null,
    ...extra,
  });
  expect(r.status).toBe(201);
  return r.payload.data.sessionId as string;
}
async function get(c: { id: string }, id: string, subject = owner) {
  const r = await subject.call(`${path(c, subject)}/sessions/${id}`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
async function open(c: { id: string }, id: string, subject = owner) {
  const p = await subject.call(`${path(c, subject)}/sessions/${id}/candidates`);
  expect(p.status).toBe(200);
  const s = await get(c, id, subject);
  const r = await subject.call(
    `${path(c, subject)}/sessions/${id}/open`,
    { previewToken: p.payload.data.previewToken },
    { version: s.version },
  );
  expect(r.status).toBe(200);
  return get(c, id, subject);
}
async function roster(c: { id: string }, id: string, subject = owner, query = "") {
  const r = await subject.call(`${path(c, subject)}/sessions/${id}/participants${query}`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
async function mark(
  c: { id: string },
  id: string,
  memberId: string,
  generation: number,
  version = 1,
  present = true,
  subject = owner,
  key: string = crypto.randomUUID(),
) {
  return subject.call(
    `${path(c, subject)}/sessions/${id}/participants/${memberId}`,
    { present, generation },
    { method: "PATCH", version, key },
  );
}
async function unit(c: { id: string }, name = "Ban synthetic") {
  const r = await owner.call(`owner/churches/${c.id}/organization/units`, {
    kind: "service_ministry",
    name,
  });
  expect(r.status).toBe(201);
  return r.payload.data.unit;
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
describe("P3.1 Attendance real Mongo/Redis", () => {
  test("AC01 default roster includes visitors/children/long absent; manual marks, close and reasoned reopen", async () => {
    const c = await fixture(8);
    await db.db
      .collection("members")
      .updateOne(
        { _id: c.rows[1]?._id },
        { $set: { birthDate: businessDay(), membership: "child", participation: "long_absent" } },
      );
    const id = await session(c),
      s = await open(c, id);
    expect(s.includedCount).toBe(8);
    expect(s.absentCount).toBeNull();
    expect(s.unrecordedCount).toBe(8);
    const p = await roster(c, id);
    expect(p.items.some((v: { type: string }) => v.type === "visitor")).toBe(true);
    expect(p.items.every((v: { status: string }) => v.status === "unrecorded")).toBe(true);
    const m = p.items[0];
    expect((await mark(c, id, m.memberId, s.generation)).status).toBe(200);
    const current = await get(c, id);
    expect(
      (await owner.call(`${path(c)}/sessions/${id}/close`, {}, { version: current.version }))
        .status,
    ).toBe(200);
    const closed = await get(c, id);
    expect(closed.absentCount).toBe(7);
    expect(closed.presentCount).toBe(1);
    expect((await mark(c, id, m.memberId, s.generation, 2, false)).status).toBe(409);
    expect(
      (await owner.call(`${path(c)}/sessions/${id}/reopen`, {}, { version: closed.version }))
        .status,
    ).toBe(422);
    expect(
      (
        await owner.call(
          `${path(c)}/sessions/${id}/reopen`,
          { reason: "Sửa ghi nhận" },
          { version: closed.version },
        )
      ).status,
    ).toBe(200);
    const again = await get(c, id);
    expect(again.presentCount).toBe(1);
    expect(again.generation).toBeGreaterThan(s.generation);
  });
  test("AC02 preview fingerprint, expiry, tenant binding, bounds and future-date guards", async () => {
    const c = await fixture(),
      id = await session(c),
      p = await owner.call(`${path(c)}/sessions/${id}/candidates`);
    const m = c.rows[0];
    expect(
      (
        await owner.call(
          `owner/churches/${c.id}/members/${m?._id}`,
          { fullName: "Đã đổi synthetic" },
          { method: "PATCH", version: 1 },
        )
      ).status,
    ).toBe(200);
    const old = await owner.call(
      `${path(c)}/sessions/${id}/open`,
      { previewToken: p.payload.data.previewToken },
      { version: 1 },
    );
    expect(old.status).toBe(409);
    expect(old.payload.error.code).toBe("ATTENDANCE_PREVIEW_STALE");
    expect(
      await db.db
        .collection("attendance_participants")
        .countDocuments({ sessionId: new ObjectId(id) }),
    ).toBe(0);
    const fresh = await owner.call(`${path(c)}/sessions/${id}/candidates`),
      second = await session(c);
    expect(
      (
        await owner.call(
          `${path(c)}/sessions/${second}/open`,
          { previewToken: fresh.payload.data.previewToken },
          { version: 1 },
        )
      ).status,
    ).toBe(409);
    const clock = now;
    now += 5 * 60_000 + 1;
    try {
      expect(
        (
          await owner.call(
            `${path(c)}/sessions/${id}/open`,
            { previewToken: fresh.payload.data.previewToken },
            { version: 1 },
          )
        ).status,
      ).toBe(409);
    } finally {
      now = clock;
    }
    const future = await session(c, { heldOn: shiftDay(businessDay(), 1) });
    const fp = await owner.call(`${path(c)}/sessions/${future}/candidates`);
    expect(
      (
        await owner.call(
          `${path(c)}/sessions/${future}/open`,
          { previewToken: fp.payload.data.previewToken },
          { version: 1 },
        )
      ).status,
    ).toBe(422);
    const big = await fixture(2001),
      bid = await session(big);
    expect((await owner.call(`${path(big)}/sessions/${bid}/candidates`)).payload.error.code).toBe(
      "ATTENDANCE_ROSTER_LIMIT",
    );
    expect((await get(big, bid)).state).toBe("draft");
  });
  test("AC03 stable keyset/filter summaries and no PII; snapshots survive rename/transfer", async () => {
    const c = await fixture(35),
      id = await session(c),
      s = await open(c, id),
      first = await roster(c, id, owner, "?limit=10");
    const a = first.items[0];
    expect((await mark(c, id, a.memberId, s.generation)).status).toBe(200);
    const next = await roster(
      c,
      id,
      owner,
      `?limit=10&cursor=${encodeURIComponent(first.nextCursor)}`,
    );
    expect(new Set([...first.items, ...next.items].map((v) => v.memberId)).size).toBe(20);
    const none = await roster(c, id, owner, "?q=khongkhop");
    expect(none.items).toHaveLength(0);
    expect(none.session.includedCount).toBe(35);
    expect(none.session.presentCount).toBe(1);
    expect(
      (
        await owner.call(
          `${path(c)}/sessions/${id}/participants?q=khac&cursor=${encodeURIComponent(first.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
    expect(JSON.stringify(first)).not.toMatch(
      /phone|birthDate|consent|familyId|nameTokens|writeFence/,
    );
    const oldName = a.fullName;
    await db.db.collection("members").updateOne(
      { _id: new ObjectId(a.memberId) },
      {
        $set: { fullName: "Đã chuyển synthetic", participation: "transferred" },
        $inc: { version: 1 },
      },
    );
    const kept = await roster(c, id);
    expect(kept.items.find((v: { memberId: string }) => v.memberId === a.memberId)?.fullName).toBe(
      oldName,
    );
    expect(kept.session.includedCount).toBe(35);
  });
  test("AC04 per-row CAS allows independent writes; same row conflict never doubles counts", async () => {
    const c = await fixture(12),
      id = await session(c),
      s = await open(c, id),
      p = await roster(c, id);
    async function reliable(memberId: string, key: string) {
      for (let i = 0; i < 10; i++) {
        const r = await mark(c, id, memberId, s.generation, 1, true, owner, key);
        if (r.status !== 409 || r.payload.error.code !== "OPERATION_IN_PROGRESS") return r;
      }
      throw new Error("Bounded concurrent intent retry exhausted");
    }
    const responses = await Promise.all(
      p.items
        .slice(0, 10)
        .map((m: { memberId: string }) => reliable(m.memberId, crypto.randomUUID())),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect((await get(c, id)).presentCount).toBe(10);
    const target = p.items[10];
    const simultaneous = await Promise.all([
      reliable(target.memberId, crypto.randomUUID()),
      reliable(target.memberId, crypto.randomUUID()),
    ]);
    expect(simultaneous.map((r) => r.status).sort()).toEqual([200, 412]);
    expect((await get(c, id)).presentCount).toBe(11);
    expect(
      await db.db
        .collection("attendance_participants")
        .countDocuments({ sessionId: new ObjectId(id) }),
    ).toBe(12);
    expect(
      (await owner.call(`${path(c)}/sessions/${id}/close`, {}, { version: s.version })).status,
    ).toBe(412);
  });
  test("AC05 reset generation invalidates old ticks; history preserved and add/exclude/reinclude atomic", async () => {
    const c = await fixture(),
      id = await session(c),
      s = await open(c, id),
      p = (await roster(c, id)).items[0];
    expect((await mark(c, id, p.memberId, s.generation)).status).toBe(200);
    let current = await get(c, id);
    expect(
      (
        await owner.call(
          `${path(c)}/sessions/${id}/reset`,
          { reason: "Điểm danh nhầm buổi" },
          { version: current.version },
        )
      ).status,
    ).toBe(200);
    current = await get(c, id);
    expect(current.presentCount).toBe(0);
    const stale = await mark(c, id, p.memberId, s.generation, 3);
    expect(stale.payload.error.code).toBe("ATTENDANCE_SESSION_CHANGED");
    expect((await mark(c, id, p.memberId, current.generation, 3)).status).toBe(200);
    current = await get(c, id);
    const change = (included: boolean, version: number) =>
      owner.call(
        `${path(c)}/sessions/${id}/roster-changes`,
        { memberId: p.memberId, included, reason: "Đối soát danh sách" },
        { version },
      );
    expect((await change(false, current.version)).status).toBe(200);
    current = await get(c, id);
    expect(current.includedCount).toBe(3);
    expect(current.presentCount).toBe(0);
    expect((await mark(c, id, p.memberId, current.generation, 5)).status).toBe(404);
    expect((await change(true, current.version)).status).toBe(200);
    expect((await get(c, id)).includedCount).toBe(4);
    const history = await owner.call(`${path(c)}/sessions/${id}/history`);
    expect(
      history.payload.data.items.some(
        (h: { event: string; before: { presentMemberIds?: string[] } }) =>
          h.event === "reset" && h.before.presentMemberIds?.includes(p.memberId),
      ),
    ).toBe(true);
    await seedP2(db, c.id, ownerId, 2);
    const extra = await db.db.collection("members").findOne({
      churchId: new ObjectId(c.id),
      participation: "active",
      _id: { $nin: c.rows.map((r) => r._id) },
    });
    expect(extra).not.toBeNull();
    current = await get(c, id);
    expect(
      (
        await owner.call(
          `${path(c)}/sessions/${id}/roster-changes`,
          { memberId: extra?._id.toHexString(), included: true, reason: "Bổ sung" },
          { version: current.version },
        )
      ).status,
    ).toBe(200);
    expect((await get(c, id)).rowCount).toBe(5);
  });
  test("AC06 least privilege, dual realm, active unit scope, historic roster and receipt ACL", async () => {
    const c = await fixture(),
      u = await unit(c),
      outside = await unit(c, "Ban ngoài scope");
    await db.db
      .collection("members")
      .updateMany(
        { churchId: new ObjectId(c.id) },
        { $set: { "assignment.unitIds": [new ObjectId(u.id)] } },
      );
    const lead = client("church"),
      other = client("church"),
      sec = client("church"),
      treasurer = client("church"),
      believer = client("church");
    await syntheticUser(owner, lead, c, "ministry_lead", [u.id]);
    await syntheticUser(owner, other, c, "ministry_lead", [outside.id]);
    await syntheticUser(owner, sec, c, "secretary");
    await syntheticUser(owner, treasurer, c, "treasurer");
    await syntheticUser(owner, believer, c, "member");
    const id = await session(c, { scope: "unit", unitId: u.id }, sec),
      s = await open(c, id, sec),
      global = await session(c);
    expect(
      (await lead.call(`${path(c, lead)}/sessions`)).payload.data.items.map(
        (v: { id: string }) => v.id,
      ),
    ).toEqual([id]);
    expect((await other.call(`${path(c, other)}/sessions/${id}`)).status).toBe(404);
    expect((await lead.call(`${path(c, lead)}/sessions/${global}`)).status).toBe(404);
    expect((await treasurer.call(`${path(c, treasurer)}/sessions`)).status).toBe(403);
    expect((await believer.call(`${path(c, believer)}/sessions`)).status).toBe(403);
    expect((await lead.call(`${path(c, lead)}/sessions`, { label: "Không được tạo" })).status).toBe(
      403,
    );
    expect((await lead.call(`${path(c, lead)}/sessions/${id}/history`)).status).toBe(403);
    const mid = c.rows[0]?._id.toHexString() as string,
      r = await mark(c, id, mid, s.generation, 1, true, lead);
    expect(r.status).toBe(200);
    expect(
      (await lead.call(`${path(c, lead)}/operations/${r.payload.data.operationId}`)).status,
    ).toBe(200);
    expect(
      (await sec.call(`${path(c, sec)}/operations/${r.payload.data.operationId}`)).status,
    ).toBe(404);
    expect((await lead.call(`${path(c)}/sessions`)).status).toBe(401);
    const c2 = await fixture(1);
    expect((await sec.call(`${path(c2, sec)}/sessions`)).status).toBe(404);
    await db.db
      .collection("members")
      .updateOne(
        { _id: c.rows[0]?._id },
        { $set: { "assignment.unitIds": [] }, $inc: { version: 1 } },
      );
    expect(
      (await roster(c, id, lead)).items.some((p: { memberId: string }) => p.memberId === mid),
    ).toBe(true);
    expect(
      (
        await owner.call(
          `owner/churches/${c.id}/organization/units/${u.id}/status`,
          { status: "inactive", reason: "Ngừng" },
          { method: "PATCH", version: 1 },
        )
      ).status,
    ).toBe(200);
    expect((await lead.call(`${path(c, lead)}/sessions/${id}`)).status).toBe(404);
    expect(
      (await lead.call(`${path(c, lead)}/operations/${r.payload.data.operationId}`)).status,
    ).toBe(404);
    expect((await owner.call(`${path(c)}/sessions/${id}`)).status).toBe(200);
    expect((await lead.call(`${path(c, lead)}/sessions?unitId=${u.id}`)).status).toBe(404);
  });
  test("AC07 manager downgrade cannot replay management or receipts; lead marks remain scoped", async () => {
    const c = await fixture(),
      u = await unit(c),
      sec = client("church"),
      account = await syntheticUser(owner, sec, c, "secretary"),
      key = crypto.randomUUID();
    const body = {
      label: "Buổi manager",
      heldOn: businessDay(),
      scope: "unit",
      unitId: u.id,
      location: null,
    };
    const made = await sec.call(`${path(c, sec)}/sessions`, body, { key });
    expect(made.status).toBe(201);
    const accountRead = await owner.call(`owner/churches/${c.id}/accounts/${account.id}`);
    expect(
      (
        await owner.call(
          `owner/churches/${c.id}/accounts/${account.id}/permissions`,
          { role: "ministry_lead", scope: { kind: "assigned_units", unitIds: [u.id] } },
          { method: "PATCH", version: accountRead.payload.data.version },
        )
      ).status,
    ).toBe(200);
    expect((await sec.call(`${path(c, sec)}/sessions`, body, { key })).status).toBe(403);
    expect(
      (await sec.call(`${path(c, sec)}/operations/${made.payload.data.operationId}`)).status,
    ).toBe(403);
    expect((await sec.call(`${path(c, sec)}/sessions/${made.payload.data.sessionId}`)).status).toBe(
      200,
    );
  });
  test("AC08 transaction abort rolls back mark, counters, history/audit and ledger", async () => {
    const c = await fixture(),
      id = await session(c),
      s = await open(c, id),
      p = (await roster(c, id)).items[0],
      key = crypto.randomUUID();
    const before = await db.db
      .collection("attendance_history")
      .countDocuments({ sessionId: new ObjectId(id) });
    await db.db.command({
      collMod: "attendance_history",
      validator: { event: { $ne: "marked" } },
      validationAction: "error",
      validationLevel: "strict",
    });
    try {
      expect((await mark(c, id, p.memberId, s.generation, 1, true, owner, key)).status).toBe(503);
      expect((await get(c, id)).presentCount).toBe(0);
      expect((await roster(c, id)).items[0].version).toBe(1);
      expect(
        await db.db
          .collection("attendance_history")
          .countDocuments({ sessionId: new ObjectId(id) }),
      ).toBe(before);
      expect(
        await db.db.collection("idempotency_operations").countDocuments({ keyHash: digest(key) }),
      ).toBe(0);
      expect(
        await db.db
          .collection("audit_events")
          .countDocuments({ targetId: new ObjectId(id), eventType: "attendance.marked" }),
      ).toBe(0);
    } finally {
      await initialize(db.db);
    }
  });
  test("AC09 real committed unknown ack, safe same-key replay and actor-isolated receipt", async () => {
    const c = await fixture(),
      id = await session(c),
      s = await open(c, id),
      p = (await roster(c, id)).items[0],
      key = crypto.randomUUID();
    const start = db.client.startSession.bind(db.client);
    const spy = spyOn(db.client, "startSession").mockImplementation((...args) => {
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
    let r: Awaited<ReturnType<typeof mark>>;
    try {
      r = await mark(c, id, p.memberId, s.generation, 1, true, owner, key);
    } finally {
      spy.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(r.payload.error.code).toBe("OUTCOME_UNKNOWN");
    expect((await owner.call(`${path(c)}/operations/${r.payload.meta.operationId}`)).status).toBe(
      200,
    );
    const replay = await mark(c, id, p.memberId, s.generation, 1, true, owner, key);
    expect(replay.status).toBe(200);
    expect(replay.payload.meta.replayed).toBe(true);
    expect((await get(c, id)).presentCount).toBe(1);
    expect((await mark(c, id, p.memberId, s.generation, 1, false, owner, key)).status).toBe(409);
    expect(
      await db.db
        .collection("attendance_history")
        .countDocuments({ sessionId: new ObjectId(id), event: "marked" }),
    ).toBe(1);
  });
  test("AC10 in-flight snapshot permission revoke is rejected at transaction fence", async () => {
    const c = await fixture(),
      u = await unit(c),
      lead = client("church"),
      account = await syntheticUser(owner, lead, c, "ministry_lead", [u.id]);
    const id = await session(c, { scope: "unit", unitId: u.id });
    await open(c, id);
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((r) => {
        entered = r;
      }),
      released = new Promise<void>((r) => {
        release = r;
      });
    const original = Attendance.prototype.roster;
    const spy = spyOn(Attendance.prototype, "roster").mockImplementation(async function (
      this: Attendance,
      g: AttendanceGrant,
      ...args: [string, URLSearchParams]
    ) {
      const fence = g.fence;
      let attempts = 0;
      return original.call(
        this,
        {
          ...g,
          fence: async (tx) => {
            await db.db
              .collection("accounts")
              .findOne({ _id: new ObjectId(account.id) }, { session: tx });
            if (++attempts === 1) {
              entered();
              await released;
            }
            await fence(tx);
          },
        },
        ...args,
      );
    });
    const reading = lead.call(`${path(c, lead)}/sessions/${id}/participants`);
    await reached;
    spy.mockRestore();
    try {
      const a = await owner.call(`owner/churches/${c.id}/accounts/${account.id}`);
      expect(
        (
          await owner.call(
            `owner/churches/${c.id}/accounts/${account.id}/permissions`,
            { role: "member", scope: { kind: "self" } },
            { method: "PATCH", version: a.payload.data.version },
          )
        ).status,
      ).toBe(200);
    } finally {
      release();
    }
    expect((await reading).status).toBe(401);
  });
  test("AC11 schema constraints and transport validation do not allow spoofed scopes or unsafe writes", async () => {
    const c = await fixture(),
      id = await session(c),
      s = await open(c, id),
      p = (await roster(c, id)).items[0];
    expect((await owner.call(`${path(c)}/sessions/${id}/reset`, { reason: "x" })).status).toBe(428);
    expect(
      (
        await owner.call(
          `${path(c)}/sessions/${id}/close`,
          {},
          { version: s.version, headers: { "x-csrf-token": "wrong" } },
        )
      ).status,
    ).toBe(403);
    expect((await owner.call(`${path(c)}/sessions/${id}/participants?included=bad`)).status).toBe(
      400,
    );
    expect((await owner.call(`${path(c)}/sessions?from=2026-02-30`)).status).toBe(400);
    expect((await owner.call(`${path(c)}/sessions?limit=101`)).status).toBe(400);
    expect(
      (
        await owner.call(
          `${path(c)}/sessions/${id}`,
          { heldOn: businessDay(), reason: "Không đổi ngày sau mở" },
          { method: "PATCH", version: s.version },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await owner.call(
          `${path(c)}/sessions/${id}`,
          { label: "Đổi tên", reason: "Sửa lỗi nhập" },
          { method: "PATCH", version: s.version },
        )
      ).status,
    ).toBe(200);
    await expect(
      db.db
        .collection("attendance_sessions")
        .updateOne({ _id: new ObjectId(id) }, { $set: { presentCount: 999 } }),
    ).rejects.toThrow();
    await expect(
      db.db
        .collection("attendance_participants")
        .updateOne(
          { sessionId: new ObjectId(id), memberId: new ObjectId(p.memberId) },
          { $set: { included: false, present: true } },
        ),
    ).rejects.toThrow();
    expect(JSON.stringify(logs)).not.toMatch(
      /csrfToken|temporaryCredential|passwordHash|0900000000/,
    );
  });
  test("AC12 reset all 2000 marked rows atomically keeps roster and bounded historical snapshot", async () => {
    const c = await fixture(2000),
      id = await session(c),
      s = await open(c, id);
    // Explicit capacity fixture; the command under test is the real reset API.
    await db.transaction(async (tx) => {
      await db.db
        .collection("attendance_participants")
        .updateMany({ sessionId: new ObjectId(id) }, { $set: { present: true } }, { session: tx });
      await db.db
        .collection("attendance_sessions")
        .updateOne({ _id: new ObjectId(id) }, { $set: { presentCount: 2000 } }, { session: tx });
    });
    const r = await owner.call(
      `${path(c)}/sessions/${id}/reset`,
      { reason: "Capacity reset 2000" },
      { version: s.version },
    );
    expect(r.status).toBe(200);
    const after = await get(c, id);
    expect(after.presentCount).toBe(0);
    expect(after.includedCount).toBe(2000);
    expect(after.rowCount).toBe(2000);
    expect(
      await db.db
        .collection("attendance_participants")
        .countDocuments({ sessionId: new ObjectId(id), present: false, version: 2 }),
    ).toBe(2000);
    const history = await db.db
      .collection("attendance_history")
      .findOne({ sessionId: new ObjectId(id), event: "reset" });
    expect(history?.before.presentMemberIds).toHaveLength(2000);
    expect(after.generation).toBe(s.generation + 1);
  });
});
