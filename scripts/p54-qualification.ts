import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { businessDay } from "../api/members/dates";
import { localTls } from "./local-tls";
import { check, localOnly, SyntheticClient, syntheticOwner, syntheticUser } from "./p2-fixtures";
import { financeChurch, financeRoot } from "./p51-fixtures";

const base = config();
localOnly(base);
const run = crypto.randomUUID().replaceAll("-", ""),
  privateDir = resolve(".local", `p5.4-${run}`),
  out = resolve("output/p5.4/qualification");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3501",
    port: 3501,
    database: `church_cms_test_p54q_${run}`,
    csrfKey: crypto.randomUUID() + crypto.randomUUID(),
    cert: tls.cert,
    key: tls.key,
  };
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  checks: string[] = [],
  plans: unknown[] = [],
  measurements: unknown[] = [],
  retryResponses: unknown[] = [];
let server: ReturnType<typeof Bun.serve> | undefined;
const assert = (v: unknown, label: string) => {
  check(v, label);
  checks.push(label);
};
const client = (realm: "church" | "owner" = "church") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => {
    const headers = new Headers(req.headers);
    headers.set("x-synthetic-client", ip);
    return fetch(new Request(req, { headers }), { tls: { ca } });
  });
};
try {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  const app = createApp(identity, conf, { log: () => {} });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: conf.port,
    idleTimeout: 15,
    tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) },
    fetch: (req) => app(req, { ip: req.headers.get("x-synthetic-client") ?? "p54q" }),
  });
  const owner = client("owner");
  await syntheticOwner(db, owner);
  const c = await financeChurch(owner, "P54 qualification"),
    p = client(),
    t = client();
  await syntheticUser(owner, p, c, "pastor");
  await syntheticUser(owner, t, c, "treasurer");
  const finance = financeRoot(c),
    root = `${finance}/expense-proposals`;
  assert(
    (await p.call(`${finance}/settings`, { proposerRoles: ["treasurer"], approverRole: "pastor" }))
      .status === 201,
    "explicit-config",
  );
  async function call(who: SyntheticClient, path: string, body: object, version?: number) {
    const key = crypto.randomUUID();
    for (let a = 0; a < 8; a++) {
      const r = await who.call(path, body, { key, version });
      if (r.status === 200 || r.status === 201) return r;
      const code = r.payload?.error?.code;
      retryResponses.push({
        path: path.replace(c.id, "tenant"),
        attempt: a,
        status: r.status,
        code,
      });
      check(
        ["OPERATION_IN_PROGRESS", "DEPENDENCY_UNAVAILABLE", "OUTCOME_UNKNOWN"].includes(code) &&
          a < 7,
        `HTTP ${r.status} ${code}`,
      );
      await Bun.sleep(75 * (a + 1));
    }
    throw Error("Retry exhausted");
  }
  async function funded(who: SyntheticClient, label: string) {
    const f = await call(p, `${finance}/funds`, { name: label }),
      fundId = f.payload.data.fundId,
      b = {
        submissionId: crypto.randomUUID(),
        fundId,
        businessDate: businessDay(),
        sourceReference: `P54-${crypto.randomUUID()}`,
        purpose: "Qualification synthetic funding",
        mode: "aggregate",
        amount: "999999999999999999",
      },
      pre = await call(who, `${finance}/receipts/preview`, b);
    await call(who, `${finance}/receipts`, {
      receipt: b,
      previewToken: pre.payload.data.previewToken,
    });
    return fundId as string;
  }
  async function journey(
    who: SyntheticClient,
    approver: SyntheticClient,
    fundId: string,
    label: string,
  ) {
    const b = {
        submissionId: crypto.randomUUID(),
        fundId,
        amount: "100",
        purpose: `Qualification ${label}`,
      },
      pre = await call(who, `${root}/preview`, b),
      r = await call(who, root, { proposal: b, previewToken: pre.payload.data.previewToken }),
      id = r.payload.data.proposalId as string,
      d = { decision: "approved", reason: "Synthetic" },
      dp = await call(approver, `${root}/${id}/preview`, d, 1);
    await call(
      approver,
      `${root}/${id}/decision`,
      { decision: d, previewToken: dp.payload.data.previewToken },
      1,
    );
    const payment = { submissionId: crypto.randomUUID() },
      pp = await call(who, `${root}/${id}/payment-preview`, payment, 2),
      paid = await call(
        who,
        `${root}/${id}/payment`,
        { payment, previewToken: pp.payload.data.previewToken, confirmed: true },
        2,
      ),
      detail = await who.call(`${root}/${id}`);
    check(detail.payload.data.state === "paid", "paid public readback");
    return { id, paymentId: paid.payload.data.paymentId as string };
  }
  const fundId = await funded(t, "Quỹ stored-volume P54"),
    original = await journey(t, p, fundId, "seed"),
    seed = await db.db
      .collection("finance_payments")
      .findOne({ _id: new ObjectId(original.paymentId) }),
    proposal = await db.db
      .collection("finance_expense_proposals")
      .findOne({ _id: new ObjectId(original.id) }),
    ledger = await db.db
      .collection("finance_ledger")
      .findOne({ paymentId: new ObjectId(original.paymentId) });
  check(seed && proposal && ledger, "seed records");
  let prior = 1;
  for (const size of [100, 500, 2000]) {
    const ps: object[] = [],
      pcs: object[] = [],
      ls: object[] = [];
    for (let i = prior; i < size; i++) {
      const id = new ObjectId(),
        paymentId = new ObjectId(),
        code = `PC-VOLUME-${i}`,
        proposalCode = `DX-VOLUME-${i}`;
      ps.push({
        ...proposal,
        _id: id,
        code: proposalCode,
        submissionId: crypto.randomUUID(),
        payment: { id: paymentId, code, businessDate: seed.businessDate },
      });
      pcs.push({
        ...seed,
        _id: paymentId,
        code,
        proposalId: id,
        proposalCode,
        submissionId: crypto.randomUUID(),
      });
      ls.push({
        ...ledger,
        _id: new ObjectId(),
        paymentId,
        paymentCode: code,
        proposalId: id,
        proposalCode,
      });
    }
    await db.db.collection("finance_expense_proposals").insertMany(ps);
    await db.db.collection("finance_payments").insertMany(pcs);
    await db.db.collection("finance_ledger").insertMany(ls);
    prior = size;
    const churchId = new ObjectId(c.id),
      fund = new ObjectId(fundId),
      period = businessDay().slice(0, 7),
      from = `${period}-01`,
      to = new Date(`${from}T00:00:00Z`);
    to.setUTCMonth(to.getUTCMonth() + 1);
    const range = { $gte: from, $lt: to.toISOString().slice(0, 10) };
    for (const [kind, collection, filter, sort] of [
      [
        "ledger-all",
        "finance_ledger",
        { churchId, businessDate: range },
        { businessDate: -1, _id: -1 },
      ],
      [
        "ledger-fund",
        "finance_ledger",
        { churchId, fundId: fund, businessDate: range },
        { businessDate: -1, _id: -1 },
      ],
      [
        "payment-unique",
        "finance_payments",
        { churchId, proposalId: new ObjectId(original.id) },
        { _id: 1 },
      ],
    ] as const) {
      const exp = await db.db
        .collection(collection)
        .find(filter)
        .sort(sort)
        .limit(26)
        .explain("executionStats");
      assert(
        !JSON.stringify(exp.queryPlanner.winningPlan).includes('"stage":"COLLSCAN"'),
        `indexed-${kind}-${size}`,
      );
      plans.push({
        size,
        kind,
        winningPlan: exp.queryPlanner.winningPlan,
        executionStats: exp.executionStats,
      });
    }
    const balancePlan = await db.db
      .collection("finance_ledger")
      .aggregate([
        { $match: { churchId, fundId: fund } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ])
      .explain("executionStats");
    plans.push({ size, kind: "book-balance-aggregate", explain: balancePlan });
    assert(
      !JSON.stringify(balancePlan).includes('"stage":"COLLSCAN"'),
      `indexed-book-balance-${size}`,
    );
    const page = await t.call(`${finance}/ledger?fundId=${fundId}&limit=25`);
    assert(
      page.status === 200 &&
        page.payload.data.items.length === 25 &&
        !!page.payload.data.nextCursor,
      `bounded-book-${size}`,
    );
    assert(
      page.payload.data.netIncome === "999999999999999999" &&
        page.payload.data.netExpense === String(size * 100) &&
        page.payload.data.closingBalance === String(999999999999999999n - BigInt(size * 100)),
      `exact-book-totals-${size}`,
    );
  }
  const payers: SyntheticClient[] = [],
    approvers: SyntheticClient[] = [],
    funds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const who = client(),
      ap = client();
    await syntheticUser(owner, who, c, "treasurer");
    await syntheticUser(owner, ap, c, "pastor");
    payers.push(who);
    approvers.push(ap);
    funds.push(await funded(who, `Quỹ workload P54 ${i}`));
  }
  for (const concurrency of [1, 5, 10]) {
    const times: number[] = [],
      errors: string[] = [];
    await Promise.all(
      payers.slice(0, concurrency).map(async (who, i) => {
        for (let n = 0; n < 2; n++) {
          const start = performance.now();
          try {
            await journey(
              who,
              approvers[i] as SyntheticClient,
              funds[i] as string,
              `${concurrency}/${i}/${n}`,
            );
          } catch (e) {
            errors.push(e instanceof Error ? e.message : String(e));
          }
          times.push(performance.now() - start);
        }
      }),
    );
    times.sort((a, b) => a - b);
    measurements.push({
      concurrency,
      journeys: times.length,
      errors,
      p50ms: times[Math.floor((times.length - 1) * 0.5)],
      p95ms: times[Math.floor((times.length - 1) * 0.95)],
      maxMs: times.at(-1),
    });
    assert(errors.length === 0, `workload-${concurrency}-no-terminal-errors`);
  }
  const count = await db.db
      .collection("finance_payments")
      .countDocuments({ churchId: new ObjectId(c.id) }),
    debits = await db.db
      .collection("finance_ledger")
      .countDocuments({ churchId: new ObjectId(c.id), kind: "payment" });
  assert(count === 2032 && debits === count, "one-payment-one-debit-all-fixtures-and-journeys");
  await Bun.write(
    `${out}/qualification.json`,
    JSON.stringify(
      {
        status: "PASS",
        checks,
        measurements,
        retryResponses,
        publicJourneys: 32,
        storedVolume: {
          payments: 2000,
          kind: "synthetic stored-volume fixtures; public workflows counted separately",
        },
        limits: [
          "Bounded local workload, separate funded workers; shared-fund overspend covered by integration races",
          "No production SLA/capacity/RPO/RTO or restore claim",
          "No main DB, real data, external payments, independent review",
        ],
      },
      null,
      2,
    ),
  );
  await Bun.write(`${out}/query-plans.json`, JSON.stringify(plans, null, 2));
  console.info(
    JSON.stringify({
      status: "PASS",
      checks: checks.length,
      plans: plans.length,
      journeys: 32,
      measurements,
      retries: retryResponses.length,
    }),
  );
} catch (e) {
  await Bun.write(
    `${out}/failure.json`,
    JSON.stringify(
      { checks, measurements, retryResponses, error: e instanceof Error ? e.message : String(e) },
      null,
      2,
    ),
  );
  await Bun.write(`${out}/query-plans.json`, JSON.stringify(plans, null, 2));
  throw e;
} finally {
  if (server) await server.stop(true);
  await db.db.dropDatabase();
  const removed = !(await db.db.admin().listDatabases()).databases.some(
    (d) => d.name === conf.database,
  );
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
  await rm(privateDir, { recursive: true, force: true });
  await Bun.write(
    `${out}/cleanup.json`,
    JSON.stringify({ database: conf.database, removed, privateTlsRemoved: true }, null, 2),
  );
}
