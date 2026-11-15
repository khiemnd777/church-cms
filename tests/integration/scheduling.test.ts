import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { Audit } from "../../api/audit/service";
import { config } from "../../api/config";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../../api/members/dates";
import type { ScheduleCommand } from "../../api/scheduling/validation";
import {
  SyntheticClient,
  seedP2,
  syntheticChurch,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3473",
  database: `church_cms_test_p41_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw Error("Local synthetic only");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let app: ReturnType<typeof createApp>, owner: SyntheticClient, ownerId: string;
const client = (realm: "owner" | "church" = "owner") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
const root = (c: { id: string }, s = owner) =>
  `${s.realm === "owner" ? "owner/" : ""}churches/${c.id}/scheduling`;
async function fixture() {
  const c = await syntheticChurch(owner, `Lịch synthetic ${crypto.randomUUID()}`);
  await seedP2(db, c.id, ownerId, 8);
  const rows = await db.db
    .collection("members")
    .find({ churchId: new ObjectId(c.id), participation: { $in: ["active", "long_absent"] } })
    .sort({ _id: 1 })
    .toArray();
  const u = await owner.call(`owner/churches/${c.id}/organization/units`, {
    kind: "service_ministry",
    name: "Ban lịch synthetic",
  });
  expect(u.status).toBe(201);
  return { ...c, rows, unit: u.payload.data.unit.id as string };
}
function body(extra: Partial<ScheduleCommand> = {}): ScheduleCommand {
  const day = shiftDay(businessDay(), 30);
  return {
    input: {
      label: "Lịch synthetic",
      kind: "worship",
      scope: "church",
      unitId: null,
      day,
      startTime: "07:30",
      endDay: day,
      endTime: "09:00",
      location: null,
      scripture: "Giăng 15",
      theme: "Đề tài synthetic",
      speaker: null,
      leaderId: null,
      choirId: null,
      communion: true,
      repeat: { kind: "once" },
    },
    state: "scheduled",
    range: "one",
    reason: null,
    preview: null,
    conflictsConfirmed: false,
    exceptionsConfirmed: false,
    ...extra,
  };
}
async function preview(c: { id: string }, b: ScheduleCommand, id?: string, v?: number, s = owner) {
  return s.call(`${root(c, s)}/occurrences${id ? `/${id}` : ""}/preview`, b, { version: v });
}
async function save(
  c: { id: string },
  b: ScheduleCommand,
  id?: string,
  v?: number,
  s = owner,
  key = crypto.randomUUID(),
) {
  const p = await preview(c, b, id, v, s);
  expect(p.status).toBe(200);
  const intent = { ...b, preview: p.payload.data.context };
  const r = await s.call(`${root(c, s)}/occurrences${id ? `/${id}` : ""}`, intent, {
    method: id ? "PATCH" : "POST",
    version: v,
    key,
  });
  return { ...r, intent, key };
}
async function get(c: { id: string }, id: string, s = owner) {
  const r = await s.call(`${root(c, s)}/occurrences/${id}`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
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
describe("P4.1 real Mongo Redis HTTP", () => {
  test("preview required; once snapshots, multiple same-day services; no Attendance/Rites writes", async () => {
    const c = await fixture(),
      b = body();
    b.input.speaker = { source: "member", memberId: c.rows[0]?._id.toHexString() as string };
    b.input.leaderId = c.rows[1]?._id.toHexString() as string;
    b.input.choirId = c.unit;
    expect((await owner.call(`${root(c)}/occurrences`, b)).status).toBe(412);
    const r = await save(c, b);
    expect(r.status).toBe(201);
    const d = await get(c, r.payload.data.occurrenceId);
    expect(d.speakerName).toBe(c.rows[0]?.fullName);
    expect(d.choirName).toBe("Ban lịch synthetic");
    expect(d.input.communion).toBe(true);
    const b2 = structuredClone(b);
    b2.input.startTime = "17:00";
    b2.input.endTime = "18:30";
    expect((await save(c, b2)).status).toBe(201);
    expect(
      (await owner.call(`${root(c)}/occurrences?from=${b.input.day}&to=${b.input.day}`)).payload
        .data.items.length,
    ).toBe(2);
    for (const n of ["attendance_sessions", "rite_records"])
      expect(await db.db.collection(n).countDocuments({ churchId: new ObjectId(c.id) })).toBe(0);
    const h = await owner.call(`${root(c)}/occurrences/${d.id}/history`);
    expect(h.payload.data.items[0].after.speakerName).toBe(d.speakerName);
  });
  test("weekly generation, one exception, future replacement confirmation and cancellation history", async () => {
    const c = await fixture(),
      b = body();
    const weekday = new Date(`${b.input.day}T00:00:00Z`).getUTCDay();
    b.input.repeat = {
      kind: "weekly",
      interval: 1,
      weekdays: [weekday],
      until: shiftDay(b.input.day, 28),
    };
    const made = await save(c, b);
    expect(made.status).toBe(201);
    const rows = (
      await owner.call(`${root(c)}/occurrences?from=${b.input.day}&to=${shiftDay(b.input.day, 35)}`)
    ).payload.data.items;
    expect(rows.length).toBe(5);
    const one = rows[2],
      changed = {
        ...b,
        input: { ...one.input, label: "Ngoại lệ synthetic" },
        reason: "Chỉnh riêng",
      };
    const edit = await save(c, changed, one.id, one.version);
    expect(edit.status).toBe(200);
    expect((await get(c, one.id)).exception).toBe(true);
    const future = {
      ...b,
      range: "future" as const,
      reason: "Đổi chuỗi",
      input: {
        ...rows[1].input,
        repeat: {
          kind: "weekly" as const,
          interval: 1,
          weekdays: [weekday],
          until: shiftDay(b.input.day, 28),
        },
      },
    };
    const p = await preview(c, future, rows[1].id, 1);
    expect(p.payload.data.exceptions).toBe(1);
    expect(p.payload.data.cancelled.length).toBe(4);
    expect(
      (
        await owner.call(
          `${root(c)}/occurrences/${rows[1].id}`,
          { ...future, preview: p.payload.data.context },
          { method: "PATCH", version: 1 },
        )
      ).payload.error.code,
    ).toBe("SCHEDULE_EXCEPTION_CONFIRMATION");
    const f = await save(c, { ...future, exceptionsConfirmed: true }, rows[1].id, 1);
    expect(f.status).toBe(200);
    expect((await get(c, rows[0].id)).state).toBe("scheduled");
    expect((await get(c, one.id)).state).toBe("cancelled");
    const fresh = await get(c, f.payload.data.occurrenceId);
    expect(fresh.generation).toBe(2);
    expect(
      (
        await save(
          c,
          { ...b, input: fresh.input, state: "cancelled", reason: "Hủy lịch" },
          fresh.id,
          fresh.version,
        )
      ).status,
    ).toBe(200);
    expect((await preview(c, { ...b, input: fresh.input }, fresh.id, 2)).payload.error.code).toBe(
      "SCHEDULE_CANCELLED",
    );
  });
  test("conflict warnings require confirm+reason, adjacent does not conflict and external names are not identities", async () => {
    const c = await fixture(),
      b = body();
    b.input.leaderId = c.rows[0]?._id.toHexString() as string;
    expect((await save(c, b)).status).toBe(201);
    const p = await preview(c, b);
    expect(p.payload.data.conflicts.length).toBe(1);
    expect((await save(c, b)).payload.error.code).toBe("SCHEDULE_CONFLICT_CONFIRMATION");
    expect(
      (await save(c, { ...b, conflictsConfirmed: true, reason: "Cố ý phân công" })).status,
    ).toBe(201);
    const adjacent = structuredClone(b);
    adjacent.input.startTime = "09:00";
    adjacent.input.endTime = "10:00";
    expect((await preview(c, adjacent)).payload.data.conflicts.length).toBe(0);
    const external = body();
    external.input.speaker = { source: "external", fullName: "Khách synthetic" };
    expect((await save(c, external)).status).toBe(201);
    expect((await preview(c, external)).payload.data.conflicts.length).toBe(0);
  });
  test("calendar revision invalidates preview and cursor; stale ETag cannot overwrite", async () => {
    const c = await fixture(),
      b = body(),
      p = await preview(c, b);
    const r = await save(c, b);
    expect(r.status).toBe(201);
    expect(
      (await owner.call(`${root(c)}/occurrences`, { ...b, preview: p.payload.data.context }))
        .payload.error.code,
    ).toBe("SCHEDULE_PREVIEW_STALE");
    const b2 = { ...b, input: { ...b.input, label: "Khác" } };
    expect((await save(c, b2)).status).toBe(201);
    const list = await owner.call(`${root(c)}/occurrences?from=${b.input.day}&limit=1`);
    expect(list.payload.data.nextCursor).toBeString();
    const d = await get(c, r.payload.data.occurrenceId),
      changed = { ...b, input: { ...d.input, label: "Đính chính" }, reason: "Sửa" };
    expect((await save(c, changed, d.id, d.version)).status).toBe(200);
    expect((await preview(c, changed, d.id, d.version)).status).toBe(412);
    expect(
      (
        await owner.call(
          `${root(c)}/occurrences?from=${b.input.day}&limit=1&cursor=${encodeURIComponent(list.payload.data.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
  });
  test("exact replay and receipt; changed payload conflicts and no duplicate rows/history", async () => {
    const c = await fixture(),
      b = body(),
      r = await save(c, b);
    expect(r.status).toBe(201);
    const replay = await owner.call(`${root(c)}/occurrences`, r.intent, { key: r.key });
    expect(replay.status).toBe(200);
    expect(replay.payload.meta.replayed).toBe(true);
    expect(
      (await owner.call(`${root(c)}/occurrences`, { ...r.intent, reason: "Khác" }, { key: r.key }))
        .status,
    ).toBe(409);
    expect((await owner.call(`${root(c)}/operations/${r.payload.data.operationId}`)).status).toBe(
      200,
    );
    expect(
      await db.db
        .collection("schedule_occurrences")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
    expect(
      await db.db.collection("schedule_history").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
  });
  test("two concurrent inserts cannot bypass overlap preview", async () => {
    const c = await fixture(),
      b = body();
    b.input.leaderId = c.rows[0]?._id.toHexString() as string;
    const p1 = await preview(c, b),
      p2 = await preview(c, b);
    const results = await Promise.all(
      [p1, p2].map((p) =>
        owner.call(`${root(c)}/occurrences`, { ...b, preview: p.payload.data.context }),
      ),
    );
    expect(results.filter((r) => r.status === 201).length).toBe(1);
    expect(results.every((r) => [201, 409, 412].includes(r.status))).toBe(true);
    expect((await preview(c, b)).payload.data.conflicts.length).toBe(1);
  });
  test("history/audit/ledger failure rolls back domain and calendar revision", async () => {
    const c = await fixture(),
      b = body(),
      p = await preview(c, b);
    const fail = spyOn(Audit.prototype, "organization").mockRejectedValueOnce(
      new Error("synthetic audit failure"),
    );
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await owner.call(`${root(c)}/occurrences`, { ...b, preview: p.payload.data.context });
    } finally {
      fail.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(
      await db.db
        .collection("schedule_occurrences")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
    expect(
      await db.db.collection("schedule_state").countDocuments({ _id: new ObjectId(c.id) }),
    ).toBe(0);
  });
  test("role/scope, active unit, hidden draft/history/pickers and cross-tenant IDs", async () => {
    const c = await fixture(),
      other = await fixture(),
      b = body();
    b.input.scope = "unit";
    b.input.unitId = c.unit;
    const made = await save(c, b),
      id = made.payload.data.occurrenceId;
    const own = client("church"),
      staff = await syntheticUser(owner, own, c, "secretary"),
      lead = client("church");
    await syntheticUser(owner, lead, c, "ministry_lead", [c.unit]);
    expect((await get(c, id, lead)).id).toBe(id);
    expect(
      (await lead.call(`${root(c, lead)}/occurrences?from=${b.input.day}`)).payload.data.items
        .length,
    ).toBe(1);
    for (const suffix of [
      "people",
      "units",
      `occurrences/${id}/history`,
      `operations/${made.payload.data.operationId}`,
    ])
      expect((await lead.call(`${root(c, lead)}/${suffix}`)).status).toBe(403);
    expect((await preview(c, b, undefined, undefined, lead)).status).toBe(403);
    const draft = await save(c, { ...b, state: "draft" });
    expect(
      (await lead.call(`${root(c, lead)}/occurrences/${draft.payload.data.occurrenceId}`)).status,
    ).toBe(404);
    const unrelated = body();
    expect((await save(c, unrelated)).status).toBe(201);
    expect(
      (await lead.call(`${root(c, lead)}/occurrences?from=${b.input.day}`)).payload.data.items
        .length,
    ).toBe(1);
    expect((await own.call(`${root(other, own)}/occurrences/${id}`)).status).toBe(404);
    for (const role of ["treasurer", "member"]) {
      const s = client("church");
      await syntheticUser(owner, s, c, role);
      expect((await s.call(`${root(c, s)}/occurrences`)).status).toBe(403);
    }
    const r = await save(c, body(), undefined, undefined, own);
    expect(r.status).toBe(201);
    await db.db.collection("accounts").updateOne(
      { _id: new ObjectId(staff.id) },
      {
        $set: {
          role: "ministry_lead",
          scope: { kind: "assigned_units", unitIds: [c.unit] },
        },
        $inc: { version: 1 },
      },
    );
    expect(
      (await own.call(`${root(c, own)}/operations/${r.payload.data.operationId}`)).status,
    ).toBe(403);
    expect((await own.call(`${root(c, own)}/occurrences`, r.intent, { key: r.key })).status).toBe(
      403,
    );
    await db.db
      .collection("organization_units")
      .updateOne(
        { _id: new ObjectId(c.unit) },
        { $set: { status: "inactive" }, $inc: { version: 1 } },
      );
    expect(
      (await lead.call(`${root(c, lead)}/occurrences?from=${b.input.day}`)).payload.data.items
        .length,
    ).toBe(0);
    expect((await lead.call(`${root(c, lead)}/occurrences/${id}`)).status).toBe(404);
  });
  test("new identities checked in same tenant; snapshots preserved; inputs strict and CSRF enforced", async () => {
    const c = await fixture(),
      other = await fixture(),
      b = body();
    b.input.speaker = { source: "member", memberId: other.rows[0]?._id.toHexString() as string };
    expect((await preview(c, b)).status).toBe(422);
    b.input.speaker = { source: "member", memberId: c.rows[0]?._id.toHexString() as string };
    const made = await save(c, b);
    expect(made.status).toBe(201);
    await db.db
      .collection("members")
      .updateOne(
        { _id: c.rows[0]?._id },
        { $set: { fullName: "Tên đã đổi", participation: "transferred" }, $inc: { version: 1 } },
      );
    expect((await get(c, made.payload.data.occurrenceId)).speakerName).toBe(c.rows[0]?.fullName);
    expect((await preview(c, b)).status).toBe(422);
    expect(
      (await owner.call(`${root(c)}/occurrences/preview`, { ...body(), extra: true })).status,
    ).toBe(422);
    expect(
      (
        await owner.call(`${root(c)}/occurrences/preview`, body(), {
          headers: { origin: "https://elsewhere.test" },
        })
      ).status,
    ).toBe(403);
    expect((await owner.call(`${root(c)}/occurrences?limit=101`)).status).toBe(400);
    expect((await owner.call(`${root(c)}/occurrences?from=bad`)).status).toBe(400);
    expect((await owner.call(`${root(c)}/occurrences?secret=true`)).status).toBe(400);
  });
  test("past correction only, original slot stays and future regeneration preserves past", async () => {
    const c = await fixture(),
      b = body(),
      r = await save(c, b),
      id = r.payload.data.occurrenceId,
      day = shiftDay(businessDay(), -1);
    await db.db.collection("schedule_occurrences").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          startAt: new Date(`${day}T07:30:00+07:00`),
          endAt: new Date(`${day}T09:00:00+07:00`),
          "input.day": day,
          "input.endDay": day,
        },
      },
    );
    const d = await get(c, id),
      correction = {
        ...b,
        input: { ...d.input, label: "Đính chính quá khứ" },
        reason: "Bổ sung nội dung",
      };
    expect((await save(c, correction, id, d.version)).status).toBe(200);
    expect(
      (
        await preview(
          c,
          { ...correction, input: { ...correction.input, startTime: "08:00" } },
          id,
          2,
        )
      ).payload.error.code,
    ).toBe("SCHEDULE_PAST_LOCKED");
    expect((await preview(c, { ...correction, range: "future" }, id, 2)).status).toBe(422);
  });
  test("caps and schema constraints, zero domain mutations on rejected expansion", async () => {
    const c = await fixture(),
      b = body();
    b.input.repeat = {
      kind: "weekly",
      interval: 1,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      until: shiftDay(b.input.day, 250),
    };
    expect((await preview(c, b)).payload.error.code).toBe("SCHEDULE_OCCURRENCE_LIMIT");
    expect(
      await db.db.collection("schedule_series").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(0);
    b.input.repeat = { kind: "once" };
    const r = await save(c, b);
    const raw = await db.db
      .collection("schedule_occurrences")
      .findOne({ _id: new ObjectId(r.payload.data.occurrenceId) });
    expect(raw).not.toBeNull();
    if (!raw) throw Error("fixture");
    await expect(
      db.db.collection("schedule_occurrences").insertOne({ ...raw, _id: new ObjectId() }),
    ).rejects.toThrow();
    await expect(
      db.db
        .collection("schedule_occurrences")
        .updateOne({ _id: raw._id }, { $set: { endAt: raw.startAt } }),
    ).rejects.toThrow();
  });
  test("real committed acknowledgement loss recovers through exact receipt and replay", async () => {
    const c = await fixture(),
      b = body(),
      p = await preview(c, b),
      intent = { ...b, preview: p.payload.data.context },
      key = crypto.randomUUID(),
      start = db.client.startSession.bind(db.client);
    const spy = spyOn(db.client, "startSession").mockImplementation((...args) => {
      const tx = start(...args),
        commit = tx.commitTransaction.bind(tx);
      tx.commitTransaction = async () => {
        await commit();
        const error = new MongoError("Synthetic ack loss");
        error.addErrorLabel("UnknownTransactionCommitResult");
        throw error;
      };
      return tx;
    });
    let lost: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      lost = await owner.call(`${root(c)}/occurrences`, intent, { key });
    } finally {
      spy.mockRestore();
    }
    expect(lost.status).toBe(503);
    expect(lost.payload.error.code).toBe("OUTCOME_UNKNOWN");
    expect(
      (await owner.call(`${root(c)}/operations/${lost.payload.meta.operationId}`)).status,
    ).toBe(200);
    expect((await owner.call(`${root(c)}/occurrences`, intent, { key })).status).toBe(200);
    expect(
      await db.db
        .collection("schedule_occurrences")
        .countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
    expect(
      await db.db.collection("schedule_history").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
  });
  test("200 occurrences accepted atomically, 201 rejected; page traversal and Vietnam Sundays", async () => {
    const c = await fixture(),
      b = body(),
      weekday = new Date(`${b.input.day}T00:00:00Z`).getUTCDay();
    b.state = "draft";
    b.input.repeat = {
      kind: "weekly",
      interval: 1,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      until: shiftDay(b.input.day, 199),
    };
    const r = await save(c, b);
    expect(r.status).toBe(201);
    expect(r.payload.data.changed).toBe(200);
    const over = {
      ...b,
      input: { ...b.input, repeat: { ...b.input.repeat, until: shiftDay(b.input.day, 200) } },
    };
    expect((await preview(c, over)).payload.error.code).toBe("SCHEDULE_OCCURRENCE_LIMIT");
    let cursor = "";
    const seen = new Set<string>();
    do {
      const page = await owner.call(
        `${root(c)}/occurrences?from=${b.input.day}&to=${shiftDay(b.input.day, 91)}&limit=17${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(page.status).toBe(200);
      for (const row of page.payload.data.items) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = page.payload.data.nextCursor ?? "";
    } while (cursor);
    expect(seen.size).toBe(92);
    const sunday = await owner.call(
      `${root(c)}/occurrences?from=${b.input.day}&to=${shiftDay(b.input.day, 41)}&sundays=true`,
    );
    expect(sunday.status).toBe(200);
    expect(sunday.payload.data.items.length).toBe(6);
    expect(
      sunday.payload.data.items.every(
        (r: { input: { day: string } }) => new Date(`${r.input.day}T00:00:00Z`).getUTCDay() === 0,
      ),
    ).toBe(true);
    expect(weekday).toBeGreaterThanOrEqual(0);
  });
  test("future replacement keeps started rows and monthly public expansion", async () => {
    const c = await fixture(),
      b = body();
    const weekday = new Date(`${b.input.day}T00:00:00Z`).getUTCDay();
    b.input.repeat = {
      kind: "weekly",
      interval: 1,
      weekdays: [weekday],
      until: shiftDay(b.input.day, 21),
    };
    expect((await save(c, b)).status).toBe(201);
    const rows = (
      await owner.call(`${root(c)}/occurrences?from=${b.input.day}&to=${shiftDay(b.input.day, 28)}`)
    ).payload.data.items;
    await db.db.collection("schedule_occurrences").updateOne(
      { _id: new ObjectId(rows[2].id) },
      {
        $set: { startAt: new Date(Date.now() - 7200000), endAt: new Date(Date.now() - 3600000) },
      },
    );
    const f = { ...b, input: rows[1].input, range: "future" as const, reason: "Sửa tương lai" };
    const p = await preview(c, f, rows[1].id, 1);
    expect(p.payload.data.cancelled.map((r: { id: string }) => r.id)).not.toContain(rows[2].id);
    expect((await save(c, f, rows[1].id, 1)).status).toBe(200);
    expect((await get(c, rows[2].id)).version).toBe(1);
    const monthly = body();
    monthly.input.repeat = {
      kind: "monthly",
      weekday: 0,
      ordinals: [2, 4],
      until: shiftDay(monthly.input.day, 80),
    };
    const mp = await preview(c, monthly);
    expect(mp.status).toBe(200);
    expect(mp.payload.data.created.length).toBeGreaterThan(0);
    expect((await save(c, monthly)).status).toBe(201);
  });
  test("cancelled one-off exception cannot be silently resurrected by future regeneration", async () => {
    const c = await fixture(),
      b = body(),
      weekday = new Date(`${b.input.day}T00:00:00Z`).getUTCDay();
    b.input.repeat = {
      kind: "weekly",
      interval: 1,
      weekdays: [weekday],
      until: shiftDay(b.input.day, 21),
    };
    expect((await save(c, b)).status).toBe(201);
    const rows = (
      await owner.call(`${root(c)}/occurrences?from=${b.input.day}&to=${shiftDay(b.input.day, 28)}`)
    ).payload.data.items;
    const cancel = {
      ...b,
      input: rows[2].input,
      state: "cancelled" as const,
      reason: "Nghỉ riêng một tuần",
    };
    expect((await save(c, cancel, rows[2].id, 1)).status).toBe(200);
    const cancelled = await get(c, rows[2].id);
    expect(cancelled.exception).toBe(true);
    expect(cancelled.superseded).toBe(false);
    const future = {
      ...b,
      input: rows[0].input,
      range: "future" as const,
      reason: "Đổi lịch tương lai",
    };
    const p = await preview(c, future, rows[0].id, 1);
    expect(p.payload.data.exceptions).toBe(1);
    expect(p.payload.data.exceptionsItems[0].id).toBe(rows[2].id);
    expect(p.payload.data.exceptionsItems[0].state).toBe("cancelled");
    const denied = await owner.call(
      `${root(c)}/occurrences/${rows[0].id}`,
      { ...future, preview: p.payload.data.context },
      { version: 1, method: "PATCH" },
    );
    expect(denied.payload.error.code).toBe("SCHEDULE_EXCEPTION_CONFIRMATION");
    expect((await get(c, rows[2].id)).superseded).toBe(false);
    const accepted = await save(c, { ...future, exceptionsConfirmed: true }, rows[0].id, 1);
    expect(accepted.status).toBe(200);
    expect((await get(c, rows[2].id)).superseded).toBe(true);
    const active = (
      await owner.call(
        `${root(c)}/occurrences?from=${b.input.day}&to=${shiftDay(b.input.day, 28)}&state=scheduled`,
      )
    ).payload.data.items;
    expect(active.length).toBe(4);
    const next = await preview(c, { ...future, input: active[0].input }, active[0].id, 1);
    expect(next.payload.data.exceptions).toBe(0);
    const history = await owner.call(`${root(c)}/occurrences/${rows[2].id}/history`);
    expect(history.payload.data.items[0].event).toBe("superseded");
  });
});
