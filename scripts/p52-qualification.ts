import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { config } from "../api/config";
import { decimalString } from "../api/finance/money";
import type { LedgerEntry, Receipt } from "../api/finance/transactions-model";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { businessDay } from "../api/members/dates";
import { localTls } from "./local-tls";
import {
  check,
  localOnly,
  SyntheticClient,
  seedP2,
  syntheticOwner,
  syntheticUser,
} from "./p2-fixtures";
import { financeChurch, financeRoot } from "./p51-fixtures";

const base = config();
localOnly(base);
const run = crypto.randomUUID().replaceAll("-", ""),
  privateDir = resolve(".local", `p5.2-${run}`),
  out = resolve("output/p5.2/qualification");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3496",
    port: 3496,
    database: `church_cms_test_p52q_${run}`,
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
    fetch: (req) => app(req, { ip: req.headers.get("x-synthetic-client") ?? "p52q" }),
  });
  const owner = client("owner");
  await syntheticOwner(db, owner);
  const c = await financeChurch(owner, "P52 qualification"),
    p = client(),
    t = client();
  const pastor = await syntheticUser(owner, p, c, "pastor");
  await syntheticUser(owner, t, c, "treasurer");
  const root = financeRoot(c),
    f = await p.call(`${root}/funds`, { name: "Quỹ qualification" });
  assert(f.status === 201, "public-fund");
  const people = await seedP2(db, c.id, pastor.id, 100),
    person = people.members.find((m) => ["active", "long_absent"].includes(m.participation));
  check(person, "Current person");
  const code = await t.call(`${root}/giving-codes`, { memberId: person._id.toHexString() });
  assert(code.status === 201, "public-giving-code");
  const givingId = code.payload.data.givingId;
  async function issue(s: SyntheticClient, ref: string) {
    const b = {
      submissionId: crypto.randomUUID(),
      businessDate: businessDay(),
      fundId: f.payload.data.fundId,
      sourceReference: ref,
      purpose: "Qualification synthetic",
      mode: "itemized",
      lines: [
        { givingId, amount: "9007199254740993" },
        { givingId, amount: "7" },
      ],
    };
    const preview = await s.call(`${root}/receipts/preview`, b);
    check(preview.status === 200, "Preview HTTPS");
    const command = { receipt: b, previewToken: preview.payload.data.previewToken },
      key = crypto.randomUUID();
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = await s.call(`${root}/receipts`, command, { key });
      if (r.status === 201 || r.status === 200) return r.payload.data.receiptId as string;
      const code = r.payload?.error?.code;
      retryResponses.push({ ref, attempt, status: r.status, code });
      check(
        ["OPERATION_IN_PROGRESS", "DEPENDENCY_UNAVAILABLE", "OUTCOME_UNKNOWN"].includes(code) &&
          attempt < 7,
        `Post HTTPS ${r.status} ${code}`,
      );
      await Bun.sleep(75 * (attempt + 1));
    }
    throw Error("Retry exhausted");
  }
  const id = await issue(t, "QUAL-INITIAL"),
    seed = await db.db.collection<Receipt>("finance_receipts").findOne({ _id: new ObjectId(id) }),
    entry = await db.db
      .collection<LedgerEntry>("finance_ledger")
      .findOne({ receiptId: new ObjectId(id) });
  check(seed && entry, "Seed receipt/ledger");
  let prior = 1;
  for (const size of [100, 500, 2000]) {
    const rows: Receipt[] = Array.from({ length: size - prior }, (_, n) => ({
      ...seed,
      _id: new ObjectId(),
      code: `PT-QUAL-${prior + n}`,
      submissionId: crypto.randomUUID(),
      sourceReference: `VOLUME-${prior + n}`,
    }));
    await db.db.collection<Receipt>("finance_receipts").insertMany(rows);
    await db.db
      .collection<LedgerEntry>("finance_ledger")
      .insertMany(
        rows.map((r) => ({ ...entry, _id: new ObjectId(), receiptId: r._id, receiptCode: r.code })),
      );
    prior = size;
    const day = businessDay(),
      period = day.slice(0, 7),
      from = `${period}-01`,
      to = new Date(`${from}T00:00:00Z`);
    to.setUTCMonth(to.getUTCMonth() + 1);
    const range = { $gte: from, $lt: to.toISOString().slice(0, 10) };
    for (const [kind, name, filter] of [
      ["receipts", "finance_receipts", { churchId: new ObjectId(c.id), businessDate: range }],
      [
        "fund",
        "finance_receipts",
        { churchId: new ObjectId(c.id), fundId: seed.fundId, businessDate: range },
      ],
      [
        "personal",
        "finance_receipts",
        {
          churchId: new ObjectId(c.id),
          "lines.givingId": new ObjectId(givingId),
          businessDate: range,
        },
      ],
      ["ledger", "finance_ledger", { churchId: new ObjectId(c.id), businessDate: range }],
    ] as const) {
      const exp = await db.db
        .collection(name)
        .find(filter)
        .sort({ businessDate: -1, _id: -1 })
        .limit(26)
        .explain("executionStats");
      const serialized = JSON.stringify(exp.queryPlanner.winningPlan);
      assert(
        !serialized.includes('"stage":"COLLSCAN"') && !serialized.includes('"stage":"SORT"'),
        `index-${kind}-${size}`,
      );
      plans.push({
        size,
        kind,
        winningPlan: exp.queryPlanner.winningPlan,
        executionStats: exp.executionStats,
      });
    }
    const response = await t.call(`${root}/receipts?limit=25`);
    assert(
      response.status === 200 &&
        response.payload.data.items.length === 25 &&
        !!response.payload.data.nextCursor,
      `bounded-public-page-${size}`,
    );
    assert(
      response.payload.data.netIncome === (BigInt(size) * 9007199254741000n).toString(),
      `exact-net-total-${size}`,
    );
  }
  const clients: SyntheticClient[] = [];
  for (let i = 0; i < 10; i++) {
    const s = client();
    await syntheticUser(owner, s, c, "treasurer");
    clients.push(s);
  }
  for (const concurrency of [1, 5, 10]) {
    const times: number[] = [],
      errors: string[] = [];
    await Promise.all(
      clients.slice(0, concurrency).map(async (s, i) => {
        for (let n = 0; n < 2; n++) {
          const started = performance.now();
          try {
            const read = await s.call(`${root}/receipts?limit=25`);
            check(read.status === 200, "List journey");
            const id = await issue(s, `JOURNEY-${concurrency}-${i}-${n}`);
            check((await s.call(`${root}/receipts/${id}`)).status === 200, "Detail journey");
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
      p50ms: times[Math.floor(times.length * 0.5)],
      p95ms: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)],
      maxMs: times.at(-1),
    });
    assert(!errors.length, `HTTPS-journeys-${concurrency}`);
  }
  const sums = await db.db
    .collection<LedgerEntry>("finance_ledger")
    .aggregate<{ total: LedgerEntry["amount"] }>([
      { $match: { churchId: new ObjectId(c.id) } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray();
  check(sums[0], "Ledger sum present");
  assert(
    (await t.call(`${root}/ledger`)).payload.data.netIncome === decimalString(sums[0].total),
    "readback-total-after-concurrency",
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
        source: "HTTPS private CA, actual Mongo/Redis separate synthetic database",
        volume: {
          receipts: 2000,
          memberSources: 100,
          givingCodes: 1,
          kind: "stored-volume fixture, not 2000 public workflow proofs",
        },
        limits: [
          "No production SLA, restore/pilot/multi-replica/real data proof",
          "Same existing church/account/fund fences serialize hot writes; only bounded local concurrency measured",
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
  await Bun.write(
    `${out}/cleanup.json`,
    JSON.stringify({ database: conf.database, removed, privateTlsRemoved: true }, null, 2),
  );
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
  await rm(privateDir, { recursive: true, force: true });
}
