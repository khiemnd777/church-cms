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
import {
  check,
  localOnly,
  SyntheticClient,
  seedP2,
  syntheticChurch,
  syntheticOwner,
  syntheticUser,
} from "./p2-fixtures";

const run = crypto.randomUUID().replaceAll("-", ""),
  base = config();
localOnly(base);
const privateDir = resolve(".local", `p3.1-${run}`),
  out = resolve("output/p3.1");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text();
const conf = {
  ...base,
  origin: "https://localhost:3464",
  port: 3464,
  database: `church_cms_test_p31q_${run}`,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
  cert: tls.cert,
  key: tls.key,
};
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let server: ReturnType<typeof Bun.serve> | undefined;
const results: object[] = [],
  checks: string[] = [];
function assert(value: unknown, label: string) {
  check(value, label);
  checks.push(label);
}
const makeClient = (realm: "owner" | "church") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => {
    const headers = new Headers(req.headers);
    headers.set("x-synthetic-client", ip);
    return fetch(new Request(req, { headers }), { tls: { ca } });
  });
};
const percentile = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * p) - 1)] ?? 0;
try {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  const app = createApp(identity, conf, { log: () => {} });
  // Test-only loopback server with synthetic per-client IPs; no production auth/rate-limit change.
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: conf.port,
    idleTimeout: 15,
    tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) },
    fetch: (req) => app(req, { ip: req.headers.get("x-synthetic-client") ?? "p31-qualification" }),
  });
  const owner = makeClient("owner"),
    ownerInfo = await syntheticOwner(db, owner);
  for (const size of [100, 500, 2000]) {
    const c = await syntheticChurch(owner, `P31 qualification ${size}`);
    await seedP2(db, c.id, ownerInfo.id, size);
    await db.db
      .collection("members")
      .updateMany({ churchId: new ObjectId(c.id) }, { $set: { participation: "active" } });
    const operators: SyntheticClient[] = [];
    for (let i = 0; i < 10; i++) {
      const user = makeClient("church");
      await syntheticUser(owner, user, c, "secretary");
      operators.push(user);
    }
    for (const concurrency of [1, 5, 10]) {
      const prefix = `owner/churches/${c.id}/attendance`,
        userPrefix = `churches/${c.id}/attendance`;
      const made = await owner.call(`${prefix}/sessions`, {
        label: `Đo ${size}/${concurrency}`,
        heldOn: businessDay(),
        location: null,
        scope: "church",
        unitId: null,
      });
      assert(made.status === 201, `create-${size}-${concurrency}`);
      const id = made.payload.data.sessionId,
        preview = await owner.call(`${prefix}/sessions/${id}/candidates`);
      assert(
        preview.status === 200 && preview.payload.data.total === size,
        `preview-${size}-${concurrency}`,
      );
      const opened = await owner.call(
        `${prefix}/sessions/${id}/open`,
        { previewToken: preview.payload.data.previewToken },
        { version: 1 },
      );
      assert(opened.status === 200, `open-${size}-${concurrency}`);
      const generation = opened.payload.data.generation;
      const rows = await db.db
        .collection("attendance_participants")
        .find({ churchId: new ObjectId(c.id), sessionId: new ObjectId(id) })
        .sort({ nameKey: 1, memberId: 1 })
        .limit(70)
        .toArray();
      async function write(index: number, subject: SyntheticClient, measured: boolean) {
        const row = rows[index];
        check(row, "Participant fixture missing");
        const key = crypto.randomUUID(),
          start = performance.now(),
          statuses: number[] = [];
        for (let attempt = 0; attempt < 10; attempt++) {
          const r = await subject.call(
            `${userPrefix}/sessions/${id}/participants/${row.memberId}`,
            { present: true, generation },
            { method: "PATCH", version: 1, key },
          );
          statuses.push(r.status);
          if (r.status === 200)
            return {
              latencyMs: performance.now() - start,
              attempts: attempt + 1,
              statuses,
              measured,
            };
          check(
            ["OPERATION_IN_PROGRESS", "DEPENDENCY_UNAVAILABLE", "OUTCOME_UNKNOWN"].includes(
              r.payload?.error?.code,
            ),
            `Unexpected measured status ${r.status}`,
          );
        }
        throw new Error("Bounded same-intent retries exhausted");
      }
      for (let i = 0; i < 10; i++) await write(i, operators[0] as SyntheticClient, false);
      let next = 10;
      const measured: Awaited<ReturnType<typeof write>>[] = [];
      await Promise.all(
        Array.from({ length: concurrency }, async (_, worker) => {
          while (next < 70) {
            const index = next++;
            measured.push(await write(index, operators[worker] as SyntheticClient, true));
          }
        }),
      );
      const current = await owner.call(`${prefix}/sessions/${id}`);
      assert(
        current.payload.data.presentCount === 70 && current.payload.data.includedCount === size,
        `count70-${size}-${concurrency}`,
      );
      assert(
        (await db.db
          .collection("attendance_history")
          .countDocuments({ sessionId: new ObjectId(id), event: "marked" })) === 70,
        `history-once-${size}-${concurrency}`,
      );
      const resetStart = performance.now();
      const reset = await owner.call(
        `${prefix}/sessions/${id}/reset`,
        { reason: "Qualification reset" },
        { version: current.payload.data.version },
      );
      const resetMs = performance.now() - resetStart;
      assert(
        reset.status === 200 &&
          (await owner.call(`${prefix}/sessions/${id}`)).payload.data.presentCount === 0,
        `reset-${size}-${concurrency}`,
      );
      const latencies = measured.map((r) => r.latencyMs),
        statusCounts: Record<string, number> = {};
      for (const r of measured)
        for (const status of r.statuses) statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      results.push({
        size,
        concurrency,
        warmup: 10,
        measuredIntents: measured.length,
        completedIntents: 60,
        p50Ms: percentile(latencies, 0.5),
        p95Ms: percentile(latencies, 0.95),
        maxMs: Math.max(...latencies),
        attempts: measured.reduce((n, r) => n + r.attempts, 0),
        statusCounts,
        resetMs,
      });
      console.info(JSON.stringify(results.at(-1)));
    }
  }
  const rosterPlan = await db.db
    .collection("attendance_participants")
    .find({ churchId: new ObjectId(), sessionId: new ObjectId(), included: true })
    .sort({ nameKey: 1, memberId: 1 })
    .limit(26)
    .explain("executionStats");
  assert(
    JSON.stringify(rosterPlan.queryPlanner.winningPlan).includes("attendance_roster"),
    "roster-index-selected",
  );
  await Bun.write(
    `${out}/qualification.json`,
    JSON.stringify(
      {
        status: "PASS",
        configs: results,
        measuredIntents: 540,
        warmupIntents: 90,
        checks,
        rosterPlan,
        limits: [
          "Local synthetic/private CA/HTTPS loopback",
          "Single API process and local replica set",
          "Application-level same-intent retry latency included; HTTP contention responses reported",
          "No production SLA, real data, physical camera or multi-replica proof",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (server) await server.stop(true);
  let removed = false,
    cleanupError: string | null = null;
  try {
    if (db.db.databaseName === conf.database && conf.database.length <= 63)
      await db.db.dropDatabase();
    removed = !(await db.client.db("admin").admin().listDatabases()).databases.some(
      (d) => d.name === conf.database,
    );
  } catch {
    cleanupError = "Synthetic database cleanup could not be confirmed";
  } finally {
    await db.client.close();
    if (rate.client.isOpen) rate.client.destroy();
    await rm(privateDir, { recursive: true, force: true });
  }
  await Bun.write(
    `${out}/qualification-cleanup.json`,
    JSON.stringify({
      database: conf.database,
      removed,
      cleanupError,
      privateDirectoryRemoved: !(await Bun.file(`${privateDir}/localhost.pem`).exists()),
    }),
  );
  if (cleanupError) process.exitCode = 1;
}
