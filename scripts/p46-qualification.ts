import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "../api/app";
import { config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { localTls } from "./local-tls";
import { check, localOnly, SyntheticClient, syntheticOwner } from "./p2-fixtures";
import { p46Recovery } from "./p46-recovery";
import { p46Workflow } from "./p46-workflow";
import { type P46Metrics, p46Workload } from "./p46-workload";

const base = config();
localOnly(base);
const run = crypto.randomUUID().replaceAll("-", ""),
  privateDir = resolve(".local", `p4.6-${run}`),
  out = resolve("output/p4.6");
await mkdir(out, { recursive: true });
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3492",
    port: 3492,
    database: `church_cms_test_p46q_${run}`,
    csrfKey: crypto.randomUUID() + crypto.randomUUID(),
    cert: tls.cert,
    key: tls.key,
  };
const db = new Database(conf),
  target = new Database({ ...conf, database: `church_cms_test_p46restore_${run}` }),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let server: ReturnType<typeof Bun.serve> | undefined,
  accepting = true,
  inFlight = 0,
  metrics: P46Metrics | null = null;
const checks: string[] = [],
  assert = (ok: unknown, label: string) => {
    check(ok, label);
    checks.push(label);
  };
const client = (realm: "owner" | "church") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, async (req) => {
    req.headers.set("x-synthetic-client", ip);
    const start = performance.now(),
      m = metrics,
      response = await fetch(req, { tls: { ca, rejectUnauthorized: true } });
    if (m) {
      m.requests++;
      m.statuses[response.status] = (m.statuses[response.status] ?? 0) + 1;
      const path = new URL(req.url).pathname,
        domain = path.includes("/suggestions")
          ? "care"
          : path.includes("/prayers")
            ? "prayer"
            : path.includes("/care")
              ? "visit"
              : path.includes("/programs")
                ? "program"
                : "schedule",
        stage = `${domain}:${req.method}:${path.endsWith("/preview") ? "preview" : req.method === "GET" ? "read" : "commit"}`;
      m.stages[stage] ??= [];
      m.stages[stage].push(performance.now() - start);
    }
    return response;
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
        return await app(req, { ip: req.headers.get("x-synthetic-client") ?? "p46q" });
      } finally {
        inFlight--;
      }
    },
  });
  const owner = client("owner"),
    actor = await syntheticOwner(db, owner),
    flow = await p46Workflow(db, owner, actor.id, client, assert);
  await Bun.write(
    `${out}/workflow.json`,
    JSON.stringify(
      {
        status: "PASS",
        checks,
        churches: 2,
        realms: ["owner", "church"],
        programId: flow.program.id,
        caseId: flow.visit.id,
        alertId: flow.visit.alertId,
        limits: [
          "Real public commands with real Mongo/Redis over loopback HTTPS; no main runtime/data",
          "Privacy/transactions require assertions, not screenshots",
          "P3.4 prior race cause UNKNOWN remains",
        ],
      },
      null,
      2,
    ),
  );
  const workload = await p46Workload(
    db,
    owner,
    actor.id,
    client,
    (m) => {
      metrics = m;
    },
    assert,
  );
  await Bun.write(`${out}/qualification.json`, JSON.stringify(workload, null, 2));
  const recovery = await p46Recovery({
    db,
    target,
    conf,
    privateDir,
    owner,
    actor,
    flow,
    assert,
    quiesce: async () => {
      accepting = false;
      const inFlightAtCut = inFlight;
      for (let i = 0; inFlight > 0 && i < 300; i++) await Bun.sleep(10);
      check(inFlight === 0, "admitted requests drained within3s");
      const probe = await fetch(`${conf.origin}/api/v1/owner/auth/me`, {
        tls: { ca, rejectUnauthorized: true },
      });
      await probe.arrayBuffer();
      return { inFlightAtCut, drained: inFlight, probeStatus: probe.status };
    },
  });
  await Bun.write(`${out}/restore.json`, JSON.stringify({ ...recovery, checks }, null, 2));
  console.info(
    JSON.stringify({
      status: "PASS",
      configs: workload.results.length,
      journeys: 480,
      plans: workload.plans.length,
      collections: recovery.collectionCount,
      checks: checks.length,
    }),
  );
} catch (error) {
  await Bun.write(
    `${out}/qualification-failure.json`,
    JSON.stringify(
      { status: "FAIL", message: error instanceof Error ? error.message : "Unknown error", checks },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await server?.stop(true);
  const removed: Record<string, boolean> = {};
  for (const d of [db, target]) {
    try {
      check(
        [`church_cms_test_p46q_${run}`, `church_cms_test_p46restore_${run}`].includes(
          d.db.databaseName,
        ),
        "exact owned DB cleanup",
      );
      await d.db.dropDatabase();
      removed[d.db.databaseName] = !(await d.db.admin().listDatabases()).databases.some(
        (x) => x.name === d.db.databaseName,
      );
    } finally {
      await d.client.close();
    }
  }
  if (rate.client.isOpen) rate.client.destroy();
  await rm(privateDir, { recursive: true, force: true });
  await Bun.write(
    `${out}/qualification-cleanup.json`,
    JSON.stringify(
      {
        removed,
        privateDirRemoved: !(await Bun.file(tls.key).exists()),
        listener: 3492,
        serverStopped: true,
        limits: [
          "Only exact owned UUID DBs and private directory; shared Mongo/Redis kept running; no main DB read/init/restart or Redis flush",
        ],
      },
      null,
      2,
    ),
  );
}
