import { closeSync, openSync } from "node:fs";
import { chmod, mkdir, rm } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { BSON, ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { type Config, config } from "../api/config";
import { hashPassword } from "../api/identity/crypto";
import type { AuditEvent, Credential } from "../api/identity/models";
import { OwnerOperations } from "../api/identity/owner-operations";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { canonical } from "../api/operations/service";
import { localTls } from "./local-tls";

const { EJSON } = BSON;
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Invalid qualification fixture");
  return value;
}
// Generates its own DB names; never accepts a caller-selected database or restore target.
const runId = crypto.randomUUID().replaceAll("-", ""),
  sourceName = `church_cms_test_p14_${runId}`,
  restoreName = `church_cms_test_p14_restore_${runId}`;
const base = config();
for (const url of [base.mongoUrl, base.redisUrl])
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Local dependencies only");
const privateDir = resolve(".local", `p1.4-${runId}`),
  out = resolve("output/p1.4");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(join(privateDir, "tls")),
  ca = await Bun.file(tls.ca).text();
const conf: Config = {
  ...base,
  database: sourceName,
  csrfKey: crypto.randomUUID() + crypto.randomUUID(),
  cert: tls.cert,
  key: tls.key,
};
const db = new Database(conf),
  restored = new Database({ ...conf, database: restoreName }),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let server: ReturnType<typeof Bun.serve> | undefined;
