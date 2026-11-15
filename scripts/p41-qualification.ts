import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import { createApp } from "../api/app";
import { config } from "../api/config";
import { Identity } from "../api/identity/service";
import { Database, initialize } from "../api/infrastructure/database";
import { RateLimit } from "../api/infrastructure/rate-limit";
import { businessDay, shiftDay } from "../api/members/dates";
import type { ScheduleRow, ScheduleSeries } from "../api/scheduling/models";
import type { ScheduleCommand } from "../api/scheduling/validation";
import { localTls } from "./local-tls";
import {
  check,
  localOnly,
  SyntheticClient,
  syntheticChurch,
  syntheticOwner,
  syntheticUser,
} from "./p2-fixtures";

const base = config();
localOnly(base);
const run = crypto.randomUUID().replaceAll("-", ""),
  privateDir = resolve(".local", `p4.1-${run}`),
  out = resolve("output/p4.1");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(out, { recursive: true });
const tls = await localTls(privateDir),
  ca = await Bun.file(tls.ca).text(),
  conf = {
    ...base,
    origin: "https://localhost:3475",
    port: 3475,
    database: `church_cms_test_p41q_${run}`,
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
    fetch: (req) => app(req, { ip: req.headers.get("x-synthetic-client") ?? "p41q" }),
  });
  const owner = client("owner");
  await syntheticOwner(db, owner);
  for (const size of [100, 500, 2000]) {
    const c = await syntheticChurch(owner, `Lịch qualification ${size}`),
      churchId = new ObjectId(c.id),
      now = new Date(),
      day = shiftDay(businessDay(), 30),
      rows: ScheduleRow[] = [],
      series: ScheduleSeries[] = [];
    if (db.db.databaseName !== `church_cms_test_p41q_${run}`)
      throw Error("Owned synthetic DB only");
    // Volume fixtures are explicit storage fixtures, not claimed as public-command history.
    for (let i = 0; i < size; i++) {
      const date = shiftDay(day, i % 84),
        input: ScheduleCommand["input"] = {
          label: `Lịch volume ${String(i).padStart(5, "0")}`,
          kind: i % 2 ? "activity" : "worship",
          scope: "church",
          unitId: null,
          day: date,
          startTime: "07:30",
          endDay: date,
          endTime: "09:00",
          location: null,
          scripture: null,
          theme: null,
          speaker: null,
          leaderId: null,
          choirId: null,
          communion: false,
          repeat: { kind: "once" },
        },
        id = new ObjectId(),
        seriesId = new ObjectId(),
        at = new Date(`${date}T07:30:00+07:00`);
      rows.push({
        _id: id,
        churchId,
        seriesId,
        generation: 1,
        slot: at.toISOString(),
        input,
        startAt: at,
        endAt: new Date(`${date}T09:00:00+07:00`),
        state: "scheduled",
        unitName: null,
        speakerName: null,
        leaderName: null,
        choirName: null,
        memberIds: [],
        version: 1,
        exception: false,
        superseded: false,
        createdAt: now,
        updatedAt: now,
      });
      series.push({
        _id: seriesId,
        churchId,
        generation: 1,
        version: 1,
        input,
        createdAt: now,
        updatedAt: now,
      });
    }
    await db.db.collection<ScheduleSeries>("schedule_series").insertMany(series);
    await db.db.collection<ScheduleRow>("schedule_occurrences").insertMany(rows);
    await db.db.collection("schedule_state").insertOne({ _id: churchId, revision: 0 });
    const exp = await db.db
      .collection("schedule_occurrences")
      .find({
        churchId,
        startAt: {
          $gte: new Date(`${day}T00:00:00+07:00`),
          $lt: new Date(`${shiftDay(day, 84)}T00:00:00+07:00`),
        },
      })
      .sort({ startAt: 1, _id: 1 })
      .limit(26)
      .explain("executionStats");
    assert(
      JSON.stringify(exp.queryPlanner.winningPlan).includes("schedule_page"),
      `indexed-list-${size}`,
    );
    assert(exp.executionStats.totalDocsExamined <= 26, `bounded-docs-${size}`);
    plans.push({
      size,
      winningPlan: exp.queryPlanner.winningPlan,
      docsExamined: exp.executionStats.totalDocsExamined,
      keysExamined: exp.executionStats.totalKeysExamined,
    });
    const users: SyntheticClient[] = [];
    for (let i = 0; i < 10; i++) {
      const u = client("church");
      await syntheticUser(owner, u, c);
      users.push(u);
    }
    const root = `churches/${c.id}/scheduling`,
      list = `${root}/occurrences?from=${day}&to=${shiftDay(day, 83)}`;
    for (const concurrency of [1, 5, 10]) {
      const latencies: number[] = [],
        attemptStatuses: Record<string, number> = {},
        stages: Record<string, number[]> = { list: [], detail: [], preview: [], commit: [] };
      let retries = 0,
        requests = 0;
      const journey = async (worker: number, index: number, measured: boolean) => {
        const u = users[worker],
          record = rows[worker];
        if (!u || !record) throw Error("Missing fixture");
        const path = `${root}/occurrences/${record._id}`,
          start = performance.now();
        const call = async (
          stage: string,
          path: string,
          body?: object,
          version?: number,
          method?: string,
        ) => {
          const t = performance.now(),
            r = await u.call(path, body, { version, method });
          if (measured) {
            requests++;
            stages[stage]?.push(performance.now() - t);
            attemptStatuses[String(r.status)] = (attemptStatuses[String(r.status)] ?? 0) + 1;
          }
          return r;
        };
        assert(
          (await call("list", list)).status === 200,
          `list-${size}-${concurrency}-${worker}-${index}-${measured}`,
        );
        for (let attempt = 0; attempt < 32; attempt++) {
          const d = await call("detail", path);
          check(d.status === 200, "detail");
          const command: ScheduleCommand = {
            input: { ...d.payload.data.input, label: `Đính chính ${worker}/${index}/${measured}` },
            state: d.payload.data.state,
            range: "one",
            reason: "Qualification synthetic",
            preview: null,
            conflictsConfirmed: false,
            exceptionsConfirmed: false,
          };
          const p = await call(
            "preview",
            `${path}/preview`,
            command,
            d.payload.data.version,
            "POST",
          );
          check(p.status === 200, "preview");
          const r = await call(
            "commit",
            path,
            { ...command, preview: p.payload.data.context },
            d.payload.data.version,
            "PATCH",
          );
          if (r.status === 200) {
            if (measured) latencies.push(performance.now() - start);
            return;
          }
          check([409, 412].includes(r.status), `unexpected-commit-${r.status}`);
          if (measured) retries++;
          await Bun.sleep(Math.min(250, 20 + attempt * 10) * (0.5 + Math.random()));
        }
        throw Error("Bounded workload contention retry exhausted");
      };
      await Promise.all(
        Array.from({ length: concurrency }, (_, worker) =>
          (async () => {
            for (let i = 0; i < 2; i++) await journey(worker, i, false);
          })(),
        ),
      );
      await Promise.all(
        Array.from({ length: concurrency }, (_, worker) =>
          (async () => {
            for (let i = 0; i < 10; i++) await journey(worker, i, true);
          })(),
        ),
      );
      assert(latencies.length === concurrency * 10, `completed-${size}-${concurrency}`);
      const stageResults = Object.fromEntries(
        Object.entries(stages).map(([k, x]) => [
          k,
          {
            samples: x.length,
            p50: percentile(x, 0.5),
            p95: percentile(x, 0.95),
            max: Math.max(...x),
          },
        ]),
      );
      const result = {
        size,
        concurrency,
        measuredJourneys: latencies.length,
        requests,
        retries,
        attemptStatuses,
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: Math.max(...latencies),
        stages: stageResults,
      };
      results.push(result);
      console.info(JSON.stringify(result));
    }
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
          "Synthetic local HTTPS/private CA",
          "Direct storage volume fixtures separate from public-command integration/browser workflows",
          "Workload retries simulate explicit reread/repreview after rejected stale proposal; UI never auto-accepts",
          "No production SLA/capacity/RPO/RTO; P4 restore aggregate belongs unopened P4.6",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (server) await server.stop(true);
  if (db.db.databaseName === `church_cms_test_p41q_${run}`) await db.db.dropDatabase();
  const remaining = (await db.client.db("admin").admin().listDatabases()).databases.some(
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
      listener: 3475,
      serverStopped: true,
    }),
  );
}
