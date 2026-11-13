import type { ClientSession, Document } from "mongodb";
import type { AttendanceReporting, ReportingWindow } from "../attendance/reporting";
import type { TenantGrant } from "../authorization/tenant-grant";
import type { Families } from "../families/service";
import type { Database } from "../infrastructure/database";
import type { OverviewDto, OverviewPerson } from "../overview/contracts";
import { birthdayWindow, monthPeriod, shiftDay } from "./dates";
import { MemberQueries } from "./queries";

const current = { $in: ["active", "long_absent"] };
const sumIf = (condition: Document) => ({ $sum: { $cond: [condition, 1, 0] } });
const is = (field: string, value: string) => ({ $eq: [`$${field}`, value] });
export class OverviewMembers {
  constructor(
    private db: Database,
    private families: Families,
    private key: string,
    _now: () => Date,
  ) {}
  private get rows() {
    return this.db.db.collection("members");
  }
  async absent3(
    g: TenantGrant,
    tx: ClientSession,
    w: ReportingWindow,
    reports: AttendanceReporting,
  ) {
    const r = await this.rows
      .aggregate<{ n: number }>(
        [
          { $match: { churchId: g.churchId, participation: { $in: ["active", "long_absent"] } } },
          ...reports.absentStages(g, w),
          { $count: "n" },
        ],
        { session: tx, maxTimeMS: 10000 },
      )
      .next();
    return r?.n ?? 0;
  }
  async read(g: TenantGrant, tx: ClientSession, day: string) {
    const aggregates = await this.rows
      .aggregate<{
        totals: {
          total: number;
          believer: number;
          visitor: number;
          member: number;
          preparatory: number;
          child: number;
          male: number;
          female: number;
          unknown: number;
          baptized: number;
          not_baptized: number;
          baptismUnknown: number;
        }[];
        visitorStages: { _id: string; count: number }[];
        recent: { n: number }[];
        latest: OverviewPerson[];
        families: { n: number }[];
        areas: { _id: unknown; people: number; families: number }[];
      }>(
        [
          { $match: { churchId: g.churchId, participation: current } },
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    total: { $sum: 1 },
                    believer: sumIf(is("type", "believer")),
                    visitor: sumIf(is("type", "visitor")),
                    member: sumIf(is("membership", "member")),
                    preparatory: sumIf(is("membership", "preparatory")),
                    child: sumIf(is("membership", "child")),
                    male: sumIf(is("gender", "male")),
                    female: sumIf(is("gender", "female")),
                    unknown: sumIf(is("gender", "unknown")),
                    baptized: sumIf(is("baptism.status", "baptized")),
                    not_baptized: sumIf(is("baptism.status", "not_baptized")),
                    baptismUnknown: sumIf(is("baptism.status", "unknown")),
                  },
                },
              ],
              visitorStages: [
                { $match: { type: "visitor" } },
                { $group: { _id: "$visitor.stage", count: { $sum: 1 } } },
              ],
              recent: [
                {
                  $match: {
                    type: "visitor",
                    "visitor.firstVisit": { $gte: shiftDay(day, -29), $lte: day },
                  },
                },
                { $count: "n" },
              ],
              latest: [
                {
                  $match: { type: "visitor", "visitor.firstVisit": { $type: "string", $lte: day } },
                },
                { $sort: { "visitor.firstVisit": -1, _id: -1 } },
                { $limit: 3 },
                {
                  $project: {
                    _id: 0,
                    id: { $toString: "$_id" },
                    code: 1,
                    fullName: 1,
                    type: 1,
                    birthDate: 1,
                    firstVisit: "$visitor.firstVisit",
                    stage: "$visitor.stage",
                    referrer: "$visitor.referrer",
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
              areas: [
                ...this.families.overviewLookup(g.churchId),
                { $set: { area: { $ifNull: [{ $first: "$household.areaId" }, null] } } },
                {
                  $group: {
                    _id: "$area",
                    people: { $sum: 1 },
                    familyIds: { $addToSet: "$familyId" },
                  },
                },
                { $project: { people: 1, families: { $size: "$familyIds" } } },
              ],
            },
          },
        ],
        { session: tx, maxTimeMS: 10000 },
      )
      .next();
    const a = aggregates,
      t = a?.totals[0],
      families = a?.families[0]?.n ?? 0;
    const members: OverviewDto["members"] = {
      total: t?.total ?? 0,
      believer: t?.believer ?? 0,
      visitor: t?.visitor ?? 0,
      membership: {
        member: t?.member ?? 0,
        preparatory: t?.preparatory ?? 0,
        child: t?.child ?? 0,
      },
      gender: { male: t?.male ?? 0, female: t?.female ?? 0, unknown: t?.unknown ?? 0 },
      baptism: {
        baptized: t?.baptized ?? 0,
        not_baptized: t?.not_baptized ?? 0,
        unknown: t?.baptismUnknown ?? 0,
      },
    };
    const stage = (name: string) => a?.visitorStages.find((r) => r._id === name)?.count ?? 0;
    const convertedYear = await this.rows.countDocuments(
      { churchId: g.churchId, convertedOn: { $gte: `${day.slice(0, 4)}-01-01`, $lte: day } },
      { session: tx, maxTimeMS: 10000 },
    );
    const birthday = async (filter: string, withItems = false) => {
      const p = new MemberQueries(this.key, () => new Date(`${day}T05:00:00Z`)).pipeline(
        g,
        new URLSearchParams({ birthday: filter }),
        this.families,
        true,
      );
      const r = await this.rows
        .aggregate<{ count: { n: number }[]; items: OverviewPerson[] }>(
          [
            ...p.stages,
            {
              $facet: {
                count: [{ $count: "n" }],
                items: withItems
                  ? [
                      { $sort: { birthdayKey: 1, _id: 1 } },
                      { $limit: 6 },
                      {
                        $project: {
                          _id: 0,
                          id: { $toString: "$_id" },
                          code: 1,
                          fullName: 1,
                          type: 1,
                          birthDate: 1,
                          birthday: "$birthdayKey",
                          turnAge: {
                            $subtract: [
                              { $toInt: { $substrBytes: ["$birthdayKey", 0, 4] } },
                              { $toInt: { $substrBytes: ["$birthDate", 0, 4] } },
                            ],
                          },
                        },
                      },
                    ]
                  : [{ $match: { _id: null } }],
              },
            },
          ],
          { session: tx, maxTimeMS: 10000 },
        )
        .next();
      return { count: r?.count[0]?.n ?? 0, items: r?.items ?? [] };
    };
    const week = await birthday("week", true),
      month = monthPeriod(day),
      nextMonth = monthPeriod(day, 1),
      thisMonth = await birthday(`month:${month}`),
      following = await birthday(`month:${nextMonth}`),
      range = birthdayWindow(day, "week");
    const areas = (a?.areas ?? []).map((r) => ({
        id: r._id ? String(r._id) : null,
        people: r.people,
        families: r.families,
      })),
      sorted = areas
        .filter((r) => r.id)
        .sort((x, y) => y.people - x.people || String(x.id).localeCompare(String(y.id)));
    return {
      members,
      families: {
        believerFamilies: families,
        believersPerFamily: families ? Math.round((members.believer / families) * 10) / 10 : null,
      },
      visitors: {
        total: members.visitor,
        new30: a?.recent[0]?.n ?? 0,
        stages: { new: stage("new"), exploring: stage("exploring"), believed: stage("believed") },
        latest: a?.latest ?? [],
        convertedYear,
      },
      birthdays: {
        from: range.from,
        to: range.to,
        total: week.count,
        items: week.items,
        month: { period: month, count: thisMonth.count },
        nextMonth: { period: nextMonth, count: following.count },
      },
      areas: sorted.slice(0, 6),
      areaGroupCount: sorted.length,
      unassigned: areas.find((r) => r.id === null) ?? { people: 0, families: 0 },
    };
  }
}
