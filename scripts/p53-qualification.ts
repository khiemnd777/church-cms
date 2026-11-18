import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { config } from "../api/config";
import type { ExpenseProposal } from "../api/finance/expenses-model";
import { decimalString } from "../api/finance/money";
import { digest } from "../api/identity/crypto";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { businessDay } from "../api/members/dates";
import { canonical } from "../api/operations/service";
import { localTls } from "./local-tls";
import { check, localOnly, SyntheticClient, syntheticOwner, syntheticUser } from "./p2-fixtures";
import { financeChurch, financeRoot } from "./p51-fixtures";

const base = config();
localOnly(base);
const run = crypto.randomUUID().replaceAll("-", ""),
  privateDir = resolve(".local", `p5.3-${run}`),
  out = resolve("output/p5.3/qualification");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3499",
    port: 3499,
    database: `church_cms_test_p53q_${run}`,
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
    fetch: (req) => app(req, { ip: req.headers.get("x-synthetic-client") ?? "p53q" }),
  });
  const owner = client("owner");
  await syntheticOwner(db, owner);
  const c = await financeChurch(owner, "P53 qualification"),
    p = client(),
    s = client(),
    s2 = client();
  await syntheticUser(owner, p, c, "pastor");
  const sender = await syntheticUser(owner, s, c, "secretary"),
    sender2 = await syntheticUser(owner, s2, c, "secretary");
  const finance = financeRoot(c),
    root = `${finance}/expense-proposals`;
  assert(
    (
      await p.call(`${finance}/settings`, {
        proposerRoles: ["secretary", "treasurer", "ministry_lead"],
        approverRole: "pastor",
      })
    ).status === 201,
    "explicit-config",
  );
  const f = await p.call(`${finance}/funds`, { name: "Quỹ qualification P53" });
  assert(f.status === 201, "public-fund");
  async function call(who: SyntheticClient, path: string, body: object, version?: number) {
    const key = crypto.randomUUID();
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = await who.call(path, body, { key, version });
      if (r.status === 200 || r.status === 201) return r;
      const code = r.payload?.error?.code;
      retryResponses.push({ path: path.replace(c.id, "tenant"), attempt, status: r.status, code });
      check(
        ["OPERATION_IN_PROGRESS", "DEPENDENCY_UNAVAILABLE", "OUTCOME_UNKNOWN"].includes(code) &&
          attempt < 7,
        `HTTP ${r.status} ${code}`,
      );
      await Bun.sleep(75 * (attempt + 1));
    }
    throw Error("Retry exhausted");
  }
  async function workflow(who: SyntheticClient, approver: SyntheticClient, label: string) {
    const b = {
        submissionId: crypto.randomUUID(),
        fundId: f.payload.data.fundId,
        amount: "9007199254740993",
        purpose: `Qualification ${label}`,
      },
      preview = await call(who, `${root}/preview`, b),
      posted = await call(who, root, {
        proposal: b,
        previewToken: preview.payload.data.previewToken,
      }),
      id = posted.payload.data.proposalId as string;
    const d = { decision: "approved", reason: "Qualification synthetic" },
      dp = await call(approver, `${root}/${id}/preview`, d, 1);
    await call(
      approver,
      `${root}/${id}/decision`,
      { decision: d, previewToken: dp.payload.data.previewToken },
      1,
    );
    const read = await approver.call(`${root}/${id}`);
    check(read.status === 200 && read.payload.data.state === "approved", "Approved readback");
    return id;
  }
  const original = await workflow(s, p, "public seed"),
    seed = await db.db
      .collection<ExpenseProposal>("finance_expense_proposals")
      .findOne({ _id: new ObjectId(original) });
  check(seed, "Seed exists");
  let prior = 1;
  const ownId = new ObjectId(sender.id),
    secondId = new ObjectId(sender2.id);
  for (const size of [100, 500, 2000]) {
    const rows: ExpenseProposal[] = Array.from({ length: size - prior }, (_, n) => {
      const i = prior + n,
        createdBy = i % 2 ? ownId : secondId,
        content = {
          fundId: seed.fundId.toHexString(),
          fundName: seed.fundName,
          amount: "9007199254740993",
          purpose: "Stored-volume synthetic",
          businessDate: seed.businessDate,
          createdBy: createdBy.toHexString(),
        };
      return {
        ...seed,
        _id: new ObjectId(),
        code: `DX-VOLUME-${i}`,
        submissionId: crypto.randomUUID(),
        createdBy,
        creatorRole: "secretary",
        purpose: content.purpose,
        contentHash: digest(canonical(content)),
        state: "pending",
        decision: null,
        version: 1,
      };
    });
    await db.db.collection<ExpenseProposal>("finance_expense_proposals").insertMany(rows);
    prior = size;
    const period = businessDay().slice(0, 7),
      from = `${period}-01`,
      to = new Date(`${from}T00:00:00Z`);
    to.setUTCMonth(to.getUTCMonth() + 1);
    const range = { $gte: from, $lt: to.toISOString().slice(0, 10) };
    for (const [kind, filter] of [
      ["all", { churchId: new ObjectId(c.id), businessDate: range }],
      ["own", { churchId: new ObjectId(c.id), createdBy: ownId, businessDate: range }],
      ["fund", { churchId: new ObjectId(c.id), fundId: seed.fundId, businessDate: range }],
    ] as const) {
      const exp = await db.db
        .collection("finance_expense_proposals")
        .find(filter)
        .sort({ businessDate: -1, _id: -1 })
        .limit(26)
        .explain("executionStats");
      const plan = JSON.stringify(exp.queryPlanner.winningPlan);
      assert(
        !plan.includes('"stage":"COLLSCAN"') && !plan.includes('"stage":"SORT"'),
        `indexed-${kind}-${size}`,
      );
      plans.push({
        size,
        kind,
        winningPlan: exp.queryPlanner.winningPlan,
        executionStats: exp.executionStats,
      });
    }
    const own = await s.call(`${root}?limit=25`),
      all = await p.call(`${root}?limit=25`);
    assert(
      own.status === 200 && own.payload.data.items.length === 25 && !!own.payload.data.nextCursor,
      `bounded-own-${size}`,
    );
    assert(
      own.payload.data.items.every((r: { createdBy: string }) => r.createdBy === sender.id),
      `no-other-actor-${size}`,
    );
    const ownCount = await db.db
      .collection("finance_expense_proposals")
      .countDocuments({ churchId: new ObjectId(c.id), createdBy: ownId });
    const ownSum = Object.values(
        own.payload.data.summary as Record<string, { total: string }>,
      ).reduce((n, v) => n + BigInt(v.total), 0n),
      allSum = Object.values(all.payload.data.summary as Record<string, { total: string }>).reduce(
        (n, v) => n + BigInt(v.total),
        0n,
      );
    assert(
      ownSum === BigInt(ownCount) * 9007199254740993n &&
        allSum === BigInt(size) * 9007199254740993n,
      `exact-scoped-total-${size}`,
    );
  }
  const hp = await db.db
    .collection("finance_history")
    .find({
      churchId: new ObjectId(c.id),
      targetType: "expense_proposal",
      targetId: new ObjectId(original),
    })
    .sort({ _id: -1 })
    .limit(26)
    .explain("executionStats");
  assert(
    JSON.stringify(hp.queryPlanner.winningPlan).includes("finance_history_page"),
    "history-indexed",
  );
  plans.push({
    kind: "history",
    winningPlan: hp.queryPlanner.winningPlan,
    executionStats: hp.executionStats,
  });
  const senders: SyntheticClient[] = [],
    approvers: SyntheticClient[] = [];
  for (let i = 0; i < 10; i++) {
    const send = client(),
      approve = client();
    await syntheticUser(owner, send, c, "treasurer");
    await syntheticUser(owner, approve, c, "pastor");
    senders.push(send);
    approvers.push(approve);
  }
  for (const concurrency of [1, 5, 10]) {
    const ms: number[] = [],
      errors: string[] = [];
    await Promise.all(
      senders.slice(0, concurrency).map(async (who, i) => {
        const approver = approvers[i];
        check(approver, "Approver actor");
        for (let n = 0; n < 2; n++) {
          const started = performance.now();
          try {
            check((await who.call(`${root}?limit=25`)).status === 200, "List HTTPS");
            await workflow(who, approver, `${concurrency}/${i}/${n}`);
          } catch (e) {
            errors.push(e instanceof Error ? e.message : String(e));
          }
          ms.push(performance.now() - started);
        }
      }),
    );
    ms.sort((a, b) => a - b);
    measurements.push({
      concurrency,
      journeys: ms.length,
      errors,
      p50ms: ms[Math.floor(ms.length * 0.5)],
      p95ms: ms[Math.min(ms.length - 1, Math.ceil(ms.length * 0.95) - 1)],
      maxMs: ms.at(-1),
    });
    assert(!errors.length, `HTTPS-submit-approve-${concurrency}`);
  }
  assert((await db.db.collection("finance_ledger").countDocuments()) === 0, "no-ledger-writes");
  assert((await db.db.collection("finance_periods").countDocuments()) === 0, "no-period-init");
  const sum = await db.db
    .collection<ExpenseProposal>("finance_expense_proposals")
    .aggregate<{ total: ExpenseProposal["amount"] }>([
      { $match: { churchId: new ObjectId(c.id) } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray();
  check(sum[0], "Total exists");
  const all = await p.call(root);
  assert(
    Object.values(all.payload.data.summary as Record<string, { total: string }>)
      .reduce((n, v) => n + BigInt(v.total), 0n)
      .toString() === decimalString(sum[0].total),
    "readback-final-total",
  );
  await Bun.write(`${out}/query-plans.json`, JSON.stringify(plans, null, 2));
  await Bun.write(
    `${out}/qualification.json`,
    JSON.stringify(
      {
        status: "PASS",
        checks,
        measurements,
        retryResponses,
        volume: {
          proposals: 2000,
          kind: "stored-volume fixtures; public workflow separately verified",
        },
        source: "HTTPS private CA with real Mongo/Redis separate synthetic UUID",
        limits: [
          "Bounded local sample, hot church/config/fund fences serialize writes; no production SLA/capacity proof",
          "No payouts/ledger writes, real data, restore/pilot/multi-replica proof",
        ],
      },
      null,
      2,
    ),
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
