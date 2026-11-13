import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../api/members/dates";
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
import { seedPrepEnrollments } from "./p33-fixtures";

const run = crypto.randomUUID().replaceAll("-", ""),
  base = config();
localOnly(base);
const privateDir = resolve(".local", `p3.3-${run}`),
  out = resolve("output/p3.3");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text();
const conf = {
  ...base,
  origin: "https://localhost:3467",
  port: 3467,
  database: `church_cms_test_p33q_${run}`,
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
    fetch: (req) => app(req, { ip: req.headers.get("x-synthetic-client") ?? "p33-qualification" }),
  });
  const owner = makeClient("owner"),
    info = await syntheticOwner(db, owner);
  for (const size of [100, 500, 2000]) {
    const c = await syntheticChurch(owner, `P33 qualification ${size}`),
      root = `owner/churches/${c.id}`;
    await seedP2(db, c.id, info.id, size);
    await db.db.collection("members").updateMany(
      { churchId: new ObjectId(c.id) },
      {
        $set: {
          type: "believer",
          membership: "preparatory",
          participation: "active",
          baptism: { status: "not_baptized", date: null, place: null },
        },
      },
    );
    const made = await owner.call(`${root}/prep-classes/courses`, {
      name: `Khóa ${size}`,
      startOn: shiftDay(businessDay(), -7),
      teacher: "Giảng viên synthetic",
      baptismOn: null,
      lessons: ["Bài 1", "Bài 2", "Bài 3"],
    });
    assert(made.status === 201, `course-${size}`);
    const id = made.payload.data.courseId,
      path = `${root}/prep-classes/courses/${id}`,
      enrollments = await seedPrepEnrollments(db, c.id, id, size);
    const before = (await owner.call(path)).payload.data;
    assert(
      (
        await owner.call(
          `${path}/activate`,
          { reason: "Qualification synthetic" },
          { version: before.version },
        )
      ).status === 200,
      `activate-${size}`,
    );
    const course = (await owner.call(path)).payload.data;
    const users: SyntheticClient[] = [];
    for (let i = 0; i < 10; i++) {
      const u = makeClient("church");
      await syntheticUser(owner, u, c, "secretary");
      users.push(u);
    }
    for (const [lessonIndex, concurrency] of [1, 5, 10].entries()) {
      const lid = course.lessons[lessonIndex].id,
        m = await owner.call(`${path}/meetings`, {
          lessonId: lid,
          kind: "regular",
          heldOn: businessDay(),
          location: null,
          memberIds: null,
        });
      assert(m.status === 201, `meeting-${size}-${concurrency}`);
      const sid = m.payload.data.sessionId,
        ap = `${root}/attendance/sessions/${sid}`,
        preview = await owner.call(`${ap}/candidates`);
      assert(preview.payload.data.total === size, `roster-${size}-${concurrency}`);
      assert(
        (
          await owner.call(
            `${ap}/open`,
            { previewToken: preview.payload.data.previewToken },
            { version: 1 },
          )
        ).status === 200,
        `open-${size}-${concurrency}`,
      );
      async function intent(index: number, user: SyntheticClient) {
        const e = enrollments[index];
        if (!e) throw new Error("Fixture missing");
        const start = performance.now(),
          key = crypto.randomUUID(),
          statuses: number[] = [];
        let committed = false;
        for (let attempt = 0; attempt < 6; attempt++) {
          const r = await user.call(
            `churches/${c.id}/attendance/sessions/${sid}/participants/${e.memberId}`,
            { present: true, generation: 2 },
            { method: "PATCH", version: 1, key },
          );
          statuses.push(r.status);
          if (r.status === 200) {
            committed = true;
            break;
          }
          assert(r.status === 409, `bounded-contention-${size}-${concurrency}-${index}`);
          await Bun.sleep(15 * (attempt + 1));
        }
        assert(committed, `committed-${size}-${concurrency}-${index}`);
        let progress: Awaited<ReturnType<SyntheticClient["call"]>> | undefined;
        for (let attempt = 0; attempt < 6; attempt++) {
          progress = await user.call(
            `churches/${c.id}/prep-classes/courses/${id}/enrollments?q=${encodeURIComponent(e.code)}`,
          );
          statuses.push(progress.status);
          if (progress.status === 200) break;
          assert(
            progress.status === 409,
            `bounded-read-contention-${size}-${concurrency}-${index}`,
          );
          await Bun.sleep(15 * (attempt + 1));
        }
        assert(progress?.status === 200, `progress-read-${size}-${concurrency}-${index}`);
        if (!progress) throw new Error("Missing progress response");
        assert(
          progress.payload.data.items.length === 1 &&
            !progress.payload.data.items[0].creditedLessonIds.includes(lid),
          `unclosed-excluded-${size}-${concurrency}-${index}`,
        );
        return { latencyMs: performance.now() - start, statuses };
      }
      for (let i = 0; i < 10; i++) await intent(i, users[0] as SyntheticClient);
      const measured: Awaited<ReturnType<typeof intent>>[] = [];
      for (let i = 10; i < 70; i += concurrency)
        measured.push(
          ...(await Promise.all(
            Array.from({ length: Math.min(concurrency, 70 - i) }, (_, j) =>
              intent(i + j, users[j] as SyntheticClient),
            ),
          )),
        );
      const state = (await owner.call(ap)).payload.data;
      assert(
        state.presentCount === 70 && state.includedCount === size,
        `exact-count-${size}-${concurrency}`,
      );
      assert(
        (await db.db
          .collection("attendance_history")
          .countDocuments({ sessionId: new ObjectId(sid), event: "marked" })) === 70,
        `exact-history-${size}-${concurrency}`,
      );
      assert(
        (await owner.call(`${ap}/close`, {}, { version: state.version })).status === 200,
        `close-${size}-${concurrency}`,
      );
      const progress = (await owner.call(`${path}/enrollments?limit=100`)).payload.data;
      assert(
        progress.items.filter((e: { creditedLessonIds: string[] }) =>
          e.creditedLessonIds.includes(lid),
        ).length === 70,
        `closed-credit-${size}-${concurrency}`,
      );
      if (concurrency === 10) {
        const e = enrollments[70];
        if (!e) throw new Error("Fixture missing");
        const bm = await owner.call(`${path}/meetings`, {
          lessonId: lid,
          kind: "makeup",
          heldOn: businessDay(),
          location: null,
          memberIds: [e.memberId.toHexString()],
        });
        assert(bm.status === 201, `makeup-create-${size}`);
        const bp = `${root}/attendance/sessions/${bm.payload.data.sessionId}`,
          pr = (await owner.call(`${bp}/candidates`)).payload.data;
        assert(pr.total === 1, `makeup-source-${size}`);
        assert(
          (await owner.call(`${bp}/open`, { previewToken: pr.previewToken }, { version: 1 }))
            .status === 200,
          `makeup-open-${size}`,
        );
        assert(
          (
            await owner.call(
              `${bp}/participants/${e.memberId}`,
              { present: true, generation: 2 },
              { method: "PATCH", version: 1 },
            )
          ).status === 200,
          `makeup-mark-${size}`,
        );
        const bs = (await owner.call(bp)).payload.data;
        assert(
          (await owner.call(`${bp}/close`, {}, { version: bs.version })).status === 200,
          `makeup-close-${size}`,
        );
        assert(
          (
            await owner.call(`${path}/enrollments?q=${e.code}`)
          ).payload.data.items[0].creditedLessonIds.includes(lid),
          `makeup-credit-${size}`,
        );
      }
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
    .collection("attendance_sessions")
    .find({ churchId: new ObjectId(), "prepClass.courseId": new ObjectId(), state: "closed" })
    .explain("executionStats");
  assert(
    JSON.stringify(plan.queryPlanner.winningPlan).includes("attendance_prep_progress"),
    "class-progress-index-selected",
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
        progressPlan: plan,
        limits: [
          "Local synthetic/HTTPS/private CA",
          "Large enrollment fixture direct setup; public enrollment verified separately by integration/browser",
          "Measured intent = Attendance mark + current class progress read, bounded exact-intent retries included",
          "Three required lessons, no full 200-lesson capacity or production SLA",
          "Single API process/local replica set; physical camera/paper/Safari/multi-replica NOT_RUN",
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
