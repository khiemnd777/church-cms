import type { ClientSession } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
import { type RiteRecord, riteDto } from "./models";
export class RiteReporting {
  constructor(private db: Database) {}
  async read(g: TenantGrant, tx: ClientSession, day: string) {
    requireCondition(!g.unitScope && !g.receiptScope, 403, "FORBIDDEN");
    const rows = this.db.db.collection<RiteRecord>("rite_records"),
      kinds = ["baptism", "dedication", "marriage", "funeral"] as const;
    const counts = await rows
      .aggregate<{ _id: string; n: number }>(
        [
          {
            $match: {
              churchId: g.churchId,
              state: "recorded",
              kind: { $in: kinds },
              "input.date": { $gte: `${day.slice(0, 4)}-01-01`, $lte: day },
            },
          },
          { $group: { _id: "$kind", n: { $sum: 1 } } },
        ],
        { session: tx, maxTimeMS: 10000 },
      )
      .toArray();
    const unknown = await rows.countDocuments(
      { churchId: g.churchId, state: "recorded", kind: { $in: kinds }, "input.date": null },
      { session: tx, maxTimeMS: 10000 },
    );
    const recent = await rows
      .find(
        {
          churchId: g.churchId,
          state: "recorded",
          $or: [{ "input.date": { $lte: day, $type: "string" } }, { "input.date": null }],
        },
        { session: tx },
      )
      .sort({ "input.date": -1, _id: -1 })
      .limit(5)
      .toArray();
    const communion = await rows.distinct(
      "input.date",
      {
        churchId: g.churchId,
        state: "recorded",
        kind: "communion",
        "input.date": { $gte: `${Number(day.slice(0, 4)) - 1}-01-01`, $lte: day },
      },
      { session: tx },
    );
    return {
      value: counts.reduce((n, r) => n + r.n, 0),
      availability: "available" as const,
      year: Number(day.slice(0, 4)),
      counts: Object.fromEntries(kinds.map((k) => [k, counts.find((r) => r._id === k)?.n ?? 0])),
      unknownDate: unknown,
      recent: recent.map(riteDto),
      communionDays: communion.filter((d): d is string => typeof d === "string"),
    };
  }
}
