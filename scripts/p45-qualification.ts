import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import type { CareAlert } from "../api/care/models";
import { config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { localTls } from "./local-tls";
import { check, localOnly, SyntheticClient, syntheticOwner, syntheticUser } from "./p2-fixtures";
import { careCreate, careSave } from "./p43-fixtures";
import {
  careCommon,
  careDecision,
  careRoot,
  careScan,
  p45Fixture,
  signalCreate,
  signalSave,
} from "./p45-fixtures";

const base = config();
localOnly(base);
const run = crypto.randomUUID().replaceAll("-", ""),
  privateDir = resolve(".local", `p4.5-${run}`),
  out = resolve("output/p4.5");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3489",
    port: 3489,
    database: `church_cms_test_p45q_${run}`,
    csrfKey: crypto.randomUUID() + crypto.randomUUID(),
    cert: tls.cert,
    key: tls.key,
  },
  db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let server: ReturnType<typeof Bun.serve> | undefined;
const results: unknown[] = [],
  plans: unknown[] = [],
  checks: string[] = [];
const assert = (ok: unknown, label: string) => {
  check(ok, label);
  checks.push(label);
};
const percentile = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * p) - 1)] ?? 0;
const client = (realm: "owner" | "church") =>
  new SyntheticClient(realm, conf.origin, (req) => fetch(req, { tls: { ca } }));
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
    fetch: (req) => app(req, { ip: crypto.randomUUID() }),
  });
  const owner = client("owner"),
    actor = await syntheticOwner(db, owner);
  for (const size of [100, 500, 2000]) {
    const c = await p45Fixture(db, owner, actor.id, size),
      churchId = new ObjectId(c.id),
      secretary = client("church"),
      pastor = client("church");
    await syntheticUser(owner, secretary, c, "secretary");
    await syntheticUser(owner, pastor, c, "pastor");
    const actors = [owner, secretary, pastor],
      roles = ["owner", "secretary", "pastor"];
    check(c.people.length >= 80, "80 current profiles for160 distinct work items");
    const work: {
      id: string;
      targetId: string;
      kind: "illness" | "new_believer";
      index: number;
    }[] = [];
    for (let i = 0; i < 160; i++) {
      const person = c.people[Math.floor(i / 2)];
      check(person, "work person");
      const kind = i % 2 ? "new_believer" : "illness",
        id = person._id.toHexString(),
        r = await signalSave(owner, c, signalCreate(id, kind));
      assert(r.status === 201, `public-work-source-${size}-${i}`);
      const a = await db.db
        .collection<CareAlert>("care_alerts")
        .findOne({ churchId, targetId: person._id, kind, episodeActive: true });
      check(a, "public evaluated alert");
      work.push({ id: a._id.toHexString(), targetId: id, kind, index: i });
      if (i % 5 === 0)
        assert(
          (
            await careSave(
              owner,
              c,
              careCreate(
                { kind: "member", id },
                { reasonCode: kind, description: "Existing public work case synthetic" },
              ),
            )
          ).status === 201,
          `existing-open-link-fixture-${size}-${i}`,
        );
    }
    const sample = await db.db
      .collection<CareAlert>("care_alerts")
      .findOne({ _id: new ObjectId(work[0]?.id) });
    check(sample, "volume sample");
    // Additional stored-volume clones have no public history and target placeholders; all measured work items above are real source-linked public workflows.
    await db.db.collection<CareAlert>("care_alerts").insertMany(
      Array.from({ length: size }, (_, i) => {
        const id = new ObjectId();
        return {
          ...sample,
          _id: new ObjectId(),
          code: `DN-VOLUME-${size}-${i}`,
          targetId: id,
          targetSnapshot: {
            kind: "member" as const,
            id: id.toHexString(),
            name: `Volume synthetic ${i}`,
            code: `TH-VOLUME-${i}`,
          },
          targetNameKey: `volume synthetic ${i}`,
          state: "expired" as const,
          episodeActive: false,
          availability: "ineligible" as const,
          evidence: [],
        };
      }),
    );
    const scan = await careScan(owner, c);
    assert(scan.pages >= 3, `bounded-complete-source-scan-${size}`);
    for (const state of ["pending", "all"]) {
      const plan = await db.db
          .collection("care_alerts")
          .find({ churchId, ...(state === "all" ? {} : { state }) })
          .sort({ _id: -1 })
          .limit(26)
          .explain("executionStats"),
        encoded = JSON.stringify(plan.queryPlanner.winningPlan);
      assert(
        plan.executionStats.nReturned === 26 &&
          plan.executionStats.totalDocsExamined <= 26 &&
          !encoded.includes('"stage":"COLLSCAN"') &&
          encoded.includes(state === "all" ? "care_alert_page" : "care_alert_state_page"),
        `indexed-alert-${state}-${size}`,
      );
      plans.push({
        size,
        kind: `alert-${state}`,
        plan: plan.queryPlanner.winningPlan,
        stats: plan.executionStats,
      });
    }
    const count = await db.db
      .collection("care_alerts")
      .aggregate([{ $match: { churchId, state: "pending" } }, { $count: "pending" }])
      .explain("executionStats");
    assert(
      JSON.stringify(count).includes("IXSCAN") || JSON.stringify(count).includes("COUNT_SCAN"),
      `indexed-pending-count-${size}`,
    );
    plans.push({ size, kind: "pending-count", plan: count });
    let offset = 0;
    for (const concurrency of [1, 5, 10]) {
      const iterations = concurrency === 1 ? 20 : concurrency === 5 ? 12 : 8,
        total = iterations * concurrency,
        jobs = work.slice(offset, offset + total);
      offset += total;
      const latency: number[] = [],
        byRole: Record<string, number[]> = { owner: [], secretary: [], pastor: [] },
        statuses: Record<string, number> = {},
        stage: Record<string, number[]> = {
          list: [],
          read: [],
          preview: [],
          commit: [],
          history: [],
        };
      let requests = 0,
        retries = 0,
        creates = 0,
        links = 0,
        dismisses = 0;
      const call = async (
        s: SyntheticClient,
        label: string,
        path: string,
        body?: object,
        version?: number,
      ) => {
        const start = performance.now(),
          r = await s.call(path, body, {
            method: body ? (path.endsWith("/preview") ? "POST" : "PATCH") : "GET",
            version,
          });
        (stage[label] as number[]).push(performance.now() - start);
        requests++;
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        return r;
      };
      const finished = await Promise.allSettled(
        Array.from({ length: concurrency }, (_, worker) =>
          (async () => {
            for (let i = 0; i < iterations; i++) {
              const role = (worker + i) % 3,
                s = actors[role],
                job = jobs[worker * iterations + i],
                roleName = roles[role];
              check(s && job && roleName, "job context");
              const root = careRoot(c, s),
                start = performance.now(),
                list = await call(s, "list", `${root}?limit=25`);
              check(
                list.status === 200 &&
                  list.payload.data.items.length <= 25 &&
                  list.payload.data.summary.total >= 0,
                "bounded list/summary",
              );
              let succeeded = false;
              for (let attempt = 0; attempt < 32; attempt++) {
                const d = await call(s, "read", `${root}/${job.id}`);
                check(d.status === 200, "detail read");
                const b =
                    job.index % 3 === 0
                      ? {
                          action: "dismiss" as const,
                          ...careCommon,
                          reason: "Measured dismissal synthetic",
                        }
                      : careDecision(d.payload.data.existing),
                  p = await call(
                    s,
                    "preview",
                    `${root}/${job.id}/preview`,
                    b,
                    d.payload.data.record.version,
                  );
                check(p.status === 200, `preview ${p.status}`);
                const r = await call(
                  s,
                  "commit",
                  `${root}/${job.id}`,
                  { ...b, preview: p.payload.data.context, confirmed: true },
                  d.payload.data.record.version,
                );
                if (r.status === 200) {
                  const h = await call(s, "history", `${root}/${job.id}/history?limit=25`);
                  check(
                    h.status === 200 &&
                      h.payload.data.items.length > 0 &&
                      h.payload.data.items.length <= 25,
                    "bounded history",
                  );
                  const elapsed = performance.now() - start;
                  latency.push(elapsed);
                  (byRole[roleName] as number[]).push(elapsed);
                  if (b.action === "dismiss") dismisses++;
                  else if (b.mode === "link") links++;
                  else creates++;
                  succeeded = true;
                  break;
                }
                check([409, 412].includes(r.status), `unexpected commit ${r.status}`);
                retries++;
                await Bun.sleep(
                  Math.min(500, 50 * 2 ** Math.min(attempt, 4)) * (0.5 + Math.random()),
                );
              }
              check(succeeded, "bounded retries exhausted");
            }
          })(),
        ),
      );
      for (const r of finished) if (r.status === "rejected") throw r.reason;
      assert(
        latency.length === total && Object.values(byRole).every((xs) => xs.length > 0),
        `measured-all-roles-${size}-${concurrency}`,
      );
      const summarize = (xs: number[]) => ({
          samples: xs.length,
          p50: percentile(xs, 0.5),
          p95: percentile(xs, 0.95),
          max: Math.max(...xs),
        }),
        r = {
          size,
          concurrency,
          measuredJourneys: latency.length,
          requests,
          retries,
          statuses,
          creates,
          links,
          dismisses,
          p50: percentile(latency, 0.5),
          p95: percentile(latency, 0.95),
          max: Math.max(...latency),
          stages: Object.fromEntries(Object.entries(stage).map(([k, v]) => [k, summarize(v)])),
          byRole: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, summarize(v)])),
        };
      results.push(r);
      console.info(JSON.stringify(r));
    }
    assert(offset === 160, `distinct-terminal-workflows-${size}`);
    const history = await db.db
      .collection("care_history")
      .find({ churchId, resourceKind: "alert", resourceId: new ObjectId(work[0]?.id) })
      .sort({ _id: -1 })
      .limit(26)
      .explain("executionStats");
    assert(
      history.executionStats.totalDocsExamined <= 26 &&
        JSON.stringify(history.queryPlanner.winningPlan).includes("care_history_page"),
      `indexed-history-${size}`,
    );
    plans.push({
      size,
      kind: "history",
      plan: history.queryPlanner.winningPlan,
      stats: history.executionStats,
    });
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
          "Local HTTPS/private CA/synthetic only; not SLA/capacity/RPO/RTO",
          "100/500/2000 source profiles plus corresponding extra stored-volume expired clones and160 fresh public source-linked work items per size",
          "480 distinct terminal five-stage journeys list+summary/detail/preview/confirm/history, mix create/link/dismiss and all3roles eachconfig",
          "Public source/signal setup and full paged evaluation outside measured latency; stored-volume clones are not source-linked public histories",
          "Counts aggregate matches;26-document bounds only measured alert/history pages",
          "Bounded32 reread/repreview/backoff attempts; no UI auto-accept; aggregate restore P4.6 remains unopened",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (server) await server.stop(true);
  if (db.db.databaseName === `church_cms_test_p45q_${run}`) await db.db.dropDatabase();
  const remaining = (await db.db.admin().listDatabases()).databases.some(
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
      listener: 3489,
      serverStopped: true,
    }),
  );
}
