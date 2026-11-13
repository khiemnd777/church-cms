import { type ClientSession, type Document, ObjectId } from "mongodb";
import type { TenantGrant } from "../authorization/tenant-grant";
import { requireCondition } from "../errors";
import { digest } from "../identity/crypto";
import type { Database } from "../infrastructure/database";
import { businessDay, shiftDay, validDay } from "../members/dates";
import type { AttendanceParticipant, AttendanceSession } from "./models";

export const lastSunday = (day: string) => shiftDay(day, -new Date(`${day}T00:00:00Z`).getUTCDay());
export type ReferenceDay = {
  day: string;
  sessionId: string | null;
  state: "draft" | "open" | "closed" | null;
  version: number | null;
  present: number | null;
  included: number | null;
  visitors: number | null;
  rate: number | null;
};
export interface ReportingWindow {
  until: string;
  days: ReferenceDay[];
  fingerprint: string;
}
export type Presence = "present" | "absent" | "pending" | "outside" | "missing";
export interface MemberAttendance {
  until: string;
  days: { day: string; sessionId: string | null; status: Presence }[];
  present: number;
  eligible: number;
  rate: number | null;
  absent3: boolean;
}
export const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
// All foreign callers use this owned, tenant-scoped read model. No business writes.
export class AttendanceReporting {
  constructor(
    private db: Database,
    private now: () => Date,
  ) {}
  staff(g: TenantGrant) {
    requireCondition(
      (g.actorKind === "owner" || g.canReadAttendance) && !g.unitScope && !g.receiptScope,
      403,
      "FORBIDDEN",
    );
  }
  async window(g: TenantGrant, tx: ClientSession, until?: string | null): Promise<ReportingWindow> {
    this.staff(g);
    const today = businessDay(this.now()),
      end = until ?? lastSunday(today);
    requireCondition(
      validDay(end) && end <= today && lastSunday(end) === end,
      400,
      "INVALID_REQUEST",
    );
    const dates = Array.from({ length: 12 }, (_, i) => shiftDay(end, (i - 11) * 7));
    const rows = await this.db.db
      .collection<AttendanceSession>("attendance_sessions")
      .find(
        {
          churchId: g.churchId,
          reportingKind: "sunday_reference",
          scope: "church",
          prepClass: { $exists: false },
          heldOn: { $in: dates },
        },
        { session: tx },
      )
      .sort({ heldOn: 1 })
      .limit(12)
      .toArray();
    const visitors = await this.db.db
      .collection<AttendanceParticipant>("attendance_participants")
      .aggregate<{ _id: ObjectId; n: number }>(
        [
          {
            $match: {
              churchId: g.churchId,
              sessionId: { $in: rows.filter((s) => s.state === "closed").map((s) => s._id) },
              included: true,
              present: true,
              type: "visitor",
            },
          },
          { $group: { _id: "$sessionId", n: { $sum: 1 } } },
        ],
        { session: tx, maxTimeMS: 10000 },
      )
      .toArray();
    return {
      until: end,
      days: dates.map((day) => {
        const s = rows.find((r) => r.heldOn === day),
          closed = s?.state === "closed";
        return {
          day,
          sessionId: s?._id.toHexString() ?? null,
          state: s?.state ?? null,
          version: s?.version ?? null,
          present: closed ? s.presentCount : null,
          included: closed ? s.includedCount : null,
          visitors: closed ? (visitors.find((v) => v._id.equals(s._id))?.n ?? 0) : null,
          rate: closed ? ratio(s.presentCount, s.includedCount) : null,
        };
      }),
      fingerprint: digest(
        JSON.stringify([end, rows.map((s) => [s._id, s.version, s.generation, s.state])]),
      ),
    };
  }
  absentStages(g: TenantGrant, w: ReportingWindow): Document[] {
    this.staff(g);
    const ids = w.days
      .slice(-3)
      .filter((d) => d.state === "closed")
      .map((d) => new ObjectId(d.sessionId as string));
    if (ids.length !== 3) return [{ $match: { _id: { $exists: false } } }];
    return [
      {
        $lookup: {
          from: "attendance_participants",
          let: { member: "$_id" },
          pipeline: [
            {
              $match: {
                churchId: g.churchId,
                sessionId: { $in: ids },
                included: true,
                present: false,
                $expr: { $eq: ["$memberId", "$$member"] },
              },
            },
            { $count: "n" },
          ],
          as: "_absence",
        },
      },
      { $match: { "_absence.n": 3 } },
      { $unset: "_absence" },
    ];
  }
  async members(g: TenantGrant, ids: ObjectId[], tx: ClientSession, w: ReportingWindow) {
    this.staff(g);
    requireCondition(ids.length <= 101, 400, "INVALID_REQUEST");
    const rows = await this.db.db
      .collection<AttendanceParticipant>("attendance_participants")
      .find(
        {
          churchId: g.churchId,
          memberId: { $in: ids },
          sessionId: {
            $in: w.days.flatMap((d) => (d.sessionId ? [new ObjectId(d.sessionId)] : [])),
          },
        },
        { session: tx, projection: { memberId: 1, sessionId: 1, included: 1, present: 1 } },
      )
      .toArray();
    return new Map(
      ids.map((id) => {
        const days = w.days.map((d) => {
            const row = rows.find(
              (r) => r.memberId.equals(id) && r.sessionId.toHexString() === d.sessionId,
            );
            const status: Presence = !d.sessionId
              ? "missing"
              : d.state !== "closed"
                ? "pending"
                : !row?.included
                  ? "outside"
                  : row.present
                    ? "present"
                    : "absent";
            return { day: d.day, sessionId: d.sessionId, status };
          }),
          present = days.filter((d) => d.status === "present").length,
          eligible = days.filter((d) => d.status === "present" || d.status === "absent").length;
        return [
          id.toHexString(),
          {
            until: w.until,
            days,
            present,
            eligible,
            rate: ratio(present, eligible),
            absent3: days.slice(-3).every((d) => d.status === "absent"),
          } satisfies MemberAttendance,
        ];
      }),
    );
  }
  async units(g: TenantGrant, ids: ObjectId[], tx: ClientSession, day = businessDay(this.now())) {
    requireCondition(
      (g.actorKind === "owner" || g.canReadAttendance) &&
        ids.length <= 101 &&
        (!g.unitScope || ids.every((id) => g.unitScope?.includes(id.toHexString()))),
      403,
      "FORBIDDEN",
    );
    const rows = await this.db.db
      .collection<AttendanceSession>("attendance_sessions")
      .aggregate<{ _id: ObjectId; rows: AttendanceSession[] }>(
        [
          {
            $match: {
              churchId: g.churchId,
              scope: "unit",
              unitId: { $in: ids },
              state: "closed",
              prepClass: { $exists: false },
              heldOn: { $gte: shiftDay(day, -83), $lte: day },
            },
          },
          { $sort: { heldOn: -1, _id: -1 } },
          {
            $group: {
              _id: "$unitId",
              rows: {
                $firstN: {
                  input: {
                    id: "$_id",
                    heldOn: "$heldOn",
                    includedCount: "$includedCount",
                    presentCount: "$presentCount",
                  },
                  n: 4,
                },
              },
            },
          },
        ],
        { session: tx, maxTimeMS: 10000 },
      )
      .toArray();
    return new Map(
      ids.map((id) => {
        const list = rows.find((r) => r._id.equals(id))?.rows ?? [],
          included = list.reduce((n, s) => n + s.includedCount, 0),
          present = list.reduce((n, s) => n + s.presentCount, 0);
        return [
          id.toHexString(),
          {
            value: ratio(present, included),
            availability: included ? ("available" as const) : ("not_available" as const),
            present,
            included,
            sessions: list.length,
            from: shiftDay(day, -83),
            to: day,
          },
        ];
      }),
    );
  }
}
