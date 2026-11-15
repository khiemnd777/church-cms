import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import type { VisitCase } from "../api/visitation/models";
import { localTls } from "./local-tls";
import { check, localOnly, SyntheticClient, syntheticOwner } from "./p2-fixtures";
import { careCommon, careCreate, careRecord, careRoot, careSave, p43Fixture } from "./p43-fixtures";

const base = config();
localOnly(base);
const run = crypto.randomUUID().replaceAll("-", ""),
  privateDir = resolve(".local", `p4.3-${run}`),
  out = resolve("output/p4.3");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3482",
    port: 3482,
    database: `church_cms_test_p43q_${run}`,
    csrfKey: crypto.randomUUID() + crypto.randomUUID(),
    cert: tls.cert,
    key: tls.key,
  };
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let server: ReturnType<typeof Bun.serve> | undefined;
const results: unknown[] = [],
  plans: unknown[] = [],
  checks: string[] = [];
const assert = (v: unknown, label: string) => {
  check(v, label);
  checks.push(label);
};
const percentile = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * p) - 1)] ?? 0;
const client = (realm: "owner" | "church") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => {
    const h = new Headers(req.headers);
    h.set("x-synthetic-client", ip);
    return fetch(new Request(req, { headers: h }), { tls: { ca } });
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
    fetch: (req) => app(req, { ip: req.headers.get("x-synthetic-client") ?? "p43q" }),
  });
  const owner = client("owner"),
    actor = await syntheticOwner(db, owner);
  for (const size of [100, 500, 2000]) {
    const c = await p43Fixture(db, owner, actor.id, size),
      churchId = new ObjectId(c.id),
      root = careRoot(c, owner),
      first = await careSave(owner, c, careCreate(c.target));
    assert(first.status === 201, `public-seed-${size}`);
    const raw = await db.db
      .collection<VisitCase>("visitation_cases")
      .findOne({ _id: new ObjectId(first.payload.data.caseId) });
    check(raw, "seed case");
    // Explicit volume records only; random target IDs are not claimed as real linked-member/public-command history.
    await db.db.collection<VisitCase>("visitation_cases").insertMany(
      Array.from({ length: size - 1 }, (_, i) => ({
        ...raw,
        _id: new ObjectId(),
        code: `TV-VOLUME-${size}-${i}`,
        targetId: new ObjectId(),
        targetNameKey: `synthetic ${String(i).padStart(6, "0")}`,
      })),
    );
    const explain = await db.db
      .collection("visitation_cases")
      .find({ churchId, state: "open" })
      .sort({ _id: -1 })
      .limit(26)
      .explain("executionStats");
    assert(
      explain.executionStats.totalDocsExamined <= 26 &&
        JSON.stringify(explain.queryPlanner.winningPlan).includes("visitation_state_page"),
      `indexed-open-page-${size}`,
    );
    plans.push({
      size,
      kind: "cases",
      plan: explain.queryPlanner.winningPlan,
      stats: explain.executionStats,
    });
    const workers: { id: string; personId: string; version: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const personId = c.people[i + 1]?._id.toHexString();
      check(personId, "worker target");
      const made = await careSave(
        owner,
        c,
        careCreate({ kind: "member", id: personId }, { description: `Worker synthetic ${i}` }),
      );
      assert(made.status === 201, `public-worker-${size}-${i}`);
      workers.push({ id: made.payload.data.caseId, personId, version: made.payload.data.version });
    }
    for (const concurrency of [1, 5, 10]) {
      const latency: number[] = [],
        stages: Record<string, number[]> = {
          list: [],
          read: [],
          preview: [],
          commit: [],
          entries: [],
        };
      let requests = 0,
        retries = 0;
      const statuses: Record<string, number> = {};
      async function call(stage: string, path: string, body?: object, v?: number) {
        const t = performance.now(),
          r = await owner.call(path, body, {
            version: v,
            method: stage === "commit" ? "PATCH" : body ? "POST" : "GET",
          });
        requests++;
        stages[stage]?.push(performance.now() - t);
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        return r;
      }
      async function journey(worker: number) {
        const state = workers[worker];
        check(state, "worker");
        const start = performance.now();
        const listing = await call("list", `${root}/cases?limit=25`);
        check(
          listing.status === 200 &&
            listing.payload.data.items.length <= 25 &&
            listing.payload.data.summary.total >= size,
          "bounded list and scoped summary",
        );
        for (let attempt = 0; attempt < 32; attempt++) {
          const path = `${root}/cases/${state.id}`,
            d = await call("read", path);
          check(d.status === 200, "case read");
          const b = careRecord([state.personId]),
            p = await call("preview", `${path}/preview`, b, d.payload.data.version);
          check(p.status === 200, `entry preview ${p.status}`);
          const r = await call(
            "commit",
            path,
            { ...b, preview: p.payload.data.context },
            d.payload.data.version,
          );
          if (r.status === 200) {
            state.version = r.payload.data.version;
            const e = await call("entries", `${path}/entries?limit=25`);
            check(
              e.status === 200 &&
                e.payload.data.items.length > 0 &&
                e.payload.data.items.length <= 25,
              "bounded entries read",
            );
            latency.push(performance.now() - start);
            return;
          }
          check([409, 412].includes(r.status), `unexpected commit ${r.status}`);
          retries++;
          await Bun.sleep(Math.min(500, 50 * 2 ** Math.min(attempt, 4)) * (0.5 + Math.random()));
        }
        throw Error("Bounded contention retry exhausted");
      }
      const iterations = concurrency === 1 ? 20 : concurrency === 5 ? 12 : 8,
        finished = await Promise.allSettled(
          Array.from({ length: concurrency }, (_, worker) =>
            (async () => {
              for (let i = 0; i < iterations; i++) await journey(worker);
            })(),
          ),
        );
      for (const r of finished) if (r.status === "rejected") throw r.reason;
      assert(latency.length === concurrency * iterations, `journeys-${size}-${concurrency}`);
      const result = {
        size,
        concurrency,
        measuredJourneys: latency.length,
        requests,
        retries,
        statuses,
        p50: percentile(latency, 0.5),
        p95: percentile(latency, 0.95),
        max: Math.max(...latency),
        stages: Object.fromEntries(
          Object.entries(stages).map(([k, v]) => [
            k,
            {
              samples: v.length,
              p50: percentile(v, 0.5),
              p95: percentile(v, 0.95),
              max: Math.max(...v),
            },
          ]),
        ),
      };
      results.push(result);
      console.info(JSON.stringify(result));
    }
    for (const worker of workers) {
      const closed = await careSave(
        owner,
        c,
        { action: "complete", ...careCommon, confirmed: true },
        worker.id,
        worker.version,
      );
      assert(closed.status === 200, `public-completion-${size}-${worker.id}`);
    }
    const sample = workers[0];
    check(sample, "entry plan");
    const entryPlan = await db.db
      .collection("visitation_entries")
      .find({ churchId, caseId: new ObjectId(sample.id) })
      .sort({ _id: -1 })
      .limit(26)
      .explain("executionStats");
    assert(
      entryPlan.executionStats.totalDocsExamined <= 26 &&
        JSON.stringify(entryPlan.queryPlanner.winningPlan).includes("visitation_entry_page"),
      `indexed-entry-page-${size}`,
    );
    plans.push({
      size,
      kind: "entries",
      plan: entryPlan.queryPlanner.winningPlan,
      stats: entryPlan.executionStats,
    });
    const cancelled = await careSave(
      owner,
      c,
      { action: "cancel", ...careCommon, reason: "Kết thúc fixture synthetic", confirmed: true },
      first.payload.data.caseId,
      first.payload.data.version,
    );
    assert(cancelled.status === 200, `public-cancellation-${size}`);
  }
  await Bun.write(
    `${out}/qualification.json`,
    JSON.stringify(
      {
        status: "PASS",
        results,
        plans,
        checks,
        limits: [
          "Local synthetic HTTPS/private CA only",
          "Explicit storage volume fixtures, including placeholder target IDs, are separate from public linked-source workflows",
          "480 measured journeys: list+summary/current read/entry preview/record/entry page;30 completions and3cancellations outside latency",
          "Bounded32 attempts with capped exponential jitter model explicit reread/repreview, UI never auto-accepts",
          "No production SLA/capacity/RPO/RTO; P4 aggregate restore remains unopened P4.6",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (server) await server.stop(true);
  if (db.db.databaseName === `church_cms_test_p43q_${run}`) await db.db.dropDatabase();
  const remaining = (await db.client.db("admin").admin().listDatabases()).databases.some(
    (d) => d.name === conf.database,
  );
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
  await rm(privateDir, { recursive: true, force: true });
  await Bun.write(
    `${out}/qualification-cleanup.json`,
    JSON.stringify({
      database: conf.database,
      removed: !remaining,
      privateDirRemoved: !(await Bun.file(`${privateDir}/root-ca.pem`).exists()),
      listener: 3482,
      serverStopped: true,
    }),
  );
}
