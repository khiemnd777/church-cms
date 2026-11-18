import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { BSON, ObjectId } from "mongodb";
import { createApp } from "../../api/app";
import { Audit } from "../../api/audit/service";
import { config } from "../../api/config";
import { Identity } from "../../api/identity/service";
import { Database, initialize } from "../../api/infrastructure/database";
import { RateLimit } from "../../api/infrastructure/rate-limit";
import { canonical } from "../../api/operations/service";
import { localOnly, SyntheticClient, syntheticOwner } from "../../scripts/p2-fixtures";
import {
  careDecision,
  careOpenAlert,
  careRoot,
  signalCreate,
  signalSave,
} from "../../scripts/p45-fixtures";
import { p46Workflow } from "../../scripts/p46-workflow";

const conf = {
  ...config(),
  origin: "https://localhost:3490",
  database: `church_cms_test_p46_${crypto.randomUUID().replaceAll("-", "")}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
};
localOnly(conf);
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let app: ReturnType<typeof createApp>,
  owner: SyntheticClient,
  actorId: string,
  flow: Awaited<ReturnType<typeof p46Workflow>>;
const client = (realm: "owner" | "church") =>
  new SyntheticClient(realm, conf.origin, (req) => app(req, { ip: crypto.randomUUID() }));
beforeAll(async () => {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  app = createApp(identity, conf, { log: () => {} });
  owner = client("owner");
  actorId = (await syntheticOwner(db, owner)).id;
});
afterAll(async () => {
  await db.db.dropDatabase();
  expect(
    (await db.db.admin().listDatabases()).databases.some((d) => d.name === conf.database),
  ).toBe(false);
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
});
describe("P4.6 real cross-package workflows", () => {
  test("schedule/program/attendance/care/visitation/privacy and fresh authority compose", async () => {
    flow = await p46Workflow(db, owner, actorId, client, (ok, label) =>
      expect(Boolean(ok), label).toBe(true),
    );
    expect(flow.visit.id).toBeString();
    expect(flow.program.id).toBeString();
  }, 120000);
  test("concurrent care conversion has one winner and exactly one public visitation root", async () => {
    const c = flow.c,
      target = c.people[2]?._id.toHexString();
    expect(target).toBeString();
    expect((await signalSave(owner, c, signalCreate(target as string))).status).toBe(201);
    const alert = await careOpenAlert(db, c, target as string),
      path = `${careRoot(c, owner)}/${alert.id}`,
      body = careDecision(),
      preview = await owner.call(`${path}/preview`, body, { version: alert.version });
    expect(preview.status).toBe(200);
    const intent = { ...body, preview: preview.payload.data.context, confirmed: true },
      results = await Promise.all(
        [1, 2].map(() => owner.call(path, intent, { method: "PATCH", version: alert.version })),
      );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.every((r) => [200, 409, 412].includes(r.status))).toBe(true);
    const cases = await db.db
      .collection("visitation_cases")
      .find({ churchId: new ObjectId(c.id), targetId: new ObjectId(target), reasonCode: "illness" })
      .toArray();
    expect(cases).toHaveLength(1);
    const after = await db.db.collection("care_alerts").findOne({ _id: alert._id });
    expect(after?.state).toBe("linked");
    expect(after?.caseId).toEqual(cases[0]?._id);
  });
  test("audit failure rolls back both domains, source fences, histories and operation ledger", async () => {
    const c = flow.c,
      target = c.people[3]?._id.toHexString();
    expect(target).toBeString();
    expect((await signalSave(owner, c, signalCreate(target as string))).status).toBe(201);
    const alert = await careOpenAlert(db, c, target as string),
      path = `${careRoot(c, owner)}/${alert.id}`,
      body = careDecision(),
      preview = await owner.call(`${path}/preview`, body, { version: alert.version });
    expect(preview.status).toBe(200);
    const tables = [
      "members",
      "visitation_cases",
      "visitation_entries",
      "visitation_history",
      "care_alerts",
      "care_history",
      "audit_events",
      "idempotency_operations",
    ];
    const snapshot = async () =>
      Promise.all(
        tables.map(async (name) =>
          canonical(
            JSON.parse(
              BSON.EJSON.stringify(
                await db.db
                  .collection(name)
                  .find({
                    [name === "audit_events" ? "targetChurchId" : "churchId"]: new ObjectId(c.id),
                  })
                  .sort({ _id: 1 })
                  .toArray(),
                { relaxed: false },
              ),
            ),
          ),
        ),
      );
    const before = await snapshot(),
      failure = spyOn(Audit.prototype, "organization").mockRejectedValue(
        new Error("P46 synthetic audit failure"),
      );
    try {
      expect(
        (
          await owner.call(
            path,
            { ...body, preview: preview.payload.data.context, confirmed: true },
            { method: "PATCH", version: alert.version },
          )
        ).status,
      ).toBe(503);
    } finally {
      failure.mockRestore();
    }
    expect(await snapshot()).toEqual(before);
  });
  test("all five P4 history queries use bounded resource indexes", async () => {
    const churchId = new ObjectId(flow.c.id),
      plans: object[] = [],
      queries: [string, object, Record<string, 1 | -1>, string][] = [
        [
          "schedule_history",
          { churchId, occurrenceId: new ObjectId(flow.c.occurrence) },
          { occurredAt: -1, _id: -1 },
          "schedule_history_page",
        ],
        [
          "program_history",
          { churchId, programId: new ObjectId(flow.program.id) },
          { _id: -1 },
          "program_history_page",
        ],
        [
          "visitation_history",
          { churchId, caseId: new ObjectId(flow.visit.id) },
          { _id: -1 },
          "visitation_history_page",
        ],
        [
          "prayer_history",
          { churchId, prayerId: new ObjectId(flow.privatePrayer.payload.data.prayerId) },
          { _id: -1 },
          "prayer_history_page",
        ],
        [
          "care_history",
          { churchId, resourceKind: "alert", resourceId: new ObjectId(flow.visit.alertId) },
          { _id: -1 },
          "care_history_page",
        ],
      ];
    for (const [collection, filter, sort, index] of queries) {
      const p = await db.db
        .collection(collection)
        .find(filter)
        .sort(sort)
        .limit(26)
        .explain("executionStats");
      expect(p.executionStats.nReturned).toBeGreaterThan(0);
      expect(p.executionStats.nReturned).toBeLessThanOrEqual(26);
      expect(p.executionStats.totalDocsExamined).toBeLessThanOrEqual(26);
      expect(JSON.stringify(p.queryPlanner.winningPlan)).toContain(index);
      plans.push({ collection, plan: p.queryPlanner.winningPlan, stats: p.executionStats });
    }
    // Evidence is opt-in and scoped by the caller; regression tests must not overwrite accepted receipts.
    if (process.env.CHURCH_EVIDENCE_DIR)
      await Bun.write(
        `${process.env.CHURCH_EVIDENCE_DIR}/p4-history-plans.json`,
        JSON.stringify(
          {
            status: "PASS",
            plans,
            limits: [
              "Small current source-linked histories; not deep history saturation or all filters",
            ],
          },
          null,
          2,
        ),
      );
  });
});
