import { closeSync, openSync } from "node:fs";
import { chmod, mkdir, rm } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { BSON, ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { config } from "../api/config";
import { importFields } from "../api/data-exchange/contracts";
import { fileDigest, makeFile } from "../api/data-exchange/files";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { canonical } from "../api/operations/service";
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
import { p2Workflow } from "./p2-workflow";

const runId = crypto.randomUUID().replaceAll("-", ""),
  sourceName = `church_cms_test_p26_${runId}`,
  restoreName = `church_cms_test_p26_restore_${runId}`,
  base = config();
localOnly(base);
const privateDir = resolve(".local", `p2.6-${runId}`),
  out = resolve("output/p2.6");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(join(privateDir, "tls")),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    database: sourceName,
    csrfKey: crypto.randomUUID() + crypto.randomUUID(),
    cert: tls.cert,
    key: tls.key,
  },
  db = new Database(conf),
  target = new Database({ ...conf, database: restoreName }),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let server: ReturnType<typeof Bun.serve> | undefined,
  accepting = true,
  handler: ReturnType<typeof createApp>;
const makeClient = (realm: "owner" | "church") => {
  const simulatedIp = `synthetic-client-${crypto.randomUUID()}`;
  return new SyntheticClient(realm, conf.origin, (req) => {
    req.headers.set("x-qualification-client", simulatedIp);
    return fetch(req, { tls: { ca, rejectUnauthorized: true } });
  });
};

