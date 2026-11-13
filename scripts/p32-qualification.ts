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
const privateDir = resolve(".local", `p3.2-${run}`),
  out = resolve("output/p3.2");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text();
const conf = {
  ...base,
  origin: "https://localhost:3465",
  port: 3465,
  database: `church_cms_test_p32q_${run}`,
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
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: conf.port,
    idleTimeout: 15,
    tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) },
    fetch: (req) => app(req, { ip: req.headers.get("x-synthetic-client") ?? "p32-qualification" }),
  });
  const owner = makeClient("owner"),
    info = await syntheticOwner(db, owner);
  let firstQr = "",
    firstChurch = "";
  for (const size of [100, 500, 2000]) {
    const c = await syntheticChurch(owner, `P32 qualification ${size}`),
      root = `owner/churches/${c.id}`;
    await seedP2(db, c.id, info.id, size);
    await db.db
      .collection("members")
      .updateMany({ churchId: new ObjectId(c.id) }, { $set: { participation: "active" } });
    const members = await db.db
        .collection("members")
        .find({ churchId: new ObjectId(c.id) })
        .sort({ _id: 1 })
        .limit(70)
        .toArray(),
      codes: string[] = [];
    for (const m of members) {
      const made = await owner.call(`${root}/members/${m._id}/cards`, {});
      assert(made.status === 201, `issue-${size}-${codes.length}`);
      const rendered = await owner.call(`${root}/cards/${made.payload.data.cardId}/render`);
      assert(rendered.status === 200, `render-${size}-${codes.length}`);
      codes.push(rendered.payload.data.payload);
    }
    firstQr = codes[0] ?? "";
    firstChurch = c.id;
    const users: SyntheticClient[] = [];
    for (let i = 0; i < 10; i++) {
      const u = makeClient("church");
      await syntheticUser(owner, u, c, "secretary");
      users.push(u);
    }
    for (const concurrency of [1, 5, 10]) {
      const made = await owner.call(`${root}/attendance/sessions`, {
        label: `QR ${size}/${concurrency}`,
        heldOn: businessDay(),
        location: null,
        scope: "church",
        unitId: null,
      });
      assert(made.status === 201, `session-${size}-${concurrency}`);
      const sid = made.payload.data.sessionId,
        ownerPath = `${root}/attendance/sessions/${sid}`,
        preview = await owner.call(`${ownerPath}/candidates`);
      assert(
        (
          await owner.call(
            `${ownerPath}/open`,
            { previewToken: preview.payload.data.previewToken },
            { version: 1 },
          )
        ).status === 200,
        `open-${size}-${concurrency}`,
      );
      async function intent(index: number, user: SyntheticClient) {
        const start = performance.now(),
          path = `churches/${c.id}/attendance/sessions/${sid}`,
          statuses: number[] = [];
        let resolution: Awaited<ReturnType<SyntheticClient["call"]>> | undefined;
        for (let attempt = 0; attempt < 6; attempt++) {
          resolution = await user.call(`${path}/qr-resolutions`, {
            code: codes[index],
            generation: 2,
          });
          statuses.push(resolution.status);
          if (resolution.status === 200) break;
          assert(
            resolution.status === 409,
            `bounded-read-contention-${size}-${concurrency}-${index}`,
          );
          await Bun.sleep(15 * (attempt + 1));
        }
        assert(resolution?.status === 200, `resolved-${size}-${concurrency}-${index}`);
        if (!resolution) throw new Error("Missing resolution response");
        const p = resolution.payload.data,
          key = crypto.randomUUID();
        let committed = false;
        for (let attempt = 0; attempt < 6; attempt++) {
          const r = await user.call(
            `${path}/scans`,
            { resolutionToken: p.resolutionToken, generation: 2 },
            { version: p.participant.version, key },
          );
          statuses.push(r.status);
          if (r.status === 200) {
            committed = true;
            break;
          }
          assert(r.status === 409, `bounded-commit-contention-${size}-${concurrency}-${index}`);
          await Bun.sleep(15 * (attempt + 1));
        }
        assert(committed, `committed-${size}-${concurrency}-${index}`);
        return { latencyMs: performance.now() - start, statuses };
      }
      for (let i = 0; i < 10; i++) await intent(i, users[0] as SyntheticClient);
      const measured: Awaited<ReturnType<typeof intent>>[] = [];
      for (let i = 10; i < 70; i += concurrency) {
        const group = await Promise.all(
          Array.from({ length: Math.min(concurrency, 70 - i) }, (_, j) =>
            intent(i + j, users[j] as SyntheticClient),
          ),
        );
        measured.push(...group);
      }
      const state = await owner.call(ownerPath);
      assert(
        state.status === 200 &&
          state.payload.data.presentCount === 70 &&
          state.payload.data.includedCount === size,
        `exact-count-${size}-${concurrency}`,
      );
      assert(
        (await db.db
          .collection("attendance_history")
          .countDocuments({ sessionId: new ObjectId(sid), event: "marked" })) === 70,
        `exact-history-${size}-${concurrency}`,
      );
      const times = measured.map((x) => x.latencyMs),
        statusCounts: Record<string, number> = {};
      for (const r of measured)
        for (const status of r.statuses) statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      results.push({
        size,
        concurrency,
        warmup: 10,
        measuredIntents: 60,
        completedIntents: 60,
        p50Ms: percentile(times, 0.5),
        p95Ms: percentile(times, 0.95),
        maxMs: Math.max(...times),
        httpAttempts: measured.reduce((n, r) => n + r.statuses.length, 0),
        statusCounts,
      });
      console.info(JSON.stringify(results.at(-1)));
    }
  }
  const plan = await db.db
    .collection("member_cards")
    .find({ churchId: new ObjectId(firstChurch), publicId: firstQr.slice(6), state: "active" })
    .explain("executionStats");
  assert(
    JSON.stringify(plan.queryPlanner.winningPlan).includes("card_public_unique"),
    "QR-index-selected",
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
        cardLookupPlan: plan,
        limits: [
          "HTTPS local/private CA/synthetic data",
          "Resolution plus commit latency including bounded same-intent commit retries",
          "Single API process/local Mongo replica set; no production SLA or multi-replica proof",
          "Physical camera and paper NOT_RUN",
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
