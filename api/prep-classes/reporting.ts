import type { ClientSession } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import type { Database } from "../infrastructure/database";
export class PrepReporting {
  constructor(private db: Database) {}
  async read(g: TenantGrant, tx: ClientSession) {
    requireCondition(!g.unitScope && !g.receiptScope, 403, "FORBIDDEN");
    const result = await this.db.db
      .collection("prep_courses")
      .aggregate<{ courses: number; enrollments: number }>(
        [
          { $match: { churchId: g.churchId, state: "active" } },
          {
            $lookup: {
              from: "prep_enrollments",
              let: { course: "$_id" },
              pipeline: [
                {
                  $match: {
                    churchId: g.churchId,
                    state: "studying",
                    $expr: { $eq: ["$courseId", "$$course"] },
                  },
                },
                { $count: "n" },
              ],
              as: "enrollments",
            },
          },
          {
            $group: {
              _id: null,
              courses: { $sum: 1 },
              enrollments: { $sum: { $ifNull: [{ $first: "$enrollments.n" }, 0] } },
            },
          },
        ],
        { session: tx, maxTimeMS: 10000 },
      )
      .next();
    return { courses: result?.courses ?? 0, enrollments: result?.enrollments ?? 0 };
  }
}