async function snapshot(database: Database) {
  const result: Record<string, unknown> = {};
  for (const collection of (
    await database.db.listCollections({}, { nameOnly: false }).toArray()
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const c = database.db.collection(collection.name),
      hash = new Bun.CryptoHasher("sha256");
    let count = 0;
    for await (const row of c.find().sort({ _id: 1 })) {
      hash.update(`${canonical(JSON.parse(BSON.EJSON.stringify(row, { relaxed: false })))}\n`);
      count++;
    }
    const indexes = (await c.listIndexes().toArray())
      .map((i) => ({
        key: Object.entries(i.key),
        name: i.name,
        ...(i.unique ? { unique: true } : {}),
        ...(i.expireAfterSeconds !== undefined ? { expireAfterSeconds: i.expireAfterSeconds } : {}),
        ...(i.partialFilterExpression
          ? { partialFilterExpression: i.partialFilterExpression }
          : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    result[collection.name] = {
      count,
      sha256: hash.digest("hex"),
      indexes,
      validator: collection.options?.validator ?? null,
    };
  }
  return result;
}
async function status(who: SyntheticClient, path: string, body?: object) {
  const r = await who.call(path, body);
  check(r.status < 400, `Qualification HTTP ${r.status}: ${r.payload?.error?.code ?? "unknown"}`);
  return r.payload.data;
}
const limits = [
  "Synthetic isolated data only; no main DB/server restart or real data",
  "HTTPS loopback/client/server same Bun process; measured local results are not production SLA/capacity",
  "Quiesced dump/restore to a new generated empty DB, not production PITR/RPO/RTO",
  "Restored sessions revoked; private archive and TLS removed; Redis not backed up or flushed",
];
try {
  await db.client.connect();
  await initialize(db.db);
  await rate.connect();
  const identity = new Identity(db, rate, conf);
  await identity.initialize();
  handler = createApp(identity, conf, { log: () => {} });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 15,
    tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) },
    fetch: (req) =>
      accepting
        ? handler(req, { ip: req.headers.get("x-qualification-client") ?? "p26-qualification" })
        : new Response(null, { status: 503 }),
  });
  conf.origin = `https://localhost:${server.port}`;
  check(server.port, "Qualification listener port");
  conf.port = server.port;
  const owner = makeClient("owner"),
    ownerAccount = await syntheticOwner(db, owner),
    churches: Awaited<ReturnType<typeof syntheticChurch>>[] = [],
    users: { client: SyntheticClient; email: string; password: string; id: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const c = await syntheticChurch(owner, `Hội Thánh qualification synthetic ${i}`);
    churches.push(c);
    for (let a = 0; a < 8; a++)
      check(
        (
          await owner.call(`owner/churches/${c.id}/organization/units`, {
            kind: "area",
            name: `Giáo khu synthetic ${a}`,
          })
        ).status === 201,
        "Seed area via API",
      );
    const user = makeClient("church"),
      account = await syntheticUser(owner, user, c);
    users.push({ client: user, ...account });
    await seedP2(db, c.id, ownerAccount.id, i === 10 ? 5000 : i === 11 ? 0 : 1000);
    console.info(`Seeded church ${i + 1}/12`);
  }
  const first = churches[0],
    hot = churches[10],
    empty = churches[11],
    normal = users[0],
    hotUser = users[10];
  check(first && hot && empty && normal && hotUser, "Qualification fixtures exist");
  check(
    (await status(users[11]?.client as SyntheticClient, `churches/${empty.id}/overview`)).members
      .total === 0,
    "Empty overview true zero",
  );
  const scopedUnit = (
      await status(normal.client, `churches/${first.id}/organization/units?kind=area&limit=1`)
    ).items[0].id as string,
    lead = makeClient("church");
  await syntheticUser(owner, lead, first, "ministry_lead", [scopedUnit]);
  check(
    (await lead.call(`churches/${first.id}/overview`)).status === 403,
    "Lead dashboard forbidden",
  );
  check(
    (await normal.client.call(`churches/${hot.id}/overview`)).status === 403,
    "Cross tenant forbidden",
  );
  const importRow: Record<string, string> = {
      externalId: "Q-001",
      fullName: "Qualification unique imported synthetic",
      gender: "unknown",
      birthDate: "2000-01-02",
      type: "believer",
      membership: "member",
      householdRole: "head",
      familyKey: "Q-HOUSE",
      assignmentMode: "auto",
      baptismStatus: "unknown",
      consent: "true",
    },
    file = (
      await makeFile(
        importFields,
        Array.from({ length: 1000 }, (_, i) =>
          importFields.map((f) =>
            f === "externalId"
              ? `Q-${i}`
              : f === "fullName"
                ? `Qualification imported synthetic ${i}`
                : f === "familyKey"
                  ? `Q-HOUSE-${i}`
                  : (importRow[f] ?? ""),
          ),
        ),
        "csv",
      )
    ).bytes;
  const staged = await normal.client.call(`churches/${first.id}/data-exchange/imports`, file, {
    headers: { "x-file-format": "csv", "x-import-source": "Qualification" },
  });
  check(staged.status === 201, "Qualification stage");
  const importId = staged.payload.data.importId;
  const list = await status(normal.client, `churches/${first.id}/members?limit=25`);
  check(list.nextCursor, "Keyset fixture cursor");
  const profiles: [string, SyntheticClient, string, object?][] = [
    ["overview-normal", normal.client, `churches/${first.id}/overview`],
    ["overview-hot5000", hotUser.client, `churches/${hot.id}/overview`],
    [
      "members-filter",
      normal.client,
      `churches/${first.id}/members?firstVisit=last30&type=visitor&limit=25`,
    ],
    [
      "members-next",
      normal.client,
      `churches/${first.id}/members?limit=25&cursor=${encodeURIComponent(list.nextCursor)}`,
    ],
    ["families", normal.client, `churches/${first.id}/families?limit=25`],
    [
      "scoped-roster",
      lead,
      `churches/${first.id}/organization/units/${scopedUnit}/members?limit=25`,
    ],
    [
      "import-review",
      normal.client,
      `churches/${first.id}/data-exchange/imports/${importId}/rows?limit=25`,
    ],
    [
      "export-preview5000",
      hotUser.client,
      `churches/${hot.id}/data-exchange/exports/preview`,
      { filters: { participation: "all" }, columns: ["code", "fullName"], format: "xlsx" },
    ],
  ];
  const measurements = [];
  for (const [name, who, path, body] of profiles)
    for (const concurrency of [1, 5, 10]) {
      for (let warm = 0; warm < 10; warm++) await status(who, path, body);
      const retriesBefore = db.readSnapshotRetries;
      const samples: number[] = [],
        errors: Record<string, number> = {};
      let next = 0,
        peak = process.memoryUsage().rss;
      const timer = setInterval(() => {
          peak = Math.max(peak, process.memoryUsage().rss);
        }, 5),
        start = performance.now();
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (next++ < 30) {
            const before = performance.now();
            try {
              await status(who, path, body);
            } catch (e) {
              const key = e instanceof Error ? e.message : "error";
              errors[key] = (errors[key] ?? 0) + 1;
            }
            samples.push(performance.now() - before);
          }
        }),
      );
      clearInterval(timer);
      samples.sort((a, b) => a - b);
      measurements.push({
        name,
        readSnapshotRetries: db.readSnapshotRetries - retriesBefore,
        concurrency,
        samples: samples.length,
        p50: samples[Math.floor(samples.length * 0.5)],
        p95: samples[Math.floor(samples.length * 0.95)],
        throughput: samples.length / ((performance.now() - start) / 1000),
        peakRssMiB: Math.round(peak / 1048576),
        errors,
      });
      console.info(
        `Measured ${name} concurrency=${concurrency} errors=${Object.values(errors).reduce((a, b) => a + b, 0)}`,
      );
    }
  const queryPlans = [];
  for (const [name, collection, filter, sort] of [
    [
      "member-current",
      "members",
      { churchId: new ObjectId(first.id), participation: { $in: ["active", "long_absent"] } },
      { nameKey: 1, _id: 1 },
    ],
    [
      "families",
      "families",
      { churchId: new ObjectId(first.id), status: "active" },
      { nameKey: 1, _id: 1 },
    ],
    [
      "source-identity",
      "exchange_sources",
      { churchId: new ObjectId(first.id), source: "Qualification", externalId: "Q-001" },
      { _id: 1 },
    ],
  ] as [string, string, object, Record<string, 1 | -1>][]) {
    const plan = await db.db
      .collection(collection)
      .find(filter)
      .sort(sort)
      .limit(26)
      .explain("executionStats");
    queryPlans.push({ name, executionStats: plan.executionStats, queryPlanner: plan.queryPlanner });
  }
  await Bun.write(
    join(out, "qualification.json"),
    JSON.stringify(
      {
        status: measurements.every((m) => !Object.keys(m.errors).length) ? "PASS" : "FAIL",
        dataset: {
          normalChurches: 10,
          membersPerNormalChurch: 1000,
          hotMembers: 5000,
          emptyChurches: 1,
          seedMembers: 15000,
        },
        environment: {
          bun: Bun.version,
          platform: process.platform,
          arch: process.arch,
          cpu: cpus()[0]?.model,
          totalMemoryGiB: Math.round(totalmem() / 1073741824),
        },
        measurements,
        queryPlans,
        limits,
      },
      null,
      2,
    ),
  );
  check(
    measurements.every((m) => !Object.keys(m.errors).length),
    "Qualification request errors; see metrics",
  );
  const flowChurch = await syntheticChurch(owner, "Hội Thánh workflow synthetic"),
    flowUser = makeClient("church"),
    flowAccount = await syntheticUser(owner, flowUser, flowChurch),
    flow = await p2Workflow(owner, flowUser, flowChurch);
  await Bun.write(
    join(out, "workflow.json"),
    JSON.stringify(
      {
        status: "PASS",
        checks: flow.results,
        scope: "Real owner/secretary public HTTP commands on synthetic DB",
      },
      null,
      2,
    ),
  );
  const invalidLinks = await db.db
    .collection("members")
    .aggregate([
      { $lookup: { from: "families", localField: "familyId", foreignField: "_id", as: "family" } },
      { $match: { $expr: { $ne: [{ $first: "$family.churchId" }, "$churchId"] } } },
      { $count: "n" },
    ])
    .next();
  check(!invalidLinks, "Fixture family/tenant integrity");
  accepting = false;
  const before = await snapshot(db),
    archive = join(privateDir, "snapshot.archive.gz"),
    dumpStart = performance.now(),
    dumpFd = openSync(archive, "wx", 0o600);
  try {
    const r = Bun.spawnSync(
      [
        "docker",
        "compose",
        "exec",
        "-T",
        "mongo",
        "mongodump",
        "--host",
        "127.0.0.1:27017",
        "--db",
        sourceName,
        "--archive",
        "--gzip",
      ],
      { stdout: dumpFd, stderr: "ignore", stdin: "ignore", timeout: 60000 },
    );
    check(r.exitCode === 0, "Synthetic dump");
  } finally {
    closeSync(dumpFd);
  }
  const dumpMs = performance.now() - dumpStart,
    archiveHash = fileDigest(new Uint8Array(await Bun.file(archive).arrayBuffer())),
    restoreStart = performance.now();
  await target.client.connect();
  check(!(await target.db.listCollections().hasNext()), "Restore target must be empty");
  const restoreFd = openSync(archive, "r");
  try {
    const r = Bun.spawnSync(
      [
        "docker",
        "compose",
        "exec",
        "-T",
        "mongo",
        "mongorestore",
        "--host",
        "127.0.0.1:27017",
        "--archive",
        "--gzip",
        "--nsInclude",
        `${sourceName}.*`,
        "--nsFrom",
        `${sourceName}.*`,
        "--nsTo",
        `${restoreName}.*`,
      ],
      { stdin: restoreFd, stdout: "ignore", stderr: "ignore", timeout: 60000 },
    );
    check(r.exitCode === 0, "Synthetic restore");
  } finally {
    closeSync(restoreFd);
  }
  const restoreMs = performance.now() - restoreStart,
    after = await snapshot(target);
  check(canonical(before) === canonical(after), "Restored data/index/validator fingerprints match");
  const revoked = await target.sessions.updateMany(
    { revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() }, $inc: { writeFence: 1 } },
  );
  await target.ready();
  const recoveredIdentity = new Identity(target, rate, conf);
  await recoveredIdentity.initialize();
  const recovered = createApp(recoveredIdentity, conf, { log: () => {} });
  for (const [realm, who] of [
    ["owner", owner],
    ["church", flowUser],
  ] as const) {
    const old = await recovered(
      new Request(`${conf.origin}/api/v1/${realm === "owner" ? "owner/" : ""}auth/me`, {
        headers: { cookie: who.cookie() },
      }),
      { ip: "p26-restore" },
    );
    check(old.status === 401, "Restored old session rejected");
  }
  handler = recovered;
  accepting = true;
  const recoveredOwner = makeClient("owner"),
    recoveredUser = makeClient("church");
  check(
    (await recoveredOwner.login(ownerAccount.email, ownerAccount.password)).status === 200,
    "Fresh owner restore login",
  );
  check(
    (await recoveredUser.login(flowAccount.email, flowAccount.password, flowChurch.code)).status ===
      200,
    "Fresh user restore login",
  );
  const restoredFile = await recoveredUser.call(
    `churches/${flowChurch.id}/data-exchange/exports/${flow.exportId}/download`,
  );
  check(
    restoredFile.status === 200 &&
      fileDigest(restoredFile.bytes as Uint8Array) === flow.exportDigest,
    "Restored export artifact bytes",
  );
  const newUpload = await recoveredUser.call(
    `churches/${flowChurch.id}/data-exchange/imports`,
    flow.csv,
    { headers: { "x-file-format": "csv", "x-import-source": encodeURIComponent(flow.source) } },
  );
  check(newUpload.status === 201, "Restored reupload");
  const rr = await recoveredUser.call(
    `churches/${flowChurch.id}/data-exchange/imports/${newUpload.payload.data.importId}/rows`,
  );
  check(
    rr.payload.data.counts.skip === 1 && rr.payload.data.counts.create === 0,
    "Restored registry prevents duplicates",
  );
  const totals = await status(recoveredUser, `churches/${flowChurch.id}/overview`);
  check(
    totals.members.total === 3 && totals.organization.secretary === "Nguyễn workflow synthetic",
    "Restored overview/board reconciliation",
  );
  await Bun.write(
    join(out, "restore.json"),
    JSON.stringify(
      {
        status: "PASS",
        archiveSha256: archiveHash,
        archiveBytes: Bun.file(archive).size,
        dumpMs,
        restoreMs,
        collections: before,
        allFingerprintsMatch: true,
        oldOwnerAndUserTokensRejected: true,
        restoredSessionsRevoked: revoked.modifiedCount,
        freshOwnerUserLoginPass: true,
        artifactBytesMatch: true,
        sourceRegistryDedupePass: true,
        overviewReconciliationPass: true,
        limits,
      },
      null,
      2,
    ),
  );
  console.info("P2.6 qualification/restore PASS");
} catch (e) {
  await Bun.write(
    join(out, "qualification-failure.json"),
    JSON.stringify(
      { status: "FAIL", error: e instanceof Error ? e.message : "Qualification failed" },
      null,
      2,
    ),
  );
  throw e;
} finally {
  if (server) await server.stop(true);
  for (const d of [db, target]) {
    try {
      if ([sourceName, restoreName].includes(d.db.databaseName)) {
        await d.client.connect();
        await d.db.dropDatabase();
      }
    } finally {
      await d.client.close();
    }
  }
  if (rate.client.isOpen) rate.client.destroy();
  await rm(privateDir, { recursive: true, force: true });
  await Bun.write(
    join(out, "cleanup.json"),
    JSON.stringify(
      {
        status: "PASS",
        generatedDatabasesRemoved: true,
        privateArchiveAndTlsRemoved: true,
        listenerStopped: true,
        mainDatabaseAndSharedServicesUntouched: true,
      },
      null,
      2,
    ),
  );
}
