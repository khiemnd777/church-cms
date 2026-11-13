import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { Audit } from "../../api/audit/service";
import { config } from "../../api/config";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../../api/members/dates";
import { RiteReporting } from "../../api/rites/reporting";
import type { RiteCommand } from "../../api/rites/validation";
import {
  localOnly,
  SyntheticClient,
  syntheticChurch,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";
import { riteFixture } from "../../scripts/p35-fixtures";
import { p36Session, seedP36 } from "../../scripts/p36-fixtures";
import { p36Workflow } from "../../scripts/p36-workflow";

const conf = {
  ...config(),
  origin: "https://localhost:3471",
  database: `church_cms_test_p36_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
localOnly(conf);
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let app: ReturnType<typeof createApp>, owner: SyntheticClient, actor: { id: string };
const logs: object[] = [];
const client = (realm: "owner" | "church" = "owner") =>
  new SyntheticClient(realm, conf.origin, (req) => app(req, { ip: crypto.randomUUID() }));
const base = (c: { id: string }, s = owner) =>
  `${s.realm === "owner" ? "owner/" : ""}churches/${c.id}`;
async function fixture(count = 6, dates = 4) {
  const c = await syntheticChurch(owner);
  return { ...c, ...(await seedP36(db, owner, c, actor.id, count, dates)) };
}
async function overview(c: { id: string }, s = owner) {
  const r = await s.call(`${base(c, s)}/overview`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
const sessionPath = (c: { id: string }, id: string) => `${base(c)}/attendance/sessions/${id}`;
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  owner = client();
  actor = await syntheticOwner(db, owner);
});
afterAll(async () => {
  await db.db.dropDatabase();
  expect(
    (await db.client.db("admin").admin().listDatabases()).databases.some(
      (d) => d.name === conf.database,
    ),
  ).toBe(false);
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
describe("P3.6 real reporting/reference/filter source contracts", () => {
  test("explicit reference, legacy general, Sunday/non-prep constraints and unique concurrent selection", async () => {
    const c = await fixture(3, 0),
      until = c.until;
    const legacy = await p36Session(owner, c.id, until);
    expect((await overview(c)).attendance.value).toBeNull();
    const create = (heldOn: string, scope = "church", unitId: string | null = null) =>
      owner.call(`${base(c)}/attendance/sessions`, {
        label: "Reference synthetic",
        heldOn,
        location: null,
        scope,
        unitId,
        reportingKind: "sunday_reference",
      });
    expect((await create(shiftDay(until, -1))).status).toBe(422);
    const results = await Promise.all([create(until), create(until)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    const duplicate = await create(until);
    expect(duplicate.payload.error.code).toBe("ATTENDANCE_REFERENCE_EXISTS");
    const s = (await owner.call(sessionPath(c, legacy.id))).payload.data;
    expect(
      (
        await owner.call(
          sessionPath(c, legacy.id),
          { reportingKind: "sunday_reference", reason: "Đối chiếu" },
          { method: "PATCH", version: s.version },
        )
      ).payload.error.code,
    ).toBe("ATTENDANCE_REFERENCE_REASON");
    const rows = await db.db
      .collection("attendance_sessions")
      .find({ churchId: new ObjectId(c.id), reportingKind: "sunday_reference" })
      .toArray();
    expect(rows).toHaveLength(1);
    await expect(
      db.db.collection("attendance_sessions").insertOne({ ...rows[0], _id: new ObjectId() }),
    ).rejects.toMatchObject({ code: 11000 });
  });
  test("closed snapshot counts/all ages/visitor source, delta, complete average4 and empty zero distinguish missing", async () => {
    const c = await fixture(6, 4),
      d = await overview(c);
    expect(d.attendance.value).toBe(3);
    expect(d.attendance.latest.included).toBe(6);
    expect(d.attendance.latest.rate).toBe(50);
    expect(d.attendance.delta).toBe(0);
    expect(d.attendance.average4).toBe(3);
    expect(d.attendance.coverage4).toBe(4);
    expect(
      d.attendance.days.slice(0, 8).every((x: { present: number | null }) => x.present === null),
    ).toBe(true);
    const first = c.rows[0];
    if (!first) throw Error();
    await db.db
      .collection("members")
      .updateOne(
        { _id: first._id },
        { $set: { type: "visitor", birthDate: businessDay(), participation: "deceased" } },
      );
    const next = await overview(c);
    expect(next.attendance.value).toBe(3);
    expect(next.attendance.latest.included).toBe(6);
    expect(next.attendance.latest.visitors).toBe(d.attendance.latest.visitors);
    const empty = await fixture(1, 0);
    await db.db
      .collection("members")
      .updateMany({ churchId: new ObjectId(empty.id) }, { $set: { participation: "deceased" } });
    await p36Session(owner, empty.id, empty.until, { reportingKind: "sunday_reference" });
    const e = await overview(empty);
    expect(e.attendance.value).toBe(0);
    expect(e.attendance.latest.rate).toBeNull();
    expect(e.attendance.average4).toBeNull();
  });
  test("three calendar absences, pending/missing/outside not absences; profile rename does not rewrite slots", async () => {
    const c = await fixture(4, 4),
      target = c.rows[3];
    if (!target) throw Error();
    const member = (await owner.call(`${base(c)}/members/${target._id}`)).payload.data;
    expect(member.attendance.eligible).toBe(4);
    expect(member.attendance.present).toBe(0);
    expect(member.attendance.absent3).toBe(true);
    expect((await overview(c)).attendance.absent3).toBe(2);
    const last = c.sessions.at(-1);
    if (!last) throw Error();
    const path = sessionPath(c, last.id),
      s = (await owner.call(path)).payload.data;
    expect(
      (await owner.call(`${path}/reopen`, { reason: "Rà soát synthetic" }, { version: s.version }))
        .status,
    ).toBe(200);
    const pending = (await owner.call(`${base(c)}/members/${target._id}`)).payload.data.attendance;
    expect(pending.days.at(-1).status).toBe("pending");
    expect(pending.absent3).toBe(false);
    expect((await overview(c)).attendance.value).toBeNull();
    const opened = (await owner.call(path)).payload.data;
    expect(
      (
        await owner.call(
          `${path}/roster-changes`,
          { memberId: target._id.toHexString(), included: false, reason: "Không thuộc danh sách" },
          { version: opened.version },
        )
      ).status,
    ).toBe(200);
    const current = (await owner.call(path)).payload.data;
    expect((await owner.call(`${path}/close`, {}, { version: current.version })).status).toBe(200);
    const outside = (await owner.call(`${base(c)}/members/${target._id}`)).payload.data.attendance;
    expect(outside.days.at(-1).status).toBe("outside");
    expect(outside.eligible).toBe(3);
    expect(outside.absent3).toBe(false);
  });
  test("absent3 list/summary/export use same source, cursor rejects reference change, export preview source-bound", async () => {
    const c = await fixture(6, 4),
      filter = { attendance: "absent3", attendanceUntil: c.until },
      q = new URLSearchParams({ ...filter, limit: "1" });
    const list = await owner.call(`${base(c)}/members?${q}`);
    expect(list.status).toBe(200);
    expect(list.payload.data.items).toHaveLength(1);
    expect(list.payload.data.nextCursor).toBeTruthy();
    const count = await owner.call(`${base(c)}/members/summary?${new URLSearchParams(filter)}`);
    expect(count.payload.data.all).toBe(3);
    const request = { filters: filter, columns: ["code", "fullName"], format: "xlsx" };
    const p = await owner.call(`${base(c)}/data-exchange/exports/preview`, request);
    expect(p.status).toBe(200);
    expect(p.payload.data.count).toBe(3);
    const last = c.sessions.at(-1);
    if (!last) throw Error();
    const path = sessionPath(c, last.id),
      s = (await owner.call(path)).payload.data;
    expect(
      (
        await owner.call(
          path,
          { reportingKind: "general", referenceConfirmed: true, reason: "Đổi nguồn báo cáo" },
          { method: "PATCH", version: s.version },
        )
      ).status,
    ).toBe(200);
    const cursor = await owner.call(
      `${base(c)}/members?${q}&cursor=${encodeURIComponent(list.payload.data.nextCursor)}`,
    );
    expect(cursor.payload.error.code).toBe("CURSOR_CONTEXT_MISMATCH");
    expect(
      (
        await owner.call(`${base(c)}/data-exchange/exports`, {
          ...request,
          previewToken: p.payload.data.previewToken,
        })
      ).payload.error.code,
    ).toBe("IMPORT_PREVIEW_STALE");
    expect(
      (await owner.call(`${base(c)}/members/summary?${new URLSearchParams(filter)}`)).payload.data
        .all,
    ).toBe(0);
    expect(
      (
        await owner.call(
          `${base(c)}/members?attendance=absent3&attendanceUntil=${shiftDay(c.until, -1)}`,
        )
      ).status,
    ).toBe(400);
  });
  test("reasoned selection rollback, actual lost commit acknowledgement and replay once", async () => {
    const c = await fixture(2, 0),
      made = await p36Session(owner, c.id, c.until),
      path = sessionPath(c, made.id),
      s = (await owner.call(path)).payload.data,
      body = {
        reportingKind: "sunday_reference",
        referenceConfirmed: true,
        reason: "Chọn nguồn synthetic",
      };
    const audit = spyOn(Audit.prototype, "organization").mockRejectedValueOnce(
      new Error("Synthetic audit failure"),
    );
    try {
      expect((await owner.call(path, body, { method: "PATCH", version: s.version })).status).toBe(
        503,
      );
    } finally {
      audit.mockRestore();
    }
    expect((await owner.call(path)).payload.data.reportingKind).toBe("general");
    const session = db.client.startSession(),
      proto = Object.getPrototypeOf(session),
      original = proto.commitTransaction;
    await session.endSession();
    let fired = false;
    const spy = spyOn(proto, "commitTransaction").mockImplementation(async function (this: {
      commitTransaction: unknown;
    }) {
      await original.call(this);
      if (!fired) {
        fired = true;
        const e = new MongoError("Synthetic lost acknowledgement");
        e.addErrorLabel("UnknownTransactionCommitResult");
        throw e;
      }
    });
    const key = crypto.randomUUID();
    try {
      const r = await owner.call(path, body, { method: "PATCH", version: s.version, key });
      expect([200, 503]).toContain(r.status);
    } finally {
      spy.mockRestore();
    }
    expect(fired).toBe(true);
    const replay = await owner.call(path, body, { method: "PATCH", version: s.version, key });
    expect(replay.status).toBe(200);
    expect(replay.payload.meta.replayed).toBe(true);
    expect((await overview(c)).attendance.latest.sessionId).toBe(made.id);
    expect(
      await db.db
        .collection("attendance_history")
        .countDocuments({ sessionId: new ObjectId(made.id), event: "metadata_changed" }),
    ).toBe(1);
  });
  test("W04 uses weighted last four own-unit closed snapshots, stable after current assignment changes", async () => {
    const c = await fixture(6, 0),
      churchId = new ObjectId(c.id),
      area = (
        await owner.call(`${base(c)}/organization/units`, {
          kind: "area",
          name: "Khu vực synthetic P36",
        })
      ).payload.data.unit;
    if (!area) throw Error();
    await db.db
      .collection("families")
      .updateMany({ churchId }, { $set: { areaId: new ObjectId(area.id) } });
    for (let i = 0; i < 5; i++)
      await p36Session(
        owner,
        c.id,
        shiftDay(businessDay(), -5 + i),
        { scope: "unit", unitId: area.id },
        c.rows.slice(0, i === 0 ? 6 : i - 1).map((m) => m._id.toHexString()),
      );
    const overview = await owner.call(`${base(c)}/organization/overview?kind=area`);
    expect(overview.status).toBe(200);
    const unit = overview.payload.data.items.find((u: { id: string }) => u.id === area.id);
    expect(unit.attendance.sessions).toBe(4);
    expect(unit.attendance.present).toBe(6);
    expect(unit.attendance.included).toBe(24);
    expect(unit.attendance.value).toBe(25);
    await db.db.collection("families").updateMany({ churchId }, { $set: { areaId: null } });
    const next = (
      await owner.call(`${base(c)}/organization/overview?kind=area`)
    ).payload.data.items.find((u: { id: string }) => u.id === area.id);
    expect(next.attendance.value).toBe(25);
  });
  test("public QR/classes/rites/certificate workflow reconciles reporting without inferring eligibility", async () => {
    const c = await fixture(4, 0),
      m = c.rows.find((r) => r.type === "believer");
    if (!m) throw Error();
    const result = await p36Workflow(owner, c, m._id.toHexString());
    expect(result.checks.length).toBeGreaterThan(15);
    const d = await overview(c);
    expect(d.attendance.value).toBe(1);
    expect(d.rites.value).toBe(1);
    expect(d.classes.courses).toBe(1);
    const old = (await owner.call(`${base(c)}/attendance/sessions/${result.classSessionId}`))
      .payload.data;
    expect(
      (
        await owner.call(
          `${base(c)}/attendance/sessions/${result.classSessionId}`,
          { reportingKind: "sunday_reference", referenceConfirmed: true, reason: "Không hợp lệ" },
          { method: "PATCH", version: old.version },
        )
      ).status,
    ).toBe(422);
  });
  test("annual rites count four recorded kinds, marriage once, unknown dates separately and Communion only as a recorded marker", async () => {
    const c = await fixture(4, 0),
      member = c.rows.find((r) => r.type === "believer");
    if (!member) throw Error();
    const id = member._id.toHexString(),
      prefix = `${base(c)}/rites/records`,
      save = async (body: RiteCommand) => {
        const preview = await owner.call(`${prefix}/preview`, body);
        expect(preview.status).toBe(200);
        const made = await owner.call(prefix, { ...body, preview: preview.payload.data.context });
        expect(made.status).toBe(201);
        return made.payload.data.riteId as string;
      };
    for (const kind of ["baptism", "dedication", "marriage"] as const)
      await save(riteFixture(kind, id));
    await save({
      state: "recorded",
      reason: null,
      baptismAfter: null,
      preview: null,
      record: {
        date: businessDay(),
        historical: false,
        note: null,
        payload: {
          kind: "funeral",
          person: { source: "member", memberId: id },
          deathOn: null,
          age: null,
          place: null,
        },
      },
    });
    const dedication = riteFixture("dedication", id);
    await save({ ...dedication, record: { ...dedication.record, date: null, historical: true } });
    await save({
      ...dedication,
      record: {
        ...dedication.record,
        date: `${Number(businessDay().slice(0, 4)) - 1}-01-01`,
        historical: true,
      },
    });
    const communion: RiteCommand = {
      state: "recorded",
      reason: null,
      baptismAfter: null,
      preview: null,
      record: {
        date: c.until,
        historical: false,
        note: null,
        payload: { kind: "communion", count: 987, officiant: null, place: null },
      },
    };
    const communionId = await save(communion);
    await save({
      ...communion,
      state: "planned",
      record: { ...communion.record, date: shiftDay(c.until, -7) },
    });
    const d = await overview(c);
    expect(d.rites.value).toBe(4);
    expect(d.rites.counts).toEqual({ baptism: 1, dedication: 1, marriage: 1, funeral: 1 });
    expect(d.rites.unknownDate).toBe(1);
    expect(d.rites.communionDays).toEqual([c.until]);
    expect(d.rites.recent).toHaveLength(5);
    expect(d.rites.recent.some((r: { id: string }) => r.id === communionId)).toBe(true);
    expect(d.attendance.value).toBeNull();
    const fault = spyOn(RiteReporting.prototype, "read").mockRejectedValueOnce(
      new Error("Synthetic source failure"),
    );
    try {
      const failed = await owner.call(`${base(c)}/overview`);
      expect(failed.status).toBe(503);
      expect(failed.payload.data).toBeUndefined();
    } finally {
      fault.mockRestore();
    }
  });
  test("scoped lead sees only own unit aggregate, no board or global/member attendance", async () => {
    const c = await fixture(2, 0),
      createUnit = async (kind: string, name: string) => {
        const made = await owner.call(`${base(c)}/organization/units`, { kind, name });
        expect(made.status).toBe(201);
        return made.payload.data.unit.id as string;
      },
      own = await createUnit("area", "Khu vực được giao"),
      outside = await createUnit("area", "Khu vực khác");
    await db.db
      .collection("families")
      .updateMany({ churchId: new ObjectId(c.id) }, { $set: { areaId: new ObjectId(own) } });
    await p36Session(
      owner,
      c.id,
      c.until,
      { scope: "unit", unitId: own },
      c.rows.slice(0, 1).map((m) => m._id.toHexString()),
    );
    await p36Session(owner, c.id, c.until, { scope: "unit", unitId: outside });
    const lead = client("church");
    await syntheticUser(owner, lead, c, "ministry_lead", [own]);
    const response = await lead.call(`${base(c, lead)}/organization/overview`);
    expect(response.status).toBe(200);
    expect(response.payload.data.items).toHaveLength(1);
    expect(response.payload.data.items[0].id).toBe(own);
    expect(response.payload.data.items[0].attendance).toMatchObject({
      value: 50,
      included: 2,
      present: 1,
      sessions: 1,
    });
    expect(
      (await lead.call(`${base(c, lead)}/organization/overview?kind=board`)).payload.data.items,
    ).toEqual([]);
    expect((await lead.call(`${base(c, lead)}/overview`)).status).toBe(403);
    expect((await lead.call(`${base(c, lead)}/members?attendance=absent3`)).status).toBe(403);
    expect(JSON.stringify(response.payload)).not.toContain(outside);
  });
  test("roles/tenant/CSRF/read filters cannot reveal global attendance or future periods", async () => {
    const c = await fixture(3, 0),
      other = await fixture(1, 0);
    for (const role of ["pastor", "secretary"]) {
      const s = client("church");
      await syntheticUser(owner, s, c, role);
      expect((await overview(c, s)).attendance.days).toHaveLength(12);
      expect((await s.call(`${base(other, s)}/overview`)).status).toBe(403);
    }
    for (const role of ["treasurer", "member"]) {
      const s = client("church");
      await syntheticUser(owner, s, c, role);
      expect((await s.call(`${base(c, s)}/overview`)).status).toBe(403);
      expect((await s.call(`${base(c, s)}/members?attendance=absent3`)).status).toBe(403);
    }
    expect(
      (await owner.call(`${base(c)}/members?attendanceUntil=${shiftDay(c.until, 7)}`)).status,
    ).toBe(400);
    expect((await owner.call(`${base(c)}/members?attendance=all`)).status).toBe(400);
    expect(JSON.stringify(logs)).not.toContain("Chọn nguồn synthetic");
  });
});
