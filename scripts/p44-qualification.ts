import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { businessDay } from "../api/members/dates";
import type { Prayer } from "../api/prayers/models";
import { localTls } from "./local-tls";
import { check, localOnly, SyntheticClient, syntheticOwner, syntheticUser } from "./p2-fixtures";
import {
  p44Fixture,
  prayerCommon,
  prayerCreate,
  prayerEdit,
  prayerRoot,
  prayerSave,
} from "./p44-fixtures";

const base = config();
localOnly(base);
const run = crypto.randomUUID().replaceAll("-", ""),
  privateDir = resolve(".local", `p4.4-${run}`),
  out = resolve("output/p4.4");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3486",
    port: 3486,
    database: `church_cms_test_p44q_${run}`,
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
    fetch: (req) => app(req, { ip: req.headers.get("x-synthetic-client") ?? "p44q" }),
  });
  const owner = client("owner"),
    actor = await syntheticOwner(db, owner);
  for (const size of [100, 500, 2000]) {
    const c = await p44Fixture(db, owner, actor.id, size),
      churchId = new ObjectId(c.id),
      secretary = client("church"),
      pastor = client("church");
    await syntheticUser(owner, secretary, c, "secretary");
    await syntheticUser(owner, pastor, c, "pastor");
    const actors = [owner, secretary, pastor],
      roles = ["owner", "secretary", "pastor"],
      seed = await prayerSave(owner, c, prayerCreate("shared"));
    assert(seed.status === 201, `public-shared-seed-${size}`);
    const raw = await db.db
      .collection<Prayer>("prayer_requests")
      .findOne({ _id: new ObjectId(seed.payload.data.prayerId) });
    check(raw, "public seed");
    // Stored-volume fixtures have no public-command history; source-linked/UI workflows are checked separately.
    await db.db.collection<Prayer>("prayer_requests").insertMany(
      Array.from({ length: size - 1 }, (_, i) => ({
        ...raw,
        _id: new ObjectId(),
        code: `CT-VOLUME-${size}-${i}`,
        visibility: i % 2 ? ("shared" as const) : ("pastoral" as const),
        content: `Volume synthetic ${i}`,
        contentKey: `volume synthetic ${i}`,
      })),
    );
    for (const audience of ["shared", "all"]) {
      const plan = await db.db
        .collection("prayer_requests")
        .find({
          churchId,
          ...(audience === "shared" ? { visibility: "shared" } : {}),
          state: { $in: ["open", "shared"] },
        })
        .sort({ _id: -1 })
        .limit(26)
        .explain("executionStats");
      const selected = JSON.stringify(plan.queryPlanner.winningPlan),
        allowedIndexes =
          audience === "shared"
            ? ["prayer_visible_page", "prayer_visible_state_page"]
            : ["prayer_page", "prayer_state_page"];
      assert(
        plan.executionStats.nReturned === 26 &&
          plan.executionStats.totalDocsExamined <= 26 &&
          !selected.includes('"stage":"COLLSCAN"') &&
          allowedIndexes.some((name) => selected.includes(`"indexName":"${name}"`)),
        `indexed-${audience}-page-${size}`,
      );
      plans.push({
        size,
        kind: `${audience}-list`,
        plan: plan.queryPlanner.winningPlan,
        stats: plan.executionStats,
      });
    }
    const countPlan = await db.db
      .collection("prayer_requests")
      .aggregate([
        { $match: { churchId, visibility: "shared", state: { $in: ["open", "shared"] } } },
        { $count: "active" },
      ])
      .explain("executionStats");
    assert(
      JSON.stringify(countPlan).includes("IXSCAN") ||
        JSON.stringify(countPlan).includes("COUNT_SCAN"),
      `indexed-shared-count-${size}`,
    );
    plans.push({ size, kind: "shared-active-count", plan: countPlan });
    const workers: { id: string; role: number }[][] = [];
    for (let worker = 0; worker < 10; worker++) {
      const entries = [];
      for (let role = 0; role < 3; role++) {
        const s = actors[role];
        check(s, "role");
        const r = await prayerSave(
          s,
          c,
          prayerCreate(role === 2 ? "pastoral" : "shared", {
            content: `Worker synthetic ${worker}/${role}`,
          }),
        );
        assert(r.status === 201, `public-worker-${size}-${worker}-${role}`);
        entries.push({ id: r.payload.data.prayerId, role });
      }
      workers.push(entries);
    }
    for (const concurrency of [1, 5, 10]) {
      const latency: number[] = [],
        stages: Record<string, number[]> = {
          list: [],
          read: [],
          preview: [],
          commit: [],
          history: [],
        },
        byRole: Record<string, number[]> = { owner: [], secretary: [], pastor: [] },
        statuses: Record<string, number> = {};
      let requests = 0,
        retries = 0;
      const call = async (
        s: SyntheticClient,
        stage: string,
        path: string,
        body?: object,
        version?: number,
      ) => {
        const start = performance.now(),
          r = await s.call(path, body, {
            method: body ? (path.endsWith("/preview") ? "POST" : "PATCH") : "GET",
            version,
          });
        (stages[stage] as number[]).push(performance.now() - start);
        requests++;
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        return r;
      };
      const iterations = concurrency === 1 ? 20 : concurrency === 5 ? 12 : 8;
      const finished = await Promise.allSettled(
        Array.from({ length: concurrency }, (_, worker) =>
          (async () => {
            for (let i = 0; i < iterations; i++) {
              const role = (worker + i) % 3,
                s = actors[role],
                target = workers[worker]?.[role],
                label = roles[role];
              check(s && target && label, "worker context");
              const root = prayerRoot(c, s),
                start = performance.now();
              const list = await call(s, "list", `${root}?limit=25`);
              check(
                list.status === 200 &&
                  list.payload.data.items.length <= 25 &&
                  list.payload.data.summary.total >= Math.floor(size / 2),
                "bounded authorized list/count",
              );
              if (role !== 2)
                check(
                  list.payload.data.items.every(
                    (p: { visibility: string }) => p.visibility === "shared",
                  ) && !Object.hasOwn(list.payload.data, "privateCount"),
                  "no private metadata in low-privilege list",
                );
              let succeeded = false;
              for (let attempt = 0; attempt < 32; attempt++) {
                const path = `${root}/${target.id}`,
                  d = await call(s, "read", path);
                check(d.status === 200, "detail read");
                const b = prayerEdit(
                    d.payload.data,
                    { content: `Measured synthetic ${worker}/${role}/${i}` },
                    "correct",
                  ),
                  p = await call(s, "preview", `${path}/preview`, b, d.payload.data.version);
                check(p.status === 200, `preview ${p.status}`);
                const r = await call(
                  s,
                  "commit",
                  path,
                  { ...b, preview: p.payload.data.context, confirmed: true },
                  d.payload.data.version,
                );
                if (r.status === 200) {
                  const h = await call(s, "history", `${path}/history?limit=25`);
                  check(
                    h.status === 200 &&
                      h.payload.data.items.length > 0 &&
                      h.payload.data.items.length <= 25,
                    "bounded history",
                  );
                  const elapsed = performance.now() - start;
                  latency.push(elapsed);
                  (byRole[label] as number[]).push(elapsed);
                  succeeded = true;
                  break;
                }
                check([409, 412].includes(r.status), `unexpected commit ${r.status}`);
                retries++;
                await Bun.sleep(
                  Math.min(500, 50 * 2 ** Math.min(attempt, 4)) * (0.5 + Math.random()),
                );
              }
              check(succeeded, "bounded contention retry exhausted");
            }
          })(),
        ),
      );
      for (const r of finished) if (r.status === "rejected") throw r.reason;
      assert(
        latency.length === iterations * concurrency &&
          Object.values(byRole).every((rows) => rows.length > 0),
        `measured-all-roles-${size}-${concurrency}`,
      );
      const summarize = (xs: number[]) => ({
        samples: xs.length,
        p50: percentile(xs, 0.5),
        p95: percentile(xs, 0.95),
        max: Math.max(...xs),
      });
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
        stages: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, summarize(v)])),
        byRole: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, summarize(v)])),
      };
      results.push(result);
      console.info(JSON.stringify(result));
    }
    for (let role = 0; role < 3; role++) {
      const s = actors[role],
        target = workers[0]?.[role];
      check(s && target, "close sample");
      const root = prayerRoot(c, s);
      let d = (await s.call(`${root}/${target.id}`)).payload.data;
      if (role !== 2) {
        const shared = await prayerSave(
          s,
          c,
          {
            action: "share",
            ...prayerCommon,
            reason: "Chia sẻ synthetic",
            sharedOn: businessDay(),
          },
          target.id,
          d.version,
        );
        assert(shared.status === 200, `public-share-${size}-${role}`);
        d = (await s.call(`${root}/${target.id}`)).payload.data;
      }
      assert(
        (
          await prayerSave(
            s,
            c,
            { action: "close", ...prayerCommon, reason: "Kết thúc synthetic" },
            target.id,
            d.version,
          )
        ).status === 200,
        `public-close-${size}-${role}`,
      );
    }
    const cancelled = workers[1]?.[0];
    check(cancelled, "cancel sample");
    const d = (await owner.call(`${prayerRoot(c, owner)}/${cancelled.id}`)).payload.data;
    assert(
      (
        await prayerSave(
          owner,
          c,
          { action: "cancel", ...prayerCommon, reason: "Hủy synthetic" },
          d.id,
          d.version,
        )
      ).status === 200,
      `public-cancel-${size}`,
    );
    const sample = workers[0]?.[0];
    check(sample, "history sample");
    const plan = await db.db
      .collection("prayer_history")
      .find({ churchId, prayerId: new ObjectId(sample.id) })
      .sort({ _id: -1 })
      .limit(26)
      .explain("executionStats");
    assert(
      plan.executionStats.totalDocsExamined <= 26 &&
        JSON.stringify(plan.queryPlanner.winningPlan).includes("prayer_history_page"),
      `indexed-history-${size}`,
    );
    plans.push({
      size,
      kind: "history",
      plan: plan.queryPlanner.winningPlan,
      stats: plan.executionStats,
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
          "Local synthetic HTTPS/private CA; no production SLA/capacity/RPO/RTO",
          "480 five-stage journeys mix owner/secretary/pastor in every config, bounded32 explicit reread/repreview attempts",
          "Stored-volume fixtures separate from public workflows;9closes/6shares/3cancellations outside latency",
          "Count plans aggregate visible matches, not bounded26docs; only measured list/history pages claim that bound",
          "P4 aggregate restore remains unopened P4.6",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (server) await server.stop(true);
  if (db.db.databaseName === `church_cms_test_p44q_${run}`) await db.db.dropDatabase();
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
      listener: 3486,
      serverStopped: true,
    }),
  );
}
