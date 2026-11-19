import type { ClientSession, Filter, ObjectId } from "mongodb";
import { requireCondition } from "../errors";
import { objectId } from "../http-validation";
import type { Database } from "../infrastructure/database";
import { type Member, type MemberHistory, searchName } from "./models";
import { escaped } from "./queries";

const available: Member["participation"][] = ["active", "long_absent"];
export const portalEligible = (member: Pick<Member, "type" | "participation">) =>
  member.type === "believer" && available.includes(member.participation);

export class PortalMembers {
  constructor(private db: Database) {}
  private get members() {
    return this.db.db.collection<Member>("members");
  }
  async profile(churchId: ObjectId, memberId: ObjectId, tx: ClientSession) {
    const m = await this.members.findOne(
      { churchId, _id: memberId },
      {
        session: tx,
        projection: {
          _id: 1,
          code: 1,
          fullName: 1,
          birthDate: 1,
          gender: 1,
          phone: 1,
          type: 1,
          membership: 1,
          participation: 1,
          baptism: 1,
          version: 1,
        },
      },
    );
    if (!m) return null;
    return {
      id: m._id,
      code: m.code,
      fullName: m.fullName,
      birthDate: m.birthDate,
      gender: m.gender,
      phone: m.phone,
      type: m.type,
      membership: m.membership,
      participation: m.participation,
      baptism: { status: m.baptism.status, date: m.baptism.date, place: m.baptism.place },
      version: m.version,
    };
  }
  async accessBroken(
    churchId: ObjectId,
    memberId: ObjectId,
    versionAtLink: number,
    tx: ClientSession,
  ) {
    const interrupted = await this.db.db.collection<MemberHistory>("member_history").findOne(
      {
        churchId,
        memberId,
        version: { $gt: versionAtLink },
        $or: [
          { "after.participation": { $in: ["transferred", "deceased"] } },
          { "after.type": "visitor" },
        ],
      },
      { projection: { _id: 1 }, maxTimeMS: 3000, session: tx },
    );
    return !!interrupted;
  }
  async fence(churchId: ObjectId, memberId: ObjectId, version: number, tx: ClientSession) {
    const match = await this.members.updateOne(
      { _id: memberId, churchId, type: "believer", participation: { $in: available }, version },
      { $inc: { writeFence: 1 } },
      { session: tx },
    );
    requireCondition(match.matchedCount, 412, "PORTAL_MEMBER_CHANGED");
  }
  async page(
    churchId: ObjectId,
    term: string,
    after: { key: string; id: string } | null,
    limit: number,
    tx: ClientSession,
  ) {
    const q = searchName(term),
      clauses: Filter<Member>[] = [];
    if (q)
      clauses.push({
        $or: [
          { code: { $regex: `^${escaped(q.toUpperCase())}` } },
          { nameTokens: { $regex: `^${escaped(q)}` } },
        ],
      });
    if (after)
      clauses.push({
        $or: [
          { nameKey: { $gt: after.key } },
          { nameKey: after.key, _id: { $gt: objectId(after.id) } },
        ],
      });
    const rows = await this.members
      .find(
        {
          churchId,
          type: "believer",
          participation: { $in: available },
          ...(clauses.length ? { $and: clauses } : {}),
        },
        {
          session: tx,
          maxTimeMS: 3000,
          projection: {
            _id: 1,
            fullName: 1,
            nameKey: 1,
            code: 1,
            birthDate: 1,
            participation: 1,
            version: 1,
          },
        },
      )
      .sort({ nameKey: 1, _id: 1 })
      .limit(limit)
      .toArray();
    return rows.map((m) => ({
      id: m._id.toHexString(),
      nameKey: m.nameKey,
      code: m.code,
      fullName: m.fullName,
      birthDate: m.birthDate,
      participation: m.participation,
      version: m.version,
    }));
  }
}
