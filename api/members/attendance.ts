import type { ClientSession, Document, ObjectId } from "mongodb";
import type { Database } from "../infrastructure/database";
import type { UnitKind } from "../organization/models";
import type { Member } from "./models";

export interface AttendanceCandidate {
  _id: ObjectId;
  code: string;
  fullName: string;
  nameKey: string;
  nameTokens: string[];
  type: Member["type"];
  version: number;
  areaId: ObjectId | null;
  familyVersion: number;
}
// Bounded Members read model for Attendance. The family join is an explicit
// contract, like OrganizationMembers; Attendance never accesses Member storage.
export class AttendanceMembers {
  constructor(private db: Database) {}
  candidatesForIds(churchId: ObjectId, ids: ObjectId[], tx: ClientSession, limit: number) {
    return this.candidates(churchId, null, tx, limit, undefined, ids);
  }
  async candidates(
    churchId: ObjectId,
    unit: { id: ObjectId; kind: UnitKind } | null,
    tx: ClientSession,
    limit: number,
    memberId?: ObjectId,
    memberIds?: ObjectId[],
  ) {
    const stages: Document[] = [
      {
        $match: {
          churchId,
          participation: { $in: ["active", "long_absent"] },
          ...(memberIds ? { _id: { $in: memberIds } } : {}),
          ...(memberId ? { _id: memberId } : {}),
          ...(unit && unit.kind !== "area" ? { "assignment.unitIds": unit.id } : {}),
        },
      },
      {
        $lookup: {
          from: "families",
          let: { family: "$familyId" },
          pipeline: [
            { $match: { churchId, status: "active", $expr: { $eq: ["$_id", "$$family"] } } },
            { $project: { areaId: 1, version: 1 } },
          ],
          as: "family",
        },
      },
      ...(unit?.kind === "area" ? [{ $match: { "family.areaId": unit.id } }] : []),
      { $sort: { nameKey: 1, _id: 1 } },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          code: 1,
          fullName: 1,
          nameKey: 1,
          nameTokens: 1,
          type: 1,
          version: 1,
          areaId: { $ifNull: [{ $arrayElemAt: ["$family.areaId", 0] }, null] },
          familyVersion: { $ifNull: [{ $arrayElemAt: ["$family.version", 0] }, 0] },
        },
      },
    ];
    return this.db.db
      .collection<Member>("members")
      .aggregate<AttendanceCandidate>(stages, { session: tx })
      .toArray();
  }
}
