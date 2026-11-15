import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { lastSunday } from "../../api/attendance/reporting";
import { Audit } from "../../api/audit/service";
import { Care } from "../../api/care/service";
import { CareSources } from "../../api/care/sources";
import type { SignalCommand } from "../../api/care/validation";
import { config } from "../../api/config";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../../api/members/dates";
import {
  localOnly,
  SyntheticClient,
  syntheticOwner,
  syntheticUser,
} from "../../scripts/p2-fixtures";
import { p36Session } from "../../scripts/p36-fixtures";
import { careCreate as caseCreate, careSave as visitationSave } from "../../scripts/p43-fixtures";
import { prayerCreate, prayerSave } from "../../scripts/p44-fixtures";
import {
  alertSave,
  careCommon,
  careDecision,
  careOpenAlert,
  careRoot,
  careScan,
  p45Fixture,
  signalCreate,
  signalSave,
} from "../../scripts/p45-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3487",
  database: `church_cms_test_p45_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
localOnly(conf);
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  logs: object[] = [];
let app: ReturnType<typeof createApp>, owner: SyntheticClient, actor: string;
const client = (realm: "owner" | "church" = "owner") =>
  new SyntheticClient(realm, conf.origin, (req) => app(req, { ip: crypto.randomUUID() }));
const fixture = (n = 12) => p45Fixture(db, owner, actor, n),
  root = (c: { id: string }, s = owner) => careRoot(c, s),
  base = (c: { id: string }, s = owner) => `${s.realm === "owner" ? "owner/" : ""}churches/${c.id}`;
const count = (table: string, c: { id: string }, extra: object = {}) =>
  db.db.collection(table).countDocuments({ churchId: new ObjectId(c.id), ...extra });
async function need(
  c: Awaited<ReturnType<typeof fixture>>,
  index = 0,
  kind: "illness" | "new_believer" | "bereavement" = "illness",
  s = owner,
) {
  const person = c.people[index];
  if (!person) throw Error();
  const id = kind === "bereavement" ? person.familyId.toHexString() : person._id.toHexString(),
    r = await signalSave(s, c, signalCreate(id, kind));
  expect(r.status).toBe(201);
  return {
    id: r.payload.data.signalId as string,
    version: r.payload.data.version as number,
    targetId: id,
    r,
  };
}
async function detail(c: { id: string }, id: string, signal = false, s = owner) {
  const r = await s.call(`${root(c, s)}${signal ? "/signals" : ""}/${id}`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  app = createApp(identity, conf, { log: (r) => logs.push(r) });
  owner = client();
  actor = (await syntheticOwner(db, owner)).id;
});
afterAll(async () => {
  await db.db.dropDatabase();
  expect(
    (await db.db.admin().listDatabases()).databases.some((d) => d.name === conf.database),
  ).toBe(false);
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
describe("P4.5 real Mongo Redis care episodes and atomic conversion", () => {
  test("manual illness and family source produce reduced pending suggestions without foreign business writes", async () => {
    const c = await fixture(),
      person = c.people[0];
    if (!person) throw Error();
    const n = await need(c),
      a = await careOpenAlert(db, c, n.targetId);
    expect(a.state).toBe("pending");
    expect(a.code).toMatch(/^DN-/);
    expect(a.targetSnapshot).not.toHaveProperty("phone");
    expect(a.targetSnapshot).not.toHaveProperty("address");
    expect(await count("visitation_cases", c)).toBe(0);
    const after = await db.db.collection("members").findOne({ _id: person._id });
    expect(after?.version).toBe(person.version);
    expect(after?.visitor).toEqual(person.visitor);
    expect(after?.assignment).toEqual(person.assignment);
    await need(c, 1, "bereavement");
    expect(await count("care_alerts", c, { state: "pending" })).toBe(2);
    const overview = await owner.call(`${base(c)}/overview`);
    expect(overview.status).toBe(200);
    expect(overview.payload.data.care.pending).toBe(2);
    expect(overview.payload.data.care.lastEvaluatedAt).toBeNull();
  });
  test("known belief date30day boundary ignores conversion/baptism/creation and coalesces manual evidence", async () => {
    const c = await fixture(),
      people = c.people.slice(0, 4);
    expect(people).toHaveLength(4);
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (!p) throw Error();
      await db.db.collection("members").updateOne(
        { _id: p._id },
        {
          $set: {
            visitor: {
              stage: "believed",
              firstVisit: null,
              believedOn:
                i === 0
                  ? shiftDay(businessDay(), -29)
                  : i === 1
                    ? shiftDay(businessDay(), -30)
                    : null,
              referrer: null,
              caregiverId: null,
            },
            convertedOn: businessDay(),
            "baptism.date": businessDay(),
          },
          $inc: { version: 1 },
        },
      );
    }
    await careScan(owner, c);
    const a = await careOpenAlert(db, c, people[0]?._id.toHexString() as string, "new_believer");
    expect(a.evidence[0]?.type).toBe("belief");
    expect(await count("care_alerts", c, { kind: "new_believer" })).toBe(1);
    const manual = await need(c, 0, "new_believer");
    expect(manual.r.status).toBe(201);
    const same = await careOpenAlert(db, c, manual.targetId, "new_believer");
    expect(same.id).toBe(a.id);
    expect(same.evidence).toHaveLength(2);
    await signalSave(
      owner,
      c,
      { action: "end", ...careCommon, reason: "Kết thúc nguồn nhập tay" },
      manual.id,
      manual.version,
    );
    expect((await careOpenAlert(db, c, manual.targetId, "new_believer")).episodeActive).toBe(true);
    const latest = await careOpenAlert(db, c, manual.targetId, "new_believer");
    await db.db
      .collection("members")
      .updateOne(
        { _id: new ObjectId(manual.targetId) },
        { $set: { "visitor.believedOn": shiftDay(businessDay(), -1) }, $inc: { version: 1 } },
      );
    const fresh = await owner.call(`${root(c)}/${latest.id}/preview`, careDecision(), {
      version: latest.version,
    });
    expect(fresh.status).toBe(200);
    expect(fresh.payload.data.before.evidence[0].day).toBe(shiftDay(businessDay(), -29));
    expect(fresh.payload.data.current.evidence[0].day).toBe(shiftDay(businessDay(), -1));
    expect((await alertSave(owner, c, latest.id, latest.version, careDecision())).status).toBe(200);
    expect((await careOpenAlert(db, c, manual.targetId, "new_believer")).evidence[0]?.day).toBe(
      shiftDay(businessDay(), -1),
    );
  });
  test("absence uses exactly3calendar closed references and never skips missing/open or outside roster", async () => {
    const c = await fixture(4),
      until = lastSunday(businessDay());
    for (let i = 3; i >= 1; i--)
      await p36Session(owner, c.id, shiftDay(until, -7 * i), { reportingKind: "sunday_reference" });
    await careScan(owner, c);
    expect(await count("care_alerts", c, { kind: "absence" })).toBe(0);
    const latest = await p36Session(
      owner,
      c.id,
      until,
      { reportingKind: "sunday_reference" },
      [],
      false,
    );
    await careScan(owner, c);
    expect(await count("care_alerts", c, { kind: "absence" })).toBe(0);
    const sp = `${base(c)}/attendance/sessions/${latest.id}`,
      s = (await owner.call(sp)).payload.data;
    expect((await owner.call(`${sp}/close`, {}, { version: s.version })).status).toBe(200);
    await careScan(owner, c);
    expect(await count("care_alerts", c, { kind: "absence", state: "pending" })).toBe(
      c.people.length,
    );
    const a = await careOpenAlert(db, c, c.people[0]?._id.toHexString() as string, "absence");
    expect(a.evidence.map((e: { day: string }) => e.day)).toEqual([
      shiftDay(until, -14),
      shiftDay(until, -7),
      until,
    ]);
    await db.db.collection("attendance_participants").updateOne(
      {
        churchId: new ObjectId(c.id),
        sessionId: new ObjectId(latest.id),
        memberId: c.people[0]?._id,
      },
      { $set: { included: false } },
    );
    await careScan(owner, c);
    expect(
      await count("care_alerts", c, {
        targetId: c.people[0]?._id,
        kind: "absence",
        state: "expired",
      }),
    ).toBe(1);
  }, 30000);
  test("missing evidence preserves suppressed episode, known false releases it and recurrence creates new episode", async () => {
    const c = await fixture(3),
      until = lastSunday(businessDay()),
      sessions = [];
    for (let i = 2; i >= 0; i--)
      sessions.push(
        await p36Session(owner, c.id, shiftDay(until, -7 * i), {
          reportingKind: "sunday_reference",
        }),
      );
    await careScan(owner, c);
    const target = c.people[0]?._id.toHexString() as string,
      a = await careOpenAlert(db, c, target, "absence");
    expect(
      (
        await alertSave(owner, c, a.id, a.version, {
          action: "dismiss",
          ...careCommon,
          reason: "Đã đối chiếu",
        })
      ).status,
    ).toBe(200);
    const sid = new ObjectId(sessions[2]?.id);
    await db.db
      .collection("attendance_sessions")
      .updateOne({ _id: sid }, { $set: { reportingKind: "general" }, $inc: { version: 1 } });
    await careScan(owner, c);
    let old = await careOpenAlert(db, c, target, "absence");
    expect(old.id).toBe(a.id);
    expect(old.state).toBe("dismissed");
    expect(old.availability).toBe("unknown");
    await db.db
      .collection("attendance_sessions")
      .updateOne(
        { _id: sid },
        { $set: { reportingKind: "sunday_reference" }, $inc: { version: 1 } },
      );
    await db.db
      .collection("attendance_participants")
      .updateOne({ sessionId: sid, memberId: new ObjectId(target) }, { $set: { present: true } });
    await careScan(owner, c);
    expect(
      await count("care_alerts", c, {
        targetId: new ObjectId(target),
        kind: "absence",
        episodeActive: true,
      }),
    ).toBe(0);
    await db.db
      .collection("attendance_participants")
      .updateOne({ sessionId: sid, memberId: new ObjectId(target) }, { $set: { present: false } });
    await careScan(owner, c);
    old = await careOpenAlert(db, c, target, "absence");
    expect(old.id).not.toBe(a.id);
    expect(old.state).toBe("pending");
  }, 30000);
  test("dismissing then evaluating repeatedly never reopens same manual episode; end/new signal starts new episode", async () => {
    const c = await fixture(),
      n = await need(c),
      a = await careOpenAlert(db, c, n.targetId);
    await alertSave(owner, c, a.id, a.version, {
      action: "dismiss",
      ...careCommon,
      reason: "Đã có kế hoạch riêng",
    });
    for (let i = 0; i < 2; i++) await careScan(owner, c, 2);
    expect(
      await count("care_alerts", c, { targetId: new ObjectId(n.targetId), kind: "illness" }),
    ).toBe(1);
    expect((await careOpenAlert(db, c, n.targetId)).state).toBe("dismissed");
    await signalSave(
      owner,
      c,
      { action: "end", ...careCommon, reason: "Nhu cầu cũ đã xong" },
      n.id,
      n.version,
    );
    await need(c);
    const next = await careOpenAlert(db, c, n.targetId);
    expect(next.id).not.toBe(a.id);
    expect(next.state).toBe("pending");
  });
  test("linked episode remains terminal after case completion/cancellation, no automatic visit/assignment", async () => {
    const c = await fixture(),
      n = await need(c),
      a = await careOpenAlert(db, c, n.targetId),
      r = await alertSave(owner, c, a.id, a.version, careDecision());
    expect(r.status).toBe(200);
    const caseId = r.payload.data.caseId,
      casePath = `${base(c)}/care/cases/${caseId}`,
      d = (await owner.call(casePath)).payload.data;
    expect(d.assigneeId).toBeNull();
    expect(d.entryCount).toBe(0);
    expect(d.visitedCount).toBe(0);
    expect(d.state).toBe("open");
    await db.db.collection("visitation_cases").updateOne(
      { _id: new ObjectId(caseId) },
      {
        $set: { state: "cancelled", closeReason: "Synthetic cancellation", closedAt: new Date() },
        $inc: { version: 1 },
      },
    );
    await careScan(owner, c);
    expect(await count("visitation_cases", c)).toBe(1);
    expect((await careOpenAlert(db, c, n.targetId)).state).toBe("linked");
    expect(
      (
        await owner.call(`${root(c)}/${a.id}/preview`, careDecision(), {
          version: r.payload.data.version,
        })
      ).status,
    ).toBe(409);
  });
  test("existing manual open case is explicitly linked without overwriting fields/assignee/version", async () => {
    const c = await fixture(),
      n = await need(c),
      a = await careOpenAlert(db, c, n.targetId);
    const made = await visitationSave(
      owner,
      c,
      caseCreate(
        { kind: "member", id: n.targetId },
        {
          reasonCode: "illness",
          description: "Hồ sơ nhập thủ công",
          assigneeId: c.people[1]?._id.toHexString() ?? null,
        },
      ),
    );
    expect(made.status).toBe(201);
    const id = made.payload.data.caseId,
      before = (await owner.call(`${base(c)}/care/cases/${id}`)).payload.data;
    const r = await alertSave(owner, c, a.id, a.version, careDecision(before));
    expect(r.status).toBe(200);
    expect(r.payload.data.caseId).toBe(id);
    expect((await owner.call(`${base(c)}/care/cases/${id}`)).payload.data).toEqual(before);
    expect(await count("visitation_cases", c)).toBe(1);
  });
  test("case created after preview causes conflict, never silently switches create to link", async () => {
    const c = await fixture(),
      n = await need(c),
      a = await careOpenAlert(db, c, n.targetId),
      b = careDecision(),
      p = await owner.call(`${root(c)}/${a.id}/preview`, b, { version: a.version });
    expect(p.status).toBe(200);
    await visitationSave(
      owner,
      c,
      caseCreate({ kind: "member", id: n.targetId }, { reasonCode: "illness" }),
    );
    const r = await owner.call(
      `${root(c)}/${a.id}`,
      { ...b, preview: p.payload.data.context, confirmed: true },
      { method: "PATCH", version: a.version },
    );
    expect(r.status).toBe(409);
    expect(r.payload.error.code).toBe("CARE_LINK_CHANGED");
    expect(await count("visitation_cases", c)).toBe(1);
    expect((await careOpenAlert(db, c, n.targetId)).state).toBe("pending");
  });
  test("preview confirmation, root CAS and immutable signal authority fields are enforced", async () => {
    const c = await fixture(),
      b = signalCreate(c.people[0]?._id.toHexString() as string),
      p = await owner.call(`${root(c)}/signals/preview`, b);
    expect(p.status).toBe(200);
    expect(
      (await owner.call(`${root(c)}/signals`, { ...b, preview: p.payload.data.context })).payload
        .error.code,
    ).toBe("CARE_CONFIRMATION_REQUIRED");
    const n = await need(c),
      a = await careOpenAlert(db, c, n.targetId),
      cmd = careDecision(),
      v = await owner.call(`${root(c)}/${a.id}/preview`, cmd, { version: a.version });
    const r = await owner.call(
      `${root(c)}/${a.id}`,
      { ...cmd, confirmed: false, preview: v.payload.data.context },
      { method: "PATCH", version: a.version },
    );
    expect(r.status).toBe(422);
    expect(await count("visitation_cases", c)).toBe(0);
    expect(
      (await owner.call(`${root(c)}/${a.id}/preview`, cmd, { version: a.version + 1 })).status,
    ).toBe(412);
    expect(
      (
        await owner.call(
          `${root(c)}/signals/${n.id}/preview`,
          {
            action: "correct",
            fields: { occurredOn: businessDay(), summary: null },
            target: { kind: "member", id: new ObjectId().toHexString() },
            ...careCommon,
            reason: "bad",
          },
          { version: n.version },
        )
      ).status,
    ).toBe(422);
  });
  test("concurrent signal creation and concurrent decisions do not duplicate source/episode/case/history", async () => {
    const c = await fixture(),
      b = signalCreate(c.people[0]?._id.toHexString() as string),
      p = await owner.call(`${root(c)}/signals/preview`, b);
    const r = await Promise.all(
      [0, 1].map(() =>
        owner.call(`${root(c)}/signals`, {
          ...b,
          preview: p.payload.data.context,
          confirmed: true,
        }),
      ),
    );
    expect(r.filter((r) => r.status === 201)).toHaveLength(1);
    expect(r.filter((r) => [409, 412].includes(r.status))).toHaveLength(1);
    expect(await count("care_signals", c)).toBe(1);
    expect(await count("care_alerts", c)).toBe(1);
    const a = await careOpenAlert(db, c, c.people[0]?._id.toHexString() as string),
      cmd = careDecision(),
      v = await owner.call(`${root(c)}/${a.id}/preview`, cmd, { version: a.version }),
      rs = await Promise.all(
        [0, 1].map(() =>
          owner.call(
            `${root(c)}/${a.id}`,
            { ...cmd, preview: v.payload.data.context, confirmed: true },
            { method: "PATCH", version: a.version },
          ),
        ),
      );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => [409, 412].includes(r.status))).toHaveLength(1);
    expect(await count("visitation_cases", c)).toBe(1);
    expect(await count("care_history", c, { resourceKind: "alert", event: "convert" })).toBe(1);
    expect(await count("visitation_history", c, { event: "create" })).toBe(1);
  });
  test("signal corrections preserve target snapshot; ended/historical source can be corrected without reopening", async () => {
    const c = await fixture(),
      n = await need(c),
      old = await detail(c, n.id, true);
    await db.db.collection("members").updateOne(
      { _id: new ObjectId(n.targetId) },
      {
        $set: { fullName: "Tên hiện tại synthetic", participation: "transferred" },
        $inc: { version: 1 },
      },
    );
    const end = await signalSave(
      owner,
      c,
      { action: "end", ...careCommon, reason: "Không còn nhu cầu" },
      n.id,
      n.version,
    );
    expect(end.status).toBe(200);
    const correct = await signalSave(
      owner,
      c,
      {
        action: "correct",
        fields: { occurredOn: shiftDay(businessDay(), -1), summary: "Đính chính lịch sử" },
        ...careCommon,
        reason: "Sửa ghi chú cũ",
      },
      n.id,
      end.payload.data.version,
    );
    expect(correct.status).toBe(200);
    const d = await detail(c, n.id, true);
    expect(d.record.state).toBe("ended");
    expect(d.record.targetSnapshot).toEqual(old.record.targetSnapshot);
    expect(d.current.available).toBe(false);
    expect(await count("care_alerts", c, { episodeActive: true })).toBe(0);
  });
  test("invalid targets, mismatched source kind and future dates cannot create actionable work", async () => {
    const c = await fixture(),
      person = c.people[0];
    if (!person) throw Error();
    for (const body of [
      signalCreate(person._id.toHexString(), "illness", { occurredOn: shiftDay(businessDay(), 1) }),
      {
        ...signalCreate(person._id.toHexString()),
        target: { kind: "family", id: person.familyId.toHexString() },
      },
      signalCreate(new ObjectId().toHexString()),
    ])
      expect((await owner.call(`${root(c)}/signals/preview`, body)).status).toBe(422);
    await db.db
      .collection("members")
      .updateOne(
        { _id: person._id },
        { $set: { participation: "deceased" }, $inc: { version: 1 } },
      );
    expect(
      (await owner.call(`${root(c)}/signals/preview`, signalCreate(person._id.toHexString())))
        .status,
    ).toBe(422);
    expect(await count("care_signals", c)).toBe(0);
    expect(await count("visitation_cases", c)).toBe(0);
  });
  test("source drift before confirmation and after proposal cannot commit stale case snapshot", async () => {
    const c = await fixture(),
      n = await need(c),
      a = await careOpenAlert(db, c, n.targetId),
      b = careDecision(),
      p = await owner.call(`${root(c)}/${a.id}/preview`, b, { version: a.version });
    await db.db
      .collection("members")
      .updateOne(
        { _id: new ObjectId(n.targetId) },
        { $set: { fullName: "Đổi trước confirm" }, $inc: { version: 1 } },
      );
    expect(
      (
        await owner.call(
          `${root(c)}/${a.id}`,
          { ...b, preview: p.payload.data.context, confirmed: true },
          { method: "PATCH", version: a.version },
        )
      ).status,
    ).toBe(412);
    const fresh = await owner.call(`${root(c)}/${a.id}/preview`, b, { version: a.version }),
      original = CareSources.prototype.fence;
    let changed = false;
    const hook = spyOn(CareSources.prototype, "fence").mockImplementation(async function (
      this: CareSources,
      ...args
    ) {
      if (!changed) {
        changed = true;
        await db.db
          .collection("members")
          .updateOne(
            { _id: new ObjectId(n.targetId) },
            { $set: { participation: "transferred" }, $inc: { version: 1 } },
          );
      }
      return original.apply(this, args);
    });
    try {
      const r = await owner.call(
        `${root(c)}/${a.id}`,
        { ...b, preview: fresh.payload.data.context, confirmed: true },
        { method: "PATCH", version: a.version },
      );
      expect([409, 412]).toContain(r.status);
    } finally {
      hook.mockRestore();
    }
    expect(await count("visitation_cases", c)).toBe(0);
    expect((await careOpenAlert(db, c, n.targetId)).state).toBe("pending");
  });
  test("Care audit failure rolls back already-created Visitation root/history/audit plus alert and operation", async () => {
    const c = await fixture(),
      n = await need(c),
      a = await careOpenAlert(db, c, n.targetId),
      b = careDecision(),
      p = await owner.call(`${root(c)}/${a.id}/preview`, b, { version: a.version }),
      original = Audit.prototype.organization,
      hook = spyOn(Audit.prototype, "organization").mockImplementation(async function (
        this: Audit,
        ...args
      ) {
        if (args[0] === "care.alert.convert") throw Error("Synthetic Care audit failure");
        return original.apply(this, args);
      });
    try {
      expect(
        (
          await owner.call(
            `${root(c)}/${a.id}`,
            { ...b, preview: p.payload.data.context, confirmed: true },
            { method: "PATCH", version: a.version },
          )
        ).status,
      ).toBe(503);
    } finally {
      hook.mockRestore();
    }
    expect(await count("visitation_cases", c)).toBe(0);
    expect(await count("visitation_history", c)).toBe(0);
    expect(await count("care_history", c, { event: "convert" })).toBe(0);
    expect(await count("audit_events", c, { eventType: "visitation.create" })).toBe(0);
    expect((await careOpenAlert(db, c, n.targetId)).state).toBe("pending");
  });
  test("real committed ACK loss receipt/replay yields one case and one decision with same key", async () => {
    const c = await fixture(),
      n = await need(c),
      a = await careOpenAlert(db, c, n.targetId),
      b = careDecision(),
      p = await owner.call(`${root(c)}/${a.id}/preview`, b, { version: a.version }),
      intent = { ...b, preview: p.payload.data.context, confirmed: true },
      key = crypto.randomUUID(),
      start = db.client.startSession.bind(db.client),
      hook = spyOn(db.client, "startSession").mockImplementation((...args) => {
        const tx = start(...args),
          commit = tx.commitTransaction.bind(tx);
        tx.commitTransaction = async () => {
          await commit();
          const e = new MongoError("Synthetic committed Care ack loss");
          e.addErrorLabel("UnknownTransactionCommitResult");
          throw e;
        };
        return tx;
      });
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await owner.call(`${root(c)}/${a.id}`, intent, {
        method: "PATCH",
        version: a.version,
        key,
      });
    } finally {
      hook.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(r.payload.error.code).toBe("OUTCOME_UNKNOWN");
    const receipt = await owner.call(`${root(c)}/operations/${r.payload.meta.operationId}`);
    expect(receipt.status).toBe(200);
    expect(receipt.payload.data.safeResult.caseId).toBeTruthy();
    const replay = await owner.call(`${root(c)}/${a.id}`, intent, {
      method: "PATCH",
      version: a.version,
      key,
    });
    expect(replay.status).toBe(200);
    expect(replay.payload.meta.replayed).toBe(true);
    expect(await count("visitation_cases", c)).toBe(1);
    expect(await count("care_history", c, { event: "convert" })).toBe(1);
  });
  test("in-flight revoke aborts decision; prior privileged replay/receipt forbidden after downgrade", async () => {
    const c = await fixture(),
      s = client("church"),
      account = await syntheticUser(owner, s, c, "pastor"),
      n = await need(c, 0, "illness", s),
      a = await careOpenAlert(db, c, n.targetId),
      b = careDecision(),
      p = await s.call(`${root(c, s)}/${a.id}/preview`, b, { version: a.version }),
      original = Care.prototype.decide;
    let changed = false;
    const hook = spyOn(Care.prototype, "decide").mockImplementation(async function (
      this: Care,
      ...args
    ) {
      if (!changed) {
        changed = true;
        await db.db
          .collection("accounts")
          .updateOne(
            { _id: new ObjectId(account.id) },
            { $set: { role: "treasurer" }, $inc: { version: 1 } },
          );
      }
      return original.apply(this, args);
    });
    try {
      const r = await s.call(
        `${root(c, s)}/${a.id}`,
        { ...b, preview: p.payload.data.context, confirmed: true },
        { method: "PATCH", version: a.version },
      );
      expect(r.status).toBe(401);
      expect(r.payload.error.code).toBe("SESSION_REVOKED");
    } finally {
      hook.mockRestore();
    }
    expect(await count("visitation_cases", c)).toBe(0);
    expect((await s.call(`${root(c, s)}/operations/${n.r.payload.data.operationId}`)).status).toBe(
      403,
    );
    expect((await s.call(`${root(c, s)}/signals`, n.r.intent, { key: n.r.key })).status).toBe(403);
  });
  test("lead treasurer member denied all reads, counters, picker, source, refresh, histories and receipts", async () => {
    const c = await fixture(),
      n = await need(c),
      a = await careOpenAlert(db, c, n.targetId),
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
        "/signals",
        `/${a.id}`,
        `/${a.id}/history`,
        `/signals/${n.id}`,
        `/operations/${n.r.payload.data.operationId}`,
      ])
        expect((await s.call(root(c, s) + path)).status).toBe(403);
      expect((await s.call(`${root(c, s)}/evaluate`, { cursor: null, limit: 100 })).status).toBe(
        403,
      );
      expect((await s.call(`${root(c, s)}/signals/preview`, signalCreate(n.targetId))).status).toBe(
        403,
      );
    }
  }, 30000);
  test("pastor secretary and owner share care rights without changing private Prayer boundary", async () => {
    const c = await fixture(),
      s = client("church"),
      secretary = client("church");
    await syntheticUser(owner, s, c, "pastor");
    await syntheticUser(owner, secretary, c, "secretary");
    const n = await need(c),
      before = await owner.call(`${root(c)}?limit=1`),
      beforeContext = before.payload.data.nextCursor;
    for (const scope of ["pastoral", "shared"] as const)
      expect(
        (
          await prayerSave(
            s,
            c,
            prayerCreate(scope, { content: `PRIVATE_CARE_NOT_A_SOURCE_${scope}` }),
          )
        ).status,
      ).toBe(201);
    for (const who of [owner, s, secretary]) {
      expect((await who.call(root(c, who))).payload.data.summary.total).toBe(1);
      expect((await who.call(`${root(c, who)}/signals/${n.id}`)).status).toBe(200);
    }
    await careScan(owner, c);
    expect(await count("care_alerts", c)).toBe(1);
    expect((await owner.call(root(c))).payload.data.items[0].id).toBe(
      before.payload.data.items[0].id,
    );
    expect(beforeContext).toBeNull();
    expect(JSON.stringify((await owner.call(root(c))).payload)).not.toContain(
      "PRIVATE_CARE_NOT_A_SOURCE",
    );
  });
  test("cross tenant, actor receipts and signed paging contexts cannot be reused", async () => {
    const c = await fixture(),
      foreign = await fixture(),
      n = await need(c),
      a = await careOpenAlert(db, c, n.targetId),
      s = client("church");
    await syntheticUser(owner, s, c);
    expect((await owner.call(`${root(foreign)}/${a.id}`)).status).toBe(404);
    expect((await s.call(root(foreign, s))).status).toBe(404);
    expect((await s.call(`${root(c, s)}/operations/${n.r.payload.data.operationId}`)).status).toBe(
      404,
    );
    await need(c, 1);
    const first = await owner.call(`${root(c)}?limit=1`),
      cursor = encodeURIComponent(first.payload.data.nextCursor);
    for (const path of [
      `${root(foreign)}?limit=1&cursor=${cursor}`,
      `${root(c)}?limit=1&state=all&cursor=${cursor}`,
    ])
      expect((await owner.call(path)).status).toBe(400);
    expect((await s.call(`${root(c, s)}?limit=1&cursor=${cursor}`)).status).toBe(400);
  });
  test("batched scans have truthful partial progress, context bound cursor, same-intent replay and no GET side effects", async () => {
    const c = await fixture(9);
    expect((await owner.call(`${base(c)}/overview`)).payload.data.care.pending).toBe(0);
    expect(await count("care_assessments", c)).toBe(0);
    const key = crypto.randomUUID(),
      b = { cursor: null, limit: 2 },
      first = await owner.call(`${root(c)}/evaluate`, b, { key });
    expect(first.status).toBe(200);
    expect(first.payload.data.processed).toBe(2);
    expect(first.payload.data.complete).toBe(false);
    expect(first.payload.data.nextCursor).toBeTruthy();
    const replay = await owner.call(`${root(c)}/evaluate`, b, { key });
    expect(replay.payload.meta.replayed).toBe(true);
    expect(replay.payload.data).toEqual(first.payload.data);
    const foreign = await fixture();
    expect(
      (
        await owner.call(`${root(foreign)}/evaluate`, {
          cursor: first.payload.data.nextCursor,
          limit: 2,
        })
      ).status,
    ).toBe(400);
    await careScan(owner, c, 2);
    const overview = (await owner.call(`${base(c)}/overview`)).payload.data;
    expect(overview.care.complete).toBe(true);
    expect(overview.care.lastCompleteAt).toBeTruthy();
    expect(
      (
        await owner.call(`${root(c)}/evaluate`, {
          cursor: first.payload.data.nextCursor,
          limit: 101,
        })
      ).status,
    ).toBe(422);
  });
  test("a failing scan batch rolls back that batch only, keeps prior committed progress and never expires on source failure", async () => {
    const c = await fixture(9),
      n = await need(c),
      first = await owner.call(`${root(c)}/evaluate`, { cursor: null, limit: 1 }),
      before = await detail(c, (await careOpenAlert(db, c, n.targetId)).id),
      hook = spyOn(CareSources.prototype, "load").mockRejectedValue(
        Error("Synthetic reporting unavailable"),
      );
    try {
      expect(
        (
          await owner.call(`${root(c)}/evaluate`, {
            cursor: first.payload.data.nextCursor,
            limit: 1,
          })
        ).status,
      ).toBe(503);
    } finally {
      hook.mockRestore();
    }
    expect((await detail(c, before.record.id)).record.state).toBe("pending");
    const overview = (await owner.call(`${base(c)}/overview`)).payload.data;
    expect(overview.care.lastEvaluatedAt).toBe(first.payload.data.evaluatedAt);
    expect(overview.care.complete).toBe(false);
    expect(overview.care.pending).toBe(1);
  });
  test("strict methods/query/CSRF/body bounds and metadata-only audit/transport", async () => {
    const c = await fixture(),
      n = await need(c),
      a = await careOpenAlert(db, c, n.targetId);
    for (const query of [
      "limit=101",
      "state=bad",
      "kind=prayer",
      "state=all&state=pending",
      `q=${"x".repeat(101)}`,
    ])
      expect((await owner.call(`${root(c)}?${query}`)).status).toBe(400);
    expect(
      (
        await owner.call(`${root(c)}/signals/preview`, signalCreate(n.targetId), {
          headers: { origin: "https://other.invalid" },
        })
      ).status,
    ).toBe(403);
    expect((await owner.call(`${root(c)}/${a.id}`, undefined, { method: "DELETE" })).status).toBe(
      405,
    );
    expect((await owner.call(`${root(c)}/preview`, careDecision())).status).toBe(404);
    expect(
      (
        await owner.call(`${root(c)}/signals/preview`, {
          ...signalCreate(n.targetId),
          fields: { occurredOn: businessDay(), summary: "x".repeat(17000) },
        })
      ).status,
    ).toBe(413);
    const audit = await db.db
      .collection("audit_events")
      .find({ targetChurchId: new ObjectId(c.id), eventType: { $regex: "^care\\." } })
      .toArray();
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain("Nhu cầu synthetic");
    expect(JSON.stringify(logs)).not.toContain("Nhu cầu synthetic");
    expect(JSON.stringify(logs)).not.toContain("PRIVATE_CARE_NOT_A_SOURCE");
  });
  test("50public corrections traverse bounded signal history without mutation of old snapshots", async () => {
    const c = await fixture(),
      n = await need(c);
    let v = n.version;
    for (let i = 0; i < 50; i++) {
      const b: SignalCommand = {
          action: "correct",
          fields: { occurredOn: businessDay(), summary: `Đính chính nguồn ${i}` },
          ...careCommon,
          reason: `Sửa ${i}`,
        },
        r = await signalSave(owner, c, b, n.id, v);
      expect(r.status).toBe(200);
      if (i === 0) {
        const replay = await owner.call(`${root(c)}/signals/${n.id.toUpperCase()}`, r.intent, {
          method: "PATCH",
          version: v,
          key: r.key,
        });
        expect(replay.status).toBe(200);
        expect(replay.payload.meta.replayed).toBe(true);
      }
      v = r.payload.data.version;
    }
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const r = await owner.call(
        `${root(c)}/signals/${n.id}/history?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(r.status).toBe(200);
      expect(r.payload.data.items.length).toBeLessThanOrEqual(7);
      ids.push(...r.payload.data.items.map((x: { id: string }) => x.id));
      cursor = r.payload.data.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(51);
    expect(new Set(ids).size).toBe(51);
    const oldest = await db.db
      .collection("care_history")
      .findOne({ resourceId: new ObjectId(n.id), event: "create" });
    expect(oldest?.after.summary).toBe("Nhu cầu synthetic");
  });
  test("schema validators and unique active source/episode constraints reject bypass", async () => {
    const c = await fixture(),
      n = await need(c),
      s = await db.db.collection("care_signals").findOne({ _id: new ObjectId(n.id) }),
      a = await db.db.collection("care_alerts").findOne({ churchId: new ObjectId(c.id) });
    if (!s || !a) throw Error();
    await expect(
      db.db
        .collection("care_signals")
        .insertOne({ ...s, _id: new ObjectId(), code: "NC-OTHER-OPEN" }),
    ).rejects.toHaveProperty("code", 11000);
    await expect(
      db.db
        .collection("care_alerts")
        .insertOne({ ...a, _id: new ObjectId(), code: "DN-OTHER-ACTIVE" }),
    ).rejects.toHaveProperty("code", 11000);
    await expect(
      db.db.collection("care_signals").insertOne({ ...s, _id: new ObjectId(), state: "ended" }),
    ).rejects.toHaveProperty("code", 11000);
    await expect(
      db.db
        .collection("care_alerts")
        .insertOne({ ...a, _id: new ObjectId(), episodeActive: false }),
    ).rejects.toHaveProperty("code", 11000);
    await expect(
      db.db.collection("care_alerts").insertOne({
        ...a,
        _id: new ObjectId(),
        code: "DN-INVALID-SCHEMA",
        episodeActive: false,
        availability: "private",
      }),
    ).rejects.toHaveProperty("code", 121);
  });
});
