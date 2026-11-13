import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { businessDay } from "../api/members/dates";
import type { RiteRecord } from "../api/rites/models";
import type { RiteCommand } from "../api/rites/validation";
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
const privateDir = resolve(".local", `p3.4-${run}`),
  out = resolve("output/p3.4");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3468",
    port: 3468,
    database: `church_cms_test_p34q_${run}`,
    csrfKey: crypto.randomUUID() + crypto.randomUUID(),
    cert: tls.cert,
    key: tls.key,
  };
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let server: ReturnType<typeof Bun.serve> | undefined;
const results: object[] = [],
  checks: string[] = [],
  plans: object[] = [];
const assert = (v: unknown, label: string) => {
  check(v, label);
  checks.push(label);
};
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
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: conf.port,
    idleTimeout: 15,
    tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) },
    fetch: (req) => app(req, { ip: req.headers.get("x-synthetic-client") ?? "p34q" }),
  });
  const owner = makeClient("owner"),
    info = await syntheticOwner(db, owner);
  for (const size of [100, 500, 2000]) {
    const c = await syntheticChurch(owner, `P34 qualification ${size}`),
      churchId = new ObjectId(c.id);
    await seedP2(db, c.id, info.id, size);
    if (!/^church_cms_test_p34q_/.test(db.db.databaseName))
      throw Error("Disposable synthetic database only");
    const now = new Date(),
      docs: RiteRecord[] = Array.from({ length: size }, () => ({
        _id: new ObjectId(),
        churchId,
        kind: "communion",
        input: {
          payload: { kind: "communion", officiant: null, place: null, count: 0 },
          date: businessDay(),
          historical: false,
          note: null,
        },
        people: [],
        memberIds: [],
        subjectMemberId: null,
        searchTokens: [],
        state: "recorded",
        version: 1,
        recordedAt: now,
        createdAt: now,
        updatedAt: now,
      }));
    await db.db.collection<RiteRecord>("rite_records").insertMany(docs);
    const explain = await db.db
      .collection("rite_records")
      .find({ churchId, kind: "communion" })
      .sort({ "input.date": -1, _id: -1 })
      .limit(26)
      .explain("executionStats");
    assert(
      JSON.stringify(explain.queryPlanner.winningPlan).includes("rites_page"),
      `indexed-list-${size}`,
    );
    assert(explain.executionStats.totalDocsExamined <= 26, `bounded-list-examined-${size}`);
    plans.push({
      size,
      winningPlan: explain.queryPlanner.winningPlan,
      docsExamined: explain.executionStats.totalDocsExamined,
      returned: explain.executionStats.nReturned,
    });
    const users: SyntheticClient[] = [];
    for (let i = 0; i < 10; i++) {
      const u = makeClient("church");
      await syntheticUser(owner, u, c);
      users.push(u);
    }
    const root = `churches/${c.id}/rites`;
    for (const concurrency of [1, 5, 10]) {
      async function intent(index: number, worker: number) {
        const user = users[worker];
        const doc = docs[worker];
        if (!user || !doc) throw Error("Missing fixture");
        const path = `${root}/records/${doc._id}`,
          statuses: number[] = [],
          start = performance.now();
        const read = async (path: string, body?: object, v?: number) => {
          for (let n = 0; n < 8; n++) {
            const r = await user?.call(path, body, { version: v });
            if (!r) throw Error();
            statuses.push(r.status);
            if (r.status === 200) return r;
            assert(r.status === 409, `bounded-read-conflict-${size}-${concurrency}-${index}`);
            await Bun.sleep((n + 1) * 10);
          }
          throw Error("Read retry exhausted");
        };
        const list = await read(`${root}/records?kind=communion&limit=25`);
        assert(
          list.payload.data.items.length === 25,
          `list-bounded-${size}-${concurrency}-${index}`,
        );
        const current = (await read(path)).payload.data,
          label = `intent-${size}-${concurrency}-${index}`,
          body: RiteCommand = {
            record: { ...current.record, note: label },
            state: "recorded",
            reason: "Qualification synthetic",
            baptismAfter: null,
            preview: null,
          };
        const preview = await read(`${path}/preview`, body, current.version),
          submitted = { ...body, preview: preview.payload.data.context },
          key = crypto.randomUUID();
        let complete = false;
        for (let n = 0; n < 12; n++) {
          const r = await user.call(path, submitted, {
            method: "PATCH",
            version: current.version,
            key,
          });
          statuses.push(r.status);
          if (r.status === 200) {
            complete = true;
            break;
          }
          assert(r.status === 409, `bounded-write-conflict-${size}-${concurrency}-${index}`);
          await Bun.sleep((n + 1) * 10);
        }
        assert(complete, `commit-${size}-${concurrency}-${index}`);
        const history = await read(`${path}/history?limit=1`);
        assert(
          history.payload.data.items[0].after.record.note === label,
          `history-exact-intent-${size}-${concurrency}-${index}`,
        );
        return { latencyMs: performance.now() - start, statuses };
      }
      for (let i = 0; i < 10; i++) await intent(i, 0);
      const measured: Awaited<ReturnType<typeof intent>>[] = [];
      for (let i = 10; i < 70; i += concurrency)
        measured.push(
          ...(await Promise.all(
            Array.from({ length: Math.min(concurrency, 70 - i) }, (_, j) => intent(i + j, j)),
          )),
        );
      const times = measured.map((x) => x.latencyMs),
        statusCounts: Record<string, number> = {};
      for (const r of measured)
        for (const code of r.statuses) statusCounts[code] = (statusCounts[code] ?? 0) + 1;
      results.push({
        size,
        concurrency,
        warmup: 10,
        measuredIntents: 60,
        completedIntents: measured.length,
        p50Ms: percentile(times, 0.5),
        p95Ms: percentile(times, 0.95),
        maxMs: Math.max(...times),
        statusCounts,
      });
      console.info(
        JSON.stringify({
          size,
          concurrency,
          completed: measured.length,
          p95: percentile(times, 0.95),
        }),
      );
    }
    assert(
      (await db.db.collection("rite_history").countDocuments({ churchId })) === 210,
      `exact-history-${size}`,
    );
  }
  await Bun.write(
    `${out}/qualification.json`,
    JSON.stringify(
      {
        status: "PASS",
        results,
        checks,
        plans,
        limits: [
          "Local synthetic/private CA; single API process",
          "Large list fixture direct setup; API creation verified separately",
          "Measured intent = bounded list + record read + preview + commit + latest history read; original-intent bounded retries included",
          "No production SLA, physical camera/paper/Safari/remote CI/multi-replica or real data",
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