let accepting = true;
let handler: ReturnType<typeof createApp>;
const jar = new Map<string, string>();
let csrf = "";
async function call(path: string, body?: object, realm: "owner" | "church" = "owner") {
  const response = await fetch(`${conf.origin}/api/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join(";"),
      ...(body
        ? { "content-type": "application/json", origin: conf.origin, "x-csrf-token": csrf }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    tls: { ca, rejectUnauthorized: true },
  });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0] as string,
      i = pair.indexOf("=");
    if (pair.slice(i + 1)) jar.set(pair.slice(0, i), pair.slice(i + 1));
    else jar.delete(pair.slice(0, i));
  }
  const payload = response.status === 204 ? null : await response.json();
  if (payload?.data?.csrfToken) csrf = payload.data.csrfToken;
  if (response.status >= 400)
    throw new Error(
      `HTTP ${response.status} ${payload?.error?.code ?? "unknown"} in ${realm} qualification`,
    );
  return payload?.data;
}
async function login(
  email: string,
  password: string,
  realm: "owner" | "church" = "owner",
  churchCode?: string,
) {
  await call(`auth/csrf?realm=${realm}`);
  return call(
    `${realm === "owner" ? "owner/" : ""}auth/login`,
    { email, password, ...(churchCode ? { churchCode } : {}) },
    realm,
  );
}
async function snapshot(database: Database) {
  const result: Record<string, unknown> = {};
  for (const collection of (
    await database.db.listCollections({}, { nameOnly: false }).toArray()
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const c = database.db.collection(collection.name),
      hash = new Bun.CryptoHasher("sha256");
    let count = 0;
    for await (const row of c.find().sort({ _id: 1 })) {
      hash.update(`${canonical(JSON.parse(EJSON.stringify(row, { relaxed: false })))}\n`);
      count++;
    }
    const indexes = (await c.listIndexes().toArray())
      .map((i) => ({
        key: Object.entries(i.key),
        name: i.name,
        ...(i.unique ? { unique: true } : {}),
        ...(i.expireAfterSeconds !== undefined ? { expireAfterSeconds: i.expireAfterSeconds } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    console.info(`Fingerprint ${collection.name}: ${count} rows`);
    result[collection.name] = {
      count,
      sha256: hash.digest("hex"),
      indexes,
      validator: collection.options?.validator ?? null,
    };
  }
  return result;
}
async function seed(ownerId: ObjectId, userPassword: string) {
  const now = new Date(),
    churches = Array.from({ length: 100 }, (_, i) => ({
      _id: new ObjectId(),
      code: `HT-CHURCHAA${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
      name: `Hội Thánh synthetic ${String(i).padStart(3, "0")}`,
      nameKey: `hội thánh synthetic ${String(i).padStart(3, "0")}`,
      province: "Đà Nẵng",
      status: i % 10 === 9 ? "suspended" : "active",
      version: 1,
      writeFence: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: ownerId,
      updatedBy: ownerId,
    }));
  await db.db.collection("churches").insertMany(churches);
  const ids = Array.from({ length: 10000 }, () => new ObjectId());
  for (let batch = 0; batch < 10000; batch += 100) {
    const accounts: Record<string, unknown>[] = [],
      credentials: Credential[] = [];
    for (let chunk = batch; chunk < batch + 100; chunk += 4) {
      const group = await Promise.all(
        Array.from({ length: 4 }, async (_, offset) => {
          const i = chunk + offset,
            c = required(churches[Math.floor(i / 100)]),
            id = required(ids[i]),
            password = i === 0 ? userPassword : crypto.randomUUID() + crypto.randomUUID();
          return { i, c, id, passwordHash: await hashPassword(password) };
        }),
      );
      for (const { i, c, id, passwordHash } of group) {
        const email = `fixture-${i}@example.test`;
        accounts.push({
          _id: id,
          churchId: c._id,
          email,
          emailKey: email,
          displayName: `Tín hữu synthetic ${String(i).padStart(5, "0")}`,
          displayNameKey: `tín hữu synthetic ${String(i).padStart(5, "0")}`,
          role: i % 3 === 0 ? "member" : "secretary",
          scope: { kind: i % 3 === 0 ? "self" : "church" },
          status: i % 10 === 9 ? "locked" : "active",
          authEpoch: 1,
          version: 1,
          writeFence: 0,
          createdAt: now,
          updatedAt: now,
          createdBy: ownerId,
          updatedBy: ownerId,
        });
        credentials.push({
          _id: new ObjectId(),
          principalKind: "church_user",
          principalId: id,
          churchId: c._id,
          passwordHash,
          kind: "permanent",
          credentialVersion: 1,
          writeFence: 0,
          updatedAt: now,
        });
      }
    }
    await db.db.collection("accounts").insertMany(accounts);
    await db.credentials.insertMany(credentials);
    if ((batch + 100) % 1000 === 0)
      console.info(`Seed ${batch + 100}/10000 accounts with independent Argon2 hashes`);
  }
  for (let batch = 0; batch < 100000; batch += 1000) {
    const rows = Array.from({ length: 1000 }, (_, offset): AuditEvent => {
      const i = batch + offset,
        c = required(churches[i % 100]),
        user = i % 7 === 0,
        global = i % 17 === 0;
      return {
        _id: new ObjectId(),
        occurredAt: new Date(now.getTime() - Math.floor(i / 3) * 1000),
        actorKind: user ? "church_user" : "owner",
        actorId: user ? required(ids[(i % 100) * 100]) : ownerId,
        actorChurchId: user ? c._id : null,
        targetChurchId: global && !user ? null : c._id,
        eventType: required(
          ["account.created", "account.permissions_changed", "account.status_changed"][i % 3],
        ),
        targetType: "account",
        targetId: required(ids[(i % 100) * 100]),
        outcome: "success",
        changedFields: ["status"],
        safeSummary: "Synthetic qualification fixture",
        requestId: crypto.randomUUID(),
      };
    });
    await db.audits.insertMany(rows);
  }
  return { churches, ids };
}
async function explain(churchId: ObjectId) {
  const rows = [];
  for (const [label, name, filter, sort] of [
    ["F10-all", "churches", {}, { nameKey: 1, _id: 1 }],
    ["F10-status", "churches", { status: "active" }, { nameKey: 1, _id: 1 }],
    ["F15-all", "accounts", { churchId }, { displayNameKey: 1, _id: 1 }],
    [
      "F15-filter",
      "accounts",
      { churchId, status: "active", role: "member" },
      { displayNameKey: 1, _id: 1 },
    ],
    [
      "F15-exact",
      "accounts",
      { churchId, emailKey: "fixture-0@example.test" },
      { displayNameKey: 1, _id: 1 },
    ],
    ["F23-global", "audit_events", {}, { occurredAt: -1, _id: -1 }],
    ["F23-church", "audit_events", { targetChurchId: churchId }, { occurredAt: -1, _id: -1 }],
    [
      "F23-filter",
      "audit_events",
      { targetChurchId: churchId, eventType: "account.created" },
      { occurredAt: -1, _id: -1 },
    ],
  ] as [string, string, object, Record<string, 1 | -1>][]) {
    const plan = await db.db
      .collection(name)
      .find(filter)
      .sort(sort)
      .limit(26)
      .maxTimeMS(3000)
      .explain("executionStats");
    const indexes = new Set<string>(),
      stages = new Set<string>();
    function walk(o: unknown) {
      if (o && typeof o === "object")
        for (const [key, v] of Object.entries(o)) {
          if (key === "indexName" && typeof v === "string") indexes.add(v);
          else if (key === "stage" && typeof v === "string") stages.add(v);
          else walk(v);
        }
    }
    walk(plan.queryPlanner.winningPlan);
    if (stages.has("COLLSCAN")) throw new Error(`Unexpected full scan ${label}`);
    rows.push({
      label,
      indexes: [...indexes],
      stages: [...stages],
      returned: plan.executionStats.nReturned,
      keysExamined: plan.executionStats.totalKeysExamined,
      documentsExamined: plan.executionStats.totalDocsExamined,
      millis: plan.executionStats.executionTimeMillis,
    });
  }
  return rows;
}
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
    tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) },
    fetch: (req) =>
      accepting ? handler(req, { ip: "p14-qualification" }) : new Response(null, { status: 503 }),
  });
  conf.port = required(server.port);
  conf.origin = `https://localhost:${server.port}`;
  const owner = await new OwnerOperations(db).create({
      email: `owner-${runId}@example.test`,
      displayName: "Owner synthetic qualification",
    }),
    ownerPassword = `Owner 🌿 ${crypto.randomUUID()}`,
    userPassword = `User 🌿 ${crypto.randomUUID()}`;
  await login(owner.email, owner.temporaryPassword);
  await call("owner/auth/change-initial-password", {
    newPassword: ownerPassword,
    confirmation: ownerPassword,
  });
  await login(owner.email, ownerPassword);
  console.info("Seeding isolated qualification dataset; main database untouched");
  const { churches } = await seed(new ObjectId(owner.employeeId), userPassword),
    first = required(churches[0]),
    accountPath = `owner/churches/${first._id}/accounts`;
  const queryPlans = await explain(first._id);
  const f10 = await call("owner/churches"),
    f15 = await call(accountPath),
    f23 = await call("owner/audit-events");
  const profiles = [
    ["F10-all", "owner/churches"],
    ["F10-status", "owner/churches?status=active"],
    ["F10-next", `owner/churches?cursor=${encodeURIComponent(f10.nextCursor)}`],
    ["F15-all", accountPath],
    ["F15-filter", `${accountPath}?role=member&status=active`],
    ["F15-exact", `${accountPath}?q=fixture-0%40example.test`],
    ["F15-next", `${accountPath}?cursor=${encodeURIComponent(f15.nextCursor)}`],
    ["F23-global", "owner/audit-events"],
    ["F23-church", `owner/audit-events?churchId=${first._id}`],
    [
      "F23-filter",
      `owner/audit-events?churchId=${first._id}&eventType=account.created&from=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`,
    ],
    ["F23-next", `owner/audit-events?cursor=${encodeURIComponent(f23.nextCursor)}`],
  ];
  const measurements = [];
  for (const [name, path] of profiles)
    for (const concurrency of [1, 5, 10]) {
      for (let i = 0; i < 10; i++) await call(required(path));
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
          while (next++ < 100) {
            const before = performance.now();
            try {
              await call(required(path));
            } catch (e) {
              const key = e instanceof Error ? e.message : "failure";
              errors[key] = (errors[key] ?? 0) + 1;
            }
            samples.push(performance.now() - before);
          }
        }),
      );
      clearInterval(timer);
      const elapsed = performance.now() - start;
      samples.sort((a, b) => a - b);
      const percentile = (p: number) =>
        Math.round(required(samples[Math.ceil(samples.length * p) - 1]) * 100) / 100;
      measurements.push({
        profile: name,
        concurrency,
        samples: samples.length,
        warmup: 10,
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        requestsPerSecond: Math.round((samples.length * 1000) / elapsed),
        errors,
        rssPeakMiB: Math.round(peak / 1048576),
      });
      console.info(
        `Measured ${name} concurrency=${concurrency}, errors=${Object.values(errors).reduce((a, b) => a + b, 0)}`,
      );
    }
  await login("fixture-0@example.test", userPassword, "church", first.code);
  await call("auth/me", undefined, "church");
  accepting = false; // All source calls awaited; block further HTTP work throughout snapshot/restore.
  console.info("Source quiesced; fingerprinting snapshot");
  const before = await snapshot(db);
  for (const [name, expected] of [
    ["churches", 100],
    ["accounts", 10000],
    ["credentials", 10001],
  ] as const) {
    if ((before[name] as { count: number }).count !== expected)
      throw new Error("Qualification dataset cardinality mismatch");
  }
  const archive = join(privateDir, "snapshot.archive.gz"),
    dumpStart = performance.now();
  console.info("Dumping quiesced source");
  const dumpFd = openSync(archive, "wx", 0o600);
  try {
    const dump = Bun.spawnSync(
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
      { stdout: dumpFd, stdin: "ignore", stderr: "ignore", timeout: 60000 },
    );
    if (dump.exitCode !== 0) throw new Error("Synthetic dump failed");
  } finally {
    closeSync(dumpFd);
  }
  const dumpMs = Math.round(performance.now() - dumpStart),
    archiveSha256 = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(archive).arrayBuffer())
      .digest("hex");
  const restoreStart = performance.now();
  await restored.client.connect();
  if (await restored.db.listCollections().hasNext())
    throw new Error("Restore target must be empty");
  console.info("Restoring into empty generated target");
  const restoreFd = openSync(archive, "r");
  try {
    const restore = Bun.spawnSync(
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
    if (restore.exitCode !== 0) throw new Error("Synthetic restore failed");
  } finally {
    closeSync(restoreFd);
  }
  const restoreMs = Math.round(performance.now() - restoreStart),
    after = await snapshot(restored);
  if (canonical(before) !== canonical(after))
    throw new Error("Restore data/index/validator fingerprints differ");
  const revocation = await restored.sessions.updateMany(
    { revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() }, $inc: { writeFence: 1 } },
  );
  await restored.ready();
  const recoveredIdentity = new Identity(restored, rate, conf);
  await recoveredIdentity.initialize();
  const recovered = createApp(recoveredIdentity, conf, { log: () => {} });
  for (const realm of ["owner", "church"]) {
    const old = await recovered(
      new Request(`${conf.origin}/api/v1/${realm === "owner" ? "owner/" : ""}auth/me`, {
        headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join(";") },
      }),
      { ip: "p14-restore" },
    );
    if (old.status !== 401) throw new Error("Restored session revived");
  }
  handler = recovered;
  accepting = true;
  console.info("Restored data verified; exercising fresh HTTPS sessions");
  jar.clear();
  await login(owner.email, ownerPassword);
  await call("owner/auth/me");
  await call("owner/audit-events");
  await login("fixture-0@example.test", userPassword, "church", first.code);
  await call("auth/me", undefined, "church");
  const limits = [
    "Synthetic isolated data; independent password hashes for every account",
    "HTTP HTTPS loopback and application RSS in same Bun process; not separate server capacity",
    "Fixed query profiles, warm cache, 100 measured requests per profile/concurrency; not production SLA",
    "Backup quiesced source, not online point-in-time recovery; no production RPO/RTO",
    "Restored sessions revoked; mutations after snapshot not recovered; Redis rate-limit state not backed up",
    "Raw backup/private TLS material removed; only aggregate fingerprints/checksum delivered",
  ];
  await Bun.write(
    join(out, "qualification.json"),
    JSON.stringify(
      {
        status: measurements.every((r) => Object.keys(r.errors).length === 0) ? "PASS" : "FAIL",
        dataset: {
          churches: 100,
          accounts: 10000,
          seedAuditEvents: 100000,
          actualAuditEvents: (before.audit_events as { count: number }).count,
        },
        environment: {
          bun: Bun.version,
          platform: process.platform,
          arch: process.arch,
          cpu: cpus()[0]?.model,
          logicalCpus: cpus().length,
          hostMemoryGiB: Math.round(totalmem() / 1073741824),
        },
        queryPlans,
        measurements,
        limits,
      },
      null,
      2,
    ),
  );
  await Bun.write(
    join(out, "restore.json"),
    JSON.stringify(
      {
        status: "PASS",
        archiveSha256,
        archiveBytes: Bun.file(archive).size,
        dumpMs,
        restoreMs,
        collections: before,
        allFingerprintsMatch: true,
        restoredSessionsRevoked: revocation.modifiedCount,
        oldOwnerAndUserTokensRejected: true,
        freshOwnerAndUserLoginPass: true,
        readinessPass: true,
        limits,
      },
      null,
      2,
    ),
  );
  if (measurements.some((r) => Object.keys(r.errors).length))
    throw new Error("Qualification HTTP errors, inspect aggregate report");
  console.info("PASS measurement and restore; cleaning only generated synthetic databases");
} finally {
  const stopped = server?.stop(true);
  for (const [database, name] of [
    [db, sourceName],
    [restored, restoreName],
  ] as const) {
    if (database.db.databaseName === name && name.startsWith("church_cms_test_p14_")) {
      try {
        await database.db.dropDatabase();
      } finally {
        await database.client.close();
      }
    }
  }
  if (rate.client.isOpen) rate.client.destroy();
  await rm(privateDir, { recursive: true, force: true });
  if (stopped)
    await Promise.race([
      stopped,
      Bun.sleep(3000).then(() => {
        throw new Error("Qualification listener shutdown timed out");
      }),
    ]);
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
