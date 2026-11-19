import type { ClientSession, Document } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { Families } from "../families/service";
import type { Database } from "../infrastructure/database";
import type { Member, MemberHistory } from "./models";

const living = ["active", "long_absent"];
const is = (field: string, value: string) => ({ $eq: [`$${field}`, value] });
const sum = (...conditions: Document[]) => ({ $sum: { $cond: [{ $and: conditions }, 1, 0] } });

export class ChurchReportMembers {
  constructor(
    private db: Database,
    private families: Families,
  ) {}
  async read(g: TenantGrant, tx: ClientSession, from: string, to: string) {
    const scope = { churchId: g.churchId };
    const members = this.db.db.collection<Member>("members");
    const date = { $gte: from, $lte: to };
    const current = await members
      .aggregate<{
        membership: {
          official: number;
          unknown: number;
          preparatory: number;
          children: number;
          visitors: number;
        }[];
        families: { n: number }[];
      }>(
        [
          { $match: { ...scope, participation: { $in: living } } },
          {
            $facet: {
              membership: [
                {
                  $group: {
                    _id: null,
                    official: sum(
                      is("type", "believer"),
                      is("membership", "member"),
                      is("baptism.status", "baptized"),
                    ),
                    unknown: sum(
                      is("type", "believer"),
                      is("membership", "member"),
                      is("baptism.status", "unknown"),
                    ),
                    preparatory: sum(is("type", "believer"), is("membership", "preparatory")),
                    children: sum(is("type", "believer"), is("membership", "child")),
                    visitors: sum(is("type", "visitor")),
                  },
                },
              ],
              families: [
                { $match: { type: "believer" } },
                ...this.families.overviewLookup(g.churchId),
                { $unwind: "$household" },
                { $group: { _id: "$household._id" } },
                { $count: "n" },
              ],
            },
          },
        ],
        { session: tx, maxTimeMS: 3000 },
      )
      .next();
    const counts = current?.membership[0];
    const believed = await members.countDocuments(
      { ...scope, "visitor.believedOn": date },
      { session: tx, maxTimeMS: 3000 },
    );
    const undatedBelief = await members.countDocuments(
      {
        ...scope,
        "visitor.stage": "believed",
        "visitor.believedOn": null,
      },
      { session: tx, maxTimeMS: 3000 },
    );
    const history = this.db.db.collection<MemberHistory>("member_history");
    const transitions = {
      event: "participation_changed",
      "after.participation": "transferred",
      "before.participation": { $ne: "transferred" },
    };
    const transfer = await history
      .aggregate<{ n: number }>(
        [
          {
            $match: {
              ...scope,
              ...transitions,
              $or: [{ eventDate: date }, { eventDate: null, effectiveOn: date }],
            },
          },
          { $group: { _id: "$memberId" } },
          { $count: "n" },
        ],
        { session: tx, maxTimeMS: 3000 },
      )
      .next();
    const missingTransfer = await members
      .aggregate<{ n: number }>(
        [
          { $match: { ...scope, participation: "transferred" } },
          {
            $lookup: {
              from: "member_history",
              localField: "_id",
              foreignField: "memberId",
              pipeline: [
                { $match: { ...scope, ...transitions } },
                { $limit: 1 },
                { $project: { _id: 1 } },
              ],
              as: "history",
            },
          },
          { $match: { "history.0": { $exists: false } } },
          { $count: "n" },
        ],
        { session: tx, maxTimeMS: 3000 },
      )
      .next();
    return {
      official: counts?.official ?? 0,
      unknown: counts?.unknown ?? 0,
      preparatory: counts?.preparatory ?? 0,
      children: counts?.children ?? 0,
      visitors: counts?.visitors ?? 0,
      families: current?.families[0]?.n ?? 0,
      believed,
      undatedBelief,
      transfer: transfer?.n ?? 0,
      missingTransfer: missingTransfer?.n ?? 0,
    };
  }
}
