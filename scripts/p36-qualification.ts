import { closeSync, openSync } from "node:fs";
import { chmod, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BSON, ObjectId } from "mongodb";
import { createApp } from "../api/app";
import type { AttendanceParticipant, AttendanceSession } from "../api/attendance/models";
import { lastSunday } from "../api/attendance/reporting";
import { config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../api/members/dates";
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
import { p36Workflow } from "./p36-workflow";

const run = crypto.randomUUID().replaceAll("-", ""),
  base = config();
localOnly(base);
const privateDir = resolve(".local", `p3.6-${run}`),
  out = resolve("output/p3.6");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(join(privateDir, "tls")),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3472",
    port: 3472,
    cert: tls.cert,
    key: tls.key,
    database: `church_cms_test_p36q_${run}`,
    csrfKey: crypto.randomUUID() + crypto.randomUUID(),
  },
  restoreName = `church_cms_test_p36restore_${run}`;
const db = new Database(conf),
  target = new Database({ ...conf, database: restoreName }),
  rate = new RateLimit(conf.redisUrl, conf.csrfKey);
let server: ReturnType<typeof Bun.serve> | undefined,
  accepting = true;
const checks: string[] = [],
  results: object[] = [],
  plans: object[] = [];
const assert = (v: unknown, label: string) => {
  check(v, label);
  checks.push(label);
};
const client = (realm: "owner" | "church" = "owner") => {
  const ip = crypto.randomUUID();
  return new SyntheticClient(realm, conf.origin, (req) => {
    req.headers.set("x-synthetic-client", ip);
    return fetch(req, { tls: { ca, rejectUnauthorized: true } });
  });
};
const owner = client();
async function fingerprint(database: Database) {
  const result: Record<string, unknown> = {};
  for (const col of (await database.db.listCollections({}, { nameOnly: false }).toArray()).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const rows = database.db.collection(col.name),
      hash = new Bun.CryptoHasher("sha256");
    let count = 0;
    for await (const r of rows.find().sort({ _id: 1 })) {
      hash.update(`${canonical(JSON.parse(BSON.EJSON.stringify(r, { relaxed: false })))}\n`);
      count++;
    }
    result[col.name] = {
      count,
      sha256: hash.digest("hex"),
      validator: col.options?.validator ?? null,
      indexes: (await rows.listIndexes().toArray())
        .map((i) => ({
          name: i.name,
          key: Object.entries(i.key),
          unique: i.unique ?? false,
          partialFilterExpression: i.partialFilterExpression ?? null,
          expireAfterSeconds: i.expireAfterSeconds ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  return result;
}
const pct = (xs: number[], p: number) =>
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
    idleTimeout: 15,
    tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) },
    fetch: (req) =>
      accepting
        ? app(req, { ip: req.headers.get("x-synthetic-client") ?? "p36q" })
        : new Response(null, { status: 503 }),
  });
  const actor = await syntheticOwner(db, owner),
    until = lastSunday(businessDay());
  for (const population of [100, 500, 2000]) {
    const c = await syntheticChurch(owner, `P36 volume synthetic ${population}`),
      churchId = new ObjectId(c.id);
    await seedP2(db, c.id, actor.id, population);
    await db.db
      .collection("members")
      .updateMany({ churchId }, { $set: { participation: "active" } });
    const members = await db.db.collection("members").find({ churchId }).sort({ _id: 1 }).toArray();
    // Explicit volume fixtures, never claimed as API-created event history. The separate workflow below uses public commands.
    assert(/^church_cms_test_p36q_/.test(db.db.databaseName), "Volume fixture DB allowlist");
    for (let i = 11; i >= 0; i--) {
      const id = new ObjectId(),
        heldOn = shiftDay(until, -7 * i),
        now = new Date(),
        s: AttendanceSession = {
          _id: id,
          churchId,
          label: "Volume reference synthetic",
          heldOn,
          scope: "church",
          unitId: null,
          unitName: null,
          location: null,
          reportingKind: "sunday_reference",
          state: "closed",
          version: 1,
          generation: 1,
          rowCount: population,
          includedCount: population,
          presentCount: population / 2,
          capturedAt: now,
          createdAt: now,
          updatedAt: now,
        };
      await db.db.collection<AttendanceSession>("attendance_sessions").insertOne(s);
      const rows: AttendanceParticipant[] = members.map((m, index) => ({
        _id: new ObjectId(),
        churchId,
        sessionId: id,
        memberId: m._id,
        code: m.code,
        fullName: m.fullName,
        nameKey: m.nameKey,
        nameTokens: m.nameTokens,
        type: m.type,
        areaName: null,
        included: true,
        present: index < population / 2,
        version: 1,
        capturedAt: now,
      }));
      for (let k = 0; k < rows.length; k += 500)
        await db.db
          .collection<AttendanceParticipant>("attendance_participants")
          .insertMany(rows.slice(k, k + 500));
    }
    const prefix = `owner/churches/${c.id}`;
    // Give W04 real volume to aggregate; an empty catalogue would only measure routing/auth.
    const unitIds: ObjectId[] = [];
    for (let unitIndex = 0; unitIndex < 10; unitIndex++) {
      const made = await owner.call(`${prefix}/organization/units`, {
        kind: "area",
        name: `Khu vực tải synthetic ${unitIndex + 1}`,
      });
      assert(made.status === 201, "Volume unit create");
      const unitId = new ObjectId(made.payload.data.unit.id),
        ownMembers = members.filter((_, i) => i % 10 === unitIndex);
      unitIds.push(unitId);
      for (let week = 0; week < 4; week++) {
        const sessionId = new ObjectId(),
          now = new Date();
        await db.db.collection<AttendanceSession>("attendance_sessions").insertOne({
          _id: sessionId,
          churchId,
          label: "Volume own-unit synthetic",
          heldOn: shiftDay(until, -7 * week),
          scope: "unit",
          unitId,
          unitName: made.payload.data.unit.name,
          location: null,
          reportingKind: "general",
          state: "closed",
          version: 1,
          generation: 1,
          rowCount: ownMembers.length,
          includedCount: ownMembers.length,
          presentCount: ownMembers.length / 2,
          capturedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await db.db.collection<AttendanceParticipant>("attendance_participants").insertMany(
          ownMembers.map((m, i) => ({
            _id: new ObjectId(),
            churchId,
            sessionId,
            memberId: m._id,
            code: m.code,
            fullName: m.fullName,
            nameKey: m.nameKey,
            nameTokens: m.nameTokens,
            type: m.type,
            areaName: made.payload.data.unit.name,
            included: true,
            present: i < ownMembers.length / 2,
            version: 1,
            capturedAt: now,
          })),
        );
      }
    }
    for (const concurrency of [1, 5, 10]) {
      const timings: Record<string, number[]> = {
        overview: [],
        members: [],
        detail: [],
        units: [],
      };
      let warmup = true;
      const journey = async (subject: SyntheticClient) => {
        for (const [name, path] of [
          ["overview", `${prefix}/overview`],
          ["members", `${prefix}/members?attendance=absent3&attendanceUntil=${until}&limit=25`],
          ["detail", `${prefix}/members/${members[0]?._id}?attendanceUntil=${until}`],
          ["units", `${prefix}/organization/overview?kind=area&limit=25`],
        ]) {
          const start = performance.now(),
            r = await subject.call(path as string);
          assert(r.status === 200, `Workload ${name}200`);
          if (!warmup) timings[name as string]?.push(performance.now() - start);
          if (name === "overview")
            assert(
              r.payload.data.attendance.value === population / 2 &&
                r.payload.data.attendance.absent3 === population / 2,
              "Volume totals reconcile",
            );
          if (name === "units")
            assert(
              r.payload.data.items.length === 10 &&
                r.payload.data.items.every(
                  (u: { attendance: { value: number; sessions: number; included: number } }) =>
                    u.attendance.value === 50 &&
                    u.attendance.sessions === 4 &&
                    u.attendance.included === (population / 10) * 4,
                ),
              "Volume own-unit weighted snapshots reconcile",
            );
        }
      };
      const clients = Array.from({ length: concurrency }, () => {
        const subject = client();
        subject.jar = new Map(owner.jar);
        subject.csrf = owner.csrf;
        return subject;
      });
      await Promise.all(
        clients.map(async (subject) => {
          for (let i = 0; i < 2; i++) await journey(subject);
        }),
      );
      warmup = false;
      const start = performance.now();
      await Promise.all(
        clients.map(async (subject) => {
          for (let i = 0; i < 10; i++) await journey(subject);
        }),
      );
      results.push({
        population,
        concurrency,
        journeys: concurrency * 10,
        elapsedMs: performance.now() - start,
        steps: Object.fromEntries(
          Object.entries(timings).map(([name, xs]) => [
            name,
            { count: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), max: Math.max(...xs) },
          ]),
        ),
      });
      console.info(JSON.stringify({ population, concurrency, status: "PASS" }));
    }
    for (const [collection, filter, sort, index] of [
      [
        "attendance_sessions",
        {
          churchId,
          reportingKind: "sunday_reference",
          heldOn: { $gte: shiftDay(until, -77), $lte: until },
        },
        { heldOn: 1 },
        "attendance_sunday_reference_unique",
      ],
      [
        "attendance_participants",
        {
          churchId,
          sessionId: {
            $in: await db.db.collection("attendance_sessions").distinct("_id", { churchId }),
          },
          memberId: members[0]?._id,
        },
        { memberId: 1 },
        "attendance_member_unique",
      ],
      [
        "attendance_sessions",
        {
          churchId,
          scope: "unit",
          unitId: { $in: unitIds },
          state: "closed",
          heldOn: { $gte: shiftDay(until, -83), $lte: until },
        },
        { heldOn: -1, _id: -1 },
        "attendance_unit_date",
      ],
    ] as const) {
      const plan = await db.db
        .collection(collection)
        .find(filter)
        .sort(sort)
        .explain("executionStats");
      plans.push({ population, collection, plan });
      await Bun.write(join(out, "explain-progress.json"), JSON.stringify(plans, null, 2));
      const winning = JSON.stringify(plan.queryPlanner.winningPlan);
      // A batch across all ten areas can legitimately prefer tenant/date order to
      // merging ten unit/date ranges. Both preserve the tenant + date bound.
      const acceptable = index === "attendance_unit_date" ? [index, "attendance_date"] : [index];
      assert(
        !winning.includes("COLLSCAN") && acceptable.some((name) => winning.includes(name)),
        `Indexed ${index} or valid tenant-date batch plan`,
      );
    }
  }
  const flowChurch = await syntheticChurch(owner, "Cross P3 workflow synthetic");
  await seedP2(db, flowChurch.id, actor.id, 4);
  const member = await db.db
    .collection("members")
    .findOne({ churchId: new ObjectId(flowChurch.id), type: "believer", participation: "active" });
  assert(member, "Workflow member");
  if (!member) throw Error();
  const flow = await p36Workflow(owner, flowChurch, member._id.toHexString());
  const secretary = client("church"),
    user = await syntheticUser(owner, secretary, flowChurch, "secretary");
  const sourcePrefix = `owner/churches/${flowChurch.id}`,
    sampleMember = (await owner.call(`${sourcePrefix}/members/${flow.memberId}`)).payload.data;
  const staged = await owner.call(`${sourcePrefix}/certificates/drafts`, {
    input: {
      ...(await owner.call(`${sourcePrefix}/certificates/editions/${flow.editionId}`)).payload.data
        .snapshot.input,
    },
    reason: null,
  });
  assert(staged.status === 201, "Restore staging draft");
  const stagedId = staged.payload.data.draftId;
  const stagedPreview = await owner.call(
    `${sourcePrefix}/certificates/drafts/${stagedId}/prepare`,
    {},
    { version: 1 },
  );
  assert(stagedPreview.status === 200, "Restore live preview staged");
  // Capture a QR proof before quiesce, and keep an active card for restored resolution.
  const reopened = await owner.call(
    `${sourcePrefix}/attendance/sessions/${flow.sessionId}/reopen`,
    { reason: "Restore proof fixture" },
    {
      version: (await owner.call(`${sourcePrefix}/attendance/sessions/${flow.sessionId}`)).payload
        .data.version,
    },
  );
  assert(reopened.status === 200, "Restore open source session");
  const state = (await owner.call(`${sourcePrefix}/attendance/sessions/${flow.sessionId}`)).payload
      .data,
    proof = await owner.call(
      `${sourcePrefix}/attendance/sessions/${flow.sessionId}/qr-resolutions`,
      { code: flow.cardPayload, generation: state.generation },
    );
  assert(proof.status === 200, "Restore old proof captured");
  const before = await fingerprint(db),
    archive = join(privateDir, "p36.archive.gz"),
    fd = openSync(archive, "wx", 0o600);
  accepting = false;
  try {
    const p = Bun.spawnSync(
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
        conf.database,
        "--archive",
        "--gzip",
      ],
      { stdout: fd, stderr: "ignore", stdin: "ignore", timeout: 60000 },
    );
    assert(p.exitCode === 0, "Quiesced mongodump");
  } finally {
    closeSync(fd);
  }
  await target.client.connect();
  assert(!(await target.db.listCollections().hasNext()), "Restore target empty");
  const input = openSync(archive, "r");
  try {
    const p = Bun.spawnSync(
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
        `${conf.database}.*`,
        "--nsFrom",
        `${conf.database}.*`,
        "--nsTo",
        `${restoreName}.*`,
      ],
      { stdin: input, stdout: "ignore", stderr: "ignore", timeout: 60000 },
    );
    assert(p.exitCode === 0, "mongorestore to new UUID");
  } finally {
    closeSync(input);
  }
  const restored = await fingerprint(target);
  assert(
    canonical(before) === canonical(restored),
    "All documents/binaries/indexes/validators restored exactly before revocation",
  );
  const revoked = await target.sessions.updateMany(
      { revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() }, $inc: { writeFence: 1 } },
    ),
    removedPreviews = await target.db.collection("certificate_previews").deleteMany({});
  const recoveredConf = {
      ...conf,
      database: restoreName,
      csrfKey: crypto.randomUUID() + crypto.randomUUID(),
    },
    restoredRate = new RateLimit(conf.redisUrl, recoveredConf.csrfKey);
  await restoredRate.connect();
  try {
    const restoredIdentity = new Identity(target, restoredRate, recoveredConf);
    await restoredIdentity.initialize();
    const handler = createApp(restoredIdentity, recoveredConf, { log: () => {} }),
      make = (realm: "owner" | "church") =>
        new SyntheticClient(realm, conf.origin, (req) => handler(req, { ip: crypto.randomUUID() }));
    for (const [realm, who] of [
      ["owner", owner],
      ["church", secretary],
    ] as const) {
      const stale = await handler(
        new Request(`${conf.origin}/api/v1/${realm === "owner" ? "owner/" : ""}auth/me`, {
          headers: { cookie: who.cookie() },
        }),
        { ip: "restored-stale" },
      );
      assert(stale.status === 401, "Restored old session rejected");
    }
    const fresh = make("owner"),
      freshUser = make("church");
    assert(
      (await fresh.login(actor.email, actor.password)).status === 200,
      "Restore owner fresh login",
    );
    assert(
      (await freshUser.login(user.email, user.password, flowChurch.code)).status === 200,
      "Restore secretary fresh login",
    );
    assert(
      (
        await fresh.call(
          `${sourcePrefix}/attendance/sessions/${flow.sessionId}/scans`,
          { resolutionToken: proof.payload.data.resolutionToken, generation: state.generation },
          { version: proof.payload.data.participant.version },
        )
      ).status >= 400,
      "Old QR proof invalid after key rotation",
    );
    assert(
      (
        await fresh.call(`${sourcePrefix}/attendance/sessions/${flow.sessionId}/qr-resolutions`, {
          code: flow.cardPayload,
          generation: state.generation,
        })
      ).status === 200,
      "Restored active card resolves fresh",
    );
    for (const format of ["pdf", "docx"] as const) {
      const r = await handler(
        new Request(
          `${conf.origin}/api/v1/${sourcePrefix}/certificates/editions/${flow.editionId}/files/${format}?version=1`,
          { headers: { cookie: fresh.cookie() } },
        ),
        { ip: "restored-file" },
      );
      assert(r.status === 200, "Restored issued artifact download");
      assert(
        new Bun.CryptoHasher("sha256")
          .update(new Uint8Array(await r.arrayBuffer()))
          .digest("hex") === flow[`${format}Hash`],
        "Restored file hash",
      );
    }
    assert(
      (
        await fresh.call(
          `${sourcePrefix}/certificates/drafts/${stagedId}/issue`,
          {
            previewId: stagedPreview.payload.data.id,
            context: stagedPreview.payload.data.context,
            confirm: true,
            faithConfirmed: true,
            reason: null,
          },
          { version: 1 },
        )
      ).status === 412,
      "Restored temporary preview cannot issue",
    );
    const data = (await fresh.call(`${sourcePrefix}/overview`)).payload.data;
    assert(
      data.attendance.value === null && data.rites.value === 1 && data.classes.enrollments === 1,
      "Restored overview reconciles open reference and recorded rite",
    );
    assert(
      (await fresh.call(`${sourcePrefix}/members/${flow.memberId}`)).payload.data.baptism.status ===
        sampleMember.baptism.status,
      "Restored canonical baptism",
    );
    assert(
      (
        await fresh.call(
          `${sourcePrefix}/certificates/editions/${flow.editionId}/revoke`,
          { reason: "Restore verification revoke" },
          { version: 1 },
        )
      ).status === 200,
      "Restored certificate revoke",
    );
    const denied = await handler(
      new Request(
        `${conf.origin}/api/v1/${sourcePrefix}/certificates/editions/${flow.editionId}/files/pdf?version=2`,
        { headers: { cookie: fresh.cookie() } },
      ),
      { ip: "restored-revoked" },
    );
    assert(denied.status === 410, "Restored revoked download denied");
  } finally {
    restoredRate.client.destroy();
  }
  await Bun.write(`${out}/workflow.json`, JSON.stringify(flow, null, 2));
  await Bun.write(
    `${out}/workload.json`,
    JSON.stringify(
      {
        status: "PASS",
        protocol:
          "100/500/2000 members x1/5/10concurrency,2warmup+10measured/worker,4HTTPS requests/journey; volume seeded separately from actual public workflow; no SLA",
        journeys: 480,
        results,
        plans,
      },
      null,
      2,
    ),
  );
  await Bun.write(
    `${out}/restore.json`,
    JSON.stringify(
      {
        status: "PASS",
        before,
        restored,
        revokedSessions: revoked.modifiedCount,
        removedPreviews: removedPreviews.deletedCount,
        checks,
        limits: [
          "Quiesced isolated synthetic dump/restore; not PITR/RTO/RPO",
          "Restore transformations after hash comparison: revoked sessions, deleted certificate_previews, fresh synthetic signing key; no Redis snapshot/flush",
          "No main DB/volume/service restart; Camera/paper/native Word/Safari/UAT/production NOT_RUN",
        ],
      },
      null,
      2,
    ),
  );
  console.info(
    JSON.stringify({
      status: "PASS",
      configs: results.length,
      journeys: 480,
      checks: checks.length,
    }),
  );
} finally {
  await server?.stop(true);
  for (const d of [db, target]) {
    try {
      if ([conf.database, restoreName].includes(d.db.databaseName)) await d.db.dropDatabase();
    } finally {
      await d.client.close();
    }
  }
  if (rate.client.isOpen) rate.client.destroy();
  await rm(privateDir, { recursive: true, force: true });
  await Bun.write(
    `${out}/qualification-cleanup.json`,
    JSON.stringify({
      source: conf.database,
      restore: restoreName,
      privateDirRemoved: !(await Bun.file(tls.key).exists()),
      cleanupAttempted: true,
    }),
  );
}
