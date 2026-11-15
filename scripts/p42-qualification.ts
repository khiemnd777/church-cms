import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import type { ProgramDraft } from "../api/programs/models";
import { localTls } from "./local-tls";
import { check, localOnly, SyntheticClient, syntheticOwner } from "./p2-fixtures";
import { p42Fixture, p42Save, programCommand, programRoot } from "./p42-fixtures";

const base = config();
localOnly(base);
const run = crypto.randomUUID().replaceAll("-", ""),
  privateDir = resolve(".local", `p4.2-${run}`),
  out = resolve("output/p4.2");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3478",
    port: 3478,
    database: `church_cms_test_p42q_${run}`,
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
    fetch: (req) => app(req, { ip: req.headers.get("x-synthetic-client") ?? "p42q" }),
  });
  const owner = client("owner"),
    actor = await syntheticOwner(db, owner);
  for (const size of [100, 500, 2000]) {
    const c = await p42Fixture(db, owner, actor.id, size),
      churchId = new ObjectId(c.id),
      root = programRoot(c, owner);
    const first = await p42Save(
      owner,
      c,
      programCommand("create", { unitId: c.unit, occurrenceId: c.occurrence }),
    );
    assert(first.status === 201, `seed-program-${size}`);
    const raw = await db.db
      .collection<ProgramDraft>("program_drafts")
      .findOne({ _id: new ObjectId(first.payload.data.programId) });
    check(raw, "seed root");
    // Volume records only: these deliberately do not claim public-command/operation history.
    await db.db.collection<ProgramDraft>("program_drafts").insertMany(
      Array.from({ length: size - 1 }, () => ({
        ...raw,
        _id: new ObjectId(),
        occurrenceId: new ObjectId(),
      })),
    );
    const explain = await db.db
      .collection("program_drafts")
      .find({ churchId, unitId: new ObjectId(c.unit) })
      .sort({ _id: -1 })
      .limit(26)
      .explain("executionStats");
    const es = explain.executionStats;
    assert(
      es.totalDocsExamined <= 26 &&
        JSON.stringify(explain.queryPlanner.winningPlan).includes("program_unit_page"),
      `indexed-bounded-unit-page-${size}`,
    );
    plans.push({ size, plan: explain.queryPlanner.winningPlan, stats: es });
    // Each worker gets a real matching P4.1 occurrence and a public-created draft.
    const source = await db.db
      .collection("schedule_occurrences")
      .findOne({ _id: new ObjectId(c.occurrence) });
    check(source, "seed occurrence");
    const workers: { id: string; version: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const id = new ObjectId();
      await db.db
        .collection("schedule_occurrences")
        .insertOne({ ...source, _id: id, seriesId: new ObjectId(), programFence: 0 });
      const r = await p42Save(
        owner,
        c,
        programCommand("create", { unitId: c.unit, occurrenceId: id.toHexString() }),
      );
      assert(r.status === 201, `public-worker-create-${size}-${i}`);
      workers.push({ id: r.payload.data.programId, version: r.payload.data.version });
    }
    for (const concurrency of [1, 5, 10]) {
      const latencies: number[] = [],
        stages: Record<string, number[]> = { read: [], preview: [], commit: [], print: [] };
      let requests = 0,
        retries = 0;
      const statuses: Record<string, number> = {};
      async function call(stage: string, path: string, body?: object, v?: number) {
        const start = performance.now();
        const r = await owner.call(path, body, {
          version: v,
          method: stage === "commit" ? "PATCH" : body ? "POST" : "GET",
        });
        requests++;
        (stages[stage] as number[]).push(performance.now() - start);
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        return r;
      }
      async function journey(worker: number) {
        const state = workers[worker];
        check(state, "worker");
        const start = performance.now();
        for (let attempt = 0; attempt < 20; attempt++) {
          const path = `${root}/drafts/${state.id}`,
            d = await call("read", path);
          check(d.status === 200, "workload read");
          const b = programCommand("regenerate"),
            p = await call("preview", `${path}/preview`, b, d.payload.data.version);
          check(p.status === 200, "workload preview");
          const r = await call(
            "commit",
            path,
            { ...b, preview: p.payload.data.context },
            d.payload.data.version,
          );
          if (r.status === 200) {
            state.version = r.payload.data.version;
            const print = await call("print", `${path}/print?version=${state.version}`);
            check(
              print.status === 200 && print.text?.includes("BẢN NHÁP"),
              "workload authenticated print",
            );
            latencies.push(performance.now() - start);
            return;
          }
          check([409, 412].includes(r.status), `unexpected ${r.status}`);
          retries++;
          await Bun.sleep(Math.min(500, 50 * 2 ** Math.min(attempt, 4)) * (0.5 + Math.random()));
        }
        throw Error("Bounded workload retry exhausted");
      }
      const iterations = concurrency === 1 ? 20 : concurrency === 5 ? 12 : 8;
      await Promise.all(
        Array.from({ length: concurrency }, (_, worker) =>
          (async () => {
            for (let i = 0; i < iterations; i++) await journey(worker);
          })(),
        ),
      );
      assert(latencies.length === concurrency * iterations, `journeys-${size}-${concurrency}`);
      const result = {
        size,
        concurrency,
        measuredJourneys: latencies.length,
        requests,
        retries,
        statuses,
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: Math.max(...latencies),
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
      const r = await p42Save(
        owner,
        c,
        programCommand("finalize", { incompleteConfirmed: true }),
        worker.id,
        worker.version,
      );
      assert(r.status === 200, `worker-finalize-${size}-${worker.id}`);
      const p = await owner.call(`${root}/drafts/${worker.id}/print?revision=1&version=1`);
      assert(
        p.status === 200 && p.text?.includes("Bản chốt r1"),
        `worker-final-print-${size}-${worker.id}`,
      );
    }
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
          "Synthetic local HTTPS/private CA",
          "Explicit storage volume fixtures are separate from public workflow history",
          "Measured regenerate/read/preview/commit/draft-print; 30 additional finalize/edition-print checks outside latency samples",
          "Bounded retries model explicit reread/repreview; UI never auto-accepts changes",
          "No production SLA/capacity/RPO/RTO; P4 aggregate restore remains unopened P4.6",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (server) await server.stop(true);
  if (db.db.databaseName === `church_cms_test_p42q_${run}`) await db.db.dropDatabase();
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
      listener: 3478,
      serverStopped: true,
    }),
  );
}
