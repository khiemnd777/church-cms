import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { localTls } from "./local-tls";
import {
  check,
  localOnly,
  SyntheticClient,
  seedP2,
  syntheticChurch,
  syntheticOwner,
} from "./p2-fixtures";
import { certificateFixture } from "./p35-fixtures";

const run = crypto.randomUUID().replaceAll("-", ""),
  base = config();
localOnly(base);
const privateDir = resolve(".local", `p3.5-${run}`),
  out = "output/p3.5";
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3470",
    port: 3470,
    database: `church_cms_test_p35q_${run}`,
    csrfKey: crypto.randomUUID() + crypto.randomUUID(),
    cert: tls.cert,
    key: tls.key,
  };
const db = new Database(conf),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let server: ReturnType<typeof Bun.serve> | undefined;
const results: object[] = [],
  plans: object[] = [],
  checks: string[] = [];
let contentionRetries = 0;
const assert = (v: unknown, label: string) => {
  check(v, label);
  checks.push(label);
};
const owner = new SyntheticClient("owner", conf.origin, (req) => fetch(req, { tls: { ca } }));
const percentile = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1] ?? 0;
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
    tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) },
    fetch: (req) => app(req, { ip: "p35-qualification" }),
  });
  const info = await syntheticOwner(db, owner);
  for (const size of [10, 25, 50]) {
    const church = await syntheticChurch(owner, `P35 workload synthetic ${size}`),
      churchId = new ObjectId(church.id);
    await seedP2(db, church.id, info.id, size);
    const member = await db.db.collection("members").findOne({ churchId });
    assert(member, "member present");
    if (!member) throw Error("Missing synthetic member");
    await db.db.collection("members").updateOne({ _id: member._id }, { $set: { birthDate: null } });
    const prefix = `owner/churches/${church.id}/certificates`,
      input = certificateFixture("application", null, member._id.toHexString());
    const timed: Record<string, number[]> = {};
    async function call(step: string, path: string, body?: object, options?: { version?: number }) {
      const start = performance.now(),
        intent = { ...options, key: crypto.randomUUID() };
      let response = await owner.call(path, body, intent);
      for (
        let retry = 0;
        response.status === 409 &&
        response.payload?.error?.code === "OPERATION_IN_PROGRESS" &&
        retry < 4;
        retry++
      ) {
        contentionRetries++;
        await Bun.sleep(25 * (retry + 1));
        response = await owner.call(path, body, intent);
      }
      if (timed[step]) timed[step].push(performance.now() - start);
      assert(
        response.status === (step === "draft" ? 201 : 200),
        `${step} status ${response.status} ${response.payload?.error?.code ?? ""}`,
      );
      return response.payload.data;
    }
    async function journey() {
      const list = await call("list", `${prefix}/editions`);
      assert(
        list.items.length <= 25 && !JSON.stringify(list).includes('"pdf"'),
        "bounded list without artifacts",
      );
      const made = await call("draft", `${prefix}/drafts`, { input, reason: null });
      const p = await call(
        "prepare",
        `${prefix}/drafts/${made.draftId}/prepare`,
        {},
        { version: 1 },
      );
      const e = await call(
        "issue",
        `${prefix}/drafts/${made.draftId}/issue`,
        { previewId: p.id, context: p.context, confirm: true, faithConfirmed: false, reason: null },
        { version: 1 },
      );
      const fileStart = performance.now();
      for (const format of ["pdf", "docx"] as const) {
        const response = await fetch(
          `${conf.origin}/api/v1/${prefix}/editions/${e.editionId}/files/${format}?version=1`,
          { headers: { cookie: owner.cookie() }, tls: { ca } },
        );
        assert(response.status === 200, `download-${format}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        assert(
          new Bun.CryptoHasher("sha256").update(bytes).digest("hex") === p[`${format}Hash`],
          "download matches prepared immutable artifact",
        );
      }
      if (timed.download) timed.download.push(performance.now() - fileStart);
      const history = await call("history", `${prefix}/drafts/${made.draftId}/history`);
      assert(
        history.items.some((h: { event: string }) => h.event === "issued"),
        "issue history present",
      );
    }
    // Populate through the public workflow with real rendered artifacts, outside measured samples.
    for (let i = 0; i < size; i++) await journey();
    for (const concurrency of [1, 2]) {
      await journey();
      for (const step of ["list", "draft", "prepare", "issue", "download", "history"])
        timed[step] = [];
      const started = performance.now();
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          for (let i = 0; i < 10; i++) await journey();
        }),
      );
      const elapsedMs = performance.now() - started;
      results.push({
        population: size,
        concurrency,
        journeys: concurrency * 10,
        elapsedMs,
        steps: Object.fromEntries(
          Object.entries(timed).map(([step, xs]) => [
            step,
            {
              count: xs.length,
              p50: percentile(xs, 0.5),
              p95: percentile(xs, 0.95),
              max: Math.max(...xs),
            },
          ]),
        ),
      });
      for (const key of Object.keys(timed)) delete timed[key];
      console.info(JSON.stringify({ population: size, concurrency, status: "PASS", elapsedMs }));
    }
    for (const [collection, filter, sort, index] of [
      [
        "certificate_editions",
        { churchId },
        { issuedAt: -1, _id: -1 },
        "certificate_editions_page",
      ],
      [
        "certificate_editions",
        { churchId, memberIds: member._id },
        { issuedAt: -1, _id: -1 },
        "certificate_member_page",
      ],
      ["certificate_drafts", { churchId }, { createdAt: -1, _id: -1 }, "certificate_drafts_page"],
    ] as const) {
      const plan = await db.db
        .collection(collection)
        .find(filter)
        .sort(sort)
        .limit(26)
        .explain("executionStats");
      const encoded = JSON.stringify(plan.queryPlanner.winningPlan);
      assert(encoded.includes(index) && !encoded.includes('"COLLSCAN"'), `${index} chosen`);
      plans.push({
        population: size,
        collection,
        winningPlan: plan.queryPlanner.winningPlan,
        stats: plan.executionStats,
      });
    }
  }
  await Bun.write(
    `${out}/workload.json`,
    JSON.stringify(
      {
        status: "PASS",
        protocol:
          "Private-CA HTTPS, real DOCX/PDF, 10/25/50 initial editions, concurrency 1/2; one warmup then 10 journeys/worker. Local single-process, no production SLA.",
        results,
        plans,
        contentionRetries,
        checks: checks.length,
      },
      null,
      2,
    ),
  );
} finally {
  await server?.stop(true);
  if (db.db.databaseName === conf.database) await db.db.dropDatabase();
  const removed = !(await db.client.db("admin").admin().listDatabases()).databases.some(
    (d) => d.name === conf.database,
  );
  await db.client.close();
  if (rate.client.isOpen) rate.client.destroy();
  await rm(privateDir, { recursive: true, force: true });
  await Bun.write(
    `${out}/workload-cleanup.json`,
    JSON.stringify({
      database: conf.database,
      removed,
      privateCaRemoved: !(await Bun.file(tls.key).exists()),
    }),
  );
}
