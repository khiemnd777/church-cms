import { ObjectId } from "mongodb";
import type { Database } from "../api/infrastructure/database";
import { shiftDay } from "../api/members/dates";
import { check, type SyntheticClient, syntheticUser } from "./p2-fixtures";
import { p42Fixture, p42Schedule } from "./p42-fixtures";
import { careCreate, careSave } from "./p43-fixtures";
import { careOpenAlert, signalCreate, signalSave } from "./p45-fixtures";
import { type P46Assert, p46Prayer, p46Program, p46Visit } from "./p46-workflow";

export interface P46Metrics {
  requests: number;
  statuses: Record<string, number>;
  stages: Record<string, number[]>;
}
export const p46Summary = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b),
    pct = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? null;
  return { samples: xs.length, p50: pct(0.5), p95: pct(0.95), max: sorted.at(-1) ?? null };
};
export async function p46Workload(
  db: Database,
  owner: SyntheticClient,
  actorId: string,
  client: (realm: "owner" | "church") => SyntheticClient,
  setMetrics: (m: P46Metrics | null) => void,
  assert: P46Assert,
) {
  const results: object[] = [],
    plans: object[] = [];
  for (const size of [100, 500, 2000]) {
    const c = await p42Fixture(db, owner, actorId, size),
      churchId = new ObjectId(c.id),
      secretary = client("church"),
      pastor = client("church");
    await syntheticUser(owner, secretary, c, "secretary");
    await syntheticUser(owner, pastor, c, "pastor");
    const actors = [owner, secretary, pastor],
      roles = ["owner", "secretary", "pastor"],
      jobs: { index: number; kind: "program" | "visit" | "prayer"; id: string }[] = [];
    for (let i = 0; i < 160; i++) {
      const kind = i % 3 === 0 ? "program" : i % 3 === 1 ? "visit" : "prayer";
      let id = "";
      if (kind === "program") {
        const day = shiftDay(c.day, 1 + i);
        id = await p42Schedule(owner, c, {
          ...c.schedule,
          input: { ...c.schedule.input, day, endDay: day, label: `P46 measured ${i}` },
        });
      } else if (kind === "visit") {
        const person = c.people[Math.floor(i / 3)];
        check(person, "distinct care target");
        const target = person._id.toHexString(),
          signal = await signalSave(owner, c, signalCreate(target));
        assert(signal.status === 201, "workload-public-signal-setup");
        id = (await careOpenAlert(db, c, target)).id;
        if (i % 2 === 0)
          assert(
            (
              await careSave(owner, c, {
                ...careCreate({ kind: "member", id: target }, { reasonCode: "illness" }),
                confirmed: true,
              })
            ).status === 201,
            "workload-existing-case-setup",
          );
      }
      jobs.push({ index: i, kind, id });
    }
    let offset = 0;
    for (const workers of [1, 5, 10]) {
      const total = workers === 1 ? 10 : workers === 5 ? 50 : 100,
        selected = jobs.slice(offset, offset + total);
      offset += total;
      const metrics: P46Metrics = { requests: 0, statuses: {}, stages: {} },
        latency: number[] = [],
        byBranch: Record<string, number[]> = { program: [], visit: [], prayer: [] },
        byRole: Record<string, number[]> = { owner: [], secretary: [], pastor: [] },
        outcomes: { kind: string; id: string; mode?: string | null }[] = [];
      setMetrics(metrics);
      try {
        const settled = await Promise.allSettled(
          Array.from({ length: workers }, (_, worker) =>
            (async () => {
              for (let i = worker; i < selected.length; i += workers) {
                const job = selected[i],
                  roleIndex = (worker + Math.floor(i / workers)) % 3,
                  s = actors[roleIndex],
                  role = roles[roleIndex];
                check(job && s && role, "workload context");
                const started = performance.now();
                const noLog: P46Assert = (ok, label) => check(ok, label);
                let result: { id: string; mode?: string | null };
                if (job.kind === "program") result = await p46Program(s, c, job.id, noLog);
                else if (job.kind === "visit")
                  result = await p46Visit(
                    s,
                    c,
                    job.id,
                    c.people[0]?._id.toHexString() as string,
                    noLog,
                  );
                else result = await p46Prayer(s, c, noLog);
                const elapsed = performance.now() - started;
                latency.push(elapsed);
                byBranch[job.kind]?.push(elapsed);
                byRole[role]?.push(elapsed);
                outcomes.push({
                  kind: job.kind,
                  id: result.id,
                  ...("mode" in result ? { mode: result.mode } : {}),
                });
              }
            })(),
          ),
        );
        for (const r of settled) if (r.status === "rejected") throw r.reason;
      } finally {
        setMetrics(null);
      }
      assert(
        latency.length === total &&
          Object.values(byRole).every((v) => v.length > 0) &&
          Object.values(byBranch).every((v) => v.length > 0),
        `all-terminal-branches-roles-${size}-${workers}`,
      );
      assert(
        new Set(outcomes.map((o) => o.id)).size === total,
        `distinct-terminal-items-${size}-${workers}`,
      );
      const result = {
        size,
        workers,
        measuredJourneys: latency.length,
        ...p46Summary(latency),
        ...metrics,
        retryResponses: (metrics.statuses[409] ?? 0) + (metrics.statuses[412] ?? 0),
        stages: Object.fromEntries(
          Object.entries(metrics.stages).map(([k, v]) => [k, p46Summary(v)]),
        ),
        byBranch: Object.fromEntries(Object.entries(byBranch).map(([k, v]) => [k, p46Summary(v)])),
        byRole: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, p46Summary(v)])),
        outcomes,
      };
      results.push(result);
      console.info(
        JSON.stringify({
          ...result,
          outcomes: outcomes.length,
          stages: undefined,
          byRole: undefined,
        }),
      );
    }
    assert(offset === 160, `160-distinct-work-items-${size}`);
    const queries: [string, object, object][] = [
      ["schedule_occurrences", { churchId }, { startAt: 1, _id: 1 }],
      ["program_drafts", { churchId }, { _id: -1 }],
      ["visitation_cases", { churchId, state: "completed" }, { _id: -1 }],
      ["prayer_requests", { churchId, visibility: "shared", state: "closed" }, { _id: -1 }],
      ["care_alerts", { churchId, state: "linked" }, { _id: -1 }],
    ];
    for (const [collection, filter, sort] of queries) {
      const p = await db.db
        .collection(collection)
        .find(filter)
        .sort(sort as { _id: -1 })
        .limit(26)
        .explain("executionStats");
      assert(
        p.executionStats.nReturned === 26 &&
          p.executionStats.totalDocsExamined <= 26 &&
          !JSON.stringify(p.queryPlanner.winningPlan).includes('"stage":"COLLSCAN"'),
        `bounded-indexed-${collection}-${size}`,
      );
      plans.push({
        size,
        collection,
        filter: JSON.parse(JSON.stringify(filter)),
        plan: p.queryPlanner.winningPlan,
        stats: p.executionStats,
      });
    }
    const count = await db.db
      .collection("care_alerts")
      .aggregate([{ $match: { churchId, state: "linked" } }, { $count: "linked" }])
      .explain("executionStats");
    assert(/IXSCAN|COUNT_SCAN/.test(JSON.stringify(count)), `indexed-count-${size}`);
    plans.push({ size, collection: "care_alerts", kind: "count-not-bounded26", plan: count });
  }
  return {
    status: "PASS",
    protocol:
      "100/500/2000 source profiles x1/5/10 workers;10/50/100 distinct terminal mixed journeys=480; HTTPS/private CA; public setup excluded; bounded fresh repreview/backoff; no SLA",
    results,
    plans,
    limits: [
      "Program schedules, Care signals/open cases and volume profiles are setup outside latency; measured flows commit unique editions, completed visits or closed prayers",
      "No auto-confirm/retry added to product UI; synthetic workload explicitly chooses each decision",
      "26-document bound applies only to the five measured list queries; exact count has no26 bound; not all filters/search",
      "No production SLA/capacity/multi-replica/RPO/RTO/PITR",
    ],
  };
}
