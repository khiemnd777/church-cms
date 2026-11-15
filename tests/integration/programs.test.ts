import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { Audit } from "../../api/audit/service";
import { config } from "../../api/config";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay } from "../../api/members/dates";
import { ProgramSources } from "../../api/programs/sources";
import type { ProgramCommand, ProgramRow } from "../../api/programs/validation";
import { SyntheticClient, syntheticOwner, syntheticUser } from "../../scripts/p2-fixtures";
import {
  programCommand as cmd,
  p42Fixture,
  p42Save,
  p42Schedule,
  programRoot,
} from "../../scripts/p42-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3476",
  database: `church_cms_test_p42_${crypto.randomUUID().replaceAll("-", "")}`,
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
const fixture = (count = 8) => p42Fixture(db, owner, ownerId, count);
const root = (c: { id: string }, s = owner) => programRoot(c, s);
const create = (c: Awaited<ReturnType<typeof fixture>>) =>
  cmd("create", { unitId: c.unit, occurrenceId: c.occurrence });
async function get(c: { id: string }, id: string, s = owner) {
  const r = await s.call(`${root(c, s)}/drafts/${id}`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
async function made(c: Awaited<ReturnType<typeof fixture>>, s = owner) {
  const r = await p42Save(s, c, create(c));
  expect(r.status).toBe(201);
  return get(c, r.payload.data.programId, s);
}
async function save(
  c: { id: string },
  b: ProgramCommand,
  d: { id: string; version: number },
  s = owner,
) {
  const r = await p42Save(s, c, b, d.id, d.version);
  expect(r.status).toBe(200);
  return get(c, d.id, s);
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
describe("P4.2 real Mongo Redis HTTP", () => {
  test("preview deterministic, seven rows own roster, source snapshots and duplicate root prevention", async () => {
    const c = await fixture(),
      b = create(c),
      p = await owner.call(`${root(c)}/drafts/preview`, b);
    expect(p.status).toBe(200);
    expect(p.payload.data.rows).toHaveLength(7);
    expect(p.payload.data.people.length).toBeGreaterThan(0);
    expect((await owner.call(`${root(c)}/drafts`, b)).status).toBe(412);
    const r = await owner.call(`${root(c)}/drafts`, { ...b, preview: p.payload.data.context });
    expect(r.status).toBe(201);
    const d = await get(c, r.payload.data.programId);
    expect(d.rows).toEqual(p.payload.data.rows);
    expect(d.snapshot.scripture).toBe(c.schedule.input.scripture);
    expect(d.snapshot.unitName).toBe("Ban chương trình synthetic");
    expect((await p42Save(owner, c, b)).status).toBe(409);
    expect(
      await db.db.collection("program_drafts").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
  });
  test("eligibility is current own roster without age/teacher fallback; paged bounded and stable", async () => {
    const c = await fixture(70);
    await db.db
      .collection("members")
      .updateOne(
        { _id: c.people[0]?._id },
        { $set: { birthDate: "2020-01-01" }, $inc: { version: 1 } },
      );
    const q = `unitId=${c.unit}&occurrenceId=${c.occurrence}&limit=2`,
      a = await owner.call(`${root(c)}/people?${q}`);
    expect(a.status).toBe(200);
    expect(a.payload.data.items[0].id).toBe(c.people[0]?._id.toHexString());
    expect(a.payload.data.nextCursor).toBeString();
    const b = await owner.call(
      `${root(c)}/people?${q}&cursor=${encodeURIComponent(a.payload.data.nextCursor)}`,
    );
    expect(b.payload.data.items[0].id).not.toBe(a.payload.data.items[0].id);
    expect(
      (
        await owner.call(
          `${root(c)}/people?${q}&q=other&cursor=${encodeURIComponent(a.payload.data.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await owner.call(
          `${root(c)}/people?unitId=${c.unit}&occurrenceId=${c.occurrence}&limit=101`,
        )
      ).status,
    ).toBe(400);
    const far = c.people.at(-1);
    c.schedule.input.speaker = { source: "member", memberId: far?._id.toHexString() as string };
    await p42Schedule(owner, c, { ...c.schedule, reason: "Đổi người chia sẻ" }, c.occurrence, 1);
    const d = await made(c);
    expect(d.rows.find((r: ProgramRow) => r.templateKey === "word").assignment.memberId).toBe(
      far?._id.toHexString(),
    );
  });
  test("save and regenerate preserve manual fields/order/custom/deleted templates and refresh source", async () => {
    const c = await fixture();
    let d = await made(c);
    const rows: ProgramRow[] = structuredClone(d.rows);
    (rows[0] as ProgramRow).title = "Tiêu đề thủ công";
    (rows[3] as ProgramRow).detail = "Nội dung thủ công";
    (rows[1] as ProgramRow).assignment = { mode: "not_applicable" };
    rows.splice(4, 1);
    rows.reverse();
    rows.push({
      id: crypto.randomUUID(),
      templateKey: null,
      title: "Tiết mục thêm",
      detail: "Manual",
      assignment: { mode: "unassigned" },
    });
    d = await save(c, cmd("save", { rows }), d);
    await p42Schedule(
      owner,
      c,
      { ...c.schedule, input: { ...c.schedule.input, theme: "Nguồn mới" }, reason: "Cập nhật" },
      c.occurrence,
      1,
    );
    expect((await get(c, d.id)).current.changed).toBe(true);
    d = await save(c, cmd("regenerate"), d);
    expect(d.rows.map((r: ProgramRow) => r.id)).toEqual(rows.map((r) => r.id));
    expect(d.rows.find((r: ProgramRow) => r.templateKey === "guide").title).toBe(
      "Tiêu đề thủ công",
    );
    expect(d.rows.find((r: ProgramRow) => r.templateKey === "word").detail).toBe(
      "Nội dung thủ công",
    );
    expect(d.rows.find((r: ProgramRow) => r.templateKey === "discussion")).toBeUndefined();
    expect(d.snapshot.theme).toBe("Nguồn mới");
  });
  test("finalize confirmation, immutable r1, amend latest head r2, bounded editions/history", async () => {
    const c = await fixture();
    let d = await made(c);
    d = await save(
      c,
      cmd("save", {
        rows: d.rows.map((r: ProgramRow, i: number) =>
          i === 0 ? { ...r, assignment: { mode: "unassigned" } } : r,
        ),
      }),
      d,
    );
    expect((await p42Save(owner, c, cmd("finalize"), d.id, d.version)).payload.error.code).toBe(
      "PROGRAM_INCOMPLETE_CONFIRMATION",
    );
    d = await save(c, cmd("finalize", { incompleteConfirmed: true }), d);
    const r1 = (await owner.call(`${root(c)}/drafts/${d.id}/editions`)).payload.data.items[0];
    expect(r1.revision).toBe(1);
    expect(
      (
        await owner.call(`${root(c)}/drafts/${d.id}/preview`, cmd("save", { rows: d.rows }), {
          version: d.version,
        })
      ).status,
    ).toBe(409);
    expect(
      (await owner.call(`${root(c)}/drafts/${d.id}/preview`, cmd("amend"), { version: d.version }))
        .status,
    ).toBe(422);
    d = await save(c, cmd("amend", { reason: "Đính chính" }), d);
    const changed = structuredClone(d.rows);
    changed[0].title = "Bản hai";
    d = await save(c, cmd("save", { rows: changed }), d);
    d = await save(c, cmd("finalize", { reason: "Đính chính", incompleteConfirmed: true }), d);
    expect(d.latestRevision).toBe(2);
    const e = await owner.call(`${root(c)}/drafts/${d.id}/editions?limit=1`);
    expect(e.payload.data.items[0].revision).toBe(2);
    const old = await owner.call(
      `${root(c)}/drafts/${d.id}/editions?limit=1&cursor=${encodeURIComponent(e.payload.data.nextCursor)}`,
    );
    expect(old.payload.data.items[0]).toEqual(r1);
    const h = await owner.call(`${root(c)}/drafts/${d.id}/history?limit=2`);
    expect(h.payload.data.items).toHaveLength(2);
    expect(h.payload.data.nextCursor).toBeString();
  });
  test("invalid retained assignment warns, can save draft, blocks finalization until corrected", async () => {
    const c = await fixture();
    let d = await made(c);
    const id = d.people[0].id;
    await db.db
      .collection("members")
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { participation: "transferred" }, $inc: { version: 1 } },
      );
    d = await get(c, d.id);
    expect(d.current.invalidMemberIds).toContain(id);
    expect(
      (await owner.call(`${root(c)}/drafts/${d.id}/print?version=${d.version}`)).text,
    ).toContain("BẢN LỊCH SỬ");
    d = await save(c, cmd("save", { rows: d.rows }), d);
    expect(d.people.find((p: { id: string }) => p.id === id)).toBeDefined();
    expect(
      (await p42Save(owner, c, cmd("finalize", { incompleteConfirmed: true }), d.id, d.version))
        .status,
    ).toBe(422);
    d = await save(
      c,
      cmd("save", {
        rows: d.rows.map((r: ProgramRow) =>
          r.assignment.mode === "member" && r.assignment.memberId === id
            ? { ...r, assignment: { mode: "unassigned" } }
            : r,
        ),
      }),
      d,
    );
    expect(
      (await p42Save(owner, c, cmd("finalize", { incompleteConfirmed: true }), d.id, d.version))
        .status,
    ).toBe(200);
  });
  test("new foreign/out-of-roster assignment is rejected without mutation", async () => {
    const c = await fixture(),
      other = await fixture(),
      d = await made(c),
      rows = structuredClone(d.rows);
    rows[0].assignment = { mode: "member", memberId: other.people[0]?._id.toHexString() };
    expect(
      (
        await owner.call(`${root(c)}/drafts/${d.id}/preview`, cmd("save", { rows }), {
          version: d.version,
        })
      ).payload.error.code,
    ).toBe("PROGRAM_PERSON_UNAVAILABLE");
    expect((await get(c, d.id)).version).toBe(d.version);
  });
  test("unknown board term differs from known empty roster and blocks finalization", async () => {
    const c = await fixture(),
      board = (await owner.call(`owner/churches/${c.id}/organization/units?kind=board`)).payload
        .data.items[0];
    c.unit = board.id;
    c.schedule.input.unitId = c.unit;
    c.schedule.input.speaker = null;
    c.occurrence = await p42Schedule(owner, c, c.schedule);
    let d = await made(c);
    expect(d.current.rosterAvailable).toBe(false);
    expect(d.rows.every((r: ProgramRow) => r.assignment.mode === "unassigned")).toBe(true);
    expect(
      (await p42Save(owner, c, cmd("finalize", { incompleteConfirmed: true }), d.id, d.version))
        .status,
    ).toBe(422);
    const t = await owner.call(`owner/churches/${c.id}/organization/board-terms`, {
      label: "Nhiệm kỳ synthetic",
      startOn: c.day,
      endOn: c.day,
      appointments: [],
      reason: "Synthetic",
      effectiveOn: businessDay(),
    });
    expect(t.status).toBe(201);
    const term = t.payload.data.term;
    const confirm = await owner.call(
      `owner/churches/${c.id}/organization/board-terms/${term.id}/confirm`,
      { reason: "Xác nhận empty", effectiveOn: businessDay() },
      { version: term.version },
    );
    expect(confirm.status).toBe(200);
    d = await save(c, cmd("regenerate"), d);
    expect(d.current.rosterAvailable).toBe(true);
    expect(d.people).toHaveLength(0);
    expect(
      (await p42Save(owner, c, cmd("finalize", { incompleteConfirmed: true }), d.id, d.version))
        .status,
    ).toBe(200);
  });
  test("cancelled/moved/past source closes writes but archived edition print never leaks new unit source", async () => {
    for (const mode of ["cancelled", "moved", "past"]) {
      const c = await fixture();
      let d = await made(c);
      d = await save(c, cmd("finalize", { incompleteConfirmed: true }), d);
      if (mode === "cancelled")
        await p42Schedule(
          owner,
          c,
          { ...c.schedule, state: "cancelled", reason: "Hủy" },
          c.occurrence,
          1,
        );
      else if (mode === "moved") {
        const u = await owner.call(`owner/churches/${c.id}/organization/units`, {
          kind: "service_ministry",
          name: "Ban nguồn kín",
        });
        await p42Schedule(
          owner,
          c,
          {
            ...c.schedule,
            input: { ...c.schedule.input, unitId: u.payload.data.unit.id, label: "NỘI DUNG KÍN" },
            reason: "Chuyển ban",
          },
          c.occurrence,
          1,
        );
      } else
        await db.db
          .collection("schedule_occurrences")
          .updateOne(
            { _id: new ObjectId(c.occurrence) },
            { $set: { startAt: new Date(Date.now() - 60000), endAt: new Date() } },
          );
      const current = await get(c, d.id);
      expect(current.current.editable).toBe(false);
      if (mode === "moved") {
        expect(current.current.snapshot).toBeNull();
        expect(JSON.stringify(current)).not.toContain("NỘI DUNG KÍN");
      }
      expect(
        (
          await owner.call(`${root(c)}/drafts/${d.id}/preview`, cmd("amend", { reason: "Sửa" }), {
            version: d.version,
          })
        ).status,
      ).toBe(422);
      const r = await owner.call(`${root(c)}/drafts/${d.id}/print?revision=1&version=1`);
      expect(r.status).toBe(200);
      expect(r.text).toContain("BẢN LỊCH SỬ");
      expect(r.text).not.toContain("NỘI DUNG KÍN");
    }
  });
  test("source and member changes stale preview; CAS rejects old version", async () => {
    const c = await fixture(),
      d = await made(c),
      b = cmd("finalize", { incompleteConfirmed: true }),
      p = await owner.call(`${root(c)}/drafts/${d.id}/preview`, b, { version: d.version });
    await db.db
      .collection("members")
      .updateOne(
        { _id: c.people[0]?._id },
        { $set: { fullName: "Tên mới synthetic" }, $inc: { version: 1 } },
      );
    expect(
      (
        await owner.call(
          `${root(c)}/drafts/${d.id}`,
          { ...b, preview: p.payload.data.context },
          { version: d.version, method: "PATCH" },
        )
      ).status,
    ).toBe(412);
    const v = await save(c, cmd("save", { rows: d.rows }), d);
    expect(
      (await owner.call(`${root(c)}/drafts/${d.id}/preview`, b, { version: d.version })).status,
    ).toBe(412);
    expect(v.version).toBe(d.version + 1);
  });
  test("exact replay/receipt, changed payload conflict, one atomic history/edition", async () => {
    const c = await fixture(),
      r = await p42Save(owner, c, create(c));
    const replay = await owner.call(`${root(c)}/drafts`, r.intent, { key: r.key });
    expect(replay.payload.meta.replayed).toBe(true);
    expect(
      (await owner.call(`${root(c)}/drafts`, { ...r.intent, reason: "Other" }, { key: r.key }))
        .status,
    ).toBe(409);
    expect((await owner.call(`${root(c)}/operations/${r.payload.data.operationId}`)).status).toBe(
      200,
    );
    expect(
      await db.db.collection("program_history").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
  });
  test("concurrent create/finalize serializes one root and one edition", async () => {
    const c = await fixture(),
      b = create(c),
      p = await owner.call(`${root(c)}/drafts/preview`, b);
    const results = await Promise.all(
      [1, 2].map(() => owner.call(`${root(c)}/drafts`, { ...b, preview: p.payload.data.context })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => [201, 409, 412].includes(r.status))).toBe(true);
    const d = await get(c, results.find((r) => r.status === 201)?.payload.data.programId),
      f = cmd("finalize", { incompleteConfirmed: true }),
      fp = await owner.call(`${root(c)}/drafts/${d.id}/preview`, f, { version: d.version });
    const finals = await Promise.all(
      [1, 2].map(() =>
        owner.call(
          `${root(c)}/drafts/${d.id}`,
          { ...f, preview: fp.payload.data.context },
          { version: d.version, method: "PATCH" },
        ),
      ),
    );
    expect(finals.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      await db.db.collection("program_editions").countDocuments({ programId: new ObjectId(d.id) }),
    ).toBe(1);
  });
  test("audit failure rolls back root history ledger and source fences", async () => {
    const c = await fixture(),
      b = create(c),
      p = await owner.call(`${root(c)}/drafts/preview`, b),
      fail = spyOn(Audit.prototype, "organization").mockRejectedValueOnce(
        new Error("synthetic audit failure"),
      );
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await owner.call(`${root(c)}/drafts`, { ...b, preview: p.payload.data.context });
    } finally {
      fail.mockRestore();
    }
    expect(r.status).toBe(503);
    for (const n of ["program_drafts", "program_history", "program_editions"])
      expect(await db.db.collection(n).countDocuments({ churchId: new ObjectId(c.id) })).toBe(0);
    expect(
      (await db.db.collection("schedule_occurrences").findOne({ _id: new ObjectId(c.occurrence) }))
        ?.programFence ?? 0,
    ).toBe(0);
  });
  test("real commit acknowledgement loss resolves via scoped receipt with no duplicate", async () => {
    const c = await fixture(),
      b = create(c),
      p = await owner.call(`${root(c)}/drafts/preview`, b),
      key = crypto.randomUUID(),
      intent = { ...b, preview: p.payload.data.context },
      start = db.client.startSession.bind(db.client);
    const fail = spyOn(db.client, "startSession").mockImplementation((...args) => {
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
      lost = await owner.call(`${root(c)}/drafts`, intent, { key });
    } finally {
      fail.mockRestore();
    }
    expect(lost.status).toBe(503);
    expect(lost.payload.error.code).toBe("OUTCOME_UNKNOWN");
    expect(
      (await owner.call(`${root(c)}/operations/${lost.payload.meta.operationId}`)).status,
    ).toBe(200);
    expect((await owner.call(`${root(c)}/drafts`, intent, { key })).payload.meta.replayed).toBe(
      true,
    );
    expect(
      await db.db.collection("program_drafts").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
  });
  test("lead manages own program but not schedule; denies unrelated/foreign/inactive and revoked receipts", async () => {
    const c = await fixture(),
      other = await fixture(),
      lead = client("church"),
      account = await syntheticUser(owner, lead, c, "ministry_lead", [c.unit]);
    const r = await p42Save(lead, c, create(c));
    expect(r.status).toBe(201);
    const id = r.payload.data.programId;
    expect((await get(c, id, lead)).id).toBe(id);
    expect((await lead.call(`${root(c, lead)}/drafts/${id}/history`)).status).toBe(200);
    expect((await lead.call(`${root(c, lead)}/drafts/${id}/print?version=1`)).status).toBe(200);
    expect(
      (await lead.call(`churches/${c.id}/scheduling/occurrences/preview`, c.schedule)).status,
    ).toBe(403);
    expect((await lead.call(`${root(other, lead)}/units`)).status).toBe(404);
    expect(
      (
        await lead.call(
          `${root(c, lead)}/people?unitId=${other.unit}&occurrenceId=${other.occurrence}`,
        )
      ).status,
    ).toBe(404);
    for (const role of ["treasurer", "member"]) {
      const s = client("church");
      await syntheticUser(owner, s, c, role);
      for (const suffix of [
        "units",
        `drafts/${id}`,
        `drafts/${id}/history`,
        `drafts/${id}/print?version=1`,
        `operations/${r.payload.data.operationId}`,
      ])
        expect((await s.call(`${root(c, s)}/${suffix}`)).status).toBe(403);
    }
    await db.db
      .collection("accounts")
      .updateOne(
        { _id: new ObjectId(account.id) },
        { $set: { role: "member", scope: { kind: "self" } }, $inc: { version: 1 } },
      );
    expect(
      (await lead.call(`${root(c, lead)}/operations/${r.payload.data.operationId}`)).status,
    ).toBe(403);
    expect((await lead.call(`${root(c, lead)}/drafts`, r.intent, { key: r.key })).status).toBe(403);
    await db.db
      .collection("organization_units")
      .updateOne(
        { _id: new ObjectId(c.unit) },
        { $set: { status: "inactive" }, $inc: { version: 1 } },
      );
    expect(
      (
        await owner.call(
          `${root(c)}/drafts/${id}/preview`,
          cmd("save", { rows: (await get(c, id)).rows }),
          { version: 1 },
        )
      ).status,
    ).toBe(404);
  });
  test("pastor and secretary manage; cross tenant print/history are scoped; auth and CSRF fresh", async () => {
    const c = await fixture(),
      d = await made(c),
      other = await fixture();
    for (const role of ["pastor", "secretary"]) {
      const s = client("church");
      await syntheticUser(owner, s, c, role);
      expect((await s.call(`${root(c, s)}/drafts/${d.id}`)).status).toBe(200);
      expect(
        (
          await s.call(`${root(c, s)}/drafts/${d.id}/preview`, cmd("save", { rows: d.rows }), {
            version: d.version,
          })
        ).status,
      ).toBe(200);
    }
    for (const suffix of [
      `drafts/${d.id}`,
      `drafts/${d.id}/history`,
      `drafts/${d.id}/print?version=1`,
    ])
      expect((await owner.call(`${root(other)}/${suffix}`)).status).toBe(404);
    const anonymous = client();
    expect((await anonymous.call(`${root(c)}/drafts/${d.id}/print?version=1`)).status).toBe(401);
    expect(
      (
        await owner.call(`${root(c)}/drafts/preview`, create(c), {
          headers: { origin: "https://elsewhere.test" },
        })
      ).status,
    ).toBe(403);
  });
  test("edition deep link selects exact immutable revision beyond first page, strict query and tenant", async () => {
    const c = await fixture();
    let d = await made(c);
    d = await save(c, cmd("finalize", { incompleteConfirmed: true }), d);
    const original = await db.db
      .collection("program_editions")
      .findOne({ programId: new ObjectId(d.id), revision: 1 });
    if (!original) throw Error("fixture");
    // Explicit pagination volume fixture, not 30 public amendments.
    await db.db.collection("program_editions").insertMany(
      Array.from({ length: 29 }, (_, i) => ({
        ...original,
        _id: new ObjectId(),
        revision: i + 2,
      })),
    );
    const page = await owner.call(`${root(c)}/drafts/${d.id}/editions`);
    expect(page.payload.data.items).toHaveLength(25);
    expect(page.payload.data.items.some((e: { revision: number }) => e.revision === 1)).toBe(false);
    const exact = await owner.call(`${root(c)}/drafts/${d.id}/editions?revision=1`);
    expect(exact.status).toBe(200);
    expect(exact.payload.data.items).toHaveLength(1);
    expect(exact.payload.data.items[0].revision).toBe(1);
    for (const revision of ["0", "bad", "9007199254740992", ""])
      expect(
        (await owner.call(`${root(c)}/drafts/${d.id}/editions?revision=${revision}`)).status,
      ).toBe(400);
    expect((await owner.call(`${root(c)}/drafts/${d.id}/editions?revision=31`)).status).toBe(404);
    const other = await fixture();
    expect((await owner.call(`${root(other)}/drafts/${d.id}/editions?revision=1`)).status).toBe(
      404,
    );
  });
  test("source race after proposal cannot commit stale calendar/member/unit into an edition", async () => {
    for (const boundary of ["calendar", "member", "unit"]) {
      const c = await fixture(),
        d = await made(c),
        body = cmd("finalize", { incompleteConfirmed: true }),
        p = await owner.call(`${root(c)}/drafts/${d.id}/preview`, body, { version: d.version }),
        original = ProgramSources.prototype.fence;
      let changed = false;
      const fence = spyOn(ProgramSources.prototype, "fence").mockImplementation(async function (
        this: ProgramSources,
        ...args: Parameters<ProgramSources["fence"]>
      ) {
        if (!changed) {
          changed = true;
          if (boundary === "calendar")
            await db.db
              .collection("schedule_occurrences")
              .updateOne(
                { _id: new ObjectId(c.occurrence) },
                { $set: { state: "cancelled" }, $inc: { version: 1 } },
              );
          else if (boundary === "member")
            await db.db
              .collection("members")
              .updateOne(
                { _id: c.people[0]?._id },
                { $set: { participation: "transferred" }, $inc: { version: 1 } },
              );
          else
            await db.db
              .collection("organization_units")
              .updateOne(
                { _id: new ObjectId(c.unit) },
                { $set: { status: "inactive" }, $inc: { version: 1 } },
              );
        }
        return original.apply(this, args);
      });
      let r: Awaited<ReturnType<SyntheticClient["call"]>>;
      try {
        r = await owner.call(
          `${root(c)}/drafts/${d.id}`,
          { ...body, preview: p.payload.data.context },
          { method: "PATCH", version: d.version },
        );
      } finally {
        fence.mockRestore();
      }
      expect([404, 409, 412, 422]).toContain(r.status);
      expect([
        "NOT_FOUND",
        "OPERATION_IN_PROGRESS",
        "PROGRAM_SOURCE_UNAVAILABLE",
        "PROGRAM_PREVIEW_STALE",
      ]).toContain(r.payload.error.code);
      expect(
        await db.db
          .collection("program_editions")
          .countDocuments({ programId: new ObjectId(d.id) }),
      ).toBe(0);
      expect((await get(c, d.id)).version).toBe(d.version);
    }
  });
  test("strict inputs, 50/51 rows, 16KiB, print escaping and archived stale draft version", async () => {
    const c = await fixture();
    let d = await made(c);
    const row = (): ProgramRow => ({
      id: crypto.randomUUID(),
      templateKey: null,
      title: "<script>unsafe</script>",
      detail: "& synthetic",
      assignment: { mode: "not_applicable" },
    });
    const fifty = Array.from({ length: 50 }, row);
    d = await save(c, cmd("save", { rows: fifty }), d);
    expect(
      (
        await owner.call(
          `${root(c)}/drafts/${d.id}/preview`,
          cmd("save", { rows: [...fifty, row()] }),
          { version: d.version },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await owner.call(
          `${root(c)}/drafts/${d.id}/preview`,
          cmd("save", { rows: fifty.map((r) => ({ ...r, detail: "x".repeat(1000) })) }),
          { version: d.version },
        )
      ).status,
    ).toBe(413);
    const p = await owner.call(`${root(c)}/drafts/${d.id}/print?version=${d.version}`);
    expect(p.status).toBe(200);
    expect(p.text).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
    expect(p.text).not.toContain("<script>unsafe");
    expect(p.text).toContain("BẢN NHÁP");
    expect((await owner.call(`${root(c)}/drafts/${d.id}/print?version=1`)).status).toBe(412);
    expect(
      (
        await owner.call(
          `${root(c)}/drafts/${d.id}/print?version=${d.version}&version=${d.version}`,
        )
      ).status,
    ).toBe(400);
  });
});
