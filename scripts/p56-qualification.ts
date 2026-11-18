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
import { p56Recovery } from "./p56-recovery";

const base = config();
localOnly(base);
const run = crypto.randomUUID().replaceAll("-", ""),
  privateDir = resolve(".local", `p5.6-${run}`),
  out = resolve(process.env.CHURCH_EVIDENCE_DIR ?? "output/p5.6/qualification");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3504",
    port: 3504,
    database: `church_cms_test_p56q_${run}`,
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
let accepting = true,
  inFlight = 0;
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
    fetch: async (req) => {
      if (!accepting)
        return Response.json({ error: { code: "SYNTHETIC_QUIESCED" } }, { status: 503 });
      inFlight++;
      try {
        return await app(req, { ip: req.headers.get("x-synthetic-client") ?? "p56q" });
      } finally {
        inFlight--;
      }
    },
  });
  const owner = client("owner");
  await syntheticOwner(db, owner);
  const c = await financeChurch(owner, "P56 qualification"),
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
        sourceReference: `P56-${crypto.randomUUID()}`,
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
  const fundId = await funded(t, "Quỹ stored-volume P56"),
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
    const summary = await t.call(`${finance}/summary?period=${period}&fundId=${fundId}`);
    assert(
      summary.status === 200 &&
        summary.payload.data.totals.netExpense === String(size * 100) &&
        summary.payload.data.totals.closingBalance === page.payload.data.closingBalance &&
        summary.payload.data.months.length === 12,
      `summary-ledger-volume-${size}`,
    );
    for (const scoped of [false, true]) {
      const plan = await db.db
        .collection("finance_ledger")
        .aggregate([
          {
            $match: {
              churchId,
              ...(scoped ? { fundId: fund } : {}),
              businessDate: {
                $gte: `${period.slice(0, 4)}-01-01`,
                $lte: `${period.slice(0, 4)}-12-31`,
              },
            },
          },
          {
            $group: { _id: { $substrBytes: ["$businessDate", 0, 7] }, amount: { $sum: "$amount" } },
          },
        ])
        .explain("executionStats");
      assert(
        !JSON.stringify(plan).includes('"stage":"COLLSCAN"'),
        `summary-indexed-${scoped}-${size}`,
      );
      plans.push({ kind: "summary-annual", size, scoped, explain: plan });
    }
    const inspected = await t.call(`${finance}/periods/${period}`);
    assert(
      inspected.status === 200 && inspected.payload.data.inspection.matches,
      `reconciliation-valid-${size}`,
    );
    assert(
      inspected.payload.data.inspection.summary.netExpense === String(size * 100),
      `reconciled-total-${size}`,
    );
  }
  async function closing(root: string, who: SyntheticClient, label: string) {
    const closure = { submissionId: crypto.randomUUID(), reason: label },
      month = businessDay().slice(0, 7),
      pre = await call(who, `${root}/periods/${month}/close-preview`, closure);
    check(pre.payload.data.summary, "Close summary");
    const r = await call(who, `${root}/periods/${month}/close`, {
      closure,
      controlVersion: pre.payload.data.controlVersion,
      previewToken: pre.payload.data.previewToken,
      confirmed: true,
    });
    return { r, month };
  }
  const volumeClose = await closing(finance, t, "Synthetic stored-volume close"),
    volumeRead = await t.call(`${finance}/period-closures/${volumeClose.r.payload.data.closureId}`);
  assert(
    volumeRead.status === 200 && volumeRead.payload.data.summary.netExpense === "200000",
    "stored-volume-immutable-close",
  );
  type Case = {
    root: string;
    who: SyntheticClient;
    paymentId: string;
    proposalId: string;
    churchId: string;
  };
  const groups = new Map<number, Case[][]>();
  // Public paid setup is outside the timed window. Each void+close journey owns a church;
  // competing writers in one church are exercised by integration races.
  for (const concurrency of [1, 5, 10]) {
    const workers: Case[][] = [];
    for (let i = 0; i < concurrency; i++) {
      const cases: Case[] = [];
      for (let n = 0; n < 2; n++) {
        const church = await financeChurch(owner, `P56 Q${concurrency}-${i}-${n}`),
          pastor = client(),
          who = client();
        await syntheticUser(owner, pastor, church, "pastor");
        await syntheticUser(owner, who, church, "treasurer");
        const root = financeRoot(church);
        check(
          (
            await call(pastor, `${root}/settings`, {
              proposerRoles: ["treasurer"],
              approverRole: "pastor",
            })
          ).status === 201,
          "Case config",
        );
        const fund = (await call(pastor, `${root}/funds`, { name: "Quỹ workload" })).payload.data
          .fundId as string;
        const receipt = {
            submissionId: crypto.randomUUID(),
            fundId: fund,
            businessDate: businessDay(),
            sourceReference: `CASE-${crypto.randomUUID()}`,
            purpose: "Synthetic funding",
            mode: "aggregate",
            amount: "9007199254740993",
          },
          rp = await call(who, `${root}/receipts/preview`, receipt);
        await call(who, `${root}/receipts`, {
          receipt,
          previewToken: rp.payload.data.previewToken,
        });
        const proposal = {
            submissionId: crypto.randomUUID(),
            fundId: fund,
            amount: "100",
            purpose: "Synthetic P56 workload",
          },
          pp = await call(who, `${root}/expense-proposals/preview`, proposal),
          submitted = await call(who, `${root}/expense-proposals`, {
            proposal,
            previewToken: pp.payload.data.previewToken,
          }),
          proposalId = submitted.payload.data.proposalId as string,
          decision = { decision: "approved", reason: "Synthetic approval" },
          dp = await call(pastor, `${root}/expense-proposals/${proposalId}/preview`, decision, 1);
        await call(
          pastor,
          `${root}/expense-proposals/${proposalId}/decision`,
          { decision, previewToken: dp.payload.data.previewToken },
          1,
        );
        const payment = { submissionId: crypto.randomUUID() },
          payPreview = await call(
            who,
            `${root}/expense-proposals/${proposalId}/payment-preview`,
            payment,
            2,
          ),
          paid = await call(
            who,
            `${root}/expense-proposals/${proposalId}/payment`,
            { payment, previewToken: payPreview.payload.data.previewToken, confirmed: true },
            2,
          );
        cases.push({
          root,
          who,
          proposalId,
          paymentId: paid.payload.data.paymentId as string,
          churchId: church.id,
        });
      }
      workers.push(cases);
    }
    groups.set(concurrency, workers);
  }
  for (const concurrency of [1, 5, 10]) {
    const times: number[] = [],
      errors: string[] = [];
    const workers = groups.get(concurrency);
    check(workers, "Prepared cases");
    await Promise.all(
      workers.map(async (cases) => {
        for (const c of cases) {
          const started = performance.now();
          try {
            const initialSummary = await c.who.call(`${c.root}/summary`);
            check(
              initialSummary.status === 200 &&
                initialSummary.payload.data.totals.netExpense === "100",
              "Summary before reversal",
            );
            const body = { reason: "Synthetic full reversal" },
              pre = await call(c.who, `${c.root}/payments/${c.paymentId}/void-preview`, body, 1);
            await call(
              c.who,
              `${c.root}/payments/${c.paymentId}/void`,
              { void: body, previewToken: pre.payload.data.previewToken, confirmed: true },
              1,
            );
            const closed = await closing(c.root, c.who, "Synthetic workload close"),
              read = await c.who.call(
                `${c.root}/period-closures/${closed.r.payload.data.closureId}`,
              ),
              proposal = await c.who.call(`${c.root}/expense-proposals/${c.proposalId}`);
            check(
              read.status === 200 &&
                read.payload.data.summary.netIncome === "9007199254740993" &&
                read.payload.data.summary.netExpense === "0" &&
                read.payload.data.summary.closingBalance === "9007199254740993",
              "Exact net closed totals",
            );
            check(
              proposal.payload.data.state === "payment_voided",
              "Minimal proposal terminal readback",
            );
            const finalSummary = (await c.who.call(`${c.root}/summary`)).payload.data;
            check(
              finalSummary.state === "closed" &&
                finalSummary.totals.netIncome === "9007199254740993" &&
                finalSummary.totals.netExpense === "0" &&
                finalSummary.totals.closingBalance === "9007199254740993",
              "Summary after reversal and close",
            );
            const blocked = await c.who.call(
              `${c.root}/payments/${c.paymentId}/void-preview`,
              body,
              { version: 1 },
            );
            check(blocked.status === 409, "No repeat reversal");
          } catch (e) {
            errors.push(e instanceof Error ? e.message : String(e));
          }
          times.push(performance.now() - started);
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
  const closureCount = await db.db.collection("finance_period_closures").countDocuments(),
    reversals = await db.db.collection("finance_ledger").countDocuments({ kind: "payment_void" });
  assert(
    closureCount === 33 && reversals === 32,
    "one-KS-and-one-reversal-per-timed-journey-plus-volume-KS",
  );
  const historyPlan = await db.db
    .collection("finance_history")
    .find({
      churchId: new ObjectId(c.id),
      targetType: "period_closure",
      targetId: new ObjectId(volumeClose.r.payload.data.closureId),
    })
    .sort({ _id: -1 })
    .limit(26)
    .explain("executionStats");
  plans.push({
    kind: "closure-history",
    winningPlan: historyPlan.queryPlanner.winningPlan,
    executionStats: historyPlan.executionStats,
  });
  assert(
    JSON.stringify(historyPlan.queryPlanner.winningPlan).includes("finance_history_page"),
    "closure-history-indexed",
  );
  await p56Recovery({
    db,
    conf,
    ca,
    privateDir,
    out,
    owner,
    client,
    quiesce: async () => {
      accepting = false;
      for (let i = 0; inFlight > 0 && i < 300; i++) await Bun.sleep(10);
      check(inFlight === 0, "Drained source before backup");
      const probe = await fetch(`${conf.origin}/api/v1/auth/me`, { tls: { ca } });
      check(probe.status === 503, "Admission closed");
      await probe.arrayBuffer();
    },
    resumeSource: () => {
      accepting = true;
    },
  });
  await Bun.write(
    `${out}/qualification.json`,
    JSON.stringify(
      {
        status: "PASS",
        checks,
        measurements,
        retryResponses,
        publicVoidCloseJourneys: 32,
        storedVolume: {
          payments: 2000,
          kind: "synthetic stored-volume fixtures; source/payment setup for timed cases uses public HTTP",
        },
        closureCount,
        reversalCount: reversals,
        limits: [
          "One church per timed void+close journey; same-church close/write contention covered by integration",
          "Payment setup and Argon2/account setup excluded from timed window",
          "Local/synthetic/private CA; no production SLA/capacity/RPO/RTO/restore claim",
          "No main/realdata/P5 closure/P6 or independent review",
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
