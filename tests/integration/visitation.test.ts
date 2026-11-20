import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { MongoError, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { Audit } from "../../api/audit/service";
import { config } from "../../api/config";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../../api/members/dates";
import { VisitationSources } from "../../api/visitation/sources";
import type { VisitCommand, VisitEntryInput } from "../../api/visitation/validation";
import { SyntheticClient, syntheticOwner, syntheticUser } from "../../scripts/p2-fixtures";
import {
  careCommon,
  careCreate,
  careRecord,
  careRoot,
  careSave,
  careUpdate,
  p43Fixture,
} from "../../scripts/p43-fixtures";

const conf = {
  ...config(),
  origin: "https://localhost:3480",
  database: `church_cms_test_p43_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
if (!["localhost", "127.0.0.1"].includes(new URL(conf.mongoUrl).hostname))
  throw Error("Local synthetic only");
const routeDir = `/tmp/church-p43-route-${crypto.randomUUID()}`;
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let app: ReturnType<typeof createApp>, owner: SyntheticClient, actorId: string;
const client = (realm: "owner" | "church" = "owner") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => app(req, { ip }));
};
const fixture = (count = 12) => p43Fixture(db, owner, actorId, count),
  root = (c: { id: string }, s = owner) => careRoot(c, s);
async function get(c: { id: string }, id: string, s = owner) {
  const r = await s.call(`${root(c, s)}/cases/${id}`);
  expect(r.status).toBe(200);
  return r.payload.data;
}
async function made(c: Awaited<ReturnType<typeof fixture>>, b = careCreate(c.target), s = owner) {
  const r = await careSave(s, c, b);
  expect(r.status).toBe(201);
  return get(c, r.payload.data.caseId, s);
}
async function save(
  c: { id: string },
  d: { id: string; version: number },
  b: VisitCommand,
  s = owner,
) {
  const r = await careSave(s, c, b, d.id, d.version);
  expect(r.status).toBe(200);
  return get(c, d.id, s);
}
const entries = async (c: { id: string }, d: { id: string }) =>
  (await owner.call(`${root(c)}/cases/${d.id}/entries`)).payload.data.items;
const closing = (
  action: "complete" | "cancel",
  reason: string | null = null,
  confirmed = true,
): VisitCommand => ({ action, ...careCommon, reason, confirmed });
function correction(
  e: {
    id: string;
    version: number;
    visitedOn: string;
    participantIds: string[];
    outcome: VisitEntryInput["outcome"];
    note: string;
  },
  extra: Partial<VisitEntryInput> = {},
  reason = "Đính chính synthetic",
): VisitCommand {
  return {
    action: "correct",
    ...careCommon,
    entryId: e.id,
    entryVersion: e.version,
    entry: {
      visitedOn: e.visitedOn,
      participantIds: e.participantIds,
      outcome: e.outcome,
      note: e.note,
      ...extra,
    },
    reason,
  };
}
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  await mkdir(routeDir);
  await Bun.write(`${routeDir}/index.html`, "<!doctype html><title>Synthetic app shell</title>");
  app = createApp(identity, conf, { log: () => {}, dist: routeDir });
  owner = client();
  actorId = (await syntheticOwner(db, owner)).id;
});
afterAll(async () => {
  await rm(routeDir, { recursive: true, force: true });
  await db.db.dropDatabase();
  expect(
    (await db.client.db("admin").admin().listDatabases()).databases.some(
      (d) => d.name === conf.database,
    ),
  ).toBe(false);
  await rate.client.quit();
  await db.client.close();
});
describe("P4.3 real Mongo Redis HTTP", () => {
  test("both W08 deep links serve SPA while unknown routes stay404", async () => {
    for (const path of ["/owner/churches/0123456789abcdef01234567/care", "/SYNTHETIC/care"]) {
      const r = await app(new Request(`${conf.origin}${path}`), { ip: crypto.randomUUID() });
      expect(r.status).toBe(200);
      expect(await r.text()).toContain("Synthetic app shell");
    }
    expect(
      (
        await app(
          new Request(`${conf.origin}/owner/churches/0123456789abcdef01234567/care-unknown`),
          { ip: crypto.randomUUID() },
        )
      ).status,
    ).toBe(404);
  });
  test("preview required, member/family snapshots, assignment nullable and no profile/caregiver/role writes", async () => {
    const c = await fixture(),
      before = await db.db.collection("members").findOne({ _id: c.people[0]?._id }),
      b = careCreate(c.target);
    expect((await owner.call(`${root(c)}/cases`, b)).status).toBe(412);
    const d = await made(c, b);
    expect(d.targetSnapshot.name).toBe(c.people[0]?.fullName);
    expect(d.assigneeId).toBeNull();
    expect(d.state).toBe("open");
    expect(d.code).toMatch(/^TV-/);
    const f = await made(
      c,
      careCreate(
        { kind: "family", id: c.families[0]?._id.toHexString() as string },
        { reasonCode: "bereavement" },
      ),
    );
    expect(f.targetSnapshot.familyId).toBe(c.families[0]?._id.toHexString());
    expect(f.targetSnapshot.phone).toBeNull();
    const after = await db.db.collection("members").findOne({ _id: c.people[0]?._id });
    for (const field of ["version", "visitor", "assignment", "participation"])
      expect(after?.[field]).toEqual(before?.[field]);
  });
  test("one open case per exact target/category, different categories/target kinds allowed, new after cancellation", async () => {
    const c = await fixture(),
      d = await made(c);
    expect(
      (await owner.call(`${root(c)}/cases/preview`, careCreate(c.target))).payload.error.code,
    ).toBe("VISIT_CASE_EXISTS");
    expect((await made(c, careCreate(c.target, { reasonCode: "illness" }))).state).toBe("open");
    expect(
      (
        await made(
          c,
          careCreate({ kind: "family", id: c.families[0]?._id.toHexString() as string }),
        )
      ).state,
    ).toBe("open");
    await save(c, d, closing("cancel", "Đóng trùng nhu cầu"));
    expect((await made(c)).id).not.toBe(d.id);
  });
  test("not_met/declined do not complete; visited explicit confirmation closes; closed case edits denied", async () => {
    const c = await fixture();
    let d = await made(c);
    for (const outcome of ["not_met", "declined"] as const)
      d = await save(c, d, careRecord([c.target.id], { outcome }));
    expect(d.entryCount).toBe(2);
    expect(d.visitedCount).toBe(0);
    expect(
      (
        await owner.call(`${root(c)}/cases/${d.id}/preview`, closing("complete"), {
          version: d.version,
        })
      ).payload.error.code,
    ).toBe("VISIT_NEEDS_VISITED_ENTRY");
    d = await save(c, d, careRecord([c.target.id]));
    expect(d.state).toBe("open");
    expect(
      (await careSave(owner, c, closing("complete", null, false), d.id, d.version)).payload.error
        .code,
    ).toBe("VISIT_CONFIRMATION_REQUIRED");
    d = await save(c, d, closing("complete"));
    expect(d.state).toBe("completed");
    for (const b of [careUpdate(d), careRecord([c.target.id]), closing("cancel", "Không mở lại")])
      expect(
        (await owner.call(`${root(c)}/cases/${d.id}/preview`, b, { version: d.version })).payload
          .error.code,
      ).toBe("VISIT_CASE_CLOSED");
  });
  test("correction preserves before/after and entry count on closed case; cannot erase last visited", async () => {
    const c = await fixture();
    let d = await made(c);
    d = await save(c, d, careRecord([c.target.id]));
    const e = (await entries(c, d))[0];
    d = await save(c, d, closing("complete"));
    d = await save(c, d, correction(e, { note: "Sửa ghi chú đã đóng" }));
    expect(d.state).toBe("completed");
    expect(d.entryCount).toBe(1);
    expect((await entries(c, d))[0].version).toBe(2);
    expect(
      (
        await owner.call(
          `${root(c)}/cases/${d.id}/preview`,
          correction((await entries(c, d))[0], { outcome: "not_met" }),
          { version: d.version },
        )
      ).payload.error.code,
    ).toBe("VISIT_COMPLETION_INVALID");
    const h = (await owner.call(`${root(c)}/cases/${d.id}/history`)).payload.data.items[0];
    expect(h.before.entry.note).toBe("Kết quả synthetic");
    expect(h.after.entry.note).toBe("Sửa ghi chú đã đóng");
  });
  test("entry correction changes visited count exactly and old entry CAS cannot overwrite", async () => {
    const c = await fixture();
    let d = await made(c);
    d = await save(c, d, careRecord([c.target.id], { outcome: "not_met" }));
    const e = (await entries(c, d))[0];
    d = await save(c, d, correction(e, { outcome: "visited" }));
    expect(d.visitedCount).toBe(1);
    expect(
      (await owner.call(`${root(c)}/cases/${d.id}/preview`, correction(e), { version: d.version }))
        .status,
    ).toBe(412);
  });
  test("future denied, prior-to-case date needs reason; cancellation/correction need reason", async () => {
    const c = await fixture();
    let d = await made(c);
    expect(
      (
        await owner.call(
          `${root(c)}/cases/${d.id}/preview`,
          careRecord([c.target.id], { visitedOn: shiftDay(businessDay(), 1) }),
          { version: d.version },
        )
      ).payload.error.code,
    ).toBe("VISIT_FUTURE_DATE");
    const past = careRecord([c.target.id], { visitedOn: shiftDay(businessDay(), -1) });
    expect(
      (await owner.call(`${root(c)}/cases/${d.id}/preview`, past, { version: d.version })).payload
        .error.code,
    ).toBe("REASON_REQUIRED");
    d = await save(c, d, { ...past, reason: "Bổ sung lần thăm trước khi lập hồ sơ" });
    expect(
      (
        await owner.call(`${root(c)}/cases/${d.id}/preview`, closing("cancel"), {
          version: d.version,
        })
      ).payload.error.code,
    ).toBe("REASON_REQUIRED");
  });
  test("foreign/missing/inactive targets, assignees, participants rejected; no subject relink", async () => {
    const c = await fixture(),
      other = await fixture();
    for (const target of [
      other.target,
      { kind: "family" as const, id: other.families[0]?._id.toHexString() as string },
    ])
      expect((await owner.call(`${root(c)}/cases/preview`, careCreate(target))).status).toBe(422);
    expect(
      (
        await owner.call(
          `${root(c)}/cases/preview`,
          careCreate(c.target, { assigneeId: other.target.id }),
        )
      ).payload.error.code,
    ).toBe("VISIT_ASSIGNEE_UNAVAILABLE");
    let d = await made(c);
    expect(
      (
        await owner.call(`${root(c)}/cases/${d.id}/preview`, careRecord([other.target.id]), {
          version: d.version,
        })
      ).payload.error.code,
    ).toBe("VISIT_PARTICIPANT_UNAVAILABLE");
    d = await save(c, d, careRecord([c.target.id]));
    expect(
      (
        await owner.call(
          `${root(c)}/cases/${d.id}/preview`,
          { ...careUpdate(d), target: other.target },
          { version: d.version },
        )
      ).status,
    ).toBe(422);
    expect((await get(c, d.id)).target).toEqual(c.target);
  });
  test("assignee loss warns and blocks entries; explicit unassign/reassign restores; no automatic replacement", async () => {
    const c = await fixture(),
      assignee = c.people[1]?._id.toHexString() as string;
    let d = await made(c, careCreate(c.target, { assigneeId: assignee }));
    await db.db
      .collection("members")
      .updateOne(
        { _id: new ObjectId(assignee) },
        { $set: { participation: "transferred" }, $inc: { version: 1 } },
      );
    d = await get(c, d.id);
    expect(d.current.assigneeAvailable).toBe(false);
    expect(d.assignee.id).toBe(assignee);
    expect(
      (
        await owner.call(`${root(c)}/cases/${d.id}/preview`, careRecord([c.target.id]), {
          version: d.version,
        })
      ).payload.error.code,
    ).toBe("VISIT_ASSIGNEE_UNAVAILABLE");
    d = await save(c, d, careUpdate(d, { assigneeId: null }));
    expect(d.assigneeId).toBeNull();
    expect((await save(c, d, careRecord([c.target.id]))).entryCount).toBe(1);
  });
  test("family merge and member loss preserve snapshot, block new business, allow reasoned close/history correction", async () => {
    const c = await fixture();
    let d = await made(c);
    d = await save(c, d, careRecord([c.target.id]));
    const e = (await entries(c, d))[0],
      snapshot = d.targetSnapshot;
    await db.db.collection("members").updateOne(
      { _id: new ObjectId(c.target.id) },
      {
        $set: { participation: "deceased", fullName: "Tên nguồn đã thay" },
        $inc: { version: 1 },
      },
    );
    d = await get(c, d.id);
    expect(d.targetSnapshot).toEqual(snapshot);
    expect(d.current.targetAvailable).toBe(false);
    expect(
      (
        await owner.call(
          `${root(c)}/cases/${d.id}/preview`,
          careRecord([c.people[1]?._id.toHexString() as string]),
          { version: d.version },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await owner.call(`${root(c)}/cases/${d.id}/preview`, closing("complete"), {
          version: d.version,
        })
      ).payload.error.code,
    ).toBe("REASON_REQUIRED");
    d = await save(c, d, closing("complete", "Nguồn đã thay đổi, đóng hồ sơ đã có lần gặp"));
    d = await save(c, d, correction(e, { note: "Đính chính sau khi nguồn đóng" }));
    expect((await entries(c, d))[0].participants[0].fullName).toBe(c.people[0]?.fullName);
    const f = await made(
      c,
      careCreate({ kind: "family", id: c.families[0]?._id.toHexString() as string }),
    );
    await db.db
      .collection("families")
      .updateOne(
        { _id: c.families[0]?._id },
        { $set: { status: "merged", mergedIntoId: c.families[1]?._id }, $inc: { version: 1 } },
      );
    const changed = await get(c, f.id);
    expect(changed.current.targetAvailable).toBe(false);
    expect(changed.target.id).toBe(f.target.id);
    expect(
      (await save(c, changed, closing("cancel", "Gia đình đã gộp, cần hồ sơ đúng đối tượng")))
        .state,
    ).toBe("cancelled");
  });
  test("live contact drift warns without overwriting creation or earlier entry snapshots", async () => {
    const c = await fixture();
    let d = await made(c);
    d = await save(c, d, careRecord([c.target.id]));
    const e = (await entries(c, d))[0];
    await db.db
      .collection("members")
      .updateOne(
        { _id: new ObjectId(c.target.id) },
        { $set: { phone: "0911111111", fullName: "Tên mới synthetic" }, $inc: { version: 1 } },
      );
    d = await get(c, d.id);
    expect(d.current.changed).toBe(true);
    expect(d.targetSnapshot.name).toBe(c.people[0]?.fullName);
    expect(d.current.target.phone).toBe("0911111111");
    d = await save(c, d, careRecord([c.target.id]));
    expect((await entries(c, d))[0].targetSnapshot.name).toBe("Tên mới synthetic");
    expect((await entries(c, d))[1].targetSnapshot).toEqual(e.targetSnapshot);
  });
  test("paged source pickers/filters/counts/history with signed context, strict query and overdue", async () => {
    const c = await fixture(120);
    const fullName = await owner.call(
      `${root(c)}/people?q=${encodeURIComponent(c.people[0]?.fullName as string)}`,
    );
    expect(fullName.payload.data.items[0].id).toBe(c.target.id);
    const p = await owner.call(`${root(c)}/people?limit=2`);
    expect(p.payload.data.items).toHaveLength(2);
    const next = await owner.call(
      `${root(c)}/people?limit=2&cursor=${encodeURIComponent(p.payload.data.nextCursor)}`,
    );
    expect(next.payload.data.items[0].id).not.toBe(p.payload.data.items[0].id);
    expect(
      (
        await owner.call(
          `${root(c)}/people?kind=family&cursor=${encodeURIComponent(p.payload.data.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
    const f = await owner.call(`${root(c)}/people?kind=family&limit=2`);
    expect(f.payload.data.items).toHaveLength(2);
    const a = await made(
      c,
      careCreate(c.target, {
        priority: "high",
        assigneeId: c.target.id,
        plannedOn: shiftDay(businessDay(), -1),
      }),
    );
    await made(c, careCreate(c.target, { reasonCode: "illness" }));
    const page = await owner.call(`${root(c)}/cases?limit=1`);
    expect(page.payload.data.summary.total).toBe(2);
    const assigned = await owner.call(`${root(c)}/cases?assigneeId=${c.target.id}`);
    expect(assigned.payload.data.summary.total).toBe(1);
    expect(assigned.payload.data.items[0].id).toBe(a.id);
    expect(page.payload.data.nextCursor).toBeString();
    expect((await owner.call(`${root(c)}/cases?overdue=true`)).payload.data.items[0].id).toBe(a.id);
    expect(
      (
        await owner.call(
          `${root(c)}/cases?priority=normal&cursor=${encodeURIComponent(page.payload.data.nextCursor)}`,
        )
      ).status,
    ).toBe(400);
    for (const suffix of [
      "cases?limit=101",
      "cases?from=bad",
      "cases?from=2026-12-01&to=2026-11-01",
      "cases?state=bad",
      "cases?secret=1",
      "people?kind=unknown",
    ])
      expect((await owner.call(`${root(c)}/${suffix}`)).status).toBe(400);
    let d = a;
    for (let i = 0; i < 3; i++) d = await save(c, d, careRecord([c.target.id]));
    for (const suffix of ["entries", "history"]) {
      const rows = await owner.call(`${root(c)}/cases/${d.id}/${suffix}?limit=1`);
      expect(rows.payload.data.items).toHaveLength(1);
      expect(rows.payload.data.nextCursor).toBeString();
    }
  });
  test("exact replay/scoped receipt and changed payload conflict, no duplicate history", async () => {
    const c = await fixture(),
      r = await careSave(owner, c, careCreate(c.target));
    expect(r.status).toBe(201);
    expect(
      (await owner.call(`${root(c)}/cases`, r.intent, { key: r.key })).payload.meta.replayed,
    ).toBe(true);
    expect(
      (await owner.call(`${root(c)}/cases`, { ...r.intent, reason: "Khác" }, { key: r.key }))
        .status,
    ).toBe(409);
    expect((await owner.call(`${root(c)}/operations/${r.payload.data.operationId}`)).status).toBe(
      200,
    );
    expect(
      await db.db.collection("visitation_history").countDocuments({ churchId: new ObjectId(c.id) }),
    ).toBe(1);
  });
  test("concurrent duplicate creation one winner; correction vs completion serializes parent CAS", async () => {
    const c = await fixture(),
      b = careCreate(c.target),
      p = await owner.call(`${root(c)}/cases/preview`, b);
    const results = await Promise.all(
      [1, 2].map(() => owner.call(`${root(c)}/cases`, { ...b, preview: p.payload.data.context })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => [201, 409, 412].includes(r.status))).toBe(true);
    let d = await get(c, results.find((r) => r.status === 201)?.payload.data.caseId);
    d = await save(c, d, careRecord([c.target.id]));
    const a = closing("complete"),
      update = careUpdate(d, { priority: "high" }),
      previews = await Promise.all(
        [a, update].map((b) =>
          owner.call(`${root(c)}/cases/${d.id}/preview`, b, { version: d.version }),
        ),
      );
    const commits = await Promise.all(
      [a, update].map((b, i) =>
        owner.call(
          `${root(c)}/cases/${d.id}`,
          { ...b, preview: previews[i]?.payload.data.context },
          { method: "PATCH", version: d.version },
        ),
      ),
    );
    expect(commits.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await get(c, d.id)).version).toBe(d.version + 1);
  });
  test("audit failure rolls back case entry counters history and source fence", async () => {
    const c = await fixture(),
      d = await made(c),
      b = careRecord([c.target.id]),
      p = await owner.call(`${root(c)}/cases/${d.id}/preview`, b, { version: d.version }),
      before = await db.db.collection("members").findOne({ _id: new ObjectId(c.target.id) }),
      fail = spyOn(Audit.prototype, "organization").mockRejectedValueOnce(
        new Error("synthetic audit failure"),
      );
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await owner.call(
        `${root(c)}/cases/${d.id}`,
        { ...b, preview: p.payload.data.context },
        { method: "PATCH", version: d.version },
      );
    } finally {
      fail.mockRestore();
    }
    expect(r.status).toBe(503);
    expect((await get(c, d.id)).entryCount).toBe(0);
    expect(
      await db.db.collection("visitation_entries").countDocuments({ caseId: new ObjectId(d.id) }),
    ).toBe(0);
    expect(
      await db.db.collection("visitation_history").countDocuments({ caseId: new ObjectId(d.id) }),
    ).toBe(1);
    expect(
      (await db.db.collection("members").findOne({ _id: new ObjectId(c.target.id) }))?.writeFence,
    ).toBe(before?.writeFence);
  });
  test("real committed acknowledgement loss uses receipt/exact replay without duplicate entry", async () => {
    const c = await fixture(),
      d = await made(c),
      b = careRecord([c.target.id]),
      p = await owner.call(`${root(c)}/cases/${d.id}/preview`, b, { version: d.version }),
      intent = { ...b, preview: p.payload.data.context },
      key = crypto.randomUUID(),
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
    let r: Awaited<ReturnType<SyntheticClient["call"]>>;
    try {
      r = await owner.call(`${root(c)}/cases/${d.id}`, intent, {
        method: "PATCH",
        version: d.version,
        key,
      });
    } finally {
      fail.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(r.payload.error.code).toBe("OUTCOME_UNKNOWN");
    expect((await owner.call(`${root(c)}/operations/${r.payload.meta.operationId}`)).status).toBe(
      200,
    );
    expect(
      (
        await owner.call(`${root(c)}/cases/${d.id}`, intent, {
          method: "PATCH",
          version: d.version,
          key,
        })
      ).payload.meta.replayed,
    ).toBe(true);
    expect((await get(c, d.id)).entryCount).toBe(1);
  });
  test("source edit after preview stales commit; race after proposal cannot add invalid entry", async () => {
    for (const boundary of ["member", "family"]) {
      const c = await fixture(),
        d = await made(c),
        b = careRecord([c.people[1]?._id.toHexString() as string]),
        p = await owner.call(`${root(c)}/cases/${d.id}/preview`, b, { version: d.version }),
        original = VisitationSources.prototype.fence;
      let changed = false;
      const fence = spyOn(VisitationSources.prototype, "fence").mockImplementation(async function (
        this: VisitationSources,
        ...args: Parameters<VisitationSources["fence"]>
      ) {
        if (!changed) {
          changed = true;
          if (boundary === "member")
            await db.db
              .collection("members")
              .updateOne(
                { _id: new ObjectId(c.target.id) },
                { $set: { participation: "transferred" }, $inc: { version: 1 } },
              );
          else
            await db.db
              .collection("families")
              .updateOne(
                { _id: new ObjectId(c.people[0]?.familyId) },
                { $set: { address: "Địa chỉ đã đổi" }, $inc: { version: 1 } },
              );
        }
        return original.apply(this, args);
      });
      let r: Awaited<ReturnType<SyntheticClient["call"]>>;
      try {
        r = await owner.call(
          `${root(c)}/cases/${d.id}`,
          { ...b, preview: p.payload.data.context },
          { method: "PATCH", version: d.version },
        );
      } finally {
        fence.mockRestore();
      }
      expect([409, 412, 422]).toContain(r.status);
      expect((await get(c, d.id)).entryCount).toBe(0);
    }
  });
  test("pastor/secretary allowed, ministry lead/treasurer/member denied including counters/pickers/history/receipt", async () => {
    const c = await fixture(),
      d = await made(c);
    for (const role of ["pastor", "secretary"]) {
      const s = client("church");
      await syntheticUser(owner, s, c, role);
      expect((await s.call(`${root(c, s)}/cases/${d.id}`)).status).toBe(200);
      expect(
        (
          await s.call(`${root(c, s)}/cases/${d.id}/preview`, careRecord([c.target.id]), {
            version: d.version,
          })
        ).status,
      ).toBe(200);
    }
    const unit = (
      await owner.call(`owner/churches/${c.id}/organization/units`, {
        kind: "service_ministry",
        name: "Ban thăm viếng synthetic",
      })
    ).payload.data.unit.id;
    for (const role of ["ministry_lead", "treasurer", "member"]) {
      const s = client("church");
      await syntheticUser(owner, s, c, role, role === "ministry_lead" ? [unit] : []);
      for (const suffix of [
        "cases",
        "people",
        `cases/${d.id}`,
        `cases/${d.id}/entries`,
        `cases/${d.id}/history`,
      ])
        expect((await s.call(`${root(c, s)}/${suffix}`)).status).toBe(403);
      expect((await s.call(`${root(c, s)}/cases/preview`, careCreate(c.target))).status).toBe(403);
    }
  });
  test("cross tenant IDs/history/receipts hidden and role revocation blocks replay after committed write", async () => {
    const c = await fixture(),
      other = await fixture(),
      s = client("church"),
      account = await syntheticUser(owner, s, c, "secretary"),
      r = await careSave(s, c, careCreate(c.target));
    for (const suffix of [
      `cases/${r.payload.data.caseId}`,
      `cases/${r.payload.data.caseId}/history`,
      `cases/${r.payload.data.caseId}/entries`,
    ])
      expect((await owner.call(`${root(other)}/${suffix}`)).status).toBe(404);
    expect((await s.call(`${root(other, s)}/cases`)).status).toBe(404);
    const second = client("church");
    await syntheticUser(owner, second, c, "pastor");
    expect(
      (await second.call(`${root(c, second)}/operations/${r.payload.data.operationId}`)).status,
    ).toBe(404);
    await db.db
      .collection("accounts")
      .updateOne(
        { _id: new ObjectId(account.id) },
        { $set: { role: "member", scope: { kind: "self" } }, $inc: { version: 1 } },
      );
    expect((await s.call(`${root(c, s)}/operations/${r.payload.data.operationId}`)).status).toBe(
      403,
    );
    expect((await s.call(`${root(c, s)}/cases`, r.intent, { key: r.key })).status).toBe(403);
  });
  test("strict shape/body/method/CSRF/source bounds and no implicit auto-work", async () => {
    const c = await fixture(20);
    expect(
      (await owner.call(`${root(c)}/cases/preview`, { ...careCreate(c.target), private: true }))
        .status,
    ).toBe(422);
    expect(
      (
        await owner.call(`${root(c)}/cases/preview`, careCreate(c.target), {
          headers: { origin: "https://elsewhere.test" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await owner.call(`${root(c)}/cases/preview`, {
          ...careCreate(c.target),
          reason: "x".repeat(17000),
        })
      ).status,
    ).toBe(413);
    let d = await made(c);
    d = await save(c, d, careRecord(c.people.slice(0, 10).map((p) => p._id.toHexString())));
    expect((await entries(c, d))[0].participants).toHaveLength(10);
    expect(
      (
        await owner.call(
          `${root(c)}/cases/${d.id}/preview`,
          careRecord(c.people.slice(0, 11).map((p) => p._id.toHexString())),
          { version: d.version },
        )
      ).status,
    ).toBe(422);
    expect(
      (await owner.call(`${root(c)}/cases/${d.id}`, undefined, { method: "DELETE" })).status,
    ).toBe(405);
    expect((await client().call(`${root(c)}/cases`)).status).toBe(401);
    for (const n of ["prayer_requests", "care_alerts"])
      expect(await db.db.collection(n).countDocuments({ churchId: new ObjectId(c.id) })).toBe(0);
  });
  test("database uniqueness and case immutable target are enforced on public path", async () => {
    const c = await fixture(),
      d = await made(c),
      raw = await db.db.collection("visitation_cases").findOne({ _id: new ObjectId(d.id) });
    if (!raw) throw Error("fixture");
    await expect(
      db.db
        .collection("visitation_cases")
        .insertOne({ ...raw, _id: new ObjectId(), code: "TV-SYNTHETIC-DUP" }),
    ).rejects.toThrow();
    expect(
      (
        await owner.call(
          `${root(c)}/cases/${d.id}/preview`,
          { ...careUpdate(d), target: { kind: "family", id: c.families[0]?._id.toHexString() } },
          { version: d.version },
        )
      ).status,
    ).toBe(422);
  });
  test("50 real entries traverse bounded pages with no loss and protected audit has metadata only", async () => {
    const c = await fixture();
    let d = await made(c, careCreate(c.target, { description: "NARRATIVE_PRIVATE_SYNTHETIC" }));
    for (let i = 0; i < 50; i++)
      d = await save(c, d, careRecord([c.target.id], { note: `Entry synthetic ${i}` }));
    expect(d.entryCount).toBe(50);
    expect(d.visitedCount).toBe(50);
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await owner.call(
        `${root(c)}/cases/${d.id}/entries?limit=17${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(page.status).toBe(200);
      for (const e of page.payload.data.items) {
        expect(seen.has(e.id)).toBe(false);
        seen.add(e.id);
      }
      cursor = page.payload.data.nextCursor;
    } while (cursor);
    expect(seen.size).toBe(50);
    const audits = await db.db
      .collection("audit_events")
      .find({ targetChurchId: new ObjectId(c.id) })
      .toArray();
    expect(JSON.stringify(audits)).not.toContain("NARRATIVE_PRIVATE_SYNTHETIC");
    expect(JSON.stringify(audits)).not.toContain("Entry synthetic");
  }, 30000);
});
