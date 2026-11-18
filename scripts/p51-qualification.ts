import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { config } from "../api/config";
import type { Fund } from "../api/finance/models";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { localTls } from "./local-tls";
import { check, localOnly, SyntheticClient, syntheticOwner, syntheticUser } from "./p2-fixtures";
import { financeChurch, financeRoot, financeSetup } from "./p51-fixtures";

const base = config();
localOnly(base);
const run = crypto.randomUUID().replaceAll("-", ""),
  privateDir = resolve(".local", `p5.1-${run}`),
  out = resolve("output/p5.1/qualification");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3493",
    port: 3493,
    database: `church_cms_test_p51q_${run}`,
    csrfKey: crypto.randomUUID() + crypto.randomUUID(),
    cert: tls.cert,
    key: tls.key,
  };
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey),
  checks: string[] = [],
  plans: unknown[] = [],
  measurements: unknown[] = [];
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
    fetch: (req) => app(req, { ip: req.headers.get("x-synthetic-client") ?? "p51q" }),
  });
  const owner = client("owner");
  await syntheticOwner(db, owner);
  const c = await financeChurch(owner),
    other = await financeChurch(owner),
    p = client(),
    t = client(),
    foreign = client();
  await syntheticUser(owner, p, c, "pastor");
  await syntheticUser(owner, t, c, "treasurer");
  await syntheticUser(owner, foreign, other, "pastor");
  const root = financeRoot(c),
    setup = await p.call(`${root}/settings`, financeSetup);
  assert(setup.status === 201, "public-config-init");
  const made = await p.call(`${root}/funds`, { name: "Qualification history" });
  assert(made.status === 201, "public-fund-create");
  const id = made.payload.data.fundId;
  for (let i = 1; i <= 30; i++)
    assert(
      (
        await p.call(
          `${root}/funds/${id}`,
          { name: `Qualification history ${i}` },
          { method: "PATCH", version: i },
        )
      ).status === 200,
      `public-history-edit-${i}`,
    );
  const history = await p.call(`${root}/funds/${id}/history?limit=25`);
  assert(
    history.payload.data.items.length === 25 && !!history.payload.data.nextCursor,
    "history-public-page",
  );
  const remainder = await p.call(
    `${root}/funds/${id}/history?cursor=${history.payload.data.nextCursor}`,
  );
  assert(remainder.payload.data.items.length === 6, "history-public-next-page");
  assert((await foreign.call(`${root}/funds`)).status === 403, "cross-tenant-denied");
  assert(
    (await foreign.call(`${financeRoot(other)}/funds/${id}`)).status === 404,
    "foreign-id-denied",
  );
  assert((await owner.call(`owner/${root}/funds`)).status === 403, "owner-denied");
  const seed = await db.db.collection<Fund>("finance_funds").findOne({ _id: new ObjectId(id) });
  check(seed, "Seed fund");
  let prior = 0;
  for (const size of [100, 500, 2000]) {
    // Stored-volume rows exercise indexes and bounded queries; only the workflow above claims public command history.
    await db.db.collection<Fund>("finance_funds").insertMany(
      Array.from({ length: size - prior }, (_, n) => {
        const i = prior + n,
          name = `Volume quỹ ${String(i).padStart(5, "0")}`;
        return {
          ...seed,
          _id: new ObjectId(),
          name,
          nameKey: name.toLowerCase(),
          status: i % 5 === 0 ? ("inactive" as const) : ("active" as const),
          version: 1,
        };
      }),
    );
    prior = size;
    for (const [kind, filter] of [
      ["all", { churchId: new ObjectId(c.id) }],
      ["active", { churchId: new ObjectId(c.id), status: "active" }],
      [
        "prefix",
        { churchId: new ObjectId(c.id), status: "active", nameKey: { $regex: "^volume quỹ 00" } },
      ],
    ] as const) {
      const plan = await db.db
          .collection("finance_funds")
          .find(filter)
          .sort({ nameKey: 1, _id: 1 })
          .limit(26)
          .explain("executionStats"),
        selected = JSON.stringify(plan.queryPlanner.winningPlan);
      assert(
        !selected.includes('"stage":"COLLSCAN"') && plan.executionStats.totalDocsExamined <= 26,
        `indexed-${kind}-${size}`,
      );
      plans.push({ size, kind, plan: plan.queryPlanner.winningPlan, stats: plan.executionStats });
    }
    const hp = await db.db
      .collection("finance_history")
      .find({ churchId: new ObjectId(c.id), targetType: "fund", targetId: new ObjectId(id) })
      .sort({ _id: -1 })
      .limit(26)
      .explain("executionStats");
    assert(
      !JSON.stringify(hp.queryPlanner.winningPlan).includes('"stage":"COLLSCAN"') &&
        hp.executionStats.totalDocsExamined <= 26,
      `indexed-history-${size}`,
    );
    plans.push({
      size,
      kind: "history",
      plan: hp.queryPlanner.winningPlan,
      stats: hp.executionStats,
    });
    for (const workers of [1, 5, 10]) {
      const samples: number[] = [],
        failures: number[] = [];
      let next = 0;
      const total = workers === 1 ? 10 : workers === 5 ? 25 : 50;
      await Promise.all(
        Array.from({ length: workers }, async () => {
          while (next < total) {
            const n = next++;
            const actor = n % 2 ? p : t,
              start = performance.now(),
              r = await actor.call(`${root}/funds?limit=25&status=active`);
            samples.push(performance.now() - start);
            if (r.status !== 200) failures.push(r.status);
            else
              assert(
                r.payload.data.items.length === 25 && !!r.payload.data.nextCursor,
                `bounded-page-${size}-${workers}-${n}`,
              );
          }
        }),
      );
      assert(failures.length === 0, `workload-no-failure-${size}-${workers}`);
      const sorted = [...samples].sort((a, b) => a - b),
        pct = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
      measurements.push({
        size,
        workers,
        samples: total,
        p50: pct(0.5),
        p95: pct(0.95),
        max: sorted.at(-1),
        failures,
      });
    }
  }
  await Bun.write(
    `${out}/qualification.json`,
    JSON.stringify(
      {
        status: "PASS",
        checks,
        plans,
        measurements,
        environment: { bun: Bun.version, platform: process.platform, arch: process.arch },
        limits: [
          "Loopback HTTPS/private CA, real MongoDB/Redis, synthetic DB UUID only",
          "Volume funds are direct stored fixtures; workflow/history tested separately through public API",
          "No financial transactions/balances, no SLA/capacity/production or restore claim",
          "Aggregate P5 restore remains later scope",
        ],
      },
      null,
      2,
    ),
  );
  console.info(
    JSON.stringify({
      status: "PASS",
      checks: checks.length,
      plans: plans.length,
      configs: measurements.length,
    }),
  );
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
    JSON.stringify({
      removed,
      privateDirRemoved: !(await Bun.file(`${privateDir}/localhost-key.pem`).exists()),
      database: conf.database,
    }),
  );
}
