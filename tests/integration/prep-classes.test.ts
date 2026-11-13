import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { config } from "../../api/config";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../../api/members/dates";
import { PrepClasses } from "../../api/prep-classes/service";
import {
  SyntheticClient,
  seedP2,
  syntheticChurch,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";
import { seedPrepEnrollments } from "../../scripts/p33-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3466",
  database: `church_cms_test_p33_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw new Error("Synthetic local only");
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  logs: object[] = [];
let app: ReturnType<typeof createApp>, owner: SyntheticClient, ownerId: string;
let now = Date.now();
const client = (realm: "owner" | "church" = "owner") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
const base = (c: { id: string }, s = owner) =>
  `${s.realm === "owner" ? "owner/" : ""}churches/${c.id}`;
const path = (c: { id: string }, s = owner) => `${base(c, s)}/prep-classes/courses`;
const day = () => businessDay(new Date(now));
async function fixture(count = 5) {
  const c = await syntheticChurch(owner, `Lớp synthetic ${crypto.randomUUID()}`);
  await seedP2(db, c.id, ownerId, count);
  await db.db.collection("members").updateMany(
    { churchId: new ObjectId(c.id) },
    {
      $set: {
        type: "believer",
        membership: "preparatory",
        participation: "active",
        baptism: { status: "not_baptized", date: null, place: null },
      },
    },
  );
  const rows = await db.db
    .collection("members")
    .find({ churchId: new ObjectId(c.id) })
    .sort({ _id: 1 })
    .toArray();
  return { ...c, rows };
}
function mid(c: { rows: { _id: ObjectId }[] }, i = 0) {
  const r = c.rows[i];
  if (!r) throw new Error("Fixture missing");
  return r._id.toHexString();
}
async function course(c: { id: string }, extra: object = {}, s = owner) {
  const r = await s.call(path(c, s), {
    name: "Lớp dự bị synthetic",
    startOn: shiftDay(day(), -14),
    teacher: "Giảng viên synthetic",
    baptismOn: null,
    lessons: ["Bài thứ nhất", "Bài thứ hai"],
    ...extra,
  });
  expect(r.status).toBe(201);
  return r.payload.data.courseId as string;
}
async function get(c: { id: string }, id: string, s = owner) {
  const r = await s.call(`${path(c, s)}/${id}`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
async function activate(c: { id: string }, id: string, s = owner) {
  const current = await get(c, id, s);
  const r = await s.call(
    `${path(c, s)}/${id}/activate`,
    { reason: "Bắt đầu synthetic" },
    { version: current.version },
  );
  expect(r.status).toBe(200);
  return get(c, id, s);
}
async function enroll(
  c: { id: string; rows: { _id: ObjectId }[] },
  id: string,
  index = 0,
  s = owner,
  extra: object = {},
) {
  return s.call(`${path(c, s)}/${id}/enrollments`, {
    memberId: mid(c, index),
    confirmUnknown: false,
    reason: null,
    ...extra,
  });
}
async function people(c: { id: string }, id: string, s = owner, q = "") {
  const r = await s.call(`${path(c, s)}/${id}/enrollments${q}`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
async function meeting(
  c: { id: string },
  id: string,
  lessonId: string,
  extra: object = {},
  s = owner,
) {
  const r = await s.call(`${path(c, s)}/${id}/meetings`, {
    lessonId,
    kind: "regular",
    heldOn: day(),
    location: null,
    memberIds: null,
    ...extra,
  });
  expect(r.status).toBe(201);
  return r.payload.data.sessionId as string;
}
const att = (c: { id: string }, sid: string, s = owner) =>
  `${base(c, s)}/attendance/sessions/${sid}`;
async function session(c: { id: string }, sid: string, s = owner) {
  const r = await s.call(att(c, sid, s));
  expect(r.status).toBe(200);
  return r.payload.data;
}
async function open(c: { id: string }, sid: string, s = owner) {
  const p = await s.call(`${att(c, sid, s)}/candidates`);
  expect(p.status).toBe(200);
  const state = await session(c, sid, s);
  const r = await s.call(
    `${att(c, sid, s)}/open`,
    { previewToken: p.payload.data.previewToken },
    { version: state.version },
  );
  expect(r.status).toBe(200);
  return session(c, sid, s);
}
async function mark(c: { id: string }, sid: string, memberId: string, s = owner, version = 1) {
  const state = await session(c, sid, s);
  return s.call(
    `${att(c, sid, s)}/participants/${memberId}`,
    { present: true, generation: state.generation },
    { method: "PATCH", version },
  );
}
async function close(c: { id: string }, sid: string, s = owner) {
  const state = await session(c, sid, s);
  expect((await s.call(`${att(c, sid, s)}/close`, {}, { version: state.version })).status).toBe(
    200,
  );
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
describe("P3.3 PrepClasses real Mongo Redis", () => {
  test("C33-01 manual eligibility, unknown confirmation, no demo age filter, unique enrollment", async () => {
    const c = await fixture(),
      id = await course(c);
    await db.db
      .collection("members")
      .updateOne({ _id: new ObjectId(mid(c)) }, { $set: { birthDate: shiftDay(day(), -365 * 5) } });
    expect((await enroll(c, id)).status).toBe(201);
    expect((await enroll(c, id)).status).toBe(409);
    await db.db
      .collection("members")
      .updateOne({ _id: new ObjectId(mid(c, 1)) }, { $set: { "baptism.status": "unknown" } });
    expect((await enroll(c, id, 1)).status).toBe(422);
    expect((await enroll(c, id, 1, owner, { confirmUnknown: true })).status).toBe(422);
    expect(
      (
        await enroll(c, id, 1, owner, {
          confirmUnknown: true,
          reason: "Cho ghi danh theo hồ sơ chưa rõ synthetic",
        })
      ).status,
    ).toBe(201);
    await db.db
      .collection("members")
      .updateOne({ _id: new ObjectId(mid(c, 2)) }, { $set: { "baptism.status": "baptized" } });
    expect((await enroll(c, id, 2)).status).toBe(422);
    await db.db
      .collection("members")
      .updateOne({ _id: new ObjectId(mid(c, 3)) }, { $set: { participation: "deceased" } });
    expect((await enroll(c, id, 3)).status).toBe(422);
    await db.db
      .collection("members")
      .updateOne({ _id: new ObjectId(mid(c, 4)) }, { $set: { membership: "child" } });
    expect((await enroll(c, id, 4)).status).toBe(422);
    const page = await people(c, id);
    expect(page.items).toHaveLength(2);
    expect(
      page.items.find((p: { memberId: string }) => p.memberId === mid(c)).ageAtStart,
    ).toBeLessThan(13);
    expect(
      (await owner.call(`${base(c)}/members/${mid(c)}/prep-classes`)).payload.data.items[0].course
        .id,
    ).toBe(id);
  });
  test("course schema strict, dates, lifecycle CAS and immutable curriculum after first open", async () => {
    const c = await fixture(),
      id = await course(c);
    expect(
      (
        await owner.call(path(c), {
          name: "Sai",
          startOn: day(),
          teacher: null,
          baptismOn: null,
          lessons: [],
          scope: "church",
        })
      ).status,
    ).toBe(422);
    expect(
      (await owner.call(`${path(c)}/${id}/activate`, { reason: "" }, { version: 1 })).status,
    ).toBe(422);
    expect((await enroll(c, id)).status).toBe(201);
    const active = await activate(c, id),
      lesson = active.lessons[0].id,
      sid = await meeting(c, id, lesson);
    await open(c, sid);
    expect((await get(c, id)).planLocked).toBe(true);
    const patch = {
      name: active.name,
      startOn: active.startOn,
      teacher: active.teacher,
      baptismOn: null,
      lessons: ["Đổi bài"],
      reason: "Sửa chương trình",
    };
    expect(
      (await owner.call(`${path(c)}/${id}`, patch, { method: "PATCH", version: active.version }))
        .status,
    ).toBe(409);
    expect(
      (await owner.call(`${path(c)}/${id}/close`, { reason: "Đóng" }, { version: active.version }))
        .status,
    ).toBe(409);
    expect(
      (
        await owner.call(
          `${att(c, sid)}`,
          { scope: "unit", unitId: new ObjectId().toHexString(), reason: "Đi vòng" },
          { method: "PATCH", version: 2 },
        )
      ).status,
    ).toBe(422);
    await close(c, sid);
    expect(
      (
        await owner.call(
          `${path(c)}/${id}/close`,
          { reason: "Đóng có bài chưa diễn ra" },
          { version: active.version },
        )
      ).status,
    ).toBe(200);
    expect((await enroll(c, id, 1)).status).toBe(409);
    expect(
      (
        await owner.call(
          `${att(c, sid)}/reopen`,
          { reason: "Đi vòng" },
          { version: (await session(c, sid)).version },
        )
      ).status,
    ).toBe(409);
    const closed = await get(c, id);
    expect(
      (
        await owner.call(
          `${path(c)}/${id}/reopen`,
          { reason: "Sửa có kiểm soát" },
          { version: closed.version },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await owner.call(
          `${path(c)}/${id}/close`,
          { reason: "Tab cũ" },
          { version: closed.version },
        )
      ).status,
    ).toBe(412);
  });
  test("preview binds current enrollments, source restricted, late enroll and withdrawal preserve opened snapshots", async () => {
    const c = await fixture(),
      id = await course(c);
    await enroll(c, id);
    await enroll(c, id, 1);
    const active = await activate(c, id),
      sid = await meeting(c, id, active.lessons[0].id);
    const old = await owner.call(`${att(c, sid)}/candidates`);
    expect(old.payload.data.total).toBe(2);
    await enroll(c, id, 2);
    expect(
      (
        await owner.call(
          `${att(c, sid)}/open`,
          { previewToken: old.payload.data.previewToken },
          { version: 1 },
        )
      ).status,
    ).toBe(409);
    const rows = await people(c, id),
      withdraw = rows.items.find((p: { memberId: string }) => p.memberId === mid(c, 1));
    expect(
      (
        await owner.call(
          `${path(c)}/${id}/enrollments/${mid(c, 1)}/state`,
          { state: "withdrawn", confirmUnknown: false, reason: "Ngừng trước buổi" },
          { version: withdraw.version },
        )
      ).status,
    ).toBe(200);
    const s = await open(c, sid);
    expect(s.includedCount).toBe(2);
    await enroll(c, id, 3);
    const first = (await people(c, id)).items.find(
      (p: { memberId: string }) => p.memberId === mid(c),
    );
    await owner.call(
      `${path(c)}/${id}/enrollments/${mid(c)}/state`,
      { state: "withdrawn", confirmUnknown: false, reason: "Ngừng sau mở" },
      { version: first.version },
    );
    const roster = (await owner.call(`${att(c, sid)}/participants`)).payload.data;
    expect(roster.items.map((p: { memberId: string }) => p.memberId).sort()).toEqual(
      [mid(c), mid(c, 2)].sort(),
    );
    expect((await mark(c, sid, mid(c))).status).toBe(200);
    expect(
      (
        await owner.call(
          `${att(c, sid)}/roster-changes`,
          { memberId: mid(c, 4), included: true, reason: "Không ghi danh" },
          { version: (await session(c, sid)).version },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await owner.call(
          `${att(c, sid)}/roster-changes`,
          { memberId: mid(c, 3), included: true, reason: "Đã ghi danh muộn" },
          { version: (await session(c, sid)).version },
        )
      ).status,
    ).toBe(200);
    expect(
      (await people(c, id)).items.every(
        (p: { creditedLessonIds: string[] }) => !p.creditedLessonIds.length,
      ),
    ).toBe(true);
  });
  test("C33-02 closed attendance credits only, makeup keeps absence and deduplicates by lesson", async () => {
    const c = await fixture(),
      id = await course(c);
    await enroll(c, id);
    await enroll(c, id, 1);
    const active = await activate(c, id),
      lid = active.lessons[0].id,
      sid = await meeting(c, id, lid);
    await open(c, sid);
    await mark(c, sid, mid(c));
    expect(
      (await people(c, id)).items.find((p: { memberId: string }) => p.memberId === mid(c))
        .creditedLessonIds,
    ).toHaveLength(0);
    await close(c, sid);
    let page = await people(c, id);
    expect(
      page.items.find((p: { memberId: string }) => p.memberId === mid(c)).creditedLessonIds,
    ).toEqual([lid]);
    expect(
      page.items.find((p: { memberId: string }) => p.memberId === mid(c, 1)).makeupLessonIds,
    ).toEqual([lid]);
    expect(
      (
        await owner.call(`${path(c)}/${id}/meetings`, {
          lessonId: lid,
          kind: "makeup",
          heldOn: day(),
          location: null,
          memberIds: [mid(c)],
        })
      ).status,
    ).toBe(409);
    const makeup = await meeting(c, id, lid, { kind: "makeup", memberIds: [mid(c, 1)] });
    const extraMakeup = await meeting(c, id, lid, { kind: "makeup", memberIds: [mid(c, 1)] });
    const s = await open(c, makeup);
    expect(s.includedCount).toBe(1);
    expect(
      (
        await owner.call(
          `${att(c, makeup)}/roster-changes`,
          { memberId: mid(c), included: true, reason: "Ngoài nhóm học bù" },
          { version: s.version },
        )
      ).status,
    ).toBe(422);
    await mark(c, makeup, mid(c, 1));
    await close(c, makeup);
    await open(c, extraMakeup);
    await mark(c, extraMakeup, mid(c, 1));
    await close(c, extraMakeup);
    page = await people(c, id);
    expect(
      page.items.filter((p: { creditedLessonIds: string[] }) => p.creditedLessonIds.length === 1),
    ).toHaveLength(2);
    const original = (await owner.call(`${att(c, sid)}/participants`)).payload.data.items.find(
      (p: { memberId: string }) => p.memberId === mid(c, 1),
    );
    expect(original.status).toBe("absent");
    expect(
      (
        await owner.call(`${path(c)}/${id}/meetings`, {
          lessonId: lid,
          kind: "makeup",
          heldOn: day(),
          location: null,
          memberIds: [mid(c, 1)],
        })
      ).status,
    ).toBe(409);
    const late = await enroll(c, id, 2);
    expect(late.status).toBe(201);
    expect(
      (await people(c, id)).items.find((p: { memberId: string }) => p.memberId === mid(c, 2))
        .makeupLessonIds,
    ).toEqual([lid]);
    expect(
      await db.db
        .collection("attendance_participants")
        .countDocuments({ sessionId: new ObjectId(sid), memberId: new ObjectId(mid(c, 2)) }),
    ).toBe(0);
  });
  test("C33-03 secretary manages study but only pastor/owner writes interview; no auto baptism or pass", async () => {
    const c = await fixture(),
      id = await course(c),
      sec = client("church"),
      pastor = client("church");
    await syntheticUser(owner, sec, c, "secretary");
    await syntheticUser(owner, pastor, c, "pastor");
    await enroll(c, id);
    const data = (await people(c, id)).items[0],
      body = { heldOn: day(), interviewer: "Mục sư synthetic", reason: "Ghi nhận sự kiện" };
    expect(
      (
        await sec.call(`${path(c, sec)}/${id}/enrollments/${mid(c)}/interview`, body, {
          version: data.version,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await pastor.call(`${path(c, pastor)}/${id}/enrollments/${mid(c)}/interview`, body, {
          version: data.version,
        })
      ).status,
    ).toBe(200);
    expect((await people(c, id, sec)).items[0].interview).toEqual({
      heldOn: day(),
      interviewer: body.interviewer,
    });
    expect(
      (
        await owner.call(
          `${path(c)}/${id}/enrollments/${mid(c)}/interview`,
          { ...body, passed: true },
          { version: 2 },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await owner.call(
          `${path(c)}/${id}/enrollments/${mid(c)}/interview`,
          { ...body, heldOn: shiftDay(day(), 1) },
          { version: 2 },
        )
      ).status,
    ).toBe(422);
    const member = await db.db.collection("members").findOne({ _id: new ObjectId(mid(c)) });
    expect(member?.baptism.status).toBe("not_baptized");
    expect(member?.membership).toBe("preparatory");
    expect(
      (
        await owner.call(
          `${path(c)}/${id}/enrollments/${mid(c)}/state`,
          { state: "withdrawn", confirmUnknown: false, reason: "Ngừng học synthetic" },
          { version: 2 },
        )
      ).status,
    ).toBe(200);
    const historicalDay = shiftDay(day(), -20);
    expect(
      (
        await pastor.call(
          `${path(c, pastor)}/${id}/enrollments/${mid(c)}/interview`,
          { ...body, heldOn: historicalDay, reason: "Bổ sung sự kiện trước khai giảng" },
          { version: 3 },
        )
      ).status,
    ).toBe(200);
    const historical = (await people(c, id)).items[0];
    expect(historical.state).toBe("withdrawn");
    expect(historical.interview.heldOn).toBe(historicalDay);
  });
  test("denied roles, dual realm, tenant IDs/cursors/operations and no ordinary source injection", async () => {
    const c = await fixture(),
      id = await course(c),
      foreign = await fixture(),
      fid = await course(foreign);
    await enroll(c, id);
    const active = await activate(c, id),
      sid = await meeting(c, id, active.lessons[0].id);
    await open(c, sid);
    for (const role of ["ministry_lead", "treasurer", "member"]) {
      const subject = client("church");
      let units: string[] = [];
      if (role === "ministry_lead") {
        const u = await owner.call(`${base(c)}/organization/units`, {
          kind: "service_ministry",
          name: "Ban thử",
        });
        units = [u.payload.data.unit.id];
      }
      await syntheticUser(owner, subject, c, role, units);
      expect((await subject.call(path(c, subject))).status).toBe(403);
      expect([403, 404]).toContain((await subject.call(att(c, sid, subject))).status);
      expect(
        (
          await subject.call(`${att(c, sid, subject)}/qr-resolutions`, {
            code: `QLHT1:${"a".repeat(43)}`,
            generation: 2,
          })
        ).status,
      ).not.toBe(200);
    }
    const sec = client("church");
    await syntheticUser(owner, sec, c);
    expect((await sec.call(`${path(foreign, sec)}/${fid}`)).status).toBe(404);
    const p = await owner.call(`${path(c)}/${id}/enrollments?limit=1`);
    expect(p.status).toBe(200);
    expect(
      (
        await owner.call(`${base(c)}/attendance/sessions`, {
          label: "Giả nguồn",
          heldOn: day(),
          location: null,
          scope: "church",
          unitId: null,
          prepClass: { courseId: id },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await owner.call(
          `${path(c)}/${id}/activate`,
          { reason: "csrf" },
          { version: active.version, headers: { "x-csrf-token": "bad" } },
        )
      ).status,
    ).toBe(403);
    expect((await client().call(path(c))).status).toBe(401);
  });
  test("class QR shares attendance kernel; replay after course close returns receipt without remark", async () => {
    const c = await fixture(),
      id = await course(c);
    await enroll(c, id);
    const active = await activate(c, id),
      sid = await meeting(c, id, active.lessons[0].id);
    await open(c, sid);
    const issued = await owner.call(`${base(c)}/members/${mid(c)}/cards`, {}),
      render = (await owner.call(`${base(c)}/cards/${issued.payload.data.cardId}/render`)).payload
        .data,
      resolved = await owner.call(`${att(c, sid)}/qr-resolutions`, {
        code: render.payload,
        generation: 2,
      });
    expect(resolved.status).toBe(200);
    const p = resolved.payload.data,
      key = crypto.randomUUID(),
      body = { resolutionToken: p.resolutionToken, generation: 2 };
    const scan = await owner.call(`${att(c, sid)}/scans`, body, {
      version: p.participant.version,
      key,
    });
    expect(scan.status).toBe(200);
    await close(c, sid);
    expect((await people(c, id)).items[0].creditedLessonIds).toHaveLength(1);
    const current = await get(c, id);
    expect(
      (await owner.call(`${path(c)}/${id}/close`, { reason: "Đóng" }, { version: current.version }))
        .status,
    ).toBe(200);
    now += 61_000;
    const replay = await owner.call(`${att(c, sid)}/scans`, body, {
      version: p.participant.version,
      key,
    });
    now -= 61_000;
    expect(replay.status).toBe(200);
    expect(replay.payload.meta.replayed).toBe(true);
    expect((await session(c, sid)).presentCount).toBe(1);
  });
  test("unknown committed ack for enrollment is recoverable and creates one history/count", async () => {
    const c = await fixture(),
      id = await course(c),
      key = crypto.randomUUID(),
      body = { memberId: mid(c), confirmUnknown: false, reason: null };
    const start = db.client.startSession.bind(db.client),
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
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await owner.call(`${path(c)}/${id}/enrollments`, body, { key });
    } finally {
      spy.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(r.payload.error.code).toBe("OUTCOME_UNKNOWN");
    expect(
      (await owner.call(`${base(c)}/prep-classes/operations/${r.payload.meta.operationId}`)).status,
    ).toBe(200);
    const again = await owner.call(`${path(c)}/${id}/enrollments`, body, { key });
    expect(again.status).toBe(200);
    expect(again.payload.meta.replayed).toBe(true);
    expect((await get(c, id)).enrollmentCount).toBe(1);
    expect(
      await db.db
        .collection("prep_class_history")
        .countDocuments({ courseId: new ObjectId(id), event: "enrolled" }),
    ).toBe(1);
  });
  test("audit failure rolls back meeting, Attendance session and class history together", async () => {
    const c = await fixture(),
      id = await course(c),
      active = await activate(c, id),
      collection = db.db.collection.bind(db.db);
    const spy = spyOn(db.db, "collection").mockImplementation(((
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
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await owner.call(`${path(c)}/${id}/meetings`, {
        lessonId: active.lessons[0].id,
        kind: "regular",
        heldOn: day(),
        location: null,
        memberIds: null,
      });
    } finally {
      spy.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(
      await db.db.collection("prep_meetings").countDocuments({ courseId: new ObjectId(id) }),
    ).toBe(0);
    expect(
      await db.db
        .collection("attendance_sessions")
        .countDocuments({ "prepClass.courseId": new ObjectId(id) }),
    ).toBe(0);
  });
  test("fresh permission before replay and role revocation after authorization aborts write", async () => {
    const c = await fixture(),
      id = await course(c),
      sec = client("church"),
      account = await syntheticUser(owner, sec, c),
      key = crypto.randomUUID(),
      body = { memberId: mid(c), confirmUnknown: false, reason: null };
    const saved = await sec.call(`${path(c, sec)}/${id}/enrollments`, body, { key });
    expect(saved.status).toBe(201);
    const op = await db.db
      .collection("idempotency_operations")
      .findOne({ actorId: new ObjectId(account.id), routeKey: { $regex: "^prep-classes/" } });
    expect(op).toBeTruthy();
    let enter!: () => void, release!: () => void;
    const reached = new Promise<void>((r) => {
        enter = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      }),
      original = PrepClasses.prototype.enroll;
    const spy = spyOn(PrepClasses.prototype, "enroll").mockImplementation(async function (
      this: PrepClasses,
      ...args: Parameters<PrepClasses["enroll"]>
    ) {
      enter();
      await gate;
      return original.apply(this, args);
    });
    const inflight = sec.call(`${path(c, sec)}/${id}/enrollments`, {
      ...body,
      memberId: mid(c, 1),
    });
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
    expect((await inflight).status).toBe(401);
    expect((await get(c, id)).enrollmentCount).toBe(1);
    expect((await sec.call(`${path(c, sec)}/${id}/enrollments`, body, { key })).status).toBe(403);
    expect((await sec.call(`${base(c, sec)}/prep-classes/operations/${op?._id}`)).status).toBe(403);
  });
  test("concurrent enroll and regular meeting uniqueness, closed history keyset/cursor fencing", async () => {
    const c = await fixture(),
      id = await course(c);
    const same = await Promise.all(Array.from({ length: 5 }, () => enroll(c, id)));
    expect(same.filter((r) => r.status === 201)).toHaveLength(1);
    expect(same.every((r) => [201, 409].includes(r.status))).toBe(true);
    for (let i = 1; i < 5; i++) expect((await enroll(c, id, i)).status).toBe(201);
    const p1 = (await owner.call(`${path(c)}/${id}/enrollments?limit=2`)).payload.data,
      p2 = (
        await owner.call(
          `${path(c)}/${id}/enrollments?limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`,
        )
      ).payload.data;
    expect(p1.items).toHaveLength(2);
    expect(p2.items).toHaveLength(2);
    expect(new Set([...p1.items, ...p2.items].map((p) => p.memberId)).size).toBe(4);
    const foreign = await fixture(),
      fid = await course(foreign);
    expect(
      (
        await owner.call(
          `${path(foreign)}/${fid}/enrollments?cursor=${encodeURIComponent(p1.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
    const active = await activate(c, id),
      b = {
        lessonId: active.lessons[0].id,
        kind: "regular",
        heldOn: day(),
        location: null,
        memberIds: null,
      };
    const made = await Promise.all(
      Array.from({ length: 3 }, () => owner.call(`${path(c)}/${id}/meetings`, b)),
    );
    expect(made.filter((r) => r.status === 201)).toHaveLength(1);
    expect(made.every((r) => [201, 409].includes(r.status))).toBe(true);
    const h = (await owner.call(`${path(c)}/${id}/history?limit=2`)).payload.data;
    expect(h.items).toHaveLength(2);
    expect(h.nextCursor).toBeTruthy();
    expect(JSON.stringify(logs)).not.toContain("Giảng viên synthetic");
  });
  test("2000 enrolled roster is bounded, indexed progress reflects closed presence, 2001st rejects", async () => {
    const c = await fixture(2001),
      id = await course(c, { lessons: ["Bài giới hạn"] });
    await seedPrepEnrollments(db, c.id, id, 2000);
    expect((await enroll(c, id, 2000)).status).toBe(422);
    const active = await activate(c, id),
      sid = await meeting(c, id, active.lessons[0].id),
      opened = await open(c, sid);
    expect(opened.includedCount).toBe(2000);
    const page = await owner.call(`${att(c, sid)}/participants?limit=100`);
    expect(page.payload.data.items).toHaveLength(100);
    expect(page.payload.data.nextCursor).toBeTruthy();
    expect((await mark(c, sid, mid(c))).status).toBe(200);
    await close(c, sid);
    const p = await people(c, id, owner, "?limit=100");
    expect(p.items).toHaveLength(100);
    expect(
      p.items.find((e: { memberId: string }) => e.memberId === mid(c)).creditedLessonIds,
    ).toEqual([active.lessons[0].id]);
    const plan = await db.db
      .collection("attendance_sessions")
      .find({
        churchId: new ObjectId(c.id),
        "prepClass.courseId": new ObjectId(id),
        state: "closed",
      })
      .explain("executionStats");
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain("attendance_prep_progress");
  });
  test("192KiB class body admits bounded 200 lessons, interview receipt remains privileged after downgrade", async () => {
    const c = await fixture(),
      titles = Array.from({ length: 200 }, (_, i) =>
        `${i + 1} ${"Bài học tiếng Việt ".repeat(12)}`.slice(0, 200),
      ),
      id = await course(c, { lessons: titles });
    expect((await get(c, id)).lessons).toHaveLength(200);
    expect(
      (
        await owner.call(path(c), {
          name: "Vượt giới hạn",
          startOn: day(),
          teacher: null,
          baptismOn: null,
          lessons: [...titles, "Bài thêm"],
        })
      ).status,
    ).toBe(422);
    await enroll(c, id);
    const pastor = client("church"),
      account = await syntheticUser(owner, pastor, c, "pastor"),
      key = crypto.randomUUID(),
      body = { heldOn: day(), interviewer: "Mục sư synthetic", reason: "Ghi nhận" };
    expect(
      (
        await pastor.call(`${path(c, pastor)}/${id}/enrollments/${mid(c)}/interview`, body, {
          version: 1,
          key,
        })
      ).status,
    ).toBe(200);
    const op = await db.db
      .collection("idempotency_operations")
      .findOne({ actorId: new ObjectId(account.id), routeKey: { $regex: "/interview$" } });
    expect(op).toBeTruthy();
    expect(
      (await pastor.call(`${base(c, pastor)}/prep-classes/operations/${op?._id}`)).status,
    ).toBe(200);
    await db.db
      .collection("accounts")
      .updateOne(
        { _id: new ObjectId(account.id) },
        { $set: { role: "secretary" }, $inc: { version: 1 } },
      );
    pastor.jar.clear();
    pastor.csrf = "";
    expect((await pastor.login(account.email, account.password, c.code)).status).toBe(200);
    expect(
      (await pastor.call(`${base(c, pastor)}/prep-classes/operations/${op?._id}`)).status,
    ).toBe(403);
    expect(
      (
        await pastor.call(`${path(c, pastor)}/${id}/enrollments/${mid(c)}/interview`, body, {
          version: 1,
          key,
        })
      ).status,
    ).toBe(403);
  });
});
